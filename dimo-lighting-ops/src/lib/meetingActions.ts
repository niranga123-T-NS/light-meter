import type { Role } from './types';

export type ActionKind = 'task' | 'visit' | 'design' | 'estimation' | 'execution';

export const ACTION_KINDS: { value: ActionKind; label: string; hint: string }[] = [
  { value: 'task', label: 'Task', hint: 'The person confirms it is done in My Day / Meetings.' },
  { value: 'visit', label: 'Customer / project visit', hint: "Goes into the sales person's weekly plan by itself – they only set the day and time." },
  { value: 'design', label: 'Design task', hint: 'Goes to the Design Manager, who appoints the designer.' },
  { value: 'estimation', label: 'Estimation task', hint: 'Goes to SM / AM Estimation, who appoints the estimator.' },
  { value: 'execution', label: 'Project execution task', hint: 'Goes to the Senior Electrical Engineer, who appoints the engineer.' },
];

export const kindLabel = (k: string | null | undefined) => ACTION_KINDS.find((x) => x.value === k)?.label ?? 'Task';

/** Who an action of each type can be given to (team tasks go to the manager, who appoints the person). */
export function ownerRoles(k: ActionKind): Role[] | null {
  switch (k) {
    case 'visit':
      return ['asm_building', 'asm_infra'];
    case 'design':
      return ['design_manager'];
    case 'estimation':
      return ['sm_estimation', 'am_estimation'];
    case 'execution':
      return ['senior_elec_engineer'];
    default:
      return null;
  }
}

export const isTeamKind = (k: string) => k === 'design' || k === 'estimation' || k === 'execution';

/** Status update of an open meeting action, posted before the next meeting starts. */
export type ReviewState = 'on_track' | 'delayed' | 'blocked';
export const REVIEW_STATES: { value: ReviewState; label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'blocked', label: 'Blocked – needs help' },
];
export const reviewLabel = (s: string | null | undefined) => REVIEW_STATES.find((x) => x.value === s)?.label ?? 'No update';

/** Why an action will not be done (closes it; SM Projects / the meeting host accept it or reopen it with a new date). */
export type NotDoneReason = 'declined' | 'on_hold' | 'not_needed' | 'out_of_scope' | 'waiting' | 'other';
export const NOT_DONE_REASONS: { value: NotDoneReason; label: string; short: string }[] = [
  { value: 'declined', label: 'Customer declined / not interested', short: 'customer declined' },
  { value: 'on_hold', label: 'Project cancelled or on hold', short: 'project on hold' },
  { value: 'not_needed', label: 'No longer needed / overtaken by another action', short: 'no longer needed' },
  { value: 'out_of_scope', label: 'Outside our scope', short: 'outside our scope' },
  { value: 'waiting', label: "Can't proceed – waiting on others", short: 'waiting on others' },
  { value: 'other', label: 'Other', short: 'other' },
];
export const notDoneLabel = (r: string | null | undefined) => NOT_DONE_REASONS.find((x) => x.value === r)?.label ?? 'Other';
export const notDoneShort = (r: string | null | undefined) => NOT_DONE_REASONS.find((x) => x.value === r)?.short ?? 'other';

/** Who sees Reports › Meeting actions (the DGM and SM Projects all teams; a host their own team's meetings) */
export const MEETING_ACTION_REPORT_ROLES: string[] = ['gm', 'sm_projects', 'sm_estimation', 'design_manager', 'senior_elec_engineer'];
