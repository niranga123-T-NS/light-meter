import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Grid, KeyValue, ListRow, Loading, Muted, Notice, Pill, Progress, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ITEM_STATUS, type ExecMember, type PlanItem } from '@/lib/execution';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { byCode, DEP_TYPES, programmeRows, RES_KINDS, RES_PRESETS, type Activity, type ResKind, type Dep, type Programme, type Resource, type Wbs } from '@/lib/programme';
import { rpc, supabase } from '@/lib/supabase';

const depLabel = (d: Dep) => `${d.dep_type}${d.lag ? ` ${d.lag > 0 ? '+' : ''}${d.lag} d` : ''}`;

/** One programme activity: details, links (predecessors / successors), resources and progress. */
export default function ActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: a, error: e } = await supabase.from('exec_activities').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const act = a as Activity;
    const [all, w, d, r, pg, m, pj] = await Promise.all([
      supabase.from('exec_activities').select('*').eq('exec_project_id', act.exec_project_id),
      supabase.from('exec_wbs').select('*').eq('exec_project_id', act.exec_project_id),
      supabase.from('exec_activity_deps').select('*').or(`pred_id.eq.${id},succ_id.eq.${id}`),
      supabase.from('exec_activity_resources').select('*').eq('activity_id', id),
      supabase.from('exec_programmes').select('*').eq('exec_project_id', act.exec_project_id).single(),
      supabase.from('exec_members').select('*').eq('exec_project_id', act.exec_project_id).eq('active', true),
      supabase.from('exec_projects').select('name, status').eq('id', act.exec_project_id).single(),
    ]);
    const ids = ((all.data ?? []) as Activity[]).map((x) => x.id);
    const { data: used } = ids.length ? await supabase.from('exec_activity_resources').select('kind, name, unit').in('activity_id', ids) : { data: [] };
    const { data: items } = await supabase.from('exec_plan_items').select('*').eq('activity_id', id).order('day', { ascending: false });
    return {
      a: act,
      all: (all.data ?? []) as Activity[],
      wbs: (w.data ?? []) as Wbs[],
      deps: (d.data ?? []) as Dep[],
      res: (r.data ?? []) as Resource[],
      pg: pg.data as Programme,
      members: (m.data ?? []) as ExecMember[],
      project: pj.data as { name: string; status: string } | null,
      items: (items ?? []) as PlanItem[],
      used: (used ?? []) as Pick<Resource, 'kind' | 'name' | 'unit'>[],
    };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { a, all, wbs, deps, res, pg, members } = data;
  const name = (x: string) => {
    const o = all.find((y) => y.id === x);
    return o ? `${o.code} ${o.name}` : '—';
  };
  const canEdit = me.role === 'senior_elec_engineer' && pg.status === 'draft' && data.project?.status === 'active';
  const canProgress = (me.role === 'senior_elec_engineer' || (me.role === 'assistant_engineer' && members.some((m) => m.user_id === me.id))) && pg.version > 0;
  const preds = deps.filter((d) => d.succ_id === a.id);
  const succs = deps.filter((d) => d.pred_id === a.id);
  const engineers = [
    ...Object.values(people).filter((x) => x.role === 'senior_elec_engineer' && x.active).map((x) => ({ value: x.id, label: `${x.full_name} · SEE` })),
    ...members.filter((m) => m.member_role !== 'sub_supervisor').map((m) => ({ value: m.user_id, label: people[m.user_id]?.full_name ?? '—' })),
  ];
  const wbsOptions = programmeRows(wbs, [])
    .filter((r) => r.kind === 'wbs')
    .map((r) => (r.kind === 'wbs' ? { value: r.wbs.id, label: `${'  '.repeat(r.depth)}${r.wbs.code}  ${r.wbs.name}` } : { value: '', label: '' }));

  const edit = async () => {
    const r = await dialog.prompt({
      title: `Edit ${a.code}`,
      message: pg.version ? 'Changing the approved programme starts a revision – SM Projects approves the new baseline.' : undefined,
      fields: [
        { key: 'wbs_id', label: 'WBS element', type: 'select', required: true, options: wbsOptions, initial: a.wbs_id },
        { key: 'name', label: 'Activity', required: true, initial: a.name },
        { key: 'duration', label: 'Duration (working days, 0 = milestone)', required: true, initial: String(a.duration) },
        { key: 'responsible_id', label: 'Responsible engineer', type: 'select', options: engineers, initial: a.responsible_id ?? undefined },
        { key: 'subcontractor', label: 'Subcontractor', initial: a.subcontractor ?? '' },
        { key: 'qty', label: 'Quantity', initial: a.qty != null ? String(a.qty) : '' },
        { key: 'unit', label: 'Unit', initial: a.unit ?? '' },
        { key: 'not_before', label: 'Not before', type: 'date', initial: a.not_before ?? undefined },
      ],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('save_activity', { p_exec: a.exec_project_id, p_id: a.id, p: r }); await reload(); }, 'Saved – dates recalculated');
  };
  const del = async () => {
    if (await dialog.confirm(`Delete ${a.code}?`, 'Its links and resources are deleted too.', { danger: true, confirmLabel: 'Delete' }))
      await dialog.run(async () => { await rpc('delete_activity', { p_id: a.id }); router.back(); }, 'Deleted');
  };
  // Any link change recalculates the whole programme; the toast says how many activities moved and the new finish
  const relink = (fn: () => Promise<unknown>, what: string) =>
    dialog.run(async () => {
      const before = new Map(all.map((x) => [x.id, `${x.es}|${x.ef}`]));
      const finishBefore = all.reduce((m, x) => (x.ef && x.ef > m ? x.ef : m), '');
      await fn();
      const { data: after } = await supabase.from('exec_activities').select('id, es, ef').eq('exec_project_id', a.exec_project_id);
      const rows = (after ?? []) as Pick<Activity, 'id' | 'es' | 'ef'>[];
      const moved = rows.filter((x) => before.has(x.id) && before.get(x.id) !== `${x.es}|${x.ef}`).length;
      const finish = rows.reduce((m, x) => (x.ef && x.ef > m ? x.ef : m), '');
      await reload();
      dialog.toast(`${what} – ${moved ? `${moved} ${moved === 1 ? 'activity' : 'activities'} rescheduled` : 'no dates changed'}${finish && finish !== finishBefore ? ` · project finish now ${fmtDate(finish)}` : ''}`);
    });
  const linkFields = (t = 'FS', l = 0) => [
    { key: 't', label: 'Link', type: 'select' as const, required: true, options: DEP_TYPES, initial: t },
    { key: 'l', label: 'Lag in working days (negative = lead)', initial: String(l) },
  ];
  const others = [...all].filter((x) => x.id !== a.id).sort(byCode).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` }));
  const addPred = async () => {
    const r = await dialog.prompt({ title: 'Predecessor', message: `${a.code} depends on:`, fields: [{ key: 'p', label: 'Activity', type: 'select', required: true, options: others }, ...linkFields()], confirmLabel: 'Link' });
    if (r) await relink(() => rpc('set_dependency', { p_succ: a.id, p_pred: r.p, p_type: r.t, p_lag: Number(r.l || 0) }), 'Linked');
  };
  const addSucc = async () => {
    const r = await dialog.prompt({ title: 'Successor', message: `Follows ${a.code}:`, fields: [{ key: 's', label: 'Activity', type: 'select', required: true, options: others }, ...linkFields()], confirmLabel: 'Link' });
    if (r) await relink(() => rpc('set_dependency', { p_succ: r.s, p_pred: a.id, p_type: r.t, p_lag: Number(r.l || 0) }), 'Linked');
  };
  const editDep = async (d: Dep) => {
    const r = await dialog.prompt({ title: 'Change the link', message: `${name(d.pred_id)} → ${name(d.succ_id)}`, fields: linkFields(d.dep_type, d.lag), confirmLabel: 'Save' });
    if (r) await relink(() => rpc('set_dependency', { p_succ: d.succ_id, p_pred: d.pred_id, p_type: r.t, p_lag: Number(r.l || 0) }), 'Link changed');
  };
  const removeDep = async (d: Dep) => {
    if (await dialog.confirm('Remove this link?', `${name(d.pred_id)} → ${name(d.succ_id)}. The dates of the following activities are recalculated.`, { danger: true, confirmLabel: 'Remove' }))
      await relink(() => rpc('remove_dependency', { p_id: d.id }), 'Link removed');
  };
  const depRight = (d: Dep) => (
    <Row gap={4} style={{ alignItems: 'center' }}>
      <Pill label={depLabel(d)} />
      {canEdit ? <Button small variant="secondary" title="Edit" onPress={() => editDep(d)} /> : null}
      {canEdit ? <Button small variant="ghost" title="✕" onPress={() => removeDep(d)} /> : null}
    </Row>
  );
  const resource = async (x?: Resource) => {
    // One list: resources already used on this project first, then the usual ones by type, each type with its own "type the name" choice
    const kindLabel = (k: string) => RES_KINDS.find((y) => y.value === k)?.label ?? k;
    const presetKey = (k: string, n: string) => `${k}:${n}`;
    const known = new Set<string>();
    const opts: { value: string; label: string; group: string }[] = [];
    const add = (k: string, n: string, group: string) => {
      const key = n.trim().toLowerCase();
      if (known.has(key)) return;
      known.add(key);
      opts.push({ value: presetKey(k, n), label: n, group });
    };
    data.used.filter((u) => u.kind !== 'staff').forEach((u) => add(u.kind, u.name, 'Used on this project'));
    opts.push({ value: 'staff:', label: 'DIMO staff member – choose the person below', group: 'DIMO staff' });
    for (const k of RES_KINDS) {
      if (k.value === 'staff') continue;
      (RES_PRESETS[k.value as Exclude<ResKind, 'staff'>] ?? []).forEach(([n]) => add(k.value, n, k.label));
      opts.push({ value: presetKey(k.value, '*'), label: k.value === 'other' ? 'Custom resource – type the name below' : `Other – type the name below`, group: k.label });
    }
    const initial = !x ? undefined : x.kind === 'staff' ? 'staff:' : opts.find((o) => o.value === presetKey(x.kind, x.name)) ? presetKey(x.kind, x.name) : presetKey(x.kind, '*');
    const r = await dialog.prompt({
      title: x ? x.name : 'Resource',
      message: 'Pick a resource from the list – or “Other – type the name below” under the right type for anything not listed – with the quantity needed on this activity.',
      fields: [
        { key: 'res', label: 'Resource', type: 'select', required: true, options: opts, initial },
        { key: 'profile_id', label: 'DIMO staff member (for DIMO staff)', type: 'select', options: engineers, initial: x?.profile_id ?? undefined },
        { key: 'name', label: 'Name (for “Other” / custom)', initial: x && initial?.endsWith(':*') ? x.name : '' },
        { key: 'qty', label: 'Quantity', required: true, initial: x ? String(x.qty) : '1' },
        { key: 'unit', label: 'Unit (e.g. workers, nos – blank = the usual unit)', initial: x?.unit ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    const [kind, ...rest] = r.res.split(':');
    const picked = rest.join(':');
    const name = kind === 'staff' ? '' : picked === '*' ? r.name.trim() : picked;
    const usual =
      (RES_PRESETS[kind as Exclude<ResKind, 'staff'>] ?? []).find(([n]) => n === picked)?.[1] ??
      data.used.find((u) => u.kind === kind && u.name === picked)?.unit ??
      (kind === 'staff' ? 'nos' : '');
    await dialog.run(async () => {
      if (kind === 'staff' && !r.profile_id) throw new Error('Choose the DIMO staff member');
      if (kind !== 'staff' && !name) throw new Error(`Type the name of the ${kindLabel(kind).toLowerCase()} resource`);
      await rpc('save_activity_resource', {
        p_activity: a.id,
        p_id: x?.id ?? null,
        p: { kind, profile_id: kind === 'staff' ? r.profile_id : null, name, qty: r.qty, unit: r.unit.trim() || usual },
      });
      await reload();
    }, 'Saved');
  };
  const removeRes = (x: Resource) => dialog.run(async () => { await rpc('delete_activity_resource', { p_id: x.id }); await reload(); }, 'Removed');
  const progress = async () => {
    const r = await dialog.prompt({
      title: `Progress – ${a.code}`,
      fields: [
        { key: 'pct', label: '% complete', required: true, initial: String(Math.round(Number(a.pct))) },
        { key: 's', label: 'Actual start', type: 'date', initial: a.actual_start ?? undefined },
        { key: 'f', label: 'Actual finish (sets 100%)', type: 'date', initial: a.actual_finish ?? undefined },
        { key: 'n', label: 'Note', type: 'multiline', initial: a.progress_note ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('update_activity_progress', { p_id: a.id, p_pct: Number(r.pct || 0), p_start: r.s || null, p_finish: r.f || null, p_note: r.n || null }); await reload(); }, 'Progress saved – forecast updated');
  };

  const slip = a.bl_finish && a.ef ? Math.round((Date.parse(a.ef) - Date.parse(a.bl_finish)) / 864e5) : null;
  return (
    <Screen maxWidth={900} onRefresh={reload}>
      <Stack.Screen options={{ title: a.code }} />
      <TestingBanner what="The project programme" />
      <Card style={{ borderLeftWidth: 4, borderLeftColor: a.actual_finish ? colors.green : a.critical ? colors.red : colors.blue }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{`${a.code} · ${a.name}`}</Text>
          <Row gap={4}>
            {a.duration === 0 ? <Pill label="Milestone" /> : null}
            {a.actual_finish ? <Pill label="Done" tone={colors.green} solid /> : a.critical ? <Pill label="Critical" tone={colors.red} solid /> : <Pill label={`Float ${a.total_float ?? 0} d`} tone={colors.blue} />}
          </Row>
        </Row>
        <Muted>{`${data.project?.name ?? ''} · ${wbs.find((w) => w.id === a.wbs_id)?.code ?? ''} ${wbs.find((w) => w.id === a.wbs_id)?.name ?? ''}`}</Muted>
        <Grid min={320}>
          <KeyValue label="Duration" value={a.duration ? `${a.duration} working days` : 'Milestone'} />
          <KeyValue label="Planned" value={`${fmtDate(a.es)} → ${fmtDate(a.ef)}`} />
          <KeyValue label="Latest (without delaying the finish)" value={`${fmtDate(a.ls)} → ${fmtDate(a.lf)}`} />
          {a.bl_start ? <KeyValue label="Baseline" value={`${fmtDate(a.bl_start)} → ${fmtDate(a.bl_finish)}${slip ? ` (${slip > 0 ? '+' : ''}${slip} d)` : ''}`} /> : null}
          <KeyValue label="Responsible" value={a.responsible_id ? people[a.responsible_id]?.full_name ?? '—' : '—'} />
          {a.subcontractor ? <KeyValue label="Subcontractor" value={a.subcontractor} /> : null}
          {a.qty != null ? <KeyValue label="Quantity" value={`${a.qty} ${a.unit ?? ''}`} /> : null}
          {a.not_before ? <KeyValue label="Not before" value={fmtDate(a.not_before)} /> : null}
        </Grid>
        {a.bl_start && !a.actual_start && a.bl_start < todayISO() ? <Notice tone={colors.red}>{`Should have started on ${fmtDate(a.bl_start)} (baseline)`}</Notice> : null}
        {canEdit ? (
          <Row wrap gap={6} style={{ marginTop: 8 }}>
            <Button small variant="secondary" title="Edit" onPress={edit} />
            {!a.actual_start ? <Button small variant="ghost" title="Delete" onPress={del} /> : null}
          </Row>
        ) : null}
      </Card>

      <Section title="Progress" right={canProgress ? <Button small title="Update progress" onPress={progress} /> : null}>
        <Card>
          <Progress pct={Number(a.pct)} colour={a.actual_finish ? colors.green : a.critical ? colors.red : colors.blue} />
          <KeyValue label="Complete" value={`${Math.round(Number(a.pct))}%`} />
          <KeyValue label="Actual" value={a.actual_start ? `${fmtDate(a.actual_start)} → ${a.actual_finish ? fmtDate(a.actual_finish) : 'in progress'}` : 'Not started'} />
          {a.progress_at ? <Muted>{`${people[a.progress_by ?? '']?.full_name ?? ''} · ${fmtDateTime(a.progress_at)}${a.progress_note ? ` · ${a.progress_note}` : ''}`}</Muted> : null}
          {a.pct_auto != null ? (
            <Muted>{`From the site results: ${Math.round(Number(a.pct_auto))}%${a.qty ? ` (quantities)` : ' (working days done)'} – updated automatically; the engineer corrects it with Update progress.`}</Muted>
          ) : null}
          {!pg.version ? <Muted>Progress is entered once SM Projects approves the programme.</Muted> : null}
        </Card>
      </Section>

      {data.items.length ? (
        <Section title={`Site results (${data.items.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.items.map((i) => (
              <ListRow
                key={i.id}
                wrapRight
                highlight={i.status === 'not_done' ? colors.red : undefined}
                title={`${fmtDate(i.day)} · ${i.title}`}
                subtitle={[i.zone, i.qty != null ? `${i.done_qty != null ? `${i.done_qty} / ` : ''}${i.qty} ${i.unit ?? ''}` : null, i.supervisor_id ? people[i.supervisor_id]?.full_name : null, i.result_note]
                  .filter(Boolean)
                  .join(' · ')}
                right={<Pill label={ITEM_STATUS[i.status]} tone={i.status === 'done' ? colors.green : i.status === 'partial' ? colors.amber : i.status === 'not_done' ? colors.red : colors.grey} />}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title={`Predecessors (${preds.length})`} right={canEdit ? <Button small variant="secondary" title="+ Predecessor" onPress={addPred} /> : null}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {preds.map((d) => (
            <ListRow key={d.id} title={name(d.pred_id)} subtitle={DEP_TYPES.find((t) => t.value === d.dep_type)?.label} onPress={() => router.push(`/execution/activity/${d.pred_id}`)}
              right={depRight(d)} />
          ))}
          {!preds.length ? <Muted style={{ padding: 12 }}>{'Starts at the programme start (or its "not before" date)'}</Muted> : null}
        </Card>
      </Section>
      <Section title={`Successors (${succs.length})`} right={canEdit ? <Button small variant="secondary" title="+ Successor" onPress={addSucc} /> : null}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {succs.map((d) => (
            <ListRow key={d.id} title={name(d.succ_id)} subtitle={DEP_TYPES.find((t) => t.value === d.dep_type)?.label} onPress={() => router.push(`/execution/activity/${d.succ_id}`)} right={depRight(d)} />
          ))}
          {!succs.length ? <Muted style={{ padding: 12 }}>Nothing follows this activity</Muted> : null}
        </Card>
      </Section>

      <Section title={`Resources (${res.length})`} right={canEdit ? <Button small variant="secondary" title="+ Resource" onPress={() => resource()} /> : null}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {res.map((x) => (
            <ListRow
              key={x.id}
              onPress={canEdit ? () => resource(x) : undefined}
              title={x.name}
              subtitle={RES_KINDS.find((k) => k.value === x.kind)?.label}
              right={
                <Row gap={4}>
                  <Pill label={`${x.qty} ${x.unit ?? ''}`.trim()} />
                  {canEdit ? <Button small variant="secondary" title="Edit" onPress={() => resource(x)} /> : null}
                  {canEdit ? <Button small variant="ghost" title="✕" onPress={() => removeRes(x)} /> : null}
                </Row>
              }
            />
          ))}
          {!canEdit && me.role === 'senior_elec_engineer' && pg.status !== 'draft' ? (
            <Muted style={{ padding: 12 }}>The programme is submitted – to change resources, ask SM Projects for permission to edit (Programme tab → Ask to edit).</Muted>
          ) : null}
          {!res.length ? <Muted style={{ padding: 12 }}>{a.duration ? 'No resources yet – required before the programme can be submitted' : 'Milestones need no resources'}</Muted> : null}
        </Card>
      </Section>
    </Screen>
  );
}
