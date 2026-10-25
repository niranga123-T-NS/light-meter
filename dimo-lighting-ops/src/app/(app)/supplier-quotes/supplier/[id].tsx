import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { ReportBody, reportExcel, reportPdf } from '@/components/SqReportView';
import { Button, colors, ErrorBanner, Loading, Muted, Notice, Row, Screen, Segmented } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { KIND_LABEL, originText } from '@/lib/supplierQuotes';
import { filterText, loadReportData, runReport, type RFilters } from '@/lib/supplierReports';

type Period = 'fy' | '12m' | 'all';
const periodOf = (p: Period) => {
  const t = todayISO(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return p === 'fy' ? { from: `${m >= 4 ? y : y - 1}-04-01`, to: t } : p === '12m' ? { from: `${y - 1}${t.slice(4)}`, to: t } : { from: '2000-01-01', to: t };
};

/** One supplier or manufacturer: score, prices against the market, head to head with every competitor on the same packages, each package */
export default function SupplierProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sqReports, profile } = useAuth();
  const dialog = useDialog();
  const { data, error } = useLoad(loadReportData, []);
  const [period, setPeriod] = useState<Period>('all');
  const f: RFilters = { ...periodOf(period), type: 'all', who: 'all', prices: 'final', supplier: id };
  const rep = useMemo(() => (data ? runReport('profile', data, f) : null), [data, id, period]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sqReports) return <Screen><Notice tone={colors.amber}>Supplier profiles are for the DGM, the SM Estimation and the people the DGM allows for the reports.</Notice></Screen>;
  if (!data || !rep) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const s = data.sups.find((x) => x.id === id);
  if (!s) return <Screen><ErrorBanner message="Supplier not found" /></Screen>;
  const meta = () => ({
    key: 'supplier_profile', title: `${s.name} – supplier profile`, filters: filterText(data, f), period: `${f.from} to ${f.to}`,
    currencyNote: 'LKR delivered – freight, discounts and priced-back exclusions included', generatedBy: `${profile?.full_name ?? ''} – ${profile ? ROLE_SHORT[profile.role] : ''}`, landscape: true,
  });
  return (
    <Screen maxWidth={1400}>
      <Stack.Screen options={{ title: s.name }} />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{[KIND_LABEL[s.kind], originText(s), s.trades, s.contact_name, s.phone, s.email].filter(Boolean).join(' · ')}</Muted>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{s.name}</Text>
          {s.address ? <Muted>{s.address}</Muted> : null}
        </View>
        <Row wrap gap={8} style={{ alignItems: 'center' }}>
          <Segmented value={period} onChange={setPeriod} options={[{ value: 'all', label: 'All time' }, { value: 'fy', label: 'This financial year' }, { value: '12m', label: 'Last 12 months' }]} />
          <Button variant="secondary" title="Export PDF" onPress={() => dialog.run(() => reportPdf(rep, meta(), 'Score, prices against the market and head to head with every competitor who quoted on the same packages.'))} />
          <Button variant="secondary" title="Excel" onPress={() => dialog.run(() => reportExcel(rep, meta()))} />
        </Row>
      </Row>
      <ReportBody rep={rep} />
    </Screen>
  );
}
