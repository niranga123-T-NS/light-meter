import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, ErrorBanner, KeyValue, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { projectNo, type ExecProject } from '@/lib/execution';
import { fmtDate, fmtDateTimeY, todayISO } from '@/lib/format';
import { formName, loadHseForms, PERMIT_STATUS, qtyNum, type HseEquipment, type HseRecord, type HseSummary } from '@/lib/hse';
import { fillHseRecord } from '@/lib/hseFill';
import { ROLE_LABELS } from '@/lib/roles';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const ANS = { yes: { t: 'Yes', c: colors.green }, no: { t: 'No', c: colors.red }, na: { t: 'N/A', c: colors.grey } } as const;

/** One HSE form as recorded: checklist, permit, toolbox talk or training – sign-offs, permit approval / closing and the PDF. */
export default function HseFormView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('hse_records').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const rec = r as HseRecord;
    const [forms, proj, eq, rel, sum] = await Promise.all([
      loadHseForms(),
      supabase.from('exec_projects').select('*').eq('id', rec.exec_project_id).single(),
      rec.equipment_id ? supabase.from('hse_equipment').select('*').eq('id', rec.equipment_id).single() : Promise.resolve({ data: null }),
      rec.related_id ? supabase.from('hse_records').select('id, code, form_code, status').eq('id', rec.related_id).maybeSingle() : Promise.resolve({ data: null }),
      rpc<HseSummary>('hse_summary', { p_exec: rec.exec_project_id }).catch(() => null),
    ]);
    return {
      r: rec,
      form: forms.find((f) => f.code === rec.form_code)!,
      project: proj.data as ExecProject,
      eq: (eq.data ?? null) as HseEquipment | null,
      related: (rel.data ?? null) as Pick<HseRecord, 'id' | 'code' | 'form_code' | 'status'> | null,
      canEhs: !!sum?.can_ehs,
      canPermit: !!(sum?.can_permit ?? sum?.can_ehs),
      loadedAt: Date.now(),
    };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { r, form: f, project, eq, related, canEhs, canPermit, loadedAt } = data;
  const name = (u: string | null) => (u ? people[u]?.full_name ?? '' : '');
  const permit = f.kind === 'permit';
  const see = me.role === 'senior_elec_engineer' || me.role === 'sm_projects';
  const act = (fn: string, args: Record<string, unknown>, ok: string) => dialog.run(async () => { await rpc(fn, args); await reload(); }, ok);
  const role = (u: string | null) => { const x = u ? people[u]?.role : null; return x ? ROLE_LABELS[x] ?? '' : ''; };
  const pdf = () => dialog.run(() => fillHseRecord(f, r, eq, { project, name, role }, related?.code ?? null));
  const st = permit ? PERMIT_STATUS[r.status] : r.accepted === false ? { label: 'Not accepted', tone: colors.red } : r.accepted ? { label: 'Accepted', tone: colors.green } : { label: 'Recorded', tone: colors.blue };
  const overdue = permit && r.status === 'active' && r.ends_at && Date.parse(r.ends_at) < loadedAt;

  const signRow = (label: string, by: string | null, at: string | null, as: string, can: boolean) => (
    <Row key={as} gap={8} style={{ alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <Text style={{ width: 190, fontWeight: '600', color: colors.text }}>{label}</Text>
      <Text style={{ flex: 1, color: by ? colors.ink : colors.muted }}>{by ? `${name(by)} · ${fmtDateTimeY(at)}` : 'Not signed'}</Text>
      {!by && can ? <Button small title="Sign" onPress={() => act('sign_hse_record', { p_id: r.id, p_as: as }, 'Signed')} /> : null}
    </Row>
  );

  return (
    <Screen maxWidth={900}>
      <Stack.Screen options={{ title: r.code }} />
      <TestingBanner what="HSE forms" />
      <Card style={{ gap: 4, borderLeftWidth: 5, borderLeftColor: st.tone }}>
        <Row wrap style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Text style={{ fontWeight: '700', fontSize: 17, color: colors.ink }}>{`${r.code} · ${permit ? 'Permit to work – ' : ''}${formName(f)}`}</Text>
            <Muted>{`${f.doc_no} · Issue ${f.issue} · Project ${projectNo(project)} ${project.name}`}</Muted>
          </View>
          <Pill label={overdue ? 'Past finishing time – close it' : st.label} tone={overdue ? colors.red : st.tone} solid />
        </Row>
        <Row wrap>
          {eq ? <KeyValue label="Equipment" value={`${eq.name}${eq.serial_no ? ` · ${eq.serial_no}` : ''}`} /> : null}
          <KeyValue label={permit ? 'Requested by' : f.kind === 'tbt' ? 'Conducted by' : 'Checked by'} value={`${name(r.created_by)} · ${fmtDateTimeY(r.created_at)}`} />
          {r.starts_at ? <KeyValue label={permit ? 'Work time' : 'Time'} value={`${fmtDateTimeY(r.starts_at)}${r.ends_at ? ` – ${fmtDateTimeY(r.ends_at)}` : ''}`} /> : null}
          {r.header.location ? <KeyValue label="Location" value={String(r.header.location)} /> : null}
          {r.header.contractor ? <KeyValue label="Contractor" value={String(r.header.contractor)} /> : null}
          {r.header.in_charge ? <KeyValue label="In charge" value={`${String(r.header.in_charge)} · ${String(r.header.mobile ?? '')}`} /> : null}
          {r.header.tbt_no && related?.form_code !== 'TBT-01' ? <KeyValue label="TBT number" value={String(r.header.tbt_no)} /> : null}
          {r.header.title ? <KeyValue label="Title" value={String(r.header.title)} /> : null}
          {r.header.man_hours !== undefined ? <KeyValue label="Man-hours" value={String(r.header.man_hours)} /> : null}
          {related ? <KeyValue label={related.form_code === 'TBT-01' ? 'Toolbox talk' : 'Permit'} value={related.code} /> : null}
        </Row>
        {r.header.description ? <Muted>{String(r.header.description)}</Muted> : null}
        <Row gap={8} wrap style={{ marginTop: 4 }}>
          <Button small variant="secondary" title="PDF (DIMO form)" onPress={pdf} />
          {related ? <Button small variant="ghost" title={`Open ${related.code}`} onPress={() => router.push(`/execution/hse/form/${related.id}`)} /> : null}
          {r.hse_report_id ? <Button small variant="ghost" title="Corrective action (HSE report)" onPress={() => router.push(`/execution/hse/${r.hse_report_id}`)} /> : null}
        </Row>
      </Card>

      {permit ? (
        <Section title="Permit">
          <Card style={{ gap: 6 }}>
            {r.status === 'submitted' ? (
              canPermit && r.created_by !== me.id ? (
                <Row gap={8} wrap>
                  <Button title="Approve – work can start" onPress={() => act('decide_permit', { p_id: r.id, p_approve: true }, 'Approved')} />
                  <Button variant="secondary" title="Not approved" onPress={async () => {
                    const x = await dialog.prompt({ title: 'Not approved', fields: [{ key: 'c', label: 'What must be put right', type: 'multiline', required: true }] });
                    if (x) await act('decide_permit', { p_id: r.id, p_approve: false, p_comment: x.c }, 'Returned to the requester');
                  }} />
                </Row>
              ) : (
                <Muted>{r.created_by === me.id ? 'Waiting for an Assistant Engineer of the project to approve. Work must not start before.' : 'Waiting for an Assistant Engineer of the project to approve.'}</Muted>
              )
            ) : null}
            {r.ehs_by ? <Muted>{`${r.status === 'rejected' ? 'Not approved' : 'Approved'} by ${name(r.ehs_by)} · ${fmtDateTimeY(r.ehs_at)}${r.ehs_note ? ` – ${r.ehs_note}` : ''}`}</Muted> : null}
            {r.status === 'active' && canPermit ? (
              <Button title="Close the permit (work complete, area safe)" onPress={async () => {
                const x = await dialog.prompt({ title: 'Close the permit', message: 'I am confident that all necessary safety precautions in relation to hazards identified with this task have been taken.', fields: [{ key: 'n', label: 'Note (optional)', type: 'multiline' }], confirmLabel: 'Close permit' });
                if (x) await act('close_permit', { p_id: r.id, p_note: x.n || null }, 'Permit closed');
              }} />
            ) : null}
            {r.closed_by ? <Muted>{`Closed by ${name(r.closed_by)} · ${fmtDateTimeY(r.closed_at)}${r.close_note ? ` – ${r.close_note}` : ''}`}</Muted> : null}
          </Card>
        </Section>
      ) : null}

      {f.kind === 'checklist' || f.kind === 'permit' ? (
        <Section title={permit ? 'Control measures' : 'Inspection points'}>
          <Card>
            {f.items.map((it) => {
              const a = r.answers[it.no];
              const s = a?.a ? ANS[a.a] : null;
              return (
                <Row key={it.no} gap={8} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line, alignItems: 'flex-start' }}>
                  <Text style={{ width: 26, color: colors.muted, fontWeight: '700' }}>{it.no}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink }}>{it.text}</Text>
                    {a?.r ? <Muted>{a.r}</Muted> : null}
                  </View>
                  {s ? <Pill label={s.t} tone={s.c} solid={a?.a === 'no'} /> : null}
                </Row>
              );
            })}
            {(f.extra.groups ?? []).map((g) => (
              <View key={g.no} style={{ marginTop: 6 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{`${g.no}  ${g.title}`}</Text>
                {g.items.map((t, i) => {
                  const a = r.answers[`${g.no}.${i + 1}`];
                  return (
                    <Row key={t} style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
                      <Text style={{ color: colors.text }}>{t}</Text>
                      {a?.a ? <Pill label={ANS[a.a].t} tone={ANS[a.a].c} /> : null}
                    </Row>
                  );
                })}
              </View>
            ))}
            {r.header.explain ? <Muted>{`Explanation: ${String(r.header.explain)}`}</Muted> : null}
            {r.header.readings && Object.values(r.header.readings).some(Boolean) ? (
              <Muted>{`Gas readings: ${(f.extra.readings ?? []).map((x) => `${x.label} ${r.header.readings?.[x.key] || '—'}`).join(' · ')}`}</Muted>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {f.kind === 'kit' ? (
        <Section title="First-aid items">
          <Card>
            {f.items.map((it) => {
              const a = r.answers[it.no] ?? {};
              const short = Number(a.avail ?? 0) < qtyNum(it.req);
              const expired = !!a.exp && a.exp < todayISO();
              return (
                <Row key={it.no} gap={8} style={{ paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                  <Text style={{ flex: 1, color: short || expired ? colors.red : colors.ink }}>{`${it.no}  ${it.text}`}</Text>
                  <Text style={{ width: 110, color: short ? colors.red : colors.text }}>{`${a.avail ?? '—'} / ${it.req}`}</Text>
                  <Text style={{ width: 120, color: expired ? colors.red : colors.muted }}>{a.exp ? `exp ${fmtDate(a.exp)}` : ''}</Text>
                </Row>
              );
            })}
          </Card>
        </Section>
      ) : null}

      {f.kind === 'tbt' ? (
        <Section title="Toolbox talk">
          <Card style={{ gap: 6 }}>
            <Text style={{ fontWeight: '600', color: colors.text }}>Activity / work programme</Text>
            <Text style={{ color: colors.ink }}>{String(r.header.activity ?? '')}</Text>
            <Text style={{ fontWeight: '600', color: colors.text }}>Safety issues (hazards & risks)</Text>
            <Text style={{ color: colors.ink }}>{String(r.header.hazards ?? '')}</Text>
            <Text style={{ fontWeight: '600', color: colors.text }}>Control measures</Text>
            <Row wrap gap={6}>
              {f.items.filter((it) => r.answers[it.no]?.a === 'yes').map((it) => <Pill key={it.no} label={`✓ ${it.text}`} tone={colors.green} />)}
              {r.header.other ? <Pill label={String(r.header.other)} tone={colors.blue} /> : null}
            </Row>
          </Card>
        </Section>
      ) : null}

      {r.participants?.length ? (
        <Section title={`Participants (${r.participants.length})`}>
          <Card>
            {r.participants.map((p, i) => (
              <Text key={i} style={{ paddingVertical: 3, color: colors.ink }}>{`${i + 1}. ${p.name}${p.position ? ` · ${p.position}` : ''}${p.company ? ` · ${p.company}` : ''}${p.contact ? ` · ${p.contact}` : ''}`}</Text>
            ))}
          </Card>
        </Section>
      ) : null}

      {r.accepted === false ? (
        <Section title="Not accepted">
          <Card style={{ gap: 6 }}>
            <Notice tone={colors.red}>{f.kind === 'kit' ? 'Refill / replace the short or expired items.' : 'Removed from use. It returns to use with the next accepted checklist.'}</Notice>
            {r.corrective_note ? (
              <Muted>{`Corrective / preventive action ${fmtDate(r.corrective_date)}: ${r.corrective_note}`}</Muted>
            ) : me.role !== 'gm' ? (
              <Button small variant="secondary" title="Record corrective action" onPress={async () => {
                const x = await dialog.prompt({ title: 'Corrective / preventive action taken', fields: [{ key: 'd', label: 'Date', type: 'date', initial: todayISO(), required: true }, { key: 'n', label: 'What was done', type: 'multiline', required: true }] });
                if (x) await act('record_hse_correction', { p_id: r.id, p_date: x.d, p_note: x.n }, 'Recorded – now re-inspect it');
              }} />
            ) : null}
            {eq && me.role !== 'gm' ? <Button small title="Re-inspect now" onPress={() => router.push({ pathname: '/execution/hse/check', params: { equipment: eq.id } })} /> : null}
          </Card>
        </Section>
      ) : null}

      {!permit && f.kind !== 'training' ? (
        <Section title="Sign-off">
          <Card>
            {f.kind !== 'tbt' ? signRow("Contractor's Supervisor", r.sup_by, r.sup_at, 'supervisor', me.role === 'sub_supervisor') : null}
            {signRow('EHS Officer', r.ehs_by, r.ehs_at, 'ehs', canEhs)}
            {signRow(f.kind === 'tbt' ? 'Site Manager' : 'Site In charge / Manager', r.mgr_by, r.mgr_at, 'manager', see && (!!r.ehs_by || me.role === 'senior_elec_engineer'))}
          </Card>
        </Section>
      ) : null}

      <Attachments entityType="hse_record" entityId={r.id} kinds={['hse_photo']} title="Photos and documents" canUpload={me.role !== 'gm'} />
    </Screen>
  );
}
