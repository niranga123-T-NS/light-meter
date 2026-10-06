// Execution module – mirrors supabase/migrations/20260930000100_exec_team_access.sql and later execution migrations
import type { Role } from './types';

export type ExecFamily = 'Building & architectural' | 'Electrical' | 'Controls & measurement' | 'Infrastructure' | 'Airport systems';

export const EXEC_AREAS: { value: string; label: string; family: ExecFamily }[] = [
  { value: 'indoor', label: 'Indoor lighting', family: 'Building & architectural' },
  { value: 'outdoor', label: 'Outdoor lighting', family: 'Building & architectural' },
  { value: 'facade', label: 'Facade lighting', family: 'Building & architectural' },
  { value: 'emergency', label: 'Emergency lighting', family: 'Building & architectural' },
  { value: 'central_battery', label: 'Central battery systems', family: 'Building & architectural' },
  { value: 'electrical', label: 'Electrical installations', family: 'Electrical' },
  { value: 'underground_cabling', label: 'Underground cabling works', family: 'Electrical' },
  { value: 'lighting_control', label: 'Lighting control systems', family: 'Controls & measurement' },
  { value: 'lighting_measurement', label: 'Lighting measurement activities', family: 'Controls & measurement' },
  { value: 'road', label: 'Road lighting', family: 'Infrastructure' },
  { value: 'tunnel', label: 'Tunnel lighting', family: 'Infrastructure' },
  { value: 'sports', label: 'Sports lighting', family: 'Infrastructure' },
  { value: 'port', label: 'Port lighting', family: 'Infrastructure' },
  { value: 'agl', label: 'Aeronautical ground lighting (AGL)', family: 'Airport systems' },
  { value: 'apron', label: 'Apron floodlighting', family: 'Airport systems' },
  { value: 'vdgs', label: 'Visual docking guidance (VDGS)', family: 'Airport systems' },
  { value: 'alcms', label: 'ALCMS (tower solutions)', family: 'Airport systems' },
  { value: 'smgcs', label: 'SMGCS', family: 'Airport systems' },
];
export const areaLabel = (v: string) => EXEC_AREAS.find((a) => a.value === v)?.label ?? v;

export const EXEC_STAGES = ['Sales handover', 'Mobilise & plan', 'Install', 'Test & commission', 'Handover', 'DLP & closure'];

export type ExecProject = {
  id: string;
  project_id: string;
  code: string | null;
  name: string;
  areas: string[];
  stage: number;
  status: 'active' | 'closed';
  see_id: string | null;
  site_address: string | null;
  lat: number | null;
  lng: number | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export type ExecMember = {
  id: string;
  exec_project_id: string;
  user_id: string;
  member_role: 'assistant_engineer' | 'trainee' | 'sub_supervisor';
  zones: string | null;
  valid_from: string;
  valid_to: string | null;
  active: boolean;
  added_at: string;
  removed_at: string | null;
  remove_reason: string | null;
};

export type AccessRequest = {
  id: string;
  code: string;
  kind: 'temp_add' | 'temp_delete' | 'sub_appoint';
  status: 'pending_smp' | 'pending_gm' | 'approved' | 'done' | 'rejected' | 'cancelled';
  role_type: 'assistant_engineer' | 'trainee' | 'sub_supervisor';
  person_name: string;
  email: string | null;
  phone: string | null;
  id_no: string | null;
  company: string | null;
  user_id: string | null;
  project_ids: string[];
  zones: string | null;
  start_date: string | null;
  end_date: string | null;
  reason: string | null;
  requested_by: string;
  requested_at: string;
  smp_by: string | null;
  smp_at: string | null;
  smp_note: string | null;
  gm_by: string | null;
  gm_at: string | null;
  gm_note: string | null;
  created_user_id: string | null;
  provisioned_at: string | null;
};

export const REQUEST_KIND: Record<AccessRequest['kind'], string> = {
  temp_add: 'Temporary staff',
  temp_delete: 'Delete temporary role',
  sub_appoint: 'Subcontractor supervisor',
};
export const REQUEST_STATUS: Record<AccessRequest['status'], string> = {
  pending_smp: 'Waiting for SM Projects',
  pending_gm: 'Waiting for DGM / GM',
  approved: 'Approved – create the login',
  done: 'Done',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
export const roleTypeLabel = (r: string, temporary = true) =>
  r === 'trainee' ? 'Trainee' : r === 'sub_supervisor' ? 'Subcontractor supervisor' : temporary ? 'Temporary Assistant Engineer' : 'Assistant Engineer';

export const isExecLead = (r?: Role | null) => r === 'senior_elec_engineer' || r === 'sm_projects' || r === 'gm';
export const isExecField = (r?: Role | null) => r === 'assistant_engineer' || r === 'trainee' || r === 'sub_supervisor';

/** Mobile number as entered → the login stored for supervisors (same rule as app.norm_phone) */
export function normPhone(p: string) {
  const d = p.replace(/[^0-9]/g, '');
  return /^0[0-9]{9}$/.test(d) ? `94${d.slice(1)}` : d;
}
export const phoneLoginEmail = (p: string) => `${normPhone(p)}@users.dimo-lighting-ops.app`;
