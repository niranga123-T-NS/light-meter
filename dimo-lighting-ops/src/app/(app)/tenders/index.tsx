import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { Button, colors, ErrorBanner, Field, Loading, Muted, Pill, Row, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { TENDER_EDITORS, TENDER_RESULT, tenderClient, tenderProject, type Tender, type TenderBid } from '@/lib/tenders';

type Filter = 'all' | 'opened' | 'won' | 'lost' | 'noboq';

/** Tender results: every tender with our price, the bidders, the result and its BOQ – also past tenders entered by the Estimation team */
export default function TenderList() {
  const me = useMe();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(async () => {
    const t = await supabase.from('tenders').select('*').order('opening_date', { ascending: false }).limit(2000);
    if (t.error) throw new Error(t.error.message);
    const rows = (t.data ?? []) as Tender[];
    const ids = rows.map((r) => r.id);
    const [b, a, c] = await Promise.all([
      ids.length ? supabase.from('tender_bids').select('tender_id, bid_price, compliant').in('tender_id', ids) : Promise.resolve({ data: [] }),
      ids.length ? supabase.from('attachments').select('entity_id').eq('entity_type', 'tender').eq('kind', 'tender_boq').in('entity_id', ids) : Promise.resolve({ data: [] }),
      supabase.from('competitors').select('id, name'),
    ]);
    return {
      rows,
      bids: (b.data ?? []) as Pick<TenderBid, 'tender_id' | 'bid_price' | 'compliant'>[],
      boq: new Set(((a.data ?? []) as { entity_id: string }[]).map((x) => x.entity_id)),
      comps: (c.data ?? []) as { id: number; name: string }[],
    };
  }, []);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const canAdd = TENDER_EDITORS.includes(me.role);
  const ql = q.trim().toLowerCase();
  const lowest = (t: Tender) => {
    const p = data.bids.filter((b) => b.tender_id === t.id && b.compliant && b.bid_price != null).map((b) => Number(b.bid_price));
    return p.length ? Math.min(...p) : null;
  };
  const rank = (t: Tender) => {
    if (t.our_price == null) return null;
    const p = data.bids.filter((b) => b.tender_id === t.id && b.compliant && b.bid_price != null).map((b) => Number(b.bid_price));
    return 1 + p.filter((x) => x < Number(t.our_price)).length;
  };
  const shown = data.rows.filter(
    (t) =>
      (filter === 'all' ||
        (filter === 'opened' && t.result_status === 'opened') ||
        (filter === 'won' && t.result_status === 'awarded_to_us') ||
        (filter === 'lost' && t.result_status === 'awarded_to_competitor') ||
        (filter === 'noboq' && !data.boq.has(t.id))) &&
      (!ql || `${t.tender_no} ${t.tender_name} ${t.client_name ?? ''} ${t.project_name ?? ''}`.toLowerCase().includes(ql)),
  );
  return (
    <Screen maxWidth={1200} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Tender results' }} />
      <Muted>
        Every tender with our price, the other bidders and the result. Sales record them from the tender visit; the Estimation team can add past tenders, attach the BOQ
        and fill in the competitors’ brands and item prices as they learn more – tap a tender, then a competitor.
      </Muted>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'opened', label: 'Awaiting result' },
            { value: 'won', label: 'Won' },
            { value: 'lost', label: 'Lost' },
            { value: 'noboq', label: 'BOQ missing', badge: data.rows.filter((t) => !data.boq.has(t.id)).length },
          ]}
        />
        {canAdd ? <Button title="+ Tender result" onPress={() => router.push('/tenders/edit')} /> : null}
      </Row>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Tender no., name, client or project" />
      <DataTable
        rows={shown}
        keyOf={(t) => t.id}
        onPress={(t) => router.push(`/tenders/${t.id}`)}
        edge={(t) => TENDER_RESULT[t.result_status].tone}
        emptyTitle="No tender results"
        columns={[
          { h: 'Opened', w: 95, v: (t) => fmtDate(t.opening_date) },
          { h: 'Tender', w: 260, grow: true, v: (t) => `${t.tender_no} · ${t.tender_name}\n${tenderClient(t)} · ${tenderProject(t)}` },
          { h: 'Our price', w: 140, right: true, v: (t) => (t.our_price != null ? fmtMoney(t.our_price, t.currency) : '—') },
          { h: 'Lowest bid', w: 140, right: true, v: (t) => (lowest(t) != null ? fmtMoney(lowest(t), t.currency) : '—') },
          { h: 'Position', w: 70, right: true, v: (t) => (rank(t) ? `L${rank(t)}` : '—') },
          { h: 'Result', w: 180, v: (t) => <Pill label={TENDER_RESULT[t.result_status].label} tone={TENDER_RESULT[t.result_status].tone} /> },
          { h: 'BOQ', w: 90, v: (t) => (data.boq.has(t.id) ? <Pill label="Attached" tone={colors.green} /> : <Pill label="Missing" tone={colors.amber} />) },
        ]}
      />
    </Screen>
  );
}
