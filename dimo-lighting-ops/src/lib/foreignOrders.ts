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
};
export type StepDef = { key: string; scope: 'h' | 'o'; stage: number; seq: number; label: string; node: string; conds: string[]; after: string[]; ref_label: string | null; sla_days: number | null };
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

export const STAGES = ['Hand-over', 'SAP readiness', 'Project creation', 'Import order', 'PO & payment', 'Manufacture & documents', 'Shipment', 'Arrival & clearing', 'Delivery'];
export const SHORT_STAGES = ['Hand-over', 'SAP ready', 'Project', 'Import order', 'PO & pay', 'Made · CI/PL', 'Shipment', 'Clearing', 'Delivery'];

export const FO_KEEPER: Role[] = ['operations_exec'];
export const FO_OFFICE: Role[] = ['operations_exec', 'sm_estimation', 'sm_projects', 'gm', 'sys_admin'];

export const PAYMENT_KIND: Record<Payment['kind'], string> = { advance: 'Advance', part: 'Part payment', balance: 'Balance', full: 'Full payment' };

/** Does a step apply to this order (o) under this hand-over (h)? */
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
 * The route of one import order (with the hand-over's own steps), or of the hand-over alone (o = null: stages 1–3).
 * steps: every step of the hand-over (all its orders). orders: all the hand-over's orders (for hand-over steps that follow order steps).
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
    for (const k of d.after) {
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
        // a hand-over step after order steps: every open order where it applies
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
    const late = d.sla_days != null && days != null && days > d.sla_days;
    return { def: d, done, ready, start, days, late };
  });
}

/** Where an order stands: its stage (1–9), the open steps now, and who has them */
export function standing(lines: Line[]) {
  const now = lines.filter((l) => !l.done && l.ready);
  // waiting for the arrival notice: the goods are still in transit (stage 7)
  const stageOf = (l: Line) => (l.def.key === 'arrived' ? 7 : l.def.stage);
  const stage = now.length ? Math.min(...now.map(stageOf)) : lines.every((l) => l.done) ? 10 : Math.min(...lines.filter((l) => !l.done).map((l) => l.def.stage));
  return { stage, now, with: [...new Set(now.map((l) => (l.def.key === 'arrived' ? 'In transit' : l.def.node)))].join(', '), late: now.some((l) => l.late) };
}

export const termsLabel = (o: FoOrder) =>
  o.kind === 'service' ? `Service · ${o.payment}` : `${o.incoterm} · ${o.payment}${o.duty ? ` · duty ${o.duty}` : ''}`;

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
