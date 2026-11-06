import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { useDialog } from '@/components/dialog';
import { EstimationTabs, useEstimationTab } from '@/components/EstimationTabs';
import type React from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, ErrorBanner, Loading, Muted, Pill, Row, Screen } from '@/components/ui';
import { SearchBox } from '@/components/tools/BrandFilter';
import { EstIcon, IconBtn, Segments, Tip, ToolBar } from '@/components/tools/EstUi';
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
  const head = (t: string, n: number, right?: React.ReactNode) => (
    <Row gap={8} style={{ alignItems: 'center', marginTop: 10, marginBottom: 2, paddingHorizontal: 2 }}>
      <Text style={{ fontSize: 13, fontWeight: '800', color: '#334155' }}>{t}</Text>
      <Text style={{ fontSize: 11, fontWeight: '700', color: '#334155', backgroundColor: '#e2e8f0', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>{n}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </Row>
  );
  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: 'Estimation' }} />
      <EstimationTabs value="boq" />
      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <ToolBar>
          <SearchBox value={search} onChange={setSearch} placeholder="Inquiry number, project or customer" />
          <Pressable onPress={() => editCustom()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.brand }}>
            <EstIcon name="plus" size={16} />
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Inquiry not in the system</Text>
          </Pressable>
          <IconBtn icon="info" title="BOQ match" text="Upload the client's BOQ Excel for an estimate – every light-fitting line gets the best options from the catalogue library, the estimator chooses one, and the Excel comes back with the choices and options. Inquiries not in the system: from before the system, or never registered – added here only to match their BOQ." />
        </ToolBar>
      ) : null}
      {data?.saved.length ? (
        <>
          {head('Recently saved', data.saved.length)}
          <Rows>
            {data.saved.map((s) => {
              const fit = s.lines.filter((l) => l.kind === 'fitting');
              const chosen = fit.filter((l) => l.chosen).length, none = fit.filter((l) => l.noMatch).length;
              return (
                <IRow
                  key={s.id}
                  onPress={() => open(s)}
                  title={s.boq_projects ? `${s.boq_projects.ref} · ${s.boq_projects.project_name} · not in the system` : `${s.estimation_jobs?.inquiries?.code ?? '—'} · ${s.estimation_jobs?.inquiries?.project_name ?? ''} · R${s.estimation_jobs?.revision ?? ''}`}
                  subtitle={`${s.file_name}${s.sheet ? ` › ${s.sheet}` : ''} · ${fit.length} lines · ${chosen} chosen · ${none} no match · saved ${fmtDateTime(s.updated_at)}`}
                  right={
                    <>
                      <Segments done={fit.length ? Math.round((chosen / fit.length) * 5) : 0} />
                      <IconBtn icon="open" title="Open" text={`Opens the saved BOQ match: ${chosen} of ${fit.length} lines chosen${none ? `, ${none} with no match` : ''}.`} onPress={() => open(s)} />
                      <IconBtn icon="del" title="Delete" text="Deletes this saved BOQ match and the choices made in it." onPress={() => removeSaved(s)} />
                    </>
                  }
                />
              );
            })}
          </Rows>
        </>
      ) : null}
      {data ? (
        <>
          {head('Inquiries not in the system', customShown.length)}
          {customShown.length ? (
            <Rows>
              {customShown.map((p) => (
                <IRow
                  key={p.id}
                  onPress={() => openCustom(p.id)}
                  title={`${p.ref} · ${p.project_name}`}
                  subtitle={`${p.customer_name ?? '—'}${p.inquiry_date ? ` · ${fmtDate(p.inquiry_date)}` : ''}${savedCount.get(p.id) ? ` · ${savedCount.get(p.id)} saved match${savedCount.get(p.id)! > 1 ? 'es' : ''}` : ''}`}
                  right={
                    <>
                      <Pill label={BOQ_PROJECT_KIND[p.kind]} tone={colors.amber} />
                      <IconBtn icon="boq" title="BOQ match" text="Match this inquiry's BOQ Excel against the catalogue." onPress={() => openCustom(p.id)} />
                      <IconBtn icon="edit" title="Edit" text="Reference, project, customer and date." onPress={() => editCustom(p)} />
                      <IconBtn icon="del" title="Delete" text="Deletes this inquiry and its saved BOQ matches." onPress={() => removeCustom(p)} />
                    </>
                  }
                />
              ))}
            </Rows>
          ) : <Muted>{search ? 'None found.' : 'None added yet – “+ Inquiry not in the system” adds one.'}</Muted>}
        </>
      ) : null}
      {data ? (
        <>
          {head('Start a BOQ match – choose the estimate', shown.length, <Tip title="Saved matches" text="Estimates with a saved BOQ match are under Recently saved – delete the saved match to start again from here." style={{ padding: 4 }}><EstIcon name="info" size={15} /></Tip>)}
          <Rows>
            {shown.length ? shown.map((j) => (
              <IRow
                key={j.id}
                onPress={() => router.push(`/estimation/boq/${j.id}`)}
                title={`${j.inquiries?.code ?? '—'} · ${j.inquiries?.project_name ?? ''} · R${j.revision}`}
                subtitle={`${j.inquiries?.customer_name ?? '—'} · ${human(j.status)} · source ${j.source}`}
                right={<IconBtn icon="boq" title="BOQ match" text="Upload this estimate's BOQ Excel and match every line." onPress={() => router.push(`/estimation/boq/${j.id}`)} />}
              />
            )) : <IRow title="No estimates found" />}
          </Rows>
        </>
      ) : null}
    </Screen>
  );
}

/** A list of compact rows */
function Rows({ children }: { children: React.ReactNode }) {
  return <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, overflow: 'visible', backgroundColor: '#fff' }}>{children}</View>;
}
/** A compact row: the Excel icon, title and details, and icon actions */
function IRow({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eef2f7' }}>
      <View style={{ width: 34, height: 34, borderRadius: 6, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' }}><EstIcon name="xls" size={18} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.ink }} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      <Row gap={6} wrap style={{ alignItems: 'center', justifyContent: 'flex-end' }}>{right}</Row>
    </Pressable>
  );
}
