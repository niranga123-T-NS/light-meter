import { router } from 'expo-router';
import { Button, Card, colors, ListRow, Pill, Row, Section } from '@/components/ui';
import { useDialog } from '@/components/dialog';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { kindLabel } from '@/lib/meetingActions';
import { ROLE_SHORT } from '@/lib/roles';
import { rpc } from '@/lib/supabase';
import type { Role } from '@/lib/types';

export type MyAction = {
  id: string;
  action: string;
  due_date: string | null;
  meeting_date: string;
  status: string;
  project: string | null;
  customer: string | null;
  project_id: string | null;
  kind: string;
  /** do: I carry it out · visit: my follow-up visit · assign: I appoint the person · track: appointed, I follow it */
  my_part: 'do' | 'visit' | 'assign' | 'track';
  owner: string | null;
  assignee: string | null;
  assignee_id: string | null;
  sales_person: string | null;
  objective: string | null;
  plan_id: string | null;
  planned_date: string | null;
  time_slot: string | null;
  line_status: string | null;
  assign_by: string | null;
  meeting_id: string;
};

const PARTS: { part: MyAction['my_part']; title: string }[] = [
  { part: 'assign', title: 'Appoint a person' },
  { part: 'visit', title: 'Follow-up visits' },
  { part: 'do', title: 'To do' },
  { part: 'track', title: 'With my team' },
];

/** My Day and Internal meetings: every sales meeting follow-up I do, appoint or track. */
export function MeetingActions() {
  const dialog = useDialog();
  const { data, reload } = useLoad(() => rpc<MyAction[]>('my_meeting_actions').catch(() => [] as MyAction[]));
  if (!data?.length) return null;
  const today = todayISO();
  const now = new Date().toISOString();

  const confirmDone = async (a: MyAction) => {
    const r = await dialog.prompt({
      title: 'Confirm the task is done',
      message: a.action,
      fields: [{ key: 'n', label: 'What was done', type: 'multiline', required: true }],
      confirmLabel: 'Confirm done',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('complete_meeting_action', { p_id: a.id, p_note: r.n });
        await reload();
      }, 'Confirmed – SM Projects and the team are told');
  };

  const appoint = async (a: MyAction) => {
    const team = await rpc<{ id: string; full_name: string; role: Role }[]>('meeting_action_team', { p_id: a.id }).catch(() => []);
    const r = await dialog.prompt({
      title: a.assignee ? 'Reassign' : `Appoint – ${kindLabel(a.kind).toLowerCase()}`,
      message: a.action,
      fields: [
        {
          key: 'p',
          label: 'Person',
          type: 'select',
          required: true,
          options: team.map((t) => ({ value: t.id, label: `${t.full_name} · ${ROLE_SHORT[t.role] ?? t.role}` })),
          initial: a.assignee_id ?? undefined,
        },
        { key: 'n', label: 'Instructions', type: 'multiline' },
      ],
      confirmLabel: 'Appoint',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('assign_meeting_action', { p_id: a.id, p_person: r.p, p_note: r.n || null });
        await reload();
      }, 'Appointed – the person, sales and SM Projects are told');
  };

  const subtitle = (a: MyAction) => {
    const parts = [
      kindLabel(a.kind),
      [a.project, a.customer].filter(Boolean).join(' · ') || null,
      a.kind === 'visit' && a.objective ? a.objective : null,
      a.my_part === 'track' && a.assignee ? `with ${a.assignee}` : null,
      a.my_part === 'do' && a.owner && a.kind !== 'task' ? `from ${a.owner}` : null,
      a.sales_person ? `sales: ${a.sales_person}` : null,
      `meeting ${fmtDate(a.meeting_date)}`,
      a.due_date ? `${a.kind === 'visit' ? 'visit by' : 'due'} ${fmtDate(a.due_date)}${a.due_date < today ? ' – overdue' : ''}` : null,
      a.my_part === 'assign' && a.assign_by ? `appoint by ${fmtDateTime(a.assign_by)}${a.assign_by < now ? ' – late, GM / DGM told' : ''}` : null,
    ];
    return parts.filter(Boolean).join(' · ');
  };

  const visitState = (a: MyAction) =>
    a.line_status === 'planned'
      ? { label: `Planned ${fmtDate(a.planned_date)}${a.time_slot ? ` ${a.time_slot}` : ' – set the time'}`, tone: colors.green }
      : a.line_status === 'completed'
        ? { label: 'Checked in – check out to finish', tone: colors.blue }
        : { label: 'Not in a plan yet', tone: colors.amber };

  return (
    <>
      {PARTS.map(({ part, title }) => {
        const rows = data.filter((a) => a.my_part === part);
        if (!rows.length) return null;
        return (
          <Section key={part} title={`Sales meeting – ${title.toLowerCase()} (${rows.length})`}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {rows.map((a) => {
                const late = (a.due_date && a.due_date < today) || (part === 'assign' && a.assign_by && a.assign_by < now);
                const vs = part === 'visit' ? visitState(a) : null;
                return (
                  <ListRow
                    key={a.id}
                    wrapRight
                    highlight={late ? colors.red : undefined}
                    title={a.action}
                    subtitle={subtitle(a)}
                    right={
                      <Row gap={6} wrap>
                        {vs ? <Pill label={vs.label} tone={vs.tone} /> : null}
                        {part === 'visit' ? (
                          <Button
                            small
                            variant={a.line_status === 'planned' ? 'secondary' : 'primary'}
                            title={a.plan_id && a.line_status ? 'Open plan' : 'Plan it'}
                            onPress={() => router.push(a.plan_id && a.line_status ? `/plan/${a.plan_id}` : '/plan')}
                          />
                        ) : null}
                        {part === 'assign' ? <Button small title="Appoint" onPress={() => appoint(a)} /> : null}
                        {part === 'track' ? <Button small variant="ghost" title="Reassign" onPress={() => appoint(a)} /> : null}
                        {part === 'do' ? <Button small title="Confirm done" onPress={() => confirmDone(a)} /> : null}
                      </Row>
                    }
                  />
                );
              })}
            </Card>
          </Section>
        );
      })}
    </>
  );
}
