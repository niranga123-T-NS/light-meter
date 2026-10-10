import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, Empty, ErrorBanner, Loading, Muted, NumberField, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { exportExcel, exportPdf } from '@/lib/export';
import { addDaysISO, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { buildReport, Filters } from '@/lib/reports';
import { PROJECT_TYPES, reportsFor, ROLE_SHORT } from '@/lib/roles';
import { supabase } from '@/lib/supabase';

export default function ReportScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const def = reportsFor(me.role).find((r) => r.key === key);
  const [f, setF] = useState<Filters>({ from: addDaysISO(todayISO(), -30), to: todayISO(), projectType: null, threshold: 50, term: null, groupBy: 'sales_person', category: 'customer' });
  const [applied, setApplied] = useState(f);

  const { data, error, loading } = useLoad(async () => {
    if (!def) throw new Error('This report is not available for your role.');
    const built = await buildReport(key, applied, people);
    await supabase.from('report_runs').insert({ user_id: me.id, report_key: key, filters: applied, format: 'preview' });
    return built;
  }, [key, applied, Object.keys(people).length]);

  if (!def) return <Screen><ErrorBanner message="This report is not available for your role." /></Screen>;
  const meta = async () => {
    const { data: logo } = await supabase.from('settings').select('value').eq('key', 'report_logo_url').maybeSingle();
    return {
      key,
      title: def.title,
      filters: data?.filterText ?? '',
      period: `${applied.from} to ${applied.to}`,
      currencyNote: data?.currencyNote,
      generatedBy: `${me.full_name} – ${ROLE_SHORT[me.role]}`,
      landscape: data?.landscape,
      logoUrl: (logo?.value as string | undefined) ?? null,
    };
  };

  return (
    <Screen maxWidth={1400}>
      <Stack.Screen options={{ title: def.title }} />
      <Card>
        <Row wrap gap={8}>
          <View style={{ minWidth: 220, flex: 1 }}>
            <DateField label="From" value={f.from} onChange={(v) => v && setF((s) => ({ ...s, from: v }))} quick={[]} />
          </View>
          <View style={{ minWidth: 220, flex: 1 }}>
            <DateField label="To" value={f.to} onChange={(v) => v && setF((s) => ({ ...s, to: v }))} quick={[0]} />
          </View>
          <View style={{ minWidth: 200 }}>
            <Select label="Project type" value={f.projectType ?? ''} options={[{ value: '', label: 'All' }, ...PROJECT_TYPES.map((t) => ({ value: t.value, label: t.label }))]} onChange={(v) => setF((s) => ({ ...s, projectType: v || null }))} />
          </View>
          {key === 'win_probability' ? (
            <View style={{ minWidth: 160 }}>
              <NumberField label="Probability at or above %" value={f.threshold} onChange={(v) => setF((s) => ({ ...s, threshold: v }))} />
            </View>
          ) : null}
          {key === 'win_probability' || key === 'project_term' ? (
            <View style={{ minWidth: 180 }}>
              <Select
                label="Project term"
                value={f.term ?? ''}
                onChange={(v) => setF((s) => ({ ...s, term: v || null }))}
                options={[
                  { value: '', label: 'All terms' },
                  { value: 'short', label: 'Short term' },
                  { value: 'medium', label: 'Medium term' },
                  { value: 'long', label: 'Long term' },
                ]}
              />
            </View>
          ) : null}
          {key === 'inquiries_by_category' ? (
            <View style={{ minWidth: 200 }}>
              <Select
                label="Category"
                value={f.category ?? 'customer'}
                onChange={(v) => setF((s) => ({ ...s, category: v as Filters['category'] }))}
                options={[
                  { value: 'customer', label: 'Customer category' },
                  { value: 'project_type', label: 'Project type' },
                  { value: 'route', label: 'Route (A / B / C)' },
                ]}
              />
            </View>
          ) : null}
          {key === 'debtors' ? (
            <View style={{ minWidth: 180 }}>
              <Select
                label="Group within category by"
                value={f.groupBy}
                onChange={(v) => setF((s) => ({ ...s, groupBy: v as 'client' }))}
                options={[
                  { value: 'sales_person', label: 'Sales person' },
                  { value: 'client', label: 'Client' },
                ]}
              />
            </View>
          ) : null}
        </Row>
        <Row wrap gap={8}>
          <Button title="Run" onPress={() => setApplied(f)} />
          <Button variant="secondary" title="Export PDF" disabled={!data} onPress={() => dialog.run(async () => exportPdf(await meta(), data!.columns, data!.sections))} />
          <Button variant="secondary" title="Export Excel" disabled={!data} onPress={() => dialog.run(async () => exportExcel(await meta(), data!.columns, data!.sections))} />
        </Row>
        <Muted>Scope: {def.scope} · {data?.filterText}</Muted>
      </Card>
      <ErrorBanner message={error} />
      {loading && !data ? <Loading /> : null}
      {data?.sections.map((s, si) => (
        <Section key={si} title={s.heading ?? 'Results'}>
          <Card style={{ padding: 0, overflow: 'hidden', borderTopWidth: s.colour ? 4 : 1, borderTopColor: s.colour ?? colors.line }}>
            <ScrollView horizontal>
              <View>
                <Row gap={0} style={{ backgroundColor: colors.ink }}>
                  {data.columns.map((c) => (
                    <Text key={c.header} style={{ width: c.width ? c.width * 8 : 150, padding: 8, color: '#fff', fontWeight: '700', fontSize: 12, textAlign: c.align ?? 'left' }}>
                      {c.header}
                    </Text>
                  ))}
                </Row>
                {s.rows.map((r, i) => (
                  <Row key={i} gap={0} style={{ borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: i % 2 ? colors.soft : '#fff' }}>
                    {data.columns.map((c) => (
                      <Text key={c.header} style={{ width: c.width ? c.width * 8 : 150, padding: 8, fontSize: 13, textAlign: c.align ?? 'left' }} numberOfLines={2}>
                        {String(c.value(r) ?? '')}
                      </Text>
                    ))}
                  </Row>
                ))}
                {s.totals ? (
                  <Row gap={0} style={{ borderTopWidth: 2, borderTopColor: colors.ink }}>
                    {data.columns.map((c) => (
                      <Text key={c.header} style={{ width: c.width ? c.width * 8 : 150, padding: 8, fontWeight: '700', fontSize: 13, textAlign: c.align ?? 'left' }}>
                        {String(s.totals?.[c.header] ?? '')}
                      </Text>
                    ))}
                  </Row>
                ) : null}
              </View>
            </ScrollView>
          </Card>
        </Section>
      ))}
      {data && !data.sections.some((s) => s.rows.length) ? <Empty title="No records in this period" /> : null}
    </Screen>
  );
}
