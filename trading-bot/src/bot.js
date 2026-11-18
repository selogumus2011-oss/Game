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
      d.realizedToday = 0;
      d.halted = null;
      this.assetCache.clear();
    }
  }

  /**
   * The bot's trading budget in dollars when risk.capital is set, converted
   * at the broker's rate once a day. null means "use the whole account".
   */
  async resolveBudget(nowMs) {
    const cap = this.config.risk.capital;
    if (!cap) return null;
    const d = this.state.data;
    const today = nyDateKey(nowMs);
    const prev = d.budget;
    if (prev?.day === today && prev.amount === cap.amount && prev.currency === cap.currency && (cap.fxRate == null || prev.rate === cap.fxRate)) return prev;
    let rate = 1;
    if (cap.currency !== 'USD') {
      rate = cap.fxRate ?? null;
      if (rate == null) {
        try {
          rate = await this.broker.getFxRate(`${cap.currency}USD`);
          if (!(rate > 0.01 && rate < 1000)) throw new Error(`implausible rate ${rate}`);
        } catch (err) {
          if (prev?.currency === cap.currency && prev.rate > 0) {
            rate = prev.rate;
            this.log.warn(`could not fetch the ${cap.currency}USD rate (${err.message}); keeping ${rate}`);
          } else {
            throw new Error(`could not fetch the ${cap.currency}USD exchange rate (${err.message}). Set risk.capital.fxRate to give it yourself.`);
          }
        }
      }
    }
    d.budget = { day: today, amount: cap.amount, currency: cap.currency, rate, usd: Math.round(cap.amount * rate * 100) / 100 };
    this.log.event('budget', cap.currency === 'USD'
      ? `trading budget $${d.budget.usd}`
      : `trading budget ${cap.amount} ${cap.currency} = $${d.budget.usd} at ${cap.currency}USD ${rate}`, d.budget);
    return d.budget;
  }

  /** Realised P&L of a position the broker closed, from its fills. */
  async realizedFromFills(sym, entry) {
    const fallback = entry.lastUnrealizedPl ?? 0;
    if (!this.broker.getClosedOrders) return fallback;
    try {
      const orders = (await this.broker.getClosedOrders({ symbol: sym, after: entry.at - MINUTE }))
        .filter((o) => o.filledQty > 0 && o.filledAvgPrice > 0);
      const entryFill = orders.find((o) => o.clientOrderId === entry.clientOrderId);
      if (!entryFill && entry.avgEntryPrice == null) return 0; // never filled
      const entryPx = entryFill?.filledAvgPrice ?? entry.avgEntryPrice;
      const exitSide = entry.side === 'buy' ? 'sell' : 'buy';
      const exits = orders.filter((o) => o.side === exitSide && o.clientOrderId !== entry.clientOrderId);
      if (exits.length === 0) return fallback;
      const dir = entry.side === 'buy' ? 1 : -1;
      return exits.reduce((sum, o) => sum + dir * (o.filledAvgPrice - entryPx) * o.filledQty, 0);
    } catch (err) {
      this.log.warn(`could not read ${sym} fills (${err.message}); using the last known P&L`);
      return fallback;
    }
  }

  /** The bot's own P&L today: closed trades plus what its open positions show. */
  botPnl(posBySym) {
    const d = this.state.data;
    let open = 0;
    for (const sym of Object.keys(d.entries)) open += posBySym.get(sym)?.unrealizedPl ?? 0;
    return d.realizedToday + open;
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
    const budget = await this.resolveBudget(nowMs);
    report.account = { equity: account.equity, buyingPower: account.buyingPower };
    report.budget = budget;
    const posBySym = new Map(positions.map((p) => [p.symbol, p]));
    const ordersBySym = new Map();
    for (const o of openOrders) (ordersBySym.get(o.symbol) || ordersBySym.set(o.symbol, []).get(o.symbol)).push(o);

    // Positions the bot opened that are gone: a bracket exit filled, or the
    // entry never filled. Either way the bot is no longer managing them.
    for (const [sym, entry] of Object.entries(d.entries)) {
      if (!posBySym.has(sym) && !ordersBySym.get(sym)?.length) {
        const pnl = this.config.dryRun ? 0 : await this.realizedFromFills(sym, entry);
        d.realizedToday += pnl;
        delete d.entries[sym];
        d.lastExitAt[sym] = nowMs;
        this.log.event('closed', this.config.dryRun
          ? `[dry run] clearing the simulated ${sym} entry`
          : `${sym} is no longer open: its stop or target filled, or the entry did not fill (P&L $${pnl.toFixed(2)})`, { symbol: sym, entry, pnl });
        report.actions.push({ type: 'closed-by-broker', symbol: sym, pnl });
      }
    }
    // Remember what each open position shows, for P&L if it closes.
    for (const [sym, entry] of Object.entries(d.entries)) {
      const pos = posBySym.get(sym);
      if (pos) {
        entry.lastUnrealizedPl = pos.unrealizedPl;
        entry.avgEntryPrice = pos.avgEntryPrice;
      }
    }

    // Daily loss limit: on the bot's own P&L against its budget when it has
    // one, otherwise on the whole account.
    const pnlPct = budget ? (this.botPnl(posBySym) / budget.usd) * 100 : dailyPnlPct(account);
    report.dailyPnlPct = pnlPct;
    if (!d.halted && pnlPct <= -cfg.risk.maxDailyLossPct) {
      const what = budget ? 'the bot is down' : 'the account is down';
      d.halted = { reason: `${what} ${Math.abs(pnlPct).toFixed(2)}% today, the limit is ${cfg.risk.maxDailyLossPct}%`, at: nowMs };
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
      const pos = posBySym.get(sym);
      if (!pos) continue;
      const dir = entry.side === 'buy' ? 1 : -1;
      const score = signals.get(sym)?.score ?? 0;
      const held = minutesBetween(entry.at, nowMs);
      const px = pos.currentPrice;
      let reason = null;
      if (entry.exits === 'bot' && px > 0 && (px - entry.stopLoss) * dir <= 0) reason = `price ${px} reached the stop at ${entry.stopLoss}`;
      else if (entry.exits === 'bot' && px > 0 && (px - entry.takeProfit) * dir >= 0) reason = `price ${px} reached the target at ${entry.takeProfit}`;
      else if (score * dir <= -cfg.signal.exitThreshold) reason = `news turned against the position (score ${score.toFixed(2)})`;
      else if (held >= cfg.risk.maxHoldMinutes) reason = `held ${Math.round(held)} min, the limit is ${cfg.risk.maxHoldMinutes}`;
      if (reason) await this.exit(sym, reason, report);
    }

    // Entries.
    const gate = entryGate({ nowMs, clock, account, state: d, managedCount: Object.keys(d.entries).length, risk: cfg.risk });
    report.gate = gate;
    if (gate.ok) await this.enter({ nowMs, signals, account, budget, posBySym, ordersBySym, report });

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

  async enter({ nowMs, signals, account, budget, posBySym, ordersBySym, report }) {
    const cfg = this.config;
    const d = this.state.data;
    let slots = cfg.risk.maxOpenPositions - Object.keys(d.entries).length;
    let tradesLeft = cfg.risk.maxTradesPerDay - d.tradesToday;

    // Money the bot may still put to work: the account's buying power, and
    // with a budget, whatever of the budget its open positions do not use.
    const base = budget ? budget.usd : account.equity;
    let available = account.buyingPower;
    if (budget) {
      let used = 0;
      for (const [sym, e] of Object.entries(d.entries)) {
        const pos = posBySym.get(sym);
        used += pos ? pos.qty * pos.avgEntryPrice : e.qty * e.refPrice;
      }
      available = Math.min(available, budget.usd - used);
    }

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
      const canFraction = cfg.risk.allowFractional && side === 'buy' && asset.fractionable;
      const { qty, fractional } = sizePosition({ equity: base, buyingPower: available, price, risk: cfg.risk, allowFractional: canFraction });
      if (!(qty > 0)) {
        const why = canFraction ? 'the position would be under the broker\'s $1 minimum'
          : side === 'sell' ? 'a short needs at least one whole share'
          : !cfg.risk.allowFractional ? 'one share costs more than a position may, and fractional shares are off'
          : 'one share costs more than a position may, and this stock cannot be bought in fractions';
        this.skip(report, sym, why);
        continue;
      }
      const { stopLoss, takeProfit } = bracketPrices(price, side, cfg.risk);
      const clientOrderId = `nb-${sym}-${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const top = sig.evidence[0];
      try {
        const order = fractional
          ? await this.broker.submitMarketOrder({ symbol: sym, side, qty, clientOrderId })
          : await this.broker.submitBracketOrder({ symbol: sym, side, qty, takeProfit, stopLoss, clientOrderId });
        d.entries[sym] = {
          symbol: sym, side, qty, at: nowMs, refPrice: price, stopLoss, takeProfit,
          exits: fractional ? 'bot' : 'broker', fractional,
          score: sig.score, orderId: order.id, clientOrderId,
          evidence: sig.evidence.slice(0, 5).map((e) => ({ title: e.title, source: e.source, contribution: e.contribution, url: e.url })),
        };
        d.tradesToday++;
        slots--;
        tradesLeft--;
        available -= qty * price;
        this.lastSkip.delete(sym);
        const verb = side === 'buy' ? 'BUY' : 'SHORT';
        const size = fractional ? `${qty} (about $${(qty * price).toFixed(2)})` : `${qty}`;
        const exits = fractional ? `bot watches stop ${stopLoss} and target ${takeProfit}` : `stop ${stopLoss}, target ${takeProfit}`;
        this.log.event('order', `${verb} ${size} ${sym} near ${price} (${exits}), score ${sig.score.toFixed(2)}: "${top?.title}" [${top?.source}]`,
          { symbol: sym, side, qty, fractional, price, stopLoss, takeProfit, score: sig.score, orderId: order.id, confirmation: conf.reason, evidence: d.entries[sym].evidence });
        report.actions.push({ type: 'enter', symbol: sym, side, qty, fractional, price, stopLoss, takeProfit, score: sig.score });
      } catch (err) {
        this.log.error(`order for ${sym} failed: ${err.message}`);
        report.actions.push({ type: 'order-failed', symbol: sym, error: err.message });
      }
    }
  }

  async exit(sym, reason, report) {
    const d = this.state.data;
    const entry = d.entries[sym];
    try {
      await this.broker.closePosition(sym);
      // Close at market: the P&L shown a moment ago is a close estimate.
      const pnl = this.config.dryRun ? 0 : entry?.lastUnrealizedPl ?? 0;
      d.realizedToday += pnl;
      this.log.event('exit', `closing ${sym}: ${reason} (P&L about $${pnl.toFixed(2)})`, { symbol: sym, reason, entry, pnl });
      delete d.entries[sym];
      d.lastExitAt[sym] = this.now();
      report.actions.push({ type: 'exit', symbol: sym, reason, pnl });
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
    const pnl = report.dailyPnlPct != null ? `; ${report.budget ? 'bot' : 'account'} ${report.dailyPnlPct >= 0 ? '+' : ''}${report.dailyPnlPct.toFixed(2)}% today` : '';
    return `${market}; ${report.newArticles} new article(s); signals: ${top}${gate}${pnl}`;
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
