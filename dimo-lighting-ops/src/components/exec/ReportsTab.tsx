import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Row, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject, ExecReport } from '@/lib/execution';
import { todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { ReportRows } from './ReportRows';
import { WeatherTab } from './WeatherTab';

export function ReportsTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const [sub, setSub] = useState<'reports' | 'weather'>('reports');
  const { data } = useLoad(async () => {
    const { data: r } = await supabase.from('exec_reports').select('*').eq('exec_project_id', p.id).order('report_date', { ascending: false }).limit(100);
    return (r ?? []) as ExecReport[];
  }, [p.id]);
  return (
    <>
      <Segmented value={sub} onChange={setSub} options={[{ value: 'reports', label: 'Reports' }, { value: 'weather', label: 'Weather' }]} />
      {sub === 'weather' ? (
        <WeatherTab p={p} />
      ) : (
        <Section title="Daily reports">
          {me.role === 'sub_supervisor' || me.role === 'assistant_engineer' ? (
            <Row style={{ marginBottom: 8 }}>
              <Button small title="Write today's report" onPress={() => router.push({ pathname: '/execution/report/new', params: { project: p.id, date: todayISO() } })} />
            </Row>
          ) : null}
          <ReportRows rows={data ?? []} />
        </Section>
      )}
    </>
  );
}
