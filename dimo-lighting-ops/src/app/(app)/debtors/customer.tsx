import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { AgeingChip } from '@/components/Ageing';
import { Card, colors, Empty, ErrorBanner, Grid, ListRow, Loading, Muted, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { AGEING_COLOURS, AGEING_ORDER, fmtDate, fmtDateTime, fmtMoney, human } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

type Money = { lkr: number; usd: number };
type Profile = {
  client: string | null;
  first_seen: string | null;
  sales_people: string[];
  open: Money & {
    n: number;
    legal_n: number;
    legal_lkr: number;
    legal_usd: number;
    oldest_days: number | null;
    by_bucket: (Money & { bucket: string; n: number })[];
    invoices: { id: string; invoice_no: string; project_name: string | null; amount: number; currency: 'LKR' | 'USD'; days: number; bucket: string; status: string; is_legal: boolean; invoice_date: string | null }[];
  };
  history: Money & {
    n: number;
    avg_days: number | null;
    median_days: number | null;
    max_days: number | null;
    min_days: number | null;
    within_30: number;
    within_60: number;
    within_90: number;
    within_180: number;
    over_180: number;
    legal_n: number;
    disputed_n: number;
    invoices: { id: string; invoice_no: string; project_name: string | null; amount: number; currency: 'LKR' | 'USD'; invoice_date: string | null; closed_on: string | null; days_to_clear: number | null; status: string; was_legal: boolean; was_disputed: boolean }[];
  };
  trend: (Money & { as_at: string; n: number; oldest_days: number | null })[];
};

const both = (lkr: number, usd: number) => [lkr ? fmtMoney(lkr, 'LKR') : null, usd ? fmtMoney(usd, 'USD') : null].filter(Boolean).join(' + ') || fmtMoney(0, 'LKR');

function Bar({ label, value, max, display, tone }: { label: React.ReactNode; value: number; max: number; display: string; tone: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        {typeof label === 'string' ? <Text>{label}</Text> : label}
        <Text style={{ fontWeight: '600' }}>{display}</Text>
      </Row>
      <View style={{ height: 8, backgroundColor: colors.line, borderRadius: 4, overflow: 'hidden', marginTop: 3 }}>
        <View style={{ height: 8, width: `${max && value ? Math.max(2, (value / max) * 100) : 0}%`, backgroundColor: tone, borderRadius: 4 }} />
      </View>
    </View>
  );
}

/** Customer debtor profile: current outstanding by ageing bracket and the payment history (days taken to clear). */
export default function CustomerDebtProfile() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const { data, error } = useLoad(() => rpc<Profile>('customer_debt_profile', { p_client: name ?? '' }), [name]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const o = data.open;
  const h = data.history;
  const bucketMax = Math.max(1, ...o.by_bucket.map((b) => Number(b.lkr) + Number(b.usd) * 300));
  const dist = [
    { label: 'Within 30 days', n: h.within_30, tone: AGEING_COLOURS['1-30'].bg },
    { label: '31–60 days', n: h.within_60, tone: AGEING_COLOURS['31-60'].bg },
    { label: '61–90 days', n: h.within_90, tone: AGEING_COLOURS['61-90'].bg },
    { label: '91–180 days', n: h.within_180, tone: AGEING_COLOURS['121-150'].bg },
    { label: 'Over 180 days', n: h.over_180, tone: AGEING_COLOURS['over-180'].bg },
  ];
  const trendMax = Math.max(1, ...data.trend.map((t) => Number(t.lkr) + Number(t.usd) * 300));

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Customer debtor profile' }} />
      <Card>
        <Text style={{ fontSize: 20, fontWeight: '700' }}>{data.client ?? name}</Text>
        <Muted>
          {data.sales_people.length ? `Sales: ${data.sales_people.join(', ')} · ` : ''}In the debtors list since {fmtDate(data.first_seen)}
        </Muted>
      </Card>

      <Section title="Outstanding now">
        <Grid min={200}>
          <Stat label={`Total outstanding (${o.n} invoices)`} value={both(o.lkr, o.usd)} />
          <Stat label={`Legal (${o.legal_n})`} value={both(o.legal_lkr, o.legal_usd)} tone={o.legal_n ? 'red' : undefined} />
          <Stat label="Oldest invoice" value={o.oldest_days != null ? `${o.oldest_days} days` : '—'} tone={(o.oldest_days ?? 0) > 90 ? 'red' : undefined} />
        </Grid>
        <Card style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6 }}>By age bracket</Text>
          {AGEING_ORDER.map((b) => {
            const row = o.by_bucket.find((x) => x.bucket === b);
            return (
              <Bar
                key={b}
                label={
                  <Row gap={6}>
                    <AgeingChip bucket={b} />
                    <Muted>{row?.n ?? 0} invoices</Muted>
                  </Row>
                }
                value={Number(row?.lkr ?? 0) + Number(row?.usd ?? 0) * 300}
                max={bucketMax}
                display={row ? both(Number(row.lkr), Number(row.usd)) : '—'}
                tone={AGEING_COLOURS[b].bg}
              />
            );
          })}
        </Card>
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
          {o.invoices.map((d) => (
            <ListRow
              key={d.id}
              left={<AgeingChip bucket={d.bucket} legal={d.is_legal} />}
              title={`${d.invoice_no}${d.project_name ? ` · ${d.project_name}` : ''}`}
              subtitle={`${d.days} days · ${human(d.status)}${d.invoice_date ? ` · invoiced ${fmtDate(d.invoice_date)}` : ''}`}
              right={<Text style={{ fontWeight: '700' }}>{fmtMoney(d.amount, d.currency)}</Text>}
              onPress={() => router.push(`/debtors/${d.id}`)}
            />
          ))}
          {!o.invoices.length ? <Empty title="Nothing outstanding" /> : null}
        </Card>
      </Section>

      <Section title="Payment history">
        <Grid min={170}>
          <Stat label="Invoices cleared" value={h.n} />
          <Stat label="Average days to clear" value={h.avg_days ?? '—'} tone={(h.avg_days ?? 0) > 90 ? 'red' : (h.avg_days ?? 0) > 60 ? 'amber' : undefined} />
          <Stat label="Median days" value={h.median_days != null ? Math.round(h.median_days) : '—'} />
          <Stat label="Fastest / slowest" value={h.n ? `${h.min_days ?? '—'} / ${h.max_days ?? '—'} d` : '—'} />
          <Stat label="Amount cleared" value={both(h.lkr, h.usd)} />
          <Stat label="Legal cases · disputes" value={`${h.legal_n} · ${h.disputed_n}`} tone={h.legal_n ? 'red' : undefined} />
        </Grid>
        {h.n ? (
          <Card style={{ marginTop: 8 }}>
            <Text style={{ fontWeight: '700', marginBottom: 6 }}>How long invoices took to clear</Text>
            {dist.map((x) => (
              <Bar key={x.label} label={x.label} value={x.n} max={Math.max(1, h.n)} display={`${x.n} (${Math.round((x.n / h.n) * 100)}%)`} tone={x.tone} />
            ))}
          </Card>
        ) : null}
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
          {h.invoices.map((d) => (
            <ListRow
              key={d.id}
              title={`${d.invoice_no}${d.project_name ? ` · ${d.project_name}` : ''}`}
              subtitle={`${d.invoice_date ? `Invoiced ${fmtDate(d.invoice_date)} · ` : ''}${d.status === 'collected_confirmed' ? 'Collected' : 'Cleared'} ${fmtDate(d.closed_on)}${d.was_legal ? ' · was under Legal' : ''}${d.was_disputed ? ' · disputed' : ''}`}
              right={
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontWeight: '700' }}>{fmtMoney(d.amount, d.currency)}</Text>
                  <Pill label={d.days_to_clear != null ? `${d.days_to_clear} days` : '—'} tone={(d.days_to_clear ?? 0) > 90 ? colors.red : (d.days_to_clear ?? 0) > 60 ? colors.amber : colors.green} />
                </View>
              }
              onPress={() => router.push(`/debtors/${d.id}`)}
            />
          ))}
          {!h.invoices.length ? <Empty title="No cleared invoices yet" /> : null}
        </Card>
      </Section>

      {data.trend.length ? (
        <Section title="Outstanding at each weekly upload">
          <Card>
            {[...data.trend].reverse().map((t) => (
              <Bar
                key={t.as_at}
                label={`${fmtDate(t.as_at)} · ${t.n} invoices · oldest ${t.oldest_days ?? '—'} d`}
                value={Number(t.lkr) + Number(t.usd) * 300}
                max={trendMax}
                display={both(Number(t.lkr), Number(t.usd))}
                tone={colors.blue}
              />
            ))}
            <Muted>Days to clear = invoice date to collection / clearing date; when the invoice date is not in the file, the outstanding days in the last upload plus the days until it was cleared. Generated {fmtDateTime(new Date().toISOString())}.</Muted>
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
