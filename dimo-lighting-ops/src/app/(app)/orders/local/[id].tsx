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
    const [r, s, d, pv, v, dl, inv, hol, nt, dc, ws, wc] = await Promise.all([
      supabase.from('lo_requests').select('*').eq('id', order.request_id).single(),
      supabase.from('lo_steps').select('*').eq('request_id', order.request_id),
      supabase.from('lo_step_defs').select('*').order('seq'),
      supabase.from('lo_request_values').select('pr_value').eq('request_id', order.request_id).maybeSingle(),
      supabase.from('lo_order_values').select('value').eq('order_id', id).maybeSingle(),
      supabase.from('lo_deliveries').select('*').eq('order_id', id).order('delivered_on'),
      supabase.from('lo_invoices').select('*').eq('order_id', id).order('received_on'),
      supabase.from('holidays').select('day'),
      supabase.from('lo_notes').select('*').eq('order_id', id).order('occurred_on', { ascending: false }),
      supabase.from('order_date_changes').select('*').eq('module', 'lo').eq('order_id', id),
      supabase.from('lo_work_stages').select('*').eq('order_id', id).order('seq'),
      supabase.from('lo_work_stage_changes').select('*, lo_work_stages!inner(order_id)').eq('lo_work_stages.order_id', id).order('requested_at', { ascending: false }),
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
      seeValues: !!v.data || keeper || ['sm_projects', 'sm_estimation', 'gm'].includes(me.role),
      deliveries: (dl.data ?? []) as LoDelivery[],
      invoices: (inv.data ?? []) as LoInvoice[],
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
      notes: (nt.data ?? []) as LoNote[],
      dateChanges: (dc.data ?? []) as DateChange[],
      work: (ws.data ?? []) as LoWorkStage[],
      stageChanges: (wc.data ?? []) as LoStageChange[],
      subs,
    };
  }, [id, keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { o, r, steps, defs, prValue, value, seeValues, deliveries, invoices, holidays, notes, subs, dateChanges, work, stageChanges } = data;
  const hasAdvance = invoices.some((i) => i.kind === 'advance' && i.status !== 'cancelled');
  // the planned dates of the work stages are the agreement's: fixed once it is signed
  const agreementSigned = steps.some((x) => x.order_id === o.id && x.step === 'agreement_signed');
  const workEditor = (keeper || me.role === 'senior_elec_engineer') && o.kind === 'service' && o.billing === 'ipc';
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
      message: o.kind === 'material' ? 'Submitted to Procurement with the signed delivery notes.' : r.exec_project_id ? 'IPCs come from the execution team: when approved, take them under the work stage (+ IPC).' : 'An invoice, or an IPC-based invoice.',
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
        ...(work.length && !r.exec_project_id ? [{ key: 'work_stage_id', label: 'For work stage', when: { key: 'kind', in: ['ipc'] }, type: 'select' as const, options: [{ value: '', label: '—' }, ...work.map((w) => ({ value: w.id, label: `${w.seq}. ${w.title}${w.pct ? ` · ${w.pct}%` : ''}${w.cert_ref ? ` · IPC ${w.cert_ref}` : ''}` }))], hint: 'The stage of the work this IPC claims' }] : []),
        { key: 'received_on', label: 'Received on', type: 'date', required: true, initial: todayIso() },
        { key: 'note', label: 'Note' },
      ],
      confirmLabel: 'Record',
    });
    if (x)
      await dialog.run(async () => {
        const { work_stage_id: stage, ...p } = x;
        const iid = (await rpc('lo_add_invoice', { p_order: o.id, p: { ...p, amount: x.amount.replace(/,/g, '') } })) as unknown as string;
        if (stage) await rpc('lo_link_invoice_stage', { p_invoice: iid, p_stage: stage });
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

  const saveStage = async (w?: LoWorkStage) => {
    const x = await dialog.prompt({
      title: w ? `Work stage ${w.seq}` : 'New work stage',
      message: 'A stage of the work the service provider claims by IPC – e.g. "Foundations for poles 1–20".',
      fields: [
        { key: 'title', label: 'What', required: true, initial: w?.title ?? '' },
        { key: 'pct', label: '% of the whole work (optional)', initial: w?.pct != null ? String(w.pct) : '' },
        ...(agreementSigned && w?.planned_on ? [] : [{ key: 'planned_on', label: 'Planned completion (agreement work programme)', type: 'date' as const, initial: w?.planned_on ?? '', hint: 'Fixed once the agreement is signed – then changed only with the SEE’s and SM Projects’ approval' }]),
        { key: 'done_on', label: 'Done / certified on (when done)', type: 'date', initial: w?.done_on ?? '', hint: 'Leave empty until the stage is actually done – not a future date' },
        { key: 'cert_ref', label: 'IPC / certificate no.', initial: w?.cert_ref ?? '' },
        { key: 'note', label: 'Note', initial: w?.note ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (x) await dialog.run(async () => { await rpc('lo_save_work_stage', { p_id: w?.id ?? null, p: { ...x, ...(agreementSigned && w?.planned_on ? { planned_on: w.planned_on } : {}), order_id: o.id } }); await reload(); }, 'Saved');
  };
  const addIpc = async (w: LoWorkStage) => {
    if (!subs.length) return dialog.toast('No approved IPC waiting – it appears here once the execution team’s IPC is approved', 'error');
    const x = await dialog.prompt({
      title: `IPC for stage ${w.seq}. ${w.title}`,
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
      confirmLabel: 'Add IPC',
    });
    if (!x) return;
    await dialog.run(async () => {
      const { sub, ...p } = x;
      await rpc('lo_add_stage_ipc', { p_stage: w.id, p_sub: sub, p: { ...p, advance_recovered: p.advance_recovered.replace(/,/g, ''), variation_amount: p.variation_amount.replace(/,/g, '') } });
      await reload();
    }, 'IPC added – SM Projects approves next');
  };
  const askDate = async (w: LoWorkStage) => {
    const x = await dialog.prompt({
      title: `Change the planned date – ${w.title}`,
      message: `Agreed date ${w.planned_on ? fmtDate(w.planned_on) : '—'}. The SEE and then SM Projects approve the change.`,
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
  const pendingDates = stageChanges.filter((c) => c.status.startsWith('pending'));
  const datePanel = pendingDates.length ? (
    <View style={{ gap: 6 }}>
      {pendingDates.map((c) => {
        const w = work.find((x) => x.id === c.stage_id);
        const mine = (c.status === 'pending_see' && me.role === 'senior_elec_engineer') || (c.status === 'pending_smp' && me.role === 'sm_projects');
        return (
          <Row key={c.id} wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between', padding: 8, borderRadius: 8, backgroundColor: '#FFF7E6' }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ color: colors.ink, fontWeight: '600' }}>{`Date change · ${w?.seq ?? ''}. ${w?.title ?? ''}: ${c.old_date ? fmtDate(c.old_date) : '—'} → ${fmtDate(c.new_date)}`}</Text>
              <Muted>{`${c.reason} · waiting for ${c.status === 'pending_see' ? 'the SEE' : 'SM Projects'}`}</Muted>
            </View>
            {mine ? (
              <Row gap={6}>
                <Button small title="Approve" onPress={() => decideDate(c, true)} />
                <Button small variant="ghost" title="Reject" onPress={() => decideDate(c, false)} />
              </Row>
            ) : null}
          </Row>
        );
      })}
    </View>
  ) : null;
  const doneStages = work.filter((w) => w.done_on);
  const workPanel = o.kind === 'service' && o.billing === 'ipc' ? (
    <>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>
          {`Work stages · ${doneStages.length} of ${work.length} done${work.some((w) => w.pct) ? ` · ${doneStages.reduce((t, w) => t + Number(w.pct ?? 0), 0)}% of the work` : ''}`}
        </Text>
        {workEditor && open ? <Button small variant="secondary" title="+ Work stage" onPress={() => saveStage()} /> : null}
      </Row>
      {datePanel}
      {agreementSigned && work.length ? <Muted>Planned dates are those of the signed agreement – a change needs the SEE’s and SM Projects’ approval.</Muted> : null}
      {!work.length ? <Muted>For work done in stages (e.g. subcontract work paid by IPC): record each stage; each IPC invoice then follows its own approvals in stage 7. “Work completed” needs every stage done.</Muted> : null}
      {work.map((w) => {
        const inv = invoices.filter((i) => i.work_stage_id === w.id && i.status !== 'cancelled');
        const late = !w.done_on && w.planned_on && w.planned_on < todayIso();
        return (
          <Row key={w.id} wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ color: colors.ink, fontWeight: '600' }}>{`${w.seq}. ${w.title}${w.pct ? ` · ${w.pct}%` : ''}`}</Text>
              <Muted>
                {[w.done_on ? `done ${fmtDate(w.done_on)}` : w.planned_on ? `planned ${fmtDate(w.planned_on)}${agreementSigned ? ' (agreement)' : ''}` : 'in progress',
                  stageChanges.filter((c) => c.stage_id === w.id && c.status === 'approved').length ? `date moved ${stageChanges.filter((c) => c.stage_id === w.id && c.status === 'approved').length}×` : null, w.cert_ref ? `IPC ${w.cert_ref}` : null, inv.length ? `${inv.length} invoice${inv.length === 1 ? '' : 's'} · ${inv.filter((i) => i.status === 'paid').length} paid` : 'no invoice yet', w.note]
                  .filter(Boolean)
                  .join(' · ')}
              </Muted>
            </View>
            <Row gap={6} style={{ alignItems: 'center' }}>
              <Pill label={w.done_on ? 'Done' : late ? 'Late' : 'In progress'} tone={w.done_on ? colors.green : late ? colors.red : colors.blue} />
              {keeper && open && r.exec_project_id ? <Button small variant="secondary" title="+ IPC" onPress={() => addIpc(w)} /> : null}
              {workEditor && open ? <Button small variant="ghost" title="Edit" onPress={() => saveStage(w)} /> : null}
              {workEditor && open && agreementSigned && w.planned_on && !w.done_on && !stageChanges.some((c) => c.stage_id === w.id && c.status.startsWith('pending')) ? (
                <Button small variant="ghost" title="Change date…" onPress={() => askDate(w)} />
              ) : null}
              {workEditor && open && !inv.length ? <Button small variant="ghost" title="Remove" onPress={async () => { if (await dialog.confirm(`Remove work stage ${w.seq}?`)) await dialog.run(async () => { await rpc('lo_remove_work_stage', { p_id: w.id }); await reload(); }, 'Removed'); }} /> : null}
            </Row>
          </Row>
        );
      })}
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
            <Muted>{[i.work_stage_id ? `for stage ${work.find((w) => w.id === i.work_stage_id)?.seq ?? ''}. ${work.find((w) => w.id === i.work_stage_id)?.title ?? ''}` : null, `dated ${fmtDate(i.invoice_date)}`, `received ${fmtDate(i.received_on)}`, i.dn_nos ? `DN ${i.dn_nos}` : null, i.advance_recovered ? `advance recovered ${fmtLkr(i.advance_recovered)}` : null, i.variation_amount ? `variation ${fmtLkr(i.variation_amount)}${i.variation_note ? ` (${i.variation_note})` : ''}` : null, i.kind === 'advance' ? 'not progress' : null, i.pay_ref ? `payment ref. ${i.pay_ref}` : null, i.note].filter(Boolean).join(' · ')}</Muted>
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
            {o.kind === 'service' ? <Pill label={o.billing === 'ipc' ? 'Paid by IPC – work stages' : 'Single invoice'} tone={colors.grey} /> : null}
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
        keeper={keeper && open}
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
          extra={{ ...(o.kind === 'material' ? { 6: deliveriesPanel } : { 6: workPanel }), ...(invoicesPanel ? { 7: invoicesPanel } : {}) }}
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
