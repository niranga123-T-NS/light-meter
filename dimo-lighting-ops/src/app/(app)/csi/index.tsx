import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, colors, Empty, ErrorBanner, Grid, ListRow, Loading, Muted, Pill, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CSI_AREAS, CSI_CARDS, CSI_STAGES, moodFace, npsOf, type CsiSurvey } from '@/lib/csi';
import { fmtDate } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';

const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);

/** CSI – customer satisfaction: start "Light up DIMO" surveys, follow the answers, see where customers feel the pain */
export default function CsiHome() {
  const me = useMe();
  const people = usePeople();
  const sales = isSales(me.role);
  const [tab, setTab] = useState<'all' | 'open' | 'alerts'>('all');
  const { data, error } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('csi_surveys').select('*, organizations(name), projects(name)').order('created_at', { ascending: false });
    if (e) throw new Error(e.message);
    return (rows ?? []) as CsiSurvey[];
  }, []);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const done = data.filter((s) => s.status === 'completed');
  const csi = avg(done.map((s) => s.overall ?? 0)), nps = npsOf(done);
  const alerts = done.filter((s) => s.alert && !s.followed_up_at);
  const stageAvg = CSI_STAGES.map((st) => ({ ...st, v: avg(done.map((s) => s.stage_scores?.[st.value]).filter((x): x is number => !!x)) }));
  // importance (average points) against satisfaction (share of agree on the cards for that area)
  const areas = CSI_AREAS.map((ar) => {
    const imp = avg(done.map((s) => s.points?.[ar.value]).filter((x): x is number => x != null));
    const ans = done.flatMap((s) => CSI_CARDS.filter((c) => c.area === ar.value).map((c) => s.cards?.[c.key])).filter((x): x is number => x != null);
    const sat = ans.length ? (100 * ans.filter((x) => x === 1).length) / ans.length : null;
    return { ...ar, imp, sat };
  });
  const list = tab === 'open' ? data.filter((s) => s.status === 'open') : tab === 'alerts' ? alerts : data;
  const byPerson = !sales ? [...new Set(data.map((s) => s.sales_person_id))].map((pid) => { const d = done.filter((s) => s.sales_person_id === pid); return { pid, n: d.length, csi: avg(d.map((s) => s.overall ?? 0)), nps: npsOf(d) }; }) : [];
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'CSI – customer satisfaction' }} />
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Muted>“Light up DIMO” – a 60-second survey the customer fills on your tablet, by link, or with you on a call.</Muted>
        {sales ? <Button title="+ New CSI" onPress={() => router.push('/csi/new')} /> : null}
      </Row>
      <Grid min={180}>
        <Stat label="CSI (average overall)" value={csi == null ? '—' : `${moodFace(csi)} ${Math.round(csi)}`} tone={csi == null ? undefined : csi >= 75 ? 'green' : csi >= 60 ? 'amber' : 'red'} sub="0–100, the dimmer" />
        <Stat label="NPS" value={nps == null ? '—' : String(nps)} tone={nps == null ? undefined : nps >= 30 ? 'green' : nps >= 0 ? 'amber' : 'red'} sub="% promoters − % detractors" />
        <Stat label="Answered" value={`${done.length} / ${data.filter((s) => s.status !== 'cancelled').length}`} sub="completed / sent" />
        <Stat label="Low scores to call back" value={String(alerts.length)} tone={alerts.length ? 'red' : 'green'} onPress={() => setTab('alerts')} sub="within 48 hours" />
      </Grid>

      {done.length ? (
        <>
          <Section title="Where customers feel it – the journey">
            <Card>
              {stageAvg.map((st) => (
                <Row key={st.value} gap={10} style={{ alignItems: 'center', paddingVertical: 4 }}>
                  <Text style={{ width: 230 }}>{`${st.icon} ${st.label}`}</Text>
                  <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.line }}>
                    {st.v ? <View style={{ width: `${(st.v / 5) * 100}%`, height: 10, borderRadius: 5, backgroundColor: st.v >= 4 ? colors.green : st.v >= 3 ? colors.amber : colors.red }} /> : null}
                  </View>
                  <Text style={{ width: 70, textAlign: 'right' }}>{st.v ? `${['😢', '🙁', '😐', '🙂', '😄'][Math.round(st.v) - 1]} ${st.v.toFixed(1)}` : '—'}</Text>
                </Row>
              ))}
            </Card>
          </Section>
          <Section title="What matters vs how we do">
            <Card>
              <Muted>Importance = average of the 100 points · satisfaction = share of “agree” on the cards for that area. High importance with low satisfaction = fix first.</Muted>
              {areas.map((ar) => {
                const fix = (ar.imp ?? 0) >= 20 && (ar.sat ?? 100) < 60;
                return (
                  <Row key={ar.value} gap={10} style={{ alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line }}>
                    <Text style={{ width: 200 }}>{`${ar.icon} ${ar.label}`}</Text>
                    <Text style={{ width: 120 }}>{`importance ${ar.imp == null ? '—' : Math.round(ar.imp)}`}</Text>
                    <Text style={{ width: 140 }}>{`satisfied ${ar.sat == null ? '—' : `${Math.round(ar.sat)}%`}`}</Text>
                    {fix ? <Pill label="Fix first" tone={colors.red} /> : ar.sat != null && ar.sat >= 75 ? <Pill label="Strength" tone={colors.green} /> : null}
                  </Row>
                );
              })}
            </Card>
          </Section>
        </>
      ) : null}

      {byPerson.length ? (
        <Section title="By sales person">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {byPerson.map((p) => (
              <ListRow key={p.pid} title={people[p.pid]?.full_name ?? '—'} subtitle={`${p.n} answered`} right={<Text>{p.csi == null ? '—' : `${moodFace(p.csi)} CSI ${Math.round(p.csi)} · NPS ${p.nps ?? '—'}`}</Text>} />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Surveys" right={<Segmented value={tab} onChange={setTab} options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Waiting' }, { value: 'alerts', label: 'Call back' }]} />}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {list.map((s) => (
            <ListRow
              key={s.id}
              highlight={s.alert && !s.followed_up_at ? colors.red : undefined}
              title={`${s.overall != null ? `${moodFace(s.overall)} ` : ''}${s.organizations?.name ?? '—'} · ${s.contact_name}`}
              subtitle={`${s.code} · ${s.projects?.name ?? 'customer'} · ${s.status === 'completed' ? `answered ${fmtDate(s.completed_at)}${s.filled_by === 'sales' ? ' (on a call)' : ''}` : s.status === 'open' ? `sent ${fmtDate(s.created_at)} · ${s.channel}` : 'cancelled'}${sales ? '' : ` · ${people[s.sales_person_id]?.full_name ?? ''}`}`}
              right={s.status === 'completed' ? <Pill label={`${s.overall} · NPS ${s.nps}`} tone={(s.overall ?? 0) >= 75 ? colors.green : (s.overall ?? 0) >= 60 ? colors.amber : colors.red} /> : <Pill label={s.status === 'open' ? 'Waiting' : 'Cancelled'} tone={s.status === 'open' ? colors.blue : colors.grey} />}
              wrapRight
              onPress={() => router.push(`/csi/${s.id}`)}
            />
          ))}
          {!list.length ? <Empty title={tab === 'alerts' ? 'No low scores waiting for a call' : 'No surveys yet'} hint={sales ? 'Press “+ New CSI” to light up DIMO with a customer.' : undefined} /> : null}
        </Card>
      </Section>
    </Screen>
  );
}
