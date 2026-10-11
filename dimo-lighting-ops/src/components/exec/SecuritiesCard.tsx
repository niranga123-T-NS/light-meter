import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { PROJECT_TYPES } from '@/lib/roles';
import { rpc } from '@/lib/supabase';

type Terms = {
  pb_applicable: boolean;
  pb_pct: number | null;
  pb_value: number | null;
  ap_applicable: boolean;
  ap_pct: number | null;
  ap_value: number | null;
  note: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  adv_invoice_no: string | null;
  adv_invoice_date: string | null;
  adv_invoice_amount: number | null;
  adv_due_date: string | null;
  adv_received_at: string | null;
  blocked: boolean;
  blocked_by: string | null;
  blocked_at: string | null;
  block_reason: string | null;
  extensions: number;
  last_extension_reason: string | null;
};
type Bond = { id: string; code: string; bond_type: 'performance' | 'advance_payment'; bond_no: string; bank: string; bond_value: number; currency: string; issue_date: string; expiry_date: string; status: string };
type Receipt = { id: string; amount: number; received_on: string; ref: string | null; note: string | null; by_id: string };
type View_ = {
  contract_value: number | null;
  terms: Terms | null;
  received: number;
  status: 'to_submit' | 'not_applicable' | 'bond_pending' | 'to_invoice' | 'awaiting' | 'part_received' | 'received';
  overdue_days: number | null;
  bonds: Bond[];
  receipts: Receipt[];
};

const STATUS: Record<View_['status'], { label: string; tone: string }> = {
  to_submit: { label: 'SEE to submit', tone: colors.amber },
  not_applicable: { label: 'No advance', tone: colors.grey },
  bond_pending: { label: 'Advance bond to enter', tone: colors.amber },
  to_invoice: { label: 'Advance to invoice', tone: colors.amber },
  awaiting: { label: 'Awaiting the advance', tone: colors.blue },
  part_received: { label: 'Part received', tone: colors.blue },
  received: { label: 'Advance received', tone: colors.green },
};
const BOND_LABEL = { performance: 'Performance bond', advance_payment: 'Advance payment bond' } as const;
const num = (v: string | undefined) => (v ? Number(v.replace(/,/g, '')) : null);

/** Bonds and advance payment of an awarded project – on the overview only (not in invoicing). SEE, SM Projects, GM / DGM and Operations. */
export function SecuritiesCard({ p, onChange }: { p: ExecProject; onChange?: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const see = me.role === 'senior_elec_engineer';
  const boss = me.role === 'sm_projects' || me.role === 'gm';
  const { data, reload } = useLoad(() => rpc<View_>('exec_securities_view', { p_exec: p.id }), [p.id]);
  if (!data) return <Loading />;
  const t = data.terms;
  const st = STATUS[data.status];
  const active = p.status === 'active';
  const hasBond = (k: Bond['bond_type']) => data.bonds.some((b) => b.bond_type === k && b.status === 'active');
  const outstanding = t?.adv_invoice_amount != null && !t.adv_received_at ? Number(t.adv_invoice_amount) - Number(data.received) : 0;
  const done = async () => {
    await reload();
    onChange?.();
  };

  const submit = async () => {
    const r = await dialog.prompt({
      title: 'Bonds and advance – what applies',
      message: `Check the contract and submit. Contract value ${fmtMoney(data.contract_value ?? 0, 'LKR')}. Enter a % (the value is worked out) or the value.`,
      fields: [
        { key: 'pb', label: 'Performance bond', type: 'select', required: true, initial: t ? (t.pb_applicable ? 'yes' : 'no') : 'yes', options: [{ value: 'yes', label: 'Applicable' }, { value: 'no', label: 'Not applicable' }] },
        { key: 'pb_pct', label: 'Performance bond – % of the contract value', initial: t?.pb_pct != null ? String(t.pb_pct) : '10' },
        { key: 'pb_value', label: 'Performance bond – value (LKR, if not by %)', initial: t?.pb_pct == null && t?.pb_value != null ? String(t.pb_value) : undefined },
        { key: 'ap', label: 'Advance payment (needs an advance payment bond)', type: 'select', required: true, initial: t ? (t.ap_applicable ? 'yes' : 'no') : 'yes', options: [{ value: 'yes', label: 'Applicable' }, { value: 'no', label: 'Not applicable' }] },
        { key: 'ap_pct', label: 'Advance – % of the contract value', initial: t?.ap_pct != null ? String(t.ap_pct) : undefined },
        { key: 'ap_value', label: 'Advance – amount (LKR, if not by %)', initial: t?.ap_pct == null && t?.ap_value != null ? String(t.ap_value) : undefined },
        { key: 'note', label: 'Note (contract clause, reason if not applicable)', type: 'multiline', initial: t?.note ?? undefined },
      ],
      confirmLabel: 'Submit',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('submit_securities', {
          p_exec: p.id,
          p: { pb_applicable: r.pb === 'yes', pb_pct: num(r.pb_pct), pb_value: num(r.pb_value), ap_applicable: r.ap === 'yes', ap_pct: num(r.ap_pct), ap_value: num(r.ap_value), note: r.note || null },
        });
        await done();
      }, 'Submitted – SM Projects, the GM / DGM and Operations are told');
  };
  const addBond = async (kind: Bond['bond_type']) => {
    const r = await dialog.prompt({
      title: `Enter the ${BOND_LABEL[kind].toLowerCase()}`,
      message: 'It is recorded in the Bonds tab with the expiry alerts.',
      fields: [
        { key: 'bond_no', label: 'Bond number', required: true },
        { key: 'bank', label: 'Bank', required: true },
        { key: 'branch', label: 'Branch' },
        { key: 'value', label: 'Bond value (LKR)', required: true, initial: String(kind === 'performance' ? (t?.pb_value ?? '') : (t?.ap_value ?? '')) },
        { key: 'issue', label: 'Issue date', type: 'date', required: true, initial: todayISO() },
        { key: 'expiry', label: 'Valid until', type: 'date', required: true },
        ...(p.project_id ? [] : [{ key: 'category', label: 'Category (decides the sales owner)', type: 'select' as const, required: true, options: PROJECT_TYPES.map((x) => ({ value: x.value, label: x.label })) }]),
      ],
      confirmLabel: 'Save',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('save_project_bond', {
          p_exec: p.id,
          p: { bond_type: kind, bond_no: r.bond_no, bank: r.bank, bank_branch: r.branch || null, bond_value: num(r.value), issue_date: r.issue, expiry_date: r.expiry, category: r.category || null },
        });
        await done();
      }, 'Bond recorded');
  };
  const invoice = async () => {
    const r = await dialog.prompt({
      title: 'Advance payment invoice',
      message: 'Kept apart from invoicing – it shows only here. The advance is due 14 days after the invoice date.',
      fields: [
        { key: 'no', label: 'Invoice number', required: true },
        { key: 'date', label: 'Invoice date', type: 'date', required: true, initial: todayISO() },
        { key: 'amount', label: 'Amount (LKR)', required: true, initial: String(t?.ap_value ?? '') },
      ],
      confirmLabel: 'Save',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('record_advance_invoice', { p_exec: p.id, p: { invoice_no: r.no, date: r.date, amount: num(r.amount) } });
        await done();
      }, 'Advance invoice recorded');
  };
  const receipt = async () => {
    const r = await dialog.prompt({
      title: 'Advance received',
      message: `Still due: ${fmtMoney(outstanding, 'LKR')}. A part payment is fine.`,
      fields: [
        { key: 'amount', label: 'Amount received (LKR)', required: true, initial: String(outstanding) },
        { key: 'date', label: 'Date received', type: 'date', required: true, initial: todayISO() },
        { key: 'ref', label: 'Reference (cheque / transfer / receipt no.)' },
        { key: 'note', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: 'Save',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('record_advance_receipt', { p_exec: p.id, p: { amount: num(r.amount), date: r.date, ref: r.ref || null, note: r.note || null } });
        await done();
      }, 'Receipt recorded');
  };
  const decide = async (action: 'block' | 'extend' | 'unblock') => {
    const r = await dialog.prompt({
      title: action === 'block' ? 'Block the project' : action === 'extend' ? 'Extend the advance date' : 'Unblock the project',
      message:
        action === 'block'
          ? 'No new material requests, approvals or orders, no programme approval and no new subcontractor certificates until the advance is received (or you unblock / extend).'
          : undefined,
      fields: [
        ...(action === 'extend' ? [{ key: 'date', label: 'New date', type: 'date' as const, required: true }] : []),
        { key: 'reason', label: 'Reason', type: 'multiline', required: true },
      ],
      confirmLabel: action === 'block' ? 'Block' : action === 'extend' ? 'Extend' : 'Unblock',
      danger: action === 'block',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('decide_advance_delay', { p_exec: p.id, p_action: action, p_reason: r.reason, p_date: r.date || null });
        await done();
      }, action === 'block' ? 'Project blocked' : action === 'extend' ? 'Date extended' : 'Unblocked');
  };

  return (
    <Section title="Bonds and advance payment" right={<Pill label={st.label} tone={st.tone} solid={data.status === 'received'} />}>
      <Card style={{ gap: 6 }}>
        {t?.blocked ? (
          <Notice tone={colors.red}>{`Project blocked by ${people[t.blocked_by ?? '']?.full_name ?? ''} on ${fmtDate(t.blocked_at)} – ${t.block_reason ?? ''}. It is lifted when the advance is fully received.`}</Notice>
        ) : null}
        {data.overdue_days ? <Notice tone={colors.red}>{`Advance ${data.overdue_days} day(s) late – ${fmtMoney(outstanding, 'LKR')} still due (due ${fmtDate(t?.adv_due_date)}).`}</Notice> : null}

        {!t?.submitted_at ? (
          <Muted>The SEE checks the contract for the performance bond and the advance payment (rates and values) and submits them.</Muted>
        ) : (
          <>
            <KeyValue
              label="Performance bond"
              value={t.pb_applicable ? `${t.pb_pct != null ? `${t.pb_pct}% · ` : ''}${fmtMoney(t.pb_value ?? 0, 'LKR')}` : 'Not applicable'}
            />
            <KeyValue label="Advance payment" value={t.ap_applicable ? `${t.ap_pct != null ? `${t.ap_pct}% · ` : ''}${fmtMoney(t.ap_value ?? 0, 'LKR')}` : 'Not applicable'} />
            {t.note ? <KeyValue label="Note" value={t.note} /> : null}
            <Muted>{`Submitted by ${people[t.submitted_by ?? '']?.full_name ?? ''} · ${fmtDate(t.submitted_at)}`}</Muted>
          </>
        )}
        {see && active && !t?.adv_invoice_date ? (
          <Row>
            <Button small variant={t?.submitted_at ? 'secondary' : 'primary'} title={t?.submitted_at ? 'Change the terms' : 'Submit bonds and advance'} onPress={submit} />
          </Row>
        ) : null}
      </Card>

      {t?.submitted_at && (t.pb_applicable || t.ap_applicable) ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {data.bonds.map((b) => (
            <ListRow
              key={b.id}
              title={`${BOND_LABEL[b.bond_type]} · ${b.bond_no}`}
              subtitle={`${b.bank} · ${fmtMoney(b.bond_value, 'LKR')} · valid ${fmtDate(b.issue_date)} – ${fmtDate(b.expiry_date)}`}
              right={<Pill label={b.status === 'active' ? 'Active' : b.status} tone={b.status === 'active' ? colors.green : colors.grey} />}
              onPress={() => router.push(`/bonds/${b.id}`)}
            />
          ))}
          {!data.bonds.length ? <Muted style={{ padding: 12 }}>No bonds entered yet.</Muted> : null}
          {see && active && ((t.pb_applicable && !hasBond('performance')) || (t.ap_applicable && !hasBond('advance_payment'))) ? (
            <Row gap={8} wrap style={{ padding: 10 }}>
              {t.pb_applicable && !hasBond('performance') ? <Button small title="+ Performance bond" onPress={() => addBond('performance')} /> : null}
              {t.ap_applicable && !hasBond('advance_payment') ? <Button small title="+ Advance payment bond" onPress={() => addBond('advance_payment')} /> : null}
            </Row>
          ) : null}
        </Card>
      ) : null}

      {t?.ap_applicable && t.submitted_at ? (
        <Card style={{ gap: 6 }}>
          <Text style={{ fontWeight: '700', color: colors.ink }}>Advance payment</Text>
          {t.adv_invoice_date ? (
            <>
              <Row wrap gap={16}>
                <View>
                  <Muted>Invoiced</Muted>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{fmtMoney(t.adv_invoice_amount ?? 0, 'LKR')}</Text>
                </View>
                <View>
                  <Muted>Received</Muted>
                  <Text style={{ fontWeight: '700', color: colors.green }}>{fmtMoney(data.received, 'LKR')}</Text>
                </View>
                <View>
                  <Muted>Still due</Muted>
                  <Text style={{ fontWeight: '700', color: outstanding > 0 ? colors.red : colors.green }}>{fmtMoney(outstanding, 'LKR')}</Text>
                </View>
                <View>
                  <Muted>Due by</Muted>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{fmtDate(t.adv_due_date)}</Text>
                </View>
              </Row>
              <Muted>{`Invoice ${t.adv_invoice_no} · ${fmtDate(t.adv_invoice_date)}${t.extensions ? ` · extended ${t.extensions}× – ${t.last_extension_reason ?? ''}` : ''}`}</Muted>
              {data.receipts.map((x) => (
                <Muted key={x.id}>{`✓ ${fmtDate(x.received_on)} · ${fmtMoney(x.amount, 'LKR')}${x.ref ? ` · ${x.ref}` : ''}${x.note ? ` · ${x.note}` : ''} · ${people[x.by_id]?.full_name ?? ''}`}</Muted>
              ))}
            </>
          ) : (
            <Muted>{hasBond('advance_payment') ? 'Advance payment bond entered – raise the advance payment invoice.' : 'Enter the advance payment bond first; then the advance payment invoice.'}</Muted>
          )}
          <Row gap={8} wrap>
            {see && active && !t.adv_invoice_date && hasBond('advance_payment') ? <Button small title="Record the advance invoice" onPress={invoice} /> : null}
            {see && outstanding > 0 ? <Button small title="+ Advance received" onPress={receipt} /> : null}
            {boss && outstanding > 0 && !t.blocked ? <Button small variant="danger" title="Block the project" onPress={() => decide('block')} /> : null}
            {boss && outstanding > 0 ? <Button small variant="secondary" title="Extend the date" onPress={() => decide('extend')} /> : null}
            {boss && t.blocked ? <Button small variant="secondary" title="Unblock" onPress={() => decide('unblock')} /> : null}
          </Row>
          <Muted>Kept apart from invoicing – not in Invoicing, the invoiced figures or the budget list.</Muted>
        </Card>
      ) : null}
    </Section>
  );
}
