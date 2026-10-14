import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { FoNotes } from '@/components/foreign/Notes';
import { StepList } from '@/components/foreign/StepList';
import { clearLoStep, recordLoStep } from '@/components/local/actions';
import { OrderDates } from '@/components/OrderDates';
import { TestingBanner } from '@/components/Testing';
import { Button, colors, ErrorBanner, Grid, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section, useWide } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { todayIso, workdays, type DateChange } from '@/lib/foreignOrders';
import { useLoad, usePeople } from '@/lib/hooks';
import {
  ADVANCE_TERMS,
  BILLING_LABEL,
  DIC_LIMIT,
  fmtLkr,
  INVOICE_POINTS,
  invoiceChain,
  invoiceNext,
  LO_KEEPER,
  LO_SHORT,
  LO_STAGES,
  loRoute,
  loStanding,
  termLabel,
  type LoDelivery,
  type LoWorkStage,
  type LoStageChange,
  type LoCompletionChange,
  type LoInvoice,
  type LoNote,
  type LoOrder,
  type LoRequest,
  type LoStep,
  type LoStepDef,
} from '@/lib/localOrders';
import { supabase } from '@/lib/supabase';

type SubInv = { id: string; code: string | null; invoice_no: string; amount: number; status: string; subcontractor: string | null; invoice_date: string };

/** A supplier order: its approvals, PO / LOA, bonds, deliveries or work, and the invoices through the owner's approval to payment. */
export default function LocalOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const wide = useWide();
  const keeper = LO_KEEPER.includes(me.role);
  const { data, error, reload } = useLoad(async () => {
    const o = await supabase.from('lo_orders').select('*').eq('id', id).maybeSingle();
    if (o.error) throw new Error(o.error.message);
    if (!o.data) throw new Error('Order not found');
    const order = o.data as LoOrder;
    const [r, s, d, pv, v, dl, inv, hol, nt, dc, ws, wc, cc] = await Promise.all([
      supabase.from('lo_requests').select('*').eq('id', order.request_id).single(),
      supabase.from('lo_steps').select('*').eq('request_id', order.request_id),
      supabase.from('lo_step_defs').select('*').order('seq'),
      supabase.from('lo_request_values').select('pr_value').eq('request_id', order.request_id).maybeSingle(),
      supabase.from('lo_order_values').select('value, hire_rate').eq('order_id', id).maybeSingle(),
      supabase.from('lo_deliveries').select('*').eq('order_id', id).order('delivered_on'),
      supabase.from('lo_invoices').select('*').eq('order_id', id).order('received_on'),
      supabase.from('holidays').select('day'),
      supabase.from('lo_notes').select('*').eq('order_id', id).order('occurred_on', { ascending: false }),
      supabase.from('order_date_changes').select('*').eq('module', 'lo').eq('order_id', id),
      supabase.from('lo_work_stages').select('*').eq('order_id', id).order('seq'),
      supabase.from('lo_work_stage_changes').select('*, lo_work_stages!inner(order_id)').eq('lo_work_stages.order_id', id).order('requested_at', { ascending: false }),
      supabase.from('lo_completion_changes').select('*').eq('order_id', id).order('requested_at', { ascending: false }),
    ]);
    const req = r.data as LoRequest;
    // the execution team's approved IPCs on the project not yet taken under a work stage
    const subs = keeper && order.kind === 'service' && req.exec_project_id
      ? await (async () => {
          const [si, used] = await Promise.all([
            supabase.from('sub_invoices').select('id, code, invoice_no, amount, status, subcontractor, invoice_date').eq('exec_project_id', req.exec_project_id).in('status', ['approved', 'docs_received']),
            supabase.from('lo_invoices').select('sub_invoice_id').not('sub_invoice_id', 'is', null).neq('status', 'cancelled'),
          ]);
          const taken = new Set(((used.data ?? []) as { sub_invoice_id: string }[]).map((x) => x.sub_invoice_id));
          return ((si.data ?? []) as SubInv[]).filter((x) => !taken.has(x.id));
        })()
      : [];
    return {
      o: order,
      r: req,
      steps: (s.data ?? []) as LoStep[],
      defs: (d.data ?? []) as LoStepDef[],
      prValue: (pv.data as { pr_value: number | null } | null)?.pr_value ?? null,
      value: (v.data as { value: number | null } | null)?.value ?? null,
      hireRate: (v.data as { hire_rate: number | null } | null)?.hire_rate ?? null,
      seeValues: !!v.data || keeper || ['sm_projects', 'sm_estimation', 'gm'].includes(me.role),
      deliveries: (dl.data ?? []) as LoDelivery[],
      invoices: (inv.data ?? []) as LoInvoice[],
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
      notes: (nt.data ?? []) as LoNote[],
      dateChanges: (dc.data ?? []) as DateChange[],
      work: (ws.data ?? []) as LoWorkStage[],
      stageChanges: (wc.data ?? []) as LoStageChange[],
      completionChanges: (cc.data ?? []) as LoCompletionChange[],
      subs,
    };
  }, [id, keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { o, r, steps, defs, prValue, value, hireRate, seeValues, deliveries, invoices, holidays, notes, subs, dateChanges, work, stageChanges, completionChanges } = data;
  const hasAdvance = invoices.some((i) => i.kind === 'advance' && i.status !== 'cancelled');
  // the planned dates (an IPC service's completion, a work-basis service's deliverables) are the agreement's: fixed once it is signed
  const agreementSigned = steps.some((x) => x.order_id === o.id && x.step === 'agreement_signed');
  // work basis (e.g. a consultant): the deliverables, each invoiced once accepted
  const dlv = o.billing === 'milestone';
  const workEditor = (keeper || me.role === 'senior_elec_engineer') && o.kind === 'service' && dlv;
  const all = loRoute(defs, prValue, o, value, steps, holidays);
  const st = loStanding(all);
  const lines = all.filter((l) => l.def.scope === 'o');
  const open = o.status === 'open' && r.status === 'open';
  const ordered = steps.some((s) => s.order_id === o.id && (s.step === 'po_issued' || s.step === 'loa_issued'));
  const chain = invoiceChain(r);
  const paid = invoices.filter((i) => i.status === 'paid').reduce((t, i) => t + Number(i.amount), 0);
  const total = workdays(r.received_on, steps.find((s) => s.order_id === o.id && s.step === 'closed')?.done_on ?? todayIso(), holidays);

  const cancel = async () => {
    const x = await dialog.prompt({ title: `Cancel ${o.code}`, fields: [{ key: 'why', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Cancel order', danger: true });
    if (x) await dialog.run(async () => { await rpc('lo_cancel_order', { p_id: o.id, p_reason: x.why }); await reload(); }, 'Cancelled');
  };
  const addDelivery = async () => {
    const x = await dialog.prompt({
      title: 'Delivery received',
      message: 'With the delivery note signed by the site team. Record part deliveries one by one; record “Delivered in full” when all has arrived.',
      fields: [
        { key: 'delivered_on', label: 'Delivered on', type: 'date', required: true, initial: todayIso() },
        { key: 'dn_no', label: 'Delivery note no.', required: true },
        { key: 'items', label: 'What was delivered', type: 'multiline', hint: 'e.g. 60 m trays (part)' },
        { key: 'signed_by', label: 'Signed by (site team)' },
        { key: 'note', label: 'Note' },
      ],
      confirmLabel: 'Record',
    });
    if (x) await dialog.run(async () => { await rpc('lo_add_delivery', { p_order: o.id, p: x }); await reload(); }, 'Recorded – the requester is told');
  };
  const addInvoice = async () => {
    const x = await dialog.prompt({
      title: o.kind === 'service' ? 'Invoice / IPC received' : 'Invoice received',
      message: o.kind === 'material' ? 'Submitted to Procurement with the signed delivery notes.' : o.billing === 'hire' ? 'A hire invoice for a period, with the hire / time sheet – the SEE certifies the usage.' : dlv ? 'An invoice for an accepted deliverable (or the advance).' : r.exec_project_id ? 'IPCs come from the execution team: when approved, take them with + IPC (stage 6).' : 'An invoice, or an IPC-based invoice.',
      fields: [
        {
          key: 'kind',
          label: 'Type',
          type: 'select',
          required: true,
          initial: 'invoice',
          options: [
            { value: 'invoice', label: 'Invoice' },
            // an execution project's IPCs come from the execution team, under a work stage
            ...(o.kind === 'service' && o.billing === 'ipc' && !r.exec_project_id ? [{ value: 'ipc', label: 'IPC-based invoice' }] : []),
            // one advance per order – not progress
            ...(hasAdvance ? [] : [{ value: 'advance', label: 'Advance invoice (not progress)' }]),
          ],
        },
        { key: 'invoice_no', label: 'Invoice no.', required: true },
        { key: 'invoice_date', label: 'Invoice date', type: 'date', required: true, initial: todayIso() },
        { key: 'amount', label: 'Amount (LKR)', required: true },
        ...(o.kind === 'material' ? [{ key: 'dn_nos', label: 'Delivery note nos.', initial: deliveries.map((d) => d.dn_no).join(', '), hint: 'Not needed for an advance invoice' }] : []),
        // a hire: the period and the usage (the SEE certifies the hire / time sheet – the first approval)
        ...(o.billing === 'hire'
          ? [
              { key: 'period_from', label: 'Period from', type: 'date' as const, required: true, initial: invoicedTo ? addDay(invoicedTo) : o.hire_from ?? '', when: { key: 'kind', in: ['invoice'] } },
              { key: 'period_to', label: 'Period to', type: 'date' as const, required: true, initial: o.hire_to ?? '', when: { key: 'kind', in: ['invoice'] } },
              { key: 'usage_qty', label: `${unit.charAt(0).toUpperCase()}${unit.slice(1)}s used (hire / time sheet)`, required: true, when: { key: 'kind', in: ['invoice'] }, hint: hireRate != null ? `Agreed rate ${fmtLkr(hireRate)} per ${unit}` : undefined },
            ]
          : []),
        ...(o.kind === 'service' && ADVANCE_TERMS.includes(o.payment_term) && !(o.billing === 'ipc' && r.exec_project_id) ? [{ key: 'advance_recovered', label: 'Advance recovered in this invoice (LKR)', hint: 'Leave empty when none', when: { key: 'kind', in: ['invoice', 'ipc'] } }] : []),
        ...(dlv
          ? [{ key: 'deliverable', label: 'For deliverable', required: true, when: { key: 'kind', in: ['invoice'] }, type: 'select' as const, options: work.filter((w) => w.done_on).map((w) => ({ value: w.id, label: `${w.seq}. ${w.title}${w.pct ? ` · ${w.pct}%` : ''} · accepted ${fmtDate(w.done_on)}` })), hint: 'Only deliverables the SEE has accepted (done)' }]
          : []),
        { key: 'received_on', label: 'Received on', type: 'date', required: true, initial: todayIso() },
        { key: 'note', label: 'Note' },
      ],
      confirmLabel: 'Record',
    });
    if (x)
      await dialog.run(async () => {
        const { deliverable, ...p } = x;
        await rpc('lo_add_invoice', { p_order: o.id, p: { ...p, work_stage_id: deliverable ?? '', amount: x.amount.replace(/,/g, ''), advance_recovered: (p.advance_recovered ?? '').replace(/,/g, ''), usage_qty: (p.usage_qty ?? '').replace(/,/g, '') } });
        await reload();
      }, 'Recorded');
  };
  const invStep = async (i: LoInvoice, p: (typeof chain)[number]) => {
    const x = await dialog.prompt({
      title: `${INVOICE_POINTS[p].label} – ${i.invoice_no}`,
      fields: [{ key: 'date', label: 'Date', type: 'date', required: true, initial: todayIso() }, ...(p === 'paid' ? [{ key: 'ref', label: 'Payment reference' }] : [])],
      confirmLabel: 'Record',
    });
    if (x) await dialog.run(async () => { await rpc('lo_invoice_step', { p_id: i.id, p_step: p, p_date: x.date, p_ref: x.ref ?? null }); await reload(); }, 'Recorded');
  };
  const invUndo = async (i: LoInvoice, p: (typeof chain)[number]) => {
    if (await dialog.confirm(`Clear “${INVOICE_POINTS[p].label}”?`, 'Only for a date recorded by mistake.', { confirmLabel: 'Clear', danger: true }))
      await dialog.run(async () => { await rpc('lo_invoice_step', { p_id: i.id, p_step: p, p_date: null }); await reload(); }, 'Cleared');
  };

  const deliveriesPanel = (
    <>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{`Deliveries · ${deliveries.length}`}</Text>
        {keeper && open ? <Button small variant="secondary" title="+ Delivery" onPress={addDelivery} disabled={!ordered} /> : null}
      </Row>
      {!deliveries.length ? <Muted>{ordered ? 'No delivery yet.' : 'Recorded after the PO is released.'}</Muted> : null}
      {deliveries.map((d) => (
        <Row key={d.id} gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Muted style={{ flexShrink: 1 }}>{`${fmtDate(d.delivered_on)} · DN ${d.dn_no}${d.items ? ` · ${d.items}` : ''}${d.signed_by ? ` · signed by ${d.signed_by}` : ''}${d.note ? ` · ${d.note}` : ''}`}</Muted>
          {keeper && open ? (
            <Button small variant="ghost" title="Remove" onPress={async () => { if (await dialog.confirm('Remove this delivery?')) await dialog.run(async () => { await rpc('lo_remove_delivery', { p_id: d.id }); await reload(); }, 'Removed'); }} />
          ) : null}
        </Row>
      ))}
    </>
  );

  // work basis: the deliverables of the agreement – planned dates set before it is signed, then only with the SEE's and SM Projects' approval
  const saveStage = async (w?: LoWorkStage) => {
    const x = await dialog.prompt({
      title: w ? `Deliverable ${w.seq}` : 'New deliverable',
      message: `A deliverable in the agreement – e.g. "Concept design report" – with its planned date. It is invoiced once the SEE accepts it.${agreementSigned ? ' The agreement is signed: a date is requested (Set date… / Change date…) – the SEE and SM Projects approve it.' : ''}`,
      fields: [
        { key: 'title', label: 'What', required: true, initial: w?.title ?? '' },
        { key: 'pct', label: '% of the whole work (optional)', initial: w?.pct != null ? String(w.pct) : '' },
        ...(agreementSigned ? [] : [{ key: 'planned_on', label: 'Planned date (agreement)', type: 'date' as const, initial: w?.planned_on ?? '', hint: 'Needed before the signed agreement – fixed from then on' }]),
        { key: 'done_on', label: 'Accepted by the SEE on (when accepted)', type: 'date', initial: w?.done_on ?? '', hint: 'Leave empty until it is accepted – not a future date' },
        { key: 'cert_ref', label: 'Acceptance ref. (letter / e-mail)', initial: w?.cert_ref ?? '' },
        { key: 'note', label: 'Note', initial: w?.note ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (x) await dialog.run(async () => { await rpc('lo_save_work_stage', { p_id: w?.id ?? null, p: { ...x, ...(agreementSigned ? { planned_on: w?.planned_on ?? '' } : {}), order_id: o.id } }); await reload(); }, 'Saved');
  };
  const askDate = async (w: LoWorkStage) => {
    const x = await dialog.prompt({
      title: `${w.planned_on ? 'Change' : 'Set'} the planned date – ${w.title}`,
      message: w.planned_on ? `Agreed date ${fmtDate(w.planned_on)}. The SEE and then SM Projects approve the change.` : 'No date in the signed agreement. The SEE and then SM Projects approve the date.',
      fields: [
        { key: 'date', label: 'New planned date', type: 'date', required: true },
        { key: 'reason', label: 'Reason', type: 'multiline', required: true },
      ],
      confirmLabel: 'Send for approval',
    });
    if (x) await dialog.run(async () => { await rpc('lo_request_stage_date', { p_stage: w.id, p_date: x.date, p_reason: x.reason }); await reload(); }, 'Sent for approval');
  };
  const decideDate = async (c: LoStageChange, approve: boolean) => {
    const x = approve ? {} : await dialog.prompt({ title: 'Reject the date change', fields: [{ key: 'note', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Reject' });
    if (x) await dialog.run(async () => { await rpc('lo_decide_stage_date', { p_change: c.id, p_approve: approve, p_note: (x as { note?: string }).note ?? null }); await reload(); }, approve ? 'Approved' : 'Rejected');
  };
  const decideCompletion = async (c: LoCompletionChange, approve: boolean) => {
    const x = approve ? {} : await dialog.prompt({ title: 'Reject the date change', fields: [{ key: 'note', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Reject' });
    if (x) await dialog.run(async () => { await rpc('lo_decide_completion', { p_change: c.id, p_approve: approve, p_note: (x as { note?: string }).note ?? null }); await reload(); }, approve ? 'Approved' : 'Rejected');
  };
  // a date change waiting: the SEE, then SM Projects approve
  const pendingRow = (key: string, title: string, why: string, status: string, onDecide: (approve: boolean) => void) => {
    const mine = (status === 'pending_see' && me.role === 'senior_elec_engineer') || (status === 'pending_smp' && me.role === 'sm_projects');
    return (
      <Row key={key} wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between', padding: 8, borderRadius: 8, backgroundColor: '#FFF7E6' }}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: colors.ink, fontWeight: '600' }}>{title}</Text>
          <Muted>{`${why} · waiting for ${status === 'pending_see' ? 'the SEE' : 'SM Projects'}`}</Muted>
        </View>
        {mine ? (
          <Row gap={6}>
            <Button small title="Approve" onPress={() => onDecide(true)} />
            <Button small variant="ghost" title="Reject" onPress={() => onDecide(false)} />
          </Row>
        ) : null}
      </Row>
    );
  };
  const doneStages = work.filter((w) => w.done_on);
  const workPanel = o.kind === 'service' && dlv ? (
    <>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>
          {`Deliverables · ${doneStages.length} of ${work.length} accepted${work.some((w) => w.pct) ? ` · ${doneStages.reduce((t, w) => t + Number(w.pct ?? 0), 0)}% of the work` : ''}`}
        </Text>
        {workEditor && open ? <Button small variant="secondary" title="+ Deliverable" onPress={() => saveStage()} /> : null}
      </Row>
      {stageChanges
        .filter((c) => c.status.startsWith('pending'))
        .map((c) => {
          const w = work.find((x) => x.id === c.stage_id);
          return pendingRow(c.id, `Date change · ${w?.seq ?? ''}. ${w?.title ?? ''}: ${c.old_date ? fmtDate(c.old_date) : '—'} → ${fmtDate(c.new_date)}`, c.reason, c.status, (a) => decideDate(c, a));
        })}
      {agreementSigned ? (
        work.length ? <Muted>Planned dates are those of the signed agreement – setting or changing one needs the SEE’s and SM Projects’ approval.</Muted> : null
      ) : (
        <Notice tone={colors.blue}>The agreement’s deliverables: enter each with its planned date now – “Signed agreement issued” needs them, and they are fixed from then on.</Notice>
      )}
      {!work.length ? <Muted>Work basis (e.g. a consultant): each deliverable is invoiced once the SEE accepts it. “Work completed” needs every deliverable accepted.</Muted> : null}
      {work.map((w) => {
        const inv = invoices.filter((i) => i.work_stage_id === w.id && i.status !== 'cancelled');
        const late = !w.done_on && w.planned_on && w.planned_on < todayIso();
        const moved = stageChanges.filter((c) => c.stage_id === w.id && c.status === 'approved').length;
        return (
          <Row key={w.id} wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ color: colors.ink, fontWeight: '600' }}>{`${w.seq}. ${w.title}${w.pct ? ` · ${w.pct}%` : ''}`}</Text>
              <Muted>
                {[w.done_on ? `accepted ${fmtDate(w.done_on)}` : w.planned_on ? `planned ${fmtDate(w.planned_on)}${agreementSigned ? ' (agreement)' : ''}` : 'no date yet',
                  moved ? `date moved ${moved}×` : null, w.cert_ref ? `acceptance ${w.cert_ref}` : null, inv.length ? `${inv.length} invoice${inv.length === 1 ? '' : 's'} · ${inv.filter((i) => i.status === 'paid').length} paid` : 'no invoice yet', w.note]
                  .filter(Boolean)
                  .join(' · ')}
              </Muted>
            </View>
            <Row gap={6} style={{ alignItems: 'center' }}>
              <Pill label={w.done_on ? 'Accepted' : late ? 'Late' : 'In progress'} tone={w.done_on ? colors.green : late ? colors.red : colors.blue} />
              {workEditor && open ? <Button small variant="ghost" title="Edit" onPress={() => saveStage(w)} /> : null}
              {workEditor && open && agreementSigned && !w.done_on && !stageChanges.some((c) => c.stage_id === w.id && c.status.startsWith('pending')) ? (
                <Button small variant={w.planned_on ? 'ghost' : 'secondary'} title={w.planned_on ? 'Change date…' : 'Set date…'} onPress={() => askDate(w)} />
              ) : null}
              {workEditor && open && !inv.length ? <Button small variant="ghost" title="Remove" onPress={async () => { if (await dialog.confirm(`Remove deliverable ${w.seq}?`)) await dialog.run(async () => { await rpc('lo_remove_work_stage', { p_id: w.id }); await reload(); }, 'Removed'); }} /> : null}
            </Row>
          </Row>
        );
      })}
    </>
  ) : null;

  // an IPC service: the execution team's approved IPCs taken onto the order; the planned completion fixed by the signed agreement
  const ipcs = invoices.filter((i) => i.kind === 'ipc' && i.status !== 'cancelled');
  const claimed = ipcs.reduce((t, i) => t + Number(i.amount), 0);
  const advPaid = invoices.filter((i) => i.kind === 'advance' && i.status !== 'cancelled').reduce((t, i) => t + Number(i.amount), 0);
  const advRec = invoices.filter((i) => i.status !== 'cancelled').reduce((t, i) => t + Number(i.advance_recovered ?? 0), 0);
  const variations = ipcs.reduce((t, i) => t + Number(i.variation_amount ?? 0), 0);
  const ipcSigned = o.billing === 'ipc' && agreementSigned;
  const takeIpc = async () => {
    if (!subs.length) return dialog.toast('No approved IPC waiting – it appears here once the execution team’s IPC is approved', 'error');
    const x = await dialog.prompt({
      title: 'Take an approved IPC',
      message: 'The execution team’s approved IPCs on this project. The invoice then follows its approvals below (the SEE’s is already given).',
      fields: [
        { key: 'sub', label: 'Approved IPC', type: 'select', required: true, options: subs.map((v) => ({ value: v.id, label: `${v.code ?? ''} · ${v.invoice_no} · ${v.subcontractor ?? ''} · ${fmtLkr(v.amount)} · ${fmtDate(v.invoice_date)}` })) },
        { key: 'received_on', label: 'Received on', type: 'date', required: true, initial: todayIso() },
        { key: 'advance_recovered', label: 'Advance recovered in this IPC (LKR)', hint: 'Leave empty when none' },
        { key: 'has_variation', label: 'Includes a variation?', type: 'select', initial: 'no', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes – enter it separately' }] },
        { key: 'variation_amount', label: 'Variation amount (LKR)', required: true, when: { key: 'has_variation', in: ['yes'] } },
        { key: 'variation_note', label: 'Variation (no. / what)', when: { key: 'has_variation', in: ['yes'] } },
        { key: 'note', label: 'Note' },
      ],
      confirmLabel: 'Take IPC',
    });
    if (!x) return;
    await dialog.run(async () => {
      const { sub, ...p } = x;
      await rpc('lo_take_ipc', { p_order: o.id, p_sub: sub, p: { ...p, advance_recovered: p.advance_recovered.replace(/,/g, ''), variation_amount: p.variation_amount.replace(/,/g, '') } });
      await reload();
    }, 'IPC taken – SM Projects approves next');
  };
  const askCompletion = async () => {
    const x = await dialog.prompt({
      title: `${o.expected_on ? 'Change' : 'Set'} the planned completion`,
      message: o.expected_on ? `Agreed completion ${fmtDate(o.expected_on)} (signed agreement). The SEE and then SM Projects approve the change.` : 'No completion date in the signed agreement. The SEE and then SM Projects approve the date.',
      fields: [
        { key: 'date', label: 'New planned completion', type: 'date', required: true },
        {
          key: 'reason',
          label: 'Reason',
          type: 'select',
          required: true,
          options: [
            { value: 'supplier', label: 'Service provider' },
            { value: 'material', label: 'Material' },
            { value: 'payment', label: 'Payment' },
            { value: 'documents', label: 'Documents / approvals' },
            { value: 'other', label: 'Other (site, weather, client …)' },
          ],
        },
        { key: 'note', label: 'What happened', type: 'multiline', required: true },
      ],
      confirmLabel: 'Send for approval',
    });
    if (x) await dialog.run(async () => { await rpc('lo_request_completion', { p_order: o.id, p_date: x.date, p_reason: x.reason, p_note: x.note }); await reload(); }, 'Sent for approval');
  };
  const pendingCompletion = completionChanges.filter((c) => c.status.startsWith('pending'));
  const ipcPanel = o.kind === 'service' && o.billing === 'ipc' ? (
    <>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{`IPCs · ${ipcs.length} taken${seeValues ? ` · claimed ${fmtLkr(claimed)}${value ? ` (${Math.round((claimed / value) * 100)}% of ${fmtLkr(value)})` : ''}` : ''}`}</Text>
        <Row gap={6} wrap>
          {(keeper || me.role === 'senior_elec_engineer') && open && ipcSigned && !pendingCompletion.length ? <Button small variant="ghost" title={o.expected_on ? 'Change completion…' : 'Set completion…'} onPress={askCompletion} /> : null}
          {keeper && open && r.exec_project_id ? <Button small variant="secondary" title="+ IPC" onPress={takeIpc} /> : null}
        </Row>
      </Row>
      {pendingCompletion.map((c) => pendingRow(c.id, `Completion date change: ${c.old_date ? fmtDate(c.old_date) : '—'} → ${fmtDate(c.new_date)}`, c.note, c.status, (a) => decideCompletion(c, a)))}
      <Muted>
        {[o.expected_on ? `planned completion ${fmtDate(o.expected_on)}${ipcSigned ? ' (signed agreement)' : ''}` : 'no planned completion yet',
          seeValues && advPaid ? `advance ${fmtLkr(advPaid)} · recovered ${fmtLkr(advRec)} · to recover ${fmtLkr(Math.max(advPaid - advRec, 0))}` : null,
          seeValues && variations ? `variations ${fmtLkr(variations)}` : null]
          .filter(Boolean)
          .join(' · ')}
      </Muted>
      {!ipcSigned ? <Notice tone={colors.blue}>Set the planned completion (Expected completion above) before the signed agreement – it is fixed from then on, and a change needs the SEE’s and SM Projects’ approval.</Notice> : null}
      {r.exec_project_id ? <Muted>The execution team’s IPCs appear here to take (+ IPC) once approved; each then follows its invoice approvals in stage 7.</Muted> : <Muted>Record each IPC invoice in stage 7 (+ Invoice → IPC-based invoice).</Muted>}
    </>
  ) : null;

  // a hire: on hire / off hire, the periods invoiced and the usage
  const hireInv = invoices.filter((i) => i.period_from && i.status !== 'cancelled').sort((a, b) => (a.period_from ?? '').localeCompare(b.period_from ?? ''));
  const invoicedTo = hireInv.length ? hireInv[hireInv.length - 1].period_to : null;
  const unit = o.hire_unit ?? 'day';
  const used = hireInv.reduce((t, i) => t + Number(i.usage_qty ?? 0), 0);
  const setHire = async () => {
    const x = await dialog.prompt({
      title: 'On hire / off hire',
      message: 'The dates the machine, equipment or consultant was taken on and released – from the site. Off hire stays empty while it is still on hire.',
      fields: [
        { key: 'from', label: 'On hire from', type: 'date', required: true, initial: o.hire_from ?? todayIso() },
        { key: 'to', label: 'Off hire (released) on', type: 'date', initial: o.hire_to ?? '', hint: 'Leave empty while still on hire' },
      ],
      confirmLabel: 'Save',
    });
    if (x) await dialog.run(async () => { await rpc('lo_set_hire', { p_order: o.id, p_from: x.from, p_to: x.to || null }); await reload(); }, 'Saved');
  };
  const hirePanel = o.kind === 'service' && o.billing === 'hire' ? (
    <>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{`Hire · by the ${unit}${seeValues && hireRate != null ? ` · ${fmtLkr(hireRate)} per ${unit}` : ''}`}</Text>
        {(keeper || me.role === 'senior_elec_engineer') && open ? <Button small variant="secondary" title={o.hire_from ? 'On / off hire…' : 'Record on hire…'} onPress={setHire} /> : null}
      </Row>
      <Muted>
        {[o.hire_from ? `on hire ${fmtDate(o.hire_from)}` : 'not on hire yet', o.hire_to ? `off hire ${fmtDate(o.hire_to)}` : o.hire_from ? 'still on hire' : null, invoicedTo ? `invoiced up to ${fmtDate(invoicedTo)} · ${used} ${unit}${used === 1 ? '' : 's'}` : null]
          .filter(Boolean)
          .join(' · ')}
      </Muted>
      {o.hire_from && !o.hire_to ? <Muted>Each invoice covers a period with the {unit}s used – from the hire / time sheet the SEE certifies. “Work completed” is the off hire.</Muted> : null}
      {o.hire_to && (!invoicedTo || invoicedTo < o.hire_to) ? <Notice tone={colors.amber}>{`Not invoiced up to the off hire yet (${fmtDate(o.hire_to)}) – the order closes when the invoices reach it.`}</Notice> : null}
    </>
  ) : null;

  const invoicesPanel = seeValues ? (
    <>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{`Invoices · paid ${fmtLkr(paid)}${value != null ? ` of ${fmtLkr(value)}` : ''}`}</Text>
        {keeper && open ? <Button small variant="secondary" title="+ Invoice" onPress={addInvoice} disabled={!ordered} /> : null}
      </Row>
      <Muted>Each invoice is approved in turn – record each approval when it is received; the next one is highlighted.</Muted>
      {invoices.map((i) => {
        const next = invoiceNext(i, chain);
        const done = chain.filter((p) => (i as unknown as Record<string, string | null>)[`${p}_on`]);
        return (
          <View key={i.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
            <Row wrap gap={6} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.ink, fontWeight: '600', flexShrink: 1 }}>{`${i.kind === 'ipc' ? 'IPC invoice' : i.kind === 'advance' ? 'Advance invoice' : 'Invoice'} ${i.invoice_no} · ${fmtLkr(i.amount)}`}</Text>
              <Pill label={i.status === 'paid' ? `Paid ${fmtDate(i.paid_on)}` : i.status === 'cancelled' ? 'Cancelled' : next === 'paid' || !next ? 'Awaiting payment' : `With ${INVOICE_POINTS[next].who}`} tone={i.status === 'paid' ? colors.green : i.status === 'cancelled' ? colors.grey : colors.blue} />
            </Row>
            <Muted>{[i.work_stage_id ? `for stage ${work.find((w) => w.id === i.work_stage_id)?.seq ?? ''}. ${work.find((w) => w.id === i.work_stage_id)?.title ?? ''}` : null, `dated ${fmtDate(i.invoice_date)}`, `received ${fmtDate(i.received_on)}`, i.period_from ? `period ${fmtDate(i.period_from)} – ${fmtDate(i.period_to)} · ${i.usage_qty} ${unit}${Number(i.usage_qty) === 1 ? '' : 's'}${hireRate != null && i.usage_qty != null && Math.abs(Number(i.usage_qty) * hireRate - Number(i.amount)) > 1 ? ` (at the agreed rate ${fmtLkr(Number(i.usage_qty) * hireRate)})` : ''}` : null, i.dn_nos ? `DN ${i.dn_nos}` : null, i.advance_recovered ? `advance recovered ${fmtLkr(i.advance_recovered)}` : null, i.variation_amount ? `variation ${fmtLkr(i.variation_amount)}${i.variation_note ? ` (${i.variation_note})` : ''}` : null, i.kind === 'advance' ? 'not progress' : null, i.pay_ref ? `payment ref. ${i.pay_ref}` : null, i.note].filter(Boolean).join(' · ')}</Muted>
            {/* the approval chain: done (date), the next one, then waiting */}
            <Row wrap gap={4} style={{ alignItems: 'center' }}>
              {chain.map((p, k) => {
                const on = (i as unknown as Record<string, string | null>)[`${p}_on`];
                const isNext = i.status !== 'cancelled' && p === next;
                return (
                  <Row key={p} gap={4} style={{ alignItems: 'center' }}>
                    {k ? <Text style={{ color: colors.faint }}>→</Text> : null}
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: on ? colors.green : isNext ? colors.blue : colors.line,
                        backgroundColor: on ? '#ECFDF3' : isNext ? '#EFF4FF' : colors.soft,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: on || isNext ? '700' : '400', color: on ? colors.green : isNext ? colors.blue : colors.muted }}>
                        {`${on ? '✓ ' : ''}${INVOICE_POINTS[p].who}`}
                      </Text>
                      <Text style={{ fontSize: 11, color: on ? colors.green : colors.muted }}>{on ? fmtDate(on) : isNext ? 'next' : 'waiting'}</Text>
                    </View>
                  </Row>
                );
              })}
            </Row>
            {keeper && i.status !== 'cancelled' ? (
              <Row wrap gap={6}>
                {next ? <Button small title={next === 'paid' ? 'Record the payment…' : `Record: ${INVOICE_POINTS[next].label}…`} onPress={() => invStep(i, next)} /> : null}
                {done.length ? <Button small variant="ghost" title={`Undo ${done[done.length - 1] === 'paid' ? 'payment' : INVOICE_POINTS[done[done.length - 1]].who}`} onPress={() => invUndo(i, done[done.length - 1])} /> : null}
                {i.status === 'open' ? <Button small variant="ghost" title="Cancel" onPress={async () => { if (await dialog.confirm('Cancel this invoice?')) await dialog.run(async () => { await rpc('lo_cancel_invoice', { p_id: i.id }); await reload(); }, 'Cancelled'); }} /> : null}
              </Row>
            ) : null}
          </View>
        );
      })}
    </>
  ) : null;

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: o.code ?? 'Local order' }} />
      <TestingBanner what="Local orders" always />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{`${o.code} · ${o.kind === 'service' ? 'Service' : 'Material'} · request ${r.code}, order ${o.seq_no}`}</Muted>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink }}>{`${o.title} – ${r.project_name}`}</Text>
          <Row gap={6} wrap style={{ marginTop: 4 }}>
            <Pill label={termLabel(o)} tone={colors.blue} />
            {o.kind === 'service' ? <Pill label={BILLING_LABEL[o.billing ?? 'single']} tone={colors.grey} /> : null}
            {o.supplier_new ? <Pill label="New supplier" tone={colors.amber} /> : null}
            {o.status !== 'open' ? <Pill label={o.status === 'completed' ? 'Closed' : 'Cancelled'} tone={o.status === 'completed' ? colors.green : colors.grey} solid /> : null}
          </Row>
        </View>
        {keeper && open ? (
          <Row gap={8} wrap>
            <Button small variant="ghost" title="Cancel" onPress={cancel} />
            <Button small variant="secondary" title="Edit" onPress={() => router.push({ pathname: '/orders/local/order-form', params: { id: o.id } })} />
          </Row>
        ) : null}
      </Row>
      {o.cancel_reason ? <Notice tone={colors.grey}>{`Cancelled: ${o.cancel_reason}`}</Notice> : null}

      <View style={{ flexDirection: 'row', gap: 3 }}>
        {LO_SHORT.map((s, i) => {
          const n = i + 1;
          const tone = n < st.stage ? colors.green : n === st.stage ? (st.late ? colors.red : colors.blue) : colors.line;
          return (
            <View key={s} style={{ flex: 1, gap: 4 }}>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: tone }} />
              {wide ? <Text style={{ fontSize: 10.5, textAlign: 'center', color: n === st.stage ? tone : colors.muted, fontWeight: n === st.stage ? '700' : '400' }}>{s}</Text> : null}
            </View>
          );
        })}
      </View>
      <Grid min={200}>
        <KeyValue label="Now with" value={o.status === 'open' ? st.with || '—' : '—'} />
        <KeyValue label={o.kind === 'service' ? 'Service provider' : 'Supplier'} value={o.supplier} />
        <KeyValue label={o.kind === 'service' ? 'Mobilisation / completion' : 'Lead time'} value={o.lead_time ?? '—'} />
        <KeyValue label={o.kind === 'service' ? 'Work arrangement' : 'Delivery arrangement'} value={o.delivery_arrangement ?? '—'} />
        <KeyValue label="Deliver to / work at" value={r.delivery_location} />
        <KeyValue label="Required by" value={r.required_on ? fmtDate(r.required_on) : '—'} />
        <KeyValue label={o.status === 'completed' ? 'Request to close' : 'Since the request'} value={total != null ? `${total} working days` : '—'} />
        <KeyValue label={o.kind === 'service' ? 'PO / LOA' : 'PO'} value={o.po_no ?? '—'} />
        {seeValues ? <KeyValue label="Selected value" value={`${fmtLkr(value)}${value != null ? (value > DIC_LIMIT ? ' · DIC needed' : ' · no DIC') : ''}`} /> : null}
      </Grid>
      <OrderDates
        module="lo"
        orderId={o.id}
        label={o.kind === 'service' ? 'Expected completion' : 'Expected delivery (in full)'}
        expected={o.expected_on}
        committed={o.committed_on}
        required={r.required_on}
        changes={dateChanges}
        keeper={keeper && open && !(o.billing === 'ipc' && agreementSigned)}
        holidays={holidays}
        people={people}
        onChange={reload}
      />
      <Button small variant="ghost" title={`Request ${r.code} – details, PR and sourcing ›`} onPress={() => router.push(`/orders/local/r/${r.id}`)} />

      <Section title="Steps">
        <StepList
          lines={lines}
          keeper={keeper && open}
          handoverId={r.id}
          orderId={o.id}
          people={people}
          onChange={reload}
          stageNames={LO_STAGES}
          onRecord={(l) => recordLoStep(dialog, l, r.id, o.id)}
          onClear={(l) => clearLoStep(dialog, l)}
          extra={{ ...(o.kind === 'material' ? { 6: deliveriesPanel } : { 6: o.billing === 'hire' ? hirePanel : o.billing === 'ipc' ? ipcPanel : workPanel }), ...(invoicesPanel ? { 7: invoicesPanel } : {}) }}
        />
      </Section>

      <FoNotes
        module="lo"
        notes={notes}
        lines={lines}
        handoverId={r.id}
        orderId={o.id}
        keeper={keeper && o.status !== 'cancelled'}
        people={people}
        onChange={reload}
        stageNames={LO_STAGES}
        who="SM Projects, the DGM, SM Estimation, the requester, the sales person and the SEE"
      />
      {o.notes ? <Muted>{o.notes}</Muted> : null}
    </Screen>
  );
}

/** "2026-10-14" → "2026-10-15" */
function addDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
