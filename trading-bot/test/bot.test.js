// The whole loop against the simulated broker: news in, orders out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBot, testConfig, testClock, risingBars, OPEN, CLOSE, MIN } from './helpers.js';
import { DryRunBroker } from '../src/broker/dryrun.js';
import { silentLogger } from '../src/log.js';

const bullish = () => ({ direction: 'bullish', impact: 'high', confidence: 0.9 });

function setup(opts = {}) {
  const ctx = makeBot(opts);
  const t = ctx.now();
  ctx.broker.setBars('AAPL', risingBars(t, { start: 100, last: 101 }));
  ctx.broker.dailyBars.AAPL = [{ t: OPEN - 24 * 60 * MIN, o: 99, h: 100, l: 98, c: 100, v: 1e6 }];
  return ctx;
}

const news = (ctx, title, symbols = ['AAPL'], ageMin = 5) => ctx.collector.add({ title, symbols, publishedAt: ctx.now() - ageMin * MIN });

test('strong news with a confirming price buys a bracket order sized to the risk limits', async () => {
  const ctx = setup({ judge: bullish });
  news(ctx, 'Apple raises full-year guidance');
  const report = await ctx.bot.tick();
  assert.equal(ctx.broker.submitted.length, 1);
  const o = ctx.broker.submitted[0];
  assert.equal(o.symbol, 'AAPL');
  assert.equal(o.side, 'buy');
  // 10% of $100k at $101 = 99 shares; the risk cap ($500 / $1.515) is 330.
  assert.equal(o.qty, 99);
  assert.equal(o.stopLoss, 99.49);
  assert.equal(o.takeProfit, 104.03);
  assert.equal(report.actions[0].type, 'enter');
  assert.equal(ctx.state.data.tradesToday, 1);
  assert.ok(ctx.state.data.entries.AAPL);
  assert.ok(ctx.log.events.some((e) => e.type === 'order' && e.message.includes('Apple raises')));
});

test('an article is analysed once, however many ticks see it', async () => {
  const ctx = setup({ judge: bullish });
  news(ctx, 'Apple raises full-year guidance');
  await ctx.bot.tick();
  ctx.now.advance(MIN);
  await ctx.bot.tick();
  assert.equal(ctx.client.calls.length, 1);
  assert.equal(ctx.broker.submitted.length, 1, 'and it does not buy twice');
});

test('no trade when the price is not following the news', async () => {
  const ctx = setup({ judge: bullish });
  ctx.broker.setBars('AAPL', risingBars(ctx.now(), { start: 101, last: 100 }));
  news(ctx, 'Apple raises full-year guidance');
  const report = await ctx.bot.tick();
  assert.equal(ctx.broker.submitted.length, 0);
  assert.match(report.skipped[0].reason, /not moved with the news/);
});

test('weak or old news does not trade', async () => {
  const ctx = setup({ judge: () => ({ direction: 'bullish', impact: 'low', confidence: 0.9 }) });
  news(ctx, 'Apple opens a new store');
  await ctx.bot.tick();
  assert.equal(ctx.broker.submitted.length, 0);

  const ctx2 = setup({ judge: bullish });
  news(ctx2, 'Apple raises guidance', ['AAPL'], 200);
  await ctx2.bot.tick();
  assert.equal(ctx2.broker.submitted.length, 0);
});

test('bearish news does not short unless shorting is enabled', async () => {
  const bearish = () => ({ direction: 'bearish', impact: 'high', confidence: 0.9 });
  const ctx = setup({ judge: bearish });
  ctx.broker.setBars('AAPL', risingBars(ctx.now(), { start: 101, last: 100 }));
  news(ctx, 'Apple cuts guidance');
  const r = await ctx.bot.tick();
  assert.equal(ctx.broker.submitted.length, 0);
  assert.match(r.skipped[0].reason, /short selling is off/);

  const ctx2 = setup({ judge: bearish, config: testConfig({ risk: { allowShort: true } }) });
  ctx2.broker.setBars('AAPL', risingBars(ctx2.now(), { start: 101, last: 100 }));
  news(ctx2, 'Apple cuts guidance');
  await ctx2.bot.tick();
  assert.equal(ctx2.broker.submitted[0].side, 'sell');
  assert.ok(ctx2.broker.submitted[0].stopLoss > 100);
});

test('positions the bot did not open are never traded or closed', async () => {
  const ctx = setup({ judge: bullish });
  ctx.broker.positions.set('AAPL', { symbol: 'AAPL', qty: 5, side: 'long', avgEntryPrice: 90 });
  news(ctx, 'Apple raises guidance');
  const r = await ctx.bot.tick();
  assert.equal(ctx.broker.submitted.length, 0);
  assert.match(r.skipped[0].reason, /did not open/);
  ctx.now.set(CLOSE - 5 * MIN);
  await ctx.bot.tick();
  assert.ok(ctx.broker.positions.has('AAPL'), 'end-of-day flatten leaves it alone');
});

test('everything the bot opened is closed before the bell', async () => {
  const ctx = setup({ judge: bullish });
  ctx.broker.setBars('MSFT', risingBars(ctx.now(), { start: 200, last: 202 }));
  ctx.broker.positions.set('NFLX', { symbol: 'NFLX', qty: 3, side: 'long', avgEntryPrice: 90 });
  ctx.broker.setBars('NFLX', risingBars(ctx.now(), { start: 90, last: 90 }));
  news(ctx, 'Apple raises guidance');
  news(ctx, 'Microsoft wins record cloud contract', ['MSFT']);
  await ctx.bot.tick();
  assert.equal(ctx.broker.positions.size, 3);
  ctx.now.set(CLOSE - ctx.config.risk.flattenMinutesBeforeClose * MIN);
  const r = await ctx.bot.tick();
  assert.deepEqual([...ctx.broker.positions.keys()], ['NFLX']);
  assert.equal(r.actions.filter((a) => a.type === 'exit').length, 2);
  assert.deepEqual(ctx.state.data.entries, {});
});

test('the daily loss limit halts trading and closes the bot\'s positions', async () => {
  const ctx = setup({ judge: bullish });
  news(ctx, 'Apple raises guidance');
  await ctx.bot.tick();
  assert.equal(ctx.broker.positions.size, 1);
  ctx.broker.lastEquity = 100_000;
  ctx.broker.cash -= 3_000; // the account is down 3% on the day
  ctx.now.advance(MIN);
  const r = await ctx.bot.tick();
  assert.ok(ctx.state.data.halted);
  assert.equal(ctx.broker.positions.size, 0);
  assert.match(r.gate.reason, /halted/);
  news(ctx, 'Microsoft beats estimates', ['MSFT']);
  ctx.broker.setBars('MSFT', risingBars(ctx.now(), { start: 200, last: 202 }));
  ctx.now.advance(MIN);
  await ctx.bot.tick();
  assert.equal(ctx.broker.submitted.length, 1, 'no new entries while halted');
  ctx.now.set(OPEN + 24 * 60 * MIN + 60 * MIN); // next day
  ctx.broker.lastEquity = await ctx.broker.getAccount().then((a) => a.equity);
  await ctx.bot.tick();
  assert.equal(ctx.state.data.halted, null, 'the halt lifts the next day');
});

test('a stop-loss fill at the broker is noticed, and the symbol cools down', async () => {
  const ctx = setup({ judge: bullish });
  news(ctx, 'Apple raises guidance');
  await ctx.bot.tick();
  ctx.broker.pushPrice('AAPL', 99); // through the 99.49 stop
  assert.equal(ctx.broker.closed[0].reason, 'stop');
  ctx.now.advance(MIN);
  ctx.broker.pushPrice('AAPL', 101.5);
  news(ctx, 'Apple announces a buyback');
  const r = await ctx.bot.tick();
  assert.equal(r.actions[0].type, 'closed-by-broker');
  assert.equal(ctx.broker.submitted.length, 1);
  assert.match(r.skipped.find((s) => s.symbol === 'AAPL').reason, /cooling down/);
});

test('a position is closed when the news turns against it', async () => {
  let mood = 'bullish';
  const ctx = setup({ judge: () => ({ direction: mood, impact: 'high', confidence: 0.9 }) });
  news(ctx, 'Apple raises guidance');
  await ctx.bot.tick();
  mood = 'bearish';
  news(ctx, 'Apple faces an antitrust ruling');
  news(ctx, 'Apple supplier halts production');
  ctx.now.advance(MIN);
  const r = await ctx.bot.tick();
  const exit = r.actions.find((a) => a.type === 'exit');
  assert.match(exit.reason, /turned against/);
  assert.equal(ctx.broker.positions.size, 0);
});

test('a position is closed after the maximum holding time', async () => {
  const ctx = setup({ judge: bullish, config: testConfig({ signal: { halfLifeMinutes: 1000, maxArticleAgeMinutes: 1000 } }) });
  news(ctx, 'Apple raises guidance');
  await ctx.bot.tick();
  ctx.now.advance((ctx.config.risk.maxHoldMinutes + 1) * MIN);
  ctx.broker.setBars('AAPL', risingBars(ctx.now(), { start: 100, last: 101 }));
  const r = await ctx.bot.tick();
  assert.match(r.actions.find((a) => a.type === 'exit').reason, /held/);
});

test('respects the open-position and daily trade limits', async () => {
  const config = testConfig({ risk: { maxOpenPositions: 2 } });
  const ctx = setup({ judge: bullish, config });
  for (const [sym, name] of [['MSFT', 'Microsoft'], ['NVDA', 'Nvidia'], ['AMZN', 'Amazon']]) {
    ctx.broker.setBars(sym, risingBars(ctx.now(), { start: 100, last: 101 }));
    news(ctx, `${name} raises guidance`, [sym]);
  }
  news(ctx, 'Apple raises guidance');
  await ctx.bot.tick();
  assert.equal(ctx.broker.submitted.length, 2);
});

test('nothing is traded while the market is closed, but news is still read', async () => {
  const ctx = setup({ judge: bullish });
  ctx.broker.clock.isOpen = false;
  news(ctx, 'Apple raises guidance');
  const r = await ctx.bot.tick();
  assert.equal(r.marketOpen, false);
  assert.equal(ctx.broker.submitted.length, 0);
  assert.equal(ctx.client.calls.length, 1);
});

test('the first minutes after the open are skipped', async () => {
  const now = testClock(OPEN + 2 * MIN);
  const ctx = setup({ judge: bullish, now });
  news(ctx, 'Apple raises guidance');
  const r = await ctx.bot.tick();
  assert.equal(ctx.broker.submitted.length, 0);
  assert.match(r.gate.reason, /after the open/);
});

test('dry run makes the same decision without placing the order', async () => {
  const ctx = setup({ judge: bullish, config: testConfig({ dryRun: true }) });
  const log = silentLogger();
  ctx.bot.broker = new DryRunBroker(ctx.broker, log);
  news(ctx, 'Apple raises guidance');
  const r = await ctx.bot.tick();
  assert.equal(r.actions[0].type, 'enter');
  assert.equal(ctx.broker.submitted.length, 0);
  assert.match(log.events[0].message, /would buy 99 AAPL/);
});

test('signals-only mode (no broker) still scores the news', async () => {
  const ctx = setup({ judge: bullish });
  ctx.bot.broker = null;
  news(ctx, 'Apple raises guidance');
  const r = await ctx.bot.tick();
  assert.equal(r.marketOpen, null);
  assert.equal(r.signals[0].symbol, 'AAPL');
  assert.ok(r.signals[0].score > 0.6);
});
