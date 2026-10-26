// Visual fingerprints of fixture photos, on the device: MediaPipe image embedder (MobileNet V3) in WebAssembly.
// Used by the library build (the catalogue photos), the web app and the phone app (in a WebView), so the numbers always match.
import { FilesetResolver, ImageEmbedder } from './vision_bundle.mjs';

let ready = null;
export function init(base = new URL('.', import.meta.url).href.replace(/\/$/, ''), model = 'mobilenet_v3_small.tflite') {
  ready ??= FilesetResolver.forVisionTasks(base).then((fs) => ImageEmbedder.createFromOptions(fs, { baseOptions: { modelAssetPath: `${base}/${model}` }, l2Normalize: true, quantize: false, runningMode: 'IMAGE' }));
  return ready;
}

export function load(src) {
  return new Promise((ok, bad) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => bad(new Error('The picture could not be opened'));
    im.src = src;
  });
}

// The picture squared on white (like the catalogue photos), optionally only the centre part (crop 0.6 = middle 60 %)
function square(im, crop = 1, size = 256) {
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  const cw = w * crop, ch = h * crop, sx = (w - cw) / 2, sy = (h - ch) / 2, s = Math.max(cw, ch);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, size, size);
  const k = size / s;
  g.drawImage(im, sx, sy, cw, ch, (size - cw * k) / 2, (size - ch * k) / 2, cw * k, ch * k);
  return c;
}

/** One fingerprint per crop (1 = the whole picture) */
export async function embed(src, crops = [1]) {
  const e = await init();
  const im = typeof src === 'string' ? await load(src) : src;
  return crops.map((cr) => Array.from(e.embed(square(im, cr)).embeddings[0].floatEmbedding));
}
