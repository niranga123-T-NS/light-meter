import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { FoNotes } from '@/components/foreign/Notes';
import { StepList } from '@/components/foreign/StepList';
import { clearLoStep, recordLoStep } from '@/components/local/actions';
import { TestingBanner } from '@/components/Testing';
import { Button, colors, ErrorBanner, Grid, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section, useWide } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { todayIso, workdays } from '@/lib/foreignOrders';
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
  type LoInvoice,
  type LoNote,
  type LoOrder,
  type LoRequest,
  type LoStep,
  type LoStepDef,
} from '@/lib/localOrders';
import { supabase } from '@/lib/supabase';

type SubInv = { id: string; code: string | null; invoice_no: string; amount: number; status: string };

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
    const [r, s, d, pv, v, dl, inv, hol, nt] = await Promise.all([
      supabase.from('lo_requests').select('*').eq('id', order.request_id).single(),
      supabase.from('lo_steps').select('*').eq('request_id', order.request_id),
      supabase.from('lo_step_defs').select('*').order('seq'),
      supabase.from('lo_request_values').select('pr_value').eq('request_id', order.request_id).maybeSingle(),
      supabase.from('lo_order_values').select('value').eq('order_id', id).maybeSingle(),
      supabase.from('lo_deliveries').select('*').eq('order_id', id).order('delivered_on'),
      supabase.from('lo_invoices').select('*').eq('order_id', id).order('received_on'),
      supabase.from('holidays').select('day'),
      supabase.from('lo_notes').select('*').eq('order_id', id).order('occurred_on', { ascending: false }),
    ]);
    const req = r.data as LoRequest;
    // subcontractor invoices (IPCs) recorded on the execution project, to link a service invoice to
    const subs = keeper && order.kind === 'service' && req.exec_project_id
      ? (((await supabase.from('sub_invoices').select('id, code, invoice_no, amount, status').eq('exec_project_id', req.exec_project_id).neq('status', 'cancelled')).data ?? []) as SubInv[])
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
      subs,
    };
  }, [id, keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { o, r, steps, defs, prValue, value, seeValues, deliveries, invoices, holidays, notes, subs } = data;
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
      message: o.kind === 'material' ? 'Submitted to Procurement with the signed delivery notes.' : r.exec_project_id ? 'Link the IPC recorded on the project (Subcontractor invoices).' : 'An invoice, or an IPC-based invoice.',
      fields: [
        { key: 'kind', label: 'Type', type: 'select', required: true, initial: o.kind === 'service' ? 'ipc' : 'invoice', options: [{ value: 'invoice', label: 'Invoice' }, ...(o.kind === 'service' ? [{ value: 'ipc', label: 'IPC-based invoice' }] : []), { value: 'advance', label: 'Advance invoice' }] },
        { key: 'invoice_no', label: 'Invoice no.', required: true },
        { key: 'invoice_date', label: 'Invoice date', type: 'date', required: true, initial: todayIso() },
        { key: 'amount', label: 'Amount (LKR)', required: true },
        ...(o.kind === 'material' ? [{ key: 'dn_nos', label: 'Delivery note nos.', initial: deliveries.map((d) => d.dn_no).join(', '), hint: 'Not needed for an advance invoice' }] : []),
        ...(subs.length ? [{ key: 'sub_invoice_id', label: 'Subcontractor invoice (IPC) on the project', type: 'select' as const, options: [{ value: '', label: '—' }, ...subs.map((s) => ({ value: s.id, label: `${s.code ?? ''} · ${s.invoice_no} · ${fmtLkr(s.amount)}` }))] }] : []),
        { key: 'received_on', label: 'Received on', type: 'date', required: true, initial: todayIso() },
        { key: 'note', label: 'Note' },
      ],
      confirmLabel: 'Record',
    });
    if (x) await dialog.run(async () => { await rpc('lo_add_invoice', { p_order: o.id, p: { ...x, amount: x.amount.replace(/,/g, '') } }); await reload(); }, 'Recorded');
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

  const invoicesPanel = seeValues ? (
    <>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>{`Invoices · paid ${fmtLkr(paid)}${value != null ? ` of ${fmtLkr(value)}` : ''}`}</Text>
        {keeper && open ? <Button small variant="secondary" title="+ Invoice" onPress={addInvoice} disabled={!ordered} /> : null}
      </Row>
      <Muted>{`Approval: ${chain.map((p) => INVOICE_POINTS[p].who).join(' → ')}`}</Muted>
      {invoices.map((i) => {
        const next = invoiceNext(i, chain);
        const done = chain.filter((p) => (i as unknown as Record<string, string | null>)[`${p}_on`]);
        return (
          <View key={i.id} style={{ gap: 4, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
            <Row wrap gap={6} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.ink, fontWeight: '600', flexShrink: 1 }}>{`${i.kind === 'ipc' ? 'IPC invoice' : i.kind === 'advance' ? 'Advance invoice' : 'Invoice'} ${i.invoice_no} · ${fmtLkr(i.amount)}`}</Text>
              <Pill label={i.status === 'paid' ? `Paid ${fmtDate(i.paid_on)}` : i.status === 'cancelled' ? 'Cancelled' : next === 'paid' || !next ? 'Awaiting payment' : `With ${INVOICE_POINTS[next].who}`} tone={i.status === 'paid' ? colors.green : i.status === 'cancelled' ? colors.grey : colors.blue} />
            </Row>
            <Muted>
              {[`dated ${fmtDate(i.invoice_date)}`, `received ${fmtDate(i.received_on)}`, i.dn_nos ? `DN ${i.dn_nos}` : null, ...done.map((p) => `${p === 'paid' ? 'Paid' : INVOICE_POINTS[p].who} ${fmtDate((i as unknown as Record<string, string>)[`${p}_on`])}`), i.pay_ref, i.note]
                .filter(Boolean)
                .join(' · ')}
            </Muted>
            {keeper && i.status !== 'cancelled' ? (
              <Row wrap gap={6}>
                {next ? <Button small title={`${INVOICE_POINTS[next].label}…`} onPress={() => invStep(i, next)} /> : null}
                {done.length ? <Button small variant="ghost" title="Undo last" onPress={() => invUndo(i, done[done.length - 1])} /> : null}
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
          extra={{ ...(o.kind === 'material' ? { 6: deliveriesPanel } : {}), ...(invoicesPanel ? { 7: invoicesPanel } : {}) }}
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
