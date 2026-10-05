import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, Grid, KeyValue, Muted, Notice, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { findLine, fmtMonth, isFinanceDesk, mn, monthOf, readOrFile, seesPnl, type OrParsed, type OrUpload } from '@/lib/finance';
import { pickDocument } from '@/lib/files';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Monthly OR file (Finance's management P&L): feeds the P&L only. Invoicing is recorded on the secured projects. */
export default function OrUploadScreen() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [parsed, setParsed] = useState<(OrParsed & { fileName: string }) | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const history = useLoad(async () => {
    const { data, error: e } = await supabase.from('or_uploads').select('*').order('month', { ascending: false });
    if (e) throw new Error(e.message);
    return (data ?? []) as OrUpload[];
  });

  if (!isFinanceDesk(me.role)) {
    return (
      <Screen>
        <Notice>Only Operations, SM Projects or GM / DGM upload the OR file.</Notice>
      </Screen>
    );
  }

  const choose = async () => {
    setError(null);
    const file = await pickDocument();
    if (!file) return;
    await dialog.run(async () => {
      const p = await readOrFile(file);
      setParsed({ ...p, fileName: file.name });
      setMonth(p.month);
    });
  };

  const save = async () => {
    if (!parsed) return;
    if (!month) return setError('Set the month of the file');
    const m = monthOf(month);
    const exists = history.data?.some((u) => u.month === m);
    if (exists) {
      const ok = await dialog.confirm(`Replace ${fmtMonth(m)}?`, 'An OR file for this month is already loaded. The new file replaces it.', { confirmLabel: 'Replace' });
      if (!ok) return;
    }
    await dialog.run(async () => {
      await rpc('save_or_upload', { p_month: m, p_file_name: parsed.fileName, p_pnl: parsed.pnl, p_wbs: [] }); // P&L only – transactions are not used
      setParsed(null);
      await history.reload();
    }, 'OR file loaded – P&L updated');
  };

  const nt = parsed ? findLine(parsed.pnl.map((l) => ({ ...l, upload_id: '' })), 'Net Turnover', 'pnl') : null;
  const np = parsed ? findLine(parsed.pnl.map((l) => ({ ...l, upload_id: '' })), 'Net Profit', 'pnl') : null;

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'OR file upload' }} />
      <ErrorBanner message={error ?? history.error} />
      <Card>
        <Text style={{ fontWeight: '700', color: colors.ink }}>Monthly OR file</Text>
        <Muted>
          Upload Finance’s OR Excel each month – only its P&L sheet (e.g. “2230”) is used; any transaction / trial balance sheet is ignored.
          Invoicing is never taken from this file – it is recorded on each secured project when the invoice is raised. Loading a month again
          replaces it.
        </Muted>
        <Row wrap gap={8}>
          <Button title="Choose OR file" icon="⇪" onPress={choose} />
        </Row>
      </Card>

      {parsed ? (
        <Section title="Check before loading">
          <Card>
            <DateField label="Month of the file" value={month} onChange={setMonth} quick={[]} hint="Read from the file – change it if wrong (any day of the month)" />
            <Grid min={200}>
              <KeyValue label="P&L sheet" value={`${parsed.pnlSheet} · ${parsed.pnl.length} lines`} />
              <KeyValue label="Net turnover (month)" value={`LKR ${mn(nt?.m_act)} Mn`} />
              <KeyValue label="Net profit (month)" value={`LKR ${mn(np?.m_act)} Mn`} />
            </Grid>
            {!nt ? <Notice tone={colors.amber}>“Net Turnover” was not found in the P&L sheet – check that this is the OR file.</Notice> : null}
            <Row wrap gap={8}>
              <Button title="Load this file" onPress={save} />
              <Button variant="secondary" title="Cancel" onPress={() => setParsed(null)} />
            </Row>
          </Card>
        </Section>
      ) : null}

      <Section title="Loaded months">
        <DataTable
          rows={history.data ?? []}
          keyOf={(u) => u.id}
          onPress={seesPnl(me.role) ? () => router.push('/finance/pnl') : undefined}
          emptyTitle="No OR file loaded yet"
          columns={[
            { h: 'Month', w: 110, v: (u) => fmtMonth(u.month), bold: true },
            { h: 'Net turnover (Mn)', w: 130, right: true, v: (u) => mn(u.net_turnover) },
            { h: 'Net profit (Mn)', w: 120, right: true, v: (u) => mn(u.net_profit), tone: (u) => (Number(u.net_profit) < 0 ? colors.red : undefined) },
            { h: 'File', w: 240, v: (u) => u.file_name ?? '—' },
            { h: 'Loaded', w: 200, v: (u) => `${fmtDateTime(u.created_at)} · ${people[u.uploaded_by ?? '']?.full_name ?? '—'}` },
          ]}
        />
        <Muted>Load earlier months of this financial year too, so the P&L year-to-date is complete.</Muted>
      </Section>
    </Screen>
  );
}
