import { kvs, WhereConditions } from '@forge/kvs';

const key = (accountId) => `handover:${accountId}`;

export const getHandover = (accountId) => kvs.get(key(accountId));
export const saveHandover = (record) => kvs.set(key(record.person.accountId), { ...record, updatedAt: new Date().toISOString() });
export const deleteHandover = (accountId) => kvs.delete(key(accountId));

export async function listHandovers() {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith('handover:')).limit(20);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    out.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/** Find the handover (if any) that covers a given Jira issue key. */
export async function findByIssue(issueKey) {
  const all = await listHandovers();
  for (const h of all) {
    const item = h.items?.find((i) => i.key === issueKey);
    if (item) return { handover: h, item };
  }
  return null;
}
