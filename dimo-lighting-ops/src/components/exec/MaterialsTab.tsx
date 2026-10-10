import { router } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CUSTODY, STORE_KINDS, type ExecMember, type ExecProject, type MaterialRequest } from '@/lib/execution';
import { useLoad, usePeople } from '@/lib/hooks';
import { exportMaterialsReport } from '@/lib/materialsReport';
import { ROLE_LABELS } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import { MaterialIssues, StoreBalances, type Balance } from './MaterialStore';
import { MaterialRows } from './MaterialRows';

/** The project's materials: requests and deliveries (history), the site store by custody, and the materials issued to the work. */
export function MaterialsTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, reload } = useLoad(async () => {
    const [m, mem] = await Promise.all([
      supabase.from('material_requests').select('*').eq('exec_project_id', p.id).order('requested_at', { ascending: false }),
      supabase.from('exec_members').select('*').eq('exec_project_id', p.id).eq('active', true),
    ]);
    return { mrs: (m.data ?? []) as MaterialRequest[], members: (mem.data ?? []) as ExecMember[] };
  }, [p.id]);
  const aeOfProject = me.role === 'assistant_engineer' && !!data?.members.some((x) => x.user_id === me.id && x.member_role === 'assistant_engineer');
  const canRequest = me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer';
  const canMove = aeOfProject || me.role === 'senior_elec_engineer' || me.role === 'operations_exec';

  // Returns and transfers between sites (issues to the work go through "Issue material")
  const move = async () => {
    const bal = await rpc<Balance[]>('store_balances', { p_exec: p.id });
    const res = await dialog.prompt({
      title: 'Return / transfer',
      fields: [
        { key: 'k', label: 'Movement', type: 'select', required: true, options: STORE_KINDS.filter((k) => k.value !== 'issue'), initial: 'transfer_out' },
        { key: 'i', label: 'Item', type: 'select', required: true, options: bal.map((b) => ({ value: b.item, label: `${b.item} · ${b.balance} ${b.unit} (${CUSTODY.find((c) => c.value === b.custody)?.label})` })) },
        { key: 'q', label: 'Quantity', required: true },
        { key: 'n', label: 'Where / note', required: true },
      ],
      confirmLabel: 'Record',
    });
    if (!res) return;
    const b = bal.find((x) => x.item === res.i);
    await dialog.run(async () => {
      await rpc('store_move', { p_exec: p.id, p_kind: res.k, p_item: res.i, p_unit: b?.unit ?? 'nos', p_qty: Number(res.q), p_note: res.n || null });
      await reload();
    }, 'Recorded');
  };

  return (
    <>
      {me.role === 'senior_elec_engineer' || me.role === 'sm_projects' || me.role === 'gm' ? (
        <Row style={{ justifyContent: 'flex-end' }}>
          <Button small variant="secondary" title="Materials report (PDF)" onPress={() => dialog.run(() => exportMaterialsReport(p, people, `${me.full_name} – ${ROLE_LABELS[me.role]}`))} />
        </Row>
      ) : null}
      <Section
        title="Material requests and deliveries"
        right={canRequest && p.status === 'active' ? <Button small title="+ Request" onPress={() => router.push({ pathname: '/execution/material/new', params: { project: p.id } })} /> : null}
      >
        <MaterialRows rows={data?.mrs ?? []} />
      </Section>
      <StoreBalances p={p} aeOfProject={aeOfProject} />
      {canMove ? (
        <Row>
          <Button small variant="ghost" title="Return / transfer" onPress={move} />
        </Row>
      ) : null}
      <MaterialIssues p={p} aeOfProject={aeOfProject} onChange={reload} />
    </>
  );
}
