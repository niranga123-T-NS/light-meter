import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { colors, Muted, Row } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { findPlace, type Place } from '@/lib/places';
import { estimatedPosition } from '@/lib/tracking';
import type { RouteMapProps } from './RouteMap.types';

const C = { factory: '#D97706', inland: '#D97706', sea: '#1D4ED8', air: '#7C3AED', via: '#60A5FA', lk: '#15803D', site: '#15803D', pos: '#C8102E', trail: '#9CA3AF' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

type Resolved = { factories: (Place | null)[]; pol: Place | null; vias: (Place | null)[]; pod: Place | null; site: Place | null };

function Key({ color, label, dash }: { color: string; label: string; dash?: boolean }) {
  return (
    <Row gap={6} style={{ alignItems: 'center' }}>
      <View style={{ width: 22, height: 0, borderTopWidth: 3, borderColor: color, borderStyle: dash ? 'dashed' : 'solid' }} />
      <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
    </Row>
  );
}

/**
 * The route of a shipment on a map: the factory and the inland leg to the loading port (dashed), the loading port or airport,
 * the transit ports, the Sri Lankan port or airport, the delivery to site (dashed), and the last known positions recorded by Ops.
 * Places are found from the names already entered (built-in ports and airports, then OpenStreetMap).
 */
export function RouteMap(p: RouteMapProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [res, setRes] = useState<Resolved | null>(null);
  const found = useRef(p.onFactoryFound);
  useEffect(() => {
    found.current = p.onFactoryFound;
  });
  const key = JSON.stringify([p.mode, p.factories, p.pol, p.vias, p.pod, p.site]);

  // Find the places
  useEffect(() => {
    let live = true;
    (async () => {
      const mode = p.mode;
      const factories = await Promise.all(
        p.factories.map(async (f, i) => {
          if (f.lat != null && f.lng != null) return { name: f.location ?? 'Factory', lat: f.lat, lng: f.lng, kind: 'place' as const };
          const hit = await findPlace(f.location, { known: false });
          if (hit) found.current?.(i, { lat: hit.lat, lng: hit.lng });
          return hit;
        }),
      );
      const [pol, pod, site, ...vias] = await Promise.all([
        findPlace(p.pol, { mode }),
        findPlace(p.pod ?? (mode === 'sea' ? 'Colombo' : 'CMB'), { mode }),
        findPlace(p.site, { sriLanka: true, known: false }),
        ...p.vias.map((v) => findPlace(v, { mode })),
      ]);
      if (live) setRes({ factories, pol, vias, pod, site });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Create the map once
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: [15, 75], zoom: 3, scrollWheelZoom: false, worldCopyJump: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Draw
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g || !res) return;
    g.clearLayers();
    const pts: L.LatLngTuple[] = [];
    const dot = (pl: Place, color: string, label: string, r = 7) => {
      const ll: L.LatLngTuple = [pl.lat, pl.lng];
      pts.push(ll);
      L.circleMarker(ll, { radius: r, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 })
        .bindTooltip(esc(label), { direction: 'top', offset: [0, -6] })
        .addTo(g);
    };
    const line = (a: Place, b: Place, color: string, dash?: string, label?: string) => {
      const l = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color, weight: 3, opacity: 0.85, dashArray: dash });
      if (label) l.bindTooltip(esc(label), { sticky: true });
      l.addTo(g);
    };
    // inland abroad: factory → loading port
    res.factories.forEach((f, i) => {
      if (!f) return;
      const info = p.factories[i];
      dot(f, C.factory, `Factory – ${info.label}${info.location ? ` (${info.location})` : ''}`, 8);
      if (res.pol) line(f, res.pol, C.inland, '6 6', info.inland === 'manufacturer' ? 'Inland transport by the manufacturer (CIF)' : 'Inland transport by the forwarder');
    });
    // main leg: loading port → transit → Sri Lanka
    const legColor = p.mode === 'sea' ? C.sea : C.air;
    const chain = [res.pol, ...res.vias, res.pod].filter((x): x is Place => !!x);
    for (let i = 0; i + 1 < chain.length; i++) line(chain[i], chain[i + 1], legColor, p.mode === 'sea' ? undefined : '2 8', p.mode === 'sea' ? 'Sea freight' : 'Air freight');
    if (res.pol) dot(res.pol, legColor, `Loading ${p.mode === 'sea' ? 'port' : 'airport'} – ${res.pol.name}`);
    res.vias.forEach((v) => v && dot(v, C.via, `Transit – ${v.name}`, 6));
    if (res.pod) dot(res.pod, C.lk, `Arrival in Sri Lanka – ${res.pod.name}`, 8);
    // Sri Lanka: port / airport → site
    if (res.pod && res.site) {
      line(res.pod, res.site, C.site, '4 6', 'Delivery to site');
      dot(res.site, C.site, `Delivery – ${p.site}`, 6);
    }
    // estimated position from the ETD and ETA (no live tracking)
    if (!p.arrived && p.mode === 'sea') {
      const est = estimatedPosition(chain, p.etd, p.eta);
      if (est) {
        pts.push([est.lat, est.lng]);
        L.circleMarker([est.lat, est.lng], { radius: 9, color: C.pos, weight: 2, dashArray: '3 3', fillColor: '#fff', fillOpacity: 0.9 })
          .bindTooltip(esc(`Estimated position today – ${Math.round(est.share * 100)}% of the way (from ETD and ETA, not tracked)`), { direction: 'bottom', offset: [0, 8] })
          .addTo(g);
      }
    }
    // last known positions (recorded by Ops)
    const pos = [...p.positions].sort((a, b) => a.at.localeCompare(b.at));
    if (pos.length > 1) L.polyline(pos.map((x) => [x.lat, x.lng] as L.LatLngTuple), { color: C.trail, weight: 2, dashArray: '1 6' }).addTo(g);
    pos.forEach((x, i) => {
      const last = i === pos.length - 1;
      pts.push([x.lat, x.lng]);
      L.circleMarker([x.lat, x.lng], { radius: last ? 9 : 4, color: '#fff', weight: 2, fillColor: last ? C.pos : C.trail, fillOpacity: 1 })
        .bindTooltip(esc(`${last ? 'Last known position' : 'Position'}: ${x.place} · ${fmtDateTime(x.at)}${x.note ? ` · ${x.note}` : ''}`), { direction: 'top', permanent: last && !p.arrived, offset: [0, -8] })
        .addTo(g);
    });
    if (pts.length) m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 7 });
  }, [res, p.positions, p.factories, p.mode, p.site, p.arrived, p.etd, p.eta]);

  const missing = res
    ? [
        ...p.factories.filter((f, i) => f.location && !res.factories[i]).map((f) => `factory "${f.location}"`),
        p.pol && !res.pol ? `"${p.pol}"` : null,
        ...p.vias.filter((v, i) => !res.vias[i]).map((v) => `"${v}"`),
        p.site && !res.site ? `site "${p.site}"` : null,
      ].filter(Boolean)
    : [];
  return (
    <View style={{ gap: 6 }}>
      <div ref={el} style={{ height: p.height ?? 380, width: '100%', borderRadius: 10, overflow: 'hidden', border: '1px solid #E5E7EB', zIndex: 0 }} />
      <Row wrap gap={14}>
        <Key color={C.inland} label="Inland – factory to port" dash />
        <Key color={p.mode === 'sea' ? C.sea : C.air} label={p.mode === 'sea' ? 'Sea freight' : 'Air freight'} dash={p.mode !== 'sea'} />
        <Key color={C.site} label="Sri Lanka – delivery to site" dash />
        <Key color={C.pos} label="Last known position (recorded)" />
        {p.mode === 'sea' ? <Key color={C.pos} label="Estimated position (from ETD / ETA)" dash /> : null}
      </Row>
      {missing.length ? <Muted>{`Not found on the map: ${missing.join(', ')} – check the spelling (city, country).`}</Muted> : null}
      <Muted>The lines show the route, not the exact sailing or flight path.</Muted>
    </View>
  );
}
