import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { MapProps } from './SalesMap.types';

// leaflet.heat is a classic plugin: it adds L.heatLayer to the global L
(globalThis as unknown as { L: typeof L }).L = L;
// (a plain require so it runs after L is set – an import would be hoisted above it)
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('leaflet.heat');
type HeatLayerFactory = (points: [number, number, number][], opts: Record<string, unknown>) => L.Layer;

const SRI_LANKA: L.LatLngTuple = [7.8731, 80.7718];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Leaflet map with OpenStreetMap tiles (web only): circles, numbered stops, lines and an optional heat layer. */
export function SalesMap({ points, lines = [], heat, fitKey, onOpen, height = 560 }: MapProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const open = useRef(onOpen);
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    open.current = onOpen;
  });

  // Create the map once
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { center: SRI_LANKA, zoom: 8, scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    // "Open" links inside popups go through the app's router
    const container = el.current;
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('[data-href]') as HTMLElement | null;
      if (a) {
        e.preventDefault();
        open.current?.(a.dataset.href as string);
      }
    };
    container.addEventListener('click', click);
    map.current = m;
    return () => {
      container.removeEventListener('click', click);
      m.remove();
      map.current = null;
    };
  }, []);

  // Draw the data
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const ln of lines) {
      if (ln.coords.length > 1) L.polyline(ln.coords, { color: ln.color, weight: ln.weight ?? 3, opacity: 0.8, dashArray: ln.dashed ? '6 6' : undefined }).addTo(g);
    }
    if (heat?.length) {
      const factory = (L as unknown as { heatLayer: HeatLayerFactory }).heatLayer;
      factory(heat, { radius: 22, blur: 18, maxZoom: 13, minOpacity: 0.35 }).addTo(g);
    }
    for (const p of points) {
      const html = `${p.label}${p.href ? `<div style="margin-top:6px"><a href="#" data-href="${esc(p.href)}" style="font-weight:600">Open</a></div>` : ''}`;
      const marker = p.number
        ? L.marker([p.lat, p.lng], {
            icon: L.divIcon({
              className: '',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
              html: `<div style="width:24px;height:24px;border-radius:12px;background:${p.color};color:#fff;font:700 12px sans-serif;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${p.number}</div>`,
            }),
          })
        : L.circleMarker([p.lat, p.lng], {
            radius: p.radius ?? 7,
            color: p.color,
            weight: p.hollow ? 2.5 : 1.5,
            fillColor: p.color,
            fillOpacity: p.hollow ? 0.08 : 0.75,
            dashArray: p.dashed ? '3 3' : undefined,
          });
      marker.bindPopup(html, { maxWidth: 320 }).addTo(g);
    }
    // Zoom to the data when the selection changes (not on every redraw)
    if (fitted.current !== fitKey) {
      const all: L.LatLngTuple[] = [...points.map((p) => [p.lat, p.lng] as L.LatLngTuple), ...lines.flatMap((l) => l.coords), ...(heat ?? []).map((h) => [h[0], h[1]] as L.LatLngTuple)];
      if (all.length) {
        m.fitBounds(L.latLngBounds(all), { padding: [30, 30], maxZoom: 15 });
        fitted.current = fitKey;
      }
    }
  }, [points, lines, heat, fitKey]);

  return <div ref={el} style={{ height, width: '100%', borderRadius: 10, overflow: 'hidden', border: '1px solid #E5E7EB', zIndex: 0 }} />;
}

export const mapEscape = esc;
