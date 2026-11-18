// Price confirmation. News that the market is ignoring, or a move that has
// already run, is not worth trading. Works on one-minute bars, oldest first.

/**
 * @param {{t:number,o:number,h:number,l:number,c:number,v:number,vw?:number}[]} bars  today's 1-minute bars
 * @param {1|-1} direction
 * @param {object} cfg
 * @param {number|null} [prevClose] yesterday's close, to catch moves that happened in a gap
 */
export function confirmMove(bars, direction, cfg, prevClose = null) {
  if (!cfg.enabled) return { ok: true, reason: 'confirmation disabled', lastPrice: bars.at(-1)?.c ?? null };
  if (!bars || bars.length < 5) return { ok: false, reason: 'not enough price data yet' };
  const last = bars.at(-1);
  const startIdx = Math.max(0, bars.length - 1 - cfg.lookbackMinutes);
  const ref = bars[startIdx].c;
  const movePct = ((last.c - ref) / ref) * 100;
  const dirMove = movePct * direction;
  let volPx = 0;
  let vol = 0;
  for (const b of bars) {
    const px = b.vw ?? (b.h + b.l + b.c) / 3;
    volPx += px * b.v;
    vol += b.v;
  }
  const vwap = vol > 0 ? volPx / vol : null;
  const base = { lastPrice: last.c, movePct: round(movePct), vwap: vwap && round(vwap) };

  if (dirMove < cfg.minMovePct) {
    return { ...base, ok: false, reason: `price has not moved with the news (${round(movePct)}% over ${bars.length - 1 - startIdx} min)` };
  }
  if (dirMove > cfg.maxChasePct) {
    return { ...base, ok: false, reason: `move already ${round(movePct)}%, past the ${cfg.maxChasePct}% chase limit` };
  }
  if (prevClose > 0 && cfg.maxDayMovePct) {
    const dayMove = ((last.c - prevClose) / prevClose) * 100;
    if (dayMove * direction > cfg.maxDayMovePct) {
      return { ...base, ok: false, reason: `already ${round(dayMove)}% from yesterday's close, past the ${cfg.maxDayMovePct}% limit` };
    }
  }
  if (cfg.requireVwap && vwap != null && (last.c - vwap) * direction <= 0) {
    return { ...base, ok: false, reason: `price is on the wrong side of VWAP (${round(last.c)} vs ${round(vwap)})` };
  }
  return { ...base, ok: true, reason: `price confirms: ${round(movePct)}%` };
}

const round = (x) => Math.round(x * 100) / 100;
