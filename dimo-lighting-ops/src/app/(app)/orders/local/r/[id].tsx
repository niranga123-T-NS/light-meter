import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { catchUp, catchUpOptions, rpc } from '@/components/foreign/actions';
import { FoNotes } from '@/components/foreign/Notes';
import { StepList } from '@/components/foreign/StepList';
import { clearLoStep, recordLoStep } from '@/components/local/actions';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Grid, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import {
  DIC_LIMIT,
  fmtLkr,
  KIND_LABEL,
  LO_KEEPER,
  LO_SHORT,
  LO_STAGES,
  loRoute,
  loStanding,
  termLabel,
  type LoNote,
  type LoOrder,
  type LoRequest,
  type LoStep,
  type LoStepDef,
} from '@/lib/localOrders';
import { supabase } from '@/lib/supabase';

/** A local request: the check, the PR and its approvals, sourcing, and the supplier orders it is split into. */
export default function LocalRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const keeper = LO_KEEPER.includes(me.role);
  const { data, error, reload } = useLoad(async () => {
    const r = await supabase.from('lo_requests').select('*').eq('id', id).maybeSingle();
    if (r.error) throw new Error(r.error.message);
    if (!r.data) throw new Error('Request not found');
    const [o, s, d, v, ov, hol, nt, mr] = await Promise.all([
      supabase.from('lo_orders').select('*').eq('request_id', id).order('seq_no'),
      supabase.from('lo_steps').select('*').eq('request_id', id),
      supabase.from('lo_step_defs').select('*').order('seq'),
      supabase.from('lo_request_values').select('pr_value').eq('request_id', id).maybeSingle(),
      supabase.from('lo_order_values').select('order_id, value'),
      supabase.from('holidays').select('day'),
      supabase.from('lo_notes').select('*').eq('request_id', id).is('order_id', null).order('occurred_on', { ascending: false }),
      r.data.mr_id ? supabase.from('material_requests').select('id, code').eq('id', r.data.mr_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return {
      r: r.data as LoRequest,
      orders: (o.data ?? []) as LoOrder[],
      steps: (s.data ?? []) as LoStep[],
      defs: (d.data ?? []) as LoStepDef[],
      prValue: (v.data as { pr_value: number | null } | null)?.pr_value ?? null,
      seeValues: !!v.data || keeper || ['sm_projects', 'sm_estimation', 'gm'].includes(me.role),
      values: Object.fromEntries(((ov.data ?? []) as { order_id: string; value: number | null }[]).map((x) => [x.order_id, x.value])),
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
      notes: (nt.data ?? []) as LoNote[],
      mr: (mr.data ?? null) as { id: string; code: string | null } | null,
    };
  }, [id, keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { r, orders, steps, defs, prValue, seeValues, values, holidays, notes, mr } = data;
  const lines = loRoute(defs, prValue, null, null, steps, holidays).filter((l) => l.def.scope === 'r');
  const catchOpts = catchUpOptions(lines, []);
  const st = loStanding(lines);
  const open = r.status === 'open';
  const negotiated = steps.some((s) => s.step === 'negotiated' && !s.order_id);
  const mine = me.id === r.requested_by || me.id === r.created_by;

  const ret = async () => {
    const x = await dialog.prompt({ title: `Return ${r.code} to the requester`, message: 'Say what is missing – technical details, quantity or specifications.', fields: [{ key: 'why', label: 'What is missing', type: 'multiline', required: true }], confirmLabel: 'Return' });
    if (x) await dialog.run(async () => { await rpc('lo_return_request', { p_id: r.id, p_reason: x.why }); await reload(); }, 'Returned – the requester is told');
  };
  const cancel = async () => {
    const x = await dialog.prompt({ title: `Cancel ${r.code}`, fields: [{ key: 'why', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Cancel request', danger: true });
    if (x) await dialog.run(async () => { await rpc('lo_cancel_request', { p_id: r.id, p_reason: x.why }); await reload(); }, 'Cancelled');
  };
  const pr = async () => {
    const x = await dialog.prompt({
      title: 'PR value and numbers',
      message: `DIC approval is needed above ${fmtLkr(DIC_LIMIT)}.`,
      fields: [
        { key: 'value', label: 'PR value (LKR)', required: true, initial: prValue != null ? String(prValue) : '' },
        { key: 'nos', label: 'PR nos.', initial: r.pr_nos ?? '', hint: 'Several with commas' },
      ],
      confirmLabel: 'Save',
    });
    if (x) await dialog.run(async () => { await rpc('lo_set_pr', { p_id: r.id, p_pr_nos: x.nos, p_value: Number(x.value.replace(/,/g, '')) }); await reload(); }, 'Saved');
  };

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: r.code ?? 'Local request' }} />
      <TestingBanner what="Local orders" always />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{`${r.code} · ${KIND_LABEL[r.kind]} · received ${fmtDate(r.received_on)}${r.requested_by ? ` · from ${people[r.requested_by]?.full_name ?? ''}` : ''}`}</Muted>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink }}>{`${r.title} – ${r.project_name}`}</Text>
          <Row gap={6} wrap style={{ marginTop: 4 }}>
            <Pill label={r.exec_project_id ? 'Execution project' : 'Supply / other project'} tone={colors.blue} />
            <Pill
              label={r.status === 'open' ? (st.stage <= 7 ? `Stage ${Math.min(st.stage, 4)} · ${LO_SHORT[Math.min(st.stage, 4) - 1]}` : 'Open') : r.status === 'returned' ? 'Returned – details needed' : r.status === 'closed' ? 'Closed' : 'Cancelled'}
              tone={r.status === 'returned' ? colors.amber : r.status === 'closed' ? colors.green : r.status === 'cancelled' ? colors.grey : st.late ? colors.red : colors.blue}
              solid={r.status !== 'open'}
            />
          </Row>
        </View>
        <Row gap={8} wrap>
          {keeper && open ? <Button small variant="ghost" title="Cancel" onPress={cancel} /> : null}
          {keeper && open && !steps.some((s) => s.step === 'lr_checked') ? <Button small variant="secondary" title="Return – details missing" onPress={ret} /> : null}
          {(keeper || mine) && (open || r.status === 'returned') ? (
            <Button small variant={r.status === 'returned' ? 'primary' : 'secondary'} title={r.status === 'returned' ? 'Complete and send again' : 'Edit'} onPress={() => router.push({ pathname: '/orders/local/request-form', params: { id: r.id } })} />
          ) : null}
        </Row>
      </Row>
      {r.status === 'returned' ? <Notice tone={colors.amber}>{`Returned by Operations: ${r.return_reason ?? ''}`}</Notice> : null}
      {r.cancel_reason ? <Notice tone={colors.grey}>{`Cancelled: ${r.cancel_reason}`}</Notice> : null}

      <Grid min={220}>
        <KeyValue label="Technical details" value={r.details ?? '—'} />
        <KeyValue label="Quantity" value={r.quantity ?? '—'} />
        <KeyValue label="Specifications" value={r.specs ?? '—'} />
        <KeyValue label="Required by" value={r.required_on ? fmtDate(r.required_on) : '—'} />
        <KeyValue label="Delivery / work location" value={r.delivery_location} />
        <KeyValue label="Client" value={r.client ?? '—'} />
        {r.sales_person_id ? <KeyValue label="Sales person" value={people[r.sales_person_id]?.full_name ?? ''} /> : null}
        {mr ? <KeyValue label="Site material request" value={<Button small variant="ghost" title={`${mr.code ?? 'Material request'} ›`} onPress={() => router.push(`/execution/material/${mr.id}`)} />} /> : null}
        {seeValues ? (
          <KeyValue
            label="PR value · PR nos."
            value={
              <Row gap={6} wrap style={{ alignItems: 'center' }}>
                <Text style={{ color: colors.text }}>{`${fmtLkr(prValue)}${r.pr_nos ? ` · ${r.pr_nos}` : ''}${prValue != null ? (prValue > DIC_LIMIT ? ' · DIC needed' : ' · no DIC') : ''}`}</Text>
                {keeper && open ? <Button small variant="ghost" title="Change" onPress={pr} /> : null}
              </Row>
            }
          />
        ) : null}
      </Grid>
      {r.notes ? <Muted>{r.notes}</Muted> : null}

      <Section title="Request, PR and sourcing" right={keeper && open && catchOpts.length ? <Button small variant="ghost" title="Started before the system…" onPress={async () => { if (await catchUp(dialog, catchOpts, 'lo_catch_up', { p_request: r.id, p_order: null })) await reload(); }} /> : null}>
        <StepList
          lines={lines}
          keeper={keeper && open}
          handoverId={r.id}
          orderId={null}
          people={people}
          onChange={reload}
          skip={['lr_received']}
          stageNames={LO_STAGES}
          onRecord={(l) => recordLoStep(dialog, l, r.id, null)}
          onClear={(l) => clearLoStep(dialog, l)}
        />
      </Section>

      <Section
        title={`Supplier orders · ${orders.length}`}
        right={keeper && open ? <Button small title="+ Supplier order" onPress={() => router.push({ pathname: '/orders/local/order-form', params: { request: r.id } })} disabled={!negotiated} /> : null}
      >
        {keeper && open && !negotiated ? <Muted>Added from Procurement’s final selection, once “Negotiation completed” is recorded. One order per supplier.</Muted> : null}
        {orders.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {orders.map((o) => {
              const ost = loStanding(loRoute(defs, prValue, o, values[o.id] ?? null, steps, holidays).filter((l) => l.def.scope === 'o'));
              return (
                <ListRow
                  key={o.id}
                  title={`${o.code} · ${o.title}`}
                  subtitle={`${o.supplier} · ${o.kind === 'material' ? 'Material' : 'Service'} · ${termLabel(o)}${seeValues && values[o.id] != null ? ` · ${fmtLkr(values[o.id])}` : ''}`}
                  right={
                    <Pill
                      label={o.status === 'completed' ? 'Closed' : o.status === 'cancelled' ? 'Cancelled' : `${Math.min(ost.stage, 7)} · ${LO_SHORT[Math.min(ost.stage, 7) - 1]}`}
                      tone={o.status === 'completed' ? colors.green : o.status === 'cancelled' ? colors.grey : ost.late ? colors.red : colors.blue}
                    />
                  }
                  wrapRight
                  onPress={() => router.push(`/orders/local/${o.id}`)}
                />
              );
            })}
          </Card>
        ) : null}
      </Section>

      <FoNotes
        module="lo"
        notes={notes}
        lines={lines}
        handoverId={r.id}
        orderId={null}
        keeper={keeper && r.status !== 'cancelled'}
        people={people}
        onChange={reload}
        stageNames={LO_STAGES}
        who="SM Projects, the DGM, SM Estimation, the requester, the sales person and the SEE"
      />
    </Screen>
  );
}
