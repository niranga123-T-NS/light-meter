// =================== FortiGate: the configuration tree (config / edit / set / next / end), policies, VIPs, IPsec and SSL-VPN, and its CLI
const FG_TABLES = ['system interface', 'system zone', 'router static', 'firewall address', 'firewall addrgrp', 'firewall service custom', 'firewall service group', 'firewall policy', 'firewall vip', 'firewall ippool', 'vpn ipsec phase1-interface', 'vpn ipsec phase2-interface', 'system dhcp server', 'user local', 'user group', 'system snmp community', 'system admin', 'vpn ssl web portal', 'log syslogd filter'];
const FG_SETTINGS = ['system netflow', 'system global', 'system dns', 'vpn ssl settings', 'log syslogd setting', 'system ntp', 'system settings', 'log setting'];
const FG_SUB = { 'system dhcp server': ['ip-range', 'reserved-address'], 'system snmp community': ['hosts'], 'vpn ssl settings': ['authentication-rule'] };
const FG_SVC = { ALL: [['any']], ALL_TCP: [['tcp', 1, 65535]], ALL_UDP: [['udp', 1, 65535]], ALL_ICMP: [['icmp']], PING: [['icmp']], HTTP: [['tcp', 80]], HTTPS: [['tcp', 443]], DNS: [['udp', 53], ['tcp', 53]], SSH: [['tcp', 22]], RDP: [['tcp', 3389]], SMTP: [['tcp', 25]], SMTPS: [['tcp', 465]], SNMP: [['udp', 161], ['udp', 162]], SAMBA: [['tcp', 139], ['tcp', 445]], SMB: [['tcp', 445]], NTP: [['udp', 123]], FTP: [['tcp', 21]], LDAP: [['tcp', 389]], KERBEROS: [['tcp', 88], ['udp', 88]], SYSLOG: [['udp', 514]], 'MS-SQL': [['tcp', 1433]], MYSQL: [['tcp', 3306]], TELNET: [['tcp', 23]], 'Windows AD': [['tcp', 88], ['tcp', 135], ['tcp', 389], ['tcp', 445], ['tcp', 636], ['tcp', 3268], ['udp', 53], ['udp', 88], ['udp', 389]], IMAPS: [['tcp', 993]], SIP: [['udp', 5060]], DHCP: [['udp', 67]] };
function fgDefaults(d) {
  const c = d.cfg; FG_TABLES.forEach((t) => (c[t] ??= {})); FG_SETTINGS.forEach((t) => (c[t] ??= {}));
  c['system global'].hostname ??= [d.hostname || d.name];
  c['firewall address'].all ??= { subnet: ['0.0.0.0', '0.0.0.0'] };
  Object.entries(d.ifs || {}).forEach(([n, x]) => { const e = (c['system interface'][n] ??= { vdom: ['root'], type: ['physical'] }); if (x.cidr) { const y = cidr(x.cidr); e.ip = [y.ip, y.mask]; } if (x.access) e.allowaccess = x.access.split(' '); if (x.role) e.role = [x.role]; if (x.alias) e.alias = [x.alias]; if (x.vlan) { e.type = ['vlan']; e.interface = [x.parent]; e.vlanid = [String(x.vlan)]; } });
  delete d.ifs;
}
/** Table entries in their configured order (policy IDs are numbers, so the order is kept apart from the object) */
const fgTable = (d, t) => { const e = Object.entries(d.cfg[t] || {}); const q = d.seq?.[t]; if (!q) return e; const at = (k) => { const i = q.indexOf(k); return i < 0 ? 1e9 : i; }; return e.sort((a, b) => at(a[0]) - at(b[0])); };
function fgMove(d, path, a, pos, b) { const keys = fgTable(d, path).map(([k]) => k).filter((k) => k !== a); const i = keys.indexOf(b) + (pos === 'after' ? 1 : 0); keys.splice(i, 0, a); (d.seq ??= {})[path] = keys; }
const fgIfList = (d) => fgTable(d, 'system interface').concat(fgTable(d, 'vpn ipsec phase1-interface').map(([n, p]) => [n, { type: ['tunnel'], interface: p.interface }]));
const fgIf = (d, n) => (n == null ? null : d.cfg['system interface'][n] || (d.cfg['vpn ipsec phase1-interface'][n] ? { type: ['tunnel'], allowaccess: ['ping'] } : n === 'ssl.root' ? { type: ['ssl'] } : null));
const fgIpOf = (c) => { const v = c?.ip || []; if (!v.length) return []; if (v[0].includes('/')) { const x = cidr(v[0]); return [x.ip, x.mask]; } return v[1] && isIp(v[0]) && v[0] !== '0.0.0.0' ? [v[0], v[1]] : []; };
const fgNet = (v) => { if (!v || !v.length) return ['0.0.0.0', '0.0.0.0']; if (v[0].includes('/')) { const x = cidr(v[0]); return [netOf(x.ip, x.mask), x.mask]; } return [netOf(v[0], v[1] || '255.255.255.255'), v[1] || '255.255.255.255']; };
const fgTunnels = (d) => fgTable(d, 'vpn ipsec phase1-interface').map(([n, p]) => ({ name: n, ...p }));
const fgSslOn = (d) => !!d.cfg['vpn ssl settings']?.['source-interface'];
function fgSslPool(d) { const s = d.cfg['vpn ssl settings']; const pool = s?.['tunnel-ip-pools']?.[0]; if (!pool || !fgSslOn(d)) return null; const a = d.cfg['firewall address'][pool]; if (!a) return null; if (a['start-ip']) { const st = a['start-ip'][0]; return { net: netOf(st, '255.255.255.0'), mask: '255.255.255.0', start: st, end: a['end-ip']?.[0] }; } const [n, m] = fgNet(a.subnet); return { net: n, mask: m, start: n2ip(ip2n(n) + 1), end: n2ip(ip2n(bcastOf(n, m)) - 1) }; }
/** Interface membership: a policy may name a zone, an interface or "any" */
function fgIfIn(d, names, ifn) { if (!names || !names.length) return false; return names.some((n) => n === 'any' || n === ifn || (d.cfg['system zone'][n]?.interface || []).includes(ifn)); }
function fgAddrIn(d, names, ip, pkt, dst) {
  const one = (n, depth) => {
    if (depth > 4) return false;
    if (n === 'all') return !(dst && pkt.vip);
    const v = d.cfg['firewall vip'][n]; if (v) return dst && pkt.vip === n;
    const g = d.cfg['firewall addrgrp'][n]; if (g) return (g.member || []).some((m) => one(m, depth + 1));
    const a = d.cfg['firewall address'][n]; if (!a) return false;
    if (dst && pkt.vip) return false;
    if (a.type?.[0] === 'iprange' || a['start-ip']) return ip2n(ip) >= ip2n(a['start-ip'][0]) && ip2n(ip) <= ip2n(a['end-ip'][0]);
    if (a.type?.[0] === 'fqdn') return false;
    const [net, m] = fgNet(a.subnet); return inNet(ip, net, m);
  };
  return (names || []).some((n) => one(n, 0));
}
function fgSvcIn(d, names, pkt) {
  const one = (n, depth) => {
    if (depth > 4) return false;
    const g = d.cfg['firewall service group'][n]; if (g) return (g.member || []).some((m) => one(m, depth + 1));
    const cu = d.cfg['firewall service custom'][n];
    const defs = cu ? [...(cu['tcp-portrange'] || []).map((r) => ['tcp', ...r.split(':')[0].split('-').map(Number)]), ...(cu['udp-portrange'] || []).map((r) => ['udp', ...r.split(':')[0].split('-').map(Number)]), ...(cu.protocol?.[0] === 'ICMP' ? [['icmp']] : [])] : FG_SVC[n] || [];
    return defs.some(([p, a, b]) => p === 'any' || (p === pkt.proto && (p === 'icmp' || (pkt.dport >= a && pkt.dport <= (b ?? a)))));
  };
  return (names || []).some((n) => one(n, 0));
}
/** First matching policy wins; no match = the implicit deny (policy 0) */
function fgPolicy(L, d, inIf, outIf, pkt) {
  const P = fgTable(d, 'firewall policy');
  for (const [id, p] of P) {
    if ((p.status ?? ['enable'])[0] === 'disable') continue;
    if (!fgIfIn(d, p.srcintf, inIf) || !fgIfIn(d, p.dstintf, outIf)) continue;
    if (!fgAddrIn(d, p.srcaddr, pkt.src, pkt, false) || !fgAddrIn(d, p.dstaddr, pkt.dst, pkt, true)) continue;
    if (!fgSvcIn(d, p.service, pkt)) continue;
    if (p.groups && inIf === 'ssl.root') { const u = Object.values(L.devs).find((x) => x.ssl?.ip === pkt.src); if (!u || !p.groups.some((g) => (d.cfg['user group'][g]?.member || []).includes(u.ssl.user))) continue; }
    const acc = (p.action ?? ['deny'])[0] === 'accept';
    return { ok: acc, id: +id, nat: (p.nat ?? ['disable'])[0] === 'enable', why: acc ? '' : `denied by policy ${id}${p.name ? ` (${p.name[0]})` : ''} on ${d.name}`, name: p.name?.[0] };
  }
  return { ok: false, id: 0, why: `no policy on ${d.name} allows ${inIf} → ${outIf} for this traffic (implicit deny, policy 0)` };
}
function fgVip(L, d, inIf, pkt) {
  for (const [n, v] of fgTable(d, 'firewall vip')) {
    if (v.extip?.[0] !== pkt.dst) continue;
    if (v.extintf && v.extintf[0] !== 'any' && v.extintf[0] !== inIf) continue;
    const pf = (v.portforward ?? ['disable'])[0] === 'enable';
    if (pf && ((v.protocol?.[0] ?? 'tcp') !== pkt.proto || +v.extport?.[0] !== pkt.dport)) continue;
    return { ip: (v.mappedip?.[0] || '').split('-')[0], port: pf ? +(v.mappedport?.[0] ?? v.extport?.[0]) : null, name: n };
  }
  return null;
}
function fgLog(L, d, inIf, outIf, pkt, p) { (d.tlog ??= []).push({ t: L.clock, src: pkt.src, dst: pkt.dst, proto: pkt.proto, dport: pkt.dport, srcintf: inIf, dstintf: outIf, policyid: p.id, action: p.ok ? 'accept' : 'deny', why: p.why }); if (d.tlog.length > 200) d.tlog.shift(); if (d.flowOn) { d.flowBuf ??= []; d.flowBuf.push(...fgFlowLines(d, inIf, outIf, pkt, p)); d.flowOn--; } }
function fgFlowLines(d, inIf, outIf, pkt, p) {
  const id = (d.flowId = (d.flowId ?? 0) + 1), pr = { icmp: 1, tcp: 6, udp: 17 }[pkt.proto], pre = `id=20085 trace_id=${id}`;
  const L1 = [`${pre} func=print_pkt_detail line=5895 msg="vd-root:0 received a packet(proto=${pr}, ${pkt.src}:${pkt.sport ?? 1}->${pkt.dst}:${pkt.proto === 'icmp' ? 2048 : pkt.dport}) from ${inIf}."`, `${pre} func=init_ip_session_common line=6076 msg="allocate a new session-0000${(1000 + id).toString(16)}"`, `${pre} func=vf_ip_route_input_common line=2605 msg="find a route: flag=04000000 gw-${pkt.dst} via ${outIf}"`];
  if (!p.ok) L1.push(`${pre} func=fw_forward_handler line=${p.id ? 776 : 791} msg="${p.id ? `Denied by forward policy check (policy ${p.id})` : 'Denied by forward policy check (policy 0)'}"`);
  else { L1.push(`${pre} func=fw_forward_handler line=930 msg="Allowed by Policy-${p.id}:${p.nat ? ' SNAT' : ''}"`); if (p.nat) L1.push(`${pre} func=__ip_session_run_tuple line=3480 msg="SNAT ${pkt.src}->${'(interface address)'}"`); }
  return L1;
}
/** IPsec: phase 1 needs the peers to reach each other and agree (key, proposal, IKE version); phase 2 needs mirrored selectors */
function fgVpnState(L, d) {
  L._vpn ??= {};
  fgTunnels(d).forEach((t) => {
    const k = `${d.id}|${t.name}`, st = { up: false, p1: false, p2: false, why: '', peer: null, peerIf: null };
    const wan = fgIf(d, t.interface?.[0]), myIp = fgIpOf(wan)[0], rg = t['remote-gw']?.[0];
    if (!myIp || !rg) { st.why = 'phase 1 has no local interface address or remote gateway'; L._vpn[k] = st; return; }
    let peer = null, pt = null;
    Object.values(L.devs).filter((x) => x.kind === 'fw' && x.id !== d.id).forEach((x) => fgTunnels(x).forEach((u) => { if (fgIpOf(fgIf(x, u.interface?.[0]))[0] === rg && u['remote-gw']?.[0] === myIp) { peer = x; pt = u; } }));
    const reach = send(L, d.id, { dst: rg, proto: 'udp', dport: 500, src: myIp }, { oneWay: false });
    if (reach.res !== 'ok') { st.why = `phase 1: no answer from ${rg} (IKE UDP 500) – ${reach.why || reach.res}`; L._vpn[k] = st; return; }
    if (!peer) { st.why = `phase 1: the peer ${rg} has no tunnel back to ${myIp} (remote gateway mismatch)`; L._vpn[k] = st; return; }
    const iv = (x) => x['ike-version']?.[0] ?? '1', props = (x) => (x.proposal || ['aes256-sha256']).map(String), dh = (x) => (x.dhgrp || ['14']).map(String);
    if (iv(t) !== iv(pt)) st.why = `phase 1: IKE version mismatch (v${iv(t)} vs v${iv(pt)})`;
    else if (!props(t).some((p) => props(pt).includes(p))) st.why = 'phase 1: no proposal chosen (encryption / authentication do not match)';
    else if (!dh(t).some((p) => dh(pt).includes(p))) st.why = 'phase 1: DH group mismatch';
    else if ((t.psksecret?.[0] ?? '') !== (pt.psksecret?.[0] ?? '')) st.why = 'phase 1: authentication failed – the pre-shared keys do not match';
    if (st.why) { L._vpn[k] = st; return; }
    st.p1 = true; st.peer = peer.id; st.peerIf = pt.name; st.peerIp = rg;
    const p2a = fgTable(d, 'vpn ipsec phase2-interface').filter(([, p]) => p.phase1name?.[0] === t.name).map(([n, p]) => ({ n, ...p }));
    const p2b = fgTable(peer, 'vpn ipsec phase2-interface').filter(([, p]) => p.phase1name?.[0] === pt.name).map(([n, p]) => ({ n, ...p }));
    const sel = (v) => fgNet(v ?? ['0.0.0.0', '0.0.0.0']).join('/');
    const ok2 = p2a.find((a) => p2b.some((b) => sel(a['src-subnet']) === sel(b['dst-subnet']) && sel(a['dst-subnet']) === sel(b['src-subnet']) && (a.proposal || ['aes256-sha256']).some((p) => (b.proposal || ['aes256-sha256']).includes(p))));
    if (!p2a.length) st.why = 'phase 1 is up but there is no phase 2';
    else if (!ok2) st.why = 'phase 1 is up; phase 2: no matching selectors (local / remote subnets must mirror the other side) or proposal';
    else { st.p2 = true; st.up = true; st.sel = { src: sel(ok2['src-subnet']), dst: sel(ok2['dst-subnet']) }; }
    L._vpn[k] = st;
  });
}
/** SSL-VPN (remote access) login from FortiClient */
function fgSslLogin(L, cl, gw, port, user, pass) {
  const r = send(L, cl.id, { dst: gw, proto: 'tcp', dport: +port || 443 });
  if (r.res !== 'ok') return { ok: false, why: r.res === 'refused' ? `the gateway refused the connection on port ${port} (wrong port?)` : `cannot reach ${gw}:${port} – ${r.why || r.res}` };
  const fw = L.devs[r.at]; if (fw?.kind !== 'fw' || !fgSslOn(fw)) return { ok: false, why: 'no SSL-VPN on that address' };
  const s = fw.cfg['vpn ssl settings']; if (+(s.port?.[0] ?? 443) !== (+port || 443)) return { ok: false, why: `the gateway refused the connection on port ${port}` };
  const u = fw.cfg['user local'][user]; if (!u || u.passwd?.[0] !== pass || (u.status ?? ['enable'])[0] === 'disable') return { ok: false, why: 'Permission denied: username or password incorrect (-455)' };
  const rules = Object.values(s['authentication-rule'] || {}); const grp = rules.find((ru) => (ru.groups || []).some((g) => (fw.cfg['user group'][g]?.member || []).includes(user)) || (ru.users || []).includes(user));
  if (!grp) return { ok: false, why: 'Permission denied: you are not in a group with an SSL-VPN portal (authentication rule)' };
  const pool = fgSslPool(fw); if (!pool) return { ok: false, why: 'no tunnel IP pool configured' };
  const used = Object.values(L.devs).filter((x) => x.ssl?.up && x.ssl.fw === fw.id).length; const ip = n2ip(ip2n(pool.start) + used);
  const portal = fw.cfg['vpn ssl web portal'][grp.portal?.[0]] || {}; const split = (portal['split-tunneling'] ?? ['enable'])[0] === 'enable';
  const nets = split ? (portal['split-tunneling-routing-address'] || []).map((a) => fgNet(fw.cfg['firewall address'][a]?.subnet)) : [['0.0.0.0', '0.0.0.0']];
  cl.ssl = { fw: fw.id, ip, user, up: true, nets, gw };
  return { ok: true, ip, nets };
}

// ---------------------------------------------------------------- the FortiOS console
const FG_Q = new Set(['name', 'srcintf', 'dstintf', 'srcaddr', 'dstaddr', 'service', 'schedule', 'interface', 'member', 'members', 'alias', 'comment', 'comments', 'groups', 'users', 'phase1name', 'device', 'extintf', 'mappedip', 'default-portal', 'portal', 'tunnel-ip-pools', 'source-interface', 'source-address', 'split-tunneling-routing-address', 'hostname', 'hosts', 'remote-gw', 'local-gw', 'psksecret', 'passwd', 'dns-server1', 'dns-server2', 'server', 'servercert', 'vdom', 'tcp-portrange', 'udp-portrange', 'fqdn', 'description']);
const FG_KEYS = {
  'system interface': ['ip', 'allowaccess', 'alias', 'role', 'type', 'vlanid', 'interface', 'status', 'mode', 'vdom', 'description', 'dhcp-relay-service', 'dhcp-relay-ip', 'mtu-override', 'mtu', 'device-identification', 'secondary-IP'],
  'system zone': ['interface', 'intrazone', 'description'],
  'router static': ['dst', 'gateway', 'device', 'distance', 'status', 'blackhole', 'comment', 'priority'],
  'firewall address': ['subnet', 'type', 'start-ip', 'end-ip', 'fqdn', 'comment', 'associated-interface', 'interface'],
  'firewall addrgrp': ['member', 'comment'],
  'firewall service custom': ['tcp-portrange', 'udp-portrange', 'protocol', 'category', 'comment', 'icmptype'],
  'firewall service group': ['member', 'comment'],
  'firewall policy': ['name', 'srcintf', 'dstintf', 'srcaddr', 'dstaddr', 'action', 'service', 'schedule', 'nat', 'status', 'logtraffic', 'comments', 'groups', 'users', 'ippool', 'poolname', 'utm-status', 'inspection-mode', 'ssl-ssh-profile', 'av-profile', 'webfilter-profile', 'ips-sensor', 'application-list'],
  'firewall vip': ['extip', 'mappedip', 'extintf', 'portforward', 'protocol', 'extport', 'mappedport', 'comment', 'type'],
  'firewall ippool': ['startip', 'endip', 'type'],
  'vpn ipsec phase1-interface': ['interface', 'remote-gw', 'psksecret', 'proposal', 'ike-version', 'dhgrp', 'peertype', 'net-device', 'mode-cfg', 'type', 'local-gw', 'dpd', 'nattraversal', 'keylife', 'comments', 'authmethod'],
  'vpn ipsec phase2-interface': ['phase1name', 'proposal', 'src-subnet', 'dst-subnet', 'pfs', 'dhgrp', 'keylifeseconds', 'auto-negotiate', 'replay', 'comments'],
  'system dhcp server': ['interface', 'default-gateway', 'netmask', 'dns-service', 'dns-server1', 'dns-server2', 'domain', 'lease-time', 'status', 'ntp-service'],
  'user local': ['type', 'passwd', 'status', 'email-to', 'two-factor'],
  'user group': ['member', 'group-type'],
  'system snmp community': ['name', 'status', 'query-v2c-status', 'trap-v2c-status', 'events'],
  'system admin': ['accprofile', 'password', 'trusthost1', 'vdom'],
  'vpn ssl web portal': ['tunnel-mode', 'web-mode', 'split-tunneling', 'split-tunneling-routing-address', 'ip-pools'],
  'log syslogd filter': ['severity', 'forward-traffic'],
  'system netflow': ['collector-ip', 'collector-port', 'source-ip', 'active-flow-timeout'],
  'system global': ['hostname', 'timezone', 'admintimeout', 'admin-sport', 'admin-ssh-port', 'alias'],
  'system dns': ['primary', 'secondary', 'domain'],
  'vpn ssl settings': ['servercert', 'tunnel-ip-pools', 'source-interface', 'source-address', 'port', 'default-portal', 'dns-server1', 'idle-timeout'],
  'log syslogd setting': ['status', 'server', 'port', 'facility', 'mode'],
  'system ntp': ['ntpsync', 'type', 'syncinterval', 'server-mode'],
  'system settings': ['opmode', 'gui-multiple-interface-policy'],
  'log setting': ['fwpolicy-implicit-log', 'local-in-allow'],
  'ip-range': ['start-ip', 'end-ip'], 'reserved-address': ['ip', 'mac', 'description'], hosts: ['ip', 'ha-direct', 'host-type'], 'authentication-rule': ['groups', 'users', 'portal', 'source-interface', 'source-address'],
};
const FG_REF = { srcintf: 'if', dstintf: 'if', interface: 'if', device: 'if', extintf: 'if', 'associated-interface': 'if', srcaddr: 'addr', dstaddr: 'addr', 'split-tunneling-routing-address': 'addr', 'source-address': 'addr', service: 'svc', groups: 'grp', phase1name: 'p1', 'tunnel-ip-pools': 'addr', 'source-interface': 'if', portal: 'portal', 'default-portal': 'portal' };
function fgShell(L, d) {
  const S = { stack: [], flowFilter: null };
  const host = () => d.cfg['system global'].hostname?.[0] || d.hostname;
  const top = () => S.stack[S.stack.length - 1];
  const prompt = () => { const t = top(); if (!t) return `${host()} # `; if (t.entry != null) return `${host()} (${t.entry}) # `; return `${host()} (${t.label}) # `; };
  const tableOf = (path) => (FG_TABLES.includes(path) ? 'table' : FG_SETTINGS.includes(path) ? 'set' : null);
  const quote = (k, v) => (FG_Q.has(k) || /\s/.test(v) ? `"${v}"` : v);
  const words = (line) => { const out = []; let cur = '', q = null; for (const ch of line) { if (q) { if (ch === q) { q = null; continue; } cur += ch; continue; } if (ch === '"' || ch === "'") { q = ch; continue; } if (/\s/.test(ch)) { if (cur) out.push(cur); cur = ''; continue; } cur += ch; } if (cur) out.push(cur); return out; };
  const ifNames = () => fgIfList(d).map(([n]) => n).concat(Object.keys(d.cfg['system zone']), ['any', 'ssl.root']);
  const addrNames = () => ['all', ...Object.keys(d.cfg['firewall address']), ...Object.keys(d.cfg['firewall addrgrp']), ...Object.keys(d.cfg['firewall vip'])];
  const svcNames = () => [...Object.keys(FG_SVC), ...Object.keys(d.cfg['firewall service custom']), ...Object.keys(d.cfg['firewall service group'])];
  const refOk = (k, v) => { const r = FG_REF[k]; if (!r) return true; if (r === 'if') return ifNames().includes(v); if (r === 'addr') return addrNames().includes(v); if (r === 'svc') return svcNames().includes(v); if (r === 'grp') return Object.keys(d.cfg['user group']).includes(v); if (r === 'p1') return Object.keys(d.cfg['vpn ipsec phase1-interface']).includes(v); if (r === 'portal') return Object.keys(d.cfg['vpn ssl web portal']).includes(v) || ['full-access', 'tunnel-access', 'web-access'].includes(v); return true; };
  const changed = () => { settle(L, 'nodhcp'); };
  const fmtEntry = (path, name, e, ind) => { const sp = ' '.repeat(ind); let o = `${sp}edit ${/^\d+$/.test(name) ? name : `"${name}"`}\n`; Object.entries(e).forEach(([k, v]) => { if (v && typeof v === 'object' && !Array.isArray(v)) { o += `${sp}    config ${k}\n${Object.entries(v).map(([n2, e2]) => fmtEntry(k, n2, e2, ind + 8)).join('')}${sp}    end\n`; return; } o += `${sp}    set ${k} ${v.map((x) => quote(k, x)).join(' ')}\n`; }); return o + `${sp}next\n`; };
  const showPath = (path, only) => { const t = tableOf(path); const c = d.cfg[path]; if (t === 'set') return `config ${path}\n${Object.entries(c).map(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? `    config ${k}\n${Object.entries(v).map(([n2, e2]) => fmtEntry(k, n2, e2, 8)).join('')}    end\n` : `    set ${k} ${v.map((x) => quote(k, x)).join(' ')}\n`)).join('')}end\n`; return `config ${path}\n${fgTable(d, path).filter(([n]) => !only || n === only).map(([n, e]) => fmtEntry(path, n, e, 4)).join('')}end\n`; };
  function run(raw) {
    const line = raw.trim(); if (!line) return '';
    if (line.endsWith('?')) return help(line.slice(0, -1).trim());
    const w = words(line); const c = w[0].toLowerCase(); const t = top();
    if (t) {
      if (c === 'end') { const ni = S.stack.map((x) => !!x.nested).lastIndexOf(true); if (ni >= 0) { S.stack.length = ni; changed(); return ''; } while (S.stack.length && !S.stack[S.stack.length - 1].root) S.stack.pop(); if (S.stack.length) { const r = S.stack.pop(); } changed(); return ''; }
      if (c === 'abort') { S.stack.length = 0; return ''; }
      if (c === 'show' && w.length === 1) { if (t.entry != null) return fmtEntry(t.path, t.entry, t.obj, 0); if (t.kind === 'set') return showPath(t.path); return `config ${t.path}\n${(t.nested ? Object.entries(t.obj) : fgTable(d, t.path)).map(([n, e]) => fmtEntry(t.path, n, e, 4)).join('')}end\n`; }
      if (c === 'get' && w.length === 1) { if (t.entry != null || t.kind === 'set') { const e = t.entry != null ? t.obj : d.cfg[t.path]; return Object.entries(e).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${pad(k, 22)}: ${v.join(' ')}`).join('\n') + '\n'; } return `== [ ${Object.keys(t.obj).join(' ]\n== [ ')} ]\n`; }
      if (t.entry == null && t.kind === 'table') {
        if (c === 'edit') { let n = w[1]; if (n == null) return 'command parse error before \'edit\'\nCommand fail. Return code -61\n'; if (/policy|static|dhcp server|snmp community|ip-range|reserved-address|authentication-rule|hosts/.test(t.path) && n === '0') { n = String(Math.max(0, ...Object.keys(t.obj).map(Number).filter((x) => !isNaN(x))) + 1); } const isNew = !t.obj[n]; t.obj[n] ??= t.path === 'system interface' ? { vdom: ['root'], type: ['vlan'] } : t.path === 'firewall policy' ? { schedule: ['always'] } : {}; S.stack.push({ path: t.path, kind: 'entry', entry: n, obj: t.obj[n], parent: t }); return isNew && /policy|static/.test(t.path) && w[1] === '0' ? `new entry '${n}' added\n` : ''; }
        if (c === 'delete') { const n = w[1]; if (!t.obj[n]) return 'entry not found in datasource\n\nvalue parse error before \'' + n + '\'\nCommand fail. Return code -3\n'; const used = fgUsedBy(d, t.path, n); if (used) return `The entry is used by other ${used} entries\nCommand fail. Return code -23\n`; delete t.obj[n]; changed(); return ''; }
        if (c === 'move') { const [, a, pos, b] = w; if (!t.obj[a] || !t.obj[b] || !['before', 'after'].includes(pos)) return 'command parse error before \'move\'\nCommand fail. Return code -61\n'; fgMove(d, t.path, a, pos, b); changed(); return ''; }
        if (c === 'next') return '';
        if (c === 'purge') { Object.keys(t.obj).forEach((k) => delete t.obj[k]); changed(); return ''; }
        return `command parse error before '${w[0]}'\nCommand fail. Return code -61\n`;
      }
      const obj = t.entry != null ? t.obj : d.cfg[t.path];
      const keyPath = t.entry != null && t.sub ? t.sub : t.path;
      if (c === 'next') { if (t.entry == null) return ''; S.stack.pop(); changed(); return ''; }
      if (c === 'config' && t.entry != null) { const sub = w[1]; if (!(FG_SUB[t.path] || []).includes(sub)) return `command parse error before '${sub}'\nCommand fail. Return code -61\n`; obj[sub] ??= {}; S.stack.push({ path: sub, kind: 'table', obj: obj[sub], label: sub, nested: true }); return ''; }
      if (c === 'config' && t.kind === 'set') { const sub = w[1]; if (!(FG_SUB[t.path] || []).includes(sub)) return `command parse error before '${sub}'\nCommand fail. Return code -61\n`; obj[sub] ??= {}; S.stack.push({ path: sub, kind: 'table', obj: obj[sub], label: sub, nested: true }); return ''; }
      if (c === 'set' || c === 'append' || c === 'select' || c === 'unselect') {
        const k = w[1], v = w.slice(2); const keys = FG_KEYS[t.path] || [];
        if (!k || !keys.includes(k)) return `command parse error before '${k || ''}'\nCommand fail. Return code -61\n`;
        if (!v.length && c === 'set') return `command parse error before '${k}'\nCommand fail. Return code -61\n`;
        for (const x of v) if (!refOk(k, x)) return `entry not found in datasource\n\nvalue parse error before '${x}'\nCommand fail. Return code -3\n`;
        if (['ip', 'subnet', 'dst', 'src-subnet', 'dst-subnet'].includes(k) && !(v[0].includes('/') ? isIp(v[0].split('/')[0]) : isIp(v[0]) && (v.length === 1 && k === 'ip' ? false : !v[1] || isIp(v[1])))) return `value parse error before '${v.join(' ')}'\nCommand fail. Return code -8\n`;
        if (k === 'ip' && t.path === 'system interface' && v[1] && !isMask(v[1])) return `invalid netmask\nvalue parse error before '${v[1]}'\nCommand fail. Return code -8\n`;
        if (k === 'ip' && t.path === 'system interface') { const [ip, m] = v[0].includes('/') ? [cidr(v[0]).ip, cidr(v[0]).mask] : v; const clash = fgIfList(d).find(([n, e]) => n !== t.entry && fgIpOf(e)[0] && (sameNet(fgIpOf(e)[0], ip, m) || sameNet(fgIpOf(e)[0], ip, fgIpOf(e)[1]))); if (clash) return `${t.entry}: IP address in the same subnet as the others.\nnode_check_object fail! for ip ${ip} ${m}\n\nvalue parse error before '${m}'\nCommand fail. Return code -54\n`; }
        if (c === 'set') obj[k] = v; else if (c === 'append' || c === 'select') obj[k] = [...new Set([...(obj[k] || []), ...v])]; else obj[k] = (obj[k] || []).filter((x) => !v.includes(x));
        if (t.path === 'system global' && k === 'hostname') d.hostname = v[0];
        return '';
      }
      if (c === 'unset') { delete obj[w[1]]; return ''; }
      return `command parse error before '${w[0]}'\nCommand fail. Return code -61\n`;
    }
    if (c === 'config') { const path = w.slice(1).join(' '); const k = tableOf(path); if (!k) return `command parse error before '${w[1] || ''}'\nCommand fail. Return code -61\n`; S.stack.push({ path, kind: k, obj: d.cfg[path], label: path.split(' ').pop().replace(/^phase1-interface$/, 'phase1-interface').replace(/^policy$/, 'policy'), root: true }); return ''; }
    if (c === 'show') { if (w[1] === 'full-configuration' || w.length === 1) return [...FG_SETTINGS, ...FG_TABLES].filter((p) => Object.keys(d.cfg[p] || {}).length).map((p) => showPath(p)).join(''); const rest = w.slice(1); for (let i = rest.length; i > 0; i--) { const p = rest.slice(0, i).join(' '); if (tableOf(p)) return showPath(p, rest[i]); } return `command parse error before '${w[1]}'\nCommand fail. Return code -61\n`; }
    if (c === 'get') return fgGet(L, d, w.slice(1).join(' '));
    if (c === 'diagnose' || c === 'diag') return fgDiag(L, d, w.slice(1), S);
    if (c === 'execute' || c === 'exec') return fgExec(L, d, w.slice(1));
    if (c === 'exit') return '\n(connection closed)\n';
    return `Unknown action 0\nCommand fail. Return code -1\n`;
  }
  function help(line) { const t = top(); if (!t) return 'config      Configure object.\nget         Get dynamic and system information.\nshow        Show configuration.\ndiagnose    Diagnose facility.\nexecute     Execute static commands.\nexit        Exit the CLI.\n'; if (t.kind === 'table' && t.entry == null) return `delete    Delete an entry.\nedit      Edit an entry (edit 0 = next free number).\nmove      Move an entry (move 3 before 1).\nend       Save and exit.\nshow      Show the entries.\n\n${Object.keys(t.obj).map((n) => `<${n}>`).join('  ')}\n`; return `set       Modify a value.\nunset     Set to default value.\nappend    Add to a list.\nshow      Show this entry.\nnext      Save this entry and go back.\nend       Save and exit.\n\nkeys: ${(FG_KEYS[t.path] || []).join(', ')}\n`; }
  return { kind: 'forti', prompt, run, title: () => `${host()} – FortiGate CLI`, S };
}
/** Is an object referenced by policies, routes or groups */
function fgUsedBy(d, path, n) {
  const P = fgTable(d, 'firewall policy');
  if (path === 'firewall address' || path === 'firewall vip' || path === 'firewall addrgrp') return P.some(([, p]) => [...(p.srcaddr || []), ...(p.dstaddr || [])].includes(n)) ? 'firewall policy' : fgTable(d, 'firewall addrgrp').some(([, g]) => (g.member || []).includes(n)) ? 'addrgrp' : null;
  if (path === 'system interface' || path === 'vpn ipsec phase1-interface') return P.some(([, p]) => [...(p.srcintf || []), ...(p.dstintf || [])].includes(n)) ? 'firewall policy' : fgTable(d, 'router static').some(([, r]) => (r.device || []).includes(n)) ? 'router static' : null;
  return null;
}
function fgGet(L, d, w) {
  const h = d.cfg['system global'].hostname?.[0] || d.hostname;
  if (/^system status/.test(w)) return `Version: FortiGate-60F v7.4.4,build2662,240514 (GA.F)\nFirmware Signature: certified\nVirus-DB: 92.08410(2026-10-21 09:00)\nIPS-DB: 28.00876(2026-10-20 18:05)\nSerial-Number: FGT60FTK2209${String(Math.abs(ip2n(d.mac.replace(/:/g, '').slice(0, 8).match(/../g).map((x) => parseInt(x, 16)).join('.')) % 100000)).padStart(5, '0')}\nBIOS version: 05000028\nLog hard disk: Not available\nHostname: ${h}\nOperation Mode: NAT\nCurrent virtual domain: root\nMax number of virtual domains: 10\nVirtual domain configuration: disable\nFIPS-CC mode: disable\nCurrent HA mode: standalone\nBranch point: 2662\nRelease Version Information: GA\nSystem time: Wed Oct 21 09:${String(15 + ((L.clock / 60000) | 0) % 44).padStart(2, '0')}:12 2026\n`;
  if (/^system interface( physical)?/.test(w)) return fgIfList(d).filter(([, c]) => c.type?.[0] !== 'tunnel' || !/physical/.test(w)).map(([n, c]) => { const [ip, m] = fgIpOf(c); const up = c.type?.[0] === 'tunnel' ? L._vpn?.[`${d.id}|${n}`]?.up : linkUp(L, d.id, c.type?.[0] === 'vlan' ? c.interface?.[0] : n); return /physical/.test(w) ? `        ==[${n}]\n                mode: static\n                ip: ${ip || '0.0.0.0'} ${m || '0.0.0.0'}\n                ipv6: ::/0\n                status: ${up ? 'up' : 'down'}\n                speed: ${up ? '1000Mbps (Duplex: full)' : 'n/a'}` : `== [ ${n} ]\nname: ${n}   mode: static    ip: ${ip || '0.0.0.0'} ${m || '0.0.0.0'}   status: ${(c.status ?? ['up'])[0]}    netbios-forward: disable    type: ${c.type?.[0] || 'physical'}   ${c.vlanid ? `vlanid: ${c.vlanid[0]}   interface: ${c.interface?.[0]}   ` : ''}allowaccess: ${(c.allowaccess || []).join(' ')}`; }).join('\n') + '\n';
  if (/^router info routing-table/.test(w)) { const R = routesOf(L, d); return `Codes: K - kernel, C - connected, S - static, R - RIP, B - BGP\n       O - OSPF, IA - OSPF inter area\n       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2\n       E1 - OSPF external type 1, E2 - OSPF external type 2\n       i - IS-IS, L1 - IS-IS level-1, L2 - IS-IS level-2, ia - IS-IS inter area\n       V - BGP VPNv4\n       * - candidate default\n\nRouting table for VRF=0\n${R.map((r) => r.type === 'C' ? `C       ${r.net}/${mask2len(r.mask)} is directly connected, ${r.ifn}` : r.blackhole ? `S       ${r.net}/${mask2len(r.mask)} [${r.ad}/0] is a summary, Null` : `S${r.net === '0.0.0.0' ? '*' : ' '}      ${r.net}/${mask2len(r.mask)} [${r.ad}/0] ${r.via ? `via ${r.via}, ${r.ifn}` : `is directly connected, ${r.ifn}`}`).join('\n')}\n`; }
  if (/^system arp/.test(w)) return `Address           Age(min)   Hardware Addr      Interface\n${Object.entries(L.arp[d.id] || {}).filter(([, x]) => x.mac).map(([ip, x]) => `${pad(ip, 18)}${pad(0, 11)}${pad(x.mac, 19)}${x.ifn}`).join('\n')}\n`;
  if (/^vpn ipsec tunnel summary/.test(w)) return fgTunnels(d).map((t) => { const s = L._vpn?.[`${d.id}|${t.name}`]; return `'${t.name}' ${t['remote-gw']?.[0]}:0  selectors(total,up): ${s?.p1 ? 1 : 0}/${s?.up ? 1 : 0}  rx(pkt,err): ${s?.up ? 4182 : 0}/0  tx(pkt,err): ${s?.up ? 4199 : 0}/${s?.p1 && !s.up ? 12 : 0}`; }).join('\n') + '\n';
  if (/^system performance status/.test(w)) return `CPU states: 1% user 2% system 0% nice 97% idle 0% iowait 0% irq 0% softirq\nMemory: 1923812k total, 812312k used (42.2%), 1012040k free (52.6%), 99460k freeable (5.2%)\nAverage network usage: 1840 / 2213 kbps in 1 minute\nAverage sessions: ${40 + (d.tlog || []).length} sessions in 1 minute\nUptime: 21 days,  4 hours,  12 minutes\n`;
  if (/^system ha status/.test(w)) return 'HA Health Status: OK\nModel: FortiGate-60F\nMode: standalone\n';
  if (/^user local/.test(w)) return Object.keys(d.cfg['user local']).map((u) => `== [ ${u} ]\nname: ${u}`).join('\n') + '\n';
  return `command parse error before '${w.split(' ')[0]}'\nCommand fail. Return code -61\n`;
}
function fgDiag(L, d, w, S) {
  const j = w.join(' ');
  if (/^vpn tunnel list/.test(j)) return 'list all ipsec tunnel in vd 0\n' + fgTunnels(d).map((t) => { const s = L._vpn?.[`${d.id}|${t.name}`] || {}; const loc = fgIpOf(fgIf(d, t.interface?.[0]))[0]; return `------------------------------------------------------\nname=${t.name} ver=${t['ike-version']?.[0] ?? 1} serial=1 ${loc}:0->${t['remote-gw']?.[0]}:0 tun_id=${t['remote-gw']?.[0]} dst_mtu=1500 dpd-link=on\nbound_if=5 lgwy=static/1 tun=intf mode=auto/1 encap=none/552 options[0228]=npu frag-rfc  run_state=0 role=primary accept_traffic=1 overlay_id=0\n\nproxyid_num=${s.p1 ? 1 : 0} child_num=0 refcnt=${s.up ? 4 : 3} ilast=2 olast=2 ad=/0\nstat: rxp=${s.up ? 4182 : 0} txp=${s.up ? 4199 : 0} rxb=${s.up ? 602208 : 0} txb=${s.up ? 352716 : 0}\ndpd: mode=on-demand on=1 idle=20000ms retry=3 count=0 seqno=${s.p1 ? 211 : 0}\nnatt: mode=none draft=0 interval=0 remote_port=0\n${s.p1 ? `proxyid=${t.name} proto=0 sa=${s.up ? 1 : 0} ref=2 serial=1 auto-negotiate\n  src: 0:${s.sel?.src || '0.0.0.0/0.0.0.0'}:0\n  dst: 0:${s.sel?.dst || '0.0.0.0/0.0.0.0'}:0\n${s.up ? '  SA:  ref=3 options=10226 type=00 soft=0 mtu=1438 expire=41213/0B replaywin=2048\n       seqno=1068 esn=0 replaywin_lastseq=00001066 itn=0 qat=0 hash_search_len=1\n  life: type=01 bytes=0/0 timeout=42897/43200\n  dec: spi=b2e4c612 esp=aes key=32 ...\n  enc: spi=7a1d9f30 esp=aes key=32 ...' : '  (no SA – phase 2 is not up)'}\n` : `(phase 1 not up: ${s.why || 'negotiating'})\n`}`; }).join('');
  if (/^vpn ike gateway list/.test(j)) return fgTunnels(d).map((t) => { const s = L._vpn?.[`${d.id}|${t.name}`] || {}; return `\nvd: root/0\nname: ${t.name}\nversion: ${t['ike-version']?.[0] === '2' ? 2 : 1}\ninterface: ${t.interface?.[0]} 5\naddr: ${fgIpOf(fgIf(d, t.interface?.[0]))[0]}:500 -> ${t['remote-gw']?.[0]}:500\ncreated: 1452s ago\n${s.p1 ? `IKE SA: created 1/1  established 1/1  time 10/10/10 ms\nIPsec SA: created ${s.up ? 1 : 0}/${s.up ? 1 : 0}  established ${s.up ? 1 : 0}/${s.up ? 1 : 0}` : `IKE SA: created 1/14  established 0/0\n  (negotiation failing: ${s.why})`}`; }).join('\n') + '\n';
  if (/^debug flow filter addr/.test(j)) { S.flowFilter = w[4]; return ''; }
  if (/^debug flow filter clear/.test(j) || /^debug reset/.test(j)) { S.flowFilter = null; d.flowOn = 0; d.flowBuf = []; return ''; }
  if (/^debug flow trace start/.test(j)) { d.flowOn = +(w[4] || 10); d.flowBuf = []; return ''; }
  if (/^debug flow show/.test(j)) return '';
  if (/^debug enable/.test(j)) { d.flowShow = true; return '(debug output appears here as traffic passes – generate traffic from a PC console, then come back)\n'; }
  if (/^debug disable/.test(j)) { d.flowShow = false; return ''; }
  if (/^sniffer packet/.test(j)) { const f = (j.match(/'([^']*)'|"([^"]*)"/) || [])[1] || (j.match(/"([^"]*)"/) || [])[1] || ''; const m = f.match(/host\s+(\S+)/); const L2 = (d.tlog || []).slice(-15).filter((x) => !m || x.src === m[1] || x.dst === m[1]); return `interfaces=[${w[2] || 'any'}]\nfilters=[${f}]\n${L2.map((x, i) => `${(L.clock / 1000 + i * 0.13).toFixed(6)} ${x.srcintf} in ${x.src}${x.proto === 'icmp' ? '' : '.' + (49152 + i)} -> ${x.dst}${x.proto === 'icmp' ? ': icmp: echo request' : `.${x.dport}: ${x.proto === 'tcp' ? 'syn ' + (283741 + i) : 'udp 32'}`}${x.action === 'accept' ? `\n${(L.clock / 1000 + i * 0.13 + 0.0004).toFixed(6)} ${x.dstintf} out ${x.src} -> ${x.dst}` : ''}`).join('\n')}\n${L2.length} packets received by filter\n0 packets dropped by kernel\n`; }
  if (/^sys session list/.test(j)) return (d.tlog || []).filter((x) => x.action === 'accept').slice(-6).map((x, i) => `session info: proto=${{ icmp: 1, tcp: 6, udp: 17 }[x.proto]} proto_state=01 duration=${12 + i} expire=${3588 - i} timeout=3600 flags=00000000 socktype=0 sockport=0 av_idx=0 use=3\norigin-shaper=\nhook=post dir=org act=snat ${x.src}:${50000 + i}->${x.dst}:${x.dport || 8}(${x.dstintf})\nhook=pre dir=reply act=dnat ${x.dst}:${x.dport || 8}->${x.src}:${50000 + i}(${x.srcintf})\npolicy_id=${x.policyid}\n`).join('\n') + `total session ${(d.tlog || []).filter((x) => x.action === 'accept').length}\n`;
  if (/^sys top/.test(j)) return 'Run Time:  21 days, 4 hours and 12 minutes\n0U, 0N, 1S, 99I, 0WA, 0HI, 0SI, 0ST; 1923T, 1012F\n      ipsengine      312      S <     0.2     4.9\n      httpsd         221      S       0.1     1.6\n';
  return `command parse error before '${w[0] || ''}'\nCommand fail. Return code -61\n`;
}
function fgExec(L, d, w) {
  const j = w.join(' ');
  if (w[0] === 'ping') { const dst = w[1]; if (!dst) return 'command parse error before \'ping\'\n'; const ip = isIp(dst) ? dst : L.inet.names[dst.toLowerCase()]; if (!ip) return `Unable to resolve hostname.\n`; let ok = 0, o = `PING ${ip} (${ip}): 56 data bytes\n`; for (let i = 0; i < 5; i++) { const r = send(L, d.id, { dst: ip, src: d.pingSrc || undefined }); if (r.res === 'ok') { ok++; o += `64 bytes from ${ip}: icmp_seq=${i} ttl=${ttlOf(L, r.at) - r.hops.length + 1} time=${(0.4 + r.hops.length * 4.1).toFixed(1)} ms\n`; } } return o + `\n--- ${ip} ping statistics ---\n5 packets transmitted, ${ok} packets received, ${100 - ok * 20}% packet loss\n${ok ? 'round-trip min/avg/max = 0.4/1.2/4.6 ms\n' : ''}`; }
  if (w[0] === 'ping-options' && w[1] === 'source') { d.pingSrc = w[2]; return ''; }
  if (w[0] === 'traceroute') { const ip = isIp(w[1]) ? w[1] : L.inet.names[(w[1] || '').toLowerCase()]; if (!ip) return 'Unable to resolve hostname.\n'; const r = send(L, d.id, { dst: ip }); return `traceroute to ${ip} (${ip}), 32 hops max, 3 probe packets per hop, 84 byte packets\n${r.hops.map((h, i) => ` ${i + 1}  ${h.ip}  ${(0.5 + i * 3).toFixed(3)} ms  ${(0.6 + i * 3).toFixed(3)} ms  ${(0.5 + i * 3).toFixed(3)} ms`).join('\n')}${r.res !== 'ok' ? `\n ${r.hops.length + 1}  * * *` : ''}\n`; }
  if (/^log filter/.test(j)) { d.logFilter = j; return ''; }
  if (/^log display/.test(j)) { const T = (d.tlog || []).slice(-20); return `${T.length} logs found.\n${T.length} logs returned.\n\n${T.map((x, i) => `${i + 1}: date=2026-10-21 time=09:${String(10 + i).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')} eventtime=17614${i} logid="00000130${x.action === 'deny' ? '13' : '00'}" type="traffic" subtype="forward" level="${x.action === 'deny' ? 'warning' : 'notice'}" vd="root" srcip=${x.src} srcintf="${x.srcintf}" dstip=${x.dst} dstport=${x.dport ?? 0} dstintf="${x.dstintf}" proto=${{ icmp: 1, tcp: 6, udp: 17 }[x.proto]} action="${x.action}" policyid=${x.policyid}${x.action === 'deny' ? ` msg="${x.why}"` : ''}`).join('\n')}\n`; }
  if (/^dhcp lease-list/.test(j)) return Object.entries(d.dhcpBind || {}).map(([m, ip]) => `${pad(fgTable(d, 'system dhcp server').map(([, s]) => s.interface?.[0]).find((x) => x) || 'port2', 12)}\n  IP\t\t\tMAC-Address\t\tHostname\tVCI\tSSID\tAP\tSERVER-ID\tExpiry\n  ${ip}\t\t${m}\t\t\t\t\t\t1\t\tThu Oct 22 09:14:22 2026`).join('\n') + '\n';
  if (/^backup config/.test(j)) return 'Please wait...\n\nConnect to tftp server ...\nSend config file to tftp server OK.\n';
  if (/^reboot/.test(j)) return 'This operation will reboot the system !\nDo you want to continue? (y/n)y\n\nSystem is rebooting...\n';
  if (/^vpn ipsec tunnel up/.test(j)) { settle(L, 'nodhcp'); return ''; }
  return `command parse error before '${w[0] || ''}'\nCommand fail. Return code -61\n`;
}
