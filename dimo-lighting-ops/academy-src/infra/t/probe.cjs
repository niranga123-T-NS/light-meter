const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..');
const files = ['net.js', 'forti.js', 'ios.js', 'ps.js', 'win.js', 'ad.js', 'linux.js', 'linux2.js', 'linux3.js', ...['wifi.js', 'mon.js', 'hv.js', 'auto.js', 'gui_win.js', 'gui_fg.js', 'gui_lx.js'].filter((f) => fs.existsSync(path.join(dir, f))), 'ui.js', 'tools.js', 'lib.js', ...fs.readdirSync(dir).filter((f) => /^s\d\d.*\.js$/.test(f)).sort()];
const ctx = { console, Math, JSON, Date, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
vm.createContext(ctx); vm.runInContext(files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n') + '\n;globalThis.__ = (s) => eval(s);', ctx);
module.exports = ctx.__;
if (require.main === module) { const E = ctx.__; ctx.process = process; console.log(E(fs.readFileSync(process.argv[2], 'utf8'))); }
