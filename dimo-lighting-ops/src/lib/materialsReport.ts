import { esc, printHtml, reportHtml } from './export';
import { custodyLabel, MR_STATUS, mrDaysLate, type ExecProject, type MaterialRequest } from './execution';
import { fmtDate, fmtDateTime, todayISO } from './format';
import { supabase, rpc } from './supabase';

// Materials report of one project (SEE): requests and deliveries, the store by custody, usage, special releases and warnings.

type Line = { mr_id: string; item: string; unit: string; qty: number; received_qty: number };
type Bal = { item: string; unit: string; custody: string; custody_company: string | null; received: number; issued: number; returned: number; balance: number; used: number; low: boolean; ignore_low: boolean };
type Iss = { code: string; day: string; item: string; unit: string; custody: string; qty: number; task_title: string | null; issued_to: string | null; issued_by: string; status: string; related: boolean; release_reason: string | null; used_qty: number | null; used_note: string | null };

const num = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const h2 = (t: string) => `<h2 style="background:#F2F2F2">${esc(t)}</h2>`;
function table(head: string[], rows: (string | number)[][], right: number[] = []) {
  const r = new Set(right);
  return `<table><thead><tr>${head.map((h, i) => `<th style="text-align:${r.has(i) ? 'right' : 'left'}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((x) => `<tr>${x.map((c, i) => `<td style="text-align:${r.has(i) ? 'right' : 'left'}">${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

export async function exportMaterialsReport(p: ExecProject, people: Record<string, { full_name: string } | undefined>, generatedBy: string) {
  const today = todayISO();
  const [mrs, bal, iss] = await Promise.all([
    supabase.from('material_requests').select('*').eq('exec_project_id', p.id).order('requested_at'),
    rpc<Bal[]>('store_balances', { p_exec: p.id }),
    supabase.from('material_issues').select('*').eq('exec_project_id', p.id).order('issued_at'),
  ]);
  const reqs = (mrs.data ?? []) as MaterialRequest[];
  const lines = reqs.length ? (((await supabase.from('material_request_lines').select('mr_id, item, unit, qty, received_qty').in('mr_id', reqs.map((m) => m.id))).data ?? []) as Line[]) : [];
  const issues = (iss.data ?? []) as Iss[];
  const name = (id: string) => people[id]?.full_name ?? '—';
  const open = reqs.filter((m) => ['ae_review', 'submitted', 'approved', 'ordered', 'part_received'].includes(m.status));
  const late = open.filter((m) => mrDaysLate(m, today) > 0);
  const usedBy = new Map<string, { item: string; unit: string; used: number; days: Set<string> }>();
  for (const i of issues.filter((x) => x.used_qty != null)) {
    const k = i.item.toLowerCase();
    const e = usedBy.get(k) ?? { item: i.item, unit: i.unit, used: 0, days: new Set<string>() };
    e.used += Number(i.used_qty);
    e.days.add(i.day);
    usedBy.set(k, e);
  }
  const special = issues.filter((i) => !i.related);
  const low = bal.filter((b) => b.low);

  const extra = `
<style>
  .kv { display:grid; grid-template-columns: repeat(5, 1fr); gap:6px; margin:4px 0 6px; } .kv > div { border:1px solid #E3E3E3; padding:5px; }
  .kv .k { color:#555; font-size:8.5px; } .kv .v { font-weight:bold; font-size:13px; } .note { color:#555; font-size:8.5px; margin: 2px 0; } .foot { display:none; }
</style>
<div class="kv">
  <div><div class="k">Requests</div><div class="v">${reqs.length}</div></div>
  <div><div class="k">Open</div><div class="v">${open.length}</div></div>
  <div><div class="k">Deliveries late</div><div class="v" style="color:${late.length ? '#C8102E' : '#111'}">${late.length}</div></div>
  <div><div class="k">Items in the store</div><div class="v">${bal.length}</div></div>
  <div><div class="k">Low stock</div><div class="v" style="color:${low.some((b) => !b.ignore_low) ? '#C8102E' : '#111'}">${low.length}</div></div>
</div>
${h2(`Material requests (${reqs.length})`)}
${table(
  ['Request', 'Requested', 'By', 'Needed by', 'Status', 'Delivery', 'Days late', 'Items (received / requested)'],
  reqs.map((m) => [
    m.code,
    fmtDate(m.requested_at),
    name(m.requested_by),
    fmtDate(m.required_date),
    MR_STATUS[m.status],
    m.delivery_at ? fmtDateTime(m.delivery_at) : '—',
    mrDaysLate(m, today) || '',
    lines.filter((l) => l.mr_id === m.id).map((l) => `${l.item} ${num(l.received_qty)}/${num(l.qty)} ${l.unit}`).join('; '),
  ]),
  [6],
)}
${h2(`Site store by custody (${bal.length})`)}
${table(
  ['Item', 'Custody', 'Received', 'Issued', 'Used', 'Back', 'Balance', 'Warning'],
  bal.map((b) => [b.item, `${custodyLabel(b.custody)}${b.custody_company ? ` · ${b.custody_company}` : ''}`, num(b.received), num(b.issued), num(b.used), num(b.returned), `${num(b.balance)} ${b.unit}`, b.low ? (b.ignore_low ? 'Low – ignored' : 'Low stock') : '']),
  [2, 3, 4, 5, 6],
)}
${h2('Usage by item')}
${table(
  ['Item', 'Used', 'Days used', 'Average a day'],
  [...usedBy.values()].map((u) => [u.item, `${num(u.used)} ${u.unit}`, u.days.size, `${num(u.used / Math.max(1, u.days.size))} ${u.unit}`]),
  [1, 2, 3],
)}
${h2(`Special releases – material not for the task (${special.length})`)}
${special.length ? table(
  ['Issue', 'Day', 'Material', 'Custody', 'Task', 'By', 'Reason', 'Outcome'],
  special.map((i) => [i.code, fmtDate(i.day), `${i.item} ${num(i.qty)} ${i.unit}`, custodyLabel(i.custody), i.task_title ?? '', name(i.issued_by), i.release_reason ?? '—', i.status]),
) : '<div class="note">None.</div>'}
${h2(`Issues to the work (${issues.length})`)}
${table(
  ['Issue', 'Day', 'Material', 'Custody', 'Task', 'To', 'Used', 'Used for'],
  issues.filter((i) => i.status === 'issued').map((i) => [i.code, fmtDate(i.day), `${i.item} ${num(i.qty)} ${i.unit}`, custodyLabel(i.custody), i.task_title ?? '', i.issued_to ?? '', i.used_qty == null ? 'not recorded' : num(i.used_qty), i.used_note ?? '']),
)}
<div class="note">Quantities only – prices and values are in SAP.</div>`;
  const filters = `${p.code ?? ''} ${p.name}`;
  const html = reportHtml({ key: 'materials_report', title: `Materials report · ${p.code ?? ''} ${p.name}`, filters, period: `to ${fmtDate(today)}`, currencyNote: 'Quantities only (no values)', generatedBy, landscape: true }, [], [], extra);
  await printHtml(html, { key: 'materials_report', filters, title: 'Materials report', landscape: true });
}
