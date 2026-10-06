import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Attachments } from '@/components/Attachments';
import { Button, Card, colors, KeyValue, Muted, Notice, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { areaLabel, EXEC_AREAS, EXEC_STAGES, type ExecProject } from '@/lib/execution';
import { fmtDate, fmtMoney } from '@/lib/format';
import { usePeople } from '@/lib/hooks';

/** Stage strip, project areas, site and dates. */
export function OverviewTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const people = usePeople();
  const families = [...new Set(p.areas.map((a) => EXEC_AREAS.find((x) => x.value === a)?.family ?? ''))];
  return (
    <>
      {!p.areas.length && p.status === 'active' ? (
        <Notice tone={colors.amber}>
          {me.role === 'senior_elec_engineer' ? 'Set the project areas, site and dates – the checks, tests and handover lists follow the areas.' : 'The Senior Electrical Engineer still has to set the project areas.'}
        </Notice>
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
