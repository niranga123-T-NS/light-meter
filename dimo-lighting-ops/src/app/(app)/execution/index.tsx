import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ErrorBanner, Field, ListRow, Loading, Pill, Row, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { areaLabel, stageLabel, type ExecProject } from '@/lib/execution';
import { fmtDate } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Execution projects: portfolio for SM Projects / GM, own projects for the SEE, assigned projects for the field team. */
export default function ExecProjects() {
  const me = useMe();
  const people = usePeople();
  const [tab, setTab] = useState<'active' | 'closed'>('active');
  const [q, setQ] = useState('');
  const { data, error, reload, loading } = useLoad(async () => {
    const [{ data: rows, error: e }, r] = await Promise.all([
      supabase.from('exec_projects').select('*').order('created_at', { ascending: false }),
      supabase.from('exec_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending_smp'),
    ]);
    if (e) throw new Error(e.message);
    // Field staff without a project: why (waiting for approval, starts on a date, ended…)
    const access =
      !(rows ?? []).length && (me.role === 'sub_supervisor' || me.role === 'assistant_engineer' || me.role === 'trainee')
        ? (((await supabase.rpc('my_exec_access')).data ?? []) as { project: string | null; state: string; since: string | null }[])
        : [];
    return { rows: rows as ExecProject[], pending: r.count ?? 0, access };
  });
  const title =
    me.role === 'gm' || me.role === 'sm_projects' || me.role === 'operations_exec' ? 'Execution portfolio' : me.role === 'senior_elec_engineer' ? 'Execution projects' : me.role === 'sub_supervisor' ? 'My work' : 'My projects';
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const handover = ['sm_projects', 'gm', 'operations_exec', 'senior_elec_engineer'].includes(me.role);
  const rows = data.rows.filter((p) => p.status === tab && (!q || `${p.code} ${p.name}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title }} />
      <TestingBanner what="The execution module" />
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: 'Active', badge: data.rows.filter((p) => p.status === 'active').length },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <Row wrap gap={6}>
          {me.role === 'operations_exec' ? <Button title="+ Hand over a won project" onPress={() => router.push('/execution/handover/new')} /> : null}
          {me.role === 'senior_elec_engineer' ? (
            <Button title="+ Project won before the system" onPress={() => router.push({ pathname: '/execution/handover/new', params: { kind: 'legacy' } })} />
          ) : null}
          {handover ? (
            <Button variant="secondary" title={`Hand-over requests${data.pending ? ` (${data.pending} waiting)` : ''}`} onPress={() => router.push('/execution/handover')} />
          ) : null}
        </Row>
      </Row>
      <Field label="Search" value={q} onChangeText={setQ} placeholder="Project name or code" />
      {rows.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {rows.map((p) => (
            <ListRow
              key={p.id}
              wrapRight
              onPress={() => router.push(`/execution/${p.id}`)}
              title={p.name}
              highlight={!p.areas.length ? colors.amber : undefined}
              subtitle={[p.code, p.areas.length ? p.areas.map(areaLabel).join(', ') : 'areas not set yet', p.legacy ? 'won before the system' : null, p.see_id ? `SEE ${people[p.see_id]?.full_name ?? ''}` : null, p.end_date ? `finish ${fmtDate(p.end_date)}` : null]
                .filter(Boolean)
                .join(' · ')}
              right={<Pill label={stageLabel(p)} tone={colors.blue} />}
            />
          ))}
        </Card>
      ) : (
        <>
          <Empty title={me.role === 'sub_supervisor' || me.role === 'assistant_engineer' || me.role === 'trainee' ? 'No projects assigned to you' : 'No execution projects yet'} />
          {data.access.length ? (
            <Card>
              {data.access.map((x, i) => (
                <Row key={i} wrap gap={8} style={{ paddingVertical: 4, alignItems: 'center' }}>
                  <Pill label={x.state === 'starts' ? `Access starts ${fmtDate(x.since)}` : x.state === 'ended' ? `Access ended ${fmtDate(x.since)}` : x.state} tone={colors.amber} />
                  <Text style={{ color: colors.ink, flexShrink: 1 }}>{x.project ?? 'Project'}</Text>
                </Row>
              ))}
            </Card>
          ) : me.role === 'sub_supervisor' ? (
            <Card>
              <Text style={{ color: colors.text }}>
                Your login is not linked to a project yet. Ask the Senior Electrical Engineer to nominate you on the project (Team → Nominate subcontractor supervisor) with
                this mobile number / email – once SM Projects approves, the project appears here.
              </Text>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
