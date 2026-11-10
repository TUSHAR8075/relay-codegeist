// Owner suggestion. Pure ranking over a candidate profile built from Jira + Teamwork Graph.
//
//   fit = 0.45 expertise + 0.25 involvement + 0.15 teammate + 0.15 (1 - load) - 0.06 received
//
// candidates: Map<accountId, {
//   name, projects: {KEY: n}, components: {name: n}, openLoad: number,
//   teammate: boolean, unavailable: boolean }>

export const OWNER_WEIGHTS = { expertise: 0.45, involvement: 0.25, teammate: 0.15, capacity: 0.15 };

function expertiseFor(item, c) {
  const proj = c.projects?.[item.project] || 0;
  const comp = (item.components || []).reduce((s, name) => s + (c.components?.[name] || 0), 0);
  // Saturate: 6 recent items in the project, 3 in the same components count as full expertise.
  const p = Math.min(proj / 6, 1);
  if (!item.components?.length) return p;
  return 0.5 * p + 0.5 * Math.min(comp / 3, 1);
}

export function rankOwners(item, candidates, { exclude = [], maxLoad, limit = 3 } = {}) {
  const loads = [...candidates.values()].map((c) => c.openLoad || 0);
  const cap = maxLoad ?? Math.max(10, ...loads);
  const involved = new Set((item.otherContributors || []).map((p) => p.accountId));
  const out = [];
  for (const [accountId, c] of candidates) {
    if (exclude.includes(accountId) || c.unavailable) continue;
    const expertise = expertiseFor(item, c);
    const involvement = involved.has(accountId) ? 1 : 0;
    const teammate = c.teammate ? 1 : 0;
    const capacity = 1 - Math.min((c.openLoad || 0) / cap, 1);
    // Each item already received in this handover costs 0.06, so one person
    // does not inherit everything.
    const fit = Math.max(
      0,
      OWNER_WEIGHTS.expertise * expertise +
        OWNER_WEIGHTS.involvement * involvement +
        OWNER_WEIGHTS.teammate * teammate +
        OWNER_WEIGHTS.capacity * capacity -
        0.06 * (c.received || 0),
    );
    if (expertise === 0 && involvement === 0 && teammate === 0) continue;
    const why = [];
    if (involvement) why.push('already involved in this item');
    if (c.projects?.[item.project]) why.push(`${c.projects[item.project]} recent ${item.project} items`);
    const comps = (item.components || []).filter((n) => c.components?.[n]);
    if (comps.length) why.push(`works on ${comps.join(', ')}`);
    if (teammate) why.push('same team');
    why.push(`${c.openLoad || 0} open items`);
    out.push({ accountId, name: c.name, fit: Math.round(fit * 100), why });
  }
  return out.sort((a, b) => b.fit - a.fit).slice(0, limit);
}

/** Spread load: once someone is picked, their load goes up for the next item. */
export function assignGreedy(items, candidates, opts = {}) {
  const working = new Map([...candidates].map(([k, v]) => [k, { ...v }]));
  return items.map((item) => {
    const suggestions = rankOwners(item, working, opts);
    const chosen = suggestions[0] || null;
    if (chosen) {
      const c = working.get(chosen.accountId);
      c.openLoad = (c.openLoad || 0) + 1;
      c.received = (c.received || 0) + 1;
    }
    return { ...item, suggestions, chosenOwner: chosen ? { accountId: chosen.accountId, name: chosen.name } : null };
  });
}
