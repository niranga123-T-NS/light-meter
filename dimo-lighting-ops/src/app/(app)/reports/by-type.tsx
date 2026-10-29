import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, colors, ErrorBanner, Grid, Loading, Muted, MultiSelect, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { type Column, exportExcelTables, exportPdf, tableHtml } from '@/lib/export';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad, useMasters } from '@/lib/hooks';
import { fetchAll } from '@/lib/mgmtReport';
import { PROJECT_TYPES, projectTypeLabel, ROLE_SHORT } from '@/lib/roles';
import { supabase } from '@/lib/supabase';

type Org = { id: string; name: string; visit_category: string | null; account_owner_id: string | null; phone: string | null; email: string | null; status: string; address: string | null };
type Proj = {
  id: string;
  code: string | null;
  name: string;
  project_type: string | null;
  organization_id: string | null;
  stage: string | null;
  status: string;
  owner_id: string | null;
  currency: 'LKR' | 'USD' | null;
  project_value: number | null;
  lighting_value: number | null;
  win_probability: number | null;
  expected_award_date: string | null;
  city: string | null;
};
type Mode = 'customers' | 'projects';
type StatusSet = 'open' | 'all';

const STATUS_LABEL: Record<string, string> = { active: 'Active', dormant: 'Dormant', on_hold: 'On hold', won: 'Won', completed: 'Completed', lost: 'Lost', cancelled: 'Cancelled' };
const OPEN = ['active', 'dormant', 'on_hold'];
const NO_TYPE = '—';

/** LKR and USD kept apart (no conversion): "LKR 1,200,000 + USD 30,000" */
function money(rows: Proj[], key: 'project_value' | 'lighting_value' | 'weighted') {
  const v = (p: Proj) => (key === 'weighted' ? Number(p.lighting_value ?? 0) * ((p.win_probability ?? 0) / 100) : Number(p[key] ?? 0));
  const lkr = rows.filter((p) => p.currency !== 'USD').reduce((t, p) => t + v(p), 0);
  const usd = rows.filter((p) => p.currency === 'USD').reduce((t, p) => t + v(p), 0);
  return [lkr ? fmtMoney(Math.round(lkr), 'LKR') : null, usd ? fmtMoney(Math.round(usd), 'USD') : null].filter(Boolean).join(' + ') || '—';
}

/** Reports › Customers & projects by type – choose customer types or project types; summary and detail list, PDF and Excel */
export default function ByTypeReport() {
  const me = useMe();
  const dialog = useDialog();
  const masters = useMasters();
  const [mode, setMode] = useState<Mode>('customers');
  const [custTypes, setCustTypes] = useState<string[]>([]);
  const [projTypes, setProjTypes] = useState<string[]>([]);
  const [statusSet, setStatusSet] = useState<StatusSet>('open');
  const { data, error, loading, reload } = useLoad(async () => {
    const [o, p, people] = await Promise.all([
      fetchAll('organizations', 'id, name, visit_category, account_owner_id, phone, email, status, address', 'name', (q) => q.is('merged_into', null)),
      fetchAll('projects', 'id, code, name, project_type, organization_id, stage, status, owner_id, currency, project_value, lighting_value, win_probability, expected_award_date, city', 'name', (q) => q.is('merged_into', null)),
      supabase.from('profiles').select('id, full_name'),
    ]);
    if (o.error) throw new Error(o.error.message);
    if (p.error) throw new Error(p.error.message);
    return { orgs: o.data as Org[], projects: p.data as Proj[], names: Object.fromEntries(((people.data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name])) as Record<string, string> };
  });

  const custOptions = useMemo(() => {
    const listed = masters.values('visit_category');
    const extra = Array.from(new Set((data?.orgs ?? []).map((o) => o.visit_category ?? NO_TYPE))).filter((c) => !listed.includes(c));
    return [...listed, ...extra].map((c) => ({ value: c, label: c === NO_TYPE ? 'Not set' : c }));
  }, [masters, data]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { orgs, projects, names } = data;
  const person = (id: string | null) => (id ? (names[id] ?? '—') : '—');
  const orgOf = new Map(orgs.map((o) => [o.id, o]));
  const inStatus = (p: Proj) => statusSet === 'all' || OPEN.includes(p.status);
  const projOfOrg = new Map<string, Proj[]>();
  for (const p of projects) if (p.organization_id) projOfOrg.set(p.organization_id, [...(projOfOrg.get(p.organization_id) ?? []), p]);
  const generatedBy = `${me.full_name} – ${ROLE_SHORT[me.role]}`;
  const statusText = statusSet === 'open' ? 'Open projects (active, dormant, on hold)' : 'All projects';

  // ---- Customers by customer type ----
  const custSel = custTypes.length ? custTypes : custOptions.map((o) => o.value);
  const custRows = orgs
    .filter((o) => custSel.includes(o.visit_category ?? NO_TYPE))
    .map((o) => {
      const ps = (projOfOrg.get(o.id) ?? []).filter(inStatus);
      return { ...o, type: o.visit_category ?? NO_TYPE, projects: ps, open: ps.filter((p) => OPEN.includes(p.status)).length, won: (projOfOrg.get(o.id) ?? []).filter((p) => p.status === 'won' || p.status === 'completed').length };
    });
  type CustRow = (typeof custRows)[number];
  const custSummary = custSel
    .map((t) => {
      const rows = custRows.filter((r) => r.type === t);
      const ps = rows.flatMap((r) => r.projects);
      return { type: t === NO_TYPE ? 'Not set' : t, customers: rows.length, active: rows.filter((r) => r.status === 'active').length, projects: ps.length, open: rows.reduce((n, r) => n + r.open, 0), won: rows.reduce((n, r) => n + r.won, 0), value: money(ps, 'lighting_value'), weighted: money(ps, 'weighted') };
    })
    .filter((s) => s.customers);
  type CustSum = (typeof custSummary)[number];
  const custSumCols: Column<CustSum>[] = [
    { header: 'Customer type', value: (s) => s.type, width: 26 },
    { header: 'Customers', value: (s) => s.customers, align: 'right' },
    { header: 'Active customers', value: (s) => s.active, align: 'right' },
    { header: 'Projects', value: (s) => s.projects, align: 'right' },
    { header: 'Open projects', value: (s) => s.open, align: 'right' },
    { header: 'Won projects', value: (s) => s.won, align: 'right' },
    { header: 'Lighting value', value: (s) => s.value, width: 30 },
    { header: 'Weighted (win %)', value: (s) => s.weighted, width: 30 },
  ];
  const custCols: Column<CustRow>[] = [
    { header: 'Customer', value: (r) => r.name, width: 34 },
    { header: 'Customer type', value: (r) => (r.type === NO_TYPE ? 'Not set' : r.type), width: 22 },
    { header: 'Account owner', value: (r) => person(r.account_owner_id), width: 22 },
    { header: 'Status', value: (r) => (r.status === 'active' ? 'Active' : 'Inactive') },
    { header: 'Phone', value: (r) => r.phone ?? '' },
    { header: 'E-mail', value: (r) => r.email ?? '', width: 26 },
    { header: 'Projects', value: (r) => r.projects.length, align: 'right' },
    { header: 'Open', value: (r) => r.open, align: 'right' },
    { header: 'Won', value: (r) => r.won, align: 'right' },
    { header: 'Lighting value', value: (r) => money(r.projects, 'lighting_value'), width: 28 },
  ];

  // ---- Projects by project type ----
  const projSel = projTypes.length ? projTypes : PROJECT_TYPES.map((t) => t.value);
  const projRows = projects.filter((p) => inStatus(p) && projSel.includes(p.project_type ?? '')).map((p) => ({ ...p, org: p.organization_id ? orgOf.get(p.organization_id) : undefined }));
  type ProjRow = (typeof projRows)[number];
  const projSummary = projSel
    .map((t) => {
      const rows = projRows.filter((p) => p.project_type === t);
      const by = (s: string) => rows.filter((p) => p.status === s).length;
      return { type: projectTypeLabel(t), line: PROJECT_TYPES.find((x) => x.value === t)?.line ?? '', projects: rows.length, active: by('active'), on_hold: by('on_hold') + by('dormant'), won: by('won') + by('completed'), lost: by('lost') + by('cancelled'), customers: new Set(rows.map((p) => p.organization_id).filter(Boolean)).size, value: money(rows, 'lighting_value'), weighted: money(rows, 'weighted') };
    })
    .filter((s) => s.projects);
  type ProjSum = (typeof projSummary)[number];
  const projSumCols: Column<ProjSum>[] = [
    { header: 'Project type', value: (s) => s.type, width: 20 },
    { header: 'Sales line', value: (s) => s.line },
    { header: 'Projects', value: (s) => s.projects, align: 'right' },
    { header: 'Active', value: (s) => s.active, align: 'right' },
    { header: 'On hold / dormant', value: (s) => s.on_hold, align: 'right' },
    ...(statusSet === 'all'
      ? [
          { header: 'Won', value: (s: ProjSum) => s.won, align: 'right' as const },
          { header: 'Lost / cancelled', value: (s: ProjSum) => s.lost, align: 'right' as const },
        ]
      : []),
    { header: 'Customers', value: (s) => s.customers, align: 'right' },
    { header: 'Lighting value', value: (s) => s.value, width: 30 },
    { header: 'Weighted (win %)', value: (s) => s.weighted, width: 30 },
  ];
  const projCols: Column<ProjRow>[] = [
    { header: 'Code', value: (p) => p.code ?? '' },
    { header: 'Project', value: (p) => p.name, width: 34 },
    { header: 'Project type', value: (p) => projectTypeLabel(p.project_type) },
    { header: 'Customer', value: (p) => p.org?.name ?? '', width: 28 },
    { header: 'Customer type', value: (p) => p.org?.visit_category ?? '', width: 20 },
    { header: 'City', value: (p) => p.city ?? '' },
    { header: 'Stage', value: (p) => p.stage ?? '' },
    { header: 'Status', value: (p) => STATUS_LABEL[p.status] ?? p.status },
    { header: 'Sales person', value: (p) => person(p.owner_id), width: 22 },
    { header: 'Lighting value', value: (p) => (p.lighting_value == null ? '' : fmtMoney(p.lighting_value, p.currency)), align: 'right', width: 22 },
    { header: 'Win %', value: (p) => (p.win_probability == null ? '' : `${p.win_probability}%`), align: 'right' },
    { header: 'Expected award', value: (p) => (p.expected_award_date ? fmtDate(p.expected_award_date) : '') },
  ];

  const isCust = mode === 'customers';
  const chosen = isCust ? (custTypes.length ? custTypes.map((t) => (t === NO_TYPE ? 'Not set' : t)).join(', ') : 'All customer types') : projTypes.length ? projTypes.map(projectTypeLabel).join(', ') : 'All project types';
  const filters = `${chosen} · ${statusText}`;
  const title = isCust ? 'Customers by customer type' : 'Projects by project type';

  const exportIt = (kind: 'pdf' | 'excel') =>
    dialog.run(async () => {
      const meta = { key: isCust ? 'customers_by_type' : 'projects_by_type', title, filters, generatedBy, landscape: true, currencyNote: 'LKR and USD shown separately – not converted' };
      if (isCust) {
        const sections = custSummary.map((s) => ({ heading: `${s.type} – ${s.customers} customer(s)`, rows: custRows.filter((r) => (r.type === NO_TYPE ? 'Not set' : r.type) === s.type) }));
        if (kind === 'excel') await exportExcelTables(meta, [{ columns: custSumCols, sections: [{ heading: 'Summary', rows: custSummary }] }, { columns: custCols, sections }]);
        else await exportPdf(meta, custCols, sections, tableHtml('Summary', custSumCols, custSummary));
      } else {
        const sections = projSummary.map((s) => ({ heading: `${s.type} – ${s.projects} project(s) · ${s.value}`, rows: projRows.filter((p) => projectTypeLabel(p.project_type) === s.type) }));
        if (kind === 'excel') await exportExcelTables(meta, [{ columns: projSumCols, sections: [{ heading: 'Summary', rows: projSummary }] }, { columns: projCols, sections }]);
        else await exportPdf(meta, projCols, sections, tableHtml('Summary', projSumCols, projSummary));
      }
    });

  return (
    <Screen maxWidth={1300} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Customers & projects by type' }} />
      <Muted>Choose one or more types – none chosen means all. The summary counts each type; the detail list below shows every customer or project. Only the records you can see are included.</Muted>
      <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
        <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: 'customers', label: 'Customer types' }, { value: 'projects', label: 'Project types' }]} />
        <View style={{ minWidth: 260, flexGrow: 1, maxWidth: 520 }}>
          {isCust ? (
            <MultiSelect label="Customer types" values={custTypes} options={custOptions} onChange={setCustTypes} hint="None chosen = all" />
          ) : (
            <MultiSelect label="Project types" values={projTypes} options={PROJECT_TYPES.map((t) => ({ value: t.value, label: `${t.label} · ${t.line}` }))} onChange={setProjTypes} hint="None chosen = all" />
          )}
        </View>
        <Segmented<StatusSet> value={statusSet} onChange={setStatusSet} options={[{ value: 'open', label: 'Open projects' }, { value: 'all', label: 'All projects' }]} />
        <Button small variant="secondary" title="PDF" onPress={() => exportIt('pdf')} />
        <Button small variant="secondary" title="Excel" onPress={() => exportIt('excel')} />
      </Row>

      {isCust ? (
        <>
          <Grid min={170} max={4}>
            <Stat label="Customers" value={custRows.length} />
            <Stat label="Active customers" value={custRows.filter((r) => r.status === 'active').length} />
            <Stat label={statusSet === 'open' ? 'Open projects' : 'Projects'} value={custRows.reduce((n, r) => n + r.projects.length, 0)} />
            <Stat label="Lighting value" value={money(custRows.flatMap((r) => r.projects), 'lighting_value')} />
          </Grid>
          <Section title="Summary by customer type">
            <DataTable
              rows={custSummary}
              keyOf={(s) => s.type}
              onPress={(s) => setCustTypes([s.type === 'Not set' ? NO_TYPE : s.type])}
              emptyTitle="No customers of these types"
              columns={[
                { h: 'Customer type', w: 200, bold: true, v: (s) => s.type },
                { h: 'Customers', w: 90, right: true, v: (s) => s.customers },
                { h: 'Active', w: 70, right: true, v: (s) => s.active },
                { h: statusSet === 'open' ? 'Open projects' : 'Projects', w: 100, right: true, v: (s) => s.projects },
                { h: 'Won', w: 60, right: true, tone: () => colors.green, v: (s) => s.won },
                { h: 'Lighting value', w: 200, right: true, v: (s) => s.value },
                { h: 'Weighted (win %)', w: 200, right: true, grow: true, v: (s) => s.weighted },
              ]}
            />
            <Muted style={{ fontSize: 12 }}>Tap a type to see only its customers. Won counts every won or completed project of the customer.</Muted>
          </Section>
          <Section title={`Customers (${custRows.length})`}>
            <DataTable
              rows={custRows}
              keyOf={(r) => r.id}
              onPress={(r) => router.push(`/customers/${r.id}`)}
              emptyTitle="No customers of these types"
              columns={[
                { h: 'Customer', w: 230, bold: true, grow: true, v: (r) => r.name },
                { h: 'Type', w: 160, v: (r) => (r.type === NO_TYPE ? 'Not set' : r.type) },
                { h: 'Account owner', w: 150, v: (r) => person(r.account_owner_id) },
                { h: 'Phone', w: 120, v: (r) => r.phone ?? '—' },
                { h: 'Projects', w: 80, right: true, v: (r) => r.projects.length },
                { h: 'Won', w: 60, right: true, v: (r) => r.won },
                { h: 'Lighting value', w: 190, right: true, v: (r) => money(r.projects, 'lighting_value') },
              ]}
            />
          </Section>
        </>
      ) : (
        <>
          <Grid min={170} max={4}>
            <Stat label="Projects" value={projRows.length} />
            <Stat label="Customers" value={new Set(projRows.map((p) => p.organization_id).filter(Boolean)).size} />
            <Stat label="Lighting value" value={money(projRows, 'lighting_value')} />
            <Stat label="Weighted (win %)" value={money(projRows, 'weighted')} />
          </Grid>
          <Section title="Summary by project type">
            <DataTable
              rows={projSummary}
              keyOf={(s) => s.type}
              onPress={(s) => setProjTypes(PROJECT_TYPES.filter((t) => t.label === s.type).map((t) => t.value))}
              emptyTitle="No projects of these types"
              columns={[
                { h: 'Project type', w: 150, bold: true, v: (s) => s.type },
                { h: 'Line', w: 110, v: (s) => s.line },
                { h: 'Projects', w: 80, right: true, v: (s) => s.projects },
                { h: 'Active', w: 70, right: true, v: (s) => s.active },
                { h: 'On hold', w: 80, right: true, v: (s) => s.on_hold },
                ...(statusSet === 'all'
                  ? [
                      { h: 'Won', w: 60, right: true, tone: () => colors.green, v: (s: ProjSum) => s.won },
                      { h: 'Lost', w: 60, right: true, v: (s: ProjSum) => s.lost },
                    ]
                  : []),
                { h: 'Customers', w: 90, right: true, v: (s) => s.customers },
                { h: 'Lighting value', w: 190, right: true, v: (s) => s.value },
                { h: 'Weighted (win %)', w: 190, right: true, grow: true, v: (s) => s.weighted },
              ]}
            />
            <Muted style={{ fontSize: 12 }}>Tap a type to see only its projects. Weighted value = lighting value × win probability.</Muted>
          </Section>
          <Section title={`Projects (${projRows.length})`}>
            <DataTable
              rows={projRows}
              keyOf={(p) => p.id}
              onPress={(p) => router.push(`/projects/${p.id}`)}
              emptyTitle="No projects of these types"
              columns={[
                { h: 'Project', w: 230, bold: true, grow: true, v: (p) => [p.code, p.name].filter(Boolean).join(' · ') },
                { h: 'Type', w: 110, v: (p) => projectTypeLabel(p.project_type) },
                { h: 'Customer', w: 180, v: (p) => p.org?.name ?? '—' },
                { h: 'Stage', w: 90, v: (p) => p.stage ?? '—' },
                { h: 'Status', w: 80, v: (p) => STATUS_LABEL[p.status] ?? p.status },
                { h: 'Sales person', w: 140, v: (p) => person(p.owner_id) },
                { h: 'Lighting value', w: 150, right: true, v: (p) => (p.lighting_value == null ? '—' : fmtMoney(p.lighting_value, p.currency)) },
                { h: 'Win %', w: 60, right: true, v: (p) => (p.win_probability == null ? '—' : `${p.win_probability}%`) },
              ]}
            />
          </Section>
        </>
      )}
    </Screen>
  );
}
