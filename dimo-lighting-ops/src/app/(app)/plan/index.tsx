import { router, Stack } from 'expo-router';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ErrorBanner, H2, ListRow, Muted, Pill, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { addDaysISO, fmtDate, fmtDateTime, mondayOf, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import type { VisitPlan } from '@/lib/types';

const STATUS_TONE: Record<string, string> = { draft: colors.grey, submitted: colors.blue, approved: colors.green, returned: colors.amber };

/** Weekly visit plans (Section 4.4). */
export default function Plans() {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const thisWeek = mondayOf(todayISO());
  const nextWeek = addDaysISO(thisWeek, 7);
  const sales = isSales(me.role);

  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase.from('visit_plans').select('*').order('week_start', { ascending: false }).limit(60);
    if (sales) q = q.eq('sales_person_id', me.id);
    const { data: rows, error: e } = await q;
    if (e) throw new Error(e.message);
    return rows as VisitPlan[];
  });

  const openWeek = async (week: string) => {
    const existing = data?.find((p) => p.week_start === week && p.sales_person_id === me.id);
    if (existing) return router.push(`/plan/${existing.id}`);
    await dialog.run(async () => {
      const { data: p, error: e } = await supabase.from('visit_plans').insert({ sales_person_id: me.id, week_start: week }).select('id').single();
      if (e) throw new Error(e.message);
      router.push(`/plan/${p.id}`);
    });
  };

  const submitted = (data ?? []).filter((p) => p.status === 'submitted');

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Stack.Screen options={{ title: sales ? 'Weekly plan' : 'Weekly plans' }} />
      <ErrorBanner message={error} />
      {sales ? (
        <Section title="Plan">
          <Card>
            <H2>Next week – {fmtDate(nextWeek)}</H2>
            <Muted>Submit by Saturday 13:00. SM Projects approves by Monday 09:00.</Muted>
            <Button title="Open next week's plan" onPress={() => openWeek(nextWeek)} />
            <Muted style={{ marginTop: 12 }}>This week – {fmtDate(thisWeek)}</Muted>
            <Button title="Open this week's plan" variant="secondary" onPress={() => openWeek(thisWeek)} />
          </Card>
        </Section>
      ) : (
        <Section title="Waiting for approval">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {submitted.map((p) => (
              <ListRow
                key={p.id}
                title={`${people[p.sales_person_id]?.full_name ?? ''} – week of ${fmtDate(p.week_start)}`}
                subtitle={`Submitted ${fmtDateTime(p.submitted_at)} · v${p.version}`}
                highlight={p.is_late ? colors.red : colors.blue}
                right={p.is_late ? <Pill label="Late" tone={colors.red} /> : undefined}
                onPress={() => router.push(`/plan/${p.id}`)}
              />
            ))}
            {!submitted.length ? <Empty title="No plans waiting" /> : null}
          </Card>
        </Section>
      )}
      <Section title="History">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {(data ?? []).map((p) => (
            <ListRow
              key={p.id}
              title={`${sales ? '' : `${people[p.sales_person_id]?.full_name ?? ''} – `}Week of ${fmtDate(p.week_start)}`}
              subtitle={p.rating ? `Rated ${p.rating}/5 · ${p.evaluation_comment ?? ''}` : p.manager_comment ?? undefined}
              right={
                <>
                  {p.is_late ? <Pill label="Late" tone={colors.red} /> : null}
                  <Pill label={p.status} tone={STATUS_TONE[p.status]} />
                </>
              }
              onPress={() => router.push(`/plan/${p.id}`)}
            />
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
