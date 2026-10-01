import { router } from 'expo-router';
import { Text } from 'react-native';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';
import { Card, colors, Grid, ListRow, Muted, Section, Stat } from '../ui';

type Hold = {
  job_id: string;
  inquiry_id: string;
  code: string;
  project_name: string | null;
  customer_name: string | null;
  task_type: string;
  assignee_id: string | null;
  hold_reason: string | null;
  hold_waiting_on: string | null;
  held_at: string;
  working_days: number;
  alerted: boolean;
};

/** Designs on hold (Design Board, SM Projects and GM dashboards): over 2 working days is flagged and SM Projects is told. */
export function DesignHolds({ reloadKey }: { reloadKey?: unknown }) {
  const people = usePeople();
  const { data } = useLoad(() => rpc<Hold[]>('design_holds'), [reloadKey]);
  const holds = data ?? [];
  const long = holds.filter((h) => Number(h.working_days) >= 2);
  const longest = holds.reduce((a, h) => Math.max(a, Number(h.working_days)), 0);
  return (
    <Section title="Designs on hold">
      <Grid min={160}>
        <Stat label="Designs on hold" value={holds.length} tone={holds.length ? 'amber' : undefined} />
        <Stat label="On hold over 2 working days" value={long.length} tone={long.length ? 'red' : undefined} />
        <Stat label="Longest hold (working days)" value={longest} tone={longest >= 2 ? 'red' : undefined} />
      </Grid>
      {holds.length ? (
        <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
          {holds.map((h) => (
            <ListRow
              key={h.job_id}
              title={`${h.code} · ${h.project_name ?? ''} · ${h.task_type} design`}
              subtitle={`${people[h.assignee_id ?? '']?.full_name ?? '—'} · ${h.hold_reason ?? ''} · waiting on ${h.hold_waiting_on ?? '—'} · since ${fmtDateTime(h.held_at)}`}
              highlight={Number(h.working_days) >= 2 ? colors.red : colors.amber}
              right={<Text style={{ fontWeight: '700', color: Number(h.working_days) >= 2 ? colors.red : colors.ink }}>{h.working_days} d</Text>}
              onPress={() => router.push(`/design/${h.job_id}`)}
            />
          ))}
        </Card>
      ) : (
        <Muted>No designs on hold.</Muted>
      )}
    </Section>
  );
}
