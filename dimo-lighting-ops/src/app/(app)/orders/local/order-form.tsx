import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, ErrorBanner, Field, Loading, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { ADVANCE_TERMS, DIC_LIMIT, fmtLkr, HIRE_UNITS, paymentTerms, type LoBilling, type LoOrder, type LoRequest, type PaymentTerm } from '@/lib/localOrders';
import { supabase } from '@/lib/supabase';

/** A supplier order from Procurement's final selection (Ops): supplier, terms Ops confirms (lead time, delivery arrangement, payment term) and the selected value. */
export default function LocalOrderForm() {
  const { id, request } = useLocalSearchParams<{ id?: string; request?: string }>();
  const { data, error } = useLoad(async () => {
    let o: LoOrder | null = null;
    let value: number | null = null;
    let rate: number | null = null;
    if (id) {
      const x = await supabase.from('lo_orders').select('*').eq('id', id).single();
      if (x.error) throw new Error(x.error.message);
      o = x.data as LoOrder;
      const v = (await supabase.from('lo_order_values').select('value, hire_rate').eq('order_id', id).maybeSingle()).data as { value: number | null; hire_rate: number | null } | null;
      value = v?.value ?? null;
      rate = v?.hire_rate ?? null;
    }
    const r = await supabase.from('lo_requests').select('*').eq('id', o?.request_id ?? request ?? '').single();
    if (r.error) throw new Error(r.error.message);
    return { o, value, rate, r: r.data as LoRequest };
  }, [id, request]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  return <Form {...data} />;
}

function Form({ o, value, rate, r }: { o: LoOrder | null; value: number | null; rate: number | null; r: LoRequest }) {
  const dialog = useDialog();
  const [title, setTitle] = useState(o?.title ?? (r.kind === 'both' ? '' : r.title));
  const [kind, setKind] = useState<string>(o?.kind ?? (r.kind === 'service' ? 'service' : 'material'));
  const [supplier, setSupplier] = useState(o?.supplier ?? '');
  const [supplierNew, setSupplierNew] = useState(o?.supplier_new ? 'yes' : 'no');
  const [term, setTerm] = useState<PaymentTerm>(o?.payment_term ?? 'after_delivery');
  const [pct, setPct] = useState<number | null>(o?.advance_pct ?? null);
  const [security, setSecurity] = useState(o?.advance_security ? 'yes' : 'no');
  const [lead, setLead] = useState(o?.lead_time ?? '');
  const [delivery, setDelivery] = useState(o?.delivery_arrangement ?? '');
  const [val, setVal] = useState<number | null>(value);
  const [notes, setNotes] = useState(o?.notes ?? '');
  const [billing, setBilling] = useState<LoBilling>(o?.billing ?? 'single');
  const [unit, setUnit] = useState<string>(o?.hire_unit ?? 'day');
  const [hireRate, setHireRate] = useState<number | null>(rate);
  const service = kind === 'service';
  const terms = paymentTerms(service ? 'service' : 'material', service ? billing : 'single');
  // the term must fit the billing: when the billing changes, the nearest one that fits
  const termNow: PaymentTerm = terms.some((t) => t.value === term) ? term : (ADVANCE_TERMS.includes(term) || term === 'before_delivery' ? terms.find((t) => ADVANCE_TERMS.includes(t.value)) ?? terms[0] : terms.find((t) => !ADVANCE_TERMS.includes(t.value)) ?? terms[0]).value;
  const advance = ADVANCE_TERMS.includes(termNow) || termNow === 'before_delivery';
  const hire = service && billing === 'hire';

  const save = () =>
    dialog.run(async () => {
      const oid = (await rpc('lo_save_order', {
        p_id: o?.id ?? null,
        p: {
          request_id: r.id,
          title,
          kind,
          billing: service ? billing : 'single',
          supplier,
          supplier_new: supplierNew === 'yes',
          payment_term: termNow,
          advance_pct: ADVANCE_TERMS.includes(termNow) && pct != null ? String(pct) : '',
          advance_security: advance && security === 'yes',
          lead_time: lead,
          delivery_arrangement: delivery,
          value: val != null ? String(val) : '',
          hire_unit: hire ? unit : '',
          hire_rate: hire && hireRate != null ? String(hireRate) : '',
          notes,
        },
      })) as string;
      router.replace(`/orders/local/${oid}`);
    }, 'Saved');

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: o ? `Edit ${o.code}` : 'New supplier order' }} />
      <TestingBanner what="Local orders" always />
      <Muted>{`${r.code} · ${r.title} – ${r.project_name}. One order per supplier, from Procurement’s final selection. Confirm the lead time, delivery arrangement and payment term before the DGM approval.`}</Muted>
      <Card style={{ gap: 4 }}>
        <Field label="What is ordered from this supplier" required value={title} onChangeText={setTitle} />
        {r.kind === 'both' ? (
          <Select label="Material or service" required value={kind} onChange={setKind} options={[{ value: 'material', label: 'Material – PO, delivery notes' }, { value: 'service', label: 'Service – PO / LOA, bonds, agreement, IPCs' }]} />
        ) : null}
        {service ? (
          <Select
            label="Billing"
            required
            value={billing}
            onChange={(x) => setBilling(x as LoBilling)}
            options={[
              { value: 'single', label: 'Single invoice – one-off job (e.g. a repair, a single crane lift)' },
              { value: 'ipc', label: 'Paid by IPC (e.g. subcontract work)' },
              { value: 'milestone', label: 'Work basis – paid per deliverable (e.g. a consultant’s design, report)' },
              { value: 'hire', label: 'Hire – machine, equipment or consultant time, paid per period' },
            ]}
            hint={
              billing === 'ipc'
                ? 'The execution team’s approved IPCs are taken onto the order; the planned completion is fixed when the agreement is signed'
                : billing === 'milestone'
                  ? 'The agreement’s deliverables are recorded with their planned dates; each invoice is for a deliverable the SEE has accepted'
                  : billing === 'hire'
                  ? 'On hire / off hire dates; each invoice covers a period with the hours / days used, certified by the SEE (hire / time sheet)'
                  : 'One invoice when the job is done (an advance if agreed)'
            }
          />
        ) : null}
        {hire ? (
          <Row gap={8} wrap>
            <View style={{ flex: 1, minWidth: 200 }}>
              <Select label="Hired by the" required value={unit} onChange={setUnit} options={HIRE_UNITS} />
            </View>
            <View style={{ flex: 1, minWidth: 200 }}>
              <NumberField label={`Agreed rate per ${unit} (LKR)`} value={hireRate} onChange={setHireRate} hint="Checked against each invoice’s usage" />
            </View>
          </Row>
        ) : null}
        <Field label={service ? 'Service provider' : 'Supplier'} required value={supplier} onChangeText={setSupplier} />
        <Select label="Registered as a supplier?" value={supplierNew} onChange={setSupplierNew} options={[{ value: 'no', label: 'Yes – already registered' }, { value: 'yes', label: 'No – Procurement registers it before the PO' }]} />
        <NumberField label="Selected value (LKR)" value={val} onChange={setVal} hint={`DIC approval above ${fmtLkr(DIC_LIMIT)}${val != null ? (val > DIC_LIMIT ? ' – needed' : ' – not needed') : ''}`} />
      </Card>
      <Section title="Terms confirmed by Operations">
        <Card style={{ gap: 4 }}>
          <Field label={service ? 'Mobilisation / completion time' : 'Manufacturing / delivery lead time'} value={lead} onChangeText={setLead} placeholder="e.g. 10 working days" />
          <Field label={service ? 'Work arrangement' : 'Delivery arrangement'} value={delivery} onChangeText={setDelivery} placeholder={service ? 'e.g. provider’s crane and crew, DIMO supervision' : 'e.g. supplier’s lorry to site, unloading by DIMO'} />
          <Select label="Payment term" required value={termNow} onChange={(x) => setTerm(x as PaymentTerm)} options={terms} />
          {ADVANCE_TERMS.includes(termNow) ? (
            <NumberField
              label="Advance %"
              value={pct}
              onChange={setPct}
              hint={termNow === 'advance_ipc' ? 'Recovered from the IPCs; the balance is paid by IPC' : termNow === 'advance_periodic' ? 'Recovered from the period invoices' : termNow === 'advance_milestone' ? 'Recovered from the deliverable invoices' : service ? 'The balance is paid after completion' : 'The balance is paid after delivery'}
            />
          ) : null}
          {advance ? (
            <Select
              label={service ? 'Advance payment bond asked?' : 'Advance payment guarantee asked?'}
              value={security}
              onChange={setSecurity}
              options={[{ value: 'yes', label: 'Yes – before the advance' }, { value: 'no', label: 'No – not needed for this one' }]}
            />
          ) : null}
          <Field label="Notes" multiline value={notes} onChangeText={setNotes} />
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
        <Button title={o ? 'Save' : 'Add order'} onPress={save} />
      </Row>
    </Screen>
  );
}
