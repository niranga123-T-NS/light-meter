import { View } from 'react-native';
import { useState } from 'react';
import { CustomerPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, DateField, Field, Muted, Row, Select, Toggle } from '@/components/ui';
import { ObjectivePicker } from '@/components/VisitBits';
import { addDaysISO, todayISO } from '@/lib/format';
import { ACTION_KINDS, type ActionKind, ownerRoles } from '@/lib/meetingActions';
import type { Profile } from '@/lib/types';

export type ActionDraft = {
  kind: ActionKind;
  action: string;
  owner_id: string | null;
  due_date: string | null;
  project_id: string | null;
  organization_id: string | null;
  unit_id: string | null;
  new_project: string;
  new_customer: string;
  objective: string | null;
};

/** Sales meeting action: type, what, who, by when – and a project / customer from the lists, or a new one by name. */
export function MeetingActionForm({
  owners,
  defaultOwner,
  onSave,
  onCancel,
  fixedProject,
}: {
  owners: Profile[];
  defaultOwner: string | null;
  /** A project meeting: the project and its customer are filled in from the project (not chosen) */
  fixedProject?: { project_id: string | null; organization_id: string | null; project: string; customer: string | null };
  onSave: (a: ActionDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [a, setA] = useState<ActionDraft>({
    kind: 'task',
    action: '',
    owner_id: defaultOwner,
    due_date: addDaysISO(todayISO(), 7),
    project_id: fixedProject?.project_id ?? null,
    organization_id: fixedProject?.organization_id ?? null,
    unit_id: null,
    new_project: '',
    new_customer: '',
    objective: null,
  });
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<ActionDraft>) => setA((x) => ({ ...x, ...p }));
  const roles = ownerRoles(a.kind);
  const list = roles ? owners.filter((p) => roles.includes(p.role)) : owners;
  const visit = a.kind === 'visit';
  const ready = a.action.trim() && a.owner_id && (!visit || (a.organization_id && a.objective && a.due_date));

  const setKind = (k: ActionKind) => {
    const r = ownerRoles(k);
    const keep = a.owner_id && (!r || r.includes(owners.find((p) => p.id === a.owner_id)?.role as never)) ? a.owner_id : null;
    const def = defaultOwner && (!r || r.includes(owners.find((p) => p.id === defaultOwner)?.role as never)) ? defaultOwner : null;
    set({ kind: k, owner_id: keep ?? def ?? (r ? (owners.find((p) => r.includes(p.role))?.id ?? null) : null) });
    if (k === 'visit') setIsNew(false);
  };

  return (
    <Card style={{ marginTop: 6, gap: 6 }}>
      <Select
        label="Type"
        required
        value={a.kind}
        onChange={(v) => setKind(v as ActionKind)}
        options={ACTION_KINDS.map((k) => ({ value: k.value, label: k.label }))}
      />
      <Muted>{ACTION_KINDS.find((k) => k.value === a.kind)?.hint}</Muted>
      <Field label={visit ? 'Purpose of the visit' : 'Action'} required multiline value={a.action} onChangeText={(v) => set({ action: v })} />
      <Select
        label={roles && a.kind !== 'visit' ? 'Manager (appoints the person)' : visit ? 'Sales person' : 'Who'}
        required
        value={a.owner_id}
        onChange={(v) => set({ owner_id: v })}
        options={list.map((p) => ({ value: p.id, label: p.full_name }))}
        searchable
      />
      <DateField label={visit ? 'Visit by' : 'Due'} required={visit} value={a.due_date} onChange={(v) => set({ due_date: v })} />
      {fixedProject ? (
        <View style={{ paddingVertical: 4 }}>
          <Muted>{`Project: ${fixedProject.project}`}</Muted>
          <Muted>{`Customer: ${fixedProject.customer ?? '—'}`}</Muted>
        </View>
      ) : visit ? null : (
        <Toggle
          label="New project / customer – not in the system yet"
          value={isNew}
          onChange={(v) => {
            setIsNew(v);
            set({ project_id: null, organization_id: null, unit_id: null, new_project: '', new_customer: '' });
          }}
        />
      )}
      {fixedProject ? null : isNew && !visit ? (
        <>
          <Field label="New project" value={a.new_project} onChangeText={(v) => set({ new_project: v })} placeholder="e.g. Hilton Colombo refurbishment" />
          <Field label="New customer" value={a.new_customer} onChangeText={(v) => set({ new_customer: v })} placeholder="e.g. Hilton Colombo" />
        </>
      ) : (
        <>
          <ProjectPicker
            label={visit ? 'Project (needed unless it is a networking visit)' : 'Project (optional)'}
            value={a.project_id}
            onChange={(p) => {
              const org = p?.organization_id ?? a.organization_id;
              set({ project_id: p?.id ?? null, organization_id: org, unit_id: org === a.organization_id ? a.unit_id : null });
            }}
          />
          <CustomerPicker
            organizationId={a.organization_id}
            unitId={a.unit_id}
            showContact={false}
            onChange={(v) => set({ organization_id: v.organizationId, unit_id: v.unitId })}
          />
        </>
      )}
      {visit ? (
        <>
          <ObjectivePicker label="Visit objective" required value={a.objective} onChange={(v) => set({ objective: v })} />
          <Muted>A new customer is added in Customers first, then chosen here.</Muted>
        </>
      ) : null}
      <Row gap={8}>
        <Button
          title="Save action"
          disabled={busy || !ready}
          onPress={async () => {
            setBusy(true);
            try {
              await onSave(a);
            } finally {
              setBusy(false);
            }
          }}
        />
        <Button variant="ghost" title="Cancel" onPress={onCancel} />
      </Row>
    </Card>
  );
}
