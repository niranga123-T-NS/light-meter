import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { Button, Card, DateField, ErrorBanner, Field, Loading, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { TENDER_EDITORS, TENDER_RESULT, TENDER_TYPES, type Tender } from '@/lib/tenders';

type Form = {
  tender_no: string;
  tender_name: string;
  client_name: string;
  project_name: string;
  tender_type: string;
  duty_status: string;
  closing_date: string | null;
  opening_date: string | null;
  our_price: number | null;
  our_brands: string;
  delivery_period: string;
  validity: string;
  result_status: Tender['result_status'];
  lost_reason: string;
  evaluation_notes: string;
  sales_person_id: string | null;
};

/** Add a tender result (also a past tender, with no visit) or change one: the Estimation team, SM Projects or its sales person */
export default function TenderEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const me = useMe();
  const dialog = useDialog();
  const masters = useMasters();
  const people = usePeople();
  const [form, setForm] = useState<Form | null>(null);
  const { data, error } = useLoad(async () => {
    if (!id) return null;
    const { data: t, error: e } = await supabase.from('tenders').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    return t as Tender;
  }, [id]);
  if (id && !data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const t = data;
  const f: Form =
    form ??
    (t
      ? {
          tender_no: t.tender_no,
          tender_name: t.tender_name,
          client_name: t.client_name ?? '',
          project_name: t.project_name ?? '',
          tender_type: t.tender_type,
          duty_status: t.duty_status,
          closing_date: t.closing_date,
          opening_date: t.opening_date,
          our_price: t.our_price,
          our_brands: (t.our_brands ?? []).join(', '),
          delivery_period: t.delivery_period ?? '',
          validity: t.validity ?? '',
          result_status: t.result_status,
          lost_reason: t.lost_reason ?? '',
          evaluation_notes: t.evaluation_notes ?? '',
          sales_person_id: t.sales_person_id,
        }
      : {
          tender_no: '', tender_name: '', client_name: '', project_name: '', tender_type: 'open', duty_status: 'duty_paid', closing_date: null, opening_date: null,
          our_price: null, our_brands: '', delivery_period: '', validity: '', result_status: 'opened', lost_reason: '', evaluation_notes: '', sales_person_id: null,
        });
  const set = (p: Partial<Form>) => setForm({ ...f, ...p });
  const canEdit = TENDER_EDITORS.includes(me.role) || (t && t.sales_person_id === me.id);
  const linked = !!(t?.client_organization_id || t?.project_id);
  const salesPeople = Object.values(people).filter((p) => p.active && (p.role === 'asm_building' || p.role === 'asm_infra'));

  const save = () =>
    dialog.run(async () => {
      if (!f.tender_no.trim() || !f.tender_name.trim()) throw new Error('Enter the tender number and name');
      if (!linked && (!f.client_name.trim() || !f.project_name.trim())) throw new Error('Enter the client and the project');
      if (!f.closing_date || !f.opening_date) throw new Error('Enter the closing and opening dates');
      const row = {
        tender_no: f.tender_no.trim(),
        tender_name: f.tender_name.trim(),
        client_name: f.client_name.trim() || null,
        project_name: f.project_name.trim() || null,
        tender_type: f.tender_type,
        duty_status: f.duty_status,
        closing_date: f.closing_date,
        opening_date: f.opening_date,
        our_price: f.our_price,
        our_brands: f.our_brands.split(',').map((x) => x.trim()).filter(Boolean),
        delivery_period: f.delivery_period || null,
        validity: f.validity || null,
        result_status: f.result_status,
        lost_reason: f.result_status === 'awarded_to_competitor' ? f.lost_reason || null : null,
        evaluation_notes: f.evaluation_notes || null,
        ...(t?.visit_id ? {} : { sales_person_id: f.sales_person_id }),
        updated_at: new Date().toISOString(),
      };
      if (t) {
        const { error: e } = await supabase.from('tenders').update(row).eq('id', t.id);
        if (e) throw new Error(e.message);
        router.replace(`/tenders/${t.id}`);
      } else {
        const { data: n, error: e } = await supabase.from('tenders').insert(row).select('id').single();
        if (e) throw new Error(e.message);
        router.replace(`/tenders/${n.id}`);
      }
    }, t ? 'Saved' : 'Saved – now attach the BOQ and add the competitors');

  if (!canEdit) return <Screen><Muted>You can view tender results but not change them.</Muted></Screen>;
  const cur = f.duty_status === 'duty_free' ? 'USD' : 'LKR';
  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: t ? `Change ${t.tender_no}` : 'New tender result' }} />
      {!t ? <Muted>For a tender already in the system through a sales visit, open it from the list instead. Use this for past tenders and tenders without a visit.</Muted> : null}
      <Section title="The tender">
        <Card style={{ gap: 4 }}>
          <Row gap={8} wrap>
            <Field label="Tender no." required value={f.tender_no} onChangeText={(v) => set({ tender_no: v })} />
            <Field label="Tender name" required value={f.tender_name} onChangeText={(v) => set({ tender_name: v })} />
          </Row>
          <Field label="Client" required={!linked} value={f.client_name} onChangeText={(v) => set({ client_name: v })} hint={linked ? 'Linked to the customer in the system – type only to show a different name' : 'e.g. Road Development Authority'} />
          <Field label="Project" required={!linked} value={f.project_name} onChangeText={(v) => set({ project_name: v })} hint={linked ? 'Linked to the project in the system' : undefined} />
          <Select label="Tender type" value={f.tender_type} onChange={(v) => set({ tender_type: v })} options={TENDER_TYPES} />
          <Select
            label="Duty status (sets the currency)"
            value={f.duty_status}
            onChange={(v) => set({ duty_status: v })}
            options={[
              { value: 'duty_paid', label: 'Duty paid – LKR' },
              { value: 'duty_free', label: 'Duty free – USD' },
            ]}
          />
          <Row gap={8} wrap>
            <DateField label="Closing date" required value={f.closing_date} onChange={(v) => set({ closing_date: v })} />
            <DateField label="Opening date" required value={f.opening_date} onChange={(v) => set({ opening_date: v })} />
          </Row>
          {!t?.visit_id ? (
            <Select
              label="Sales person (optional)"
              value={f.sales_person_id}
              searchable
              onChange={(v) => set({ sales_person_id: v || null })}
              options={[{ value: '', label: '— none —' }, ...salesPeople.map((p) => ({ value: p.id, label: p.full_name }))]}
            />
          ) : null}
        </Card>
      </Section>
      <Section title="Our bid and the result">
        <Card style={{ gap: 4 }}>
          <NumberField label="Our price" suffix={cur} value={f.our_price} onChange={(v) => set({ our_price: v })} />
          <Field label="Brand(s) we offered" hint="Comma separated" value={f.our_brands} onChangeText={(v) => set({ our_brands: v })} />
          <Row gap={8} wrap>
            <Field label="Delivery period" value={f.delivery_period} onChangeText={(v) => set({ delivery_period: v })} />
            <Field label="Validity" value={f.validity} onChangeText={(v) => set({ validity: v })} />
          </Row>
          <Select
            label="Result"
            value={f.result_status}
            onChange={(v) => set({ result_status: v as Tender['result_status'] })}
            options={(Object.keys(TENDER_RESULT) as Tender['result_status'][]).map((k) => ({ value: k, label: TENDER_RESULT[k].label }))}
          />
          {f.result_status === 'awarded_to_competitor' ? (
            <Select label="Lost reason" value={f.lost_reason} onChange={(v) => set({ lost_reason: v })} options={masters.values('lost_reason').map((v) => ({ value: v, label: v }))} />
          ) : null}
          <Field label="Evaluation notes" multiline value={f.evaluation_notes} onChangeText={(v) => set({ evaluation_notes: v })} hint="Compliance issues, alternates offered, consultant remarks" />
        </Card>
      </Section>
      <Muted>After saving: attach the tender BOQ (required) and add each competitor with their price – tap a competitor later to add brands and item prices.</Muted>
      <Row gap={8}>
        <Button title={t ? 'Save changes' : 'Save'} onPress={save} />
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
      </Row>
    </Screen>
  );
}
