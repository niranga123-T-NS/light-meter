const E = require('./load.cjs')(['net.js', 'forti.js', 'ios.js', 'ps.js', 'win.js', 'ad.js']);
const L = E(`labNew({ devs: [
  { id: 'PC-HQ', kind: 'pc', nics: { Ethernet: { cidr: '10.10.10.21/24', gw: '10.10.10.1', dns: ['8.8.8.8'] } } },
  { id: 'PC-BR', kind: 'pc', nics: { Ethernet: { cidr: '10.20.10.21/24', gw: '10.20.10.1', dns: ['8.8.8.8'] } } },
  { id: 'WEB', kind: 'srv', os: 'linux', nics: { ens18: { cidr: '10.10.10.80/24', gw: '10.10.10.1' } }, svc: { nginx: { tcp: [80, 443] } } },
  { id: 'SW-HQ', kind: 'sw', n: 8 }, { id: 'SW-BR', kind: 'sw', n: 8 },
  { id: 'FGT-HQ', kind: 'fw', hostname: 'FGT-HQ', ifs: { port1: { cidr: '203.115.21.6/30', access: 'ping https', role: 'wan' }, port2: { cidr: '10.10.10.1/24', access: 'ping https ssh', role: 'lan' } }, cfg: { 'router static': { 1: { gateway: ['203.115.21.5'], device: ['port1'] } } } },
  { id: 'FGT-BR', kind: 'fw', hostname: 'FGT-BR', ifs: { wan1: { cidr: '112.134.88.2/30', access: 'ping' }, internal: { cidr: '10.20.10.1/24', access: 'ping https' } }, cfg: { 'router static': { 1: { gateway: ['112.134.88.1'], device: ['wan1'] } } } },
  { id: 'ISP', kind: 'isp', ifs: { a: { cidr: '203.115.21.5/30' }, b: { cidr: '112.134.88.1/30' } } },
], links: [['PC-HQ:Ethernet','SW-HQ:Gi1/0/1'],['WEB:ens18','SW-HQ:Gi1/0/2'],['FGT-HQ:port2','SW-HQ:Gi1/0/8'],['FGT-HQ:port1','ISP:a'],['PC-BR:Ethernet','SW-BR:Gi1/0/1'],['FGT-BR:internal','SW-BR:Gi1/0/8'],['FGT-BR:wan1','ISP:b']] })`);
E('settle')(L);
const send = E('send');
const show = (t, r) => console.log(t.padEnd(30), r.res, r.why || '');
show('HQ->8.8.8.8 (no policy)', send(L, 'PC-HQ', { dst: '8.8.8.8' }));
const hq = E('fgShell')(L, L.devs['FGT-HQ']), br = E('fgShell')(L, L.devs['FGT-BR']);
const run = (sh, cmds) => cmds.trim().split('\n').forEach((c) => { const p = sh.prompt(); const o = sh.run(c.trim()); process.stdout.write(p + c.trim() + '\n' + o); });
run(hq, `config firewall policy
edit 0
set name "LAN-to-WAN"
set srcintf port2
set dstintf port1
set srcaddr all
set dstaddr all
set action accept
set service ALL
set nat enable
next
end`);
show('HQ->8.8.8.8', send(L, 'PC-HQ', { dst: '8.8.8.8' }));
run(hq, `config firewall address
edit "BR-LAN"
set subnet 10.20.10.0 255.255.255.0
next
edit "HQ-LAN"
set subnet 10.10.10.0/24
next
end
config vpn ipsec phase1-interface
edit "to-BR"
set interface "port1"
set ike-version 2
set peertype any
set proposal aes256-sha256
set remote-gw 112.134.88.2
set psksecret Dimo#VPN2026
next
end
config vpn ipsec phase2-interface
edit "to-BR"
set phase1name "to-BR"
set proposal aes256-sha256
set src-subnet 10.10.10.0 255.255.255.0
set dst-subnet 10.20.10.0 255.255.255.0
next
end
config router static
edit 0
set dst 10.20.10.0 255.255.255.0
set device "to-BR"
next
end
config firewall policy
edit 0
set name "HQ-to-BR"
set srcintf port2
set dstintf to-BR
set srcaddr HQ-LAN
set dstaddr BR-LAN
set action accept
set service ALL
next
edit 0
set name "BR-to-HQ"
set srcintf to-BR
set dstintf port2
set srcaddr BR-LAN
set dstaddr HQ-LAN
set action accept
set service ALL
next
end`);
run(br, `config vpn ipsec phase1-interface
edit "to-HQ"
set interface wan1
set ike-version 2
set proposal aes256-sha256
set remote-gw 203.115.21.6
set psksecret Dimo#VPN2026
next
end
config vpn ipsec phase2-interface
edit "to-HQ"
set phase1name to-HQ
set proposal aes256-sha256
set src-subnet 10.20.10.0 255.255.255.0
set dst-subnet 10.10.10.0 255.255.255.0
next
end
get vpn ipsec tunnel summary`);
show('HQ->BR (no BR route/policy)', send(L, 'PC-HQ', { dst: '10.20.10.21' }));
run(br, `config router static
edit 0
set dst 10.10.10.0 255.255.255.0
set device to-HQ
next
end
config firewall policy
edit 0
set srcintf to-HQ
set dstintf internal
set srcaddr all
set dstaddr all
set action accept
set service ALL
next
edit 0
set srcintf internal
set dstintf to-HQ
set srcaddr all
set dstaddr all
set action accept
set service ALL
next
end`);
show('HQ->BR', send(L, 'PC-HQ', { dst: '10.20.10.21' }));
show('BR->WEB 443', send(L, 'PC-BR', { dst: '10.10.10.80', proto: 'tcp', dport: 443 }));
run(hq, `show firewall policy 2
get router info routing-table all
diagnose vpn tunnel list
execute log display`);
