// Design & estimation work helpers: status, lateness and timeline labels.
import type { Tone } from '@/components/ui';

import { daysBetween, todayIso } from './format';
import type { WorkEvent, WorkKind, WorkRequest } from './types';

export const kindLabel = (k?: WorkKind | string | null) => (k === 'design' ? 'Design' : 'Estimation');

export function isOpen(w: Pick<WorkRequest, 'status'>): boolean {
  return w.status === 'new' || w.status === 'in_progress' || w.status === 'on_hold';
}

export function workState(w: WorkRequest): { label: string; tone: Tone; late: boolean; daysLate: number } {
  const today = todayIso();
  const late = isOpen(w) && !!w.due_date && w.due_date < today;
  const daysLate = late ? daysBetween(w.due_date!, today) : 0;
  if (late) return { label: `Late ${daysLate}d`, tone: 'danger', late, daysLate };
  switch (w.status) {
    case 'new': return { label: w.assigned_to ? 'Assigned' : 'New', tone: 'info', late, daysLate };
    case 'in_progress': return { label: 'In progress', tone: 'primary', late, daysLate };
    case 'on_hold': return { label: 'On hold', tone: 'warning', late, daysLate };
    case 'submitted': return { label: w.completed_late ? 'Submitted late' : 'Submitted', tone: w.completed_late ? 'warning' : 'success', late, daysLate };
    default: return { label: 'Cancelled', tone: 'neutral', late, daysLate };
  }
}

export function turnaroundDays(w: WorkRequest): number | null {
  if (!w.received_at) return null;
  const end = w.completed_at ? Date.parse(w.completed_at) : Date.now();
  return Math.round(((end - Date.parse(w.received_at)) / 86400000) * 10) / 10;
}

export const EVENT_LABELS: Record<string, string> = {
  created: 'Request received', assigned: 'Assigned', started: 'Work started', on_hold: 'Put on hold', resumed: 'Resumed',
  submitted: 'Submitted to sales', cancelled: 'Cancelled', reopened: 'Reopened', due_changed: 'Due date changed',
  revision_requested: 'Revision requested', note: 'Note',
};

export function eventText(e: WorkEvent, name: (id?: string | null) => string): string {
  const base = EVENT_LABELS[e.event] ?? e.event;
  if (e.event === 'assigned') return `${base} to ${name(e.to_value)}`;
  if (e.event === 'due_changed') return `${base}: ${e.from_value ?? '–'} → ${e.to_value ?? '–'}`;
  return base;
}
