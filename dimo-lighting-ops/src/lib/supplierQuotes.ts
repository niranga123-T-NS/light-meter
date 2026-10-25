import readXlsxFile from 'read-excel-file/universal';
import { parseBoqSheets } from './boqParse';
import { readBytes, type PickedFile } from './files';
import { pdfText } from './pdfText';
import { supabase } from './supabase';

// Supplier & subcontractor quotes: types, the comparison on one basis (LKR, freight, exclusions, payment stages) and reading a quote
// file on the device. The file itself is never uploaded or stored – only the values the user checks and saves.

export type SqKind = 'supply' | 'subcontract' | 'both' | 'manufacturer';
export type Supplier = { id: string; name: string; kind: SqKind; trades: string | null; contact_name: string | null; phone: string | null; email: string | null; notes: string | null; active: boolean; origin?: 'local' | 'foreign'; country?: string | null; address?: string | null };
export type SqItem = { id: string; code: string; name: string; unit: string | null; sap_code: string | null };
export type SqAlias = { id: string; item_id: string; alias: string; supplier_id: string | null };
export type PackageStatus = 'open' | 'selected' | 'closed' | 'cancelled';
export type BidStage = 'pre_bid' | 'post_bid';
export const STAGE_LABEL: Record<BidStage, string> = { pre_bid: 'Pre Bid', post_bid: 'Post Bid' };
export const KIND_LABEL: Record<SqKind, string> = { supply: 'Supplier', subcontract: 'Subcontractor', both: 'Supplier & subcontractor', manufacturer: 'Manufacturer' };
export const KIND_OPTIONS = [{ value: 'supply', label: 'Materials (supplier)' }, { value: 'manufacturer', label: 'Manufacturer (quotes direct)' }, { value: 'subcontract', label: 'Work (subcontractor)' }, { value: 'both', label: 'Both materials and work' }];
export type SqPackage = {
  id: string; code: string; title: string; project_name: string | null; job_ref: string | null; kind: 'supply' | 'subcontract';
  our_validity: string | null; needed_weeks: number | null; status: PackageStatus; selected_quote_id: string | null; selection_reason: string | null;
  selected_by: string | null; selected_at: string | null; notes: string | null; created_at: string; updated_at: string; source_kind?: 'project' | 'inquiry' | 'exec' | null; source_id?: string | null;
  stage: BidStage; post_bid_at: string | null; post_bid_by: string | null; post_bid_note: string | null; pre_bid_quote_id: string | null; pre_bid_reason: string | null;
};
export type PayEvent = 'order' | 'delivery' | 'after_delivery' | 'commissioning' | 'handover' | 'shipment';
export type SqLine = { id?: string; text: string; item_id: string | null; qty: number | null; unit: string | null; rate: number | null; included: boolean; note?: string | null; check?: boolean };
export type SqPay = { name: string; pct: number; event: PayEvent; days: number };
export type SqExcl = { text: string; add_lkr: number };
export type Ccy = 'LKR' | 'USD' | 'EUR' | 'GBP';
export type Basis = 'site' | 'exworks' | 'cif' | 'fob' | 'other';
export type SqQuote = {
  id: string; package_id: string; supplier_id: string; quote_no: string | null; quote_date: string | null; currency: Ccy; fx_rate: number;
  valid_until: string | null; lead_weeks: number | null; delivery_basis: Basis; freight_pct: number; warranty: string | null; paid_by: string | null;
  retention_pct: number; adv_guarantee: boolean; meets_spec: 'yes' | 'partly' | 'no' | 'unknown'; spec_note: string | null;
  source: 'manual' | 'excel' | 'pdf'; notes: string | null; created_at: string; updated_at: string;
  revision: number; first_id: string | null; superseded_by: string | null; discount_pct: number; discount_amt: number; revision_note: string | null; bid_stage: BidStage;
  lines: SqLine[]; payments: SqPay[]; exclusions: SqExcl[];
};

export const CCYS: Ccy[] = ['LKR', 'USD', 'EUR', 'GBP'];
export const BASIS_LABEL: Record<Basis, string> = { site: 'Delivered to site', exworks: 'Ex-works', cif: 'CIF Colombo', fob: 'FOB', other: 'Other' };
export const EVENT_LABEL: Record<PayEvent, string> = {
  order: 'With the order', shipment: 'At shipment', delivery: 'On delivery', after_delivery: 'After delivery', commissioning: 'After commissioning', handover: 'After handover',
};
export const SPEC_LABEL = { yes: 'Meets the specification', partly: 'Partly', no: 'Does not meet', unknown: 'Not checked' } as const;
export const PAID_BY = ['Bank transfer', 'Cheque', 'LC at sight', 'LC 90 days', 'TT before shipment'];
export const PAY_TEMPLATES: { label: string; stages: SqPay[]; paid_by?: string }[] = [
  { label: 'Advance + credit', stages: [{ name: 'Advance', pct: 10, event: 'order', days: 0 }, { name: 'Balance', pct: 90, event: 'after_delivery', days: 30 }] },
  { label: '100 % credit', stages: [{ name: 'Credit', pct: 100, event: 'after_delivery', days: 30 }] },
  { label: 'Advance + on delivery', stages: [{ name: 'Advance', pct: 30, event: 'order', days: 0 }, { name: 'On delivery', pct: 70, event: 'delivery', days: 0 }] },
  { label: 'Stage payments (subcontract)', stages: [{ name: 'Mobilisation', pct: 20, event: 'order', days: 0 }, { name: 'Progress', pct: 60, event: 'delivery', days: 30 }, { name: 'Completion', pct: 10, event: 'commissioning', days: 30 }, { name: 'Retention release', pct: 10, event: 'handover', days: 365 }] },
  { label: 'Letter of credit', stages: [{ name: 'LC', pct: 100, event: 'shipment', days: 0 }], paid_by: 'LC at sight' },
];

export const lkrM = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${(v / 1e6).toFixed(2)} M`);
export const lkr0 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'));
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------- loading
export async function loadPackage(id: string) {
  const [{ data: p, error: e1 }, { data: qs, error: e2 }] = await Promise.all([
    supabase.from('sq_packages').select('*').eq('id', id).maybeSingle(),
    supabase.from('sq_quotes').select('*, lines:sq_quote_lines(*), payments:sq_quote_payments(*), exclusions:sq_quote_exclusions(*)').eq('package_id', id).order('created_at'),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  if (!p) throw new Error('Package not found');
  const quotes = ((qs ?? []) as SqQuote[]).map((q) => ({
    ...q,
    fx_rate: Number(q.fx_rate), freight_pct: Number(q.freight_pct), retention_pct: Number(q.retention_pct), lead_weeks: q.lead_weeks == null ? null : Number(q.lead_weeks),
    discount_pct: Number(q.discount_pct ?? 0), discount_amt: Number(q.discount_amt ?? 0), revision: Number(q.revision ?? 0),
    lines: [...q.lines].sort((a, b) => ((a as { seq?: number }).seq ?? 0) - ((b as { seq?: number }).seq ?? 0)).map((l) => ({ ...l, qty: l.qty == null ? null : Number(l.qty), rate: l.rate == null ? null : Number(l.rate) })),
    payments: [...q.payments].sort((a, b) => ((a as { seq?: number }).seq ?? 0) - ((b as { seq?: number }).seq ?? 0)).map((x) => ({ ...x, pct: Number(x.pct) })),
    exclusions: q.exclusions.map((x) => ({ ...x, add_lkr: Number(x.add_lkr) })),
  }));
  return { pkg: p as SqPackage, quotes };
}
export async function loadRefs() {
  const [s, i, a, st] = await Promise.all([
    supabase.from('sq_suppliers').select('*').order('name'),
    supabase.from('sq_items').select('*').order('code'),
    supabase.from('sq_item_aliases').select('*'),
    supabase.from('sq_settings').select('cost_of_money_pct').maybeSingle(),
  ]);
  const err = s.error ?? i.error ?? a.error;
  if (err) throw new Error(err.message);
  return { suppliers: (s.data ?? []) as Supplier[], items: (i.data ?? []) as SqItem[], aliases: (a.data ?? []) as SqAlias[], costPct: Number(st.data?.cost_of_money_pct ?? 12) };
}

// ---------------------------------------------------------------- suppliers: from other modules' records or new (local / foreign)
export type SysSupplier = { source: string; name: string; kind: SqKind; origin: 'local' | 'foreign'; country: string | null; address: string | null; contact: string | null };
export async function loadSystemSuppliers() {
  const { data, error } = await supabase.rpc('sq_system_suppliers');
  if (error) throw new Error(error.message);
  return (data ?? []) as SysSupplier[];
}
export const originText = (s: Pick<Supplier, 'origin' | 'country'>) => (s.origin === 'foreign' ? `Foreign${s.country ? ` · ${s.country}` : ''}` : 'Local');
/** The supplier form: name, supplier or manufacturer, local or foreign, country and address, contact */
export function supplierFields(s?: Partial<Supplier> & { contact?: string | null }) {
  return [
    { key: 'name', label: 'Name', required: true, initial: s?.name ?? '' },
    { key: 'kind', label: 'Type', type: 'select' as const, required: true, initial: s?.kind ?? 'supply', options: KIND_OPTIONS },
    { key: 'origin', label: 'Local or foreign', type: 'select' as const, required: true, initial: s?.origin ?? 'local', options: [{ value: 'local', label: 'Local (Sri Lanka)' }, { value: 'foreign', label: 'Foreign' }] },
    { key: 'country', label: 'Country', initial: s?.country ?? '', hint: 'For a foreign supplier or manufacturer, e.g. Germany, China' },
    { key: 'address', label: 'Address', type: 'multiline' as const, initial: s?.address ?? '' },
    { key: 'trades', label: 'What they supply', initial: s?.trades ?? '', hint: 'e.g. floodlights, masts, civil works' },
    { key: 'contact', label: 'Contact person', initial: s?.contact_name ?? s?.contact ?? '' },
    { key: 'phone', label: 'Phone', initial: s?.phone ?? '' },
    { key: 'email', label: 'Email', initial: s?.email ?? '' },
  ];
}
export const supplierRow = (r: Record<string, string>) => ({
  name: r.name.trim(), kind: r.kind, origin: r.origin === 'foreign' ? 'foreign' : 'local', country: r.country?.trim() || null, address: r.address?.trim() || null,
  trades: r.trades?.trim() || null, contact_name: r.contact?.trim() || null, phone: r.phone?.trim() || null, email: r.email?.trim() || null,
});

// ---------------------------------------------------------------- the job a package is for: picked from the system or typed
export type SqJob = { kind: 'project' | 'inquiry' | 'exec'; id: string; ref: string | null; project_name: string | null; client: string | null };
const JOB_KIND = { exec: 'Execution', inquiry: 'Inquiry', project: 'Project' } as const;
export async function loadJobs() {
  const { data, error } = await supabase.rpc('sq_jobs');
  if (error) throw new Error(error.message);
  return (data ?? []) as SqJob[];
}
export const jobProject = (j: SqJob) => [j.project_name, j.client].filter(Boolean).join(' – ');
/** A searchable choice that fills Project / client and the reference; both stay editable and typing without a choice is fine */
export function jobField(jobs: SqJob[], initial?: string) {
  const byKey = new Map(jobs.map((j) => [`${j.kind}:${j.id}`, j]));
  return {
    key: 'src', label: 'Pick from the system (optional)', type: 'select' as const, searchable: true, initial: initial ?? '',
    hint: 'An execution project, inquiry or project – fills the two boxes below. Or just type them.',
    options: [{ value: '', label: '— type it myself —' }, ...jobs.map((j) => ({ value: `${j.kind}:${j.id}`, label: [`${JOB_KIND[j.kind]} ${j.ref ?? ''}`.trim(), jobProject(j)].filter(Boolean).join(' · ') }))],
    fill: (v: string): Record<string, string> => { const j = byKey.get(v); return j ? { project: jobProject(j), job: j.ref ?? '' } : {}; },
  };
}
export const jobSource = (v?: string) => { const [k, id] = (v ?? '').split(':'); return k && id ? { source_kind: k, source_id: id } : { source_kind: null, source_id: null }; };

// ---------------------------------------------------------------- the comparison basis
/** Share of the line prices left after the discount on the whole quote (% and / or an amount in the quote currency) */
export function discFactor(q: { discount_pct?: number | null; discount_amt?: number | null; lines: { qty: number | null; rate: number | null; included: boolean }[] }) {
  const gross = q.lines.reduce((t, l) => t + (l.included || l.rate == null ? 0 : Number(l.rate) * Number(l.qty ?? 1)), 0);
  if (!gross) return 1;
  const net = gross * (1 - Number(q.discount_pct ?? 0) / 100) - Number(q.discount_amt ?? 0);
  return Math.max(0, net / gross);
}
/** LKR per unit, delivered (freight / duty added), after the quote's discount */
export const unitLkr = (q: Pick<SqQuote, 'fx_rate' | 'freight_pct'> & { _f?: number }, l: SqLine) => (l.included || l.rate == null ? null : l.rate * q.fx_rate * (1 + q.freight_pct / 100) * (q._f ?? 1));
export function quoteTotals(q: SqQuote) {
  const f = discFactor(q);
  const lines = q.lines.reduce((t, l) => t + (unitLkr({ ...q, _f: f }, l) ?? 0) * (l.qty ?? 1), 0);
  const excl = q.exclusions.reduce((t, x) => t + (x.add_lkr || 0), 0);
  const gross = q.lines.reduce((t, l) => t + (l.included || l.rate == null ? 0 : l.rate * (l.qty ?? 1)), 0);
  return { lines, excl, total: lines + excl, written: gross * f, gross, factor: f };
}
export const revLabel = (q: Pick<SqQuote, 'revision'>) => `R${q.revision ?? 0}`;
/** Each supplier's versions in a package, oldest first: the first quote and every revision after it */
export function chains(quotes: SqQuote[]) {
  const m = new Map<string, SqQuote[]>();
  for (const q of quotes) m.set(q.first_id ?? q.id, [...(m.get(q.first_id ?? q.id) ?? []), q]);
  return [...m.values()].map((c) => c.sort((a, b) => a.revision - b.revision));
}
/** Each supplier's latest version given at a stage (Pre Bid or Post Bid); suppliers with nothing at that stage are left out */
export const atStage = (quotes: SqQuote[], stage: BidStage) => chains(quotes).map((c) => [...c].reverse().find((q) => (q.bid_stage ?? 'pre_bid') === stage)).filter((q): q is SqQuote => !!q).sort((a, b) => a.created_at.localeCompare(b.created_at));

/** Days from delivery when each stage is paid (negative = before delivery). Commissioning and handover are taken 30 and 60 days after delivery. */
export function stageDay(p: SqPay, leadWeeks: number | null) {
  const lead = (leadWeeks ?? 8) * 7;
  switch (p.event) {
    case 'order': return -lead + p.days;
    case 'shipment': return -Math.min(lead, 21) + p.days;
    case 'delivery':
    case 'after_delivery': return p.days;
    case 'commissioning': return 30 + p.days;
    case 'handover': return 60 + p.days;
  }
}
/** Cash out before delivery, and the cost of money for paying early (a saving when paid after delivery), at the yearly rate */
export function cashOf(q: SqQuote, total: number, costPct: number) {
  if (!q.payments.length) return null;
  let before = 0, cost = 0, firstDay = 0;
  for (const p of q.payments) {
    const amt = (total * p.pct) / 100, d = stageDay(p, q.lead_weeks);
    if (d < 0) before += amt;
    firstDay = Math.min(firstDay, d);
    cost += (amt * (costPct / 100) * -d) / 365;
  }
  return { before, cost, weeksBefore: Math.round(-firstDay / 7) };
}
export const payText = (q: Pick<SqQuote, 'payments' | 'paid_by' | 'retention_pct'>) =>
  q.payments.length
    ? `${q.payments.map((p) => `${p.pct} % ${EVENT_LABEL[p.event].toLowerCase()}${p.days ? ` +${p.days} d` : ''}`).join(' · ')}${q.paid_by ? ` · ${q.paid_by}` : ''}${q.retention_pct ? ` · retention ${q.retention_pct} %` : ''}`
    : 'Not entered';

/** One comparison row per item (or per line text when not matched to an item) across the quotes */
export type CompareRow = { key: string; label: string; sub: string | null; item_id: string | null; cells: ({ unit: number | null; amount: number | null; qty: number | null; written: string; included: boolean } | null)[]; low: number | null };
export function compareRows(quotes: SqQuote[], items: SqItem[]): CompareRow[] {
  const rows = new Map<string, CompareRow>();
  quotes.forEach((q, qi) => {
    for (const l of q.lines) {
      const key = l.item_id ?? `t:${norm(l.text)}`;
      const it = l.item_id ? items.find((i) => i.id === l.item_id) : null;
      if (!rows.has(key)) rows.set(key, { key, label: it?.name ?? l.text, sub: it ? it.code : 'not matched to an item', item_id: l.item_id, cells: quotes.map(() => null), low: null });
      const r = rows.get(key)!;
      const u = unitLkr({ ...q, _f: discFactor(q) }, l), prev = r.cells[qi];
      const qty = (prev?.qty ?? 0) + (l.qty ?? 1);
      const amount = (prev?.amount ?? 0) + (u ?? 0) * (l.qty ?? 1);
      r.cells[qi] = {
        qty, amount: l.included ? prev?.amount ?? null : amount, unit: l.included ? prev?.unit ?? null : qty ? amount / qty : u, included: l.included && !prev,
        written: l.included ? 'included' : l.rate == null ? '—' : `${q.currency === 'LKR' ? '' : `${q.currency} `}${l.rate.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      };
    }
  });
  for (const r of rows.values()) {
    const us = r.cells.map((c) => c?.unit).filter((u): u is number => u != null);
    r.low = us.length > 1 ? Math.min(...us) : null;
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------- matching a supplier's wording to an item
export function matchItem(text: string, items: SqItem[], aliases: SqAlias[]): { item_id: string | null; sure: boolean } {
  const n = norm(text);
  const a = aliases.find((x) => norm(x.alias) === n);
  if (a) return { item_id: a.item_id, sure: true };
  const code = items.find((i) => n.split(' ').includes(i.code.toLowerCase()) || (i.sap_code && n.includes(i.sap_code.toLowerCase())));
  if (code) return { item_id: code.id, sure: true };
  // spelling differs between suppliers ("Flood Light 1500W" / "floodlight 1500 W"): compare letter triples of the text without spaces
  const tri = (s: string) => { const c = norm(s).replace(/ /g, ''); const m = new Map<string, number>(); for (let k = 0; k < c.length - 2; k++) m.set(c.slice(k, k + 3), (m.get(c.slice(k, k + 3)) ?? 0) + 1); return m; };
  const dice = (a: Map<string, number>, b: Map<string, number>) => { let inter = 0, na = 0, nb = 0; a.forEach((v, k) => { na += v; inter += Math.min(v, b.get(k) ?? 0); }); b.forEach((v) => (nb += v)); return na + nb ? (2 * inter) / (na + nb) : 0; };
  const tt = tri(text);
  let best: { id: string; s: number } | null = null;
  for (const i of items) {
    for (const cand of [i.name, ...aliases.filter((x) => x.item_id === i.id).map((x) => x.alias)]) {
      const s = dice(tt, tri(cand));
      if (!best || s > best.s) best = { id: i.id, s };
    }
  }
  return best && best.s >= 0.5 ? { item_id: best.id, sure: false } : { item_id: null, sure: false };
}

// ---------------------------------------------------------------- reading a quote file on the device (never stored)
export type ReadQuote = {
  source: 'excel' | 'pdf'; lines: SqLine[]; quote_no?: string; quote_date?: string; valid_until?: string; currency?: Ccy; lead_weeks?: number; warranty?: string;
  payText?: string; payments?: SqPay[]; paid_by?: string; exclusions?: string[]; total?: number;
};
const UNIT = /^(nr|nrs|no|nos|pcs|pc|ea|each|set|sets|lot|lots|m|mtr|mtrs|km|kg|l|ltr|sqm|m2|sum|ls|unit|units|pair|roll|box)\.?$/i;
const NUM = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;
const num = (s: string) => Number(s.replace(/,/g, ''));
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dateOf(s: string): string | undefined {
  let m = s.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`; }
  m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/i);
  if (m && MONTHS.includes(m[2].toLowerCase())) return `${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`;
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}
const addDays = (iso: string, d: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

/** Terms written in the quote: number, date, validity, currency, lead time, warranty, payment terms, exclusions */
export function readTerms(text: string): Omit<ReadQuote, 'source' | 'lines'> {
  const out: Omit<ReadQuote, 'source' | 'lines'> = {};
  const m1 = text.match(/(?:quot(?:e|ation)|offer|ref(?:erence)?)\s*(?:no\.?|number|#|ref\.?)?\s*[:.]?\s*([A-Z0-9][A-Z0-9/._-]{2,})/i);
  if (m1 && /\d/.test(m1[1])) out.quote_no = m1[1];
  const dl = text.split('\n').find((l) => /\bdate\b/i.test(l) && dateOf(l));
  if (dl) out.quote_date = dateOf(dl);
  const vl = text.split('\n').find((l) => /valid/i.test(l));
  if (vl) {
    const d = dateOf(vl), days = vl.match(/(\d{1,3})\s*days/i);
    out.valid_until = d ?? (days && out.quote_date ? addDays(out.quote_date, +days[1]) : undefined);
  }
  const c = text.match(/\b(USD|EUR|GBP|LKR|Rs\.?|US\$)\b/i);
  if (c) out.currency = /^rs|lkr/i.test(c[1]) ? 'LKR' : /us/i.test(c[1]) ? 'USD' : (c[1].toUpperCase() as Ccy);
  const lt = text.match(/(?:delivery|lead\s*time)[^\n]{0,40}?(\d{1,2})\s*(?:-\s*(\d{1,2})\s*)?(weeks?|wks?|days?|months?)/i);
  if (lt) { const v = +(lt[2] ?? lt[1]); out.lead_weeks = /day/i.test(lt[3]) ? Math.ceil(v / 7) : /month/i.test(lt[3]) ? v * 4 : v; }
  const w = text.match(/(\d{1,2})\s*(?:\(\w+\)\s*)?years?\s*(?:manufacturer'?s?\s*)?warranty|warranty[^\n]{0,20}?(\d{1,2})\s*years?/i);
  if (w) out.warranty = `${w[1] ?? w[2]} years`;
  const pl = text.split('\n').find((l) => /payment|credit|advance|\bLC\b|letter of credit/i.test(l));
  if (pl) {
    out.payText = pl.trim();
    const adv = pl.match(/(\d{1,3})\s*%\s*(?:advance|with\s*(?:the\s*)?(?:po|order))/i);
    const credit = pl.match(/(\d{1,3})\s*days?\s*(?:credit|from\s*(?:the\s*)?(?:date\s*of\s*)?(?:delivery|invoice))/i);
    if (/\bLC\b|letter of credit/i.test(pl)) { out.payments = [{ name: 'LC', pct: 100, event: 'shipment', days: 0 }]; out.paid_by = /90/.test(pl) ? 'LC 90 days' : 'LC at sight'; }
    else if (adv) out.payments = [{ name: 'Advance', pct: +adv[1], event: 'order', days: 0 }, { name: 'Balance', pct: 100 - +adv[1], event: credit ? 'after_delivery' : 'delivery', days: credit ? +credit[1] : 0 }];
    else if (credit) out.payments = [{ name: 'Credit', pct: 100, event: 'after_delivery', days: +credit[1] }];
  }
  const ex = text.split('\n').filter((l) => /^\s*(?:[-•*]\s*)?(?:excluding|excludes?|exclusions?|not included)\b/i.test(l)).map((l) => l.replace(/^\s*[-•*]?\s*(?:excluding|excludes?|exclusions?|not included)\s*[:.-]?\s*/i, '').trim()).filter(Boolean);
  if (ex.length) out.exclusions = ex.flatMap((e) => e.split(/,|;| and /).map((x) => x.trim()).filter((x) => x.length > 2)).slice(0, 8);
  return out;
}

/** Priced lines from PDF text: a description followed by numbers (qty, rate, amount – checked against each other) */
export function readPdfLines(text: string): SqLine[] {
  const out: SqLine[] = [];
  for (const raw of text.split('\n')) {
    const toks = raw.trim().split(/\s+/);
    if (toks.length < 3 || /\b(total|sub-?total|vat|tax|discount|grand)\b/i.test(raw)) continue;
    const nums: number[] = [];
    let i = toks.length - 1;
    while (i >= 0 && NUM.test(toks[i]) && nums.length < 4) nums.unshift(num(toks[i--]));
    let unit: string | null = null;
    if (i >= 0 && UNIT.test(toks[i])) {
      unit = toks[i--].replace(/\.$/, '');
      if (i >= 0 && NUM.test(toks[i])) nums.unshift(num(toks[i--])); // "96 nr 288,500 27,696,000": the quantity sits before the unit
    }
    const desc = toks.slice(0, i + 1).join(' ').replace(/^\d+(\.\d+)*[.)]?\s+/, '').trim();
    if (!desc || desc.length < 3 || !/[a-z]/i.test(desc) || nums.length < 2) continue;
    let qty: number | null = null, rate: number | null = null;
    const ok = (q: number, r: number, a: number) => a > 0 && Math.abs(q * r - a) / a < 0.02;
    if (nums.length >= 3 && ok(nums[nums.length - 3], nums[nums.length - 2], nums[nums.length - 1])) { qty = nums[nums.length - 3]; rate = nums[nums.length - 2]; }
    else if (nums.length >= 3 && ok(nums[0], nums[1], nums[2])) { qty = nums[0]; rate = nums[1]; }
    else if (nums.length === 2) { [qty, rate] = nums[0] <= 10000 && Number.isInteger(nums[0]) && nums[1] > nums[0] ? [nums[0], nums[1]] : [1, nums[1]]; }
    else continue;
    out.push({ text: desc, item_id: null, qty, unit, rate, included: false, check: true });
  }
  return out;
}

export async function readQuoteFile(f: PickedFile): Promise<ReadQuote> {
  const bytes = await readBytes(f);
  const isPdf = /\.pdf$/i.test(f.name) || f.mimeType === 'application/pdf';
  if (isPdf) {
    const text = await pdfText(bytes);
    const lines = readPdfLines(text);
    if (!lines.length) throw new Error('No priced lines found in the PDF – type the lines in, or use the supplier\'s Excel');
    return { source: 'pdf', lines, ...readTerms(text) };
  }
  const sheets = (await readXlsxFile(bytes)) as { sheet: string; data: unknown[][] }[];
  const p = parseBoqSheets(sheets, f.name);
  const lines: SqLine[] = p.sheets.flatMap((s) => s.items).filter((x) => x.qty != null || x.rate != null)
    .map((x) => ({ text: x.description, item_id: null, qty: x.qty, unit: x.unit, rate: x.rate ?? (x.amount != null && x.qty ? x.amount / x.qty : null), included: false, check: true }));
  if (!lines.length) throw new Error('No priced lines found – the sheet needs Description, Qty and Rate (or Unit price) column headings');
  const text = sheets.flatMap((s) => s.data.map((r) => r.map((c) => (c == null ? '' : String(c))).join(' '))).join('\n');
  return { source: 'excel', lines, ...readTerms(text) };
}
