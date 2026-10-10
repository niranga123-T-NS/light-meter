import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, MultiSelect, Row, Screen, Section, Segmented, Select, Toggle } from '@/components/ui';
import type { PlanItem } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { formName, loadHseForms, type HseRecord, type Induction, type Participant } from '@/lib/hse';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { policeState, type Worker } from '@/lib/workers';

/** Toolbox meeting (OHS/LTD/TBT/01): today's activity from the plan, hazards, control measures, participants from the induction register. */
export default function ToolboxTalk() {
  const { project } = useLocalSearchParams<{ project: string }>();
  const dialog = useDialog();
  const [error, setError] = useState<string | null>(null);
  const [h, setH] = useState<Record<string, string>>({ shift: 'day' });
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [extra, setExtra] = useState<Participant[]>([]);
  const [permit, setPermit] = useState<string | null>(null);
  const { data } = useLoad(async () => {
    const [forms, items, ind, permits, wk, proj] = await Promise.all([
      loadHseForms(),
      supabase.from('exec_plan_items').select('*').eq('exec_project_id', project).eq('day', todayISO()),
      supabase.from('hse_inductions').select('*').eq('exec_project_id', project).order('name'),
      supabase.from('hse_records').select('*').eq('exec_project_id', project).like('code', 'PTW-%').in('status', ['submitted', 'active']),
      supabase.from('exec_workers').select('*').eq('exec_project_id', project).not('induction_id', 'is', null),
      supabase.from('exec_projects').select('police_required').eq('id', project).single(),
    ]);
    // Workers blocked for a missing police report are left out of the people present
    const now = Date.now();
    const blocked = new Set(((wk.data ?? []) as Worker[]).filter((w) => policeState(w, proj.data?.police_required, now) === 'blocked').map((w) => w.induction_id));
    const plan = ((items.data ?? []) as PlanItem[]).map((x) => `• ${x.title}${x.zone ? ` – ${x.zone}` : ''}`).join('\n');
    return { form: forms.find((f) => f.code === 'TBT-01')!, plan, inductions: ((ind.data ?? []) as Induction[]).filter((x) => !blocked.has(x.id)), blockedCount: blocked.size, permits: (permits.data ?? []) as HseRecord[] };
  }, [project]);
  const [seeded, setSeeded] = useState(false);
  if (data && !seeded) {
    setSeeded(true);
    if (data.plan) setH((s) => ({ ...s, activity: data.plan }));
  }
  if (!data?.form) return <Screen><Loading /></Screen>;
  const f = data.form;
  const set = (k: string, v: string) => setH((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setError(null);
    const participants: Participant[] = [
      ...data.inductions.filter((x) => picked.includes(x.id)).map((x) => ({ name: x.name, nic: x.nic, company: x.company ?? '', position: '' })),
      ...extra.filter((x) => x.name.trim()),
    ];
    if (!h.activity?.trim()) return setError('Enter the activity / work programme');
    if (!h.hazards?.trim()) return setError('Enter the safety issues (hazards and risks)');
    if (!participants.length) return setError('Add the participants');
    await dialog.run(async () => {
      const id = await rpc<string>('save_tbt', {
        p_exec: project,
        p: { header: h, answers: Object.fromEntries(Object.entries(ticks).filter(([, v]) => v).map(([k]) => [k, { a: 'yes' }])), participants, permit_id: permit },
      });
      router.replace(`/execution/hse/form/${id}`);
    }, 'Toolbox meeting recorded');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: 'Toolbox meeting' }} />
      <TestingBanner what="Toolbox meetings" />
      <ErrorBanner message={error} />
      <Card style={{ gap: 2 }}>
        <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>{formName(f)}</Text>
        <Muted>{`${f.doc_no} · ${f.issue} · ${fmtDate(todayISO())} · the TBT number is given when you save`}</Muted>
      </Card>
      <Section title="Details">
        <Card>
          <Field label="Location" value={h.location ?? ''} onChangeText={(v) => set('location', v)} />
          <Select label="Permit details" value={permit} onChange={(v) => setPermit(v || null)}
            options={[{ value: '', label: '— no permit —' }, ...data.permits.map((x) => ({ value: x.id, label: `${x.code} · ${String(x.header.location ?? '')}` }))]} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Work shift</Text>
          <Segmented value={h.shift ?? 'day'} onChange={(v) => set('shift', v)} options={[{ value: 'day', label: 'Day' }, { value: 'night', label: 'Night' }]} />
        </Card>
      </Section>
      <Section title="Section A – Activity / work programme">
        <Card>
          <Field label="Today's work (from the plan – edit as needed)" multiline value={h.activity ?? ''} onChangeText={(v) => set('activity', v)} />
        </Card>
      </Section>
      <Section title="Section B – Safety issues (hazards & risks)">
        <Card>
          <Field label="Hazards and risks discussed" multiline value={h.hazards ?? ''} onChangeText={(v) => set('hazards', v)} placeholder="e.g. Fall from height, live cables, moving plant, heat" />
        </Card>
      </Section>
      <Section title="Section C – Control measures">
        <Card>
          <Row wrap gap={12}>
            {f.items.map((it) => (
              <Toggle key={it.no} label={it.text} value={!!ticks[it.no]} onChange={(v) => setTicks((s) => ({ ...s, [it.no]: v }))} />
            ))}
          </Row>
          <Field label="If any other" value={h.other ?? ''} onChangeText={(v) => set('other', v)} />
        </Card>
      </Section>
      <Section title="Section D – Participants" right={<Button small variant="secondary" title="+ Person" onPress={() => setExtra((s) => [...s, { name: '', position: '' }])} />}>
        <Card>
          {data.blockedCount ? <Muted style={{ color: colors.red }}>{`${data.blockedCount} inducted ${data.blockedCount === 1 ? 'worker is' : 'workers are'} blocked (no police report) and not listed`}</Muted> : null}
          {data.inductions.length ? (
            <MultiSelect label="Inducted people present" values={picked} onChange={setPicked} options={data.inductions.map((x) => ({ value: x.id, label: `${x.name} · ${x.company ?? ''}` }))} />
          ) : (
            <Muted>{"Nobody is in this project's induction register yet – add people below, and induct them from the HSE tab."}</Muted>
          )}
          {extra.map((x, i) => (
            <Grid key={i} min={200}>
              <Field label={`Name ${i + 1}`} value={x.name} onChangeText={(v) => setExtra((s) => s.map((y, k) => (k === i ? { ...y, name: v } : y)))} />
              <View>
                <Field label="Position" value={x.position ?? ''} onChangeText={(v) => setExtra((s) => s.map((y, k) => (k === i ? { ...y, position: v } : y)))} />
              </View>
            </Grid>
          ))}
          <Muted>{`${picked.length + extra.filter((x) => x.name.trim()).length} participants`}</Muted>
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Save toolbox meeting" onPress={save} />
      </Row>
    </Screen>
  );
}
