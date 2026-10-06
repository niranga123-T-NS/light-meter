import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Muted, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { weekOf, type ExecMember, type ExecProject, type PlanItem } from '@/lib/execution';
import { addDaysISO, fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { loadProgramme } from '@/lib/programme';
import { PlanWeek } from './PlanWeek';

/** The project's week: every engineer's plan items and supervisor additions, with results. */
export function PlansTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const [week, setWeek] = useState(weekOf(todayISO()));
  const { data, reload } = useLoad(async () => {
    const [its, mem] = await Promise.all([
      supabase.from('exec_plan_items').select('*').eq('exec_project_id', p.id).gte('day', week).lte('day', addDaysISO(week, 6)).order('day'),
      supabase.from('exec_members').select('*').eq('exec_project_id', p.id).eq('active', true),
    ]);
    return { items: (its.data ?? []) as PlanItem[], members: (mem.data ?? []) as ExecMember[], programme: await loadProgramme(p.id) };
  }, [p.id, week]);
  return (
    <Section title="Plan">
      <Row wrap gap={6} style={{ alignItems: 'center', marginBottom: 8 }}>
        <Button small variant="secondary" title="‹ Week" onPress={() => setWeek(addDaysISO(week, -7))} />
        <Muted>{`Week of ${fmtDate(week)}`}</Muted>
        <Button small variant="secondary" title="Week ›" onPress={() => setWeek(addDaysISO(week, 7))} />
        {me.role === 'assistant_engineer' ? <Button small title="My plan" onPress={() => router.push({ pathname: '/execution/plans', params: { project: p.id, week } })} /> : null}
      </Row>
      {data ? (
        <PlanWeek week={week} items={data.items} project={p.id} supervisors={data.members.filter((m) => m.member_role === 'sub_supervisor')} canResult={me.role !== 'trainee'} onChange={reload} programme={data.programme} />
      ) : null}
    </Section>
  );
}
