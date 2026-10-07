import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, Grid, ListRow, Muted, Notice, Pill, Row, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecMember, ExecProject } from '@/lib/execution';
import { addDaysISO, fmtDate, fmtNumber, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { exportProgrammePdf } from '@/lib/programmePdf';
import { ROLE_SHORT } from '@/lib/roles';
import { byCode, PROG_STATUS, programmeRows, toDay, weeklyLoading, type Activity, type Dep, type Programme, type Resource, type Snapshot, type Wbs } from '@/lib/programme';
import { rpc, supabase } from '@/lib/supabase';
import { Gantt, ganttLegend } from './Gantt';
import { SCurve } from './SCurve';
import { TrackingTable } from './TrackingTable';

/** The project programme: built by the SEE (WBS, activities, links, resources), approved by SM Projects, progressed by the AEs. */
export function ProgrammeTab({ p, onChange }: { p: ExecProject; onChange: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [view, setView] = useState<'gantt' | 'tracking' | 'scurve' | 'list' | 'resources'>('gantt');
  const [scale, setScale] = useState<'day' | 'week' | 'month'>('week');
  const { data, reload } = useLoad(async () => {
    const [pg, w, a, m, sn] = await Promise.all([
      supabase.from('exec_programmes').select('*').eq('exec_project_id', p.id).maybeSingle(),
      supabase.from('exec_wbs').select('*').eq('exec_project_id', p.id),
      supabase.from('exec_activities').select('*').eq('exec_project_id', p.id),
      supabase.from('exec_members').select('*').eq('exec_project_id', p.id).eq('active', true),
      supabase.from('exec_progress_snapshots').select('*').eq('exec_project_id', p.id).order('snap_date'),
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
      snaps: (sn.data ?? []) as Snapshot[],
    };
  }, [p.id]);
  if (!data) return null;
  const { pg, wbs, acts, deps, res } = data;
  const see = me.role === 'senior_elec_engineer';
  const smp = me.role === 'sm_projects';
  // The SEE edits while the programme is a draft; once submitted, SM Projects' permission is needed to edit again
  const canEdit = see && p.status === 'active' && pg?.status === 'draft';
  const askEdit = async () => {
    const r = await dialog.prompt({
      title: 'Ask to edit the programme',
      message: pg?.version
        ? 'SM Projects decides. When allowed, the programme becomes a revision: the approved baseline stays in force until SM Projects approves the revised programme.'
        : 'The programme is with SM Projects. When allowed, it comes back to you as a draft to change and submit again.',
      fields: [{ key: 'n', label: 'What needs to change and why', type: 'multiline', required: true }],
      confirmLabel: 'Send to SM Projects',
    });
    if (r) await dialog.run(async () => { await rpc('request_programme_edit', { p_exec: p.id, p_reason: r.n }); await refresh(); }, 'Sent to SM Projects');
  };
  const decideEdit = async (ok: boolean) => {
    const r = await dialog.prompt({
      title: ok ? 'Allow the SEE to edit' : 'Do not allow',
      message: ok ? 'The programme goes back to the SEE as a draft. An approved baseline stays in force until you approve the revised programme.' : undefined,
      fields: [{ key: 'n', label: ok ? 'Note' : 'Reason', type: 'multiline', required: !ok }],
      confirmLabel: ok ? 'Allow' : 'Refuse',
    });
    if (r) await dialog.run(async () => { await rpc('decide_programme_edit', { p_exec: p.id, p_allow: ok, p_note: r.n || null }); await refresh(); }, ok ? 'Allowed – the SEE can edit' : 'Refused – the SEE is told');
  };
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
      message: 'Work breakdown: e.g. Civil works › Foundations, Electrical › Cabling. Numbers (1, 1.1 …) are given automatically.',
      fields: [
        { key: 'parent', label: 'Under (leave empty for a top level element)', type: 'select', options: wbsOptions },
        { key: 'name', label: 'Name', required: true },
      ],
      confirmLabel: 'Add',
    });
    if (r) await dialog.run(async () => { await rpc('save_wbs', { p_exec: p.id, p_id: null, p_parent: r.parent || null, p_code: null, p_name: r.name }); await reload(); }, 'Added');
  };
  // Rename, move under another element, or delete a WBS element (delete only when it has no activities or sub-elements)
  // Gantt drag and drop: the server re-schedules, so the following activities move with it
  const afterDates = (r: { es: string; ef: string; duration: number; moved: boolean }) =>
    dialog.toast(r.moved ? `Start moved to ${fmtDate(r.es)} – it follows its preceding activities` : `${fmtDate(r.es)} – ${fmtDate(r.ef)} · ${r.duration} working day(s)`);
  const moveActivity = (a: Activity, days: number) =>
    dialog.run(async () => {
      const r = await rpc<{ es: string; ef: string; duration: number; moved: boolean }>('set_activity_dates', { p_id: a.id, p_start: addDaysISO(a.es!, days), p_finish: null });
      await refresh();
      afterDates(r);
    });
  const resizeActivity = (a: Activity, days: number) =>
    dialog.run(async () => {
      const f = addDaysISO(a.ef!, days);
      const r = await rpc<{ es: string; ef: string; duration: number; moved: boolean }>('set_activity_dates', { p_id: a.id, p_start: null, p_finish: f < a.es! ? a.es! : f });
      await refresh();
      afterDates(r);
    });
  const linkActivities = (pred: Activity, succ: Activity) =>
    dialog.run(async () => {
      await rpc('set_dependency', { p_succ: succ.id, p_pred: pred.id, p_type: 'FS', p_lag: 0 });
      await refresh();
    }, `${succ.code} now starts after ${pred.code} finishes – the following activities were rescheduled`);
  const removeLink = async (d: Dep) => {
    const pa = acts.find((x) => x.id === d.pred_id);
    const sa = acts.find((x) => x.id === d.succ_id);
    if (!(await dialog.confirm('Remove this link?', `${sa?.code} ${sa?.name} will no longer wait for ${pa?.code} ${pa?.name}.`, { confirmLabel: 'Remove', danger: true }))) return;
    await dialog.run(async () => { await rpc('remove_dependency', { p_id: d.id }); await refresh(); }, 'Link removed – dates recalculated');
  };
  // Gantt: rename an activity
  const renameActivity = async (a: Activity) => {
    const r = await dialog.prompt({
      title: `Activity ${a.code}`,
      fields: [{ key: 'name', label: 'Activity name', required: true, initial: a.name }],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('rename_activity', { p_id: a.id, p_name: r.name }); await reload(); }, 'Saved');
  };
  // Gantt: set an activity's start / finish – the duration (working days) is worked out from them
  const setDates = async (a: Activity) => {
    const res = await dialog.prompt({
      title: `${a.code} ${a.name}`,
      message:
        `Now ${fmtDate(a.es)} – ${fmtDate(a.ef)} · ${a.duration} working day(s). The duration is worked out from the dates (weekends and holidays left out). ` +
        'A start before its preceding activities finish moves to the first possible day.' +
        (pg?.status === 'approved' ? ' Changing the approved programme starts a revision for SM Projects.' : ''),
      fields: [
        { key: 's', label: 'Start', type: 'date', required: true, initial: a.es ?? undefined },
        { key: 'f', label: 'Finish', type: 'date', required: true, initial: a.ef ?? undefined },
      ],
      confirmLabel: 'Save dates',
    });
    if (!res) return;
    await dialog.run(async () => {
      const r = await rpc<{ es: string; ef: string; duration: number; moved: boolean }>('set_activity_dates', {
        p_id: a.id,
        p_start: res.s !== a.es ? res.s : null,
        p_finish: res.f !== a.ef || res.s !== a.es ? res.f : null,
      });
      await refresh();
      dialog.toast(
        r.moved
          ? `${r.duration} working day(s) – the start moved to ${fmtDate(r.es)} after its preceding activities`
          : `${fmtDate(r.es)} – ${fmtDate(r.ef)} · ${r.duration} working day(s)`,
      );
    });
  };
  const editWbs = async (w: Wbs) => {
    const below = new Set<string>([w.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of wbs) {
        if (x.parent_id && below.has(x.parent_id) && !below.has(x.id)) {
          below.add(x.id);
          grew = true;
        }
      }
    }
    const empty = !acts.some((a) => a.wbs_id === w.id) && !wbs.some((x) => x.parent_id === w.id);
    const r = await dialog.prompt({
      title: `WBS ${w.code}`,
      message: empty ? 'To delete it, choose "Delete this element" below.' : 'It has activities or sub-elements – move or delete those first to delete it.',
      fields: [
        { key: 'parent', label: 'Under (empty = top level)', type: 'select', initial: w.parent_id ?? '', options: [{ value: '', label: '— Top level —' }, ...wbsOptions.filter((o) => !below.has(o.value))] },
        { key: 'name', label: 'Name', required: true, initial: w.name },
        ...(empty ? [{ key: 'del', label: 'Delete', type: 'select' as const, initial: 'no', options: [{ value: 'no', label: 'Keep' }, { value: 'yes', label: 'Delete this element' }] }] : []),
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    if (r.del === 'yes') {
      if (await dialog.confirm(`Delete WBS ${w.code} ${w.name}?`, undefined, { danger: true, confirmLabel: 'Delete' }))
        await dialog.run(async () => { await rpc('delete_wbs', { p_id: w.id }); await reload(); }, 'Deleted');
      return;
    }
    await dialog.run(async () => { await rpc('save_wbs', { p_exec: p.id, p_id: w.id, p_parent: r.parent || null, p_code: null, p_name: r.name }); await reload(); }, 'Saved – numbers updated');
  };
  // From the Gantt (w = the WBS row tapped) the new activity is added there and the Gantt stays open
  const addActivity = async (w?: Wbs) => {
    const r = await dialog.prompt({
      title: w ? `Activity under ${w.code} ${w.name}` : 'Activity',
      message: 'Numbered automatically (e.g. 2.1.3). Set its start and finish on the Gantt afterwards.',
      fields: [
        { key: 'wbs_id', label: 'WBS element', type: 'select', required: true, options: wbsOptions, initial: w?.id },
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
      if (w) await reload();
      else router.push(`/execution/activity/${id}`);
    }, 'Added – allocate its resources on the activity page');
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

  const pdf = async () => {
    if (!pg) return;
    const r = await dialog.prompt({
      title: 'Programme PDF',
      message: 'For the site / client meeting or a submission. On the web the print window opens – choose "Save as PDF".',
      fields: [
        { key: 'purpose', label: 'Purpose', type: 'select', required: true, initial: 'Progress meeting', options: ['Progress meeting', 'Client submission', 'Consultant submission', 'Internal review'].map((v) => ({ value: v, label: v })) },
        {
          key: 'parts',
          label: 'Include',
          type: 'multiselect',
          required: true,
          initial: 'Gantt chart,S-curve,Tracking table',
          options: ['Gantt chart', 'S-curve', 'Tracking table'].map((v) => ({ value: v, label: v })),
        },
        { key: 'paper', label: 'Paper', type: 'select', required: true, initial: 'A3', options: [{ value: 'A3', label: 'A3 landscape (recommended for the Gantt)' }, { value: 'A4', label: 'A4 landscape' }] },
      ],
      confirmLabel: 'Create PDF',
    });
    if (!r) return;
    const parts = r.parts.split(',').map((x) => x.trim());
    await dialog.run(async () => {
      const { data: logo } = await supabase.from('settings').select('value').eq('key', 'report_logo_url').maybeSingle();
      await exportProgrammePdf({
        project: { name: p.name, code: p.code, client_name: p.client_name, end_date: p.end_date },
        pg,
        wbs,
        acts,
        deps,
        snaps: data.snaps,
        people,
        today: todayISO(),
        generatedBy: `${me.full_name} – ${ROLE_SHORT[me.role]}`,
        logoUrl: (logo?.value as string | undefined) ?? null,
        parts: { gantt: parts.includes('Gantt chart'), scurve: parts.includes('S-curve'), table: parts.includes('Tracking table') },
        paper: r.paper === 'A4' ? 'A4' : 'A3',
        purpose: r.purpose,
      });
    });
  };

  // Build guide for the SEE: each step with its button, the Gantt chart appears from the first activity
  const noRes = acts.filter((a) => a.duration > 0 && !res.some((r) => r.activity_id === a.id)).length;
  const noEng = acts.filter((a) => a.duration > 0 && !a.responsible_id).length;
  const steps: { done: boolean; text: string; button?: { title: string; onPress: () => void } }[] = [
    { done: !!pg, text: pg ? `Start date ${fmtDate(pg.start_date)}` : 'Set the start date (first day of work on site)', button: { title: pg ? 'Change' : 'Set start date', onPress: setStart } },
    { done: wbs.length > 0, text: wbs.length ? `${wbs.length} WBS element(s) – tap one in the Gantt or Activities list (✎) to rename, move or delete it` : 'Add the WBS – the work packages (e.g. 1 Civil works, 2 Electrical works)', button: pg ? { title: '+ WBS', onPress: addWbs } : undefined },
    {
      done: acts.length > 0,
      text: acts.length ? `${acts.length} activit${acts.length === 1 ? 'y' : 'ies'} – the Gantt chart is below` : 'Add the activities under each WBS element, with duration and what each one follows – the Gantt chart appears from the first activity',
      button: wbs.length ? { title: '+ Activity', onPress: () => addActivity() } : undefined,
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
          <Empty title="No programme yet" hint="The Senior Electrical Engineer builds the WBS, activities, links and resources; SM Projects approves it before work starts (checkpoint “Ready to start”)." />
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
              {canEdit && wbs.length ? <Button small variant="secondary" title="+ Activity" onPress={() => addActivity()} /> : null}
              {canEdit && pg.status === 'draft' && acts.length ? <Button small title={pg.version ? 'Submit revision' : 'Submit to SM Projects'} onPress={submit} /> : null}
              {acts.length ? <Button small variant="secondary" title="PDF" onPress={pdf} /> : null}
              {see && p.status === 'active' && pg.status !== 'draft' && !pg.edit_requested_at ? <Button small variant="secondary" title="Ask to edit" onPress={askEdit} /> : null}
              {smp && pg.status === 'submitted' ? <Button small title="Approve" onPress={() => decide(true)} /> : null}
              {smp && pg.status === 'submitted' ? <Button small variant="secondary" title="Return" onPress={() => decide(false)} /> : null}
            </Row>
          </Row>
          {pg.status === 'draft' && pg.decision_note && pg.decided_at ? <Notice tone={colors.amber}>{`Returned by SM Projects: ${pg.decision_note}`}</Notice> : null}
          {pg.status === 'submitted' && pg.submit_note ? <Notice>{pg.submit_note}</Notice> : null}
          {pg.edit_requested_at ? (
            <Notice tone={colors.amber}>{`The SEE asks to edit the programme – ${pg.edit_reason ?? ''}${smp ? '' : ' · waiting for SM Projects'}`}</Notice>
          ) : null}
          {pg.edit_requested_at && smp ? (
            <Row gap={8}>
              <Button small title="Allow editing" onPress={() => decideEdit(true)} />
              <Button small variant="secondary" title="Do not allow" onPress={() => decideEdit(false)} />
            </Row>
          ) : null}
          {pg.edit_requested_at && see ? (
            <Button
              small
              variant="secondary"
              title="Withdraw the request"
              onPress={() => dialog.run(async () => { await rpc('decide_programme_edit', { p_exec: p.id, p_allow: false }); await refresh(); }, 'Withdrawn')}
            />
          ) : null}
          {see && pg.status !== 'draft' && !pg.edit_requested_at ? (
            <Muted>{pg.status === 'submitted' ? 'Submitted – to change it before SM Projects decides, ask to edit.' : 'The programme is finalised – to change dates or activities, ask SM Projects for permission to edit.'}</Muted>
          ) : null}
          {!pg.version ? <Muted>Work cannot start (checkpoint “Ready to start”) until SM Projects approves the programme.</Muted> : null}
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
            { value: 'tracking', label: 'Tracking' },
            { value: 'scurve', label: 'S-curve' },
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
          <Gantt wbs={wbs} acts={acts} deps={deps} scale={scale} today={today} contractEnd={p.end_date} onWbsPress={canEdit ? editWbs : undefined}
            onDatesPress={canEdit ? setDates : undefined}
            onAddActivity={canEdit ? addActivity : undefined}
            onActivityEdit={canEdit ? renameActivity : undefined}
            onMove={canEdit ? moveActivity : undefined}
            onResize={canEdit ? resizeActivity : undefined}
            onLink={canEdit ? linkActivities : undefined}
            onDepPress={canEdit ? removeLink : undefined}
          />
          {canEdit ? (
            <Muted>Drag a bar to move it · drag its right end to change the finish · drag the ○ after a bar onto another activity to link them (it then starts after this one finishes) · tap a link line to remove it. The activities that follow move automatically.</Muted>
          ) : null}
          <Muted>{ganttLegend}</Muted>
        </>
      ) : view === 'tracking' ? (
        pg.version ? <TrackingTable wbs={wbs} acts={acts} today={today} /> : <Empty title="Tracking starts when SM Projects approves the programme" hint="The approved dates become the baseline that progress is compared with." />
      ) : view === 'scurve' ? (
        <SCurve acts={acts} snaps={data.snaps} today={today} />
      ) : view === 'list' ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {programmeRows(wbs, acts).map((r) =>
            r.kind === 'wbs' ? (
              <Pressable
                key={r.wbs.id}
                disabled={!canEdit}
                onPress={() => editWbs(r.wbs)}
                style={{ paddingVertical: 8, paddingLeft: 12 + r.depth * 12, backgroundColor: colors.soft }}
              >
                <Text style={{ fontWeight: '700', color: colors.ink }}>{`${r.wbs.code}  ${r.wbs.name}${canEdit ? '  ✎' : ''}`}</Text>
              </Pressable>
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
