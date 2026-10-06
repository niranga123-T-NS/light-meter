import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill, Row } from '@/components/ui';
import { ENG_STATUS, engTypeLabel, isOverdue, type EngJob } from '@/lib/engJobs';
import { daysBetween, fmtDate, todayISO } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

/** Engineering jobs as rows: type, project, engineer, deadline, status. */
export function EngJobRows({ jobs, showEngineer, empty = 'No jobs' }: { jobs: EngJob[]; showEngineer?: boolean; empty?: string }) {
  const people = usePeople();
  const today = todayISO();
  if (!jobs.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {jobs.map((j) => {
        const st = ENG_STATUS[j.status];
        const late = isOverdue(j);
        const left = daysBetween(today, j.due_date);
        return (
          <ListRow
            key={j.id}
            wrapRight
            highlight={late ? colors.red : j.status === 'on_hold' ? colors.red : j.status === 'assigned' ? colors.amber : undefined}
            onPress={() => router.push(`/engineering/${j.id}`)}
            title={j.title}
            subtitle={[
              j.code,
              engTypeLabel(j.job_type),
              j.projects?.name ?? j.organizations?.name,
              showEngineer ? people[j.assignee_id]?.full_name : null,
              `deadline ${fmtDate(j.due_date)}${late ? ` – ${-left} days late` : left === 0 && j.status !== 'done' ? ' – today' : ''}`,
              j.status === 'on_hold' && j.hold_reason ? `hold: ${j.hold_reason}` : null,
              j.job_type === 'installation' && j.status !== 'assigned' ? `${j.progress}%` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            right={
              <Row gap={4} wrap>
                <Pill label={st.label} tone={st.tone} />
                {late ? <Pill label="Overdue" tone={colors.red} solid /> : null}
                {!j.site_address ? <Pill label="Location not set" tone={colors.amber} /> : null}
              </Row>
            }
          />
        );
      })}
    </Card>
  );
}
