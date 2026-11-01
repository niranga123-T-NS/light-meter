import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useDialog } from '@/components/dialog';
import { SalesMap, mapEscape } from '@/components/SalesMap';
import type { MapPoint } from '@/components/SalesMap.types';
import { Button, Card, colors, ErrorBanner, KeyValue, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section, Stat } from '@/components/ui';
import { ASLAID_STATUS, nearestOn, POINT_KIND, PROTECTION, printRecord, protLabel, routeLine, shareDxf, shareKml, summary, trackLen, type AslaidPhoto, type AslaidPoint, type AslaidRoute, type Fix, type PointKind } from '@/lib/aslaid';
import { useMe } from '@/lib/auth';
import { pickImage, readBytes, uuid } from '@/lib/files';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useLoad, usePeople } from '@/lib/hooks';
import { rpc, supabase } from '@/lib/supabase';

const RECORDERS = ['senior_elec_engineer', 'sm_projects', 'assistant_engineer', 'trainee', 'sub_supervisor'];
const APPROVERS = ['senior_elec_engineer', 'sm_projects', 'gm'];
const MIN_STEP = 2; // metres between kept GPS fixes
const MAX_ACC = 25; // fixes worse than this are not kept

/** One cable route as laid: walk it with the phone, mark what is seen before backfill, then the summary, the tests and the sign-off. */
export default function AslaidRouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const dialog = useDialog();
  const people = usePeople();
  const { data, error, reload } = useLoad(async () => {
    const { data: r, error: e } = await supabase.from('exec_aslaid_routes').select('*').eq('id', id).single();
    if (e) throw new Error(e.message);
    const [pt, ph, pr] = await Promise.all([
      supabase.from('exec_aslaid_points').select('*').eq('route_id', id).order('taken_at'),
      supabase.from('exec_aslaid_photos').select('*').eq('route_id', id).order('taken_at'),
      supabase.from('exec_projects').select('code, name').eq('id', (r as AslaidRoute).exec_project_id).single(),
    ]);
    return { r: r as AslaidRoute, pts: (pt.data ?? []) as AslaidPoint[], photos: (ph.data ?? []) as AslaidPhoto[], project: pr.data ? `${pr.data.code ?? ''} ${pr.data.name ?? ''}`.trim() : '' };
  }, [id]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const photoKey = (data?.photos ?? []).map((p) => p.path).join('|');
  useEffect(() => {
    const ps = data?.photos ?? [];
    if (!ps.length) return;
    let live = true;
    supabase.storage.from('aslaid').createSignedUrls(ps.map((p) => p.path), 3600).then(({ data: d }) => {
      if (live && d) setUrls(Object.fromEntries(d.filter((x) => x.signedUrl && x.path).map((x) => [x.path as string, x.signedUrl as string])));
    }).catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey]);

  // ---- live GPS while walking: fixes kept every few metres, sent in small batches
  const sub = useRef<Location.LocationSubscription | null>(null);
  const buf = useRef<Fix[]>([]);
  const lastSent = useRef(0);
  const [walking, setWalking] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [local, setLocal] = useState<Fix[]>([]);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const flush = async () => {
    if (!buf.current.length) return;
    const batch = buf.current.splice(0);
    try {
      await rpc('aslaid_track_add', { p_route: id, p_pts: batch });
      setSendErr(null);
      lastSent.current = Date.now();
    } catch (e) {
      buf.current.unshift(...batch); // kept and sent again with the next batch
      setSendErr(e instanceof Error ? e.message : String(e));
    }
  };
  const stop = async () => {
    sub.current?.remove();
    sub.current = null;
    setWalking(false);
    await flush();
    await reload();
    setLocal([]);
  };
  useEffect(() => () => sub.current?.remove(), []);
  const start = async () => {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      dialog.toast('Allow location for this app to record the route', 'error');
      return;
    }
    if (data?.r.status === 'not_started') await rpc('aslaid_start', { p_route: id });
    else if (data && data.r.status !== 'recording') await rpc('aslaid_start', { p_route: id });
    const last = data?.r.track?.length ? data.r.track[data.r.track.length - 1] : null;
    let prev: [number, number] | null = last ? [last[0], last[1]] : null;
    sub.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000 }, (loc) => {
      const f: Fix = [loc.coords.latitude, loc.coords.longitude, Math.round((loc.coords.accuracy ?? 99) * 10) / 10, loc.timestamp];
      setFix(f);
      if (f[2] > MAX_ACC) return;
      if (prev && trackLen([prev, [f[0], f[1]]]) < MIN_STEP) return;
      prev = [f[0], f[1]];
      buf.current.push(f);
      setLocal((l) => [...l, f]);
      if (buf.current.length >= 10 || Date.now() - lastSent.current > 20000) void flush();
    });
    setWalking(true);
    await reload();
  };

  const line = useMemo(() => [...(data ? routeLine(data.r, data.pts) : []), ...local.map((q) => [q[0], q[1]] as [number, number])], [data, local]);
  const walked = Math.round(trackLen(line));
  const mapPts = useMemo<MapPoint[]>(() => {
    const P: MapPoint[] = (data?.pts ?? []).map((p) => ({ lat: p.lat, lng: p.lng, color: POINT_KIND[p.kind].color, radius: 7, label: `<b>${mapEscape(POINT_KIND[p.kind].label)}</b>${p.depth_m != null ? ` ${p.depth_m} m` : ''}<br>${mapEscape(p.note ?? '')}` }));
    if (fix) P.push({ lat: fix[0], lng: fix[1], color: '#1d4ed8', radius: 9, hollow: true, label: `You · ±${fix[2]} m` });
    return P;
  }, [data, fix]);

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const { r, pts, photos, project } = data;
  const st = ASLAID_STATUS[r.status], open = r.status === 'recording' || r.status === 'queried' || r.status === 'not_started';
  const canRecord = RECORDERS.includes(me.role), canApprove = APPROVERS.includes(me.role), S = summary(r, pts, photos);
  const name = (u: string | null) => (u ? people[u]?.full_name ?? '' : '');

  const addPhotos = async (pointId: string | null, at: Fix | null) => {
    for (;;) {
      const f = await pickImage(true).catch((e) => {
        dialog.toast(e instanceof Error ? e.message : String(e), 'error');
        return null;
      });
      if (!f) return;
      const n = await dialog.prompt({ title: 'Photo note', fields: [{ key: 'note', label: 'What it shows (optional)', initial: '' }] });
      if (!n) return;
      const ok = await dialog.run(async () => {
        const path = `${r.exec_project_id}/aslaid/${uuid()}.jpg`;
        const up = await supabase.storage.from('aslaid').upload(path, await readBytes(f), { contentType: f.mimeType ?? 'image/jpeg', upsert: false });
        if (up.error) throw new Error(up.error.message);
        await rpc('aslaid_photo_add', { p_route: r.id, p_point: pointId, p_path: path, p_note: n.note || null, p_lat: at?.[0] ?? null, p_lng: at?.[1] ?? null });
      }, 'Photo saved');
      if (!ok || !(await dialog.confirm('Another photo?', undefined, { confirmLabel: 'Take another' }))) break;
    }
    await reload();
  };
  const mark = async (k: PointKind) => {
    let at = fix;
    if (!at) {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null);
      if (pos) at = [pos.coords.latitude, pos.coords.longitude, Math.round((pos.coords.accuracy ?? 99) * 10) / 10, pos.timestamp];
    }
    if (!at) {
      dialog.toast('No GPS position yet – step into the open and try again', 'error');
      return;
    }
    const chain = Math.round(nearestOn(line.length ? line : [[at[0], at[1]]], [at[0], at[1]])?.chain ?? 0);
    const v = await dialog.prompt({
      title: `${POINT_KIND[k].label} – ${chain} m from ${r.from_name}`,
      message: `GPS ${at[0].toFixed(6)}, ${at[1].toFixed(6)} ±${at[2]} m`,
      fields: [
        ...(k === 'depth' || k === 'crossing' || k === 'duct' ? [{ key: 'depth_m', label: k === 'depth' ? 'Depth to the top of the cable m' : 'Depth m (optional)', required: k === 'depth', initial: '', hint: k === 'depth' ? `Required ${r.req_depth_m} m` : undefined }] : []),
        ...(k === 'depth' ? [{ key: 'protection', label: 'Protection seen', type: 'multiselect' as const, options: PROTECTION, initial: 'sand,tiles,tape' }] : []),
        { key: 'tie_feature', label: 'Tie to a fixed feature (kerb, building corner, pole)', initial: '' },
        { key: 'tie_m', label: 'Distance to it m', initial: '' },
        { key: 'note', label: k === 'service' ? 'What service (water, telecom, drain…) and its depth' : k === 'other' ? 'What it is' : 'Note', required: k === 'service' || k === 'other', initial: '' },
      ],
      confirmLabel: 'Save point',
    });
    if (!v) return;
    const depth = v.depth_m ? Number(String(v.depth_m).replace(',', '.')) : null;
    let pid: string | null = null;
    const ok = await dialog.run(async () => {
      pid = await rpc<string>('aslaid_point_add', { p: { route_id: r.id, kind: k, lat: at[0], lng: at[1], acc_m: at[2], chain_m: chain, depth_m: depth, protection: (v.protection ?? '').split(',').filter(Boolean), tie_feature: v.tie_feature, tie_m: v.tie_m || null, note: v.note } });
    }, depth != null && k === 'depth' ? (depth < r.req_depth_m ? `${depth} m – shallower than the ${r.req_depth_m} m required` : `${depth} m – deep enough`) : 'Point saved');
    if (!ok) return;
    if (await dialog.confirm('Photos before backfill?', 'Each photo is kept with the time, the GPS position and this point.', { confirmLabel: 'Take photos' })) await addPhotos(pid, at);
    else await reload();
  };
  const finish = async () => {
    const v = await dialog.prompt({
      title: `Reached ${r.to_name} – finish`,
      message: 'The route then waits for the SEE. Tests can be added now or before approval.',
      fields: [
        { key: 'drum', label: 'Drum cut m', initial: r.drum_m ? String(r.drum_m) : '' },
        { key: 'ir', label: 'Insulation resistance after laying MΩ', initial: r.ir_mohm != null ? String(r.ir_mohm) : '' },
        { key: 'arm', label: 'Armour continuity Ω', initial: r.armour_ohm != null ? String(r.armour_ohm) : '' },
      ],
      confirmLabel: 'Finish – send for approval',
    });
    if (!v) return;
    if (walking) await stop();
    await dialog.run(async () => {
      await rpc('aslaid_finish', { p_route: r.id, p_drum_m: v.drum ? Number(v.drum) : null, p_ir_mohm: v.ir ? Number(v.ir) : null, p_armour_ohm: v.arm ? Number(v.arm) : null });
    }, 'Sent for approval');
    await reload();
  };
  const approve = async () => {
    const v = await dialog.prompt({
      title: 'Approve the route',
      message: S.shallow ? `${S.shallow} depth point(s) are shallower than the ${r.req_depth_m} m required – give the reason to accept them.` : 'Backfill is allowed once approved. The record is then locked.',
      fields: S.shallow ? [{ key: 'note', label: 'Reason (protection added, agreed with…)', required: true, type: 'multiline' as const }] : [{ key: 'note', label: 'Note (optional)', initial: '' }],
      confirmLabel: 'Approve',
    });
    if (!v) return;
    await dialog.run(() => rpc('aslaid_approve', { p_route: r.id, p_note: v.note || null }), 'Approved');
    await reload();
  };
  const query = async () => {
    const v = await dialog.prompt({ title: 'Query', fields: [{ key: 'note', label: 'What needs fixing', type: 'multiline', required: true }], confirmLabel: 'Send back' });
    if (!v) return;
    await dialog.run(() => rpc('aslaid_query', { p_route: r.id, p_note: v.note }), 'Sent back to the team');
    await reload();
  };
  const edit = async () => {
    const v = await dialog.prompt({
      title: 'Route details',
      fields: [
        { key: 'from_name', label: 'From', initial: r.from_name, required: true },
        { key: 'to_name', label: 'To', initial: r.to_name, required: true },
        { key: 'cable', label: 'Cable', initial: r.cable ?? '' },
        { key: 'code', label: 'Cable schedule no.', initial: r.code ?? '' },
        { key: 'schedule_m', label: 'Length on the schedule m', initial: r.schedule_m ? String(r.schedule_m) : '' },
        { key: 'req_depth_m', label: 'Depth required m', initial: String(r.req_depth_m), required: true },
      ],
    });
    if (!v) return;
    await dialog.run(() => rpc('aslaid_route_save', { p: { id: r.id, ...v } }), 'Saved');
    await reload();
  };
  const del = async () => {
    if (!(await dialog.confirm('Remove this route and everything recorded on it?', undefined, { danger: true, confirmLabel: 'Remove' }))) return;
    await dialog.run(async () => {
      const paths = await rpc<string[]>('aslaid_route_delete', { p_id: r.id });
      if (paths?.length) await supabase.storage.from('aslaid').remove(paths);
      router.back();
    }, 'Removed');
  };
  const delPoint = async (p: AslaidPoint) => {
    if (!open || !canRecord) return;
    if (!(await dialog.confirm(`Remove this ${POINT_KIND[p.kind].label.toLowerCase()} point and its photos?`, undefined, { danger: true, confirmLabel: 'Remove' }))) return;
    await dialog.run(async () => {
      const paths = await rpc<string[]>('aslaid_point_delete', { p_id: p.id });
      if (paths?.length) await supabase.storage.from('aslaid').remove(paths);
    }, 'Removed');
    await reload();
  };
  const pdf = () => dialog.run(() => printRecord(r, pts, photos, urls, name, project));
  const ord = [...pts].sort((a, b) => (a.chain_m ?? 0) - (b.chain_m ?? 0));

  return (
    <Screen onRefresh={reload} maxWidth={900}>
      <Stack.Screen options={{ title: `${r.from_name} → ${r.to_name}` }} />
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>{`${r.code ? `${r.code} · ` : ''}${r.from_name} → ${r.to_name}`}</Text>
      <Row style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Pill label={st.label} tone={st.tone} solid />
        <Muted>{`${r.cable ?? 'cable not given'} · depth required ${r.req_depth_m} m`}</Muted>
      </Row>
      {r.query_note && r.status === 'queried' ? <Notice tone={colors.red}>{`Query: ${r.query_note}`}</Notice> : null}
      {line.length > 1 || mapPts.length ? <SalesMap points={mapPts} lines={line.length > 1 ? [{ coords: line, color: '#C8102E', weight: 5 }] : []} fitKey={`${r.id}|${pts.length}|${walking ? 'w' : ''}`} height={380} maxZoom={19} /> : <Muted>The route shows here once you start walking it.</Muted>}

      {canRecord && open ? (
        <Card>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{walking ? `Recording · ${walked} m walked` : r.status === 'not_started' ? 'Walk the trench' : `${walked} m recorded`}</Text>
            {fix ? <Pill label={`GPS ±${fix[2]} m`} tone={fix[2] <= 5 ? colors.green : fix[2] <= MAX_ACC ? colors.amber : colors.red} /> : null}
          </Row>
          <Muted>{walking ? 'Walk along the cable in the open trench. Tap what you see – the GPS position is taken on the tap.' : 'Start at the panel end. The phone keeps a GPS fix every few metres; mark each depth (with photos) before the trench is backfilled.'}</Muted>
          {sendErr ? <Notice tone={colors.amber}>{`Not sent yet (kept on the phone, sent again with the next batch): ${sendErr}`}</Notice> : null}
          <Row style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {(Object.keys(POINT_KIND) as PointKind[]).map((k) => (
              <Button key={k} small variant={k === 'depth' ? 'primary' : 'secondary'} title={POINT_KIND[k].label} onPress={() => void mark(k)} />
            ))}
          </Row>
          <Row style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {walking ? <Button variant="secondary" title="Pause" onPress={() => void stop()} /> : <Button title={r.status === 'not_started' ? 'Start recording' : 'Go on recording'} onPress={() => void dialog.run(start)} />}
            {r.status !== 'not_started' ? <Button title={`Reached ${r.to_name} – finish`} onPress={() => void finish()} /> : null}
            <Button variant="secondary" small title="+ Photo" onPress={() => void addPhotos(null, fix)} />
          </Row>
        </Card>
      ) : null}

      <Section title="Summary">
        <Row style={{ flexWrap: 'wrap', gap: 8 }}>
          <Stat label="GPS length" value={`${S.len} m`} sub={r.schedule_m ? `schedule ${r.schedule_m} m` : undefined} />
          <Stat label="Drum cut" value={r.drum_m ? `${r.drum_m} m` : '–'} />
          <Stat label={`Depth – ${S.depths} points`} value={S.dmin != null ? `${S.dmin} – ${S.dmax} m` : '–'} tone={S.depths ? (S.shallow ? 'red' : 'green') : undefined} sub={S.depths ? (S.shallow ? `${S.shallow} shallower than ${r.req_depth_m} m` : `all ≥ ${r.req_depth_m} m`) : undefined} />
          <Stat label="Photos before backfill" value={String(S.photos)} tone={S.photos ? undefined : 'amber'} />
        </Row>
        <Card>
          <KeyValue label="Joints" value={String(S.joints)} />
          <KeyValue label="Road crossings" value={String(S.crossings)} />
          <KeyValue label="Ducts / sleeves" value={String(S.ducts)} />
          <KeyValue label="Marker posts" value={String(S.markers)} />
          <KeyValue label="Other services met" value={String(S.services)} />
          <KeyValue label="Insulation resistance after laying" value={r.ir_mohm != null ? `${r.ir_mohm} MΩ` : 'not recorded'} />
          <KeyValue label="Armour continuity" value={r.armour_ohm != null ? `${r.armour_ohm} Ω` : 'not recorded'} />
          <KeyValue label="Recorded by" value={`${name(r.recorded_by) || '–'}${r.started_at ? ` · ${fmtDate(r.started_at)}` : ''}${r.finished_at ? ` – ${fmtDate(r.finished_at)}` : ''}`} />
          <KeyValue label="Approved" value={r.approved_by ? `${name(r.approved_by)} · ${fmtDate(r.approved_at ?? '')}${r.approve_note ? ` – ${r.approve_note}` : ''}` : 'not yet'} />
        </Card>
        <Row style={{ flexWrap: 'wrap', gap: 6 }}>
          <Button variant="secondary" small title="PDF record" onPress={() => void pdf()} />
          <Button variant="secondary" small title="KML (Google Earth)" onPress={() => void dialog.run(() => shareKml(r, pts))} />
          <Button variant="secondary" small title="DXF as-built" onPress={() => void dialog.run(() => shareDxf(r, pts))} />
          {canRecord && r.status !== 'approved' ? <Button variant="secondary" small title="Edit details" onPress={() => void edit()} /> : null}
          {['senior_elec_engineer', 'sm_projects'].includes(me.role) && r.status !== 'approved' ? <Button variant="secondary" small title="Remove" onPress={() => void del()} /> : null}
        </Row>
        {canApprove && r.status === 'to_approve' ? (
          <Row style={{ gap: 8, marginTop: 6 }}>
            <Button variant="secondary" title="Query" onPress={() => void query()} />
            <Button title="Approve" onPress={() => void approve()} />
          </Row>
        ) : null}
      </Section>

      <Section title={`Points (${pts.length})`}>
        <Card>
          {ord.length ? (
            ord.map((p) => (
              <ListRow
                key={p.id}
                highlight={POINT_KIND[p.kind].color}
                title={`${POINT_KIND[p.kind].label}${p.depth_m != null ? ` · ${p.depth_m} m` : ''}${p.chain_m != null ? ` · ${Math.round(p.chain_m)} m from start` : ''}`}
                subtitle={[p.protection.map(protLabel).join(', '), p.tie_feature ? `${p.tie_m ?? '?'} m from ${p.tie_feature}` : '', p.note, `±${p.acc_m ?? '?'} m · ${fmtDateTime(p.taken_at)}`].filter(Boolean).join(' · ')}
                right={p.kind === 'depth' && p.depth_m != null ? <Pill label={p.depth_m < r.req_depth_m ? 'shallow' : 'ok'} tone={p.depth_m < r.req_depth_m ? colors.red : colors.green} /> : undefined}
                onPress={() => void delPoint(p)}
              />
            ))
          ) : (
            <Muted>No points yet.</Muted>
          )}
        </Card>
        {open && canRecord && ord.length ? <Muted>Tap a point to remove it while the route is open.</Muted> : null}
      </Section>

      <Section title={`Photos (${photos.length})`}>
        {photos.length ? (
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {photos.map((f) => (
              <View key={f.id} style={{ width: 140, gap: 2 }}>
                <Pressable
                  accessibilityLabel="Open the photo"
                  onPress={() => urls[f.path] && void Linking.openURL(urls[f.path])}
                  onLongPress={async () => {
                    if (!open || !canRecord || !(await dialog.confirm('Remove this photo?', undefined, { danger: true, confirmLabel: 'Remove' }))) return;
                    await dialog.run(async () => {
                      const path = await rpc<string>('aslaid_photo_delete', { p_id: f.id });
                      await supabase.storage.from('aslaid').remove([path]);
                    }, 'Removed');
                    await reload();
                  }}
                >
                  {urls[f.path] ? <Image source={{ uri: urls[f.path] }} style={{ width: 140, height: 105, borderRadius: 6, backgroundColor: colors.line }} contentFit="cover" /> : <View style={{ width: 140, height: 105, borderRadius: 6, backgroundColor: colors.line }} />}
                </Pressable>
                <Muted numberOfLines={2}>{`${f.note ? `${f.note} · ` : ''}${fmtDateTime(f.taken_at)}`}</Muted>
              </View>
            ))}
          </ScrollView>
        ) : (
          <Muted>No photos yet – take them at each depth point before backfill.</Muted>
        )}
      </Section>
    </Screen>
  );
}
