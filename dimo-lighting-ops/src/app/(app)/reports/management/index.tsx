import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { levelTone } from '@/components/MgmtReportView';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ListRow, Muted, Notice, Pill, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { addMonths, fmtMonth, thisMonth } from '@/lib/finance';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { AREAS, buildManagementReport, type MgmtReport } from '@/lib/mgmtReport';
import { rpc, supabase } from '@/lib/supabase';

type Saved = { id: string; month: string; generated_by: string; generated_at: string; comments: string | null; data: Pick<MgmtReport, 'status' | 'flags'> };

/** Management report (GM / DGM): pick the month, generate – the report is built from the app's data and kept as a snapshot. */
export default function ManagementReports() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [month, setMonth] = useState(thisMonth());
  const { data, reload } = useLoad(async () => {
    const { data: r, error } = await supabase.from('mgmt_reports').select('id, month, generated_by, generated_at, comments, data->status, data->flags').order('generated_at', { ascending: false }).limit(60);
    if (error) throw new Error(error.message);
    return ((r ?? []) as unknown as (Omit<Saved, 'data'> & Saved['data'])[]).map((x) => ({ ...x, data: { status: x.status, flags: x.flags } })) as Saved[];
  });
  if (me.role !== 'gm') return <Screen><Notice>The management report is for the GM / DGM.</Notice></Screen>;
  const months = Array.from({ length: 18 }, (_, i) => addMonths(thisMonth(), -i));

  const generate = () =>
    dialog.run(async () => {
      const rep = await buildManagementReport(month);
      const id = await rpc<string>('save_mgmt_report', { p_month: month, p_data: rep });
      await reload();
      router.push(`/reports/management/${id}`);
    }, 'Report generated');

  return (
    <Screen onRefresh={reload} maxWidth={1000}>
      <Stack.Screen options={{ title: 'Management report' }} />
      <TestingBanner what="The management report" />
      <Card style={{ gap: 10 }}>
        <Muted>
          The whole business for the month and the year to date: P&L (OR file), invoicing against budget, sales against targets, cash (debtors, retentions, bonds), execution
          and warranty. Highlights and exceptions follow fixed rules – the figures come straight from the app. Each report is kept as it was generated, with your comments.
        </Muted>
        <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
          <View style={{ width: 220 }}>
            <Select label="Month" value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: fmtMonth(m) }))} />
          </View>
          <Button title="Generate management report" onPress={generate} />
        </Row>
      </Card>
      <Section title="Reports generated">
        {data?.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.map((r) => {
              const reds = (r.data.flags ?? []).filter((f) => f.level === 'red').length;
              return (
                <ListRow
                  key={r.id}
                  wrapRight
                  onPress={() => router.push(`/reports/management/${r.id}`)}
                  title={`${fmtMonth(r.month)}${r.comments ? ' · with comments' : ''}`}
                  subtitle={`Generated ${fmtDateTime(r.generated_at)} by ${people[r.generated_by]?.full_name ?? ''}`}
                  right={
                    <Row gap={4} wrap>
                      {AREAS.map((a) => (r.data.status?.[a.key] ? <Pill key={a.key} label={a.label} tone={levelTone[r.data.status[a.key]]} /> : null))}
                      {reds ? <Pill label={`${reds} red`} tone={colors.red} solid /> : null}
                    </Row>
                  }
                />
              );
            })}
          </Card>
        ) : (
          <Empty title="No reports yet" hint="Choose the month and press Generate" />
        )}
      </Section>
    </Screen>
  );
}
