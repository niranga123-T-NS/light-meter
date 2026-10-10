import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { useShellCounts } from '@/components/AppShell';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { varTone } from '@/components/exec/VariationRows';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { DESIGN_SCOPE, ESTIMATION_BASIS, ESTIMATION_SCOPE } from '@/lib/constants';
import { VAR_NEXT, VAR_REASONS, VAR_ROUTES, VAR_STATUS, type ProjVariation, type Variation } from '@/lib/execution';
import { addDaysISO, fmtDate, fmtDateTime, fmtMoney, human, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

/** One variation: screen (SEE), approve by value (SM Projects → DGM / GM), client's answer (SEE). */
export default function VariationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { refresh } = useShellCounts();
  const { data, error, reload } = useLoad(async () => {
    const { data: v, error: e } = await supabase.from('variations').select('*, exec_projects(name, code)').eq('id', id).single();
    if (e) throw new Error(e.message);
    const all = await rpc<ProjVariation[]>('project_variations', { p_exec: (v as Variation).exec_project_id }).catch(() => [] as ProjVariation[]);
    return { ...(v as Variation & { exec_projects: { name: string; code: string } | null }), pv: all.find((x) => x.id === id) };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const v = data;
  const see = me.role === 'senior_elec_engineer';
  const after = async () => {
    await reload();
    refresh();
  };

  const screen = async () => {
    const r = await dialog.prompt({
      title: 'Screen the variation',
      fields: [
        {
          key: 'd',
          label: 'Decision',
          type: 'select',
          required: true,
          options: [
            { value: 'A', label: 'Design + estimation (scope, layout or lux changes)' },
            { value: 'B', label: 'Estimation only (quantities of known items)' },
            { value: 'C', label: 'Price from the contract rates (items in the BOQ)' },
            { value: 'reject', label: 'Reject' },
          ],
        },
      ],
      confirmLabel: 'Next',
    });
    if (!r) return;
    if (r.d === 'reject') {
      const x = await dialog.prompt({ title: 'Reject', fields: [{ key: 'note', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Reject', danger: true });
      if (x) await dialog.run(async () => { await rpc('screen_variation', { p_id: v.id, p_decision: 'reject', p: x }); await after(); }, 'Rejected');
      return;
    }
    if (r.d === 'C') {
      // With an approved contract BOQ: pick the items and quantities – priced at the BOQ rates
      const { data: bi } = await supabase
        .from('exec_boq_items')
        .select('id, item_no, description, unit, rate, section')
        .eq('exec_project_id', v.exec_project_id)
        .eq('heading', false)
        .eq('removed', false)
        .eq('source', 'boq')
        .not('rate', 'is', null)
        .order('seq');
      const items = (bi ?? []) as { id: string; item_no: string | null; description: string; unit: string | null; rate: number; section: string | null }[];
      if (items.length) {
        const pick = await dialog.prompt({
          title: 'Price from the contract BOQ',
          message: 'Choose the BOQ items this variation adds (or omits). The value is worked out at the BOQ rates.',
          fields: [
            {
              key: 'items',
              label: 'BOQ items',
              type: 'multiselect',
              required: true,
              options: items.map((i) => ({ value: i.id, label: `${i.item_no ? `${i.item_no} ` : ''}${i.description}`, group: i.section, hint: `${fmtMoney(i.rate, 'LKR')} / ${i.unit ?? 'unit'}` })),
            },
          ],
          confirmLabel: 'Next',
        });
        if (!pick) return;
        const chosen = items.filter((i) => pick.items.split(',').includes(i.id));
        const x = await dialog.prompt({
          title: 'Quantities',
          fields: [
            ...chosen.map((i) => ({ key: `q_${i.id}`, label: `${i.item_no ? `${i.item_no} ` : ''}${i.description} (${i.unit ?? 'qty'})`, required: true })),
            { key: 'cost', label: 'Cost (LKR, optional – gives the margin)' },
            { key: 'time_days', label: 'Time impact (days)' },
            { key: 'note', label: 'Note', type: 'multiline' as const },
          ],
          confirmLabel: 'Send to SM Projects',
        });
        if (x)
          await dialog.run(async () => {
            const boq_lines = chosen.map((i) => ({ boq_item_id: i.id, qty: Number(x[`q_${i.id}`]) }));
            await rpc('screen_variation', { p_id: v.id, p_decision: 'C', p: { boq_lines, cost: x.cost, time_days: x.time_days, note: x.note } });
            await after();
          }, 'Sent to SM Projects');
        return;
      }
      const x = await dialog.prompt({
        title: 'Price from the contract rates',
        fields: [
          { key: 'value', label: `Value (LKR)${v.vtype === 'omission' ? ' – deducted' : ''}`, required: true },
          { key: 'cost', label: 'Cost (LKR, optional – gives the margin)' },
          { key: 'time_days', label: 'Time impact (days)' },
          { key: 'note', label: 'Note', type: 'multiline' },
        ],
        confirmLabel: 'Send to SM Projects',
      });
      if (x) await dialog.run(async () => { await rpc('screen_variation', { p_id: v.id, p_decision: 'C', p: x }); await after(); }, 'Sent to SM Projects');
      return;
    }
    const x = await dialog.prompt({
      title: r.d === 'A' ? 'Design + estimation' : 'Estimation only',
      message: 'A variation inquiry on this project goes through the normal design and estimation boards (marked Variation).',
      fields: [
        { key: 'required_by', label: 'Price needed by', type: 'date', required: true, initial: addDaysISO(todayISO(), 7) },
        ...(r.d === 'A' ? [{ key: 'design_scope', label: 'Design scope', type: 'select' as const, required: true, options: DESIGN_SCOPE }] : []),
        { key: 'scope', label: 'What Estimation must price', type: 'multiselect', required: true, options: ESTIMATION_SCOPE },
        { key: 'estimation_basis', label: 'Estimation basis', type: 'select', required: true, options: ESTIMATION_BASIS },
        { key: 'note', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: 'Send',
    });
    if (x)
      await dialog.run(async () => {
        const res = await rpc<string>('screen_variation', { p_id: v.id, p_decision: r.d, p: { ...x, estimation_scope: (x.scope ?? '').split(',').filter(Boolean) } });
        await after();
        if (res !== 'submitted') dialog.toast(`Variation inquiry: ${human(res)}`, 'error');
      }, 'Sent to Design / Estimation');
  };

  const decide = async (approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? 'Approve the variation' : 'Reject the variation',
      fields: [{ key: 'n', label: approve ? 'Comment (optional)' : 'Reason', type: 'multiline', required: !approve }],
      confirmLabel: approve ? 'Approve' : 'Reject',
      danger: !approve,
    });
    if (r)
      await dialog.run(async () => {
        const res = await rpc<string>('decide_exec_variation', { p_id: v.id, p_approve: approve, p_note: r.n || null });
        await after();
        if (res === 'pending_gm') dialog.toast('Above your limit – sent to DGM / GM', 'ok');
      }, approve ? 'Recorded' : 'Rejected');
  };

  const pv = v.pv;
  const submitClient = async () => {
    const r = await dialog.prompt({
      title: 'Submitted to the client / consultant',
      fields: [
        { key: 'date', label: 'Submitted on', type: 'date', required: true, initial: todayISO() },
        { key: 'due', label: 'Answer agreed by', type: 'date', required: true, initial: addDaysISO(todayISO(), 14) },
        { key: 'ref', label: 'Letter / reference' },
      ],
      confirmLabel: 'Record',
    });
    if (r) await dialog.run(async () => { await rpc('submit_variation_to_client', { p_id: v.id, p: r }); await after(); }, 'Recorded – SM Projects and DGM / GM are told if it runs late');
  };
  const moveDue = async () => {
    const r = await dialog.prompt({
      title: 'Move the agreed date',
      message: pv ? `${pv.stage_label}${pv.due ? ` · agreed ${fmtDate(pv.due)}` : ''}` : undefined,
      fields: [
        { key: 'd', label: 'New agreed date', type: 'date', required: true },
        { key: 'r', label: 'Reason', type: 'multiline', required: true },
      ],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('set_variation_due', { p_id: v.id, p_due: r.d, p_reason: r.r }); await after(); }, 'Saved – SM Projects told');
  };
  const client = async (accepted: boolean) => {
    const r = await dialog.prompt({
      title: accepted ? "Client accepted – record the variation order" : 'Client rejected',
      message: accepted ? 'Attach the signed VO or the client letter below first (Variation order / client letter).' : undefined,
      fields: accepted
        ? [
            { key: 'vo_no', label: 'VO number', required: true },
            { key: 'date', label: 'Date', type: 'date', required: true, initial: todayISO() },
            ...(Number(v.value_lkr ?? 0) > 0 ? [{ key: 'month', label: 'Invoice month (for the schedule)', type: 'date' as const, initial: todayISO() }] : []),
            { key: 'note', label: 'Note', type: 'multiline' },
          ]
        : [{ key: 'note', label: "Client's reason", type: 'multiline', required: true }],
      confirmLabel: 'Record',
    });
    if (r)
      await dialog.run(async () => {
        const res = await rpc<string>('record_variation_client', { p_id: v.id, p_accepted: accepted, p: r });
        await after();
        if (res === 'secured_updated') dialog.toast('The secured project value and invoice schedule are updated', 'ok');
      }, 'Recorded');
  };

  return (
    <Screen maxWidth={860} onRefresh={reload}>
      <Stack.Screen options={{ title: v.code }} />
      <TestingBanner what="Variations" />
      <Card>
        <Row style={{ justifyContent: 'space-between' }} wrap>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>{v.title}</Text>
          <Pill label={VAR_STATUS[v.status]} tone={varTone(v.status)} solid />
        </Row>
        <Muted>{`${v.exec_projects?.name ?? ''} · ${v.vtype} · ${VAR_REASONS.find((x) => x.value === v.reason)?.label ?? v.reason} · raised by ${people[v.raised_by]?.full_name ?? ''} ${fmtDateTime(v.raised_at)}`}</Muted>
        <KeyValue label="Description" value={v.description} />
        {v.quantities ? <KeyValue label="Quantities" value={v.quantities} /> : null}
        {v.client_ref ? <KeyValue label="Client instruction" value={v.client_ref} /> : null}
        {v.route ? <KeyValue label="Route" value={`${VAR_ROUTES[v.route]}${v.inquiry_status ? ` · inquiry ${human(v.inquiry_status)}` : ''}`} /> : null}
        {v.value_lkr != null ? (
          <KeyValue
            label="Value"
            value={`${v.value_lkr > 0 ? '+' : '−'}${fmtMoney(Math.abs(v.value_lkr), 'LKR')}${v.margin_pct != null ? ` · margin ${v.margin_pct}%` : ''}${v.time_days ? ` · ${v.time_days} days time impact` : ''}`}
          />
        ) : null}
        {v.smp_at ? <KeyValue label="SM Projects" value={`${people[v.smp_by ?? '']?.full_name ?? ''} · ${fmtDateTime(v.smp_at)}${v.smp_note ? ` · ${v.smp_note}` : ''}`} /> : null}
        {v.gm_at ? <KeyValue label="DGM / GM" value={`${people[v.gm_by ?? '']?.full_name ?? ''} · ${fmtDateTime(v.gm_at)}${v.gm_note ? ` · ${v.gm_note}` : ''}`} /> : null}
        {v.vo_no ? <KeyValue label="Client" value={`VO ${v.vo_no} · ${fmtDate(v.client_at)}${v.client_note ? ` · ${v.client_note}` : ''}`} /> : null}
        {v.client_submitted_on ? (
          <KeyValue label="Submitted to the client" value={`${fmtDate(v.client_submitted_on)}${v.client_submit_ref ? ` · ${v.client_submit_ref}` : ''} · answer agreed by ${fmtDate(v.client_due)}`} />
        ) : null}
        {v.client_value_lkr != null ? <KeyValue label="Approved by the client" value={`${v.client_value_lkr > 0 ? '+' : '−'}${fmtMoney(Math.abs(v.client_value_lkr), 'LKR')} · in the BOQ as a separate variation`} /> : null}
        {pv && pv.stage !== 'closed' ? (
          <Notice tone={pv.days_late > 0 ? colors.red : colors.amber}>
            {`${pv.stage_label}${pv.due ? ` · agreed ${fmtDate(pv.due)}` : ''}${pv.days_late > 0 ? ` · ${pv.days_late} day(s) late – SM Projects and DGM / GM told` : ''}\nNext: ${VAR_NEXT[pv.stage]}`}
          </Notice>
        ) : null}
        {v.decision_note ? <Notice tone={colors.blue}>{v.decision_note}</Notice> : null}
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {see && v.status === 'raised' ? <Button title="Screen" onPress={screen} /> : null}
          {(v.status === 'pending_smp' && me.role === 'sm_projects') || (v.status === 'pending_gm' && me.role === 'gm') ? (
            <>
              <Button title="Approve" onPress={() => decide(true)} />
              <Button variant="danger" title="Reject" onPress={() => decide(false)} />
            </>
          ) : null}
          {(see || me.role === 'sm_projects') && v.status === 'approved' ? (
            <>
              {!v.client_submitted_on ? <Button variant="secondary" title="Submitted to client" onPress={submitClient} /> : null}
              <Button title="Client approved" onPress={() => router.push(`/execution/variation/accept?variation=${v.id}`)} />
              <Button variant="secondary" title="Client rejected" onPress={() => client(false)} />
            </>
          ) : null}
          {(see || me.role === 'sm_projects') && pv && !['closed', 'screening'].includes(pv.stage) ? <Button variant="ghost" title="Move agreed date" onPress={moveDue} /> : null}
          {(v.raised_by === me.id || see || me.role === 'sm_projects') && ['raised', 'pending_smp', 'pending_gm', 'approved'].includes(v.status) ? (
            <Button
              variant="ghost"
              title="Cancel"
              onPress={async () => {
                const r = await dialog.prompt({ title: 'Cancel the variation', fields: [{ key: 'r', label: 'Reason', type: 'multiline', required: true }], confirmLabel: 'Cancel it', danger: true });
                if (r) await dialog.run(async () => { await rpc('cancel_exec_variation', { p_id: v.id, p_reason: r.r }); await after(); }, 'Cancelled');
              }}
            />
          ) : null}
        </Row>
      </Card>
      <Attachments entityType="variation" entityId={v.id} kinds={['var_doc', 'var_photo']} title="Documents and photos (VO, drawings, client letters)" allowCamera canUpload={!['cancelled', 'rejected', 'client_rejected'].includes(v.status)} />
    </Screen>
  );
}
