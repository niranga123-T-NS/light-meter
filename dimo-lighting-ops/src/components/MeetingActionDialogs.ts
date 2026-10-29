import { useDialog } from '@/components/dialog';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { NOT_DONE_REASONS, REVIEW_STATES } from '@/lib/meetingActions';
import { ROLE_SHORT } from '@/lib/roles';
import { rpc } from '@/lib/supabase';
import type { Role } from '@/lib/types';

type Dialog = ReturnType<typeof useDialog>;
type ActionRef = { id: string; action: string; due_date: string | null; state?: string | null; reviewDue?: string | null };

/** Status update: Delayed asks for the new due date, Blocked for who can help. */
export async function postStatusUpdate(dialog: Dialog, a: ActionRef, onDone: () => unknown) {
  const helpers = await rpc<{ id: string; full_name: string; role: Role }[]>('meeting_action_helpers').catch(() => []);
  const r = await dialog.prompt({
    title: 'Status update',
    message: `${a.action}${a.reviewDue ? ` · before the next meeting ${fmtDateTime(a.reviewDue)}` : ''}`,
    fields: [
      { key: 's', label: 'Status', type: 'select', required: true, options: REVIEW_STATES, initial: a.state ?? undefined },
      { key: 'd', label: 'New due date', type: 'date', when: { key: 's', in: ['delayed'] }, hint: a.due_date ? `Was ${fmtDate(a.due_date)} – the original date stays in the history` : 'The action had no due date' },
      {
        key: 'h',
        label: 'Who can help',
        type: 'select',
        searchable: true,
        when: { key: 's', in: ['blocked'] },
        options: helpers.map((h) => ({ value: h.id, label: `${h.full_name} · ${ROLE_SHORT[h.role] ?? h.role}` })),
        hint: 'They are told and the action shows on their list until it moves',
      },
      { key: 'n', label: 'Progress / what is holding it', type: 'multiline', required: true },
    ],
    confirmLabel: 'Post update',
  });
  if (!r) return;
  if (r.s === 'delayed' && !r.d) return dialog.toast('Set the new due date', 'error');
  if (r.s === 'delayed' && r.d < todayISO()) return dialog.toast('The new due date cannot be in the past', 'error');
  if (r.s === 'blocked' && !r.h) return dialog.toast('Choose who can help', 'error');
  await dialog.run(async () => {
    await rpc('review_meeting_action', { p_id: a.id, p_state: r.s, p_note: r.n, p_due: r.s === 'delayed' ? r.d : null, p_helper: r.s === 'blocked' ? r.h : null });
    await onDone();
  }, r.s === 'blocked' ? 'Update posted – the person helping is told' : 'Update posted – it shows in the meeting status review');
}

/** Not done: closes the action with a reason; SM Projects / the meeting host accept it or reopen it. */
export async function closeNotDone(dialog: Dialog, a: ActionRef, onDone: () => unknown) {
  const r = await dialog.prompt({
    title: 'Not done',
    message: `${a.action}\n\nThe action closes and stops showing as overdue. SM Projects and the meeting host are told; they can reopen it with a new date.`,
    fields: [
      { key: 'r', label: 'Reason', type: 'select', required: true, options: NOT_DONE_REASONS.map((x) => ({ value: x.value, label: x.label })) },
      { key: 'n', label: 'Explain', type: 'multiline', required: true, maxLength: 1000 },
    ],
    confirmLabel: 'Close as not done',
  });
  if (!r) return;
  await dialog.run(async () => {
    await rpc('meeting_action_not_done', { p_id: a.id, p_reason: r.r, p_note: r.n });
    await onDone();
  }, 'Closed as not done – SM Projects reviews it');
}

/** SM Projects / the host: accept a not-done action, or reopen it with a new due date. */
export async function decideNotDone(dialog: Dialog, a: ActionRef, accept: boolean, onDone: () => unknown) {
  if (accept) {
    if (!(await dialog.confirm('Accept as not done?', a.action, { confirmLabel: 'Accept' }))) return;
    await dialog.run(async () => {
      await rpc('meeting_action_not_done_decide', { p_id: a.id, p_accept: true });
      await onDone();
    }, 'Accepted');
    return;
  }
  const r = await dialog.prompt({
    title: 'Reopen with a new date',
    message: a.action,
    fields: [
      { key: 'd', label: 'New due date', type: 'date', required: true },
      { key: 'n', label: 'Why it is reopened', type: 'multiline', required: true },
    ],
    confirmLabel: 'Reopen',
  });
  if (!r) return;
  if (r.d < todayISO()) return dialog.toast('The new due date cannot be in the past', 'error');
  await dialog.run(async () => {
    await rpc('meeting_action_not_done_decide', { p_id: a.id, p_accept: false, p_due: r.d, p_note: r.n });
    await onDone();
  }, 'Reopened – the person doing it is told');
}
