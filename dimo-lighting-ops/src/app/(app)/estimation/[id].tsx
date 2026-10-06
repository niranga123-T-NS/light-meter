import { router, Stack, useLocalSearchParams } from 'expo-router';
import { designScopeText, estimationScopeText } from '@/lib/constants';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Attachments, KIND_LABELS } from '@/components/Attachments';
import { BrandEditor } from '@/components/BrandEditor';
import { DesignNotes } from '@/components/DesignNotes';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, Field, KeyValue, ListRow, Loading, Muted, Notice, NumberField, Pill, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { openAttachment } from '@/lib/files';
import { endOfWorkDay, fmtDate, fmtDateISO, fmtDateTime, fmtMoney, human } from '@/lib/format';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Attachment, BrandLine, EstimationJob, Quotation } from '@/lib/types';

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
    const [costing, files, clar, prevJobs] = await Promise.all([
      supabase.from('estimation_costing').select('*').eq('estimation_job_id', id).maybeSingle(),
      rpc<Attachment[]>('inquiry_files', { p_inquiry: job.inquiry_id }).catch(() => []),
      supabase.from('clarifications').select('*').eq('estimation_job_id', id).order('asked_at', { ascending: false }),
      // Earlier (released) estimates of this inquiry – the quotations already submitted
      job.revision > 0
        ? supabase.from('estimation_jobs').select('*').eq('inquiry_id', job.inquiry_id).lt('revision', job.revision).eq('status', 'released').order('revision', { ascending: false })
        : Promise.resolve({ data: [] as EstimationJob[] }),
    ]);
    const prev = (prevJobs.data ?? []) as EstimationJob[];
    const prevIds = prev.map((p) => p.id);
    const [prevQuotes, prevFiles, prevCosting] = prevIds.length
      ? await Promise.all([
          supabase.from('quotations').select('*').in('estimation_job_id', prevIds),
          supabase.from('attachments').select('*').eq('entity_type', 'estimation_job').in('entity_id', prevIds).is('archived_at', null).order('uploaded_at', { ascending: false }),
          supabase.from('estimation_costing').select('*').in('estimation_job_id', prevIds),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
    return {
      job,
      costing: costing.data as { cost: number | null; margin_pct: number | null } | null,
      inputFiles: files.filter((f) => f.entity_type === 'inquiry' || (f.entity_type === 'design_job' && f.kind === 'design_pack')),
      clarifications: (clar.data ?? []) as Clarification[],
      previous: prev.map((p) => ({
        job: p,
        quote: ((prevQuotes.data ?? []) as Quotation[]).find((q) => q.estimation_job_id === p.id) ?? null,
        files: ((prevFiles.data ?? []) as Attachment[]).filter((f) => f.entity_id === p.id),
        costing: ((prevCosting.data ?? []) as { estimation_job_id: string; cost: number | null; margin_pct: number | null }[]).find((c) => c.estimation_job_id === p.id) ?? null,
      })),
    };
  }, [id]);

  const [loaded, setLoaded] = useState<unknown>(null);
  if (data && data !== loaded) {
    setLoaded(data);
    // Figures priced in another currency (duty status changed) are not carried into the boxes – they must be re-priced
    // (a released quotation is never re-priced: it keeps its own figures and currency)
    const repriced = data.job.status === 'released' || !data.job.price_currency || data.job.price_currency === (data.job.inquiries?.currency ?? 'LKR');
    setEst({
      quoted_value: repriced ? data.job.quoted_value : null,
      cost: repriced ? (data.costing?.cost ?? null) : null,
      margin_pct: repriced ? (data.costing?.margin_pct ?? null) : null,
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
  const inqCur = inq?.currency ?? 'LKR';
  // A released quotation stays in the currency it was offered in, even if the duty status changed later
  const cur = j.status === 'released' ? (j.price_currency ?? inqCur) : inqCur;
  // Currency the saved figures were priced in (differs from cur after a duty change until re-priced)
  const priceCur = j.price_currency ?? cur;
  const mine = j.assignee_id === me.id;
  const sme = me.role === 'sm_estimation' || me.role === 'gm';
  const editable = mine && ['assigned', 'acknowledged', 'in_progress', 'returned', 'date_change_requested'].includes(j.status);
  // SM Estimation can enter / correct the brands offered on a quotation awaiting approval or release
  const brandsBySme = sme && ['submitted_for_approval', 'sm_projects_approval', 'gm_approval', 'approved'].includes(j.status);
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);
  // A product group without a brand (or a brand without a group) is an error, never silently dropped
  const checkBrands = () => {
    const half = brands.find((b) => (b.group?.trim() && !b.brand) || (!b.group?.trim() && b.brand));
    if (half) throw new Error(half.group?.trim() ? `Choose the brand for “${half.group.trim()}” (or remove the line)` : 'Enter the product group for each brand');
  };
  const saveEstimate = async () => {
    checkBrands();
    return rpc('save_estimate', {
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
  };

  return (
    <Screen maxWidth={1000}>
      <Stack.Screen options={{ title: `${inq?.code ?? ''} · Estimate` }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700' }}>{inq?.project_name}</Text>
            <Muted>
              {inq?.customer_name} · {projectTypeLabel(inq?.project_type)} · source {j.source} · R{j.revision}
            </Muted>
          </View>
          <Row gap={6}>
            <Pill label={`${inq?.duty_status === 'duty_free' ? 'Duty Free' : 'Duty Paid'} · ${inqCur}`} tone={colors.blue} solid />
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
          {j.docs_not_applicable?.compliance_sheet ? <KeyValue label="Compliance sheet" value={`Not applicable – ${j.docs_not_applicable.compliance_sheet}`} /> : null}
          {j.docs_not_applicable?.technical_data ? <KeyValue label="Data sheets" value={`Not applicable – ${j.docs_not_applicable.technical_data}`} /> : null}
        </Row>
        {j.status === 'sm_projects_approval' ? <Notice tone={colors.blue}>Waiting for approval to release: SM Projects verifies, and from LKR 15,000,000.00 (or below the margin floor) GM / DGM approves after SM Projects.</Notice> : null}
        {j.status === 'revision_requested' ? (
          <Notice tone={colors.red}>
            Sent back to SM Estimation for revision: {j.review_comment}
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
                    if (res === 'sm_projects_approval') dialog.toast('Sent to SM Projects (then GM / DGM from LKR 15,000,000.00) for approval to release');
                    await reload();
                  })
                }
              />
              <Button
                variant="danger"
                title="Return"
                onPress={async () => {
                  const r = await dialog.prompt({
                    title: 'Return quotation',
                    message: inq?.customer_deadline ? `The new due date cannot be after the customer deadline (${fmtDate(inq.customer_deadline)}).` : undefined,
                    fields: [
                      { key: 'c', label: 'Comments', type: 'multiline', required: true },
                      { key: 'd', label: 'Revision due by', type: 'date', required: true, initial: inq?.customer_deadline ?? undefined },
                    ],
                  });
                  if (r) await run('review_estimate', { p_job: j.id, p_approve: false, p_comment: r.c, p_due: r.d }, 'Returned – the estimator is told the new due date');
                }}
              />
            </>
          ) : null}
          {(sme || (mine && !j.needs_sm_projects)) && j.status === 'approved' ? (
            <Button
              title="Release to sales"
              onPress={async () => {
                // Compliance sheet and data sheets: uploaded, or marked not applicable with a reason (SM Estimation)
                const { data: files } = await supabase.from('attachments').select('kind, entity_id').eq('entity_type', 'estimation_job')
                  .in('entity_id', [j.id, ...(j.copied_from_job_id ? [j.copied_from_job_id] : [])]).is('archived_at', null);
                const has = (k: string) => (files ?? []).some((f) => f.kind === k);
                if (!(files ?? []).some((f) => f.kind === 'quotation_final' && f.entity_id === j.id)) return dialog.toast('Upload the final quotation PDF first', 'error');
                // A quotation copied to another contractor uses the compliance / data sheets of the original estimate
                const missing = [!has('compliance_sheet') ? 'compliance sheet' : null, !has('technical_data') ? 'technical data sheets' : null].filter(Boolean);
                if (missing.length && !sme) return dialog.toast(`Upload the ${missing.join(' and ')} (only SM Estimation can release without them)`, 'error');
                const r = await dialog.prompt({
                  title: 'Release quotation',
                  message: missing.length
                    ? `Not uploaded: ${missing.join(' and ')}. If not applicable to this job (e.g. budget quotation, labour-only or service job, local fabrication), give the reason – it is shown to sales with the quotation. Otherwise cancel and upload them.`
                    : 'A justification is needed only if brands do not match the client expectation.',
                  fields: [
                    ...(!has('compliance_sheet') ? [{ key: 'nc', label: 'Compliance sheet not applicable because…', type: 'multiline' as const, required: true }] : []),
                    ...(!has('technical_data') ? [{ key: 'nd', label: 'Data sheets not applicable because…', type: 'multiline' as const, required: true }] : []),
                    { key: 'j', label: 'Brand justification (optional)', type: 'multiline' },
                  ],
                });
                if (r)
                  await run(
                    'release_quotation',
                    { p_job: j.id, p_justification: r.j || null, p_no_compliance_reason: r.nc || null, p_no_datasheets_reason: r.nd || null },
                    'Released – sales person notified',
                  );
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

      {j.copied_from_job_id ? (
        <Card style={{ borderColor: colors.blue }}>
          <Text>{`${j.revision_request ?? 'Quotation to another contractor'}. Upload the final quotation addressed to ${inq?.customer_name ?? 'the new contractor'} and release it – the compliance and data sheets of the original estimate count.`}</Text>
          <Row style={{ marginTop: 6 }}>
            <Button small variant="secondary" title="Open the original estimate" onPress={() => router.push(`/estimation/${j.copied_from_job_id}`)} />
          </Row>
        </Card>
      ) : j.revision_request ? (
        <Notice tone={colors.amber}>Client revision R{j.revision} requested: {j.revision_request}</Notice>
      ) : null}
      {data.previous.map((p) => (
        <Section key={p.job.id} title={`Previous quotation – ${p.quote?.full_no ?? `R${p.job.revision}`} (submitted)`}>
          <Card>
            <Row wrap>
              <KeyValue label="Quoted value" value={fmtMoney(p.quote?.quoted_value ?? p.job.quoted_value, p.quote?.currency ?? p.job.price_currency ?? cur)} />
              {p.costing ? <KeyValue label="Cost · margin" value={`${fmtMoney(p.costing.cost, p.quote?.currency ?? p.job.price_currency ?? cur)} · ${p.costing.margin_pct ?? '—'}%`} /> : null}
              <KeyValue label="Released" value={fmtDateTime(p.quote?.released_at ?? p.job.released_at)} />
              <KeyValue label="Submitted to client" value={fmtDateTime(p.quote?.submitted_to_client_at ?? null)} />
              <KeyValue label="Valid until" value={fmtDate(p.quote?.validity_date ?? null)} />
              <KeyValue label="Estimator" value={people[p.job.assignee_id ?? '']?.full_name ?? '—'} />
            </Row>
            <Muted>Brands offered: {(p.quote?.brands_offered ?? p.job.brands_offered ?? []).map((b) => `${b.group}: ${b.brand}`).join(' · ') || '—'}</Muted>
            {p.job.alternatives ? <Muted>Alternatives: {p.job.alternatives}</Muted> : null}
          </Card>
          <Card style={{ padding: 0, overflow: 'hidden', marginTop: 8 }}>
            {p.files.map((f) => (
              <ListRow key={f.id} title={f.file_name} subtitle={`${KIND_LABELS[f.kind] ?? f.kind} · v${f.version}`} right={<Button small variant="secondary" title="Open" onPress={() => dialog.run(() => openAttachment(f))} />} />
            ))}
            {!p.files.length ? <Muted style={{ padding: 12 }}>No files on the previous quotation.</Muted> : null}
          </Card>
        </Section>
      ))}

      <DesignNotes inquiryId={j.inquiry_id} />

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
          {j.status === 'released' && cur !== inqCur ? (
            <Notice tone={colors.blue}>This quotation was released in {cur}. The inquiry is now priced in {inqCur} – the re-priced offer is on the next revision.</Notice>
          ) : null}
          {priceCur !== cur ? <Notice tone={colors.red}>Duty status changed – the previous figures are in {priceCur} (shown above for reference). Enter the re-priced values in {cur} and save before submitting.</Notice> : null}
          <NumberField label="Quoted value" suffix={cur} value={est.quoted_value} onChange={(v) => setEst((s) => ({ ...s, quoted_value: v }))} />
          <NumberField label="Cost (restricted)" suffix={cur} value={est.cost} onChange={(v) => setEst((s) => ({ ...s, cost: v }))} />
          <NumberField label="Margin % (calculated if blank)" value={est.margin_pct} onChange={(v) => setEst((s) => ({ ...s, margin_pct: v }))} />
          <NumberField label="Validity" suffix="days" value={est.validity_days} onChange={(v) => setEst((s) => ({ ...s, validity_days: v }))} />
          <Field label="Alternatives / value engineering" multiline value={est.alternatives} onChangeText={(v) => setEst((s) => ({ ...s, alternatives: v }))} />
          <Field label="Design version used" value={est.design_version} onChangeText={(v) => setEst((s) => ({ ...s, design_version: v }))} />
          <Muted>
            {priceCur !== cur ? 'Previous figures (before the duty change)' : 'Current'}: {fmtMoney(j.quoted_value, priceCur)} · cost {fmtMoney(data.costing?.cost, priceCur)} · margin {data.costing?.margin_pct ?? '—'}%
          </Muted>
          <Text style={{ fontWeight: '700', marginTop: 12 }}>Brands offered (mandatory before release)</Text>
          <BrandEditor value={brands} onChange={setBrands} readOnly={!editable && !brandsBySme} expectedLevel={inq?.solution_level} expectedOrigin={inq?.manufacturing_origin} />
          {brandsBySme ? (
            <>
              {!j.brands_offered?.length ? <Notice tone={colors.amber}>No brands were entered by the estimator – enter the brands and origin offered for each main product group, then save, before releasing.</Notice> : null}
              <Button
                small
                title="Save brands"
                onPress={() =>
                  dialog.run(async () => {
                    checkBrands();
                    await rpc('set_estimate_brands', { p_job: j.id, p_brands: brands.filter((b) => b.group && b.brand) });
                    await reload();
                  }, 'Brands saved')
                }
              />
            </>
          ) : null}
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
        const currentDay = job.due_at ? fmtDateISO(job.due_at) : undefined;
        const r = await dialog.prompt({
          title: 'Assign estimator',
          message: 'Pre-selected by project type. Assigning the other estimator needs a reason. A new due date must leave 1 working day before the customer deadline (the current deadline, including any extension) – keep the date to change only the estimator.',
          fields: [
            { key: 'a', label: 'Estimator', type: 'select', required: true, initial: job.assignee_id ?? def ?? undefined, options: (people ?? []).map((p) => ({ value: p.id, label: `${p.full_name}${p.id === def ? ' (default)' : ''}` })) },
            { key: 'd', label: 'Estimation due date', type: 'date', required: true, initial: currentDay, hint: job.due_at ? 'Keep the current date to change only the estimator' : undefined },
            {
              key: 'band',
              label: 'Value band',
              type: 'select',
              initial: job.value_band ?? 'medium',
              options: [
                { value: 'small', label: 'Small (under LKR 5,000,000.00) – 2 working days' },
                { value: 'medium', label: 'Medium (LKR 5,000,000.00 – 25,000,000.00) – 4 working days' },
                { value: 'large', label: 'Large (over LKR 25,000,000.00) – 7 working days' },
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
          // Same date as before → keep the exact due time (no new deadline check); a new date is checked against the current customer deadline
          const due = job.due_at && r.d === currentDay && job.status !== 'revision_requested' ? job.due_at : endOfWorkDay(r.d);
          await rpc('assign_estimation_job', { p_job: job.id, p_assignee: r.a, p_due: due, p_value_band: r.band, p_reason: r.r || null });
          onDone();
        }, 'Assigned – estimator notified');
      }}
    />
  );
}
