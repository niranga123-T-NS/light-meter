import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Grid, Loading, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { discFactor, lkr0, type SqItem } from '@/lib/supplierQuotes';
import { supabase } from '@/lib/supabase';

type H = {
  id: string; text: string; qty: number | null; unit: string | null; rate: number | null; included: boolean;
  quote: { id: string; quote_no: string | null; quote_date: string | null; created_at: string; currency: string; fx_rate: number; freight_pct: number; lead_weeks: number | null;
    revision: number; first_id: string | null; superseded_by: string | null; revision_note: string | null; discount_pct: number; discount_amt: number; lines: { qty: number | null; rate: number | null; included: boolean }[];
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
      supabase.from('sq_quote_lines').select('id, text, qty, unit, rate, included, quote:sq_quotes(id, quote_no, quote_date, created_at, currency, fx_rate, freight_pct, lead_weeks, revision, first_id, superseded_by, revision_note, discount_pct, discount_amt, lines:sq_quote_lines(qty, rate, included), supplier:sq_suppliers(name), package:sq_packages(id, code, title, project_name, selected_quote_id, status))').eq('item_id', id).limit(1000),
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
      const v = l.included || l.rate == null ? null : Number(l.rate) * Number(l.quote.fx_rate) * (1 + Number(l.quote.freight_pct) / 100) * discFactor(l.quote);
      const chosen = l.quote.package?.selected_quote_id === l.quote.id;
      return { l, d, v, chosen, chain: l.quote.first_id ?? l.quote.id, latest: !l.quote.superseded_by };
    });
  // every version on every job: grouped per supplier and job (newest job first), versions in order – how each supplier came down
  const chainIds = [...new Set(rows.map((r) => r.chain))];
  const groups = chainIds.map((c) => rows.filter((r) => r.chain === c).sort((a, b) => a.l.quote.revision - b.l.quote.revision))
    .sort((a, b) => b[b.length - 1].d.localeCompare(a[a.length - 1].d));
  const ordered = groups.flatMap((g) => [...g].reverse());
  const firstOf = (r: (typeof rows)[number]) => groups.find((g) => g[0].chain === r.chain)![0];
  const priced = rows.filter((r) => r.v != null && r.latest).sort((a, b) => b.d.localeCompare(a.d));
  const drops = groups.filter((g) => g.length > 1 && g[0].v && g[g.length - 1].v).map((g) => ((g[g.length - 1].v! - g[0].v!) / g[0].v!) * 100);
  const vals = priced.map((r) => r.v!).sort((a, b) => a - b);
  const median = vals.length ? vals[Math.floor((vals.length - 1) / 2)] : null;
  const chosenRows = priced.filter((r) => r.chosen);
  const first = priced[priced.length - 1], last = priced[0];
  const allVersions = rows.filter((r) => r.v != null).sort((a, b) => a.d.localeCompare(b.d));
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
  // bar chart of every version of the rates, oldest first
  const bars = allVersions.slice(-20);
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
      <Grid min={170} max={6}>
        <Stat label="Quoted" value={`${groups.length} time${groups.length === 1 ? '' : 's'}`} sub={`${rows.length} version(s) · ${new Set(priced.map((r) => r.l.quote.supplier?.name)).size} supplier(s)`} />
        <Stat label="Came down after negotiation" value={drops.length ? `${(drops.reduce((a, b) => a + b, 0) / drops.length).toFixed(1)} %` : '—'} tone={drops.length ? 'green' : undefined} sub={drops.length ? `average of ${drops.length} negotiated quote(s)` : 'no revised quotes yet'} />
        <Stat label="Chosen" value={`${chosenRows.length} time${chosenRows.length === 1 ? '' : 's'}`} sub={qtyChosen ? `${qtyChosen} ${item.unit ?? ''} in total` : undefined} />
        <Stat label="Latest (LKR)" value={last ? lkr0(last.v) : '—'} sub={last ? `${last.l.quote.supplier?.name ?? ''} · ${fmtDate(last.d)}` : undefined} />
        <Stat label="Typical (median)" value={lkr0(median)} sub={vals.length ? `range ${lkr0(vals[0])} – ${lkr0(vals[vals.length - 1])}` : undefined} />
        <Stat label="Since the first quote" value={first && last && first !== last ? `${(((last.v! - first.v!) / first.v!) * 100).toFixed(1)} %` : '—'} sub={first ? `${lkr0(first.v)} → ${lkr0(last?.v)}` : undefined} />
      </Grid>
      {bars.length > 1 ? (
        <Card>
          <Muted>Every version, oldest first – rate per unit in LKR delivered · dark = chosen · light = an earlier version later revised</Muted>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 150, marginTop: 8 }} accessibilityLabel="Rates over time">
            {bars.map((b, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                <Text style={{ fontSize: 10, color: colors.muted }}>{Math.round(b.v! / 1000)}k</Text>
                <View style={{ width: '80%', maxWidth: 30, height: Math.max(6, ((b.v! - lo) / Math.max(1, hi - lo)) * 110), backgroundColor: b.chosen ? '#1F4FA3' : b.latest ? '#8FA9D6' : '#D3DCEB', borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
                <Text style={{ fontSize: 10, color: colors.muted }}>{b.d.slice(2, 7)}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <Section title="Every version on every job">
        <DataTable
          rows={ordered}
          rowStyle={(r) => (r.latest ? undefined : { backgroundColor: '#F8FAFC' })}
          keyOf={(r) => r.l.id}
          onPress={(r) => r.l.quote.package && router.push(`/supplier-quotes/${r.l.quote.package.id}`)}
          columns={[
            { h: 'Date', w: 100, v: (r) => fmtDate(r.d) },
            { h: 'Version', w: 130, v: (r) => <View><Text style={{ color: colors.ink, fontWeight: '600' }}>{`R${r.l.quote.revision}${r.latest ? '' : ' · earlier'}`}</Text>{r.l.quote.revision_note ? <Muted numberOfLines={2}>{r.l.quote.revision_note}</Muted> : null}</View> },
            { h: 'Supplier', w: 170, v: (r) => <View><Text style={{ color: colors.ink }}>{r.l.quote.supplier?.name ?? '—'}</Text><Muted>{r.l.quote.quote_no ?? ''}</Muted></View> },
            { h: 'Job', w: 200, grow: true, v: (r) => <View><Text style={{ color: colors.ink }}>{r.l.quote.package?.title ?? '—'}</Text><Muted>{[r.l.quote.package?.code, r.l.quote.package?.project_name].filter(Boolean).join(' · ')}</Muted></View> },
            { h: 'Qty', w: 80, right: true, v: (r) => `${r.l.qty ?? ''} ${r.l.unit ?? ''}` },
            { h: 'Rate LKR', w: 130, right: true, bold: true, v: (r) => {
              if (r.v == null) return 'included';
              const f0 = firstOf(r), d = r.l.quote.revision && f0.v ? ((r.v - f0.v) / f0.v) * 100 : null;
              return <View style={{ alignItems: 'flex-end' }}><Text style={{ color: colors.ink, fontWeight: '700' }}>{lkr0(r.v)}</Text>{d != null ? <Text style={{ fontSize: 12, color: d < 0 ? colors.green : colors.red }}>{`${d > 0 ? '+' : ''}${d.toFixed(1)} % vs R0`}</Text> : null}</View>;
            } },
            { h: 'As quoted', w: 130, right: true, v: (r) => (r.l.rate == null ? '—' : `${r.l.quote.currency === 'LKR' ? '' : `${r.l.quote.currency} `}${Number(r.l.rate).toLocaleString('en-US')}`) },
            { h: 'Lead time', w: 90, v: (r) => (r.l.quote.lead_weeks != null ? `${r.l.quote.lead_weeks} wk` : '—') },
            { h: 'Outcome', w: 120, v: (r) => <Pill label={!r.latest ? 'Revised' : r.chosen ? 'Chosen' : r.l.quote.package?.selected_quote_id ? 'Not chosen' : 'Comparing'} tone={!r.latest ? colors.grey : r.chosen ? colors.green : r.l.quote.package?.selected_quote_id ? colors.grey : colors.blue} /> },
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
