import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Grid, KeyValue, Loading, Muted, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { COMP_BID_SELECT, COMPETITOR_EDITORS, compStats, fmtGap, resultLabel, TENDER_RESULT, type CompBid, type Competitor } from '@/lib/tenders';

/** A competitor's profile: what we know about them, the brands they carry and every tender and quotation we met them in */
export default function CompetitorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, loading, reload } = useLoad(async () => {
    const [c, b] = await Promise.all([
      supabase.from('competitors').select('*').eq('id', id).single(),
      supabase.from('tender_bids').select(COMP_BID_SELECT).eq('competitor_id', id).limit(2000),
    ]);
    if (c.error) throw new Error(c.error.message);
    const bids = ((b.data ?? []) as unknown as CompBid[]).sort((x, y) => (y.tenders.opening_date ?? '').localeCompare(x.tenders.opening_date ?? ''));
    return { c: c.data as Competitor, bids };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { c, bids } = data;
  const s = compStats(bids);
  const canEdit = COMPETITOR_EDITORS.includes(me.role);

  const edit = async () => {
    const r = await dialog.prompt({
      title: `${c.name} – profile`,
      fields: [
        { key: 'b', label: 'Brands they carry', hint: 'Comma separated', initial: (c.brands ?? []).join(', ') },
        { key: 'w', label: 'Website', initial: c.website ?? '' },
        { key: 'n', label: 'What we know', type: 'multiline', hint: 'Agencies, strengths, usual discount, key people, how they price', initial: c.notes ?? '' },
        { key: 'a', label: 'Status', type: 'select', initial: c.active ? 'yes' : 'no', options: [{ value: 'yes', label: 'Active' }, { value: 'no', label: 'No longer active' }] },
      ],
      confirmLabel: 'Save',
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase
        .from('competitors')
        .update({ brands: r.b.split(',').map((x) => x.trim()).filter(Boolean), website: r.w || null, notes: r.n || null, active: r.a !== 'no', updated_by: me.id, updated_at: new Date().toISOString() })
        .eq('id', c.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Saved');
  };

  return (
    <Screen maxWidth={1100} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: c.name }} />
      <Card style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, flexShrink: 1 }}>{c.name}</Text>
          {!c.active ? <Pill label="No longer active" tone={colors.grey} /> : null}
        </Row>
        <KeyValue label="Brands they carry" value={c.brands?.length ? c.brands.join(', ') : '—'} />
        {c.website ? <KeyValue label="Website" value={c.website} /> : null}
        <KeyValue label="What we know" value={c.notes || '—'} />
        {c.updated_by ? <Muted>{`Last updated by ${people[c.updated_by]?.full_name ?? ''} · ${fmtDateTime(c.updated_at)}`}</Muted> : null}
        {canEdit ? (
          <Row style={{ marginTop: 6 }}>
            <Button variant="secondary" title="Change the profile" onPress={edit} />
          </Row>
        ) : null}
      </Card>

      <Grid min={200} max={4}>
        <Stat label="Met us" value={String(s.met)} sub={`${s.tenders} tender${s.tenders === 1 ? '' : 's'} · ${s.quotations} quotation${s.quotations === 1 ? '' : 's'}`} />
        <Stat label="They won" value={String(s.won)} tone={s.won ? 'red' : undefined} sub={`We won ${s.weWon} of these`} />
        <Stat label="Price vs ours (average)" value={fmtGap(s.avgGap)} tone={s.avgGap != null && s.avgGap < 0 ? 'red' : 'green'} sub={s.priced ? `Cheaper than us ${s.cheaper} of ${s.priced} times` : 'No prices to compare yet'} />
        <Stat label="Brands seen in their bids" value={String(s.brands.length)} sub={s.brands.slice(0, 3).map(([b, n]) => `${b} (${n})`).join(', ') || undefined} />
      </Grid>

      <Section title={`Tenders and quotations (${bids.length})`}>
        <DataTable
          rows={bids}
          keyOf={(b) => b.id}
          onPress={(b) => router.push(`/tenders/bid/${b.id}`)}
          edge={(b) => (b.won ? colors.red : TENDER_RESULT[b.tenders.result_status].tone)}
          emptyTitle="Not met in any tender or quotation yet"
          columns={[
            { h: 'Date', w: 95, v: (b) => fmtDate(b.tenders.opening_date) },
            { h: 'Tender / quotation', w: 260, grow: true, v: (b) => `${b.tenders.tender_type === 'quotation' ? 'Quotation ' : ''}${b.tenders.tender_no} · ${b.tenders.tender_name}${b.tenders.client_name ? `\n${b.tenders.client_name}` : ''}` },
            { h: 'Brands', w: 150, v: (b) => b.brands?.join(', ') || '—' },
            { h: 'Their price', w: 140, right: true, v: (b) => (b.bid_price != null ? fmtMoney(b.bid_price, b.tenders.currency) : '—') },
            { h: 'Ours', w: 140, right: true, v: (b) => (b.tenders.our_price != null ? fmtMoney(b.tenders.our_price, b.tenders.currency) : '—') },
            {
              h: 'vs ours',
              w: 80,
              right: true,
              v: (b) => (b.bid_price != null && b.tenders.our_price ? fmtGap(((Number(b.bid_price) - Number(b.tenders.our_price)) / Number(b.tenders.our_price)) * 100) : '—'),
              tone: (b) => (b.bid_price != null && b.tenders.our_price != null && Number(b.bid_price) < Number(b.tenders.our_price) ? colors.red : undefined),
            },
            { h: 'Result', w: 150, v: (b) => (b.won ? <Pill label="They won" tone={colors.red} /> : <Pill label={resultLabel(b.tenders)} tone={TENDER_RESULT[b.tenders.result_status].tone} />) },
          ]}
        />
        <Muted>Tap a row for their item prices and documents in that tender or quotation.</Muted>
      </Section>
    </Screen>
  );
}
