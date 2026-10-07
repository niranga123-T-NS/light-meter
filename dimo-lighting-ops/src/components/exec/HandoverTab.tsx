import { useState } from 'react';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, Chip, colors, Empty, ListRow, Muted, Notice, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { CHECKPOINTS, EXEC_AREAS, EXEC_STAGES, GATE_CHECKLIST, type DossierItem, type ExecGate, type ExecProject, type GateCheck, type Snag } from '@/lib/execution';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const areaLabel = (a: string) => EXEC_AREAS.find((x) => x.value === a)?.label ?? a;

function Checks({ checks }: { checks: GateCheck[] }) {
  if (!checks.length) return <Muted>No data checks here – the checklist is confirmed by the Senior Electrical Engineer.</Muted>;
  return (
    <>
      {checks.map((c) => (
        <Muted key={c.check} style={{ color: c.ok ? colors.green : colors.red }}>{`${c.ok ? '✓' : '✕'} ${c.check}${c.ok ? '' : ` – ${c.detail}`}`}</Muted>
      ))}
    </>
  );
}

/** Stage gates (SEE requests, SM Projects approves with the live checks), snags with before / after photos, and the handover dossier per area. */
export function HandoverTab({ p, onChange }: { p: ExecProject; onChange: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [tick, setTick] = useState<Record<string, boolean>>({});
  const [openSnag, setOpenSnag] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const { data, reload } = useLoad(async () => {
    const [g, s, d, pv] = await Promise.all([
      supabase.from('exec_gates').select('*').eq('exec_project_id', p.id).order('requested_at', { ascending: false }),
      supabase.from('snags').select('*').eq('exec_project_id', p.id).order('raised_at', { ascending: false }),
      supabase.from('exec_dossier').select('*').eq('exec_project_id', p.id).order('area').order('item'),
      p.status === 'active' ? rpc<{ gate: number; checks: GateCheck[] }>('preview_gate', { p_exec: p.id }).catch(() => null) : Promise.resolve(null),
    ]);
    return { gates: (g.data ?? []) as ExecGate[], snags: (s.data ?? []) as Snag[], dossier: (d.data ?? []) as DossierItem[], preview: pv };
  }, [p.id, p.stage, p.status]);
  const isSee = me.role === 'senior_elec_engineer';
  const isAe = me.role === 'assistant_engineer';
  const pending = data?.gates.find((g) => g.status === 'pending');
  const list = GATE_CHECKLIST[p.stage] ?? [];
  const refresh = async () => {
    await reload();
    onChange();
  };

  const request = async () => {
    const res = await dialog.prompt({ title: `Request “${CHECKPOINTS[p.stage - 1]}”`, message: `End of “${EXEC_STAGES[p.stage - 1]}” – SM Projects approves.`, fields: [{ key: 'n', label: 'Note to SM Projects', type: 'multiline' }], confirmLabel: 'Request' });
    if (res) await dialog.run(async () => { await rpc('request_gate', { p_exec: p.id, p_checklist: tick, p_note: res.n || null }); setTick({}); await refresh(); }, 'Sent to SM Projects');
  };
  const decide = async (g: ExecGate, ok: boolean) => {
    const failing = (data?.preview?.checks ?? g.checks).filter((c) => !c.ok).length;
    const res = await dialog.prompt({
      title: ok ? `Approve “${CHECKPOINTS[g.gate - 1]}”` : `Do not approve “${CHECKPOINTS[g.gate - 1]}”`,
      message: ok && failing ? `${failing} check(s) are not met – passing is an override and needs the reason.` : undefined,
      fields: [{ key: 'n', label: ok ? (failing ? 'Reason for the override' : 'Note') : 'Reason', type: 'multiline', required: !ok || failing > 0 }],
      confirmLabel: ok ? 'Approve' : 'Do not approve',
      danger: !ok,
    });
    if (res) await dialog.run(async () => { await rpc('decide_gate', { p_id: g.id, p_approve: ok, p_note: res.n || null }); await refresh(); }, ok ? 'Approved' : 'Returned to the SEE');
  };
  const raiseSnag = async () => {
    const res = await dialog.prompt({
      title: 'Snag',
      fields: [
        { key: 'location', label: 'Location', required: true },
        { key: 'description', label: 'Snag', type: 'multiline', required: true },
        { key: 'responsible', label: 'Responsible (subcontractor / DIMO / client)', required: true },
        { key: 'priority', label: 'Priority', type: 'select', initial: 'normal', options: [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
        ] },
        { key: 'due_date', label: 'Due', type: 'date', initial: todayISO() },
      ],
      confirmLabel: 'Add',
    });
    if (res)
      await dialog.run(async () => {
        const id = await rpc<string>('raise_snag', { p_exec: p.id, p: res });
        setOpenSnag(id);
        await reload();
      }, 'Added – attach the before photo');
  };
  const closeSnag = (s: Snag) => dialog.run(async () => { await rpc('close_snag', { p_id: s.id }); await reload(); }, 'Closed');
  const markItem = (d: DossierItem, done: boolean) => dialog.run(async () => { await rpc('complete_dossier_item', { p_id: d.id, p_done: done }); await reload(); }, done ? 'Done' : 'Reopened');
  const makeDossier = () => dialog.run(async () => { await rpc('ensure_dossier', { p_exec: p.id }); await reload(); }, 'Dossier items created from the project areas');

  const snags = data?.snags ?? [];
  const openSnags = snags.filter((s) => s.status === 'open');
  const dossier = data?.dossier ?? [];
  const areas = [...new Set(dossier.map((d) => d.area))];

  return (
    <>
      <Section title="Checkpoint">
        <Card>
          {p.status === 'closed' ? (
            <Notice tone={colors.green}>Close-out approved – the project is closed.</Notice>
          ) : pending ? (
            <>
              <Notice tone={colors.amber}>{`${CHECKPOINTS[pending.gate - 1]} waiting for SM Projects · requested ${fmtDateTime(pending.requested_at)} by ${people[pending.requested_by]?.full_name ?? ''}`}</Notice>
              {pending.note ? <Muted>{pending.note}</Muted> : null}
              {Object.keys(pending.checklist).length ? <Muted>{`Confirmed: ${Object.entries(pending.checklist).filter(([, v]) => v).map(([k]) => k).join(' · ') || '—'}`}</Muted> : null}
              <Checks checks={data?.preview?.checks ?? pending.checks} />
              {me.role === 'sm_projects' ? (
                <Row gap={6} style={{ marginTop: 6 }}>
                  <Button title="Approve" onPress={() => decide(pending, true)} />
                  <Button variant="secondary" title="Do not approve" onPress={() => decide(pending, false)} />
                </Row>
              ) : null}
            </>
          ) : (
            <>
              <Muted>{`“${CHECKPOINTS[p.stage - 1]}” – end of “${EXEC_STAGES[p.stage - 1]}”`}</Muted>
              <Checks checks={data?.preview?.checks ?? []} />
              {isSee ? (
                <>
                  <Row wrap gap={6} style={{ marginTop: 6 }}>
                    {list.map((x) => (
                      <Chip key={x} label={`${tick[x] ? '✓ ' : ''}${x}`} on={!!tick[x]} onPress={() => setTick((s) => ({ ...s, [x]: !s[x] }))} />
                    ))}
                  </Row>
                  <Row style={{ marginTop: 6 }}>
                    <Button title={`Request “${CHECKPOINTS[p.stage - 1]}”`} onPress={request} />
                  </Row>
                </>
              ) : null}
            </>
          )}
        </Card>
        {data?.gates.filter((g) => g.status !== 'pending').length ? (
          <Card style={{ marginTop: 8 }}>
            {data.gates
              .filter((g) => g.status !== 'pending')
              .map((g) => (
                <Muted key={g.id}>
                  {`${g.legacy ? `Old stage gate ${g.gate}` : CHECKPOINTS[g.gate - 1]} ${g.status === 'approved' ? 'approved' : 'not approved'}${g.override ? ' (override)' : ''} · ${people[g.decided_by ?? '']?.full_name ?? ''} · ${fmtDateTime(g.decided_at)}${g.note ? ` · ${g.note}` : ''}`}
                </Muted>
              ))}
          </Card>
        ) : null}
      </Section>

      <Section title={`Snags (${openSnags.length} open)`} right={(isSee || isAe || me.role === 'sm_projects') && p.status === 'active' ? <Button small title="+ Snag" onPress={raiseSnag} /> : null}>
        {snags.length ? (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {snags.map((s) => (
              <ListRow
                key={s.id}
                wrapRight
                onPress={() => setOpenSnag(openSnag === s.id ? null : s.id)}
                highlight={s.status === 'open' && s.due_date && s.due_date < todayISO() ? colors.red : undefined}
                title={`${s.location} – ${s.description}`}
                subtitle={
                  <>
                    <Muted>{[s.responsible, s.due_date ? `due ${fmtDate(s.due_date)}` : null, s.closed_at ? `closed ${fmtDate(s.closed_at)}` : null].filter(Boolean).join(' · ')}</Muted>
                    {openSnag === s.id ? (
                      <>
                        <Attachments entityType="snag" entityId={s.id} kinds={['snag_before', 'snag_after']} title="Before / after photos" allowCamera canUpload={s.status === 'open' && (isSee || isAe)} />
                        {s.status === 'open' && (isSee || isAe) ? <Button small title="Close (needs the after photo)" onPress={() => closeSnag(s)} /> : null}
                      </>
                    ) : null}
                  </>
                }
                right={
                  <Row gap={4}>
                    {s.priority === 'high' ? <Pill label="High" tone={colors.red} /> : null}
                    <Pill label={s.status === 'open' ? 'Open' : 'Closed'} tone={s.status === 'open' ? colors.amber : colors.green} />
                  </Row>
                }
              />
            ))}
          </Card>
        ) : (
          <Empty title="No snags" />
        )}
      </Section>

      <Section
        title={`Handover dossier (${dossier.filter((d) => d.done).length} / ${dossier.length})`}
        right={(isSee || isAe || me.role === 'operations_exec') && p.status === 'active' ? <Button small variant="secondary" title={dossier.length ? 'Add new areas' : 'Create from the areas'} onPress={makeDossier} /> : null}
      >
        {areas.length ? (
          areas.map((a) => (
            <Card key={a} style={{ padding: 0, overflow: 'hidden', marginBottom: 8 }}>
              <Muted style={{ padding: 10, fontWeight: '700' }}>{areaLabel(a)}</Muted>
              {dossier
                .filter((d) => d.area === a)
                .map((d) => (
                  <ListRow
                    key={d.id}
                    wrapRight
                    onPress={() => setOpenItem(openItem === d.id ? null : d.id)}
                    title={d.item}
                    subtitle={
                      <>
                        <Muted>{d.done ? `${people[d.done_by ?? '']?.full_name ?? ''} · ${fmtDate(d.done_at)}` : d.mandatory ? 'Mandatory' : 'Optional'}</Muted>
                        {openItem === d.id ? (
                          <>
                            <Attachments entityType="dossier_item" entityId={d.id} kinds={['dossier_doc']} title="Document" canUpload={!d.done && me.role !== 'gm' && me.role !== 'sm_projects'} />
                            {me.role !== 'gm' && me.role !== 'sm_projects' ? (
                              <Button small variant={d.done ? 'secondary' : 'primary'} title={d.done ? 'Reopen' : 'Mark done'} onPress={() => markItem(d, !d.done)} />
                            ) : null}
                          </>
                        ) : null}
                      </>
                    }
                    right={<Pill label={d.done ? 'Done' : 'Missing'} tone={d.done ? colors.green : d.mandatory ? colors.amber : colors.grey} />}
                  />
                ))}
            </Card>
          ))
        ) : (
          <Empty title="No dossier items yet" hint="Created from the handover templates of the project areas" />
        )}
      </Section>
    </>
  );
}
