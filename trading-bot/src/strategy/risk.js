// Position sizing and the rules that decide whether a new trade is allowed.

import { sessionOpen, minutesBetween } from '../time.js';

/** Round a price to the tick the exchange accepts: cents at $1 and above. */
export function roundPrice(p) {
  return p >= 1 ? Math.round(p * 100) / 100 : Math.round(p * 10000) / 10000;
}

/**
 * Shares to buy so that hitting the stop loses `riskPerTradePct` of equity,
 * capped by the per-position limit and buying power.
 */
export function sizePosition({ equity, buyingPower, price, risk }) {
  if (!(price > 0) || !(equity > 0)) return 0;
  const riskDollars = equity * (risk.riskPerTradePct / 100);
  const perShareRisk = price * (risk.stopLossPct / 100);
  const byRisk = Math.floor(riskDollars / perShareRisk);
  const byPosition = Math.floor((equity * (risk.maxPositionPct / 100)) / price);
  const byBuyingPower = Math.floor((Math.max(0, buyingPower) * 0.95) / price);
  return Math.max(0, Math.min(byRisk, byPosition, byBuyingPower));
}

/** Stop-loss and take-profit prices for a bracket order. */
export function bracketPrices(price, side, risk) {
  const tick = price >= 1 ? 0.01 : 0.0001;
  const sl = risk.stopLossPct / 100;
  const tp = risk.takeProfitPct / 100;
  if (side === 'buy') {
    return {
      stopLoss: roundPrice(Math.min(price * (1 - sl), price - tick)),
      takeProfit: roundPrice(Math.max(price * (1 + tp), price + tick)),
    };
  }
  return {
    stopLoss: roundPrice(Math.max(price * (1 + sl), price + tick)),
    takeProfit: roundPrice(Math.min(price * (1 - tp), price - tick)),
  };
}

export function dailyPnlPct(account) {
  if (!(account.lastEquity > 0)) return 0;
  return ((account.equity - account.lastEquity) / account.lastEquity) * 100;
}

/**
 * Whether the bot may open new positions right now.
 * @returns {{ok: boolean, reason: string}}
 */
export function entryGate({ nowMs, clock, account, state, managedCount, risk }) {
  const no = (reason) => ({ ok: false, reason });
  if (!clock.isOpen) return no('market is closed');
  if (state.halted) return no(`halted for the day: ${state.halted.reason}`);
  if (account.tradingBlocked || account.accountBlocked) return no('the broker has blocked trading on this account');
  const sinceOpen = minutesBetween(sessionOpen(nowMs), nowMs);
  if (sinceOpen < risk.skipOpenMinutes) return no(`waiting ${risk.skipOpenMinutes} min after the open`);
  const toClose = minutesBetween(nowMs, clock.nextClose);
  if (toClose <= risk.noEntryMinutesBeforeClose) return no(`within ${risk.noEntryMinutesBeforeClose} min of the close`);
  if (managedCount >= risk.maxOpenPositions) return no(`already holding ${managedCount} positions (max ${risk.maxOpenPositions})`);
  if (state.tradesToday >= risk.maxTradesPerDay) return no(`reached ${risk.maxTradesPerDay} trades today`);
  if (risk.pdtGuard && account.daytradeCount != null && account.equity < 25000 && account.daytradeCount >= 3) {
    return no(`pattern-day-trader limit: ${account.daytradeCount} day trades in 5 days on an account under $25,000`);
  }
  return { ok: true, reason: 'entries allowed' };
}
