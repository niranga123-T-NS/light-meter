import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DuplicateHints } from '@/components/DuplicateHints';
import { SelectField, TextField } from '@/components/form';
import { Banner, Button, Card, Loading, Muted, Screen, SectionTitle } from '@/components/ui';
import { upsertCached, useLookup } from '@/lib/cache';
import { newId } from '@/lib/ids';
import { CUSTOMER_STATUS_OPTIONS, customerOptions, territoryOptions, userOptions } from '@/lib/options';
import { fetchOne, saveRecord } from '@/lib/records';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/supabase';
import type { Customer } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function EditCustomer() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data, loading, error } = useAsync(() => (id ? fetchOne<Customer>('customers', id) : Promise.resolve(null)), [id]);
  if (id && loading) return <Loading />;
  if (id && !data) return <Screen><Banner tone="danger" message={error ?? 'Not found (you may be offline)'} /></Screen>;
  return <CustomerForm initial={data ?? { id: newId(), legal_name: '', country: 'Sri Lanka', status: 'prospect' }} isNew={!id} />;
}

function CustomerForm({ initial, isNew }: { initial: Customer; isNew: boolean }) {
  const { isManager, profile } = useSession();
  const [c, setC] = useState<Customer>(isNew ? { ...initial, owner_id: profile!.id } : initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = useLookup('customer_category');
  const industries = useLookup('industry');
  const districts = useLookup('district');
  const priorities = useLookup('strategic_priority');
  const sources = useLookup('lead_source');
  const set = (patch: Partial<Customer>) => setC({ ...c, ...patch });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveRecord('customers', c, isNew, ['search_text']);
      upsertCached('customers', saved);
      router.replace(`/customer/${saved.id}`);
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg.includes('customers_dedupe_key') ? 'A customer with this name already exists in this city. Use the existing record.' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={<Button style={{ flex: 1 }} title={isNew ? 'Create customer' : 'Save changes'} onPress={save} loading={saving} disabled={!c.legal_name.trim()} />}>
      <Stack.Screen options={{ title: isNew ? 'New customer' : `Edit ${initial.code ?? ''}` }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Card>
        <TextField label="Legal / registered name" required value={c.legal_name} onChange={(t) => set({ legal_name: t })} />
        {isNew ? <DuplicateHints kind="customer" name={c.legal_name} place={c.city} onUse={(existing) => router.replace(`/customer/${existing}`)} /> : null}
        <TextField label="Trading name" value={c.trading_name} onChange={(t) => set({ trading_name: t })} />
        <SelectField label="Category" value={c.category} options={categories} onChange={(x) => set({ category: x })} />
        <SelectField label="Industry" value={c.industry} options={industries} onChange={(x) => set({ industry: x })} />
        <SelectField label="Strategic priority" value={c.strategic_priority} options={priorities} onChange={(x) => set({ strategic_priority: x })} />
        <SelectField label="Status" value={c.status} options={CUSTOMER_STATUS_OPTIONS} allowClear={false} onChange={(x) => set({ status: (x ?? 'active') as Customer['status'] })} />
        <SelectField label="Source" value={c.source} options={sources} onChange={(x) => set({ source: x })} />
        <SelectField label="Parent company" value={c.parent_customer_id} options={customerOptions().filter((o) => o.value !== c.id)}
          onChange={(x) => set({ parent_customer_id: x })} hint="For subsidiaries / group companies" />
      </Card>
      <SectionTitle>Contact details</SectionTitle>
      <Card>
        <TextField label="Address" multiline value={c.address} onChange={(t) => set({ address: t })} />
        <TextField label="City" value={c.city} onChange={(t) => set({ city: t })} />
        <SelectField label="District" value={c.district} options={districts} onChange={(x) => set({ district: x })} />
        <TextField label="Country" value={c.country} onChange={(t) => set({ country: t })} />
        <TextField label="Phone" value={c.phone} keyboardType="phone-pad" onChange={(t) => set({ phone: t })} />
        <TextField label="Email" value={c.email} keyboardType="email-address" autoCapitalize="none" onChange={(t) => set({ email: t })} />
        <TextField label="Website" value={c.website} autoCapitalize="none" onChange={(t) => set({ website: t })} />
      </Card>
      <SectionTitle>Ownership</SectionTitle>
      <Card>
        {isManager ? (
          <>
            <SelectField label="Account owner" value={c.owner_id} options={userOptions(['salesperson', 'manager', 'admin'])} onChange={(x) => set({ owner_id: x })} />
            <SelectField label="Territory" value={c.territory_id} options={territoryOptions()} onChange={(x) => set({ territory_id: x })} />
          </>
        ) : <Muted>New accounts are owned by you, in your territory. A manager can reassign them.</Muted>}
        <TextField label="Notes" multiline value={c.notes} onChange={(t) => set({ notes: t })} />
      </Card>
    </Screen>
  );
}
