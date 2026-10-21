// =================== Linux servers (Ubuntu / Rocky): files and permissions, users, packages, systemd, journal, SSH, web server and TLS, firewall, disks / LVM, cron
const LX_PKG = { ubuntu: { nginx: ['nginx'], 'apache2': ['apache2'], 'openssh-server': ['ssh'], ufw: ['ufw'], cron: ['cron'], 'docker.io': ['docker'], chrony: ['chrony'], rsyslog: ['rsyslog'], 'qemu-guest-agent': ['qemu-guest-agent'], 'nfs-kernel-server': ['nfs-server'], 'zabbix-agent': ['zabbix-agent'], 'mariadb-server': ['mariadb'], ansible: [], git: [], curl: [], 'net-tools': [], 'dnsutils': [], htop: [], tree: [], 'snmpd': ['snmpd'], 'samba': ['smbd'], 'bind9': ['named'], 'lvm2': [], 'cloud-guest-utils': [], 'certbot': [], 'logrotate': [], 'unattended-upgrades': ['unattended-upgrades'], 'targetcli-fb': ['target'], 'proxmox-backup-client': [] }, rocky: { nginx: ['nginx'], httpd: ['httpd'], 'mariadb-server': ['mariadb'], 'openssh-server': ['sshd'], firewalld: ['firewalld'], cronie: ['crond'], chrony: ['chronyd'], rsyslog: ['rsyslog'], 'qemu-guest-agent': ['qemu-guest-agent'], 'nfs-utils': ['nfs-server'], 'zabbix-agent': ['zabbix-agent'], ansible: [], 'ansible-core': [], git: [], curl: [], 'bind-utils': [], 'policycoreutils-python-utils': [], 'mod_ssl': [], podman: ['podman'], 'lvm2': [], 'cloud-utils-growpart': [] } };
const LX_UNIT = { nginx: { d: 'A high performance web server and a reverse proxy server', exec: '/usr/sbin/nginx', tcp: [80] }, apache2: { d: 'The Apache HTTP Server', exec: '/usr/sbin/apachectl start', tcp: [80] }, httpd: { d: 'The Apache HTTP Server', exec: '/usr/sbin/httpd -DFOREGROUND', tcp: [80] }, ssh: { d: 'OpenBSD Secure Shell server', exec: '/usr/sbin/sshd -D', tcp: [22] }, sshd: { d: 'OpenSSH server daemon', exec: '/usr/sbin/sshd -D', tcp: [22] }, ufw: { d: 'Uncomplicated firewall', exec: '/lib/ufw/ufw-init start' }, firewalld: { d: 'firewalld - dynamic firewall daemon', exec: '/usr/sbin/firewalld --nofork --nopid' }, cron: { d: 'Regular background program processing daemon', exec: '/usr/sbin/cron -f' }, crond: { d: 'Command Scheduler', exec: '/usr/sbin/crond -n' }, docker: { d: 'Docker Application Container Engine', exec: '/usr/bin/dockerd -H fd://' }, chrony: { d: 'chrony, an NTP client/server', exec: '/usr/sbin/chronyd -F 1', udp: [123] }, chronyd: { d: 'NTP client/server', exec: '/usr/sbin/chronyd', udp: [123] }, rsyslog: { d: 'System Logging Service', exec: '/usr/sbin/rsyslogd -n -iNONE', udp: [514] }, 'qemu-guest-agent': { d: 'QEMU Guest Agent', exec: '/usr/sbin/qemu-ga' }, 'nfs-server': { d: 'NFS server and services', exec: '/usr/sbin/exportfs -r', tcp: [2049, 111] }, 'zabbix-agent': { d: 'Zabbix Agent', exec: '/usr/sbin/zabbix_agentd -c /etc/zabbix/zabbix_agentd.conf', tcp: [10050] }, mariadb: { d: 'MariaDB 10.6 database server', exec: '/usr/sbin/mariadbd', tcp: [3306] }, snmpd: { d: 'Simple Network Management Protocol (SNMP) Daemon.', exec: '/usr/sbin/snmpd -LOw -u Debian-snmp -g Debian-snmp -I -smux,mteTrigger,mteTriggerConf -f -p /run/snmpd.pid', udp: [161] }, smbd: { d: 'Samba SMB Daemon', exec: '/usr/sbin/smbd --foreground --no-process-group', tcp: [445] }, named: { d: 'BIND Domain Name Server', exec: '/usr/sbin/named -f -u bind', tcp: [53], udp: [53] }, 'unattended-upgrades': { d: 'Unattended Upgrades Shutdown', exec: '/usr/share/unattended-upgrades/unattended-upgrade-shutdown --wait-for-signal' }, target: { d: 'Restore LIO kernel target configuration', exec: '/usr/bin/targetctl restore', tcp: [3260] }, podman: { d: 'Podman API Service', exec: '/usr/bin/podman system service' }, 'systemd-journald': { d: 'Journal Service', exec: '/lib/systemd/systemd-journald' }, 'systemd-resolved': { d: 'Network Name Resolution', exec: '/lib/systemd/systemd-resolved', udp: [53] } };
/** A Linux machine's initial state, filled the first time it is opened */
function lxInit(L, d) {
  if (d._lx) return d; d._lx = true;
  d.distro ??= 'ubuntu'; const ub = d.distro === 'ubuntu';
  d.lfs ??= {}; const F = d.lfs;
  const dir = (p, u = 'root', m = 0o755) => (F[p] ??= { t: 'd', m, u, g: u === 'root' ? 'root' : u });
  const file = (p, c, u = 'root', m = 0o644) => (F[p] ??= { t: 'f', c, m, u, g: u === 'root' ? 'root' : u, mt: 0 });
  ['/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/media', '/mnt', '/opt', '/proc', '/run', '/sbin', '/srv', '/sys', '/usr', '/usr/bin', '/usr/sbin', '/usr/local', '/usr/local/bin', '/usr/share', '/var', '/var/log', '/var/lib', '/var/www', '/var/www/html', '/var/backups', '/var/tmp', '/etc/ssh', '/etc/ssl', '/etc/ssl/certs', '/etc/ssl/private', '/etc/cron.d', '/etc/cron.daily', '/etc/systemd', '/etc/systemd/system', '/etc/logrotate.d', '/backup'].forEach((p) => dir(p));
  dir('/tmp', 'root', 0o1777); dir('/root', 'root', 0o700); F['/etc/ssl/private'].m = 0o710;
  const nic = Object.keys(d.nics)[0], c = d.nics[nic];
  file('/etc/os-release', ub ? 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nID=ubuntu\nID_LIKE=debian\n' : 'NAME="Rocky Linux"\nVERSION="9.4 (Blue Onyx)"\nID="rocky"\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.4"\nPRETTY_NAME="Rocky Linux 9.4 (Blue Onyx)"\n');
  file('/etc/hostname', d.hostname + '\n');
  file('/etc/hosts', `127.0.0.1 localhost\n127.0.1.1 ${d.hostname}\n\n# The following lines are desirable for IPv6 capable hosts\n::1     ip6-localhost ip6-loopback\n`);
  if (ub) file('/etc/netplan/50-cloud-init.yaml', lxNetplanText(nic, c), 'root', 0o600);
  else file(`/etc/NetworkManager/system-connections/${nic}.nmconnection`, `[connection]\nid=${nic}\ntype=ethernet\ninterface-name=${nic}\n\n[ipv4]\n${c.dhcp ? 'method=auto' : `method=manual\naddress1=${c.ip}/${mask2len(c.mask || '255.255.255.0')},${c.gw || ''}\ndns=${(c.dns || []).join(';')};`}\n`, 'root', 0o600);
  file('/etc/ssh/sshd_config', `# This is the sshd server system-wide configuration file.\n\nInclude /etc/ssh/sshd_config.d/*.conf\n\n#Port 22\n#ListenAddress 0.0.0.0\n\n#PermitRootLogin prohibit-password\n#PubkeyAuthentication yes\n\n# To disable tunneled clear text passwords, change to no here!\nPasswordAuthentication yes\n#PermitEmptyPasswords no\n\nKbdInteractiveAuthentication no\nUsePAM yes\nX11Forwarding yes\nPrintMotd no\nAcceptEnv LANG LC_*\nSubsystem\tsftp\t/usr/lib/openssh/sftp-server\n`);
  file('/etc/fstab', `# <file system> <mount point>   <type>  <options>       <dump>  <pass>\n/dev/disk/by-id/dm-uuid-LVM-ubuntu--vg-ubuntu--lv / ext4 defaults 0 1\n/dev/disk/by-uuid/7c1d-4a2e /boot ext4 defaults 0 1\n`);
  file('/etc/sudoers', `Defaults\tenv_reset\nDefaults\tsecure_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\n\nroot\tALL=(ALL:ALL) ALL\n%${ub ? 'sudo' : 'wheel'}\tALL=(ALL:ALL) ALL\n`, 'root', 0o440);
  file('/etc/crontab', 'SHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n\n17 *\t* * *\troot\tcd / && run-parts --report /etc/cron.hourly\n25 6\t* * *\troot\ttest -x /usr/sbin/anacron || run-parts --report /etc/cron.daily\n');
  file('/etc/timezone', 'Asia/Colombo\n');
  file('/var/log/syslog', ''); file('/var/log/auth.log', '', 'root', 0o640);
  d.users ??= { root: { uid: 0, home: '/root', shell: '/bin/bash', pwd: d.rootPass || 'Passw0rd!', groups: ['root'] } };
  d.groups ??= { root: { gid: 0 }, sudo: { gid: 27 }, wheel: { gid: 10 }, adm: { gid: 4 }, 'www-data': { gid: 33 }, docker: { gid: 998 }, users: { gid: 100 } };
  if (!d.users['www-data']) d.users['www-data'] = { uid: 33, home: '/var/www', shell: '/usr/sbin/nologin', groups: ['www-data'], sys: true };
  (d.admins || [ub ? 'admin' : 'rocky']).forEach((u, i) => { if (!d.users[u]) { d.users[u] = { uid: 1000 + i, home: `/home/${u}`, shell: '/bin/bash', pwd: d.userPass || 'Passw0rd!', groups: [u, ub ? 'sudo' : 'wheel', 'adm'] }; d.groups[u] ??= { gid: 1000 + i }; } dir(`/home/${u}`, u, 0o750); file(`/home/${u}/.bashrc`, '# ~/.bashrc: executed by bash(1) for non-login shells.\nexport PS1\nalias ll=\'ls -alF\'\n', u); });
  d.pkgs ??= ub ? ['openssh-server', 'cron', 'rsyslog', 'curl', 'ufw', 'chrony', 'lvm2', 'cloud-guest-utils', 'logrotate', 'qemu-guest-agent', 'unattended-upgrades', 'git'] : ['openssh-server', 'cronie', 'rsyslog', 'curl', 'firewalld', 'chrony', 'lvm2', 'qemu-guest-agent', 'cloud-utils-growpart'];
  d.units ??= {}; d.pkgs.forEach((p) => (LX_PKG[d.distro][p] || []).forEach((u) => lxUnitAdd(d, u)));
  ['systemd-journald', 'systemd-resolved'].forEach((u) => lxUnitAdd(d, u));
  if (!ub) delete d.units['systemd-resolved'];
  d.ufw ??= { on: false, inDefault: 'deny', rules: [] }; if (!ub) { d.firewalld ??= { on: true, svcs: ['ssh', 'dhcpv6-client', 'cockpit'], ports: [] }; d.units.firewalld && (d.units.firewalld.active = 'active'); }
  d.lvm ??= { pvs: { '/dev/sda3': { vg: ub ? 'ubuntu-vg' : 'rl', size: 30 } }, vgs: { [ub ? 'ubuntu-vg' : 'rl']: { size: 30 } }, lvs: { [ub ? 'ubuntu-lv' : 'root']: { vg: ub ? 'ubuntu-vg' : 'rl', size: 15, fs: ub ? 'ext4' : 'xfs', mount: '/', used: 6.4, fsSize: 15 } } };
  d.disks ??= [{ name: 'sda', size: 32, parts: [{ name: 'sda1', size: 1, mount: '/boot/efi', fs: 'vfat' }, { name: 'sda2', size: 1, mount: '/boot', fs: 'ext4' }, { name: 'sda3', size: 30, pv: true }] }];
  d.jrnl ??= []; d.cron ??= {}; d.certs ??= {}; d.dock ??= { images: [], ctrs: {} };
  d.svc = d.svc || {};
  Object.values(d.units).forEach((u) => { if (u.enabled && u.active !== 'failed') u.active = 'active'; });
  return d;
}
function lxUnitAdd(d, u) { if (d.units[u]) return; const m = LX_UNIT[u] || { d: u, exec: `/usr/sbin/${u}` }; d.units[u] = { desc: m.d, exec: m.exec, tcp: m.tcp || [], udp: m.udp || [], enabled: true, active: 'active', since: 0 }; }
const lxNetplanText = (nic, c) => `network:\n  version: 2\n  ethernets:\n    ${nic}:\n${c.dhcp ? '      dhcp4: true\n' : `      dhcp4: false\n      addresses:\n        - ${c.ip}/${mask2len(c.mask || '255.255.255.0')}\n${c.gw ? `      routes:\n        - to: default\n          via: ${c.gw}\n` : ''}      nameservers:\n        addresses: [${(c.dns || []).join(', ')}]\n${c.dom ? `        search: [${c.dom}]\n` : ''}`}`;
function lxLog(L, d, unit, msg, prio = 6) { (d.jrnl ??= []).push({ t: L.clock, unit, msg, prio }); if (d.jrnl.length > 400) d.jrnl.shift(); const f = d.lfs?.[unit === 'sshd' || unit === 'ssh' || unit === 'sudo' ? '/var/log/auth.log' : '/var/log/syslog']; if (f) f.c += `${lxDate(L, d, 'syslog')} ${d.hostname} ${unit}[${1000 + (L.clock % 3000)}]: ${msg}\n`; }
const lxNow = (L, d) => new Date(Date.UTC(2026, 9, 21, 3, 30, 0) + L.clock + (d.clockSkew || 0) * 60000);
function lxDate(L, d, f, t) { const x = t ? new Date(t) : lxNow(L, d); const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; const p = (n) => String(n).padStart(2, '0'); const H = x.getUTCHours() + 5, mi = x.getUTCMinutes() + 30; const hh = (H + Math.floor(mi / 60)) % 24, mm = mi % 60; if (f === 'syslog') return `${M[x.getUTCMonth()]} ${String(x.getUTCDate()).padStart(2)} ${p(hh)}:${p(mm)}:${p(x.getUTCSeconds())}`; if (f === 'date') return `${D[x.getUTCDay()]} ${M[x.getUTCMonth()]} ${String(x.getUTCDate()).padStart(2)} ${p(hh)}:${p(mm)}:${p(x.getUTCSeconds())} AM +0530 ${x.getUTCFullYear()}`.replace('AM ', ''); if (f && f.startsWith('+')) return f.slice(1).replace(/%([YmdHMSFTsbaAjeDz%])/g, (m, k) => ({ Y: x.getUTCFullYear(), m: p(x.getUTCMonth() + 1), d: p(x.getUTCDate()), H: p(hh), M: p(mm), S: p(x.getUTCSeconds()), F: `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`, T: `${p(hh)}:${p(mm)}:${p(x.getUTCSeconds())}`, s: Math.floor(x.getTime() / 1000), b: M[x.getUTCMonth()], a: D[x.getUTCDay()], A: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][x.getUTCDay()], j: '294', e: String(x.getUTCDate()).padStart(2), D: `${p(x.getUTCMonth() + 1)}/${p(x.getUTCDate())}/${String(x.getUTCFullYear()).slice(2)}`, z: '+0530', '%': '%' }[k])); return x.toISOString(); }

// ---------------------------------------------------------------- files and permissions
const lxNorm = (cwd, p, home) => { p = String(p || '.'); if (p === '~' || p.startsWith('~/')) p = home + p.slice(1); if (!p.startsWith('/')) p = (cwd === '/' ? '' : cwd) + '/' + p; const out = []; p.split('/').forEach((x) => { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); }); return '/' + out.join('/'); };
const lxParent = (p) => (p === '/' ? '/' : p.slice(0, p.lastIndexOf('/')) || '/');
function lxVirt(L, d, p) {
  if (p === '/etc/passwd') return Object.entries(d.users).map(([n, u]) => `${n}:x:${u.uid}:${d.groups[u.groups?.[0]]?.gid ?? u.uid}:${u.gecos || ''}:${u.home}:${u.shell}`).join('\n') + '\n';
  if (p === '/etc/group') return Object.entries(d.groups).map(([n, g]) => `${n}:x:${g.gid}:${Object.entries(d.users).filter(([un, u]) => (u.groups || []).slice(1).includes(n) || (u.groups || []).includes(n) && un !== n).map(([un]) => un).join(',')}`).join('\n') + '\n';
  if (p === '/etc/shadow') return Object.entries(d.users).map(([n, u]) => `${n}:${u.locked ? '!' : ''}${u.pwd ? '$y$j9T$' + btoaSafe(u.pwd).slice(0, 22) : '*'}:20380:0:${u.maxDays ?? 99999}:7:::`).join('\n') + '\n';
  if (p === '/etc/resolv.conf') { const c = Object.values(d.nics)[0]; return d.distro === 'ubuntu' ? `# This is /run/systemd/resolve/stub-resolv.conf managed by man:systemd-resolved(8).\nnameserver 127.0.0.53\noptions edns0 trust-ad\nsearch ${c.dom || d.domain || '.'}\n` : `# Generated by NetworkManager\nsearch ${c.dom || d.domain || ''}\n${(c.dns || []).map((x) => `nameserver ${x}`).join('\n')}\n`; }
  if (p === '/proc/meminfo') return `MemTotal:        ${(d.ram ?? 4) * 1024 * 1024} kB\nMemFree:         ${(d.ram ?? 4) * 1024 * 512} kB\nMemAvailable:    ${(d.ram ?? 4) * 1024 * 700} kB\n`;
  if (p === '/proc/cpuinfo') return Array.from({ length: d.cpus ?? 2 }, (_, i) => `processor\t: ${i}\nmodel name\t: QEMU Virtual CPU version 2.5+\n`).join('\n');
  if (p === '/proc/loadavg') return `${(d.load ?? 0.08).toFixed(2)} ${(d.load ?? 0.05).toFixed(2)} 0.01 1/142 ${2000 + L.clock % 900}\n`;
  return null;
}
const btoaSafe = (s) => { try { return typeof btoa === 'function' ? btoa(s) : Buffer.from(s).toString('base64'); } catch { return 'xxxxxxxxxxxxxxxxxxxxxxxx'; } };
function lxCan(d, user, node, want) {
  if (user === 'root') return true; if (!node) return false;
  const u = d.users[user]; const inG = (u?.groups || []).includes(node.g) || (node.g === user);
  const bits = node.u === user ? (node.m >> 6) & 7 : inG ? (node.m >> 3) & 7 : node.m & 7;
  return { r: 4, w: 2, x: 1 }[want] & bits ? true : false;
}
const lxModeStr = (n) => (n.t === 'd' ? 'd' : n.t === 'l' ? 'l' : '-') + [6, 3, 0].map((s, i) => { const b = (n.m >> s) & 7; let x = (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-'); if (i === 2 && n.m & 0o1000) x = x.slice(0, 2) + (b & 1 ? 't' : 'T'); return x; }).join('');
const lxSize = (n) => (n.t === 'd' ? 4096 : n.sz ?? (n.c || '').length);
const human = (b) => { const u = ['', 'K', 'M', 'G', 'T']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return i ? `${b < 10 ? b.toFixed(1) : Math.round(b)}${u[i]}` : String(Math.round(b)); };

// ---------------------------------------------------------------- the shell interpreter (a practical subset of bash)
class LxExit { constructor(code) { this.code = code; } }
class LxRet { constructor(code) { this.code = code; } }
class LxBrk { constructor(n, cont) { this.n = n; this.cont = cont; } }
function lxLex(src) {
  const T = []; let i = 0; const n = src.length;
  const ops = ['&&', '||', ';;', '>>', '2>&1', '&>', '2>>', '2>', '<<<', '<<', '|', ';', '&', '>', '<', '(', ')', '\n'];
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#' && (i === 0 || /[\s;|&(]/.test(src[i - 1]))) { while (i < n && src[i] !== '\n') i++; continue; }
    const op = ops.find((o) => src.startsWith(o, i)); if (op && !(op === '(' && src[i + 1] === '(' && false)) {
      if (op === '<<' && src[i + 2] !== '<') { let j = i + 2; while (src[j] === ' ' || src[j] === '-') j++; const m = src.slice(j).match(/^['"]?(\w+)['"]?/); const tag = m[1]; const quoted = /^['"]/.test(m[0]); const nl = src.indexOf('\n', j); const end = src.indexOf(`\n${tag}`, nl); const body = src.slice(nl + 1, end < 0 ? n : end + 1); T.push({ t: 'op', v: '<<', body, quoted }); const after = end < 0 ? n : end + 1 + tag.length; src = src.slice(0, nl) + src.slice(after); i = j + m[0].length; continue; }
      T.push({ t: 'op', v: op }); i += op.length; continue;
    }
    let w = '', parts = [];
    while (i < n && !/[\s|;&<>()]/.test(src[i]) || (i < n && (src[i] === '(' || src[i] === ')') && w.endsWith('$')) || (i < n && w.endsWith('=') && src[i] === '(')) {
      const ch = src[i];
      if (ch === "'") { const j = src.indexOf("'", i + 1); w += '\u0001' + src.slice(i + 1, j < 0 ? n : j) + '\u0002'; i = j < 0 ? n : j + 1; continue; }
      if (ch === '"') { let j = i + 1, s = ''; while (j < n && src[j] !== '"') { if (src[j] === '\\' && '"$`\\'.includes(src[j + 1])) { s += src[j + 1] === '$' ? '\u0004' : src[j + 1]; j += 2; continue; } if (src[j] === '$' && src[j + 1] === '(') { let dep = 0, k = j + 1; for (; k < n; k++) { if (src[k] === '(') dep++; else if (src[k] === ')') { dep--; if (!dep) break; } } s += src.slice(j, k + 1); j = k + 1; continue; } s += src[j++]; } w += '\u0003' + s + '\u0003'; i = j + 1; continue; }
      if (ch === '\\') { w += '\u0001' + (src[i + 1] ?? '') + '\u0002'; i += 2; continue; }
      if (ch === '$' && src[i + 1] === '(') { let dep = 0, k = i + 1; for (; k < n; k++) { if (src[k] === '(') dep++; else if (src[k] === ')') { dep--; if (!dep) break; } } w += src.slice(i, k + 1); i = k + 1; continue; }
      if (ch === '`') { const j = src.indexOf('`', i + 1); w += '$(' + src.slice(i + 1, j) + ')'; i = j + 1; continue; }
      if (ch === '$' && src[i + 1] === '{') { const j = src.indexOf('}', i); w += src.slice(i, j + 1); i = j + 1; continue; }
      if (ch === '(' && w.endsWith('=')) { let dep = 0, k = i; for (; k < n; k++) { if (src[k] === '(') dep++; else if (src[k] === ')') { dep--; if (!dep) break; } } w += src.slice(i, k + 1); i = k + 1; continue; }
      w += ch; i++;
    }
    T.push({ t: 'w', v: w });
  }
  T.push({ t: 'op', v: '\n' }); return T;
}
function lxParse(src) {
  const T = lxLex(src); let p = 0;
  const peek = () => T[p] || { t: 'eof' }, next = () => T[p++] || { t: 'eof' };
  const isW = (v) => peek().t === 'w' && peek().v === v;
  const skip = () => { while (peek().t === 'op' && (peek().v === '\n' || peek().v === ';')) p++; };
  function list(ends) { const out = []; skip(); while (peek().t !== 'eof' && !(peek().t === 'w' && ends.includes(peek().v)) && !(peek().t === 'op' && ends.includes(peek().v))) { out.push(andor()); if (peek().t === 'op' && peek().v === '&') next(); skip(); } return out; }
  function andor() { let l = pipeline(); while (peek().t === 'op' && (peek().v === '&&' || peek().v === '||')) { const op = next().v; skip(); l = { k: 'andor', op, l, r: pipeline() }; } return l; }
  function pipeline() { let neg = false; if (isW('!')) { next(); neg = true; } const cmds = [command()]; while (peek().t === 'op' && peek().v === '|') { next(); skip(); cmds.push(command()); } return { k: 'pipe', cmds, neg }; }
  function command() {
    const t = peek();
    if (t.t === 'w') {
      if (t.v === 'if') { next(); const br = []; const c = list(['then']); next(); const b = list(['elif', 'else', 'fi']); br.push([c, b]); let els = null; while (isW('elif')) { next(); const c2 = list(['then']); next(); br.push([c2, list(['elif', 'else', 'fi'])]); } if (isW('else')) { next(); els = list(['fi']); } next(); return redirs({ k: 'if', br, els }); }
      if (t.v === 'for') { next(); if (peek().t === 'op' && peek().v === '(') { next(); next(); let expr = ''; while (!(peek().t === 'op' && peek().v === ')')) expr += next().v + ' '; next(); next(); const [a, c, s] = expr.split(';').map((x) => x.trim()); skip(); if (isW('do')) next(); const b = list(['done']); next(); return { k: 'cfor', a, c, s, b }; } const v = next().v; let items = null; skip(); if (isW('in')) { next(); items = []; while (peek().t === 'w' && peek().v !== 'do') items.push(next().v); } skip(); if (isW('do')) next(); const b = list(['done']); next(); return redirs({ k: 'for', v, items, b }); }
      if (t.v === 'while' || t.v === 'until') { next(); const c = list(['do']); next(); const b = list(['done']); next(); return redirs({ k: 'while', c, b, until: t.v === 'until' }); }
      if (t.v === 'case') { next(); const w = next().v; skip(); next(); skip(); const arms = []; while (!isW('esac')) { const pats = []; if (peek().t === 'op' && peek().v === '(') next(); pats.push(next().v); while (peek().t === 'op' && peek().v === '|') { next(); pats.push(next().v); } next(); const b = list([';;', 'esac']); if (peek().t === 'op' && peek().v === ';;') next(); skip(); arms.push([pats, b]); } next(); return { k: 'case', w, arms }; }
      if (t.v === '{') { next(); const b = list(['}']); next(); return redirs({ k: 'group', b }); }
      if (t.v === 'function' || (T[p + 1]?.t === 'op' && T[p + 1].v === '(' && T[p + 2]?.t === 'op' && T[p + 2].v === ')')) { if (t.v === 'function') next(); const name = next().v.replace(/\(\)$/, ''); if (peek().t === 'op' && peek().v === '(') { next(); next(); } skip(); const body = command(); return { k: 'func', name, body }; }
      if (t.v === '[[') { next(); const ws = []; while (!isW(']]')) ws.push(next().v); next(); return redirs({ k: 'dbl', ws }); }
      if (/^\(\(/.test(t.v)) { }
    }
    if (t.t === 'op' && t.v === '(') { next(); if (peek().t === 'op' && peek().v === '(') { next(); let e = ''; while (!(peek().t === 'op' && peek().v === ')')) e += next().v + ' '; next(); next(); return { k: 'arith', e }; } const b = list([')']); next(); return redirs({ k: 'sub', b }); }
    const words = [], rd = [];
    while (true) { const x = peek(); if (x.t === 'w') { words.push(next().v); continue; } if (x.t === 'op' && ['>', '>>', '<', '2>', '2>>', '&>', '2>&1', '<<', '<<<'].includes(x.v)) { next(); if (x.v === '2>&1') rd.push({ op: '2>&1' }); else if (x.v === '<<') rd.push({ op: '<<', body: x.body, quoted: x.quoted }); else rd.push({ op: x.v, to: next().v }); continue; } break; }
    return { k: 'cmd', words, rd };
  }
  function redirs(node) { const rd = []; while (peek().t === 'op' && ['>', '>>', '<', '2>', '2>>', '&>', '2>&1'].includes(peek().v)) { const x = next(); if (x.v === '2>&1') rd.push({ op: '2>&1' }); else rd.push({ op: x.v, to: next().v }); } if (rd.length) node.rd = rd; return node; }
  return list([]);
}
/** A shell session: its own variables, working directory and user */
function lxSession(L, d, user = null) {
  lxInit(L, d); const u = user || (d.admins || [d.distro === 'ubuntu' ? 'admin' : 'rocky'])[0];
  return { L, d, user: u, cwd: d.users[u]?.home || '/', vars: { HOME: d.users[u]?.home || '/', USER: u, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', SHELL: '/bin/bash', HOSTNAME: d.hostname, LANG: 'en_US.UTF-8', PWD: d.users[u]?.home || '/' }, funcs: {}, aliases: { ll: 'ls -alF', la: 'ls -A', l: 'ls -CF' }, last: 0, hist: [], args: [], ssh: null };
}
/** Run a script in a session, returning stdout+stderr text and the exit code */
function lxRun(S, src, stdin = '') {
  let ast; try { ast = lxParse(src); } catch (e) { return { out: `-bash: syntax error near unexpected token\n`, code: 2 }; }
  const io = { out: '', err: '' }; S.steps = 0;
  try { lxList(S, ast, io, stdin); } catch (e) { if (e instanceof LxExit) S.last = e.code; else if (e instanceof LxRet) S.last = e.code; else if (!(e instanceof LxBrk)) { io.err += `-bash: ${e.message}\n`; S.last = 1; } }
  return { out: io.out + io.err, stdout: io.out, stderr: io.err, code: S.last };
}
function lxList(S, list, io, stdin) { for (const x of list) { lxAndOr(S, x, io, stdin); } return S.last; }
function lxAndOr(S, x, io, stdin) { if (x.k === 'andor') { lxAndOr(S, x.l, io, stdin); if ((x.op === '&&' && S.last === 0) || (x.op === '||' && S.last !== 0)) lxAndOr(S, x.r, io, stdin); return; } lxPipe(S, x, io, stdin); }
function lxPipe(S, pl, io, stdin) {
  let input = stdin;
  pl.cmds.forEach((c, i) => { const last = i === pl.cmds.length - 1; const o = { out: '', err: '' }; lxCmd(S, c, o, input); ['prompt', 'edit', 'clear', 'ssh'].forEach((k) => { if (o[k]) io[k] = o[k]; }); if (last) { io.out += o.out; io.err += o.err; } else { input = o.out; io.err += o.err; } });
  if (pl.neg) S.last = S.last ? 0 : 1;
}
function lxGuard(S) { if (++S.steps > 50000) throw new Error('the script ran too long (endless loop?) and was stopped'); }
function lxCmd(S, c, io, stdin) {
  lxGuard(S);
  const withRd = (fn) => { if (!c.rd || !c.rd.length) return fn(io, stdin); const o = { out: '', err: '' }; let inp = stdin; c.rd.forEach((r) => { if (r.op === '<') { const p = lxNorm(S.cwd, lxExpand(S, r.to)[0], S.vars.HOME); const f = lxRead(S, p); if (f.err) { io.err += `-bash: ${r.to}: ${f.err}\n`; } inp = f.c ?? ''; } if (r.op === '<<') inp = r.quoted ? r.body : lxExpStr(S, r.body); if (r.op === '<<<') inp = lxExpand(S, r.to).join(' ') + '\n'; }); fn(o, inp); ['prompt', 'edit', 'clear', 'ssh'].forEach((k) => { if (o[k]) io[k] = o[k]; }); let toOut = o.out, toErr = o.err; c.rd.forEach((r) => { if (r.op === '2>&1') { toOut += toErr; toErr = ''; } }); for (const r of c.rd) { if (['>', '>>', '2>', '2>>', '&>'].includes(r.op)) { const tgt = lxExpand(S, r.to)[0]; const data = r.op === '&>' ? toOut + toErr : r.op.startsWith('2') ? toErr : toOut; if (r.op === '&>') { toOut = ''; toErr = ''; } else if (r.op.startsWith('2')) toErr = ''; else toOut = ''; if (tgt === '/dev/null') continue; const e = lxWrite(S, lxNorm(S.cwd, tgt, S.vars.HOME), data, r.op.endsWith('>>')); if (e) { io.err += `-bash: ${tgt}: ${e}\n`; S.last = 1; } } } io.out += toOut; io.err += toErr; };
  switch (c.k) {
    case 'if': return withRd((o, i) => { for (const [cond, b] of c.br) { lxList(S, cond, o, i); if (S.last === 0) { lxList(S, b, o, i); return; } } if (c.els) lxList(S, c.els, o, i); else S.last = 0; });
    case 'for': return withRd((o, i) => { const items = c.items ? c.items.flatMap((w) => lxExpand(S, w)) : S.args; for (const x of items) { S.vars[c.v] = x; try { lxList(S, c.b, o, i); } catch (e) { if (e instanceof LxBrk) { if (e.cont) continue; break; } throw e; } } });
    case 'cfor': return withRd((o, i) => { lxArith(S, c.a); while (lxArith(S, c.c) !== 0) { try { lxList(S, c.b, o, i); } catch (e) { if (e instanceof LxBrk) { if (!e.cont) break; } else throw e; } lxArith(S, c.s); lxGuard(S); } S.last = 0; });
    case 'while': return withRd((o, i) => { let inp = i; const reads = { buf: inp }; S._stdin = reads; while (true) { const tmp = { out: '', err: '' }; lxList(S, c.c, tmp, reads.buf); o.out += tmp.out; o.err += tmp.err; const go = c.until ? S.last !== 0 : S.last === 0; if (!go) break; try { lxList(S, c.b, o, ''); } catch (e) { if (e instanceof LxBrk) { if (!e.cont) break; } else throw e; } lxGuard(S); } S._stdin = null; S.last = 0; });
    case 'case': { const w = lxExpand(S, c.w).join(' '); for (const [pats, b] of c.arms) { if (pats.some((p) => lxGlobMatch(lxExpand(S, p).join(' '), w))) { lxList(S, b, io, stdin); return; } } S.last = 0; return; }
    case 'group': return withRd((o, i) => lxList(S, c.b, o, i));
    case 'sub': return withRd((o, i) => { const save = { cwd: S.cwd, vars: { ...S.vars } }; try { lxList(S, c.b, o, i); } catch (e) { if (!(e instanceof LxExit)) throw e; S.last = e.code; } S.cwd = save.cwd; S.vars = save.vars; });
    case 'func': S.funcs[c.name] = c.body; S.last = 0; return;
    case 'arith': S.last = lxArith(S, c.e) !== 0 ? 0 : 1; return;
    case 'dbl': S.last = lxTest(S, c.ws.flatMap((w) => (/^(==|!=|=~|&&|\|\||<|>)$/.test(w) ? [w] : lxExpand(S, w, { noGlob: true, noSplit: true }))), true) ? 0 : 1; return;
    case 'cmd': {
      if (!c.words.length) return withRd(() => {});
      const assigns = []; let k = 0; while (k < c.words.length && /^[A-Za-z_]\w*(\[\w+\])?\+?=/.test(c.words[k])) assigns.push(c.words[k++]);
      if (k === c.words.length) { assigns.forEach((a) => { const m = a.match(/^([A-Za-z_]\w*)(\+?)=(.*)$/s); let v = m[3]; if (/^\(.*\)$/s.test(v)) { S.vars[m[1]] = lxExpand(S, v.slice(1, -1).trim()).join(' '); return; } v = lxExpand(S, v, { noSplit: true, noGlob: true }).join(' '); S.vars[m[1]] = m[2] ? (S.vars[m[1]] || '') + v : v; }); S.last = 0; return withRd(() => {}); }
      let argv = c.words.slice(k).flatMap((w) => lxExpand(S, w));
      if (S.aliases[argv[0]] && !S._noAlias) argv = lxExpand(S, S.aliases[argv[0]]).concat(argv.slice(1));
      const env = {}; assigns.forEach((a) => { const m = a.match(/^([A-Za-z_]\w*)=(.*)$/s); env[m[1]] = lxExpand(S, m[2], { noSplit: true }).join(' '); });
      return withRd((o, i) => lxExec(S, argv, o, i, env));
    }
  }
}
function lxGlobMatch(pat, s) { const re = new RegExp('^' + pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[!/g, '[^') + '$'); return re.test(s); }
/** Word expansion: quotes, $vars, ${...}, $(...), $((...)), ~, globs, {a,b} */
function lxExpand(S, w, o = {}) {
  if (w == null) return [];
  if (!o.noBrace && /\{[^{}]*(,|\.\.)[^{}]*\}/.test(w) && !w.includes('\u0001') && !w.includes('\u0003') && !w.startsWith('${')) { const m = w.match(/^(.*?)\{([^{}]*)\}(.*)$/); if (m && !m[1].endsWith('$')) { let items; const r = m[2].match(/^(-?\d+)\.\.(-?\d+)$/); if (r) { items = []; const a = +r[1], b = +r[2]; for (let x = a; a <= b ? x <= b : x >= b; x += a <= b ? 1 : -1) items.push(String(x)); } else items = m[2].split(','); return items.flatMap((x) => lxExpand(S, m[1] + x + m[3], o)); } }
  let out = '', quoted = false, globbable = false; let i = 0;
  const fields = []; let splitHere = [];
  while (i < w.length) {
    const ch = w[i];
    if (ch === '\u0001') { const j = w.indexOf('\u0002', i); out += w.slice(i + 1, j); quoted = true; i = j + 1; continue; }
    if (ch === '\u0003') { const j = w.indexOf('\u0003', i + 1); out += lxExpStr(S, w.slice(i + 1, j)).replace(/\u0004/g, '$'); quoted = true; i = j + 1; continue; }
    if (ch === '~' && i === 0 && (w[1] === '/' || w.length === 1)) { out += S.vars.HOME; i++; continue; }
    if (ch === '$') { const [v, n] = lxDollar(S, w, i); const val = v; if (!o.noSplit) { const parts = val.split(/\s+/); if (parts.length > 1 && !quoted) { out += parts[0]; fields.push(out, ...parts.slice(1, -1)); out = parts[parts.length - 1]; i = n; continue; } } out += val; i = n; continue; }
    if ((ch === '*' || ch === '?' || (ch === '[' && w.indexOf(']', i) > i + 1)) && !o.noGlob && !(w === '[' || w === ']')) globbable = true;
    out += ch; i++;
  }
  fields.push(out);
  const res = fields.filter((f, k) => f !== '' || quoted || fields.length === 1);
  if (globbable) return res.flatMap((f) => { const g = lxGlob(S, f); return g.length ? g : [f]; });
  if (!quoted && res.length === 1 && res[0] === '' && /^\$/.test(w)) return [];
  return res;
}
function lxExpStr(S, s) { let out = '', i = 0; while (i < s.length) { if (s[i] === '$') { const [v, n] = lxDollar(S, s, i); out += v; i = n; continue; } out += s[i++]; } return out; }
function lxDollar(S, w, i) {
  if (w.startsWith('$((', i)) { let dep = 0, k = i + 1; for (; k < w.length; k++) { if (w[k] === '(') dep++; else if (w[k] === ')') { dep--; if (!dep) break; } } return [String(lxArith(S, w.slice(i + 3, k - 1))), k + 1]; }
  if (w[i + 1] === '(') { let dep = 0, k = i + 1; for (; k < w.length; k++) { if (w[k] === '(') dep++; else if (w[k] === ')') { dep--; if (!dep) break; } } const r = lxRun(lxSub(S), w.slice(i + 2, k)); S.last = r.code; return [r.stdout.replace(/\n+$/, ''), k + 1]; }
  if (w[i + 1] === '{') { const j = w.indexOf('}', i); const e = w.slice(i + 2, j); let m;
    if ((m = e.match(/^#(\w+)$/))) return [String((S.vars[m[1]] ?? '').length), j + 1];
    if ((m = e.match(/^(\w+):-(.*)$/))) return [S.vars[m[1]] || lxExpStr(S, m[2]), j + 1];
    if ((m = e.match(/^(\w+):=(.*)$/))) { if (!S.vars[m[1]]) S.vars[m[1]] = lxExpStr(S, m[2]); return [S.vars[m[1]], j + 1]; }
    if ((m = e.match(/^(\w+)%%?(.*)$/))) { const v = S.vars[m[1]] ?? ''; const re = new RegExp(lxGlobRe(m[2]) + '$'); return [v.replace(re, ''), j + 1]; }
    if ((m = e.match(/^(\w+)##?(.*)$/))) { const v = S.vars[m[1]] ?? ''; const greedy = e.includes('##'); const re = new RegExp('^' + lxGlobRe(m[2]).replace('.*', greedy ? '.*' : '.*?')); return [v.replace(re, ''), j + 1]; }
    if ((m = e.match(/^(\w+)\/\/?([^/]*)\/(.*)$/))) { const v = S.vars[m[1]] ?? ''; return [e.includes('//') ? v.split(m[2]).join(m[3]) : v.replace(m[2], m[3]), j + 1]; }
    if ((m = e.match(/^(\w+):(\d+)(:(\d+))?$/))) { const v = S.vars[m[1]] ?? ''; return [m[4] ? v.substr(+m[2], +m[4]) : v.slice(+m[2]), j + 1]; }
    return [lxVar(S, e), j + 1]; }
  const m = w.slice(i + 1).match(/^([A-Za-z_]\w*|\d|[?#@*$!])/); if (!m) return ['$', i + 1];
  return [lxVar(S, m[1]), i + 1 + m[1].length];
}
const lxGlobRe = (g) => g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
function lxVar(S, n) { if (n === '?') return String(S.last); if (n === '#') return String(S.args.length); if (n === '@' || n === '*') return S.args.join(' '); if (n === '$') return String(4000 + (S.L.clock % 3000)); if (n === '0') return S.script || '-bash'; if (/^\d$/.test(n)) return S.args[+n - 1] ?? ''; if (n === 'RANDOM') return String(Math.floor(Math.random() * 32768)); if (n === 'HOSTNAME') return S.d.hostname; if (n === 'PWD') return S.cwd; return S.vars[n] ?? ''; }
function lxSub(S) { return Object.assign(Object.create(Object.getPrototypeOf(S)), S, { vars: { ...S.vars }, steps: S.steps }); }
function lxArith(S, e) {
  if (e == null || !String(e).trim()) return 1;
  let x = String(e).replace(/\$\{?(\w+)\}?/g, (m, v) => lxVar(S, v) || '0');
  const asg = x.match(/^\s*(\w+)\s*(\+\+|--|\+=|-=|\*=|=)\s*(.*)$/); if (asg && !/==/.test(x.slice(asg.index, asg.index + asg[0].length - asg[3].length))) { const cur = +(S.vars[asg[1]] || 0); const val = asg[2] === '++' ? cur + 1 : asg[2] === '--' ? cur - 1 : lxArith(S, asg[3]); S.vars[asg[1]] = String(asg[2] === '+=' ? cur + val : asg[2] === '-=' ? cur - val : asg[2] === '*=' ? cur * val : val); return +S.vars[asg[1]]; }
  const pre = x.match(/^\s*(\+\+|--)(\w+)\s*$/); if (pre) { S.vars[pre[2]] = String(+(S.vars[pre[2]] || 0) + (pre[1] === '++' ? 1 : -1)); return +S.vars[pre[2]]; }
  x = x.replace(/\b([A-Za-z_]\w*)\b/g, (m) => S.vars[m] || '0');
  if (!/^[\d\s+\-*/%()<>=!&|?:]*$/.test(x)) return 0;
  try { const v = Function(`"use strict"; return (${x.replace(/(\d+)\s*\/\s*(\d+)/g, 'Math.trunc($1/$2)')})`)(); return typeof v === 'boolean' ? (v ? 1 : 0) : Math.trunc(+v || 0); } catch { return 0; }
}
function lxGlob(S, pat) {
  const abs = pat.startsWith('/'); const base = abs ? '' : S.cwd === '/' ? '' : S.cwd; const full = abs ? pat : `${base}/${pat}`;
  let re; try { re = new RegExp('^' + full.split('/').map((seg) => lxGlobRe(seg)).join('/') + '$'); } catch { return []; }
  const keys = Object.keys(S.d.lfs).filter((k) => re.test(k) && !k.split('/').pop().startsWith('.')).sort();
  return keys.map((k) => (abs ? k : k.slice(base.length + 1)));
}
function lxTest(S, a, dbl) {
  if (!a.length) return false;
  if (a[0] === '!') return !lxTest(S, a.slice(1), dbl);
  const ai = a.indexOf('-a') > 0 && !dbl ? a.indexOf('-a') : a.indexOf('&&'); if (ai > 0) return lxTest(S, a.slice(0, ai), dbl) && lxTest(S, a.slice(ai + 1), dbl);
  const oi = a.indexOf('-o') > 0 && !dbl ? a.indexOf('-o') : a.indexOf('||'); if (oi > 0) return lxTest(S, a.slice(0, oi), dbl) || lxTest(S, a.slice(oi + 1), dbl);
  if (a.length === 1) return a[0] !== '';
  if (a.length === 2) { const [op, x] = a; const p = lxNorm(S.cwd, x, S.vars.HOME); const n = S.d.lfs[p]; switch (op) { case '-z': return x === ''; case '-n': return x !== ''; case '-f': return n?.t === 'f'; case '-d': return n?.t === 'd'; case '-e': return !!n; case '-s': return !!n && lxSize(n) > 0; case '-r': return lxCan(S.d, S.user, n, 'r'); case '-w': return lxCan(S.d, S.user, n, 'w'); case '-x': return lxCan(S.d, S.user, n, 'x'); case '-L': return n?.t === 'l'; } }
  const [x, op, y] = a;
  switch (op) { case '=': case '==': return dbl ? lxGlobMatch(y, x) : x === y; case '!=': return x !== y; case '-eq': return +x === +y; case '-ne': return +x !== +y; case '-lt': return +x < +y; case '-le': return +x <= +y; case '-gt': return +x > +y; case '-ge': return +x >= +y; case '=~': return new RegExp(y).test(x); case '<': return x < y; case '>': return x > y; }
  return false;
}
function lxRead(S, p) {
  const v = lxVirt(S.L, S.d, p); if (v != null) { if (p === '/etc/shadow' && S.user !== 'root') return { err: 'Permission denied' }; return { c: v }; }
  const n = S.d.lfs[p]; if (!n) return { err: 'No such file or directory' }; if (n.t === 'd') return { err: 'Is a directory' };
  if (!lxCan(S.d, S.user, n, 'r') || !lxDirsOk(S, p)) return { err: 'Permission denied' };
  return { c: n.c ?? '', n };
}
function lxDirsOk(S, p) { if (S.user === 'root') return true; let cur = lxParent(p); while (true) { const n = S.d.lfs[cur]; if (n && !lxCan(S.d, S.user, n, 'x')) return false; if (cur === '/') return true; cur = lxParent(cur); } }
function lxWrite(S, p, data, app, o = {}) {
  const d = S.d; const n = d.lfs[p]; const par = d.lfs[lxParent(p)];
  if (!par || par.t !== 'd') return 'No such file or directory';
  if (n && n.t === 'd') return 'Is a directory';
  if (n ? !lxCan(d, S.user, n, 'w') : !lxCan(d, S.user, par, 'w')) return 'Permission denied';
  if (!lxDirsOk(S, p)) return 'Permission denied';
  const full = lxDiskFull(S.L, d, p); if (full && (data || '').length > 0) return 'No space left on device';
  if (n) { n.c = app ? (n.c || '') + data : data; n.mt = S.L.clock; delete n.sz; } else d.lfs[p] = { t: 'f', c: data, m: 0o666 & ~(S.umask ?? 0o022), u: S.user, g: S.d.users[S.user]?.groups?.[0] || S.user, mt: S.L.clock };
  return null;
}
/** Disk usage by mount: the LV / partition size, a base use, and the files written there */
function lxMounts(L, d) {
  const M = [];
  Object.entries(d.lvm?.lvs || {}).forEach(([n, lv]) => { if (lv.mount) M.push({ dev: `/dev/mapper/${lv.vg.replace(/-/g, '--')}-${n.replace(/-/g, '--')}`, mount: lv.mount, fs: lv.fs, size: lv.fsSize ?? lv.size, base: lv.used, lv: n }); });
  d.disks.forEach((k) => k.parts.forEach((p) => { if (p.mount) M.push({ dev: `/dev/${p.name}`, mount: p.mount, fs: p.fs || 'ext4', size: p.fsSize ?? p.size, base: p.used ?? p.size * 0.12 }); }));
  M.forEach((m) => { const pre = m.mount === '/' ? '/' : m.mount + '/'; const other = M.filter((x) => x !== m && x.mount.startsWith(pre) && x.mount.length > m.mount.length); let bytes = 0; Object.entries(d.lfs).forEach(([p, n]) => { if (n.t !== 'f') return; if (!(p + '/').startsWith(pre) && p !== m.mount) return; if (other.some((x) => p.startsWith(x.mount + '/'))) return; bytes += n.sz ?? (n.c || '').length; }); m.used = Math.min(m.size, m.base + bytes / 1073741824); });
  return M.sort((a, b) => a.mount.length - b.mount.length);
}
function lxMountOf(L, d, p) { const M = lxMounts(L, d); return M.filter((m) => p === m.mount || p.startsWith(m.mount === '/' ? '/' : m.mount + '/')).sort((a, b) => b.mount.length - a.mount.length)[0]; }
const lxDiskFull = (L, d, p) => { const m = lxMountOf(L, d, p); return m && m.used >= m.size - 0.0005; };

// ---------------------------------------------------------------- systemd: start a unit and fail it the way it really fails
function lxUnitStart(L, d, name) {
  const u = d.units[name]; if (!u) return { ok: false, msg: `Failed to start ${name}.service: Unit ${name}.service not found.` };
  if (u.masked) return { ok: false, msg: `Failed to start ${name}.service: Unit ${name}.service is masked.` };
  const why = lxUnitProblem(L, d, name);
  if (why) { u.active = 'failed'; u.result = why.result || 'exit-code'; u.since = L.clock; why.log.forEach((m) => lxLog(L, d, why.tag || name, m, 3)); lxLog(L, d, 'systemd', `${name}.service: Main process exited, code=exited, status=1/FAILURE`, 3); lxLog(L, d, 'systemd', `${name}.service: Failed with result '${u.result}'.`, 3); lxLog(L, d, 'systemd', `Failed to start ${name}.service - ${u.desc}.`, 3); return { ok: false, msg: `Job for ${name}.service failed because the control process exited with error code.\nSee "systemctl status ${name}.service" and "journalctl -xeu ${name}.service" for details.` }; }
  u.active = 'active'; u.since = L.clock; lxLog(L, d, 'systemd', `Started ${name}.service - ${u.desc}.`); settle(L, 'nodhcp'); return { ok: true };
}
/** Why a service would not start: config errors, ports in use, missing files, permissions, a full disk */
function lxUnitProblem(L, d, name) {
  if (lxDiskFull(L, d, '/var/log') && ['nginx', 'apache2', 'httpd', 'mariadb'].includes(name)) return { log: [name === 'nginx' ? 'nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (28: No space left on device)' : `${name}: No space left on device`] };
  if (name === 'nginx') { const t = lxNginxTest(L, d); if (!t.ok) return { log: t.lines, tag: 'nginx' }; const busy = ['apache2', 'httpd'].find((x) => d.units[x]?.active === 'active'); const ports = lxNginxPorts(d); if (busy && ports.includes(80)) return { log: ['nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)', 'nginx: [emerg] bind() to [::]:80 failed (98: Address already in use)', 'nginx: [emerg] still could not bind()'] }; }
  if (name === 'apache2' || name === 'httpd') { if (d.units.nginx?.active === 'active' && lxNginxPorts(d).includes(80)) return { log: ['(98)Address already in use: AH00072: make_sock: could not bind to address [::]:80', '(98)Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:80', 'no listening sockets available, shutting down', 'AH00015: Unable to open logs'] }; }
  if (name === 'ssh' || name === 'sshd') { const t = lxSshdTest(d); if (t) return { log: [t], tag: 'sshd' }; }
  if ((name === 'mariadb' || name === 'mysql') && d.lfs['/var/lib/mysql'] && d.lfs['/var/lib/mysql'].u !== 'mysql') return { log: ["[ERROR] mariadbd: Can't create/write to file '/var/lib/mysql/aria_log_control' (Errcode: 13 \"Permission denied\")", '[ERROR] Aborting'], tag: 'mariadbd' };
  if (d.units[name].bad) return { log: [d.units[name].bad] };
  return null;
}
function lxNginxConf(d) { return Object.entries(d.lfs).filter(([p, n]) => n.t === 'f' && (/^\/etc\/nginx\/sites-enabled\//.test(p) || /^\/etc\/nginx\/conf\.d\/.*\.conf$/.test(p))).map(([p, n]) => [p, n.t === 'l' ? d.lfs[n.to]?.c : n.c ?? (d.lfs[n.to]?.c || '')]); }
function lxNginxPorts(d) { const P = new Set(); lxNginxConf(d).forEach(([, c]) => (c || '').replace(/#.*$/gm, '').replace(/listen\s+(\[::\]:)?(\d+)/g, (m, a, p) => P.add(+p))); if (!P.size) P.add(80); return [...P]; }
function lxNginxTest(L, d) {
  const DIR = ['server', 'listen', 'server_name', 'root', 'index', 'location', 'try_files', 'ssl_certificate', 'ssl_certificate_key', 'ssl_protocols', 'ssl_ciphers', 'return', 'proxy_pass', 'proxy_set_header', 'access_log', 'error_log', 'include', 'add_header', 'client_max_body_size', 'rewrite', 'allow', 'deny', 'autoindex', 'charset', 'gzip', 'upstream', 'alias', 'expires', 'http2', 'error_page', 'default_type', 'keepalive_timeout', 'fastcgi_pass', 'ssl_session_cache', 'ssl_prefer_server_ciphers', 'if', 'set', 'limit_req'];
  const bad = (m) => ({ ok: false, lines: [`nginx: [emerg] ${m}`, 'nginx: configuration file /etc/nginx/nginx.conf test failed'] });
  for (const [p, c0] of lxNginxConf(d)) {
    const c = (c0 || '').replace(/#.*$/gm, ''); let cur = [], tok = '', dep = 0, line = 1;
    const flush = () => { if (tok) { cur.push(tok); tok = ''; } };
    for (let i = 0; i < c.length; i++) { const ch = c[i]; if (ch === '\n') { line++; flush(); continue; } if (/\s/.test(ch)) { flush(); continue; }
      if (ch === ';' || ch === '{' || ch === '}') { flush();
        if (ch === '}') { if (cur.length) return bad(`unexpected "}" in ${p}:${line}`); dep--; if (dep < 0) return bad(`unexpected "}" in ${p}:${line}`); continue; }
        if (!cur.length) return bad(`unexpected "${ch}" in ${p}:${line}`);
        const k = cur[0]; if (!DIR.includes(k)) return bad(`unknown directive "${k}" in ${p}:${line}`);
        if (ch === ';' && /^ssl_certificate(_key)?$/.test(k) && !d.lfs[cur[1]]) return bad(`cannot load certificate${k.endsWith('key') ? ' key' : ''} "${cur[1]}": BIO_new_file() failed (SSL: error:80000002:system library::No such file or directory:calling fopen(${cur[1]}, r) error:10000080:BIO routines::no such file)`);
        if (ch === ';' && k === 'listen' && !/^(\[::\]:)?\d+$/.test(cur[1] || '')) return bad(`invalid port in "${cur[1]}" of the "listen" directive in ${p}:${line}`);
        if (ch === '{') dep++; cur = []; continue; }
      tok += ch; }
    flush(); if (cur.length) return bad(`unexpected end of file, expecting ";" or "}" in ${p}:${line}`); if (dep > 0) return bad(`unexpected end of file, expecting "}" in ${p}:${line}`);
  }
  return { ok: true, lines: ['nginx: the configuration file /etc/nginx/nginx.conf syntax is ok', 'nginx: configuration file /etc/nginx/nginx.conf test is successful'] };
}
function lxSshdTest(d) { const c = d.lfs['/etc/ssh/sshd_config']?.c || ''; const bad = c.split('\n').find((l) => /^\s*[A-Za-z]/.test(l) && !/^\s*(Include|Port|ListenAddress|PermitRootLogin|PubkeyAuthentication|PasswordAuthentication|PermitEmptyPasswords|KbdInteractiveAuthentication|ChallengeResponseAuthentication|UsePAM|X11Forwarding|PrintMotd|AcceptEnv|Subsystem|AllowUsers|AllowGroups|MaxAuthTries|ClientAliveInterval|AuthorizedKeysFile|Banner|LoginGraceTime|PermitTTY|AuthenticationMethods)\b/.test(l)); if (bad) return `/etc/ssh/sshd_config line ${c.split('\n').indexOf(bad) + 1}: Bad configuration option: ${bad.trim().split(/\s+/)[0]}`; const v = (k) => (c.match(new RegExp(`^\\s*${k}\\s+(\\S+)`, 'mi')) || [])[1]; const pr = v('PermitRootLogin'); if (pr && !['yes', 'no', 'prohibit-password', 'without-password', 'forced-commands-only'].includes(pr)) return `/etc/ssh/sshd_config line ${c.split('\n').findIndex((l) => /PermitRootLogin/.test(l)) + 1}: unsupported option "${pr}".`; return null; }
/** Ports a Linux machine listens on (systemd units, nginx listen lines, sshd Port, docker port maps) */
hostPorts = function (L, d, t, u) {
  if (d.os !== 'linux' || !d.units) return;
  Object.entries(d.units).forEach(([n, x]) => { if (x.active !== 'active') return; if (n === 'nginx') lxNginxPorts(d).forEach((p) => t.add(p)); else if (n === 'ssh' || n === 'sshd') t.add(+((d.lfs['/etc/ssh/sshd_config']?.c || '').match(/^\s*Port\s+(\d+)/m)?.[1] || 22)); else (x.tcp || []).forEach((p) => t.add(p)); (x.udp || []).forEach((p) => u.add(p)); });
  Object.values(d.dock?.ctrs || {}).forEach((c) => { if (c.up) (c.ports || []).forEach((p) => t.add(p.host)); });
};
/** What a web server answers (for curl / browsers): the page, or a TLS error */
function httpServe(L, D, scheme, host, port) {
  if (!D) return null;
  if (D.os === 'linux' && D.units?.nginx?.active === 'active') {
    const conf = lxNginxConf(D).map(([, c]) => c || '').join('\n');
    if (scheme === 'https') { const cp = (conf.match(/ssl_certificate\s+(\S+);/) || [])[1]; const cert = cp && D.lfs[cp]?.cert; if (!cert) return { err: 'curl: (35) OpenSSL/3.0.13: error:0A00010B:SSL routines::wrong version number\n' }; if (cert.notAfter < 20261021) return { err: `curl: (60) SSL certificate problem: certificate has expired\nMore details here: https://curl.se/docs/sslcerts.html\n\ncurl failed to verify the legitimacy of the server and therefore could not\nestablish a secure connection to it.\n` }; if (!cert.trusted) return { err: 'curl: (60) SSL certificate problem: self-signed certificate\nMore details here: https://curl.se/docs/sslcerts.html\n' }; if (!lxCertMatches(cert, host)) return { err: `curl: (60) SSL: no alternative certificate subject name matches target host name '${host}'\n` }; }
    const root = (conf.match(/root\s+(\S+);/) || [])[1] || '/var/www/html'; const page = D.lfs[`${root}/index.html`] || D.lfs[`${root}/index.nginx-debian.html`];
    if (page && !lxCan(D, 'www-data', page, 'r')) return { code: 403, body: '<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n<hr><center>nginx/1.24.0 (Ubuntu)</center>\r\n</body>\r\n</html>' };
    return { code: 200, server: 'nginx/1.24.0 (Ubuntu)', body: page?.c || '<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n</body>\n</html>' };
  }
  if (D.os === 'linux' && (D.units?.apache2?.active === 'active' || D.units?.httpd?.active === 'active')) return { code: 200, server: 'Apache/2.4.58 (Ubuntu)', body: D.lfs['/var/www/html/index.html']?.c || '<html><body><h1>It works!</h1></body></html>' };
  const ct = Object.values(D.dock?.ctrs || {}).find((c) => c.up && (c.ports || []).some((p) => p.host === port)); if (ct) return { code: 200, server: ct.image.startsWith('nginx') ? 'nginx/1.27.2' : 'httpd', body: `<!DOCTYPE html><html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1><p>(container ${ct.name})</p></body></html>` };
  if (D.kind === 'isp') return { code: 200, body: `<html><body>${L.inet.hosts[Object.keys(L.inet.hosts).find((k) => L.inet.hosts[k].name === host)]?.name || host}</body></html>` };
  return null;
}
const lxCertMatches = (c, host) => [c.cn, ...(c.san || [])].some((n) => n && (n.toLowerCase() === String(host).toLowerCase() || (n.startsWith('*.') && String(host).toLowerCase().endsWith(n.slice(1).toLowerCase()))) || isIp(host) && (c.san || []).includes(host));
