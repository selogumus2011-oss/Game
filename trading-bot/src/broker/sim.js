// An in-memory broker for tests. Market orders fill instantly at the last bar
// close; bracket exits fire when a price update crosses them.

export class SimBroker {
  constructor({ equity = 100_000, now = () => Date.now() } = {}) {
    this.mode = 'sim';
    this.now = now;
    this.cash = equity;
    this.lastEquity = equity;
    this.positions = new Map();
    this.openOrders = [];
    this.bars = {};
    this.dailyBars = {};
    this.news = [];
    this.assets = {};
    this.submitted = [];
    this.closed = [];
    this.accountFlags = { tradingBlocked: false, accountBlocked: false, shortingEnabled: true, daytradeCount: null };
    this.clock = { isOpen: true, nextOpen: now() + 86_400_000, nextClose: now() + 3 * 3_600_000 };
    this.seq = 0;
  }

  get canReadData() { return true; }
  get canTrade() { return true; }

  price(symbol) {
    return this.bars[symbol]?.at(-1)?.c ?? null;
  }

  setBars(symbol, bars) {
    this.bars[symbol] = bars;
    const pos = this.positions.get(symbol);
    if (pos) this.checkBracket(symbol);
  }

  /** Move the price of a symbol, appending a one-minute bar. */
  pushPrice(symbol, c, v = 1000) {
    const list = (this.bars[symbol] ||= []);
    const t = (list.at(-1)?.t ?? this.now()) + 60_000;
    list.push({ t, o: c, h: c, l: c, c, v, vw: c });
    this.checkBracket(symbol);
  }

  checkBracket(symbol) {
    const pos = this.positions.get(symbol);
    if (!pos?.bracket) return;
    const p = this.price(symbol);
    const { stopLoss, takeProfit } = pos.bracket;
    const long = pos.side === 'long';
    const stopHit = long ? p <= stopLoss : p >= stopLoss;
    const targetHit = long ? p >= takeProfit : p <= takeProfit;
    if (stopHit || targetHit) this.realize(symbol, stopHit ? stopLoss : takeProfit, stopHit ? 'stop' : 'target');
  }

  realize(symbol, price, reason) {
    const pos = this.positions.get(symbol);
    if (!pos) return null;
    this.cash += pos.side === 'long' ? pos.qty * price : -pos.qty * price;
    this.positions.delete(symbol);
    this.openOrders = this.openOrders.filter((o) => o.symbol !== symbol);
    const rec = { symbol, price, reason, qty: pos.qty, side: pos.side, at: this.now() };
    this.closed.push(rec);
    return rec;
  }

  marketValue() {
    let v = 0;
    for (const pos of this.positions.values()) {
      const p = this.price(pos.symbol) ?? pos.avgEntryPrice;
      v += pos.side === 'long' ? pos.qty * p : -pos.qty * p;
    }
    return v;
  }

  async getAccount() {
    const equity = this.cash + this.marketValue();
    return { equity, lastEquity: this.lastEquity, buyingPower: Math.max(0, this.cash), cash: this.cash, status: 'ACTIVE', ...this.accountFlags };
  }

  async getClock() { return { timestamp: this.now(), ...this.clock }; }

  async getPositions() {
    return [...this.positions.values()].map((p) => ({
      symbol: p.symbol, qty: p.qty, side: p.side, avgEntryPrice: p.avgEntryPrice,
      currentPrice: this.price(p.symbol), marketValue: p.qty * this.price(p.symbol), unrealizedPl: null,
    }));
  }

  async getOpenOrders() { return this.openOrders.map((o) => ({ ...o })); }

  async getAsset(symbol) {
    return { symbol, tradable: true, shortable: true, easyToBorrow: true, fractionable: true, ...this.assets[symbol] };
  }

  async getNews({ symbols, start }) {
    const from = Date.parse(start);
    return this.news.filter((n) => Date.parse(n.created_at) >= from && n.symbols.some((s) => symbols.includes(s)));
  }

  async getBars(symbols, { start, timeframe = '1Min' } = {}) {
    const from = Date.parse(start);
    const src = timeframe === '1Day' ? this.dailyBars : this.bars;
    return Object.fromEntries(symbols.map((s) => [s, (src[s] || []).filter((b) => b.t >= from)]));
  }

  async getLatestPrices(symbols) {
    return Object.fromEntries(symbols.map((s) => [s, this.price(s)]));
  }

  async submitBracketOrder(o) {
    const price = this.price(o.symbol);
    if (price == null) throw new Error(`no price for ${o.symbol}`);
    const id = `sim-${++this.seq}`;
    this.submitted.push({ ...o, id, price, at: this.now() });
    const side = o.side === 'buy' ? 'long' : 'short';
    this.cash += side === 'long' ? -o.qty * price : o.qty * price;
    this.positions.set(o.symbol, { symbol: o.symbol, qty: o.qty, side, avgEntryPrice: price, bracket: { stopLoss: o.stopLoss, takeProfit: o.takeProfit } });
    const exitSide = o.side === 'buy' ? 'sell' : 'buy';
    this.openOrders.push(
      { id: `${id}-tp`, symbol: o.symbol, side: exitSide, qty: o.qty, type: 'limit', status: 'new', orderClass: 'bracket' },
      { id: `${id}-sl`, symbol: o.symbol, side: exitSide, qty: o.qty, type: 'stop', status: 'held', orderClass: 'bracket' },
    );
    return { id, clientOrderId: o.clientOrderId, symbol: o.symbol, side: o.side, qty: o.qty, status: 'filled' };
  }

  async cancelOrder(id) { this.openOrders = this.openOrders.filter((o) => o.id !== id); }

  async closePosition(symbol) {
    if (!this.positions.has(symbol)) return null;
    return this.realize(symbol, this.price(symbol), 'closed');
  }

  async closeAllPositions() {
    return [...this.positions.keys()].map((s) => this.realize(s, this.price(s), 'closed'));
  }
}
