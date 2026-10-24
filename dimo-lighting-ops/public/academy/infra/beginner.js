/* Beginner layer for the Infrastructure course: ⓘ pop-ups on technical words (first mention in every card, task, ticket and question),
   an "In plain words" box at the top of every session, a "Start here – IT basics" guide, and the real Proxmox VE "Create: Virtual Machine"
   wizard (tabs, defaults and an ⓘ on every field) – in the labs and as a coached practice in session 18. Loaded after the course engine. */
(function () {
  // ---------------------------------------------------------------- glossary index and matching
  const G = {}; (window.GLOSS || []).forEach(([k, al, t, x]) => (G[k] = { k, al, t, x }));
  const forms = (a) => { if (/[A-Z]/.test(a.slice(1)) || /^[A-Z0-9./-]+$/.test(a) || /^[a-z]+[A-Z]/.test(a)) return [a]; const cap = a[0].toUpperCase() + a.slice(1); return [...new Set([a, cap, a.toLowerCase()])]; };
  const ALIAS = {}; Object.values(G).forEach((g) => g.al.forEach((a) => forms(a).forEach((f) => { if (!ALIAS[f]) ALIAS[f] = g.k; })));
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const RE = new RegExp(Object.keys(ALIAS).sort((a, b) => b.length - a.length).map((a) => `(?<![\\w\\-./])${reEsc(a)}(?![\\w\\-])`).join('|'), 'g');
  const termsIn = (text) => { const out = []; let m; RE.lastIndex = 0; while ((m = RE.exec(text))) { const k = ALIAS[m[0]]; if (k && !out.includes(k)) out.push(k); } return out; };
  const plainText = (html) => String(html || '').replace(/<(code|pre|kbd)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');

  // ---------------------------------------------------------------- styles
  const css = document.createElement('style');
  css.textContent = `.gl{border-bottom:1px dotted #8fb0d6;white-space:nowrap}.gi{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#e6effa;color:#2563a8;font:700 10px/1 Georgia,serif;font-style:italic;margin:0 1px 0 2px;vertical-align:super;cursor:pointer;border:1px solid #b9cfe8;padding:0;flex-shrink:0}.gi:hover{background:#2563a8;color:#fff}
.gpop{position:fixed;z-index:80;max-width:340px;background:#fff;border:1px solid #c9d6e3;border-radius:10px;box-shadow:0 12px 32px #0003;padding:10px 30px 10px 12px;font-size:13px;line-height:1.45}.gpop b{display:block;margin-bottom:3px;color:#18232b}.gpop .gx{position:absolute;top:4px;right:6px;border:0;background:none;font-size:18px;cursor:pointer;color:#5b6b72}
.plain{background:linear-gradient(180deg,#f2f8ff,#fff);border:1px solid #c9dcf2}.plain .lk{font-size:12.5px;color:#5b6b72;margin-top:4px}.plain .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.plain .chip{border:1px solid #c9dcf2;background:#fff;border-radius:14px;padding:2px 10px;font-size:12.5px;cursor:pointer}.plain .chip:hover{background:#e6effa}
.vmw{border:1px solid #c5c9cc;border-radius:6px;background:#fff;font-size:12.5px}.vmw .vt{display:flex;flex-wrap:wrap;border-bottom:1px solid #d6d9db;background:#f5f6f7}.vmw .vt a{padding:7px 12px;cursor:pointer;color:#333;text-decoration:none;border-bottom:2px solid transparent}.vmw .vt a.on{border-bottom-color:#3892d4;font-weight:700;color:#000;background:#fff}.vmw .vt a.dis{color:#aaa;cursor:default}
.vmw .vb{display:grid;grid-template-columns:1fr 1fr;gap:4px 22px;padding:12px 14px;min-height:250px;align-content:start}@media(max-width:700px){.vmw .vb{grid-template-columns:1fr}}.vmw .wf{display:grid;grid-template-columns:150px 1fr;align-items:center;gap:6px;min-height:30px}.vmw .wf>span{color:#333;display:flex;align-items:center}.vmw .wf input[type=text],.vmw .wf input[type=number],.vmw .wf select{width:100%;padding:4px 6px;border:1px solid #b5b8c8;border-radius:2px;font:inherit;background:#fff}.vmw .wf input:disabled,.vmw .wf select:disabled{background:#f0f0f0;color:#999}.vmw .sec{grid-column:1/-1;font-weight:700;margin-top:6px;border-bottom:1px solid #e3e5e7;padding-bottom:2px}.vmw .note{grid-column:1/-1;font-size:12px;color:#5b6b72}.vmw .err{grid-column:1/-1;color:#c9302c;font-weight:600}
.vmw .vf{display:flex;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid #d6d9db;background:#f5f6f7}.vmw .vf .sp{flex:1}.vmw .vf button{border:1px solid #b5b8c8;background:#fff;border-radius:3px;padding:4px 14px;cursor:pointer;font:inherit}.vmw .vf button.p{background:#3892d4;border-color:#3892d4;color:#fff}.vmw table.cf{grid-column:1/-1;border-collapse:collapse;width:100%}.vmw table.cf td{padding:3px 8px;border-bottom:1px solid #eceeef;font-family:var(--mono);font-size:12px}.vmw table.cf td:first-child{font-family:inherit;color:#555;width:160px}
.coach{border-left:4px solid #e0812b;background:#fffaf4;padding:8px 12px;border-radius:6px;margin:8px 0}.fb li.g::marker{content:'✓  ';color:#1f7a4d}.fb li.b::marker{content:'✗  ';color:#b4232f}.fb li{margin:3px 0}
.start .card svg{max-width:560px;width:100%;height:auto;display:block;margin:6px 0}.start .eg{background:#f6f8f7;border-radius:8px;padding:8px 10px;margin:6px 0}`;
  document.head.appendChild(css);

  // ---------------------------------------------------------------- pop-up
  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; } };
  function openPop(btn, title, text) {
    closePop(); pop = document.createElement('div'); pop.className = 'gpop'; pop.innerHTML = `<b>${esc(title)}</b><div>${esc(text)}</div><button class="gx" aria-label="Close">×</button>`; document.body.appendChild(pop);
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight; let x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left - 20)), y = r.bottom + 6; if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6); pop.style.left = `${x}px`; pop.style.top = `${y}px`;
    pop.querySelector('.gx').onclick = closePop;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.gi, .chip[data-g]');
    if (b) { e.preventDefault(); e.stopPropagation(); const g = G[b.dataset.g]; if (g) openPop(b, g.t, g.x); else openPop(b, b.dataset.gt || '', b.dataset.gx || ''); return; }
    if (pop && !e.target.closest('.gpop')) closePop();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  document.addEventListener('scroll', (e) => { if (pop && !(e.target.closest && e.target.closest('.gpop'))) closePop(); }, true);
  const info = (title, text) => `<button type="button" class="gi" data-gt="${esc(title)}" data-gx="${esc(text)}" aria-label="What is ${esc(title)}?">i</button>`;
  window.infoBtn = info;

  // ---------------------------------------------------------------- annotate the first mention of each term in every block
  const SKIP_TAG = new Set(['CODE', 'PRE', 'KBD', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'A', 'SCRIPT', 'STYLE', 'H2', 'H3', 'H4', 'TH']);
  const SKIP_CLS = ['term', 'gui', 'pve', 'mono', 'gl', 'gpop', 'topo', 'tabs', 'dtabs', 'modal', 'vmw', 'logbox', 'editor', 'chips', 'plain', 'tb', 'why', 'bld'];
  const done = new WeakMap(), MAXPER = 6, PERNODE = 2;
  function glossify(root) {
    if (!root) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => { if (n.nodeType === 1) { if (SKIP_TAG.has(n.tagName) || n.namespaceURI === 'http://www.w3.org/2000/svg' || SKIP_CLS.some((c) => n.classList.contains(c)) || (n.tagName === 'LABEL' && n.closest('.q'))) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_SKIP; } return n.nodeValue.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; } });
    const nodes = []; let n; while ((n = tw.nextNode())) nodes.push(n);
    nodes.forEach((t) => {
      const block = t.parentElement.closest('.card, .q, .tk, .tl, .ticket, .wid') || root; let set = done.get(block); if (!set) done.set(block, (set = new Set()));
      let node = t, here = 0;
      while (node && set.size < MAXPER && here < PERNODE) {
        RE.lastIndex = 0; let m, hit = null; while ((m = RE.exec(node.nodeValue))) { const k = ALIAS[m[0]]; if (k && !set.has(k)) { hit = { m, k }; break; } }
        if (!hit) break;
        set.add(hit.k); here++; const i = hit.m.index, len = hit.m[0].length;
        const after = node.splitText(i); const rest = after.splitText(len);
        const span = document.createElement('span'); span.className = 'gl'; span.textContent = after.nodeValue; const b = document.createElement('button'); b.type = 'button'; b.className = 'gi'; b.dataset.g = hit.k; b.textContent = 'i'; b.setAttribute('aria-label', `What is ${G[hit.k].t}?`); span.appendChild(b);
        after.replaceWith(span); node = rest;
      }
    });
  }
  let tmr = null; const mo = new MutationObserver(() => { if (tmr) return; tmr = setTimeout(() => { tmr = null; const b = document.getElementById('body'); if (b) { glossify(b); mo.takeRecords(); } }, 160); });
  mo.observe(document.getElementById('main'), { childList: true, subtree: true });
  window.glossify = glossify;

  // ---------------------------------------------------------------- "In plain words" for every session
  const PLAIN = {
    s01: ['How to find any network fault calmly, one step at a time, instead of guessing.', 'Like a doctor: ask what is wrong, check the basics first (pulse, temperature), then narrow it down.', ['read a PC\'s network settings', 'use ping, tracert and nslookup', 'write up a fault properly']],
    s02: ['How devices get their address, how addresses are grouped into networks (subnets), and how to plan them.', 'Addresses are like house addresses: the subnet is the street, the last number is the house. Neighbours on the same street talk directly; other streets need the post office (the router).', ['work out a subnet from an address and mask', 'plan addresses for a branch', 'spot a wrong mask or gateway']],
    s03: ['What a switch does, and how one switch can carry several separate networks (VLANs).', 'A switch is the office\'s telephone exchange for cables. VLANs are like separate rooms in one building – people in different rooms cannot hear each other.', ['put a port in the right VLAN', 'build a trunk between switches', 'find which port a PC is on']],
    s04: ['How switches stay up when a cable fails, and how to stop strangers plugging in.', 'Two roads to the same place are good – but traffic must not drive in circles. Spanning tree closes one road until it is needed.', ['read spanning tree', 'bundle links', 'lock ports to known devices']],
    s05: ['How traffic gets from one network to another, and the services every office needs (DHCP, DNS, NAT).', 'The router is the post office between streets and to the outside world.', ['route between VLANs', 'hand out addresses with DHCP', 'share one internet address with NAT']],
    s06: ['How the firewall decides what may pass, and how VPN tunnels join offices and home workers.', 'A firewall is the security guard at the gate with a list of who may go where. A VPN is a private tunnel through a public road.', ['write firewall policies', 'publish a server', 'connect a branch with a VPN']],
    s07: ['How Wi-Fi works and why it is slow or drops out.', 'Wi-Fi is people talking in rooms: too far away, too many voices on the same channel, or walls in between – and nobody understands each other.', ['plan access points', 'choose channels', 'fix weak signal and login problems']],
    s08: ['How to see what the network is doing: monitoring, logs and packet captures – then a graded fault-finding test.', 'Monitoring is the dashboard of a car; a packet capture is the mechanic listening to the engine.', ['read alerts and logs', 'capture and read packets', 'find six faults under time pressure']],
    s09: ['Setting up a Windows Server: roles, services, updates and the event logs.', 'A server is a kitchen that cooks for the whole company; roles are the stations (grill, bakery…).', ['install roles', 'manage services', 'read Event Viewer']],
    s10: ['Active Directory: one place for all users, passwords and computers in the company.', 'AD is the company\'s staff register and key cabinet: one card opens every door you are allowed through.', ['create users and groups', 'join PCs to the domain', 'fix login problems']],
    s11: ['DNS (names → addresses) and DHCP (automatic addresses) on Windows Server.', 'DNS is the phone book, DHCP is the receptionist who hands every newcomer a desk number.', ['manage DNS zones and records', 'run DHCP scopes', 'fix "cannot find server" problems']],
    s12: ['Group Policy (rules pushed to every PC) and file shares with the right permissions.', 'Group Policy is the office handbook every PC must follow; shares are the filing cabinets with locks.', ['create and link GPOs', 'share folders safely', 'fix "access denied"']],
    s13: ['Working on a Linux server: the command line, files, users, packages and services.', 'Linux is driven by typing short commands instead of clicking – once you know a dozen, you can do almost anything.', ['move around the file system', 'install software', 'start and check services']],
    s14: ['Linux storage, networking, firewall, security and logs – keeping a server healthy.', 'Like servicing a car: disks (the tank), network (the wheels), firewall (the locks), logs (the service book).', ['add disks with LVM', 'configure networking', 'read logs and secure SSH']],
    s15: ['PowerShell: making Windows do repetitive jobs automatically.', 'Instead of clicking 200 times to create 50 users, you write the recipe once and let the computer cook.', ['write PowerShell scripts', 'automate AD tasks', 'handle errors safely']],
    s16: ['Bash scripts, scheduled jobs (cron), Ansible and Git – automation on Linux.', 'cron is an alarm clock that runs jobs at night; Ansible is one remote control for many servers; Git is the history book of every change.', ['write a backup script', 'schedule it', 'patch many servers at once']],
    s17: ['Installing a hypervisor (Proxmox) on a real server, so it can run many virtual computers.', 'The server is an empty block of flats; installing the hypervisor builds the foundations, water and power for all the flats (VMs) to come.', ['install Proxmox', 'reach the web UI', 'update it and prepare the network']],
    s18: ['Creating virtual machines and connecting them to the right networks (VLANs).', 'Creating a VM is like furnishing a new flat: choose the size (CPU, memory), the storage room (disk), the phone line (network card and VLAN), then move in (install the OS).', ['create VMs with the Create VM wizard', 'install Ubuntu and Windows in them', 'put VMs in different VLANs']],
    s19: ['Where VM disks live: local disks, a NAS (NFS) or a SAN (iSCSI), and how to grow or move them.', 'Local storage is a cupboard inside one flat; shared storage is a warehouse every building can use.', ['add shared storage', 'move and grow disks', 'fix a full datastore']],
    s20: ['Templates, snapshots and backups – making VMs quickly and getting them back after a mistake.', 'A snapshot is a bookmark; a backup is a photocopy kept in another building; a template is a mould to cast new VMs.', ['make templates and clones', 'take and roll back snapshots', 'back up and restore']],
    s21: ['Clusters and high availability: several hosts working together so VMs survive a failed server.', 'Like a team where a colleague takes over your work when you are ill – but only if the team can agree (quorum).', ['build a cluster', 'migrate VMs', 'set up HA']],
    s22: ['Why VMs are slow, and containers – then a graded VM fault-finding test.', 'Too many flats sharing one water pipe: everyone gets a trickle. Find who uses the most.', ['read CPU, memory and disk load', 'run containers', 'fix five VM faults']],
    s23: ['Build a whole branch office network and server room from a written plan – everything you learned together.', 'Your first full house: from the foundations (network) to the furniture (servers and VMs).', ['plan and build a branch', 'document it', 'hand it over']],
    s25: ['Build a network yourself: unpack servers, PCs, switches, a router and a Proxmox host, cable them port by port, install and configure them – and later add, replace or remove devices.', 'Like setting up a new shop from an empty room: bring in the furniture, connect the electricity and phone lines, then open for customers – and keep a plan of where every cable goes.', ['plan and build an office network', 'install servers and connect VMs to them', 'add, replace and remove devices safely']],
    s24: ['Faults are injected into your branch; fix them, then present your work.', 'The final exam: the house has problems – find and fix them, then show the client round.', ['troubleshoot a full site', 'explain your fixes', 'present clearly']],
  };
  const origConcept = window.renderConcept;
  window.renderConcept = function (body, S) {
    origConcept(body, S);
    const P = PLAIN[S.id]; if (!P) return;
    const words = termsIn(plainText(S.concept.map((c) => `${c.h || ''} ${c.html || ''}`).join(' '))).slice(0, 16);
    body.insertAdjacentHTML('afterbegin', `<div class="card plain"><h3>💡 In plain words</h3><p>${esc(P[0])}</p><p><b>Think of it like this:</b> ${esc(P[1])}</p><p><b>After this session you can:</b> ${P[2].map(esc).join(' · ')}</p>${words.length ? `<div class="lk">Words you will meet – tap any word for a simple explanation. In the text, a small <span class="gi" style="cursor:default">i</span> after a word does the same.</div><div class="chips">${words.map((k) => `<span class="chip" data-g="${k}">${esc(G[k].t.split(' – ')[0].split(' (')[0])}</span>`).join('')}</div>` : ''}<div class="lk">New to IT? Read <a href="#" data-start>Start here – IT basics</a> first.</div></div>`);
    const a = body.querySelector('[data-start]'); if (a) a.onclick = (e) => { e.preventDefault(); openSession('start'); };
  };

  // ---------------------------------------------------------------- Start here – IT basics
  const D = {
    net: `<svg viewBox="0 0 560 150"><rect x="10" y="50" width="70" height="44" rx="6" fill="#e6effa" stroke="#2563a8"/><text x="45" y="77" text-anchor="middle" font-size="12">PC</text><rect x="10" y="100" width="70" height="40" rx="6" fill="#e6effa" stroke="#2563a8"/><text x="45" y="124" text-anchor="middle" font-size="12">Printer</text><rect x="150" y="70" width="90" height="40" rx="6" fill="#eef7f0" stroke="#1f7a4d"/><text x="195" y="94" text-anchor="middle" font-size="12">Switch</text><rect x="300" y="70" width="90" height="40" rx="20" fill="#fdf3dc" stroke="#a86a05"/><text x="345" y="94" text-anchor="middle" font-size="12">Router</text><ellipse cx="480" cy="90" rx="70" ry="38" fill="#f3f5f4" stroke="#5b6b72"/><text x="480" y="95" text-anchor="middle" font-size="12">Internet</text><line x1="80" y1="72" x2="150" y2="86" stroke="#333"/><line x1="80" y1="120" x2="150" y2="98" stroke="#333"/><line x1="240" y1="90" x2="300" y2="90" stroke="#333"/><line x1="390" y1="90" x2="410" y2="90" stroke="#333"/><text x="115" y="40" font-size="11" fill="#5b6b72">cables (or Wi-Fi)</text><text x="300" y="140" font-size="11" fill="#5b6b72">the "way out" = default gateway</text></svg>`,
    ip: `<svg viewBox="0 0 560 90"><text x="10" y="30" font-size="22" font-family="monospace"><tspan fill="#2563a8">10.10.10</tspan>.<tspan fill="#e0812b">34</tspan></text><text x="10" y="56" font-size="12" fill="#2563a8">street (network) – same for all neighbours</text><text x="230" y="30" font-size="12" fill="#e0812b">← house number (this PC)</text><text x="10" y="82" font-size="12" fill="#5b6b72">mask 255.255.255.0 (= /24) says: the first three numbers are the street</text></svg>`,
    vlan: `<svg viewBox="0 0 560 120"><rect x="10" y="10" width="540" height="100" rx="10" fill="#fbfcfc" stroke="#999"/><text x="20" y="28" font-size="12" fill="#5b6b72">one switch …</text><rect x="30" y="38" width="150" height="62" rx="8" fill="#e6effa" stroke="#2563a8"/><text x="105" y="74" text-anchor="middle" font-size="12">VLAN 10 – Staff</text><rect x="205" y="38" width="150" height="62" rx="8" fill="#eef7f0" stroke="#1f7a4d"/><text x="280" y="74" text-anchor="middle" font-size="12">VLAN 20 – Servers</text><rect x="380" y="38" width="150" height="62" rx="8" fill="#fdf3dc" stroke="#a86a05"/><text x="455" y="74" text-anchor="middle" font-size="12">VLAN 99 – Management</text></svg>`,
    vm: `<svg viewBox="0 0 560 170"><rect x="10" y="130" width="540" height="32" rx="6" fill="#d5dddb"/><text x="280" y="151" text-anchor="middle" font-size="12">Real server: CPU cores · memory · disks · network ports</text><rect x="10" y="98" width="540" height="28" rx="6" fill="#fdf3dc" stroke="#a86a05"/><text x="280" y="117" text-anchor="middle" font-size="12">Hypervisor (Proxmox) – shares the hardware out</text>${[0, 1, 2, 3].map((i) => `<rect x="${14 + i * 136}" y="10" width="128" height="82" rx="8" fill="#e6effa" stroke="#2563a8"/><text x="${78 + i * 136}" y="32" text-anchor="middle" font-size="12" font-weight="700">VM ${101 + i}</text><text x="${78 + i * 136}" y="52" text-anchor="middle" font-size="11">${['Ubuntu web01', 'Ubuntu jump01', 'Windows print01', 'Rocky db01'][i]}</text><text x="${78 + i * 136}" y="72" text-anchor="middle" font-size="10" fill="#5b6b72">2 cores · 4 GiB · 32 GiB</text>`).join('')}</svg>`,
  };
  const START = [
    ['How to use this course', `<p>Every session has four tabs: <b>1 · Concept</b> (read and try the small diagrams), <b>2 · Virtual lab</b> (a pretend office network you can really configure), <b>3 · Break &amp; fix</b> (user complaints to solve) and <b>4 · Review</b> (a short quiz).</p><p>When you see a word you do not know, tap the small <span class="gi" style="cursor:default">i</span> next to it – a short explanation opens. Each session starts with an <b>In plain words</b> box.</p><p><b>In the lab:</b> click a device on the drawing (a PC, switch, server). Its screens open on the right: a <b>console</b> to type commands, or windows that look like the real program. Type <kbd>help</kbd> in any console. Use ↑ to repeat a command and <kbd>Tab</kbd> to complete it. You cannot break anything for real – <b>Reset</b> starts the lab again.</p>`],
    ['1 · What is a network?', `<p>A network is computers joined together so they can send each other data. In an office, PCs and printers plug into a <b>switch</b> with cables (or connect by Wi-Fi). The switch joins everything in the building. A <b>router</b> connects the office to other networks – other branches and the internet.</p>${D.net}<p class="eg">Think of a town: houses (devices), streets (cables), a crossroads (switch) and the post office that sends letters to other towns (router).</p>`],
    ['2 · Addresses: IP, subnet mask, gateway', `<p>Every device needs an <b>IP address</b> so data can be delivered to it – like a house address. It is four numbers 0–255, e.g. <code>10.10.10.34</code>.</p>${D.ip}<p>The <b>subnet mask</b> says which part is the street. Devices on the same street (subnet) talk directly. To reach another street they send the data to the <b>default gateway</b> – the router of their street.</p><p class="eg">Three settings must be right on every device: <b>IP address</b>, <b>mask</b>, <b>gateway</b>. Most "no network" problems are one of these.</p>`],
    ['3 · Names and automatic addresses: DNS and DHCP', `<p>People use names (<code>intranet.dimo.lk</code>), computers use numbers. <b>DNS</b> is the phone book that turns a name into an IP address.</p><p>Typing addresses into hundreds of PCs by hand is slow and error-prone. <b>DHCP</b> is a service that gives every device its address, mask, gateway and DNS automatically when it switches on.</p><p class="eg">If a PC shows an address starting with <code>169.254</code>, it asked DHCP and got no answer.</p>`],
    ['4 · Switches, VLANs and routers', `<p>One switch can be split into separate networks called <b>VLANs</b> – like separate rooms in one building. Staff, servers and management are kept apart for safety. Each VLAN is its own subnet.</p>${D.vlan}<p>A cable that carries several VLANs between switches is a <b>trunk</b>. Traffic between VLANs must go through a <b>router</b> (or a firewall), where rules decide what is allowed.</p>`],
    ['5 · Servers, services and ports', `<p>A <b>server</b> is a computer that does a job for many users: web pages, files, logins, email. Each job is a <b>service</b> – a program that waits for requests.</p><p>Services listen on numbered <b>ports</b>, like doors of a building: web 80/443, SSH 22, Remote Desktop 3389, DNS 53. A <b>firewall</b> decides which doors may be used, by whom.</p><p class="eg">"Ping works but the website does not open" = the building is there, but that door is closed (service stopped or firewall).</p>`],
    ['6 · Windows Server, Active Directory and Linux', `<p>Companies run <b>Windows Server</b> for logins and files, and <b>Linux</b> (Ubuntu, Rocky) for web servers and tools.</p><ul><li><b>Active Directory</b> keeps every user, password and computer in one place: one login works everywhere.</li><li>On Linux you mostly <b>type commands</b>: <code>ip a</code> (my address), <code>systemctl status nginx</code> (is the web server running?), <code>sudo apt install …</code> (install software).</li></ul>`],
    ['7 · Virtualisation: many computers in one', `<p>A modern server is very powerful – too powerful for one job. A <b>hypervisor</b> (here Proxmox) is installed on it and shares its CPU, memory, disks and network out to many <b>virtual machines</b> (VMs). Each VM behaves exactly like a separate computer, with its own operating system.</p>${D.vm}<p class="eg">Like a block of flats: one building (the server), many separate homes (VMs) that share the foundations, water and power.</p><p><b>Creating a VM</b> means choosing its size and connections, then installing the operating system from an <b>ISO</b> (a DVD image) – in this course with the same <b>Create VM</b> wizard as the real Proxmox. Session 18 lets you practise it step by step.</p>`],
    ['8 · Storage and backups', `<p>VM disks live on <b>storage</b>: the server's own disks, or a shared storage server (NAS or SAN) that several servers can use.</p><ul><li>A <b>snapshot</b> is a save point you can go back to – but it is on the same storage, so it is not a backup.</li><li>A <b>backup</b> is a copy kept somewhere else. Only a backup you have test-restored is a real backup.</li></ul>`],
    ['9 · How to fix a fault', `<ol><li><b>Ask</b>: who is affected, since when, what changed?</li><li><b>Reproduce</b> it yourself.</li><li><b>Check from the bottom up</b>: cable and link → address → can I reach the gateway → can I reach the server → name (DNS) → the service itself.</li><li><b>Fix the cause</b>, not the symptom, and <b>prove</b> it works.</li><li><b>Write it up</b>: symptom, cause, fix, how to stop it happening again.</li></ol><p>Ready? Start with <a href="#" data-s1>Session 1 – Troubleshooting method</a>.</p>`],
  ];
  const startHtml = () => `<div class="head"><div class="eb"><button class="btn sm menu-btn" id="menuBtn">☰ Sessions</button> Start here</div><h2>IT basics for beginners</h2><div class="meta">Read this first if networks, servers or virtual machines are new to you – about 20 minutes</div></div><div class="body start" id="body">${START.map(([h, b]) => `<div class="card"><h3>${esc(h)}</h3>${b}</div>`).join('')}</div>`;
  const origMain = window.renderMain;
  window.renderMain = function () {
    if (APP.sid !== 'start') return origMain();
    const m = document.getElementById('main'); m.innerHTML = startHtml();
    const mb = document.getElementById('menuBtn'); if (mb) mb.onclick = () => document.getElementById('side').classList.add('open');
    const a = m.querySelector('[data-s1]'); if (a) a.onclick = (e) => { e.preventDefault(); openSession('s01'); };
  };
  const origSide = window.renderSide;
  window.renderSide = function () {
    origSide();
    const side = document.getElementById('side'), bar = side.querySelector('.bar'); if (!bar) return;
    bar.insertAdjacentHTML('afterend', `<div class="mod"><b>New to IT?</b><div class="ses ${APP.sid === 'start' ? 'on' : ''}" data-st="1"><span class="n">★</span><span>Start here – IT basics</span></div></div>`);
    side.querySelector('[data-st]').onclick = () => { side.classList.remove('open'); openSession('start'); };
  };

  // ---------------------------------------------------------------- the real "Create: Virtual Machine" wizard (Proxmox VE 8)
  const TABS = ['General', 'OS', 'System', 'Disks', 'CPU', 'Memory', 'Network', 'Confirm'];
  const OSV = { Linux: [['l26', '6.x - 2.6 Kernel'], ['l24', '2.4 Kernel']], 'Microsoft Windows': [['win11', '11/2022/2025'], ['win10', '10/2016/2019'], ['win8', '8.x/2012/2012r2'], ['win7', '7/2008r2']], 'Solaris Kernel': [['solaris', '-']], Other: [['other', '-']] };
  const I = {
    node: ['Node', 'The physical Proxmox server the VM will run on. In a cluster you can choose; with one server there is only one.'],
    vmid: ['VM ID', 'A unique number for the VM (100, 101, 102 …). Proxmox suggests the next free one. Many teams use ranges, e.g. 100–199 for servers.'],
    name: ['Name', 'The VM\'s name in Proxmox, normally the same as its computer name (web01). Letters, numbers, dots and dashes only – no spaces.'],
    pool: ['Resource Pool', 'An optional folder to group VMs and give permissions to a team. Leave empty in this course.'],
    onboot: ['Start at boot', 'Start this VM automatically when the host starts (after a power cut or an update reboot). Turn it on for real servers.'],
    media: ['Installation media', 'Where the operating system is installed from: an ISO file on the host\'s storage (normal), a real DVD drive, or nothing (e.g. when you will import a disk).'],
    iso: ['ISO image', 'The installation DVD as a file. Ubuntu Server, Rocky Linux or the Windows Server evaluation ISO are already uploaded to the "local" storage.'],
    ostype: ['Guest OS type', 'Tell Proxmox which operating system will run, so it picks matching defaults (e.g. Windows gets a different clock and driver settings).'],
    osver: ['Version', 'For Linux choose 6.x – 2.6 Kernel (all current Linux). For Windows Server 2022/2025 choose 11/2022/2025.'],
    virtio: ['Add additional drive for VirtIO drivers', 'Windows has no built-in drivers for the fast VirtIO disk and network. This adds a second CD with virtio-win.iso so you can click "Load driver" during Windows Setup. Without it Windows Setup finds no disk.'],
    gfx: ['Graphic card', 'The VM\'s screen. Default is fine – you see it in the browser console (noVNC).'],
    machine: ['Machine', 'The emulated mainboard. Default (i440fx) is fine for Linux and Windows Server; q35 is newer and needed for some PCIe pass-through.'],
    bios: ['Firmware (BIOS)', 'SeaBIOS = classic BIOS, works for almost everything. OVMF = UEFI, needed for Secure Boot and Windows 11; it also needs a small EFI disk.'],
    efi: ['EFI disk', 'A tiny disk where UEFI keeps its settings. Only needed with OVMF (UEFI).'],
    scsihw: ['SCSI Controller', 'The virtual disk controller. VirtIO SCSI single is the fastest and the default – Linux has the driver built in, Windows needs the VirtIO driver CD.'],
    agent: ['Qemu Agent', 'Tick it, then install qemu-guest-agent inside the VM. Proxmox can then show the VM\'s IP address, shut it down cleanly and take consistent backups. It is NOT ticked by default – a common mistake.'],
    tpm: ['Add TPM', 'A virtual security chip. Required by Windows 11, not needed for Windows Server 2022 or Linux.'],
    bus: ['Bus/Device', 'How the disk is attached. SCSI (with the VirtIO SCSI controller) is the fastest and supports trim and IO threads. IDE and SATA are slow, for very old systems only.'],
    store: ['Storage', 'Where the virtual disk file lives. local-lvm is the host\'s fast NVMe disk. "local" is only for ISOs and backups, not for VM disks.'],
    size: ['Disk size (GiB)', 'How big the VM\'s disk is. Ubuntu server: 16–32 GiB; Windows Server: 60 GiB or more. It can be made bigger later, not smaller.'],
    cache: ['Cache', 'Leave at Default (No cache) – safest for your data. Write-back caching is faster but data can be lost in a power cut.'],
    discard: ['Discard', 'Lets the guest tell the storage which blocks are free again (trim). On thin storage like local-lvm this gives space back – tick it.'],
    iothread: ['IO thread', 'Gives the disk its own worker thread – better speed. On by default with VirtIO SCSI single.'],
    ssd: ['SSD emulation', 'Tells the guest the disk is an SSD. Optional.'],
    sockets: ['Sockets', 'How many CPU sockets the VM sees. Leave 1 and change Cores instead (licences for some software count sockets).'],
    cores: ['Cores', 'How many CPU cores the VM may use. Small servers: 1–2, busy servers: 4 or more. Too many cores can make a VM slower on a busy host.'],
    cputype: ['CPU Type', 'x86-64-v2-AES (the default) works on any modern host, so the VM can move (migrate) between different servers. "host" is a bit faster but ties the VM to identical CPUs.'],
    mem: ['Memory (MiB)', 'RAM for the VM in MiB: 2048 = 2 GiB, 4096 = 4 GiB. Ubuntu server: 2–4 GiB; Windows Server: at least 4 GiB.'],
    minmem: ['Minimum memory (MiB)', 'With ballooning the host can take memory back from this VM down to this amount when the host is short of memory.'],
    balloon: ['Ballooning Device', 'Lets the host and the VM share out memory flexibly. Keep it on.'],
    nonet: ['No network device', 'A VM without any network – only for special cases. Leave it unticked.'],
    bridge: ['Bridge', 'The virtual switch on the host the VM\'s network card plugs into. vmbr0 is connected to the real network through the host\'s network port.'],
    vtag: ['VLAN Tag', 'Which VLAN the VM is in: 20 = servers, 10 = staff. Leave EMPTY for the trunk\'s native (untagged) VLAN – here the management VLAN 99.'],
    model: ['Model', 'The virtual network card. VirtIO (paravirtualized) is the fastest. Intel E1000 works without drivers but is slower – use it only if the guest has no VirtIO driver.'],
    fw: ['Firewall', 'Enables the Proxmox firewall for this network card (it only filters when firewall rules are switched on). Default: ticked.'],
    mac: ['MAC address', 'The virtual network card\'s hardware address. Leave "auto" – Proxmox generates a unique one.'],
    linkdown: ['Disconnect', 'Pulls the virtual cable out. The VM then has no network at all – only for tests.'],
    start: ['Start after created', 'Starts the VM straight away, so you can open its Console and install the operating system.'],
  };
  const wf = (k, inner) => `<div class="wf"><span>${esc(I[k][0])}:${info(I[k][0], I[k][1])}</span>${inner}</div>`;
  const sel = (key, opts, v, dis) => `<select data-k="${key}" ${dis ? 'disabled' : ''}>${opts.map((o) => { const [val, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(t)}</option>`; }).join('')}</select>`;
  const inp = (key, v, type = 'text', dis) => `<input type="${type}" data-k="${key}" value="${esc(v)}" ${dis ? 'disabled' : ''}>`;
  const chk = (key, v, dis) => `<input type="checkbox" data-k="${key}" ${v ? 'checked' : ''} ${dis ? 'disabled' : ''} style="justify-self:start">`;
  /** cfg: { nodes:[names], node, isos:[], stores:[{id, free}], bridges:[], nextId, used:Set, onFinish(o) → error or null, coach } */
  function vmWizard(el, cfg) {
    const isos = cfg.isos.filter((i) => !/virtio/i.test(i)), virtioIso = cfg.isos.find((i) => /virtio/i.test(i)) || 'virtio-win.iso';
    const st = { tab: 0, adv: false, err: '', o: { node: cfg.node || cfg.nodes[0], vmid: cfg.nextId, name: '', pool: '', onboot: false, media: 'iso', isostore: 'local', iso: isos[0], ostype: 'Linux', osver: 'l26', virtio: false, gfx: 'default', machine: 'i440fx', bios: 'seabios', efi: true, efistore: cfg.stores[0]?.id, scsihw: 'virtio-scsi-single', agent: false, tpm: false, bus: 'scsi', busn: 0, store: cfg.stores[0]?.id, size: 32, cache: 'none', discard: false, iothread: true, ssd: false, sockets: 1, cores: 1, cputype: 'x86-64-v2-AES', mem: 2048, minmem: 2048, balloon: true, nonet: false, bridge: cfg.bridges[0], vtag: '', model: 'virtio', fw: true, mac: 'auto', linkdown: false, start: false } };
    const o = st.o, win = () => o.ostype === 'Microsoft Windows';
    const check = (t) => {
      if (t === 0) { if (!o.name) return 'Name: this field is required'; if (!/^[a-z0-9][a-z0-9.-]*$/i.test(o.name)) return 'Name: only letters, digits, dot and dash – no spaces'; if (!(+o.vmid >= 100)) return 'VM ID: must be 100 or more'; if (cfg.used && cfg.used.has(+o.vmid)) return `VM ID ${o.vmid} is already in use`; }
      if (t === 3) { const s = cfg.stores.find((x) => x.id === o.store); if (!(+o.size >= 1)) return 'Disk size: at least 1 GiB'; if (s && s.free != null && +o.size > s.free) return `Not enough space on ${o.store}: ${Math.floor(s.free)} GiB free`; }
      if (t === 4 && !(+o.cores >= 1 && +o.sockets >= 1)) return 'Cores and sockets must be at least 1';
      if (t === 5 && !(+o.mem >= 16)) return 'Memory: at least 16 MiB';
      if (t === 6 && !o.nonet && o.vtag !== '' && !(+o.vtag >= 1 && +o.vtag <= 4094)) return 'VLAN Tag: 1–4094, or empty for no VLAN';
      return '';
    };
    const summary = () => {
      const rows = [['cores', `${o.cores}`], ['sockets', `${o.sockets}`], ['cpu', o.cputype], ['memory', `${o.mem}`], ...(o.balloon && +o.minmem !== +o.mem ? [['balloon', `${o.minmem}`]] : o.balloon ? [] : [['balloon', '0']]), ['name', o.name], ['nodename', o.node], ['vmid', `${o.vmid}`], ['ostype', o.osver], ['scsihw', o.scsihw], ...(o.agent ? [['agent', '1']] : []), ...(o.bios === 'ovmf' ? [['bios', 'ovmf'], ['efidisk0', `${o.efistore}:1,efitype=4m,pre-enrolled-keys=1`]] : []), ...(o.machine !== 'i440fx' ? [['machine', o.machine]] : []), ...(o.tpm ? [['tpmstate0', `${o.efistore}:1,version=v2.0`]] : []), [`${o.bus}${o.busn}`, `${o.store}:${o.size}${o.iothread && o.bus === 'scsi' ? ',iothread=on' : ''}${o.discard ? ',discard=on' : ''}${o.ssd ? ',ssd=1' : ''}`], ['ide2', o.media === 'iso' ? `${o.isostore}:iso/${o.iso},media=cdrom` : o.media === 'cdrom' ? 'cdrom,media=cdrom' : 'none,media=cdrom'], ...(win() && o.virtio ? [['ide0', `local:iso/${virtioIso},media=cdrom`]] : []), ...(o.nonet ? [] : [['net0', `${o.model},bridge=${o.bridge}${o.vtag ? `,tag=${o.vtag}` : ''}${o.fw ? ',firewall=1' : ''}${o.linkdown ? ',link_down=1' : ''}`]]), ...(o.onboot ? [['onboot', '1']] : [])];
      return `<table class="cf"><tr><td><b>Key</b></td><td><b>Value</b></td></tr>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
    };
    const warns = () => [win() && o.scsihw.startsWith('virtio') && o.bus === 'scsi' && !o.virtio ? '⚠ Windows with a VirtIO SCSI disk but no VirtIO driver CD: Windows Setup will say "We couldn\'t find any drives".' : '', win() && o.model === 'virtio' && !o.virtio ? '⚠ Windows with a VirtIO network card needs the VirtIO drivers too.' : '', !o.agent ? 'ℹ Qemu Agent is not ticked – Proxmox will not see the VM\'s IP address and cannot freeze it for backups.' : '', o.bus !== 'scsi' ? 'ℹ IDE/SATA/VirtIO Block chosen – SCSI with VirtIO SCSI single is faster and the usual choice.' : ''].filter(Boolean);
    function draw() {
      const t = st.tab; let b = '';
      if (t === 0) b = wf('node', sel('node', cfg.nodes, o.node)) + wf('vmid', inp('vmid', o.vmid, 'number')) + wf('name', inp('name', o.name)) + wf('pool', sel('pool', [['', '']], o.pool)) + (st.adv ? wf('onboot', chk('onboot', o.onboot)) : '');
      if (t === 1) b = `<div class="wf" style="grid-column:1/-1;grid-template-columns:150px 1fr"><span>${esc(I.media[0])}:${info(I.media[0], I.media[1])}</span><span style="display:flex;gap:14px;flex-wrap:wrap"><label><input type="radio" name="vmmedia" data-k="media" value="iso" ${o.media === 'iso' ? 'checked' : ''}> Use CD/DVD disc image file (iso)</label><label><input type="radio" name="vmmedia" data-k="media" value="cdrom" ${o.media === 'cdrom' ? 'checked' : ''}> Use physical CD/DVD Drive</label><label><input type="radio" name="vmmedia" data-k="media" value="none" ${o.media === 'none' ? 'checked' : ''}> Do not use any media</label></span></div>` + wf('iso', `<span style="display:grid;grid-template-columns:90px 1fr;gap:4px">${sel('isostore', ['local'], o.isostore, o.media !== 'iso')}${sel('iso', isos, o.iso, o.media !== 'iso')}</span>`) + `<div class="sec">Guest OS</div>` + wf('ostype', sel('ostype', Object.keys(OSV), o.ostype)) + wf('osver', sel('osver', OSV[o.ostype], o.osver)) + (win() ? wf('virtio', chk('virtio', o.virtio)) + (o.virtio ? `<div class="note">Storage: local · ISO image: ${esc(virtioIso)}</div>` : '') : '');
      if (t === 2) b = wf('gfx', sel('gfx', [['default', 'Default'], ['std', 'Standard VGA'], ['qxl', 'SPICE']], o.gfx)) + wf('scsihw', sel('scsihw', [['virtio-scsi-single', 'VirtIO SCSI single'], ['virtio-scsi-pci', 'VirtIO SCSI'], ['lsi', 'LSI 53C895A'], ['pvscsi', 'VMware PVSCSI']], o.scsihw)) + wf('machine', sel('machine', [['i440fx', 'Default (i440fx)'], ['q35', 'q35']], o.machine)) + wf('agent', chk('agent', o.agent)) + wf('bios', sel('bios', [['seabios', 'Default (SeaBIOS)'], ['ovmf', 'OVMF (UEFI)']], o.bios)) + wf('tpm', chk('tpm', o.tpm)) + (o.bios === 'ovmf' ? wf('efi', `<span style="display:grid;grid-template-columns:auto 1fr;gap:6px;align-items:center">${chk('efi', o.efi)}${sel('efistore', cfg.stores.map((s) => s.id), o.efistore, !o.efi)}</span>`) : '');
      if (t === 3) { const s = cfg.stores.find((x) => x.id === o.store); b = wf('bus', `<span style="display:grid;grid-template-columns:1fr 60px;gap:4px">${sel('bus', [['ide', 'IDE'], ['sata', 'SATA'], ['scsi', 'SCSI'], ['virtio', 'VirtIO Block']], o.bus)}${inp('busn', o.busn, 'number')}</span>`) + wf('cache', sel('cache', [['none', 'Default (No cache)'], ['writethrough', 'Write through'], ['writeback', 'Write back'], ['unsafe', 'Write back (unsafe)']], o.cache)) + wf('store', sel('store', cfg.stores.map((x) => [x.id, `${x.id}${x.free != null ? ` (free ${Math.floor(x.free)} GiB)` : ''}`]), o.store)) + wf('discard', chk('discard', o.discard)) + wf('size', inp('size', o.size, 'number')) + wf('iothread', chk('iothread', o.iothread, o.bus !== 'scsi' && o.bus !== 'virtio')) + `<div class="wf"><span>Format:</span><select disabled><option>Raw disk image (raw)</option></select></div>` + (st.adv ? wf('ssd', chk('ssd', o.ssd)) : '') + (s && s.free != null ? `<div class="note">${esc(o.store)}: ${Math.floor(s.free)} GiB free</div>` : ''); }
      if (t === 4) b = wf('sockets', inp('sockets', o.sockets, 'number')) + wf('cputype', sel('cputype', [['x86-64-v2-AES', 'Default (x86-64-v2-AES)'], ['host', 'host'], ['kvm64', 'kvm64'], ['x86-64-v3', 'x86-64-v3']], o.cputype)) + wf('cores', inp('cores', o.cores, 'number')) + `<div class="wf"><span>Total cores:</span><span>${(+o.sockets || 0) * (+o.cores || 0)}</span></div>`;
      if (t === 5) b = wf('mem', inp('mem', o.mem, 'number')) + (st.adv ? wf('minmem', inp('minmem', o.minmem, 'number', !o.balloon)) + wf('balloon', chk('balloon', o.balloon)) : '');
      if (t === 6) b = `<div class="wf" style="grid-column:1/-1"><span>${esc(I.nonet[0])}:${info(I.nonet[0], I.nonet[1])}</span>${chk('nonet', o.nonet)}</div>` + wf('bridge', sel('bridge', cfg.bridges, o.bridge, o.nonet)) + wf('model', sel('model', [['virtio', 'VirtIO (paravirtualized)'], ['e1000', 'Intel E1000'], ['rtl8139', 'Realtek RTL8139'], ['vmxnet3', 'VMware vmxnet3']], o.model, o.nonet)) + wf('vtag', `<input type="text" data-k="vtag" value="${esc(o.vtag)}" placeholder="no VLAN" ${o.nonet ? 'disabled' : ''}>`) + wf('mac', inp('mac', o.mac, 'text', o.nonet)) + wf('fw', chk('fw', o.fw, o.nonet)) + (st.adv ? wf('linkdown', chk('linkdown', o.linkdown, o.nonet)) : '');
      if (t === 7) b = summary() + `<div class="wf" style="grid-column:1/-1;grid-template-columns:auto 1fr;margin-top:6px">${chk('start', o.start)}<span>${esc(I.start[0])}${info(I.start[0], I.start[1])}</span></div>` + warns().map((w) => `<div class="note">${esc(w)}</div>`).join('');
      el.innerHTML = `<div class="vmw">${cfg.coach ? `<div class="coach" style="margin:8px">${cfg.coach}</div>` : ''}<div class="vt">${TABS.map((x, i) => `<a data-t="${i}" class="${i === t ? 'on' : ''}">${x}</a>`).join('')}</div><div class="vb">${b}${st.err ? `<div class="err">${esc(st.err)}</div>` : ''}</div><div class="vf"><button data-h>Help</button><span class="sp"></span><label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-adv ${st.adv ? 'checked' : ''}> Advanced</label><button data-b ${t === 0 ? 'disabled' : ''}>Back</button><button class="p" data-n>${t === 7 ? 'Finish' : 'Next'}</button></div></div>`;
      el.querySelectorAll('[data-k]').forEach((n) => { const k = n.dataset.k; const upd = () => { o[k] = n.type === 'checkbox' ? n.checked : n.type === 'radio' ? (n.checked ? n.value : o[k]) : n.value; if (k === 'ostype') { o.osver = OSV[o.ostype][0][0]; if (win()) { o.size = Math.max(+o.size, 32); } } if (k === 'mem' && !st.adv) o.minmem = o.mem; if (['ostype', 'media', 'bios', 'bus', 'nonet', 'balloon', 'virtio', 'efi', 'store', 'cores', 'sockets'].includes(k)) draw(); }; n.addEventListener('change', upd); if (n.tagName === 'INPUT' && n.type !== 'checkbox' && n.type !== 'radio') n.addEventListener('input', () => { o[k] = n.value; }); });
      el.querySelector('[data-adv]').onchange = (e) => { st.adv = e.target.checked; draw(); };
      el.querySelector('[data-h]').onclick = (e) => openPop(e.target, 'Create VM – how it works', 'Go through the tabs from left to right. Every field has a small i – tap it to see what it means and what to choose. Defaults are right for most servers, except: tick Qemu Agent, give enough cores and memory, choose the VLAN tag, and for Windows add the VirtIO driver CD.');
      el.querySelectorAll('[data-t]').forEach((a) => (a.onclick = () => { const to = +a.dataset.t; if (to > t) { for (let i = t; i < to; i++) { const e = check(i); if (e) { st.err = e; st.tab = i; draw(); return; } } } st.err = ''; st.tab = to; draw(); }));
      el.querySelector('[data-b]').onclick = () => { st.err = ''; st.tab = Math.max(0, t - 1); draw(); };
      el.querySelector('[data-n]').onclick = () => { const e = check(t); if (e) { st.err = e; draw(); return; } st.err = ''; if (t < 7) { st.tab++; draw(); return; } const r = cfg.onFinish({ ...o, virtioIso }); if (r) { st.err = r; draw(); } };
    }
    draw();
    return st;
  }
  window.vmWizard = vmWizard;

  // in the labs: replace the flat form with the wizard
  window.pveCreateWizard = function (ctx, H) {
    const { L } = ctx; const H0 = H;
    const stores = Object.keys(L.pve.stores).filter((s) => (L.pve.stores[s].content || []).includes('images')).map((id) => { let free = null; try { const u = storeUse(L, H0, id); if (u.size) free = Math.max(0, u.size - u.used); } catch (e) { free = null; } return { id, free }; });
    const m = modal('Create: Virtual Machine', '<div id="vmwiz"></div>', [{ t: 'Cancel' }], { w: 900 });
    vmWizard(m.querySelector('#vmwiz'), { nodes: ctx.nodes.map((n) => n.hostname), node: H.hostname, isos: H.pve.isos, stores, bridges: Object.keys(H.bridges), nextId: pveNextId(L), used: new Set(pveVms(L).map((V) => +V.vm.vmid)), onFinish: (o) => {
      const N = nodeByName(L, o.node) || H; let err = null;
      pveAct(L, N, `VM ${o.vmid} - Create`, () => {
        const r = pveCreate(L, N, { vmid: +o.vmid, name: o.name, iso: o.media === 'iso' ? o.iso : null, ostype: o.ostype === 'Microsoft Windows' ? 'windows' : 'linux', virtio: o.ostype === 'Microsoft Windows' && o.virtio, agent: o.agent ? 1 : 0, bus: `${o.bus}${+o.busn || 0}`, store: o.store, size: +o.size, cores: +o.cores, cpu: o.cputype, mem: +o.mem, balloon: o.balloon ? +o.minmem : 0, bridge: o.bridge, tag: o.vtag || null, model: o.model, scsihw: o.scsihw });
        if (r.err) { err = r.err; return r.err; }
        const V = r.d; const busy = (x, y) => Object.values(L.devs).some((d) => d !== V && d.x != null && Math.abs(d.x - x) < 70 && Math.abs(d.y - y) < 40); if (busy(V.x, V.y)) { outer: for (let ry = 0; ry < 4; ry++) for (let rx = -3; rx <= 4; rx++) { const x = N.x + rx * 80, y = N.y + 70 + ry * 50; if (!busy(x, y)) { V.x = x; V.y = y; break outer; } } }
        Object.assign(V.vm, { sockets: +o.sockets || 1, ostype: o.osver, bios: o.bios, machine: o.machine, cache: o.cache, discard: !!o.discard, iothread: !!o.iothread, ssd: !!o.ssd, onboot: o.onboot ? 1 : 0, ...(o.bios === 'ovmf' && o.efi ? { efidisk: o.efistore } : {}), ...(o.tpm ? { tpm: o.efistore } : {}) });
        const nic = Object.values(V.nics)[0]; if (nic) { nic.fw = !!o.fw; if (o.linkdown) nic.up = false; if (o.nonet) nic.up = false; }
        if (o.media === 'none') { V.setup = false; V.lxsetup = false; }
        ctx.st.sel = `vm:${o.vmid}`; return o.start ? vmStart(L, V) : null;
      }, ctx.done, ctx.redraw);
      if (err) return err;
      m.remove(); return null;
    } });
  };

  // ---------------------------------------------------------------- session 18: coached practice of the wizard
  const MISSIONS = {
    web01: { title: 'web01 – Ubuntu web server in the server VLAN', brief: 'Create <b>VM 101 web01</b> for the intranet: Ubuntu Server, 2 cores, 4 GiB memory, a 32 GiB disk on the fast local storage, in the <b>server VLAN 20</b>, ready for clean backups.', rules: (o) => [
      [o.name === 'web01' && +o.vmid === 101, 'General: VM ID 101, name web01', 'Name and ID identify the VM everywhere (backups, monitoring, the shell: qm start 101).'],
      [o.media === 'iso' && /ubuntu/i.test(o.iso), 'OS: the Ubuntu Server ISO', 'The VM boots the installer from this ISO the first time it starts.'],
      [o.ostype === 'Linux' && o.osver === 'l26', 'OS: type Linux, version 6.x – 2.6 Kernel', 'Matching defaults for a modern Linux guest.'],
      [o.scsihw === 'virtio-scsi-single', 'System: SCSI controller VirtIO SCSI single', 'Fastest controller; Linux has the driver built in.'],
      [o.agent, 'System: Qemu Agent ticked', 'Proxmox can then show the IP, shut down cleanly and freeze the file system for backups. Remember to install qemu-guest-agent in Ubuntu.'],
      [o.bus === 'scsi' && o.store === 'local-lvm' && +o.size === 32, 'Disks: SCSI, local-lvm, 32 GiB', 'local-lvm is the fast NVMe storage for VM disks; "local" is only for ISOs and backups.'],
      [o.discard, 'Disks: Discard ticked', 'On thin storage this gives freed space back to the pool.'],
      [+o.cores * +o.sockets === 2 && o.cputype === 'x86-64-v2-AES', 'CPU: 2 cores, type x86-64-v2-AES', 'Enough for a web server; the default CPU type allows live migration later.'],
      [+o.mem === 4096, 'Memory: 4096 MiB', '4 GiB = 4096 MiB (not 4000).'],
      [!o.nonet && o.bridge === 'vmbr0' && String(o.vtag) === '20' && o.model === 'virtio', 'Network: vmbr0, VLAN tag 20, VirtIO', 'Tag 20 puts the VM in the server VLAN; VirtIO is the fastest network card.'],
    ] },
    print01: { title: 'print01 – Windows Server 2022 in the staff VLAN', brief: 'Create <b>VM 103 print01</b>: Windows Server 2022 print server, 2 cores, 4 GiB memory, a 60 GiB disk on local-lvm, in the <b>staff VLAN 10</b>, with fast VirtIO hardware – and make sure Windows Setup will find the disk.', rules: (o) => [
      [o.name === 'print01' && +o.vmid === 103, 'General: VM ID 103, name print01', 'Name and ID identify the VM everywhere.'],
      [o.media === 'iso' && /SERVER_EVAL|win/i.test(o.iso), 'OS: the Windows Server ISO', 'The evaluation ISO installs Windows Server 2022.'],
      [o.ostype === 'Microsoft Windows' && o.osver === 'win11', 'OS: Microsoft Windows, version 11/2022/2025', 'Windows Server 2022 belongs to this version group.'],
      [o.ostype === 'Microsoft Windows' && o.virtio, 'OS: "Add additional drive for VirtIO drivers" ticked', 'Windows has no VirtIO drivers – without this CD Windows Setup says "We couldn\'t find any drives".'],
      [o.scsihw === 'virtio-scsi-single' && o.bus === 'scsi', 'System/Disks: VirtIO SCSI single, SCSI disk', 'Fastest – needs the driver from the VirtIO CD during setup.'],
      [o.agent, 'System: Qemu Agent ticked', 'Install the guest agent from the VirtIO CD after Windows is installed.'],
      [o.store === 'local-lvm' && +o.size >= 60, 'Disks: local-lvm, 60 GiB or more', 'Windows Server needs more space than Linux – 32 GiB fills up with updates.'],
      [+o.cores * +o.sockets === 2, 'CPU: 2 cores', 'Enough for a print server.'],
      [+o.mem === 4096, 'Memory: 4096 MiB', 'Windows Server needs at least 4 GiB to be usable.'],
      [!o.nonet && String(o.vtag) === '10' && o.model === 'virtio', 'Network: VLAN tag 10, VirtIO', 'Staff VLAN, so staff PCs reach the printer directly; VirtIO needs the driver from the VirtIO CD.'],
    ] },
  };
  WIDGETS.vmwiz = (el) => {
    let mission = 'web01';
    const run = () => {
      const M = MISSIONS[mission];
      el.innerHTML = `<div class="wt">Practice: the Create VM wizard (exactly like Proxmox VE 8)</div><div class="row" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${Object.entries(MISSIONS).map(([k, x]) => `<button class="btn sm ${k === mission ? 'p' : ''}" data-mi="${k}">${esc(x.title)}</button>`).join('')}</div><div id="vmwp"></div><div id="vmwf"></div>`;
      el.querySelectorAll('[data-mi]').forEach((b) => (b.onclick = () => { mission = b.dataset.mi; run(); }));
      vmWizard(el.querySelector('#vmwp'), { nodes: ['pve1'], isos: PVE_ISOS, stores: [{ id: 'local-lvm', free: 790 }, { id: 'nas-nfs', free: 1500 }], bridges: ['vmbr0'], nextId: mission === 'web01' ? 101 : 103, used: new Set([100]), coach: `<b>Your task:</b> ${M.brief} Go through every tab and use the <b>i</b> buttons. Press <b>Finish</b> on the Confirm tab to get feedback – nothing is created.`, onFinish: (o) => {
        const res = M.rules(o), ok = res.filter((r) => r[0]).length;
        el.querySelector('#vmwf').innerHTML = `<div class="card" style="margin-top:8px"><b>${ok} of ${res.length} right</b>${ok === res.length ? ' – this VM would be built exactly right. Now do it for real in the lab.' : ' – fix the red ones and press Finish again.'}<ul class="fb">${res.map(([g, t, why]) => `<li class="${g ? 'g' : 'b'}"><b>${esc(t)}</b><br><span class="m">${esc(why)}</span></li>`).join('')}</ul></div>`;
        el.querySelector('#vmwf').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return null;
      } });
    };
    run();
  };
  const s18 = SESSIONS.find((s) => s.id === 's18');
  if (s18 && !s18.concept.some((c) => c.w === 'vmwiz')) s18.concept.splice(1, 0, { h: 'Your first VM, step by step', html: `<p>In Proxmox you create a VM with the <b>Create VM</b> button (top right). A wizard walks you through eight tabs:</p><ol><li><b>General</b> – which host, a VM ID (101…) and a name.</li><li><b>OS</b> – the installation ISO and the type of operating system.</li><li><b>System</b> – the virtual mainboard: disk controller, firmware, and the <b>Qemu Agent</b> tick-box.</li><li><b>Disks</b> – how big the disk is and on which storage.</li><li><b>CPU</b> – how many cores.</li><li><b>Memory</b> – how much RAM (in MiB: 4096 = 4 GiB).</li><li><b>Network</b> – which bridge and which VLAN tag.</li><li><b>Confirm</b> – check everything, tick "Start after created", Finish.</li></ol><p>Then open the VM's <b>Console</b> and install the operating system as on a real PC. Practise below first – the wizard is the same one you will use in the lab, with an <b>i</b> on every field.</p>`, w: 'vmwiz' });

  // ---------------------------------------------------------------- refresh what the engine already drew
  try { renderSide(); const last = store.get('infra:last', null); if (last && last.sid === 'start') openSession('start'); else if (APP.sid) renderMain(); } catch (e) { console.warn(e); }
})();
