// Teamwork Graph client: curated queries only (raw Cypher is not available to new apps).
// Calls run as the user (asUser is the only documented backend path). Every failure is
// soft: we return [] plus a note so the rest of Relay keeps working from Jira/Confluence.
import api from '@forge/api';

const PREFIX = 'relayapp_'; // operation names must look like [company]_[operation]

function userAri(accountId) {
  return accountId.startsWith('ari:') ? accountId : `ari:cloud:identity::user/${accountId}`;
}

async function run(op, query, variables, notes) {
  try {
    const res = await api.asUser().requestTeamworkGraph(query.replace('query OP', `query ${PREFIX}${op}`), variables);
    const json = await res.json();
    // Errors often come back with HTTP 200, so check the body, not res.ok.
    if (json.errors?.length) {
      notes.push(`Teamwork Graph ${op}: ${json.errors[0].message}`);
      return null;
    }
    return json.data;
  } catch (e) {
    notes.push(`Teamwork Graph ${op} unavailable: ${e.message}`);
    return null;
  }
}

async function paged(op, field, query, variables, notes, maxPages = 4) {
  const nodes = [];
  let after = null;
  for (let i = 0; i < maxPages; i += 1) {
    const data = await run(op, query, { ...variables, after }, notes);
    const conn = data?.[field];
    if (!conn) break;
    for (const e of conn.edges || []) if (e?.node) nodes.push(e.node);
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return nodes;
}

const ASSIGNED = `query OP($userId: ID!, $after: String) {
  atlassianUserAssignedJiraWorkItems(userId: $userId, first: 25, after: $after) {
    edges { node { __typename ... on JiraWorkItem {
      id issueId key summary dueAt webUrl
      status { name statusCategory { key } }
    } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const PULL_REQUESTS = `query OP($userId: ID!, $after: String) {
  atlassianUserPullRequests(userId: $userId, since: "P60D", first: 25, after: $after) {
    edges { node { __typename ... on ExternalPullRequest {
      id displayId title url status lastUpdatedAt commentCount
    } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const TEAMS = `query OP($userId: ID!, $after: String) {
  atlassianUserInTeams(userId: $userId, first: 25, after: $after) {
    edges { node { __typename ... on AtlassianTeam { id displayName } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const MEMBERS = `query OP($teamAri: ID!, $after: String) {
  atlassianTeamMembers(teamAri: $teamAri, first: 25, after: $after) {
    edges { node { __typename ... on AtlassianUser { id name } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const GOALS = `query OP($id: ID!, $after: String) {
  jiraWorkItemGoals(id: $id, first: 25, after: $after) {
    edges { node { __typename } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function assignedWorkItems(accountId, notes) {
  return paged('assignedWork', 'atlassianUserAssignedJiraWorkItems', ASSIGNED, { userId: userAri(accountId) }, notes);
}

export async function pullRequests(accountId, notes) {
  const nodes = await paged('pullRequests', 'atlassianUserPullRequests', PULL_REQUESTS, { userId: userAri(accountId) }, notes, 2);
  return nodes.filter((n) => n.__typename === 'ExternalPullRequest');
}

/** Returns Map<accountId, name> of everyone who shares a team with the user. */
export async function teammates(accountId, notes) {
  const out = new Map();
  const teams = await paged('userTeams', 'atlassianUserInTeams', TEAMS, { userId: userAri(accountId) }, notes, 1);
  for (const t of teams.slice(0, 5)) {
    if (!t.id) continue;
    const members = await paged('teamMembers', 'atlassianTeamMembers', MEMBERS, { teamAri: t.id }, notes, 2);
    for (const m of members) {
      const id = String(m.id || '').replace(/^.*user\//, '');
      if (id && id !== accountId) out.set(id, m.name || id);
    }
  }
  return { teams: teams.map((t) => t.displayName).filter(Boolean), members: out };
}

export async function goalCount(workItemAri, notes) {
  if (!workItemAri) return 0;
  const nodes = await paged('workItemGoals', 'jiraWorkItemGoals', GOALS, { id: workItemAri }, notes, 1);
  return nodes.length;
}
