import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { DataTable } from '@/components/DataTable';
import { useDialog } from '@/components/dialog';
import { Button, Card, Chip, colors, Empty, Field, Grid, ListRow, Muted, Pill, Row, Section, Stat } from '@/components/ui';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { addDaysISO, fmtDate, todayISO } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { calState, daysOverdue, instrumentTitle, REQ_STATUS, reqTone, type Instrument, type InstrumentRequest } from '@/lib/instruments';
import { mapLink } from '@/lib/site';
import { rpc, supabase } from '@/lib/supabase';

export const INSTRUMENT_FIELDS = (i?: Partial<Instrument>) => [
  { key: 'name', label: 'Instrument', required: true, initial: i?.name ?? '' },
  { key: 'category', label: 'Type / category (e.g. Photometry, Insulation, Earth)', initial: i?.category ?? '' },
  { key: 'make', label: 'Make', initial: i?.make ?? '' },
  { key: 'model', label: 'Model', initial: i?.model ?? '' },
  { key: 'serial_no', label: 'Serial number', initial: i?.serial_no ?? '' },
  { key: 'asset_no', label: 'Asset number', initial: i?.asset_no ?? '' },
  { key: 'range_spec', label: 'Range / accuracy', initial: i?.range_spec ?? '' },
  { key: 'home', label: 'Kept at', initial: i?.home ?? '' },
  { key: 'notes', label: 'Notes', type: 'multiline' as const, initial: i?.notes ?? '' },
];

/** Request actions: Operations (ready, issue with owner and return date, received back, extension), the requester (cancel, extension) */
export function RequestRows({
  rows,
  instruments,
  projects,
  onChange,
  showInstrument = true,
}: {
  rows: InstrumentRequest[];
  instruments: Instrument[];
  projects: Pick<ExecProject, 'id' | 'name' | 'code'>[];
  onChange: () => void;
  showInstrument?: boolean;
}) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const ops = me.role === 'operations_exec';
  const pn = (id: string | null) => (id ? (people[id]?.full_name ?? '—') : '—');
  const inst = (id: string) => instruments.find((i) => i.id === id);
  const proj = (r: InstrumentRequest) => {
    const p = projects.find((x) => x.id === r.exec_project_id);
    return p ? `${p.code ?? ''} ${p.name}`.trim() : (r.project_text ?? '—');
  };
  const run = (fn: string, args: Record<string, unknown>, ok: string) => dialog.run(async () => { await rpc(fn, args); onChange(); }, ok);
  const staff = Object.values(people)
    .filter((p) => p.active && p.role !== 'sub_supervisor')
    .map((p) => ({ value: p.id, label: p.full_name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const busy = (r: InstrumentRequest) => rows.some((x) => x.instrument_id === r.instrument_id && x.status === 'issued' && x.id !== r.id);

  const issue = async (r: InstrumentRequest) => {
    const res = await dialog.prompt({
      title: `Issue ${inst(r.instrument_id)?.code ?? ''}`,
      message: `${pn(r.requested_by)} · ${proj(r)}`,
      fields: [
        { key: 'o', label: 'Owner (responsible for it)', type: 'select', required: true, options: staff, initial: r.requested_by },
        { key: 'd', label: 'Return by', type: 'date', required: true, initial: r.need_to < todayISO() ? todayISO() : r.need_to },
      ],
      confirmLabel: 'Issue',
    });
    if (res) await run('issue_instrument', { p_id: r.id, p_owner: res.o, p_due: res.d }, 'Issued');
  };
  const back = async (r: InstrumentRequest) => {
    const res = await dialog.prompt({
      title: 'Received back',
      fields: [
        { key: 'c', label: 'Condition', type: 'select', required: true, initial: 'ok', options: [{ value: 'ok', label: 'Good' }, { value: 'out_of_order', label: 'Out of order' }] },
        { key: 'n', label: 'Note (what is wrong, if out of order)', type: 'multiline' },
      ],
      confirmLabel: 'Received',
    });
    if (res) await run('return_instrument', { p_id: r.id, p_condition: res.c, p_note: res.n || null }, 'Received – the next person in the queue is told');
  };
  const extend = async (r: InstrumentRequest) => {
    const res = await dialog.prompt({
      title: 'Keep it longer',
      message: `Return date now ${fmtDate(r.due_back)}. Operations decides; anyone waiting moves by the same days.`,
      fields: [
        { key: 'd', label: 'New return date', type: 'date', required: true, initial: addDaysISO(r.due_back ?? todayISO(), 2) },
        { key: 'r', label: 'Reason', type: 'multiline', required: true },
      ],
      confirmLabel: 'Ask',
    });
    if (res) await run('request_instrument_extension', { p_id: r.id, p_to: res.d, p_reason: res.r }, 'Sent to Operations');
  };
  const decideExt = async (r: InstrumentRequest, ok: boolean) => {
    const res = await dialog.prompt({
      title: ok ? 'Accept the extension' : 'Do not extend',
      message: `${pn(r.owner_id)} · ${fmtDate(r.due_back)} → ${fmtDate(r.ext_to)} · ${r.ext_reason ?? ''}`,
      fields: [{ key: 'n', label: ok ? 'Note' : 'Reason', type: 'multiline', required: !ok }],
      confirmLabel: ok ? 'Accept' : 'Refuse',
      danger: !ok,
    });
    if (res)
      await dialog.run(async () => {
        const n = await rpc<number>('decide_instrument_extension', { p_id: r.id, p_ok: ok, p_note: res.n || null });
        onChange();
        if (ok && n) dialog.toast(`${n} waiting request(s) moved and told`, 'ok');
      }, ok ? 'Extended' : 'Recorded');
  };
  const cancel = async (r: InstrumentRequest) => {
    const res = await dialog.prompt({
      title: 'Cancel the request',
      fields: [{ key: 'n', label: 'Reason', type: 'multiline', required: r.requested_by !== me.id }],
      confirmLabel: 'Cancel it',
      danger: true,
    });
    if (res) await run('cancel_instrument_request', { p_id: r.id, p_reason: res.n || null }, 'Cancelled');
  };

  if (!rows.length) return <Empty title="No requests" />;
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {rows.map((r) => {
        const i = inst(r.instrument_id);
        const od = daysOverdue(r);
        const mine = r.requested_by === me.id || r.owner_id === me.id;
        return (
          <ListRow
            key={r.id}
            wrapRight
            highlight={reqTone(r)}
            onPress={showInstrument && i ? () => router.push(`/instruments/${i.id}`) : undefined}
            title={`${showInstrument && i ? `${i.code ?? ''} ${i.name} · ` : ''}${pn(r.requested_by)}${r.owner_id && r.owner_id !== r.requested_by ? ` → owner ${pn(r.owner_id)}` : ''}`}
            subtitle={[
              `${proj(r)} · ${fmtDate(r.need_from)} – ${fmtDate(r.need_to)}${r.purpose ? ` · ${r.purpose}` : ''}`,
              r.status === 'issued' ? `With ${pn(r.owner_id)} · return by ${fmtDate(r.due_back)}${od ? ` · ${od} day(s) OVERDUE` : ''}` : null,
              r.status === 'returned' ? `Returned ${fmtDate(r.returned_at)}${r.return_condition === 'out_of_order' ? ` · out of order – ${r.return_note ?? ''}` : ''}` : null,
              r.ext_status === 'pending' ? `Extension asked to ${fmtDate(r.ext_to)} – ${r.ext_reason ?? ''}` : r.ext_status ? `Extension ${r.ext_status}${r.ext_note ? ` – ${r.ext_note}` : ''}` : null,
              r.uncalibrated ? 'Requested while NOT calibrated' : null,
              r.cancel_note ? `Cancelled – ${r.cancel_note}` : null,
              r.status === 'waiting' && busy(r) ? 'Instrument in use – you are told when it comes back' : null,
            ]
              .filter(Boolean)
              .join('\n')}
            right={
              <Row gap={6} wrap>
                <Pill label={od ? `${od} d overdue` : REQ_STATUS[r.status]} tone={reqTone(r)} solid={od > 0 || r.status === 'ready'} />
                {r.uncalibrated ? <Pill label="Uncalibrated" tone={colors.red} /> : null}
                {r.site_lat != null && r.site_lng != null ? <Button small variant="ghost" title="Map" onPress={() => Linking.openURL(mapLink(r.site_lat!, r.site_lng!))} /> : null}
                {ops && r.status === 'waiting' && !busy(r) ? <Button small variant="secondary" title="Ready to release" onPress={() => run('ready_instrument', { p_id: r.id }, 'Requester told')} /> : null}
                {ops && ['waiting', 'ready'].includes(r.status) && !busy(r) ? <Button small title="Issue" onPress={() => issue(r)} /> : null}
                {ops && r.status === 'issued' ? <Button small title="Received back" onPress={() => back(r)} /> : null}
                {ops && r.ext_status === 'pending' && r.status === 'issued' ? (
                  <>
                    <Button small title="Accept extension" onPress={() => decideExt(r, true)} />
                    <Button small variant="secondary" title="Refuse" onPress={() => decideExt(r, false)} />
                  </>
                ) : null}
                {mine && r.status === 'issued' && r.ext_status !== 'pending' ? <Button small variant="secondary" title="Keep longer" onPress={() => extend(r)} /> : null}
                {(r.requested_by === me.id || ops) && ['waiting', 'ready'].includes(r.status) ? <Button small variant="ghost" title="Cancel" onPress={() => cancel(r)} /> : null}
              </Row>
            }
          />
        );
      })}
    </Card>
  );
}

/**
 * Testing / site instruments: the list with status (available, with whom until when, overdue, out of order) and calibration,
 * requests and the queue. Used in the left-panel Instruments screen and under each project's QA tab (project given).
 */
export function InstrumentsView({ project }: { project?: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const ops = me.role === 'operations_exec';
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'all'>('active');
  const today = todayISO();
  const { data, reload } = useLoad(async () => {
    const [i, r, p] = await Promise.all([
      supabase.from('instruments').select('*').eq('removed', false).order('name'),
      supabase.from('instrument_requests').select('*').order('need_from').limit(500),
      supabase.from('exec_projects').select('id, name, code').order('name'),
    ]);
    return { instruments: (i.data ?? []) as Instrument[], requests: (r.data ?? []) as InstrumentRequest[], projects: (p.data ?? []) as Pick<ExecProject, 'id' | 'name' | 'code'>[] };
  }, [project?.id]);
  const instruments = data?.instruments ?? [];
  const requests = data?.requests ?? [];
  const live = requests.filter((r) => ['waiting', 'ready', 'issued'].includes(r.status));
  const out = (i: Instrument) => live.find((r) => r.instrument_id === i.id && r.status === 'issued');
  const queue = (i: Instrument) => live.filter((r) => r.instrument_id === i.id && r.status !== 'issued');
  const ql = q.trim().toLowerCase();
  const shown = instruments.filter((i) => !ql || `${i.code} ${instrumentTitle(i)} ${i.category ?? ''} ${i.asset_no ?? ''}`.toLowerCase().includes(ql));
  const overdue = live.filter((r) => daysOverdue(r, today) > 0);
  const relevant = (r: InstrumentRequest) => (project ? r.exec_project_id === project.id : ops || r.requested_by === me.id || r.owner_id === me.id);
  const reqRows = requests.filter((r) => relevant(r) && (show === 'all' || ['waiting', 'ready', 'issued'].includes(r.status)));

  const add = async () => {
    const res = await dialog.prompt({ title: 'Add an instrument', fields: INSTRUMENT_FIELDS(), confirmLabel: 'Add' });
    if (res)
      await dialog.run(async () => {
        const id = await rpc<string>('save_instrument', { p: res });
        await reload();
        router.push(`/instruments/${id}`);
      }, 'Added – record the calibration and upload the report on its page');
  };
  const request = (i: Instrument) => router.push({ pathname: '/instruments/request', params: { instrument: i.id, ...(project ? { project: project.id } : {}) } });

  return (
    <View style={{ gap: 10 }}>
      <Grid min={140}>
        <Stat label="Instruments" value={instruments.length} />
        <Stat label="Available" value={instruments.filter((i) => i.condition === 'ok' && !out(i)).length} tone="green" />
        <Stat label="In use" value={instruments.filter((i) => out(i)).length} />
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'red' : undefined} />
        <Stat label="Out of order" value={instruments.filter((i) => i.condition === 'out_of_order').length} tone={instruments.some((i) => i.condition === 'out_of_order') ? 'amber' : undefined} />
        <Stat label="Not calibrated / expired" value={instruments.filter((i) => !calState(i, today).ok).length} />
      </Grid>
      <Section
        title={project ? 'Requests for this project' : ops ? 'Requests and instruments out' : 'My requests'}
        right={
          <Row gap={6}>
            <Chip label="Open" on={show === 'active'} onPress={() => setShow('active')} />
            <Chip label="All" on={show === 'all'} onPress={() => setShow('all')} />
          </Row>
        }
      >
        <RequestRows rows={reqRows} instruments={instruments} projects={data?.projects ?? []} onChange={reload} />
      </Section>
      <Section title={`Instrument list (${instruments.length})`} right={ops ? <Button small title="+ Instrument" onPress={add} /> : null}>
        <Field label="Search" value={q} onChangeText={setQ} placeholder="Name, make, model, serial, code" />
        <DataTable
          rows={shown}
          keyOf={(i) => i.id}
          onPress={(i) => router.push(`/instruments/${i.id}`)}
          edge={(i) => (i.condition === 'out_of_order' ? colors.red : out(i) ? (daysOverdue(out(i)!, today) ? colors.red : colors.blue) : colors.green)}
          emptyTitle={ops ? 'No instruments yet – add them with “+ Instrument”' : 'No instruments listed yet'}
          columns={[
            { h: 'Code', w: 110, v: (i) => i.code ?? '', bold: true },
            { h: 'Instrument', w: 280, v: (i) => `${i.name}\n${[[i.make, i.model].filter(Boolean).join(' '), i.serial_no ? `S/N ${i.serial_no}` : null].filter(Boolean).join(' · ')}` },
            {
              h: 'Status',
              w: 230,
              v: (i) => {
                const o = out(i);
                if (i.condition === 'out_of_order') return <Pill label="Out of order" tone={colors.red} solid />;
                if (o) {
                  const d = daysOverdue(o, today);
                  return <Pill label={`${people[o.owner_id ?? '']?.full_name ?? 'Issued'} · ${d ? `${d} d overdue` : `back ${fmtDate(o.due_back)}`}`} tone={d ? colors.red : colors.blue} solid={d > 0} />;
                }
                return <Pill label="Available" tone={colors.green} />;
              },
            },
            {
              h: 'Calibration',
              w: 260,
              v: (i) => {
                const c = calState(i, today);
                return <Pill label={c.ok && i.cal_expiry ? `${c.label} · ${fmtDate(i.cal_expiry)}` : c.label} tone={c.tone} />;
              },
            },
            { h: 'Queue', w: 70, right: true, v: (i) => (queue(i).length ? String(queue(i).length) : '') },
            {
              h: '',
              w: 110,
              v: (i) =>
                i.condition === 'ok' ? <Button small variant="secondary" title="Request" onPress={() => request(i)} /> : '',
            },
          ]}
        />
        <Muted>Tap an instrument for its details, calibration report and history. Uncalibrated instruments can be used – you and Operations are alerted.</Muted>
      </Section>
      {ops ? null : (
        <Muted>{`Operations Executive: ${Object.values(people).filter((p) => p.active && p.role === 'operations_exec').map((p) => p.full_name).join(', ') || '—'}`}</Muted>
      )}
      {!data ? <ListRow title="Loading…" /> : null}
    </View>
  );
}
