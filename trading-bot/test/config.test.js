import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, merge, LIVE_CONFIRM_PHRASE } from '../src/config.js';

const load = (env, overrides) => loadConfig({ env, configPath: false, overrides });

test('defaults to paper trading', () => {
  assert.equal(load({}).mode, 'paper');
});

test('live trading needs the confirmation phrase, except in a dry run', () => {
  assert.throws(() => load({ TRADING_MODE: 'live' }), /LIVE_TRADING_CONFIRM/);
  assert.throws(() => load({ TRADING_MODE: 'live', LIVE_TRADING_CONFIRM: 'yes' }), /LIVE_TRADING_CONFIRM/);
  assert.equal(load({ TRADING_MODE: 'LIVE', LIVE_TRADING_CONFIRM: LIVE_CONFIRM_PHRASE }).mode, 'live');
  assert.equal(load({ TRADING_MODE: 'live' }, { dryRun: true }).mode, 'live');
});

test('rejects unsafe or broken settings', () => {
  assert.throws(() => load({}, { risk: { riskPerTradePct: 10 } }), /riskPerTradePct/);
  assert.throws(() => load({}, { risk: { maxPositionPct: 0 } }), /maxPositionPct/);
  assert.throws(() => load({}, { risk: { flattenMinutesBeforeClose: 40 } }), /flattenMinutesBeforeClose/);
  assert.throws(() => load({}, { watchlist: [] }), /watchlist/);
  assert.throws(() => load({}, { watchlist: [{ symbol: 'aapl' }] }), /symbol/);
  assert.throws(() => load({}, { analysis: { effort: 'extreme' } }), /effort/);
  assert.throws(() => load({ TRADING_MODE: 'yolo' }), /mode/);
});

test('overrides merge deeply; arrays replace', () => {
  const out = merge({ a: { b: 1, c: 2 }, list: [1, 2] }, { a: { c: 3 }, list: [9] });
  assert.deepEqual(out, { a: { b: 1, c: 3 }, list: [9] });
  const cfg = load({}, { risk: { stopLossPct: 2 } });
  assert.equal(cfg.risk.stopLossPct, 2);
  assert.equal(cfg.risk.takeProfitPct, 3, 'untouched siblings keep their defaults');
});

test('secrets come from the environment', () => {
  const cfg = load({ ALPACA_API_KEY_ID: 'a', ALPACA_API_SECRET_KEY: 'b', ANTHROPIC_API_KEY: 'c' });
  assert.equal(cfg.secrets.alpacaKeyId, 'a');
  assert.equal(cfg.secrets.hasAnthropicCredentials, true);
});
