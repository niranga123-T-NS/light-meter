// Pipeline stages – managers configure names, default probability and required fields.
import { Stack } from 'expo-router';
import { useState } from 'react';

import { FormModal } from '@/components/FormModal';
import { MultiSelectField, NumberField, SelectField, SwitchField, TextField } from '@/components/form';
import { Badge, Banner, Button, Card, ListItem, Muted, Screen } from '@/components/ui';
import { refreshCache } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { Stage } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

const FIELDS = [
  { value: 'estimated_value', label: 'Estimated value' }, { value: 'expected_order_date', label: 'Expected order date' },
  { value: 'quotation_due_date', label: 'Quotation due date' }, { value: 'segment', label: 'Segment' }, { value: 'systems_products', label: 'Systems / products' },
  { value: 'competitors', label: 'Competitors' }, { value: 'spec_status', label: 'Specification status' }, { value: 'bid_strategy', label: 'Bid strategy' },
  { value: 'win_loss_reason', label: 'Win / loss reason' }, { value: 'award_date', label: 'Award date' }, { value: 'final_award_value', label: 'Final award value' },
];
const OUTCOMES = [
  { value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }, { value: 'on_hold', label: 'On hold' }, { value: 'cancelled', label: 'Cancelled' },
];

export default function Stages() {
  const { profile } = useSession();
  const [editing, setEditing] = useState<Partial<Stage> | null>(null);
  const { data, error, reload } = useAsync(async () => unwrap(await supabase.from('pipeline_stages').select('*').order('sort_order')) as Stage[], []);

  const save = async () => {
    if (!editing) return;
    const { id, ...row } = editing;
    const { error: err } = id ? await supabase.from('pipeline_stages').update(row).eq('id', id) : await supabase.from('pipeline_stages').insert(row);
    if (err) return notify('Not saved', errorMessage(err));
    setEditing(null);
    await reload();
    await refreshCache(profile!.id).catch(() => undefined);
  };

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Pipeline stages' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Button title="＋ Add stage" onPress={() => setEditing({ code: '', name: '', sort_order: ((data ?? []).length + 1) * 10, default_probability: 0, outcome: 'open', exit_required_fields: [], entry_required_fields: [], active: true })} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((s) => (
          <ListItem key={s.id} title={`${s.sort_order}. ${s.name}`} subtitle={`${s.default_probability}% · ${s.outcome}`}
            meta={[s.exit_required_fields.length ? `exit needs: ${s.exit_required_fields.join(', ')}` : null, s.entry_required_fields.length ? `entry needs: ${s.entry_required_fields.join(', ')}` : null].filter(Boolean).join(' · ') || undefined}
            right={!s.active ? <Badge label="Inactive" /> : undefined} onPress={() => setEditing(s)} />
        ))}
      </Card>
      <Muted>Weighted value = estimated value × probability. Required fields are checked by the server when a package changes stage.</Muted>
      <FormModal visible={!!editing} title={editing?.id ? 'Edit stage' : 'New stage'} onClose={() => setEditing(null)} onSave={save} saveDisabled={!editing?.name?.trim() || !editing?.code?.trim()}>
        {editing ? (
          <>
            <TextField label="Code" required editable={!editing.id} autoCapitalize="none" value={editing.code} onChange={(t) => setEditing({ ...editing, code: t.replace(/\s+/g, '_').toLowerCase() })} />
            <TextField label="Name" required value={editing.name} onChange={(t) => setEditing({ ...editing, name: t })} />
            <NumberField label="Order" value={editing.sort_order} onChange={(n) => setEditing({ ...editing, sort_order: n ?? 0 })} />
            <NumberField label="Default probability %" value={editing.default_probability} onChange={(n) => setEditing({ ...editing, default_probability: Math.min(100, n ?? 0) })} />
            <SelectField label="Outcome type" value={editing.outcome} options={OUTCOMES} allowClear={false} onChange={(x) => setEditing({ ...editing, outcome: (x ?? 'open') as Stage['outcome'] })} />
            <MultiSelectField label="Required to leave this stage" values={editing.exit_required_fields ?? []} options={FIELDS} onChange={(x) => setEditing({ ...editing, exit_required_fields: x })} />
            <MultiSelectField label="Required to enter this stage" values={editing.entry_required_fields ?? []} options={FIELDS} onChange={(x) => setEditing({ ...editing, entry_required_fields: x })} />
            <SwitchField label="Active" value={editing.active} onChange={(x) => setEditing({ ...editing, active: x })} />
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
