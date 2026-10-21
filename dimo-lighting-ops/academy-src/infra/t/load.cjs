const fs = require('fs'), vm = require('vm'), path = require('path');
module.exports = function load(files) {
  const dir = path.join(__dirname, '..');
  const src = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;\n');
  const ctx = { console, Math, JSON, Date, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.__ = (s) => eval(s);', ctx, { filename: 'bundle.js' });
  return ctx.__;
};
