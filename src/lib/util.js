// Pure helpers: no Forge imports, so they can be unit tested with node:test.

const DAY = 24 * 60 * 60 * 1000;

export function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Normalise an absence window. Defaults: start today, end start + 14 days. */
export function normaliseWindow(startDate, endDate, now = new Date()) {
  const valid = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  const start = valid(startDate) ? startDate : isoDate(now);
  let end = valid(endDate) ? endDate : isoDate(Date.parse(start) + 14 * DAY);
  if (Date.parse(end) < Date.parse(start)) end = start;
  return { start, end };
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY);
}

export function overlaps(a, b) {
  return Date.parse(a.start) <= Date.parse(b.end) && Date.parse(b.start) <= Date.parse(a.end);
}

/** Flatten Atlassian Document Format (or plain string) to text. */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join('');
  let out = node.text || '';
  if (node.type === 'mention') out = node.attrs?.text || '@someone';
  if (node.content) out += adfToText(node.content);
  if (['paragraph', 'heading', 'listItem', 'codeBlock'].includes(node.type)) out += '\n';
  return out;
}

export function truncate(s, n = 280) {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain-text ADF document for Jira comments. */
export function adfDoc(paragraphs) {
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.filter(Boolean).map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p }],
    })),
  };
}

export function looksLikeAccountId(s) {
  return typeof s === 'string' && (/^[0-9a-f]{24}$/i.test(s) || /^\d{6}:[0-9a-f-]{36}$/i.test(s));
}

/** ari:cloud:identity::user/<accountId> → accountId */
export function accountIdFromAri(ari) {
  if (!ari) return null;
  const m = String(ari).match(/user\/(.+)$/);
  return m ? m[1] : ari;
}

/** "someone+priya" (an un-activated invite) -> "Priya"; other names unchanged. */
export function prettyName(name) {
  const m = String(name || '').match(/^[^\s@]+\+([a-z][\w-]*)(@.*)?$/i);
  return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : name;
}
