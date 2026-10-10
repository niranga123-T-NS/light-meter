import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, Grid, ListRow, Muted, Pill, Row, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecMember, ExecProject, HseReport } from '@/lib/execution';
import { fmtDate, fmtDateTimeY, fmtTime, todayISO } from '@/lib/format';
import { EQUIP_STATUS, formName, loadHseForms, PERMIT_STATUS, type HseEquipment, type HseForm, type HseRecord, type HseSummary, type Induction } from '@/lib/hse';
import { fillInductionRegister } from '@/lib/hseFill';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { HseRows } from './HseRows';

type Part = 'equipment' | 'permits' | 'tbt' | 'people' | 'reports';

/** HSE for one project: equipment checklists, permits to work, toolbox meetings, induction & training, and incident reports.
 *  Permits and toolbox meetings live in the Plan / Planning tab (`mode="permits"` / `"tbt"`); the HSE tab has the rest (`"noPermits"`).
 *  Assistant Engineers (and subcontractor supervisors, for their own work) create them; the SEE and management see them. */
export function HseTab({ p, mode = 'all' }: { p: ExecProject; mode?: 'all' | 'permits' | 'tbt' | 'noPermits' }) {
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [part, setPart] = useState<Part>('equipment');
  const { data, reload } = useLoad(async () => {
    const [forms, rep, eq, rec, ind, mem, sum] = await Promise.all([
      loadHseForms(),
      supabase.from('hse_reports').select('*').eq('exec_project_id', p.id).order('occurred_at', { ascending: false }),
      supabase.from('hse_equipment').select('*').eq('exec_project_id', p.id).order('name'),
      supabase.from('hse_records').select('*').eq('exec_project_id', p.id).order('created_at', { ascending: false }).limit(300),
      supabase.from('hse_inductions').select('*').eq('exec_project_id', p.id).order('inducted_on', { ascending: false }),
      supabase.from('exec_members').select('*').eq('exec_project_id', p.id).eq('active', true),
      rpc<HseSummary>('hse_summary', { p_exec: p.id }).catch(() => null),
    ]);
    return {
      forms,
      reports: (rep.data ?? []) as HseReport[],
      equipment: (eq.data ?? []) as HseEquipment[],
      records: (rec.data ?? []) as HseRecord[],
      inductions: (ind.data ?? []) as Induction[],
      members: (mem.data ?? []) as (ExecMember & { ehs_officer?: boolean })[],
      summary: sum,
    };
  }, [p.id]);
  const forms = data?.forms ?? [];
  const form = (code: string) => forms.find((f) => f.code === code);
  const canWork = me.role !== 'gm' && me.role !== 'operations_exec';
  const see = me.role === 'senior_elec_engineer' || me.role === 'sm_projects';
  const aes = (data?.members ?? []).filter((m) => m.member_role === 'assistant_engineer');
  const ehs = aes.filter((m) => m.ehs_officer);
  const s = data?.summary;
  const today = todayISO();

  const addEquipment = async () => {
    const types = forms.filter((f) => f.kind === 'checklist' || f.kind === 'kit');
    const r = await dialog.prompt({
      title: 'Add equipment to the register',
      message: 'Each crane, excavator, generator, DB, power tool, extinguisher or first-aid box is registered once; its checklist then comes pre-filled.',
      fields: [
        { key: 'form', label: 'Equipment type (checklist)', type: 'select', required: true, options: types.map((f) => ({ value: f.code, label: `${f.code} ${formName(f)}` })) },
        { key: 'name', label: 'Name / description (e.g. Generator 60 kVA, DB-01)', required: true },
        { key: 'serial', label: 'Serial / plate number' },
        { key: 'contractor', label: "Contractor's name (owner)" },
        { key: 'first', label: 'Date of first deployment', type: 'date', initial: today },
        { key: 'freq', label: 'Check every … days (blank = standard for this type)' },
      ],
      confirmLabel: 'Add',
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc('save_hse_equipment', { p_exec: p.id, p: { form_code: r.form, name: r.name, serial_no: r.serial, contractor: r.contractor, first_deployed: r.first, frequency_days: r.freq } });
      await reload();
    }, 'Added – run its first checklist');
  };

  const newPermit = async () => {
    const r = await dialog.prompt({
      title: 'Request a permit to work',
      message: 'Choose one or more permit types – each is filled in and submitted in turn (the work details carry over). An Assistant Engineer of the project approves each.',
      fields: [{ key: 'f', label: 'Permit types', type: 'multiselect', required: true, options: forms.filter((f) => f.kind === 'permit').map((f) => ({ value: f.code, label: `${f.code} ${formName(f)}` })) }],
      confirmLabel: 'Next',
    });
    if (r?.f) router.push({ pathname: '/execution/hse/permit', params: { project: p.id, form: r.f } });
  };

  const induct = async () => {
    const r = await dialog.prompt({
      title: 'HSE induction',
      message: 'Record each person inducted on this project. The NIC finds earlier inductions so names are not typed twice.',
      fields: [
        { key: 'nic', label: 'NIC number', required: true },
        { key: 'name', label: 'Name of participant (blank = from an earlier induction)' },
        { key: 'company', label: 'Company' },
        { key: 'date', label: 'Date', type: 'date', initial: today },
        { key: 'remarks', label: 'Remarks' },
      ],
      confirmLabel: 'Record',
    });
    if (!r) return;
    await dialog.run(async () => {
      let name = r.name;
      let company = r.company;
      if (!name) {
        const prev = await rpc<{ name: string; company: string | null }[]>('induction_lookup', { p_nic: r.nic });
        if (!prev.length) throw new Error('No earlier induction for this NIC – enter the name');
        name = prev[0].name;
        company = company || prev[0].company || '';
      }
      await rpc('add_induction', { p_exec: p.id, p: { nic: r.nic, name, company, date: r.date, remarks: r.remarks } });
      await reload();
    }, 'Inducted');
  };

  const setEhs = async () => {
    const r = await dialog.prompt({
      title: 'EHS Officers on this project',
      message: 'Ticked Assistant Engineers approve and close permits and sign checklists and toolbox meetings. With none ticked, any Assistant Engineer of the project can.',
      fields: [{ key: 'u', label: 'EHS Officers', type: 'multiselect', options: aes.map((m) => ({ value: m.user_id, label: people[m.user_id]?.full_name ?? '' })), initial: ehs.map((m) => m.user_id).join(',') }],
      confirmLabel: 'Save',
    });
    if (!r) return;
    const want = new Set((r.u ?? '').split(',').filter(Boolean));
    await dialog.run(async () => {
      for (const m of aes) {
        const on = want.has(m.user_id);
        if (on !== !!m.ehs_officer) await rpc('set_ehs_officer', { p_exec: p.id, p_user: m.user_id, p_on: on });
      }
      await reload();
    }, 'EHS Officers updated');
  };

  const rec = data?.records ?? [];
  const permits = rec.filter((r) => form(r.form_code)?.kind === 'permit');
  const tbts = rec.filter((r) => r.form_code === 'TBT-01');
  const trainings = rec.filter((r) => r.form_code === 'TR-01');
  const lastCheck = (e: HseEquipment) => rec.find((r) => r.equipment_id === e.id && form(r.form_code)?.kind !== 'permit');
  const makesPermits = me.role === 'assistant_engineer' || me.role === 'sub_supervisor';
  const permitSub = (r: HseRecord) => `${String(r.header.location ?? '')} · ${fmtDateTimeY(r.starts_at)} – ${fmtDateTimeY(r.ends_at)}`;
  const tbtSub = (r: HseRecord) => `${fmtTime(r.starts_at)}${r.tbt_late ? ' (late)' : ''} · ${String(r.header.location ?? '')} · ${r.participants.length} participants · ${String(r.header.activity ?? '').slice(0, 80)}`;
  const permitList = (
    <>
      {makesPermits ? (
        <Row gap={6}>
          <Button small title="+ Permit to work" onPress={newPermit} />
        </Row>
      ) : null}
      <RecordList rows={permits} forms={forms} people={people} empty="No permits yet" sub={permitSub} />
    </>
  );
  if (mode === 'permits')
    return (
      <View style={{ gap: 8 }}>
        <Grid min={150} max={4}>
          <Stat label="Permits waiting" value={s?.permits_waiting ?? 0} tone={s?.permits_waiting ? 'amber' : undefined} />
          <Stat label="Permits active" value={s?.permits_active ?? 0} />
          <Stat label="Late requests" value={permits.filter((r) => r.late_request).length} tone={permits.some((r) => r.late_request) ? 'red' : undefined} />
        </Grid>
        <Muted>
          {makesPermits
            ? 'Request the work permits for each day’s planned work – and for any work not in the plan. Tomorrow’s permits go to the Assistant Engineer before 20:00 today; an AE approves each one.'
            : 'Work permits of the project, day by day – requested by the Assistant Engineers and the subcontractor supervisors, approved by an AE.'}
        </Muted>
        {makesPermits ? (
          <Row gap={6}>
            <Button small title="+ Permit to work" onPress={newPermit} />
          </Row>
        ) : null}
        <ByDay rows={permits} forms={forms} people={people} empty="No permits yet" sub={permitSub} />
      </View>
    );
  if (mode === 'tbt') {
    const late = tbts.filter((r) => r.tbt_late).length;
    return (
      <View style={{ gap: 8 }}>
        <Grid min={150} max={4}>
          <Stat label="Toolbox meetings today" value={tbts.filter((r) => slDate(r.starts_at) === today).length} />
          <Stat label="Held late (after 08:50)" value={late} tone={late ? 'red' : undefined} />
          <Stat label="All toolbox meetings" value={tbts.length} />
        </Grid>
        <Muted>Toolbox meeting at 08:30 every working day – held by the Assistant Engineers and the subcontractor supervisors (after checking in on site).</Muted>
        {me.role === 'assistant_engineer' ? (
          <Row gap={6}>
            <Button small title="+ Toolbox meeting" onPress={() => router.push({ pathname: '/execution/hse/tbt', params: { project: p.id } })} />
          </Row>
        ) : null}
        <ByDay rows={tbts} forms={forms} people={people} empty="No toolbox meetings yet" sub={tbtSub} />
      </View>
    );
  }
  const withPermits = mode === 'all';

  return (
    <Section title="HSE">
      <TestingBanner what={withPermits ? "HSE forms – checklists, permits, toolbox meetings, induction and training" : "HSE forms – equipment checklists, induction and training"} />
      <Grid min={150} max={6}>
        {withPermits ? <Stat label="Permits waiting" value={s?.permits_waiting ?? 0} tone={s?.permits_waiting ? 'amber' : undefined} onPress={() => setPart('permits')} /> : null}
        {withPermits ? <Stat label="Permits active" value={s?.permits_active ?? 0} onPress={() => setPart('permits')} /> : null}
        <Stat label="Checks due" value={s?.checks_due ?? 0} tone={s?.checks_due ? 'amber' : undefined} onPress={() => setPart('equipment')} />
        <Stat label="Out of use" value={s?.removed ?? 0} tone={s?.removed ? 'red' : undefined} onPress={() => setPart('equipment')} />
        <Stat label="Inducted" value={s?.inducted ?? 0} onPress={() => setPart('people')} />
        <Stat label="Training man-hours" value={s?.man_hours ?? 0} onPress={() => setPart('people')} />
      </Grid>
      <Row wrap gap={6} style={{ alignItems: 'center', marginVertical: 8 }}>
        <Muted>{`EHS Officer: ${ehs.length ? ehs.map((m) => people[m.user_id]?.full_name).join(', ') : 'any Assistant Engineer of the project'} · Site In-charge: Senior Electrical Engineer`}</Muted>
        {see ? <Button small variant="ghost" title="Change" onPress={setEhs} /> : null}
      </Row>
      <Segmented
        value={part}
        onChange={setPart}
        options={[
          { value: 'equipment', label: 'Equipment checks' },
          ...(withPermits ? [{ value: 'permits' as const, label: 'Permits', badge: s?.permits_waiting || undefined }] : []),
          // a subcontractor supervisor holds the toolbox meeting from the Planning tab
          ...(withPermits ? [{ value: 'tbt' as const, label: 'Toolbox meetings' }] : []),
          { value: 'people', label: 'Induction & training' },
          { value: 'reports', label: 'Incident reports' },
        ]}
      />
      <View style={{ marginTop: 8, gap: 8 }}>
        {part === 'equipment' ? (
          <>
            {canWork ? (
              <Row gap={6}>
                <Button small title="+ Equipment" onPress={addEquipment} />
              </Row>
            ) : null}
            {data?.equipment.length ? (
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.equipment.map((e) => {
                  const f = form(e.form_code);
                  const due = e.status === 'in_use' && (!e.next_due || e.next_due <= today);
                  const last = lastCheck(e);
                  return (
                    <ListRow
                      key={e.id}
                      wrapRight
                      highlight={e.status === 'removed' ? colors.red : due ? colors.amber : undefined}
                      title={`${e.name}${e.serial_no ? ` · ${e.serial_no}` : ''}`}
                      subtitle={`${f?.code ?? ''} ${formName(f)} · ${e.contractor ?? 'own'} · last check ${e.last_checked_at ? fmtDate(e.last_checked_at) : 'never'}${e.next_due ? ` · next ${fmtDate(e.next_due)}` : ''}`}
                      onPress={last ? () => router.push(`/execution/hse/form/${last.id}`) : undefined}
                      right={
                        <Row gap={6} style={{ alignItems: 'center' }}>
                          <Pill label={due ? (e.last_checked_at ? 'Check due' : 'First check due') : EQUIP_STATUS[e.status].label} tone={due ? colors.amber : EQUIP_STATUS[e.status].tone} />
                          {canWork && e.status !== 'off_site' ? <Button small title="Check" onPress={() => router.push({ pathname: '/execution/hse/check', params: { equipment: e.id } })} /> : null}
                        </Row>
                      }
                    />
                  );
                })}
              </Card>
            ) : (
              <Empty title="No equipment registered" hint="Add each machine, DB, power tool, extinguisher and first-aid box, then check it with its DIMO checklist." />
            )}
          </>
        ) : null}
        {part === 'permits' && withPermits ? permitList : null}
        {part === 'tbt' && withPermits ? <ByDay rows={tbts} forms={forms} people={people} empty="No toolbox meetings yet" sub={tbtSub} /> : null}
        {part === 'people' ? (
          <>
            <Row gap={6} wrap>
              {canWork && (me.role === 'assistant_engineer' || see) ? <Button small title="+ Induct a person" onPress={induct} /> : null}
              {canWork && (me.role === 'assistant_engineer' || see) ? (
                <Button small variant="secondary" title="+ Training session" onPress={() => router.push({ pathname: '/execution/hse/training', params: { project: p.id } })} />
              ) : null}
              {data?.inductions.length ? (
                <Button
                  small
                  variant="secondary"
                  title="Induction register PDF"
                  onPress={() => {
                    void dialog.run(() => fillInductionRegister([...data.inductions].reverse(), { project: p, name: (id) => (id ? people[id]?.full_name ?? '' : '') }, p.site_address ?? ''));
                  }}
                />
              ) : null}
            </Row>
            <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 4 }}>{`Induction register (${data?.inductions.length ?? 0})`}</Text>
            {data?.inductions.length ? (
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.inductions.map((x) => (
                  <ListRow key={x.id} title={`${x.name} · ${x.nic}`} subtitle={`${x.company ?? '—'} · ${fmtDate(x.inducted_on)} · by ${people[x.instructor_id ?? '']?.full_name ?? ''}${x.remarks ? ` · ${x.remarks}` : ''}`} />
                ))}
              </Card>
            ) : (
              <Empty title="Nobody inducted yet" />
            )}
            <Text style={{ fontWeight: '700', color: colors.ink, marginTop: 4 }}>{`Training sessions (${trainings.length})`}</Text>
            <RecordList rows={trainings} forms={forms} people={people} empty="No training recorded" sub={(r) => `${String(r.header.title ?? '')} · ${r.participants.length} participants · ${String(r.header.man_hours ?? 0)} man-hours`} />
          </>
        ) : null}
        {part === 'reports' ? (
          <>
            {me.role !== 'gm' ? (
              <Row>
                <Button small title="+ Report" onPress={() => router.push({ pathname: '/execution/hse/new', params: { project: p.id } })} />
              </Row>
            ) : null}
            <HseRows rows={data?.reports ?? []} />
          </>
        ) : null}
      </View>
    </Section>
  );
}

/** The Sri Lanka date of a timestamp */
const slDate = (ts: string | null) => (ts ? new Date(new Date(ts).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');

/** Records day by day (newest day first) – the daily track of permits / toolbox meetings */
function ByDay({ rows, forms, people, empty, sub }: { rows: HseRecord[]; forms: HseForm[]; people: Record<string, { full_name: string } | undefined>; empty: string; sub: (r: HseRecord) => string }) {
  if (!rows.length) return <Empty title={empty} />;
  const days = [...new Set(rows.map((r) => slDate(r.starts_at ?? r.created_at)))].sort().reverse();
  return (
    <View style={{ gap: 8 }}>
      {days.map((d) => {
        const list = rows.filter((r) => slDate(r.starts_at ?? r.created_at) === d).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
        return (
          <View key={d} style={{ gap: 4 }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>{`${fmtDate(d)}${d === todayISO() ? ' · today' : ''} · ${list.length}`}</Text>
            <RecordList rows={list} forms={forms} people={people} empty={empty} sub={sub} />
          </View>
        );
      })}
    </View>
  );
}

function RecordList({ rows, forms, people, empty, sub }: { rows: HseRecord[]; forms: HseForm[]; people: Record<string, { full_name: string } | undefined>; empty: string; sub: (r: HseRecord) => string }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((r) => {
        const f = forms.find((x) => x.code === r.form_code);
        const permit = f?.kind === 'permit';
        const st = permit ? PERMIT_STATUS[r.status] : r.mgr_by ? { label: 'Signed off', tone: colors.green } : { label: 'Recorded', tone: colors.blue };
        return (
          <ListRow
            key={r.id}
            wrapRight
            onPress={() => router.push(`/execution/hse/form/${r.id}`)}
            title={`${r.code} · ${formName(f)}`}
            subtitle={`${sub(r)} · ${people[r.created_by]?.full_name ?? ''}`}
            highlight={permit && r.status === 'submitted' ? colors.amber : undefined}
            right={
              <Row gap={4}>
                {permit && r.late_request ? <Pill label="Late request" tone={colors.red} /> : null}
                <Pill label={st.label} tone={st.tone} />
              </Row>
            }
          />
        );
      })}
    </Card>
  );
}
