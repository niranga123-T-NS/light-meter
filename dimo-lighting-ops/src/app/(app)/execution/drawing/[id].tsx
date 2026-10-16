import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { DbSchedule } from '@/components/drawing/DbSchedule';
import { Photos, type DPhoto } from '@/components/drawing/Photos';
import { Stage, type StageLayer } from '@/components/drawing/Stage';
import { XSection } from '@/components/drawing/XSection';
import { DRAWING_EDIT_ROLES, uploadDrawing } from '@/components/exec/DrawingsTab';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, ErrorBanner, Field, KeyValue, Loading, Muted, Notice, Progress, Row, Screen, Section, Segmented, Select, Toggle, useWide } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { applyQueued, cachedDrawing, cacheDrawing, callOrQueue, isNetworkError, useDrawingQueue, type QueuedCall } from '@/lib/drawingQueue';
import {
  CABLE_STEPS,
  cablesIn,
  checksFor,
  CONT_STEPS,
  DISC,
  emptyChecks,
  fillPct,
  fromU,
  installed,
  isCont,
  KINDS,
  kindOf,
  LMS_SYSTEMS,
  lenU,
  PIN_KINDS,
  readingFlags,
  routeMetres,
  routeOf,
  ROUTES,
  runsIn,
  scopeOf,
  signedImage,
  snap,
  STATUS_COLOR,
  stepLabel,
  stepsFor,
  toU,
  type DEvent,
  type DItem,
  type Disc,
  type DPin,
  type Drawing,
  type DRoute,
  type Pt,
  type Riser,
  type Scope,
} from '@/lib/drawings';
import type { ExecProject } from '@/lib/execution';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Sel = { kind: 'item' | 'route' | 'pin'; id: string } | null;
type Mode = null | 'item' | 'row' | 'grid' | 'copy' | 'route' | 'scale' | 'move' | 'select' | 'pin';
type Sheet = Pick<Drawing, 'id' | 'title' | 'sheet_no' | 'floor' | 'level_no' | 'archived' | 'width' | 'height' | 'revision'>;
type Boq = { id: string; item_no: string | null; description: string; unit: string | null; qty: number | null };
type Act = { id: string; code: string; name: string; pct: number; pct_drawing: number | null };
type BoqFig = { boq_item_id: string; qty: number; done: number; items: number };
type DData = {
  d: Drawing;
  items: DItem[];
  routes: DRoute[];
  events: DEvent[];
  acts: Act[];
  boq: Boq[];
  figs: BoqFig[];
  photos: DPhoto[];
  pins: DPin[];
  sheets: Sheet[];
  risers: Riser[];
  project: Pick<ExecProject, 'id' | 'code' | 'name' | 'smart_drawings'> | null;
  uri: string | null;
  offline?: string | null;
};

const UPDATE_ROLES = [...DRAWING_EDIT_ROLES, 'trainee', 'sub_supervisor'];
const DISCS_OF: Record<keyof Scope, Disc[]> = { services: ['light', 'power', 'elv', 'net', 'hvac', 'fiber', 'cont'], lms: ['lms'], bms: ['bms'], outdoor: ['out'] };

/** L1 → L1, L2, L3 …; 'GF/S' → GF/S-1, GF/S-2 … */
function nthLabel(start: string, i: number) {
  const t = start.trim();
  if (!t) return '';
  const m = t.match(/^(.*?)(\d+)$/);
  if (!m) return `${t}-${i + 1}`;
  const n = String(Number(m[2]) + i);
  return m[1] + (m[2].startsWith('0') ? n.padStart(m[2].length, '0') : n);
}

function segDist(x: number, y: number, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

async function fetchDrawing(id: string): Promise<DData> {
  const { data: d, error: e } = await supabase.from('exec_drawings').select('*').eq('id', id).single();
  if (e) throw new Error(e.message);
  const dw = d as Drawing;
  const [it, rt, ev, ac, bq, fig, pj, uri, ph] = await Promise.all([
    supabase.from('exec_drawing_items').select('*').eq('drawing_id', id),
    supabase.from('exec_drawing_routes').select('*').eq('drawing_id', id),
    supabase.from('exec_drawing_events').select('*').eq('drawing_id', id).order('at', { ascending: false }).limit(300),
    supabase.from('exec_activities').select('id, code, name, pct, pct_drawing').eq('exec_project_id', dw.exec_project_id).order('code'),
    supabase.from('exec_boq_items').select('id, item_no, description, unit, qty').eq('exec_project_id', dw.exec_project_id).eq('heading', false).eq('removed', false).order('seq'),
    rpc<BoqFig[]>('drawing_boq', { p_exec: dw.exec_project_id }).catch(() => [] as BoqFig[]),
    supabase.from('exec_projects').select('id, code, name, smart_drawings').eq('id', dw.exec_project_id).maybeSingle(),
    signedImage(dw.image_path).catch(() => null),
    supabase.from('exec_drawing_photos').select('*').eq('drawing_id', id).order('taken_at', { ascending: false }),
  ]);
  const [pins, sh, rs] = await Promise.all([
    rpc<DPin[]>('drawing_pins', { p_drawing: id }).catch(() => [] as DPin[]),
    supabase.from('exec_drawings').select('id, title, sheet_no, floor, level_no, archived, width, height, revision').eq('exec_project_id', dw.exec_project_id).order('level_no').order('title'),
    supabase.from('exec_drawing_risers').select('*').eq('exec_project_id', dw.exec_project_id).order('name'),
  ]);
  if (it.error) throw new Error(it.error.message);
  return {
    d: dw,
    items: (it.data ?? []) as DItem[],
    routes: (rt.data ?? []) as DRoute[],
    events: (ev.data ?? []) as DEvent[],
    acts: (ac.data ?? []) as Act[],
    boq: (bq.data ?? []) as Boq[],
    figs: fig,
    photos: (ph.data ?? []) as DPhoto[],
    pins,
    sheets: (sh.data ?? []) as Sheet[],
    risers: (rs.data ?? []) as Riser[],
    project: pj.data as Pick<ExecProject, 'id' | 'code' | 'name' | 'smart_drawings'> | null,
    uri,
    offline: null,
  };
}
/** One drawing: mark up items and routes, update stages, checks and readings, link to the BOQ and the programme. */
export default function DrawingScreen() {
  const { id, item } = useLocalSearchParams<{ id: string; item?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const wide = useWide();
  const [layer, setLayer] = useState<StageLayer>('progress');
  const [hidden, setHidden] = useState<Disc[]>([]);
  const [sel, setSel] = useState<Sel>(item ? { kind: 'item', id: item } : null);
  const [mode, setMode] = useState<Mode>(null);
  const [addKind, setAddKind] = useState('down');
  const [draft, setDraft] = useState<Pt[] | null>(null);
  const [ortho, setOrtho] = useState(true);
  const [onCont, setOnCont] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [marked, setMarked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState<{ x: number; y: number; n: number } | null>(null);
  const [copySrc, setCopySrc] = useState<DItem | null>(null);
  const [showPins, setShowPins] = useState(true);
  const copies = useRef(0);

  const { data: loaded, error, reload } = useLoad(async (): Promise<DData> => {
    try {
      const v = await fetchDrawing(id);
      void cacheDrawing(id, v);
      return v;
    } catch (e) {
      // no signal on site: open the copy kept on this phone
      if (!isNetworkError(e)) throw e;
      const c = await cachedDrawing<DData>(id);
      if (!c) throw e;
      return { ...c.data, offline: c.at };
    }
  }, [id]);
  const dq = useDrawingQueue(
    useCallback(
      (r: { sent: number; refused: QueuedCall[] }) => {
        void reload();
        if (r.refused.length) dialog.toast(`${r.sent} update(s) sent; ${r.refused.length} refused – ${r.refused[0].error}`, 'error');
        else dialog.toast(`${r.sent} update(s) made without signal are now sent`);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    ),
  );



  if (!loaded) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  // what the site sees includes the updates still waiting on this phone
  const data = applyQueued(loaded, dq.queue.filter((c) => c.drawing === loaded.d.id));
  const { d, items, routes, events, acts, boq, figs } = data;
  // stopped on the project: read-only
  const on = data.project?.smart_drawings === true;
  const canEdit = DRAWING_EDIT_ROLES.includes(me.role) && !d.archived && on;
  const canUpdate = UPDATE_ROLES.includes(me.role) && !d.archived && on;
  const scope: Scope = d.scope ?? { services: true };
  const discs = (Object.keys(DISCS_OF) as (keyof Scope)[]).filter((k) => scope[k]).flatMap((k) => DISCS_OF[k]);
  const show = (x: Disc) => discs.includes(x) && !hidden.includes(x);
  const selItem = sel?.kind === 'item' ? items.find((x) => x.id === sel.id) : undefined;
  const selRoute = sel?.kind === 'route' ? routes.find((x) => x.id === sel.id) : undefined;
  const pins = data.pins ?? [];
  const selPin = sel?.kind === 'pin' ? pins.find((x) => x.id === sel.id) : undefined;
  const toCheck = { items: items.filter((x) => x.to_check), routes: routes.filter((x) => x.to_check) };
  const kindOptions = Object.entries(KINDS)
    .filter(([k]) => scope[scopeOf(k)])
    .map(([k, v]) => ({ value: k, label: `${DISC[v.d].name.split(' (')[0]} – ${v.name}` }));
  const boqName = (b?: Boq) => (b ? `${b.item_no ?? ''} ${b.description}`.trim() : '—');
  const actName = (a?: Act) => (a ? `${a.code} ${a.name}` : '—');

  const run = (fn: () => Promise<unknown>, ok?: string) => dialog.run(async () => {
    await fn();
    await reload();
  }, ok);
  const offline = !!data.offline;
  // stage, check and laid updates: sent now, or kept on the phone until there is signal
  const upd = <T,>(fn: QueuedCall['fn'], args: Record<string, unknown>, ok?: string | ((r: T) => string)) =>
    dialog.run(async () => {
      const r = await callOrQueue<T>(d.id, fn, args);
      if (r.queued) {
        await dq.refresh();
        dialog.toast('No signal – kept on this phone; it is sent when the connection is back');
        return;
      }
      await reload();
      const m = typeof ok === 'function' ? ok(r.result) : ok;
      if (m) dialog.toast(m);
    });
  const visible = items.filter((x) => show(kindOf(x.kind).d));
  const addMany = (list: Record<string, unknown>[], ok: string) =>
    run(() => rpc('drawing_items_add', { p_drawing: d.id, p_items: list.map((x) => ({ checks: emptyChecks(String(x.kind)), ...x })) }), ok);
  const toggleMark = (iid: string) => setMarked((m) => (m.includes(iid) ? m.filter((x) => x !== iid) : [...m, iid]));

  // taps on the sheet
  const onTap = async (p: Pt) => {
    if (mode === 'item') {
      const f = fromU(d, p);
      if (f[0] < 0 || f[0] > 1 || f[1] < 0 || f[1] > 1) return;
      let nid = '';
      await run(async () => {
        nid = await rpc<string>('drawing_item_save', { p: { drawing_id: d.id, kind: addKind, x: f[0], y: f[1], checks: emptyChecks(addKind) } });
      });
      if (nid) setSel({ kind: 'item', id: nid });
      return;
    }
    if (mode === 'copy' && copySrc) {
      const f = fromU(d, p);
      if (f[0] < 0 || f[0] > 1 || f[1] < 0 || f[1] > 1) return;
      copies.current += 1;
      await addMany(
        [{ kind: copySrc.kind, x: f[0], y: f[1], label: copySrc.label ? nthLabel(copySrc.label, copies.current) : null, area: copySrc.area, circuit: copySrc.circuit, boq_item_id: copySrc.boq_item_id, activity_id: copySrc.activity_id }],
        'Copy placed',
      );
      return;
    }
    if (mode === 'row' || mode === 'grid') {
      const pts = [...(draft ?? []), p];
      if (pts.length < 2) return setDraft(pts);
      setDraft(pts);
      const [a, b] = pts;
      const k = kindOf(addKind);
      const r = await dialog.prompt({
        title: mode === 'row' ? `A row of ${k.name}` : `A grid of ${k.name}`,
        message: mode === 'row' ? 'Placed evenly from the first point to the second, both ends included.' : 'Placed evenly over the area between the two corners, the corners included.',
        fields: [
          ...(mode === 'row'
            ? [{ key: 'n', label: 'How many?', required: true, initial: '5' }]
            : [
                { key: 'c', label: 'Across (columns)', required: true, initial: '4' },
                { key: 'r', label: 'Down (rows)', required: true, initial: '3' },
              ]),
          { key: 'label', label: 'First name / tag (numbered on: L1 → L1, L2, L3 …)', initial: '' },
          { key: 'area', label: 'Area / room', initial: '' },
          { key: 'circuit', label: k.d === 'lms' ? (LMS_SYSTEMS[d.lms] ?? LMS_SYSTEMS.KNX).addr : 'Circuit (e.g. GF/L1)', initial: '' },
        ],
      });
      setDraft([]);
      if (!r) return;
      const cols = mode === 'row' ? Math.round(Number(r.n)) : Math.round(Number(r.c)), rows = mode === 'row' ? 1 : Math.round(Number(r.r));
      if (!(cols >= 1 && rows >= 1) || cols * rows > 400) return dialog.toast('Between 1 and 400 items at a time', 'error');
      const at = (i: number, n: number, lo: number, hi: number) => (n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1));
      const list: Record<string, unknown>[] = [];
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const u: Pt = mode === 'row' ? [at(i, cols, a[0], b[0]), at(i, cols, a[1], b[1])] : [at(i, cols, a[0], b[0]), at(j, rows, a[1], b[1])];
          const f = fromU(d, u);
          list.push({ kind: addKind, x: Math.min(1, Math.max(0, f[0])), y: Math.min(1, Math.max(0, f[1])), label: nthLabel(r.label, list.length) || null, area: r.area || null, circuit: r.circuit || null });
        }
      await addMany(list, `${list.length} placed`);
      return;
    }
    if (mode === 'pin') {
      const f = fromU(d, p);
      if (f[0] < 0 || f[0] > 1 || f[1] < 0 || f[1] > 1) return;
      // the nearest item (within a short reach) is the one the issue is about
      let near: DItem | null = null, best = 14;
      for (const x of items) {
        const u = toU(d, [x.x, x.y]);
        const dist = Math.hypot(u[0] - p[0], u[1] - p[1]);
        if (dist < best) [near, best] = [x, dist];
      }
      const kinds = Object.entries(PIN_KINDS).filter(([k]) => (k === 'query' ? me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer' : k === 'snag' ? canEdit : true));
      const r = await dialog.prompt({
        title: 'Pin an issue here',
        message: near ? `About: ${kindOf(near.kind).name}${near.label ? ` ${near.label}` : ''}` : undefined,
        fields: [
          { key: 'kind', label: 'What is it?', type: 'select', required: true, initial: 'clash', options: kinds.map(([value, v]) => ({ value, label: v.name + (value === 'query' ? ' (goes to the design team)' : value === 'snag' ? ' (snag list)' : value === 'hse' ? ' (HSE report)' : '') })) },
          { key: 'title', label: 'The issue in one line', required: true },
          { key: 'detail', label: 'More detail', type: 'multiline' },
          { key: 'blocks', label: 'What it holds up', when: { key: 'kind', in: ['query'] } },
          { key: 'responsible', label: 'Who puts it right', required: true, when: { key: 'kind', in: ['snag'] } },
          { key: 'priority', label: 'Priority', type: 'select', initial: 'normal', options: [{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }], when: { key: 'kind', in: ['snag'] } },
          { key: 'hse_kind', label: 'HSE type', type: 'select', initial: 'unsafe_condition', options: [{ value: 'unsafe_condition', label: 'Unsafe condition' }, { value: 'unsafe_act', label: 'Unsafe act' }, { value: 'near_miss', label: 'Near miss' }, { value: 'incident', label: 'Incident' }], when: { key: 'kind', in: ['hse'] } },
          { key: 'severity', label: 'Severity', type: 'select', initial: 'medium', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }], when: { key: 'kind', in: ['hse'] } },
          { key: 'immediate_action', label: 'Action taken now', when: { key: 'kind', in: ['hse'] } },
        ],
      });
      if (!r) return;
      setMode(null);
      let pid = '';
      await run(async () => {
        pid = await rpc<string>('drawing_pin_add', { p: { drawing_id: d.id, x: f[0], y: f[1], item_id: near?.id ?? null, ...r } });
      }, r.kind === 'query' ? 'Design query raised and pinned' : r.kind === 'snag' ? 'Snag raised and pinned' : r.kind === 'hse' ? 'HSE report raised and pinned' : 'Pinned');
      if (pid) setSel({ kind: 'pin', id: pid });
      return;
    }
    if (mode === 'select') {
      // two taps on the sheet: everything shown inside the box is chosen
      const pts = [...(draft ?? []), p];
      if (pts.length < 2) return setDraft(pts);
      setDraft([]);
      const [a, b] = [fromU(d, pts[0]), fromU(d, pts[1])];
      const inBox = visible.filter((x) => x.x >= Math.min(a[0], b[0]) && x.x <= Math.max(a[0], b[0]) && x.y >= Math.min(a[1], b[1]) && x.y <= Math.max(a[1], b[1])).map((x) => x.id);
      setMarked((m) => [...new Set([...m, ...inBox])]);
      return;
    }
    if (mode === 'move' && selItem) {
      const f = fromU(d, p);
      setMode(null);
      await run(() => rpc('drawing_item_save', { p: { id: selItem.id, x: Math.min(1, Math.max(0, f[0])), y: Math.min(1, Math.max(0, f[1])) } }), 'Moved');
      return;
    }
    if (mode === 'route') {
      const q = snap(d, routes, draft ?? [], p, ortho, onCont);
      const last = draft?.[draft.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) setDraft([...(draft ?? []), q]);
      return;
    }
    if (mode === 'scale') {
      const pts = [...(draft ?? []), p];
      if (pts.length < 2) return setDraft(pts);
      setDraft(pts);
      const r = await dialog.prompt({
        title: 'Set the scale',
        message: 'How far apart are the two points on site? (e.g. a dimensioned wall or grid lines)',
        fields: [{ key: 'm', label: 'Distance in metres', required: true }],
      });
      setDraft(null);
      setMode(null);
      const m = Number(r?.m);
      const du = lenU(pts);
      if (!r || !(m > 0) || !(du > 0)) return;
      await run(() => rpc('drawing_save', { p: { id: d.id, width_m: Math.round(((m * 1000) / du) * 1000) / 1000 } }), 'Scale set – cable and containment lengths are now in metres');
      return;
    }
    // nothing in hand: pick the nearest route
    let best: { r: DRoute; dist: number } | null = null;
    for (const r of routes) {
      if (!show(routeOf(r.kind).d)) continue;
      const pts = r.pts.map((q) => toU(d, q));
      for (let j = 1; j < pts.length; j++) {
        const dist = segDist(p[0], p[1], pts[j - 1], pts[j]);
        if (dist <= Math.max(8, routeOf(r.kind).w / 2 + 3) && (!best || dist < best.dist)) best = { r, dist };
      }
    }
    setSel(best ? { kind: 'route', id: best.r.id } : null);
  };

  const finishRoute = async () => {
    const pts = draft ?? [];
    if (pts.length < 2) return;
    const cableKinds = Object.keys(ROUTES).filter((k) => !isCont(k));
    const r = await dialog.prompt({
      title: 'Save the route',
      fields: [
        {
          key: 'kind',
          label: 'What is it?',
          type: 'select',
          required: true,
          options: Object.entries(ROUTES)
            .filter(([k, v]) => v.d === 'cont' || (v.d === 'lms' ? scope.lms : v.d === 'bms' ? scope.bms : scope.services) || isCont(k))
            .map(([k, v]) => ({ value: k, label: `${v.d === 'cont' ? 'Containment' : 'Cable'} – ${v.name}` })),
        },
        { key: 'label', label: 'Description (e.g. GF/L1 lighting circuit, Cat 6 to D-12–D-16)' },
        { key: 'cores', label: 'Number of cables in the run', initial: '1', when: { key: 'kind', in: cableKinds } },
        { key: 'dia', label: 'Outside diameter of one cable (mm)', hint: 'For the containment fill – leave empty for a typical size', when: { key: 'kind', in: cableKinds } },
      ],
    });
    if (!r) return;
    const dia = Number(r.dia);
    let nid = '';
    await run(async () => {
      nid = await rpc<string>('drawing_route_save', {
        p: { drawing_id: d.id, kind: r.kind, pts: pts.map((q) => fromU(d, q)), label: r.label, cores: r.cores || null, area: dia > 0 ? Math.round(((Math.PI * dia * dia) / 4) * 10) / 10 : null },
      });
    }, 'Route saved');
    setDraft(null);
    setMode(null);
    if (nid) setSel({ kind: 'route', id: nid });
  };

  const linkFields = (cur: { boq_item_id: string | null; activity_id: string | null }) => [
    ...(boq.length
      ? [{ key: 'boq', label: 'BOQ line', type: 'select' as const, searchable: true, initial: cur.boq_item_id ?? '', options: [{ value: '', label: '— none' }, ...boq.map((b) => ({ value: b.id, label: boqName(b) }))] }]
      : []),
    { key: 'act', label: 'Programme activity', type: 'select' as const, searchable: true, initial: cur.activity_id ?? '', options: [{ value: '', label: '— none' }, ...acts.map((a) => ({ value: a.id, label: actName(a) }))] },
  ];

  // ---------- panels
  const history = (filter: (e: DEvent) => boolean) => {
    const ev = events.filter(filter).slice(0, 12);
    return ev.length ? (
      <Section title="History">
        {ev.map((e) => (
          <Muted key={e.id}>{`${fmtDateTime(e.at)} · ${people[e.by_id ?? '']?.full_name ?? '—'} · ${e.what}${e.to_status ? `: ${e.from_status ?? ''} → ${e.to_status}` : ''}${e.note ? ` – ${e.note}` : ''}`}</Muted>
        ))}
      </Section>
    ) : null;
  };

  const itemPanel = (it: DItem) => {
    const k = kindOf(it.kind);
    const [CK, RD] = checksFor(it.kind);
    const steps = stepsFor(it.kind, d.lms);
    const done = CK.filter(([c]) => it.checks?.[c]).length;
    return (
      <View style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colors.ink, flexShrink: 1 }}>{`${k.code} · ${it.label || k.name}`}</Text>
          <Button small variant="secondary" title="Close" onPress={() => setSel(null)} />
        </Row>
        <View style={{ gap: 2 }}>
          <KeyValue label="Type" value={`${DISC[k.d].name} – ${k.name}`} />
          {it.area ? <KeyValue label="Area" value={it.area} /> : null}
          {it.circuit ? <KeyValue label={k.d === 'lms' ? (LMS_SYSTEMS[d.lms] ?? LMS_SYSTEMS.KNX).addr : 'Circuit'} value={it.circuit} /> : null}
          {it.serial ? <KeyValue label="Serial" value={it.serial} /> : null}
          <KeyValue label="BOQ line" value={boqName(boq.find((b) => b.id === it.boq_item_id))} />
          <KeyValue label="Activity" value={actName(acts.find((a) => a.id === it.activity_id))} />
          {it.note ? <KeyValue label="Note" value={it.note} /> : null}
        </View>
        {it.to_check ? (
          <Row wrap gap={8} style={{ padding: 8, borderRadius: 8, backgroundColor: '#FFF4E0' }}>
            <Text style={{ color: colors.ink, flexShrink: 1 }}>Copied from another floor – check it is where this floor needs it (move it, remove it, or confirm).</Text>
            {canEdit ? <Button small variant="secondary" title="Confirm" onPress={() => run(() => rpc('drawing_mark_checked', { p_items: [it.id], p_routes: null }), 'Confirmed')} /> : null}
          </Row>
        ) : null}
        {readingFlags(it).length ? <Notice tone={colors.red}>{readingFlags(it).join('\n')}</Notice> : null}
        {it.kind === 'riser' ? (
          <View style={{ gap: 6 }}>
            <KeyValue label="Riser" value={data.risers.find((x) => x.id === it.riser_id)?.name ?? 'Not linked yet'} />
            <Row wrap gap={6}>
              {canEdit ? (
                <Button
                  small
                  variant="secondary"
                  title="Link to a riser"
                  onPress={async () => {
                    const v = await dialog.prompt({
                      title: 'Which riser is this?',
                      message: 'The same riser on every floor it passes. New risers are added on the Risers page.',
                      fields: [{ key: 'r', label: 'Riser', type: 'select', required: true, initial: it.riser_id ?? '', options: data.risers.map((x) => ({ value: x.id, label: x.name })) }],
                    });
                    if (v) await run(() => rpc('drawing_item_riser', { p_item: it.id, p_riser: v.r }), 'Linked');
                  }}
                />
              ) : null}
              <Button small variant="secondary" title="Risers" onPress={() => router.push(`/execution/drawing/risers/${d.exec_project_id}`)} />
            </Row>
          </View>
        ) : null}
        <View style={{ gap: 6 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>Stage</Text>
          <Row wrap gap={6}>
            {steps.map(([s, t]) => (
              <Chip
                key={s}
                label={t}
                tone={it.status === s ? STATUS_COLOR[s] : undefined}
                onPress={
                  canUpdate && it.status !== s
                    ? async () => {
                        let note: string | null = null;
                        if (s === 'failed') {
                          const r = await dialog.prompt({ title: 'What failed?', fields: [{ key: 'n', label: 'Fault', type: 'multiline', required: true }] });
                          if (!r) return;
                          note = r.n;
                        }
                        await upd('drawing_item_status', { p_id: it.id, p_status: s, p_note: note }, `${stepLabel(it.kind, s, d.lms)} – recorded with your name and time`);
                      }
                    : undefined
                }
              />
            ))}
          </Row>
          {!canUpdate ? <Muted>Only the project team updates the stage.</Muted> : null}
        </View>
        {CK.length ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{`Checks · ${done} of ${CK.length}`}</Text>
            {CK.map(([c, t]) => (
              <Toggle
                key={c}
                label={t}
                value={!!it.checks?.[c]}
                onChange={(v) => {
                  if (!canUpdate) return;
                  void upd('drawing_item_checks', { p_id: it.id, p_checks: { ...emptyChecks(it.kind), ...it.checks, [c]: v }, p_readings: null });
                }}
              />
            ))}
            <Muted>Tested / Commissioned needs every check ticked.</Muted>
          </View>
        ) : null}
        {RD.length ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>Readings</Text>
            {RD.map(([r, t, u]) => (
              <KeyValue key={r} label={`${t}${u ? ` (${u})` : ''}`} value={it.readings?.[r] || '—'} />
            ))}
            {canUpdate ? (
              <Button
                small
                variant="secondary"
                title="Record readings"
                onPress={async () => {
                  const v = await dialog.prompt({ title: `Readings – ${k.name}`, fields: RD.map(([r, t, u]) => ({ key: r, label: `${t}${u ? ` (${u})` : ''}`, initial: it.readings?.[r] ?? '' })) });
                  if (v) await upd('drawing_item_checks', { p_id: it.id, p_checks: null, p_readings: { ...it.readings, ...v } }, 'Readings saved');
                }}
              />
            ) : null}
          </View>
        ) : null}
        {canEdit ? (
          <Row wrap gap={6}>
            <Button
              small
              variant="secondary"
              title="Details"
              onPress={async () => {
                const v = await dialog.prompt({
                  title: k.name,
                  fields: [
                    { key: 'label', label: 'Name / tag (e.g. DB-GF1, FCU-L1)', initial: it.label ?? '' },
                    { key: 'area', label: 'Area / room', initial: it.area ?? '' },
                    { key: 'circuit', label: k.d === 'lms' ? (LMS_SYSTEMS[d.lms] ?? LMS_SYSTEMS.KNX).addr : k.d === 'bms' ? 'Controller / point' : 'Circuit (e.g. GF/L1)', initial: it.circuit ?? '' },
                    { key: 'serial', label: 'Serial number', initial: it.serial ?? '' },
                    { key: 'note', label: 'Note', type: 'multiline', initial: it.note ?? '' },
                  ],
                });
                if (v) await run(() => rpc('drawing_item_save', { p: { id: it.id, ...v } }), 'Saved');
              }}
            />
            <Button
              small
              variant="secondary"
              title="BOQ & programme"
              onPress={async () => {
                const v = await dialog.prompt({ title: 'Link to the BOQ and the programme', fields: linkFields(it) });
                if (v) await run(() => rpc('drawing_item_save', { p: { id: it.id, ...(boq.length ? { boq_item_id: v.boq || null } : {}), activity_id: v.act || null } }), 'Linked');
              }}
            />
            <Button small variant="secondary" title="Move" onPress={() => setMode('move')} />
            <Button
              small
              variant="secondary"
              title="Copy"
              onPress={() => {
                copies.current = 0;
                setCopySrc(it);
                setDraft(null);
                setMode('copy');
              }}
            />
            <Button
              small
              variant="secondary"
              title="Remove"
              onPress={async () => {
                if (await dialog.confirm('Remove this item?', `${k.name}${it.label ? ` ${it.label}` : ''} and its checks are removed from the drawing.`, { danger: true, confirmLabel: 'Remove' }))
                  await run(async () => {
                    await rpc('drawing_item_delete', { p_id: it.id });
                    setSel(null);
                  }, 'Removed');
              }}
            />
          </Row>
        ) : null}
        {mode === 'move' ? <Notice tone={colors.blue}>Tap the new position on the drawing.</Notice> : null}
        {it.kind === 'db' ? <DbSchedule db={it} items={items} canEdit={canEdit} canUpdate={canUpdate && !offline} people={people} onChange={reload} /> : null}
        {pins.filter((x) => x.item_id === it.id).length ? (
          <View style={{ gap: 2 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>Issues on this item</Text>
            {pins
              .filter((x) => x.item_id === it.id)
              .map((x) => (
                <Pressable key={x.id} onPress={() => setSel({ kind: 'pin', id: x.id })}>
                  <Text style={{ color: x.open ? colors.blue : colors.faint }}>{`${PIN_KINDS[x.kind]?.name ?? x.kind}${x.ref_code ? ` ${x.ref_code}` : ''} · ${x.title} · ${x.open ? 'open' : 'closed'}`}</Text>
                </Pressable>
              ))}
          </View>
        ) : null}
        <Photos
          d={d}
          stageName={(s) => stepLabel(it.kind, s, d.lms)}
          photos={data.photos.filter((x) => x.item_id === it.id)}
          target={{ item: it.id }}
          canAdd={canUpdate && !offline}
          canEdit={canEdit}
          me={me.id}
          people={people}
          onChange={reload}
        />
        {history((e) => e.item_id === it.id)}
      </View>
    );
  };

  const routePanel = (r: DRoute) => {
    const k = routeOf(r.kind);
    const cont = isCont(r.kind);
    const m = routeMetres(d, r);
    const steps = cont ? CONT_STEPS : CABLE_STEPS;
    const ins = cont ? null : runsIn(d, r, routes);
    const inside = ins ? [...ins.values()].reduce((t, v) => t + v, 0) : 0;
    const carries = cont ? cablesIn(d, r, routes) : [];
    const fill = cont ? fillPct(d, r, routes) : 0;
    return (
      <View style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colors.ink, flexShrink: 1 }}>{k.name}</Text>
          <Button small variant="secondary" title="Close" onPress={() => setSel(null)} />
        </Row>
        <View style={{ gap: 2 }}>
          {r.label ? <KeyValue label="Description" value={r.label} /> : null}
          <KeyValue label="Length" value={m == null ? 'Set the scale to get metres' : `${fmtNumber(m, 1)} m${!cont && (r.cores ?? 1) > 1 ? ` × ${r.cores} cables = ${fmtNumber(m * (r.cores ?? 1), 0)} m` : ''}`} />
          {!cont ? <KeyValue label="Laid" value={`${r.laid}%${m != null ? ` · ${fmtNumber((m * (r.cores ?? 1) * r.laid) / 100, 0)} m` : ''}`} /> : null}
          {!cont ? (
            <KeyValue
              label="Runs in"
              value={
                ins && ins.size
                  ? [...ins.entries()].map(([cid, share]) => `${routeOf(routes.find((q) => q.id === cid)?.kind ?? '').name} · ${Math.round(share * 100)}%`).join('\n') +
                    (inside < 0.97 ? `\n${Math.round((1 - inside) * 100)}% outside containment` : '')
                  : 'Outside containment (cleated / free)'
              }
            />
          ) : (
            <KeyValue label="Fill" value={`${fill}% of the cross-section (limit ${k.limit}%)`} />
          )}
          <KeyValue label="BOQ line" value={boqName(boq.find((b) => b.id === r.boq_item_id))} />
          <KeyValue label="Activity" value={actName(acts.find((a) => a.id === r.activity_id))} />
        </View>
        {r.to_check ? (
          <Row wrap gap={8} style={{ padding: 8, borderRadius: 8, backgroundColor: '#FFF4E0' }}>
            <Text style={{ color: colors.ink, flexShrink: 1 }}>Copied from another floor – check the route matches this floor.</Text>
            {canEdit ? <Button small variant="secondary" title="Confirm" onPress={() => run(() => rpc('drawing_mark_checked', { p_items: null, p_routes: [r.id] }), 'Confirmed')} /> : null}
          </Row>
        ) : null}
        {cont ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>Cross-section – busiest point</Text>
            <XSection cont={r} cables={carries} />
            {carries.map((c) => (
              <Muted key={c.id}>{`• ${routeOf(c.kind).name}${c.label ? ` – ${c.label}` : ''}${(c.cores ?? 1) > 1 ? ` (${c.cores} cables)` : ''}`}</Muted>
            ))}
          </View>
        ) : null}
        <View style={{ gap: 6 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>Stage</Text>
          <Row wrap gap={6}>
            {steps.map(([s, t]) => (
              <Chip
                key={s}
                label={t}
                tone={r.status === s ? STATUS_COLOR[s] : undefined}
                onPress={
                  canUpdate && r.status !== s
                    ? async () => {
                        let note: string | null = null;
                        if (s === 'failed') {
                          const v = await dialog.prompt({ title: 'What failed?', fields: [{ key: 'n', label: 'Fault', type: 'multiline', required: true }] });
                          if (!v) return;
                          note = v.n;
                        }
                        await upd('drawing_route_progress', { p_id: r.id, p_status: s, p_laid: null, p_note: note }, 'Updated');
                      }
                    : undefined
                }
              />
            ))}
          </Row>
          {!cont && canUpdate ? (
            <Row wrap gap={6}>
              <Muted>Laid:</Muted>
              {[0, 25, 50, 75, 100].map((v) => (
                <Chip key={v} label={`${v}%`} on={r.laid === v} onPress={() => upd('drawing_route_progress', { p_id: r.id, p_status: v > 0 && r.status === 'planned' ? 'laid' : r.status, p_laid: v, p_note: null }, `${v}% laid`)} />
              ))}
            </Row>
          ) : null}
        </View>
        {canEdit ? (
          <Row wrap gap={6}>
            <Button
              small
              variant="secondary"
              title="Details"
              onPress={async () => {
                const v = await dialog.prompt({
                  title: k.name,
                  fields: [
                    { key: 'label', label: 'Description', initial: r.label ?? '' },
                    ...(!cont
                      ? [
                          { key: 'cores', label: 'Number of cables in the run', initial: String(r.cores ?? 1) },
                          { key: 'dia', label: 'Outside diameter of one cable (mm)', initial: r.area ? String(Math.round(Math.sqrt((4 * Number(r.area)) / Math.PI) * 10) / 10) : '' },
                        ]
                      : []),
                  ],
                });
                if (!v) return;
                const dia = Number(v.dia);
                await run(() => rpc('drawing_route_save', { p: { id: r.id, label: v.label, ...(!cont ? { cores: v.cores || null, area: dia > 0 ? Math.round(((Math.PI * dia * dia) / 4) * 10) / 10 : null } : {}) } }), 'Saved');
              }}
            />
            <Button
              small
              variant="secondary"
              title="BOQ & programme"
              onPress={async () => {
                const v = await dialog.prompt({ title: 'Link to the BOQ and the programme', fields: linkFields(r) });
                if (v) await run(() => rpc('drawing_route_save', { p: { id: r.id, ...(boq.length ? { boq_item_id: v.boq || null } : {}), activity_id: v.act || null } }), 'Linked');
              }}
            />
            <Button
              small
              variant="secondary"
              title="Remove"
              onPress={async () => {
                if (await dialog.confirm('Remove this route?', k.name, { danger: true, confirmLabel: 'Remove' }))
                  await run(async () => {
                    await rpc('drawing_route_delete', { p_id: r.id });
                    setSel(null);
                  }, 'Removed');
              }}
            />
          </Row>
        ) : null}
        <Photos
          d={d}
          stageName={(s) => steps.find((x) => x[0] === s)?.[1] ?? s}
          photos={data.photos.filter((x) => x.route_id === r.id)}
          target={{ route: r.id }}
          canAdd={canUpdate && !offline}
          canEdit={canEdit}
          me={me.id}
          people={people}
          onChange={reload}
        />
        {history((e) => e.route_id === r.id)}
      </View>
    );
  };

  const pinPanel = (pn: DPin) => {
    const pk = PIN_KINDS[pn.kind] ?? PIN_KINDS.note;
    const link = pn.ref_type === 'design_query' ? `/execution/query/${pn.ref_id}` : pn.ref_type === 'hse_report' ? `/execution/hse/${pn.ref_id}` : pn.ref_type === 'snag' ? `/execution/${d.exec_project_id}?tab=handover` : null;
    const about = items.find((x) => x.id === pn.item_id);
    return (
      <View style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colors.ink, flexShrink: 1 }}>{`${pk.name}${pn.ref_code ? ` ${pn.ref_code}` : ''}`}</Text>
          <Button small variant="secondary" title="Close" onPress={() => setSel(null)} />
        </Row>
        <View style={{ gap: 2 }}>
          <KeyValue label="Issue" value={pn.title} />
          <KeyValue label="State" value={`${pn.open ? 'Open' : 'Closed'}${pn.state && pn.state !== 'open' && pn.state !== 'closed' ? ` (${pn.state})` : ''}`} />
          {about ? <KeyValue label="About" value={`${kindOf(about.kind).name}${about.label ? ` ${about.label}` : ''}`} /> : null}
          <KeyValue label="Pinned" value={`${people[pn.raised_by ?? '']?.full_name ?? '—'} · ${fmtDateTime(pn.raised_at)}`} />
          {pn.close_note ? <KeyValue label={pn.ref_type === 'design_query' ? 'Answer' : 'Resolved'} value={pn.close_note} /> : null}
        </View>
        <Row wrap gap={6}>
          {link ? <Button small variant="secondary" title={pn.ref_type === 'snag' ? 'Open the snag list' : 'Open the record'} onPress={() => router.push(link as never)} /> : null}
          {!pn.ref_type && canUpdate ? (
            <Button
              small
              variant="secondary"
              title={pn.open ? 'Mark resolved' : 'Reopen'}
              onPress={async () => {
                if (!pn.open) return run(() => rpc('drawing_pin_close', { p_id: pn.id, p_note: null, p_open: true }), 'Reopened');
                const v = await dialog.prompt({ title: 'Resolved', fields: [{ key: 'n', label: 'How was it resolved?', type: 'multiline', required: true }] });
                if (v) await run(() => rpc('drawing_pin_close', { p_id: pn.id, p_note: v.n, p_open: false }), 'Resolved');
              }}
            />
          ) : null}
          {canEdit || pn.raised_by === me.id ? (
            <Button
              small
              variant="secondary"
              title="Remove pin"
              onPress={async () => {
                if (await dialog.confirm('Remove the pin?', pn.ref_type ? 'The design query / snag / HSE report itself stays in its module.' : undefined, { danger: true, confirmLabel: 'Remove' }))
                  await run(async () => {
                    await rpc('drawing_pin_delete', { p_id: pn.id });
                    setSel(null);
                  }, 'Removed');
              }}
            />
          ) : null}
        </Row>
        {pn.ref_type ? <Muted>It is followed up and closed in its own module; the pin shows its state.</Muted> : null}
      </View>
    );
  };

  const removeDrawing = async () => {
    const worked = items.some((x) => x.status !== 'planned') || routes.some((x) => x.status !== 'planned') || data.photos.length > 0;
    const v = await dialog.prompt({
      title: 'Remove this drawing?',
      message: worked
        ? 'Work is recorded on it – its items, checks, photos and history are removed for good, and its figures leave the BOQ and the programme. Archive it instead if you only want it out of the way.'
        : 'Its items, routes and history are removed for good.',
      fields: [{ key: 'why', label: 'Why is it removed?', type: 'multiline', required: worked }],
      danger: true,
      confirmLabel: 'Remove',
    });
    if (!v) return;
    let done = false;
    await dialog.run(async () => {
      const paths = await rpc<string[]>('drawing_delete', { p_id: d.id, p_reason: v.why || null });
      if (paths?.length) await supabase.storage.from('drawings').remove(paths);
      done = true;
    }, 'Drawing removed');
    if (done) router.replace(`/execution/${d.exec_project_id}?tab=drawings`);
  };

  const copyFloor = async () => {
    const others = data.sheets.filter((x) => x.id !== d.id && !x.archived);
    if (!others.length) return dialog.toast('There is no other drawing in this project to copy from', 'error');
    const v = await dialog.prompt({
      title: 'Copy from another floor',
      message: 'Items and routes are placed at the same spots on this sheet and flagged “to check”. Move or remove the ones that differ here (partitions, rooms), then confirm them. Stages, checks and photos are not copied.',
      fields: [
        { key: 'src', label: 'Copy from', type: 'select', required: true, options: others.map((x) => ({ value: x.id, label: `${x.floor ? `${x.floor} · ` : ''}${x.sheet_no ? `${x.sheet_no} ` : ''}${x.title}` })) },
        { key: 'what', label: 'Copy', type: 'multiselect', required: true, initial: 'items,routes,links', options: [{ value: 'items', label: 'Items' }, { value: 'routes', label: 'Containment and cable routes' }, { value: 'links', label: 'BOQ and programme links' }] },
        { key: 'from', label: 'In tags and circuits, replace (e.g. L2)', initial: '' },
        { key: 'to', label: '… with (e.g. L3)', initial: '' },
      ],
    });
    if (!v) return;
    const src = others.find((x) => x.id === v.src);
    if (src && Math.abs(src.width / src.height - d.width / d.height) > 0.02 && !(await dialog.confirm('The sheets are different sizes', 'Positions are copied as a share of the sheet – they may land off. Copy anyway?', { confirmLabel: 'Copy' }))) return;
    const w = v.what.split(',');
    await run(async () => {
      const r = await rpc<{ items: number; routes: number }>('drawing_copy_from', { p_target: d.id, p_source: v.src, p: { items: w.includes('items'), routes: w.includes('routes'), links: w.includes('links'), replace_from: v.from || null, replace_to: v.to } });
      dialog.toast(`${r.items} items and ${r.routes} routes copied – check them against this floor`);
    });
  };

  const summary = () => {
    const vis = items.filter((x) => discs.includes(kindOf(x.kind).d));
    const inst = vis.filter((x) => installed(x.status)).length, tested = vis.filter((x) => x.status === 'tested' || x.status === 'done').length;
    const failed = vis.filter((x) => x.status === 'failed');
    const linkedActs = acts.filter((a) => items.some((x) => x.activity_id === a.id) || routes.some((x) => x.activity_id === a.id));
    const linkedBoq = boq.filter((b) => figs.some((f) => f.boq_item_id === b.id));
    const metres = Object.entries(ROUTES)
      .map(([k, v]) => [v.name, routes.filter((r) => r.kind === k).reduce((t, r) => t + (routeMetres(d, r) ?? 0) * (isCont(k) ? 1 : (r.cores ?? 1)), 0)] as const)
      .filter(([, mm]) => mm > 0);
    return (
      <View style={{ gap: 12 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colors.ink }}>Installation progress</Text>
          <Progress pct={vis.length ? Math.round((100 * inst) / vis.length) : 0} colour={colors.green} />
          <Muted>{`${vis.length} items · ${inst} installed (2nd fix or later) · ${tested} tested · ${failed.length} failed`}</Muted>
        </View>
        {discs
          .filter((x) => x !== 'cont' && x !== 'fiber')
          .map((x) => {
            const its = vis.filter((i) => kindOf(i.kind).d === x);
            if (!its.length) return null;
            return <KeyValue key={x} label={DISC[x].name} value={`${its.filter((i) => installed(i.status)).length} of ${its.length} installed · ${its.filter((i) => i.status === 'tested' || i.status === 'done').length} tested`} />;
          })}
        {failed.length ? (
          <Notice tone={colors.red}>
            {failed
              .slice(0, 6)
              .map((x) => `${[kindOf(x.kind).code, x.label, x.area].filter(Boolean).join(' ')}${x.note ? ` – ${x.note}` : ''}`)
              .join('\n')}
          </Notice>
        ) : null}
        {toCheck.items.length + toCheck.routes.length ? (
          <Row wrap gap={8} style={{ padding: 8, borderRadius: 8, backgroundColor: '#FFF4E0' }}>
            <Text style={{ color: colors.ink, flexShrink: 1 }}>{`${toCheck.items.length} item(s) and ${toCheck.routes.length} route(s) copied from another floor are still to check (dashed amber).`}</Text>
            {canEdit ? (
              <Button
                small
                variant="secondary"
                title="Confirm all"
                onPress={async () => {
                  if (await dialog.confirm('Confirm every copied item and route?', 'Only when you have checked them all against this floor.', { confirmLabel: 'Confirm all' }))
                    await run(() => rpc('drawing_mark_checked', { p_items: toCheck.items.map((x) => x.id), p_routes: toCheck.routes.map((x) => x.id) }), 'Confirmed');
                }}
              />
            ) : null}
          </Row>
        ) : null}
        {pins.some((x) => x.open) ? (
          <View style={{ gap: 2 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{`Open issues (${pins.filter((x) => x.open).length})`}</Text>
            {pins
              .filter((x) => x.open)
              .slice(0, 8)
              .map((x) => (
                <Pressable key={x.id} onPress={() => setSel({ kind: 'pin', id: x.id })}>
                  <Text style={{ color: PIN_KINDS[x.kind]?.c ?? colors.ink }}>{`${PIN_KINDS[x.kind]?.name ?? x.kind}${x.ref_code ? ` ${x.ref_code}` : ''} · ${x.title}`}</Text>
                </Pressable>
              ))}
          </View>
        ) : null}
        <Row wrap gap={6}>
          {scope.lms || scope.bms || scope.outdoor ? <Button small variant="secondary" title="Points, scenes & tests" onPress={() => router.push(`/execution/drawing/points/${d.id}`)} /> : null}
          <Button small variant="secondary" title="Risers" onPress={() => router.push(`/execution/drawing/risers/${d.exec_project_id}`)} />
        </Row>
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>Scale</Text>
          <Muted>{d.width_m ? `The sheet is ${fmtNumber(d.width_m, 1)} m wide – lengths are worked out from it.` : 'Not set – set it to get cable and containment lengths in metres.'}</Muted>
          {canEdit ? (
            <Button
              small
              variant="secondary"
              title={d.width_m ? 'Reset the scale' : 'Set the scale'}
              onPress={() => {
                setSel(null);
                setDraft([]);
                setMode('scale');
              }}
            />
          ) : null}
        </View>
        {metres.length ? (
          <View style={{ gap: 2 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>Containment & cable on this drawing</Text>
            {metres.map(([n, mm]) => (
              <KeyValue key={n} label={n} value={`${fmtNumber(mm, 0)} m`} />
            ))}
          </View>
        ) : null}
        {linkedActs.length ? (
          <View style={{ gap: 2 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>Programme activities</Text>
            {linkedActs.map((a) => (
              <KeyValue key={a.id} label={actName(a)} value={`Engineer ${Math.round(Number(a.pct))}% · drawings ${a.pct_drawing == null ? '—' : `${Math.round(Number(a.pct_drawing))}%`}`} />
            ))}
            <Muted>The drawings&apos; figure is shown beside the activity&apos;s own % – the engineer still updates the programme.</Muted>
          </View>
        ) : null}
        {linkedBoq.length ? (
          <View style={{ gap: 2 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>BOQ lines (all drawings of the project)</Text>
            {linkedBoq.map((b) => {
              const f = figs.find((x) => x.boq_item_id === b.id)!;
              return (
                <KeyValue
                  key={b.id}
                  label={boqName(b)}
                  value={`BOQ ${fmtNumber(Number(b.qty ?? 0), 0)} · drawings ${fmtNumber(Number(f.qty), 0)} · done ${fmtNumber(Number(f.done), 1)} ${b.unit ?? ''}${Number(f.qty) > Number(b.qty ?? 0) ? ' · more than the BOQ' : ''}`}
                />
              );
            })}
          </View>
        ) : null}
        {canEdit ? (
          <Row wrap gap={6}>
            <Button
              small
              variant="secondary"
              title="Drawing details"
              onPress={async () => {
                const v = await dialog.prompt({
                  title: 'Drawing',
                  fields: [
                    { key: 'title', label: 'Title', required: true, initial: d.title },
                    { key: 'sheet_no', label: 'Drawing number', initial: d.sheet_no ?? '' },
                    { key: 'floor', label: 'Floor / area', initial: d.floor ?? '' },
                    { key: 'level', label: 'Floor order (−1 basement, 0 ground, 1, 2 …)', initial: d.level_no == null ? '' : String(d.level_no) },
                    { key: 'revision', label: 'Revision', initial: d.revision ?? '' },
                    {
                      key: 'scope',
                      label: 'What this drawing includes',
                      type: 'multiselect',
                      required: true,
                      initial: (Object.keys(scope) as (keyof Scope)[]).filter((k) => scope[k]).join(','),
                      options: [
                        { value: 'services', label: 'Building services' },
                        { value: 'lms', label: 'Lighting control' },
                        { value: 'bms', label: 'BMS' },
                        { value: 'outdoor', label: 'Outdoor – poles, masts, feeder pillars' },
                      ],
                    },
                    { key: 'lms', label: 'Lighting control system', type: 'select', initial: d.lms, options: Object.keys(LMS_SYSTEMS).map((k) => ({ value: k, label: k })), when: { key: 'scope', in: ['lms'] } },
                  ],
                });
                if (!v) return;
                const sc = Object.fromEntries(v.scope.split(',').filter(Boolean).map((k) => [k, true]));
                await run(() => rpc('drawing_save', { p: { id: d.id, title: v.title, sheet_no: v.sheet_no, floor: v.floor, level_no: v.level.trim(), revision: v.revision, scope: sc, lms: v.lms || d.lms } }), 'Saved');
              }}
            />
            <Button
              small
              variant="secondary"
              title="New revision"
              onPress={async () => {
                const pj = data.project;
                if (pj && (await uploadDrawing({ ...(pj as ExecProject) }, dialog, d))) await reload();
              }}
            />
            <Button small variant="secondary" title="Copy from another floor" onPress={copyFloor} />
            <Button
              small
              variant="secondary"
              title="Archive"
              onPress={async () => {
                if (await dialog.confirm('Archive this drawing?', 'It stays readable; its items stop counting in the BOQ and programme figures.', { confirmLabel: 'Archive' }))
                  await run(() => rpc('drawing_archive', { p_id: d.id, p_archived: true }), 'Archived');
              }}
            />
            <Button small variant="secondary" title="Remove drawing" onPress={removeDrawing} />
          </Row>
        ) : null}
        {history(() => true)}
      </View>
    );
  };

  const ql = q.trim().toLowerCase();
  const found = ql
    ? visible.filter((x) => [x.label, x.area, x.circuit, x.serial, kindOf(x.kind).code, kindOf(x.kind).name].some((v) => (v ?? '').toLowerCase().includes(ql)))
    : [];
  const goTo = (it: DItem) => {
    setSel({ kind: 'item', id: it.id });
    setZoom((z) => Math.max(z, 2.5));
    setFocus((f) => ({ x: it.x, y: it.y, n: (f?.n ?? 0) + 1 }));
  };
  const chosen = items.filter((x) => marked.includes(x.id));
  const bulkStage = async () => {
    const order = ['planned', 'first', 'wired', 'second', 'addr', 'prog', 'p2p', 'tested', 'done', 'failed'];
    const names = new Map<string, string>();
    for (const x of chosen) for (const [st, t] of stepsFor(x.kind, d.lms)) if (!names.has(st)) names.set(st, t);
    const opts = order.filter((st) => names.has(st)).map((st) => ({ value: st, label: names.get(st)! }));
    const r = await dialog.prompt({
      title: `Stage of ${chosen.length} item(s)`,
      message: 'Items whose checks are not all ticked stay where they are for Tested / Commissioned.',
      fields: [
        { key: 'st', label: 'Stage', type: 'select', required: true, options: opts },
        { key: 'n', label: 'What failed?', type: 'multiline', required: true, when: { key: 'st', in: ['failed'] } },
      ],
    });
    if (!r) return;
    await upd<{ updated: number; skipped: number }>('drawing_items_status', { p_ids: marked, p_status: r.st, p_note: r.st === 'failed' ? r.n : null }, (x) =>
      `${x.updated} updated${x.skipped ? ` · ${x.skipped} skipped – tick their checks first` : ''}`,
    );
  };

  const panel = (
    <Card style={{ gap: 10 }}>{selItem ? itemPanel(selItem) : selRoute ? routePanel(selRoute) : selPin ? pinPanel(selPin) : summary()}</Card>
  );

  return (
    <Screen maxWidth={1500}>
      <Stack.Screen options={{ title: `${d.sheet_no ? `${d.sheet_no} · ` : ''}${d.title}` }} />
      <TestingBanner what="Smart drawings" show />
      {!on ? <Notice tone={colors.amber}>Smart drawings are not used on this project any more – this drawing is read-only.</Notice> : null}
      <Card style={{ gap: 8 }}>
        <Muted>{`${data.project ? `${data.project.code ?? ''} ${data.project.name} · ` : ''}${d.floor ? `${d.floor} · ` : ''}${d.revision ? `rev ${d.revision}` : ''}${d.archived ? ' · archived' : ''}`}</Muted>
        {offline ? (
          <Notice tone={colors.amber}>{`No signal – this is the copy kept on this phone (${fmtDateTime(data.offline!)}). Stage, check, reading and metres-laid updates are kept and sent when the connection is back; placing items and photos need the connection.`}</Notice>
        ) : null}
        {dq.queue.length ? (
          <Row wrap gap={8} style={{ padding: 8, borderRadius: 8, backgroundColor: '#FFF4E0' }}>
            <Text style={{ color: colors.ink, flexShrink: 1 }}>{`${dq.queue.length} update(s) made without signal are waiting on this phone.`}</Text>
            <Button small variant="secondary" title="Send now" onPress={() => dialog.run(() => dq.sync())} />
          </Row>
        ) : null}
        <Row wrap gap={8}>
          <Segmented<StageLayer> value={layer} onChange={setLayer} options={[{ value: 'progress', label: 'Installation progress' }, { value: 'services', label: 'Services' }]} />
          <Button small variant="secondary" title="−" onPress={() => setZoom((z) => Math.max(1, Math.round((z - 0.5) * 2) / 2))} />
          <Muted>{`${Math.round(zoom * 100)}%`}</Muted>
          <Button small variant="secondary" title="+" onPress={() => setZoom((z) => Math.min(6, Math.round((z + 0.5) * 2) / 2))} />
          {zoom > 1 ? <Button small variant="secondary" title="Fit" onPress={() => setZoom(1)} /> : null}
          <View style={{ minWidth: 220, flexGrow: 1, maxWidth: 360 }}>
            <Field label="Find" value={q} onChangeText={setQ} placeholder="Tag, room, circuit or type" testID="drawing-find" />
          </View>
        </Row>
        {ql ? (
          <View style={{ gap: 2 }}>
            {found.slice(0, 8).map((x) => (
              <Pressable key={x.id} onPress={() => goTo(x)} style={{ paddingVertical: 4 }}>
                <Text style={{ color: colors.blue }}>{`${kindOf(x.kind).code} · ${x.label || kindOf(x.kind).name}${x.area ? ` · ${x.area}` : ''}${x.circuit ? ` · ${x.circuit}` : ''} · ${stepLabel(x.kind, x.status, d.lms)}`}</Text>
              </Pressable>
            ))}
            <Row wrap gap={8}>
              <Muted>{found.length ? `${found.length} found${found.length > 8 ? ' – the first 8 shown' : ''}` : 'Nothing found'}</Muted>
              {found.length && canUpdate ? (
                <Button
                  small
                  variant="secondary"
                  title={`Choose all ${found.length}`}
                  onPress={() => {
                    setSel(null);
                    setDraft([]);
                    setMode('select');
                    setMarked(found.map((x) => x.id));
                  }}
                />
              ) : null}
            </Row>
          </View>
        ) : null}
        <Row wrap gap={6}>
          {discs.map((x) => (
            <Chip key={x} label={DISC[x].name} on={!hidden.includes(x)} onPress={() => setHidden((h) => (h.includes(x) ? h.filter((y) => y !== x) : [...h, x]))} />
          ))}
          <Chip label={`Issues (${pins.filter((x) => x.open).length} open)`} on={showPins} onPress={() => setShowPins((v) => !v)} />
        </Row>
        {canEdit ? (
          <Row wrap gap={8}>
            <View style={{ minWidth: 260, flexGrow: 1, maxWidth: 420 }}>
              <Select label="Item to place" value={addKind} options={kindOptions} onChange={(v) => setAddKind(v)} searchable />
            </View>
            <Button small variant={mode === 'item' ? 'primary' : 'secondary'} title={mode === 'item' ? 'Done placing' : '+ Item'} onPress={() => { setDraft(null); setMode(mode === 'item' ? null : 'item'); }} />
            <Button small variant={mode === 'row' ? 'primary' : 'secondary'} title="+ Row" onPress={() => { setSel(null); setDraft(mode === 'row' ? null : []); setMode(mode === 'row' ? null : 'row'); }} />
            <Button small variant={mode === 'grid' ? 'primary' : 'secondary'} title="+ Grid" onPress={() => { setSel(null); setDraft(mode === 'grid' ? null : []); setMode(mode === 'grid' ? null : 'grid'); }} />
            <Button small variant={mode === 'route' ? 'primary' : 'secondary'} title="+ Route" onPress={() => { setSel(null); setDraft(mode === 'route' ? null : []); setMode(mode === 'route' ? null : 'route'); }} />
            <Button small variant={mode === 'select' ? 'primary' : 'secondary'} title="Choose many" onPress={() => { setSel(null); setDraft(mode === 'select' ? null : []); setMarked([]); setMode(mode === 'select' ? null : 'select'); }} />
            <Button small variant={mode === 'pin' ? 'primary' : 'secondary'} title="+ Issue" disabled={offline} onPress={() => { setSel(null); setDraft(null); setMode(mode === 'pin' ? null : 'pin'); }} />
          </Row>
        ) : null}
        {canUpdate && !canEdit ? (
          <Row wrap gap={8}>
            <Button small variant={mode === 'select' ? 'primary' : 'secondary'} title="Choose many" onPress={() => { setSel(null); setDraft(mode === 'select' ? null : []); setMarked([]); setMode(mode === 'select' ? null : 'select'); }} />
            <Button small variant={mode === 'pin' ? 'primary' : 'secondary'} title="+ Issue" disabled={offline} onPress={() => { setSel(null); setDraft(null); setMode(mode === 'pin' ? null : 'pin'); }} />
          </Row>
        ) : null}
        {mode === 'row' || mode === 'grid' ? (
          <Row wrap gap={8}>
            <Notice tone={colors.blue}>{mode === 'row' ? `Row of ${kindOf(addKind).name}: tap the first and the last position (${(draft ?? []).length} of 2).` : `Grid of ${kindOf(addKind).name}: tap two opposite corners (${(draft ?? []).length} of 2).`}</Notice>
            <Button small variant="secondary" title="Stop" onPress={() => { setDraft(null); setMode(null); }} />
          </Row>
        ) : null}
        {mode === 'copy' && copySrc ? (
          <Row wrap gap={8}>
            <Notice tone={colors.blue}>{`Tap to place copies of ${kindOf(copySrc.kind).name}${copySrc.label ? ` ${copySrc.label}` : ''} – same type, area, circuit and links; the tag is numbered on; checks start empty.`}</Notice>
            <Button small variant="secondary" title="Done copying" onPress={() => { setCopySrc(null); setMode(null); }} />
          </Row>
        ) : null}
        {mode === 'select' ? (
          <View style={{ gap: 6, padding: 8, borderRadius: 8, backgroundColor: '#E8F0FB' }}>
            <Text style={{ color: colors.ink }}>{`${marked.length} chosen. Tap items to add or drop them, or tap two corners on the drawing to take everything in between (${(draft ?? []).length} of 2).`}</Text>
            <Row wrap gap={8}>
              <Button small title="Set the stage" disabled={!marked.length} onPress={bulkStage} />
              <Button small variant="secondary" title={`All shown (${visible.length})`} onPress={() => setMarked(visible.map((x) => x.id))} />
              <Button small variant="secondary" title="Clear" disabled={!marked.length} onPress={() => { setMarked([]); setDraft([]); }} />
              {canEdit && chosen.some((x) => x.to_check) ? (
                <Button small variant="secondary" title="Confirm copies" onPress={() => run(() => rpc('drawing_mark_checked', { p_items: chosen.filter((x) => x.to_check).map((x) => x.id), p_routes: null }), 'Confirmed')} />
              ) : null}
              {canEdit ? (
                <Button
                  small
                  variant="secondary"
                  title="Remove"
                  disabled={!marked.length || offline}
                  onPress={async () => {
                    if (!(await dialog.confirm(`Remove ${marked.length} item(s)?`, 'They and their checks are removed from the drawing.', { danger: true, confirmLabel: 'Remove' }))) return;
                    await run(async () => {
                      for (const x of marked) await rpc('drawing_item_delete', { p_id: x });
                      setMarked([]);
                    }, 'Removed');
                  }}
                />
              ) : null}
              <Button small variant="secondary" title="Done" onPress={() => { setMarked([]); setDraft(null); setMode(null); }} />
            </Row>
          </View>
        ) : null}
        {mode === 'pin' ? (
          <Row wrap gap={8}>
            <Notice tone={colors.blue}>Tap where the issue is – next to the item it is about. A design query, snag or HSE report is raised in its own module and pinned here.</Notice>
            <Button small variant="secondary" title="Cancel" onPress={() => setMode(null)} />
          </Row>
        ) : null}
        {mode === 'item' ? <Notice tone={colors.blue}>{`Tap the drawing to place: ${kindOf(addKind).name}. Keep tapping to place more; press “Done placing” to stop.`}</Notice> : null}
        {mode === 'scale' ? <Notice tone={colors.blue}>{`Tap two points whose distance you know (${(draft ?? []).length} of 2).`}</Notice> : null}
        {mode === 'route' ? (
          <View style={{ gap: 6, padding: 8, borderRadius: 8, backgroundColor: '#FBE8EB' }}>
            <Text style={{ color: colors.ink }}>{`Drawing a route: tap the start, then each bend (${(draft ?? []).length} points${d.width_m && (draft ?? []).length > 1 ? ` · ${fmtNumber((lenU(draft ?? []) / 1000) * d.width_m, 1)} m` : ''}).`}</Text>
            <Row wrap gap={8}>
              <Toggle label="Straight (90°)" value={ortho} onChange={setOrtho} />
              <Toggle label="Snap to containment" value={onCont} onChange={setOnCont} />
              <Button small title="Finish" disabled={(draft ?? []).length < 2} onPress={finishRoute} />
              <Button small variant="secondary" title="Undo point" disabled={!(draft ?? []).length} onPress={() => setDraft((p) => (p ?? []).slice(0, -1))} />
              <Button small variant="secondary" title="Cancel" onPress={() => { setDraft(null); setMode(null); }} />
            </Row>
          </View>
        ) : null}
      </Card>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: 12, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', minWidth: 0, gap: 6 }}>
          {data.uri ? null : <Notice tone={colors.amber}>The drawing image could not be loaded.</Notice>}
          <Stage
            drawing={d}
            uri={data.uri}
            items={items}
            routes={routes}
            layer={layer}
            show={show}
            selected={sel?.id ?? null}
            marked={mode === 'select' ? new Set(marked) : undefined}
            draft={draft}
            zoom={zoom}
            focus={focus}
            onZoom={setZoom}
            pins={showPins ? pins : undefined}
            onPin={(pn) => {
              if (mode) return;
              setSel({ kind: 'pin', id: pn.id });
            }}
            onTap={onTap}
            onItem={(it) => {
              if (mode === 'select') return toggleMark(it.id);
              if (mode === 'route' || mode === 'scale' || mode === 'row' || mode === 'grid' || mode === 'copy') return;
              setMode(null);
              setSel({ kind: 'item', id: it.id });
            }}
          />
          <Row wrap gap={10}>
            {(layer === 'progress' ? stepsFor('down') : discs.map((x) => [x, DISC[x].name] as [string, string])).map(([k, t]) => (
              <Row key={k} gap={4}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: layer === 'progress' ? STATUS_COLOR[k] : DISC[k as Disc].c }} />
                <Muted>{t}</Muted>
              </Row>
            ))}
            <Muted>Tap an item or a route for its record.</Muted>
          </Row>
        </View>
        <View style={{ width: wide ? 400 : '100%' }}>{panel}</View>
      </View>
      {!wide && sel ? (
        <Pressable onPress={() => setSel(null)}>
          <Muted style={{ textAlign: 'center' }}>Back to the summary</Muted>
        </Pressable>
      ) : null}
    </Screen>
  );
}
