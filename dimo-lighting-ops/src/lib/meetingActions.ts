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
