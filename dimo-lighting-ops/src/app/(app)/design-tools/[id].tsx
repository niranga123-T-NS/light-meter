import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, useWindowDimensions, View } from 'react-native';
import { DesignEngine } from '@/components/design-tools/DesignEngine';
import { requestState } from '@/components/design-tools/engineBridge';
import { TestingBanner } from '@/components/Testing';
import { useDialog } from '@/components/dialog';
import { Button, Card, ErrorBanner, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useAuth, useMe } from '@/lib/auth';
import {
  canUseDesignTools,
  DT_ACTION_LABEL,
  DT_STATUS,
  dtSummaryText,
  dtTemplateLabel,
  loadDesignEngine,
  deleteProfile,
  loadDrivers,
  loadProfiles,
  openDriverSheet,
  saveDriver,
  saveProfile,
  type DtFile,
  type DtLog,
  type DtOut,
  type DtRevision,
  type DtState,
  type EngineHandle,
} from '@/lib/designTools';
import { fmtDateTime } from '@/lib/format';
import { setImmersive } from '@/lib/immersive';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

type Inq = { id: string; code: string | null; project_name: string | null };

/** One design: the calculation page with save, revisions, check and approval */
/** Saves a file from the design page to the cache and opens Share (Save to Files, Mail, Print…) */
async function shareFile(name: string, mime: string, b64: string) {
  const { File: FsFile, Paths } = await import('expo-file-system');
  const Sharing = await import('expo-sharing');
  const f = new FsFile(Paths.cache, name.replace(/[\\/:*?"<>|]+/g, ''));
  f.create({ overwrite: true });
  f.write(b64, { encoding: 'base64' });
  await Sharing.shareAsync(f.uri, { mimeType: mime, dialogTitle: name, UTI: mime === 'application/pdf' ? 'com.adobe.pdf' : mime === 'application/zip' ? 'public.zip-archive' : undefined });
}

/** The driver library goes to the page with the design, and again after each driver saved from it */
async function sendDrivers(h: EngineHandle | null, saved?: { id: string; file_path: string | null; file_name: string | null }, error?: string) {
  try {
    h?.send({ type: 'dt:drivers', list: await loadDrivers(), saved, error });
  } catch (e) {
    h?.send({ type: 'dt:drivers', list: [], error: (e as Error).message });
  }
}

/** The import profiles go to the page with the design, and again after each save or delete from it */
async function sendProfiles(h: EngineHandle | null, error?: string) {
  try {
    h?.send({ type: 'dt:profiles', list: await loadProfiles(), error });
  } catch (e) {
    h?.send({ type: 'dt:profiles', list: [], error: (e as Error).message });
  }
}

export default function DesignToolScreen() {
  const { id, title: newTitle, tpl } = useLocalSearchParams<{ id: string; title?: string; tpl?: string }>();
  const isNew = id === 'new';
  const me = useMe();
  const { realRole } = useAuth();
  const people = usePeople();
  const dialog = useDialog();
  const { height } = useWindowDimensions();
  const engine = useRef<EngineHandle>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [meta, setMeta] = useState<{ title: string; inquiry: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);
  const allowed = canUseDesignTools(realRole);

  const { data, error, reload } = useLoad(async () => {
    if (!allowed) return null;
    const [eng, inqs] = await Promise.all([
      loadDesignEngine(),
      supabase.from('inquiries').select('id, code, project_name').order('created_at', { ascending: false }).limit(400),
    ]);
    if (isNew) return { eng, inqs: (inqs.data ?? []) as Inq[], file: null, state: { tpl: tpl || 'blank' } as DtState, revs: [] as DtRevision[], log: [] as DtLog[] };
    const [f, revs, log] = await Promise.all([
      supabase.from('design_tool_files').select('*, inquiries(code, project_name, inquiry_name)').eq('id', id).single(),
      supabase.from('design_tool_revisions').select('id, revision, summary, note, saved_by, saved_at').eq('file_id', id).order('revision', { ascending: false }),
      supabase.from('design_tool_log').select('*').eq('file_id', id).order('at', { ascending: false }).limit(50),
    ]);
    if (f.error) throw new Error(f.error.message);
    const { state, ...file } = f.data as DtFile & { state: DtState };
    return { eng, inqs: (inqs.data ?? []) as Inq[], file: file as DtFile, state, revs: (revs.data ?? []) as DtRevision[], log: (log.data ?? []) as DtLog[] };
  }, [id, allowed]);

  // first load: the title and inquiry the page shows
  const [metaFor, setMetaFor] = useState<string | null>(null);
  if (data && metaFor !== id) {
    setMetaFor(id);
    setMeta({ title: data.file?.title ?? newTitle ?? 'New design', inquiry: data.file?.inquiry_id ?? null });
  }
  // the page is opened once per design; later reloads (after a save) only refresh the details around it
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (ready && data && sent.current !== id) {
      sent.current = id;
      engine.current?.send({ type: 'dt:load', state: data.state, title: meta?.title });
      setDirty(isNew);
      void sendDrivers(engine.current);
      void sendProfiles(engine.current);
    }
  }, [ready, data, id, isNew, meta?.title]);

  // warn before closing the browser tab with unsaved work
  useEffect(() => {
    if (Platform.OS !== 'web' || !dirty) return;
    const on = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [dirty]);

  // full screen on the page: the app's sidebar, header, banners and the cards around the page step aside
  useEffect(() => {
    setImmersive(full);
  }, [full]);
  useEffect(() => () => setImmersive(false), []);

  const onMessage = useCallback((m: DtOut) => {
    if (m.type === 'dt:ready') setReady(true);
    else if (m.type === 'dt:fullscreen') setFull(m.on);
    else if (m.type === 'dt:dirty') setDirty(m.dirty);
    else if (m.type === 'dt:file' && Platform.OS !== 'web') void shareFile(m.name, m.mime, m.b64); // a sheet PDF from the page – the web view cannot download it itself
    else if (m.type === 'dt:drvSave')
      void saveDriver(m.driver, m.file).then(
        (saved) => {
          dialog.toast('Driver saved to the library');
          return sendDrivers(engine.current, saved);
        },
        (e: Error) => sendDrivers(engine.current, undefined, e.message),
      );
    else if (m.type === 'dt:drvOpen') void openDriverSheet(m.path, m.name).catch((e: Error) => dialog.toast(e.message, 'error'));
    else if (m.type === 'dt:profSave')
      void saveProfile(m.profile).then(
        () => {
          dialog.toast('Import profile saved for the design team');
          return sendProfiles(engine.current);
        },
        (e: Error) => sendProfiles(engine.current, e.message),
      );
    else if (m.type === 'dt:profDel') void deleteProfile(m.id).then(() => sendProfiles(engine.current), (e: Error) => sendProfiles(engine.current, e.message));
  }, [dialog]);

  if (!allowed) return <Screen><Notice>Design Tools are for the GM / DGM, SM Projects, the design team and the project engineers.</Notice></Screen>;
  if (error) return <Screen><ErrorBanner message={error} /></Screen>;
  if (!data || !meta) return <Screen><Loading label="Opening Design Tools…" /></Screen>;

  const f = data.file;
  const role = realRole;
  const status = f?.status ?? 'draft';
  const metaChanged = !!f && (meta.title !== f.title || (meta.inquiry ?? null) !== (f.inquiry_id ?? null));
  const unsaved = dirty || metaChanged || isNew;
  const inq = data.inqs.find((x) => x.id === meta.inquiry);

  const save = async () => {
    setBusy(true);
    try {
      const { state, summary } = await requestState(engine.current);
      const newId = await rpc<string>('design_tool_save', { p_id: f?.id ?? null, p_title: meta.title, p_inquiry: meta.inquiry, p_state: state, p_summary: summary, p_note: null, p_engine: data.eng.version });
      engine.current?.send({ type: 'dt:saved', title: meta.title });
      setDirty(false);
      dialog.toast('Saved');
      if (isNew) {
        sent.current = newId; // the page already shows this design
        setMetaFor(newId);
        router.replace({ pathname: '/design-tools/[id]', params: { id: newId } });
      } else reload();
    } catch (e) {
      dialog.toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const details = async () => {
    const v = await dialog.prompt({
      title: 'Title and inquiry',
      fields: [
        { key: 'title', label: 'Title', required: true, maxLength: 200, initial: meta.title },
        { key: 'inquiry', label: 'Inquiry (optional)', type: 'select', searchable: true, initial: meta.inquiry ?? '', options: [{ value: '', label: '— none —' }, ...data.inqs.map((i) => ({ value: i.id, label: [i.code, i.project_name].filter(Boolean).join(' – ') }))] },
      ],
      confirmLabel: 'Done',
    });
    if (v) {
      setMeta({ title: v.title.trim(), inquiry: v.inquiry || null });
      engine.current?.send({ type: 'dt:saved', title: v.title.trim() }); // the sheets' title block follows; the design itself is unchanged
    }
  };
  const decide = async (action: 'submit' | 'check' | 'approve' | 'return') => {
    if (!f) return;
    let note: string | null = null;
    if (action === 'return') {
      const v = await dialog.prompt({ title: 'Return the design', fields: [{ key: 'note', label: 'What needs to change', type: 'multiline', required: true }], confirmLabel: 'Return', danger: true });
      if (!v) return;
      note = v.note;
    } else if (!(await dialog.confirm({ submit: 'Send for checking?', check: 'Mark as checked?', approve: 'Approve this design?' }[action], `${f.title} · rev ${f.revision}`))) return;
    if (await dialog.run(() => rpc('design_tool_decide', { p_id: f.id, p_action: action, p_note: note }), { submit: 'Sent to the Design Manager', check: 'Checked – sent to SM Projects', approve: 'Approved', return: 'Returned' }[action])) reload();
  };
  const archive = async () => {
    if (!f) return;
    if (!f.archived && !(await dialog.confirm('Archive this design?', 'It leaves the list; it can be restored from Archived.', { danger: true, confirmLabel: 'Archive' }))) return;
    if (await dialog.run(() => rpc('design_tool_archive', { p_id: f.id, p_archived: !f.archived }), f.archived ? 'Restored' : 'Archived')) reload();
  };
  const openRev = async (r: DtRevision) => {
    if (unsaved && !(await dialog.confirm(`Open revision ${r.revision}?`, 'Unsaved changes on the page are replaced.'))) return;
    const { data: row, error: e } = await supabase.from('design_tool_revisions').select('state').eq('id', r.id).single();
    if (e) return dialog.toast(e.message, 'error');
    engine.current?.send({ type: 'dt:load', state: row.state as DtState, title: meta.title });
    setDirty(r.revision !== f?.revision);
    dialog.toast(r.revision === f?.revision ? 'Current revision' : `Revision ${r.revision} opened – save to make it the current one`);
  };

  const canCheck = role === 'design_manager' && status === 'for_check' && f?.updated_by !== me.id;
  const canApprove = (role === 'sm_projects' || role === 'gm') && status === 'checked';
  const canReturn = (role === 'design_manager' || role === 'sm_projects' || role === 'gm') && status !== 'draft';
  const canArchive = !!f && (f.created_by === me.id || role === 'design_manager' || role === 'sm_projects' || role === 'gm');

  return (
    <Screen maxWidth={1800} flush={full}>
      <Stack.Screen options={{ title: meta.title, headerShown: !full }} />
      {full ? null : <TestingBanner what="Design Tools" show />}
      {full ? null : (
      <Card>
        <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, minWidth: 240, gap: 4 }}>
            <Row wrap gap={6} style={{ alignItems: 'center' }}>
              <Pill label={f?.archived ? 'Archived' : DT_STATUS[status].label} tone={f?.archived ? '#6B7280' : DT_STATUS[status].tone} />
              {f ? <Pill label={`rev ${f.revision}`} /> : <Pill label="not saved yet" tone="#B45309" />}
              {unsaved ? <Pill label="unsaved changes" tone="#B45309" solid /> : null}
            </Row>
            <Muted>
              {[inq ? `Inquiry ${[inq.code, inq.project_name].filter(Boolean).join(' – ')}` : 'No inquiry linked', f ? dtTemplateLabel(f.template) : null, f ? dtSummaryText(f.summary) : null].filter(Boolean).join(' · ')}
            </Muted>
            {f ? (
              <Muted>
                {[`Saved by ${people[f.updated_by ?? f.created_by]?.full_name ?? '—'} ${fmtDateTime(f.updated_at)}`, f.checked_by ? `checked by ${people[f.checked_by]?.full_name ?? '—'} ${fmtDateTime(f.checked_at)}` : null, f.approved_by ? `approved by ${people[f.approved_by]?.full_name ?? '—'} ${fmtDateTime(f.approved_at)}` : null].filter(Boolean).join(' · ')}
              </Muted>
            ) : null}
          </View>
          <Row wrap gap={6}>
            <Button small variant="secondary" title="Title / inquiry" onPress={details} disabled={!!f?.archived} />
            <Button small title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={busy || !ready || !!f?.archived} />
            {f && !f.archived && status === 'draft' ? <Button small variant="secondary" title="Send for check" onPress={() => decide('submit')} disabled={unsaved} /> : null}
            {canCheck ? <Button small title="Checked" onPress={() => decide('check')} disabled={unsaved} /> : null}
            {canApprove ? <Button small title="Approve" onPress={() => decide('approve')} disabled={unsaved} /> : null}
            {canReturn ? <Button small variant="ghost" title="Return" onPress={() => decide('return')} /> : null}
            {canArchive ? <Button small variant="ghost" title={f?.archived ? 'Restore' : 'Archive'} onPress={archive} /> : null}
          </Row>
        </Row>
        {unsaved && f && status !== 'draft' ? <Muted>Saving a change makes a new revision and takes the design back to draft for checking again.</Muted> : null}
      </Card>
      )}
      {!ready ? <Loading label="Opening the calculation page…" /> : null}
      <DesignEngine ref={engine} html={data.eng.html} onMessage={onMessage} height={Math.max(640, height - 190)} full={full} />
      {f && !full ? (
        <Row wrap gap={12} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1, minWidth: 300 }}>
            <Section title="Revisions">
              <Card>
                {data.revs.map((r) => (
                  <ListRow
                    key={r.id}
                    title={`Rev ${r.revision}${r.revision === f.revision ? ' (current)' : ''}`}
                    subtitle={[dtSummaryText(r.summary), r.note, `${people[r.saved_by ?? '']?.full_name ?? ''} · ${fmtDateTime(r.saved_at)}`].filter(Boolean).join('\n')}
                    right={<Button small variant="ghost" title="Open" onPress={() => openRev(r)} />}
                  />
                ))}
              </Card>
            </Section>
          </View>
          <View style={{ flex: 1, minWidth: 300 }}>
            <Section title="History">
              <Card>
                {data.log.map((l) => (
                  <ListRow key={l.id} title={`${DT_ACTION_LABEL[l.action] ?? l.action}${l.revision ? ` · rev ${l.revision}` : ''}`} subtitle={[l.note, `${people[l.by_user ?? '']?.full_name ?? ''} · ${fmtDateTime(l.at)}`].filter(Boolean).join('\n')} />
                ))}
              </Card>
            </Section>
          </View>
        </Row>
      ) : null}
    </Screen>
  );
}
