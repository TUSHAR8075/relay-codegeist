// Risk model. Pure functions.
//
//   risk = 100 * (0.35 urgency + 0.25 blocked + 0.20 busFactor + 0.15 visibility + 0.05 active)
//
// Every component is in [0, 1]. Reasons are kept so the agent and UI can explain the score.

export const WEIGHTS = { urgency: 0.35, blocked: 0.25, busFactor: 0.2, visibility: 0.15, active: 0.05 };

const PRIORITY = { Highest: 1, Critical: 1, Blocker: 1, High: 0.8, Medium: 0.5, Low: 0.25, Lowest: 0.1 };
const DAY = 86400000;

export function urgency(item, window) {
  const p = PRIORITY[item.priority] ?? 0.4;
  let d = 0.15;
  let reason = null;
  if (item.dueDate) {
    const due = Date.parse(item.dueDate);
    const start = Date.parse(window.start);
    const end = Date.parse(window.end) + DAY - 1;
    if (due < start) {
      d = 0.8;
      reason = `due ${item.dueDate}, before the absence starts`;
    } else if (due <= end) {
      d = 1;
      reason = `due ${item.dueDate}, while away`;
    } else {
      const after = (due - end) / DAY;
      d = after <= 7 ? 0.6 : after <= 30 ? 0.3 : 0.1;
      if (after <= 7) reason = `due ${item.dueDate}, right after return`;
    }
  }
  if (p >= 0.8) reason = reason ? `${reason}; ${item.priority} priority` : `${item.priority} priority`;
  return { value: 0.5 * p + 0.5 * d, reason };
}

export function blocked(item) {
  const n = item.blockedDependents || 0;
  return { value: Math.min(n, 5) / 5, reason: n ? `blocks ${n} open item${n > 1 ? 's' : ''}` : null };
}

export function busFactor(item) {
  const others = (item.otherContributors || []).length;
  const value = [1, 0.6, 0.3][others] ?? 0.1;
  const reason = others === 0 ? 'nobody else has touched it' : others === 1 ? 'only one other person has context' : null;
  return { value, reason };
}

export function visibility(item) {
  const watchers = item.watchers || 0;
  const goals = item.linkedGoals || 0;
  const pr = item.type === 'pr' ? 2 : 0;
  const value = Math.min((watchers + 3 * goals + pr) / 10, 1);
  const parts = [];
  if (goals) parts.push(`linked to ${goals} goal${goals > 1 ? 's' : ''}`);
  if (watchers >= 3) parts.push(`${watchers} watchers`);
  return { value, reason: parts.length ? parts.join(', ') : null };
}

export function active(item) {
  const inProgress = item.statusCategory === 'indeterminate';
  return { value: inProgress ? 1 : 0, reason: inProgress ? 'in progress' : null };
}

export function tier(score) {
  if (score >= 70) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function scoreItem(item, window) {
  const parts = {
    urgency: urgency(item, window),
    blocked: blocked(item),
    busFactor: busFactor(item),
    visibility: visibility(item),
    active: active(item),
  };
  let total = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) total += w * parts[k].value;
  const score = Math.round(100 * total);
  const reasons = Object.values(parts).map((p) => p.reason).filter(Boolean);
  const breakdown = Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, Math.round(p.value * 100) / 100]));
  return { score, tier: tier(score), reasons, breakdown };
}

export function scoreAll(items, window) {
  return items
    .map((it) => ({ ...it, risk: scoreItem(it, window) }))
    .sort((a, b) => b.risk.score - a.risk.score);
}

export function summarise(scored) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const it of scored) counts[it.risk.tier] += 1;
  return { total: scored.length, ...counts };
}
