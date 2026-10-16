import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog, type PromptField } from '@/components/dialog';
import { XSection } from '@/components/drawing/XSection';
import { DRAWING_EDIT_ROLES } from '@/components/exec/DrawingsTab';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, Empty, ErrorBanner, KeyValue, Loading, Muted, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CABLE_STEPS, CONT_STEPS, isCont, ROUTES, routeOf, STATUS_COLOR, type DRoute, type Riser, type RiserRun } from '@/lib/drawings';
import { fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Sheet = { id: string; title: string; floor: string | null; level_no: number | null };
const UPDATE_ROLES = [...DRAWING_EDIT_ROLES, 'trainee', 'sub_supervisor'];

/**
 * Risers of a project: one riser passes through several floors; its vertical cable and containment runs are kept once, with the
 * length from the floor height, their stages and metres laid, the BOQ / programme links and the fill of the riser containment.
 */
export default function RisersScreen() {
  const { exec } = useLocalSearchParams<{ exec: string }>();
  const me = useMe();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [pj, rs, rr, sh, pts, bq, ac] = await Promise.all([
      supabase.from('exec_projects').select('id, code, name').eq('id', exec).maybeSingle(),
      supabase.from('exec_drawing_risers').select('*').eq('exec_project_id', exec).order('name'),
      supabase.from('exec_drawing_riser_runs').select('*').eq('exec_project_id', exec).order('from_level'),
      supabase.from('exec_drawings').select('id, title, floor, level_no').eq('exec_project_id', exec).eq('archived', false),
      supabase.from('exec_drawing_items').select('id, drawing_id, riser_id').eq('exec_project_id', exec).eq('kind', 'riser'),
      supabase.from('exec_boq_items').select('id, item_no, description').eq('exec_project_id', exec).eq('heading', false).eq('removed', false).order('seq'),
      supabase.from('exec_activities').select('id, code, name').eq('exec_project_id', exec).order('code'),
    ]);
    if (rs.error) throw new Error(rs.error.message);
    return {
      project: pj.data as { code: string | null; name: string } | null,
      risers: (rs.data ?? []) as Riser[],
      runs: (rr.data ?? []) as RiserRun[],
      sheets: (sh.data ?? []) as Sheet[],
      points: (pts.data ?? []) as { id: string; drawing_id: string; riser_id: string | null }[],
      boq: (bq.data ?? []) as { id: string; item_no: string | null; description: string }[],
      acts: (ac.data ?? []) as { id: string; code: string; name: string }[],
    };
  }, [exec]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const canEdit = DRAWING_EDIT_ROLES.includes(me.role);
  const canUpdate = UPDATE_ROLES.includes(me.role);
  const levelName = (lv: number) => {
    const s = data.sheets.find((x) => x.level_no != null && Number(x.level_no) === Number(lv) && x.floor);
    return s?.floor ?? (Number(lv) === 0 ? 'Ground' : Number(lv) < 0 ? `Basement ${-lv}` : `Level ${lv}`);
  };
  const run = (fn: () => Promise<unknown>, ok?: string) =>
    dialog.run(async () => {
      await fn();
      await reload();
    }, ok);
  const metres = (rs: Riser, r: RiserRun) => Math.abs(Number(r.to_level) - Number(r.from_level)) * Number(rs.floor_height_m);

  const runFields = (r?: RiserRun): PromptField[] => {
    const cableKinds = Object.keys(ROUTES).filter((k) => !isCont(k));
    return [
      { key: 'kind', label: 'What runs in the riser', type: 'select', required: true, initial: r?.kind ?? 'pw', options: Object.entries(ROUTES).map(([k, v]) => ({ value: k, label: `${v.d === 'cont' ? 'Containment' : 'Cable'} – ${v.name}` })) },
      { key: 'label', label: 'Description (e.g. Sub-main to DB-L3)', initial: r?.label ?? '' },
      { key: 'from', label: 'From floor (order number: −1, 0, 1 …)', required: true, initial: r ? String(r.from_level) : '0' },
      { key: 'to', label: 'To floor (order number)', required: true, initial: r ? String(r.to_level) : '' },
      { key: 'cores', label: 'Number of cables in the run', initial: String(r?.cores ?? 1), when: { key: 'kind', in: cableKinds } },
      { key: 'dia', label: 'Outside diameter of one cable (mm)', initial: r?.area ? String(Math.round(Math.sqrt((4 * Number(r.area)) / Math.PI) * 10) / 10) : '', when: { key: 'kind', in: cableKinds } },
      ...(data.boq.length ? [{ key: 'boq', label: 'BOQ line', type: 'select' as const, searchable: true, initial: r?.boq_item_id ?? '', options: [{ value: '', label: '— none' }, ...data.boq.map((b) => ({ value: b.id, label: `${b.item_no ?? ''} ${b.description}`.trim() }))] }] : []),
      { key: 'act', label: 'Programme activity', type: 'select', searchable: true, initial: r?.activity_id ?? '', options: [{ value: '', label: '— none' }, ...data.acts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))] },
    ];
  };
  const runPayload = (v: Record<string, string>) => {
    const dia = Number(v.dia);
    return {
      kind: v.kind,
      label: v.label,
      from_level: v.from,
      to_level: v.to,
      cores: isCont(v.kind) ? null : v.cores || null,
      area: !isCont(v.kind) && dia > 0 ? Math.round(((Math.PI * dia * dia) / 4) * 10) / 10 : null,
      ...(data.boq.length ? { boq_item_id: v.boq || null } : {}),
      activity_id: v.act || null,
    };
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Risers' }} />
      <TestingBanner what="Smart drawings" show />
      <Card style={{ gap: 6 }}>
        <Muted>{data.project ? `${data.project.code ?? ''} ${data.project.name}` : ''}</Muted>
        <Muted>
          A riser goes up through the floors. Mark its point on each floor&apos;s drawing (item “Riser”) and link it here; the vertical cables and containment
          in it are kept once, with their length from the floor height, so the metres and the fill are right for the whole building.
        </Muted>
        {canEdit ? (
          <Row>
            <Button
              title="Add a riser"
              onPress={async () => {
                const v = await dialog.prompt({
                  title: 'Add a riser',
                  fields: [
                    { key: 'name', label: 'Name (e.g. Riser R1 – east core)', required: true },
                    { key: 'h', label: 'Floor-to-floor height (m)', required: true, initial: '3.5' },
                  ],
                });
                if (v) await run(() => rpc('drawing_riser_save', { p: { exec_project_id: exec, name: v.name, floor_height_m: v.h } }), 'Riser added');
              }}
            />
          </Row>
        ) : null}
      </Card>
      {data.risers.length ? (
        data.risers.map((rs) => {
          const runs = data.runs.filter((r) => r.riser_id === rs.id);
          const floorsAt = data.points
            .filter((p) => p.riser_id === rs.id)
            .map((p) => data.sheets.find((s) => s.id === p.drawing_id))
            .filter(Boolean)
            .map((s) => s!.floor ?? s!.title);
          const conts = runs.filter((r) => isCont(r.kind)), cables = runs.filter((r) => !isCont(r.kind));
          return (
            <Section
              key={rs.id}
              title={rs.name}
              right={
                canEdit ? (
                  <Row gap={6}>
                    <Button
                      small
                      variant="secondary"
                      title="Edit"
                      onPress={async () => {
                        const v = await dialog.prompt({
                          title: rs.name,
                          fields: [
                            { key: 'name', label: 'Name', required: true, initial: rs.name },
                            { key: 'h', label: 'Floor-to-floor height (m)', required: true, initial: String(rs.floor_height_m) },
                          ],
                        });
                        if (v) await run(() => rpc('drawing_riser_save', { p: { id: rs.id, name: v.name, floor_height_m: v.h } }), 'Saved');
                      }}
                    />
                    <Button
                      small
                      variant="secondary"
                      title="Remove"
                      onPress={async () => {
                        if (await dialog.confirm(`Remove ${rs.name}?`, 'Its runs are removed; the riser points on the drawings stay, unlinked.', { danger: true, confirmLabel: 'Remove' }))
                          await run(() => rpc('drawing_riser_delete', { p_id: rs.id }), 'Removed');
                      }}
                    />
                  </Row>
                ) : undefined
              }
            >
              <Card style={{ gap: 10 }}>
                <KeyValue label="Floor height" value={`${fmtNumber(Number(rs.floor_height_m), 2)} m`} />
                <KeyValue label="Marked on" value={floorsAt.length ? floorsAt.join(', ') : 'No drawing yet – place a “Riser” item on each floor and link it'} />
                {conts.map((c) => {
                  // cables whose floors overlap the containment's
                  const lo = Math.min(Number(c.from_level), Number(c.to_level)), hi = Math.max(Number(c.from_level), Number(c.to_level));
                  const inside = cables.filter((x) => Math.min(Number(x.from_level), Number(x.to_level)) < hi && Math.max(Number(x.from_level), Number(x.to_level)) > lo);
                  return (
                    <View key={c.id} style={{ gap: 4 }}>
                      <Text style={{ fontWeight: '700', color: colors.ink }}>{`${routeOf(c.kind).name} · ${levelName(c.from_level)} → ${levelName(c.to_level)}`}</Text>
                      <XSection cont={c as unknown as DRoute} cables={inside as unknown as DRoute[]} />
                    </View>
                  );
                })}
                {runs.length ? (
                  runs.map((r) => {
                    const cont = isCont(r.kind), m = metres(rs, r), total = cont ? m : m * (r.cores ?? 1);
                    const steps = cont ? CONT_STEPS : CABLE_STEPS;
                    return (
                      <View key={r.id} style={{ gap: 4, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line }}>
                        <Row style={{ justifyContent: 'space-between' }} wrap>
                          <Text style={{ color: colors.ink, fontWeight: '600', flexShrink: 1 }}>{`${routeOf(r.kind).name}${r.label ? ` – ${r.label}` : ''}`}</Text>
                          <Pill label={steps.find((s) => s[0] === r.status)?.[1] ?? r.status} tone={STATUS_COLOR[r.status]} />
                        </Row>
                        <Muted>
                          {`${levelName(r.from_level)} → ${levelName(r.to_level)} · ${fmtNumber(m, 1)} m${!cont && (r.cores ?? 1) > 1 ? ` × ${r.cores} cables = ${fmtNumber(total, 0)} m` : ''}${!cont ? ` · ${r.laid}% laid` : ''}${
                            r.boq_item_id ? ` · BOQ ${data.boq.find((b) => b.id === r.boq_item_id)?.item_no ?? ''}` : ''
                          }${r.status === 'failed' && r.note ? ` · ${r.note}` : ''}`}
                        </Muted>
                        {canUpdate ? (
                          <Row wrap gap={6}>
                            {steps.map(([s, t]) => (
                              <Chip
                                key={s}
                                label={t}
                                tone={r.status === s ? STATUS_COLOR[s] : undefined}
                                onPress={
                                  r.status === s
                                    ? undefined
                                    : async () => {
                                        let note: string | null = null;
                                        if (s === 'failed') {
                                          const v = await dialog.prompt({ title: 'What failed?', fields: [{ key: 'n', label: 'Fault', type: 'multiline', required: true }] });
                                          if (!v) return;
                                          note = v.n;
                                        }
                                        await run(() => rpc('drawing_riser_run_progress', { p_id: r.id, p_status: s, p_laid: null, p_note: note }), 'Updated');
                                      }
                                }
                              />
                            ))}
                          </Row>
                        ) : null}
                        {canUpdate && !cont ? (
                          <Row wrap gap={6}>
                            <Muted>Laid:</Muted>
                            {[0, 25, 50, 75, 100].map((v) => (
                              <Chip key={v} label={`${v}%`} on={r.laid === v} onPress={() => run(() => rpc('drawing_riser_run_progress', { p_id: r.id, p_status: v > 0 && r.status === 'planned' ? 'laid' : r.status, p_laid: v, p_note: null }), `${v}% laid`)} />
                            ))}
                          </Row>
                        ) : null}
                        {canEdit ? (
                          <Row wrap gap={6}>
                            <Chip
                              label="Edit"
                              onPress={async () => {
                                const v = await dialog.prompt({ title: 'Riser run', fields: runFields(r) });
                                if (v) await run(() => rpc('drawing_riser_run_save', { p: { id: r.id, ...runPayload(v) } }), 'Saved');
                              }}
                            />
                            <Chip
                              label="Remove"
                              onPress={async () => {
                                if (await dialog.confirm('Remove this run?', undefined, { danger: true, confirmLabel: 'Remove' })) await run(() => rpc('drawing_riser_run_delete', { p_id: r.id }), 'Removed');
                              }}
                            />
                          </Row>
                        ) : null}
                      </View>
                    );
                  })
                ) : (
                  <Muted>No runs yet.</Muted>
                )}
                {canEdit ? (
                  <Row>
                    <Button
                      small
                      variant="secondary"
                      title="+ Run in this riser"
                      onPress={async () => {
                        const v = await dialog.prompt({ title: `New run – ${rs.name}`, message: `Floors by their order number: ${[...new Set(data.sheets.filter((s) => s.level_no != null).map((s) => `${s.level_no} = ${s.floor ?? s.title}`))].join(', ') || 'set the floor order on the drawings'}.`, fields: runFields() });
                        if (v) await run(() => rpc('drawing_riser_run_save', { p: { riser_id: rs.id, ...runPayload(v) } }), 'Run added');
                      }}
                    />
                  </Row>
                ) : null}
              </Card>
            </Section>
          );
        })
      ) : (
        <Empty title="No risers yet" hint={canEdit ? 'Add the building’s risers, then mark each one on the floor drawings.' : undefined} />
      )}
    </Screen>
  );
}
