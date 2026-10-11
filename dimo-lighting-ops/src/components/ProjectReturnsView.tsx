import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { readSheet } from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Grid, ListRow, Loading, Muted, Pill, Row, Section, Select, Stat, styles } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { exportExcel, exportPdf } from '@/lib/export';
import { pickDocument } from '@/lib/files';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { CONDITIONS, conditionTone, ORIGIN, parseReturnsSheet, type ReturnItem, type ReturnMove, RETURNS_TEMPLATE } from '@/lib/returns';
import { ROLE_SHORT } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';

/** Project returns: balance material left over from projects – added one by one, by Excel upload, or from a project at handover. */
export function ProjectReturnsView() {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [q, setQ] = useState('');
  const [cond, setCond] = useState('');
  const [show, setShow] = useState('available');
  const [open, setOpen] = useState<string | null>(null);
  const manage = ['operations_exec', 'senior_elec_engineer', 'sm_projects'].includes(me.role);
  const ops = me.role === 'operations_exec';
  const { data, error, reload } = useLoad(() => rpc<ReturnItem[]>('project_returns'));
  const moves = useLoad(async () => {
    if (!open) return [];
    const { data: m } = await supabase.from('project_return_moves').select('*').eq('item_id', open).order('at', { ascending: false });
    return (m ?? []) as ReturnMove[];
  }, [open]);
  if (!data) return error ? <ErrorBanner message={error} /> : <Loading />;

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = data.filter(
    (r) =>
      (!cond || r.condition === cond) &&
      (show === 'all' || (show === 'available' ? r.balance > 0 : show === 'reserved' ? r.reserved > 0 : r.balance <= 0)) &&
      words.every((w) => [r.item, r.mpn, r.code, r.source, r.location].some((x) => x?.toLowerCase().includes(w))),
  );

  const add = async () => {
    const r = await dialog.prompt({
      title: 'Add a returned item',
      fields: [
        { key: 'item', label: 'Description', required: true },
        { key: 'mpn', label: 'Part number' },
        { key: 'qty', label: 'Quantity', required: true },
        { key: 'unit', label: 'Unit', required: true, initial: 'nos' },
        { key: 'condition', label: 'Condition', type: 'select', initial: 'good', options: CONDITIONS },
        { key: 'location', label: 'Kept at' },
        { key: 'source_text', label: 'Source project' },
        { key: 'note', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: 'Add',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('add_project_returns', { p_rows: [r], p_origin: 'manual' });
        await reload();
      }, 'Added');
  };
  const template = async () => {
    const blob = await writeXlsxFile([RETURNS_TEMPLATE.map((h) => ({ value: h, fontWeight: 'bold' as const }))] as never).toBlob();
    if (Platform.OS === 'web') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Project_returns_template.xlsx';
      a.click();
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const f = new FsFile(Paths.cache, 'Project_returns_template.xlsx');
      f.create({ overwrite: true });
      f.write(String(reader.result).split(',')[1] ?? '', { encoding: 'base64' });
      await Sharing.shareAsync(f.uri);
    };
    reader.readAsDataURL(blob);
  };
  const upload = async () => {
    const file = await pickDocument();
    if (!file) return;
    const bytes = file.webFile ? await file.webFile.arrayBuffer() : await new FsFile(file.uri).arrayBuffer();
    let rows: Record<string, string>[];
    try {
      rows = parseReturnsSheet((await readSheet(bytes)) as unknown[][]);
    } catch (e) {
      return dialog.toast((e as Error).message, 'error');
    }
    if (!rows.length) return dialog.toast('No lines in the file', 'error');
    const ok = await dialog.confirm(
      `Add ${rows.length} item(s)?`,
      rows.slice(0, 12).map((r) => `${r.item} – ${r.qty} ${r.unit}`).join('\n') + (rows.length > 12 ? `\n… and ${rows.length - 12} more` : ''),
      { confirmLabel: 'Add all' },
    );
    if (ok)
      await dialog.run(async () => {
        const n = await rpc<number>('add_project_returns', { p_rows: rows, p_origin: 'upload' });
        await reload();
        dialog.toast(`${n} item(s) added`);
      });
  };
  const edit = async (r: ReturnItem) => {
    const v = await dialog.prompt({
      title: r.item,
      fields: [
        { key: 'item', label: 'Description', required: true, initial: r.item },
        { key: 'mpn', label: 'Part number', initial: r.mpn ?? '' },
        { key: 'condition', label: 'Condition', type: 'select', initial: r.condition, options: CONDITIONS },
        { key: 'location', label: 'Kept at', initial: r.location ?? '' },
        { key: 'category', label: 'Category', initial: r.category ?? '' },
        { key: 'note', label: 'Note', type: 'multiline', initial: r.note ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (v) await dialog.run(async () => { await rpc('update_project_return', { p_id: r.id, p: v }); await reload(); }, 'Saved');
  };
  const adjust = async (r: ReturnItem) => {
    const v = await dialog.prompt({
      title: `Adjust ${r.item}`,
      message: `Balance ${fmtNumber(r.balance, 2)} ${r.unit}${r.reserved ? ` (${fmtNumber(r.reserved, 2)} reserved by material requests)` : ''}. Enter + or − (e.g. -2 for damaged).`,
      fields: [
        { key: 'c', label: 'Change', required: true },
        { key: 'r', label: 'Reason', type: 'multiline', required: true },
      ],
      confirmLabel: 'Adjust',
    });
    if (v) await dialog.run(async () => { await rpc('adjust_project_return', { p_id: r.id, p_change: Number(v.c), p_reason: v.r }); await reload(); moves.reload(); }, 'Adjusted');
  };
  const doExport = (kind: 'pdf' | 'excel') =>
    dialog.run(async () => {
      const col = (header: string, get: (r: ReturnItem) => unknown, align?: 'right') => ({ header, value: (x: Record<string, unknown>) => get(x as unknown as ReturnItem) as string | number, align });
      const columns = [
        col('Code', (r) => r.code ?? ''),
        col('Description', (r) => r.item),
        col('Part no.', (r) => r.mpn ?? ''),
        col('Condition', (r) => r.condition),
        col('Kept at', (r) => r.location ?? ''),
        col('Source', (r) => r.source ?? ''),
        col('Unit', (r) => r.unit),
        col('Balance', (r) => r.balance, 'right'),
        col('Reserved', (r) => r.reserved || '', 'right'),
        col('Available', (r) => r.available, 'right'),
      ];
      const meta = { key: 'project_returns', title: 'Project returns stock', filters: [cond && `Condition: ${cond}`, q && `Search: ${q}`].filter(Boolean).join(' · ') || 'All items', generatedBy: `${me.full_name} – ${ROLE_SHORT[me.role]}`, landscape: true };
      const sections = [{ rows: shown as unknown as Record<string, unknown>[], totals: { Code: `${shown.length} items` } }];
      return kind === 'pdf' ? exportPdf(meta, columns, sections) : exportExcel(meta, columns, sections);
    });

  const available = data.filter((r) => r.balance > 0);
  return (
    <>
      <Grid min={170} max={4}>
        <Stat label="Items in stock" value={fmtNumber(available.length)} />
        <Stat label="Reserved for projects" value={fmtNumber(data.filter((r) => r.reserved > 0).length)} sub="by open material requests" />
        <Stat label="From handovers" value={fmtNumber(available.filter((r) => r.origin === 'dlp').length)} />
        <Stat label="Damaged" value={fmtNumber(available.filter((r) => r.condition === 'damaged').length)} tone={available.some((r) => r.condition === 'damaged') ? 'amber' : undefined} />
      </Grid>
      <Card>
        <Row wrap gap={8}>
          {manage ? <Button title="+ Add item" onPress={add} /> : null}
          {manage ? <Button variant="secondary" title="Upload Excel" icon="⇪" onPress={upload} /> : null}
          {manage ? <Button variant="secondary" title="Template" onPress={() => dialog.run(template)} /> : null}
          <Button variant="secondary" title="PDF" onPress={() => doExport('pdf')} />
          <Button variant="secondary" title="Excel" onPress={() => doExport('excel')} />
        </Row>
        <TextInput value={q} onChangeText={setQ} placeholder="Search description, part number, code, source or location" placeholderTextColor={colors.faint} style={styles.input} />
        <Row wrap gap={8}>
          <View style={{ minWidth: 180, flex: 1 }}>
            <Select label="Show" value={show} onChange={setShow} options={[
              { value: 'available', label: 'In stock' },
              { value: 'reserved', label: 'Reserved' },
              { value: 'used', label: 'Used up' },
              { value: 'all', label: 'All' },
            ]} />
          </View>
          <View style={{ minWidth: 180, flex: 1 }}>
            <Select label="Condition" value={cond} onChange={setCond} options={[{ value: '', label: 'Any' }, ...CONDITIONS]} />
          </View>
        </Row>
        <Muted>Material is taken from here through a material request: when an engineer picks an item, matching returns are shown; it is reserved, and booked out when received on site.</Muted>
      </Card>
      <Section title={`Items (${shown.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {shown.length ? (
            shown.map((r) => (
              <ListRow
                key={r.id}
                wrapRight
                onPress={() => setOpen(open === r.id ? null : r.id)}
                title={r.item}
                subtitle={
                  <>
                    <Muted>{[r.code, r.mpn ? `part ${r.mpn}` : null, r.source ? `from ${r.source}` : null, r.location ? `at ${r.location}` : null, ORIGIN[r.origin]].filter(Boolean).join(' · ')}</Muted>
                    {open === r.id ? (
                      <View style={{ gap: 4, marginTop: 6 }}>
                        {r.note ? <Muted>{r.note}</Muted> : null}
                        {(moves.data ?? []).map((m) => (
                          <Muted key={m.id} style={{ color: m.qty < 0 ? colors.red : colors.ink }}>
                            {`${fmtDateTime(m.at)} · ${m.qty > 0 ? '+' : ''}${fmtNumber(m.qty, 2)} ${r.unit} · ${m.note ?? m.kind}${m.by_id ? ` · ${people[m.by_id]?.full_name ?? ''}` : ''}`}
                          </Muted>
                        ))}
                        <Row gap={6}>
                          {manage ? <Button small variant="secondary" title="Edit" onPress={() => edit(r)} /> : null}
                          {ops ? <Button small variant="secondary" title="Adjust balance" onPress={() => adjust(r)} /> : null}
                        </Row>
                      </View>
                    ) : null}
                  </>
                }
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ fontWeight: '700', color: colors.ink }}>{`${fmtNumber(r.available, 2)} ${r.unit}`}</Text>
                    {r.reserved ? <Muted>{`${fmtNumber(r.reserved, 2)} reserved`}</Muted> : null}
                    <Pill label={r.condition} tone={conditionTone(r.condition)} />
                  </View>
                }
              />
            ))
          ) : (
            <Empty title="No project returns" hint={manage ? 'Add items one by one, upload the Excel template, or return leftovers from a project at handover.' : undefined} />
          )}
        </Card>
      </Section>
      <Muted>{`Updated ${data[0]?.last_move ? fmtDate(data.reduce((a, r) => (r.last_move && r.last_move > a ? r.last_move : a), '')) : '—'}`}</Muted>
    </>
  );
}
