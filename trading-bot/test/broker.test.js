import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlpacaBroker } from '../src/broker/alpaca.js';
import { DryRunBroker } from '../src/broker/dryrun.js';
import { silentLogger } from '../src/log.js';

function fakeAlpaca(handler) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    const call = { method: opts.method, host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: opts.headers, body: opts.body ? JSON.parse(opts.body) : null };
    calls.push(call);
    const [status, body] = await handler(call, calls.length);
    return { ok: status >= 200 && status < 300, status, headers: new Map(), text: async () => (body == null ? '' : JSON.stringify(body)) };
  };
  return { calls, broker: new AlpacaBroker({ keyId: 'kid', secretKey: 'sec', fetchImpl, wait: async () => {} }) };
}

test('paper mode talks to the paper host with both auth headers', async () => {
  const { calls, broker } = fakeAlpaca(() => [200, { equity: '1000.5', last_equity: '990', buying_power: '2000', cash: '1000', trading_blocked: false, account_blocked: false, shorting_enabled: true, status: 'ACTIVE' }]);
  const a = await broker.getAccount();
  assert.equal(calls[0].host, 'paper-api.alpaca.markets');
  assert.equal(calls[0].headers['APCA-API-KEY-ID'], 'kid');
  assert.equal(calls[0].headers['APCA-API-SECRET-KEY'], 'sec');
  assert.equal(a.equity, 1000.5);
  assert.equal(a.lastEquity, 990);
  assert.equal(a.daytradeCount, null, 'absent from the response');
  const live = new AlpacaBroker({ keyId: 'k', secretKey: 's', mode: 'live' });
  assert.equal(live.tradingHost, 'https://api.alpaca.markets');
});

test('a bracket order is a whole-share market order with string prices and a client id', async () => {
  const { calls, broker } = fakeAlpaca((c) => [200, { id: 'o1', client_order_id: c.body.client_order_id, symbol: 'AAPL', side: 'buy', qty: '10', status: 'accepted', order_class: 'bracket' }]);
  const o = await broker.submitBracketOrder({ symbol: 'AAPL', side: 'buy', qty: 10, takeProfit: 103, stopLoss: 98.5, clientOrderId: 'cid-1' });
  assert.deepEqual(calls[0].body, {
    symbol: 'AAPL', qty: '10', side: 'buy', type: 'market', time_in_force: 'day', order_class: 'bracket',
    take_profit: { limit_price: '103' }, stop_loss: { stop_price: '98.5' }, client_order_id: 'cid-1',
  });
  assert.equal(o.id, 'o1');
  await assert.rejects(broker.submitBracketOrder({ symbol: 'AAPL', side: 'buy', qty: 1.5, takeProfit: 1, stopLoss: 1, clientOrderId: 'x' }), /whole number/);
});

test('reads retry on 429 and 5xx; an order is never resent blindly after a 5xx', async () => {
  const { calls, broker } = fakeAlpaca((c, n) => (n < 3 ? [503, { message: 'busy' }] : [200, { timestamp: '2026-11-18T15:00:00Z', is_open: true, next_open: '2026-11-19T14:30:00Z', next_close: '2026-11-18T21:00:00Z' }]));
  const clock = await broker.getClock();
  assert.equal(clock.isOpen, true);
  assert.equal(calls.length, 3);

  let posts = 0;
  const { broker: b2, calls: c2 } = fakeAlpaca((c) => {
    if (c.method === 'POST') { posts++; return [500, { message: 'internal' }]; }
    return [200, { id: 'o9', client_order_id: 'cid', symbol: 'AAPL', status: 'new' }]; // the lookup finds it
  });
  const o = await b2.submitBracketOrder({ symbol: 'AAPL', side: 'buy', qty: 1, takeProfit: 2, stopLoss: 1, clientOrderId: 'cid' });
  assert.equal(posts, 1);
  assert.equal(o.id, 'o9');
  assert.equal(c2[1].path, '/v2/orders:by_client_order_id');
});

test('closing a position cancels its bracket legs first and tolerates "no position"', async () => {
  const { calls, broker } = fakeAlpaca((c) => {
    if (c.method === 'GET') return [200, [{ id: 'leg1', symbol: 'AAPL' }, { id: 'leg2', symbol: 'AAPL' }, { id: 'other', symbol: 'MSFT' }]];
    if (c.path === '/v2/positions/AAPL') return [404, { message: 'position does not exist' }];
    return [204, null];
  });
  const r = await broker.closePosition('AAPL');
  assert.equal(r, null);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    'GET /v2/orders', 'DELETE /v2/orders/leg1', 'DELETE /v2/orders/leg2', 'DELETE /v2/positions/AAPL',
  ]);
  assert.equal(calls[0].query.status, 'open');
});

test('market data comes from the data host, paginated, oldest bar first', async () => {
  const { calls, broker } = fakeAlpaca((c) => {
    if (c.path === '/v1beta1/news') {
      return c.query.page_token ? [200, { news: [{ id: 2 }], next_page_token: null }] : [200, { news: [{ id: 1 }], next_page_token: 'p2' }];
    }
    return [200, { bars: { AAPL: [{ t: '2026-11-18T14:30:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 100, vw: 1.2, n: 5 }] }, next_page_token: null }];
  });
  const news = await broker.getNews({ symbols: ['AAPL', 'MSFT'], start: '2026-11-18T00:00:00Z' });
  assert.deepEqual(news.map((n) => n.id), [1, 2]);
  assert.equal(calls[0].host, 'data.alpaca.markets');
  assert.equal(calls[0].query.symbols, 'AAPL,MSFT');
  assert.equal(calls[0].query.include_content, 'false');
  const bars = await broker.getBars(['AAPL', 'MSFT'], { start: '2026-11-18T14:30:00Z' });
  assert.equal(bars.AAPL[0].t, Date.UTC(2026, 10, 18, 14, 30));
  assert.deepEqual(bars.MSFT, []);
  assert.equal(calls.at(-1).query.feed, 'iex');
  assert.equal(calls.at(-1).query.timeframe, '1Min');
});

test('dry run reads through and writes nothing', async () => {
  const { calls, broker } = fakeAlpaca(() => [200, []]);
  const dry = new DryRunBroker(broker, silentLogger());
  await dry.getPositions();
  const o = await dry.submitBracketOrder({ symbol: 'AAPL', side: 'buy', qty: 1, takeProfit: 2, stopLoss: 1, clientOrderId: 'c' });
  await dry.closePosition('AAPL');
  await dry.closeAllPositions();
  assert.equal(o.status, 'dry_run');
  assert.deepEqual(calls.map((c) => c.method), ['GET']);
});
