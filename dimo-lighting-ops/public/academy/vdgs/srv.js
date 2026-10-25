// Unit 5 (part 1): a Linux terminal with an editor, the network segmentation lab, the server lesson, RHEL 8.8 set-up and the Kubernetes / AiPRON deployment.
// Host names, IP addresses, VM sizes and the AiPRON chart are examples (the real ones come from SYSREQ-AM2.10-R1.2, the AASL IP plan and ADB Safegate).
const VDNET = {
  domain: 'aipron.bia.local',
  seg: { field: ['Field', 'VLAN 20', '10.20.0.0/24'], server: ['Server', 'VLAN 30', '10.30.0.0/24'], oper: ['Operator', 'VLAN 40', '10.40.0.0/24'], integ: ['Integration', 'VLAN 50', '10.50.0.0/24'], mgmt: ['Out-of-band', 'VLAN 99', '10.99.0.0/24'], dmz: ['DMZ', 'VLAN 10', '172.16.10.0/24'] },
  host: { pve1: '10.30.0.11', pve2: '10.30.0.12', aipron: '10.30.0.21', mgmt: '10.30.0.22', gw: '10.30.0.1', dns: '10.50.0.53', ntp: '192.168.1.20', fids: '10.50.0.10', jump: '172.16.10.10', idrac1: '10.99.0.11' },
};
// ---- terminal: a shell with history, an editor (vi / vim / nano) and command handlers
function VDTERM(el, o) {
  const T = { files: o.files || {}, st: o.st || {}, user: o.user || 'admin', host: o.host || 'localhost', cwd: o.cwd || '~', lines: [], hist: [], hi: 0 };
  const prompt = () => `[${T.user}@${T.host.split('.')[0]} ${T.cwd === '~' ? '~' : T.cwd.split('/').pop() || '/'}]${T.user === 'root' ? '#' : '$'} `;
  el.innerHTML = `<div class="term" tabindex="0"><span class="tl"></span><span class="tp"></span><input autocomplete="off" spellcheck="false" aria-label="Command"></div><div class="vded hidden" style="margin-top:6px"><div class="m" style="font-size:12px" data-n></div><textarea spellcheck="false" style="width:100%;min-height:260px;font:12.5px/1.45 ui-monospace,Menlo,monospace;border:1px solid var(--line);border-radius:8px;padding:8px;background:#fbfbf7"></textarea><div class="row"><button class="btn p s" data-sv>Save and exit (:wq)</button><button class="btn s" data-q>Quit without saving (:q!)</button></div></div>`;
  const box = el.querySelector('.term'), tl = el.querySelector('.tl'), tp = el.querySelector('.tp'), inp = el.querySelector('input'), ed = el.querySelector('.vded');
  const paint = () => { tl.textContent = T.lines.join('\n') + (T.lines.length ? '\n' : ''); tp.textContent = prompt(); box.scrollTop = box.scrollHeight; };
  T.out = (s) => { if (s != null && s !== '') T.lines.push(...String(s).split('\n')); if (T.lines.length > 600) T.lines.splice(0, T.lines.length - 600); };
  T.edit = (path, after) => {
    if (!(path in T.files)) T.files[path] = '';
    ed.classList.remove('hidden'); box.classList.add('hidden'); ed.querySelector('[data-n]').textContent = `Editing ${path}`; const ta = ed.querySelector('textarea'); ta.value = T.files[path]; ta.focus();
    const close = (save) => { if (save) { T.files[path] = ta.value.replace(/\s+$/, '') + '\n'; T.st['saved:' + path] = (T.st['saved:' + path] || 0) + 1; o.onWrite && o.onWrite(path); } ed.classList.add('hidden'); box.classList.remove('hidden'); T.out(save ? `"${path}" written` : ''); paint(); inp.focus(); if (after) after(save); o.onChange && o.onChange(T); };
    ed.querySelector('[data-sv]').onclick = () => close(true); ed.querySelector('[data-q]').onclick = () => close(false);
  };
  const path = (p) => (p.startsWith('~/') ? p : p.startsWith('/') ? p : T.cwd === '~' ? '~/' + p : T.cwd + '/' + p);
  const builtin = (c, a, f) => {
    if (c === 'clear') { T.lines = []; return ''; }
    if (c === 'pwd') return T.cwd === '~' ? `/home/${T.user}` : T.cwd;
    if (c === 'whoami') return T.user;
    if (c === 'history') return T.hist.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join('\n');
    const red = c === 'echo' && a.join(' ').match(/^(.*?)\s*(>>?)\s*(\S+)$/);
    if (red) { const p = path(red[3]); if (/^\/etc\//.test(p) && !f.root) return `-bash: ${red[3]}: Permission denied`; const txt = red[1].replace(/^["']|["']$/g, '') + '\n'; T.files[p] = red[2] === '>>' ? (T.files[p] || '') + txt : txt; o.onWrite && o.onWrite(p); return ''; }
    if (c === 'echo') return a.join(' ').replace(/^["']|["']$/g, '');
    if (c === 'cat' && a[0]) { const f = path(a[0]); return f in T.files ? T.files[f].replace(/\n$/, '') : `cat: ${a[0]}: No such file or directory`; }
    if (c === 'ls') { const d = a.filter((x) => !x.startsWith('-'))[0] || T.cwd, pre = path(d).replace(/\/$/, '') + '/'; const n = [...new Set(Object.keys(T.files).filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length).split('/')[0]))]; return n.join('  '); }
    if (c === 'cd') { T.cwd = !a[0] || a[0] === '~' ? '~' : a[0].startsWith('/') ? a[0] : T.cwd + '/' + a[0]; return ''; }
    if (['vi', 'vim', 'nano'].includes(c) && a[0]) { if (/^\/etc\//.test(path(a[0])) && !f.root) return `"${a[0]}" [readonly] – you need sudo to change it`; T.edit(path(a[0])); return null; }
    return undefined;
  };
  const run = (line) => {
    T.out(prompt() + line); const raw = line.trim(); if (!raw) return paint();
    T.hist.push(raw); T.hi = T.hist.length;
    for (const part of raw.split(/\s*(?:&&|;)\s*/)) {
      let s = part, sudo = false; if (/^sudo\s+/.test(s)) { sudo = true; s = s.replace(/^sudo\s+/, ''); }
      const shc = s.match(/^(?:sh|bash)\s+-c\s+["'](.*)["']$/); if (shc) s = shc[1];
      const [c, ...a] = s.split(/\s+/);
      const f = { c, a, sudo, root: sudo || T.user === 'root' };
      let r = o.run ? o.run(s, T, f) : undefined;
      if (r === undefined) r = builtin(c, a, f);
      if (r === undefined) r = `-bash: ${c}: command not found`;
      if (r === null) return; // the editor took over
      T.out(r);
    }
    paint(); o.onChange && o.onChange(T);
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = inp.value; inp.value = ''; run(v); }
    else if (e.key === 'ArrowUp') { T.hi = Math.max(0, T.hi - 1); inp.value = T.hist[T.hi] || ''; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { T.hi = Math.min(T.hist.length, T.hi + 1); inp.value = T.hist[T.hi] || ''; e.preventDefault(); }
  });
  box.addEventListener('click', () => inp.focus());
  T.out(o.motd || ''); paint();
  T.type = (cmd) => run(cmd);
  return T;
}
// a lab of objectives beside a console: each objective ticks when the state says it is done; Hand over scores them
function VDOBJ(box, objs, done, onRetry) {
  box.innerHTML = `<div class="steps" data-ol></div><div class="row" style="margin-top:8px"><button class="btn p s" data-ho>Hand over – score my work</button><button class="btn s" data-hint>Show a hint</button></div><div data-hn class="note"></div><div data-res></div>`;
  let hints = 0;
  const upd = () => { const first = objs.findIndex((x) => !x.ok()); box.querySelector('[data-ol]').innerHTML = objs.map((x, i) => `<div class="${x.ok() ? 'ok' : i === first ? 'cur' : ''}">${x.ok() ? '✓' : `${i + 1}.`} ${x.t}</div>`).join(''); };
  box.querySelector('[data-hint]').onclick = () => { const x = objs.find((y) => !y.ok()); if (x) { hints++; box.querySelector('[data-hn]').innerHTML = `<b>Hint:</b> ${x.h}`; } };
  box.querySelector('[data-ho]').onclick = () => { const n = objs.filter((x) => x.ok()).length; done(n, objs.length); VD.result(box.querySelector('[data-res]'), n, objs.length, objs.map((x) => [x.ok(), x.t]), onRetry); };
  upd(); return upd;
}
(() => {
  const N = VDNET, H = N.host, { quiz } = VD;

  // ===== lesson: the server side of the system
  item('server', 'srvintro', '🖥️', 'How AiPRON Manager is built', '3 tiers, the servers and VMs, the network segments, DNS, logs and backup', 'lesson', (el, done) => {
    el.innerHTML = `<div class="two"><div>
      <h4>Three tiers</h4><ul><li><b>Client</b>: HMI in Chrome / Firefox, the Safedocks and the Axis cameras.</li><li><b>Application</b>: AiPRON Manager micro-services in containers, run by Kubernetes on one Linux server (single node – not a cluster).</li><li><b>Data</b>: runtime database, message bus, file storage and archive; external interfaces (FIDS / AODB, AD/LDAP, TMS/BMS).</li></ul>
      <h4>The BIA set-up</h4><ul><li>ADB Safegate installs AiPRON on one server, fully containerised, on <b>RHEL 8.8</b>.</li><li>DIMO provides a <b>redundant server</b> and a VM platform (Proxmox here). Once the main server is installed, the second takes the backup role: full and incremental backups.</li><li>A <b>management workstation</b> (Windows) carries SMT and SLV and can be the jump host for remote support.</li></ul>
      <h4>Network segments (AASL asked for segmentation)</h4><table class="spec">${Object.values(N.seg).map((s) => `<tr><td>${s[0]}</td><td>${s[1]}</td><td>${s[2]}</td></tr>`).join('')}</table><div class="note">Example plan for the labs; NTP 192.168.1.20 port 123 is the airport's real time server from the IT comments.</div>
    </div><div>
      <h4>DNS names and certificates</h4><table class="spec"><tr><td>AiPRON web site</td><td>web.aipron.&lt;domain&gt;</td></tr><tr><td>Log-in (Keycloak)</td><td>login.aipron.&lt;domain&gt;</td></tr><tr><td>Logging (Grafana)</td><td>grafana.aipron.&lt;domain&gt;</td></tr><tr><td>Monitoring (Prometheus)</td><td>prometheus.aipron.&lt;domain&gt;</td></tr></table><p>Certificates are issued by BIA. The alternative is self-signed certificates from cert-manager in Kubernetes – then the airport must put the root certificate on every PC, or browsers warn.</p>
      <h4>Security</h4><ul><li>iptables on the Linux server: deny incoming, allow outgoing, open only the listed ports.</li><li>Antivirus on the servers, with folders whitelisted so scans do not break the containers.</li><li>Firewall rules follow the AASL IT policy; ADB Safegate needs confirmation once they are set.</li></ul>
      <h4>Logs</h4><p>One log file per module per day, zipped after 2 days, kept 30 days. Camera video kept 1 month, event history 6 months (tender 3.5.5). Safedock logs pdock / pbrief / pevent and the .scfg configuration are pulled to the server automatically.</p>
    </div></div><h3>Check yourself</h3><div id="sQ"></div>`;
    quiz($('sQ'), [
      { q: 'What runs the AiPRON micro-services at BIA?', a: ['Kubernetes on one RHEL 8.8 server (single node)', 'A three-node Kubernetes cluster', 'Windows IIS', 'The Safedocks'], c: 0 },
      { q: 'What is the second (redundant) server for?', a: ['Backups of the VMs – full and incremental – and a standby', 'A second AiPRON for the other apron', 'The HMI desktops', 'Nothing until it fails'], c: 0 },
      { q: 'Which DNS name does the operator open in the browser?', a: ['web.aipron.<domain>', 'login.aipron.<domain>', 'prometheus.aipron.<domain>', 'the server IP'], c: 0 },
      { q: 'With self-signed certificates from cert-manager, the airport must…', a: ['put the root certificate on every client PC', 'do nothing', 'turn off HTTPS', 'buy a public certificate'], c: 0 },
      { q: 'How long are event history logs kept?', a: ['6 months', '30 days', '1 month', '1 year'], c: 0, why: 'Tender 3.5.5: video 1 month, other event history 6 months.' },
      { q: 'Which NTP server did AASL give?', a: ['192.168.1.20, port 123', 'pool.ntp.org', '10.30.0.1', 'the Safedock'], c: 0 },
      { q: 'Why segment the network?', a: ['To isolate the field, users, servers and integrations so a problem or attack in one stays there', 'To make cabling cheaper', 'Kubernetes needs it', 'It is a Safedock requirement'], c: 0 },
    ], done, { n: 6 });
  });

  // ===== lab: segments and firewall rules
  item('server', 'net', '🧱', 'Network & firewall lab', 'Put every device in its segment, then allow only the traffic the system needs', 'lab', (el, done) => {
    const DEV = [['Safedock FleX scanners (8)', 'field'], ['PDFleX displays and FOP-L panels', 'field'], ['Axis cameras', 'field'], ['HMI desktops in the apron control room', 'oper'], ['pve1 / pve2 Proxmox hosts', 'server'], ['aipron-node VM (RHEL)', 'server'], ['mgmt-tools VM (SMT, SLV)', 'server'], ['iDRAC / iLO of both servers', 'mgmt'], ['FIDS / AODB', 'integ'], ['Airport DNS', 'integ'], ['Jump / bastion host for remote support', 'dmz']];
    const RULES = [
      ['Operator → aipron-node · TCP 443 (HMI over HTTPS)', true], ['aipron-node → Field · Safedock protocol (schedule, status, logs)', true], ['mgmt-tools → Field · Safedock protocol (SMT configuration)', true], ['aipron-node → FIDS · AIDX 16.1 over HTTPS', true], ['aipron-node → 192.168.1.20 · UDP 123 (NTP)', true], ['Server → Airport DNS · UDP/TCP 53', true], ['DMZ jump host → mgmt-tools · RDP 3389', true], ['aipron-node → Server · backup to pve2 (NFS)', true],
      ['Any → Any · any (to make commissioning easy)', false], ['DMZ jump host → Field · any', false], ['Internet → aipron-node · TCP 443', false], ['Operator → Field · any (so the HMI PCs can reach the Safedocks)', false], ['Field → Internet · any (for updates)', false],
    ];
    const run = () => {
      const R = VD.shuffle(RULES);
      el.innerHTML = `<div class="task">The AASL IT team wants the system segmented. Part 1: put each device in its segment. Part 2: tick only the firewall rules the system needs – least privilege, nothing extra.</div>
      <div class="two"><div><h4>Part 1 · Segments</h4><table class="spec">${DEV.map(([d], i) => `<tr><td>${d}</td><td><select id="nd${i}"><option value="">—</option>${Object.entries(N.seg).map(([k, s]) => `<option value="${k}">${s[0]} · ${s[1]}</option>`).join('')}</select></td></tr>`).join('')}</table></div>
      <div><h4>Part 2 · Firewall rules</h4>${R.map(([r], i) => `<label style="display:flex;gap:8px;padding:4px 0"><input type="checkbox" id="nr${i}"> ${r}</label>`).join('')}<div class="note">Example plan: field 10.20.0.0/24, server 10.30.0.0/24, operator 10.40.0.0/24, integration 10.50.0.0/24.</div></div></div>
      <div class="row" style="margin-top:8px"><button class="btn p" id="nChk">Check</button></div><div id="nRes"></div>`;
      $('nChk').onclick = () => {
        const rows = DEV.map(([d, s], i) => [$(`nd${i}`).value === s, `${d} → ${N.seg[s][0]}`]);
        R.forEach(([r, need], i) => rows.push([$(`nr${i}`).checked === need, `${need ? 'Allow' : 'Do not allow'}: ${r}`]));
        const sc = rows.filter((x) => x[0]).length; done(sc, rows.length); VD.result($('nRes'), sc, rows.length, rows, run);
      };
    };
    run();
  });

  // ===== lab: RHEL 8.8 on the aipron-node VM – the installer, then the shell
  item('server', 'rhel', '🎩', 'RHEL 8.8 on aipron-node', 'Anaconda installer, registration, updates, guest agent, NTP, iptables, SELinux', 'lab', (el, done) => {
    const run = () => {
      const A = { tz: '', ntp: false, dest: false, sw: '', net: {}, root: false, user: false };
      const TILES = [['tz', 'TIME & DATE', () => A.tz === 'Asia/Colombo' && A.ntp], ['dest', 'INSTALLATION DESTINATION', () => A.dest], ['sw', 'SOFTWARE SELECTION', () => A.sw === 'Server' || A.sw === 'Minimal Install'], ['net', 'NETWORK & HOST NAME', () => A.net.on && A.net.ip === '10.30.0.21' && A.net.pfx === '24' && A.net.gw === H.gw && A.net.dns === H.dns && A.net.hn === `aipron-node.${N.domain}`], ['root', 'ROOT PASSWORD', () => A.root], ['user', 'USER CREATION', () => A.user]];
      el.innerHTML = `<div class="task">VM 101 <b>aipron-node</b> boots from the RHEL 8.8 DVD. Build sheet (example): hostname <b>aipron-node.${N.domain}</b>, NIC ens18 <b>10.30.0.21/24</b>, gateway ${H.gw}, DNS ${H.dns}, NTP <b>${H.ntp}</b>, time zone Asia/Colombo, user <b>admin</b> (administrator), Server install on the whole 200 GB disk.</div><div id="rA"></div>`;
      const hub = () => {
        $('rA').innerHTML = `<div class="panel" style="background:#2b2b2b;color:#eee;padding:14px 18px"><div class="row" style="justify-content:space-between"><b style="font-size:16px">INSTALLATION SUMMARY</b><span style="font-size:12px">RED HAT ENTERPRISE LINUX 8.8 INSTALLATION · 🇬🇧 us</span></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-top:12px">${TILES.map(([k, n, ok]) => `<div data-t="${k}" style="background:${ok() ? '#3a3a3a' : '#4a2a2a'};border-radius:6px;padding:10px;cursor:pointer"><b style="font-size:12px">${n}</b><div style="font-size:12px;color:${ok() ? '#9ccc65' : '#ff8a80'}">${ok() ? 'Done' : '⚠ Needs attention'}</div></div>`).join('')}</div>
          <div id="rF" style="margin-top:12px"></div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="rQuit">Quit</button><button class="btn p" id="rBegin" ${TILES.every((t) => t[2]()) ? '' : 'disabled'}>Begin Installation</button></div></div>`;
        el.querySelectorAll('[data-t]').forEach((d) => (d.onclick = () => form(d.dataset.t)));
        $('rQuit').onclick = run; $('rBegin').onclick = install;
      };
      const F = (h, save) => { $('rF').innerHTML = `<div style="background:#fff;color:#14161c;border-radius:8px;padding:12px">${h}<div class="row" style="margin-top:8px"><button class="btn p s" id="rDone">Done</button></div></div>`; $('rDone').onclick = () => { save(); hub(); }; };
      const form = (k) => {
        if (k === 'tz') F(`<b>TIME & DATE</b><div class="ctl"><div><label>Region / City</label><select id="f1">${['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Colombo', 'Asia/Dubai'].map((z) => `<option ${A.tz === z ? 'selected' : ''}>${z}</option>`).join('')}</select></div><div><label>Network Time</label><select id="f2"><option>OFF</option><option ${A.ntp ? 'selected' : ''}>ON – server ${H.ntp} iburst</option><option>ON – 2.rhel.pool.ntp.org</option></select></div></div>`, () => { A.tz = $('f1').value; A.ntp = $('f2').selectedIndex === 1; });
        if (k === 'dest') F(`<b>INSTALLATION DESTINATION</b><label style="display:block;margin-top:6px"><input type="checkbox" id="f1" ${A.dest ? 'checked' : ''}> sda · QEMU HARDDISK · 200 GiB free</label><div class="m" style="font-size:12px">Storage configuration: Automatic</div>`, () => (A.dest = $('f1').checked));
        if (k === 'sw') F(`<b>SOFTWARE SELECTION</b>${['Server with GUI', 'Server', 'Minimal Install', 'Workstation', 'Virtualization Host'].map((s) => `<label style="display:block"><input type="radio" name="f1" value="${s}" ${A.sw === s ? 'checked' : ''}> ${s}</label>`).join('')}<div class="m" style="font-size:12px">A server for containers needs no desktop.</div>`, () => (A.sw = (el.querySelector('input[name=f1]:checked') || {}).value || ''));
        if (k === 'net') F(`<b>NETWORK & HOST NAME</b><div class="row" style="margin:6px 0"><span>Ethernet (ens18) · Red Hat VirtIO</span><label><input type="checkbox" id="f0" ${A.net.on ? 'checked' : ''}> ON</label></div><div class="ctl"><div><label>Method</label><select id="fm"><option>Automatic (DHCP)</option><option ${A.net.ip ? 'selected' : ''}>Manual</option></select></div><div><label>Address</label><input type="text" id="f1" value="${A.net.ip || ''}"></div><div><label>Prefix</label><input type="text" id="f2" value="${A.net.pfx || ''}"></div><div><label>Gateway</label><input type="text" id="f3" value="${A.net.gw || ''}"></div><div><label>DNS servers</label><input type="text" id="f4" value="${A.net.dns || ''}"></div><div><label>Host name</label><input type="text" id="f5" value="${A.net.hn || 'localhost.localdomain'}"></div></div>`, () => { const g = (i) => $(i).value.trim(); A.net = $('fm').selectedIndex === 1 ? { on: $('f0').checked, ip: g('f1'), pfx: g('f2').replace('/', ''), gw: g('f3'), dns: g('f4'), hn: g('f5') } : { on: $('f0').checked, hn: g('f5') }; });
        if (k === 'root') F(`<b>ROOT PASSWORD</b><div class="ctl"><div><label>Root password</label><input type="text" id="f1" placeholder="at least 12 characters"></div></div>`, () => (A.root = $('f1').value.length >= 12));
        if (k === 'user') F(`<b>CREATE USER</b><div class="ctl"><div><label>User name</label><input type="text" id="f1" value="admin"></div><div><label>Password</label><input type="text" id="f2"></div></div><label style="display:block;margin-top:6px"><input type="checkbox" id="f3"> Make this user administrator</label>`, () => (A.user = $('f1').value === 'admin' && $('f2').value.length >= 8 && $('f3').checked));
      };
      const install = () => {
        let pct = 0; $('rA').innerHTML = `<div class="panel" style="background:#2b2b2b;color:#eee;padding:18px"><b>INSTALLATION PROGRESS</b><div class="bar" style="width:100%;margin:10px 0"><i id="rP" style="width:0"></i></div><div id="rPt" style="font-size:12px">Starting package installation process</div></div>`;
        const stop = VD.loop(() => { pct += 4; $('rP').style.width = pct + '%'; $('rPt').textContent = pct < 70 ? `Installing packages (${Math.round(pct * 6)}/420)` : pct < 96 ? 'Configuring installed system' : 'Complete!'; if (pct >= 100) { stop(); shell(); } }, 120);
      };
      const shell = () => {
        const st = { reg: false, upd: false, qga: false, qgaOn: false, chronyRst: 0, fwd: true, ipt: false, iptOn: false, iptLoaded: false, sel: 'Enforcing' };
        $('rA').innerHTML = `<div class="tw" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div id="rT"></div><div id="rO"></div></div>`;
        const files = { '/etc/chrony.conf': '# Use public servers from the pool.ntp.org project.\npool 2.rhel.pool.ntp.org iburst\n\n# Record the rate at which the system clock gains/losses time.\ndriftfile /var/lib/chrony/drift\nmakestep 1.0 3\nrtcsync\n', '/etc/hosts': '127.0.0.1   localhost localhost.localdomain\n::1         localhost localhost.localdomain\n', '/etc/selinux/config': 'SELINUX=enforcing\nSELINUXTYPE=targeted\n' };
        files['/etc/sysconfig/iptables'] = '# sample configuration for iptables service\n*filter\n:INPUT ACCEPT [0:0]\n:FORWARD ACCEPT [0:0]\n:OUTPUT ACCEPT [0:0]\n-A INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT\n-A INPUT -p icmp -j ACCEPT\n-A INPUT -i lo -j ACCEPT\n-A INPUT -p tcp -m state --state NEW -m tcp --dport 22 -j ACCEPT\n-A INPUT -j REJECT --reject-with icmp-host-prohibited\n-A FORWARD -j REJECT --reject-with icmp-host-prohibited\nCOMMIT\n';
        let chronyEditAt = 0;
        const ipt = () => files['/etc/sysconfig/iptables'] || '';
        const iptOk = () => /:INPUT (DROP|REJECT)/.test(ipt()) && /-i lo -j ACCEPT/.test(ipt()) && /ESTABLISHED/.test(ipt()) && /-s 10\.30\.0\.22(\/32)?\b[^\n]*--dport 22\b[^\n]*ACCEPT/.test(ipt()) && /-s 10\.40\.0\.0\/24[^\n]*--dport 443\b[^\n]*ACCEPT/.test(ipt()) && !/--dport 22 -j ACCEPT/.test(ipt().replace(/-s 10\.30\.0\.22\S*[^\n]*/g, ''));
        const T = VDTERM($('rT'), { host: `aipron-node.${N.domain}`, user: 'admin', files, st, onWrite: (p) => { if (p === '/etc/chrony.conf') chronyEditAt = Date.now(); }, motd: `Red Hat Enterprise Linux 8.8 (Ootpa)\nKernel 4.18.0-477.10.1.el8_8.x86_64 on an x86_64\n\nActivate the web console with: systemctl enable --now cockpit.socket\n\nLast login: ${new Date().toDateString()} from 10.30.0.22`, onChange: () => upd(), run: (s, T, { c, a, root }) => {
          const need = () => (root ? null : 'Error: This command has to be run with superuser privileges (under the root user on most systems).');
          if (c === 'hostnamectl') return `   Static hostname: aipron-node.${N.domain}\n         Icon name: computer-vm\n           Chassis: vm\n  Operating System: Red Hat Enterprise Linux 8.8 (Ootpa)\n            Kernel: Linux 4.18.0-477.10.1.el8_8.x86_64\n      Architecture: x86-64`;
          if (c === 'ip' && /^a/.test(a[0] || '')) return `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536\n    inet 127.0.0.1/8 scope host lo\n2: ens18: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    link/ether bc:24:11:5a:1e:07 brd ff:ff:ff:ff:ff:ff\n    inet 10.30.0.21/24 brd 10.30.0.255 scope global noprefixroute ens18`;
          if (c === 'nmcli') return `NAME   UUID                                  TYPE      DEVICE\nens18  4c1f3d0e-2a7b-4f3c-9d5c-0b9a61f2c8a1  ethernet  ens18`;
          if (c === 'ping') return `PING ${a.slice(-1)[0]} 56(84) bytes of data.\n64 bytes from ${a.slice(-1)[0]}: icmp_seq=1 ttl=63 time=0.61 ms\n64 bytes from ${a.slice(-1)[0]}: icmp_seq=2 ttl=63 time=0.48 ms\n--- 2 packets transmitted, 2 received, 0% packet loss`;
          if (c === 'subscription-manager') { if (need()) return need(); if (a[0] === 'register') { st.reg = true; return 'Registering to: subscription.rhsm.redhat.com:443/subscription\nThe system has been registered with ID: 7c1e9b4a-58d2-4f0e-a1b3-9e2d6c40f511\nThe registered system name is: aipron-node.' + N.domain; } if (a[0] === 'status') return st.reg ? 'Overall Status: Registered' : 'Overall Status: Unknown'; return 'Usage: subscription-manager register --username <user> | --org <org> --activationkey <key>'; }
          if (c === 'dnf' || c === 'yum') {
            if (need()) return need();
            if (!st.reg) return 'Updating Subscription Management repositories.\nThis system is not registered with an entitlement server. You can use subscription-manager to register.\nError: There are no enabled repositories in "/etc/yum.repos.d", "/etc/yum/repos.d", "/etc/distro.repos.d".';
            if (a[0] === 'update' || a[0] === 'upgrade') { st.upd = true; return 'Red Hat Enterprise Linux 8 for x86_64 - BaseOS (RPMs)   18 MB/s |  72 MB\nDependencies resolved.\nUpgrading: 214 packages\n...\nComplete!'; }
            if (a[0] === 'install') { const p = a.filter((x) => !x.startsWith('-')).slice(1); if (p.includes('qemu-guest-agent')) st.qga = true; if (p.includes('iptables-services')) st.ipt = true; return `Dependencies resolved.\nInstalling:\n${p.map((x) => ` ${x}`).join('\n')}\n\nComplete!`; }
            return 'usage: dnf [options] COMMAND';
          }
          if (c === 'systemctl') {
            const v = a.find((x) => !x.startsWith('-') && !['enable', 'disable', 'start', 'stop', 'restart', 'status', 'mask'].includes(x)) || '', act = a.find((x) => ['enable', 'disable', 'start', 'stop', 'restart', 'status', 'mask'].includes(x)), now = a.includes('--now');
            if (act !== 'status' && need()) return need();
            const unit = v.replace(/\.service$/, '');
            if (unit === 'qemu-guest-agent') { if (!st.qga) return 'Failed to start qemu-guest-agent.service: Unit qemu-guest-agent.service not found.'; if (act === 'start' || (act === 'enable' && now) || act === 'restart') st.qgaOn = true; return act === 'status' ? `● qemu-guest-agent.service - QEMU Guest Agent\n   Active: ${st.qgaOn ? 'active (running)' : 'inactive (dead)'}` : ''; }
            if (unit === 'chronyd') { if (act === 'restart' || act === 'start') st.chronyRst = Date.now(); return act === 'status' ? '● chronyd.service - NTP client/server\n   Active: active (running)' : ''; }
            if (unit === 'firewalld') { if (act === 'stop' || (act === 'disable' && now) || act === 'mask') st.fwd = false; if (act === 'start') st.fwd = true; return act === 'disable' ? 'Removed /etc/systemd/system/multi-user.target.wants/firewalld.service.' : act === 'status' ? `● firewalld.service\n   Active: ${st.fwd ? 'active (running)' : 'inactive (dead)'}` : ''; }
            if (unit === 'iptables') { if (!st.ipt) return 'Failed to start iptables.service: Unit iptables.service not found.'; if (st.fwd && (act === 'start' || (act === 'enable' && now))) return 'Job for iptables.service failed: firewalld is still running – stop and disable it first.'; if (act === 'start' || act === 'restart' || (act === 'enable' && now)) { st.iptOn = true; st.iptLoaded = iptOk(); } return act === 'status' ? `● iptables.service - IPv4 firewall with iptables\n   Active: ${st.iptOn ? 'active (exited)' : 'inactive (dead)'}` : act === 'enable' ? 'Created symlink /etc/systemd/system/multi-user.target.wants/iptables.service → /usr/lib/systemd/system/iptables.service.' : ''; }
            return `Unit ${v || '?'} could not be found.`;
          }
          if (c === 'chronyc') { const fixed = /^server 192\.168\.1\.20/m.test(files['/etc/chrony.conf']) && !/^pool /m.test(files['/etc/chrony.conf']) && st.chronyRst > chronyEditAt; return a[0] === 'sources' ? `MS Name/IP address         Stratum Poll Reach LastRx Last sample\n===============================================================================\n${fixed ? '^* 192.168.1.20                  2   6   377    12   +215us[ +301us] +/-   14ms' : '^? 2.rhel.pool.ntp.org           0   6     0     -     +0ns[   +0ns] +/-    0ns\n(no reply – the airport network blocks the internet)'}` : 'chronyc: use "chronyc sources"'; }
          if (c === 'timedatectl') return a[0] === 'set-timezone' ? '' : `               Local time: ${new Date().toString().slice(0, 24)} +0530\n                Time zone: Asia/Colombo (+0530, +0530)\nSystem clock synchronized: ${st.chronyRst > chronyEditAt && /^server 192\.168\.1\.20/m.test(files['/etc/chrony.conf']) ? 'yes' : 'no'}\n              NTP service: active`;
          if (c === 'iptables') { if (need()) return need(); if (a.includes('-L')) return st.iptOn ? (st.iptLoaded ? `Chain INPUT (policy DROP)\ntarget     prot opt source               destination\nACCEPT     all  --  0.0.0.0/0            0.0.0.0/0     state RELATED,ESTABLISHED\nACCEPT     all  --  0.0.0.0/0            0.0.0.0/0\nACCEPT     tcp  --  10.30.0.22           0.0.0.0/0     tcp dpt:22\nACCEPT     tcp  --  10.40.0.0/24         0.0.0.0/0     tcp dpt:443\n\nChain OUTPUT (policy ACCEPT)` : 'Chain INPUT (policy ACCEPT)\n(rules loaded from the sample file – edit /etc/sysconfig/iptables, then restart iptables)') : 'Chain INPUT (policy ACCEPT)\n(no rules – iptables service not running)'; return 'Edit /etc/sysconfig/iptables and restart the service – rules typed here are lost at reboot.'; }
          if (c === 'getenforce') return st.sel;
          if (c === 'setenforce') { if (need()) return need(); st.sel = a[0] === '0' ? 'Permissive' : 'Enforcing'; return ''; }
          if (c === 'sudo') return '';
          return undefined;
        } });
        const upd = VDOBJ($('rO'), [
          { t: 'Install RHEL with the build-sheet settings', ok: () => true, h: '' },
          { t: 'Register the system and install all updates', ok: () => st.reg && st.upd, h: 'sudo subscription-manager register --org BIA --activationkey aipron &nbsp;then&nbsp; sudo dnf update -y' },
          { t: 'Install and start the QEMU guest agent (Proxmox shuts down and backs up the VM cleanly)', ok: () => st.qga && st.qgaOn, h: 'sudo dnf install -y qemu-guest-agent && sudo systemctl enable --now qemu-guest-agent' },
          { t: `Time from the airport NTP server ${H.ntp} only`, ok: () => /^server 192\.168\.1\.20/m.test(files['/etc/chrony.conf']) && !/^pool /m.test(files['/etc/chrony.conf']) && st.chronyRst > chronyEditAt, h: 'sudo vi /etc/chrony.conf – replace the pool line with "server 192.168.1.20 iburst", save, then sudo systemctl restart chronyd and chronyc sources' },
          { t: 'Replace firewalld with the iptables service (the SSDD uses iptables)', ok: () => !st.fwd && st.ipt && st.iptOn, h: 'sudo systemctl disable --now firewalld && sudo dnf install -y iptables-services && sudo systemctl enable --now iptables' },
          { t: 'iptables: deny incoming; allow loopback, established, SSH only from mgmt-tools 10.30.0.22, HTTPS 443 from the operator segment 10.40.0.0/24', ok: () => st.iptOn && st.iptLoaded, h: 'sudo vi /etc/sysconfig/iptables: ":INPUT DROP [0:0]", keep the lo and ESTABLISHED lines, "-A INPUT -s 10.30.0.22/32 -p tcp -m tcp --dport 22 -j ACCEPT", "-A INPUT -s 10.40.0.0/24 -p tcp -m tcp --dport 443 -j ACCEPT", remove the open port 22 line and the REJECT lines, then sudo systemctl restart iptables' },
          { t: 'SELinux stays Enforcing', ok: () => st.sel === 'Enforcing' && st.upd, h: 'Do not run setenforce 0 – check with getenforce' },
        ], done, run);
      };
      hub();
    };
    run();
  });

  // ===== lab: Kubernetes single node + AiPRON Manager
  item('server', 'k8s', '☸️', 'Kubernetes & AiPRON deployment', 'Single-node cluster, ingress, cert-manager, the AiPRON chart, a crashing pod', 'lab', (el, done) => {
    const run = () => {
      const st = { swap: true, mods: false, sysctl: false, crRepo: false, cr: false, crCfg: false, crOn: false, kRepo: false, kube: false, kubelet: false, init: false, kcfg: false, taint: false, cni: false, ingress: false, cm: false, issuer: false, aipron: false, fixed: false };
      const files = {
        '/etc/fstab': '/dev/mapper/rhel-root   /                       xfs     defaults        0 0\nUUID=2f1c9a3e-7d41-4b0e-9a3f-5c1e2d9b7a10 /boot  xfs     defaults        0 0\n/dev/mapper/rhel-swap   none                    swap    defaults        0 0\n',
        '/etc/sysctl.d/k8s.conf': '',
        '/etc/containerd/config.toml': '',
        '/etc/yum.repos.d/kubernetes.repo': '',
        '~/calico.yaml': '# Calico v3.27 manifest (downloaded earlier)\n...',
        '~/bia-ca-issuer.yaml': `apiVersion: cert-manager.io/v1\nkind: ClusterIssuer\nmetadata:\n  name: bia-ca\nspec:\n  ca:\n    secretName: bia-ca-keypair   # the CA issued by BIA IT`,
        '~/aipron-manager/Chart.yaml': 'apiVersion: v2\nname: aipron-manager\ndescription: AiPRON Manager (training package – the real one is installed by ADB Safegate)\nversion: 2.10.0',
        '~/values-bia.yaml': `# AiPRON Manager – BIA site values (example)\nglobal:\n  domain: ${N.domain}\n  timezone: Asia/Colombo\ningress:\n  className: nginx\n  issuer: bia-ca\n  hosts:\n    web: web.${N.domain}\n    login: login.${N.domain}\n    grafana: grafana.${N.domain}\n    prometheus: prometheus.${N.domain}\nntp:\n  server: ${H.ntp}\nfids:\n  protocol: AIDX-16.1\n  endpoint: https://fids.bia.loacl/aidx\nsafedocks:\n  - { stand: A6,  ip: 10.20.0.16 }\n  - { stand: A7,  ip: 10.20.0.17 }\n  - { stand: A8,  ip: 10.20.0.18 }\n  - { stand: A9,  ip: 10.20.0.19 }\n  - { stand: B10, ip: 10.20.0.20 }\n  - { stand: B11, ip: 10.20.0.21 }\n  - { stand: B12, ip: 10.20.0.22 }\n  - { stand: B14, ip: 10.20.0.24 }\nlogs:\n  keepDays: 30\n  eventMonths: 6\n  videoMonths: 1\n`,
      };
      el.innerHTML = `<div class="task">On <b>aipron-node</b> (RHEL 8.8 from the last lab), build a single-node Kubernetes, add ingress and cert-manager, then install the AiPRON Manager package with the BIA values. The package and its pods are a training replica; the Kubernetes and Helm commands are the real upstream ones.</div><div class="tw" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div id="kT"></div><div id="kO"></div></div>`;
      const fidsOk = () => /endpoint:\s*https:\/\/fids\.bia\.local\/aidx/.test(files['~/values-bia.yaml']);
      const pods = () => [['web-ui-7c9d5f-xk2lp', 1], ['keycloak-0', 1], ['flight-service-5b8c-q4t9z', 1], ['safedock-gw-6f7b-2mnp8', 1], ['rids-service-74d9c-8kq2w', 1], ['runtime-db-0', 1], ['message-bus-0', 1], ['grafana-6d8f-ztm4c', 1], ['prometheus-0', 1], [st.fixed ? 'fids-aidx-adapter-5c7f-l2k9d' : 'fids-aidx-adapter-9d2-wq7', st.fixed ? 1 : 0]];
      const T = VDTERM($('kT'), { host: `aipron-node.${N.domain}`, user: 'admin', files, st, motd: 'Red Hat Enterprise Linux 8.8 (Ootpa)\nLast login from 10.30.0.22', onChange: () => upd(), run: (s, T, { c, a, root }) => {
        const need = () => (root ? null : 'Permission denied – use sudo');
        const line = s;
        if (c === 'swapoff') { if (need()) return need(); st.swap = false; return ''; }
        if (c === 'free') return `              total        used        free\nMem:       32761856     2104312    28911200\nSwap:      ${st.swap ? '4194300' : '0'}`;
        if (c === 'modprobe') { if (need()) return need(); if (a.includes('br_netfilter') || a.includes('overlay')) st.mods = st.mods || a.includes('br_netfilter'); return ''; }
        if (c === 'sysctl' && a[0] === '--system') { if (need()) return need(); const f = files['/etc/sysctl.d/k8s.conf']; st.sysctl = /net\.ipv4\.ip_forward\s*=\s*1/.test(f) && /net\.bridge\.bridge-nf-call-iptables\s*=\s*1/.test(f) && st.mods; return st.sysctl ? '* Applying /etc/sysctl.d/k8s.conf ...\nnet.bridge.bridge-nf-call-iptables = 1\nnet.bridge.bridge-nf-call-ip6tables = 1\nnet.ipv4.ip_forward = 1' : st.mods ? '* Applying /etc/sysctl.d/k8s.conf ...\n(no Kubernetes settings found in /etc/sysctl.d/k8s.conf)' : 'sysctl: cannot stat /proc/sys/net/bridge/bridge-nf-call-iptables: No such file or directory (load br_netfilter first)'; }
        if (c === 'dnf') {
          if (need()) return need();
          if (a[0] === 'config-manager' && /docker\.com/.test(line)) { st.crRepo = true; return 'Adding repo from: https://download.docker.com/linux/centos/docker-ce.repo'; }
          if (a[0] === 'install') { const p = a.filter((x) => !x.startsWith('-')).slice(1);
            if (p.includes('containerd.io')) { if (!st.crRepo) return 'Error: Unable to find a match: containerd.io'; st.cr = true; }
            if (p.some((x) => /^kube(let|adm|ctl)$/.test(x))) { if (!/pkgs\.k8s\.io/.test(files['/etc/yum.repos.d/kubernetes.repo'])) return 'Error: Unable to find a match: kubelet kubeadm kubectl'; if (!line.includes('--disableexcludes=kubernetes') && /exclude=/.test(files['/etc/yum.repos.d/kubernetes.repo'])) return 'All matches were filtered out by exclude filtering for argument: kubelet\nError: Unable to find a match (add --disableexcludes=kubernetes)'; st.kube = true; }
            return `Dependencies resolved.\nInstalling:\n${p.map((x) => ' ' + x).join('\n')}\nComplete!`; }
          return '';
        }
        if (c === 'containerd' && a[0] === 'config' && a[1] === 'default') { if (!st.cr) return '-bash: containerd: command not found'; if (/>\s*\/etc\/containerd\/config\.toml/.test(line)) { files['/etc/containerd/config.toml'] = 'version = 2\n[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.runc.options]\n            SystemdCgroup = false\n'; return ''; } return 'version = 2\n...'; }
        if (c === 'systemctl') { if (need()) return need(); const act = a.find((x) => ['enable', 'start', 'restart', 'status'].includes(x)), u = (a.filter((x) => !x.startsWith('-') && x !== act)[0] || '').replace('.service', ''), now = a.includes('--now') || act === 'start' || act === 'restart';
          if (u === 'containerd') { if (!st.cr) return 'Unit containerd.service not found.'; if (now) { st.crOn = true; st.crCfg = /SystemdCgroup\s*=\s*true/.test(files['/etc/containerd/config.toml']); } return act === 'status' ? `Active: ${st.crOn ? 'active (running)' : 'inactive'}` : ''; }
          if (u === 'kubelet') { if (!st.kube) return 'Unit kubelet.service not found.'; st.kubelet = true; return act === 'status' ? `Active: ${st.init ? 'active (running)' : 'activating (auto-restart) – waits for kubeadm init'}` : 'Created symlink /etc/systemd/system/multi-user.target.wants/kubelet.service.'; }
          return `Unit ${u} not found.`; }
        if (c === 'kubeadm' && a[0] === 'init') {
          if (need()) return need();
          const pre = []; if (st.swap) pre.push('[ERROR Swap]: running with swap on is not supported. Please disable swap'); if (!st.sysctl) pre.push('[ERROR FileContent--proc-sys-net-ipv4-ip_forward]: /proc/sys/net/ipv4/ip_forward contents are not set to 1'); if (!st.crOn) pre.push('[ERROR CRI]: container runtime is not running'); if (!st.kube) return '-bash: kubeadm: command not found';
          if (pre.length) return `[init] Using Kubernetes version: v1.29.6\n[preflight] Running pre-flight checks\nerror execution phase preflight: [preflight] Some fatal errors occurred:\n\t${pre.join('\n\t')}`;
          if (!st.crCfg) return '[init] Using Kubernetes version: v1.29.6\n...\n[kubelet-check] The kubelet is not healthy (cgroup driver mismatch).\nerror execution phase wait-control-plane: couldn\'t initialize a Kubernetes cluster\nHint: set SystemdCgroup = true in /etc/containerd/config.toml and restart containerd, then kubeadm reset -f';
          st.init = true; return `[init] Using Kubernetes version: v1.29.6\n[preflight] Running pre-flight checks\n[certs] Generating "ca" certificate and key\n[kubeconfig] Writing "admin.conf" kubeconfig file\n[control-plane] Creating static Pod manifest for "kube-apiserver"\n[mark-control-plane] Marking the node aipron-node as control-plane by adding the taints [node-role.kubernetes.io/control-plane:NoSchedule]\n\nYour Kubernetes control-plane has initialized successfully!\n\nTo start using your cluster, you need to run the following as a regular user:\n\n  mkdir -p $HOME/.kube\n  sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config\n  sudo chown $(id -u):$(id -g) $HOME/.kube/config`;
        }
        if (c === 'kubeadm' && a[0] === 'reset') { st.init = false; st.kcfg = false; st.taint = false; st.cni = false; return '[reset] Are you sure? [y/N]: y\n[reset] Removing info for node "aipron-node"'; }
        if (c === 'mkdir') return '';
        if ((c === 'cp' || c === 'install') && /admin\.conf/.test(line)) { if (!st.init) return 'cp: cannot stat \'/etc/kubernetes/admin.conf\': No such file or directory'; st.kcfg = true; return ''; }
        if (c === 'chown') return '';
        const k8sOff = () => (!st.kcfg ? 'The connection to the server localhost:8080 was refused - did you specify the right host or port?' : null);
        if (c === 'kubectl') {
          if (k8sOff()) return k8sOff();
          if (a[0] === 'taint' && /control-plane-/.test(line)) { st.taint = true; return 'node/aipron-node untainted'; }
          if (a[0] === 'apply' && /calico\.yaml/.test(line)) { st.cni = true; return 'customresourcedefinition.apiextensions.k8s.io/bgpconfigurations.crd.projectcalico.org created\n...\ndaemonset.apps/calico-node created\ndeployment.apps/calico-kube-controllers created'; }
          if (a[0] === 'apply' && /bia-ca-issuer/.test(line)) { if (!st.cm) return 'error: resource mapping not found for kind "ClusterIssuer" – install cert-manager first'; st.issuer = true; return 'clusterissuer.cert-manager.io/bia-ca created'; }
          if (a[0] === 'get' && /^nodes?$/.test(a[1] || '')) return `NAME          STATUS     ROLES           AGE   VERSION\naipron-node   ${st.cni ? 'Ready   ' : 'NotReady'}   control-plane   4m    v1.29.6`;
          if (a[0] === 'get' && /^pods?$/.test(a[1] || '')) {
            if (/aipron/.test(line)) { if (!st.aipron) return 'No resources found in aipron namespace.'; return `NAME                           READY   STATUS             RESTARTS\n${pods().map(([n, r]) => `${n.padEnd(31)}${r}/1     ${r ? 'Running          ' : 'CrashLoopBackOff '} ${r ? 0 : 6}`).join('\n')}`; }
            if (!st.taint && /-A|all-namespaces/.test(line)) return 'NAMESPACE     NAME                                  READY   STATUS\nkube-system   coredns-76f75df574-8xk2p              0/1     Pending\n(pods stay Pending: the only node still has the control-plane taint)';
            return `NAMESPACE       NAME                                READY   STATUS\nkube-system     coredns-76f75df574-8xk2p            ${st.cni && st.taint ? '1/1     Running' : '0/1     Pending'}\nkube-system     calico-node-q7l2n                   ${st.cni ? '1/1     Running' : '-'}\n${st.ingress ? 'ingress-nginx   ingress-nginx-controller-6b9c7      1/1     Running\n' : ''}${st.cm ? 'cert-manager    cert-manager-5d8c9f-tmzq4           1/1     Running\n' : ''}`;
          }
          if (a[0] === 'logs' && /fids/.test(line)) return st.fixed ? 'INFO AIDX 16.1 session established with https://fids.bia.local/aidx\nINFO 214 flights received' : 'INFO starting fids-aidx-adapter 2.10.0\nERROR dial tcp: lookup fids.bia.loacl on 10.96.0.10:53: no such host\nFATAL cannot reach the flight source, exiting';
          if (a[0] === 'get' && /^ing/.test(a[1] || '')) return st.aipron ? `NAME          CLASS   HOSTS                                                                  PORTS\naipron-web    nginx   web.${N.domain},login.${N.domain}                       80, 443\naipron-mon    nginx   grafana.${N.domain},prometheus.${N.domain}            80, 443` : 'No resources found.';
          if (a[0] === 'get' && /^cert/.test(a[1] || '')) return st.aipron && st.issuer ? 'NAME             READY   SECRET           AGE\naipron-web-tls   True    aipron-web-tls   2m\naipron-mon-tls   True    aipron-mon-tls   2m' : 'No resources found.';
          if (a[0] === 'describe') return 'Use kubectl logs for the crashing pod.';
          return '';
        }
        if (c === 'helm') {
          if (k8sOff()) return 'Error: Kubernetes cluster unreachable: Get "http://localhost:8080/version": dial tcp 127.0.0.1:8080: connect: connection refused';
          if (/ingress-nginx/.test(line) && /install/.test(line)) { if (!st.cni || !st.taint) return 'Error: INSTALLATION FAILED: timed out waiting for the condition (pods Pending – check the node is Ready and untainted)'; st.ingress = true; return 'NAME: ingress-nginx\nNAMESPACE: ingress-nginx\nSTATUS: deployed'; }
          if (/cert-manager/.test(line) && /install/.test(line)) { if (!st.cni || !st.taint) return 'Error: INSTALLATION FAILED: timed out waiting for the condition'; if (!/crds\.enabled=true|installCRDs=true/.test(line)) return 'NAME: cert-manager\nSTATUS: deployed\nWARNING: CRDs were not installed – add --set crds.enabled=true'; st.cm = true; return 'NAME: cert-manager\nNAMESPACE: cert-manager\nSTATUS: deployed'; }
          if (/aipron/.test(line) && /(install|upgrade)/.test(line)) {
            if (!/-f\s+(~\/)?values-bia\.yaml/.test(line)) return 'Error: the AiPRON package needs the site values: -f values-bia.yaml';
            if (!st.ingress || !st.issuer) return 'Error: INSTALLATION FAILED: ingress class "nginx" or issuer "bia-ca" not found – install ingress-nginx and apply the BIA CA issuer first';
            if (a[0] === 'install') { if (st.aipron) return 'Error: INSTALLATION FAILED: cannot re-use a name that is still in use (use helm upgrade)'; if (!/-n\s+aipron|--namespace[ =]aipron/.test(line)) return 'Error: install AiPRON into its own namespace: -n aipron --create-namespace'; st.aipron = true; st.fixed = fidsOk(); return `NAME: aipron\nNAMESPACE: aipron\nSTATUS: deployed\nREVISION: 1\nNOTES: open https://web.${N.domain}`; }
            if (!st.aipron) return 'Error: UPGRADE FAILED: "aipron" has no deployed releases'; st.fixed = fidsOk(); return `Release "aipron" has been upgraded. Happy Helming!\nNAME: aipron\nREVISION: 2\nSTATUS: deployed`;
          }
          if (a[0] === 'repo') return '"' + (a[2] || 'repo') + '" has been added to your repositories';
          return '';
        }
        if (c === 'curl') { if (/web\.aipron/.test(line)) return st.aipron && st.issuer ? (st.fixed ? 'HTTP/2 200\ncontent-type: text/html\n<title>AiPRON Manager</title>' : 'HTTP/2 200\n<title>AiPRON Manager</title>\n(the flight interface is down – see the alerts)') : 'curl: (6) Could not resolve host / connection refused'; return ''; }
        return undefined;
      } });
      const upd = VDOBJ($('kO'), [
        { t: 'Swap off now and for good (comment the swap line in /etc/fstab)', ok: () => !st.swap && !/^\/dev\/mapper\/rhel-swap/m.test(files['/etc/fstab']), h: 'sudo swapoff -a, then sudo vi /etc/fstab and put # before the swap line' },
        { t: 'Kernel: br_netfilter loaded, forwarding and bridge filtering on', ok: () => st.sysctl, h: 'sudo modprobe overlay && sudo modprobe br_netfilter; sudo vi /etc/sysctl.d/k8s.conf with net.bridge.bridge-nf-call-iptables = 1, net.bridge.bridge-nf-call-ip6tables = 1, net.ipv4.ip_forward = 1; sudo sysctl --system' },
        { t: 'containerd installed, SystemdCgroup = true, running', ok: () => st.crOn && st.crCfg, h: 'sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo; sudo dnf install -y containerd.io; sudo containerd config default > /etc/containerd/config.toml (use sudo sh -c "…"); sudo vi /etc/containerd/config.toml – SystemdCgroup = true; sudo systemctl enable --now containerd' },
        { t: 'kubelet, kubeadm, kubectl installed from pkgs.k8s.io', ok: () => st.kube && st.kubelet, h: 'sudo vi /etc/yum.repos.d/kubernetes.repo: [kubernetes] name=Kubernetes baseurl=https://pkgs.k8s.io/core:/stable:/v1.29/rpm/ enabled=1 gpgcheck=1 gpgkey=https://pkgs.k8s.io/core:/stable:/v1.29/rpm/repodata/repomd.xml.key exclude=kubelet kubeadm kubectl; then sudo dnf install -y kubelet kubeadm kubectl --disableexcludes=kubernetes; sudo systemctl enable --now kubelet' },
        { t: 'kubeadm init and kubectl configured for admin', ok: () => st.init && st.kcfg, h: 'sudo kubeadm init --pod-network-cidr=192.168.0.0/16, then mkdir -p $HOME/.kube; sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config; sudo chown $(id -u):$(id -g) $HOME/.kube/config' },
        { t: 'Single node: remove the control-plane taint, add the Calico network – node Ready', ok: () => st.taint && st.cni, h: 'kubectl taint nodes --all node-role.kubernetes.io/control-plane- ; kubectl apply -f calico.yaml ; kubectl get nodes' },
        { t: 'ingress-nginx and cert-manager (with CRDs) installed', ok: () => st.ingress && st.cm, h: 'helm upgrade --install ingress-nginx ingress-nginx --repo https://kubernetes.github.io/ingress-nginx -n ingress-nginx --create-namespace ; helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true' },
        { t: 'BIA CA issuer applied', ok: () => st.issuer, h: 'kubectl apply -f bia-ca-issuer.yaml' },
        { t: 'AiPRON installed in namespace aipron with values-bia.yaml', ok: () => st.aipron, h: 'helm install aipron ./aipron-manager -n aipron --create-namespace -f values-bia.yaml' },
        { t: 'Every AiPRON pod Running (find why one crashes, fix the values, upgrade)', ok: () => st.aipron && st.fixed, h: 'kubectl get pods -n aipron; kubectl logs -n aipron <fids pod>; vi values-bia.yaml (look at the fids endpoint spelling); helm upgrade aipron ./aipron-manager -n aipron -f values-bia.yaml' },
      ], done, run);
    };
    run();
  });
})();
