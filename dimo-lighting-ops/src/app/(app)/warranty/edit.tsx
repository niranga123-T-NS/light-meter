import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { PersonPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, DateField, ErrorBanner, Field, Loading, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { useLoad, usePeople } from '@/lib/hooks';
import { PROJECT_TYPES, projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Currency, ProjectType, Warranty, WarrantyLine } from '@/lib/types';
import { START_BASIS } from '@/lib/warranty';

type Line = { key: string; id?: string; product_group: string; brand: string; quantity: number | null; years: number | null; supplier_end: string | null };
type Form = {
  source: 'system' | 'outside';
  project_id: string | null;
  project_label: string;
  project_category: ProjectType | null;
  project_owner: string | null;
  project_name: string;
  customer: string;
  site: string;
  site_contact: string;
  category: ProjectType | null;
  owner_id: string | null;
  invoice_no: string;
  contract_no: string;
  currency: Currency;
  contract_value: number | null;
  start_basis: Warranty['start_basis'];
  delivery_date: string | null;
  tc_date: string | null;
  handover_date: string | null;
  invoice_date: string | null;
  project_engineer_id: string | null;
  notes: string;
  lines: Line[];
};

let seq = 0;
const newLine = (p?: Partial<Line>): Line => ({ key: `l${++seq}`, product_group: '', brand: '', quantity: null, years: null, supplier_end: null, ...p });
const blank = (): Form => ({
  source: 'system',
  project_id: null,
  project_label: '',
  project_category: null,
  project_owner: null,
  project_name: '',
  customer: '',
  site: '',
  site_contact: '',
  category: null,
  owner_id: null,
  invoice_no: '',
  contract_no: '',
  currency: 'LKR',
  contract_value: null,
  start_basis: 'handover',
  delivery_date: null,
  tc_date: null,
  handover_date: null,
  invoice_date: null,
  project_engineer_id: null,
  notes: '',
  lines: [newLine()],
});

/** Project completion record = a warranty with its lines (Operations Executive, Senior Electrical Engineer). */
export default function WarrantyEdit() {
  const { id, project } = useLocalSearchParams<{ id?: string; project?: string }>();
  const dialog = useDialog();
  const people = usePeople();
  const [f, setF] = useState<Form | null>(id || project ? null : blank());
  const [error, setError] = useState<string | null>(null);
  const existing = useLoad(async () => {
    if (id) {
      const [{ data: w }, { data: ls }] = await Promise.all([
        supabase.from('warranties').select('*').eq('id', id).single(),
        supabase.from('warranty_lines').select('*').eq('warranty_id', id).order('sort_order'),
      ]);
      const p = w?.project_id ? (await supabase.from('projects').select('id, name, code, project_type, owner_id').eq('id', w.project_id).maybeSingle()).data : null;
      return { w: w as Warranty, lines: (ls ?? []) as WarrantyLine[], p };
    }
    if (project) {
      const { data: p } = await supabase.from('projects').select('id, name, code, project_type, owner_id, organizations(name)').eq('id', project).maybeSingle();
      return { w: null, lines: [], p };
    }
    return null;
  }, [id, project]);
  if (!f && existing.data) {
    const { w, lines, p } = existing.data as { w: Warranty | null; lines: WarrantyLine[]; p: { id: string; name: string; code: string; project_type: ProjectType; owner_id: string; organizations?: { name: string } | null } | null };
    const b = blank();
    setF(
      w
        ? {
            ...b,
            source: w.source,
            project_id: w.project_id,
            project_label: p ? `${p.name} (${p.code})` : '',
            project_category: p?.project_type ?? null,
            project_owner: p?.owner_id ?? null,
            project_name: w.project_name,
            customer: w.customer,
            site: w.site ?? '',
            site_contact: w.site_contact ?? '',
            category: w.category,
            owner_id: w.owner_id,
            invoice_no: w.invoice_no ?? '',
            contract_no: w.contract_no ?? '',
            currency: w.currency,
            contract_value: w.contract_value,
            start_basis: w.start_basis,
            delivery_date: w.delivery_date,
            tc_date: w.tc_date,
            handover_date: w.handover_date,
            invoice_date: w.invoice_date,
            project_engineer_id: w.project_engineer_id,
            notes: w.notes ?? '',
            lines: lines.map((l) => newLine({ id: l.id, product_group: l.product_group, brand: l.brand ?? '', quantity: l.quantity, years: l.months / 12, supplier_end: l.supplier_end })),
          }
        : p
          ? { ...b, project_id: p.id, project_label: `${p.name} (${p.code})`, project_category: p.project_type, project_owner: p.owner_id, customer: p.organizations?.name ?? '' }
          : b,
    );
  }
  if (!f) return <Screen>{existing.error ? <ErrorBanner message={existing.error} /> : <Loading />}</Screen>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => (s ? { ...s, [k]: v } : s));
  const setLine = (key: string, patch: Partial<Line>) => setF((s) => (s ? { ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) } : s));
  const sys = f.source === 'system';
  const basisDate = { delivery: f.delivery_date, tc: f.tc_date, handover: f.handover_date, invoice: f.invoice_date }[f.start_basis];

  const save = () => {
    setError(null);
    if (sys && !f.project_id) return setError('Choose the project, or select “Not in the system”');
    if (!sys && (!f.project_name.trim() || !f.customer.trim() || !f.category)) return setError('Project name, customer and category are required');
    if (!f.invoice_no.trim() && !f.contract_no.trim()) return setError('Enter the invoice number or the contract number');
    if (!basisDate) return setError(`Enter the ${START_BASIS.find((b) => b.value === f.start_basis)?.label.toLowerCase()} date – the warranty starts from it`);
    const lines = f.lines.filter((l) => l.product_group.trim() || l.years);
    if (!lines.length) return setError('Add at least one warranty line');
    const bad = lines.findIndex((l) => !l.product_group.trim() || !l.years || l.years <= 0);
    if (bad >= 0) return setError(`Line ${bad + 1}: enter the product group and the warranty period`);
    return dialog.run(async () => {
      const wid = await rpc<string>('save_warranty', {
        p_id: id ?? null,
        p_data: {
          source: f.source,
          project_id: sys ? f.project_id : '',
          project_name: f.project_name,
          customer: f.customer,
          site: f.site,
          site_contact: f.site_contact,
          category: sys ? '' : (f.category ?? ''),
          owner_id: f.owner_id ?? '',
          invoice_no: f.invoice_no,
          contract_no: f.contract_no,
          currency: f.currency,
          contract_value: f.contract_value == null ? '' : String(f.contract_value),
          start_basis: f.start_basis,
          delivery_date: f.delivery_date ?? '',
          tc_date: f.tc_date ?? '',
          handover_date: f.handover_date ?? '',
          invoice_date: f.invoice_date ?? '',
          project_engineer_id: f.project_engineer_id ?? '',
          notes: f.notes,
        },
        p_lines: lines.map((l) => ({
          id: l.id ?? '',
          product_group: l.product_group,
          brand: l.brand,
          quantity: l.quantity == null ? '' : String(l.quantity),
          months: Math.round((l.years ?? 0) * 12),
          supplier_end: l.supplier_end ?? '',
        })),
      });
      router.replace(`/warranty/${wid}`);
    }, 'Completion record saved');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: id ? 'Edit completion record' : 'Project completion record' }} />
      <ErrorBanner message={error} />
      <Section title="Project">
        <Card>
          <Select
            label="Project"
            required
            value={f.source}
            onChange={(v) => set('source', v as Form['source'])}
            options={[
              { value: 'system', label: 'Project in the system' },
              { value: 'outside', label: 'Not in the system (outside project)' },
            ]}
          />
          {sys ? (
            <>
              <ProjectPicker
                label="Project in the system"
                required
                value={f.project_id}
                onChange={(p) =>
                  setF((s) =>
                    s
                      ? {
                          ...s,
                          project_id: p?.id ?? null,
                          project_label: p ? p.name : '',
                          project_category: p?.project_type ?? null,
                          project_owner: p?.owner_id ?? null,
                          customer: s.customer || ((p as unknown as { organizations?: { name: string } })?.organizations?.name ?? ''),
                        }
                      : s,
                  )
                }
              />
              {f.project_id ? (
                <Muted>
                  {f.project_label ? `${f.project_label} · ` : ''}Category {projectTypeLabel(f.project_category)} · owner {people[f.project_owner ?? '']?.full_name ?? '—'} (filled in from the project)
                </Muted>
              ) : null}
              <Field label="Customer" value={f.customer} onChangeText={(v) => set('customer', v)} hint="Defaults to the project's customer" />
            </>
          ) : (
            <>
              <Field label="Project name" required value={f.project_name} onChangeText={(v) => set('project_name', v)} />
              <Field label="Customer" required value={f.customer} onChangeText={(v) => set('customer', v)} hint="Use the same customer name as in the debtors list" />
              <Select
                label="Category"
                required
                value={f.category}
                onChange={(v) => set('category', v as ProjectType)}
                options={PROJECT_TYPES.map((p) => ({ value: p.value, label: `${p.label} (${p.line})` }))}
                hint="The owner is the sales person who handles this category (unless you choose one below)"
              />
            </>
          )}
          <PersonPicker label="Owner (sales person) – leave blank for the default" roles={['asm_building', 'asm_infra']} value={f.owner_id} onChange={(v) => set('owner_id', v || null)} />
          <Field label="Site address" value={f.site} onChangeText={(v) => set('site', v)} />
          <Field label="Site contact (name, phone)" value={f.site_contact} onChangeText={(v) => set('site_contact', v)} />
        </Card>
      </Section>

      <Section title="Invoice / contract">
        <Card>
          <Field label="Invoice number" value={f.invoice_no} onChangeText={(v) => set('invoice_no', v)} hint="Invoice or contract number is required" />
          <Field label="Contract / PO number" value={f.contract_no} onChangeText={(v) => set('contract_no', v)} />
          <Select
            label="Currency"
            value={f.currency}
            onChange={(v) => set('currency', v as Currency)}
            options={[
              { value: 'LKR', label: 'LKR' },
              { value: 'USD', label: 'USD' },
            ]}
          />
          <NumberField label="Supply / contract value" suffix={f.currency} value={f.contract_value} onChange={(v) => set('contract_value', v)} />
        </Card>
      </Section>

      <Section title="Completion dates">
        <Card>
          <DateField label="Delivery date" value={f.delivery_date} onChange={(v) => set('delivery_date', v)} quick={[]} />
          <DateField label="Testing & commissioning date" value={f.tc_date} onChange={(v) => set('tc_date', v)} quick={[]} />
          <DateField label="Handover date" value={f.handover_date} onChange={(v) => set('handover_date', v)} quick={[]} />
          <DateField label="Invoice date" value={f.invoice_date} onChange={(v) => set('invoice_date', v)} quick={[]} />
          <Select label="Warranty starts from" required value={f.start_basis} onChange={(v) => set('start_basis', v as Form['start_basis'])} options={START_BASIS} />
          <PersonPicker label="Project engineer" roles={['assistant_engineer', 'senior_elec_engineer']} value={f.project_engineer_id} onChange={(v) => set('project_engineer_id', v || null)} />
        </Card>
      </Section>

      <Section title="Warranty lines (installed items)" right={<Button small title="+ Line" onPress={() => set('lines', [...f.lines, newLine()])} />}>
        {f.lines.map((l, i) => (
          <Card key={l.key} style={{ marginBottom: 8 }}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700' }}>Line {i + 1}</Text>
              {f.lines.length > 1 ? <Button small variant="ghost" title="Remove" onPress={() => set('lines', f.lines.filter((x) => x.key !== l.key))} /> : null}
            </Row>
            <Field label="Product group" required value={l.product_group} onChangeText={(v) => setLine(l.key, { product_group: v })} hint="e.g. Luminaires – downlights, LED drivers, Lighting controls" />
            <Field label="Brand" value={l.brand} onChangeText={(v) => setLine(l.key, { brand: v })} />
            <Row wrap gap={8}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <NumberField label="Quantity" value={l.quantity} onChange={(v) => setLine(l.key, { quantity: v })} />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <NumberField label="Warranty to client" suffix="years" required value={l.years} onChange={(v) => setLine(l.key, { years: v })} />
              </View>
            </Row>
            <DateField label="Supplier warranty ends" value={l.supplier_end} onChange={(v) => setLine(l.key, { supplier_end: v })} quick={[]} hint="From the supplier's invoice / certificate – used to warn when our warranty is longer" />
          </Card>
        ))}
        <Muted style={{ color: colors.muted }}>End dates are calculated from the start date and the period of each line. Upload the handover certificate, T&C report, as-built drawings and warranty certificate on the warranty after saving.</Muted>
      </Section>

      <Section title="Notes">
        <Card>
          <Field label="Notes" multiline value={f.notes} onChangeText={(v) => set('notes', v)} />
        </Card>
      </Section>
      <Row style={{ marginTop: 12 }}>
        <Button title={id ? 'Save changes' : 'Save completion record'} onPress={save} />
      </Row>
    </Screen>
  );
}
