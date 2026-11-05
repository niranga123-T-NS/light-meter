import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, Field, Loading, MultiSelect, Muted, Notice, Row, Screen, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { LINES } from '@/lib/finance';
import { fmtDate, fmtMoney, human, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { rpc } from '@/lib/supabase';

type Inq = { id: string; code: string; name: string | null; customer: string | null; sales_person_id: string | null; currency: 'LKR' | 'USD' | null; result: string | null; status: string };
type Sec = { id: string; code: string | null; name: string; customer: string | null; order_value: number | null; source: string; won_on: string; sales_person_id: string | null; business_line: string | null; po_no: string | null };
type Opts = { inquiries: Inq[]; secured: Sec[]; areas: string[] };
type Kind = 'supply' | 'supply_install';

/** Estimation › Send an earlier award to order: a project or inquiry won before the system goes straight to the supply order (Supply only)
 *  or to the hand-over to execution (Supply & installation) – without estimation, design or an offer. SM Estimation (and the DGM). */
export default function EarlierAward() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const allowed = me.role === 'sm_estimation' || me.role === 'gm';
  const { data, error } = useLoad(() => (allowed ? rpc<Opts>('earlier_award_options') : Promise.resolve(null)), [allowed]);
  const [f, setF] = useState({ inquiry: '', name: '', customer: '', sales: '', line: '', po: '', value: '', currency: 'LKR', won: '' as string | null, type: 'supply' as Kind,
    book: 'link' as 'link' | 'add', secured: '', mfr: '1', needed: null as string | null, site: '', start: null as string | null, end: null as string | null, see: '', areas: [] as string[], note: '' });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const sales = useMemo(() => Object.values(people).filter((p) => isSales(p.role) && p.active !== false).sort((a, b) => a.full_name.localeCompare(b.full_name)), [people]);
  const sees = useMemo(() => Object.values(people).filter((p) => p.role === 'senior_elec_engineer' && p.active !== false), [people]);

  if (!allowed) return <Screen><Notice>Sending an earlier award to order is for SM Estimation.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;

  const pickInquiry = (id: string) => {
    const i = data.inquiries.find((x) => x.id === id);
    set({ inquiry: id, ...(i ? { name: f.name || i.name || '', customer: f.customer || i.customer || '', sales: f.sales || i.sales_person_id || '', currency: i.currency ?? 'LKR' } : {}) });
  };
  const pickSecured = (id: string) => {
    const s = data.secured.find((x) => x.id === id);
    set({ secured: id, ...(s ? { name: f.name || s.name, customer: f.customer || s.customer || '', sales: f.sales || s.sales_person_id || '', line: f.line || s.business_line || '', po: f.po || s.po_no || '',
      value: f.value || (s.order_value != null ? String(s.order_value) : ''), currency: s.order_value != null ? 'LKR' : f.currency, won: f.won || s.won_on } : {}) });
  };
  const send = () =>
    dialog.run(async () => {
      if (f.book === 'link' && !f.secured) throw new Error('Choose the order-book entry, or Add it to the order book');
      const r = await rpc<{ kind: 'supply_order' | 'exec_request'; id: string }>('send_earlier_award', {
        p: {
          inquiry_id: f.inquiry || null, project_name: f.name, customer: f.customer, sales_person_id: f.sales || null, business_line: f.line || null, po_no: f.po,
          order_value: f.value.replace(/[^\d.]/g, ''), currency: f.currency, won_on: f.won, type: f.type, secured_id: f.book === 'link' ? f.secured : null,
          mfr_count: f.mfr, needed_by: f.needed, site_address: f.site, start_date: f.start, end_date: f.end, see_id: f.see || null, areas: f.areas, note: f.note,
        },
      });
      router.replace(r.kind === 'supply_order' ? `/supply-orders/${r.id}` : `/execution/handover/${r.id}`);
    }, f.type === 'supply' ? 'Supply order opened – enter the PIs' : 'Hand-over sent to SM Projects');

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Earlier award to order' }} />
      <Card style={{ gap: 4 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }}>Send an earlier award to order</Text>
        <Muted>For projects or inquiries awarded before the system – straight to the supply order (Supply only) or the hand-over to execution (Supply &amp; installation), without estimation, design or an offer.</Muted>
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontWeight: '800', color: colors.ink }}>1 · The award</Text>
        <Select label="Inquiry in the system (optional – it is marked Won)" value={f.inquiry} searchable onChange={pickInquiry}
          options={[{ value: '', label: 'Not in the system – type the details' }, ...data.inquiries.map((i) => ({ value: i.id, label: `${i.code} · ${i.name ?? ''}`, hint: [i.customer, human(i.status)].filter(Boolean).join(' · ') }))]} />
        <Row wrap gap={8}>
          <View style={{ flex: 1, minWidth: 240 }}><Field label="Project name" required value={f.name} onChangeText={(v) => set({ name: v })} /></View>
          <View style={{ flex: 1, minWidth: 240 }}><Field label="Customer" required value={f.customer} onChangeText={(v) => set({ customer: v })} /></View>
        </Row>
        <Row wrap gap={8}>
          <View style={{ flex: 1, minWidth: 200 }}><Field label="Client PO / contract no." value={f.po} onChangeText={(v) => set({ po: v })} /></View>
          <View style={{ flex: 1, minWidth: 160 }}><Field label="Order value (without VAT)" required keyboardType="numeric" value={f.value} onChangeText={(v) => set({ value: v })} /></View>
          <View style={{ width: 120 }}><Select label="Currency" value={f.currency} onChange={(v) => set({ currency: v })} options={[{ value: 'LKR', label: 'LKR' }, { value: 'USD', label: 'USD' }]} /></View>
          <View style={{ flex: 1, minWidth: 180 }}><DateField label="Awarded on" required value={f.won} onChange={(v) => set({ won: v })} quick={[]} /></View>
        </Row>
        <Row wrap gap={8}>
          <View style={{ flex: 1, minWidth: 220 }}><Select label="Sales person" value={f.sales} searchable onChange={(v) => set({ sales: v })} options={sales.map((p) => ({ value: p.id, label: p.full_name }))} /></View>
          <View style={{ flex: 1, minWidth: 220 }}><Select label="Business line" value={f.line} onChange={(v) => set({ line: v })} options={LINES.map((l) => ({ value: l.value, label: l.label }))} /></View>
        </Row>
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontWeight: '800', color: colors.ink }}>2 · Supply or execution</Text>
        <Segmented<Kind> value={f.type} onChange={(v) => set({ type: v })} options={[{ value: 'supply', label: 'Supply only' }, { value: 'supply_install', label: 'Supply & installation' }]} />
        {f.type === 'supply' ? (
          <>
            <Row wrap gap={8}>
              <View style={{ width: 220 }}><Field label="Manufacturers to order from" keyboardType="numeric" value={f.mfr} onChangeText={(v) => set({ mfr: v.replace(/\D/g, '') })} /></View>
              <View style={{ flex: 1, minWidth: 200 }}><DateField label="Delivery needed by" value={f.needed} onChange={(v) => set({ needed: v })} quick={[]} /></View>
            </Row>
            <Muted>Opens a supply order (SO-) with you: one PI and costing per manufacturer; each submitted PI goes to Operations – the same as a supply order from an approved invoice plan.</Muted>
          </>
        ) : (
          <>
            <Row wrap gap={8}>
              <View style={{ flex: 1, minWidth: 240 }}><Field label="Site address" value={f.site} onChangeText={(v) => set({ site: v })} /></View>
              <View style={{ flex: 1, minWidth: 180 }}><DateField label="Start" value={f.start} onChange={(v) => set({ start: v })} quick={[]} /></View>
              <View style={{ flex: 1, minWidth: 180 }}><DateField label="End" value={f.end} onChange={(v) => set({ end: v })} quick={[]} /></View>
            </Row>
            <Row wrap gap={8}>
              <View style={{ flex: 1, minWidth: 240 }}><Select label="Senior Electrical Engineer (optional – SM Projects assigns)" value={f.see} onChange={(v) => set({ see: v })} options={[{ value: '', label: 'Leave to SM Projects' }, ...sees.map((p) => ({ value: p.id, label: p.full_name }))]} /></View>
              <View style={{ flex: 1, minWidth: 240 }}><MultiSelect label="Areas" values={f.areas} onChange={(v) => set({ areas: v })} options={data.areas.map((a) => ({ value: a, label: human(a) }))} /></View>
            </Row>
            <Muted>Raises the hand-over of a project won before the system to SM Projects, who approves it and assigns the execution team.</Muted>
          </>
        )}
        <Field label="Note" multiline value={f.note} onChangeText={(v) => set({ note: v })} />
      </Card>

      <Card style={{ gap: 8 }}>
        <Text style={{ fontWeight: '800', color: colors.ink }}>3 · Order book (Finance)</Text>
        <Segmented<'link' | 'add'> value={f.book} onChange={(v) => set({ book: v })} options={[{ value: 'link', label: 'It is already in the order book – link it' }, { value: 'add', label: 'Add it as an earlier award' }]} />
        {f.book === 'link' ? (
          <Select label="Order-book entry" value={f.secured} searchable onChange={pickSecured}
            options={data.secured.map((s) => ({ value: s.id, label: `${s.name}${s.code ? ` · ${s.code}` : ''}`, hint: [s.customer, s.order_value != null ? fmtMoney(s.order_value) : null, s.source === 'opening' ? 'opening list' : `won ${fmtDate(s.won_on)}`].filter(Boolean).join(' · ') }))} />
        ) : (
          <Muted>{f.inquiry ? "The inquiry's order-book entry is made from it." : 'A new order-book entry is added.'} SM Projects, Operations and the sales person are told to check the value and add the invoice plan.</Muted>
        )}
        <Muted>So invoicing and the P&amp;L see the project once – a supply order always belongs to an order-book entry.</Muted>
      </Card>

      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Send to order →" onPress={send} disabled={!f.name.trim() || !f.customer.trim() || !f.value || !f.won || (f.won ?? '') > todayISO()} />
      </Row>
    </Screen>
  );
}
