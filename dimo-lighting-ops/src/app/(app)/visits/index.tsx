import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, Grid, ListRow, Pill, Row, Screen, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { useOfflineSync } from '@/lib/offline';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { Visit } from '@/lib/types';

type Filter = 'all' | 'open' | 'tender' | 'unplanned' | 'review' | 'actions';

/** Where a next action stands: done (on which day), overdue, due today, due within a week, or later */
function actionState(v: Visit) {
  const t = todayISO(), d = v.next_action_date as string;
  if (v.next_action_done_at) return { k: 'done', label: `Done ${fmtDate(v.next_action_done_at)}`, tone: colors.green };
  if (d < t) return { k: 'overdue', label: `Overdue ${Math.round((Date.parse(`${t}T00:00:00`) - Date.parse(`${d}T00:00:00`)) / 86400000)} d`, tone: colors.red };
  if (d === t) return { k: 'due', label: 'Due today', tone: colors.amber };
  return { k: d <= addDaysISO(t, 7) ? 'week' : 'later', label: d <= addDaysISO(t, 7) ? 'This week' : 'Upcoming', tone: colors.blue };
}

export default function Visits() {
  const me = useMe();
  const people = usePeople();
  const offline = useOfflineSync();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [filter, setFilter] = useState<Filter>(params.tab === 'actions' ? 'actions' : 'all');
  const { data, error, loading, reload } = useLoad(async () => {
    if (filter === 'actions') {
      const { data: rows, error: e } = await supabase.from('visits').select('*, organizations(name), projects(name)').not('next_action_date', 'is', null).order('next_action_date', { ascending: false }).limit(400);
      if (e) throw new Error(e.message);
      // still open first (oldest due on top), then the done ones (latest first)
      const list = rows as Visit[];
      return [...list.filter((v) => !v.next_action_done_at).reverse(), ...list.filter((v) => v.next_action_done_at)];
    }
    let q = supabase.from('visits').select('*, organizations(name), projects(name)').order('checkin_at', { ascending: false }).limit(200);
    if (filter === 'open') q = q.eq('status', 'open');
    if (filter === 'tender') q = q.eq('visit_type', 'tender');
    if (filter === 'unplanned') q = q.eq('unplanned', true);
    if (filter === 'review') q = q.is('reviewed_at', null).eq('status', 'closed');
    const { data: rows, error: e } = await q;
    if (e) throw new Error(e.message);
    return rows as Visit[];
  }, [filter]);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Visits' }} />
      <Row wrap style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Report not saved' },
            { value: 'tender', label: 'Tender visits' },
            { value: 'unplanned', label: 'Unplanned' },
            { value: 'actions', label: 'Next actions' },
            ...(isSales(me.role) ? [] : [{ value: 'review' as const, label: 'To review' }]),
          ]}
        />
        {isSales(me.role) ? <Button title="Check in" icon="◎" onPress={() => router.push('/visits/new')} /> : null}
      </Row>
      {offline.pending ? <Pill label={`${offline.pending} waiting to sync`} tone={colors.amber} /> : null}
      <ErrorBanner message={error} />
      {filter === 'actions' && data ? (() => {
        const st = data.map(actionState), month = addDaysISO(todayISO(), -30);
        return (
          <Grid min={140}>
            <Stat label="Overdue" value={st.filter((x) => x.k === 'overdue').length} tone={st.some((x) => x.k === 'overdue') ? 'red' : undefined} />
            <Stat label="Due today" value={st.filter((x) => x.k === 'due').length} tone={st.some((x) => x.k === 'due') ? 'amber' : undefined} />
            <Stat label="Next 7 days" value={st.filter((x) => x.k === 'week').length} />
            <Stat label="Done – last 30 days" value={data.filter((v) => v.next_action_done_at && v.next_action_done_at.slice(0, 10) >= month).length} tone="green" />
          </Grid>
        );
      })() : null}
      {filter === 'actions' ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {(data ?? []).map((v) => {
            const s = actionState(v);
            return (
              <ListRow
                key={v.id}
                title={v.next_action || 'Follow-up (no description)'}
                subtitle={`${v.organizations?.name ?? ''}${v.projects?.name ? ` · ${v.projects.name}` : ''} · due ${fmtDate(v.next_action_date)} · from ${v.code ?? 'visit'} ${fmtDate(v.checkin_at)}${isSales(me.role) ? '' : ` · ${people[v.sales_person_id]?.full_name ?? ''}`}`}
                highlight={s.k === 'overdue' ? colors.red : undefined}
                wrapRight
                right={
                  <Row gap={6}>
                    <Pill label={s.label} tone={s.tone} />
                    {!v.next_action_done_at && v.sales_person_id === me.id ? (
                      <Button
                        small
                        variant="secondary"
                        title="Done"
                        onPress={() =>
                          dialog.run(async () => {
                            const { error: e } = await supabase.from('visits').update({ next_action_done_at: new Date().toISOString() }).eq('id', v.id);
                            if (e) throw new Error(e.message);
                            await reload();
                          }, 'Marked done')
                        }
                      />
                    ) : null}
                  </Row>
                }
                onPress={() => router.push(`/visits/${v.id}`)}
              />
            );
          })}
          {data && !data.length ? <Empty title="No next actions" hint="Next actions written in visit reports appear here." /> : null}
        </Card>
      ) : (
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data ?? []).map((v) => (
          <ListRow
            key={v.id}
            title={`${v.organizations?.name ?? ''}${v.projects?.name ? ` · ${v.projects.name}` : ''}`}
            subtitle={`${v.code ?? 'Syncing…'} · ${fmtDateTime(v.checkin_at)} · ${v.primary_objective}${isSales(me.role) ? '' : ` · ${people[v.sales_person_id]?.full_name ?? ''}`}`}
            highlight={v.status === 'open' ? colors.amber : v.gps_verified === false ? colors.red : undefined}
            right={
              <Row gap={4}>
                {v.visit_type === 'tender' ? <Pill label="Tender" tone={colors.blue} /> : null}
                {v.unplanned ? <Pill label="Unplanned" /> : null}
                {v.gps_verified === false ? <Pill label="GPS review" tone={colors.red} /> : null}
                {v.status === 'open' ? <Pill label="Report due" tone={colors.amber} /> : v.outcome ? <Pill label={v.outcome} /> : null}
              </Row>
            }
            onPress={() => router.push(`/visits/${v.id}`)}
          />
        ))}
        {data && !data.length ? <Empty title="No visits" hint="Visits you check in to appear here." /> : null}
      </Card>
      )}
    </Screen>
  );
}
