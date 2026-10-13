/**
 * Ports and airports for the foreign-order route maps: the main ones DIMO ships through, found by name or code without any
 * lookup. Anything else is found through OpenStreetMap (and remembered on this device).
 */
export type Place = { name: string; lat: number; lng: number; kind: 'port' | 'airport' | 'place'; lk?: boolean };

type Row = [string, number, number, string[]?];

const PORTS: Row[] = [
  // Sri Lanka
  ['Colombo', 6.947, 79.843, ['colombo port', 'lkcmb', 'port of colombo']],
  ['Hambantota', 6.12, 81.11, ['lkham']],
  ['Trincomalee', 8.56, 81.23],
  // China, Hong Kong, Taiwan
  ['Shanghai', 30.63, 122.07, ['yangshan', 'cnsha']],
  ['Ningbo', 29.94, 121.85, ['ningbo-zhoushan', 'cnngb']],
  ['Shenzhen', 22.57, 114.27, ['yantian', 'cnszx', 'cnytn']],
  ['Shekou', 22.48, 113.91],
  ['Nansha', 22.75, 113.6, ['guangzhou', 'cncan']],
  ['Zhongshan', 22.52, 113.39],
  ['Foshan', 23.02, 113.12],
  ['Xiamen', 24.45, 118.07],
  ['Qingdao', 36.07, 120.32],
  ['Tianjin', 38.97, 117.78, ['xingang']],
  ['Dalian', 38.93, 121.65],
  ['Hong Kong', 22.29, 114.15, ['hkhkg']],
  ['Kaohsiung', 22.61, 120.29],
  // Rest of Asia
  ['Singapore', 1.26, 103.82, ['sgsin']],
  ['Port Klang', 3.0, 101.39, ['klang']],
  ['Tanjung Pelepas', 1.36, 103.55],
  ['Laem Chabang', 13.08, 100.88],
  ['Ho Chi Minh', 10.76, 106.79, ['cat lai', 'saigon']],
  ['Haiphong', 20.85, 106.68],
  ['Busan', 35.1, 129.04],
  ['Tokyo', 35.62, 139.79],
  ['Yokohama', 35.45, 139.65],
  ['Tanjung Priok', -6.1, 106.88, ['jakarta']],
  ['Manila', 14.6, 120.96],
  // South Asia and the Middle East
  ['Nhava Sheva', 18.95, 72.95, ['jnpt', 'jawaharlal nehru']],
  ['Mumbai', 18.94, 72.84],
  ['Chennai', 13.1, 80.3, ['madras']],
  ['Mundra', 22.74, 69.7],
  ['Tuticorin', 8.75, 78.2, ['thoothukudi']],
  ['Kolkata', 22.55, 88.3],
  ['Chittagong', 22.31, 91.8],
  ['Karachi', 24.84, 66.98],
  ['Jebel Ali', 25.01, 55.06],
  ['Dubai', 25.27, 55.29],
  ['Salalah', 16.94, 54.0],
  ['Dammam', 26.5, 50.2],
  ['Jeddah', 21.47, 39.17],
  ['Port Said', 31.26, 32.3],
  ['Suez', 29.95, 32.55],
  // Europe
  ['Hamburg', 53.54, 9.97, ['deham']],
  ['Bremerhaven', 53.57, 8.55, ['bremen']],
  ['Rotterdam', 51.95, 4.14, ['nlrtm']],
  ['Antwerp', 51.27, 4.32, ['antwerpen', 'beanr']],
  ['Felixstowe', 51.96, 1.33],
  ['Southampton', 50.9, -1.4],
  ['Le Havre', 49.48, 0.11],
  ['Genoa', 44.4, 8.92, ['genova']],
  ['La Spezia', 44.1, 9.83],
  ['Valencia', 39.44, -0.32],
  ['Barcelona', 41.35, 2.17],
  ['Piraeus', 37.94, 23.63],
  ['Gioia Tauro', 38.44, 15.9],
  ['Algeciras', 36.13, -5.44],
  ['Fos-sur-Mer', 43.4, 4.88, ['marseille', 'fos']],
  ['Gdansk', 54.4, 18.67],
  ['Koper', 45.55, 13.73],
  ['Trieste', 45.63, 13.77],
  ['Venice', 45.44, 12.33, ['venezia']],
  ['Ambarli', 40.97, 28.69, ['istanbul']],
  // Americas, Oceania, Africa
  ['Los Angeles', 33.74, -118.27],
  ['Long Beach', 33.75, -118.21],
  ['New York', 40.68, -74.15, ['newark']],
  ['Savannah', 32.08, -81.09],
  ['Houston', 29.73, -95.27],
  ['Santos', -23.96, -46.3],
  ['Sydney', -33.97, 151.21, ['port botany']],
  ['Melbourne', -37.84, 144.92],
  ['Brisbane', -27.38, 153.17],
  ['Durban', -29.87, 31.03],
  ['Mombasa', -4.06, 39.66],
];

const AIRPORTS: Row[] = [
  ['Colombo (CMB)', 7.18, 79.884, ['cmb', 'katunayake', 'bandaranaike', 'bia', 'colombo airport']],
  ['Mattala (HRI)', 6.28, 81.12, ['hri', 'mattala']],
  ['Dubai (DXB)', 25.25, 55.36, ['dxb', 'dubai']],
  ['Dubai World Central (DWC)', 24.9, 55.16, ['dwc']],
  ['Abu Dhabi (AUH)', 24.43, 54.65, ['auh', 'abu dhabi']],
  ['Doha (DOH)', 25.27, 51.61, ['doh', 'doha']],
  ['Singapore (SIN)', 1.36, 103.99, ['sin', 'changi', 'singapore']],
  ['Hong Kong (HKG)', 22.31, 113.92, ['hkg', 'hong kong']],
  ['Shanghai (PVG)', 31.14, 121.81, ['pvg', 'shanghai', 'pudong']],
  ['Guangzhou (CAN)', 23.39, 113.3, ['can', 'guangzhou', 'baiyun']],
  ['Shenzhen (SZX)', 22.64, 113.81, ['szx', 'shenzhen']],
  ['Beijing (PEK)', 40.08, 116.58, ['pek', 'beijing']],
  ['Bangkok (BKK)', 13.69, 100.75, ['bkk', 'bangkok']],
  ['Kuala Lumpur (KUL)', 2.74, 101.71, ['kul', 'kuala lumpur']],
  ['Delhi (DEL)', 28.56, 77.1, ['del', 'delhi']],
  ['Mumbai (BOM)', 19.09, 72.87, ['bom', 'mumbai']],
  ['Chennai (MAA)', 12.99, 80.17, ['maa', 'chennai']],
  ['Bengaluru (BLR)', 13.2, 77.71, ['blr', 'bangalore', 'bengaluru']],
  ['Frankfurt (FRA)', 50.04, 8.56, ['fra', 'frankfurt']],
  ['Munich (MUC)', 48.35, 11.79, ['muc', 'munich', 'münchen']],
  ['Amsterdam (AMS)', 52.31, 4.76, ['ams', 'amsterdam', 'schiphol']],
  ['Paris (CDG)', 49.01, 2.55, ['cdg', 'paris']],
  ['London (LHR)', 51.47, -0.45, ['lhr', 'london', 'heathrow']],
  ['Istanbul (IST)', 41.26, 28.74, ['ist', 'istanbul airport']],
  ['Milan (MXP)', 45.63, 8.72, ['mxp', 'milan', 'malpensa']],
  ['Rome (FCO)', 41.8, 12.25, ['fco', 'rome']],
  ['Madrid (MAD)', 40.49, -3.57, ['mad', 'madrid']],
  ['Barcelona (BCN)', 41.3, 2.08, ['bcn']],
  ['Zurich (ZRH)', 47.46, 8.55, ['zrh', 'zurich']],
  ['Vienna (VIE)', 48.11, 16.57, ['vie', 'vienna']],
  ['Copenhagen (CPH)', 55.62, 12.65, ['cph', 'copenhagen']],
  ['Luxembourg (LUX)', 49.63, 6.21, ['lux', 'luxembourg']],
  ['Liège (LGG)', 50.64, 5.44, ['lgg', 'liege']],
  ['New York (JFK)', 40.64, -73.78, ['jfk']],
  ['Chicago (ORD)', 41.98, -87.9, ['ord', 'chicago']],
  ['Los Angeles (LAX)', 33.94, -118.41, ['lax']],
  ['Seoul (ICN)', 37.46, 126.44, ['icn', 'seoul', 'incheon']],
  ['Tokyo (NRT)', 35.77, 140.39, ['nrt', 'narita']],
  ['Taipei (TPE)', 25.08, 121.23, ['tpe', 'taipei']],
  ['Sydney (SYD)', -33.94, 151.18, ['syd']],
  ['Melbourne (MEL)', -37.67, 144.84, ['mel']],
];

/** Sea areas and passages: a ship between ports is recorded by the area it is in (an approximate point), or by its coordinates */
const SEAS: Row[] = [
  ['Laccadive Sea', 7.5, 77.0, ['off kerala', 'off kanyakumari', 'off cochin']],
  ['Indian Ocean south of Sri Lanka', 5.0, 80.5, ['off galle', 'off dondra', 'south of sri lanka']],
  ['Gulf of Mannar', 8.6, 79.0, ['palk strait']],
  ['Bay of Bengal', 14.0, 87.0, ['off chennai', 'off trincomalee']],
  ['Arabian Sea', 15.0, 64.0, ['off salalah', 'off oman', 'off mumbai', 'off karachi', 'off somalia']],
  ['Gulf of Oman', 24.5, 58.5],
  ['Strait of Hormuz', 26.5, 56.4, ['hormuz']],
  ['Persian Gulf', 27.0, 51.5, ['arabian gulf']],
  ['Gulf of Aden', 12.5, 48.0, ['aden']],
  ['Bab-el-Mandeb', 12.6, 43.3, ['bab el mandeb']],
  ['Red Sea', 20.0, 38.5],
  ['Suez Canal', 30.6, 32.33, ['suez canal']],
  ['Mediterranean Sea', 34.5, 20.0, ['mediterranean', 'med']],
  ['Strait of Gibraltar', 35.95, -5.6, ['gibraltar']],
  ['Bay of Biscay', 45.5, -5.0, ['biscay']],
  ['English Channel', 50.2, -1.5],
  ['North Sea', 55.5, 3.0],
  ['Atlantic off West Africa', 10.0, -20.0, ['west africa', 'atlantic']],
  ['Cape of Good Hope', -34.8, 18.5, ['good hope', 'cape town']],
  ['Mozambique Channel', -18.0, 41.0],
  ['Andaman Sea', 10.0, 96.0],
  ['Strait of Malacca', 3.5, 100.0, ['malacca', 'melaka']],
  ['Singapore Strait', 1.2, 104.0],
  ['South China Sea', 13.0, 114.0],
  ['Gulf of Thailand', 10.0, 102.0],
  ['Taiwan Strait', 24.0, 119.5],
  ['East China Sea', 29.0, 125.0],
  ['Java Sea', -5.0, 110.0],
  ['Sunda Strait', -6.0, 105.8],
  ['Timor Sea', -11.0, 127.0],
  ['Pacific Ocean', 25.0, -150.0, ['pacific']],
];

const norm = (s: string) => s.toLowerCase().replace(/\b(port of|port|harbour|harbor|airport|intl|international)\b/g, ' ').replace(/[^a-z0-9À-ɏ]+/g, ' ').trim();
const build = (rows: Row[], kind: Place['kind']) =>
  rows.map(([name, lat, lng, aliases]) => ({ place: { name, lat, lng, kind, lk: lat > 5.5 && lat < 10 && lng > 79 && lng < 82.5 } as Place, keys: [norm(name), ...(aliases ?? []).map(norm)] }));
const PORT_LIST = build(PORTS, 'port');
const AIR_LIST = build(AIRPORTS, 'airport');
const SEA_LIST = build(SEAS, 'place');

/** A port (sea) or airport (air) by name or code, from the built-in list */
export function knownPlace(name: string | null | undefined, mode: 'sea' | 'air' | 'courier' = 'sea'): Place | null {
  if (!name?.trim()) return null;
  const n = norm(name);
  if (!n) return null;
  const atSea = /\b(sea|gulf|strait|ocean|channel|canal|bay|cape|off|passage)\b/.test(n);
  const lists = mode === 'sea' ? (atSea ? [SEA_LIST, PORT_LIST, AIR_LIST] : [PORT_LIST, SEA_LIST, AIR_LIST]) : [AIR_LIST, PORT_LIST, SEA_LIST];
  // the exact name or code first, then a name inside the text
  for (const list of lists) {
    const hit = list.find((x) => x.keys.includes(n));
    if (hit) return hit.place;
  }
  for (const list of lists) {
    const hit = list.find((x) => x.keys.some((k) => k.length > 3 && (n.includes(k) || k.includes(n))));
    if (hit) return hit.place;
  }
  return null;
}

const CACHE_KEY = 'fo-geo-cache-v1';
const memory: Record<string, Place | null> = {};
function cacheGet(q: string): Place | null | undefined {
  if (q in memory) return memory[q];
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? '{}') as Record<string, Place | null>;
    if (q in all) return (memory[q] = all[q]);
  } catch {
    // no storage – look it up again
  }
  return undefined;
}
function cacheSet(q: string, p: Place | null) {
  memory[q] = p;
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? '{}') as Record<string, Place | null>;
    all[q] = p;
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // no storage
  }
}

/** Any place by name: the built-in list first, then OpenStreetMap (web) */
export async function findPlace(name: string | null | undefined, opts: { mode?: 'sea' | 'air' | 'courier'; sriLanka?: boolean; known?: boolean } = {}): Promise<Place | null> {
  if (!name?.trim()) return null;
  if (opts.known !== false) {
    const k = knownPlace(name, opts.mode);
    if (k) return k;
  }
  const q = `${name.trim()}${opts.sriLanka ? '|lk' : ''}`;
  const c = cacheGet(q);
  if (c !== undefined) return c;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1${opts.sriLanka ? '&countrycodes=lk' : ''}&q=${encodeURIComponent(name.trim())}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const hits = (await r.json()) as { display_name: string; lat: string; lon: string }[];
    const p = hits[0] ? { name: name.trim(), lat: Number(hits[0].lat), lng: Number(hits[0].lon), kind: 'place' as const } : null;
    cacheSet(q, p);
    return p;
  } catch {
    return null;
  }
}

/**
 * Coordinates as the tracking sites show them: "12.6214, 58.4102", "12.62 N 58.41 E", "N 12°37' E 58°24'", "12°37'17"N 58°24'37"E",
 * or a Google Maps / OpenStreetMap link. Null when the text is not coordinates.
 */
export function parseCoords(text: string | null | undefined): { lat: number; lng: number } | null {
  if (!text?.trim()) return null;
  let t = text.trim();
  const link = t.match(/[@=/](-?\d{1,2}\.\d+)[,/](-?\d{1,3}\.\d+)/);
  if (/^https?:/i.test(t)) return link ? check(Number(link[1]), Number(link[2])) : null;
  t = t.replace(/lat(itude)?|lon(gitude)?|lng|position|:/gi, ' ').replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u201c\u201d\u2033]|''/g, '"');
  if (!/^[\s\d.,;°'"/\-+NSEWnsew]+$/.test(t)) return null;
  // the hemisphere letter before the numbers (N 12.6 E 58.4) or after them (12.6 N 58.4 E)
  const before = /^\s*[NSEW]/i.test(t);
  const re = before
    ? /([NSEW])\s*([-+]?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"\s*)?)?()/gi
    : /()([-+]?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"\s*)?)?\s*([NSEW])?/gi;
  const parts = [...t.matchAll(re)].filter((m) => m[2]);
  if (parts.length !== 2) return null;
  const val = (m: RegExpMatchArray) => {
    const deg = Number(m[2]);
    const v = Math.abs(deg) + Number(m[3] ?? 0) / 60 + Number(m[4] ?? 0) / 3600;
    const hemi = (m[1] || m[5] || '').toUpperCase();
    return { v: deg < 0 || hemi === 'S' || hemi === 'W' ? -v : v, hemi };
  };
  const [a, b] = parts.map(val);
  // E / W first means the longitude was given first
  if ((a.hemi === 'E' || a.hemi === 'W') && (b.hemi === 'N' || b.hemi === 'S' || !b.hemi)) return check(b.v, a.v);
  return check(a.v, b.v);
}
const check = (lat: number, lng: number) => (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null);

/** "12.62° N 58.41° E" */
export const fmtCoords = (p: { lat: number; lng: number }) => `${Math.abs(p.lat).toFixed(2)}° ${p.lat < 0 ? 'S' : 'N'} ${Math.abs(p.lng).toFixed(2)}° ${p.lng < 0 ? 'W' : 'E'}`;

/** The nearest named sea area or port (within about 900 km), to name a point at sea */
export function nearestArea(p: { lat: number; lng: number }) {
  let best: { name: string; d: number } | null = null;
  for (const x of [...SEA_LIST, ...PORT_LIST]) {
    const dy = x.place.lat - p.lat;
    const dx = (x.place.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180);
    const d = Math.sqrt(dx * dx + dy * dy) * 111;
    if (!best || d < best.d) best = { name: x.place.kind === 'port' ? `off ${x.place.name}` : x.place.name, d };
  }
  return best && best.d < 900 ? best.name : null;
}
