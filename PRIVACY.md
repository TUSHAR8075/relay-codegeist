# Relay privacy policy

_Last updated: 11 November 2026_

Relay is a Forge app for Jira and Confluence, built by an independent developer for Atlassian Codegeist 2026.

## What Relay stores
When you create a handover plan, Relay saves it in Forge storage (Atlassian's key-value store for the app). A plan contains:
- the Atlassian account ID and display name of the person who is away, and of the suggested new owners
- the dates of the absence
- the Jira issue keys, titles, statuses, risk scores and the latest note from the person handing over
- the link to the Confluence handover page, if one was created

## What Relay reads but does not store
Relay reads Jira issues, Confluence pages and Teamwork Graph data (assigned work, pull requests, goals and teams) at the moment you run a scan. That data is used to calculate risk and suggest owners and is not kept afterwards, except for the fields listed above when a plan is saved.

## Where data lives
All data stays on Atlassian's infrastructure (Forge runtime and Forge storage). Relay has no external servers and makes no calls outside Atlassian. No data is sold or shared with third parties.

## What Relay changes
Only when a user explicitly applies a plan, Relay reassigns the listed Jira issues and adds a comment to each. It creates a Confluence page only when a user asks it to publish a handover pack.

## Deleting data
Remove a handover from the Relay page in Jira to delete its stored plan. Uninstalling Relay deletes all of its Forge storage.

## Contact
tusharguptagpt230@gmail.com
