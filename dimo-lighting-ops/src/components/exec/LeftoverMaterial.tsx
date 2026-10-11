import { Text } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ListRow, Muted, Notice, Pill, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtNumber } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { CONDITIONS } from '@/lib/returns';
import { rpc } from '@/lib/supabase';

type Leftover = { item: string; unit: string; balance: number };

/**
 * Before the DLP every item left in the site store under DIMO's custody goes back – to SAP (with the SAP return reference) or into
 * the Project returns stock. Until then the handover cannot be requested (and SM Projects cannot override it).
 */
export function LeftoverMaterial({ p, onChange }: { p: ExecProject; onChange: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const { data, reload } = useLoad(() => rpc<Leftover[]>('project_leftovers', { p_exec: p.id }), [p.id, p.stage]);
  const can = (me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer') && p.status === 'active';
  const left = data ?? [];

  const done = async () => {
    await reload();
    onChange();
  };
  const returnOne = async (l: Leftover) => {
    const r = await dialog.prompt({
      title: `Return ${l.item}`,
      message: `${fmtNumber(l.balance, 2)} ${l.unit} in the site store (DIMO custody). Return it to SAP with the SAP return reference, or put it into the Project returns stock for other projects.`,
      fields: [
        { key: 'qty', label: `Quantity (${l.unit})`, required: true, initial: String(l.balance) },
        { key: 'dest', label: 'Return to', type: 'select', required: true, initial: 'returns', options: [
          { value: 'returns', label: 'Project returns stock' },
          { value: 'sap', label: 'SAP (returned to the main store)' },
        ] },
        { key: 'sap_ref', label: 'SAP return reference (for SAP)' },
        { key: 'condition', label: 'Condition (for Project returns)', type: 'select', initial: 'good', options: CONDITIONS },
        { key: 'location', label: 'Kept at (for Project returns)', initial: '' },
        { key: 'note', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: 'Return',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('return_leftovers', { p_exec: p.id, p_lines: [{ item: l.item, ...r }] });
        await done();
      }, r.dest === 'sap' ? 'Recorded as returned to SAP' : 'Moved to Project returns – Operations is told');
  };
  const returnAll = async () => {
    const r = await dialog.prompt({
      title: `Return all ${left.length} item(s) to Project returns`,
      message: left.map((l) => `${l.item}: ${fmtNumber(l.balance, 2)} ${l.unit}`).join('\n'),
      fields: [
        { key: 'condition', label: 'Condition', type: 'select', initial: 'good', options: CONDITIONS },
        { key: 'location', label: 'Kept at', required: true },
      ],
      confirmLabel: 'Return all',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('return_leftovers', { p_exec: p.id, p_lines: left.map((l) => ({ item: l.item, qty: l.balance, dest: 'returns', condition: r.condition, location: r.location })) });
        await done();
      }, 'All moved to Project returns – Operations is told');
  };

  return (
    <Card style={{ gap: 6 }}>
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontWeight: '700', color: colors.ink }}>Leftover material</Text>
        <Pill label={left.length ? `${left.length} to return` : 'Nothing left in the store'} tone={left.length ? colors.red : colors.green} solid={!left.length} />
      </Row>
      {left.length ? (
        <>
          <Notice tone={colors.amber}>
            The handover (DLP) cannot be requested until every leftover item under DIMO&apos;s custody is returned – to SAP or to the Project returns stock. Client&apos;s and
            subcontractors&apos; material is not included.
          </Notice>
          {left.map((l) => (
            <ListRow
              key={l.item}
              title={l.item}
              subtitle={`${fmtNumber(l.balance, 2)} ${l.unit} in the site store`}
              right={can ? <Button small title="Return" onPress={() => returnOne(l)} /> : null}
            />
          ))}
          {can && left.length > 1 ? (
            <Row style={{ justifyContent: 'flex-end' }}>
              <Button small variant="secondary" title="Return all to Project returns" onPress={returnAll} />
            </Row>
          ) : null}
        </>
      ) : (
        <Muted>All DIMO material has been used or returned.</Muted>
      )}
    </Card>
  );
}
