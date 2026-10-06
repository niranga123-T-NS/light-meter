import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, DateField, ErrorBanner, Field, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section, Select } from '@/components/ui';
import { captureLocation, TenderResultForm } from '@/components/VisitBits';
import { useMe } from '@/lib/auth';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '@/lib/format';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { isSales } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Project, Visit } from '@/lib/types';


export default function VisitDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const masters = useMasters();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const { data: v, error: e } = await supabase.from('visits').select('*, organizations(name), projects(name)').eq('id', id).maybeSingle();
    if (e) throw new Error(e.message);
    if (!v) throw new Error('Visit not found (it may still be syncing from a device).');
    const { count } = await supabase.from('tenders').select('id', { count: 'exact', head: true }).eq('visit_id', id);
    return { visit: v as Visit, hasTender: (count ?? 0) > 0 };
  }, [id]);
  const [report, setReport] = useState({ summary: '', outcome: null as string | null, next_action: '', next_action_date: null as string | null });

  // Initialise the report form each time the visit is (re)loaded
  const [loadedVisit, setLoadedVisit] = useState<Visit | null>(null);
  if (data?.visit && data.visit !== loadedVisit) {
    setLoadedVisit(data.visit);
    setReport({
      summary: data.visit.summary ?? '',
      outcome: data.visit.outcome,
      next_action: data.visit.next_action ?? '',
      next_action_date: data.visit.next_action_date,
    });
  }

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const v = data.visit;
  const mine = v.sales_person_id === me.id;
  const tenderClosing = v.visit_type === 'tender' && ['Bid Submission', 'Tender Opening / Bid Opening'].includes(v.tender_activity ?? '');

  // Prompt to confirm win probability after a visit whose objective signals progress or risk (4.7)
  const probabilityPrompt = async () => {
    const objectives = masters.list('visit_objective');
    const signals = [v.primary_objective, ...v.secondary_objectives].some((o) => objectives.find((x) => x.value === o)?.tags.includes('probability_prompt'));
    if (!signals || !v.project_id) return;
    const { data: p } = await supabase.from('projects').select('*').eq('id', v.project_id).maybeSingle();
    const project = p as Project | null;
    if (!project) return;
    // Wizard tick on for this project: score it with the wizard instead of entering the % by hand
    if (project.use_wizard) {
      if (await dialog.confirm('Update the win probability?', `${project.name} is at ${project.win_probability}%. This project uses the Win Probability Wizard.`, { confirmLabel: 'Open the wizard' }))
        router.push({ pathname: '/projects/wizard', params: { id: project.id } });
      return;
    }
    const manager = me.role === 'sm_projects' || me.role === 'gm';
    const res = await dialog.prompt({
      title: 'Update win probability?',
      message: `${project.name} is at ${project.win_probability}%. Keep it or change it.`,
      confirmLabel: 'Save',
      fields: [
        { key: 'probability', label: 'Win probability %', initial: String(project.win_probability), required: true },
        { key: 'reason', label: 'Reason', type: 'multiline' },
      ],
    });
    if (!res) return;
    const pct = Number(res.probability);
    if (pct === project.win_probability) return;
    if (!(pct >= 0 && pct <= 100)) return dialog.toast('Win probability is 0 – 100', 'error');
    // A sales person's change goes to SM Projects for approval, like every other project detail
    await dialog.run(
      () =>
        manager
          ? rpc('set_project_probability', { p_project: project.id, p_milestone: project.milestone, p_probability: pct, p_reason: res.reason || null })
          : rpc('request_project_change', {
              p_project: project.id,
              p_changes: { win_probability: pct },
              p_reason: res.reason?.trim() || `After visit ${v.code ?? ''}`.trim(),
            }),
      manager ? 'Probability updated' : 'Sent to SM Projects for approval',
    );
  };

  const closeVisit = () =>
    dialog.run(async () => {
      if (report.summary.trim().length < 30) throw new Error('Discussion summary must be at least 30 characters');
      if (!report.outcome) throw new Error('Select the outcome');
      const pos = await captureLocation().catch(() => null);
      const { error: e } = await supabase
        .from('visits')
        .update({
          summary: report.summary,
          outcome: report.outcome,
          next_action: report.next_action || null,
          next_action_date: report.next_action_date,
          checkout_at: new Date().toISOString(),
          checkout_lat: pos?.lat ?? null,
          checkout_lng: pos?.lng ?? null,
          status: 'closed',
        })
        .eq('id', v.id);
      if (e) throw new Error(e.message);
      await reload();
      await probabilityPrompt();
    }, 'Visit report saved');

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: v.code ?? 'Visit' }} />
      <ErrorBanner message={error} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <Row gap={6} wrap>
            <Pill label={v.status === 'open' ? 'Report due' : 'Closed'} tone={v.status === 'open' ? colors.amber : colors.green} />
            {v.visit_type === 'tender' ? <Pill label={`Tender · ${v.tender_activity ?? ''}`} tone={colors.blue} /> : null}
            {v.unplanned ? <Pill label="Unplanned" /> : <Pill label="Planned" tone={colors.green} />}
            {v.gps_verified === false ? <Pill label="GPS compliance review" tone={colors.red} /> : v.gps_verified ? <Pill label="GPS verified" tone={colors.green} /> : <Pill label="No GPS" />}
          </Row>
        </Row>
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Customer" value={v.organizations?.name ?? '—'} />
          <KeyValue label="Project" value={v.projects?.name ?? '— (networking)'} />
          <KeyValue label="Sales person" value={people[v.sales_person_id]?.full_name ?? '—'} />
          <KeyValue label="Category" value={v.visit_category} />
          <KeyValue label="Objective" value={v.primary_objective} />
          <KeyValue label="Secondary" value={v.secondary_objectives.join(', ') || '—'} />
          <KeyValue label="Check-in" value={fmtDateTime(v.checkin_at)} />
          <KeyValue label="Check-out" value={fmtDateTime(v.checkout_at)} />
          <KeyValue label="Distance from site" value={v.distance_from_site_m == null ? '—' : `${fmtNumber(v.distance_from_site_m)} m`} />
          <KeyValue label="Estimated lighting value" value={fmtMoney(v.est_lighting_value, v.currency)} />
          {v.tender_no ? <KeyValue label="Tender no." value={v.tender_no} /> : null}
          {v.competitors_mentioned.length ? <KeyValue label="Competitors" value={v.competitors_mentioned.join(', ')} /> : null}
        </Row>
      </Card>

      {v.status === 'closed' ? (
        <Section title="Report">
          <Card>
            <Muted>Outcome</Muted>
            <Pill label={v.outcome ?? '—'} />
            <Muted style={{ marginTop: 8 }}>Discussion</Muted>
            <Muted style={{ color: colors.text }}>{v.summary}</Muted>
            {v.next_action ? (
              <Row style={{ marginTop: 10, justifyContent: 'space-between' }} wrap>
                <Muted>
                  Next action: {v.next_action} · {fmtDate(v.next_action_date)}
                  {v.next_action_done_at ? ' · done' : ''}
                </Muted>
                {mine && !v.next_action_done_at ? (
                  <Button
                    small
                    variant="secondary"
                    title="Mark done"
                    onPress={() => dialog.run(async () => {
                      await supabase.from('visits').update({ next_action_done_at: new Date().toISOString() }).eq('id', v.id);
                      await reload();
                    })}
                  />
                ) : null}
              </Row>
            ) : null}
          </Card>
        </Section>
      ) : mine ? (
        <Section title="Visit report">
          <Card>
            <Field label="Discussion summary" required multiline value={report.summary} onChangeText={(t) => setReport((s) => ({ ...s, summary: t }))} hint="Minimum 30 characters" />
            <Select label="Outcome" required value={report.outcome} options={masters.values('visit_outcome').map((x) => ({ value: x, label: x }))} onChange={(x) => setReport((s) => ({ ...s, outcome: x }))} />
            <Field label="Next action" value={report.next_action} onChangeText={(t) => setReport((s) => ({ ...s, next_action: t }))} />
            <DateField label="Next action date" value={report.next_action_date} onChange={(x) => setReport((s) => ({ ...s, next_action_date: x }))} />
            {tenderClosing && !data.hasTender ? <Notice tone={colors.amber}>Save the tender result below before checking out.</Notice> : null}
            <Button title="Check out and save report" disabled={tenderClosing && !data.hasTender} onPress={closeVisit} />
          </Card>
        </Section>
      ) : null}

      {v.visit_type === 'tender' && (mine || me.role === 'sm_projects') ? <TenderResultForm visit={v} onSaved={reload} /> : null}

      <Attachments entityType="visit" entityId={v.id} kinds={['visit_photo', 'visit_doc']} title="Photos and documents" canUpload={mine} allowCamera />

      {mine ? (
        <Row wrap gap={8} style={{ marginTop: 8 }}>
          <Button variant="secondary" title="Report warranty issue" onPress={() => router.push(`/warranty/report?visit=${v.id}`)} />
        </Row>
      ) : null}

      {mine && v.project_id ? (
        <Section title="Next steps">
          <Row wrap gap={8}>
            <Button title="Convert to inquiry" onPress={() => router.push(`/inquiries/new?visit=${v.id}`)} />
            <Button title="Open project" variant="secondary" onPress={() => router.push(`/projects/${v.project_id}`)} />
          </Row>
        </Section>
      ) : null}

      {!isSales(me.role) ? (
        <Section title="Manager review">
          <Card>
            {v.reviewed_by ? (
              <Muted>
                Reviewed by {people[v.reviewed_by]?.full_name}: {v.review_comment ?? '—'}
              </Muted>
            ) : (
              <Muted>Not reviewed yet</Muted>
            )}
            {me.role === 'sm_projects' ? (
              <Button
                small
                variant="secondary"
                title="Mark reviewed / add coaching comment"
                onPress={async () => {
                  const r = await dialog.prompt({ title: 'Review visit', fields: [{ key: 'comment', label: 'Coaching comment', type: 'multiline' }] });
                  if (!r) return;
                  await dialog.run(async () => {
                    const { error: e } = await supabase.from('visits').update({ reviewed_by: me.id, reviewed_at: new Date().toISOString(), review_comment: r.comment || null }).eq('id', v.id);
                    if (e) throw new Error(e.message);
                    await reload();
                  }, 'Reviewed');
                }}
              />
            ) : null}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
