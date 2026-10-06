import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, ErrorBanner, Field, ListRow, Loading, Pill, Row, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { areaLabel, EXEC_STAGES, type ExecProject } from '@/lib/execution';
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
    const { data: rows, error: e } = await supabase.from('exec_projects').select('*').order('created_at', { ascending: false });
    if (e) throw new Error(e.message);
    return rows as ExecProject[];
  });
  const title =
    me.role === 'gm' || me.role === 'sm_projects' ? 'Execution portfolio' : me.role === 'senior_elec_engineer' ? 'Execution projects' : me.role === 'sub_supervisor' ? 'My work' : 'My projects';
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const rows = data.filter((p) => p.status === tab && (!q || `${p.code} ${p.name}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title }} />
      <TestingBanner what="The execution module" />
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: 'Active', badge: data.filter((p) => p.status === 'active').length },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        {me.role === 'senior_elec_engineer' || me.role === 'sm_projects' ? <Button title="+ Start execution" onPress={() => router.push('/execution/start')} /> : null}
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
              subtitle={[p.code, p.areas.map(areaLabel).join(', '), p.see_id ? `SEE ${people[p.see_id]?.full_name ?? ''}` : null, p.end_date ? `finish ${fmtDate(p.end_date)}` : null]
                .filter(Boolean)
                .join(' · ')}
              right={<Pill label={`${p.stage} ${EXEC_STAGES[p.stage - 1]}`} tone={colors.blue} />}
            />
          ))}
        </Card>
      ) : (
        <Empty title={me.role === 'sub_supervisor' || me.role === 'assistant_engineer' || me.role === 'trainee' ? 'No projects assigned to you' : 'No execution projects yet'} />
      )}
    </Screen>
  );
}
