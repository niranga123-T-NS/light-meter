import type { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { fmtDate } from '@/lib/format';
import { todayIso, type StepLine } from '@/lib/foreignOrders';

type Dialog = ReturnType<typeof useDialog>;

const REQUIRED_REF = ['pr_raised', 'po_issued', 'loa_issued'];

/** Record a local-order step (Ops): the date, the reference where there is one, a note */
export async function recordLoStep(dialog: Dialog, l: StepLine, requestId: string, orderId: string | null) {
  const r = await dialog.prompt({
    title: l.def.label,
    message: `${l.def.node}${l.start ? ` · follows the step done on ${fmtDate(l.start)}` : ''}${l.def.sla_days ? ` · SLA ${l.def.sla_days} working days` : ''}`,
    fields: [
      { key: 'date', label: 'Done on', type: 'date', required: true, initial: l.done?.done_on ?? todayIso() },
      ...(l.def.ref_label ? [{ key: 'ref', label: l.def.ref_label, initial: l.done?.ref ?? '', required: REQUIRED_REF.includes(l.def.key) }] : []),
      { key: 'note', label: 'Note', type: 'multiline', initial: l.done?.note ?? '' },
    ],
    confirmLabel: l.done ? 'Save' : 'Record',
  });
  if (!r) return false;
  return dialog.run(() => rpc('lo_record_step', { p_request: requestId, p_order: orderId, p_step: l.def.key, p_date: r.date, p_ref: r.ref ?? null, p_note: r.note || null }), 'Recorded');
}

export async function clearLoStep(dialog: Dialog, l: StepLine) {
  if (!l.done) return false;
  if (!(await dialog.confirm(`Clear "${l.def.label}"?`, 'Only for a step recorded by mistake.', { confirmLabel: 'Clear', danger: true }))) return false;
  return dialog.run(() => rpc('lo_clear_step', { p_id: l.done!.id }), 'Cleared');
}
