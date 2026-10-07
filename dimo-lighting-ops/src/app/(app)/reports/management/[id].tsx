import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { useDialog } from '@/components/dialog';
import { MgmtReportView } from '@/components/MgmtReportView';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Field, Loading, Muted, Notice, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtMonth } from '@/lib/finance';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import type { MgmtReport } from '@/lib/mgmtReport';
import { exportMgmtReport } from '@/lib/mgmtReportPdf';
import { ROLE_LABELS } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';

type Saved = { id: string; month: string; data: MgmtReport; comments: string | null; generated_by: string; generated_at: string; comments_at: string | null };

/** One generated management report: figures as they were when generated, management comments, PDF. */
export default function ManagementReport() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [comments, setComments] = useState<string | null>(null);
  const { data, error, reload } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('mgmt_reports').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    return r as Saved;
  }, [id]);
  if (me.role !== 'gm') return <Screen><Notice>The management report is for the GM / DGM.</Notice></Screen>;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const text = comments ?? data.comments ?? '';
  const dirty = text !== (data.comments ?? '');

  const save = () => dialog.run(async () => { await rpc('save_mgmt_comments', { p_id: id, p_comments: text }); setComments(null); await reload(); }, 'Comments saved');
  const pdf = () =>
    dialog.run(async () => {
      if (dirty) await rpc('save_mgmt_comments', { p_id: id, p_comments: text });
      const { data: logo } = await supabase.from('settings').select('value').eq('key', 'report_logo_url').maybeSingle();
      await exportMgmtReport(data.data, text || null, `${me.full_name} – ${ROLE_LABELS[me.role]}`, (logo?.value as string | null) ?? null);
    });
  const remove = async () => {
    if (!(await dialog.confirm('Delete this report?', 'The saved snapshot and its comments are removed.', { confirmLabel: 'Delete', danger: true }))) return;
    await dialog.run(async () => { await rpc('delete_mgmt_report', { p_id: id }); router.replace('/reports/management'); }, 'Deleted');
  };

  return (
    <Screen onRefresh={reload} maxWidth={1100}>
      <Stack.Screen options={{ title: `Management report – ${fmtMonth(data.month)}` }} />
      <TestingBanner what="The management report" />
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{`Management report – ${fmtMonth(data.month)}`}</Text>
      <Muted>{`Generated ${fmtDateTime(data.generated_at)} by ${people[data.generated_by]?.full_name ?? ''} · figures as they were then – generate again for the latest`}</Muted>
      <Row gap={8} wrap>
        <Button title="Download PDF" icon="⇩" onPress={pdf} />
        <Button title="Generate again" variant="secondary" onPress={() => router.push('/reports/management')} />
        <Button title="Delete" variant="secondary" onPress={remove} />
      </Row>
      <MgmtReportView r={data.data} />
      <Section title="Management comments">
        <Card style={{ gap: 8 }}>
          <Field label="Your comments (printed on the PDF)" value={text} onChangeText={setComments} multiline placeholder="Actions agreed, explanations, decisions …" />
          <Row gap={8} style={{ alignItems: 'center' }}>
            <Button title="Save comments" onPress={save} disabled={!dirty} />
            {data.comments_at ? <Muted>{`Last saved ${fmtDateTime(data.comments_at)}`}</Muted> : null}
          </Row>
        </Card>
      </Section>
    </Screen>
  );
}
