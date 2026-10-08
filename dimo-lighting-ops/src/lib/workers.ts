// Site workers register: one record per person per project, with ID photos, verification and induction.
export type Worker = {
  id: string;
  exec_project_id: string;
  company: string;
  supervisor_id: string | null;
  full_name: string;
  address: string;
  police_station: string;
  id_type: 'nic' | 'passport';
  id_no: string;
  mobile: string | null;
  trade: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  status: 'active' | 'off_site';
  off_site_on: string | null;
  off_site_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  induction_id: string | null;
  added_by: string;
  added_at: string;
};

export const TRADES = ['Electrician', 'Wireman', 'Cable jointer', 'Rigger', 'Crane operator', 'Machine operator', 'Welder', 'Mason', 'Carpenter', 'Helper / labourer', 'Driver', 'Foreman', 'Other'].map(
  (t) => ({ value: t, label: t }),
);

export const workerState = (w: Worker) =>
  w.status === 'off_site' ? 'Off site' : w.induction_id ? 'Inducted' : w.verified_at ? 'Verified – to induct' : 'To verify';

export const idLabel = (w: Pick<Worker, 'id_type'>) => (w.id_type === 'passport' ? 'Passport' : 'NIC');
