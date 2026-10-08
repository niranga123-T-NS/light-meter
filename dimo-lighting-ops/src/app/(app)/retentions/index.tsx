import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, colors, Empty, ErrorBanner, Grid, ListRow, Muted, Pill, Row, Screen, Section, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { daysFrom, retentionStage, STAGE_LABEL, type RetentionStage } from '@/lib/retentions';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Retention } from '@/lib/types';

type Money = { lkr: number; usd: number };
type Tab = 'open' | 'due' | 'claimed' | 'collected' | 'all';

/** What is still to be collected: the retention value less any part collections (open retentions) */
const balanceOf = (r: Retention) => Number(r.retention_value) - (r.status === 'held' || r.status === 'claimed' ? Number(r.collected_amount ?? 0) : 0);
const sumOf = (list: Retention[], val: (r: Retention) => number = balanceOf): Money => ({
  lkr: list.filter((r) => r.currency === 'LKR').reduce((a, r) => a + val(r), 0),
  usd: list.filter((r) => r.currency === 'USD').reduce((a, r) => a + val(r), 0),
});
const money = (m: Money) => [m.lkr ? fmtMoney(m.lkr, 'LKR') : null, m.usd ? fmtMoney(m.usd, 'USD') : null].filter(Boolean).join(' + ') || fmtMoney(0, 'LKR');
const cellMoney = (m: Money) => [m.lkr ? fmtMoney(m.lkr, 'LKR') : null, m.usd ? fmtMoney(m.usd, 'USD') : null].filter(Boolean).join('\n') || '–';
const weight = (m: Money) => m.lkr + m.usd * 300;
const clientOf = (r: Retention) => r.end_client.trim();

const STAGE_TONE: Record<RetentionStage, string> = {
  not_due: colors.blue,
  due_soon: colors.amber,
  due: colors.red,
  claimed: colors.blue,
  claim_overdue: colors.red,
  collected: colors.green,
  cancelled: colors.grey,
};

/** Retentions tab: dashboard, customer-wise view and the list (Operations, SM Projects, GM / DGM; sales see their own). */
export default function Retentions() {
  const me = useMe();
  const people = usePeople();
  const [customer, setCustomer] = useState<string | null>(null);
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'open');
  const [view, setView] = useState<'list' | 'customers'>('list');
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('retentions').select('*').order('due_date').limit(3000);
    if (e) throw new Error(e.message);
    return rows as Retention[];
  });
  const today = todayISO();
  const everything = data ?? [];
  const customers = [...new Set(everything.filter((r) => r.status !== 'cancelled').map(clientOf))].sort((a, b) => a.localeCompare(b));
  const all = everything.filter((r) => !customer || clientOf(r) === customer);
  const open = all.filter((r) => r.status === 'held' || r.status === 'claimed');
  const by = (s: RetentionStage[]) => open.filter((r) => s.includes(retentionStage(r, today)));
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const collectedYear = all.filter((r) => r.status === 'collected' && (r.collected_on ?? '') >= yearStart);
  const withinDays = (n: number) => open.filter((r) => r.status === 'held' && r.due_date > today && daysFrom(today, r.due_date) <= n);
  const horizon = [
    { label: 'Next 3 months', list: withinDays(91) },
    { label: 'Next 6 months', list: withinDays(182) },
    { label: 'Next 12 months', list: withinDays(365) },
    { label: 'Later', list: open.filter((r) => r.status === 'held' && daysFrom(today, r.due_date) > 365) },
  ];
  const horizonMax = Math.max(1, ...horizon.map((h) => weight(sumOf(h.list))));
  const manager = ['operations_exec', 'sm_projects', 'gm'].includes(me.role);

  const filters: Record<Tab, (r: Retention) => boolean> = {
    open: (r) => r.status === 'held' || r.status === 'claimed',
    due: (r) => ['due', 'due_soon'].includes(retentionStage(r, today)),
    claimed: (r) => r.status === 'claimed',
    collected: (r) => r.status === 'collected',
    all: () => true,
  };
  const rows = all.filter(filters[tab]);

  const custRows = (customer ? [customer] : customers)
    .map((c) => {
      const list = everything.filter((r) => clientOf(r) === c && (r.status === 'held' || r.status === 'claimed'));
      const st = (s: RetentionStage[]) => list.filter((r) => s.includes(retentionStage(r, today)));
      return {
        client: c,
        n: list.length,
        held: sumOf(list),
        notDue: sumOf(st(['not_due', 'due_soon'])),
        due: sumOf(st(['due'])),
        claimed: sumOf(st(['claimed', 'claim_overdue'])),
        next: list.filter((r) => r.status === 'held').map((r) => r.due_date).sort()[0] ?? null,
        collected: sumOf(everything.filter((r) => clientOf(r) === c && r.status === 'collected'), (r) => Number(r.collected_amount ?? 0)),
      };
    })
    .sort((a, b) => weight(b.held) - weight(a.held));

  const bySales = Object.entries(
    open.reduce<Record<string, Retention[]>>((acc, r) => {
      const k = r.sales_person_id ?? '';
      (acc[k] = acc[k] ?? []).push(r);
      return acc;
    }, {}),
  ).sort((a, b) => weight(sumOf(b[1])) - weight(sumOf(a[1])));

  return (
    <Screen refreshing={loading} onRefresh={reload} maxWidth={1300}>
      <Stack.Screen options={{ title: 'Retentions' }} />
      <ErrorBanner message={error} />
      <Card style={{ borderColor: colors.blue }}>
        <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
          <View style={{ width: 340, maxWidth: '100%' }}>
            <Select label="Customer (end client)" value={customer ?? ''} searchable onChange={(v) => setCustomer(v || null)} options={[{ value: '', label: `All customers (${customers.length})` }, ...customers.map((c) => ({ value: c, label: c }))]} />
          </View>
          {manager ? <Button title="+ New retention" onPress={() => router.push('/retentions/edit')} /> : null}
        </Row>
      </Card>

      <Section title={customer ? `Dashboard – ${customer}` : isSales(me.role) ? 'My retentions' : 'Dashboard'}>
        <Grid min={190}>
          <Stat label={`Total retention held (${open.length})`} value={money(sumOf(open))} onPress={() => setTab('open')} />
          <Stat label={`Not yet due (${by(['not_due', 'due_soon']).length})`} value={money(sumOf(by(['not_due', 'due_soon'])))} />
          <Stat label={`Due within 60 days (${by(['due_soon']).length})`} value={money(sumOf(by(['due_soon'])))} tone={by(['due_soon']).length ? 'amber' : undefined} onPress={() => setTab('due')} />
          <Stat label={`Due – not claimed (${by(['due']).length})`} value={money(sumOf(by(['due'])))} tone={by(['due']).length ? 'red' : undefined} onPress={() => setTab('due')} />
          <Stat label={`Claimed – awaiting payment (${by(['claimed', 'claim_overdue']).length})`} value={money(sumOf(by(['claimed', 'claim_overdue'])))} onPress={() => setTab('claimed')} />
          <Stat label={`Claimed over 60 days (${by(['claim_overdue']).length})`} value={money(sumOf(by(['claim_overdue'])))} tone={by(['claim_overdue']).length ? 'red' : undefined} onPress={() => setTab('claimed')} />
          <Stat label={`Collected this year (${collectedYear.length})`} value={money(sumOf(collectedYear, (r) => Number(r.collected_amount ?? 0)))} tone="green" onPress={() => setTab('collected')} />
          <Stat label="Bank guarantees in place" value={open.filter((r) => r.retention_form === 'bank_guarantee').length} />
        </Grid>
        <Card style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6 }}>Releases falling due (not yet claimed)</Text>
          {horizon.map((h) => {
            const m = sumOf(h.list);
            return (
              <View key={h.label} style={{ marginBottom: 8 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text>
                    {h.label} · {h.list.length}
                  </Text>
                  <Text style={{ fontWeight: '600' }}>{money(m)}</Text>
                </Row>
                <View style={{ height: 8, backgroundColor: colors.line, borderRadius: 4, overflow: 'hidden', marginTop: 3 }}>
                  <View style={{ height: 8, width: `${weight(m) ? Math.max(2, (weight(m) / horizonMax) * 100) : 0}%`, backgroundColor: colors.blue, borderRadius: 4 }} />
                </View>
              </View>
            );
          })}
        </Card>
        {!isSales(me.role) && bySales.length ? (
          <Card style={{ marginTop: 8 }}>
            <Text style={{ fontWeight: '700', marginBottom: 6 }}>By sales person (open)</Text>
            {bySales.map(([sp, list]) => (
              <Row key={sp} style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
                <Text>
                  {people[sp]?.full_name ?? 'Not assigned'} · {list.length}
                  {list.some((r) => retentionStage(r, today) === 'due') ? <Text style={{ color: colors.red }}> · {list.filter((r) => retentionStage(r, today) === 'due').length} due</Text> : null}
                </Text>
                <Text style={{ fontWeight: '600' }}>{money(sumOf(list))}</Text>
              </Row>
            ))}
          </Card>
        ) : null}
      </Section>

      <Row wrap gap={8} style={{ marginTop: 8 }}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'list', label: 'Retentions' },
            { value: 'customers', label: 'By customer' },
          ]}
        />
      </Row>

      {view === 'customers' ? (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
          <ScrollView horizontal>
            <View>
              <Row gap={0} style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                {['Customer', 'Held', 'Not yet due', 'Due – not claimed', 'Claimed', 'Next due date', 'Collected (all time)'].map((h, i) => (
                  <Text key={h} style={[cell, { width: i === 0 ? 230 : 150, fontWeight: '700', textAlign: i ? 'right' : 'left' }]}>
                    {h}
                  </Text>
                ))}
              </Row>
              {custRows.map((c) => (
                <Pressable key={c.client} onPress={() => { setCustomer(c.client); setView('list'); }}>
                  <Row gap={0} style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
                    <View style={[cell, { width: 230 }]}>
                      <Text style={{ fontWeight: '600' }} numberOfLines={2}>
                        {c.client}
                      </Text>
                      <Muted>{c.n} open</Muted>
                    </View>
                    <Text style={[cell, num, { fontWeight: '700' }]}>{cellMoney(c.held)}</Text>
                    <Text style={[cell, num]}>{cellMoney(c.notDue)}</Text>
                    <Text style={[cell, num, weight(c.due) ? { color: colors.red, fontWeight: '700' } : null]}>{cellMoney(c.due)}</Text>
                    <Text style={[cell, num]}>{cellMoney(c.claimed)}</Text>
                    <Text style={[cell, num]}>{c.next ? fmtDate(c.next) : '–'}</Text>
                    <Text style={[cell, num]}>{cellMoney(c.collected)}</Text>
                  </Row>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          {data && !custRows.length ? <Empty title="No retentions" /> : null}
        </Card>
      ) : (
        <>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'open', label: 'Open', badge: all.filter(filters.open).length },
              { value: 'due', label: 'Due / due soon', badge: all.filter(filters.due).length },
              { value: 'claimed', label: 'Claimed', badge: all.filter(filters.claimed).length },
              { value: 'collected', label: 'Collected' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
            {rows.map((r) => {
              const st = retentionStage(r, today);
              return (
                <ListRow
                  key={r.id}
                  highlight={['due', 'claim_overdue'].includes(st) ? colors.red : st === 'due_soon' ? colors.amber : undefined}
                  title={`${r.project_name} · ${r.end_client}`}
                  subtitle={`${r.code}${r.contract_no ? ` · ${r.contract_no}` : ''}${r.main_contractor ? ` · ${r.main_contractor}` : ''} · ${r.retention_pct != null ? `${r.retention_pct}% · ` : ''}due ${fmtDate(r.due_date)}${r.extensions ? ` (extended ${r.extensions}×)` : ''}${r.retention_form === 'bank_guarantee' ? ' · BG' : ''}${isSales(me.role) ? '' : ` · ${people[r.sales_person_id ?? '']?.full_name ?? 'no sales person'}`}`}
                  right={
                    <Row gap={6}>
                      <Pill label={STAGE_LABEL[st]} tone={STAGE_TONE[st]} />
                      {Number(r.collected_amount ?? 0) > 0 && (r.status === 'held' || r.status === 'claimed') ? (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontWeight: '700' }}>{fmtMoney(balanceOf(r), r.currency)}</Text>
                          <Text style={{ fontSize: 11, color: colors.green }}>{`${fmtMoney(r.collected_amount, r.currency)} collected`}</Text>
                        </View>
                      ) : (
                        <Text style={{ fontWeight: '700' }}>{fmtMoney(r.retention_value, r.currency)}</Text>
                      )}
                    </Row>
                  }
                  onPress={() => router.push(`/retentions/${r.id}`)}
                />
              );
            })}
            {data && !rows.length ? <Empty title="No retentions here" /> : null}
          </Card>
        </>
      )}
    </Screen>
  );
}

const cell = { paddingVertical: 8, paddingHorizontal: 8, fontSize: 13 } as const;
const num = { width: 150, textAlign: 'right' } as const;
