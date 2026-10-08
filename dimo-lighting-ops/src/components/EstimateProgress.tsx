import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/lib/supabase';
import type { EstimationJob } from '@/lib/types';
import { JobTimeRow, PercentChips } from './TimeBar';
import { Button, Card, colors, Field, Muted, NumberField, Progress, Row, Section } from './ui';

const PENDING = ['assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested'];

/** The estimator's own %, the time used and when it was last updated; the estimator updates it in two taps. */
export function EstimateProgress({ job: j, canEdit, onSaved }: { job: EstimationJob; canEdit: boolean; onSaved: () => void }) {
  const dialog = useDialog();
  const [pct, setPct] = useState<number | null>(j.progress_pct ?? 0);
  const [note, setNote] = useState('');
  if (!PENDING.includes(j.status)) return null;
  return (
    <Section title="Progress">
      <Card style={{ gap: 6 }}>
        <Row gap={8} style={{ alignItems: 'center' }}>
          <Text style={{ fontWeight: '700', color: colors.ink, width: 48 }}>{`${j.progress_pct ?? 0}%`}</Text>
          <View style={{ flex: 1 }}>
            <Progress pct={j.progress_pct ?? 0} colour={colors.blue} />
          </View>
        </Row>
        {j.progress_note ? <Muted>{`Last note: ${j.progress_note}`}</Muted> : null}
        <JobTimeRow entityType="estimation_job" jobId={j.id} updatedAt={j.progress_updated_at ?? j.assigned_at} progress={j.progress_pct} reloadKey={j.progress_updated_at} />
        {canEdit ? (
          <>
            <PercentChips value={pct} onChange={setPct} />
            <Row gap={8} wrap style={{ alignItems: 'flex-end' }}>
              <NumberField label="Progress" suffix="%" value={pct} onChange={setPct} />
              <Field label="What's done (optional)" value={note} onChangeText={setNote} placeholder={j.phase === 'pre' ? 'e.g. cables, poles and controls priced' : 'e.g. fixtures added, waiting for 1 supplier'} />
            </Row>
            <Button
              title="Save progress"
              onPress={() =>
                dialog.run(async () => {
                  await rpc('update_estimate_progress', { p_job: j.id, p_progress: Math.max(0, Math.min(100, Math.round(pct ?? 0))), p_note: note || null });
                  setNote('');
                  onSaved();
                }, 'Progress saved')
              }
            />
            <Muted>
              {j.phase === 'pre'
                ? 'In a pre-estimate the % is for the items that do not need the design; carry on from there in final pricing.'
                : 'Update it at least once a day – a reminder comes at 3:30 pm if not, and SM Estimation is told after 2 working days without an update.'}
            </Muted>
          </>
        ) : null}
      </Card>
    </Section>
  );
}
