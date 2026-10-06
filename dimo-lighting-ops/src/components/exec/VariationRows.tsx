import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill, Row } from '@/components/ui';
import { VAR_STATUS, type Variation } from '@/lib/execution';
import { fmtDate, fmtMoney } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

export const varTone = (s: Variation['status']) =>
  s === 'client_accepted' || s === 'approved' ? colors.green : s === 'rejected' || s === 'client_rejected' || s === 'cancelled' ? colors.grey : colors.amber;

export function VariationRows({ rows, projectName, empty = 'No variations' }: { rows: Variation[]; projectName?: (id: string) => string; empty?: string }) {
  const people = usePeople();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((v) => (
        <ListRow
          key={v.id}
          wrapRight
          onPress={() => router.push(`/execution/variation/${v.id}`)}
          title={`${v.code} · ${v.title}`}
          subtitle={[projectName?.(v.exec_project_id), v.vtype, v.value_lkr != null ? `${v.value_lkr > 0 ? '+' : '−'}${fmtMoney(Math.abs(v.value_lkr), 'LKR')}` : null, people[v.raised_by]?.full_name, fmtDate(v.raised_at)]
            .filter(Boolean)
            .join(' · ')}
          right={
            <Row gap={4}>
              <Pill label={VAR_STATUS[v.status]} tone={varTone(v.status)} />
            </Row>
          }
        />
      ))}
    </Card>
  );
}
