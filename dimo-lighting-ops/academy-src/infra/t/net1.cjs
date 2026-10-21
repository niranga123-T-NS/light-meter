const E = require('./load.cjs')(['net.js', 'forti.js']);
const L = E(`labNew({ devs: [
  { id: 'PC-A', kind: 'pc', nics: { Ethernet: { cidr: '10.10.10.21/24', gw: '10.10.10.1', dns: ['10.10.10.5'] } } },
  { id: 'PC-B', kind: 'pc', nics: { Ethernet: { cidr: '10.10.20.21/24', gw: '10.10.20.1', dns: ['10.10.10.5'] } } },
  { id: 'PC-C', kind: 'pc', nics: { Ethernet: { dhcp: true } } },
  { id: 'DNS1', kind: 'srv', nics: { Ethernet: { cidr: '10.10.10.5/24', gw: '10.10.10.1', dns: ['127.0.0.1'] } }, dns: { zones: [{ name: 'dimo.lk', recs: [{ name: 'intranet', type: 'A', data: '10.10.10.80' }] }], fwd: ['8.8.8.8'] }, svc: { DNS: { status: 'Running', udp: [53], tcp: [53] } } },
  { id: 'WEB1', kind: 'srv', os: 'linux', nics: { ens18: { cidr: '10.10.10.80/24', gw: '10.10.10.1' } }, svc: { nginx: { tcp: [80, 443] } } },
  { id: 'SW1', kind: 'sw', n: 8, vlans: { 1: 'default', 10: 'STAFF', 20: 'GUEST' } },
  { id: 'R1', kind: 'rt', ifs: { 'Gi0/0': {}, 'Gi0/0.10': { dot1q: 10, cidr: '10.10.10.1/24', nat: 'inside' }, 'Gi0/0.20': { dot1q: 20, cidr: '10.10.20.1/24', nat: 'inside' }, 'Gi0/1': { cidr: '203.115.21.6/30', nat: 'outside' } }, routes: [{ net: '0.0.0.0', mask: '0.0.0.0', via: '203.115.21.5' }], acls: { 1: [{ std: true, act: 'permit', src: { net: '10.10.0.0', wild: '0.0.255.255' } }] }, nat: { rules: [{ acl: 1, ifn: 'Gi0/1' }], statics: [] }, dhcp: { pools: { STAFF: { net: '10.10.10.0', mask: '255.255.255.0', gw: '10.10.10.1', dns: ['10.10.10.5'] } }, excl: [['10.10.10.1', '10.10.10.99']], bind: {} } },
  { id: 'ISP', kind: 'isp', ifs: { a: { cidr: '203.115.21.5/30' } } },
], links: [['PC-A:Ethernet','SW1:Gi1/0/1'],['PC-B:Ethernet','SW1:Gi1/0/2'],['DNS1:Ethernet','SW1:Gi1/0/3'],['WEB1:ens18','SW1:Gi1/0/4'],['PC-C:Ethernet','SW1:Gi1/0/5'],['R1:Gi0/0','SW1:Gi1/0/8'],['R1:Gi0/1','ISP:a']] })`);
const P = E('(o)=>o'); globalThis.L = L;
E('x=>x');
const set = (s) => E(`((L)=>{${s}})`)(L);
set(`const s=L.devs.SW1.ports; [1,3,4,5].forEach(i=>s['Gi1/0/'+i].vlan=10); s['Gi1/0/2'].vlan=20; s['Gi1/0/8'].mode='trunk'; settle(L);`);
const send = E('send'), resolve = E('resolve');
const show = (t, r) => console.log(t.padEnd(36), r.res, r.why || '', (r.hops||[]).map(h=>h.ip).join(' > '));
show('A->B', send(L, 'PC-A', { dst: '10.10.20.21' }));
show('A->web tcp80', send(L, 'PC-A', { dst: '10.10.10.80', proto: 'tcp', dport: 80 }));
show('A->web tcp22', send(L, 'PC-A', { dst: '10.10.10.80', proto: 'tcp', dport: 22 }));
show('A->8.8.8.8', send(L, 'PC-A', { dst: '8.8.8.8' }));
show('A->google 443', send(L, 'PC-A', { dst: '142.250.183.46', proto: 'tcp', dport: 443 }));
console.log('dns intranet', JSON.stringify(resolve(L, L.devs['PC-A'], 'intranet.dimo.lk')));
console.log('dns google', JSON.stringify(resolve(L, L.devs['PC-A'], 'google.com')));
console.log('PC-C', JSON.stringify(L.devs['PC-C'].nics.Ethernet));
set(`L.devs.SW1.ports['Gi1/0/2'].vlan=10; settle(L);`);
show('B moved to vlan10 ->gw', send(L, 'PC-B', { dst: '10.10.20.1' }));
set(`delete L.devs.R1.acls[1]; settle(L)`);
show('no NAT acl -> 8.8.8.8', send(L, 'PC-A', { dst: '8.8.8.8' }));
console.log('mac', JSON.stringify(L.mac));
