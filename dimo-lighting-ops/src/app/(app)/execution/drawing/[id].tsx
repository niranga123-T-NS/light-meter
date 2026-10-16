import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Stage, type StageLayer } from '@/components/drawing/Stage';
import { XSection } from '@/components/drawing/XSection';
import { DRAWING_EDIT_ROLES, uploadDrawing } from '@/components/exec/DrawingsTab';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Progress, Row, Screen, Section, Segmented, Select, Toggle, useWide } from '@/components/ui';
import { useMe } from '@/lib/auth';
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
  type Drawing,
  type DRoute,
  type Pt,
  type Scope,
} from '@/lib/drawings';
import type { ExecProject } from '@/lib/execution';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Sel = { kind: 'item' | 'route'; id: string } | null;
type Mode = null | 'item' | 'route' | 'scale' | 'move';
type Boq = { id: string; item_no: string | null; description: string; unit: string | null; qty: number | null };
type Act = { id: string; code: string; name: string; pct: number; pct_drawing: number | null };
type BoqFig = { boq_item_id: string; qty: number; done: number; items: number };

const UPDATE_ROLES = [...DRAWING_EDIT_ROLES, 'trainee', 'sub_supervisor'];
const DISCS_OF: Record<keyof Scope, Disc[]> = { services: ['light', 'power', 'elv', 'net', 'hvac', 'fiber', 'cont'], lms: ['lms'], bms: ['bms'] };

function segDist(x: number, y: number, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

/** One drawing: mark up items and routes, update stages, checks and readings, link to the BOQ and the programme. */
export default function DrawingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const wide = useWide();
  const [layer, setLayer] = useState<StageLayer>('progress');
  const [hidden, setHidden] = useState<Disc[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [addKind, setAddKind] = useState('down');
  const [draft, setDraft] = useState<Pt[] | null>(null);
  const [ortho, setOrtho] = useState(true);
  const [onCont, setOnCont] = useState(true);
  const [zoom, setZoom] = useState(1);

  const { data, error, reload } = useLoad(async () => {
    const { data: d, error: e } = await supabase.from('exec_drawings').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const dw = d as Drawing;
    const [it, rt, ev, ac, bq, fig, pj, uri] = await Promise.all([
      supabase.from('exec_drawing_items').select('*').eq('drawing_id', id),
      supabase.from('exec_drawing_routes').select('*').eq('drawing_id', id),
      supabase.from('exec_drawing_events').select('*').eq('drawing_id', id).order('at', { ascending: false }).limit(300),
      supabase.from('exec_activities').select('id, code, name, pct, pct_drawing').eq('exec_project_id', dw.exec_project_id).order('code'),
      supabase.from('exec_boq_items').select('id, item_no, description, unit, qty').eq('exec_project_id', dw.exec_project_id).eq('heading', false).eq('removed', false).order('seq'),
      rpc<BoqFig[]>('drawing_boq', { p_exec: dw.exec_project_id }).catch(() => [] as BoqFig[]),
      supabase.from('exec_projects').select('id, code, name').eq('id', dw.exec_project_id).maybeSingle(),
      signedImage(dw.image_path).catch(() => null),
    ]);
    return {
      d: dw,
      items: (it.data ?? []) as DItem[],
      routes: (rt.data ?? []) as DRoute[],
      events: (ev.data ?? []) as DEvent[],
      acts: (ac.data ?? []) as Act[],
      boq: (bq.data ?? []) as Boq[],
      figs: fig,
      project: pj.data as Pick<ExecProject, 'id' | 'code' | 'name'> | null,
      uri,
    };
  }, [id]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { d, items, routes, events, acts, boq, figs } = data;
  const canEdit = DRAWING_EDIT_ROLES.includes(me.role) && !d.archived;
  const canUpdate = UPDATE_ROLES.includes(me.role) && !d.archived;
  const scope: Scope = d.scope ?? { services: true };
  const discs = (Object.keys(DISCS_OF) as (keyof Scope)[]).filter((k) => scope[k]).flatMap((k) => DISCS_OF[k]);
  const show = (x: Disc) => discs.includes(x) && !hidden.includes(x);
  const selItem = sel?.kind === 'item' ? items.find((x) => x.id === sel.id) : undefined;
  const selRoute = sel?.kind === 'route' ? routes.find((x) => x.id === sel.id) : undefined;
  const kindOptions = Object.entries(KINDS)
    .filter(([k]) => scope[scopeOf(k)])
    .map(([k, v]) => ({ value: k, label: `${DISC[v.d].name.split(' (')[0]} – ${v.name}` }));
  const boqName = (b?: Boq) => (b ? `${b.item_no ?? ''} ${b.description}`.trim() : '—');
  const actName = (a?: Act) => (a ? `${a.code} ${a.name}` : '—');

  const run = (fn: () => Promise<unknown>, ok?: string) => dialog.run(async () => {
    await fn();
    await reload();
  }, ok);

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
                        await run(() => rpc('drawing_item_status', { p_id: it.id, p_status: s, p_note: note }), `${stepLabel(it.kind, s, d.lms)} – recorded with your name and time`);
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
                  void run(() => rpc('drawing_item_checks', { p_id: it.id, p_checks: { ...emptyChecks(it.kind), ...it.checks, [c]: v }, p_readings: null }));
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
                  if (v) await run(() => rpc('drawing_item_checks', { p_id: it.id, p_checks: null, p_readings: { ...it.readings, ...v } }), 'Readings saved');
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
                        await run(() => rpc('drawing_route_progress', { p_id: r.id, p_status: s, p_laid: null, p_note: note }), 'Updated');
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
                <Chip key={v} label={`${v}%`} on={r.laid === v} onPress={() => run(() => rpc('drawing_route_progress', { p_id: r.id, p_status: v > 0 && r.status === 'planned' ? 'laid' : r.status, p_laid: v, p_note: null }), `${v}% laid`)} />
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
        {history((e) => e.route_id === r.id)}
      </View>
    );
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
                      ],
                    },
                    { key: 'lms', label: 'Lighting control system', type: 'select', initial: d.lms, options: Object.keys(LMS_SYSTEMS).map((k) => ({ value: k, label: k })), when: { key: 'scope', in: ['lms'] } },
                  ],
                });
                if (!v) return;
                const sc = Object.fromEntries(v.scope.split(',').filter(Boolean).map((k) => [k, true]));
                await run(() => rpc('drawing_save', { p: { id: d.id, title: v.title, sheet_no: v.sheet_no, floor: v.floor, revision: v.revision, scope: sc, lms: v.lms || d.lms } }), 'Saved');
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
            <Button
              small
              variant="secondary"
              title="Archive"
              onPress={async () => {
                if (await dialog.confirm('Archive this drawing?', 'It stays readable; its items stop counting in the BOQ and programme figures.', { confirmLabel: 'Archive' }))
                  await run(() => rpc('drawing_archive', { p_id: d.id, p_archived: true }), 'Archived');
              }}
            />
          </Row>
        ) : null}
        {history(() => true)}
      </View>
    );
  };

  const panel = (
    <Card style={{ gap: 10 }}>{selItem ? itemPanel(selItem) : selRoute ? routePanel(selRoute) : summary()}</Card>
  );

  return (
    <Screen maxWidth={1500}>
      <Stack.Screen options={{ title: `${d.sheet_no ? `${d.sheet_no} · ` : ''}${d.title}` }} />
      <TestingBanner what="Smart drawings" show />
      <Card style={{ gap: 8 }}>
        <Muted>{`${data.project ? `${data.project.code ?? ''} ${data.project.name} · ` : ''}${d.floor ? `${d.floor} · ` : ''}${d.revision ? `rev ${d.revision}` : ''}${d.archived ? ' · archived' : ''}`}</Muted>
        <Row wrap gap={8}>
          <Segmented<StageLayer> value={layer} onChange={setLayer} options={[{ value: 'progress', label: 'Installation progress' }, { value: 'services', label: 'Services' }]} />
          <Button small variant="secondary" title="−" onPress={() => setZoom((z) => Math.max(1, z - 0.5))} />
          <Muted>{`${Math.round(zoom * 100)}%`}</Muted>
          <Button small variant="secondary" title="+" onPress={() => setZoom((z) => Math.min(4, z + 0.5))} />
        </Row>
        <Row wrap gap={6}>
          {discs.map((x) => (
            <Chip key={x} label={DISC[x].name} on={!hidden.includes(x)} onPress={() => setHidden((h) => (h.includes(x) ? h.filter((y) => y !== x) : [...h, x]))} />
          ))}
        </Row>
        {canEdit ? (
          <Row wrap gap={8}>
            <View style={{ minWidth: 260, flexGrow: 1, maxWidth: 420 }}>
              <Select label="Item to place" value={addKind} options={kindOptions} onChange={(v) => setAddKind(v)} searchable />
            </View>
            <Button small variant={mode === 'item' ? 'primary' : 'secondary'} title={mode === 'item' ? 'Done placing' : '+ Item'} onPress={() => { setDraft(null); setMode(mode === 'item' ? null : 'item'); }} />
            <Button small variant={mode === 'route' ? 'primary' : 'secondary'} title="+ Route" onPress={() => { setSel(null); setDraft(mode === 'route' ? null : []); setMode(mode === 'route' ? null : 'route'); }} />
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
            draft={draft}
            zoom={zoom}
            onTap={onTap}
            onItem={(it) => {
              if (mode === 'route' || mode === 'scale') return;
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
