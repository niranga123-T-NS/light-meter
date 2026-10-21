// every cmdlet the Windows consoles emit, on a real domain lab
const fs = require('fs'), vm = require('vm'), path = require('path'); const dir = path.join(__dirname, '..');
const E = require('./probe.cjs');
const L = E(`(() => { const L = labNew({ devs: [B.win('DC1', 0, 0, '10.10.10.10/24', { gw: '10.10.10.1', dns: ['127.0.0.1'] }), B.win('SRV2', 0, 0, '10.10.10.11/24', { gw: '10.10.10.1', dns: ['10.10.10.10'] }), B.pc('PC1', 0, 0, '10.10.10.21/24', { gw: '10.10.10.1', dns: ['10.10.10.10'] }), B.sw('SW', 0, 0, 8)], links: [['DC1:Ethernet', 'SW:Gi1/0/1'], ['SRV2:Ethernet', 'SW:Gi1/0/2'], ['PC1:Ethernet', 'SW:Gi1/0/3']] }); settle(L); adQuick(L, 'DC1', { users: [['nimal', 'Nimal Perera', 'Welcome@123']], join: ['PC1'] }); globalThis.LL = L; return L; })()`);
const run = (dev, c) => { const r = E(`winPs(LL, LL.devs['${dev}'], ${JSON.stringify(c)})`); console.log((r.err ? 'ERR ' : 'ok  ') + c.slice(0, 110) + (r.err ? '\n     ' + r.text.slice(0, 300).replace(/\n/g, '\n     ') : '')); };
const dc = (c) => run('DC1', c);
[
 "New-ADOrganizationalUnit -Name 'Finance' -Path 'OU=DIMO,DC=corp,DC=dimo,DC=lk'",
 "New-ADUser -Name 'Kamal Silva' -GivenName 'Kamal' -Surname 'Silva' -SamAccountName 'kamal' -UserPrincipalName 'kamal@corp.dimo.lk' -Path 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk' -AccountPassword (ConvertTo-SecureString 'Welcome@123' -AsPlainText -Force) -Enabled $true -ChangePasswordAtLogon $true",
 "New-ADGroup -Name 'GG_Finance' -GroupScope Global -Path 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk'",
 "Add-ADGroupMember -Identity 'GG_Finance' -Members 'kamal'",
 "Set-ADAccountPassword -Identity 'kamal' -Reset -NewPassword (ConvertTo-SecureString 'N3w@Pass12' -AsPlainText -Force)",
 "Unlock-ADAccount -Identity 'kamal'", "Set-ADUser -Identity 'kamal' -ChangePasswordAtLogon $false", "Set-ADUser -Identity 'kamal' -Enabled $false", "Set-ADUser -Identity 'kamal' -Enabled $true",
 "Move-ADObject -Identity 'CN=Kamal Silva,OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk' -TargetPath 'OU=DIMO,DC=corp,DC=dimo,DC=lk'",
 "Move-ADObject -Identity 'CN=PC1,CN=Computers,DC=corp,DC=dimo,DC=lk' -TargetPath 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk'",
 "Add-DnsServerResourceRecordA -ZoneName 'corp.dimo.lk' -Name 'intranet' -IPv4Address '10.10.10.80' -CreatePtr",
 "Add-DnsServerResourceRecordCName -ZoneName 'corp.dimo.lk' -Name 'www' -HostNameAlias 'intranet.corp.dimo.lk'",
 "Remove-DnsServerResourceRecord -ZoneName 'corp.dimo.lk' -Name 'www' -RRType CNAME -Force",
 "Set-DnsServerForwarder -IPAddress '8.8.8.8','1.1.1.1'", "Add-DnsServerPrimaryZone -Name 'lab.local' -ZoneFile 'lab.local.dns'", "Add-DnsServerConditionalForwarderZone -Name 'kandy.local' -MasterServers '10.20.10.10'",
 "Clear-DnsServerCache -Force", "Set-DnsServerScavenging -ScavengingState $true -ScavengingInterval 7.00:00:00",
 "Install-WindowsFeature -Name DHCP -IncludeManagementTools", "Add-DhcpServerInDC -DnsName 'DC1.corp.dimo.lk'",
 "Add-DhcpServerv4Scope -Name 'Staff' -StartRange 10.10.10.100 -EndRange 10.10.10.199 -SubnetMask 255.255.255.0 -State Active -LeaseDuration 8.00:00:00",
 "Set-DhcpServerv4OptionValue -ScopeId 10.10.10.0 -Router 10.10.10.1 -DnsServer 10.10.10.10 -DnsDomain 'corp.dimo.lk'",
 "Add-DhcpServerv4ExclusionRange -ScopeId 10.10.10.0 -StartRange 10.10.10.100 -EndRange 10.10.10.110",
 "Set-DhcpServerv4Scope -ScopeId 10.10.10.0 -StartRange 10.10.10.100 -EndRange 10.10.10.220",
 "Add-DhcpServerv4Reservation -ScopeId 10.10.10.0 -IPAddress 10.10.10.150 -ClientId '00-15-5d-01-02-03' -Name 'Printer'",
 "Set-DhcpServerv4Scope -ScopeId 10.10.10.0 -State InActive", "Set-DhcpServerv4Scope -ScopeId 10.10.10.0 -State Active",
 "New-GPO -Name 'Finance Drives' | New-GPLink -Target 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk'",
 "Set-GPLink -Name 'Finance Drives' -Target 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk' -Enforced Yes",
 "Set-GPLink -Name 'Finance Drives' -Target 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk' -LinkEnabled No",
 "Set-GPInheritance -Target 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk' -IsBlocked Yes",
 "Set-GPPermission -Name 'Finance Drives' -TargetName 'GG_Finance' -TargetType Group -PermissionLevel GpoApply",
 "Set-GPPermission -Name 'Finance Drives' -TargetName 'Authenticated Users' -TargetType Group -PermissionLevel None -Replace",
 "Set-GPRegistryValue -Name 'Finance Drives' -Key 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer' -ValueName NoControlPanel -Type DWord -Value 1",
 "Set-ADDefaultDomainPasswordPolicy -Identity 'corp.dimo.lk' -MinPasswordLength 12",
 "Remove-GPLink -Name 'Finance Drives' -Target 'OU=Finance,OU=DIMO,DC=corp,DC=dimo,DC=lk'", "Remove-GPO -Name 'Finance Drives'",
 "Set-Service -Name 'Spooler' -StartupType Disabled", "Start-Service -Name 'Spooler'", "Set-Service -Name 'Spooler' -StartupType Automatic", "Restart-Service -Name 'Spooler'", "Stop-Service -Name 'Spooler' -Force",
 "Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True", "Enable-PSRemoting -Force", "Set-TimeZone -Id 'Sri Lanka Standard Time'",
 "Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force",
 "New-NetFirewallRule -DisplayName 'Remote Desktop - User Mode (TCP-In)' -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow",
 "Remove-ADUser -Identity 'kamal' -Confirm:$false",
].forEach(dc);
run('SRV2', "Rename-Computer -NewName 'APP01'");
run('SRV2', "Add-Computer -DomainName 'corp.dimo.lk' -Credential (New-Object System.Management.Automation.PSCredential('DIMO\\Administrator', (ConvertTo-SecureString 'Passw0rd!' -AsPlainText -Force)))");
run('SRV2', 'Restart-Computer -Force');
console.log(E("JSON.stringify([LL.devs.SRV2.hostname, LL.devs.SRV2.domain, LL.devs.DC1.dhcpd.scopes[0], LL.ad.users.Administrator && Object.keys(LL.ad.gpos)])"));
