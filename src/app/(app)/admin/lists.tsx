// Configurable dropdown lists – administrators change these without a code change.
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';

import { FormModal } from '@/components/FormModal';
import { NumberField, SelectField, SwitchField, TextField } from '@/components/form';
import { Badge, Banner, Button, Card, ListItem, Muted, Screen } from '@/components/ui';
import { refreshCache } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { LookupValue } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

const LIST_NAMES: Record<string, string> = {
  visit_type: 'Visit types', customer_category: 'Customer categories', industry: 'Industries', project_type: 'Project types',
  project_segment: 'Lighting segments', visit_outcome: 'Visit outcomes', win_loss_reason: 'Win / loss reasons',
  no_followup_reason: 'No follow-up reasons', contact_unavailable_reason: 'Contact unavailable reasons',
  location_unavailable_reason: 'Location unavailable reasons', decision_role: 'Decision roles', stakeholder_role: 'Stakeholder roles',
  influence_stage: 'Influence stages', design_stage: 'Design stages', budget_status: 'Budget status', spec_status: 'Specification status',
  lead_source: 'Lead sources', date_confidence: 'Date confidence', strategic_priority: 'Strategic priority', milestone_kind: 'Milestone types',
  currency: 'Currencies', district: 'Districts',
};

export default function Lists() {
  const { profile } = useSession();
  const [listKey, setListKey] = useState('visit_type');
  const [editing, setEditing] = useState<Partial<LookupValue> | null>(null);
  const { data, error, reload } = useAsync(async () => unwrap(await supabase.from('lookup_values').select('*').order('sort_order')) as LookupValue[], []);
  const keys = useMemo(() => [...new Set([...Object.keys(LIST_NAMES), ...(data ?? []).map((l) => l.list_key)])].sort(), [data]);
  const values = (data ?? []).filter((l) => l.list_key === listKey);

  const save = async () => {
    if (!editing) return;
    const row = { ...editing, list_key: listKey, code: editing.code?.trim(), label: editing.label?.trim() };
    const { error: err } = editing.id
      ? await supabase.from('lookup_values').update({ label: row.label, sort_order: row.sort_order, active: row.active }).eq('id', editing.id)
      : await supabase.from('lookup_values').insert(row);
    if (err) return notify('Not saved', errorMessage(err));
    setEditing(null);
    await reload();
    await refreshCache(profile!.id).catch(() => undefined);
  };

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Dropdown lists' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Card>
        <SelectField label="List" value={listKey} allowClear={false} options={keys.map((k) => ({ value: k, label: LIST_NAMES[k] ?? k }))} onChange={(x) => setListKey(x ?? listKey)} />
        <Button small title="＋ Add value" onPress={() => setEditing({ code: '', label: '', sort_order: (values.length + 1) * 10, active: true })} />
        <Muted>Codes are stored on records and in exports, so they cannot be changed. Deactivate a value to hide it from new entries.</Muted>
      </Card>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {values.map((v) => (
          <ListItem key={v.id} title={v.label} subtitle={`${v.code} · order ${v.sort_order}`} right={!v.active ? <Badge label="Inactive" /> : undefined} onPress={() => setEditing(v)} />
        ))}
      </Card>
      <FormModal visible={!!editing} title={editing?.id ? 'Edit value' : 'New value'} onClose={() => setEditing(null)} onSave={save}
        saveDisabled={!editing?.code?.trim() || !editing?.label?.trim()}>
        {editing ? (
          <>
            <TextField label="Code" required editable={!editing.id} autoCapitalize="none" value={editing.code} onChange={(t) => setEditing({ ...editing, code: t.replace(/\s+/g, '_').toLowerCase() })} />
            <TextField label="Label" required value={editing.label} onChange={(t) => setEditing({ ...editing, label: t })} />
            <NumberField label="Sort order" value={editing.sort_order} onChange={(n) => setEditing({ ...editing, sort_order: n ?? 100 })} />
            <SwitchField label="Active" value={editing.active} onChange={(x) => setEditing({ ...editing, active: x })} />
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
