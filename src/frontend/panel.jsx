import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

function Panel() {
  const [info, setInfo] = useState(null);
  useEffect(() => { invoke('panelInfo').then(setInfo); }, []);

  if (!info) return <Spinner />;
  if (info.error) return <Text>{info.error}</Text>;

  return (
    <Stack space="space.100">
      {info.coveredByHandover ? (
        <SectionMessage appearance="information" title="Covered by a handover">
          <Text>{`${info.originalOwner} is away until ${info.awayUntil}. ${info.owner} is covering.`}</Text>
          {info.handoverPack && <Link href={info.handoverPack}>Open the handover pack</Link>}
        </SectionMessage>
      ) : (
        <Inline space="space.100"><Text>Owner:</Text><Lozenge>{info.owner}</Lozenge></Inline>
      )}
      <Text>{info.alsoHasContext.length ? `Also has context: ${info.alsoHasContext.join(', ')}` : 'Nobody else has worked on this yet, so the bus factor is 1.'}</Text>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
