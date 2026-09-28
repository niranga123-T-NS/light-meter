// Plan (schedule) a visit. Managers can plan visits for their team.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { DateTimeField, SelectField, TextField } from '@/components/form';
import { Banner, Button, Card, Screen } from '@/components/ui';
import { upsertCached, useLookup } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { newId } from '@/lib/ids';
import { customerOptions, userOptions } from '@/lib/options';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';
import type { Visit } from '@/lib/types';

export default function PlanVisit() {
  const params = useLocalSearchParams<{ customerId?: string }>();
  const { profile, isManager } = useSession();
  const types = useLookup('visit_type');
  const [v, setV] = useState<Partial<Visit>>({ customer_id: params.customerId ?? null, salesperson_id: profile!.id });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const row = { id: newId(), status: 'planned', ...v, visit_date: v.scheduled_at?.slice(0, 10) };
    const { data, error: err } = await supabase.from('visits').insert(row).select().single();
    setSaving(false);
    if (err) {
      setError(errorMessage(err));
      return;
    }
    if (data.salesperson_id === profile!.id) upsertCached('plannedVisits', data as Visit);
    notify('Visit planned', `${data.code} is on the agenda.`);
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Plan a visit' }} />
      <Card>
        <SelectField label="Customer" required value={v.customer_id} options={customerOptions()} onChange={(x) => setV({ ...v, customer_id: x })} />
        {isManager ? (
          <SelectField label="Salesperson" required value={v.salesperson_id} options={userOptions(['salesperson', 'manager'])} allowClear={false}
            onChange={(x) => setV({ ...v, salesperson_id: x ?? profile!.id })} />
        ) : null}
        <DateTimeField label="Date and time" required value={v.scheduled_at} onChange={(x) => setV({ ...v, scheduled_at: x })} />
        <SelectField label="Visit type" value={v.visit_type} options={types} onChange={(x) => setV({ ...v, visit_type: x })} />
        <TextField label="Purpose" multiline value={v.purpose} onChange={(t) => setV({ ...v, purpose: t })} />
        <TextField label="Meeting place" value={v.meeting_place} onChange={(t) => setV({ ...v, meeting_place: t })} />
        {error ? <Banner tone="danger" message={error} /> : null}
        <Button title="Add to agenda" onPress={save} loading={saving} disabled={!v.customer_id || !v.scheduled_at} />
      </Card>
    </Screen>
  );
}
