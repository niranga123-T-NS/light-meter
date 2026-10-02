import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { C_TONE, W_TONE } from '@/components/warrantyTones';
import { Button, Card, colors, Empty, ErrorBanner, Grid, ListRow, Muted, Pill, Row, Screen, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Warranty, WarrantyClaim, WarrantyLine, WarrantyReport } from '@/lib/types';
import {
  CLAIM_STAGE_LABEL,
  claimDaysOpen,
  claimStage,
  isWarrantyDesk,
  supplierGapDays,
  viaLabel,
  WARRANTY_STAGE_LABEL,
  warrantyStage,
} from '@/lib/warranty';

type Tab = 'warranties' | 'claims' | 'reports' | 'brands';

/** Warranty tab: completion records / warranties, claims, issues reported from visits and the brand view. */
export default function WarrantyHome() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const [tab, setTab] = useState<Tab>(params.tab ?? 'warranties');
  const [customer, setCustomer] = useState('');
  const [source, setSource] = useState('');
  const [owner, setOwner] = useState('');
  const [claimFilter, setClaimFilter] = useState<'open' | 'mine' | 'closed' | 'all'>(me.role === 'assistant_engineer' ? 'mine' : 'open');
  const { data, error, loading, reload } = useLoad(async () => {
    const [w, l, c, r] = await Promise.all([
      supabase.from('warranties').select('*').order('created_at', { ascending: false }).limit(3000),
      supabase.from('warranty_lines').select('*').order('sort_order').limit(10000),
      supabase.from('warranty_claims').select('*').order('logged_at', { ascending: false }).limit(3000),
      supabase.from('warranty_reports').select('*').order('created_at', { ascending: false }).limit(1000),
    ]);
    if (w.error) throw new Error(w.error.message);
    return {
      warranties: (w.data ?? []) as Warranty[],
      lines: (l.data ?? []) as WarrantyLine[],
      claims: (c.data ?? []) as WarrantyClaim[],
      reports: (r.data ?? []) as WarrantyReport[],
    };
  });
  const today = todayISO();
  const desk = isWarrantyDesk(me.role);
  const sales = isSales(me.role);
  const all = data?.warranties ?? [];
  const linesOf = (id: string) => (data?.lines ?? []).filter((l) => l.warranty_id === id);
  const byId = Object.fromEntries(all.map((w) => [w.id, w]));
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const customers = uniq(all.map((w) => w.customer.trim()));
  const owners = uniq(all.map((w) => w.owner_id ?? ''));
  const inScope = (w?: Warranty) => !!w && (!customer || w.customer.trim() === customer) && (!source || w.source === source) && (!owner || w.owner_id === owner);
  const warranties = all.filter(inScope);
  const activeW = warranties.filter((w) => w.status === 'active');
  const stageOf = (w: Warranty) => warrantyStage(w, linesOf(w.id), today);
  const claims = (data?.claims ?? []).filter((c) => inScope(byId[c.warranty_id]) || (!byId[c.warranty_id] && !customer && !source && !owner));
  const openClaims = claims.filter((c) => c.status === 'open');
  const overdue = openClaims.filter((c) => claimDaysOpen(c, today) >= 14);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const yearClaims = claims.filter((c) => (c.rectified_on ?? '') >= yearStart);
  const sumBy = (list: WarrantyClaim[], f: (c: WarrantyClaim) => number) => {
    const m = { LKR: 0, USD: 0 };
    list.forEach((c) => (m[byId[c.warranty_id]?.currency ?? 'LKR'] += f(c)));
    return [m.LKR ? fmtMoney(m.LKR, 'LKR') : null, m.USD ? fmtMoney(m.USD, 'USD') : null].filter(Boolean).join(' + ') || fmtMoney(0, 'LKR');
  };
  const reports = data?.reports ?? [];
  const waitingReports = reports.filter((r) => r.status === 'reported');
  const claimRows = claims.filter((c) =>
    claimFilter === 'open' ? c.status === 'open' : claimFilter === 'mine' ? c.status === 'open' && (c.assignee_id === me.id || c.reported_by === me.id) : claimFilter === 'closed' ? c.status !== 'open' : true,
  );

  // By brand: claims in the last 12 months
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const brandRows = uniq((data?.lines ?? []).filter((l) => inScope(byId[l.warranty_id])).map((l) => l.brand ?? '—')).map((b) => {
    const ls = (data?.lines ?? []).filter((l) => (l.brand ?? '—') === b && inScope(byId[l.warranty_id]) && byId[l.warranty_id]?.status === 'active');
    const ids = new Set(ls.map((l) => l.id));
    const cs = claims.filter((c) => c.line_id && ids.has(c.line_id) && c.logged_at.slice(0, 10) >= since);
    const units = ls.filter((l) => l.end_date >= today).reduce((a, l) => a + Number(l.quantity ?? 0), 0);
    const failed = cs.reduce((a, c) => a + Number(c.quantity ?? 0), 0);
    return {
      brand: b,
      warranties: new Set(ls.map((l) => l.warranty_id)).size,
      units,
      claims: cs.length,
      failed,
      rate: units ? `${((failed / units) * 100).toFixed(2)}%` : '—',
      cost: sumBy(cs, (c) => Number(c.cost_amount)),
      recovered: sumBy(cs, (c) => Number(c.recovered_amount)),
      gaps: ls.filter((l) => supplierGapDays(l) > 0 && l.end_date >= today).length,
    };
  });

  return (
    <Screen refreshing={loading} onRefresh={reload} maxWidth={1300}>
      <Stack.Screen options={{ title: 'Warranty' }} />
      <ErrorBanner message={error} />
      <Row wrap gap={8} style={{ justifyContent: 'flex-end' }}>
        {sales ? <Button title="Report warranty issue" onPress={() => router.push('/warranty/report')} /> : null}
        {desk ? <Button variant="secondary" title="+ Log claim" onPress={() => router.push('/warranty/claims/new')} /> : null}
        {desk ? <Button title="+ Completion record" onPress={() => router.push('/warranty/edit')} /> : null}
      </Row>

      <Grid min={180}>
        <Stat label="Active warranties" value={activeW.length} onPress={() => setTab('warranties')} />
        <Stat label="Expiring ≤ 90 days" value={activeW.filter((w) => stageOf(w) === 'expiring').length} tone={activeW.some((w) => stageOf(w) === 'expiring') ? 'amber' : undefined} onPress={() => setTab('warranties')} />
        <Stat label="Open claims" value={openClaims.length} onPress={() => { setTab('claims'); setClaimFilter('open'); }} />
        <Stat label="Claims open ≥ 14 days" value={overdue.length} tone={overdue.length ? 'red' : undefined} onPress={() => { setTab('claims'); setClaimFilter('open'); }} />
        <Stat label={`Warranty cost ${today.slice(0, 4)}`} value={sumBy(yearClaims, (c) => Number(c.cost_amount))} />
        <Stat label="Recovered from suppliers" value={sumBy(yearClaims, (c) => Number(c.recovered_amount))} tone="green" />
        {desk || me.role === 'sm_projects' || me.role === 'gm' ? (
          <Stat label="Issues reported from visits" value={waitingReports.length} tone={waitingReports.length ? 'amber' : undefined} onPress={() => setTab('reports')} />
        ) : null}
      </Grid>

      <Card>
        <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
          <View style={{ width: 260, maxWidth: '100%' }}>
            <Select label="Customer" value={customer} searchable onChange={setCustomer} options={[{ value: '', label: `All customers (${customers.length})` }, ...customers.map((c) => ({ value: c, label: c }))]} />
          </View>
          <View style={{ width: 230, maxWidth: '100%' }}>
            <Select
              label="Project"
              value={source}
              onChange={setSource}
              options={[
                { value: '', label: 'System and outside projects' },
                { value: 'system', label: 'Projects in the system' },
                { value: 'outside', label: 'Outside projects' },
              ]}
            />
          </View>
          {!sales ? (
            <View style={{ width: 220, maxWidth: '100%' }}>
              <Select label="Owner" value={owner} onChange={setOwner} options={[{ value: '', label: 'All owners' }, ...owners.map((o) => ({ value: o, label: people[o]?.full_name ?? '—' }))]} />
            </View>
          ) : null}
        </Row>
      </Card>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'warranties', label: 'Warranties', badge: activeW.length },
          { value: 'claims', label: 'Claims', badge: openClaims.length },
          { value: 'reports', label: sales ? 'My reported issues' : 'Reported from visits', badge: waitingReports.length },
          { value: 'brands', label: 'By brand' },
        ]}
      />

      {tab === 'warranties' ? (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
          {warranties.map((w) => {
            const ls = linesOf(w.id);
            const st = stageOf(w);
            const next = ls.filter((l) => l.end_date >= today).map((l) => l.end_date).sort()[0];
            const gaps = ls.filter((l) => supplierGapDays(l) > 0 && l.end_date >= today).length;
            const open = (data?.claims ?? []).filter((c) => c.warranty_id === w.id && c.status === 'open').length;
            return (
              <ListRow
                key={w.id}
                highlight={gaps ? colors.red : st === 'expiring' ? colors.amber : undefined}
                title={`${w.project_name} · ${w.customer}`}
                subtitle={`${w.code} · ${[w.invoice_no, w.contract_no].filter(Boolean).join(' · ')} · ${ls.length} line(s) · ${next ? `next end ${fmtDate(next)}` : 'all lines ended'}${sales ? '' : ` · ${people[w.owner_id ?? '']?.full_name ?? 'no owner'}`}`}
                right={
                  <Row gap={6}>
                    <Pill label={w.source === 'system' ? 'System' : 'Outside'} tone={w.source === 'system' ? colors.blue : colors.grey} />
                    {gaps ? <Pill label={`${gaps} supplier gap${gaps > 1 ? 's' : ''}`} tone={colors.red} /> : null}
                    {open ? <Pill label={`${open} open claim${open > 1 ? 's' : ''}`} tone={colors.amber} /> : null}
                    <Pill label={WARRANTY_STAGE_LABEL[st]} tone={W_TONE[st]} solid />
                  </Row>
                }
                onPress={() => router.push(`/warranty/${w.id}`)}
              />
            );
          })}
          {data && !warranties.length ? <Empty title="No warranties yet" /> : null}
        </Card>
      ) : null}

      {tab === 'claims' ? (
        <>
          <Segmented
            value={claimFilter}
            onChange={setClaimFilter}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'mine', label: me.role === 'assistant_engineer' ? 'Assigned to me' : 'Mine' },
              { value: 'closed', label: 'Closed' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
            {claimRows.map((c) => {
              const w = byId[c.warranty_id];
              const st = claimStage(c);
              const days = claimDaysOpen(c, today);
              return (
                <ListRow
                  key={c.id}
                  highlight={c.status === 'open' && days >= 14 ? colors.red : st === 'inspect' || st === 'assign' ? colors.amber : undefined}
                  title={`${c.code} · ${w?.project_name ?? '—'} · ${w?.customer ?? ''}`}
                  subtitle={`${c.description}\n${viaLabel(c.reported_via)} · logged ${fmtDate(c.logged_at)}${c.status === 'open' ? ` · ${days} days open` : ''} · ${people[c.assignee_id ?? '']?.full_name ?? 'not assigned'}${w ? ` · ${[w.invoice_no, w.contract_no].filter(Boolean).join(' · ')}` : ''}`}
                  right={
                    <Row gap={6}>
                      <Pill label={c.in_warranty ? 'In warranty' : 'Out of warranty'} tone={c.in_warranty ? colors.green : colors.red} />
                      <Pill label={CLAIM_STAGE_LABEL[st]} tone={C_TONE[st]} solid />
                    </Row>
                  }
                  onPress={() => router.push(`/warranty/claims/${c.id}`)}
                />
              );
            })}
            {data && !claimRows.length ? <Empty title="No claims here" /> : null}
          </Card>
        </>
      ) : null}

      {tab === 'reports' ? (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
          {reports.map((r) => (
            <ListRow
              key={r.id}
              highlight={r.status === 'reported' ? colors.amber : undefined}
              title={`${r.customer}${r.project_name ? ` · ${r.project_name}` : ''}`}
              subtitle={`${r.description}${r.quantity ? ` · qty ${r.quantity}` : ''}${r.location ? ` · ${r.location}` : ''}\n${r.code} · ${fmtDateTime(r.created_at)} · by ${people[r.sales_person_id]?.full_name ?? '—'}${r.dismiss_reason ? ` · closed: ${r.dismiss_reason}` : ''}`}
              right={
                <Row gap={6}>
                  {desk && r.status === 'reported' ? (
                    <>
                      <Button small title="Enter claim" onPress={() => router.push({ pathname: '/warranty/claims/new', params: { report: r.id } })} />
                      <Button
                        small
                        variant="ghost"
                        title="Close"
                        onPress={async () => {
                          const x = await dialog.prompt({ title: 'Close this report without a claim', fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }] });
                          if (x) await dialog.run(async () => { await rpc('dismiss_warranty_report', { p_id: r.id, p_reason: x.r }); await reload(); }, 'Closed – sales person told');
                        }}
                      />
                    </>
                  ) : (
                    <Pill label={r.status === 'reported' ? 'Waiting' : r.status === 'converted' ? 'Claim opened' : 'Closed'} tone={r.status === 'reported' ? colors.amber : r.status === 'converted' ? colors.green : colors.grey} />
                  )}
                </Row>
              }
              onPress={r.claim_id ? () => router.push(`/warranty/claims/${r.claim_id}`) : undefined}
            />
          ))}
          {data && !reports.length ? <Empty title="No issues reported from visits" /> : null}
        </Card>
      ) : null}

      {tab === 'brands' ? (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
          <ScrollView horizontal>
            <View>
              <Row gap={0} style={{ backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                {['Brand', 'Warranties', 'Units under warranty', 'Claims (12 mo)', 'Units failed', 'Failure rate', 'Cost to DIMO', 'Recovered', 'Supplier gaps'].map((h, i) => (
                  <Text key={h} style={[cell, { width: i === 0 ? 170 : i >= 6 && i <= 7 ? 170 : 110, fontWeight: '700', textAlign: i ? 'right' : 'left' }]}>
                    {h}
                  </Text>
                ))}
              </Row>
              {brandRows.map((b) => (
                <Row key={b.brand} gap={0} style={{ borderBottomWidth: 1, borderBottomColor: colors.line }}>
                  <Text style={[cell, { width: 170, fontWeight: '600' }]}>{b.brand}</Text>
                  {[b.warranties, b.units.toLocaleString('en-US'), b.claims, b.failed.toLocaleString('en-US'), b.rate].map((v, i) => (
                    <Text key={i} style={[cell, { width: 110, textAlign: 'right' }]}>
                      {String(v)}
                    </Text>
                  ))}
                  <Text style={[cell, { width: 170, textAlign: 'right' }]}>{b.cost}</Text>
                  <Text style={[cell, { width: 170, textAlign: 'right' }]}>{b.recovered}</Text>
                  <Text style={[cell, { width: 110, textAlign: 'right' }, b.gaps ? { color: colors.red, fontWeight: '700' } : null]}>{b.gaps ? `${b.gaps} line(s)` : '—'}</Text>
                </Row>
              ))}
            </View>
          </ScrollView>
          {data && !brandRows.length ? <Empty title="No warranty lines yet" /> : null}
        </Card>
      ) : null}
      <Muted>Red edge: supplier warranty ends before ours, or a claim open 14 days or more. Amber: expiring within 90 days, or waiting for assignment / inspection.</Muted>
    </Screen>
  );
}

const cell = { paddingVertical: 8, paddingHorizontal: 8, fontSize: 13 } as const;
