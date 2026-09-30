import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { PersonPicker } from '@/components/pickers';
import { Button, Card, colors, ErrorBanner, Field, ListRow, Muted, Notice, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useMasters } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Organization } from '@/lib/types';

/** New customer profile (Section 4.9) with a duplicate check on name, phone and email. */
export default function NewCustomer() {
  const me = useMe();
  const dialog = useDialog();
  const masters = useMasters();
  const [f, setF] = useState({ name: '', visit_category: null as string | null, address: '', phone: '', email: '', account_owner_id: isSales(me.role) ? me.id : (null as string | null) });
  const [unit, setUnit] = useState({ name: '', unit_type: 'department' });
  const [contact, setContact] = useState({ name: '', designation: '', phone: '', email: '' });
  const [dupes, setDupes] = useState<Organization[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    const ors = [
      f.name.trim().length > 2 ? `name.ilike.%${f.name.trim().split(/\s+/)[0]}%` : null,
      f.phone.trim() ? `phone.eq.${f.phone.trim()}` : null,
      f.email.trim() ? `email.ilike.${f.email.trim()}` : null,
    ].filter(Boolean);
    if (!ors.length) return [];
    const { data } = await supabase.from('organizations').select('*').or(ors.join(',')).limit(10);
    setDupes((data ?? []) as Organization[]);
    return (data ?? []) as Organization[];
  };

  const save = async () => {
    setError(null);
    if (!f.name.trim() || !f.visit_category) return setError('Name and type are required');
    const d = dupes ?? (await check());
    if (d.length && !(await dialog.confirm('Possible duplicates found', 'Create a new organization anyway?', { confirmLabel: 'Create new' }))) return;
    await dialog.run(async () => {
      const { data: org, error: e } = await supabase
        .from('organizations')
        .insert({ ...f, address: f.address || null, phone: f.phone || null, email: f.email || null })
        .select('id')
        .single();
      if (e) throw new Error(e.message);
      let unitId: string | null = null;
      if (unit.name.trim()) {
        const { data: u, error: ue } = await supabase.from('org_units').insert({ organization_id: org.id, ...unit }).select('id').single();
        if (ue) throw new Error(ue.message);
        unitId = u.id;
      }
      if (contact.name.trim()) {
        const { error: ce } = await supabase.from('contacts').insert({ organization_id: org.id, unit_id: unitId, ...contact });
        if (ce) throw new Error(ce.message);
      }
      router.replace(`/customers/${org.id}`);
    }, 'Customer created');
  };

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'New customer' }} />
      <ErrorBanner message={error} />
      <Section title="Organization">
        <Card>
          <Field label="Organization name" required value={f.name} onChangeText={(v) => { setF((s) => ({ ...s, name: v })); setDupes(null); }} onBlur={check} />
          <Select label="Type (visit category)" required value={f.visit_category} options={masters.values('visit_category').map((v) => ({ value: v, label: v }))} onChange={(v) => setF((s) => ({ ...s, visit_category: v }))} />
          <Field label="Head office address" value={f.address} onChangeText={(v) => setF((s) => ({ ...s, address: v }))} />
          <Row gap={8}>
            <Field label="Phone" keyboardType="phone-pad" value={f.phone} onChangeText={(v) => setF((s) => ({ ...s, phone: v }))} onBlur={check} />
            <Field label="Email" keyboardType="email-address" autoCapitalize="none" value={f.email} onChangeText={(v) => setF((s) => ({ ...s, email: v }))} onBlur={check} />
          </Row>
          {!isSales(me.role) ? (
            <PersonPicker label="Account owner" roles={['asm_building', 'asm_infra']} value={f.account_owner_id} onChange={(v) => setF((s) => ({ ...s, account_owner_id: v }))} />
          ) : (
            <Muted>You will be the account owner. Only SM Projects can change it.</Muted>
          )}
        </Card>
      </Section>
      {dupes && dupes.length ? (
        <Section title="Possible duplicates">
          <Notice tone={colors.amber}>Select an existing organization if it is the same customer.</Notice>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {dupes.map((o) => (
              <ListRow key={o.id} title={o.name} subtitle={`${o.visit_category} · ${o.phone ?? ''} ${o.email ?? ''}`} right={<Button small title="Use this" onPress={() => router.replace(`/customers/${o.id}`)} />} />
            ))}
          </Card>
        </Section>
      ) : null}
      <Section title="First unit / department (optional)">
        <Card>
          <Field label="Unit name" value={unit.name} onChangeText={(v) => setUnit((s) => ({ ...s, name: v }))} />
          <Select
            label="Unit type"
            value={unit.unit_type}
            onChange={(v) => setUnit((s) => ({ ...s, unit_type: v }))}
            options={['department', 'division', 'branch', 'site'].map((v) => ({ value: v, label: v }))}
          />
        </Card>
      </Section>
      <Section title="Contact (optional)">
        <Card>
          <Field label="Name" value={contact.name} onChangeText={(v) => setContact((s) => ({ ...s, name: v }))} />
          <Field label="Designation" value={contact.designation} onChangeText={(v) => setContact((s) => ({ ...s, designation: v }))} />
          <Row gap={8}>
            <Field label="Phone" keyboardType="phone-pad" value={contact.phone} onChangeText={(v) => setContact((s) => ({ ...s, phone: v }))} />
            <Field label="Email" autoCapitalize="none" keyboardType="email-address" value={contact.email} onChangeText={(v) => setContact((s) => ({ ...s, email: v }))} />
          </Row>
        </Card>
      </Section>
      <Row style={{ marginTop: 16 }}>
        <Button title="Create customer" onPress={save} />
      </Row>
    </Screen>
  );
}
