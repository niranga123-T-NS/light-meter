// Quotation revision. Cost and gross margin are stored separately and are
// only visible / editable for roles allowed by the margin_visible_roles setting.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AttachmentList } from '@/components/AttachmentList';
import { DateField, NumberField, SelectField, TextField } from '@/components/form';
import { Banner, Button, Card, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { setting, useLookup } from '@/lib/cache';
import { newId } from '@/lib/ids';
import { QUOTATION_STATUS_OPTIONS, contactOptions, customerOptions } from '@/lib/options';
import { fetchOne, saveRecord } from '@/lib/records';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { Quotation, QuotationFinancials } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function EditQuotation() {
  const { id, opportunityId } = useLocalSearchParams<{ id?: string; opportunityId?: string }>();
  const { role } = useSession();
  const canSeeMargin = !!role && (setting<string[]>('margin_visible_roles', ['manager', 'admin'])).includes(role);
  const { data, loading, error } = useAsync(async () => {
    if (!id) return { q: null, fin: null };
    const q = await fetchOne<Quotation>('quotations', id);
    const fin = canSeeMargin
      ? (unwrap(await supabase.from('quotation_financials').select('*').eq('quotation_id', id).maybeSingle()) as QuotationFinancials | null)
      : null;
    return { q, fin };
  }, [id]);
  if (loading) return <Loading />;
  if (id && !data?.q) return <Screen><Banner tone="danger" message={error ?? 'Not found'} /></Screen>;
  return (
    <QuoteForm
      isNew={!id}
      canSeeMargin={canSeeMargin}
      initial={data?.q ?? { id: newId(), opportunity_id: opportunityId ?? '', reference: '', revision: 0, status: 'draft', currency: 'LKR' }}
      initialFin={data?.fin ?? null}
    />
  );
}

function QuoteForm({ initial, initialFin, isNew, canSeeMargin }: { initial: Quotation; initialFin: QuotationFinancials | null; isNew: boolean; canSeeMargin: boolean }) {
  const [q, setQ] = useState<Quotation>(initial);
  const [fin, setFin] = useState<QuotationFinancials>(initialFin ?? { quotation_id: initial.id });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currencies = useLookup('currency');
  const set = (patch: Partial<Quotation>) => setQ({ ...q, ...patch });

  const save = async (asRevision = false) => {
    setSaving(true);
    setError(null);
    try {
      const row = asRevision ? { ...q, id: newId(), revision: q.revision + 1, status: 'draft' as const, version: undefined } : q;
      const saved = await saveRecord('quotations', row, isNew || asRevision);
      if (canSeeMargin && (fin.cost_amount != null || fin.gross_margin_pct != null || fin.margin_note)) {
        unwrap(await supabase.from('quotation_financials').upsert({
          quotation_id: saved.id, cost_amount: fin.cost_amount ?? null, gross_margin_pct: fin.gross_margin_pct ?? null, margin_note: fin.margin_note ?? null,
        }));
      }
      router.replace(`/opportunity/${saved.opportunity_id}`);
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg.includes('quotations_reference_revision_key') ? 'This reference and revision already exist. Create a new revision instead.' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={
      <>
        {!isNew ? <Button style={{ flex: 1 }} variant="secondary" title="Save as new revision" onPress={() => save(true)} loading={saving} /> : null}
        <Button style={{ flex: 1 }} title={isNew ? 'Create quotation' : 'Save'} onPress={() => save(false)} loading={saving} disabled={!q.reference.trim()} />
      </>
    }>
      <Stack.Screen options={{ title: isNew ? 'New quotation' : `${initial.reference} rev ${initial.revision}` }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Card>
        <TextField label="Quotation reference" required value={q.reference} onChange={(t) => set({ reference: t })} />
        <NumberField label="Revision" value={q.revision} onChange={(n) => set({ revision: n ?? 0 })} />
        <SelectField label="Status" value={q.status} options={QUOTATION_STATUS_OPTIONS} allowClear={false} onChange={(x) => set({ status: (x ?? 'draft') as Quotation['status'] })} />
        <DateField label="Submission date" value={q.submission_date} onChange={(d) => set({ submission_date: d })} />
        <NumberField label="Amount" value={q.amount} onChange={(n) => set({ amount: n })} />
        <SelectField label="Currency" value={q.currency} options={currencies} allowClear={false} onChange={(x) => set({ currency: x ?? 'LKR' })} />
        <DateField label="Valid until" value={q.validity_date} onChange={(d) => set({ validity_date: d })} />
        <SelectField label="Submitted to (organisation)" value={q.recipient_customer_id} options={customerOptions()} onChange={(x) => set({ recipient_customer_id: x })} />
        <SelectField label="Submitted to (contact)" value={q.recipient_contact_id} options={contactOptions(q.recipient_customer_id)} onChange={(x) => set({ recipient_contact_id: x })} />
        <TextField label="Outcome" multiline value={q.outcome_note} onChange={(t) => set({ outcome_note: t })} />
        <TextField label="Document link" value={q.document_url} autoCapitalize="none" onChange={(t) => set({ document_url: t })} />
      </Card>
      {canSeeMargin ? (
        <>
          <SectionTitle>Confidential</SectionTitle>
          <Card>
            <NumberField label="Cost amount" value={fin.cost_amount} onChange={(n) => setFin({ ...fin, cost_amount: n })} />
            <NumberField label="Gross margin %" value={fin.gross_margin_pct} onChange={(n) => setFin({ ...fin, gross_margin_pct: n })} />
            <TextField label="Margin note" value={fin.margin_note} onChange={(t) => setFin({ ...fin, margin_note: t })} />
            <Muted>Only visible to roles permitted to see cost and margin.</Muted>
          </Card>
        </>
      ) : null}
      {!isNew ? <AttachmentList entityType="quotation" entityId={q.id} /> : null}
    </Screen>
  );
}
