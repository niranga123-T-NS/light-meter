import { router, Stack } from 'expo-router';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useDialog } from '@/components/dialog';
import { useMe } from '@/lib/auth';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Meeting = { id: string; meeting_date: string; status: 'draft' | 'published'; generated_at: string | null; published_at: string | null };
type Exception = { id: string; sales_person_id: string; meeting_date: string; reason: string; status: 'pending' | 'approved' | 'rejected'; decision_note: string | null };

/** Monday of the week of a date (ISO), and the next Monday from today (today if it is Monday). */
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return addDaysISO(iso, -((d.getDay() + 6) % 7));
};
const nextMonday = () => {
  const t = todayISO();
  const m = mondayOf(t);
  return m === t ? t : addDaysISO(m, 7);
};

/** Weekly sales meeting (Mondays 08:30 – 12:00): SM Projects generates and publishes the pack; GM / DGM read published packs. */
export default function SalesMeetings() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const smp = me.role === 'sm_projects';
  const { data, error, reload } = useLoad(async () => {
    const [m, e] = await Promise.all([
      supabase.from('sales_meetings').select('id, meeting_date, status, generated_at, published_at').order('meeting_date', { ascending: false }).limit(52),
      supabase.from('meeting_exceptions').select('*').gte('meeting_date', addDaysISO(todayISO(), -28)).order('meeting_date', { ascending: false }),
    ]);
    if (m.error) throw new Error(m.error.message);
    return { meetings: (m.data ?? []) as Meeting[], exceptions: (e.data ?? []) as Exception[] };
  });
  if (me.role !== 'sm_projects' && me.role !== 'gm') {
    return (
      <Screen>
        <Notice>The sales meeting pack is for SM Projects and GM / DGM.</Notice>
      </Screen>
    );
  }
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const upcoming = nextMonday();
  const thisWeek = data.meetings.find((m) => m.meeting_date === upcoming);
  const pending = data.exceptions.filter((e) => e.status === 'pending');

  const generate = async (date: string) => {
    await dialog.run(async () => {
      const id = await rpc<string>('generate_sales_meeting', { p_date: date });
      await reload();
      router.push(`/meeting/${id}`);
    }, 'Meeting pack generated');
  };
  const decide = async (e: Exception, approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? 'Approve the exception' : 'Do not approve',
      message: `${people[e.sales_person_id]?.full_name ?? ''} · Monday ${fmtDate(e.meeting_date)} · ${e.reason}`,
      fields: [{ key: 'n', label: approve ? 'Note' : 'Reason', type: 'multiline', required: !approve }],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('decide_meeting_exception', { p_id: e.id, p_approve: approve, p_note: r.n || null });
      await reload();
    }, approve ? 'Approved' : 'Not approved');
  };

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Sales meeting' }} />
      <Card>
        <Muted>Every Monday 08:30 – 12:00. Sales persons cannot plan visits in that time without an exception approved by SM Projects.</Muted>
        {smp ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            <Button
              title={thisWeek ? `Open the pack for Monday ${fmtDate(upcoming)}` : `Generate the pack for Monday ${fmtDate(upcoming)}`}
              onPress={() => (thisWeek ? router.push(`/meeting/${thisWeek.id}`) : generate(upcoming))}
            />
            <Button
              variant="secondary"
              title="Another Monday"
              onPress={async () => {
                const r = await dialog.prompt({ title: 'Generate a meeting pack', fields: [{ key: 'd', label: 'Monday', type: 'date', required: true, initial: upcoming }] });
                if (r) await generate(mondayOf(r.d));
              }}
            />
          </Row>
        ) : (
          <Muted>Packs appear here once SM Projects publishes them (read only).</Muted>
        )}
      </Card>

      {smp && pending.length ? (
        <Section title={`Exceptions to approve (${pending.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {pending.map((e) => (
              <ListRow
                key={e.id}
                wrapRight
                title={`${people[e.sales_person_id]?.full_name ?? '—'} · Monday ${fmtDate(e.meeting_date)}`}
                subtitle={e.reason}
                right={
                  <Row gap={6}>
                    <Button small title="Approve" onPress={() => decide(e, true)} />
                    <Button small variant="secondary" title="Reject" onPress={() => decide(e, false)} />
                  </Row>
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Meetings">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {data.meetings.length ? (
            data.meetings.map((m) => (
              <ListRow
                key={m.id}
                title={`Monday ${fmtDate(m.meeting_date)}`}
                subtitle={m.status === 'published' ? `Published ${fmtDateTime(m.published_at)}` : `Generated ${fmtDateTime(m.generated_at)} · draft`}
                right={<Pill label={m.status === 'published' ? 'Published' : 'Draft'} tone={m.status === 'published' ? colors.green : colors.amber} />}
                onPress={() => router.push(`/meeting/${m.id}`)}
              />
            ))
          ) : (
            <Empty title={smp ? 'No meeting packs yet' : 'No published meeting packs yet'} />
          )}
        </Card>
      </Section>

      {smp && data.exceptions.some((e) => e.status !== 'pending') ? (
        <Section title="Recent exceptions">
          <Card>
            {data.exceptions
              .filter((e) => e.status !== 'pending')
              .map((e) => (
                <Muted key={e.id}>
                  {`Monday ${fmtDate(e.meeting_date)} · ${people[e.sales_person_id]?.full_name ?? '—'} · ${e.status}${e.decision_note ? ` – ${e.decision_note}` : ''} · ${e.reason}`}
                </Muted>
              ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
