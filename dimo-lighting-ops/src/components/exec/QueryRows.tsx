import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill } from '@/components/ui';
import { DQ_STATUS, type DesignQuery } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

export const dqTone = (q: DesignQuery) =>
  q.status === 'forwarded' && q.target_date && q.target_date < todayISO() ? colors.red : q.status === 'raised' || q.status === 'forwarded' ? colors.amber : colors.green;

export function QueryRows({ rows, projectName, empty = 'No design queries' }: { rows: DesignQuery[]; projectName?: (id: string) => string; empty?: string }) {
  const people = usePeople();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((q) => (
        <ListRow
          key={q.id}
          wrapRight
          onPress={() => router.push(`/execution/query/${q.id}`)}
          highlight={['raised', 'forwarded'].includes(q.status) ? dqTone(q) : undefined}
          title={`${q.code} – ${q.question}`}
          subtitle={[projectName?.(q.exec_project_id), q.drawing_ref, q.target_date ? `answer by ${fmtDate(q.target_date)}` : null, people[q.raised_by]?.full_name]
            .filter(Boolean)
            .join(' · ')}
          right={<Pill label={DQ_STATUS[q.status]} tone={dqTone(q)} />}
        />
      ))}
    </Card>
  );
}
