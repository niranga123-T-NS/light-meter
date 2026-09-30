import { File as FsFile, Paths } from 'expo-file-system';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { readSheet } from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, ListRow, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { pickDocument, uploadAttachment } from '@/lib/files';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const TEMPLATE = ['Project name', 'Client', 'Invoice number', 'Invoice date', 'Outstanding amount', 'Currency', 'Outstanding days', 'Sales person'];
const KEYS = ['project_name', 'client_name', 'invoice_no', 'invoice_date', 'amount', 'currency', 'outstanding_days', 'sales_person'] as const;

type UploadRow = {
  id: number;
  row_no: number;
  project_name: string | null;
  client_name: string | null;
  invoice_no: string | null;
  amount: number | null;
  currency: 'LKR' | 'USD' | null;
  outstanding_days: number | null;
  project_id: string | null;
  sales_person_id: string | null;
  errors: string[];
};

function cellToString(v: unknown) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Weekly debtors upload (Section 12.2): parse → validate and match on the server → preview → map → confirm. */
export default function DebtorsUpload() {
  const dialog = useDialog();
  const [asAt, setAsAt] = useState<string | null>(todayISO());
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const history = useLoad(async () => {
    const { data } = await supabase.from('debt_uploads').select('*').order('created_at', { ascending: false }).limit(20);
    return (data ?? []) as { id: string; as_at: string; status: string; row_count: number; error_count: number; totals: { LKR: number; USD: number }; created_at: string }[];
  });

  const preview = useLoad(async () => {
    if (!uploadId) return null;
    const [{ data: up }, { data: rows }] = await Promise.all([
      supabase.from('debt_uploads').select('*').eq('id', uploadId).single(),
      supabase.from('debt_upload_rows').select('*').eq('upload_id', uploadId).order('row_no'),
    ]);
    return { upload: up as { row_count: number; error_count: number; totals: { LKR: number; USD: number }; status: string }, rows: (rows ?? []) as UploadRow[] };
  }, [uploadId]);

  const downloadTemplate = async () => {
    const blob = await writeXlsxFile([TEMPLATE.map((h) => ({ value: h, fontWeight: 'bold' as const }))] as never).toBlob();
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Debtors_upload_template.xlsx';
      a.click();
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const f = new FsFile(Paths.cache, 'Debtors_upload_template.xlsx');
      f.create({ overwrite: true });
      f.write(String(reader.result).split(',')[1] ?? '', { encoding: 'base64' });
      await Sharing.shareAsync(f.uri);
    };
    reader.readAsDataURL(blob);
  };

  const pickAndStage = async () => {
    setError(null);
    if (!asAt) return setError('Set the as-at date');
    const file = await pickDocument();
    if (!file) return;
    await dialog.run(async () => {
      const bytes = file.webFile ? await file.webFile.arrayBuffer() : await new FsFile(file.uri).arrayBuffer();
      const sheet = await readSheet(bytes);
      if (!sheet.length) throw new Error('The file is empty');
      const header = sheet[0].map((h) => cellToString(h).toLowerCase());
      const idx = TEMPLATE.map((t) => header.indexOf(t.toLowerCase()));
      const missing = TEMPLATE.filter((t, i) => idx[i] < 0 && t !== 'Sales person' && t !== 'Invoice date');
      if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}. Use the standard template.`);
      const rows = sheet
        .slice(1)
        .filter((r) => r.some((c) => cellToString(c) !== ''))
        .map((r) => {
          const o: Record<string, string | number | null> = {};
          KEYS.forEach((k, i) => {
            const v = idx[i] >= 0 ? r[idx[i]] : null;
            o[k] = k === 'amount' || k === 'outstanding_days' ? (v == null || v === '' ? null : Number(String(v).replace(/,/g, ''))) : cellToString(v) || null;
          });
          if (typeof o.currency === 'string') o.currency = o.currency.toUpperCase();
          return o;
        });
      const id = await rpc<string>('stage_debtor_upload', { p_as_at: asAt, p_rows: rows });
      await uploadAttachment('debt_upload', id, 'debtors_file', file).catch(() => undefined);
      setUploadId(id);
      history.reload();
    }, 'File checked – review the preview');
  };

  const mapRow = async (row: UploadRow) => {
    const r = await dialog.prompt({ title: `Map row ${row.row_no}: ${row.project_name ?? ''}`, fields: [{ key: 'q', label: 'Search the project register', required: true, initial: row.project_name ?? '' }] });
    if (!r) return;
    const matches = await rpc<{ id: string; name: string; customer: string; owner: string }[]>('lookup_projects_basic', { p_query: r.q });
    if (!matches.length) return dialog.toast('No project found – ask sales to create it', 'error');
    const pick = await dialog.prompt({
      title: 'Choose the project',
      fields: [{ key: 'p', label: 'Project', type: 'select', required: true, options: matches.map((m) => ({ value: m.id, label: `${m.name} – ${m.customer}`, hint: m.owner })) }],
    });
    if (!pick) return;
    await dialog.run(async () => {
      await rpc('map_debtor_row', { p_row: row.id, p_project: pick.p });
      await preview.reload();
    }, 'Mapped');
  };

  const pv = preview.data;
  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Debtors upload' }} />
      <ErrorBanner message={error} />
      <Card>
        <Text style={{ fontWeight: '700' }}>Saturday debtors list</Text>
        <Muted>Upload the standard Excel template every Saturday evening. Each confirmed upload is a dated snapshot: new invoices are added, amounts and days updated, and invoices no longer in the file are cleared.</Muted>
        <DateField label="As at" value={asAt} onChange={setAsAt} quick={[0]} />
        <Row wrap gap={8}>
          <Button title="Choose Excel file" icon="⇪" onPress={pickAndStage} />
          <Button variant="secondary" title="Download template" onPress={() => dialog.run(downloadTemplate)} />
        </Row>
      </Card>

      {pv ? (
        <Section title="Preview">
          <Card>
            <Row wrap gap={8}>
              <Pill label={`${pv.upload.row_count} rows`} />
              <Pill label={`${pv.upload.error_count} with errors`} tone={pv.upload.error_count ? colors.red : colors.green} />
              <Pill label={fmtMoney(pv.upload.totals?.LKR ?? 0, 'LKR')} tone={colors.blue} />
              <Pill label={fmtMoney(pv.upload.totals?.USD ?? 0, 'USD')} tone={colors.blue} />
            </Row>
            {pv.upload.error_count ? <Notice tone={colors.amber}>Map every unmatched project and fix other errors (edit the file and upload again) before confirming.</Notice> : null}
          </Card>
          <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
            {pv.rows.map((r) => (
              <ListRow
                key={r.id}
                title={`${r.row_no}. ${r.client_name ?? ''} · ${r.invoice_no ?? '—'}`}
                subtitle={`${r.project_name ?? ''} · ${fmtMoney(r.amount, r.currency)} · ${r.outstanding_days ?? '—'} days${r.errors.length ? ` · ${r.errors.join(', ')}` : ''}`}
                highlight={r.errors.length ? colors.red : undefined}
                right={r.errors.some((e) => e.includes('not matched')) && pv.upload.status === 'preview' ? <Button small variant="secondary" title="Map" onPress={() => mapRow(r)} /> : undefined}
              />
            ))}
          </Card>
          {pv.upload.status === 'preview' ? (
            <Row style={{ marginTop: 12 }}>
              <Button
                title="Confirm upload"
                disabled={pv.upload.error_count > 0}
                onPress={() =>
                  dialog.run(async () => {
                    const res = await rpc<{ added: number; updated: number; cleared: number; mismatches: number }>('confirm_debtor_upload', { p_upload: uploadId });
                    dialog.toast(`Added ${res.added}, updated ${res.updated}, cleared ${res.cleared}, mismatches ${res.mismatches}`);
                    await preview.reload();
                    history.reload();
                  })
                }
              />
            </Row>
          ) : (
            <Notice tone={colors.green}>Confirmed.</Notice>
          )}
        </Section>
      ) : null}

      <Section title="Upload history">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {(history.data ?? []).map((u) => (
            <ListRow
              key={u.id}
              title={`As at ${fmtDate(u.as_at)}`}
              subtitle={`${u.row_count} rows · ${fmtMoney(u.totals?.LKR ?? 0, 'LKR')} · ${fmtMoney(u.totals?.USD ?? 0, 'USD')}`}
              right={<Pill label={u.status} tone={u.status === 'confirmed' ? colors.green : colors.amber} />}
              onPress={() => setUploadId(u.id)}
            />
          ))}
        </Card>
      </Section>
      <View style={{ height: 24 }} />
    </Screen>
  );
}
