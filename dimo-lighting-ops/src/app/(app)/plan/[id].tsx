import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { CustomerPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, ErrorBanner, Field, Grid, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import type { MyAction } from '@/components/MeetingActions';
import { PlaceStatus } from '@/components/PlaceStatus';
import { ObjectivePicker } from '@/components/VisitBits';
import { useMe } from '@/lib/auth';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { PlanLine, VisitPlan } from '@/lib/types';

type PvA = {
  planned: number;
  completed_as_planned: number;
  rescheduled: number;
  missed: number;
  cancelled: number;
  unplanned_added: number;
  plan_completion_pct: number | null;
  objective_match_pct: number | null;
  gps_verified_pct: number | null;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PlanDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const masters = useMasters();
  const dialog = useDialog();
  const [adding, setAdding] = useState(false);

  const { data, error, reload } = useLoad(async () => {
    const { data: plan, error: e } = await supabase.from('visit_plans').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const { data: lines } = await supabase
      .from('visit_plan_lines')
      .select('*, organizations(name), projects(name)')
      .eq('plan_id', id)
      .order('planned_date')
      .order('time_slot');
    const pva = await rpc<PvA[]>('plan_vs_actual', { p_sales_person: plan.sales_person_id, p_week_start: plan.week_start }).catch(() => []);
    // Monday 08:30 – 12:00 is the sales meeting: an exception approved by SM Projects frees it for this sales person
    const { data: ex } = await supabase
      .from('meeting_exceptions')
      .select('status, reason, decision_note')
      .eq('sales_person_id', plan.sales_person_id)
      .eq('meeting_date', plan.week_start)
      .maybeSingle();
    // Follow-up visits from the sales meeting not in a plan yet (the sales person's own plan only)
    const followups =
      plan.sales_person_id === me.id
        ? (await rpc<MyAction[]>('my_meeting_actions').catch(() => [] as MyAction[])).filter(
            (a) => a.kind === 'visit' && a.line_status !== 'planned' && a.line_status !== 'completed',
          )
        : [];
    return {
      followups,
      plan: plan as VisitPlan,
      lines: (lines ?? []) as PlanLine[],
      pva: pva[0] ?? null,
      exception: (ex ?? null) as { status: 'pending' | 'approved' | 'rejected'; reason: string; decision_note: string | null } | null,
    };
  }, [id]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { plan, lines, pva, exception, followups } = data;
  const mine = plan.sales_person_id === me.id;
  const editable = mine && ['draft', 'returned', 'approved'].includes(plan.status);
  const manager = me.role === 'sm_projects' || me.role === 'gm';
  // Only SM Projects approves or returns weekly plans
  const approver = me.role === 'sm_projects';

  const dayOptions = DAYS.map((d, i) => ({ value: addDaysISO(plan.week_start, i), label: `${d} ${fmtDate(addDaysISO(plan.week_start, i))}` }));
  const timeHint = 'e.g. 13:30 (Monday 08:30 – 12:00 is the sales meeting)';
  // Sales meeting follow-up: only the day and time are set by the sales person
  const setDayTime = async (l: PlanLine) => {
    const r = await dialog.prompt({
      title: 'Day and time of the visit',
      message: `${l.organizations?.name ?? ''} · ${l.planned_objective} – a follow-up from the sales meeting (customer, project and objective are fixed)`,
      fields: [
        { key: 'd', label: 'Day', type: 'select', required: true, options: dayOptions, initial: l.planned_date },
        { key: 't', label: 'Time', required: true, initial: l.time_slot ?? '', hint: timeHint },
      ],
    });
    if (r)
      await dialog.run(async () => {
        const { error: e } = await supabase.from('visit_plan_lines').update({ planned_date: r.d, time_slot: r.t }).eq('id', l.id);
        if (e) throw new Error(e.message);
        await reload();
      }, 'Saved');
  };
  const addFollowup = async (a: MyAction) => {
    const r = await dialog.prompt({
      title: 'Add the follow-up visit to this week',
      message: `${[a.customer, a.project].filter(Boolean).join(' · ')} · ${a.objective ?? ''} · ${a.action}`,
      fields: [
        { key: 'd', label: 'Day', type: 'select', required: true, options: dayOptions },
        { key: 't', label: 'Time', required: true, hint: timeHint },
      ],
    });
    if (r)
      await dialog.run(async () => {
        await rpc('plan_meeting_visit', { p_action: a.id, p_plan: plan.id, p_date: r.d, p_time: r.t });
        await reload();
      }, 'Added to the plan');
  };

  const lineAction = async (l: PlanLine, action: 'rescheduled' | 'cancelled' | 'missed' | 'delete') => {
    if (action === 'delete') {
      return dialog.run(async () => {
        const { error: e } = await supabase.from('visit_plan_lines').delete().eq('id', l.id);
        if (e) throw new Error(e.message);
        await reload();
      });
    }
    const fields =
      action === 'missed'
        ? [{ key: 'reason', label: 'Missed-visit reason', type: 'select' as const, required: true, options: masters.values('missed_reason').map((v) => ({ value: v, label: v })) }]
        : [
            { key: 'reason', label: 'Reason', type: 'multiline' as const, required: true },
            ...(action === 'rescheduled' ? [{ key: 'date', label: 'New date', type: 'date' as const, required: true }] : []),
          ];
    const r = await dialog.prompt({ title: action === 'missed' ? 'Record missed visit' : `Visit ${action}`, fields });
    if (!r) return;
    await dialog.run(async () => {
      const upd =
        action === 'missed'
          ? { status: 'missed', missed_reason: r.reason }
          : { status: action, change_reason: r.reason, ...(action === 'rescheduled' ? { planned_date: r.date } : {}) };
      const { error: e } = await supabase.from('visit_plan_lines').update(upd).eq('id', l.id);
      if (e) throw new Error(e.message);
      if (action === 'rescheduled') {
        // The rescheduled visit is a new line; the original keeps its "rescheduled" status for plan-vs-actual.
        const { id: _old, organizations: _o, projects: _p, status: _s, change_reason: _c, missed_reason: _m, added_after_approval: _a, ...copy } = l;
        const { error: e2 } = await supabase
          .from('visit_plan_lines')
          .insert({ ...copy, planned_date: r.date, change_reason: `Rescheduled from ${fmtDate(l.planned_date)}: ${r.reason}` });
        if (e2) throw new Error(e2.message);
      }
      await reload();
    }, 'Plan updated – change logged');
  };

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: `Week of ${fmtDate(plan.week_start)}` }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontWeight: '700', fontSize: 16 }}>{people[plan.sales_person_id]?.full_name}</Text>
            <Muted>
              Week of {fmtDate(plan.week_start)} · v{plan.version}
              {plan.submitted_at ? ` · submitted ${fmtDateTime(plan.submitted_at)}` : ''}
            </Muted>
          </View>
          <Row gap={6}>
            {plan.is_late ? <Pill label="Late" tone={colors.red} /> : null}
            <Pill label={plan.status} tone={plan.status === 'approved' ? colors.green : plan.status === 'returned' ? colors.amber : colors.blue} />
          </Row>
        </Row>
        {plan.manager_comment ? <Notice tone={plan.status === 'returned' ? colors.amber : colors.blue}>SM Projects: {plan.manager_comment}</Notice> : null}
        {mine && ['draft', 'returned'].includes(plan.status) ? (
          <Row style={{ marginTop: 8 }}>
            <Button
              title="Submit plan for approval"
              disabled={!lines.length}
              onPress={() =>
                dialog.run(async () => {
                  const res = await rpc<{ late: boolean }>('submit_visit_plan', { p_plan: plan.id });
                  await reload();
                  if (res.late) dialog.toast('Submitted after the Saturday 13:00 deadline – marked late', 'error');
                }, 'Plan submitted')
              }
            />
          </Row>
        ) : null}
        {approver && plan.status === 'submitted' ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            <Button title="Approve" onPress={() => dialog.run(async () => { await rpc('decide_visit_plan', { p_plan: plan.id, p_decision: 'approved' }); await reload(); }, 'Approved')} />
            <Button
              title="Approve with comments"
              variant="secondary"
              onPress={async () => {
                const r = await dialog.prompt({ title: 'Approve with comments', fields: [{ key: 'c', label: 'Comments', type: 'multiline', required: true }] });
                if (r) await dialog.run(async () => { await rpc('decide_visit_plan', { p_plan: plan.id, p_decision: 'approved', p_comment: r.c }); await reload(); }, 'Approved');
              }}
            />
            <Button
              title="Return for changes"
              variant="danger"
              onPress={async () => {
                const r = await dialog.prompt({ title: 'Return plan', message: 'Sales resubmits the same day.', fields: [{ key: 'c', label: 'What needs to change', type: 'multiline', required: true }] });
                if (r) await dialog.run(async () => { await rpc('decide_visit_plan', { p_plan: plan.id, p_decision: 'returned', p_comment: r.c }); await reload(); }, 'Returned');
              }}
            />
          </Row>
        ) : null}
      </Card>

      {mine && plan.week_start >= addDaysISO(todayISO(), -6) ? (
        <Notice tone={exception?.status === 'approved' ? colors.blue : colors.amber}>
          <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ flexShrink: 1, color: colors.ink }}>
              {exception?.status === 'approved'
                ? `Monday ${fmtDate(plan.week_start)}: leave from the sales meeting approved – you may plan visits between 08:30 and 12:00.`
                : exception?.status === 'pending'
                  ? `Monday ${fmtDate(plan.week_start)} 08:30 – 12:00 is the sales meeting. Leave requested – waiting for SM Projects.`
                  : `Monday ${fmtDate(plan.week_start)} 08:30 – 12:00 is the sales meeting – plan Monday visits from 12:00.${exception?.status === 'rejected' ? ` Leave not approved${exception.decision_note ? `: ${exception.decision_note}` : ''}.` : ''}`}
            </Text>
            {!exception || exception.status === 'rejected' ? (
              <Button
                small
                variant="secondary"
                title="Apply for leave"
                onPress={async () => {
                  const r = await dialog.prompt({
                    title: `Visit during the sales meeting – Monday ${fmtDate(plan.week_start)}`,
                    message: 'SM Projects must approve it before the meeting. Once approved you can plan visits between 08:30 and 12:00 that Monday.',
                    fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }],
                  });
                  if (r)
                    await dialog.run(async () => {
                      await rpc('request_meeting_exception', { p_date: plan.week_start, p_reason: r.r });
                      await reload();
                    }, 'Sent to SM Projects');
                }}
              />
            ) : null}
          </Row>
        </Notice>
      ) : null}

      {plan.status === 'approved' && pva ? (
        <Section title="Plan vs actual">
          <Grid min={150}>
            <Stat label="Planned" value={pva.planned} />
            <Stat label="Completed as planned" value={pva.completed_as_planned} />
            <Stat label="Rescheduled" value={pva.rescheduled} />
            <Stat label="Missed" value={pva.missed} tone={pva.missed ? 'red' : undefined} />
            <Stat label="Unplanned added" value={pva.unplanned_added} />
            <Stat label="Plan completion" value={pva.plan_completion_pct == null ? '—' : `${pva.plan_completion_pct}%`} />
            <Stat label="Objective match" value={pva.objective_match_pct == null ? '—' : `${pva.objective_match_pct}%`} />
            <Stat label="GPS-verified" value={pva.gps_verified_pct == null ? '—' : `${pva.gps_verified_pct}%`} />
          </Grid>
          <Card style={{ marginTop: 8 }}>
            {plan.rating ? (
              <Muted>
                Manager rating {plan.rating}/5 – {plan.evaluation_comment}
              </Muted>
            ) : (
              <Muted>Not evaluated yet</Muted>
            )}
            {manager ? (
              <Button
                small
                variant="secondary"
                title="Rate the week"
                onPress={async () => {
                  const r = await dialog.prompt({
                    title: 'Weekly evaluation',
                    fields: [
                      { key: 'rating', label: 'Rating', type: 'select', required: true, options: ['1', '2', '3', '4', '5'].map((x) => ({ value: x, label: `${x} / 5` })) },
                      { key: 'comment', label: 'Coaching comments', type: 'multiline', required: true },
                    ],
                  });
                  if (r) await dialog.run(async () => { await rpc('evaluate_visit_plan', { p_plan: plan.id, p_rating: Number(r.rating), p_comment: r.comment }); await reload(); }, 'Saved');
                }}
              />
            ) : null}
          </Card>
        </Section>
      ) : null}

      {editable && followups.length ? (
        <Section title={`Follow-up visits from the sales meeting – to plan (${followups.length})`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {followups.map((a) => (
              <ListRow
                key={a.id}
                wrapRight
                highlight={a.due_date && a.due_date < todayISO() ? colors.red : colors.amber}
                title={`${a.customer ?? ''}${a.project ? ` · ${a.project}` : ''}`}
                subtitle={`${a.objective ?? ''} · ${a.action}${a.due_date ? ` · visit by ${fmtDate(a.due_date)}` : ''} · meeting ${fmtDate(a.meeting_date)}`}
                right={<Button small title="Add – set day & time" onPress={() => addFollowup(a)} />}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Planned visits" right={editable ? <Button small title="+ Add visit" onPress={() => setAdding(true)} /> : undefined}>
        {adding ? <AddLine planId={plan.id} weekStart={plan.week_start} onDone={() => { setAdding(false); reload(); }} /> : null}
        {DAYS.map((d, i) => {
          const date = addDaysISO(plan.week_start, i);
          const dayLines = lines.filter((l) => l.planned_date === date);
          if (!dayLines.length) return null;
          return (
            <View key={d} style={{ marginBottom: 10 }}>
              <Muted style={{ fontWeight: '700', marginBottom: 4 }}>
                {d} {fmtDate(date)}
              </Muted>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {dayLines.map((l) => (
                  <ListRow
                    key={l.id}
                    title={`${l.time_slot ? `${l.time_slot} · ` : ''}${l.organizations?.name ?? ''}`}
                    subtitle={`${l.planned_objective} · ${l.visit_category}${l.projects?.name ? ` · ${l.projects.name}` : ''}${l.change_reason ? ` · ${l.change_reason}` : ''}${l.missed_reason ? ` · ${l.missed_reason}` : ''}`}
                    highlight={l.visit_type === 'tender' ? colors.blue : undefined}
                    right={
                      <Row gap={4} wrap>
                        {l.visit_type === 'tender' ? <Pill label="Tender" tone={colors.blue} /> : null}
                        {l.meeting_action_id ? <Pill label="Sales meeting" tone={colors.brand} /> : null}
                        {l.added_after_approval ? <Pill label="Added" /> : null}
                        <Pill label={l.status} tone={l.status === 'completed' ? colors.green : l.status === 'missed' ? colors.red : colors.grey} />
                        {editable && plan.status === 'approved' && l.status === 'planned' ? (
                          <>
                            <Button small variant="ghost" title="Reschedule" onPress={() => lineAction(l, 'rescheduled')} />
                            {l.meeting_action_id ? null : <Button small variant="ghost" title="Cancel" onPress={() => lineAction(l, 'cancelled')} />}
                            <Button small variant="ghost" title="Missed" onPress={() => lineAction(l, 'missed')} />
                          </>
                        ) : null}
                        {editable && plan.status !== 'approved' ? (
                          l.meeting_action_id ? (
                            <Button small variant="secondary" title={l.time_slot ? 'Day & time' : 'Set the time'} onPress={() => setDayTime(l)} />
                          ) : (
                            <Button small variant="ghost" title="Remove" onPress={() => lineAction(l, 'delete')} />
                          )
                        ) : null}
                        {mine && l.status === 'planned' && plan.status === 'approved' ? (
                          <Button small title="Check in" onPress={() => router.push(`/visits/new?planLine=${l.id}`)} />
                        ) : null}
                        {approver && plan.status === 'submitted' ? (
                          <Button
                            small
                            variant="ghost"
                            title="Duplicate…"
                            onPress={async () => {
                              const r = await dialog.prompt({
                                title: "Another sales person's customer?",
                                fields: [
                                  {
                                    key: 'd',
                                    label: 'Decision',
                                    type: 'select',
                                    required: true,
                                    options: [
                                      { value: 'joint', label: 'Approve as joint visit' },
                                      { value: 'reassign', label: 'Reassign the account to this sales person' },
                                      { value: 'reject', label: 'Reject the planned visit' },
                                    ],
                                  },
                                  { key: 'c', label: 'Comment', type: 'multiline' },
                                ],
                              });
                              if (r) await dialog.run(async () => { await rpc('resolve_duplicate_line', { p_line: l.id, p_decision: r.d, p_comment: r.c || null }); await reload(); }, 'Decision logged');
                            }}
                          />
                        ) : null}
                      </Row>
                    }
                  />
                ))}
              </Card>
            </View>
          );
        })}
        {!lines.length && !adding ? <Muted>No visits planned yet.</Muted> : null}
      </Section>
    </Screen>
  );
}

function AddLine({ planId, weekStart, onDone }: { planId: string; weekStart: string; onDone: () => void }) {
  const dialog = useDialog();
  const masters = useMasters();
  const [f, setF] = useState({
    planned_date: weekStart,
    time_slot: '',
    project_id: null as string | null,
    organization_id: null as string | null,
    unit_id: null as string | null,
    contact_id: null as string | null,
    visit_category: null as string | null,
    planned_objective: null as string | null,
    location: '',
    visit_type: 'normal' as 'normal' | 'tender',
    tender_activity: null as string | null,
  });
  return (
    <Card style={{ marginBottom: 12, borderColor: colors.brand }}>
      <Select
        label="Day"
        required
        value={f.planned_date}
        options={DAYS.map((d, i) => ({ value: addDaysISO(weekStart, i), label: `${d} ${fmtDate(addDaysISO(weekStart, i))}` }))}
        onChange={(v) => setF((s) => ({ ...s, planned_date: v }))}
      />
      <Field label="Time slot" placeholder="e.g. 13:30 (Monday 08:30 – 12:00 is the sales meeting)" value={f.time_slot} onChangeText={(v) => setF((s) => ({ ...s, time_slot: v }))} />
      <Segmented value={f.visit_type} onChange={(v) => setF((s) => ({ ...s, visit_type: v }))} options={[{ value: 'normal', label: 'Normal' }, { value: 'tender', label: 'Tender' }]} />
      {f.visit_type === 'tender' ? (
        <Select label="Tender activity" value={f.tender_activity} options={masters.values('tender_activity').map((v) => ({ value: v, label: v }))} onChange={(v) => setF((s) => ({ ...s, tender_activity: v }))} />
      ) : null}
      <ProjectPicker value={f.project_id} onChange={(p) => setF((s) => ({ ...s, project_id: p?.id ?? null, organization_id: p?.organization_id ?? s.organization_id, unit_id: p?.unit_id ?? s.unit_id }))} />
      <CustomerPicker
        organizationId={f.organization_id}
        unitId={f.unit_id}
        contactId={f.contact_id}
        onChange={(c) => setF((s) => ({ ...s, organization_id: c.organizationId, unit_id: c.unitId, contact_id: c.contactId, visit_category: s.visit_category ?? c.organization?.visit_category ?? null }))}
      />
      <PlaceStatus projectId={f.project_id} organizationId={f.organization_id} />
      <Select label="Visit category" required value={f.visit_category} options={masters.values('visit_category').map((v) => ({ value: v, label: v }))} onChange={(v) => setF((s) => ({ ...s, visit_category: v }))} />
      <ObjectivePicker label="Planned objective" required value={f.planned_objective} onChange={(v) => setF((s) => ({ ...s, planned_objective: v }))} />
      <Field label="Location" value={f.location} onChangeText={(v) => setF((s) => ({ ...s, location: v }))} />
      <Row gap={8}>
        <Button title="Cancel" variant="secondary" onPress={onDone} />
        <Button
          title="Add to plan"
          onPress={() =>
            dialog.run(async () => {
              if (!f.organization_id || !f.visit_category || !f.planned_objective) throw new Error('Organization, category and objective are required');
              // Same rule as check-in, so a planned visit can always be checked in
              const noProject = masters.list('visit_objective').find((o) => o.value === f.planned_objective)?.tags.includes('networking');
              if (!f.project_id && !noProject) throw new Error('Select a project – or, for a visit to the customer only, choose a customer objective such as New Customer Introduction, Existing Customer Relationship, New Lead Identification or Unplanned / Courtesy');
              const { error } = await supabase.from('visit_plan_lines').insert({ plan_id: planId, ...f, time_slot: f.time_slot || null, location: f.location || null });
              if (error) throw new Error(error.message);
              onDone();
            }, 'Added')
          }
        />
      </Row>
    </Card>
  );
}
