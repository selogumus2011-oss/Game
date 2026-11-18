// A deliberately weak, offline scorer used when Claude is unavailable. It
// reads phrases, not meaning, so its confidence is capped low and on its own
// it rarely clears the entry threshold. Treat it as a safety net.

// [pattern, direction (+1 / -1), impact 0..1]
const RULES = [
  [/\b(beats?|beat|tops?|topped|surpass(es|ed)?|exceed(s|ed)?)\b[^.]{0,40}\b(estimates?|expectations|forecasts?|consensus|views?)\b/i, +1, 0.8],
  [/\b(miss(es|ed)?|falls? short of|fell short of|below)\b[^.]{0,40}\b(estimates?|expectations|forecasts?|consensus|views?)\b/i, -1, 0.8],
  [/\b(raises?|raised|boosts?|boosted|lifts?|lifted|hikes?|hiked)\b[^.]{0,30}\b(guidance|outlook|forecast)\b/i, +1, 0.9],
  [/\b(cuts?|lowers?|lowered|slash(es|ed)?|reduces?|reduced|withdraws?)\b[^.]{0,30}\b(guidance|outlook|forecast)\b/i, -1, 0.9],
  [/\bupgrade[sd]?\b/i, +1, 0.5],
  [/\bdowngrade[sd]?\b/i, -1, 0.5],
  [/\b(record (revenue|sales|profit|earnings|quarter))\b/i, +1, 0.6],
  [/\b(buyback|share repurchase|repurchase program)\b/i, +1, 0.5],
  [/\b(raises?|raised|increases?|increased|hikes?) (its |the )?(quarterly )?dividend\b/i, +1, 0.4],
  [/\b(FDA approv(al|es|ed)|wins? (FDA |regulatory )?approval|receives? approval)\b/i, +1, 0.8],
  [/\b(to be acquired|buyout offer|takeover (bid|offer)|agreed to be (bought|acquired))\b/i, +1, 0.9],
  [/\b(wins?|won|awarded|secures?|secured|lands?|landed)\b[^.]{0,30}\b(contract|deal|order)\b/i, +1, 0.5],
  [/\brecall(s|ed|ing)?\b/i, -1, 0.6],
  [/\b(lawsuit|sued|sues|class action)\b/i, -1, 0.4],
  [/\b(investigation|probe|subpoena|antitrust)\b/i, -1, 0.5],
  [/\b(fraud|accounting irregularities|restat(e|es|ed|ement))\b/i, -1, 0.9],
  [/\b(bankruptcy|chapter 11|insolvency)\b/i, -1, 1.0],
  [/\b(CEO|CFO|chief executive|chief financial officer)\b[^.]{0,30}\b(resigns?|resigned|steps? down|stepped down|departs?|ousted|fired)\b/i, -1, 0.6],
  [/\b(public offering|secondary offering|share sale|dilution|dilutive)\b/i, -1, 0.6],
  [/\b(halts? production|outage|data breach|cyberattack)\b/i, -1, 0.5],
  [/\b(delay(s|ed)?)\b[^.]{0,20}\b(launch|shipments?|product|approval)\b/i, -1, 0.4],
];

// Headlines that describe a move that has already happened, or offer opinion.
const RECAP = /\b(why .{1,40} (stock|shares) (is|are)|shares? (are )?(up|down|higher|lower|moving)|stocks? to watch|here'?s why|should you buy|is it time to|top \d+|\d+ stocks?|what to know|week in review|premarket movers)\b/i;

export function keywordAnalysis(item) {
  const text = `${item.title}. ${item.summary || ''}`;
  let net = 0;
  let hits = 0;
  let maxImpact = 0;
  const matched = [];
  const directions = new Set();
  for (const [re, dir, impact] of RULES) {
    const m = text.match(re);
    if (!m) continue;
    hits++;
    net += dir * impact;
    directions.add(dir);
    maxImpact = Math.max(maxImpact, impact);
    matched.push(m[0].trim().slice(0, 40));
  }
  const novelty = RECAP.test(item.title) ? 'recap' : 'new';
  if (hits === 0 || Math.abs(net) < 0.2) {
    return item.symbols.map((symbol) => result(item, symbol, 'neutral', 'none', 0.3, novelty, 'no decisive keywords'));
  }
  const direction = net > 0 ? 'bullish' : 'bearish';
  const impactLabel = maxImpact >= 0.8 ? 'high' : maxImpact >= 0.5 ? 'medium' : 'low';
  let confidence = Math.min(0.55, 0.4 + 0.05 * (hits - 1));
  if (directions.size > 1) confidence = 0.3; // mixed signals
  if (item.symbols.length > 1) confidence -= 0.1; // cannot tell which company the phrase is about
  return item.symbols.map((symbol) => result(item, symbol, direction, impactLabel, confidence, novelty,
    `keywords: ${matched.join('; ')}`));
}

function result(item, symbol, direction, impactLabel, confidence, novelty, rationale) {
  return { articleKey: item.key, symbol, direction, impactLabel, confidence: Math.max(0, confidence), novelty, rationale, method: 'keywords' };
}
