import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { cached } from '@/lib/hooks';
import { projectTypeLabel } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Contact, Organization, OrgUnit, Project, Role } from '@/lib/types';
import { Button, colors, Muted, Row, Select, styles } from './ui';

// Search-and-select lists (Section 5.6: projects are selected, never typed as free text).

/** A project created (or chosen) from "+ Create project" inside a form; the form's picker selects it on return. */
let pickedProject: string | null = null;
export const handOffProject = (id: string) => {
  pickedProject = id;
};
const takeHandedOffProject = () => {
  const id = pickedProject;
  pickedProject = null;
  return id;
};

export function ProjectPicker({
  value,
  onChange,
  label = 'Project',
  required,
  onCreate,
}: {
  value: string | null;
  onChange: (p: Project | null) => void;
  label?: string;
  required?: boolean;
  onCreate?: (query: string) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Project[]>([]);
  const [loaded, setCurrent] = useState<Project | null>(null);
  const current = value && loaded?.id === value ? loaded : null;
  const [open, setOpen] = useState(false);

  // Returning from "+ Create project": select the project that was just created
  useFocusEffect(
    useCallback(() => {
      if (!onCreate) return;
      const id = takeHandedOffProject();
      if (!id) return;
      supabase
        .from('projects')
        .select('*, organizations(name)')
        .eq('id', id)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          setCurrent(data as Project);
          onChange(data as Project);
        });
    }, [onCreate, onChange]),
  );

  useEffect(() => {
    if (!value || loaded?.id === value) return;
    supabase
      .from('projects')
      .select('*, organizations(name)')
      .eq('id', value)
      .maybeSingle()
      .then(({ data }) => setCurrent(data as Project | null));
  }, [value, loaded?.id]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      // All projects in scope are cached so the picker also works offline.
      const all = await cached('projects', async () => {
        const { data, error } = await supabase
          .from('projects')
          .select('*, organizations(name)')
          .is('merged_into', null)
          .order('last_activity_at', { ascending: false })
          .limit(2000);
        if (error) throw new Error(error.message);
        return (data ?? []) as Project[];
      }).catch(() => [] as Project[]);
      const s = q.trim().toLowerCase();
      setResults(
        (s
          ? all.filter((p) => [p.name, p.code, p.city, p.organizations?.name].some((v) => v?.toLowerCase().includes(s)))
          : all
        ).slice(0, 15),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: colors.brand }}> *</Text> : null}
      </Text>
      {current && !open ? (
        <Pressable onPress={() => setOpen(true)} style={[styles.input, { gap: 2 }]}>
          <Text style={{ fontWeight: '600', color: colors.ink }}>{current.name}</Text>
          <Muted>
            {current.code} · {current.organizations?.name} · {projectTypeLabel(current.project_type)} · {current.stage}
          </Muted>
        </Pressable>
      ) : (
        <>
          <TextInput
            value={q}
            onChangeText={setQ}
            onFocus={() => setOpen(true)}
            placeholder="Search project, customer, city or code…"
            placeholderTextColor={colors.faint}
            style={styles.input}
          />
          {open ? (
            <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, marginTop: 4, backgroundColor: '#fff' }}>
              {results.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    setCurrent(p);
                    onChange(p);
                    setOpen(false);
                    setQ('');
                  }}
                  style={({ pressed }) => [{ padding: 10, borderBottomWidth: 1, borderBottomColor: colors.line }, pressed && { backgroundColor: colors.soft }]}
                >
                  <Text style={{ fontWeight: '600', color: colors.ink }}>{p.name}</Text>
                  <Muted>
                    {p.code} · {p.organizations?.name} · {p.stage}
                  </Muted>
                </Pressable>
              ))}
              {!results.length ? <Muted style={{ padding: 10 }}>No matching project</Muted> : null}
              <Row style={{ padding: 8, justifyContent: 'space-between' }}>
                {onCreate ? <Button small variant="secondary" title="+ Create project" onPress={() => onCreate(q)} /> : <View />}
                <Button small variant="ghost" title="Close" onPress={() => setOpen(false)} />
              </Row>
            </View>
          ) : null}
        </>
      )}
      {current && !open && !required ? (
        <Pressable onPress={() => { setCurrent(null); onChange(null); }}>
          <Text style={styles.hint}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Organization → unit → contact (Section 4.9). */
export function CustomerPicker({
  organizationId,
  unitId,
  contactId,
  onChange,
  requireUnit,
  showContact = true,
}: {
  organizationId: string | null;
  unitId: string | null;
  contactId?: string | null;
  onChange: (v: { organizationId: string | null; unitId: string | null; contactId: string | null; organization?: Organization }) => void;
  requireUnit?: boolean;
  showContact?: boolean;
}) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [unitsState, setUnits] = useState<OrgUnit[]>([]);
  const [contactsState, setContacts] = useState<Contact[]>([]);
  const units = organizationId ? unitsState.filter((u) => u.organization_id === organizationId) : [];
  const contacts = organizationId ? contactsState.filter((c) => c.organization_id === organizationId) : [];

  useEffect(() => {
    cached('organizations', async () => {
      const { data, error } = await supabase.from('organizations').select('*').is('merged_into', null).order('name').limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Organization[];
    })
      .then(setOrgs)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    cached(`units.${organizationId}`, async () => {
      const { data, error } = await supabase.from('org_units').select('*').eq('organization_id', organizationId).order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as OrgUnit[];
    })
      .then(setUnits)
      .catch(() => setUnits([]));
    cached(`contacts.${organizationId}`, async () => {
      const { data, error } = await supabase.from('contacts').select('*').eq('organization_id', organizationId).order('name');
      if (error) throw new Error(error.message);
      return (data ?? []) as Contact[];
    })
      .then(setContacts)
      .catch(() => setContacts([]));
  }, [organizationId]);

  return (
    <View>
      <Select
        label="Organization"
        required
        searchable
        value={organizationId}
        options={orgs.map((o) => ({ value: o.id, label: o.name, hint: o.visit_category }))}
        onChange={(id) => onChange({ organizationId: id, unitId: null, contactId: null, organization: orgs.find((o) => o.id === id) })}
      />
      {units.length ? (
        <Select
          label="Unit / department"
          required={requireUnit}
          value={unitId}
          options={units.map((u) => ({ value: u.id, label: u.name, hint: u.unit_type }))}
          onChange={(id) => onChange({ organizationId, unitId: id, contactId: null })}
        />
      ) : null}
      {showContact ? (
        <Select
          label="Contact person"
          value={contactId ?? null}
          options={contacts
            .filter((c) => !unitId || !c.unit_id || c.unit_id === unitId)
            .map((c) => ({ value: c.id, label: c.name, hint: c.designation ?? undefined }))}
          onChange={(id) => onChange({ organizationId, unitId, contactId: id })}
          placeholder={contacts.length ? 'Select…' : 'No contacts yet – add one on the customer page'}
        />
      ) : null}
    </View>
  );
}

export function PersonPicker({
  label,
  roles,
  value,
  onChange,
  required,
  hint,
}: {
  label: string;
  roles: Role[];
  value: string | null;
  onChange: (id: string) => void;
  required?: boolean;
  hint?: string;
}) {
  const [people, setPeople] = useState<{ id: string; full_name: string; role: Role }[]>([]);
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .in('role', roles)
      .eq('active', true)
      .order('full_name')
      .then(({ data }) => setPeople((data ?? []) as never));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles.join(',')]);
  return (
    <Select
      label={label}
      required={required}
      hint={hint}
      value={value}
      options={people.map((p) => ({ value: p.id, label: p.full_name, hint: p.role.replace(/_/g, ' ') }))}
      onChange={onChange}
    />
  );
}
