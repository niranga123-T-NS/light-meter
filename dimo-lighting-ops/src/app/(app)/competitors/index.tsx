import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { colors, ErrorBanner, Field, Loading, Muted, Screen } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { COMP_BID_SELECT, compStats, fmtGap, type CompBid, type Competitor } from '@/lib/tenders';

/** Competitors: everyone we met in tenders and quotations – how often, how often they won, their price against ours and their brands */
export default function CompetitorList() {
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(async () => {
    const [c, b] = await Promise.all([supabase.from('competitors').select('*').order('name'), supabase.from('tender_bids').select(COMP_BID_SELECT).limit(5000)]);
    if (c.error) throw new Error(c.error.message);
    return { comps: (c.data ?? []) as Competitor[], bids: (b.data ?? []) as unknown as CompBid[] };
  }, []);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const ql = q.trim().toLowerCase();
  const rows = data.comps
    .map((c) => ({ c, s: compStats(data.bids.filter((b) => b.competitor_id === c.id)) }))
    .filter(({ c, s }) => (s.met > 0 || c.active) && (!ql || `${c.name} ${(c.brands ?? []).join(' ')} ${s.brands.map((x) => x[0]).join(' ')}`.toLowerCase().includes(ql)))
    .sort((a, b) => b.s.met - a.s.met || a.c.name.localeCompare(b.c.name));
  return (
    <Screen maxWidth={1100} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Competitors' }} />
      <Muted>Every competitor met in tenders and quotations. “Price vs ours” is their average price against ours where both are known – minus means they were cheaper.</Muted>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Competitor or brand" />
      <DataTable
        rows={rows}
        keyOf={(r) => String(r.c.id)}
        onPress={(r) => router.push(`/competitors/${r.c.id}`)}
        emptyTitle="No competitors"
        columns={[
          { h: 'Competitor', w: 220, grow: true, v: (r) => r.c.name + (r.c.notes ? `\n${r.c.notes}` : '') },
          { h: 'Brands', w: 200, v: (r) => [...new Set([...(r.c.brands ?? []), ...r.s.brands.map((x) => x[0])])].slice(0, 4).join(', ') || '—' },
          { h: 'Met', w: 70, right: true, v: (r) => String(r.s.met) },
          { h: 'They won', w: 80, right: true, v: (r) => String(r.s.won) },
          { h: 'We won', w: 80, right: true, v: (r) => String(r.s.weWon) },
          { h: 'Price vs ours', w: 110, right: true, v: (r) => fmtGap(r.s.avgGap), tone: (r) => (r.s.avgGap != null && r.s.avgGap < 0 ? colors.red : undefined) },
        ]}
      />
    </Screen>
  );
}
