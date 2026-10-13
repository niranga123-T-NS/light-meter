import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Notice, NumberField, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { printHtml } from '@/lib/export';
import { fmtDateTime } from '@/lib/format';
import { cached, useLoad } from '@/lib/hooks';
import { CAL_DAYS, deviceName, luxColour, luxSurveyHtml, PHASES, surveyStats, useLightSensor, type Calibration, type LuxSurvey, type Reading } from '@/lib/lux';
import type { Standard } from '@/lib/standards';
import { supabase } from '@/lib/supabase';

type Setup = { title: string; project_id: string | null; phase: LuxSurvey['phase']; std_id: string | null; target: number | null; uo: number | null; rows: number | null; cols: number | null; length: number | null; width: number | null; plane: number | null; notes: string };
const BLANK: Setup = { title: '', project_id: null, phase: 'before', std_id: null, target: null, uo: null, rows: 3, cols: 4, length: null, width: null, plane: 0.8, notes: '' };

/** A light level survey: set up the grid, take a reading at each point (Android app), see and share the result */
export default function LuxSurveyPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const isNew = id === 'new';
  const android = Platform.OS === 'android';
  const device = deviceName();
  const [setup, setSetup] = useState<Setup>(BLANK);
  const [stage, setStage] = useState<'setup' | 'measure'>('setup');
  const [readings, setReadings] = useState<Reading[]>([]);
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const sensor = useLightSensor(isNew && android);
  const { data, error } = useLoad(async () => {
    const [stds, cal, survey] = await Promise.all([
      cached('lux_standards', async () => {
        const { data: s } = await supabase.from('lighting_standards').select('*').eq('active', true).in('grp', ['indoor', 'outdoor', 'sports']).order('sort');
        return ((s ?? []) as Standard[]).filter((x) => x.vals?.em != null);
      }),
      isNew ? supabase.from('lux_calibrations').select('*').eq('user_id', me.id).eq('device', device).order('created_at', { ascending: false }).limit(1).then((r) => ((r.data ?? [])[0] ?? null) as Calibration | null) : Promise.resolve(null),
      isNew ? Promise.resolve(null) : supabase.from('lux_surveys').select('*').eq('id', id).single().then((r) => r.data as LuxSurvey | null),
    ]);
    return { stds, cal, survey };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  // ---------- an existing survey: view and share ----------
  if (!isNew) {
    const s = data.survey;
    if (!s) return <Screen><Notice>Survey not found.</Notice></Screen>;
    const st = s.stats;
    const std = data.stds.find((x) => x.id === s.std_id);
    const ok = (b: boolean) => (b ? 'green' : 'amber') as 'green' | 'amber';
    const share = () => dialog.run(() => printHtml(luxSurveyHtml(s, std ? `${std.space} – ${std.vals.em} lx (${std.category})` : null, me.full_name), { key: 'lux_survey', filters: s.title, title: `Light level survey – ${s.title}` }));
    const remove = async () => {
      if (!(await dialog.confirm('Delete this survey?', undefined, { danger: true, confirmLabel: 'Delete' }))) return;
      await dialog.run(async () => {
        const { error: e } = await supabase.from('lux_surveys').delete().eq('id', s.id);
        if (e) throw new Error(e.message);
        router.back();
      }, 'Deleted');
    };
    return (
      <Screen maxWidth={900}>
        <Stack.Screen options={{ title: s.code ?? 'Survey' }} />
        <Card style={{ gap: 4 }}>
          <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>{s.title}</Text>
          <Muted>{`${s.kind === 'grid' ? 'Room grid' : 'Spot reading'} · ${PHASES.find((p) => p.value === s.phase)?.label ?? s.phase} · ${fmtDateTime(s.created_at)}${s.device ? ` · ${s.device}` : ''}`}</Muted>
          {std ? <Muted>{`Recommendation: ${std.space} – ${std.vals.em} lx`}</Muted> : null}
        </Card>
        <Grid min={150} max={4}>
          <Stat label={s.target ? `Average (target ${s.target})` : 'Average'} value={st.eav != null ? `${Math.round(st.eav)} lx` : '—'} tone={s.target && st.eav != null ? ok(st.eav >= s.target) : undefined} />
          <Stat label="Minimum · maximum" value={st.emin != null ? `${Math.round(st.emin)} · ${Math.round(st.emax ?? 0)}` : '—'} sub="lx" />
          {s.kind === 'grid' ? <Stat label={s.uo_target ? `Uniformity Uo (target ${s.uo_target})` : 'Uniformity Uo'} value={st.uo != null ? st.uo.toFixed(2) : '—'} tone={s.uo_target && st.uo != null ? ok(st.uo >= s.uo_target) : undefined} sub={st.ud != null ? `Ud ${st.ud.toFixed(2)}` : undefined} /> : null}
          <Stat label="Points" value={String(st.n ?? s.readings.length)} />
        </Grid>
        {s.kind === 'grid' && s.rows && s.cols ? (
          <Section title={`Readings (lux)${s.length && s.width ? ` – ${s.length} × ${s.width} m` : ''}`}>
            <LuxGrid rows={s.rows} cols={s.cols} readings={s.readings} />
          </Section>
        ) : null}
        {s.notes ? <Muted>{s.notes}</Muted> : null}
        <Row gap={8} wrap>
          <Button title="Share with the client" onPress={share} />
          {s.created_by === me.id ? <Button variant="ghost" title="Delete" onPress={remove} /> : null}
        </Row>
        <Muted>Measured with a calibrated phone light sensor – indicative. A calibrated lux meter is used for acceptance tests.</Muted>
      </Screen>
    );
  }

  // ---------- a new survey (Android app) ----------
  if (!android) return <Screen><Notice tone={colors.amber}>The lux meter works only in the Android app – it uses the phone’s light sensor.</Notice></Screen>;
  const cal = data.cal;
  const calOk = cal != null && (Date.parse(new Date().toISOString()) - Date.parse(cal.created_at)) / 86400000 <= CAL_DAYS;
  if (!calOk) return <Screen><Notice tone={colors.amber}>Calibrate the phone first (Sales Tools → Lux meter → Calibrate).</Notice></Screen>;
  const lux = sensor.raw != null ? sensor.raw * cal.factor : null;
  const set = (p: Partial<Setup>) => setSetup({ ...setup, ...p });
  const rows = Math.max(1, Math.min(20, Math.round(setup.rows ?? 1)));
  const cols = Math.max(1, Math.min(20, Math.round(setup.cols ?? 1)));

  if (stage === 'setup') {
    return (
      <Screen maxWidth={900}>
        <Stack.Screen options={{ title: 'New room survey' }} />
        <Card style={{ gap: 4 }}>
          <Field label="Room" required value={setup.title} onChangeText={(v) => set({ title: v })} placeholder="e.g. ABC Hotels – conference hall" />
          <ProjectPicker value={setup.project_id} onChange={(p) => set({ project_id: p?.id ?? null })} label="Project (optional)" />
          <Segmented value={setup.phase} onChange={(v) => set({ phase: v })} options={[...PHASES]} />
          <Select
            label="Recommendation (Standards)"
            searchable
            value={setup.std_id ?? ''}
            onChange={(v) => {
              const s = data.stds.find((x) => x.id === v);
              set({ std_id: v || null, target: s ? Number(s.vals.em) : setup.target, uo: s?.vals?.uo != null ? Number(s.vals.uo) : setup.uo });
            }}
            options={[{ value: '', label: '— none —' }, ...data.stds.map((s) => ({ value: s.id, label: `${s.space} · ${s.vals.em} lx` }))]}
          />
          <Row gap={8} wrap>
            <NumberField label="Target average" suffix="lx" value={setup.target} onChange={(v) => set({ target: v })} />
            <NumberField label="Target Uo" value={setup.uo} onChange={(v) => set({ uo: v })} />
          </Row>
          <Row gap={8} wrap>
            <NumberField label="Rows of points" value={setup.rows} onChange={(v) => set({ rows: v })} hint="Across the room" />
            <NumberField label="Points in a row" value={setup.cols} onChange={(v) => set({ cols: v })} hint="Along the room" />
            <NumberField label="Room length" suffix="m" value={setup.length} onChange={(v) => set({ length: v })} />
            <NumberField label="Room width" suffix="m" value={setup.width} onChange={(v) => set({ width: v })} />
            <NumberField label="Height measured at" suffix="m" value={setup.plane} onChange={(v) => set({ plane: v })} hint="0.8 desks · 0 floors" />
          </Row>
          {setup.length && setup.width ? <Muted>{`Points every ${(setup.length / cols).toFixed(1)} m along and ${(setup.width / rows).toFixed(1)} m across, the first half a step from the walls.`}</Muted> : null}
          <Button title={`Start measuring – ${rows * cols} points`} onPress={() => (setup.title.trim() ? setStage('measure') : dialog.toast('Name the room first', 'error'))} />
        </Card>
      </Screen>
    );
  }

  const capture = () => {
    if (lux == null) return dialog.toast('No reading yet', 'error');
    const next = [...readings.filter((x) => !(x.r === sel.r && x.c === sel.c)), { r: sel.r, c: sel.c, lux: Math.round(lux) }];
    setReadings(next);
    // on to the next point without a reading, row by row
    for (let k = 1; k <= rows * cols; k++) {
      const i = (sel.r * cols + sel.c + k) % (rows * cols);
      const p = { r: Math.floor(i / cols), c: i % cols };
      if (!next.some((x) => x.r === p.r && x.c === p.c)) return setSel(p);
    }
  };
  const save = () =>
    dialog.run(async () => {
      if (!readings.length) throw new Error('Take at least one reading');
      const { data: n, error: e } = await supabase
        .from('lux_surveys')
        .insert({ title: setup.title.trim(), project_id: setup.project_id, kind: 'grid', phase: setup.phase, std_id: setup.std_id, target: setup.target, uo_target: setup.uo, rows, cols, length: setup.length, width: setup.width, plane: setup.plane, readings, stats: surveyStats(readings), factor: cal.factor, device, calibrated_at: cal.created_at, notes: setup.notes || null })
        .select('id')
        .single();
      if (e) throw new Error(e.message);
      router.replace(`/tools/lux/${n.id}`);
    }, 'Survey saved');
  const st = surveyStats(readings);
  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: setup.title || 'Room survey' }} />
      <Card style={{ alignItems: 'center', gap: 4 }}>
        <Muted>{`Point ${sel.r + 1}-${sel.c + 1} · hold the phone flat at ${setup.plane ?? 0.8} m, sensor up, without shading it`}</Muted>
        <Text style={{ fontSize: 52, fontWeight: '800', color: colors.ink }}>{lux != null ? Math.round(lux).toLocaleString('en-LK') : '—'}</Text>
        <Muted>{`lux${sensor.steady ? ' · steady' : ' · settling…'}`}</Muted>
        <Button title="Capture this point" onPress={capture} />
      </Card>
      <LuxGrid rows={rows} cols={cols} readings={readings} selected={sel} onSelect={setSel} />
      <Grid min={140} max={4}>
        <Stat label={setup.target ? `Average (target ${setup.target})` : 'Average'} value={st.eav != null ? `${Math.round(st.eav)} lx` : '—'} />
        <Stat label="Min · max" value={st.emin != null ? `${Math.round(st.emin)} · ${Math.round(st.emax ?? 0)}` : '—'} />
        <Stat label="Uniformity Uo" value={st.uo != null ? st.uo.toFixed(2) : '—'} />
        <Stat label="Points" value={`${readings.length} / ${rows * cols}`} />
      </Grid>
      <Field label="Notes" multiline value={setup.notes} onChangeText={(v) => set({ notes: v })} placeholder="e.g. daylight blinds closed, 2 lamps failed near the door" />
      <Row gap={8} wrap>
        <Button title="Save survey" onPress={save} />
        <Button variant="ghost" title="Back to setup" onPress={() => setStage('setup')} />
      </Row>
    </Screen>
  );
}

/** The grid of measuring points, coloured from the lowest to the highest reading */
function LuxGrid({ rows, cols, readings, selected, onSelect }: { rows: number; cols: number; readings: Reading[]; selected?: { r: number; c: number }; onSelect?: (p: { r: number; c: number }) => void }) {
  const vals = readings.map((x) => x.lux);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;
  return (
    <View style={{ gap: 3 }}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 3 }}>
          {Array.from({ length: cols }, (_, c) => {
            const x = readings.find((q) => q.r === r && q.c === c);
            const isSel = selected?.r === r && selected?.c === c;
            return (
              <Pressable
                key={c}
                onPress={onSelect ? () => onSelect({ r, c }) : undefined}
                style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: x ? luxColour(x.lux, min, max) : '#F3F4F6', borderWidth: isSel ? 3 : 1, borderColor: isSel ? colors.ink : '#E5E7EB' }}
              >
                <Text style={{ fontWeight: '700', fontSize: 13, color: '#111' }}>{x ? x.lux : '·'}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
