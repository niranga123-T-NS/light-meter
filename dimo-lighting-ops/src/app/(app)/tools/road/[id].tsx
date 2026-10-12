import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useDialog } from '@/components/dialog';
import { ProjectPicker } from '@/components/pickers';
import { IesPicker, type IesRow } from '@/components/tools/IesPicker';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Notice, NumberField, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { legendSvg, PALETTES, roadPlanSvg, roadSheetHtml, type Palette, type Scale } from '@/lib/calcSheet';
import { printHtml } from '@/lib/export';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { cached, useLoad } from '@/lib/hooks';
import { MAINTENANCE, savings } from '@/lib/lightcalc';
import { beamAngle, iesPhotometry, parseIes, polarSvg } from '@/lib/photometry';
import { ARRANGEMENTS, checkClass, maxSpacing, roadCalc, roadModel, SURFACES, type RoadArrangement, type RoadClass, type RoadInput, type Surface } from '@/lib/roadcalc';
import { ROLE_SHORT } from '@/lib/roles';
import type { Standard } from '@/lib/standards';
import { supabase } from '@/lib/supabase';

type Form = {
  kind: 'road';
  title: string;
  project_id: string | null;
  cls_id: string | null; // carriageway class (Standards, EN 13201-2)
  foot_cls_id: string | null; // footpath class (P)
  width: number | null;
  lanes: number | null;
  surface: Surface;
  footL: number | null;
  footR: number | null;
  arrangement: RoadArrangement;
  spacing: number | null;
  height: number | null;
  overhang: number | null;
  setback: number | null;
  tilt: number | null;
  streetSide: 'C90' | 'C270';
  dist: 'ies' | 'model';
  ies_id: string | null;
  fname: string;
  watts: number | null;
  lumens: number | null;
  maint: string;
  mf: number | null;
  palette: Palette;
  scaleMode: 'auto' | 'custom';
  scaleMin: number | null;
  scaleMax: number | null;
  oldWatts: number | null;
  lengthKm: number | null;
  hours: number | null;
  rate: number | null;
  co2: number | null;
  cost: number | null;
};
const BLANK: Form = {
  kind: 'road',
  title: '',
  project_id: null,
  cls_id: null,
  foot_cls_id: null,
  width: 7,
  lanes: 2,
  surface: 'R3',
  footL: 2,
  footR: 2,
  arrangement: 'single_left',
  spacing: 30,
  height: 10,
  overhang: 1,
  setback: 0.5,
  tilt: 5,
  streetSide: 'C90',
  dist: 'ies',
  ies_id: null,
  fname: '',
  watts: 100,
  lumens: 13000,
  maint: 'normal',
  mf: 0.8,
  palette: 'rainbow',
  scaleMode: 'auto',
  scaleMin: null,
  scaleMax: null,
  oldWatts: null,
  lengthKm: 1,
  hours: 12,
  rate: null,
  co2: 0.6,
  cost: null,
};
const clsOf = (s: Standard | null | undefined): RoadClass | null =>
  s?.vals?.cls ? { cls: String(s.vals.cls), val: Number(s.vals.val), uo: s.vals.uo != null ? Number(s.vals.uo) : null, ul: s.vals.ul != null ? Number(s.vals.ul) : null, ti: s.vals.ti != null ? Number(s.vals.ti) : null, rei: s.vals.rei != null ? Number(s.vals.rei) : null, emin: s.vals.emin != null ? Number(s.vals.emin) : null } : null;

/** DLux Road: street lighting to EN 13201 – the road, poles and luminaire, the result against the class, and a DRAFT sheet */
export default function RoadCalc() {
  const { id, std } = useLocalSearchParams<{ id: string; std?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const { width: screenW } = useWindowDimensions();
  const isNew = id === 'new';
  const [form, setForm] = useState<Form | null>(null);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : id);
  const { data, error } = useLoad(async () => {
    const [stds, calc] = await Promise.all([
      cached('road_classes', async () => {
        const { data: s, error: e } = await supabase.from('lighting_standards').select('*').eq('active', true).eq('grp', 'road').order('sort');
        if (e) throw new Error(e.message);
        return (s ?? []) as Standard[];
      }),
      isNew ? Promise.resolve(null) : supabase.from('quick_calcs').select('*').eq('id', id).single().then((r) => r.data as { id: string; code: string; inputs: Form } | null),
    ]);
    return { stds, calc };
  }, [id]);
  const preset = useMemo<Form | null>(() => {
    if (!data) return null;
    if (data.calc) return { ...BLANK, ...data.calc.inputs };
    const s = std ? data.stds.find((x) => x.id === std) : null;
    if (!s) return BLANK;
    return String(s.vals?.cls ?? '').startsWith('P') ? { ...BLANK, foot_cls_id: s.id, title: s.space } : { ...BLANK, cls_id: s.id, title: s.space };
  }, [data, std]);
  const f = form ?? preset;
  const iesId = f?.dist === 'ies' ? f.ies_id : null;
  const { data: ies, error: iesError } = useLoad(async () => {
    if (!iesId) return null;
    const { data: row, error: e } = await supabase.from('ies_files').select('id, name, manufacturer, content').eq('id', iesId).single();
    if (e) throw new Error(e.message);
    const d = parseIes(row.content as string);
    const ph = iesPhotometry(d);
    return { id: row.id as string, name: row.name as string, manufacturer: row.manufacturer as string | null, d, ph, polar: polarSvg(ph, 200), beam: beamAngle(ph) };
  }, [iesId]);
  const photo = ies && ies.id === iesId ? ies.ph : null;

  const calc = useMemo(() => {
    if (!f) return null;
    const road: RoadInput = {
      width: f.width ?? 0,
      lanes: f.lanes ?? 1,
      surface: f.surface,
      footL: f.footL ?? 0,
      footR: f.footR ?? 0,
      arrangement: f.arrangement,
      spacing: f.spacing ?? 0,
      height: f.height ?? 0,
      overhang: f.overhang ?? 0,
      setback: f.setback ?? 0,
      tilt: f.tilt ?? 0,
      streetSide: f.streetSide,
    };
    const lm = f.lumens ?? 0;
    const ph = f.dist === 'ies' ? photo : lm > 0 ? roadModel(lm) : null;
    const mf = f.mf ?? 0.8;
    const res = ph ? roadCalc(road, ph, lm, f.watts ?? 0, mf) : null;
    return { road, ph, mf, res };
  }, [f, photo]);

  if (!data || !f || !calc) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const set = (p: Partial<Form>) => setForm({ ...f, ...p });
  const { res, road } = calc;
  const clsRow = data.stds.find((x) => x.id === f.cls_id) ?? null;
  const footRow = data.stds.find((x) => x.id === f.foot_cls_id) ?? null;
  const cls = clsOf(clsRow);
  const footCls = clsOf(footRow);
  const check = res ? checkClass(res, cls) : null;
  const m = cls?.cls.startsWith('M');
  const canLibrary = ['design_manager', 'lighting_designer', 'lighting_engineer', 'sm_projects', 'gm', 'sys_admin'].includes(me.role);
  const scale: Scale = { mode: f.scaleMode, min: f.scaleMin, max: f.scaleMax, palette: f.palette };
  const planW = Math.max(Math.min(screenW - 64, 820), 300);
  const plan = res ? roadPlanSvg(road, res, scale, planW) : null;
  const legend = plan ? legendSvg(plan.range, scale.palette, Math.min(planW - 20, 420)) : null;
  const photoLabel = f.dist === 'ies' && ies ? `IES file: ${ies.name}${ies.manufacturer ? ` (${ies.manufacturer})` : ''}` : 'Typical road optic (approximate – use the IES file for the real result)';
  const ok = (b: boolean | undefined) => (b == null ? undefined : b ? 'green' : 'amber') as 'green' | 'amber' | undefined;
  const perKm = res ? (res.perField * 1000) / road.spacing : 0;
  const km = f.lengthKm ?? 1;
  const sv = res && f.oldWatts ? savings({ oldWatts: f.oldWatts * perKm * km, newWatts: (f.watts ?? 0) * perKm * km, hoursPerDay: f.hours ?? 12, daysPerYear: 365, rate: f.rate, co2: f.co2, cost: f.cost }) : null;

  const findSpacing = () => {
    if (!calc.ph || !cls) return dialog.toast('Choose the lighting class and the luminaire first', 'error');
    const s = maxSpacing(road, calc.ph, f.lumens ?? 0, f.watts ?? 0, calc.mf, cls);
    if (s == null) return dialog.toast(`Class ${cls.cls} is not reached at any spacing with this luminaire and height`, 'error');
    set({ spacing: s });
    dialog.toast(`Largest spacing for ${cls.cls}: ${s} m`);
  };
  const results = () =>
    res
      ? { kind: 'road', em: res.carriage.eav, emin: res.carriage.emin, uo: res.carriage.uo, lav: res.lav, ti: res.ti, eir: res.eir, cls: cls?.cls ?? null, ok: check?.ok ?? null, wattsPerKm: res.wattsPerKm, spacing: road.spacing, brief: brief() }
      : null;
  const brief = () =>
    res
      ? [
          `Road: ${road.width} m carriageway, ${road.lanes} lane(s), ${road.surface}${road.footL || road.footR ? `, footpaths ${road.footL || 0} / ${road.footR || 0} m` : ''}${cls ? `; class ${cls.cls}` : ''}${footCls ? `, footpaths ${footCls.cls}` : ''}.`,
          `Poles: ${ARRANGEMENTS.find((x) => x.value === road.arrangement)?.label}, ${road.spacing} m apart, ${road.height} m high, overhang ${road.overhang} m, tilt ${road.tilt}°.`,
          `Indicative: ${f.fname || 'luminaire'} ${f.watts} W / ${f.lumens} lm → ${res.carriage.eav.toFixed(1)} lx average, Uo ${res.carriage.uo.toFixed(2)}${m ? `, about ${res.lav.toFixed(2)} cd/m²` : ''}, TI ${res.ti?.toFixed(0) ?? '—'}%, ${(res.wattsPerKm / 1000).toFixed(2)} kW/km.`,
        ].join('\n')
      : '';
  const save = () =>
    dialog.run(async () => {
      if (!f.title.trim()) throw new Error('Give the calculation a name, e.g. the road or the client');
      const r = results();
      if (!r) throw new Error('Complete the road, poles and luminaire first');
      const row = { title: f.title.trim(), project_id: f.project_id, inputs: f, results: r, updated_at: new Date().toISOString() };
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
      if (!res) throw new Error('Complete the road, poles and luminaire first');
      await printHtml(
        roadSheetHtml({
          code: data.calc?.code ?? null,
          title: f.title.trim() || 'Road lighting calculation',
          road,
          res,
          cls,
          footCls,
          scale,
          fitting: f.fname || 'Luminaire',
          photoLabel,
          polar: f.dist === 'ies' && ies ? polarSvg(ies.ph, 150) : null,
          lumens: f.lumens ?? 0,
          watts: f.watts ?? 0,
          mf: calc.mf,
          by: `${me.full_name} – ${ROLE_SHORT[me.role]}`,
        }),
        { key: 'quick_calc', filters: f.title || 'Road lighting', title: `DLux road lighting – ${f.title || 'road'}` },
      );
    });
  const makeInquiry = () => {
    if (!savedId) return dialog.toast('Save the calculation first', 'error');
    if (!f.project_id) return dialog.toast('Choose the project (section ①) – the inquiry is made on it', 'error');
    router.push(`/inquiries/new?project=${f.project_id}&calc=${savedId}`);
  };

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: data.calc?.code ? `DLux Road · ${data.calc.code}` : 'DLux Road' }} />
      <Notice tone={colors.blue}>Road lighting to EN 13201 – indicative. Illuminance, the edge ratio and glare (TI) are calculated on the standard grids; the road luminance is estimated. Shared marked DRAFT; the final design is by DIMO Lighting Design.</Notice>

      <Section title="① Road">
        <Card style={{ gap: 4 }}>
          <Field label="Name" required value={f.title} onChangeText={(v) => set({ title: v })} placeholder="e.g. Kandy Road – Kadawatha section" />
          <ProjectPicker value={f.project_id} onChange={(p) => set({ project_id: p?.id ?? null })} label="Project (optional – needed to make an inquiry)" />
          <Select
            label="Lighting class – carriageway (EN 13201-2)"
            searchable
            value={f.cls_id ?? ''}
            onChange={(v) => set({ cls_id: v || null })}
            options={[{ value: '', label: '— no class: show the figures only —' }, ...data.stds.filter((s) => !String(s.vals?.cls).startsWith('P')).map((s) => ({ value: s.id, label: `${s.vals.cls} · ${s.vals.val} ${String(s.vals.cls).startsWith('M') ? 'cd/m²' : 'lx'} – ${s.category.split(' – ')[0]}` }))]}
          />
          <Row gap={8} wrap>
            <NumberField label="Carriageway width" suffix="m" value={f.width} onChange={(v) => set({ width: v })} />
            <NumberField label="Lanes" value={f.lanes} onChange={(v) => set({ lanes: v })} />
            <NumberField label="Left footpath" suffix="m" value={f.footL} onChange={(v) => set({ footL: v })} hint="0 = none" />
            <NumberField label="Right footpath" suffix="m" value={f.footR} onChange={(v) => set({ footR: v })} hint="0 = none" />
          </Row>
          <Select label="Road surface" value={f.surface} onChange={(v) => set({ surface: v as Surface })} options={SURFACES.map((s) => ({ value: s.value, label: `${s.label} (q0 ${s.q0})` }))} />
          {(f.footL ?? 0) > 0 || (f.footR ?? 0) > 0 ? (
            <Select
              label="Footpath class (P)"
              value={f.foot_cls_id ?? ''}
              onChange={(v) => set({ foot_cls_id: v || null })}
              options={[{ value: '', label: '— none —' }, ...data.stds.filter((s) => String(s.vals?.cls).startsWith('P')).map((s) => ({ value: s.id, label: `${s.vals.cls} · ${s.vals.val} lx average, ${s.vals.emin} lx minimum` }))]}
            />
          ) : null}
        </Card>
      </Section>

      <Section title="② Poles and luminaire">
        <Card style={{ gap: 4 }}>
          <Segmented value={f.arrangement} onChange={(v) => set({ arrangement: v })} options={ARRANGEMENTS} />
          <Row gap={8} wrap>
            <NumberField label="Pole spacing" suffix="m" value={f.spacing} onChange={(v) => set({ spacing: v })} hint={f.arrangement === 'staggered' ? 'Between poles on the same side' : undefined} />
            <NumberField label="Mounting height" suffix="m" value={f.height} onChange={(v) => set({ height: v })} />
            <NumberField label="Overhang" suffix="m" value={f.overhang} onChange={(v) => set({ overhang: v })} hint="Luminaire beyond the pole, over the road" />
            <NumberField label="Pole setback" suffix="m" value={f.setback} onChange={(v) => set({ setback: v })} hint="Behind the kerb" />
            <NumberField label="Tilt" suffix="°" value={f.tilt} onChange={(v) => set({ tilt: v })} hint="0–15°, raised towards the road" />
          </Row>
          {cls ? <Button small variant="secondary" title={`Find the largest spacing for ${cls.cls}`} onPress={findSpacing} /> : null}
          <Segmented
            value={f.dist}
            onChange={(v) => set({ dist: v })}
            options={[
              { value: 'ies', label: 'IES file' },
              { value: 'model', label: 'Typical road optic (approximate)' },
            ]}
          />
          {f.dist === 'ies' ? (
            <>
              <IesPicker
                value={f.ies_id}
                canLibrary={canLibrary}
                onChange={(row: IesRow | null) => set(row ? { ies_id: row.id, fname: row.name, lumens: row.lumens != null ? Math.round(row.lumens) : f.lumens, watts: row.watts ?? f.watts } : { ies_id: null })}
              />
              {iesError ? <ErrorBanner message={iesError} /> : null}
              {ies && ies.id === f.ies_id ? (
                <Row gap={12} wrap style={{ alignItems: 'center' }}>
                  <SvgXml xml={ies.polar} width={200} height={200} />
                  <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
                    <Text style={{ fontWeight: '600', color: colors.ink }}>{ies.name}</Text>
                    <Muted>{`${ies.manufacturer ? `${ies.manufacturer} · ` : ''}${ies.d.lumens} lm${ies.d.watts ? ` · ${ies.d.watts} W` : ''}`}</Muted>
                    <Segmented
                      value={f.streetSide}
                      onChange={(v) => set({ streetSide: v })}
                      options={[
                        { value: 'C90', label: 'Road side C90' },
                        { value: 'C270', label: 'Road side C270' },
                      ]}
                    />
                    <Muted>Most road luminaire files throw the light to the road at C90; switch if the result shows the light on the houses.</Muted>
                  </View>
                </Row>
              ) : !f.ies_id ? (
                <Notice tone={colors.amber}>Choose the luminaire’s IES file, or browse and attach it.</Notice>
              ) : (
                <Muted>Reading the IES file…</Muted>
              )}
            </>
          ) : (
            <Notice tone={colors.amber}>A typical road optic is assumed – a first idea only. The luminaire’s IES file gives the real result.</Notice>
          )}
          <Field label="Luminaire (from the data sheet)" value={f.fname} onChangeText={(v) => set({ fname: v })} placeholder="e.g. Philips Luma gen2 100 W" />
          <Row gap={8} wrap>
            <NumberField label="Watts" suffix="W" value={f.watts} onChange={(v) => set({ watts: v })} />
            <NumberField label="Lumens" suffix="lm" value={f.lumens} onChange={(v) => set({ lumens: v })} hint={f.dist === 'ies' ? 'Scales the IES curve' : undefined} />
          </Row>
          <Select
            label="Maintenance"
            value={f.maint}
            onChange={(v) => {
              const mm = MAINTENANCE.find((x) => x.key === v);
              set(mm ? { maint: v, mf: mm.mf } : { maint: v });
            }}
            options={[...MAINTENANCE.map((x) => ({ value: x.key, label: x.label })), { value: 'custom', label: 'My own factor' }]}
          />
          {f.maint === 'custom' ? <NumberField label="Maintenance factor" value={f.mf} onChange={(v) => set({ mf: v })} /> : null}
        </Card>
      </Section>

      <Section title="③ Result">
        {res && plan && legend ? (
          <>
            {cls ? <Notice tone={check?.ok ? colors.green : colors.amber}>{check?.ok ? `Class ${cls.cls} is met${m ? ' (luminance estimated)' : ''}.` : `Class ${cls.cls} is not met – see the figures in amber. Try a shorter spacing, a higher mounting height or another luminaire.`}</Notice> : null}
            <Grid min={160} max={4}>
              <Stat label={cls && !m ? `Average (class ${cls.val} lx)` : 'Average illuminance'} value={`${res.carriage.eav.toFixed(1)} lx`} tone={cls && !m ? ok(check?.avgOk) : undefined} sub={`min ${res.carriage.emin.toFixed(1)} · max ${res.carriage.emax.toFixed(1)}`} />
              <Stat label={cls && !m && cls.uo != null ? `Uniformity Uo (min ${cls.uo})` : 'Uniformity Uo (illuminance)'} value={res.carriage.uo.toFixed(2)} tone={cls && !m && cls.uo != null ? ok(check?.uoOk) : undefined} sub={`Ud ${res.carriage.ud.toFixed(2)}`} />
              <Stat label={m ? `Luminance (class ${cls?.val} cd/m²)` : 'Luminance (estimate)'} value={`${res.lav.toFixed(2)} cd/m²`} tone={m ? ok(check?.avgOk) : undefined} sub="estimated from the illuminance" />
              <Stat label={m && cls?.ti != null ? `Glare TI (max ${cls.ti}%)` : 'Glare TI'} value={res.ti != null ? `${res.ti.toFixed(1)} %` : '—'} tone={m && cls?.ti != null ? ok(check?.tiOk) : undefined} />
              <Stat label={m && cls?.rei != null ? `Edge ratio EIR (min ${cls.rei})` : 'Edge ratio EIR'} value={res.eir != null ? res.eir.toFixed(2) : '—'} tone={m && cls?.rei != null ? ok(check?.eirOk) : undefined} />
              <Stat label="Load" value={`${(res.wattsPerKm / 1000).toFixed(2)} kW/km`} sub={`${perKm.toFixed(1)} luminaires per km · DP ${res.dp?.toFixed(3) ?? '—'} W/(lx·m²)`} />
              {res.footpaths.map((fp) => {
                const fc = footCls ? checkClass(res, footCls, fp) : null;
                return <Stat key={fp.name} label={`${fp.name}${footCls ? ` (${footCls.cls}: ${footCls.val} / ${footCls.emin} lx)` : ''}`} value={`${fp.eav.toFixed(1)} lx`} tone={fc ? ok(fc.ok) : undefined} sub={`min ${fp.emin.toFixed(1)} lx`} />;
              })}
            </Grid>
            <Card style={{ alignItems: 'center', gap: 6 }}>
              <SvgXml xml={plan.xml} width={plan.width} height={plan.height} />
              <SvgXml xml={legend.xml} width={legend.width} height={legend.height} />
              <Muted>{`Horizontal illuminance, ${plan.range.min}–${plan.range.max} lx. The dashed red box is the EN 13201-3 calculation field.`}</Muted>
              <Row gap={8} wrap style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                <Segmented value={f.scaleMode} onChange={(v) => set({ scaleMode: v, scaleMin: f.scaleMin ?? plan.range.min, scaleMax: f.scaleMax ?? plan.range.max })} options={[{ value: 'auto', label: 'Scale: min–max' }, { value: 'custom', label: 'My own scale' }]} />
                {f.scaleMode === 'custom' ? (
                  <>
                    <NumberField label="From" suffix="lx" value={f.scaleMin} onChange={(v) => set({ scaleMin: v })} />
                    <NumberField label="To" suffix="lx" value={f.scaleMax} onChange={(v) => set({ scaleMax: v })} />
                  </>
                ) : null}
                <Select label="Colours" value={f.palette} onChange={(v) => set({ palette: v as Palette })} options={PALETTES} />
              </Row>
            </Card>
            {m ? <Muted>Luminance uniformity (Uo, Ul) needs the road surface’s r-table and is checked by the Design team.</Muted> : null}
          </>
        ) : (
          <Notice tone={colors.amber}>{f.dist === 'ies' && !photo ? 'Choose the luminaire’s IES file to see the result.' : 'Complete the road width, pole spacing, height and the lumens to see the result.'}</Notice>
        )}
      </Section>

      <Section title="④ Savings against the existing street lights">
        <Card style={{ gap: 4 }}>
          <Row gap={8} wrap>
            <NumberField label="Existing lamp (with gear)" suffix="W" value={f.oldWatts} onChange={(v) => set({ oldWatts: v })} hint="e.g. 150 W HPS ≈ 170 W" />
            <NumberField label="Road length" suffix="km" value={f.lengthKm} onChange={(v) => set({ lengthKm: v })} />
            <NumberField label="Hours a night" value={f.hours} onChange={(v) => set({ hours: v })} />
            <NumberField label="Energy rate" suffix="LKR/kWh" value={f.rate} onChange={(v) => set({ rate: v })} />
            <NumberField label="Project cost" suffix="LKR" value={f.cost} onChange={(v) => set({ cost: v })} />
          </Row>
          {sv ? (
            <Grid min={160} max={4}>
              <Stat label="Energy saved a year" value={`${fmtNumber(sv.kwh, 0)} kWh`} tone="green" sub={sv.pct != null ? `${sv.pct.toFixed(0)}% less` : undefined} />
              <Stat label="Money saved a year" value={sv.lkr != null ? fmtMoney(sv.lkr, 'LKR') : '—'} tone="green" sub={sv.lkr == null ? 'Set the rate' : undefined} />
              <Stat label="CO₂ avoided a year" value={sv.co2t != null ? `${sv.co2t.toFixed(1)} t` : '—'} />
              <Stat label="Payback" value={sv.paybackMonths != null ? `${sv.paybackMonths.toFixed(0)} months` : '—'} />
            </Grid>
          ) : (
            <Muted>Enter the existing lamp watts (same poles) to see the savings over the road length.</Muted>
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
