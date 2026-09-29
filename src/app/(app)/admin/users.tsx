// Users and roles (administrators). Uses the admin-users Edge Function for
// anything that needs the service role (invites, deactivation).
import { Stack } from 'expo-router';
import { useState } from 'react';

import { FormModal } from '@/components/FormModal';
import { MultiSelectField, SelectField, TextField } from '@/components/form';
import { Badge, Banner, Button, Card, ListItem, Muted, Screen } from '@/components/ui';
import { refreshCache } from '@/lib/cache';
import { confirm, notify } from '@/lib/dialog';
import { territoryOptions, userOptions } from '@/lib/options';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { Profile, Role } from '@/lib/types';
import { useAsync } from '@/lib/useAsync';

const ROLE_OPTIONS = [
  { value: 'salesperson', label: 'Salesperson' }, { value: 'manager', label: 'Sales manager' },
  { value: 'designer', label: 'Design team' }, { value: 'estimator', label: 'Estimation team' }, { value: 'admin', label: 'Administrator' },
];

interface Editing { user_id?: string; email: string; full_name: string; role: Role; territory_ids: string[]; password?: string; active?: boolean }

async function callAdmin(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detail = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error(detail?.error ?? error.message);
  }
  return data;
}

export default function Users() {
  const { profile } = useSession();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [reassignTo, setReassignTo] = useState<string | null>(null);
  const { data, error, reload } = useAsync(async () => {
    const [profiles, pts] = await Promise.all([
      supabase.from('profiles').select('*').order('active', { ascending: false }).order('full_name'),
      supabase.from('profile_territories').select('*'),
    ]);
    const map = new Map<string, string[]>();
    for (const pt of unwrap(pts) as { user_id: string; territory_id: string }[]) map.set(pt.user_id, [...(map.get(pt.user_id) ?? []), pt.territory_id]);
    return (unwrap(profiles) as Profile[]).map((p) => ({ ...p, territory_ids: map.get(p.id) ?? [] }));
  }, []);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing.user_id) {
        await callAdmin({ action: 'update', user_id: editing.user_id, role: editing.role, full_name: editing.full_name, territory_ids: editing.territory_ids });
      } else {
        await callAdmin({ action: 'invite', email: editing.email, full_name: editing.full_name, role: editing.role,
          territory_ids: editing.territory_ids, password: editing.password || undefined });
      }
      setEditing(null);
      await reload();
      await refreshCache(profile!.id).catch(() => undefined);
    } catch (e) {
      notify('Not saved', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (active: boolean) => {
    if (!editing?.user_id) return;
    if (!active && !(await confirm('Deactivate user?', `${editing.full_name} will be signed out and lose access immediately.${reassignTo ? ' Their open records move to the selected owner.' : ''}`, 'Deactivate', true))) return;
    setSaving(true);
    try {
      await callAdmin(active ? { action: 'reactivate', user_id: editing.user_id } : { action: 'deactivate', user_id: editing.user_id, reassign_to: reassignTo ?? undefined });
      setEditing(null);
      await reload();
    } catch (e) {
      notify('Not saved', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Users and roles' }} />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Button title="＋ Invite user" onPress={() => setEditing({ email: '', full_name: '', role: 'salesperson', territory_ids: [] })} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((u) => (
          <ListItem key={u.id} title={u.full_name || u.email || u.id} subtitle={`${u.email ?? ''} · ${ROLE_OPTIONS.find((r) => r.value === u.role)?.label}`}
            meta={territoryOptions().filter((t) => u.territory_ids?.includes(t.value)).map((t) => t.label).join(', ') || 'No territory'}
            right={<Badge label={u.active ? 'Active' : 'Inactive'} tone={u.active ? 'success' : 'danger'} />}
            onPress={() => { setReassignTo(null); setEditing({ user_id: u.id, email: u.email ?? '', full_name: u.full_name, role: u.role, territory_ids: u.territory_ids ?? [], active: u.active }); }} />
        ))}
      </Card>
      <Muted>New users who sign in with Microsoft appear here as inactive until you activate them.</Muted>

      <FormModal visible={!!editing} title={editing?.user_id ? 'Edit user' : 'Invite user'} onClose={() => setEditing(null)} onSave={save} saving={saving}
        saveDisabled={!editing?.email.includes('@') && !editing?.user_id}>
        {editing ? (
          <>
            <TextField label="Email" required editable={!editing.user_id} value={editing.email} keyboardType="email-address" autoCapitalize="none"
              onChange={(t) => setEditing({ ...editing, email: t })} />
            <TextField label="Full name" value={editing.full_name} onChange={(t) => setEditing({ ...editing, full_name: t })} />
            <SelectField label="Role" value={editing.role} options={ROLE_OPTIONS} allowClear={false} onChange={(x) => setEditing({ ...editing, role: (x ?? 'salesperson') as Role })} />
            <MultiSelectField label="Territories" values={editing.territory_ids} options={territoryOptions()} onChange={(x) => setEditing({ ...editing, territory_ids: x })}
              hint="Salespeople see accounts and projects in these territories" />
            {!editing.user_id ? (
              <TextField label="Temporary password (optional)" value={editing.password} secure autoCapitalize="none"
                onChange={(t) => setEditing({ ...editing, password: t })} hint="Leave empty to send an email invitation instead" />
            ) : (
              <>
                {editing.active ? (
                  <>
                    <SelectField label="On deactivation, reassign open records to" value={reassignTo} options={userOptions().filter((o) => o.value !== editing.user_id)}
                      onChange={setReassignTo} />
                    <Button variant="danger" title="Deactivate user" onPress={() => setActive(false)} />
                  </>
                ) : <Button variant="secondary" title="Activate user" onPress={() => setActive(true)} />}
              </>
            )}
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
