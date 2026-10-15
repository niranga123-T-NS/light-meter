import { colors } from '@/components/ui';
import type { Role } from './types';

/** Foreign orders (testing): the Operations Executive records every step from the e-mails and SAP; the app times each step in working days. */

export type Handover = {
  id: string;
  code: string | null;
  project_id: string | null;
  project_name: string;
  client: string;
  sales_person_id: string | null;
  received_on: string;
  pi_ref: string | null;
  client_new: boolean;
  sap_project_no: string | null;
  delivery_location: string;
  status: 'open' | 'closed' | 'cancelled';
  notes: string | null;
  cancel_reason: string | null;
  created_at: string;
  mr_id?: string | null;
};
export type FoOrder = {
  id: string;
  code: string | null;
  handover_id: string;
  seq_no: number;
  title: string;
  kind: 'material' | 'service';
  vendor: string;
  vendor_new: boolean;
  codes_new: boolean;
  incoterm: 'EXW' | 'FOB' | 'CIF' | null;
  payment: 'TT' | 'LC';
  duty: 'paid' | 'free' | null;
  inland: boolean;
  required_on: string | null;
  pr_nos: string | null;
  po_no: string | null;
  lc_no: string | null;
  cipl_rounds: number;
  dangerous: boolean | null;
  dg_details: string | null;
  factory_location: string | null;
  mfr_address?: string | null;
  loading_port?: string | null;
  dic_required?: boolean;
  planned_mode?: 'sea' | 'air' | 'courier' | null;
  expected_ready?: string | null;
  committed_ready?: string | null;
  value_usd_note?: string | null;
  factory_lat: number | null;
  factory_lng: number | null;
  status: 'open' | 'delivered' | 'cancelled';
  notes: string | null;
  cancel_reason: string | null;
};
export type OrderValues = { order_id: string; currency: string; pi_value: number | null; lc_amount: number | null; duty_lkr: number | null };
export type Payment = { id: string; order_id: string; kind: 'advance' | 'part' | 'balance' | 'full'; amount: number; currency: string; paid_on: string; ref: string | null; note: string | null };
export type Shipment = {
  id: string;
  code: string | null;
  mode: 'sea' | 'air' | 'courier';
  carrier: string | null;
  vessel_flight: string | null;
  voyage: string | null;
  bl_awb: string | null;
  containers: string | null;
  forwarder: string | null;
  clearing_agent: string | null;
  pol: string | null;
  pod: string | null;
  via: string | null;
  onboard_at: string | null;
  etd: string | null;
  eta: string | null;
  arrived_on: string | null;
  last_checked_on: string | null;
  last_check_note: string | null;
  notes: string | null;
  imo?: string | null;
  mmsi?: string | null;
  container_nos?: string | null;
  flight_status?: string | null;
  flight_departed_at?: string | null;
  flight_arrival_at?: string | null;
  flight_landed_at?: string | null;
  flight_route?: string | null;
  flight_checked_at?: string | null;
  /** an air shipment on more than one flight (transshipment) */
  multi_leg?: boolean;
  cargo_status?: 'on_next' | 'offloaded' | 'arrived' | 'not_shown' | null;
  cargo_note?: string | null;
  cargo_checked_at?: string | null;
  ais_destination?: string | null;
  ais_eta?: string | null;
  ais_speed?: number | null;
  ais_status?: string | null;
  ais_seen_at?: string | null;
  ais_checked_at?: string | null;
};

/** AeroDataBox flight status in words */
export const FLIGHT_STATUS: Record<string, string> = {
  Expected: 'Scheduled', CheckIn: 'Check-in', Boarding: 'Boarding', GateClosed: 'Gate closed', Departed: 'Departed', EnRoute: 'In the air',
  Approaching: 'Approaching', Delayed: 'Delayed', Arrived: 'Landed', Canceled: 'Cancelled', CanceledUncertain: 'Cancelled?', Diverted: 'Diverted', Unknown: 'Unknown',
};
export type StepDef = { key: string; scope: 'h' | 'o'; stage: number; seq: number; label: string; node: string; conds: string[]; after: string[]; ref_label: string | null; sla_days: number | null; optional?: boolean };
export type Step = { id: string; handover_id: string; order_id: string | null; step: string; done_on: string; ref: string | null; note: string | null; recorded_by: string; recorded_at: string };
export type LocationChange = {
  id: string;
  handover_id: string;
  old_location: string;
  new_location: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  smp_by: string | null;
  smp_at: string | null;
  est_by: string | null;
  est_at: string | null;
  decision_note: string | null;
  requested_at: string;
};

export type FoNote = {
  id: string;
  handover_id: string;
  order_id: string | null;
  stage: number;
  steps: string[];
  kind: 'mistake' | 'delay' | 'complaint' | 'notice';
  party: string | null;
  title: string;
  details: string | null;
  occurred_on: string;
  delay_days: number | null;
  status: 'open' | 'resolved';
  resolved_by: string | null;
  resolved_at: string | null;
  resolution: string | null;
  created_by: string;
  created_at: string;
};

export const STAGES = ['Import request', 'SAP readiness', 'Project creation', 'Import order', 'PO & payment', 'Manufacture & documents', 'Shipment', 'Arrival & clearing', 'Delivery'];
export const SHORT_STAGES = ['Import request', 'SAP ready', 'Project', 'Import order', 'PO & pay', 'Made · CI/PL', 'Shipment', 'Clearing', 'Delivery'];

export const FO_KEEPER: Role[] = ['operations_exec'];
export const FO_OFFICE: Role[] = ['operations_exec', 'sm_estimation', 'sm_projects', 'gm', 'sys_admin'];

export const CURRENCIES = [
  { value: 'USD', label: 'USD – US dollar' },
  { value: 'EUR', label: 'EUR – Euro' },
  { value: 'GBP', label: 'GBP – British pound' },
  { value: 'SGD', label: 'SGD – Singapore dollar' },
  { value: 'CNY', label: 'RMB (CNY) – Chinese yuan' },
  { value: 'INR', label: 'INR – Indian rupee' },
  { value: 'AUD', label: 'AUD – Australian dollar' },
];
export const DELAY_DAYS = [...Array.from({ length: 30 }, (_, i) => i + 1), 45, 60, 90].map((n) => ({ value: String(n), label: `${n} working day${n === 1 ? '' : 's'}` }));

export const PAYMENT_KIND: Record<Payment['kind'], string> = { advance: 'Advance', part: 'Part payment', balance: 'Balance', full: 'Full payment' };

/** Does a step apply to this order (o) under this import request (h)? */
export function applies(d: StepDef, h: Handover, o?: FoOrder | null) {
  return d.conds.every((c) => {
    if (c === 'client_new') return h.client_new;
    if (!o) return false;
    switch (c) {
      case 'material': return o.kind === 'material';
      case 'service': return o.kind === 'service';
      case 'exw_fob': return o.kind === 'material' && (o.incoterm === 'EXW' || o.incoterm === 'FOB');
      case 'cif': return o.kind === 'material' && o.incoterm === 'CIF';
      case 'tt': return o.payment === 'TT';
      case 'lc': return o.payment === 'LC';
      case 'duty_paid': return o.kind === 'material' && o.duty === 'paid';
      case 'duty_free': return o.kind === 'material' && o.duty === 'free';
      case 'vendor_new': return o.vendor_new;
      case 'codes_new': return o.codes_new;
      case 'inland': return o.inland;
      case 'dic': return o.dic_required !== false;
      default: return false;
    }
  });
}

/** Working days from a to b (a not counted, b counted): Monday to Friday without public and mercantile holidays */
export function workdays(a: string | null | undefined, b: string | null | undefined, holidays: Set<string>) {
  if (!a || !b || b <= a) return a && b ? 0 : null;
  let n = 0;
  const d = new Date(`${a}T00:00:00Z`);
  const end = new Date(`${b}T00:00:00Z`);
  while (d < end) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(d.toISOString().slice(0, 10))) n += 1;
  }
  return n;
}

export const todayIso = () => {
  const d = new Date(Date.now() + 5.5 * 3600000); // Sri Lanka time
  return d.toISOString().slice(0, 10);
};

/** The date n months back (for report periods) */
export const monthsAgo = (n: number) => new Date(Date.now() - n * 30.4 * 86400000).toISOString().slice(0, 10);

/** What the step list needs of a line (foreign and local orders) */
export type StepLine = {
  def: { key: string; scope: string; stage: number; label: string; node: string; ref_label: string | null; sla_days: number | null; optional?: boolean };
  done: { id: string; done_on: string; ref: string | null; note: string | null; recorded_by: string } | null;
  ready: boolean;
  start: string | null;
  days: number | null;
  late: boolean;
};

export type Line = {
  def: StepDef;
  done: Step | null;
  /** everything it follows is done */
  ready: boolean;
  start: string | null;
  /** working days taken (done) or so far (ready, not done) */
  days: number | null;
  late: boolean;
};

/**
 * The route of one import order (with the import request's own steps), or of the import request alone (o = null: stages 1–3).
 * steps: every step of the import request (all its orders). orders: all the import request's orders (for import request steps that follow order steps).
 */
export function route(defs: StepDef[], h: Handover, o: FoOrder | null, steps: Step[], orders: FoOrder[], holidays: Set<string>, today = todayIso()): Line[] {
  const open = orders.filter((x) => x.status !== 'cancelled');
  const doneOf = (key: string, orderId: string | null) => steps.find((s) => s.step === key && s.order_id === orderId) ?? null;
  const list = defs
    .filter((d) => (d.scope === 'h' ? applies(d, h) : o ? applies(d, h, o) : false))
    .sort((a, b) => a.seq - b.seq);
  return list.map((d) => {
    const done = doneOf(d.key, d.scope === 'h' ? null : o?.id ?? null);
    let ready = true;
    const dates: string[] = [];
    // an optional step not done is skipped: the step follows the steps before it instead
    const after: string[] = [];
    const todo = [...d.after];
    for (let guard = 0; todo.length && guard < 100; guard++) {
      const k = todo.shift()!;
      const a = defs.find((x) => x.key === k);
      if (!a || after.includes(k)) continue;
      if (a.optional && !doneOf(k, a.scope === 'h' ? null : o?.id ?? null)) todo.push(...a.after);
      else after.push(k);
    }
    for (const k of after) {
      const a = defs.find((x) => x.key === k);
      if (!a) continue;
      if (a.scope === 'h') {
        if (!applies(a, h)) continue;
        const s = doneOf(k, null);
        if (s) dates.push(s.done_on);
        else ready = false;
      } else if (d.scope === 'o' && o) {
        if (!applies(a, h, o)) continue;
        const s = doneOf(k, o.id);
        if (s) dates.push(s.done_on);
        else ready = false;
      } else {
        // a import request step after order steps: every open order where it applies
        for (const x of open) {
          if (!applies(a, h, x)) continue;
          const s = doneOf(k, x.id);
          if (s) dates.push(s.done_on);
          else ready = false;
        }
      }
    }
    const start = dates.length ? dates.sort().at(-1)! : null;
    const days = done ? workdays(start, done.done_on, holidays) : ready && start ? workdays(start, today, holidays) : null;
    const late = !d.optional && d.sla_days != null && days != null && days > d.sla_days;
    return { def: d, done, ready, start, days, late };
  });
}

/** Where an order stands: its stage (1–9), the open steps now, and who has them */
export function standing(lines: Line[]) {
  const now = lines.filter((l) => !l.done && l.ready && !l.def.optional);
  // waiting for the arrival notice: the goods are still in transit (stage 7)
  const stageOf = (l: Line) => (l.def.key === 'arrived' ? 7 : l.def.stage);
  const stage = now.length ? Math.min(...now.map(stageOf)) : lines.every((l) => l.done || l.def.optional) ? 10 : Math.min(...lines.filter((l) => !l.done && !l.def.optional).map((l) => l.def.stage));
  return { stage, now, with: [...new Set(now.map((l) => (l.def.key === 'arrived' ? 'In transit' : l.def.node)))].join(', '), late: now.some((l) => l.late) };
}

/** A later flight of a multi-flight air shipment (flight 2, 3 …; flight 1 is the shipment's own) */
export type FlightLeg = { connection_min?: number | null; dep_sched_at?: string | null; id: string; shipment_id: string; seq: number; flight: string; from_ap: string | null; to_ap: string | null; etd: string | null; flight_status: string | null; departed_at: string | null; arrival_at: string | null; landed_at: string | null; note: string | null };
/** An airport in Sri Lanka – the destination */
export const isDestination = (ap?: string | null) => /\bCMB\b|colombo|katunayake|bandaranaike|sri lanka|\bHRI\b|mattala/i.test(ap ?? '');
/** A multi-flight shipment not yet on a flight to Sri Lanka: Ops checks the AWB until the last flight is known */
export const multiLegOpen = (s: Shipment, legs: FlightLeg[]) => !!s.multi_leg && !s.arrived_on && !legs.some((l) => isDestination(l.to_ap));
export const CARGO_STATUS: Record<string, string> = { on_next: 'On the next flight', offloaded: 'Offloaded / rebooked', arrived: 'Arrived', not_shown: 'Nothing new shown' };
/** The airline's cargo tracking page from the AWB prefix (the AWB no. is typed or pasted there); else a multi-airline tracker */
const AIRLINE_CARGO: Record<string, { name: string; url: string }> = {
  '157': { name: 'Qatar Airways Cargo', url: 'https://www.qrcargo.com' },
  '176': { name: 'Emirates SkyCargo', url: 'https://www.skycargo.com' },
  '235': { name: 'Turkish Cargo', url: 'https://www.turkishcargo.com' },
  '618': { name: 'Singapore Airlines Cargo', url: 'https://www.siacargo.com' },
  '160': { name: 'Cathay Cargo', url: 'https://www.cathaycargo.com' },
  '607': { name: 'Etihad Cargo', url: 'https://www.etihadcargo.com' },
  '020': { name: 'Lufthansa Cargo', url: 'https://www.lufthansa-cargo.com' },
  '057': { name: 'Air France KLM Cargo', url: 'https://www.afklcargo.com' },
  '074': { name: 'Air France KLM Cargo', url: 'https://www.afklcargo.com' },
  '217': { name: 'Thai Cargo', url: 'https://www.thaicargo.com' },
  '098': { name: 'Air India Cargo', url: 'https://www.airindia.com' },
  '603': { name: 'SriLankan Cargo', url: 'https://www.srilankancargo.com' },
  '125': { name: 'IAG Cargo', url: 'https://www.iagcargo.com' },
};
export function awbTracking(awb?: string | null) {
  const digits = (awb ?? '').replace(/\D/g, '');
  const a = AIRLINE_CARGO[digits.slice(0, 3)];
  return { airline: a?.name ?? null, url: a?.url ?? 'https://www.track-trace.com/aircargo', awb: digits.length >= 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 11)}` : awb ?? '' };
}
export const MODE_LABEL = { sea: 'Sea freight', air: 'Air freight', courier: 'Courier' } as const;
export const termsLabel = (o: FoOrder) =>
  o.kind === 'service' ? `Service · ${o.payment}` : `${o.incoterm} · ${o.payment}${o.duty ? ` · duty ${o.duty}` : ''}${o.planned_mode ? ` · ${MODE_LABEL[o.planned_mode]}` : ''}`;

export const STATUS_TONE: Record<FoOrder['status'], string> = { open: colors.blue, delivered: colors.green, cancelled: colors.grey };

/** Latest shipment of an order (by ETA) */
export function latestShipment(orderId: string, links: { shipment_id: string; order_id: string }[], ships: Shipment[]) {
  const ids = links.filter((l) => l.order_id === orderId).map((l) => l.shipment_id);
  return ships.filter((s) => ids.includes(s.id)).sort((a, b) => (b.eta ?? '').localeCompare(a.eta ?? ''))[0] ?? null;
}

export const yesNo = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
];

/** A change of an order's expected date (foreign and local orders) */
export type DateChange = { id: string; module: 'fo' | 'lo'; order_id: string; kind: 'ready' | 'eta' | 'delivery'; old_date: string | null; new_date: string; reason: string; party: string | null; note: string | null; changed_by: string | null; changed_at: string };
export const DATE_REASONS = [
  { value: 'supplier', label: 'Manufacturer / supplier delay' },
  { value: 'material', label: 'Raw material' },
  { value: 'payment', label: 'Payment delay' },
  { value: 'documents', label: 'Documents' },
  { value: 'carrier', label: 'Shipping line / airline' },
  { value: 'customs', label: 'Customs' },
  { value: 'other', label: 'Other' },
];
export const reasonLabel = (r: string) => (r === 'first' ? 'First date' : DATE_REASONS.find((x) => x.value === r)?.label ?? r);

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** Expected at site (as the server works it out): the shipment ETA, else the ready date plus transit by the planned freight; plus 7 days clearing and delivery */
export function expectedSite(o: Pick<FoOrder, 'expected_ready' | 'planned_mode'>, eta: string | null) {
  if (eta) return addDays(eta, 7);
  if (!o.expected_ready) return null;
  return addDays(o.expected_ready, (o.planned_mode === 'air' ? 4 : o.planned_mode === 'courier' ? 5 : 25) + 7);
}
