import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { PersonPicker } from '@/components/pickers';
import { Button, Card, DateField, ErrorBanner, Field, Loading, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { RETENTION_FORMS } from '@/lib/retentions';
import { rpc, supabase } from '@/lib/supabase';
import type { Currency, Retention } from '@/lib/types';

type Form = {
  project_name: string;
  end_client: string;
  main_contractor: string;
  contract_no: string;
  contract_value: number | null;
  retention_pct: number | null;
  retention_value: number | null;
  currency: Currency;
  retention_form: 'cash_withheld' | 'bank_guarantee';
  bg_expiry: string | null;
  start_date: string | null;
  due_date: string | null;
  sales_person_id: string | null;
  notes: string;
};

const blank: Form = {
  project_name: '',
  end_client: '',
  main_contractor: '',
  contract_no: '',
  contract_value: null,
  retention_pct: null,
  retention_value: null,
  currency: 'LKR',
  retention_form: 'cash_withheld',
  bg_expiry: null,
  start_date: null,
  due_date: null,
  sales_person_id: null,
  notes: '',
};

/** Record or edit a retention (Operations Executive, SM Projects, GM / DGM). */
export default function RetentionEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const dialog = useDialog();
  const [f, setF] = useState<Form | null>(id ? null : blank);
  const [error, setError] = useState<string | null>(null);
  const existing = useLoad(async () => {
    if (!id) return null;
    const { data } = await supabase.from('retentions').select('*').eq('id', id).single();
    return data as Retention;
  }, [id]);
  if (id && !f && existing.data) {
    const r = existing.data;
    setF({
      project_name: r.project_name,
      end_client: r.end_client,
      main_contractor: r.main_contractor ?? '',
      contract_no: r.contract_no ?? '',
      contract_value: r.contract_value,
      retention_pct: r.retention_pct,
      retention_value: r.retention_value,
      currency: r.currency,
      retention_form: r.retention_form,
      bg_expiry: r.bg_expiry,
      start_date: r.start_date,
      due_date: r.due_date,
      sales_person_id: r.sales_person_id,
      notes: r.notes ?? '',
    });
  }
  if (!f) return <Screen>{existing.error ? <ErrorBanner message={existing.error} /> : <Loading />}</Screen>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => (s ? { ...s, [k]: v } : s));
  const calc = f.contract_value && f.retention_pct ? Math.round(f.contract_value * f.retention_pct) / 100 : null;

  const save = () => {
    setError(null);
    if (!f.project_name.trim() || !f.end_client.trim()) return setError('Project name and end client are required');
    if (!f.start_date || !f.due_date) return setError('Retention start date and due date are required');
    if (f.due_date < f.start_date) return setError('The due date must be after the start date');
    if (f.retention_value == null && calc == null) return setError('Enter the retention value, or the contract value and retention %');
    if (f.retention_form === 'bank_guarantee' && !f.bg_expiry) return setError('Enter the bank guarantee expiry date');
    return dialog.run(async () => {
      const rid = await rpc<string>('save_retention', {
        p_id: id ?? null,
        p_data: {
          ...f,
          contract_value: f.contract_value == null ? '' : String(f.contract_value),
          retention_pct: f.retention_pct == null ? '' : String(f.retention_pct),
          retention_value: f.retention_value == null ? '' : String(f.retention_value),
          bg_expiry: f.retention_form === 'bank_guarantee' ? f.bg_expiry : '',
          due_date: id ? '' : f.due_date,
          sales_person_id: f.sales_person_id ?? '',
        },
      });
      router.replace(`/retentions/${rid}`);
    }, 'Retention saved');
  };

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: id ? 'Edit retention' : 'New retention' }} />
      <ErrorBanner message={error} />
      <Section title="Project">
        <Card>
          <Field label="Project name" required value={f.project_name} onChangeText={(v) => set('project_name', v)} />
          <Field label="End client" required value={f.end_client} onChangeText={(v) => set('end_client', v)} hint="Use the same customer name as in the debtors list so the customer view groups them" />
          <Field label="Main contractor" value={f.main_contractor} onChangeText={(v) => set('main_contractor', v)} />
          <Field label="Contract or PO number" value={f.contract_no} onChangeText={(v) => set('contract_no', v)} />
          <PersonPicker label="Sales person" roles={['asm_building', 'asm_infra']} value={f.sales_person_id} onChange={(v) => set('sales_person_id', v || null)} />
        </Card>
      </Section>
      <Section title="Value">
        <Card>
          <Select
            label="Currency"
            required
            value={f.currency}
            onChange={(v) => set('currency', v as Currency)}
            options={[
              { value: 'LKR', label: 'LKR' },
              { value: 'USD', label: 'USD' },
            ]}
          />
          <NumberField label="Contract value" suffix={f.currency} value={f.contract_value} onChange={(v) => set('contract_value', v)} />
          <NumberField label="Retention %" suffix="%" value={f.retention_pct} onChange={(v) => set('retention_pct', v)} />
          <NumberField
            label="Retention value"
            suffix={f.currency}
            value={f.retention_value}
            onChange={(v) => set('retention_value', v)}
            hint={calc != null ? `Contract value × % = ${fmtMoney(calc, f.currency)} (used if left blank)` : 'Enter the value, or the contract value and %'}
          />
          <Select label="Retention form" required value={f.retention_form} onChange={(v) => set('retention_form', v as Form['retention_form'])} options={RETENTION_FORMS} />
          {f.retention_form === 'bank_guarantee' ? <DateField label="Bank guarantee expiry" required value={f.bg_expiry} onChange={(v) => set('bg_expiry', v)} quick={[]} /> : null}
        </Card>
      </Section>
      <Section title="Dates">
        <Card>
          <DateField label="Retention start date" required value={f.start_date} onChange={(v) => set('start_date', v)} quick={[0]} />
          {id ? (
            <Muted>Due date {f.due_date} – to change it, use “Extend due date” on the retention (GM / DGM approves).</Muted>
          ) : (
            <DateField label="Due date (release)" required value={f.due_date} onChange={(v) => set('due_date', v)} quick={[]} />
          )}
          <Field label="Notes" multiline value={f.notes} onChangeText={(v) => set('notes', v)} />
        </Card>
      </Section>
      <Row style={{ marginTop: 12 }}>
        <Button title={id ? 'Save changes' : 'Save retention'} onPress={save} />
      </Row>
    </Screen>
  );
}
