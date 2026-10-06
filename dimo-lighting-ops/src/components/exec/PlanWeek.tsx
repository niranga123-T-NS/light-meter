import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Muted, Row } from '@/components/ui';
import { PLAN_KINDS, type ExecMember, type PlanItem } from '@/lib/execution';
import { activityOptions, type Activity } from '@/lib/programme';
import { addDaysISO, fmtDate } from '@/lib/format';
import { usePeople } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';
import { PlanItemRow } from './PlanItemRow';

/** A week of plan items, Monday to Saturday. With `edit`, the owner adds, changes and removes items. */
export function PlanWeek({
  week,
  items,
  edit,
  project,
  supervisors,
  canResult,
  onChange,
  programme,
}: {
  week: string;
  items: PlanItem[];
  edit?: boolean;
  project: string;
  supervisors: ExecMember[];
  canResult: boolean;
  onChange: () => void;
  /** The project's programme: when approved, every item is linked to an activity */
  programme?: { live: boolean; acts: Activity[] } | null;
}) {
  const dialog = useDialog();
  const people = usePeople();
  const days = [0, 1, 2, 3, 4, 5].map((i) => addDaysISO(week, i));

  const editItem = async (day: string, it?: PlanItem) => {
    const r = await dialog.prompt({
      title: it ? 'Change the item' : `Plan for ${fmtDate(day)}`,
      fields: [
        { key: 'day', label: 'Day', type: 'select', required: true, initial: it?.day ?? day, options: days.map((d) => ({ value: d, label: fmtDate(d) })) },
        { key: 'kind', label: 'Type', type: 'select', required: true, initial: it?.kind ?? 'task', options: PLAN_KINDS },
        ...(programme?.acts.length
          ? [
              {
                key: 'act',
                label: programme.live ? 'Programme activity (⚠ = critical)' : 'Programme activity (optional until the programme is approved)',
                type: 'select' as const,
                required: programme.live,
                initial: it?.activity_id ?? undefined,
                options: activityOptions(programme.acts, week),
              },
            ]
          : []),
        { key: 'title', label: programme?.acts.length ? 'Work this day (empty = the activity name)' : 'Work / activity', required: !programme?.acts.length, initial: it?.title },
        { key: 'zone', label: 'Zone / area', initial: it?.zone ?? '' },
        { key: 'qty', label: 'Quantity (optional)', initial: it?.qty != null ? String(it.qty) : '' },
        { key: 'unit', label: 'Unit (m, nos, points…)', initial: it?.unit ?? '' },
        {
          key: 'sup',
          label: 'Subcontractor supervisor',
          type: 'select',
          initial: it?.supervisor_id ?? '',
          options: [{ value: '', label: 'Own team (no supervisor)' }, ...supervisors.map((s) => ({ value: s.user_id, label: people[s.user_id]?.full_name ?? '—' }))],
        },
      ],
      confirmLabel: 'Save',
    });
    if (r)
      await dialog.run(async () => {
        const act = programme?.acts.find((a) => a.id === r.act);
        await rpc('save_plan_item', {
          p_exec: project,
          p_week: week,
          p: { id: it?.id ?? '', day: r.day, kind: r.kind, title: r.title || act?.name || '', zone: r.zone, qty: r.qty, unit: r.unit, supervisor_id: r.sup, activity_id: r.act ?? '' },
        });
        onChange();
      }, 'Saved');
  };

  const remove = (it: PlanItem) =>
    dialog.run(async () => {
      await rpc('delete_plan_item', { p_id: it.id });
      onChange();
    }, 'Removed');

  return (
    <View style={{ gap: 8 }}>
      {days.map((d) => {
        const list = items.filter((i) => i.day === d);
        return (
          <Card key={d} style={{ padding: 0, overflow: 'hidden' }}>
            <Row style={{ justifyContent: 'space-between', padding: 10, backgroundColor: colors.soft }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{fmtDate(d)}</Text>
              {edit ? <Button small variant="ghost" title="+ Add" onPress={() => editItem(d)} /> : null}
            </Row>
            {list.map((it) => (
              <PlanItemRow
                key={it.id}
                it={it}
                activity={programme?.acts.find((a) => a.id === it.activity_id)}
                onChange={onChange}
                canResult={canResult}
                extra={
                  edit && it.source === 'plan' && it.status === 'planned' ? (
                    <>
                      <Button small variant="ghost" title="Edit" onPress={() => editItem(d, it)} />
                      <Button small variant="ghost" title="✕" onPress={() => remove(it)} />
                    </>
                  ) : null
                }
              />
            ))}
            {!list.length ? <Muted style={{ padding: 10 }}>Nothing planned</Muted> : null}
          </Card>
        );
      })}
    </View>
  );
}
