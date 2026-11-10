import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, DatePicker, DynamicTable, Heading, Inline, Label, Link, Lozenge,
  SectionMessage, Select, Spinner, Stack, Text, Textfield, UserPicker, useProductContext, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const statBox = xcss({ padding: 'space.150', borderRadius: 'border.radius', backgroundColor: 'color.background.neutral' });
const pickerBox = xcss({ width: '280px' });
const TIER = { critical: 'removed', high: 'moved', medium: 'inprogress', low: 'default' };
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const plus = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

function Stat({ label, value, tier }) {
  return (
    <Box xcss={statBox}>
      <Stack space="space.050">
        <Heading as="h3">{String(value)}</Heading>
        {tier ? <Lozenge appearance={TIER[tier]}>{label}</Lozenge> : <Text>{label}</Text>}
      </Stack>
    </Box>
  );
}

function Plan({ onSaved }) {
  const context = useProductContext();
  const [person, setPerson] = useState(null);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(plus(today(), 14));
  const [spaceKey, setSpaceKey] = useState('');
  const [busy, setBusy] = useState(null);
  const [plan, setPlan] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const accountId = person?.id || context?.accountId;

  async function call(name, payload, label) {
    setBusy(label);
    setError(null);
    const res = await invoke(name, payload);
    setBusy(null);
    if (res?.error) setError(res.error);
    return res?.error ? null : res;
  }

  const preview = async () => {
    setDone(null);
    const res = await call('preview', { accountId, startDate: start, endDate: end }, 'Scanning the Teamwork Graph…');
    if (res) { setPlan(res); setOverrides({}); }
  };
  const save = async () => {
    const res = await call('create', { accountId, startDate: start, endDate: end, spaceKey: spaceKey.trim() || null, overrides }, 'Writing the handover pack…');
    if (res) { setDone({ type: 'saved', page: res.page, notes: res.notes }); onSaved(); }
  };
  const apply = async () => {
    const res = await call('apply', { accountId, overrides }, 'Reassigning and leaving context…');
    if (res) { setDone({ type: 'applied', results: res.results, page: res.record.page }); onSaved(); }
  };

  const ownerOptions = (item) => [
    ...(item.suggestions || []).map((s) => ({ label: `${s.name} (fit ${s.fit})`, value: s.accountId })),
    { label: 'Leave unassigned', value: '__none' },
  ];

  const rows = (plan?.items || []).map((it) => {
    const id = it.key || it.id;
    const opts = ownerOptions(it);
    const current = overrides[id] === null ? '__none' : overrides[id]?.accountId || it.chosenOwner?.accountId || '__none';
    return {
      key: id,
      cells: [
        { key: 'item', content: <Stack space="space.0"><Link href={it.url || '#'}>{`${it.key ? `${it.key} ` : ''}${it.title}`}</Link><Text size="small">{it.risk.reasons.join(' · ') || 'routine'}</Text></Stack> },
        { key: 'type', content: <Lozenge>{it.type === 'jira' ? 'Issue' : it.type === 'pr' ? 'PR' : 'Page'}</Lozenge> },
        { key: 'risk', content: <Inline space="space.050"><Lozenge appearance={TIER[it.risk.tier]}>{it.risk.tier}</Lozenge><Text>{String(it.risk.score)}</Text></Inline> },
        { key: 'status', content: <Text>{it.status || ''}</Text> },
        {
          key: 'owner',
          content: (
            <Select
              appearance="subtle"
              spacing="compact"
              options={opts}
              value={opts.find((o) => o.value === current)}
              onChange={(o) => {
                const s = (it.suggestions || []).find((x) => x.accountId === o.value);
                setOverrides({ ...overrides, [id]: s ? { accountId: s.accountId, name: s.name } : null });
              }}
            />
          ),
        },
      ],
    };
  });

  return (
    <Stack space="space.200">
      <Heading as="h2">Plan a handover</Heading>
      <Inline space="space.200" alignBlock="end" shouldWrap>
        <Box xcss={pickerBox}>
          <UserPicker label="Who is away?" name="person" placeholder="Leave empty for yourself" onChange={setPerson} />
        </Box>
        <Stack space="space.050"><Label labelFor="start">First day away</Label><DatePicker id="start" value={start} onChange={setStart} /></Stack>
        <Stack space="space.050"><Label labelFor="end">Last day away</Label><DatePicker id="end" value={end} onChange={setEnd} /></Stack>
        <Stack space="space.050"><Label labelFor="space">Confluence space key (optional)</Label><Textfield id="space" value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} /></Stack>
        <Button appearance="primary" onClick={preview} isDisabled={!!busy}>Scan their work</Button>
      </Inline>

      {busy && <Inline space="space.100" alignBlock="center"><Spinner /><Text>{busy}</Text></Inline>}
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}

      {plan && !busy && (
        <Stack space="space.200">
          <Text weight="bold">{`${plan.person.name} is away ${plan.window.start} to ${plan.window.end}. Relay found ${plan.summary.total} open items.`}</Text>
          <Inline space="space.150">
            <Stat label="critical" value={plan.summary.critical} tier="critical" />
            <Stat label="high" value={plan.summary.high} tier="high" />
            <Stat label="medium" value={plan.summary.medium} tier="medium" />
            <Stat label="low" value={plan.summary.low} tier="low" />
          </Inline>
          {plan.notes?.length > 0 && (
            <SectionMessage appearance="warning" title="Some sources returned partial data">
              {plan.notes.map((n) => <Text key={n}>{n}</Text>)}
            </SectionMessage>
          )}
          <DynamicTable
            head={{ cells: [
              { key: 'item', content: 'Item' }, { key: 'type', content: 'Type' }, { key: 'risk', content: 'Risk' },
              { key: 'status', content: 'Status' }, { key: 'owner', content: 'New owner' },
            ] }}
            rows={rows}
            rowsPerPage={15}
            emptyView="Nothing open. Enjoy the time off."
          />
          <ButtonGroup>
            <Button appearance="primary" onClick={save}>Save plan and publish pack</Button>
            <Button onClick={apply}>Apply reassignments</Button>
          </ButtonGroup>
        </Stack>
      )}

      {done?.type === 'saved' && (
        <SectionMessage appearance="success" title="Handover plan saved">
          {done.page?.url ? <Link href={done.page.url}>Open the handover pack in Confluence</Link> : <Text>Saved in Relay. Add a space key to publish a Confluence pack.</Text>}
          {(done.notes || []).map((n) => <Text key={n}>{n}</Text>)}
        </SectionMessage>
      )}
      {done?.type === 'applied' && (
        <SectionMessage appearance="success" title="Reassignments applied">
          <Text>{`${done.results.filter((r) => r.ok).length} issues handed over, ${done.results.filter((r) => !r.ok).length} skipped. Each issue has a context comment.`}</Text>
        </SectionMessage>
      )}
    </Stack>
  );
}

function Active({ refreshKey }) {
  const [list, setList] = useState(null);
  const [briefing, setBriefing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setList(await invoke('list'));
  useEffect(() => { load(); }, [refreshKey]);

  const brief = async (accountId) => {
    setBusy(true);
    setBriefing(await invoke('briefing', { accountId }));
    setBusy(false);
    load();
  };

  if (!list) return <Spinner />;
  if (list.error) return <SectionMessage appearance="error"><Text>{list.error}</Text></SectionMessage>;

  return (
    <Stack space="space.200">
      <Heading as="h2">Handovers</Heading>
      <DynamicTable
        head={{ cells: [{ key: 'p', content: 'Person' }, { key: 'w', content: 'Away' }, { key: 's', content: 'Status' }, { key: 'r', content: 'Risk' }, { key: 'a', content: '' }] }}
        rows={list.map((h) => ({
          key: h.person.accountId,
          cells: [
            { key: 'p', content: <Text>{h.person.name}</Text> },
            { key: 'w', content: <Text>{`${h.window.start} → ${h.window.end}`}</Text> },
            { key: 's', content: <Lozenge appearance={h.status === 'active' ? 'inprogress' : h.status === 'returned' ? 'success' : 'new'}>{h.status}</Lozenge> },
            { key: 'r', content: <Text>{`${h.summary.critical} critical · ${h.summary.high} high · ${(h.flagged || []).length} new while away`}</Text> },
            {
              key: 'a',
              content: (
                <ButtonGroup>
                  {h.page?.url && <Link href={h.page.url}>Pack</Link>}
                  <Button spacing="compact" onClick={() => brief(h.person.accountId)}>Return briefing</Button>
                  <Button spacing="compact" appearance="subtle" onClick={async () => { await invoke('remove', { accountId: h.person.accountId }); load(); }}>Remove</Button>
                </ButtonGroup>
              ),
            },
          ],
        }))}
        emptyView="No handovers yet."
      />
      {busy && <Spinner />}
      {briefing && !busy && (
        briefing.error ? <SectionMessage appearance="error"><Text>{briefing.error}</Text></SectionMessage> : (
          <SectionMessage appearance="information" title={`Welcome back, ${briefing.person}`}>
            <Text>{`${briefing.finished} finished · ${briefing.stillOpen} still open · ${briefing.changed} changed status while you were away.`}</Text>
            {briefing.items.slice(0, 10).map((i) => (
              <Text key={i.key}>{`${i.key}: ${i.before} → ${i.now} (held by ${i.heldBy}, ${i.newComments} new comments)${i.latest ? ` · ${i.latest}` : ''}`}</Text>
            ))}
          </SectionMessage>
        )
      )}
    </Stack>
  );
}

function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <Stack space="space.400">
      <Stack space="space.050">
        <Heading as="h1">Relay</Heading>
        <Text>Handovers built from the Teamwork Graph, so nothing falls through when someone is away.</Text>
      </Stack>
      <Plan onSaved={() => setRefreshKey((k) => k + 1)} />
      <Active refreshKey={refreshKey} />
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
