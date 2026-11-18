// The trading loop. Each tick:
//   1. read new articles and analyse them
//   2. score every watchlist symbol
//   3. if the market is open: enforce the daily loss limit, flatten near the
//      close, exit positions whose news has turned or that are too old, and
//      open new bracket orders where the news is strong, the price agrees,
//      and the risk rules allow it.
//
// The bot only ever touches positions it opened itself (recorded in state),
// so it will not sell anything you hold in the same account.

import { computeSignals, rankSignals } from './strategy/signals.js';
import { confirmMove } from './strategy/confirm.js';
import { entryGate, sizePosition, bracketPrices, dailyPnlPct } from './strategy/risk.js';
import { nyDateKey, sessionOpen, minutesBetween, sleep, MINUTE } from './time.js';

export class TradingBot {
  /**
   * @param {object} deps
   * @param {object} deps.config
   * @param {object|null} deps.broker     AlpacaBroker, DryRunBroker or SimBroker; null for signals only
   * @param {object} deps.collector       NewsCollector
   * @param {object} deps.analyzer        NewsAnalyzer
   * @param {object} deps.state           StateStore
   * @param {object} deps.log
   * @param {() => number} [deps.now]
   */
  constructor({ config, broker, collector, analyzer, state, log, now = Date.now }) {
    Object.assign(this, { config, broker, collector, analyzer, state, log, now });
    this.symbols = config.watchlist.map((w) => w.symbol);
    this.assetCache = new Map();
    this.lastSkip = new Map();
  }

  // --- news ----------------------------------------------------------------------

  isSeen = (item) => Boolean(this.state.data.seen[item.key] || this.state.data.seen[`t:${item.titleKey}`]);

  newsWindowStart(nowMs) {
    const { news, signal } = this.config;
    let since = nowMs - news.lookbackMinutes * MINUTE;
    const open = sessionOpen(nowMs);
    if (signal.overnightCarryHours > 0 && nowMs < open + 390 * MINUTE) {
      since = Math.min(since, open - signal.overnightCarryHours * 60 * MINUTE);
    }
    return since;
  }

  async ingestNews(nowMs) {
    const d = this.state.data;
    const { items, errors, polled } = await this.collector.collect({ sinceMs: this.newsWindowStart(nowMs), nowMs, isSeen: this.isSeen });
    d.lastPollAt = nowMs;
    if (items.length === 0) return { items, analyses: [], errors, polled };
    const analyses = await this.analyzer.analyze(items);
    for (const item of items) {
      d.seen[item.key] = nowMs;
      d.seen[`t:${item.titleKey}`] = nowMs;
      for (const k of item.duplicateKeys || []) d.seen[k] = nowMs;
    }
    d.analyses.push(...analyses);
    for (const a of analyses) {
      if (a.impact > 0 && a.direction !== 'neutral') {
        this.log.event('analysis', `${a.symbol} ${a.direction} / ${a.impactLabel} impact / confidence ${a.confidence.toFixed(2)} [${a.method}, ${a.sourceName}] ${a.title}`,
          { symbol: a.symbol, direction: a.direction, impact: a.impactLabel, confidence: a.confidence, novelty: a.novelty, rationale: a.rationale, url: a.url, method: a.method });
      }
    }
    return { items, analyses, errors, polled };
  }

  // --- one tick ------------------------------------------------------------------

  rollDay(nowMs) {
    const d = this.state.data;
    const today = nyDateKey(nowMs);
    if (d.day !== today) {
      if (d.day) this.log.info(`new trading day ${today}; daily counters reset`);
      d.day = today;
      d.tradesToday = 0;
      d.halted = null;
      this.assetCache.clear();
    }
  }

  async tick() {
    const nowMs = this.now();
    const cfg = this.config;
    const d = this.state.data;
    this.rollDay(nowMs);
    this.state.prune(nowMs, cfg.signal.maxArticleAgeMinutes + cfg.signal.overnightCarryHours * 60);

    const report = { at: nowMs, marketOpen: null, newArticles: 0, signals: [], actions: [], skipped: [], gate: null, nextOpen: null };
    const news = await this.ingestNews(nowMs);
    report.newArticles = news.items.length;
    report.sourceErrors = news.errors;
    const signals = computeSignals(d.analyses, nowMs, cfg.signal, this.symbols);
    report.signals = rankSignals(signals).filter((s) => s.score !== 0);

    if (!this.broker?.canTrade) {
      this.state.save();
      return report;
    }

    const clock = await this.broker.getClock();
    report.marketOpen = clock.isOpen;
    report.nextOpen = clock.nextOpen;
    if (!clock.isOpen) {
      this.state.save();
      return report;
    }

    const [account, positions, openOrders] = await Promise.all([
      this.broker.getAccount(), this.broker.getPositions(), this.broker.getOpenOrders(),
    ]);
    report.account = { equity: account.equity, buyingPower: account.buyingPower };
    const posBySym = new Map(positions.map((p) => [p.symbol, p]));
    const ordersBySym = new Map();
    for (const o of openOrders) (ordersBySym.get(o.symbol) || ordersBySym.set(o.symbol, []).get(o.symbol)).push(o);

    // Positions the bot opened that are gone: a bracket exit filled, or the
    // entry never filled. Either way the bot is no longer managing them.
    for (const [sym, entry] of Object.entries(d.entries)) {
      if (!posBySym.has(sym) && !ordersBySym.get(sym)?.length) {
        delete d.entries[sym];
        d.lastExitAt[sym] = nowMs;
        this.log.event('closed', this.config.dryRun
          ? `[dry run] clearing the simulated ${sym} entry`
          : `${sym} is no longer open: its stop or target filled, or the entry did not fill`, { symbol: sym, entry });
        report.actions.push({ type: 'closed-by-broker', symbol: sym });
      }
    }

    // Daily loss limit, measured on the whole account.
    const pnl = dailyPnlPct(account);
    report.dailyPnlPct = pnl;
    if (!d.halted && pnl <= -cfg.risk.maxDailyLossPct) {
      d.halted = { reason: `account down ${pnl.toFixed(2)}% today, limit is ${cfg.risk.maxDailyLossPct}%`, at: nowMs };
      this.log.event('halt', `trading halted for the day: ${d.halted.reason}`, d.halted);
      if (cfg.risk.flattenOnDailyLoss) await this.closeManaged('daily loss limit', report);
    }

    // End of day: day trading means nothing is held overnight.
    const toClose = minutesBetween(nowMs, clock.nextClose);
    if (toClose <= cfg.risk.flattenMinutesBeforeClose) {
      if (Object.keys(d.entries).length) await this.closeManaged('end of day', report);
      report.gate = { ok: false, reason: 'closing time' };
      this.state.save();
      return report;
    }

    // Exits.
    for (const [sym, entry] of Object.entries(d.entries)) {
      if (!posBySym.has(sym)) continue;
      const dir = entry.side === 'buy' ? 1 : -1;
      const score = signals.get(sym)?.score ?? 0;
      const held = minutesBetween(entry.at, nowMs);
      let reason = null;
      if (score * dir <= -cfg.signal.exitThreshold) reason = `news turned against the position (score ${score.toFixed(2)})`;
      else if (held >= cfg.risk.maxHoldMinutes) reason = `held ${Math.round(held)} min, the limit is ${cfg.risk.maxHoldMinutes}`;
      if (reason) await this.exit(sym, reason, report);
    }

    // Entries.
    const gate = entryGate({ nowMs, clock, account, state: d, managedCount: Object.keys(d.entries).length, risk: cfg.risk });
    report.gate = gate;
    if (gate.ok) await this.enter({ nowMs, signals, account, posBySym, ordersBySym, report });

    this.state.save();
    return report;
  }

  skip(report, symbol, reason) {
    report.skipped.push({ symbol, reason });
    if (this.lastSkip.get(symbol) !== reason) {
      this.lastSkip.set(symbol, reason);
      this.log.event('skip', `${symbol}: not trading, ${reason}`, { symbol, reason });
    }
  }

  async asset(symbol) {
    if (!this.assetCache.has(symbol)) this.assetCache.set(symbol, await this.broker.getAsset(symbol));
    return this.assetCache.get(symbol);
  }

  async enter({ nowMs, signals, account, posBySym, ordersBySym, report }) {
    const cfg = this.config;
    const d = this.state.data;
    let slots = cfg.risk.maxOpenPositions - Object.keys(d.entries).length;
    let tradesLeft = cfg.risk.maxTradesPerDay - d.tradesToday;

    const eligible = [];
    for (const sig of rankSignals(signals)) {
      if (Math.abs(sig.score) < cfg.signal.entryThreshold) break;
      const sym = sig.symbol;
      const side = sig.score > 0 ? 'buy' : 'sell';
      if (d.entries[sym]) continue;
      if (posBySym.has(sym)) { this.skip(report, sym, 'the account already holds it and the bot did not open that position'); continue; }
      if (ordersBySym.get(sym)?.length) { this.skip(report, sym, 'there is already an open order for it'); continue; }
      const lastExit = d.lastExitAt[sym];
      if (lastExit && nowMs - lastExit < cfg.risk.cooldownMinutes * MINUTE) { this.skip(report, sym, `cooling down after the last exit`); continue; }
      if (side === 'sell' && !(cfg.risk.allowShort && account.shortingEnabled)) { this.skip(report, sym, `news is bearish (score ${sig.score.toFixed(2)}) but short selling is off`); continue; }
      eligible.push({ sig, side });
    }
    if (eligible.length === 0 || slots <= 0 || tradesLeft <= 0) return;

    const syms = eligible.map((e) => e.sig.symbol);
    const [intraday, daily] = await Promise.all([
      this.broker.getBars(syms, { start: new Date(sessionOpen(nowMs)).toISOString(), timeframe: '1Min' }),
      this.broker.getBars(syms, { start: new Date(nowMs - 7 * 24 * 60 * MINUTE).toISOString(), timeframe: '1Day' }).catch(() => ({})),
    ]);
    const today = nyDateKey(nowMs);

    for (const { sig, side } of eligible) {
      if (slots <= 0 || tradesLeft <= 0) break;
      const sym = sig.symbol;
      const dir = side === 'buy' ? 1 : -1;
      const prevClose = (daily[sym] || []).filter((b) => nyDateKey(b.t) < today).at(-1)?.c ?? null;
      const conf = confirmMove(intraday[sym] || [], dir, cfg.confirmation, prevClose);
      if (!conf.ok) { this.skip(report, sym, conf.reason); continue; }
      const price = conf.lastPrice;
      if (price < cfg.risk.minPrice) { this.skip(report, sym, `price ${price} is under the $${cfg.risk.minPrice} minimum`); continue; }
      let asset;
      try {
        asset = await this.asset(sym);
      } catch (err) {
        this.skip(report, sym, `could not look up the asset: ${err.message}`);
        continue;
      }
      if (!asset.tradable) { this.skip(report, sym, 'the broker marks it not tradable'); continue; }
      if (side === 'sell' && !asset.shortable) { this.skip(report, sym, 'the broker has no shares to borrow for a short'); continue; }
      const qty = sizePosition({ equity: account.equity, buyingPower: account.buyingPower, price, risk: cfg.risk });
      if (qty < 1) { this.skip(report, sym, 'the position size rounds down to zero shares'); continue; }
      const { stopLoss, takeProfit } = bracketPrices(price, side, cfg.risk);
      const clientOrderId = `nb-${sym}-${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const top = sig.evidence[0];
      try {
        const order = await this.broker.submitBracketOrder({ symbol: sym, side, qty, takeProfit, stopLoss, clientOrderId });
        d.entries[sym] = {
          symbol: sym, side, qty, at: nowMs, refPrice: price, stopLoss, takeProfit,
          score: sig.score, orderId: order.id, clientOrderId,
          evidence: sig.evidence.slice(0, 5).map((e) => ({ title: e.title, source: e.source, contribution: e.contribution, url: e.url })),
        };
        d.tradesToday++;
        slots--;
        tradesLeft--;
        account.buyingPower -= qty * price;
        this.lastSkip.delete(sym);
        const verb = side === 'buy' ? 'BUY' : 'SHORT';
        this.log.event('order', `${verb} ${qty} ${sym} near ${price} (stop ${stopLoss}, target ${takeProfit}), score ${sig.score.toFixed(2)}: "${top?.title}" [${top?.source}]`,
          { symbol: sym, side, qty, price, stopLoss, takeProfit, score: sig.score, orderId: order.id, confirmation: conf.reason, evidence: d.entries[sym].evidence });
        report.actions.push({ type: 'enter', symbol: sym, side, qty, price, stopLoss, takeProfit, score: sig.score });
      } catch (err) {
        this.log.error(`order for ${sym} failed: ${err.message}`);
        report.actions.push({ type: 'order-failed', symbol: sym, error: err.message });
      }
    }
  }

  async exit(sym, reason, report) {
    const d = this.state.data;
    try {
      await this.broker.closePosition(sym);
      this.log.event('exit', `closing ${sym}: ${reason}`, { symbol: sym, reason, entry: d.entries[sym] });
      delete d.entries[sym];
      d.lastExitAt[sym] = this.now();
      report.actions.push({ type: 'exit', symbol: sym, reason });
    } catch (err) {
      this.log.error(`could not close ${sym}: ${err.message}`);
      report.actions.push({ type: 'exit-failed', symbol: sym, error: err.message });
    }
  }

  async closeManaged(reason, report) {
    for (const sym of Object.keys(this.state.data.entries)) await this.exit(sym, reason, report);
  }

  // --- loop ----------------------------------------------------------------------

  summarize(report) {
    const top = report.signals.slice(0, 4).map((s) => `${s.symbol} ${s.score >= 0 ? '+' : ''}${s.score.toFixed(2)}`).join(', ') || 'none';
    const market = report.marketOpen == null ? 'signals only' : report.marketOpen ? 'market open' : 'market closed';
    const gate = report.gate ? `; ${report.gate.ok ? 'entries allowed' : report.gate.reason}` : '';
    return `${market}; ${report.newArticles} new article(s); signals: ${top}${gate}`;
  }

  async run({ signal } = {}) {
    let failures = 0;
    while (!signal?.aborted) {
      let wait = this.config.pollSeconds * 1000;
      try {
        const report = await this.tick();
        failures = 0;
        this.log.info(this.summarize(report));
        if (report.marketOpen === false) {
          wait = this.config.closedPollSeconds * 1000;
          if (report.nextOpen) wait = Math.max(this.config.pollSeconds * 1000, Math.min(wait, report.nextOpen - this.now()));
        }
      } catch (err) {
        failures++;
        wait = Math.min(wait * 2 ** failures, 10 * MINUTE);
        this.log.error(`tick failed (${failures} in a row), retrying in ${Math.round(wait / 1000)}s: ${err.message}`);
      }
      await sleep(wait, signal);
    }
    this.state.save();
  }
}
