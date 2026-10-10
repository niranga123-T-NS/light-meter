import { useState } from 'react';
import { Attachments } from '@/components/Attachments';
import { useDialog } from '@/components/dialog';
import { Button, Card, colors, Empty, ListRow, Muted, Pill, Row, Section } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { EXEC_AREAS, type DossierItem, type ExecProject, type Snag } from '@/lib/execution';
import { fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';
import { GateCard } from './GateCard';

const areaLabel = (a: string) => EXEC_AREAS.find((x) => x.value === a)?.label ?? a;

/** Handover to the client (SEE requests, SM Projects approves with the live checks), snags with before / after photos, and the handover dossier per area. */
export function HandoverTab({ p, onChange }: { p: ExecProject; onChange: () => void }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [openSnag, setOpenSnag] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const { data, reload } = useLoad(async () => {
    const [s, d] = await Promise.all([
      supabase.from('snags').select('*').eq('exec_project_id', p.id).order('raised_at', { ascending: false }),
      supabase.from('exec_dossier').select('*').eq('exec_project_id', p.id).order('area').order('item'),
    ]);
    return { snags: (s.data ?? []) as Snag[], dossier: (d.data ?? []) as DossierItem[] };
  }, [p.id, p.stage, p.status]);
  const isSee = me.role === 'senior_elec_engineer';
  const isAe = me.role === 'assistant_engineer';
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
  const canDossier = (isSee || isAe || me.role === 'operations_exec') && p.status === 'active';
  const addItem = async (area?: string) => {
    const r = await dialog.prompt({
      title: area ? `Add a document – ${areaLabel(area)}` : 'Add a dossier document',
      fields: [
        ...(area ? [] : [{ key: 'a', label: 'Area (an existing one or a new name)', required: true, initial: '' }]),
        { key: 'i', label: 'Document', required: true },
        { key: 'm', label: 'Needed for handover', type: 'select' as const, required: true, initial: 'yes', options: [{ value: 'yes', label: 'Mandatory' }, { value: 'no', label: 'Optional' }] },
      ],
      confirmLabel: 'Add',
    });
    if (!r) return;
    const known = EXEC_AREAS.find((x) => x.label.toLowerCase() === (r.a ?? '').trim().toLowerCase())?.value;
    await dialog.run(async () => {
      await rpc('add_dossier_item', { p_exec: p.id, p_area: area ?? known ?? r.a, p_item: r.i, p_mandatory: r.m === 'yes' });
      await reload();
    }, 'Added');
  };
  const removeItem = async (d: DossierItem) => {
    if (!(await dialog.confirm('Remove from the dossier?', `${d.item} – it is not needed for this project.`, { confirmLabel: 'Remove', danger: true }))) return;
    await dialog.run(async () => {
      await rpc('remove_dossier_item', { p_id: d.id });
      await reload();
    }, 'Removed');
  };
  const removeArea = async (a: string) => {
    if (!(await dialog.confirm(`Remove the area “${areaLabel(a)}”?`, 'All its documents are taken off the dossier.', { confirmLabel: 'Remove area', danger: true }))) return;
    await dialog.run(async () => {
      await rpc('remove_dossier_area', { p_exec: p.id, p_area: a });
      await reload();
    }, 'Area removed');
  };
  const makeDossier = () => dialog.run(async () => { await rpc('ensure_dossier', { p_exec: p.id }); await reload(); }, 'Dossier items created from the project areas');

  const snags = data?.snags ?? [];
  const openSnags = snags.filter((s) => s.status === 'open');
  const dossier = (data?.dossier ?? []).filter((d) => !d.removed);
  const areas = [...new Set(dossier.map((d) => d.area))];

  return (
    <>
      <Section title="Hand over to the client">
        <GateCard p={p} gate={2} onChange={onChange} />
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
        right={
          canDossier ? (
            <Row gap={6}>
              {dossier.length ? <Button small variant="secondary" title="+ Document" onPress={() => addItem()} /> : null}
              <Button small variant="secondary" title={dossier.length ? 'Add new areas' : 'Create from the areas'} onPress={makeDossier} />
            </Row>
          ) : null
        }
      >
        {areas.length ? (
          areas.map((a) => (
            <Card key={a} style={{ padding: 0, overflow: 'hidden', marginBottom: 8 }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center', paddingRight: 8 }}>
                <Muted style={{ padding: 10, fontWeight: '700' }}>{areaLabel(a)}</Muted>
                {canDossier ? (
                  <Row gap={4}>
                    <Button small variant="ghost" title="+ Document" onPress={() => addItem(a)} />
                    <Button small variant="ghost" title="Remove area" onPress={() => removeArea(a)} />
                  </Row>
                ) : null}
              </Row>
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
                            <Row gap={6} wrap>
                              {me.role !== 'gm' && me.role !== 'sm_projects' ? (
                                <Button small variant={d.done ? 'secondary' : 'primary'} title={d.done ? 'Reopen' : 'Mark done'} onPress={() => markItem(d, !d.done)} />
                              ) : null}
                              {canDossier && !d.done ? <Button small variant="ghost" title="Remove from dossier" onPress={() => removeItem(d)} /> : null}
                            </Row>
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
