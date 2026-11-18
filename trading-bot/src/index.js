#!/usr/bin/env node
// Command-line entry point. Run `node src/index.js help` for usage.

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, hasBrokerKeys, ConfigError, LIVE_CONFIRM_PHRASE } from './config.js';
import { createLogger } from './log.js';
import { StateStore } from './state.js';
import { AlpacaBroker } from './broker/alpaca.js';
import { DryRunBroker } from './broker/dryrun.js';
import { NewsCollector, describeError } from './news/sources.js';
import { NewsAnalyzer } from './analysis/analyzer.js';
import { TradingBot } from './bot.js';
import { rankSignals, computeSignals } from './strategy/signals.js';
import { dailyPnlPct } from './strategy/risk.js';

const HELP = `news-trading-bot

Usage: node src/index.js <command> [options]

Commands
  run             trade continuously (Ctrl+C to stop)
  once            run a single tick and exit
  signals         read and score the news now, print signals, place nothing
  status          show account, bot positions and open orders
  check-sources   fetch every news source once and report what came back
  flatten         close the positions the bot opened
  help            show this text

Options
  --dry-run       read live data but place no orders (run, once)
  --config FILE   JSON file of setting overrides
  --all --yes     with flatten: close EVERY position in the account

Environment: see .env.example. Paper trading unless TRADING_MODE=live and
LIVE_TRADING_CONFIRM=${LIVE_CONFIRM_PHRASE}.`;

function parseArgs(argv) {
  const args = { command: argv[0] || 'help', flags: new Set(), config: null };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--config') args.config = argv[++i];
    else if (argv[i].startsWith('--')) args.flags.add(argv[i].slice(2));
    else throw new ConfigError(`unexpected argument "${argv[i]}"`);
  }
  return args;
}

function makeBroker(config) {
  if (!hasBrokerKeys(config)) return null;
  return new AlpacaBroker({
    keyId: config.secrets.alpacaKeyId,
    secretKey: config.secrets.alpacaSecretKey,
    mode: config.mode,
    feed: config.confirmation.feed,
  });
}

function requireBroker(broker, what) {
  if (!broker) {
    throw new ConfigError(`${what} needs Alpaca API keys. Set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (see .env.example).`);
  }
  return broker;
}

/** One bot per data directory, so two copies cannot double-trade an account. */
function acquireLock(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'bot.lock');
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* not running */ }
    if (alive && pid !== process.pid) throw new ConfigError(`another bot (pid ${pid}) is already running from ${dataDir}`);
  }
  writeFileSync(file, String(process.pid));
  return () => { try { unlinkSync(file); } catch { /* already gone */ } };
}

const money = (x) => (x == null ? '-' : `$${Number(x).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

function printSignals(signals, limit = 10) {
  const ranked = rankSignals(signals).filter((s) => s.score !== 0);
  if (ranked.length === 0) {
    console.log('\nNo signals: nothing price-relevant in the recent news for the watchlist.');
    return;
  }
  console.log('\nSignals (entry needs |score| at or above the threshold, and price confirmation)');
  for (const s of ranked.slice(0, limit)) {
    console.log(`\n  ${s.symbol.padEnd(6)} ${s.score >= 0 ? '+' : ''}${s.score.toFixed(2)}  from ${s.evidence.length} item(s)`);
    for (const e of s.evidence.slice(0, 3)) {
      console.log(`      ${e.contribution >= 0 ? '+' : ''}${e.contribution.toFixed(2)}  ${e.direction}/${e.impact} c=${e.confidence.toFixed(2)} [${e.source}] ${e.title}`);
      if (e.rationale) console.log(`             ${e.rationale}`);
    }
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.command === 'help' || args.flags.has('help')) {
    console.log(HELP);
    return 0;
  }
  const dryRun = args.flags.has('dry-run');
  const config = loadConfig({ configPath: args.config, overrides: { dryRun } });
  const log = createLogger({ dataDir: config.dataDir });
  const realBroker = makeBroker(config);
  const broker = realBroker && dryRun ? new DryRunBroker(realBroker, log) : realBroker;

  const build = (stateFile) => {
    const state = stateFile ? new StateStore(join(config.dataDir, stateFile)).load() : StateStore.forDir(config.dataDir, { dryRun }).load();
    const collector = new NewsCollector({ config, broker: realBroker, log });
    const analyzer = new NewsAnalyzer({ config, state, log });
    return { state, collector, analyzer };
  };

  switch (args.command) {
    case 'run':
    case 'once': {
      requireBroker(broker, `"${args.command}"`);
      const release = acquireLock(config.dataDir);
      try {
        const { state, collector, analyzer } = build();
        const bot = new TradingBot({ config, broker, collector, analyzer, state, log });
        const account = await broker.getAccount();
        log.info(`mode: ${broker.mode}${config.mode === 'live' && !dryRun ? ' (REAL MONEY)' : ''}; equity ${money(account.equity)}; analysis: ${analyzer.method}`);
        log.info(`watchlist: ${bot.symbols.join(' ')}; news sources: ${collector.sources().active.map((s) => s.id).join(', ')}`);
        const cap = config.risk.capital;
        log.info(cap
          ? `trading budget: ${cap.amount} ${cap.currency} of the account, not the whole balance${config.risk.allowFractional ? '; fractional shares on' : ''}`
          : 'trading budget: the whole account (set BOT_CAPITAL to use less)');
        if (!config.secrets.hasAnthropicCredentials && config.analysis.provider === 'auto') {
          log.warn('ANTHROPIC_API_KEY is not set: using the keyword scorer, which rarely reaches the entry threshold');
        }
        if (args.command === 'once') {
          const report = await bot.tick();
          log.info(bot.summarize(report));
          printSignals(computeSignals(state.data.analyses, Date.now(), config.signal, bot.symbols));
          return 0;
        }
        const controller = new AbortController();
        const stop = () => {
          if (controller.signal.aborted) process.exit(130);
          const frac = Object.values(state.data.entries).filter((e) => e.exits === 'bot').map((e) => e.symbol);
          log.info('stopping after the current tick (press Ctrl+C again to quit now). Open bracket orders stay in place at the broker.');
          if (frac.length) log.warn(`${frac.join(', ')}: fractional, so no stop at the broker while the bot is off. Run "npm run flatten" if you will not restart it today.`);
          controller.abort();
        };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        await bot.run({ signal: controller.signal });
        return 0;
      } finally {
        release();
      }
    }

    case 'signals': {
      const { state, collector, analyzer } = build('state.signals.json');
      const bot = new TradingBot({ config, broker: null, collector, analyzer, state, log });
      console.log(`Analysis: ${analyzer.method}. Sources: ${collector.sources().active.map((s) => s.id).join(', ')}`);
      const report = await bot.tick();
      console.log(`${report.newArticles} new article(s) about the watchlist.`);
      printSignals(computeSignals(state.data.analyses, Date.now(), config.signal, bot.symbols));
      return 0;
    }

    case 'status': {
      requireBroker(broker, '"status"');
      const state = StateStore.forDir(config.dataDir, { dryRun }).load();
      const [account, clock, positions, orders] = await Promise.all([
        broker.getAccount(), broker.getClock(), broker.getPositions(), broker.getOpenOrders(),
      ]);
      console.log(`Mode: ${broker.mode}`);
      console.log(`Market: ${clock.isOpen ? `open, closes ${new Date(clock.nextClose).toLocaleString()}` : `closed, opens ${new Date(clock.nextOpen).toLocaleString()}`}`);
      console.log(`Equity ${money(account.equity)}, buying power ${money(account.buyingPower)}, today ${dailyPnlPct(account).toFixed(2)}%`);
      if (account.daytradeCount != null) console.log(`Day trades in the last 5 days: ${account.daytradeCount}`);
      const b = state.data.budget;
      if (config.risk.capital) {
        const cap = config.risk.capital;
        console.log(`Bot budget: ${cap.amount} ${cap.currency}${b?.usd ? ` (about $${b.usd} at ${b.rate})` : ''}; closed-trade P&L today $${(state.data.realizedToday || 0).toFixed(2)}`);
      }
      console.log(`Bot trades today: ${state.data.day === null ? 0 : state.data.tradesToday}${state.data.halted ? `; HALTED: ${state.data.halted.reason}` : ''}`);
      const managed = new Set(Object.keys(state.data.entries));
      console.log('\nPositions');
      if (positions.length === 0) console.log('  none');
      for (const p of positions) {
        const e = state.data.entries[p.symbol];
        const tag = !e ? 'yours, untouched' : e.exits === 'bot' ? `bot; it watches stop ${e.stopLoss} and target ${e.takeProfit}` : 'bot; bracket at the broker';
        console.log(`  ${p.symbol.padEnd(6)} ${p.side} ${p.qty} @ ${p.avgEntryPrice} now ${p.currentPrice} P/L ${money(p.unrealizedPl)} (${tag})`);
      }
      console.log('\nOpen orders');
      if (orders.length === 0) console.log('  none');
      for (const o of orders) console.log(`  ${o.symbol.padEnd(6)} ${o.side} ${o.qty} ${o.type} ${o.status}`);
      return 0;
    }

    case 'check-sources': {
      const collector = new NewsCollector({ config, broker: realBroker, log });
      const { active, skipped } = collector.sources();
      const since = Date.now() - 24 * 60 * 60_000;
      for (const src of active) {
        try {
          const items = await collector.fetchSource(src, { sinceMs: since });
          const relevant = items.filter((i) => i.symbols.length > 0);
          console.log(`OK    ${src.id.padEnd(14)} ${items.length} item(s), ${relevant.length} about the watchlist${relevant[0] ? `; e.g. "${relevant[0].title}"` : ''}`);
        } catch (err) {
          console.log(`FAIL  ${src.id.padEnd(14)} ${describeError(err)}`);
        }
      }
      for (const { src, reason } of skipped) console.log(`OFF   ${src.id.padEnd(14)} ${reason}`);
      return 0;
    }

    case 'flatten': {
      requireBroker(broker, '"flatten"');
      if (args.flags.has('all')) {
        if (!args.flags.has('yes')) throw new ConfigError('flatten --all closes EVERY position in the account, including ones the bot did not open. Add --yes to confirm.');
        await broker.closeAllPositions();
        log.event('flatten', 'closed every position and cancelled every order in the account');
        return 0;
      }
      const state = StateStore.forDir(config.dataDir, { dryRun }).load();
      const syms = Object.keys(state.data.entries);
      if (syms.length === 0) console.log('The bot has no open positions.');
      for (const sym of syms) {
        await broker.closePosition(sym);
        delete state.data.entries[sym];
        state.data.lastExitAt[sym] = Date.now();
        log.event('exit', `closing ${sym}: manual flatten`);
      }
      state.save();
      return 0;
    }

    default:
      throw new ConfigError(`unknown command "${args.command}". Run "node src/index.js help".`);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof ConfigError ? `Error: ${err.message}` : err.stack || err.message);
    process.exit(err instanceof ConfigError ? 2 : 1);
  },
);
