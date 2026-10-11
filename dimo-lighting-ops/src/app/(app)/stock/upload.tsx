import { File as FsFile } from 'expo-file-system';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { readSheet } from 'read-excel-file/universal';
import { AgeBars, lkr } from '@/components/StockBits';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, Grid, ListRow, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { pickDocument, uploadAttachment } from '@/lib/files';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { parseStockSheet, type StockLine } from '@/lib/stock';
import { rpc, supabase } from '@/lib/supabase';

type Snap = {
  id: string;
  as_at: string;
  profit_center: string;
  status: string;
  item_count: number;
  total_qty: number;
  total_value: number;
  warnings: { uncategorised?: number; ageing_mismatch?: number; sap_na?: number; duplicates?: number };
  uploaded_at: string;
  confirmed_at: string | null;
  replace_reason: string | null;
};

/** Operations: upload the SAP stock ageing report as it comes from SAP → check the preview → confirm. */
export default function StockUpload() {
  const me = useMe();
  const dialog = useDialog();
  const [stagedId, setStagedId] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const history = useLoad(async () => {
    const { data } = await supabase.from('stock_snapshots').select('*').in('status', ['confirmed', 'replaced']).order('as_at', { ascending: false }).limit(24);
    return (data ?? []) as Snap[];
  });
  const preview = useLoad(async () => {
    if (!stagedId) return null;
    const [{ data: snap }, lines] = await Promise.all([
      supabase.from('stock_snapshots').select('*').eq('id', stagedId).single(),
      rpc<StockLine[]>('stock_lines', { p_snapshot: stagedId }),
    ]);
    return { snap: snap as Snap, lines };
  }, [stagedId]);

  if (me.role !== 'operations_exec') return <Screen><ErrorBanner message="The Operations Executive uploads the SAP stock report." /></Screen>;

  const pick = async () => {
    setError(null);
    const file = await pickDocument();
    if (!file) return;
    await dialog.run(async () => {
      const bytes = file.webFile ? await file.webFile.arrayBuffer() : await new FsFile(file.uri).arrayBuffer();
      const parsed = parseStockSheet((await readSheet(bytes)) as never);
      const id = await rpc<string>('stage_stock_upload', { p_meta: parsed.meta, p_rows: parsed.rows });
      await uploadAttachment('stock_snapshot', id, 'stock_file', file).catch(() => undefined);
      setIgnored(parsed.columnsIgnored);
      setStagedId(id);
    }, 'File read – check the preview and confirm');
  };

  const pv = preview.data;
  const existing = pv ? history.data?.find((h) => h.status === 'confirmed' && h.as_at === pv.snap.as_at && h.profit_center === pv.snap.profit_center) : undefined;
  const prev = pv ? history.data?.find((h) => h.status === 'confirmed' && h.as_at < pv.snap.as_at && h.profit_center === pv.snap.profit_center) : undefined;

  const confirm = async () => {
    if (!pv) return;
    let reason: string | null = null;
    if (existing) {
      const r = await dialog.prompt({
        title: 'Replace the confirmed report?',
        message: `A report as at ${fmtDate(existing.as_at)} was confirmed ${fmtDateTime(existing.confirmed_at)}. It will be replaced.`,
        fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }],
        confirmLabel: 'Replace',
      });
      if (!r) return;
      reason = r.r;
    }
    await dialog.run(async () => {
      await rpc('confirm_stock_upload', { p_id: pv.snap.id, p_reason: reason });
      router.replace({ pathname: '/stock', params: { s: pv.snap.id } });
    }, 'Confirmed – GM / DGM and SM Projects are told');
  };
  const discard = async () => {
    if (!pv) return;
    await dialog.run(async () => {
      await rpc('discard_stock_upload', { p_id: pv.snap.id });
      setStagedId(null);
    }, 'Discarded');
  };

  const w = pv?.snap.warnings ?? {};
  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Upload SAP stock report' }} />
      <ErrorBanner message={error} />
      <Card>
        <Muted>
          Upload the SAP stock ageing report (Excel) exactly as it comes from SAP – no editing. The columns are found by their names; the date is taken from
          &quot;To Date&quot;. Only the useful columns are kept and SAP&apos;s 14 age bands are merged into 6. The original file is kept with the report.
        </Muted>
        <Button title="Choose the SAP Excel file" icon="⇪" onPress={pick} />
      </Card>

      {pv ? (
        <Section title={`Preview – as at ${fmtDate(pv.snap.as_at)} · profit centre ${pv.snap.profit_center}`}>
          <Grid min={170} max={4}>
            <Stat label="Items" value={fmtNumber(pv.snap.item_count)} sub={prev ? `${pv.lines.filter((l) => l.prev_qty == null).length} new since ${fmtDate(prev.as_at)}` : 'first report'} />
            <Stat label="Quantity" value={fmtNumber(Number(pv.snap.total_qty), 2)} />
            <Stat
              label="Closing value"
              value={lkr(pv.snap.total_value)}
              sub={prev ? `${pv.snap.total_value >= prev.total_value ? '+' : ''}${((100 * (pv.snap.total_value - prev.total_value)) / (prev.total_value || 1)).toFixed(1)}% vs ${fmtDate(prev.as_at)}` : undefined}
            />
            <Stat label="Older than 1 year" tone="amber" value={lkr(pv.lines.reduce((a, l) => a + (l.v4 ?? 0) + (l.v5 ?? 0) + (l.v6 ?? 0), 0))} />
          </Grid>
          <Card>
            <AgeBars lines={pv.lines} byValue />
          </Card>
          {existing ? <Notice tone={colors.amber}>{`A report as at ${fmtDate(existing.as_at)} is already confirmed – confirming replaces it (a reason is asked).`}</Notice> : null}
          <Card>
            <Row wrap gap={6}>
              <Pill label={`${w.uncategorised ?? 0} with no SAP category`} tone={w.uncategorised ? colors.amber : colors.green} />
              <Pill label={`${w.ageing_mismatch ?? 0} ageing ≠ closing stock`} tone={w.ageing_mismatch ? colors.red : colors.green} />
              <Pill label={`${w.sap_na ?? 0} SAP #N/A`} tone={w.sap_na ? colors.grey : colors.green} />
              {w.duplicates ? <Pill label={`${w.duplicates} duplicate lines skipped`} tone={colors.red} /> : null}
            </Row>
            {ignored.length ? <Muted>{`Not kept (${ignored.length}): ${ignored.join(', ')}`}</Muted> : null}
            <Row gap={8} style={{ justifyContent: 'flex-end' }}>
              <Button variant="secondary" title="Discard" onPress={discard} />
              <Button title={existing ? 'Confirm and replace' : 'Confirm'} onPress={confirm} />
            </Row>
          </Card>
        </Section>
      ) : null}

      <Section title="Uploaded reports">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {(history.data ?? []).map((h) => (
            <ListRow
              key={h.id}
              title={`${fmtDate(h.as_at)} · PC ${h.profit_center}`}
              subtitle={`${h.item_count} items · ${lkr(h.total_value)} · confirmed ${fmtDateTime(h.confirmed_at)}${h.replace_reason ? ` · ${h.replace_reason}` : ''}`}
              right={<Pill label={h.status === 'confirmed' ? 'Current' : 'Replaced'} tone={h.status === 'confirmed' ? colors.green : colors.grey} />}
              onPress={h.status === 'confirmed' ? () => router.push({ pathname: '/stock', params: { s: h.id } }) : undefined}
            />
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
