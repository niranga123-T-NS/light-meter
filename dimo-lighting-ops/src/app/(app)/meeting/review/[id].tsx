import { Stack, useLocalSearchParams } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Grid, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { kindLabel, REVIEW_STATES, reviewLabel } from '@/lib/meetingActions';
import { type Team, TEAMS } from '@/lib/meetings';
import { rpc } from '@/lib/supabase';

type Item = {
  id: string;
  action: string;
  kind: string;
  status: 'open' | 'done';
  due_date: string | null;
  owner: string | null;
  assignee: string | null;
  doer: string | null;
  sales_person: string | null;
  project: string | null;
  customer: string | null;
  done_at: string | null;
  done_note: string | null;
  unappointed: boolean;
  visit: { date: string | null; status: string } | null;
  last: { state: string; note: string; by: string | null; at: string } | null;
  updated: boolean;
};
type Review = {
  meeting: { id: string; team: Team; meeting_date: string; published_at: string; title: string };
  next_starts: string;
  items: Item[];
};

const stateTone = (s: string | undefined) => (s === 'blocked' ? colors.red : s === 'delayed' ? colors.amber : s === 'on_track' ? colors.green : colors.grey);

/** Status review of the actions assigned in a published meeting – due before the next meeting of the team starts. */
export default function MeetingStatusReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(() => rpc<Review | null>('meeting_status_review', { p_meeting: id }), [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : data === null ? <Empty title="Meeting not found or not published" /> : <Loading />}</Screen>;

  const today = todayISO();
  const started = data.next_starts <= new Date().toISOString();
  const host = me.role === TEAMS[data.meeting.team].hostRole || me.role === 'sm_projects';
  const open = data.items.filter((i) => i.status === 'open');
  const done = data.items.filter((i) => i.status === 'done');
  const missing = open.filter((i) => !i.updated);
  const flagged = open.filter((i) => i.updated && (i.last?.state === 'blocked' || i.last?.state === 'delayed'));
  const onTrack = open.filter((i) => i.updated && i.last?.state === 'on_track');
  const overdue = open.filter((i) => i.due_date && i.due_date < today);

  const update = async (i: Item) => {
    const r = await dialog.prompt({
      title: 'Status update',
      message: i.action,
      fields: [
        { key: 's', label: 'Status', type: 'select', required: true, options: REVIEW_STATES, initial: i.last?.state },
        { key: 'n', label: 'Progress / what is holding it', type: 'multiline', required: true },
      ],
      confirmLabel: 'Post update',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('review_meeting_action', { p_id: i.id, p_state: r.s, p_note: r.n });
        await reload();
      }, 'Update posted');
  };

  const row = (i: Item) => (
    <ListRow
      key={i.id}
      wrapRight
      highlight={i.status === 'open' && ((i.due_date && i.due_date < today) || i.last?.state === 'blocked') ? colors.red : undefined}
      title={i.action}
      subtitle={
        <>
          <Muted>
            {[
              kindLabel(i.kind),
              i.unappointed ? `${i.owner} – person not appointed yet` : i.doer,
              [i.project, i.customer].filter(Boolean).join(' · ') || null,
              i.sales_person ? `sales: ${i.sales_person}` : null,
              i.due_date ? `due ${fmtDate(i.due_date)}${i.status === 'open' && i.due_date < today ? ' – overdue' : ''}` : null,
              i.kind === 'visit' && i.status === 'open' ? (i.visit?.status === 'planned' ? `visit planned ${fmtDate(i.visit.date)}` : 'visit not planned yet') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
          {i.status === 'done' ? (
            <Muted style={{ color: colors.green }}>{`Done ${fmtDateTime(i.done_at)}${i.done_note ? ` – ${i.done_note}` : ''}`}</Muted>
          ) : i.last ? (
            <Muted style={{ color: i.updated ? stateTone(i.last.state) : colors.grey }}>
              {`${reviewLabel(i.last.state)} · ${i.last.by ?? ''} · ${fmtDateTime(i.last.at)}${i.updated ? '' : ' (before the meeting)'} – ${i.last.note}`}
            </Muted>
          ) : null}
        </>
      }
      right={
        <Row gap={6} wrap>
          <Pill
            label={i.status === 'done' ? 'Done' : i.updated ? reviewLabel(i.last?.state) : 'No update'}
            tone={i.status === 'done' ? colors.green : i.updated ? stateTone(i.last?.state) : colors.red}
            solid={i.status === 'done'}
          />
          {host && i.status === 'open' ? <Button small variant="ghost" title="Update" onPress={() => update(i)} /> : null}
        </Row>
      }
    />
  );
  const list = (title: string, items: Item[], empty?: string) =>
    items.length || empty ? (
      <Section title={`${title} (${items.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>{items.length ? items.map(row) : <Empty title={empty ?? ''} />}</Card>
      </Section>
    ) : null;

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Status review' }} />
      <Section title={`${data.meeting.title} · ${fmtDate(data.meeting.meeting_date)} – status of the actions`}>
        <Notice tone={started ? colors.grey : missing.length ? colors.amber : colors.green}>
          {started
            ? `The next meeting started ${fmtDateTime(data.next_starts)} – this is the status it was reviewed with.`
            : `Status updates are due before the next meeting starts: ${fmtDateTime(data.next_starts)}. The people doing each open action post an update from My Day / Meetings; reminders go out 24 hours before, and the host gets the list of missing updates 1 hour before.`}
        </Notice>
        <Grid min={170} max={5}>
          <Stat label="Actions" value={data.items.length} />
          <Stat label="Done" value={done.length} tone="green" />
          <Stat label="No update yet" value={missing.length} tone={missing.length ? 'red' : 'green'} />
          <Stat label="Blocked / delayed" value={flagged.length} tone={flagged.length ? 'amber' : 'green'} />
          <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'red' : 'green'} />
        </Grid>
      </Section>
      {list('No update since the meeting', missing)}
      {list('Blocked or delayed', flagged)}
      {list('On track', onTrack)}
      {list('Done', done)}
      {!data.items.length ? <Card><Empty title="No actions were assigned in this meeting" /></Card> : null}
    </Screen>
  );
}
