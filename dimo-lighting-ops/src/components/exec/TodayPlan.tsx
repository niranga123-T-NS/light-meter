import { useDialog } from '@/components/dialog';
import { TestingTag } from '@/components/Testing';
import { Button, Card, Muted, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { PLAN_KINDS, type ExecProject, type PlanItem } from '@/lib/execution';
import { addDaysISO, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { PlanItemRow } from './PlanItemRow';

/** My Day: today's plan items – a supervisor's own items (and "add a task"), or everything planned on an engineer's projects. */
export function TodayPlan() {
  const me = useMe();
  const dialog = useDialog();
  const sup = me.role === 'sub_supervisor';
  const { data, reload } = useLoad(async () => {
    const today = todayISO();
    const [its, pr] = await Promise.all([
      supabase.from('exec_plan_items').select('*').lte('day', today).gte('day', addDaysISO(today, -1)).order('day'),
      supabase.from('exec_projects').select('*').eq('status', 'active'),
    ]);
    return { items: (its.data ?? []) as PlanItem[], projects: (pr.data ?? []) as ExecProject[] };
  });
  if (!data) return null;
  const today = todayISO();
  // Today's work, and yesterday's still without a result
  const items = data.items.filter((i) => (i.day === today || i.status === 'planned') && (!sup || i.supervisor_id === me.id) && i.acceptance !== 'rejected');
  if (!items.length && !sup) return null;

  const add = async () => {
    const r = await dialog.prompt({
      title: 'Add a task or action',
      message: 'The Assistant Engineers of the project are told. Start it once one of them accepts it.',
      fields: [
        { key: 'p', label: 'Project', type: 'select', required: true, initial: data.projects[0]?.id, options: data.projects.map((p) => ({ value: p.id, label: p.name })) },
        { key: 'day', label: 'Day', type: 'date', required: true, initial: today },
        { key: 'kind', label: 'Type', type: 'select', required: true, initial: 'task', options: PLAN_KINDS },
        { key: 'title', label: 'Task / action', required: true },
        { key: 'zone', label: 'Zone / area' },
        { key: 'qty', label: 'Quantity (optional)' },
        { key: 'unit', label: 'Unit' },
      ],
      confirmLabel: 'Add',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('supervisor_add_item', { p_exec: r.p, p: { day: r.day, kind: r.kind, title: r.title, zone: r.zone, qty: r.qty, unit: r.unit } });
        await reload();
      }, 'Added – waiting for the Assistant Engineer');
  };

  return (
    <Section title={`Today's plan (${items.length})`} right={<TestingTag />}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {items.map((it) => (
          <PlanItemRow key={it.id} it={it} onChange={reload} canResult={sup ? it.supervisor_id === me.id : me.role !== 'trainee'} showDay={it.day !== today} />
        ))}
        {!items.length ? <Muted style={{ padding: 12 }}>Nothing planned for you today</Muted> : null}
      </Card>
      {sup && data.projects.length ? (
        <Row style={{ marginTop: 8 }}>
          <Button small variant="secondary" title="+ Add a task or action" onPress={add} />
        </Row>
      ) : null}
    </Section>
  );
}
