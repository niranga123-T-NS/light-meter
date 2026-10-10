import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { InstrumentsView } from '@/components/InstrumentsView';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ListRow, Muted, Notice, Pill, Row, Section, Segmented } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { areaLabel, type ExecMember, type ExecProject, type Ncr, type TestRecord } from '@/lib/execution';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { QA_STATUS, type QaReport } from '@/lib/qaReport';
import { rpc, supabase } from '@/lib/supabase';
import { listAttachments } from '@/lib/files';
import type { Attachment } from '@/lib/types';
import { TestDocs } from './TestDocs';

const testTone = (t: TestRecord) => (t.result === 'fail' ? colors.red : t.status === 'verified' ? colors.green : colors.amber);

/** The QA tab: inspection and test records and NCRs, and the testing / site instruments for the project. */
export function QaTab({ p }: { p: ExecProject }) {
  const [part, setPart] = useState<'qa' | 'instruments'>('qa');
  return (
    <View style={{ gap: 8 }}>
      <Segmented value={part} onChange={setPart} options={[{ value: 'qa', label: 'Tests & NCRs' }, { value: 'instruments', label: 'Instruments' }]} />
      {part === 'qa' ? <QaRecords p={p} onInstruments={() => setPart('instruments')} /> : <InstrumentsView project={p} />}
    </View>
  );
}

/** Inspection and test records (auto pass / fail), verification by the SEE, and NCRs to closure. */
function QaRecords({ p, onInstruments }: { p: ExecProject; onInstruments: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [open, setOpen] = useState<string | null>(null);
  const { data, reload } = useLoad(async () => {
    const [t, n, m, q] = await Promise.all([
      supabase.from('test_records').select('*').eq('exec_project_id', p.id).order('performed_at', { ascending: false }),
      supabase.from('ncrs').select('*').eq('exec_project_id', p.id).order('raised_at', { ascending: false }),
      supabase.from('exec_members').select('*').eq('exec_project_id', p.id).eq('active', true),
      supabase.from('qa_reports').select('id, code, title, status, version, created_by, updated_at, submitted_at, decided_at, decided_by').eq('exec_project_id', p.id).order('updated_at', { ascending: false }),
    ]);
    const tests = (t.data ?? []) as TestRecord[];
    const testFiles = await listAttachments('test_record', tests.map((x) => x.id));
    return { testFiles: testFiles as Attachment[], tests, ncrs: (n.data ?? []) as Ncr[], members: (m.data ?? []) as ExecMember[], reports: (q.data ?? []) as QaReport[] };
  }, [p.id]);
  const isSee = me.role === 'senior_elec_engineer';
  const canRecord = isSee || me.role === 'assistant_engineer';
  const tests = data?.tests ?? [];
  const ncrs = data?.ncrs ?? [];
  const openNcrs = ncrs.filter((n) => n.status === 'open');

  const verify = async (t: TestRecord, ok: boolean) => {
    const res = await dialog.prompt({ title: ok ? 'Verify test record' : 'Return test record', message: `${t.code} · ${t.system}`, fields: [{ key: 'n', label: ok ? 'Note' : 'What is wrong', type: 'multiline', required: !ok }], confirmLabel: ok ? 'Verify' : 'Return' });
    if (res) await dialog.run(async () => { await rpc('verify_test', { p_id: t.id, p_ok: ok, p_note: res.n || null }); await reload(); }, ok ? 'Verified' : 'Returned');
  };
  const raiseNcr = async () => {
    const res = await dialog.prompt({
      title: 'Non-conformance (NCR)',
      fields: [
        { key: 'description', label: 'Description', type: 'multiline', required: true },
        { key: 'severity', label: 'Severity', type: 'select', required: true, initial: 'major', options: [
          { value: 'minor', label: 'Minor' },
          { value: 'major', label: 'Major' },
          { value: 'critical', label: 'Critical' },
        ] },
        { key: 'owner_id', label: 'Owner', type: 'select', required: true, initial: me.id, options: [
          { value: me.id, label: `${me.full_name} (me)` },
          ...(data?.members ?? []).filter((m) => m.user_id !== me.id).map((m) => ({ value: m.user_id, label: people[m.user_id]?.full_name ?? '—' })),
        ] },
        { key: 'due_date', label: 'Due', type: 'date', required: true, initial: todayISO() },
      ],
      confirmLabel: 'Raise',
    });
    if (res) await dialog.run(async () => { await rpc('raise_ncr', { p_exec: p.id, p: res }); await reload(); }, 'NCR raised');
  };
  const closeNcr = async (n: Ncr) => {
    const res = await dialog.prompt({
      title: `Close ${n.code}`,
      message: 'Close only after re-inspection.',
      fields: [
        { key: 'r', label: 'Root cause', type: 'multiline', required: true },
        { key: 'a', label: 'Corrective action', type: 'multiline', required: true },
        { key: 'n', label: 'Re-inspection note', type: 'multiline' },
      ],
      confirmLabel: 'Close',
    });
    if (res) await dialog.run(async () => { await rpc('close_ncr', { p_id: n.id, p_root: res.r, p_action: res.a, p_note: res.n || null }); await reload(); }, 'Closed');
  };

  const reports = data?.reports ?? [];
  const drafts = reports.filter((x) => x.status === 'draft' || x.status === 'returned');
  const issued = reports.filter((x) => x.status === 'submitted' || x.status === 'approved');
  const reportRow = (x: QaReport) => (
    <ListRow
      key={x.id}
      wrapRight
      onPress={() => router.push(`/execution/qa-report/${x.id}`)}
      highlight={x.status === 'returned' ? colors.red : isSee && x.status === 'submitted' ? colors.amber : undefined}
      title={`${x.code} · ${x.title}`}
      subtitle={[
        people[x.created_by]?.full_name,
        `v${x.version}`,
        x.status === 'approved' ? `approved ${fmtDate(x.decided_at)} by ${people[x.decided_by ?? '']?.full_name ?? ''}` : x.status === 'submitted' ? `submitted ${fmtDate(x.submitted_at)}` : `saved ${fmtDateTime(x.updated_at)}`,
      ]
        .filter(Boolean)
        .join(' · ')}
      right={<Pill label={QA_STATUS[x.status]} tone={x.status === 'approved' ? colors.green : x.status === 'returned' ? colors.red : x.status === 'submitted' ? colors.amber : colors.grey} solid={x.status === 'approved'} />}
    />
  );

  return (
    <>
      <Section
        title={`Test reports (${reports.length})`}
        right={canRecord && p.status === 'active' ? <Button small title="+ New test report" onPress={() => router.push({ pathname: '/execution/qa-report/[id]', params: { id: 'new', project: p.id } })} /> : null}
      >
        <Muted style={{ marginBottom: 6 }}>Write the report like a Word document on A4 pages – project header and DIMO logo on every page, tables, photos and readings. Save drafts, submit to the SEE; approved reports are published as PDF.</Muted>
        <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 4 }}>{`My drafts and returned (${drafts.length})`}</Text>
        {drafts.length ? <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 8 }}>{drafts.map(reportRow)}</Card> : <Muted style={{ marginBottom: 8 }}>No drafts</Muted>}
        <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: 4 }}>{`Submitted and published (${issued.length})`}</Text>
        {issued.length ? <Card style={{ padding: 0, overflow: 'hidden' }}>{issued.map(reportRow)}</Card> : <Muted>Nothing submitted yet</Muted>}
      </Section>
      <Section
        title={`Tests (${tests.length})`}
        right={
          <Row gap={6}>
            {canRecord && p.status === 'active' ? <Button small title="+ Record test" onPress={() => router.push({ pathname: '/execution/test/new', params: { project: p.id } })} /> : null}
            <Button small variant="ghost" title="Instruments" onPress={onInstruments} />
          </Row>
        }
      >
        {tests.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {tests.map((t) => (
              <ListRow
                key={t.id}
                wrapRight
                onPress={() => setOpen(open === t.id ? null : t.id)}
                highlight={t.result === 'fail' ? colors.red : undefined}
                title={`${t.code} · ${t.test_type} – ${t.system}${(data?.testFiles ?? []).some((f) => f.entity_id === t.id) ? ` · 📎 ${(data?.testFiles ?? []).filter((f) => f.entity_id === t.id).length}` : ''}`}
                subtitle={
                  <>
                    <Muted>{[t.area ? areaLabel(t.area) : null, people[t.performed_by]?.full_name, fmtDateTime(t.performed_at), t.witness ? `witness ${t.witness}` : null, t.uncalibrated ? '⚠ uncalibrated instrument' : null, t.note].filter(Boolean).join(' · ')}</Muted>
                    {open === t.id ? (
                      <>
                        {t.rows.map((r, i) => (
                          <Muted key={i} style={{ color: r.pass ? colors.ink : colors.red }}>
                            {`${r.pass ? '✓' : '✕'} ${r.param}: ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.min != null || r.max != null ? ` (limits ${r.min ?? '—'} – ${r.max ?? '—'})` : ''}`}
                          </Muted>
                        ))}
                        <TestDocs testId={t.id} files={(data?.testFiles ?? []).filter((f) => f.entity_id === t.id)} canUpload={(t.performed_by === me.id || isSee) && t.status !== 'verified'} onChange={reload} />
                        {isSee && t.status === 'submitted' ? (
                          <Row gap={6}>
                            <Button small title="Verify" onPress={() => verify(t, true)} />
                            <Button small variant="secondary" title="Return" onPress={() => verify(t, false)} />
                          </Row>
                        ) : null}
                      </>
                    ) : null}
                  </>
                }
                right={
                  <Row gap={4}>
                    <Pill label={t.result === 'pass' ? 'Pass' : 'Fail'} tone={t.result === 'pass' ? colors.green : colors.red} solid />
                    <Pill label={t.status === 'submitted' ? 'To verify' : t.status === 'verified' ? 'Verified' : 'Returned'} tone={testTone(t)} />
                  </Row>
                }
              />
            ))}
          </Card>
        ) : (
          <Empty title="No test records yet" hint="Insulation resistance, earth continuity, lux levels, DALI addressing…" />
        )}
      </Section>
      <Section title={`NCRs (${openNcrs.length} open)`} right={canRecord || me.role === 'sm_projects' ? <Button small variant="secondary" title="+ NCR" onPress={raiseNcr} /> : null}>
        {openNcrs.some((n) => n.severity === 'critical') ? <Notice tone={colors.red}>An NCR is open – the handover to the client is not approved until it is closed.</Notice> : null}
        {ncrs.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {ncrs.map((n) => (
              <ListRow
                key={n.id}
                wrapRight
                highlight={n.status === 'open' && n.due_date && n.due_date < todayISO() ? colors.red : undefined}
                title={`${n.code} – ${n.description}`}
                subtitle={[
                  n.owner_id ? people[n.owner_id]?.full_name : null,
                  n.due_date ? `due ${fmtDate(n.due_date)}` : null,
                  n.root_cause ? `root cause: ${n.root_cause}` : null,
                  n.corrective_action ? `action: ${n.corrective_action}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  <Row gap={4}>
                    <Pill label={n.severity} tone={n.severity === 'critical' ? colors.red : n.severity === 'major' ? colors.amber : colors.grey} />
                    <Pill label={n.status === 'open' ? 'Open' : 'Closed'} tone={n.status === 'open' ? colors.amber : colors.green} />
                    {isSee && n.status === 'open' ? <Button small title="Close" onPress={() => closeNcr(n)} /> : null}
                  </Row>
                }
              />
            ))}
          </Card>
        ) : (
          <Empty title="No NCRs" />
        )}
      </Section>
    </>
  );
}
