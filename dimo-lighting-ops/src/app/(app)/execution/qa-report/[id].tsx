/* eslint-disable react-hooks/refs, react-hooks/immutability -- the document text is kept in a ref (not re-rendered on every key) */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { DocEditor } from '@/components/exec/DocEditor';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Field, Grid, Loading, Muted, Notice, Pill, Row, Screen, Segmented, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject, TestRecord } from '@/lib/execution';
import { esc } from '@/lib/export';
import { fmtDateNum, fmtDateTimeY, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { headerHtml, printQaReport, QA_STATUS, type PageSetup, type QaReport } from '@/lib/qaReport';
import { ROLE_LABELS } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';

const TONE: Record<QaReport['status'], string> = { draft: colors.grey, submitted: colors.amber, approved: colors.green, returned: colors.red };

/** One QA / QC test report: written like a Word document on A4 pages, saved as a draft, submitted to the SEE, published as PDF. */
export default function QaReportScreen() {
  const { id, project: projectParam } = useLocalSearchParams<{ id: string; project?: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const isNew = id === 'new';
  const { data, error, reload } = useLoad(async () => {
    const r = isNew ? null : ((await supabase.from('qa_reports').select('*').eq('id', id).single()).data as QaReport | null);
    const pid = r?.exec_project_id ?? projectParam ?? '';
    const [{ data: p }, { data: tests }] = await Promise.all([
      supabase.from('exec_projects').select('*').eq('id', pid).single(),
      supabase.from('test_records').select('*').eq('exec_project_id', pid).order('performed_at', { ascending: false }).limit(50),
    ]);
    return { r, project: p as ExecProject, tests: (tests ?? []) as TestRecord[] };
  }, [id, projectParam]);

  const [title, setTitle] = useState('');
  const [setup, setSetup] = useState<PageSetup>({ orientation: 'portrait', margins: 'normal' });
  const [testId, setTestId] = useState<string | null>(null);
  const html = useRef('');
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const key = data ? `${data.r?.id ?? 'new'}:${data.r?.version ?? 0}:${data.r?.status ?? ''}` : '';
  if (data && key !== loadedKey) {
    setLoadedKey(key);
    setTitle(data.r?.title ?? '');
    setSetup(data.r?.page_setup ?? { orientation: 'portrait', margins: 'normal' });
    setTestId(data.r?.test_record_id ?? null);
    html.current = data.r?.content_html ?? '';
    setDirty(false);
  }

  const r = data?.r ?? null;
  const author = !r || r.created_by === me.id;
  const editable = author && (!r || r.status === 'draft' || r.status === 'returned') && (me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer');
  const see = me.role === 'senior_elec_engineer';

  const save = async (quiet = false) => {
    if (!data) return null;
    if (!title.trim()) {
      if (!quiet) dialog.toast('Enter the report title', 'error');
      return null;
    }
    const rid = await rpc<string>('save_qa_report', { p_exec: data.project.id, p_id: r?.id ?? null, p: { title, content_html: html.current, page_setup: setup, test_record_id: testId ?? '' } });
    setDirty(false);
    setSavedAt(new Date().toISOString());
    if (isNew) router.replace(`/execution/qa-report/${rid}`);
    return rid;
  };
  // Draft autosave every 30 seconds while editing
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!editable || isNew) return;
    const t = setInterval(() => {
      if (dirtyRef.current) void saveRef.current(true).catch(() => undefined);
    }, 30000);
    return () => clearInterval(t);
  }, [editable, isNew]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Warn before leaving the website with unsaved changes
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const p = data.project;
  const hdr = { project: p, code: r?.code ?? '', title: title || 'Untitled report', version: r?.version ?? 1, status: r?.status ?? 'draft', date: fmtDateNum(r?.submitted_at ?? r?.updated_at ?? todayISO()) } as const;
  const snippets = data.tests.map((t) => ({
    key: t.id,
    label: `${t.code} · ${t.test_type} – ${t.system}`,
    html: `<h3>${esc(`${t.test_type} – ${t.system}`)}${t.area ? esc(` (${t.area})`) : ''}</h3><p>Test ${esc(t.code)} on ${esc(fmtDateTimeY(t.performed_at))}${t.witness ? ` · witness ${esc(t.witness)}` : ''}</p><table><tbody><tr><th>Parameter</th><th>Measured</th><th>Unit</th><th>Min</th><th>Max</th><th>Result</th></tr>${t.rows
      .map((x) => `<tr><td>${esc(x.param)}</td><td>${esc(String(x.value ?? ''))}</td><td>${esc(x.unit ?? '')}</td><td>${esc(x.min != null ? String(x.min) : '—')}</td><td>${esc(x.max != null ? String(x.max) : '—')}</td><td>${x.pass ? 'Pass' : '<b style="color:#C8102E">Fail</b>'}</td></tr>`)
      .join('')}</tbody></table><p><br></p>`,
  }));
  const pdf = () =>
    dialog.run(async () => {
      if (dirty && editable) await save(true);
      await printQaReport(
        { code: r?.code ?? 'Draft', title, content_html: html.current, page_setup: setup, status: r?.status ?? 'draft', version: r?.version ?? 1, created_at: r?.created_at ?? '', decided_at: r?.decided_at ?? null },
        hdr,
        {
          preparedBy: `${people[r?.created_by ?? me.id]?.full_name ?? ''}${people[r?.created_by ?? me.id] ? ` – ${ROLE_LABELS[people[r?.created_by ?? me.id].role]}` : ''}`,
          preparedAt: r?.submitted_at ?? null,
          approvedBy: r?.status === 'approved' ? people[r.decided_by ?? '']?.full_name ?? '' : null,
          approvedAt: r?.status === 'approved' ? r.decided_at : null,
        },
      );
    });
  const decide = async (ok: boolean) => {
    const res = await dialog.prompt({ title: ok ? 'Approve and publish' : 'Return the report', fields: [{ key: 'n', label: ok ? 'Comment (optional)' : 'What needs to change', type: 'multiline', required: !ok }], confirmLabel: ok ? 'Approve' : 'Return' });
    if (res) await dialog.run(async () => { await rpc('decide_qa_report', { p_id: r!.id, p_approve: ok, p_note: res.n || null }); await reload(); }, ok ? 'Approved – published' : 'Returned to the author');
  };

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: r ? `${r.code} · Test report` : 'New test report' }} />
      <TestingBanner what="QA / QC test reports" />
      <Card style={{ gap: 6 }}>
        <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Muted style={{ flex: 1, minWidth: 220 }}>{`${p.wbs_no || p.code || ''} ${p.name}${r ? ` · ${r.code} · version ${r.version}` : ''}`}</Muted>
          <Pill label={QA_STATUS[r?.status ?? 'draft']} tone={TONE[r?.status ?? 'draft']} solid={r?.status === 'approved'} />
        </Row>
        {r?.decision_note ? <Notice tone={r.status === 'returned' ? colors.red : colors.blue}>{`${people[r.decided_by ?? '']?.full_name ?? 'SEE'}: ${r.decision_note}`}</Notice> : null}
        {r?.status === 'submitted' && !see ? <Notice tone={colors.amber}>Submitted – waiting for the Senior Electrical Engineer. It can be edited again if it is returned.</Notice> : null}
        {editable ? (
          <>
            <Field label="Report title" required value={title} onChangeText={(v) => { setTitle(v); setDirty(true); }} placeholder="e.g. Insulation resistance test – DB-2 and sub-circuits" />
            <Grid min={240}>
              <View style={{ gap: 4 }}>
                <Muted>Page</Muted>
                <Segmented value={setup.orientation} onChange={(v) => { setSetup((s) => ({ ...s, orientation: v })); setDirty(true); }} options={[{ value: 'portrait', label: 'A4 portrait' }, { value: 'landscape', label: 'A4 landscape' }]} />
              </View>
              <View style={{ gap: 4 }}>
                <Muted>Margins</Muted>
                <Segmented value={setup.margins} onChange={(v) => { setSetup((s) => ({ ...s, margins: v })); setDirty(true); }} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }]} />
              </View>
            </Grid>
            {data.tests.length ? (
              <Select label="Linked test record (optional)" value={testId} onChange={(v) => { setTestId(v || null); setDirty(true); }} options={[{ value: '', label: '— none —' }, ...data.tests.map((t) => ({ value: t.id, label: `${t.code} · ${t.test_type} – ${t.system}` }))]} />
            ) : null}
          </>
        ) : null}
        <Row wrap gap={8} style={{ marginTop: 4, alignItems: 'center' }}>
          {editable ? <Button title="Save draft" variant="secondary" onPress={() => dialog.run(async () => { await save(); }, 'Draft saved')} /> : null}
          {editable && r ? (
            <Button
              title={r.status === 'returned' ? 'Resubmit to the SEE' : 'Submit to the SEE'}
              onPress={async () => {
                if (await dialog.confirm('Submit the report?', 'It goes to the Senior Electrical Engineer for approval and cannot be edited unless it is returned.', { confirmLabel: 'Submit' }))
                  await dialog.run(async () => { await save(true); await rpc('submit_qa_report', { p_id: r.id }); await reload(); }, 'Submitted for approval');
              }}
            />
          ) : null}
          <Button variant="secondary" title={r?.status === 'approved' ? 'PDF (published)' : 'Preview PDF'} onPress={pdf} />
          {see && r?.status === 'submitted' ? (
            <>
              <Button title="Approve & publish" onPress={() => decide(true)} />
              <Button variant="secondary" title="Return" onPress={() => decide(false)} />
            </>
          ) : null}
          {editable && r?.status === 'draft' ? (
            <Button variant="ghost" title="Delete draft" onPress={async () => {
              if (await dialog.confirm('Delete this draft?', 'It cannot be recovered.', { danger: true, confirmLabel: 'Delete' }))
                await dialog.run(async () => { await rpc('delete_qa_report', { p_id: r.id }); router.back(); }, 'Draft deleted');
            }} />
          ) : null}
          {editable ? <Muted>{dirty ? 'Unsaved changes – saved automatically every 30 s' : savedAt ? `Saved ${fmtDateTimeY(savedAt)}` : r ? `Last saved ${fmtDateTimeY(r.updated_at)}` : 'Save the draft to start'}</Muted> : null}
        </Row>
      </Card>
      <View style={{ marginTop: 10 }}>
        <DocEditor
          docKey={loadedKey}
          initialHtml={data.r?.content_html ?? ''}
          onChange={(v) => { if (v !== html.current) { html.current = v; setDirty(true); } }}
          readOnly={!editable}
          header={headerHtml(hdr)}
          setup={setup}
          snippets={snippets}
        />
      </View>
    </Screen>
  );
}
