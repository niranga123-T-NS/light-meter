import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { AreaPicker } from '@/components/exec/AreaPicker';
import { SiteLocationCard } from '@/components/exec/SiteLocationCard';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, DateField, ErrorBanner, Field, Loading, Muted, Row, Screen, Section } from '@/components/ui';
import type { ExecProject } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** Execution details of a project: the project areas (any of the 18, combined), site and dates. */
export default function ExecutionDetails() {
  const dialog = useDialog();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState<{ areas: string[]; site_address: string; start_date: string | null; end_date: string | null } | null>(null);
  const { data: existing, reload } = useLoad(async () => {
    const { data } = await supabase.from('exec_projects').select('*').eq('id', id).maybeSingle();
    return data as ExecProject | null;
  }, [id]);
  if (!existing) return <Screen><Loading /></Screen>;
  const v = f ?? { areas: existing.areas, site_address: existing.site_address ?? '', start_date: existing.start_date, end_date: existing.end_date };
  const set = (x: Partial<typeof v>) => setF({ ...v, ...x });

  const save = async () => {
    setError(null);
    if (!v.areas.length) return setError('Choose at least one project area');
    await dialog.run(async () => {
      await rpc('update_exec_project', {
        p_id: id,
        p: { areas: v.areas, site_address: v.site_address, start_date: v.start_date ?? '', end_date: v.end_date ?? '', lat: existing.lat ?? '', lng: existing.lng ?? '' },
      });
      router.back();
    }, 'Saved');
  };

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: 'Execution details' }} />
      <TestingBanner what="The execution module" />
      <ErrorBanner message={error} />
      <Section title={`Project areas (${v.areas.length} chosen)`}>
        <Card>
          <Muted>One project can combine several areas; each area brings its own checks and handover list.</Muted>
          <AreaPicker value={v.areas} onChange={(areas) => set({ areas })} />
        </Card>
      </Section>
      <Section title="Site and dates">
        <Card>
          <Field label="Site address" multiline value={v.site_address} onChangeText={(site_address) => set({ site_address })} />
          <Row wrap gap={8}>
            <DateField label="Start" value={v.start_date} onChange={(start_date) => set({ start_date })} quick={[0]} />
            <DateField label="Planned finish" value={v.end_date} onChange={(end_date) => set({ end_date })} quick={[]} />
          </Row>
        </Card>
      </Section>
      <SiteLocationCard p={existing} onChange={reload} />
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" title="Cancel" onPress={() => router.back()} />
        <Button title="Save" onPress={save} />
      </Row>
    </Screen>
  );
}
