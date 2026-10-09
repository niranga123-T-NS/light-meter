import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill } from '@/components/ui';
import { SINV_STATUS, type SubInvoice } from '@/lib/execution';
import { fmtDate, fmtMoney } from '@/lib/format';

const TONE = { grey: colors.grey, amber: colors.amber, blue: colors.blue, green: colors.green, red: colors.red };

/** Subcontractor invoices (records for reference) – tap one for its copy, comments and approvals. */
export function SubInvoiceRows({ rows, projectName, empty = 'No invoices recorded' }: { rows: SubInvoice[]; projectName?: (id: string) => string; empty?: string }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((v) => {
        const st = SINV_STATUS[v.status];
        return (
          <ListRow
            key={v.id}
            wrapRight
            highlight={v.status === 'returned' ? colors.red : undefined}
            title={`${v.code} · ${v.subcontractor} · invoice ${v.invoice_no}`}
            subtitle={[projectName?.(v.exec_project_id), fmtDate(v.invoice_date), v.status === 'returned' && v.return_note ? `returned: ${v.return_note}` : null].filter(Boolean).join(' · ')}
            right={
              <>
                <Pill label={fmtMoney(v.amount, 'LKR')} />
                <Pill label={st.label} tone={TONE[st.tone]} />
              </>
            }
            onPress={() => router.push(`/execution/sub-invoice/${v.id}`)}
          />
        );
      })}
    </Card>
  );
}
