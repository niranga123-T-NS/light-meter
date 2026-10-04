import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { PersonPicker, ProjectPicker } from '@/components/pickers';
import { Button, Card, colors, DateField, ErrorBanner, Field, Loading, Muted, Notice, NumberField, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { PROJECT_TYPES } from '@/lib/roles';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Warranty, WarrantyLine, WarrantyReport } from '@/lib/types';
import { isWarrantyDesk, REPORTED_VIA } from '@/lib/warranty';
import { useMe } from '@/lib/auth';

function addMonthsISO(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** Log a warranty claim (Operations Executive, Senior Electrical Engineer) – from a customer, or from an issue a sales person reported. */
export default function ClaimNew() {
  const params = useLocalSearchParams<{ warranty?: string; report?: string }>();
  const dialog = useDialog();
  const me = useMe();
  const desk = isWarrantyDesk(me.role);
  const see = me.role === 'senior_elec_engineer';
  const people = usePeople();
  const [warrantyId, setWarrantyId] = useState<string | null>(params.warranty ?? null);
  const [lineId, setLineId] = useState<string>('');
  const [via, setVia] = useState(params.report ? 'sales_visit' : 'customer_call');
  const [desc, setDesc] = useState<string | null>(null);
  const [qty, setQty] = useState<number | null | undefined>(undefined);
  const [loc, setLoc] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Older project with no warranty record: details entered by hand create the record with the claim
  const [mode, setMode] = useState<'list' | 'manual' | null>(null);
  const [inSystem, setInSystem] = useState<'system' | 'outside'>('system');
  const [man, setMan] = useState({ project_id: '', project_label: '', project_name: '', customer: '', category: '', invoice_no: '', contract_no: '', start_basis: 'handover', start_date: null as string | null, months: '', product_group: '', brand: '' });
  const setM = (patch: Partial<typeof man>) => setMan({ ...man, ...patch });
  const { data, error: loadErr } = useLoad(async () => {
    const [w, l, r] = await Promise.all([
      supabase.from('warranties').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(3000),
      supabase.from('warranty_lines').select('*').order('sort_order').limit(10000),
      params.report ? supabase.from('warranty_reports').select('*').eq('id', params.report).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return { warranties: (w.data ?? []) as Warranty[], lines: (l.data ?? []) as WarrantyLine[], report: r.data as WarrantyReport | null };
  }, [params.report]);
  if (!data) return <Screen>{loadErr ? <ErrorBanner message={loadErr} /> : <Loading />}</Screen>;
  const report = data.report;
  const today = todayISO();
  const norm = (s: string) => s.trim().toLowerCase();
  // Warranties of the reported customer first
  const sorted = [...data.warranties].sort((a, b) => {
    if (!report) return 0;
    const m = (w: Warranty) => Number(norm(w.customer) === norm(report.customer) || (!!report.project_id && w.project_id === report.project_id));
    return m(b) - m(a);
  });
  const lines = data.lines.filter((l) => l.warranty_id === warrantyId);
  const line = lines.find((l) => l.id === lineId);
  const inWarranty = line ? line.end_date >= today : lines.some((l) => l.end_date >= today);
  const entry = mode ?? (data.warranties.length || params.warranty ? 'list' : 'manual');
  const manualEnd = man.start_date && Number(man.months) > 0 ? addMonthsISO(man.start_date, Number(man.months)) : null;
  const description = desc ?? report?.description ?? '';
  const quantity = qty === undefined ? (report?.quantity ?? null) : qty;
  const location = loc ?? report?.location ?? '';

  const save = () => {
    setError(null);
    if (entry === 'list' && !warrantyId) return setError('Choose the warranty – search by invoice / contract number, customer or project');
    if (entry === 'manual') {
      if (inSystem === 'system' && !man.project_id) return setError('Choose the project');
      if (inSystem === 'outside' && (!man.project_name.trim() || !man.customer.trim() || !man.category)) return setError('Enter the project name, customer and category');
      if (!man.invoice_no.trim() && !man.contract_no.trim()) return setError('Enter the invoice number or the contract number');
      if (!man.start_date) return setError('Enter the date the warranty started');
      if (!man.months) return setError('Choose the warranty period');
      if (!man.product_group.trim()) return setError('Enter the item that failed (product group)');
    }
    if (!description.trim()) return setError('Describe the failure');
    return dialog.run(async () => {
      const cid = await rpc<string>('log_warranty_claim', {
        p_data: {
          warranty_id: entry === 'list' ? warrantyId : '',
          line_id: entry === 'list' ? lineId : '',
          ...(entry === 'manual'
            ? {
                manual: {
                  project_id: inSystem === 'system' ? man.project_id : '',
                  project_name: man.project_name,
                  customer: man.customer,
                  category: man.category,
                  invoice_no: man.invoice_no,
                  contract_no: man.contract_no,
                  start_basis: man.start_basis,
                  start_date: man.start_date,
                  months: man.months,
                  product_group: man.product_group,
                  brand: man.brand,
                  quantity: quantity == null ? '' : String(quantity),
                },
              }
            : {}),
          reported_via: via,
          report_id: report?.id ?? '',
          description,
          quantity: quantity == null ? '' : String(quantity),
          location,
          assignee_id: assignee ?? '',
        },
      });
      router.replace(`/warranty/claims/${cid}`);
    }, 'Claim logged');
  };

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: desk ? 'Log warranty claim' : 'Raise warranty claim' }} />
      <ErrorBanner message={error} />
      {report ? (
        <Notice tone={colors.blue}>
          {`Reported from a visit by ${people[report.sales_person_id]?.full_name ?? '—'} on ${fmtDateTime(report.created_at)}: ${report.customer}${report.project_name ? ` – ${report.project_name}` : ''} · ${report.description}${report.site_contact ? ` · site contact ${report.site_contact}` : ''}`}
        </Notice>
      ) : null}
      <Section title="Warranty">
        <Segmented
          value={entry}
          onChange={(v) => setMode(v)}
          options={[
            { value: 'list', label: 'From the warranty list' },
            { value: 'manual', label: 'Enter manually (older project)' },
          ]}
        />
        {entry === 'list' ? (
        <Card>
          <Select
            label="Warranty (invoice / contract no., customer or project)"
            required
            searchable
            value={warrantyId}
            onChange={(v) => {
              setWarrantyId(v || null);
              setLineId('');
            }}
            options={sorted.map((w) => ({
              value: w.id,
              label: `${[w.invoice_no, w.contract_no].filter(Boolean).join(' / ')} · ${w.customer} · ${w.project_name}`,
              hint: `${w.code}${w.source === 'outside' ? ' · outside project' : ''}`,
            }))}
          />
          {!sorted.length ? <Muted>No warranty records yet – use “Enter manually (older project)”.</Muted> : null}
          <Muted>Not in the list? Use “Enter manually (older project)” above – the warranty record is created with the claim.</Muted>
          {warrantyId ? (
            <Select
              label="Item (warranty line)"
              value={lineId}
              onChange={setLineId}
              options={[
                { value: '', label: 'Not sure / several items' },
                ...lines.map((l) => ({
                  value: l.id,
                  label: `${l.product_group}${l.brand ? ` – ${l.brand}` : ''}`,
                  hint: `${l.end_date >= today ? 'in warranty' : 'ended'} · ends ${fmtDate(l.end_date)}`,
                })),
              ]}
            />
          ) : null}
          {warrantyId ? (
            <Notice tone={inWarranty ? colors.green : colors.red}>{inWarranty ? 'In warranty' : 'Out of warranty – covering it needs SM Projects approval (goodwill)'}</Notice>
          ) : null}
        </Card>
        ) : (
          <Card>
            <Segmented
              value={inSystem}
              onChange={(v) => setInSystem(v)}
              options={[
                { value: 'system', label: 'Project in the system' },
                { value: 'outside', label: 'Project not in the system' },
              ]}
            />
            {inSystem === 'system' ? (
              <ProjectPicker label="Project" required value={man.project_id || null} onChange={(p) => setM({ project_id: p?.id ?? '', project_label: p?.name ?? '' })} />
            ) : (
              <>
                <Field label="Project name" required value={man.project_name} onChangeText={(v) => setM({ project_name: v })} />
                <Field label="Customer" required value={man.customer} onChangeText={(v) => setM({ customer: v })} hint="Same name as in the debtors list" />
                <Select label="Category" required value={man.category} onChange={(v) => setM({ category: v })} options={PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label }))} hint="Decides the owner (sales person)" />
              </>
            )}
            <Field label="Invoice number" value={man.invoice_no} onChangeText={(v) => setM({ invoice_no: v })} hint="Invoice or contract number is required" />
            <Field label="Contract / PO number" value={man.contract_no} onChangeText={(v) => setM({ contract_no: v })} />
            <Select
              label="Warranty started from"
              value={man.start_basis}
              onChange={(v) => setM({ start_basis: v })}
              options={[
                { value: 'handover', label: 'Handover' },
                { value: 'tc', label: 'Testing & commissioning' },
                { value: 'delivery', label: 'Delivery' },
                { value: 'invoice', label: 'Invoice' },
              ]}
            />
            <DateField label="Start date" required value={man.start_date} onChange={(v) => setM({ start_date: v })} quick={[]} />
            <Select
              label="Warranty period"
              required
              value={man.months}
              onChange={(v) => setM({ months: v })}
              options={[12, 18, 24, 36, 48, 60, 84, 120].map((n) => ({ value: String(n), label: n % 12 === 0 ? `${n / 12} year${n > 12 ? 's' : ''} (${n} months)` : `${n} months` }))}
            />
            <Field label="Item that failed (product group)" required value={man.product_group} onChangeText={(v) => setM({ product_group: v })} hint="e.g. Downlights, LED drivers, Pole-top luminaires" />
            <Field label="Brand" value={man.brand} onChangeText={(v) => setM({ brand: v })} />
            {manualEnd ? (
              <Notice tone={manualEnd >= today ? colors.green : colors.red}>
                {manualEnd >= today
                  ? `In warranty – ends ${fmtDate(manualEnd)}`
                  : `Out of warranty – ended ${fmtDate(manualEnd)}. Covering it needs SM Projects approval (goodwill).`}
              </Notice>
            ) : null}
            <Muted>A warranty record is created with these details; Operations completes it later (other items, documents).</Muted>
          </Card>
        )}
      </Section>
      <Section title="Failure">
        <Card>
          {!report ? <Select label="Reported via" required value={via} onChange={setVia} options={REPORTED_VIA.filter((v) => v.value !== 'sales_visit')} /> : null}
          <Field label="What failed" required multiline value={description} onChangeText={setDesc} />
          <NumberField label="Quantity" value={quantity} onChange={(v) => setQty(v)} />
          <Field label="Location on site" value={location} onChangeText={setLoc} />
          {see ? (
            <PersonPicker label="Assign to engineer (site inspection)" roles={['assistant_engineer', 'senior_elec_engineer']} value={assignee} onChange={(v) => setAssignee(v || null)} />
          ) : (
            <Muted>
              {desk
                ? 'The Senior Electrical Engineer is notified to assign the engineer.'
                : 'Operations verifies the invoice / contract number; the Senior Electrical Engineer then assigns the engineer. You will be notified.'}
            </Muted>
          )}
          <Muted>Add photos and the customer letter / email on the claim after saving.</Muted>
        </Card>
      </Section>
      <Row style={{ marginTop: 12 }}>
        <Button title={desk ? 'Log claim' : 'Raise warranty claim'} onPress={save} />
      </Row>
    </Screen>
  );
}
