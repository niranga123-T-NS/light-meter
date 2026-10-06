// Invoicing plan ↔ execution: invoice triggers, monthly checks and progress claims (IPCs)

export type TriggerKind = 'gate' | 'activity' | 'ipc' | 'manual';

export type InvoiceTrigger = {
  line_id: string;
  exec_project_id: string;
  kind: TriggerKind;
  gate: number | null;
  activity_id: string | null;
  approved: boolean;
  set_by: string | null;
  set_at: string;
  ready_at: string | null;
  ready_note: string | null;
};

export type InvoiceCheck = {
  id: string;
  line_id: string;
  check_month: string;
  status: 'on_track' | 'ready' | 'slipping';
  to_month: string | null;
  note: string | null;
  by_id: string | null;
  at: string;
};

export type Ipc = {
  id: string;
  code: string | null;
  exec_project_id: string;
  line_id: string | null;
  period: string;
  measured_pct: number;
  measurement: string | null;
  prepared_by: string;
  prepared_at: string;
  status: 'prepared' | 'certified' | 'returned';
  certified_value: number | null;
  certified_at: string | null;
  note: string | null;
};

export const TRIGGER_KINDS: { value: TriggerKind; label: string }[] = [
  { value: 'gate', label: 'Stage gate passed' },
  { value: 'activity', label: 'Programme activity / milestone finished' },
  { value: 'ipc', label: 'Monthly progress claim (IPC)' },
  { value: 'manual', label: 'Manual – SEE confirms' },
];

export const CHECK_STATUS: { value: InvoiceCheck['status']; label: string }[] = [
  { value: 'on_track', label: 'On track' },
  { value: 'ready', label: 'Ready to invoice now' },
  { value: 'slipping', label: 'Slipping – propose a later month' },
];

export const IPC_STATUS: Record<Ipc['status'], string> = { prepared: 'With the SEE', certified: 'Certified', returned: 'Returned to correct' };

/** Roles that see the money */
export const BILLING_ROLES = ['senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec'];
