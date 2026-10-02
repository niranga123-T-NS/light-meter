import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { BOND_STAGE_LABEL, bondAction, bondStage, bondTypeLabel, type BondStage } from '@/lib/bonds';
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { daysFrom } from '@/lib/retentions';
import { projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Bond } from '@/lib/types';

type Log = { id: number; at: string; user_id: string | null; kind: string; note: string | null };

const STAGE_TONE: Record<BondStage, string> = {
  active: colors.green,
  expiring: colors.amber,
  expired: colors.red,
  action: colors.blue,
  returned: colors.grey,
  claimed: colors.red,
  cancelled: colors.grey,
};

export default function BondDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [{ data: b, error: e }, { data: log }] = await Promise.all([
      supabase.from('bonds').select('*').eq('id', id).single(),
      supabase.from('bond_log').select('*').eq('bond_id', id).order('at', { ascending: false }),
    ]);
    if (e) throw new Error(e.message);
    return { b: b as Bond, log: (log ?? []) as Log[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const b = data.b;
  const today = todayISO();
  const stage = bondStage(b, today);
  const action = bondAction(b, today);
  const ops = me.role === 'operations_exec';
  const open = b.status === 'active';
  const left = daysFrom(today, b.expiry_date);
  const target = Number(b.advance_amount ?? b.bond_value);
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);

  return (
    <Screen maxWidth={860}>
      <Stack.Screen options={{ title: b.code }} />
      <Card style={{ borderLeftWidth: 5, borderLeftColor: STAGE_TONE[stage] }}>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>
            {bondTypeLabel(b.bond_type)} · {b.bond_no}
          </Text>
          <Pill label={BOND_STAGE_LABEL[stage]} tone={STAGE_TONE[stage]} solid />
        </Row>
        <Muted>
          {b.bond_type === 'bid' ? `${b.tender_no ?? '—'} · ` : ''}
          {b.project_name} · {b.customer}
        </Muted>
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Bond value" value={fmtMoney(b.bond_value, b.currency)} />
          {b.contract_value != null ? <KeyValue label={b.bond_type === 'bid' ? 'Tender value' : 'Contract value'} value={fmtMoney(b.contract_value, b.currency)} /> : null}
          {b.bond_pct != null ? <KeyValue label="Bond %" value={`${b.bond_pct}%`} /> : null}
          <KeyValue label="Bank" value={[b.bank, b.bank_branch].filter(Boolean).join(' · ')} />
          {b.contract_no ? <KeyValue label="Contract / PO no." value={b.contract_no} /> : null}
          <KeyValue label="Issue date" value={fmtDate(b.issue_date)} />
          <KeyValue
            label="Validity (expiry)"
            value={`${fmtDate(b.expiry_date)}${open ? ` (${left >= 0 ? `in ${left} days` : `${-left} days ago`})` : ''}${b.extensions ? ` · extended ${b.extensions}× (originally ${fmtDate(b.original_expiry)})` : ''}`}
          />
          {b.bond_type === 'bid' ? <KeyValue label="Tender closing" value={fmtDate(b.tender_closing_date)} /> : null}
          {b.bond_type === 'bid' ? <KeyValue label="Tender result" value={`${b.tender_result}${b.result_on ? ` · ${fmtDate(b.result_on)}` : ''}`} /> : null}
          {b.bond_type === 'performance' ? <KeyValue label="Completion" value={fmtDate(b.completion_date)} /> : null}
          {b.bond_type === 'performance' ? <KeyValue label="Defects liability ends" value={fmtDate(b.dlp_end_date)} /> : null}
          {b.bond_type === 'advance_payment' ? <KeyValue label="Advance received" value={fmtMoney(target, b.currency)} /> : null}
          {b.bond_type === 'advance_payment' ? (
            <KeyValue label="Recovered · balance" value={`${fmtMoney(b.recovered_amount, b.currency)} · ${fmtMoney(Math.max(0, target - Number(b.recovered_amount)), b.currency)}`} />
          ) : null}
          <KeyValue label="Category" value={projectTypeLabel(b.category)} />
          <KeyValue label="Owner" value={people[b.owner_id ?? '']?.full_name ?? '—'} />
          {b.closed_on ? <KeyValue label={BOND_STAGE_LABEL[stage]} value={`${fmtDate(b.closed_on)}${b.close_note ? ` · ${b.close_note}` : ''}`} /> : null}
        </Row>
        {b.notes ? <Muted>{b.notes}</Muted> : null}
        {stage === 'expired' ? <Notice tone={colors.red}>Expired – get it extended by the bank or collect the original and return it. A reminder is sent every day.</Notice> : null}
        {stage === 'expiring' ? <Notice tone={colors.amber}>Expires in {left} days – extend it or arrange the return.</Notice> : null}
        {action ? <Notice tone={colors.blue}>{action}</Notice> : null}
        {!ops ? <Muted>Only the Operations Executive updates bonds.</Muted> : null}
        {ops && open ? (
          <Row wrap gap={8} style={{ marginTop: 8 }}>
            <Button
              title="Returned to bank"
              onPress={async () => {
                const x = await dialog.prompt({
                  title: 'Bond returned to the bank',
                  fields: [
                    { key: 'd', label: 'Date returned', type: 'date', required: true, initial: today },
                    { key: 'n', label: 'Note (release letter ref.)', type: 'multiline' },
                  ],
                });
                if (x) await run('close_bond', { p_id: b.id, p_status: 'returned', p_on: x.d, p_note: x.n || null }, 'Closed – returned');
              }}
            />
            <Button
              variant="secondary"
              title="Extend validity"
              onPress={async () => {
                const x = await dialog.prompt({
                  title: 'Validity extended by the bank',
                  fields: [
                    { key: 'd', label: 'New expiry date', type: 'date', required: true },
                    { key: 'r', label: 'Reason / bank extension reference', type: 'multiline', required: true },
                  ],
                });
                if (!x) return;
                if (x.d <= b.expiry_date) return dialog.toast('The new expiry date must be after the current one', 'error');
                await run('extend_bond', { p_id: b.id, p_new_expiry: x.d, p_reason: x.r }, 'Validity extended');
              }}
            />
            {b.bond_type === 'bid' ? (
              <Button
                variant="secondary"
                title="Tender result"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Tender result',
                    fields: [
                      {
                        key: 'r',
                        label: 'Result',
                        type: 'select',
                        required: true,
                        initial: b.tender_result,
                        options: [
                          { value: 'pending', label: 'Pending' },
                          { value: 'won', label: 'Won' },
                          { value: 'lost', label: 'Lost' },
                          { value: 'cancelled', label: 'Cancelled' },
                        ],
                      },
                      { key: 'd', label: 'Result date', type: 'date', initial: today },
                      { key: 'n', label: 'Note', type: 'multiline' },
                    ],
                  });
                  if (x) await run('record_bond_tender_result', { p_id: b.id, p_result: x.r, p_on: x.d || null, p_note: x.n || null }, 'Result recorded');
                }}
              />
            ) : null}
            {b.bond_type === 'advance_payment' ? (
              <Button
                variant="secondary"
                title="Update recovery"
                onPress={async () => {
                  const x = await dialog.prompt({
                    title: 'Advance recovered to date',
                    fields: [
                      { key: 'a', label: `Total recovered (${b.currency})`, required: true, initial: String(b.recovered_amount) },
                      { key: 'n', label: 'Note (invoice refs.)', type: 'multiline' },
                    ],
                  });
                  if (!x) return;
                  const amount = Number(String(x.a).replace(/,/g, ''));
                  if (!(amount >= 0)) return dialog.toast('Enter the amount recovered', 'error');
                  await run('update_bond_recovery', { p_id: b.id, p_recovered: amount, p_note: x.n || null }, 'Recovery updated');
                }}
              />
            ) : null}
            <Button variant="secondary" title="Edit details" onPress={() => router.push({ pathname: '/bonds/edit', params: { id: b.id } })} />
            <Button
              variant="ghost"
              title="Claimed (encashed)"
              onPress={async () => {
                const x = await dialog.prompt({
                  title: 'Bond claimed by the customer',
                  fields: [
                    { key: 'd', label: 'Claim date', type: 'date', required: true, initial: today },
                    { key: 'n', label: 'Details', type: 'multiline', required: true },
                  ],
                  danger: true,
                });
                if (x) await run('close_bond', { p_id: b.id, p_status: 'claimed', p_on: x.d, p_note: x.n }, 'Recorded – management alerted');
              }}
            />
            <Button
              variant="ghost"
              title="Cancel record"
              onPress={async () => {
                const x = await dialog.prompt({ title: 'Cancel this bond record', fields: [{ key: 'n', label: 'Reason', type: 'multiline', required: true }], danger: true });
                if (x) await run('close_bond', { p_id: b.id, p_status: 'cancelled', p_on: today, p_note: x.n }, 'Cancelled');
              }}
            />
          </Row>
        ) : null}
      </Card>
      <Attachments entityType="bond" entityId={b.id} kinds={['bond_doc']} title="Documents (bond copy, extension and release letters)" canUpload={ops} allowCamera />
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
