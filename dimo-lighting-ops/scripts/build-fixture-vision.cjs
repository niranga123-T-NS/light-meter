// Builds public/fixtures/vision/index.json – the visual fingerprint of every catalogue photo, for "Search by photo".
// Run after scripts/build-fixtures.py when photos were added or changed: node scripts/build-fixture-vision.cjs
// Needs Playwright with Chromium (set PW_CHROMIUM to the browser if Playwright's own is not installed). The fingerprints are made by
// public/fixtures/vision/embed.mjs in the browser – the same code the app runs on the photo taken, so the numbers always match.
const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const OUT = path.join(PUB, 'fixtures', 'vision', 'index.json');
const MODEL = 'mobilenet_v3_small.tflite';
const CROPS = [1, 0.8];
const QUERY = [1, 0.8, 0.6, 0.45];
const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png', '.html': 'text/html', '.tflite': 'application/octet-stream' };

const lib = JSON.parse(fs.readFileSync(path.join(PUB, 'fixtures', 'library.json'), 'utf8'));
const imgs = [...new Set(lib.products.map((p) => p.img).filter(Boolean))].sort();

const srv = http.createServer((q, r) => {
  const f = path.join(PUB, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.writeHead(404).end();
  r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});

srv.listen(0, async () => {
  const url = `http://localhost:${srv.address().port}`;
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    const p = await b.newPage();
    await p.goto(`${url}/fixtures/vision/embed.html`);
    const vecs = await p.evaluate(async ({ imgs, model, crops }) => {
      const m = await import('/fixtures/vision/embed.mjs');
      await m.init(location.origin + '/fixtures/vision', model);
      const out = [];
      for (const i of imgs) out.push(await m.embed('/fixtures/' + i, crops));
      return out;
    }, { imgs, model: MODEL, crops: CROPS });
    // int8 per vector (scale = largest value / 127) – a quarter of the size, the ranking is the same
    const dim = vecs[0][0].length, scale = [], q = Buffer.alloc(imgs.length * CROPS.length * dim);
    let o = 0;
    for (const per of vecs)
      for (const v of per) {
        const s = Math.max(...v.map(Math.abs)) / 127 || 1;
        scale.push(+s.toPrecision(6));
        for (const x of v) q.writeInt8(Math.round(x / s), o++);
      }
    fs.writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString(), model: MODEL, dim, crops: CROPS, query: QUERY, imgs, scale, q: q.toString('base64') }));
    console.log(`${imgs.length} photos × ${CROPS.length} crops → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
  } finally {
    await b.close();
    srv.close();
  }
});
