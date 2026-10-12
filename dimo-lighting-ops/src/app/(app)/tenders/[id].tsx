import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { isQuote, resultLabel, TENDER_EDITORS, TENDER_RESULT, TENDER_TYPES, tenderClient, tenderProject, type Tender, type TenderBid } from '@/lib/tenders';

const num = (v?: string) => (v ? Number(v.replace(/,/g, '')) : null);

/** One tender or quotation result: the tender / quotation, our bid and position, the BOQ (required) and the competitors – tap a competitor for their brands and item prices */
export default function TenderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const [t, b, c, boq] = await Promise.all([
      supabase.from('tenders').select('*').eq('id', id).single(),
      supabase.from('tender_bids').select('*').eq('tender_id', id),
      supabase.from('competitors').select('id, name, active').order('name'),
      supabase.from('attachments').select('id').eq('entity_type', 'tender').eq('entity_id', id).eq('kind', 'tender_boq').limit(1),
    ]);
    if (t.error) throw new Error(t.error.message);
    const tender = t.data as Tender;
    const [org, proj] = await Promise.all([
      tender.client_organization_id ? supabase.from('organizations').select('name').eq('id', tender.client_organization_id).maybeSingle() : Promise.resolve({ data: null }),
      tender.project_id ? supabase.from('projects').select('name').eq('id', tender.project_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return {
      t: tender,
      bids: (b.data ?? []) as TenderBid[],
      comps: (c.data ?? []) as { id: number; name: string; active: boolean }[],
      hasBoq: (boq.data ?? []).length > 0,
      orgName: (org.data as { name: string } | null)?.name ?? null,
      projName: (proj.data as { name: string } | null)?.name ?? null,
    };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { t, bids, comps } = data;
  const canEdit = TENDER_EDITORS.includes(me.role) || t.sales_person_id === me.id;
  const comp = (cid: number) => comps.find((c) => c.id === cid)?.name ?? '—';
  const priced = bids.filter((b) => b.compliant && b.bid_price != null).map((b) => Number(b.bid_price));
  const lowest = priced.length ? Math.min(...priced, ...(t.our_price != null ? [Number(t.our_price)] : [])) : t.our_price;
  const rank = t.our_price != null ? 1 + priced.filter((p) => p < Number(t.our_price)).length : null;
  const sorted = [...bids].sort((a, b) => Number(a.bid_price ?? 9e15) - Number(b.bid_price ?? 9e15));
  const res = TENDER_RESULT[t.result_status];
  const quote = isQuote(t);

  const addBidder = async () => {
    const r = await dialog.prompt({
      title: 'Add a competitor',
      fields: [
        { key: 'c', label: 'Competitor (pick from the list)', type: 'select', options: comps.filter((c) => c.active && !bids.some((b) => b.competitor_id === c.id)).map((c) => ({ value: String(c.id), label: c.name })) },
        { key: 'n', label: '…or a new competitor name', hint: 'Only when they are not in the list' },
        { key: 'p', label: `Bid price (${t.currency})`, hint: 'Leave empty if not known yet' },
        { key: 'b', label: 'Brand(s)', hint: 'Comma separated' },
        { key: 'ok', label: 'Compliant', type: 'select', initial: 'yes', options: [{ value: 'yes', label: 'Compliant' }, { value: 'no', label: 'Not compliant' }] },
        { key: 'r', label: 'Remarks', type: 'multiline' },
      ],
      confirmLabel: 'Add',
    });
    if (!r) return;
    await dialog.run(async () => {
      let cid = r.c ? Number(r.c) : null;
      if (!cid && r.n?.trim()) {
        const ex = comps.find((c) => c.name.toLowerCase() === r.n.trim().toLowerCase());
        if (ex) cid = ex.id;
        else {
          const { data: nc, error: e } = await supabase.from('competitors').insert({ name: r.n.trim(), created_by: me.id }).select('id').single();
          if (e) throw new Error(e.message);
          cid = nc.id;
        }
      }
      if (!cid) throw new Error('Pick the competitor or type a new name');
      const { data: nb, error: e } = await supabase
        .from('tender_bids')
        .insert({ tender_id: t.id, competitor_id: cid, bid_price: num(r.p), brands: (r.b ?? '').split(',').map((x) => x.trim()).filter(Boolean), compliant: r.ok !== 'no', remarks: r.r || null, updated_by: me.id })
        .select('id')
        .single();
      if (e) throw new Error(e.message);
      await reload();
      router.push(`/tenders/bid/${nb.id}`);
    }, 'Added – add their brands and item prices here');
  };

  return (
    <Screen maxWidth={1000} onRefresh={reload}>
      <Stack.Screen options={{ title: quote ? `Quotation ${t.tender_no}` : t.tender_no }} />
      <Card style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, flexShrink: 1 }}>{`${t.tender_no} · ${t.tender_name}`}</Text>
          <Pill label={resultLabel(t)} tone={res.tone} solid />
        </Row>
        <KeyValue label="Client" value={tenderClient(t, data.orgName)} />
        <KeyValue label="Project" value={tenderProject(t, data.projName)} />
        <KeyValue
          label={quote ? 'Quotation' : 'Tender'}
          value={
            quote
              ? `Submitted ${fmtDate(t.closing_date)} · result ${fmtDate(t.opening_date)} · ${t.currency}`
              : `${TENDER_TYPES.find((x) => x.value === t.tender_type)?.label ?? t.tender_type} · closed ${fmtDate(t.closing_date)} · opened ${fmtDate(t.opening_date)} · ${t.currency}`
          }
        />
        <KeyValue
          label={quote ? 'Our price' : 'Our bid'}
          value={`${t.our_price != null ? fmtMoney(t.our_price, t.currency) : '—'}${t.our_brands?.length ? ` · ${t.our_brands.join(', ')}` : ''}${rank ? ` · position L${rank}` : ''}${lowest != null && t.our_price != null && rank && rank > 1 ? ` · ${(((Number(t.our_price) - lowest) / Number(t.our_price)) * 100).toFixed(1)}% above the lowest` : ''}`}
        />
        {t.lost_reason ? <KeyValue label="Lost reason" value={t.lost_reason} /> : null}
        {t.evaluation_notes ? <KeyValue label="Evaluation notes" value={t.evaluation_notes} /> : null}
        <Muted>{`${t.inquiry_id ? 'From the inquiry and its quotation' : t.visit_id ? 'From the sales person’s tender visit' : 'Entered in the register'}${t.sales_person_id ? ` · sales person ${people[t.sales_person_id]?.full_name ?? ''}` : ''}${t.entered_by ? ` · entered by ${people[t.entered_by]?.full_name ?? ''}` : ''}`}</Muted>
        <Row gap={8} wrap style={{ marginTop: 6 }}>
          {canEdit ? <Button variant="secondary" title="Change" onPress={() => router.push({ pathname: '/tenders/edit', params: { id: t.id } })} /> : null}
          {t.inquiry_id ? <Button variant="ghost" title="Open the inquiry" onPress={() => router.push(`/inquiries/${t.inquiry_id}`)} /> : null}
          {t.visit_id && (t.sales_person_id === me.id || me.role === 'sm_projects') ? <Button variant="ghost" title="Open the tender visit" onPress={() => router.push(`/visits/${t.visit_id}`)} /> : null}
        </Row>
      </Card>

      {!data.hasBoq ? <Notice tone={colors.amber}>{quote ? 'Attach the BOQ the client sent – it is needed to compare the item prices.' : 'The tender BOQ is required – attach it below.'}</Notice> : null}
      <Attachments entityType="tender" entityId={t.id} kinds={['tender_boq', 'tender_doc']} title={quote ? 'BOQ and documents' : 'Tender BOQ and documents'} canUpload={canEdit} onChange={reload} />

      <Section title={`Competitors (${bids.length})`} right={canEdit ? <Button small title="+ Competitor" onPress={addBidder} /> : null}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {t.our_price != null ? (
            <ListRow title="DIMO (us)" subtitle={(t.our_brands ?? []).join(', ') || undefined} right={<Text style={{ fontWeight: '700', color: colors.ink }}>{fmtMoney(t.our_price, t.currency)}</Text>} highlight={colors.blue} />
          ) : null}
          {sorted.map((b) => (
            <ListRow
              key={b.id}
              title={comp(b.competitor_id)}
              subtitle={[b.won ? 'Won the order' : null, b.brands?.length ? b.brands.join(', ') : null, b.compliant ? null : 'Not compliant', b.remarks].filter(Boolean).join(' · ') || 'Tap to add brands and item prices'}
              right={<Text style={{ fontWeight: '700', color: b.compliant ? colors.ink : colors.muted }}>{b.bid_price != null ? fmtMoney(b.bid_price, t.currency) : 'price not known'}</Text>}
              highlight={b.won ? colors.red : undefined}
              onPress={() => router.push(`/tenders/bid/${b.id}`)}
            />
          ))}
          {!bids.length ? <ListRow title="No competitors yet" subtitle={canEdit ? 'Add each bidder with their price' : undefined} /> : null}
        </Card>
      </Section>
    </Screen>
  );
}
