import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { PersonPicker } from '@/components/pickers';
import { Button, Card, colors, ErrorBanner, Field, Loading, Muted, Notice, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Warranty, WarrantyLine, WarrantyReport } from '@/lib/types';
import { REPORTED_VIA } from '@/lib/warranty';

/** Log a warranty claim (Operations Executive, Senior Electrical Engineer) – from a customer, or from an issue a sales person reported. */
export default function ClaimNew() {
  const params = useLocalSearchParams<{ warranty?: string; report?: string }>();
  const dialog = useDialog();
  const people = usePeople();
  const [warrantyId, setWarrantyId] = useState<string | null>(params.warranty ?? null);
  const [lineId, setLineId] = useState<string>('');
  const [via, setVia] = useState(params.report ? 'sales_visit' : 'customer_call');
  const [desc, setDesc] = useState<string | null>(null);
  const [qty, setQty] = useState<number | null | undefined>(undefined);
  const [loc, setLoc] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const description = desc ?? report?.description ?? '';
  const quantity = qty === undefined ? (report?.quantity ?? null) : qty;
  const location = loc ?? report?.location ?? '';

  const save = () => {
    setError(null);
    if (!warrantyId) return setError('Choose the warranty – search by invoice / contract number, customer or project');
    if (!description.trim()) return setError('Describe the failure');
    return dialog.run(async () => {
      const cid = await rpc<string>('log_warranty_claim', {
        p_data: {
          warranty_id: warrantyId,
          line_id: lineId,
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
      <Stack.Screen options={{ title: 'Log warranty claim' }} />
      <ErrorBanner message={error} />
      {report ? (
        <Notice tone={colors.blue}>
          {`Reported from a visit by ${people[report.sales_person_id]?.full_name ?? '—'} on ${fmtDateTime(report.created_at)}: ${report.customer}${report.project_name ? ` – ${report.project_name}` : ''} · ${report.description}${report.site_contact ? ` · site contact ${report.site_contact}` : ''}`}
        </Notice>
      ) : null}
      <Section title="Warranty">
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
          {!sorted.length ? <Muted>No warranty records yet – enter the completion record first (outside projects too).</Muted> : null}
          <Button small variant="ghost" title="+ New completion record (project not recorded yet)" onPress={() => router.push('/warranty/edit')} />
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
      </Section>
      <Section title="Failure">
        <Card>
          {!report ? <Select label="Reported via" required value={via} onChange={setVia} options={REPORTED_VIA.filter((v) => v.value !== 'sales_visit')} /> : null}
          <Field label="What failed" required multiline value={description} onChangeText={setDesc} />
          <NumberField label="Quantity" value={quantity} onChange={(v) => setQty(v)} />
          <Field label="Location on site" value={location} onChangeText={setLoc} />
          <PersonPicker label="Assign to engineer (site inspection)" roles={['assistant_engineer', 'senior_elec_engineer']} value={assignee} onChange={(v) => setAssignee(v || null)} />
          <Muted>Add photos and the customer letter / email on the claim after saving.</Muted>
        </Card>
      </Section>
      <Row style={{ marginTop: 12 }}>
        <Button title="Log claim" onPress={save} />
      </Row>
    </Screen>
  );
}
