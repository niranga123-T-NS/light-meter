// As-laid cable routes: what is recorded on site before backfill, the geometry (lengths, chainage, the nearest point of a route)
// and the records that go out (PDF, KML for Google Earth, DXF as-built).
import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { esc, printHtml, saveWebFile } from './export';
import { fmtDate } from './format';

export type AslaidStatus = 'not_started' | 'recording' | 'to_approve' | 'approved' | 'queried';
export type Fix = [number, number, number, number]; // lat, lng, accuracy m, epoch ms
export type AslaidRoute = {
  id: string;
  exec_project_id: string;
  code: string | null;
  from_name: string;
  to_name: string;
  cable: string | null;
  schedule_ref: string | null;
  schedule_m: number | null;
  drum_m: number | null;
  req_depth_m: number;
  status: AslaidStatus;
  track: Fix[];
  gps_m: number;
  ir_mohm: number | null;
  armour_ohm: number | null;
  query_note: string | null;
  approve_note: string | null;
  recorded_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};
export type PointKind = 'depth' | 'joint' | 'crossing' | 'duct' | 'marker' | 'service' | 'other';
export type AslaidPoint = {
  id: string;
  route_id: string;
  kind: PointKind;
  lat: number;
  lng: number;
  acc_m: number | null;
  chain_m: number | null;
  depth_m: number | null;
  protection: string[];
  tie_feature: string | null;
  tie_m: number | null;
  note: string | null;
  taken_by: string | null;
  taken_at: string;
};
export type AslaidPhoto = { id: string; route_id: string; point_id: string | null; path: string; note: string | null; lat: number | null; lng: number | null; taken_by: string | null; taken_at: string };

export const ASLAID_STATUS: Record<AslaidStatus, { label: string; tone: string }> = {
  not_started: { label: 'Not started', tone: '#6B7280' },
  recording: { label: 'Recording · trench open', tone: '#B45309' },
  to_approve: { label: 'Backfilled · to approve', tone: '#1D4ED8' },
  queried: { label: 'Queried', tone: '#C8102E' },
  approved: { label: 'Approved', tone: '#15803D' },
};
export const POINT_KIND: Record<PointKind, { label: string; color: string; short: string }> = {
  depth: { label: 'Depth', color: '#C8102E', short: 'P' },
  joint: { label: 'Joint', color: '#7C3AED', short: 'J' },
  crossing: { label: 'Road crossing', color: '#B45309', short: 'X' },
  duct: { label: 'Duct / sleeve', color: '#0E7490', short: 'D' },
  marker: { label: 'Marker post', color: '#15803D', short: 'M' },
  service: { label: 'Other service', color: '#1D4ED8', short: 'S' },
  other: { label: 'Other', color: '#475569', short: 'O' },
};
export const PROTECTION: { value: string; label: string }[] = [
  { value: 'sand', label: 'Sand bed' },
  { value: 'tiles', label: 'Cable tiles' },
  { value: 'tape', label: 'Warning tape' },
  { value: 'duct', label: 'In duct' },
  { value: 'concrete', label: 'Concrete cover' },
  { value: 'marker', label: 'Marker post' },
];
export const protLabel = (v: string) => PROTECTION.find((p) => p.value === v)?.label ?? v;

// ---- geometry: metres on the ground (haversine), a local plane round a point for the drawing and the nearest point
const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
export function metres(a: [number, number], b: [number, number]) {
  const la1 = rad(a[0]), la2 = rad(b[0]), h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const trackLen = (t: [number, number][]) => t.reduce((s, q, i) => (i ? s + metres(t[i - 1], q) : 0), 0);
/** east / north metres from an origin */
export function toLocal(o: [number, number], p: [number, number]): [number, number] {
  return [rad(p[1] - o[1]) * R * Math.cos(rad(o[0])), rad(p[0] - o[0]) * R];
}
/** the route's line: the walked track, or the points in order when there is no track */
export function routeLine(r: AslaidRoute, pts: AslaidPoint[]): [number, number][] {
  if (r.track?.length >= 2) return r.track.map((q) => [q[0], q[1]]);
  return [...pts].sort((a, b) => (a.chain_m ?? 0) - (b.chain_m ?? 0) || a.taken_at.localeCompare(b.taken_at)).map((p) => [p.lat, p.lng]);
}
/** the nearest point of a line to p: distance, chainage along the line and the point */
export function nearestOn(line: [number, number][], p: [number, number]) {
  if (!line.length) return null;
  if (line.length === 1) return { d: metres(line[0], p), chain: 0, at: line[0] };
  const o = line[0], L = line.map((q) => toLocal(o, q)), P = toLocal(o, p);
  let best = { d: Infinity, chain: 0, at: line[0] as [number, number] }, acc = 0;
  for (let i = 1; i < L.length; i++) {
    const a = L[i - 1], b = L[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9, u = Math.max(0, Math.min(1, ((P[0] - a[0]) * dx + (P[1] - a[1]) * dy) / l2)), x = a[0] + u * dx, y = a[1] + u * dy, d = Math.hypot(P[0] - x, P[1] - y), seg = Math.sqrt(l2);
    if (d < best.d) best = { d, chain: acc + u * seg, at: [line[i - 1][0] + u * (line[i][0] - line[i - 1][0]), line[i - 1][1] + u * (line[i][1] - line[i - 1][1])] };
    acc += seg;
  }
  return best;
}
/** the depth near a chainage: from the nearest depth points either side (straight between them) */
export function depthAt(line: [number, number][], pts: AslaidPoint[], chain: number) {
  const ds = pts.filter((p) => p.kind === 'depth' && p.depth_m != null).map((p) => ({ c: nearestOn(line, [p.lat, p.lng])?.chain ?? 0, d: Number(p.depth_m), p })).sort((a, b) => a.c - b.c);
  if (!ds.length) return null;
  const after = ds.find((x) => x.c >= chain), before = [...ds].reverse().find((x) => x.c <= chain);
  if (before && after && after.c > before.c) return { d: before.d + ((after.d - before.d) * (chain - before.c)) / (after.c - before.c), p: Math.abs(chain - before.c) < Math.abs(after.c - chain) ? before.p : after.p, between: true };
  const n = before ?? after;
  return n ? { d: n.d, p: n.p, between: false } : null;
}
export function summary(r: AslaidRoute, pts: AslaidPoint[], photos: AslaidPhoto[]) {
  const ds = pts.filter((p) => p.kind === 'depth' && p.depth_m != null).map((p) => Number(p.depth_m)), line = routeLine(r, pts);
  const count = (k: PointKind) => pts.filter((p) => p.kind === k).length;
  return {
    len: Math.round(r.gps_m || trackLen(line)),
    depths: ds.length,
    dmin: ds.length ? Math.min(...ds) : null,
    dmax: ds.length ? Math.max(...ds) : null,
    shallow: ds.filter((d) => d < r.req_depth_m).length,
    joints: count('joint'),
    crossings: count('crossing'),
    ducts: count('duct'),
    markers: count('marker'),
    services: count('service'),
    photos: photos.length,
  };
}

// ---- records out
const saveText = async (name: string, text: string, mime: string, title: string) => {
  if (Platform.OS === 'web') return saveWebFile(new Blob([text], { type: mime }), name, title);
  const f = new FsFile(Paths.cache, name);
  f.create({ overwrite: true });
  f.write(text);
  await Sharing.shareAsync(f.uri, { mimeType: mime, dialogTitle: title });
};
const fileBase = (r: AslaidRoute) => `${r.code ? `${r.code} ` : ''}${r.from_name} to ${r.to_name}`.replace(/[^A-Za-z0-9 ._-]+/g, '-').trim();
const x = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);

export async function shareKml(r: AslaidRoute, pts: AslaidPoint[]) {
  const line = routeLine(r, pts);
  const pm = pts.map((p) => `<Placemark><name>${x(POINT_KIND[p.kind].short)} ${x(p.kind === 'depth' ? `${p.depth_m} m` : POINT_KIND[p.kind].label)}</name><description>${x([p.note, p.protection.map(protLabel).join(', '), p.tie_feature ? `${p.tie_m ?? ''} m from ${p.tie_feature}` : ''].filter(Boolean).join(' · '))}</description><Point><coordinates>${p.lng},${p.lat},0</coordinates></Point></Placemark>`).join('');
  const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(fileBase(r))}</name><Style id="c"><LineStyle><color>ff2e10c8</color><width>4</width></LineStyle></Style><Placemark><name>${x(`${r.from_name} → ${r.to_name}`)}</name><description>${x(`${r.cable ?? ''} · ${Math.round(r.gps_m)} m as laid · ${ASLAID_STATUS[r.status].label}`)}</description><styleUrl>#c</styleUrl><LineString><tessellate>1</tessellate><coordinates>${line.map((q) => `${q[1]},${q[0]},0`).join(' ')}</coordinates></LineString></Placemark>${pm}</Document></kml>`;
  await saveText(`${fileBase(r)}.kml`, kml, 'application/vnd.google-earth.kml+xml', 'Cable route (KML)');
}

/** DXF R12 in metres east / north of the route's start, with its latitude and longitude written on the drawing */
export async function shareDxf(r: AslaidRoute, pts: AslaidPoint[]) {
  const line = routeLine(r, pts);
  if (!line.length) throw new Error('Nothing recorded yet');
  const o = line[0], g: string[] = [], put = (...a: (string | number)[]) => a.forEach((v) => g.push(String(v)));
  put(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC', 0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, 4);
  [['CABLE-AS-LAID', 1], ['POINTS', 3], ['TEXT', 7]].forEach(([n, c]) => put(0, 'LAYER', 2, n, 70, 0, 62, c, 6, 'CONTINUOUS'));
  put(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES', 0, 'POLYLINE', 8, 'CABLE-AS-LAID', 66, 1, 70, 0);
  line.forEach((q) => { const [e, n] = toLocal(o, q); put(0, 'VERTEX', 8, 'CABLE-AS-LAID', 10, e.toFixed(3), 20, n.toFixed(3)); });
  put(0, 'SEQEND');
  pts.forEach((p) => { const [e, n] = toLocal(o, [p.lat, p.lng]); put(0, 'CIRCLE', 8, 'POINTS', 10, e.toFixed(3), 20, n.toFixed(3), 40, 0.5, 0, 'TEXT', 8, 'TEXT', 10, (e + 0.8).toFixed(3), 20, (n + 0.3).toFixed(3), 40, 0.6, 1, `${POINT_KIND[p.kind].short} ${p.kind === 'depth' ? `${p.depth_m} m` : POINT_KIND[p.kind].label}`.slice(0, 60)); });
  put(0, 'TEXT', 8, 'TEXT', 10, 0, 20, -2, 40, 0.8, 1, `${r.from_name} - ${r.to_name}: origin ${o[0].toFixed(7)} N ${o[1].toFixed(7)} E, metres east / north`.slice(0, 200));
  put(0, 'ENDSEC', 0, 'EOF');
  await saveText(`${fileBase(r)} as-built.dxf`, g.join('\n') + '\n', 'application/dxf', 'Cable route (DXF)');
}

/** the route's record as a PDF: the line drawn to scale with its points, the depth table, the checks, the tests and the sign-off */
export async function printRecord(r: AslaidRoute, pts: AslaidPoint[], photos: AslaidPhoto[], urls: Record<string, string>, name: (id: string | null) => string, project: string) {
  const S = summary(r, pts, photos), line = routeLine(r, pts), o = line[0] ?? [0, 0], L = line.map((q) => toLocal(o, q)), P = pts.map((p) => ({ p, q: toLocal(o, [p.lat, p.lng]) }));
  const all = [...L, ...P.map((v) => v.q)], xs = all.map((q) => q[0]), ys = all.map((q) => q[1]), x0 = Math.min(0, ...xs), x1 = Math.max(1, ...xs), y0 = Math.min(0, ...ys), y1 = Math.max(1, ...ys), W = 700, H = 360, k = Math.min((W - 60) / (x1 - x0 || 1), (H - 60) / (y1 - y0 || 1));
  const X = (e: number) => 30 + (e - x0) * k, Y = (n: number) => H - 30 - (n - y0) * k;
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="border:1px solid #ddd;border-radius:6px"><polyline points="${L.map((q) => `${X(q[0])},${Y(q[1])}`).join(' ')}" fill="none" stroke="#C8102E" stroke-width="3"/>${P.map(({ p, q }) => `<circle cx="${X(q[0])}" cy="${Y(q[1])}" r="5" fill="${POINT_KIND[p.kind].color}"/><text x="${X(q[0]) + 7}" y="${Y(q[1]) - 6}" font-size="10">${esc(POINT_KIND[p.kind].short)}${p.kind === 'depth' ? ` ${p.depth_m}` : ''}</text>`).join('')}<text x="${W - 30}" y="20" font-size="11" text-anchor="end">N ↑ · scale bar 10 m</text><line x1="${W - 30 - 10 * k}" y1="28" x2="${W - 30}" y2="28" stroke="#111" stroke-width="2"/></svg>`;
  const rows = [...pts].sort((a, b) => (a.chain_m ?? 0) - (b.chain_m ?? 0)).map((p) => `<tr><td>${esc(POINT_KIND[p.kind].label)}</td><td>${p.chain_m != null ? Math.round(p.chain_m) : '–'}</td><td>${p.depth_m ?? '–'}</td><td>${esc(p.protection.map(protLabel).join(', '))}</td><td>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} ±${p.acc_m ?? '?'} m</td><td>${esc([p.tie_feature ? `${p.tie_m ?? ''} m from ${p.tie_feature}` : '', p.note].filter(Boolean).join(' · '))}</td></tr>`).join('');
  const ph = photos.slice(0, 24).map((f) => (urls[f.path] ? `<figure style="display:inline-block;width:31%;margin:0 1% 8px 0;vertical-align:top"><img src="${urls[f.path]}" style="width:100%;border-radius:4px"/><figcaption style="font-size:9px">${esc(f.note ?? '')} · ${esc(fmtDate(f.taken_at))}</figcaption></figure>` : '')).join('');
  const kv = (a: string, b: string) => `<tr><th style="text-align:left;width:40%">${esc(a)}</th><td>${b}</td></tr>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:11px"><h2 style="margin:0">${esc(r.code ? `${r.code} · ` : '')}${esc(r.from_name)} → ${esc(r.to_name)}</h2><p style="margin:2px 0 8px">${esc(project)} · ${esc(r.cable ?? '')} · ${esc(ASLAID_STATUS[r.status].label)}</p>${svg}
    <table style="width:100%;border-collapse:collapse;margin:8px 0" border="1" cellpadding="4">${kv('Length as laid (GPS)', `${S.len} m`)}${kv('Cable schedule', r.schedule_m ? `${r.schedule_m} m${r.schedule_ref ? ` (${esc(r.schedule_ref)})` : ''}` : '–')}${kv('Drum cut', r.drum_m ? `${r.drum_m} m` : '–')}${kv(`Depth – ${S.depths} points`, S.dmin != null ? `${S.dmin} – ${S.dmax} m (required ${r.req_depth_m} m)${S.shallow ? ` – ${S.shallow} shallower` : ' – all deep enough'}` : '–')}${kv('Joints · crossings · ducts · marker posts · other services', `${S.joints} · ${S.crossings} · ${S.ducts} · ${S.markers} · ${S.services}`)}${kv('Insulation resistance after laying', r.ir_mohm != null ? `${r.ir_mohm} MΩ` : '–')}${kv('Armour continuity', r.armour_ohm != null ? `${r.armour_ohm} Ω` : '–')}${kv('Recorded by', `${esc(name(r.recorded_by))}${r.started_at ? ` · ${esc(fmtDate(r.started_at))}` : ''}${r.finished_at ? ` – ${esc(fmtDate(r.finished_at))}` : ''}`)}${kv('Approved by', r.approved_by ? `${esc(name(r.approved_by))} · ${esc(fmtDate(r.approved_at ?? ''))}${r.approve_note ? ` – ${esc(r.approve_note)}` : ''}` : 'not yet')}</table>
    <h3>Points</h3><table style="width:100%;border-collapse:collapse" border="1" cellpadding="3"><tr><th>Kind</th><th>m from start</th><th>Depth m</th><th>Protection</th><th>GPS</th><th>Tie / note</th></tr>${rows}</table>
    <p style="font-size:9px;color:#555">Phone GPS is accurate to a few metres. Confirm with a cable locator and hand-dig trial holes before any machine digging (HSG47).</p>${ph ? `<h3>Photos before backfill</h3>${ph}` : ''}</div>`;
  await printHtml(html, { key: 'aslaid_route', filters: `${r.from_name} → ${r.to_name}`, title: `As-laid cable route – ${fileBase(r)}` });
}
