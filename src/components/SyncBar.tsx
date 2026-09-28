import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { fmtDateTime } from '@/lib/format';
import { useOutbox } from '@/lib/outbox';
import type { SyncStatus } from '@/lib/types';

import { Badge, colors, space, type Tone } from './ui';

const STATUS: Record<SyncStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'warning' },
  synced: { label: 'Synced', tone: 'success' },
  needs_attention: { label: 'Needs attention', tone: 'danger' },
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  return <Badge label={STATUS[status].label} tone={STATUS[status].tone} />;
}

/** Connection + outbox summary; tap for details. */
export function SyncBar() {
  const online = useOutbox((s) => s.online);
  const syncing = useOutbox((s) => s.syncing);
  const lastSyncAt = useOutbox((s) => s.lastSyncAt);
  const items = useOutbox((s) => s.items);
  const queued = Object.values(items).filter((i) => i.status === 'queued').length;
  const attention = Object.values(items).filter((i) => i.status === 'needs_attention').length;
  const tone = attention ? colors.danger : !online ? colors.warning : colors.success;
  const text = syncing ? 'Syncing…'
    : attention ? `${attention} visit${attention > 1 ? 's' : ''} need attention`
    : !online ? `Offline${queued ? ` · ${queued} queued` : ''}`
    : queued ? `${queued} waiting to sync`
    : `Synced ${lastSyncAt ? fmtDateTime(lastSyncAt) : '–'}`;
  return (
    <Pressable onPress={() => router.push('/sync')} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone }} />
      <Text style={{ fontSize: 13, color: colors.muted, flex: 1 }}>{text}</Text>
      <Text style={{ fontSize: 13, color: colors.primary }}>Details ›</Text>
    </Pressable>
  );
}
