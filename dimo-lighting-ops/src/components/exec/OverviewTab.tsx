import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { Button, Card, colors, KeyValue, Muted, Notice, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { areaLabel, EXEC_AREAS, EXEC_STAGES, type ExecProject } from '@/lib/execution';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

/** Stage strip, project areas, site and dates. */
export function OverviewTab({ p, onTab }: { p: ExecProject; onTab: (t: string) => void }) {
  const me = useMe();
  const people = usePeople();
  const lead = me.role === 'senior_elec_engineer' || me.role === 'sm_projects';
  const { data: st } = useLoad(async () => {
    const [m, g] = await Promise.all([
      supabase.from('exec_members').select('member_role').eq('exec_project_id', p.id).eq('active', true),
      supabase.from('exec_gates').select('gate').eq('exec_project_id', p.id).eq('status', 'pending'),
    ]);
    const roles = (m.data ?? []).map((x) => x.member_role as string);
    return { engineers: roles.filter((r) => r !== 'sub_supervisor').length, supervisors: roles.filter((r) => r === 'sub_supervisor').length, gatePending: (g.data ?? []).length > 0 };
  }, [p.id, p.stage]);
  const step = (done: boolean, text: string, action?: { title: string; onPress: () => void }) => (
    <Row key={text} wrap gap={8} style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
      <Text style={{ flex: 1, minWidth: 200, color: done ? colors.green : colors.ink }}>{`${done ? '✓' : '○'} ${text}`}</Text>
      {action ? <Button small variant={done ? 'secondary' : 'primary'} title={action.title} onPress={action.onPress} /> : null}
    </Row>
  );
  const families = [...new Set(p.areas.map((a) => EXEC_AREAS.find((x) => x.value === a)?.family ?? ''))];
  return (
    <>
      {!p.areas.length && p.status === 'active' ? (
        <Notice tone={colors.amber}>
          {me.role === 'senior_elec_engineer' ? 'Set the project areas, site and dates – the checks, tests and handover lists follow the areas.' : 'The Senior Electrical Engineer still has to set the project areas.'}
        </Notice>
      ) : null}
      {lead && p.status === 'active' && st ? (
        <Section title="Next steps">
          <Card>
            {step(p.areas.length > 0, 'Project areas, site and dates set', me.role === 'senior_elec_engineer' || me.role === 'sm_projects' ? { title: 'Edit', onPress: () => router.push({ pathname: '/execution/start', params: { id: p.id } }) } : undefined)}
            {step(st.engineers > 0, st.engineers ? `${st.engineers} engineer(s) / trainee(s) on the project` : 'Add the Assistant Engineers (and trainees)', { title: '+ Add engineer / trainee', onPress: () => onTab('team') })}
            {step(st.supervisors > 0, st.supervisors ? `${st.supervisors} subcontractor supervisor(s)` : 'Nominate the subcontractor supervisor (if any) – SM Projects approves', { title: 'Nominate', onPress: () => onTab('team') })}
            {step(st.gatePending, st.gatePending ? `Gate ${p.stage} waiting for SM Projects` : `Request gate ${p.stage} to move to stage ${Math.min(6, p.stage + 1)}`, {
              title: me.role === 'sm_projects' && st.gatePending ? 'Decide the gate' : 'Open stage gate',
              onPress: () => onTab('handover'),
            })}
          </Card>
        </Section>
      ) : null}
      <Section title="Stage">
        <Card>
          <Row wrap gap={6}>
            {EXEC_STAGES.map((s, i) => (
              <View
                key={s}
                style={{
                  flexGrow: 1,
                  minWidth: 110,
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: i + 1 === p.stage ? colors.brand : colors.line,
                  backgroundColor: i + 1 < p.stage ? colors.soft : i + 1 === p.stage ? '#FDECEE' : '#fff',
                }}
              >
                <Text style={{ fontSize: 11, color: colors.muted }}>{`Stage ${i + 1}`}</Text>
                <Text style={{ fontWeight: i + 1 === p.stage ? '700' : '500', color: colors.ink }}>{s}</Text>
              </View>
            ))}
          </Row>
          <Muted>Stage gates are requested by the SEE and approved by SM Projects in the Handover tab.</Muted>
        </Card>
      </Section>
      <Section title="Project">
        <Card>
          {p.client_name ? <KeyValue label="Client" value={p.client_name} /> : null}
          {p.contract_value_lkr && (me.role === 'senior_elec_engineer' || me.role === 'sm_projects' || me.role === 'gm' || me.role === 'operations_exec') ? (
            <KeyValue label="Contract value" value={fmtMoney(p.contract_value_lkr, 'LKR')} />
          ) : null}
          {p.contract_ref ? <KeyValue label="Contract / PO" value={p.contract_ref} /> : null}
          {p.legacy ? <KeyValue label="Source" value="Won before the system (entered by the SEE)" /> : null}
          <KeyValue label="Project areas" value={p.areas.length ? p.areas.map(areaLabel).join(' · ') : '—'} />
          <KeyValue label="Families" value={families.join(' · ')} />
          <KeyValue label="Senior Electrical Engineer" value={people[p.see_id ?? '']?.full_name ?? '—'} />
          <KeyValue label="Site" value={p.site_address ?? '—'} />
          <KeyValue label="Dates" value={`${fmtDate(p.start_date)} → ${fmtDate(p.end_date)}`} />
          {(me.role === 'senior_elec_engineer' || me.role === 'sm_projects') && p.status === 'active' ? (
            <Row>
              <Button small variant="secondary" title="Edit areas, site and dates" onPress={() => router.push({ pathname: '/execution/start', params: { id: p.id } })} />
            </Row>
          ) : null}
        </Card>
      </Section>
      {p.request_id && me.role !== 'sub_supervisor' ? <Attachments entityType="exec_request" entityId={p.request_id} kinds={['handover_doc']} title="Contract documents" canUpload={false} /> : null}
    </>
  );
}
