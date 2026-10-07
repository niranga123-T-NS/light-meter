import { router } from 'expo-router';
import { useState } from 'react';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ListRow, Muted, Notice, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecMember, ExecProject, Ncr, TestRecord } from '@/lib/execution';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const testTone = (t: TestRecord) => (t.result === 'fail' ? colors.red : t.status === 'verified' ? colors.green : colors.amber);

/** Inspection and test records (auto pass / fail), verification by the SEE, and NCRs to closure. */
export function QaTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [open, setOpen] = useState<string | null>(null);
  const { data, reload } = useLoad(async () => {
    const [t, n, m] = await Promise.all([
      supabase.from('test_records').select('*').eq('exec_project_id', p.id).order('performed_at', { ascending: false }),
      supabase.from('ncrs').select('*').eq('exec_project_id', p.id).order('raised_at', { ascending: false }),
      supabase.from('exec_members').select('*').eq('exec_project_id', p.id).eq('active', true),
    ]);
    return { tests: (t.data ?? []) as TestRecord[], ncrs: (n.data ?? []) as Ncr[], members: (m.data ?? []) as ExecMember[] };
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

  return (
    <>
      <Section
        title={`Tests (${tests.length})`}
        right={
          <Row gap={6}>
            {canRecord && p.status === 'active' ? <Button small title="+ Record test" onPress={() => router.push({ pathname: '/execution/test/new', params: { project: p.id } })} /> : null}
            <Button small variant="ghost" title="Instruments" onPress={() => router.push('/execution/instruments')} />
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
                title={`${t.code} · ${t.test_type} – ${t.system}`}
                subtitle={
                  <>
                    <Muted>{[people[t.performed_by]?.full_name, fmtDateTime(t.performed_at), t.witness ? `witness ${t.witness}` : null, t.note].filter(Boolean).join(' · ')}</Muted>
                    {open === t.id ? (
                      <>
                        {t.rows.map((r, i) => (
                          <Muted key={i} style={{ color: r.pass ? colors.ink : colors.red }}>
                            {`${r.pass ? '✓' : '✕'} ${r.param}: ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.min != null || r.max != null ? ` (limits ${r.min ?? '—'} – ${r.max ?? '—'})` : ''}`}
                          </Muted>
                        ))}
                        <Attachments entityType="test_record" entityId={t.id} kinds={['test_sheet']} title="Signed test sheet" canUpload={t.performed_by === me.id || isSee} />
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
