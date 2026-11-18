// Shared fixtures. Times are fixed so tests never depend on the real clock:
// Wednesday 18 November 2026, when New York is on EST (UTC-5).

import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import { memoryState } from '../src/state.js';
import { NewsAnalyzer } from '../src/analysis/analyzer.js';
import { ClaudeAnalyst } from '../src/analysis/claude.js';
import { TradingBot } from '../src/bot.js';
import { SimBroker } from '../src/broker/sim.js';
import { titleKey } from '../src/news/sources.js';

export const OPEN = Date.UTC(2026, 10, 18, 14, 30); // 09:30 New York
export const CLOSE = Date.UTC(2026, 10, 18, 21, 0); // 16:00 New York
export const MIN = 60_000;

export function testConfig(overrides = {}) {
  return loadConfig({
    env: { ANTHROPIC_API_KEY: 'test' },
    configPath: false,
    overrides: { dataDir: null, ...overrides },
  });
}

/** A clock the test can move. */
export function testClock(start = OPEN + 90 * MIN) {
  let t = start;
  const now = () => t;
  now.set = (v) => { t = v; };
  now.advance = (ms) => { t += ms; };
  return now;
}

/**
 * Stands in for the Anthropic client. `judge(headline, symbol)` returns the
 * analysis fields for one pair; every request is recorded.
 */
export function fakeClaudeClient(judge, { stopReason = 'end_turn', model = 'claude-opus-5-5' } = {}) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        async create(params) {
          calls.push(params);
          if (stopReason !== 'end_turn') {
            return { stop_reason: stopReason, stop_details: { category: 'cyber' }, model, content: [] };
          }
          const text = params.messages[0].content;
          const analyses = [];
          for (const m of text.matchAll(/<article id="(a\d+)"[\s\S]*?<symbols>(.*?)<\/symbols>\s*<headline>(.*?)<\/headline>/g)) {
            const [, id, syms, headline] = m;
            for (const s of syms.split(', ').map((x) => x.split(' ')[0])) {
              analyses.push({ article_id: id, symbol: s, novelty: 'new', rationale: 'test', ...judge(headline, s) });
            }
          }
          return { stop_reason: 'end_turn', model, content: [{ type: 'text', text: JSON.stringify({ analyses }) }] };
        },
      },
    },
  };
}

/** A collector that serves whatever articles the test queues. */
export function fakeCollector() {
  const queue = [];
  return {
    queue,
    add(item) {
      queue.push({
        key: `test:${item.title}`, titleKey: titleKey(item.title), sourceId: 'test', sourceName: 'Test Wire',
        trust: 1, summary: '', url: null, ...item,
      });
    },
    sources: () => ({ active: [{ id: 'test' }], skipped: [] }),
    async collect({ isSeen }) {
      const items = queue.filter((i) => !isSeen(i));
      return { items, perSource: { test: items.length }, errors: [], polled: ['test'] };
    },
  };
}

/** Rising one-minute bars from the open to `now`, ending at `last`. */
export function risingBars(now, { start = 100, last = 101, from = OPEN } = {}) {
  const n = Math.max(2, Math.floor((now - from) / MIN));
  return Array.from({ length: n }, (_, i) => {
    const c = start + ((last - start) * i) / (n - 1);
    return { t: from + i * MIN, o: c, h: c, l: c, c, v: 1000, vw: c };
  });
}

export function makeBot({ config = testConfig(), judge = () => ({ direction: 'bullish', impact: 'high', confidence: 0.9 }), now = testClock(), equity = 100_000 } = {}) {
  const log = silentLogger();
  const state = memoryState();
  const broker = new SimBroker({ equity, now });
  broker.clock = { isOpen: true, nextOpen: OPEN + 24 * 60 * MIN, nextClose: CLOSE };
  const collector = fakeCollector();
  const client = fakeClaudeClient(judge);
  const claude = new ClaudeAnalyst({ model: config.analysis.model, effort: config.analysis.effort, watchlist: config.watchlist, client });
  const analyzer = new NewsAnalyzer({ config, state, log, now, claude });
  const bot = new TradingBot({ config, broker, collector, analyzer, state, log, now });
  return { bot, broker, collector, client, state, log, now, config };
}
