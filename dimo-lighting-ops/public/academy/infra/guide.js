/* Guide me – a step-by-step coach for the network builder (session 25 lab and its build jobs). A pop-up tells a beginner what to do next and why,
   highlights where to click, types commands into the right console on request and ticks each step from the live state of the lab.
   Back / Next / the step list move freely between steps; the pop-up can be hidden to a small button and opened again at any time. */
(function () {
  const BL = window.__BLD; if (!BL) return;
  const PASS = BL.PASS;

  // ---------------------------------------------------------------- styles
  const css = document.createElement('style');
  css.textContent = `#gd{position:fixed;left:10px;top:10px;width:340px;max-width:calc(100vw - 20px);max-height:calc(100vh - 20px);display:flex;flex-direction:column;background:#fff;color:#18232b;border:1px solid #b9c6c1;border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.28);z-index:56;font-size:13.5px;line-height:1.45}
#gd .gh{display:flex;align-items:center;gap:6px;padding:8px 10px;background:#18232b;color:#fff;border-radius:11px 11px 0 0;cursor:move;user-select:none;touch-action:none}#gd .gh b{font-size:14px}#gd .gh .n{font-size:12px;color:#c8d3cf}#gd .gh .sp{flex:1}#gd .gh button{background:#2c3a44;color:#fff;border:0;border-radius:6px;width:28px;height:26px;cursor:pointer;font-size:14px}
#gd .gp{display:flex;gap:2px;padding:6px 10px 0}#gd .gp i{flex:1;height:5px;border-radius:3px;background:#dfe6e3}#gd .gp i.d{background:#2f8f5b}#gd .gp i.c{background:#e0812b}
#gd .gb{padding:8px 12px 10px;overflow:auto;flex:1}#gd .ph{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#7a8a90;font-weight:700}#gd h3{margin:2px 0 6px;font-size:16px}
#gd .why{background:#f3f7f5;border-left:3px solid #2f8f5b;padding:6px 9px;border-radius:0 6px 6px 0;margin:6px 0;font-size:13px}#gd ol{margin:6px 0;padding-left:20px}#gd ol li{margin:3px 0}
#gd .cm{border:1px solid #dfe6e3;border-radius:8px;margin:6px 0;overflow:hidden}#gd .cm .ct{background:#eef3f1;padding:4px 8px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px}#gd .cm .ct .sp{flex:1}
#gd .cr{padding:5px 8px;border-top:1px solid #eef1f0}#gd .cr .l{display:flex;gap:6px;align-items:flex-start}#gd .cr code{flex:1;background:#18232b;color:#d8f5e3;padding:3px 6px;border-radius:5px;font-size:12px;word-break:break-all}#gd .cr .e{font-size:12px;color:#5b6b72;margin-top:2px}
#gd .cr button,#gd .ct button{border:1px solid #b9c6c1;background:#fff;border-radius:6px;font-size:11.5px;padding:2px 7px;cursor:pointer;white-space:nowrap}#gd .cr button:hover{background:#fff4ea;border-color:#e0812b}
#gd .st{margin-top:8px;padding:7px 9px;border-radius:8px;font-size:13px}#gd .st.ok{background:#e5f4ea;color:#1f6b41;font-weight:600}#gd .st.wt{background:#fff6e9;color:#8a4b0f}#gd .st.rd{background:#eef2f7;color:#2b4a6b}
#gd .tip{font-size:12.5px;color:#5b6b72;margin-top:6px}#gd .gf{display:flex;gap:5px;padding:8px 10px;border-top:1px solid #e3e9e7;flex-wrap:wrap}#gd .gf button{flex:1;border:1px solid #b9c6c1;background:#fff;border-radius:7px;padding:6px 4px;cursor:pointer;font-size:12.5px;font-weight:600;white-space:nowrap}
#gd .gf button.p{background:#18232b;color:#fff;border-color:#18232b}#gd .gf button.go{background:#2f8f5b;border-color:#2f8f5b;animation:gdpulse 1.2s infinite}#gd .gf button:disabled{opacity:.4;cursor:default}
#gd .gl{border-top:1px solid #e3e9e7;max-height:44vh;overflow:auto;padding:4px 0}#gd .gl .h{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#7a8a90;font-weight:700;padding:6px 12px 2px}#gd .gl a{display:flex;gap:6px;padding:3px 12px;cursor:pointer;color:inherit;text-decoration:none;font-size:12.5px}#gd .gl a:hover{background:#f3f7f5}#gd .gl a.c{background:#fff4ea;font-weight:700}#gd .gl a .k{width:16px;flex-shrink:0;text-align:center}
#gdpill{position:fixed;left:10px;bottom:12px;z-index:56;background:#18232b;color:#fff;border:0;border-radius:22px;padding:9px 14px;font-weight:700;font-size:13.5px;box-shadow:0 8px 22px rgba(0,0,0,.3);cursor:pointer}#gdpill .ok{color:#7fe0a6}
.gd-hi{outline:3px solid #e0812b !important;outline-offset:2px;animation:gdpulse 1.2s infinite;border-radius:6px}#topo .dv.gd-hi{outline:none !important;animation:none}#topo .dv.gd-hi rect.box{stroke:#e0812b;stroke-width:4;animation:gdstroke 1.2s infinite}
.gd-flash{outline:4px solid #e0812b !important;outline-offset:3px}.bld .btn.gdb{background:#fff4ea;border-color:#e0812b;color:#8a4b0f;font-weight:700}.bld .btn.gdb.on{background:#e0812b;color:#fff}.gdcall{background:#fff4ea;border:1px solid #f0c9a0;border-radius:8px;padding:8px 10px}
@keyframes gdpulse{0%,100%{box-shadow:0 0 0 0 rgba(224,129,43,.55)}50%{box-shadow:0 0 0 7px rgba(224,129,43,0)}}@keyframes gdstroke{0%,100%{stroke-opacity:1}50%{stroke-opacity:.35}}
@media (min-width:821px){body.gd-dock .app{grid-template-columns:362px minmax(0,1fr)}body.gd-dock #gd{max-height:calc(100vh - 20px)}}
@media (max-width:760px){#gd{left:6px !important;right:6px;top:auto !important;bottom:6px;width:auto;max-height:50vh}}`;
  document.head.appendChild(css);

  // ---------------------------------------------------------------- what is where in the lab
  const D = (L) => Object.values(L.devs);
  const num = (id) => +(String(id).match(/\d+/) || [0])[0];
  const byId = (a, b) => num(a.id) - num(b.id);
  const isUbu = (d) => d.kind === 'srv' && (d.cat ? d.cat === 'ubuiso' : d.lxsetup === 'ubuntu');
  function ctx(L) {
    const all = D(L);
    const R = all.find((d) => d.kind === 'rt'), SW = all.filter((d) => d.kind === 'sw').sort(byId)[0], P = all.filter((d) => ['pc', 'laptop'].includes(d.kind)).sort(byId);
    const W = all.filter((d) => d.kind === 'srv' && (d.cat ? d.cat === 'winiso' : d.os === 'win')).sort(byId)[0], U = all.filter(isUbu).sort(byId)[0], H = all.filter((d) => d.kind === 'hv').sort(byId)[0];
    const V = H ? all.filter((d) => d.kind === 'vm' && d.vmHost === H.id).sort((a, b) => a.vm.vmid - b.vm.vmid)[0] : null;
    return { R, SW, P1: P[0], P2: P[1], W, U, H, V, ISP: L.devs.ISP };
  }
  const nic = (d) => BL.nic0(d) || {};
  const ifUp = (L, d, ip) => !!d && l3ifs(L, d).some((e) => e.ip === ip && e.up);
  const onSw = (L, d) => !!d && BL.linkedTo(L, d, (x) => x?.kind === 'sw');
  const taskOk = (L, id) => { const S = SESSIONS.find((x) => x.id === 's25'); const t = S?.lab.tasks.find((x) => x.id === id); try { return !!t && !!t.check(L); } catch (e) { return false; } };
  const tkOk = (L, tid, i) => { const S = SESSIONS.find((x) => x.id === 's25'); const T = S?.tickets.find((x) => x.id === tid); try { return !!T && !!T.checks[i].f(L); } catch (e) { return false; } };
  const logHas = (L, id, re) => (L.cmdlog || []).some((c) => c.dev === id && re.test(c.line || ''));

  // ---------------------------------------------------------------- where to point (CSS selectors, worked out from what is on screen now)
  const Q = { add: '#bldbar [data-b=add]', mode: (m) => `#bldbar [data-m=${m}]`, sched: '#bldbar [data-b=sched]', cat: (k) => `.modal .cat .it[data-k="${k}"]`, dev: (id) => `#topo .dv[data-d="${id}"]`, port: (p) => `.modal [data-p="${p}"]`, tab: (t) => `#dpanel .dtab[data-t="${t}"]`, inp: '#dpanel .term .ln input' };
  const catOpen = () => !!document.querySelector('.modal .cat');
  const hiAdd = (k) => () => (catOpen() ? [Q.cat(k)] : [Q.add]);
  const hiCable = (a, pa, b, pb) => (L, c) => {
    const A = a(c), Bd = b(c); if (!A || !Bd) return [];
    if (document.querySelector('.modal [data-p]')) return [Q.port(BL.BS.from ? pb : pa)];
    if (BL.BS.mode !== 'cable') return [Q.mode('cable')];
    return [Q.dev(BL.BS.from ? Bd.id : A.id)];
  };
  const hiRemove = (id) => () => (document.querySelector('.modal .mf button.p') ? ['.modal .mf button.p'] : BL.BS.mode !== 'remove' ? [Q.mode('remove')] : id ? [Q.dev(id)] : []);
  const hiOpen = (a, tool, then) => (L, c) => {
    const d = a(c); if (!d) return [];
    if (APP.active?.dev === d.id) { if (tool && APP.active.tool !== tool && document.querySelector(Q.tab(tool))) return [Q.tab(tool)]; return then ? [].concat(then(L, c)) : [Q.inp]; }
    if (BL.BS.mode !== 'move') return [Q.mode('move')];
    return [Q.dev(d.id)];
  };

  // ---------------------------------------------------------------- the steps (ph = phase, t = title, why = plain words, do = what to do, cm = commands, ok = done when, hi = where to point)
  const cmds = (dev, tool, title, list) => ({ dev, tool, title, list });
  const routerCon = (title, list) => cmds((c) => c.R, 'con', title, list);
  const LAB = [
    { ph: 'Start', t: 'Welcome – what you will build', why: 'You are the IT engineer for a new office. The room is empty except the internet provider\'s box. By the end you will have a router, a switch, two PCs, a Windows server, a Linux web server and a Proxmox host with a virtual machine – all cabled, configured and tested, just like a real installation.', do: ['Read each step, do what it says, then press <b>Next ▶</b>.', 'Orange outlines show you <b>where to click</b>. Lost? Press <b>👆 Show me</b>.', '<b>⌨ Type it</b> puts a command into the right console for you – you still press <b>Enter</b> to run it.', 'Each step ticks itself <b>✓</b> when it is done. You can go <b>◀ Back</b>, jump with <b>☰ Steps</b>, or hide the guide with <b>–</b> and bring it back with the 🧭 button.'] },
    { ph: 'Start', t: 'Read the plan (the handover sheet)', why: 'Professionals never start plugging cables in without a plan. The plan says which address every device gets, so nothing clashes later.', html: '<table class="t" style="width:100%;font-size:12.5px;border-collapse:collapse"><tr><td>Internet (WAN)</td><td><b>203.115.21.6/30</b>, provider gateway <b>203.115.21.5</b></td></tr><tr><td>Office network (LAN)</td><td><b>192.168.10.0/24</b></td></tr><tr><td>Router (gateway)</td><td><b>192.168.10.1</b></td></tr><tr><td>Servers</td><td>SRV01 <b>.10</b> · web01 <b>.11</b></td></tr><tr><td>Proxmox host</td><td>pve1 <b>.20</b></td></tr><tr><td>PCs</td><td>automatic (DHCP) <b>.100 and up</b></td></tr><tr><td>DNS</td><td><b>8.8.8.8</b></td></tr><tr><td>All passwords</td><td><b>' + PASS + '</b></td></tr></table>', do: ['Keep this sheet in mind – the guide reminds you of every number when you need it.'] },
    // network core
    { ph: 'Network core', t: 'Unpack the router', why: 'The router is the office\'s door to the internet. Every PC sends internet traffic to it – that is why it is called the <b>default gateway</b>.', do: ['Press <b>＋ Add device</b> under the drawing.', 'In the catalogue choose <b>Router – Cisco ISR 1100</b>.'], ok: (L, c) => !!c.R, hi: hiAdd('rt') },
    { ph: 'Network core', t: 'Unpack the switch', why: 'The switch is the box with many ports that every device plugs into. It connects everything inside the office.', do: ['Press <b>＋ Add device</b> again.', 'Choose <b>Switch – 24 ports</b> (Cisco Catalyst).'], ok: (L, c) => !!c.SW, hi: hiAdd('sw24') },
    { ph: 'Network core', t: 'Cable the router to the internet', why: 'Port <b>Gi0/0</b> is the router\'s <b>WAN</b> (outside) port. It goes to the internet provider\'s box.', do: ['Press <b>🔌 Cable</b>.', 'Click the <b>router</b> and choose port <b>Gi0/0</b>.', 'Click the <b>Internet</b> box and choose its port <b>a</b>.'], tip: 'The cable stays grey and dashed for now – new Cisco router ports are switched off until you configure them.', ok: (L, c) => !!c.R && BL.linkedTo(L, c.R, (x) => x?.kind === 'isp'), hi: hiCable((c) => c.R, 'Gi0/0', (c) => c.ISP, 'a') },
    { ph: 'Network core', t: 'Cable the router to the switch', why: 'Port <b>Gi0/1</b> is the router\'s <b>LAN</b> (inside) port. It goes to the switch\'s fast <b>uplink</b> port Te1/1/1, so the whole office can reach the router.', do: ['Still in <b>🔌 Cable</b> mode: click the <b>router</b> → port <b>Gi0/1</b>.', 'Click the <b>switch</b> → port <b>Te1/1/1</b> (right-hand block on the front panel).'], ok: (L, c) => !!c.R && !!c.SW && BL.linkedTo(L, c.R, (x) => x?.id === c.SW.id), hi: hiCable((c) => c.R, 'Gi0/1', (c) => c.SW, 'Te1/1/1') },
    // router
    { ph: 'Router', t: 'Open the router\'s console', why: 'A console is the text screen where you type commands to configure a device. Cisco routers are configured this way.', do: ['Press <b>✥ Move / open</b>.', 'Click the <b>router</b> in the drawing. Its console opens under the drawing showing <code>Router&gt;</code>.'], tip: '<code>&gt;</code> means <b>user mode</b> – you can only look. You will switch to <b>privileged mode</b> (<code>#</code>) next.', ok: (L, c) => !!c.R && (APP.active?.dev === c.R.id || ifUp(L, c.R, '203.115.21.6')), hi: hiOpen((c) => c.R, 'con') },
    { ph: 'Router', t: 'Configure the WAN (internet) port', why: 'The router needs the public address from the provider on its WAN port, and the port must be switched on.', cm: routerCon('Router console', [['enable', 'Go to privileged mode – the prompt changes to Router#.'], ['conf t', 'Short for "configure terminal": now you can change settings – Router(config)#.'], ['hostname R-OFFICE', 'Give the router its name. Watch the prompt change.'], ['int g0/0', 'Select port GigabitEthernet0/0 – the WAN port.'], ['ip address 203.115.21.6 255.255.255.252', 'The public address from the handover sheet. 255.255.255.252 (/30) means only 2 usable addresses: ours and the provider\'s.'], ['ip nat outside', 'Mark this port as the outside (internet) side for NAT.'], ['no shutdown', 'Switch the port on. New router ports are "administratively down".']]), do: ['Press <b>⌨ Type it</b> on each line in order and press <b>Enter</b> in the console after each one.'], ok: (L, c) => ifUp(L, c.R, '203.115.21.6'), hi: hiOpen((c) => c.R, 'con') },
    { ph: 'Router', t: 'Configure the LAN (office) port', why: 'The LAN port gets the office gateway address <b>192.168.10.1</b>. Every PC will send its internet traffic to this address.', cm: routerCon('Router console – continue in config mode', [['int g0/1', 'Select the LAN port, cabled to the switch.'], ['ip address 192.168.10.1 255.255.255.0', 'The gateway address. 255.255.255.0 (/24) = 254 addresses for the office.'], ['ip nat inside', 'Mark this port as the inside (office) side for NAT.'], ['no shutdown', 'Switch the port on – the cable to the switch turns blue.'], ['exit', 'Back to the main config mode.']]), do: ['Type each line and press <b>Enter</b>. If the prompt shows <code>Router&gt;</code> again, start with <code>enable</code> and <code>conf t</code>.'], ok: (L, c) => ifUp(L, c.R, '192.168.10.1'), hi: hiOpen((c) => c.R, 'con') },
    { ph: 'Router', t: 'Route to the internet and share it (NAT)', why: 'The <b>default route</b> tells the router where to send everything it does not know: to the provider. <b>NAT</b> lets all office PCs share the router\'s one public address – the internet never sees 192.168.x.x addresses.', cm: routerCon('Router console', [['ip route 0.0.0.0 0.0.0.0 203.115.21.5', 'Default route: "anything else goes to the provider\'s gateway".'], ['access-list 1 permit 192.168.10.0 0.0.0.255', 'A list matching the office addresses (0.0.0.255 = the last number can be anything).'], ['ip nat inside source list 1 interface g0/0 overload', 'NAT: office addresses go out using g0/0\'s public address; "overload" lets them all share it.'], ['end', 'Leave config mode.'], ['ping 8.8.8.8', 'Test: can the router reach the internet? <b>!!!!!</b> means yes, <b>.....</b> means no.']]), do: ['Type each line and press <b>Enter</b>. The step ticks when the ping works.'], ok: (L, c) => taskOk(L, 'wan'), hi: hiOpen((c) => c.R, 'con') },
    { ph: 'Router', t: 'Save the configuration', why: 'Everything you typed lives in memory (the <b>running-config</b>). If the power fails it is gone. <code>write memory</code> saves it to the <b>startup-config</b>.', cm: routerCon('Router console', [['write memory', 'Save – you see [OK].'], ['show ip interface brief', 'One line per port: both g0/0 and g0/1 should be up / up.']]), ok: (L, c) => !!c.R && logHas(L, c.R.id, /^(wr|write( memory)?|copy run(ning-config)? start(up-config)?)$/i), hi: hiOpen((c) => c.R, 'con') },
    { ph: 'PCs & DHCP', t: 'Make the router hand out addresses (DHCP)', why: '<b>DHCP</b> gives each PC an address, the gateway and DNS automatically, so nobody types them by hand. We keep .1–.99 for the router, servers and printers.', cm: routerCon('Router console', [['conf t', 'Config mode (type enable first if the prompt shows >).'], ['ip dhcp excluded-address 192.168.10.1 192.168.10.99', 'Never hand out .1–.99 – those are kept for fixed devices.'], ['ip dhcp pool LAN', 'Create an address pool called LAN.'], ['network 192.168.10.0 255.255.255.0', 'Which network the pool serves.'], ['default-router 192.168.10.1', 'The gateway the PCs are told to use.'], ['dns-server 8.8.8.8', 'The DNS server the PCs are told to use – it turns names like google.com into addresses.'], ['end', 'Leave config mode.']]), ok: (L, c) => !!c.R && Object.values(c.R.dhcp?.pools || {}).some((p) => p.net === '192.168.10.0' && p.gw === '192.168.10.1' && (p.dns || []).length), hi: hiOpen((c) => c.R, 'con') },
    // PCs
    { ph: 'PCs & DHCP', t: 'Unpack two Windows PCs', why: 'Office desktops. They are set to get their address automatically (DHCP).', do: ['<b>＋ Add device</b> → <b>Windows 11 PC</b>.', 'Do it again for the second PC.'], ok: (L, c) => !!c.P2, hi: hiAdd('pcwin') },
    { ph: 'PCs & DHCP', t: 'Cable the PCs to the switch', why: 'Keep users on ports 10–24 and servers on ports 1–8 – then anyone can read the switch at a glance.', do: ['<b>🔌 Cable</b>: click <b>PC-01</b> → <b>Ethernet</b>, then the <b>switch</b> → port <b>10</b>.', 'Same for <b>PC-02</b> → switch port <b>11</b>.'], tip: 'A PC asks DHCP for an address as soon as its cable goes in.', ok: (L, c) => !!c.P1 && !!c.P2 && onSw(L, c.P1) && onSw(L, c.P2), hi: (L, c) => (c.P1 && !onSw(L, c.P1) ? hiCable((x) => x.P1, 'Ethernet', (x) => x.SW, 'Gi1/0/10')(L, c) : hiCable((x) => x.P2, 'Ethernet', (x) => x.SW, 'Gi1/0/11')(L, c)) },
    { ph: 'PCs & DHCP', t: 'Check the PC got an address', why: 'An address like <b>192.168.10.100</b> means DHCP worked. <b>169.254.x.x</b> (APIPA) means the PC asked before DHCP was ready and gave up – just ask again.', cm: cmds((c) => c.P1, 'cmd', 'PC-01 › Command Prompt', [['ipconfig /all', 'Shows the address, gateway and DNS server.'], ['ipconfig /renew', 'Ask DHCP again (needed if you saw 169.254.x.x). Do the same on PC-02.']]), do: ['<b>✥ Move / open</b> → click <b>PC-01</b>; the <b>Command Prompt</b> opens.'], ok: (L) => taskOk(L, 'dhcp'), hi: hiOpen((c) => c.P1, 'cmd') },
    { ph: 'PCs & DHCP', t: 'Test the internet from a PC', why: 'Test step by step, nearest first: the gateway, then the internet by number, then by name. Where it stops tells you where the problem is.', cm: cmds((c) => c.P1, 'cmd', 'PC-01 › Command Prompt', [['ping 192.168.10.1', 'The gateway (router) – tests the cable and switch.'], ['ping 8.8.8.8', 'The internet by number – tests the route and NAT.'], ['ping google.com', 'The internet by name – tests DNS as well.']]), tip: 'The step needs both PCs to work – if PC-02 still has 169.254.x.x, run <code>ipconfig /renew</code> on it too.', ok: (L) => taskOk(L, 'inet'), hi: hiOpen((c) => c.P1, 'cmd') },
    // Windows server
    { ph: 'Windows Server', t: 'Unpack a new Windows server and cable it', why: 'A brand-new server with the Windows Server 2022 installation disc (ISO) in its drive. Servers go on switch ports 1–8.', do: ['<b>＋ Add device</b> → <b>Windows Server 2022 – new</b>.', '<b>🔌 Cable</b>: the server <b>Ethernet</b> → switch port <b>1</b>.'], ok: (L, c) => !!c.W && onSw(L, c.W), hi: (L, c) => (c.W ? hiCable((x) => x.W, 'Ethernet', (x) => x.SW, 'Gi1/0/1')(L, c) : hiAdd('winiso')()) },
    { ph: 'Windows Server', t: 'Install Windows Server (Windows Setup)', why: 'This is exactly what you see on a real server booting from the ISO. <b>Desktop Experience</b> = with the normal Windows desktop; without it you get Server Core (command line only).', do: ['<b>✥ Move / open</b> → click <b>WIN-NEW</b>. Windows Setup opens.', 'Language screen → <b>Next</b>.', 'Choose <b>Windows Server 2022 Standard (Desktop Experience)</b> → <b>Next</b>.', 'Drive 0 Unallocated Space → <b>Next</b>.', 'Installing… → <b>Restart now</b>.', 'Administrator password: <b>' + PASS + '</b> twice → <b>Finish</b>.'], tip: 'Windows insists on a strong password: 8+ characters with capitals, small letters, numbers or symbols.', ok: (L, c) => !!c.W && !c.W.setup, hi: hiOpen((c) => c.W, null, () => ['#dpanel #n']) },
    { ph: 'Windows Server', t: 'Name the server and give it a fixed address', why: 'Setup gave the server a random name (WIN-…) and a DHCP address. Servers need a proper name and a <b>static</b> address, so everyone always finds them in the same place.', cm: cmds((c) => c.W, 'ps', 'Server › PowerShell', [['Rename-Computer SRV01 -Restart', 'New name SRV01; a name change needs a restart.'], ['New-NetIPAddress -InterfaceAlias Ethernet -IPAddress 192.168.10.10 -PrefixLength 24 -DefaultGateway 192.168.10.1', 'Fixed address .10, /24 mask, gateway .1.'], ['Set-DnsClientServerAddress -InterfaceAlias Ethernet -ServerAddresses 8.8.8.8', 'The DNS server.'], ['ipconfig /all', 'Check: name, address, gateway and DNS.']]), do: ['Open the server (click it) → the <b>PowerShell</b> tab.'], ok: (L, c) => !!c.W && /^SRV01$/i.test(c.W.hostname) && nic(c.W).ip === '192.168.10.10' && !nic(c.W).dhcp, hi: hiOpen((c) => c.W, 'ps') },
    { ph: 'Windows Server', t: 'Let the PCs ping the server', why: 'Windows Firewall blocks ping by default – a common reason why a working server "does not answer". Allow it, then test from a PC.', cm: cmds((c) => c.W, 'ps', 'Server › PowerShell', [['Enable-NetFirewallRule -DisplayGroup "File and Printer Sharing"', 'Allows ping (and file sharing) through Windows Firewall.']]), cm2: cmds((c) => c.P1, 'cmd', 'PC-01 › Command Prompt', [['ping 192.168.10.10', 'Replies = the PC can reach the server.']]), ok: (L) => taskOk(L, 'win'), hi: (L, c) => (logHas(L, c.W?.id, /Enable-NetFirewallRule/i) ? hiOpen((x) => x.P1, 'cmd')(L, c) : hiOpen((x) => x.W, 'ps')(L, c)) },
    // Ubuntu web server
    { ph: 'Linux web server', t: 'Unpack an Ubuntu server and cable it', why: 'Linux runs most of the world\'s web servers. This one will host the office intranet.', do: ['<b>＋ Add device</b> → <b>Ubuntu Server 24.04 – new</b>.', '<b>🔌 Cable</b>: its port <b>ens18</b> → switch port <b>2</b>.'], ok: (L, c) => !!c.U && onSw(L, c.U), hi: (L, c) => (c.U ? hiCable((x) => x.U, 'ens18', (x) => x.SW, 'Gi1/0/2')(L, c) : hiAdd('ubuiso')()) },
    { ph: 'Linux web server', t: 'Install Ubuntu Server', why: 'The Ubuntu installer asks the same questions as on a real server. The important one is the network: a server gets a <b>manual (static)</b> address.', do: ['Click the server – the installer opens. Language → <b>[ Done ]</b>.', 'Network: choose <b>Manual</b>. Address <b>192.168.10.11/24</b>, gateway <b>192.168.10.1</b>, name servers <b>8.8.8.8</b> → <b>[ Done ]</b>.', 'Storage: use the entire disk → <b>[ Done ]</b>.', 'Profile: your name, server name <b>web01</b>, username <b>admin</b>, password <b>' + PASS + '</b> twice → <b>[ Done ]</b>.', 'SSH: tick <b>Install OpenSSH server</b> → <b>[ Done ]</b>.', '<b>[ Done – Reboot Now ]</b>.'], tip: 'Made a mistake? Use <b>[ Back ]</b> in the installer.', ok: (L, c) => !!c.U && !c.U.lxsetup && nic(c.U).ip === '192.168.10.11', hi: hiOpen((c) => c.U, null, () => ['#dpanel #lxN']) },
    { ph: 'Linux web server', t: 'Install the nginx web server', why: 'Linux installs software with a package manager: <code>apt</code> downloads and installs it. <code>sudo</code> runs a command as administrator and asks for your password.', cm: cmds((c) => c.U, 'term', 'web01 › Terminal', [['sudo apt install -y nginx', 'Install nginx. -y answers "yes" for you.'], [PASS, 'Your password when sudo asks for it (nothing shows while you type – that is normal on Linux).'], ['systemctl status nginx', 'Is it running? Look for "active (running)".']]), ok: (L, c) => !!c.U && c.U.units?.nginx?.active === 'active', hi: hiOpen((c) => c.U, 'term') },
    { ph: 'Linux web server', t: 'Open the web page from a PC', why: 'The real test: can a user see the website? Open a browser on PC-01 and type the server\'s address.', cm: cmds((c) => c.P1, 'web', 'PC-01 › Browser', [['http://192.168.10.11', 'You should see "Welcome to nginx!".']]), do: ['Open <b>PC-01</b> → the <b>Browser</b> tab, type the address and press <b>Enter</b> (or Go).'], ok: (L) => taskOk(L, 'web'), hi: hiOpen((c) => c.P1, 'web', () => ['#dpanel #bUrl']) },
    // Proxmox
    { ph: 'Proxmox & VM', t: 'Unpack a Proxmox host and cable it', why: 'A <b>hypervisor</b> runs many virtual machines (VMs) on one physical server. Proxmox VE is a popular free one.', do: ['<b>＋ Add device</b> → <b>Proxmox VE host</b>.', '<b>🔌 Cable</b>: its port <b>eno1</b> → switch port <b>3</b>.'], ok: (L, c) => !!c.H && BL.linkedTo(L, c.H, (x) => x?.kind === 'sw'), hi: (L, c) => (c.H ? hiCable((x) => x.H, 'eno1', (x) => x.SW, 'Gi1/0/3')(L, c) : hiAdd('pve')()) },
    { ph: 'Proxmox & VM', t: 'Install Proxmox VE', why: 'The Proxmox installer wipes the disk, asks for a password and – most important – the <b>management</b> address you will use to open its web page.', do: ['Click the host – the installer opens. <b>I agree</b>.', 'Target harddisk → <b>Next</b>. Location and time zone → <b>Next</b>.', 'Password <b>' + PASS + '</b> twice, email <b>it@office.local</b> → <b>Next</b>.', 'Management network: interface <b>eno1</b>, hostname <b>pve1.office.local</b>, IP <b>192.168.10.20/24</b>, gateway <b>192.168.10.1</b>, DNS <b>8.8.8.8</b> → <b>Next</b>.', 'Summary → <b>Install</b>.'], ok: (L, c) => !!c.H && !c.H.pvesetup, hi: hiOpen((c) => c.H, null, () => ['#dpanel #pX']) },
    { ph: 'Proxmox & VM', t: 'Create a virtual machine', why: 'A VM is a complete computer made of software: its own CPU cores, memory, disk and network card, all taken from the host.', do: ['Open the host → the <b>Web UI (:8006)</b> tab.', 'Press <b>Create VM</b> (top right).', '<b>General</b>: name <b>app01</b> (VM ID 101). <b>OS</b>: the <b>ubuntu-24.04</b> ISO.', '<b>System</b> and <b>Disks</b>: keep the defaults (32 GiB is fine). <b>CPU</b>: 2 cores. <b>Memory</b>: 2048 MiB.', '<b>Network</b>: bridge <b>vmbr0</b>, no VLAN tag. <b>Confirm</b> → <b>Finish</b>.'], tip: 'Every field has an ⓘ in the wizard if you want to know what it means.', ok: (L, c) => !!c.V, hi: hiOpen((c) => c.H, 'gui', () => (document.querySelector('.modal') ? [] : ['#dpanel [data-a=createvm]'])) },
    { ph: 'Proxmox & VM', t: 'Start the VM and open its console', why: 'A new VM is switched off. Start it – it boots from the Ubuntu ISO, like a new PC with a disc in the drive.', do: ['In the Web UI tree on the left click <b>101 (app01)</b>.', 'Press <b>▶ Start</b>, then <b>&gt;_ Console</b>.'], ok: (L, c) => !!c.V && c.V.vm.status === 'running', hi: hiOpen((c) => c.H, 'gui', (L, c) => { const v = c.V?.vm; if (!v) return []; const sel = `#dpanel .tree a[data-s="vm:${v.vmid}"]`; const on = document.querySelector(sel)?.classList.contains('on'); return on ? ['#dpanel [data-a=start]'] : [sel]; }) },
    { ph: 'Proxmox & VM', t: 'Install Ubuntu inside the VM', why: 'Same installer as the physical server. This time leave the network on <b>DHCPv4</b> – the VM gets its address from the router, like a PC.', do: ['In the VM console: Language → <b>[ Done ]</b>.', 'Network: keep <b>DHCPv4</b> → <b>[ Done ]</b>. Storage → <b>[ Done ]</b>.', 'Profile: server name <b>app01</b>, username <b>admin</b>, password <b>' + PASS + '</b> → <b>[ Done ]</b>.', 'SSH → <b>[ Done ]</b> → <b>[ Done – Reboot Now ]</b>.'], tip: 'Closed the console? In the Web UI select the VM and press <b>&gt;_ Console</b>, or click the VM in the drawing.', ok: (L, c) => !!c.V && c.V.vm.status === 'running' && !c.V.lxsetup && !c.V.setup, hi: (L, c) => (c.V && APP.active?.dev === c.V.id ? ['#dpanel #lxN'] : c.V ? [Q.dev(c.V.id), '#dpanel [data-a=console]'] : []) },
    { ph: 'Proxmox & VM', t: 'Test the VM', why: 'The VM reaches the network through the host\'s bridge <b>vmbr0</b> and its cable on eno1 – it should reach the server and the internet like any PC.', cm: cmds((c) => c.V, 'term', 'app01 › Terminal', [['ip a', 'Its address – 192.168.10.1xx from DHCP.'], ['ping -c 3 192.168.10.10', 'The Windows server SRV01.'], ['ping -c 3 8.8.8.8', 'The internet.']]), ok: (L) => taskOk(L, 'vm'), hi: hiOpen((c) => c.V, 'term') },
    // document
    { ph: 'Document', t: 'Take a spare device out again', why: 'Real offices change all the time: devices are retired and removed. Removing one also unplugs its cables.', do: ['Add a spare device if you like (for example a PC), then press <b>🗑 Remove</b> and click it.', 'Confirm with <b>OK</b>.'], ok: (L) => (L.flags.removed || []).length > 0, hi: hiRemove(null) },
    { ph: 'Document', t: 'Write the cable schedule', why: 'A <b>cable schedule</b> lists every cable with a label (C-001 …) and both ends. Years later anyone can trace a cable without guessing.', do: ['Press <b>📋 Cable schedule</b>.', 'In a real job you would print it and stick the same label on both ends of each cable.'], ok: (L) => !!L.flags.sched, hi: () => [Q.sched] },
    { ph: 'Document', t: 'Done – you built an office!', why: 'From an empty room you planned, unpacked, cabled, installed, configured, tested and documented a complete office network – the same order real IT engineers follow.', do: ['Check the <b>Tasks</b> list under the drawing – all 8 should be ✓.', 'Next: try the <b>Break &amp; fix</b> tab – five real jobs: add, replace and remove devices in a working office. The guide helps there too.'], ok: (L) => (SESSIONS.find((x) => x.id === 's25')?.lab.tasks || []).every((t) => taskOk(L, t.id)) },
  ];

  // ---------------------------------------------------------------- shorter guides for the five build jobs
  const isNew = (d) => !['PC1', 'PC2'].includes(d.id);
  const newPc = (c, L) => D(L).filter((d) => ['pc', 'laptop'].includes(d.kind) && isNew(d)).sort(byId)[0];
  const tcx = (L) => ({ ...ctx(L), SW: L.devs.SW1, NP: newPc(null, L), PC1: L.devs.PC1, NS: D(L).filter((d) => d.kind === 'sw' && d.id !== 'SW1').sort(byId)[0], NW: D(L).filter((d) => d.kind === 'srv' && d.cat === 'winiso').sort(byId)[0], PR: D(L).find((d) => d.kind === 'printer'), APP01: vmById(L, 101) });
  const TK = {
    b1: [
      { ph: 'Job', t: 'Unpack a PC for Dilini', why: 'A new starter needs a desk PC on the office network. The network already works – you only add the PC.', do: ['<b>＋ Add device</b> → <b>Windows 11 PC</b>.'], ok: (L, c) => !!c.NP, hi: hiAdd('pcwin') },
      { ph: 'Job', t: 'Cable it to a free user port', why: 'Ports 1–8 are for servers, 10 and 11 are taken by PC-01 and PC-02. Use a free one – 12 is fine.', do: ['<b>🔌 Cable</b>: the new PC <b>Ethernet</b> → <b>SW-OFFICE</b> port <b>12</b>.'], tip: 'A green dot on a port means it is already in use – hover to see what is plugged in.', ok: (L, c) => !!c.NP && onSw(L, c.NP), hi: hiCable((c) => c.NP, 'Ethernet', (c) => c.SW, 'Gi1/0/12') },
      { ph: 'Job', t: 'Check its address', why: 'It asked DHCP when the cable went in. 192.168.10.1xx = good.', cm: cmds((c) => c.NP, 'cmd', 'New PC › Command Prompt', [['ipconfig /all', 'Address, gateway and DNS server.'], ['ping google.com', 'The internet by name.']]), ok: (L) => tkOk(L, 'b1', 0) && tkOk(L, 'b1', 2), hi: hiOpen((c) => c.NP, 'cmd') },
      { ph: 'Job', t: 'Open the intranet', why: 'The intranet is a name in the office\'s own DNS (on FS01). If it opens, DNS and the web server both work for her.', cm: cmds((c) => c.NP, 'web', 'New PC › Browser', [['http://intranet.office.local', 'The office intranet page should appear.']]), ok: (L) => tkOk(L, 'b1', 1), hi: hiOpen((c) => c.NP, 'web', () => ['#dpanel #bUrl']) },
    ],
    b2: [
      { ph: 'Job', t: 'Take the dead FS01 out', why: 'A dead server is removed first; its cable comes out and frees port 1.', do: ['Press <b>🗑 Remove</b> and click <b>FS01</b> → <b>OK</b>.'], ok: (L) => !L.devs.FS, hi: (L) => (L.devs.FS ? hiRemove('FS')() : []) },
      { ph: 'Job', t: 'Unpack the new server and cable it to the same port', why: 'Same port = the switch configuration does not change.', do: ['<b>＋ Add device</b> → <b>Windows Server 2022 – new</b>.', '<b>🔌 Cable</b>: <b>Ethernet</b> → SW-OFFICE port <b>1</b>.'], ok: (L, c) => !!c.NW && !!peerOf(L, 'SW1', 'Gi1/0/1') && peerOf(L, 'SW1', 'Gi1/0/1').dev === c.NW.id, hi: (L, c) => (c.NW ? hiCable((x) => x.NW, 'Ethernet', (x) => x.SW, 'Gi1/0/1')(L, c) : hiAdd('winiso')()) },
      { ph: 'Job', t: 'Install Windows Server', why: 'Same Windows Setup as in the lab.', do: ['Click the new server: <b>Next</b> → <b>Standard (Desktop Experience)</b> → <b>Next</b> → <b>Next</b> → <b>Restart now</b>.', 'Password <b>' + PASS + '</b> twice → <b>Finish</b>.'], ok: (L, c) => !!c.NW && !c.NW.setup, hi: hiOpen((c) => c.NW, null, () => ['#dpanel #n']) },
      { ph: 'Job', t: 'Same name, same address', why: 'Users, mapped drives and DNS all point at FS01 / 192.168.10.10. Keep both and nothing else needs changing.', cm: cmds((c) => c.NW, 'ps', 'New server › PowerShell', [['Rename-Computer FS01 -Restart', 'The old name.'], ['New-NetIPAddress -InterfaceAlias Ethernet -IPAddress 192.168.10.10 -PrefixLength 24 -DefaultGateway 192.168.10.1', 'The old address.'], ['Enable-NetFirewallRule -DisplayGroup "File and Printer Sharing"', 'Allow ping.']]), ok: (L) => tkOk(L, 'b2', 1), hi: hiOpen((c) => c.NW, 'ps') },
      { ph: 'Job', t: 'Test from a PC', why: 'Prove it to the user before you close the job.', cm: cmds((c) => c.PC1, 'cmd', 'PC-01 › Command Prompt', [['ping 192.168.10.10', 'Replies = FS01 is back.']]), ok: (L) => tkOk(L, 'b2', 2), hi: hiOpen((c) => c.PC1, 'cmd') },
    ],
    b3: [
      { ph: 'Job', t: 'Unpack a small switch for the second floor', why: 'One cable from the main switch to a floor switch serves many desks on that floor.', do: ['<b>＋ Add device</b> → <b>Switch – 8 ports</b>.'], ok: (L, c) => !!c.NS, hi: hiAdd('sw8') },
      { ph: 'Job', t: 'Connect the two switches', why: 'Switch-to-switch links use the fast uplink ports (Te). The main switch\'s Te1/1/1 already goes to the router – use Te1/1/2.', do: ['<b>🔌 Cable</b>: the new switch → <b>Te1/1/1</b>, then <b>SW-OFFICE</b> → <b>Te1/1/2</b>.'], ok: (L) => tkOk(L, 'b3', 0), hi: hiCable((c) => c.NS, 'Te1/1/1', (c) => c.SW, 'Te1/1/2') },
      { ph: 'Job', t: 'Two PCs on the new switch', why: 'Both switches are in VLAN 1 out of the box, so the router\'s DHCP reaches the new floor too.', do: ['<b>＋ Add device</b> → <b>Windows 11 PC</b> twice.', '<b>🔌 Cable</b> each one to a port on the <b>new</b> switch.'], ok: (L) => tkOk(L, 'b3', 1), hi: (L, c) => { const np = D(L).filter((d) => ['pc', 'laptop'].includes(d.kind) && isNew(d) && !onSw(L, d)).sort(byId)[0]; if (!np) return D(L).filter((d) => ['pc', 'laptop'].includes(d.kind) && isNew(d)).length < 2 ? hiAdd('pcwin')() : []; const free = c.NS && BL.portsOf(c.NS).find((p) => /^Gi/.test(p) && !peerOf(L, c.NS.id, p)); return hiCable(() => np, 'Ethernet', (x) => x.NS, free || 'Gi1/0/1')(L, c); } },
      { ph: 'Job', t: 'Test the internet from the new floor', why: 'If a PC shows 169.254.x.x, run ipconfig /renew.', cm: cmds((c) => D(APP.L).filter((d) => ['pc', 'laptop'].includes(d.kind) && isNew(d)).sort(byId)[0], 'cmd', 'Second-floor PC › Command Prompt', [['ipconfig /renew', 'Ask DHCP again if needed.'], ['ping google.com', 'The internet by name. Do the same on the second PC.']]), ok: (L) => tkOk(L, 'b3', 2) },
    ],
    b4: [
      { ph: 'Job', t: 'Look at the drawing first', why: 'Before typing anything, look: is the host <b>pve1</b> connected to anything? A VM only reaches the network through its host\'s cable.', do: ['Find <b>pve1</b> in the drawing. No line to the switch = no cable.'], hi: () => [Q.dev('PVE1')] },
      { ph: 'Job', t: 'Cable the host', why: 'eno1 carries the bridge vmbr0 – the VM\'s way out.', do: ['<b>🔌 Cable</b>: <b>pve1 eno1</b> → SW-OFFICE port <b>3</b>.'], ok: (L) => tkOk(L, 'b4', 0), hi: hiCable((c) => c.H, 'eno1', (c) => c.SW, 'Gi1/0/3') },
      { ph: 'Job', t: 'Check the VM', why: 'The VM\'s DHCP client asks again by itself once the link comes up.', cm: cmds((c) => c.APP01, 'term', 'app01 › Terminal', [['ip a', 'An address 192.168.10.1xx?'], ['ping -c 3 192.168.10.10', 'FS01.'], ['curl http://192.168.10.11', 'The intranet on web01.']]), ok: (L) => tkOk(L, 'b4', 1) && tkOk(L, 'b4', 2), hi: hiOpen((c) => c.APP01, 'term') },
    ],
    b5: [
      { ph: 'Job', t: 'Take PC-02 out', why: 'Retiring a device frees its switch port.', do: ['<b>🗑 Remove</b> → click <b>PC-02</b> → <b>OK</b>.'], ok: (L) => !L.devs.PC2, hi: (L) => (L.devs.PC2 ? hiRemove('PC2')() : []) },
      { ph: 'Job', t: 'Add the printer on the same port', why: 'Printers get their address from DHCP like PCs. Port 11 is now free.', do: ['<b>＋ Add device</b> → <b>Network printer</b>.', '<b>🔌 Cable</b>: printer → SW-OFFICE port <b>11</b>.'], ok: (L) => tkOk(L, 'b5', 1), hi: (L, c) => (c.PR ? hiCable((x) => x.PR, Object.keys(c.PR.nics || {})[0] || 'eth0', (x) => x.SW, 'Gi1/0/11')(L, c) : hiAdd('printer')()) },
      { ph: 'Job', t: 'Test printing from PC-01', why: 'Printers listen on port 9100 (raw printing) and 631 (IPP). The drawing shows the printer\'s address under its box.', cm: cmds((c) => c.PC1, 'ps', 'PC-01 › PowerShell', (c) => { const ip = c.PR && nic(c.PR).ip; return [[`Test-NetConnection ${ip || '<printer address>'} -Port 9100`, `Can PC-01 reach the printer${ip ? ` (${ip}, shown under its box)` : ''} on its printing port? Look for TcpTestSucceeded : True.`]]; }), ok: (L) => tkOk(L, 'b5', 2), hi: hiOpen((c) => c.PC1, 'ps') },
    ],
  };

  // ---------------------------------------------------------------- state: one guide per lab / job, remembered in the browser
  const GS = store.get('infra:guide', {}) || {};
  const save = () => store.set('infra:guide', GS);
  const key = () => (APP.mode === 'lab' ? 'lab' : APP.tk);
  const steps = () => (APP.mode === 'lab' ? LAB : TK[APP.tk] || null);
  const cx = (L) => (APP.mode === 'lab' ? ctx(L) : tcx(L));
  const active = () => { const S = SESSIONS.find((x) => x.id === APP.sid); return !!(S && S.builder && APP.L && ((APP.mode === 'lab') || (APP.mode === 'fix' && TK[APP.tk]))); };
  const st = () => (GS[key()] ??= { on: false, i: 0, min: false, list: false });
  const done = (s) => { if (!s.ok) return null; const L = APP.L, p = L._probe; L._probe = true; try { return !!s.ok(L, cx(L)); } catch (e) { return false; } finally { L._probe = p; } };

  // ---------------------------------------------------------------- put a command into the right console
  function typeIt(dev, tool, text) {
    if (!dev) { toast('That device is not in the room yet – do the earlier steps first.'); return; }
    if (!(APP.active && APP.active.dev === dev.id && APP.active.tool === tool)) { if (BL.BS.mode !== 'move') { BL.BS.mode = 'move'; BL.BS.from = null; BL.refresh(); } openDevice(dev.id, tool); }
    setTimeout(() => {
      const inp = document.querySelector(tool === 'web' ? '#dpanel #bUrl' : Q.inp);
      if (!inp) { toast(`Open ${dev.hostname}'s console first (✥ Move / open, then click it).`); return; }
      inp.value = text; inp.focus(); try { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
      inp.classList.add('gd-flash'); setTimeout(() => inp.classList.remove('gd-flash'), 1200);
      if (!typeIt.told) { typeIt.told = true; toast(tool === 'web' ? 'Address typed – press Enter or Go.' : 'Command typed – press Enter to run it.'); }
    }, 80);
  }

  // ---------------------------------------------------------------- draw the pop-up
  const lst = (g) => (typeof g.list === 'function' ? g.list(cx(APP.L)) : g.list);
  const box = (g, gi) => { if (!g) return ''; const c = cx(APP.L), d = g.dev(c), list = lst(g); return `<div class="cm"><div class="ct">⌨ ${esc(g.title)}${d ? '' : ' <span class="m">(not in the room yet)</span>'}<span class="sp"></span></div>${list.map(([cmd, e], i) => `<div class="cr"><div class="l"><code>${esc(cmd)}</code><button data-ty="${gi}:${i}">⌨ Type it</button></div>${e ? `<div class="e">${e}</div>` : ''}</div>`).join('')}</div>`; };
  function render(force) {
    const S = steps(), s = st(); let el = document.getElementById('gd'), pill = document.getElementById('gdpill');
    if (!active() || !S || !s.on) { if (el) el.remove(); if (pill) pill.remove(); return null; }
    s.i = Math.max(0, Math.min(S.length - 1, s.i)); const cur = S[s.i], ok = done(cur);
    const oks = s.list || !s.min ? S.map((x) => done(x)) : null;
    const sig = [key(), s.i, ok, s.min, s.list, oks && oks.join(), APP.L && Object.keys(APP.L.devs).length].join('|');
    if (s.min) {
      if (el) el.remove();
      if (!pill) { pill = document.createElement('button'); pill.id = 'gdpill'; document.body.appendChild(pill); pill.onclick = () => { s.min = false; save(); render(true); dock(); }; }
      pill.innerHTML = `🧭 Guide · step ${s.i + 1}/${S.length} ${ok ? '<span class="ok">✓</span>' : ''}`; return cur;
    }
    if (pill) pill.remove();
    if (el && el.dataset.sig === sig && !force) return cur;
    if (!el) { el = document.createElement('div'); el.id = 'gd'; document.body.appendChild(el); if (GS.pos) { el.style.left = GS.pos[0] + 'px'; el.style.top = GS.pos[1] + 'px'; } }
    const phases = [...new Set(S.map((x) => x.ph))];
    const status = ok === null ? '<div class="st rd">📖 Read this, then press <b>Next ▶</b>.</div>' : ok ? '<div class="st ok">✓ Done! Press <b>Next ▶</b> for the next step.</div>' : '<div class="st wt">⏳ Waiting for you – this step ticks itself when it is done. You can still go <b>Next</b> or <b>Back</b>.</div>';
    const sc = [el.querySelector('.gb')?.scrollTop || 0, el.querySelector('.gl')?.scrollTop || 0];
    el.dataset.sig = sig;
    el.innerHTML = `<div class="gh"><span>🧭</span><b>Guide</b><span class="n">step ${s.i + 1} of ${S.length}</span><span class="sp"></span>${GS.pos ? '<button data-g="dock" title="Put the guide back on the left">📌</button>' : ''}<button data-g="min" title="Hide the guide (bring it back with the 🧭 button)">–</button><button data-g="x" title="Close the guide">✕</button></div>
<div class="gp">${S.map((x, i) => `<i class="${i === s.i ? 'c' : oks && oks[i] ? 'd' : ''}" title="${esc(x.t)}"></i>`).join('')}</div>
<div class="gb"><div class="ph">${esc(cur.ph)} · ${phases.indexOf(cur.ph) + 1}/${phases.length}</div><h3>${esc(cur.t)}</h3>${cur.why ? `<div class="why"><b>In plain words:</b> ${cur.why}</div>` : ''}${cur.html || ''}${cur.do ? `<ol>${cur.do.map((x) => `<li>${x}</li>`).join('')}</ol>` : ''}${box(cur.cm, 0)}${box(cur.cm2, 1)}${cur.tip ? `<div class="tip">💡 ${cur.tip}</div>` : ''}${status}</div>
<div class="gf"><button data-g="back" ${s.i ? '' : 'disabled'}>◀ Back</button><button data-g="list" class="${s.list ? 'p' : ''}">☰ Steps</button>${cur.hi ? '<button data-g="show">👆 Show me</button>' : ''}<button data-g="next" class="p ${ok ? 'go' : ''}" ${s.i < S.length - 1 ? '' : 'disabled'}>Next ▶</button></div>
${s.list ? `<div class="gl">${phases.map((p) => `<div class="h">${esc(p)}</div>${S.map((x, i) => (x.ph === p ? `<a data-j="${i}" class="${i === s.i ? 'c' : ''}"><span class="k">${oks[i] ? '✓' : oks[i] === null ? '·' : '○'}</span>${i + 1}. ${esc(x.t)}</a>` : '')).join('')}`).join('')}</div>` : ''}`;
    el.querySelector('[data-g=back]').onclick = () => go(s.i - 1);
    el.querySelector('[data-g=next]').onclick = () => go(s.i + 1);
    el.querySelector('[data-g=list]').onclick = () => { s.list = !s.list; save(); render(true); };
    el.querySelector('[data-g=min]').onclick = () => { s.min = true; s.list = false; save(); render(true); hilite(); dock(); };
    el.querySelector('[data-g=x]').onclick = () => confirmBox('Close the guide? Your place is kept – press 🧭 Guide me to continue later.', () => { s.on = false; save(); render(true); hilite(); syncBtn(); dock(); });
    const dk = el.querySelector('[data-g=dock]'); if (dk) dk.onclick = () => { GS.pos = null; save(); el.style.left = ''; el.style.top = ''; render(true); dock(); };
    const sh = el.querySelector('[data-g=show]'); if (sh) sh.onclick = showMe;
    el.querySelectorAll('[data-j]').forEach((a) => (a.onclick = () => go(+a.dataset.j)));
    el.querySelectorAll('[data-ty]').forEach((b) => (b.onclick = () => { const [g, i] = b.dataset.ty.split(':').map(Number); const G = g ? cur.cm2 : cur.cm; typeIt(G.dev(cx(APP.L)), G.tool, lst(G)[i][0]); }));
    drag(el);
    const gb = el.querySelector('.gb'), gl = el.querySelector('.gl'); if (gb) gb.scrollTop = sc[0]; if (gl) gl.scrollTop = sc[1];
    return cur;
  }
  function go(i) { const s = st(); s.i = i; save(); const el = document.getElementById('gd'); render(true); if (el) { const b = el.querySelector('.gb'); if (b) b.scrollTop = 0; } hilite(); }
  function drag(el) {
    const h = el.querySelector('.gh'); h.onpointerdown = (e) => {
      if (e.target.closest('button') || window.innerWidth <= 760) return; const r = el.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top; h.setPointerCapture(e.pointerId);
      let moved = false;
      h.onpointermove = (ev) => { if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return; moved = true; const x = Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - x0)), y = Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - y0)); el.style.left = x + 'px'; el.style.top = y + 'px'; const was = !!GS.pos; GS.pos = [x, y]; if (!was) dock(); };
      h.onpointerup = () => { h.onpointermove = null; h.onpointerup = null; if (moved) { save(); render(true); } };
    };
  }

  // ---------------------------------------------------------------- orange outlines on what to click next
  function hilite() {
    document.querySelectorAll('.gd-hi').forEach((x) => x.classList.remove('gd-hi'));
    const s = active() && steps() ? st() : null; if (!s || !s.on || s.min) return [];
    const cur = steps()[s.i]; if (!cur || !cur.hi || done(cur) === true) return [];
    let sels = []; try { sels = cur.hi(APP.L, cx(APP.L)) || []; } catch (e) { sels = []; }
    const els = sels.flatMap((q) => [...document.querySelectorAll(q)]).filter((x) => !x.closest('#gd'));
    els.forEach((x) => x.classList.add('gd-hi')); return els;
  }
  function showMe() {
    const els = hilite(); if (!els.length) { toast(steps()[st().i].ok && done(steps()[st().i]) ? 'This step is already done – press Next.' : 'Follow the numbered list in the guide – the next thing to click will light up orange.'); return; }
    try { els[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
    els.forEach((x) => { const t = x.matches('#topo .dv') ? x.querySelector('rect.box') : x; t.classList.add('gd-flash'); setTimeout(() => t.classList.remove('gd-flash'), 1500); });
  }
  function dock() { const s = active() && steps() ? st() : null; document.body.classList.toggle('gd-dock', !!(s && s.on && !s.min && !GS.pos)); }
  function syncBtn() { const b = document.querySelector('#bldbar [data-b=guide]'); if (b) { const s = active() ? st() : null; b.classList.toggle('on', !!(s && s.on)); b.textContent = s && s.on ? (s.min ? '🧭 Show guide' : '🧭 Guide on') : '🧭 Guide me'; } }

  // ---------------------------------------------------------------- keep everything in step with the lab
  let tmr = null;
  const update = () => { clearTimeout(tmr); tmr = setTimeout(() => { try { render(false); hilite(); syncBtn(); dock(); } catch (e) { console.warn(e); } }, 60); };
  ['drawTopo', 'renderDevicePanel', 'afterAction', 'renderMain'].forEach((f) => { const o = window[f]; if (typeof o !== 'function') return; window[f] = function () { const r = o.apply(this, arguments); update(); return r; }; });
  new MutationObserver(update).observe(document.body, { childList: true });
  window.addEventListener('resize', () => { const el = document.getElementById('gd'); if (el && GS.pos) { el.style.left = Math.min(GS.pos[0], window.innerWidth - 120) + 'px'; el.style.top = Math.min(GS.pos[1], window.innerHeight - 60) + 'px'; } });

  window.GUIDE = {
    toggle() { if (!active()) return; const s = st(); if (!s.on) { s.on = true; s.min = false; } else s.min = !s.min; save(); render(true); hilite(); syncBtn(); dock(); },
    go, typeIt, steps, state: st, LAB, TK,
  };
  update();
})();
