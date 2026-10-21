// =================== Session 23 – Capstone I: build the Kandy branch office end to end (switch, FortiGate, IPsec to HQ, domain, Proxmox host and app VM, backup, as-built document)
const KDY = { psk: 'Dimo#Kdy2026', pass: 'Dimo@Lab2026' };
/** HQ (FortiGate, DC1 with AD corp.dimo.lk) is ready and expects the branch VPN; the Kandy branch is out of the box */
function brLab(o = {}) {
  const spec = {
    devs: [
      B.isp(400, 24, { a: { cidr: '203.115.21.5/30' }, b: { cidr: '112.134.88.1/30' } }),
      { id: 'FGT-HQ', kind: 'fw', x: 200, y: 96, hostname: 'FGT-HQ', ifs: { port1: { cidr: '203.115.21.6/30', access: 'ping', role: 'wan' }, port2: { cidr: '10.10.20.1/24', access: 'ping https ssh', role: 'lan' } }, cfg: { 'router static': { 1: { gateway: ['203.115.21.5'], device: ['port1'] } } } },
      B.win('DC1', 90, 170, '10.10.20.10/24', { gw: '10.10.20.1', dns: ['127.0.0.1'], hn: 'DC1', x: { adminPass: KDY.pass } }),
      { id: 'FGT-KDY', kind: 'fw', x: 560, y: 96, hostname: 'FGT-KANDY', ifs: { wan1: { cidr: '112.134.88.2/30', access: 'ping', role: 'wan' }, internal: { access: 'ping https ssh', role: 'lan' } }, cfg: { 'router static': { 1: { gateway: ['112.134.88.1'], device: ['wan1'] } } } },
      B.sw('SW', 560, 176, 24, { hn: 'Switch' }),
      { id: 'PVE-KDY', kind: 'hv', x: 680, y: 260, hostname: 'pve-kdy', nics: ['eno1', 'eno2'], pvesetup: true },
      B.pc('PC1', 450, 270, 'dhcp', { hn: 'KDY-PC01' }), B.pc('PC2', 540, 300, 'dhcp', { hn: 'KDY-PC02' }),
    ],
    links: [['ISP:a', 'FGT-HQ:port1'], ['ISP:b', 'FGT-KDY:wan1'], ['FGT-HQ:port2', 'DC1:Ethernet'], ['FGT-KDY:internal', 'SW:Gi1/0/24'], ['PC1:Ethernet', 'SW:Gi1/0/1'], ['PVE-KDY:eno1', 'SW:Gi1/0/2'], ['PC2:Ethernet', 'SW:Gi1/0/3']],
    post: (L) => {
      adQuick(L, 'DC1', { domain: 'corp.dimo.lk', netbios: 'DIMO', users: [['nimal', 'Nimal Perera', 'Welcome@123']], quiet: true });
      const h = L.devs['FGT-HQ'].cfg;
      Object.assign(h['firewall address'], { 'HQ-NET': { subnet: ['10.10.0.0', '255.255.0.0'] }, 'KDY-NET': { subnet: ['10.30.0.0', '255.255.0.0'] } });
      h['vpn ipsec phase1-interface']['to-KDY'] = { interface: ['port1'], 'remote-gw': ['112.134.88.2'], psksecret: [KDY.psk], 'ike-version': ['2'], proposal: ['aes256-sha256'], dhgrp: ['14'], peertype: ['any'] };
      h['vpn ipsec phase2-interface']['to-KDY'] = { phase1name: ['to-KDY'], proposal: ['aes256-sha256'], 'src-subnet': ['10.10.0.0', '255.255.0.0'], 'dst-subnet': ['10.30.0.0', '255.255.0.0'] };
      h['router static'][2] = { dst: ['10.30.0.0', '255.255.0.0'], device: ['to-KDY'] };
      Object.assign(h['firewall policy'], { 1: { name: ['LAN-Internet'], srcintf: ['port2'], dstintf: ['port1'], srcaddr: ['all'], dstaddr: ['all'], service: ['ALL'], action: ['accept'], schedule: ['always'], nat: ['enable'] }, 2: { name: ['HQ-to-KDY'], srcintf: ['port2'], dstintf: ['to-KDY'], srcaddr: ['HQ-NET'], dstaddr: ['KDY-NET'], service: ['ALL'], action: ['accept'], schedule: ['always'] }, 3: { name: ['KDY-to-HQ'], srcintf: ['to-KDY'], dstintf: ['port2'], srcaddr: ['KDY-NET'], dstaddr: ['HQ-NET'], service: ['ALL'], action: ['accept'], schedule: ['always'] } });
      pveInit(L, L.devs['PVE-KDY']); L.inet.names['download.proxmox.com'] = '170.130.165.91'; L.inet.hosts['170.130.165.91'] = { name: 'download.proxmox.com', tcp: [80, 443] };
      if (o.done) brDone(L); if (o.post) o.post(L); settle(L);
    },
  };
  return spec;
}
const brC = (d, x) => [d, 'con', x];
const brF = (x) => ['FGT-KDY', 'cli', x];
/** The full build – also the model answer (switch, FortiGate, then the host, VM, domain join and backup) */
const BR_SW = ['enable', 'conf t', 'hostname SW-KANDY', 'vlan 10', 'name STAFF', 'vlan 20', 'name SERVERS', 'vlan 99', 'name MGMT', 'exit', 'int g1/0/24', 'description FGT-KANDY internal', 'switchport mode trunk', 'switchport trunk allowed vlan 10,20,99', 'int range g1/0/1 , g1/0/3', 'switchport mode access', 'switchport access vlan 10', 'spanning-tree portfast', 'int g1/0/2', 'description pve-kdy eno1', 'switchport mode trunk', 'switchport trunk native vlan 99', 'switchport trunk allowed vlan 20,99', 'end', 'wr'].map((x) => brC('SW', x));
const BR_FW = ['config system interface', 'edit "STAFF"', 'set vdom "root"', 'set ip 10.30.10.1 255.255.255.0', 'set allowaccess ping', 'set role lan', 'set interface "internal"', 'set vlanid 10', 'next', 'edit "SERVERS"', 'set vdom "root"', 'set ip 10.30.20.1 255.255.255.0', 'set allowaccess ping', 'set role lan', 'set interface "internal"', 'set vlanid 20', 'next', 'edit "MGMT"', 'set vdom "root"', 'set ip 10.30.99.1 255.255.255.0', 'set allowaccess ping https ssh', 'set role lan', 'set interface "internal"', 'set vlanid 99', 'next', 'end',
  'config system dhcp server', 'edit 1', 'set interface "STAFF"', 'set default-gateway 10.30.10.1', 'set netmask 255.255.255.0', 'set dns-service specify', 'set dns-server1 10.10.20.10', 'set domain "corp.dimo.lk"', 'config ip-range', 'edit 1', 'set start-ip 10.30.10.100', 'set end-ip 10.30.10.200', 'next', 'end', 'next', 'end',
  'config firewall address', 'edit "KDY-NET"', 'set subnet 10.30.0.0 255.255.0.0', 'next', 'edit "HQ-NET"', 'set subnet 10.10.0.0 255.255.0.0', 'next', 'edit "KDY-APP01"', 'set subnet 10.30.20.10 255.255.255.255', 'next', 'end',
  'config vpn ipsec phase1-interface', 'edit "to-HQ"', 'set interface "wan1"', 'set remote-gw 203.115.21.6', `set psksecret ${KDY.psk}`, 'set ike-version 2', 'set proposal aes256-sha256', 'set dhgrp 14', 'next', 'end',
  'config vpn ipsec phase2-interface', 'edit "to-HQ"', 'set phase1name "to-HQ"', 'set proposal aes256-sha256', 'set src-subnet 10.30.0.0 255.255.0.0', 'set dst-subnet 10.10.0.0 255.255.0.0', 'next', 'end',
  'config router static', 'edit 2', 'set dst 10.10.0.0 255.255.0.0', 'set device "to-HQ"', 'next', 'end',
  'config firewall policy', 'edit 1', 'set name "Inside-Internet"', 'set srcintf "STAFF" "SERVERS" "MGMT"', 'set dstintf "wan1"', 'set srcaddr "all"', 'set dstaddr "all"', 'set service "ALL"', 'set action accept', 'set schedule "always"', 'set nat enable', 'next', 'edit 2', 'set name "STAFF-to-APP"', 'set srcintf "STAFF"', 'set dstintf "SERVERS"', 'set srcaddr "all"', 'set dstaddr "KDY-APP01"', 'set service "HTTP" "HTTPS"', 'set action accept', 'set schedule "always"', 'next', 'edit 3', 'set name "KDY-to-HQ"', 'set srcintf "STAFF" "SERVERS" "MGMT"', 'set dstintf "to-HQ"', 'set srcaddr "KDY-NET"', 'set dstaddr "HQ-NET"', 'set service "ALL"', 'set action accept', 'set schedule "always"', 'next', 'edit 4', 'set name "HQ-to-KDY"', 'set srcintf "to-HQ"', 'set dstintf "STAFF" "SERVERS" "MGMT"', 'set srcaddr "HQ-NET"', 'set dstaddr "KDY-NET"', 'set service "ALL"', 'set action accept', 'set schedule "always"', 'next', 'end'].map(brF);
const BR_REST = [['PC1', 'cmd', 'ipconfig /renew'], ['PC2', 'cmd', 'ipconfig /renew'], ['PVE-KDY', 'js', "pveInstall(L, d, { host: 'pve-kdy.corp.dimo.lk', ip: '10.30.99.11/24', gw: '10.30.99.1', dns: '10.10.20.10', pass: 'Dimo@Lab2026', email: 'it@dimo.lk', nic: 'eno1' }); d.bridges.vmbr0.aware = true"],
  ['PVE-KDY', 'shell', 'qm create 201 --name kdy-app01 --memory 4096 --cores 2 --net0 virtio,bridge=vmbr0,tag=20 --scsi0 local-lvm:32 --ide2 local:iso/ubuntu-24.04.1-live-server-amd64.iso,media=cdrom --agent 1 --onboot 1'], ['PVE-KDY', 'shell', 'qm start 201'],
  ['VM201', 'js', "lxInstall(L, d, { distro: 'ubuntu', host: 'kdy-app01', user: 'admin', pass: 'Dimo@Lab2026', ssh: true, ip: '10.30.20.10/24', gw: '10.30.20.1', dns: '10.10.20.10' })"], ['PVE-KDY', 'shell', 'qm set 201 --ide2 none'], ['VM201', 'term', 'sudo apt install -y qemu-guest-agent nginx'], ['VM201', 'term', 'sudo systemctl enable --now nginx'],
  ['PVE-KDY', 'shell', 'pvesh create /cluster/backup --schedule 21:00 --storage local --all 1 --mode snapshot --prune-backups keep-last=7'], ['PVE-KDY', 'js', 'pveJobRun(L, L.pve.jobs[0])'],
  ['PC1', 'ps', "Add-Computer -DomainName corp.dimo.lk -Credential (New-Object System.Management.Automation.PSCredential('DIMO\\Administrator', (ConvertTo-SecureString 'Dimo@Lab2026' -AsPlainText -Force))) -Restart"]];
function brDone(L) { runFix(L, [...BR_SW, ...BR_FW, ...BR_REST]); }
const swSaved = (d) => JSON.stringify(devSnap(d)) === JSON.stringify(d.startup);
const brApp = (L) => vmById(L, 201);
SESSIONS.push({
  id: 's23', n: 23, mod: 4, title: 'Capstone: branch office build', focus: 'Plan and build a complete branch from the box: VLANs, firewall, DHCP, VPN to HQ, domain join, a virtualisation host with an app server, backups – and document it', milestone: 'The Kandy branch is live',
  concept: [
    { h: 'The brief', html: `<p>DIMO opens a branch in <b>Kandy</b>. HQ is ready: FortiGate FGT-HQ (203.115.21.6) already has the IPsec tunnel <b>to-KDY</b> configured (IKEv2, AES256-SHA256, DH 14, PSK <code>${KDY.psk}</code>, HQ 10.10.0.0/16 ↔ Kandy 10.30.0.0/16) and DC1 (10.10.20.10) runs AD and DNS for <b>corp.dimo.lk</b>. The ISP has given Kandy <b>112.134.88.2/30</b>, gateway 112.134.88.1 – already on FGT-KANDY wan1.</p><table class="mono" style="font-size:12px"><tr><th>VLAN</th><th>Name</th><th>Subnet</th><th>Gateway (FGT-KANDY)</th><th>Use</th></tr><tr><td>10</td><td>STAFF</td><td>10.30.10.0/24</td><td>10.30.10.1</td><td>PCs – DHCP .100–.200, DNS 10.10.20.10</td></tr><tr><td>20</td><td>SERVERS</td><td>10.30.20.0/24</td><td>10.30.20.1</td><td>kdy-app01 10.30.20.10</td></tr><tr><td>99</td><td>MGMT</td><td>10.30.99.0/24</td><td>10.30.99.1</td><td>pve-kdy 10.30.99.11</td></tr></table>` },
    { h: 'Work order', html: `<ol><li><b>Switch</b>: hostname SW-KANDY, VLANs, trunk to the FortiGate (Gi1/0/24), PC ports (Gi1/0/1, Gi1/0/3) in VLAN 10, the host's port (Gi1/0/2) trunk with VLAN 99 native and 20 allowed. Save.</li><li><b>FortiGate</b>: VLAN interfaces on <i>internal</i>, DHCP for STAFF (DNS = DC1!), addresses, the IPsec tunnel to HQ, a route to 10.10.0.0/16 via the tunnel, and least-privilege policies: inside → Internet (NAT), STAFF → app server HTTP/HTTPS only, Kandy ↔ HQ.</li><li><b>Test</b> from KDY-PC01: address, Internet, ping DC1, <code>nslookup dc1.corp.dimo.lk</code>. Then <b>join the domain</b>.</li><li><b>Proxmox</b>: install pve-kdy in VLAN 99, VLAN-aware bridge, VM <b>201 kdy-app01</b> (Ubuntu, VLAN 20, 10.30.20.10, nginx, guest agent, start at boot).</li><li><b>Backup</b>: nightly job, keep-last 7, run it once.</li><li><b>Document</b> what you built (as-built) in the Review tab.</li></ol><p>Work in this order – each step needs the one before. When something fails, use the method from Session 1: start at the user, go layer by layer.</p>` },
  ],
  lab: {
    title: 'Build: Kandy branch office',
    intro: `<p>Everything in Kandy is fresh out of the box. Passwords: <b>${KDY.pass}</b> for root on Proxmox, admin on Ubuntu, and DIMO\\Administrator in the domain. The concept tab has the plan.</p>`,
    build: () => brLab(), open: ['SW', 'FGT-KDY'],
    tasks: [
      { id: 'sw', t: 'SW-KANDY: VLANs 10 STAFF / 20 SERVERS / 99 MGMT, trunk to the FortiGate, PC ports in VLAN 10, pve-kdy\'s port a trunk with native 99 – and the config is <b>saved</b>.', check: (L) => { const d = L.devs.SW; const p = d.ports; return d.hostname === 'SW-KANDY' && d.vlans[10] === 'STAFF' && d.vlans[20] === 'SERVERS' && d.vlans[99] === 'MGMT' && p['Gi1/0/24'].mode === 'trunk' && +p['Gi1/0/1'].vlan === 10 && +p['Gi1/0/3'].vlan === 10 && p['Gi1/0/2'].mode === 'trunk' && +p['Gi1/0/2'].native === 99 && swSaved(d); } },
      { id: 'fw', t: 'FGT-KANDY: KDY-PC01 gets a <b>10.30.10.x</b> address with DNS 10.10.20.10 and reaches the Internet (8.8.8.8).', check: (L) => inSub(L, 'PC1', '10.30.10.0', 24) && (C.nic(L, 'PC1').dns || []).includes('10.10.20.10') && C.ping(L, 'PC1', '8.8.8.8') },
      { id: 'vpn', t: 'The IPsec tunnel to HQ is up: KDY-PC01 reaches DC1 on LDAP (389) and resolves <b>dc1.corp.dimo.lk</b>.', check: (L) => C.reach(L, 'PC1', '10.10.20.10', 389) && C.resolves(L, 'PC1', 'dc1.corp.dimo.lk', '10.10.20.10') },
      { id: 'dom', t: 'KDY-PC01 is joined to <b>corp.dimo.lk</b> and nimal (Welcome@123) can sign in on it.', check: (L) => L.devs.PC1.domain === 'corp.dimo.lk' && adLogon(L, L.devs.PC1, 'nimal', 'Welcome@123').ok },
      { id: 'pve', t: 'pve-kdy runs at <b>10.30.99.11</b> (VLAN 99, VLAN-aware vmbr0) and VM <b>201 kdy-app01</b> (VLAN 20, 10.30.20.10, guest agent, start at boot) serves the intranet: KDY-PC01 opens <code>http://10.30.20.10</code>.', check: (L) => { const H = L.devs['PVE-KDY']; const V = brApp(L); return !H.pvesetup && H.mgmt?.ip === '10.30.99.11' && H.bridges.vmbr0?.aware && !!V && V.vm.status === 'running' && Object.values(V.nics)[0].tag === 20 && Object.values(V.nics)[0].ip === '10.30.20.10' && V.vm.onboot && (V.pkgs || []).includes('qemu-guest-agent') && C.web(L, 'PC1', 'http://10.30.20.10'); } },
      { id: 'bk', t: 'A nightly backup job for kdy-app01 with <b>keep-last 7</b> has run successfully.', check: (L) => (L.pve?.jobs || []).some((j) => j.enabled !== false && (j.all || (j.vmids || []).map(String).includes('201')) && j.keep && j.keep <= 14 && j.last?.ok) },
    ],
  },
  tickets: [
    { id: 't1', no: 6701, title: 'New desk in Kandy: "No internet" on KDY-PC02', who: 'Kandy office', text: '<p>"KDY-PC02 was moved to the new desk (switch port Gi1/0/3) and shows <i>No internet</i>, 169.254 address."</p>', build: () => brLab({ done: true }), open: ['SW', 'PC2'], fault: (L) => { L.devs.SW.ports['Gi1/0/3'].vlan = 1; Object.assign(L.devs.PC2.nics.Ethernet, { ip: null, tried: false, apipa: null }); settle(L); }, hint: 'Which VLAN is the port in? Fix the switch, then ipconfig /renew on the PC.', checks: [{ t: 'KDY-PC02 has a 10.30.10.x address', f: (L) => inSub(L, 'PC2', '10.30.10.0', 24) }, { t: 'The switch config is saved', f: (L) => swSaved(L.devs.SW) }] },
    { id: 't2', no: 6704, title: 'kdy-app01 can\'t download updates', who: 'IT – Kandy', text: '<p>"apt update on kdy-app01 fails with <i>Temporary failure resolving</i> / time-outs. The PCs browse fine." A policy was "cleaned up" on FGT-KANDY yesterday.</p>', build: () => brLab({ done: true }), open: ['FGT-KDY', 'VM201'], fault: (L) => { L.devs['FGT-KDY'].cfg['firewall policy'][1].srcintf = ['STAFF']; settle(L); }, hint: 'Which interfaces may go to wan1? Look at policy 1.', checks: [{ t: 'kdy-app01 reaches the Internet', f: (L) => send(L, brApp(L).id, { dst: '8.8.8.8' }).res === 'ok' }, { t: 'PCs still reach the Internet', f: (L) => C.ping(L, 'PC1', '8.8.8.8') }] },
  ],
  submit: {
    title: 'As-built document for Kandy',
    intro: 'Write what you built so the next engineer can support it without you: the IP plan and VLANs, switch ports, firewall interfaces and policies, the VPN parameters (not the key itself – where it is stored), the server and VM, backups. Your trainer marks it with the build.',
    fields: [['ip', 'IP plan and VLANs', 90], ['net', 'Switch ports and firewall (interfaces, DHCP, policies, VPN)', 140], ['srv', 'Proxmox host, VMs, backups', 100], ['test', 'How you tested it, and what is still open', 70]],
  },
  quiz: [
    { q: 'Why does the STAFF DHCP scope hand out DC1 (10.10.20.10) as DNS and not 8.8.8.8?', a: ['Faster', 'Domain join and logon need the AD DNS records (SRV) – only DC1 has them', 'Licensing', 'It doesn\'t matter'], c: 1, why: 'Public DNS knows nothing about corp.dimo.lk.' },
    { q: 'The tunnel is up but KDY-PC01 can\'t reach DC1. Branch side, check…', a: ['The ISP', 'The static route to 10.10.0.0/16 via the tunnel and a policy STAFF → to-HQ', 'The switch', 'DHCP'], c: 1, why: 'Route + policy on both ends.' },
    { q: 'Which order is right for a new branch?', a: ['VM, then VPN, then switch', 'Switch → firewall/DHCP → VPN → domain → server/VMs → backup', 'Backup first', 'Any order'], c: 1, why: 'Each layer needs the one below.' },
    { q: 'The host\'s switch port carries VLAN 99 untagged and VLAN 20 tagged. That is…', a: ['An access port', 'A trunk with native VLAN 99', 'A routed port', 'Port security'], c: 1, why: 'switchport trunk native vlan 99.' },
  ],
});
