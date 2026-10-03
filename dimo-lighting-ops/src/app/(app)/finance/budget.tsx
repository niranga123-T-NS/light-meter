import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { ListUpload } from '@/components/ListUpload';
import { colors, ErrorBanner, Loading, Muted, Notice, Pill, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import {
  BUDGET_TEMPLATE,
  downloadXlsx,
  fmtMonth,
  fmtMonthShort,
  fmtPct,
  fyLabel,
  fyOf,
  inFy,
  isFinanceDesk,
  lineColour,
  lineShort,
  LINES,
  mn,
  readBudgetFile,
  seesFinance,
  type BudgetInvoice,
  type BudgetProject,
  type SecuredProject,
} from '@/lib/finance';
import { todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Budgeted project list for the financial year – Operations uploads it; sales see their own rows. */
export default function BudgetScreen() {
  const me = useMe();
  const people = usePeople();
  const [fy, setFy] = useState(fyOf(todayISO()));
  const [line, setLine] = useState<string>('all');
  const desk = isFinanceDesk(me.role);
  const { data, error, reload } = useLoad(async () => {
    const [b, s] = await Promise.all([
      supabase.from('budget_projects').select('*, budget_invoices(*)').eq('fy', fy).order('row_no'),
      supabase.from('secured_projects').select('*'),
    ]);
    if (b.error) throw new Error(b.error.message);
    return {
      rows: (b.data ?? []) as (BudgetProject & { budget_invoices: BudgetInvoice[] })[],
      secured: (s.data ?? []) as SecuredProject[],
    };
  }, [fy]);

  const securedOf = (b: BudgetProject) =>
    data?.secured.find((s) => s.budget_id === b.id || (b.project_id && s.project_id === b.project_id) || (b.wbs && s.wbs === b.wbs));
  const rows = (data?.rows ?? []).filter((r) => line === 'all' || r.business_line === line);
  const fyInv = (r: { budget_invoices: BudgetInvoice[] }) => r.budget_invoices.filter((i) => inFy(i.month, fy)).reduce((a, i) => a + Number(i.amount), 0);
  const total = (k: (r: (typeof rows)[number]) => number, list = rows) => list.reduce((a, r) => a + k(r), 0);
  const years = [fyOf(todayISO()) - 1, fyOf(todayISO()), fyOf(todayISO()) + 1];

  return (
    <Screen maxWidth={1200}>
      <Stack.Screen options={{ title: 'Budget list' }} />
      <ErrorBanner message={error} />
      <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
        <View style={{ width: 200 }}>
          <Select label="Financial year" value={String(fy)} onChange={(v) => setFy(Number(v))} options={years.map((y) => ({ value: String(y), label: fyLabel(y) }))} />
        </View>
      </Row>

      {desk ? (
        <Section title="Upload the budgeted project list">
          <ListUpload
            intro={`Upload the whole list for ${fyLabel(fy)} – it replaces the previous list for the year. Business line: Infrastructure, Building Lighting – LMS or Building Lighting – Indoor. Sales person: the name as in the system. Invoice months: e.g. Oct 2026; add up to six invoice month / amount pairs.`}
            read={readBudgetFile}
            check={(r) => rpc('check_budget_list', { p_fy: fy, p_rows: r })}
            save={(r) => rpc('save_budget_list', { p_fy: fy, p_rows: r })}
            describe={(r) => `${r.project_name || '—'} · ${r.sales_person || '—'}`}
            onTemplate={() => downloadXlsx(`Budget_projects_${fy}.xlsx`, BUDGET_TEMPLATE)}
            onSaved={reload}
            saveLabel={`Save budget list for ${fyLabel(fy)}`}
          />
        </Section>
      ) : null}

      {!data ? (
        <Loading />
      ) : (
        <>
          <Section title={`By business line · ${fyLabel(fy)} (LKR Mn)`}>
            <DataTable
              rows={LINES.map((l) => ({ l, list: (data.rows ?? []).filter((r) => r.business_line === l.value) }))}
              keyOf={(x) => x.l.value}
              footer={[
                'Total',
                String(data.rows.length),
                mn(total((r) => Number(r.budget_value), data.rows)),
                mn(total(fyInv, data.rows)),
                mn(total((r) => (securedOf(r) ? Number(r.budget_value) : 0), data.rows)),
                fmtPct(
                  (total((r) => (securedOf(r) ? Number(r.budget_value) : 0), data.rows) / (total((r) => Number(r.budget_value), data.rows) || 1)) * 100,
                ),
              ]}
              columns={[
                { h: 'Business line', w: 220, v: (x) => x.l.label, bold: true },
                { h: 'Projects', w: 80, right: true, v: (x) => String(x.list.length) },
                { h: 'Budget value', w: 120, right: true, v: (x) => mn(total((r) => Number(r.budget_value), x.list)) },
                { h: 'To invoice this FY', w: 140, right: true, v: (x) => mn(total(fyInv, x.list)) },
                { h: 'Secured so far', w: 120, right: true, v: (x) => mn(total((r) => (securedOf(r) ? Number(r.budget_value) : 0), x.list)) },
                {
                  h: '% secured',
                  w: 100,
                  right: true,
                  v: (x) => fmtPct((total((r) => (securedOf(r) ? Number(r.budget_value) : 0), x.list) / (total((r) => Number(r.budget_value), x.list) || 1)) * 100),
                },
              ]}
            />
          </Section>

          <Section title="Projects">
            <Segmented
              value={line}
              onChange={setLine}
              options={[{ value: 'all', label: 'All', badge: data.rows.length }, ...LINES.map((l) => ({ value: l.value, label: l.short, badge: data.rows.filter((r) => r.business_line === l.value).length }))]}
            />
            <DataTable
              rows={rows}
              keyOf={(r) => r.id}
              edge={(r) => lineColour(r.business_line)}
              onPress={(r) => {
                const s = securedOf(r);
                if (s) router.push(`/finance/secured/${s.id}`);
                else if (r.project_id) router.push(`/projects/${r.project_id}`);
              }}
              emptyTitle={seesFinance(me.role) ? 'No budget list for this year yet' : 'No budgeted projects for you this year'}
              columns={[
                { h: 'Line', w: 70, v: (r) => lineShort(r.business_line) },
                { h: 'Project', w: 240, v: (r) => r.project_name, bold: true },
                { h: 'Customer', w: 170, v: (r) => r.customer ?? '—' },
                { h: 'Sales person', w: 150, v: (r) => people[r.sales_person_id ?? '']?.full_name ?? '—' },
                { h: 'WBS', w: 95, v: (r) => r.wbs ?? '—' },
                { h: 'Budget value', w: 120, right: true, v: (r) => mn(r.budget_value, 2) },
                { h: 'GP %', w: 70, right: true, v: (r) => (r.budget_gp_pct == null ? '—' : fmtPct(Number(r.budget_gp_pct), 1)) },
                { h: 'Order month', w: 100, v: (r) => fmtMonth(r.order_month) },
                {
                  h: 'Invoice months',
                  w: 220,
                  v: (r) =>
                    r.budget_invoices
                      .sort((a, b) => a.month.localeCompare(b.month))
                      .map((i) => `${fmtMonthShort(i.month)} ${mn(i.amount)}`)
                      .join(', ') || '—',
                },
                {
                  h: 'Status',
                  w: 120,
                  v: (r) => {
                    const s = securedOf(r);
                    return s ? <Pill label={s.source === 'opening' ? 'Secured earlier' : 'Secured'} tone={colors.green} /> : <Pill label="To win" tone={colors.amber} />;
                  },
                },
              ]}
            />
            <Muted>Amounts in LKR Mn. A project turns “Secured” when it is won in the system (or is in the opening secured list).</Muted>
          </Section>
        </>
      )}
      {!desk && !seesFinance(me.role) ? <Notice>You see the budgeted projects where you are the sales person.</Notice> : null}
    </Screen>
  );
}

