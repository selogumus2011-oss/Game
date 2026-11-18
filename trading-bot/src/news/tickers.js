// Map an article's text to watchlist symbols. Only watchlist symbols are ever
// returned, so a headline about some other company can never cause a trade.

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildTickerMatcher(watchlist) {
  const symbols = new Set(watchlist.map((w) => w.symbol));
  // Names match as written or in capitals ("APPLE" in a shouting headline),
  // but not in lower case, which is where common words live.
  const names = watchlist.flatMap((w) => (w.names || []).flatMap((name) => [...new Set([name, name.toUpperCase()])].map((form) => ({
    symbol: w.symbol,
    re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(form)}(?![A-Za-z0-9])`),
  }))));

  return function extract(text) {
    const found = new Set();
    if (!text) return [];
    // $AAPL
    for (const m of text.matchAll(/\$([A-Z]{1,5}(?:\.[A-Z])?)(?![A-Za-z0-9])/g)) {
      if (symbols.has(m[1])) found.add(m[1]);
    }
    // (NASDAQ: AAPL), NYSE:JPM
    for (const m of text.matchAll(/\b(?:NASDAQ|Nasdaq|NYSE(?: American)?|AMEX|Cboe|CBOE)\s*:\s*([A-Z]{1,5}(?:\.[A-Z])?)(?![A-Za-z0-9])/g)) {
      if (symbols.has(m[1])) found.add(m[1]);
    }
    // A bare ticker of three or more capitals. Shorter ones collide with words.
    for (const m of text.matchAll(/(?<![A-Za-z0-9$])([A-Z]{3,5})(?![A-Za-z0-9])/g)) {
      if (symbols.has(m[1])) found.add(m[1]);
    }
    for (const { symbol, re } of names) if (re.test(text)) found.add(symbol);
    return [...found];
  };
}
