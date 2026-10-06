import { Stack } from 'expo-router';
import { useState } from 'react';
import { DocumentsTab } from '@/components/exec/DocumentsTab';
import { TestingBanner } from '@/components/Testing';
import { ErrorBanner, Loading, Screen, Select } from '@/components/ui';
import type { ExecProject } from '@/lib/execution';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Document register of a chosen execution project (Operations / Design). */
export default function Documents() {
  const [pid, setPid] = useState<string | null>(null);
  const { data, error } = useLoad(async () => {
    const { data: p, error: e } = await supabase.from('exec_projects').select('*').order('name');
    if (e) throw new Error(e.message);
    return (p ?? []) as ExecProject[];
  });
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const p = data.find((x) => x.id === pid) ?? data[0];
  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: 'Documents' }} />
      <TestingBanner what="The document register" />
      <Select label="Project" value={p?.id ?? null} onChange={setPid} options={data.map((x) => ({ value: x.id, label: `${x.code ?? ''} ${x.name}` }))} />
      {p ? <DocumentsTab key={p.id} p={p} queries={false} /> : null}
    </Screen>
  );
}
