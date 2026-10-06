import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { EngJobRows } from '@/components/EngJobRows';
import { Button, ErrorBanner, Loading, Row, Screen, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { ENG_SELECT, isOpen, isOverdue, type EngJob } from '@/lib/engJobs';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Tab = 'assigned' | 'in_progress' | 'on_hold' | 'overdue' | 'done';

/** Engineering jobs: awaiting acceptance, ongoing, on hold, overdue and done – own jobs, or the whole team for the Senior Electrical Engineer. */
export default function EngJobs() {
  const me = useMe();
  const people = usePeople();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const lead = me.role === 'senior_elec_engineer' || me.role === 'sm_projects' || me.role === 'gm';
  const [tab, setTab] = useState<Tab>(params.tab ?? 'in_progress');
  const [who, setWho] = useState<string>(lead ? 'all' : me.id);
  const { data, error, reload } = useLoad(async () => {
    const { data: rows, error: e } = await supabase.from('eng_jobs').select(ENG_SELECT).order('due_date').limit(2000);
    if (e) throw new Error(e.message);
    return rows as EngJob[];
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const scoped = data.filter((j) => who === 'all' || j.assignee_id === who);
  const lists: Record<Tab, EngJob[]> = {
    assigned: scoped.filter((j) => j.status === 'assigned'),
    in_progress: scoped.filter((j) => j.status === 'in_progress'),
    on_hold: scoped.filter((j) => j.status === 'on_hold'),
    overdue: scoped.filter(isOverdue),
    done: scoped.filter((j) => !isOpen(j)).sort((a, b) => (b.done_at ?? b.due_date).localeCompare(a.done_at ?? a.due_date)),
  };
  const engineers = [...new Set(data.map((j) => j.assignee_id))];

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Engineering jobs' }} />
      <Row wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'assigned', label: 'Awaiting acceptance', badge: lists.assigned.length },
            { value: 'in_progress', label: 'Ongoing', badge: lists.in_progress.length },
            { value: 'on_hold', label: 'On hold', badge: lists.on_hold.length },
            { value: 'overdue', label: 'Overdue', badge: lists.overdue.length },
            { value: 'done', label: 'Done / cancelled' },
          ]}
        />
        {lead ? <Button title="+ Assign a job" onPress={() => router.push('/engineering/new')} /> : null}
      </Row>
      {lead ? (
        <Select
          label="Engineer"
          value={who}
          onChange={setWho}
          options={[{ value: 'all', label: 'All engineers' }, ...engineers.map((id) => ({ value: id, label: people[id]?.full_name ?? '—' }))]}
        />
      ) : null}
      <EngJobRows jobs={lists[tab]} showEngineer={lead} empty="Nothing here" />
    </Screen>
  );
}
