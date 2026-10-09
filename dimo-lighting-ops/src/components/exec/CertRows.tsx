import { router } from 'expo-router';
import { Card, colors, Empty, ListRow, Pill, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CERT_STATUS, type SubCert } from '@/lib/execution';
import { fmtDate, fmtMoney } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

export const certTone = (s: SubCert['status']) =>
  s === 'paid' ? colors.green : s === 'returned' || s === 'jm_returned' ? colors.red : s === 'verified' || s === 'approved' ? colors.blue : s === 'draft' || s === 'cancelled' ? colors.grey : colors.amber;

/** The step waiting for this user: the AE checks, the SEE approves, SM Projects approves, Operations pays; the preparer resubmits. */
export const certForMe = (c: SubCert, me: { id: string; role: string }) =>
  (c.status === 'jm_requested' && (me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer')) ||
  (c.status === 'jm_ae' && me.role === 'assistant_engineer') ||
  (c.status === 'jm_see' && me.role === 'senior_elec_engineer') ||
  ((c.status === 'jm_scheduled' || c.status === 'jm_returned') && c.prepared_by === me.id) ||
  (c.status === 'ae_review' && me.role === 'assistant_engineer') ||
  (c.status === 'prepared' && me.role === 'senior_elec_engineer') ||
  (c.status === 'verified' && me.role === 'sm_projects') ||
  (c.status === 'approved' && me.role === 'operations_exec') ||
  ((c.status === 'draft' || c.status === 'returned') && c.prepared_by === me.id);

/** Subcontractor payment certificates (IPC); each opens its page with the IPC, measurement sheets and the approval steps. */
export function CertRows({ rows, projectName, empty = 'No payment certificates' }: { rows: SubCert[]; projectName?: (id: string) => string; onChange?: () => void; empty?: string }) {
  const me = useMe();
  const people = usePeople();
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((c) => (
        <ListRow
          key={c.id}
          wrapRight
          highlight={certForMe(c, me) ? colors.amber : undefined}
          onPress={() => router.push(`/execution/sub-cert/${c.id}`)}
          title={`${c.code} · ${c.subcontractor} · ${c.period}`}
          subtitle={[
            projectName?.(c.exec_project_id),
            people[c.prepared_by]?.full_name,
            c.paid_ref ? `paid ${fmtDate(c.paid_at)} · ${c.paid_ref}` : null,
            (c.status === 'returned' || c.status === 'jm_returned') && c.return_note ? `returned: ${c.return_note}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          right={
            <Row gap={4} wrap>
              <Pill label={`Net ${fmtMoney(c.net, 'LKR')}`} />
              <Pill label={CERT_STATUS[c.status]} tone={certTone(c.status)} />
            </Row>
          }
        />
      ))}
    </Card>
  );
}
