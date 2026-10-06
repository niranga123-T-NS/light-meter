import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ListRow, Pill, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CERT_STATUS, type SubCert } from '@/lib/execution';
import { fmtDate, fmtMoney } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

export const certTone = (s: SubCert['status']) => (s === 'paid' ? colors.green : s === 'returned' ? colors.red : s === 'approved' ? colors.blue : colors.amber);

/** Subcontractor payment certificates with the step each role can take: verify (SEE), approve (SM Projects), pay (Operations). */
export function CertRows({ rows, projectName, onChange, empty = 'No payment certificates' }: { rows: SubCert[]; projectName?: (id: string) => string; onChange: () => void; empty?: string }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  if (!rows.length) return <Empty title={empty} />;
  const mine = (c: SubCert) =>
    (c.status === 'prepared' && me.role === 'senior_elec_engineer') ||
    (c.status === 'verified' && me.role === 'sm_projects') ||
    (c.status === 'approved' && me.role === 'operations_exec') ||
    (c.status === 'returned' && (c.prepared_by === me.id || me.role === 'senior_elec_engineer'));
  const act = async (c: SubCert, ok: boolean) => {
    const pay = c.status === 'approved';
    const resubmit = c.status === 'returned';
    const res = resubmit
      ? {}
      : await dialog.prompt({
          title: pay ? 'Record the payment' : ok ? (c.status === 'prepared' ? 'Verify' : 'Approve') : 'Return',
          message: `${c.code} · ${c.subcontractor} · net ${fmtMoney(c.net, 'LKR')}`,
          fields: [{ key: 'n', label: pay ? 'Payment reference (cheque / transfer)' : ok ? 'Note' : 'Reason', required: pay || !ok }],
          confirmLabel: pay ? 'Paid' : ok ? 'Confirm' : 'Return',
          danger: !ok,
        });
    if (res) await dialog.run(async () => { await rpc('advance_sub_cert', { p_id: c.id, p_ok: ok, p_note: (res as { n?: string }).n || null }); onChange(); }, 'Saved');
  };
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((c) => (
        <ListRow
          key={c.id}
          wrapRight
          title={`${c.code} · ${c.subcontractor} · ${c.period}`}
          subtitle={[
            projectName?.(c.exec_project_id),
            `gross ${fmtMoney(c.gross, 'LKR')} − previous ${fmtMoney(c.previous, 'LKR')} − retention ${c.retention_pct}% − deductions ${fmtMoney(c.deductions, 'LKR')}`,
            people[c.prepared_by]?.full_name,
            c.paid_ref ? `paid ${fmtDate(c.paid_at)} · ${c.paid_ref}` : null,
            c.return_note ? `returned: ${c.return_note}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          right={
            <Row gap={4} wrap>
              <Pill label={`Net ${fmtMoney(c.net, 'LKR')}`} />
              <Pill label={CERT_STATUS[c.status]} tone={certTone(c.status)} />
              {mine(c) ? (
                c.status === 'returned' ? (
                  <Button small title="Resubmit" onPress={() => act(c, true)} />
                ) : (
                  <>
                    <Button small title={c.status === 'approved' ? 'Paid' : c.status === 'prepared' ? 'Verify' : 'Approve'} onPress={() => act(c, true)} />
                    {c.status !== 'approved' ? <Button small variant="secondary" title="Return" onPress={() => act(c, false)} /> : null}
                  </>
                )
              ) : null}
            </Row>
          }
        />
      ))}
    </Card>
  );
}
