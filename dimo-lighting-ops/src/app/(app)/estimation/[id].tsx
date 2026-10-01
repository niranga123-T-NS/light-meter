import { router, Stack, useLocalSearchParams } from 'expo-router';
import { designScopeText, estimationScopeText } from '@/lib/constants';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Attachments, KIND_LABELS } from '@/components/Attachments';
import { BrandEditor } from '@/components/BrandEditor';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, Field, KeyValue, ListRow, Loading, Muted, Notice, NumberField, Pill, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { openAttachment } from '@/lib/files';
import { endOfWorkDay, fmtDate, fmtDateTime, fmtMoney, human } from '@/lib/format';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment, BrandLine, EstimationJob } from '@/lib/types';

type Clarification = { id: string; question: string; asked_at: string; answer: string | null; answered_at: string | null };

/** Estimation job workspace (Section 7) – SM Estimation and the assigned estimator. */
export default function EstimationJobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const masters = useMasters();
  const dialog = useDialog();
  const [est, setEst] = useState({ quoted_value: null as number | null, cost: null as number | null, margin_pct: null as number | null, validity_days: 30 as number | null, alternatives: '', design_version: '' });
  const [brands, setBrands] = useState<BrandLine[]>([]);
  const [waits, setWaits] = useState<EstimationJob['supplier_waits']>([]);

  const { data, error, reload } = useLoad(async () => {
    const { data: j, error: e } = await supabase
      .from('estimation_jobs')
      .select('*, inquiries(code, project_name, customer_name, customer_deadline, route, status, duty_status, currency, project_type, solution_level, manufacturing_origin, expectation_notes, scope_description, design_scope, estimation_scope, estimation_basis, quotation_required_by, debtor_flag, revision)')
      .eq('id', id)
      .single();
    if (e) throw new Error(e.message);
    const job = j as EstimationJob;
    const [costing, files, clar] = await Promise.all([
      supabase.from('estimation_costing').select('*').eq('estimation_job_id', id).maybeSingle(),
      rpc<Attachment[]>('inquiry_files', { p_inquiry: job.inquiry_id }).catch(() => []),
      supabase.from('clarifications').select('*').eq('estimation_job_id', id).order('asked_at', { ascending: false }),
    ]);
    return {
      job,
      costing: costing.data as { cost: number | null; margin_pct: number | null } | null,
      inputFiles: files.filter((f) => f.entity_type === 'inquiry' || (f.entity_type === 'design_job' && f.kind === 'design_pack')),
      clarifications: (clar.data ?? []) as Clarification[],
    };
  }, [id]);

  const [loaded, setLoaded] = useState<unknown>(null);
  if (data && data !== loaded) {
    setLoaded(data);
    setEst({
      quoted_value: data.job.quoted_value,
      cost: data.costing?.cost ?? null,
      margin_pct: data.costing?.margin_pct ?? null,
      validity_days: data.job.validity_days,
      alternatives: data.job.alternatives ?? '',
      design_version: data.job.design_version_used ?? '',
    });
    setBrands(data.job.brands_offered ?? []);
    setWaits(data.job.supplier_waits ?? []);
  }

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { job: j } = data;
  const inq = j.inquiries;
  const cur = inq?.currency ?? 'LKR';
  const mine = j.assignee_id === me.id;
  const sme = me.role === 'sm_estimation' || me.role === 'gm';
  const editable = mine && ['assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested'].includes(j.status);
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);
  const saveEstimate = () =>
    rpc('save_estimate', {
      p_job: j.id,
      p_quoted_value: est.quoted_value,
      p_cost: est.cost,
      p_margin_pct: est.margin_pct ?? (est.quoted_value && est.cost ? Math.round(((est.quoted_value - est.cost) / est.quoted_value) * 1000) / 10 : null),
      p_brands: brands.filter((b) => b.group && b.brand),
      p_validity_days: est.validity_days ?? 30,
      p_alternatives: est.alternatives || null,
      p_supplier_waits: waits,
      p_design_version: est.design_version || null,
    });

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: `${inq?.code ?? ''} · Estimate` }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>{inq?.project_name}</Text>
            <Muted>
              {inq?.customer_name} · {projectTypeLabel(inq?.project_type)} · source {j.source}
              {j.revision ? ` · Client rev ${j.revision}` : ''}
            </Muted>
          </View>
          <Row gap={6}>
            <Pill label={`${inq?.duty_status === 'duty_free' ? 'Duty Free' : 'Duty Paid'} · ${cur}`} tone={colors.blue} solid />
            <Pill label={human(j.status)} tone={j.status === 'returned' ? colors.amber : colors.blue} />
          </Row>
        </Row>
        {inq?.debtor_flag ? <Notice tone={colors.red}>This client has an outstanding-debt flag – consider pricing and payment terms.</Notice> : null}
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Estimator" value={people[j.assignee_id ?? '']?.full_name ?? 'Not assigned'} />
          <KeyValue label="Due" value={fmtDateTime(j.due_at)} />
          {inq?.quotation_required_by ? <KeyValue label="Quotation requested by" value={fmtDate(inq.quotation_required_by)} /> : null}
          <KeyValue label="Customer deadline" value={fmtDate(inq?.customer_deadline)} />
          <KeyValue label="Client expectation" value={`${human(inq?.solution_level)} · ${human(inq?.manufacturing_origin)}`} />
          <KeyValue label="Design scope" value={designScopeText(inq?.design_scope)} />
          <KeyValue label="Estimation scope" value={estimationScopeText(inq?.estimation_scope, inq?.estimation_basis)} />
          <KeyValue label="Quotation no." value={j.quotation_no ?? '—'} />
        </Row>
        {j.status === 'sm_projects_approval' ? <Notice tone={colors.blue}>Waiting for approval to release: SM Projects verifies, and from 15 Mn LKR (or below the margin floor) GM / DGM approves after SM Projects.</Notice> : null}
        {j.status === 'revision_requested' ? (
          <Notice tone={colors.red}>
            Sent back for revision (SM Projects or GM / DGM): {j.review_comment}
            {sme ? ' – assign it to an estimator (same or another) with a new due date.' : ' – SM Estimation will re-assign it.'}
          </Notice>
        ) : j.review_comment ? (
          <Notice tone={j.status === 'returned' ? colors.amber : colors.blue}>Reviewer: {j.review_comment}</Notice>
        ) : null}
        {j.needs_sm_projects && j.status === 'approved' ? <Notice tone={colors.green}>Approved – SM Estimation releases it to sales.</Notice> : null}
        {j.status === 'on_hold' ? <Notice tone={colors.grey}>On hold: {j.hold_reason}</Notice> : null}
        {j.status === 'date_change_requested' ? <Notice tone={colors.amber}>Date change requested: {fmtDateTime(j.requested_due_at)}</Notice> : null}

        <Row wrap gap={8} style={{ marginTop: 8 }}>
          {sme && j.status === 'queued' ? <Button title="Accept" onPress={() => run('accept_estimation', { p_job: j.id }, 'Accepted')} /> : null}
          {sme && ['accepted', 'assigned', 'acknowledged', 'in_progress', 'date_change_requested', 'returned', 'revision_requested'].includes(j.status) ? <AssignEstimator job={j} onDone={reload} /> : null}
          {mine && j.status === 'assigned' ? (
            <>
              <Button title="Confirm due date" onPress={() => run('acknowledge_estimation_job', { p_job: j.id }, 'Confirmed')} />
              <Button
                variant="secondary"
                title="Request another date"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Request a date change', fields: [{ key: 'd', label: 'Proposed date', type: 'date', required: true }, { key: 'n', label: 'Why', type: 'multiline', required: true }] });
                  if (r) await run('acknowledge_estimation_job', { p_job: j.id, p_requested_due: endOfWorkDay(r.d), p_note: r.n }, 'Request sent');
                }}
              />
            </>
          ) : null}
          {editable && j.status !== 'assigned' ? (
            <Button
              title="Submit for approval"
              onPress={() =>
                dialog.run(async () => {
                  await saveEstimate();
                  await rpc('submit_estimate_for_approval', { p_job: j.id });
                  await reload();
                }, 'Submitted to SM Estimation')
              }
            />
          ) : null}
          {sme && j.status === 'submitted_for_approval' ? (
            <>
              <Button
                title="Approve quotation"
                onPress={() =>
                  dialog.run(async () => {
                    const res = await rpc<string>('review_estimate', { p_job: j.id, p_approve: true });
                    if (res === 'gm_approval') dialog.toast('Above the value / below the margin limit – sent to GM / DGM for approval');
                    if (res === 'sm_projects_approval') dialog.toast('Sent to SM Projects (then GM / DGM from 15 Mn LKR) for approval to release');
                    await reload();
                  })
                }
              />
              <Button
                variant="danger"
                title="Return"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Return quotation', fields: [{ key: 'c', label: 'Comments', type: 'multiline', required: true }] });
                  if (r) await run('review_estimate', { p_job: j.id, p_approve: false, p_comment: r.c }, 'Returned');
                }}
              />
            </>
          ) : null}
          {(sme || (mine && !j.needs_sm_projects)) && j.status === 'approved' ? (
            <Button
              title="Release to sales"
              onPress={async () => {
                const r = await dialog.prompt({
                  title: 'Release quotation',
                  message: 'Final quotation PDF, compliance sheet and technical data sheets must be uploaded. A justification is needed only if brands do not match the client expectation.',
                  fields: [{ key: 'j', label: 'Brand justification (optional)', type: 'multiline' }],
                });
                if (r) await run('release_quotation', { p_job: j.id, p_justification: r.j || null }, 'Released – sales person notified');
              }}
            />
          ) : null}
          {(mine || sme) && editable ? (
            <Button
              variant="secondary"
              title={sme ? 'Put on hold' : 'Request hold'}
              onPress={async () => {
                const r = await dialog.prompt({
                  title: sme ? 'Put on hold' : 'Request estimation hold (SM Estimation approves)',
                  fields: [{ key: 'r', label: 'Reason', type: 'select', required: true, options: masters.values('hold_reason').map((v) => ({ value: v, label: v })) }],
                });
                if (r) await run('hold_job', { p_entity_type: 'estimation_job', p_job: j.id, p_reason: r.r }, sme ? 'On hold' : 'Hold requested');
              }}
            />
          ) : null}
          {(mine || sme) && j.status === 'on_hold' ? <Button title="Resume" onPress={() => run('resume_job', { p_entity_type: 'estimation_job', p_job: j.id }, 'Resumed')} /> : null}
          {sme && j.assignee_id && !['released'].includes(j.status) ? (
            <Button
              variant="secondary"
              title="Change due date"
              onPress={async () => {
                const r = await dialog.prompt({ title: 'Change due date', fields: [{ key: 'd', label: 'New due date', type: 'date', required: true }, { key: 'r', label: 'Reason', type: 'multiline', required: true }] });
                if (r) await run('change_job_due_date', { p_entity_type: 'estimation_job', p_job: j.id, p_new_due: endOfWorkDay(r.d), p_reason: r.r }, 'Due date changed');
              }}
            />
          ) : null}
          <Button variant="ghost" title="Open inquiry" onPress={() => router.push(`/inquiries/${j.inquiry_id}`)} />
        </Row>
      </Card>

      <Section title="Inputs (request documents and approved design pack)">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ padding: 12 }}>
            <Text>{inq?.scope_description ?? '—'}</Text>
          </View>
          {data.inputFiles.map((f) => (
            <ListRow key={f.id} title={f.file_name} subtitle={`${KIND_LABELS[f.kind] ?? f.kind} · v${f.version}`} right={<Button small variant="secondary" title="Open" onPress={() => dialog.run(() => openAttachment(f))} />} />
          ))}
        </Card>
      </Section>

      <Section title={`Estimate (${cur})`}>
        <Card>
          <NumberField label="Quoted value" suffix={cur} value={est.quoted_value} onChange={(v) => setEst((s) => ({ ...s, quoted_value: v }))} />
          <NumberField label="Cost (restricted)" suffix={cur} value={est.cost} onChange={(v) => setEst((s) => ({ ...s, cost: v }))} />
          <NumberField label="Margin % (calculated if blank)" value={est.margin_pct} onChange={(v) => setEst((s) => ({ ...s, margin_pct: v }))} />
          <NumberField label="Validity" suffix="days" value={est.validity_days} onChange={(v) => setEst((s) => ({ ...s, validity_days: v }))} />
          <Field label="Alternatives / value engineering" multiline value={est.alternatives} onChangeText={(v) => setEst((s) => ({ ...s, alternatives: v }))} />
          <Field label="Design version used" value={est.design_version} onChangeText={(v) => setEst((s) => ({ ...s, design_version: v }))} />
          <Muted>
            Current: {fmtMoney(j.quoted_value, cur)} · cost {fmtMoney(data.costing?.cost, cur)} · margin {data.costing?.margin_pct ?? '—'}%
          </Muted>
          <Text style={{ fontWeight: '700', marginTop: 12 }}>Brands offered (mandatory before release)</Text>
          <BrandEditor value={brands} onChange={setBrands} readOnly={!editable} expectedLevel={inq?.solution_level} expectedOrigin={inq?.manufacturing_origin} />
          <Text style={{ fontWeight: '700', marginTop: 12 }}>Supplier / principal price waits</Text>
          <Muted>Logged for reporting; they do not pause the clock unless SM Estimation approves a hold.</Muted>
          {waits.map((w, i) => (
            <Row key={i} wrap gap={8}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Field label="Supplier" editable={editable} value={w.supplier} onChangeText={(t) => setWaits((s) => s.map((x, k) => (k === i ? { ...x, supplier: t } : x)))} />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <DateField label="Expected" value={w.expected ?? null} onChange={(v) => setWaits((s) => s.map((x, k) => (k === i ? { ...x, expected: v ?? undefined } : x)))} quick={[]} />
              </View>
              <Select
                label="Status"
                value={w.received ? 'received' : 'waiting'}
                options={[
                  { value: 'waiting', label: 'Waiting' },
                  { value: 'received', label: 'Received' },
                ]}
                onChange={(v) => setWaits((s) => s.map((x, k) => (k === i ? { ...x, received: v === 'received' ? new Date().toISOString().slice(0, 10) : null } : x)))}
              />
            </Row>
          ))}
          {editable ? (
            <>
              <Button small variant="secondary" title="+ Supplier price request" onPress={() => setWaits((s) => [...s, { supplier: '', requested: new Date().toISOString().slice(0, 10), received: null }])} />
              <View style={{ height: 12 }} />
              <Button title="Save estimate" onPress={() => dialog.run(async () => { await saveEstimate(); await reload(); }, 'Saved')} />
            </>
          ) : null}
        </Card>
      </Section>

      <Attachments
        entityType="estimation_job"
        entityId={j.id}
        kinds={['quotation_draft', 'costing_sheet', 'quotation_final', 'compliance_sheet', 'technical_data']}
        title="Quotation files (renamed automatically with the quotation number)"
        canUpload={mine || sme}
      />
      <Notice>
        Submitted for approval needs the draft quotation PDF and costing sheet. Released to sales needs the final quotation PDF, compliance sheet and technical data sheets. Sales can download only
        the released quotation and supporting sheets.
      </Notice>

      {j.source === 'design' ? (
        <Section
          title="Clarifications to Design"
          right={
            mine || sme ? (
              <Button
                small
                title="+ Ask"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Clarification to the designer', fields: [{ key: 'q', label: 'Question', type: 'multiline', required: true }] });
                  if (r) await run('ask_clarification', { p_job: j.id, p_question: r.q }, 'Sent – unanswered after 1 working day is flagged to the Design Manager');
                }}
              />
            ) : undefined
          }
        >
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.clarifications.map((c) => (
              <ListRow key={c.id} title={c.question} subtitle={c.answer ? `Answer: ${c.answer} · ${fmtDateTime(c.answered_at)}` : `Waiting since ${fmtDateTime(c.asked_at)}`} highlight={c.answer ? undefined : colors.amber} />
            ))}
            {!data.clarifications.length ? <Muted style={{ padding: 12 }}>None</Muted> : null}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

function AssignEstimator({ job, onDone }: { job: EstimationJob; onDone: () => void }) {
  const dialog = useDialog();
  return (
    <Button
      variant={job.assignee_id ? 'secondary' : 'primary'}
      title={job.assignee_id ? 'Reassign / re-plan' : 'Assign estimator'}
      onPress={async () => {
        const [{ data: people }, def] = await Promise.all([
          supabase.from('profiles').select('id, full_name, role').in('role', ['am_estimation', 'estimation_exec']).eq('active', true),
          rpc<string | null>('default_estimator', { p_inquiry: job.inquiry_id }).catch(() => null),
        ]);
        const r = await dialog.prompt({
          title: 'Assign estimator',
          message: 'Pre-selected by project type. Assigning the other estimator needs a reason. The due date must leave 1 working day before the customer deadline.',
          fields: [
            { key: 'a', label: 'Estimator', type: 'select', required: true, initial: job.assignee_id ?? def ?? undefined, options: (people ?? []).map((p) => ({ value: p.id, label: `${p.full_name}${p.id === def ? ' (default)' : ''}` })) },
            { key: 'd', label: 'Estimation due date', type: 'date', required: true },
            {
              key: 'band',
              label: 'Value band',
              type: 'select',
              initial: job.value_band ?? 'medium',
              options: [
                { value: 'small', label: 'Small (under LKR 5 M) – 2 wd' },
                { value: 'medium', label: 'Medium (LKR 5–25 M) – 4 wd' },
                { value: 'large', label: 'Large (over LKR 25 M) – 7 wd' },
              ],
            },
            { key: 'r', label: 'Reason (other estimator / hand-over)', type: 'multiline' },
          ],
        });
        if (!r) return;
        await dialog.run(async () => {
          if (job.assignee_id && job.assignee_id !== r.a) {
            await rpc('reassign_job', { p_entity_type: 'estimation_job', p_job: job.id, p_assignee: r.a, p_reason: r.r || 'Hand-over' });
          }
          await rpc('assign_estimation_job', { p_job: job.id, p_assignee: r.a, p_due: endOfWorkDay(r.d), p_value_band: r.band, p_reason: r.r || null });
          onDone();
        }, 'Assigned – estimator notified');
      }}
    />
  );
}
