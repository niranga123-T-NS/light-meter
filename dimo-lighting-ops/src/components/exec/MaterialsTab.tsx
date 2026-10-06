import { router } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Card, Empty, ListRow, Muted, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { STORE_KINDS, storeBalance, type ExecProject, type MaterialRequest, type StoreMove } from '@/lib/execution';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { MaterialRows } from './MaterialRows';

/** Material requests of the project and the site store (balance from receipts, issues, returns and transfers). */
export function MaterialsTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, reload } = useLoad(async () => {
    const [m, s] = await Promise.all([
      supabase.from('material_requests').select('*').eq('exec_project_id', p.id).order('requested_at', { ascending: false }),
      supabase.from('store_moves').select('*').eq('exec_project_id', p.id).order('at', { ascending: false }),
    ]);
    return { mrs: (m.data ?? []) as MaterialRequest[], moves: (s.data ?? []) as StoreMove[] };
  }, [p.id]);
  const canRequest = me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer';
  const canMove = me.role !== 'gm';
  const balance = storeBalance(data?.moves ?? []);

  const move = async () => {
    const res = await dialog.prompt({
      title: 'Store movement',
      fields: [
        { key: 'k', label: 'Movement', type: 'select', required: true, options: STORE_KINDS, initial: 'issue' },
        { key: 'i', label: 'Item', type: 'select', required: true, options: balance.map((b) => ({ value: b.item, label: `${b.item} · ${fmtNumber(b.qty)} ${b.unit} in store` })) },
        { key: 'q', label: 'Quantity', required: true },
        { key: 'n', label: 'Where / note' },
      ],
      confirmLabel: 'Record',
    });
    if (!res) return;
    const b = balance.find((x) => x.item === res.i);
    await dialog.run(async () => {
      await rpc('store_move', { p_exec: p.id, p_kind: res.k, p_item: res.i, p_unit: b?.unit ?? 'nos', p_qty: Number(res.q), p_note: res.n || null });
      await reload();
    }, 'Recorded');
  };

  return (
    <>
      <Section
        title="Material requests"
        right={canRequest && p.status === 'active' ? <Button small title="+ Request" onPress={() => router.push({ pathname: '/execution/material/new', params: { project: p.id } })} /> : null}
      >
        <MaterialRows rows={data?.mrs ?? []} />
      </Section>
      <Section title="Site store" right={canMove && balance.length ? <Button small variant="secondary" title="Issue / return / transfer" onPress={move} /> : null}>
        {balance.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {balance.map((b) => (
              <ListRow key={b.item} title={b.item} right={<Muted>{`${fmtNumber(b.qty)} ${b.unit}`}</Muted>} />
            ))}
          </Card>
        ) : (
          <Empty title="Nothing received yet" hint="Deliveries recorded against material requests come into the site store" />
        )}
        {data?.moves.length ? (
          <Card style={{ marginTop: 8 }}>
            <Muted>Latest movements</Muted>
            {data.moves.slice(0, 15).map((x) => (
              <Row key={x.id} style={{ justifyContent: 'space-between' }} wrap>
                <Muted>{`${STORE_KINDS.find((k) => k.value === x.kind)?.label ?? 'Receipt'} · ${x.item} · ${fmtNumber(x.qty)} ${x.unit}${x.note ? ` · ${x.note}` : ''}`}</Muted>
                <Muted>{`${people[x.by_id]?.full_name ?? ''} · ${fmtDateTime(x.at)}`}</Muted>
              </Row>
            ))}
          </Card>
        ) : null}
      </Section>
    </>
  );
}
