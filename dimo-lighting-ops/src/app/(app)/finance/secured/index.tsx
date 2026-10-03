import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { SCHEDULE_LABEL, SCHEDULE_TONE } from '@/components/financeTones';
import { ListUpload } from '@/components/ListUpload';
import { Button, colors, ErrorBanner, Grid, Loading, Muted, Pill, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import {
  downloadXlsx,
  fmtMonth,
  fyEnd,
  fyLabel,
  fyOf,
  inFy,
  isFinanceDesk,
  lineColour,
  lineShort,
  LINES,
  mn,
  OPENING_TEMPLATE,
  readOpeningFile,
  seesFinance,
  type Allocation,
  type InvoiceLine,
  type SecuredProject,
} from '@/lib/finance';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Unlinked = { wbs: string; invoiced: number; months: number; last_month: string };
type Tab = 'book' | 'missing' | 'review' | 'unbudgeted' | 'done' | 'closed';

/** Secured projects (order book): won in the system or loaded from the opening list, with what is still to invoice. */
export default function SecuredList() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const fy = fyOf(todayISO());
  const [tab, setTab] = useState<Tab>('book');
  const [line, setLine] = useState('');
  const [person, setPerson] = useState('');
  const { data, error, reload } = useLoad(async () => {
    const [s, l, a] = await Promise.all([
      supabase.from('secured_projects').select('*').order('won_on', { ascending: false }),
      supabase.from('invoice_line_status').select('*'),
      supabase.from('invoice_allocations').select('*'),
    ]);
    if (s.error) throw new Error(s.error.message);
    // Project codes invoiced this year that are on no secured project (Operations links them)
    const unlinked = seesFinance(me.role) ? await rpc<Unlinked[]>('unlinked_wbs', { p_fy: fy }).catch(() => [] as Unlinked[]) : [];
    return { secured: (s.data ?? []) as SecuredProject[], lines: (l.data ?? []) as InvoiceLine[], allocs: (a.data ?? []) as Allocation[], unlinked };
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  const end = fyEnd(fy);
  const calc = (s: SecuredProject) => {
    const ls = data.lines.filter((l) => l.secured_id === s.id);
    const dueFy = ls.filter((l) => inFy(l.forecast_month, fy) || (l.forecast_month < `${fy}-04-01` && Number(l.remaining) > 0)).reduce((a, l) => a + Number(l.amount), 0);
    const invoicedFy = data.allocs.filter((a) => a.secured_id === s.id && inFy(a.month, fy)).reduce((a, x) => a + Number(x.amount), 0);
    const invoicedAll = data.allocs.filter((a) => a.secured_id === s.id).reduce((a, x) => a + Number(x.amount), 0);
    const balFy = ls.filter((l) => l.forecast_month <= end).reduce((a, l) => a + Math.max(0, Number(l.remaining)), 0);
    const later = ls.filter((l) => l.forecast_month > end).reduce((a, l) => a + Math.max(0, Number(l.remaining)), 0);
    return { dueFy, invoicedFy, balFy, later, done: ls.length > 0 && balFy + later <= 0.5, invoicedAll };
  };
  const scoped = data.secured.filter((s) => (!line || s.business_line === line) && (!person || s.sales_person_id === person));
  const open = scoped.filter((s) => s.status === 'open');
  const filters: Record<Tab, (s: SecuredProject) => boolean> = {
    book: (s) => s.status === 'open' && !calc(s).done,
    missing: (s) => s.status === 'open' && s.schedule_status === 'missing',
    review: (s) => s.status === 'open' && s.schedule_status === 'review',
    unbudgeted: (s) => s.source === 'won' && !s.budget_id && s.status !== 'cancelled' && fyOf(s.won_on) === fy,
    done: (s) => s.status === 'open' && calc(s).done,
    closed: (s) => s.status !== 'open',
  };
  const rows = scoped.filter(filters[tab]);
  const opening = open.filter((s) => s.source === 'opening').reduce((a, s) => a + calc(s).dueFy, 0);
  const wonFy = scoped.filter((s) => s.source === 'won' && fyOf(s.won_on) === fy && s.status !== 'cancelled');
  const securedFy = wonFy.reduce((a, s) => a + data.lines.filter((l) => l.secured_id === s.id && inFy(l.original_month, fy)).reduce((x, l) => x + Number(l.amount), 0), 0);
  const invoicedFy = scoped.reduce((a, s) => a + calc(s).invoicedFy, 0);
  const toBill = open.reduce((a, s) => a + calc(s).balFy, 0);
  const link = async (u: Unlinked) => {
    const choices = data.secured
      .filter((x) => x.status === 'open')
      .sort((a, b) => Number(!!a.wbs) - Number(!!b.wbs) || a.project_name.localeCompare(b.project_name));
    const r = await dialog.prompt({
      title: `Link ${u.wbs}`,
      message: `${mn(u.invoiced, 2)} Mn invoiced this year. Choose the secured project – its WBS is set to ${u.wbs} and the invoicing is matched to its invoices.`,
      fields: [
        {
          key: 'p',
          label: 'Secured project',
          type: 'select',
          required: true,
          options: choices.map((x) => ({ value: x.id, label: x.project_name, hint: `${people[x.sales_person_id ?? '']?.full_name ?? '—'}${x.wbs ? ` · now ${x.wbs}` : ' · no WBS yet'}` })),
        },
      ],
      confirmLabel: 'Link',
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('set_secured_details', { p_secured: r.p, p_data: { wbs: u.wbs } });
      await reload();
    }, `${u.wbs} linked`);
  };
  const salesPeople = [...new Set(data.secured.map((s) => s.sales_person_id).filter(Boolean))] as string[];

  return (
    <Screen maxWidth={1250}>
      <Stack.Screen options={{ title: 'Secured projects' }} />
      <Grid min={210}>
        <Stat label={`Opening order book – due ${fyLabel(fy)}`} value={`${mn(opening)} Mn`} />
        <Stat label={`Secured this year (this-year value, ${wonFy.length} wins)`} value={`${mn(securedFy)} Mn`} />
        <Stat label="Invoiced this year (OR uploads)" value={`${mn(invoicedFy)} Mn`} />
        <Stat label="Still to bill this year" value={`${mn(toBill)} Mn`} tone={toBill ? 'amber' : undefined} />
      </Grid>

      {seesFinance(me.role) ? (
        <Row wrap gap={8}>
          <View style={{ width: 240, maxWidth: '100%' }}>
            <Select label="Business line" value={line} onChange={setLine} options={[{ value: '', label: 'All lines' }, ...LINES.map((l) => ({ value: l.value, label: l.label }))]} />
          </View>
          <View style={{ width: 240, maxWidth: '100%' }}>
            <Select
              label="Sales person"
              value={person}
              onChange={setPerson}
              options={[{ value: '', label: 'All' }, ...salesPeople.map((p) => ({ value: p, label: people[p]?.full_name ?? '—' }))]}
            />
          </View>
        </Row>
      ) : null}

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'book', label: 'Order book', badge: scoped.filter(filters.book).length },
          { value: 'missing', label: 'Schedule missing', badge: scoped.filter(filters.missing).length },
          { value: 'review', label: 'To review', badge: scoped.filter(filters.review).length },
          { value: 'unbudgeted', label: 'Unbudgeted wins', badge: scoped.filter(filters.unbudgeted).length },
          { value: 'done', label: 'Fully invoiced' },
          { value: 'closed', label: 'Closed' },
        ]}
      />
      <DataTable
        rows={rows}
        keyOf={(s) => s.id}
        edge={(s) => lineColour(s.business_line)}
        onPress={(s) => router.push(`/finance/secured/${s.id}`)}
        emptyTitle="No projects here"
        columns={[
          { h: 'Project', w: 240, v: (s) => s.project_name, bold: true },
          { h: 'Line', w: 70, v: (s) => lineShort(s.business_line) },
          { h: 'Sales person', w: 150, v: (s) => people[s.sales_person_id ?? '']?.full_name ?? '—' },
          { h: 'Won', w: 100, v: (s) => fmtDate(s.won_on) },
          { h: 'WBS', w: 95, v: (s) => s.wbs ?? '—' },
          { h: 'Order value', w: 105, right: true, v: (s) => mn(s.order_value, 2) },
          { h: 'Billed before FY', w: 115, right: true, v: (s) => (Number(s.billed_before) ? mn(s.billed_before, 2) : '—') },
          { h: 'Due this FY', w: 100, right: true, v: (s) => mn(calc(s).dueFy, 2) },
          { h: 'Invoiced FY', w: 100, right: true, v: (s) => mn(calc(s).invoicedFy, 2) },
          { h: 'Balance FY', w: 100, right: true, v: (s) => mn(calc(s).balFy, 2), tone: (s) => (calc(s).balFy ? colors.ink : colors.muted) },
          { h: 'Later FYs', w: 90, right: true, v: (s) => (calc(s).later ? mn(calc(s).later, 2) : '—') },
          {
            h: 'Status',
            w: 190,
            v: (s) => (
              <Row gap={4} wrap>
                <Pill label={SCHEDULE_LABEL[s.schedule_status]} tone={SCHEDULE_TONE[s.schedule_status]} />
                {s.source === 'opening' ? <Pill label="Opening list" /> : null}
                {s.source === 'won' && !s.budget_id ? <Pill label="Unbudgeted" tone={colors.blue} /> : null}
              </Row>
            ),
          },
        ]}
      />
      <Muted>
        LKR Mn. Due this FY = invoices planned in {fyLabel(fy)} (and older ones still open). Balance FY = still to bill by 31 March. Each sales person’s cover of the
        invoicing target is in Targets.
      </Muted>

      {seesFinance(me.role) && data.unlinked.length ? (
        <Section title={`Project codes not linked (${data.unlinked.length})`}>
          <DataTable
            rows={data.unlinked}
            keyOf={(u) => u.wbs}
            edge={() => colors.amber}
            footer={['Total', mn(data.unlinked.reduce((a, u) => a + Number(u.invoiced), 0), 2), '', '', '']}
            columns={[
              { h: 'WBS', w: 110, v: (u) => u.wbs, bold: true },
              { h: `Invoiced ${fyLabel(fy)} (Mn)`, w: 150, right: true, v: (u) => mn(u.invoiced, 2) },
              { h: 'Months', w: 70, right: true, v: (u) => String(u.months) },
              { h: 'Last invoiced', w: 110, v: (u) => fmtMonth(u.last_month) },
              { h: '', w: 150, v: (u) => (isFinanceDesk(me.role) ? <Button small title="Link to a project" onPress={() => link(u)} /> : null) },
            ]}
          />
          <Muted>
            These codes were invoiced in the OR files but are on no secured project, so their invoicing counts toward nobody’s target. Link each to its secured project (or load
            it in the opening list with its WBS).
          </Muted>
        </Section>
      ) : null}

      {isFinanceDesk(me.role) ? (
        <Section title="Opening secured list (orders won before the system)">
          <ListUpload
            intro="One row per project won before the system with invoicing still to do. Order value = invoiced before 1 April + the invoices still to do (up to six month / amount pairs). Rows are matched by WBS or project name: loading the file again updates them. Projects won through the system are not changed."
            read={readOpeningFile}
            check={(r) => rpc('check_opening_list', { p_rows: r })}
            save={(r) => rpc('save_opening_list', { p_rows: r })}
            describe={(r) => `${r.project_name || '—'} · ${r.sales_person || '—'}`}
            onTemplate={() => downloadXlsx('Opening_secured_list.xlsx', OPENING_TEMPLATE)}
            onSaved={reload}
            saveLabel="Save opening list"
          />
        </Section>
      ) : null}
    </Screen>
  );
}
