import { Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Muted, Pill, Row, Section } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { DELAY_DAYS, STAGES, todayIso, type FoNote, type Line } from '@/lib/foreignOrders';
import type { Profile } from '@/lib/types';
import { rpc } from './actions';

export const NOTE_KIND: Record<FoNote['kind'], { label: string; tone: string }> = {
  mistake: { label: 'Mistake', tone: colors.red },
  delay: { label: 'Delay', tone: colors.amber },
  complaint: { label: 'Complaint', tone: colors.red },
  notice: { label: 'Notice', tone: colors.blue },
};

/**
 * Issue records against a stage, or a set of its steps (steps whose order is not known are grouped under their stage):
 * a mistake, a delay, a complaint or a notice, with reference files. Each one alerts SM Projects, the GM / DGM,
 * SM Estimation and the order's owners (sales person, SEE).
 */
export function FoNotes({
  notes,
  lines,
  handoverId,
  orderId,
  keeper,
  people,
  onChange,
}: {
  notes: FoNote[];
  /** the route, for the stage and step choices */
  lines: Line[];
  handoverId: string;
  orderId: string | null;
  keeper: boolean;
  people: Record<string, Profile>;
  onChange: () => void;
}) {
  const dialog = useDialog();
  const stages = [...new Set(lines.map((l) => l.def.stage))].sort((a, b) => a - b);
  const label = (k: string) => lines.find((l) => l.def.key === k)?.def.label ?? k;
  const nodes = [...new Set(lines.map((l) => l.def.node))];

  const add = async () => {
    const r = await dialog.prompt({
      title: 'Record a mistake, delay, complaint or notice',
      message: 'Alerts SM Projects, the DGM, SM Estimation, the sales person and the SEE. Attach references after saving.',
      fields: [
        { key: 'kind', label: 'Type', type: 'select', required: true, initial: 'delay', options: Object.entries(NOTE_KIND).map(([value, k]) => ({ value, label: k.label })) },
        { key: 'stage', label: 'Stage', type: 'select', required: true, options: stages.map((s) => ({ value: String(s), label: `${s} · ${STAGES[s - 1]}` })) },
        {
          key: 'steps',
          label: 'Steps concerned (optional)',
          type: 'multiselect',
          hint: 'Only steps of the chosen stage. Leave empty when it concerns the whole stage.',
          options: lines.map((l) => ({ value: l.def.key, label: l.def.label, group: `${l.def.stage} · ${STAGES[l.def.stage - 1]}` })),
        },
        { key: 'party', label: 'Who it concerns', type: 'select', options: [{ value: '', label: '—' }, ...nodes.map((n) => ({ value: n, label: n }))] },
        { key: 'title', label: 'What happened', required: true, hint: 'e.g. Wrong HS code on the CI, Draft LC held at the bank' },
        { key: 'details', label: 'Details', type: 'multiline' },
        { key: 'occurred_on', label: 'Date', type: 'date', required: true, initial: todayIso() },
        { key: 'delay_days', label: 'Delay (working days) – for a delay', type: 'select', options: [{ value: '', label: '—' }, ...DELAY_DAYS] },
      ],
      confirmLabel: 'Record and alert',
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('fo_add_note', { p: { ...r, handover_id: handoverId, order_id: orderId, steps: r.steps ? r.steps.split(',').filter(Boolean) : [] } });
      onChange();
    }, 'Recorded – the managers and owners are alerted');
  };
  const resolve = async (n: FoNote) => {
    const r = await dialog.prompt({ title: `Resolve: ${n.title}`, fields: [{ key: 'how', label: 'How it was resolved', type: 'multiline', required: true }], confirmLabel: 'Resolve' });
    if (r) await dialog.run(async () => { await rpc('fo_resolve_note', { p_id: n.id, p_resolution: r.how }); onChange(); }, 'Resolved');
  };

  const open = notes.filter((n) => n.status === 'open').length;
  return (
    <Section title={`Mistakes, delays, complaints and notices${notes.length ? ` · ${open} open` : ''}`} right={keeper ? <Button small variant="secondary" title="+ Record" onPress={add} /> : null}>
      {notes.length ? (
        notes.map((n) => {
          const k = NOTE_KIND[n.kind];
          return (
            <Card key={n.id} style={{ gap: 6, borderLeftWidth: 4, borderLeftColor: n.status === 'open' ? k.tone : colors.line }}>
              <Row wrap gap={6} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Row wrap gap={6} style={{ alignItems: 'center', flexShrink: 1 }}>
                  <Pill label={k.label} tone={k.tone} solid={n.status === 'open'} />
                  <Text style={{ fontWeight: '700', color: colors.ink, flexShrink: 1 }}>{n.title}</Text>
                </Row>
                <Pill label={n.status === 'open' ? 'Open' : 'Resolved'} tone={n.status === 'open' ? colors.amber : colors.green} />
              </Row>
              <Muted>
                {[
                  `Stage ${n.stage} · ${STAGES[n.stage - 1]}`,
                  n.steps.length ? n.steps.map(label).join(', ') : 'whole stage',
                  n.party,
                  n.delay_days ? `${n.delay_days} working days` : null,
                  fmtDate(n.occurred_on),
                  `by ${people[n.created_by]?.full_name ?? ''}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Muted>
              {n.details ? <Text style={{ color: colors.text }}>{n.details}</Text> : null}
              {n.status === 'resolved' ? <Muted>{`Resolved ${fmtDateTime(n.resolved_at)}: ${n.resolution}`}</Muted> : null}
              <View>
                <Attachments entityType="fo_note" entityId={n.id} kinds={['fo_reference']} title="References" canUpload={keeper} />
              </View>
              {keeper && n.status === 'open' ? (
                <Row gap={8}>
                  <Button small variant="secondary" title="Resolve" onPress={() => resolve(n)} />
                </Row>
              ) : null}
            </Card>
          );
        })
      ) : (
        <Muted>{keeper ? 'Nothing recorded. Record a mistake, a delay, a complaint or a notice against a stage or some of its steps.' : 'Nothing recorded.'}</Muted>
      )}
    </Section>
  );
}
