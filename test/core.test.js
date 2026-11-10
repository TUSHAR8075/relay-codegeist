import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreItem, scoreAll, summarise, tier } from '../src/lib/risk.js';
import { rankOwners, assignGreedy } from '../src/lib/owners.js';
import { renderPack, compactItems } from '../src/lib/pack.js';
import { normaliseWindow, adfToText, looksLikeAccountId, escapeXml, overlaps } from '../src/lib/util.js';

const window = { start: '2026-12-01', end: '2026-12-14' };

const critical = {
  type: 'jira', key: 'PAY-1', title: 'Refund API timeout', project: 'PAY', components: ['payments'],
  priority: 'Highest', dueDate: '2026-12-05', blockedDependents: 3, otherContributors: [],
  watchers: 6, linkedGoals: 1, statusCategory: 'indeterminate', status: 'In Progress', url: 'https://x/browse/PAY-1',
  lastNote: 'Retry logic half done, see branch fix/refund-retry',
};
const routine = {
  type: 'jira', key: 'PAY-9', title: 'Tidy README', project: 'PAY', components: [],
  priority: 'Low', dueDate: null, blockedDependents: 0,
  otherContributors: [{ accountId: 'b', name: 'Bob' }, { accountId: 'c', name: 'Cy' }, { accountId: 'd', name: 'Di' }],
  watchers: 0, statusCategory: 'new', status: 'To Do',
};

test('critical item scores critical with explained reasons', () => {
  const r = scoreItem(critical, window);
  assert.equal(r.tier, 'critical');
  assert.ok(r.score >= 70, `score ${r.score}`);
  assert.ok(r.reasons.some((x) => x.includes('while away')));
  assert.ok(r.reasons.some((x) => x.includes('blocks 3')));
  assert.ok(r.reasons.includes('nobody else has touched it'));
});

test('routine item scores low', () => {
  const r = scoreItem(routine, window);
  assert.equal(r.tier, 'low');
  assert.ok(r.score < 25, `score ${r.score}`);
});

test('scores are bounded 0..100 and sorted', () => {
  const s = scoreAll([routine, critical], window);
  assert.equal(s[0].key, 'PAY-1');
  for (const it of s) assert.ok(it.risk.score >= 0 && it.risk.score <= 100);
  assert.deepEqual(summarise(s), { total: 2, critical: 1, high: 0, medium: 0, low: 1 });
  assert.equal(tier(45), 'high');
});

test('due before absence is urgent, far future is not', () => {
  const before = scoreItem({ ...routine, dueDate: '2026-11-30', priority: 'Medium' }, window).breakdown.urgency;
  const later = scoreItem({ ...routine, dueDate: '2027-03-01', priority: 'Medium' }, window).breakdown.urgency;
  assert.ok(before > later);
});

const candidates = () =>
  new Map([
    ['alice', { name: 'Alice', projects: { PAY: 8 }, components: { payments: 4 }, openLoad: 3, teammate: true }],
    ['bob', { name: 'Bob', projects: { PAY: 2 }, components: {}, openLoad: 1, teammate: false }],
    ['zed', { name: 'Zed', projects: { PAY: 9 }, components: { payments: 9 }, openLoad: 2, teammate: true, unavailable: true }],
    ['leaver', { name: 'Leaver', projects: { PAY: 20 }, components: { payments: 20 }, openLoad: 0, teammate: true }],
  ]);

test('owner ranking prefers expertise and skips unavailable people and the leaver', () => {
  const r = rankOwners(critical, candidates(), { exclude: ['leaver'] });
  assert.equal(r[0].name, 'Alice');
  assert.ok(!r.some((x) => x.name === 'Zed' || x.name === 'Leaver'));
  assert.ok(r[0].why.some((w) => w.includes('payments')));
});

test('greedy assignment spreads load', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ ...critical, key: `PAY-${i}`, components: [] }));
  const out = assignGreedy(many, candidates(), { exclude: ['leaver'], maxLoad: 10 });
  const owners = new Set(out.map((o) => o.chosenOwner?.name));
  assert.ok(owners.has('Alice') && owners.has('Bob'), [...owners].join(','));
});

test('handover pack renders valid-looking storage format and escapes input', () => {
  const items = assignGreedy(scoreAll([critical, { ...routine, title: '<script>x</script>' }], window), candidates(), { exclude: ['leaver'] });
  const html = renderPack({ person: { name: 'Priya & Co' }, window, items, summary: summarise(items) });
  assert.ok(html.includes('Priya &amp; Co'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('PAY-1'));
  assert.ok(html.includes('ac:structured-macro'));
  const c = compactItems(items);
  assert.equal(c[0].key, 'PAY-1');
  assert.ok(JSON.stringify(c).length < 1_000_000);
});

test('utils', () => {
  assert.deepEqual(normaliseWindow('2026-12-01', null), { start: '2026-12-01', end: '2026-12-15' });
  assert.deepEqual(normaliseWindow('2026-12-10', '2026-12-01'), { start: '2026-12-10', end: '2026-12-10' });
  assert.equal(normaliseWindow('nope', undefined, new Date('2026-11-11')).start, '2026-11-11');
  assert.equal(adfToText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }).trim(), 'hi');
  assert.ok(looksLikeAccountId('5fb4febcfacfd60076a1c699'));
  assert.ok(looksLikeAccountId('712020:1a2b3c4d-1111-2222-3333-444455556666'));
  assert.ok(!looksLikeAccountId('Priya Sharma'));
  assert.equal(escapeXml('"<a>"'), '&quot;&lt;a&gt;&quot;');
  assert.ok(overlaps({ start: '2026-12-01', end: '2026-12-10' }, { start: '2026-12-10', end: '2026-12-20' }));
  assert.ok(!overlaps({ start: '2026-12-01', end: '2026-12-09' }, { start: '2026-12-10', end: '2026-12-20' }));
});
