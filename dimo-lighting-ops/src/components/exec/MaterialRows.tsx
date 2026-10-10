import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill, Row } from '@/components/ui';
import { MR_STATUS, mrDaysLate, type MaterialRequest } from '@/lib/execution';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

export const mrTone = (s: MaterialRequest['status']) =>
  s === 'received' ? colors.green : s === 'rejected' || s === 'cancelled' ? colors.grey : s === 'ordered' || s === 'part_received' ? colors.blue : colors.amber;

export function MaterialRows({ rows, projectName, empty = 'No material requests' }: { rows: MaterialRequest[]; projectName?: (id: string) => string; empty?: string }) {
  const people = usePeople();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((m) => {
        const late = mrDaysLate(m, todayISO());
        return (
          <ListRow
            key={m.id}
            wrapRight
            onPress={() => router.push(`/execution/material/${m.id}`)}
            highlight={late ? colors.red : undefined}
            title={`${m.code}${m.purpose ? ` – ${m.purpose}` : ''}`}
            subtitle={[projectName?.(m.exec_project_id), `needed ${fmtDate(m.required_date)}`, m.delivery_at ? `delivery ${fmtDateTime(m.delivery_at)}` : null, m.po_no ? `SAP ${m.po_no}` : null, people[m.requested_by]?.full_name]
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
