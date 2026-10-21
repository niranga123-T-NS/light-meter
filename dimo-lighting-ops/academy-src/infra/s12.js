// =================== Session 12 – Group Policy & file services: GPO design, drive maps, printers, security baselines; shares, NTFS vs share permissions, AGDLP, DFS basics
const BASE12 = 'DC=corp,DC=dimo,DC=lk';
function gpoLab(o = {}) {
  const srv = (id, x, y, ip) => ({ id, kind: 'srv', x, y, hostname: id, os: 'win', server: true, ver: 'Microsoft Windows Server 2022 Standard', adminPass: 'Dimo@Lab2026', nics: { Ethernet: { cidr: `${ip}/24`, gw: '10.10.20.1', dns: ['10.10.20.10'] } } });
  const spec = {
    devs: [
      B.isp(330, 30, { a: { cidr: '203.115.21.5/30' } }),
      { id: 'FGT', kind: 'fw', x: 330, y: 100, hostname: 'FGT-HQ', ifs: { port1: { cidr: '203.115.21.6/30', access: 'ping', role: 'wan' }, port2: { cidr: '10.10.20.1/24', access: 'ping https ssh', role: 'lan' } }, cfg: { 'router static': { 1: { gateway: ['203.115.21.5'], device: ['port1'] } }, 'firewall policy': { 1: { name: ['LAN-Internet'], srcintf: ['port2'], dstintf: ['port1'], srcaddr: ['all'], dstaddr: ['all'], service: ['ALL'], action: ['accept'], schedule: ['always'], nat: ['enable'] } } } },
      B.sw('SW', 330, 180, 8, { hn: 'SW-HQ' }),
      srv('DC1', 180, 260, '10.10.20.10'), srv('FS1', 480, 260, '10.10.20.20'),
      B.pc('PC1', 250, 350, '10.10.20.51/24', { gw: '10.10.20.1', dns: ['10.10.20.10'], hn: 'FIN-PC01' }), B.pc('PC2', 410, 350, '10.10.20.52/24', { gw: '10.10.20.1', dns: ['10.10.20.10'], hn: 'HR-PC01' }),
    ],
    links: [['ISP:a', 'FGT:port1'], ['FGT:port2', 'SW:Gi1/0/8'], ['DC1:Ethernet', 'SW:Gi1/0/1'], ['FS1:Ethernet', 'SW:Gi1/0/2'], ['PC1:Ethernet', 'SW:Gi1/0/3'], ['PC2:Ethernet', 'SW:Gi1/0/4']],
    post: (L) => {
      ['DC1', 'FS1'].forEach((k) => { winInit(L, L.devs[k]); L.devs[k].localPass = { Administrator: 'Dimo@Lab2026' }; });
      adPair(L, 'DC1', null, { ous: ['Finance', 'HR', 'Workstations', 'Servers'], users: [['nimal', 'Nimal Perera', 'Finance'], ['kamal', 'Kamal Silva', 'Finance'], ['sachini', 'Sachini Fernando', 'HR']], join: ['PC1', 'PC2'], joinOu: 'Workstations' });
      const ps = (c) => winPs(L, L.devs.DC1, c);
      [`New-ADGroup -Name GG_Finance -GroupScope Global -Path 'OU=Finance,OU=DIMO,${BASE12}'`, `New-ADGroup -Name GG_HR -GroupScope Global -Path 'OU=HR,OU=DIMO,${BASE12}'`, 'Add-ADGroupMember GG_Finance -Members nimal,kamal', 'Add-ADGroupMember GG_HR -Members sachini'].forEach(ps);
      winPs(L, L.devs.FS1, `Add-Computer -DomainName corp.dimo.lk -OUPath 'OU=Servers,OU=DIMO,${BASE12}' -Credential (New-Object System.Management.Automation.PSCredential('DIMO\\Administrator', (ConvertTo-SecureString 'Dimo@Lab2026' -AsPlainText -Force))) -Restart`);
      ['C:\\Shares', 'C:\\Shares\\Finance', 'C:\\Shares\\HR'].forEach((p) => winPs(L, L.devs.FS1, `New-Item -ItemType Directory -Path '${p}' -Force | Out-Null`));
      if (o.done) gpoDone(L); if (o.post) o.post(L); settle(L);
    },
  };
  return spec;
}
function gpoDone(L) {
  const dc = (c) => winPs(L, L.devs.DC1, c), fs = (c) => winPs(L, L.devs.FS1, c);
  [`New-ADGroup -Name DL_Finance_Modify -GroupScope DomainLocal -Path 'OU=Finance,OU=DIMO,${BASE12}'`, `New-ADGroup -Name DL_HR_Modify -GroupScope DomainLocal -Path 'OU=HR,OU=DIMO,${BASE12}'`, 'Add-ADGroupMember DL_Finance_Modify -Members GG_Finance', 'Add-ADGroupMember DL_HR_Modify -Members GG_HR'].forEach(dc);
  ['Finance', 'HR'].forEach((x) => { fs(`New-SmbShare -Name ${x} -Path 'C:\\Shares\\${x}' -ChangeAccess 'Authenticated Users'`); fs(`icacls C:\\Shares\\${x} /inheritance:r /grant "DIMO\\DL_${x}_Modify:(OI)(CI)M" /grant "Administrators:(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F"`); });
  dc(`New-GPO -Name 'Finance Drives' | New-GPLink -Target 'OU=Finance,OU=DIMO,${BASE12}'`); const g = L.ad.gpos['Finance Drives']; g.user.drives = [{ letter: 'S', path: '\\\\FS1\\Finance' }];
  dc(`New-GPO -Name 'HR Drives' | New-GPLink -Target 'OU=HR,OU=DIMO,${BASE12}'`); L.ad.gpos['HR Drives'].user.drives = [{ letter: 'H', path: '\\\\FS1\\HR' }];
  dc(`New-GPO -Name 'Workstation Baseline' | New-GPLink -Target 'OU=Workstations,OU=DIMO,${BASE12}'`); const b = L.ad.gpos['Workstation Baseline']; b.comp.fw = true; b.comp.usbDeny = true; b.comp.banner = 'Authorised DIMO users only. Activity is logged.';
  dc(`Set-ADDefaultDomainPasswordPolicy -Identity corp.dimo.lk -MinPasswordLength 12`);
  ['PC1', 'PC2'].forEach((p) => gpoApply(L, L.devs[p])); adLogon(L, L.devs.PC1, 'nimal', 'Welcome@123'); adLogon(L, L.devs.PC2, 'sachini', 'Welcome@123');
  settle(L, 'nodhcp');
}
/** Effective access of a user to a UNC path from a PC: 0 none, 1 read, 1.5 write, 2 modify, 3 full */
const accessOf = (L, pc, user, unc) => { try { return smbOpen({ L, d: L.devs[pc], user }, unc).eff; } catch (e) { return -1; } };
const gpoLinkedTo = (L, ou) => Object.entries(L.ad?.gpos || {}).filter(([, g]) => (g.links || []).some((l) => l.ou === ou && l.on)).map(([n]) => n);
SESSIONS.push({
  id: 's12', n: 12, mod: 2, title: 'Group Policy & file services', focus: 'GPO design, drive mappings, printers, security baselines; file shares, NTFS vs share permissions, DFS basics', milestone: 'Policies applied to users',
  concept: [
    { h: 'Group Policy: where it applies', html: `<p>A GPO has two halves: <b>Computer Configuration</b> (applies to computer objects in the OU, at startup) and <b>User Configuration</b> (applies to user objects in the OU, at logon). The most common mistake: a GPO with <i>user</i> settings (drive maps) linked to an OU that only holds <i>computers</i> – nothing happens.</p><p>Processing order is <b>L-S-D-OU</b>: local, site, domain, then OUs from the top down – the last one wins. <b>Enforced</b> links win over everything below; <b>Block Inheritance</b> stops parent GPOs (except enforced ones). <b>Security filtering</b> limits a GPO to certain groups (they need Read + Apply).</p><p>Troubleshoot with <code>gpresult /r</code> (what applied, what was filtered out and why) and <code>gpupdate /force</code>.</p>`, check: [
      { q: 'A drive-map GPO is linked to the Workstations OU (computers only). Users get no drive. Why?', a: ['The GPO is disabled', 'Drive maps are user settings – the users are not in that OU', 'The share is down', 'DNS'], c: 1, why: 'Link user policies where the users are (or use loopback).' },
      { q: 'Which command shows the GPOs applied to the current user and computer?', a: ['gpupdate', 'gpresult /r', 'ipconfig /all', 'netdom'], c: 1, why: 'Look for "Applied" and "filtered out".' },
    ] },
    { h: 'Share permissions vs NTFS permissions', html: `<p>Over the network both apply and the <b>most restrictive</b> wins. Common practice: share permission <b>Authenticated Users – Change</b> (or Full), and do the real work in <b>NTFS</b>.</p><p>NTFS on the folder: remove inheritance from the drive root, give <b>Administrators/SYSTEM Full</b> and the department's <b>domain local group Modify</b>. AGDLP: users → <b>GG_Finance</b> (global, by role) → <b>DL_Finance_Modify</b> (domain local, per resource) → NTFS Modify. New starter? Add them to GG_Finance – no folder changes. Deny entries are rarely needed and override allows.</p><p><b>DFS Namespaces</b> give one path (<code>\\\\corp.dimo.lk\\Shares\\Finance</code>) that points to the real servers, so you can move data without changing every drive map.</p>`, w: 'effperm', check: [
      { q: 'Share: Everyone Read. NTFS: GG_Finance Modify. What can Finance users do over the network?', a: ['Modify', 'Read only – the most restrictive wins', 'Nothing', 'Full control'], c: 1, why: 'Share Read caps it.' },
    ] },
    { h: 'Security baselines', html: `<p>A <b>baseline GPO</b> on the workstation OU sets the company minimum: firewall on, USB storage blocked, logon banner, automatic updates, local admin renamed. Password and lockout policy for domain accounts must be in a GPO linked at the <b>domain</b> level (the Default Domain Policy), not at an OU.</p>` },
  ],
  lab: {
    title: 'Lab: department shares with correct access, drive maps and a workstation baseline',
    intro: '<p>corp.dimo.lk is running on DC1. FS1 (10.10.20.20) is a member file server with empty folders C:\\Shares\\Finance and C:\\Shares\\HR. Users: nimal and kamal (Finance, GG_Finance), sachini (HR, GG_HR); all passwords Welcome@123. FIN-PC01 and HR-PC01 are in OU DIMO › Workstations.</p>',
    build: () => gpoLab(), open: ['DC1', 'FS1'],
    tasks: [
      { id: 'dl', t: 'AGDLP: domain local groups <b>DL_Finance_Modify</b> and <b>DL_HR_Modify</b>, with GG_Finance / GG_HR as their members.', check: (L) => L.ad?.groups.DL_Finance_Modify?.scope === 'DomainLocal' && L.ad.groups.DL_HR_Modify?.scope === 'DomainLocal' && L.ad.groups.DL_Finance_Modify.members.includes('GG_Finance') && L.ad.groups.DL_HR_Modify.members.includes('GG_HR') },
      { id: 'fin', t: 'Share <b>\\\\FS1\\Finance</b>: Finance users can create and change files; HR cannot even open it.', check: (L) => accessOf(L, 'PC1', 'nimal', '\\\\FS1\\Finance') >= 2 && accessOf(L, 'PC2', 'sachini', '\\\\FS1\\Finance') < 1, hint: '<code>New-SmbShare -Name Finance -Path C:\\Shares\\Finance -ChangeAccess "Authenticated Users"</code>, then NTFS: <code>icacls C:\\Shares\\Finance /inheritance:r /grant "DIMO\\DL_Finance_Modify:(OI)(CI)M" /grant "Administrators:(OI)(CI)F" /grant "SYSTEM:(OI)(CI)F"</code>.' },
      { id: 'hr', t: 'Share <b>\\\\FS1\\HR</b> the same way for HR; Finance cannot open it.', check: (L) => accessOf(L, 'PC2', 'sachini', '\\\\FS1\\HR') >= 2 && accessOf(L, 'PC1', 'nimal', '\\\\FS1\\HR') < 1 },
      { id: 'map', t: 'GPO <b>Finance Drives</b> maps <b>S:</b> to \\\\FS1\\Finance for Finance users; GPO <b>HR Drives</b> maps <b>H:</b> to \\\\FS1\\HR for HR. Sign in as nimal on FIN-PC01 and sachini on HR-PC01 to test.', check: (L) => L.devs.PC1.drives?.S?.toLowerCase() === '\\\\fs1\\finance' && L.devs.PC2.drives?.H?.toLowerCase() === '\\\\fs1\\hr', hint: 'Link the GPOs to the Finance and HR OUs (where the users are). Group Policy Management → Edit → Drive map.' },
      { id: 'base', t: 'GPO <b>Workstation Baseline</b> on OU Workstations: firewall enforced, removable storage denied, logon banner. Both PCs have it applied (<code>gpupdate /force</code>).', check: (L) => ['PC1', 'PC2'].every((p) => L.devs[p].policy?.usbDeny && L.devs[p].policy?.fw && !!L.devs[p].policy?.banner) },
      { id: 'pwd', t: 'Domain password policy: minimum length 12.', check: (L) => (L.ad?.gpos['Default Domain Policy']?.comp.pwdLen || 0) >= 12 },
      { id: 'who', t: 'On FIN-PC01 signed in as nimal: <code>gpresult /r</code> – which GPO gives the S: drive?', ans: () => ['Finance Drives'] },
    ],
  },
  tickets: [
    { id: 't1', no: 5203, title: 'S: drive missing for Finance', who: 'Nimal, Finance', text: '<p>"Since the IT clean-up my S: drive is gone. I can still open \\\\FS1\\Finance if I type it." (An admin "moved the drive-map GPO to the workstations OU to keep things tidy".)</p>', build: () => gpoLab({ done: true }), open: ['PC1', 'DC1'], fault: (L) => { const g = L.ad.gpos['Finance Drives']; g.links = [{ ou: 'DIMO/Workstations', on: true, enforced: false }]; delete L.devs.PC1.drives.S; adLogon(L, L.devs.PC1, 'nimal', 'Welcome@123'); }, hint: '<code>gpresult /r</code> under USER SETTINGS. Where is the GPO linked, and where are the users?', checks: [{ t: 'nimal gets S: at logon on FIN-PC01', f: (L) => adLogon(L, L.devs.PC1, 'nimal', 'Welcome@123').ok && L.devs.PC1.drives?.S?.toLowerCase() === '\\\\fs1\\finance' }] },
    { id: 't2', no: 5209, title: 'New HR officer: "Access is denied"', who: 'HR manager', text: '<p>"Dilini started today. Her account works but the HR folder says <i>Access is denied</i>." (dilini / Welcome@2026! was created in the HR OU this morning – the new 12-character policy applies.)</p>', build: () => gpoLab({ done: true, post: (L) => winPs(L, L.devs.DC1, `New-ADUser -Name 'Dilini Silva' -SamAccountName dilini -Path 'OU=HR,OU=DIMO,${BASE12}' -AccountPassword (ConvertTo-SecureString 'Welcome@2026!' -AsPlainText -Force) -Enabled $true`) }), open: ['DC1', 'FS1'], hint: 'Compare dilini\'s groups with sachini\'s. Who has NTFS rights on C:\\Shares\\HR? Fix it the AGDLP way – not by adding her to the folder.', checks: [{ t: 'dilini can change files in \\\\FS1\\HR', f: (L) => accessOf(L, 'PC2', 'dilini', '\\\\FS1\\HR') >= 2 }, { t: 'Done through the group (no user entry on the folder)', f: (L) => !(L.devs.FS1.acl?.['C:\\Shares\\HR']?.aces || []).some((a) => /dilini/i.test(a.who)) }] },
    { id: 't3', no: 5214, title: 'Finance can open files but not save', who: 'Kamal, Finance', prio: 'High', text: '<p>"Excel says the file is read-only on S:. Yesterday it was fine." (The file server was rebuilt from documentation last night.)</p>', build: () => gpoLab({ done: true }), open: ['FS1'], fault: (L) => { const s = L.devs.FS1.shares.Finance; s.perms = [{ who: 'Everyone', right: 'Read', type: 'allow' }]; }, hint: 'Effective access over the network = share ∩ NTFS. <code>Get-SmbShareAccess Finance</code> and <code>icacls C:\\Shares\\Finance</code>.', checks: [{ t: 'kamal can save on \\\\FS1\\Finance', f: (L) => accessOf(L, 'PC1', 'kamal', '\\\\FS1\\Finance') >= 2 }, { t: 'HR still cannot open it', f: (L) => accessOf(L, 'PC2', 'sachini', '\\\\FS1\\Finance') < 1 }] },
    { id: 't4', no: 5221, title: 'USB sticks still work on HR-PC01', who: 'IT security', text: '<p>"Our audit found that HR-PC01 accepts USB storage and has no logon banner. All other PCs are fine." (HR-PC01 was re-joined to the domain last month.)</p>', build: () => gpoLab({ done: true }), open: ['DC1', 'PC2'], fault: (L) => { L.ad.computers['HR-PC01'].ou = 'Computers'; gpoApply(L, L.devs.PC2); L.devs.PC2.policy = {}; }, hint: '<code>gpresult /r /scope computer</code> on HR-PC01 – which OU is it in?', checks: [{ t: 'HR-PC01 has the Workstation Baseline applied', f: (L) => !!L.devs.PC2.policy?.usbDeny && !!L.devs.PC2.policy?.banner }, { t: 'HR-PC01 is in OU DIMO › Workstations', f: (L) => L.ad.computers['HR-PC01'].ou === 'DIMO/Workstations' }] },
  ],
  quiz: [
    { q: 'In which order are GPOs processed?', a: ['OU, domain, site, local', 'Local, site, domain, OU (last wins)', 'Alphabetical', 'Random'], c: 1, why: 'LSDOU.' },
    { q: 'What does Enforced on a GPO link do?', a: ['Applies it faster', 'Its settings win over lower GPOs and it ignores Block Inheritance', 'Applies it to every domain', 'Forces a reboot'], c: 1, why: 'Use rarely.' },
    { q: 'Where must the domain password policy be set?', a: ['On the Users OU', 'In a GPO linked at the domain (Default Domain Policy)', 'On each PC', 'On the DC OU'], c: 1, why: 'Domain accounts read it only from the domain level.' },
    { q: 'A new Finance user needs the share. The AGDLP way is…', a: ['Add the user to the folder\'s NTFS', 'Add the user to GG_Finance', 'Make the user an admin', 'Share the folder again'], c: 1, why: 'Groups carry the rights.' },
    { q: 'Over the network, effective permission is…', a: ['The share permission', 'The NTFS permission', 'The more restrictive of the two', 'The more generous of the two'], c: 2, why: 'Both gates must allow it.' },
    { q: 'What does DFS Namespaces give users?', a: ['Faster disks', 'One stable path that points to shares on any server', 'Encryption', 'Backups'], c: 1, why: 'Move data without changing paths.' },
    { q: 'gpresult shows a GPO under "filtered out: Denied (Security)". Meaning?', a: ['It is disabled', 'Security filtering excludes this user/computer', 'It is not linked', 'WMI filter'], c: 1, why: 'They lack Read + Apply group policy.' },
  ],
});
WIDGETS.effperm = (el) => {
  const R = ['None', 'Read', 'Change', 'Full']; const N = ['None', 'Read', 'Modify', 'Full']; const st = { s: 2, n: 2 };
  const draw = () => { const eff = Math.min(st.s, st.n); el.innerHTML = `<div class="wt">Effective access over the network</div><div class="grid2"><label class="f">Share permission<select id="eS">${R.map((x, i) => `<option value="${i}" ${i === st.s ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="f">NTFS permission<select id="eN">${N.map((x, i) => `<option value="${i}" ${i === st.n ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div><p style="font-size:18px">Effective: <b>${['No access', 'Read only', 'Read, write, delete (Modify)', 'Full control'][eff]}</b></p><p class="hint">Sitting at the server's own keyboard only NTFS applies.</p>`; $('#eS', el).onchange = (e) => { st.s = +e.target.value; draw(); }; $('#eN', el).onchange = (e) => { st.n = +e.target.value; draw(); }; };
  draw();
};
