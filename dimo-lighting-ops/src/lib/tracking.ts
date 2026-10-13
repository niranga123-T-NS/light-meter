import type { Shipment } from './foreignOrders';

/**
 * One-tap tracking links for a shipment (no live feed): the vessel on MarineTraffic and VesselFinder by its IMO / MMSI number,
 * the container or B/L on the shipping line's own tracking page, or the flight on Flightradar24.
 */
export type TrackLink = { label: string; url: string; copy?: string };

const LINES: { match: RegExp; name: string; url: (no: string) => string }[] = [
  { match: /maersk|sealand/i, name: 'Maersk', url: (n) => `https://www.maersk.com/tracking/${encodeURIComponent(n)}` },
  { match: /\bmsc\b|mediterranean/i, name: 'MSC', url: (n) => `https://www.msc.com/en/track-a-shipment?trackingNumber=${encodeURIComponent(n)}` },
  { match: /cma|cgm|anl|apl/i, name: 'CMA CGM', url: (n) => `https://www.cma-cgm.com/ebusiness/tracking/search?SearchBy=Container&Reference=${encodeURIComponent(n)}` },
  { match: /hapag|hlcu/i, name: 'Hapag-Lloyd', url: (n) => `https://www.hapag-lloyd.com/en/online-business/track/track-by-container-solution.html?container=${encodeURIComponent(n)}` },
  { match: /\bone\b|ocean network/i, name: 'ONE', url: (n) => `https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam=${encodeURIComponent(n)}` },
  { match: /cosco|oocl/i, name: 'COSCO / OOCL', url: (n) => `https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=CONTAINER&number=${encodeURIComponent(n)}` },
  { match: /evergreen|eglv/i, name: 'Evergreen', url: () => 'https://ct.shipmentlink.com/servlet/TDB1_CargoTracking.do' },
  { match: /yang ?ming|ymlu/i, name: 'Yang Ming', url: () => 'https://www.yangming.com/e-service/track_trace/track_trace_cargo_tracking.aspx' },
  { match: /\bzim\b/i, name: 'ZIM', url: (n) => `https://www.zim.com/tools/track-a-shipment?consnumber=${encodeURIComponent(n)}` },
  { match: /\bhmm\b|hyundai/i, name: 'HMM', url: () => 'https://www.hmm21.com/e-service/general/trackNTrace/TrackNTrace.do' },
  { match: /\bpil\b|pacific international/i, name: 'PIL', url: () => 'https://www.pilship.com/en--/120.html' },
];

export function trackingLinks(s: Pick<Shipment, 'mode' | 'carrier' | 'vessel_flight' | 'bl_awb' | 'etd'> & { imo?: string | null; mmsi?: string | null; container_nos?: string | null }): TrackLink[] {
  const out: TrackLink[] = [];
  if (s.mode === 'air') {
    const flight = (s.vessel_flight ?? '').replace(/\s+/g, '').toLowerCase();
    if (flight) out.push({ label: `Flight ${s.vessel_flight} – Flightradar24`, url: `https://www.flightradar24.com/data/flights/${encodeURIComponent(flight)}` });
    if (s.bl_awb) out.push({ label: `AWB ${s.bl_awb} – track-trace`, url: 'https://www.track-trace.com/aircargo', copy: s.bl_awb });
    return out;
  }
  const id = s.imo ? `imo:${s.imo}` : s.mmsi ? `mmsi:${s.mmsi}` : null;
  if (id) out.push({ label: 'Vessel – MarineTraffic', url: `https://www.marinetraffic.com/en/ais/details/ships/${id}` });
  else if (s.vessel_flight) out.push({ label: 'Vessel – MarineTraffic', url: `https://www.marinetraffic.com/en/ais/index/search/all/keyword:${encodeURIComponent(s.vessel_flight)}` });
  if (s.imo || s.mmsi) out.push({ label: 'Vessel – VesselFinder', url: `https://www.vesselfinder.com/vessels/details/${s.imo ?? s.mmsi}` });
  else if (s.vessel_flight) out.push({ label: 'Vessel – VesselFinder', url: `https://www.vesselfinder.com/vessels?name=${encodeURIComponent(s.vessel_flight)}` });
  const no = (s.container_nos ?? '').split(/[,;\s]+/).filter(Boolean)[0] ?? s.bl_awb ?? '';
  const line = LINES.find((l) => l.match.test(`${s.carrier ?? ''} ${s.bl_awb ?? ''} ${s.container_nos ?? ''}`));
  if (no && line) out.push({ label: `${line.name} – container / B/L ${no}`, url: line.url(no), copy: no });
  else if (no) out.push({ label: `Container / B/L ${no} – track-trace`, url: 'https://www.track-trace.com/container', copy: no });
  return out;
}

type Pt = { lat: number; lng: number };
const rad = (d: number) => (d * Math.PI) / 180;
const km = (a: Pt, b: Pt) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** Where the ship should be now along the route (loading port → transit → Sri Lanka), from the ETD and ETA – an estimate only */
export function estimatedPosition(route: Pt[], etd: string | null, eta: string | null, now = Date.now()): (Pt & { share: number }) | null {
  if (route.length < 2 || !etd || !eta) return null;
  const t0 = Date.parse(`${etd}T12:00:00+05:30`);
  const t1 = Date.parse(`${eta}T12:00:00+05:30`);
  if (!(t1 > t0) || now <= t0 || now >= t1) return null;
  const share = (now - t0) / (t1 - t0);
  const legs = route.slice(1).map((p, i) => km(route[i], p));
  let left = share * legs.reduce((t, x) => t + x, 0);
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i] || i === legs.length - 1) {
      const f = legs[i] ? Math.min(1, left / legs[i]) : 0;
      return { lat: route[i].lat + (route[i + 1].lat - route[i].lat) * f, lng: route[i].lng + (route[i + 1].lng - route[i].lng) * f, share };
    }
    left -= legs[i];
  }
  return null;
}

/** Share of the voyage done today (0–1) from the ETD and ETA, or null outside the voyage */
export function voyageShare(etd: string | null, eta: string | null, now = Date.now()) {
  if (!etd || !eta) return null;
  const t0 = Date.parse(`${etd}T12:00:00+05:30`);
  const t1 = Date.parse(`${eta}T12:00:00+05:30`);
  return t1 > t0 && now > t0 && now < t1 ? (now - t0) / (t1 - t0) : null;
}

/**
 * Sea lanes: the main shipping routes between Europe, the Gulf, South Asia and East Asia as waypoints (Gibraltar, Suez, Bab-el-Mandeb,
 * Hormuz, south of India and Sri Lanka, Malacca, Singapore …), so a sea route and its estimated position stay on water.
 */
const NODES: Record<string, Pt> = {
  DV: { lat: 51.0, lng: 1.6 }, EC: { lat: 50.2, lng: -1.0 }, US: { lat: 48.6, lng: -5.8 }, FI: { lat: 43.3, lng: -9.9 }, LB: { lat: 38.7, lng: -9.9 },
  GI: { lat: 35.95, lng: -5.6 }, WM: { lat: 38.3, lng: 5.0 }, TY: { lat: 40.0, lng: 12.0 }, M1: { lat: 37.4, lng: 11.4 }, OT: { lat: 39.6, lng: 18.9 }, AD: { lat: 42.0, lng: 16.5 }, M2: { lat: 34.2, lng: 25.0 },
  AE: { lat: 37.3, lng: 25.4 }, DA: { lat: 40.2, lng: 26.2 }, PS: { lat: 31.6, lng: 32.3 }, SZ: { lat: 29.8, lng: 32.6 }, RS: { lat: 20.5, lng: 38.4 },
  BM: { lat: 12.6, lng: 43.4 }, GA: { lat: 12.3, lng: 47.5 }, SO: { lat: 12.6, lng: 53.5 }, SB: { lat: 3.0, lng: 52.0 }, RH: { lat: 22.4, lng: 60.2 },
  GO: { lat: 25.0, lng: 57.8 }, HZ: { lat: 26.4, lng: 56.5 }, PG: { lat: 26.8, lng: 52.5 }, WI: { lat: 15.0, lng: 72.3 }, CK: { lat: 7.2, lng: 76.9 },
  CW: { lat: 6.3, lng: 79.5 }, DN: { lat: 5.6, lng: 80.6 }, ES: { lat: 8.0, lng: 82.4 }, BB: { lat: 15.0, lng: 87.0 }, MN: { lat: 6.2, lng: 95.3 },
  MS: { lat: 3.0, lng: 100.6 }, SG: { lat: 1.2, lng: 104.0 }, GT: { lat: 9.0, lng: 102.5 }, VN: { lat: 10.0, lng: 109.6 }, HK: { lat: 21.4, lng: 115.0 },
  TS: { lat: 24.2, lng: 119.6 }, EA: { lat: 29.5, lng: 124.0 }, YS: { lat: 35.0, lng: 123.5 }, JP: { lat: 33.2, lng: 129.0 }, JV: { lat: -5.0, lng: 108.0 },
};
const EDGES = ('DV-EC EC-US US-FI FI-LB LB-GI GI-WM WM-M1 WM-TY TY-M1 M1-OT OT-AD OT-M2 M1-M2 M2-AE AE-DA M2-PS PS-SZ SZ-RS RS-BM BM-GA GA-SO SO-SB SB-CK SO-CK SO-WI SO-RH '
  + 'RH-GO GO-HZ HZ-PG RH-WI WI-CK CK-CW CW-DN DN-ES ES-BB DN-MN BB-MN MN-MS MS-SG SG-GT GT-VN SG-VN SG-JV VN-HK HK-TS TS-EA EA-YS EA-JP').split(' ').map((e) => e.split('-'));

export function seaLane(a: Pt, b: Pt): Pt[] {
  const near = (p: Pt) => {
    let best: { k: string; d: number } | null = null;
    for (const [k, n] of Object.entries(NODES)) {
      const d = km(p, n);
      if (!best || d < best.d) best = { k, d };
    }
    return best && best.d < 2500 ? best.k : null;
  };
  const na = near(a);
  const nb = near(b);
  if (!na || !nb || na === nb || km(a, b) < Math.min(km(a, NODES[na]), km(b, NODES[nb]))) return [a, b];
  // shortest way through the lanes (Dijkstra on a small graph)
  const dist: Record<string, number> = { [na]: 0 };
  const prev: Record<string, string> = {};
  const todo = new Set(Object.keys(NODES));
  while (todo.size) {
    let u: string | null = null;
    for (const k of todo) if (dist[k] != null && (u == null || dist[k] < dist[u])) u = k;
    if (u == null || u === nb) break;
    todo.delete(u);
    for (const [x, y] of EDGES) {
      const v = x === u ? y : y === u ? x : null;
      if (!v || !todo.has(v)) continue;
      const d = dist[u] + km(NODES[u], NODES[v]);
      if (dist[v] == null || d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (dist[nb] == null) return [a, b];
  const path: Pt[] = [];
  for (let k: string | undefined = nb; k; k = prev[k]) path.unshift(NODES[k]);
  return [a, ...path, b];
}

/** A sea route through the lanes (ports in order); other modes fly straight */
export const lanePath = (ports: Pt[], mode: string) =>
  mode !== 'sea' ? ports : ports.slice(1).reduce<Pt[]>((out, p, i) => [...out, ...seaLane(ports[i], p).slice(out.length ? 1 : 0)], []);
