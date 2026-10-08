import { Platform, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Field, Muted, NumberField, Pill, Row, Segmented } from '@/components/ui';
import { ITEM_STATUS, PLAN_KINDS, type PlanItem } from '@/lib/execution';
import { pickDocument, pickImage, type PickedFile } from '@/lib/files';
import { fmtDate } from '@/lib/format';

export type ItemEdit = { status: PlanItem['status']; done_qty: number | null; note: string; photos: PickedFile[] };

/** True when the row was touched in the report and has to be saved with it */
export const itemChanged = (it: PlanItem, e?: ItemEdit) =>
  !!e && (e.status !== it.status || (e.done_qty ?? null) !== (it.done_qty ?? null) || e.note.trim() !== (it.result_note ?? '') || e.photos.length > 0);

const kindLabel = (k: string) => PLAN_KINDS.find((x) => x.value === k)?.label ?? k;

/** Planned activities in the daily report: result, quantity done, details / reason and photos for each. */
export function ReportItems({ items, edits, onChange, people, day }: { items: PlanItem[]; edits: Record<string, ItemEdit>; onChange: (id: string, e: ItemEdit) => void; people: Record<string, { full_name: string }>; day: string }) {
  const dialog = useDialog();
  const edit = (it: PlanItem): ItemEdit => edits[it.id] ?? { status: it.status, done_qty: it.done_qty, note: it.result_note ?? '', photos: [] };
  const addPhoto = async (it: PlanItem, camera: boolean) => {
    const x = camera ? await pickImage(true) : Platform.OS === 'web' ? await pickDocument() : await pickImage(false);
    if (x) onChange(it.id, { ...edit(it), photos: [...edit(it).photos, x] });
  };
  if (!items.length) return <Muted>No planned activities for this day.</Muted>;
  return (
    <View style={{ gap: 8 }}>
      {items.map((it) => {
        const e = edit(it);
        const needReason = e.status === 'partial' || e.status === 'not_done';
        const tone = e.status === 'done' ? colors.green : e.status === 'partial' ? colors.amber : e.status === 'not_done' ? colors.red : colors.line;
        return (
          <Card key={it.id} style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: tone }}>
            <Row wrap gap={6} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, minWidth: 200 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{it.title}</Text>
                <Muted>
                  {[kindLabel(it.kind), it.zone, it.qty != null ? `${it.qty} ${it.unit ?? ''}` : null, it.supervisor_id ? people[it.supervisor_id]?.full_name : null, it.day !== day ? `planned ${fmtDate(it.day)}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Muted>
              </View>
              {it.day !== day ? <Pill label="Earlier – not updated" tone={colors.amber} /> : null}
            </Row>
            <Segmented
              value={e.status === 'planned' ? ('planned' as const) : e.status}
              onChange={(v) => onChange(it.id, { ...e, status: v, done_qty: v === 'done' && it.qty != null && e.done_qty == null ? it.qty : e.done_qty })}
              options={[
                { value: 'planned' as const, label: ITEM_STATUS.planned },
                { value: 'done' as const, label: ITEM_STATUS.done },
                { value: 'partial' as const, label: ITEM_STATUS.partial },
                { value: 'not_done' as const, label: ITEM_STATUS.not_done },
              ]}
            />
            <Row wrap gap={8}>
              {it.qty != null ? (
                <View style={{ width: 160 }}>
                  <NumberField label={`Done (${it.unit ?? 'qty'})`} value={e.done_qty} onChange={(v) => onChange(it.id, { ...e, done_qty: v })} />
                </View>
              ) : null}
              <View style={{ flex: 1, minWidth: 220 }}>
                <Field label={needReason ? 'Reason and details' : 'Details (optional)'} required={needReason} multiline value={e.note} onChangeText={(v) => onChange(it.id, { ...e, note: v })} placeholder="What was done, where, who, any problem" />
              </View>
            </Row>
            <Row wrap gap={6} style={{ alignItems: 'center' }}>
              {Platform.OS !== 'web' ? <Button small variant="secondary" title="📷 Photo" onPress={() => dialog.run(() => addPhoto(it, true))} /> : null}
              <Button small variant="secondary" title={Platform.OS === 'web' ? '+ Photo' : '+ From gallery'} onPress={() => dialog.run(() => addPhoto(it, false))} />
              {e.photos.map((x, i) => (
                <Button key={`${x.name}-${i}`} small variant="ghost" title={`✕ ${x.name}`} onPress={() => onChange(it.id, { ...e, photos: e.photos.filter((_, k) => k !== i) })} />
              ))}
            </Row>
          </Card>
        );
      })}
    </View>
  );
}
