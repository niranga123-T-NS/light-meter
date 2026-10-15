import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { Button, Card, ErrorBanner, KeyValue, Loading, Muted, Row, Screen, Section } from '@/components/ui';
import { EMPTY_BRIEF, VisitBrief, type Brief } from '@/components/VisitBrief';
import { useMe } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Line = { id: string; planned_date: string; time_slot: string | null; organization_id: string; project_id: string | null; planned_objective: string; status: string; organizations: { name: string } | null; projects: { name: string } | null; visit_plans: { sales_person_id: string; status: string } | null };

/** Prepare a planned visit in advance: earlier visits and promises, and the brief that is carried into the visit at check-in */
export default function PrepareVisit() {
  const { planLine } = useLocalSearchParams<{ planLine: string }>();
  const me = useMe();
  const dialog = useDialog();
  const [brief, setBrief] = useState<Brief | null>(null);
  const { data, error } = useLoad(async () => {
    const [l, b] = await Promise.all([
      supabase.from('visit_plan_lines').select('id, planned_date, time_slot, organization_id, project_id, planned_objective, status, organizations(name), projects(name), visit_plans(sales_person_id, status)').eq('id', planLine).maybeSingle(),
      supabase.from('visit_briefs').select('previous, promised, done').eq('plan_line_id', planLine).maybeSingle(),
    ]);
    if (l.error) throw new Error(l.error.message);
    if (!l.data) throw new Error('Planned visit not found');
    return { line: l.data as unknown as Line, brief: b.data ? { previous: b.data.previous ?? '', promised: b.data.promised ?? '', done: b.data.done ?? '' } : EMPTY_BRIEF };
  }, [planLine]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const l = data.line, b = brief ?? data.brief, mine = l.visit_plans?.sales_person_id === me.id;
  const save = (thenCheckIn: boolean) =>
    dialog.run(async () => {
      const { error: e } = await supabase.from('visit_briefs').upsert({ plan_line_id: l.id, sales_person_id: me.id, previous: b.previous.trim() || null, promised: b.promised.trim() || null, done: b.done.trim() || null }, { onConflict: 'plan_line_id' });
      if (e) throw new Error(e.message);
      if (thenCheckIn) router.replace(`/visits/new?planLine=${l.id}`);
    }, 'Brief saved – it comes with you to the check-in');
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: 'Prepare the visit' }} />
      <Card>
        <Row wrap>
          <KeyValue label="Customer" value={l.organizations?.name ?? '—'} />
          <KeyValue label="Project" value={l.projects?.name ?? '— (customer visit)'} />
          <KeyValue label="Planned" value={`${fmtDate(l.planned_date)}${l.time_slot ? ` · ${l.time_slot}` : ''}`} />
          <KeyValue label="Objective" value={l.planned_objective} />
        </Row>
      </Card>
      <Section title="Before the visit">
        <VisitBrief organizationId={l.organization_id} projectId={l.project_id} value={b} onChange={setBrief} />
      </Section>
      {mine ? (
        <Row wrap gap={8} style={{ marginTop: 12 }}>
          <Button title="Save the brief" onPress={() => save(false)} />
          {l.status === 'planned' && l.visit_plans?.status === 'approved' ? <Button variant="secondary" title="Save and check in" onPress={() => save(true)} /> : null}
        </Row>
      ) : (
        <Muted>Only the sales person who planned this visit can write its brief.</Muted>
      )}
    </Screen>
  );
}
