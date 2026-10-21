const fs = require('fs'), vm = require('vm'), path = require('path'); const dir = path.join(__dirname, '..');
const files = ['net.js','forti.js','ios.js','ps.js','win.js','ad.js','linux.js','linux2.js','linux3.js','ui.js','tools.js','lib.js', ...fs.readdirSync(dir).filter((f) => /^s\d\d.*\.js$/.test(f)).sort()];
const ctx = { console, Math, JSON, Date }; vm.createContext(ctx); vm.runInContext(files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') + '\n;globalThis.__=(s)=>eval(s);', ctx); const E = ctx.__;
const S = E("SESSIONS.find(s=>s.id==='s02')"); const sp = S.lab.build(); const L = E('labNew')(sp); sp.post(L); E('settle')(L);
L.ipam = E('FIXED_PLAN').map((s) => ({ subnet: s })); console.log(JSON.stringify(E('ipamCheck')(L.ipam)));
E('ipamPush')(L);
console.log(E('runFix')(L, [['PC-KDY', 'cmd', 'netsh interface ip set address "Ethernet" static 10.30.1.20 255.255.255.192 10.30.1.1'], ['PC-GLE', 'cmd', 'netsh interface ip set address "Ethernet" static 10.30.1.100 255.255.255.224 10.30.1.97'], ['PC-KDY', 'cmd', 'ping 10.30.0.202'], ['PC-GLE', 'cmd', 'tracert 10.30.0.202'], ['PC-HQ', 'cmd', 'ipconfig'], ['PC-HQ','cmd','ping 8.8.8.8']]).slice(-2200));
S.lab.tasks.forEach((t) => console.log(t.id, t.ans ? JSON.stringify(t.ans(L)) : !!t.check(L)));
