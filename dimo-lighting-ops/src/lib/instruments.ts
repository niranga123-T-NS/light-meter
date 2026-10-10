import { colors } from '@/components/ui';
import { fmtDate, todayISO } from './format';

export type Instrument = {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  make: string | null;
  model: string | null;
  serial_no: string | null;
  asset_no: string | null;
  range_spec: string | null;
  home: string | null;
  notes: string | null;
  condition: 'ok' | 'out_of_order';
  fault_note: string | null;
  cal_status: 'calibrated' | 'not_calibrated';
  cal_date: string | null;
  cal_expiry: string | null;
  cal_cert_no: string | null;
  cal_lab: string | null;
  removed: boolean;
  updated_at: string;
};
export type InstrumentRequest = {
  id: string;
  code: string | null;
  instrument_id: string;
  requested_by: string;
  requested_at: string;
  exec_project_id: string | null;
  project_text: string | null;
  purpose: string | null;
  need_from: string;
  need_to: string;
  site_lat: number | null;
  site_lng: number | null;
  site_address: string | null;
  uncalibrated: boolean;
  status: 'waiting' | 'ready' | 'issued' | 'returned' | 'cancelled';
  ready_at: string | null;
  owner_id: string | null;
  issued_at: string | null;
  due_back: string | null;
  returned_at: string | null;
  return_condition: string | null;
  return_note: string | null;
  ext_to: string | null;
  ext_reason: string | null;
  ext_status: 'pending' | 'approved' | 'rejected' | null;
  ext_note: string | null;
  cancel_note: string | null;
};

export const instrumentTitle = (i: Pick<Instrument, 'name' | 'make' | 'model' | 'serial_no'>) =>
  [i.name, [i.make, i.model].filter(Boolean).join(' '), i.serial_no ? `S/N ${i.serial_no}` : null].filter(Boolean).join(' · ');

const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

/** Calibration in words and colour: valid (green), expiring within 30 days (amber), expired / not calibrated (red / grey) */
export function calState(i: Instrument, today = todayISO()) {
  if (i.cal_status !== 'calibrated' || !i.cal_expiry) return { ok: false, label: 'Not calibrated', tone: colors.grey };
  const left = days(i.cal_expiry, today);
  if (left < 0) return { ok: false, label: `Calibration expired ${fmtDate(i.cal_expiry)}`, tone: colors.red, expired: true };
  if (left <= 30) return { ok: true, label: `Calibrated – expires in ${left} d`, tone: colors.amber };
  return { ok: true, label: 'Calibrated', tone: colors.green };
}

export const daysOverdue = (r: InstrumentRequest, today = todayISO()) => (r.status === 'issued' && r.due_back && r.due_back < today ? days(today, r.due_back) : 0);

export const REQ_STATUS: Record<InstrumentRequest['status'], string> = {
  waiting: 'Requested – waiting',
  ready: 'Ready to collect',
  issued: 'Issued',
  returned: 'Returned',
  cancelled: 'Cancelled',
};
export const reqTone = (r: InstrumentRequest) =>
  daysOverdue(r) > 0 ? colors.red : r.status === 'ready' ? colors.green : r.status === 'issued' ? colors.blue : r.status === 'waiting' ? colors.amber : colors.grey;
