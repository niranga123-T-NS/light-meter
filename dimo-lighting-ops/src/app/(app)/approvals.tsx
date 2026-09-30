import { router, Stack } from 'expo-router';
import { useShellCounts } from '@/components/AppShell';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Muted, Pill, Row, Screen, Section } from '@/components/ui';
import { fmtDateTime, human } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';
import type { PendingApproval } from '@/lib/types';

/** Every pending approval for the signed-in user in one place (Section 8.6). */
export default function Approvals() {
  const dialog = useDialog();
  const { refresh } = useShellCounts();
  const { data, error, loading, reload } = useLoad(() => rpc<PendingApproval[]>('my_pending_approvals'));

  const decide = async (a: PendingApproval, decision: 'approved' | 'rejected' | 'returned') => {
    let comment: string | null = null;
    if (decision !== 'approved' || a.kind === 'duplicate_visit') {
      const r = await dialog.prompt({
        title: `${human(decision)}: ${a.title}`,
        fields: [{ key: 'c', label: decision === 'approved' ? 'Comment' : 'Reason (required)', type: 'multiline', required: decision !== 'approved' }],
      });
      if (!r) return;
      comment = r.c || null;
    }
    await dialog.run(async () => {
      await rpc('decide_approval', { p_approval: a.id, p_decision: decision, p_comment: comment });
      await reload();
      refresh();
    }, 'Decision recorded');
  };

  const direct = (data ?? []).filter((a) => a.source === 'approval');
  const workflow = (data ?? []).filter((a) => a.source !== 'approval');

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Approvals' }} />
      <ErrorBanner message={error} />
      <Section title={`Requests (${direct.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {direct.map((a) => (
            <ListRow
              key={a.id}
              title={a.title}
              subtitle={`${human(a.kind)} · ${a.requester ?? ''} · ${fmtDateTime(a.requested_at)}${a.step ? ` · ${a.step}` : ''}${a.reason ? `\n${a.reason}` : ''}`}
              onPress={a.inquiry_id ? () => router.push(a.url as never) : undefined}
              right={
                <Row gap={4} wrap>
                  <Button small title="Approve" onPress={() => decide(a, 'approved')} />
                  <Button small variant="secondary" title="Return" onPress={() => decide(a, 'returned')} />
                  <Button small variant="danger" title="Reject" onPress={() => decide(a, 'rejected')} />
                </Row>
              }
            />
          ))}
          {data && !direct.length ? <Empty title="No pending requests" /> : null}
        </Card>
      </Section>
      <Section title={`Workflow items waiting for you (${workflow.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {workflow.map((a) => (
            <ListRow
              key={`${a.source}-${a.id}`}
              title={a.title}
              subtitle={`${a.requester ?? ''} · ${fmtDateTime(a.requested_at)}${a.reason ? ` · ${a.reason}` : ''}`}
              right={<Pill label={human(a.kind)} tone={colors.blue} />}
              onPress={() => router.push(a.url as never)}
            />
          ))}
          {data && !workflow.length ? <Empty title="Nothing waiting" /> : null}
        </Card>
        <Muted style={{ marginTop: 6 }}>Weekly plans, design reviews, quotation approvals and sample requests open on their own page.</Muted>
      </Section>
    </Screen>
  );
}
