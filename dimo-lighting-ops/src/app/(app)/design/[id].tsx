import { router, Stack, useLocalSearchParams } from 'expo-router';
import { designScopeText, estimationScopeText } from '@/lib/constants';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Attachments, KIND_LABELS } from '@/components/Attachments';
import { BrandEditor } from '@/components/BrandEditor';
import { DesignNotes } from '@/components/DesignNotes';
import { JobTimeRow, PercentChips } from '@/components/TimeBar';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, NumberField, Pill, Progress, Row, Screen, Section, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { openAttachment } from '@/lib/files';
import { endOfWorkDay, fmtDate, fmtDateISO, fmtDateTime, fmtWorkDays, human, WORKING_HOURS_PER_DAY, inquiryTitle } from '@/lib/format';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment, BrandLine, DesignJob } from '@/lib/types';

type Clarification = { id: string; question: string; asked_by: string; asked_at: string; answer: string | null; answered_at: string | null };

const DELIVERABLES = [
  'Lighting layout drawings (DWG / PDF)',
  'Lighting calculation reports (DIALux / Relux + PDF), lux and uniformity summary',
  'Luminaire schedule with codes and quantities',
  'Control / DALI / BMS integration schematic',
  'Renders or concept presentation',
];
const ELECTRICAL = ['Single-line diagram', 'DB / panel schedules', 'Cable schedule', 'Load and voltage-drop calculation report', 'Electrical BOQ'];

/** Design job workspace (Section 6) – designer / engineer and Design Manager only. */
export default function DesignJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const masters = useMasters();
  const dialog = useDialog();
  const [progress, setProgress] = useState<number | null>(null);
  const [hours, setHours] = useState<number | null>(null);
  const [brands, setBrands] = useState<BrandLine[]>([]);
  const [milestones, setMilestones] = useState<{ name: string; done?: boolean }[]>([]);

  const { data, error, reload } = useLoad(async () => {
    const { data: j, error: e } = await supabase
      .from('design_jobs')
      .select('*, inquiries(code, project_name, inquiry_name, customer_name, customer_deadline, route, design_due_at, status, solution_level, manufacturing_origin, expectation_notes, scope_description, design_scope, estimation_scope, estimation_basis, design_required_by, revision)')
      .eq('id', id)
      .single();
    if (e) throw new Error(e.message);
    const job = j as DesignJob;
    const [files, clar] = await Promise.all([
      rpc<Attachment[]>('inquiry_files', { p_inquiry: job.inquiry_id }).catch(() => []),
      supabase.from('clarifications').select('*').eq('design_job_id', id).order('asked_at', { ascending: false }),
    ]);
    return { job, requestFiles: files.filter((f) => f.entity_type === 'inquiry'), clarifications: (clar.data ?? []) as Clarification[] };
  }, [id]);

  const [loaded, setLoaded] = useState<unknown>(null);
  if (data && data !== loaded) {
    setLoaded(data);
    setProgress(data.job.progress_pct);
    setBrands(data.job.brands_specified ?? []);
    setMilestones(
      data.job.milestones?.length
        ? data.job.milestones
        : (data.job.task_type === 'electrical' ? ELECTRICAL : ['Concept', 'Layout', 'Calculations', 'Final drawings']).map((name) => ({ name, done: false })),
    );
  }

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { job: j } = data;
  const inq = j.inquiries;
  const mine = j.assignee_id === me.id;
  const dm = me.role === 'design_manager' || me.role === 'gm';
  const active = ['assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested'].includes(j.status);
  // The designer edits brands while working; the Design Manager can still complete them in review or after approval (until release)
  const brandsEditable = (mine && active) || (dm && (active || ['in_review', 'approved'].includes(j.status)));
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: `${inq?.code ?? ''} · ${j.task_type}` }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>{inquiryTitle(inq)}</Text>
            <Muted>
              {inq?.customer_name} · {j.task_type} design · R{j.revision} · Design Rev {j.review_cycles} · {j.job_size} job
            </Muted>
          </View>
          <Pill label={human(j.status)} tone={j.status === 'returned' ? colors.amber : j.status === 'on_hold' ? colors.grey : colors.blue} solid />
        </Row>
        <View style={{ marginVertical: 8 }}>
          <Progress pct={j.progress_pct} colour={colors.blue} />
        </View>
        {active ? <JobTimeRow entityType="design_job" jobId={j.id} updatedAt={j.progress_updated_at ?? j.created_at} progress={j.progress_pct} reloadKey={data} /> : null}
        <Row wrap>
          <KeyValue label="Assignee" value={people[j.assignee_id ?? '']?.full_name ?? '—'} />
          <KeyValue label="Due" value={fmtDateTime(j.due_at)} />
          <KeyValue label="Original due" value={fmtDateTime(j.original_due_at)} />
          {inq?.design_required_by ? <KeyValue label="Sales requested" value={fmtDate(inq.design_required_by)} /> : null}
          <KeyValue label="Customer deadline" value={fmtDate(inq?.customer_deadline)} />
          <KeyValue label="Days logged" value={fmtWorkDays(j.hours_logged)} />
          <KeyValue label="Design revision" value={`Rev ${j.review_cycles}${j.review_cycles ? ` (returned ${j.review_cycles}×)` : ' (first submission)'}`} />
          <KeyValue label="Client expectation" value={`${human(inq?.solution_level)} · ${human(inq?.manufacturing_origin)}`} />
          <KeyValue label="Design scope" value={designScopeText(inq?.design_scope)} />
          <KeyValue label="Estimation scope" value={estimationScopeText(inq?.estimation_scope, inq?.estimation_basis)} />
        </Row>
        {j.review_comment ? (
          <Notice tone={j.status === 'returned' ? colors.amber : colors.blue}>
            {j.status === 'returned' ? `Returned – prepare Design Rev ${j.review_cycles}. ` : ''}Design Manager: {j.review_comment}
          </Notice>
        ) : null}
        {j.status === 'on_hold' ? <Notice tone={colors.grey}>On hold: {j.hold_reason} · waiting on {j.hold_waiting_on}</Notice> : null}
        {j.status === 'date_change_requested' ? <Notice tone={colors.amber}>Due date change requested: {fmtDateTime(j.requested_due_at)}</Notice> : null}

        <Row wrap gap={8} style={{ marginTop: 8 }}>
          {mine && j.status === 'assigned' ? (
            <>
              <Button title="Confirm due date" onPress={() => run('acknowledge_design_job', { p_job: j.id }, 'Confirmed')} />
              <Button
                variant="secondary"
                title="Request another date"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Request a date change', fields: [{ key: 'd', label: 'Proposed date', type: 'date', required: true }, { key: 'n', label: 'Why', type: 'multiline', required: true }] });
                  if (r) await run('acknowledge_design_job', { p_job: j.id, p_requested_due: endOfWorkDay(r.d), p_note: r.n }, 'Request sent to the Design Manager');
                }}
              />
            </>
          ) : null}
          {mine && active && j.status !== 'assigned' ? (
            <Button
              title="Submit for review"
              onPress={async () => {
                if (!(await dialog.confirm('Submit for review?', 'The Design Manager will review and approve or return it.'))) return;
                await dialog.run(async () => {
                  const filled = brands.filter((b) => b.group && b.brand);
                  if (j.task_type === 'lighting' && !filled.length) throw new Error('Enter the brands specified in the design (section below) before submitting');
                  await rpc('set_design_brands', { p_job: j.id, p_brands: filled });
                  await rpc('submit_design_for_review', { p_job: j.id });
                  await reload();
                }, 'Submitted for review');
              }}
            />
          ) : null}
          {(mine || dm) && active ? (
            <Button
              variant="secondary"
              title="Put on hold"
              onPress={async () => {
                const r = await dialog.prompt({
                  title: 'Put on hold (clock pauses)',
                  fields: [
                    { key: 'r', label: 'Hold reason', type: 'select', required: true, options: masters.values('hold_reason').map((v) => ({ value: v, label: v })) },
                    { key: 'w', label: 'Waiting on (person)', required: true },
                  ],
                });
                if (r) await run('hold_job', { p_entity_type: 'design_job', p_job: j.id, p_reason: r.r, p_waiting_on: r.w }, 'On hold');
              }}
            />
          ) : null}
          {(mine || dm) && j.status === 'on_hold' ? <Button title="Resume" onPress={() => run('resume_job', { p_entity_type: 'design_job', p_job: j.id }, 'Resumed')} /> : null}
          {dm && j.status === 'in_review' ? (
            <>
              <Button title="Approve design" onPress={() => run('review_design', { p_job: j.id, p_approve: true }, 'Approved')} />
              <Button
                variant="danger"
                title="Return with comments"
                onPress={async () => {
                  const r = await dialog.prompt({
                    title: 'Return for changes',
                    message: inq?.customer_deadline ? `The new due date cannot be after the customer deadline (${fmtDate(inq.customer_deadline)}).` : undefined,
                    fields: [
                      { key: 'c', label: 'Review comments', type: 'multiline', required: true },
                      { key: 'd', label: 'Revision due by', type: 'date', required: true, initial: inq?.customer_deadline ?? undefined },
                    ],
                  });
                  if (r) await run('review_design', { p_job: j.id, p_approve: false, p_comment: r.c, p_due: r.d }, 'Returned – the designer is told the new due date');
                }}
              />
            </>
          ) : null}
          {dm && active ? (
            <>
              <Button
                variant="secondary"
                title="Change due date"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Change due date (versioned)', fields: [{ key: 'd', label: 'New due date', type: 'date', required: true }, { key: 'r', label: 'Reason', type: 'multiline', required: true }] });
                  if (r) await run('change_job_due_date', { p_entity_type: 'design_job', p_job: j.id, p_new_due: endOfWorkDay(r.d), p_reason: r.r }, 'Due date changed');
                }}
              />
              <Button
                variant="secondary"
                title="Reassign"
                onPress={async () => {
                  const { data: ds } = await supabase.from('profiles').select('id, full_name').in('role', ['lighting_designer', 'lighting_engineer']).eq('active', true);
                  const day = j.due_at ? fmtDateISO(j.due_at) : undefined;
                  const limits = [
                    inq?.route === 'A' && inq.design_due_at ? `the approved design completion date (${fmtDate(inq.design_due_at)})` : null,
                    inq?.customer_deadline ? `the customer deadline (${fmtDate(inq.customer_deadline)})` : null,
                  ].filter(Boolean);
                  const r = await dialog.prompt({
                    title: 'Reassign design job',
                    message: `Set a new due date for the new designer if needed – keep the date to continue the same clock.${limits.length ? ` The due date cannot be after ${limits.join(' or ')}.` : ''}`,
                    fields: [
                      { key: 'a', label: 'New assignee', type: 'select', required: true, options: (ds ?? []).filter((x) => x.id !== j.assignee_id).map((x) => ({ value: x.id, label: x.full_name })) },
                      { key: 'd', label: 'Due date', type: 'date', required: true, initial: day },
                      { key: 'r', label: 'Reason', type: 'multiline', required: true },
                    ],
                  });
                  if (r) await run('reassign_job', { p_entity_type: 'design_job', p_job: j.id, p_assignee: r.a, p_reason: r.r, p_due: r.d === day ? null : endOfWorkDay(r.d) }, 'Reassigned');
                }}
              />
            </>
          ) : null}
          <Button variant="ghost" title="Open inquiry" onPress={() => router.push(`/inquiries/${j.inquiry_id}`)} />
        </Row>
      </Card>

      {mine && active && j.status !== 'assigned' ? (
        <Section title="Work and log">
          <Card>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>Progress – tap or type</Text>
            <PercentChips value={progress} onChange={setProgress} />
            <NumberField label="Progress" suffix="%" value={progress} onChange={setProgress} />
            <Muted>Update it at least once a day – a reminder comes at 3:30 pm if not, and the Design Manager is told after 2 working days without an update.</Muted>
            <NumberField label="Days worked today (e.g. 0.5 or 1)" suffix="days" value={hours} onChange={setHours} />
            <Muted style={{ marginBottom: 4 }}>Milestones</Muted>
            <Row wrap gap={12}>
              {milestones.map((m, idx) => (
                <Toggle key={m.name} label={m.name} value={!!m.done} onChange={(v) => setMilestones((s) => s.map((x, k) => (k === idx ? { ...x, done: v } : x)))} />
              ))}
            </Row>
            <Button
              title="Save progress"
              onPress={() =>
                dialog.run(async () => {
                  await rpc('update_design_progress', { p_job: j.id, p_progress: progress ?? 0, p_hours: hours == null ? null : hours * WORKING_HOURS_PER_DAY, p_milestones: milestones });
                  setHours(null);
                  await reload();
                }, 'Progress saved')
              }
            />
          </Card>
        </Section>
      ) : null}

      <Section title="Scope from sales">
        <Card>
          <Text>{inq?.scope_description ?? '—'}</Text>
          {inq?.expectation_notes ? <Muted>Client notes: {inq.expectation_notes}</Muted> : null}
          {data.requestFiles.map((f) => (
            <ListRow key={f.id} title={f.file_name} subtitle={KIND_LABELS[f.kind] ?? f.kind} right={<Button small variant="secondary" title="Open" onPress={() => dialog.run(() => openAttachment(f))} />} />
          ))}
        </Card>
      </Section>

      <Section title="Deliverables checklist">
        <Card>
          {(j.task_type === 'electrical' ? ELECTRICAL : DELIVERABLES).map((d) => (
            <Muted key={d}>• {d}</Muted>
          ))}
          <Muted style={{ marginTop: 6 }}>Upload drafts while working; upload the final set as the design pack before submitting. Every version is kept.</Muted>
        </Card>
      </Section>

      <Attachments entityType="design_job" entityId={j.id} kinds={['design_draft', 'design_pack']} title="Design files" canUpload={mine || dm} />

      <Section title="Brands specified in the design">
        <Card>
          <BrandEditor value={brands} onChange={setBrands} readOnly={!brandsEditable} expectedLevel={inq?.solution_level} expectedOrigin={inq?.manufacturing_origin} />
          {brandsEditable ? (
            <Button small title="Save brands" onPress={() => dialog.run(() => rpc('set_design_brands', { p_job: j.id, p_brands: brands.filter((b) => b.group && b.brand) }), 'Brands saved')} />
          ) : null}
        </Card>
      </Section>

      <DesignNotes inquiryId={j.inquiry_id} jobId={j.id} canAdd={mine || dm} />

      <Section title="Clarifications from Estimation">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {data.clarifications.map((c) => (
            <ListRow
              key={c.id}
              title={c.question}
              subtitle={c.answer ? `Answer: ${c.answer} · ${fmtDateTime(c.answered_at)}` : `Asked by ${people[c.asked_by]?.full_name ?? ''} · ${fmtDateTime(c.asked_at)}`}
              highlight={c.answer ? undefined : colors.amber}
              right={
                !c.answer && (mine || dm) ? (
                  <Button
                    small
                    title="Answer"
                    onPress={async () => {
                      const r = await dialog.prompt({ title: 'Answer clarification', message: c.question, fields: [{ key: 'a', label: 'Answer', type: 'multiline', required: true }] });
                      if (r) await run('answer_clarification', { p_clarification: c.id, p_answer: r.a }, 'Answered – estimator notified');
                    }}
                  />
                ) : undefined
              }
            />
          ))}
          {!data.clarifications.length ? <Muted style={{ padding: 12 }}>None</Muted> : null}
        </Card>
      </Section>
    </Screen>
  );
}
