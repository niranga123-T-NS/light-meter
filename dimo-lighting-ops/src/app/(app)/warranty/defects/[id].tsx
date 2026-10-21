import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Text } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { LocationPicker } from '@/components/LocationPicker';
import { ReportedLocationRow, repText } from '@/components/ReportedLocation';
import { captureLocation } from '@/components/VisitBits';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import {
  CAUSE,
  DEFECT_CATEGORY,
  DEFECT_MANAGERS,
  DEFECT_OPEN,
  DEFECT_SOURCE,
  DEFECT_STATUS,
  labelOf,
  PHASE,
  RESPONSIBLE,
  SEVERITY,
  severityTone,
  type Defect,
} from '@/lib/defects';
import type { ExecMember } from '@/lib/execution';
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const DUE_DAYS = { critical: 2, major: 7, minor: 14 } as const;

/** One project defect: verify, assign, rectify (with an after photo), close or reopen. */
export default function DefectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [mapOpen, setMapOpen] = useState(false);
  const { data, error, reload } = useLoad(async () => {
    const { data: d, error: e } = await supabase.from('project_defects').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const df = d as Defect;
    const m = df.exec_project_id ? await supabase.from('exec_members').select('*').eq('exec_project_id', df.exec_project_id).eq('active', true) : { data: [] };
    return { d: df, members: (m.data ?? []) as ExecMember[] };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { d, members } = data;
  const st = DEFECT_STATUS[d.status];
  const manager = DEFECT_MANAGERS.includes(me.role);
  const projectAe = me.role === 'assistant_engineer' && members.some((x) => x.user_id === me.id && x.member_role === 'assistant_engineer');
  const engineer = d.status === 'assigned' && (d.assignee_id === me.id || manager || projectAe);
  const canRectify = engineer && !!d.inspected_at && d.cause !== 'product';
  // Product fault found at the inspection: the SEE or the Operations Executive opens the product warranty claim
  const canClaim = d.status === 'assigned' && d.cause === 'product' && (me.role === 'senior_elec_engineer' || me.role === 'operations_exec');
  const late = d.status === 'assigned' && !!d.due_date && d.due_date < todayISO();
  const pn = (u: string | null) => (u ? (people[u]?.full_name ?? '') : '');
  // Engineers to assign: the project's AEs first, then every AE, approved trainee and SEE
  const engineers = Object.values(people)
    .filter((p) => p.active !== false && (p.role === 'assistant_engineer' || p.role === 'senior_elec_engineer' || p.role === 'trainee'))
    .sort((a, b) => Number(members.some((m) => m.user_id === b.id)) - Number(members.some((m) => m.user_id === a.id)) || a.full_name.localeCompare(b.full_name));

  const verify = async (ok: boolean) => {
    const r = ok
      ? await dialog.confirm('Verify the defect', 'It becomes an open defect, to assign.', { confirmLabel: 'Verify' })
      : await dialog.prompt({ title: 'Not a defect / not ours', fields: [{ key: 'n', label: 'Reason (the reporter is told)', type: 'multiline', required: true }], confirmLabel: 'Reject', danger: true });
    if (r)
      await dialog.run(async () => {
        await rpc('verify_defect', { p_id: d.id, p_ok: ok, p_reason: typeof r === 'object' ? r.n : null });
        await reload();
      }, ok ? 'Verified' : 'Not accepted');
  };
  // the site the engineer goes to: the location the reporter shared, checked (or adjusted) by the SEE / SM Projects
  const site = d.site_lat != null && d.site_lng != null ? { lat: d.site_lat, lng: d.site_lng } : null;
  const shared = d.rep_lat != null && d.rep_lng != null ? { lat: d.rep_lat, lng: d.rep_lng } : null;
  const siteOpen = ['reported', 'open', 'assigned'].includes(d.status);
  const setSite = (lat: number, lng: number, msg: string) =>
    dialog.run(async () => {
      await rpc('set_defect_site', { p_id: d.id, p_lat: lat, p_lng: lng });
      await reload();
    }, msg);
  const siteHere = () =>
    dialog.run(async () => {
      const pos = await captureLocation();
      if (!pos) throw new Error('Allow location access to use where you are');
      await rpc('set_defect_site', { p_id: d.id, p_lat: pos.lat, p_lng: pos.lng });
      await reload();
    }, 'Site location set to where you are');
  const assign = async () => {
    if (!site) {
      if (shared) {
        const ok = await dialog.confirm(
          'Check the site location',
          `${pn(d.reported_by) || 'The reporter'} shared ${repText(shared.lat, shared.lng, d.rep_from)}. Is it where the engineer must go? If not, cancel and adjust it under Site location.`,
          { confirmLabel: 'Yes – use it' },
        );
        if (!ok) return;
        await rpc('set_defect_site', { p_id: d.id, p_lat: shared.lat, p_lng: shared.lng }).catch(() => null);
      } else {
        const ok = await dialog.confirm('No site location', 'No location was shared for this defect – the engineer has only the address. Set it under Site location first, or assign anyway.', { confirmLabel: 'Assign anyway' });
        if (!ok) return;
      }
    }
    const r = await dialog.prompt({
      title: d.assignee_id ? 'Reassign' : 'Assign the defect',
      fields: [
        {
          key: 'a',
          label: 'Engineer',
          type: 'select',
          required: true,
          initial: d.assignee_id ?? undefined,
          options: engineers.map((p) => ({ value: p.id, label: p.full_name, hint: members.some((m) => m.user_id === p.id) ? 'on this project' : p.role === 'senior_elec_engineer' ? 'SEE' : undefined })),
        },
        { key: 'r', label: 'Who is responsible', type: 'select', required: true, initial: d.responsible ?? 'dimo', options: RESPONSIBLE },
        { key: 'c', label: 'Subcontractor / company (for a back-charge)', initial: d.responsible_company ?? undefined },
        { key: 'due', label: 'Due date', type: 'date', required: true, initial: d.due_date ?? addDaysISO(todayISO(), DUE_DAYS[d.severity]) },
      ],
      confirmLabel: 'Assign',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('assign_defect', { p_id: d.id, p: { assignee_id: r.a, responsible: r.r, responsible_company: r.c || null, due_date: r.due } });
        await reload();
      }, 'Assigned – the engineer is told');
  };
  const inspect = async () => {
    const r = await dialog.prompt({
      title: 'Record the inspection',
      message: 'Attach a photo from the inspection first (Photos below).',
      fields: [
        { key: 'f', label: 'What you found', type: 'multiline', required: true, initial: d.inspection ?? undefined },
        { key: 'c', label: 'Cause', type: 'select', required: true, initial: d.cause ?? undefined, options: CAUSE },
      ],
      confirmLabel: 'Save',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('inspect_defect', { p_id: d.id, p_finding: r.f, p_cause: r.c });
        await reload();
      }, r.c === 'product' ? 'Saved – the SEE / Operations create the product warranty claim' : 'Inspection saved');
  };
  const rectify = async () => {
    const r = await dialog.prompt({
      title: 'Rectified',
      message: 'Attach a photo after the rectification first (Photos below).',
      fields: [{ key: 'n', label: 'What was done', type: 'multiline', required: true }],
      confirmLabel: 'Record',
    });
    if (r)
      await dialog.run(async () => {
        await rpc('rectify_defect', { p_id: d.id, p_action: r.n });
        await reload();
      }, 'Recorded – the SEE / SM Projects checks and closes it');
  };
  const close = async (ok: boolean) => {
    const r = await dialog.prompt({
      title: ok ? 'Close the defect' : 'Reopen – not fixed',
      fields: [{ key: 'n', label: ok ? 'Note (checked with the client …)' : 'What is still wrong', type: 'multiline', required: !ok }],
      confirmLabel: ok ? 'Close' : 'Reopen',
      danger: !ok,
    });
    if (r)
      await dialog.run(async () => {
        await rpc('close_defect', { p_id: d.id, p_close: ok, p_note: r.n || null });
        await reload();
      }, ok ? 'Closed' : 'Reopened');
  };

  return (
    <Screen maxWidth={1000} onRefresh={reload}>
      <Stack.Screen options={{ title: d.code }} />
      <Row wrap gap={8} style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, flex: 1 }}>{`${d.code} · ${d.title}`}</Text>
        <Pill label={labelOf(SEVERITY, d.severity).split(' –')[0]} tone={severityTone(d.severity)} solid={d.severity === 'critical'} />
        <Pill label={st.label} tone={st.tone} solid />
      </Row>
      {late ? <Notice tone={colors.red}>{`Overdue – due ${fmtDate(d.due_date)}`}</Notice> : null}
      {d.status === 'rejected' ? <Notice tone={colors.grey}>{`Not accepted by ${pn(d.verified_by)}: ${d.reject_reason ?? ''}`}</Notice> : null}
      {d.reopen_count ? <Notice tone={colors.amber}>{`Reopened ${d.reopen_count} time(s) – last: ${d.last_reopen_reason ?? ''}`}</Notice> : null}
      {d.status === 'assigned' && d.cause === 'product' ? (
        <Notice tone={colors.blue}>
          The inspection found a fault in the product supplied. The SEE or the Operations Executive creates a product warranty claim – the defect then moves to product warranty.
        </Notice>
      ) : null}
      {d.status === 'warranty' && d.warranty_claim_id ? (
        <Notice tone={colors.blue}>Moved to product warranty – the claim continues there (inspection, decision, manufacturer claim).</Notice>
      ) : null}

      <Card>
        <KeyValue label="Project" value={[d.project_name, d.customer].filter(Boolean).join(' · ')} />
        <KeyValue label="Where" value={[d.site, d.location].filter(Boolean).join(' · ') || '—'} />
        <KeyValue label="When" value={PHASE[d.phase]} />
        <KeyValue label="What is wrong" value={d.description} />
        <KeyValue label="Category" value={labelOf(DEFECT_CATEGORY, d.category)} />
        <KeyValue label="Reported" value={`${pn(d.reported_by)} · ${fmtDateTime(d.reported_at)} · ${d.source === 'sales' ? 'reported by sales' : labelOf(DEFECT_SOURCE, d.source)}${d.client_ref ? ` · ref ${d.client_ref}` : ''}`} />
        {d.assignee_id ? (
          <KeyValue
            label="Assigned"
            value={`${pn(d.assignee_id)} · due ${fmtDate(d.due_date)} · ${labelOf(RESPONSIBLE, d.responsible)}${d.responsible_company ? ` (${d.responsible_company})` : ''}`}
          />
        ) : null}
        {d.inspected_at ? <KeyValue label="Inspection" value={`${d.inspection} · cause: ${labelOf(CAUSE, d.cause)} · ${pn(d.inspected_by)} · ${fmtDateTime(d.inspected_at)}`} /> : null}
        {d.rectification ? <KeyValue label="Rectification" value={`${d.rectification} · ${pn(d.rectified_by)} · ${fmtDateTime(d.rectified_at)}`} /> : null}
        {d.closed_at ? <KeyValue label="Closed" value={`${pn(d.closed_by)} · ${fmtDateTime(d.closed_at)}${d.close_note ? ` · ${d.close_note}` : ''}`} /> : null}
      </Card>

      <Section title="Site location">
        <Card>
          <ReportedLocationRow lat={d.rep_lat ?? null} lng={d.rep_lng ?? null} from={d.rep_from} by={pn(d.reported_by)} label="Shared by the reporter" />
          {site ? (
            <ReportedLocationRow lat={site.lat} lng={site.lng} by={`${pn(d.site_checked_by ?? null)} · ${fmtDateTime(d.site_checked_at ?? null)}`} label="Checked for the engineer" />
          ) : manager && siteOpen ? (
            <Notice tone={colors.amber}>Check the location before assigning – the work may be at another part of the site. The engineer gets the checked point; what the reporter shared stays as it is.</Notice>
          ) : null}
          {manager && siteOpen ? (
            <Row wrap gap={6}>
              {shared && !site ? <Button small title="The shared location is correct" onPress={() => setSite(shared.lat, shared.lng, 'Location checked – the engineer gets it')} /> : null}
              {Platform.OS === 'web' ? <Button small variant="secondary" title={site || shared ? 'Adjust on the map' : 'Pin on the map'} onPress={() => setMapOpen(true)} /> : null}
              <Button small variant="secondary" title="Use my location (at the site)" onPress={siteHere} />
            </Row>
          ) : null}
        </Card>
      </Section>
      <LocationPicker
        visible={mapOpen}
        title="Defect site – the point the engineer goes to"
        query={[d.site, d.project_name].filter(Boolean).join(' ')}
        initial={site ?? shared}
        onSave={async (p) => {
          await setSite(p.lat, p.lng, 'Site location set – the engineer gets it');
          setMapOpen(false);
        }}
        onClose={() => setMapOpen(false)}
      />

      <Attachments
        entityType="project_defect"
        entityId={d.id}
        kinds={['defect_photo', ...(canRectify || d.status === 'rectified' ? ['defect_after'] : [])]}
        title="Photos (before and after)"
        allowCamera
        canUpload={DEFECT_OPEN.includes(d.status)}
      />

      <Section title="Progress">
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {[
            ['Reported', true, `${pn(d.reported_by)} · ${fmtDateTime(d.reported_at)}`],
            ['Verified', !!d.verified_at && d.status !== 'rejected', d.verified_at ? `${pn(d.verified_by)} · ${fmtDateTime(d.verified_at)}` : 'SEE / SM Projects'],
            ['Assigned', !!d.assigned_at, d.assigned_at ? `${pn(d.assigned_by)} → ${pn(d.assignee_id)} · ${fmtDateTime(d.assigned_at)}` : 'SEE / SM Projects'],
            ['Inspected', !!d.inspected_at, d.inspected_at ? `${pn(d.inspected_by)} · ${labelOf(CAUSE, d.cause)}` : 'the engineer, on site, with a photo'],
            ...(d.status === 'warranty' ? [['Moved to product warranty', true, 'a product warranty claim was created'] as [string, boolean, string]] : []),
            ['Rectified', !!d.rectified_at && d.status !== 'assigned', d.rectified_at ? `${pn(d.rectified_by)} · ${fmtDateTime(d.rectified_at)}` : 'the engineer, with an after photo'],
            ['Closed', d.status === 'closed', d.closed_at ? `${pn(d.closed_by)} · ${fmtDateTime(d.closed_at)}` : 'SEE / SM Projects, after checking'],
          ].map(([t, done, sub]) => (
            <ListRow key={t as string} title={`${done ? '✓' : '○'} ${t}`} subtitle={sub as string} right={done ? <Pill label="Done" tone={colors.green} /> : null} />
          ))}
        </Card>
      </Section>

      <Row wrap gap={8}>
        {manager && d.status === 'reported' ? (
          <>
            <Button title="Verify" onPress={() => verify(true)} />
            <Button variant="danger" title="Not a defect" onPress={() => verify(false)} />
          </>
        ) : null}
        {manager && ['reported', 'open', 'assigned'].includes(d.status) ? <Button title={d.assignee_id ? 'Reassign' : 'Assign'} variant={d.status === 'assigned' ? 'secondary' : 'primary'} onPress={assign} /> : null}
        {engineer && d.cause !== 'product' ? (
          <Button title={d.inspected_at ? 'Change the inspection' : 'Record the inspection'} variant={d.inspected_at ? 'secondary' : 'primary'} onPress={inspect} />
        ) : null}
        {engineer && d.cause === 'product' && !canClaim ? <Button variant="secondary" title="Change the inspection" onPress={inspect} /> : null}
        {canClaim ? <Button title="Create product warranty claim" onPress={() => router.push({ pathname: '/warranty/claims/new', params: { defect: d.id } })} /> : null}
        {canClaim ? <Button variant="secondary" title="Change the inspection" onPress={inspect} /> : null}
        {d.status === 'warranty' && d.warranty_claim_id ? <Button variant="secondary" title="Open the warranty claim" onPress={() => router.push(`/warranty/claims/${d.warranty_claim_id}`)} /> : null}
        {canRectify ? <Button title="Record the rectification" onPress={rectify} /> : null}
        {manager && d.status === 'rectified' ? (
          <>
            <Button title="Close" onPress={() => close(true)} />
            <Button variant="secondary" title="Reopen – not fixed" onPress={() => close(false)} />
          </>
        ) : null}
      </Row>
    </Screen>
  );
}
