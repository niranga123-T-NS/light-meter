const E = require('./load.cjs')(['net.js', 'forti.js', 'ios.js', 'ps.js', 'win.js']);
const L = E(`labNew({ devs: [
  { id: 'PC-A', kind: 'pc', nics: { Ethernet: { cidr: '10.10.10.21/24', gw: '10.10.10.1', dns: ['10.10.10.5'] } } },
  { id: 'PC-B', kind: 'pc', nics: { Ethernet: { cidr: '10.10.10.34/24', gw: '10.10.20.1', dns: ['10.10.10.5'] } } },
  { id: 'DNS1', kind: 'srv', nics: { Ethernet: { cidr: '10.10.10.5/24', gw: '10.10.10.1' } }, dns: { zones: [{ name: 'dimo.lk', recs: [{ name: 'intranet', type: 'A', data: '10.10.10.80' }] }], fwd: ['8.8.8.8'] }, svc: { DNS: { display: 'DNS Server', start: 'Automatic', status: 'Running', udp: [53], tcp: [53] } } },
  { id: 'WEB1', kind: 'srv', os: 'linux', nics: { ens18: { cidr: '10.10.10.80/24', gw: '10.10.10.1' } }, svc: { nginx: { tcp: [80, 443] } } },
  { id: 'SW1', kind: 'sw', n: 8 },
  { id: 'R1', kind: 'rt', ifs: { 'Gi0/0': { cidr: '10.10.10.1/24', nat: 'inside' }, 'Gi0/1': { cidr: '203.115.21.6/30', nat: 'outside' } }, routes: [{ net: '0.0.0.0', mask: '0.0.0.0', via: '203.115.21.5' }], acls: { 1: [{ std: true, act: 'permit', src: { net: '10.10.0.0', wild: '0.0.255.255' } }] }, nat: { rules: [{ acl: 1, ifn: 'Gi0/1' }], statics: [] } },
  { id: 'ISP', kind: 'isp', ifs: { a: { cidr: '203.115.21.5/30' } } },
], links: [['PC-A:Ethernet','SW1:Gi1/0/1'],['PC-B:Ethernet','SW1:Gi1/0/2'],['DNS1:Ethernet','SW1:Gi1/0/3'],['WEB1:ens18','SW1:Gi1/0/4'],['R1:Gi0/0','SW1:Gi1/0/8'],['R1:Gi0/1','ISP:a']] })`);
E('settle')(L);
const sh = E('winShell')(L, L.devs['PC-B']);
const run = (c) => { const o = sh.run(c); process.stdout.write(sh.prompt() + c + '\n' + (typeof o === 'string' ? o : JSON.stringify(o)) ); };
['ipconfig', 'ping intranet.dimo.lk', 'ping 10.10.10.80', 'ping google.com', 'tracert google.com', 'nslookup google.com', 'arp -a', 'netsh interface ip set address "Ethernet" static 10.10.10.34 255.255.255.0 10.10.10.1', 'ping google.com', 'tracert -d google.com', 'curl http://intranet.dimo.lk', 'powershell', 'Test-NetConnection intranet.dimo.lk -Port 443', 'Test-NetConnection 10.10.10.80 -Port 22', 'Get-NetIPAddress -InterfaceAlias Ethernet', 'Resolve-DnsName nosuch.dimo.lk', 'Get-Service | Where Status -eq Running | Select -First 3', 'ipconfig /all', 'Get-Volume', 'exit', 'netsh interface ip set address "Ethernet" static 10.10.10.21 255.255.255.0 10.10.10.1', 'ipconfig'].forEach(run);
