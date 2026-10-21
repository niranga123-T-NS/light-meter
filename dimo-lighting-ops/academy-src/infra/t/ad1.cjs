const E = require('./load.cjs')(['net.js', 'forti.js', 'ios.js', 'ps.js', 'win.js', 'ad.js']);
const L = E(`labNew({ devs: [
  { id: 'DC1', kind: 'srv', hostname: 'DC1', nics: { Ethernet: { cidr: '10.10.10.10/24', gw: '10.10.10.1', dns: ['8.8.8.8'] } } },
  { id: 'FS1', kind: 'srv', hostname: 'FS1', nics: { Ethernet: { cidr: '10.10.10.20/24', gw: '10.10.10.1', dns: ['10.10.10.10'] } } },
  { id: 'PC1', kind: 'pc', hostname: 'PC1', nics: { Ethernet: { cidr: '10.10.10.51/24', gw: '10.10.10.1', dns: ['10.10.10.10'] } } },
  { id: 'SW1', kind: 'sw', n: 8 },
  { id: 'R1', kind: 'rt', ifs: { 'Gi0/0': { cidr: '10.10.10.1/24', nat: 'inside' }, 'Gi0/1': { cidr: '203.115.21.6/30', nat: 'outside' } }, routes: [{ net: '0.0.0.0', mask: '0.0.0.0', via: '203.115.21.5' }], acls: { 1: [{ std: true, act: 'permit', src: { net: '10.10.0.0', wild: '0.0.255.255' } }] }, nat: { rules: [{ acl: 1, ifn: 'Gi0/1' }], statics: [] } },
  { id: 'ISP', kind: 'isp', ifs: { a: { cidr: '203.115.21.5/30' } } },
], links: [['DC1:Ethernet','SW1:Gi1/0/1'],['FS1:Ethernet','SW1:Gi1/0/2'],['PC1:Ethernet','SW1:Gi1/0/3'],['R1:Gi0/0','SW1:Gi1/0/8'],['R1:Gi0/1','ISP:a']] })`);
E('settle')(L);
const dc = E('winShell')(L, L.devs.DC1, { ps: true });
const fs = E('winShell')(L, L.devs.FS1, { ps: true });
const run = (sh, c) => { const o = sh.run(c); process.stdout.write(sh.prompt() + c + '\n' + (typeof o === 'string' ? o : JSON.stringify(o)).replace(/\x1b\[\d+m/g, '')); };
[
 'Install-WindowsFeature AD-Domain-Services -IncludeManagementTools',
 "Install-ADDSForest -DomainName corp.dimo.lk -DomainNetbiosName DIMO -InstallDns -SafeModeAdministratorPassword (ConvertTo-SecureString 'Dsrm!2026x' -AsPlainText -Force) -Force",
 'Get-ADDomain | Select DNSRoot, NetBIOSName, PDCEmulator',
 "New-ADOrganizationalUnit -Name DIMO -Path 'DC=corp,DC=dimo,DC=lk'",
 "New-ADOrganizationalUnit -Name Finance -Path 'OU=DIMO,DC=corp,DC=dimo,DC=lk'",
 "New-ADGroup -Name 'GG_Finance' -GroupScope Global -Path 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk'",
 "New-ADUser -Name 'Nimal Perera' -SamAccountName nimal -Path 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk' -AccountPassword (ConvertTo-SecureString 'Welcome@123' -AsPlainText -Force) -Enabled $true",
 "Add-ADGroupMember GG_Finance -Members nimal",
 "Get-ADUser nimal -Properties MemberOf | Select Name, Enabled, MemberOf",
 "Get-ADUser -Filter * | Select SamAccountName, Enabled",
 "New-GPO -Name 'Finance Drives' | Out-Null; New-GPLink -Name 'Finance Drives' -Target 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk'",
 "Get-DnsServerZone",
 "Resolve-DnsName dc1.corp.dimo.lk",
 "Resolve-DnsName google.com",
].forEach((c) => run(dc, c));
[
 "Add-Computer -DomainName corp.dimo.lk -Credential (New-Object PSCredential('DIMO\\Administrator', (ConvertTo-SecureString 'Passw0rd!' -AsPlainText -Force))) -Restart",
 "New-Item -ItemType Directory D:\\Shares\\Finance | Out-Null",
 "New-SmbShare -Name Finance -Path D:\\Shares\\Finance -ChangeAccess 'DIMO\\GG_Finance'",
 "icacls D:\\Shares\\Finance /inheritance:r /grant 'DIMO\\GG_Finance:(OI)(CI)M' /grant 'Administrators:(OI)(CI)F'",
 "icacls D:\\Shares\\Finance",
].forEach((c) => run(fs, c));
console.log('FS1 domain:', L.devs.FS1.domain);
L.ad.gpos['Finance Drives'].user.drives = [{ letter: 'F', path: '\\\\FS1\\Finance' }];
console.log(JSON.stringify(E('adLogon')(L, L.devs.PC1, 'nimal', 'Welcome@123')));
E('adJoin')(L, L.devs.PC1, 'corp.dimo.lk', 'Administrator', 'Passw0rd!'); E('winReboot')(L, L.devs.PC1);
console.log(JSON.stringify(E('adLogon')(L, L.devs.PC1, 'nimal', 'Welcome@123')));
const pc = E('winShell')(L, L.devs.PC1, { user: 'nimal' });
['gpresult /r /scope user', 'net use', 'echo hi', 'powershell', "Set-Content F:\\budget.txt 'Q4 budget'", 'Get-ChildItem F:\\', 'whoami /groups'].forEach((c) => run(pc, c));
for (let i = 0; i < 5; i++) E('adLogon')(L, L.devs.PC1, 'nimal', 'bad');
console.log(JSON.stringify(E('adLogon')(L, L.devs.PC1, 'nimal', 'Welcome@123')));
run(dc, 'Search-ADAccount -LockedOut | Select Name, LockedOut');
run(dc, 'Unlock-ADAccount nimal');
console.log(JSON.stringify(E('adLogon')(L, L.devs.PC1, 'nimal', 'Welcome@123')));
L.devs.PC1.nics.Ethernet.dns = ['8.8.8.8'];
console.log(JSON.stringify(E('adLogon')(L, L.devs.PC1, 'nimal', 'Welcome@123')));
