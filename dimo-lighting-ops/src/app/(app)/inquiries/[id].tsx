import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Attachments, KIND_LABELS } from '@/components/Attachments';
import { DeadlineCard } from '@/components/DeadlineCard';
import { DesignNotes } from '@/components/DesignNotes';
import { ProjectTeam } from '@/components/ProjectTeam';
import { useDialog } from '@/components/dialog';
import { deadlineCounting, deadlineNote, InquiryTimeline, REVISION_FLAG_AFTER, RevisionFlag, STAGE_COLOUR } from '@/components/InquiryBits';
import { PersonPicker } from '@/components/pickers';
import { DESIGN_SCOPE, designScopeText, ESTIMATION_BASIS, ESTIMATION_SCOPE, estimationScopeText } from '@/lib/constants';
import { Button, Card, colors, DateField, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Progress, Row, Screen, Section, Select, SlaDot } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { isTender, type Split } from '@/lib/deadlines';
import { openAttachment } from '@/lib/files';
import { daysBetween, endOfWorkDay, fmtDate, fmtDateISO, fmtDateTime, fmtMoney, human, INQUIRY_STATUS_LABEL, todayISO, inquiryTitle, fmtDateDash } from '@/lib/format';
import { editInquiryWin, OPEN_INQUIRY } from '@/lib/inquiryWin';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { colourSide, inquiryColour, isDesigner, isEstimator, isSales, projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment, DesignJob, EstimationJob, Inquiry, Quotation, SlaClock } from '@/lib/types';

type Offer = { id: string; our_price: number | null; tender_bids: { id: string; bid_price: number | null; won: boolean; competitor_id: number; competitors: { name: string } | null }[] };
type Approval = { id: string; kind: string; title: string; reason: string | null; status: string; current_step: number; requested_at: string };

type LateStage = { label: string; side: 'design' | 'estimation' | 'other'; owner: string | null; owner_id: string | null; team: string | null; due_at: string; delay_reason: string | null };
const SIDE_NAME = { design: 'Design side', estimation: 'Estimation side', other: 'Sales / management' } as const;
// How late a stage is, in hours under a day, else days
const lateBy = (due: string) => {
  const h = (Date.now() - Date.parse(due)) / 36e5;
  return `overdue by ${h < 24 ? `${Math.max(1, Math.round(h))} h` : `${Math.round(h / 24)} d`}`;
};

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
    const [dj, ej, q, clocks, approvals, files, lateStages] = await Promise.all([
      supabase.from('design_jobs').select('*').eq('inquiry_id', id).order('created_at'),
      supabase.from('estimation_jobs').select('*').eq('inquiry_id', id).order('created_at'),
      supabase.from('quotations').select('*').eq('inquiry_id', id).order('released_at', { ascending: false }),
      supabase.from('sla_clocks').select('*').eq('inquiry_id', id).is('stopped_at', null).order('due_at'),
      supabase.from('approvals').select('*').eq('inquiry_id', id).order('requested_at', { ascending: false }),
      rpc<Attachment[]>('inquiry_files', { p_inquiry: id }).catch(() => []),
      // The overdue stages of every side, named even where the viewer cannot read that side's timer
      rpc<LateStage[]>('inquiry_late_stages', { p_inquiry: id }).catch(() => [] as LateStage[]),
    ]);
    // Competition record of this quotation (Offers & competition) – only its readers get a row back
    const offer = ((await supabase.from('tenders').select('id, our_price, tender_bids(id, bid_price, won, competitor_id, competitors(name))').eq('inquiry_id', id).maybeSingle()).data ?? null) as Offer | null;
    // Other main contractors quoted for the same tender
    const group = inq.tender_group_id
      ? ((await supabase.from('inquiries').select('*').eq('tender_group_id', inq.tender_group_id).order('created_at')).data ?? []) as Inquiry[]
      : [];
    const groupQuotes = group.length
      ? (((await supabase.from('quotations').select('*').in('inquiry_id', group.map((g) => g.id)).order('released_at', { ascending: false })).data ?? []) as Quotation[])
      : [];
    return {
      offer,
      group,
      groupQuotes,
      inquiry: inq as Inquiry,
      designJobs: (dj.data ?? []) as DesignJob[],
      estimationJobs: (ej.data ?? []) as EstimationJob[],
      quotations: (q.data ?? []) as Quotation[],
      // Past the due time the "% used" is meaningless (a job returned after its due time restarts with a 1-minute target): show how late it is
      clocks: ((clocks.data ?? []) as SlaClock[]).map((c) => {
        const late = (Date.now() - Date.parse(c.revised_due_at ?? c.due_at)) / 36e5;
        return { ...c, timing: late > 0 ? `overdue by ${late < 24 ? `${Math.max(1, Math.round(late))} h` : `${Math.round(late / 24)} d`}` : `${Math.round(Math.min(c.used_pct, 100))}% used` };
      }),
      approvals: (approvals.data ?? []) as Approval[],
      files,
      late: (lateStages ?? []).map((st) => ({ ...st, timing: lateBy(st.due_at) })),
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
  const { inquiry: i, designJobs, estimationJobs, quotations, clocks, approvals, files, group, groupQuotes, offer, late } = data;
  const offerEditor = i.sales_person_id === me.id || ['sm_projects', 'sm_estimation', 'am_estimation'].includes(me.role);
  const offerReader = offerEditor || me.role === 'gm';
  const openOthers = group.filter((g) => g.id !== i.id && !['won', 'lost', 'cancelled', 'rejected'].includes(g.status));
  const mineAsSales = i.sales_person_id === me.id || me.role === 'sm_projects' || me.role === 'gm';
  const side = colourSide(me.role), colour = inquiryColour(i, side);
  const ownLate = late.filter((st) => side === 'all' || st.side === side), otherLate = side === 'all' ? [] : late.filter((st) => st.side !== side);
  // The countdown runs only while the team still works towards the deadline; after the quotation it shows when it went
  const dn = deadlineNote(i);
  const counting = deadlineCounting(i.status);
  const daysLeft = counting && i.customer_deadline ? daysBetween(todayISO(), i.customer_deadline) : null;
  const act = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      const res = await rpc<unknown>(fn, args);
      if (res && typeof res === 'object' && 'message' in (res as object)) dialog.toast(String((res as { message: string }).message), 'error');
      if (res && typeof res === 'object' && 'warning' in (res as object)) dialog.toast(String((res as { warning: string }).warning), 'error');
      await reload();
    }, ok);

  // Route A: the deadline is split once – release, final pricing, the rest for design – and estimation starts with the design
  const designDatePrompt = async (title: string, confirmLabel?: string) => {
    const sp = await rpc<Split | null>('deadline_split', { p_inquiry: i.id }).catch(() => null);
    const r = await dialog.prompt({
      title,
      message: sp
        ? `Counted back from the ${isTender(i) ? `tender closing (${fmtDateTime(i.tender_closes_at)}, fixed)` : `client deadline (${fmtDate(i.customer_deadline)})`}: ${sp.release_days} working day${sp.release_days > 1 ? 's' : ''} to check and release, ${sp.pricing_days} for final pricing (by ${fmtDate(sp.estimation_due)}), the rest for design. Estimation opens now as a pre-estimate and adds the designed fixtures when the design is released. SM Projects approves the date; latest possible ${fmtDate(sp.design_latest)}.${sp.tight ? ' The standard split is already past – agree the date with SM Projects or ask the client for more time.' : ''}`
        : `When the whole design (all tasks) will be complete. SM Projects approves it after checking the time left for estimation before the customer deadline (${fmtDate(i.customer_deadline)}).`,
      fields: [
        { key: 'date', label: 'Design complete by (17:30)', type: 'date', required: true, initial: sp && !sp.tight ? fmtDateISO(sp.design_due) : undefined },
        { key: 'note', label: 'Note for SM Projects (optional)', type: 'multiline' },
      ],
      confirmLabel,
    });
    if (!r) return null;
    if (r.date < todayISO()) return (dialog.toast('The completion date must be in the future', 'error'), null);
    if (sp && r.date > fmtDateISO(sp.design_latest)) return (dialog.toast(`The design must be complete by ${fmtDate(sp.design_latest)} to leave time for final pricing and release`, 'error'), null);
    if (!sp && i.customer_deadline && r.date >= i.customer_deadline) return (dialog.toast(`The design must be complete before the customer deadline (${fmtDate(i.customer_deadline)})`, 'error'), null);
    return r;
  };

  const reason = async (title: string, label = 'Reason') => (await dialog.prompt({ title, fields: [{ key: 'r', label, type: 'multiline', required: true }] }))?.r;

  // ---------------------------------------------------------------------------
  // Role-specific actions
  // ---------------------------------------------------------------------------
  const salesActions = () => {
    if (!mineAsSales) return null;
    const buttons: React.ReactNode[] = [];
    // A project can have several inquiries (packages, areas, phases)
    buttons.push(
      <Button key="another" variant="secondary" title="+ Another inquiry for this project" onPress={() => router.push(`/inquiries/new?project=${i.project_id}`)} />,
    );
    if (['draft', 'returned_for_info'].includes(i.status)) {
      buttons.push(<Button key="edit" variant="secondary" title="Edit request" onPress={() => router.push(`/inquiries/new?edit=${i.id}`)} />);
      buttons.push(<Button key="submit" title="Submit inquiry" onPress={() => act('submit_inquiry', { p_inquiry: i.id }, 'Submitted')} />);
    }
    // A change request already waiting for approval: no second one until it is decided
    const pendingChange = approvals.find((a) => ['duty_change', 'expectation_change', 'early_design_release'].includes(a.kind) && a.status === 'pending');
    // After submission the sales actions belong to the inquiry's own sales person only – SM Projects and DGM
    // approve these requests, so they do not get the buttons that raise them
    if (i.sales_person_id !== me.id) return buttons.length ? buttons : null;
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
    // Client asked for a revision (R1, R2 …): quotation → SM Estimation; design, or design and quotation → Design Manager, then SM Estimation
    if (quotations.length && ['quotation_released', 'submitted_to_client', 'awaiting_client_approval', 'under_evaluation', 'client_approved'].includes(i.status)) {
      const kinds = [
        { value: 'quotation', label: 'Revised quotation – to SM Estimation' },
        ...(i.route !== 'B'
          ? [
              { value: 'design', label: 'Revised design – to the Design Manager, then SM Estimation' },
              { value: 'both', label: 'Revised design and quotation – to the Design Manager, then SM Estimation' },
            ]
          : []),
      ];
      buttons.push(
        <Button
          key="qrev"
          variant="secondary"
          title="Client requested a revision"
          onPress={async () => {
            const r = await dialog.prompt({
              title: `Revision – ${i.code}-R${i.revision + 1}`,
              message: `A revised quotation goes to SM Estimation to assign an estimator. A revised design goes to the Design Manager to assign designers; the released design then goes to SM Estimation for the quotation, and the released quotation comes back to you. The last submitted quotation and its files stay visible. Attach the client's mark-ups or e-mail under Inquiry documents below.${
                i.revision + 1 > REVISION_FLAG_AFTER ? `\n\nThis will be revision R${i.revision + 1} – more than ${REVISION_FLAG_AFTER} revisions, so the inquiry is flagged.` : ''
              }`,
              fields: [
                { key: 'k', label: 'What to revise', type: 'select', required: true, options: kinds, initial: 'quotation' },
                { key: 'c', label: 'What the client wants changed', type: 'multiline', required: true },
                { key: 'd', label: 'Deadline for the revision (to the client)', type: 'date', required: true, hint: 'Splits into design and final pricing dates as usual' },
              ],
              confirmLabel: 'Send',
            });
            if (r) await act('request_revision', { p_inquiry: i.id, p_kind: r.k, p_comments: r.c, p_deadline: r.d }, r.k === 'quotation' ? 'Sent to SM Estimation' : 'Sent to the Design Manager');
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
    if (['submitted_to_client', 'client_approved', 'awaiting_client_approval', 'under_evaluation', 'quotation_released'].includes(i.status)) {
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
                    { value: 'under_evaluation', label: 'Under evaluation' },
                    { value: 'on_hold', label: 'On hold' },
                    { value: 'cancelled', label: 'Cancelled' },
                  ],
                },
                { key: 'reason', label: 'Lost reason', type: 'select', required: true, options: masters.values('lost_reason').map((v) => ({ value: v, label: v })), when: { key: 'res', in: ['lost'] } },
                { key: 'comp', label: 'Lost to competitor', type: 'select', options: (comps ?? []).map((c) => ({ value: String(c.id), label: c.name })), when: { key: 'res', in: ['lost'] } },
                { key: 'value', label: `Order value (${i.currency})`, required: true, when: { key: 'res', in: ['won'] } },
                { key: 'date', label: 'Order date', type: 'date', required: true, when: { key: 'res', in: ['won'] } },
                { key: 'until', label: 'Client decision expected by', type: 'date', initial: i.evaluation_until ?? '', when: { key: 'res', in: ['under_evaluation'] } },
                { key: 'note', label: 'Note', type: 'multiline', initial: i.evaluation_note ?? '', hint: 'e.g. consultant comparing three bids', when: { key: 'res', in: ['under_evaluation'] } },
              ],
            });
            if (!r) return;
            // the client is still evaluating: not a result yet, the inquiry stays open for follow-up
            if (r.res === 'under_evaluation') {
              await act('record_inquiry_evaluation', { p_inquiry: i.id, p_until: r.until || null, p_note: r.note || null }, 'Recorded as under evaluation');
              return;
            }
            if (!r) return;
            const ok = await act(
              'record_inquiry_result',
              { p_inquiry: i.id, p_result: r.res, p_lost_reason: r.reason || null, p_competitor: r.comp ? Number(r.comp) : null, p_order_value: r.value ? Number(r.value) : null, p_order_date: r.date || null },
              'Result recorded',
            );
            // Same tender quoted to other contractors: close their quotes in one step (the tender counts once)
            if (ok && (r.res === 'won' || r.res === 'lost') && openOthers.length) {
              const yes = await dialog.confirm(
                `Close the other ${openOthers.length} contractor quote${openOthers.length > 1 ? 's' : ''}?`,
                `${openOthers.map((g) => `${g.customer_name} (${g.code})`).join(', ')} – ${r.res === 'won' ? `tender awarded to ${i.customer_name}` : 'same tender, result recorded here'}. They are closed as cancelled so the tender counts once in the win rate.`,
                { confirmLabel: 'Close them' },
              );
              if (yes) await act('close_tender_group_others', { p_inquiry: i.id }, 'Other contractor quotes closed');
            }
          }}
        />,
      );
    }
    if (['quotation_released', 'returned_to_sales', 'submitted_to_client', 'awaiting_client_approval', 'under_evaluation', 'client_approved'].includes(i.status)) {
      buttons.push(<Button key="copy" variant="secondary" title="Quote to another contractor" onPress={() => router.push({ pathname: '/inquiries/copy', params: { from: i.id } })} />);
    }
    if (!['draft', 'won', 'lost', 'cancelled', 'rejected'].includes(i.status)) {
      buttons.push(
        <Button
          key="chg"
          variant="secondary"
          title={pendingChange ? 'Change request waiting for approval' : 'Request a change'}
          disabled={!!pendingChange}
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
                  label: 'New duty status (for a duty change)',
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
            if (r.kind === 'duty_change' && !r.duty) return dialog.toast('Choose the new duty status', 'error');
            if (r.kind === 'duty_change' && r.duty === i.duty_status) return dialog.toast('The inquiry already has this duty status', 'error');
            if (r.kind === 'release_mode' && !r.mode) return dialog.toast('Choose the new release mode', 'error');
            if (r.kind === 'early_design_release' && !r.date) return dialog.toast('Enter the required date', 'error');
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
    // The sales person who raised it can discard it at any open stage – no approval, the reason is recorded
    if (i.sales_person_id === me.id && !['won', 'lost', 'cancelled', 'rejected'].includes(i.status)) {
      buttons.push(
        <Button
          key="discard"
          variant="ghost"
          title="Discard inquiry"
          onPress={async () => {
            const r = await dialog.prompt({
              title: `Discard ${i.code}`,
              message: `The inquiry is closed as cancelled – no approval needed. The reason is recorded with your name${['draft', 'submitted'].includes(i.status) ? '' : ', and design, estimation and SM Projects are told to stop work on it'}.`,
              fields: [{ key: 'reason', label: 'Reason for discarding', type: 'multiline', required: true, hint: 'At least 10 characters, e.g. raised twice by mistake, customer dropped the project' }],
              confirmLabel: 'Discard',
              danger: true,
            });
            if (!r) return;
            if (r.reason.trim().length < 10) return dialog.toast('Give the reason (at least 10 characters)', 'error');
            await act('discard_inquiry', { p_inquiry: i.id, p_reason: r.reason }, 'Inquiry discarded');
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
            const r = await designDatePrompt('Accept and set the design completion date', 'Accept');
            if (!r) return;
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
                const r = await designDatePrompt('Design completion date');
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
  // SM Projects verifies quotations below LKR 15,000,000.00 before SM Estimation releases them
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
            <Text style={{ fontSize: 20, fontWeight: '700' }}>{inquiryTitle(i)}</Text>
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
            <RevisionFlag revision={i.revision} />
          </Row>
        </Row>
        <View style={{ marginVertical: 10 }}>
          <Progress pct={i.progress_pct} colour={STAGE_COLOUR[colour]} />
          <Muted>{i.progress_pct}% complete</Muted>
        </View>
        <Row wrap>
          <KeyValue label="Current owner" value={people[i.current_owner_id ?? '']?.full_name ?? '—'} />
          <KeyValue label="Current due" value={fmtDateTime(i.current_due_at)} />
          <KeyValue
            label={isTender(i) ? 'Tender closes (fixed)' : 'Client deadline'}
            value={`${isTender(i) ? fmtDateTime(i.tender_closes_at) : counting ? fmtDate(i.customer_deadline) : dn.text.replace('Customer deadline ', '')}${daysLeft != null ? ` (${daysLeft} days)` : ''}${i.extension_status === 'requested' ? ' · extension asked' : ''}`}
          />
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
          {mineAsSales && i.win_probability != null ? (
            <View>
              <KeyValue label="Win probability" value={`${i.win_probability}%${i.est_value != null ? ` · expected ${fmtMoney(i.est_value, i.currency)}` : ''}`} />
              {OPEN_INQUIRY(i.status) ? <Button small variant="ghost" title="Change" onPress={() => editInquiryWin(dialog, i, () => reload())} /> : null}
            </View>
          ) : null}
          {i.design_required_by ? <KeyValue label="Design required by" value={fmtDate(i.design_required_by)} /> : null}
          {i.quotation_required_by ? <KeyValue label="Quotation required by" value={fmtDate(i.quotation_required_by)} /> : null}
        </Row>
        {colour === 'red' ? (
          <Notice tone={colors.red}>
            {[
              // Which stage is late, on which side, whose it is and by how much – then the reason the owner gave (or that none was given)
              ...ownLate.map((st) => `Delayed: ${st.label}${side === 'all' ? ` · ${SIDE_NAME[st.side]}` : ''} · ${st.owner ?? human(st.team ?? '')} · due ${fmtDateTime(st.due_at)} · ${st.timing}`),
              ...(ownLate.length ? [] : ['Delayed']),
              ...ownLate.map((st) => (st.delay_reason ? `Reason: ${st.delay_reason}` : null)),
              ownLate.some((st) => !st.delay_reason)
                ? side === 'all' ? 'No delay reason given yet – the owner enters it on their stage timer.' : 'No delay reason given yet – the owner enters it on the stage timer below.'
                : null,
              side === 'all' && ownLate.length && ownLate.every((st) => st.side === 'estimation') && i.design_sla_colour && i.design_sla_colour !== 'red' && i.current_due_at
                ? `Design side on time – due ${fmtDateTime(i.current_due_at)}`
                : null,
              side === 'all' && ownLate.length && ownLate.every((st) => st.side === 'design') && i.estimation_sla_colour && i.estimation_sla_colour !== 'red' && i.estimation_due_at
                ? `Estimation side on time – due ${fmtDateTime(i.estimation_due_at)}`
                : null,
            ]
              .filter(Boolean)
              .join('\n')}
          </Notice>
        ) : null}
        {otherLate.length ? (
          <Notice tone={colors.grey}>
            {otherLate
              .map((st) => `${SIDE_NAME[st.side]} overdue – ${st.label} · ${st.owner ?? human(st.team ?? '')} · due ${fmtDateTime(st.due_at)} · ${st.timing}. Not a ${side} delay.`)
              .join('\n')}
          </Notice>
        ) : null}
        {i.discarded_at ? <Notice tone={colors.grey}>{`Discarded by ${people[i.discarded_by ?? '']?.full_name ?? 'the sales person'} on ${fmtDate(i.discarded_at)} – ${i.discard_reason}`}</Notice> : null}
        {i.status === 'on_hold' ? <Notice tone={colors.grey}>On hold: {i.hold_reason}</Notice> : null}
        {i.status === 'under_evaluation' ? (
          <Notice>{`Under evaluation by the client${i.evaluation_until ? ` – decision expected by ${fmtDate(i.evaluation_until)}` : ''}${i.evaluation_note ? ` · ${i.evaluation_note}` : ''}`}</Notice>
        ) : null}
        {i.revision_request && i.revision_kind && ['accepted', 'in_design', 'design_review', 'design_approved', 'in_estimation'].includes(i.status) ? (
          <Notice tone={colors.amber}>{`Client revision R${i.revision} – ${i.revision_request}`}</Notice>
        ) : null}
        {i.status === 'returned_for_info' ? <Notice tone={colors.amber}>Returned for more information – edit and resubmit. See the timeline for the reason.</Notice> : null}
        {i.checklist_incomplete && i.status !== 'draft' ? <Notice tone={colors.amber}>Document checklist incomplete.</Notice> : null}
        {sales ? <Row wrap gap={8} style={{ marginTop: 8 }}>{sales}</Row> : null}
        {mgr ? <Row wrap gap={8} style={{ marginTop: 8 }}>{mgr}</Row> : null}
      </Card>
      {i.status !== 'draft' ? <DeadlineCard inquiry={i} onChange={reload} /> : null}

      {clocks.length ? (
        <Section title="Stage timers">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {clocks.map((c) => (
              <ListRow
                key={c.id}
                left={<SlaDot colour={c.colour} />}
                title={c.label}
                subtitle={`${people[c.owner_id ?? '']?.full_name ?? human(c.owner_team)} · due ${fmtDateTime(c.revised_due_at ?? c.due_at)} · ${c.timing}${c.hold_reason ? ` · on hold: ${c.hold_reason}` : ''}${c.delay_reason ? ` · ${c.delay_reason}` : ''}`}
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

      {group.length > 1 ? (
        <Section title={`Same tender – ${group.length} contractors`}>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {group.map((g) => {
              const q = groupQuotes.find((x) => x.inquiry_id === g.id && x.revision === g.revision) ?? groupQuotes.find((x) => x.inquiry_id === g.id);
              return (
                <ListRow
                  key={g.id}
                  highlight={g.id === i.id ? colors.blue : g.status === 'won' ? colors.green : undefined}
                  title={`${g.customer_name ?? '—'}${g.id === i.id ? ' (this quote)' : ''}`}
                  subtitle={`${g.code}${q ? ` · ${q.full_no}` : ' · not released yet'}${g.lost_reason && ['cancelled', 'lost'].includes(g.status) ? ` · ${g.lost_reason}` : ''}`}
                  right={
                    <Row gap={6}>
                      {q ? <Text style={{ fontWeight: '700' }}>{fmtMoney(q.quoted_value, q.currency)}</Text> : null}
                      <Pill label={human(g.status)} tone={g.status === 'won' ? colors.green : ['lost', 'cancelled'].includes(g.status) ? colors.grey : colors.blue} />
                    </Row>
                  }
                  onPress={g.id === i.id ? undefined : () => router.push(`/inquiries/${g.id}`)}
                />
              );
            })}
          </Card>
          <Muted>One tender quoted to several main contractors – the project value counts once.</Muted>
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
                    <Pill label={q.result ?? (expired ? 'Expired' : `Valid to ${fmtDateDash(q.validity_date)}`)} tone={expired ? colors.red : colors.green} />
                  </Row>
                </Row>
              );
            })}
            <Muted>Brands offered: {quotations[0].brands_offered.map((b) => `${b.group}: ${b.brand}`).join(' · ') || '—'}</Muted>
            {quotations[0].docs_note ? <Muted>{quotations[0].docs_note}</Muted> : null}
          </Card>
        </Section>
      ) : null}

      {quotations.length && offerReader ? (
        <Section title="Competitors on this quotation">
          <Card style={{ gap: 6 }}>
            {offer ? (
              offer.tender_bids.length ? (
                [...offer.tender_bids]
                  .sort((a, b) => Number(a.bid_price ?? 9e15) - Number(b.bid_price ?? 9e15))
                  .map((b) => (
                    <Row key={b.id} wrap style={{ justifyContent: 'space-between' }}>
                      <Text style={{ fontWeight: '600', color: b.won ? colors.red : colors.ink }}>{`${b.competitors?.name ?? '—'}${b.won ? ' · won the order' : ''}`}</Text>
                      <Text>
                        {b.bid_price != null ? fmtMoney(b.bid_price, i.currency) : 'price not known'}
                        {b.bid_price != null && offer.our_price ? `  (${Number(b.bid_price) >= Number(offer.our_price) ? '+' : ''}${(((Number(b.bid_price) - Number(offer.our_price)) / Number(offer.our_price)) * 100).toFixed(1)}% vs ours)` : ''}
                      </Text>
                    </Row>
                  ))
              ) : (
                <Muted>No competitors recorded yet.</Muted>
              )
            ) : (
              <Muted>Who else quoted, their prices and brands – recorded here, they build up each competitor’s profile.</Muted>
            )}
            <Row gap={8} wrap>
              {offer ? (
                <Button variant="secondary" title={offerEditor ? 'Open – add competitors, BOQ, item prices' : 'Open'} onPress={() => router.push(`/tenders/${offer.id}`)} />
              ) : offerEditor ? (
                <Button
                  variant="secondary"
                  title="Record competitors"
                  onPress={() =>
                    dialog.run(async () => {
                      const tid = await rpc<string>('start_offer_record', { p_inquiry: i.id });
                      router.push(`/tenders/${tid}`);
                    })
                  }
                />
              ) : null}
            </Row>
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
                : 'Open the draft quotation and supporting files, then accept it or request a revision. From LKR 15,000,000.00 it then goes to DGM; approved quotations are released to sales by SM Estimation.'}
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

      <DesignNotes inquiryId={i.id} />

      <ProjectTeam projectId={i.project_id} compact title="Project team – architect, consultants, contractors" />

      <Section title="Request">
        <Card>
          <Row wrap>
            <KeyValue label="Design scope" value={designScopeText(i.design_scope)} />
            <KeyValue label="Estimation scope" value={estimationScopeText(i.estimation_scope, i.estimation_basis)} />
            {i.submission_type ? <KeyValue label="Submission type" value={i.submission_type} /> : null}
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
        kinds={['inquiry_doc', 'client_markup', 'deadline_extension', 'tender_addendum']}
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
