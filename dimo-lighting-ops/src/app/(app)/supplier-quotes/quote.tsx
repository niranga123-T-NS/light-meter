import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, Field, Loading, Muted, Notice, NumberField, Pill, Row, Screen, Section, Select, Toggle } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { pickDocument } from '@/lib/files';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import {
  BASIS_LABEL, CCYS, EVENT_LABEL, lkrM, loadPackage, loadRefs, matchItem, PAID_BY, PAY_TEMPLATES, quoteTotals, readQuoteFile, SPEC_LABEL,
  type Basis, type Ccy, type PayEvent, type SqExcl, type SqItem, type SqLine, type SqPay, type SqQuote, type Supplier,
} from '@/lib/supplierQuotes';
import { rpc, supabase } from '@/lib/supabase';

type Form = Omit<SqQuote, 'id' | 'package_id' | 'created_at' | 'updated_at' | 'supplier_id'> & { supplier_id: string | null };
const EMPTY: Form = {
  supplier_id: null, quote_no: null, quote_date: null, currency: 'LKR', fx_rate: 1, valid_until: null, lead_weeks: null, delivery_basis: 'site', freight_pct: 0,
  warranty: null, paid_by: null, retention_pct: 0, adv_guarantee: false, meets_spec: 'yes', spec_note: null, source: 'manual', notes: null,
  lines: [{ text: '', item_id: null, qty: null, unit: null, rate: null, included: false }], payments: [], exclusions: [],
};

/** Add or edit one supplier quote. A file is only read here to fill the form – it is never uploaded or stored. */
export default function QuoteEditor() {
  const { pkg: pkgId, id } = useLocalSearchParams<{ pkg: string; id?: string }>();
  const { sqAccess } = useAuth();
  const { data, error } = useLoad(async () => {
    const [p, r] = await Promise.all([loadPackage(pkgId), loadRefs()]);
    return { ...p, ...r };
  }, [pkgId]);
  if (!sqAccess) return <Screen><Notice tone={colors.amber}>No access to supplier quotes.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  return <Editor data={data} id={id} pkgId={pkgId} />;
}

type Loaded = Awaited<ReturnType<typeof loadPackage>> & Awaited<ReturnType<typeof loadRefs>>;
function Editor({ data, id, pkgId }: { data: Loaded; id?: string; pkgId: string }) {
  const dialog = useDialog();
  const [f, setF] = useState<Form | null>(() => {
    const q = id ? data.quotes.find((x) => x.id === id) : null;
    return q ? { ...q, lines: q.lines.length ? q.lines : EMPTY.lines } : { ...EMPTY };
  });
  const [readNote, setReadNote] = useState<string | null>(null);
  const [payRead, setPayRead] = useState<string | null>(null);
  const [refs, setRefs] = useState<{ suppliers: Supplier[]; items: SqItem[] }>({ suppliers: data.suppliers, items: data.items });
  if (!f) return null;

  const set = (p: Partial<Form>) => setF((o) => (o ? { ...o, ...p } : o));
  const setLine = (i: number, p: Partial<SqLine>) => set({ lines: f.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const setPay = (i: number, p: Partial<SqPay>) => set({ payments: f.payments.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const setExcl = (i: number, p: Partial<SqExcl>) => set({ exclusions: f.exclusions.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const payTotal = f.payments.reduce((t, p) => t + (Number(p.pct) || 0), 0);
  const totals = quoteTotals({ ...(f as SqQuote) });

  const fxFor = async (c: Ccy) => {
    if (c === 'LKR') return set({ currency: c, fx_rate: 1 });
    set({ currency: c });
    const r = await rpc<number | null>('sq_fx', { p_ccy: c }).catch(() => null);
    if (r) set({ currency: c, fx_rate: Number(r) });
  };
  const readFile = async () => {
    const file = await pickDocument();
    if (!file) return;
    await dialog.run(async () => {
      const r = await readQuoteFile(file);
      const lines = r.lines.map((l) => { const m = matchItem(l.text, refs.items, data.aliases); return { ...l, item_id: m.item_id, check: !m.sure }; });
      setF((o) => o && {
        ...o, source: r.source, lines,
        quote_no: r.quote_no ?? o.quote_no, quote_date: r.quote_date ?? o.quote_date, valid_until: r.valid_until ?? o.valid_until, lead_weeks: r.lead_weeks ?? o.lead_weeks,
        warranty: r.warranty ?? o.warranty, payments: r.payments ?? o.payments, paid_by: r.paid_by ?? o.paid_by,
        exclusions: r.exclusions ? r.exclusions.map((text) => ({ text, add_lkr: 0 })) : o.exclusions,
      });
      if (r.currency && r.currency !== f.currency) await fxFor(r.currency);
      setPayRead(r.payText ?? null);
      const sure = lines.filter((l) => l.item_id && !l.check).length, unsure = lines.filter((l) => l.item_id && l.check).length;
      setReadNote(`Read ${lines.length} line(s) from ${file.name}: ${sure} matched to items, ${unsure} to check, ${lines.length - sure - unsure} not matched. The file is not stored.`);
    });
  };
  const newSupplier = async () => {
    const r = await dialog.prompt({ title: 'New supplier / subcontractor', fields: [{ key: 'name', label: 'Name', required: true }, { key: 'kind', label: 'Supplies', type: 'select', required: true, initial: data.pkg.kind === 'subcontract' ? 'subcontract' : 'supply', options: [{ value: 'supply', label: 'Materials (supplier)' }, { value: 'subcontract', label: 'Work (subcontractor)' }, { value: 'both', label: 'Both' }] }] });
    if (!r) return;
    await dialog.run(async () => {
      const { data: s, error: e } = await supabase.from('sq_suppliers').insert({ name: r.name.trim(), kind: r.kind }).select('*').single();
      if (e) throw new Error(/duplicate|unique/i.test(e.message) ? 'This supplier is already in the list' : e.message);
      setRefs((o) => ({ ...o, suppliers: [...o.suppliers, s as Supplier].sort((a, b) => a.name.localeCompare(b.name)) }));
      set({ supplier_id: (s as Supplier).id });
    });
  };
  const newItem = async (i: number) => {
    const l = f.lines[i];
    const r = await dialog.prompt({
      title: 'New item',
      message: 'Items keep the price history. Use your own code (or the SAP code) so the same material is always the same item.',
      fields: [{ key: 'code', label: 'Item code', required: true }, { key: 'name', label: 'Name', required: true, initial: l.text }, { key: 'unit', label: 'Unit', initial: l.unit ?? '' }, { key: 'sap', label: 'SAP code' }],
    });
    if (!r) return;
    await dialog.run(async () => {
      const { data: it, error: e } = await supabase.from('sq_items').insert({ code: r.code.trim().toUpperCase(), name: r.name.trim(), unit: r.unit?.trim() || null, sap_code: r.sap?.trim() || null }).select('*').single();
      if (e) throw new Error(/duplicate|unique/i.test(e.message) ? 'An item with this code exists – choose it from the list' : e.message);
      setRefs((o) => ({ ...o, items: [...o.items, it as SqItem].sort((a, b) => a.code.localeCompare(b.code)) }));
      setLine(i, { item_id: (it as SqItem).id, check: false });
    });
  };
  const save = async () => {
    if (!f.supplier_id) return dialog.toast('Choose the supplier', 'error');
    const lines = f.lines.filter((l) => l.text.trim());
    if (!lines.length) return dialog.toast('Add at least one line', 'error');
    if (lines.some((l) => !l.included && l.rate == null)) return dialog.toast('Every line needs a rate, or tick "included"', 'error');
    if (f.currency !== 'LKR' && !(f.fx_rate > 0)) return dialog.toast('Enter the exchange rate', 'error');
    if (f.payments.length && Math.abs(payTotal - 100) > 0.01) return dialog.toast(`Payment stages add up to ${payTotal} % – they must make 100 %`, 'error');
    if (lines.some((l) => l.item_id && l.check) && !(await dialog.confirm('Some lines are matched but not checked', 'Save with the suggested items? Wrong matches mix up the price history.'))) return;
    await dialog.run(async () => {
      await rpc('sq_save_quote', { p: { ...f, id: id ?? null, package_id: pkgId, lines: lines.map(({ check: _c, ...l }) => l), exclusions: f.exclusions.filter((x) => x.text.trim()) } });
      router.back();
    }, 'Quote saved');
  };

  const supOpts = refs.suppliers.filter((s) => s.active || s.id === f.supplier_id).map((s) => ({ value: s.id, label: s.name, hint: s.trades ?? undefined }));
  const itemOpts = [{ value: '', label: '— not matched —' }, ...refs.items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}`, hint: i.sap_code ? `SAP ${i.sap_code}` : undefined }))];
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: id ? 'Edit quote' : 'Add a quote' }} />
      <Muted>{`${data.pkg.code} · ${data.pkg.title}${data.pkg.project_name ? ` · ${data.pkg.project_name}` : ''}`}</Muted>

      <Section title="1 · The supplier's document">
        <Card>
          <Row wrap gap={8} style={{ alignItems: 'center' }}>
            <Button title="Read the supplier's Excel or PDF" icon="⇪" onPress={readFile} />
            <Muted>Optional – or type the quote in below.</Muted>
          </Row>
          {readNote ? <Notice tone={colors.green}>{readNote}</Notice> : null}
          <Notice>The file is only read on this device and is not stored. Only the values you check and save are kept – keep the original in your email.</Notice>
        </Card>
      </Section>

      <Section title="2 · Quote details">
        <Card>
          <Row wrap gap={10} style={{ alignItems: 'flex-end' }}>
            <View style={{ flexGrow: 1, minWidth: 260 }}><Select label="Supplier / subcontractor" required searchable value={f.supplier_id} options={supOpts} onChange={(v) => set({ supplier_id: v })} /></View>
            <Button variant="secondary" small title="New supplier" onPress={newSupplier} />
          </Row>
          <Row wrap gap={10}>
            <View style={{ minWidth: 180, flexGrow: 1 }}><Field label="Their quote no." value={f.quote_no ?? ''} onChangeText={(v) => set({ quote_no: v || null })} /></View>
            <View style={{ minWidth: 180, flexGrow: 1 }}><DateField label="Quote date" value={f.quote_date} onChange={(v) => set({ quote_date: v })} /></View>
            <View style={{ minWidth: 180, flexGrow: 1 }}><DateField label="Valid until" value={f.valid_until} onChange={(v) => set({ valid_until: v })} hint={data.pkg.our_validity ? `Our quotation: ${fmtDate(data.pkg.our_validity)}` : undefined} /></View>
          </Row>
          <Row wrap gap={10}>
            <View style={{ minWidth: 140, flexGrow: 1 }}><Select label="Currency" value={f.currency} options={CCYS.map((c) => ({ value: c, label: c }))} onChange={(v) => fxFor(v as Ccy)} /></View>
            {f.currency !== 'LKR' ? <View style={{ minWidth: 180, flexGrow: 1 }}><NumberField label="Exchange rate (LKR per unit)" value={f.fx_rate} onChange={(v) => set({ fx_rate: v ?? 0 })} hint="Latest CBSL rate filled in – change it if needed" /></View> : null}
            <View style={{ minWidth: 180, flexGrow: 1 }}><Select label="Delivery basis" value={f.delivery_basis} options={Object.entries(BASIS_LABEL).map(([value, label]) => ({ value, label }))} onChange={(v) => set({ delivery_basis: v as Basis })} /></View>
            <View style={{ minWidth: 180, flexGrow: 1 }}><NumberField label="Freight, duty, clearing to add" suffix="%" value={f.freight_pct} onChange={(v) => set({ freight_pct: v ?? 0 })} hint={f.delivery_basis === 'site' ? 'Delivered to site – usually 0' : 'Needed to compare with delivered prices'} /></View>
          </Row>
          <Row wrap gap={10}>
            <View style={{ minWidth: 140, flexGrow: 1 }}><NumberField label="Lead time" suffix="weeks" value={f.lead_weeks} onChange={(v) => set({ lead_weeks: v })} hint={data.pkg.needed_weeks ? `Needed within ${data.pkg.needed_weeks} weeks` : undefined} /></View>
            <View style={{ minWidth: 160, flexGrow: 1 }}><Field label="Warranty" value={f.warranty ?? ''} onChangeText={(v) => set({ warranty: v || null })} placeholder="e.g. 5 years" /></View>
            <View style={{ minWidth: 180, flexGrow: 1 }}><Select label="Meets the specification" value={f.meets_spec} options={Object.entries(SPEC_LABEL).map(([value, label]) => ({ value, label }))} onChange={(v) => set({ meets_spec: v as Form['meets_spec'] })} /></View>
          </Row>
          {f.meets_spec !== 'yes' ? <Field label="What differs from the specification" value={f.spec_note ?? ''} onChangeText={(v) => set({ spec_note: v || null })} /> : null}
          <Field label="Notes" value={f.notes ?? ''} onChangeText={(v) => set({ notes: v || null })} multiline />
        </Card>
      </Section>

      <Section title="3 · Payment terms">
        <Card>
          {payRead ? <Muted>{`Read from the quote: "${payRead}"`}</Muted> : null}
          <Row wrap gap={10}>
            <View style={{ minWidth: 220, flexGrow: 1 }}>
              <Select label="Template" value={null} placeholder="Fill the stages from…" options={PAY_TEMPLATES.map((t) => ({ value: t.label, label: t.label }))}
                onChange={(v) => { const t = PAY_TEMPLATES.find((x) => x.label === v)!; set({ payments: t.stages.map((s) => ({ ...s })), ...(t.paid_by ? { paid_by: t.paid_by } : {}) }); }} />
            </View>
            <View style={{ minWidth: 200, flexGrow: 1 }}><Select label="Paid by" value={f.paid_by} options={PAID_BY.map((p) => ({ value: p, label: p }))} onChange={(v) => set({ paid_by: v })} /></View>
          </Row>
          {f.payments.map((p, i) => (
            <Row key={i} wrap gap={8} style={{ alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
              <View style={{ minWidth: 140, flexGrow: 1 }}><Field label="Stage" value={p.name} onChangeText={(v) => setPay(i, { name: v })} /></View>
              <View style={{ width: 90 }}><NumberField label="%" value={p.pct} onChange={(v) => setPay(i, { pct: v ?? 0 })} /></View>
              <View style={{ minWidth: 180, flexGrow: 1 }}><Select label="When" value={p.event} options={Object.entries(EVENT_LABEL).map(([value, label]) => ({ value, label }))} onChange={(v) => setPay(i, { event: v as PayEvent })} /></View>
              <View style={{ width: 100 }}><NumberField label="Days after" value={p.days} onChange={(v) => setPay(i, { days: v ?? 0 })} /></View>
              <Button small variant="ghost" title="✕" onPress={() => set({ payments: f.payments.filter((_, k) => k !== i) })} />
            </Row>
          ))}
          <Row wrap gap={10} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Button small variant="secondary" title="Add a stage" icon="＋" onPress={() => set({ payments: [...f.payments, { name: '', pct: Math.max(0, 100 - payTotal), event: 'after_delivery', days: 30 }] })} />
            {f.payments.length ? <Text style={{ fontWeight: '700', color: Math.abs(payTotal - 100) < 0.01 ? colors.green : colors.red }}>{`Total ${payTotal} %${Math.abs(payTotal - 100) < 0.01 ? ' ✓' : ' – must be 100 %'}`}</Text> : <Muted>{'No stages yet – the comparison shows “Not entered”.'}</Muted>}
          </Row>
          <Row wrap gap={10} style={{ alignItems: 'flex-end' }}>
            <View style={{ width: 160 }}><NumberField label="Retention" suffix="%" value={f.retention_pct} onChange={(v) => set({ retention_pct: v ?? 0 })} /></View>
            <Toggle label="Bank guarantee needed for the advance" value={f.adv_guarantee} onChange={(v) => set({ adv_guarantee: v })} />
          </Row>
        </Card>
      </Section>

      <Section title="4 · Exclusions">
        <Card>
          <Muted>Everything the quote leaves out. Put a value on each so the quotes compare on the same scope.</Muted>
          {f.exclusions.map((x, i) => (
            <Row key={i} wrap gap={8} style={{ alignItems: 'flex-end' }}>
              <View style={{ minWidth: 220, flexGrow: 1 }}><Field label="Excluded" value={x.text} onChangeText={(v) => setExcl(i, { text: v })} /></View>
              <View style={{ width: 200 }}><NumberField label="Value to add (LKR)" value={x.add_lkr} onChange={(v) => setExcl(i, { add_lkr: v ?? 0 })} /></View>
              <Button small variant="ghost" title="✕" onPress={() => set({ exclusions: f.exclusions.filter((_, k) => k !== i) })} />
            </Row>
          ))}
          <Row><Button small variant="secondary" title="Add an exclusion" icon="＋" onPress={() => set({ exclusions: [...f.exclusions, { text: '', add_lkr: 0 }] })} /></Row>
        </Card>
      </Section>

      <Section title={`5 · Lines (${f.lines.length})`}>
        <Card>
          <Muted>{'Match each line to an item so its price goes into the history. The supplier\'s wording is remembered, so the next quote matches by itself.'}</Muted>
          {f.lines.map((l, i) => (
            <View key={i} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: colors.line, paddingTop: i ? 10 : 0, gap: 6, backgroundColor: l.item_id && l.check ? '#FFFAF2' : undefined }}>
              <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
                <View style={{ minWidth: 240, flexGrow: 2 }}><Field label={`Line ${i + 1} – as written`} value={l.text} onChangeText={(v) => setLine(i, { text: v })} /></View>
                <View style={{ width: 100 }}><NumberField label="Qty" value={l.qty} onChange={(v) => setLine(i, { qty: v })} /></View>
                <View style={{ width: 90 }}><Field label="Unit" value={l.unit ?? ''} onChangeText={(v) => setLine(i, { unit: v || null })} /></View>
                {!l.included ? <View style={{ width: 150 }}><NumberField label={`Rate (${f.currency})`} value={l.rate} onChange={(v) => setLine(i, { rate: v })} /></View> : null}
              </Row>
              <Row wrap gap={8} style={{ alignItems: 'flex-end' }}>
                <View style={{ minWidth: 260, flexGrow: 1 }}><Select label="Item" searchable value={l.item_id ?? ''} options={itemOpts} onChange={(v) => setLine(i, { item_id: v || null, check: false })} /></View>
                {l.item_id && l.check ? <Pressable onPress={() => setLine(i, { check: false })}><Pill label="Suggested – tap to confirm" tone={colors.amber} /></Pressable> : l.item_id ? <Pill label="Matched" tone={colors.green} /> : null}
                <Button small variant="secondary" title="New item" onPress={() => newItem(i)} />
                <Toggle label="Included (no price)" value={l.included} onChange={(v) => setLine(i, { included: v, rate: v ? null : l.rate })} />
                <Button small variant="ghost" title="✕" onPress={() => set({ lines: f.lines.filter((_, k) => k !== i) })} />
              </Row>
            </View>
          ))}
          <Row wrap gap={10} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Button small variant="secondary" title="Add a line" icon="＋" onPress={() => set({ lines: [...f.lines, { text: '', item_id: null, qty: null, unit: null, rate: null, included: false }] })} />
            <Text style={{ color: colors.ink }}>{`Total as written: ${f.currency} ${totals.written.toLocaleString('en-US', { maximumFractionDigits: 2 })} · comparable LKR ${lkrM(totals.total)}`}</Text>
          </Row>
        </Card>
      </Section>

      <Row wrap gap={8}>
        <Button title="Save quote" onPress={save} />
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
      </Row>
    </Screen>
  );
}
