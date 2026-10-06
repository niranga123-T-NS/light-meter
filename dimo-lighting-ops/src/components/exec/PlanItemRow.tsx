import { useDialog } from '@/components/dialog';
import { Button, colors, ListRow, Pill, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ITEM_STATUS, PLAN_KINDS, type PlanItem } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { weekOf } from '@/lib/execution';
import { usePeople } from '@/lib/hooks';
import { activityOptions, loadProgramme, type Activity } from '@/lib/programme';
import { rpc } from '@/lib/supabase';

const tone = (s: PlanItem['status']) => (s === 'done' ? colors.green : s === 'partial' ? colors.amber : s === 'not_done' ? colors.red : colors.grey);

/** One plan item with its result, and – where allowed – the buttons to record the result or decide a supervisor addition. */
export function PlanItemRow({
  it,
  onChange,
  canResult,
  showDay,
  extra,
  activity,
}: {
  it: PlanItem;
  onChange: () => void;
  canResult: boolean;
  showDay?: boolean;
  extra?: React.ReactNode;
  activity?: Activity;
}) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const pending = it.source === 'supervisor' && it.acceptance === 'pending';
  const canDecide = pending && (me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer');
  const startable = it.source === 'plan' || it.acceptance === 'accepted';

  const result = async () => {
    const r = await dialog.prompt({
      title: it.title,
      fields: [
        {
          key: 's',
          label: 'Result',
          type: 'select',
          required: true,
          initial: it.status === 'planned' ? 'done' : it.status,
          options: [
            { value: 'done', label: 'Done' },
            { value: 'partial', label: 'Partly done' },
            { value: 'not_done', label: 'Not done' },
          ],
        },
        ...(it.qty != null ? [{ key: 'q', label: `Quantity done (planned ${it.qty} ${it.unit ?? ''})`, initial: it.done_qty != null ? String(it.done_qty) : '' }] : []),
        { key: 'n', label: 'Note / reason (needed if not fully done)', type: 'multiline' as const },
      ],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('update_plan_item', { p_id: it.id, p_status: r.s, p_done_qty: r.q ? Number(r.q) : null, p_note: r.n || null }); onChange(); }, 'Saved');
  };

  const decide = async (accept: boolean) => {
    let reason: string | null = null;
    let act: string | null = null;
    if (accept) {
      // Once the programme is approved, the accepted task joins a programme activity
      const pg = await loadProgramme(it.exec_project_id);
      if (pg.live) {
        const r = await dialog.prompt({
          title: 'Accept the added task',
          message: it.title,
          fields: [{ key: 'a', label: 'Programme activity (⚠ = critical)', type: 'select', required: true, options: activityOptions(pg.acts, weekOf(it.day)) }],
          confirmLabel: 'Accept',
        });
        if (!r) return;
        act = r.a;
      }
    }
    if (!accept) {
      const r = await dialog.prompt({ title: 'Reject the added task', fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Reject', danger: true });
      if (!r) return;
      reason = r.r;
    }
    await dialog.run(async () => { await rpc('decide_supervisor_item', { p_id: it.id, p_accept: accept, p_reason: reason, p_activity: act }); onChange(); }, accept ? 'Accepted – the supervisor is told' : 'Rejected');
  };

  return (
    <ListRow
      wrapRight
      highlight={pending ? colors.amber : it.status === 'not_done' ? colors.red : undefined}
      title={`${it.title}${it.source === 'supervisor' ? ' · added by supervisor' : ''}`}
      subtitle={[
        activity ? `${activity.critical && !activity.actual_finish ? '⚠ ' : ''}${activity.code}` : null,
        showDay ? fmtDate(it.day) : null,
        PLAN_KINDS.find((k) => k.value === it.kind)?.label,
        it.zone,
        it.qty != null ? `${it.done_qty != null ? `${it.done_qty} / ` : ''}${it.qty} ${it.unit ?? ''}` : null,
        it.supervisor_id ? people[it.supervisor_id]?.full_name : 'no supervisor',
        it.result_note,
        it.acceptance === 'rejected' ? `rejected – ${it.reject_reason ?? ''}` : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      right={
        <Row gap={4} wrap>
          {pending ? <Pill label="Waiting for AE" tone={colors.amber} /> : <Pill label={ITEM_STATUS[it.status]} tone={tone(it.status)} />}
          {canDecide ? (
            <>
              <Button small title="Accept" onPress={() => decide(true)} />
              <Button small variant="ghost" title="Reject" onPress={() => decide(false)} />
            </>
          ) : null}
          {canResult && startable && it.acceptance !== 'rejected' && it.day <= todayISO() ? <Button small variant="secondary" title="Result" onPress={result} /> : null}
          {extra}
        </Row>
      }
    />
  );
}
