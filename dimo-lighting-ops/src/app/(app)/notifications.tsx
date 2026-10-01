import { router, Stack } from 'expo-router';
import { useShellCounts } from '@/components/AppShell';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Pill, Row, Screen } from '@/components/ui';
import { WebPushCard } from '@/components/WebPushCard';
import { useMe } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import type { AppNotification } from '@/lib/types';

/** Notification list (Section 8.4). Unopened critical / approval items stay pinned at the top. */
export default function Notifications() {
  const me = useMe();
  const { refresh } = useShellCounts();
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', me.id)
      .lte('deliver_after', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(200);
    if (e) throw new Error(e.message);
    return rows as AppNotification[];
  });

  const open = async (n: AppNotification) => {
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      refresh();
    }
    if (n.url) router.push(n.url as never);
    else reload();
  };

  const rows = [...(data ?? [])].sort((a, b) => {
    const pin = (x: AppNotification) => Number(!x.read_at && (x.requires_open || x.priority === 'critical'));
    return pin(b) - pin(a);
  });

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <WebPushCard compact />
      <Row style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button
          small
          variant="secondary"
          title="Mark all read"
          onPress={async () => {
            await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('recipient_id', me.id).is('read_at', null).eq('requires_open', false);
            await reload();
            refresh();
          }}
        />
      </Row>
      <ErrorBanner message={error} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((n) => (
          <ListRow
            key={n.id}
            title={n.title}
            subtitle={`${n.body}\n${fmtDateTime(n.created_at)}`}
            highlight={!n.read_at ? (n.priority === 'critical' ? colors.red : colors.brand) : undefined}
            right={
              <Row gap={4}>
                {n.priority === 'critical' ? <Pill label="Critical" tone={colors.red} solid /> : null}
                {!n.read_at && n.requires_open ? <Pill label="Pinned" tone={colors.amber} /> : null}
              </Row>
            }
            onPress={() => open(n)}
          />
        ))}
        {data && !rows.length ? <Empty title="No notifications" /> : null}
      </Card>
    </Screen>
  );
}
