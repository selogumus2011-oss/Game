// Wraps a real broker: every read goes through, every write is logged and
// skipped. Use it to watch the bot's decisions against live data.

export class DryRunBroker {
  constructor(inner, log) {
    this.inner = inner;
    this.log = log;
    this.mode = `${inner.mode} (dry run)`;
  }

  get canReadData() { return this.inner.canReadData; }
  get canTrade() { return this.inner.canTrade; }

  getAccount() { return this.inner.getAccount(); }
  getClock() { return this.inner.getClock(); }
  getPositions() { return this.inner.getPositions(); }
  getOpenOrders() { return this.inner.getOpenOrders(); }
  getAsset(s) { return this.inner.getAsset(s); }
  getNews(q) { return this.inner.getNews(q); }
  getBars(s, q) { return this.inner.getBars(s, q); }
  getLatestPrices(s) { return this.inner.getLatestPrices(s); }

  async submitBracketOrder(o) {
    this.log.event('dry-run', `[dry run] would ${o.side} ${o.qty} ${o.symbol}, stop ${o.stopLoss}, target ${o.takeProfit}`, o);
    return { id: `dry-${o.clientOrderId}`, clientOrderId: o.clientOrderId, symbol: o.symbol, side: o.side, qty: o.qty, status: 'dry_run' };
  }

  async closePosition(symbol) {
    this.log.event('dry-run', `[dry run] would close ${symbol}`);
    return null;
  }

  async cancelOrder(id) {
    this.log.event('dry-run', `[dry run] would cancel order ${id}`);
  }

  async closeAllPositions() {
    this.log.event('dry-run', '[dry run] would close every position');
    return [];
  }
}
