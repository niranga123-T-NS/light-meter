import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Button, Card, colors, Muted, Pill, Row, Section } from '@/components/ui';
import { fmtMoney, fmtTime } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { rpc } from '@/lib/supabase';

type Summary = {
  id: string;
  code: string | null;
  name: string;
  client: string | null;
  company: string | null;
  activities: { n: number; done: number; behind: number; running: number; progress: number };
  week: { status: 'draft' | 'submitted' | 'approved' | 'returned'; items: number; done: number; partial: number; not_done: number; no_result: number; today: number } | null;
  today: {
    checked_in: string | null;
    tbt: { id: string; code: string; at: string; late: boolean } | null;
    permits_ok: number;
    permits_waiting: number;
    permits_tomorrow: number;
    report: 'submitted' | 'verified' | 'returned' | null;
  };
  certs: { open: number; paid: number; paid_value: number };
  workers: number;
};

const PLAN: Record<NonNullable<Summary['week']>['status'], { label: string; tone: string }> = {
  draft: { label: 'Draft – not submitted', tone: colors.grey },
  submitted: { label: 'With the AE', tone: colors.amber },
  approved: { label: 'Approved', tone: colors.green },
  returned: { label: 'Returned – correct it', tone: colors.red },
};

/** The subcontractor supervisor's projects at a glance: progress of their company's work, this week, today, payments. */
export function SubProgress() {
  const { data } = useLoad(() => rpc<Summary[]>('sub_home_summary'));
  if (!data) return null;
  if (!data.length) return <Muted>No project yet – your projects and their progress show here once you are appointed.</Muted>;
  return (
    <Section title={`My projects – progress (${data.length})`}>
      <View style={{ gap: 10 }}>
        {data.map((p) => {
          const a = p.activities;
          const w = p.week;
          const t = p.today;
          const pct = Math.max(0, Math.min(100, Number(a.progress)));
          return (
            <Card key={p.id} style={{ gap: 8 }}>
              <View>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{`${p.code ?? ''} ${p.name}`}</Text>
                <Muted>{[p.client, p.company].filter(Boolean).join(' · ')}</Muted>
              </View>

              <View style={{ gap: 4 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>Your company&apos;s activities</Text>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{a.n ? `${pct.toFixed(0)}%` : '—'}</Text>
                </Row>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden' }}>
                  <View style={{ width: `${pct}%`, height: 8, backgroundColor: a.behind ? colors.amber : colors.green }} />
                </View>
                <Muted>{a.n ? `${a.done} of ${a.n} done · ${a.running} running${a.behind ? ` · ${a.behind} behind programme` : ''}` : 'No programme activities given to your company yet'}</Muted>
              </View>

              <Row wrap gap={6} style={{ alignItems: 'center' }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>This week</Text>
                {w ? (
                  <>
                    <Pill label={PLAN[w.status].label} tone={PLAN[w.status].tone} />
                    <Muted>{`${w.items} work${w.items === 1 ? '' : 's'} · ${w.done} done${w.partial ? ` · ${w.partial} partly` : ''}${w.not_done ? ` · ${w.not_done} not done` : ''}`}</Muted>
                    {w.no_result ? <Pill label={`${w.no_result} without result`} tone={colors.red} /> : null}
                  </>
                ) : (
                  <Pill label="No plan yet" tone={colors.red} />
                )}
              </Row>

              <Row wrap gap={6} style={{ alignItems: 'center' }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>Today</Text>
                <Pill label={t.checked_in ? `Checked in ${fmtTime(t.checked_in)}` : 'Not checked in'} tone={t.checked_in ? colors.green : colors.grey} />
                <Pill label={t.tbt ? `Toolbox ${fmtTime(t.tbt.at)}${t.tbt.late ? ' · late' : ''}` : 'No toolbox meeting'} tone={t.tbt ? (t.tbt.late ? colors.red : colors.green) : colors.grey} />
                <Pill label={`${t.permits_ok} permit${t.permits_ok === 1 ? '' : 's'} approved${t.permits_waiting ? ` · ${t.permits_waiting} waiting` : ''}`} tone={t.permits_ok ? colors.green : colors.amber} />
                <Pill label={t.report ? `Daily report ${t.report}` : 'Daily report due 18:00'} tone={t.report ? colors.green : colors.amber} />
                <Pill label={`Tomorrow: ${t.permits_tomorrow} permit${t.permits_tomorrow === 1 ? '' : 's'} (by 20:00)`} tone={t.permits_tomorrow ? colors.green : colors.grey} />
              </Row>

              <Row wrap gap={6} style={{ alignItems: 'center' }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>Payments</Text>
                <Muted>{`${p.certs.open} certificate${p.certs.open === 1 ? '' : 's'} in progress · ${p.certs.paid} paid${p.certs.paid ? ` (${fmtMoney(p.certs.paid_value, 'LKR')})` : ''} · ${p.workers} worker${p.workers === 1 ? '' : 's'} registered`}</Muted>
              </Row>

              <Row wrap gap={6}>
                <Button small title="Planning" onPress={() => router.push(`/execution/${p.id}?tab=planning`)} />
                <Button small variant="secondary" title="Daily report" onPress={() => router.push({ pathname: '/execution/report/new', params: { project: p.id } })} />
                <Button small variant="secondary" title="IPC & invoices" onPress={() => router.push(`/execution/${p.id}?tab=subcerts`)} />
              </Row>
            </Card>
          );
        })}
      </View>
    </Section>
  );
}
