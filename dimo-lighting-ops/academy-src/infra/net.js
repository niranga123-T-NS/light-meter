// =================== Network engine: every lab device, cable, VLAN, route, NAT, firewall policy, tunnel and service is calculated here – nothing is scripted per lesson
const ip2n = (s) => String(s).split('.').reduce((a, o) => a * 256 + +o, 0) >>> 0;
const n2ip = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const isIp = (s) => typeof s === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((o) => +o <= 255);
const len2mask = (l) => n2ip(l <= 0 ? 0 : l >= 32 ? 0xffffffff : (0xffffffff << (32 - l)) >>> 0);
const mask2len = (m) => { if (!isIp(m)) return -1; const n = ip2n(m); let l = 0; while (l < 32 && n & (0x80000000 >>> l)) l++; return l === 32 || ((n << l) >>> 0) === 0 ? l : -1; };
const isMask = (m) => mask2len(m) >= 0;
const wild2mask = (w) => n2ip(~ip2n(w) >>> 0);
const netOf = (ip, m) => n2ip((ip2n(ip) & ip2n(m)) >>> 0);
const bcastOf = (ip, m) => n2ip((ip2n(ip) | (~ip2n(m) >>> 0)) >>> 0);
const sameNet = (a, b, m) => ((ip2n(a) ^ ip2n(b)) & ip2n(m)) >>> 0 === 0;
const inNet = (ip, net, m) => isIp(ip) && sameNet(ip, net, m);
const isPriv = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.)/.test(ip);
const cidr = (s) => { const [a, l] = String(s).split('/'); return { ip: a, mask: len2mask(l == null ? 32 : +l) }; };
const hostsIn = (m) => Math.max(0, 2 ** (32 - mask2len(m)) - 2);
const macOf = (seed) => { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; const b = [0x00, 0x1a + (h & 7), (h >>> 8) & 255, (h >>> 16) & 255, (h >>> 24) & 255, (h >>> 3) & 255]; return b.map((x) => x.toString(16).padStart(2, '0')).join(':'); };
const macDash = (m) => m.replace(/:/g, '-');
const macCisco = (m) => { const h = m.replace(/[:-]/g, ''); return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8, 12)}`; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const BRIDGES = ['sw', 'hv', 'ap', 'phone', 'hub'];
const isBridge = (d) => d && BRIDGES.includes(d.kind);

// ---------------------------------------------------------------- the lab
function labNew(spec) {
  const L = { devs: {}, links: [], clock: 0, log: [], cap: { on: {}, pkts: [] }, arp: {}, mac: {}, sess: [], ev: [], inet: clone(INET0), cmdlog: [], flags: {}, ans: {} };
  (spec.devs || []).forEach((d) => devAdd(L, d));
  (spec.links || []).forEach((k) => L.links.push(k));
  if (spec.inet) Object.assign(L.inet, spec.inet);
  return L;
}
const INET0 = {
  names: { 'google.com': '142.250.183.46', 'www.google.com': '142.250.183.46', 'microsoft.com': '20.70.246.20', 'update.microsoft.com': '20.70.246.21', 'windowsupdate.com': '20.70.246.21', 'archive.ubuntu.com': '91.189.91.81', 'security.ubuntu.com': '91.189.91.82', 'github.com': '140.82.121.4', 'dimo.lk': '203.94.66.10', 'www.dimo.lk': '203.94.66.10', 'outlook.office365.com': '52.97.146.162', 'ntp.ubuntu.com': '185.125.190.56', 'time.windows.com': '20.101.57.9', 'pool.ntp.org': '162.159.200.1', 'registry-1.docker.io': '54.198.86.24', 'mirrors.rockylinux.org': '91.189.91.81' },
  hosts: { '8.8.8.8': { name: 'dns.google', udp: [53] }, '1.1.1.1': { name: 'one.one.one.one', udp: [53] }, '142.250.183.46': { name: 'google.com', tcp: [80, 443] }, '20.70.246.20': { name: 'microsoft.com', tcp: [80, 443] }, '20.70.246.21': { name: 'update.microsoft.com', tcp: [80, 443] }, '91.189.91.81': { name: 'archive.ubuntu.com', tcp: [80, 443] }, '91.189.91.82': { name: 'security.ubuntu.com', tcp: [80, 443] }, '140.82.121.4': { name: 'github.com', tcp: [22, 443] }, '203.94.66.10': { name: 'www.dimo.lk', tcp: [80, 443] }, '52.97.146.162': { name: 'outlook.office365.com', tcp: [443, 587] }, '185.125.190.56': { name: 'ntp.ubuntu.com', udp: [123] }, '20.101.57.9': { name: 'time.windows.com', udp: [123] }, '162.159.200.1': { name: 'pool.ntp.org', udp: [123] }, '54.198.86.24': { name: 'registry-1.docker.io', tcp: [443] } },
};

/** Fill in defaults so lesson specs stay short */
function devAdd(L, d) {
  d = { ...d }; d.id ??= d.name; d.name ??= d.id; d.hostname ??= d.name; L.devs[d.id] = d;
  if (['pc', 'srv', 'vm', 'laptop', 'printer', 'cam', 'rogue'].includes(d.kind)) {
    d.os ??= d.kind === 'printer' || d.kind === 'cam' ? 'embedded' : 'win'; d.nics ??= {};
    if (!Object.keys(d.nics).length) d.nics[d.os === 'linux' ? 'ens18' : 'Ethernet'] = {};
    Object.entries(d.nics).forEach(([n, c]) => { c.mac ??= macOf(d.id + n); c.dns ??= []; c.up ??= true; if (c.cidr) { const x = cidr(c.cidr); c.ip = x.ip; c.mask = x.mask; delete c.cidr; } });
    d.svc ??= {}; d.fwin ??= { on: d.os === 'win', allow: [] }; d.hosts ??= {}; d.routes ??= [];
  }
  if (d.kind === 'sw' || d.kind === 'hub') {
    d.vlans ??= { 1: 'default' }; d.ports ??= {}; d.mac ??= macOf(d.id);
    if (d.n) { for (let i = 1; i <= d.n; i++) { const pn = `${d.pfx ?? 'Gi1/0/'}${i}`; d.ports[pn] ??= {}; } delete d.n; }
    if (d.up) { d.up.forEach((pn) => (d.ports[pn] ??= {})); delete d.up; }
    Object.values(d.ports).forEach((p) => { p.mode ??= 'access'; p.vlan ??= 1; p.native ??= 1; p.allowed ??= 'all'; p.shut ??= false; });
    d.stp ??= { on: d.kind === 'sw', prio: 32768 }; d.svis ??= {}; d.routes ??= []; d.snoop ??= { on: false, vlans: [] }; d.poe ??= { budget: 370 };
    if (d.kind === 'sw') d.startup ??= swSnap(d);
  }
  if (d.kind === 'rt') {
    d.ifs ??= {}; d.routes ??= []; d.dhcp ??= { pools: {}, excl: [], bind: {} }; d.nat ??= { rules: [], statics: [] }; d.acls ??= {}; d.ospf ??= null; d.mac ??= macOf(d.id);
    Object.entries(d.ifs).forEach(([n, c]) => { c.shut ??= false; if (c.cidr) { const x = cidr(c.cidr); c.ip = x.ip; c.mask = x.mask; delete c.cidr; } c.mac ??= macOf(d.id + n.split('.')[0]); });
    d.startup ??= clone({ ifs: d.ifs, routes: d.routes });
  }
  if (d.kind === 'fw') { d.cfg ??= {}; d.mac ??= macOf(d.id); fgDefaults(d); }
  if (d.kind === 'isp') { d.ifs ??= {}; Object.entries(d.ifs).forEach(([n, c]) => { if (c.cidr) { const x = cidr(c.cidr); c.ip = x.ip; c.mask = x.mask; delete c.cidr; } c.mac ??= macOf(d.id + n); }); }
  if (d.kind === 'phone') { d.mac ??= macOf(d.id); d.ext ??= '2001'; }
  if (d.kind === 'ap') { d.mac ??= macOf(d.id); d.native ??= 1; d.ssids ??= []; d.clients ??= []; d.ch ??= 6; d.ch5 ??= 36; d.pw ??= 17; }
  if (d.kind === 'hv') { d.mac ??= macOf(d.id); d.nics ??= ['eno1']; d.bridges ??= { vmbr0: { ports: [d.nics[0]], aware: true } }; d.bonds ??= {}; d.vms ??= []; }
  return d;
}
const swSnap = (d) => clone({ vlans: d.vlans, ports: Object.fromEntries(Object.entries(d.ports).map(([k, p]) => [k, { ...p, err: undefined, macs: p.ps?.sticky ? p.ps.macs : undefined }])), stp: d.stp, svis: d.svis, routes: d.routes, snoop: d.snoop, iprouting: d.iprouting, hostname: d.hostname });

// ---------------------------------------------------------------- cables
const pk = (dev, port) => `${dev}:${port}`;
function peerOf(L, dev, port) { const k = pk(dev, port); for (const [a, b] of L.links) { if (a === k) return splitPk(b); if (b === k) return splitPk(a); } return null; }
const splitPk = (s) => { const i = s.indexOf(':'); return { dev: s.slice(0, i), port: s.slice(i + 1) }; };
function cable(L, a, b) { L.links = L.links.filter(([x, y]) => x !== a && y !== a && x !== b && y !== b); L.links.push([a, b]); }
function uncable(L, a) { L.links = L.links.filter(([x, y]) => x !== a && y !== a); }

/** Is the device powered: PoE devices need a switch port giving power */
function powered(L, d) {
  if (!d || d.off) return false;
  if (typeof d.poe !== 'number') return true;
  const up = d.kind === 'phone' ? 'sw' : d.kind === 'ap' ? 'eth0' : (d.nics ? Object.keys(d.nics)[0] : 'eth0'), pr = peerOf(L, d.id, up); if (!pr) return false;
  const s = L.devs[pr.dev]; if (!s || s.kind !== 'sw') return false;
  const p = s.ports[pr.port]; if (!p || p.shut || p.err || p.poeOff) return false;
  return poeAlloc(L, s).ok.has(pr.port);
}
/** PoE power by port order until the budget runs out (as a switch gives power) */
function poeAlloc(L, s) {
  const ok = new Set(), deny = new Set(); let used = 0;
  Object.keys(s.ports).forEach((pn) => { const p = s.ports[pn]; if (p.shut || p.err || p.poeOff) return; const pr = peerOf(L, s.id, pn); const d = pr && L.devs[pr.dev]; if (!d || typeof d.poe !== 'number' || d.off) return; const w = d.poe; if (used + w <= (s.poe?.budget ?? 370)) { used += w; ok.add(pn); } else deny.add(pn); });
  return { ok, deny, used };
}

/** Port up at this end (admin, err-disabled, power) */
function portUp(L, dev, port) {
  const d = L.devs[dev]; if (!d) return false;
  if (d.kind !== 'sw' && d.kind !== 'hub' && !powered(L, d)) return false;
  if (d.kind === 'sw' && d.off) return false;
  if (d.kind === 'sw' || d.kind === 'hub') { const p = d.ports[port]; return !!p && !p.shut && !p.err && !p.susp; }
  if (d.nics && !Array.isArray(d.nics)) { const n = d.nics[port]; return !!n && n.up !== false; }
  if (d.kind === 'rt') { const c = d.ifs[port]; return !!c && !c.shut; }
  if (d.kind === 'fw') { const c = fgIf(d, port); return !!c && (c.status ?? ['up'])[0] !== 'down'; }
  if (d.kind === 'hv') return d.nics.includes(port) && !(d.nicDown || []).includes(port);
  return true;
}
const linkUp = (L, dev, port) => { const pr = peerOf(L, dev, port); return !!pr && portUp(L, dev, port) && portUp(L, pr.dev, pr.port); };

// ---------------------------------------------------------------- bridges: switches, hypervisor bridges, access points, IP phones
function bridgeOf(L, d) {
  if (d.kind === 'sw' || d.kind === 'hub') {
    const P = {};
    Object.entries(d.ports).forEach(([pn, p]) => { P[pn] = d.kind === 'hub' ? { mode: 'trunk', native: 'U', allowed: 'all' } : { mode: p.mode, vlan: +p.vlan, native: +p.native, allowed: p.allowed, voice: p.voice != null ? +p.voice : null, cg: p.cg }; });
    const V = d.kind === 'hub' ? null : new Set(Object.keys(d.vlans).map(Number));
    return { P, V, svis: d.kind === 'sw' ? d.svis : {} };
  }
  if (d.kind === 'phone') {
    const sp = phoneVoice(L, d);
    return { P: { sw: { mode: 'trunk', native: 'U', allowed: 'all' }, pc: { mode: 'access', vlan: 'U' } }, V: null, svis: {}, self: { v: sp ?? 'U' } };
  }
  if (d.kind === 'ap') {
    const P = { eth0: { mode: 'trunk', native: d.native, allowed: 'all' } };
    d.clients.forEach((c) => { if (!c.ssid) return; const s = d.ssids.find((x) => x.name === c.ssid); if (s) P[`wlan:${c.dev}`] = { mode: 'access', vlan: s.vlan ?? d.native, iso: !!s.isolate }; });
    return { P, V: null, svis: { [d.native]: { ip: d.ip, mask: d.mask } } };
  }
  if (d.kind === 'hv') {
    const P = {}, svis = {};
    Object.entries(d.bridges).forEach(([bn, b]) => {
      b.ports.forEach((pp) => { const mem = d.bonds[pp] ? d.bonds[pp].slaves : [pp]; mem.forEach((m) => (P[m] = { mode: 'trunk', native: 1, allowed: 'all', br: bn, bond: d.bonds[pp] ? pp : null })); });
      (d.vms || []).forEach((vm) => { const D = L.devs[vm]; if (!D || !D.nics) return; Object.entries(D.nics).forEach(([nn, c]) => { if ((c.bridge ?? 'vmbr0') === bn) P[`vm:${vm}:${nn}`] = { mode: 'access', vlan: c.tag ? +c.tag : 1, br: bn }; }); });
    });
    const mg = d.mgmt; if (mg && mg.ip) svis[mg.vlan ? +mg.vlan : 1] = { ip: mg.ip, mask: mg.mask };
    return { P, V: null, svis, hv: true };
  }
  return { P: {}, V: null, svis: {} };
}
/** Phones learn the voice VLAN from the switch (CDP / LLDP) */
function phoneVoice(L, ph) { const pr = peerOf(L, ph.id, 'sw'); const s = pr && L.devs[pr.dev]; const p = s?.kind === 'sw' && s.ports[pr.port]; return p && p.mode === 'access' && p.voice != null ? +p.voice : null; }

/** Physical port of a bridge virtual port (a VM's NIC or a wireless client) */
function bridgeVPeer(L, d, pn) {
  if (pn.startsWith('vm:')) { const [, vm, nn] = pn.split(':'); return { dev: vm, port: nn, virt: true }; }
  if (pn.startsWith('wlan:')) { const c = pn.slice(5); const D = L.devs[c]; return D ? { dev: c, port: Object.keys(D.nics)[0], virt: true } : null; }
  return peerOf(L, d.id, pn);
}
function bridgePortUp(L, d, pn) {
  if (pn.startsWith('vm:')) { const [, vm, nn] = pn.split(':'); const V = L.devs[vm]; return !!V && V.run !== false && V.nics[nn]?.up !== false && !(d.paused || []).includes(vm); }
  if (pn.startsWith('wlan:')) { const c = L.devs[pn.slice(5)]; return !!c && wifiAssoc(L, d, c).ok; }
  return linkUp(L, d.id, pn);
}
/** Which VLANs a bridge port carries out (tag null = untagged) */
function egressTag(pc, v) {
  if (pc.mode === 'access') { if (pc.vlan === v) return { ok: true, tag: null }; if (pc.voice != null && pc.voice === v) return { ok: true, tag: v }; return { ok: false }; }
  if (pc.allowed !== 'all' && !allowHas(pc.allowed, v)) return { ok: false };
  return { ok: true, tag: v === pc.native ? null : v };
}
function ingressVlan(pc, tag) {
  if (pc.mode === 'access') { if (tag == null) return pc.vlan; if (pc.voice != null && tag === pc.voice) return tag; return null; }
  const v = tag == null ? pc.native : tag;
  if (pc.allowed !== 'all' && !allowHas(pc.allowed, v)) return null;
  return v;
}
const allowHas = (a, v) => (a === 'all' ? true : (Array.isArray(a) ? a : parseVlanList(a)).some((x) => String(x) === String(v)));
function parseVlanList(s) { if (Array.isArray(s)) return s.map(Number); if (s === 'all' || s == null) return 'all'; if (s === 'none') return []; const out = []; String(s).split(',').forEach((p) => { const [a, b] = p.split('-').map(Number); if (b) for (let i = a; i <= b; i++) out.push(i); else if (!isNaN(a)) out.push(a); }); return out; }
const vlanListStr = (a) => { if (a === 'all') return '1-4094'; const s = [...new Set(a.map(Number))].sort((x, y) => x - y), out = []; for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`); i = j; } return out.join(',') || 'none'; };

// ---------------------------------------------------------------- L3 endpoints of every device
/** Every IP interface: where its frames enter the cabling (device port + VLAN tag, or a bridge-internal VLAN) */
function l3ifs(L, d) {
  const out = [];
  if (!d) return out;
  if (d.nics && !Array.isArray(d.nics)) Object.entries(d.nics).forEach(([n, c]) => { const ip = c.dup ? c.apipa : c.ip; out.push({ dev: d.id, ifn: n, ip, mask: c.ip && !c.dup ? c.mask : c.apipa ? '255.255.0.0' : c.mask, mac: c.mac, port: n, tag: c.vtag ?? null, up: c.up !== false && powered(L, d) && d.run !== false, host: true }); });
  if (d.kind === 'rt' || d.kind === 'isp') Object.entries(d.ifs).forEach(([n, c]) => { const [ph, sub] = n.split('.'); out.push({ dev: d.id, ifn: n, ip: c.ip, mask: c.mask, mac: c.mac, port: ph, tag: sub ? (c.native ? null : +c.dot1q || +sub) : null, up: !c.shut && !(d.ifs[ph]?.shut) && (c.loop || linkUp(L, d.id, ph)), loop: !!c.loop }); });
  if (d.kind === 'fw') fgIfList(d).forEach(([n, c]) => { const [ip, mask] = fgIpOf(c); const t = c.type?.[0]; if (t === 'tunnel' || t === 'ssl') return; const ph = t === 'vlan' ? c.interface?.[0] : n; out.push({ dev: d.id, ifn: n, ip, mask, mac: macOf(d.id + ph), port: ph, tag: t === 'vlan' ? +c.vlanid?.[0] : null, up: (c.status ?? ['up'])[0] !== 'down' && linkUp(L, d.id, ph) }); });
  if (d.kind === 'sw') Object.entries(d.svis || {}).forEach(([v, c]) => out.push({ dev: d.id, ifn: `Vlan${v}`, ip: c.ip, mask: c.mask, mac: d.mac, svi: +v, up: !c.shut && sviUp(L, d, +v) }));
  if (d.kind === 'hv' && d.mgmt?.ip) out.push({ dev: d.id, ifn: d.mgmt.vlan ? `vmbr0.${d.mgmt.vlan}` : 'vmbr0', ip: d.mgmt.ip, mask: d.mgmt.mask, mac: d.mac, svi: d.mgmt.vlan ? +d.mgmt.vlan : 1, up: !d.off });
  if (d.kind === 'ap' && d.ip) out.push({ dev: d.id, ifn: 'mgmt', ip: d.ip, mask: d.mask, mac: d.mac, svi: d.native, up: powered(L, d) });
  if (d.kind === 'phone') { const v = phoneVoice(L, d); out.push({ dev: d.id, ifn: 'voice', ip: d.ip, mask: d.mask, mac: d.mac, svi: v ?? 'U', up: powered(L, d), phone: true }); }
  return out;
}
function sviUp(L, d, v) { if (!d.vlans[v]) return false; return Object.entries(d.ports).some(([pn, p]) => { const e = egressTag(bridgeOf(L, d).P[pn], v); return e.ok && linkUp(L, d.id, pn) && !stpBlocked(L, d.id, pn); }); }
const allEps = (L) => Object.values(L.devs).flatMap((d) => l3ifs(L, d));
function owner(L, ip) { return allEps(L).filter((e) => e.ip === ip && e.up); }

// ---------------------------------------------------------------- spanning tree (one instance, per-segment designated ports, root / alternate)
function stpCalc(L) {
  const bid = (d) => `${String(d.stp.prio).padStart(5, '0')}.${d.mac}`;
  const stpOn = (d) => d.kind === 'sw' && d.stp?.on && !d.off;
  const br = Object.values(L.devs).filter(stpOn), segOf = {}, segs = [];
  // logical ports: a bundled port-channel counts once (its first member)
  const lport = (d, pn) => { const p = d.ports[pn]; if (p?.cg && L._po?.[`${d.id}|${p.cg}`]?.ok) { const m = L._po[`${d.id}|${p.cg}`].mem; return m[0] === pn ? `Po${p.cg}` : null; } return pn; };
  br.forEach((d) => Object.keys(d.ports).forEach((pn) => {
    const lp = lport(d, pn); if (!lp || !linkUp(L, d.id, pn) || d.ports[pn].bpdufilter) return;
    const key = `${d.id}|${lp}`; if (segOf[key] != null) return;
    // walk through devices that do not run STP (hubs, unmanaged / STP-off switches) – BPDUs pass through them
    const seg = { ports: [] }, seen = new Set(), q = [{ dev: d.id, port: pn }];
    while (q.length) {
      const { dev, port } = q.shift(), pr = peerOf(L, dev, port); if (!pr || !linkUp(L, dev, port)) continue;
      const D = L.devs[pr.dev]; if (!D) continue;
      const add = (dd, pp) => { const lp2 = lport(dd, pp); if (!lp2) return; const k2 = `${dd.id}|${lp2}`; if (!seen.has(k2)) { seen.add(k2); seg.ports.push({ dev: dd.id, port: lp2, phys: pp }); } };
      if (dev === d.id && port === pn) add(d, pn);
      if (stpOn(D)) { if (!D.ports[pr.port]?.bpdufilter) add(D, pr.port); }
      else if (isBridge(D) && D.kind !== 'phone' && D.kind !== 'ap') { const k3 = `x|${D.id}`; if (seen.has(k3)) continue; seen.add(k3); const B = bridgeOf(L, D); Object.keys(B.P).forEach((p2) => { if (p2 !== pr.port && !p2.startsWith('vm:') && !p2.startsWith('wlan:')) q.push({ dev: D.id, port: p2 }); }); }
    }
    const i = segs.push(seg) - 1; seg.ports.forEach((p) => (segOf[`${p.dev}|${p.port}`] = i));
  }));
  // root bridge and path costs (Dijkstra over segments)
  const cost = (d, lp) => (lp.startsWith('Po') ? 3 : /^(Te|Xe|Twe)/.test(lp) ? 2 : /^Fa/.test(lp) ? 19 : 4) + 0 * d.stp.prio;
  const root = br.slice().sort((a, b) => (bid(a) < bid(b) ? -1 : 1))[0];
  const rc = {}, rp = {}; br.forEach((d) => (rc[d.id] = Infinity)); if (root) rc[root.id] = 0;
  const done = new Set();
  while (true) {
    const u = br.filter((d) => !done.has(d.id) && rc[d.id] < Infinity).sort((a, b) => rc[a.id] - rc[b.id] || (bid(a) < bid(b) ? -1 : 1))[0]; if (!u) break; done.add(u.id);
    segs.forEach((s) => { if (!s.ports.some((p) => p.dev === u.id)) return; s.ports.forEach((p) => { if (p.dev === u.id) return; const D = L.devs[p.dev], c = rc[u.id] + cost(D, p.port); const better = c < rc[D.id] || (c === rc[D.id] && rp[D.id] && bid(u) < bid(L.devs[rp[D.id].via])); if (!done.has(D.id) && better) { rc[D.id] = c; rp[D.id] = { port: p.port, via: u.id }; } }); });
  }
  const role = {};
  segs.forEach((s) => {
    const des = s.ports.slice().sort((a, b) => rc[a.dev] - rc[b.dev] || (bid(L.devs[a.dev]) < bid(L.devs[b.dev]) ? -1 : bid(L.devs[a.dev]) > bid(L.devs[b.dev]) ? 1 : a.port < b.port ? -1 : 1))[0];
    s.ports.forEach((p) => { const k = `${p.dev}|${p.port}`; role[k] = p === des ? 'Desg' : rp[p.dev]?.port === p.port ? 'Root' : 'Altn'; });
  });
  return { root: root?.id, rc, rp, role, segs, segOf, bid: Object.fromEntries(br.map((d) => [d.id, bid(d)])) };
}
function stpBlocked(L, dev, pn) {
  const S = L._stp; if (!S) return false; const d = L.devs[dev]; if (d?.kind !== 'sw') return false;
  const p = d.ports[pn]; let lp = pn; if (p?.cg && L._po?.[`${dev}|${p.cg}`]?.ok) { const m = L._po[`${dev}|${p.cg}`].mem; if (m[0] !== pn) return false; lp = `Po${p.cg}`; }
  return S.role[`${dev}|${lp}`] === 'Altn' || !!(p && p.pvidInc);
}
/** Port-channels: LACP active/passive, static on, and what happens when the two ends disagree */
function poCalc(L) {
  const R = {};
  Object.values(L.devs).filter((d) => d.kind === 'sw').forEach((d) => Object.entries(d.ports).forEach(([pn, p]) => { if (!p.cg) return; const k = `${d.id}|${p.cg}`; (R[k] ??= { dev: d.id, cg: p.cg, mode: p.cgm || 'on', mem: [], ok: false, why: '' }).mem.push(pn); }));
  Object.values(R).forEach((g) => {
    const d = L.devs[g.dev], up = g.mem.filter((pn) => linkUp(L, d.id, pn)); if (!up.length) { g.why = 'down'; return; }
    const peers = up.map((pn) => peerOf(L, d.id, pn)), pd = L.devs[peers[0].dev];
    const sameDev = peers.every((x) => x.dev === peers[0].dev);
    const other = pd?.kind === 'sw' ? peers.map((x) => pd.ports[x.port]) : [];
    const om = other[0]?.cg ? other[0].cgm || 'on' : null;
    const sig = (pn) => { const q = d.ports[pn]; return `${q.mode}|${q.vlan}|${q.native}|${q.mode === 'trunk' ? (q.allowed === 'all' ? 'all' : vlanListStr(parseVlanList(q.allowed))) : ''}`; };
    if (new Set(up.map(sig)).size > 1) { g.why = 'mismatch'; g.susp = up.slice(1); return; }
    if (pd?.kind === 'hv') { const bond = Object.values(pd.bonds).find((b) => b.slaves.includes(peers[0].port)); if (bond && bond.mode === '802.3ad' && g.mode !== 'on') { g.ok = sameDev; g.why = g.ok ? '' : 'peers'; } else if (bond && g.mode === 'on') { g.ok = true; } else { g.why = 'nolacp'; } g.mem = up; return; }
    if (!sameDev || !other.every((o) => o?.cg && o.cg === other[0].cg)) { g.why = g.mode === 'on' ? 'misconfig' : 'nolacp'; g.mem = up; return; }
    const lacp = (m) => m === 'active' || m === 'passive';
    if (g.mode === 'on' && om === 'on') g.ok = true;
    else if (lacp(g.mode) && lacp(om) && (g.mode === 'active' || om === 'active')) g.ok = true;
    else if (g.mode === 'on' || om === 'on') g.why = 'misconfig';
    else g.why = 'nolacp';
    g.mem = up;
  });
  return R;
}

// ---------------------------------------------------------------- settle: recompute everything that follows from the configuration
function settle(L, why) {
  SETTLE_PRE.forEach((f) => f(L, why));
  L._po = poCalc(L);
  Object.values(L.devs).filter((d) => d.kind === 'sw').forEach((d) => Object.entries(d.ports).forEach(([pn, p]) => {
    p.susp = false; const g = p.cg && L._po[`${d.id}|${p.cg}`];
    if (g && !g.ok && g.why === 'misconfig' && g.mode === 'on' && !p.err) { p.err = 'channel-misconfig'; logAdd(L, d.id, `%PM-4-ERR_DISABLE: channel-misconfig (STP) error detected on ${pn}, putting ${pn} in err-disable state`); }
    if (g && g.susp?.includes(pn)) p.susp = true;
  }));
  L._stp = stpCalc(L);
  // BPDU guard: an edge port that hears a BPDU shuts itself down
  Object.values(L.devs).filter((d) => d.kind === 'sw' && d.stp?.on).forEach((d) => Object.entries(d.ports).forEach(([pn, p]) => {
    if (!(p.bpduguard || (p.portfast && d.stp.bpduguardDefault)) || p.err || !linkUp(L, d.id, pn)) return;
    const k = L._stp.segOf[`${d.id}|${pn}`]; const seg = k != null && L._stp.segs[k];
    if (seg && seg.ports.length > 1) { p.err = 'bpduguard'; logAdd(L, d.id, `%SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port ${pn} with BPDU Guard enabled. Disabling port.`); logAdd(L, d.id, `%PM-4-ERR_DISABLE: bpduguard error detected on ${pn}, putting ${pn} in err-disable state`); }
  }));
  // native VLAN mismatch on a trunk between two switches: CDP warns and PVST+ blocks the port for those VLANs
  Object.values(L.devs).filter((d) => d.kind === 'sw').forEach((d) => Object.entries(d.ports).forEach(([pn, p]) => {
    p.pvidInc = false; if (p.mode !== 'trunk') return; const pr = peerOf(L, d.id, pn), D = pr && L.devs[pr.dev];
    if (D?.kind === 'sw' && linkUp(L, d.id, pn)) { const q = D.ports[pr.port]; if (q?.mode === 'trunk' && +q.native !== +p.native) { p.pvidInc = !!(d.stp?.on && D.stp?.on); logOnce(L, d.id, `%CDP-4-NATIVE_VLAN_MISMATCH: Native VLAN mismatch discovered on ${pn} (${p.native}), with ${D.hostname} ${pr.port} (${q.native}).`); } }
  }));
  L._stp = stpCalc(L);
  portSecurity(L);
  L._storm = stormCalc(L);
  learnMacs(L);
  dupCheck(L);
  L._ospf = ospfCalc(L);
  if (why !== 'nodhcp') Object.values(L.devs).forEach((d) => {
    if (d.kind === 'phone' && d.dhcp && !d.ip && powered(L, d)) { const ep = l3ifs(L, d)[0]; const o = dhcpOffer(L, ep, d.mac); if (o.ok) { d.ip = o.best.ip; d.mask = o.best.mask; d.gw = o.best.gw; o.best.commit?.(); } }
    if (!d.nics || Array.isArray(d.nics)) return;
    const retry = ['cam', 'printer', 'phone', 'ap'].includes(d.kind) || d.os === 'linux' || d.os === 'embedded';
    Object.entries(d.nics).forEach(([n, c]) => { if (c.dhcp && !c.ip && (!c.tried || retry) && !c.released && l3ifs(L, d).find((e) => e.ifn === n)?.up) { c.tried = true; dhcpRun(L, d, n); } });
  });
  Object.values(L.devs).filter((d) => d.kind === 'fw').forEach((d) => fgVpnState(L, d));
  SETTLE_HOOKS.forEach((f) => f(L));
  return L;
}
function logAdd(L, dev, msg) { L.log.push({ t: L.clock, dev, msg }); if (L.log.length > 400) L.log.shift(); }
function logOnce(L, dev, msg) { if (!L.log.some((x) => x.dev === dev && x.msg === msg)) logAdd(L, dev, msg); }
const tick = (L, ms) => (L.clock += ms);

/** Port security: too many / unknown MAC addresses behind an access port */
function portSecurity(L) {
  Object.values(L.devs).filter((d) => d.kind === 'sw').forEach((d) => Object.entries(d.ports).forEach(([pn, p]) => {
    if (!p.ps?.on || p.err || !linkUp(L, d.id, pn)) return;
    const macs = macsBehind(L, d.id, pn), max = p.ps.max ?? 1; p.ps.macs ??= [];
    macs.forEach((m) => { if (!p.ps.macs.includes(m) && p.ps.macs.length < max && (p.ps.sticky || !p.ps.static)) p.ps.macs.push(m); });
    const bad = macs.filter((m) => !p.ps.macs.includes(m));
    if (bad.length) { p.ps.last = bad[0]; p.ps.viols = (p.ps.viols ?? 0) + 1; if ((p.ps.viol ?? 'shutdown') === 'shutdown') { p.err = 'psecure-violation'; logAdd(L, d.id, `%PORT_SECURITY-2-PSECURE_VIOLATION: Security violation occurred, caused by MAC address ${macCisco(bad[0])} on port ${pn}.`); logAdd(L, d.id, `%PM-4-ERR_DISABLE: psecure-violation error detected on ${pn}, putting ${pn} in err-disable state`); } }
    if (!p.ps.sticky && !p.ps.static) p.ps.macs = p.ps.macs.filter((m) => macs.includes(m));
  }));
}
/** The MAC addresses that would be seen on a switch port: everything on the far side, until the next switch */
function macsBehind(L, dev, pn) {
  const out = [], seen = new Set(), q = [peerOf(L, dev, pn)];
  while (q.length) { const pr = q.shift(); if (!pr || seen.has(pr.dev)) continue; seen.add(pr.dev); const D = L.devs[pr.dev]; if (!D) continue;
    if (D.kind === 'sw') continue;
    l3ifs(L, D).forEach((e) => e.mac && e.port === pr.port && e.up && out.push(e.mac));
    if (D.kind === 'phone') { if (powered(L, D)) { out.push(D.mac); q.push(peerOf(L, D.id, 'pc')); } }
    if (D.kind === 'hub') Object.keys(D.ports).forEach((p2) => p2 !== pr.port && q.push(peerOf(L, D.id, p2)));
    if (D.kind === 'ap' && powered(L, D)) { out.push(D.mac); D.clients.forEach((c) => { const C = L.devs[c.dev]; if (C && wifiAssoc(L, D, C).ok) out.push(Object.values(C.nics)[0].mac); }); }
    if (D.kind === 'hv') { out.push(D.mac); (D.vms || []).forEach((v) => { const V = L.devs[v]; if (V && V.run !== false) Object.values(V.nics).forEach((c) => out.push(c.mac)); }); }
  }
  return [...new Set(out)];
}

/** A loop that spanning tree does not break: union-find over (bridge, VLAN) nodes; a cycle means a broadcast storm in that VLAN */
function stormCalc(L) {
  const par = {}, find = (x) => (par[x] ??= x) === x ? x : (par[x] = find(par[x])), bad = new Set(), edges = [];
  const bridges = Object.values(L.devs).filter((d) => isBridge(d) && (d.kind !== 'sw' || !d.off));
  bridges.forEach((d) => { const B = bridgeOf(L, d); Object.entries(B.P).forEach(([pn, pc]) => {
    if (pn.startsWith('vm:') || pn.startsWith('wlan:')) return;
    if (d.kind === 'sw' && (stpBlocked(L, d.id, pn) || !linkUp(L, d.id, pn))) return;
    if (d.kind === 'sw' && d.ports[pn]?.cg && L._po?.[`${d.id}|${d.ports[pn].cg}`]?.ok && L._po[`${d.id}|${d.ports[pn].cg}`].mem[0] !== pn) return;
    if (d.kind !== 'sw' && !bridgePortUp(L, d, pn)) return;
    const pr = peerOf(L, d.id, pn), D = pr && L.devs[pr.dev]; if (!isBridge(D)) return;
    if (D.kind === 'sw' && (stpBlocked(L, D.id, pr.port) || D.off)) return;
    if (D.kind === 'sw' && D.ports[pr.port]?.cg && L._po?.[`${D.id}|${D.ports[pr.port].cg}`]?.ok && L._po[`${D.id}|${D.ports[pr.port].cg}`].mem[0] !== pr.port) return;
    if (`${d.id}|${pn}` > `${D.id}|${pr.port}`) return;
    const B2 = bridgeOf(L, D), qc = B2.P[pr.port]; if (!qc) return;
    vlansOn(B, pc).forEach((v) => { const e = egressTag(pc, v); if (!e.ok) return; const v2 = ingressVlan(qc, e.tag); if (v2 == null || (B2.V && !B2.V.has(+v2))) return; edges.push([`${d.id}|${v}`, `${D.id}|${v2}`]); });
  }); });
  edges.forEach(([a, b]) => { const x = find(a), y = find(b); if (x === y) bad.add(x); else par[x] = y; });
  const storm = new Set(); Object.keys(par).forEach((k) => { if (bad.has(find(k))) storm.add(k); });
  return storm;
}
function vlansOn(B, pc) { if (pc.mode === 'access') return [pc.vlan, pc.voice].filter((x) => x != null); const all = B.V ? [...B.V] : ['U', 1, ...Array.from({ length: 200 }, (_, i) => i + 2), ...[999, 4000]]; return all.filter((v) => egressTag(pc, v).ok); }

// ---------------------------------------------------------------- L2 reach: who hears a frame sent from this interface (the broadcast domain), with the path through each bridge
function l2reach(L, ep) {
  const found = [], seen = new Set(); let storm = false;
  const inside = (devId, v, path) => {
    const key = `${devId}|${v}`; if (seen.has(key)) return; seen.add(key);
    if (L._storm?.has(key)) storm = true;
    const d = L.devs[devId], B = bridgeOf(L, d);
    l3ifs(L, d).filter((e) => e.svi != null && String(e.svi) === String(v) && e !== ep && !(ep.dev === devId && ep.ifn === e.ifn)).forEach((e) => e.up && found.push({ ep: e, path }));
    const isoIn = path.length && path[path.length - 1].iso;
    Object.entries(B.P).forEach(([pn, pc]) => {
      if (d.kind === 'sw' && (stpBlocked(L, d.id, pn) || (pc.cg && L._po?.[`${d.id}|${pc.cg}`]?.ok && L._po[`${d.id}|${pc.cg}`].mem[0] !== pn))) return;
      if (!bridgePortUp(L, d, pn)) return;
      const e = egressTag(pc, v); if (!e.ok) return;
      if (isoIn && pc.iso) return;
      const p2 = path.concat([{ dev: devId, v, out: pn }]);
      const pr = bridgeVPeer(L, d, pn); if (!pr) return;
      arrive(pr.dev, pr.port, e.tag, p2, pr.virt);
    });
  };
  const arrive = (devId, port, tag, path, virt) => {
    const D = L.devs[devId]; if (!D) return;
    if (isBridge(D) && !virt) {
      if (D.kind === 'sw' && (D.off || stpBlocked(L, devId, port))) return;
      if (D.kind === 'sw' && !portUp(L, devId, port)) return;
      if (D.kind !== 'sw' && D.kind !== 'hub' && !powered(L, D)) return;
      const B = bridgeOf(L, D), pc = B.P[port]; if (!pc) return;
      const v = ingressVlan(pc, tag); if (v == null || (B.V && !B.V.has(+v))) return;
      if (D.kind === 'phone' && port === 'pc' && v !== 'U') return;
      inside(devId, v, path.concat([{ dev: devId, in: port, v, iso: !!pc.iso }]));
      return;
    }
    l3ifs(L, D).filter((e) => e.port === port && !(ep.dev === e.dev && ep.ifn === e.ifn)).forEach((e) => { if ((e.tag ?? null) === (tag ?? null) && e.up) found.push({ ep: e, path }); });
  };
  const D0 = L.devs[ep.dev];
  if (ep.svi != null) inside(ep.dev, ep.svi, []);
  else if (isBridge(D0)) { }
  else {
    if (D0.kind === 'vm' || D0.vmHost) { const H = L.devs[D0.vmHost]; if (H) { const B = bridgeOf(L, H), pn = `vm:${D0.id}:${ep.port}`, pc = B.P[pn]; if (pc && bridgePortUp(L, H, pn)) { const v = ingressVlan(pc, ep.tag ?? null); if (v != null) inside(H.id, v, [{ dev: H.id, in: pn, v }]); } } }
    else if (D0.wifi) { const A = L.devs[D0.wifi]; if (A) { const B = bridgeOf(L, A), pn = `wlan:${D0.id}`, pc = B.P[pn]; if (pc && bridgePortUp(L, A, pn)) inside(A.id, pc.vlan, [{ dev: A.id, in: pn, v: pc.vlan, iso: !!pc.iso }]); } }
    else { const pr = peerOf(L, ep.dev, ep.port); if (pr && linkUp(L, ep.dev, ep.port)) arrive(pr.dev, pr.port, ep.tag ?? null, [], false); }
  }
  return { found, storm };
}
function learnMacs(L) {
  L.mac = {};
  allEps(L).forEach((ep) => { if (!ep.up || !ep.mac || (ep.svi != null && L.devs[ep.dev].kind === 'sw')) return; const r = l2reach(L, ep); r.found.forEach(({ path }) => path.forEach((h) => { if (h.in && L.devs[h.dev]?.kind === 'sw') { (L.mac[h.dev] ??= {})[`${h.v}|${ep.mac}`] = h.in; } })); });
}
/** Two interfaces with the same address in one broadcast domain: Windows gives up its address (Duplicate) and falls back to 169.254.x.x */
function dupCheck(L) {
  Object.values(L.devs).forEach((d) => { if (!d.nics || Array.isArray(d.nics)) return; Object.entries(d.nics).forEach(([n, c]) => { if (!c.ip || c.up === false) { c.dup = false; return; } const ep = { dev: d.id, ifn: n, ip: c.ip, mask: c.mask, port: n, tag: c.vtag ?? null, up: true }; const r = l2reach(L, ep); const clash = r.found.find((f) => f.ep.ip === c.ip);
    if (clash && c.dupWho !== clash.ep.dev) { c.dupWho = clash.ep.dev; if (d.os === 'win' && !c.dupKeep && (c.setAt ?? 0) >= (L.devs[clash.ep.dev]?.nics?.[clash.ep.ifn]?.setAt ?? 0)) { c.dup = true; c.apipa = `169.254.${(ip2n(c.mac.replace(/:/g, '').slice(0, 8).replace(/(..)(..)(..)(..)/, '$1.$2.$3.$4').split('.').map((x) => parseInt(x, 16) & 255).join('.')) >>> 8) & 254 || 1}.${(parseInt(c.mac.slice(-2), 16) % 253) + 1}`; logAdd(L, d.id, `Windows has detected an IP address conflict: another system on this network is using ${c.ip} (${clash.ep.mac}).`); } }
    if (!clash) { c.dup = false; c.dupWho = null; } }); });
}

// ---------------------------------------------------------------- routing tables
/** Routes of one device: connected, static, OSPF – with administrative distance and the outgoing interface */
function routesOf(L, d) {
  const R = [];
  const ifs = l3ifs(L, d).filter((e) => e.ip && e.mask && e.up);
  ifs.forEach((e) => R.push({ net: netOf(e.ip, e.mask), mask: e.mask, type: 'C', ad: 0, ifn: e.ifn, ep: e }));
  if (d.nics && !Array.isArray(d.nics)) {
    Object.entries(d.nics).forEach(([n, c]) => { const e = ifs.find((x) => x.ifn === n); const gw = c.dup ? null : c.gw; if (e && gw && isIp(gw) && (sameNet(gw, e.ip, e.mask) || d.os === 'win')) R.push({ net: '0.0.0.0', mask: '0.0.0.0', type: 'S', ad: 1, via: gw, ifn: n, ep: e, metric: c.metric ?? 25, offlink: !sameNet(gw, e.ip, e.mask) }); });
    (d.routes || []).forEach((r) => { const e = ifs.find((x) => sameNet(r.via, x.ip, x.mask)); if (e) R.push({ net: r.net, mask: r.mask, type: 'S', ad: 1, via: r.via, ifn: e.ifn, ep: e }); });
    return R;
  }
  if (d.kind === 'fw') {
    fgTable(d, 'router static').forEach(([, r]) => { if ((r.status ?? ['enable'])[0] === 'disable') return; const [net, mask] = r.dst ? fgNet(r.dst) : ['0.0.0.0', '0.0.0.0']; const dev = r.device?.[0]; if (r.blackhole?.[0] === 'enable') { R.push({ net, mask, type: 'S', ad: +(r.distance?.[0] ?? 10), blackhole: true }); return; } const tun = fgTunnels(d).find((t) => t.name === dev); if (tun) { if (L._vpn?.[`${d.id}|${dev}`]?.up) R.push({ net, mask, type: 'S', ad: +(r.distance?.[0] ?? 10), tunnel: dev, ifn: dev }); return; } const gw = r.gateway?.[0], e = ifs.find((x) => x.ifn === dev) ?? ifs.find((x) => gw && sameNet(gw, x.ip, x.mask)); if (e && (!gw || sameNet(gw, e.ip, e.mask))) R.push({ net, mask, type: 'S', ad: +(r.distance?.[0] ?? 10), via: gw, ifn: e.ifn, ep: e }); });
    const ssl = fgSslPool(d); if (ssl) R.push({ net: ssl.net, mask: ssl.mask, type: 'C', ad: 0, ifn: 'ssl.root', ssl: true });
    return R.sort((a, b) => mask2len(b.mask) - mask2len(a.mask) || a.ad - b.ad);
  }
  (d.routes || []).forEach((r) => {
    if (r.ifn && !r.via) { const e = ifs.find((x) => x.ifn === r.ifn); if (e) R.push({ net: r.net, mask: r.mask, type: 'S', ad: r.ad ?? 1, ifn: e.ifn, ep: e, direct: true }); return; }
    const e = ifs.find((x) => sameNet(r.via, x.ip, x.mask)); if (e) R.push({ net: r.net, mask: r.mask, type: 'S', ad: r.ad ?? 1, via: r.via, ifn: e.ifn, ep: e });
  });
  (L._ospf?.routes?.[d.id] || []).forEach((r) => R.push(r));
  if (d.kind === 'isp') {
    Object.values(L.devs).forEach((o) => { if (o.kind !== 'fw' && o.kind !== 'rt') return; (o.publicNets || []).forEach((pn) => { const x = cidr(pn); const e = ifs.find((i) => l2Owner(L, i, (o.kind === 'fw' ? fgWanIps(o) : rtWanIps(o))[0])); if (e) R.push({ net: x.ip, mask: x.mask, type: 'S', ad: 1, via: (o.kind === 'fw' ? fgWanIps(o) : rtWanIps(o))[0], ifn: e.ifn, ep: e }); }); });
  }
  return R;
}
const fgWanIps = (d) => fgIfList(d).map(([, c]) => fgIpOf(c)[0]).filter((ip) => ip && !isPriv(ip));
const rtWanIps = (d) => Object.values(d.ifs).map((c) => c.ip).filter((ip) => ip && !isPriv(ip));
function l2Owner(L, ep, ip) { return ip && l2reach(L, ep).found.some((f) => f.ep.ip === ip); }
function lookup(L, d, dst) {
  const R = routesOf(L, d).filter((r) => inNet(dst, r.net, r.mask));
  R.sort((a, b) => mask2len(b.mask) - mask2len(a.mask) || a.ad - b.ad || (a.metric ?? 0) - (b.metric ?? 0));
  return R[0] || null;
}

// ---------------------------------------------------------------- OSPF (single area per adjacency check, SPF by interface cost)
function ospfCalc(L) {
  const rts = Object.values(L.devs).filter((d) => (d.kind === 'rt' || (d.kind === 'sw' && d.iprouting)) && d.ospf);
  const ospfIfs = (d) => l3ifs(L, d).filter((e) => e.ip && e.up).map((e) => { const n = (d.ospf.nets || []).find((x) => inNet(e.ip, x.net, wild2mask(x.wild))); const ic = (d.kind === 'rt' ? d.ifs[e.ifn] : d.svis[e.svi]) || {}; return n ? { e, area: String(n.area), passive: (d.ospf.passive || []).includes(e.ifn) || (d.ospf.passiveDefault && !(d.ospf.nopassive || []).includes(e.ifn)), hello: ic.hello ?? 10, cost: ic.cost ?? (/^(Te|Xe)/.test(e.ifn) ? 1 : /^Fa/.test(e.ifn) ? 1 : 1), mtu: ic.mtu ?? 1500 } : null; }).filter(Boolean);
  const nb = [], why = [];
  rts.forEach((a) => ospfIfs(a).forEach((ia) => { if (ia.passive) return; l2reach(L, ia.e).found.forEach(({ ep }) => { const b = L.devs[ep.dev]; if (!rts.includes(b) || b.id <= a.id) return; const ib = ospfIfs(b).find((x) => x.e.ifn === ep.ifn); if (!ib || ib.passive) return;
    let w = ''; if (!sameNet(ia.e.ip, ib.e.ip, ia.e.mask) || ia.e.mask !== ib.e.mask) w = 'mismatched subnet'; else if (ia.area !== ib.area) w = `mismatched area ID (area ${ib.area} from ${ib.e.ip}, ours ${ia.area})`; else if (ia.hello !== ib.hello) w = 'mismatched hello parameters'; else if (ia.mtu !== ib.mtu) w = 'MTU mismatch – neighbour stuck in EXSTART';
    if (w) { why.push({ a: a.id, b: b.id, ifa: ia.e.ifn, ifb: ib.e.ifn, w }); logOnce(L, a.id, `%OSPF-4-ERRRCV: Received invalid packet: ${w} from ${ib.e.ip}, ${ia.e.ifn}`); return; }
    nb.push({ a: a.id, b: b.id, ia, ib }); }); }));
  const routes = {}, neigh = {};
  nb.forEach((n) => { (neigh[n.a] ??= []).push({ rid: rid(L.devs[n.b]), ip: n.ib.e.ip, ifn: n.ia.e.ifn, state: 'FULL' }); (neigh[n.b] ??= []).push({ rid: rid(L.devs[n.a]), ip: n.ia.e.ip, ifn: n.ib.e.ifn, state: 'FULL' }); });
  rts.forEach((src) => {
    const dist = { [src.id]: 0 }, first = {}, q = [src.id];
    while (q.length) { q.sort((x, y) => dist[x] - dist[y]); const u = q.shift(); nb.filter((n) => n.a === u || n.b === u).forEach((n) => { const v = n.a === u ? n.b : n.a, iu = n.a === u ? n.ia : n.ib, iv = n.a === u ? n.ib : n.ia, c = dist[u] + iu.cost; if (dist[v] == null || c < dist[v]) { dist[v] = c; first[v] = u === src.id ? { via: iv.e.ip, ifn: iu.e.ifn, ep: iu.e } : first[u]; q.push(v); } }); }
    const mine = new Set(l3ifs(L, src).filter((e) => e.ip && e.up).map((e) => `${netOf(e.ip, e.mask)}/${e.mask}`));
    const R = [];
    Object.keys(dist).filter((id) => id !== src.id).forEach((id) => { const d = L.devs[id];
      ospfIfs(d).forEach((x) => { const k = `${netOf(x.e.ip, x.e.mask)}/${x.e.mask}`; if (mine.has(k)) return; const c = dist[id] + x.cost; const ex = R.find((r) => r.net === netOf(x.e.ip, x.e.mask) && r.mask === x.e.mask); if (!ex || ex.cost > c) { if (ex) R.splice(R.indexOf(ex), 1); R.push({ net: netOf(x.e.ip, x.e.mask), mask: x.e.mask, type: 'O', ad: 110, cost: c, via: first[id].via, ifn: first[id].ifn, ep: first[id].ep }); } });
      if (d.ospf.defOrig && (d.routes || []).some((r) => r.net === '0.0.0.0')) { if (!R.some((r) => r.net === '0.0.0.0')) R.push({ net: '0.0.0.0', mask: '0.0.0.0', type: 'O*E2', ad: 110, cost: 1, via: first[id].via, ifn: first[id].ifn, ep: first[id].ep }); }
    });
    routes[src.id] = R;
  });
  return { routes, neigh, why };
}
const rid = (d) => d.ospf?.rid || [...Object.values(d.kind === 'rt' ? d.ifs || {} : {}), ...Object.values(d.kind === 'sw' ? d.svis || {} : {})].filter((c) => !c.shut).map((c) => c.ip).filter(Boolean).sort((a, b) => ip2n(b) - ip2n(a))[0] || '0.0.0.0';

// ---------------------------------------------------------------- IOS access lists
function aclMatch(d, name, pkt) {
  const A = d.acls?.[name]; if (!A) return true;
  for (const r of A) { if (aclRule(r, pkt)) return r.act === 'permit'; }
  return false;
}
function aclRule(r, p) {
  const m = (spec, ip) => spec === 'any' || (spec.host ? spec.host === ip : inNet(ip, spec.net, wild2mask(spec.wild)));
  if (r.std) return m(r.src, p.src);
  if (r.proto !== 'ip' && r.proto !== p.proto) return false;
  if (!m(r.src, p.src) || !m(r.dst, p.dst)) return false;
  if (r.eq != null && p.dport !== r.eq) return false;
  return true;
}

// ---------------------------------------------------------------- packets: hop-by-hop forwarding with NAT, firewall policies, tunnels and the return path
/** Send a packet from a device. pkt: { dst, proto: icmp|tcp|udp, dport, src? }. Returns { res, hops, by, rtt, why, path } */
function send(L, from, pkt, o = {}) {
  const d0 = L.devs[from]; pkt = { proto: 'icmp', ttl: 128, ...pkt }; if (d0.kind === 'rt' || d0.kind === 'fw' || d0.kind === 'sw') pkt.ttl = 255;
  if (d0.ssl?.up && !o.noSsl && d0.ssl.nets.some(([n, m]) => inNet(pkt.dst, n, m)) && pkt.dst !== d0.ssl.gw) { pkt.src = d0.ssl.ip; const fw = d0.ssl.fw; const go = walk(L, fw, { ...pkt }, { ...o, fromSsl: true }); if (go.res !== 'ok' || o.oneWay) return go; const back = walk(L, go.at, { src: go.pkt.dst, dst: go.pkt.src, proto: pkt.proto, dport: pkt.sport, sport: pkt.dport, ttl: 128 }, { reply: true, nat: go.nat }); return back.res === 'ok' && back.at === fw ? { ...go, res: go.svc ?? 'ok', viaSsl: true } : back.res === 'ok' && back.pkt.dst === pkt.src ? { ...go, res: go.svc ?? 'ok', viaSsl: true } : { ...go, res: 'timeout', why: back.why ? `the reply was lost: ${back.why}` : 'the reply did not come back' }; }
  if (/^127\./.test(pkt.dst)) pkt.src = pkt.dst;
  if (!pkt.src) { const r = lookup(L, d0, pkt.dst); const e = r?.ep ?? l3ifs(L, d0).find((x) => x.ip && x.up); pkt.src = o.srcIp ?? (r?.ssl ? null : e?.ip) ?? null; }
  if (!pkt.src) return { res: 'nosrc', hops: [], why: 'no IP address on this device' };
  const go = walk(L, from, { ...pkt }, { ...o });
  if (go.res !== 'ok') return go;
  if (o.oneWay) return go;
  const back = walk(L, go.at, { src: go.pkt.dst, dst: go.pkt.src, proto: pkt.proto, dport: pkt.sport, sport: pkt.dport, ttl: 128 }, { reply: true, nat: go.nat, sess: go.sess });
  if (back.res !== 'ok' || back.pkt.dst !== pkt.src) return { ...go, res: 'timeout', why: back.why ? `the reply was lost: ${back.why}` : 'the reply did not come back', back };
  return { ...go, back, res: go.svc ?? 'ok' };
}
function walk(L, from, pkt, o) {
  const hops = [], nat = o.nat ? o.nat.slice() : [], sess = [];
  let dev = L.devs[from], inIf = null, guard = 0;
  while (guard++ < 40) {
    const mine = l3ifs(L, dev).find((e) => e.ip === pkt.dst && e.up) || (inIf == null && /^127\./.test(pkt.dst) ? { ip: pkt.dst, ifn: 'lo' } : null);
    if (o.reply) { const n = [...nat].reverse().find((x) => x.dev === dev.id && x.kind === 'snat' && x.to === pkt.dst && x.toPort == null); if (n && !mine) { pkt.dst = n.from; nat.splice(nat.indexOf(n), 1); continue; } const n2 = [...nat].reverse().find((x) => x.dev === dev.id && x.kind === 'snat' && x.to === pkt.dst); if (n2 && n2.from !== pkt.dst) { pkt.dst = n2.from; nat.splice(nat.indexOf(n2), 1); continue; } const dn = [...nat].reverse().find((x) => x.dev === dev.id && x.kind === 'dnat' && x.to === pkt.src); if (dn) { pkt.src = dn.from; nat.splice(nat.indexOf(dn), 1); } }
    if (mine || (dev.kind === 'isp' && L.inet.hosts[pkt.dst])) {
      if (!o.reply && dev.kind === 'fw') { const v = fgVip(L, dev, inIf, pkt); if (v) { nat.push({ dev: dev.id, kind: 'dnat', from: pkt.dst, to: v.ip }); pkt.dst = v.ip; if (v.port) pkt.dport = v.port; pkt.vip = v.name; continue; } }
      if (!o.reply && dev.kind === 'rt') { const s = (dev.nat.statics || []).find((x) => x.outside === pkt.dst && (!x.proto || (x.proto === pkt.proto && x.oport === pkt.dport))); if (s && inIf && dev.ifs[inIf]?.nat === 'outside') { nat.push({ dev: dev.id, kind: 'dnat', from: pkt.dst, to: s.inside }); pkt.dst = s.inside; if (s.iport) pkt.dport = s.iport; continue; } }
      const sv = o.reply ? null : svcCheck(L, dev, pkt, inIf);
      if (sv && sv.drop) return { res: 'timeout', hops, why: sv.why, at: dev.id, pkt, nat };
      return { res: 'ok', svc: sv?.res, hops, at: dev.id, pkt, nat, sess, why: sv?.why };
    }
    if (inIf != null && dev.nics && !Array.isArray(dev.nics) && !dev.ipfwd) return { res: 'timeout', hops, why: `${dev.name} does not forward packets`, at: dev.id, pkt };
    if (inIf != null && dev.kind === 'sw' && !dev.iprouting) return { res: 'timeout', hops, why: `${dev.name} is a layer 2 switch – no ip routing`, at: dev.id, pkt };
    if (inIf != null) { pkt.ttl--; if (pkt.ttl <= 0) return { res: 'ttl', hops, by: hops[hops.length - 1]?.ip, at: dev.id, pkt }; }
    if (dev.kind === 'rt' && inIf != null && dev.ifs[inIf]?.aclIn && !o.reply && !aclMatch(dev, dev.ifs[inIf].aclIn, pkt)) return { res: 'unreach-adm', hops, by: hops[hops.length - 1]?.ip, why: `access list ${dev.ifs[inIf].aclIn} on ${dev.name} ${inIf} denied it`, at: dev.id, pkt };
    if (dev.kind === 'rt' && inIf != null && dev.ifs[inIf]?.aclIn && o.reply && !aclMatch(dev, dev.ifs[inIf].aclIn, pkt)) return { res: 'timeout', hops, why: `access list ${dev.ifs[inIf].aclIn} on ${dev.name} dropped the reply`, at: dev.id, pkt };
    if (dev.kind === 'isp' && isPriv(pkt.dst)) return { res: inIf ? 'timeout' : 'unreach-net', hops, why: `private address ${pkt.dst} is not routed on the internet`, at: dev.id, pkt };
    const r = lookup(L, dev, pkt.dst);
    if (!r) { if (inIf == null) return { res: 'nogw', hops, why: dev.nics ? 'no default gateway for this destination' : 'no route', at: dev.id, pkt }; return { res: 'unreach-net', hops, by: hops[hops.length - 1]?.ip, why: `${dev.name} has no route to ${pkt.dst}`, at: dev.id, pkt }; }
    if (r.blackhole) return { res: 'timeout', hops, why: `${dev.name} drops it (blackhole route)`, at: dev.id, pkt };
    if (dev.kind === 'isp' && isPriv(pkt.src) && !o.reply) { }
    if (dev.kind === 'fw' && inIf != null || (dev.kind === 'fw' && o.fromSsl)) {
      const egr = r.tunnel ?? r.ifn;
      if (!o.reply) { const p = fgPolicy(L, dev, o.fromSsl ? 'ssl.root' : inIf, egr, pkt); if (!p.ok) { fgLog(L, dev, o.fromSsl ? 'ssl.root' : inIf, egr, pkt, p); return { res: 'timeout', hops, why: p.why, at: dev.id, pkt, fwDeny: { dev: dev.id, policy: p.id } }; } sess.push({ dev: dev.id, policy: p.id }); fgLog(L, dev, o.fromSsl ? 'ssl.root' : inIf, egr, pkt, p); if (p.nat && !r.tunnel && r.ep?.ip) { nat.push({ dev: dev.id, kind: 'snat', from: pkt.src, to: r.ep.ip }); pkt.src = r.ep.ip; } }
      o.fromSsl = false;
    }
    if (dev.kind === 'rt' && !o.reply && inIf != null) {
      const ie = dev.ifs[inIf], oe = dev.ifs[r.ifn];
      if (ie?.nat === 'inside' && oe?.nat === 'outside') { const rule = (dev.nat.rules || []).find((x) => dev.acls?.[x.acl] && aclMatch(dev, x.acl, pkt) && (x.ifn === r.ifn || x.pool)); if (rule) { const to = rule.ifn ? oe.ip : rule.pool; nat.push({ dev: dev.id, kind: 'snat', from: pkt.src, to }); pkt.src = to; dev.nat.xlate = (dev.nat.xlate || []).concat([{ proto: pkt.proto, inside: pkt.src, ...nat[nat.length - 1] }]).slice(-20); } }
      if (oe?.aclOut && !aclMatch(dev, oe.aclOut, pkt)) return { res: 'unreach-adm', hops, by: ie?.ip, why: `access list ${oe.aclOut} on ${dev.name} ${r.ifn} (out) denied it`, at: dev.id, pkt };
    }
    if (r.tunnel) { const t = L._vpn?.[`${dev.id}|${r.tunnel}`]; if (!t?.up) return { res: 'timeout', hops, why: `tunnel ${r.tunnel} is down`, at: dev.id, pkt }; const peer = L.devs[t.peer]; hops.push({ dev: peer.id, ip: fgIpOf(fgIf(peer, fgIfList(peer).find(([, c]) => c.type?.[0] !== 'tunnel' && fgIpOf(c)[0] && isPriv(fgIpOf(c)[0]))?.[0]) || {})[0] || t.peerIp, tunnel: true }); dev = peer; inIf = t.peerIf; continue; }
    if (r.ssl) { const u = Object.values(L.devs).find((x) => x.ssl?.fw === dev.id && x.ssl.ip === pkt.dst && x.ssl.up); if (!u) return { res: 'unreach-host', hops, by: hops[hops.length - 1]?.ip, why: 'no SSL-VPN user has that address', at: dev.id, pkt }; hops.push({ dev: u.id, ip: pkt.dst }); return { res: 'ok', hops, at: u.id, pkt, nat, sess }; }
    const nh = r.via ?? pkt.dst;
    if (!r.ep) return { res: 'timeout', hops, why: 'no interface', at: dev.id, pkt };
    const rr = l2reach(L, r.ep);
    if (rr.storm) { stormLog(L, r.ep); return { res: 'timeout', hops, why: 'broadcast storm – the switches are flooded by a loop', at: dev.id, pkt, storm: true }; }
    const hit = rr.found.find((f) => f.ep.ip === nh && f.ep.up);
    arpLearn(L, dev.id, r.ep, hit?.ep, nh);
    if (!hit) { if (inIf == null && !dev.kind.match(/rt|fw|isp/)) return { res: 'unreach-host', hops, by: r.ep.ip, why: `no answer to ARP for ${nh}`, at: dev.id, pkt }; return { res: 'unreach-host', hops, by: hops[hops.length - 1]?.ip ?? r.ep.ip, why: `${dev.name} gets no ARP answer for ${nh}`, at: dev.id, pkt }; }
    if (hit.ep.host && L.devs[hit.ep.dev].fwin?.on && pkt.dst !== hit.ep.ip && !L.devs[hit.ep.dev].ipfwd) { }
    capHop(L, dev.id, hit.ep.dev, pkt, o);
    hops.push({ dev: hit.ep.dev, ip: hit.ep.ip, ifn: hit.ep.ifn });
    dev = L.devs[hit.ep.dev]; inIf = hit.ep.ifn;
  }
  return { res: 'timeout', hops, why: 'routing loop', pkt };
}
function stormLog(L, ep) { logOnce(L, ep.dev, '%SW_MATM-4-MACFLAP_NOTIF: Host flapping between ports – broadcast storm'); Object.values(L.devs).filter((d) => d.kind === 'sw').forEach((d) => { if ([...L._storm].some((k) => k.startsWith(`${d.id}|`))) logOnce(L, d.id, `%SW_MATM-4-MACFLAP_NOTIF: Host ${macCisco(macOf('x' + d.id))} in vlan ${[...L._storm].find((k) => k.startsWith(`${d.id}|`)).split('|')[1]} is flapping between port ${Object.keys(d.ports)[0]} and port ${Object.keys(d.ports)[1]}`); }); }
function arpLearn(L, a, ep, hit, nh) { (L.arp[a] ??= {})[nh] = hit ? { mac: hit.mac, ifn: ep.ifn, t: L.clock } : { mac: null, ifn: ep.ifn, t: L.clock }; if (hit) (L.arp[hit.dev] ??= {})[ep.ip] = { mac: ep.mac, ifn: hit.ifn, t: L.clock }; }
/** Is something listening, and does the host firewall let it in */
function svcCheck(L, d, p, inIf) {
  if (d.kind === 'isp') { const h = L.inet.hosts[p.dst] || {}; if (isPriv(p.src)) return { drop: true, why: 'a private source address on the internet – NAT is missing' }; if (p.proto === 'icmp') return { res: 'ok' }; return (h[p.proto] || []).includes(p.dport) ? { res: 'ok' } : { res: 'refused' }; }
  if (d.kind === 'fw') { const c = fgIf(d, inIf) || {}; const acc = c.allowaccess || []; if (p.proto === 'icmp') return acc.includes('ping') ? { res: 'ok' } : { drop: true, why: `ping is not allowed on ${d.name} ${inIf} (allowaccess)` }; const need = { 443: 'https', 80: 'http', 22: 'ssh', 161: 'snmp' }[p.dport]; if (p.dport === 10443 && fgSslOn(d)) return { res: 'ok' }; if (p.proto === 'udp' && p.dport === 500) return { res: 'ok' }; return need && acc.includes(need) ? { res: 'ok' } : { drop: true, why: `${need || p.dport} is not allowed to ${d.name} on ${inIf}` }; }
  if (d.kind === 'rt' || d.kind === 'sw') { if (p.proto === 'icmp') return { res: 'ok' }; if (p.proto === 'udp' && p.dport === 67) return d.dhcp && Object.keys(d.dhcp.pools || {}).length ? { res: 'ok' } : { drop: true, why: 'no DHCP server on ' + d.hostname }; if (p.proto === 'udp' && p.dport === 161) return d.snmp?.community ? { res: 'ok' } : { drop: true, why: 'SNMP is not enabled on ' + d.hostname }; if (p.proto === 'udp' && p.dport === 123) return d.ntpMaster ? { res: 'ok' } : { drop: true }; if (p.dport === 22) return d.rsa ? { res: 'ok' } : { res: 'refused' }; if (p.dport === 23) return d.noTelnet ? { res: 'refused' } : { res: 'ok' }; return { res: 'refused' }; }
  if (!d.nics || Array.isArray(d.nics)) return p.proto === 'icmp' || [22, 80, 443, 161].includes(p.dport) ? { res: 'ok' } : { res: 'refused' };
  const ports = svcPorts(L, d);
  if (p.proto === 'icmp') { if (d.fwin?.on && d.fwin.noPing) return { drop: true, why: `the Windows Firewall on ${d.name} blocks ping (ICMP echo)` }; if (d.ufw?.on && d.ufw.noPing) return { drop: true, why: `ufw on ${d.name} drops ping` }; return { res: 'ok' }; }
  const listening = (ports[p.proto] || []).includes(p.dport);
  if (d.fwin?.on && d.os === 'win' && listening && !fwAllows(d, p)) return { drop: true, why: `the Windows Firewall on ${d.name} blocks ${p.proto.toUpperCase()} ${p.dport}` };
  if (d.ufw?.on && !ufwAllows(d, p)) return { drop: true, why: `ufw on ${d.name} blocks ${p.proto} ${p.dport}` };
  if (d.firewalld?.on && !(d.firewalld.ports || []).includes(`${p.dport}/${p.proto}`) && !(d.firewalld.svcs || []).some((s) => (SVC_PORTS[s] || []).includes(p.dport))) return { drop: true, why: `firewalld on ${d.name} blocks ${p.dport}/${p.proto}` };
  return listening ? { res: 'ok' } : { res: 'refused', why: `nothing listens on ${p.proto} ${p.dport} on ${d.name}` };
}
const SVC_PORTS = { http: [80], https: [443], ssh: [22], dns: [53], rdp: [3389], smb: [445], ldap: [389], kerberos: [88], snmp: [161], syslog: [514], ntp: [123], nfs: [2049], iscsi: [3260], 'iscsi-target': [3260], mysql: [3306], zabbix: [10050, 10051], dhcp: [67], 'proxmox': [8006] };
/** Listening ports come from what runs: Windows roles and services, Linux systemd units */
function svcPorts(L, d) {
  const t = new Set(), u = new Set();
  Object.entries(d.svc || {}).forEach(([k, s]) => { if (s.run === false || s.status === 'Stopped' || s.active === false) return; (s.tcp || []).forEach((x) => t.add(x)); (s.udp || []).forEach((x) => u.add(x)); });
  if (typeof hostPorts === 'function') hostPorts(L, d, t, u);
  return { tcp: [...t], udp: [...u] };
}
function fwAllows(d, p) { if (!d.fwin?.on) return true; if ((d.fwin.block || []).includes(p.dport)) return false; return true; }
function ufwAllows(d, p) { const r = d.ufw.rules || []; if (r.some((x) => x.deny && (x.port === p.dport || x.port === String(p.dport)))) return false; if (r.some((x) => !x.deny && (+x.port === p.dport || (SVC_PORTS[x.port] || []).includes(p.dport)) && (!x.proto || x.proto === p.proto) && (!x.from || x.from === 'any' || inNet(p.src, cidr(x.from).ip, cidr(x.from).mask)))) return true; return d.ufw.inDefault === 'allow'; }

// ---------------------------------------------------------------- packet capture (what Wireshark would show on a host)
function capHop(L, a, b, pkt, o) { [a, b].forEach((x) => { if (L.cap.on[x]) capAdd(L, x, { src: pkt.src, dst: pkt.dst, proto: pkt.proto, dport: pkt.dport, sport: pkt.sport, reply: !!o.reply, info: pkt.info }); }); }
function capAdd(L, dev, p) { if (!L.cap.on[dev]) return; L.cap.pkts.push({ no: L.cap.pkts.length + 1, t: L.clock / 1000, dev, ...p }); if (L.cap.pkts.length > 3000) L.cap.pkts.shift(); }

// ---------------------------------------------------------------- DHCP: discover in the broadcast domain, relays (ip helper-address), snooping, scopes, reservations, exhaustion
function dhcpRun(L, d, nic, o = {}) {
  const c = d.nics[nic]; const ep = { dev: d.id, ifn: nic, ip: null, mask: null, port: nic, tag: c.vtag ?? null, up: c.up !== false, mac: c.mac };
  const cap = (info, src, dst, t = 0) => { tick(L, t); capAdd(L, d.id, { src: src || '0.0.0.0', dst: dst || '255.255.255.255', proto: 'udp', sport: 68, dport: 67, info, dhcp: true }); };
  cap(`DHCP Discover - Transaction ID 0x${(Math.random() * 1e8 | 0).toString(16)}`);
  const offer = dhcpOffer(L, ep, c.mac);
  if (!offer.ok) return dhcpFail(L, d, nic, offer.why);
  const best = offer.best;
  cap(`DHCP Offer    - ${best.ip}`, best.by, best.ip, 4); cap('DHCP Request', null, null, 2); cap(`DHCP ACK      - ${best.ip}`, best.by, best.ip, 3);
  Object.assign(c, { ip: best.ip, mask: best.mask, gw: best.gw, dns: best.dns || [], dom: best.dom, lease: { server: best.by, time: best.time ?? 86400, at: L.clock }, apipa: null, dup: false, setAt: L.clock });
  best.commit?.();
  return { ok: true, ip: best.ip, server: best.by };
}
/** Who answers a DHCP discover from this interface: local servers, relays, snooping, scopes */
function dhcpOffer(L, ep, mac) {
  const c = { mac };
  const r = l2reach(L, ep); const offers = [];
  if (r.storm) return { ok: false, why: 'broadcast storm' };
  r.found.forEach(({ ep: s, path }) => {
    const S = L.devs[s.dev];
    const trusted = path.every((h) => { const sw = L.devs[h.dev]; if (sw?.kind !== 'sw' || !sw.snoop?.on || !h.out) return true; if (!(sw.snoop.vlans || []).map(String).includes(String(h.v))) return true; return !!sw.ports[h.out]?.trust; });
    const helper = S.kind === 'rt' ? S.ifs[s.ifn]?.helper || [] : S.kind === 'sw' ? S.svis[s.svi]?.helper || [] : S.kind === 'fw' ? (fgIf(S, s.ifn)?.['dhcp-relay-ip'] || []) : [];
    const local = dhcpServe(L, S, s, null, c.mac);
    if (local) offers.push({ ...local, trusted, by: s.ip, viaRelay: false, rogue: !!S.rogue });
    helper.forEach((h) => { if (!s.ip) return; const t = send(L, S.id, { dst: h, proto: 'udp', dport: 67, src: s.ip }); if (t.res !== 'ok') return; const H = L.devs[t.at]; const o2 = dhcpServe(L, H, l3ifs(L, H).find((e) => e.ip === h), s, c.mac); if (o2) offers.push({ ...o2, trusted, by: h, relay: s.ip }); else if (H && dhcpScopes(L, H).length && !o2) logOnce(L, H.id, `DHCP: no scope for relay ${s.ip}`); });
  });
  const ok = offers.filter((x) => x.trusted && !x.err);
  const sn = offers.find((x) => !x.trusted); if (sn) { const sw = r.found.flatMap((f) => f.path).find((h) => L.devs[h.dev]?.snoop?.on); if (sw) logOnce(L, sw.dev, `%DHCP_SNOOPING-5-DHCP_SNOOPING_UNTRUSTED_PORT: DHCP_SNOOPING drop message on untrusted port, message type: DHCPOFFER, MAC sa: ${macCisco(macOf(sn.by))}`); }
  const full = offers.find((x) => x.err === 'full');
  const best = ok.sort((a, b) => (b.rogue ? 1 : 0) - (a.rogue ? 1 : 0))[0];
  if (!best) return { ok: false, why: full ? 'the scope has no free addresses' : sn ? 'offers dropped by DHCP snooping (untrusted port)' : 'no DHCP server answered' };
  return { ok: true, best };
}
function dhcpFail(L, d, nic, why) { const c = d.nics[nic]; Object.assign(c, { ip: null, mask: null, gw: null, lease: null, dhcpErr: why }); if (d.os === 'win') { c.apipa = `169.254.${(parseInt(c.mac.slice(-5, -3), 16) % 254) + 1}.${(parseInt(c.mac.slice(-2), 16) % 253) + 1}`; c.dup = true; } return { ok: false, why }; }
/** Scopes / pools a device serves */
function dhcpScopes(L, S) {
  if (!S) return [];
  if (S.kind === 'rt' || (S.kind === 'sw' && S.dhcp)) return Object.entries(S.dhcp?.pools || {}).filter(([, p]) => p.net).map(([n, p]) => ({ name: n, net: p.net, mask: p.mask, start: n2ip(ip2n(p.net) + 1), end: n2ip(ip2n(bcastOf(p.net, p.mask)) - 1), gw: p.gw, dns: p.dns || [], dom: p.dom, excl: S.dhcp.excl || [], res: p.res || {}, used: S.dhcp.bind, cap: p.cap, kind: 'ios' }));
  if (S.kind === 'fw') return fgTable(S, 'system dhcp server').filter(([, s]) => (s.status ?? ['enable'])[0] !== 'disable').map(([n, s]) => { const ifc = fgIf(S, s.interface?.[0]); const [ip, m] = ifc ? fgIpOf(ifc) : []; const rg = Object.values(s['ip-range'] || {})[0] || {}; return { name: n, iface: s.interface?.[0], net: ip && netOf(ip, m), mask: s.netmask?.[0] || m, start: rg['start-ip']?.[0], end: rg['end-ip']?.[0], gw: s['default-gateway']?.[0], dns: [s['dns-server1']?.[0], s['dns-server2']?.[0]].filter(Boolean), excl: [], res: {}, used: (S.dhcpBind ??= {}), kind: 'fg' }; });
  if (S.dhcpd && (S.svc?.DHCPServer?.status ?? 'Running') === 'Running') return (S.dhcpd.scopes || []).filter((s) => s.active !== false).map((s) => ({ ...s, used: (S.dhcpd.leases ??= {}), res: s.res || {}, excl: s.excl || [], kind: 'win', auth: S.dhcpd.auth }));
  if (S.rogue) return [{ net: S.rogue.net, mask: S.rogue.mask, start: S.rogue.start, end: S.rogue.end, gw: S.rogue.gw, dns: S.rogue.dns, used: (S.rogue.used ??= {}), res: {}, excl: [], kind: 'rogue' }];
  return [];
}
/** One server's offer: by the interface it hears on, or the relay's address (giaddr) */
function dhcpServe(L, S, sEp, relay, mac) {
  const sc = dhcpScopes(L, S); if (!sc.length) return null;
  const at = relay ? relay.ip : sEp?.ip; if (!at) return null;
  const s = sc.find((x) => x.net && inNet(at, x.net, x.mask) && (x.kind !== 'fg' || relay || x.iface === sEp.ifn)); if (!s) return null;
  if (s.kind === 'win' && s.auth === false) { logOnce(L, S.id, 'Event 1046: The DHCP service is not authorized in Active Directory – it will not lease addresses.'); return null; }
  const taken = new Set(Object.values(s.used)); const excl = (ip) => s.excl.some(([a, b]) => ip2n(ip) >= ip2n(a) && ip2n(ip) <= ip2n(b));
  const mine = (x) => x && inNet(x, s.net, s.mask) ? x : null; let ip = mine(s.res[mac]) || mine(s.used[mac]) || null;
  if (!ip) { const a = ip2n(s.start), b = ip2n(s.end); const busy = s.cap != null ? s.cap : 0; let free = 0; for (let n = a; n <= b; n++) { const x = n2ip(n); if (taken.has(x) || excl(x) || x === s.gw) continue; free++; if (free > busy) { ip = x; break; } } }
  if (!ip) { logOnce(L, S.id, s.kind === 'win' ? `Event 1020: Scope ${s.net} is 100 percent full with only 0 IP addresses remaining.` : `%DHCPD-4-PING_CONFLICT / no free addresses in pool ${s.name}`); return { err: 'full' }; }
  return { ip, mask: s.mask, gw: s.gw, dns: s.dns, dom: s.dom, time: 86400, commit: () => (s.used[mac] = ip) };
}

// ---------------------------------------------------------------- DNS: hosts file, then each DNS server in turn (1 s each), zones, forwarders, the internet
function resolve(L, d, name, o = {}) {
  name = String(name).toLowerCase().replace(/\.$/, '');
  if (isIp(name)) return { ip: name, ms: 0 };
  const t0 = L.clock;
  if (d.hosts?.[name]) return { ip: d.hosts[name], src: 'hosts', ms: 0 };
  const nic = Object.values(d.nics || {}).find((c) => c.ip || c.apipa) || {};
  const servers = o.server ? [o.server] : (nic.dns || []).length ? nic.dns : d.resolv || [];
  const suffix = nic.dom || d.domain || d.dnsSuffix;
  const names = name.includes('.') ? [name] : [suffix ? `${name}.${suffix}` : name, name];
  if (!servers.length) return { err: 'nodns', ms: 0 };
  const tried = [];
  for (const sv of servers) {
    const r = send(L, d.id, { dst: sv, proto: 'udp', dport: 53 });
    capAdd(L, d.id, { src: r.pkt?.src ?? '?', dst: sv, proto: 'udp', dport: 53, info: `Standard query 0x${(L.clock & 0xffff).toString(16)} A ${names[0]}`, dns: true });
    if (r.res !== 'ok') { tick(L, o.timeout ?? 1000); tried.push({ sv, why: r.res === 'refused' ? 'refused' : r.why || r.res }); capAdd(L, d.id, { src: '', dst: sv, proto: 'udp', dport: 53, info: `Standard query 0x${(L.clock & 0xffff).toString(16)} A ${names[0]} (retransmission – no response)`, dns: true, lost: true }); continue; }
    tick(L, 2);
    for (const n of names) { const a = dnsAnswer(L, L.devs[r.at], n, 0); if (a.ip) { capAdd(L, d.id, { src: sv, dst: r.pkt.src, proto: 'udp', sport: 53, info: `Standard query response A ${n} A ${a.ip}`, dns: true }); return { ip: a.ip, server: sv, fqdn: n, ms: L.clock - t0, tried, auth: a.auth, cname: a.cname }; } if (a.err === 'servfail') { capAdd(L, d.id, { src: sv, dst: r.pkt.src, proto: 'udp', sport: 53, info: `Standard query response, Server failure A ${n}`, dns: true }); return { err: 'servfail', server: sv, ms: L.clock - t0, tried }; } }
    capAdd(L, d.id, { src: sv, dst: r.pkt.src, proto: 'udp', sport: 53, info: `Standard query response, No such name A ${names[0]}`, dns: true });
    return { err: 'nx', server: sv, ms: L.clock - t0, tried };
  }
  return { err: 'timeout', ms: L.clock - t0, tried };
}
/** What a DNS server answers: its zones, its forwarders or the internet; depth guards loops */
function dnsAnswer(L, S, name, depth) {
  if (!S || depth > 3) return { err: 'servfail' };
  if (S.kind === 'isp') { const ip = L.inet.names[name]; return ip ? { ip } : { err: 'nx' }; }
  if (S.dns && (S.svc?.DNS?.status ?? 'Running') === 'Running') {
    const z = dnsZones(L, S).filter((x) => name === x.name || name.endsWith('.' + x.name)).sort((a, b) => b.name.length - a.name.length)[0];
    if (z) { const host = name === z.name ? '@' : name.slice(0, -(z.name.length + 1)); const R = (z.recs || []).filter((r) => !r.seen || r.seen.includes(S.id)); const rec = R.find((r) => r.name.toLowerCase() === host && r.type === 'A'); if (rec) return { ip: rec.data, auth: true }; const cn = R.find((r) => r.name.toLowerCase() === host && r.type === 'CNAME'); if (cn) { const t = dnsAnswer(L, S, cn.data.toLowerCase().replace(/\.$/, ''), depth + 1); return { ...t, cname: cn.data }; } return { err: 'nx', auth: true }; }
    const cf = (S.dns.cond || []).find((c) => name.endsWith(c.zone));
    const fwd = cf ? cf.ips : S.dns.fwd || [];
    for (const f of fwd) { const r = send(L, S.id, { dst: f, proto: 'udp', dport: 53 }); if (r.res === 'ok') return dnsAnswer(L, L.devs[r.at], name, depth + 1); }
    if (!fwd.length && S.dns.roots !== false) { const r = send(L, S.id, { dst: '8.8.8.8', proto: 'udp', dport: 53 }); if (r.res === 'ok') return { ip: L.inet.names[name] } .ip ? { ip: L.inet.names[name] } : { err: 'nx' }; }
    return { err: 'servfail' };
  }
  if (S.kind === 'fw' && S.dnsProxy) { const r = send(L, S.id, { dst: '8.8.8.8', proto: 'udp', dport: 53 }); return r.res === 'ok' ? (L.inet.names[name] ? { ip: L.inet.names[name] } : { err: 'nx' }) : { err: 'servfail' }; }
  if (S.bind) { const z = (S.bind.zones || []).find((x) => name.endsWith(x.name)); if (z) { const h = name === z.name ? '@' : name.slice(0, -(z.name.length + 1)); const rec = (z.recs || []).find((r) => r.name === h); return rec ? { ip: rec.data } : { err: 'nx' }; } }
  return { err: 'servfail' };
}

/** A Windows DNS server's zones: its own, plus the Active Directory-integrated zones every DNS-running DC holds */
function dnsZones(L, S) { const own = S.dns?.zones || []; if (!S.dns?.ad || !L.ad) return own; const vis = typeof adVisible === 'function' ? (z) => adVisible(L, z, S.id) : () => true; return own.concat((L.ad.zones || []).filter(vis)); }

// ---------------------------------------------------------------- Wi-Fi association (signal, security, passphrase) – the floor plan model is in wifi.js
function wifiAssoc(L, ap, C) {
  const c = ap.clients.find((x) => x.dev === C.id); if (!c || !powered(L, ap)) return { ok: false, why: 'AP off' };
  const s = ap.ssids.find((x) => x.name === c.ssid); if (!s || s.off) return { ok: false, why: 'SSID not broadcast' };
  if (typeof wifiSignal === 'function') { const q = wifiSignal(L, ap, C, s); if (q.rssi < -82) return { ok: false, why: `signal too weak (${q.rssi} dBm)` }; }
  if (s.sec !== 'open') { if ((C.wsec || ['wpa2']).indexOf(s.sec === 'wpa3' ? 'wpa3' : 'wpa2') < 0 && !(s.sec === 'wpa2/3' && (C.wsec || ['wpa2']).length)) return { ok: false, why: `security mismatch: the network needs ${s.sec.toUpperCase()}` }; if (s.sec !== 'enterprise' && c.psk !== s.psk) return { ok: false, why: '4-way handshake failed – wrong passphrase' }; if (s.sec === 'enterprise' && !(s.radiusOk ?? true)) return { ok: false, why: 'EAP failed – RADIUS server did not answer' }; }
  return { ok: true };
}

// ---------------------------------------------------------------- tiny hooks the console modules fill in
const SETTLE_HOOKS = [], SETTLE_PRE = [];
let hostPorts = null, wifiSignal = null;
