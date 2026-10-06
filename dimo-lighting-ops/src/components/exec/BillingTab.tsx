import { router } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, Grid, ListRow, Muted, Notice, Pill, Row, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { BILLING_ROLES, CHECK_STATUS, IPC_STATUS, TRIGGER_KINDS, type InvoiceCheck, type InvoiceTrigger, type Ipc } from '@/lib/billing';
import { BOQ_STATUS, type Boq, type IpcValues } from '@/lib/boq';
import { EXEC_STAGES, MR_STATUS, type ExecProject, type MaterialRequest } from '@/lib/execution';
import { fmtMonth, kindLabel, monthOf, type InvoiceLine, type SecuredProject } from '@/lib/finance';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { actualPct, type Activity } from '@/lib/programme';
import { rpc, supabase } from '@/lib/supabase';

const GATES = [1, 2, 3, 4, 5, 6].map((g) => ({ value: String(g), label: `Gate ${g} – end of “${EXEC_STAGES[g - 1]}”` }));
const ipcTone = (c: Ipc) => (c.status === 'certified' ? colors.green : c.status === 'returned' ? colors.red : colors.amber);

/**
 * The invoicing plan of the secured project, linked to the execution: what triggers each invoice, what is ready,
 * earned vs billed, the SEE's monthly check, and monthly progress claims (the AE measures, the SEE records the certified amount).
 * Money is shown only to the SEE, SM Projects, GM and Operations; an AE sees the progress-claim measurements alone.
 */
export function BillingTab({ p, onChange }: { p: ExecProject; onChange: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const full = BILLING_ROLES.includes(me.role);
  const see = me.role === 'senior_elec_engineer';
  const canLink = me.role === 'sm_projects' || me.role === 'operations_exec';
  const thisMonth = monthOf(todayISO());

  const { data, reload } = useLoad(async () => {
    const ipcQ = supabase.from('exec_ipcs').select('*').eq('exec_project_id', p.id).order('prepared_at', { ascending: false });
    if (!full) return { ipcs: ((await ipcQ).data ?? []) as Ipc[] };
    const [s, l, t, k, c, a, b, m] = await Promise.all([
      p.secured_id ? supabase.from('secured_projects').select('*').eq('id', p.secured_id).maybeSingle() : Promise.resolve({ data: null }),
      p.secured_id ? supabase.from('invoice_line_status').select('*').eq('secured_id', p.secured_id).order('seq') : Promise.resolve({ data: [] }),
      supabase.from('exec_invoice_triggers').select('*').eq('exec_project_id', p.id),
      supabase.from('exec_invoice_checks').select('*').eq('exec_project_id', p.id).eq('check_month', thisMonth).order('at', { ascending: false }),
      ipcQ,
      supabase.from('exec_activities').select('*').eq('exec_project_id', p.id).order('code'),
      supabase.from('exec_boqs').select('*').eq('exec_project_id', p.id).maybeSingle(),
      supabase.from('material_requests').select('*').eq('exec_project_id', p.id).order('requested_at', { ascending: false }),
    ]);
    const ipcs = (c.data ?? []) as Ipc[];
    const v = ipcs.length ? await supabase.from('exec_ipc_values').select('*').in('ipc_id', ipcs.map((x) => x.id)) : { data: [] };
    return {
      boq: b.data as Boq | null,
      mrs: (m.data ?? []) as MaterialRequest[],
      values: (v.data ?? []) as IpcValues[],
      secured: s.data as SecuredProject | null,
      lines: (l.data ?? []) as InvoiceLine[],
      triggers: (t.data ?? []) as InvoiceTrigger[],
      checks: (k.data ?? []) as InvoiceCheck[],
      ipcs,
      acts: (a.data ?? []) as Activity[],
    };
  }, [p.id, p.secured_id, full]);

  const ipcs = data?.ipcs ?? [];
  const canMeasure = (me.role === 'assistant_engineer' || see) && p.status === 'active';

  const measure = () => router.push(`/execution/claim/new?project=${p.id}`);

  const ipcSection = (
    <Section title="Progress claims (IPC)" right={canMeasure ? <Button small variant="secondary" title="+ Measurement" onPress={measure} /> : null}>
      {ipcs.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {ipcs.map((c) => (
            <ListRow
              key={c.id}
              wrapRight
              highlight={ipcTone(c)}
              onPress={() => router.push(`/execution/claim/${c.id}`)}
              title={`${c.code ?? 'IPC'} · ${fmtMonth(c.period)} · ${Number(c.measured_pct)}% measured`}
              subtitle={[c.measurement, `by ${people[c.prepared_by]?.full_name ?? ''} · ${fmtDate(c.prepared_at)}`, c.note].filter(Boolean).join(' · ')}
              right={
                <Row gap={6} wrap>
                  <Pill label={IPC_STATUS[c.status]} tone={ipcTone(c)} />
                  {full && c.certified_value != null ? <Pill label={fmtMoney(c.certified_value, 'LKR')} tone={colors.green} /> : null}
                </Row>
              }
            />
          ))}
        </Card>
      ) : (
        <Empty title="No progress claims" hint={canMeasure ? 'Monthly measurement of the work done, for progress-claim invoices' : undefined} />
      )}
    </Section>
  );

  if (!full)
    return (
      <>
        <Notice>Measure the work done each month for the progress claim. The amounts stay with the Senior Electrical Engineer.</Notice>
        {ipcSection}
      </>
    );

  const secured = data?.secured ?? null;
  const lines = data?.lines ?? [];
  const triggers = Object.fromEntries((data?.triggers ?? []).map((t) => [t.line_id, t]));
  const checks = Object.fromEntries([...(data?.checks ?? [])].reverse().map((c) => [c.line_id, c]));
  const acts = data?.acts ?? [];
  const actById = Object.fromEntries(acts.map((a) => [a.id, a]));
  const unapproved = (data?.triggers ?? []).filter((t) => !t.approved).length;

  const order = Number(secured?.order_value ?? p.contract_value_lkr ?? 0);
  const invoiced = lines.reduce((s, l) => s + Number(l.invoiced), 0) + Number(secured?.billed_before ?? 0);
  const boq = data?.boq ?? null;
  const valueOf = Object.fromEntries((data?.values ?? []).map((v) => [v.ipc_id, v]));
  const measured = ipcs.find((c) => c.status !== 'returned' && valueOf[c.id] && (boq?.version ?? 0) > 0);
  const pct = measured ? Number(measured.measured_pct) : actualPct(acts);
  const earned = measured ? Number(valueOf[measured.id].work_value) : (order * pct) / 100;
  const hasEarned = !!measured || acts.length > 0;
  const ready = lines.filter((l) => triggers[l.id]?.ready_at && Number(l.remaining) > 0).reduce((s, l) => s + Number(l.remaining), 0);
  const gap = invoiced - earned;

  const link = async () => {
    const [s, e] = await Promise.all([
      supabase.from('secured_projects').select('id, code, project_name, customer, order_value').eq('status', 'open').order('project_name'),
      supabase.from('exec_projects').select('secured_id').not('secured_id', 'is', null),
    ]);
    const taken = new Set((e.data ?? []).map((x) => x.secured_id as string));
    const opts = ((s.data ?? []) as SecuredProject[])
      .filter((x) => !taken.has(x.id) || x.id === p.secured_id)
      .map((x) => ({ value: x.id, label: `${x.code ? `${x.code} · ` : ''}${x.project_name}`, hint: [x.customer, x.order_value ? fmtMoney(x.order_value, 'LKR') : null].filter(Boolean).join(' · ') }));
    if (!opts.length) return dialog.toast('No secured projects left to link', 'error');
    const res = await dialog.prompt({
      title: 'Link the secured project',
      message: 'The project in the order book (Finance → Secured) whose invoicing plan this execution delivers.',
      fields: [{ key: 's', label: 'Secured project', type: 'select', options: opts, required: true, initial: p.secured_id ?? undefined }],
      confirmLabel: 'Link',
    });
    if (res) await dialog.run(async () => { await rpc('link_secured_project', { p_exec: p.id, p_secured: res.s }); onChange(); }, 'Linked');
  };

  const actOpts = acts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}`, hint: a.ef ? `forecast finish ${fmtDate(a.ef)}` : undefined }));
  const mrById = Object.fromEntries((data?.mrs ?? []).map((m) => [m.id, m]));
  const mrOpts = (data?.mrs ?? [])
    .filter((m) => !['rejected', 'cancelled'].includes(m.status))
    .map((m) => ({ value: m.id, label: `${m.code ?? 'MR'}${m.purpose ? ` · ${m.purpose}` : ''}`, hint: MR_STATUS[m.status] ?? m.status }));
  const setTrigger = async (l: InvoiceLine) => {
    const t = triggers[l.id];
    const res = await dialog.prompt({
      title: `Trigger – ${kindLabel(l.kind)}${l.description ? ` · ${l.description}` : ''}`,
      message: `${fmtMoney(l.amount, 'LKR')} planned for ${fmtMonth(l.forecast_month)}${l.trigger_note ? ` · sales note: ${l.trigger_note}` : ''}. SM Projects approves the triggers.`,
      fields: [
        { key: 'kind', label: 'Invoice when', type: 'select', options: TRIGGER_KINDS, required: true, initial: t?.kind ?? 'activity' },
        { key: 'gate', label: 'Stage gate (if a gate)', type: 'select', options: GATES, initial: t?.gate ? String(t.gate) : undefined },
        { key: 'act', label: 'Activity / milestone (if an activity)', type: 'select', options: actOpts, initial: t?.activity_id ?? undefined },
        { key: 'mrs', label: 'Material requests (if materials delivered)', type: 'multiselect', options: mrOpts, initial: t?.mr_ids?.join(',') },
      ],
      confirmLabel: 'Save',
    });
    if (res)
      await dialog.run(async () => {
        await rpc('set_invoice_trigger', {
          p_exec: p.id,
          p_line: l.id,
          p_kind: res.kind,
          p_gate: res.gate ? Number(res.gate) : null,
          p_activity: res.act || null,
          p_mrs: res.mrs ? res.mrs.split(',').filter(Boolean) : null,
        });
        await reload();
      }, 'Saved – waiting for SM Projects');
  };

  const check = async (l: InvoiceLine) => {
    const res = await dialog.prompt({
      title: `Monthly check – ${kindLabel(l.kind)}${l.description ? ` · ${l.description}` : ''}`,
      message: `${fmtMoney(l.remaining, 'LKR')} planned for ${fmtMonth(l.forecast_month)}.`,
      fields: [
        { key: 'st', label: 'Status', type: 'select', options: CHECK_STATUS, required: true, initial: 'on_track' },
        { key: 'm', label: 'Expected month (if slipping)', type: 'date' },
        { key: 'n', label: 'Evidence (if ready) / reason (if slipping)', type: 'multiline' },
      ],
      confirmLabel: 'Save',
    });
    if (res)
      await dialog.run(
        async () => {
          await rpc('check_invoice_line', { p_exec: p.id, p_line: l.id, p_status: res.st, p_month: res.m || null, p_note: res.n || null });
          await reload();
        },
        res.st === 'ready' ? 'Operations told – ready to invoice' : res.st === 'slipping' ? 'New month proposed to SM Projects' : 'Saved',
      );
  };

  const triggerText = (t?: InvoiceTrigger) => {
    if (!t) return 'Trigger not set';
    if (t.kind === 'gate') return `Gate ${t.gate} – end of “${EXEC_STAGES[(t.gate ?? 1) - 1]}”`;
    if (t.kind === 'activity') {
      const a = t.activity_id ? actById[t.activity_id] : undefined;
      if (!a) return 'Activity removed – set again';
      return `${a.code} ${a.name} · ${a.actual_finish ? `finished ${fmtDate(a.actual_finish)}` : `forecast ${fmtDate(a.ef)}`}`;
    }
    if (t.kind === 'delivery') {
      const ms = (t.mr_ids ?? []).map((x) => mrById[x]).filter(Boolean);
      return `Delivered: ${ms.map((m) => `${m.code} (${MR_STATUS[m.status] ?? m.status})`).join(', ') || 'material requests'}`;
    }
    return t.kind === 'ipc' ? 'Monthly progress claim' : 'Confirmed by the SEE';
  };

  return (
    <>
      <Section
        title="Invoicing plan"
        right={
          <Row gap={6} wrap>
            {secured && me.role !== 'senior_elec_engineer' ? <Button small variant="secondary" title="Open in Finance" onPress={() => router.push(`/finance/secured/${secured.id}`)} /> : null}
            {canLink ? <Button small variant="secondary" title={secured ? 'Change link' : 'Link secured project'} onPress={link} /> : null}
          </Row>
        }
      >
        {!p.secured_id ? (
          <Notice tone={colors.amber}>
            {canLink
              ? 'Not linked to a secured project yet – link the project in the order book whose invoicing plan this execution delivers.'
              : 'Not linked to a secured project yet – SM Projects or Operations link it.'}
          </Notice>
        ) : secured ? (
          <>
            <Muted>{[secured.code, secured.project_name, secured.customer, secured.po_no ? `PO ${secured.po_no}` : null].filter(Boolean).join(' · ')}</Muted>
            <Grid min={150}>
              <Stat label="Order value" value={fmtMoney(order, 'LKR')} />
              <Stat label="Invoiced" value={fmtMoney(invoiced, 'LKR')} />
              <Stat label={`Earned (${Math.round(pct)}% ${measured ? `measured, ${measured.code}` : 'done – programme'})`} value={hasEarned ? fmtMoney(earned, 'LKR') : '—'} />
              <Stat
                label={gap >= 0 ? 'Billed ahead of work' : 'Work not yet billed'}
                value={hasEarned ? fmtMoney(Math.abs(gap), 'LKR') : '—'}
                tone={hasEarned && gap < -order * 0.05 ? 'amber' : undefined}
              />
              <Stat label="Ready to invoice" value={fmtMoney(ready, 'LKR')} tone={ready > 0 ? 'green' : undefined} />
            </Grid>
            {secured.schedule_status !== 'approved' ? <Notice tone={colors.amber}>The invoicing plan is not approved yet in Finance – lines may still change.</Notice> : null}
          </>
        ) : (
          <Muted>Loading…</Muted>
        )}
        {unapproved ? (
          <Notice tone={colors.amber}>
            {`${unapproved} invoice trigger(s) waiting for SM Projects – approved with the programme baseline, or here.`}
          </Notice>
        ) : null}
        {unapproved && me.role === 'sm_projects' ? (
          <Button
            small
            title="Approve the triggers"
            onPress={() => dialog.run(async () => { await rpc('approve_invoice_triggers', { p_exec: p.id }); await reload(); }, 'Approved')}
          />
        ) : null}
      </Section>

      <Section
        title="Contract BOQ"
        right={<Button small variant="secondary" title={boq ? 'Open BOQ' : see || me.role === 'operations_exec' ? 'Upload BOQ' : 'Open'} onPress={() => router.push(`/execution/boq/${p.id}`)} />}
      >
        {boq ? (
          <Row gap={6} wrap style={{ alignItems: 'center' }}>
            <Pill label={BOQ_STATUS[boq.status].label} tone={{ amber: colors.amber, green: colors.green, red: colors.red }[BOQ_STATUS[boq.status].tone]} solid={boq.status === 'approved'} />
            <Muted>{`${fmtMoney(boq.total, 'LKR')}${order ? ` · order value ${fmtMoney(order, 'LKR')}` : ''} · ${boq.mos_pct > 0 ? `Material on Site ${Number(boq.mos_pct)}%` : 'Material on Site not paid'}`}</Muted>
          </Row>
        ) : (
          <Muted>No BOQ yet – upload the priced BOQ (Excel, one sheet or one per bill). Claims are then measured by quantity and priced at the BOQ rates.</Muted>
        )}
      </Section>

      {p.secured_id ? (
        <Section title="Invoice lines">
          {lines.length ? (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {lines.map((l) => {
                const t = triggers[l.id];
                const done = Number(l.remaining) <= 0;
                const a = t?.kind === 'activity' && t.activity_id ? actById[t.activity_id] : undefined;
                const late = !!a && !a.actual_finish && !!a.ef && monthOf(a.ef) > l.forecast_month;
                const k = checks[l.id];
                const tone = done ? colors.grey : t?.ready_at ? colors.green : late || l.pending_month ? colors.amber : l.forecast_month < thisMonth ? colors.red : undefined;
                return (
                  <ListRow
                    key={l.id}
                    wrapRight
                    highlight={tone}
                    title={`${l.seq}. ${kindLabel(l.kind)}${l.description ? ` · ${l.description}` : ''} · ${fmtMoney(l.amount, 'LKR')}`}
                    subtitle={[
                      `${fmtMonth(l.forecast_month)}${l.forecast_month !== l.original_month ? ` (was ${fmtMonth(l.original_month)})` : ''}`,
                      Number(l.invoiced) > 0 ? `${fmtMoney(l.invoiced, 'LKR')} invoiced` : null,
                      triggerText(t),
                      t?.ready_note && t.ready_at ? `Ready ${fmtDate(t.ready_at)} – ${t.ready_note}` : null,
                      k ? `Checked ${fmtDate(k.at)}: ${CHECK_STATUS.find((x) => x.value === k.status)?.label}${k.note ? ` – ${k.note}` : ''}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={
                      <Row gap={6} wrap>
                        {done ? <Pill label="Invoiced" /> : t?.ready_at ? <Pill label="Ready to invoice" tone={colors.green} solid /> : null}
                        {t && !t.approved && !t.ready_at ? <Pill label="Trigger to approve" tone={colors.amber} /> : null}
                        {l.pending_month ? <Pill label={`Move to ${fmtMonth(l.pending_month)} – with SM Projects`} tone={colors.amber} /> : null}
                        {late && !l.pending_month ? <Pill label={`Forecast ${fmtMonth(monthOf(a!.ef!))}`} tone={colors.amber} /> : null}
                        {see && !done && !t?.ready_at ? <Button small variant="secondary" title="Trigger" onPress={() => setTrigger(l)} /> : null}
                        {see && !done && !t?.ready_at ? <Button small variant="secondary" title="Check" onPress={() => check(l)} /> : null}
                      </Row>
                    }
                  />
                );
              })}
            </Card>
          ) : (
            <Empty title="No invoice lines" hint="The sales person enters the invoicing plan on the secured project (Finance)" />
          )}
          <Muted>
            Trigger met → Operations, SM Projects and the sales person are told “Ready to invoice”. If the programme forecast passes the invoice month, a later month is
            proposed to SM Projects. In the last week of each month, check next month’s lines.
          </Muted>
        </Section>
      ) : null}

      {ipcSection}
    </>
  );
}
