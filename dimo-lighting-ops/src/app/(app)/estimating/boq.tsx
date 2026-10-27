import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { useDialog } from '@/components/dialog';
import { EstimationTabs, useEstimationTab } from '@/components/EstimationTabs';
import { Button, Card, colors, ErrorBanner, Field, ListRow, Loading, Muted, Pill, Row, Screen, Section } from '@/components/ui';
import { BOQ_PROJECT_KIND, deleteBoqProject, saveBoqProject, type BoqProject } from '@/lib/boqMatch';
import { fmtDate, fmtDateTime, human } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Job = { id: string; revision: number; source: string; status: string; created_at: string; inquiries: { code: string; project_name: string | null; customer_name: string | null } | null };
type Saved = { id: string; estimation_job_id: string | null; boq_project_id: string | null; boq_projects: { ref: string; project_name: string } | null; file_name: string; sheet: string | null; lines: { kind: string; chosen: string | null; noMatch?: boolean }[]; updated_at: string; estimation_jobs: { revision: number; inquiries: { code: string; project_name: string | null } | null } | null };

const open = (s: Pick<Saved, 'id' | 'estimation_job_id' | 'boq_project_id'>) =>
  router.push(s.boq_project_id ? { pathname: '/estimation/boq/[id]', params: { id: s.boq_project_id, m: s.id, c: '1' } } : { pathname: '/estimation/boq/[id]', params: { id: s.estimation_job_id!, m: s.id } });
const openCustom = (id: string) => router.push({ pathname: '/estimation/boq/[id]', params: { id, c: '1' } });

/** Estimation › BOQ match: pick an estimate to match its BOQ, add an inquiry that is not in the system, or open a saved match */
export default function EstimationBoq() {
  const blocked = useEstimationTab();
  const dialog = useDialog();
  const [search, setSearch] = useState('');
  const { data, error, loading, reload } = useLoad(async () => {
    const [{ data: jobs, error: e }, { data: saved, error: e2 }, { data: custom, error: e3 }] = await Promise.all([
      supabase.from('estimation_jobs').select('id, revision, source, status, created_at, inquiries(code, project_name, customer_name)').order('created_at', { ascending: false }).limit(300),
      supabase.from('boq_matches').select('id, estimation_job_id, boq_project_id, file_name, sheet, lines, updated_at, estimation_jobs(revision, inquiries(code, project_name)), boq_projects(ref, project_name)').order('updated_at', { ascending: false }).limit(100),
      supabase.from('boq_projects').select('*').order('created_at', { ascending: false }),
    ]);
    if (e || e2 || e3) throw new Error((e ?? e2 ?? e3)!.message);
    return { jobs: (jobs ?? []) as unknown as Job[], saved: (saved ?? []) as unknown as Saved[], custom: (custom ?? []) as BoqProject[] };
  });
  const savedCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of data?.saved ?? []) { const k = (s.estimation_job_id ?? s.boq_project_id)!; m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const jobs = (data?.jobs ?? []).filter((j) => !savedCount.has(j.id));
    return (q ? jobs.filter((j) => `${j.inquiries?.code} ${j.inquiries?.project_name} ${j.inquiries?.customer_name}`.toLowerCase().includes(q)) : jobs).slice(0, 40);
  }, [data, search, savedCount]);
  const customShown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.custom ?? []).filter((p) => !q || `${p.ref} ${p.project_name} ${p.customer_name ?? ''}`.toLowerCase().includes(q));
  }, [data, search]);
  if (blocked) return blocked;

  // an inquiry that is not in the system: from before the system, or never registered
  const editCustom = async (p?: BoqProject) => {
    const r = await dialog.prompt({
      title: p ? `Edit ${p.ref}` : 'Add an inquiry that is not in the system',
      message: 'Only for the BOQ match – it does not go into the inquiry register, the workflow or the reports.',
      fields: [
        { key: 'kind', label: 'This inquiry is', type: 'select', required: true, initial: p?.kind ?? 'pre_system', options: Object.entries(BOQ_PROJECT_KIND).map(([value, label]) => ({ value, label })) },
        { key: 'ref', label: 'Inquiry number / reference', required: true, initial: p?.ref, hint: 'The old inquiry number, the client\'s reference or a tender number' },
        { key: 'project_name', label: 'Project', required: true, initial: p?.project_name },
        { key: 'customer_name', label: 'Customer', initial: p?.customer_name ?? '' },
        { key: 'inquiry_date', label: 'Inquiry date', type: 'date', initial: p?.inquiry_date ?? '' },
        { key: 'notes', label: 'Notes', type: 'multiline', initial: p?.notes ?? '' },
      ],
      confirmLabel: p ? 'Save' : 'Add and open BOQ match',
    });
    if (!r) return;
    let id = '';
    if (await dialog.run(async () => { id = await saveBoqProject({ id: p?.id, kind: r.kind as BoqProject['kind'], ref: r.ref.trim(), project_name: r.project_name.trim(), customer_name: r.customer_name, inquiry_date: r.inquiry_date, notes: r.notes }); await reload(); }, p ? 'Saved' : undefined) && !p) openCustom(id);
  };
  const removeCustom = async (p: BoqProject) => {
    const n = savedCount.get(p.id) ?? 0;
    if (await dialog.confirm(`Delete ${p.ref}?`, n ? `Its ${n} saved BOQ match${n > 1 ? 'es are' : ' is'} deleted too.` : undefined, { confirmLabel: 'Delete', danger: true }))
      await dialog.run(async () => { await deleteBoqProject(p.id); await reload(); }, 'Deleted');
  };
  // deleting a saved match puts its estimate back in the list to choose from
  const removeSaved = async (s: Saved) => {
    const name = s.boq_projects ? s.boq_projects.ref : s.estimation_jobs?.inquiries?.code ?? 'this BOQ match';
    if (!(await dialog.confirm(`Delete the saved BOQ match of ${name}?`, `${s.file_name} and the choices made in it are deleted. This cannot be undone.`, { confirmLabel: 'Delete', danger: true }))) return;
    await dialog.run(async () => {
      const { data: gone, error: de } = await supabase.from('boq_matches').delete().eq('id', s.id).select('id');
      if (de) throw new Error(de.message);
      if (!gone?.length) throw new Error('You cannot delete this BOQ match');
      await reload();
    }, 'Deleted');
  };
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
                  title={s.boq_projects ? `${s.boq_projects.ref} · ${s.boq_projects.project_name} · not in the system` : `${s.estimation_jobs?.inquiries?.code ?? '—'} · ${s.estimation_jobs?.inquiries?.project_name ?? ''} · R${s.estimation_jobs?.revision ?? 0}`}
                  subtitle={`${s.file_name}${s.sheet ? ` › ${s.sheet}` : ''} · ${fit.length} lines · ${fit.filter((l) => l.chosen).length} chosen · ${fit.filter((l) => l.noMatch).length} no match · saved ${fmtDateTime(s.updated_at)}`}
                  right={
                    <Row gap={6} style={{ alignItems: 'center' }}>
                      <Button small variant="ghost" title="Delete" onPress={() => removeSaved(s)} />
                      <Button small variant="secondary" title="Open" onPress={() => open(s)} />
                    </Row>
                  }
                />
              );
            })}
          </Card>
        </Section>
      ) : null}
      {data ? <Field label="Search" value={search} onChangeText={setSearch} placeholder="Inquiry number, project or customer" /> : null}
      {data ? (
        <Section title="Inquiries not in the system" right={<Button small title="+ Add an inquiry" onPress={() => editCustom()} />}>
          <Muted>From before the system, or never registered in it – added here only to match their BOQ.</Muted>
          {customShown.length ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {customShown.map((p) => (
                <ListRow
                  key={p.id}
                  title={`${p.ref} · ${p.project_name}`}
                  subtitle={`${p.customer_name ?? '—'}${p.inquiry_date ? ` · ${fmtDate(p.inquiry_date)}` : ''}${savedCount.get(p.id) ? ` · ${savedCount.get(p.id)} saved match${savedCount.get(p.id)! > 1 ? 'es' : ''}` : ''}${p.notes ? ` · ${p.notes}` : ''}`}
                  onPress={() => openCustom(p.id)}
                  right={
                    <Row gap={6} style={{ alignItems: 'center' }}>
                      <Pill label={BOQ_PROJECT_KIND[p.kind]} tone={colors.amber} />
                      <Button small variant="ghost" title="Edit" onPress={() => editCustom(p)} />
                      <Button small variant="ghost" title="Delete" onPress={() => removeCustom(p)} />
                      <Button small title="BOQ match" onPress={() => openCustom(p.id)} />
                    </Row>
                  }
                />
              ))}
            </Card>
          ) : <Muted>{search ? 'None found.' : 'None added yet.'}</Muted>}
        </Section>
      ) : null}
      {data ? (
        <Section title="Start a BOQ match – choose the estimate">
          <Muted>Estimates with a saved BOQ match are under Recently saved – delete the saved match to start again from here.</Muted>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {shown.length ? shown.map((j) => (
              <ListRow
                key={j.id}
                title={`${j.inquiries?.code ?? '—'} · ${j.inquiries?.project_name ?? ''} · R${j.revision}`}
                subtitle={`${j.inquiries?.customer_name ?? '—'} · ${human(j.status)} · source ${j.source}`}
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
