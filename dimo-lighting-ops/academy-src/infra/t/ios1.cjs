const E = require('./load.cjs')(['net.js', 'forti.js', 'ios.js']);
const L = E(`labNew({ devs: [
  { id: 'PC1', kind: 'pc', nics: { Ethernet: { cidr: '10.10.10.21/24', gw: '10.10.10.1' } } },
  { id: 'PC2', kind: 'pc', nics: { Ethernet: { cidr: '10.10.10.22/24', gw: '10.10.10.1' } } },
  { id: 'SW1', kind: 'sw', hostname: 'SW1', n: 24, up: ['Te1/1/1','Te1/1/2'], stp: { on: true, prio: 24576 } },
  { id: 'SW2', kind: 'sw', hostname: 'SW2', n: 24, up: ['Te1/1/1','Te1/1/2'] },
  { id: 'R1', kind: 'rt', hostname: 'R1', ifs: { 'Gi0/0': {}, 'Gi0/1': { cidr: '203.115.21.6/30' } } },
], links: [['PC1:Ethernet','SW1:Gi1/0/1'],['PC2:Ethernet','SW2:Gi1/0/1'],['SW1:Te1/1/1','SW2:Te1/1/1'],['SW1:Te1/1/2','SW2:Te1/1/2'],['R1:Gi0/0','SW1:Gi1/0/24']] })`);
E('settle')(L);
const sh = E('iosShell');
const s1 = sh(L, L.devs.SW1), s2 = sh(L, L.devs.SW2), r1 = sh(L, L.devs.R1);
const run = (s, cmds) => cmds.split('\n').forEach((c) => { const o = s.run(c); process.stdout.write(s.prompt() + ' <= ' + c + '\n' + o); });
run(s1, `en\nconf t\nvlan 10\nname STAFF\nint range g1/0/1 - 4\nswitchport mode access\nswitchport access vlan 10\nint range te1/1/1-2\nsw mode trunk\nend\nsh vlan br\nsh int trunk\nsh spanning-tree vlan 10`);
run(s2, `en\nconf t\nvlan 10\nint g1/0/1\nswitchport access vlan 10\nint range te1/1/1 - 2\nswitchport mode trunk\nend\nsh spanning-tree vlan 10`);
console.log(JSON.stringify(E('send')(L, 'PC1', { dst: '10.10.10.22' })));
run(s2, `conf t\nno spanning-tree vlan 1,10\nend`);
run(s1, `conf t\nno spanning-tree vlan 1,10\nend\nsh mac address-table\nsh int te1/1/1`);
console.log(JSON.stringify(E('send')(L, 'PC1', { dst: '10.10.10.22' })));
run(s1, `conf t\nspanning-tree vlan 1 priority 4096\nint range te1/1/1 - 2\nchannel-group 1 mode active\nend`);
run(s2, `conf t\nspanning-tree vlan 1\nint range te1/1/1 - 2\nchannel-group 1 mode passive\nend\nsh etherchannel summary\nsh spanning-tree`);
console.log(JSON.stringify(E('send')(L, 'PC1', { dst: '10.10.10.22' })));
run(s1, `sh run | i interface|channel\nsh ip int br | i Te\nconf t\nint g1/0/9\nsh\nend\nsh int status | i 1/0/9\nsh logging | i 1/0/9`);
run(r1, `en\nconf t\nint g0/0.10\nencap dot1q 10\nip add 10.10.10.1 255.255.255.0\nexit\nip route 0.0.0.0 0.0.0.0 203.115.21.5\nend\nsh ip route\nping 10.10.10.21`);
run(s1, `conf t\nint g1/0/24\nswitchport mode trunk\nend`);
run(r1, `ping 10.10.10.22\nsh ip int br`);
