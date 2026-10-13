import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Muted, Row } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { STAGES, type Line } from '@/lib/foreignOrders';
import type { Profile } from '@/lib/types';
import { clearStep, recordStep } from './actions';

/** The steps of a route, by stage: done (date, reference, working days), current (days so far), and still to come. */
export function StepList({
  lines,
  keeper,
  handoverId,
  orderId,
  people,
  onChange,
  skip = [],
}: {
  lines: Line[];
  keeper: boolean;
  handoverId: string;
  orderId: string | null;
  people: Record<string, Profile>;
  onChange: () => void;
  /** steps recorded elsewhere (e.g. from the shipment) */
  skip?: string[];
}) {
  const dialog = useDialog();
  const stages = [...new Set(lines.map((l) => l.def.stage))].sort((a, b) => a - b);
  return (
    <View style={{ gap: 10 }}>
      {stages.map((s) => {
        const ls = lines.filter((l) => l.def.stage === s);
        const done = ls.every((l) => l.done);
        return (
          <Card key={s} style={{ gap: 0, paddingVertical: 6 }}>
            <Text style={{ fontWeight: '700', color: done ? colors.green : colors.ink, paddingVertical: 6 }}>{`${s} · ${STAGES[s - 1]}${done ? ' ✓' : ''}`}</Text>
            {ls.map((l) => {
              const tone = l.done ? colors.green : l.ready && !l.def.optional ? (l.late ? colors.red : colors.blue) : colors.line;
              return (
                <Row key={l.def.key} gap={10} style={{ alignItems: 'flex-start', paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed' }}>
                  <View style={{ width: 18, height: 18, borderRadius: 9, marginTop: 2, borderWidth: 2, borderColor: tone, backgroundColor: l.done ? colors.green : '#fff', alignItems: 'center', justifyContent: 'center' }}>
                    {l.done ? <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>✓</Text> : l.ready ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone }} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: l.done || l.ready ? colors.ink : colors.muted, fontWeight: l.ready && !l.done && !l.def.optional ? '700' : '500' }}>
                      {l.def.label}
                      {l.def.optional ? <Text style={{ color: colors.muted, fontWeight: '400', fontSize: 12 }}>{'  · optional – record if known'}</Text> : null}
                    </Text>
                    <Muted>
                      {[
                        l.def.node,
                        l.done ? `done ${fmtDate(l.done.done_on)}` : l.ready && !l.def.optional ? 'now' : null,
                        l.done?.ref ? `${l.def.ref_label ?? 'Ref'} ${l.done.ref}` : null,
                        l.days != null && l.start && (l.done || !l.def.optional) ? `${l.days} working day${l.days === 1 ? '' : 's'}${l.done ? '' : ' so far'}` : null,
                        l.def.sla_days ? `SLA ${l.def.sla_days}` : null,
                        l.done ? `by ${people[l.done.recorded_by]?.full_name ?? ''}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Muted>
                    {l.done?.note ? <Muted>{l.done.note}</Muted> : null}
                    {l.late ? <Text style={{ color: colors.red, fontSize: 12, fontWeight: '700' }}>{`Past its SLA of ${l.def.sla_days} working days`}</Text> : null}
                  </View>
                  {keeper && !skip.includes(l.def.key) ? (
                    l.done ? (
                      <Row gap={4}>
                        <Button small variant="ghost" title="Edit" onPress={async () => { if (await recordStep(dialog, l, handoverId, orderId)) onChange(); }} />
                        <Button small variant="ghost" title="Clear" onPress={async () => { if (await clearStep(dialog, l)) onChange(); }} />
                      </Row>
                    ) : l.ready ? (
                      <Button small title="Record" onPress={async () => { if (await recordStep(dialog, l, handoverId, orderId)) onChange(); }} />
                    ) : null
                  ) : null}
                </Row>
              );
            })}
          </Card>
        );
      })}
    </View>
  );
}
