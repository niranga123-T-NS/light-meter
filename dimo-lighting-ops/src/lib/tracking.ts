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
