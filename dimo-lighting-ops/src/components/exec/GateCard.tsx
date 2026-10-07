import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { Button, Card, Chip, colors, Muted, Notice, Row } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CHECKPOINTS, GATE_CHECKLIST, type ExecGate, type ExecProject, type GateCheck } from '@/lib/execution';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

function Checks({ checks }: { checks: GateCheck[] }) {
  if (!checks.length) return null;
  return (
    <>
      {checks.map((c) => (
        <Muted key={c.check} style={{ color: c.ok ? colors.green : colors.red }}>{`${c.ok ? '✓' : '✕'} ${c.check}${c.ok ? '' : ` – ${c.detail}`}`}</Muted>
      ))}
    </>
  );
}

/**
 * Handover to the client (gate 2) or project closure (gate 3): the SEE requests it with the confirmations, the app checks the open
 * items, SM Projects approves (an override needs the reason). Shows the decision history for that step.
 */
export function GateCard({ p, gate, onChange }: { p: ExecProject; gate: 2 | 3; onChange: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [tick, setTick] = useState<Record<string, boolean>>({});
  const current = p.status === 'active' && p.stage === gate;
  const { data, reload } = useLoad(async () => {
    const [g, pv] = await Promise.all([
      supabase.from('exec_gates').select('*').eq('exec_project_id', p.id).eq('gate', gate).eq('legacy', false).order('requested_at', { ascending: false }),
      current ? rpc<{ gate: number; checks: GateCheck[] }>('preview_gate', { p_exec: p.id }).catch(() => null) : Promise.resolve(null),
    ]);
    return { gates: (g.data ?? []) as (ExecGate & { event_date?: string | null })[], preview: pv };
  }, [p.id, p.stage, p.status, gate]);
  const name = CHECKPOINTS[gate - 1];
  const list = GATE_CHECKLIST[gate] ?? [];
  const pending = data?.gates.find((g) => g.status === 'pending');
  const done = data?.gates.find((g) => g.status === 'approved');
  const refresh = async () => {
    await reload();
    onChange();
  };
  const request = async () => {
    const res = await dialog.prompt({
      title: name,
      message: 'SM Projects approves. Open items shown in red need an override reason from SM Projects.',
      fields: [
        ...(gate === 2 ? [{ key: 'd', label: 'Handed over to the client on', type: 'date' as const, required: true, initial: todayISO() }] : []),
        { key: 'n', label: 'Note to SM Projects', type: 'multiline' as const },
      ],
      confirmLabel: 'Send to SM Projects',
    });
    if (res) await dialog.run(async () => { await rpc('request_gate', { p_exec: p.id, p_checklist: tick, p_note: res.n || null, p_date: res.d || null }); setTick({}); await refresh(); }, 'Sent to SM Projects');
  };
  const decide = async (g: ExecGate, ok: boolean) => {
    const failing = (data?.preview?.checks ?? g.checks).filter((c) => !c.ok).length;
    const res = await dialog.prompt({
      title: ok ? `Approve – ${name}` : `Do not approve – ${name}`,
      message: ok && failing ? `${failing} check(s) are not met – approving is an override and needs the reason.` : undefined,
      fields: [{ key: 'n', label: ok ? (failing ? 'Reason for the override' : 'Note') : 'Reason', type: 'multiline', required: !ok || failing > 0 }],
      confirmLabel: ok ? 'Approve' : 'Do not approve',
      danger: !ok,
    });
    if (res) await dialog.run(async () => { await rpc('decide_gate', { p_id: g.id, p_approve: ok, p_note: res.n || null }); await refresh(); }, ok ? 'Approved' : 'Returned to the SEE');
  };
  if (!data) return null;
  return (
    <Card>
      {done ? (
        <Notice tone={colors.green}>
          {gate === 2
            ? `Handed over to the client${done.event_date ? ` on ${fmtDate(done.event_date)}` : ''} – defects liability period running`
            : 'Project closed'}
          {done.override ? ' (override)' : ''}
        </Notice>
      ) : pending ? (
        <>
          <Notice tone={colors.amber}>{`Waiting for SM Projects · requested ${fmtDateTime(pending.requested_at)} by ${people[pending.requested_by]?.full_name ?? ''}${pending.event_date ? ` · handed over ${fmtDate(pending.event_date)}` : ''}`}</Notice>
          {pending.note ? <Muted>{pending.note}</Muted> : null}
          {Object.keys(pending.checklist).length ? <Muted>{`Confirmed: ${Object.entries(pending.checklist).filter(([, v]) => v).map(([k]) => k).join(' · ') || '—'}`}</Muted> : null}
          <Checks checks={data.preview?.checks ?? pending.checks} />
          {me.role === 'sm_projects' ? (
            <Row gap={6} style={{ marginTop: 6 }}>
              <Button title="Approve" onPress={() => decide(pending, true)} />
              <Button variant="secondary" title="Do not approve" onPress={() => decide(pending, false)} />
            </Row>
          ) : null}
        </>
      ) : current ? (
        <>
          <Checks checks={data.preview?.checks ?? []} />
          {me.role === 'senior_elec_engineer' ? (
            <>
              <Muted>Confirm:</Muted>
              <Row wrap gap={6} style={{ marginTop: 4 }}>
                {list.map((x) => (
                  <Chip key={x} label={`${tick[x] ? '✓ ' : ''}${x}`} on={!!tick[x]} onPress={() => setTick((s) => ({ ...s, [x]: !s[x] }))} />
                ))}
              </Row>
              <Row style={{ marginTop: 6 }}>
                <Button title={gate === 2 ? 'Hand over to the client' : 'Close the project'} onPress={request} />
              </Row>
            </>
          ) : (
            <Muted>The Senior Electrical Engineer requests it; SM Projects approves.</Muted>
          )}
        </>
      ) : (
        <Muted>{gate === 2 ? 'When the works are complete and tested, hand the project over to the client here.' : 'After the defects liability period, close the project here.'}</Muted>
      )}
      {data.gates
        .filter((g) => g.status === 'rejected')
        .map((g) => (
          <Muted key={g.id}>{`Not approved · ${people[g.decided_by ?? '']?.full_name ?? ''} · ${fmtDateTime(g.decided_at)}${g.note ? ` · ${g.note}` : ''}`}</Muted>
        ))}
    </Card>
  );
}
