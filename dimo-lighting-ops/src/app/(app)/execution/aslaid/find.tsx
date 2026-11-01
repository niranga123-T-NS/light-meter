import * as Location from 'expo-location';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { SalesMap, mapEscape } from '@/components/SalesMap';
import type { MapLine, MapPoint } from '@/components/SalesMap.types';
import { Button, Card, colors, ErrorBanner, ListRow, Loading, Muted, Notice, Pill, Row, Screen, Section } from '@/components/ui';
import { ASLAID_STATUS, depthAt, nearestOn, POINT_KIND, protLabel, routeLine, type AslaidPoint, type AslaidRoute } from '@/lib/aslaid';
import { useLoad } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Proj = { id: string; code: string | null; name: string };

/** Years later: the cables recorded on every site the user can open, the nearest one from where they stand, its depth there and how it is tied. */
export default function FindCableScreen() {
  const [q, setQ] = useState('');
  const { data, error } = useLoad(async () => {
    const [r, p] = await Promise.all([supabase.from('exec_aslaid_routes').select('*').neq('status', 'not_started'), supabase.from('exec_projects').select('id, code, name')]);
    const routes = (r.data ?? []) as AslaidRoute[];
    const ids = routes.map((x) => x.id), pts: AslaidPoint[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data: d } = await supabase.from('exec_aslaid_points').select('*').in('route_id', ids.slice(i, i + 100));
      pts.push(...((d ?? []) as AslaidPoint[]));
    }
    return { routes, pts, projects: (p.data ?? []) as Proj[] };
  }, []);
  const [me, setMe] = useState<[number, number, number] | null>(null);
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setGpsErr('Allow location for this app to find the nearest cable.');
        return;
      }
      const s = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1500 }, (l) => setMe([l.coords.latitude, l.coords.longitude, Math.round((l.coords.accuracy ?? 99) * 10) / 10]));
      if (live) sub.current = s;
      else s.remove();
    })().catch((e) => setGpsErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
      sub.current?.remove();
    };
  }, []);

  const proj = useMemo(() => Object.fromEntries((data?.projects ?? []).map((p) => [p.id, p])), [data]);
  const ranked = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.routes
      .filter((r) => !s || `${r.from_name} ${r.to_name} ${r.code ?? ''} ${r.cable ?? ''} ${proj[r.exec_project_id]?.name ?? ''} ${proj[r.exec_project_id]?.code ?? ''}`.toLowerCase().includes(s))
      .map((r) => {
        const pts = data.pts.filter((p) => p.route_id === r.id), line = routeLine(r, pts), n = me ? nearestOn(line, [me[0], me[1]]) : null;
        return { r, pts, line, n, dep: n ? depthAt(line, pts, n.chain) : null };
      })
      .filter((x) => x.line.length)
      .sort((a, b) => (a.n?.d ?? 1e12) - (b.n?.d ?? 1e12));
  }, [data, q, me, proj]);
  const best = ranked[0];

  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  const near = ranked.filter((x) => (x.n?.d ?? 1e9) < 400).slice(0, 12);
  const lines: MapLine[] = near.map((x) => ({ coords: x.line, color: x === best ? '#15803D' : '#64748B', weight: x === best ? 6 : 3 }));
  const points: MapPoint[] = [];
  if (me) points.push({ lat: me[0], lng: me[1], color: '#1d4ed8', radius: 9, label: `You · ±${me[2]} m` });
  if (best?.n && best.n.d < 400) points.push({ lat: best.n.at[0], lng: best.n.at[1], color: '#C8102E', radius: 7, label: `<b>${mapEscape(`${best.r.from_name} → ${best.r.to_name}`)}</b><br>${Math.round(best.n.d * 10) / 10} m away` });
  near.forEach((x) => x.pts.filter((p) => p.kind === 'marker' || p.kind === 'joint').forEach((p) => points.push({ lat: p.lat, lng: p.lng, color: POINT_KIND[p.kind].color, radius: 5, label: POINT_KIND[p.kind].label })));
  const tie = best ? [...best.pts].filter((p) => p.tie_feature).sort((a, b) => Math.abs((a.chain_m ?? 0) - (best.n?.chain ?? 0)) - Math.abs((b.chain_m ?? 0) - (best.n?.chain ?? 0)))[0] : null;

  return (
    <Screen maxWidth={800}>
      <Stack.Screen options={{ title: 'Find a cable' }} />
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>Find a cable</Text>
      <Muted>Every cable route recorded on the sites you can open – the nearest from where you stand.</Muted>
      <TextInput value={q} onChangeText={setQ} placeholder="Site, route or cable (blank = all)" style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 8, padding: 10, color: colors.ink }} />
      {gpsErr ? <ErrorBanner message={gpsErr} /> : !me ? <Muted>Waiting for a GPS fix…</Muted> : null}
      {lines.length || points.length ? <SalesMap points={points} lines={lines} fitKey={`${best?.r.id ?? ''}|${me ? 'm' : ''}|${q}`} height={360} maxZoom={19} onOpen={(h) => router.push(h as never)} /> : null}
      {best?.n && me ? (
        <Card>
          <Row style={{ gap: 12, alignItems: 'center' }}>
            <View style={{ width: 72, height: 72, borderRadius: 14, backgroundColor: '#fde8eb', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: '700', color: colors.red }}>{best.n.d < 100 ? (Math.round(best.n.d * 10) / 10).toFixed(1) : String(Math.round(best.n.d))}</Text>
              <Text style={{ fontSize: 10, color: colors.red }}>m away</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{`${best.r.from_name} → ${best.r.to_name}`}</Text>
              <Muted>{`${proj[best.r.exec_project_id]?.name ?? ''} · ${best.r.cable ?? ''} · ${ASLAID_STATUS[best.r.status].label}`}</Muted>
              <Muted>{best.dep ? `Here about ${Math.round(best.dep.d * 100) / 100} m deep${best.dep.between ? ' (between depth points)' : ' (nearest depth point)'}${best.dep.p.protection.length ? ` · ${best.dep.p.protection.map(protLabel).join(', ')}` : ''}` : 'No depth recorded on this route'}</Muted>
              {tie ? <Muted>{`Tie: ${tie.tie_m ?? '?'} m from ${tie.tie_feature}`}</Muted> : null}
            </View>
          </Row>
          <Notice tone={colors.amber}>{`Phone GPS here ±${me[2]} m, recorded ±${best.pts[0]?.acc_m ?? 3} m. Confirm with a cable locator and hand-dig trial holes before any machine digging (HSG47).`}</Notice>
          <Row style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" title="Open the record" onPress={() => router.push(`/execution/aslaid/${best.r.id}`)} />
            <Button variant="secondary" title="Navigate" onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${best.n?.at[0]},${best.n?.at[1]}`)} />
          </Row>
        </Card>
      ) : null}
      <Section title={`Cable routes (${ranked.length})`}>
        <Card>
          {ranked.slice(0, 40).map((x) => (
            <ListRow
              key={x.r.id}
              highlight={ASLAID_STATUS[x.r.status].tone}
              title={`${x.r.from_name} → ${x.r.to_name}`}
              subtitle={`${proj[x.r.exec_project_id]?.code ?? ''} ${proj[x.r.exec_project_id]?.name ?? ''} · ${Math.round(x.r.gps_m)} m${x.n ? ` · ${x.n.d < 1000 ? `${Math.round(x.n.d)} m` : `${Math.round(x.n.d / 100) / 10} km`} away` : ''}`}
              right={<Pill label={ASLAID_STATUS[x.r.status].label} tone={ASLAID_STATUS[x.r.status].tone} />}
              wrapRight
              onPress={() => router.push(`/execution/aslaid/${x.r.id}`)}
            />
          ))}
          {!ranked.length ? <Muted>No recorded cable routes on your sites yet.</Muted> : null}
        </Card>
      </Section>
    </Screen>
  );
}
