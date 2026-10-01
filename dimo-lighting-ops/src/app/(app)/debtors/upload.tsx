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

// Client, invoice number, amount, currency and days are required; project and sales person are optional
const TEMPLATE = ['Project name (optional)', 'Client', 'Invoice number', 'Invoice date', 'Outstanding amount', 'Currency', 'Outstanding days', 'Sales person (optional)'];
const KEYS = ['project_name', 'client_name', 'invoice_no', 'invoice_date', 'amount', 'currency', 'outstanding_days', 'sales_person'] as const;

type UploadRow = {
  id: number;
  row_no: number;
  project_name: string | null;
  client_name: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  amount: number | null;
  currency: 'LKR' | 'USD' | null;
  outstanding_days: number | null;
  project_id: string | null;
  sales_person_id: string | null;
  errors: string[];
  warnings: string[];
};

function cellToString(v: unknown) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/**
 * Weekly debtors upload (Section 12.2): parse → validate and match on the server → preview → confirm.
 * The list is independent of the project register: unmatched projects, customers or sales people are warnings,
 * and rows can optionally be linked here or later on the debt.
 */
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
      // Column names are matched without "(optional)" so older files with the previous headers still work
      const norm = (h: string) => h.toLowerCase().replace(/\(optional\)/g, '').trim();
      const header = sheet[0].map((h) => norm(cellToString(h)));
      const idx = TEMPLATE.map((t) => header.indexOf(norm(t)));
      const optional = ['project name', 'sales person', 'invoice date'];
      const missing = TEMPLATE.filter((t, i) => idx[i] < 0 && !optional.includes(norm(t)));
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
    const { data: sales } = await supabase.from('profiles').select('id, full_name').in('role', ['asm_building', 'asm_infra']).eq('active', true).order('full_name');
    const r = await dialog.prompt({
      title: `Link row ${row.row_no}: ${row.client_name ?? ''}`,
      message: 'Optional – link the invoice to a project in the system and / or a sales person.',
      fields: [
        { key: 'q', label: 'Search the project register (optional)', initial: row.project_name ?? '' },
        { key: 'sp', label: 'Sales person (optional)', type: 'select', options: (sales ?? []).map((x) => ({ value: x.id, label: x.full_name })) },
      ],
    });
    if (!r || (!r.q && !r.sp)) return;
    let project: string | null = null;
    if (r.q) {
      const matches = await rpc<{ id: string; name: string; customer: string; owner: string }[]>('lookup_projects_basic', { p_query: r.q });
      if (!matches.length && !r.sp) return dialog.toast('No project found – the row can stay unlinked', 'error');
      if (matches.length) {
        const pick = await dialog.prompt({
          title: 'Choose the project',
          fields: [{ key: 'p', label: 'Project', type: 'select', required: true, options: matches.map((m) => ({ value: m.id, label: `${m.name} – ${m.customer}`, hint: m.owner })) }],
        });
        if (!pick) return;
        project = pick.p;
      }
    }
    await dialog.run(async () => {
      await rpc('map_debtor_row', { p_row: row.id, p_project: project, p_sales_person: r.sp || null });
      await preview.reload();
    }, 'Linked');
  };

  const fixRow = async (row: UploadRow) => {
    const r = await dialog.prompt({
      title: `Fix row ${row.row_no}`,
      message: row.errors.length ? `Problem: ${row.errors.join('; ')}` : undefined,
      fields: [
        { key: 'client_name', label: 'Client', required: true, initial: row.client_name ?? '' },
        { key: 'invoice_no', label: 'Invoice number', required: true, initial: row.invoice_no ?? '' },
        { key: 'invoice_date', label: 'Invoice date (optional)', type: 'date', initial: row.invoice_date ?? undefined },
        { key: 'amount', label: 'Outstanding amount', required: true, initial: row.amount == null ? '' : String(row.amount) },
        { key: 'currency', label: 'Currency', type: 'select', required: true, initial: row.currency ?? undefined, options: [{ value: 'LKR', label: 'LKR' }, { value: 'USD', label: 'USD' }] },
        { key: 'outstanding_days', label: 'Outstanding days', required: true, initial: row.outstanding_days == null ? '' : String(row.outstanding_days) },
        { key: 'project_name', label: 'Project name (optional)', initial: row.project_name ?? '' },
      ],
    });
    if (!r) return;
    const amount = Number(String(r.amount).replace(/,/g, ''));
    const days = Number(String(r.outstanding_days).replace(/,/g, ''));
    if (!Number.isFinite(amount)) return dialog.toast('The outstanding amount must be a number', 'error');
    if (!Number.isInteger(days) || days < 0) return dialog.toast('Outstanding days must be a whole number', 'error');
    await dialog.run(async () => {
      await rpc('edit_debtor_row', { p_row: row.id, p_data: { ...r, amount: String(amount), outstanding_days: String(days), invoice_date: r.invoice_date || '' } });
      await preview.reload();
    }, 'Row updated');
  };

  const removeRow = async (row: UploadRow) => {
    const ok = await dialog.confirm(
      `Remove row ${row.row_no}?`,
      `${row.client_name ?? ''} ${row.invoice_no ?? ''}\nUse this for totals or blank lines. A removed invoice is treated as not in this week's list – if it is already in the system it will be cleared when you confirm.`,
      { confirmLabel: 'Remove', danger: true },
    );
    if (!ok) return;
    await dialog.run(async () => {
      await rpc('remove_debtor_row', { p_row: row.id });
      await preview.reload();
    }, 'Row removed');
  };

  const pv = preview.data;
  const editable = pv?.upload.status === 'preview';
  const errorRows = (pv?.rows ?? []).filter((r) => r.errors.length);
  const rowActions = (r: UploadRow) =>
    !editable ? undefined : r.errors.length ? (
      <Row gap={6}>
        <Button small title="Fix" onPress={() => fixRow(r)} />
        <Button small variant="secondary" title="Remove" onPress={() => removeRow(r)} />
      </Row>
    ) : r.warnings?.length ? (
      <Button small variant="secondary" title="Link" onPress={() => mapRow(r)} />
    ) : undefined;
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
              <Pill label={`${pv.rows.filter((r) => r.warnings?.length).length} not linked (optional)`} tone={colors.amber} />
              <Pill label={fmtMoney(pv.upload.totals?.LKR ?? 0, 'LKR')} tone={colors.blue} />
              <Pill label={fmtMoney(pv.upload.totals?.USD ?? 0, 'USD')} tone={colors.blue} />
            </Row>
            {pv.upload.error_count ? (
              <Notice tone={colors.red}>Rows in red have missing or invalid data. Press “Fix” to correct a row here, or “Remove” for lines that are not invoices (e.g. totals). Confirm unlocks when no errors are left.</Notice>
            ) : null}
            <Muted>Rows in amber are not linked to a project, customer or sales person in the system. They upload as they are; link them now with “Link”, or later on the debt.</Muted>
          </Card>
          {errorRows.length ? (
            <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8, borderColor: colors.red }}>
              <View style={{ padding: 12, paddingBottom: 4 }}>
                <Text style={{ fontWeight: '700', color: colors.red }}>Rows with errors ({errorRows.length})</Text>
              </View>
              {errorRows.map((r) => (
                <ListRow
                  key={r.id}
                  title={`Row ${r.row_no}: ${r.client_name || '(no client)'} · ${r.invoice_no || '(no invoice no.)'}`}
                  subtitle={`Problem: ${r.errors.join('; ')}`}
                  highlight={colors.red}
                  right={rowActions(r)}
                />
              ))}
            </Card>
          ) : null}
          <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
            {pv.rows.map((r) => (
              <ListRow
                key={r.id}
                title={`${r.row_no}. ${r.client_name ?? ''} · ${r.invoice_no ?? '—'}`}
                subtitle={`${r.project_name ?? 'No project'} · ${fmtMoney(r.amount, r.currency)} · ${r.outstanding_days ?? '—'} days${[...r.errors, ...(r.warnings ?? [])].length ? ` · ${[...r.errors, ...(r.warnings ?? [])].join(', ')}` : ''}`}
                highlight={r.errors.length ? colors.red : r.warnings?.length ? colors.amber : undefined}
                right={rowActions(r)}
              />
            ))}
          </Card>
          {editable ? (
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
