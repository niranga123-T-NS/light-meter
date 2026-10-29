import { Stack, useLocalSearchParams } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Grid, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { decideNotDone, postStatusUpdate } from '@/components/MeetingActionDialogs';
import { kindLabel, notDoneLabel, notDoneShort, reviewLabel } from '@/lib/meetingActions';
import { type Team, TEAMS } from '@/lib/meetings';
import { rpc } from '@/lib/supabase';

type Item = {
  id: string;
  action: string;
  kind: string;
  status: 'open' | 'done' | 'not_done';
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
  last: { state: string; note: string; by: string | null; at: string; old_due: string | null; new_due: string | null; helper: string | null } | null;
  nd_reason: string | null;
  nd_note: string | null;
  nd_at: string | null;
  nd_by: string | null;
  nd_accepted_at: string | null;
  nd_accepted_by: string | null;
  updated: boolean;
};
type Review = {
  meeting: { id: string; team: Team; meeting_date: string; published_at: string; title: string };
  next_starts: string;
  can_decide: boolean;
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
  const notDone = data.items.filter((i) => i.status === 'not_done');
  const toAccept = notDone.filter((i) => !i.nd_accepted_at);
  const missing = open.filter((i) => !i.updated);
  const flagged = open.filter((i) => i.updated && (i.last?.state === 'blocked' || i.last?.state === 'delayed'));
  const onTrack = open.filter((i) => i.updated && i.last?.state === 'on_track');
  const overdue = open.filter((i) => i.due_date && i.due_date < today);

  const update = (i: Item) => postStatusUpdate(dialog, { id: i.id, action: i.action, due_date: i.due_date, state: i.last?.state }, reload);

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
          ) : i.status === 'not_done' ? (
            <Muted style={{ color: colors.grey }}>
              {`${i.nd_by ?? ''} closed it as not done ${fmtDateTime(i.nd_at)} – ${notDoneLabel(i.nd_reason)}: ${i.nd_note ?? ''}${i.nd_accepted_at ? ` · accepted by ${i.nd_accepted_by ?? ''} ${fmtDateTime(i.nd_accepted_at)}` : ''}`}
            </Muted>
          ) : i.last ? (
            <Muted style={{ color: i.updated ? stateTone(i.last.state) : colors.grey }}>
              {`${reviewLabel(i.last.state)}${i.last.state === 'blocked' && i.last.helper ? ` – waiting on ${i.last.helper}` : ''}${i.last.state === 'delayed' && i.last.new_due ? ` – new date ${fmtDate(i.last.new_due)}${i.last.old_due ? ` (was ${fmtDate(i.last.old_due)})` : ''}` : ''} · ${i.last.by ?? ''} · ${fmtDateTime(i.last.at)}${i.updated ? '' : ' (before the meeting)'} – ${i.last.note}`}
            </Muted>
          ) : null}
        </>
      }
      right={
        <Row gap={6} wrap>
          <Pill
            label={i.status === 'done' ? 'Done' : i.status === 'not_done' ? `Not done – ${notDoneShort(i.nd_reason)}` : i.updated ? reviewLabel(i.last?.state) : 'No update'}
            tone={i.status === 'done' ? colors.green : i.status === 'not_done' ? colors.grey : i.updated ? stateTone(i.last?.state) : colors.red}
            solid={i.status === 'done'}
          />
          {i.status === 'not_done' && !i.nd_accepted_at ? <Pill label="Awaiting review" tone={colors.amber} /> : null}
          {host && i.status === 'open' ? <Button small variant="ghost" title="Update" onPress={() => update(i)} /> : null}
          {data.can_decide && i.status === 'not_done' && !i.nd_accepted_at ? <Button small title="Accept" onPress={() => decideNotDone(dialog, i, true, reload)} /> : null}
          {data.can_decide && i.status === 'not_done' ? <Button small variant="secondary" title="Reopen with a new date" onPress={() => decideNotDone(dialog, i, false, reload)} /> : null}
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
        <Grid min={150} max={6}>
          <Stat label="Actions" value={data.items.length} />
          <Stat label="Done" value={done.length} tone="green" />
          <Stat label="Not done" value={notDone.length} tone={toAccept.length ? 'amber' : undefined} sub={toAccept.length ? `${toAccept.length} to review` : undefined} />
          <Stat label="No update yet" value={missing.length} tone={missing.length ? 'red' : 'green'} />
          <Stat label="Blocked / delayed" value={flagged.length} tone={flagged.length ? 'amber' : 'green'} />
          <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'red' : 'green'} />
        </Grid>
      </Section>
      {list('Not done – to review', toAccept)}
      {list('No update since the meeting', missing)}
      {list('Blocked or delayed', flagged)}
      {list('On track', onTrack)}
      {list('Done', done)}
      {list('Not done – accepted', notDone.filter((i) => i.nd_accepted_at))}
      {!data.items.length ? <Card><Empty title="No actions were assigned in this meeting" /></Card> : null}
    </Screen>
  );
}
