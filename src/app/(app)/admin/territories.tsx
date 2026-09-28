import { Stack } from 'expo-router';
import { useState } from 'react';

import { FormModal } from '@/components/FormModal';
import { SwitchField, TextField } from '@/components/form';
import { Badge, Banner, Button, Card, ListItem, Screen } from '@/components/ui';
import { refreshCache } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { Territory } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

export default function Territories() {
  const { profile } = useSession();
  const [editing, setEditing] = useState<Partial<Territory> | null>(null);
  const { data, error, reload } = useAsync(async () => unwrap(await supabase.from('territories').select('*').order('name')) as Territory[], []);
  const save = async () => {
    if (!editing) return;
    const { id, ...row } = editing;
    const { error: err } = id ? await supabase.from('territories').update(row).eq('id', id) : await supabase.from('territories').insert(row);
    if (err) return notify('Not saved', errorMessage(err));
    setEditing(null);
    await reload();
    await refreshCache(profile!.id).catch(() => undefined);
  };
  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Territories' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Button title="＋ Add territory" onPress={() => setEditing({ code: '', name: '', active: true })} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((t) => <ListItem key={t.id} title={t.name} subtitle={t.code} right={!t.active ? <Badge label="Inactive" /> : undefined} onPress={() => setEditing(t)} />)}
      </Card>
      <FormModal visible={!!editing} title="Territory" onClose={() => setEditing(null)} onSave={save} saveDisabled={!editing?.code?.trim() || !editing?.name?.trim()}>
        {editing ? (
          <>
            <TextField label="Code" required editable={!editing.id} autoCapitalize="none" value={editing.code} onChange={(t) => setEditing({ ...editing, code: t.toUpperCase().replace(/\s+/g, '_') })} />
            <TextField label="Name" required value={editing.name} onChange={(t) => setEditing({ ...editing, name: t })} />
            <SwitchField label="Active" value={editing.active} onChange={(x) => setEditing({ ...editing, active: x })} />
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
