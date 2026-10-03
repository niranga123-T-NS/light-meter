import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { pctTone, SCHEDULE_LABEL, SCHEDULE_TONE } from '@/components/financeTones';
import { Card, colors, Empty, ErrorBanner, Grid, KeyValue, Loading, Muted, Notice, Pill, Progress, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtMonth, fmtMonthShort, fmtPct, fyLabel, fyMonths, fyOf, kindLabel, mn, thisMonth, ytd, type InvoiceLine, type Performance, type SecuredProject } from '@/lib/finance';
import { todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** A sales person's target: secured and invoiced against target, the year's cover, invoices due this month. */
export default function MyTarget() {
  const me = useMe();
  const params = useLocalSearchParams<{ person?: string; fy?: string }>();
  const fy = params.fy ? Number(params.fy) : fyOf(todayISO());
  const pid = params.person ?? me.id;
  const { data, error } = useLoad(async () => {
    const [perf, l, s] = await Promise.all([
      rpc<Performance>('finance_performance', { p_fy: fy }),
      supabase.from('invoice_line_status').select('*').eq('sales_person_id', pid).eq('project_status', 'open'),
      supabase.from('secured_projects').select('*').eq('sales_person_id', pid).eq('status', 'open').neq('schedule_status', 'approved'),
    ]);
    return { perf, lines: (l.data ?? []) as InvoiceLine[], waiting: (s.data ?? []) as SecuredProject[] };
  }, [fy, pid]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const p = data.perf.people.find((x) => x.id === pid);
  const upTo = data.perf.latest_month;
  const now = thisMonth();
  const due = data.lines.filter((l) => l.forecast_month <= now && Number(l.remaining) > 0.5).sort((a, b) => a.forecast_month.localeCompare(b.forecast_month));
  const next = data.lines.filter((l) => l.forecast_month > now && Number(l.remaining) > 0.5).sort((a, b) => a.forecast_month.localeCompare(b.forecast_month)).slice(0, 8);

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: pid === me.id ? 'My target' : `Target · ${p?.name ?? ''}` }} />
      {!p ? (
        <Empty title={`No target for ${fyLabel(fy)} yet`} hint="SM Projects sets the targets from the budget list; GM / DGM approves them." />
      ) : (
        (() => {
          const y = ytd(p, upTo);
          return (
            <>
              {data.perf.targets_status !== 'approved' ? <Notice tone={colors.amber}>Targets for this year are not approved yet – figures may change.</Notice> : null}
              <Card>
                <Row wrap gap={16} style={{ alignItems: 'center' }}>
                  <View style={{ alignItems: 'center', minWidth: 110 }}>
                    <Text style={{ fontSize: 36, fontWeight: '800', color: pctTone(y.score) }}>{y.score.toFixed(1)}</Text>
                    <Muted>Score · Apr – {upTo ? fmtMonthShort(upTo) : '—'}</Muted>
                  </View>
                  <View style={{ flex: 1, minWidth: 220, gap: 10 }}>
                    <View>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={{ color: colors.text }}>Secured (this-year value)</Text>
                        <Text style={{ fontWeight: '700', color: colors.ink }}>
                          {mn(y.secured)} / {mn(y.securedTarget)} · {fmtPct(y.securedPct)}
                        </Text>
                      </Row>
                      <Progress pct={y.securedPct} colour={pctTone(y.securedPct)} />
                    </View>
                    <View>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text style={{ color: colors.text }}>Invoiced</Text>
                        <Text style={{ fontWeight: '700', color: colors.ink }}>
                          {mn(y.invoiced)} / {mn(y.invoiceTarget)} · {fmtPct(y.invoicedPct)}
                        </Text>
                      </Row>
                      <Progress pct={y.invoicedPct} colour={pctTone(y.invoicedPct)} />
                    </View>
                    <Muted>LKR Mn · score = 40% secured + 60% invoiced, each against the target to date.</Muted>
                  </View>
                </Row>
              </Card>
              <Grid min={200}>
                <KeyValue label={`Invoicing target ${fyLabel(fy)}`} value={`${mn(y.fyInvoiceTarget)} Mn`} />
                <KeyValue label="Invoiced so far" value={`${mn(y.fyInvoiced)} Mn`} />
                <KeyValue label="Secured, still to bill this year" value={`${mn(y.toBill)} Mn`} />
                <KeyValue label="Cover" value={fmtPct(y.cover)} />
                <KeyValue label="Still to win and bill" value={<Text style={{ color: y.gap ? colors.red : colors.green, fontWeight: '700' }}>{mn(y.gap)} Mn</Text>} />
                <KeyValue label={`Secured target ${fyLabel(fy)}`} value={`${mn(y.fySecuredTarget)} Mn`} />
              </Grid>

              <Section title="Invoices due now (this month and slipped)">
                <DataTable
                  rows={due}
                  keyOf={(l) => l.id}
                  onPress={(l) => router.push(`/finance/secured/${l.secured_id}`)}
                  emptyTitle="Nothing due"
                  edge={(l) => (l.forecast_month < now ? colors.red : colors.blue)}
                  columns={[
                    { h: 'Project', w: 220, v: (l) => l.project_name, bold: true },
                    { h: 'Invoice', w: 160, v: (l) => l.description || kindLabel(l.kind) },
                    { h: 'Month', w: 90, v: (l) => fmtMonth(l.forecast_month) },
                    { h: 'To bill (Mn)', w: 100, right: true, v: (l) => mn(l.remaining, 2) },
                    {
                      h: 'Status',
                      w: 200,
                      v: (l) =>
                        l.pending_change_id ? (
                          <Pill label="Date change waiting" tone={colors.amber} />
                        ) : l.forecast_month < now ? (
                          <Pill label="Slipped – move it with a reason" tone={colors.red} />
                        ) : (
                          <Pill label="Due this month" tone={colors.blue} />
                        ),
                    },
                  ]}
                />
              </Section>

              {data.waiting.length ? (
                <Section title="Won – invoice schedule needed">
                  <DataTable
                    rows={data.waiting}
                    keyOf={(s) => s.id}
                    onPress={(s) => router.push(`/finance/secured/${s.id}`)}
                    columns={[
                      { h: 'Project', w: 240, v: (s) => s.project_name, bold: true },
                      { h: 'Order value (Mn)', w: 130, right: true, v: (s) => mn(s.order_value, 2) },
                      { h: 'Status', w: 180, v: (s) => <Pill label={SCHEDULE_LABEL[s.schedule_status]} tone={SCHEDULE_TONE[s.schedule_status]} /> },
                    ]}
                  />
                  <Muted>A win counts toward your secured target once SM Projects approves its invoice schedule.</Muted>
                </Section>
              ) : null}

              <Section title="Month by month (LKR Mn)">
                <DataTable
                  rows={fyMonths(fy).map((m) => p.months.find((x) => x.month === m) ?? { month: m, secured_target: 0, secured: 0, invoice_target: 0, invoiced: 0 })}
                  keyOf={(m) => m.month}
                  rowStyle={(m) => (upTo && m.month > upTo ? { opacity: 0.55 } : undefined)}
                  columns={[
                    { h: 'Month', w: 100, v: (m) => fmtMonth(m.month) },
                    { h: 'Secured target', w: 120, right: true, v: (m) => mn(m.secured_target) },
                    { h: 'Secured', w: 90, right: true, v: (m) => mn(m.secured) },
                    { h: 'Invoicing target', w: 120, right: true, v: (m) => mn(m.invoice_target) },
                    { h: 'Invoiced', w: 90, right: true, v: (m) => mn(m.invoiced), tone: (m) => (Number(m.invoiced) < Number(m.invoice_target) && (!upTo || m.month <= upTo) ? colors.red : undefined) },
                  ]}
                />
              </Section>

              {next.length ? (
                <Section title="Coming invoices">
                  <DataTable
                    rows={next}
                    keyOf={(l) => l.id}
                    onPress={(l) => router.push(`/finance/secured/${l.secured_id}`)}
                    columns={[
                      { h: 'Month', w: 100, v: (l) => fmtMonth(l.forecast_month) },
                      { h: 'Project', w: 230, v: (l) => l.project_name, bold: true },
                      { h: 'Invoice', w: 170, v: (l) => l.description || kindLabel(l.kind) },
                      { h: 'Amount (Mn)', w: 110, right: true, v: (l) => mn(l.remaining, 2) },
                    ]}
                  />
                </Section>
              ) : null}
            </>
          );
        })()
      )}
    </Screen>
  );
}
