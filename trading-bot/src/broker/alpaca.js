// A thin client for the parts of Alpaca's REST API the bot uses. Endpoint
// paths and field names follow Alpaca's published OpenAPI spec (checked
// against @alpacahq/alpaca-trade-api 5.0.0).

import { sleep } from '../time.js';

const TRADING_HOST = { paper: 'https://paper-api.alpaca.markets', live: 'https://api.alpaca.markets' };
const DATA_HOST = 'https://data.alpaca.markets';

export class AlpacaError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const num = (v) => (v == null || v === '' ? null : Number(v));

export function normalizeBar(b) {
  return { t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw ?? null };
}

export class AlpacaBroker {
  constructor({ keyId, secretKey, mode = 'paper', feed = 'iex', fetchImpl = globalThis.fetch, timeoutMs = 15000, retries = 3, wait = sleep }) {
    if (!TRADING_HOST[mode]) throw new Error(`unknown Alpaca mode "${mode}"`);
    this.keyId = keyId;
    this.secretKey = secretKey;
    this.mode = mode;
    this.feed = feed;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.wait = wait;
    this.tradingHost = TRADING_HOST[mode];
  }

  get canReadData() { return Boolean(this.keyId && this.secretKey); }
  get canTrade() { return this.canReadData; }

  async request(host, method, path, { query, body, retryable = method !== 'POST' } = {}) {
    const url = new URL(path, host);
    for (const [k, v] of Object.entries(query || {})) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers: {
            'APCA-API-KEY-ID': this.keyId,
            'APCA-API-SECRET-KEY': this.secretKey,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (retryable && attempt < this.retries) { await this.wait(500 * 2 ** attempt); continue; }
        throw new AlpacaError(0, `network error on ${method} ${url.pathname}: ${err.message}`);
      }
      // 429 means the request was not processed, so even an order may be retried.
      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt < this.retries && (retryable || res.status === 429)) {
        const after = Number(res.headers?.get?.('retry-after'));
        await this.wait(Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      if (!res.ok) {
        const msg = (data && typeof data === 'object' && data.message) || (typeof data === 'string' && data) || `HTTP ${res.status}`;
        throw new AlpacaError(res.status, `Alpaca ${method} ${url.pathname} failed (${res.status}): ${msg}`, data);
      }
      return data;
    }
  }

  trading(method, path, opts) { return this.request(this.tradingHost, method, path, opts); }
  data(path, query) { return this.request(DATA_HOST, 'GET', path, { query }); }

  // --- account and market state ---------------------------------------------

  async getAccount() {
    const a = await this.trading('GET', '/v2/account');
    return {
      equity: num(a.equity),
      lastEquity: num(a.last_equity),
      buyingPower: num(a.buying_power),
      cash: num(a.cash),
      status: a.status,
      tradingBlocked: Boolean(a.trading_blocked),
      accountBlocked: Boolean(a.account_blocked),
      shortingEnabled: Boolean(a.shorting_enabled),
      // Not in every account response; null means "the broker did not say".
      daytradeCount: a.daytrade_count != null ? num(a.daytrade_count) : null,
      patternDayTrader: a.pattern_day_trader ?? null,
    };
  }

  async getClock() {
    const c = await this.trading('GET', '/v2/clock');
    return { timestamp: Date.parse(c.timestamp), isOpen: Boolean(c.is_open), nextOpen: Date.parse(c.next_open), nextClose: Date.parse(c.next_close) };
  }

  async getPositions() {
    const list = await this.trading('GET', '/v2/positions');
    return list.map((p) => ({
      symbol: p.symbol,
      qty: Math.abs(num(p.qty)),
      side: p.side,
      avgEntryPrice: num(p.avg_entry_price),
      currentPrice: num(p.current_price),
      marketValue: num(p.market_value),
      unrealizedPl: num(p.unrealized_pl),
    }));
  }

  /** Open orders, with bracket legs listed as separate orders. */
  async getOpenOrders() {
    const list = await this.trading('GET', '/v2/orders', { query: { status: 'open', limit: 500, nested: false } });
    return list.map(normalizeOrder);
  }

  async getAsset(symbol) {
    const a = await this.trading('GET', `/v2/assets/${encodeURIComponent(symbol)}`);
    return { symbol: a.symbol, tradable: Boolean(a.tradable), shortable: Boolean(a.shortable), easyToBorrow: a.easy_to_borrow ?? null, fractionable: Boolean(a.fractionable) };
  }

  async getOrderByClientId(clientOrderId) {
    try {
      return normalizeOrder(await this.trading('GET', '/v2/orders:by_client_order_id', { query: { client_order_id: clientOrderId } }));
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  // --- orders ------------------------------------------------------------------

  /** Submit an order; on an ambiguous failure, check whether it went in anyway. */
  async postOrder(body) {
    try {
      return normalizeOrder(await this.trading('POST', '/v2/orders', { body }));
    } catch (err) {
      // A timeout or 5xx leaves us unsure whether the order went in. The
      // client order id is unique, so ask before reporting failure.
      if (err.status === 0 || err.status >= 500) {
        const existing = await this.getOrderByClientId(body.client_order_id).catch(() => null);
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * A market entry with an attached take-profit limit and stop-loss stop.
   * Both exits live at the broker, so they still protect the position if the
   * bot crashes. Bracket orders need whole shares.
   */
  async submitBracketOrder({ symbol, side, qty, takeProfit, stopLoss, clientOrderId }) {
    if (!Number.isInteger(qty) || qty < 1) throw new Error(`bracket orders need a whole number of shares, got ${qty}`);
    return this.postOrder({
      symbol,
      qty: String(qty),
      side,
      type: 'market',
      time_in_force: 'day',
      order_class: 'bracket',
      take_profit: { limit_price: String(takeProfit) },
      stop_loss: { stop_price: String(stopLoss) },
      client_order_id: clientOrderId,
    });
  }

  /** A plain market order, used for fractional quantities (day orders only). */
  async submitMarketOrder({ symbol, side, qty, clientOrderId }) {
    if (!(qty > 0)) throw new Error(`order quantity must be positive, got ${qty}`);
    return this.postOrder({
      symbol,
      qty: formatQty(qty),
      side,
      type: 'market',
      time_in_force: 'day',
      client_order_id: clientOrderId,
    });
  }

  /** Filled and cancelled orders for a symbol since `after`, oldest first. */
  async getClosedOrders({ symbol, after }) {
    const list = await this.trading('GET', '/v2/orders', {
      query: { status: 'closed', symbols: symbol, after: new Date(after).toISOString(), direction: 'asc', limit: 100, nested: false },
    });
    return list.map(normalizeOrder);
  }

  async cancelOrder(id) {
    try {
      await this.trading('DELETE', `/v2/orders/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err.status === 404 || err.status === 422) return; // already filled or cancelled
      throw err;
    }
  }

  /**
   * Cancel the symbol's open orders (its bracket legs hold the shares), then
   * close the position at market. Returns null when there was no position.
   */
  async closePosition(symbol) {
    const orders = (await this.getOpenOrders()).filter((o) => o.symbol === symbol);
    for (const o of orders) await this.cancelOrder(o.id);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.trading('DELETE', `/v2/positions/${encodeURIComponent(symbol)}`);
      } catch (err) {
        if (err.status === 404) return null;
        // Cancels settle asynchronously; until they do the shares are "held".
        if ((err.status === 403 || err.status === 422) && attempt < 4) { await this.wait(750 * (attempt + 1)); continue; }
        throw err;
      }
    }
  }

  /** Close every position in the account and cancel every order. */
  async closeAllPositions() {
    return this.trading('DELETE', '/v2/positions', { query: { cancel_orders: true } });
  }

  // --- market data -------------------------------------------------------------

  async getNews({ symbols, start, limit = 50, maxPages = 3 }) {
    const out = [];
    let pageToken;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.data('/v1beta1/news', {
        symbols: symbols.join(','), start, limit, sort: 'desc', include_content: false, page_token: pageToken,
      });
      out.push(...(res.news || []));
      pageToken = res.next_page_token;
      if (!pageToken) break;
    }
    return out;
  }

  /** @returns {Promise<Record<string, ReturnType<normalizeBar>[]>>} oldest first */
  async getBars(symbols, { start, end, timeframe = '1Min', maxPages = 10 } = {}) {
    const out = Object.fromEntries(symbols.map((s) => [s, []]));
    if (symbols.length === 0) return out;
    let pageToken;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.data('/v2/stocks/bars', {
        symbols: symbols.join(','), timeframe, start, end, limit: 10000, feed: this.feed,
        adjustment: 'raw', sort: 'asc', page_token: pageToken,
      });
      for (const [sym, bars] of Object.entries(res.bars || {})) {
        (out[sym] ||= []).push(...bars.map(normalizeBar));
      }
      pageToken = res.next_page_token;
      if (!pageToken) break;
    }
    return out;
  }

  /** Mid-market rate for a pair such as "GBPUSD": dollars per pound. */
  async getFxRate(pair) {
    const res = await this.data('/v1beta1/forex/latest/rates', { currency_pairs: pair });
    const r = res?.rates?.[pair];
    const mid = r?.mp ?? (r?.bp > 0 && r?.ap > 0 ? (r.bp + r.ap) / 2 : null);
    if (!(mid > 0)) throw new Error(`the broker returned no ${pair} rate`);
    return mid;
  }

  async getLatestPrices(symbols) {
    const res = await this.data('/v2/stocks/trades/latest', { symbols: symbols.join(','), feed: this.feed });
    return Object.fromEntries(Object.entries(res.trades || {}).map(([s, t]) => [s, t.p]));
  }
}

/** Up to six decimal places, never in exponent notation. */
export function formatQty(qty) {
  return qty.toFixed(6).replace(/\.?0+$/, '');
}

function normalizeOrder(o) {
  return {
    id: o.id,
    clientOrderId: o.client_order_id,
    symbol: o.symbol,
    side: o.side,
    qty: num(o.qty),
    filledQty: num(o.filled_qty),
    filledAvgPrice: num(o.filled_avg_price),
    type: o.type ?? o.order_type,
    status: o.status,
    orderClass: o.order_class,
    createdAt: o.created_at ? Date.parse(o.created_at) : null,
  };
}
