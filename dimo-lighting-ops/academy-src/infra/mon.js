// =================== Monitoring & packet analysis: realistic captures (Wireshark), a LibreNMS-style monitor (ICMP, SNMP, services, events, syslog, NetFlow)
// ---------------------------------------------------------------- captures: every real conversation becomes the packets Wireshark would show
// Lesson checks (L._probe) and the background work inside settle are not captured – only what the engineer does.
const _sendRaw = send, _settleRaw = settle;
settle = function (L, why) { L._inSettle = (L._inSettle || 0) + 1; try { return _settleRaw(L, why); } finally { L._inSettle--; } };
send = function (L, from, pkt, o = {}) {
  const r = _sendRaw(L, from, pkt, o);
  if (!L._probe && !L._inSettle && !o.noCap && !o.reply) { try { capSession(L, from, pkt, r); flowNote(L, from, pkt, r); } catch (e) { console.warn(e); } }
  return r;
};
capHop = function () {};
const _capAddRaw = capAdd;
capAdd = function (L, dev, p) { if (L._probe) return; _capAddRaw(L, dev, p); };
const CAP_APP = { 80: 'HTTP', 8080: 'HTTP', 443: 'TLSv1.3', 10443: 'TLSv1.3', 445: 'SMB2', 139: 'NBSS', 88: 'KRB5', 389: 'LDAP', 636: 'TLSv1.2', 3268: 'LDAP', 22: 'SSH', 3389: 'RDP', 25: 'SMTP', 587: 'SMTP', 3306: 'MySQL', 1433: 'TDS', 5985: 'HTTP', 21: 'FTP', 23: 'TELNET', 554: 'RTSP' };
const CAP_UDP = { 161: 'SNMP', 162: 'SNMP', 514: 'Syslog', 123: 'NTP', 500: 'ISAKMP', 4500: 'ESP', 69: 'TFTP', 2055: 'CFLOW', 5060: 'SIP', 1812: 'RADIUS' };
function capSession(L, from, pkt, r) {
  const path = [from, ...(r.hops || []).map((h) => h.dev)]; const at = r.at || path[path.length - 1];
  const points = [...new Set(path.concat(at ? [at] : []))].filter((x) => L.cap.on[x]); if (!points.length) return;
  const proto = pkt.proto || 'icmp'; if (proto === 'udp' && (pkt.dport === 53 || pkt.dport === 67)) return;
  const src = r.pkt?.src && path[0] === from ? pkt.src || r.pkt.src : pkt.src; const s0 = pkt.src || (r.hops?.length ? null : null) || srcOf(L, from, pkt.dst);
  const sp = pkt.sport || 49152 + ((L.clock / 7) | 0) % 16000; const dp = pkt.dport;
  const F = []; const add = (dir, p) => F.push({ dir, ...p });
  // ARP for the first hop, once per capture
  const nh = r.hops?.[0]; const seen = (L.cap.arp ??= {});
  if (nh && !seen[`${from}|${nh.ip}`]) { seen[`${from}|${nh.ip}`] = 1; add('out', { proto: 'ARP', src: macOf(from), dst: 'Broadcast', info: `Who has ${nh.ip}? Tell ${s0}`, len: 42 }); add('in', { proto: 'ARP', src: macOf(nh.dev), dst: macOf(from), info: `${nh.ip} is at ${L.devs[nh.dev]?.mac || macOf(nh.dev)}`, len: 60 }); }
  const ok = r.res === 'ok', back = r.res === 'refused';
  if (proto === 'icmp') {
    const id = 1 + (L.clock & 0xff), seq = (L.cap.seq = (L.cap.seq || 0) + 1);
    add('out', { proto: 'ICMP', info: `Echo (ping) request  id=0x${id.toString(16).padStart(4, '0')}, seq=${seq}/${seq * 256}, ttl=${pkt.ttl || 128}${ok ? ` (reply in next)` : ' (no response found!)'}`, len: 74, icmp: 8 });
    if (ok) add('in', { proto: 'ICMP', info: `Echo (ping) reply    id=0x${id.toString(16).padStart(4, '0')}, seq=${seq}/${seq * 256}, ttl=${ttlOf(L, at)}`, len: 74, icmp: 0, dt: 2 });
    else if (/^unreach/.test(r.res)) add('in', { proto: 'ICMP', src: r.by, info: `Destination unreachable (${r.res === 'unreach-net' ? 'Network unreachable' : r.res === 'unreach-adm' ? 'Communication administratively filtered' : 'Host unreachable'})`, len: 102, icmp: 3, dt: 3000 });
    else if (r.res === 'ttl') add('in', { proto: 'ICMP', src: r.by, info: 'Time-to-live exceeded (Time to live exceeded in transit)', len: 102, icmp: 11 });
  } else if (proto === 'tcp') {
    const app = CAP_APP[dp] || 'TCP'; const T = (fl, dir, extra = {}) => add(dir, { proto: 'TCP', flags: fl, info: `${dir === 'out' ? sp : dp} → ${dir === 'out' ? dp : sp} [${fl.join(', ')}] Seq=${extra.seq ?? 0}${fl.includes('ACK') ? ` Ack=${extra.ack ?? 1}` : ''} Win=${dir === 'out' ? 64240 : 65535} Len=0${fl.includes('SYN') ? ' MSS=1460 WS=256 SACK_PERM' : ''}`, len: fl.includes('SYN') ? 66 : 54, ...extra });
    T(['SYN'], 'out');
    if (back) T(['RST', 'ACK'], 'in', { dt: 1 });
    else if (!ok) { T(['SYN'], 'out', { dt: 1000, retrans: true, info: `[TCP Retransmission] ${sp} → ${dp} [SYN] Seq=0 Win=64240 Len=0 MSS=1460` }); T(['SYN'], 'out', { dt: 2000, retrans: true, info: `[TCP Retransmission] ${sp} → ${dp} [SYN] Seq=0 Win=64240 Len=0 MSS=1460` }); }
    else {
      T(['SYN', 'ACK'], 'in', { dt: 2 }); T(['ACK'], 'out', { seq: 1, ack: 1 });
      const msg = capApp(L, app, dp, pkt, at); msg.forEach(([dir, info, len]) => add(dir, { proto: app, info, len, data: true, dt: dir === 'in' ? 4 : 1 }));
      T(['FIN', 'ACK'], 'out', { seq: 400, ack: 1200, dt: 20 }); T(['FIN', 'ACK'], 'in', { seq: 1200, ack: 401 }); T(['ACK'], 'out', { seq: 401, ack: 1201 });
    }
  } else if (proto === 'udp') {
    const app = CAP_UDP[dp] || 'UDP'; const info = { SNMP: ['get-request 1.3.6.1.2.1.1.3.0', 'get-response 1.3.6.1.2.1.1.3.0'], Syslog: [`LOCAL7.NOTICE: ${L.devs[from]?.hostname}: message`], NTP: ['NTP Version 4, client', 'NTP Version 4, server'], ISAKMP: ['IKE_SA_INIT MID=00 Initiator Request', 'IKE_SA_INIT MID=00 Responder Response'], CFLOW: ['IPFIX flow (2 records)'], TFTP: ['Write Request, File: config', 'Acknowledgement, Block: 0'] }[app] || [`${sp} → ${dp} Len=48`];
    add('out', { proto: app, info: info[0], len: 90 }); if (ok && info[1]) add('in', { proto: app, info: info[1], len: 110, dt: 3 }); else if (back) add('in', { proto: 'ICMP', src: at && L.devs[at] ? srcOf(L, at, s0) : pkt.dst, info: 'Destination unreachable (Port unreachable)', len: 118, icmp: 3 });
  }
  // the addresses each capture point sees (after NAT on the far side)
  const near = { src: s0, dst: pkt.dst }, far = { src: r.pkt?.src || s0, dst: r.pkt?.dst || pkt.dst };
  F.forEach((f) => { tick(L, f.dt ?? 1); points.forEach((x) => { const side = x === from || (r.nat || []).every((n) => path.indexOf(n.dev) >= path.indexOf(x)) ? near : far; const a = f.dir === 'out' ? side.src : side.dst, b = f.dir === 'out' ? side.dst : side.src; if (f.proto === 'ARP' && x !== from) return; _capAddRaw(L, x, { src: f.src || a, dst: f.dst || b, proto: f.proto, sport: f.proto === 'ARP' ? null : f.dir === 'out' ? sp : dp, dport: f.proto === 'ARP' ? null : f.dir === 'out' ? dp : sp, l4: f.proto === 'ARP' ? 'arp' : f.proto === 'ICMP' ? 'icmp' : proto, flags: f.flags, info: f.info, len: f.len, retrans: !!f.retrans, icmp: f.icmp, data: f.data }); }); });
}
const srcOf = (L, dev, dst) => { const d = L.devs[dev]; const r = lookup(L, d, dst); return (r?.ep ?? l3ifs(L, d).find((x) => x.ip && x.up))?.ip || '0.0.0.0'; };
function capApp(L, app, dp, pkt, at) {
  const D = L.devs[at]; const host = pkt.host || D?.hostname || '';
  if (app === 'HTTP') { const pg = D && typeof httpServe === 'function' ? httpServe(L, D, 'http', host, dp) : null; return [['out', `GET / HTTP/1.1  (Host: ${host})`, 420], ['in', pg && !pg.err ? 'HTTP/1.1 200 OK  (text/html)' : 'HTTP/1.1 502 Bad Gateway', 1180]]; }
  if (/TLS/.test(app)) return [['out', `Client Hello (SNI=${host})`, 571], ['in', 'Server Hello, Change Cipher Spec, Application Data', 1514], ['out', 'Change Cipher Spec, Application Data', 134], ['in', 'Application Data', 920]];
  if (app === 'SMB2') return [['out', 'Negotiate Protocol Request', 260], ['in', 'Negotiate Protocol Response', 330], ['out', 'Session Setup Request, NTLMSSP_NEGOTIATE', 220], ['in', 'Session Setup Response, Error: STATUS_MORE_PROCESSING_REQUIRED', 400], ['out', 'Session Setup Request, NTLMSSP_AUTH', 600], ['in', 'Session Setup Response', 130], ['out', `Tree Connect Request Tree: \\\\${pkt.dst}\\IPC$`, 160], ['in', 'Tree Connect Response', 138]];
  if (app === 'KRB5') return [['out', 'AS-REQ', 290], ['in', 'KRB Error: KRB5KDC_ERR_PREAUTH_REQUIRED', 250], ['out', 'AS-REQ', 370], ['in', 'AS-REP', 1600], ['out', 'TGS-REQ', 1500], ['in', 'TGS-REP', 1550]];
  if (app === 'LDAP') return [['out', 'searchRequest(1) "<ROOT>" baseObject', 320], ['in', 'searchResEntry(1) "<ROOT>"  | searchResDone(1) success', 2600]];
  if (app === 'SSH') return [['in', 'Server: Protocol (SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13)', 95], ['out', 'Client: Protocol (SSH-2.0-OpenSSH_for_Windows_9.5)', 90], ['out', 'Client: Key Exchange Init', 1500], ['in', 'Server: Key Exchange Init', 1100], ['out', 'Client: Encrypted packet (len=64)', 118]];
  if (app === 'RDP') return [['out', 'Cookie: mstshash=admin, Negotiate Request', 101], ['in', 'Negotiate Response', 73], ['out', 'Client Hello', 300], ['in', 'Server Hello', 1500]];
  return [['out', `${dp} [PSH, ACK] Len=120`, 174], ['in', `[PSH, ACK] Len=380`, 434]];
}
// ---------------------------------------------------------------- NetFlow: who talks to whom through each device (user traffic plus the lab's background flows)
function flowNote(L, from, pkt, r) { if (r.res !== 'ok') return; const path = [from, ...(r.hops || []).map((h) => h.dev)]; path.forEach((x) => { const k = `${x}|${pkt.src || srcOf(L, from, pkt.dst)}|${pkt.dst}|${pkt.proto}|${pkt.dport || 0}`; (L.flows ??= {})[k] = (L.flows[k] || 0) + ({ tcp: 18000, udp: 400, icmp: 296 }[pkt.proto] || 300); }); }
function flowTop(L, dev) {
  const rows = {};
  Object.entries(L.flows || {}).forEach(([k, b]) => { const [x, s, d, p, dp] = k.split('|'); if (x !== dev) return; const kk = `${s}|${d}|${p}|${dp}`; rows[kk] = (rows[kk] || 0) + b; });
  (L.bg || []).forEach((f) => { const t = _sendRaw(L, f.from, { dst: f.dst, proto: f.proto || 'tcp', dport: f.dport }, { noCap: true }); if (t.res !== 'ok') return; if (![f.from, ...t.hops.map((h) => h.dev)].includes(dev)) return; const kk = `${srcOf(L, f.from, f.dst)}|${f.dst}|${f.proto || 'tcp'}|${f.dport}`; rows[kk] = (rows[kk] || 0) + f.mbps * 1e6 / 8 * 300; });
  return Object.entries(rows).map(([k, b]) => { const [s, d, p, dp] = k.split('|'); return { src: s, dst: d, proto: p, dport: +dp, bytes: b }; }).sort((a, b) => b.bytes - a.bytes);
}
// ---------------------------------------------------------------- Wireshark
function capFields(p) {
  const P = String(p.proto || '').toLowerCase(); const l4 = p.l4 || (p.dhcp || p.dns ? 'udp' : P === 'tcp' ? 'tcp' : P === 'icmp' ? 'icmp' : '');
  const name = p.dhcp ? 'DHCP' : p.dns ? 'DNS' : P === 'udp' ? 'UDP' : P === 'tcp' ? 'TCP' : p.proto;
  return { name, l4, f: { 'ip.src': p.src, 'ip.dst': p.dst, 'ip.addr': [p.src, p.dst], 'tcp.port': l4 === 'tcp' ? [p.sport, p.dport] : null, 'udp.port': l4 === 'udp' ? [p.sport, p.dport] : null, 'tcp.srcport': l4 === 'tcp' ? p.sport : null, 'tcp.dstport': l4 === 'tcp' ? p.dport : null, 'udp.srcport': l4 === 'udp' ? p.sport : null, 'udp.dstport': l4 === 'udp' ? p.dport : null, 'tcp.flags.syn': (p.flags || []).includes('SYN') ? 1 : 0, 'tcp.flags.ack': (p.flags || []).includes('ACK') ? 1 : 0, 'tcp.flags.reset': (p.flags || []).includes('RST') ? 1 : 0, 'tcp.flags.fin': (p.flags || []).includes('FIN') ? 1 : 0, 'icmp.type': p.icmp, 'frame.len': p.len || 60, 'dns.qry.name': p.dns ? (String(p.info).match(/A (\S+)/) || [])[1] : null },
    protos: new Set([l4, P, name.toLowerCase(), p.dhcp ? 'bootp' : '', p.dns ? 'dns' : '', l4 === 'tcp' || l4 === 'udp' || l4 === 'icmp' ? 'ip' : '', p.retrans ? 'tcp.analysis.retransmission' : '', /tls/i.test(name) ? 'tls' : '', /smb/i.test(name) ? 'smb2' : '', /krb/i.test(name) ? 'kerberos' : '', p.dns && /No such name/.test(p.info) ? 'dns.nxdomain' : ''].filter(Boolean)) };
}
/** Display filter → predicate (Wireshark syntax subset: field == value, !=, contains, and/or/not, && || !, parentheses, bare protocol names) */
function capFilter(txt) {
  const s = txt.trim(); if (!s) return () => true;
  const toks = s.match(/"[^"]*"|==|!=|>=|<=|&&|\|\||[()!<>]|[\w.:\-/]+/g) || []; let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const val = (t) => (t?.startsWith('"') ? t.slice(1, -1) : t);
  const prim = () => {
    const t = next(); if (t == null) throw new Error('unexpected end');
    if (t === '(') { const e = or(); if (next() !== ')') throw new Error('missing )'); return e; }
    if (t === '!' || t === 'not') { const e = prim(); return (p) => !e(p); }
    const op = peek();
    if (['==', '!=', '>', '<', '>=', '<=', 'eq', 'ne', 'contains'].includes(op)) { next(); const v = val(next()); if (v == null) throw new Error('value expected'); return (p) => { const F = capFields(p); if (!(t in F.f)) return false; const x = F.f[t]; const arr = Array.isArray(x) ? x : [x]; const cmp = (a) => { if (a == null) return false; const A = String(a).toLowerCase(), V = String(v).toLowerCase(); if (op === 'contains') return A.includes(V); const n = !isNaN(+a) && !isNaN(+v); if (op === '==' || op === 'eq') return A === V; if (op === '!=' || op === 'ne') return A !== V; if (!n) return false; return op === '>' ? +a > +v : op === '<' ? +a < +v : op === '>=' ? +a >= +v : +a <= +v; }; return op === '!=' || op === 'ne' ? arr.every((a) => a == null || cmp(a)) && arr.some((a) => a != null) : arr.some(cmp); }; }
    const KNOWN = ['tcp', 'udp', 'icmp', 'arp', 'dns', 'dhcp', 'bootp', 'http', 'tls', 'smb2', 'smb', 'kerberos', 'krb5', 'ldap', 'ssh', 'snmp', 'syslog', 'ntp', 'isakmp', 'rdp', 'ip', 'tcp.analysis.retransmission', 'dns.nxdomain'];
    if (!KNOWN.includes(t.toLowerCase()) && !/^(ip|tcp|udp|icmp|frame|dns)\./.test(t)) throw new Error(`"${t}" is neither a field nor a protocol name.`);
    return (p) => { const F = capFields(p); const k = t.toLowerCase(); if (F.protos.has(k) || (k === 'smb' && F.protos.has('smb2')) || (k === 'krb5' && F.protos.has('kerberos'))) return true; return t in F.f && F.f[t] != null && F.f[t] !== 0; };
  };
  const and = () => { let e = prim(); while (['&&', 'and'].includes(peek())) { next(); const a = e, b = prim(); e = (p) => a(p) && b(p); } return e; };
  const or = () => { let e = and(); while (['||', 'or'].includes(peek())) { next(); const a = e, b = and(); e = (p) => a(p) || b(p); } return e; };
  const e = or(); if (i < toks.length) throw new Error(`unexpected "${toks[i]}"`); return e;
}
const CAP_COL = (p, F) => (p.retrans || (p.flags || []).includes('RST') ? '#2b2b2b;color:#ff6b6b' : F.l4 === 'tcp' && (p.flags || []).some((f) => f === 'SYN' || f === 'FIN') ? '#a0a0a0' : F.l4 === 'tcp' ? '#e7e6ff' : F.name === 'ARP' ? '#faf0d7' : F.name === 'ICMP' ? (p.icmp === 3 || p.icmp === 11 ? '#2b2b2b;color:#ffd166' : '#fce0ff') : F.name === 'DNS' || F.name === 'DHCP' || F.l4 === 'udp' ? '#daeeff' : '#fff');
function guiShark(el, L, d, done) {
  const st = ((APP.shark ??= {})[d.id] ??= { f: '', sel: null });
  const on = !!L.cap.on[d.id]; const mine = L.cap.pkts.filter((p) => p.dev === d.id);
  let pred, bad = '';
  try { pred = capFilter(st.f); } catch (e) { pred = () => true; bad = e.message; }
  const shown = bad ? mine : mine.filter(pred); const t0 = mine[0]?.t || 0;
  const sel = shown.find((p) => p.no === st.sel);
  const detail = (p) => { const F = capFields(p); const l = [`Frame ${p.no}: ${p.len || 60} bytes on wire, captured on ${d.hostname}`]; if (F.name !== 'ARP') l.push(`Ethernet II, Src: ${macOf(p.src)}, Dst: ${macOf(p.dst)}`, `Internet Protocol Version 4, Src: ${p.src}, Dst: ${p.dst}`); else l.push('Ethernet II, Address Resolution Protocol'); if (F.l4 === 'tcp') l.push(`Transmission Control Protocol, Src Port: ${p.sport}, Dst Port: ${p.dport}, Flags: ${(p.flags || ['ACK']).join(', ')}${p.retrans ? '   [Expert Info (Note/Sequence): This frame is a (suspected) retransmission]' : ''}`); if (F.l4 === 'udp') l.push(`User Datagram Protocol, Src Port: ${p.sport ?? 49800}, Dst Port: ${p.dport ?? ''}`); if (!['TCP', 'UDP'].includes(F.name)) l.push(`${F.name}: ${p.info}`); return l; };
  el.innerHTML = `<div class="gui" style="padding:8px"><div class="tb"><b>🦈 Wireshark</b> <span class="m">${esc(d.hostname)} · ${esc(Object.keys(d.nics || {})[0] || 'eth0')}</span><button class="btn sm ${on ? '' : 'p'}" id="kOn">${on ? '■ Stop' : '▶ Start capture'}</button><button class="btn sm" id="kClr">Clear</button>${on ? '<span class="pill g">capturing…</span>' : ''}</div>
  <div class="tb"><input id="kF" value="${esc(st.f)}" placeholder="Apply a display filter … e.g. ip.addr == 10.10.10.10 && tcp" style="flex:1;min-width:220px;padding:5px 8px;border:1px solid var(--line);border-radius:5px;font-family:var(--mono);background:${!st.f ? '#fff' : bad ? '#ffd5d5' : '#d7f5d7'}"><button class="btn sm" id="kGo">Apply</button></div>${bad ? `<p class="bad" style="font-size:12px">${esc(bad)}</p>` : ''}
  <div style="max-height:260px;overflow:auto;border:1px solid var(--line)"><table class="mono" style="font-size:11.5px;width:100%;border-collapse:collapse"><tr style="position:sticky;top:0;background:#eee"><th>No.</th><th>Time</th><th>Source</th><th>Destination</th><th>Protocol</th><th>Length</th><th style="text-align:left">Info</th></tr>${shown.slice(-400).map((p) => { const F = capFields(p); return `<tr data-pk="${p.no}" style="cursor:pointer;background:${p.no === st.sel ? '#3875d7;color:#fff' : CAP_COL(p, F)}"><td>${p.no}</td><td>${(p.t - t0).toFixed(6)}</td><td>${esc(p.src)}</td><td>${esc(p.dst)}</td><td>${esc(F.name)}</td><td>${p.len || 60}</td><td style="text-align:left;white-space:nowrap">${esc(p.info || `${p.sport ?? ''} → ${p.dport ?? ''}`)}</td></tr>`; }).join('')}</table></div>
  ${sel ? `<pre class="mono" style="font-size:11.5px;background:#f6f6f6;border:1px solid var(--line);padding:6px;margin-top:6px;white-space:pre-wrap">${detail(sel).map((x) => `▸ ${esc(x)}`).join('\n')}</pre>` : ''}
  <p class="m" style="font-size:11.5px">Packets: ${mine.length} · Displayed: ${shown.length}${on ? '' : ' · Start the capture, then do something on this computer (ping, browse, sign in…) and come back.'}</p></div>`;
  $('#kOn', el).onclick = () => { L.cap.on[d.id] = !on; if (!on) L.cap.arp = {}; L.cmdlog.push({ dev: d.id, kind: 'shark', line: on ? 'stop' : 'start', t: L.clock }); done(); };
  $('#kClr', el).onclick = () => { L.cap.pkts = L.cap.pkts.filter((p) => p.dev !== d.id); L.cap.arp = {}; st.sel = null; done(); };
  const ap = () => { st.f = $('#kF', el).value; L.cmdlog.push({ dev: d.id, kind: 'shark', line: `filter ${st.f}`, t: L.clock }); guiShark(el, L, d, done); };
  $('#kGo', el).onclick = ap; $('#kF', el).onkeydown = (e) => { if (e.key === 'Enter') ap(); };
  $$('[data-pk]', el).forEach((r) => (r.onclick = () => { st.sel = +r.dataset.pk; guiShark(el, L, d, done); }));
}
// ---------------------------------------------------------------- the monitor (LibreNMS style) – polls on every settle
const nmsIp = (L, n) => l3ifs(L, n).find((e) => e.ip && !e.loop)?.ip;
const devByIp = (L, ip) => Object.values(L.devs).find((x) => l3ifs(L, x).some((e) => e.ip === ip));
function snmpCommunityOk(L, D, comm, from) {
  if (!D) return false;
  if (D.kind === 'sw' || D.kind === 'rt') return !!D.snmp?.community && D.snmp.community === comm;
  if (D.kind === 'fw') return fgTable(D, 'system snmp community').some(([, c]) => (c.status ?? ['enable'])[0] === 'enable' && c.name?.[0] === comm && Object.values(c.hosts || {}).some((h) => (h.ip?.[0] || '').split(/[\s/]/)[0] === from));
  if (D.os === 'linux') return D.units?.snmpd?.active === 'active' && (D.snmpComm || 'public') === comm;
  return false;
}
function nmsPoll(L, N) {
  const me = nmsIp(L, N); if (!me || N.off) return;
  const M = N.nms; M.last ??= {}; M.events ??= []; M.syslog ??= [];
  const ev = (host, sev, msg) => { M.events.push({ t: L.clock, host, sev, msg }); if (M.events.length > 200) M.events.shift(); };
  M.hosts.forEach((h) => {
    const D = devByIp(L, h.ip); const icmp = _sendRaw(L, N.id, { dst: h.ip }, { noCap: true }).res === 'ok';
    let snmp = null; if (h.snmp) { const t = _sendRaw(L, N.id, { dst: h.ip, proto: 'udp', dport: 161 }, { noCap: true }); snmp = t.res === 'ok' && snmpCommunityOk(L, D, h.community, me); }
    const ports = {}; if (snmp && D) { if (D.kind === 'sw') Object.entries(D.ports).forEach(([pn, p]) => (ports[pn] = p.err ? 'err-disabled' : p.shut ? 'admin down' : linkUp(L, D.id, pn) ? 'up' : 'down')); if (D.kind === 'rt') Object.keys(D.ifs).forEach((pn) => (ports[pn] = D.ifs[pn].shut ? 'admin down' : linkUp(L, D.id, pn) ? 'up' : 'down')); if (D.kind === 'fw') fgTable(D, 'system interface').forEach(([pn, c]) => (ports[pn] = c.status?.[0] === 'down' ? 'admin down' : linkUp(L, D.id, c.type?.[0] === 'vlan' ? c.interface?.[0] : pn) ? 'up' : 'down')); }
    const svcs = {}; (h.checks || []).forEach((c) => { const [proto, port] = { http: ['tcp', 80], https: ['tcp', 443], dns: ['udp', 53], smb: ['tcp', 445], ssh: ['tcp', 22], ldap: ['tcp', 389], rdp: ['tcp', 3389] }[c] || []; if (proto) svcs[c] = _sendRaw(L, N.id, { dst: h.ip, proto, dport: port }, { noCap: true }).res === 'ok'; });
    const cpu = D && L._storm && [...L._storm].some((k) => k.startsWith(`${D.id}|`)) ? 99 : D?.cpuHog ? D.cpuHog : 4 + (h.ip.split('.').pop() % 9);
    const disk = D?.os === 'linux' && typeof lxDf === 'function' ? lxDf(D) : D?.diskPct ?? null;
    const now = { icmp, snmp, ports, svcs, cpu, disk, at: L.clock, name: h.name || D?.hostname || h.ip }; const was = M.last[h.ip];
    if (was) {
      if (was.icmp && !icmp) ev(now.name, 'critical', 'Device down – no ping response'); if (!was.icmp && icmp) ev(now.name, 'ok', 'Device up – ping restored');
      if (was.snmp && snmp === false) ev(now.name, 'warning', 'SNMP not responding (timeout or wrong community)'); if (was.snmp === false && snmp) ev(now.name, 'ok', 'SNMP responding');
      Object.entries(ports).forEach(([pn, s]) => { if (was.ports?.[pn] && was.ports[pn] !== s && (s !== 'down' || was.ports[pn] === 'up')) ev(now.name, s === 'up' ? 'ok' : 'warning', `Port ${pn} changed: ${was.ports[pn]} → ${s}`); });
      Object.entries(svcs).forEach(([c, ok]) => { if (was.svcs?.[c] !== undefined && was.svcs[c] !== ok) ev(now.name, ok ? 'ok' : 'critical', `Service ${c.toUpperCase()} ${ok ? 'recovered' : 'is DOWN'}`); });
      if (cpu >= 90 && (was.cpu ?? 0) < 90) ev(now.name, 'critical', `Processor usage ${cpu}%`);
    } else ev(now.name, 'info', `Device added (${h.snmp ? `SNMP v2c, community ${h.community}` : 'ICMP only'}${(h.checks || []).length ? `, checks: ${h.checks.join(', ')}` : ''})`);
    M.last[h.ip] = now;
  });
  // syslog: devices that point their logging at this server
  const send514 = (D) => _sendRaw(L, D.id, { dst: me, proto: 'udp', dport: 514 }, { noCap: true }).res === 'ok';
  Object.values(L.devs).forEach((D) => {
    const target = D.kind === 'sw' || D.kind === 'rt' ? D.syslog : D.kind === 'fw' ? ((D.cfg['log syslogd setting']?.status?.[0] === 'enable') && D.cfg['log syslogd setting']?.server?.[0]) : null; if (target !== me) return;
    const fresh = L.log.filter((x) => x.dev === D.id && !(x._sl ??= {})[N.id]); const tl = D.kind === 'fw' ? (D.tlog || []).filter((x) => !(x._sl ??= {})[N.id]) : [];
    if (!fresh.length && !tl.length) return; const ok = send514(D);
    fresh.forEach((x) => { x._sl[N.id] = 1; if (ok) M.syslog.push({ t: x.t, host: D.hostname, msg: x.msg }); });
    tl.forEach((x) => { x._sl[N.id] = 1; if (ok) M.syslog.push({ t: x.t, host: D.hostname, msg: `type="traffic" subtype="forward" srcip=${x.src} dstip=${x.dst} dstport=${x.dport ?? 0} srcintf="${x.srcintf}" dstintf="${x.dstintf}" action="${x.action}" policyid=${x.policyid}` }); });
    if (M.syslog.length > 300) M.syslog.splice(0, M.syslog.length - 300);
  });
}
SETTLE_HOOKS.push((L) => Object.values(L.devs).filter((d) => d.nms).forEach((N) => nmsPoll(L, N)));
const nmsTime = (t) => { const s = 9 * 3600 + Math.floor(t / 1000); return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
/** Active problems (what the Alerts page lists) */
function nmsProblems(L, N) {
  const out = []; Object.values(N.nms.last || {}).forEach((h) => {
    if (!h.icmp) out.push({ host: h.name, sev: 'critical', msg: 'Device down' });
    if (h.snmp === false) out.push({ host: h.name, sev: 'warning', msg: 'SNMP not responding' });
    Object.entries(h.ports || {}).forEach(([pn, s]) => { if (s === 'err-disabled') out.push({ host: h.name, sev: 'critical', msg: `Port ${pn} err-disabled` }); });
    Object.entries(h.svcs || {}).forEach(([c, ok]) => { if (!ok) out.push({ host: h.name, sev: 'critical', msg: `${c.toUpperCase()} check failing` }); });
    if (h.cpu >= 90) out.push({ host: h.name, sev: 'critical', msg: `Processor ${h.cpu}%` });
    if (h.disk != null && h.disk >= 90) out.push({ host: h.name, sev: 'warning', msg: `Disk ${h.disk}% used` });
  });
  return out;
}
function guiNms(el, L, d, done) {
  const st = ((APP.nms ??= {})[d.id] ??= { pg: 'over', host: null, q: '' }); const M = d.nms; const redraw = () => guiNms(el, L, d, done);
  const S = (h) => (!h ? '<span class="pill n">…</span>' : !h.icmp ? '<span class="pill r">Down</span>' : h.snmp === false ? '<span class="pill r">SNMP fail</span>' : '<span class="pill g">Up</span>');
  const sevc = { critical: 'r', warning: 'r', ok: 'g', info: 'n' };
  const tabs = [['over', 'Overview'], ['dev', 'Devices'], ['add', '+ Add device'], ['alerts', `Alerts (${nmsProblems(L, d).length})`], ['ev', 'Event log'], ['sys', 'Syslog'], ['flow', 'Flows']];
  let h = '';
  if (st.pg === 'over') { const P = nmsProblems(L, d); h = `<div class="grid3"><div class="card" style="padding:10px"><b>Devices</b><p style="font-size:22px;margin:4px 0">${M.hosts.length}</p><span class="m">${Object.values(M.last || {}).filter((x) => x.icmp).length} up</span></div><div class="card" style="padding:10px"><b>Alerts</b><p style="font-size:22px;margin:4px 0;color:${P.length ? '#b4232f' : '#2e9d57'}">${P.length}</p></div><div class="card" style="padding:10px"><b>Syslog messages</b><p style="font-size:22px;margin:4px 0">${M.syslog.length}</p></div></div><p style="margin-top:8px"><b>Recent events</b></p><table>${M.events.slice(-8).reverse().map((e) => `<tr><td class="m">${nmsTime(e.t)}</td><td>${esc(e.host)}</td><td><span class="pill ${sevc[e.sev]}">${e.sev}</span> ${esc(e.msg)}</td></tr>`).join('') || '<tr><td class="m">No events yet</td></tr>'}</table>`; }
  if (st.pg === 'dev') {
    const H = M.hosts.find((x) => x.ip === st.host); const last = H && M.last[H.ip];
    if (H) h = `<div class="tb"><button class="btn sm" id="nBack">← Devices</button> <b>${esc(last?.name || H.ip)}</b> ${S(last)} <span class="mono m">${esc(H.ip)}</span><button class="btn sm" id="nDel">Delete device</button></div><table><tr><td>Polling</td><td>${H.snmp ? `SNMP v2c · community <code>${esc(H.community)}</code> · ${last?.snmp ? 'responding' : '<span class="bad">no response</span>'}` : 'ICMP only'}</td></tr><tr><td>Processor</td><td>${last ? `${last.cpu}%` : ''}</td></tr>${last?.disk != null ? `<tr><td>Disk /</td><td>${last.disk}%</td></tr>` : ''}<tr><td>Service checks</td><td>${Object.entries(last?.svcs || {}).map(([c, ok]) => `<span class="pill ${ok ? 'g' : 'r'}">${c.toUpperCase()} ${ok ? 'OK' : 'DOWN'}</span>`).join(' ') || '—'}</td></tr></table>${Object.keys(last?.ports || {}).length ? `<p style="margin-top:8px"><b>Ports</b></p><table><tr><th>Port</th><th>Status</th><th>Traffic (5 min)</th></tr>${Object.entries(last.ports).map(([pn, s]) => { const b = flowTop(L, devByIp(L, H.ip)?.id).length ? Math.round(Math.random() * 0) : 0; return `<tr><td>${esc(pn)}</td><td>${s === 'up' ? '<span class="ok">up</span>' : `<span class="${s === 'admin down' ? 'm' : 'bad'}">${esc(s)}</span>`}</td><td class="m">${s === 'up' ? `${(2 + (pn.length * 7) % 40) + b} Mbps` : ''}</td></tr>`; }).join('')}</table>` : H.snmp ? '<p class="m">No interface data – SNMP is not answering.</p>' : ''}`;
    else h = `<table><tr><th>Device</th><th>IP</th><th>Status</th><th>Polling</th><th>Checks</th><th></th></tr>${M.hosts.map((x) => { const l = M.last[x.ip]; return `<tr><td><b>${esc(l?.name || x.name || x.ip)}</b></td><td class="mono">${esc(x.ip)}</td><td>${S(l)}</td><td>${x.snmp ? `SNMP (${esc(x.community)})` : 'ICMP'}</td><td>${esc((x.checks || []).join(', '))}</td><td><button class="btn sm" data-h="${esc(x.ip)}">Open</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="m">No devices – add some.</td></tr>'}</table>`;
  }
  if (st.pg === 'add') h = `<div class="grid2" style="max-width:560px"><label class="f">Hostname or IP<input id="aIp" placeholder="10.10.10.2"></label><label class="f">Display name (optional)<input id="aN"></label><label class="f">Polling<select id="aT"><option value="snmp">SNMP v2c</option><option value="icmp">ICMP only (ping)</option></select></label><label class="f">SNMP community<input id="aC" placeholder="public"></label></div><p style="margin:6px 0 2px"><b>Service checks</b></p>${['http', 'https', 'dns', 'smb', 'ssh', 'ldap', 'rdp'].map((c) => `<label style="margin-right:10px"><input type="checkbox" data-c="${c}"> ${c.toUpperCase()}</label>`).join('')}<div class="tb" style="margin-top:8px"><button class="btn p" id="aAdd">Add device</button></div><div id="aErr"></div><p class="hint">LibreNMS tests SNMP when you add a device: it must answer UDP 161 with the same community. Network devices: SNMP. Servers: ICMP + service checks.</p>`;
  if (st.pg === 'alerts') { const P = nmsProblems(L, d); h = `<table><tr><th>Severity</th><th>Device</th><th>Alert</th></tr>${P.map((x) => `<tr><td><span class="pill ${sevc[x.sev]}">${x.sev}</span></td><td>${esc(x.host)}</td><td>${esc(x.msg)}</td></tr>`).join('') || '<tr><td colspan="3" class="ok">No active alerts ✔</td></tr>'}</table>`; }
  if (st.pg === 'ev') h = `<table><tr><th>Time</th><th>Device</th><th>Event</th></tr>${M.events.slice().reverse().slice(0, 80).map((e) => `<tr><td class="m">${nmsTime(e.t)}</td><td>${esc(e.host)}</td><td><span class="pill ${sevc[e.sev]}">${e.sev}</span> ${esc(e.msg)}</td></tr>`).join('')}</table>`;
  if (st.pg === 'sys') { const q = st.q.toLowerCase(); h = `<div class="tb"><input id="sQ" value="${esc(st.q)}" placeholder="filter text or host" style="padding:5px 7px;border:1px solid var(--line);border-radius:5px;width:240px"><button class="btn sm" id="sGo">Filter</button></div><table class="mono" style="font-size:11.5px"><tr><th>Time</th><th>Host</th><th style="text-align:left">Message</th></tr>${M.syslog.slice().reverse().filter((x) => !q || `${x.host} ${x.msg}`.toLowerCase().includes(q)).slice(0, 120).map((x) => `<tr><td>${nmsTime(x.t)}</td><td>${esc(x.host)}</td><td style="text-align:left">${esc(x.msg)}</td></tr>`).join('') || '<tr><td colspan="3" class="m">Nothing received. Point the devices\' logging at this server (UDP 514).</td></tr>'}</table>`; }
  if (st.pg === 'flow') { const me = nmsIp(L, d); const ex = Object.values(L.devs).filter((x) => (x.kind === 'fw' && x.cfg['system netflow']?.['collector-ip']?.[0] === me) || ((x.kind === 'rt' || x.kind === 'sw') && x.flowExport === me)).filter((x) => _sendRaw(L, x.id, { dst: me, proto: 'udp', dport: 2055 }, { noCap: true }).res === 'ok');
    h = ex.length ? ex.map((x) => { const T = flowTop(L, x.id).slice(0, 10); const tot = T.reduce((s, r) => s + r.bytes, 0) || 1; return `<p><b>Top talkers via ${esc(x.hostname)}</b> (last 5 minutes)</p><table><tr><th>Source</th><th>Destination</th><th>Service</th><th>Volume</th><th>Share</th></tr>${T.map((r) => `<tr><td class="mono">${esc(r.src)}</td><td class="mono">${esc(r.dst)}</td><td>${esc(r.proto.toUpperCase())}/${r.dport || ''}</td><td>${r.bytes > 1e6 ? `${(r.bytes / 1e6).toFixed(1)} MB` : `${Math.round(r.bytes / 1e3)} kB`}</td><td><div style="background:#2563a8;height:8px;width:${Math.max(2, Math.round((r.bytes / tot) * 120))}px"></div> ${Math.round((r.bytes / tot) * 100)}%</td></tr>`).join('')}</table>`; }).join('') : '<p class="m">No flow exporters. Configure NetFlow on the FortiGate (<code>config system netflow</code> → <code>set collector-ip …</code>) or a router (<code>ip flow-export destination …</code>).</p>'; }
  el.innerHTML = `<div class="gui"><h3>📈 LibreNMS – ${esc(d.hostname)}</h3><div class="tb">${tabs.map(([k, t]) => `<button class="btn sm ${st.pg === k ? 'p' : ''}" data-np="${k}">${t}</button>`).join('')}<button class="btn sm" id="nPoll" title="Poll now">⟳ Poll now</button></div>${h}</div>`;
  $$('[data-np]', el).forEach((b) => (b.onclick = () => { st.pg = b.dataset.np; st.host = null; redraw(); }));
  $('#nPoll', el).onclick = () => { tick(L, 300000); settle(L, 'nodhcp'); done(); redraw(); };
  $$('[data-h]', el).forEach((b) => (b.onclick = () => { st.host = b.dataset.h; redraw(); }));
  const nb = $('#nBack', el); if (nb) nb.onclick = () => { st.host = null; redraw(); };
  const nd = $('#nDel', el); if (nd) nd.onclick = () => { M.hosts = M.hosts.filter((x) => x.ip !== st.host); delete M.last[st.host]; st.host = null; L.cmdlog.push({ dev: d.id, kind: 'nms', line: 'delete device', t: L.clock }); done(); redraw(); };
  if (st.pg === 'sys') { const go = () => { st.q = $('#sQ', el).value.trim(); redraw(); }; $('#sGo', el).onclick = go; $('#sQ', el).onkeydown = (e) => { if (e.key === 'Enter') go(); }; }
  if (st.pg === 'add') $('#aAdd', el).onclick = () => {
    const ip = $('#aIp', el).value.trim(), snmp = $('#aT', el).value === 'snmp', comm = $('#aC', el).value.trim() || 'public'; const checks = $$('[data-c]', el).filter((c) => c.checked).map((c) => c.dataset.c);
    const fail = (m) => ($('#aErr', el).innerHTML = `<p class="bad">${esc(m)}</p>`);
    if (!isIp(ip)) return fail('Enter an IP address.'); if (M.hosts.some((x) => x.ip === ip)) return fail('Already monitored.');
    if (_sendRaw(L, d.id, { dst: ip }, { noCap: true }).res !== 'ok') return fail(`Could not ping ${ip} (Device ${ip} is unreachable). Add it anyway as ICMP only after you fix reachability.`);
    if (snmp && !(_sendRaw(L, d.id, { dst: ip, proto: 'udp', dport: 161 }, { noCap: true }).res === 'ok' && snmpCommunityOk(L, devByIp(L, ip), comm, nmsIp(L, d)))) return fail(`Could not connect to ${ip}, please check the snmp details and snmp reachability (SNMP v2c, community "${comm}").`);
    M.hosts.push({ ip, name: $('#aN', el).value.trim() || null, snmp, community: snmp ? comm : null, checks }); L.cmdlog.push({ dev: d.id, kind: 'nms', line: `add ${ip} ${snmp ? 'snmp ' + comm : 'icmp'} ${checks.join(',')}`, t: L.clock }); settle(L, 'nodhcp'); st.pg = 'dev'; done(); redraw();
  };
}
