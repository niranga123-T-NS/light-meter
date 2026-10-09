import { useDialog } from '@/components/dialog';
import { Button, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { type ExecProject, type SubCert } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { CertRows } from './CertRows';

/** Subcontractor payment certificates of the project: Assistant Engineers prepare, the Senior Electrical Engineer verifies. */
export function SubCertsTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const { data, reload } = useLoad(async () => {
    const { data: c } = await supabase.from('sub_certs').select('*').eq('exec_project_id', p.id).order('prepared_at', { ascending: false });
    return { certs: (c ?? []) as SubCert[] };
  }, [p.id]);
  const canPrepare = me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer';

  const prepare = async () => {
    const res = await dialog.prompt({
      title: 'Subcontractor payment certificate',
      fields: [
        { key: 'subcontractor', label: 'Subcontractor', required: true },
        { key: 'period', label: 'Period (e.g. Oct 2026)', required: true },
        { key: 'gross', label: 'Gross value of work done to date (LKR)', required: true },
        { key: 'previous', label: 'Previously certified (LKR)' },
        { key: 'retention_pct', label: 'Retention %', initial: '10' },
        { key: 'deductions', label: 'Other deductions (LKR)' },
        { key: 'note', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: 'Prepare',
    });
    if (res) await dialog.run(async () => { await rpc('prepare_sub_cert', { p_exec: p.id, p: res }); await reload(); }, 'Sent to the Senior Electrical Engineer to verify');
  };

  return (
    <Section title="Subcontractor payment certificates" right={canPrepare && p.status === 'active' ? <Button small variant="secondary" title="+ Certificate" onPress={prepare} /> : null}>
      <CertRows rows={data?.certs ?? []} onChange={reload} />
    </Section>
  );
}
