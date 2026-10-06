import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, Grid, ListRow, Muted, Notice, Pill, Row, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecMember, ExecProject } from '@/lib/execution';
import { fmtDate, fmtNumber, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { byCode, PROG_STATUS, programmeRows, toDay, weeklyLoading, type Activity, type Dep, type Programme, type Resource, type Wbs } from '@/lib/programme';
import { rpc, supabase } from '@/lib/supabase';
import { Gantt, ganttLegend } from './Gantt';

/** The project programme: built by the SEE (WBS, activities, links, resources), approved by SM Projects, progressed by the AEs. */
export function ProgrammeTab({ p, onChange }: { p: ExecProject; onChange: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [view, setView] = useState<'gantt' | 'list' | 'resources'>('gantt');
  const [scale, setScale] = useState<'day' | 'week' | 'month'>('week');
  const { data, reload } = useLoad(async () => {
    const [pg, w, a, m] = await Promise.all([
      supabase.from('exec_programmes').select('*').eq('exec_project_id', p.id).maybeSingle(),
      supabase.from('exec_wbs').select('*').eq('exec_project_id', p.id),
      supabase.from('exec_activities').select('*').eq('exec_project_id', p.id),
      supabase.from('exec_members').select('*').eq('exec_project_id', p.id).eq('active', true),
    ]);
    const acts = (a.data ?? []) as Activity[];
    const ids = acts.map((x) => x.id);
    const [d, r] = ids.length
      ? await Promise.all([supabase.from('exec_activity_deps').select('*').in('succ_id', ids), supabase.from('exec_activity_resources').select('*').in('activity_id', ids)])
      : [{ data: [] }, { data: [] }];
    return {
      pg: pg.data as Programme | null,
      wbs: (w.data ?? []) as Wbs[],
      acts,
      deps: (d.data ?? []) as Dep[],
      res: (r.data ?? []) as Resource[],
      members: (m.data ?? []) as ExecMember[],
    };
  }, [p.id]);
  if (!data) return null;
  const { pg, wbs, acts, deps, res } = data;
  const see = me.role === 'senior_elec_engineer';
  const smp = me.role === 'sm_projects';
  const canEdit = see && p.status === 'active' && pg?.status !== 'submitted';
  const refresh = async () => {
    await reload();
    onChange();
  };
  const engineers = [
    ...Object.values(people).filter((x) => x.role === 'senior_elec_engineer' && x.active).map((x) => ({ value: x.id, label: `${x.full_name} · SEE` })),
    ...data.members.filter((m) => m.member_role !== 'sub_supervisor').map((m) => ({ value: m.user_id, label: people[m.user_id]?.full_name ?? '—' })),
  ];
  const wbsOptions = programmeRows(wbs, [])
    .filter((r) => r.kind === 'wbs')
    .map((r) => (r.kind === 'wbs' ? { value: r.wbs.id, label: `${'  '.repeat(r.depth)}${r.wbs.code}  ${r.wbs.name}` } : { value: '', label: '' }));

  const setStart = async () => {
    const r = await dialog.prompt({
      title: 'Programme start',
      message: 'The first day of work on site. All activities are scheduled on working days from this date (weekends and holidays skipped).',
      fields: [{ key: 'd', label: 'Start date', type: 'date', required: true, initial: pg?.start_date ?? p.start_date ?? todayISO() }],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('save_programme', { p_exec: p.id, p_start: r.d }); await refresh(); }, 'Saved');
  };
  const addWbs = async () => {
    const r = await dialog.prompt({
      title: 'WBS element',
      message: 'Work breakdown: e.g. 1 Civil works › 1.1 Foundations, 2 Electrical › 2.1 Cabling.',
      fields: [
        { key: 'parent', label: 'Under (leave empty for a top level element)', type: 'select', options: wbsOptions },
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
      ],
      confirmLabel: 'Add',
    });
    if (r) await dialog.run(async () => { await rpc('save_wbs', { p_exec: p.id, p_id: null, p_parent: r.parent || null, p_code: r.code, p_name: r.name }); await reload(); }, 'Added');
  };
  const addActivity = async () => {
    const r = await dialog.prompt({
      title: 'Activity',
      fields: [
        { key: 'wbs_id', label: 'WBS element', type: 'select', required: true, options: wbsOptions },
        { key: 'code', label: 'Activity code (e.g. A1010)', required: true },
        { key: 'name', label: 'Activity', required: true },
        { key: 'duration', label: 'Duration (working days, 0 = milestone)', required: true, initial: '1' },
        { key: 'responsible_id', label: 'Responsible engineer', type: 'select', options: engineers },
        { key: 'pred', label: 'Starts after (predecessor – more links on the activity page)', type: 'select', options: [...acts].sort(byCode).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })) },
        { key: 'subcontractor', label: 'Subcontractor' },
        { key: 'qty', label: 'Quantity' },
        { key: 'unit', label: 'Unit' },
        { key: 'not_before', label: 'Not before (e.g. material arrival)', type: 'date' },
      ],
      confirmLabel: 'Add',
    });
    if (!r) return;
    await dialog.run(async () => {
      const id = await rpc<string>('save_activity', { p_exec: p.id, p_id: null, p: r });
      if (r.pred) await rpc('set_dependency', { p_succ: id, p_pred: r.pred, p_type: 'FS', p_lag: 0 });
      router.push(`/execution/activity/${id}`);
    }, 'Added – allocate its resources');
  };
  const submit = async () => {
    const res2 = await dialog.prompt({
      title: pg?.version ? 'Submit the revised programme' : 'Submit the programme',
      message: 'SM Projects approves it as the baseline. Every activity needs its resources and a responsible engineer.',
      fields: [{ key: 'n', label: pg?.version ? 'Reason for the revision' : 'Note', type: 'multiline', required: !!pg?.version }],
      confirmLabel: 'Submit',
    });
    if (res2) await dialog.run(async () => { await rpc('submit_programme', { p_exec: p.id, p_note: res2.n || null }); await refresh(); }, 'Sent to SM Projects');
  };
  const decide = async (ok: boolean) => {
    const r = await dialog.prompt({
      title: ok ? 'Approve the programme' : 'Return the programme',
      message: ok ? 'The current dates become the baseline that progress is measured against.' : undefined,
      fields: [{ key: 'n', label: ok ? 'Note' : 'What to change', type: 'multiline', required: !ok }],
      confirmLabel: ok ? 'Approve' : 'Return',
      danger: !ok,
    });
    if (r) await dialog.run(async () => { await rpc('decide_programme', { p_exec: p.id, p_approve: ok, p_note: r.n || null }); await refresh(); }, ok ? 'Approved' : 'Returned');
  };

  // Build guide for the SEE: each step with its button, the Gantt chart appears from the first activity
  const noRes = acts.filter((a) => a.duration > 0 && !res.some((r) => r.activity_id === a.id)).length;
  const noEng = acts.filter((a) => a.duration > 0 && !a.responsible_id).length;
  const steps: { done: boolean; text: string; button?: { title: string; onPress: () => void } }[] = [
    { done: !!pg, text: pg ? `Start date ${fmtDate(pg.start_date)}` : 'Set the start date (first day of work on site)', button: { title: pg ? 'Change' : 'Set start date', onPress: setStart } },
    { done: wbs.length > 0, text: wbs.length ? `${wbs.length} WBS element(s)` : 'Add the WBS – the work packages (e.g. 1 Civil works, 2 Electrical works)', button: pg ? { title: '+ WBS', onPress: addWbs } : undefined },
    {
      done: acts.length > 0,
      text: acts.length ? `${acts.length} activit${acts.length === 1 ? 'y' : 'ies'} – the Gantt chart is below` : 'Add the activities under each WBS element, with duration and what each one follows – the Gantt chart appears from the first activity',
      button: wbs.length ? { title: '+ Activity', onPress: addActivity } : undefined,
    },
    {
      done: acts.length > 0 && noRes === 0,
      text: noRes ? `Allocate resources – ${noRes} activit${noRes === 1 ? 'y has' : 'ies have'} none (open the activity → + Resource)` : acts.length ? 'Resources allocated to every activity' : 'Allocate the resources of each activity (open the activity → + Resource)',
      button: noRes ? { title: 'Show list', onPress: () => setView('list') } : undefined,
    },
    { done: acts.length > 0 && noEng === 0, text: noEng ? `${noEng} activit${noEng === 1 ? 'y has' : 'ies have'} no responsible engineer (open the activity → Edit)` : acts.length ? 'Responsible engineer on every activity' : 'Give each activity its responsible engineer' },
    { done: !!pg?.version || pg?.status === 'submitted', text: pg?.status === 'submitted' ? 'Submitted – waiting for SM Projects' : pg?.version ? 'Approved by SM Projects' : 'Submit to SM Projects for approval', button: pg && pg.status === 'draft' && acts.length ? { title: pg.version ? 'Submit revision' : 'Submit', onPress: submit } : undefined },
  ];
  const guide =
    see && p.status === 'active' && (!pg || pg.status === 'draft') ? (
      <Card>
        <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 4 }}>{pg?.version ? 'Revising the programme' : 'Build the programme – step by step'}</Text>
        {steps.map((st, i) => (
          <Row key={i} wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <Text style={{ flex: 1, minWidth: 220, color: st.done ? colors.green : colors.ink }}>{`${st.done ? '✓' : `${i + 1}.`} ${st.text}`}</Text>
            {st.button ? <Button small variant={st.done ? 'secondary' : 'primary'} title={st.button.title} onPress={st.button.onPress} /> : null}
          </Row>
        ))}
      </Card>
    ) : null;

  if (!pg) {
    return (
      <Section title="Programme">
        {guide ?? (
          <Empty title="No programme yet" hint="The Senior Electrical Engineer builds the WBS, activities, links and resources; SM Projects approves it before work starts (gate 2)." />
        )}
      </Section>
    );
  }
  const today = todayISO();
  const late = pg.forecast_finish && p.end_date ? toDay(pg.forecast_finish) - toDay(p.end_date) : null;
  const slip = pg.forecast_finish && pg.baseline_finish ? toDay(pg.forecast_finish) - toDay(pg.baseline_finish) : null;
  const critical = acts.filter((a) => a.critical && !a.actual_finish);
  const behind = acts.filter((a) => a.bl_start && !a.actual_start && a.bl_start < today);
  const done = acts.length ? acts.reduce((s, a) => s + Math.max(a.duration, 1) * Number(a.pct), 0) / acts.reduce((s, a) => s + Math.max(a.duration, 1), 0) : 0;
  const statusTone = pg.status === 'approved' ? colors.green : pg.status === 'submitted' ? colors.amber : colors.grey;
  const load = weeklyLoading(acts, res);

  return (
    <>
      <Section title="Programme">
        <Card>
          <Row wrap gap={6} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Row gap={6}>
              <Pill label={PROG_STATUS[pg.status]} tone={statusTone} solid />
              {pg.version ? <Pill label={`Baseline ${pg.version}`} /> : null}
              {pg.version && pg.status === 'draft' ? <Pill label="Revision in progress" tone={colors.amber} /> : null}
            </Row>
            <Row wrap gap={6}>
              {canEdit ? <Button small variant="secondary" title="Start date" onPress={setStart} /> : null}
              {canEdit ? <Button small variant="secondary" title="+ WBS" onPress={addWbs} /> : null}
              {canEdit && wbs.length ? <Button small variant="secondary" title="+ Activity" onPress={addActivity} /> : null}
              {canEdit && pg.status === 'draft' && acts.length ? <Button small title={pg.version ? 'Submit revision' : 'Submit to SM Projects'} onPress={submit} /> : null}
              {smp && pg.status === 'submitted' ? <Button small title="Approve" onPress={() => decide(true)} /> : null}
              {smp && pg.status === 'submitted' ? <Button small variant="secondary" title="Return" onPress={() => decide(false)} /> : null}
            </Row>
          </Row>
          {pg.status === 'draft' && pg.decision_note && pg.decided_at ? <Notice tone={colors.amber}>{`Returned by SM Projects: ${pg.decision_note}`}</Notice> : null}
          {pg.status === 'submitted' && pg.submit_note ? <Notice>{pg.submit_note}</Notice> : null}
          {!pg.version ? <Muted>Work cannot commence (gate 2) until SM Projects approves the programme.</Muted> : null}
        </Card>
        {guide}
        <Grid min={150}>
          <Stat label="Start" value={fmtDate(pg.start_date)} />
          <Stat label="Forecast finish" value={fmtDate(pg.forecast_finish)} tone={late != null && late > 0 ? 'red' : undefined} />
          <Stat label={`Contract finish${late != null ? ` · ${late > 0 ? `${late} d late` : `${-late} d to spare`}` : ''}`} value={fmtDate(p.end_date)} />
          {pg.version ? <Stat label={`Baseline finish${slip ? ` · ${slip > 0 ? '+' : ''}${slip} d` : ''}`} value={fmtDate(pg.baseline_finish)} tone={slip && slip > 0 ? 'amber' : undefined} /> : null}
          <Stat label="Complete" value={`${Math.round(done)}%`} />
          <Stat label="Critical activities open" value={critical.length} />
          {pg.version ? <Stat label="Late to start (vs baseline)" value={behind.length} tone={behind.length ? 'red' : undefined} /> : null}
        </Grid>
      </Section>

      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'gantt', label: 'Gantt' },
            { value: 'list', label: 'Activities' },
            { value: 'resources', label: 'Resources' },
          ]}
        />
        {view === 'gantt' ? (
          <Segmented
            value={scale}
            onChange={setScale}
            options={[
              { value: 'day', label: 'Days' },
              { value: 'week', label: 'Weeks' },
              { value: 'month', label: 'Months' },
            ]}
          />
        ) : null}
      </Row>

      {!acts.length ? (
        <Empty title={wbs.length ? 'Add the activities' : 'Add the WBS'} hint="WBS elements first, then the activities under them, then link them and allocate the resources." />
      ) : view === 'gantt' ? (
        <>
          <Gantt wbs={wbs} acts={acts} deps={deps} scale={scale} today={today} contractEnd={p.end_date} />
          <Muted>{ganttLegend}</Muted>
        </>
      ) : view === 'list' ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {programmeRows(wbs, acts).map((r) =>
            r.kind === 'wbs' ? (
              <View key={r.wbs.id} style={{ paddingVertical: 8, paddingLeft: 12 + r.depth * 12, backgroundColor: colors.soft }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{`${r.wbs.code}  ${r.wbs.name}`}</Text>
              </View>
            ) : (
              <ListRow
                key={r.act.id}
                wrapRight
                onPress={() => router.push(`/execution/activity/${r.act.id}`)}
                highlight={r.act.critical && !r.act.actual_finish ? colors.red : undefined}
                title={`${r.act.code}  ${r.act.name}`}
                subtitle={[
                  r.act.duration ? `${r.act.duration} d` : 'milestone',
                  `${fmtDate(r.act.es)} → ${fmtDate(r.act.ef)}`,
                  r.act.total_float != null && !r.act.actual_finish ? (r.act.total_float > 0 ? `float ${r.act.total_float} d` : 'critical') : null,
                  r.act.responsible_id ? people[r.act.responsible_id]?.full_name : 'no engineer',
                  `${res.filter((x) => x.activity_id === r.act.id).length} resource(s)`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={<Pill label={r.act.actual_finish ? 'Done' : `${Math.round(Number(r.act.pct))}%`} tone={r.act.actual_finish ? colors.green : Number(r.act.pct) ? colors.blue : colors.grey} />}
              />
            ),
          )}
        </Card>
      ) : load.weeks.length ? (
        <Card style={{ padding: 0 }}>
          <ScrollView horizontal>
            <View>
              <Row gap={0}>
                <Text style={{ width: 200, padding: 8, fontWeight: '700', color: colors.muted, fontSize: 12 }}>Resource (week of)</Text>
                {load.weeks.map((w) => (
                  <Text key={w} style={{ width: 64, padding: 8, fontWeight: '700', color: colors.muted, fontSize: 11, textAlign: 'right' }}>{fmtDate(w).slice(0, 6)}</Text>
                ))}
              </Row>
              {[...load.names.entries()].map(([k, n]) => (
                <Row key={k} gap={0} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
                  <Text numberOfLines={1} style={{ width: 200, padding: 8, color: colors.text, fontSize: 12 }}>{`${n.name}${n.unit ? ` (${n.unit})` : ''}`}</Text>
                  {load.weeks.map((w) => {
                    const v = load.cells.get(w)?.get(k);
                    return (
                      <Text key={w} style={{ width: 64, padding: 8, fontSize: 12, textAlign: 'right', color: v ? colors.ink : colors.faint, backgroundColor: v ? '#EEF2FF' : undefined }}>
                        {v ? fmtNumber(v) : '·'}
                      </Text>
                    );
                  })}
                </Row>
              ))}
            </View>
          </ScrollView>
          <Muted style={{ padding: 8 }}>Total of each resource on the activities running in that week.</Muted>
        </Card>
      ) : (
        <Empty title="No resources allocated yet" />
      )}
    </>
  );
}
