import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { AttachmentList } from '@/components/AttachmentList';
import { WorkPanel } from '@/components/WorkPanel';
import { FormModal } from '@/components/FormModal';
import { DateField, NumberField, SelectField, TextField } from '@/components/form';
import { Badge, Banner, Body, Button, Card, KeyValue, ListItem, Loading, Muted, Row, Screen, SectionTitle } from '@/components/ui';
import { cacheStore, lookupLabel, profileName, stageById, upsertCached, useLookup } from '@/lib/cache';
import { notify } from '@/lib/dialog';
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/format';
import { stageOptions } from '@/lib/options';
import { saveRecord } from '@/lib/records';
import { useSession } from '@/lib/session';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { Opportunity, Quotation, WorkRequest } from '@/lib/types';
import { useAsync, useRefreshOnFocus } from '@/lib/useAsync';

const FIELD_LABELS: Record<string, string> = {
  estimated_value: 'Estimated value', expected_order_date: 'Expected order date', quotation_due_date: 'Quotation due date',
  win_loss_reason: 'Win / loss reason', award_date: 'Award date', final_award_value: 'Final award value',
};

export default function OpportunityProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { canSell } = useSession();
  const [moving, setMoving] = useState<Opportunity | null>(null);
  const [saving, setSaving] = useState(false);
  const reasons = useLookup('win_loss_reason');

  const { data, loading, error, reload } = useAsync(async () => {
    const [opp, quotes, history, work] = await Promise.all([
      supabase.from('opportunities').select('*').eq('id', id).maybeSingle(),
      supabase.from('quotations').select('*').eq('opportunity_id', id).order('reference').order('revision', { ascending: false }),
      supabase.from('opportunity_stage_history').select('*').eq('opportunity_id', id).order('changed_at', { ascending: false }),
      supabase.from('work_requests').select('*').eq('opportunity_id', id).order('received_at'),
    ]);
    return {
      opp: unwrap(opp) as Opportunity | null,
      quotes: unwrap(quotes) as Quotation[],
      work: unwrap(work) as WorkRequest[],
      history: unwrap(history) as { id: number; from_stage_id: string | null; to_stage_id: string; changed_by: string; changed_at: string; probability: number }[],
    };
  }, [id]);

  useRefreshOnFocus(reload);
  if (loading && !data) return <Loading />;
  const o = data?.opp;
  if (!o) return <Screen><Banner tone="danger" message={error ?? 'Not found'} /></Screen>;
  const stage = stageById(o.stage_id);
  const project = cacheStore.get().projects.find((p) => p.id === o.project_id);
  const target = moving ? stageById(moving.stage_id) : undefined;
  const required = target ? [...(stageById(o.stage_id)?.exit_required_fields ?? []), ...target.entry_required_fields] : [];

  const moveStage = async () => {
    if (!moving) return;
    setSaving(true);
    try {
      const saved = await saveRecord('opportunities', { ...moving, probability: moving.stage_id !== o.stage_id && moving.probability === o.probability ? null : moving.probability }, false);
      upsertCached('opportunities', saved);
      setMoving(null);
      void reload();
    } catch (e) {
      notify('Stage not changed', errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen onRefresh={reload} refreshing={loading}>
      <Stack.Screen options={{ title: o.code ?? 'Package' }} />
      <Card>
        <Body style={{ fontSize: 18, fontWeight: '700' }}>{o.name}</Body>
        <KeyValue label="Project" value={project?.name ?? o.project_id} onPress={() => router.push(`/project/${o.project_id}`)} />
        <Row wrap>
          <Badge label={stage?.name ?? ''} tone={stage?.outcome === 'won' ? 'success' : stage?.outcome === 'lost' ? 'danger' : 'primary'} />
          <Badge label={`${o.probability ?? 0}%`} />
        </Row>
        <KeyValue label="Segment" value={lookupLabel('project_segment', o.segment)} />
        <KeyValue label="Estimated value" value={fmtMoney(o.estimated_value, o.currency)} />
        <KeyValue label="Weighted value" value={fmtMoney(o.weighted_value, o.currency)} />
        <KeyValue label="Inquiry received" value={fmtDate(o.inquiry_received_at)} />
        <KeyValue label="Expected order" value={fmtDate(o.expected_order_date)} />
        <KeyValue label="Quotation due" value={fmtDate(o.quotation_due_date)} />
        <KeyValue label="Owner" value={profileName(o.owner_id)} />
        <KeyValue label="Systems / products" value={o.systems_products} />
        <KeyValue label="Quantities" value={o.quantities} />
        <KeyValue label="Next milestone" value={o.next_milestone ? `${o.next_milestone} (${fmtDate(o.next_milestone_date)})` : null} />
        <KeyValue label="Blocker" value={o.blocker} />
        <KeyValue label="Bid strategy" value={o.bid_strategy} />
        <KeyValue label="Partner / supplier" value={o.partner_supplier} />
        <KeyValue label="Competitors / incumbent" value={[o.competitors, o.incumbent].filter(Boolean).join(' / ')} />
        <KeyValue label="Specification" value={lookupLabel('spec_status', o.spec_status)} />
        {o.win_loss_reason ? <KeyValue label="Win / loss reason" value={`${lookupLabel('win_loss_reason', o.win_loss_reason)}${o.win_loss_notes ? ` – ${o.win_loss_notes}` : ''}`} /> : null}
        {o.final_award_value != null ? <KeyValue label="Award" value={`${fmtMoney(o.final_award_value, o.currency)} on ${fmtDate(o.award_date)}`} /> : null}
      </Card>
      {canSell ? (
        <Row wrap>
          <Button style={{ flex: 1 }} title="Change stage" onPress={() => setMoving({ ...o })} />
          <Button style={{ flex: 1 }} variant="secondary" title="Edit" onPress={() => router.push({ pathname: '/opportunity/edit', params: { id: o.id } })} />
        </Row>
      ) : null}

      <WorkPanel requests={data?.work ?? []} opportunityId={o.id} inquiryDate={o.inquiry_received_at} quotations={data?.quotes ?? []} />

      <SectionTitle right={<Button small variant="ghost" title="＋ Quotation" onPress={() => router.push({ pathname: '/quotation/edit', params: { opportunityId: o.id } })} />}>
        Quotations
      </SectionTitle>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {(data?.quotes ?? []).length === 0 ? <Muted style={{ padding: 16 }}>No quotations</Muted> : data!.quotes.map((q) => (
          <ListItem key={q.id} title={`${q.reference} rev ${q.revision}`} subtitle={`${fmtMoney(q.amount, q.currency)} · ${fmtDate(q.submission_date)}`}
            right={<Badge label={q.status} tone={q.status === 'accepted' ? 'success' : q.status === 'rejected' ? 'danger' : q.status === 'superseded' ? 'neutral' : 'info'} />}
            onPress={() => router.push({ pathname: '/quotation/edit', params: { id: q.id } })} />
        ))}
      </Card>

      <SectionTitle>Stage history</SectionTitle>
      <Card>
        {(data?.history ?? []).map((h) => (
          <Muted key={h.id}>{fmtDateTime(h.changed_at)} – {h.from_stage_id ? `${stageById(h.from_stage_id)?.name} → ` : ''}{stageById(h.to_stage_id)?.name} ({h.probability}%) by {profileName(h.changed_by)}</Muted>
        ))}
      </Card>
      <AttachmentList entityType="opportunity" entityId={o.id} />

      <FormModal visible={!!moving} title="Change stage" onClose={() => setMoving(null)} onSave={moveStage} saving={saving}>
        {moving ? (
          <>
            <SelectField label="Stage" value={moving.stage_id} options={stageOptions()} allowClear={false}
              onChange={(x) => setMoving({ ...moving, stage_id: x ?? moving.stage_id, probability: x && x !== o.stage_id ? stageById(x)?.default_probability ?? moving.probability : o.probability })} />
            <NumberField key={moving.stage_id} label="Probability %" value={moving.probability} onChange={(n) => setMoving({ ...moving, probability: n })} hint="Defaults to the stage probability" />
            {required.length ? <Banner tone="info" message={`This change needs: ${required.map((f) => FIELD_LABELS[f] ?? f).join(', ')}`} /> : null}
            {required.includes('estimated_value') ? <NumberField label="Estimated value" value={moving.estimated_value} onChange={(n) => setMoving({ ...moving, estimated_value: n })} /> : null}
            {required.includes('expected_order_date') ? <DateField label="Expected order date" value={moving.expected_order_date} onChange={(d) => setMoving({ ...moving, expected_order_date: d })} /> : null}
            {required.includes('quotation_due_date') ? <DateField label="Quotation due date" value={moving.quotation_due_date} onChange={(d) => setMoving({ ...moving, quotation_due_date: d })} /> : null}
            {target && target.outcome !== 'open' ? (
              <>
                <SelectField label="Win / loss reason" value={moving.win_loss_reason} options={reasons} onChange={(x) => setMoving({ ...moving, win_loss_reason: x })} />
                <TextField label="Notes" multiline value={moving.win_loss_notes} onChange={(t) => setMoving({ ...moving, win_loss_notes: t })} />
              </>
            ) : null}
            {target?.outcome === 'won' ? (
              <>
                <NumberField label="Final award value" value={moving.final_award_value} onChange={(n) => setMoving({ ...moving, final_award_value: n })} />
                <DateField label="Award date" value={moving.award_date} onChange={(d) => setMoving({ ...moving, award_date: d })} />
              </>
            ) : null}
          </>
        ) : null}
      </FormModal>
    </Screen>
  );
}
