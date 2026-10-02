import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useShellCounts } from '@/components/AppShell';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Muted, Pill, Row, Screen, Segmented } from '@/components/ui';
import { WebPushCard } from '@/components/WebPushCard';
import { useMe } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { AppNotification } from '@/lib/types';

type View = 'current' | 'history';

/**
 * Notification list (Section 8.4). Unopened critical / approval items stay pinned at the top.
 * "Clear" moves notifications to the history; the history can be cleared too.
 */
export default function Notifications() {
  const me = useMe();
  const dialog = useDialog();
  const { refresh } = useShellCounts();
  const [view, setView] = useState<View>('current');
  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase.from('notifications').select('*').eq('recipient_id', me.id).lte('deliver_after', new Date().toISOString());
    q = view === 'current' ? q.is('cleared_at', null) : q.not('cleared_at', 'is', null).is('history_cleared_at', null);
    const { data: rows, error: e } = await q.order('created_at', { ascending: false }).limit(view === 'current' ? 200 : 500);
    if (e) throw new Error(e.message);
    return rows as AppNotification[];
  }, [view]);

  const open = async (n: AppNotification) => {
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      refresh();
    }
    if (n.url) router.push(n.url as never);
    else reload();
  };
  const act = (fn: string, args: Record<string, unknown>, ok?: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
      refresh();
    }, ok);

  const rows = [...(data ?? [])].sort((a, b) => {
    const pin = (x: AppNotification) => Number(view === 'current' && !x.read_at && (x.requires_open || x.priority === 'critical'));
    return pin(b) - pin(a);
  });
  const pinned = rows.filter((n) => !n.read_at && n.requires_open).length;

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <WebPushCard compact />
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'current', label: 'Notifications' },
            { value: 'history', label: 'History' },
          ]}
        />
        {view === 'current' ? (
          <Row gap={8}>
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
            <Button
              small
              title="Clear all"
              disabled={!rows.length}
              onPress={async () => {
                if (await dialog.confirm('Clear all notifications?', 'They move to History, where you can still check them.', { confirmLabel: 'Clear all' }))
                  await act('clear_notifications', { p_id: null }, 'Cleared – see History');
              }}
            />
          </Row>
        ) : (
          <Button
            small
            variant="secondary"
            title="Clear history"
            disabled={!rows.length}
            onPress={async () => {
              const x = await dialog.prompt({
                title: 'Clear notification history',
                fields: [
                  {
                    key: 'w',
                    label: 'Clear',
                    type: 'select',
                    required: true,
                    initial: 'all',
                    options: [
                      { value: 'all', label: 'All history' },
                      { value: '7', label: 'Older than 7 days' },
                      { value: '30', label: 'Older than 30 days' },
                      { value: '90', label: 'Older than 90 days' },
                    ],
                  },
                ],
                confirmLabel: 'Clear history',
                danger: true,
              });
              if (!x) return;
              const before = x.w === 'all' ? null : new Date(Date.now() - Number(x.w) * 86_400_000).toISOString();
              await act('clear_notification_history', { p_id: null, p_before: before }, 'History cleared');
            }}
          />
        )}
      </Row>
      {view === 'current' && pinned ? <Muted>{pinned} unopened approval / overdue item(s) stay here until you open them.</Muted> : null}
      {view === 'history' ? <Muted>Notifications you cleared. Clearing the history removes them from this list.</Muted> : null}
      <ErrorBanner message={error} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((n) => (
          <ListRow
            key={n.id}
            title={n.title}
            subtitle={`${n.body}\n${fmtDateTime(n.created_at)}${view === 'history' && n.cleared_at ? ` · cleared ${fmtDateTime(n.cleared_at)}` : ''}`}
            highlight={view === 'current' && !n.read_at ? (n.priority === 'critical' ? colors.red : colors.brand) : undefined}
            right={
              <Row gap={4}>
                {n.priority === 'critical' ? <Pill label="Critical" tone={colors.red} solid /> : null}
                {view === 'current' && !n.read_at && n.requires_open ? <Pill label="Pinned" tone={colors.amber} /> : null}
                <Button
                  small
                  variant="ghost"
                  title={view === 'current' ? 'Clear' : 'Remove'}
                  onPress={() => act(view === 'current' ? 'clear_notifications' : 'clear_notification_history', view === 'current' ? { p_id: n.id } : { p_id: n.id, p_before: null })}
                />
              </Row>
            }
            onPress={() => open(n)}
          />
        ))}
        {data && !rows.length ? <Empty title={view === 'current' ? 'No notifications' : 'No history'} /> : null}
      </Card>
    </Screen>
  );
}
