import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Attachments, KIND_LABELS } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { InquiryTimeline, STAGE_COLOUR } from '@/components/InquiryBits';
import { PersonPicker } from '@/components/pickers';
import { DESIGN_SCOPE, designScopeText, ESTIMATION_BASIS, ESTIMATION_SCOPE, estimationScopeText } from '@/lib/constants';
import { Button, Card, colors, DateField, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Progress, Row, Screen, Section, Select, SlaDot } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { openAttachment } from '@/lib/files';
import { daysBetween, endOfWorkDay, fmtDate, fmtDateISO, fmtDateTime, fmtMoney, human, INQUIRY_STATUS_LABEL, todayISO } from '@/lib/format';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { isDesigner, isEstimator, isSales, projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment, DesignJob, EstimationJob, Inquiry, Quotation, SlaClock } from '@/lib/types';

type Approval = { id: string; kind: string; title: string; reason: string | null; status: string; current_step: number; requested_at: string };

export default function InquiryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const masters = useMasters();
  const [tick, setTick] = useState(0);

  const { data, error, reload } = useLoad(async () => {
    const { data: inq, error: e } = await supabase.from('inquiries').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const [dj, ej, q, clocks, approvals, files] = await Promise.all([
      supabase.from('design_jobs').select('*').eq('inquiry_id', id).order('created_at'),
      supabase.from('estimation_jobs').select('*').eq('inquiry_id', id).order('created_at'),
      supabase.from('quotations').select('*').eq('inquiry_id', id).order('released_at', { ascending: false }),
      supabase.from('sla_clocks').select('*').eq('inquiry_id', id).is('stopped_at', null).order('due_at'),
      supabase.from('approvals').select('*').eq('inquiry_id', id).order('requested_at', { ascending: false }),
      rpc<Attachment[]>('inquiry_files', { p_inquiry: id }).catch(() => []),
    ]);
    return {
      inquiry: inq as Inquiry,
      designJobs: (dj.data ?? []) as DesignJob[],
      estimationJobs: (ej.data ?? []) as EstimationJob[],
      quotations: (q.data ?? []) as Quotation[],
      clocks: (clocks.data ?? []) as SlaClock[],
      approvals: (approvals.data ?? []) as Approval[],
      files,
    };
  }, [id, tick]);

  // Live refresh when the inquiry moves (6.5 pending lists update at the same moment)
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    const ch = supabase
      .channel(`inquiry:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inquiries', filter: `id=eq.${id}` }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, refresh]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { inquiry: i, designJobs, estimationJobs, quotations, clocks, approvals, files } = data;
  const mineAsSales = i.sales_person_id === me.id || me.role === 'sm_projects' || me.role === 'gm';
  const colour = i.status === 'on_hold' ? 'grey' : i.sla_colour;
  const daysLeft = i.customer_deadline ? daysBetween(todayISO(), i.customer_deadline) : null;
  const act = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      const res = await rpc<unknown>(fn, args);
      if (res && typeof res === 'object' && 'message' in (res as object)) dialog.toast(String((res as { message: string }).message), 'error');
      if (res && typeof res === 'object' && 'warning' in (res as object)) dialog.toast(String((res as { warning: string }).warning), 'error');
      await reload();
    }, ok);

  const reason = async (title: string, label = 'Reason') => (await dialog.prompt({ title, fields: [{ key: 'r', label, type: 'multiline', required: true }] }))?.r;

  // ---------------------------------------------------------------------------
  // Role-specific actions
  // ---------------------------------------------------------------------------
  const salesActions = () => {
    if (!mineAsSales) return null;
    const buttons: React.ReactNode[] = [];
    if (['draft', 'returned_for_info'].includes(i.status)) {
      buttons.push(<Button key="edit" variant="secondary" title="Edit request" onPress={() => router.push(`/inquiries/new?edit=${i.id}`)} />);
      buttons.push(<Button key="submit" title="Submit inquiry" onPress={() => act('submit_inquiry', { p_inquiry: i.id }, 'Submitted')} />);
    }
    if (['quotation_released', 'returned_to_sales'].includes(i.status) || (i.early_design_release_at && !i.submitted_to_client_at)) {
      buttons.push(
        <Button
          key="sub"
          title="Record submission to client"
          onPress={async () => {
            const r = await dialog.prompt({ title: 'Submitted to client', fields: [{ key: 'd', label: 'Submission date', type: 'date', required: true, initial: todayISO() }] });
            if (r) await act('record_client_submission', { p_inquiry: i.id, p_date: r.d }, 'Recorded');
          }}
        />,
      );
    }
    if (i.status === 'awaiting_client_approval') {
      buttons.push(
        <Button
          key="resp"
          title="Record client response"
          onPress={async () => {
            const r = await dialog.prompt({
              title: "Client's response to the design",
              fields: [
                {
                  key: 'resp',
                  label: 'Response',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'approved', label: 'Approved' },
                    { value: 'approved_with_comments', label: 'Approved with comments' },
                    { value: 'revision_required', label: 'Revision required' },
                  ],
                },
                { key: 'c', label: "Client's comments (attach mark-ups below)", type: 'multiline' },
              ],
            });
            if (r) await act('record_client_response', { p_inquiry: i.id, p_response: r.resp, p_comments: r.c || null }, 'Recorded');
          }}
        />,
      );
    }
    if (['submitted_to_client', 'client_approved', 'awaiting_client_approval', 'quotation_released'].includes(i.status)) {
      buttons.push(
        <Button
          key="res"
          variant="secondary"
          title="Record result"
          onPress={async () => {
            const { data: comps } = await supabase.from('competitors').select('id, name').eq('active', true).order('name');
            const r = await dialog.prompt({
              title: 'Inquiry result',
              fields: [
                {
                  key: 'res',
                  label: 'Result',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'won', label: 'Won' },
                    { value: 'lost', label: 'Lost' },
                    { value: 'on_hold', label: 'On hold' },
                    { value: 'cancelled', label: 'Cancelled' },
                  ],
                },
                { key: 'reason', label: 'Lost reason', type: 'select', options: masters.values('lost_reason').map((v) => ({ value: v, label: v })) },
                { key: 'comp', label: 'Lost to competitor', type: 'select', options: (comps ?? []).map((c) => ({ value: String(c.id), label: c.name })) },
                { key: 'value', label: `Order value (${i.currency})` },
                { key: 'date', label: 'Order date', type: 'date' },
              ],
            });
            if (r)
              await act(
                'record_inquiry_result',
                { p_inquiry: i.id, p_result: r.res, p_lost_reason: r.reason || null, p_competitor: r.comp ? Number(r.comp) : null, p_order_value: r.value ? Number(r.value) : null, p_order_date: r.date || null },
                'Result recorded',
              );
          }}
        />,
      );
    }
    if (!['draft', 'won', 'lost', 'cancelled', 'rejected'].includes(i.status)) {
      buttons.push(
        <Button
          key="ext"
          variant="secondary"
          title="Customer extended the deadline"
          onPress={async () => {
            const r = await dialog.prompt({
              title: 'Customer deadline extension',
              message: 'Attach the extension notice below if available.',
              fields: [
                { key: 'd', label: 'New customer deadline', type: 'date', required: true },
                { key: 'r', label: 'Reason', type: 'multiline', required: true },
              ],
            });
            if (r) await act('extend_customer_deadline', { p_inquiry: i.id, p_new_deadline: r.d, p_reason: r.r }, 'Deadline updated');
          }}
        />,
      );
      buttons.push(
        <Button
          key="chg"
          variant="secondary"
          title="Request a change"
          onPress={async () => {
            const r = await dialog.prompt({
              title: 'Revision request',
              message: 'Changes after submission need approval and are logged.',
              fields: [
                {
                  key: 'kind',
                  label: 'What to change',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'duty_change', label: 'Duty status (SM Projects approves)' },
                    { value: 'expectation_change', label: 'Client expectation or scope – level, origin, design / estimation scope (Design Manager + SM Estimation)' },
                    { value: 'release_mode', label: 'Release mode (SM Projects)' },
                    ...(i.release_mode === 3 ? [{ value: 'early_design_release', label: 'Early design release (Design Manager → SM Projects)' }] : []),
                  ],
                },
                {
                  key: 'duty',
                  label: 'New duty status',
                  type: 'select',
                  options: [
                    { value: 'duty_free', label: 'Duty Free – USD' },
                    { value: 'duty_paid', label: 'Duty Paid – LKR' },
                  ],
                },
                {
                  key: 'level',
                  label: 'New solution level',
                  type: 'select',
                  options: [
                    { value: 'high', label: 'High end' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'low', label: 'Low end' },
                  ],
                },
                {
                  key: 'origin',
                  label: 'New origin',
                  type: 'select',
                  options: [
                    { value: 'european', label: 'European' },
                    { value: 'chinese', label: 'Chinese' },
                    { value: 'no_preference', label: 'No preference' },
                  ],
                },
                ...(i.route !== 'B'
                  ? [{ key: 'dscope', label: 'New design scope', type: 'select' as const, options: DESIGN_SCOPE }]
                  : []),
                ...(i.route !== 'C'
                  ? [
                      { key: 'escope', label: 'New estimation scope', type: 'multiselect' as const, options: ESTIMATION_SCOPE, initial: (i.estimation_scope ?? []).join(',') },
                      { key: 'ebasis', label: 'New estimation basis', type: 'select' as const, options: ESTIMATION_BASIS, initial: i.estimation_basis ?? '' },
                    ]
                  : []),
                {
                  key: 'mode',
                  label: 'New release mode',
                  type: 'select',
                  options: [
                    { value: '1', label: '1 · Design only' },
                    { value: '2', label: '2 · Estimation only' },
                    { value: '3', label: '3 · Design + Estimation' },
                  ],
                },
                { key: 'date', label: 'Required date (early release)', type: 'date' },
                { key: 'reason', label: 'Reason', type: 'multiline', required: true },
              ],
            });
            if (!r) return;
            const payload =
              r.kind === 'duty_change'
                ? { duty_status: r.duty }
                : r.kind === 'expectation_change'
                  ? {
                      solution_level: r.level || null,
                      manufacturing_origin: r.origin || null,
                      design_scope: r.dscope || null,
                      estimation_scope: r.escope && r.escope !== (i.estimation_scope ?? []).join(',') ? r.escope.split(',') : null,
                      estimation_basis: r.ebasis && r.ebasis !== i.estimation_basis ? r.ebasis : null,
                    }
                  : r.kind === 'release_mode'
                    ? { release_mode: Number(r.mode) }
                    : { required_date: r.date };
            await act('request_inquiry_change', { p_inquiry: i.id, p_kind: r.kind, p_payload: payload, p_reason: r.reason }, 'Request sent for approval');
          }}
        />,
      );
    }
    return buttons.length ? buttons : null;
  };

  const managerActions = () => {
    const buttons: React.ReactNode[] = [];
    const receiver = (i.route === 'B' && (me.role === 'sm_estimation' || me.role === 'gm')) || (i.route !== 'B' && (me.role === 'design_manager' || me.role === 'gm'));
    if (i.status === 'submitted' && receiver) {
      buttons.push(
        <Button
          key="acc"
          title="Accept"
          onPress={async () => {
            // Route A: the Design Manager gives the design completion date while accepting; it goes to SM Projects for approval
            if (i.route !== 'A' || i.design_due_status === 'approved' || i.design_due_status === 'pending') return act('accept_inquiry', { p_inquiry: i.id }, 'Accepted');
            const r = await dialog.prompt({
              title: 'Accept and set the design completion date',
              message: `When the whole design (all tasks) will be complete. SM Projects approves it after checking the time left for estimation before the customer deadline (${fmtDate(i.customer_deadline)}). You can assign the designer once it is approved.`,
              fields: [
                { key: 'date', label: 'Design complete by (17:30)', type: 'date', required: true },
                { key: 'note', label: 'Note for SM Projects (optional)', type: 'multiline' },
              ],
              confirmLabel: 'Accept',
            });
            if (!r) return;
            if (r.date < todayISO()) return dialog.toast('The completion date must be in the future', 'error');
            if (i.customer_deadline && r.date >= i.customer_deadline) return dialog.toast(`The design must be complete before the customer deadline (${fmtDate(i.customer_deadline)})`, 'error');
            await dialog.run(async () => {
              await rpc('accept_inquiry', { p_inquiry: i.id });
              try {
                await rpc('propose_design_due', { p_inquiry: i.id, p_due: endOfWorkDay(r.date), p_note: r.note || null });
              } finally {
                await reload();
              }
            }, 'Accepted – completion date sent to SM Projects for approval');
          }}
        />,
      );
      buttons.push(
        <Button key="ret" variant="secondary" title="Return for information" onPress={async () => { const r = await reason('Return for information', 'What is missing'); if (r) await act('return_inquiry', { p_inquiry: i.id, p_reason: r }, 'Returned to sales'); }} />,
      );
      buttons.push(
        <Button key="rej" variant="danger" title="Reject" onPress={async () => { const r = await reason('Reject inquiry'); if (r) await act('return_inquiry', { p_inquiry: i.id, p_reason: r, p_reject: true }, 'Rejected'); }} />,
      );
    }
    if (i.route === 'B' && ['submitted', 'accepted'].includes(i.status) && me.role === 'sm_estimation') {
      buttons.push(
        <Button key="conv" variant="secondary" title="Send to Design (Route A)" onPress={async () => { const r = await reason('Send to Design first', 'Why design is needed'); if (r) await act('convert_to_design', { p_inquiry: i.id, p_reason: r }, 'Sent to Design'); }} />,
      );
    }
    if (me.role === 'design_manager' || me.role === 'gm') {
      const designOpen = ['accepted', 'in_design', 'design_review'].includes(i.status) && i.route !== 'B';
      // Route A: the design completion date is approved by SM Projects before designers are assigned
      const needsDueApproval = i.route === 'A' && i.design_due_status !== 'approved';
      if (designOpen && i.route === 'A') {
        if (i.design_due_status === 'pending') {
          buttons.push(<Muted key="duewait">Waiting for SM Projects to approve the design completion date ({fmtDateTime(i.design_due_proposed_at)}).</Muted>);
        } else {
          buttons.push(
            <Button
              key="due"
              variant={i.design_due_status === 'approved' ? 'secondary' : 'primary'}
              title={i.design_due_status === 'approved' ? 'Change design completion date' : 'Set design completion date'}
              onPress={async () => {
                const r = await dialog.prompt({
                  title: 'Design completion date',
                  message: `When the whole design (all tasks) will be complete. SM Projects approves it after checking the time left for estimation before the customer deadline (${fmtDate(i.customer_deadline)}).`,
                  fields: [
                    { key: 'date', label: 'Design complete by (17:30)', type: 'date', required: true },
                    { key: 'note', label: 'Note for SM Projects (optional)', type: 'multiline' },
                  ],
                });
                if (r) await act('propose_design_due', { p_inquiry: i.id, p_due: endOfWorkDay(r.date), p_note: r.note || null }, 'Sent to SM Projects for approval');
              }}
            />,
          );
          if (i.design_due_status === 'returned') {
            buttons.push(<Muted key="dueret">SM Projects returned the proposed completion date – see Approvals for the comment and propose another date.</Muted>);
          }
        }
      }
      if (designOpen && !needsDueApproval) buttons.push(<AssignDesign key="asg" inquiry={i} jobs={designJobs} onDone={reload} />);
      if (i.status === 'design_approved') {
        buttons.push(
          <Button
            key="rel"
            title={i.release_mode === 1 ? 'Release design to sales' : 'Release design to Estimation'}
            disabled={!i.release_mode_confirmed}
            onPress={async () => {
              const r = await dialog.prompt({ title: 'Release design', message: 'Brand justification is needed only if the brands do not match the client expectation.', fields: [{ key: 'j', label: 'Justification (optional)', type: 'multiline' }] });
              if (r) await act('release_design', { p_inquiry: i.id, p_justification: r.j || null }, 'Design released');
            }}
          />,
        );
        if (!i.release_mode_confirmed) {
          buttons.push(<Muted key="relwait">Waiting for SM Projects to confirm the release mode (Approvals) before the design can be released.</Muted>);
        }
      }
    }
    if (i.status === 'on_hold' && (me.role === 'sm_projects' || me.role === 'gm') && i.hold_reason !== 'Debtor check') {
      buttons.push(<Button key="res" title="Resume" onPress={() => act('resume_inquiry', { p_inquiry: i.id }, 'Resumed')} />);
    }
    return buttons.length ? buttons : null;
  };

  const sales = salesActions();
  const mgr = managerActions();
  const showWorkspaceLinks = !isSales(me.role) && me.role !== 'sm_projects';
  // SM Projects verifies quotations below 15 Mn LKR before SM Estimation releases them
  const quoteCheck = approvals.find(
    (a) => a.kind === 'quotation_sm_projects' && a.status === 'pending' && ((me.role === 'sm_projects' && a.current_step === 1) || me.role === 'gm'),
  );
  const gmQuote = me.role === 'gm';
  const draftFiles = files.filter((f) => f.entity_type === 'estimation_job' && ['quotation_draft', 'costing_sheet', 'compliance_sheet', 'technical_data'].includes(f.kind));
  const releasedFiles = files.filter((f) => ['design_pack', 'quotation_final', 'compliance_sheet', 'technical_data'].includes(f.kind));

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: `${i.code}${i.revision ? `-R${i.revision}` : ''}` }} />
      <Card style={{ borderLeftWidth: 5, borderLeftColor: STAGE_COLOUR[colour] }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, minWidth: 240 }}>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>{i.project_name}</Text>
            <Muted>
              {i.customer_name} · {projectTypeLabel(i.project_type)}
            </Muted>
          </View>
          <Row gap={6} wrap>
            <SlaDot colour={colour} size={14} />
            <Pill label={INQUIRY_STATUS_LABEL[i.status]} tone={STAGE_COLOUR[colour]} solid />
            <Pill label={`Route ${i.route}`} />
            {i.release_mode ? <Pill label={`Mode ${i.release_mode}${i.release_mode_confirmed ? '' : ' (to confirm)'}`} tone={i.release_mode_confirmed ? colors.green : colors.amber} /> : null}
            {i.duty_status ? <Pill label={`${i.duty_status === 'duty_free' ? 'Duty Free' : 'Duty Paid'} · ${i.currency}`} tone={colors.blue} solid /> : null}
            {i.priority !== 'normal' ? <Pill label={i.priority} tone={colors.red} /> : null}
            {i.debtor_flag ? <Pill label="Outstanding debt flag" tone={colors.red} /> : null}
          </Row>
        </Row>
        <View style={{ marginVertical: 10 }}>
          <Progress pct={i.progress_pct} colour={STAGE_COLOUR[colour]} />
          <Muted>{i.progress_pct}% complete</Muted>
        </View>
        <Row wrap>
          <KeyValue label="Current owner" value={people[i.current_owner_id ?? '']?.full_name ?? '—'} />
          <KeyValue label="Current due" value={fmtDateTime(i.current_due_at)} />
          <KeyValue label="Customer deadline" value={`${fmtDate(i.customer_deadline)}${daysLeft != null ? ` (${daysLeft} days)` : ''}`} />
          {i.route === 'A' && (i.design_due_at || i.design_due_proposed_at) ? (
            <KeyValue
              label="Design completion"
              value={
                i.design_due_status === 'approved'
                  ? `${fmtDateTime(i.design_due_at)} (approved)`
                  : `${fmtDateTime(i.design_due_proposed_at)} (${i.design_due_status === 'returned' ? 'returned' : 'awaiting SM Projects'})`
              }
            />
          ) : null}
          <KeyValue label="Sales person" value={people[i.sales_person_id]?.full_name ?? '—'} />
          {i.design_required_by ? <KeyValue label="Design required by" value={fmtDate(i.design_required_by)} /> : null}
          {i.quotation_required_by ? <KeyValue label="Quotation required by" value={fmtDate(i.quotation_required_by)} /> : null}
        </Row>
        {i.sla_colour === 'red' ? (
          <Notice tone={colors.red}>
            Delayed{i.delay_reason ? `: ${i.delay_reason}` : ''}
            {i.revised_due_at ? ` · revised date ${fmtDateTime(i.revised_due_at)}` : ''}
          </Notice>
        ) : null}
        {i.status === 'on_hold' ? <Notice tone={colors.grey}>On hold: {i.hold_reason}</Notice> : null}
        {i.status === 'returned_for_info' ? <Notice tone={colors.amber}>Returned for more information – edit and resubmit. See the timeline for the reason.</Notice> : null}
        {i.checklist_incomplete && i.status !== 'draft' ? <Notice tone={colors.amber}>Document checklist incomplete.</Notice> : null}
        {sales ? <Row wrap gap={8} style={{ marginTop: 8 }}>{sales}</Row> : null}
        {mgr ? <Row wrap gap={8} style={{ marginTop: 8 }}>{mgr}</Row> : null}
      </Card>

      {clocks.length ? (
        <Section title="Stage timers">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {clocks.map((c) => (
              <ListRow
                key={c.id}
                left={<SlaDot colour={c.colour} />}
                title={c.label}
                subtitle={`${people[c.owner_id ?? '']?.full_name ?? human(c.owner_team)} · due ${fmtDateTime(c.revised_due_at ?? c.due_at)} · ${Math.round(c.used_pct)}% used${c.hold_reason ? ` · on hold: ${c.hold_reason}` : ''}${c.delay_reason ? ` · ${c.delay_reason}` : ''}`}
                right={
                  c.colour === 'red' && c.owner_id === me.id ? (
                    <Button
                      small
                      variant="secondary"
                      title="Delay reason"
                      onPress={async () => {
                        const r = await dialog.prompt({
                          title: 'Delay reason and revised date',
                          fields: [
                            { key: 'r', label: 'Reason', type: 'select', required: true, options: masters.values('delay_reason').map((v) => ({ value: v, label: v })) },
                            { key: 'd', label: 'Revised date', type: 'date', required: true },
                          ],
                        });
                        if (r) await act('set_delay_reason', { p_clock: c.id, p_reason: r.r, p_revised_due: endOfWorkDay(r.d) }, 'Saved – sales and SM Projects notified');
                      }}
                    />
                  ) : undefined
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {showWorkspaceLinks && (designJobs.length || estimationJobs.length) ? (
        <Section title="Work">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {designJobs
              .filter((d) => me.role !== 'sm_estimation' && !isEstimator(me.role))
              .filter((d) => !isDesigner(me.role) || d.assignee_id === me.id)
              .map((d) => (
                <ListRow
                  key={d.id}
                  title={`Design · ${d.task_type} · R${d.revision} · Design Rev ${d.review_cycles}`}
                  subtitle={`${people[d.assignee_id ?? '']?.full_name ?? '—'} · ${human(d.status)} · ${d.progress_pct}% · due ${fmtDateTime(d.due_at)}`}
                  onPress={() => router.push(`/design/${d.id}`)}
                />
              ))}
            {estimationJobs
              .filter((e) => !isEstimator(me.role) || e.assignee_id === me.id)
              .map((e) => (
                <ListRow
                  key={e.id}
                  title={`Estimation · ${e.source} · R${e.revision}`}
                  subtitle={`${people[e.assignee_id ?? '']?.full_name ?? 'Not assigned'} · ${human(e.status)} · due ${fmtDateTime(e.due_at)}`}
                  onPress={() => router.push(`/estimation/${e.id}`)}
                />
              ))}
          </Card>
        </Section>
      ) : null}

      {quotations.length ? (
        <Section title="Released quotations">
          <Card>
            {quotations.map((q) => {
              const expired = !q.result && new Date(`${q.validity_date}T23:59:59+05:30`) < new Date();
              return (
                <Row key={q.id} wrap style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Text style={{ fontWeight: '600' }}>{q.full_no}</Text>
                  <Row gap={6}>
                    <Text>{fmtMoney(q.quoted_value, q.currency)}</Text>
                    <Pill label={q.result ?? (expired ? 'Expired' : `Valid to ${fmtDate(q.validity_date)}`)} tone={expired ? colors.red : colors.green} />
                  </Row>
                </Row>
              );
            })}
            <Muted>Brands offered: {quotations[0].brands_offered.map((b) => `${b.group}: ${b.brand}`).join(' · ') || '—'}</Muted>
          </Card>
        </Section>
      ) : null}

      {quoteCheck ? (
        <Section title="Quotation for your approval">
          <Card style={{ borderColor: colors.amber }}>
            <Text style={{ fontWeight: '700' }}>{quoteCheck.title}</Text>
            {quoteCheck.reason ? <Muted>{quoteCheck.reason}</Muted> : null}
            <Muted style={{ marginTop: 6 }}>
              {gmQuote
                ? 'Open the draft quotation and supporting files, then approve or reject. A rejection goes back to SM Estimation for revision (SM Projects is informed).'
                : 'Open the draft quotation and supporting files, then accept it or request a revision. From 15 Mn LKR it then goes to GM / DGM; approved quotations are released to sales by SM Estimation.'}
            </Muted>
          </Card>
          <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
            {draftFiles.map((f) => (
              <ListRow key={f.id} title={f.file_name} subtitle={`${KIND_LABELS[f.kind] ?? f.kind} · v${f.version} · ${fmtDateTime(f.uploaded_at)}`} right={<Button small variant="secondary" title="Open" onPress={() => dialog.run(() => openAttachment(f))} />} />
            ))}
            {!draftFiles.length ? <Muted style={{ padding: 12 }}>No quotation files found.</Muted> : null}
          </Card>
          <Row gap={8} wrap style={{ marginTop: 8 }}>
            <Button
              title={gmQuote ? 'Approve quotation' : 'Accept quotation'}
              onPress={async () => {
                const r = await dialog.prompt({ title: gmQuote ? 'Approve quotation' : 'Accept quotation', message: 'SM Estimation releases it to sales once all approvals are given.', fields: [{ key: 'c', label: 'Comment (optional)', type: 'multiline' }], confirmLabel: 'Accept' });
                if (r) await act('decide_approval', { p_approval: quoteCheck.id, p_decision: 'approved', p_comment: r.c || null }, 'Approval recorded');
              }}
            />
            <Button
              variant="danger"
              title={gmQuote ? 'Reject' : 'Request revision'}
              onPress={async () => {
                const r = await dialog.prompt({
                  title: gmQuote ? 'Reject quotation' : 'Request revision',
                  message: 'Goes back to SM Estimation, who re-assigns it to an estimator; it then comes through the same approvals again.',
                  fields: [{ key: 'c', label: gmQuote ? 'Reason for rejection' : 'What needs to be revised', type: 'multiline', required: true }],
                  confirmLabel: gmQuote ? 'Reject' : 'Request revision',
                });
                if (r) await act('decide_approval', { p_approval: quoteCheck.id, p_decision: gmQuote ? 'rejected' : 'returned', p_comment: r.c }, 'Sent back to SM Estimation');
              }}
            />
          </Row>
        </Section>
      ) : null}

      {isSales(me.role) || me.role === 'sm_projects' ? (
        releasedFiles.length ? (
          <Section title="Released design pack and quotation files">
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {releasedFiles.map((f) => (
                <ListRow key={f.id} title={f.file_name} subtitle={`${KIND_LABELS[f.kind] ?? f.kind} · v${f.version}`} right={<Button small variant="secondary" title="Download" onPress={() => dialog.run(() => openAttachment(f))} />} />
              ))}
            </Card>
          </Section>
        ) : null
      ) : null}

      <Section title="Request">
        <Card>
          <Row wrap>
            <KeyValue label="Design scope" value={designScopeText(i.design_scope)} />
            <KeyValue label="Estimation scope" value={estimationScopeText(i.estimation_scope, i.estimation_basis)} />
            <KeyValue label="Submission type" value={i.submission_type ?? '—'} />
            <KeyValue label="Solution level" value={human(i.solution_level)} />
            <KeyValue label="Origin" value={human(i.manufacturing_origin)} />
            {!isDesigner(me.role) && me.role !== 'design_manager' ? <KeyValue label="Budget indication" value={fmtMoney(i.budget_lkr, 'LKR')} /> : null}
            <KeyValue label="Preferred brands" value={i.preferred_brands ?? '—'} />
            <KeyValue label="Approved makes" value={i.approved_makes ?? '—'} />
            <KeyValue label="Areas" value={i.areas ?? '—'} />
            <KeyValue
              label="Documents received"
              value={['drawings', 'boq', 'spec', 'lux'].map((k) => `${i.checklist?.[k] ? '✓' : '✗'} ${k.toUpperCase()}`).join('  ')}
            />
          </Row>
          <Muted style={{ marginTop: 8 }}>Scope</Muted>
          <Text>{i.scope_description ?? '—'}</Text>
          {i.expectation_notes ? <Muted>Client notes: {i.expectation_notes}</Muted> : null}
        </Card>
      </Section>

      <Attachments
        entityType="inquiry"
        entityId={i.id}
        kinds={['inquiry_doc', 'client_markup', 'deadline_extension']}
        title="Inquiry documents (drawings, BOQ, specification, RCPs, photos)"
        canUpload={mineAsSales}
      />

      {approvals.length ? (
        <Section title="Approvals">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {approvals.map((a) => (
              <ListRow
                key={a.id}
                title={a.title}
                subtitle={`${human(a.kind)} · ${fmtDateTime(a.requested_at)}${a.reason ? ` · ${a.reason}` : ''}`}
                right={<Pill label={a.status === 'pending' ? `Pending step ${a.current_step}` : a.status} tone={a.status === 'approved' ? colors.green : a.status === 'pending' ? colors.amber : colors.red} />}
                onPress={() => router.push('/approvals')}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Progress timeline">
        <InquiryTimeline inquiryId={i.id} refreshKey={i.updated_at} />
      </Section>
    </Screen>
  );
}

/** Design Manager assigns lighting and/or electrical tasks with due dates (6.1, 6.4). */
function AssignDesign({ inquiry, jobs, onDone }: { inquiry: Inquiry; jobs: DesignJob[]; onDone: () => void }) {
  const dialog = useDialog();
  const people = usePeople();
  const [open, setOpen] = useState(false);
  // Each task in the design scope is assigned once per revision; after that the designer is changed with Reassign on the job
  const needed = inquiry.design_scope === 'lighting_electrical' ? ['lighting', 'electrical'] : [inquiry.design_scope === 'electrical' ? 'electrical' : 'lighting'];
  const current = jobs.filter((j) => j.revision === inquiry.revision);
  const remaining = needed.filter((t) => !current.some((j) => j.task_type === t));
  const [f, setF] = useState({
    assignee: null as string | null,
    task_type: remaining[0] ?? 'lighting',
    job_size: 'medium',
    due: (inquiry.design_due_at ? fmtDateISO(inquiry.design_due_at) : inquiry.design_required_by ?? null) as string | null,
    late_reason: '',
  });
  if (!remaining.length) {
    return (
      <View style={{ gap: 4 }}>
        <Button title="Designer assigned" disabled onPress={() => undefined} />
        <Muted>
          {current.map((j) => `${j.task_type === 'electrical' ? 'Electrical' : 'Lighting'}: ${people[j.assignee_id ?? '']?.full_name ?? '—'}`).join(' · ')} – to change, open the design job and use Reassign.
        </Muted>
      </View>
    );
  }
  if (!open) return <Button title={current.length ? `Assign ${remaining[0]} designer` : 'Assign designer'} onPress={() => setOpen(true)} />;
  const late = !!(f.due && inquiry.design_required_by && f.due > inquiry.design_required_by);
  // The design must finish before the customer deadline, leaving time for estimation where it follows
  const afterDeadline = !!(f.due && inquiry.customer_deadline && f.due >= inquiry.customer_deadline);
  const approvedDay = inquiry.design_due_at ? fmtDateISO(inquiry.design_due_at) : null;
  const afterApproved = !!(f.due && approvedDay && f.due > approvedDay);
  return (
    <Card style={{ width: '100%', borderColor: colors.brand }}>
      <Select
        label="Task"
        value={f.task_type}
        onChange={(v) => setF((s) => ({ ...s, task_type: v }))}
        options={[
          { value: 'lighting', label: 'Lighting design' },
          { value: 'electrical', label: 'Electrical design (Lighting Engineer)' },
        ].filter((o) => remaining.includes(o.value))}
      />
      <PersonPicker
        label="Assign to"
        required
        roles={f.task_type === 'electrical' ? ['lighting_engineer'] : ['lighting_designer', 'lighting_engineer']}
        value={f.assignee}
        onChange={(v) => setF((s) => ({ ...s, assignee: v }))}
        hint="See each designer's load on the Design Board"
      />
      <Select
        label="Job size"
        value={f.job_size}
        onChange={(v) => setF((s) => ({ ...s, job_size: v }))}
        options={[
          { value: 'small', label: 'Small (under 20 luminaire types or single area) – 3 working days' },
          { value: 'medium', label: 'Medium – 5 working days' },
          { value: 'large', label: 'Large / tender – 10 working days' },
        ]}
      />
      <DateField label="Design due date" required value={f.due} onChange={(v) => setF((s) => ({ ...s, due: v }))} quick={[3, 5, 10]} hint={`${approvedDay ? `Approved completion ${fmtDate(approvedDay)} · ` : ''}Customer deadline ${fmtDate(inquiry.customer_deadline)}${inquiry.design_required_by ? ` · sales requested ${fmtDate(inquiry.design_required_by)}` : ''}`} />
      {afterApproved ? <Notice tone={colors.red}>Later than the approved design completion date ({fmtDate(approvedDay)}) – change the completion date first.</Notice> : null}
      {afterDeadline ? <Notice tone={colors.red}>The design due date must be before the customer deadline ({fmtDate(inquiry.customer_deadline)}).</Notice> : null}
      {late ? (
        <Notice tone={colors.amber}>
          Later than the sales-requested date – a reason is mandatory and Sales and SM Projects will be notified.
        </Notice>
      ) : null}
      {late ? (
        <Select
          label="Reason for later date"
          value={f.late_reason}
          onChange={(v) => setF((s) => ({ ...s, late_reason: v }))}
          options={['Workload', 'Scope larger than expected', 'Waiting for information', 'Other'].map((v) => ({ value: v, label: v }))}
        />
      ) : null}
      <Row gap={8}>
        <Button variant="secondary" title="Cancel" onPress={() => setOpen(false)} />
        <Button
          title="Assign"
          onPress={() =>
            dialog.run(async () => {
              if (!f.assignee || !f.due) throw new Error('Choose the designer and the due date');
              if (afterDeadline) throw new Error('The design due date must be before the customer deadline');
              if (afterApproved) throw new Error('The due date is later than the approved design completion date');
              await rpc('assign_design_job', {
                p_inquiry: inquiry.id,
                p_assignee: f.assignee,
                p_due: endOfWorkDay(f.due),
                p_task_type: f.task_type,
                p_job_size: f.job_size,
                p_late_reason: late ? f.late_reason || null : null,
              });
              setOpen(false);
              onDone();
            }, 'Assigned – designer notified')
          }
        />
      </Row>
    </Card>
  );
}
