import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { PersonPicker } from '@/components/pickers';
import { Button, Card, colors, ErrorBanner, Grid, H1, Loading, Muted, Notice, Row, Screen, Section, Select, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { fmtMoney, human, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';

type Scorecard = {
  month: string;
  kpis: Record<string, number | null>;
  targets: Record<string, number>;
  weights: Record<string, number>;
  area_scores: Record<string, number>;
  score: number;
  review: { comment: string | null; agreed_actions: string | null; acknowledged_at: string | null; locked_at: string | null } | null;
};

const KPI_LABELS: [string, string, string?][] = [
  ['visits_per_week', 'Visits per week', '12–15'],
  ['plans_on_time_pct', 'Weekly plan on time %', '100%'],
  ['plan_completion_pct', 'Plan completion %', '≥ 80%'],
  ['unplanned_share_pct', 'Unplanned visit share %', '≤ 30%'],
  ['gps_verified_pct', 'GPS-verified check-ins %', '≥ 95%'],
  ['same_day_reports_pct', 'Same-day visit reports %', '≥ 95%'],
  ['next_actions_on_time_pct', 'Next actions closed on time %', '≥ 90%'],
  ['consultant_share_pct', 'Consultant and architect share %', '≥ 35%'],
  ['new_organizations', 'New organizations met'],
  ['new_projects', 'New projects identified'],
  ['inquiries_raised', 'Inquiries raised'],
  ['visit_to_inquiry_pct', 'Visit-to-inquiry conversion %'],
  ['pipeline_lkr', 'Pipeline value (LKR)'],
  ['weighted_pipeline_lkr', 'Weighted pipeline (LKR)'],
  ['specification_wins', 'Specification wins'],
  ['returned_inquiries_pct', 'Inquiries returned for missing info %', '≤ 10%'],
  ['quotations_submitted', 'Quotations submitted'],
  ['win_rate_count_pct', 'Win rate by count %'],
  ['win_rate_value_pct', 'Win rate by value %', '≥ 30%'],
  ['order_intake_lkr', 'Order intake (LKR)'],
  ['avg_margin_won_pct', 'Average margin on won orders %'],
  ['submission_speed_pct', 'Quotation sent within 1 working day %', '≥ 95%'],
];

const monthStart = (iso: string, back = 0) => {
  const d = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - back);
  return d.toISOString().slice(0, 10);
};

/** Salesperson KPI scorecard (Section 9.2). */
export default function ScorecardScreen() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const params = useLocalSearchParams<{ user?: string }>();
  const [user, setUser] = useState<string | null>(params.user ?? (isSales(me.role) ? me.id : null));
  const [month, setMonth] = useState(monthStart(todayISO()));
  const manager = me.role === 'sm_projects' || me.role === 'gm';

  const { data, error, loading, reload } = useLoad(async () => {
    if (!user) return null;
    const [cur, prev, prev2] = await Promise.all([0, 1, 2].map((b) => rpc<Scorecard>('salesperson_scorecard', { p_user: user, p_month: monthStart(month, b) })));
    return { cur, prev, avg3: Math.round(((cur.score + prev.score + prev2.score) / 3) * 10) / 10 };
  }, [user, month]);

  const months = Array.from({ length: 12 }, (_, i) => monthStart(todayISO(), i));
  const sc = data?.cur;

  const editTargets = async () => {
    if (!sc || !user) return;
    const r = await dialog.prompt({
      title: `Targets – ${month.slice(0, 7)}`,
      message: 'Set by SM Projects, approved by GM / DGM before the month starts.',
      fields: [
        { key: 'order_intake_lkr', label: 'Order intake target (LKR)', initial: String(sc.targets.order_intake_lkr ?? '') },
        { key: 'weighted_pipeline_lkr', label: 'Weighted pipeline target (LKR)', initial: String(sc.targets.weighted_pipeline_lkr ?? '') },
        { key: 'specification_wins', label: 'Specification wins target', initial: String(sc.targets.specification_wins ?? '') },
        { key: 'visits_per_week', label: 'Visits per week target', initial: String(sc.targets.visits_per_week ?? 13) },
        { key: 'margin_floor_pct', label: 'Margin floor %', initial: String(sc.targets.margin_floor_pct ?? '') },
      ],
    });
    if (!r) return;
    const targets = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
    await dialog.run(async () => {
      const { error: e } = await supabase.from('kpi_targets').upsert({ user_id: user, month, targets, status: me.role === 'gm' ? 'approved' : 'submitted', approved_by: me.role === 'gm' ? me.id : null });
      if (e) throw new Error(e.message);
      await reload();
    }, me.role === 'gm' ? 'Targets approved' : 'Targets submitted for GM / DGM approval');
  };

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: 'Scorecard' }} />
      <Row wrap gap={8}>
        {manager ? (
          <View style={{ minWidth: 260, flex: 1 }}>
            <PersonPicker label="Sales person" roles={['asm_building', 'asm_infra']} value={user} onChange={setUser} />
          </View>
        ) : null}
        <View style={{ minWidth: 200 }}>
          <Select label="Month" value={month} options={months.map((m) => ({ value: m, label: m.slice(0, 7) }))} onChange={setMonth} />
        </View>
      </Row>
      <ErrorBanner message={error} />
      {!user ? <Muted>Choose a sales person.</Muted> : null}
      {user && !sc ? <Loading /> : null}
      {sc && data ? (
        <>
          <H1>
            {people[user ?? '']?.full_name} – {sc.score} / 100
          </H1>
          <Muted>
            Previous month {data.prev.score} {sc.score >= data.prev.score ? '▲' : '▼'} · 3-month average {data.avg3}
          </Muted>
          {!Object.keys(sc.targets).length ? <Notice tone={colors.amber}>No approved targets for this month – area scores use default targets where available.</Notice> : null}
          <Section title="Weighted areas">
            <Grid min={170}>
              {Object.entries(sc.area_scores).map(([k, v]) => (
                <Stat key={k} label={`${human(k)} · weight ${sc.weights[k] ?? 0}%`} value={`${v}%`} tone={v >= 100 ? 'green' : v >= 75 ? 'amber' : 'red'} />
              ))}
            </Grid>
            <Muted>Each KPI score = actual ÷ target, capped at 120%.</Muted>
          </Section>
          <Section title="KPIs">
            <Card>
              {KPI_LABELS.map(([k, label, hint]) => {
                const v = sc.kpis[k];
                const prev = data.prev.kpis[k];
                const money = k.endsWith('_lkr');
                return (
                  <Row key={k} style={{ justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                    <View style={{ flex: 1 }}>
                      <Text>{label}</Text>
                      {hint ? <Muted>Suggested target {hint}</Muted> : null}
                    </View>
                    <Text style={{ fontWeight: '700' }}>
                      {v == null ? '—' : money ? fmtMoney(v, 'LKR') : v}{' '}
                      <Text style={{ color: colors.muted, fontWeight: '400' }}>
                        {prev != null && v != null && v !== prev ? (v > prev ? '▲' : '▼') : ''}
                      </Text>
                    </Text>
                  </Row>
                );
              })}
            </Card>
          </Section>
          <Section title="Monthly review">
            <Card>
              <Text>{sc.review?.comment ?? 'No review comment yet.'}</Text>
              {sc.review?.agreed_actions ? <Muted>Agreed actions: {sc.review.agreed_actions}</Muted> : null}
              {sc.review?.acknowledged_at ? <Muted>Acknowledged by the sales person</Muted> : null}
              <Row wrap gap={8} style={{ marginTop: 8 }}>
                {manager ? (
                  <Button
                    small
                    title="Add review comment"
                    onPress={async () => {
                      const r = await dialog.prompt({
                        title: 'Monthly review',
                        fields: [
                          { key: 'c', label: 'Comment', type: 'multiline', required: true, initial: sc.review?.comment ?? '' },
                          { key: 'a', label: 'Agreed actions', type: 'multiline', initial: sc.review?.agreed_actions ?? '' },
                        ],
                      });
                      if (r)
                        await dialog.run(async () => {
                          const { error: e } = await supabase.from('scorecard_reviews').upsert({ user_id: user, month, comment: r.c, agreed_actions: r.a || null, reviewed_by: me.id });
                          if (e) throw new Error(e.message);
                          await reload();
                        }, 'Saved');
                    }}
                  />
                ) : null}
                {user === me.id && sc.review && !sc.review.acknowledged_at ? (
                  <Button
                    small
                    title="Acknowledge"
                    onPress={() =>
                      dialog.run(async () => {
                        await supabase.from('scorecard_reviews').update({ acknowledged_at: new Date().toISOString() }).eq('user_id', me.id).eq('month', month);
                        await reload();
                      }, 'Acknowledged')
                    }
                  />
                ) : null}
                {manager ? <Button small variant="secondary" title="Targets" onPress={editTargets} /> : null}
              </Row>
            </Card>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
