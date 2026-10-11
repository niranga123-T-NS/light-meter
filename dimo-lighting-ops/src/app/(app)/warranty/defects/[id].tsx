import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import {
  DEFECT_CATEGORY,
  DEFECT_MANAGERS,
  DEFECT_OPEN,
  DEFECT_SOURCE,
  DEFECT_STATUS,
  labelOf,
  PHASE,
  RESPONSIBLE,
  SEVERITY,
  severityTone,
  type Defect,
} from '@/lib/defects';
import type { ExecMember } from '@/lib/execution';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const DUE_DAYS = { critical: 2, major: 7, minor: 14 } as const;

/** One project defect: verify, assign, rectify (with an after photo), close or reopen. */
export default function DefectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: d, error: e } = await supabase.from('project_defects').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const df = d as Defect;
    const m = df.exec_project_id ? await supabase.from('exec_members').select('*').eq('exec_project_id', df.exec_project_id).eq('active', true) : { data: [] };
    return { d: df, members: (m.data ?? []) as ExecMember[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { d, members } = data;
  const st = DEFECT_STATUS[d.status];
  const manager = DEFECT_MANAGERS.includes(me.role);
  const projectAe = me.role === 'assistant_engineer' && members.some((x) => x.user_id === me.id && x.member_role === 'assistant_engineer');
  const canRectify = d.status === 'assigned' && (d.assignee_id === me.id || manager || projectAe);
  const late = d.status === 'assigned' && !!d.due_date && d.due_date < todayISO();
  const pn = (u: string | null) => (u ? (people[u]?.full_name ?? '') : '');
  // Engineers to assign: the project's AEs first, then every AE and SEE
  const engineers = Object.values(people)
    .filter((p) => p.active !== false && (p.role === 'assistant_engineer' || p.role === 'senior_elec_engineer'))
    .sort((a, b) => Number(members.some((m) => m.user_id === b.id)) - Number(members.some((m) => m.user_id === a.id)) || a.full_name.localeCompare(b.full_name));

  const verify = async (ok: boolean) => {
    const r = ok
      ? await dialog.confirm('Verify the defect', 'It becomes an open defect, to assign.', { confirmLabel: 'Verify' })
      : await dialog.prompt({ title: 'Not a defect / not ours', fields: [{ key: 'n', label: 'Reason (the reporter is told)', type: 'multiline', required: true }], confirmLabel: 'Reject', danger: true });
    if (r)
      await dialog.run(async () => {
        await rpc('verify_defect', { p_id: d.id, p_ok: ok, p_reason: typeof r === 'object' ? r.n : null });
        await reload();
      }, ok ? 'Verified' : 'Not accepted');
  };
  const assign = async () => {
    const r = await dialog.prompt({
      title: d.assignee_id ? 'Reassign' : 'Assign the defect',
      fields: [
        {
          key: 'a',
          label: 'Engineer',
          type: 'select',
          required: true,
          initial: d.assignee_id ?? undefined,
          options: engineers.map((p) => ({ value: p.id, label: p.full_name, hint: members.some((m) => m.user_id === p.id) ? 'on this project' : p.role === 'senior_elec_engineer' ? 'SEE' : undefined })),
        },
        { key: 'r', label: 'Who is responsible', type: 'select', required: true, initial: d.responsible ?? 'dimo', options: RESPONSIBLE },
        { key: 'c', label: 'Subcontractor / company (for a back-charge)', initial: d.responsible_company ?? undefined },
        { key: 'due', label: 'Due date', type: 'date', required: true, initial: d.due_date ?? addDaysISO(todayISO(), DUE_DAYS[d.severity]) },
      ],
      confirmLabel: 'Assign',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('assign_defect', { p_id: d.id, p: { assignee_id: r.a, responsible: r.r, responsible_company: r.c || null, due_date: r.due } });
        await reload();
      }, 'Assigned – the engineer is told');
  };
  const rectify = async () => {
    const r = await dialog.prompt({
      title: 'Rectified',
      message: 'Attach a photo after the rectification first (Photos below).',
      fields: [{ key: 'n', label: 'What was done', type: 'multiline', required: true }],
      confirmLabel: 'Record',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('rectify_defect', { p_id: d.id, p_action: r.n });
        await reload();
      }, 'Recorded – the SEE / SM Projects checks and closes it');
  };
  const close = async (ok: boolean) => {
    const r = await dialog.prompt({
      title: ok ? 'Close the defect' : 'Reopen – not fixed',
      fields: [{ key: 'n', label: ok ? 'Note (checked with the client …)' : 'What is still wrong', type: 'multiline', required: !ok }],
      confirmLabel: ok ? 'Close' : 'Reopen',
      danger: !ok,
    });
    if (r)
      await dialog.run(async () => {
        await rpc('close_defect', { p_id: d.id, p_close: ok, p_note: r.n || null });
        await reload();
      }, ok ? 'Closed' : 'Reopened');
  };

  return (
    <Screen maxWidth={1000} onRefresh={reload}>
      <Stack.Screen options={{ title: d.code }} />
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, flex: 1 }}>{`${d.code} · ${d.title}`}</Text>
        <Pill label={labelOf(SEVERITY, d.severity).split(' –')[0]} tone={severityTone(d.severity)} solid={d.severity === 'critical'} />
        <Pill label={st.label} tone={st.tone} solid />
      </Row>
      {late ? <Notice tone={colors.red}>{`Overdue – due ${fmtDate(d.due_date)}`}</Notice> : null}
      {d.status === 'rejected' ? <Notice tone={colors.grey}>{`Not accepted by ${pn(d.verified_by)}: ${d.reject_reason ?? ''}`}</Notice> : null}
      {d.reopen_count ? <Notice tone={colors.amber}>{`Reopened ${d.reopen_count} time(s) – last: ${d.last_reopen_reason ?? ''}`}</Notice> : null}
      {d.responsible === 'manufacturer' && DEFECT_OPEN.includes(d.status) ? (
        <Notice tone={colors.blue}>The manufacturer is responsible – raise a product warranty claim for the faulty items.</Notice>
      ) : null}

      <Card>
        <KeyValue label="Project" value={[d.project_name, d.customer].filter(Boolean).join(' · ')} />
        <KeyValue label="Where" value={[d.site, d.location].filter(Boolean).join(' · ') || '—'} />
        <KeyValue label="When" value={PHASE[d.phase]} />
        <KeyValue label="What is wrong" value={d.description} />
        <KeyValue label="Category" value={labelOf(DEFECT_CATEGORY, d.category)} />
        <KeyValue label="Reported" value={`${pn(d.reported_by)} · ${fmtDateTime(d.reported_at)} · ${d.source === 'sales' ? 'reported by sales' : labelOf(DEFECT_SOURCE, d.source)}${d.client_ref ? ` · ref ${d.client_ref}` : ''}`} />
        {d.assignee_id ? (
          <KeyValue
            label="Assigned"
            value={`${pn(d.assignee_id)} · due ${fmtDate(d.due_date)} · ${labelOf(RESPONSIBLE, d.responsible)}${d.responsible_company ? ` (${d.responsible_company})` : ''}`}
          />
        ) : null}
        {d.rectification ? <KeyValue label="Rectification" value={`${d.rectification} · ${pn(d.rectified_by)} · ${fmtDateTime(d.rectified_at)}`} /> : null}
        {d.closed_at ? <KeyValue label="Closed" value={`${pn(d.closed_by)} · ${fmtDateTime(d.closed_at)}${d.close_note ? ` · ${d.close_note}` : ''}`} /> : null}
      </Card>

      <Attachments
        entityType="project_defect"
        entityId={d.id}
        kinds={['defect_photo', ...(canRectify || d.status === 'rectified' ? ['defect_after'] : [])]}
        title="Photos (before and after)"
        allowCamera
        canUpload={DEFECT_OPEN.includes(d.status)}
      />

      <Section title="Progress">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {[
            ['Reported', true, `${pn(d.reported_by)} · ${fmtDateTime(d.reported_at)}`],
            ['Verified', !!d.verified_at && d.status !== 'rejected', d.verified_at ? `${pn(d.verified_by)} · ${fmtDateTime(d.verified_at)}` : 'SEE / SM Projects'],
            ['Assigned', !!d.assigned_at, d.assigned_at ? `${pn(d.assigned_by)} → ${pn(d.assignee_id)} · ${fmtDateTime(d.assigned_at)}` : 'SEE / SM Projects'],
            ['Rectified', !!d.rectified_at && d.status !== 'assigned', d.rectified_at ? `${pn(d.rectified_by)} · ${fmtDateTime(d.rectified_at)}` : 'the engineer, with an after photo'],
            ['Closed', d.status === 'closed', d.closed_at ? `${pn(d.closed_by)} · ${fmtDateTime(d.closed_at)}` : 'SEE / SM Projects, after checking'],
          ].map(([t, done, sub]) => (
            <ListRow key={t as string} title={`${done ? '✓' : '○'} ${t}`} subtitle={sub as string} right={done ? <Pill label="Done" tone={colors.green} /> : null} />
          ))}
        </Card>
      </Section>

      <Row wrap gap={8}>
        {manager && d.status === 'reported' ? (
          <>
            <Button title="Verify" onPress={() => verify(true)} />
            <Button variant="danger" title="Not a defect" onPress={() => verify(false)} />
          </>
        ) : null}
        {manager && ['reported', 'open', 'assigned'].includes(d.status) ? <Button title={d.assignee_id ? 'Reassign' : 'Assign'} variant={d.status === 'assigned' ? 'secondary' : 'primary'} onPress={assign} /> : null}
        {canRectify ? <Button title="Record the rectification" onPress={rectify} /> : null}
        {manager && d.status === 'rectified' ? (
          <>
            <Button title="Close" onPress={() => close(true)} />
            <Button variant="secondary" title="Reopen – not fixed" onPress={() => close(false)} />
          </>
        ) : null}
      </Row>
    </Screen>
  );
}
