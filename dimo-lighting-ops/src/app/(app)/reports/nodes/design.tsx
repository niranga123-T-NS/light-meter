import { Stack } from 'expo-router';
import { ProcessReport } from '@/components/ProcessReport';
import { ErrorBanner, Loading, Screen } from '@/components/ui';
import { useLoad, usePeople } from '@/lib/hooks';
import { fromHistory, slDay, type PItem, type PNode } from '@/lib/processNodes';
import { clarifications, historyOf, holidaysSet, withClarifications } from '@/lib/processSources';
import { supabase } from '@/lib/supabase';

const NODES: PNode[] = [
  { key: 'ack', name: 'Acknowledge', colour: '#6D28D9', who: 'Assigned by the Design Manager, not yet acknowledged' },
  { key: 'dsg', name: 'Designer', colour: '#0F766E', who: 'Design, drawings, calculations', work: true },
  { key: 'inf', name: 'Sales / client', colour: '#64748B', who: 'Hidden – information asked until it comes back', hidden: true },
  { key: 'dch', name: 'Date change', colour: '#C2410C', who: 'New date asked until the Design Manager decides' },
  { key: 'rev', name: 'Review', colour: '#1D4ED8', who: 'Design Manager review, approval and release' },
  { key: 'rwk', name: 'Rework', colour: '#C8102E', who: 'Returned by review – back with the designer' },
  { key: 'hld', name: 'On hold', colour: '#9CA3AF', who: 'Held – reason recorded' },
];
const CATS = ['Lighting calc', 'Electrical', 'Revisions'];
const BINS: [string, number, number][] = [['0–1', 0, 1], ['2–3', 2, 3], ['4–5', 4, 5], ['6–8', 6, 8], ['9–12', 9, 12], ['13–20', 13, 20], ['20+', 21, Infinity]];

function map(s: string) {
  switch (s) {
    case 'assigned': return { node: 'ack', label: 'Assigned – to acknowledge' };
    case 'acknowledged': return { node: 'dsg', label: 'Acknowledged' };
    case 'in_progress': return { node: 'dsg', label: 'In progress' };
    case 'date_change_requested': return { node: 'dch', label: 'New date asked' };
    case 'in_review': return { node: 'rev', label: 'In review' };
    case 'approved': return { node: 'rev', label: 'Approved – to release' };
    case 'returned': return { node: 'rwk', label: 'Returned by review' };
    case 'on_hold': return { node: 'hld', label: 'On hold' };
    default: return null;
  }
}

type Job = { id: string; revision: number; task_type: string; status: string; assignee_id: string | null; due_at: string | null; revised_due_at: string | null; released_at: string | null; created_at: string; inquiries: { code: string | null; project_name: string; customer_name: string | null } | null };

/** Design node report: design job to released design */
export default function DesignNodes() {
  const people = usePeople();
  const { data, error } = useLoad(async () => {
    const [{ data: jobs, error: e }, hist, cl, holidays] = await Promise.all([
      supabase.from('design_jobs').select('id, revision, task_type, status, assignee_id, due_at, revised_due_at, released_at, created_at, inquiries(code, project_name, customer_name)'),
      historyOf('design_job'),
      clarifications(),
      holidaysSet(),
    ]);
    if (e) throw new Error(e.message);
    const now = new Date().toISOString();
    return ((jobs ?? []) as unknown as Job[]).map((j): PItem => {
      const h = hist.get(j.id) ?? [];
      let segs = fromHistory(h, j.status, j.created_at, map, holidays, now);
      segs = withClarifications(segs, cl.filter((c) => c.design_job_id === j.id), ['dsg'], 'inf', 'Information asked', holidays, now);
      const due = j.revised_due_at ?? j.due_at;
      return {
        key: j.id,
        code: `${j.inquiries?.code ?? 'Inquiry'} · D${j.revision ? ` R${j.revision}` : ''}`,
        title: j.inquiries?.project_name ?? '',
        project: [j.inquiries?.project_name, j.inquiries?.customer_name].filter(Boolean).join(' · '),
        cat: j.revision > 0 ? 'Revisions' : j.task_type === 'electrical' ? 'Electrical' : 'Lighting calc',
        person: j.assignee_id,
        open: !['released', 'cancelled'].includes(j.status),
        href: `/design/${j.id}`,
        segs,
        due: due ? slDay(due) : null,
        done: j.released_at ? slDay(j.released_at) : null,
        returned: h.filter((x) => x.to_status === 'returned').length,
      };
    });
  }, []);
  return (
    <Screen maxWidth={1300}>
      <Stack.Screen options={{ title: 'Design node report' }} />
      {!data ? (error ? <ErrorBanner message={error} /> : <Loading />) : (
        <ProcessReport
          title="Design node report"
          reportKey="node_report_design"
          intro="Where design jobs spend their time, from assignment to the released design. Each change of a job's status starts a slice that belongs to a node; days are working days. While the designer waits for information from Sales or the client, that time counts as Sales / client instead of the designer."
          nodes={NODES}
          items={data}
          cats={CATS}
          hiddenKey="inf"
          hidden={{ title: 'Waiting for information (hidden)', goesIn: 'Clarification asked by the designer', comesOut: 'Answer recorded', unit: 'clarifications', notSeen: 'Not seen – a question never answered in the app ends when the job moved on (to review, a date change or release). Shown apart from what we saw.' }}
          bins={BINS}
          personLabel="Designer"
          personName={(id) => people[id]?.full_name ?? 'Someone'}
          itemWord="Job"
          holdingWord="design jobs"
        />
      )}
    </Screen>
  );
}
