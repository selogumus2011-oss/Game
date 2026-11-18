import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignals, contribution } from '../src/strategy/signals.js';
import { confirmMove } from '../src/strategy/confirm.js';
import { sizePosition, bracketPrices, entryGate, roundPrice, dailyPnlPct } from '../src/strategy/risk.js';
import { keywordAnalysis } from '../src/analysis/keywords.js';
import { sessionOpen, nyDateKey, effectiveNewsTime } from '../src/time.js';
import { testConfig, risingBars, OPEN, CLOSE, MIN } from './helpers.js';

const cfg = testConfig();
const analysis = (over = {}) => ({
  articleKey: 'k1', symbol: 'AAPL', sentiment: 1, impact: 1, confidence: 1, trust: 1,
  novelty: 'new', publishedAt: OPEN + 60 * MIN, title: 't', sourceName: 's', ...over,
});

test('New York time helpers handle the session open across DST', () => {
  assert.equal(sessionOpen(OPEN + 3 * 3600_000), OPEN);
  assert.equal(nyDateKey(Date.UTC(2026, 10, 19, 3, 0)), '2026-11-18', '22:00 New York is still the 18th');
  assert.equal(sessionOpen(Date.UTC(2026, 6, 15, 16, 0)), Date.UTC(2026, 6, 15, 13, 30), 'EDT in July');
});

test('a fresh, certain, high-impact story from a fully trusted source scores 1', () => {
  assert.equal(contribution(analysis(), OPEN + 60 * MIN, cfg.signal), 1);
});

test('freshness halves every half-life and old stories drop out', () => {
  const at = OPEN + 60 * MIN;
  const half = contribution(analysis(), at + cfg.signal.halfLifeMinutes * MIN, cfg.signal);
  assert.ok(Math.abs(half - 0.5) < 1e-9);
  assert.equal(contribution(analysis(), at + (cfg.signal.maxArticleAgeMinutes + 1) * MIN, cfg.signal), 0);
});

test('low confidence, no impact and recaps count for little or nothing', () => {
  const now = OPEN + 60 * MIN;
  assert.equal(contribution(analysis({ confidence: 0.3 }), now, cfg.signal), 0);
  assert.equal(contribution(analysis({ impact: 0 }), now, cfg.signal), 0);
  assert.equal(contribution(analysis({ novelty: 'recap' }), now, cfg.signal), 0.25);
});

test('pre-market news is treated as fresh at the open instead of decaying overnight', () => {
  const lastNight = OPEN - 17 * 3600_000; // 16:30 New York the day before
  assert.equal(effectiveNewsTime(lastNight, OPEN + 5 * MIN, 18), OPEN - 15 * MIN);
  assert.equal(effectiveNewsTime(lastNight, OPEN + 5 * MIN, 0), lastNight);
  assert.equal(effectiveNewsTime(lastNight, OPEN - 60 * MIN, 18), lastNight, 'before the open nothing is moved');
  assert.equal(effectiveNewsTime(OPEN - 20 * 3600_000, OPEN + 5 * MIN, 18), OPEN - 20 * 3600_000, 'older than the carry window');
  // At the first allowed entry (09:35) one strong overnight story clears the threshold on its own.
  const c = contribution(analysis({ publishedAt: lastNight }), OPEN + cfg.risk.skipOpenMinutes * MIN, cfg.signal);
  assert.ok(c > cfg.signal.entryThreshold, `got ${c}`);
  const later = contribution(analysis({ publishedAt: lastNight }), OPEN + 30 * MIN, cfg.signal);
  assert.ok(Math.abs(later - 0.5) < 1e-9, 'then it decays normally');
});

test('signals sum per symbol, net out disagreement and count an article once', () => {
  const now = OPEN + 60 * MIN;
  const list = [
    analysis({ articleKey: 'a' }),
    analysis({ articleKey: 'a' }), // duplicate
    analysis({ articleKey: 'b', sentiment: -1, impact: 0.66 }),
    analysis({ articleKey: 'c', symbol: 'MSFT', sentiment: -1 }),
    analysis({ articleKey: 'd', symbol: 'ZZZZ' }), // not watched
  ];
  const s = computeSignals(list, now, cfg.signal, ['AAPL', 'MSFT']);
  assert.ok(Math.abs(s.get('AAPL').score - 0.34) < 1e-9);
  assert.equal(s.get('AAPL').evidence.length, 2);
  assert.equal(s.get('MSFT').score, -1);
  assert.equal(s.has('ZZZZ'), false);
});

test('keyword fallback reads obvious phrases with capped confidence', () => {
  const item = (title, symbols = ['AAPL']) => ({ key: 'k', title, summary: '', symbols });
  const [up] = keywordAnalysis(item('Apple beats estimates and raises guidance'));
  assert.equal(up.direction, 'bullish');
  assert.equal(up.impactLabel, 'high');
  assert.ok(up.confidence <= 0.55);
  assert.equal(keywordAnalysis(item('Apple misses estimates, cuts outlook'))[0].direction, 'bearish');
  assert.equal(keywordAnalysis(item('Apple hosts an event'))[0].impactLabel, 'none');
  assert.equal(keywordAnalysis(item('Why Apple stock is up today: beats estimates'))[0].novelty, 'recap');
  const two = keywordAnalysis(item('Apple and Microsoft beat estimates', ['AAPL', 'MSFT']));
  assert.equal(two.length, 2);
  assert.ok(two[0].confidence < up.confidence, 'ambiguous between companies');
});

test('position size is set by the stop distance, capped by position size and buying power', () => {
  const risk = { ...cfg.risk, riskPerTradePct: 0.5, stopLossPct: 1.5, maxPositionPct: 10 };
  // $500 risk / ($100 * 1.5%) = 333 shares, but 10% of equity caps it at 100.
  const qty = (o) => sizePosition(o).qty;
  assert.equal(qty({ equity: 100_000, buyingPower: 100_000, price: 100, risk }), 100);
  assert.equal(qty({ equity: 100_000, buyingPower: 100_000, price: 100, risk: { ...risk, maxPositionPct: 100 } }), 333);
  assert.equal(qty({ equity: 100_000, buyingPower: 2_000, price: 100, risk }), 19);
  assert.deepEqual(sizePosition({ equity: 1_000, buyingPower: 1_000, price: 900, risk }), { qty: 0, fractional: false });
});

test('a small budget buys a fractional share, but never under the $1 minimum', () => {
  const risk = { ...cfg.risk, riskPerTradePct: 0.5, stopLossPct: 1.5, maxPositionPct: 10 };
  // A $127 budget allows $12.70 per position: 0.0508 of a $250 share.
  assert.deepEqual(sizePosition({ equity: 127, buyingPower: 50_000, price: 250, risk, allowFractional: true }), { qty: 0.0508, fractional: true });
  assert.equal(sizePosition({ equity: 127, buyingPower: 50_000, price: 250, risk }).qty, 0, 'fractions off');
  assert.equal(sizePosition({ equity: 5, buyingPower: 5, price: 250, risk, allowFractional: true }).qty, 0, '$0.50 is under the minimum');
  assert.deepEqual(sizePosition({ equity: 127, buyingPower: 50_000, price: 10, risk, allowFractional: true }), { qty: 1, fractional: false }, 'whole shares when one fits');
});

test('bracket prices sit on the right side and on a valid tick', () => {
  const r = { ...cfg.risk, stopLossPct: 1.5, takeProfitPct: 3 };
  assert.deepEqual(bracketPrices(100, 'buy', r), { stopLoss: 98.5, takeProfit: 103 });
  assert.deepEqual(bracketPrices(100, 'sell', r), { stopLoss: 101.5, takeProfit: 97 });
  const odd = bracketPrices(123.456, 'buy', r);
  assert.equal(odd.stopLoss, 121.6);
  assert.equal(odd.takeProfit, 127.16);
  assert.equal(roundPrice(0.123456), 0.1235);
  const tiny = bracketPrices(1, 'buy', { ...r, stopLossPct: 0.1, takeProfitPct: 0.1 });
  assert.ok(tiny.stopLoss <= 0.99 && tiny.takeProfit >= 1.01, 'at least a tick away');
});

test('the entry gate enforces hours, limits, halts and day-trade counters', () => {
  const base = {
    nowMs: OPEN + 60 * MIN,
    clock: { isOpen: true, nextClose: CLOSE },
    account: { equity: 100_000, tradingBlocked: false, accountBlocked: false, daytradeCount: null },
    state: { halted: null, tradesToday: 0 },
    managedCount: 0,
    risk: cfg.risk,
  };
  assert.equal(entryGate(base).ok, true);
  assert.match(entryGate({ ...base, clock: { isOpen: false } }).reason, /closed/);
  assert.match(entryGate({ ...base, nowMs: OPEN + 2 * MIN }).reason, /after the open/);
  assert.match(entryGate({ ...base, nowMs: CLOSE - 20 * MIN }).reason, /of the close/);
  assert.match(entryGate({ ...base, managedCount: cfg.risk.maxOpenPositions }).reason, /already holding/);
  assert.match(entryGate({ ...base, state: { halted: { reason: 'x' }, tradesToday: 0 } }).reason, /halted/);
  assert.match(entryGate({ ...base, state: { halted: null, tradesToday: cfg.risk.maxTradesPerDay } }).reason, /trades today/);
  assert.match(entryGate({ ...base, account: { ...base.account, equity: 20_000, daytradeCount: 3 } }).reason, /pattern-day-trader/);
  assert.equal(entryGate({ ...base, account: { ...base.account, equity: 30_000, daytradeCount: 3 } }).ok, true);
  assert.match(entryGate({ ...base, account: { ...base.account, tradingBlocked: true } }).reason, /blocked/);
});

test('daily P&L is measured against the previous close', () => {
  assert.equal(dailyPnlPct({ equity: 98_000, lastEquity: 100_000 }), -2);
  assert.equal(dailyPnlPct({ equity: 1, lastEquity: 0 }), 0);
});

test('price confirmation wants a move with the news, not too big, on the right side of VWAP', () => {
  const now = OPEN + 60 * MIN;
  const c = cfg.confirmation;
  assert.equal(confirmMove(risingBars(now, { start: 100, last: 101 }), 1, c).ok, true);
  assert.match(confirmMove(risingBars(now, { start: 100, last: 101 }), -1, c).reason, /not moved with the news/);
  assert.match(confirmMove(risingBars(now, { start: 100, last: 100 }), 1, c).reason, /not moved/);
  const spike = risingBars(now, { start: 100, last: 101 });
  spike.push({ ...spike.at(-1), t: spike.at(-1).t + MIN, c: 106, h: 106, l: 106, vw: 106 });
  assert.match(confirmMove(spike, 1, c).reason, /chase limit/);
  assert.match(confirmMove(risingBars(now, { start: 100, last: 101 }), 1, c, 94).reason, /yesterday's close/);
  assert.match(confirmMove(risingBars(OPEN + 3 * MIN), 1, c).reason, /not enough price data/);
  // Up over the last 15 minutes but still below the session's average price.
  const fade = [...risingBars(now - 20 * MIN, { start: 110, last: 110 }), ...risingBars(now, { start: 100, last: 101, from: now - 20 * MIN })];
  assert.match(confirmMove(fade, 1, c).reason, /VWAP/);
});
