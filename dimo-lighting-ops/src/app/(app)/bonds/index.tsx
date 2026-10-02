import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, colors, Empty, ErrorBanner, Grid, Muted, Pill, Row, Screen, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { BOND_STAGE_LABEL, BOND_TYPES, bondAction, bondStage, type BondStage } from '@/lib/bonds';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { daysFrom } from '@/lib/retentions';
import { supabase } from '@/lib/supabase';
import type { Bond, BondType } from '@/lib/types';

type Money = { lkr: number; usd: number };
type Filter = 'open' | 'expiring' | 'expired' | 'action' | 'closed' | 'all';

const sumOf = (list: Bond[], val: (b: Bond) => number = (b) => Number(b.bond_value)): Money => ({
  lkr: list.filter((b) => b.currency === 'LKR').reduce((a, b) => a + val(b), 0),
  usd: list.filter((b) => b.currency === 'USD').reduce((a, b) => a + val(b), 0),
});
const money = (m: Money) => [m.lkr ? fmtMoney(m.lkr, 'LKR') : null, m.usd ? fmtMoney(m.usd, 'USD') : null].filter(Boolean).join(' + ') || fmtMoney(0, 'LKR');

const STAGE_TONE: Record<BondStage, string> = {
  active: colors.green,
  expiring: colors.amber,
  expired: colors.red,
  action: colors.blue,
  returned: colors.grey,
  claimed: colors.red,
  cancelled: colors.grey,
};

type Col = { h: string; w: number; right?: boolean; v: (b: Bond) => string };

/** Bonds tab: Bid, Performance and Advance Payment bonds. Operations records them; everyone else views. */
export default function Bonds() {
  const me = useMe();
  const people = usePeople();
  const [type, setType] = useState<BondType>('bid');
  const [filter, setFilter] = useState<Filter>('open');
  const [customer, setCustomer] = useState('');
  const [bank, setBank] = useState('');
  const [owner, setOwner] = useState('');
  const { data, error, loading, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('bonds').select('*').order('expiry_date').limit(3000);
    if (e) throw new Error(e.message);
    return rows as Bond[];
  });
  const today = todayISO();
  const everything = data ?? [];
  const ofType = everything.filter((b) => b.bond_type === type);
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const customers = uniq(ofType.map((b) => b.customer.trim()));
  const banks = uniq(ofType.map((b) => b.bank.trim()));
  const owners = uniq(ofType.map((b) => b.owner_id ?? ''));
  const scoped = ofType.filter((b) => (!customer || b.customer.trim() === customer) && (!bank || b.bank.trim() === bank) && (!owner || b.owner_id === owner));
  const open = scoped.filter((b) => b.status === 'active');
  const st = (s: BondStage) => open.filter((b) => bondStage(b, today) === s);
  const actionDue = open.filter((b) => bondAction(b, today));
  const filters: Record<Filter, (b: Bond) => boolean> = {
    open: (b) => b.status === 'active',
    expiring: (b) => bondStage(b, today) === 'expiring',
    expired: (b) => bondStage(b, today) === 'expired',
    action: (b) => !!bondAction(b, today),
    closed: (b) => b.status !== 'active',
    all: () => true,
  };
  const rows = scoped.filter(filters[filter]);
  const ops = me.role === 'operations_exec';

  const left = (b: Bond) => {
    if (b.status !== 'active') return '—';
    const d = daysFrom(today, b.expiry_date);
    return d < 0 ? `${-d} days over` : d === 0 ? 'today' : `${d} days`;
  };
  const ownerName = (b: Bond) => people[b.owner_id ?? '']?.full_name ?? '—';
  const common: Col[] = [{ h: 'Bond no.', w: 150, v: (b) => b.bond_no }];
  const tail: Col[] = [
    { h: 'Validity', w: 110, v: (b) => fmtDate(b.expiry_date) },
    { h: 'Days left', w: 110, v: left },
    { h: 'Owner', w: 140, v: ownerName },
  ];
  const cols: Record<BondType, Col[]> = {
    bid: [
      ...common,
      { h: 'Tender no. / name', w: 230, v: (b) => `${b.tender_no ?? '—'}\n${b.project_name}` },
      { h: 'Customer', w: 170, v: (b) => b.customer },
      { h: 'Bank', w: 150, v: (b) => [b.bank, b.bank_branch].filter(Boolean).join('\n') },
      { h: 'Value', w: 150, right: true, v: (b) => fmtMoney(b.bond_value, b.currency) },
      { h: 'Issue', w: 110, v: (b) => fmtDate(b.issue_date) },
      { h: 'Tender closing', w: 120, v: (b) => fmtDate(b.tender_closing_date) },
      ...tail.slice(0, 2),
      { h: 'Result', w: 100, v: (b) => b.tender_result[0].toUpperCase() + b.tender_result.slice(1) },
      tail[2],
    ],
    performance: [
      ...common,
      { h: 'Contract / PO', w: 130, v: (b) => b.contract_no ?? '—' },
      { h: 'Project / customer', w: 230, v: (b) => `${b.project_name}\n${b.customer}` },
      { h: 'Bank', w: 150, v: (b) => [b.bank, b.bank_branch].filter(Boolean).join('\n') },
      { h: 'Contract value', w: 160, right: true, v: (b) => (b.contract_value != null ? fmtMoney(b.contract_value, b.currency) : '—') },
      { h: 'Bond %', w: 70, right: true, v: (b) => (b.bond_pct != null ? `${b.bond_pct}%` : '—') },
      { h: 'Bond value', w: 150, right: true, v: (b) => fmtMoney(b.bond_value, b.currency) },
      ...tail.slice(0, 2),
      { h: 'Completion', w: 110, v: (b) => fmtDate(b.completion_date) },
      { h: 'DLP ends', w: 110, v: (b) => fmtDate(b.dlp_end_date) },
      tail[2],
    ],
    advance_payment: [
      ...common,
      { h: 'Contract / PO', w: 130, v: (b) => b.contract_no ?? '—' },
      { h: 'Project / customer', w: 230, v: (b) => `${b.project_name}\n${b.customer}` },
      { h: 'Bank', w: 150, v: (b) => [b.bank, b.bank_branch].filter(Boolean).join('\n') },
      { h: 'Advance received', w: 160, right: true, v: (b) => fmtMoney(b.advance_amount ?? b.bond_value, b.currency) },
      { h: 'Recovered', w: 150, right: true, v: (b) => fmtMoney(b.recovered_amount, b.currency) },
      { h: 'Balance', w: 150, right: true, v: (b) => fmtMoney(Math.max(0, Number(b.advance_amount ?? b.bond_value) - Number(b.recovered_amount)), b.currency) },
      ...tail,
    ],
  };
  const balance = (b: Bond) => Math.max(0, Number(b.advance_amount ?? b.bond_value) - Number(b.recovered_amount));

  return (
    <Screen refreshing={loading} onRefresh={reload} maxWidth={1400}>
      <Stack.Screen options={{ title: 'Bonds' }} />
      <ErrorBanner message={error} />
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={type}
          onChange={(t) => setType(t)}
          options={BOND_TYPES.map((t) => ({ value: t.value, label: t.label, badge: everything.filter((b) => b.bond_type === t.value && b.status === 'active').length }))}
        />
        {ops ? <Button title={`+ New ${BOND_TYPES.find((t) => t.value === type)?.short.toLowerCase()}`} onPress={() => router.push({ pathname: '/bonds/edit', params: { type } })} /> : null}
      </Row>

      <Grid min={200}>
        <Stat label={`Open (${open.length})`} value={money(type === 'advance_payment' ? sumOf(open, balance) : sumOf(open))} onPress={() => setFilter('open')} />
        <Stat label={`Expiring ≤ 30 days (${st('expiring').length})`} value={money(sumOf(st('expiring')))} tone={st('expiring').length ? 'amber' : undefined} onPress={() => setFilter('expiring')} />
        <Stat label={`Expired – not returned (${st('expired').length})`} value={money(sumOf(st('expired')))} tone={st('expired').length ? 'red' : undefined} onPress={() => setFilter('expired')} />
        <Stat label={`Return / release due (${actionDue.length})`} value={money(sumOf(actionDue))} onPress={() => setFilter('action')} />
      </Grid>
      {type === 'advance_payment' ? <Muted>Open value of advance payment bonds is the balance still to be recovered.</Muted> : null}

      <Card>
        <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
          <View style={{ width: 260, maxWidth: '100%' }}>
            <Select label="Customer" value={customer} searchable onChange={setCustomer} options={[{ value: '', label: `All customers (${customers.length})` }, ...customers.map((c) => ({ value: c, label: c }))]} />
          </View>
          <View style={{ width: 220, maxWidth: '100%' }}>
            <Select label="Bank" value={bank} onChange={setBank} options={[{ value: '', label: 'All banks' }, ...banks.map((c) => ({ value: c, label: c }))]} />
          </View>
          <View style={{ width: 220, maxWidth: '100%' }}>
            <Select label="Owner" value={owner} onChange={setOwner} options={[{ value: '', label: 'All owners' }, ...owners.map((o) => ({ value: o, label: people[o]?.full_name ?? '—' }))]} />
          </View>
        </Row>
      </Card>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: 'Open', badge: scoped.filter(filters.open).length },
          { value: 'expiring', label: 'Expiring ≤ 30 days', badge: scoped.filter(filters.expiring).length },
          { value: 'expired', label: 'Expired – not returned', badge: scoped.filter(filters.expired).length },
          { value: 'action', label: 'Return / release due', badge: scoped.filter(filters.action).length },
          { value: 'closed', label: 'Closed' },
          { value: 'all', label: 'All' },
        ]}
      />

      <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
        <ScrollView horizontal>
          <View>
            <Row gap={0} style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              {cols[type].map((c) => (
                <Text key={c.h} style={[cell, { width: c.w, fontWeight: '700', textAlign: c.right ? 'right' : 'left' }]}>
                  {c.h}
                </Text>
              ))}
              <Text style={[cell, { width: 190, fontWeight: '700' }]}>Status</Text>
            </Row>
            {rows.map((b) => {
              const s = bondStage(b, today);
              const edge = s === 'expired' || s === 'claimed' ? colors.red : s === 'expiring' ? colors.amber : s === 'action' ? colors.blue : 'transparent';
              return (
                <Pressable key={b.id} onPress={() => router.push(`/bonds/${b.id}`)}>
                  <Row gap={0} style={{ borderBottomWidth: 1, borderBottomColor: colors.line, borderLeftWidth: 4, borderLeftColor: edge }}>
                    {cols[type].map((c) => (
                      <Text
                        key={c.h}
                        style={[
                          cell,
                          { width: c.w, textAlign: c.right ? 'right' : 'left' },
                          c.h === 'Days left' && s === 'expired' ? { color: colors.red, fontWeight: '700' } : null,
                          c.h === 'Days left' && s === 'expiring' ? { color: colors.amber, fontWeight: '700' } : null,
                        ]}
                      >
                        {c.v(b)}
                      </Text>
                    ))}
                    <View style={[cell, { width: 190, gap: 4 }]}>
                      <Pill label={BOND_STAGE_LABEL[s]} tone={STAGE_TONE[s]} />
                      {b.extensions ? <Muted>extended {b.extensions}×</Muted> : null}
                    </View>
                  </Row>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        {data && !rows.length ? <Empty title="No bonds here" /> : null}
      </Card>
      <Muted>Left edge: red = expired or claimed, amber = expires within 30 days, blue = return / release due.</Muted>
    </Screen>
  );
}

const cell = { paddingVertical: 8, paddingHorizontal: 8, fontSize: 13 } as const;
