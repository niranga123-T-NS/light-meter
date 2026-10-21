// =================== Helpers for lesson labs: building blocks for topologies and the checks tasks use
const B = {
  pc: (id, x, y, ip, o = {}) => ({ id, kind: 'pc', x, y, hostname: o.hn || id, os: o.os || 'win', nics: { [o.os === 'linux' ? 'ens33' : 'Ethernet']: ip === 'dhcp' ? { dhcp: true, dns: o.dns } : { cidr: ip, gw: o.gw, dns: o.dns || [] } }, ...o.x }),
  win: (id, x, y, ip, o = {}) => ({ id, kind: 'srv', x, y, hostname: o.hn || id, os: 'win', nics: { Ethernet: { cidr: ip, gw: o.gw, dns: o.dns || [] } }, ...o.x }),
  lx: (id, x, y, ip, o = {}) => ({ id, kind: 'srv', x, y, hostname: o.hn || id.toLowerCase(), os: 'linux', distro: o.distro || 'ubuntu', nics: { ens18: ip === 'dhcp' ? { dhcp: true } : { cidr: ip, gw: o.gw, dns: o.dns || [] } }, ...o.x }),
  sw: (id, x, y, n = 24, o = {}) => ({ id, kind: 'sw', x, y, hostname: o.hn || id, n, up: o.up || ['Te1/1/1', 'Te1/1/2'], ...o.x }),
  rt: (id, x, y, ifs, o = {}) => ({ id, kind: 'rt', x, y, hostname: o.hn || id, ifs, ...o.x }),
  isp: (x, y, ifs) => ({ id: 'ISP', kind: 'isp', x, y, hostname: 'Internet', ifs }),
};
/** A web server (Ubuntu + nginx) that already works */
function lxWeb(L, id, page) { const d = L.devs[id]; lxInit(L, d); const S = lxSession(L, d, 'root'); lxRun(S, 'apt install -y nginx >/dev/null 2>&1 || true'); if (!d.pkgs.includes('nginx')) { d.pkgs.push('nginx'); lxUnitAdd(d, 'nginx'); lxPkgFiles(S, 'nginx'); } d.units.nginx.active = 'active'; if (page) lxWrite(S, '/var/www/html/index.html', page); settle(L, 'nodhcp'); }
/** A Windows DNS server with one zone */
function winDns(L, id, zone, recs, fwd = ['8.8.8.8']) { const d = L.devs[id]; winInit(L, d); d.features.push('DNS', 'RSAT-DNS-Server'); d.svc.DNS = { display: 'DNS Server', start: 'Automatic', status: 'Running', tcp: [53], udp: [53] }; d.dns = { zones: [{ name: zone, type: 'Primary', recs: recs.map(([n, ip]) => ({ name: n, type: 'A', data: ip, static: true })) }], fwd }; }
const C = {
  /** Was a command typed on this device (regex on the line) */
  ran: (L, dev, re, kind) => (L.cmdlog || []).some((c) => c.dev === dev && (!kind || c.kind === kind) && re.test(c.line)),
  /** Can this device reach the host (name or IP) on a port – the real path, NAT, firewalls, DNS */
  reach: (L, dev, host, port, proto = 'tcp') => { const d = L.devs[dev]; if (!d) return false; let ip = host; if (!isIp(host)) { const r = d.os === 'linux' ? lxResolve(lxSession(L, d), host) : winResolve({ L, d }, host, { noCache: true }); if (!r.ip) return false; ip = r.ip; } const r = send(L, dev, port ? { dst: ip, proto, dport: port } : { dst: ip }); return r.res === 'ok'; },
  ping: (L, dev, ip) => send(L, dev, { dst: ip }).res === 'ok',
  resolves: (L, dev, name, want) => { const d = L.devs[dev]; const r = d.os === 'linux' ? lxResolve(lxSession(L, d), name) : winResolve({ L, d }, name, { noCache: true }); return !!r.ip && (!want || r.ip === want); },
  nic: (L, dev) => Object.values(L.devs[dev].nics)[0],
  web: (L, dev, url) => { const d = L.devs[dev]; const m = url.match(/^(https?):\/\/([^/:]+)(:(\d+))?/); const host = m[2], port = +(m[4] || (m[1] === 'https' ? 443 : 80)); const r = isIp(host) ? { ip: host } : d.os === 'linux' ? lxResolve(lxSession(L, d), host) : winResolve({ L, d }, host, { noCache: true }); if (!r.ip) return false; const t = send(L, dev, { dst: r.ip, proto: 'tcp', dport: port }); if (t.res !== 'ok') return false; const pg = httpServe(L, L.devs[t.at], m[1], host, port); return !!pg && !pg.err; },
  port: (L, sw, p) => L.devs[sw].ports[p],
  up: (L, dev, p) => linkUp(L, dev, p),
};
/** Test helper: run console steps [dev, tool, command] in a lab, return the transcript */
function runFix(L, steps) {
  const sh = {}; let log = '';
  steps.forEach(([dev, tool, cmd]) => { if (typeof cmd === 'function') { cmd(L); settle(L); return; } const d = L.devs[dev]; if (tool === 'js') { new Function('L', 'd', cmd)(L, d); L.cmdlog.push({ dev, kind: 'js', line: cmd, t: L.clock }); log += `${dev}> (js) ${cmd}\n`; settle(L); return; } if (tool === 'fct') { const [, gw, port, user, pass] = cmd.split(/\s+/); d.ssl = null; const r = fgSslLogin(L, d, gw, port, user, pass); L.cmdlog.push({ dev, kind: 'fct', line: cmd, ok: r.ok, t: L.clock }); log += `${dev}> FortiClient ${cmd}\n${r.ok ? `Connected ${r.ip}` : r.why}\n`; settle(L, 'nodhcp'); return; } const k = `${dev}|${tool}`; sh[k] ??= (TOOLS[d.kind] || []).find((t) => t.id === tool).term(L, d); const r = sh[k].run(cmd); L.cmdlog.push({ dev, kind: sh[k].kind, line: cmd, t: L.clock }); tick(L, 1500); log += `${dev}> ${cmd}\n${typeof r === 'string' ? r : JSON.stringify(r)}`; settle(L, 'nodhcp'); });
  return log.replace(/\x1b\[\d+m/g, '');
}
/** A ready domain: DC promoted with DNS, users created, computers joined (each through the same PowerShell the trainee uses) */
function adQuick(L, dcId, o = {}) {
  const dom = o.domain || 'corp.dimo.lk', nb = o.netbios || 'DIMO', dc = winShell(L, L.devs[dcId], { ps: true, user: 'Administrator' });
  const ps = (sh, c) => { const r = sh.run(c); if (typeof r === 'string' && /Exception|error|not recognized/i.test(r) && !o.quiet) console.warn('adQuick:', c, r.slice(0, 200)); return r; };
  ps(dc, 'Install-WindowsFeature AD-Domain-Services -IncludeManagementTools'); ps(dc, `Install-ADDSForest -DomainName ${dom} -DomainNetbiosName ${nb} -InstallDns -SafeModeAdministratorPassword (ConvertTo-SecureString 'Dsrm!2026x' -AsPlainText -Force) -Force`);
  settle(L, 'nodhcp'); const base = dom.split('.').map((x) => `DC=${x}`).join(',');
  ps(dc, `New-ADOrganizationalUnit -Name DIMO -Path '${base}'`);
  (o.users || []).forEach(([sam, name, pw]) => ps(dc, `New-ADUser -Name '${name}' -SamAccountName ${sam} -Path 'OU=DIMO,${base}' -AccountPassword (ConvertTo-SecureString '${pw}' -AsPlainText -Force) -Enabled $true`));
  (o.join || []).forEach((id) => { const d = L.devs[id]; winInit(L, d); const r = adJoin(L, d, dom, 'Administrator', L.devs[dcId].adminPass || 'Passw0rd!'); if (!r.ok && !o.quiet) console.warn('adQuick join', id, r.msg); d.domain = dom; delete d.pendingJoin; if (d.svc?.Netlogon) d.svc.Netlogon.status = 'Running'; });
  settle(L, 'nodhcp');
}
