import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, todayISO } from '@/lib/format';
import { clearPeopleCache, useLoad, usePeople } from '@/lib/hooks';
import { callFunction, rpc, supabase } from '@/lib/supabase';

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

/** High level users: the DGM gives a person view-only DGM access for up to one day; it ends by itself */
export default function HighLevelUsers() {
  const { realRole } = useAuth();
  const dialog = useDialog();
  const people = usePeople();
  // A new person's login, shown once to hand over
  const [issued, setIssued] = useState<{ name: string; login: string; password: string } | null>(null);
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: g, error: e } = await supabase.from('high_level_grants').select('*').order('starts_at', { ascending: false }).limit(200);
    if (e) throw new Error(e.message);
    return { grants: (g ?? []) as Grant[], at: Date.now() };
  }, []);
  if (realRole !== 'gm') return <Screen><Notice>Only the DGM gives high level access.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const state = (g: Grant) =>
    g.cancelled_at ? { label: 'Cancelled', tone: colors.grey } : Date.parse(g.ends_at) <= now ? { label: 'Ended', tone: colors.grey } : Date.parse(g.starts_at) > now ? { label: 'Starts later', tone: colors.blue } : { label: 'In force', tone: colors.green };
  const now = data.at;
  const current = data.grants.filter((g) => !g.cancelled_at && Date.parse(g.ends_at) > now);
  const past = data.grants.filter((g) => !current.includes(g));

  const grant = async () => {
    const r = await dialog.prompt({
      title: 'Give high level access',
      message: 'View only – the person sees everything the DGM sees, but cannot change or approve anything. One day at most; it ends by itself.',
      fields: [
        {
          key: 'u',
          label: 'Person',
          type: 'select',
          required: true,
          searchable: true,
          initial: 'new',
          options: [
            { value: 'new', label: '+ A new person (not in the system)' },
            ...Object.values(people)
              .filter((p) => (p.active || p.role === 'guest') && p.role !== 'gm' && p.role !== 'sys_admin')
              .sort((a, b) => a.full_name.localeCompare(b.full_name))
              .map((p) => ({ value: p.id, label: p.role === 'guest' ? `${p.full_name} (from outside${p.company ? ` – ${p.company}` : ''})` : p.full_name })),
          ],
        },
        { key: 'n', label: 'New person – full name', hint: 'Only for a new person' },
        { key: 'co', label: 'New person – company / organisation', hint: 'e.g. KPMG – auditors; DIMO Group Finance' },
        { key: 'e', label: 'New person – email', hint: 'Their login. Or give a mobile number instead' },
        { key: 'm', label: 'New person – mobile', hint: 'Used as the login when there is no email' },
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
    const isNew = r.u === 'new';
    if (isNew && (!r.n?.trim() || (!r.e?.trim() && !r.m?.trim()))) return dialog.toast('For a new person give the full name and an email or mobile number', 'error');
    await dialog.run(async () => {
      let uid = r.u;
      let login: { login: string; password: string } | null = null;
      if (isNew) {
        const res = await callFunction<{ id: string; login: string; password: string }>('admin-users', { action: 'guest', full_name: r.n.trim(), company: r.co?.trim() || null, email: r.e?.trim() || null, phone: r.m?.trim() || null });
        uid = res.id;
        login = { login: res.login, password: res.password };
        clearPeopleCache();
      }
      await rpc('grant_high_level', { p_user: uid, p_starts: start.toISOString(), p_ends: end.toISOString(), p_reason: r.r });
      if (login) setIssued({ name: r.n.trim(), ...login });
      await reload();
    }, isNew ? 'Person added and access given – hand over the login below' : 'Access given – the person is told');
  };
  // Move the period: before it starts, start and end; once in force, only the end (one day at most)
  const change = async (g: Grant) => {
    const started = Date.parse(g.starts_at) <= now;
    const sl = (iso: string) => new Date(Date.parse(iso) + 5.5 * 36e5).toISOString();
    const hours = Math.round((Date.parse(g.ends_at) - Date.parse(g.starts_at)) / 36e5);
    // half-hour slots, plus the period's own time when it is not on a slot (e.g. a grant that started "now")
    const slots = (cur: string) => [...new Set([...TIMES, cur])].sort().map((t) => ({ value: t, label: t }));
    const r = await dialog.prompt({
      title: `Change the time – ${people[g.user_id]?.full_name ?? ''}`,
      message: started
        ? `In force since ${fmtDateTime(g.starts_at)} – the end can be moved earlier or later, up to one day from the start (${fmtDateTime(new Date(Date.parse(g.starts_at) + 24 * 36e5).toISOString())}).`
        : 'Not started yet – move the start and the length. One day at most.',
      fields: [
        ...(started
          ? []
          : [
              { key: 'd', label: 'From (date)', type: 'date' as const, required: true, initial: sl(g.starts_at).slice(0, 10) },
              { key: 't', label: 'From (time)', type: 'select' as const, required: true, initial: sl(g.starts_at).slice(11, 16), options: slots(sl(g.starts_at).slice(11, 16)) },
            ]),
        { key: 'ed', label: 'Until (date)', type: 'date', required: true, initial: sl(g.ends_at).slice(0, 10) },
        { key: 'et', label: 'Until (time)', type: 'select', required: true, initial: sl(g.ends_at).slice(11, 16), options: slots(sl(g.ends_at).slice(11, 16)) },
        { key: 'n', label: 'Reason for the change', type: 'multiline', hint: `Now ${hours} hour${hours === 1 ? '' : 's'}` },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    const start = started ? null : new Date(`${r.d}T${r.t}:00+05:30`).toISOString();
    const end = new Date(`${r.ed}T${r.et}:00+05:30`).toISOString();
    await dialog.run(async () => {
      await rpc('change_high_level', { p_id: g.id, p_starts: start, p_ends: end, p_reason: r.n || null });
      await reload();
    }, 'Time changed – the person is told');
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
            {active ? <Button small variant="ghost" title="Change time" onPress={() => change(g)} /> : null}
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
        Give a person temporary DGM visibility – for example someone acting for you, or an outside auditor (choose “+ A new person” to create them). It is view only: the database refuses any change or approval
        while they view as a high level user. At most one day; it ends by itself and you and the person are told. Every grant and cancellation is logged.
      </Muted>
      <Row>
        <Button title="+ Give high level access" onPress={grant} />
      </Row>
      {issued ? (
        <Card style={{ gap: 4, borderColor: colors.green }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>{`Login for ${issued.name} – shown once, hand it over now`}</Text>
          <Text selectable style={{ color: colors.ink }}>{`Website: https://dimo-lighting-ops.vercel.app\nLogin: ${issued.login}\nTemporary password: ${issued.password}`}</Text>
          <Muted>They can sign in only to view, and only during the access period. The login is switched off automatically when the period ends.</Muted>
          <Row>
            <Button small variant="ghost" title="Done" onPress={() => setIssued(null)} />
          </Row>
        </Card>
      ) : null}
      <Section title={`In force or starting later (${current.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>{current.length ? current.map((g) => row(g, true)) : <ListRow title="None" />}</Card>
      </Section>
      <Section title={`Past (${past.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>{past.length ? past.map((g) => row(g, false)) : <ListRow title="None" />}</Card>
      </Section>
    </Screen>
  );
}
