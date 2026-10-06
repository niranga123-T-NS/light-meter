import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill, Row } from '@/components/ui';
import { hseKind, type HseReport } from '@/lib/execution';
import { fmtDateTime } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

export const sevTone = (s: string) => (s === 'critical' || s === 'high' ? colors.red : s === 'medium' ? colors.amber : colors.grey);

export function HseRows({ rows, projectName, empty = 'No HSE reports' }: { rows: HseReport[]; projectName?: (id: string) => string; empty?: string }) {
  const people = usePeople();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((r) => (
        <ListRow
          key={r.id}
          wrapRight
          onPress={() => router.push(`/execution/hse/${r.id}`)}
          highlight={r.status === 'open' ? sevTone(r.severity) : undefined}
          title={`${hseKind(r.kind)} – ${r.description}`}
          subtitle={[r.code, projectName?.(r.exec_project_id), r.location, fmtDateTime(r.occurred_at), people[r.reported_by]?.full_name].filter(Boolean).join(' · ')}
          right={
            <Row gap={4}>
              <Pill label={r.severity} tone={sevTone(r.severity)} />
              {r.lost_time ? <Pill label="LTI" tone={colors.red} solid /> : null}
              <Pill label={r.status === 'open' ? 'Open' : 'Closed'} tone={r.status === 'open' ? colors.amber : colors.green} />
            </Row>
          }
        />
      ))}
    </Card>
  );
}
