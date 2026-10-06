import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { HseTab } from '@/components/exec/HseTab';
import { OverviewTab } from '@/components/exec/OverviewTab';
import { PlansTab } from '@/components/exec/PlansTab';
import { ReportsTab } from '@/components/exec/ReportsTab';
import { TeamTab } from '@/components/exec/TeamTab';
import { TestingBanner } from '@/components/Testing';
import { colors, ErrorBanner, Loading, Muted, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { EXEC_STAGES, type ExecProject } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import type { Role } from '@/lib/types';

type Tab = { key: string; label: string; roles?: Role[] };
const INTERNAL: Role[] = ['senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'assistant_engineer', 'trainee'];
const TABS: Tab[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'plans', label: 'Plan', roles: INTERNAL },
  { key: 'reports', label: 'Daily reports' },
  { key: 'hse', label: 'HSE' },
  { key: 'team', label: 'Team', roles: INTERNAL },
];

/** One execution project: the workspace every execution screen hangs off. Each role sees the tabs it is allowed. */
export default function ExecProjectScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const me = useMe();
  const [t, setT] = useState(tab ?? 'overview');
  const { data, error, reload } = useLoad(async () => {
    const { data: p, error: e } = await supabase.from('exec_projects').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    return p as ExecProject;
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const p = data;
  const tabs = TABS.filter((x) => !x.roles || x.roles.includes(me.role));
  return (
    <Screen onRefresh={reload} maxWidth={1100}>
      <Stack.Screen options={{ title: p.code ?? 'Execution' }} />
      <TestingBanner what="The execution module" />
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{p.name}</Text>
      <Muted>{`Stage ${p.stage} – ${EXEC_STAGES[p.stage - 1]}${p.status === 'closed' ? ' · closed' : ''}`}</Muted>
      <Segmented value={t} onChange={setT} options={tabs.map((x) => ({ value: x.key, label: x.label }))} />
      {t === 'overview' ? <OverviewTab p={p} /> : null}
      {t === 'plans' ? <PlansTab p={p} /> : null}
      {t === 'reports' ? <ReportsTab p={p} /> : null}
      {t === 'hse' ? <HseTab p={p} /> : null}
      {t === 'team' ? <TeamTab p={p} /> : null}
    </Screen>
  );
}
