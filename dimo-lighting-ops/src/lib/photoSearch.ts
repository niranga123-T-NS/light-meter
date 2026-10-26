import { Platform } from 'react-native';
import type { Fixture } from './fixtures';

/** Search by photo: the visual fingerprint (MobileNet V3 image embedder, on the device) of a photo is compared with the fingerprints of all
 *  catalogue photos (public/fixtures/vision/index.json, built by scripts/build-fixture-vision.cjs). No AI service and no internet search –
 *  it compares how things look (shape, proportions, colour), so the values still come from Match. */
const SITE = 'https://dimo-lighting-ops.vercel.app';
export const VISION_PAGE = `${SITE}/fixtures/vision/embed.html`;

export type VisionIndex = { built: string; model: string; dim: number; crops: number[]; query: number[]; imgs: string[]; scale: number[]; q: Int8Array };
let idx: Promise<VisionIndex> | null = null;
export function loadVisionIndex() {
  if (!idx)
    idx = fetch(`${Platform.OS === 'web' ? '' : SITE}/fixtures/vision/index.json`).then(async (r) => {
      if (!r.ok) throw new Error(`The photo index could not be loaded (${r.status})`);
      const j = await r.json();
      const bin = atob(j.q), q = new Int8Array(bin.length);
      for (let i = 0; i < bin.length; i++) q[i] = (bin.charCodeAt(i) << 24) >> 24;
      return { ...j, q };
    });
  idx.catch(() => (idx = null));
  return idx;
}

/** Web: the fingerprint made in the page (the same embed.mjs the index was built with; loaded only when a photo is searched) */
type Embedder = { embed: (src: string, crops: number[]) => Promise<number[][]> };
let mod: Promise<Embedder> | null = null;
export function fingerprintWeb(src: string, crops: number[]) {
  // a plain import() of a URL, past the bundler
  mod ??= (new Function('u', 'return import(u)') as (u: string) => Promise<Embedder>)(`${location.origin}/fixtures/vision/embed.mjs`);
  mod.catch(() => (mod = null));
  return mod.then((m) => m.embed(src, crops));
}

export type PhotoHit = { img: string; score: number; products: Fixture[] };

/** The catalogue photos that look most like the photo – each with the products it shows (one photo often stands for a whole family) */
export function rankByPhoto(ix: VisionIndex, all: Fixture[], query: number[][], f: { type?: string; brand?: string }, n = 12): PhotoHit[] {
  const by = new Map<string, Fixture[]>();
  for (const p of all) if (p.img && (!f.type || p.type === f.type) && (!f.brand || p.brand === f.brand)) by.set(p.img, [...(by.get(p.img) ?? []), p]);
  const per = ix.crops.length, d = ix.dim, hits: PhotoHit[] = [];
  ix.imgs.forEach((img, i) => {
    const products = by.get(img);
    if (!products) return;
    let best = -1;
    for (let c = 0; c < per; c++) {
      const row = (i * per + c), o = row * d, s = ix.scale[row];
      for (const v of query) {
        let dot = 0;
        for (let k = 0; k < d; k++) dot += v[k] * ix.q[o + k];
        if (dot * s > best) best = dot * s;
      }
    }
    hits.push({ img, score: best, products });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, n);
}

/** How alike, in words (cosine of the fingerprints; tested on altered site-style photos: the same fitting scores about 0.66, the best other fitting 0.55) */
export const likeness = (s: number) => (s >= 0.7 ? 'Very close' : s >= 0.58 ? 'Close' : s >= 0.48 ? 'Similar' : 'Loosely similar');
