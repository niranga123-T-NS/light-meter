import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { ReportBody, reportExcel, reportPdf } from '@/components/SqReportView';
import { Button, Card, colors, ErrorBanner, Loading, Muted, Notice, Pill, Row, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_SHORT } from '@/lib/roles';
import { loadProject, projectReport } from '@/lib/sqAnalysis';
import { jobField, jobSource, loadJobs, type SqJob } from '@/lib/supplierQuotes';
import { supabase } from '@/lib/supabase';

/** A project on one page: every package, who quoted, who is lowest and chosen, how far prices came down – then each package for the detail */
export default function Project() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sqAccess, sqReports, profile } = useAuth();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(() => loadProject(id), [id]);
  if (!sqAccess && !sqReports) return <Screen><Notice tone={colors.amber}>No access to supplier quotes.</Notice></Screen>;
  // report readers (SM Estimation, allowed estimators) see the project read only
  const ro = !sqAccess;
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { project: j, pkgs, quotes, suppliers } = data;
  const rep = projectReport(pkgs, quotes, suppliers);
  const closed = j.status !== 'open';
  const meta = () => ({
    key: 'supplier_project', title: `${j.name} – supplier quotes`, filters: [j.code, j.client, j.job_ref].filter(Boolean).join(' · '), period: fmtDate(j.created_at),
    currencyNote: 'LKR delivered – freight, discounts and priced-back exclusions included', generatedBy: `${profile?.full_name ?? ''} – ${profile ? ROLE_SHORT[profile.role] : ''}`, landscape: true,
  });

  const addPackage = async () => {
    const r = await dialog.prompt({
      title: 'New package',
      message: `What is being bought or subcontracted for ${j.name}. Add the quotes to it and compare them.`,
      fields: [
        { key: 'title', label: 'Package', required: true, hint: 'e.g. LED floodlights, Lattice masts, Mast foundations' },
        { key: 'kind', label: 'Type', type: 'select', required: true, initial: 'supply', options: [{ value: 'supply', label: 'Supply' }, { value: 'subcontract', label: 'Subcontract' }] },
        { key: 'stage', label: 'Start at', type: 'select', required: true, initial: 'pre_bid', options: [{ value: 'pre_bid', label: 'Pre Bid – pricing our tender' }, { value: 'post_bid', label: 'Post Bid – tender already done (e.g. started before the system)' }] },
        { key: 'valid', label: 'Our quotation is valid until (Pre Bid only)', type: 'date', initial: j.our_validity ?? '', hint: 'Warns when a supplier\'s quote ends before it – not used at Post Bid' },
        { key: 'weeks', label: 'Needed on site within (weeks)', hint: 'Lead times longer than this are flagged' },
      ],
      confirmLabel: 'Create',
    });
    if (!r) return;
    await dialog.run(async () => {
      const { data: p, error: e } = await supabase.from('sq_packages')
        .insert({ project_id: j.id, title: r.title.trim(), kind: r.kind, stage: r.stage === 'post_bid' ? 'post_bid' : 'pre_bid', our_validity: r.stage === 'post_bid' ? null : r.valid || null, needed_weeks: Number(r.weeks) > 0 ? Number(r.weeks) : null })
        .select('id').single();
      if (e) throw new Error(e.message);
      router.push(`/supplier-quotes/${p.id}`);
    });
  };
  const edit = async () => {
    const jobs = await loadJobs().catch(() => [] as SqJob[]);
    const r = await dialog.prompt({
      title: 'Edit project',
      fields: [
        { ...jobField(jobs, j.source_kind && j.source_id ? `${j.source_kind}:${j.source_id}` : ''), fill: (v: string): Record<string, string> => { const x = jobs.find((y) => `${y.kind}:${y.id}` === v); return x ? { name: x.project_name ?? '', client: x.client ?? '', job: x.ref ?? '' } : {}; } },
        { key: 'name', label: 'Project', required: true, initial: j.name },
        { key: 'client', label: 'Client', initial: j.client ?? '' },
        { key: 'job', label: 'Job or inquiry reference', initial: j.job_ref ?? '' },
        { key: 'valid', label: 'Our quotation is valid until (Pre Bid)', type: 'date', initial: j.our_validity ?? '' },
        { key: 'notes', label: 'Notes', type: 'multiline', initial: j.notes ?? '' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      const { error: e } = await supabase.from('sq_projects').update({ name: r.name.trim(), client: r.client?.trim() || null, job_ref: r.job?.trim() || null, ...jobSource(r.src), our_validity: r.valid || null, notes: r.notes?.trim() || null }).eq('id', j.id);
      if (e) throw new Error(e.message);
      reload();
    }, 'Saved');
  };
  const setStatus = async (status: 'open' | 'closed' | 'cancelled') => {
    if (status !== 'open' && !(await dialog.confirm(status === 'closed' ? 'Close the project?' : 'Cancel the project?', 'Its packages and quotes stay in the reports and the price history.'))) return;
    await dialog.run(async () => { const { error: e } = await supabase.from('sq_projects').update({ status }).eq('id', j.id); if (e) throw new Error(e.message); reload(); });
  };

  return (
    <Screen maxWidth={1400}>
      <Stack.Screen options={{ title: j.name }} />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{[j.code, j.client, j.job_ref, j.our_validity && (!pkgs.length || pkgs.some((p) => (p.stage ?? 'pre_bid') === 'pre_bid')) ? `our quotation valid until ${fmtDate(j.our_validity)}` : null].filter(Boolean).join(' · ')}</Muted>
          <Row gap={8} style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{j.name}</Text>
            {closed ? <Pill label={j.status === 'closed' ? 'Closed' : 'Cancelled'} tone={colors.grey} /> : null}
          </Row>
        </View>
        <Row wrap gap={8}>
          {!closed && !ro ? <Button title="Add a package" icon="＋" onPress={addPackage} /> : null}
          {!ro ? <Button variant="secondary" title="Edit" onPress={edit} /> : null}
          <Button variant="secondary" title="Export PDF" onPress={() => dialog.run(() => reportPdf(rep, meta(), 'Every package of the project: who quoted, who is lowest and chosen, and how far prices came down.'))} />
          <Button variant="secondary" title="Excel" onPress={() => dialog.run(() => reportExcel(rep, meta()))} />
          {ro ? null : closed ? <Button variant="secondary" title="Reopen" onPress={() => setStatus('open')} /> : <Button variant="ghost" title="Close" onPress={() => setStatus('closed')} />}
        </Row>
      </Row>
      {j.notes ? <Card><Muted>{j.notes}</Muted></Card> : null}
      <ReportBody rep={rep} />
    </Screen>
  );
}
