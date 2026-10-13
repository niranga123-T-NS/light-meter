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

const norm = (s: string) => s.toLowerCase().replace(/\b(port of|port|harbour|harbor|airport|intl|international)\b/g, ' ').replace(/[^a-z0-9À-ɏ]+/g, ' ').trim();
const build = (rows: Row[], kind: Place['kind']) =>
  rows.map(([name, lat, lng, aliases]) => ({ place: { name, lat, lng, kind, lk: lat > 5.5 && lat < 10 && lng > 79 && lng < 82.5 } as Place, keys: [norm(name), ...(aliases ?? []).map(norm)] }));
const PORT_LIST = build(PORTS, 'port');
const AIR_LIST = build(AIRPORTS, 'airport');

/** A port (sea) or airport (air) by name or code, from the built-in list */
export function knownPlace(name: string | null | undefined, mode: 'sea' | 'air' | 'courier' = 'sea'): Place | null {
  if (!name?.trim()) return null;
  const n = norm(name);
  if (!n) return null;
  const lists = mode === 'sea' ? [PORT_LIST, AIR_LIST] : [AIR_LIST, PORT_LIST];
  for (const list of lists) {
    const hit = list.find((x) => x.keys.includes(n)) ?? list.find((x) => x.keys.some((k) => k.length > 3 && (n.includes(k) || k.includes(n))));
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
