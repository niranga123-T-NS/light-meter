import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill, Row } from '@/components/ui';
import { MR_STATUS, type MaterialRequest } from '@/lib/execution';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

export const mrTone = (s: MaterialRequest['status']) =>
  s === 'received' ? colors.green : s === 'rejected' || s === 'cancelled' ? colors.grey : s === 'ordered' || s === 'part_received' ? colors.blue : colors.amber;

export function MaterialRows({ rows, projectName, empty = 'No material requests' }: { rows: MaterialRequest[]; projectName?: (id: string) => string; empty?: string }) {
  const people = usePeople();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((m) => {
        const late = !['received', 'rejected', 'cancelled'].includes(m.status) && m.required_date < todayISO();
        return (
          <ListRow
            key={m.id}
            wrapRight
            onPress={() => router.push(`/execution/material/${m.id}`)}
            highlight={late ? colors.red : undefined}
            title={`${m.code}${m.purpose ? ` – ${m.purpose}` : ''}`}
            subtitle={[projectName?.(m.exec_project_id), `needed ${fmtDate(m.required_date)}`, m.po_no ? `PO ${m.po_no}` : null, people[m.requested_by]?.full_name]
              .filter(Boolean)
              .join(' · ')}
            right={
              <Row gap={4}>
                {m.est_value_lkr ? <Pill label={fmtMoney(m.est_value_lkr, 'LKR')} /> : null}
                <Pill label={MR_STATUS[m.status]} tone={mrTone(m.status)} />
              </Row>
            }
          />
        );
      })}
    </Card>
  );
}
