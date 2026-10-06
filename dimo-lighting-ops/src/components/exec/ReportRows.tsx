import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill, Row } from '@/components/ui';
import { REPORT_STATUS, type ExecReport } from '@/lib/execution';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

export function ReportRows({ rows, projectName, empty = 'No reports' }: { rows: ExecReport[]; projectName?: (id: string) => string; empty?: string }) {
  const people = usePeople();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((r) => (
        <ListRow
          key={r.id}
          wrapRight
          onPress={() => router.push(`/execution/report/${r.id}`)}
          highlight={r.is_late ? colors.red : undefined}
          title={`${people[r.author_id]?.full_name ?? ''} · ${fmtDate(r.report_date)}`}
          subtitle={[projectName?.(r.exec_project_id), r.level === 'supervisor' ? `Supervisor · ${r.crew_count ?? 0} crew` : 'Assistant Engineer', `submitted ${fmtDateTime(r.submitted_at)}`]
            .filter(Boolean)
            .join(' · ')}
          right={
            <Row gap={4}>
              {r.is_late ? <Pill label="Late" tone={colors.red} /> : null}
              <Pill label={REPORT_STATUS[r.status]} tone={r.status === 'verified' ? colors.green : r.status === 'returned' ? colors.red : colors.amber} />
            </Row>
          }
        />
      ))}
    </Card>
  );
}
