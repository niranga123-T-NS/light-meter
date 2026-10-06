import { colors } from '@/components/ui';
import { todayISO } from './format';

// Engineering jobs (project execution) – mirrors supabase/migrations/20260930000098_engineering_jobs.sql
export type EngStatus = 'assigned' | 'in_progress' | 'on_hold' | 'done' | 'cancelled';
export type EngType = 'installation' | 'inspection' | 'testing' | 'site_visit' | 'other';

export type EngJob = {
  id: string;
  code: string;
  job_type: EngType;
  title: string;
  instructions: string | null;
  project_id: string | null;
  organization_id: string | null;
  meeting_action_id: string | null;
  site_address: string | null;
  lat: number | null;
  lng: number | null;
  assignee_id: string;
  assigned_by: string | null;
  assigned_at: string;
  due_date: string;
  original_due_date: string | null;
  status: EngStatus;
  accepted_at: string | null;
  hold_reason: string | null;
  hold_at: string | null;
  progress: number;
  last_update_at: string | null;
  last_site_visit_at: string | null;
  done_at: string | null;
  done_note: string | null;
  projects?: { name: string; code: string } | null;
  organizations?: { name: string } | null;
};

export type EngUpdate = {
  id: string;
  job_id: string;
  by_id: string | null;
  at: string;
  kind: string;
  note: string | null;
  work_stage: string | null;
  progress: number | null;
  qty_installed: number | null;
  issues: string | null;
  distance_m: number | null;
  gps_verified: boolean | null;
  new_due: string | null;
};

export const ENG_TYPES: { value: EngType; label: string; hint: string }[] = [
  { value: 'installation', label: 'Installation', hint: 'Updates: installation stage, progress %, quantity installed, issues' },
  { value: 'inspection', label: 'Site inspection', hint: 'Updates: inspection findings' },
  { value: 'testing', label: 'Testing & commissioning', hint: 'Updates: tests carried out and results' },
  { value: 'site_visit', label: 'Site visit / meeting', hint: 'Updates: activities and outcome' },
  { value: 'other', label: 'Other', hint: 'Updates: activities' },
];
export const engTypeLabel = (t: string) => ENG_TYPES.find((x) => x.value === t)?.label ?? t;

export const INSTALL_STAGES = [
  'Site survey / marking',
  'Material received at site',
  'Cabling / conduit',
  'Fixture mounting',
  'Wiring / connections',
  'Testing & commissioning',
  'Snags / rectification',
  'Handover',
];

export const ENG_STATUS: Record<EngStatus, { label: string; tone: string }> = {
  assigned: { label: 'Awaiting acceptance', tone: colors.amber },
  in_progress: { label: 'Ongoing', tone: colors.blue },
  on_hold: { label: 'On hold', tone: colors.red },
  done: { label: 'Done', tone: colors.green },
  cancelled: { label: 'Cancelled', tone: colors.grey },
};

export const UPDATE_LABEL: Record<string, string> = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  progress: 'Installation progress',
  inspection: 'Inspection',
  activity: 'Activity',
  site_visit: 'Site visit',
  hold: 'Put on hold',
  hold_rejected: 'Hold not accepted – continue',
  resumed: 'Resumed',
  deadline: 'Deadline revised',
  reassigned: 'Reassigned',
  edited: 'Details updated',
  done: 'Completed',
  cancelled: 'Cancelled',
};

export const isOpen = (j: EngJob) => j.status === 'assigned' || j.status === 'in_progress' || j.status === 'on_hold';
export const isOverdue = (j: EngJob) => isOpen(j) && j.due_date < todayISO();

export const ENG_SELECT = '*, projects(name, code), organizations(name)';

export const mapsLink = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
