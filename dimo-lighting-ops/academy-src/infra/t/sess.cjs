// For each session: build the lab, every ticket: checks fail first, the fix (console commands) makes them pass
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const files = ['net.js', 'forti.js', 'ios.js', 'ps.js', 'win.js', 'ad.js', 'linux.js', 'linux2.js', 'linux3.js', ...['wifi.js', 'mon.js', 'hv.js', 'auto.js', 'gui_win.js', 'gui_fg.js', 'gui_lx.js', 'gui_pve.js'].filter((f) => fs.existsSync(path.join(dir, f))), 'ui.js', 'tools.js', 'lib.js', ...fs.readdirSync(dir).filter((f) => /^s\d\d.*\.js$/.test(f)).sort()];
const ctx = { console, Math, JSON, Date, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
vm.createContext(ctx); vm.runInContext(files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') + '\n;globalThis.__ = (s) => eval(s);', ctx);
const E = ctx.__; const FIX = require('./fixes.cjs');
const only = process.argv[2];
let fails = 0;
for (const S of E('SESSIONS')) {
  if (only && S.id !== only) continue;
  const L0 = E('labNew')(S.lab.build()); const spec = S.lab.build(); const L = E('labNew')(spec); if (spec.post) spec.post(L); E('settle')(L); L.cmdlog = [];
  console.log(`\n== ${S.id} ${S.title}: lab devices ${Object.keys(L.devs).length}`);
  const tests = [...(S.tickets || []), ...((S.test && S.test.faults) || [])];
  for (const T of tests) {
    const sp = (T.build || S.lab.build)(); const L = E('labNew')(sp); if (sp.post) sp.post(L); E('settle')(L); L.cmdlog = []; if (T.fault) { T.fault(L); E('settle')(L); }
    const before = T.checks.map((c) => { try { return !!c.f(L); } catch (e) { return 'ERR ' + e.message; } });
    const fix = FIX[`${S.id}.${T.id}`];
    if (!fix) { console.log(`  ${T.id} #${T.no || ''} before=${JSON.stringify(before)} (no fix script)`); continue; }
    const out = E('runFix')(L, fix);
    const after = T.checks.map((c) => { try { return !!c.f(L); } catch (e) { return 'ERR ' + e.message; } });
    const ok = before.some((x) => x !== true) && after.every((x) => x === true);
    if (!ok) fails++;
    console.log(`  ${ok ? 'OK ' : 'BAD'} ${T.id} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    if (!ok || process.env.V) console.log(out.slice(-2500));
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nALL OK'); process.exit(fails ? 1 : 0);
