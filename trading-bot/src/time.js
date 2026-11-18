// US market time helpers. The exchange runs on New York time, so "today",
// the opening bell and day boundaries are all computed there.

const NY = 'America/New_York';
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: NY,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

export const MINUTE = 60_000;

export function nyParts(ms) {
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, ss: +p.second };
}

/** "YYYY-MM-DD" of the New York calendar day containing `ms`. */
export function nyDateKey(ms) {
  const { y, m, d } = nyParts(ms);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The instant of New York wall-clock time `hhmm` on the New York day of `ms`. */
export function nyTimeOnDay(ms, hhmm) {
  const { y, m, d, hh, mm, ss } = nyParts(ms);
  const offset = Date.UTC(y, m - 1, d, hh, mm, ss) - Math.floor(ms / 1000) * 1000;
  const [H, M] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, H, M) - offset;
}

/** Regular-session open (09:30 New York) for the day of `ms`. */
export const sessionOpen = (ms) => nyTimeOnDay(ms, '09:30');

export const minutesBetween = (a, b) => (b - a) / MINUTE;

export const sleep = (ms, signal) => new Promise((res) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

/**
 * News published between yesterday afternoon and this morning's open (for
 * example earnings released after the close) is what moves the open. Rather
 * than let it decay all night, treat it as published 15 minutes before the
 * bell once the session has started.
 */
export const OVERNIGHT_ANCHOR_MIN = 15;

export function effectiveNewsTime(publishedAt, nowMs, carryHours) {
  if (!carryHours) return publishedAt;
  const open = sessionOpen(nowMs);
  const anchor = open - OVERNIGHT_ANCHOR_MIN * MINUTE;
  if (nowMs >= open && publishedAt < anchor && publishedAt >= open - carryHours * 60 * MINUTE) return anchor;
  return publishedAt;
}
