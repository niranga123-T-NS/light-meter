import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { pctTone } from '@/components/financeTones';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Grid, KeyValue, Loading, Muted, Notice, Pill, Progress, Row, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { amt, fmtPct, mn } from '@/lib/finance';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Person = {
  id: string;
  name: string;
  target: { budget_secure: number; secured: number; budget_invoice: number; invoiced: number; secured_pct: number; invoiced_pct: number; score: number };
  wins: { code: string; project: string; customer: string | null; value: number }[];
  losses: { code: string; project: string; customer: string | null; reason: string | null }[];
  quotes_waiting_n: number;
  quotes_waiting: { code: string; project: string; customer: string | null; days: number }[];
  followups_overdue_n: number;
  followups_overdue: { date: string; customer: string; action: string | null }[];
  visits: { planned: number; completed: number; missed: number; done: number };
  not_visited_n: number;
  not_visited: { project: string; value: number; last_visit: string | null }[];
  invoices: { slipped_n: number; slipped: number; due_month: number };
  debtors_90: { n: number; lkr: number };
  retentions_due: { n: number; lkr: number };
  open_actions: { action: string; due: string | null; meeting: string; owner: string }[];
  exception: { status: string; reason: string } | null;
};
type Pack = {
  meeting_date: string;
  week_from: string;
  week_to: string;
  generated_at: string;
  team: Record<string, number>;
  people: Person[];
};
type Meeting = { id: string; meeting_date: string; status: 'draft' | 'published'; pack: Pack | null; notes: string | null; generated_at: string | null; published_at: string | null };
type Note = { sales_person_id: string; note: string };
type Action = { id: string; sales_person_id: string | null; owner_id: string; action: string; due_date: string | null; status: 'open' | 'done' };

const bar = (label: string, done: number, target: number, value: number) => (
  <View style={{ gap: 3 }}>
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={{ color: colors.text }}>{label}</Text>
      <Text style={{ fontWeight: '700', color: colors.ink }}>
        {mn(done)} / {mn(target)} Mn · {fmtPct(value)}
      </Text>
    </Row>
    <Progress pct={value} colour={pctTone(value)} />
  </View>
);

/** One meeting pack: team summary, a part per sales person with notes and actions. SM Projects edits until published; GM / DGM read. */
export default function MeetingPack() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [m, n, a] = await Promise.all([
      supabase.from('sales_meetings').select('*').eq('id', id).single(),
      supabase.from('sales_meeting_notes').select('*').eq('meeting_id', id),
      supabase.from('sales_meeting_actions').select('*').eq('meeting_id', id).order('created_at'),
    ]);
    if (m.error) throw new Error(m.error.message);
    return { m: m.data as Meeting, notes: (n.data ?? []) as Note[], actions: (a.data ?? []) as Action[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { m } = data;
  const smp = me.role === 'sm_projects';
  const edit = smp && m.status === 'draft';
  const pack = m.pack;
  const t = pack?.team ?? {};
  const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);

  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);
  const editNote = async (personId: string | null, current: string) => {
    const r = await dialog.prompt({
      title: personId ? `Notes – ${people[personId]?.full_name ?? ''}` : 'Meeting notes',
      fields: [{ key: 'n', label: 'Discussion / decisions', type: 'multiline', initial: current }],
    });
    if (r) await run('save_meeting_note', { p_meeting: m.id, p_sales_person: personId, p_note: r.n ?? '' }, 'Saved');
  };
  const addAction = async (personId: string | null) => {
    const owners = Object.values(people)
      .filter((p) => ['asm_building', 'asm_infra', 'sm_projects', 'operations_exec'].includes(p.role))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
    const r = await dialog.prompt({
      title: 'Action',
      fields: [
        { key: 'a', label: 'Action', type: 'multiline', required: true },
        { key: 'o', label: 'Who', type: 'select', required: true, initial: personId ?? undefined, options: owners.map((p) => ({ value: p.id, label: p.full_name })) },
        { key: 'd', label: 'Due', type: 'date', initial: addDaysISO(todayISO(), 7) },
      ],
    });
    if (r) await run('add_meeting_action', { p_meeting: m.id, p_data: { sales_person_id: personId, owner_id: r.o, action: r.a, due_date: r.d || null } }, 'Action added');
  };
  const actionsFor = (personId: string | null) => data.actions.filter((a) => a.sales_person_id === personId);
  const actionList = (personId: string | null) => (
    <View style={{ gap: 4, marginTop: 6 }}>
      {actionsFor(personId).map((a) => (
        <Row key={a.id} wrap gap={6} style={{ alignItems: 'center' }}>
          <Pill label={a.status === 'done' ? 'Done' : 'Open'} tone={a.status === 'done' ? colors.green : colors.amber} />
          <Text style={{ color: colors.ink, flexShrink: 1 }}>
            {a.action} · {people[a.owner_id]?.full_name ?? '—'}
            {a.due_date ? ` · by ${fmtDate(a.due_date)}` : ''}
          </Text>
          {smp ? (
            <Button small variant="ghost" title={a.status === 'done' ? 'Re-open' : 'Mark done'} onPress={() => run('set_meeting_action_done', { p_id: a.id, p_done: a.status !== 'done' }, 'Updated')} />
          ) : null}
          {edit ? <Button small variant="ghost" title="Delete" onPress={() => run('delete_meeting_action', { p_id: a.id }, 'Deleted')} /> : null}
        </Row>
      ))}
      {edit ? (
        <Row>
          <Button small variant="secondary" title="+ Action" onPress={() => addAction(personId)} />
        </Row>
      ) : null}
    </View>
  );

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: `Sales meeting · ${fmtDate(m.meeting_date)}` }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>Monday {fmtDate(m.meeting_date)} · 08:30 – 12:00</Text>
          <Pill label={m.status === 'published' ? 'Published' : 'Draft'} tone={m.status === 'published' ? colors.green : colors.amber} solid />
        </Row>
        <Muted>
          {pack ? `Figures as at ${fmtDateTime(pack.generated_at)} · last week ${fmtDate(pack.week_from)} – ${fmtDate(pack.week_to)}` : 'Not generated yet'}
          {m.published_at ? ` · published ${fmtDateTime(m.published_at)}` : ''}
        </Muted>
        {edit ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            <Button
              variant="secondary"
              title="Regenerate figures"
              onPress={() => run('generate_sales_meeting', { p_date: m.meeting_date }, 'Figures refreshed – notes and actions kept')}
            />
            <Button
              title="Publish to GM / DGM"
              onPress={async () => {
                if (await dialog.confirm('Publish the meeting pack?', 'GM / DGM are notified and can view it. It can no longer be changed (actions can still be marked done).', { confirmLabel: 'Publish' }))
                  await run('publish_sales_meeting', { p_id: m.id }, 'Published – GM / DGM notified');
              }}
            />
          </Row>
        ) : null}
        {!smp ? <Muted>Read only.</Muted> : null}
      </Card>

      {pack ? (
        <>
          <Section title="Team">
            <Card>
              <View style={{ gap: 10 }}>
                {bar('Secured vs budget · year to date', t.secured ?? 0, t.budget_secure ?? 0, pct(t.secured ?? 0, t.budget_secure ?? 0))}
                {bar('Invoiced vs budget · year to date', t.invoiced ?? 0, t.budget_invoice ?? 0, pct(t.invoiced ?? 0, t.budget_invoice ?? 0))}
              </View>
            </Card>
            <Grid min={160}>
              <Stat label={`Wins last week · ${mn(t.wins_value)} Mn`} value={t.wins_n ?? 0} tone={t.wins_n ? 'green' : undefined} />
              <Stat label="Losses last week" value={t.losses_n ?? 0} tone={t.losses_n ? 'red' : undefined} />
              <Stat label="Quotations waiting" value={t.quotes_waiting_n ?? 0} />
              <Stat label="Follow-ups overdue" value={t.followups_overdue_n ?? 0} tone={t.followups_overdue_n ? 'red' : undefined} />
              <Stat label={`Slipped invoices · ${mn(t.slipped)} Mn`} value={t.slipped_n ?? 0} tone={t.slipped_n ? 'red' : undefined} />
              <Stat label="Debtors over 90 days (Mn)" value={mn(t.debtors_90)} tone={t.debtors_90 ? 'amber' : undefined} />
            </Grid>
            <Card style={{ marginTop: 8 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>Meeting notes</Text>
                {edit ? <Button small variant="ghost" title="Edit" onPress={() => editNote(null, m.notes ?? '')} /> : null}
              </Row>
              <Muted>{m.notes ?? 'No notes'}</Muted>
              {actionList(null)}
            </Card>
          </Section>

          {pack.people.map((p) => {
            const note = data.notes.find((n) => n.sales_person_id === p.id)?.note ?? '';
            return (
              <Section key={p.id} title={p.name}>
                <Card>
                  {p.exception ? (
                    <Notice tone={p.exception.status === 'approved' ? colors.blue : colors.amber}>
                      {`Meeting exception ${p.exception.status}: ${p.exception.reason}`}
                    </Notice>
                  ) : null}
                  <Row wrap gap={16} style={{ alignItems: 'center' }}>
                    <View style={{ alignItems: 'center', minWidth: 90 }}>
                      <Text style={{ fontSize: 26, fontWeight: '800', color: pctTone(p.target.score) }}>{p.target.score.toFixed(2)}</Text>
                      <Muted>Score</Muted>
                    </View>
                    <View style={{ flex: 1, minWidth: 240, gap: 8 }}>
                      {bar('Secured vs budget (YTD)', p.target.secured, p.target.budget_secure, p.target.secured_pct)}
                      {bar('Invoiced vs budget (YTD)', p.target.invoiced, p.target.budget_invoice, p.target.invoiced_pct)}
                    </View>
                  </Row>
                  <Grid min={170}>
                    <KeyValue label="Visits last week" value={`${p.visits.done} done · ${p.visits.completed} of ${p.visits.planned} planned · ${p.visits.missed} missed`} />
                    <KeyValue label="Follow-ups overdue" value={String(p.followups_overdue_n)} />
                    <KeyValue label="Quotations waiting" value={String(p.quotes_waiting_n)} />
                    <KeyValue label="Projects not visited 30 days" value={String(p.not_visited_n)} />
                    <KeyValue label="Invoices slipped" value={`${p.invoices.slipped_n} · ${mn(p.invoices.slipped)} Mn`} />
                    <KeyValue label="Invoices due this month" value={`${mn(p.invoices.due_month)} Mn`} />
                    <KeyValue label="Debtors over 90 days" value={`${p.debtors_90.n} · ${mn(p.debtors_90.lkr)} Mn`} />
                    <KeyValue label="Retentions due (30 days)" value={`${p.retentions_due.n} · ${mn(p.retentions_due.lkr)} Mn`} />
                  </Grid>
                  {p.wins.length ? (
                    <Muted>{`Won: ${p.wins.map((w) => `${w.code} ${w.project} (LKR ${amt(w.value)})`).join(' · ')}`}</Muted>
                  ) : null}
                  {p.losses.length ? <Muted>{`Lost: ${p.losses.map((w) => `${w.code} ${w.project}${w.reason ? ` – ${w.reason}` : ''}`).join(' · ')}`}</Muted> : null}
                  {p.quotes_waiting.length ? (
                    <Muted>{`Quotations waiting: ${p.quotes_waiting.map((q) => `${q.code} ${q.project} ${q.days}d`).join(' · ')}`}</Muted>
                  ) : null}
                  {p.followups_overdue.length ? (
                    <Muted>{`Follow-ups overdue: ${p.followups_overdue.map((f) => `${fmtDate(f.date)} ${f.customer}${f.action ? ` – ${f.action}` : ''}`).join(' · ')}`}</Muted>
                  ) : null}
                  {p.not_visited.length ? (
                    <Muted>{`Not visited 30 days: ${p.not_visited.map((n) => `${n.project}${n.last_visit ? ` (last ${fmtDate(n.last_visit)})` : ' (never)'}`).join(' · ')}`}</Muted>
                  ) : null}
                  {p.open_actions.length ? (
                    <Notice tone={colors.amber}>
                      {`Open actions from earlier meetings: ${p.open_actions.map((a) => `${a.action} (${a.owner}${a.due ? `, by ${fmtDate(a.due)}` : ''})`).join(' · ')}`}
                    </Notice>
                  ) : null}
                  <View style={{ marginTop: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text style={{ fontWeight: '700', color: colors.ink }}>Discussion</Text>
                      {edit ? <Button small variant="ghost" title={note ? 'Edit' : 'Add notes'} onPress={() => editNote(p.id, note)} /> : null}
                    </Row>
                    <Muted>{note || 'No notes'}</Muted>
                    {actionList(p.id)}
                  </View>
                </Card>
              </Section>
            );
          })}
        </>
      ) : (
        <Notice tone={colors.amber}>The pack has not been generated.</Notice>
      )}
    </Screen>
  );
}
