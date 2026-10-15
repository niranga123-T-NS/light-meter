import { Stack } from 'expo-router';
import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { DateSlips } from '@/components/DateSlips';
import { TestingBanner } from '@/components/Testing';
import { Button, colors, ErrorBanner, Grid, Loading, Muted, Pill, Row, Screen, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { FO_KEEPER, monthsAgo, route, workdays, type FoNote, type FoOrder, type Handover, type Line, type Step, type StepDef } from '@/lib/foreignOrders';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Period = '3' | '6' | '12' | 'all';
type By = 'step' | 'node' | 'vendor';

type Agg = { key: string; label: string; who: string; days: number[]; sla: number | null; met: number; withSla: number };

/** Process performance: how many working days each step (process node) takes across the orders, and how often its SLA was met. */
export default function ForeignPerformance() {
  const me = useMe();
  const dialog = useDialog();
  const keeper = FO_KEEPER.includes(me.role);
  const [period, setPeriod] = useState<Period>('12');
  const [by, setBy] = useState<By>('step');
  const { data, error, reload } = useLoad(async () => {
    const [h, o, s, d, hol, nt] = await Promise.all([
      supabase.from('fo_handovers').select('*'),
      supabase.from('fo_orders').select('*'),
      supabase.from('fo_steps').select('*'),
      supabase.from('fo_step_defs').select('*').order('seq'),
      supabase.from('holidays').select('day'),
      supabase.from('fo_notes').select('*'),
    ]);
    if (h.error) throw new Error(h.error.message);
    return {
      hos: (h.data ?? []) as Handover[],
      orders: (o.data ?? []) as FoOrder[],
      steps: (s.data ?? []) as Step[],
      defs: (d.data ?? []) as StepDef[],
      holidays: new Set(((hol.data ?? []) as { day: string }[]).map((x) => x.day)),
      notes: (nt.data ?? []) as FoNote[],
    };
  }, []);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { hos, orders, steps, defs, holidays, notes } = data;
  const from = period === 'all' ? '0000' : monthsAgo(Number(period));

  // every recorded step with the working days it took (import request steps once per import request)
  const timed: { l: Line; vendor: string | null }[] = [];
  for (const h of hos) {
    const os = orders.filter((o) => o.handover_id === h.id);
    const hs = steps.filter((s) => s.handover_id === h.id);
    for (const l of route(defs, h, null, hs, os, holidays)) if (l.def.scope === 'h' && l.done && l.start) timed.push({ l, vendor: null });
    for (const o of os.filter((x) => x.status !== 'cancelled'))
      for (const l of route(defs, h, o, hs, os, holidays)) if (l.def.scope === 'o' && l.done && l.start) timed.push({ l, vendor: o.vendor });
  }
  const inPeriod = timed.filter((t) => t.l.done!.done_on >= from);
  const groups = new Map<string, Agg>();
  for (const t of inPeriod) {
    const d = t.l.def;
    const key = by === 'step' ? d.key : by === 'node' ? d.node : `${t.vendor ?? '—'}|${d.key}`;
    if (by === 'vendor' && (!t.vendor || !['Manufacturer', 'Service provider', 'Vendor registration'].includes(d.node))) continue;
    const g = groups.get(key) ?? { key, label: by === 'node' ? d.node : d.label, who: by === 'vendor' ? t.vendor! : d.node, days: [], sla: by === 'node' ? null : d.sla_days, met: 0, withSla: 0 };
    g.days.push(t.l.days ?? 0);
    if (d.sla_days != null) {
      g.withSla += 1;
      if ((t.l.days ?? 0) <= d.sla_days) g.met += 1;
    }
    groups.set(key, g);
  }
  const order = (k: string) => defs.find((d) => d.key === k.split('|').at(-1))?.seq ?? 999;
  const rows = [...groups.values()].sort((a, b) => (by === 'vendor' ? a.who.localeCompare(b.who) || order(a.key) - order(b.key) : by === 'step' ? order(a.key) - order(b.key) : a.label.localeCompare(b.label)));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0);
  const delivered = orders.filter((o) => o.status === 'delivered' && (steps.find((s) => s.order_id === o.id && s.step === 'delivered')?.done_on ?? '') >= from);
  const leads = delivered.map((o) => workdays(hos.find((h) => h.id === o.handover_id)?.received_on, steps.find((s) => s.order_id === o.id && s.step === 'delivered')!.done_on, holidays) ?? 0);
  const withSla = rows.filter((r) => r.withSla);
  const worst = [...withSla].sort((a, b) => a.met / a.withSla - b.met / b.withSla)[0];

  // issue records in the period, by the team or party they concern
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

  const setOptional = async (d: StepDef) => {
    const msg = d.optional
      ? 'The step will be needed again before the steps after it can be recorded.'
      : 'For an internal step of another team that Ops sees only sometimes: it can be recorded when known, never holds up the next step, and is never flagged late.';
    if (!(await dialog.confirm(`${d.optional ? 'Make required' : 'Make optional'}: ${d.label}?`, msg))) return;
    await dialog.run(async () => { await rpc('fo_set_optional', { p_step: d.key, p_optional: !d.optional }); await reload(); }, 'Saved');
  };
  const setSla = async (d: StepDef) => {
    const r = await dialog.prompt({
      title: `SLA – ${d.label}`,
      message: `${d.node}. Working days from the step it follows. Leave empty for no SLA; only steps with an SLA are flagged late.`,
      fields: [{ key: 'days', label: 'Working days', initial: d.sla_days != null ? String(d.sla_days) : '' }],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('fo_set_sla', { p_step: d.key, p_days: r.days.trim() ? Number(r.days) : null }); await reload(); }, 'Saved');
  };

  return (
    <Screen maxWidth={1200}>
      <Stack.Screen options={{ title: 'Process performance' }} />
      <TestingBanner what="Foreign orders" always />
      <Muted>
        Every step Ops records adds its working days (Monday to Friday, without public and mercantile holidays) to its process node, counted from the step it follows. Where Ops has set
        an SLA, the report shows how often it was met.
      </Muted>
      <Grid min={170} max={4}>
        <Stat label="Orders delivered" value={String(delivered.length)} />
        <Stat label="Import request to delivery, average" value={delivered.length ? `${Math.round(avg(leads))} working days` : '—'} />
        <Stat label="Steps measured" value={String(inPeriod.length)} />
        <Stat label="Lowest SLA met" value={worst ? `${Math.round((100 * worst.met) / worst.withSla)}%` : '—'} sub={worst ? worst.label : 'No SLAs set'} tone={worst && worst.met / worst.withSla < 0.65 ? 'red' : undefined} />
      </Grid>
      <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Segmented value={period} onChange={setPeriod} options={[{ value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '12', label: '12 months' }, { value: 'all', label: 'All' }]} />
        <Segmented value={by} onChange={setBy} options={[{ value: 'step', label: 'By step' }, { value: 'node', label: 'By team' }, { value: 'vendor', label: 'By manufacturer' }]} />
      </Row>
      <DataTable
        rows={rows}
        keyOf={(r) => r.key}
        emptyTitle="No steps recorded in this period"
        columns={[
          ...(by === 'vendor' ? [{ h: 'Manufacturer', w: 180, v: (r: Agg) => r.who }] : []),
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
      <DateSlips module="fo" from={from} holidays={holidays} />
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
        <Muted>{keeper ? 'Set an SLA where one exists. Steps without one are timed but never flagged late. Optional steps (internal steps of other teams Ops sees only sometimes) never hold up the next step.' : 'Set by the Operations Executive.'}</Muted>
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
                    v: (d: StepDef) => (
                      <Row gap={4}>
                        {d.optional ? null : <Button small variant="ghost" title="SLA" onPress={() => setSla(d)} />}
                        {d.key === 'ho_received' || d.key === 'delivered' ? null : (
                          <Button small variant="ghost" title={d.optional ? 'Make required' : 'Make optional'} onPress={() => setOptional(d)} />
                        )}
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
