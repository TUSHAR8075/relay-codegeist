// Jira REST client. mode 'user' acts as the person using Relay; 'app' is for the scheduler.
import api, { route } from '@forge/api';
import { adfDoc, adfToText, prettyName } from './util.js';

const as = (mode) => (mode === 'app' ? api.asApp() : api.asUser());

async function json(res, what) {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${what} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export const ISSUE_FIELDS = [
  'summary', 'status', 'priority', 'duedate', 'issuelinks', 'watches',
  'components', 'labels', 'project', 'updated', 'assignee', 'reporter', 'comment',
];

export async function searchJql(jql, { fields = ISSUE_FIELDS, max = 100, mode = 'user' } = {}) {
  const issues = [];
  let nextPageToken;
  do {
    const res = await as(mode).requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, maxResults: Math.min(100, max - issues.length), nextPageToken }),
    });
    const data = await json(res, 'Jira search');
    issues.push(...(data.issues || []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken && issues.length < max);
  return issues;
}

export async function countJql(jql, mode = 'user') {
  const res = await as(mode).requestJira(route`/rest/api/3/search/approximate-count`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jql }),
  });
  const data = await json(res, 'Jira count');
  return data.count ?? 0;
}

export async function getIssue(key, mode = 'user') {
  const res = await as(mode).requestJira(route`/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS.join(',')}`, {
    headers: { Accept: 'application/json' },
  });
  return json(res, `Get ${key}`);
}

export async function getComments(key, mode = 'user') {
  const res = await as(mode).requestJira(route`/rest/api/3/issue/${key}/comment?orderBy=-created&maxResults=50`, {
    headers: { Accept: 'application/json' },
  });
  const data = await json(res, `Comments ${key}`);
  return data.comments || [];
}

export async function assign(key, accountId, mode = 'user') {
  const res = await as(mode).requestJira(route`/rest/api/3/issue/${key}/assignee`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  return json(res, `Assign ${key}`);
}

export async function comment(key, paragraphs, mode = 'user') {
  const res = await as(mode).requestJira(route`/rest/api/3/issue/${key}/comment`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: adfDoc(paragraphs) }),
  });
  return json(res, `Comment ${key}`);
}

export async function getUser(accountId, mode = 'user') {
  const res = await as(mode).requestJira(route`/rest/api/3/user?accountId=${accountId}`, { headers: { Accept: 'application/json' } });
  return json(res, 'Get user');
}

export async function searchUsers(query, mode = 'user') {
  const res = await as(mode).requestJira(route`/rest/api/3/user/search?query=${query}&maxResults=5`, {
    headers: { Accept: 'application/json' },
  });
  const users = await json(res, 'User search');
  return (users || []).filter((u) => u.accountType === 'atlassian' && u.active !== false);
}

export async function siteUrl(mode = 'user') {
  const res = await as(mode).requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } });
  const data = await json(res, 'Server info');
  return data.baseUrl;
}

/** Convert a Jira issue into Relay's normalised item. */
export function toItem(issue, ownerId, baseUrl) {
  const f = issue.fields || {};
  const blockedDependents = (f.issuelinks || []).filter(
    (l) => l.type?.outward === 'blocks' && l.outwardIssue && l.outwardIssue.fields?.status?.statusCategory?.key !== 'done',
  ).length;
  const comments = f.comment?.comments || [];
  const others = new Map();
  for (const c of comments) {
    const id = c.author?.accountId;
    if (id && id !== ownerId) others.set(id, prettyName(c.author.displayName));
  }
  if (f.reporter?.accountId && f.reporter.accountId !== ownerId) others.set(f.reporter.accountId, prettyName(f.reporter.displayName));
  const mine = comments.filter((c) => c.author?.accountId === ownerId);
  const last = mine[mine.length - 1];
  return {
    type: 'jira',
    id: issue.id,
    key: issue.key,
    title: f.summary,
    url: baseUrl ? `${baseUrl}/browse/${issue.key}` : null,
    status: f.status?.name,
    statusCategory: f.status?.statusCategory?.key,
    priority: f.priority?.name,
    dueDate: f.duedate || null,
    updated: f.updated,
    project: f.project?.key,
    components: (f.components || []).map((c) => c.name),
    labels: f.labels || [],
    watchers: f.watches?.watchCount || 0,
    blockedDependents,
    otherContributors: [...others].map(([accountId, name]) => ({ accountId, name })),
    lastNote: last ? adfToText(last.body).trim() : null,
    assignee: f.assignee ? { accountId: f.assignee.accountId, name: prettyName(f.assignee.displayName) } : null,
  };
}
