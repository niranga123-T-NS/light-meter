// =================== Session 24 – Capstone II: break & fix on the Kandy branch (8 faults, graded) and the final presentation
const brOk = (L) => C.web(L, 'PC1', 'http://10.30.20.10');
SESSIONS.push({
  id: 's24', n: 24, mod: 4, title: 'Capstone: break & fix + presentation', focus: 'Eight faults across network, firewall, VPN, servers, virtualisation and backup on the branch you built – then present your root causes and lessons', milestone: 'Graded: 8 faults + presentation – 75 % signs you off', graded: true,
  concept: [
    { h: 'How the final test works', html: `<p>You get the finished Kandy branch from Session 23, broken in eight different places – one fault per lab, each with the user's complaint. You have <b>120 minutes</b>. Hints are off. A fault counts when all its checks pass, so fix the <b>cause</b>, not the symptom, and do not break anything else on the way.</p><p>Use the method: <b>1</b> reproduce from the user's device, <b>2</b> work up the layers (cable/port → VLAN → IP/DHCP → gateway/route → firewall/VPN → DNS → service/app), <b>3</b> change one thing, <b>4</b> test from the user again, <b>5</b> write down cause, fix and prevention.</p>` },
    { h: 'The presentation', html: `<p>After the test, present to your trainer (10 minutes): for each fault the <b>symptom</b>, how you <b>found</b> it (which command or screen proved it), the <b>root cause</b>, the <b>fix</b>, and how to <b>prevent</b> it (monitoring, a checklist, config backup, a script). Hand in your notes in the Review tab. Scoring for the programme: write-ups 15 %, labs 15 %, network test 20 %, script 15 %, VM test 15 %, capstone 20 % – <b>75 % or more signs you off</b>.</p>` },
  ],
  lab: {
    title: 'Warm-up on the finished branch',
    intro: '<p>This is the Kandy branch as it should be after Session 23. Get to know it before the test – where to look and which command proves what.</p>',
    build: () => brLab({ done: true }), open: ['FGT-KDY', 'PVE-KDY'],
    tasks: [
      { id: 'w1', t: 'What is the name of the IPsec tunnel interface on FGT-KANDY?', ans: () => ['to-HQ'] },
      { id: 'w2', t: 'Which IP address does KDY-PC01 have right now? (ipconfig)', ans: (L) => [C.nic(L, 'PC1').ip || ''] },
      { id: 'w3', t: 'Run the Kandy backup job now – it finishes OK.', check: (L) => (L.pve?.jobs || []).some((j) => j.last?.ok && j.last.t > 1e6) },
      { id: 'w4', t: 'Which VLAN tag does kdy-app01\'s NIC have? (number)', ans: () => ['20'] },
    ],
  },
  test: {
    title: 'Capstone break & fix',
    intro: '<p>Eight faults on the Kandy branch, each in its own lab. Start at the user, work through the layers, fix the cause, test again from the user. A fault counts when all its checks pass.</p>',
    mins: 120,
    faults: [
      { id: 'f1', title: 'KDY-PC01: "No internet" after the cleaner unplugged things', who: 'Kandy reception', text: '<p>"My PC shows a yellow triangle since this morning. The cleaner pulled some cables and the IT shop guy \'put the switch back the way it was\'."</p>', build: () => brLab({ done: true }), open: ['PC1', 'SW'], fault: (L) => { L.devs.SW.ports['Gi1/0/1'].vlan = 20; L.devs.SW.startup = devSnap(L.devs.SW); Object.assign(L.devs.PC1.nics.Ethernet, { ip: null, tried: false, apipa: null }); settle(L); }, checks: [{ t: 'KDY-PC01 has a 10.30.10.x address', f: (L) => inSub(L, 'PC1', '10.30.10.0', 24) }, { t: 'The switch config is saved', f: (L) => swSaved(L.devs.SW) }] },
      { id: 'f2', title: 'Shared drives and sign-in to HQ systems fail', who: 'Kandy staff', prio: 'High', text: '<p>"The Internet works, but the HQ intranet name and the domain don\'t: <i>The specified domain either does not exist or could not be contacted</i>." The DHCP settings were "standardised" by the HQ firewall team.</p>', build: () => brLab({ done: true }), open: ['PC1', 'FGT-KDY'], fault: (L) => { L.devs['FGT-KDY'].cfg['system dhcp server'][1]['dns-server1'] = ['8.8.8.8']; Object.assign(L.devs.PC1.nics.Ethernet, { ip: null, tried: false, apipa: null, dns: [] }); settle(L); }, checks: [{ t: 'KDY-PC01 resolves dc1.corp.dimo.lk', f: (L) => C.resolves(L, 'PC1', 'dc1.corp.dimo.lk', '10.10.20.10') }, { t: 'nimal can sign in on KDY-PC01', f: (L) => adLogon(L, L.devs.PC1, 'nimal', 'Welcome@123').ok }] },
      { id: 'f3', title: 'Branch cut off from HQ – Internet fine', who: 'Kandy manager', prio: 'High', text: '<p>"Nothing at HQ answers from Kandy since the security team rotated \'all VPN keys\' last night. HQ says their side is done."</p>', build: () => brLab({ done: true }), open: ['FGT-KDY'], fault: (L) => { L.devs['FGT-KDY'].cfg['vpn ipsec phase1-interface']['to-HQ'].psksecret = ['Dimo#Kdy2025']; settle(L); }, checks: [{ t: 'KDY-PC01 reaches DC1 (LDAP 389)', f: (L) => C.reach(L, 'PC1', '10.10.20.10', 389) }] },
      { id: 'f4', title: 'Branch intranet (kdy-app01) not reachable from PCs', who: 'Kandy staff', text: '<p>"http://10.30.20.10 times out on every PC. The server team says the VM is fine and pings its gateway." Someone was "reviewing firewall policies".</p>', build: () => brLab({ done: true }), open: ['FGT-KDY'], fault: (L) => { L.devs['FGT-KDY'].cfg['firewall policy'][2].status = ['disable']; settle(L); }, checks: [{ t: 'KDY-PC01 opens http://10.30.20.10', f: (L) => brOk(L) }, { t: 'STAFF may still reach the app on HTTP/HTTPS only', f: (L) => { const p = L.devs['FGT-KDY'].cfg['firewall policy'][2]; return !!p && (p.service || []).every((s) => ['HTTP', 'HTTPS'].includes(s)) && !C.reach(L, 'PC1', '10.30.20.10', 22); } }] },
      { id: 'f5', title: 'kdy-app01 unreachable after "VM network tidy-up"', who: 'Kandy staff', text: '<p>"The branch intranet is down again." On Proxmox, a colleague "aligned the VM tags with the PCs\' VLAN".</p>', build: () => brLab({ done: true }), open: ['PVE-KDY'], fault: (L) => { brApp(L).nics.ens18.tag = 10; settle(L); }, checks: [{ t: 'KDY-PC01 opens http://10.30.20.10', f: (L) => brOk(L) }, { t: 'kdy-app01 is in VLAN 20', f: (L) => brApp(L).nics.ens18.tag === 20 }] },
      { id: 'f6', title: 'Intranet down after patch reboot', who: 'Kandy staff', text: '<p>"Since last night\'s updates and reboot, http://10.30.20.10 says <i>connection refused</i>. We can still ping the server."</p>', build: () => brLab({ done: true }), open: ['VM201'], fault: (L) => { const V = brApp(L); V.units.nginx.enabled = false; vmStop(L, V, 'shutdown'); vmStart(L, V); }, checks: [{ t: 'KDY-PC01 opens http://10.30.20.10', f: (L) => brOk(L) }, { t: 'nginx starts at boot', f: (L) => !!brApp(L).units.nginx.enabled }] },
      { id: 'f7', title: 'Kandy backup report: "job errors" every night', who: 'Backup report', text: '<p>"The Kandy backup has failed for a week." The job was edited when someone "moved backups to the faster disk".</p>', build: () => brLab({ done: true }), open: ['PVE-KDY'], fault: (L) => { const j = L.pve.jobs[0]; j.store = 'local-lvm'; pveJobRun(L, j); L.t24 = L.clock; }, checks: [{ t: 'The nightly job runs OK', f: (L) => L.pve.jobs.some((j) => j.enabled !== false && j.last?.ok && j.last.t > (L.t24 ?? 0)) }, { t: 'Retention is still set', f: (L) => L.pve.jobs.every((j) => j.keep && j.keep <= 14) }] },
      { id: 'f8', title: 'KDY-PC01: "time and/or date difference" at sign-in', who: 'Kandy reception', text: '<p>"Since the PC\'s motherboard battery was replaced I can\'t sign in: <i>There is a time and/or date difference between the client and server</i>."</p>', build: () => brLab({ done: true }), open: ['PC1'], fault: (L) => { L.devs.PC1.clockSkew = 42; }, checks: [{ t: 'nimal can sign in on KDY-PC01', f: (L) => adLogon(L, L.devs.PC1, 'nimal', 'Welcome@123').ok }] },
    ],
  },
  submit: {
    kind: 'notes',
    title: 'Graded: capstone presentation notes',
    intro: 'Your notes for the 10-minute presentation to your trainer: for each of the eight faults the symptom, the proof, the root cause, the fix and the prevention. Then what you would monitor at the branch, and what you learned in the programme.',
    fields: [['faults', 'The eight faults: symptom → proof → root cause → fix → prevention', 260], ['monitor', 'What you would monitor at the Kandy branch, and how', 90], ['learned', 'Your three most important lessons from the programme', 90]],
  },
  quiz: [
    { q: 'A PC has 169.254.x.x. The very first things to check?', a: ['DNS', 'The cable/port, the port\'s VLAN, and whether a DHCP server serves that VLAN', 'The VPN', 'Windows updates'], c: 1, why: 'APIPA = no DHCP answer.' },
    { q: 'Internet works but domain names inside the company don\'t. Likely?', a: ['The firewall', 'The PC uses a public DNS server instead of the domain DNS', 'The switch', 'A virus'], c: 1, why: 'Check ipconfig /all → DNS servers.' },
    { q: 'An IPsec tunnel stays down after "keys were rotated". Check…', a: ['The switch', 'That both ends have the same pre-shared key (and proposals)', 'The DHCP scope', 'DNS'], c: 1, why: 'Phase 1 fails on a PSK mismatch.' },
    { q: 'A service works until the server reboots. Root cause?', a: ['Bad cable', 'It is not enabled to start at boot (systemctl enable / restart policy)', 'Wrong VLAN', 'DNS'], c: 1, why: 'enable --now.' },
    { q: 'Kerberos sign-in fails with a time error. Max allowed difference?', a: ['1 minute', '5 minutes', '1 hour', 'No limit'], c: 1, why: 'w32tm /resync.' },
    { q: 'A good fault write-up contains…', a: ['Only the fix', 'Symptom, proof, root cause, fix and prevention', 'Who to blame', 'Screenshots only'], c: 1, why: 'So it doesn\'t happen again.' },
  ],
});
