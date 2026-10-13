import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, ErrorBanner, Field, Loading, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { DIC_LIMIT, fmtLkr, PAYMENT_TERMS, type LoOrder, type LoRequest, type PaymentTerm } from '@/lib/localOrders';
import { supabase } from '@/lib/supabase';

/** A supplier order from Procurement's final selection (Ops): supplier, terms Ops confirms (lead time, delivery arrangement, payment term) and the selected value. */
export default function LocalOrderForm() {
  const { id, request } = useLocalSearchParams<{ id?: string; request?: string }>();
  const { data, error } = useLoad(async () => {
    let o: LoOrder | null = null;
    let value: number | null = null;
    if (id) {
      const x = await supabase.from('lo_orders').select('*').eq('id', id).single();
      if (x.error) throw new Error(x.error.message);
      o = x.data as LoOrder;
      value = ((await supabase.from('lo_order_values').select('value').eq('order_id', id).maybeSingle()).data as { value: number | null } | null)?.value ?? null;
    }
    const r = await supabase.from('lo_requests').select('*').eq('id', o?.request_id ?? request ?? '').single();
    if (r.error) throw new Error(r.error.message);
    return { o, value, r: r.data as LoRequest };
  }, [id, request]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  return <Form {...data} />;
}

function Form({ o, value, r }: { o: LoOrder | null; value: number | null; r: LoRequest }) {
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
  const advance = term === 'advance_balance' || term === 'before_delivery';
  const service = kind === 'service';

  const save = () =>
    dialog.run(async () => {
      const oid = (await rpc('lo_save_order', {
        p_id: o?.id ?? null,
        p: {
          request_id: r.id,
          title,
          kind,
          supplier,
          supplier_new: supplierNew === 'yes',
          payment_term: term,
          advance_pct: term === 'advance_balance' && pct != null ? String(pct) : '',
          advance_security: advance && security === 'yes',
          lead_time: lead,
          delivery_arrangement: delivery,
          value: val != null ? String(val) : '',
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
        <Field label={service ? 'Service provider' : 'Supplier'} required value={supplier} onChangeText={setSupplier} />
        <Select label="Registered as a supplier?" value={supplierNew} onChange={setSupplierNew} options={[{ value: 'no', label: 'Yes – already registered' }, { value: 'yes', label: 'No – Procurement registers it before the PO' }]} />
        <NumberField label="Selected value (LKR)" value={val} onChange={setVal} hint={`DIC approval above ${fmtLkr(DIC_LIMIT)}${val != null ? (val > DIC_LIMIT ? ' – needed' : ' – not needed') : ''}`} />
      </Card>
      <Section title="Terms confirmed by Operations">
        <Card style={{ gap: 4 }}>
          <Field label={service ? 'Mobilisation / completion time' : 'Manufacturing / delivery lead time'} value={lead} onChangeText={setLead} placeholder="e.g. 10 working days" />
          <Field label={service ? 'Work arrangement' : 'Delivery arrangement'} value={delivery} onChangeText={setDelivery} placeholder={service ? 'e.g. provider’s crane and crew, DIMO supervision' : 'e.g. supplier’s lorry to site, unloading by DIMO'} />
          <Select label="Payment term" required value={term} onChange={(x) => setTerm(x as PaymentTerm)} options={PAYMENT_TERMS} />
          {term === 'advance_balance' ? <NumberField label="Advance %" value={pct} onChange={setPct} hint="The balance is paid after delivery" /> : null}
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
