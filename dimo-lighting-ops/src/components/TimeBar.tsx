import { Text, View } from 'react-native';
import { useLoad } from '@/lib/hooks';
import { isBehind, isStale, timeColour, timeLabel, updatedText, type JobClock } from '@/lib/progress';
import { supabase } from '@/lib/supabase';
import { Chip, colors, Pill, Row } from './ui';

/** Small time-used bar: green → amber at 75 % → red when overdue; grey while on hold */
export function TimeBar({ pct, targetMinutes, paused, width = 120 }: { pct: number | null | undefined; targetMinutes?: number | null; paused?: boolean; width?: number | `${number}%` }) {
  const tone = timeColour(pct, paused);
  return (
    <View style={{ gap: 2, width }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(3, Math.min(pct ?? 0, 100))}%`, height: 6, backgroundColor: tone }} />
      </View>
      <Text style={{ fontSize: 11, color: tone === colors.green ? colors.muted : tone, fontWeight: tone === colors.red ? '700' : '400' }}>{timeLabel(pct, targetMinutes, paused)}</Text>
    </View>
  );
}

/** "updated 3 d ago" with an amber tag when quiet for 2 working days, and "Behind" when the time runs ahead of the work */
export function ProgressFlags({ updatedAt, progress, timePct, compact }: { updatedAt?: string | null; progress?: number | null; timePct?: number | null; compact?: boolean }) {
  const stale = isStale(updatedAt);
  // In tables: one tag only – Behind first, then a quiet job
  if (compact) {
    if (isBehind(progress, timePct)) return <Pill label="Behind" tone={colors.red} />;
    if (stale) return <Pill label={updatedAt ? updatedText(updatedAt).replace('updated', 'No update') : 'No update yet'} tone={colors.amber} />;
    return <Text style={{ fontSize: 11, color: colors.muted }}>{updatedText(updatedAt)}</Text>;
  }
  return (
    <Row gap={4} wrap style={{ alignItems: 'center' }}>
      {stale ? <Pill label={updatedAt ? updatedText(updatedAt).replace('updated', 'No update') : 'No update yet'} tone={colors.amber} /> : <Text style={{ fontSize: 11, color: colors.muted }}>{updatedText(updatedAt)}</Text>}
      {isBehind(progress, timePct) ? <Pill label="Behind" tone={colors.red} /> : null}
    </Row>
  );
}

/** Time bar + last update for one job page – loads the job's work timer itself */
export function JobTimeRow({ entityType, jobId, updatedAt, progress, reloadKey }: { entityType: 'design_job' | 'estimation_job'; jobId: string; updatedAt?: string | null; progress?: number | null; reloadKey?: unknown }) {
  const { data: clock } = useLoad(async () => {
    const { data } = await supabase
      .from('sla_clocks')
      .select('entity_id, stage, used_pct, paused_at, due_at, target_minutes')
      .eq('entity_type', entityType)
      .eq('entity_id', jobId)
      .eq('stage', entityType === 'design_job' ? 'design' : 'estimation')
      .is('stopped_at', null)
      .maybeSingle();
    return (data as JobClock | null) ?? null;
  }, [jobId, reloadKey]);
  return (
    <Row gap={12} wrap style={{ alignItems: 'flex-start', marginVertical: 4 }}>
      {clock ? (
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600' }}>Time used</Text>
          <TimeBar pct={clock.used_pct} targetMinutes={clock.target_minutes} paused={!!clock.paused_at} width={180} />
        </View>
      ) : null}
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600' }}>Progress</Text>
        <ProgressFlags updatedAt={updatedAt} progress={progress} timePct={clock?.used_pct} />
      </View>
    </Row>
  );
}

/** One-tap progress: 10 / 25 / 50 / 75 / 90 / 100 % */
export function PercentChips({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <Row gap={6} wrap style={{ marginVertical: 4 }}>
      {[10, 25, 50, 75, 90, 100].map((p) => (
        <Chip key={p} label={`${p}%`} on={value === p} onPress={() => onChange(p)} />
      ))}
    </Row>
  );
}
