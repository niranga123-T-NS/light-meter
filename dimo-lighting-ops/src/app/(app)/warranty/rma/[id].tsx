import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { R_TONE } from '@/components/warrantyTones';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import type { Manufacturer, ManufacturerClaim, ManufacturerClaimItem, WarrantyClaim } from '@/lib/types';
import { isWarrantyDesk, RMA_STAGE_LABEL, rmaStage } from '@/lib/warranty';

type Log = { id: number; at: string; user_id: string | null; kind: string; note: string | null };
const num = (s: string | undefined) => (s ? String(Number(String(s).replace(/,/g, '')) || 0) : '');

/** Manufacturer claim (RMA): each step is recorded here; contact with the manufacturer is made manually. */
export default function RmaDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('manufacturer_claims').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const rma = r as ManufacturerClaim;
    const [{ data: m }, { data: items }, { data: log }] = await Promise.all([
      supabase.from('manufacturers').select('*').eq('id', rma.manufacturer_id).maybeSingle(),
      supabase.from('manufacturer_claim_items').select('*').eq('rma_id', id),
      supabase.from('manufacturer_claim_log').select('*').eq('rma_id', id).order('at', { ascending: false }),
    ]);
    const claimIds = ((items ?? []) as ManufacturerClaimItem[]).map((i) => i.claim_id).filter((x): x is string => !!x);
    const claims = claimIds.length ? (((await supabase.from('warranty_claims').select('*').in('id', claimIds)).data ?? []) as WarrantyClaim[]) : [];
    return { r: rma, m: m as Manufacturer | null, items: (items ?? []) as ManufacturerClaimItem[], log: (log ?? []) as Log[], claims };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { r, m, items } = data;
  const stage = rmaStage(r);
  const desk = isWarrantyDesk(me.role);
  const smp = me.role === 'sm_projects' || me.role === 'gm';
  const open = r.status === 'open';
  const today = todayISO();
  const claimed = items.reduce((a, i) => a + Number(i.value_claimed), 0);
  const step = (s: string, d: Record<string, string>, ok: string) =>
    dialog.run(async () => {
      await rpc('update_manufacturer_claim', { p_id: r.id, p_step: s, p_data: d });
      await reload();
    }, ok);
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);
  const dateField = { key: 'date', label: 'Date', type: 'date' as const, required: true, initial: today };

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: r.code }} />
      <Card style={{ borderLeftWidth: 5, borderLeftColor: R_TONE[stage] }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>
            {r.code} · {m?.name ?? '—'}
          </Text>
          <Pill label={RMA_STAGE_LABEL[stage]} tone={R_TONE[stage]} solid />
        </Row>
        <Muted>{[m?.local_agent ? `Agent: ${m.local_agent}` : null, m?.contact ? `Contact: ${m.contact}` : null].filter(Boolean).join(' · ') || 'Contact the manufacturer manually and record each step here.'}</Muted>
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Value claimed" value={fmtMoney(claimed, r.currency)} />
          <KeyValue label="Value recovered" value={fmtMoney(r.value_recovered, r.currency)} />
          <KeyValue label="Contacted" value={r.contacted_on ? `${fmtDate(r.contacted_on)}${r.contact_note ? ` · ${r.contact_note}` : ''}` : '—'} />
          <KeyValue label="RMA no." value={r.rma_no ? `${r.rma_no} · ${fmtDate(r.acknowledged_on)}` : '—'} />
          <KeyValue label="Goods returned" value={r.returned_on ? [fmtDate(r.returned_on), r.courier, r.tracking_no].filter(Boolean).join(' · ') : '—'} />
          <KeyValue label="Decision" value={r.decision ? `${r.decision}${r.outcome ? ` · ${r.outcome.replace('_', ' ')}` : ''} · ${fmtDate(r.decided_on)}${r.decision_note ? ` · ${r.decision_note}` : ''}` : '—'} />
          <KeyValue label="Received" value={r.received_on ? [fmtDate(r.received_on), r.grn_no ? `GRN ${r.grn_no}` : null, r.credit_note_no ? `CN ${r.credit_note_no}` : null].filter(Boolean).join(' · ') : '—'} />
          {r.smp_decision ? <KeyValue label="SM Projects" value={`${r.smp_decision}${r.escalations ? ` · escalated ${r.escalations}×` : ''}`} /> : null}
          {r.closed_on ? <KeyValue label={r.status === 'closed' ? 'Closed' : 'Cancelled'} value={`${fmtDate(r.closed_on)}${r.close_note ? ` · ${r.close_note}` : ''}`} /> : null}
        </Row>
        {r.evidence ? <Muted>Evidence: {r.evidence}</Muted> : null}
        {stage === 'rejected' ? <Notice tone={colors.red}>Rejected by the manufacturer – SM Projects decides: absorb the cost or escalate.</Notice> : null}
        {open ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            {desk && !r.decision ? (
              <>
                <Button
                  variant={stage === 'contact' ? 'primary' : 'secondary'}
                  title="Manufacturer contacted"
                  onPress={async () => {
                    const x = await dialog.prompt({ title: 'Contact with the manufacturer', fields: [dateField, { key: 'note', label: 'How / reference (email, phone, portal)' }] });
                    if (x) await step('contacted', { date: x.date, note: x.note ?? '' }, 'Recorded');
                  }}
                />
                <Button
                  variant={stage === 'await_rma' ? 'primary' : 'secondary'}
                  title="RMA no. received"
                  onPress={async () => {
                    const x = await dialog.prompt({ title: 'RMA number from the manufacturer', fields: [{ key: 'rma', label: 'RMA number', required: true }, dateField] });
                    if (x) await step('acknowledged', { date: x.date, rma_no: x.rma }, 'Recorded');
                  }}
                />
                <Button
                  variant={stage === 'return' ? 'primary' : 'secondary'}
                  title="Goods returned"
                  onPress={async () => {
                    const x = await dialog.prompt({
                      title: 'Goods returned to the manufacturer',
                      fields: [dateField, { key: 'courier', label: 'Courier' }, { key: 'tracking', label: 'Tracking no.' }, { key: 'freight', label: `Freight cost (${r.currency})` }],
                    });
                    if (x) await step('returned', { date: x.date, courier: x.courier ?? '', tracking_no: x.tracking ?? '', freight_cost: num(x.freight) }, 'Recorded');
                  }}
                />
                <Button
                  variant={stage === 'await_decision' ? 'primary' : 'secondary'}
                  title="Manufacturer decision"
                  onPress={async () => {
                    const x = await dialog.prompt({
                      title: 'Manufacturer decision',
                      fields: [
                        { key: 'd', label: 'Decision', type: 'select', required: true, options: [{ value: 'accepted', label: 'Accepted' }, { value: 'partly', label: 'Partly accepted' }, { value: 'rejected', label: 'Rejected' }] },
                        { key: 'o', label: 'Settlement (if accepted)', type: 'select', options: [{ value: 'replacement', label: 'Replacement' }, { value: 'credit_note', label: 'Credit note' }, { value: 'repair', label: 'Repair' }] },
                        dateField,
                        { key: 'note', label: 'Note / reason', type: 'multiline' },
                      ],
                    });
                    if (x) await step('decision', { date: x.date, decision: x.d, outcome: x.o ?? '', note: x.note ?? '' }, 'Decision recorded');
                  }}
                />
              </>
            ) : null}
            {desk && (r.decision === 'accepted' || r.decision === 'partly') && !r.received_on ? (
              <Button
                title="Replacement / credit received"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Replacement or credit note received',
                    fields: [dateField, { key: 'grn', label: 'GRN no. (replacement)' }, { key: 'cn', label: 'Credit note no.' }, { key: 'v', label: `Value recovered (${r.currency})`, required: true }],
                  });
                  if (x) await step('received', { date: x.date, grn_no: x.grn ?? '', credit_note_no: x.cn ?? '', value_recovered: num(x.v) }, 'Recorded');
                }}
              />
            ) : null}
            {smp && stage === 'rejected' ? (
              <Button
                title="Absorb or escalate"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Rejected by the manufacturer',
                    fields: [
                      { key: 'd', label: 'Decision', type: 'select', required: true, options: [{ value: 'absorb', label: 'Absorb the cost (DIMO)' }, { value: 'escalate', label: 'Escalate to the manufacturer' }] },
                      { key: 'n', label: 'Reason', type: 'multiline', required: true },
                    ],
                  });
                  if (x) await run('decide_rejected_rma', { p_id: r.id, p_decision: x.d, p_note: x.n }, 'Decision recorded');
                }}
              />
            ) : null}
            {desk && stage === 'to_close' ? (
              <Button
                title="Close manufacturer claim"
                onPress={async () => {
                  const x = await dialog.prompt({ title: 'Close the manufacturer claim', message: 'The value recovered is added to the linked customer claims.', fields: [{ key: 'n', label: 'Note' }] });
                  if (x) await run('close_manufacturer_claim', { p_id: r.id, p_status: 'closed', p_note: x.n || null }, 'Closed');
                }}
              />
            ) : null}
            {desk ? (
              <Button
                variant="ghost"
                title="Cancel"
                onPress={async () => {
                  const x = await dialog.prompt({ title: 'Cancel this manufacturer claim', fields: [{ key: 'n', label: 'Reason', type: 'multiline', required: true }], danger: true });
                  if (x) await run('close_manufacturer_claim', { p_id: r.id, p_status: 'cancelled', p_note: x.n }, 'Cancelled');
                }}
              />
            ) : null}
          </Row>
        ) : null}
      </Card>

      <Section title={`Items (${items.length})`}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {items.map((i) => {
            const c = data.claims.find((x) => x.id === i.claim_id);
            return (
              <ListRow
                key={i.id}
                title={`${i.product} · qty ${i.quantity}`}
                subtitle={`${i.batch_code ? `batch ${i.batch_code} · ` : ''}${c ? `customer claim ${c.code}` : 'not linked to a customer claim'}`}
                right={<Text style={{ fontWeight: '700' }}>{fmtMoney(i.value_claimed, r.currency)}</Text>}
                onPress={c ? () => router.push(`/warranty/claims/${c.id}`) : undefined}
              />
            );
          })}
        </Card>
      </Section>

      <Attachments entityType="rma" entityId={r.id} kinds={['rma_doc']} title="Documents (evidence, emails / letters, RMA form, credit note)" canUpload={desk} allowCamera />

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
