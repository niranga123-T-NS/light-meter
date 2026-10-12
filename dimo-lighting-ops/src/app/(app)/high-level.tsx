import { Stack } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Grant = {
  id: string;
  user_id: string;
  granted_by: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
};

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

/** High level users: the GM / DGM gives a person view-only GM / DGM access for up to one day; it ends by itself */
export default function HighLevelUsers() {
  const { realRole } = useAuth();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: g, error: e } = await supabase.from('high_level_grants').select('*').order('starts_at', { ascending: false }).limit(200);
    if (e) throw new Error(e.message);
    return { grants: (g ?? []) as Grant[], at: Date.now() };
  }, []);
  if (realRole !== 'gm') return <Screen><Notice>Only the GM / DGM gives high level access.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const state = (g: Grant) =>
    g.cancelled_at ? { label: 'Cancelled', tone: colors.grey } : Date.parse(g.ends_at) <= now ? { label: 'Ended', tone: colors.grey } : Date.parse(g.starts_at) > now ? { label: 'Starts later', tone: colors.blue } : { label: 'In force', tone: colors.green };
  const now = data.at;
  const current = data.grants.filter((g) => !g.cancelled_at && Date.parse(g.ends_at) > now);
  const past = data.grants.filter((g) => !current.includes(g));

  const grant = async () => {
    const r = await dialog.prompt({
      title: 'Give high level access',
      message: 'View only – the person sees everything the GM / DGM sees, but cannot change or approve anything. One day at most; it ends by itself.',
      fields: [
        {
          key: 'u',
          label: 'Person',
          type: 'select',
          required: true,
          options: Object.values(people)
            .filter((p) => p.active && p.role !== 'gm' && p.role !== 'sys_admin')
            .sort((a, b) => a.full_name.localeCompare(b.full_name))
            .map((p) => ({ value: p.id, label: p.full_name })),
        },
        { key: 'd', label: 'From (date)', type: 'date', required: true, initial: todayISO() },
        { key: 't', label: 'From (time)', type: 'select', required: true, initial: 'now', options: [{ value: 'now', label: 'Now' }, ...TIMES.map((t) => ({ value: t, label: t }))] },
        { key: 'h', label: 'For', type: 'select', required: true, initial: '8', options: [1, 2, 4, 6, 8, 12, 24].map((h) => ({ value: String(h), label: h === 24 ? '1 day (24 hours)' : `${h} hours` })) },
        { key: 'r', label: 'Reason', type: 'multiline', required: true, hint: 'e.g. Acting for the DGM on 14 Oct; audit review' },
      ],
      confirmLabel: 'Give access',
    });
    if (!r) return;
    const start = r.t === 'now' ? new Date() : new Date(`${r.d}T${r.t}:00+05:30`);
    const end = new Date(start.getTime() + Number(r.h) * 3600 * 1000);
    await dialog.run(async () => {
      await rpc('grant_high_level', { p_user: r.u, p_starts: start.toISOString(), p_ends: end.toISOString(), p_reason: r.r });
      await reload();
    }, 'Access given – the person is told');
  };
  const cancel = async (g: Grant) => {
    const r = await dialog.prompt({ title: `Cancel access – ${people[g.user_id]?.full_name ?? ''}`, fields: [{ key: 'n', label: 'Reason', type: 'multiline' }], confirmLabel: 'Cancel access', danger: true });
    if (r) await dialog.run(async () => { await rpc('cancel_high_level', { p_id: g.id, p_reason: r.n || null }); await reload(); }, 'Cancelled – the person is told');
  };
  const row = (g: Grant, active: boolean) => {
    const st = state(g);
    return (
      <ListRow
        key={g.id}
        title={people[g.user_id]?.full_name ?? '—'}
        subtitle={[
          `${fmtDateTime(g.starts_at)} → ${fmtDateTime(g.ends_at)}`,
          g.reason,
          `Given by ${people[g.granted_by]?.full_name ?? ''}${g.cancelled_at ? ` · cancelled ${fmtDateTime(g.cancelled_at)}${g.cancel_reason ? ` – ${g.cancel_reason}` : ''}` : ''}`,
        ].join('\n')}
        right={
          <Row gap={6} style={{ alignItems: 'center' }}>
            <Pill label={st.label} tone={st.tone} />
            {active ? <Button small variant="ghost" title="Cancel" onPress={() => cancel(g)} /> : null}
          </Row>
        }
        wrapRight
      />
    );
  };

  return (
    <Screen maxWidth={900} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'High level users' }} />
      <Muted>
        Give a person temporary GM / DGM visibility – for example someone acting for you, or an audit. It is view only: the database refuses any change or approval
        while they view as a high level user. At most one day; it ends by itself and you and the person are told. Every grant and cancellation is logged.
      </Muted>
      <Row>
        <Button title="+ Give high level access" onPress={grant} />
      </Row>
      <Section title={`In force or starting later (${current.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>{current.length ? current.map((g) => row(g, true)) : <ListRow title="None" />}</Card>
      </Section>
      <Section title={`Past (${past.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>{past.length ? past.map((g) => row(g, false)) : <ListRow title="None" />}</Card>
      </Section>
    </Screen>
  );
}
