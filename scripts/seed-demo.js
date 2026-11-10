// Seeds a Jira project with a realistic "Priya is going on leave" scenario for the demo video.
//
// Usage (run on your own machine, not inside Forge):
//   SITE=https://tushar-dev.atlassian.net EMAIL=you@example.com TOKEN=<api token> \
//   PROJECT=PAY LEAVER="Priya" node scripts/seed-demo.js
//
// TOKEN: https://id.atlassian.com/manage-profile/security/api-tokens
// LEAVER: display name (or account ID) of the demo user who will "go on leave".

const { SITE, EMAIL, TOKEN, PROJECT, LEAVER } = process.env;
if (!SITE || !EMAIL || !TOKEN || !PROJECT || !LEAVER) {
  console.error('Set SITE, EMAIL, TOKEN, PROJECT and LEAVER.');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;
async function jira(path, method = 'GET', body) {
  const res = await fetch(`${SITE}${path}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const doc = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const ISSUES = [
  { s: 'Refund API times out for orders over 50 line items', p: 'Highest', due: 3, comp: 'payments', note: 'Root cause is the N+1 on line items. Fix is on branch fix/refund-batch, needs load test before merge.' },
  { s: 'Migrate payment webhooks to v2 signing', p: 'High', due: 9, comp: 'payments', note: 'Stripe deprecates v1 on the 20th. Staging is done, prod switch is a config flag.' },
  { s: 'Quarterly PCI evidence collection', p: 'High', due: 12, comp: 'compliance', note: 'Auditor contact is in the Confluence page. Screenshots 1-14 done, 15-22 left.' },
  { s: 'Checkout latency regression on mobile', p: 'Medium', due: 6, comp: 'checkout', note: 'Looks like the new fraud script. Waiting on vendor reply.' },
  { s: 'Add idempotency keys to payout endpoint', p: 'Medium', due: 25, comp: 'payments' },
  { s: 'Document retry policy for failed charges', p: 'Low', due: null, comp: 'payments' },
  { s: 'Clean up unused feature flags', p: 'Low', due: null, comp: 'checkout' },
  { s: 'Investigate duplicate invoice emails', p: 'Medium', due: 15, comp: 'billing', note: 'Only happens for annual plans. Repro steps in the first comment.' },
];
const BLOCKED = ['Release 4.2 payments hotfix', 'Partner bank go-live checklist', 'Finance month-end reconciliation'];

async function main() {
  let leaverId = LEAVER;
  if (!/^[0-9a-f]{24}$|^\d{6}:/.test(LEAVER)) {
    const users = await jira(`/rest/api/3/user/search?query=${encodeURIComponent(LEAVER)}`);
    if (!users.length) throw new Error(`No user matches ${LEAVER}`);
    leaverId = users[0].accountId;
    console.log(`Leaver: ${users[0].displayName} (${leaverId})`);
  }

  const project = await jira(`/rest/api/3/project/${PROJECT}`);
  const existing = new Set((project.components || []).map((c) => c.name));
  for (const name of new Set(ISSUES.map((i) => i.comp))) {
    if (existing.has(name)) continue;
    try {
      await jira('/rest/api/3/component', 'POST', { name, project: PROJECT });
    } catch (e) {
      console.warn(`Could not create component ${name} (needs project admin): ${e.message.slice(0, 80)}`);
    }
  }
  const comps = new Set(((await jira(`/rest/api/3/project/${PROJECT}`)).components || []).map((c) => c.name));
  const issueType = (project.issueTypes || []).find((t) => !t.subtask && /task/i.test(t.name)) || project.issueTypes.find((t) => !t.subtask);

  const created = [];
  for (const it of ISSUES) {
    const fields = {
      project: { key: PROJECT },
      issuetype: { id: issueType.id },
      summary: it.s,
      priority: { name: it.p },
      assignee: { accountId: leaverId },
    };
    if (it.due !== null) fields.duedate = day(it.due);
    if (comps.has(it.comp)) fields.components = [{ name: it.comp }];
    let res;
    try {
      res = await jira('/rest/api/3/issue', 'POST', { fields });
    } catch {
      delete fields.priority; // some schemes hide priority
      res = await jira('/rest/api/3/issue', 'POST', { fields });
    }
    created.push(res.key);
    console.log(`Created ${res.key} ${it.s}`);
    if (it.note) await jira(`/rest/api/3/issue/${res.key}/comment`, 'POST', { body: doc(it.note) });
  }

  // The top issue blocks three others, so Relay sees real downstream risk.
  // Jira's link direction is easy to get backwards, so check it and flip if needed.
  let swap = false;
  for (const [i, s] of BLOCKED.entries()) {
    const b = await jira('/rest/api/3/issue', 'POST', { fields: { project: { key: PROJECT }, issuetype: { id: issueType.id }, summary: s } });
    const pair = swap ? { inwardIssue: { key: b.key }, outwardIssue: { key: created[0] } } : { inwardIssue: { key: created[0] }, outwardIssue: { key: b.key } };
    await jira('/rest/api/3/issueLink', 'POST', { type: { name: 'Blocks' }, ...pair });
    if (i === 0) {
      const { fields } = await jira(`/rest/api/3/issue/${created[0]}?fields=issuelinks`);
      const ok = fields.issuelinks.some((l) => l.outwardIssue?.key === b.key);
      if (!ok) {
        const link = fields.issuelinks.find((l) => l.inwardIssue?.key === b.key);
        if (link) await jira(`/rest/api/3/issueLink/${link.id}`, 'DELETE');
        swap = true;
        await jira('/rest/api/3/issueLink', 'POST', { type: { name: 'Blocks' }, inwardIssue: { key: b.key }, outwardIssue: { key: created[0] } });
      }
    }
    console.log(`${created[0]} blocks ${b.key}`);
  }
  // Move the first two issues to In Progress when the workflow allows it.
  for (const key of created.slice(0, 2)) {
    const { transitions } = await jira(`/rest/api/3/issue/${key}/transitions`);
    const t = transitions.find((x) => x.to?.statusCategory?.key === 'indeterminate');
    if (t) await jira(`/rest/api/3/issue/${key}/transitions`, 'POST', { transition: { id: t.id } });
  }
  console.log('\nDone. Assign a few other recent PROJECT issues to teammates so Relay has owners to suggest.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
