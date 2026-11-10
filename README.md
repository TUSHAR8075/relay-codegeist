# Relay: handovers built from the Teamwork Graph

> Priya goes on leave on Friday. Relay finds everything she owns, scores what could break, picks who should take each item, writes the handover pack and catches new work that lands on her while she is away.

**Atlassian Codegeist 2026 · Apps for Software Teams · Rovo Agent · Atlassian MCP · Teamwork Graph**

## What it does

| Step | What happens | Built on |
|---|---|---|
| 1. Trigger | "I'm off two weeks from Monday" in Rovo chat, or the Relay page in Jira | `rovo:agent`, `jira:globalPage` |
| 2. Graph sweep | Assigned work items, open PRs, linked goals, teams and teammates | Teamwork Graph curated queries |
| 3. Enrich | Priority, due dates, blocking links, watchers, comments, Confluence pages | Jira and Confluence REST |
| 4. Risk score | Each item gets a 0 to 100 score plus the reasons behind it | `src/lib/risk.js` |
| 5. New owners | Ranked by expertise, involvement, team and workload, spread so one person doesn't get everything | `src/lib/owners.js` |
| 6. Handover pack | A Confluence page with status, next step, context and who to ask for every item | Confluence v2 API |
| 7. Apply | Reassigns the issues and leaves a context comment on each one | Jira REST |
| 8. While away | A daily job finds new issues assigned to the absent person and points to the cover owner | `scheduledTrigger` |
| 9. Return briefing | "I'm back. What changed?": finished, still open, new comments | Rovo action and dashboard |

### Risk model

$$\text{risk} = 100\,(0.35\,u + 0.25\,b + 0.20\,f + 0.15\,v + 0.05\,a)$$

| Term | Meaning |
|---|---|
| $u$ urgency | Priority, plus whether it's due before, during or just after the absence |
| $b$ blocked | Open issues this item blocks, $\min(n,5)/5$ |
| $f$ bus factor | 1.0 if nobody else has touched it, then 0.6, 0.3 and 0.1 |
| $v$ visibility | Watchers, linked goals (from Teamwork Graph) and PRs |
| $a$ active | Whether it's in progress right now |

Tiers: critical ≥ 70, high ≥ 45, medium ≥ 25, low below 25.

### Owner fit

$$\text{fit} = 0.45\,e + 0.25\,i + 0.15\,t + 0.15\,(1-\ell) - 0.06\,r$$

$e$ is recent expertise in the same project and components, $i$ is whether they're already involved in the item, $t$ is whether they share a Teamwork Graph team, $\ell$ is their current load, and $r$ is the number of items they've already received in this handover. Anyone away in an overlapping window is excluded.

## How it meets the requirements

Relay is a Forge app (Node 22 runtime, UI Kit) on Jira, with Confluence as an optional product. It reads the **Teamwork Graph** through curated queries (`atlassianUserAssignedJiraWorkItems`, `atlassianUserPullRequests`, `jiraWorkItemGoals`, `atlassianUserInTeams`, `atlassianTeamMembers`) and enriches the results with the Jira and Confluence REST APIs. It ships a **Rovo agent** (`rovo:agent`) with six actions; four of them are exposed as an **MCP server** (`rovo:mcp`). A `jira:globalPage` dashboard, a `jira:issuePanel` and a daily `scheduledTrigger` complete the flow. All data stays in Forge storage on Atlassian's infrastructure.

## Project layout

```
manifest.yml              Rovo agent, 6 actions, rovo:mcp, Jira page + issue panel, daily trigger
src/index.js              Action handlers, UI resolvers, scheduler
src/lib/twg.js            Teamwork Graph curated queries (asUser, soft-fail, paging)
src/lib/jira.js           Jira REST + item normalisation
src/lib/confluence.js     Page search + handover pack publishing
src/lib/handover.js       Orchestration: scan → score → owners → pack → apply → brief
src/lib/risk.js           Risk model (pure)
src/lib/owners.js         Owner ranking (pure)
src/lib/pack.js           Confluence storage-format renderer (pure)
src/lib/store.js          Forge KVS persistence
src/frontend/*.jsx        UI Kit dashboard + issue panel
scripts/seed-demo.js      Creates a demo scenario in a Jira project
test/core.test.js         Unit tests for risk, owners, pack, utils
```

## Run it yourself

Requires Node 22+, Forge CLI 15+ and an Atlassian site (Rovo chat needs a Rovo-enabled site).

```bash
npm install -g @forge/cli@latest
forge login
npm install
forge register
npm test
forge deploy
forge install --product jira --site <your-site>.atlassian.net
forge install --product confluence --site <your-site>.atlassian.net
```

Then open **Apps → Relay** in Jira, pick who is away, and click **Scan their work**.

## Privacy

See [PRIVACY.md](PRIVACY.md).

## License

MIT
