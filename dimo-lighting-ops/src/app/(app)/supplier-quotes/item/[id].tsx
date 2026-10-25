import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { ReportBody, reportExcel, reportPdf } from '@/components/SqReportView';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Row, Screen, Section, Segmented, Select } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { itemReport, loadReportData } from '@/lib/supplierReports';
import { supabase } from '@/lib/supabase';

type Period = 'all' | 'fy' | '12m';
const periodOf = (p: Period) => {
  const t = todayISO(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return p === 'fy' ? { from: `${m >= 4 ? y : y - 1}-04-01`, to: t } : p === '12m' ? { from: `${y - 1}${t.slice(4)}`, to: t } : { from: '2000-01-01', to: t };
};

/** Everything quoted for one item: every supplier and manufacturer over time and on every job, one of them against the others – and the suppliers' own names for it */
export default function ItemHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sqAccess, profile } = useAuth();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [d, al] = await Promise.all([loadReportData(), supabase.from('sq_item_aliases').select('alias, supplier:sq_suppliers(name)').eq('item_id', id)]);
    return { ...d, aliases: (al.data ?? []) as unknown as { alias: string; supplier: { name: string } | null }[] };
  }, [id]);
  const [period, setPeriod] = useState<Period>('all');
  const [focus, setFocus] = useState('');
  const pr = periodOf(period);
  const rep = useMemo(() => (data ? itemReport(data, id, pr.from, pr.to, focus || undefined) : null), [data, id, period, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sqAccess) return <Screen><Notice tone={colors.amber}>No access to supplier quotes.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const item = data.items.find((i) => i.id === id);
  if (!item || !rep) return <Screen><ErrorBanner message="Item not found" /></Screen>;
  // suppliers who quoted this item first, then the rest
  const quoted = new Set(data.quotes.filter((q) => q.lines.some((l) => l.item_id === id)).map((q) => q.supplier_id));
  const supOpts = [{ value: '', label: 'All suppliers and manufacturers' }, ...data.sups.filter((s) => quoted.has(s.id)).map((s) => ({ value: s.id, label: s.name }))];
  const focusName = data.sups.find((s) => s.id === focus)?.name;
  const meta = () => ({
    key: 'supplier_item', title: `${item.name} – price history`, filters: [item.code, item.sap_code ? `SAP ${item.sap_code}` : null, focusName ? `focus: ${focusName}` : 'all suppliers and manufacturers'].filter(Boolean).join(' · '),
    period: `${pr.from === '2000-01-01' ? 'all time' : pr.from} to ${pr.to}`, currencyNote: 'LKR per unit delivered – exchange rate of the quote, freight and discount included',
    generatedBy: `${profile?.full_name ?? ''} – ${profile ? ROLE_SHORT[profile.role] : ''}`, landscape: true,
  });
  const edit = async () => {
    const r = await dialog.prompt({ title: 'Edit item', fields: [{ key: 'code', label: 'Item code', required: true, initial: item.code }, { key: 'name', label: 'Name', required: true, initial: item.name }, { key: 'unit', label: 'Unit', initial: item.unit ?? '' }, { key: 'sap', label: 'SAP code', initial: item.sap_code ?? '' }] });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('sq_items').update({ code: r.code.trim().toUpperCase(), name: r.name.trim(), unit: r.unit?.trim() || null, sap_code: r.sap?.trim() || null }).eq('id', item.id);
      if (e) throw new Error(/duplicate|unique/i.test(e.message) ? 'Another item has this code' : e.message);
      reload();
    }, 'Saved');
  };
  return (
    <Screen maxWidth={1400}>
      <Stack.Screen options={{ title: item.name }} />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{[item.code, item.sap_code && `SAP ${item.sap_code}`, item.unit].filter(Boolean).join(' · ')}</Muted>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{item.name}</Text>
        </View>
        <Row wrap gap={8}>
          <Button variant="secondary" title="Export PDF" onPress={() => dialog.run(() => reportPdf(rep, meta(), focusName ? `${focusName} against every other supplier and manufacturer who quoted this item.` : 'Every supplier and manufacturer who quoted this item, over time and on every job.'))} />
          <Button variant="secondary" title="Excel" onPress={() => dialog.run(() => reportExcel(rep, meta()))} />
          <Button variant="ghost" title="Edit item" onPress={edit} />
        </Row>
      </Row>
      <Card>
        <Row wrap gap={10} style={{ alignItems: 'flex-end' }}>
          <Segmented value={period} onChange={setPeriod} options={[{ value: 'all', label: 'All time' }, { value: 'fy', label: 'This financial year' }, { value: '12m', label: 'Last 12 months' }]} />
          <View style={{ minWidth: 260, flexGrow: 1 }}><Select label="Focus on one supplier / manufacturer" searchable value={focus} onChange={(v) => setFocus(v ?? '')} options={supOpts} /></View>
        </Row>
      </Card>
      <ReportBody rep={rep} />
      <Section title="Also known as">
        <Card>
          <Muted>{'The suppliers\' own names for this item – matched by themselves on the next quote.'}</Muted>
          {data.aliases.length ? data.aliases.map((a, i) => <Text key={i} style={{ color: colors.ink }}>{`"${a.alias}"${a.supplier ? ` – ${a.supplier.name}` : ''}`}</Text>) : <Muted>None yet.</Muted>}
        </Card>
      </Section>
    </Screen>
  );
}
