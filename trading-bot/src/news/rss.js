// A small RSS 2.0 / Atom parser. Feeds are untrusted input, so this only
// pulls out text fields and never evaluates anything.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const unwrapCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

export function stripHtml(s) {
  return s
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanText(raw) {
  if (raw == null) return '';
  return decodeEntities(stripHtml(decodeEntities(unwrapCdata(raw)))).replace(/\s+/g, ' ').trim();
}

function firstTag(block, names) {
  for (const name of names) {
    const esc = name.replace(/[:]/g, '\\:');
    const m = block.match(new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc}>`, 'i'));
    if (m) return m[1];
  }
  return null;
}

function atomHref(block) {
  for (const [, attrs] of block.matchAll(/<link\b([^>]*?)\/?>/gi)) {
    const href = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const rel = attrs.match(/rel\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const relValue = rel ? rel[1] ?? rel[2] : null;
    if (href && (!relValue || relValue === 'alternate')) return decodeEntities(href[1] ?? href[2]);
  }
  return null;
}

export function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(cleanText(s));
  return Number.isFinite(t) ? t : null;
}

/**
 * @returns {{title: string, link: string|null, guid: string|null, publishedAt: number|null, summary: string}[]}
 */
export function parseFeed(xml) {
  if (typeof xml !== 'string') return [];
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.map((block) => {
    const rssLink = cleanText(firstTag(block, ['link']));
    return {
      title: cleanText(firstTag(block, ['title'])),
      link: rssLink || atomHref(block),
      guid: cleanText(firstTag(block, ['guid', 'id'])) || null,
      publishedAt: parseDate(firstTag(block, ['pubDate', 'published', 'updated', 'dc:date'])),
      summary: cleanText(firstTag(block, ['description', 'summary', 'content:encoded', 'content'])),
    };
  }).filter((it) => it.title);
}
