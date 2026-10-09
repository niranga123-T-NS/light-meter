import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { BillingTab } from '@/components/exec/BillingTab';
import { DocumentsTab } from '@/components/exec/DocumentsTab';
import { HandoverTab } from '@/components/exec/HandoverTab';
import { HseTab } from '@/components/exec/HseTab';
import { MaterialsTab } from '@/components/exec/MaterialsTab';
import { MeetingsTab } from '@/components/exec/MeetingsTab';
import { OverviewTab } from '@/components/exec/OverviewTab';
import { PlansTab } from '@/components/exec/PlansTab';
import { ProgrammeTab } from '@/components/exec/ProgrammeTab';
import { QaTab } from '@/components/exec/QaTab';
import { SubCertsTab } from '@/components/exec/SubCertsTab';
import { ReportsTab } from '@/components/exec/ReportsTab';
import { TeamTab } from '@/components/exec/TeamTab';
import { VariationsTab } from '@/components/exec/VariationsTab';
import { TestingBanner } from '@/components/Testing';
import { colors, ErrorBanner, Loading, Muted, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { stageLabel, type ExecProject } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { WorkersTab } from '@/components/exec/WorkersTab';
import { supabase } from '@/lib/supabase';
import type { Role } from '@/lib/types';

type Tab = { key: string; label: string; roles?: Role[] };
const INTERNAL: Role[] = ['senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'assistant_engineer', 'trainee'];
const TABS: Tab[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'team', label: 'Project team', roles: INTERNAL },
  { key: 'meetings', label: 'Meetings', roles: INTERNAL },
  { key: 'programme', label: 'Programme', roles: INTERNAL },
  { key: 'plans', label: 'Plan', roles: INTERNAL },
  { key: 'reports', label: 'Daily reports' },
  { key: 'variations', label: 'Variations', roles: ['senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'assistant_engineer'] },
  { key: 'hse', label: 'HSE' },
  { key: 'workers', label: 'Workers', roles: ['senior_elec_engineer', 'sm_projects', 'assistant_engineer', 'sub_supervisor'] },
  { key: 'materials', label: 'Materials', roles: INTERNAL },
  { key: 'qa', label: 'QA', roles: INTERNAL },
  { key: 'documents', label: 'Documents' },
  { key: 'handover', label: 'Handover', roles: INTERNAL },
  { key: 'subcerts', label: 'Subcontractor IPC & invoices', roles: ['senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'assistant_engineer', 'sub_supervisor'] },
  { key: 'billing', label: 'Billing', roles: ['senior_elec_engineer', 'sm_projects', 'gm', 'operations_exec', 'assistant_engineer'] },
];

/** One execution project: the workspace every execution screen hangs off. Each role sees the tabs it is allowed. */
export default function ExecProjectScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const me = useMe();
  // (old links to the removed Cost tab open the certificates)
  const [t, setT] = useState(tab === 'cost' ? 'subcerts' : (tab ?? 'overview'));
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
      <Muted>{stageLabel(p)}</Muted>
      <Segmented value={t} onChange={setT} options={tabs.map((x) => ({ value: x.key, label: x.label }))} />
      {t === 'overview' ? <OverviewTab p={p} onTab={setT} onChange={reload} /> : null}
      {t === 'programme' ? <ProgrammeTab p={p} onChange={reload} /> : null}
      {t === 'plans' ? <PlansTab p={p} /> : null}
      {t === 'reports' ? <ReportsTab p={p} /> : null}
      {t === 'variations' ? <VariationsTab p={p} /> : null}
      {t === 'hse' ? <HseTab p={p} /> : null}
      {t === 'workers' ? <WorkersTab p={p} /> : null}
      {t === 'materials' ? <MaterialsTab p={p} /> : null}
      {t === 'qa' ? <QaTab p={p} /> : null}
      {t === 'documents' ? <DocumentsTab p={p} queries={me.role !== 'sub_supervisor'} /> : null}
      {t === 'handover' ? <HandoverTab p={p} onChange={reload} /> : null}
      {t === 'subcerts' ? <SubCertsTab p={p} /> : null}
      {t === 'billing' ? <BillingTab key={p.secured_id ?? 'none'} p={p} onChange={reload} /> : null}
      {t === 'team' ? <TeamTab p={p} /> : null}
      {t === 'meetings' ? <MeetingsTab p={p} /> : null}
    </Screen>
  );
}
