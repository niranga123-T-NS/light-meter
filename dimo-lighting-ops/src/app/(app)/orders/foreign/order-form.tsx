import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, Chip, colors, DateField, ErrorBanner, Field, Loading, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { CURRENCIES, type FoOrder, type Handover, type OrderValues } from '@/lib/foreignOrders';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Form = {
  title: string;
  kind: 'material' | 'service';
  vendor: string;
  vendor_new: boolean;
  codes_new: boolean;
  incoterm: string;
  payment: 'TT' | 'LC';
  duty: string;
  inland: boolean;
  required_on: string | null;
  prs: string[];
  factory: string;
  address: string;
  loading: string;
  mode: string;
  dangerous: string;
  dg_details: string;
  currency: string;
  pi_value: number | null;
  lc_amount: number | null;
  notes: string;
};

/** New or edited import order (Ops). Fields appear only where they apply: inland transport for FOB, the LC amount for an LC. */
export default function ImportOrderForm() {
  const { id, ho } = useLocalSearchParams<{ id?: string; ho?: string }>();
  const dialog = useDialog();
  const { data, error } = useLoad(async () => {
    let o: FoOrder | null = null;
    let v: OrderValues | null = null;
    if (id) {
      const r = await supabase.from('fo_orders').select('*').eq('id', id).single();
      if (r.error) throw new Error(r.error.message);
      o = r.data as FoOrder;
      v = ((await supabase.from('fo_order_values').select('*').eq('order_id', id).maybeSingle()).data ?? null) as OrderValues | null;
    }
    const h = await supabase.from('fo_handovers').select('*').eq('id', o?.handover_id ?? ho ?? '').single();
    if (h.error) throw new Error(h.error.message);
    const mrId = (h.data as Handover).mr_id;
    // from a site material request: the date the site needs it, set by the site
    const mrDate = mrId ? (((await supabase.from('material_requests').select('required_date').eq('id', mrId).maybeSingle()).data ?? null) as { required_date: string } | null)?.required_date ?? null : null;
    return { o, v, h: h.data as Handover, mrDate };
  }, [id, ho]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  return <OrderForm o={data.o} v={data.v} h={data.h} mrDate={data.mrDate} onSaved={(oid) => router.replace(`/orders/foreign/${oid}`)} dialog={dialog} />;
}

function OrderForm({ o, v, h, mrDate, onSaved, dialog }: { o: FoOrder | null; v: OrderValues | null; h: Handover; mrDate: string | null; onSaved: (id: string) => void; dialog: ReturnType<typeof useDialog> }) {
  const [f, setF] = useState<Form>({
    title: o?.title ?? '',
    kind: o?.kind ?? 'material',
    vendor: o?.vendor ?? '',
    vendor_new: o?.vendor_new ?? false,
    codes_new: o?.codes_new ?? false,
    incoterm: o?.incoterm ?? '',
    payment: o?.payment ?? 'TT',
    duty: o?.duty ?? '',
    inland: o?.inland ?? false,
    required_on: mrDate ?? o?.required_on ?? null,
    prs: o?.pr_nos ? o.pr_nos.split(',').map((x) => x.trim()).filter(Boolean) : [],
    factory: o?.factory_location ?? '',
    address: o?.mfr_address ?? '',
    loading: o?.loading_port ?? '',
    mode: o?.planned_mode ?? '',
    dangerous: o?.dangerous == null ? '' : o.dangerous ? 'yes' : 'no',
    dg_details: o?.dg_details ?? '',
    currency: v?.currency ?? 'USD',
    pi_value: v?.pi_value ?? null,
    lc_amount: v?.lc_amount ?? null,
    notes: o?.notes ?? '',
  });
  const [pr, setPr] = useState('');
  const set = <K extends keyof Form>(k: K, val: Form[K]) => setF((x) => ({ ...x, [k]: val }));
  const material = f.kind === 'material';

  const addPr = () => {
    const t = pr.trim();
    if (!t) return;
    if (f.prs.includes(t)) return dialog.toast('This PR no. is already added', 'error');
    set('prs', [...f.prs, t]);
    setPr('');
  };
  const save = () =>
    dialog.run(async () => {
      if (material && !f.dangerous) throw new Error('Does the order contain dangerous goods? Choose Yes or No');
      if (material && f.dangerous === 'yes' && !f.dg_details.trim()) throw new Error('Dangerous goods: enter the class / UN number and what it is');
      const oid = (await rpc('fo_save_order', {
        p_id: o?.id ?? null,
        p: {
          handover_id: h.id,
          title: f.title,
          kind: f.kind,
          vendor: f.vendor,
          vendor_new: f.vendor_new,
          codes_new: material && f.codes_new,
          incoterm: material ? f.incoterm : null,
          payment: f.payment,
          duty: material ? f.duty : null,
          inland: material && f.incoterm === 'FOB' && f.inland,
          required_on: f.required_on ?? '',
          pr_nos: f.prs.join(', '),
          currency: f.currency,
          pi_value: f.pi_value != null ? String(f.pi_value) : '',
          lc_amount: f.payment === 'LC' && f.lc_amount != null ? String(f.lc_amount) : '',
          duty_lkr: v?.duty_lkr != null ? String(v.duty_lkr) : '',
          notes: f.notes,
        },
      })) as string;
      if (material && f.factory.trim() !== (o?.factory_location ?? '')) await rpc('fo_set_factory', { p_order: oid, p_location: f.factory, p_lat: null, p_lng: null });
      if (f.address.trim() !== (o?.mfr_address ?? '') || (material ? f.loading.trim() : '') !== (o?.loading_port ?? ''))
        await rpc('fo_set_origin', { p_order: oid, p_address: f.address, p_loading: material ? f.loading : '' });
      if (material && f.mode !== (o?.planned_mode ?? '')) await rpc('fo_set_planned_mode', { p_order: oid, p_mode: f.mode || null });
      await rpc('fo_set_dangerous', { p_order: oid, p_dangerous: material ? f.dangerous === 'yes' : false, p_details: f.dg_details });
      onSaved(oid);
    }, 'Saved');

  const yes = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ];
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: o ? `Edit ${o.code}` : 'New import order' }} />
      <TestingBanner what="Foreign orders" always />
      <Muted>{`${h.code} · ${h.project_name} · ${h.client}. One import order per manufacturer (or per shipment); its terms decide which steps it goes through.`}</Muted>
      <Card style={{ gap: 4 }}>
        <Field label="What is ordered" required value={f.title} onChangeText={(t) => set('title', t)} placeholder="e.g. Façade luminaires, LED drivers, commissioning" />
        <Select label="Material or service" required value={f.kind} onChange={(x) => set('kind', x as Form['kind'])} options={[{ value: 'material', label: 'Material' }, { value: 'service', label: 'Service' }]} />
        <Field label="Vendor / manufacturer" required value={f.vendor} onChangeText={(t) => set('vendor', t)} />
        <Field label="Manufacturer address" multiline value={f.address} onChangeText={(t) => set('address', t)} placeholder="e.g. Example Leuchten GmbH, Werkstrasse 5, 59755 Arnsberg, Germany" />
        {material ? <Field label="Factory location (city, country)" value={f.factory} onChangeText={(t) => set('factory', t)} placeholder="e.g. Arnsberg, Germany" hint="For the route map – where the goods are collected, if not the address above" /> : null}
        <Select label="Vendor registered in SAP?" value={f.vendor_new ? 'no' : 'yes'} onChange={(x) => set('vendor_new', x === 'no')} options={[{ value: 'yes', label: 'Yes – already in SAP' }, { value: 'no', label: 'No – send the registration request' }]} />
        {material ? (
          <Select label="Material codes in SAP?" value={f.codes_new ? 'no' : 'yes'} onChange={(x) => set('codes_new', x === 'no')} options={[{ value: 'yes', label: 'Yes – all in SAP' }, { value: 'no', label: 'No – request from MDM' }]} />
        ) : null}
      </Card>
      <Section title="Terms">
        <Card style={{ gap: 4 }}>
          {material ? (
            <Select
              label="Incoterm"
              required
              value={f.incoterm}
              onChange={(x) => setF((s) => ({ ...s, incoterm: x, inland: x === 'FOB' ? s.inland : false }))}
              options={[{ value: 'EXW', label: 'EXW – Ex works' }, { value: 'FOB', label: 'FOB' }, { value: 'CIF', label: 'CIF – manufacturer’s forwarder' }]}
            />
          ) : null}
          <Select label="Payment" required value={f.payment} onChange={(x) => set('payment', x as Form['payment'])} options={[{ value: 'TT', label: 'TT' }, { value: 'LC', label: 'LC' }]} />
          {material ? <Select label="Duty" required value={f.duty} onChange={(x) => set('duty', x)} options={[{ value: 'paid', label: 'Duty paid' }, { value: 'free', label: 'Duty free' }]} /> : null}
          {material ? (
            <Select
              label="Planned freight"
              value={f.mode}
              onChange={(x) => set('mode', x)}
              options={[{ value: 'sea', label: 'Sea freight' }, { value: 'air', label: 'Air freight' }, { value: 'courier', label: 'Courier' }, { value: '', label: 'Not decided yet' }]}
              hint="The shipment starts with it; set from the shipment if left open"
            />
          ) : null}
          {material ? (
            <Field
              label={f.mode === 'air' ? 'Airport of loading' : f.mode === 'sea' ? 'Port of loading' : 'Port / airport of loading'}
              value={f.loading}
              onChangeText={(t) => set('loading', t)}
              placeholder={f.mode === 'air' ? 'e.g. FRA, Frankfurt' : 'e.g. Hamburg, Shanghai'}
              hint={f.incoterm === 'FOB' ? 'The FOB port in the PO – the shipment starts with it' : 'From the PI / PO – the shipment starts with it'}
            />
          ) : null}
          {material && f.incoterm === 'FOB' ? (
            <Select label="Inland transport to the port?" value={f.inland ? 'yes' : 'no'} onChange={(x) => set('inland', x === 'yes')} options={yes} hint="FOB only" />
          ) : null}
          {mrDate ? (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 }}>Required at site by</Text>
              <Text style={{ color: colors.ink }}>{fmtDate(mrDate)}</Text>
              <Muted>From the site material request – the SEE changes it there.</Muted>
            </View>
          ) : (
            <DateField label="Required at site by" value={f.required_on} onChange={(x) => set('required_on', x)} />
          )}
        </Card>
      </Section>
      <Section title="SAP PR nos.">
        <Card style={{ gap: 6 }}>
          {material ? (
            <>
              <Select
                label="Dangerous goods?"
                required
                value={f.dangerous}
                onChange={(x) => set('dangerous', x)}
                options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes – dangerous goods (flagged at every stage)' }]}
                hint="Set when the PR is created"
              />
              {f.dangerous === 'yes' ? (
                <Field label="Class / UN no. and what it is" required value={f.dg_details} onChangeText={(t) => set('dg_details', t)} placeholder="e.g. Class 9 – UN3481 lithium-ion batteries in emergency luminaires" />
              ) : null}
            </>
          ) : null}
          {f.prs.length ? (
            <Row wrap gap={6}>
              {f.prs.map((x) => (
                <Chip key={x} label={`${x}  ✕`} onPress={() => set('prs', f.prs.filter((y) => y !== x))} />
              ))}
            </Row>
          ) : (
            <Muted>No PR no. yet – add them one by one.</Muted>
          )}
          <Row gap={8} style={{ alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label="PR no." value={pr} onChangeText={setPr} onSubmitEditing={addPr} placeholder="e.g. 7055642661/10" />
            </View>
            <View style={{ paddingBottom: 18 }}>
              <Button small variant="secondary" title="+ Add" onPress={addPr} disabled={!pr.trim()} />
            </View>
          </Row>
        </Card>
      </Section>
      <Section title="Value">
        <Card style={{ gap: 4 }}>
          <Select label="Currency" value={f.currency} onChange={(x) => set('currency', x)} options={CURRENCIES} />
          <NumberField label={`PI value (${f.currency})`} value={f.pi_value} onChange={(x) => set('pi_value', x)} />
          {f.payment === 'LC' ? <NumberField label={`LC amount (${f.currency})`} value={f.lc_amount} onChange={(x) => set('lc_amount', x)} /> : null}
          <Field label="Notes" multiline value={f.notes} onChangeText={(t) => set('notes', t)} />
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
        <Button title={o ? 'Save' : 'Add import order'} onPress={save} />
      </Row>
    </Screen>
  );
}
