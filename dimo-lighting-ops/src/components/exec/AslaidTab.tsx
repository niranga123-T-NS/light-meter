import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { SalesMap, mapEscape } from '@/components/SalesMap';
import type { MapLine, MapPoint } from '@/components/SalesMap.types';
import { Button, Card, colors, Empty, ListRow, Muted, Notice, Pill, Row, Section, Segmented, Stat } from '@/components/ui';
import { ASLAID_STATUS, routeLine, type AslaidPoint, type AslaidRoute, type AslaidStatus } from '@/lib/aslaid';
import { useMe } from '@/lib/auth';
import type { ExecProject } from '@/lib/execution';
import { fmtDate } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const RECORDERS = ['senior_elec_engineer', 'sm_projects', 'assistant_engineer', 'trainee', 'sub_supervisor'];
type Filter = 'all' | 'open' | 'approve' | 'todo' | 'done';
const IN: Record<Filter, AslaidStatus[] | null> = { all: null, open: ['recording', 'queried'], approve: ['to_approve'], todo: ['not_started'], done: ['approved'] };

/** As-laid cable routes of the project: each route walked with the phone before backfill, its status, the map of all of them. */
export function AslaidTab({ p }: { p: ExecProject }) {
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const [f, setF] = useState<Filter>('all');
  const { data, reload } = useLoad(async () => {
    const [r, pt] = await Promise.all([
      supabase.from('exec_aslaid_routes').select('*').eq('exec_project_id', p.id).order('created_at'),
      supabase.from('exec_aslaid_points').select('*').eq('exec_project_id', p.id),
    ]);
    return { routes: (r.data ?? []) as AslaidRoute[], points: (pt.data ?? []) as AslaidPoint[] };
  }, [p.id]);
  const routes = useMemo(() => data?.routes ?? [], [data]);
  const shown = routes.filter((r) => !IN[f] || IN[f]?.includes(r.status));
  const canRecord = RECORDERS.includes(me.role);
  const m = Math.round(routes.reduce((t, r) => t + Number(r.gps_m || 0), 0));
  const { lines, points } = useMemo(() => {
    const L: MapLine[] = [], P: MapPoint[] = [];
    shown.forEach((r) => {
      const ln = routeLine(r, (data?.points ?? []).filter((q) => q.route_id === r.id));
      if (ln.length > 1) L.push({ coords: ln, color: ASLAID_STATUS[r.status].tone, weight: 4, dashed: r.status === 'recording' || r.status === 'queried' });
      if (ln.length) P.push({ lat: ln[ln.length - 1][0], lng: ln[ln.length - 1][1], color: ASLAID_STATUS[r.status].tone, radius: 6, label: `<b>${mapEscape(`${r.from_name} → ${r.to_name}`)}</b><br>${mapEscape(ASLAID_STATUS[r.status].label)} · ${Math.round(r.gps_m)} m`, href: `/execution/aslaid/${r.id}` });
    });
    return { lines: L, points: P };
  }, [shown, data]);

  const add = async () => {
    const v = await dialog.prompt({
      title: 'Cable route',
      message: 'One route per cable run (or per trench carrying several cables, named after the main one).',
      fields: [
        { key: 'from_name', label: 'From (panel, pillar, room)', required: true },
        { key: 'to_name', label: 'To (mast, pole, panel)', required: true },
        { key: 'cable', label: 'Cable', initial: '', hint: 'e.g. 4C 70 mm² Cu XLPE/SWA' },
        { key: 'code', label: 'Cable schedule no.', initial: '' },
        { key: 'schedule_m', label: 'Length on the schedule m', initial: '' },
        { key: 'req_depth_m', label: 'Depth required to the top of the cable m', initial: '0.6', required: true, hint: 'From the specification – typically 0.6 m, 0.75–0.9 m under roads' },
      ],
    });
    if (!v) return;
    await dialog.run(async () => {
      const id = await rpc<string>('aslaid_route_save', { p: { exec_project_id: p.id, ...v } });
      router.push(`/execution/aslaid/${id}`);
    }, 'Route added');
    await reload();
  };

  return (
    <View style={{ gap: 12 }}>
      <Row style={{ flexWrap: 'wrap', gap: 8 }}>
        <Stat label="Recorded" value={`${m} m`} />
        <Stat label="Approved" value={`${routes.filter((r) => r.status === 'approved').length} of ${routes.length}`} tone={routes.length && routes.every((r) => r.status === 'approved') ? 'green' : undefined} />
        <Stat label="Open trench" value={String(routes.filter((r) => r.status === 'recording' || r.status === 'queried').length)} tone={routes.some((r) => r.status === 'queried') ? 'red' : routes.some((r) => r.status === 'recording') ? 'amber' : undefined} />
        <Stat label="To approve" value={String(routes.filter((r) => r.status === 'to_approve').length)} />
      </Row>
      <Notice>Walk each cable route with the phone while the trench is open: the GPS records the line, and you mark the depth (with photos), joints, crossings, ducts, marker posts and other services before backfill. The SEE approves; years later anyone on the team can find the cable again.</Notice>
      <Row style={{ flexWrap: 'wrap', gap: 8 }}>
        {canRecord ? <Button title="+ Cable route" onPress={add} /> : null}
        <Button variant="secondary" title="Find a cable from here" onPress={() => router.push('/execution/aslaid/find')} />
      </Row>
      {routes.length ? (
        <>
          <Segmented value={f} onChange={setF} options={[{ value: 'all', label: `All ${routes.length}` }, { value: 'open', label: 'Open trench' }, { value: 'approve', label: 'To approve' }, { value: 'todo', label: 'Not started' }, { value: 'done', label: 'Approved' }]} />
          {lines.length || points.length ? <SalesMap points={points} lines={lines} fitKey={`${p.id}|${f}|${routes.length}`} height={360} maxZoom={18} onOpen={(h) => router.push(h as never)} /> : <Muted>Routes show on the map once walked.</Muted>}
          <Section title="Routes">
            <Card>
              {shown.length ? (
                shown.map((r) => {
                  const n = (data?.points ?? []).filter((q) => q.route_id === r.id), dp = n.filter((q) => q.kind === 'depth').length;
                  return (
                    <ListRow
                      key={r.id}
                      highlight={ASLAID_STATUS[r.status].tone}
                      title={`${r.code ? `${r.code} · ` : ''}${r.from_name} → ${r.to_name}`}
                      subtitle={`${r.cable ?? 'cable not given'} · ${Math.round(r.gps_m)} m${r.schedule_m ? ` (schedule ${r.schedule_m} m)` : ''} · ${dp} depth point${dp === 1 ? '' : 's'}${r.approved_by ? ` · approved by ${people[r.approved_by]?.full_name ?? ''}, ${fmtDate(r.approved_at ?? '')}` : ''}`}
                      right={<Pill label={ASLAID_STATUS[r.status].label} tone={ASLAID_STATUS[r.status].tone} />}
                      wrapRight
                      onPress={() => router.push(`/execution/aslaid/${r.id}`)}
                    />
                  );
                })
              ) : (
                <Text style={{ color: colors.muted, padding: 8 }}>None in this list.</Text>
              )}
            </Card>
          </Section>
        </>
      ) : (
        <Empty title="No cable routes yet" hint={canRecord ? 'Add a route for each cable before its trench is backfilled.' : 'The project team adds them on site.'} />
      )}
    </View>
  );
}
