// generic lab runner: node t/lab.cjs s04 steps-file-key
const fs = require('fs'), vm = require('vm'), path = require('path'); const dir = path.join(__dirname, '..');
const files = ['net.js','forti.js','ios.js','ps.js','win.js','ad.js','linux.js','linux2.js','linux3.js', ...['wifi.js', 'mon.js', 'hv.js', 'auto.js', 'gui_win.js', 'gui_fg.js', 'gui_lx.js', 'gui_pve.js'].filter((f) => fs.existsSync(path.join(dir, f))), 'ui.js','tools.js','lib.js', ...fs.readdirSync(dir).filter((f) => /^s\d\d.*\.js$/.test(f)).sort()];
const ctx = { console, Math, JSON, Date }; vm.createContext(ctx); vm.runInContext(files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') + '\n;globalThis.__=(s)=>eval(s);', ctx); const E = ctx.__;
const sid = process.argv[2]; const S = E(`SESSIONS.find(s=>s.id==='${sid}')`); const sp = S.lab.build(); const L = E('labNew')(sp); if (sp.post) sp.post(L); E('settle')(L);
const steps = require('./labsteps.cjs')[sid]; E('(L) => (globalThis.__L = L)')(L);
const out = E('runFix')(L, steps); if (process.env.J) console.log(E(process.env.J.replace(/LL/g, 'globalThis.__L')));
if (process.env.V) console.log(out); else console.log(out.slice(-(+process.env.N || 1500)));
let n = 0; S.lab.tasks.forEach((t) => { let v; try { v = t.ans ? (t.ans(L)) : !!t.check(L); } catch (e) { v = 'ERR ' + e.message; } if (v === true) n++; console.log(' ', t.id, JSON.stringify(v)); });
console.log(`${sid}: ${n} checks true of ${S.lab.tasks.filter((t) => !t.ans).length} (answers listed)`);
