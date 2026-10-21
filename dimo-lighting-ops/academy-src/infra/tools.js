// =================== Device tools: which consoles and screens each kind of device has, and the PC screens (network settings, browser, sign-in, files)
const isWin = (d) => (d.os || 'win') === 'win';
TOOLS.pc = [
  { id: 'cmd', label: 'Command Prompt', when: isWin, term: (L, d) => winShell(L, d, { user: d.loggedOn || 'User' }) },
  { id: 'ps', label: 'PowerShell', when: isWin, term: (L, d) => Object.assign(winShell(L, d, { ps: true, user: d.loggedOn || 'User' }), { banner: 'Windows PowerShell\nCopyright (C) Microsoft Corporation. All rights reserved.\n\n' }) },
  { id: 'term', label: 'Terminal', when: (d) => d.os === 'linux', term: (L, d) => lxShell(L, d) },
  { id: 'net', label: 'Network settings', when: isWin, gui: guiNetSettings },
  { id: 'web', label: 'Browser', gui: guiBrowser },
  { id: 'signin', label: 'Sign in', when: (d, L) => isWin(d) && !!(L.ad || d.domain), gui: guiSignIn },
  { id: 'files', label: 'File Explorer', when: (d, L) => isWin(d) && !!(L.ad || d.drives), gui: guiFiles },
  { id: 'fct', label: 'FortiClient VPN', when: (d) => !!d.fct, gui: guiFortiClient },
  { id: 'wifi', label: 'Wi-Fi', when: (d) => d.wprof !== undefined, gui: guiWifi },
  { id: 'shark', label: 'Wireshark', when: (d) => !!d.shark, gui: guiShark },
  { id: 'svcs', label: 'Services', when: isWin, gui: guiServices },
  { id: 'evt', label: 'Event Viewer', when: isWin, gui: guiEventViewer },
];
TOOLS.ap = [{ id: 'wlc', label: 'Wireless controller', gui: guiWlc }];
TOOLS.laptop = TOOLS.pc;
TOOLS.srv = [
  { id: 'ps', label: 'PowerShell', when: isWin, term: (L, d) => Object.assign(winShell(L, d, { ps: true, user: 'Administrator' }), { banner: 'Windows PowerShell\nCopyright (C) Microsoft Corporation. All rights reserved.\n\n' }) },
  { id: 'cmd', label: 'Command Prompt', when: isWin, term: (L, d) => winShell(L, d, { user: 'Administrator' }) },
  { id: 'term', label: 'Terminal', when: (d) => d.os === 'linux', term: (L, d) => lxShell(L, d) },
  { id: 'net', label: 'Network settings', when: isWin, gui: guiNetSettings },
  { id: 'nms', label: 'LibreNMS', when: (d) => !!d.nms, gui: guiNms },
  { id: 'srvmgr', label: 'Server Manager', when: (d) => isServerGui(d), gui: guiServerManager },
  { id: 'svcs', label: 'Services', when: (d) => isWin(d) && !d.core, gui: guiServices },
  { id: 'evt', label: 'Event Viewer', when: (d) => isWin(d) && !d.core, gui: guiEventViewer },
  { id: 'aduc', label: 'AD Users and Computers', when: (d, L) => isServerGui(d) && !!L.ad && (d.dc || d.features?.includes('RSAT-ADDS')), gui: guiADUC },
  { id: 'gpmc', label: 'Group Policy Management', when: (d, L) => isServerGui(d) && !!L.ad && (d.dc || d.features?.includes('GPMC')), gui: guiGPMC },
  { id: 'dnsmgr', label: 'DNS', when: (d) => isServerGui(d) && (d.features?.includes('DNS') || d.features?.includes('RSAT-DNS-Server')), gui: guiDnsMgr },
  { id: 'dhcpmgr', label: 'DHCP', when: (d) => isServerGui(d) && !!d.dhcpd, gui: guiDhcpMgr },
  { id: 'shark', label: 'Wireshark', when: (d) => !!d.shark, gui: guiShark },
];
TOOLS.vm = TOOLS.srv;
TOOLS.sw = [{ id: 'con', label: 'Console', term: (L, d) => Object.assign(iosShell(L, d), { banner: `\nUser Access Verification\n\n(${d.hostname} – Cisco IOS style console. Type "enable", then "?" for help.)\n\n` }) }];
TOOLS.rt = TOOLS.sw;
TOOLS.fw = [{ id: 'cli', label: 'CLI Console', term: (L, d) => Object.assign(fgShell(L, d), { banner: `${d.cfg['system global'].hostname?.[0] || d.hostname} login: admin\nPassword: ********\nWelcome!\n\n` }) }, { id: 'gui', label: 'Web GUI', gui: guiFortiGate }];
TOOLS.phone = [{ id: 'st', label: 'Phone status', gui: (el, L, d) => { const v = phoneVoice(L, d); const p = powered(L, d); el.innerHTML = `<div class="gui"><h3>☎ IP phone ${esc(d.ext)}</h3><table><tr><td>Power (PoE)</td><td>${p ? '<span class="pill g">On</span>' : '<span class="pill r">No power – the switch port gives no PoE</span>'}</td></tr><tr><td>Voice VLAN (from CDP/LLDP)</td><td>${v ?? '<span class="pill y">none – the phone uses the data VLAN untagged</span>'}</td></tr><tr><td>IP address</td><td>${d.ip || '<span class="pill r">no address</span>'}</td></tr><tr><td>Registered to call server</td><td>${p && d.ip && d.registered !== false ? '<span class="pill g">Registered</span>' : '<span class="pill r">Not registered</span>'}</td></tr></table></div>`; } }];

// ---------------------------------------------------------------- Windows network adapter settings (IPv4 properties)
function guiNetSettings(el, L, d, done) {
  winInit(L, d); const [n, c] = winNic(d);
  const link = nicLinked(L, d, n);
  el.innerHTML = `<div class="gui"><h3>${esc(n)} – Internet Protocol Version 4 (TCP/IPv4) Properties</h3><p class="m">Status: ${c.up === false ? '<span class="pill n">Disabled</span>' : link ? '<span class="pill g">Connected</span>' : '<span class="pill r">Network cable unplugged</span>'} · MAC ${macDash(c.mac).toUpperCase()}</p>
  <label><input type="radio" name="m" value="auto" ${c.dhcp ? 'checked' : ''}> Obtain an IP address automatically</label><br><label><input type="radio" name="m" value="st" ${!c.dhcp ? 'checked' : ''}> Use the following IP address:</label>
  <div class="grid3" style="margin:6px 0 10px 22px"><label class="f">IP address<input id="nIp" value="${esc(c.dhcp ? '' : c.ip || '')}"></label><label class="f">Subnet mask<input id="nMk" value="${esc(c.dhcp ? '' : c.mask || '')}"></label><label class="f">Default gateway<input id="nGw" value="${esc(c.dhcp ? '' : c.gw || '')}"></label></div>
  <div class="grid3" style="margin:0 0 10px 22px"><label class="f">Preferred DNS server<input id="nD1" value="${esc((c.dns || [])[0] || '')}"></label><label class="f">Alternate DNS server<input id="nD2" value="${esc((c.dns || [])[1] || '')}"></label></div>
  <div class="tb"><button class="btn p" id="nOk">OK</button><button class="btn" id="nDis">${c.up === false ? 'Enable adapter' : 'Disable adapter'}</button><button class="btn" id="nDiag">Diagnose</button></div><div id="nMsg" class="hint"></div></div>`;
  $('#nOk', el).onclick = () => {
    const auto = $('input[name=m]:checked', el).value === 'auto'; const v = (id) => $(id, el).value.trim();
    if (auto) { Object.assign(c, { dhcp: true, ip: null, mask: null, gw: null, tried: false, apipa: null, dup: false }); c.dns = [v('#nD1'), v('#nD2')].filter(Boolean); if (!c.dns.length) c.dns = []; settle(L); }
    else { const ip = v('#nIp'), m = v('#nMk'), gw = v('#nGw'); if (!isIp(ip) || !isMask(m)) return ($('#nMsg', el).innerHTML = '<span class="bad">The IP address or subnet mask is not valid.</span>'); if (gw && !isIp(gw)) return ($('#nMsg', el).innerHTML = '<span class="bad">The default gateway is not valid.</span>'); if (gw && !sameNet(ip, gw, m)) toast('Microsoft TCP/IP: The default gateway is not on the same network segment (subnet) that is defined by the IP address and subnet mask. Do you want to save this configuration? – saved'); Object.assign(c, { dhcp: false, ip, mask: m, gw: gw || null, setAt: L.clock, dup: false, apipa: null, lease: null }); c.dns = [v('#nD1'), v('#nD2')].filter(Boolean); settle(L, 'nodhcp'); if (c.dup) toast('Windows has detected an IP address conflict.'); }
    d.dnsCache = {}; L.cmdlog.push({ dev: d.id, kind: 'gui', line: 'ipv4-properties', t: L.clock }); done();
  };
  $('#nDis', el).onclick = () => { c.up = c.up === false; if (c.up && c.dhcp) { c.ip = null; c.tried = false; } settle(L); done(); };
  $('#nDiag', el).onclick = () => { const gw = c.gw; let msg; if (c.up === false) msg = 'The Ethernet adapter is disabled.'; else if (!link) msg = 'Network cable unplugged – the cable or the switch port is down.'; else if (!c.ip || c.dup) msg = c.dup ? 'Windows detected an IP address conflict. Another device on the network uses the same IP address.' : '"Ethernet" doesn\'t have a valid IP configuration (the DHCP server did not answer).'; else if (!gw) msg = 'No default gateway is set.'; else if (!sameNet(c.ip, gw, c.mask)) msg = 'The default gateway is not available (it is not on this subnet).'; else if (send(L, d.id, { dst: gw }).res !== 'ok') msg = 'The default gateway is not available.'; else if (!(c.dns || []).length || winResolve({ L, d }, 'www.dimo.lk').err) msg = 'Your computer appears to be correctly configured, but the device or resource (DNS server) is not responding.'; else msg = 'Troubleshooting couldn\'t identify the problem.'; $('#nMsg', el).innerHTML = `<b>Windows Network Diagnostics:</b> ${esc(msg)}`; };
}
// ---------------------------------------------------------------- a browser
function guiBrowser(el, L, d, done) {
  const st = (APP.browser ??= {})[d.id] ??= { url: d.home || 'http://www.dimo.lk' };
  el.innerHTML = `<div class="gui"><div class="tb"><input id="bUrl" style="flex:1;min-width:200px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-family:var(--mono)" value="${esc(st.url)}"><button class="btn p" id="bGo">Go</button></div><div id="bPage" style="border:1px solid var(--line);border-radius:8px;min-height:240px;padding:14px;background:#fff"></div></div>`;
  const go = () => {
    const url = $('#bUrl', el).value.trim(); st.url = url; const m = url.match(/^(https?):\/\/([^/:]+)(:(\d+))?/) || [null, 'http', url.replace(/\/.*/, '')]; const host = m[2], port = +(m[4] || (m[1] === 'https' ? 443 : 80));
    const err = (code, t, s) => ($('#bPage', el).innerHTML = `<div style="max-width:520px"><div style="font-size:40px">😟</div><h3>${t}</h3><p class="m">${s}</p><p class="mono m">${code}</p></div>`);
    const r = isIp(host) ? { ip: host } : d.os === 'linux' ? lxResolve(lxSession(L, d), host) : winResolve({ L, d }, host);
    L.cmdlog.push({ dev: d.id, kind: 'browser', line: url, t: L.clock });
    if (!r.ip) return err('DNS_PROBE_FINISHED_NXDOMAIN', 'Hmm… can\'t reach this page', `Check if there is a typo in ${esc(host)}. If spelling is correct, try running Windows Network Diagnostics.`), done();
    const t = send(L, d.id, { dst: r.ip, proto: 'tcp', dport: port });
    if (t.res === 'refused') return err('ERR_CONNECTION_REFUSED', 'Hmm… can\'t reach this page', `${esc(host)} refused to connect.`), done();
    if (t.res !== 'ok') return err('ERR_CONNECTION_TIMED_OUT', 'Hmm… can\'t reach this page', `${esc(host)} took too long to respond.`), done();
    const pg = httpServe(L, L.devs[t.at], m[1], host, port);
    if (pg?.err) { const exp = /expired/.test(pg.err); return err(exp ? 'NET::ERR_CERT_DATE_INVALID' : /self-signed/.test(pg.err) ? 'NET::ERR_CERT_AUTHORITY_INVALID' : /alternative/.test(pg.err) ? 'NET::ERR_CERT_COMMON_NAME_INVALID' : 'ERR_SSL_PROTOCOL_ERROR', 'Your connection isn\'t private', exp ? `Attackers might be trying to steal your information from ${esc(host)}. The certificate of this site has expired.` : `Attackers might be trying to steal your information from ${esc(host)}. The certificate is not trusted.`), done(); }
    $('#bPage', el).innerHTML = `<div class="m mono" style="font-size:11.5px;margin-bottom:8px">${m[1] === 'https' ? '🔒' : 'ⓘ Not secure'} ${esc(url)}</div>${(pg?.body || '<h1>It works!</h1>').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<(\/?)(html|head|body|title)[^>]*>/gi, '').replace(/ on\w+=/gi, ' data-x=')}`; done();
  };
  $('#bGo', el).onclick = go; $('#bUrl', el).onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
// ---------------------------------------------------------------- domain sign-in
function guiSignIn(el, L, d, done) {
  winInit(L, d);
  if (d.loggedOn && d.loggedOn !== 'User') { const r = d.rsop; el.innerHTML = `<div class="gui"><h3>Signed in as ${esc((L.ad?.netbios || d.hostname) + '\\' + d.loggedOn)}</h3>${d.logonMs ? `<p class="m">Sign-in took ${(d.logonMs / 1000).toFixed(1)} s${d.logonMs > 6000 ? ' – <b>slow</b>' : ''}</p>` : ''}${d.cachedLogon ? '<p class="warn">Signed in with cached credentials – the domain was not reachable.</p>' : ''}<table><tr><td>Logon server</td><td>${esc(d.logonDc ? '\\\\' + L.devs[d.logonDc]?.hostname : '—')}</td></tr><tr><td>Mapped drives</td><td>${Object.entries(d.drives || {}).map(([k, v]) => `${k}: → ${esc(v)}`).join('<br>') || '—'}</td></tr><tr><td>Printers</td><td>${(d.printers || []).map(esc).join('<br>') || '—'}</td></tr><tr><td>Group Policy</td><td>${r ? (r.err ? `<span class="bad">failed (${r.err === 'nodc' ? 'no domain controller' : 'SYSVOL not reachable'})</span>` : `${[...r.comp, ...r.user].map(esc).join(', ') || 'no GPOs applied'}`) : '—'}</td></tr></table><div class="tb" style="margin-top:10px"><button class="btn" id="sOut">Sign out</button></div></div>`; $('#sOut', el).onclick = () => { d.loggedOn = null; d.drives = {}; done(); }; return; }
  el.innerHTML = `<div class="gui" style="display:flex;justify-content:center"><div style="width:320px;text-align:center;padding:20px 0"><div style="font-size:54px">👤</div><h3>Other user</h3><input id="sU" placeholder="User name (DIMO\\nimal)" style="width:100%;padding:8px;margin:4px 0;border:1px solid var(--line);border-radius:6px"><input id="sP" type="password" placeholder="Password" style="width:100%;padding:8px;margin:4px 0;border:1px solid var(--line);border-radius:6px"><p class="hint">Sign in to: ${esc((d.domain || L.ad?.domain || 'this PC').toUpperCase().split('.')[0])}</p><button class="btn p" id="sGo" style="width:100%">Sign in →</button><p id="sMsg" style="text-align:left;margin-top:10px"></p></div></div>`;
  const go = () => { const r = adLogon(L, d, $('#sU', el).value.trim(), $('#sP', el).value); L.cmdlog.push({ dev: d.id, kind: 'signin', line: $('#sU', el).value.trim(), ok: r.ok, t: L.clock }); if (!r.ok) { $('#sMsg', el).innerHTML = `<span class="bad">${esc(r.msg)}</span>`; done && afterAction(); return; } if (r.cached) toast(r.msg, 6000); done(); };
  $('#sGo', el).onclick = go; $('#sP', el).onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
// ---------------------------------------------------------------- File Explorer (mapped drives and \\server\share)
function guiFiles(el, L, d, done) {
  const H = winHost(L, d, { user: d.loggedOn || 'User' }); const st = (APP.fx ??= {})[d.id] ??= { path: Object.keys(d.drives || {})[0] ? `${Object.keys(d.drives)[0]}:\\` : '\\\\' };
  let list = [], msg = '';
  try { if (st.path === '\\\\' || !st.path) list = []; else { const p = psPath(H, st.path); list = /^\\\\[^\\]+$/.test(p) ? [] : /^\\\\/.test(p) ? smbList(H, p) : PS_CMD['get-childitem'].fn(H, { Path: p }); } } catch (e) { msg = e.message; }
  el.innerHTML = `<div class="gui"><div class="tb"><input id="fP" style="flex:1;padding:6px 8px;border:1px solid var(--line);border-radius:6px;font-family:var(--mono)" value="${esc(st.path)}"><button class="btn" id="fGo">Open</button><button class="btn" id="fNew">New text file</button></div><div class="grid3" style="grid-template-columns:200px 1fr"><div><b class="m" style="font-size:12px">This PC</b>${Object.entries(d.drives || {}).map(([k, v]) => `<div><a href="#" data-p="${k}:\\">💽 ${esc(v.split('\\').pop())} (\\\\${esc(v.split('\\')[2])}) (${k}:)</a></div>`).join('') || '<div class="m">No mapped drives</div>'}</div><div>${msg ? `<p class="bad">⚠ ${esc(msg)}</p>` : ''}<table><tr><th>Name</th><th>Date modified</th><th>Size</th></tr>${list.map((f) => `<tr><td>${f.Mode?.startsWith('d') ? '📁' : '📄'} ${esc(f.Name)}</td><td>${esc(psStr(f.LastWriteTime))}</td><td>${f.Length !== '' ? Math.ceil((f.Length || 0) / 1024) + ' KB' : ''}</td></tr>`).join('')}</table></div></div></div>`;
  $$('[data-p]', el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); st.path = a.dataset.p; guiFiles(el, L, d, done); }));
  $('#fGo', el).onclick = () => { st.path = $('#fP', el).value.trim(); L.cmdlog.push({ dev: d.id, kind: 'files', line: st.path, t: L.clock }); guiFiles(el, L, d, done); done && afterAction(); };
  $('#fNew', el).onclick = () => { try { psWriteFile(H, psPath(H, `${st.path.replace(/\\$/, '')}\\New Text Document.txt`), 'test'); L.cmdlog.push({ dev: d.id, kind: 'files', line: 'write ' + st.path, ok: true, t: L.clock }); toast('Created New Text Document.txt'); } catch (e) { L.cmdlog.push({ dev: d.id, kind: 'files', line: 'write ' + st.path, ok: false, t: L.clock }); toast(`⚠ ${e.message}`); } guiFiles(el, L, d, done); afterAction(); };
}
