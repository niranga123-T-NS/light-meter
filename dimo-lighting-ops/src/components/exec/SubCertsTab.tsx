import { router } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, colors, Muted, Notice, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { SINV_NOTICE, type ExecProject, type SubCert, type SubInvoice } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { CertRows } from './CertRows';
import { SubInvoiceRows } from './SubInvoiceRows';

/** Subcontractor payment certificates of the project: the supervisor (or AE) submits the IPC and sheets, the AE checks, the SEE approves; then the invoice. */
export function SubCertsTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const { data } = useLoad(async () => {
    const [{ data: c }, { data: v }] = await Promise.all([
      supabase.from('sub_certs').select('*').eq('exec_project_id', p.id).neq('status', 'cancelled').order('prepared_at', { ascending: false }),
      supabase.from('sub_invoices').select('*').eq('exec_project_id', p.id).neq('status', 'cancelled').order('created_at', { ascending: false }),
    ]);
    return { certs: (c ?? []) as SubCert[], invoices: (v ?? []) as SubInvoice[] };
  }, [p.id]);
  const sub = me.role === 'sub_supervisor';
  const canRecord = me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer' || sub;

  const prepare = async () => {
    const res = await dialog.prompt({
      title: 'Request a joint measurement',
      message: 'The first step of every IPC. The AE / SEE confirms the date; after the measurement upload the joint measurement sheets for approval – then the IPC.',
      fields: [
        { key: 'subcontractor', label: 'Subcontractor', required: true },
        { key: 'period', label: 'Period (e.g. Oct 2026)', required: true },
        { key: 'jm_date', label: 'Proposed date for the joint measurement', type: 'date', required: true },
        { key: 'jm_scope', label: 'Work / areas to measure', type: 'multiline' },
        { key: 'retention_pct', label: 'Retention % (for the IPC)', initial: '10' },
      ],
      confirmLabel: 'Request',
    });
    if (res) await dialog.run(async () => { const id = await rpc<string>('prepare_sub_cert', { p_exec: p.id, p: res }); router.push(`/execution/sub-cert/${id}`); });
  };

  return (
    <>
      <Section title="Payment certificates (IPC)" right={canRecord && p.status === 'active' ? <Button small title="+ Request joint measurement" onPress={prepare} /> : null}>
        <CertRows rows={data?.certs ?? []} empty={sub ? 'No IPC submitted by you yet' : undefined} />
        <Muted>Joint measurement first: request it, upload the joint measurement sheets for AE / SEE approval. Then the IPC with its measurement sheets is checked by the AE (when a supervisor submits it), then given Interim Payment Approval (IPA) by the SEE. Until IPA it shows “IPA pending”; only then can the invoice, signed IPC and final measurement sheets be uploaded.</Muted>
      </Section>
      <Section
        title="Subcontractor invoices"
        right={
          canRecord && p.status === 'active' ? (
            <Button small title="+ Record invoice" onPress={() => router.push({ pathname: '/execution/sub-invoice/new', params: { project: p.id } })} />
          ) : null
        }
      >
        {canRecord ? <Notice tone={colors.blue}>{SINV_NOTICE}</Notice> : null}
        <SubInvoiceRows rows={data?.invoices ?? []} />
        <Muted>Recorded against an IPA-approved IPC, with the signed IPC and final measurement sheets · a supervisor&apos;s invoice is checked by the AE · approved by the SEE, then Operations · then the physical documents go to the office.</Muted>
      </Section>
    </>
  );
}
