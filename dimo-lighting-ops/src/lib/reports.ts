import type { Column, Section } from './export';
import { AGEING_COLOURS, AGEING_ORDER, fmtDate, fmtMoney, human } from './format';
import { projectTypeLabel, ROLE_SHORT } from './roles';
import { rpc, supabase } from './supabase';
import type { Debt, Inquiry, Profile, Project, Quotation, Sample, SlaClock, Visit } from './types';

// Report builders. Data comes through the normal client, so row-level security limits every
// report to the caller's scope (Own / Team / All) – filters can only narrow it further.

export type Filters = {
  from: string;
  to: string;
  projectType: string | null;
  threshold: number | null;
  term: string | null;
  groupBy: 'sales_person' | 'client';
};

export type Built = { columns: Column<Record<string, unknown>>[]; sections: Section<Record<string, unknown>>[]; filterText: string; currencyNote?: string; landscape?: boolean };

type Row = Record<string, unknown>;
const col = (header: string, key: string, align?: 'right'): Column<Row> => ({ header, value: (r) => (r[key] as string | number | null | undefined) ?? '', align });

async function rate(): Promise<number> {
  const { data } = await supabase.from('exchange_rates').select('usd_to_lkr, month').order('month', { ascending: false }).limit(1);
  return Number(data?.[0]?.usd_to_lkr ?? 0);
}


function totalsByCurrency(rows: (Row & { currency?: unknown })[], key: string, rateUsd: number) {
  const lkr = rows.filter((r) => r.currency !== 'USD').reduce((a, r) => a + Number(r[key] ?? 0), 0);
  const usd = rows.filter((r) => r.currency === 'USD').reduce((a, r) => a + Number(r[key] ?? 0), 0);
  return `${fmtMoney(lkr, 'LKR')} + ${fmtMoney(usd, 'USD')}${rateUsd ? ` = ${fmtMoney(lkr + usd * rateUsd, 'LKR')} consolidated` : ''}`;
}

export async function buildReport(key: string, f: Filters, people: Record<string, Profile>): Promise<Built> {
  const name = (id: unknown) => people[String(id ?? '')]?.full_name ?? '';
  const period = `${fmtDate(f.from)} – ${fmtDate(f.to)}`;
  const typeText = f.projectType ? ` – ${projectTypeLabel(f.projectType)}` : '';
  const usd = await rate();
  const currencyNote = usd ? `USD and LKR shown separately; consolidated at 1 USD = ${usd} LKR` : 'USD and LKR shown separately (no exchange rate set)';

  switch (key) {
    case 'visits': {
      let q = supabase.from('visits').select('*, organizations(name), projects(name)').gte('checkin_at', f.from).lte('checkin_at', `${f.to}T23:59:59`).order('checkin_at');
      if (f.projectType) q = q.eq('project_type', f.projectType);
      const { data } = await q;
      const rows = ((data ?? []) as Visit[]).map((v) => ({
        date: fmtDate(v.checkin_at),
        person: name(v.sales_person_id),
        customer: v.organizations?.name,
        project: v.projects?.name ?? '—',
        category: v.visit_category,
        objective: v.primary_objective,
        outcome: v.outcome ?? 'report due',
        planned: v.unplanned ? 'Unplanned' : 'Planned',
        gps: v.gps_verified == null ? '—' : v.gps_verified ? 'Yes' : 'Review',
      }));
      return {
        filterText: `Visits ${period}${typeText}`,
        landscape: true,
        columns: [col('Date', 'date'), col('Sales person', 'person'), col('Customer', 'customer'), col('Project', 'project'), col('Category', 'category'), col('Objective', 'objective'), col('Outcome', 'outcome'), col('Planned', 'planned'), col('GPS verified', 'gps')],
        sections: [{ rows, totals: { Date: `${rows.length} visits`, Planned: `${rows.filter((r) => r.planned === 'Unplanned').length} unplanned` } }],
      };
    }
    case 'pipeline':
    case 'win_probability':
    case 'project_term': {
      let q = supabase.from('projects').select('*, organizations(name)').is('merged_into', null).in('status', ['active', 'dormant', 'on_hold', 'won']);
      if (f.projectType) q = q.eq('project_type', f.projectType);
      if (key === 'win_probability' && f.threshold != null) q = q.gte('win_probability', f.threshold);
      if (f.term) q = q.eq('project_term', f.term);
      const { data } = await q.order('win_probability', { ascending: false });
      const projects = (data ?? []) as Project[];
      const toRow = (p: Project) => ({
        project: p.name,
        client: p.organizations?.name,
        type: projectTypeLabel(p.project_type),
        person: name(p.owner_id),
        stage: p.stage,
        duration: p.expected_duration_months,
        award: fmtDate(p.expected_award_date),
        value: fmtMoney(p.lighting_value, p.currency),
        lighting_value: p.lighting_value,
        currency: p.currency,
        probability: `${p.win_probability}%`,
        weighted: fmtMoney(((p.lighting_value ?? 0) * p.win_probability) / 100, p.currency),
        weighted_value: ((p.lighting_value ?? 0) * p.win_probability) / 100,
        status: human(p.status),
      });
      const columns = [
        col('Project', 'project'),
        col('Client', 'client'),
        col('Type', 'type'),
        col('Sales person', 'person'),
        col('Stage', 'stage'),
        col('Duration (months)', 'duration', 'right'),
        col('Expected award', 'award'),
        col('Lighting value', 'value', 'right'),
        col('Win probability', 'probability', 'right'),
        col('Weighted', 'weighted', 'right'),
        col('Status', 'status'),
      ];
      const groups: [string, Project[]][] =
        key === 'project_term'
          ? (['short', 'medium', 'long'] as const).map((t) => [`${human(t)} term projects`, projects.filter((p) => p.project_term === t)])
          : key === 'pipeline'
            ? Array.from(new Set(projects.map((p) => p.stage))).map((s) => [`Stage: ${s}`, projects.filter((p) => p.stage === s)])
            : [['Projects', projects]];
      return {
        filterText: `${key === 'win_probability' ? `Win probability ≥ ${f.threshold ?? 0}%` : key === 'project_term' ? `Project term${f.term ? ` – ${human(f.term)}` : ''}` : 'Pipeline by stage'}${typeText}`,
        currencyNote,
        landscape: true,
        columns,
        sections: groups
          .filter(([, list]) => list.length)
          .map(([heading, list]) => {
            const rows = list.map(toRow);
            return { heading, rows, totals: { Project: `${rows.length} projects`, 'Lighting value': totalsByCurrency(rows, 'lighting_value', usd), Weighted: totalsByCurrency(rows, 'weighted_value', usd) } };
          }),
      };
    }
    case 'client_view': {
      const [{ data: projects }, { data: inquiries }] = await Promise.all([
        supabase.from('projects').select('*, organizations(name)').is('merged_into', null),
        supabase.from('inquiries').select('*'),
      ]);
      const ps = ((projects ?? []) as Project[]).filter((p) => !f.projectType || p.project_type === f.projectType);
      const inq = (inquiries ?? []) as Inquiry[];
      const clients = Array.from(new Set(ps.map((p) => p.organization_id)));
      const rows = clients.map((c) => {
        const mine = ps.filter((p) => p.organization_id === c);
        const open = inq.filter((i) => i.organization_id === c && !['won', 'lost', 'cancelled', 'rejected', 'draft'].includes(i.status));
        return {
          client: mine[0]?.organizations?.name,
          ongoing: mine.filter((p) => ['active', 'dormant', 'won'].includes(p.status)).length,
          completed: mine.filter((p) => p.status === 'completed').length,
          lost: mine.filter((p) => p.status === 'lost').length,
          pending_design: open.filter((i) => ['submitted', 'accepted', 'in_design', 'design_review', 'design_approved'].includes(i.status) && i.route !== 'B').length,
          pending_est: open.filter((i) => ['in_estimation', 'estimation_review'].includes(i.status)).length,
          overdue: open.filter((i) => i.sla_colour === 'red').length,
        };
      });
      return {
        filterText: `Client view${typeText}`,
        columns: [col('Client', 'client'), col('Ongoing', 'ongoing', 'right'), col('Completed', 'completed', 'right'), col('Lost', 'lost', 'right'), col('Pending designs', 'pending_design', 'right'), col('Pending estimations', 'pending_est', 'right'), col('Overdue', 'overdue', 'right')],
        sections: [{ rows: rows.sort((a, b) => b.overdue - a.overdue || b.ongoing - a.ongoing) }],
      };
    }
    case 'tenders': {
      const { data } = await supabase.from('tenders').select('*, tender_bids(bid_price, compliant, competitor_id), projects(name)').gte('opening_date', f.from).lte('opening_date', f.to);
      const { data: comps } = await supabase.from('competitors').select('id, name');
      const cname = (id: number) => comps?.find((c) => c.id === id)?.name ?? '';
      const rows = (data ?? []).map((t) => {
        const bids = (t.tender_bids ?? []).filter((b: { compliant: boolean }) => b.compliant) as { bid_price: number; competitor_id: number }[];
        const low = Math.min(t.our_price ?? Infinity, ...bids.map((b) => Number(b.bid_price)));
        const rank = t.our_price ? 1 + bids.filter((b) => Number(b.bid_price) < t.our_price).length : null;
        return {
          tender: `${t.tender_no} – ${t.tender_name}`,
          project: t.projects?.name,
          opening: fmtDate(t.opening_date),
          our: fmtMoney(t.our_price, t.currency),
          rank: rank ? `L${rank}` : '—',
          gap: t.our_price && Number.isFinite(low) ? `${(((t.our_price - low) / t.our_price) * 100).toFixed(1)}%` : '—',
          competitors: bids.map((b) => cname(b.competitor_id)).join(', '),
          result: human(t.result_status),
        };
      });
      const decided = rows.filter((r) => ['Awarded to us', 'Awarded to competitor'].includes(r.result));
      return {
        filterText: `Tenders opened ${period}`,
        landscape: true,
        columns: [col('Tender', 'tender'), col('Project', 'project'), col('Opening', 'opening'), col('Our price', 'our', 'right'), col('Rank', 'rank'), col('Gap to L1', 'gap', 'right'), col('Competitors', 'competitors'), col('Result', 'result')],
        sections: [{ rows, totals: { Tender: `${rows.length} tenders`, Result: `Win rate ${decided.length ? Math.round((100 * decided.filter((r) => r.result === 'Awarded to us').length) / decided.length) : 0}%` } }],
      };
    }
    case 'quotations': {
      const { data } = await supabase.from('quotations').select('*, inquiries(code, project_name, customer_name, sales_person_id, lost_reason)').gte('released_at', f.from).lte('released_at', `${f.to}T23:59:59`).order('released_at');
      const rows = ((data ?? []) as (Quotation & { inquiries: Inquiry })[]).map((q) => ({
        no: q.full_no,
        inquiry: q.inquiries?.code,
        project: q.inquiries?.project_name,
        client: q.inquiries?.customer_name,
        person: name(q.inquiries?.sales_person_id),
        released: fmtDate(q.released_at),
        submitted: fmtDate(q.submitted_to_client_at),
        value: fmtMoney(q.quoted_value, q.currency),
        quoted_value: q.quoted_value,
        currency: q.currency,
        result: q.result ?? (q.validity_date < f.to ? 'Expired' : 'Open'),
        lost: q.inquiries?.lost_reason ?? '',
      }));
      return {
        filterText: `Quotations released ${period}`,
        currencyNote,
        landscape: true,
        columns: [col('Quotation', 'no'), col('Inquiry', 'inquiry'), col('Project', 'project'), col('Client', 'client'), col('Sales person', 'person'), col('Released', 'released'), col('Submitted', 'submitted'), col('Value', 'value', 'right'), col('Result', 'result'), col('Lost reason', 'lost')],
        sections: [{ rows, totals: { Quotation: `${rows.length} quotations`, Value: totalsByCurrency(rows, 'quoted_value', usd) } }],
      };
    }
    case 'turnaround':
    case 'delay_reasons': {
      const { data } = await supabase.from('sla_clocks').select('*').gte('started_at', f.from).lte('started_at', `${f.to}T23:59:59`);
      const clocks = (data ?? []) as SlaClock[];
      if (key === 'delay_reasons') {
        const map = new Map<string, number>();
        clocks.forEach((c) => {
          const r = c.delay_reason ?? c.hold_reason;
          if (r) map.set(`${c.owner_team ?? '—'}|${r}`, (map.get(`${c.owner_team ?? '—'}|${r}`) ?? 0) + 1);
        });
        const rows = Array.from(map.entries())
          .map(([k, n]) => ({ team: human(k.split('|')[0]), reason: k.split('|')[1], n }))
          .sort((a, b) => b.n - a.n);
        return { filterText: `Delay and hold reasons ${period}`, columns: [col('Team', 'team'), col('Reason', 'reason'), col('Count', 'n', 'right')], sections: [{ rows }] };
      }
      const stages = Array.from(new Set(clocks.map((c) => c.stage)));
      const rows = stages.map((s) => {
        const done = clocks.filter((c) => c.stage === s && c.stopped_at);
        const hours = done.map((c) => (Date.parse(c.stopped_at as string) - Date.parse(c.started_at)) / 3_600_000).sort((a, b) => a - b);
        const onTime = done.filter((c) => Date.parse(c.stopped_at as string) <= Date.parse(c.revised_due_at ?? c.due_at)).length;
        return {
          stage: human(s),
          closed: done.length,
          open: clocks.filter((c) => c.stage === s && !c.stopped_at).length,
          on_time: done.length ? `${Math.round((100 * onTime) / done.length)}%` : '—',
          avg: hours.length ? (hours.reduce((a, b) => a + b, 0) / hours.length).toFixed(1) : '—',
          p90: hours.length ? hours[Math.min(hours.length - 1, Math.floor(hours.length * 0.9))].toFixed(1) : '—',
        };
      });
      return {
        filterText: `Stage turnaround ${period} (elapsed hours; SLA colours use working hours)`,
        columns: [col('Stage', 'stage'), col('Closed', 'closed', 'right'), col('Open', 'open', 'right'), col('On time', 'on_time', 'right'), col('Average h', 'avg', 'right'), col('90th percentile h', 'p90', 'right')],
        sections: [{ rows }],
      };
    }
    case 'stakeholders': {
      const { data } = await supabase.from('visits').select('sales_person_id, visit_category').gte('checkin_at', f.from).lte('checkin_at', `${f.to}T23:59:59`);
      const map = new Map<string, number>();
      (data ?? []).forEach((v) => map.set(`${v.sales_person_id}|${v.visit_category}`, (map.get(`${v.sales_person_id}|${v.visit_category}`) ?? 0) + 1));
      const rows = Array.from(map.entries()).map(([k, n]) => ({ person: name(k.split('|')[0]), category: k.split('|')[1], n }));
      return { filterText: `Stakeholder engagement ${period}`, columns: [col('Sales person', 'person'), col('Stakeholder category', 'category'), col('Visits', 'n', 'right')], sections: [{ rows: rows.sort((a, b) => a.person.localeCompare(b.person) || b.n - a.n) }] };
    }
    case 'design_performance':
    case 'estimation_performance': {
      const data = await rpc<Row[]>('team_performance', { p_team: key === 'design_performance' ? 'design' : 'estimation', p_from: f.from, p_to: f.to });
      return {
        filterText: `${key === 'design_performance' ? 'Design' : 'Estimation'} team ${period}`,
        columns: [col('Team member', 'full_name'), col('Completed', 'jobs_completed', 'right'), col('On time %', 'on_time_pct', 'right'), col('Avg working days', 'avg_working_days', 'right'), col('Overdue open', 'overdue_open', 'right'), col('Review cycles', 'review_cycles', 'right'), col('Hours', 'hours_logged', 'right'), col('Open jobs', 'open_jobs', 'right')],
        sections: [{ rows: data }],
      };
    }
    case 'team_map': {
      const { data } = await supabase.from('sla_clocks').select('owner_id, colour, due_at').is('stopped_at', null);
      const clocks = (data ?? []) as Pick<SlaClock, 'owner_id' | 'colour' | 'due_at'>[];
      const week = Date.now() + 7 * 86400000;
      const rows = Object.values(people)
        .filter((p) => p.active && p.role !== 'sys_admin')
        .map((p) => {
          const mine = clocks.filter((c) => c.owner_id === p.id);
          return { name: p.full_name, role: ROLE_SHORT[p.role], manager: name(p.manager_id), pending: mine.length, due: mine.filter((c) => Date.parse(c.due_at) < week).length, overdue: mine.filter((c) => c.colour === 'red').length };
        });
      return {
        filterText: 'Team structure – pending, due this week and overdue per person',
        columns: [col('Name', 'name'), col('Role', 'role'), col('Reports to', 'manager'), col('Pending', 'pending', 'right'), col('Due this week', 'due', 'right'), col('Overdue', 'overdue', 'right')],
        sections: [{ rows }],
      };
    }
    case 'debtors': {
      const { data } = await supabase.from('debts').select('*').not('status', 'in', '(collected_confirmed,cleared)');
      const debts = (data ?? []) as Debt[];
      const toRow = (d: Debt) => ({ client: d.client_name, project: d.project_name, invoice: d.invoice_no, amount: fmtMoney(d.amount, d.currency), raw: d.amount, currency: d.currency, days: d.outstanding_days, person: name(d.sales_person_id), status: human(d.status), updated: fmtDate(d.last_status_at) });
      const columns = [col('Client', 'client'), col('Project', 'project'), col('Invoice', 'invoice'), col('Amount', 'amount', 'right'), col('Currency', 'currency'), col('Days', 'days', 'right'), col('Sales person', 'person'), col('Status', 'status'), col('Last update', 'updated')];
      const fourteen = Date.now() - 14 * 86400000;
      const sections: Section<Row>[] = AGEING_ORDER.map((b) => {
        const rows = debts
          .filter((d) => d.ageing_bucket === b)
          .sort((x, y) => (f.groupBy === 'client' ? (x.client_name ?? '').localeCompare(y.client_name ?? '') : name(x.sales_person_id).localeCompare(name(y.sales_person_id))))
          .map(toRow);
        return { heading: `${AGEING_COLOURS[b].label} days`, colour: AGEING_COLOURS[b].bg, rows, totals: { Client: `${rows.length} invoices`, Amount: totalsByCurrency(rows as Row[], 'raw', 0) } };
      }).filter((s) => s.rows.length);
      const legal = debts.filter((d) => d.is_legal);
      if (legal.length)
        sections.push({ heading: 'Legal', colour: '#111111', rows: legal.map((d) => ({ ...toRow(d), status: `${d.legal_description ?? ''} · hearing ${fmtDate(d.next_hearing_date)}` })) });
      const nonMoving = debts.filter((d) => !d.is_legal && !['collected', 'disputed'].includes(d.status) && Date.parse(d.last_status_at) < fourteen && Date.parse(d.last_amount_change_at) < fourteen);
      if (nonMoving.length) sections.push({ heading: 'Non-moving', rows: nonMoving.map(toRow) });
      return { filterText: `Debtors list – categorised by ageing (grouped by ${f.groupBy === 'client' ? 'client' : 'sales person'})`, currencyNote: 'LKR and USD shown separately', landscape: true, columns, sections };
    }
    case 'samples': {
      const { data } = await supabase.from('samples').select('*').gte('created_at', f.from).lte('created_at', `${f.to}T23:59:59`);
      const today = new Date().toISOString().slice(0, 10);
      const rows = ((data ?? []) as Sample[]).map((s) => ({
        code: s.code,
        project: s.project_name,
        client: s.client_name,
        person: name(s.sales_person_id),
        type: human(s.sample_type),
        status: s.status === 'out' && s.expected_return_date && s.expected_return_date < today ? 'Overdue' : human(s.status),
        value: fmtMoney(s.total_value, s.currency),
        raw: s.total_value,
        currency: s.currency,
        handover: fmtDate(s.handed_over_at),
        due: fmtDate(s.expected_return_date),
      }));
      const out = rows.filter((r) => ['Out', 'Overdue'].includes(r.status));
      return {
        filterText: `Samples requested ${period}`,
        landscape: true,
        columns: [col('Sample', 'code'), col('Project', 'project'), col('Client', 'client'), col('Sales person', 'person'), col('Type', 'type'), col('Status', 'status'), col('Value', 'value', 'right'), col('Handed over', 'handover'), col('Return due', 'due')],
        sections: [{ rows, totals: { Sample: `${rows.length} samples`, Value: `Out: ${totalsByCurrency(out, 'raw', 0)} · Overdue: ${totalsByCurrency(rows.filter((r) => r.status === 'Overdue'), 'raw', 0)}` } }],
      };
    }
    case 'scorecard': {
      const month = f.from.slice(0, 8) + '01';
      const sales = Object.values(people).filter((p) => ['asm_building', 'asm_infra'].includes(p.role));
      const rows: Row[] = [];
      for (const p of sales) {
        const sc = await rpc<{ score: number; area_scores: Record<string, number>; kpis: Record<string, number> }>('salesperson_scorecard', { p_user: p.id, p_month: month }).catch(() => null);
        if (!sc) continue;
        rows.push({ name: p.full_name, score: sc.score, order: sc.area_scores.order_intake, pipe: sc.area_scores.pipeline, act: sc.area_scores.activity, win: sc.area_scores.win_margin, cov: sc.area_scores.coverage, visits: sc.kpis.visits_per_week });
      }
      return {
        filterText: `Monthly scorecard – ${fmtDate(month)}`,
        columns: [col('Sales person', 'name'), col('Score /100', 'score', 'right'), col('Order intake %', 'order', 'right'), col('Pipeline %', 'pipe', 'right'), col('Activity %', 'act', 'right'), col('Win & margin %', 'win', 'right'), col('Coverage %', 'cov', 'right'), col('Visits / week', 'visits', 'right')],
        sections: [{ rows }],
      };
    }
    default:
      return { filterText: '', columns: [], sections: [] };
  }
}
