// Collects fresh articles from every enabled source, normalises them, maps
// them to watchlist symbols and drops duplicates. A failing source is logged
// and skipped; it never stops the others.

import { parseFeed } from './rss.js';
import { buildTickerMatcher } from './tickers.js';
import { MINUTE } from '../time.js';

const USER_AGENT = 'news-trading-bot/0.1 (+rss reader)';
const DEFAULT_EVERY_MIN = { alpaca: 1, rss: 2, rssPerSymbol: 5 };

export const titleKey = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 100);

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export class NewsCollector {
  /**
   * @param {object} opts
   * @param {object} opts.config     full bot config
   * @param {object} [opts.broker]   needed for the 'alpaca' source
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {object} opts.log
   */
  constructor({ config, broker = null, fetchImpl = globalThis.fetch, log }) {
    this.config = config;
    this.broker = broker;
    this.fetch = fetchImpl;
    this.log = log;
    this.extract = buildTickerMatcher(config.watchlist);
    this.watchSymbols = new Set(config.watchlist.map((w) => w.symbol));
    this.lastFetchedAt = {};
  }

  /** Enabled sources whose prerequisites are met, with the reason others are off. */
  sources() {
    const active = [];
    const skipped = [];
    for (const src of this.config.news.sources) {
      if (src.enabled === false) { skipped.push({ src, reason: 'disabled in config' }); continue; }
      if (src.type === 'alpaca' && !this.broker?.canReadData) { skipped.push({ src, reason: 'needs Alpaca API keys' }); continue; }
      if (src.requiresEnv && !this.config.secrets?.[envToSecret(src.requiresEnv)]) {
        skipped.push({ src, reason: `needs ${src.requiresEnv} to be set` });
        continue;
      }
      active.push(src);
    }
    return { active, skipped };
  }

  async fetchText(url, headers = {}) {
    const res = await this.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*', ...headers },
      signal: AbortSignal.timeout(this.config.news.requestTimeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.text();
  }

  normalize(src, raw, symbolHint) {
    const text = `${raw.title} ${raw.summary || ''}`;
    const symbols = new Set(this.extract(text));
    for (const s of raw.symbols || []) if (this.watchSymbols.has(s)) symbols.add(s);
    if (symbolHint) symbols.add(symbolHint);
    const ident = raw.guid || raw.link || titleKey(raw.title);
    return {
      key: `${src.id}:${ident}`,
      titleKey: titleKey(raw.title),
      sourceId: src.id,
      sourceName: raw.provider ? `${src.name} / ${raw.provider}` : src.name,
      trust: src.trust,
      title: raw.title,
      summary: (raw.summary || '').slice(0, 1500),
      url: raw.link || null,
      publishedAt: raw.publishedAt,
      symbols: [...symbols],
    };
  }

  async fetchSource(src, { sinceMs }) {
    const symbols = [...this.watchSymbols];
    if (src.type === 'alpaca') {
      const news = await this.broker.getNews({ symbols, start: new Date(sinceMs).toISOString(), limit: 50 });
      return news.map((n) => this.normalize(src, {
        title: n.headline, summary: n.summary, link: n.url, guid: String(n.id),
        publishedAt: Date.parse(n.created_at), symbols: n.symbols, provider: n.source,
      }));
    }
    if (src.type === 'rss') {
      const headers = src.requiresEnv === 'SEC_USER_AGENT' ? { 'User-Agent': this.config.secrets.secUserAgent } : {};
      if (src.url.includes('{symbol}')) {
        const failures = [];
        const lists = await mapLimit(symbols, 3, async (sym) => {
          try {
            const xml = await this.fetchText(src.url.replaceAll('{symbol}', encodeURIComponent(sym)), headers);
            return parseFeed(xml).map((it) => this.normalize(src, it, sym));
          } catch (err) {
            failures.push(`${sym}: ${describeError(err)}`);
            return [];
          }
        });
        if (failures.length === symbols.length) throw new Error(`every request failed (${failures[0]})`);
        if (failures.length) this.log.warn(`news source ${src.id}: ${failures.length} of ${symbols.length} symbol feeds failed (${failures[0]})`);
        return lists.flat();
      }
      const xml = await this.fetchText(src.url, headers);
      return parseFeed(xml).map((it) => this.normalize(src, it));
    }
    throw new Error(`unknown source type "${src.type}"`);
  }

  isDue(src, nowMs) {
    const every = src.everyMinutes ?? (src.type === 'alpaca' ? DEFAULT_EVERY_MIN.alpaca
      : src.url?.includes('{symbol}') ? DEFAULT_EVERY_MIN.rssPerSymbol : DEFAULT_EVERY_MIN.rss);
    const last = this.lastFetchedAt[src.id];
    return last == null || nowMs - last >= every * MINUTE - 1000;
  }

  /**
   * @param {object} opts
   * @param {number} opts.sinceMs  ignore anything published before this
   * @param {number} opts.nowMs
   * @param {(item) => boolean} [opts.isSeen]
   * @param {boolean} [opts.force] fetch every source regardless of its interval
   */
  async collect({ sinceMs, nowMs, isSeen = () => false, force = false }) {
    const { active } = this.sources();
    const due = active.filter((src) => force || this.isDue(src, nowMs));
    const perSource = {};
    const errors = [];
    const results = await Promise.all(due.map(async (src) => {
      try {
        const items = await this.fetchSource(src, { sinceMs });
        this.lastFetchedAt[src.id] = nowMs;
        perSource[src.id] = items.length;
        return items;
      } catch (err) {
        errors.push({ source: src.id, error: describeError(err) });
        this.log.warn(`news source ${src.id} failed: ${describeError(err)}`);
        return [];
      }
    }));

    const byTitle = new Map();
    for (const item of results.flat()) {
      if (item.publishedAt == null) item.publishedAt = nowMs;
      if (item.publishedAt > nowMs + 5 * MINUTE) item.publishedAt = nowMs; // clock skew or bad feed dates
      if (item.publishedAt < sinceMs) continue;
      if (item.symbols.length === 0) continue;
      if (isSeen(item)) continue;
      const prev = byTitle.get(item.titleKey);
      if (!prev) { byTitle.set(item.titleKey, item); continue; }
      // Same story from two places: keep the more trusted copy, union symbols.
      const keep = item.trust > prev.trust ? item : prev;
      keep.symbols = [...new Set([...prev.symbols, ...item.symbols])];
      keep.duplicateKeys = [...(prev.duplicateKeys || []), ...(item.duplicateKeys || []), (keep === item ? prev : item).key];
      byTitle.set(item.titleKey, keep);
    }
    const items = [...byTitle.values()]
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, this.config.news.maxArticlesPerPoll);
    return { items, perSource, errors, polled: due.map((s) => s.id) };
  }
}

/** fetch() reports "fetch failed" and hides the real reason in `cause`. */
export function describeError(err) {
  const cause = err?.cause;
  if (cause) return `${err.message}: ${cause.code || cause.message || cause}`;
  return err?.message ?? String(err);
}

function envToSecret(envName) {
  return { SEC_USER_AGENT: 'secUserAgent' }[envName] ?? envName;
}
