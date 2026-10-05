import { esc } from './export';
import { fmtDate, fmtDateTime } from './format';
import { isTeamKind, kindLabel } from './meetingActions';

// Full minutes of a published meeting (sales, estimation or design) as a printable A4 page:
// meeting details, attendance, the team's figures, the meeting notes, the action register (who is responsible,
// who was appointed, by when, status), then each person's figures, lists, discussion and actions, and the distribution.

type Dict = Record<string, unknown>;
export type MinutesAction = {
  no?: number;
  action: string;
  kind: string;
  status: 'open' | 'done';
  forWhom: string | null; // whose part of the meeting it was raised in (null = general)
  owner: string;
  ownerRole: string;
  assignee: string | null;
  due_date: string | null;
  subject: string | null; // project · customer · unit
  objective: string | null;
  done_at: string | null;
  done_note: string | null;
};
type Facts = [string, string][];
type List = { title: string; items: string[]; tone?: 'red' | 'amber' };
export type MinutesPerson = { name: string; leave: string | null; facts: Facts; lists: List[]; note: string; actions: MinutesAction[] };
export type MinutesInput = {
  title: string;
  date: string;
  time: string;
  host: string;
  startedAt: string | null;
  publishedAt: string | null;
  figuresAt: string | null;
  period: string | null;
  attendance: { name: string; role: string; status: string; at: string | null; note: string | null }[];
  teamFacts: Facts;
  teamLists: List[];
  notes: string | null;
  general: MinutesAction[];
  people: MinutesPerson[];
  distribution: string[];
  generatedBy: string;
  logoUrl: string | null;
};

const num = (v: unknown) => Number(v ?? 0);
const mn = (v: unknown) => (num(v) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: unknown) => `${Math.round(num(v))}%`;
const arr = (v: unknown) => (Array.isArray(v) ? (v as Dict[]) : []);
const s = (v: unknown) => (v == null ? '' : String(v));
const d = (v: unknown) => (v ? fmtDate(String(v)) : '—');

// ---------------------------------------------------------------------------------------------------------------------
// Figures from the meeting pack, as label / value pairs and lists
// ---------------------------------------------------------------------------------------------------------------------
export function salesTeam(t: Dict): { facts: Facts; lists: List[] } {
  return {
    facts: [
      ['Secured vs budget (YTD)', `${mn(t.secured)} / ${mn(t.budget_secure)} Mn · ${pct(num(t.budget_secure) ? (num(t.secured) / num(t.budget_secure)) * 100 : 0)}`],
      ['Invoiced vs budget (YTD)', `${mn(t.invoiced)} / ${mn(t.budget_invoice)} Mn · ${pct(num(t.budget_invoice) ? (num(t.invoiced) / num(t.budget_invoice)) * 100 : 0)}`],
      ['Wins last week', `${num(t.wins_n)} · ${mn(t.wins_value)} Mn`],
      ['Losses last week', String(num(t.losses_n))],
      ['Quotations waiting', String(num(t.quotes_waiting_n))],
      ['Follow-ups overdue', String(num(t.followups_overdue_n))],
      ['Slipped invoices', `${num(t.slipped_n)} · ${mn(t.slipped)} Mn`],
      ['Debtors over 90 days', `${mn(t.debtors_90)} Mn`],
    ],
    lists: [],
  };
}

export function salesPerson(p: Dict): { facts: Facts; lists: List[] } {
  const t = (p.target ?? {}) as Dict;
  const v = (p.visits ?? {}) as Dict;
  const inv = (p.invoices ?? {}) as Dict;
  const deb = (p.debtors_90 ?? {}) as Dict;
  const ret = (p.retentions_due ?? {}) as Dict;
  return {
    facts: [
      ['Score', num(t.score).toFixed(2)],
      ['Secured vs budget (YTD)', `${mn(t.secured)} / ${mn(t.budget_secure)} Mn · ${pct(t.secured_pct)}`],
      ['Invoiced vs budget (YTD)', `${mn(t.invoiced)} / ${mn(t.budget_invoice)} Mn · ${pct(t.invoiced_pct)}`],
      ['Visits last week', `${num(v.done)} done · ${num(v.completed)} of ${num(v.planned)} planned · ${num(v.missed)} missed`],
      ['Follow-ups overdue', String(num(p.followups_overdue_n))],
      ['Quotations waiting', String(num(p.quotes_waiting_n))],
      ['Projects not visited 30 days', String(num(p.not_visited_n))],
      ['Invoices slipped', `${num(inv.slipped_n)} · ${mn(inv.slipped)} Mn`],
      ['Invoices due this month', `${mn(inv.due_month)} Mn`],
      ['Debtors over 90 days', `${num(deb.n)} · ${mn(deb.lkr)} Mn`],
      ['Retentions due (30 days)', `${num(ret.n)} · ${mn(ret.lkr)} Mn`],
    ],
    lists: [
      { title: 'Won', items: arr(p.wins).map((w) => `${s(w.code)} ${s(w.project)}${w.customer ? ` – ${s(w.customer)}` : ''} (LKR ${num(w.value).toLocaleString('en-US')})`) },
      { title: 'Lost', items: arr(p.losses).map((w) => `${s(w.code)} ${s(w.project)}${w.reason ? ` – ${s(w.reason)}` : ''}`), tone: 'red' },
      { title: 'Quotations waiting', items: arr(p.quotes_waiting).map((q) => `${s(q.code)} ${s(q.project)}${q.customer ? ` – ${s(q.customer)}` : ''} (${num(q.days)} days)`) },
      { title: 'Follow-ups overdue', items: arr(p.followups_overdue).map((f) => `${d(f.date)} ${s(f.customer)}${f.action ? ` – ${s(f.action)}` : ''}`), tone: 'red' },
      { title: 'Not visited for 30 days', items: arr(p.not_visited).map((n) => `${s(n.project)} (${n.last_visit ? `last ${d(n.last_visit)}` : 'never'})`) },
      openActions(p),
    ],
  };
}

const job = (j: Dict, extra: string) => `${s(j.code)} ${s(j.project)}${extra}`;
const openActions = (p: Dict): List => ({
  title: 'Open actions from earlier meetings',
  items: arr(p.open_actions).map((a) => `${s(a.action)} (${s(a.owner)}${a.due ? `, by ${d(a.due)}` : ''})`),
  tone: 'amber',
});

export function teamTeam(est: boolean, t: Dict): { facts: Facts; lists: List[] } {
  const h = (t.in_hand ?? {}) as Dict;
  const rel = num(t.released_jobs_n ?? t.released_n);
  const hit = (t.hit ?? {}) as Dict;
  const wl = num(hit.won) + num(hit.lost);
  const facts: Facts = [
    ['Jobs in hand', String(num(h.total))],
    ...((est
      ? [
          ['New / not assigned', String(num(h.new))],
          ['Waiting approval (SM / GM)', String(num(h.approval))],
          ['Quotations released last week', `${num(t.released_n)} · ${mn(t.released_value)} Mn`],
        ]
      : [
          ['In design', String(num(h.in_progress))],
          ['In review', String(num(h.in_review))],
          ['Released last week', String(num(t.released_n))],
        ]) as Facts),
    ['Released on time', rel ? `${Math.round((num(t.released_on_time_n) / rel) * 100)}%` : '—'],
    ['Overdue', String(num(t.overdue_n))],
    [est ? 'At risk (7 days)' : 'Due in 7 days', String(num(est ? t.at_risk_n : t.due_soon_n))],
    ['Returned', String(num(h.returned))],
    ['On hold', String(num(h.on_hold))],
    ...((est
      ? [
          ['Open clarifications', `${num(t.clarifications_n)}${t.clarifications_oldest ? ` · oldest ${num(t.clarifications_oldest)} days` : ''}`],
          ['Hit rate (90 days)', wl ? `${Math.round((num(hit.won) / wl) * 100)}% · ${num(hit.won)} won / ${num(hit.lost)} lost` : '—'],
          ['Waiting on Design', String(num(t.waiting_design_n))],
        ]
      : [
          ['Waiting on sales information', String(num(t.waiting_info_n))],
          ['Released to Estimation, not started', String(num(t.waiting_estimation_n))],
          ['Early releases to sales', String(num(t.early_releases_n))],
          ['Hours logged last week', String(num(t.hours_week))],
        ]) as Facts),
  ];
  const lists: List[] = [
    { title: 'Overdue', items: arr(t.overdue).map((j) => job(j, ` (${s(j.person) || '—'}, ${num(j.days)} days late)`)), tone: 'red' },
    est
      ? { title: 'At risk', items: arr(t.at_risk).map((j) => job(j, ` (${s(j.person) || '—'}, due ${d(j.due)})`)), tone: 'amber' }
      : { title: 'Due in 7 days', items: arr(t.due_soon).map((j) => job(j, ` (${s(j.person) || '—'}, due ${d(j.due)}, ${num(j.progress)}%)`)) },
    {
      title: 'Returned',
      items: arr(t.returned).map((j) => job(j, ` (${s(j.person) || '—'}${j.reason ? ` – ${s(j.reason)}` : ''}${est ? `, R${num(j.revision)}` : `, ${num(j.cycles)} reviews`})`)),
      tone: 'amber',
    },
    { title: 'On hold', items: arr(t.on_hold).map((j) => job(j, ` (${s(j.reason) || 'no reason'}${j.waiting_on ? `, waiting on ${s(j.waiting_on)}` : ''})`)) },
  ];
  if (est) {
    lists.push({ title: 'Open clarifications', items: arr(t.clarifications).map((c) => `${s(c.code)} – ${s(c.question)} (${s(c.by)}, ${num(c.days)} days)`) });
    lists.push({ title: 'Waiting on Design', items: arr(t.waiting_design).map((c) => job(c, c.design_due ? ` (design due ${d(c.design_due)})` : '')) });
  } else {
    lists.push({ title: 'Waiting on sales information', items: arr(t.waiting_info).map((c) => job(c, ` (${s(c.sales)}, since ${d(c.since)})`)) });
  }
  return { facts, lists };
}

export function teamPerson(est: boolean, p: Dict): { facts: Facts; lists: List[] } {
  const avg = p.avg_days;
  return {
    facts: [
      ['Jobs in hand', String(num(p.in_hand_n))],
      ['Released last week', String(num(p.released_week_n))],
      ['Overdue', String(arr(p.overdue).length)],
      ['Due in 7 days', String(arr(p.due_soon).length)],
      [
        est ? 'Average turnaround (90 days)' : 'Average design time (90 days)',
        avg == null
          ? '—'
          : typeof avg === 'number'
            ? `${avg} days`
            : Object.entries(avg as Dict)
                .map(([k, v]) => `${k} ${s(v)} days`)
                .join(' · '),
      ],
      [est ? 'Returns / revisions' : 'Review returns (90 days)', String(num(est ? p.returns_n : p.review_returns))],
      ...((est ? [] : [['Hours logged last week', String(num(p.hours_week))]]) as Facts),
    ],
    lists: [
      { title: 'Overdue', items: arr(p.overdue).map((j) => job(j, ` (${num(j.days)} days late)`)), tone: 'red' },
      { title: 'Due soon', items: arr(p.due_soon).map((j) => job(j, ` (due ${d(j.due)})`)) },
      openActions(p),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------------
const para = (t: string | null | undefined) => (t?.trim() ? `<p class="note">${esc(t).replace(/\n/g, '<br/>')}</p>` : '<p class="none">No notes recorded.</p>');

const facts = (f: Facts) =>
  f.length ? `<div class="facts">${f.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>` : '';

const lists = (ls: List[]) =>
  ls
    .filter((l) => l.items.length)
    .map((l) => `<div class="list ${l.tone ?? ''}"><b>${esc(l.title)} (${l.items.length})</b><ul>${l.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`)
    .join('');

function register(rows: MinutesAction[], showFor: boolean) {
  if (!rows.length) return '<p class="none">No actions.</p>';
  return `<table class="reg"><thead><tr><th style="width:22px">No.</th><th>Action</th>${showFor ? '<th style="width:90px">Raised for</th>' : ''}<th style="width:120px">Responsible</th><th style="width:66px">Due</th><th style="width:80px">Status</th></tr></thead><tbody>
${rows
  .map(
    (a) => `<tr><td>${a.no ?? ''}</td><td>${a.kind !== 'task' ? `<span class="tag">${esc(kindLabel(a.kind))}</span> ` : ''}${esc(a.action)}${
      a.subject ? `<div class="sub">${esc(a.subject)}</div>` : ''
    }${a.objective ? `<div class="sub">Objective: ${esc(a.objective)}</div>` : ''}</td>${showFor ? `<td>${esc(a.forWhom ?? 'General')}</td>` : ''}<td>${esc(a.owner)}<div class="sub">${esc(a.ownerRole)}</div>${
      isTeamKind(a.kind) ? `<div class="sub">${a.assignee ? `Appointed: ${esc(a.assignee)}` : 'Person to be appointed'}</div>` : ''
    }</td><td>${a.due_date ? esc(fmtDate(a.due_date)) : '—'}</td><td>${
      a.status === 'done' ? `<b class="ok">Done</b>${a.done_at ? `<div class="sub">${esc(fmtDate(a.done_at))}</div>` : ''}${a.done_note ? `<div class="sub">${esc(a.done_note)}</div>` : ''}` : '<b class="open">Open</b>'
    }</td></tr>`,
  )
  .join('')}</tbody></table>`;
}

export function minutesHtml(m: MinutesInput) {
  const now = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo' });
  const logo = m.logoUrl
    ? `<img src="${esc(m.logoUrl)}" style="height:36px;width:auto;object-fit:contain" />`
    : `<div style="font:800 26px/1 Arial;color:#C8102E;letter-spacing:1px">DIMO</div>`;
  const present = m.attendance.filter((a) => a.status === 'Present').length;
  const all = [...m.general, ...m.people.flatMap((p) => p.actions)];
  const open = all.filter((a) => a.status === 'open').length;
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { size: A4 portrait; margin: 16mm 13mm 16mm 13mm;
    @bottom-left { content: "Confidential – for internal use · DIMO Lighting Operations System"; font: 8px Arial; color: #666; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8px Arial; color: #666; } }
  body { font: 10px Arial, Helvetica, sans-serif; color: #111; }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #C8102E; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 17px; margin: 0; } .sub { color: #555; font-size: 9px; margin-top: 1px; }
  .info { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; background: #F7F7F7; padding: 8px; margin-bottom: 8px; }
  h2 { font-size: 12px; background: #222; color: #fff; padding: 4px 6px; margin: 14px 0 6px; page-break-after: avoid; }
  h3 { font-size: 11.5px; margin: 0 0 4px; color: #C8102E; page-break-after: avoid; }
  h4 { font-size: 10px; margin: 8px 0 3px; text-transform: uppercase; letter-spacing: .4px; color: #444; page-break-after: avoid; }
  p { margin: 2px 0 6px; line-height: 1.45; } p.note { white-space: normal; } p.none { color: #888; font-style: italic; }
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px 10px; margin: 4px 0 6px; }
  .facts div { border-left: 2px solid #DDD; padding-left: 5px; } .facts span { display: block; color: #666; font-size: 8.5px; } .facts b { font-size: 10px; }
  .list { margin: 3px 0 4px; } .list ul { margin: 2px 0 0 14px; padding: 0; } .list li { margin: 1px 0; }
  .list.red b { color: #B00020; } .list.amber b { color: #A15C00; }
  .person { border: 1px solid #DDD; border-radius: 4px; padding: 8px; margin-bottom: 8px; page-break-inside: avoid; }
  .leave { background: #EAF2FF; padding: 3px 6px; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  th { background: #EEE; text-align: left; padding: 3px 4px; font-size: 9px; } td { padding: 3px 4px; border-bottom: 1px solid #E3E3E3; vertical-align: top; }
  .tag { display: inline-block; background: #E8EEF9; color: #1F4E9A; font-size: 8.5px; font-weight: bold; padding: 0 4px; border-radius: 3px; }
  .ok { color: #1B7F3B; } .open { color: #A15C00; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 26px; page-break-inside: avoid; }
  .sign div { border-top: 1px solid #999; padding-top: 4px; color: #444; }
  .wm { position: fixed; top: 45%; left: 5%; width: 90%; text-align: center; transform: rotate(-30deg);
        font: bold 30px Arial; color: rgba(200,16,46,0.06); z-index: 0; pointer-events: none; }
</style></head><body>
<div class="wm">${esc(m.generatedBy)} · ${esc(now)}</div>
<header>${logo}<div><h1>Minutes of the ${esc(m.title)}</h1><div class="sub">Lighting Solutions · ${esc(fmtDate(m.date))} · ${esc(m.time)}</div></div></header>
<div class="info">
  <div><b>Chaired by:</b> ${esc(m.host)}</div><div><b>Attendance:</b> ${present} of ${m.attendance.length} present</div>
  <div><b>Started:</b> ${m.startedAt ? esc(fmtDateTime(m.startedAt)) : '—'}</div><div><b>Published:</b> ${m.publishedAt ? esc(fmtDateTime(m.publishedAt)) : '—'}</div>
  <div><b>Review period:</b> ${esc(m.period ?? '—')}</div><div><b>Figures as at:</b> ${m.figuresAt ? esc(fmtDateTime(m.figuresAt)) : '—'}</div>
  <div><b>Actions:</b> ${all.length} · ${open} open · ${all.length - open} done</div><div><b>Downloaded by:</b> ${esc(m.generatedBy)} · ${esc(now)}</div>
</div>

<h2>1. Attendance</h2>
<table><thead><tr><th>Name</th><th>Role</th><th>Attendance</th><th>Note</th></tr></thead><tbody>
${
  m.attendance
    .map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.role)}</td><td>${esc(a.status)}${a.at ? `<div class="sub">${esc(fmtDateTime(a.at))}</div>` : ''}</td><td>${esc(a.note ?? '')}</td></tr>`)
    .join('') || '<tr><td colspan="4">Nobody invited</td></tr>'
}
</tbody></table>

<h2>2. Team review</h2>
${facts(m.teamFacts)}
${lists(m.teamLists)}

<h2>3. General discussion</h2>
${para(m.notes)}

<h2>4. Action register – all actions and responsibilities</h2>
${register(all, true)}

<h2>5. Review by person</h2>
${m.people
  .map(
    (p) => `<div class="person"><h3>${esc(p.name)}</h3>${p.leave ? `<div class="leave">${esc(p.leave)}</div>` : ''}${facts(p.facts)}${lists(p.lists)}
<h4>Discussion</h4>${para(p.note)}
<h4>Actions agreed</h4>${register(p.actions, false)}</div>`,
  )
  .join('')}

<h2>6. Distribution</h2>
<p>${esc(m.distribution.join(', ') || '—')}</p>
<div class="sign"><div>Chaired by – ${esc(m.host)}${m.publishedAt ? ` · published ${esc(fmtDateTime(m.publishedAt))}` : ''}</div><div>Reviewed by – GM / DGM</div></div>
</body></html>`;
}
