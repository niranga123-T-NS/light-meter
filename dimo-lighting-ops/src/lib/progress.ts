import { colors } from '@/components/ui';
import { WORKING_HOURS_PER_DAY } from './format';

/** A job's running timer (sla_clocks) – enough to draw the time bar */
export type JobClock = { entity_id: string; stage: string; used_pct: number; paused_at: string | null; due_at: string; target_minutes: number };

const DAY_MIN = WORKING_HOURS_PER_DAY * 60;
const fmtDays = (d: number) => (d < 10 ? String(Math.round(d * 10) / 10) : String(Math.round(d)));

/** Green under 75 % of the time, amber up to the due time, red when overdue, grey on hold */
export function timeColour(pct: number | null | undefined, paused?: boolean) {
  if (paused) return colors.grey;
  if (pct == null) return colors.grey;
  return pct > 100 ? colors.red : pct >= 75 ? colors.amber : colors.green;
}

/** "3.5 of 8 wd", "late 2 wd" or "on hold" */
export function timeLabel(pct: number | null | undefined, targetMinutes?: number | null, paused?: boolean) {
  if (paused) return 'on hold';
  if (pct == null) return '—';
  if (!targetMinutes) return pct > 100 ? 'late' : `${Math.round(pct)}% of time`;
  const total = targetMinutes / DAY_MIN;
  if (pct > 100) return `late ${fmtDays(((pct - 100) / 100) * total)} wd`;
  return `${fmtDays((pct / 100) * total)} of ${fmtDays(total)} wd`;
}

/** Working days (Mon–Fri) since a time – public holidays are not counted out here */
export function workDaysSince(iso?: string | null) {
  if (!iso) return null;
  const start = new Date(iso);
  const end = new Date();
  let n = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (d < last) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

/** "updated today", "updated yesterday", "updated 3 d ago" */
export function updatedText(iso?: string | null) {
  const n = workDaysSince(iso);
  if (n == null) return 'no update yet';
  return n === 0 ? 'updated today' : n === 1 ? 'updated yesterday' : `updated ${n} d ago`;
}

/** No update for 2 working days or more */
export const isStale = (iso?: string | null) => (workDaysSince(iso) ?? 99) >= 2;

/** Time is clearly running ahead of the work: half the time gone and the % trails it by more than 25 points */
export const isBehind = (progress: number | null | undefined, timePct: number | null | undefined) =>
  progress != null && timePct != null && timePct >= 50 && progress + 25 < Math.min(timePct, 100);
