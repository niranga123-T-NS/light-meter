import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, Grid, ListRow, Muted, Notice, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { COST_CODES, type CostLine, type ExecProject, type SubCert } from '@/lib/execution';
import { fmtMoney } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { CertRows } from './CertRows';

/** Budget vs committed vs actual per cost code (entered until the ERP link exists), and subcontractor payment certificates. */
export function CostTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const { data, reload } = useLoad(async () => {
    const [l, c] = await Promise.all([
      supabase.from('exec_cost_lines').select('*').eq('exec_project_id', p.id).order('cost_code').order('description'),
      supabase.from('sub_certs').select('*').eq('exec_project_id', p.id).order('prepared_at', { ascending: false }),
    ]);
    return { lines: (l.data ?? []) as CostLine[], certs: (c.data ?? []) as SubCert[] };
  }, [p.id]);
  const canEdit = me.role === 'senior_elec_engineer' || me.role === 'operations_exec';
  const canPrepare = me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer';
  const lines = data?.lines ?? [];
  const sum = (k: 'budget' | 'committed' | 'actual') => lines.reduce((a, l) => a + Number(l[k]), 0);
  const budget = sum('budget');
  const spent = sum('committed') + sum('actual');

  const edit = async (l?: CostLine) => {
    const res = await dialog.prompt({
      title: l ? l.description : 'Cost line',
      fields: [
        { key: 'cost_code', label: 'Cost code', type: 'select', required: true, options: COST_CODES, initial: l?.cost_code ?? 'material' },
        { key: 'description', label: 'Description', required: true, initial: l?.description },
        { key: 'budget', label: 'Budget (LKR)', initial: l ? String(l.budget) : '' },
        { key: 'committed', label: 'Committed – POs / subcontracts (LKR)', initial: l ? String(l.committed) : '' },
        { key: 'actual', label: 'Actual – invoiced / paid (LKR)', initial: l ? String(l.actual) : '' },
      ],
      confirmLabel: 'Save',
    });
    if (res) await dialog.run(async () => { await rpc('save_cost_line', { p_exec: p.id, p_id: l?.id ?? null, p: res }); await reload(); }, 'Saved');
  };
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
    <>
      {lines.length || canEdit ? (
        <Section title="Cost" right={canEdit ? <Button small title="+ Cost line" onPress={() => edit()} /> : null}>
          <Grid min={150}>
            <Stat label="Budget" value={fmtMoney(budget, 'LKR')} />
            <Stat label="Committed" value={fmtMoney(sum('committed'), 'LKR')} />
            <Stat label="Actual" value={fmtMoney(sum('actual'), 'LKR')} />
            <Stat label="Committed + actual vs budget" value={budget ? `${Math.round((spent / budget) * 100)}%` : '—'} tone={budget && spent > budget ? 'red' : budget && spent > budget * 0.9 ? 'amber' : undefined} />
          </Grid>
          {budget && spent > budget ? <Notice tone={colors.red}>Committed + actual cost is above the budget – SM Projects has been told.</Notice> : null}
          {lines.length ? (
            <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
              {lines.map((l) => (
                <ListRow
                  key={l.id}
                  wrapRight
                  onPress={canEdit ? () => edit(l) : undefined}
                  highlight={Number(l.committed) + Number(l.actual) > Number(l.budget) && Number(l.budget) > 0 ? colors.red : undefined}
                  title={`${COST_CODES.find((c) => c.value === l.cost_code)?.label} · ${l.description}`}
                  right={<Muted>{`${fmtMoney(l.budget, 'LKR')} · ${fmtMoney(l.committed, 'LKR')} · ${fmtMoney(l.actual, 'LKR')}`}</Muted>}
                />
              ))}
            </Card>
          ) : (
            <Empty title="No cost lines" hint="Budget, committed and actual per cost code" />
          )}
          <Muted>Budget · committed · actual</Muted>
        </Section>
      ) : null}
      <Section title="Subcontractor payment certificates" right={canPrepare && p.status === 'active' ? <Button small variant="secondary" title="+ Certificate" onPress={prepare} /> : null}>
        <CertRows rows={data?.certs ?? []} onChange={reload} />
      </Section>
    </>
  );
}
