import { colors } from '@/components/ui';

/** Project defects: faults in the work DIMO installed (product faults go to product warranty claims). */
export type DefectStatus = 'reported' | 'open' | 'assigned' | 'rectified' | 'closed' | 'rejected' | 'warranty';
export type Defect = {
  id: string;
  code: string;
  exec_project_id: string | null;
  project_id: string | null;
  project_name: string;
  customer: string | null;
  site: string | null;
  location: string | null;
  title: string;
  description: string;
  category: string;
  severity: 'critical' | 'major' | 'minor';
  source: 'sales' | 'client' | 'site' | 'dlp_inspection';
  client_ref: string | null;
  phase: 'works' | 'dlp' | 'after_dlp' | 'outside';
  status: DefectStatus;
  reported_by: string;
  reported_at: string;
  verified_by: string | null;
  verified_at: string | null;
  reject_reason: string | null;
  assignee_id: string | null;
  responsible: 'dimo' | 'subcontractor' | 'client' | 'manufacturer' | null;
  responsible_company: string | null;
  due_date: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  inspection: string | null;
  cause: 'installation' | 'product' | 'damage' | 'other' | null;
  inspected_by: string | null;
  inspected_at: string | null;
  warranty_claim_id: string | null;
  rectification: string | null;
  rectified_by: string | null;
  rectified_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
  reopen_count: number;
  last_reopen_reason: string | null;
};
export type DefectProject = { exec_project_id: string | null; project_id: string | null; name: string; customer: string | null; site: string | null; phase: Defect['phase'] };

export const DEFECT_STATUS: Record<DefectStatus, { label: string; tone: string }> = {
  reported: { label: 'Reported – to verify', tone: colors.amber },
  open: { label: 'Open – to assign', tone: colors.amber },
  assigned: { label: 'Being rectified', tone: colors.blue },
  rectified: { label: 'Rectified – to check', tone: colors.blue },
  closed: { label: 'Closed', tone: colors.green },
  rejected: { label: 'Not accepted', tone: colors.grey },
  warranty: { label: 'Moved to product warranty', tone: colors.blue },
};
export const SEVERITY = [
  { value: 'critical', label: 'Critical – safety, or an area without light (2 days)' },
  { value: 'major', label: 'Major – part not working (7 days)' },
  { value: 'minor', label: 'Minor – cosmetic, small fault (14 days)' },
];
export const severityTone = (s: string) => (s === 'critical' ? colors.red : s === 'major' ? colors.amber : colors.grey);
export const DEFECT_CATEGORY = [
  { value: 'lighting', label: 'Lighting / luminaire' },
  { value: 'electrical', label: 'Electrical (cables, DB, earthing)' },
  { value: 'controls', label: 'Controls / DMX / BMS' },
  { value: 'mechanical', label: 'Mechanical (brackets, poles, masts)' },
  { value: 'civil', label: 'Civil (foundations, trenches, chambers)' },
  { value: 'other', label: 'Other' },
];
export const DEFECT_SOURCE = [
  { value: 'site', label: 'Found on site' },
  { value: 'client', label: 'Client / consultant complaint' },
  { value: 'dlp_inspection', label: 'DLP inspection' },
];
export const RESPONSIBLE = [
  { value: 'dimo', label: 'DIMO (our workmanship)' },
  { value: 'subcontractor', label: 'Subcontractor – back-charge' },
  { value: 'client', label: 'Client / others – chargeable' },
  { value: 'manufacturer', label: 'Manufacturer – raise a product warranty claim' },
];
export const CAUSE = [
  { value: 'installation', label: 'Installation / workmanship' },
  { value: 'product', label: 'The product supplied (manufacturing fault)' },
  { value: 'damage', label: 'Damage by others / misuse' },
  { value: 'other', label: 'Other' },
];
export const PHASE: Record<Defect['phase'], string> = { works: 'During the works', dlp: 'In the DLP', after_dlp: 'After the DLP', outside: 'Project not in execution' };
export const labelOf = (list: { value: string; label: string }[], v: string | null) => list.find((x) => x.value === v)?.label ?? v ?? '—';
/** Report: sales. Log: SM Projects, the SEE and the project's AEs. Manage (verify, assign, close): SM Projects and the SEE. */
export const DEFECT_LOGGERS = ['sm_projects', 'senior_elec_engineer', 'assistant_engineer'];
export const DEFECT_MANAGERS = ['sm_projects', 'senior_elec_engineer'];
export const DEFECT_OPEN: DefectStatus[] = ['reported', 'open', 'assigned', 'rectified'];
