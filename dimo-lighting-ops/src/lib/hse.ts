import { colors } from '@/components/ui';
import { supabase } from './supabase';

// DIMO OHS forms: equipment checklists, first-aid kit, permits to work, toolbox talks, induction and training.

export type HseItem = { no: string; text: string; critical?: boolean; req?: string; purpose?: string };
export type HseForm = {
  code: string;
  doc_no: string;
  issue: string;
  issue_date: string | null;
  kind: 'checklist' | 'kit' | 'permit' | 'tbt' | 'induction' | 'training';
  title: string;
  id_label: string | null;
  frequency_days: number | null;
  items: HseItem[];
  extra: {
    header?: { key: string; label: string }[];
    explain_if_yes?: string[];
    question_items?: string[];
    readings?: { key: string; label: string; item: string }[];
    groups?: { no: string; title: string; items: string[] }[];
    equipment_forms?: string[];
    trip_test?: boolean;
  };
  sort: number;
};
export type HseEquipment = {
  id: string;
  exec_project_id: string;
  form_code: string;
  name: string;
  serial_no: string | null;
  contractor: string | null;
  first_deployed: string | null;
  frequency_days: number;
  status: 'in_use' | 'removed' | 'off_site';
  last_checked_at: string | null;
  next_due: string | null;
};
export type Answer = { a?: 'yes' | 'no' | 'na'; r?: string; avail?: number | string; mfg?: string; exp?: string };
export type Participant = { name: string; position?: string; company?: string; contact?: string; nic?: string };
export type HseRecord = {
  id: string;
  code: string;
  exec_project_id: string;
  form_code: string;
  equipment_id: string | null;
  header: Record<string, string | Record<string, string> | number | undefined> & { readings?: Record<string, string> };
  answers: Record<string, Answer>;
  participants: Participant[];
  accepted: boolean | null;
  status: 'submitted' | 'active' | 'closed' | 'rejected';
  starts_at: string | null;
  ends_at: string | null;
  related_id: string | null;
  hse_report_id: string | null;
  corrective_date: string | null;
  corrective_note: string | null;
  created_by: string;
  created_at: string;
  sup_by: string | null;
  sup_at: string | null;
  ehs_by: string | null;
  ehs_at: string | null;
  ehs_note: string | null;
  mgr_by: string | null;
  mgr_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
};
export type Induction = { id: string; exec_project_id: string; inducted_on: string; name: string; nic: string; company: string | null; remarks: string | null; instructor_id: string | null };
export type HseSummary = { permits_waiting: number; permits_active: number; checks_due: number; removed: number; inducted: number; man_hours: number; can_ehs: boolean; can_permit?: boolean };

export const EQUIP_STATUS: Record<HseEquipment['status'], { label: string; tone: string }> = {
  in_use: { label: 'In use', tone: colors.green },
  removed: { label: 'Not accepted – out of use', tone: colors.red },
  off_site: { label: 'Off site', tone: colors.grey },
};
export const PERMIT_STATUS: Record<HseRecord['status'], { label: string; tone: string }> = {
  submitted: { label: 'Waiting for EHS approval', tone: colors.amber },
  active: { label: 'Active', tone: colors.green },
  closed: { label: 'Closed', tone: colors.grey },
  rejected: { label: 'Not approved', tone: colors.red },
};
export const ANSWERS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'na', label: 'N/A' },
] as const;

export const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (m, a: string, b: string) => a + b.toUpperCase()).replace(/\bJcb\b/, 'JCB').replace(/\bElcb\b/, 'ELCB').replace(/\bRccb\b/, 'RCCB');
export const formName = (f?: Pick<HseForm, 'title'> | null) => (f ? titleCase(f.title) : '');

let formsCache: HseForm[] | null = null;
export async function loadHseForms() {
  if (formsCache) return formsCache;
  const { data } = await supabase.from('hse_forms').select('*').order('sort');
  formsCache = (data ?? []) as HseForm[];
  return formsCache;
}

/** Leading number of a required quantity: "20 nos" → 20 */
export const qtyNum = (t?: string) => Number((t ?? '').match(/^\s*(\d+(\.\d+)?)/)?.[1] ?? 0);

/** YYYY-MM-DD + HH:MM in Sri Lanka → ISO */
export const slTime = (date: string, hhmm: string) => new Date(`${date}T${/^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm.padStart(5, '0') : '08:00'}:00+05:30`).toISOString();
