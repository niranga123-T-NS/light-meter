import { router, Stack } from 'expo-router';
import { useState } from 'react';

import { SyncStatusBadge } from '@/components/SyncBar';
import { Banner, Button, Card, EmptyState, KeyValue, ListItem, Muted, Screen, SectionTitle } from '@/components/ui';
import { customerName } from '@/lib/cache';
import { confirm } from '@/lib/dialog';
import { deleteLocalFile } from '@/lib/files';
import { fmtDateTime } from '@/lib/format';
import { removeItem, sortedItems, useOutbox } from '@/lib/outbox';
import { useSession } from '@/lib/session';

export default function SyncScreen() {
  const { sync } = useSession();
  const s = useOutbox((x) => x);
  const [busy, setBusy] = useState(false);
  const items = sortedItems(s.items);
  const counts = items.reduce((acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }), {} as Record<string, number>);

  const run = async (includeFailed: boolean) => {
    setBusy(true);
    await sync({ includeFailed });
    setBusy(false);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Sync' }} />
      <Card>
        <KeyValue label="Connection" value={s.online ? 'Online' : 'Offline'} />
        <KeyValue label="Last successful sync" value={fmtDateTime(s.lastSyncAt)} />
        <KeyValue label="Drafts" value={counts.draft ?? 0} />
        <KeyValue label="Queued" value={counts.queued ?? 0} />
        <KeyValue label="Needs attention" value={counts.needs_attention ?? 0} />
        <KeyValue label="Synced (kept 30 days)" value={counts.synced ?? 0} />
        {s.lastSyncError ? <Banner tone="warning" message={s.lastSyncError} /> : null}
        <Button title="Sync now" onPress={() => run(false)} loading={busy || s.syncing} />
        {counts.needs_attention ? <Button variant="secondary" title="Retry visits that need attention" onPress={() => run(true)} /> : null}
        <Muted>Visits are sent with IDs created on this phone, so retrying never creates duplicates. Photos upload before the visit.</Muted>
      </Card>
      <SectionTitle>Visits on this device</SectionTitle>
      {items.length === 0 ? <EmptyState title="Nothing stored on this device" /> : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {items.map((i) => (
            <ListItem key={i.id}
              title={customerName(i.payload.visit.customer_id) !== '–' ? customerName(i.payload.visit.customer_id) : i.payload.new_customers[0]?.legal_name ?? 'Visit'}
              subtitle={i.error ?? (i.serverCode ? `Reference ${i.serverCode}` : `${i.payload.attachments.length} file(s), ${i.payload.actions.length} action(s)`)}
              meta={`Updated ${fmtDateTime(i.updatedAt)}${i.attempts ? ` · ${i.attempts} attempt(s)` : ''}`}
              right={<SyncStatusBadge status={i.status} />}
              onPress={() => router.push(i.status === 'synced' ? `/visit/view/${i.id}` : `/visit/${i.id}`)} />
          ))}
        </Card>
      )}
      {counts.synced ? (
        <Button variant="ghost" title="Clear synced visits from this device" onPress={async () => {
          if (!(await confirm('Clear synced visits?', 'They remain on the server.'))) return;
          items.filter((i) => i.status === 'synced').forEach((i) => {
            i.payload.attachments.forEach((a) => deleteLocalFile(a.localUri));
            removeItem(i.id);
          });
        }} />
      ) : null}
    </Screen>
  );
}
