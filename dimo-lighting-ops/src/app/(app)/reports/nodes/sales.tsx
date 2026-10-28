import { Stack } from 'expo-router';
import { ProcessReport } from '@/components/ProcessReport';
import { ErrorBanner, Loading, Screen } from '@/components/ui';
import { useLoad, usePeople } from '@/lib/hooks';
import { fromHistory, slDay, type PItem, type PNode } from '@/lib/processNodes';
import { clarifications, historyOf, holidaysSet, withClarifications } from '@/lib/processSources';
import { supabase } from '@/lib/supabase';

const NODES: PNode[] = [
  { key: 'sal', name: 'Sales', colour: '#C8102E', who: 'Raising, returned for info, sending the quotation' },
  { key: 'int', name: 'Intake', colour: '#6D28D9', who: 'Accept and assign – Design Manager, SM Estimation' },
  { key: 'des', name: 'Design', colour: '#0F766E', who: 'Design to approved design' },
  { key: 'est', name: 'Estimation', colour: '#C2410C', who: 'Estimation to submitted cost', work: true },
  { key: 'apr', name: 'Approvals', colour: '#1D4ED8', who: 'SM Estimation review, DGM, SM Projects' },
  { key: 'cli', name: 'Client', colour: '#64748B', who: 'Hidden – quotation with the client until a decision; clarifications', hidden: true },
  { key: 'hld', name: 'On hold', colour: '#9CA3AF', who: 'Held by the client or by us' },
];
const CATS = ['With design', 'Estimation only', 'Revisions', 'Tenders'];
const BINS: [string, number, number][] = [['0–5', 0, 5], ['6–10', 6, 10], ['11–20', 11, 20], ['21–30', 21, 30], ['31–45', 31, 45], ['46–60', 46, 60], ['60+', 61, Infinity]];
const DECIDED = ['won', 'lost', 'cancelled', 'rejected'];
const WITH_CLIENT = ['submitted_to_client', 'awaiting_client_approval', 'under_evaluation', 'client_approved'];

function map(s: string, next?: string) {
  switch (s) {
    case 'draft': return { node: 'sal', label: 'Being raised' };
    case 'returned_for_info': return { node: 'sal', label: 'Returned for information' };
    case 'returned_to_sales': return { node: 'sal', label: 'Returned to Sales' };
    case 'submitted': return { node: 'int', label: 'Waiting acceptance' };
    case 'accepted': return { node: 'int', label: 'Accepted – assigning' };
    case 'in_design': return { node: 'des', label: 'In design' };
    case 'design_review': return { node: 'des', label: 'Design review' };
    case 'design_approved': return { node: 'est', label: 'Design approved – estimation' };
    case 'in_estimation': return { node: 'est', label: 'In estimation' };
    case 'estimation_review': return { node: 'apr', label: 'Estimation review and approvals' };
    case 'quotation_released':
      return next && (DECIDED.includes(next) || WITH_CLIENT.slice(1).includes(next))
        ? { node: 'cli', label: 'With the client – submission not recorded', est: 'start' as const }
        : { node: 'sal', label: 'Quotation released – to send' };
    case 'on_hold': return { node: 'hld', label: 'On hold' };
    default: return WITH_CLIENT.includes(s) ? { node: 'cli', label: 'Quotation with the client' } : null;
  }
}

type Inq = { id: string; code: string | null; project_name: string; inquiry_name: string | null; customer_name: string | null; sales_person_id: string | null; status: string; route: string | null; revision: number; submission_type: string | null; tender_group_id: string | null; created_at: string; quotation_released_at: string | null; quotation_required_by: string | null; customer_deadline: string | null };

/** Sales node report: inquiry to the client's decision */
export default function SalesNodes() {
  const people = usePeople();
  const { data, error } = useLoad(async () => {
    const [{ data: inq, error: e }, hist, cl, holidays] = await Promise.all([
      supabase.from('inquiries').select('id, code, project_name, inquiry_name, customer_name, sales_person_id, status, route, revision, submission_type, tender_group_id, created_at, quotation_released_at, quotation_required_by, customer_deadline'),
      historyOf('inquiry'),
      clarifications(),
      holidaysSet(),
    ]);
    if (e) throw new Error(e.message);
    const now = new Date().toISOString();
    return ((inq ?? []) as Inq[]).filter((i) => i.status !== 'draft' || (hist.get(i.id) ?? []).length).map((i): PItem => {
      const h = hist.get(i.id) ?? [];
      let segs = fromHistory(h, i.status, i.created_at, map, holidays, now);
      segs = withClarifications(segs, cl.filter((c) => c.inquiry_id === i.id), ['des', 'est', 'apr'], 'cli', 'Clarification', holidays, now);
      const due = i.quotation_required_by ?? i.customer_deadline;
      return {
        key: i.id,
        code: i.code ?? 'Inquiry',
        title: i.inquiry_name ?? i.project_name,
        project: [i.project_name, i.customer_name].filter(Boolean).join(' · '),
        cat: i.submission_type === 'tender' || i.tender_group_id ? 'Tenders' : i.revision > 0 ? 'Revisions' : i.route === 'A' ? 'With design' : 'Estimation only',
        person: i.sales_person_id,
        open: !DECIDED.includes(i.status),
        href: `/inquiries/${i.id}`,
        segs,
        due: due ? slDay(due) : null,
        done: i.quotation_released_at ? slDay(i.quotation_released_at) : null,
        returned: h.filter((x) => x.to_status === 'returned_for_info' || x.to_status === 'returned_to_sales').length,
      };
    });
  }, []);
  return (
    <Screen maxWidth={1300}>
      <Stack.Screen options={{ title: 'Sales node report' }} />
      {!data ? (error ? <ErrorBanner message={error} /> : <Loading />) : (
        <ProcessReport
          title="Sales node report"
          reportKey="node_report_sales"
          intro="Where inquiries spend their time, from being raised to the client's decision. Each change of an inquiry's status starts a slice that belongs to a node; days are working days. Once the quotation goes to the client we only see the decision, so that time is one block. Clarifications asked of Sales or the client during design and estimation count as client time."
          nodes={NODES}
          items={data}
          cats={CATS}
          hiddenKey="cli"
          hidden={{ title: 'With the client (hidden)', goesIn: 'Quotation submitted to the client, or a clarification asked', comesOut: 'Won, lost, revision asked, or the answer', unit: 'waits', notSeen: 'Not seen – a quotation released with no submission date is timed from its release; a clarification never answered ends when the work moved on. Shown apart from what we saw.' }}
          bins={BINS}
          personLabel="Sales person"
          personName={(id) => people[id]?.full_name ?? 'Someone'}
          itemWord="Inquiry"
          holdingWord="inquiries"
        />
      )}
    </Screen>
  );
}
