import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useDialog } from '@/components/dialog';
import { ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Notice, NumberField, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { IesPicker, type IesRow } from '@/components/tools/IesPicker';
import { PlanDraw } from '@/components/tools/PlanDraw';
import { Room3D } from '@/components/tools/Room3D';
import { calcSheetHtml, legendSvg, PALETTES, planSvg, reflectanceOf, SURFACE_COLOURS, type Palette, type Scale, type Surfaces } from '@/lib/calcSheet';
import { printHtml } from '@/lib/export';
import { fmtMoney, fmtNumber } from '@/lib/format';
import { cached, useLoad } from '@/lib/hooks';
import { autoLayout, calculate, fieldLayout, FITTING_TYPES, inside, mountAt, MAINTENANCE, outline, REFLECTANCES, ROOFS, savings, SHAPES, suggestCount, type Lum, type Pt, type Roof, type RoomInput, type Shape } from '@/lib/lightcalc';
import { beamAngle, iesPhotometry, parseIes, polarSvg } from '@/lib/photometry';
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
  closed: boolean; // the drawn plan is closed
  height: number | null; // wall height (the ceiling for a flat roof)
  roof: Roof;
  rise: number | null;
  ridge: 'auto' | 'x' | 'y';
  hang: boolean; // fittings hung below a pitched roof
  drop: number | null;
  cCol: string;
  wCol: string;
  fCol: string;
  dist: 'model' | 'ies';
  ies_id: string | null;
  rot: number;
  layout: 'auto' | 'field' | 'manual';
  fnx: number | null; // field: fittings along the length
  fny: number | null; // field: fittings across
  fsx: number | null; // spacing along (empty = spread evenly)
  fsy: number | null;
  fox: number | null; // first fitting from the left wall (empty = centred)
  foy: number | null; // from the bottom wall
  lights: { x: number; y: number; z: number | null; rot: number | null }[];
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
  lumL: number | null; // lit area for glare, mm – empty = typical for the type
  lumW: number | null;
  ugrSheet: number | null; // UGR from the data sheet's table, if given
  ugrLimit: number | null;
  scaleMode: 'auto' | 'custom';
  scaleMin: number | null;
  scaleMax: number | null;
  palette: Palette;
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
  closed: true,
  height: 2.8,
  roof: 'flat',
  rise: 2,
  ridge: 'auto',
  hang: false,
  drop: 1,
  cCol: '#F5F5F2',
  wCol: '#ECE7DA',
  fCol: '#A7A39A',
  dist: 'model',
  ies_id: null,
  rot: 0,
  layout: 'auto',
  fnx: 4,
  fny: 3,
  fsx: null,
  fsy: null,
  fox: null,
  foy: null,
  lights: [],
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
  lumL: null,
  lumW: null,
  ugrSheet: null,
  ugrLimit: 19,
  scaleMode: 'auto',
  scaleMin: null,
  scaleMax: null,
  palette: 'rainbow',
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

/** DLux lighting calculation: ① room ② fitting ③ result ④ savings – a DRAFT sheet for the client, saved and turned into an inquiry */
export default function QuickCalc() {
  const { id, std } = useLocalSearchParams<{ id: string; std?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const { width: screenW } = useWindowDimensions();
  const isNew = id === 'new';
  const [form, setForm] = useState<Form | null>(null);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [tool, setTool] = useState<'add' | 'move' | 'delete'>('add');
  const [snapM, setSnapM] = useState<'0.05' | '0.1' | '0.5'>('0.1');
  const [sel, setSel] = useState<number | null>(null);
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

  // the form: a saved calculation, a space chosen in Standards ("Use in DLux"), or the defaults
  const preset = useMemo<Form | null>(() => {
    if (!data) return null;
    if (data.calc) return { ...BLANK, ...data.calc.inputs };
    const s = std ? data.stds.find((x) => x.id === std) : null;
    return s ? { ...BLANK, std_id: s.id, title: s.space, target: Number(s.vals?.em) || BLANK.target, uo: s.vals?.uo != null ? Number(s.vals.uo) : null, ugrLimit: s.vals?.ugr != null ? Number(s.vals.ugr) : null } : BLANK;
  }, [data, std]);
  const f = form ?? preset;
  // the IES file chosen: read and turned into the light distribution
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
    const room: RoomInput = {
      shape: f.shape,
      length: f.length ?? 0,
      width: f.width ?? 0,
      cutL: f.cutL ?? undefined,
      cutW: f.cutW ?? undefined,
      points: f.shape === 'free' && f.closed !== false ? parsePoints(f.points) : undefined,
      height: f.height ?? 0,
      roof: f.roof ?? 'flat',
      rise: f.rise ?? 0,
      ridge: f.ridge && f.ridge !== 'auto' ? f.ridge : undefined,
      drop: f.hang ? (f.drop ?? 0) : null,
      mount: f.mount ?? f.height ?? 0,
      plane: f.plane ?? 0,
      rc: f.rc ?? 0.7,
      rw: f.rw ?? 0.5,
      rf: f.rf ?? 0.2,
    };
    const fit = { type: f.type, watts: f.watts ?? 0, lumens: f.lumens ?? 0, name: f.fname, lumL: f.lumL, lumW: f.lumW, rot: f.rot ?? 0, photo: f.dist === 'ies' ? photo : null };
    const mf = f.mf ?? 0.8;
    const poly = outline(room);
    if ((!room.drop && !(room.mount - room.plane > 0)) || !(fit.lumens > 0) || poly.length < 3 || (f.dist === 'ies' && !photo)) return { room, fit, mf, poly, positions: [] as Pt[], r: null, auto: null };
    const layout = f.layout ?? 'auto';
    const auto = layout !== 'auto' || f.count ? null : suggestCount(room, fit, mf, f.target ?? 300, f.uo);
    const positions: Lum[] =
      layout === 'manual'
        ? (f.lights ?? [])
        : layout === 'field'
          ? fieldLayout(poly, { nx: f.fnx ?? 0, ny: f.fny ?? 0, sx: f.fsx, sy: f.fsy, ox: f.fox, oy: f.foy })
          : f.count
            ? autoLayout(poly, f.count, room)
            : (auto?.positions ?? []);
    return { room, fit, mf, poly, positions, r: calculate(room, fit, positions, mf), auto };
  }, [f, photo]);

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
  const scale: Scale = { mode: f.scaleMode ?? 'auto', min: f.scaleMin, max: f.scaleMax, palette: f.palette ?? 'rainbow' };
  const layout = f.layout ?? 'auto';
  const plan = planSvg(calc.poly, positions, r, scale, Math.max(planW, 280), { numbers: layout === 'manual' });
  const placePlan = planSvg(calc.poly, positions, r, scale, Math.max(planW, 280), { numbers: true, selected: sel });
  const mzAt = mountAt(calc.room, calc.poly);
  const fieldBox = calc.poly.length >= 3 ? { L: Math.max(...calc.poly.map((p) => p.x)) - Math.min(...calc.poly.map((p) => p.x)), W: Math.max(...calc.poly.map((p) => p.y)) - Math.min(...calc.poly.map((p) => p.y)) } : { L: 0, W: 0 };
  const fieldSx = f.fsx ?? (f.fnx ? fieldBox.L / f.fnx : 0);
  const fieldSy = f.fsy ?? (f.fny ? fieldBox.W / f.fny : 0);
  const fieldOut = layout === 'field' ? Math.max(0, (f.fnx ?? 0) * (f.fny ?? 0) - positions.length) : 0;
  const arrangement =
    layout === 'manual'
      ? 'placed light by light'
      : layout === 'field'
        ? `field ${f.fnx} × ${f.fny}, spacing ${fieldSx.toFixed(2)} × ${fieldSy.toFixed(2)} m${fieldOut ? ` (${fieldOut} outside the room left out)` : ''}`
        : f.count
          ? 'automatic, number set by you'
          : 'automatic, the fewest to reach the target';
  const lights = (f.lights ?? []) as Form['lights'];
  const setLights = (next: Form['lights']) => set({ lights: next });
  const toLights = (pts: Lum[]) => pts.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: p.z ?? null, rot: p.rot ?? null }));
  const tapPlan = (px: number, py: number) => {
    const m = placePlan.toRoom(px, py);
    const st = Number(snapM);
    const q = { x: Math.round(Math.round(m.x / st) * st * 1000) / 1000, y: Math.round(Math.round(m.y / st) * st * 1000) / 1000 };
    const reach = Math.max(0.4, 16 / placePlan.pxPerM);
    let near: number | null = null;
    let best = Infinity;
    lights.forEach((l, i) => {
      const d = Math.hypot(l.x - m.x, l.y - m.y);
      if (d < reach && d < best) [near, best] = [i, d];
    });
    if (tool === 'delete') {
      if (near != null) {
        setLights(lights.filter((_, i) => i !== near));
        setSel(null);
      }
      return;
    }
    if (near != null && (tool === 'add' || near !== sel)) return setSel(near);
    if (!inside(q, calc.poly)) return dialog.toast('That point is outside the room', 'error');
    if (tool === 'add') {
      setLights([...lights, { x: q.x, y: q.y, z: null, rot: null }]);
      setSel(lights.length);
    } else if (sel != null) setLights(lights.map((l, i) => (i === sel ? { ...l, x: q.x, y: q.y } : l)));
  };
  const legend = legendSvg(plan.range, scale.palette, Math.min(Math.max(planW, 280) - 20, 420));
  const ftype = FITTING_TYPES.find((t) => t.key === f.type);
  const lit = { lumL: f.lumL ?? (photo?.lenMm || ftype?.size[0] || 600), lumW: f.lumW ?? (photo?.widMm || ftype?.size[1] || 600), rot: f.rot ?? 0 };
  const surfaces: Surfaces = { ceiling: f.cCol ?? '#F5F5F2', walls: f.wCol ?? '#ECE7DA', floor: f.fCol ?? '#A7A39A' };
  const canLibrary = ['design_manager', 'lighting_designer', 'lighting_engineer', 'sm_projects', 'gm', 'sys_admin'].includes(me.role);
  const photoLabel = f.dist === 'ies' && ies ? `IES file: ${ies.name}${ies.manufacturer ? ` (${ies.manufacturer})` : ''} · ${ies.beam}° beam` : `Modelled curve – ${ftype?.label ?? f.type}`;
  const roofLabel = ROOFS.find((x) => x.value === (f.roof ?? 'flat'))?.label ?? 'Flat ceiling';
  const shapeText = f.shape === 'free' ? 'drawn plan' : f.shape === 'rect' ? `${f.length} × ${f.width} m` : f.shape === 'circle' ? `circle ${f.length} m across` : `${SHAPES.find((x) => x.value === f.shape)?.label} ${f.length} × ${f.width} m`;
  const ugr = f.ugrSheet ?? r?.ugr.max ?? null;
  const ugrText = ugr == null ? '—' : ugr < 10 ? '< 10' : ugr.toFixed(1);

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
      `Room: ${r?.A.toFixed(1)} m² (${shapeText}), ${roofLabel.toLowerCase()}${(f.roof ?? 'flat') !== 'flat' ? ` ${f.rise} m rise, walls ${f.height} m` : `, ceiling ${f.height} m`}, fittings ${f.hang && (f.roof ?? 'flat') !== 'flat' ? `${f.drop} m below the roof` : `at ${f.mount} m`}, working plane ${f.plane} m.`,
      `Target: ${f.target} lx${f.uo ? `, Uo ${f.uo}` : ''}${stdRow ? ` – ${stdRow.space} (${stdGroup?.source ?? ''})` : ''}.`,
      `Indicative (${f.dist === 'ies' ? 'IES file' : 'modelled curve'}): ${positions.length} × ${f.fname || ftype?.label} ${f.watts} W / ${f.lumens} lm (${arrangement}) → ${Math.round(r?.em ?? 0)} lx average, Uo ${r?.uo.toFixed(2)}, Ud ${r?.ud.toFixed(2)}, UGR ${ugrText}, ${r?.wpm2.toFixed(1)} W/m².`,
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
        results: { em: r.em, emin: r.emin, emax: r.emax, uo: r.uo, ud: r.ud, ugr, count: positions.length, watts: r.watts, wpm2: r.wpm2, area: r.A, savings: sv, brief: brief() },
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
          scale,
          ugrLimit: f.ugrLimit,
          ugrSheet: f.ugrSheet,
          surfaces,
          photoLabel,
          polar: f.dist === 'ies' && ies ? ies.polar : null,
          arrangement,
          listLights: layout === 'manual',
          savings: savingLines() ? { lines: savingLines() as [string, string][] } : null,
          by: `${me.full_name} – ${ROLE_SHORT[me.role]}`,
        }),
        { key: 'quick_calc', filters: f.title || 'DLux calculation', title: `DLux lighting calculation – ${f.title || 'room'}` },
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
      <Stack.Screen options={{ title: data.calc?.code ? `DLux · ${data.calc.code}` : 'DLux' }} />
      <Notice tone={colors.blue}>DLux – indicative lighting calculation from the fitting’s IES file or a curve modelled on its type. Results are shared marked DRAFT; the final design is by DIMO Lighting Design.</Notice>

      <Section title="① Room">
        <Card style={{ gap: 4 }}>
          <Field label="Name" required value={f.title} onChangeText={(v) => set({ title: v })} placeholder="e.g. ABC Hotels – conference hall" />
          <ProjectPicker value={f.project_id} onChange={(p) => set({ project_id: p?.id ?? null })} label="Project (optional – needed to make an inquiry)" />
          <Segmented
            value={f.shape === 'free' ? 'draw' : 'shape'}
            onChange={(v) => {
              if (v === 'draw' && f.shape !== 'free') {
                // start the drawing from the shape chosen (Clear to start afresh)
                const seed = f.shape === 'circle' ? [] : (calc.poly ?? []);
                set({ shape: 'free', points: seed.map((p) => `${+p.x.toFixed(2)},${+p.y.toFixed(2)}`).join('; '), closed: seed.length >= 3, count: null });
              } else if (v === 'shape' && f.shape === 'free') set({ shape: 'rect', count: null });
            }}
            options={[
              { value: 'draw', label: '✎ Draw the plan' },
              { value: 'shape', label: 'Fixed shape' },
            ]}
          />
          {f.shape === 'free' ? (
            <>
              <PlanDraw
                points={parsePoints(f.points)}
                closed={f.closed !== false}
                width={Math.min(planW, 560)}
                onChange={(pts, closed) => set({ points: pts.map((p) => `${p.x},${p.y}`).join('; '), closed, count: null })}
              />
              <Field
                label="Corners (x,y in metres) – or type them"
                multiline
                value={f.points}
                onChangeText={(v) => set({ points: v, closed: true, count: null })}
                hint="e.g. 0,0; 12,0; 12,5; 7,5; 7,8; 0,8 – walk round the room from one corner"
              />
            </>
          ) : (
            <>
              <Segmented value={f.shape as Exclude<Shape, 'free'>} onChange={(v) => set({ shape: v, count: null })} options={SHAPES} />
              <Row gap={8} wrap>
                <NumberField label={f.shape === 'circle' ? 'Diameter' : 'Length'} suffix="m" value={f.length} onChange={(v) => set({ length: v, count: null })} />
                {f.shape !== 'circle' ? <NumberField label="Width" suffix="m" value={f.width} onChange={(v) => set({ width: v, count: null })} /> : null}
                {f.shape === 'l' || f.shape === 't' || f.shape === 'u' ? (
                  <>
                    <NumberField label={{ l: 'Cut-out length', t: 'Stem width', u: 'Opening width' }[f.shape]} suffix="m" value={f.cutL} onChange={(v) => set({ cutL: v, count: null })} />
                    <NumberField label={{ l: 'Cut-out width', t: 'Top bar depth', u: 'Opening depth' }[f.shape]} suffix="m" value={f.cutW} onChange={(v) => set({ cutW: v, count: null })} />
                  </>
                ) : null}
              </Row>
            </>
          )}
          <Select
            label="Roof"
            value={f.roof ?? 'flat'}
            onChange={(v) => set({ roof: v as Roof, count: null })}
            options={ROOFS.map((x) => ({ value: x.value, label: `${x.label} – ${x.hint}` }))}
          />
          <Row gap={8} wrap>
            <NumberField
              label={(f.roof ?? 'flat') === 'flat' ? 'Ceiling height' : 'Wall height (eaves)'}
              suffix="m"
              value={f.height}
              onChange={(v) => set({ height: v, mount: f.mount === f.height ? v : f.mount, count: null })}
              hint="The plan is extruded to this height"
            />
            {(f.roof ?? 'flat') !== 'flat' ? (
              <>
                <NumberField label={f.roof === 'sawtooth' ? 'Tooth height' : f.roof === 'barrel' ? 'Vault rise' : 'Roof rise (to the top)'} suffix="m" value={f.rise} onChange={(v) => set({ rise: v, count: null })} />
                <Select
                  label={f.roof === 'mono' ? 'Slope rises across' : f.roof === 'sawtooth' ? 'Teeth run along' : 'Ridge runs along'}
                  value={f.ridge ?? 'auto'}
                  onChange={(v) => set({ ridge: v as Form['ridge'], count: null })}
                  options={[
                    { value: 'auto', label: 'The longer side' },
                    { value: 'x', label: 'The length (x)' },
                    { value: 'y', label: 'The width (y)' },
                  ]}
                />
              </>
            ) : null}
          </Row>
          <Row gap={8} wrap>
            <NumberField label="Working plane" suffix="m" value={f.plane} onChange={(v) => set({ plane: v, count: null })} hint="0.8 desks · 0 floors" />
          </Row>
          <Select
            label="Space (target from Standards)"
            searchable
            value={f.std_id ?? ''}
            onChange={(v) => {
              const s = data.stds.find((x) => x.id === v);
              set({ std_id: v || null, target: s ? Number(s.vals?.em) || f.target : f.target, uo: s?.vals?.uo != null ? Number(s.vals.uo) : f.uo, ugrLimit: s?.vals?.ugr != null ? Number(s.vals.ugr) : f.ugrLimit, count: null });
            }}
            options={[{ value: '', label: '— my own target —' }, ...data.stds.filter((s) => s.grp !== 'energy' && s.vals?.em != null).map((s) => ({ value: s.id, label: `${s.space} · ${s.vals.em} lx (${s.category})` }))]}
          />
          <Row gap={8} wrap>
            <NumberField label="Target average" suffix="lx" value={f.target} onChange={(v) => set({ target: v, count: null })} />
            <NumberField label="Target uniformity Uo" value={f.uo} onChange={(v) => set({ uo: v, count: null })} hint="Empty = no uniformity target" />
            <NumberField label="Glare limit UGR" value={f.ugrLimit} onChange={(v) => set({ ugrLimit: v })} hint="From the standard – empty = none" />
          </Row>
          <Text style={{ fontWeight: '600', color: colors.ink, marginTop: 6 }}>Surfaces – colour and reflectance</Text>
          <Row gap={6} wrap>
            {REFLECTANCES.map((x) => (
              <Button key={x.key} small variant="ghost" title={x.label.split(' (')[0]} onPress={() => set({ rc: x.c, rw: x.w, rf: x.f, count: null })} />
            ))}
          </Row>
          <SurfaceRow label="Ceiling / roof" colour={surfaces.ceiling} value={f.rc} onColour={(c) => set({ cCol: c, rc: reflectanceOf(c) ?? f.rc, count: null })} onValue={(v) => set({ rc: v, count: null })} />
          <SurfaceRow label="Walls" colour={surfaces.walls} value={f.rw} onColour={(c) => set({ wCol: c, rw: reflectanceOf(c) ?? f.rw, count: null })} onValue={(v) => set({ rw: v, count: null })} />
          <SurfaceRow label="Floor" colour={surfaces.floor} value={f.rf} onColour={(c) => set({ fCol: c, rf: reflectanceOf(c) ?? f.rf, count: null })} onValue={(v) => set({ rf: v, count: null })} />
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
          <Segmented
            value={f.dist ?? 'model'}
            onChange={(v) => set({ dist: v, count: null })}
            options={[
              { value: 'ies', label: 'IES file' },
              { value: 'model', label: 'Model by type (no IES)' },
            ]}
          />
          {f.dist === 'ies' ? (
            <>
              <IesPicker
                value={f.ies_id}
                canLibrary={canLibrary}
                onChange={(row: IesRow | null) =>
                  set(row ? { ies_id: row.id, fname: row.name, lumens: row.lumens != null ? Math.round(row.lumens) : f.lumens, watts: row.watts ?? f.watts, lumL: null, lumW: null, count: null } : { ies_id: null, count: null })
                }
              />
              {iesError ? <ErrorBanner message={iesError} /> : null}
              {f.ies_id && ies && ies.id === f.ies_id ? (
                <Row gap={12} wrap style={{ alignItems: 'center' }}>
                  <SvgXml xml={ies.polar} width={200} height={200} />
                  <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
                    <Text style={{ fontWeight: '600', color: colors.ink }}>{ies.name}</Text>
                    <Muted>{`${ies.manufacturer ? `${ies.manufacturer} · ` : ''}${ies.d.lumens} lm in the file${ies.d.watts ? ` · ${ies.d.watts} W` : ''} · ${ies.beam}° beam · ${Math.round(ies.ph.up * 100)}% up`}</Muted>
                    <Muted>{`Lit area ${Math.round(ies.d.lenMm)} × ${Math.round(ies.d.widMm)} mm`}</Muted>
                    <Muted>Red: along the fitting (C0–C180) · blue: across (C90–C270). Lumens typed below scale the curve.</Muted>
                  </View>
                </Row>
              ) : f.ies_id ? (
                <Muted>Reading the IES file…</Muted>
              ) : (
                <Notice tone={colors.amber}>Choose an IES file from the uploaded files, or browse and attach one.</Notice>
              )}
            </>
          ) : null}
          <Select
            label={f.dist === 'ies' ? 'Type (for the name and default size)' : 'Type'}
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
          <Row gap={8} wrap>
            <NumberField label="Lit area length" suffix="mm" value={f.lumL} onChange={(v) => set({ lumL: v })} hint={`Empty = ${ftype?.size[0] ?? 600} mm (typical)`} />
            <NumberField label="Lit area width" suffix="mm" value={f.lumW} onChange={(v) => set({ lumW: v })} hint={`Empty = ${ftype?.size[1] ?? 600} mm`} />
            <NumberField label="UGR from the data sheet" value={f.ugrSheet} onChange={(v) => set({ ugrSheet: v })} hint="If given – used instead of the estimate" />
          </Row>
          <Segmented
            value={String(f.rot ?? 0)}
            onChange={(v) => set({ rot: Number(v), count: null })}
            options={[
              { value: '0', label: 'Fittings along the length' },
              { value: '90', label: 'Turned 90°' },
            ]}
          />
        </Card>
      </Section>

      <Section title="③ Mounting and arrangement">
        <Card style={{ gap: 6 }}>
          {(f.roof ?? 'flat') !== 'flat' ? (
            <Segmented
              value={f.hang ? 'hang' : 'fixed'}
              onChange={(v) => set({ hang: v === 'hang', count: null })}
              options={[
                { value: 'fixed', label: 'Fittings at one height' },
                { value: 'hang', label: 'Fittings hung below the roof' },
              ]}
            />
          ) : null}
          <Row gap={8} wrap>
            {f.hang && (f.roof ?? 'flat') !== 'flat' ? (
              <NumberField label="Hung below the roof" suffix="m" value={f.drop} onChange={(v) => set({ drop: v, count: null })} hint="Follows the roof slope" />
            ) : (
              <NumberField label="Mounting height (above the floor)" suffix="m" value={f.mount} onChange={(v) => set({ mount: v, count: null })} hint="Same as the ceiling for recessed" />
            )}
          </Row>
          <Segmented
            value={layout}
            onChange={(v) => {
              setSel(null);
              // light by light starts from what is on the plan now
              if (v === 'manual' && !lights.length) set({ layout: v, lights: toLights(positions) });
              else if (v === 'field' && layout !== 'field' && positions.length) {
                const nx = new Set(positions.map((p) => p.x.toFixed(2))).size;
                const ny = new Set(positions.map((p) => p.y.toFixed(2))).size;
                set({ layout: v, fnx: Math.min(nx, 40), fny: Math.min(ny, 40) });
              } else set({ layout: v });
            }}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'field', label: 'Field (rows × columns)' },
              { value: 'manual', label: 'Light by light' },
            ]}
          />
          {layout === 'auto' ? (
            <>
              <Muted>{f.count ? `${positions.length} fittings set by you, spread evenly.` : 'The fewest fittings that reach the target, spread evenly.'}</Muted>
              <Row gap={8} wrap>
                <Button small variant="secondary" title="− fitting" onPress={() => set({ count: Math.max(1, positions.length - 1) })} />
                <Button small variant="secondary" title="+ fitting" onPress={() => set({ count: positions.length + 1 })} />
                {f.count ? <Button small variant="ghost" title="Back to the fewest" onPress={() => set({ count: null })} /> : null}
              </Row>
            </>
          ) : null}
          {layout === 'field' ? (
            <>
              <Row gap={8} wrap>
                <NumberField label="Along the length (columns)" value={f.fnx} onChange={(v) => set({ fnx: v })} />
                <NumberField label="Across (rows)" value={f.fny} onChange={(v) => set({ fny: v })} />
                <NumberField label="Spacing along" suffix="m" value={f.fsx} onChange={(v) => set({ fsx: v })} hint={`Empty = spread evenly (${fieldSx ? fieldSx.toFixed(2) : '—'} m)`} />
                <NumberField label="Spacing across" suffix="m" value={f.fsy} onChange={(v) => set({ fsy: v })} hint={`Empty = spread evenly (${fieldSy ? fieldSy.toFixed(2) : '—'} m)`} />
              </Row>
              <Row gap={8} wrap>
                <NumberField label="First fitting from the left wall" suffix="m" value={f.fox} onChange={(v) => set({ fox: v })} hint="Empty = field centred" />
                <NumberField label="First fitting from the bottom wall" suffix="m" value={f.foy} onChange={(v) => set({ foy: v })} hint="Empty = field centred" />
              </Row>
              <Muted>{`${positions.length} fittings · ${arrangement}`}</Muted>
            </>
          ) : null}
          {layout !== 'manual' && positions.length ? <Button small variant="ghost" title="Edit these light by light →" onPress={() => { setSel(null); set({ layout: 'manual', lights: toLights(positions) }); }} /> : null}
          {layout === 'manual' ? (
            <>
              <Row gap={8} wrap style={{ justifyContent: 'center' }}>
                <Segmented value={tool} onChange={setTool} options={[{ value: 'add', label: '+ Add' }, { value: 'move', label: '✥ Move' }, { value: 'delete', label: '✕ Delete' }]} />
                <Segmented value={snapM} onChange={setSnapM} options={[{ value: '0.05', label: 'Snap 5 cm' }, { value: '0.1', label: '10 cm' }, { value: '0.5', label: '50 cm' }]} />
              </Row>
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: placePlan.width, height: placePlan.height }}>
                  <SvgXml xml={placePlan.xml} width={placePlan.width} height={placePlan.height} />
                  <View
                    style={{ position: 'absolute', left: 0, top: 0, width: placePlan.width, height: placePlan.height, cursor: 'crosshair' } as object}
                    onStartShouldSetResponder={() => true}
                    onResponderRelease={(e) => tapPlan(e.nativeEvent.locationX, e.nativeEvent.locationY)}
                  />
                </View>
                <Muted>
                  {tool === 'add'
                    ? 'Tap the plan to place a fitting; tap a fitting to pick it.'
                    : tool === 'move'
                      ? sel != null
                        ? `Fitting ${sel + 1} picked – tap where it goes, or tap another fitting.`
                        : 'Tap a fitting to pick it, then tap where it goes.'
                      : 'Tap a fitting to delete it.'}
                </Muted>
              </View>
              <Row gap={8} wrap>
                <Button small variant="ghost" title="Start from automatic" onPress={() => { setSel(null); set({ layout: 'auto' }); }} />
                <Button small variant="ghost" title="Clear all" onPress={() => { setSel(null); setLights([]); }} disabled={!lights.length} />
              </Row>
              {lights.map((l, i) => (
                <Pressable key={i} onPress={() => setSel(i)} style={{ borderRadius: 8, padding: 4, backgroundColor: sel === i ? '#FDECEF' : 'transparent' }}>
                  <Row gap={6} wrap style={{ alignItems: 'flex-end' }}>
                    <Text style={{ width: 28, fontWeight: '700', color: colors.ink, paddingBottom: 12 }}>{i + 1}</Text>
                    <NumberField label="x" suffix="m" value={l.x} onChange={(v) => setLights(lights.map((o, k) => (k === i ? { ...o, x: v ?? 0 } : o)))} />
                    <NumberField label="y" suffix="m" value={l.y} onChange={(v) => setLights(lights.map((o, k) => (k === i ? { ...o, y: v ?? 0 } : o)))} />
                    <NumberField label="Height" suffix="m" value={l.z} onChange={(v) => setLights(lights.map((o, k) => (k === i ? { ...o, z: v } : o)))} hint={`Empty = ${mzAt(l).toFixed(2)} m`} />
                    <Segmented value={String(l.rot ?? f.rot ?? 0)} onChange={(v) => setLights(lights.map((o, k) => (k === i ? { ...o, rot: Number(v) } : o)))} options={[{ value: '0', label: '0°' }, { value: '90', label: '90°' }]} />
                    <Button small variant="ghost" title="✕" onPress={() => { setSel(null); setLights(lights.filter((_, k) => k !== i)); }} />
                  </Row>
                </Pressable>
              ))}
              {!lights.length ? <Muted>No fittings yet – tap the plan to place them.</Muted> : null}
            </>
          ) : null}
        </Card>
      </Section>

      <Section title="④ Result">
        {r ? (
          <>
            <Grid min={160} max={4}>
              <Stat label="Fittings" value={String(positions.length)} sub={arrangement} />
              <Stat label={`Average lux (target ${target})`} value={`${Math.round(r.em)} lx`} tone={ok(r.em >= target)} sub={`min ${Math.round(r.emin)} · max ${Math.round(r.emax)}`} />
              <Stat label={`Uniformity Uo${f.uo ? ` (target ${f.uo})` : ''}`} value={r.uo.toFixed(2)} tone={f.uo ? ok(r.uo >= f.uo) : undefined} sub={`Emin / Em · Ud = Emin / Emax ${r.ud.toFixed(2)}`} />
              <Stat label={`Glare UGR${f.ugrLimit != null ? ` (limit ${f.ugrLimit})` : ''}`} value={ugrText} tone={f.ugrLimit != null && ugr != null ? ok(ugr <= f.ugrLimit) : undefined} sub={f.ugrSheet != null ? 'from the data sheet' : 'highest of the observers – indicative'} />
              <Stat label={lpdLimit ? `W/m² (SLSEA ${lpdLimit})` : 'W/m²'} value={r.wpm2.toFixed(1)} tone={lpdLimit ? ok(r.wpm2 <= lpdLimit) : undefined} sub={`${(r.watts / 1000).toFixed(2)} kW · ${r.A.toFixed(1)} m² · K ${r.K.toFixed(2)}`} />
            </Grid>
            {layout === 'auto' && !f.count && calc.auto && f.uo && r.uo < f.uo ? <Notice tone={colors.amber}>The uniformity target is not reached with this fitting at this height – try a wider beam or set more fittings below.</Notice> : null}
            <Card style={{ alignItems: 'center', gap: 6 }}>
              <Segmented value={view} onChange={setView} options={[{ value: 'plan', label: 'Plan with contours' }, { value: '3d', label: '3D view' }]} />
              {view === 'plan' ? (
                <>
                  <SvgXml xml={plan.xml} width={plan.width} height={plan.height} />
                  <Muted>Lines join points of equal light (lux). White dots are the fittings; black marks are the seated observers for glare (UGR).</Muted>
                </>
              ) : (
                <Room3D poly={calc.poly} positions={positions} room={calc.room} r={r} scale={scale} fit={lit} surfaces={surfaces} width={Math.max(planW, 280)} />
              )}
              <SvgXml xml={legend.xml} width={legend.width} height={legend.height} />
              <Muted>{`Illuminance on the working plane, ${plan.range.min}–${plan.range.max} lx`}</Muted>
              <Row gap={8} wrap style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                <Segmented value={f.scaleMode ?? 'auto'} onChange={(v) => set({ scaleMode: v, scaleMin: f.scaleMin ?? plan.range.min, scaleMax: f.scaleMax ?? plan.range.max })} options={[{ value: 'auto', label: 'Scale: room min–max' }, { value: 'custom', label: 'My own scale' }]} />
                {f.scaleMode === 'custom' ? (
                  <>
                    <NumberField label="From" suffix="lx" value={f.scaleMin} onChange={(v) => set({ scaleMin: v })} />
                    <NumberField label="To" suffix="lx" value={f.scaleMax} onChange={(v) => set({ scaleMax: v })} />
                  </>
                ) : null}
                <Select label="Colours" value={f.palette ?? 'rainbow'} onChange={(v) => set({ palette: v as Palette })} options={PALETTES} />
              </Row>
            </Card>
          </>
        ) : (
          <Notice tone={colors.amber}>
            {f.shape === 'free' && f.closed === false
              ? 'Close the drawn plan (tap its first corner) to see the result.'
              : f.dist === 'ies' && !photo
                ? 'Choose the IES file of the fitting to see the result.'
                : (f.layout ?? 'auto') === 'manual' && !(f.lights ?? []).length
                  ? 'Place the fittings on the plan in ③ to see the result.'
                  : 'Complete the room sizes, heights and the fitting lumens to see the result – every fitting must be above the working plane.'}
          </Notice>
        )}
      </Section>

      <Section title="⑤ Savings against the existing lighting">
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

/** A room surface: its colour (from common finishes) and its reflectance – the colour suggests the reflectance */
function SurfaceRow({ label, colour, value, onColour, onValue }: { label: string; colour: string; value: number | null; onColour: (c: string) => void; onValue: (v: number | null) => void }) {
  const name = SURFACE_COLOURS.find((c) => c.hex.toLowerCase() === colour.toLowerCase())?.name ?? colour;
  return (
    <View style={{ gap: 4, paddingVertical: 4 }}>
      <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
        <View style={{ minWidth: 120, gap: 2 }}>
          <Text style={{ fontSize: 13, color: colors.ink, fontWeight: '600' }}>{label}</Text>
          <Muted>{name}</Muted>
        </View>
        <NumberField label="Reflectance (0–1)" value={value} onChange={onValue} />
      </Row>
      <Row gap={6} wrap>
        {SURFACE_COLOURS.map((c) => (
          <Pressable
            key={c.hex}
            accessibilityLabel={`${label}: ${c.name}`}
            onPress={() => onColour(c.hex)}
            style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.hex, borderWidth: c.hex.toLowerCase() === colour.toLowerCase() ? 3 : 1, borderColor: c.hex.toLowerCase() === colour.toLowerCase() ? colors.brand : '#94A3B8' }}
          />
        ))}
      </Row>
    </View>
  );
}
