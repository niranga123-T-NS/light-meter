import { addDaysISO, todayISO } from './format';
import type { Role } from './types';

export type Team = 'sales' | 'estimation' | 'design' | 'execution' | 'project';

export const TEAMS: Record<
  Team,
  { label: string; short: string; host: string; hostRole: Role; members: Role[]; dow: number; starts: string; ends: string; fixed: boolean }
> = {
  sales: {
    label: 'Sales meeting',
    short: 'Sales',
    host: 'SM Projects',
    hostRole: 'sm_projects',
    members: ['asm_building', 'asm_infra'],
    dow: 1,
    starts: '08:30',
    ends: '12:00',
    fixed: true,
  },
  estimation: {
    label: 'Estimation team meeting',
    short: 'Estimation',
    host: 'SM Estimation',
    hostRole: 'sm_estimation',
    members: ['am_estimation', 'estimation_exec'],
    dow: 2,
    starts: '08:30',
    ends: '10:00',
    fixed: false,
  },
  design: {
    label: 'Design team meeting',
    short: 'Design',
    host: 'Design Manager',
    hostRole: 'design_manager',
    members: ['lighting_designer', 'lighting_engineer'],
    dow: 3,
    starts: '08:30',
    ends: '10:00',
    fixed: false,
  },
  execution: {
    label: 'Execution team meeting',
    short: 'Execution',
    host: 'Senior Electrical Engineer',
    hostRole: 'senior_elec_engineer',
    members: ['assistant_engineer', 'trainee', 'sub_supervisor'],
    dow: 4,
    starts: '08:30',
    ends: '10:00',
    fixed: false,
  },
  // Called by the SEE from a project's Meetings tab (not a weekly team meeting)
  project: {
    label: 'Project meeting',
    short: 'Project',
    host: 'Senior Electrical Engineer',
    hostRole: 'senior_elec_engineer',
    members: ['assistant_engineer', 'trainee', 'sub_supervisor'],
    dow: 0,
    starts: '10:00',
    ends: '11:00',
    fixed: false,
  },
};

export const TEAM_LIST: Team[] = ['sales', 'estimation', 'design', 'execution'];

export const isTeam = (t: unknown): t is Team => t === 'sales' || t === 'estimation' || t === 'design' || t === 'execution' || t === 'project';

/** Teams whose meetings a role can open: the host runs theirs; GM / DGM read all published; SM Projects reads Estimation and Design. */
export function teamsFor(role: Role): { team: Team; host: boolean }[] {
  return TEAM_LIST.filter((t) => TEAMS[t].hostRole === role || role === 'gm' || (role === 'sm_projects' && t !== 'sales')).map((t) => ({
    team: t,
    host: TEAMS[t].hostRole === role,
  }));
}

const dowOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`).getDay();
  return d === 0 ? 7 : d;
};

/** The team's usual day this week if it is still to come, else next week. */
export function nextMeetingDate(team: Team): string {
  const t = todayISO();
  const monday = addDaysISO(t, 1 - dowOf(t));
  const d = addDaysISO(monday, TEAMS[team].dow - 1);
  return d >= t ? d : addDaysISO(d, 7);
}

export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** The host's own team – invited at once; anyone else (Estimation / Design meetings) waits for SM Projects. */
export function ownTeam(team: Team): Role[] {
  if (team === 'sales') return [];
  return [TEAMS[team].hostRole, ...TEAMS[team].members, ...(team === 'estimation' ? (['am_estimation'] as Role[]) : [])];
}
