import { router } from 'expo-router';
import { Button, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject, Variation } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { VariationRows } from './VariationRows';

export function VariationsTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const { data } = useLoad(async () => {
    const { data: v } = await supabase.from('variations').select('*').eq('exec_project_id', p.id).order('raised_at', { ascending: false });
    return (v ?? []) as Variation[];
  }, [p.id]);
  return (
    <Section title="Variations">
      {me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer' ? (
        <Row style={{ marginBottom: 8 }}>
          <Button small title="+ Raise a variation" onPress={() => router.push({ pathname: '/execution/variation/new', params: { project: p.id } })} />
        </Row>
      ) : null}
      <VariationRows rows={data ?? []} />
    </Section>
  );
}
