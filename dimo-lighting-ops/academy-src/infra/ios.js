// =================== Cisco-style IOS console for switches and routers: modes, abbreviations, ?, show commands, configuration, save / reload
const IFL = { gi: 'GigabitEthernet', fa: 'FastEthernet', te: 'TenGigabitEthernet', po: 'Port-channel', vl: 'Vlan', lo: 'Loopback', se: 'Serial' };
/** g1/0/1, gig1/0/1, GigabitEthernet1/0/1 → Gi1/0/1 ; vlan 10 → Vlan10 */
function ifNorm(s) {
  s = String(s || '').trim(); const m = s.match(/^([a-z-]+)\s*([\d/.]+)$/i); if (!m) return null;
  const w = m[1].toLowerCase(), n = m[2];
  if ('vlan'.startsWith(w) && w.length >= 1 && w[0] === 'v') return `Vlan${n}`;
  if ('port-channel'.startsWith(w) && w.length >= 2) return `Po${n}`;
  if ('loopback'.startsWith(w) && w.length >= 2) return `Loopback${n}`;
  if (('gigabitethernet'.startsWith(w) && w.length >= 1 && w[0] === 'g')) return `Gi${n}`;
  if ('fastethernet'.startsWith(w) && w[0] === 'f') return `Fa${n}`;
  if ('tengigabitethernet'.startsWith(w) && w[0] === 't') return `Te${n}`;
  return null;
}
const ifLong = (s) => { const m = s.match(/^([A-Za-z]+)(.*)$/); if (!m) return s; const k = m[1].slice(0, 2).toLowerCase(); return (IFL[k] || m[1]) + m[2]; };
/** "g1/0/1 - 4 , g1/0/10" → ['Gi1/0/1','Gi1/0/2',…] */
function ifRange(s) {
  const out = []; String(s).split(',').forEach((part) => { part = part.trim(); const m = part.match(/^([a-z-]+\s*[\d/]*?)(\d+)\s*-\s*(\d+)$/i); if (m) { const base = ifNorm(m[1] + m[2]); if (!base) return; const pre = base.slice(0, base.length - m[2].length); for (let i = +m[2]; i <= +m[3]; i++) out.push(pre + i); } else { const n = ifNorm(part); if (n) out.push(n); } });
  return out;
}
const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);
/** Parse an ACL address: any | host x | x wildcard */
function aclAddr(t, i) { if (t[i] === 'any') return [{ any: true }, i + 1]; if (t[i] === 'host') return [{ host: t[i + 1] }, i + 2]; if (isIp(t[i]) && isIp(t[i + 1] || '')) return [{ net: t[i], wild: t[i + 1] }, i + 2]; if (isIp(t[i])) return [{ host: t[i] }, i + 1]; return [null, i]; }
const aclA = (x) => (x.any ? 'any' : x.host ? `host ${x.host}` : `${x.net} ${x.wild}`);
const PORTS = { www: 80, http: 80, https: 443, ssh: 22, telnet: 23, domain: 53, smtp: 25, ftp: 21, snmp: 161, ntp: 123, bootps: 67, tftp: 69, syslog: 514, 'isakmp': 500 };

// ---------------------------------------------------------------- the grammar: each command is a pattern; words match by unique prefix, <x> takes any value
const IOS_EXEC = [
  'enable', 'disable', 'exit', 'logout', 'configure terminal', 'show <rest>', 'ping <rest>', 'traceroute <rest>', 'copy running-config startup-config', 'copy startup-config running-config', 'copy running-config tftp:', 'copy running-config tftp: <rest>', 'copy startup-config tftp:', 'copy tftp: running-config', 'write memory', 'write', 'reload', 'erase startup-config', 'clear mac address-table dynamic', 'clear ip nat translation *', 'clear ip dhcp binding *', 'clear ip dhcp conflict *', 'clear ip ospf process', 'clear counters', 'clear logging', 'terminal length <n>', 'terminal monitor', 'help', 'test cable-diagnostics tdr interface <if>', 'debug <rest>', 'undebug all', 'ssh <rest>', 'telnet <rest>',
];
const IOS_SHOW = ['running-config', 'running-config interface <if>', 'startup-config', 'version', 'clock', 'vlan brief', 'vlan', 'interfaces status', 'interfaces trunk', 'interfaces status err-disabled', 'interfaces <if> switchport', 'interfaces <if>', 'interfaces counters errors', 'interfaces', 'mac address-table', 'mac address-table dynamic', 'mac address-table interface <if>', 'mac address-table vlan <n>', 'mac address-table address <w>', 'spanning-tree', 'spanning-tree summary', 'spanning-tree vlan <n>', 'spanning-tree interface <if>', 'spanning-tree blockedports', 'etherchannel summary', 'lacp neighbor', 'port-security', 'port-security interface <if>', 'port-security address', 'ip interface brief', 'ip interface <if>', 'ip route', 'ip route <ip>', 'ip ospf neighbor', 'ip ospf interface brief', 'ip ospf interface', 'ip protocols', 'ip dhcp binding', 'ip dhcp pool', 'ip dhcp conflict', 'ip dhcp snooping', 'ip dhcp snooping binding', 'ip nat translations', 'ip nat statistics', 'access-lists', 'ip access-lists', 'cdp neighbors', 'cdp neighbors detail', 'lldp neighbors', 'logging', 'power inline', 'errdisable recovery', 'arp', 'ip arp', 'snmp', 'ntp status', 'users', 'history', 'ip dhcp server statistics', 'interfaces description', 'ip helper-address'];
const IOS_CONF = [
  'hostname <w>', 'vlan <rest>', 'no vlan <rest>', 'interface range <rest>', 'interface <rest>', 'no interface <rest>', 'ip routing', 'no ip routing', 'ip route <ip> <ip> <w> <rest>', 'ip route <ip> <ip> <w>', 'no ip route <rest>', 'router ospf <n>', 'no router ospf <n>', 'ip dhcp pool <w>', 'no ip dhcp pool <w>', 'ip dhcp excluded-address <ip> <rest>', 'ip dhcp excluded-address <ip>', 'no ip dhcp excluded-address <rest>', 'ip dhcp snooping', 'no ip dhcp snooping', 'ip dhcp snooping vlan <rest>', 'no ip dhcp snooping vlan <rest>', 'ip dhcp snooping information option', 'no ip dhcp snooping information option',
  'ip nat inside source list <w> interface <rest>', 'ip nat inside source static <rest>', 'no ip nat inside source <rest>', 'access-list <n> <rest>', 'no access-list <n>', 'ip access-list extended <w>', 'ip access-list standard <w>', 'no ip access-list <rest>', 'spanning-tree mode <w>', 'spanning-tree vlan <rest>', 'no spanning-tree vlan <rest>', 'spanning-tree portfast bpduguard default', 'spanning-tree portfast default', 'no spanning-tree portfast bpduguard default', 'snmp-server community <w> <w>', 'snmp-server community <w>', 'no snmp-server community <w>', 'snmp-server host <ip> <rest>', 'snmp-server location <rest>', 'snmp-server contact <rest>', 'ip flow-export destination <ip> <n>', 'no ip flow-export destination <rest>', 'logging host <ip>', 'logging <ip>', 'no logging host <ip>', 'logging trap <w>', 'ntp server <ip>', 'no ntp server <ip>', 'errdisable recovery cause <w>', 'errdisable recovery interval <n>', 'enable secret <rest>', 'enable password <rest>', 'username <rest>', 'line <rest>', 'service password-encryption', 'ip domain-name <w>', 'ip domain name <w>', 'crypto key generate rsa <rest>', 'crypto key generate rsa', 'ip ssh version <n>', 'cdp run', 'no cdp run', 'lldp run', 'no lldp run', 'banner motd <rest>', 'ip name-server <rest>', 'ip default-gateway <ip>', 'clock timezone <rest>', 'do <rest>', 'end', 'exit', 'monitor session <rest>', 'no monitor session <rest>', 'ip dhcp relay information trust-all', 'ip http server', 'no ip http server', 'archive', 'power inline consumption default <n>',
];
const IOS_IF = [
  'description <rest>', 'no description', 'shutdown', 'no shutdown', 'switchport mode <w>', 'switchport access vlan <n>', 'no switchport access vlan', 'switchport trunk native vlan <n>', 'no switchport trunk native vlan', 'switchport trunk allowed vlan <rest>', 'no switchport trunk allowed vlan', 'switchport trunk encapsulation dot1q', 'switchport voice vlan <n>', 'no switchport voice vlan', 'switchport nonegotiate', 'switchport', 'no switchport', 'switchport port-security maximum <n>', 'switchport port-security mac-address sticky', 'switchport port-security mac-address <w>', 'switchport port-security violation <w>', 'switchport port-security aging <rest>', 'switchport port-security', 'no switchport port-security <rest>', 'no switchport port-security', 'spanning-tree portfast <rest>', 'spanning-tree portfast', 'no spanning-tree portfast', 'spanning-tree bpduguard <w>', 'no spanning-tree bpduguard', 'spanning-tree bpdufilter <w>', 'no spanning-tree bpdufilter', 'spanning-tree cost <n>', 'spanning-tree port-priority <n>', 'spanning-tree guard <w>', 'channel-group <n> mode <w>', 'no channel-group', 'ip dhcp snooping trust', 'no ip dhcp snooping trust', 'ip dhcp snooping limit rate <n>', 'ip address dhcp', 'ip address <ip> <ip> secondary', 'ip address <ip> <ip>', 'no ip address', 'encapsulation dot1q <n> native', 'encapsulation dot1q <n>', 'ip helper-address <ip>', 'no ip helper-address <rest>', 'ip nat inside', 'ip nat outside', 'no ip nat <w>', 'ip access-group <w> <w>', 'no ip access-group <rest>', 'ip ospf cost <n>', 'ip ospf hello-interval <n>', 'ip ospf dead-interval <n>', 'ip ospf <n> area <w>', 'no ip ospf <rest>', 'mtu <n>', 'ip mtu <n>', 'speed <w>', 'duplex <w>', 'power inline <w>', 'power inline static max <n>', 'storm-control broadcast level <rest>', 'no storm-control <rest>', 'mls qos trust <w>', 'auto qos voip <rest>', 'cdp enable', 'no cdp enable', 'udld <rest>', 'interface <rest>', 'interface range <rest>', 'do <rest>', 'end', 'exit', 'no shutdown vlan', 'load-interval <n>', 'negotiation auto',
];
const IOS_VLAN = ['name <rest>', 'no name', 'state <w>', 'do <rest>', 'end', 'exit'];
const IOS_OSPF = ['router-id <ip>', 'network <ip> <ip> area <w>', 'no network <ip> <ip> area <w>', 'passive-interface default', 'no passive-interface default', 'passive-interface <rest>', 'no passive-interface <rest>', 'default-information originate <rest>', 'default-information originate', 'no default-information originate', 'auto-cost reference-bandwidth <n>', 'log-adjacency-changes', 'redistribute <rest>', 'do <rest>', 'end', 'exit'];
const IOS_POOL = ['network <ip> <rest>', 'default-router <rest>', 'dns-server <rest>', 'domain-name <w>', 'lease <rest>', 'no network', 'no default-router', 'no dns-server', 'option <rest>', 'do <rest>', 'end', 'exit'];
const IOS_ACL = ['<n> <rest>', 'permit <rest>', 'deny <rest>', 'remark <rest>', 'no <n>', 'do <rest>', 'end', 'exit'];
const IOS_LINE = ['password <rest>', 'login <rest>', 'login', 'transport input <rest>', 'exec-timeout <rest>', 'logging synchronous', 'access-class <rest>', 'do <rest>', 'end', 'exit'];

/** Match the input words against the patterns of a mode: unique prefixes, the % errors IOS prints */
function iosMatch(pats, words) {
  let cand = pats.map((p) => ({ p, w: p.split(' '), args: [] })), out = [];
  for (let i = 0; i < words.length; i++) {
    const t = words[i].toLowerCase(), next = [];
    const lits = new Set(cand.filter((c) => c.w[i] && !c.w[i].startsWith('<')).map((c) => c.w[i]).filter((w) => w.startsWith(t)));
    const exact = lits.has(t) ? t : null;
    if (!exact && lits.size > 1) { const amb = cand.filter((c) => c.w[i] && !c.w[i].startsWith('<') && lits.has(c.w[i])); if (amb.length && !cand.some((c) => c.w[i] && c.w[i].startsWith('<') && c.w[i] !== '<rest>' && !lits.size)) return { err: 'amb', at: i, opts: [...lits] }; }
    cand.forEach((c) => {
      const w = c.w[i]; if (!w) return;
      if (w === '<rest>') { next.push({ ...c, args: c.args.concat([words.slice(i).join(' ')]), rest: true }); return; }
      if (w.startsWith('<')) { if (w === '<n>' && !/^\d+$/.test(words[i])) return; if (w === '<ip>' && !isIp(words[i])) return; next.push({ ...c, args: c.args.concat([words[i]]) }); return; }
      if ((exact && w === exact) || (!exact && lits.size === 1 && w.startsWith(t))) next.push({ ...c, lit: (c.lit || []).concat([w]) });
    });
    const done = next.filter((c) => c.rest); if (done.length && next.every((c) => c.rest || c.w.length <= i)) { out = done; cand = []; break; }
    cand = next.filter((c) => !c.rest).concat(done.length ? [] : []);
    if (done.length) out = done;
    if (!cand.length) { if (out.length) break; return { err: 'inv', at: i }; }
  }
  const full = cand.filter((c) => c.w.length === words.length).concat(out);
  if (!full.length) return { err: 'inc', opts: [...new Set(cand.map((c) => c.w[words.length]).filter(Boolean))] };
  return { ok: full[0].p, args: full[0].args };
}
function iosHelp(pats, words, partial) {
  const opts = new Set(); pats.forEach((p) => { const w = p.split(' '); let ok = true; for (let i = 0; i < words.length; i++) { if (!w[i]) { ok = false; break; } if (w[i] === '<rest>') { opts.add('<cr>'); ok = false; break; } if (!w[i].startsWith('<') && !w[i].startsWith(words[i].toLowerCase())) { ok = false; break; } } if (!ok) return; const n = w[words.length]; if (n == null) opts.add('<cr>'); else if (!partial || n.startsWith(partial)) opts.add(n === '<n>' ? '<1-4094>' : n === '<ip>' ? 'A.B.C.D' : n === '<w>' ? 'WORD' : n === '<if>' ? 'Interface' : n === '<rest>' ? 'LINE' : n); });
  return [...opts].sort().map((o) => `  ${o}`).join('\n') + '\n';
}

// ---------------------------------------------------------------- the console
function iosShell(L, d) {
  const S = { mode: 'exec', en: false, ifs: [], vlan: null, pool: null, acl: null, pend: null, hist: [] };
  const host = () => d.hostname;
  const sw = d.kind === 'sw';
  const prompt = () => S.pend ? S.pend.prompt : `${host()}${{ exec: S.en ? '#' : '>', conf: '(config)#', if: S.ifs.length > 1 ? '(config-if-range)#' : S.ifs[0]?.includes('.') ? '(config-subif)#' : '(config-if)#', vlan: '(config-vlan)#', ospf: '(config-router)#', pool: '(dhcp-config)#', acl: S.acl?.std ? '(config-std-nacl)#' : '(config-ext-nacl)#', line: '(config-line)#' }[S.mode]}`;
  const patsOf = (m) => ({ exec: IOS_EXEC, conf: IOS_CONF, if: IOS_IF, vlan: IOS_VLAN, ospf: IOS_OSPF, pool: IOS_POOL, acl: IOS_ACL, line: IOS_LINE }[m]);
  const caret = (raw, i) => { const w = raw.trim().split(/\s+/); const pos = prompt().length + w.slice(0, i).join(' ').length + (i ? 1 : 0); return `${' '.repeat(pos)}^\n% Invalid input detected at '^' marker.\n`; };
  const done = () => { settle(L); return ''; };
  function run(raw) {
    const line = raw.replace(/\s+$/, ''); if (S.pend) { const p = S.pend; S.pend = null; return p.fn(line); }
    if (!line.trim()) return '';
    S.hist.push(line);
    if (line.trim().endsWith('?')) { const t = line.trim().slice(0, -1); const ws = t.split(/\s+/).filter(Boolean); const partial = /\S$/.test(t) ? ws.pop() : ''; let pats = patsOf(S.mode); if (S.mode === 'exec' && ws[0] && 'show'.startsWith(ws[0].toLowerCase())) { pats = IOS_SHOW; ws.shift(); } return `${prompt()}${line}\n` + iosHelp(pats, ws, partial); }
    const words = line.trim().split(/\s+/);
    if (S.mode === 'exec' && !S.en && !/^(en|ena|enab|enabl|enable|ex|exi|exit|sh|sho|show|pi|pin|ping|tr|tra|trac|trace|traceroute|log|logout|help|ter.*)$/i.test(words[0])) return caret(line, 0);
    let pats = patsOf(S.mode);
    if (S.mode !== 'exec' && words[0].toLowerCase() === 'do') { const m = S.mode; S.mode = 'exec'; const en = S.en; S.en = true; const r = run(words.slice(1).join(' ')); S.mode = m; S.en = en; return r; }
    const m = iosMatch(pats, words);
    if (m.err === 'amb') return `% Ambiguous command:  "${line.trim()}"\n`;
    if (m.err === 'inc') return '% Incomplete command.\n';
    if (m.err) {
      if (S.mode !== 'exec' && S.mode !== 'conf') { const g = iosMatch(IOS_CONF, words); if (!g.err) { const save = S.mode; S.mode = 'conf'; const r = conf(g.ok, g.args, words, line); if (S.mode === 'conf' && !['exit', 'end'].includes(g.ok)) { } return r; } }
      return caret(line, m.at ?? 0);
    }
    try { return { exec, conf, if: ifc, vlan: vlanc, ospf: ospfc, pool: poolc, acl: aclc, line: linec }[S.mode](m.ok, m.args, words, line) ?? ''; } catch (e) { return `% ${e.message}\n`; }
  }
  // ------------------------------------------------ exec
  function exec(p, a, w, raw) {
    switch (p) {
      case 'enable': if (d.secret && !S.en) { S.pend = { prompt: 'Password: ', fn: (x) => { if (x === d.secret) S.en = true; else return '% Access denied\n'; return ''; } }; return ''; } S.en = true; return '';
      case 'disable': S.en = false; return '';
      case 'exit': case 'logout': S.en = false; return '\n[Connection closed]\n';
      case 'configure terminal': S.mode = 'conf'; return 'Enter configuration commands, one per line.  End with CNTL/Z.\n';
      case 'show <rest>': return show(a[0]);
      case 'ping <rest>': return iosPing(L, d, a[0]);
      case 'traceroute <rest>': return iosTrace(L, d, a[0]);
      case 'copy running-config startup-config': S.pend = { prompt: 'Destination filename [startup-config]? ', fn: () => { d.startup = devSnap(d); return 'Building configuration...\n[OK]\n'; } }; return '';
      case 'write memory': case 'write': d.startup = devSnap(d); return 'Building configuration...\n[OK]\n';
      case 'copy running-config tftp:': case 'copy running-config tftp: <rest>': case 'copy startup-config tftp:': { const src = p.startsWith('copy startup') ? 'startup' : 'running'; S.pend = { prompt: 'Address or name of remote host []? ', fn: (h) => { S.pend = { prompt: `Destination filename [${d.hostname.toLowerCase()}-confg]? `, fn: (f) => { const name = f.trim() || `${d.hostname.toLowerCase()}-confg`; const ip = isIp(h.trim()) ? h.trim() : null; if (!ip) return '%Error opening tftp://' + h + '/' + name + ' (Unknown host)\n'; const r = send(L, d.id, { dst: ip, proto: 'udp', dport: 69 }); if (r.res !== 'ok') return `.....\n%Error opening tftp://${ip}/${name} (Timed out)\n`; const txt = src === 'startup' && d.startup ? runCfg(L, { ...d, ...d.startup }) : runCfg(L, d); const T = L.devs[r.at]; (T.tftp ??= {})[name] = { text: txt, t: L.clock, from: d.hostname }; return `!!\n${txt.length} bytes copied in 0.412 secs (${Math.round(txt.length / 0.412)} bytes/sec)\n`; } }; return ''; } }; return ''; }
      case 'copy tftp: running-config': return '%Use the trainer tools to restore a backup in this lab.\n';
      case 'copy startup-config running-config': devRestore(d, d.startup); settle(L); return `${JSON.stringify(d.startup).length} bytes copied\n`;
      case 'erase startup-config': S.pend = { prompt: 'Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]', fn: () => { d.startup = null; return '[OK]\nErase of nvram: complete\n'; } }; return '';
      case 'reload': { const ch = JSON.stringify(devSnap(d)) !== JSON.stringify(d.startup); S.pend = { prompt: ch ? '\nSystem configuration has been modified. Save? [yes/no]: ' : 'Proceed with reload? [confirm]', fn: (x) => { if (ch && /^y/i.test(x)) d.startup = devSnap(d); if (d.startup) devRestore(d, d.startup); else devRestore(d, null); S.mode = 'exec'; S.en = false; settle(L); flapAll(L, d); return `\n${ch && /^n/i.test(x) ? '' : ''}Reload requested by console. Reload reason: Reload Command.\n\n*** System restarted ***\n\nPress RETURN to get started!\n${d.startup ? '' : '\n         --- System Configuration Dialog ---\n(the configuration was erased – the device starts empty)\n'}`; } }; return ''; }
      case 'clear mac address-table dynamic': L.mac[d.id] = {}; return '';
      case 'clear ip nat translation *': d.nat && (d.nat.xlate = []); return '';
      case 'clear ip dhcp binding *': if (d.dhcp) d.dhcp.bind = {}; return '';
      case 'clear ip dhcp conflict *': return '';
      case 'clear ip ospf process': S.pend = { prompt: 'Reset ALL OSPF processes? [no]: ', fn: (x) => (/^y/i.test(x) ? (settle(L), '') : '') }; return '';
      case 'clear counters': d.ctr = {}; return 'Clear "show interface" counters on all interfaces [confirm]\n';
      case 'clear logging': L.log = L.log.filter((x) => x.dev !== d.id); return '';
      case 'terminal length <n>': case 'terminal monitor': return '';
      case 'help': return 'Help may be requested at any point in a command by entering a question mark \'?\'.\nTwo styles of help: full help (\'show ?\') and partial help (\'sh?\').\nAbbreviate commands: "sh ip int br", "conf t", "int g1/0/1".\n';
      case 'test cable-diagnostics tdr interface <if>': { const n = ifNorm(a[0]); const pr = peerOf(L, d.id, n); return `TDR test started on interface ${n}\n\n${pad('Interface', 10)}${pad('Speed', 7)}${pad('Local pair', 12)}${pad('Pair length', 21)}Remote pair Pair status\n${pad(n, 10)}${pad(pr ? '1000M' : 'auto', 7)}${pad('Pair A', 12)}${pad(pr ? '21   +/- 5 meters' : (L.devs[d.id].cut?.[n] ? '14   +/- 5 meters' : 'N/A'), 21)}${pr ? 'Pair A      Normal' : L.devs[d.id].cut?.[n] ? 'N/A         Open' : 'N/A         Open'}\n`; }
      case 'debug <rest>': return `${a[0]} debugging is on\n`;
      case 'undebug all': return 'All possible debugging has been turned off\n';
      case 'ssh <rest>': case 'telnet <rest>': return '% Use the device buttons to open another console.\n';
    }
    return '';
  }
  // ------------------------------------------------ global configuration
  function conf(p, a, w, raw) {
    switch (p) {
      case 'hostname <w>': d.hostname = a[0]; return '';
      case 'end': S.mode = 'exec'; return '';
      case 'exit': S.mode = S.mode === 'conf' ? 'exec' : 'conf'; return '';
      case 'vlan <rest>': { if (!sw) return '% VLANs are on switches\n'; const ids = parseVlanList(a[0]); if (!ids.length || ids.some((v) => v < 1 || v > 4094)) return '% Invalid VLAN\n'; ids.forEach((v) => (d.vlans[v] ??= `VLAN${String(v).padStart(4, '0')}`)); S.mode = 'vlan'; S.vlan = ids; return done(); }
      case 'no vlan <rest>': parseVlanList(a[0]).forEach((v) => { if (+v !== 1) delete d.vlans[v]; }); return done();
      case 'interface range <rest>': { const r = ifRange(a[0]); if (!r.length || r.some((x) => !ifExists(x))) return '% Invalid interface range\n'; S.ifs = r; S.mode = 'if'; return ''; }
      case 'interface <rest>': { const n = ifNorm(a[0].replace(/\s+/g, '')) || ifNorm(a[0]); if (!n) return caret(raw, 1); if (!ifExists(n)) { if (n.startsWith('Vlan') && sw) { d.svis[n.slice(4)] = { shut: true }; } else if (n.includes('.') && d.kind === 'rt' && d.ifs[n.split('.')[0]]) { d.ifs[n] = { shut: false, mac: d.ifs[n.split('.')[0]].mac }; } else if (n.startsWith('Loopback') && d.kind === 'rt') { d.ifs[n] = { loop: true, shut: false }; } else if (n.startsWith('Po') && sw) { S.ifs = Object.keys(d.ports).filter((pn) => String(d.ports[pn].cg) === n.slice(2)); if (!S.ifs.length) return '% Port-channel not configured\n'; S.mode = 'if'; S.po = n; return ''; } else return caret(raw, 1); } S.ifs = [n]; S.po = null; S.mode = 'if'; return ''; }
      case 'no interface <rest>': { const n = ifNorm(a[0].replace(/\s+/g, '')) || ifNorm(a[0]); if (n?.startsWith('Vlan')) delete d.svis[n.slice(4)]; else if (n?.includes('.')) delete d.ifs[n]; return done(); }
      case 'ip routing': d.iprouting = true; return done();
      case 'no ip routing': d.iprouting = false; return done();
      case 'ip route <ip> <ip> <w>': case 'ip route <ip> <ip> <w> <rest>': { const [net, mask, via, rest] = a; if (!isMask(mask)) return '% Inconsistent address and mask\n'; if (netOf(net, mask) !== net) return '% Inconsistent address and mask\n'; const r = { net, mask, ad: rest && /^\d+$/.test(rest) ? +rest : 1 }; if (isIp(via)) r.via = via; else { const n = ifNorm(via); if (!n || !ifExists(n)) return caret(raw, 4); r.ifn = n; } d.routes = d.routes.filter((x) => !(x.net === net && x.mask === mask && (x.via === r.via && x.ifn === r.ifn))); d.routes.push(r); return done(); }
      case 'no ip route <rest>': { const [net, mask, via] = a[0].split(/\s+/); const b = d.routes.length; d.routes = d.routes.filter((x) => !(x.net === net && x.mask === mask && (!via || x.via === via || x.ifn === ifNorm(via)))); return b === d.routes.length ? '%No matching route to delete\n' : done(); }
      case 'router ospf <n>': d.ospf ??= { pid: +a[0], nets: [], passive: [] }; S.mode = 'ospf'; return '';
      case 'no router ospf <n>': d.ospf = null; return done();
      case 'ip dhcp pool <w>': d.dhcp ??= { pools: {}, excl: [], bind: {} }; d.dhcp.pools[a[0]] ??= {}; S.pool = a[0]; S.mode = 'pool'; return '';
      case 'no ip dhcp pool <w>': delete d.dhcp?.pools?.[a[0]]; return done();
      case 'ip dhcp excluded-address <ip>': case 'ip dhcp excluded-address <ip> <rest>': d.dhcp ??= { pools: {}, excl: [], bind: {} }; d.dhcp.excl.push([a[0], isIp(a[1]) ? a[1] : a[0]]); return done();
      case 'no ip dhcp excluded-address <rest>': { const [x, y] = a[0].split(/\s+/); d.dhcp.excl = d.dhcp.excl.filter(([p, q]) => !(p === x && (!y || q === y))); return done(); }
      case 'ip dhcp snooping': d.snoop.on = true; return done();
      case 'no ip dhcp snooping': d.snoop.on = false; return done();
      case 'ip dhcp snooping vlan <rest>': d.snoop.vlans = [...new Set([...(d.snoop.vlans || []), ...parseVlanList(a[0])])]; return done();
      case 'no ip dhcp snooping vlan <rest>': { const r = parseVlanList(a[0]); d.snoop.vlans = (d.snoop.vlans || []).filter((v) => !r.includes(+v)); return done(); }
      case 'ip dhcp snooping information option': case 'no ip dhcp snooping information option': case 'ip dhcp relay information trust-all': return '';
      case 'ip nat inside source list <w> interface <rest>': { const t = a[1].split(/\s+/), n = ifNorm(t[0] + (t[1] && !/overload/i.test(t[1]) ? t[1] : '')); if (!n) return caret(raw, 6); if (!/overload/i.test(a[1])) return '% Without overload only one inside host can use the interface address – add "overload" (PAT)\n'; d.nat.rules = d.nat.rules.filter((x) => x.acl !== a[0]); d.nat.rules.push({ acl: /^\d+$/.test(a[0]) ? +a[0] : a[0], ifn: n }); return done(); }
      case 'ip nat inside source static <rest>': { const t = a[0].split(/\s+/); let s; if (t[0] === 'tcp' || t[0] === 'udp') { const outIp = t[3] === 'interface' ? rtIfIp(d, ifNorm(t[4])) : t[3]; s = { proto: t[0], inside: t[1], iport: +t[2], outside: outIp, oport: +(t[3] === 'interface' ? t[5] : t[4]) }; } else s = { inside: t[0], outside: t[1] }; if (!isIp(s.inside) || !isIp(s.outside)) return '% Invalid address\n'; d.nat.statics.push(s); return done(); }
      case 'no ip nat inside source <rest>': { const t = a[0].split(/\s+/); if (t[0] === 'list') d.nat.rules = d.nat.rules.filter((x) => String(x.acl) !== t[1]); else d.nat.statics = d.nat.statics.filter((x) => !t.includes(x.inside)); return done(); }
      case 'access-list <n> <rest>': { const r = aclParse(a[1].split(/\s+/), +a[0] < 100 || (+a[0] >= 1300 && +a[0] <= 1999)); if (!r) return caret(raw, 2); if (r.remark) return ''; (d.acls[+a[0]] ??= []).push(r); return done(); }
      case 'no access-list <n>': delete d.acls[+a[0]]; return done();
      case 'ip access-list extended <w>': case 'ip access-list standard <w>': d.acls[a[0]] ??= []; S.acl = { name: a[0], std: p.includes('standard') }; S.mode = 'acl'; return '';
      case 'no ip access-list <rest>': delete d.acls[a[0].split(/\s+/).pop()]; return done();
      case 'spanning-tree mode <w>': d.stp.mode = a[0]; return done();
      case 'spanning-tree vlan <rest>': { const t = a[0].split(/\s+/); if (t[1] === 'priority') { const pr = +t[2]; if (pr % 4096) return '% Bridge Priority must be in increments of 4096.\n% Allowed values are:\n  0     4096  8192  12288 16384 20480 24576 28672\n  32768 36864 40960 45056 49152 53248 57344 61440\n'; d.stp.prio = pr; } else if (t[1] === 'root') d.stp.prio = t[2] === 'primary' ? 24576 : 28672; d.stp.on = true; return done(); }
      case 'no spanning-tree vlan <rest>': { const t = a[0].split(/\s+/); if (t.length === 1) { d.stp.on = false; logAdd(L, d.id, 'Spanning tree disabled for VLAN ' + t[0]); } else d.stp.prio = 32768; return done(); }
      case 'spanning-tree portfast bpduguard default': d.stp.bpduguardDefault = true; return done();
      case 'no spanning-tree portfast bpduguard default': d.stp.bpduguardDefault = false; return done();
      case 'spanning-tree portfast default': d.stp.portfastDefault = true; return '%Warning: this command enables portfast by default on all interfaces. You should now disable portfast explicitly on switched ports leading to hubs, switches and bridges as they may create temporary bridging loops.\n';
      case 'snmp-server community <w>': case 'snmp-server community <w> <w>': (d.snmp ??= {}).community = a[0]; d.snmp.rw = /rw/i.test(a[1] || ''); return '';
      case 'no snmp-server community <w>': if (d.snmp) d.snmp.community = null; return '';
      case 'snmp-server host <ip> <rest>': (d.snmp ??= {}).host = a[0]; return '';
      case 'snmp-server location <rest>': (d.snmp ??= {}).location = a[0]; return '';
      case 'snmp-server contact <rest>': (d.snmp ??= {}).contact = a[0]; return '';
      case 'ip flow-export destination <ip> <n>': d.flowExport = a[0]; d.flowPort = +a[1]; return '';
      case 'no ip flow-export destination <rest>': d.flowExport = null; return '';
      case 'logging host <ip>': case 'logging <ip>': d.syslog = a[0]; return '';
      case 'no logging host <ip>': d.syslog = null; return '';
      case 'logging trap <w>': d.syslogLevel = a[0]; return '';
      case 'ntp server <ip>': d.ntp = a[0]; return '';
      case 'no ntp server <ip>': d.ntp = null; return '';
      case 'errdisable recovery cause <w>': (d.errRec ??= { causes: [], interval: 300 }).causes.push(a[0]); return '';
      case 'errdisable recovery interval <n>': (d.errRec ??= { causes: [], interval: 300 }).interval = +a[0]; return '';
      case 'enable secret <rest>': case 'enable password <rest>': d.secret = a[0].split(/\s+/).pop(); return '';
      case 'username <rest>': (d.users ??= {})[a[0].split(/\s+/)[0]] = a[0]; return '';
      case 'line <rest>': S.mode = 'line'; return '';
      case 'ip domain-name <w>': case 'ip domain name <w>': d.domain = a[0]; return '';
      case 'crypto key generate rsa': case 'crypto key generate rsa <rest>': if (!d.domain) return '% Please define a domain-name first.\n'; d.rsa = true; return `The name for the keys will be: ${d.hostname}.${d.domain}\n% The key modulus size is 2048 bits\n% Generating 2048 bit RSA keys, keys will be non-exportable...\n[OK] (elapsed time was 1 seconds)\n%SSH-5-ENABLED: SSH 2.0 has been enabled\n`;
      case 'ip ssh version <n>': d.sshv = +a[0]; return '';
      case 'ip default-gateway <ip>': d.defgw = a[0]; return '';
      case 'ip name-server <rest>': d.nameServers = a[0].split(/\s+/); return '';
      case 'monitor session <rest>': { const t = a[0].split(/\s+/); d.span ??= {}; const s = (d.span[t[0]] ??= {}); if (t[1] === 'source') s.src = ifRange(t.slice(3).join(' ').replace(/\s+(both|rx|tx)$/, '')); if (t[1] === 'destination') s.dst = ifNorm(t.slice(3).join('')); return ''; }
      case 'no monitor session <rest>': delete d.span?.[a[0].split(/\s+/)[0]]; return '';
      case 'cdp run': d.cdpOff = false; return ''; case 'no cdp run': d.cdpOff = true; return '';
      case 'lldp run': d.lldp = true; return ''; case 'no lldp run': d.lldp = false; return '';
      default: return '';
    }
  }
  function ifExists(n) { if (sw) return !!d.ports[n] || (n.startsWith('Vlan') && !!d.svis[n.slice(4)]) || (n.startsWith('Po') && Object.values(d.ports).some((p) => String(p.cg) === n.slice(2))); return !!d.ifs[n]; }
  // ------------------------------------------------ interface configuration (one port or a range)
  function ifc(p, a, w, raw) {
    if (p === 'end') { S.mode = 'exec'; return ''; } if (p === 'exit') { S.mode = 'conf'; return ''; }
    if (p === 'interface <rest>' || p === 'interface range <rest>') return conf(p, a, w, raw);
    let out = '';
    S.ifs.forEach((n) => { const r = ifOne(n, p, a, raw); if (r) out += r; });
    settle(L); return out;
  }
  function ifOne(n, p, a, raw) {
    if (n.startsWith('Vlan')) { const s = d.svis[n.slice(4)]; return sviOne(n, s, p, a); }
    if (d.kind === 'rt') return rtIfOne(n, d.ifs[n], p, a, raw);
    const port = d.ports[n];
    const L3 = port.routed;
    switch (p) {
      case 'description <rest>': port.desc = a[0]; return '';
      case 'no description': delete port.desc; return '';
      case 'shutdown': if (!port.shut) { port.shut = true; logAdd(L, d.id, `%LINK-5-CHANGED: Interface ${ifLong(n)}, changed state to administratively down`); } return `%LINK-5-CHANGED: Interface ${ifLong(n)}, changed state to administratively down\n`;
      case 'no shutdown': { const was = port.shut || port.err; port.shut = false; if (port.err) { delete port.err; } settle(L, 'nodhcp'); flap(L, d.id, n); settle(L); const up = linkUp(L, d.id, n); if (!was) return ''; const m = up ? `%LINK-3-UPDOWN: Interface ${ifLong(n)}, changed state to up\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${ifLong(n)}, changed state to up\n` : port.err ? '' : `%LINK-3-UPDOWN: Interface ${ifLong(n)}, changed state to down\n`; if (m) logAdd(L, d.id, m.trim().split('\n')[0]); return m; }
      case 'switchport mode <w>': { const m = ['access', 'trunk', 'dynamic'].find((x) => x.startsWith(a[0].toLowerCase())); if (!m || m === 'dynamic') return caret(raw, 2); port.mode = m; return ''; }
      case 'switchport access vlan <n>': { const v = +a[0]; let msg = ''; if (!d.vlans[v]) { d.vlans[v] = `VLAN${String(v).padStart(4, '0')}`; msg = '% Access VLAN does not exist. Creating vlan ' + v + '\n'; } port.vlan = v; return msg; }
      case 'no switchport access vlan': port.vlan = 1; return '';
      case 'switchport trunk native vlan <n>': port.native = +a[0]; return '';
      case 'no switchport trunk native vlan': port.native = 1; return '';
      case 'switchport trunk allowed vlan <rest>': { const t = a[0].trim().split(/\s+/); const cur = port.allowed === 'all' ? Array.from({ length: 4094 }, (_, i) => i + 1) : parseVlanList(port.allowed); if (t[0] === 'add') port.allowed = vlanListStr([...cur, ...parseVlanList(t[1])]); else if (t[0] === 'remove') { const r = parseVlanList(t[1]); port.allowed = vlanListStr(cur.filter((v) => !r.includes(v))); } else if (t[0] === 'all') port.allowed = 'all'; else if (t[0] === 'none') port.allowed = 'none'; else if (t[0] === 'except') { const r = parseVlanList(t[1]); port.allowed = vlanListStr(cur.filter((v) => !r.includes(v))); } else port.allowed = vlanListStr(parseVlanList(t[0])); if (port.allowed === '1-4094') port.allowed = 'all'; return ''; }
      case 'no switchport trunk allowed vlan': port.allowed = 'all'; return '';
      case 'switchport voice vlan <n>': { const v = +a[0]; let msg = ''; if (!d.vlans[v]) { d.vlans[v] = `VLAN${String(v).padStart(4, '0')}`; msg = '% Voice VLAN does not exist. Creating vlan ' + v + '\n'; } port.voice = v; return msg; }
      case 'no switchport voice vlan': port.voice = null; return '';
      case 'switchport trunk encapsulation dot1q': case 'switchport nonegotiate': case 'switchport': port.routed = false; return '';
      case 'no switchport': port.routed = true; return '';
      case 'switchport port-security': if (port.mode !== 'access') return 'Command rejected: GigabitEthernet is a dynamic port.\n'; (port.ps ??= { max: 1, viol: 'shutdown', macs: [] }).on = true; return '';
      case 'no switchport port-security': if (port.ps) port.ps.on = false; return '';
      case 'switchport port-security maximum <n>': (port.ps ??= { max: 1, viol: 'shutdown', macs: [] }).max = +a[0]; return '';
      case 'switchport port-security mac-address sticky': (port.ps ??= { max: 1, viol: 'shutdown', macs: [] }).sticky = true; return '';
      case 'switchport port-security mac-address <w>': { const m = a[0].replace(/\./g, '').match(/../g)?.join(':'); if (!m || m.length !== 17) return caret(raw, 3); (port.ps ??= { max: 1, viol: 'shutdown', macs: [] }).macs.push(m.toLowerCase()); port.ps.static = true; return ''; }
      case 'switchport port-security violation <w>': (port.ps ??= { max: 1, viol: 'shutdown', macs: [] }).viol = ['shutdown', 'restrict', 'protect'].find((x) => x.startsWith(a[0])) || 'shutdown'; return '';
      case 'no switchport port-security <rest>': { if (!port.ps) return ''; if (/maximum/.test(a[0])) port.ps.max = 1; if (/sticky/.test(a[0])) { port.ps.sticky = false; port.ps.macs = []; } if (/violation/.test(a[0])) port.ps.viol = 'shutdown'; return ''; }
      case 'spanning-tree portfast': case 'spanning-tree portfast <rest>': port.portfast = true; return port.mode === 'trunk' && !/trunk/.test(a[0] || '') ? '%Warning: portfast should only be enabled on ports connected to a single host.\n' : `%Warning: portfast should only be enabled on ports connected to a single\n host. Connecting hubs, concentrators, switches, bridges, etc... to this\n interface  when portfast is enabled, can cause temporary bridging loops.\n Use with CAUTION\n\n%Portfast has been configured on ${ifLong(n)} but will only\n have effect when the interface is in a non-trunking mode.\n`;
      case 'no spanning-tree portfast': port.portfast = false; return '';
      case 'spanning-tree bpduguard <w>': port.bpduguard = /^e/.test(a[0]); return '';
      case 'no spanning-tree bpduguard': port.bpduguard = false; return '';
      case 'spanning-tree bpdufilter <w>': port.bpdufilter = /^e/.test(a[0]); return '';
      case 'no spanning-tree bpdufilter': port.bpdufilter = false; return '';
      case 'spanning-tree cost <n>': port.stpCost = +a[0]; return '';
      case 'channel-group <n> mode <w>': { const m = ['active', 'passive', 'on', 'auto', 'desirable'].find((x) => x.startsWith(a[1])); if (!m) return caret(raw, 3); port.cg = +a[0]; port.cgm = m === 'auto' || m === 'desirable' ? 'active' : m; return `Creating a port-channel interface Port-channel ${a[0]}\n`; }
      case 'no channel-group': delete port.cg; delete port.cgm; return '';
      case 'ip dhcp snooping trust': port.trust = true; return '';
      case 'no ip dhcp snooping trust': port.trust = false; return '';
      case 'power inline <w>': port.poeOff = /^n/.test(a[0]); return '';
      case 'storm-control broadcast level <rest>': port.storm = a[0]; return '';
      case 'ip address <ip> <ip>': if (!L3) return '% IP addresses may not be configured on L2 links.\n'; port.ip = a[0]; port.mask = a[1]; return '';
      default: return '';
    }
  }
  function sviOne(n, s, p, a) {
    switch (p) {
      case 'ip address <ip> <ip>': if (!isMask(a[1])) return '% Bad mask\n'; s.ip = a[0]; s.mask = a[1]; return '';
      case 'no ip address': delete s.ip; delete s.mask; return '';
      case 'shutdown': s.shut = true; return '';
      case 'no shutdown': s.shut = false; return sviUp(L, d, +n.slice(4)) ? `%LINK-3-UPDOWN: Interface ${n}, changed state to up\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to up\n` : '';
      case 'ip helper-address <ip>': (s.helper ??= []).push(a[0]); return '';
      case 'no ip helper-address <rest>': s.helper = (s.helper || []).filter((x) => x !== a[0].trim()); return '';
      case 'description <rest>': s.desc = a[0]; return '';
      case 'ip ospf cost <n>': s.cost = +a[0]; return '';
      case 'ip ospf hello-interval <n>': s.hello = +a[0]; return '';
      default: return '';
    }
  }
  function rtIfOne(n, c, p, a, raw) {
    switch (p) {
      case 'description <rest>': c.desc = a[0]; return '';
      case 'no description': delete c.desc; return '';
      case 'shutdown': c.shut = true; return `%LINK-5-CHANGED: Interface ${ifLong(n)}, changed state to administratively down\n`;
      case 'no shutdown': { const was = c.shut; c.shut = false; settle(L); const up = linkUp(L, d.id, n.split('.')[0]); return was ? (up ? `%LINK-3-UPDOWN: Interface ${ifLong(n)}, changed state to up\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${ifLong(n)}, changed state to up\n` : `%LINK-3-UPDOWN: Interface ${ifLong(n)}, changed state to down\n`) : ''; }
      case 'ip address <ip> <ip>': case 'ip address <ip> <ip> secondary': { if (!isMask(a[1])) return '% Bad mask /' + a[1] + ' for address ' + a[0] + '\n'; if (n.includes('.') && !c.dot1q) return '% Configuring IP routing on a LAN subinterface is only allowed if that\nsubinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q,\nor ISL vLAN.\n'; const clash = Object.entries(d.ifs).find(([k, x]) => k !== n && x.ip && x.mask && (sameNet(x.ip, a[0], x.mask) || sameNet(x.ip, a[0], a[1]))); if (clash) return `% ${netOf(a[0], a[1])} overlaps with ${clash[0]}\n`; c.ip = a[0]; c.mask = a[1]; return ''; }
      case 'no ip address': delete c.ip; delete c.mask; return '';
      case 'ip address dhcp': c.dhcpc = true; return '';
      case 'encapsulation dot1q <n>': case 'encapsulation dot1q <n> native': if (!n.includes('.')) return '% Configure encapsulation on a subinterface\n'; c.dot1q = +a[0]; c.native = p.endsWith('native'); return '';
      case 'ip helper-address <ip>': (c.helper ??= []).push(a[0]); return '';
      case 'no ip helper-address <rest>': c.helper = (c.helper || []).filter((x) => x !== a[0].trim()); return '';
      case 'ip nat inside': c.nat = 'inside'; return '';
      case 'ip nat outside': c.nat = 'outside'; return '';
      case 'no ip nat <w>': c.nat = null; return '';
      case 'ip access-group <w> <w>': { const k = /^\d+$/.test(a[0]) ? +a[0] : a[0]; if (/^in/.test(a[1])) c.aclIn = k; else c.aclOut = k; return ''; }
      case 'no ip access-group <rest>': { const t = a[0].split(/\s+/); if (/^in/.test(t[1] || 'in')) delete c.aclIn; if (/^out/.test(t[1] || '')) delete c.aclOut; return ''; }
      case 'ip ospf cost <n>': c.cost = +a[0]; return '';
      case 'ip ospf hello-interval <n>': c.hello = +a[0]; return '';
      case 'mtu <n>': case 'ip mtu <n>': c.mtu = +a[0]; return '';
      default: return '';
    }
  }
  function vlanc(p, a) { if (p === 'end') { S.mode = 'exec'; return ''; } if (p === 'exit') { S.mode = 'conf'; return ''; } if (p === 'name <rest>') S.vlan.forEach((v) => (d.vlans[v] = a[0].replace(/\s+/g, '_'))); return done(); }
  function ospfc(p, a, w, raw) {
    const o = d.ospf; switch (p) {
      case 'end': S.mode = 'exec'; return ''; case 'exit': S.mode = 'conf'; return '';
      case 'router-id <ip>': o.rid = a[0]; return '% OSPF: Reload or use "clear ip ospf process" command, for this to take effect\n';
      case 'network <ip> <ip> area <w>': o.nets = o.nets.filter((x) => !(x.net === a[0] && x.wild === a[1])); o.nets.push({ net: a[0], wild: a[1], area: a[2] }); settle(L); return ospfMsgs();
      case 'no network <ip> <ip> area <w>': o.nets = o.nets.filter((x) => !(x.net === a[0] && x.wild === a[1])); return done();
      case 'passive-interface default': o.passiveDefault = true; return done();
      case 'no passive-interface default': o.passiveDefault = false; return done();
      case 'passive-interface <rest>': { const n = ifNorm(a[0].replace(/\s+/g, '')); if (!n) return caret(raw, 1); (o.passive ??= []).push(n); o.nopassive = (o.nopassive || []).filter((x) => x !== n); return done(); }
      case 'no passive-interface <rest>': { const n = ifNorm(a[0].replace(/\s+/g, '')); o.passive = (o.passive || []).filter((x) => x !== n); (o.nopassive ??= []).push(n); settle(L); return ospfMsgs(); }
      case 'default-information originate': case 'default-information originate <rest>': o.defOrig = true; return done();
      case 'no default-information originate': o.defOrig = false; return done();
      case 'interface <rest>': case 'router ospf <n>': S.mode = 'conf'; return conf(p, a, w, raw);
      default: return '';
    }
  }
  function ospfMsgs() { const n = L._ospf?.neigh?.[d.id] || []; const seen = (S.ospfSeen ??= []); let o = ''; n.forEach((x) => { if (!seen.includes(x.rid)) { seen.push(x.rid); o += `%OSPF-5-ADJCHG: Process ${d.ospf.pid}, Nbr ${x.rid} on ${ifLong(x.ifn)} from LOADING to FULL, Loading Done\n`; } }); return o; }
  function poolc(p, a) {
    const P = d.dhcp.pools[S.pool]; switch (p) {
      case 'end': S.mode = 'exec'; return ''; case 'exit': S.mode = 'conf'; return '';
      case 'network <ip> <rest>': { const m = a[1].trim(); const mask = m.startsWith('/') ? len2mask(+m.slice(1)) : m; if (!isMask(mask)) return '% Bad mask\n'; P.net = netOf(a[0], mask); P.mask = mask; return done(); }
      case 'default-router <rest>': P.gw = a[0].split(/\s+/)[0]; return done();
      case 'dns-server <rest>': P.dns = a[0].split(/\s+/); return done();
      case 'domain-name <w>': P.dom = a[0]; return '';
      case 'lease <rest>': P.lease = a[0]; return '';
      case 'no default-router': delete P.gw; return ''; case 'no dns-server': P.dns = []; return ''; case 'no network': delete P.net; return '';
      default: return '';
    }
  }
  function aclc(p, a, w, raw) {
    if (p === 'end') { S.mode = 'exec'; return ''; } if (p === 'exit') { S.mode = 'conf'; return ''; }
    const A = (d.acls[S.acl.name] ??= []);
    if (p === 'no <n>') { const i = A.findIndex((r) => r.seq === +a[0]); if (i >= 0) A.splice(i, 1); return done(); }
    if (p === 'remark <rest>') return '';
    const t = (p === '<n> <rest>' ? a[1] : `${p.split(' ')[0]} ${a[0]}`).split(/\s+/); const r = aclParse(t, S.acl.std); if (!r) return caret(raw, 1);
    r.seq = p === '<n> <rest>' ? +a[0] : (A.length ? Math.max(...A.map((x) => x.seq || 0)) : 0) + 10; A.push(r); A.sort((x, y) => (x.seq || 0) - (y.seq || 0)); return done();
  }
  function linec(p) { if (p === 'end') { S.mode = 'exec'; return ''; } if (p === 'exit') { S.mode = 'conf'; return ''; } return ''; }
  function aclParse(t, std) {
    if (t[0] === 'remark') return { remark: true };
    const act = t[0]; if (!['permit', 'deny'].includes(act)) return null;
    if (std) { const [src] = aclAddr(t, 1); if (!src) return null; return { std: true, act, src: src.any ? 'any' : src.host ? { host: src.host } : src }; }
    const proto = t[1]; if (!['ip', 'tcp', 'udp', 'icmp'].includes(proto)) return null;
    const [src, i] = aclAddr(t, 2); const [dst, j] = aclAddr(t, i); if (!src || !dst) return null;
    const r = { act, proto, src: src.any ? 'any' : src, dst: dst.any ? 'any' : dst };
    if (t[j] === 'eq') r.eq = PORTS[t[j + 1]] ?? +t[j + 1];
    if (t.includes('log')) r.log = true;
    return r;
  }
  // ------------------------------------------------ show
  function show(rest) {
    const ws = rest.split(/\s+/);
    if (ws[ws.length - 1] === '|' || ws.includes('|')) { const k = ws.indexOf('|'); const out = show(ws.slice(0, k).join(' ')); const f = ws.slice(k + 1); const pat = f.slice(1).join(' '); let re; try { re = new RegExp(pat); } catch { re = new RegExp(pat.replace(/[.*+?^${}()[\]\\]/g, '\\$&')); } const lines = out.split('\n'); if (/^i/.test(f[0])) return lines.filter((l) => re.test(l)).join('\n') + '\n'; if (/^e/.test(f[0])) return lines.filter((l) => !re.test(l)).join('\n') + '\n'; if (/^(b|s)/.test(f[0])) { const i = lines.findIndex((l) => re.test(l)); return i < 0 ? '' : lines.slice(i).join('\n') + '\n'; } return out; }
    const m = iosMatch(IOS_SHOW, ws);
    if (m.err === 'amb') return `% Ambiguous command:  "show ${rest}"\n`;
    if (m.err === 'inc') return '% Incomplete command.\n';
    if (m.err) return `${' '.repeat(prompt().length + 5 + ws.slice(0, m.at).join(' ').length + (m.at ? 1 : 0))}^\n% Invalid input detected at '^' marker.\n`;
    return iosShow(L, d, m.ok, m.args) ?? '';
  }
  return { prompt, run, kind: 'ios', S, title: () => `${d.hostname} – console (Cisco IOS style)` };
}
const rtIfIp = (d, n) => d.ifs[n]?.ip;

/** Running configuration as text */
function devSnap(d) {
  const o = clone(d); ['startup', 'x', 'y', 'ctr', 'ospfSeen'].forEach((k) => delete o[k]);
  if (o.ports) Object.values(o.ports).forEach((p) => { delete p.err; delete p.susp; delete p.pvidInc; if (p.ps && !p.ps.sticky && !p.ps.static) p.ps.macs = []; if (p.ps) { delete p.ps.viols; delete p.ps.last; } });
  if (o.dhcp) o.dhcp.bind = {};
  if (o.nat) delete o.nat.xlate;
  return o;
}
function devRestore(d, snap) {
  const keep = { id: d.id, name: d.name, kind: d.kind, x: d.x, y: d.y, startup: snap, mac: d.mac };
  Object.keys(d).forEach((k) => delete d[k]);
  if (snap) Object.assign(d, clone(snap));
  else if (keep.kind === 'sw') Object.assign(d, { hostname: 'Switch', vlans: { 1: 'default' }, ports: Object.fromEntries(Object.keys(clone(keep).ports || {}).map((k) => [k, { mode: 'access', vlan: 1, native: 1, allowed: 'all', shut: false }])), stp: { on: true, prio: 32768 }, svis: {}, routes: [], snoop: { on: false, vlans: [] }, poe: { budget: 370 } });
  Object.assign(d, keep);
  if (d.kind === 'sw') Object.values(d.ports || {}).forEach((p) => { delete p.err; });
}
/** A link that goes down and up makes DHCP clients behind it ask again */
function flap(L, dev, port) {
  const seen = new Set(), q = [peerOf(L, dev, port)];
  while (q.length) { const pr = q.shift(); if (!pr || seen.has(pr.dev)) continue; seen.add(pr.dev); const D = L.devs[pr.dev]; if (!D || D.kind === 'sw') continue;
    if (D.nics && !Array.isArray(D.nics)) Object.values(D.nics).forEach((c) => { if (c.dhcp) { c.ip = null; c.tried = false; c.apipa = null; c.dup = false; } });
    if (D.kind === 'phone') q.push(peerOf(L, D.id, 'pc'));
    if (D.kind === 'hub') Object.keys(D.ports).forEach((p2) => q.push(peerOf(L, D.id, p2)));
  }
}
function flapAll(L, d) { if (d.ports) Object.keys(d.ports).forEach((pn) => flap(L, d.id, pn)); if (d.ifs) Object.keys(d.ifs).forEach((pn) => flap(L, d.id, pn)); settle(L); }

// ---------------------------------------------------------------- show command output
function iosShow(L, d, p, a) {
  const sw = d.kind === 'sw', P = sw ? d.ports : {};
  const st = (pn) => { const p = P[pn]; if (p.err) return 'err-disabled'; if (p.susp) return 'suspended'; if (p.shut) return 'disabled'; return linkUp(L, d.id, pn) ? 'connected' : 'notconnect'; };
  const nm = (dd) => dd ? `${dd.hostname || dd.name}` : '';
  switch (p) {
    case 'version': return `Cisco IOS Software, ${sw ? 'C9200L' : 'ISR4300'} Software, Version 17.9.4, RELEASE SOFTWARE (fc2)\nTechnical Support: http://www.cisco.com/techsupport\n\nROM: IOS-XE ROMMON\n${d.hostname} uptime is 3 weeks, 2 days, 4 hours, 11 minutes\nSystem image file is "flash:packages.conf"\n\ncisco ${sw ? 'C9200L-24P-4G' : 'ISR4331/K9'} processor with 1048576K bytes of memory.\n${sw ? `24 Gigabit Ethernet interfaces\n4 Ten Gigabit Ethernet interfaces\nBase Ethernet MAC Address          : ${d.mac.toUpperCase()}` : '3 Gigabit Ethernet interfaces'}\nConfiguration register is 0x102\n`;
    case 'clock': return `*${new Date(Date.UTC(2026, 9, 21, 9, 0, 0) + L.clock).toUTCString().slice(17, 25)}.000 IST Wed Oct 21 2026\n`;
    case 'running-config': case 'running-config interface <if>': return runCfg(L, d, a[0] && ifNorm(a[0]));
    case 'startup-config': return d.startup ? `Using ${JSON.stringify(d.startup).length} out of 524288 bytes\n` + runCfg(L, d.startup.ports || d.startup.ifs ? { ...d, ...d.startup } : d).replace('Building configuration...\n\nCurrent configuration', 'Current configuration') : 'startup-config is not present\n';
    case 'vlan brief': case 'vlan': { if (!sw) return '% VLANs are on switches\n'; let o = '\nVLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n'; Object.keys(d.vlans).map(Number).sort((x, y) => x - y).forEach((v) => { const ports = Object.keys(P).filter((pn) => P[pn].mode === 'access' && +P[pn].vlan === v && !P[pn].routed && !(P[pn].cg && L._po?.[`${d.id}|${P[pn].cg}`]?.ok)); const ch = []; for (let i = 0; i < ports.length; i += 4) ch.push(ports.slice(i, i + 4).join(', ')); o += `${pad(v, 5)}${pad(d.vlans[v], 33)}${pad('active', 10)}${ch[0] || ''}\n` + ch.slice(1).map((c) => `${' '.repeat(48)}${c}\n`).join(''); }); return o + '1002 fddi-default                     act/unsup\n1003 token-ring-default               act/unsup\n'; }
    case 'interfaces status': case 'interfaces status err-disabled': { let o = p.endsWith('err-disabled') ? '\nPort         Name               Status       Reason               Err-disabled Vlans\n' : '\nPort         Name               Status       Vlan       Duplex  Speed Type\n'; Object.keys(P).forEach((pn) => { if (p.endsWith('err-disabled')) { if (P[pn].err) o += `${pad(pn, 13)}${pad((P[pn].desc || '').slice(0, 18), 19)}${pad('err-disabled', 13)}${P[pn].err}\n`; return; } const s = st(pn); const v = P[pn].routed ? 'routed' : P[pn].mode === 'trunk' ? 'trunk' : P[pn].vlan; o += `${pad(pn, 13)}${pad((P[pn].desc || '').slice(0, 18), 19)}${pad(s, 13)}${pad(v, 11)}${pad(s === 'connected' ? 'a-full' : 'auto', 8)}${pad(s === 'connected' ? (pn.startsWith('Te') ? 'a-10G' : 'a-1000') : 'auto', 7)}${pn.startsWith('Te') ? 'SFP-10GBase-SR' : '10/100/1000BaseTX'}\n`; }); return o; }
    case 'interfaces trunk': { const T = Object.keys(P).filter((pn) => P[pn].mode === 'trunk' && st(pn) === 'connected'); if (!T.length) return ''; const vl = (pn) => (P[pn].allowed === 'all' ? '1-4094' : vlanListStr(parseVlanList(P[pn].allowed))); const act = (pn) => { const al = P[pn].allowed === 'all' ? Object.keys(d.vlans).map(Number) : parseVlanList(P[pn].allowed).filter((v) => d.vlans[v]); return vlanListStr(al) || 'none'; }; let o = `\nPort        Mode             Encapsulation  Status        Native vlan\n${T.map((pn) => `${pad(pn, 12)}${pad('on', 17)}${pad('802.1q', 15)}${pad('trunking', 14)}${P[pn].native}`).join('\n')}\n\nPort        Vlans allowed on trunk\n${T.map((pn) => `${pad(pn, 12)}${vl(pn)}`).join('\n')}\n\nPort        Vlans allowed and active in management domain\n${T.map((pn) => `${pad(pn, 12)}${act(pn)}`).join('\n')}\n\nPort        Vlans in spanning tree forwarding state and not pruned\n${T.map((pn) => `${pad(pn, 12)}${stpBlocked(L, d.id, pn) ? 'none' : P[pn].pvidInc ? `${act(pn)} (VLAN ${P[pn].native} blocked – PVID inconsistent)` : act(pn)}`).join('\n')}\n`; return o; }
    case 'interfaces <if> switchport': { const n = ifNorm(a[0]); const q = P[n]; if (!q) return '% Invalid interface\n'; return `Name: ${n}\nSwitchport: Enabled\nAdministrative Mode: ${q.mode === 'trunk' ? 'trunk' : 'static access'}\nOperational Mode: ${st(n) === 'connected' ? (q.mode === 'trunk' ? 'trunk' : 'static access') : 'down'}\nAdministrative Trunking Encapsulation: dot1q\nNegotiation of Trunking: Off\nAccess Mode VLAN: ${q.vlan} (${d.vlans[q.vlan] || 'Inactive'})\nTrunking Native Mode VLAN: ${q.native} (${d.vlans[q.native] || 'Inactive'})\nVoice VLAN: ${q.voice != null ? `${q.voice} (${d.vlans[q.voice] || 'Inactive'})` : 'none'}\nTrunking VLANs Enabled: ${q.allowed === 'all' ? 'ALL' : vlanListStr(parseVlanList(q.allowed))}\n`; }
    case 'interfaces counters errors': return `\nPort        Align-Err     FCS-Err    Xmit-Err     Rcv-Err  UnderSize  OutDiscards\n${Object.keys(P).map((pn) => `${pad(pn, 12)}${lpad(d.crc?.[pn] ? 0 : 0, 9)}${lpad(d.crc?.[pn] || 0, 12)}${lpad(0, 12)}${lpad(d.crc?.[pn] || 0, 12)}${lpad(0, 11)}${lpad(0, 13)}`).join('\n')}\n`;
    case 'interfaces description': return `Interface                      Status         Protocol Description\n${(sw ? Object.keys(P) : Object.keys(d.ifs)).map((pn) => { const up = sw ? st(pn) === 'connected' : !d.ifs[pn].shut && linkUp(L, d.id, pn.split('.')[0]); return `${pad(pn, 31)}${pad(sw ? (P[pn].shut ? 'admin down' : up ? 'up' : 'down') : d.ifs[pn].shut ? 'admin down' : up ? 'up' : 'down', 15)}${pad(up ? 'up' : 'down', 9)}${(sw ? P[pn].desc : d.ifs[pn].desc) || ''}`; }).join('\n')}\n`;
    case 'interfaces <if>': case 'ip interface <if>': { const n = ifNorm(a[0]); if (!n) return '% Invalid interface\n'; return ifDetail(L, d, n, p.startsWith('ip')); }
    case 'interfaces': return (sw ? Object.keys(P) : Object.keys(d.ifs)).map((n) => ifDetail(L, d, n)).join('');
    case 'mac address-table': case 'mac address-table dynamic': case 'mac address-table interface <if>': case 'mac address-table vlan <n>': case 'mac address-table address <w>': {
      if (!sw) return '% Invalid input\n';
      let E = Object.entries(L.mac[d.id] || {}).map(([k, port]) => { const [v, mac] = k.split('|'); return { v, mac, port }; });
      Object.entries(P).forEach(([pn, q]) => (q.ps?.sticky || q.ps?.static) && (q.ps.macs || []).forEach((m) => { if (!E.some((e) => e.mac === m)) E.push({ v: q.vlan, mac: m, port: pn, st: true }); }));
      if (a[0] && p.endsWith('interface <if>')) E = E.filter((e) => e.port === ifNorm(a[0]));
      if (a[0] && p.endsWith('vlan <n>')) E = E.filter((e) => +e.v === +a[0]);
      if (a[0] && p.endsWith('address <w>')) E = E.filter((e) => macCisco(e.mac) === a[0].toLowerCase() || e.mac === a[0].toLowerCase());
      if (L._storm && [...L._storm].some((k) => k.startsWith(`${d.id}|`))) { const v = [...L._storm].find((k) => k.startsWith(`${d.id}|`)).split('|')[1]; return `          Mac Address Table\n-------------------------------------------\n\nVlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n${E.filter((e) => e.v === v).map((e, i) => `${lpad(e.v, 4)}    ${macCisco(e.mac)}    DYNAMIC     ${Object.keys(P)[(i + L.clock / 7) % Object.keys(P).length | 0]}`).join('\n')}\n(the table keeps changing – the same MAC addresses jump between ports)\nTotal Mac Addresses for this criterion: ${E.length}\n`; }
      return `          Mac Address Table\n-------------------------------------------\n\nVlan    Mac Address       Type        Ports\n----    -----------       --------    -----\n${E.sort((x, y) => x.v - y.v || (x.port < y.port ? -1 : 1)).map((e) => `${lpad(e.v, 4)}    ${macCisco(e.mac)}    ${e.st ? 'STATIC ' : 'DYNAMIC'}     ${e.port.startsWith('Gi') && P[e.port]?.cg && L._po?.[`${d.id}|${P[e.port].cg}`]?.ok ? `Po${P[e.port].cg}` : e.port}`).join('\n')}\nTotal Mac Addresses for this criterion: ${E.length}\n`;
    }
    case 'spanning-tree': case 'spanning-tree vlan <n>': case 'spanning-tree interface <if>': case 'spanning-tree summary': case 'spanning-tree blockedports': return stpShow(L, d, p, a);
    case 'etherchannel summary': { const G = Object.values(L._po || {}).filter((g) => g.dev === d.id); let o = 'Flags:  D - down        P - bundled in port-channel\n        I - stand-alone s - suspended\n        S - Layer2      U - in use     f - failed to allocate aggregator\n\nNumber of channel-groups in use: ' + G.length + '\nNumber of aggregators:           ' + G.length + '\n\nGroup  Port-channel  Protocol    Ports\n------+-------------+-----------+-----------------------------------------------\n'; G.forEach((g) => { const mem = Object.keys(P).filter((pn) => P[pn].cg === g.cg); o += `${pad(g.cg, 7)}${pad(`Po${g.cg}(${g.ok ? 'SU' : 'SD'})`, 14)}${pad(g.mode === 'on' ? '-' : 'LACP', 12)}${mem.map((pn) => `${pn}(${P[pn].err ? 'D' : P[pn].susp ? 's' : !linkUp(L, d.id, pn) ? 'D' : g.ok ? 'P' : 'I'})`).join(' ')}\n`; }); return o; }
    case 'lacp neighbor': return Object.values(L._po || {}).filter((g) => g.dev === d.id && g.mode !== 'on').map((g) => `Channel group ${g.cg} neighbors\n\nPort      Flags   Priority  Dev ID          Age  key  Key  Number  State\n${g.mem.map((pn) => { const pr = peerOf(L, d.id, pn), D = pr && L.devs[pr.dev]; const om = D?.ports?.[pr.port]?.cgm; return `${pad(pn, 10)}${pad(om === 'active' ? 'SA' : om === 'passive' ? 'SP' : '-', 8)}${pad(32768, 10)}${pad(D ? macCisco(D.mac) : '-', 16)}${pad('12s', 5)}0x0  0x${g.cg}  0x10${pn.slice(-1)}  0x3D`; }).join('\n')}\n`).join('\n') || '';
    case 'port-security': return `Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action\n                (Count)       (Count)          (Count)\n---------------------------------------------------------------------------\n${Object.entries(P).filter(([, q]) => q.ps?.on).map(([pn, q]) => `${lpad(pn, 11)}${lpad(q.ps.max ?? 1, 15)}${lpad((q.ps.macs || []).length, 13)}${lpad(q.ps.viols || 0, 19)}         ${pad(q.ps.viol === 'restrict' ? 'Restrict' : q.ps.viol === 'protect' ? 'Protect' : 'Shutdown', 9)}`).join('\n')}\n---------------------------------------------------------------------------\n`;
    case 'port-security interface <if>': { const n = ifNorm(a[0]), q = P[n]; if (!q) return '% Invalid interface\n'; return `Port Security              : ${q.ps?.on ? 'Enabled' : 'Disabled'}\nPort Status                : ${q.err === 'psecure-violation' ? 'Secure-shutdown' : q.ps?.on && linkUp(L, d.id, n) ? 'Secure-up' : 'Secure-down'}\nViolation Mode             : ${q.ps?.viol === 'restrict' ? 'Restrict' : q.ps?.viol === 'protect' ? 'Protect' : 'Shutdown'}\nAging Time                 : 0 mins\nMaximum MAC Addresses      : ${q.ps?.max ?? 1}\nTotal MAC Addresses        : ${(q.ps?.macs || []).length}\nConfigured MAC Addresses   : ${q.ps?.static ? (q.ps.macs || []).length : 0}\nSticky MAC Addresses       : ${q.ps?.sticky ? (q.ps.macs || []).length : 0}\nLast Source Address:Vlan   : ${q.ps?.last ? macCisco(q.ps.last) + ':' + q.vlan : '0000.0000.0000:0'}\nSecurity Violation Count   : ${q.ps?.viols || 0}\n`; }
    case 'port-security address': return `               Secure Mac Address Table\n-----------------------------------------------------------------------------\nVlan    Mac Address       Type                          Ports   Remaining Age\n----    -----------       ----                          -----   -------------\n${Object.entries(P).filter(([, q]) => q.ps?.on).flatMap(([pn, q]) => (q.ps.macs || []).map((m) => `${lpad(q.vlan, 4)}    ${macCisco(m)}    ${pad(q.ps.sticky ? 'SecureSticky' : q.ps.static ? 'SecureConfigured' : 'SecureDynamic', 30)}${pad(pn, 8)}    -`)).join('\n')}\n`;
    case 'ip interface brief': { let o = 'Interface              IP-Address      OK? Method Status                Protocol\n'; const rows = sw ? [...Object.keys(d.svis).map((v) => `Vlan${v}`), ...Object.keys(P)] : Object.keys(d.ifs); rows.forEach((n) => { let ip = 'unassigned', s = 'down', pr = 'down'; if (n.startsWith('Vlan')) { const c = d.svis[n.slice(4)]; ip = c.ip || 'unassigned'; const u = !c.shut && sviUp(L, d, +n.slice(4)); s = c.shut ? 'administratively down' : 'up'; pr = u ? 'up' : 'down'; } else if (sw) { const x = st(n); s = x === 'disabled' ? 'administratively down' : x === 'connected' ? 'up' : 'down'; pr = x === 'connected' ? 'up' : 'down'; } else { const c = d.ifs[n]; ip = c.ip || 'unassigned'; const ph = n.split('.')[0], up = !c.shut && !d.ifs[ph].shut && (c.loop || linkUp(L, d.id, ph)); s = c.shut ? 'administratively down' : up || c.loop ? 'up' : 'down'; pr = up ? 'up' : 'down'; } o += `${pad(n.replace(/^Gi/, 'GigabitEthernet').replace(/^Te/, 'TenGigabitEthernet').replace(/^Fa/, 'FastEthernet'), 22)} ${pad(ip, 16)}${pad('YES', 4)}${pad(ip === 'unassigned' ? 'unset' : 'manual', 7)}${pad(s, 22)}${pr}\n`; }); return o; }
    case 'ip route': case 'ip route <ip>': { if (sw && !d.iprouting) return d.defgw ? `Default gateway is ${d.defgw}\n\nHost               Gateway           Last Use    Total Uses  Interface\nICMP redirect cache is empty\n` : 'Default gateway is not set\n'; const R = routesOf(L, d); const dflt = R.find((r) => r.net === '0.0.0.0'); let o = 'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP\n       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area\n       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2\n       E1 - OSPF external type 1, E2 - OSPF external type 2\n       * - candidate default, U - per-user static route, o - ODR\n\n' + (dflt ? `Gateway of last resort is ${dflt.via ?? '0.0.0.0'} to network 0.0.0.0\n\n` : 'Gateway of last resort is not set\n\n');
      const list = a[0] ? R.filter((r) => inNet(a[0], r.net, r.mask)) : R; list.sort((x, y) => ip2n(x.net) - ip2n(y.net) || mask2len(x.mask) - mask2len(y.mask)).forEach((r) => { const ln = mask2len(r.mask); if (r.type === 'C') { o += `C        ${r.net}/${ln} is directly connected, ${ifLong(r.ifn)}\nL        ${r.ep.ip}/32 is directly connected, ${ifLong(r.ifn)}\n`; } else if (r.type === 'S') o += `S${r.net === '0.0.0.0' ? '*' : ' '}       ${r.net}/${ln} [${r.ad}/0] ${r.via ? `via ${r.via}` : `is directly connected, ${ifLong(r.ifn)}`}\n`; else o += `${r.type === 'O' ? 'O       ' : 'O*E2    '} ${r.net}/${ln} [110/${r.cost}] via ${r.via}, 00:${String(12 + (L.clock / 1000 | 0) % 47).padStart(2, '0')}:31, ${ifLong(r.ifn)}\n`; }); return a[0] && !list.length ? '% Network not in table\n' : o; }
    case 'ip ospf neighbor': { const n = L._ospf?.neigh?.[d.id] || []; return `\nNeighbor ID     Pri   State           Dead Time   Address         Interface\n${n.map((x) => `${pad(x.rid, 16)}${pad('  1', 6)}${pad('FULL/DR', 16)}${pad('00:00:3' + (L.clock % 9), 12)}${pad(x.ip, 16)}${ifLong(x.ifn)}`).join('\n')}\n`; }
    case 'ip ospf interface brief': case 'ip ospf interface': { if (!d.ospf) return ''; const E = l3ifs(L, d).filter((e) => e.ip && (d.ospf.nets || []).some((x) => inNet(e.ip, x.net, wild2mask(x.wild)))); return `Interface    PID   Area            IP Address/Mask    Cost  State Nbrs F/C\n${E.map((e) => { const x = d.ospf.nets.find((y) => inNet(e.ip, y.net, wild2mask(y.wild))); const nb = (L._ospf?.neigh?.[d.id] || []).filter((q) => q.ifn === e.ifn).length; const pas = (d.ospf.passive || []).includes(e.ifn) || (d.ospf.passiveDefault && !(d.ospf.nopassive || []).includes(e.ifn)); return `${pad(e.ifn, 13)}${pad(d.ospf.pid, 6)}${pad(x.area, 16)}${pad(`${e.ip}/${mask2len(e.mask)}`, 19)}${pad(1, 6)}${pad(e.up ? (pas ? 'DR' : nb ? 'DR' : 'DR') : 'DOWN', 6)}${nb}/${nb}${pas ? '   (passive)' : ''}`; }).join('\n')}\n`; }
    case 'ip protocols': return d.ospf ? `*** IP Routing is NSF aware ***\n\nRouting Protocol is "ospf ${d.ospf.pid}"\n  Outgoing update filter list for all interfaces is not set\n  Incoming update filter list for all interfaces is not set\n  Router ID ${rid(d)}\n  Number of areas in this router is 1. 1 normal 0 stub 0 nssa\n  Maximum path: 4\n  Routing for Networks:\n${(d.ospf.nets || []).map((x) => `    ${x.net} ${x.wild} area ${x.area}`).join('\n')}\n${(d.ospf.passive || []).length || d.ospf.passiveDefault ? `  Passive Interface(s):\n${d.ospf.passiveDefault ? '    (all, by default)\n' : ''}${(d.ospf.passive || []).map((x) => `    ${ifLong(x)}`).join('\n')}\n` : ''}  Routing Information Sources:\n    Gateway         Distance      Last Update\n${(L._ospf?.neigh?.[d.id] || []).map((x) => `    ${pad(x.rid, 16)}${pad(110, 14)}00:04:12`).join('\n')}\n  Distance: (default is 110)\n` : '';
    case 'ip dhcp binding': return `Bindings from all pools not associated with VRF:\nIP address      Client-ID/              Lease expiration        Type       State      Interface\n                Hardware address/\n                User name\n${Object.entries(d.dhcp?.bind || {}).map(([mac, ip]) => `${pad(ip, 16)}01${macCisco(mac).replace(/\./g, '.')}  ${pad('Oct 22 2026 09:14 AM', 24)}${pad('Automatic', 11)}${pad('Active', 11)}${d.kind === 'rt' ? Object.keys(d.ifs).find((k) => d.ifs[k].ip && inNet(ip, d.ifs[k].ip, d.ifs[k].mask)) || '' : ''}`).join('\n')}\n`;
    case 'ip dhcp pool': return Object.entries(d.dhcp?.pools || {}).map(([n, q]) => { const tot = q.net ? hostsIn(q.mask) : 0, used = Object.values(d.dhcp.bind || {}).filter((ip) => q.net && inNet(ip, q.net, q.mask)).length; return `\nPool ${n} :\n Utilization mark (high/low)    : 100 / 0\n Subnet size (first/next)       : 0 / 0\n Total addresses                : ${tot}\n Leased addresses               : ${used}\n Excluded addresses             : ${(d.dhcp.excl || []).reduce((s, [x, y]) => s + (q.net && inNet(x, q.net, q.mask) ? ip2n(y) - ip2n(x) + 1 : 0), 0)}\n Pending event                  : none\n 1 subnet is currently in the pool :\n Current index        IP address range                    Leased/Excluded/Total\n ${pad(q.net ? n2ip(ip2n(q.net) + 1) : '-', 21)}${pad(q.net ? `${n2ip(ip2n(q.net) + 1)}     - ${n2ip(ip2n(bcastOf(q.net, q.mask)) - 1)}` : '(no network configured)', 36)}${used} / 0 / ${tot}\n${q.gw ? '' : ' (no default-router configured – clients get no gateway)\n'}`; }).join('') || '';
    case 'ip dhcp conflict': return 'IP address        Detection method   Detection time          VRF\n';
    case 'ip dhcp server statistics': return `Memory usage         41982\nAddress pools        ${Object.keys(d.dhcp?.pools || {}).length}\nDatabase agents      0\nAutomatic bindings   ${Object.keys(d.dhcp?.bind || {}).length}\n`;
    case 'ip dhcp snooping': return `Switch DHCP snooping is ${d.snoop?.on ? 'enabled' : 'disabled'}\nDHCP snooping is configured on following VLANs:\n${vlanListStr(d.snoop?.vlans || []) || 'none'}\nDHCP snooping is operational on following VLANs:\n${d.snoop?.on ? vlanListStr(d.snoop?.vlans || []) || 'none' : 'none'}\nInsertion of option 82 is enabled\nVerification of hwaddr field is enabled\n\nInterface                  Trusted    Allow option    Rate limit (pps)\n-----------------------    -------    ------------    ----------------\n${Object.entries(P).filter(([, q]) => q.trust).map(([pn]) => `${pad(ifLong(pn), 27)}${pad('yes', 11)}${pad('yes', 16)}unlimited`).join('\n')}\n`;
    case 'ip dhcp snooping binding': { const rows = []; if (d.snoop?.on) Object.entries(L.mac[d.id] || {}).forEach(([k, port]) => { const [v, mac] = k.split('|'); if (!(d.snoop.vlans || []).map(String).includes(v)) return; const h = Object.values(L.devs).find((x) => x.nics && !Array.isArray(x.nics) && Object.values(x.nics).some((c) => c.mac === mac && c.dhcp && c.ip)); if (h) { const c = Object.values(h.nics).find((q) => q.mac === mac); rows.push(`${pad(mac.toUpperCase(), 20)}${pad(c.ip, 17)}${pad('86012', 12)}${pad('dhcp-snooping', 15)}${pad(v, 6)}${ifLong(port)}`); } }); return `MacAddress          IpAddress        Lease(sec)  Type           VLAN  Interface\n------------------  ---------------  ----------  -------------  ----  --------------------\n${rows.join('\n')}\nTotal number of bindings: ${rows.length}\n`; }
    case 'ip nat translations': return `Pro Inside global      Inside local       Outside local      Outside global\n${(d.nat?.statics || []).map((s) => `${pad(s.proto || '---', 4)}${pad(s.outside + (s.oport ? ':' + s.oport : ''), 20)}${pad(s.inside + (s.iport ? ':' + s.iport : ''), 19)}${pad('---', 19)}---`).concat((d.nat?.xlate || []).slice(-12).map((x) => `${pad(x.proto === 'icmp' ? 'icmp' : x.proto, 4)}${pad(`${x.to}:${1024 + (ip2n(x.from) % 3000)}`, 20)}${pad(`${x.from}:${1 + (ip2n(x.from) % 60)}`, 19)}${pad('8.8.8.8:53', 19)}8.8.8.8:53`)).join('\n')}\n`;
    case 'ip nat statistics': return `Total active translations: ${(d.nat?.xlate || []).length + (d.nat?.statics || []).length} (${(d.nat?.statics || []).length} static, ${(d.nat?.xlate || []).length} dynamic; ${(d.nat?.xlate || []).length} extended)\nOutside interfaces:\n  ${Object.keys(d.ifs || {}).filter((k) => d.ifs[k].nat === 'outside').map(ifLong).join(', ') || '(none)'}\nInside interfaces:\n  ${Object.keys(d.ifs || {}).filter((k) => d.ifs[k].nat === 'inside').map(ifLong).join(', ') || '(none)'}\nDynamic mappings:\n-- Inside Source\n${(d.nat?.rules || []).map((r) => `[Id: 1] access-list ${r.acl} interface ${ifLong(r.ifn)} refcount ${(d.nat?.xlate || []).length}${d.acls?.[r.acl] ? '' : '   (access-list ' + r.acl + ' does not exist – nothing is translated)'}`).join('\n')}\n`;
    case 'access-lists': case 'ip access-lists': return Object.entries(d.acls || {}).map(([n, A]) => `${/^\d+$/.test(n) ? (+n < 100 ? 'Standard' : 'Extended') : A[0]?.std ? 'Standard' : 'Extended'} IP access list ${n}\n${A.map((r, i) => `    ${r.seq ?? (i + 1) * 10} ${r.act} ${r.std ? (r.src === 'any' ? 'any' : r.src.host ? `host ${r.src.host}` : `${r.src.net}, wildcard bits ${r.src.wild}`) : `${r.proto} ${r.src === 'any' ? 'any' : aclA(r.src)} ${r.dst === 'any' ? 'any' : aclA(r.dst)}${r.eq ? ` eq ${Object.keys(PORTS).find((k) => PORTS[k] === r.eq) || r.eq}` : ''}`}${r.hits ? ` (${r.hits} matches)` : ''}`).join('\n')}\n`).join('');
    case 'cdp neighbors': case 'cdp neighbors detail': { const rows = (sw ? Object.keys(P) : Object.keys(d.ifs).filter((k) => !k.includes('.'))).map((pn) => { const pr = linkUp(L, d.id, pn) && peerOf(L, d.id, pn); const D = pr && L.devs[pr.dev]; if (!D || !['sw', 'rt', 'phone', 'ap', 'fw'].includes(D.kind) || D.cdpOff) return null; return { pn, D, pr }; }).filter(Boolean); if (p.endsWith('detail')) return rows.map(({ pn, D, pr }) => `-------------------------\nDevice ID: ${nm(D)}\nEntry address(es):\n  IP address: ${l3ifs(L, D).find((e) => e.ip)?.ip || '(none)'}\nPlatform: ${{ sw: 'cisco C9200L-24P-4G', rt: 'cisco ISR4331', phone: 'Cisco IP Phone 8841', ap: 'cisco AIR-AP2802I', fw: 'FortiGate-60F' }[D.kind]},  Capabilities: ${{ sw: 'Switch IGMP', rt: 'Router', phone: 'Host Phone', ap: 'Trans-Bridge', fw: 'Router' }[D.kind]}\nInterface: ${ifLong(pn)},  Port ID (outgoing port): ${D.kind === 'phone' ? 'Port 1' : ifLong(pr.port)}\nNative VLAN: ${D.ports?.[pr.port]?.native ?? 1}\nDuplex: full\n${D.kind === 'phone' ? `Power drawn: ${D.poe ?? 6.3} Watts\n` : ''}`).join('\n') + '\n'; return `Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge\n                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone\n\nDevice ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\n${rows.map(({ pn, D, pr }) => `${pad(nm(D), 17)}${pad(pn.replace('Gi', 'Gig '), 18)}${pad(153, 11)}${pad({ sw: 'S I', rt: 'R', phone: 'H P', ap: 'T', fw: 'R' }[D.kind], 12)}${pad({ sw: 'C9200L', rt: 'ISR4331', phone: 'CP-8841', ap: 'AIR-AP28', fw: 'FGT60F' }[D.kind], 10)}${D.kind === 'phone' ? 'Port 1' : pr.port.replace('Gi', 'Gig ')}`).join('\n')}\n\nTotal cdp entries displayed : ${rows.length}\n`; }
    case 'lldp neighbors': { const rows = (sw ? Object.keys(P) : Object.keys(d.ifs)).map((pn) => { const pr = linkUp(L, d.id, pn) && peerOf(L, d.id, pn); const D = pr && L.devs[pr.dev]; return D ? `${pad(nm(D), 21)}${pad(pn, 16)}${pad(120, 11)}${pad({ sw: 'B,R', rt: 'R', phone: 'T', ap: 'W', fw: 'R', srv: 'S', pc: '', hv: 'S' }[D.kind] ?? '', 13)}${pr.port}` : null; }).filter(Boolean); return `Capability codes:\n    (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device\n    (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other\n\nDevice ID           Local Intf     Hold-time  Capability      Port ID\n${rows.join('\n')}\n\nTotal entries displayed: ${rows.length}\n`; }
    case 'logging': { const lg = L.log.filter((x) => x.dev === d.id); return `Syslog logging: enabled (0 messages dropped, 0 flushes, 0 overruns)\n    Console logging: level debugging, ${lg.length} messages logged\n    Trap logging: level ${d.syslogLevel || 'informational'}, ${lg.length} message lines logged\n        Logging to ${d.syslog || '(no syslog server configured)'}${d.syslog ? '  (udp port 514, audit disabled, link up)' : ''}\n\nLog Buffer (8192 bytes):\n\n${lg.slice(-40).map((x) => `*Oct 21 ${new Date(Date.UTC(2026, 9, 21, 9) + x.t).toISOString().slice(11, 19)}.${String(x.t % 1000).padStart(3, '0')}: ${x.msg}`).join('\n')}\n`; }
    case 'power inline': { if (!sw) return ''; const A = poeAlloc(L, d); let o = `\nModule   Available     Used     Remaining\n          (Watts)     (Watts)    (Watts)\n------   ---------   --------   ---------\n1           ${lpad(d.poe.budget.toFixed(1), 6)}      ${lpad(A.used.toFixed(1), 6)}      ${lpad((d.poe.budget - A.used).toFixed(1), 6)}\nInterface Admin  Oper       Power   Device              Class Max\n                            (Watts)\n--------- ------ ---------- ------- ------------------- ----- ----\n`; Object.keys(P).forEach((pn) => { const pr = peerOf(L, d.id, pn), D = pr && L.devs[pr.dev]; const on = A.ok.has(pn), deny = A.deny.has(pn); o += `${pad(pn, 10)}${pad(P[pn].poeOff ? 'off' : 'auto', 7)}${pad(P[pn].poeOff ? 'off' : on ? 'on' : deny ? 'faulty' : 'off', 11)}${lpad(on ? D.poe.toFixed(1) : '0.0', 7)} ${pad(on || deny ? ({ phone: 'IP Phone 8841', ap: 'AIR-AP2802I', cam: 'IP camera' }[D.kind] || 'Ieee PD') : 'n/a', 20)}${pad(on ? (D.poe > 15.4 ? 4 : 3) : 'n/a', 6)}30.0${deny ? '   (power denied – budget exceeded)' : ''}\n`; }); return o; }
    case 'errdisable recovery': return `ErrDisable Reason            Timer Status\n-----------------            --------------\n${['bpduguard', 'psecure-violation', 'channel-misconfig', 'link-flap', 'dhcp-rate-limit'].map((c) => `${pad(c, 29)}${(d.errRec?.causes || []).includes(c) ? 'Enabled' : 'Disabled'}`).join('\n')}\n\nTimer interval: ${d.errRec?.interval ?? 300} seconds\n\nInterfaces that will be enabled at the next timeout:\n`;
    case 'arp': case 'ip arp': return `Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n${l3ifs(L, d).filter((e) => e.ip && e.up).map((e) => `Internet  ${pad(e.ip, 17)}${pad('-', 11)}${pad(macCisco(e.mac), 16)}ARPA   ${ifLong(e.ifn)}`).concat(Object.entries(L.arp[d.id] || {}).map(([ip, x]) => `Internet  ${pad(ip, 17)}${pad(Math.max(0, ((L.clock - x.t) / 60000) | 0), 11)}${pad(x.mac ? macCisco(x.mac) : 'Incomplete', 16)}ARPA   ${ifLong(x.ifn)}`)).join('\n')}\n`;
    case 'snmp': return d.snmp?.community ? `Chassis: FOC2219X0AB\nContact: ${d.snmp.contact || ''}\nLocation: ${d.snmp.location || ''}\n${(d.snmpIn ?? 0)} SNMP packets input\n    0 Bad SNMP version errors\n    ${d.snmpBad ?? 0} Unknown community name\nSNMP logging: ${d.snmp.host ? `enabled\n    Logging to ${d.snmp.host}.162, 0/10, 0 sent, 0 dropped.` : 'disabled'}\n` : '%SNMP agent not enabled\n';
    case 'ntp status': return d.ntp ? `Clock is synchronized, stratum 3, reference is ${d.ntp}\nnominal freq is 250.0000 Hz, actual freq is 249.9989 Hz, precision is 2**10\n` : 'Clock is unsynchronized, stratum 16, no reference clock\n';
    case 'users': return '    Line       User       Host(s)              Idle       Location\n*  0 con 0                idle                 00:00:00\n';
    case 'history': return '';
    case 'ip helper-address': return '';
  }
  return '';
}
function ifDetail(L, d, n, ipOnly) {
  const sw = d.kind === 'sw'; const p = sw ? d.ports[n] : d.ifs[n]; if (!p && !n.startsWith('Vlan')) return '% Invalid interface\n';
  if (n.startsWith('Vlan')) { const c = d.svis[n.slice(4)]; if (!c) return '% Invalid interface\n'; const u = !c.shut && sviUp(L, d, +n.slice(4)); return `Vlan${n.slice(4)} is ${c.shut ? 'administratively down' : 'up'}, line protocol is ${u ? 'up' : 'down'}\n  Hardware is Ethernet SVI, address is ${macCisco(d.mac)}\n  Internet address is ${c.ip ? `${c.ip}/${mask2len(c.mask)}` : 'not set'}\n${c.helper?.length ? `  Helper address is ${c.helper.join(', ')}\n` : ''}${u ? '' : `  (VLAN ${n.slice(4)} ${d.vlans[n.slice(4)] ? 'has no port up and forwarding' : 'does not exist in the VLAN database'})\n`}`; }
  const ph = n.split('.')[0], up = sw ? !p.shut && !p.err && linkUp(L, d.id, n) : !p.shut && linkUp(L, d.id, ph);
  const state = sw ? (p.err ? `down, line protocol is down (err-disabled)` : p.shut ? 'administratively down, line protocol is down (disabled)' : up ? 'up, line protocol is up (connected)' : 'down, line protocol is down (notconnect)') : (p.shut ? 'administratively down, line protocol is down' : up ? 'up, line protocol is up' : 'down, line protocol is down');
  const storm = sw && [...(L._storm || [])].some((k) => k.startsWith(`${d.id}|`)) && up;
  const ctr = (k, base) => (storm ? base * 9431 + (L.clock % 977) : base + ((ip2n(d.mac.replace(/:/g, '').slice(0, 8).match(/../g).map((x) => parseInt(x, 16)).join('.')) % 900) | 0));
  const crc = d.crc?.[n] || 0;
  if (ipOnly) return `${ifLong(n)} is ${state.replace(', line protocol is', ', line protocol is')}\n  Internet address is ${p.ip ? `${p.ip}/${mask2len(p.mask)}` : 'not set'}\n  Broadcast address is 255.255.255.255\n  MTU is ${p.mtu ?? 1500} bytes\n  Helper address is ${(p.helper || []).join(', ') || 'not set'}\n  Outgoing Common access list is not set\n  Outgoing access list is ${p.aclOut ?? 'not set'}\n  Inbound  access list is ${p.aclIn ?? 'not set'}\n  Proxy ARP is enabled\n  Network address translation is ${p.nat ? `enabled, interface in domain ${p.nat}` : 'disabled'}\n`;
  return `${ifLong(n)} is ${state}\n  Hardware is ${n.startsWith('Te') ? 'Ten Gigabit Ethernet' : 'Gigabit Ethernet'}, address is ${macCisco(p.mac || d.mac)} (bia ${macCisco(p.mac || d.mac)})\n${p.desc ? `  Description: ${p.desc}\n` : ''}${!sw && p.ip ? `  Internet address is ${p.ip}/${mask2len(p.mask)}\n` : ''}  MTU ${p.mtu ?? 1500} bytes, BW ${n.startsWith('Te') ? 10000000 : 1000000} Kbit/sec, DLY 10 usec,\n     reliability 255/255, txload ${storm ? 255 : 1}/255, rxload ${storm ? 255 : 1}/255\n  Encapsulation ${n.includes('.') ? `802.1Q Virtual LAN, Vlan ID  ${p.dot1q ?? '?'}.` : 'ARPA, loopback not set'}\n  ${up ? 'Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX' : 'Auto-duplex, Auto-speed, media type is 10/100/1000BaseTX'}\n  Last input 00:00:0${L.clock % 9}, output 00:00:00, output hang never\n  Input queue: 0/75/${storm ? 4127 : 0}/0 (size/max/drops/flushes); Total output drops: ${storm ? 918273 : 0}\n  5 minute input rate ${storm ? '962100000' : up ? '41000' : '0'} bits/sec, ${storm ? 1404200 : up ? 37 : 0} packets/sec\n  5 minute output rate ${storm ? '958300000' : up ? '52000' : '0'} bits/sec, ${storm ? 1398800 : up ? 44 : 0} packets/sec\n     ${up ? ctr('in', 1834411) : 0} packets input, ${up ? ctr('ib', 1834411) * 412 : 0} bytes, 0 no buffer\n     Received ${up ? ctr('b', 11920) : 0} broadcasts (${up ? ctr('m', 9122) : 0} multicasts)\n     0 runts, 0 giants, 0 throttles\n     ${crc} input errors, ${crc} CRC, 0 frame, 0 overrun, 0 ignored\n     ${up ? ctr('out', 2209118) : 0} packets output, ${up ? ctr('ob', 2209118) * 380 : 0} bytes, 0 underruns\n     0 output errors, 0 collisions, ${up ? 1 : 0} interface resets\n`;
}
function stpShow(L, d, p, a) {
  if (d.kind !== 'sw') return '';
  if (!d.stp?.on) return 'No spanning tree instance exists.\n';
  const S = L._stp; const root = L.devs[S.root]; const isRoot = S.root === d.id;
  const rows = Object.keys(d.ports).map((pn) => { const q = d.ports[pn]; if (!linkUp(L, d.id, pn)) return null; let lp = pn; if (q.cg && L._po?.[`${d.id}|${q.cg}`]?.ok) { if (L._po[`${d.id}|${q.cg}`].mem[0] !== pn) return null; lp = `Po${q.cg}`; } const r = S.role[`${d.id}|${lp}`] || 'Desg'; const blk = r === 'Altn' || q.pvidInc; return { lp, r, sts: blk ? 'BLK' : 'FWD', cost: lp.startsWith('Po') ? 3 : lp.startsWith('Te') ? 2 : 4, type: `P2p${q.portfast ? ' Edge' : ''}${q.pvidInc ? ' *PVID_Inc' : ''}` }; }).filter(Boolean);
  if (p === 'spanning-tree blockedports') { const b = rows.filter((r) => r.sts === 'BLK'); return `\nName                 Blocked Interfaces List\n-------------------- ------------------------------------\n${b.length ? `VLAN0001             ${b.map((r) => r.lp).join(', ')}` : ''}\n\nNumber of blocked ports (segments) in the system : ${b.length}\n`; }
  if (p === 'spanning-tree summary') return `Switch is in ${d.stp.mode || 'rapid-pvst'} mode\nRoot bridge for: ${isRoot ? Object.keys(d.vlans).map((v) => `VLAN${String(v).padStart(4, '0')}`).join(', ') : 'none'}\nPortfast Default             is ${d.stp.portfastDefault ? 'enabled' : 'disabled'}\nPortfast Edge BPDU Guard Default is ${d.stp.bpduguardDefault ? 'enabled' : 'disabled'}\n\nName                   Blocking Listening Learning Forwarding STP Active\n---------------------- -------- --------- -------- ---------- ----------\n${Object.keys(d.vlans).map((v) => `VLAN${String(v).padStart(4, '0')}               ${lpad(rows.filter((r) => r.sts === 'BLK').length, 8)} ${lpad(0, 9)} ${lpad(0, 8)} ${lpad(rows.filter((r) => r.sts === 'FWD').length, 10)} ${lpad(rows.length, 10)}`).join('\n')}\n`;
  const vl = a[0] ? [a[0]] : Object.keys(d.vlans);
  return vl.map((v) => `\nVLAN${String(v).padStart(4, '0')}\n  Spanning tree enabled protocol rstp\n  Root ID    Priority    ${root.stp.prio + +v}\n             Address     ${macCisco(root.mac)}\n${isRoot ? '             This bridge is the root\n' : `             Cost        ${S.rc[d.id]}\n             Port        ${S.rp[d.id]?.port ?? '-'}\n`}             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec\n\n  Bridge ID  Priority    ${d.stp.prio + +v}  (priority ${d.stp.prio} sys-id-ext ${v})\n             Address     ${macCisco(d.mac)}\n             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec\n             Aging Time  300 sec\n\nInterface           Role Sts Cost      Prio.Nbr Type\n------------------- ---- --- --------- -------- --------------------------------\n${rows.filter((r) => { const q = d.ports[r.lp] || d.ports[Object.keys(d.ports).find((k) => `Po${d.ports[k].cg}` === r.lp)]; const B = bridgeOf(L, d).P[Object.keys(d.ports).find((k) => k === r.lp) || Object.keys(d.ports).find((k) => `Po${d.ports[k].cg}` === r.lp)]; return B && egressTag(B, +v).ok; }).map((r) => `${pad(r.lp, 20)}${pad(r.r, 5)}${pad(r.sts, 4)}${pad(r.cost, 10)}${pad('128.' + (parseInt(r.lp.split('/').pop()) || 1), 9)}${r.type}`).join('\n')}\n`).join('');
}
function runCfg(L, d, only) {
  const o = ['Building configuration...', '', `Current configuration : ${2000 + JSON.stringify(d).length % 4000} bytes`, '!', 'version 17.9', 'service timestamps log datetime msec', d.secret ? 'service password-encryption' : 'no service password-encryption', '!', `hostname ${d.hostname}`, '!'];
  if (d.secret) o.push('enable secret 9 $9$mQ0lq3NN8BIZ9U$Xc8h1u2cq1PN0JZGfIu2RT1m', '!');
  if (d.domain) o.push(`ip domain name ${d.domain}`);
  if (d.kind === 'sw') {
    if (d.iprouting) o.push('ip routing');
    if (d.snoop?.on) o.push(`ip dhcp snooping vlan ${vlanListStr(d.snoop.vlans || [])}`, 'ip dhcp snooping');
    o.push('!', `spanning-tree mode ${d.stp.mode || 'rapid-pvst'}`); if (d.stp.bpduguardDefault) o.push('spanning-tree portfast bpduguard default'); o.push('spanning-tree extend system-id'); if (!d.stp.on) o.push(`no spanning-tree vlan ${Object.keys(d.vlans).join(',')}`); if (d.stp.prio !== 32768) o.push(`spanning-tree vlan 1-4094 priority ${d.stp.prio}`); o.push('!');
    Object.keys(d.vlans).filter((v) => +v !== 1).forEach((v) => o.push(`vlan ${v}`, ` name ${d.vlans[v]}`, '!'));
    Object.entries(d.ports).filter(([pn]) => !only || pn === only).forEach(([pn, p]) => {
      o.push(`interface ${ifLong(pn)}`); if (p.desc) o.push(` description ${p.desc}`);
      if (p.routed) { o.push(' no switchport'); if (p.ip) o.push(` ip address ${p.ip} ${p.mask}`); }
      else { if (p.mode === 'trunk') { if (+p.native !== 1) o.push(` switchport trunk native vlan ${p.native}`); if (p.allowed !== 'all') o.push(` switchport trunk allowed vlan ${p.allowed === 'none' ? 'none' : vlanListStr(parseVlanList(p.allowed))}`); o.push(' switchport mode trunk'); } else { if (+p.vlan !== 1) o.push(` switchport access vlan ${p.vlan}`); o.push(' switchport mode access'); if (p.voice != null) o.push(` switchport voice vlan ${p.voice}`); } }
      if (p.ps?.max && p.ps.max !== 1) o.push(` switchport port-security maximum ${p.ps.max}`); if (p.ps?.viol && p.ps.viol !== 'shutdown') o.push(` switchport port-security violation ${p.ps.viol}`); if (p.ps?.sticky) { o.push(' switchport port-security mac-address sticky'); (p.ps.macs || []).forEach((m) => o.push(` switchport port-security mac-address sticky ${macCisco(m)}`)); } if (p.ps?.on) o.push(' switchport port-security');
      if (p.poeOff) o.push(' power inline never'); if (p.cg) o.push(` channel-group ${p.cg} mode ${p.cgm}`); if (p.portfast) o.push(' spanning-tree portfast'); if (p.bpduguard) o.push(' spanning-tree bpduguard enable'); if (p.bpdufilter) o.push(' spanning-tree bpdufilter enable'); if (p.trust) o.push(' ip dhcp snooping trust'); if (p.storm) o.push(` storm-control broadcast level ${p.storm}`); if (p.shut) o.push(' shutdown'); o.push('!');
    });
    Object.entries(d.svis).filter(([v]) => !only || only === `Vlan${v}`).forEach(([v, c]) => { o.push(`interface Vlan${v}`); if (c.desc) o.push(` description ${c.desc}`); o.push(c.ip ? ` ip address ${c.ip} ${c.mask}` : ' no ip address'); (c.helper || []).forEach((h) => o.push(` ip helper-address ${h}`)); if (c.shut) o.push(' shutdown'); o.push('!'); });
    if (d.defgw) o.push(`ip default-gateway ${d.defgw}`);
  } else {
    Object.entries(d.ifs).filter(([pn]) => !only || pn === only).forEach(([pn, c]) => { o.push(`interface ${ifLong(pn)}`); if (c.desc) o.push(` description ${c.desc}`); if (c.dot1q) o.push(` encapsulation dot1Q ${c.dot1q}${c.native ? ' native' : ''}`); o.push(c.ip ? ` ip address ${c.ip} ${c.mask}` : ' no ip address'); (c.helper || []).forEach((h) => o.push(` ip helper-address ${h}`)); if (c.aclIn != null) o.push(` ip access-group ${c.aclIn} in`); if (c.aclOut != null) o.push(` ip access-group ${c.aclOut} out`); if (c.nat) o.push(` ip nat ${c.nat}`); if (c.cost) o.push(` ip ospf cost ${c.cost}`); if (c.hello) o.push(` ip ospf hello-interval ${c.hello}`); if (c.mtu) o.push(` mtu ${c.mtu}`); if (c.shut) o.push(' shutdown'); else if (!pn.includes('.')) o.push(' negotiation auto'); o.push('!'); });
    if (d.dhcp) { (d.dhcp.excl || []).forEach(([x, y]) => o.push(`ip dhcp excluded-address ${x}${y !== x ? ' ' + y : ''}`)); o.push('!'); Object.entries(d.dhcp.pools || {}).forEach(([n, q]) => { o.push(`ip dhcp pool ${n}`); if (q.net) o.push(` network ${q.net} ${q.mask}`); if (q.gw) o.push(` default-router ${q.gw}`); if (q.dns?.length) o.push(` dns-server ${q.dns.join(' ')}`); if (q.dom) o.push(` domain-name ${q.dom}`); o.push('!'); }); }
    if (d.ospf) { o.push(`router ospf ${d.ospf.pid}`); if (d.ospf.rid) o.push(` router-id ${d.ospf.rid}`); if (d.ospf.passiveDefault) o.push(' passive-interface default'); (d.ospf.nopassive || []).forEach((x) => d.ospf.passiveDefault && o.push(` no passive-interface ${ifLong(x)}`)); (d.ospf.passive || []).forEach((x) => o.push(` passive-interface ${ifLong(x)}`)); d.ospf.nets.forEach((x) => o.push(` network ${x.net} ${x.wild} area ${x.area}`)); if (d.ospf.defOrig) o.push(' default-information originate'); o.push('!'); }
    (d.nat?.rules || []).forEach((r) => o.push(`ip nat inside source list ${r.acl} interface ${ifLong(r.ifn)} overload`));
    (d.nat?.statics || []).forEach((s) => o.push(`ip nat inside source static ${s.proto ? `${s.proto} ${s.inside} ${s.iport} ${s.outside} ${s.oport}` : `${s.inside} ${s.outside}`}`));
  }
  (d.routes || []).forEach((r) => o.push(`ip route ${r.net} ${r.mask} ${r.via ?? ifLong(r.ifn)}${r.ad && r.ad !== 1 ? ' ' + r.ad : ''}`));
  Object.entries(d.acls || {}).forEach(([n, A]) => { if (/^\d+$/.test(n)) A.forEach((r) => o.push(`access-list ${n} ${r.act} ${r.std ? (r.src === 'any' ? 'any' : r.src.host ? `host ${r.src.host}` : `${r.src.net} ${r.src.wild}`) : `${r.proto} ${r.src === 'any' ? 'any' : aclA(r.src)} ${r.dst === 'any' ? 'any' : aclA(r.dst)}${r.eq ? ` eq ${r.eq}` : ''}`}`)); else { o.push(`ip access-list ${A[0]?.std ? 'standard' : 'extended'} ${n}`); A.forEach((r) => o.push(` ${r.seq ?? ''} ${r.act} ${r.std ? (r.src === 'any' ? 'any' : aclA(r.src)) : `${r.proto} ${r.src === 'any' ? 'any' : aclA(r.src)} ${r.dst === 'any' ? 'any' : aclA(r.dst)}${r.eq ? ` eq ${r.eq}` : ''}`}`.replace('  ', ' '))); } });
  o.push('!');
  if (d.snmp?.community) o.push(`snmp-server community ${d.snmp.community} ${d.snmp.rw ? 'RW' : 'RO'}`); if (d.snmp?.location) o.push(`snmp-server location ${d.snmp.location}`); if (d.snmp?.host) o.push(`snmp-server host ${d.snmp.host} version 2c ${d.snmp.community || 'public'}`);
  if (d.flowExport) o.push(`ip flow-export destination ${d.flowExport} ${d.flowPort || 2055}`); if (d.syslog) o.push(`logging host ${d.syslog}`); if (d.ntp) o.push(`ntp server ${d.ntp}`);
  (d.errRec?.causes || []).forEach((c) => o.push(`errdisable recovery cause ${c}`));
  Object.entries(d.span || {}).forEach(([k, s]) => { if (s.src) o.push(`monitor session ${k} source interface ${s.src.join(' , ')}`); if (s.dst) o.push(`monitor session ${k} destination interface ${s.dst}`); });
  o.push('!', 'line con 0', ' logging synchronous', 'line vty 0 15', ' login local', ' transport input ssh', '!', 'end', '');
  if (only) { const i = o.findIndex((l) => l.startsWith('interface ')); const j = o.findIndex((l, k) => k > i && l === '!'); return `Building configuration...\n\nCurrent configuration : 212 bytes\n!\n${o.slice(i, j + 1).join('\n')}\nend\n`; }
  return o.join('\n');
}
/** ping / traceroute typed on a router or switch */
function iosPing(L, d, rest) {
  const t = rest.split(/\s+/); let dst = t[0], src = null; const si = t.indexOf('source'); if (si > 0) { const n = ifNorm(t.slice(si + 1).join('')) || t[si + 1]; src = isIp(n) ? n : l3ifs(L, d).find((e) => e.ifn === n)?.ip; }
  if (!isIp(dst)) { const r = resolve(L, { ...d, nics: { x: { dns: d.nameServers || [], ip: '1.1.1.1' } } }, dst); if (!r.ip) return `% Unrecognized host or address, or protocol not running.\n`; dst = r.ip; }
  let s = '', ok = 0; const r0 = send(L, d.id, { dst, src: src || undefined });
  for (let i = 0; i < 5; i++) { const r = i ? send(L, d.id, { dst, src: src || undefined }) : r0; const arp = i === 0 && r.res === 'ok' && !Object.values(L.arp[d.id] || {}).some(() => true); if (r.res === 'ok') { s += i === 0 && d.firstPing?.[dst] == null ? '.' : '!'; if (i === 0 && d.firstPing?.[dst] == null) (d.firstPing ??= {})[dst] = 1; else ok++; } else s += (r.res === 'unreach-host' || r.res === 'unreach-net' || r.res === 'unreach-adm') && r.hops.length ? 'U' : '.'; }
  ok = (s.match(/!/g) || []).length;
  return `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${dst}, timeout is 2 seconds:\n${src ? `Packet sent with a source address of ${src}\n` : ''}${s}\nSuccess rate is ${ok * 20} percent (${ok}/5)${ok ? `, round-trip min/avg/max = 1/${1 + (ok % 3)}/4 ms` : ''}\n`;
}
function iosTrace(L, d, rest) {
  let dst = rest.split(/\s+/)[0]; if (!isIp(dst)) { const r = resolve(L, { ...d, nics: { x: { dns: d.nameServers || [], ip: '1.1.1.1' } } }, dst); if (!r.ip) return '% Unrecognized host or address.\n'; dst = r.ip; }
  const r = send(L, d.id, { dst }); let o = `Type escape sequence to abort.\nTracing the route to ${dst}\nVRF info: (vrf in name/id, vrf out name/id)\n`;
  const hops = r.hops.map((h) => h.ip); hops.forEach((h, i) => (o += `  ${i + 1} ${h} ${1 + i} msec ${1 + i} msec ${2 + i} msec\n`));
  if (r.res !== 'ok') { for (let i = hops.length; i < Math.min(hops.length + 3, 30); i++) o += `  ${i + 1}  *  *  * \n`; }
  return o;
}
