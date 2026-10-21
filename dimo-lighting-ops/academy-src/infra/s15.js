// =================== Session 15 – PowerShell scripting: variables, loops, conditions, functions, pipeline; AD and file automation; scheduled tasks
const CSV15 = 'SamAccountName,GivenName,Surname,Department,Title\ntharindu,Tharindu,Jayasinghe,Finance,Accountant\nishara,Ishara,Perera,HR,HR Officer\nkasun,Kasun,Silva,Sales,Sales Engineer\ndilani,Dilani,Fernando,Finance,Finance Assistant\nruwan,Ruwan,Bandara,Sales,Area Manager\n';
const STARTERS15 = ['tharindu', 'ishara', 'kasun', 'dilani', 'ruwan'];
const DISK15 = `# Disk space report – emails IT every morning
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
$rows = foreach ($d in $disks) {
    [PSCustomObject]@{
        Drive  = $d.DeviceID
        SizeGB = [math]::Round($d.Size / 1GB, 1)
        FreeGB = [math]::Round($d.FreeSpace / 1GB, 1)
        FreePc = [math]::Round(100 * $d.FreeSpace / $d.Size)
    }
}
$body = $rows | Format-Table -AutoSize | Out-String
Send-MailMessage -To 'it@corp.dimo.lk' -From 'fs1@corp.dimo.lk' -Subject "Disk report $env:COMPUTERNAME" -Body $body -SmtpServer 'mail01.corp.dimo.lk'
`;
function psLab(o = {}) {
  const srv = (id, x, y, ip) => ({ id, kind: 'srv', x, y, hostname: id, os: 'win', server: true, ver: 'Microsoft Windows Server 2022 Standard', adminPass: 'Dimo@Lab2026', nics: { Ethernet: { cidr: `${ip}/24`, gw: '10.10.20.1', dns: ['10.10.20.10'] } } });
  const spec = {
    devs: [
      B.isp(330, 30, { a: { cidr: '203.115.21.5/30' } }),
      { id: 'FGT', kind: 'fw', x: 330, y: 100, hostname: 'FGT-HQ', ifs: { port1: { cidr: '203.115.21.6/30', access: 'ping', role: 'wan' }, port2: { cidr: '10.10.20.1/24', access: 'ping https ssh', role: 'lan' } }, cfg: { 'router static': { 1: { gateway: ['203.115.21.5'], device: ['port1'] } }, 'firewall policy': { 1: { name: ['LAN-Internet'], srcintf: ['port2'], dstintf: ['port1'], srcaddr: ['all'], dstaddr: ['all'], service: ['ALL'], action: ['accept'], schedule: ['always'], nat: ['enable'] } } } },
      B.sw('SW', 330, 180, 8, { hn: 'SW-HQ' }),
      srv('DC1', 180, 260, '10.10.20.10'), srv('FS1', 330, 280, '10.10.20.20'), B.lx('MAIL', 480, 260, '10.10.20.25/24', { gw: '10.10.20.1', dns: ['10.10.20.10'], hn: 'mail01' }),
    ],
    links: [['ISP:a', 'FGT:port1'], ['FGT:port2', 'SW:Gi1/0/8'], ['DC1:Ethernet', 'SW:Gi1/0/1'], ['FS1:Ethernet', 'SW:Gi1/0/2'], ['MAIL:ens18', 'SW:Gi1/0/3']],
    post: (L) => {
      ['DC1', 'FS1'].forEach((k) => { winInit(L, L.devs[k]); L.devs[k].localPass = { Administrator: 'Dimo@Lab2026' }; });
      const M = L.devs.MAIL; lxInit(L, M); M.units.postfix = { desc: 'Postfix Mail Transport Agent', exec: '/usr/sbin/postfix', tcp: [25], udp: [], enabled: true, active: 'active', since: 0 };
      adPair(L, 'DC1', null, { ous: ['Finance', 'HR', 'Sales', 'Servers'] });
      const dc = (c) => winPs(L, L.devs.DC1, c);
      ['Finance', 'HR', 'Sales'].forEach((x) => dc(`New-ADGroup -Name GG_${x} -GroupScope Global -Path 'OU=${x},OU=DIMO,DC=corp,DC=dimo,DC=lk'`));
      dc("Add-DnsServerResourceRecordA -ZoneName 'corp.dimo.lk' -Name mail01 -IPv4Address 10.10.20.25");
      winPs(L, L.devs.FS1, "Add-Computer -DomainName corp.dimo.lk -OUPath 'OU=Servers,OU=DIMO,DC=corp,DC=dimo,DC=lk' -Credential (New-Object System.Management.Automation.PSCredential('DIMO\\Administrator', (ConvertTo-SecureString 'Dimo@Lab2026' -AsPlainText -Force))) -Restart");
      const H = winHost(L, L.devs.DC1, { user: 'Administrator' }); psWriteFile(H, 'C:\\Scripts\\newstarters.csv', CSV15);
      const F = L.devs.FS1; F.disks.push({ num: 1, size: 500, model: 'Virtual Disk', parts: [{ letter: 'D', size: 499.9, used: 431.2, label: 'Data' }] });
      if (o.done) psDone(L); if (o.post) o.post(L); settle(L);
    },
  };
  return spec;
}
const NEWSTARTERS15 = `# New starters from HR's CSV: account in the department OU and group, must change password at first logon
$csv = Import-Csv C:\\Scripts\\newstarters.csv
$pw  = ConvertTo-SecureString 'Welcome@2026!' -AsPlainText -Force
foreach ($u in $csv) {
    if (Get-ADUser -Filter "SamAccountName -eq '$($u.SamAccountName)'") { Write-Host "$($u.SamAccountName) exists – skipped"; continue }
    New-ADUser -Name "$($u.GivenName) $($u.Surname)" -GivenName $u.GivenName -Surname $u.Surname -SamAccountName $u.SamAccountName -Title $u.Title -Department $u.Department -Path "OU=$($u.Department),OU=DIMO,DC=corp,DC=dimo,DC=lk" -AccountPassword $pw -Enabled $true -ChangePasswordAtLogon $true
    Add-ADGroupMember -Identity "GG_$($u.Department)" -Members $u.SamAccountName
    Write-Host "Created $($u.SamAccountName)"
}
`;
function psDone(L) {
  const H = winHost(L, L.devs.DC1, { user: 'Administrator' }); psWriteFile(H, 'C:\\Scripts\\New-Starters.ps1', NEWSTARTERS15); winPs(L, L.devs.DC1, '& C:\\Scripts\\New-Starters.ps1');
  const F = winHost(L, L.devs.FS1, { user: 'Administrator' }); psWriteFile(F, 'C:\\Scripts\\Disk-Report.ps1', DISK15);
  winPs(L, L.devs.FS1, "$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\\Scripts\\Disk-Report.ps1'; $t = New-ScheduledTaskTrigger -Daily -At 7am; Register-ScheduledTask -TaskName 'Disk Report' -Action $a -Trigger $t -User 'SYSTEM' -RunLevel Highest");
  winPs(L, L.devs.FS1, "Start-ScheduledTask -TaskName 'Disk Report'");
  settle(L, 'nodhcp');
}
const mailSince = (L, t0, re) => (L.mail || []).some((m) => m.t >= t0 && m.to.some((x) => /it@corp\.dimo\.lk/i.test(x)) && re.test(m.subject));
const fileOn = (L, dev, p) => psFileGet(winHost(L, L.devs[dev], { user: 'Administrator' }), p) || '';
SESSIONS.push({
  id: 's15', n: 15, mod: 2, title: 'PowerShell scripting', focus: 'Variables, loops, conditions, functions, pipeline; AD and file automation; scheduled tasks', milestone: 'Routine work scripted',
  concept: [
    { h: 'Objects in the pipeline', html: `<p>PowerShell passes <b>objects</b>, not text: <code>Get-Service | Where-Object Status -eq 'Stopped' | Select-Object Name, StartType</code>. <code>$_</code> (or <code>$PSItem</code>) is the current object. <code>Get-Member</code> shows what properties an object has.</p><p class="mono">$csv = Import-Csv C:\\Scripts\\newstarters.csv<br>foreach ($u in $csv) { "$($u.GivenName) → $($u.Department)" }<br>if ($free -lt 10) { Write-Warning "Low disk" } else { "OK" }<br>function Get-FreePc($d) { [math]::Round(100 * $d.FreeSpace / $d.Size) }</p><p>Inside double quotes, expand properties with <code>$($u.Name)</code> – <code>"$u.Name"</code> gives the whole object followed by ".Name".</p>`, check: [
      { q: 'What does $_ mean inside Where-Object { $_.Status -eq "Running" }?', a: ['The first object', 'The current object coming down the pipeline', 'The last error', 'An empty variable'], c: 1, why: 'Also $PSItem.' },
      { q: '"Hello $u.GivenName" prints the whole object. The fix?', a: ['Use single quotes', '"Hello $($u.GivenName)"', '"Hello" + u.GivenName', 'Write-Host -u'], c: 1, why: 'Subexpression $( ).' },
    ] },
    { h: 'Safe scripts', html: `<ul><li><b>Idempotent</b>: running twice must not break anything – check <code>if (Get-ADUser -Filter …)</code> before creating.</li><li>Test with <code>-WhatIf</code> first on anything that deletes or disables.</li><li><code>try { … } catch { Write-Warning $_ }</code> and <code>-ErrorAction Stop</code> to catch failures.</li><li>Keep scripts in <b>C:\\Scripts</b> (and in Git – next session); comment what and why.</li><li><b>Scheduled tasks</b>: action <code>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\Scripts\\x.ps1</code>, run as SYSTEM or a service account. "Last Run Result" 0x0 = success; 0x80070002 = file not found.</li></ul>` },
    { h: 'Debugging', html: `<p>Read the <b>first</b> red error – the line and the parameter it names. Common bugs: a typo in a property name (it silently becomes <code>$null</code>), single vs double quotes, a path that only exists on your PC, a filter that matches more than you think (<code>AddDays(90)</code> vs <code>AddDays(-90)</code>). Run the script line by line, print variables (<code>$users.Count</code>, <code>$users | Select -First 3</code>).</p>`, check: [
      { q: 'A script runs without errors but does nothing; the foreach loops over $projets. Likely bug?', a: ['PowerShell is broken', 'A typo – $projets is not the variable you filled ($projects), so it is empty', 'Missing module', 'Execution policy'], c: 1, why: 'Set-StrictMode -Version Latest would catch it.' },
    ] },
  ],
  lab: {
    title: 'Lab: bulk-create users from CSV, and a daily disk report by email',
    intro: `<p>HR dropped <b>C:\\Scripts\\newstarters.csv</b> on DC1 (5 new staff). OUs DIMO › Finance, HR, Sales and groups GG_Finance, GG_HR, GG_Sales exist. The mail relay is <b>mail01.corp.dimo.lk</b> (port 25, no authentication from the LAN). FS1 has a data disk D:. Use <code>notepad C:\\Scripts\\name.ps1</code> to write scripts, then run them with <code>& C:\\Scripts\\name.ps1</code>.</p>`,
    build: () => psLab(), open: ['DC1'],
    tasks: [
      { id: 'csv', t: 'All five new starters exist in their department OU, enabled, with first/last name and title, in GG_&lt;Department&gt;, and must change their password at first logon (initial password <code>Welcome@2026!</code>).', check: (L) => { const A = L.ad; const rows = CSV15.trim().split('\n').slice(1).map((l) => l.split(',')); return !!A && rows.every(([sam, g, s, dep, title]) => { const u = A.users[sam]; return u && u.ou === `DIMO/${dep}` && u.enabled !== false && u.given === g && u.sn === s && u.title === title && u.mustChange && A.groups[`GG_${dep}`]?.members.includes(sam); }); } },
      { id: 'script', t: 'Done by a script <b>C:\\Scripts\\New-Starters.ps1</b> on DC1 that uses Import-Csv and is safe to run twice (it checks whether the user exists first).', check: (L) => { const c = fileOn(L, 'DC1', 'C:\\Scripts\\New-Starters.ps1'); return /Import-Csv/i.test(c) && /New-ADUser/i.test(c) && /(Get-ADUser|try\s*\{)/i.test(c); }, hint: 'Pattern: $csv = Import-Csv …; foreach ($u in $csv) { if (Get-ADUser -Filter "SamAccountName -eq \'$($u.SamAccountName)\'") { continue }; New-ADUser … ; Add-ADGroupMember … }' },
      { id: 'mail', t: '<b>C:\\Scripts\\Disk-Report.ps1</b> on FS1 emails a table of drives with size and free space to it@corp.dimo.lk with a subject starting "Disk report".', check: (L) => /Send-MailMessage/i.test(fileOn(L, 'FS1', 'C:\\Scripts\\Disk-Report.ps1')) && (L.mail || []).some((m) => m.via === 'FS1' && /^disk report/i.test(m.subject) && /D:/.test(m.body)), hint: 'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3", a [PSCustomObject] per disk, Format-Table | Out-String for the body, Send-MailMessage -SmtpServer mail01.corp.dimo.lk.' },
      { id: 'task', t: 'Scheduled task <b>Disk Report</b> on FS1: daily at 07:00 as SYSTEM, runs the script; a manual run (<code>Start-ScheduledTask</code>) succeeds (last result 0).', check: (L) => { const t = L.devs.FS1.tasks?.['Disk Report']; return !!t && /Disk-Report\.ps1/i.test(psStr(t.action?.Arguments ?? '')) && !!t.trigger && t.result === 0 && /system/i.test(t.user || t.principal?.UserId || ''); } },
      { id: 'q', t: 'Which cmdlet turns a CSV file into objects you can loop over?', ans: () => ['Import-Csv'] },
    ],
  },
  tickets: [
    { id: 't1', no: 5501, title: 'New-starter script "ran fine" but created nobody', who: 'HR', text: '<p>"We put Anjali and Chamara into <b>C:\\Scripts\\newstarters2.csv</b> and ran <b>C:\\Scripts\\New-Starters2.ps1</b> on DC1. It printed red text and nobody can log in." Fix the script (don\'t just create them by hand) and run it.</p>', build: () => psLab({ done: true, post: (L) => { const H = winHost(L, L.devs.DC1, { user: 'Administrator' }); psWriteFile(H, 'C:\\Scripts\\newstarters2.csv', 'SamAccountName,GivenName,Surname,Department,Title\nanjali,Anjali,Wickrama,HR,Payroll Officer\nchamara,Chamara,Dissanayake,Sales,Sales Engineer\n'); psWriteFile(H, 'C:\\Scripts\\New-Starters2.ps1', NEWSTARTERS15.replace('newstarters.csv', 'newstarters2.csv').replace('-SamAccountName $u.SamAccountName -Title', '-SamAccountName $u.SamAcountName -Title')); winPs(L, L.devs.DC1, '& C:\\Scripts\\New-Starters2.ps1'); } }), open: ['DC1'], hint: 'Read the first red error. Which parameter is empty? Compare the property name with the CSV header.', checks: [{ t: 'anjali and chamara exist in the right OUs and groups', f: (L) => [['anjali', 'HR'], ['chamara', 'Sales']].every(([s, dep]) => L.ad.users[s]?.ou === `DIMO/${dep}` && L.ad.groups[`GG_${dep}`].members.includes(s)) }, { t: 'The script is fixed', f: (L) => { const c = fileOn(L, 'DC1', 'C:\\Scripts\\New-Starters2.ps1'); return /\$u\.SamAccountName/.test(c) && !/SamAcountName/.test(c); } }] },
    { id: 't2', no: 5507, title: 'No disk report this week', who: 'IT manager', text: '<p>"The 7 am disk report stopped arriving on Monday. Task Scheduler on FS1 shows Last Run Result <b>0x80070002</b>." (On Friday someone tidied up C:\\Scripts.)</p>', build: () => psLab({ done: true }), open: ['FS1'], fault: (L) => { const F = winHost(L, L.devs.FS1, { user: 'Administrator' }); const c = psFileGet(F, 'C:\\Scripts\\Disk-Report.ps1'); psWriteFile(F, 'C:\\Scripts\\Reports\\Disk-Report.ps1', c); delete L.devs.FS1.fs[Object.keys(L.devs.FS1.fs).find((k) => /^c:\\scripts\\disk-report\.ps1$/i.test(k))]; winTaskRun(L, L.devs.FS1, 'Disk Report'); L.t15 = L.clock; }, hint: '<code>Get-ScheduledTaskInfo "Disk Report"</code>, <code>(Get-ScheduledTask "Disk Report").Actions</code>. 0x80070002 = "file not found". Where is the script now?', checks: [{ t: 'A manual run of the task succeeds', f: (L) => L.devs.FS1.tasks['Disk Report'].result === 0 }, { t: 'A new disk report reached it@corp.dimo.lk', f: (L) => mailSince(L, L.t15 ?? 0, /^disk report/i) }] },
    { id: 't3', no: 5512, title: 'Disk report fails: "remote name could not be resolved"', who: 'IT manager', text: '<p>"After the mail server migration the disk report task fails. The script uses the old relay name." The new relay is <b>mail01.corp.dimo.lk</b>.</p>', build: () => psLab({ done: true }), open: ['FS1'], fault: (L) => { const F = winHost(L, L.devs.FS1, { user: 'Administrator' }); psWriteFile(F, 'C:\\Scripts\\Disk-Report.ps1', DISK15.replace("mail01.corp.dimo.lk", 'smtp.dimo.lk')); winTaskRun(L, L.devs.FS1, 'Disk Report'); L.t15 = L.clock; }, hint: 'Run the script by hand to see the error. Fix the -SmtpServer, then Start-ScheduledTask.', checks: [{ t: 'A manual run of the task succeeds', f: (L) => L.devs.FS1.tasks['Disk Report'].result === 0 }, { t: 'A new disk report reached it@corp.dimo.lk', f: (L) => mailSince(L, L.t15 ?? 0, /^disk report/i) }] },
  ],
  quiz: [
    { q: 'Which cmdlet shows the properties and methods of an object?', a: ['Get-Help', 'Get-Member', 'Get-Command', 'Select-Object'], c: 1, why: 'e.g. Get-ADUser nimal | Get-Member.' },
    { q: 'How do you test a destructive command without running it?', a: ['-Force', '-WhatIf', '-Verbose', '-Confirm:$false'], c: 1, why: 'Shows what would happen.' },
    { q: 'Task "Last Run Result" 0x0 means…', a: ['Failed', 'Success', 'File not found', 'Access denied'], c: 1, why: '0x80070002 = file not found, 0x1 = script error.' },
    { q: 'Why check Get-ADUser before New-ADUser in a bulk script?', a: ['Speed', 'So running it twice does not fail or create duplicates', 'Licensing', 'It is required'], c: 1, why: 'Idempotent scripts.' },
    { q: 'Inside a script, try { } catch { } catches non-terminating errors only if…', a: ['Always', 'You add -ErrorAction Stop to the command', 'You use Write-Host', 'Never'], c: 1, why: 'Many cmdlet errors are non-terminating.' },
    { q: 'Which loop runs once per object in a collection?', a: ['while ($true)', 'foreach ($x in $list)', 'do { } until', 'if'], c: 1, why: 'Or ForEach-Object in a pipeline.' },
  ],
});
