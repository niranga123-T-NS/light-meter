import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, Grid, ListRow, Muted, Pill, Row, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { addDaysISO, fmtDate, todayISO } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { printPoliceLetters } from '@/lib/policeLetter';
import { rpc, supabase } from '@/lib/supabase';
import { idLabel, POLICE_LABEL, policeState, workerState, type PoliceState, type Worker } from '@/lib/workers';
import { printWorkerList } from '@/lib/workersPdf';

const TONE: Record<string, string> = { 'To verify': colors.amber, 'Verified – to induct': colors.blue, Inducted: colors.green, 'Off site': colors.grey };
const PTONE: Record<PoliceState, string> = { not_required: colors.grey, flagged: colors.amber, blocked: colors.red, submitted: colors.blue, accepted: colors.green };
type PoliceSettings = Pick<ExecProject, 'police_required' | 'letter_sign_name' | 'letter_sign_designation' | 'letter_sign_phone'>;

/** Site workers of the project: supervisors add their crew, Assistant Engineers verify against the ID photos and induct. */
export function WorkersTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const [show, setShow] = useState<'active' | 'verify' | 'police' | 'off'>('active');
  const { data, reload } = useLoad(async () => {
    const [w, ind, pr] = await Promise.all([
      supabase.from('exec_workers').select('*').eq('exec_project_id', p.id).order('company').order('full_name'),
      supabase.from('hse_inductions').select('id, inducted_on').eq('exec_project_id', p.id),
      supabase.from('exec_projects').select('police_required, letter_sign_name, letter_sign_designation, letter_sign_phone').eq('id', p.id).single(),
    ]);
    return { workers: (w.data ?? []) as Worker[], inductions: (ind.data ?? []) as { id: string; inducted_on: string }[], police: (pr.data ?? {}) as PoliceSettings, loadedAt: Date.now() };
  }, [p.id]);
  const all = data?.workers ?? [];
  const active = all.filter((w) => w.status === 'active');
  const toVerify = active.filter((w) => !w.verified_at || !w.induction_id);
  const police = data?.police ?? {};
  const pst = (w: Worker) => policeState(w, police.police_required, data?.loadedAt ?? 0);
  const needPolice = police.police_required ? active.filter((w) => pst(w) === 'flagged' || pst(w) === 'blocked') : [];
  const blocked = needPolice.filter((w) => pst(w) === 'blocked');
  const requested = active.filter((w) => w.police_status === 'letter_requested');
  const list = show === 'active' ? active : show === 'verify' ? toVerify : show === 'police' ? needPolice : all.filter((w) => w.status === 'off_site');
  const see = me.role === 'senior_elec_engineer' || me.role === 'sm_projects';
  const project = { ...p, ...police };

  const settings = async () => {
    const r = await dialog.prompt({
      title: 'Police reports and letters',
      message: 'When required, a worker without a submitted police report is flagged for 2 days, then blocked until it is submitted.',
      fields: [
        { key: 'req', label: 'Police reports for the workers', type: 'select', required: true, initial: police.police_required ? 'yes' : 'no', options: [{ value: 'no', label: 'Not required' }, { value: 'yes', label: 'Required' }] },
        { key: 'n', label: 'Letters signed by – name', required: true, initial: police.letter_sign_name ?? '' },
        { key: 'd', label: 'Designation', required: true, initial: police.letter_sign_designation ?? '' },
        { key: 't', label: 'Phone', initial: police.letter_sign_phone ?? '' },
      ],
      confirmLabel: 'Save',
    });
    if (r) await dialog.run(async () => { await rpc('set_police_settings', { p_exec: p.id, p: { police_required: r.req === 'yes', letter_sign_name: r.n, letter_sign_designation: r.d, letter_sign_phone: r.t } }); await reload(); }, 'Saved');
  };

  const release = async () => {
    const pending = active.filter((w) => w.police_status !== 'submitted' && w.police_status !== 'accepted');
    const r = await dialog.prompt({
      title: 'Release police report letters',
      message: `Numbered letters addressed to each worker, signed by ${police.letter_sign_name ?? '—'}. Enter how long the letters are valid.`,
      fields: [
        { key: 'w', label: 'Workers', type: 'multiselect', required: true, initial: requested.map((w) => w.id).join(','), options: pending.map((w) => ({ value: w.id, label: `${w.full_name} · ${w.company}${w.police_status === 'letter_requested' ? ' · requested' : ''}` })) },
        { key: 'v', label: 'Valid until', type: 'date', required: true, initial: addDaysISO(todayISO(), 30) },
      ],
      confirmLabel: 'Release',
    });
    if (!r) return;
    const ids = r.w.split(',').filter(Boolean);
    await dialog.run(async () => {
      await rpc('issue_police_letters', { p_workers: ids, p_valid_until: r.v });
      const { data: fresh } = await supabase.from('exec_workers').select('*').in('id', ids).order('full_name');
      await reload();
      await printPoliceLetters(project, (fresh ?? []) as Worker[]);
    }, 'Letters released');
  };
  const companies = [...new Set(active.map((w) => w.company))];
  const inductedOn = Object.fromEntries(all.filter((w) => w.induction_id).map((w) => [w.id, data?.inductions.find((x) => x.id === w.induction_id)?.inducted_on ?? '']));
  const canAdd = me.role === 'sub_supervisor' || me.role === 'assistant_engineer' || me.role === 'senior_elec_engineer';

  const pdf = async () => {
    const r = await dialog.prompt({
      title: 'Worker list PDF',
      message: 'Confidential – personal data. For site security, the main contractor or police registration.',
      fields: [
        { key: 'who', label: 'Workers', type: 'select', required: true, initial: 'active', options: [{ value: 'active', label: `On site now (${active.length})` }, { value: 'all', label: `Everyone incl. off site (${all.length})` }] },
        { key: 'ph', label: 'Include both sides of the NIC / passport', type: 'select', initial: 'no', options: [{ value: 'no', label: 'No – list only' }, { value: 'yes', label: 'Yes – with ID photos' }] },
      ],
      confirmLabel: 'Create PDF',
    });
    if (!r) return;
    await dialog.run(() => printWorkerList(p, r.who === 'all' ? all : active, { photos: r.ph === 'yes', inductedOn, by: `${me.full_name} – ${ROLE_LABELS[me.role]}`, police: police.police_required ? (w) => (w.police_status === 'accepted' ? `Accepted ${fmtDate(w.police_decided_at)}` : w.police_status === 'submitted' ? `Submitted ${fmtDate(w.police_submitted_at)}` : POLICE_LABEL[pst(w)]) : undefined }));
  };

  return (
    <Section title="Site workers">
      <TestingBanner what="Site workers register" />
      <Grid min={160} max={4}>
        <Stat label="On site" value={active.length} />
        <Stat label="To verify / induct" value={toVerify.length} tone={toVerify.length ? 'amber' : undefined} onPress={() => setShow('verify')} />
        <Stat label="Companies" value={companies.length} />
        <Stat label="Off site" value={all.length - active.length} onPress={() => setShow('off')} />
      </Grid>
      <Card style={{ gap: 4, marginTop: 8, borderLeftWidth: 4, borderLeftColor: police.police_required ? (blocked.length ? colors.red : colors.amber) : colors.line }}>
        <Row wrap gap={8} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Muted style={{ flex: 1, minWidth: 220 }}>
            {police.police_required
              ? `Police reports required · ${needPolice.length} still due${blocked.length ? ` · ${blocked.length} blocked` : ''}${requested.length ? ` · ${requested.length} letters requested` : ''}`
              : 'Police reports not required on this project'}
            {police.letter_sign_name ? ` · letters signed by ${police.letter_sign_name}${police.letter_sign_designation ? `, ${police.letter_sign_designation}` : ''}` : ' · letter signatory not set'}
          </Muted>
          <Row gap={6} wrap>
            {see && active.length ? <Button small title={requested.length ? `Release letters (${requested.length} requested)` : 'Release letters'} onPress={release} /> : null}
            {see ? <Button small variant="secondary" title="Settings" onPress={settings} /> : null}
          </Row>
        </Row>
      </Card>
      <Row wrap gap={6} style={{ marginVertical: 8, alignItems: 'center' }}>
        {canAdd ? <Button small title="+ Worker" onPress={() => router.push({ pathname: '/execution/worker/new', params: { project: p.id } })} /> : null}
        {all.length && me.role !== 'sub_supervisor' ? <Button small variant="secondary" title="Worker list PDF" onPress={pdf} /> : null}
        <Segmented value={show} onChange={setShow} options={[{ value: 'active', label: 'On site' }, { value: 'verify', label: 'To verify / induct', badge: toVerify.length || undefined }, ...(police.police_required ? [{ value: 'police' as const, label: 'Police report due', badge: needPolice.length || undefined }] : []), { value: 'off', label: 'Off site' }]} />
      </Row>
      <Muted style={{ marginBottom: 6 }}>
        {me.role === 'sub_supervisor'
          ? 'Add each of your workers with both sides of their NIC / passport. An Assistant Engineer checks the ID and gives the HSE induction before they start.'
          : 'Supervisors add their own crew; add DIMO labour and workers of a subcontractor without a supervisor here. Verify each against the ID photos, then induct.'}
      </Muted>
      {list.length ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {list.map((w) => {
            const st = workerState(w);
            const ps = pst(w);
            return (
              <ListRow
                key={w.id}
                wrapRight
                onPress={() => router.push(`/execution/worker/${w.id}`)}
                highlight={ps === 'blocked' ? colors.red : st === 'To verify' ? colors.amber : undefined}
                title={`${w.full_name}${w.trade ? ` · ${w.trade}` : ''}`}
                subtitle={`${w.company} · ${idLabel(w)} ${w.id_no} · ${w.police_station}${w.status === 'off_site' ? ` · off site ${fmtDate(w.off_site_on)}` : ''}`}
                right={
                  <Row gap={4} wrap style={{ justifyContent: 'flex-end' }}>
                    {ps !== 'not_required' && w.status === 'active' ? <Pill label={ps === 'flagged' && w.police_due_at ? `Police report due ${fmtDate(w.police_due_at)}` : POLICE_LABEL[ps]} tone={PTONE[ps]} solid={ps === 'blocked'} /> : null}
                    <Pill label={st} tone={TONE[st]} />
                  </Row>
                }
              />
            );
          })}
        </Card>
      ) : (
        <View>
          <Empty title={show === 'off' ? 'Nobody off site' : show === 'verify' ? 'Everyone is verified and inducted' : show === 'police' ? 'Every worker has a police report' : 'No workers yet'} />
        </View>
      )}
    </Section>
  );
}
