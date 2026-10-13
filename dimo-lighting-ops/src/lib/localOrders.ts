import type { Role } from './types';
import { todayIso, workdays, type FoNote, type StepLine } from './foreignOrders';

/** Local orders (testing): materials and services bought in Sri Lanka – request, PR, sourcing, selection, PO / LOA, delivery or work, invoices. */

export type LoRequest = {
  id: string;
  code: string | null;
  exec_project_id: string | null;
  secured_id: string | null;
  project_id: string | null;
  project_name: string;
  client: string | null;
  sales_person_id: string | null;
  requested_by: string | null;
  mr_id: string | null;
  title: string;
  kind: 'material' | 'service' | 'both';
  details: string | null;
  quantity: string | null;
  specs: string | null;
  required_on: string | null;
  delivery_location: string;
  received_on: string;
  pr_nos: string | null;
  status: 'open' | 'returned' | 'closed' | 'cancelled';
  return_reason: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_by: string;
};
export type PaymentTerm = 'advance_balance' | 'after_delivery' | 'before_delivery' | 'lc';
export type LoOrder = {
  id: string;
  code: string | null;
  request_id: string;
  seq_no: number;
  title: string;
  kind: 'material' | 'service';
  supplier: string;
  supplier_new: boolean;
  payment_term: PaymentTerm;
  advance_pct: number | null;
  advance_security: boolean;
  lead_time: string | null;
  delivery_arrangement: string | null;
  po_no: string | null;
  status: 'open' | 'completed' | 'cancelled';
  notes: string | null;
  cancel_reason: string | null;
};
export type LoStepDef = { key: string; scope: 'r' | 'o'; stage: number; seq: number; label: string; node: string; conds: string[]; after: string[]; ref_label: string | null; sla_days: number | null; optional?: boolean };
export type LoStep = { id: string; request_id: string; order_id: string | null; step: string; done_on: string; ref: string | null; note: string | null; recorded_by: string; recorded_at: string };
export type LoDelivery = { id: string; order_id: string; delivered_on: string; dn_no: string; items: string | null; signed_by: string | null; note: string | null };
export type InvoicePoint = 'see' | 'smp' | 'dgm' | 'proc' | 'finance' | 'paid';
export type LoInvoice = {
  id: string;
  order_id: string;
  kind: 'invoice' | 'ipc' | 'advance';
  invoice_no: string;
  invoice_date: string;
  amount: number;
  dn_nos: string | null;
  sub_invoice_id: string | null;
  received_on: string;
  see_on: string | null;
  smp_on: string | null;
  dgm_on: string | null;
  proc_on: string | null;
  finance_on: string | null;
  paid_on: string | null;
  pay_ref: string | null;
  status: 'open' | 'paid' | 'cancelled';
  note: string | null;
};
export type LoNote = Omit<FoNote, 'handover_id'> & { request_id: string };

export const LO_STAGES = ['Request', 'Ops check', 'PR approval', 'Sourcing', 'Selection approval', 'Order & delivery / work', 'Invoice & payment'];
export const LO_SHORT = ['Request', 'Check', 'PR', 'Sourcing', 'Selection', 'Order', 'Payment'];
export const LO_KEEPER: Role[] = ['operations_exec'];
/** Who may raise a request (the server checks the project: the SEE only for their own project, Sales only for supply projects) */
export const LO_REQUESTERS: Role[] = ['operations_exec', 'sm_projects', 'gm', 'senior_elec_engineer', 'asm_building', 'asm_infra'];
export const DIC_LIMIT = 2000000;

export const PAYMENT_TERMS: { value: PaymentTerm; label: string }[] = [
  { value: 'advance_balance', label: '% advance, balance after delivery' },
  { value: 'after_delivery', label: '100% after delivery' },
  { value: 'before_delivery', label: '100% before delivery' },
  { value: 'lc', label: 'LC' },
];
export const termLabel = (o: Pick<LoOrder, 'payment_term' | 'advance_pct'>) =>
  o.payment_term === 'advance_balance' ? `${o.advance_pct ?? '?'}% advance, balance after delivery` : PAYMENT_TERMS.find((t) => t.value === o.payment_term)?.label ?? o.payment_term;
export const KIND_LABEL = { material: 'Material', service: 'Service', both: 'Material and service' } as const;

export const INVOICE_POINTS: Record<InvoicePoint, { label: string; who: string }> = {
  see: { label: 'Approved by the SEE', who: 'SEE' },
  smp: { label: 'Approved by SM Projects', who: 'SM Projects' },
  dgm: { label: 'Approved by the DGM', who: 'DGM' },
  proc: { label: 'Verified by Procurement', who: 'Procurement' },
  finance: { label: 'Approved by Finance', who: 'Finance' },
  paid: { label: 'Paid', who: 'Payment' },
};
/** The invoice's approval chain: execution projects SEE → SM Projects → DGM, other projects the DGM; then Procurement, Finance, paid */
export const invoiceChain = (r: Pick<LoRequest, 'exec_project_id'>): InvoicePoint[] =>
  r.exec_project_id ? ['see', 'smp', 'dgm', 'proc', 'finance', 'paid'] : ['dgm', 'proc', 'finance', 'paid'];
export const invoiceNext = (i: LoInvoice, chain: InvoicePoint[]) => chain.find((p) => !(i as unknown as Record<string, string | null>)[`${p}_on`]) ?? null;

export const fmtLkr = (n: number | null | undefined) => (n == null ? '—' : `LKR ${Math.round(Number(n)).toLocaleString('en-US')}`);

/** Does a step apply? r: the request (PR value), o: the order (and its value) */
export function loApplies(d: LoStepDef, prValue: number | null, o?: LoOrder | null, value?: number | null) {
  return d.conds.every((c) => {
    if (c === 'dic_pr') return (prValue ?? 0) > DIC_LIMIT;
    if (!o) return false;
    switch (c) {
      case 'material': return o.kind === 'material';
      case 'service': return o.kind === 'service';
      case 'supplier_new': return o.supplier_new;
      case 'dic_sel': return (value ?? 0) > DIC_LIMIT;
      case 'advance': return o.payment_term === 'advance_balance' || o.payment_term === 'before_delivery';
      case 'advance_security': return o.advance_security && (o.payment_term === 'advance_balance' || o.payment_term === 'before_delivery');
      case 'lc': return o.payment_term === 'lc';
      default: return false;
    }
  });
}

export type LoLine = StepLine & { def: LoStepDef; done: LoStep | null };

/** The steps of a request (o = null: stages 1–4) or of one of its orders (with the request's steps before it) */
export function loRoute(defs: LoStepDef[], prValue: number | null, o: LoOrder | null, value: number | null, steps: LoStep[], holidays: Set<string>, today = todayIso()): LoLine[] {
  const doneOf = (key: string, scope: 'r' | 'o') => steps.find((s) => s.step === key && (scope === 'r' ? s.order_id === null : s.order_id === o?.id)) ?? null;
  const applies = (d: LoStepDef) => (d.scope === 'r' ? loApplies(d, prValue) : o ? loApplies(d, prValue, o, value) : false);
  return defs
    .filter(applies)
    .sort((a, b) => a.seq - b.seq)
    .map((d) => {
      const done = doneOf(d.key, d.scope);
      // an optional step not done is skipped: the step follows the steps before it instead
      const after: string[] = [];
      const todo = [...d.after];
      for (let g = 0; todo.length && g < 100; g++) {
        const k = todo.shift()!;
        const a = defs.find((x) => x.key === k);
        if (!a || after.includes(k)) continue;
        if (a.optional && !doneOf(k, a.scope)) todo.push(...a.after);
        else after.push(k);
      }
      let ready = true;
      const dates: string[] = [];
      for (const k of after) {
        const a = defs.find((x) => x.key === k)!;
        if (!applies(a)) continue;
        const s = doneOf(k, a.scope);
        if (s) dates.push(s.done_on);
        else ready = false;
      }
      const start = dates.length ? dates.sort().at(-1)! : null;
      const days = done ? workdays(start, done.done_on, holidays) : ready && start ? workdays(start, today, holidays) : null;
      const late = !d.optional && d.sla_days != null && days != null && days > d.sla_days;
      return { def: d, done, ready, start, days, late };
    });
}

/** Where a request or order stands: its stage (1–7, 8 when done), the open steps and who has them */
export function loStanding(lines: LoLine[]) {
  const now = lines.filter((l) => !l.done && l.ready && !l.def.optional);
  const stage = now.length ? Math.min(...now.map((l) => l.def.stage)) : lines.every((l) => l.done || l.def.optional) ? 8 : Math.min(...lines.filter((l) => !l.done && !l.def.optional).map((l) => l.def.stage));
  return { stage, now, with: [...new Set(now.map((l) => l.def.node))].join(', '), late: now.some((l) => l.late) };
}
