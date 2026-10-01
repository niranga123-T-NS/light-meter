import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, colors, Empty, ErrorBanner, ListRow, Muted, Pill, Row, Screen, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { sampleOverdue } from '@/lib/constants';
import { fmtDate, fmtMoney, human } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Sample } from '@/lib/types';

type Tab = 'all' | 'mine' | 'check' | 'approve' | 'dispatch' | 'out' | 'confirm' | 'sold' | 'cleared' | 'closed';
type Outstanding = { sales_person_id: string; out_n: number; out_lkr: number; overdue_n: number; overdue_lkr: number; sold_n: number; sold_lkr: number; total_lkr: number; over_limit: boolean };
const LIMIT = 500000;
const exposureTone = (v: number) => (v > LIMIT ? colors.red : v >= LIMIT * 0.8 ? colors.amber : colors.green);

const DONE = ['cleared', 'rejected', 'not_available'];
const typeText = (s: Sample) => (s.sample_type === 'returnable' ? 'returnable' : s.nr_disposition === 'sell' ? 'sell' : s.nr_disposition === 'foc' ? 'FOC' : 'non-returnable');
const statusText = (s: Sample) =>
  sampleOverdue(s) ? 'Overdue' : s.status === 'gm_approval' ? 'With GM / DGM' : s.status === 'return_reported' ? 'Return to confirm' : s.status === 'sold_unpaid' ? 'Sold – unpaid' : s.status === 'damaged_lost' ? 'Damaged / incomplete' : human(s.status);
const clientOf = (s: Sample) => (s.client_name ?? '—').trim();
const sum = (list: Sample[], cur: 'LKR' | 'USD') => list.filter((s) => s.currency === cur).reduce((a, s) => a + Number(s.total_value), 0);
const money = (list: Sample[]) => [sum(list, 'LKR') ? fmtMoney(sum(list, 'LKR'), 'LKR') : null, sum(list, 'USD') ? fmtMoney(sum(list, 'USD'), 'USD') : null].filter(Boolean).join(' + ') || '–';

/** Samples tab (Section 13.4): every sample stays on record until it is cleared. */
export default function Samples() {
  const me = useMe();
  const people = usePeople();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const ops = me.role === 'operations_exec';
  const [tab, setTab] = useState<Tab>(params.tab ?? (ops ? 'check' : me.role === 'sm_projects' || me.role === 'gm' ? 'approve' : 'all'));
  const outstanding = useLoad(() => rpc<Outstanding[]>('sample_outstanding'));
  const [view, setView] = useState<'list' | 'customers'>('list');
  const [customer, setCustomer] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('samples').select('*').order('created_at', { ascending: false }).limit(2000);
    if (e) throw new Error(e.message);
    return rows as Sample[];
  });
  const everything = data ?? [];
  const customerOptions = [...new Set(everything.filter((s) => s.status !== 'draft' || s.sales_person_id === me.id).map(clientOf))].sort((a, b) => a.localeCompare(b));
  const all = everything.filter((s) => !customer || clientOf(s) === customer);
  const filters: Record<Tab, (s: Sample) => boolean> = {
    all: (s) => !DONE.includes(s.status),
    check: (s) => s.status === 'submitted',
    approve: (s) => (me.role === 'gm' ? s.status === 'gm_approval' : s.status === 'availability_confirmed' || s.status === 'gm_approval'),
    mine: (s) => ['out', 'return_reported', 'sold_unpaid'].includes(s.status),
    dispatch: (s) => s.status === 'approved',
    out: (s) => s.status === 'out',
    confirm: (s) => s.status === 'return_reported' || s.status === 'damaged_lost',
    sold: (s) => s.status === 'sold_unpaid',
    cleared: (s) => s.status === 'cleared',
    closed: (s) => ['rejected', 'not_available'].includes(s.status),
  };
  const rows = all.filter(filters[tab]).sort((a, b) => Number(sampleOverdue(b)) - Number(sampleOverdue(a)));
  const out = all.filter((s) => s.status === 'out' || s.status === 'return_reported');

  // Customer-wise summary of samples on record
  const summary = customerOptions
    .filter((c) => !customer || c === customer)
    .map((c) => {
      const list = everything.filter((s) => clientOf(s) === c && s.status !== 'draft');
      const ret = list.filter((s) => s.sample_type === 'returnable');
      return {
        client: c,
        n: list.length,
        outList: list.filter((s) => s.status === 'out' || s.status === 'return_reported'),
        overdue: list.filter(sampleOverdue).length,
        sold: list.filter((s) => s.status === 'sold_unpaid'),
        foc: list.filter((s) => s.nr_disposition === 'foc' && s.status === 'cleared'),
        soldPaid: list.filter((s) => s.nr_disposition === 'sell' && s.status === 'cleared'),
        returned: ret.filter((s) => s.status === 'cleared').length,
        damaged: list.filter((s) => s.status === 'damaged_lost').length,
      };
    })
    .filter((c) => c.n);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Samples' }} />
      <Card style={{ borderColor: colors.blue }}>
        <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
          <View style={{ width: 340, maxWidth: '100%' }}>
            <Select label="Customer" value={customer ?? ''} searchable onChange={(v) => setCustomer(v || null)} options={[{ value: '', label: `All customers (${customerOptions.length})` }, ...customerOptions.map((c) => ({ value: c, label: c }))]} />
          </View>
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: 'Samples' },
              { value: 'customers', label: 'Customer summary' },
            ]}
          />
          {isSales(me.role) ? <Button title="+ Request sample" onPress={() => router.push('/samples/new')} /> : null}
        </Row>
        <Muted style={{ marginTop: 6 }}>
          Out with customers: {out.length} · {money(out)} · {all.filter(sampleOverdue).length} overdue · Sold unpaid: {money(all.filter((s) => s.status === 'sold_unpaid'))}
        </Muted>
      </Card>
      <ErrorBanner message={error} />
      {(outstanding.data ?? []).length ? (
        <Card style={{ marginTop: 8, padding: 0, overflow: 'hidden' }}>
          <Text style={{ fontWeight: '700', padding: 12, paddingBottom: 4 }}>
            {isSales(me.role) ? 'My samples outstanding' : 'Samples outstanding by sales person'} (returnable out + sold not paid · limit LKR 500,000)
          </Text>
          {[...(outstanding.data ?? [])]
            .sort((a, b) => Number(b.total_lkr) - Number(a.total_lkr))
            .map((o) => (
              <ListRow
                key={o.sales_person_id}
                highlight={exposureTone(Number(o.total_lkr))}
                title={isSales(me.role) ? 'Total outstanding' : people[o.sales_person_id]?.full_name ?? '—'}
                subtitle={`${o.out_n} returnable out (${fmtMoney(o.out_lkr, 'LKR')})${o.overdue_n ? ` · ${o.overdue_n} overdue (${fmtMoney(o.overdue_lkr, 'LKR')})` : ''} · ${o.sold_n} sold not paid (${fmtMoney(o.sold_lkr, 'LKR')})${o.over_limit ? ' · over the limit – collect overdue samples and the money for sold samples' : ''}`}
                right={<Pill label={fmtMoney(o.total_lkr, 'LKR')} tone={exposureTone(Number(o.total_lkr))} solid={o.over_limit} />}
                onPress={() => setTab('mine')}
              />
            ))}
        </Card>
      ) : null}

      {view === 'customers' ? (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
          <ScrollView horizontal>
            <View>
              <Row gap={0} style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                {['Customer', 'Out (returnable)', 'Overdue', 'Sold – unpaid', 'Sold – paid', 'FOC given', 'Returned & cleared', 'Damaged'].map((h, i) => (
                  <Text key={h} style={[cell, { width: i === 0 ? 220 : 140, fontWeight: '700', textAlign: i ? 'right' : 'left' }]}>
                    {h}
                  </Text>
                ))}
              </Row>
              {summary.map((c) => (
                <Row key={c.client} gap={0} style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
                  <View style={[cell, { width: 220 }]}>
                    <Text style={{ fontWeight: '600' }} numberOfLines={2} onPress={() => { setCustomer(c.client); setView('list'); setTab('all'); }}>
                      {c.client}
                    </Text>
                    <Muted>{c.n} samples</Muted>
                  </View>
                  <Text style={[cell, num]}>{c.outList.length ? `${c.outList.length} · ${money(c.outList)}` : '–'}</Text>
                  <Text style={[cell, num, c.overdue ? { color: colors.red, fontWeight: '700' } : null]}>{c.overdue || '–'}</Text>
                  <Text style={[cell, num, c.sold.length ? { color: colors.amber, fontWeight: '700' } : null]}>{c.sold.length ? `${c.sold.length} · ${money(c.sold)}` : '–'}</Text>
                  <Text style={[cell, num]}>{c.soldPaid.length ? `${c.soldPaid.length} · ${money(c.soldPaid)}` : '–'}</Text>
                  <Text style={[cell, num]}>{c.foc.length ? `${c.foc.length} · ${money(c.foc)}` : '–'}</Text>
                  <Text style={[cell, num]}>{c.returned || '–'}</Text>
                  <Text style={[cell, num, c.damaged ? { color: colors.red } : null]}>{c.damaged || '–'}</Text>
                </Row>
              ))}
            </View>
          </ScrollView>
          {data && !summary.length ? <Empty title="No samples" /> : null}
        </Card>
      ) : (
        <>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'all', label: 'Open (not cleared)', badge: all.filter(filters.all).length },
              { value: 'mine', label: 'Outstanding (out + sold unpaid)', badge: all.filter(filters.mine).length },
              { value: 'check', label: 'Availability check', badge: all.filter(filters.check).length },
              { value: 'approve', label: 'Approval', badge: all.filter(filters.approve).length },
              { value: 'dispatch', label: 'To dispatch', badge: all.filter(filters.dispatch).length },
              { value: 'out', label: 'Out / overdue', badge: all.filter(sampleOverdue).length },
              { value: 'confirm', label: 'Return to confirm', badge: all.filter(filters.confirm).length },
              { value: 'sold', label: 'Sold – unpaid', badge: all.filter(filters.sold).length },
              { value: 'cleared', label: 'Cleared' },
              { value: 'closed', label: 'Rejected / not available' },
            ]}
          />
          <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
            {rows.map((s) => (
              <ListRow
                key={s.id}
                title={`${s.code} · ${s.client_name ?? ''}`}
                subtitle={`${s.project_name ?? ''} · ${s.purpose} · ${typeText(s)}${s.sample_type === 'returnable' && s.status === 'out' ? ` · return by ${fmtDate(s.expected_return_date)}` : ''}${isSales(me.role) ? '' : ` · ${people[s.sales_person_id]?.full_name ?? ''}`}`}
                highlight={sampleOverdue(s) || s.status === 'damaged_lost' ? colors.red : s.status === 'return_reported' || s.status === 'sold_unpaid' ? colors.amber : undefined}
                right={
                  <Row gap={4}>
                    <Muted>{fmtMoney(s.total_value, s.currency)}</Muted>
                    <Pill label={statusText(s)} tone={sampleOverdue(s) || s.status === 'damaged_lost' ? colors.red : s.status === 'cleared' ? colors.green : s.status === 'return_reported' || s.status === 'sold_unpaid' ? colors.amber : colors.blue} />
                  </Row>
                }
                onPress={() => router.push(`/samples/${s.id}`)}
              />
            ))}
            {data && !rows.length ? <Empty title="No samples here" /> : null}
          </Card>
        </>
      )}
    </Screen>
  );
}

const cell = { paddingVertical: 8, paddingHorizontal: 8, fontSize: 13 } as const;
const num = { width: 140, textAlign: 'right' } as const;
