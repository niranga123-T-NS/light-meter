import { router, Stack } from 'expo-router';
import { Text } from 'react-native';
import { TargetCard } from '@/components/TargetCharts';
import { useMe } from '@/lib/auth';
import { fyOf, type Performance } from '@/lib/finance';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { daysFrom, retentionStage } from '@/lib/retentions';
import { useOfflineSync } from '@/lib/offline';
import { rpc, supabase } from '@/lib/supabase';
import type { Retention } from '@/lib/types';
import { Button, Card, colors, Empty, ErrorBanner, Grid, H1, ListRow, Muted, Notice, Pill, Row, Screen, Section, Stat } from '../ui';

type MyDay = {
  planned_today: {
    id: string;
    plan_id: string;
    time_slot: string | null;
    organization: string;
    project: string | null;
    objective: string;
    category: string;
    status: string;
    visit_type: string;
  }[];
  next_actions: { id: string; code: string; next_action: string; date: string; organization: string }[];
  open_visits: number;
  pending_design: number;
  pending_estimation: number;
  delayed: number;
  awaiting_follow_up: number;
  dormant_projects: { id: string; name: string; since: string }[];
  probability_review_due: { id: string; name: string; probability: number }[];
  first_visits_due: { id: string; name: string; due: string }[];
  plan_next_week: string | null;
  visits_this_week: number;
  debts: { count: number; over_90: number; lkr: number; usd: number };
  samples_overdue: number;
};

/** "My Day" – the sales person's home (Section 9). */
export function SalesHome() {
  const me = useMe();
  const { data, error, loading, reload } = useLoad(() => rpc<MyDay>('my_day'));
  const offline = useOfflineSync();
  // My retentions that need action: due and not claimed, due within 60 days, or claimed and unpaid for 60+ days
  const ret = useLoad(async () => {
    const { data: rows } = await supabase.from('retentions').select('*').eq('sales_person_id', me.id).in('status', ['held', 'claimed']);
    return (rows ?? []) as Retention[];
  }, [me.id]);
  // My invoicing / secured against target (from the monthly OR file)
  const perf = useLoad(() => rpc<Performance>('finance_performance', { p_fy: fyOf(todayISO()) }).catch(() => null), []);
  const myPerf = perf.data?.people.find((x) => x.id === me.id);
  const retAction = (ret.data ?? [])
    .map((r) => ({ r, st: retentionStage(r) }))
    .filter((x) => x.st === 'due' || x.st === 'due_soon' || x.st === 'claim_overdue')
    .sort((a, b) => a.r.due_date.localeCompare(b.r.due_date));
  const retDue = retAction.filter((x) => x.st === 'due');
  const sumText = (list: { r: Retention }[]) =>
    (['LKR', 'USD'] as const)
      .map((c) => [c, list.filter((x) => x.r.currency === c).reduce((a, x) => a + Number(x.r.retention_value), 0)] as const)
      .filter(([, v]) => v > 0)
      .map(([c, v]) => fmtMoney(v, c))
      .join(' + ');

  return (
    <Screen refreshing={loading} onRefresh={() => { reload(); ret.reload(); perf.reload(); }}>
      <Stack.Screen options={{ title: 'My Day' }} />
      <H1>Good day, {me.full_name.split(' ')[0]}</H1>
      <ErrorBanner message={error} />
      {offline.pending ? (
        <Notice tone={colors.amber}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text>{offline.pending} visit(s) saved offline, waiting to sync.</Text>
            <Button small title="Sync now" onPress={async () => { await offline.sync(); reload(); }} />
          </Row>
        </Notice>
      ) : null}
      {data && data.plan_next_week !== 'submitted' && data.plan_next_week !== 'approved' ? (
        <Notice tone={colors.amber}>Next week&apos;s visit plan is not submitted yet – due Saturday 13:00.</Notice>
      ) : null}

      {retDue.length ? (
        <Notice tone={colors.red}>{`Retentions due – claim now: ${retDue.length} · ${sumText(retDue)}`}</Notice>
      ) : null}

      <Row wrap gap={8} style={{ marginTop: 12 }}>
        <Button title="Check in to a visit" icon="◎" onPress={() => router.push('/visits/new')} />
        <Button title="New inquiry" variant="secondary" onPress={() => router.push('/inquiries/new')} />
        <Button title="Weekly plan" variant="secondary" onPress={() => router.push('/plan')} />
      </Row>

      {myPerf ? (
        <Section title="My target" right={<Button small variant="ghost" title="Details" onPress={() => router.push('/finance/my')} />}>
          <TargetCard p={myPerf} upTo={perf.data?.latest_month ?? null} />
        </Section>
      ) : null}

      {data ? (
        <>
          <Section title="At a glance">
            <Grid min={170}>
              <Stat label="Visits this week" value={data.visits_this_week} onPress={() => router.push('/visits')} />
              <Stat label="Pending designs" value={data.pending_design} onPress={() => router.push('/inquiries?tab=design')} />
              <Stat label="Pending estimations" value={data.pending_estimation} onPress={() => router.push('/inquiries?tab=estimation')} />
              <Stat label="Delayed" value={data.delayed} tone={data.delayed ? 'red' : undefined} onPress={() => router.push('/inquiries?tab=delayed')} />
              <Stat label="Awaiting follow-up" value={data.awaiting_follow_up} onPress={() => router.push('/inquiries?tab=follow_up')} />
              <Stat
                label={`Open debts (${data.debts.over_90} over 90 days)`}
                value={data.debts.count}
                tone={data.debts.over_90 ? 'amber' : undefined}
                onPress={() => router.push('/debtors')}
              />
            </Grid>
          </Section>

          {retAction.length ? (
            <Section title="Retentions to act on" right={<Button small variant="ghost" title="All retentions" onPress={() => router.push('/retentions?tab=due')} />}>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {retAction.map(({ r, st }) => (
                  <ListRow
                    key={r.id}
                    wrapRight
                    highlight={st === 'due' || st === 'claim_overdue' ? colors.red : colors.amber}
                    title={`${r.project_name} · ${r.end_client}`}
                    subtitle={
                      st === 'claim_overdue'
                        ? `Claimed ${fmtDate(r.claimed_on)} – not paid for ${daysFrom(r.claimed_on as string, todayISO())} days · follow up`
                        : st === 'due'
                          ? `Due ${fmtDate(r.due_date)} – claim it now`
                          : `Due ${fmtDate(r.due_date)} · in ${daysFrom(todayISO(), r.due_date)} days`
                    }
                    right={
                      <Row gap={6} wrap>
                        <Pill label={fmtMoney(r.retention_value, r.currency)} />
                        <Pill
                          label={st === 'due' ? 'Due – not claimed' : st === 'claim_overdue' ? 'Claimed > 60 days' : 'Due within 60 days'}
                          tone={st === 'due_soon' ? colors.amber : colors.red}
                          solid
                        />
                      </Row>
                    }
                    onPress={() => router.push(`/retentions/${r.id}`)}
                  />
                ))}
              </Card>
            </Section>
          ) : null}

          <Section title="Today's planned visits">
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {data.planned_today.map((l) => (
                <ListRow
                  key={l.id}
                  title={`${l.time_slot ? `${l.time_slot} · ` : ''}${l.organization}`}
                  subtitle={`${l.objective} · ${l.category}${l.project ? ` · ${l.project}` : ''}`}
                  right={
                    l.status === 'completed' ? (
                      <Pill label="Done" tone={colors.green} />
                    ) : (
                      <Button small title="Check in" onPress={() => router.push(`/visits/new?planLine=${l.id}`)} />
                    )
                  }
                />
              ))}
              {!data.planned_today.length ? <Empty title="No planned visits today" /> : null}
            </Card>
          </Section>

          {data.open_visits ? (
            <Notice tone={colors.red}>
              {data.open_visits} visit report(s) not saved yet. Save the report the same day, by 20:00.{' '}
            </Notice>
          ) : null}

          <Section title="Next actions due">
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {data.next_actions.map((a) => (
                <ListRow key={a.id} title={a.next_action} subtitle={`${a.organization} · ${fmtDate(a.date)}`} onPress={() => router.push(`/visits/${a.id}`)} />
              ))}
              {!data.next_actions.length ? <Muted style={{ padding: 12 }}>Nothing due</Muted> : null}
            </Card>
          </Section>

          {data.first_visits_due.length ? (
            <Section title="New projects assigned – first visit">
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.first_visits_due.map((p) => (
                  <ListRow key={p.id} title={p.name} subtitle={`First visit due ${fmtDate(p.due)}`} onPress={() => router.push(`/projects/${p.id}`)} />
                ))}
              </Card>
            </Section>
          ) : null}

          {data.dormant_projects.length ? (
            <Section title="Dormant projects – review within 5 working days">
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.dormant_projects.map((p) => (
                  <ListRow key={p.id} title={p.name} subtitle={`Dormant since ${fmtDate(p.since)}`} highlight={colors.amber} onPress={() => router.push(`/projects/${p.id}`)} />
                ))}
              </Card>
            </Section>
          ) : null}

          {data.probability_review_due.length ? (
            <Section title="Win probability not reviewed in 30 days">
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.probability_review_due.map((p) => (
                  <ListRow key={p.id} title={p.name} right={<Pill label={`${p.probability}%`} />} onPress={() => router.push(`/projects/${p.id}`)} />
                ))}
              </Card>
            </Section>
          ) : null}

          {data.samples_overdue ? (
            <Notice tone={colors.red}>{data.samples_overdue} sample(s) overdue for return.</Notice>
          ) : null}
          {data.debts.count ? (
            <Muted style={{ marginTop: 8 }}>
              Outstanding: {fmtMoney(data.debts.lkr, 'LKR')} · {fmtMoney(data.debts.usd, 'USD')}
            </Muted>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
