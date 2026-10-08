import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, Empty, Grid, ListRow, Muted, Pill, Row, Section, Segmented, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { ROLE_LABELS } from '@/lib/roles';
import { supabase } from '@/lib/supabase';
import { idLabel, workerState, type Worker } from '@/lib/workers';
import { printWorkerList } from '@/lib/workersPdf';

const TONE: Record<string, string> = { 'To verify': colors.amber, 'Verified – to induct': colors.blue, Inducted: colors.green, 'Off site': colors.grey };

/** Site workers of the project: supervisors add their crew, Assistant Engineers verify against the ID photos and induct. */
export function WorkersTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const [show, setShow] = useState<'active' | 'verify' | 'off'>('active');
  const { data } = useLoad(async () => {
    const [w, ind] = await Promise.all([
      supabase.from('exec_workers').select('*').eq('exec_project_id', p.id).order('company').order('full_name'),
      supabase.from('hse_inductions').select('id, inducted_on').eq('exec_project_id', p.id),
    ]);
    return { workers: (w.data ?? []) as Worker[], inductions: (ind.data ?? []) as { id: string; inducted_on: string }[] };
  }, [p.id]);
  const all = data?.workers ?? [];
  const active = all.filter((w) => w.status === 'active');
  const toVerify = active.filter((w) => !w.verified_at || !w.induction_id);
  const list = show === 'active' ? active : show === 'verify' ? toVerify : all.filter((w) => w.status === 'off_site');
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
    await dialog.run(() => printWorkerList(p, r.who === 'all' ? all : active, { photos: r.ph === 'yes', inductedOn, by: `${me.full_name} – ${ROLE_LABELS[me.role]}` }));
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
      <Row wrap gap={6} style={{ marginVertical: 8, alignItems: 'center' }}>
        {canAdd ? <Button small title="+ Worker" onPress={() => router.push({ pathname: '/execution/worker/new', params: { project: p.id } })} /> : null}
        {all.length && me.role !== 'sub_supervisor' ? <Button small variant="secondary" title="Worker list PDF" onPress={pdf} /> : null}
        <Segmented value={show} onChange={setShow} options={[{ value: 'active', label: 'On site' }, { value: 'verify', label: 'To verify / induct', badge: toVerify.length || undefined }, { value: 'off', label: 'Off site' }]} />
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
            return (
              <ListRow
                key={w.id}
                wrapRight
                onPress={() => router.push(`/execution/worker/${w.id}`)}
                highlight={st === 'To verify' ? colors.amber : undefined}
                title={`${w.full_name}${w.trade ? ` · ${w.trade}` : ''}`}
                subtitle={`${w.company} · ${idLabel(w)} ${w.id_no} · ${w.police_station}${w.status === 'off_site' ? ` · off site ${fmtDate(w.off_site_on)}` : ''}`}
                right={<Pill label={st} tone={TONE[st]} />}
              />
            );
          })}
        </Card>
      ) : (
        <View>
          <Empty title={show === 'off' ? 'Nobody off site' : show === 'verify' ? 'Everyone is verified and inducted' : 'No workers yet'} />
        </View>
      )}
    </Section>
  );
}
