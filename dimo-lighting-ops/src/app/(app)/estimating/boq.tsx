import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { EstimationTabs, useEstimationTab } from '@/components/EstimationTabs';
import { Button, Card, ErrorBanner, Field, ListRow, Loading, Muted, Screen, Section } from '@/components/ui';
import { fmtDateTime, human } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Job = { id: string; revision: number; source: string; status: string; created_at: string; inquiries: { code: string; project_name: string | null; customer_name: string | null } | null };
type Saved = { id: string; estimation_job_id: string; file_name: string; sheet: string | null; lines: { kind: string; chosen: string | null; noMatch?: boolean }[]; updated_at: string; estimation_jobs: { revision: number; inquiries: { code: string; project_name: string | null } | null } | null };

/** Estimation › BOQ match: pick an estimate to match its BOQ, or open a saved match */
export default function EstimationBoq() {
  const blocked = useEstimationTab();
  const [search, setSearch] = useState('');
  const { data, error, loading } = useLoad(async () => {
    const [{ data: jobs, error: e }, { data: saved, error: e2 }] = await Promise.all([
      supabase.from('estimation_jobs').select('id, revision, source, status, created_at, inquiries(code, project_name, customer_name)').order('created_at', { ascending: false }).limit(300),
      supabase.from('boq_matches').select('id, estimation_job_id, file_name, sheet, lines, updated_at, estimation_jobs(revision, inquiries(code, project_name))').order('updated_at', { ascending: false }).limit(30),
    ]);
    if (e || e2) throw new Error((e ?? e2)!.message);
    return { jobs: (jobs ?? []) as unknown as Job[], saved: (saved ?? []) as unknown as Saved[] };
  });
  const savedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data?.saved ?? []) m.set(s.estimation_job_id, (m.get(s.estimation_job_id) ?? 0) + 1);
    return m;
  }, [data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const jobs = data?.jobs ?? [];
    return (q ? jobs.filter((j) => `${j.inquiries?.code} ${j.inquiries?.project_name} ${j.inquiries?.customer_name}`.toLowerCase().includes(q)) : jobs).slice(0, 40);
  }, [data, search]);
  if (blocked) return blocked;
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Estimation' }} />
      <EstimationTabs value="boq" />
      <Muted>Upload the client&apos;s BOQ Excel for an estimate – every light-fitting line gets the best options from the catalogue library, the estimator chooses one, and the Excel comes back with the choices and options added.</Muted>
      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data?.saved.length ? (
        <Section title="Recently saved BOQ matches">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.saved.map((s) => {
              const fit = s.lines.filter((l) => l.kind === 'fitting');
              return (
                <ListRow
                  key={s.id}
                  title={`${s.estimation_jobs?.inquiries?.code ?? '—'} · ${s.estimation_jobs?.inquiries?.project_name ?? ''} · R${s.estimation_jobs?.revision ?? 0}`}
                  subtitle={`${s.file_name}${s.sheet ? ` › ${s.sheet}` : ''} · ${fit.length} lines · ${fit.filter((l) => l.chosen).length} chosen · ${fit.filter((l) => l.noMatch).length} no match · saved ${fmtDateTime(s.updated_at)}`}
                  right={<Button small variant="secondary" title="Open" onPress={() => router.push({ pathname: '/estimation/boq/[id]', params: { id: s.estimation_job_id, m: s.id } })} />}
                />
              );
            })}
          </Card>
        </Section>
      ) : null}
      {data ? (
        <Section title="Start a BOQ match – choose the estimate">
          <Field label="Search" value={search} onChangeText={setSearch} placeholder="Inquiry number, project or customer" />
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {shown.length ? shown.map((j) => (
              <ListRow
                key={j.id}
                title={`${j.inquiries?.code ?? '—'} · ${j.inquiries?.project_name ?? ''} · R${j.revision}`}
                subtitle={`${j.inquiries?.customer_name ?? '—'} · ${human(j.status)} · source ${j.source}${savedCount.get(j.id) ? ` · ${savedCount.get(j.id)} saved match${savedCount.get(j.id)! > 1 ? 'es' : ''}` : ''}`}
                onPress={() => router.push(`/estimation/boq/${j.id}`)}
                right={<Button small title="BOQ match" onPress={() => router.push(`/estimation/boq/${j.id}`)} />}
              />
            )) : <ListRow title="No estimates found" />}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
