/* Network builder – Module 5, session 25: add, place, cable, unplug, power and remove real devices (PCs, servers from ISO, Proxmox hosts,
   Cisco switches and routers, FortiGate, access points, printers, the Internet hand-over), then configure them with the course's real
   consoles and installers. A guided build from an empty room and four build jobs, every step checked from the state of the lab. */
(function () {
  const PASS = 'Dimo@Lab2026';
  const NET = '192.168.10.0', MASK = '255.255.255.0';
  const info = (t, x) => (window.infoBtn ? window.infoBtn(t, x) : '');

  // ---------------------------------------------------------------- styles
  const css = document.createElement('style');
  css.textContent = `#topo svg line{pointer-events:none}#topo svg line.lkh{pointer-events:stroke;cursor:pointer}#topo.bmode-cable .dv,#topo.bmode-remove .dv,#topo.bmode-power .dv{cursor:crosshair}#topo.bmode-unplug line.lkh:hover{stroke:#b4232f55}#topo .dv.drag{opacity:.7}
.bld{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}.bld .btn.on{background:#18232b;color:#fff;border-color:#18232b}.bld .mh{flex-basis:100%;font-size:12.5px;color:#5b6b72;background:#f6f8f7;border-radius:6px;padding:5px 8px}
.cat{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}.cat .it{border:1px solid #d5dddb;border-radius:9px;padding:8px 10px;cursor:pointer;background:#fff}.cat .it:hover{border-color:#2563a8;background:#f6f9fd}.cat .it b{display:block}.cat .it .ic{font-size:20px;float:right}.cat h4{grid-column:1/-1;margin:8px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#5b6b72}
.fp{background:#2b3035;border-radius:6px;padding:10px;color:#ddd;display:inline-block}.fp .row{display:flex;gap:4px;margin:3px 0}.fp .pt{width:30px;height:24px;border:2px solid #555;border-radius:3px;background:#111;color:#bbb;font:10px var(--mono);display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative}.fp .pt.used{border-color:#2e8540}.fp .pt.used::after{content:'';position:absolute;top:2px;right:2px;width:5px;height:5px;border-radius:50%;background:#4cc28a}.fp .pt.cur{outline:2px solid #e0812b}.fp .pt:hover{border-color:#6ea8e8}.fp .sfp{width:44px;background:#222}.fp .lbl{font:11px var(--sans);color:#aaa;margin-bottom:4px}
.nicl{display:grid;gap:6px}.nicl button{display:flex;justify-content:space-between;gap:12px;text-align:left}`;
  document.head.appendChild(css);

  // ---------------------------------------------------------------- the device catalogue
  const lin = (d) => ({ admins: ['admin'], userPass: PASS, ...d });
  const CAT = [
    { g: 'End devices', k: 'pcwin', ic: '🖥', n: 'Windows 11 PC', m: 'Dell OptiPlex 7010', pfx: 'PC', hn: 'PC-%', d: 'An office desktop. Gets its address from DHCP as soon as it is cabled.', mk: (id, x, y, hn) => B.pc(id, x, y, 'dhcp', { hn }) },
    { g: 'End devices', k: 'pcubu', ic: '🖥', n: 'Ubuntu desktop PC', m: 'Ubuntu 24.04 desktop', pfx: 'LPC', hn: 'lpc-%', d: 'A Linux workstation (DHCP).', mk: (id, x, y, hn) => B.pc(id, x, y, 'dhcp', { hn, os: 'linux', x: { admins: ['admin'], userPass: PASS } }) },
    { g: 'End devices', k: 'laptop', ic: '💻', n: 'Windows 11 laptop', m: 'Lenovo ThinkPad T14', pfx: 'LT', hn: 'LT-%', d: 'A laptop on a docking-station cable (DHCP).', mk: (id, x, y, hn) => ({ id, kind: 'laptop', x, y, hostname: hn, os: 'win', nics: { Ethernet: { dhcp: true } } }) },
    { g: 'End devices', k: 'printer', ic: '🖨', n: 'Network printer', m: 'HP LaserJet M507', pfx: 'PRN', hn: 'PRN-%', d: 'Gets an address from DHCP; prints over IPP (631) and port 9100.', mk: (id, x, y, hn) => ({ id, kind: 'printer', x, y, hostname: hn, nics: { eth0: { dhcp: true } }, svc: { ipp: { tcp: [631, 9100, 80] } } }) },
    { g: 'End devices', k: 'ap', ic: '📶', n: 'Wi-Fi access point', m: 'Cisco Catalyst 9105 (PoE)', pfx: 'AP', hn: 'AP-%', d: 'Powered by the switch over the cable (PoE).', mk: (id, x, y, hn) => ({ id, kind: 'ap', x, y, hostname: hn, fx: 10, fy: 8, poe: 13, dhcp: true, ch: 6, ch5: 36, pw: 17, pw5: 17 }) },
    { g: 'Servers', k: 'winiso', ic: '🗄', n: 'Windows Server 2022 – new', m: 'Dell PowerEdge R660, boots the ISO', pfx: 'WSRV', hn: 'WIN-NEW', d: 'A new rack server with the Windows Server 2022 ISO in the drive: open its console and install Windows (Windows Setup), then name it, give it a static IP and add roles.', mk: (id, x, y) => ({ id, kind: 'srv', x, y, hostname: 'WIN-NEW', os: 'win', server: true, setup: true, diskGb: 120, nics: { Ethernet: { dhcp: true, up: false } } }) },
    { g: 'Servers', k: 'winoob', ic: '🗄', n: 'Windows Server 2022 – pre-installed', m: 'Dell PowerEdge R660', pfx: 'WSRV', hn: '', d: 'Windows already installed by the supplier (random name, DHCP address). Administrator password ' + PASS + '.', mk: (id, x, y) => ({ id, kind: 'srv', x, y, hostname: `WIN-${Math.random().toString(36).slice(2, 9).toUpperCase()}`, os: 'win', server: true, ver: 'Microsoft Windows Server 2022 Standard', adminPass: PASS, nics: { Ethernet: { dhcp: true } } }) },
    { g: 'Servers', k: 'ubuiso', ic: '🗄', n: 'Ubuntu Server 24.04 – new', m: 'Dell PowerEdge R660, boots the ISO', pfx: 'LSRV', hn: 'ubuntu-iso', d: 'Open its console and run the Ubuntu installer: name, user, network (static IP), OpenSSH.', mk: (id, x, y) => ({ id, kind: 'srv', x, y, hostname: 'ubuntu-iso', os: 'linux', lxsetup: 'ubuntu', diskGb: 64, nics: { ens18: { dhcp: true, up: false } } }) },
    { g: 'Servers', k: 'rockyiso', ic: '🗄', n: 'Rocky Linux 9 – new', m: 'HPE ProLiant DL360, boots the ISO', pfx: 'LSRV', hn: 'rocky-iso', d: 'Open its console and run the Rocky Linux installer.', mk: (id, x, y) => ({ id, kind: 'srv', x, y, hostname: 'rocky-iso', os: 'linux', lxsetup: 'rocky', diskGb: 64, nics: { ens18: { dhcp: true, up: false } } }) },
    { g: 'Servers', k: 'nas', ic: '🗄', n: 'NAS / file server (Ubuntu)', m: '2 TB storage server, pre-installed', pfx: 'NAS', hn: 'nas%', d: 'Ubuntu with a 2 TB data disk on /srv/data, user admin / ' + PASS + '. Gets DHCP until you set a static address.', mk: (id, x, y, hn) => B.lx(id, x, y, 'dhcp', { hn, x: lin({}) }), post: (L, d) => { lxInit(L, d); d.disks.push({ name: 'sdb', size: 2000, parts: [{ name: 'sdb1', size: 2000, mount: '/srv/data', fs: 'ext4' }] }); lxRun(lxSession(L, d, 'root'), 'mkdir -p /srv/data'); } },
    { g: 'Virtualisation', k: 'pve', ic: '▦', n: 'Proxmox VE host', m: 'Dell PowerEdge R760, 16 cores, 128 GB', pfx: 'PVE', hn: 'pve%', d: 'A virtualisation server: install Proxmox from its console, then create VMs in the web UI. Two network ports: eno1, eno2.', mk: (id, x, y, hn) => ({ id, kind: 'hv', x, y, hostname: hn, nics: ['eno1', 'eno2'], pvesetup: true }), post: (L, d) => pveInit(L, d) },
    { g: 'Network', k: 'sw24', ic: '⇄', n: 'Switch – 24 ports', m: 'Cisco Catalyst 9200L-24P (PoE)', pfx: 'SW', hn: 'SW-%', d: '24 copper ports Gi1/0/1–24 with PoE and two fibre uplinks Te1/1/1–2. Cisco IOS console. Out of the box every port is in VLAN 1.', mk: (id, x, y, hn) => B.sw(id, x, y, 24, { hn }) },
    { g: 'Network', k: 'sw8', ic: '⇄', n: 'Switch – 8 ports', m: 'Cisco Catalyst 1000-8P', pfx: 'SW', hn: 'SW-%', d: 'A small switch for a room or a lab bench: Gi1/0/1–8 and two uplinks.', mk: (id, x, y, hn) => B.sw(id, x, y, 8, { hn }) },
    { g: 'Network', k: 'rt', ic: '⊕', n: 'Router', m: 'Cisco ISR 1100', pfx: 'R', hn: 'Router', d: 'Connects the office to the internet and routes between networks. Three ports Gi0/0–Gi0/2, all SHUT DOWN out of the box (like a real Cisco) – configure them with no shutdown.', mk: (id, x, y) => B.rt(id, x, y, { 'Gi0/0': { shut: true }, 'Gi0/1': { shut: true }, 'Gi0/2': { shut: true } }, { hn: 'Router' }) },
    { g: 'Network', k: 'fgt', ic: '🛡', n: 'Firewall', m: 'FortiGate 60F', pfx: 'FGT', hn: 'FortiGate-60F', d: 'Firewall and router. Ports wan1, wan2, dmz, internal1–3. Factory default: internal1 = 192.168.1.99 (web GUI and console).', mk: (id, x, y) => ({ id, kind: 'fw', x, y, hostname: 'FortiGate-60F', ifs: { wan1: {}, wan2: {}, dmz: {}, internal1: { cidr: '192.168.1.99/24', access: 'ping https ssh http', role: 'lan' }, internal2: {}, internal3: {} } }) },
    { g: 'Network', k: 'isp', ic: '☁', n: 'Internet hand-over', m: 'ISP fibre terminal (ONT)', pfx: 'ISP', one: true, d: 'The internet provider\'s box. Your public address 203.115.21.6/30, gateway 203.115.21.5, DNS 8.8.8.8.', mk: (id, x, y) => B.isp(x, y, { a: { cidr: '203.115.21.5/30' } }) },
  ];
  const catOf = (k) => CAT.find((c) => c.k === k);
  const nextId = (L, p) => { let i = 1; while (L.devs[p + i]) i++; return p + i; };
  const ROW = { isp: 40, rt: 130, fw: 130, sw: 230, hub: 230, srv: 350, hv: 350, pc: 470, laptop: 470, printer: 470, ap: 470, phone: 470 };
  const COLS = { 130: [480, 620, 340, 760, 200], 230: [480, 620, 340, 760, 200], 350: [640, 780, 920, 340, 200, 60], 470: [340, 200, 60, 480, 620, 760, 900] }; // servers right, desks left, so cables do not pass behind other boxes
  function freeSpot(L, kind) { const y0 = ROW[kind] ?? 470; for (let ry = 0; ry < 4; ry++) for (const x of COLS[y0] || COLS[130]) { const y = y0 + ry * 55; if (!Object.values(L.devs).some((d) => d.x != null && Math.abs(d.x - x) < 95 && Math.abs(d.y - y) < 45)) return [x, y]; } return [480, y0]; }
  function addDevice(L, k) {
    const c = catOf(k); if (c.one && L.devs.ISP) return { err: 'There is already an internet hand-over in this room.' };
    const id = c.k === 'isp' ? 'ISP' : nextId(L, c.pfx), n = id.replace(/^\D+/, ''), hn = (c.hn || '').replace('%', n.padStart(2, '0'));
    const spec0 = c.mk('_', 0, 0, ''); const [x, y] = c.k === 'isp' ? [480, 40] : freeSpot(L, spec0.kind);
    const d = devAdd(L, c.mk(id, x, y, hn)); d.model = c.m; d.cat = c.k; if (c.post) c.post(L, d); fresh(L, d.id); settle(L, 'nodhcp'); return { d };
  }

  /** Plugging a cable in makes a DHCP client ask again (a real NIC does on link-up); a device with no cable has not asked yet */
  function fresh(L, id) { const d = L.devs[id]; if (!d) return; const one = (x) => Object.values(x.nics && !Array.isArray(x.nics) ? x.nics : {}).forEach((c) => { if (c.dhcp && !c.ip) Object.assign(c, { tried: false, apipa: null, dup: false, dhcpErr: null }); }); one(d); (d.vms || []).forEach((v) => L.devs[v] && one(L.devs[v])); }
  function plug(L, a, b) { cable(L, a, b); fresh(L, splitPk(a).dev); fresh(L, splitPk(b).dev); }
  // ---------------------------------------------------------------- ports, cables, removal
  function portsOf(d) {
    if (d.kind === 'sw' || d.kind === 'hub') return Object.keys(d.ports);
    if (d.kind === 'rt') return Object.keys(d.ifs).filter((n) => !n.includes('.'));
    if (d.kind === 'fw') return Object.entries(d.cfg['system interface'] || {}).filter(([, e]) => (e.type || ['physical'])[0] === 'physical').map(([n]) => n);
    if (d.kind === 'hv') return d.nics.slice();
    if (d.kind === 'isp') return Object.keys(d.ifs);
    if (d.kind === 'ap') return ['eth0'];
    if (d.kind === 'phone') return ['sw', 'pc'];
    if (d.kind === 'vm') return [];
    return Object.keys(d.nics || {});
  }
  const peerTxt = (L, d, p) => { const pr = peerOf(L, d.id, p); return pr ? `${L.devs[pr.dev]?.hostname || pr.dev} ${pr.port}` : ''; };
  function removeDevice(L, id) {
    const d = L.devs[id]; if (!d) return;
    (d.vms || []).forEach((v) => { delete L.devs[v]; L.links = L.links.filter(([a, b]) => !a.startsWith(v + ':') && !b.startsWith(v + ':')); });
    delete L.devs[id]; L.links = L.links.filter(([a, b]) => !a.startsWith(id + ':') && !b.startsWith(id + ':'));
    APP.open = APP.open.filter((k) => !k.startsWith(id + '|') && !(d.vms || []).some((v) => k.startsWith(v + '|'))); if (APP.active && (APP.active.dev === id || (d.vms || []).includes(APP.active.dev))) APP.active = null;
    L.flags.removed = [...(L.flags.removed || []), { id, kind: d.kind, host: d.hostname }];
  }
  const changed = () => { try { settle(APP.L); } catch (e) { console.warn(e); } afterAction(); if (typeof renderDevicePanel === 'function') renderDevicePanel(); };

  // ---------------------------------------------------------------- builder state, toolbar and dialogs
  const BS = { mode: 'move', from: null };
  const curS = () => SESSIONS.find((x) => x.id === APP.sid);
  const on = () => { const S = curS(); return !!(S && S.builder && APP.L && (APP.mode === 'lab' || APP.mode === 'fix')); };
  const HINT = { move: 'Drag devices to arrange the room. Click a device to open its console or screens.', cable: 'Cable mode: click the first device and choose its port, then the second device and its port.', unplug: 'Unplug mode: click a cable to pull it out.', remove: 'Remove mode: click a device to take it out of the room (its cables are unplugged).', power: 'Power mode: click a device to switch it off or on.' };
  function bar() {
    return `<div class="bld" id="bldbar"><button class="btn sm p" data-b="add">＋ Add device</button>${[['move', '✥ Move / open'], ['cable', '🔌 Cable'], ['unplug', '✂ Unplug'], ['remove', '🗑 Remove'], ['power', '⏻ Power']].map(([k, t]) => `<button class="btn sm ${BS.mode === k ? 'on' : ''}" data-m="${k}">${t}</button>`).join('')}<button class="btn sm" data-b="sched">📋 Cable schedule</button><button class="btn sm gdb" data-b="guide">🧭 Guide me</button>${info('The builder', 'Add devices from the catalogue, drag them where they sit, connect them with cables port to port, then open each device to install and configure it – exactly the order you would follow in a real server room.')}<div class="mh" id="bldhint">${esc(BS.from ? `Cable from ${APP.L.devs[BS.from.dev]?.hostname} ${BS.from.port} – now click the device at the other end.` : HINT[BS.mode])}</div></div>`;
  }
  function bindBar() {
    const b = document.getElementById('bldbar'); if (!b) return;
    b.querySelectorAll('[data-m]').forEach((x) => (x.onclick = () => { BS.mode = x.dataset.m; BS.from = null; refresh(); }));
    b.querySelector('[data-b=add]').onclick = catalogue; b.querySelector('[data-b=sched]').onclick = schedule; b.querySelector('[data-b=guide]').onclick = () => window.GUIDE && window.GUIDE.toggle();
  }
  function refresh() { const b = document.getElementById('bldbar'); if (b) { b.outerHTML = bar(); bindBar(); } drawTopo(); }
  function catalogue() {
    const groups = [...new Set(CAT.map((c) => c.g))];
    const m = modal('Add a device to the room', `<p class="m" style="margin-top:0">Choose what to unpack. It appears on the drawing – then cable it and open it to set it up.</p><div class="cat">${groups.map((g) => `<h4>${esc(g)}</h4>${CAT.filter((c) => c.g === g).map((c) => `<div class="it" data-k="${c.k}"><span class="ic">${c.ic}</span><b>${esc(c.n)}</b><span class="m" style="font-size:12px">${esc(c.m)}</span><div style="font-size:12.5px;margin-top:4px">${esc(c.d)}</div></div>`).join('')}`).join('')}</div>`, [{ t: 'Close' }], { w: 900 });
    m.querySelectorAll('.it').forEach((it) => (it.onclick = () => { const r = addDevice(APP.L, it.dataset.k); if (r.err) { toast(r.err); return; } m.remove(); toast(`${r.d.hostname} added – now cable it (🔌 Cable) and open it to set it up.`); BS.mode = 'cable'; BS.from = null; changed(); refresh(); }));
  }
  function schedule() {
    const L = APP.L; L.flags.sched = true;
    const rows = L.links.map(([a, b], i) => { const A = splitPk(a), Bp = splitPk(b), da = L.devs[A.dev], db = L.devs[Bp.dev]; return `<tr><td>C-${String(i + 1).padStart(3, '0')}</td><td>${esc(da?.hostname || A.dev)}</td><td>${esc(A.port)}</td><td>${esc(db?.hostname || Bp.dev)}</td><td>${esc(Bp.port)}</td><td>${linkUp(L, A.dev, A.port) ? '<span class="pill g">up</span>' : '<span class="pill r">down</span>'}</td><td>${da?.kind === 'isp' || db?.kind === 'isp' ? 'Fibre/Ethernet to ISP' : da?.kind === 'sw' && db?.kind === 'sw' ? 'Uplink (Cat6 / fibre)' : 'Cat6 patch lead'}</td></tr>`; }).join('');
    modal('Cable schedule', `<p class="m" style="margin-top:0">Every real installation keeps this list, and each cable carries the same label at both ends. ${info('Cable schedule', 'A table of every cable: its label, which device and port at each end, and what kind of cable. It lets anyone find and trace a cable years later without unplugging things to see what stops working.')}</p>${L.links.length ? `<table class="t" style="width:100%;border-collapse:collapse"><tr><th>Label</th><th>From</th><th>Port</th><th>To</th><th>Port</th><th>Link</th><th>Cable</th></tr>${rows}</table>` : '<p>No cables yet.</p>'}`, [{ t: 'Close' }], { w: 860 });
    afterAction();
  }
  function portPicker(d, title, done) {
    const L = APP.L, ps = portsOf(d); if (!ps.length) { toast(`${d.hostname} has no network port of its own${d.kind === 'vm' ? ' – a VM connects through its host\'s bridge (set it in Proxmox)' : ''}.`); return; }
    let body;
    if (d.kind === 'sw') {
      const cu = ps.filter((p) => /^Gi1\/0\/\d+$/.test(p)).sort((a, b) => +a.split('/')[2] - +b.split('/')[2]), up = ps.filter((p) => !cu.includes(p));
      const cell = (p, cls = '') => { const t = peerTxt(L, d, p); return `<div class="pt ${cls} ${t ? 'used' : ''}" data-p="${esc(p)}" title="${esc(p)}${t ? ' → ' + t : ' (free)'}">${esc(p.split('/').pop())}</div>`; };
      body = `<div class="fp"><div class="lbl">${esc(d.model || 'Cisco Catalyst')} – front panel · ${esc(d.hostname)}</div><div class="row">${cu.filter((p) => +p.split('/')[2] % 2).map((p) => cell(p)).join('')}<span style="width:12px"></span>${up.slice(0, Math.ceil(up.length / 2)).map((p) => cell(p, 'sfp')).join('')}</div><div class="row">${cu.filter((p) => !(+p.split('/')[2] % 2)).map((p) => cell(p)).join('')}<span style="width:12px"></span>${up.slice(Math.ceil(up.length / 2)).map((p) => cell(p, 'sfp')).join('')}</div></div><p class="m" style="font-size:12px">Green dot = a cable is already plugged in (hover to see where it goes). Odd ports on top, even below – like the real switch. Te = fibre uplinks.</p>`;
    } else body = `<div class="nicl">${ps.map((p) => { const t = peerTxt(L, d, p); return `<button class="btn" data-p="${esc(p)}"><span><b>${esc(p)}</b></span><span class="m">${t ? '→ ' + esc(t) : 'free'}</span></button>`; }).join('')}</div>`;
    const m = modal(title, body, [{ t: 'Cancel', fn: () => { BS.from = null; refresh(); } }], { w: 720 });
    m.querySelectorAll('[data-p]').forEach((x) => (x.onclick = () => { m.remove(); done(x.dataset.p); }));
  }
  function cableClick(id) {
    const L = APP.L, d = L.devs[id];
    if (!BS.from) { portPicker(d, `Cable: choose the port on ${d.hostname}`, (p) => { BS.from = { dev: id, port: p }; refresh(); }); return; }
    if (BS.from.dev === id) { toast('Choose a different device for the other end of the cable.'); return; }
    portPicker(d, `Cable from ${L.devs[BS.from.dev].hostname} ${BS.from.port} → choose the port on ${d.hostname}`, (p) => {
      const a = `${BS.from.dev}:${BS.from.port}`, b = `${id}:${p}`, busy = [a, b].filter((k) => L.links.some(([x, y]) => x === k || y === k));
      const go = () => { plug(L, a, b); L.flags.cabled = (L.flags.cabled || 0) + 1; BS.from = null; changed(); refresh(); };
      if (busy.length) confirmBox(`${busy.map((k) => k.replace(':', ' ')).join(' and ')} already ${busy.length > 1 ? 'have' : 'has'} a cable. Unplug it and plug in the new one?`, go); else go();
    });
  }
  function removeClick(id) {
    const L = APP.L, d = L.devs[id];
    if (d.kind === 'vm') { toast('A VM lives on its Proxmox host – stop and remove it in the Proxmox web UI (More › Remove).'); return; }
    const n = L.links.filter(([a, b]) => a.startsWith(id + ':') || b.startsWith(id + ':')).length, vms = (d.vms || []).length;
    confirmBox(`Take ${d.hostname} out of the room? ${n} cable${n === 1 ? '' : 's'} will be unplugged${vms ? ` and its ${vms} VM${vms > 1 ? 's' : ''} go with it` : ''}.`, () => { removeDevice(L, id); changed(); refresh(); toast(`${d.hostname} removed.`); });
  }
  function powerClick(id) {
    const d = APP.L.devs[id]; if (d.kind === 'isp' || d.kind === 'vm') { toast(d.kind === 'vm' ? 'Start and stop VMs in Proxmox.' : 'The internet hand-over is always on.'); return; }
    d.off = !d.off; if (d.off) Object.values(d.nics && !Array.isArray(d.nics) ? d.nics : {}).forEach((c) => { if (c.dhcp) { c.ip = null; c.tried = false; } });
    toast(`${d.hostname} switched ${d.off ? 'off' : 'on'}.`); changed(); refresh();
  }

  // ---------------------------------------------------------------- the drawing: drag, click by mode, cables you can unplug
  const origDraw = window.drawTopo;
  window.drawTopo = function () {
    origDraw(); if (!on()) return;
    const el = document.getElementById('topo'); if (!el) return; const L = APP.L;
    if (!document.getElementById('bldbar')) { el.insertAdjacentHTML('beforebegin', bar()); bindBar(); }
    el.className = `topo bmode-${BS.mode}`; const ws = el.closest('.ws'); if (ws) ws.style.gridTemplateColumns = '1fr';
    const svg = el.querySelector('svg'); const vb = svg.viewBox.baseVal; svg.setAttribute('viewBox', `0 0 ${Math.max(vb.width, 980)} ${Math.max(vb.height, 520)}`);
    const hits = L.links.map(([a, b], i) => { const A = L.devs[splitPk(a).dev], Bd = L.devs[splitPk(b).dev]; if (!A || !Bd || A.x == null || Bd.x == null) return ''; return `<line class="lkh" data-i="${i}" x1="${A.x}" y1="${A.y}" x2="${Bd.x}" y2="${Bd.y}" stroke="transparent" stroke-width="14"><title>${esc(a.replace(':', ' '))} ↔ ${esc(b.replace(':', ' '))}</title></line>`; }).join('');
    svg.insertAdjacentHTML('afterbegin', hits);
    svg.querySelectorAll('.lkh').forEach((ln) => (ln.onclick = () => { const k = L.links[+ln.dataset.i]; if (!k) return; if (BS.mode !== 'unplug') { toast('To pull out this cable, choose ✂ Unplug first.'); return; } uncable(L, k[0]); L.flags.unplugged = (L.flags.unplugged || 0) + 1; changed(); refresh(); }));
    if (BS.from) { const d = L.devs[BS.from.dev]; if (d) svg.insertAdjacentHTML('beforeend', `<circle cx="${d.x}" cy="${d.y}" r="30" fill="none" stroke="#e0812b" stroke-width="3" stroke-dasharray="6 4"/>`); }
    const toSvg = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
    svg.querySelectorAll('.dv').forEach((g) => {
      const id = g.dataset.d; g.onclick = null;
      g.onpointerdown = (e) => {
        const d = L.devs[id]; if (!d) return; const p0 = toSvg(e), x0 = d.x, y0 = d.y; let moved = false; g.setPointerCapture(e.pointerId);
        g.onpointermove = (ev) => { const p = toSvg(ev); const dx = p.x - p0.x, dy = p.y - p0.y; if (!moved && Math.hypot(dx, dy) < 5) return; moved = true; g.classList.add('drag'); d.x = Math.max(40, Math.round(x0 + dx)); d.y = Math.max(20, Math.round(y0 + dy)); g.setAttribute('transform', `translate(${d.x - x0} ${d.y - y0})`); };
        g.onpointerup = () => { g.onpointermove = null; g.onpointerup = null; if (moved) { labSave(); drawTopo(); return; } if (BS.mode === 'cable') cableClick(id); else if (BS.mode === 'remove') removeClick(id); else if (BS.mode === 'power') powerClick(id); else if (BS.mode === 'unplug') toast('Click on a cable (the line), not on the device.'); else openDevice(id); };
      };
    });
  };

  // ---------------------------------------------------------------- checks used by the lab and the build jobs
  const D = (L) => Object.values(L.devs);
  const nic0 = (d) => (d.nics && !Array.isArray(d.nics) ? Object.values(d.nics)[0] : null);
  const ipOf = (d) => (d.kind === 'hv' ? d.mgmt?.ip : nic0(d)?.ip) || null;
  const inLan = (ip) => !!ip && inNet(ip, NET, MASK);
  const pcs = (L) => D(L).filter((d) => ['pc', 'laptop'].includes(d.kind) && !d.off);
  const winSrv = (L) => D(L).find((d) => d.kind === 'srv' && d.os === 'win' && !d.setup && !d.off && /^SRV01$/i.test(d.hostname) && nic0(d) && !nic0(d).dhcp && /^192\.168\.10\.1\d$/.test(nic0(d).ip || ''));
  const lxWebSrv = (L) => D(L).find((d) => d.kind === 'srv' && d.os === 'linux' && !d.lxsetup && !d.off && nic0(d) && !nic0(d).dhcp && inLan(nic0(d).ip) && d.units?.nginx?.active === 'active');
  const router = (L) => D(L).filter((d) => (d.kind === 'rt' || d.kind === 'fw') && !d.off);
  const linkedTo = (L, d, pred) => portsOf(d).some((p) => { const pr = peerOf(L, d.id, p); return pr && pred(L.devs[pr.dev], pr.port); });
  const pingOk = (L, from, ip) => { try { return send(L, from, { dst: ip }).res === 'ok'; } catch (e) { return false; } };
  const reachOk = (L, from, host, port) => { try { return C.reach(L, from, host, port); } catch (e) { return false; } };

  // ---------------------------------------------------------------- a ready office for the build jobs
  function officeLab(o = {}) {
    const spec = {
      devs: [
        B.isp(480, 40, { a: { cidr: '203.115.21.5/30' } }),
        B.rt('R1', 480, 120, { 'Gi0/0': { cidr: '203.115.21.6/30', nat: 'outside', desc: 'ISP' }, 'Gi0/1': { cidr: '192.168.10.1/24', nat: 'inside', desc: 'LAN' }, 'Gi0/2': { shut: true } }, { hn: 'R-OFFICE', x: { routes: [{ net: '0.0.0.0', mask: '0.0.0.0', via: '203.115.21.5' }], acls: { 1: [{ std: true, act: 'permit', src: { net: '192.168.10.0', wild: '0.0.0.255' } }] }, nat: { rules: [{ acl: 1, ifn: 'Gi0/0' }], statics: [] }, dhcp: { pools: { LAN: { net: '192.168.10.0', mask: '255.255.255.0', gw: '192.168.10.1', dns: ['192.168.10.10', '8.8.8.8'] } }, excl: [['192.168.10.1', '192.168.10.99']], bind: {} } } }),
        B.sw('SW1', 480, 220, 24, { hn: 'SW-OFFICE' }),
        { id: 'FS', kind: 'srv', x: 300, y: 320, hostname: 'FS01', os: 'win', server: true, ver: 'Microsoft Windows Server 2022 Standard', adminPass: PASS, nics: { Ethernet: { cidr: '192.168.10.10/24', gw: '192.168.10.1', dns: ['127.0.0.1'] } } },
        B.lx('WEB', 660, 320, '192.168.10.11/24', { gw: '192.168.10.1', dns: ['192.168.10.10'], hn: 'web01', x: lin({}) }),
        B.pc('PC1', 400, 430, 'dhcp', { hn: 'PC-01' }), B.pc('PC2', 560, 430, 'dhcp', { hn: 'PC-02' }),
        ...(o.pve ? [{ id: 'PVE1', kind: 'hv', x: 800, y: 220, hostname: 'pve1', nics: ['eno1', 'eno2'] }] : []),
      ],
      links: [['ISP:a', 'R1:Gi0/0'], ['R1:Gi0/1', 'SW1:Te1/1/1'], ['FS:Ethernet', 'SW1:Gi1/0/1'], ['WEB:ens18', 'SW1:Gi1/0/2'], ['PC1:Ethernet', 'SW1:Gi1/0/10'], ['PC2:Ethernet', 'SW1:Gi1/0/11']],
      post: (L) => {
        Object.values(L.devs).forEach((d) => { d.model = { R1: 'Cisco ISR 1100', SW1: 'Cisco Catalyst 9200L-24P', FS: 'Dell PowerEdge R660', WEB: 'Dell PowerEdge R660' }[d.id]; });
        winDns(L, 'FS', 'office.local', [['fs01', '192.168.10.10'], ['intranet', '192.168.10.11'], ['web01', '192.168.10.11']]);
        lxWeb(L, 'WEB', '<h1>Office intranet</h1><p>Welcome to the office intranet.</p>');
        if (o.pve) { const H = L.devs.PVE1; pveInit(L, H); pveInstall(L, H, { host: 'pve1.office.local', ip: '192.168.10.20/24', gw: '192.168.10.1', dns: '192.168.10.10', pass: PASS, email: 'it@office.local', nic: 'eno1' }); H.model = 'Dell PowerEdge R760'; const V = pveCreate(L, H, { vmid: 101, name: 'app01', iso: UBU_ISO, store: 'local-lvm', size: 32, cores: 2, mem: 2048, x: 800, y: 320 }).d; vmStart(L, V); lxInstall(L, V, { distro: 'ubuntu', host: 'app01', user: 'admin', pass: PASS, ssh: true }); vmSet(L, V, { cdrom: 'none' }); }
        if (o.post) o.post(L); settle(L);
      },
    };
    return spec;
  }
  const emptyRoom = () => ({ devs: [B.isp(480, 40, { a: { cidr: '203.115.21.5/30' } })], links: [], post: (L) => { L.devs.ISP.model = 'ISP fibre terminal'; } });

  const IOS_NET = '<code>enable</code> · <code>conf t</code> · <code>hostname R-OFFICE</code> · <code>int g0/0</code> · <code>ip address 203.115.21.6 255.255.255.252</code> · <code>ip nat outside</code> · <code>no shutdown</code> · <code>int g0/1</code> · <code>ip address 192.168.10.1 255.255.255.0</code> · <code>ip nat inside</code> · <code>no shutdown</code> · <code>exit</code> · <code>ip route 0.0.0.0 0.0.0.0 203.115.21.5</code> · <code>access-list 1 permit 192.168.10.0 0.0.0.255</code> · <code>ip nat inside source list 1 interface g0/0 overload</code> · <code>end</code> · <code>write memory</code>';
  const IOS_DHCP = '<code>conf t</code> · <code>ip dhcp excluded-address 192.168.10.1 192.168.10.99</code> · <code>ip dhcp pool LAN</code> · <code>network 192.168.10.0 255.255.255.0</code> · <code>default-router 192.168.10.1</code> · <code>dns-server 8.8.8.8</code> · <code>end</code> – then on each PC <code>ipconfig /renew</code> (Windows asks DHCP once when the cable goes in).';

  // ---------------------------------------------------------------- session 25
  MODS.push({ n: 5, t: 'Module 5 · Build it yourself', w: 'Any time' });
  SESSIONS.push({
    id: 's25', n: 25, mod: 5, builder: true, title: 'Network builder: design and build', focus: 'Plan, unpack, place, cable, power, configure, test and document a complete office – servers, PCs, switches, a router or firewall, a Proxmox host with VMs – and add, replace or remove devices later', milestone: 'An office network you built yourself, from an empty room',
    concept: [
      { h: 'From an empty room to a working office', html: `<p>Real IT work is not only fixing things – it is building them. A new office or server room always goes through the same steps. Do them in this order and almost nothing goes wrong:</p><ol><li><b>Plan</b> – a drawing and an address plan (which device gets which IP address) before anything is unpacked.</li><li><b>Rack and power</b> – unpack each device, put it in its place, connect power.</li><li><b>Cable</b> – connect each device to the right port. Write every cable in the <b>cable schedule</b> and label both ends.</li><li><b>Network first</b> – the router or firewall (internet, gateway, DHCP), then the switch.</li><li><b>Servers</b> – install the operating system, a fixed (static) IP address, a proper name, then the roles (DNS, files, web…).</li><li><b>PCs and printers</b> – they get their addresses automatically from DHCP.</li><li><b>Virtualisation</b> – a Proxmox host, then VMs connected to the same network as the physical servers.</li><li><b>Test</b> – from a user's PC: ping, names, the web page, the internet.</li><li><b>Document</b> – drawing, address plan, cable schedule, passwords in the password safe.</li></ol>` },
      { h: 'The devices and what each one does', html: `<table class="t"><tr><th>Device</th><th>Job</th><th>Real examples</th></tr><tr><td>Internet hand-over</td><td>The provider's box; gives you a public address</td><td>SLT / Dialog fibre ONT</td></tr><tr><td>Router or firewall</td><td>The way out to the internet (default gateway), NAT, DHCP, security rules</td><td>Cisco ISR 1100, FortiGate 60F</td></tr><tr><td>Switch</td><td>Joins every cable in the room; VLANs</td><td>Cisco Catalyst 9200L</td></tr><tr><td>Server</td><td>Runs services for everyone: logins, DNS, files, web, applications</td><td>Dell PowerEdge, HPE ProLiant</td></tr><tr><td>Proxmox host</td><td>One big server that runs many virtual servers (VMs)</td><td>Dell PowerEdge R760</td></tr><tr><td>NAS</td><td>A server with lots of disk space for files and backups</td><td>Synology, a Linux file server</td></tr><tr><td>PC, laptop, printer, Wi-Fi access point</td><td>What the users touch</td><td>Dell OptiPlex, HP LaserJet, Cisco 9105</td></tr></table>` },
      { h: 'Cabling like a professional', html: `<ul><li><b>Router WAN port → internet hand-over.</b> <b>Router LAN port → switch</b> (an uplink port).</li><li><b>Servers, PCs, printers, access points → switch ports.</b> Keep servers together (e.g. ports 1–8) and users together (10–24) – it makes the switch easier to manage.</li><li><b>Proxmox host:</b> its first port (eno1) carries management and the VMs – it goes to the switch like any server.</li><li>A <b>green link</b> on the drawing means both ends are on and connected. A grey dashed line means one end is off, or a router port is still shut down.</li><li>Every cable gets a label with the same number at both ends, and a line in the <b>cable schedule</b>.</li></ul><p class="m">In the lab: <b>＋ Add device</b>, then <b>🔌 Cable</b> – click a device, choose its port (a switch shows its real front panel), click the other device, choose its port.</p>` },
      { h: 'An address plan for a small office', html: `<table class="t"><tr><th>Addresses</th><th>Use</th></tr><tr><td>192.168.10.1</td><td>Router / firewall – the default gateway</td></tr><tr><td>192.168.10.10 – .19</td><td>Servers (fixed / static) – e.g. SRV01 = .10</td></tr><tr><td>192.168.10.20 – .29</td><td>Proxmox hosts and network devices</td></tr><tr><td>192.168.10.30 – .49</td><td>Printers (static or DHCP reservation)</td></tr><tr><td>192.168.10.100 – .200</td><td>DHCP for PCs and laptops</td></tr></table><p>Servers get <b>static</b> addresses because everybody must always find them at the same place. PCs use <b>DHCP</b>, so a new PC works as soon as it is plugged in. Exclude the static range from DHCP so the router never hands a server's address to a PC.</p>`, check: [
        { q: 'Why does a server get a static address while PCs use DHCP?', a: ['Servers are faster', 'Everybody must always find the server at the same address; PCs just need any free address', 'DHCP does not work for servers', 'Static is more secure'], c: 1, why: 'If a server\'s address changed, every PC would lose it.' },
      ] },
      { h: 'Connecting VMs to the physical servers', html: `<p>A VM's network card plugs into the host's <b>bridge</b> (vmbr0). The bridge uses the host's real port (eno1), which is cabled to the switch. So a VM in the same subnet as the physical servers talks to them exactly like a physical PC would – same switch, same gateway, same DNS.</p><p>Checklist when a VM cannot reach a server: is the <b>host cabled</b> (eno1 link up)? Is the VM's NIC on <b>vmbr0</b>, with the <b>right VLAN tag</b> (or none if you use no VLANs)? Does the VM have an <b>address</b> in the right subnet? Then ping the gateway, then the server.</p>` },
      { h: 'Adding, replacing and removing devices', html: `<ul><li><b>Adding</b>: plan an address, cable it to a free port, configure it, test it, add it to the documentation.</li><li><b>Replacing a dead server</b>: unplug and remove the old one, cable the new one to the <b>same port</b>, install it, give it the <b>same name and IP address</b> – everything that used the old server keeps working.</li><li><b>Removing</b>: check nothing depends on it, shut it down cleanly, unplug, update the cable schedule and the drawing, free its IP address.</li></ul>` },
    ],
    lab: {
      title: 'Lab: build a complete office from an empty room',
      intro: `<p>A new office for 10 staff. The room is empty except the internet provider's box. Your <b>handover sheet</b>: public address <b>203.115.21.6/30</b>, gateway <b>203.115.21.5</b>, DNS <b>8.8.8.8</b>. Address plan: LAN <b>192.168.10.0/24</b>, gateway <b>192.168.10.1</b>, servers .10–.19, Proxmox .20, DHCP for PCs .100–.200. Passwords: <b>${PASS}</b> everywhere.</p><p>Use <b>＋ Add device</b> to unpack equipment, <b>🔌 Cable</b> to connect it, then click each device to install and configure it. You choose the devices – a Cisco router or a FortiGate both work.</p><p class="gdcall">🧭 <b>New to this?</b> Press <b>Guide me</b> in the toolbar under the drawing. A pop-up takes you through every step: what to click, what to type and why. It ticks each step when you have done it, you can go back and forth, hide it and open it again at any time.</p>`,
      build: emptyRoom, open: [],
      tasks: [
        { id: 'core', t: 'Network core: a router (or firewall) and a switch are in the room; the router\'s WAN port is cabled to the internet hand-over and a LAN port to the switch.', check: (L) => router(L).some((r) => linkedTo(L, r, (x) => x?.kind === 'isp') && linkedTo(L, r, (x) => x?.kind === 'sw')), hint: '＋ Add device › Router (Cisco ISR 1100) and Switch – 24 ports. 🔌 Cable: router Gi0/0 → Internet; router Gi0/1 → switch Te1/1/1.' },
        { id: 'wan', t: 'The router reaches the internet: WAN 203.115.21.6/30, LAN 192.168.10.1/24, a default route to 203.115.21.5 and NAT for the LAN (the router can ping 8.8.8.8).', check: (L) => router(L).some((r) => pingOk(L, r.id, '8.8.8.8') && l3ifs(L, r).some((e) => e.ip === '192.168.10.1' && e.up)), hint: `Router console: ${IOS_NET}` },
        { id: 'dhcp', t: 'At least two PCs are cabled to the switch and get addresses from DHCP in 192.168.10.0/24.', check: (L) => pcs(L).filter((d) => nic0(d)?.dhcp && inLan(nic0(d).ip)).length >= 2, hint: `＋ Add two Windows 11 PCs, cable them to switch ports. Router: ${IOS_DHCP}` },
        { id: 'inet', t: 'The PCs reach the internet by name (google.com) – NAT and DNS work.', check: (L) => pcs(L).filter((d) => inLan(nic0(d)?.ip) && reachOk(L, d.id, 'google.com')).length >= 2, hint: 'From a PC: <code>ipconfig /all</code>, <code>ping 192.168.10.1</code>, <code>ping 8.8.8.8</code>, <code>ping google.com</code>. No DNS in ipconfig? Add <code>dns-server 8.8.8.8</code> to the DHCP pool and renew.' },
        { id: 'win', t: 'A Windows Server you <b>installed from the ISO</b> is cabled to the switch, named <b>SRV01</b>, with a static address in 192.168.10.10–.19 – and every PC can ping it.', check: (L) => { const s = winSrv(L); return !!s && pcs(L).length >= 2 && pcs(L).every((p) => !inLan(nic0(p)?.ip) || pingOk(L, p.id, nic0(s).ip)); }, hint: '＋ Windows Server 2022 – new › cable it › open its console: Windows Setup (Desktop Experience). Then Server Manager or PowerShell: <code>Rename-Computer SRV01 -Restart</code>, <code>New-NetIPAddress -InterfaceAlias Ethernet -IPAddress 192.168.10.10 -PrefixLength 24 -DefaultGateway 192.168.10.1</code>, <code>Set-DnsClientServerAddress -InterfaceAlias Ethernet -ServerAddresses 8.8.8.8</code>. The Windows firewall answers ping only when allowed – <code>Enable-NetFirewallRule -DisplayGroup "File and Printer Sharing"</code>.' },
        { id: 'web', t: 'An Ubuntu server you installed runs <b>nginx</b> on a static address in the LAN, and a PC opens its web page.', check: (L) => { const s = lxWebSrv(L); return !!s && pcs(L).some((p) => reachOk(L, p.id, nic0(s).ip, 80)); }, hint: '＋ Ubuntu Server 24.04 – new › cable › console: installer (Network: manual 192.168.10.11/24, gateway 192.168.10.1, DNS 8.8.8.8; tick OpenSSH). Then <code>sudo apt install -y nginx</code>, <code>systemctl status nginx</code>; on a PC open http://192.168.10.11 in the browser.' },
        { id: 'vm', t: 'A Proxmox host is installed and cabled; a VM on it (installed OS) has an address in 192.168.10.0/24 and pings both SRV01 and 8.8.8.8.', check: (L) => { const s = winSrv(L); return !!s && D(L).some((v) => v.kind === 'vm' && v.vm?.status === 'running' && !v.setup && !v.lxsetup && inLan(nic0(v)?.ip) && pingOk(L, v.id, nic0(s).ip) && pingOk(L, v.id, '8.8.8.8')); }, hint: '＋ Proxmox VE host › cable eno1 to the switch › console: installer (IP 192.168.10.20/24, gateway 192.168.10.1). Web UI › Create VM (Ubuntu ISO, bridge vmbr0, no VLAN tag), start it, install Ubuntu with DHCP.' },
        { id: 'doc', t: 'Housekeeping: take one device out of the room again (e.g. a spare PC) and open the <b>📋 Cable schedule</b> to document what you built.', check: (L) => (L.flags.removed || []).length > 0 && !!L.flags.sched, hint: '🗑 Remove › click a device. Then 📋 Cable schedule.' },
      ],
    },
    tickets: [
      { id: 'b1', no: 7101, title: 'New starter on Monday – needs a PC', who: 'HR, for Dilini (Accounts)', text: '<p>"Dilini starts on Monday. Please set up a PC for her on a free port of the office switch – she needs the intranet (http://intranet.office.local) and the internet."</p>', build: () => officeLab(), open: ['SW1'], hint: '＋ Add device › Windows 11 PC › 🔌 Cable it to a free switch port (not 1–8, those are for servers). It asks DHCP when the cable goes in. Test from its Command Prompt and browser.', checks: [{ t: 'A new PC (not PC-01/PC-02) has a DHCP address in 192.168.10.0/24', f: (L) => pcs(L).some((d) => !['PC1', 'PC2'].includes(d.id) && nic0(d)?.dhcp && inLan(nic0(d).ip)) }, { t: 'It opens http://intranet.office.local', f: (L) => pcs(L).some((d) => !['PC1', 'PC2'].includes(d.id) && (() => { try { return C.web(L, d.id, 'http://intranet.office.local'); } catch (e) { return false; } })()) }, { t: 'It reaches the internet by name', f: (L) => pcs(L).some((d) => !['PC1', 'PC2'].includes(d.id) && reachOk(L, d.id, 'google.com')) }] },
      { id: 'b2', no: 7104, title: 'File server FS01 is dead – replace it', who: 'IT manager', prio: 'High', text: '<p>"FS01 died this morning (main board). The replacement Dell server is on the bench with the Windows Server 2022 ISO. Take the old one out, put the new one on the <b>same switch port (Gi1/0/1)</b>, install it, and give it the <b>same name FS01 and address 192.168.10.10</b> so nothing else needs changing."</p>', build: () => officeLab(), fault: (L) => { const d = L.devs.FS; d.off = true; d.dead = true; d.hostname = 'FS01'; settle(L); }, open: ['SW1'], hint: '🗑 Remove the old FS01 (its cable comes out). ＋ Windows Server 2022 – new › 🔌 cable it to SW-OFFICE Gi1/0/1 › console: Windows Setup › then <code>Rename-Computer FS01 -Restart</code> and <code>New-NetIPAddress -InterfaceAlias Ethernet -IPAddress 192.168.10.10 -PrefixLength 24 -DefaultGateway 192.168.10.1</code>; allow ping: <code>Enable-NetFirewallRule -DisplayGroup "File and Printer Sharing"</code>.', checks: [{ t: 'The dead server is out of the room', f: (L) => !L.devs.FS }, { t: 'A newly installed Windows Server named FS01 is on SW-OFFICE Gi1/0/1', f: (L) => { const pr = peerOf(L, 'SW1', 'Gi1/0/1'); const d = pr && L.devs[pr.dev]; return !!d && d.kind === 'srv' && d.os === 'win' && !d.setup && /^FS01$/i.test(d.hostname); } }, { t: 'It answers on 192.168.10.10 from PC-01', f: (L) => { const pr = peerOf(L, 'SW1', 'Gi1/0/1'); return !!pr && nic0(L.devs[pr.dev])?.ip === '192.168.10.10' && pingOk(L, 'PC1', '192.168.10.10'); } }] },
      { id: 'b3', no: 7108, title: 'Second floor opens – 2 more desks', who: 'Facilities', text: '<p>"The second floor is ready. Put a small switch there, connect it to the office switch, and set up two PCs on it. They need the same network and the internet."</p>', build: () => officeLab(), open: ['SW1'], hint: '＋ Switch – 8 ports › 🔌 cable its Te1/1/1 to SW-OFFICE Te1/1/2 (switch to switch). ＋ two Windows 11 PCs › cable them to the new switch. Both switches are in VLAN 1 out of the box, so DHCP from the router reaches the new floor.', checks: [{ t: 'A new switch is cabled to SW-OFFICE', f: (L) => D(L).some((s) => s.kind === 'sw' && s.id !== 'SW1' && linkedTo(L, s, (x) => x?.id === 'SW1')) }, { t: 'Two PCs on the new switch have DHCP addresses', f: (L) => pcs(L).filter((p) => linkedTo(L, p, (x) => x?.kind === 'sw' && x.id !== 'SW1') && inLan(nic0(p)?.ip)).length >= 2 }, { t: 'They reach the internet by name', f: (L) => pcs(L).filter((p) => linkedTo(L, p, (x) => x?.kind === 'sw' && x.id !== 'SW1') && reachOk(L, p.id, 'google.com')).length >= 2 }] },
      { id: 'b4', no: 7112, title: 'The new app VM cannot see the servers', who: 'Application team', text: '<p>"We built VM 101 <b>app01</b> on the new Proxmox host pve1 yesterday. It boots fine but it cannot reach the file server FS01 (192.168.10.10) or the intranet web server. The host was delivered last week and racked next to the switch."</p>', build: () => officeLab({ pve: true }), open: ['PVE1'], hint: 'Look at the drawing: is pve1 connected to anything? 🔌 Cable pve1 eno1 to a free switch port. The VM\'s DHCP client retries by itself; check with <code>ip a</code> in its console.', checks: [{ t: 'pve1 eno1 is cabled to the switch and up', f: (L) => { const pr = peerOf(L, 'PVE1', 'eno1'); return !!pr && L.devs[pr.dev]?.kind === 'sw' && linkUp(L, 'PVE1', 'eno1'); } }, { t: 'app01 has an address in 192.168.10.0/24', f: (L) => { const v = vmById(L, 101); return !!v && inLan(nic0(v)?.ip); } }, { t: 'app01 pings FS01 and opens the intranet on web01', f: (L) => { const v = vmById(L, 101); return !!v && pingOk(L, v.id, '192.168.10.10') && reachOk(L, v.id, '192.168.10.11', 80); } }] },
      { id: 'b5', no: 7116, title: 'Decommission PC-02 and add a printer', who: 'Accounts manager', text: '<p>"PC-02 is being retired – please take it out and free its switch port. Accounts also needs a network printer on that same port (Gi1/0/11) – it should get an address automatically."</p>', build: () => officeLab(), open: ['SW1'], hint: '🗑 Remove PC-02. ＋ Network printer › 🔌 cable it to SW-OFFICE Gi1/0/11. Printers ask DHCP by themselves.', checks: [{ t: 'PC-02 is out of the room', f: (L) => !L.devs.PC2 }, { t: 'A printer is on SW-OFFICE Gi1/0/11', f: (L) => { const pr = peerOf(L, 'SW1', 'Gi1/0/11'); return !!pr && L.devs[pr.dev]?.kind === 'printer'; } }, { t: 'The printer has an address and PC-01 reaches it on port 9100', f: (L) => { const p = D(L).find((d) => d.kind === 'printer'); return !!p && inLan(nic0(p)?.ip) && reachOk(L, 'PC1', nic0(p).ip, 9100); } }] },
    ],
    quiz: [
      { q: 'In which order do you build a new office?', a: ['PCs, servers, router', 'Plan, rack and cable, router/firewall, switch, servers, PCs, test, document', 'Servers first, plan later', 'Any order'], c: 1, why: 'The network must work before servers and PCs can be configured and tested.' },
      { q: 'Where does the router\'s WAN port go?', a: ['To the switch', 'To the internet provider\'s hand-over', 'To a server', 'Nowhere'], c: 1, why: 'WAN = outside, LAN = inside (the switch).' },
      { q: 'A new Cisco router\'s port shows a grey dashed link. Most likely?', a: ['Broken cable', 'Router ports are shut down out of the box – "no shutdown"', 'Wrong VLAN', 'DNS'], c: 1, why: 'Real Cisco routers ship with interfaces administratively down.' },
      { q: 'You replace a dead file server. What keeps everything else working without changes?', a: ['A new name and a new IP', 'Same switch port, same name, same IP address', 'Reinstall every PC', 'Use DHCP for the server'], c: 1, why: 'Users, drive mappings and DNS all point at the old name and address.' },
      { q: 'A Windows PC was cabled before the router\'s DHCP was configured and has 169.254.x.x. What now?', a: ['Replace the PC', 'ipconfig /renew – Windows asks DHCP again', 'Reboot the switch', 'Give it 169.254.1.1'], c: 1, why: 'Windows asks once at link-up, then falls back to APIPA.' },
      { q: 'A VM cannot reach the physical servers. What do you check first on the host?', a: ['The VM\'s CPU', 'That the host\'s uplink (eno1) is cabled and the VM\'s NIC is on that bridge with the right VLAN', 'The Proxmox licence', 'The VM\'s disk size'], c: 1, why: 'The VM reaches the world only through the host\'s bridge and its physical port.' },
      { q: 'Why keep a cable schedule?', a: ['It is required by the ISP', 'To find and trace any cable years later without guessing', 'It makes cables faster', 'For the warranty'], c: 1, why: 'Label both ends and write each cable down.' },
      { q: 'Which addresses should DHCP NOT hand out?', a: ['The PCs\' range', 'The static range used by the gateway, servers and printers', 'All of them', 'Only .255'], c: 1, why: 'Exclude them, or a PC may get a server\'s address – a duplicate IP.' },
    ],
  });

  window.__BLD = { addDevice, removeDevice, portsOf, officeLab, emptyRoom, plug, BS, refresh, linkedTo, pingOk, reachOk, nic0, inLan, pcs, PASS };
  // ---------------------------------------------------------------- refresh the page so the new module appears
  try { renderSide(); const last = store.get('infra:last', null); if (last && last.sid === 's25') openSession('s25', last.tab); } catch (e) { console.warn(e); }
})();
