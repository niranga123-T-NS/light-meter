import { Button, Card, colors, ListRow, Section } from '@/components/ui';
import { useDialog } from '@/components/dialog';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

type MyAction = { id: string; action: string; due_date: string | null; meeting_date: string; status: string; project: string | null; customer: string | null };

/** My Day: open actions given to me in published sales meetings; I mark them done. */
export function MeetingActions() {
  const dialog = useDialog();
  const { data, reload } = useLoad(() => rpc<MyAction[]>('my_meeting_actions').catch(() => [] as MyAction[]));
  if (!data?.length) return null;
  const today = todayISO();
  return (
    <Section title={`Actions from the sales meeting (${data.length})`}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {data.map((a) => (
          <ListRow
            key={a.id}
            wrapRight
            highlight={a.due_date && a.due_date < today ? colors.red : undefined}
            title={a.action}
            subtitle={`${[a.project, a.customer].filter(Boolean).join(' · ')}${a.project || a.customer ? ' · ' : ''}Meeting ${fmtDate(a.meeting_date)}${a.due_date ? ` · due ${fmtDate(a.due_date)}${a.due_date < today ? ' – overdue' : ''}` : ''}`}
            right={
              <Button
                small
                title="Done"
                onPress={() =>
                  dialog.run(async () => {
                    await rpc('set_meeting_action_done', { p_id: a.id, p_done: true });
                    await reload();
                  }, 'Marked done – SM Projects told')
                }
              />
            }
          />
        ))}
      </Card>
    </Section>
  );
}
