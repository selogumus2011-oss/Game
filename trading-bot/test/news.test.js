import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, decodeEntities } from '../src/news/rss.js';
import { buildTickerMatcher } from '../src/news/tickers.js';
import { NewsCollector } from '../src/news/sources.js';
import { silentLogger } from '../src/log.js';
import { testConfig, OPEN, MIN } from './helpers.js';

const RSS = `<?xml version="1.0"?><rss><channel><title>Feed title</title>
<item><title><![CDATA[Apple beats estimates & raises guidance]]></title>
<link>https://example.com/a</link><guid>id-1</guid>
<pubDate>Wed, 18 Nov 2026 15:00:00 GMT</pubDate>
<description>&lt;p&gt;Revenue rose 9%&amp;nbsp;to a record.&lt;/p&gt;</description></item>
<item><title>Second &#8220;story&#8221;</title><link>https://example.com/b</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>EDGAR</title>
<entry><title>8-K - Current report</title><link rel="alternate" type="text/html" href="https://sec.example/x?a=1&amp;b=2"/>
<id>urn:tag:sec.gov,2008:accession-number=0000320193-26-000100</id><updated>2026-11-18T09:01:02-05:00</updated>
<summary type="html">&lt;b&gt;Item 2.02&lt;/b&gt;: Results of Operations</summary></entry></feed>`;

test('parses RSS items, CDATA, entities and HTML in descriptions', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Apple beats estimates & raises guidance');
  assert.equal(items[0].link, 'https://example.com/a');
  assert.equal(items[0].guid, 'id-1');
  assert.equal(items[0].publishedAt, Date.UTC(2026, 10, 18, 15, 0));
  assert.equal(items[0].summary, 'Revenue rose 9% to a record.');
  assert.equal(items[1].title, 'Second “story”');
  assert.equal(items[1].publishedAt, null);
});

test('parses Atom entries with link attributes and offsets', () => {
  const [e] = parseFeed(ATOM);
  assert.equal(e.title, '8-K - Current report');
  assert.equal(e.link, 'https://sec.example/x?a=1&b=2');
  assert.equal(e.publishedAt, Date.UTC(2026, 10, 18, 14, 1, 2));
  assert.equal(e.summary, 'Item 2.02 : Results of Operations');
});

test('garbage in, nothing out', () => {
  assert.deepEqual(parseFeed('<html>not a feed</html>'), []);
  assert.deepEqual(parseFeed(undefined), []);
  assert.equal(decodeEntities('&bogus; &#0;'), '&bogus; &#0;');
});

test('ticker matcher finds only watchlist symbols, by tag, ticker or name', () => {
  const extract = buildTickerMatcher([
    { symbol: 'AAPL', names: ['Apple'] },
    { symbol: 'META', names: ['Meta Platforms'] },
    { symbol: 'JPM', names: ['JPMorgan'] },
  ]);
  assert.deepEqual(extract('Shares of $AAPL rose'), ['AAPL']);
  assert.deepEqual(extract('Acme (NASDAQ: META) news'), ['META']);
  assert.deepEqual(extract("JPMorgan's profit"), ['JPM']);
  assert.deepEqual(extract('apple pie recipes and pineapple'), []);
  assert.deepEqual(extract('APPLE RAISES GUIDANCE'), ['AAPL']);
  assert.deepEqual(extract('$TSLA and NVDA rally'), [], 'not on the watchlist');
  assert.deepEqual(extract('AAPLX is a fund'), []);
});

function fakeFetch(routes) {
  const seen = [];
  const fn = async (url, opts) => {
    seen.push({ url: String(url), headers: opts?.headers });
    for (const [pattern, body] of routes) {
      if (String(url).includes(pattern)) {
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, text: async () => body };
      }
    }
    return { ok: false, status: 404, text: async () => 'nope' };
  };
  fn.seen = seen;
  return fn;
}

test('collector merges sources, dedupes the same story and keeps the more trusted copy', async () => {
  const config = testConfig({
    news: {
      sources: [
        { id: 'wire', type: 'rss', name: 'Wire', trust: 0.6, url: 'https://wire.test/rss' },
        { id: 'paper', type: 'rss', name: 'Paper', trust: 0.9, url: 'https://paper.test/rss' },
      ],
    },
  });
  const item = (title, date) => `<item><title>${title}</title><link>https://x/${encodeURIComponent(title)}</link><pubDate>${date}</pubDate></item>`;
  const now = OPEN + 60 * MIN;
  const fresh = new Date(now - 10 * MIN).toUTCString();
  const stale = new Date(now - 600 * MIN).toUTCString();
  const fetch = fakeFetch([
    ['wire.test', `<rss>${item('Apple raises guidance', fresh)}${item('Weather is nice', fresh)}${item('Apple old news', stale)}</rss>`],
    ['paper.test', `<rss>${item('APPLE RAISES GUIDANCE!', fresh)}</rss>`],
  ]);
  const c = new NewsCollector({ config, fetchImpl: fetch, log: silentLogger() });
  const { items, errors } = await c.collect({ sinceMs: now - 120 * MIN, nowMs: now });
  assert.deepEqual(errors, []);
  assert.equal(items.length, 1, 'off-watchlist and stale items dropped, duplicate merged');
  assert.equal(items[0].sourceId, 'paper');
  assert.deepEqual(items[0].symbols, ['AAPL']);
  assert.equal(items[0].duplicateKeys.length, 1);
});

test('per-symbol feeds tag items with their symbol and send the SEC user agent', async () => {
  const config = testConfig({
    watchlist: [{ symbol: 'AAPL', names: ['Apple'] }],
    news: { sources: [{ id: 'sec', type: 'rss', name: 'SEC', trust: 0.95, url: 'https://sec.test/?CIK={symbol}', requiresEnv: 'SEC_USER_AGENT' }] },
  });
  config.secrets.secUserAgent = 'Test Person test@example.com';
  const now = OPEN;
  const fetch = fakeFetch([['sec.test/?CIK=AAPL', ATOM]]);
  const c = new NewsCollector({ config, fetchImpl: fetch, log: silentLogger() });
  const { items } = await c.collect({ sinceMs: now - 120 * MIN, nowMs: now });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].symbols, ['AAPL']);
  assert.equal(fetch.seen[0].headers['User-Agent'], 'Test Person test@example.com');
});

test('a source that needs a missing setting is skipped, and a failing source does not stop others', async () => {
  const config = testConfig({
    news: {
      sources: [
        { id: 'sec', type: 'rss', name: 'SEC', trust: 1, url: 'https://sec.test/{symbol}', requiresEnv: 'SEC_USER_AGENT' },
        { id: 'down', type: 'rss', name: 'Down', trust: 1, url: 'https://down.test/rss' },
        { id: 'up', type: 'rss', name: 'Up', trust: 1, url: 'https://up.test/rss' },
        { id: 'alpaca', type: 'alpaca', name: 'Alpaca', trust: 1 },
      ],
    },
  });
  const now = OPEN;
  const fetch = fakeFetch([
    ['down.test', new Error('boom')],
    ['up.test', `<rss><item><title>Tesla recalls cars</title><pubDate>${new Date(now).toUTCString()}</pubDate></item></rss>`],
  ]);
  const c = new NewsCollector({ config, fetchImpl: fetch, log: silentLogger() });
  const { skipped } = c.sources();
  assert.deepEqual(skipped.map((s) => s.src.id).sort(), ['alpaca', 'sec']);
  const { items, errors } = await c.collect({ sinceMs: now - MIN, nowMs: now });
  assert.equal(items.length, 1);
  assert.equal(errors[0].source, 'down');
});
