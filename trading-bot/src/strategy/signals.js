// Combine analyses into one score per symbol. Each analysis contributes
//   direction x impact x confidence x source trust x novelty weight x freshness
// where freshness halves every `halfLifeMinutes`. A single fresh, high-impact,
// fully confident story from a fully trusted source contributes 1.0.

import { MINUTE, effectiveNewsTime } from '../time.js';

export const NOVELTY_WEIGHT = { new: 1, follow_up: 0.7, recap: 0.25, opinion: 0.3 };
const SCORE_CAP = 2;

export function contribution(a, nowMs, cfg) {
  const at = effectiveNewsTime(a.publishedAt, nowMs, cfg.overnightCarryHours);
  const ageMin = Math.max(0, (nowMs - at) / MINUTE);
  if (ageMin > cfg.maxArticleAgeMinutes) return 0;
  if (a.confidence < cfg.minConfidence || !a.impact || !a.sentiment) return 0;
  const decay = 0.5 ** (ageMin / cfg.halfLifeMinutes);
  return a.sentiment * a.impact * a.confidence * a.trust * (NOVELTY_WEIGHT[a.novelty] ?? 0.5) * decay;
}

/**
 * @returns {Map<string, {symbol, score, direction, evidence: object[], sources: string[]}>}
 */
export function computeSignals(analyses, nowMs, cfg, symbols) {
  const out = new Map();
  for (const s of symbols) out.set(s, { symbol: s, score: 0, direction: 0, evidence: [], sources: [] });
  const counted = new Set();
  for (const a of analyses) {
    const sig = out.get(a.symbol);
    if (!sig) continue;
    const pair = `${a.articleKey}/${a.symbol}`;
    if (counted.has(pair)) continue; // never count one article twice
    counted.add(pair);
    const c = contribution(a, nowMs, cfg);
    if (c === 0) continue;
    sig.score += c;
    sig.evidence.push({ contribution: c, title: a.title, source: a.sourceName, direction: a.direction,
      impact: a.impactLabel, confidence: a.confidence, novelty: a.novelty, rationale: a.rationale,
      method: a.method, publishedAt: a.publishedAt, url: a.url, articleKey: a.articleKey });
  }
  for (const sig of out.values()) {
    sig.score = Math.max(-SCORE_CAP, Math.min(SCORE_CAP, sig.score));
    sig.direction = Math.abs(sig.score) < 1e-9 ? 0 : Math.sign(sig.score);
    sig.evidence.sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution));
    sig.sources = [...new Set(sig.evidence.map((e) => e.source))];
  }
  return out;
}

export const rankSignals = (signals) => [...signals.values()].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
