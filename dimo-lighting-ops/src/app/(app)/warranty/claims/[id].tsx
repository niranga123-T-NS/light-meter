import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { C_TONE } from '@/components/warrantyTones';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Warranty, WarrantyClaim, WarrantyLine } from '@/lib/types';
import { CLAIM_STAGE_LABEL, claimDaysOpen, claimStage, isWarrantyDesk, viaLabel } from '@/lib/warranty';

type Log = { id: number; at: string; user_id: string | null; kind: string; note: string | null };

const num = (s: string) => Number(String(s ?? '').replace(/,/g, ''));

export default function ClaimDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
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
    return {
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
          {c.supplier_status !== 'none' ? (
            <KeyValue
              label="Supplier claim"
              value={`${c.supplier_status}${c.supplier_ref ? ` · ${c.supplier_ref}` : ''}${c.supplier_raised_on ? ` · raised ${fmtDate(c.supplier_raised_on)}` : ''}${c.supplier_resolved_on ? ` · answered ${fmtDate(c.supplier_resolved_on)}` : ''}`}
            />
          ) : null}
          {c.rectified_on ? <KeyValue label="Rectified" value={`${fmtDate(c.rectified_on)}${c.rectification_note ? ` · ${c.rectification_note}` : ''}`} /> : null}
          <KeyValue label="Cost to DIMO · recovered" value={`${fmtMoney(c.cost_amount, cur)} · ${fmtMoney(c.recovered_amount, cur)}`} />
        </Row>
        {stage === 'goodwill' ? <Notice tone={colors.amber}>Out of warranty – waiting for SM Projects to approve goodwill cover.</Notice> : null}
        {stage === 'goodwill' && (me.role === 'sm_projects' || me.role === 'gm') ? (
          <Row style={{ marginTop: 8 }}>
            <Button title="Approve / reject goodwill" onPress={() => router.push('/approvals')} />
          </Row>
        ) : null}
        {stage === 'quote' ? <Notice tone={colors.blue}>Chargeable – the sales person quotes the repair. Record the rectification once the customer orders it.</Notice> : null}
        {open ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            {desk ? (
              <Button
                variant={stage === 'assign' ? 'primary' : 'secondary'}
                title={c.assignee_id ? 'Re-assign' : 'Assign engineer'}
                onPress={async () => {
                  const x = await dialog.prompt({ title: 'Assign the site inspection', fields: [{ key: 'a', label: 'Engineer', type: 'select', required: true, options: engineerOptions, initial: c.assignee_id ?? undefined }] });
                  if (x) await run('assign_warranty_claim', { p_id: c.id, p_assignee: x.a }, 'Assigned – engineer notified');
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
                    fields: [
                      {
                        key: 'd',
                        label: 'Decision',
                        type: 'select',
                        required: true,
                        options: [
                          { value: 'covered', label: c.in_warranty ? 'Covered by warranty' : 'Cover as goodwill (SM Projects approval)' },
                          { value: 'chargeable', label: 'Chargeable – quote the customer' },
                          { value: 'rejected', label: 'Rejected (misuse, not our supply …)' },
                        ],
                      },
                      { key: 'n', label: 'Reason / note (required unless covered)', type: 'multiline' },
                    ],
                  });
                  if (x) await run('decide_warranty_claim', { p_id: c.id, p_decision: x.d, p_note: x.n || null }, 'Decision recorded');
                }}
              />
            ) : null}
            {worker && (c.decision === 'covered' || c.decision === 'chargeable') && c.goodwill_status !== 'pending' && !c.rectified_on ? (
              <Button
                variant={stage === 'rectify' ? 'primary' : 'secondary'}
                title="Record rectification"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Replaced / repaired',
                    fields: [
                      { key: 'd', label: 'Date', type: 'date', required: true, initial: today },
                      { key: 'c', label: `Cost to DIMO (${cur})`, initial: '0' },
                      { key: 'n', label: 'What was done', type: 'multiline' },
                    ],
                  });
                  if (!x) return;
                  const cost = num(x.c);
                  if (!(cost >= 0)) return dialog.toast('Enter the cost (0 if none)', 'error');
                  await run('record_claim_rectified', { p_id: c.id, p_on: x.d, p_cost: cost, p_note: x.n || null }, 'Rectification recorded');
                }}
              />
            ) : null}
            {desk && (c.supplier_status === 'none' || c.supplier_status === 'rejected') ? (
              <Button
                variant="secondary"
                title="Raise supplier claim"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Back-to-back claim to the supplier',
                    fields: [
                      { key: 'r', label: 'Supplier reference (RMA / letter no.)' },
                      { key: 'd', label: 'Date raised', type: 'date', required: true, initial: today },
                    ],
                  });
                  if (x) await run('raise_supplier_claim', { p_id: c.id, p_ref: x.r || null, p_on: x.d }, 'Supplier claim raised');
                }}
              />
            ) : null}
            {desk && c.supplier_status === 'raised' ? (
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
