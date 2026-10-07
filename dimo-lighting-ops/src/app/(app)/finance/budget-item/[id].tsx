import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Notice, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { addMonths, amt, fmtMonth, fyLabel, fyStart, isFinanceDesk, LINES, type BudgetInvoice, type BudgetProject } from '@/lib/finance';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Inv = { month: string | null; amount: number | null };
type Form = {
  business_line: string;
  project_name: string;
  customer: string;
  sales_person_id: string | null;
  wbs: string;
  budget_value: number | null;
  budget_gp_pct: string;
  budget_gp_value: number | null;
  order_month: string | null;
  notes: string;
  invoices: Inv[];
};

/** One budgeted project: edit the details and its invoice months / amounts (or add a new one) without re-uploading the list. */
export default function BudgetItemScreen() {
  const { id, fy: fyParam } = useLocalSearchParams<{ id: string; fy?: string }>();
  const isNew = id === 'new';
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [f, setF] = useState<Form | null>(null);
  const { data, error } = useLoad(async () => {
    if (isNew) return { fy: Number(fyParam), row: null };
    const { data: r, error: e } = await supabase.from('budget_projects').select('*, budget_invoices(*)').eq('id', id).single();
    if (e) throw new Error(e.message);
    const row = r as BudgetProject & { budget_invoices: BudgetInvoice[] };
    return { fy: row.fy, row };
  }, [id]);
  if (!isFinanceDesk(me.role)) return <Screen><Notice>Operations, SM Projects or GM / DGM edit the budget list.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  const r = data.row;
  const form: Form = f ?? {
    business_line: r?.business_line ?? '',
    project_name: r?.project_name ?? '',
    customer: r?.customer ?? '',
    sales_person_id: r?.sales_person_id ?? null,
    wbs: r?.wbs ?? '',
    budget_value: r ? Number(r.budget_value) : null,
    budget_gp_pct: r?.budget_gp_pct == null ? '' : String(r.budget_gp_pct),
    budget_gp_value: r?.budget_gp_value == null ? null : Number(r.budget_gp_value),
    order_month: r?.order_month ?? null,
    notes: r?.notes ?? '',
    invoices: r ? [...r.budget_invoices].sort((a, b) => a.month.localeCompare(b.month)).map((i) => ({ month: i.month, amount: Number(i.amount) })) : [],
  };
  const set = (patch: Partial<Form>) => setF({ ...form, ...patch });
  const setInv = (i: number, patch: Partial<Inv>) => set({ invoices: form.invoices.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  // months: the year before (orders won late) to the end of next year
  const months = Array.from({ length: 36 }, (_, i) => addMonths(fyStart(data.fy - 1), i)).map((m) => ({ value: m, label: fmtMonth(m) }));
  const sales = Object.values(people)
    .filter((p) => ['asm_building', 'asm_infra', 'sm_projects', 'gm'].includes(p.role) && (p.active || p.id === form.sales_person_id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((p) => ({ value: p.id, label: p.full_name }));
  const invTotal = form.invoices.reduce((t, i) => t + (Number(i.amount) || 0), 0);
  const over = form.budget_value != null && invTotal > form.budget_value + 1;

  const save = () =>
    dialog.run(async () => {
      await rpc('save_budget_project', {
        p_fy: data.fy,
        p_id: isNew ? null : id,
        p: {
          business_line: LINES.find((l) => l.value === form.business_line)?.label ?? '',
          project_name: form.project_name,
          customer: form.customer,
          sales_person: people[form.sales_person_id ?? '']?.full_name ?? '',
          wbs: form.wbs,
          budget_value: form.budget_value == null ? '' : String(form.budget_value),
          budget_gp_pct: form.budget_gp_pct,
          budget_gp_value: form.budget_gp_value == null ? '' : String(form.budget_gp_value),
          order_month: form.order_month ?? '',
          notes: form.notes,
          invoices: form.invoices.filter((i) => i.month && i.amount).map((i) => ({ month: i.month, amount: i.amount })),
        },
      });
      router.back();
    }, 'Saved');
  const remove = async () => {
    if (!(await dialog.confirm(`Delete ${r?.project_name}?`, 'It is removed from the budget list for the year.', { confirmLabel: 'Delete', danger: true }))) return;
    await dialog.run(async () => { await rpc('delete_budget_project', { p_id: id }); router.back(); }, 'Deleted');
  };

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: isNew ? 'Add budgeted project' : 'Edit budgeted project' }} />
      <Muted>{`${fyLabel(data.fy)} budget list`}</Muted>
      <Card style={{ gap: 4 }}>
        <Grid min={260}>
          <Select label="Business line" required value={form.business_line} onChange={(v) => set({ business_line: v })} options={LINES.map((l) => ({ value: l.value, label: l.label }))} />
          <Select label="Sales person" required searchable value={form.sales_person_id} onChange={(v) => set({ sales_person_id: v })} options={sales} />
        </Grid>
        <Field label="Project name" required value={form.project_name} onChangeText={(v) => set({ project_name: v })} />
        <Grid min={260}>
          <Field label="Customer" value={form.customer} onChangeText={(v) => set({ customer: v })} />
          <Field label="WBS (optional)" value={form.wbs} onChangeText={(v) => set({ wbs: v })} />
        </Grid>
        <Grid min={200}>
          <NumberField label="Budget value" suffix="LKR" required value={form.budget_value} onChange={(v) => set({ budget_value: v })} />
          <Field label="Budget GP %" value={form.budget_gp_pct} onChangeText={(v) => set({ budget_gp_pct: v })} keyboardType="decimal-pad" />
          <NumberField label="Budget GP value" suffix="LKR" value={form.budget_gp_value} onChange={(v) => set({ budget_gp_value: v })} />
          <Select label="Order month" value={form.order_month} onChange={(v) => set({ order_month: v })} options={months} />
        </Grid>
        <Field label="Notes" value={form.notes} onChangeText={(v) => set({ notes: v })} multiline />
      </Card>

      <Section title="Invoice months" right={<Button small variant="secondary" title="+ Invoice" onPress={() => set({ invoices: [...form.invoices, { month: null, amount: null }] })} />}>
        <Card style={{ gap: 4 }}>
          {form.invoices.map((inv, i) => (
            <Row key={i} gap={8} wrap style={{ alignItems: 'flex-end' }}>
              <View style={{ width: 200 }}>
                <Select label={`Invoice ${i + 1} month`} value={inv.month} onChange={(v) => setInv(i, { month: v })} options={months} />
              </View>
              <View style={{ flex: 1, minWidth: 200 }}>
                <NumberField label="Amount" suffix="LKR" value={inv.amount} onChange={(v) => setInv(i, { amount: v })} />
              </View>
              <Button small variant="ghost" title="Remove" onPress={() => set({ invoices: form.invoices.filter((_, k) => k !== i) })} />
            </Row>
          ))}
          {!form.invoices.length ? <Muted>No invoice months – the budget bars on Invoicing stay empty for this project. Add the months and amounts it is planned to invoice.</Muted> : null}
          <Muted style={{ color: over ? colors.red : colors.muted }}>
            {`Invoices ${amt(invTotal)} of the budget value ${amt(form.budget_value ?? 0)}${over ? ' – more than the budget value' : ''}`}
          </Muted>
        </Card>
      </Section>

      <Row gap={8}>
        <Button title="Save" onPress={save} />
        <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
        {!isNew ? <Button title="Delete" variant="secondary" onPress={remove} /> : null}
      </Row>
    </Screen>
  );
}
