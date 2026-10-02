import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { PersonPicker } from '@/components/pickers';
import { Button, Card, DateField, ErrorBanner, Field, Loading, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { BOND_TYPES } from '@/lib/bonds';
import { fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { PROJECT_TYPES } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Bond, BondType, Currency, ProjectType } from '@/lib/types';

type Form = {
  bond_type: BondType;
  bond_no: string;
  bank: string;
  bank_branch: string;
  category: ProjectType | null;
  owner_id: string | null;
  project_name: string;
  tender_no: string;
  contract_no: string;
  customer: string;
  currency: Currency;
  bond_value: number | null;
  contract_value: number | null;
  bond_pct: number | null;
  advance_amount: number | null;
  issue_date: string | null;
  expiry_date: string | null;
  tender_closing_date: string | null;
  completion_date: string | null;
  dlp_end_date: string | null;
  notes: string;
};

const blank = (t: BondType): Form => ({
  bond_type: t,
  bond_no: '',
  bank: '',
  bank_branch: '',
  category: null,
  owner_id: null,
  project_name: '',
  tender_no: '',
  contract_no: '',
  customer: '',
  currency: 'LKR',
  bond_value: null,
  contract_value: null,
  bond_pct: null,
  advance_amount: null,
  issue_date: null,
  expiry_date: null,
  tender_closing_date: null,
  completion_date: null,
  dlp_end_date: null,
  notes: '',
});

/** Record or edit a bond – Operations Executive only. */
export default function BondEdit() {
  const { id, type } = useLocalSearchParams<{ id?: string; type?: BondType }>();
  const dialog = useDialog();
  const people = usePeople();
  const [f, setF] = useState<Form | null>(id ? null : blank(type ?? 'bid'));
  const [error, setError] = useState<string | null>(null);
  const existing = useLoad(async () => {
    if (!id) return null;
    const { data } = await supabase.from('bonds').select('*').eq('id', id).single();
    return data as Bond;
  }, [id]);
  if (id && !f && existing.data) {
    const b = existing.data;
    setF({
      bond_type: b.bond_type,
      bond_no: b.bond_no,
      bank: b.bank,
      bank_branch: b.bank_branch ?? '',
      category: b.category,
      owner_id: b.owner_id,
      project_name: b.project_name,
      tender_no: b.tender_no ?? '',
      contract_no: b.contract_no ?? '',
      customer: b.customer,
      currency: b.currency,
      bond_value: b.bond_value,
      contract_value: b.contract_value,
      bond_pct: b.bond_pct,
      advance_amount: b.advance_amount,
      issue_date: b.issue_date,
      expiry_date: b.expiry_date,
      tender_closing_date: b.tender_closing_date,
      completion_date: b.completion_date,
      dlp_end_date: b.dlp_end_date,
      notes: b.notes ?? '',
    });
  }
  const category = f?.category ?? null;
  // Owner follows the category: the sales person who handles it (can be changed)
  const autoOwnerQ = useLoad(async () => (category ? rpc<string | null>('bond_owner_for', { p_category: category }) : null), [category]);
  const autoOwner = autoOwnerQ.data ?? null;

  if (!f) return <Screen>{existing.error ? <ErrorBanner message={existing.error} /> : <Loading />}</Screen>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => (s ? { ...s, [k]: v } : s));
  const t = f.bond_type;
  const ownerId = f.owner_id ?? autoOwner;
  const calc = f.contract_value && f.bond_pct ? Math.round(f.contract_value * f.bond_pct) / 100 : null;

  const save = () => {
    setError(null);
    if (!f.bond_no.trim() || !f.bank.trim()) return setError('Bond number and bank are required');
    if (!f.project_name.trim() || !f.customer.trim()) return setError(`${t === 'bid' ? 'Tender / project name' : 'Project name'} and customer are required`);
    if (t === 'bid' && !f.tender_no.trim()) return setError('Tender number is required');
    if (!f.category) return setError('Choose the category – it decides the owner');
    if (!f.issue_date || !f.expiry_date) return setError('Issue date and validity (expiry) date are required');
    if (f.expiry_date < f.issue_date) return setError('The expiry date must be on or after the issue date');
    if (f.bond_value == null && calc == null) return setError('Enter the bond value, or the contract value and bond %');
    return dialog.run(async () => {
      const s = (n: number | null) => (n == null ? '' : String(n));
      const bid = await rpc<string>('save_bond', {
        p_id: id ?? null,
        p_data: {
          ...f,
          bond_value: s(f.bond_value),
          contract_value: s(f.contract_value),
          bond_pct: s(f.bond_pct),
          advance_amount: t === 'advance_payment' ? s(f.advance_amount) : '',
          expiry_date: id ? '' : f.expiry_date,
          tender_closing_date: t === 'bid' ? (f.tender_closing_date ?? '') : '',
          completion_date: t === 'performance' ? (f.completion_date ?? '') : '',
          dlp_end_date: t === 'performance' ? (f.dlp_end_date ?? '') : '',
          owner_id: ownerId ?? '',
        },
      });
      router.replace(`/bonds/${bid}`);
    }, 'Bond saved');
  };

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: id ? 'Edit bond' : 'New bond' }} />
      <ErrorBanner message={error} />
      <Section title="Bond">
        <Card>
          <Select label="Bond type" required value={t} onChange={(v) => set('bond_type', v as BondType)} options={BOND_TYPES.map((b) => ({ value: b.value, label: b.short }))} />
          <Field label="Bond number (bank reference)" required value={f.bond_no} onChangeText={(v) => set('bond_no', v)} />
          <Field label="Bank" required value={f.bank} onChangeText={(v) => set('bank', v)} hint="Use the same bank name each time so the bank filter groups them" />
          <Field label="Branch" value={f.bank_branch} onChangeText={(v) => set('bank_branch', v)} />
        </Card>
      </Section>
      <Section title={t === 'bid' ? 'Tender' : 'Project'}>
        <Card>
          {t === 'bid' ? <Field label="Tender number" required value={f.tender_no} onChangeText={(v) => set('tender_no', v)} /> : null}
          <Field label={t === 'bid' ? 'Tender / project name' : 'Project name'} required value={f.project_name} onChangeText={(v) => set('project_name', v)} />
          {t !== 'bid' ? <Field label="Contract / PO number" value={f.contract_no} onChangeText={(v) => set('contract_no', v)} /> : null}
          <Field label="Customer (beneficiary)" required value={f.customer} onChangeText={(v) => set('customer', v)} hint="Use the same customer name as in the debtors list" />
          <Select
            label="Category"
            required
            value={f.category}
            onChange={(v) => setF((s) => (s ? { ...s, category: v as ProjectType, owner_id: null } : s))}
            options={PROJECT_TYPES.map((p) => ({ value: p.value, label: `${p.label} (${p.line})` }))}
            hint="The owner is the sales person who handles this category"
          />
          {f.category ? (
            <>
              <PersonPicker label="Owner (sales person)" roles={['asm_building', 'asm_infra']} value={ownerId} onChange={(v) => set('owner_id', v || null)} />
              <Muted>
                {autoOwner ? `Handles this category: ${people[autoOwner]?.full_name ?? '—'}` : 'No sales person handles this category yet – choose the owner.'}
                {autoOwner && ownerId !== autoOwner ? ' · a different owner is selected' : ''}
              </Muted>
            </>
          ) : null}
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
          <NumberField label={t === 'bid' ? 'Tender value' : 'Contract value'} suffix={f.currency} value={f.contract_value} onChange={(v) => set('contract_value', v)} />
          <NumberField label="Bond %" suffix="%" value={f.bond_pct} onChange={(v) => set('bond_pct', v)} />
          {t === 'advance_payment' ? <NumberField label="Advance received" suffix={f.currency} value={f.advance_amount} onChange={(v) => set('advance_amount', v)} /> : null}
          <NumberField
            label="Bond value"
            suffix={f.currency}
            value={f.bond_value}
            onChange={(v) => set('bond_value', v)}
            hint={calc != null ? `Value × % = ${fmtMoney(calc, f.currency)} (used if left blank)` : 'Enter the value, or the value and %'}
          />
        </Card>
      </Section>
      <Section title="Dates">
        <Card>
          <DateField label="Issue date" required value={f.issue_date} onChange={(v) => set('issue_date', v)} quick={[0]} />
          {id ? (
            <Muted>Validity {f.expiry_date} – to change it, use “Extend validity” on the bond.</Muted>
          ) : (
            <DateField label="Validity (expiry) date" required value={f.expiry_date} onChange={(v) => set('expiry_date', v)} quick={[]} />
          )}
          {t === 'bid' ? <DateField label="Tender closing date" value={f.tender_closing_date} onChange={(v) => set('tender_closing_date', v)} quick={[]} /> : null}
          {t === 'performance' ? (
            <>
              <DateField label="Project completion date" value={f.completion_date} onChange={(v) => set('completion_date', v)} quick={[]} />
              <DateField label="Defects liability period ends" value={f.dlp_end_date} onChange={(v) => set('dlp_end_date', v)} quick={[]} />
            </>
          ) : null}
          <Field label="Notes" multiline value={f.notes} onChangeText={(v) => set('notes', v)} />
        </Card>
      </Section>
      <Row style={{ marginTop: 12 }}>
        <Button title={id ? 'Save changes' : 'Save bond'} onPress={save} />
      </Row>
    </Screen>
  );
}
