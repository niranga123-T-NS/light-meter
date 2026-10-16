import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { TestingBanner } from '@/components/Testing';
import { useDialog } from '@/components/dialog';
import { Button, Card, Empty, ErrorBanner, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Segmented } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { canUseDesignTools, DT_STATUS, DT_TEMPLATES, dtSummaryText, dtTemplateLabel, type DtFile, type DtStatus } from '@/lib/designTools';
import { fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Filter = 'all' | DtStatus | 'archived';

/** Design Tools: the saved designs – electrical (SLD, network, cables, DBs, MV / standby), controls and KNX, earthing and LPS, poles and high masts */
export default function DesignToolsList() {
  const { realRole } = useAuth();
  const people = usePeople();
  const dialog = useDialog();
  const [filter, setFilter] = useState<Filter>('all');
  const allowed = canUseDesignTools(realRole);
  const { data, error, loading, reload } = useLoad(async () => {
    if (!allowed) return [] as DtFile[];
    const { data: rows, error: e } = await supabase
      .from('design_tool_files')
      .select('id, title, inquiry_id, template, revision, status, archived, summary, created_by, created_at, updated_by, updated_at, checked_by, checked_at, approved_by, approved_at, inquiries(code, project_name, inquiry_name)')
      .order('updated_at', { ascending: false })
      .limit(500);
    if (e) throw new Error(e.message);
    return (rows ?? []) as unknown as DtFile[];
  }, [allowed]);
  if (!allowed) return <Screen><Notice>Design Tools are for the GM / DGM, SM Projects and the design team.</Notice></Screen>;

  const rows = (data ?? []).filter((f) => (filter === 'archived' ? f.archived : !f.archived && (filter === 'all' || f.status === filter)));
  const count = (s: DtStatus) => (data ?? []).filter((f) => !f.archived && f.status === s).length;
  const mine = realRole === 'design_manager' ? count('for_check') : realRole === 'sm_projects' || realRole === 'gm' ? count('checked') : 0;

  const start = async () => {
    const v = await dialog.prompt({
      title: 'New design',
      fields: [
        { key: 'title', label: 'Title', required: true, maxLength: 200, hint: 'e.g. Hotel Galle – main LV, earthing and LPS' },
        { key: 'tpl', label: 'Start from', type: 'select', options: DT_TEMPLATES, initial: 'building', required: true },
      ],
      confirmLabel: 'Open',
    });
    if (v) router.push({ pathname: '/design-tools/[id]', params: { id: 'new', title: v.title.trim(), tpl: v.tpl } });
  };

  return (
    <Screen maxWidth={1100} refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Design Tools' }} />
      <TestingBanner what="Design Tools" show />
      <Card>
        <Row wrap gap={10} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Muted style={{ flex: 1, minWidth: 240 }}>
            Single line diagrams, network and cable sizing (ACL catalogues, BS 7671), DB layouts, MV panel, transformer, generator and ATS, protection settings, KNX (Jung), earthing and lightning protection, and pole / high-mast structural design. Every save keeps a revision; Design Manager checks, SM Projects or GM / DGM approves.
          </Muted>
          <Button title="+ New design" onPress={start} />
        </Row>
      </Card>
      {mine ? <Notice>{realRole === 'design_manager' ? `${mine} design${mine > 1 ? 's' : ''} waiting for your check.` : `${mine} checked design${mine > 1 ? 's' : ''} waiting for approval.`}</Notice> : null}
      <Segmented
        wrap
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'draft', label: `Drafts (${count('draft')})` },
          { value: 'for_check', label: `For check (${count('for_check')})` },
          { value: 'checked', label: `Checked (${count('checked')})` },
          { value: 'approved', label: `Approved (${count('approved')})` },
          { value: 'archived', label: 'Archived' },
        ]}
      />
      <ErrorBanner message={error} />
      {!data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title={filter === 'all' ? 'No designs yet' : 'Nothing here'} hint={filter === 'all' ? 'Start one with “New design”.' : undefined} />
      ) : (
        <Card>
          {rows.map((f) => (
            <ListRow
              key={f.id}
              title={`${f.title} · rev ${f.revision}`}
              subtitle={[
                f.inquiries ? [f.inquiries.code, f.inquiries.project_name].filter(Boolean).join(' – ') : null,
                dtTemplateLabel(f.template),
                dtSummaryText(f.summary),
                `${people[f.updated_by ?? f.created_by]?.full_name ?? ''} · ${fmtDateTime(f.updated_at)}`,
              ]
                .filter(Boolean)
                .join('\n')}
              right={<Pill label={f.archived ? 'Archived' : DT_STATUS[f.status].label} tone={f.archived ? '#6B7280' : DT_STATUS[f.status].tone} />}
              wrapRight
              onPress={() => router.push({ pathname: '/design-tools/[id]', params: { id: f.id } })}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
