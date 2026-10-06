import { router } from 'expo-router';
import { Button, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject, HseReport } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { HseRows } from './HseRows';

export function HseTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const { data } = useLoad(async () => {
    const { data: r } = await supabase.from('hse_reports').select('*').eq('exec_project_id', p.id).order('occurred_at', { ascending: false });
    return (r ?? []) as HseReport[];
  }, [p.id]);
  return (
    <Section title="HSE">
      {me.role !== 'gm' ? (
        <Row style={{ marginBottom: 8 }}>
          <Button small title="+ Report" onPress={() => router.push({ pathname: '/execution/hse/new', params: { project: p.id } })} />
        </Row>
      ) : null}
      <HseRows rows={data ?? []} />
    </Section>
  );
}
