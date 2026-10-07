import { router, Stack } from 'expo-router';
import { ReactNode, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtWorkDays, human, inquiryTitle } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isDesigner, isEstimator } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { DesignJob, EstimationJob, Inquiry, SlaClock } from '@/lib/types';
import { STAGE_COLOUR } from '../InquiryBits';
import { DesignHolds } from './DesignHolds';
import { Avatar, Card, colors, Empty, ErrorBanner, Grid, H1, Muted, Pill, Progress, Row, Screen, Section, Segmented, SlaDot, Stat, useWide } from '../ui';

type Colour = 'green' | 'amber' | 'red' | 'grey';

async function clockColours(entityType: string, ids: string[]) {
  if (!ids.length) return {} as Record<string, Colour>;
  const { data } = await supabase.from('sla_clocks').select('entity_id, colour').eq('entity_type', entityType).in('entity_id', ids).is('stopped_at', null);
  const worst: Record<string, Colour> = {};
  const rank = { grey: 0, green: 1, amber: 2, red: 3 } as const;
  for (const c of (data ?? []) as Pick<SlaClock, 'entity_id' | 'colour'>[]) {
    if (!worst[c.entity_id] || rank[c.colour] > rank[worst[c.entity_id]]) worst[c.entity_id] = c.colour;
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Design Board (Design Manager) and My Design Jobs (designer / engineer)
// ---------------------------------------------------------------------------
const DESIGN_COLUMNS = [
  { key: 'queue', label: 'To accept / assign', statuses: [] as string[] },
  { key: 'assigned', label: 'Assigned', statuses: ['assigned', 'acknowledged', 'date_change_requested'] },
  { key: 'progress', label: 'In progress', statuses: ['in_progress', 'returned'] },
  { key: 'hold', label: 'On hold', statuses: ['on_hold'] },
  { key: 'review', label: 'In review', statuses: ['in_review'] },
  { key: 'done', label: 'Approved / released', statuses: ['approved', 'released'] },
];

export function DesignBoard({ header }: { header?: ReactNode } = {}) {
  const me = useMe();
  const people = usePeople();
  const wide = useWide();
  const manager = !isDesigner(me.role);
  const [weekAhead] = useState(() => Date.now() + 7 * 86400000);
  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase.from('design_jobs').select('*, inquiries(code, project_name, inquiry_name, customer_name, customer_deadline, route, status, revision, variation_id)').order('due_at');
    if (!manager) q = q.eq('assignee_id', me.id);
    const [{ data: jobs, error: e }, queue] = await Promise.all([
      q,
      manager
        ? supabase.from('inquiries').select('*').in('status', ['submitted', 'accepted', 'design_approved']).neq('route', 'B').order('customer_deadline')
        : Promise.resolve({ data: [] }),
    ]);
    if (e) throw new Error(e.message);
    const list = (jobs ?? []) as DesignJob[];
    return { jobs: list, queue: (queue.data ?? []) as Inquiry[], colours: await clockColours('design_job', list.map((j) => j.id)) };
  });

  const jobs = data?.jobs ?? [];
  const open = jobs.filter((j) => !['approved', 'released'].includes(j.status));
  const overdue = open.filter((j) => data?.colours[j.id] === 'red').length;
  const dueWeek = open.filter((j) => Date.parse(j.due_at) < weekAhead).length;

  return (
    <Screen refreshing={loading} onRefresh={reload} maxWidth={1600}>
      <Stack.Screen options={{ title: manager ? 'Design Board' : 'My Design Jobs' }} />
      {header}
      <H1>{manager ? 'Design Board' : 'My Design Jobs'}</H1>
      <ErrorBanner message={error} />
      <Section title="Summary">
        <Grid min={160}>
          <Stat label="Open jobs" value={open.length} />
          <Stat label="Due this week" value={dueWeek} tone={dueWeek ? 'amber' : undefined} />
          <Stat label="Overdue" value={overdue} tone={overdue ? 'red' : undefined} />
          <Stat label="In review" value={jobs.filter((j) => j.status === 'in_review').length} />
          {manager ? <Stat label="Waiting to accept / assign / release" value={data?.queue.length ?? 0} /> : <Stat label="Returned for changes" value={jobs.filter((j) => j.status === 'returned').length} tone="amber" />}
        </Grid>
      </Section>

      {manager ? <DesignHolds reloadKey={data} /> : null}

      {manager ? (
        <Section title="Workload by designer">
          <Grid min={220}>
            {Object.values(people)
              .filter((p) => isDesigner(p.role) && p.active)
              .map((p) => {
                const mine = open.filter((j) => j.assignee_id === p.id);
                const red = mine.filter((j) => data?.colours[j.id] === 'red').length;
                return (
                  <Card key={p.id}>
                    <Row>
                      <Avatar name={p.full_name} path={p.avatar_path} ring={red ? 'red' : mine.length ? 'green' : undefined} />
                      <View>
                        <Text style={{ fontWeight: '600' }}>{p.full_name}</Text>
                        <Muted>
                          {mine.length} open · {red} overdue · {fmtWorkDays(mine.reduce((a, j) => a + Number(j.hours_logged), 0))} logged
                        </Muted>
                      </View>
                    </Row>
                  </Card>
                );
              })}
          </Grid>
        </Section>
      ) : null}

      <Section title="Board">
        <ScrollView horizontal={wide} contentContainerStyle={{ gap: 10 }}>
          {DESIGN_COLUMNS.filter((c) => manager || c.key !== 'queue').map((col) => {
            const items = col.key === 'queue' ? [] : jobs.filter((j) => col.statuses.includes(j.status));
            return (
              <View key={col.key} style={{ width: wide ? 280 : '100%', gap: 8, marginBottom: wide ? 0 : 12 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', color: colors.muted }}>{col.label}</Text>
                  <Pill label={String(col.key === 'queue' ? data?.queue.length ?? 0 : items.length)} />
                </Row>
                {col.key === 'queue'
                  ? (data?.queue ?? []).map((i) => (
                      <Card key={i.id} onPress={() => router.push(`/inquiries/${i.id}`)}>
                        <Text style={{ fontWeight: '700' }}>{i.code}</Text>
                        <Muted numberOfLines={1}>{inquiryTitle(i)}</Muted>
                        <Pill label={human(i.status)} tone={colors.blue} />
                        <Muted>Customer deadline {fmtDate(i.customer_deadline)}</Muted>
                      </Card>
                    ))
                  : items.map((j) => <JobCard key={j.id} job={j} colour={data?.colours[j.id] ?? (j.status === 'on_hold' ? 'grey' : 'green')} assignee={people[j.assignee_id ?? '']?.full_name} kind="design" />)}
                {col.key !== 'queue' && !items.length ? <Muted>—</Muted> : null}
              </View>
            );
          })}
        </ScrollView>
      </Section>
    </Screen>
  );
}

function JobCard({
  job,
  colour,
  assignee,
  kind,
}: {
  job: DesignJob | EstimationJob;
  colour: Colour;
  assignee?: string;
  kind: 'design' | 'estimation';
}) {
  const inq = job.inquiries;
  const pct = 'progress_pct' in job ? job.progress_pct : undefined;
  return (
    <Card onPress={() => router.push(`/${kind}/${job.id}`)} style={{ borderLeftWidth: 4, borderLeftColor: STAGE_COLOUR[colour] }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6}>
          <SlaDot colour={colour} />
          <Text style={{ fontWeight: '700' }}>
            {inq?.code}
            {job.revision ? `-R${job.revision}` : ''}
          </Text>
        </Row>
        {'task_type' in job ? (
          <Row gap={4}>
            <Pill label={job.task_type} />
            <Pill label={`Rev ${job.review_cycles}`} tone={job.review_cycles ? colors.amber : undefined} />
          </Row>
        ) : (
          <Pill label={job.source} />
        )}
      </Row>
      <Muted numberOfLines={1}>{inquiryTitle(inq)}</Muted>
      {inq && 'variation_id' in inq && inq.variation_id ? <Pill label="Variation" tone={colors.amber} solid /> : null}
      {pct != null ? (
        <View style={{ marginVertical: 6 }}>
          <Progress pct={pct} colour={STAGE_COLOUR[colour]} />
        </View>
      ) : null}
      <Muted>
        Due {fmtDateTime(job.due_at)}
        {assignee ? ` · ${assignee}` : ''}
      </Muted>
      <Muted>{human(job.status)}</Muted>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Estimation Board (SM Estimation) and My Estimates (estimators)
// ---------------------------------------------------------------------------
export function EstimationBoard({ header }: { header?: ReactNode } = {}) {
  const me = useMe();
  const people = usePeople();
  const manager = !isEstimator(me.role);
  const [tab, setTab] = useState<'queue' | 'open' | 'approval' | 'released'>(manager ? 'queue' : 'open');
  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase
      .from('estimation_jobs')
      .select('*, inquiries(code, project_name, inquiry_name, customer_name, customer_deadline, route, status, duty_status, currency, project_type, revision, debtor_flag, variation_id)')
      .order('due_at', { nullsFirst: true });
    if (!manager) q = q.eq('assignee_id', me.id);
    const [{ data: jobs, error: e }, direct] = await Promise.all([
      q,
      manager ? supabase.from('inquiries').select('*').eq('route', 'B').eq('status', 'submitted').order('customer_deadline') : Promise.resolve({ data: [] }),
    ]);
    if (e) throw new Error(e.message);
    const list = (jobs ?? []) as EstimationJob[];
    return { jobs: list, direct: (direct.data ?? []) as Inquiry[], colours: await clockColours('estimation_job', list.map((j) => j.id)) };
  });
  const jobs = data?.jobs ?? [];
  const groups = {
    queue: jobs.filter((j) => ['queued', 'accepted', 'revision_requested'].includes(j.status)),
    open: jobs.filter((j) => ['assigned', 'acknowledged', 'date_change_requested', 'in_progress', 'returned', 'on_hold'].includes(j.status)),
    approval: jobs.filter((j) => ['submitted_for_approval', 'gm_approval', 'sm_projects_approval', 'approved'].includes(j.status)),
    released: jobs.filter((j) => j.status === 'released'),
  };
  const overdue = [...groups.open, ...groups.approval].filter((j) => data?.colours[j.id] === 'red').length;
  const list = groups[tab];

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: manager ? 'Estimation Board' : 'My Estimates' }} />
      {header}
      <H1>{manager ? 'Estimation Board' : 'My Estimates'}</H1>
      <ErrorBanner message={error} />
      <Section title="Summary">
        <Grid min={160}>
          <Stat label="Queue (design / direct)" value={`${groups.queue.filter((j) => j.source === 'design').length} / ${groups.queue.filter((j) => j.source === 'direct').length + (data?.direct.length ?? 0)}`} />
          <Stat label="In progress" value={groups.open.length} />
          <Stat label="Overdue" value={overdue} tone={overdue ? 'red' : undefined} />
          <Stat label="Approval pending" value={groups.approval.length} tone={groups.approval.length ? 'amber' : undefined} />
          <Stat label="Supplier price waits" value={groups.open.reduce((a, j) => a + (j.supplier_waits ?? []).filter((w) => !w.received).length, 0)} />
        </Grid>
      </Section>
      {manager ? (
        <Section title="Workload">
          <Grid min={220}>
            {Object.values(people)
              .filter((p) => isEstimator(p.role) && p.active)
              .map((p) => {
                const mine = groups.open.filter((j) => j.assignee_id === p.id);
                const red = mine.filter((j) => data?.colours[j.id] === 'red').length;
                return (
                  <Card key={p.id}>
                    <Row>
                      <Avatar name={p.full_name} path={p.avatar_path} ring={red ? 'red' : 'green'} />
                      <View>
                        <Text style={{ fontWeight: '600' }}>{p.full_name}</Text>
                        <Muted>
                          {mine.length} open · {red} overdue
                        </Muted>
                      </View>
                    </Row>
                  </Card>
                );
              })}
          </Grid>
        </Section>
      ) : null}
      <Section title="Jobs">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            ...(manager ? [{ value: 'queue' as const, label: 'Queue', badge: groups.queue.length + (data?.direct.length ?? 0) }] : []),
            { value: 'open', label: 'In progress', badge: groups.open.length },
            { value: 'approval', label: 'Approval', badge: groups.approval.length },
            { value: 'released', label: 'Released' },
          ]}
        />
        <View style={{ gap: 8, marginTop: 8 }}>
          {tab === 'queue'
            ? (data?.direct ?? []).map((i) => (
                <Card key={i.id} onPress={() => router.push(`/inquiries/${i.id}`)}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '700' }}>{i.code}</Text>
                    <Pill label="Direct – accept" tone={colors.blue} />
                  </Row>
                  <Muted>{inquiryTitle(i)}</Muted>
                  <Muted>Customer deadline {fmtDate(i.customer_deadline)}</Muted>
                </Card>
              ))
            : null}
          {list.map((j) => (
            <JobCard key={j.id} job={j} kind="estimation" colour={data?.colours[j.id] ?? (j.status === 'on_hold' ? 'grey' : 'green')} assignee={people[j.assignee_id ?? '']?.full_name} />
          ))}
          {!list.length && !(tab === 'queue' && data?.direct.length) ? <Empty title="Nothing here" /> : null}
        </View>
      </Section>
    </Screen>
  );
}
