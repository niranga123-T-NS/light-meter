import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { lkr0, type SqItem } from '@/lib/supplierQuotes';
import { supabase } from '@/lib/supabase';

type H = {
  id: string; text: string; qty: number | null; unit: string | null; rate: number | null; included: boolean;
  quote: { id: string; quote_no: string | null; quote_date: string | null; created_at: string; currency: string; fx_rate: number; freight_pct: number; lead_weeks: number | null;
    supplier: { name: string } | null; package: { id: string; code: string; title: string; project_name: string | null; selected_quote_id: string | null; status: string } | null };
};

/** Everything quoted for one item: every supplier, every job, chosen or not, in LKR delivered – and the suppliers' own names for it. */
export default function ItemHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sqAccess } = useAuth();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [it, ls, al] = await Promise.all([
      supabase.from('sq_items').select('*').eq('id', id).maybeSingle(),
      supabase.from('sq_quote_lines').select('id, text, qty, unit, rate, included, quote:sq_quotes(id, quote_no, quote_date, created_at, currency, fx_rate, freight_pct, lead_weeks, supplier:sq_suppliers(name), package:sq_packages(id, code, title, project_name, selected_quote_id, status))').eq('item_id', id).limit(1000),
      supabase.from('sq_item_aliases').select('alias, supplier:sq_suppliers(name)').eq('item_id', id),
    ]);
    const err = it.error ?? ls.error ?? al.error;
    if (err) throw new Error(err.message);
    if (!it.data) throw new Error('Item not found');
    return { item: it.data as SqItem, lines: (ls.data ?? []) as unknown as H[], aliases: (al.data ?? []) as unknown as { alias: string; supplier: { name: string } | null }[] };
  }, [id]);
  if (!sqAccess) return <Screen><Notice tone={colors.amber}>No access to supplier quotes.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { item, aliases } = data;
  const rows = data.lines
    .map((l) => {
      const d = l.quote.quote_date ?? l.quote.created_at.slice(0, 10);
      const v = l.included || l.rate == null ? null : Number(l.rate) * Number(l.quote.fx_rate) * (1 + Number(l.quote.freight_pct) / 100);
      const chosen = l.quote.package?.selected_quote_id === l.quote.id;
      return { l, d, v, chosen };
    })
    .sort((a, b) => b.d.localeCompare(a.d));
  const priced = rows.filter((r) => r.v != null);
  const vals = priced.map((r) => r.v!).sort((a, b) => a - b);
  const median = vals.length ? vals[Math.floor((vals.length - 1) / 2)] : null;
  const chosenRows = priced.filter((r) => r.chosen);
  const first = priced[priced.length - 1], last = priced[0];
  const qtyChosen = chosenRows.reduce((t, r) => t + Number(r.l.qty ?? 0), 0);
  const edit = async () => {
    const r = await dialog.prompt({ title: 'Edit item', fields: [{ key: 'code', label: 'Item code', required: true, initial: item.code }, { key: 'name', label: 'Name', required: true, initial: item.name }, { key: 'unit', label: 'Unit', initial: item.unit ?? '' }, { key: 'sap', label: 'SAP code', initial: item.sap_code ?? '' }] });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('sq_items').update({ code: r.code.trim().toUpperCase(), name: r.name.trim(), unit: r.unit?.trim() || null, sap_code: r.sap?.trim() || null }).eq('id', item.id);
      if (e) throw new Error(/duplicate|unique/i.test(e.message) ? 'Another item has this code' : e.message);
      reload();
    }, 'Saved');
  };
  // simple bar chart of the rates, oldest first
  const bars = [...priced].reverse().slice(-16);
  const lo = vals.length ? vals[0] * 0.9 : 0, hi = vals.length ? vals[vals.length - 1] : 1;
  return (
    <Screen maxWidth={1200}>
      <Stack.Screen options={{ title: item.name }} />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Muted>{[item.code, item.sap_code && `SAP ${item.sap_code}`, item.unit].filter(Boolean).join(' · ')}</Muted>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{item.name}</Text>
        </View>
        <Button variant="secondary" title="Edit item" onPress={edit} />
      </Row>
      <Grid min={170} max={5}>
        <Stat label="Quoted" value={`${priced.length} time${priced.length === 1 ? '' : 's'}`} sub={`${new Set(priced.map((r) => r.l.quote.supplier?.name)).size} supplier(s)`} />
        <Stat label="Chosen" value={`${chosenRows.length} time${chosenRows.length === 1 ? '' : 's'}`} sub={qtyChosen ? `${qtyChosen} ${item.unit ?? ''} in total` : undefined} />
        <Stat label="Latest (LKR)" value={last ? lkr0(last.v) : '—'} sub={last ? `${last.l.quote.supplier?.name ?? ''} · ${fmtDate(last.d)}` : undefined} />
        <Stat label="Typical (median)" value={lkr0(median)} sub={vals.length ? `range ${lkr0(vals[0])} – ${lkr0(vals[vals.length - 1])}` : undefined} />
        <Stat label="Since the first quote" value={first && last && first !== last ? `${(((last.v! - first.v!) / first.v!) * 100).toFixed(1)} %` : '—'} sub={first ? `${lkr0(first.v)} → ${lkr0(last?.v)}` : undefined} />
      </Grid>
      {bars.length > 1 ? (
        <Card>
          <Muted>Rate per unit in LKR delivered, oldest first · dark = chosen</Muted>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 150, marginTop: 8 }} accessibilityLabel="Rates over time">
            {bars.map((b, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>{Math.round(b.v! / 1000)}k</Text>
                <View style={{ width: '80%', maxWidth: 30, height: Math.max(6, ((b.v! - lo) / Math.max(1, hi - lo)) * 110), backgroundColor: b.chosen ? '#1F4FA3' : '#8FA9D6', borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                <Text style={{ fontSize: 10, color: colors.muted }}>{b.d.slice(2, 7)}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <Section title="Every quote for this item">
        <DataTable
          rows={rows}
          keyOf={(r) => r.l.id}
          onPress={(r) => r.l.quote.package && router.push(`/supplier-quotes/${r.l.quote.package.id}`)}
          columns={[
            { h: 'Date', w: 100, v: (r) => fmtDate(r.d) },
            { h: 'Supplier', w: 170, v: (r) => <View><Text style={{ color: colors.ink }}>{r.l.quote.supplier?.name ?? '—'}</Text><Muted>{r.l.quote.quote_no ?? ''}</Muted></View> },
            { h: 'Job', w: 200, grow: true, v: (r) => <View><Text style={{ color: colors.ink }}>{r.l.quote.package?.title ?? '—'}</Text><Muted>{[r.l.quote.package?.code, r.l.quote.package?.project_name].filter(Boolean).join(' · ')}</Muted></View> },
            { h: 'Qty', w: 80, right: true, v: (r) => `${r.l.qty ?? ''} ${r.l.unit ?? ''}` },
            { h: 'Rate LKR', w: 120, right: true, bold: true, v: (r) => (r.v == null ? 'included' : lkr0(r.v)) },
            { h: 'As quoted', w: 130, right: true, v: (r) => (r.l.rate == null ? '—' : `${r.l.quote.currency === 'LKR' ? '' : `${r.l.quote.currency} `}${Number(r.l.rate).toLocaleString('en-US')}`) },
            { h: 'Lead time', w: 90, v: (r) => (r.l.quote.lead_weeks != null ? `${r.l.quote.lead_weeks} wk` : '—') },
            { h: 'Outcome', w: 120, v: (r) => <Pill label={r.chosen ? 'Chosen' : r.l.quote.package?.selected_quote_id ? 'Not chosen' : 'Comparing'} tone={r.chosen ? colors.green : r.l.quote.package?.selected_quote_id ? colors.grey : colors.blue} /> },
          ]}
        />
      </Section>
      <Section title="Also known as">
        <Card>
          <Muted>{'The suppliers\' own names for this item – matched by themselves on the next quote.'}</Muted>
          {aliases.length ? aliases.map((a, i) => <Text key={i} style={{ color: colors.ink }}>{`"${a.alias}"${a.supplier ? ` – ${a.supplier.name}` : ''}`}</Text>) : <Muted>None yet.</Muted>}
        </Card>
      </Section>
      <Muted>Prices actually paid come in when orders carry their lines – today orders keep only a total.</Muted>
    </Screen>
  );
}
