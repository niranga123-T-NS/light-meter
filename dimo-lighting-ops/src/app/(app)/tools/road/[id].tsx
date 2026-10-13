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
import { ARRANGEMENTS, checkClass, geometry, maxSpacing, roadCalc, roadModel, SURFACES, type RoadArrangement, type RoadClass, type RoadInput, type Surface } from '@/lib/roadcalc';
import type { Luminaire } from '@/lib/catalog';
import { ROLE_SHORT } from '@/lib/roles';
import { isTou, LIGHTS_ON, tariffLabel, tariffRate, tariffSummary, type LightsOn, type Tariff } from '@/lib/tariffs';
import type { Standard } from '@/lib/standards';
import { supabase } from '@/lib/supabase';

type Form = {
  kind: 'road';
  title: string;
  project_id: string | null;
  cls_id: string | null; // carriageway class (Standards, EN 13201-2)
  foot_cls_id: string | null; // footpath class (P)
  layout: 'single' | 'dual';
  width: number | null;
  lanes: number | null;
  median: number | null;
  width2: number | null;
  lanes2: number | null;
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
  tariff_id: string | null;
  lightsOn: LightsOn;
  co2: number | null;
  cost: number | null;
};
const BLANK: Form = {
  kind: 'road',
  title: '',
  project_id: null,
  cls_id: null,
  foot_cls_id: null,
  layout: 'single',
  width: 7,
  lanes: 2,
  median: 3,
  width2: null,
  lanes2: null,
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
  dist: 'model',
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
  tariff_id: null,
  lightsOn: 'night',
  co2: 0.6,
  cost: null,
};
const clsOf = (s: Standard | null | undefined): RoadClass | null =>
  s?.vals?.cls ? { cls: String(s.vals.cls), val: Number(s.vals.val), uo: s.vals.uo != null ? Number(s.vals.uo) : null, ul: s.vals.ul != null ? Number(s.vals.ul) : null, ti: s.vals.ti != null ? Number(s.vals.ti) : null, rei: s.vals.rei != null ? Number(s.vals.rei) : null, emin: s.vals.emin != null ? Number(s.vals.emin) : null } : null;

/** DLux Road: street lighting to EN 13201 – the road, poles and luminaire, the result against the class, and a DRAFT sheet */
export default function RoadCalc() {
  const { id, std, lum } = useLocalSearchParams<{ id: string; std?: string; lum?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const { width: screenW } = useWindowDimensions();
  const isNew = id === 'new';
  const [form, setForm] = useState<Form | null>(null);
  const [savedId, setSavedId] = useState<string | null>(isNew ? null : id);
  const { data, error } = useLoad(async () => {
    const [stds, tariffs, calc] = await Promise.all([
      cached('road_classes', async () => {
        const { data: s, error: e } = await supabase.from('lighting_standards').select('*').eq('active', true).eq('grp', 'road').order('sort');
        if (e) throw new Error(e.message);
        return (s ?? []) as Standard[];
      }),
      cached('road_tariffs', async () => {
        const { data: t } = await supabase.from('electricity_tariffs').select('id, supplier, code, name, family, rate, peak, day, off_peak, fixed, demand, note, effective_from').eq('active', true).order('sort');
        return (t ?? []) as Tariff[];
      }),
      isNew ? Promise.resolve(null) : supabase.from('quick_calcs').select('*').eq('id', id).single().then((r) => r.data as { id: string; code: string; inputs: Form } | null),
    ]);
    const fromLum = isNew && lum ? ((await supabase.from('luminaires').select('*').eq('id', lum).maybeSingle()).data as Luminaire | null) : null;
    return { stds, tariffs, calc, fromLum };
  }, [id, lum]);
  const preset = useMemo<Form | null>(() => {
    if (!data) return null;
    if (data.calc) return { ...BLANK, ...data.calc.inputs };
    const l = data.fromLum;
    if (l) return { ...BLANK, fname: l.name, watts: l.watts, lumens: l.lumens, dist: l.ies_id ? 'ies' : 'model', ies_id: l.ies_id };
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
      layout: f.layout ?? 'single',
      median: f.median ?? 0,
      width2: f.width2 ?? undefined,
      lanes2: f.lanes2 ?? undefined,
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
    // no IES file chosen yet: the typical road optic, so the simulation is always shown
    const ph = f.dist === 'ies' && f.ies_id ? photo : lm > 0 ? roadModel(lm) : null;
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
  const checks = res ? res.carriages.map((a) => checkClass(res, cls, a)) : [];
  const check = checks.length && cls ? { ok: checks.every((c) => c?.ok), avgOk: checks.every((c) => c?.avgOk), uoOk: checks.every((c) => c?.uoOk), tiOk: checks.every((c) => c?.tiOk), eirOk: checks.every((c) => c?.eirOk) } : null;
  const dual = (f.layout ?? 'single') === 'dual';
  const geo = geometry(road);
  const m = cls?.cls.startsWith('M');
  const canLibrary = ['design_manager', 'lighting_designer', 'lighting_engineer', 'sm_projects', 'gm', 'sys_admin'].includes(me.role);
  const scale: Scale = { mode: f.scaleMode, min: f.scaleMin, max: f.scaleMax, palette: f.palette };
  const planW = Math.max(Math.min(screenW - 64, 820), 300);
  const plan = res ? roadPlanSvg(road, res, scale, planW) : null;
  const legend = plan ? legendSvg(plan.range, scale.palette, Math.min(planW - 20, 420)) : null;
  const photoLabel = f.dist === 'ies' && ies && ies.id === f.ies_id ? `IES file: ${ies.name}${ies.manufacturer ? ` (${ies.manufacturer})` : ''}` : 'Typical road optic (approximate – use the IES file for the real result)';
  const ok = (b: boolean | undefined) => (b == null ? undefined : b ? 'green' : 'amber') as 'green' | 'amber' | undefined;
  const perKm = res ? (res.perField * 1000) / road.spacing : 0;
  const km = f.lengthKm ?? 1;
  const tariff = data.tariffs.find((t) => t.id === f.tariff_id) ?? null;
  const rate = tariffRate(tariff, f.lightsOn ?? 'night') ?? f.rate;
  const sv = res && f.oldWatts ? savings({ oldWatts: f.oldWatts * perKm * km, newWatts: (f.watts ?? 0) * perKm * km, hoursPerDay: f.hours ?? 12, daysPerYear: 365, rate, co2: f.co2, cost: f.cost }) : null;

  const findSpacing = () => {
    if (!calc.ph || !cls) return dialog.toast('Choose the lighting class and the luminaire first', 'error');
    const s = maxSpacing(road, calc.ph, f.lumens ?? 0, f.watts ?? 0, calc.mf, cls);
    if (s == null) return dialog.toast(`Class ${cls.cls} is not reached at any spacing with this luminaire and height`, 'error');
    set({ spacing: s });
    dialog.toast(`Largest spacing for ${cls.cls}: ${s} m`);
  };
  const results = () =>
    res
      ? { kind: 'road', layout: road.layout, em: res.carriage.eav, emin: res.carriage.emin, uo: res.carriage.uo, lav: res.lav, ti: res.ti, eir: res.eir, cls: cls?.cls ?? null, ok: check?.ok ?? null, wattsPerKm: res.wattsPerKm, spacing: road.spacing, brief: brief() }
      : null;
  const brief = () =>
    res
      ? [
          `Road: ${dual ? `dual carriageway ${road.width} + ${road.width2 || road.width} m with a ${road.median} m median` : `${road.width} m carriageway`}, ${road.lanes} lane(s), ${road.surface}${road.footL || road.footR ? `, footpaths ${road.footL || 0} / ${road.footR || 0} m` : ''}${cls ? `; class ${cls.cls}` : ''}${footCls ? `, footpaths ${footCls.cls}` : ''}.`,
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
          <Segmented
            value={f.layout ?? 'single'}
            onChange={(v) => set({ layout: v, arrangement: v === 'dual' && f.arrangement === 'single_left' ? 'central' : f.arrangement })}
            options={[
              { value: 'single', label: 'Single carriageway' },
              { value: 'dual', label: 'Dual carriageway with central median' },
            ]}
          />
          <Row gap={8} wrap>
            <NumberField label={dual ? 'Left carriageway width' : 'Carriageway width'} suffix="m" value={f.width} onChange={(v) => set({ width: v })} hint="Kerb to kerb" />
            <NumberField label={dual ? 'Lanes (left)' : 'Lanes'} value={f.lanes} onChange={(v) => set({ lanes: v })} />
            {dual ? (
              <>
                <NumberField label="Central median width" suffix="m" value={f.median} onChange={(v) => set({ median: v })} hint="Kerb to kerb" />
                <NumberField label="Right carriageway width" suffix="m" value={f.width2} onChange={(v) => set({ width2: v })} hint={`Empty = same as the left (${f.width ?? '—'} m)`} />
                <NumberField label="Lanes (right)" value={f.lanes2} onChange={(v) => set({ lanes2: v })} hint={`Empty = ${f.lanes ?? '—'}`} />
              </>
            ) : null}
          </Row>
          <Row gap={8} wrap>
            <NumberField label="Left footpath" suffix="m" value={f.footL} onChange={(v) => set({ footL: v })} hint="0 = none" />
            <NumberField label="Right footpath" suffix="m" value={f.footR} onChange={(v) => set({ footR: v })} hint="0 = none" />
          </Row>
          <Muted>{`Cross-section: ${f.footL ? `${f.footL} m footpath · ` : ''}${geo.carriages.map((c) => `${(c.y1 - c.y0).toFixed(1)} m road (${c.lanes} lanes)`).join(geo.median ? ` · ${(geo.median.y1 - geo.median.y0).toFixed(1)} m median · ` : '')}${f.footR ? ` · ${f.footR} m footpath` : ''} = ${(geo.total + (f.footL ?? 0) + (f.footR ?? 0)).toFixed(1)} m`}</Muted>
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
          <Select label="Pole arrangement" value={f.arrangement} onChange={(v) => set({ arrangement: v as RoadArrangement })} options={ARRANGEMENTS.map((x) => ({ value: x.value, label: x.label }))} />
          <Row gap={8} wrap>
            <NumberField label="Pole spacing" suffix="m" value={f.spacing} onChange={(v) => set({ spacing: v })} hint={f.arrangement === 'staggered' ? 'Between poles on the same side' : undefined} />
            <NumberField label="Mounting height" suffix="m" value={f.height} onChange={(v) => set({ height: v })} />
            <NumberField label="Overhang" suffix="m" value={f.overhang} onChange={(v) => set({ overhang: v })} hint={f.arrangement.startsWith('central') ? 'Arm length from the median pole' : 'Luminaire beyond the pole, over the road'} />
            {f.arrangement !== 'central' ? <NumberField label="Pole setback" suffix="m" value={f.setback} onChange={(v) => set({ setback: v })} hint="Side poles, behind the kerb" /> : null}
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
                <Notice tone={colors.amber}>No IES file chosen – the result below uses a typical road optic until you choose or attach the luminaire’s IES file.</Notice>
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
              {res.carriages.map((a, i) => (
                <Stat
                  key={a.name}
                  label={`${dual ? a.name : 'Average illuminance'}${cls && !m ? ` (class ${cls.val} lx)` : ''}`}
                  value={`${a.eav.toFixed(1)} lx`}
                  tone={cls && !m ? ok(checks[i]?.avgOk && checks[i]?.uoOk) : undefined}
                  sub={`min ${a.emin.toFixed(1)} · max ${a.emax.toFixed(1)} · Uo ${a.uo.toFixed(2)}${cls && !m && cls.uo != null ? ` (min ${cls.uo})` : ''}`}
                />
              ))}
              {res.carriages.map((a, i) => (
                <Stat key={`L${a.name}`} label={`${dual ? `Luminance – ${a.name.split(' (')[0]}` : 'Luminance'}${m ? ` (class ${cls?.val} cd/m²)` : ' (estimate)'}`} value={`${(a.eav * res.q0).toFixed(2)} cd/m²`} tone={m ? ok(checks[i]?.avgOk) : undefined} sub="estimated from the illuminance" />
              ))}
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
          <Notice tone={colors.amber}>{f.dist === 'ies' && f.ies_id && !photo ? 'Reading the IES file…' : 'Complete the road width, pole spacing, height and the lumens to see the result.'}</Notice>
        )}
      </Section>

      <Section title="④ Savings against the existing street lights">
        <Card style={{ gap: 4 }}>
          <Row gap={8} wrap>
            <NumberField label="Existing lamp (with gear)" suffix="W" value={f.oldWatts} onChange={(v) => set({ oldWatts: v })} hint="e.g. 150 W HPS ≈ 170 W" />
            <NumberField label="Road length" suffix="km" value={f.lengthKm} onChange={(v) => set({ lengthKm: v })} />
            <NumberField label="Hours a night" value={f.hours} onChange={(v) => set({ hours: v })} />
            <NumberField label="Project cost" suffix="LKR" value={f.cost} onChange={(v) => set({ cost: v })} />
          </Row>
          <Select
            label="Tariff"
            searchable
            value={f.tariff_id ?? ''}
            onChange={(v) => set({ tariff_id: v || null })}
            options={[{ value: '', label: '— type the rate —' }, ...data.tariffs.map((t) => ({ value: t.id, label: tariffLabel(t) }))]}
          />
          {tariff && isTou(tariff) ? <Segmented value={f.lightsOn ?? 'night'} onChange={(v) => set({ lightsOn: v })} options={LIGHTS_ON} /> : null}
          {!tariff || tariffRate(tariff, f.lightsOn) == null ? (
            <NumberField label="Energy rate" suffix="LKR/kWh" value={f.rate} onChange={(v) => set({ rate: v })} hint="Street lighting (SL) is LKR 60/kWh from 11 May 2026" />
          ) : (
            <Muted>{`LKR ${rate}/kWh for the saved energy${isTou(tariff) ? ` (${tariffSummary(tariff)})` : ''}${tariff.effective_from ? ` · from ${tariff.effective_from}` : ''}`}</Muted>
          )}
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
