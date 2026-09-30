import * as Location from 'expo-location';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { fmtMoney } from '@/lib/format';
import { useMasters } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import type { DutyStatus, Visit } from '@/lib/types';
import { Attachments } from './Attachments';
import { useDialog } from './dialog';
import { Button, Card, colors, DateField, Field, Muted, NumberField, Row, Section, Select, Toggle } from './ui';

/** Current GPS position, captured only at check-in / check-out (Section 4.6 privacy). */
export async function captureLocation(): Promise<{ lat: number; lng: number } | null> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) return null;
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    const last = await Location.getLastKnownPositionAsync();
    return last ? { lat: last.coords.latitude, lng: last.coords.longitude } : null;
  }
}

/** Visit Objective: short group list first, then the detail (Section 4.1). */
export function ObjectivePicker({
  value,
  onChange,
  label = 'Visit objective',
  required,
}: {
  value: string | null;
  onChange: (v: string) => void;
  label?: string;
  required?: boolean;
}) {
  const masters = useMasters();
  const objectives = masters.list('visit_objective');
  const groups = useMemo(() => Array.from(new Set(objectives.map((o) => o.grp ?? 'Other'))), [objectives]);
  const [chosenGroup, setGroup] = useState<string | null>(null);
  const group = chosenGroup ?? (value ? objectives.find((o) => o.value === value)?.grp ?? null : null);
  return (
    <View>
      <Select label={`${label} – group`} required={required} value={group} options={groups.map((g) => ({ value: g, label: g }))} onChange={setGroup} />
      {group ? (
        <Select
          label={label}
          required={required}
          value={value}
          options={objectives.filter((o) => o.grp === group).map((o) => ({ value: o.value, label: o.value, hint: o.tags.includes('internal') ? 'Internal' : undefined }))}
          onChange={onChange}
        />
      ) : null}
    </View>
  );
}

type Bid = { competitor_id: number | null; bid_price: number | null; brands: string; compliant: boolean; remarks: string };

/**
 * Tender result form (Section 4.8) – mandatory before a Bid Submission or Tender Opening visit can be closed.
 */
export function TenderResultForm({ visit, onSaved }: { visit: Visit; onSaved: () => void }) {
  const dialog = useDialog();
  const masters = useMasters();
  const [tenderId, setTenderId] = useState<string | null>(null);
  const [competitors, setCompetitors] = useState<{ id: number; name: string }[]>([]);
  const [f, setF] = useState({
    tender_no: visit.tender_no ?? '',
    tender_name: '',
    tender_type: 'open',
    duty_status: 'duty_paid' as DutyStatus,
    closing_date: visit.tender_date ?? '',
    opening_date: visit.tender_date ?? '',
    our_price: null as number | null,
    our_brands: '',
    delivery_period: '',
    validity: '',
    result_status: 'opened',
    lost_reason: '',
    evaluation_notes: '',
    next_action: '',
    next_action_date: '',
  });
  const [bids, setBids] = useState<Bid[]>([]);

  useEffect(() => {
    supabase.from('competitors').select('id, name').eq('active', true).order('name').then(({ data }) => setCompetitors(data ?? []));
    supabase
      .from('tenders')
      .select('*, tender_bids(*)')
      .eq('visit_id', visit.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setTenderId(data.id);
        setF({
          tender_no: data.tender_no,
          tender_name: data.tender_name,
          tender_type: data.tender_type,
          duty_status: data.duty_status,
          closing_date: data.closing_date,
          opening_date: data.opening_date,
          our_price: data.our_price,
          our_brands: (data.our_brands ?? []).join(', '),
          delivery_period: data.delivery_period ?? '',
          validity: data.validity ?? '',
          result_status: data.result_status,
          lost_reason: data.lost_reason ?? '',
          evaluation_notes: data.evaluation_notes ?? '',
          next_action: data.next_action ?? '',
          next_action_date: data.next_action_date ?? '',
        });
        setBids(
          (data.tender_bids ?? []).map((b: { competitor_id: number; bid_price: number; brands: string[]; compliant: boolean; remarks: string | null }) => ({
            competitor_id: b.competitor_id,
            bid_price: b.bid_price,
            brands: (b.brands ?? []).join(', '),
            compliant: b.compliant,
            remarks: b.remarks ?? '',
          })),
        );
      });
  }, [visit.id]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const cur = f.duty_status === 'duty_free' ? 'USD' : 'LKR';
  const compliant = bids.filter((b) => b.compliant && b.bid_price != null).map((b) => b.bid_price as number);
  const lowest = f.our_price != null ? Math.min(f.our_price, ...compliant) : compliant.length ? Math.min(...compliant) : null;
  const rank = f.our_price != null ? 1 + compliant.filter((p) => p < (f.our_price as number)).length : null;

  const save = () =>
    dialog.run(async () => {
      if (!visit.project_id) throw new Error('Link the visit to a project first');
      if (!f.tender_no || !f.tender_name || !f.closing_date || !f.opening_date) throw new Error('Tender no., name, closing and opening dates are required');
      const row = {
        visit_id: visit.id,
        project_id: visit.project_id,
        client_organization_id: visit.organization_id,
        tender_no: f.tender_no,
        tender_name: f.tender_name,
        tender_type: f.tender_type,
        duty_status: f.duty_status,
        closing_date: f.closing_date,
        opening_date: f.opening_date,
        our_price: f.our_price,
        our_brands: f.our_brands.split(',').map((x) => x.trim()).filter(Boolean),
        delivery_period: f.delivery_period || null,
        validity: f.validity || null,
        result_status: f.result_status,
        lost_reason: f.lost_reason || null,
        evaluation_notes: f.evaluation_notes || null,
        next_action: f.next_action || null,
        next_action_date: f.next_action_date || null,
      };
      let id = tenderId;
      if (id) {
        const { error } = await supabase.from('tenders').update(row).eq('id', id);
        if (error) throw new Error(error.message);
        await supabase.from('tender_bids').delete().eq('tender_id', id);
      } else {
        const { data, error } = await supabase.from('tenders').insert(row).select('id').single();
        if (error) throw new Error(error.message);
        id = data.id;
        setTenderId(id);
      }
      const rows = bids
        .filter((b) => b.competitor_id && b.bid_price != null)
        .map((b) => ({
          tender_id: id,
          competitor_id: b.competitor_id,
          bid_price: b.bid_price,
          brands: b.brands.split(',').map((x) => x.trim()).filter(Boolean),
          compliant: b.compliant,
          remarks: b.remarks || null,
        }));
      if (rows.length) {
        const { error } = await supabase.from('tender_bids').insert(rows);
        if (error) throw new Error(error.message);
      }
      onSaved();
    }, 'Tender result saved');

  return (
    <Section title="Tender result (mandatory)">
      <Card>
        <Field label="Tender no." required value={f.tender_no} onChangeText={(v) => set('tender_no', v)} />
        <Field label="Tender name" required value={f.tender_name} onChangeText={(v) => set('tender_name', v)} />
        <Select
          label="Tender type"
          value={f.tender_type}
          onChange={(v) => set('tender_type', v)}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'selective', label: 'Selective / Limited' },
            { value: 'negotiated', label: 'Negotiated' },
            { value: 're_tender', label: 'Re-tender' },
          ]}
        />
        <Select
          label="Duty status and currency"
          value={f.duty_status}
          onChange={(v) => set('duty_status', v as DutyStatus)}
          options={[
            { value: 'duty_free', label: 'Duty Free – USD' },
            { value: 'duty_paid', label: 'Duty Paid – LKR' },
          ]}
        />
        <DateField label="Closing date" required value={f.closing_date} onChange={(v) => set('closing_date', v ?? '')} quick={[0]} />
        <DateField label="Opening date" required value={f.opening_date} onChange={(v) => set('opening_date', v ?? '')} quick={[0]} />
        <Text style={{ fontWeight: '700', marginVertical: 8 }}>Our bid</Text>
        <NumberField label="Our price" suffix={cur} value={f.our_price} onChange={(v) => set('our_price', v)} />
        <Field label="Brand(s) offered" hint="Comma separated" value={f.our_brands} onChangeText={(v) => set('our_brands', v)} />
        <Row gap={8}>
          <View style={{ flex: 1 }}>
            <Field label="Delivery period" value={f.delivery_period} onChangeText={(v) => set('delivery_period', v)} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Validity" value={f.validity} onChangeText={(v) => set('validity', v)} />
          </View>
        </Row>
        <Text style={{ fontWeight: '700', marginVertical: 8 }}>Competitor bids</Text>
        {bids.map((b, i) => (
          <Card key={i} style={{ marginBottom: 8, backgroundColor: colors.soft }}>
            <Select
              label="Bidder"
              searchable
              value={b.competitor_id ? String(b.competitor_id) : null}
              options={competitors.map((c) => ({ value: String(c.id), label: c.name }))}
              onChange={(v) => setBids((s) => s.map((x, j) => (j === i ? { ...x, competitor_id: Number(v) } : x)))}
              hint="New competitor names are added by SM Projects"
            />
            <NumberField label="Bid price" suffix={cur} value={b.bid_price} onChange={(v) => setBids((s) => s.map((x, j) => (j === i ? { ...x, bid_price: v } : x)))} />
            <Field label="Brand(s)" value={b.brands} onChangeText={(v) => setBids((s) => s.map((x, j) => (j === i ? { ...x, brands: v } : x)))} />
            <Toggle label="Compliant" value={b.compliant} onChange={(v) => setBids((s) => s.map((x, j) => (j === i ? { ...x, compliant: v } : x)))} />
            <Field label="Remarks" value={b.remarks} onChangeText={(v) => setBids((s) => s.map((x, j) => (j === i ? { ...x, remarks: v } : x)))} />
            <Button small variant="ghost" title="Remove bidder" onPress={() => setBids((s) => s.filter((_, j) => j !== i))} />
          </Card>
        ))}
        <Button small variant="secondary" title="+ Add competitor bid" onPress={() => setBids((s) => [...s, { competitor_id: null, bid_price: null, brands: '', compliant: true, remarks: '' }])} />
        {rank ? (
          <Muted style={{ marginTop: 8 }}>
            Our position L{rank} · lowest bid {fmtMoney(lowest, cur)} · difference from L1 {fmtMoney((f.our_price ?? 0) - (lowest ?? 0), cur)} (
            {f.our_price ? (((f.our_price - (lowest ?? 0)) / f.our_price) * 100).toFixed(1) : '0'}%)
          </Muted>
        ) : null}
        <Select
          label="Result status"
          value={f.result_status}
          onChange={(v) => set('result_status', v)}
          options={[
            { value: 'opened', label: 'Opened – awaiting evaluation' },
            { value: 'awarded_to_us', label: 'Awarded to us' },
            { value: 'awarded_to_competitor', label: 'Awarded to competitor' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 're_tender', label: 'Re-tender' },
          ]}
        />
        {f.result_status === 'awarded_to_competitor' ? (
          <Select label="Lost reason" value={f.lost_reason} onChange={(v) => set('lost_reason', v)} options={masters.values('lost_reason').map((v) => ({ value: v, label: v }))} />
        ) : null}
        <Field label="Evaluation notes" multiline value={f.evaluation_notes} onChangeText={(v) => set('evaluation_notes', v)} hint="Technical compliance issues, alternates offered, consultant remarks" />
        <Field label="Next action" value={f.next_action} onChangeText={(v) => set('next_action', v)} />
        <DateField label="Next action date" value={f.next_action_date} onChange={(v) => set('next_action_date', v ?? '')} />
        <Button title={tenderId ? 'Update tender result' : 'Save tender result'} onPress={save} />
      </Card>
      {tenderId ? <Attachments entityType="tender" entityId={tenderId} kinds={['tender_doc']} title="Bid opening sheet, tender documents" allowCamera /> : null}
    </Section>
  );
}
