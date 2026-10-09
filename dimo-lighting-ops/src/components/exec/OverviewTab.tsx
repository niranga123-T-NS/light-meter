import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { Button, Card, colors, KeyValue, Muted, Notice, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { areaLabel, EXEC_AREAS, EXEC_STAGES, type ExecProject } from '@/lib/execution';
import { fmtDate, fmtMoney } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import { GateCard } from './GateCard';

/** Stage strip, project areas, site and dates. */
export function OverviewTab({ p, onTab, onChange }: { p: ExecProject; onTab: (t: string) => void; onChange?: () => void }) {
  const me = useMe();
  const people = usePeople();
  const lead = me.role === 'senior_elec_engineer' || me.role === 'sm_projects';
  const { data: st } = useLoad(async () => {
    const [m, g, pg, tf] = await Promise.all([
      supabase.from('exec_members').select('member_role').eq('exec_project_id', p.id).eq('active', true),
      supabase.from('exec_gates').select('gate').eq('exec_project_id', p.id).eq('status', 'pending'),
      supabase.from('exec_programmes').select('status, version').eq('exec_project_id', p.id).maybeSingle(),
      supabase.from('attachments').select('kind').eq('entity_type', 'exec_project').eq('entity_id', p.id).is('archived_at', null),
    ]);
    const roles = (m.data ?? []).map((x) => x.member_role as string);
    return { engineers: roles.filter((r) => r !== 'sub_supervisor').length, supervisors: roles.filter((r) => r === 'sub_supervisor').length, gatePending: (g.data ?? []).length > 0, programme: pg.data as { status: string; version: number } | null, formats: (tf.data ?? []).map((x) => x.kind as string) };
  }, [p.id, p.stage]);
  const [fmt, setFmt] = useState<string[] | null>(null);
  const fmtKinds = fmt ?? st?.formats ?? [];
  const fmtMissing = ['tpl_measurement', 'tpl_ipa'].filter((k) => !fmtKinds.includes(k)).map((k) => ({ tpl_measurement: 'Measurement', tpl_ipa: 'IPA' })[k]);
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
            {step(!fmtMissing.length, fmtMissing.length ? `Upload the subcontractor formats (below): ${fmtMissing.join(', ')}` : 'Subcontractor formats uploaded (Measurement · IPA)')}
            {step(
              !!st.programme?.version,
              !st.programme
                ? 'Build the programme – WBS, activities, links and resources (required before work starts)'
                : st.programme.status === 'submitted'
                  ? 'Programme waiting for SM Projects'
                  : st.programme.version
                    ? `Programme approved (baseline ${st.programme.version})${st.programme.status === 'draft' ? ' – revision in progress' : ''}`
                    : 'Complete the programme and submit it to SM Projects',
              { title: me.role === 'sm_projects' && st.programme?.status === 'submitted' ? 'Approve programme' : 'Open programme', onPress: () => onTab('programme') },
            )}
            {p.stage === 1
              ? step(false, 'Work starts when SM Projects approves the programme')
              : p.stage === 2
                ? step(st.gatePending, st.gatePending ? 'Handover to the client waiting for SM Projects' : 'When the works are complete – hand over to the client', {
                    title: me.role === 'sm_projects' && st.gatePending ? 'Decide' : 'Handover',
                    onPress: () => onTab('handover'),
                  })
                : step(st.gatePending, st.gatePending ? 'Project closure waiting for SM Projects' : 'After the defects liability period – close the project (below)')}
          </Card>
        </Section>
      ) : null}
      <Section title="Status">
        <Card>
          <Row wrap gap={6}>
            {[...EXEC_STAGES, 'Closed'].map((s, i) => {
              const at = p.status === 'closed' ? 4 : p.stage;
              return (
                <View
                  key={s}
                  style={{
                    flexGrow: 1,
                    minWidth: 110,
                    padding: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: i + 1 === at ? colors.brand : colors.line,
                    backgroundColor: i + 1 < at ? colors.soft : i + 1 === at ? '#FDECEE' : '#fff',
                  }}
                >
                  <Text style={{ fontWeight: i + 1 === at ? '700' : '500', color: colors.ink }}>{s}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{['until the programme is approved', 'until handover to the client', 'defects liability period', 'after SM Projects approves the closure'][i]}</Text>
                </View>
              );
            })}
          </Row>
          <Muted>Progress and invoicing follow the programme. The SEE hands over to the client (Handover tab) and closes the project after the DLP (below); SM Projects approves both.</Muted>
        </Card>
      </Section>
      {p.stage === 3 || p.status === 'closed' ? (
        <Section title="Close the project">
          <GateCard p={p} gate={3} onChange={onChange ?? (() => undefined)} />
        </Section>
      ) : null}
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
      {me.role === 'senior_elec_engineer' || me.role === 'sm_projects' || me.role === 'gm' ? (
        <Attachments
          entityType="exec_project"
          entityId={p.id}
          kinds={['tpl_measurement', 'tpl_ipa']}
          title="Subcontractor formats (Measurement · IPA)"
          canUpload={me.role === 'senior_elec_engineer' && p.status === 'active'}
          onChange={(f) => setFmt(f.map((x) => x.kind))}
        />
      ) : null}
      {p.request_id && me.role !== 'sub_supervisor' ? <Attachments entityType="exec_request" entityId={p.request_id} kinds={['handover_doc']} title="Contract documents" canUpload={false} /> : null}
    </>
  );
}
