const E = require('./load.cjs')(['net.js', 'forti.js', 'ios.js', 'ps.js', 'win.js', 'ad.js', 'linux.js', 'linux2.js', 'linux3.js']);
const L = E(`labNew({ devs: [{ id: 'WEB1', kind: 'srv', os: 'linux', hostname: 'web01', nics: { ens18: { cidr: '10.10.10.80/24' } } }] })`);
E('settle')(L);
const S = E('lxSession')(L, L.devs.WEB1);
for (const c of ['ls -l /etc/ssh', 'for i in 1 2; do echo $i; done', 'echo hi | cat']) { const r = E('lxRun')(S, c); console.log(JSON.stringify(c), JSON.stringify(r)); }
