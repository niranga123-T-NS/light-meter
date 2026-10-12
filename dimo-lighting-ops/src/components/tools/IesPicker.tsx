import { useState } from 'react';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Muted, Row, Select, Toggle } from '@/components/ui';
import { pickDocument, readBytes } from '@/lib/files';
import { useLoad } from '@/lib/hooks';
import { beamAngle, iesPhotometry, parseIes } from '@/lib/photometry';
import { supabase } from '@/lib/supabase';

export type IesRow = { id: string; scope: 'library' | 'private'; name: string; manufacturer: string | null; file_name: string; lumens: number | null; watts: number | null; beam: number | null; uploaded_by: string };

/** An IES file for the fitting: from the DIMO library or the files I attached, or browse and attach one now */
export function IesPicker({ value, onChange, canLibrary }: { value: string | null; onChange: (row: IesRow | null) => void; canLibrary: boolean }) {
  const dialog = useDialog();
  const [toLibrary, setToLibrary] = useState(false);
  const { data, reload } = useLoad(async () => {
    const { data: rows, error } = await supabase.from('ies_files').select('id, scope, name, manufacturer, file_name, lumens, watts, beam, uploaded_by').eq('active', true).order('scope').order('name');
    if (error) throw new Error(error.message);
    return (rows ?? []) as IesRow[];
  }, []);
  const rows = data ?? [];

  const attach = () =>
    dialog.run(async () => {
      const file = await pickDocument();
      if (!file) return;
      if (!/\.ies$/i.test(file.name)) throw new Error('Choose an IES file (.ies)');
      const bytes = await readBytes(file);
      if (bytes.byteLength > 600000) throw new Error('The IES file is too large (up to 600 KB)');
      // IES files are plain ASCII / Latin-1: one byte, one character (works the same in the phone app)
      const u8 = new Uint8Array(bytes);
      let text = '';
      for (let i = 0; i < u8.length; i += 8192) text += String.fromCharCode(...u8.subarray(i, i + 8192));
      const d = parseIes(text.replace(/\0/g, ''));
      const ph = iesPhotometry(d);
      const name = (d.keywords.LUMINAIRE || d.keywords.LUMCAT || file.name.replace(/\.ies$/i, '')).slice(0, 200);
      const { data: row, error } = await supabase
        .from('ies_files')
        .insert({
          scope: canLibrary && toLibrary ? 'library' : 'private',
          name,
          manufacturer: d.keywords.MANUFAC || null,
          product_code: d.keywords.LUMCAT || null,
          file_name: file.name,
          lumens: d.lumens,
          watts: d.watts || null,
          len_mm: d.lenMm || null,
          wid_mm: d.widMm || null,
          beam: beamAngle(ph),
          up_share: Math.round(ph.up * 1000) / 1000,
          content: text.replace(/\0/g, ''),
        })
        .select('id, scope, name, manufacturer, file_name, lumens, watts, beam, uploaded_by')
        .single();
      if (error) throw new Error(error.message);
      await reload();
      onChange(row as IesRow);
    }, 'IES file attached');

  const label = (r: IesRow) => `${r.scope === 'library' ? 'DIMO library' : 'My file'} · ${r.name}${r.manufacturer ? ` (${r.manufacturer})` : ''}${r.lumens ? ` · ${Math.round(r.lumens)} lm` : ''}${r.watts ? ` · ${r.watts} W` : ''}${r.beam ? ` · ${r.beam}°` : ''}`;
  return (
    <View style={{ gap: 4 }}>
      <Select
        label="IES file"
        searchable
        value={value ?? ''}
        onChange={(v) => onChange(rows.find((r) => r.id === v) ?? null)}
        options={[{ value: '', label: rows.length ? '— choose from the uploaded files —' : '— no files yet: browse and attach one —' }, ...rows.map((r) => ({ value: r.id, label: label(r) }))]}
      />
      <Row gap={8} wrap style={{ alignItems: 'center' }}>
        <Button small variant="secondary" title="Browse and attach IES…" onPress={attach} />
        {canLibrary ? <Toggle label="Add to the DIMO library (for everyone)" value={toLibrary} onChange={setToLibrary} /> : null}
      </Row>
      <Muted>{canLibrary ? 'Files you attach are yours unless added to the library.' : 'Files you attach are kept for you; the DIMO library is kept by the Design team.'}</Muted>
    </View>
  );
}
