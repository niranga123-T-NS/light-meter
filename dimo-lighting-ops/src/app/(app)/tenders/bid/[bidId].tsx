import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { isQuote, TENDER_EDITORS, type BidLine, type Tender, type TenderBid } from '@/lib/tenders';

const num = (v?: string) => (v ? Number(v.replace(/,/g, '')) : null);

/** A competitor's bid in one tender: price, brands, compliance, item-by-item prices and their documents – updated as more is learned */
export default function BidScreen() {
  const { bidId } = useLocalSearchParams<{ bidId: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: b, error: e } = await supabase.from('tender_bids').select('*').eq('id', bidId).single();
    if (e) throw new Error(e.message);
    const bid = b as TenderBid;
    const [t, c, l] = await Promise.all([
      supabase.from('tenders').select('*').eq('id', bid.tender_id).single(),
      supabase.from('competitors').select('name').eq('id', bid.competitor_id).single(),
      supabase.from('tender_bid_lines').select('*').eq('bid_id', bidId).order('seq'),
    ]);
    return { bid, t: t.data as Tender, name: (c.data as { name: string } | null)?.name ?? '—', lines: (l.data ?? []) as BidLine[] };
  }, [bidId]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { bid, t, lines } = data;
  const cur = t.currency;
  const canEdit = TENDER_EDITORS.includes(me.role) || t.sales_person_id === me.id;
  const total = lines.reduce((s, l) => s + Number(l.qty ?? 0) * Number(l.unit_price ?? 0), 0);
  const both = lines.filter((l) => l.unit_price != null && l.our_unit_price != null && l.qty != null);
  const oursTotal = both.reduce((s, l) => s + Number(l.qty) * Number(l.our_unit_price), 0);
  const theirsTotal = both.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
  const diff = (theirs: number, ours: number) => (ours ? `${theirs >= ours ? '+' : ''}${(((theirs - ours) / ours) * 100).toFixed(1)}%` : '—');
  const run = (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) =>
    dialog.run(async () => {
      const { error: e } = await fn();
      if (e) throw new Error(e.message);
      await reload();
    }, ok);

  const editBid = async () => {
    const r = await dialog.prompt({
      title: `${data.name} – bid`,
      fields: [
        { key: 'p', label: `Bid price (${cur})`, initial: bid.bid_price != null ? String(bid.bid_price) : '' },
        { key: 'b', label: 'Brand(s)', hint: 'Comma separated', initial: (bid.brands ?? []).join(', ') },
        { key: 'won', label: isQuote(t) ? 'Did they get the order?' : 'Were they awarded?', type: 'select', initial: bid.won ? 'yes' : 'no', options: [{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes – they won it' }] },
        { key: 'ok', label: 'Compliant', type: 'select', initial: bid.compliant ? 'yes' : 'no', options: [{ value: 'yes', label: 'Compliant' }, { value: 'no', label: 'Not compliant' }] },
        { key: 'd', label: 'Delivery period', initial: bid.delivery_period ?? '' },
        { key: 'v', label: 'Validity', initial: bid.validity ?? '' },
        { key: 'r', label: 'Remarks', type: 'multiline', initial: bid.remarks ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (r)
      await run(
        () =>
          supabase
            .from('tender_bids')
            .update({ won: r.won === 'yes', bid_price: num(r.p), brands: r.b.split(',').map((x) => x.trim()).filter(Boolean), compliant: r.ok !== 'no', delivery_period: r.d || null, validity: r.v || null, remarks: r.r || null, updated_by: me.id, updated_at: new Date().toISOString() })
            .eq('id', bid.id),
        'Saved',
      );
  };
  const lineDialog = async (l?: BidLine) => {
    const r = await dialog.prompt({
      title: l ? 'Change the item' : 'Add an item',
      fields: [
        { key: 'item', label: 'Item / description', required: true, initial: l?.item ?? '' },
        { key: 'brand', label: 'Brand', initial: l?.brand ?? '' },
        { key: 'model', label: 'Model', initial: l?.model ?? '' },
        { key: 'qty', label: 'Quantity', initial: l?.qty != null ? String(l.qty) : '' },
        { key: 'unit', label: 'Unit', initial: l?.unit ?? 'nos' },
        { key: 'price', label: `Their unit price (${cur})`, initial: l?.unit_price != null ? String(l.unit_price) : '' },
        { key: 'ours', label: `Our unit price (${cur})`, hint: 'For comparison – from our quotation', initial: l?.our_unit_price != null ? String(l.our_unit_price) : '' },
        { key: 'rem', label: 'Remarks', initial: l?.remarks ?? '' },
      ],
      confirmLabel: l ? 'Save' : 'Add',
    });
    if (!r) return;
    const row = { item: r.item.trim(), brand: r.brand || null, model: r.model || null, qty: num(r.qty), unit: r.unit || null, unit_price: num(r.price), our_unit_price: num(r.ours), remarks: r.rem || null, updated_by: me.id, updated_at: new Date().toISOString() };
    await run(
      () => (l ? supabase.from('tender_bid_lines').update(row).eq('id', l.id) : supabase.from('tender_bid_lines').insert({ ...row, bid_id: bid.id, seq: (lines.at(-1)?.seq ?? 0) + 1 })),
      l ? 'Saved' : 'Added',
    );
  };
  const removeLine = async (l: BidLine) => {
    if (await dialog.confirm('Remove this item?', l.item, { danger: true, confirmLabel: 'Remove' })) await run(() => supabase.from('tender_bid_lines').delete().eq('id', l.id), 'Removed');
  };

  return (
    <Screen maxWidth={1100} onRefresh={reload}>
      <Stack.Screen options={{ title: data.name }} />
      <Card style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, flexShrink: 1 }}>{data.name}</Text>
          <Row gap={6}>
            {bid.won ? <Pill label="Won the order" tone={colors.red} solid /> : null}
            {!bid.compliant ? <Pill label="Not compliant" tone={colors.red} /> : null}
          </Row>
        </Row>
        <Muted>{`${isQuote(t) ? 'Quotation ' : ''}${t.tender_no} · ${t.tender_name}${t.our_price != null && bid.bid_price != null ? ` · ${diff(Number(bid.bid_price), Number(t.our_price))} against our ${fmtMoney(t.our_price, cur)}` : ''}`}</Muted>
        <KeyValue label="Bid price" value={bid.bid_price != null ? fmtMoney(bid.bid_price, cur) : 'Not known yet'} />
        <KeyValue label="Brand(s)" value={bid.brands?.length ? bid.brands.join(', ') : '—'} />
        {bid.delivery_period || bid.validity ? <KeyValue label="Delivery · validity" value={`${bid.delivery_period ?? '—'} · ${bid.validity ?? '—'}`} /> : null}
        {bid.remarks ? <KeyValue label="Remarks" value={bid.remarks} /> : null}
        {bid.updated_by ? <Muted>{`Last updated by ${people[bid.updated_by]?.full_name ?? ''} · ${fmtDateTime(bid.updated_at)}`}</Muted> : null}
        {canEdit ? (
          <Row style={{ marginTop: 6 }}>
            <Button variant="secondary" title="Change price, brands, remarks" onPress={editBid} />
            <Button variant="ghost" title={`${data.name} – profile`} onPress={() => router.push(`/competitors/${bid.competitor_id}`)} />
          </Row>
        ) : (
          <Row style={{ marginTop: 6 }}>
            <Button variant="ghost" title={`${data.name} – profile`} onPress={() => router.push(`/competitors/${bid.competitor_id}`)} />
          </Row>
        )}
      </Card>

      <Section title={`Item prices (${lines.length})`} right={canEdit ? <Button small title="+ Item" onPress={() => lineDialog()} /> : null}>
        <DataTable
          rows={lines}
          keyOf={(l) => l.id}
          onPress={canEdit ? (l) => lineDialog(l) : undefined}
          emptyTitle="No item prices yet"
          footer={lines.length ? ['', 'Total of the items', '', '', '', fmtMoney(total, cur), '', both.length ? diff(theirsTotal, oursTotal) : '', ...(canEdit ? [''] : [])] : undefined}
          columns={[
            { h: '#', w: 40, v: (l) => String(l.seq) },
            { h: 'Item', w: 220, grow: true, v: (l) => l.item + (l.remarks ? `\n${l.remarks}` : '') },
            { h: 'Brand · model', w: 150, v: (l) => [l.brand, l.model].filter(Boolean).join(' · ') || '—' },
            { h: 'Qty', w: 80, right: true, v: (l) => (l.qty != null ? `${fmtNumber(l.qty, 0)} ${l.unit ?? ''}` : '—') },
            { h: 'Their unit price', w: 120, right: true, v: (l) => (l.unit_price != null ? fmtMoney(l.unit_price, cur) : '—') },
            { h: 'Amount', w: 130, right: true, v: (l) => (l.qty != null && l.unit_price != null ? fmtMoney(Number(l.qty) * Number(l.unit_price), cur) : '—') },
            { h: 'Our unit price', w: 120, right: true, v: (l) => (l.our_unit_price != null ? fmtMoney(l.our_unit_price, cur) : '—') },
            {
              h: 'vs ours',
              w: 70,
              right: true,
              v: (l) =>
                l.unit_price != null && l.our_unit_price != null ? (
                  <Text style={{ fontWeight: '700', color: Number(l.unit_price) < Number(l.our_unit_price) ? colors.red : colors.green }}>{diff(Number(l.unit_price), Number(l.our_unit_price))}</Text>
                ) : (
                  '—'
                ),
            },
            ...(canEdit ? [{ h: '', w: 80, v: (l: BidLine) => <Button small variant="ghost" title="Remove" onPress={() => removeLine(l)} /> }] : []),
          ]}
        />
        <Muted>Tap an item to change it. Their prices are as the competitor quoted them; “vs ours” is red where they were cheaper than us, green where we were cheaper.</Muted>
      </Section>

      <Attachments entityType="tender_bid" entityId={bid.id} kinds={['competitor_prices', 'tender_doc']} title="Their price schedule and documents" canUpload={canEdit} />
    </Screen>
  );
}
