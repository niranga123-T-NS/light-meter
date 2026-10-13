import { Stack } from 'expo-router';
import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { TestingBanner } from '@/components/Testing';
import { Button, colors, ErrorBanner, Grid, Loading, Muted, Pill, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { monthsAgo, workdays } from '@/lib/foreignOrders';
import { useLoad } from '@/lib/hooks';
import { LO_KEEPER, loRoute, type LoLine, type LoNote, type LoOrder, type LoRequest, type LoStep, type LoStepDef } from '@/lib/localOrders';
import { supabase } from '@/lib/supabase';

type Period = '3' | '6' | '12' | 'all';
type By = 'step' | 'node' | 'supplier';
type Agg = { key: string; label: string; who: string; days: number[]; sla: number | null; met: number; withSla: number };

/** Local orders performance: working days per step, per team and per supplier, SLAs met, and the issues recorded by team. */
export default function LocalPerformance() {
  const me = useMe();
  const dialog = useDialog();
  const keeper = LO_KEEPER.includes(me.role);
  const [period, setPeriod] = useState<Period>('12');
  const [by, setBy] = useState<By>('step');
  const { data, error, reload } = useLoad(async () => {
    const [r, o, s, d, rv, ov, hol, nt] = await Promise.all([
      supabase.from('lo_requests').select('*'),
      supabase.from('lo_orders').select('*'),
      supabase.from('lo_steps').select('*'),
      supabase.from('lo_step_defs').select('*').order('seq'),
      supabase.from('lo_request_values').select('request_id, pr_value'),
      supabase.from('lo_order_values').select('order_id, value'),
      supabase.from('holidays').select('day'),
      supabase.from('lo_notes').select('*'),
    ]);
    if (r.error) throw new Error(r.error.message);
    return {
      reqs: (r.data ?? []) as LoRequest[],
      orders: (o.data ?? []) as LoOrder[],
      steps: (s.data ?? []) as LoStep[],
      defs: (d.data ?? []) as LoStepDef[],
      prv: Object.fromEntries(((rv.data ?? []) as { request_id: string; pr_value: number | null }[]).map((x) => [x.request_id, x.pr_value])),
      ov: Object.fromEntries(((ov.data ?? []) as { order_id: string; value: number | null }[]).map((x) => [x.order_id, x.value])),
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
      notes: (nt.data ?? []) as LoNote[],
    };
  }, []);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { reqs, orders, steps, defs, prv, ov, holidays, notes } = data;
  const from = period === 'all' ? '0000' : monthsAgo(Number(period));

  const timed: { l: LoLine; supplier: string | null }[] = [];
  for (const r of reqs) {
    const rs = steps.filter((s) => s.request_id === r.id);
    for (const l of loRoute(defs, prv[r.id] ?? null, null, null, rs, holidays)) if (l.def.scope === 'r' && l.done && l.start) timed.push({ l, supplier: null });
    for (const o of orders.filter((x) => x.request_id === r.id && x.status !== 'cancelled'))
      for (const l of loRoute(defs, prv[r.id] ?? null, o, ov[o.id] ?? null, rs, holidays)) if (l.def.scope === 'o' && l.done && l.start) timed.push({ l, supplier: o.supplier });
  }
  const inPeriod = timed.filter((t) => t.l.done!.done_on >= from);
  const groups = new Map<string, Agg>();
  for (const t of inPeriod) {
    const d = t.l.def;
    if (by === 'supplier' && (!t.supplier || !['Supplier', 'Service provider', 'Supplier · site'].includes(d.node))) continue;
    const key = by === 'step' ? d.key : by === 'node' ? d.node : `${t.supplier}|${d.key}`;
    const g = groups.get(key) ?? { key, label: by === 'node' ? d.node : d.label, who: by === 'supplier' ? t.supplier! : d.node, days: [], sla: by === 'node' ? null : d.sla_days, met: 0, withSla: 0 };
    g.days.push(t.l.days ?? 0);
    if (d.sla_days != null) {
      g.withSla += 1;
      if ((t.l.days ?? 0) <= d.sla_days) g.met += 1;
    }
    groups.set(key, g);
  }
  const seq = (k: string) => defs.find((d) => d.key === k.split('|').at(-1))?.seq ?? 999;
  const rows = [...groups.values()].sort((a, b) => (by === 'supplier' ? a.who.localeCompare(b.who) || seq(a.key) - seq(b.key) : by === 'step' ? seq(a.key) - seq(b.key) : a.label.localeCompare(b.label)));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);
  const closed = orders.filter((o) => o.status === 'completed' && (steps.find((s) => s.order_id === o.id && s.step === 'closed')?.done_on ?? '') >= from);
  const leads = closed.map((o) => workdays(reqs.find((r) => r.id === o.request_id)?.received_on, steps.find((s) => s.order_id === o.id && s.step === 'closed')!.done_on, holidays) ?? 0);
  const withSla = rows.filter((r) => r.withSla);
  const worst = [...withSla].sort((a, b) => a.met / a.withSla - b.met / b.withSla)[0];

  const byParty = new Map<string, { party: string; mistake: number; delay: number; complaint: number; notice: number; days: number; open: number }>();
  for (const n of notes.filter((x) => x.occurred_on >= from)) {
    const key = n.party ?? 'Not stated';
    const g = byParty.get(key) ?? { party: key, mistake: 0, delay: 0, complaint: 0, notice: 0, days: 0, open: 0 };
    g[n.kind] += 1;
    g.days += n.delay_days ?? 0;
    if (n.status === 'open') g.open += 1;
    byParty.set(key, g);
  }
  const issueRows = [...byParty.values()].sort((a, b) => b.mistake + b.delay + b.complaint - (a.mistake + a.delay + a.complaint));

  const setSla = async (d: LoStepDef) => {
    const r = await dialog.prompt({
      title: `SLA – ${d.label}`,
      message: `${d.node}. Working days from the step it follows. Leave empty for no SLA; only steps with an SLA are flagged late.`,
      fields: [{ key: 'days', label: 'Working days', initial: d.sla_days != null ? String(d.sla_days) : '' }],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('lo_set_sla', { p_step: d.key, p_days: r.days.trim() ? Number(r.days) : null }); await reload(); }, 'Saved');
  };
  const setOptional = async (d: LoStepDef) => {
    if (!(await dialog.confirm(`${d.optional ? 'Make required' : 'Make optional'}: ${d.label}?`, d.optional ? 'The step will be needed again before the steps after it.' : 'Recorded when known; it never holds up the next step and is never flagged late.'))) return;
    await dialog.run(async () => { await rpc('lo_set_optional', { p_step: d.key, p_optional: !d.optional }); await reload(); }, 'Saved');
  };

  return (
    <Screen maxWidth={1200}>
      <Stack.Screen options={{ title: 'Local orders performance' }} />
      <TestingBanner what="Local orders" always />
      <Muted>Every step Ops records adds its working days (without weekends and public and mercantile holidays) to its process node, counted from the step it follows.</Muted>
      <Grid min={170} max={4}>
        <Stat label="Orders closed" value={String(closed.length)} />
        <Stat label="Request to close, average" value={closed.length ? `${Math.round(avg(leads))} working days` : '—'} />
        <Stat label="Steps measured" value={String(inPeriod.length)} />
        <Stat label="Lowest SLA met" value={worst ? `${Math.round((100 * worst.met) / worst.withSla)}%` : '—'} sub={worst ? worst.label : 'No SLAs set'} tone={worst && worst.met / worst.withSla < 0.65 ? 'red' : undefined} />
      </Grid>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Segmented value={period} onChange={setPeriod} options={[{ value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '12', label: '12 months' }, { value: 'all', label: 'All' }]} />
        <Segmented value={by} onChange={setBy} options={[{ value: 'step', label: 'By step' }, { value: 'node', label: 'By team' }, { value: 'supplier', label: 'By supplier' }]} />
      </Row>
      <DataTable
        rows={rows}
        keyOf={(r) => r.key}
        emptyTitle="No steps recorded in this period"
        columns={[
          ...(by === 'supplier' ? [{ h: 'Supplier', w: 180, v: (r: Agg) => r.who }] : []),
          { h: by === 'node' ? 'Team' : 'Step', w: 260, grow: true, v: (r: Agg) => r.label },
          ...(by === 'step' ? [{ h: 'Who', w: 150, v: (r: Agg) => r.who }] : []),
          { h: 'Steps', w: 70, right: true, v: (r: Agg) => String(r.days.length) },
          { h: 'Average', w: 80, right: true, bold: true, v: (r: Agg) => avg(r.days).toFixed(1) },
          { h: 'Fastest', w: 75, right: true, v: (r: Agg) => String(Math.min(...r.days)) },
          { h: 'Slowest', w: 75, right: true, v: (r: Agg) => String(Math.max(...r.days)) },
          ...(by === 'node' ? [] : [{ h: 'SLA', w: 60, right: true, v: (r: Agg) => (r.sla != null ? String(r.sla) : '—') }]),
          {
            h: 'Met',
            w: 90,
            v: (r: Agg) => {
              if (!r.withSla) return <Pill label="No SLA" tone={colors.grey} />;
              const p = Math.round((100 * r.met) / r.withSla);
              return <Pill label={`${p}%`} tone={p >= 80 ? colors.green : p >= 65 ? colors.amber : colors.red} />;
            },
          },
        ]}
      />
      <Section title="Mistakes, delays and complaints by team">
        <DataTable
          rows={issueRows}
          keyOf={(r) => r.party}
          emptyTitle="Nothing recorded in this period"
          columns={[
            { h: 'Team / party', w: 220, grow: true, v: (r) => r.party },
            { h: 'Mistakes', w: 90, right: true, v: (r) => String(r.mistake) },
            { h: 'Delays', w: 80, right: true, v: (r) => String(r.delay) },
            { h: 'Delay days', w: 100, right: true, v: (r) => String(r.days) },
            { h: 'Complaints', w: 100, right: true, v: (r) => String(r.complaint) },
            { h: 'Notices', w: 80, right: true, v: (r) => String(r.notice) },
            { h: 'Open', w: 70, right: true, v: (r) => String(r.open) },
          ]}
        />
      </Section>
      <Section title="SLA per step">
        <Muted>{keeper ? 'Set an SLA where one exists. Steps without one are timed but never flagged late.' : 'Set by the Operations Executive.'}</Muted>
        <DataTable
          rows={defs}
          keyOf={(d) => d.key}
          columns={[
            { h: 'Stage', w: 60, right: true, v: (d) => String(d.stage) },
            { h: 'Step', w: 300, grow: true, v: (d) => d.label },
            { h: 'Who', w: 160, v: (d) => d.node },
            { h: 'SLA (working days)', w: 140, right: true, v: (d) => (d.optional ? 'optional' : d.sla_days != null ? String(d.sla_days) : '—') },
            ...(keeper
              ? [
                  {
                    h: '',
                    w: 200,
                    v: (d: LoStepDef) => (
                      <Row gap={4}>
                        {d.optional ? null : <Button small variant="ghost" title="SLA" onPress={() => setSla(d)} />}
                        {['lr_received', 'lr_checked', 'closed'].includes(d.key) ? null : <Button small variant="ghost" title={d.optional ? 'Make required' : 'Make optional'} onPress={() => setOptional(d)} />}
                      </Row>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>
    </Screen>
  );
}
