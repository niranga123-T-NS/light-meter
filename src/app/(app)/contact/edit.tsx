import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { SelectField, SwitchField, TextField } from '@/components/form';
import { Banner, Button, Card, Loading, Screen } from '@/components/ui';
import { upsertCached, useLookup } from '@/lib/cache';
import { newId } from '@/lib/ids';
import { CONSENT_OPTIONS, CONTACT_METHOD_OPTIONS, customerOptions, userOptions } from '@/lib/options';
import { fetchOne, saveRecord } from '@/lib/records';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/supabase';
import type { Contact } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function EditContact() {
  const { id, customerId } = useLocalSearchParams<{ id?: string; customerId?: string }>();
  const { data, loading, error } = useAsync(() => (id ? fetchOne<Contact>('contacts', id) : Promise.resolve(null)), [id]);
  if (id && loading) return <Loading />;
  if (id && !data) return <Screen><Banner tone="danger" message={error ?? 'Not found'} /></Screen>;
  return <ContactForm initial={data ?? { id: newId(), customer_id: customerId ?? '', full_name: '', active: true, consent_status: 'unknown' }} isNew={!id} />;
}

function ContactForm({ initial, isNew }: { initial: Contact; isNew: boolean }) {
  const { isManager } = useSession();
  const [c, setC] = useState<Contact>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roles = useLookup('decision_role');
  const set = (patch: Partial<Contact>) => setC({ ...c, ...patch });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveRecord('contacts', c, isNew);
      upsertCached('contacts', saved);
      router.replace(`/contact/${saved.id}`);
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg.includes('contacts_email_key') ? 'This email is already used by another contact at this customer.' : msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={<Button style={{ flex: 1 }} title={isNew ? 'Add contact' : 'Save'} onPress={save} loading={saving} disabled={!c.full_name.trim() || !c.customer_id} />}>
      <Stack.Screen options={{ title: isNew ? 'New contact' : 'Edit contact' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Card>
        <SelectField label="Customer" required value={c.customer_id} options={customerOptions()} onChange={(x) => set({ customer_id: x ?? '' })} />
        <TextField label="Full name" required value={c.full_name} onChange={(t) => set({ full_name: t })} />
        <TextField label="Designation" value={c.designation} onChange={(t) => set({ designation: t })} />
        <TextField label="Department" value={c.department} onChange={(t) => set({ department: t })} />
        <TextField label="Work phone" value={c.work_phone} keyboardType="phone-pad" onChange={(t) => set({ work_phone: t })} />
        <TextField label="Mobile" value={c.mobile_phone} keyboardType="phone-pad" onChange={(t) => set({ mobile_phone: t })} />
        <TextField label="Email" value={c.email} keyboardType="email-address" autoCapitalize="none" onChange={(t) => set({ email: t || null })} />
        <SelectField label="Decision role" value={c.decision_role} options={roles} onChange={(x) => set({ decision_role: x })} />
        <SelectField label="Preferred contact method" value={c.preferred_contact_method} options={CONTACT_METHOD_OPTIONS} onChange={(x) => set({ preferred_contact_method: x })} />
        <SelectField label="Communication consent" value={c.consent_status} options={CONSENT_OPTIONS} allowClear={false} onChange={(x) => set({ consent_status: (x ?? 'unknown') as Contact['consent_status'] })} />
        <TextField label="Communication preference" value={c.communication_preference} onChange={(t) => set({ communication_preference: t })} />
        <SwitchField label="Active" value={c.active} onChange={(x) => set({ active: x })} hint="Turn off when the person leaves the company" />
        {isManager ? <SelectField label="Owner" value={c.owner_id} options={userOptions()} onChange={(x) => set({ owner_id: x })} /> : null}
        <TextField label="Notes" multiline value={c.notes} onChange={(t) => set({ notes: t })} />
      </Card>
    </Screen>
  );
}
