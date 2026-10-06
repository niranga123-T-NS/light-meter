import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { InquiryCard } from '@/components/InquiryBits';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Toggle } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { MILESTONES } from '@/lib/constants';
import { type ChangeRequest, FIELD_LABEL, showValue } from '@/lib/projectChanges';
import { fmtDate, fmtDateTime, fmtMoney, human } from '@/lib/format';
import { useLoad, useMasters, usePeople } from '@/lib/hooks';
import { isSales, projectTypeLabel } from '@/lib/roles';
import { rpc, supabase } from '@/lib/supabase';
import type { Inquiry, Project, Quotation, Visit } from '@/lib/types';
import { isWarrantyDesk } from '@/lib/warranty';

// Key stakeholder categories for the stakeholder map (Section 4.3)
const KEY_CATEGORIES = ['End-Client', 'Architect', 'Electrical Consultant', 'MEP Consultant', 'Main Contractor', 'MEP Contractor'];

export default function ProjectDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const masters = useMasters();
  const dialog = useDialog();

  const { data, error, reload } = useLoad(async () => {
    const { data: p, error: e } = await supabase.from('projects').select('*, organizations(name)').eq('id', id).single();
    if (e) throw new Error(e.message);
    const [inq, vis, log, st, tenders, war] = await Promise.all([
      supabase.from('inquiries').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('visits').select('*, organizations(name)').eq('project_id', id).order('checkin_at', { ascending: false }).limit(50),
      supabase.from('project_log').select('*').eq('project_id', id).order('at', { ascending: false }).limit(50),
      supabase.from('project_stakeholders').select('category, organizations(name)').eq('project_id', id),
      supabase.from('tenders').select('id, tender_no, tender_name, result_status, visit_id').eq('project_id', id),
      supabase.from('warranties').select('id, code, invoice_no, contract_no, start_date, status').eq('project_id', id).order('created_at', { ascending: false }),
    ]);
    const inquiries = (inq.data ?? []) as Inquiry[];
    // Change requests (latest first) and the customer and unit names they mention
    const cr = ((await supabase.from('project_change_requests').select('*').eq('project_id', id).order('requested_at', { ascending: false }).limit(5)).data ??
      []) as ChangeRequest[];
    const orgIds = [...new Set(cr.flatMap((r) => [r.changes.organization_id, r.previous.organization_id]).filter(Boolean) as string[])];
    const unitIds = [...new Set(cr.flatMap((r) => [r.changes.unit_id, r.previous.unit_id]).filter(Boolean) as string[])];
    const orgs = [
      ...(orgIds.length ? ((await supabase.from('organizations').select('id, name').in('id', orgIds)).data ?? []) : []),
      ...(unitIds.length ? ((await supabase.from('org_units').select('id, name').in('id', unitIds)).data ?? []) : []),
    ];
    const q = inquiries.length ? await supabase.from('quotations').select('*').in('inquiry_id', inquiries.map((i) => i.id)) : { data: [] };
    return {
      project: p as Project,
      inquiries,
      visits: (vis.data ?? []) as Visit[],
      log: (log.data ?? []) as { id: number; field: string; old_value: string | null; new_value: string | null; reason: string | null; user_id: string; at: string }[],
      stakeholders: (st.data ?? []) as unknown as { category: string; organizations: { name: string } | null }[],
      quotations: (q.data ?? []) as Quotation[],
      tenders: tenders.data ?? [],
      changeRequests: cr,
      lastScore: ((await supabase.from('win_scores').select('wizard_pct, scored_at').eq('project_id', id).order('scored_at', { ascending: false }).limit(1)).data ?? [])[0] as
        | { wizard_pct: number; scored_at: string }
        | undefined,
      customers: Object.fromEntries((orgs as { id: string; name: string }[]).map((o) => [o.id, o.name])) as Record<string, string>,
      warranties: (war.data ?? []) as { id: string; code: string; invoice_no: string | null; contract_no: string | null; start_date: string; status: string }[],
    };
  }, [id]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { project: p, inquiries, visits, log, stakeholders, quotations, tenders, warranties, changeRequests, customers } = data;
  // Quoted value counts each offer once: the latest revision of each inquiry, and one (the highest) per tender quoted to several contractors
  const latestQuotes = inquiries
    .map((i) => quotations.filter((q) => q.inquiry_id === i.id).sort((a, b) => b.revision - a.revision)[0])
    .filter((q): q is Quotation => !!q);
  const tenderQuotes = Object.values(
    latestQuotes.reduce<Record<string, Quotation>>((acc, q) => {
      const inq = inquiries.find((i) => i.id === q.inquiry_id);
      const key = inq?.tender_group_id ?? q.inquiry_id;
      if (!acc[key] || Number(q.quoted_value) > Number(acc[key].quoted_value)) acc[key] = q;
      return acc;
    }, {}),
  );
  const canEdit = p.owner_id === me.id || me.role === 'sm_projects' || me.role === 'gm';
  const manager = me.role === 'sm_projects' || me.role === 'gm';
  // Sales persons change details by request to SM Projects; SM Projects / GM edit directly
  const requester = canEdit && !manager;
  const pending = changeRequests.find((r) => r.status === 'pending');
  const lastDecided = changeRequests.find((r) => r.status === 'approved' || r.status === 'rejected');
  const decideChange = async (r: ChangeRequest, approve: boolean) => {
    const res = await dialog.prompt({
      title: approve ? 'Approve the change' : 'Do not approve',
      message: Object.keys(r.changes).map((k) => FIELD_LABEL[k] ?? k).join(', '),
      fields: [{ key: 'n', label: approve ? 'Note to the sales person' : 'Reason (required)', type: 'multiline', required: !approve }],
    });
    if (!res) return;
    await dialog.run(async () => {
      await rpc('decide_project_change', { p_id: r.id, p_approve: approve, p_note: res.n || null });
      await reload();
    }, approve ? 'Approved – the project is updated' : 'Not approved – the sales person is told');
  };
  const ms = MILESTONES.find((m) => m.value === p.milestone);
  const met = new Set([...stakeholders.map((s) => s.category), ...visits.map((v) => v.visit_category)]);

  // The win probability is the sales person's own estimate – independent of the milestone
  const changeProbability = async () => {
    const r = await dialog.prompt({
      title: 'Win probability',
      message: 'Your own estimate of winning this project (0–100%), by hand – or tick the wizard and score it there.',
      fields: [
        { key: 'probability', label: 'Win probability %', initial: String(p.win_probability), required: true },
        { key: 'reason', label: manager && p.owner_id !== me.id ? 'Comment (the sales person is notified)' : 'Reason', type: 'multiline' },
      ],
    });
    if (!r) return;
    const pct = Number(r.probability);
    if (!(pct >= 0 && pct <= 100)) return dialog.toast('Win probability is 0 – 100', 'error');
    await dialog.run(async () => {
      await rpc('set_project_probability', { p_project: p.id, p_milestone: p.milestone, p_probability: pct, p_reason: r.reason || null });
      await reload();
    }, 'Probability updated');
  };

  const changeMilestone = async () => {
    const r = await dialog.prompt({
      title: 'Milestone',
      message: 'The milestone does not change the win probability (except Won = 100% and Lost = 0%).',
      fields: [
        { key: 'milestone', label: 'Milestone', type: 'select', initial: p.milestone, options: MILESTONES.map((m) => ({ value: m.value, label: m.label })) },
        { key: 'reason', label: 'Reason', type: 'multiline' },
      ],
    });
    if (!r || r.milestone === p.milestone) return;
    await dialog.run(async () => {
      await rpc('set_project_probability', { p_project: p.id, p_milestone: r.milestone, p_probability: p.win_probability, p_reason: r.reason || null });
      await reload();
    }, 'Milestone updated');
  };

  const review = async () => {
    const r = await dialog.prompt({
      title: 'Review project',
      fields: [
        {
          key: 'action',
          label: 'Decision',
          type: 'select',
          required: true,
          options: [
            { value: 'active', label: 'Still active (set the next action on a visit)' },
            { value: 'on_hold', label: 'Put on hold' },
            { value: 'lost', label: 'Lost' },
            { value: 'cancelled', label: 'Cancelled' },
            ...(p.status === 'won' ? [{ value: 'completed', label: 'Handed over (completed)' }] : []),
          ],
        },
        { key: 'reason', label: 'Reason', type: 'multiline' },
        { key: 'date', label: 'Review date (on hold)', type: 'date' },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('review_project', { p_project: p.id, p_action: r.action, p_reason: r.reason || null, p_review_date: r.date || null });
      await reload();
    }, 'Project updated');
  };

  const changeTerm = async () => {
    const r = await dialog.prompt({
      title: 'Change term / duration',
      fields: [
        { key: 'duration', label: 'Expected duration (months)', initial: String(p.expected_duration_months), required: true },
        {
          key: 'term',
          label: 'Term',
          type: 'select',
          initial: p.project_term,
          options: [
            { value: 'short', label: 'Short term' },
            { value: 'medium', label: 'Medium term' },
            { value: 'long', label: 'Long term' },
          ],
        },
        { key: 'reason', label: 'Why', type: 'multiline', required: true },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('set_project_term', { p_project: p.id, p_duration: Number(r.duration), p_term: r.term, p_reason: r.reason });
      await reload();
    }, 'Term updated');
  };

  const editField = async (field: 'stage' | 'spec_status' | 'lighting_value' | 'project_value' | 'expected_award_date') => {
    const opts =
      field === 'stage'
        ? { type: 'select' as const, options: masters.values('project_stage').map((v) => ({ value: v, label: v })) }
        : field === 'spec_status'
          ? {
              type: 'select' as const,
              options: [
                { value: 'not_specified', label: 'Not specified' },
                { value: 'our_brand', label: 'Our brand specified' },
                { value: 'competitor', label: 'Competitor specified' },
                { value: 'open', label: 'Open or equal' },
              ],
            }
          : field === 'expected_award_date'
            ? { type: 'date' as const }
            : {};
    const r = await dialog.prompt({ title: human(field), fields: [{ key: 'v', label: human(field), required: true, initial: String(p[field] ?? ''), ...opts } as never] });
    if (!r) return;
    await dialog.run(async () => {
      const value = field === 'lighting_value' || field === 'project_value' ? Number(r.v) : r.v;
      const { error: e } = await supabase.from('projects').update({ [field]: value }).eq('id', p.id);
      if (e) throw new Error(e.message);
      await reload();
    }, 'Saved');
  };

  return (
    <Screen maxWidth={1100}>
      <Stack.Screen options={{ title: p.code }} />
      <Card>
        <Row wrap style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, minWidth: 240 }}>
            <Text style={{ fontSize: 20, fontWeight: '700' }}>{p.name}</Text>
            <Muted>
              {p.organizations?.name} · {projectTypeLabel(p.project_type)} · {p.city ?? ''}
            </Muted>
          </View>
          <Row gap={6} wrap>
            <Pill label={p.status} tone={p.status === 'active' ? colors.green : p.status === 'dormant' ? colors.amber : colors.grey} />
            <Pill label={`${p.project_term} term`} />
            <Pill label={p.currency} tone={colors.blue} />
          </Row>
        </Row>
        {p.status === 'dormant' ? <Notice tone={colors.amber}>No activity for 60 days – review this project within 5 working days.</Notice> : null}
        {p.status === 'on_hold' ? <Notice>On hold: {p.status_reason} · review on {fmtDate(p.on_hold_review_date)}</Notice> : null}
        <Row wrap style={{ marginTop: 8 }}>
          <KeyValue label="Sales person" value={people[p.owner_id]?.full_name ?? '—'} />
          <KeyValue label="Stage" value={p.stage} />
          <KeyValue label="Milestone" value={ms?.label ?? p.milestone} />
          <KeyValue label="Win probability" value={`${p.win_probability}% · ${p.use_wizard ? 'Win Probability Wizard' : 'entered by the sales person'}`} />
          <KeyValue label="Lighting value" value={fmtMoney(p.lighting_value, p.currency)} />
          <KeyValue label="Weighted" value={fmtMoney(p.lighting_value == null ? null : (p.lighting_value * p.win_probability) / 100, p.currency)} />
          <KeyValue label="Project value" value={fmtMoney(p.project_value, p.currency)} />
          <KeyValue label="Specification" value={human(p.spec_status)} />
          <KeyValue label="Expected duration" value={`${p.expected_duration_months} months`} />
          <KeyValue label="Expected award" value={fmtDate(p.expected_award_date)} />
          <KeyValue label="Expected tender" value={fmtDate(p.expected_tender_date)} />
          <KeyValue label="Last activity" value={fmtDateTime(p.last_activity_at)} />
        </Row>
        {/* Win Probability Wizard (testing): a tick per project – manual entry or the wizard */}
        {canEdit && !['won', 'lost', 'cancelled', 'completed'].includes(p.status) ? (
          <Row wrap gap={10} style={{ marginTop: 6, alignItems: 'center' }}>
            <Toggle
              label="Use the Win Probability Wizard"
              value={!!p.use_wizard}
              onChange={(v) =>
                dialog.run(async () => {
                  await rpc('set_wizard_use', { p_project: p.id, p_on: v });
                  await reload();
                }, v ? 'Wizard on for this project' : 'Back to manual entry')
              }
            />
            {p.use_wizard ? <Button small title="Open the wizard" onPress={() => router.push({ pathname: '/projects/wizard', params: { id: p.id } })} /> : null}
            {data.lastScore ? <Muted>{`Last wizard score ${data.lastScore.wizard_pct}% · ${fmtDate(data.lastScore.scored_at)}`}</Muted> : null}
          </Row>
        ) : data.lastScore ? (
          <Row style={{ marginTop: 6 }}>
            <Button small variant="ghost" title={`Wizard score ${data.lastScore.wizard_pct}% ›`} onPress={() => router.push({ pathname: '/projects/wizard', params: { id: p.id } })} />
          </Row>
        ) : null}
        {pending ? (
          <Notice tone={colors.amber}>
            <View style={{ gap: 4 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>
                {`Change request – waiting for SM Projects · ${people[pending.requested_by]?.full_name ?? ''} · ${fmtDateTime(pending.requested_at)}`}
              </Text>
              {Object.keys(pending.changes).map((k) => (
                <Text key={k} style={{ color: colors.ink }}>
                  {`${FIELD_LABEL[k] ?? k}: ${showValue(k, pending.previous[k], p.currency, customers)} → ${showValue(k, pending.changes[k], p.currency, customers)}`}
                </Text>
              ))}
              <Muted>{`Reason: ${pending.reason}`}</Muted>
              <Row wrap gap={6} style={{ marginTop: 4 }}>
                {me.role === 'sm_projects' ? (
                  <>
                    <Button small title="Approve" onPress={() => decideChange(pending, true)} />
                    <Button small variant="secondary" title="Reject" onPress={() => decideChange(pending, false)} />
                  </>
                ) : null}
                {pending.requested_by === me.id ? (
                  <Button
                    small
                    variant="ghost"
                    title="Withdraw"
                    onPress={() =>
                      dialog.run(async () => {
                        await rpc('withdraw_project_change', { p_id: pending.id });
                        await reload();
                      }, 'Withdrawn')
                    }
                  />
                ) : null}
              </Row>
            </View>
          </Notice>
        ) : lastDecided && requester && lastDecided.status === 'rejected' && lastDecided.requested_by === me.id ? (
          <Notice tone={colors.red}>{`Your last change request was not approved${lastDecided.decision_note ? `: ${lastDecided.decision_note}` : ''}.`}</Notice>
        ) : null}
        {requester ? (
          <Row wrap gap={6} style={{ marginTop: 8 }}>
            <Button
              small
              title={pending ? 'Change request pending' : 'Request changes'}
              disabled={!!pending}
              onPress={() => router.push({ pathname: '/projects/change', params: { id: p.id } })}
            />
            <Button small variant="secondary" title="Review status" onPress={review} />
          </Row>
        ) : null}
        {canEdit && manager ? (
          <Row wrap gap={6} style={{ marginTop: 8 }}>
            <Button small title="Win probability" onPress={changeProbability} />
            <Button small variant="secondary" title="Milestone" onPress={changeMilestone} />
            <Button small variant="secondary" title="Stage" onPress={() => editField('stage')} />
            <Button small variant="secondary" title="Specification" onPress={() => editField('spec_status')} />
            <Button small variant="secondary" title="Lighting value" onPress={() => editField('lighting_value')} />
            <Button small variant="secondary" title="Award date" onPress={() => editField('expected_award_date')} />
            <Button small variant="secondary" title="Term / duration" onPress={changeTerm} />
            <Button small variant="secondary" title="Review status" onPress={review} />
          </Row>
        ) : null}
        {manager ? (
          <Row wrap gap={6} style={{ marginTop: 8 }}>
            <Button
              small
              variant="secondary"
              title="Reassign sales person"
              onPress={async () => {
                const { data: sp } = await supabase.from('profiles').select('id, full_name').in('role', ['asm_building', 'asm_infra']).eq('active', true);
                const r = await dialog.prompt({ title: 'Reassign project', fields: [{ key: 'o', label: 'Sales person', type: 'select', required: true, options: (sp ?? []).map((x) => ({ value: x.id, label: x.full_name })) }] });
                if (r) await dialog.run(async () => { const { error: e } = await supabase.from('projects').update({ owner_id: r.o }).eq('id', p.id); if (e) throw new Error(e.message); await reload(); }, 'Reassigned – both sales people notified');
              }}
            />
            <Button
              small
              variant="secondary"
              title="Merge a duplicate into this"
              onPress={async () => {
                const r = await dialog.prompt({
                  title: 'Merge duplicate',
                  message: 'All visits, inquiries, quotations and tenders move to this project.',
                  fields: [
                    { key: 'code', label: 'Code of the duplicate project (PRJ-…)', required: true },
                    { key: 'reason', label: 'Reason', type: 'multiline', required: true },
                  ],
                });
                if (!r) return;
                await dialog.run(async () => {
                  const { data: dup } = await supabase.from('projects').select('id').eq('code', r.code.trim()).maybeSingle();
                  if (!dup) throw new Error('Project code not found');
                  await rpc('merge_projects', { p_keep: p.id, p_merge: dup.id, p_reason: r.reason });
                  await reload();
                }, 'Merged');
              }}
            />
          </Row>
        ) : null}
      </Card>

      <Section title="Stakeholder map">
        <Card>
          <Row wrap gap={6}>
            {KEY_CATEGORIES.map((c) => (
              <Pill key={c} label={`${met.has(c) ? '✓' : '✗'} ${c}`} tone={met.has(c) ? colors.green : colors.red} />
            ))}
          </Row>
          <Muted style={{ marginTop: 6 }}>
            Coverage {KEY_CATEGORIES.filter((c) => met.has(c)).length} of {KEY_CATEGORIES.length} key categories.{' '}
            {stakeholders.map((s) => `${s.category}: ${s.organizations?.name ?? ''}`).join(' · ')}
          </Muted>
        </Card>
      </Section>

      <Section title={`Inquiries (${inquiries.length})`} right={isSales(me.role) || manager ? <Button small title="+ Inquiry" onPress={() => router.push(`/inquiries/new?project=${p.id}`)} /> : undefined}>
        <View style={{ gap: 8 }}>
          {inquiries.map((i) => (
            <InquiryCard key={i.id} inquiry={i} />
          ))}
          {!inquiries.length ? <Muted>No inquiries yet</Muted> : null}
        </View>
        {quotations.length ? (
          <Card style={{ marginTop: 8 }}>
            <Text style={{ fontWeight: '700', marginBottom: 4 }}>Quotations</Text>
            {quotations.map((q) => (
              <Row key={q.id} style={{ justifyContent: 'space-between', paddingVertical: 3 }}>
                <Text>
                  {q.full_no}
                  {inquiries.find((i) => i.id === q.inquiry_id)?.tender_group_id ? <Text style={{ color: colors.muted }}> · {inquiries.find((i) => i.id === q.inquiry_id)?.customer_name}</Text> : null}
                </Text>
                <Text>
                  {fmtMoney(q.quoted_value, q.currency)} · {q.result ?? (new Date(q.validity_date) < new Date() ? 'Expired' : `valid to ${fmtDate(q.validity_date)}`)}
                </Text>
              </Row>
            ))}
            <Muted>
              Quoted: {['LKR', 'USD'].map((c) => fmtMoney(tenderQuotes.filter((q) => q.currency === c).reduce((a, q) => a + Number(q.quoted_value), 0), c as 'LKR')).join(' + ')} · Won:{' '}
              {['LKR', 'USD'].map((c) => fmtMoney(inquiries.filter((i) => i.status === 'won' && i.currency === c).reduce((a, i) => a + Number(i.order_value ?? 0), 0), c as 'LKR')).join(' + ')}
            </Muted>
          </Card>
        ) : null}
      </Section>

      {tenders.length ? (
        <Section title="Tenders">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {tenders.map((t) => (
              <ListRow key={t.id} title={`${t.tender_no} – ${t.tender_name}`} right={<Pill label={human(t.result_status)} />} onPress={() => t.visit_id && router.push(`/visits/${t.visit_id}`)} />
            ))}
          </Card>
        </Section>
      ) : null}

      {warranties.length || p.status === 'completed' || isWarrantyDesk(me.role) ? (
        <Section
          title={`Warranties (${warranties.length})`}
          right={isWarrantyDesk(me.role) ? <Button small title="+ Completion record" onPress={() => router.push({ pathname: '/warranty/edit', params: { project: p.id } })} /> : undefined}
        >
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {warranties.map((w) => (
              <ListRow
                key={w.id}
                title={`${w.code} · ${[w.invoice_no, w.contract_no].filter(Boolean).join(' · ')}`}
                subtitle={`Starts ${fmtDate(w.start_date)}${w.status === 'cancelled' ? ' · cancelled' : ''}`}
                onPress={() => router.push(`/warranty/${w.id}`)}
              />
            ))}
            {!warranties.length ? <Muted style={{ padding: 12 }}>{p.status === 'completed' ? 'Completed – no completion record / warranty entered yet' : 'No warranty recorded'}</Muted> : null}
          </Card>
        </Section>
      ) : null}

      <Section title={`Visit history (${visits.length})`} right={isSales(me.role) ? <Button small title="Check in" onPress={() => router.push(`/visits/new?project=${p.id}`)} /> : undefined}>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {visits.map((v) => (
            <ListRow
              key={v.id}
              title={`${fmtDateTime(v.checkin_at)} · ${v.organizations?.name ?? ''}`}
              subtitle={`${v.visit_category} · ${v.primary_objective} · ${v.outcome ?? 'report due'} · ${people[v.sales_person_id]?.full_name ?? ''}`}
              onPress={() => router.push(`/visits/${v.id}`)}
            />
          ))}
          {!visits.length ? <Muted style={{ padding: 12 }}>No visits yet</Muted> : null}
        </Card>
      </Section>

      <Section title="Change history">
        <Card>
          {log.map((l) => (
            <Muted key={l.id}>
              {fmtDateTime(l.at)} · {people[l.user_id]?.full_name ?? 'System'} · {human(l.field)}: {l.old_value ?? '—'} → {l.new_value ?? '—'}
              {l.reason ? ` · ${l.reason}` : ''}
            </Muted>
          ))}
          {!log.length ? <Muted>No changes logged yet</Muted> : null}
        </Card>
      </Section>
    </Screen>
  );
}
