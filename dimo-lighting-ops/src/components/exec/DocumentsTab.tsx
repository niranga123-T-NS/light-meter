import { router } from 'expo-router';
import { useState } from 'react';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ListRow, Pill, Row, Section, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { DOC_STATUS, DOC_TYPES, type DesignQuery, type ExecDoc, type ExecProject } from '@/lib/execution';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { QueryRows } from './QueryRows';

const REGISTER_ROLES = ['senior_elec_engineer', 'assistant_engineer', 'operations_exec', 'design_manager', 'lighting_designer', 'lighting_engineer'];

/** Document register (drawings, specifications, method statements, submittals) with revisions, and the design queries of the project. */
export function DocumentsTab({ p, queries = true }: { p: ExecProject; queries?: boolean }) {
  const me = useMe();
  const dialog = useDialog();
  const [open, setOpen] = useState<string | null>(null);
  const [old, setOld] = useState(false);
  const { data, reload } = useLoad(async () => {
    const [d, q] = await Promise.all([
      supabase.from('exec_docs').select('*').eq('exec_project_id', p.id).order('doc_no').order('uploaded_at', { ascending: false }),
      queries ? supabase.from('design_queries').select('*').eq('exec_project_id', p.id).order('raised_at', { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
    return { docs: (d.data ?? []) as ExecDoc[], queries: (q.data ?? []) as DesignQuery[] };
  }, [p.id, queries]);
  const docs = (data?.docs ?? []).filter((d) => old || d.status !== 'superseded');
  const canRegister = REGISTER_ROLES.includes(me.role);
  const canQuery = me.role === 'senior_elec_engineer' || me.role === 'assistant_engineer';

  const register = async (prev?: ExecDoc) => {
    const res = await dialog.prompt({
      title: prev ? `New revision – ${prev.doc_no}` : 'Register a document',
      fields: [
        { key: 'doc_no', label: 'Document number', required: true, initial: prev?.doc_no },
        { key: 'title', label: 'Title', required: true, initial: prev?.title },
        { key: 'doc_type', label: 'Type', type: 'select', required: true, options: DOC_TYPES, initial: prev?.doc_type ?? 'drawing' },
        { key: 'revision', label: 'Revision', required: true },
        { key: 'status', label: 'Status', type: 'select', required: true, initial: 'for_construction', options: [
          { value: 'for_construction', label: 'For construction (supersedes earlier)' },
          { value: 'for_approval', label: 'For approval' },
        ] },
        { key: 'approval_code', label: 'Consultant approval code', type: 'select', options: [
          { value: 'A', label: 'A – approved' },
          { value: 'B', label: 'B – approved with comments' },
          { value: 'C', label: 'C – revise and resubmit' },
          { value: 'rejected', label: 'Rejected' },
        ] },
        { key: 'subs', label: 'Issue to subcontractor supervisors', type: 'select', initial: prev?.issued_to_subs ? 'yes' : 'no', options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ] },
        { key: 'note', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: 'Register',
    });
    if (!res) return;
    await dialog.run(async () => {
      const id = await rpc<string>('register_doc', { p_exec: p.id, p: { ...res, issued_to_subs: res.subs === 'yes' } });
      setOpen(id);
      await reload();
    }, 'Registered – attach the file below');
  };

  return (
    <>
      <Section title="Document register" right={canRegister ? <Button small title="+ Register" onPress={() => register()} /> : null}>
        <Row style={{ marginBottom: 6 }}>
          <Toggle label="Show superseded revisions" value={old} onChange={setOld} />
        </Row>
        {docs.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {docs.map((d) => (
              <ListRow
                key={d.id}
                wrapRight
                onPress={() => setOpen(open === d.id ? null : d.id)}
                title={`${d.doc_no} rev ${d.revision} – ${d.title}`}
                subtitle={
                  <>
                    {`${DOC_TYPES.find((t) => t.value === d.doc_type)?.label ?? d.doc_type} · ${fmtDate(d.uploaded_at)}${d.issued_to_subs ? ' · issued to subcontractors' : ''}${d.note ? ` · ${d.note}` : ''}`}
                    {open === d.id ? (
                      <>
                        <Attachments entityType="exec_doc" entityId={d.id} kinds={['doc_file']} title="File" canUpload={d.uploaded_by === me.id} />
                        {canRegister && d.status !== 'superseded' ? <Button small variant="secondary" title="+ New revision" onPress={() => register(d)} /> : null}
                      </>
                    ) : null}
                  </>
                }
                right={
                  <Row gap={4}>
                    {d.approval_code ? <Pill label={`Code ${d.approval_code}`} tone={d.approval_code === 'A' ? colors.green : d.approval_code === 'B' ? colors.blue : colors.red} /> : null}
                    <Pill label={DOC_STATUS[d.status]} tone={d.status === 'for_construction' ? colors.green : d.status === 'superseded' ? colors.grey : colors.amber} />
                  </Row>
                }
              />
            ))}
          </Card>
        ) : (
          <Empty title="No documents registered" />
        )}
      </Section>
      {queries ? (
        <Section
          title="Design queries"
          right={
            canQuery && p.status === 'active' ? (
              <Button small variant="secondary" title="+ Design query" onPress={() => router.push({ pathname: '/execution/query/new', params: { project: p.id } })} />
            ) : null
          }
        >
          <QueryRows rows={data?.queries ?? []} />
        </Section>
      ) : null}
    </>
  );
}
