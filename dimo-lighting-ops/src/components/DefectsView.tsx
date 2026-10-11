import { router, Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Button, Card, Empty, ErrorBanner, Grid, ListRow, Muted, Pill, Row, Screen, Segmented, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { DEFECT_LOGGERS, DEFECT_MANAGERS, DEFECT_OPEN, DEFECT_STATUS, PHASE, severityTone, type Defect } from '@/lib/defects';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';

type Filter = 'mine' | 'open' | 'closed' | 'all';

/** Project defects: reported by sales, logged by SM Projects / the SEE / AEs, verified, assigned, rectified and closed. */
export function DefectsView({ header }: { header?: ReactNode }) {
  const me = useMe();
  const people = usePeople();
  const sales = isSales(me.role);
  const manager = DEFECT_MANAGERS.includes(me.role);
  const [filter, setFilter] = useState<Filter>(manager || me.role === 'assistant_engineer' ? 'mine' : 'open');
  const [project, setProject] = useState('');
  const today = todayISO();
  const { data, error, loading, reload } = useLoad(async () => {
    const r = await supabase.from('project_defects').select('*').order('reported_at', { ascending: false }).limit(2000);
    if (r.error) throw new Error(r.error.message);
    return (r.data ?? []) as Defect[];
  });
  const all = (data ?? []).filter((d) => !project || d.project_name === project);
  const late = (d: Defect) => d.status === 'assigned' && !!d.due_date && d.due_date < today;
  // Waiting for me: verify / assign / check (managers), rectify (the engineer)
  const waiting = (d: Defect) =>
    (manager && ['reported', 'open', 'rectified'].includes(d.status)) || (d.status === 'assigned' && d.assignee_id === me.id) || (sales && d.reported_by === me.id && DEFECT_OPEN.includes(d.status));
  const rows = all
    .filter((d) => (filter === 'mine' ? waiting(d) : filter === 'open' ? DEFECT_OPEN.includes(d.status) : filter === 'closed' ? !DEFECT_OPEN.includes(d.status) : true))
    .sort((a, b) => Number(late(b)) - Number(late(a)) || Number(b.severity === 'critical') - Number(a.severity === 'critical'));
  const open = all.filter((d) => DEFECT_OPEN.includes(d.status));
  const projects = [...new Set((data ?? []).map((d) => d.project_name))].sort();

  return (
    <Screen refreshing={loading} onRefresh={reload} maxWidth={1300}>
      <Stack.Screen options={{ title: 'Warranty & defects' }} />
      {header}
      <ErrorBanner message={error} />
      <Muted>
        Defects in the work DIMO installed on a project – during the works, in the defects liability period (DLP) or after. A faulty product goes to a product warranty
        claim.
      </Muted>
      <Row wrap gap={8} style={{ justifyContent: 'flex-end' }}>
        {sales ? <Button title="Report a project defect" onPress={() => router.push('/warranty/defects/new')} /> : null}
        {DEFECT_LOGGERS.includes(me.role) ? <Button title="+ Log a defect" onPress={() => router.push('/warranty/defects/new')} /> : null}
      </Row>
      <Grid min={170}>
        <Stat label="Open defects" value={open.length} onPress={() => setFilter('open')} />
        <Stat label="Critical open" value={open.filter((d) => d.severity === 'critical').length} tone={open.some((d) => d.severity === 'critical') ? 'red' : undefined} />
        <Stat label="Overdue" value={open.filter(late).length} tone={open.some(late) ? 'red' : undefined} />
        <Stat label="Reported – to verify" value={open.filter((d) => d.status === 'reported').length} tone={open.some((d) => d.status === 'reported') ? 'amber' : undefined} />
        <Stat label="In the DLP" value={open.filter((d) => d.phase === 'dlp').length} />
      </Grid>
      <Row wrap gap={8} style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'mine', label: sales ? 'My reports' : 'Waiting for me', badge: all.filter(waiting).length },
            { value: 'open', label: 'Open', badge: open.length },
            { value: 'closed', label: 'Closed' },
            { value: 'all', label: 'All' },
          ]}
        />
        <View style={{ width: 300, maxWidth: '100%' }}>
          <Select label="Project" value={project} searchable onChange={setProject} options={[{ value: '', label: `All projects (${projects.length})` }, ...projects.map((p) => ({ value: p, label: p }))]} />
        </View>
      </Row>
      {rows.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {rows.map((d) => {
            const st = DEFECT_STATUS[d.status];
            return (
              <ListRow
                key={d.id}
                highlight={late(d) ? severityTone('critical') : d.severity === 'critical' && DEFECT_OPEN.includes(d.status) ? severityTone('critical') : undefined}
                title={`${d.code} · ${d.title}`}
                subtitle={[
                  [d.project_name, d.location].filter(Boolean).join(' · '),
                  [
                    PHASE[d.phase],
                    d.assignee_id ? `with ${people[d.assignee_id]?.full_name ?? ''}` : null,
                    d.due_date && DEFECT_OPEN.includes(d.status) ? `due ${fmtDate(d.due_date)}${late(d) ? ' – overdue' : ''}` : null,
                    `reported ${fmtDate(d.reported_at)} by ${people[d.reported_by]?.full_name ?? ''}`,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ].join('\n')}
                wrapRight
                right={
                  <Row gap={4} wrap style={{ justifyContent: 'flex-end' }}>
                    <Pill label={d.severity === 'critical' ? 'Critical' : d.severity === 'major' ? 'Major' : 'Minor'} tone={severityTone(d.severity)} />
                    <Pill label={st.label} tone={st.tone} />
                  </Row>
                }
                onPress={() => router.push(`/warranty/defects/${d.id}`)}
              />
            );
          })}
        </Card>
      ) : (
        <Card>
          <Empty title={filter === 'mine' ? 'Nothing waiting for you' : 'No project defects'} />
        </Card>
      )}
    </Screen>
  );
}
