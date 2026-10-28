import { Stack } from 'expo-router';
import { ProcessReport } from '@/components/ProcessReport';
import { ErrorBanner, Loading, Screen } from '@/components/ui';
import { useLoad, usePeople } from '@/lib/hooks';
import { carve, fromHistory, slDay, type PItem, type PNode, type Seg } from '@/lib/processNodes';
import { clarifications, historyOf, holidaysSet, withClarifications } from '@/lib/processSources';
import { supabase } from '@/lib/supabase';

const NODES: PNode[] = [
  { key: 'que', name: 'Queue', colour: '#6D28D9', who: 'SM Estimation accepts and assigns' },
  { key: 'est', name: 'Estimator', colour: '#C2410C', who: 'Acknowledge, take-off, costing', work: true },
  { key: 'sup', name: 'Suppliers', colour: '#8A6D3B', who: 'Hidden – quotations asked of suppliers until received', hidden: true },
  { key: 'cla', name: 'Sales / client', colour: '#64748B', who: 'Hidden – clarifications asked until answered', hidden: true },
  { key: 'rev', name: 'Review', colour: '#0F766E', who: 'SM Estimation review' },
  { key: 'apr', name: 'Approvals', colour: '#1D4ED8', who: 'DGM, SM Projects, release' },
  { key: 'rwk', name: 'Rework', colour: '#C8102E', who: 'Returned or revision asked – back with the estimator' },
  { key: 'hld', name: 'On hold', colour: '#9CA3AF', who: 'Held – reason recorded' },
];
const CATS = ['From design', 'Direct', 'Revisions'];
const BINS: [string, number, number][] = [['0–2', 0, 2], ['3–5', 3, 5], ['6–8', 6, 8], ['9–12', 9, 12], ['13–20', 13, 20], ['21–30', 21, 30], ['30+', 31, Infinity]];

function map(s: string) {
  switch (s) {
    case 'queued': return { node: 'que', label: 'Waiting acceptance' };
    case 'accepted': return { node: 'que', label: 'Accepted – to assign' };
    case 'assigned': return { node: 'est', label: 'Assigned – to acknowledge' };
    case 'acknowledged': return { node: 'est', label: 'Acknowledged' };
    case 'in_progress': return { node: 'est', label: 'In progress' };
    case 'date_change_requested': return { node: 'est', label: 'New date asked' };
    case 'on_hold': return { node: 'hld', label: 'On hold' };
    case 'submitted_for_approval': return { node: 'rev', label: 'SM Estimation review' };
    case 'gm_approval': return { node: 'apr', label: 'DGM approval' };
    case 'sm_projects_approval': return { node: 'apr', label: 'SM Projects approval' };
    case 'approved': return { node: 'apr', label: 'Approved – to release' };
    case 'returned': return { node: 'rwk', label: 'Returned' };
    case 'revision_requested': return { node: 'rwk', label: 'Revision asked' };
    default: return null;
  }
}

type Job = { id: string; inquiry_id: string; revision: number; source: string; status: string; assignee_id: string | null; due_at: string | null; revised_due_at: string | null; released_at: string | null; created_at: string; supplier_waits: { supplier?: string; requested?: string | null; received?: string | null }[] | null; inquiries: { code: string | null; project_name: string; customer_name: string | null } | null };
type Wait = { start: string | null; end: string | null; label: string };

/** Estimation node report: estimation job to released quotation */
export default function EstimationNodes() {
  const people = usePeople();
  const { data, error } = useLoad(async () => {
    const [{ data: jobs, error: e }, hist, cl, holidays, pk, inv, qs, sup] = await Promise.all([
      supabase.from('estimation_jobs').select('id, inquiry_id, revision, source, status, assignee_id, due_at, revised_due_at, released_at, created_at, supplier_waits, inquiries(code, project_name, customer_name)'),
      historyOf('estimation_job'),
      clarifications(),
      holidaysSet(),
      supabase.from('sq_packages').select('id, source_kind, source_id'),
      supabase.from('sq_package_invites').select('package_id, supplier_id, asked_at'),
      supabase.from('sq_quotes').select('package_id, supplier_id, created_at, revision'),
      supabase.from('sq_suppliers').select('id, name'),
    ]);
    if (e) throw new Error(e.message);
    const now = new Date().toISOString();
    const supName = new Map(((sup.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
    const pkgs = ((pk.data ?? []) as { id: string; source_kind: string | null; source_id: string | null }[]).filter((x) => x.source_kind === 'inquiry');
    const invites = (inv.data ?? []) as { package_id: string; supplier_id: string; asked_at: string }[];
    const quotes = ((qs.data ?? []) as { package_id: string; supplier_id: string; created_at: string; revision: number | null }[]).filter((q) => !q.revision);
    // supplier waits per inquiry: invite → first quote from the Supplier quotes module, else the job's own supplier waits
    const waitsFor = (j: Job): Wait[] => {
      const ps = pkgs.filter((x) => x.source_id === j.inquiry_id).map((x) => x.id);
      const out: Wait[] = [];
      for (const p of ps) {
        const pairs = new Set([...invites.filter((i) => i.package_id === p), ...quotes.filter((q) => q.package_id === p)].map((x) => x.supplier_id));
        for (const s of pairs) {
          const i = invites.find((x) => x.package_id === p && x.supplier_id === s);
          const q = quotes.filter((x) => x.package_id === p && x.supplier_id === s).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
          out.push({ start: i?.asked_at ?? null, end: q?.created_at ?? null, label: supName.get(s) ?? 'Supplier' });
        }
      }
      if (!out.length) for (const w of j.supplier_waits ?? []) out.push({ start: w.requested ?? null, end: w.received ?? null, label: w.supplier ?? 'Supplier' });
      return out;
    };
    return ((jobs ?? []) as unknown as Job[]).map((j): PItem => {
      const h = hist.get(j.id) ?? [];
      let segs: Seg[] = fromHistory(h, j.status, j.created_at, map, holidays, now);
      segs = withClarifications(segs, cl.filter((c) => c.estimation_job_id === j.id), ['est'], 'cla', 'Clarification', holidays, now);
      const firstWork = segs.find((s) => s.node === 'est')?.start ?? j.created_at;
      for (const w of waitsFor(j)) {
        if (!w.start && !w.end) continue;
        const start = w.start ?? firstWork;
        if (w.end && w.end <= start) continue;
        segs = carve(segs, { start, end: w.end, node: 'sup', label: `Quote from ${w.label}`, est: w.start ? undefined : 'start' }, ['est'], holidays, now);
      }
      const due = j.revised_due_at ?? j.due_at;
      return {
        key: j.id,
        code: `${j.inquiries?.code ?? 'Inquiry'} · E${j.revision ? ` R${j.revision}` : ''}`,
        title: j.inquiries?.project_name ?? '',
        project: [j.inquiries?.project_name, j.inquiries?.customer_name].filter(Boolean).join(' · '),
        cat: j.revision > 0 ? 'Revisions' : j.source === 'design' ? 'From design' : 'Direct',
        person: j.assignee_id,
        open: !['released', 'cancelled'].includes(j.status),
        href: `/estimation/${j.id}`,
        segs,
        due: due ? slDay(due) : null,
        done: j.released_at ? slDay(j.released_at) : null,
        returned: h.filter((x) => x.to_status === 'returned' || x.to_status === 'revision_requested').length,
      };
    });
  }, []);
  return (
    <Screen maxWidth={1300}>
      <Stack.Screen options={{ title: 'Estimation node report' }} />
      {!data ? (error ? <ErrorBanner message={error} /> : <Loading />) : (
        <ProcessReport
          intro="Where estimation jobs spend their time, from the queue to the released quotation. Each change of a job's status starts a slice that belongs to a node; days are working days. While a supplier quotation or a clarification is outstanding, the estimator's time counts as waiting on suppliers or on Sales / the client instead – never twice."
          nodes={NODES}
          items={data}
          cats={CATS}
          hiddenKey="sup"
          hidden={{ title: 'Waiting for suppliers (hidden)', goesIn: 'Quotation asked of a supplier', comesOut: 'Supplier quote received', unit: 'supplier quotes', notSeen: 'Not seen – a quote with no request date is timed from when the estimator started; a clarification never answered ends when the job moved on. Shown apart from what we saw.' }}
          bins={BINS}
          personLabel="Estimator"
          personName={(id) => people[id]?.full_name ?? 'Someone'}
          itemWord="Job"
          holdingWord="estimation jobs"
        />
      )}
    </Screen>
  );
}
