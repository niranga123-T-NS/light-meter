import { router } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, Grid, ListRow, Muted, Notice, Pill, Row, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { BILLING_ROLES, billingStep, CERT_STATUS, CHECK_STATUS, IPC_STATUS, RISK, TRIGGER_KINDS, type BillingAction, type BillingRow, type InvoiceCheck, type InvoiceTrigger, type Ipc, type PaymentCert } from '@/lib/billing';
import { BOQ_STATUS, type Boq, type IpcValues } from '@/lib/boq';
import { MR_STATUS, type ExecProject, type MaterialRequest } from '@/lib/execution';
import { fmtMonth, kindLabel, monthOf, type InvoiceLine, type SecuredProject } from '@/lib/finance';
import { fmtDate, fmtMoney, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { actualPct, type Activity } from '@/lib/programme';
import { rpc, supabase } from '@/lib/supabase';

const GATE_EVENTS = ['Programme approved (work starts)', 'Handed over to the client', 'Project closed'];
const GATES = [1, 2, 3].map((g) => ({ value: String(g), label: GATE_EVENTS[g - 1] }));
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
    const [s, l, t, k, c, a, b, m, r, pc, ba] = await Promise.all([
      p.secured_id ? supabase.from('secured_projects').select('*').eq('id', p.secured_id).maybeSingle() : Promise.resolve({ data: null }),
      p.secured_id ? supabase.from('invoice_line_status').select('*').eq('secured_id', p.secured_id).order('seq') : Promise.resolve({ data: [] }),
      supabase.from('exec_invoice_triggers').select('*').eq('exec_project_id', p.id),
      supabase.from('exec_invoice_checks').select('*').eq('exec_project_id', p.id).eq('check_month', thisMonth).order('at', { ascending: false }),
      ipcQ,
      supabase.from('exec_activities').select('*').eq('exec_project_id', p.id).order('code'),
      supabase.from('exec_boqs').select('*').eq('exec_project_id', p.id).maybeSingle(),
      supabase.from('material_requests').select('*').eq('exec_project_id', p.id).order('requested_at', { ascending: false }),
      p.secured_id && p.status === 'active' ? supabase.rpc('billing_risk', { p_exec: p.id }) : Promise.resolve({ data: [] }),
      supabase.from('exec_payment_certs').select('*').eq('exec_project_id', p.id).order('created_at', { ascending: false }),
      supabase.from('exec_billing_actions').select('*').eq('exec_project_id', p.id).order('created_at', { ascending: false }),
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
      risk: (r.data ?? []) as BillingRow[],
      certs: (pc.data ?? []) as PaymentCert[],
      actions: (ba.data ?? []) as BillingAction[],
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
  const risk = Object.fromEntries((data?.risk ?? []).map((r) => [r.line_id, r]));
  const atRisk = (data?.risk ?? []).filter((r) => ['amber', 'red', 'no_trigger'].includes(r.status)).reduce((s, r) => s + Number(r.open_amount), 0);
  const certsOf = (id: string) => (data?.certs ?? []).filter((c) => c.line_id === id);
  const actionsOf = (id: string) => (data?.actions ?? []).filter((x) => x.line_id === id);
  const teamOpts = Object.values(people)
    .filter((x) => x.active && ['senior_elec_engineer', 'assistant_engineer', 'sm_projects', 'operations_exec'].includes(x.role))
    .map((x) => ({ value: x.id, label: x.full_name }));
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
        { key: 'gate', label: 'Event (if a project event)', type: 'select', options: GATES, initial: t?.gate ? String(t.gate) : undefined },
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
        res.st === 'ready' ? 'Work done – now submit the payment certificate' : res.st === 'slipping' ? 'New month proposed to SM Projects' : 'Saved',
      );
  };

  const submitCert = async (l: InvoiceLine) => {
    const res = await dialog.prompt({
      title: `Payment certificate – ${kindLabel(l.kind)}${l.description ? ` · ${l.description}` : ''}`,
      message: `Submitted to the client for ${fmtMonth(l.forecast_month)} · ${fmtMoney(l.remaining, 'LKR')} still to invoice on this line.`,
      fields: [
        { key: 'amount', label: 'Amount claimed (LKR)', required: true, initial: String(Number(l.remaining)) },
        { key: 'date', label: 'Submitted on', type: 'date', required: true, initial: todayISO() },
        { key: 'ref', label: 'Certificate / letter reference' },
        { key: 'note', label: 'Note', type: 'multiline' },
      ],
      confirmLabel: 'Submitted',
    });
    if (res) await dialog.run(async () => { await rpc('submit_payment_cert', { p_exec: p.id, p_line: l.id, p: res }); await reload(); }, 'Recorded – now with the client');
  };
  const decideCert = async (c: PaymentCert, ok: boolean) => {
    const res = await dialog.prompt({
      title: ok ? `Approved by the client – ${c.code ?? ''}` : `Returned by the client – ${c.code ?? ''}`,
      message: ok ? 'Operations is told to raise the invoice.' : 'Submit a corrected certificate afterwards.',
      fields: ok
        ? [
            { key: 'amount', label: 'Amount approved (LKR)', required: true, initial: String(Number(c.claimed_amount)) },
            { key: 'date', label: 'Approved on', type: 'date', required: true, initial: todayISO() },
            { key: 'client_ref', label: 'Client / consultant reference' },
            { key: 'note', label: 'Note', type: 'multiline' },
          ]
        : [{ key: 'note', label: 'What the client asked to change', type: 'multiline', required: true }],
      confirmLabel: ok ? 'Approved' : 'Returned',
      danger: !ok,
    });
    if (res) await dialog.run(async () => { await rpc('decide_payment_cert', { p_id: c.id, p_approved: ok, p: res }); await reload(); }, ok ? 'Operations told – raise the invoice' : 'Recorded');
  };
  const addAction = async (l: InvoiceLine) => {
    const res = await dialog.prompt({
      title: 'Recovery action',
      message: 'What will bring this invoice back into its month – extra crew, re-sequencing, part certificate …',
      fields: [
        { key: 'a', label: 'Action', type: 'multiline', required: true },
        { key: 'o', label: 'Owner', type: 'select', options: teamOpts, required: true, initial: me.id },
        { key: 'd', label: 'By', type: 'date', required: true },
      ],
      confirmLabel: 'Add',
    });
    if (res) await dialog.run(async () => { await rpc('save_billing_action', { p_exec: p.id, p_line: l.id, p_action: res.a, p_owner: res.o, p_due: res.d }); await reload(); }, 'Added');
  };
  const closeAction = async (x: BillingAction) => {
    const res = await dialog.prompt({ title: 'Close the action', message: x.action, fields: [{ key: 'r', label: 'What was done', type: 'multiline', required: true }], confirmLabel: 'Close' });
    if (res) await dialog.run(async () => { await rpc('close_billing_action', { p_id: x.id, p_result: res.r }); await reload(); }, 'Closed');
  };

  const triggerText = (t?: InvoiceTrigger) => {
    if (!t) return 'Trigger not set';
    if (t.kind === 'gate') return GATE_EVENTS[(t.gate ?? 1) - 1];
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
              <Stat label="Certificate approved – to invoice" value={fmtMoney(ready, 'LKR')} tone={ready > 0 ? 'green' : undefined} />
              <Stat label="At risk of missing its month" value={fmtMoney(atRisk, 'LKR')} tone={atRisk > 0 ? 'red' : undefined} />
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
                const r = risk[l.id];
                const done = Number(l.remaining) <= 0;
                const k = checks[l.id];
                const openCert = certsOf(l.id).find((c) => c.status === 'submitted');
                const lastCert = certsOf(l.id)[0];
                const acts2 = actionsOf(l.id);
                const rk = r ? RISK[r.status] : null;
                const tone = done ? colors.grey : rk ? colors[rk.tone] : undefined;
                return (
                  <ListRow
                    key={l.id}
                    wrapRight
                    highlight={tone}
                    title={`${l.seq}. ${kindLabel(l.kind)}${l.description ? ` · ${l.description}` : ''} · ${fmtMoney(l.amount, 'LKR')}`}
                    subtitle={[
                      `${fmtMonth(l.forecast_month)}${l.forecast_month !== l.original_month ? ` (planned ${fmtMonth(l.original_month)})` : ''}`,
                      Number(l.invoiced) > 0 ? `${fmtMoney(l.invoiced, 'LKR')} invoiced` : null,
                      done ? null : r ? billingStep(r, fmtDate) : triggerText(t),
                      lastCert && lastCert.status !== 'submitted' ? `${lastCert.code}: ${CERT_STATUS[lastCert.status]}${lastCert.approved_amount != null ? ` ${fmtMoney(lastCert.approved_amount, 'LKR')}` : ` ${fmtMoney(lastCert.claimed_amount, 'LKR')}`}${lastCert.status === 'returned' && lastCert.note ? ` – ${lastCert.note}` : ''}` : null,
                      ...acts2.map((x) => `${x.status === 'open' ? 'Action' : 'Done'}: ${x.action} – ${people[x.owner_id ?? '']?.full_name ?? ''}${x.due_date ? ` by ${fmtDate(x.due_date)}` : ''}${x.result ? ` → ${x.result}` : ''}`),
                      k ? `Checked ${fmtDate(k.at)}: ${CHECK_STATUS.find((x) => x.value === k.status)?.label}${k.note ? ` – ${k.note}` : ''}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={
                      <Row gap={6} wrap>
                        {done ? <Pill label="Invoiced" /> : rk ? <Pill label={rk.label} tone={tone} solid={r?.status === 'red' || r?.status === 'ready'} /> : null}
                        {t && !t.approved && !t.ready_at ? <Pill label="Trigger to approve" tone={colors.amber} /> : null}
                        {l.pending_month ? <Pill label={`Move to ${fmtMonth(l.pending_month)} – waiting for approval`} tone={colors.amber} /> : null}
                        {see && !done && !t?.claimable_at && !t?.ready_at ? <Button small variant="secondary" title="Trigger" onPress={() => setTrigger(l)} /> : null}
                        {see && !done && !t?.ready_at && !openCert && t?.claimable_at ? <Button small title="Submit certificate" onPress={() => submitCert(l)} /> : null}
                        {see && openCert ? <Button small title="Client approved" onPress={() => decideCert(openCert, true)} /> : null}
                        {see && openCert ? <Button small variant="secondary" title="Returned" onPress={() => decideCert(openCert, false)} /> : null}
                        {(see || me.role === 'sm_projects') && !done && r && ['amber', 'red'].includes(r.status) ? <Button small variant="secondary" title="+ Action" onPress={() => addAction(l)} /> : null}
                        {acts2.filter((x) => x.status === 'open' && (see || me.role === 'sm_projects' || x.owner_id === me.id)).map((x) => (
                          <Button key={x.id} small variant="ghost" title="Close action" onPress={() => closeAction(x)} />
                        ))}
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
            Each invoice: the work trigger must be met 10 working days before the end of its month (amber within 15 working days, red when it will miss). Then the SEE
            submits the payment certificate to the client and records the approval → Operations raises the invoice → the sales person is told. Red lines need a recovery
            action; a later month is asked with “Check” (another quarter or year: SM Projects, then DGM / GM).
          </Muted>
        </Section>
      ) : null}

      {ipcSection}
    </>
  );
}
