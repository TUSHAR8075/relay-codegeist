import ResolverModule from '@forge/resolver';

// @forge/resolver is CommonJS; under "type": "module" the class sits on .default.
const Resolver = ResolverModule.default ?? ResolverModule;
import * as h from './lib/handover.js';
import * as store from './lib/store.js';
import * as jira from './lib/jira.js';
import { compactItems } from './lib/pack.js';
import { isoDate } from './lib/util.js';

// ---------- Rovo actions (also exposed as MCP tools) ----------

function ctx(payload, context) {
  return {
    accountId: context?.accountId || payload?.context?.accountId,
    cloudId: context?.cloudId || payload?.context?.cloudId,
    issueKey: payload?.context?.jira?.issueKey || payload?.context?.issueKey,
  };
}

async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    return { error: e.message };
  }
}

export const actionScanWork = (payload, context) =>
  safe(async () => {
    const r = await h.scan(payload.person, payload.startDate, payload.endDate, ctx(payload, context));
    return { person: r.person.name, window: r.window, summary: r.summary, items: compactItems(r.items), notes: r.notes };
  });

export const actionSuggestOwners = (payload, context) =>
  safe(async () => {
    const r = await h.scan(payload.person, payload.startDate, payload.endDate, ctx(payload, context), { withOwners: true });
    const unassigned = r.items.filter((i) => !i.chosenOwner).map((i) => i.key || i.title);
    return { person: r.person.name, window: r.window, summary: r.summary, items: compactItems(r.items), needsDecision: unassigned, notes: r.notes };
  });

export const actionCreateHandover = (payload, context) =>
  safe(async () => {
    const rec = await h.createHandover({
      personInput: payload.person,
      startDate: payload.startDate,
      endDate: payload.endDate,
      spaceKey: payload.spaceKey,
      context: ctx(payload, context),
    });
    return {
      saved: true,
      person: rec.person.name,
      window: rec.window,
      summary: rec.summary,
      handoverPack: rec.page?.url || 'Saved in Relay (no Confluence space given). Open the Relay page in Jira to review it.',
      nextStep: 'Ask the user to confirm before calling relay-apply-reassignments.',
      notes: rec.notes,
    };
  });

export const actionApplyReassignments = (payload, context) =>
  safe(async () => {
    const c = ctx(payload, context);
    const person = await h.resolvePerson(payload.person, c.accountId);
    const { record, results } = await h.applyReassignments(person.accountId);
    return {
      person: record.person.name,
      reassigned: results.filter((r) => r.ok),
      skipped: results.filter((r) => !r.ok),
      handoverPack: record.page?.url || null,
    };
  });

export const actionReturnBriefing = (payload, context) =>
  safe(async () => {
    const c = ctx(payload, context);
    const person = await h.resolvePerson(payload.person, c.accountId);
    return h.returnBriefing(person.accountId);
  });

export const actionWhoOwns = (payload, context) =>
  safe(async () => {
    const c = ctx(payload, context);
    const key = (payload.issueKey || c.issueKey || '').trim().toUpperCase();
    if (!key) return { error: 'Tell me which issue, for example PROJ-123.' };
    return h.whoOwns(key);
  });

// ---------- UI resolvers ----------

const ui = new Resolver();

ui.define('preview', async ({ payload, context }) =>
  safe(async () => {
    const r = await h.scan(payload.accountId, payload.startDate, payload.endDate, context, { withOwners: true });
    return { person: r.person, window: r.window, summary: r.summary, items: r.items, notes: r.notes };
  }),
);

ui.define('create', async ({ payload, context }) =>
  safe(() =>
    h.createHandover({
      personInput: payload.accountId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      spaceKey: payload.spaceKey,
      overrides: payload.overrides || {},
      context,
    }),
  ),
);

ui.define('apply', async ({ payload }) => safe(() => h.applyReassignments(payload.accountId, { overrides: payload.overrides || {} })));
ui.define('briefing', async ({ payload }) => safe(() => h.returnBriefing(payload.accountId)));
ui.define('list', async () => safe(async () => (await store.listHandovers()).sort((a, b) => a.window.start.localeCompare(b.window.start))));
ui.define('remove', async ({ payload }) => safe(async () => (await store.deleteHandover(payload.accountId), { ok: true })));

ui.define('panelInfo', async ({ context }) =>
  safe(async () => {
    const key = context?.extension?.issue?.key;
    if (!key) return { error: 'No issue in context' };
    return h.whoOwns(key);
  }),
);

export const resolver = ui.getDefinitions();

// ---------- Daily scheduled check (runs as the app) ----------
// Catches work that lands on someone while they are away and points to the cover owner.

export async function scheduler() {
  const today = isoDate(new Date());
  const all = await store.listHandovers();
  for (const rec of all) {
    try {
      if (rec.status === 'active' && rec.window.end < today) {
        rec.status = 'ended';
        await store.saveHandover(rec);
        continue;
      }
      if (rec.status !== 'active' && rec.status !== 'planned') continue;
      const issues = await jira.searchJql(
        `assignee = "${rec.person.accountId}" AND statusCategory != Done AND created >= -2d`,
        { fields: ['summary', 'project', 'components'], max: 50, mode: 'app' },
      );
      const known = new Set(rec.items.map((i) => i.key));
      rec.flagged = rec.flagged || [];
      for (const issue of issues) {
        if (known.has(issue.key) || rec.flagged.includes(issue.key)) continue;
        rec.flagged.push(issue.key);
        if (rec.status === 'active' && today >= rec.window.start) {
          const cover = coverFor(rec, issue);
          await jira.comment(
            issue.key,
            [
              `Relay: ${rec.person.name} is away until ${rec.window.end}.`,
              cover ? `${cover.name} is covering related work in ${issue.fields.project?.key} and is the best person to pick this up.` : 'Please pick a new owner.',
              rec.page?.url ? `Handover pack: ${rec.page.url}` : null,
            ],
            'app',
          );
        }
      }
      await store.saveHandover(rec);
    } catch (e) {
      console.error(`Relay scheduler failed for ${rec.person?.name}: ${e.message}`);
    }
  }
}

function coverFor(rec, issue) {
  const project = issue.fields.project?.key;
  const counts = new Map();
  for (const it of rec.items) {
    if (it.project !== project || !it.chosenOwner) continue;
    const c = counts.get(it.chosenOwner.accountId) || { ...it.chosenOwner, n: 0 };
    c.n += 1;
    counts.set(it.chosenOwner.accountId, c);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0] || null;
}
