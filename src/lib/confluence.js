import api, { route } from '@forge/api';

const as = (mode) => (mode === 'app' ? api.asApp() : api.asUser());

async function json(res, what) {
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Pages the person contributed to in the last 60 days (CQL search). */
export async function recentPages(accountId, mode = 'user', notes = []) {
  const cql = `type = page AND contributor = "${accountId}" AND lastmodified >= now("-60d") ORDER BY lastmodified DESC`;
  try {
    const res = await as(mode).requestConfluence(route`/wiki/rest/api/search?cql=${cql}&limit=15`, {
      headers: { Accept: 'application/json' },
    });
    const data = await json(res, 'Confluence search');
    const base = data._links?.base || '';
    return (data.results || [])
      .filter((r) => r.content?.id && !/^Handover: |^Template - |^Getting started in Confluence|^Overview$|^My first space$/.test(r.content.title || ''))
      .map((r) => ({
        type: 'page',
        id: r.content.id,
        key: null,
        title: r.content.title || r.title,
        url: r.url ? `${base}${r.url}` : null,
        status: 'Published',
        statusCategory: 'page',
        priority: 'Low',
        updated: r.lastModified,
        watchers: 0,
        blockedDependents: 0,
        otherContributors: [],
      }));
  } catch (e) {
    notes.push(`Confluence pages skipped: ${e.message}`);
    return [];
  }
}

export async function spaceId(spaceKey, mode = 'user') {
  const res = await as(mode).requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`, { headers: { Accept: 'application/json' } });
  const data = await json(res, 'Confluence space lookup');
  const id = data.results?.[0]?.id;
  if (!id) throw new Error(`Confluence space ${spaceKey} not found or not visible`);
  return id;
}

export async function createPage({ spaceKey, title, storage, mode = 'user' }) {
  const id = await spaceId(spaceKey, mode);
  const res = await as(mode).requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId: id, status: 'current', title, body: { representation: 'storage', value: storage } }),
  });
  const page = await json(res, 'Create Confluence page');
  const base = page._links?.base || '';
  return { id: page.id, url: page._links?.webui ? `${base}${page._links.webui}` : null };
}
