import { Platform } from 'react-native';
import { pdfText } from './pdfText';
import { readBytes, type PickedFile } from './files';

/** The fixture library: every model from the manufacturer catalogues (data/catalogs → public/fixtures/library.json, built by scripts/build-fixtures.py).
 *  Searched in the app – no AI and no manufacturer website needed. */
export { FIXTURE_ROLES } from './roles';
const SITE = 'https://dimo-lighting-ops.vercel.app';
const base = () => (Platform.OS === 'web' ? '' : SITE);

export type Fixture = {
  id: string; brand: string; cat: string; src: string; page?: string; fam?: string; title: string; type: string; code: string;
  w?: number; lm?: number; lmMin?: number; eff?: number; lmEst?: boolean; lm2?: number; steps?: number[]; url?: string; extras?: string; aut?: number[]; emergency?: string; visibility?: string;
  cct: { k: number[]; range?: boolean; rgb?: boolean }; cri?: number; ugr?: number; ip?: number; ik?: number; beam?: string;
  ctrl: { dali?: boolean; v010?: boolean; dmx?: boolean; triac?: boolean; sensor?: boolean; smart?: boolean };
  warranty?: number; life?: number; size?: string; voltage?: string; leds?: string; housing?: string; cover?: string; mounting?: string; control?: string; temp?: string; surge?: string;
  note?: string; flag?: string; img?: string; shared?: number;
};
export const FIXTURE_TYPES = ['Emergency', 'Panel', 'Downlight', 'Track / spot', 'Linear', 'High bay', 'Floodlight', 'Street light', 'Tri-proof / batten', 'Ceiling light', 'Wall / bulkhead', 'Outdoor landscape', 'Tube / lamp', 'Strip / neon'];

let lib: Promise<{ built: string; products: Fixture[] }> | null = null;
export function loadFixtures() {
  if (!lib)
    lib = fetch(`${base()}/fixtures/library.json`).then(async (r) => {
      if (!r.ok) throw new Error(`The fixture library could not be loaded (${r.status})`);
      return r.json();
    });
  lib.catch(() => (lib = null));
  return lib;
}
export const fixtureImage = (f: Pick<Fixture, 'img'>) => (f.img ? `${base()}/fixtures/${f.img}` : null);

export const cctText = (f: Fixture) => (f.cct.k.length ? (f.cct.range && f.cct.k.length > 1 ? `${f.cct.k[0]}–${f.cct.k[f.cct.k.length - 1]} K` : f.cct.k.map((k) => `${k}`).join(' / ') + ' K') : '') + (f.cct.rgb ? ' + RGB' : '');
export const ctrlText = (f: Fixture) => [f.ctrl.dali && 'DALI', f.ctrl.v010 && '0/1-10V', f.ctrl.dmx && 'DMX', f.ctrl.triac && 'Triac', f.ctrl.sensor && 'Sensor', f.ctrl.smart && 'Smart / app'].filter(Boolean).join(', ') || 'On/off';
export const fmt = (n?: number | null, unit = '') => (n == null ? '—' : `${Math.round(n).toLocaleString('en-US')}${unit}`);

/** Quick search: every word must appear somewhere; "36w", "4000lm", "ip66", "4000k", "ugr19", "dali" are read as values */
export function searchFixtures(all: Fixture[], q: string, f: { type?: string; brand?: string }) {
  const words = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return all.filter((p) => {
    if (f.type && p.type !== f.type) return false;
    if (f.brand && p.brand !== f.brand) return false;
    const hay = `${p.code} ${p.fam ?? ''} ${p.title} ${p.brand} ${p.type} ${p.beam ?? ''} ${p.size ?? ''} ${p.control ?? ''} ${p.note ?? ''}`.toLowerCase();
    return words.every((w) => {
      let m: RegExpExecArray | null;
      if ((m = /^(\d+(?:\.\d+)?)w$/.exec(w))) {
        const ww = +m[1];
        return p.w != null && (Math.abs(p.w - ww) <= ww * 0.05 || (p.steps ?? []).some((s) => Math.abs(s - ww) < 0.5));
      }
      if ((m = /^(\d+)lm$/.exec(w))) return p.lm != null && (p.lmMin ? +m[1] >= p.lmMin * 0.9 && +m[1] <= p.lm * 1.1 : Math.abs(p.lm - +m[1]) <= +m[1] * 0.1);
      if ((m = /^ip(\d\d)$/.exec(w))) return (p.ip ?? 0) >= +m[1];
      if ((m = /^ik(\d\d?)$/.exec(w))) return (p.ik ?? 0) >= +m[1];
      if ((m = /^(\d{4})k$/.exec(w))) return cctOk(p, +m[1]);
      if ((m = /^ugr<?(\d\d)$/.exec(w))) return p.ugr != null && p.ugr <= +m[1];
      if ((m = /^(?:cri|ra)>?(\d\d)$/.exec(w))) return (p.cri ?? 0) >= +m[1];
      if (w === 'dali') return !!p.ctrl.dali;
      if (w === 'dmx') return !!p.ctrl.dmx;
      return hay.includes(w);
    });
  });
}

const cctOk = (p: Fixture, k: number) => p.cct.k.includes(k) || (!!p.cct.range && p.cct.k.length > 1 && k >= p.cct.k[0] && k <= p.cct.k[p.cct.k.length - 1]);

/* ───────── Requirement / competitor spec ───────── */
export type Level = 'must' | 'important' | 'nice';
export type ParamKey = 'type' | 'size' | 'w' | 'lm' | 'cct' | 'cri' | 'ugr' | 'ip' | 'ik' | 'control' | 'beam' | 'aut' | 'warranty' | 'life';
export type SpecValue = { v: string; level: Level };
export type Spec = Partial<Record<ParamKey, SpecValue>>;
export const PARAMS: { key: ParamKey; label: string; hint: string; tol: string; level: Level }[] = [
  { key: 'type', label: 'Type', hint: 'Panel, Downlight, Floodlight…', tol: 'same type', level: 'must' },
  { key: 'size', label: 'Size (mm)', hint: '600 × 600, Φ200', tol: '±5 % (±10 % small deviation)', level: 'must' },
  { key: 'w', label: 'Power (W)', hint: '36', tol: '±10 %', level: 'important' },
  { key: 'lm', label: 'Lumens', hint: '4000', tol: '−5 % / +20 %', level: 'must' },
  { key: 'cct', label: 'CCT (K)', hint: '4000', tol: 'same (±500 K small deviation)', level: 'must' },
  { key: 'cri', label: 'CRI (min)', hint: '80', tol: '≥ value', level: 'important' },
  { key: 'ugr', label: 'UGR (max)', hint: '19', tol: '≤ value', level: 'must' },
  { key: 'ip', label: 'IP (min)', hint: '65', tol: '≥ value', level: 'must' },
  { key: 'ik', label: 'IK (min)', hint: '08', tol: '≥ value', level: 'important' },
  { key: 'control', label: 'Control', hint: 'DALI, 0-10V, DMX…', tol: 'same or better', level: 'important' },
  { key: 'beam', label: 'Beam / optic', hint: '60°, asymmetric', tol: '±15°', level: 'nice' },
  { key: 'aut', label: 'Emergency autonomy (h)', hint: '3', tol: '≥ value', level: 'must' },
  { key: 'warranty', label: 'Warranty (years)', hint: '5', tol: '≥ value', level: 'important' },
  { key: 'life', label: 'Life (h)', hint: '50000', tol: '≥ value', level: 'nice' },
];

/** Reads a datasheet or BOQ line: "LED panel 600x600, 36W, 4000lm, 4000K, CRI>80, UGR<19, IP40, DALI, 5 years" */
export function parseSpecText(text: string): Spec {
  const t = text.replace(/\s+/g, ' ');
  const lv = (k: ParamKey) => PARAMS.find((p) => p.key === k)!.level;
  const s: Spec = {};
  const put = (k: ParamKey, v: string | number | undefined | null) => {
    if (v != null && `${v}`.trim() && !s[k]) s[k] = { v: `${v}`, level: lv(k) };
  };
  const low = t.toLowerCase();
  const typeRx: [string, RegExp][] = [['Emergency', /emergency|exit sign|evacuation|escape/],['High bay', /high.?bay|ufo/], ['Floodlight', /flood ?light|flood|stadium|sports/], ['Street light', /street|road ?light|area light/], ['Panel', /panel|troffer/],
    ['Downlight', /down ?light/], ['Track / spot', /track|spot ?light/], ['Tri-proof / batten', /tri.?proof|batten|waterproof linear/], ['Linear', /linear|pendant/], ['Ceiling light', /ceiling light/],
    ['Wall / bulkhead', /bulkhead|wall light|wall pack/], ['Outdoor landscape', /bollard|in.?ground|underwater|wall washer/], ['Tube / lamp', /\btube\b|bulb|lamp\b/], ['Strip / neon', /strip|neon/]];
  put('type', typeRx.find(([, rx]) => rx.test(low))?.[0]);
  const size = /(?:Φ|ø|Ø|dia\.?\s*)\s*(\d{2,4})|(\d{3,4})\s*[x×*]\s*(\d{3,4})(?:\s*[x×*]\s*(\d{1,3}))?/i.exec(t);
  if (size) put('size', size[1] ? `Φ${size[1]}` : `${size[2]} × ${size[3]}${size[4] ? ` × ${size[4]}` : ''}`);
  put('w', /(\d+(?:\.\d+)?)\s*(?:W|watts?)\b(?!\s*\/)/i.exec(t)?.[1]);
  put('lm', /(\d{1,3}(?:[,.]\d{3})+|\d{3,6})\s*(?:lm|lumens?)\b(?!\s*\/)/i.exec(t)?.[1].replace(/[,.]/g, ''));
  put('cct', /\b(\d{4})\s*K\b/.exec(t)?.[1]);
  put('cri', /(?:CRI|Ra)\s*[>≥:]?\s*=?\s*(\d{2})/i.exec(t)?.[1]);
  put('ugr', /UGR\s*[<≤:]?\s*=?\s*(\d{2})/i.exec(t)?.[1]);
  put('ip', /IP\s*(\d{2})/i.exec(t)?.[1]);
  put('ik', /IK\s*(\d{1,2})/i.exec(t)?.[1]);
  const ctrl = [/dali/i.test(t) && 'DALI', /[01]\s*-\s*10\s*V/i.test(t) && '0-10V', /dmx/i.test(t) && 'DMX', /triac/i.test(t) && 'Triac', /sensor|pir|microwave/i.test(t) && 'Sensor'].filter(Boolean).join(', ');
  put('control', ctrl);
  const beam = /(asym\w*|type\s*(?:II|III|IV|V)\b|\d{1,3}\s*°\s*[x×*]\s*\d{1,3}\s*°|\d{1,3}\s*°)/i.exec(t)?.[1];
  put('beam', beam);
  put('warranty', /(\d{1,2})\s*(?:years?|yrs?)\s*(?:warranty)?/i.exec(t)?.[1]);
  if (/emergency|autonomy|duration|evacuation/i.test(t)) put('aut', /(\d)\s*(?:h|hr|hrs|hours?)\b(?!\s*(?:life|lifetime))/i.exec(t)?.[1]);
  put('life', /(\d{2,3}[,.]?\d{3})\s*(?:h|hrs|hours)\b/i.exec(t)?.[1].replace(/[,.]/g, ''));
  return s;
}

/** Text of an attached datasheet (text PDFs; a scanned page gives nothing – then the values are typed) */
export async function readDatasheet(f: PickedFile) {
  const bytes = await readBytes(f);
  if (/\.pdf$/i.test(f.name) || f.mimeType === 'application/pdf') return pdfText(bytes);
  if (/^text\//.test(f.mimeType ?? '') || /\.(txt|csv)$/i.test(f.name)) return new TextDecoder().decode(bytes);
  throw new Error('Attach the datasheet as a PDF (or paste its text)');
}

/* ───────── Compare one product with the spec ───────── */
export type Status = 'ok' | 'up' | 'minor' | 'fail' | 'na';
export type Cell = { status: Status; value: string; dev: string };
const IP_LADDER = [20, 40, 44, 54, 65, 66, 67, 68];
const dims = (s?: string) => (s ?? '').replace(/\(.*?\)/g, '').match(/\d+(?:\.\d+)?/g)?.map(Number).filter((n) => n >= 20) ?? [];
const pct = (a: number, b: number) => ((a - b) / b) * 100;
const sgn = (n: number, d = 0) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;

export function compare(p: Fixture, spec: Spec): Partial<Record<ParamKey, Cell>> {
  const out: Partial<Record<ParamKey, Cell>> = {};
  const n = (k: ParamKey) => parseFloat((spec[k]?.v ?? '').replace(/[^\d.]/g, ''));
  // a power-selectable model set to the step nearest the power asked – its lumens scale with it
  const askW = n('w');
  const setW = p.w != null && p.steps?.length && askW ? [p.w, ...p.steps].reduce((m, x) => (Math.abs(x - askW) < Math.abs(m - askW) ? x : m), p.w) : p.w;
  const lmAt = p.lm && p.w && setW && setW !== p.w ? Math.round((p.lm * setW) / p.w) : p.lm;
  for (const k of Object.keys(spec) as ParamKey[]) {
    const ask = spec[k]!.v.trim();
    if (!ask) continue;
    const c = (status: Status, value: string, dev = ''): Cell => ({ status, value, dev });
    switch (k) {
      case 'type':
        out.type = p.type.toLowerCase() === ask.toLowerCase() ? c('ok', p.type) : c('fail', p.type, `not a ${ask.toLowerCase()}`);
        break;
      case 'size': {
        const a = dims(ask), b = dims(p.size);
        if (!b.length) { out.size = c('na', p.size || 'not in catalogue'); break; }
        const round = /Φ|ø|Ø/.test(ask);
        const pairs = round ? [[a[0], b[0]]] : [[Math.max(a[0], a[1] ?? 0), Math.max(b[0], b[1] ?? 0)], [Math.min(a[0], a[1] ?? a[0]), Math.min(b[0], b[1] ?? b[0])]];
        const worst = Math.max(...pairs.map(([x, y]) => Math.abs(pct(y, x))));
        const d = pairs.map(([x, y]) => (Math.abs(y - x) > 2 ? `${sgn(y - x)} mm` : '')).filter(Boolean).join(' / ');
        out.size = c(worst <= 5 ? 'ok' : worst <= 10 ? 'minor' : 'fail', p.size ?? '', worst <= 5 ? '' : d);
        break;
      }
      case 'w': {
        const a = n('w');
        if (p.w == null) { out.w = c('na', '—'); break; }
        const near = [p.w, ...(p.steps ?? [])].reduce((m, x) => (Math.abs(x - a) < Math.abs(m - a) ? x : m), p.w);
        const d = pct(near, a);
        const value = p.steps?.length ? `${p.steps.join('/')} W` : `${p.w} W`;
        out.w = c(Math.abs(d) <= 10 ? 'ok' : Math.abs(d) <= 20 ? 'minor' : 'fail', value, `${near !== p.w ? `set to ${near} W · ` : ''}${Math.abs(d) < 0.5 ? '0 %' : `${sgn(near - a, near % 1 ? 1 : 0)} W (${sgn(d)} %)`}`);
        break;
      }
      case 'lm': {
        const a = n('lm');
        if (!p.lm || !lmAt) { out.lm = c('na', 'not in catalogue'); break; }
        if (p.lmMin && p.lmMin < p.lm) {
          // a family with a luminous flux range (portfolio catalogues): inside the range meets
          const rng = `${fmt(p.lmMin)}–${fmt(p.lm)} lm range`;
          if (a >= p.lmMin && a <= p.lm) out.lm = c('ok', rng, 'within the range');
          else if (a > p.lm) { const d = pct(p.lm, a); out.lm = c(d < -10 ? 'fail' : 'minor', rng, `max ${sgn(p.lm - a)} lm (${sgn(d)} %)`); }
          else { const d = pct(p.lmMin, a); out.lm = c(d <= 20 ? 'up' : 'minor', rng, `smallest version ${sgn(p.lmMin - a)} lm (${sgn(d)} %)`); }
          break;
        }
        const d = pct(lmAt, a);
        const st: Status = d < -10 ? 'fail' : d < -5 ? 'minor' : d <= 20 ? (d > 2 ? 'up' : 'ok') : d <= 40 ? 'minor' : 'fail';
        out.lm = c(st, `${lmAt !== p.lm ? '≈' : ''}${fmt(lmAt)} lm${p.lmEst ? ' (est.)' : ''}${lmAt !== p.lm ? ` at ${setW} W` : ''}`, Math.abs(d) < 0.5 ? '' : `${sgn(lmAt - a)} lm (${sgn(d)} %)${d > 20 ? ' – larger than needed' : ''}`);
        break;
      }
      case 'cct': {
        const a = n('cct');
        if (!p.cct.k.length) { out.cct = c('na', p.cct.rgb ? 'RGB' : '—'); break; }
        if (cctOk(p, a)) { out.cct = c(p.cct.k.length > 1 ? 'up' : 'ok', cctText(p), p.cct.k.length > 1 ? 'selectable' : ''); break; }
        const near = p.cct.k.reduce((m, x) => (Math.abs(x - a) < Math.abs(m - a) ? x : m));
        out.cct = c(Math.abs(near - a) <= 500 ? 'minor' : 'fail', cctText(p), `nearest ${near} K (${sgn(near - a)} K)`);
        break;
      }
      case 'cri': {
        const a = n('cri');
        if (p.cri == null) { out.cri = c('na', '—'); break; }
        out.cri = c(p.cri >= a + 10 ? 'up' : p.cri >= a ? 'ok' : p.cri >= a - 5 ? 'minor' : 'fail', `${p.cri}`, p.cri === a ? '' : sgn(p.cri - a));
        break;
      }
      case 'ugr': {
        const a = n('ugr');
        if (p.ugr == null) { out.ugr = c('na', 'not stated'); break; }
        out.ugr = c(p.ugr < a ? 'up' : p.ugr <= a ? 'ok' : p.ugr <= a + 3 ? 'minor' : 'fail', `<${p.ugr}`, p.ugr === a ? '' : `${sgn(p.ugr - a)}`);
        break;
      }
      case 'ip': {
        const a = n('ip');
        if (p.ip == null) { out.ip = c('na', '—'); break; }
        const steps = Math.max(1, IP_LADDER.filter((x) => (p.ip! < a ? x > p.ip! && x <= a : x > a && x <= p.ip!)).length);
        out.ip = c(p.ip > a ? 'up' : p.ip === a ? 'ok' : 'fail', `IP${p.ip}`, p.ip === a ? '' : `${steps} step${steps === 1 ? '' : 's'} ${p.ip > a ? 'higher' : 'lower'}`);
        break;
      }
      case 'ik': {
        const a = n('ik');
        if (p.ik == null) { out.ik = c('na', '—'); break; }
        out.ik = c(p.ik > a ? 'up' : p.ik === a ? 'ok' : 'fail', `IK${String(p.ik).padStart(2, '0')}`, p.ik === a ? '' : sgn(p.ik - a));
        break;
      }
      case 'control': {
        const want = ask.toLowerCase();
        const miss = [/dali/.test(want) && !p.ctrl.dali && 'DALI', /[01]\s*-?\s*10/.test(want) && !p.ctrl.v010 && '0-10V', /dmx/.test(want) && !p.ctrl.dmx && 'DMX', /triac/.test(want) && !p.ctrl.triac && 'Triac',
          /sensor/.test(want) && !p.ctrl.sensor && 'sensor'].filter(Boolean);
        out.control = c(miss.length ? 'fail' : 'ok', ctrlText(p), miss.length ? `no ${miss.join(', ')}` : '');
        break;
      }
      case 'beam': {
        const b = p.beam ?? '';
        if (!b) { out.beam = c('na', '—'); break; }
        if (/asym|type|t[2-5]\b|[x×*]/i.test(ask)) {
          const has = /asym|type|t[2-5]\b|\d\s*°?\s*[x×*]\s*\d/i.test(b);
          out.beam = c(has ? 'ok' : 'fail', b, has ? '' : 'no asymmetric optic');
          break;
        }
        const a = n('beam'), list = (b.match(/\d{1,3}(?=\s*°)/g) ?? b.match(/\d{1,3}/g) ?? []).map(Number);
        if (!list.length) { out.beam = c('na', b); break; }
        const near = list.reduce((m, x) => (Math.abs(x - a) < Math.abs(m - a) ? x : m));
        out.beam = c(Math.abs(near - a) <= 15 ? 'ok' : Math.abs(near - a) <= 30 ? 'minor' : 'fail', b, near === a ? '' : `nearest ${near}° (${sgn(near - a)}°)`);
        break;
      }
      case 'aut': {
        const a = n('aut');
        if (!p.aut?.length) { out.aut = c('na', p.type === 'Emergency' ? 'central battery' : 'no emergency'); break; }
        const best = Math.max(...p.aut);
        out.aut = c(best >= a ? (p.aut.includes(a) ? 'ok' : 'up') : 'fail', `${p.aut.join(' / ')} h`, best >= a ? '' : `${sgn(best - a)} h`);
        break;
      }
      case 'warranty': {
        const a = n('warranty');
        if (p.warranty == null) { out.warranty = c('na', '—'); break; }
        out.warranty = c(p.warranty > a ? 'up' : p.warranty === a ? 'ok' : p.warranty >= a - 1 ? 'minor' : 'fail', `${p.warranty} years`, p.warranty === a ? '' : `${sgn(p.warranty - a)} year${Math.abs(p.warranty - a) === 1 ? '' : 's'}`);
        break;
      }
      case 'life': {
        const a = n('life');
        if (p.life == null) { out.life = c('na', '—'); break; }
        out.life = c(p.life >= a ? (p.life > a ? 'up' : 'ok') : 'minor', `${fmt(p.life)} h`, p.life === a ? '' : `${sgn(p.life - a)} h`);
        break;
      }
    }
  }
  return out;
}

const W: Record<Level, number> = { must: 5, important: 3, nice: 1 };
const PTS: Record<Status, number> = { ok: 1, up: 1, minor: 0.6, na: 0.4, fail: 0 };
export type Match = { p: Fixture; cells: Partial<Record<ParamKey, Cell>>; score: number; mustFails: number; fails: number; minors: number };

/** Best options for the spec: a failed Must ranks an option down; then the weighted match %. Never empty – the closest are always shown. */
export function bestMatches(all: Fixture[], spec: Spec, n: number, brand?: string): Match[] {
  const keys = (Object.keys(spec) as ParamKey[]).filter((k) => spec[k]?.v.trim());
  if (!keys.length) return [];
  const res: Match[] = [];
  for (const p of all) {
    if (brand && p.brand !== brand) continue;
    const cells = compare(p, spec);
    let tot = 0, got = 0, mustFails = 0, fails = 0, minors = 0;
    for (const k of keys) {
      const cl = cells[k];
      if (!cl) continue;
      const w = W[spec[k]!.level];
      tot += w; got += w * PTS[cl.status];
      if (cl.status === 'fail') { fails++; if (spec[k]!.level === 'must') mustFails++; }
      if (cl.status === 'minor') minors++;
    }
    res.push({ p, cells, score: tot ? Math.round((got / tot) * 100) : 0, mustFails, fails, minors });
  }
  res.sort((a, b) => a.mustFails - b.mustFails || b.score - a.score || (a.p.lmEst ? 1 : 0) - (b.p.lmEst ? 1 : 0));
  // one option per catalogue family, so the list is not five sizes of the same light
  const seen = new Set<string>(), out: Match[] = [];
  for (const m of res) {
    const fam = `${m.p.cat}:${m.p.fam ?? m.p.title}`;
    if (seen.has(fam)) continue;
    seen.add(fam); out.push(m);
    if (out.length >= n) break;
  }
  return out;
}

export const STATUS_STYLE: Record<Status, { bg: string; fg: string; icon: string; label: string }> = {
  ok: { bg: '#F0FDF4', fg: '#166534', icon: '✓', label: 'meets' },
  up: { bg: '#EFF6FF', fg: '#1E40AF', icon: '▲', label: 'better than asked' },
  minor: { bg: '#FFFBEB', fg: '#92400E', icon: '●', label: 'small deviation' },
  fail: { bg: '#FEF2F2', fg: '#991B1B', icon: '✕', label: 'does not meet' },
  na: { bg: '#F9FAFB', fg: '#4B5563', icon: '?', label: 'not in the catalogue' },
};
