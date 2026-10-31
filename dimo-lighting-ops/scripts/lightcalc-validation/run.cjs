// Light Calc validation (CIE 171-style analytical cases) against the newest Design Tools engine migration.
// NODE_PATH=/path/to/node_modules PW_CHROMIUM=/path/to/chromium node scripts/lightcalc-validation/run.cjs
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), os = require('os');
(async () => {
  const dir = path.join(__dirname, '../../supabase/migrations'), mig = fs.readdirSync(dir).filter((f) => /design_tools_v\d+\.sql$/.test(f)).sort().pop();
  const eng = fs.readFileSync(path.join(dir, mig), 'utf8').split('$dtengine$')[1], at = eng.lastIndexOf('})();'), html = path.join(os.tmpdir(), 'lc-validation.html');
  fs.writeFileSync(html, eng.slice(0, at) + 'window.__ev = (src) => eval(src);\n' + eng.slice(at));
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), p = await (await b.newContext()).newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file://' + html); await p.waitForTimeout(1500);
  const R = await p.evaluate((s) => window.__ev(s), fs.readFileSync(path.join(__dirname, 'tests.js'), 'utf8'));
  console.log(`Engine ${mig}`); R.forEach((t) => console.log(`${t.pass ? 'PASS' : 'FAIL'}  ${t.id}. ${t.title} – worst ${t.worst.toFixed(3)} % (limit ${t.tol} %)`));
  if (errs.length) console.log('errors', errs); await b.close(); process.exit(R.every((t) => t.pass) && !errs.length ? 0 : 1);
})();
