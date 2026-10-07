import { router } from 'expo-router';
import { DataTable } from '@/components/DataTable';
import { colors, Grid, Muted, Section, Stat } from '@/components/ui';
import { type BillingRow } from '@/lib/billing';
import { fyEnd, fyOf, mn, monthOf } from '@/lib/finance';
import { todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Execution against the invoicing plan: what will miss its month (this month / quarter / year), by project and by SEE */
export function BillingRiskSection() {
  const people = usePeople();
  const { data } = useLoad(async () => ((await supabase.rpc('billing_risk')).data ?? []) as BillingRow[], []);
  if (!data) return null;
  const today = todayISO();
  const m = monthOf(today);
  const fy = fyOf(today);
  const q = Math.floor(((Number(m.slice(5, 7)) + 8) % 12) / 3);
  const qEnd = new Date(Date.UTC(fy, 3 + q * 3 + 3, 0)).toISOString().slice(0, 10);
  const inScope = (r: BillingRow, end: string) => r.forecast_month <= end;
  const sum = (rs: BillingRow[]) => rs.reduce((s, r) => s + Number(r.open_amount), 0);
  const bad = (r: BillingRow) => r.status === 'red' || r.status === 'no_trigger';
  const risk = (end: string) => sum(data.filter((r) => inScope(r, end) && (bad(r) || r.status === 'amber')));
  const projects = [...new Set(data.map((r) => r.exec_project_id))].map((id) => {
    const rs = data.filter((r) => r.exec_project_id === id && inScope(r, fyEnd(fy)));
    return {
      id,
      name: rs[0]?.project ?? data.find((r) => r.exec_project_id === id)?.project ?? '',
      see: data.find((r) => r.exec_project_id === id)?.see_id ?? null,
      total: sum(rs),
      red: sum(rs.filter(bad)),
      amber: sum(rs.filter((r) => r.status === 'amber')),
      cert: sum(rs.filter((r) => r.stage === 'certificate')),
      ready: sum(rs.filter((r) => r.status === 'ready')),
      noAction: rs.filter((r) => r.status === 'red' && !r.open_actions && !r.pending_move).length,
    };
  });
  const sees = [...new Set(projects.map((p) => p.see))].map((see) => {
    const ps = projects.filter((p) => p.see === see);
    const total = ps.reduce((s, p) => s + p.total, 0);
    const off = ps.reduce((s, p) => s + p.red + p.amber, 0);
    return { see, total, onPlan: total ? Math.round(((total - off) / total) * 100) : 100, red: ps.reduce((s, p) => s + p.red, 0) };
  });
  return (
    <Section title="Execution against the invoicing plan (LKR Mn)">
      <Grid min={180} max={4}>
        <Stat label="At risk / will miss – this month" value={mn(risk(m))} tone={risk(m) ? 'red' : undefined} />
        <Stat label="At risk / will miss – this quarter" value={mn(risk(qEnd))} tone={risk(qEnd) ? 'amber' : undefined} />
        <Stat label="At risk / will miss – this year" value={mn(risk(fyEnd(fy)))} tone={risk(fyEnd(fy)) ? 'amber' : undefined} />
        <Stat label="Certificate approved – to invoice" value={mn(sum(data.filter((r) => r.status === 'ready')))} tone="green" />
      </Grid>
      {projects.length ? (
        <DataTable
          rows={projects.filter((p) => p.total > 0).sort((a, b) => b.red - a.red || b.amber - a.amber)}
          keyOf={(p) => p.id}
          onPress={(p) => router.push(`/execution/${p.id}?tab=billing`)}
          columns={[
            { h: 'Project', w: 220, v: (p) => p.name, bold: true },
            { h: 'SEE', w: 140, v: (p) => people[p.see ?? '']?.full_name ?? '—' },
            { h: 'To invoice this FY', w: 110, right: true, v: (p) => mn(p.total) },
            { h: 'Will miss', w: 85, right: true, v: (p) => (p.red ? mn(p.red) : '—'), tone: (p) => (p.red ? colors.red : colors.muted) },
            { h: 'At risk', w: 80, right: true, v: (p) => (p.amber ? mn(p.amber) : '—'), tone: (p) => (p.amber ? colors.amber : colors.muted) },
            { h: 'Certificate with client', w: 110, right: true, v: (p) => (p.cert ? mn(p.cert) : '—') },
            { h: 'To invoice now', w: 95, right: true, v: (p) => (p.ready ? mn(p.ready) : '—') },
            { h: 'Red without action', w: 95, right: true, v: (p) => String(p.noAction || '—'), tone: (p) => (p.noAction ? colors.red : colors.muted) },
          ]}
        />
      ) : null}
      {sees.length ? (
        <Muted>
          {`On plan this year by Senior Electrical Engineer (share of the invoice value to raise this year that is on track): ${sees
            .map((x) => `${people[x.see ?? '']?.full_name ?? '—'} ${x.onPlan}%`)
            .join(' · ')}`}
        </Muted>
      ) : null}
      <Muted>
        An invoice is at risk when its work trigger has less than 15 working days of float to its deadline (10 working days before the end of its month), and will miss
        when the forecast is past the deadline. Tap a project to see its lines and recovery actions.
      </Muted>
    </Section>
  );
}
