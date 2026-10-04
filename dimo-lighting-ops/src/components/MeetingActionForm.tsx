import { useState } from 'react';
import { CustomerPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, DateField, Field, Row, Select, Toggle } from '@/components/ui';
import { addDaysISO, todayISO } from '@/lib/format';
import type { Profile } from '@/lib/types';

export type ActionDraft = {
  action: string;
  owner_id: string | null;
  due_date: string | null;
  project_id: string | null;
  organization_id: string | null;
  new_project: string;
  new_customer: string;
};

/** Sales meeting action: what, who, by when – and a project / customer from the lists, or a new one by name. */
export function MeetingActionForm({
  owners,
  defaultOwner,
  onSave,
  onCancel,
}: {
  owners: Profile[];
  defaultOwner: string | null;
  onSave: (a: ActionDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [a, setA] = useState<ActionDraft>({
    action: '',
    owner_id: defaultOwner,
    due_date: addDaysISO(todayISO(), 7),
    project_id: null,
    organization_id: null,
    new_project: '',
    new_customer: '',
  });
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<ActionDraft>) => setA((x) => ({ ...x, ...p }));
  return (
    <Card style={{ marginTop: 6, gap: 6 }}>
      <Field label="Action" required multiline value={a.action} onChangeText={(v) => set({ action: v })} />
      <Select
        label="Who"
        required
        value={a.owner_id}
        onChange={(v) => set({ owner_id: v })}
        options={owners.map((p) => ({ value: p.id, label: p.full_name }))}
        searchable
      />
      <DateField label="Due" value={a.due_date} onChange={(v) => set({ due_date: v })} />
      <Toggle
        label="New project / customer – not in the system yet"
        value={isNew}
        onChange={(v) => {
          setIsNew(v);
          set({ project_id: null, organization_id: null, new_project: '', new_customer: '' });
        }}
      />
      {isNew ? (
        <>
          <Field label="New project" value={a.new_project} onChangeText={(v) => set({ new_project: v })} placeholder="e.g. Hilton Colombo refurbishment" />
          <Field label="New customer" value={a.new_customer} onChangeText={(v) => set({ new_customer: v })} placeholder="e.g. Hilton Colombo" />
        </>
      ) : (
        <>
          <ProjectPicker
            label="Project (optional)"
            value={a.project_id}
            onChange={(p) => set({ project_id: p?.id ?? null, organization_id: p?.organization_id ?? a.organization_id })}
          />
          <CustomerPicker organizationId={a.organization_id} unitId={null} showContact={false} onChange={(v) => set({ organization_id: v.organizationId })} />
        </>
      )}
      <Row gap={8}>
        <Button
          title="Save action"
          disabled={busy || !a.action.trim() || !a.owner_id}
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
