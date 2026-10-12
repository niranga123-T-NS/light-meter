import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useDialog } from '@/components/dialog';
import { ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Notice, NumberField, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { calcSheetHtml, LUX_SCALE, planSvg } from '@/lib/calcSheet';
import { printHtml } from '@/lib/export';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { cached, useLoad } from '@/lib/hooks';
import { autoLayout, calculate, FITTING_TYPES, MAINTENANCE, outline, REFLECTANCES, savings, suggestCount, type Pt, type RoomInput, type Shape } from '@/lib/lightcalc';
import { ROLE_SHORT } from '@/lib/roles';
import type { Standard, StdGroupRow } from '@/lib/standards';
import { supabase } from '@/lib/supabase';

type Tariff = { id: string; supplier: 'CEB' | 'LECO'; code: string; name: string; rate: number | null; effective_from: string | null };
type Form = {
  title: string;
  project_id: string | null;
  shape: Shape;
  length: number | null;
  width: number | null;
  cutL: number | null;
  cutW: number | null;
  points: string;
  height: number | null;
  mount: number | null;
  plane: number | null;
  refl: string;
  rc: number | null;
  rw: number | null;
  rf: number | null;
  maint: string;
  mf: number | null;
  std_id: string | null;
  target: number | null;
  uo: number | null;
  type: string;
  fname: string;
  watts: number | null;
  lumens: number | null;
  count: number | null; // null = the fewest that reach the target
  oldDesc: string;
  oldWatts: number | null;
  oldQty: number | null;
  hours: number | null;
  days: number | null;
  tariff_id: string | null;
  rate: number | null;
  co2: number | null;
  cost: number | null;
};
const BLANK: Form = {
  title: '',
  project_id: null,
  shape: 'rect',
  length: 12,
  width: 8,
  cutL: 5,
  cutW: 3,
  points: '0,0; 12,0; 12,5; 7,5; 7,8; 0,8',
  height: 2.8,
  mount: 2.8,
  plane: 0.8,
  refl: 'light',
  rc: 0.7,
  rw: 0.5,
  rf: 0.2,
  maint: 'clean',
  mf: 0.8,
  std_id: null,
  target: 500,
  uo: 0.6,
  type: 'panel',
  fname: '',
  watts: 36,
  lumens: 4000,
  count: null,
  oldDesc: '',
  oldWatts: null,
  oldQty: null,
  hours: 10,
  days: 300,
  tariff_id: null,
  rate: null,
  co2: 0.6,
  cost: null,
};
const parsePoints = (t: string): Pt[] =>
  t
    .split(/[;\n]/)
    .map((p) => p.split(',').map((x) => Number(x.trim())))
    .filter((a) => a.length === 2 && a.every((x) => Number.isFinite(x)))
    .map(([x, y]) => ({ x, y }));

/** Quick calculation: ① room ② fitting ③ result ④ savings – a DRAFT sheet for the client, saved and turned into an inquiry */
export default function QuickCalc() {
  const { id, std } = useLocalSearchParams<{ id: string; std?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const { width: screenW } = useWindowDimensions();
  const isNew = id === 'new';
  const [form, setForm] = useState<Form | null>(null);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : id);
  const { data, error } = useLoad(async () => {
    const [refs, calc] = await Promise.all([
      cached('quick_calc_refs', async () => {
        const [s, g, t] = await Promise.all([
          supabase.from('lighting_standards').select('*').eq('active', true).in('grp', ['indoor', 'outdoor', 'sports', 'energy']).order('sort'),
          supabase.from('lighting_standard_groups').select('*'),
          supabase.from('electricity_tariffs').select('id, supplier, code, name, rate, effective_from').eq('active', true).order('sort'),
        ]);
        if (s.error) throw new Error(s.error.message);
        return { stds: (s.data ?? []) as Standard[], groups: (g.data ?? []) as StdGroupRow[], tariffs: (t.data ?? []) as Tariff[] };
      }),
      isNew ? Promise.resolve(null) : supabase.from('quick_calcs').select('*').eq('id', id).single().then((r) => r.data as { id: string; code: string; inputs: Form } | null),
    ]);
    return { ...refs, calc };
  }, [id]);

  // the form: a saved calculation, a space chosen in Standards ("Use in Quick calc"), or the defaults
  const preset = useMemo<Form | null>(() => {
    if (!data) return null;
    if (data.calc) return { ...BLANK, ...data.calc.inputs };
    const s = std ? data.stds.find((x) => x.id === std) : null;
    return s ? { ...BLANK, std_id: s.id, title: s.space, target: Number(s.vals?.em) || BLANK.target, uo: s.vals?.uo != null ? Number(s.vals.uo) : null } : BLANK;
  }, [data, std]);
  const f = form ?? preset;

  const calc = useMemo(() => {
    if (!f) return null;
    const room: RoomInput = {
      shape: f.shape,
      length: f.length ?? 0,
      width: f.width ?? 0,
      cutL: f.cutL ?? undefined,
      cutW: f.cutW ?? undefined,
      points: f.shape === 'free' ? parsePoints(f.points) : undefined,
      height: f.height ?? 0,
      mount: f.mount ?? f.height ?? 0,
      plane: f.plane ?? 0,
      rc: f.rc ?? 0.7,
      rw: f.rw ?? 0.5,
      rf: f.rf ?? 0.2,
    };
    const fit = { type: f.type, watts: f.watts ?? 0, lumens: f.lumens ?? 0, name: f.fname };
    const mf = f.mf ?? 0.8;
    const poly = outline(room);
    if (!(room.mount - room.plane > 0) || !(fit.lumens > 0) || poly.length < 3) return { room, fit, mf, poly, positions: [] as Pt[], r: null, auto: null };
    const auto = f.count ? null : suggestCount(room, fit, mf, f.target ?? 300, f.uo);
    const positions = f.count ? autoLayout(poly, f.count, room) : (auto?.positions ?? []);
    return { room, fit, mf, poly, positions, r: calculate(room, fit, positions, mf), auto };
  }, [f]);

  if (!data || !f || !calc) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const set = (p: Partial<Form>) => setForm({ ...f, ...p });
  const { r, positions } = calc;
  const stdRow = data.stds.find((x) => x.id === f.std_id) ?? null;
  const stdGroup = stdRow ? data.groups.find((g) => g.grp === stdRow.grp) : null;
  const lpd = data.stds.find((x) => x.grp === 'energy' && x.vals?.lpd != null && stdRow && x.space.toLowerCase().startsWith(stdRow.category.toLowerCase().split(' ')[0]));
  const lpdLimit = lpd ? Number(lpd.vals.lpd) : null;
  const tariff = data.tariffs.find((t) => t.id === f.tariff_id) ?? null;
  const rate = tariff?.rate ?? f.rate;
  const oldTotal = (f.oldWatts ?? 0) * (f.oldQty ?? 0);
  const sv = r && oldTotal > 0 ? savings({ oldWatts: oldTotal, newWatts: r.watts, hoursPerDay: f.hours ?? 0, daysPerYear: f.days ?? 0, rate, co2: f.co2, cost: f.cost }) : null;
  const target = f.target ?? 0;
  const planW = Math.min(screenW - 64, 760);
  const plan = planSvg(calc.poly, positions, r, target, Math.max(planW, 280));

  const savingLines = (): [string, string][] | null =>
    sv
      ? [
          ['Existing lighting', `${f.oldQty} × ${f.oldWatts} W${f.oldDesc ? ` (${f.oldDesc})` : ''} = ${(oldTotal / 1000).toFixed(2)} kW`],
          ['New lighting', `${positions.length} × ${f.watts} W = ${((r?.watts ?? 0) / 1000).toFixed(2)} kW`],
          ['Use', `${f.hours} h a day · ${f.days} days a year`],
          ['Energy saved', `${fmtNumber(sv.kwh, 0)} kWh a year${sv.pct != null ? ` (${sv.pct.toFixed(0)}% less)` : ''}`],
          ...(sv.lkr != null ? ([['Money saved', `${fmtMoney(sv.lkr, 'LKR')} a year${tariff ? ` (${tariff.supplier} ${tariff.code} at LKR ${rate}/kWh)` : ` (at LKR ${rate}/kWh)`}`]] as [string, string][]) : []),
          ...(sv.co2t != null ? ([['CO₂ avoided', `${sv.co2t.toFixed(1)} tonnes a year`]] as [string, string][]) : []),
          ...(sv.paybackMonths != null ? ([['Payback', `${sv.paybackMonths.toFixed(0)} months on a project cost of ${fmtMoney(f.cost, 'LKR')}`]] as [string, string][]) : []),
        ]
      : null;
  const brief = () =>
    [
      `Room: ${r?.A.toFixed(1)} m² (${f.shape === 'rect' ? `${f.length} × ${f.width} m` : f.shape === 'l' ? `L-shape ${f.length} × ${f.width} m less ${f.cutL} × ${f.cutW} m` : 'free outline'}), ceiling ${f.height} m, fittings at ${f.mount} m, working plane ${f.plane} m.`,
      `Target: ${f.target} lx${f.uo ? `, Uo ${f.uo}` : ''}${stdRow ? ` – ${stdRow.space} (${stdGroup?.source ?? ''})` : ''}.`,
      `Indicative: ${positions.length} × ${f.fname || FITTING_TYPES.find((t) => t.key === f.type)?.label} ${f.watts} W / ${f.lumens} lm → ${Math.round(r?.em ?? 0)} lx average, Uo ${r?.uo.toFixed(2)}, ${r?.wpm2.toFixed(1)} W/m².`,
      oldTotal ? `Existing: ${f.oldQty} × ${f.oldWatts} W ${f.oldDesc}`.trim() + '.' : '',
    ]
      .filter(Boolean)
      .join('\n');

  const save = () =>
    dialog.run(async () => {
      if (!f.title.trim()) throw new Error('Give the calculation a name, e.g. the room or the client');
      if (!r) throw new Error('Complete the room and the fitting first');
      const row = {
        title: f.title.trim(),
        project_id: f.project_id,
        inputs: f,
        results: { em: r.em, emin: r.emin, uo: r.uo, count: positions.length, watts: r.watts, wpm2: r.wpm2, area: r.A, savings: sv, brief: brief() },
        updated_at: new Date().toISOString(),
      };
      if (savedId) {
        const { error: e } = await supabase.from('quick_calcs').update(row).eq('id', savedId);
        if (e) throw new Error(e.message);
      } else {
        const { data: n, error: e } = await supabase.from('quick_calcs').insert(row).select('id').single();
        if (e) throw new Error(e.message);
        setSavedId(n.id);
        router.setParams({ id: n.id });
      }
    }, 'Saved');
  const share = () =>
    dialog.run(async () => {
      if (!r) throw new Error('Complete the room and the fitting first');
      await printHtml(
        calcSheetHtml({
          code: data.calc?.code ?? null,
          title: f.title.trim() || 'Lighting calculation',
          room: calc.room,
          poly: calc.poly,
          fit: calc.fit,
          positions,
          r,
          mf: calc.mf,
          space: stdRow?.space ?? null,
          source: stdGroup?.source ?? null,
          target,
          uoTarget: f.uo,
          lpdLimit,
          savings: savingLines() ? { lines: savingLines() as [string, string][] } : null,
          by: `${me.full_name} – ${ROLE_SHORT[me.role]}`,
        }),
        { key: 'quick_calc', filters: f.title || 'Quick calculation', title: `Lighting calculation – ${f.title || 'room'}` },
      );
    });
  const makeInquiry = async () => {
    if (!savedId) return dialog.toast('Save the calculation first', 'error');
    if (!f.project_id) return dialog.toast('Choose the project (section ①) – the inquiry is made on it', 'error');
    router.push(`/inquiries/new?project=${f.project_id}&calc=${savedId}`);
  };

  const ok = (b: boolean) => (b ? 'green' : 'amber') as 'green' | 'amber';
  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: data.calc?.code ?? 'Quick calculation' }} />
      <Notice tone={colors.blue}>Indicative calculation from the fitting type and the data sheet watts and lumens. Results are shared marked DRAFT; the final design is by DIMO Lighting Design.</Notice>

      <Section title="① Room">
        <Card style={{ gap: 4 }}>
          <Field label="Name" required value={f.title} onChangeText={(v) => set({ title: v })} placeholder="e.g. ABC Hotels – conference hall" />
          <ProjectPicker value={f.project_id} onChange={(p) => set({ project_id: p?.id ?? null })} label="Project (optional – needed to make an inquiry)" />
          <Segmented
            value={f.shape}
            onChange={(v) => set({ shape: v, count: null })}
            options={[
              { value: 'rect', label: 'Square / rectangle' },
              { value: 'l', label: 'L-shape' },
              { value: 'free', label: 'Any shape' },
            ]}
          />
          {f.shape === 'free' ? (
            <Field
              label="Corners (x,y in metres, clockwise)"
              multiline
              value={f.points}
              onChangeText={(v) => set({ points: v, count: null })}
              hint="e.g. 0,0; 12,0; 12,5; 7,5; 7,8; 0,8 – walk round the room from one corner"
            />
          ) : (
            <Row gap={8} wrap>
              <NumberField label="Length" suffix="m" value={f.length} onChange={(v) => set({ length: v, count: null })} />
              <NumberField label="Width" suffix="m" value={f.width} onChange={(v) => set({ width: v, count: null })} />
              {f.shape === 'l' ? (
                <>
                  <NumberField label="Cut-out length" suffix="m" value={f.cutL} onChange={(v) => set({ cutL: v, count: null })} />
                  <NumberField label="Cut-out width" suffix="m" value={f.cutW} onChange={(v) => set({ cutW: v, count: null })} />
                </>
              ) : null}
            </Row>
          )}
          <Row gap={8} wrap>
            <NumberField label="Ceiling height" suffix="m" value={f.height} onChange={(v) => set({ height: v, mount: f.mount === f.height ? v : f.mount, count: null })} />
            <NumberField label="Fitting height" suffix="m" value={f.mount} onChange={(v) => set({ mount: v, count: null })} hint="Same as the ceiling for recessed" />
            <NumberField label="Working plane" suffix="m" value={f.plane} onChange={(v) => set({ plane: v, count: null })} hint="0.8 desks · 0 floors" />
          </Row>
          <Select
            label="Space (target from Standards)"
            searchable
            value={f.std_id ?? ''}
            onChange={(v) => {
              const s = data.stds.find((x) => x.id === v);
              set({ std_id: v || null, target: s ? Number(s.vals?.em) || f.target : f.target, uo: s?.vals?.uo != null ? Number(s.vals.uo) : f.uo, count: null });
            }}
            options={[{ value: '', label: '— my own target —' }, ...data.stds.filter((s) => s.grp !== 'energy' && s.vals?.em != null).map((s) => ({ value: s.id, label: `${s.space} · ${s.vals.em} lx (${s.category})` }))]}
          />
          <Row gap={8} wrap>
            <NumberField label="Target average" suffix="lx" value={f.target} onChange={(v) => set({ target: v, count: null })} />
            <NumberField label="Target uniformity Uo" value={f.uo} onChange={(v) => set({ uo: v, count: null })} hint="Empty = no uniformity target" />
          </Row>
          <Select
            label="Surfaces"
            value={f.refl}
            onChange={(v) => {
              const p = REFLECTANCES.find((x) => x.key === v);
              set(p ? { refl: v, rc: p.c, rw: p.w, rf: p.f, count: null } : { refl: v });
            }}
            options={[...REFLECTANCES.map((x) => ({ value: x.key, label: x.label })), { value: 'custom', label: 'My own values' }]}
          />
          {f.refl === 'custom' ? (
            <Row gap={8} wrap>
              <NumberField label="Ceiling (0–1)" value={f.rc} onChange={(v) => set({ rc: v, count: null })} />
              <NumberField label="Walls (0–1)" value={f.rw} onChange={(v) => set({ rw: v, count: null })} />
              <NumberField label="Floor (0–1)" value={f.rf} onChange={(v) => set({ rf: v, count: null })} />
            </Row>
          ) : null}
          <Select
            label="Maintenance"
            value={f.maint}
            onChange={(v) => {
              const m = MAINTENANCE.find((x) => x.key === v);
              set(m ? { maint: v, mf: m.mf, count: null } : { maint: v });
            }}
            options={[...MAINTENANCE.map((x) => ({ value: x.key, label: x.label })), { value: 'custom', label: 'My own factor' }]}
          />
          {f.maint === 'custom' ? <NumberField label="Maintenance factor (0.5–1)" value={f.mf} onChange={(v) => set({ mf: v, count: null })} /> : null}
        </Card>
      </Section>

      <Section title="② Fitting">
        <Card style={{ gap: 4 }}>
          <Select
            label="Type"
            value={f.type}
            onChange={(v) => set({ type: v, count: null })}
            options={FITTING_TYPES.map((t) => ({ value: t.key, label: `${t.label} – ${t.hint}` }))}
          />
          <Field label="Product (from the data sheet)" value={f.fname} onChangeText={(v) => set({ fname: v })} placeholder="e.g. Thorn Omega Pro 600 34 W 4000K" />
          <Row gap={8} wrap>
            <NumberField label="Watts" suffix="W" value={f.watts} onChange={(v) => set({ watts: v })} />
            <NumberField label="Lumens (fitting output)" suffix="lm" value={f.lumens} onChange={(v) => set({ lumens: v, count: null })} />
          </Row>
          {f.watts && f.lumens ? <Muted>{`${Math.round(f.lumens / f.watts)} lm/W`}</Muted> : null}
          <Muted>When Catalogs are ready, pick the product and its IES file is used instead.</Muted>
        </Card>
      </Section>

      <Section title="③ Result">
        {r ? (
          <>
            <Grid min={160} max={4}>
              <Stat label="Fittings" value={String(positions.length)} sub={f.count ? 'set by you' : 'the fewest to reach the target'} />
              <Stat label={`Average lux (target ${target})`} value={`${Math.round(r.em)} lx`} tone={ok(r.em >= target)} sub={`min ${Math.round(r.emin)} · max ${Math.round(r.emax)}`} />
              <Stat label={`Uniformity${f.uo ? ` (target ${f.uo})` : ''}`} value={r.uo.toFixed(2)} tone={f.uo ? ok(r.uo >= f.uo) : undefined} />
              <Stat label={lpdLimit ? `W/m² (SLSEA ${lpdLimit})` : 'W/m²'} value={r.wpm2.toFixed(1)} tone={lpdLimit ? ok(r.wpm2 <= lpdLimit) : undefined} sub={`${(r.watts / 1000).toFixed(2)} kW · ${r.A.toFixed(1)} m² · K ${r.K.toFixed(2)}`} />
            </Grid>
            {!f.count && calc.auto && f.uo && r.uo < f.uo ? <Notice tone={colors.amber}>The uniformity target is not reached with this fitting at this height – try a wider beam or set more fittings below.</Notice> : null}
            <Card style={{ alignItems: 'center', gap: 6 }}>
              <SvgXml xml={plan.xml} width={plan.width} height={plan.height} />
              <Row wrap gap={10} style={{ justifyContent: 'center' }}>
                {LUX_SCALE.map((s) => (
                  <Row key={s.label} gap={4}>
                    <View style={{ width: 12, height: 12, backgroundColor: s.colour, opacity: 0.7 }} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>{s.label}</Text>
                  </Row>
                ))}
              </Row>
              <Muted>Share of the target on the working plane. White dots are the fittings.</Muted>
              <Row gap={8} wrap style={{ justifyContent: 'center' }}>
                <Button small variant="secondary" title="− fitting" onPress={() => set({ count: Math.max(1, positions.length - 1) })} />
                <Button small variant="secondary" title="+ fitting" onPress={() => set({ count: positions.length + 1 })} />
                {f.count ? <Button small variant="ghost" title="Back to the fewest" onPress={() => set({ count: null })} /> : null}
              </Row>
            </Card>
          </>
        ) : (
          <Notice tone={colors.amber}>Complete the room sizes, heights and the fitting lumens to see the result.</Notice>
        )}
      </Section>

      <Section title="④ Savings against the existing lighting">
        <Card style={{ gap: 4 }}>
          <Field label="Existing fittings" value={f.oldDesc} onChangeText={(v) => set({ oldDesc: v })} placeholder="e.g. 2 × 36 W fluorescent with magnetic ballast" />
          <Row gap={8} wrap>
            <NumberField label="Watts each (with gear)" suffix="W" value={f.oldWatts} onChange={(v) => set({ oldWatts: v })} />
            <NumberField label="How many" value={f.oldQty} onChange={(v) => set({ oldQty: v })} />
            <NumberField label="Hours a day" value={f.hours} onChange={(v) => set({ hours: v })} />
            <NumberField label="Days a year" value={f.days} onChange={(v) => set({ days: v })} />
          </Row>
          <Select
            label="Tariff"
            searchable
            value={f.tariff_id ?? ''}
            onChange={(v) => set({ tariff_id: v || null })}
            options={[
              { value: '', label: '— type the client’s rate —' },
              ...data.tariffs.map((t) => ({ value: t.id, label: `${t.supplier} ${t.code} · ${t.name}${t.rate != null ? ` · LKR ${t.rate}/kWh` : ' · rate not set'}` })),
            ]}
          />
          {!tariff || tariff.rate == null ? (
            <NumberField label="Energy rate" suffix="LKR/kWh" value={f.rate} onChange={(v) => set({ rate: v })} hint={tariff ? 'This tariff has no rate yet – type it, or ask SM Projects to set it under Tariffs' : 'From the client’s bill'} />
          ) : (
            <Muted>{`LKR ${tariff.rate}/kWh${tariff.effective_from ? ` from ${tariff.effective_from}` : ''}`}</Muted>
          )}
          <Row gap={8} wrap>
            <NumberField label="Grid CO₂ factor" suffix="kg/kWh" value={f.co2} onChange={(v) => set({ co2: v })} hint="Check the latest SLSEA figure" />
            <NumberField label="Project cost (for payback)" suffix="LKR" value={f.cost} onChange={(v) => set({ cost: v })} />
          </Row>
          {sv ? (
            <Grid min={160} max={4}>
              <Stat label="Energy saved a year" value={`${fmtNumber(sv.kwh, 0)} kWh`} tone="green" sub={sv.pct != null ? `${sv.pct.toFixed(0)}% less` : undefined} />
              <Stat label="Money saved a year" value={sv.lkr != null ? fmtMoney(sv.lkr, 'LKR') : '—'} tone="green" sub={sv.lkr == null ? 'Set the rate' : undefined} />
              <Stat label="CO₂ avoided a year" value={sv.co2t != null ? `${sv.co2t.toFixed(1)} t` : '—'} />
              <Stat label="Payback" value={sv.paybackMonths != null ? `${sv.paybackMonths.toFixed(0)} months` : '—'} sub={sv.paybackMonths == null ? 'Enter the project cost' : undefined} />
            </Grid>
          ) : (
            <Muted>Enter the existing fittings to see the savings.</Muted>
          )}
        </Card>
      </Section>

      <Row gap={8} wrap>
        <Button title={savedId ? 'Save changes' : 'Save'} onPress={save} />
        <Button variant="secondary" title="Share with the client (DRAFT)" onPress={share} />
        <Button variant="secondary" title="Make inquiry" onPress={makeInquiry} />
      </Row>
    </Screen>
  );
}
