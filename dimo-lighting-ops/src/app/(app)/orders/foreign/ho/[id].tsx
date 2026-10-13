import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { editHandover, editOrder, rpc } from '@/components/foreign/actions';
import { StepList } from '@/components/foreign/StepList';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, Grid, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { FO_KEEPER, route, SHORT_STAGES, standing, termsLabel, type FoOrder, type Handover, type LocationChange, type Step, type StepDef } from '@/lib/foreignOrders';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** A hand-over: client, sales person, SAP project and delivery location; its own steps (stages 1–3) and its import orders. */
export default function HandoverPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const keeper = FO_KEEPER.includes(me.role);
  const { data, error, reload } = useLoad(async () => {
    const [h, o, s, d, lc, hol, ep] = await Promise.all([
      supabase.from('fo_handovers').select('*').eq('id', id).maybeSingle(),
      supabase.from('fo_orders').select('*').eq('handover_id', id).order('seq_no'),
      supabase.from('fo_steps').select('*').eq('handover_id', id),
      supabase.from('fo_step_defs').select('*').order('seq'),
      supabase.from('fo_location_changes').select('*').eq('handover_id', id).order('requested_at', { ascending: false }),
      supabase.from('holidays').select('day'),
      keeper ? supabase.from('exec_projects').select('project_id, code, name').order('name') : Promise.resolve({ data: [], error: null }),
    ]);
    if (h.error) throw new Error(h.error.message);
    if (!h.data) throw new Error('Hand-over not found');
    return {
      h: h.data as Handover,
      orders: (o.data ?? []) as FoOrder[],
      steps: (s.data ?? []) as Step[],
      defs: (d.data ?? []) as StepDef[],
      changes: (lc.data ?? []) as LocationChange[],
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
      projects: ((ep.data ?? []) as { project_id: string; code: string | null; name: string }[]).map((p) => ({ value: p.project_id, label: p.name, hint: p.code ?? undefined })),
    };
  }, [id, keeper]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { h, orders, steps, defs, changes, holidays, projects } = data;
  const lines = route(defs, h, null, steps, orders, holidays).filter((l) => l.def.scope === 'h');
  const pending = changes.find((c) => c.status === 'pending');
  const approver = me.role === 'sm_projects' || me.role === 'sm_estimation';
  const myTurn = pending && ((me.role === 'sm_projects' && !pending.smp_by) || (me.role === 'sm_estimation' && !pending.est_by));
  const open = h.status === 'open';

  const requestChange = async () => {
    const r = await dialog.prompt({
      title: 'Change the delivery location',
      message: 'SM Projects and SM Estimation both approve; the sales person is then told.',
      fields: [
        { key: 'loc', label: 'New delivery location', required: true },
        { key: 'reason', label: 'Reason', type: 'multiline', required: true },
      ],
      confirmLabel: 'Send for approval',
    });
    if (r) await dialog.run(async () => { await rpc('fo_request_location', { p_handover: h.id, p_location: r.loc, p_reason: r.reason }); await reload(); }, 'Sent for approval');
  };
  const decide = async (action: 'approve' | 'reject' | 'withdraw') => {
    if (!pending) return;
    let note: string | null = null;
    if (action === 'reject') {
      const r = await dialog.prompt({ title: 'Reject the change', fields: [{ key: 'note', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Reject', danger: true });
      if (!r) return;
      note = r.note;
    } else if (!(await dialog.confirm(action === 'approve' ? `Approve: deliver to ${pending.new_location}?` : 'Withdraw the request?'))) return;
    await dialog.run(async () => { await rpc('fo_decide_location', { p_id: pending.id, p_action: action, p_note: note }); await reload(); }, action === 'approve' ? 'Approved' : 'Done');
  };
  const cancel = async () => {
    const r = await dialog.prompt({ title: `Cancel ${h.code}`, message: 'Cancels the hand-over and its open import orders.', fields: [{ key: 'reason', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Cancel hand-over', danger: true });
    if (r) await dialog.run(async () => { await rpc('fo_cancel_handover', { p_id: h.id, p_reason: r.reason }); await reload(); }, 'Cancelled');
  };

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: h.code ?? 'Hand-over' }} />
      <TestingBanner what="Foreign orders" always />
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{`${h.code} · hand-over received ${fmtDate(h.received_on)}`}</Muted>
          <Row gap={8} wrap style={{ alignItems: 'center' }}>
            <Pill label={open ? 'Open' : h.status === 'closed' ? 'Closed – all delivered' : 'Cancelled'} tone={open ? colors.blue : h.status === 'closed' ? colors.green : colors.grey} />
          </Row>
        </View>
        {keeper && open ? (
          <Row gap={8} wrap>
            <Button small variant="ghost" title="Cancel" onPress={cancel} />
            <Button small variant="secondary" title="Edit" onPress={async () => { if (await editHandover(dialog, people, projects, h)) await reload(); }} />
          </Row>
        ) : null}
      </Row>
      {h.cancel_reason ? <Notice tone={colors.grey}>{`Cancelled: ${h.cancel_reason}`}</Notice> : null}
      <Card>
        <Grid min={220}>
          <KeyValue label="Project" value={h.project_name} />
          <KeyValue label="Client" value={`${h.client}${h.client_new ? ' (new in SAP)' : ''}`} />
          <KeyValue label="Sales person" value={h.sales_person_id ? people[h.sales_person_id]?.full_name ?? '—' : '—'} />
          <KeyValue label="PI no." value={h.pi_ref ?? '—'} />
          <KeyValue label="SAP project" value={h.sap_project_no ?? '—'} />
          <KeyValue label="Final delivery location" value={h.delivery_location} />
        </Grid>
        {h.notes ? <Muted>{h.notes}</Muted> : null}
      </Card>

      <Section
        title="Delivery location"
        right={keeper && open && !pending ? <Button small variant="secondary" title="Request a change" onPress={requestChange} /> : null}
      >
        {pending ? (
          <Card style={{ gap: 6 }}>
            <Muted>{`Change requested ${fmtDateTime(pending.requested_at)}: ${pending.old_location} → ${pending.new_location}`}</Muted>
            <Muted>{`Reason: ${pending.reason}`}</Muted>
            <Muted>{`SM Projects: ${pending.smp_by ? `approved ${fmtDate(pending.smp_at)}` : 'waiting'} · SM Estimation: ${pending.est_by ? `approved ${fmtDate(pending.est_at)}` : 'waiting'}`}</Muted>
            <Row gap={8} wrap>
              {approver && myTurn ? <Button small title="Approve" onPress={() => decide('approve')} /> : null}
              {approver && myTurn ? <Button small variant="ghost" title="Reject" onPress={() => decide('reject')} /> : null}
              {keeper ? <Button small variant="ghost" title="Withdraw" onPress={() => decide('withdraw')} /> : null}
            </Row>
          </Card>
        ) : (
          <Muted>{`Delivering to ${h.delivery_location}. A change needs SM Projects and SM Estimation approval.`}</Muted>
        )}
        {changes.filter((c) => c.status !== 'pending').map((c) => (
          <Muted key={c.id}>{`${fmtDate(c.requested_at)} · ${c.old_location} → ${c.new_location} · ${c.status}${c.decision_note ? ` (${c.decision_note})` : ''}`}</Muted>
        ))}
      </Section>

      <Section title="Hand-over steps (stages 1–3)">
        <StepList lines={lines} keeper={keeper && open} handoverId={h.id} orderId={null} people={people} onChange={reload} />
      </Section>

      <Section title={`Import orders · ${orders.length}`} right={keeper && open ? <Button small title="+ Import order" onPress={async () => { const oid = await editOrder(dialog, h.id); if (oid) await reload(); }} /> : null}>
        {orders.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {orders.map((o) => {
              const st = standing(route(defs, h, o, steps, orders, holidays));
              return (
                <ListRow
                  key={o.id}
                  highlight={o.status === 'open' && st.late ? colors.red : undefined}
                  title={`${o.seq_no} · ${o.title}`}
                  subtitle={`${o.code} · ${o.vendor} · ${termsLabel(o)}${o.status === 'open' ? `\nWith ${st.with || '—'}` : ''}`}
                  right={
                    <Pill
                      label={o.status === 'delivered' ? (o.kind === 'service' ? 'Completed' : 'Delivered') : o.status === 'cancelled' ? 'Cancelled' : `${Math.min(st.stage, 9)} · ${SHORT_STAGES[Math.min(st.stage, 9) - 1]}`}
                      tone={o.status === 'delivered' ? colors.green : o.status === 'cancelled' ? colors.grey : st.late ? colors.red : colors.blue}
                    />
                  }
                  wrapRight
                  onPress={() => router.push(`/orders/foreign/${o.id}`)}
                />
              );
            })}
          </Card>
        ) : (
          <Notice tone={colors.amber}>Split the hand-over into import orders – one per manufacturer or shipment. Each runs its own route from stage 4.</Notice>
        )}
      </Section>
    </Screen>
  );
}
