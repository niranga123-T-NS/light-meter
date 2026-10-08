import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AgeingChip } from '@/components/Ageing';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Muted, Pill, Row, Screen, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { AGEING_COLOURS, AGEING_ORDER, fmtDate, fmtMoney, human, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Debt } from '@/lib/types';

type Filter = 'open' | 'legal' | 'hearing' | 'mismatch' | 'non_moving' | 'closed';
type Money = { lkr: number; usd: number };
type CustomerRow = { client: string; n: number; legal: number; maxDays: number; total: Money; legalTotal: Money; buckets: Record<string, Money> };

const hearingPassed = (d: Debt) => d.is_legal && !d.legal_outcome && !!d.next_hearing_date && d.next_hearing_date < todayISO();
const sumMoney = (list: Debt[]): Money => ({
  lkr: list.filter((d) => d.currency === 'LKR').reduce((a, d) => a + Number(d.amount), 0),
  usd: list.filter((d) => d.currency === 'USD').reduce((a, d) => a + Number(d.amount), 0),
});
const moneyText = (m: Money) => [m.lkr ? fmtMoney(m.lkr, 'LKR') : null, m.usd ? fmtMoney(m.usd, 'USD') : null].filter(Boolean).join(' + ') || '—';

/** Customer-wise totals per ageing bucket (debtors are grouped by the client name in the accounts file). */
function byCustomer(list: Debt[]): CustomerRow[] {
  const groups = new Map<string, Debt[]>();
  for (const d of list) {
    const k = (d.client_name ?? '—').trim();
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return [...groups.entries()].map(([client, ds]) => ({
    client,
    n: ds.length,
    legal: ds.filter((d) => d.is_legal).length,
    maxDays: Math.max(...ds.map((d) => d.outstanding_days)),
    total: sumMoney(ds),
    legalTotal: sumMoney(ds.filter((d) => d.is_legal)),
    buckets: Object.fromEntries(AGEING_ORDER.map((b) => [b, sumMoney(ds.filter((d) => d.ageing_bucket === b))])),
  }));
}

/** My Debtors (sales) / All Debtors (SM Projects, GM, Operations) – Section 12.4. */
export default function Debtors() {
  const me = useMe();
  const people = usePeople();
  const params = useLocalSearchParams<{ bucket?: string; filter?: Filter }>();
  const [filter, setFilter] = useState<Filter>(params.filter ?? 'open');
  const [bucket, setBucket] = useState<string | null>(params.bucket ?? null);
  const [sort, setSort] = useState<'days' | 'amount' | 'client'>('days');
  const [person, setPerson] = useState<string | null>(null);
  const [view, setView] = useState<'invoices' | 'customers'>('invoices');
  const [customer, setCustomer] = useState<string | null>(null);
  const [custSort, setCustSort] = useState<'total' | 'name' | 'days'>('total');

  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('debts').select('*').order('outstanding_days', { ascending: false }).limit(3000);
    if (e) throw new Error(e.message);
    return rows as Debt[];
  });
  // Date of the latest confirmed debtors file (management roles can read the upload list)
  const latest = useLoad(async () => {
    const { data: up } = await supabase.from('debt_uploads').select('as_at').eq('status', 'confirmed').order('as_at', { ascending: false }).limit(1).maybeSingle();
    return (up as { as_at: string } | null)?.as_at ?? null;
  });

  const [fourteen] = useState(() => Date.now() - 14 * 86400000);
  const clientOf = (d: Debt) => (d.client_name ?? '—').trim();
  // Customer list = the customers in the latest uploaded debtors file (invoices missing from a file are cleared,
  // so the open invoices are exactly the latest file)
  const inLatest = (data ?? []).filter((d) => !['collected_confirmed', 'cleared'].includes(d.status));
  const customerOptions = [...new Set(inLatest.map(clientOf))]
    .sort((a, b) => a.localeCompare(b))
    .map((c) => {
      const ds = inLatest.filter((d) => clientOf(d) === c);
      return { value: c, label: c, hint: `${ds.length} invoice${ds.length === 1 ? '' : 's'} · ${moneyText(sumMoney(ds))}` };
    });
  // View all customers or one customer: applies to the totals, age brackets, tabs and both lists below
  const all = (data ?? []).filter((d) => !customer || clientOf(d) === customer);
  const open = all.filter((d) => !['collected_confirmed', 'cleared'].includes(d.status));
  const byFilter: Record<Filter, Debt[]> = {
    open,
    legal: open.filter((d) => d.is_legal),
    // Legal cases whose hearing date has passed without an update
    hearing: open.filter((d) => hearingPassed(d)),
    mismatch: open.filter((d) => d.collection_mismatch),
    non_moving: open.filter((d) => !d.is_legal && !['collected', 'disputed'].includes(d.status) && Date.parse(d.last_status_at) < fourteen && Date.parse(d.last_amount_change_at) < fourteen),
    closed: all.filter((d) => ['collected_confirmed', 'cleared'].includes(d.status)),
  };
  const rows = byFilter[filter]
    .filter((d) => !bucket || d.ageing_bucket === bucket)
    .filter((d) => !person || d.sales_person_id === person)
    .sort((a, b) => (sort === 'amount' ? b.amount - a.amount : sort === 'client' ? (a.client_name ?? '').localeCompare(b.client_name ?? '') : b.outstanding_days - a.outstanding_days));

  // Customer view uses the same filters (tab, ageing bucket, sales person) as the invoice list
  const custBase = byFilter[filter].filter((d) => !bucket || d.ageing_bucket === bucket).filter((d) => !person || d.sales_person_id === person);
  const customers = byCustomer(custBase).sort((a, b) =>
    custSort === 'name' ? a.client.localeCompare(b.client) : custSort === 'days' ? b.maxDays - a.maxDays : b.total.lkr + b.total.usd * 300 - (a.total.lkr + a.total.usd * 300),
  );
  const openTotal = sumMoney(open);
  const legalOpen = open.filter((d) => d.is_legal);
  const legalTotal = sumMoney(legalOpen);
  const nonLegalTotal = sumMoney(open.filter((d) => !d.is_legal));

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: isSales(me.role) ? 'My Debtors' : 'Debtors' }} />
      <ErrorBanner message={error} />
      {/* Customer view: all customers or one customer from the latest uploaded debtors file */}
      <Card style={{ borderColor: colors.blue }}>
        <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
          <View style={{ width: 360, maxWidth: '100%' }}>
            <Select
              label={`Customer – from the latest debtors list${latest.data ? ` (as at ${fmtDate(latest.data)})` : ''}`}
              value={customer ?? ''}
              onChange={(v) => setCustomer(v || null)}
              searchable
              options={[{ value: '', label: `All customers (${customerOptions.length})` }, ...customerOptions]}
            />
          </View>
          {customer ? <Button small title="Customer profile & history" onPress={() => router.push({ pathname: '/debtors/customer', params: { name: customer } })} /> : null}
          {customer ? <Button small variant="secondary" title="✕ All customers" onPress={() => setCustomer(null)} /> : null}
        </Row>
      </Card>
      {/* Summary strip: total outstanding by category and currency */}
      <Card>
        <Row wrap gap={6}>
          {AGEING_ORDER.map((b) => {
            const list = open.filter((d) => d.ageing_bucket === b);
            const c = AGEING_COLOURS[b];
            return (
              <Pressable key={b} onPress={() => setBucket(bucket === b ? null : b)} style={{ minWidth: 118, padding: 8, borderRadius: 8, borderWidth: 2, borderColor: bucket === b ? colors.ink : colors.line }}>
                <AgeingChip bucket={b} />
                <Text style={{ fontWeight: '700', marginTop: 4 }}>{list.length}</Text>
                <Muted>{fmtMoney(list.filter((d) => d.currency === 'LKR').reduce((a, d) => a + Number(d.amount), 0), 'LKR')}</Muted>
                <Muted>{fmtMoney(list.filter((d) => d.currency === 'USD').reduce((a, d) => a + Number(d.amount), 0), 'USD')}</Muted>
                <View style={{ height: 3, backgroundColor: c.bg, marginTop: 4 }} />
              </Pressable>
            );
          })}
        </Row>
        <Row wrap gap={16} style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
          <View>
            <Muted>Total outstanding ({open.length} invoices)</Muted>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{moneyText(openTotal)}</Text>
          </View>
          <View>
            <Muted>Excluding legal</Muted>
            <Text style={{ fontWeight: '700' }}>{moneyText(nonLegalTotal)}</Text>
          </View>
          <Pressable onPress={() => setFilter('legal')}>
            <Muted>Legal ({legalOpen.length})</Muted>
            <Text style={{ fontWeight: '700', color: colors.red }}>{moneyText(legalTotal)}</Text>
          </Pressable>
        </Row>
      </Card>
      <Row wrap style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open', badge: 0 },
            { value: 'legal', label: 'Legal', badge: byFilter.legal.length },
            { value: 'hearing', label: 'Hearing date passed', badge: byFilter.hearing.length },
            { value: 'non_moving', label: 'Non-moving', badge: byFilter.non_moving.length },
            { value: 'mismatch', label: 'Collection mismatch', badge: byFilter.mismatch.length },
            { value: 'closed', label: 'Collected / cleared' },
          ]}
        />
        {me.role === 'operations_exec' ? <Button title="⇪ Upload" onPress={() => router.push('/debtors/upload')} /> : null}
      </Row>
      <Row wrap gap={8}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'invoices', label: 'Invoices' },
            { value: 'customers', label: 'By customer' },
          ]}
        />
      </Row>
      <Row wrap gap={8}>
        {view === 'customers' ? (
          <View style={{ width: 200 }}>
            <Select
              label="Sort customers"
              value={custSort}
              onChange={(v) => setCustSort(v as 'total')}
              options={[
                { value: 'total', label: 'Total outstanding' },
                { value: 'name', label: 'Customer name' },
                { value: 'days', label: 'Oldest invoice (days)' },
              ]}
            />
          </View>
        ) : (
        <View style={{ width: 200 }}>
          <Select
            label="Sort"
            value={sort}
            onChange={(v) => setSort(v as 'days')}
            options={[
              { value: 'days', label: 'Outstanding days' },
              { value: 'amount', label: 'Amount' },
              { value: 'client', label: 'Client' },
            ]}
          />
        </View>
        )}
        {!isSales(me.role) ? (
          <View style={{ width: 220 }}>
            <Select
              label="Sales person"
              value={person}
              onChange={(v) => setPerson(v || null)}
              options={[{ value: '', label: 'All' }, ...Object.values(people).filter((p) => isSales(p.role)).map((p) => ({ value: p.id, label: p.full_name }))]}
            />
          </View>
        ) : null}
      </Row>
      {view === 'customers' ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <ScrollView horizontal>
            <View>
              <Row gap={0} style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                <Text style={[cellStyle, { width: 220, fontWeight: '700' }]}>Customer</Text>
                {AGEING_ORDER.map((b) => (
                  <Text key={b} style={[cellStyle, { fontWeight: '700', textAlign: 'right' }]}>
                    {AGEING_COLOURS[b].label}
                  </Text>
                ))}
                <Text style={[cellStyle, { fontWeight: '700', textAlign: 'right', color: colors.red }]}>Legal</Text>
                <Text style={[cellStyle, { width: 150, fontWeight: '800', textAlign: 'right' }]}>Total</Text>
              </Row>
              {customers.map((c) => (
                <Pressable
                  key={c.client}
                  onPress={() => router.push({ pathname: '/debtors/customer', params: { name: c.client } })}
                >
                  <Row gap={0} style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
                    <View style={[cellBox, { width: 220 }]}>
                      <Text style={{ fontWeight: '600' }} numberOfLines={2}>
                        {c.client}
                      </Text>
                      <Muted>
                        {c.n} invoices · oldest {c.maxDays} d{c.legal ? ` · ${c.legal} legal` : ''}
                      </Muted>
                    </View>
                    {AGEING_ORDER.map((b) => (
                      <Text key={b} style={[cellStyle, { textAlign: 'right' }]}>
                        {moneyCell(c.buckets[b])}
                      </Text>
                    ))}
                    <Text style={[cellStyle, { textAlign: 'right', color: colors.red }]}>{moneyCell(c.legalTotal)}</Text>
                    <Text style={[cellStyle, { width: 150, textAlign: 'right', fontWeight: '800' }]}>{moneyCell(c.total)}</Text>
                  </Row>
                </Pressable>
              ))}
              <Row gap={0} style={{ backgroundColor: colors.bg }}>
                <Text style={[cellStyle, { width: 220, fontWeight: '800' }]}>Total ({customers.length} customers)</Text>
                {AGEING_ORDER.map((b) => (
                  <Text key={b} style={[cellStyle, { textAlign: 'right', fontWeight: '700' }]}>
                    {moneyCell(sumMoney(custBase.filter((d) => d.ageing_bucket === b)))}
                  </Text>
                ))}
                <Text style={[cellStyle, { textAlign: 'right', fontWeight: '700', color: colors.red }]}>{moneyCell(sumMoney(custBase.filter((d) => d.is_legal)))}</Text>
                <Text style={[cellStyle, { width: 150, textAlign: 'right', fontWeight: '800' }]}>{moneyCell(sumMoney(custBase))}</Text>
              </Row>
            </View>
          </ScrollView>
          {data && !customers.length ? <Empty title="No debts here" /> : null}
        </Card>
      ) : (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((d) => (
          <ListRow
            key={d.id}
            left={<AgeingChip bucket={d.ageing_bucket} legal={d.is_legal} />}
            highlight={hearingPassed(d) ? colors.red : undefined}
            title={`${d.client_name ?? ''} · ${d.invoice_no}`}
            subtitle={`${d.project_name ?? ''} · ${d.outstanding_days} days · ${human(d.status)}${d.status === 'payment_promised' ? ` ${fmtDate(d.promised_date)}` : ''}${isSales(me.role) ? '' : ` · ${people[d.sales_person_id ?? '']?.full_name ?? ''}`}${d.is_legal && d.next_hearing_date ? ` · hearing ${fmtDate(d.next_hearing_date)}` : ''}`}
            right={
              <Row gap={4}>
                {hearingPassed(d) ? <Pill label="Hearing passed – update" tone={colors.red} solid /> : null}
                {d.collection_mismatch ? <Pill label="Mismatch" tone={colors.red} /> : null}
                {d.status === 'partially_collected' && d.collected_amount ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontWeight: '700' }}>{fmtMoney(Number(d.amount) - Number(d.collected_amount), d.currency)}</Text>
                    <Text style={{ fontSize: 11, color: colors.green }}>{`${fmtMoney(d.collected_amount, d.currency)} collected`}</Text>
                  </View>
                ) : (
                  <Text style={{ fontWeight: '700' }}>{fmtMoney(d.amount, d.currency)}</Text>
                )}
              </Row>
            }
            onPress={() => router.push(`/debtors/${d.id}`)}
          />
        ))}
        {data && !rows.length ? <Empty title="No debts here" /> : null}
      </Card>
      )}
    </Screen>
  );
}

const cellBox = { width: 120, paddingVertical: 8, paddingHorizontal: 8 } as const;
const cellStyle = { ...cellBox, fontSize: 13 } as const;
/** LKR on top, USD under it; blank when nothing is outstanding. */
function moneyCell(m: Money) {
  const parts = [m.lkr ? fmtMoney(m.lkr, 'LKR') : null, m.usd ? fmtMoney(m.usd, 'USD') : null].filter(Boolean);
  return parts.length ? parts.join('\n') : '–';
}
