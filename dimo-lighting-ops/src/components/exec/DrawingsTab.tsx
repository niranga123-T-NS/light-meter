import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useDialog, type PromptField } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ListRow, Muted, Notice, Pill, Row, Section, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { prepareDrawing } from '@/lib/drawingFile';
import { LMS_SYSTEMS, WEIGHT, type Drawing } from '@/lib/drawings';
import type { ExecProject } from '@/lib/execution';
import { pickDocument, pickImage, uuid } from '@/lib/files';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

export const DRAWING_EDIT_ROLES = ['senior_elec_engineer', 'sm_projects', 'assistant_engineer'];

const SCOPE_OPTIONS = [
  { value: 'services', label: 'Building services – lighting, power, ELV, data, fans & HVAC' },
  { value: 'lms', label: 'Lighting control (KNX, DALI, Casambi, Dynalite, DMX, 0–10 V)' },
  { value: 'bms', label: 'BMS' },
  { value: 'outdoor', label: 'Outdoor – street / area lighting poles, high masts, feeder pillars' },
];

/** Upload the project's drawings and open one to mark it up. The execution team uploads; everyone on the project sees them. */
export async function uploadDrawing(p: ExecProject, dialog: ReturnType<typeof useDialog>, existing?: Drawing) {
  const f = Platform.OS === 'web' ? await pickDocument() : await pickImage(false);
  if (!f) return null;
  let prep = await prepareDrawing(f);
  if (prep.pages > 1) {
    const r = await dialog.prompt({
      title: `The PDF has ${prep.pages} pages`,
      message: 'Each page is a separate drawing – choose the page to add now.',
      fields: [{ key: 'pg', label: 'Page', required: true, initial: '1', type: 'select', options: Array.from({ length: Math.min(prep.pages, 60) }, (_, i) => ({ value: String(i + 1), label: `Page ${i + 1}` })) }],
    });
    if (!r) return null;
    if (r.pg !== '1') prep = await prepareDrawing(f, Number(r.pg));
  }
  const info = await dialog.prompt({
    title: existing ? `New revision – ${existing.title}` : 'Add a drawing',
    message: existing ? 'Items and routes stay where they are – check them against the new revision.' : undefined,
    fields: [
      { key: 'title', label: 'Title', required: true, initial: existing?.title ?? f.name.replace(/\.[a-z0-9]+$/i, '') },
      { key: 'sheet_no', label: 'Drawing number', initial: existing?.sheet_no ?? '' },
      { key: 'floor', label: 'Floor / area', initial: existing?.floor ?? '' },
      ...((existing ? [] : [{ key: 'level', label: 'Floor order (−1 basement, 0 ground, 1, 2 …)', initial: '', hint: 'Sorts the floors top to bottom; leave empty for site plans' }]) as PromptField[]),
      { key: 'revision', label: 'Revision', required: true, initial: '' },
      ...((existing
        ? []
        : [
            { key: 'scope', label: 'What this drawing includes', type: 'multiselect', required: true, options: SCOPE_OPTIONS, initial: 'services' },
            { key: 'lms', label: 'Lighting control system', type: 'select', options: Object.keys(LMS_SYSTEMS).map((k) => ({ value: k, label: k })), initial: 'KNX', when: { key: 'scope', in: ['lms'] } },
          ]) as PromptField[]),
    ],
  });
  if (!info) return null;
  let id: string | null = null;
  await dialog.run(async () => {
    const base = `${p.id}/${uuid()}`;
    const up = await supabase.storage.from('drawings').upload(`${base}.${prep.ext}`, prep.bytes, { contentType: prep.mime, upsert: false });
    if (up.error) throw new Error(up.error.message);
    if (prep.pdf) {
      const pu = await supabase.storage.from('drawings').upload(`${base}.pdf`, prep.pdf, { contentType: 'application/pdf', upsert: false });
      if (pu.error) throw new Error(pu.error.message);
    }
    const scope = existing ? undefined : Object.fromEntries((info.scope || 'services').split(',').filter(Boolean).map((k) => [k, true]));
    id = await rpc<string>('drawing_save', {
      p: {
        ...(existing ? { id: existing.id } : { exec_project_id: p.id, scope, lms: info.lms || 'KNX' }),
        title: info.title,
        sheet_no: info.sheet_no,
        floor: info.floor,
        ...(existing ? {} : { level_no: (info.level ?? '').trim() }),
        revision: info.revision,
        image_path: `${base}.${prep.ext}`,
        ...(prep.pdf ? { pdf_path: `${base}.pdf` } : {}),
        width: prep.width,
        height: prep.height,
      },
    });
  }, existing ? 'New revision uploaded' : 'Drawing added – set the scale, then place the items');
  return id;
}

export function DrawingsTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const [old, setOld] = useState(false);
  const { data, reload } = useLoad(async () => {
    const [d, it] = await Promise.all([
      supabase.from('exec_drawings').select('*').eq('exec_project_id', p.id).order('level_no', { ascending: false, nullsFirst: false }).order('floor').order('title'),
      supabase.from('exec_drawing_items').select('drawing_id, status').eq('exec_project_id', p.id),
    ]);
    if (d.error) throw new Error(d.error.message);
    return { drawings: (d.data ?? []) as Drawing[], items: (it.data ?? []) as { drawing_id: string; status: string }[] };
  }, [p.id]);
  const on = p.smart_drawings === true;
  const canEdit = DRAWING_EDIT_ROLES.includes(me.role) && on;
  const list = (data?.drawings ?? []).filter((d) => old || !d.archived);
  const pctOf = (ids: string[]) => {
    const its = (data?.items ?? []).filter((x) => ids.includes(x.drawing_id));
    return { n: its.length, pct: its.length ? Math.round((100 * its.reduce((t, x) => t + (WEIGHT[x.status] ?? 0), 0)) / its.length) : 0 };
  };
  // floors top to bottom (by the floor order), then the sheets without a floor
  const floors: { key: string; name: string; sheets: Drawing[] }[] = [];
  for (const d of list) {
    const key = d.floor ? d.floor.trim().toLowerCase() : '—';
    let f = floors.find((x) => x.key === key);
    if (!f) floors.push((f = { key, name: d.floor ?? 'Other sheets (no floor)', sheets: [] }));
    f.sheets.push(d);
  }

  return (
    <View style={{ gap: 12 }}>
      <TestingBanner what="Smart drawings" show />
      {!on ? (
        <Notice tone={colors.amber}>Smart drawings are not used on this project (stopped with SM Projects&apos; approval). What was recorded stays here to read; nothing can be added or changed. The Senior Electrical Engineer can switch them back on in the execution details.</Notice>
      ) : null}
      <Card>
        <Muted>
          The project&apos;s drawings with every light, socket, data point, DB, fan / HVAC connection, lighting-control and BMS device, and the
          containment and cable routes marked on them. The site team updates each item&apos;s stage, checks and readings; tagged to BOQ lines and
          programme activities, the drawings give the quantities done and the activity % beside the figures you keep today.
        </Muted>
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          {canEdit ? (
            <Button
              title="Add a drawing"
              onPress={async () => {
                const id = await uploadDrawing(p, dialog);
                if (id) {
                  await reload();
                  router.push(`/execution/drawing/${id}`);
                }
              }}
            />
          ) : (
            <Muted>The execution team adds the drawings.</Muted>
          )}
          <Button title="Risers" variant="secondary" onPress={() => router.push(`/execution/drawing/risers/${p.id}`)} />
          {me.role !== 'sub_supervisor' ? <Button title="Reports" variant="secondary" onPress={() => router.push(`/execution/drawing/reports/${p.id}`)} /> : null}
          {me.role !== 'sub_supervisor' || on ? <Button title="Materials take-off" variant="secondary" onPress={() => router.push(`/execution/drawing/takeoff/${p.id}`)} /> : null}
          <Toggle label="Show archived" value={old} onChange={setOld} />
        </Row>
        {Platform.OS !== 'web' && canEdit ? <Muted style={{ marginTop: 6 }}>On the phone, add an image of the drawing; PDF drawings are added from the website.</Muted> : null}
      </Card>
      <Section title={`Drawings (${list.length})${floors.length > 1 ? ` · ${floors.length} floors / areas` : ''}`}>
        {list.length ? (
          floors.map((f) => {
            const fp = pctOf(f.sheets.map((x) => x.id));
            return (
              <View key={f.key} style={{ gap: 6, marginBottom: 10 }}>
                {floors.length > 1 ? (
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Muted style={{ fontWeight: '800', color: colors.ink }}>{f.name}</Muted>
                    <Muted>{`${f.sheets.length} sheet(s) · ${fp.n} items · ${fp.pct}% installed`}</Muted>
                  </Row>
                ) : null}
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                  {f.sheets.map((d) => {
                    const { n, pct } = pctOf([d.id]);
                    return (
                      <ListRow
                        key={d.id}
                        title={`${d.sheet_no ? `${d.sheet_no} · ` : ''}${d.title}${d.revision ? ` rev ${d.revision}` : ''}`}
                        subtitle={`${d.floor ? `${d.floor} · ` : ''}${n} items · ${pct}% installed · added ${fmtDate(d.uploaded_at)}`}
                        wrapRight
                        right={d.archived ? <Pill label="Archived" tone={colors.grey} /> : <Pill label={`${pct}% installed`} tone={pct >= 100 ? colors.green : pct ? colors.blue : colors.grey} />}
                        onPress={() => router.push(`/execution/drawing/${d.id}`)}
                      />
                    );
                  })}
                </Card>
              </View>
            );
          })
        ) : (
          <Empty title="No drawings yet" hint={canEdit ? 'Add the electrical layout drawings of this project (PDF or image) – one per floor, with its floor order.' : undefined} />
        )}
      </Section>
    </View>
  );
}
