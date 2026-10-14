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
import { SubPlanningTab } from '@/components/exec/SubPlanningTab';
import { ReportsTab } from '@/components/exec/ReportsTab';
import { TeamTab } from '@/components/exec/TeamTab';
import { VariationsTab } from '@/components/exec/VariationsTab';
import { TestingBanner } from '@/components/Testing';
import { colors, ErrorBanner, Loading, Muted, Notice, Screen, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { stageLabel, type ExecProject } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { WorkersTab } from '@/components/exec/WorkersTab';
import { rpc, supabase } from '@/lib/supabase';
import type { Role } from '@/lib/types';

type Tab = { key: string; label: string; roles?: Role[] };
/** The execution team – the Operations Executive is not in it (sees only materials, documents, handover, IPCs and billing) */
const TEAM: Role[] = ['senior_elec_engineer', 'sm_projects', 'gm', 'assistant_engineer', 'trainee'];
const INTERNAL: Role[] = [...TEAM, 'operations_exec'];
const TABS: Tab[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'team', label: 'Project team', roles: TEAM },
  { key: 'meetings', label: 'Meetings', roles: TEAM },
  { key: 'programme', label: 'Programme', roles: TEAM },
  { key: 'plans', label: 'Plan', roles: TEAM },
  { key: 'planning', label: 'Planning', roles: ['sub_supervisor'] },
  { key: 'reports', label: 'Daily reports', roles: [...TEAM, 'sub_supervisor'] },
  { key: 'variations', label: 'Variations', roles: ['senior_elec_engineer', 'sm_projects', 'gm', 'assistant_engineer'] },
  { key: 'hse', label: 'HSE', roles: [...TEAM, 'sub_supervisor'] },
  { key: 'workers', label: 'Workers', roles: ['senior_elec_engineer', 'sm_projects', 'assistant_engineer', 'sub_supervisor'] },
  { key: 'materials', label: 'Materials & services', roles: INTERNAL },
  { key: 'qa', label: 'QA', roles: TEAM },
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
  const [want, setT] = useState(tab === 'cost' ? 'subcerts' : (tab ?? 'overview'));
  const { data, error, reload } = useLoad(async () => {
    const { data: p, error: e } = await supabase.from('exec_projects').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const block = await rpc<{ blocked: boolean; reason: string | null } | null>('exec_block_state', { p_exec: id }).catch(() => null);
    return { p: p as ExecProject, block };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { p, block } = data;
  const tabs = TABS.filter((x) => !x.roles || x.roles.includes(me.role));
  // A link to a tab this role does not see opens the Overview
  const t = tabs.some((x) => x.key === want) ? want : 'overview';
  return (
    <Screen onRefresh={reload} maxWidth={1100}>
      <Stack.Screen options={{ title: p.code ?? 'Execution' }} />
      <TestingBanner what="The execution module" />
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{p.name}</Text>
      <Muted>{stageLabel(p)}</Muted>
      {block?.blocked ? (
        <Notice tone={colors.red}>{`Blocked by SM Projects / GM until the advance payment is received${block.reason ? ` – ${block.reason}` : ''}. New material requests, orders, programme approval and subcontractor IPCs are on hold.`}</Notice>
      ) : null}
      <Segmented value={t} onChange={setT} options={tabs.map((x) => ({ value: x.key, label: x.label }))} />
      {t === 'overview' ? <OverviewTab p={p} onTab={setT} onChange={reload} /> : null}
      {t === 'programme' ? <ProgrammeTab p={p} onChange={reload} /> : null}
      {t === 'plans' ? <PlansTab p={p} /> : null}
      {t === 'reports' ? <ReportsTab p={p} /> : null}
      {t === 'variations' ? <VariationsTab p={p} /> : null}
      {t === 'planning' ? <SubPlanningTab p={p} /> : null}
      {t === 'hse' ? <HseTab p={p} mode="noPermits" /> : null}
      {t === 'workers' ? <WorkersTab p={p} /> : null}
      {t === 'materials' ? <MaterialsTab p={p} /> : null}
      {t === 'qa' ? <QaTab p={p} /> : null}
      {t === 'documents' ? <DocumentsTab p={p} queries={TEAM.includes(me.role)} /> : null}
      {t === 'handover' ? <HandoverTab p={p} onChange={reload} /> : null}
      {t === 'subcerts' ? <SubCertsTab p={p} /> : null}
      {t === 'billing' ? <BillingTab key={p.secured_id ?? 'none'} p={p} onChange={reload} /> : null}
      {t === 'team' ? <TeamTab p={p} /> : null}
      {t === 'meetings' ? <MeetingsTab p={p} /> : null}
    </Screen>
  );
}
