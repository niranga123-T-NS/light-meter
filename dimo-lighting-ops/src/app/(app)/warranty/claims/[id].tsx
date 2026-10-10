import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { ClaimSiteCard } from '@/components/ClaimSiteCard';
import { LocationPicker } from '@/components/LocationPicker';
import { useDialog } from '@/components/dialog';
import { C_TONE } from '@/components/warrantyTones';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Warranty, WarrantyClaim, WarrantyLine } from '@/lib/types';
import { CLAIM_STAGE_LABEL, claimDaysOpen, claimStage, FAULT_CAUSES, faultCauseLabel, isWarrantyDesk, viaLabel } from '@/lib/warranty';

type Log = { id: number; at: string; user_id: string | null; kind: string; note: string | null };

const num = (s: string) => Number(String(s ?? '').replace(/,/g, ''));

export default function ClaimDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [pending, setPending] = useState<{ a: string; visit: string | null } | null>(null);
  const { data, error, reload } = useLoad(async () => {
    const { data: c, error: e } = await supabase.from('warranty_claims').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const claim = c as WarrantyClaim;
    const [{ data: w }, { data: l }, { data: log }, { data: engineers }] = await Promise.all([
      supabase.from('warranties').select('*').eq('id', claim.warranty_id).maybeSingle(),
      claim.line_id ? supabase.from('warranty_lines').select('*').eq('id', claim.line_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('warranty_log').select('*').eq('claim_id', id).order('at', { ascending: false }),
      supabase.from('profiles').select('id, full_name, role').in('role', ['assistant_engineer', 'senior_elec_engineer']).eq('active', true).order('full_name'),
    ]);
    const rmaIds = (((await supabase.from('manufacturer_claim_items').select('rma_id').eq('claim_id', id)).data ?? []) as { rma_id: string }[]).map((x) => x.rma_id);
    const proj = (w as Warranty | null)?.project_id
      ? ((await supabase.from('projects').select('lat, lng').eq('id', (w as Warranty).project_id!).maybeSingle()).data as { lat: number | null; lng: number | null } | null)
      : null;
    return {
      proj,
      rmaIds: [...new Set(rmaIds)],
      c: claim,
      w: w as Warranty | null,
      line: l as WarrantyLine | null,
      log: (log ?? []) as Log[],
      engineers: (engineers ?? []) as { id: string; full_name: string; role: string }[],
    };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { c, w, line } = data;
  const today = todayISO();
  const stage = claimStage(c);
  const desk = isWarrantyDesk(me.role);
  const see = me.role === 'senior_elec_engineer';
  const worker = desk || c.assignee_id === me.id;
  const open = c.status === 'open';
  const sales = me.role === 'asm_building' || me.role === 'asm_infra';
  // Customer side of a chargeable claim: the sales person (SM Projects / the warranty desk can step in)
  const customerSide = sales || desk || me.role === 'sm_projects';
  const canDispute =
    (sales || me.role === 'sm_projects') &&
    c.status !== 'cancelled' &&
    !c.dispute_status &&
    c.goodwill_status !== 'pending' &&
    (c.decision === 'rejected' || (c.decision === 'chargeable' && c.customer_response !== 'accepted' && !c.rectified_on));
  const decidesDispute = c.dispute_status === 'pending' && (me.role === 'sm_projects' || me.role === 'gm');
  const cur = w?.currency ?? 'LKR';
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);
  const engineerOptions = data.engineers.map((e) => ({ value: e.id, label: e.full_name, hint: e.role === 'senior_elec_engineer' ? 'Senior Electrical Engineer' : 'Assistant Engineer' }));

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: c.code }} />
      <Card style={{ borderLeftWidth: 5, borderLeftColor: C_TONE[stage] }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{c.code}</Text>
          <Row gap={6}>
            <Pill label={c.in_warranty ? 'In warranty' : 'Out of warranty'} tone={c.in_warranty ? colors.green : colors.red} />
            <Pill label={CLAIM_STAGE_LABEL[stage]} tone={C_TONE[stage]} solid />
          </Row>
        </Row>
        <Text style={{ marginTop: 4 }}>{c.description}</Text>
        <Muted>
          {w ? `${w.project_name} · ${w.customer} · ${[w.invoice_no, w.contract_no].filter(Boolean).join(' · ')}` : ''}
        </Muted>
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Item" value={line ? `${line.product_group}${line.brand ? ` – ${line.brand}` : ''} · ends ${fmtDate(line.end_date)}` : 'Not specified'} />
          {c.quantity != null ? <KeyValue label="Quantity" value={String(c.quantity)} /> : null}
          {c.location ? <KeyValue label="Location" value={c.location} /> : null}
          <KeyValue label="Reported via" value={`${viaLabel(c.reported_via)}${c.reported_by ? ` · ${people[c.reported_by]?.full_name ?? ''}` : ''}`} />
          <KeyValue label="Logged" value={`${fmtDateTime(c.logged_at)} · ${people[c.logged_by ?? '']?.full_name ?? '—'}`} />
          <KeyValue label={open ? 'Open for' : 'Closed'} value={open ? `${claimDaysOpen(c, today)} days` : `${fmtDate(c.closed_on)}${c.close_note ? ` · ${c.close_note}` : ''}`} />
          <KeyValue label="Engineer" value={people[c.assignee_id ?? '']?.full_name ?? 'Not assigned'} />
          {c.inspected_on ? <KeyValue label="Inspected" value={`${fmtDate(c.inspected_on)} · ${c.inspection_findings ?? ''}`} /> : null}
          {c.decision ? (
            <KeyValue
              label="Decision"
              value={`${c.decision}${c.goodwill_status ? ` · goodwill ${c.goodwill_status}` : ''}${c.decision_note ? ` · ${c.decision_note}` : ''}`}
            />
          ) : null}
          {c.fault_cause ? <KeyValue label="Cause of the fault" value={faultCauseLabel(c.fault_cause)} /> : null}
          {c.quoted_on ? (
            <KeyValue label="Repair quote" value={`${fmtMoney(c.quote_amount ?? 0, cur)}${c.quote_ref ? ` · ${c.quote_ref}` : ''} · ${fmtDate(c.quoted_on)}`} />
          ) : null}
          {c.customer_response ? (
            <KeyValue
              label="Customer's answer"
              value={`${c.customer_response === 'accepted' ? 'Accepted' : 'Declined'} · ${fmtDate(c.responded_on)}${c.response_note ? ` · ${c.response_note}` : ''}`}
            />
          ) : null}
          {c.dispute_status ? (
            <KeyValue
              label="Customer's dispute"
              value={`${c.dispute_reason ?? ''} · ${c.dispute_status === 'pending' ? 'with SM Projects' : c.dispute_status === 'upheld' ? 'decision upheld' : 'covered as goodwill'}${c.dispute_note ? ` · ${c.dispute_note}` : ''}`}
            />
          ) : null}
          {c.supplier_status !== 'none' ? (
            <KeyValue
              label="Supplier claim"
              value={`${c.supplier_status}${c.supplier_ref ? ` · ${c.supplier_ref}` : ''}${c.supplier_raised_on ? ` · raised ${fmtDate(c.supplier_raised_on)}` : ''}${c.supplier_resolved_on ? ` · answered ${fmtDate(c.supplier_resolved_on)}` : ''}`}
            />
          ) : null}
          {c.rectified_on ? <KeyValue label="Rectified" value={`${fmtDate(c.rectified_on)}${c.rectification_note ? ` · ${c.rectification_note}` : ''}`} /> : null}
          <KeyValue label="Cost to DIMO · recovered" value={`${fmtMoney(c.cost_amount, cur)} · ${fmtMoney(c.recovered_amount, cur)}`} />
        </Row>
        {data.rmaIds.length ? (
          <Row wrap gap={6} style={{ marginTop: 6 }}>
            {data.rmaIds.map((rid) => (
              <Button key={rid} small variant="secondary" title={`Open manufacturer claim${data.rmaIds.length > 1 ? ` ${data.rmaIds.indexOf(rid) + 1}` : ''}`} onPress={() => router.push(`/warranty/rma/${rid}`)} />
            ))}
          </Row>
        ) : null}
        {c.repaired_from ? <Muted>{c.repaired_from === 'dimo_stock' ? 'Customer repaired from DIMO stock (advance replacement)' : "Customer repaired with the manufacturer's replacement"}</Muted> : null}
        {stage === 'verify' ? <Notice tone={colors.amber}>Raised by sales / SM Projects – Operations verifies it (invoice / contract no., our supply); the Senior Electrical Engineer assigns the engineer.</Notice> : null}
        {stage === 'goodwill' ? <Notice tone={colors.amber}>Out of warranty – waiting for SM Projects to approve goodwill cover.</Notice> : null}
        {stage === 'goodwill' && (me.role === 'sm_projects' || me.role === 'gm') ? (
          <Row style={{ marginTop: 8 }}>
            <Button title="Approve / reject goodwill" onPress={() => router.push('/approvals')} />
          </Row>
        ) : null}
        {stage === 'quote' ? (
          <Notice tone={colors.blue}>Not covered – the sales person quotes the repair and records it here. The repair is done once the customer accepts.</Notice>
        ) : null}
        {stage === 'customer' ? <Notice tone={colors.blue}>Quoted – record the customer&apos;s answer (accepted → repair; declined → the claim closes).</Notice> : null}
        {stage === 'dispute' ? <Notice tone={colors.red}>The customer disputes the decision – SM Projects upholds it or covers it as goodwill.</Notice> : null}
        {canDispute ? (
          <Muted>If the customer does not agree with the decision, record their dispute – it goes to SM Projects.</Muted>
        ) : null}
        {customerSide || canDispute || decidesDispute ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            {customerSide && open && c.decision === 'chargeable' && c.goodwill_status !== 'pending' && !c.customer_response && c.dispute_status !== 'pending' ? (
              <Button
                variant={stage === 'quote' ? 'primary' : 'secondary'}
                title={c.quoted_on ? 'Revise quote' : 'Record repair quote'}
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Repair quote to the customer',
                    fields: [
                      { key: 'a', label: `Amount (${cur})`, required: true, initial: c.quote_amount ? String(c.quote_amount) : '' },
                      { key: 'r', label: 'Quote number', initial: c.quote_ref ?? '' },
                      { key: 'd', label: 'Quote date', type: 'date', required: true, initial: c.quoted_on ?? today },
                    ],
                  });
                  if (!x) return;
                  const amount = num(x.a);
                  if (!(amount > 0)) return dialog.toast('Enter the quoted amount', 'error');
                  await run('record_claim_quote', { p_id: c.id, p_amount: amount, p_ref: x.r || null, p_on: x.d }, 'Quote recorded – Operations told');
                }}
              />
            ) : null}
            {customerSide && open && c.decision === 'chargeable' && c.quoted_on && !c.customer_response && c.dispute_status !== 'pending' ? (
              <Button
                variant={stage === 'customer' ? 'primary' : 'secondary'}
                title="Customer's answer"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: "Customer's answer to the repair quote",
                    fields: [
                      {
                        key: 'r',
                        label: 'Answer',
                        type: 'select',
                        required: true,
                        options: [
                          { value: 'accepted', label: 'Accepted – go ahead with the repair' },
                          { value: 'declined', label: 'Declined – close the claim' },
                        ],
                      },
                      { key: 'd', label: 'Date', type: 'date', required: true, initial: today },
                      { key: 'n', label: "Customer's reason / note (required if declined)", type: 'multiline' },
                    ],
                  });
                  if (x) await run('record_quote_response', { p_id: c.id, p_response: x.r, p_on: x.d, p_note: x.n || null }, 'Answer recorded');
                }}
              />
            ) : null}
            {canDispute ? (
              <Button
                variant="secondary"
                title="Customer disputes"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Customer disputes the decision',
                    message: 'SM Projects reviews it and either upholds the decision or covers the claim as goodwill.',
                    fields: [{ key: 'n', label: "Customer's reason", type: 'multiline', required: true }],
                  });
                  if (x) await run('dispute_warranty_claim', { p_id: c.id, p_reason: x.n }, 'Sent to SM Projects');
                }}
              />
            ) : null}
            {decidesDispute ? (
              <Button
                title="Decide the dispute"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Customer dispute',
                    message: `${faultCauseLabel(c.fault_cause)} · ${c.decision_note ?? ''}\nCustomer: ${c.dispute_reason ?? ''}`,
                    fields: [
                      {
                        key: 'd',
                        label: 'Decision',
                        type: 'select',
                        required: true,
                        options: [
                          { value: 'uphold', label: 'Uphold the decision' },
                          { value: 'goodwill', label: 'Cover as goodwill – reopen for the repair' },
                        ],
                      },
                      { key: 'n', label: 'Reason', type: 'multiline', required: true },
                    ],
                  });
                  if (x) await run('decide_claim_dispute', { p_id: c.id, p_decision: x.d, p_note: x.n }, 'Decision recorded – sales person told');
                }}
              />
            ) : null}
          </Row>
        ) : null}
        {open ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            {desk && stage === 'verify' && !see ? (
              <Button
                title="Verify"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Verify the claim',
                    message: 'Check the invoice / contract number and that it is our supply. The Senior Electrical Engineer then assigns the engineer.',
                    fields: [{ key: 'n', label: 'Note (e.g. invoice checked)' }],
                  });
                  if (x) await run('verify_warranty_claim', { p_id: c.id, p_note: x.n || null }, 'Verified – Senior Electrical Engineer asked to assign');
                }}
              />
            ) : null}
            {see ? (
              <Button
                variant={stage === 'assign' || stage === 'verify' ? 'primary' : 'secondary'}
                title={stage === 'verify' ? 'Verify & assign' : c.assignee_id ? 'Re-assign' : 'Assign engineer'}
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: stage === 'verify' ? 'Verify the claim (invoice / contract no., our supply) and assign the site inspection' : 'Assign the site inspection',
                    message: 'Next, pick the site on the map – the engineer checks in there before recording the inspection.',
                    fields: [
                      { key: 'a', label: 'Engineer', type: 'select', required: true, options: engineerOptions, initial: c.assignee_id ?? undefined },
                      { key: 'v', label: 'Visit date', type: 'date', initial: c.visit_on ?? today },
                    ],
                    confirmLabel: Platform.OS === 'web' ? 'Next – site on the map' : 'Assign',
                  });
                  if (!x) return;
                  // Web: the SEE picks the site on the map; phones: the site already set or the project's location
                  if (Platform.OS === 'web') setPending({ a: x.a, visit: x.v || null });
                  else await run('assign_warranty_claim', { p_id: c.id, p_assignee: x.a, p_visit: x.v || null }, 'Assigned – engineer notified');
                }}
              />
            ) : null}
            {worker && !c.inspected_on ? (
              <Button
                variant={stage === 'inspect' ? 'primary' : 'secondary'}
                title="Record inspection"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Site inspection',
                    fields: [
                      { key: 'd', label: 'Inspection date', type: 'date', required: true, initial: today },
                      { key: 'f', label: 'Findings', type: 'multiline', required: true },
                    ],
                  });
                  if (x) await run('record_claim_inspection', { p_id: c.id, p_on: x.d, p_findings: x.f }, 'Inspection recorded – Senior Electrical Engineer notified');
                }}
              />
            ) : null}
            {see && !c.decision && c.goodwill_status !== 'pending' ? (
              <Button
                variant={stage === 'decide' ? 'primary' : 'secondary'}
                title="Decide"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: c.in_warranty ? 'Decision' : 'Decision – out of warranty (covered = goodwill, SM Projects approves)',
                    message:
                      'Only a manufacturing defect within the warranty period is covered by the warranty. Covering anything else is goodwill (SM Projects approves). For chargeable or rejected, attach a photo or the inspection report first – the customer is shown why.',
                    fields: [
                      { key: 'c', label: 'Cause of the fault', type: 'select', required: true, options: FAULT_CAUSES, initial: c.fault_cause ?? undefined },
                      {
                        key: 'd',
                        label: 'Decision',
                        type: 'select',
                        required: true,
                        options: [
                          { value: 'covered', label: c.in_warranty ? 'Covered (goodwill if not a manufacturing defect)' : 'Cover as goodwill (SM Projects approval)' },
                          { value: 'chargeable', label: 'Chargeable – quote the customer' },
                          { value: 'rejected', label: 'Rejected (misuse, not our supply …)' },
                        ],
                      },
                      { key: 'n', label: 'Reason / note (required unless covered)', type: 'multiline' },
                    ],
                  });
                  if (x) await run('decide_warranty_claim', { p_id: c.id, p_decision: x.d, p_note: x.n || null, p_cause: x.c }, 'Decision recorded – sales person told');
                }}
              />
            ) : null}
            {worker && (c.decision === 'covered' || c.customer_response === 'accepted') && c.goodwill_status !== 'pending' && c.dispute_status !== 'pending' && !c.rectified_on ? (
              <Button
                variant={stage === 'rectify' ? 'primary' : 'secondary'}
                title="Record rectification"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Replaced / repaired',
                    fields: [
                      { key: 'd', label: 'Date', type: 'date', required: true, initial: today },
                      { key: 'c', label: `Cost to DIMO (${cur})`, initial: '0' },
                      {
                        key: 'f',
                        label: 'Replaced from',
                        type: 'select',
                        options: [
                          { value: 'dimo_stock', label: 'DIMO stock now (claim back from the manufacturer)' },
                          { value: 'manufacturer', label: "The manufacturer's replacement" },
                        ],
                      },
                      { key: 'n', label: 'What was done', type: 'multiline' },
                    ],
                  });
                  if (!x) return;
                  const cost = num(x.c);
                  if (!(cost >= 0)) return dialog.toast('Enter the cost (0 if none)', 'error');
                  await run('record_claim_rectified', { p_id: c.id, p_on: x.d, p_cost: cost, p_note: x.n || null, p_from: x.f || null }, 'Rectification recorded');
                }}
              />
            ) : null}
            {desk && c.decision === 'covered' && (c.supplier_status === 'none' || c.supplier_status === 'rejected') ? (
              <Button variant="secondary" title="Manufacturer claim (RMA)" onPress={() => router.push({ pathname: '/warranty/rma/new', params: { claim: c.id } })} />
            ) : null}
            {desk && c.supplier_status === 'raised' && !data.rmaIds.length ? (
              <Button
                variant="secondary"
                title="Supplier answered"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Supplier answer',
                    fields: [
                      { key: 's', label: 'Result', type: 'select', required: true, options: [{ value: 'resolved', label: 'Accepted – replacement / credit' }, { value: 'rejected', label: 'Rejected by supplier' }] },
                      { key: 'a', label: `Amount recovered (${cur})`, initial: '0' },
                      { key: 'd', label: 'Date', type: 'date', required: true, initial: today },
                      { key: 'n', label: 'Note', type: 'multiline' },
                    ],
                  });
                  if (!x) return;
                  const amount = num(x.a);
                  if (!(amount >= 0)) return dialog.toast('Enter the amount (0 if none)', 'error');
                  await run('resolve_supplier_claim', { p_id: c.id, p_result: x.s, p_recovered: amount, p_on: x.d, p_note: x.n || null }, 'Supplier answer recorded');
                }}
              />
            ) : null}
            {desk && c.rectified_on ? (
              <Button
                title="Close claim"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Close the claim',
                    fields: [
                      { key: 'd', label: 'Date', type: 'date', required: true, initial: today },
                      { key: 'n', label: 'Customer confirmation / note', type: 'multiline' },
                    ],
                  });
                  if (x) await run('close_warranty_claim', { p_id: c.id, p_status: 'closed', p_on: x.d, p_note: x.n || null }, 'Claim closed – sales person told');
                }}
              />
            ) : null}
            {desk ? (
              <Button
                variant="ghost"
                title="Cancel claim"
                onPress={async () => {
                  const x = await dialog.prompt({ title: 'Cancel this claim', fields: [{ key: 'n', label: 'Reason', type: 'multiline', required: true }], danger: true });
                  if (x) await run('close_warranty_claim', { p_id: c.id, p_status: 'cancelled', p_on: today, p_note: x.n }, 'Cancelled');
                }}
              />
            ) : null}
            {w ? <Button variant="ghost" title="Open warranty" onPress={() => router.push(`/warranty/${w.id}`)} /> : null}
          </Row>
        ) : w ? (
          <Row style={{ marginTop: 8 }}>
            <Button variant="ghost" title="Open warranty" onPress={() => router.push(`/warranty/${w.id}`)} />
          </Row>
        ) : null}
      </Card>
      <ClaimSiteCard c={c} query={[w?.site, w?.project_name].filter(Boolean).join(' ')} onChange={reload} />
      <LocationPicker
        visible={!!pending}
        title="Site of the inspection – pick the point the engineer checks in at"
        query={[w?.site, w?.project_name].filter(Boolean).join(' ')}
        initial={c.site_lat != null && c.site_lng != null ? { lat: c.site_lat, lng: c.site_lng } : data.proj?.lat != null && data.proj?.lng != null ? { lat: data.proj.lat, lng: data.proj.lng } : null}
        onClose={() => setPending(null)}
        onSave={async (pt) => {
          if (!pending) return;
          const ok = await run('assign_warranty_claim', { p_id: c.id, p_assignee: pending.a, p_lat: pt.lat, p_lng: pt.lng, p_visit: pending.visit }, 'Assigned – engineer notified');
          if (ok) setPending(null);
        }}
      />

      <Attachments entityType="warranty_claim" entityId={c.id} kinds={['claim_photo']} title="Photos and documents (customer letter, inspection photos, completion note)" canUpload={worker && open} allowCamera />
      {c.report_id ? <Attachments entityType="warranty_report" entityId={c.report_id} kinds={['report_photo']} title="Photos from the sales visit" canUpload={false} /> : null}

      <Section title="History">
        <Card>
          {data.log.map((l) => (
            <Muted key={l.id}>
              {fmtDateTime(l.at)} · {people[l.user_id ?? '']?.full_name ?? 'System'} · {l.note ?? l.kind}
            </Muted>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
