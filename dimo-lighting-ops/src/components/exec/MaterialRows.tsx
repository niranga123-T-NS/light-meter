import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill, Row } from '@/components/ui';
import { MR_STATUS, mrDaysLate, routeLabel, type MaterialRequest, type MrRoute } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

export const mrTone = (s: MaterialRequest['status']) =>
  s === 'received' ? colors.green : s === 'rejected' || s === 'cancelled' ? colors.grey : s === 'ordered' || s === 'part_received' ? colors.blue : colors.amber;

export function MaterialRows({ rows, projectName, routes, empty = 'No material requests' }: { rows: MaterialRequest[]; projectName?: (id: string) => string; routes?: MrRoute[]; empty?: string }) {
  const people = usePeople();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((m) => {
        const late = mrDaysLate(m, todayISO());
        const rt = routes?.find((r) => r.mr_id === m.id);
        return (
          <ListRow
            key={m.id}
            wrapRight
            onPress={() => router.push(`/execution/material/${m.id}`)}
            highlight={late ? colors.red : undefined}
            title={`${m.code}${m.kind === 'service' ? ' · Service' : ''}${m.purpose ? ` – ${m.purpose}` : ''}`}
            subtitle={[projectName?.(m.exec_project_id), `needed ${fmtDate(m.required_date)}`, m.kind !== 'service' && m.expected_date && !['received', 'rejected', 'cancelled'].includes(m.status) ? `expected ${fmtDate(m.expected_date)}` : null, rt ? routeLabel(rt) : m.po_no ? `SAP ${m.po_no}` : null, people[m.requested_by]?.full_name]
              .filter(Boolean)
              .join(' · ')}
            right={
              <Row gap={4}>
                {late ? <Pill label={`${late} d late`} tone={colors.red} solid={late > 2} /> : null}
                <Pill label={MR_STATUS[m.status]} tone={mrTone(m.status)} />
              </Row>
            }
          />
        );
      })}
    </Card>
  );
}
