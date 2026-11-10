// Orchestration: gather → score → suggest owners → publish → apply → brief.
import * as twg from './twg.js';
import * as jira from './jira.js';
import * as confluence from './confluence.js';
import * as store from './store.js';
import { scoreAll, summarise } from './risk.js';
import { assignGreedy } from './owners.js';
import { renderPack, packTitle, compactItems } from './pack.js';
import { normaliseWindow, overlaps, looksLikeAccountId, adfToText, truncate, prettyName } from './util.js';

/** Resolve "me", an account ID or a display name to {accountId, name}. */
export async function resolvePerson(input, contextAccountId, mode = 'user') {
  const raw = (input || '').trim();
  if (!raw || ['me', 'i', 'myself'].includes(raw.toLowerCase())) {
    const u = await jira.getUser(contextAccountId, mode);
    return { accountId: contextAccountId, name: prettyName(u?.displayName) || 'You' };
  }
  if (looksLikeAccountId(raw)) {
    const u = await jira.getUser(raw, mode);
    return { accountId: raw, name: prettyName(u?.displayName) || raw };
  }
  const found = await jira.searchUsers(raw, mode);
  if (!found.length) throw new Error(`No active user matches "${raw}". Try their full name or account ID.`);
  return { accountId: found[0].accountId, name: prettyName(found[0].displayName) };
}

/** Everything a person owns, normalised and de-duplicated. */
export async function gatherWork(person, { mode = 'user', cloudId = null } = {}) {
  const notes = [];
  const baseUrl = await jira.siteUrl(mode).catch(() => null);
  const keys = new Set();
  const aris = new Map(); // issue key -> Teamwork Graph ARI

  // 1. Teamwork Graph discovers assigned work (user mode only; TWG has no asApp path).
  if (mode === 'user') {
    const nodes = await twg.assignedWorkItems(person.accountId, notes);
    for (const n of nodes) {
      if (!n.key || n.status?.statusCategory?.key === 'done') continue;
      keys.add(n.key);
      if (n.id) aris.set(n.key, n.id);
    }
  }

  // 2. Jira enriches (priority, links, watchers, comments) and covers anything TWG missed.
  const jql = `assignee = "${person.accountId}" AND statusCategory != Done ORDER BY priority DESC, duedate ASC`;
  const issues = await jira.searchJql(jql, { max: 100, mode });
  const known = new Set(issues.map((i) => i.key));
  const missing = [...keys].filter((k) => !known.has(k)).slice(0, 50);
  if (missing.length) issues.push(...(await jira.searchJql(`key in (${missing.join(',')})`, { max: 50, mode })));
  const items = issues.map((i) => jira.toItem(i, person.accountId, baseUrl));

  // 3. Goals linked through the graph raise visibility (top 15 only, to respect rate limits).
  if (mode === 'user') {
    for (const it of items.slice(0, 15)) {
      const ari = aris.get(it.key) || (cloudId ? `ari:cloud:jira:${cloudId}:issue/${it.id}` : null);
      it.linkedGoals = await twg.goalCount(ari, notes);
    }
  }

  // 4. Open pull requests from the graph (Bitbucket / GitHub via connectors).
  if (mode === 'user') {
    const prs = await twg.pullRequests(person.accountId, notes);
    for (const pr of prs) {
      if (pr.status && !/OPEN|DRAFT/i.test(pr.status)) continue;
      items.push({
        type: 'pr',
        id: pr.id,
        key: pr.displayId ? `PR ${pr.displayId}` : null,
        title: pr.title,
        url: pr.url,
        status: pr.status || 'Open',
        statusCategory: 'indeterminate',
        updated: pr.lastUpdatedAt,
        watchers: pr.commentCount || 0,
        blockedDependents: 0,
        otherContributors: [],
      });
    }
  }

  // 5. Confluence pages they keep alive.
  items.push(...(await confluence.recentPages(person.accountId, mode, notes)));

  return { items, notes: [...new Set(notes)].slice(0, 6), baseUrl };
}

/** Build candidate profiles from recent activity in the same projects plus the person's teams. */
export async function buildCandidates(person, items, window, { mode = 'user', notes = [] } = {}) {
  const projects = [...new Set(items.filter((i) => i.project).map((i) => i.project))].slice(0, 10);
  const candidates = new Map();
  const touch = (id, name) => {
    if (!candidates.has(id)) candidates.set(id, { name, projects: {}, components: {}, openLoad: 0, teammate: false, unavailable: false });
    return candidates.get(id);
  };

  if (projects.length) {
    const recent = await jira.searchJql(
      `project in (${projects.map((p) => `"${p}"`).join(',')}) AND assignee is not EMPTY AND updated >= -90d`,
      { fields: ['assignee', 'components', 'project'], max: 200, mode },
    );
    for (const i of recent) {
      const a = i.fields.assignee;
      if (!a || a.accountId === person.accountId || a.accountType !== 'atlassian') continue;
      const c = touch(a.accountId, prettyName(a.displayName));
      const p = i.fields.project?.key;
      c.projects[p] = (c.projects[p] || 0) + 1;
      for (const comp of i.fields.components || []) c.components[comp.name] = (c.components[comp.name] || 0) + 1;
    }
  }
  for (const it of items) for (const p of it.otherContributors || []) touch(p.accountId, p.name);

  if (mode === 'user') {
    const { members } = await twg.teammates(person.accountId, notes);
    for (const [id, name] of members) touch(id, name).teammate = true;
  }
  candidates.delete(person.accountId);

  // Exclude people who are away in an overlapping window.
  const others = await store.listHandovers();
  for (const h of others) {
    if (h.person.accountId !== person.accountId && candidates.has(h.person.accountId) && overlaps(h.window, window)) {
      candidates.get(h.person.accountId).unavailable = true;
    }
  }

  // Current load for the top 15 most relevant people.
  const top = [...candidates.entries()]
    .filter(([, c]) => !c.unavailable)
    .sort(([, a], [, b]) => sum(b.projects) + (b.teammate ? 3 : 0) - (sum(a.projects) + (a.teammate ? 3 : 0)))
    .slice(0, 15);
  for (const [id, c] of top) {
    c.openLoad = await jira.countJql(`assignee = "${id}" AND statusCategory != Done`, mode).catch(() => 0);
  }
  const keep = new Set(top.map(([id]) => id));
  for (const id of [...candidates.keys()]) if (!keep.has(id)) candidates.delete(id);
  return candidates;
}
const sum = (o) => Object.values(o || {}).reduce((s, n) => s + n, 0);

export async function scan(personInput, startDate, endDate, context, { mode = 'user', withOwners = false } = {}) {
  const person = await resolvePerson(personInput, context?.accountId, mode);
  const window = normaliseWindow(startDate, endDate);
  const { items, notes, baseUrl } = await gatherWork(person, { mode, cloudId: context?.cloudId });
  let scored = scoreAll(items, window);
  if (withOwners) {
    const candidates = await buildCandidates(person, scored, window, { mode, notes });
    scored = assignGreedy(scored, candidates, { exclude: [person.accountId] });
  }
  return { person, window, items: scored, summary: summarise(scored), notes, baseUrl };
}

export async function createHandover({ personInput, startDate, endDate, spaceKey, overrides = {}, context, mode = 'user' }) {
  const res = await scan(personInput, startDate, endDate, context, { mode, withOwners: true });
  for (const it of res.items) {
    const o = overrides[it.key || it.id];
    if (o === null) it.chosenOwner = null;
    else if (o) it.chosenOwner = o;
  }
  const record = {
    person: res.person,
    window: res.window,
    items: res.items,
    summary: res.summary,
    status: 'planned',
    createdBy: context?.accountId,
    createdAt: new Date().toISOString(),
    notes: res.notes,
    page: null,
  };
  if (spaceKey) {
    try {
      record.page = await confluence.createPage({ spaceKey, title: packTitle(record), storage: renderPack(record), mode });
    } catch (e) {
      record.notes.push(`Handover pack not published: ${e.message}`);
    }
  }
  await store.saveHandover(record);
  return record;
}

export async function applyReassignments(accountId, { mode = 'user', overrides = {} } = {}) {
  const record = await store.getHandover(accountId);
  if (!record) throw new Error('No handover plan found. Create one first.');
  const results = [];
  for (const it of record.items) {
    if (it.type !== 'jira') continue;
    const o = overrides[it.key];
    if (o !== undefined) it.chosenOwner = o;
    if (!it.chosenOwner) {
      results.push({ key: it.key, ok: false, reason: 'no owner chosen' });
      continue;
    }
    try {
      await jira.assign(it.key, it.chosenOwner.accountId, mode);
      const ctx = it.lastNote ? `Latest note from ${record.person.name}: "${truncate(it.lastNote, 300)}"` : null;
      await jira.comment(
        it.key,
        [
          `Relay handover: ${record.person.name} is away ${record.window.start} to ${record.window.end}. ${it.chosenOwner.name} now owns this issue.`,
          `Risk ${it.risk.score} (${it.risk.tier})${it.risk.reasons.length ? `: ${it.risk.reasons.join('; ')}` : ''}.`,
          ctx,
          record.page?.url ? `Full handover pack: ${record.page.url}` : null,
        ],
        mode,
      );
      it.handedTo = it.chosenOwner;
      it.statusAtHandover = it.status;
      results.push({ key: it.key, ok: true, to: it.chosenOwner.name });
    } catch (e) {
      results.push({ key: it.key, ok: false, reason: e.message });
    }
  }
  record.status = 'active';
  record.appliedAt = new Date().toISOString();
  await store.saveHandover(record);
  return { record, results };
}

export async function returnBriefing(accountId, { mode = 'user' } = {}) {
  const record = await store.getHandover(accountId);
  if (!record) throw new Error('No handover found for this person.');
  const since = Date.parse(record.appliedAt || record.createdAt);
  const out = [];
  for (const it of record.items.filter((i) => i.type === 'jira').slice(0, 40)) {
    try {
      const issue = await jira.getIssue(it.key, mode);
      const comments = (await jira.getComments(it.key, mode)).filter(
        (c) => Date.parse(c.created) > since && !adfToText(c.body).startsWith('Relay handover'),
      );
      out.push({
        key: it.key,
        title: it.title,
        url: it.url,
        before: it.statusAtHandover || it.status,
        now: issue.fields.status?.name,
        done: issue.fields.status?.statusCategory?.key === 'done',
        heldBy: prettyName(issue.fields.assignee?.displayName) || 'Unassigned',
        newComments: comments.length,
        latest: comments[0] ? `${prettyName(comments[0].author?.displayName)}: ${truncate(adfToText(comments[0].body), 200)}` : null,
      });
    } catch (e) {
      out.push({ key: it.key, title: it.title, error: e.message });
    }
  }
  const finished = out.filter((o) => o.done).length;
  record.status = 'returned';
  record.briefedAt = new Date().toISOString();
  await store.saveHandover(record);
  return {
    person: record.person.name,
    window: record.window,
    finished,
    stillOpen: out.length - finished,
    changed: out.filter((o) => o.before !== o.now).length,
    items: out,
    handoverPack: record.page?.url || null,
  };
}

export async function whoOwns(issueKey, { mode = 'user' } = {}) {
  const issue = await jira.getIssue(issueKey, mode);
  const item = jira.toItem(issue, issue.fields.assignee?.accountId, await jira.siteUrl(mode).catch(() => null));
  const hit = await store.findByIssue(issueKey);
  const active = hit && hit.handover.status === 'active';
  return {
    key: issueKey,
    title: item.title,
    url: item.url,
    owner: item.assignee?.name || 'Unassigned',
    coveredByHandover: Boolean(active),
    originalOwner: active ? hit.handover.person.name : null,
    awayUntil: active ? hit.handover.window.end : null,
    alsoHasContext: item.otherContributors.map((p) => p.name).slice(0, 5),
    handoverPack: active ? hit.handover.page?.url || null : null,
  };
}

export { compactItems };
