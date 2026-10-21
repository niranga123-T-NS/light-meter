// =================== Session 7 – Wi-Fi: SSIDs on VLANs, bands and channels, WPA2/WPA3, guest isolation, controller vs standalone, site survey
const WF7 = { staff: 'Dimo@Staff2026', guest: 'Welcome@Dimo' };
function wifiOffice(o = {}) {
  const fgDhcp = (n, ifn, net) => ({ interface: [ifn], 'default-gateway': [`${net}.1`], netmask: ['255.255.255.0'], 'dns-server1': ['8.8.8.8'], 'ip-range': { 1: { 'start-ip': [`${net}.100`], 'end-ip': [`${net}.199`] } } });
  const pol = (name, si) => ({ name: [name], srcintf: [si], dstintf: ['port1'], srcaddr: ['all'], dstaddr: ['all'], service: ['ALL'], action: ['accept'], schedule: ['always'], nat: ['enable'] });
  const lt = (id, hn, fx, fy, x, y, more = {}) => ({ id, kind: 'laptop', x, y, hostname: hn, os: 'win', nics: { 'Wi-Fi': { dhcp: true } }, fx, fy, wprof: null, ...more });
  const spec = {
    devs: [
      B.isp(330, 30, { a: { cidr: '203.115.21.5/30' } }),
      { id: 'FGT', kind: 'fw', x: 330, y: 100, hostname: 'FGT-HQ', ifs: { port1: { cidr: '203.115.21.6/30', access: 'ping', role: 'wan' }, port2: { cidr: '10.10.1.1/24', access: 'ping https ssh', role: 'lan', alias: 'MGMT' }, staff: { cidr: '10.10.10.1/24', vlan: 10, parent: 'port2', access: 'ping', role: 'lan' }, guest: { cidr: '10.10.20.1/24', vlan: 20, parent: 'port2', access: 'ping', role: 'lan' } }, cfg: { 'router static': { 1: { gateway: ['203.115.21.5'], device: ['port1'] } }, 'system dhcp server': { 1: fgDhcp(1, 'port2', '10.10.1'), 2: fgDhcp(2, 'staff', '10.10.10'), 3: fgDhcp(3, 'guest', '10.10.20') }, 'firewall policy': { 1: pol('Staff-Internet', 'staff'), 2: pol('Guest-Internet', 'guest'), 3: pol('Mgmt-Internet', 'port2') } } },
      B.sw('SW', 330, 180, 8, { hn: 'SW-FLOOR1', x: { vlans: { 1: 'default', 10: 'STAFF', 20: 'GUEST' } } }),
      B.win('SRV', 470, 180, '10.10.10.10/24', { gw: '10.10.10.1', dns: ['8.8.8.8'], hn: 'FILE-SRV', x: { svc: { LanmanServer: { display: 'Server', start: 'Automatic', status: 'Running', tcp: [445, 139] } } } }),
      { id: 'AP1', kind: 'ap', x: 220, y: 250, hostname: 'AP-WEST', fx: 8, fy: 10, poe: 13, dhcp: true, ch: 6, ch5: 36, pw: 17, pw5: 17 },
      { id: 'AP2', kind: 'ap', x: 440, y: 250, hostname: 'AP-EAST', fx: 30, fy: 6, poe: 13, dhcp: true, ch: 6, ch5: 36, pw: 17, pw5: 17 },
      lt('LT1', 'STAFF-LT01', 10, 14, 150, 330), lt('LTF', 'STAFF-LT07', 37, 17, 520, 330), lt('LTO', 'STORES-LT02', 27, 3, 430, 330, { wband: ['2.4'], wsec: ['wpa2'], wstd: 'n' }),
      lt('LTG', 'GUEST-LT', 3, 4, 250, 340, { wsec: ['wpa2', 'wpa3'] }), lt('LTG2', 'GUEST-PHONE', 5, 6, 330, 340),
    ],
    links: [['ISP:a', 'FGT:port1'], ['FGT:port2', 'SW:Gi1/0/8'], ['AP1:eth0', 'SW:Gi1/0/1'], ['AP2:eth0', 'SW:Gi1/0/2'], ['SRV:Ethernet', 'SW:Gi1/0/5']],
    post: (L) => {
      L.floor = { w: 40, h: 20, walls: [[18, 0, 18, 8, 12, 'Lift core'], [22, 0, 22, 8, 12, 'Lift core'], [18, 8, 22, 8, 12, 'Lift core'], [24, 8, 40, 8, 4, 'Office partition'], [12, 12, 12, 20, 3, 'Meeting room glass'], [34, 12, 34, 20, 12, 'Server/store room (concrete)'], [34, 12, 40, 12, 12, 'Server/store room (concrete)']], foreign: [{ name: 'NEIGHBOUR-WIFI', fx: 41, fy: 2, ch: 6, ch5: 149, pw: 20, sec: 'wpa2' }] };
      L.wlc = { ssids: [] };
      const p = L.devs.SW.ports; p['Gi1/0/8'].mode = 'trunk'; p['Gi1/0/5'].vlan = 10;
      if (o.done) wifiDone(L); if (o.post) o.post(L); settle(L);
    },
  };
  return spec;
}
function wifiDone(L) {
  const p = L.devs.SW.ports; ['Gi1/0/1', 'Gi1/0/2'].forEach((x) => Object.assign(p[x], { mode: 'trunk', native: 1, allowed: '1,10,20' }));
  L.wlc.ssids = [{ name: 'DIMO-STAFF', sec: 'wpa2/3', psk: WF7.staff, vlan: 10, band: 'both' }, { name: 'DIMO-GUEST', sec: 'wpa2/3', psk: WF7.guest, vlan: 20, band: 'both', isolate: true }];
  Object.assign(L.devs.AP1, { ch: 1, ch5: 36 }); Object.assign(L.devs.AP2, { ch: 11, ch5: 52, fx: 32, fy: 13 });
  [['LT1', 'DIMO-STAFF', WF7.staff], ['LTF', 'DIMO-STAFF', WF7.staff], ['LTO', 'DIMO-STAFF', WF7.staff], ['LTG', 'DIMO-GUEST', WF7.guest], ['LTG2', 'DIMO-GUEST', WF7.guest]].forEach(([c, s, k]) => { L.devs[c].wprof = { ssid: s, psk: k }; (L.devs[c].wsaved ??= {})[s] = k; });
  settle(L); settle(L);
}
const ssidOf = (L, n) => (L.wlc?.ssids || []).find((s) => s.name === n);
const trunkFor = (p, vs) => p.mode === 'trunk' && (p.allowed === 'all' || vs.every((v) => String(p.allowed).split(',').some((r) => { const [a, b] = r.split('-').map(Number); return v >= a && v <= (b ?? a); })));
SESSIONS.push({
  id: 's07', n: 7, mod: 1, title: 'Wi-Fi', focus: 'SSIDs, bands and channels, WPA2/WPA3, guest isolation, controller vs standalone APs, site survey basics', milestone: 'Staff and guest Wi-Fi live',
  concept: [
    { h: 'SSIDs, VLANs and the AP uplink', html: `<p>An <b>SSID</b> is a network name. Each SSID maps to a <b>VLAN</b>: DIMO-STAFF → VLAN 10, DIMO-GUEST → VLAN 20. The AP tags the clients' frames and sends them up its cable – so the switch port to an AP must be a <b>trunk</b> carrying those VLANs (native VLAN = the AP's own management VLAN).</p><p><b>Controller vs standalone:</b> standalone APs are configured one by one. With a <b>controller</b> (FortiGate WiFi controller, Cisco WLC, UniFi …) you define SSIDs once and the controller pushes them to every AP, picks channels and shows all clients in one place.</p><p><b>Guest isolation:</b> guests land in their own VLAN with internet-only firewall policies, and <i>client isolation</i> stops guests talking to each other.</p>` },
    { h: 'Bands and channels', html: `<p><b>2.4 GHz</b> reaches further and goes through walls better, but has only <b>three channels that do not overlap: 1, 6 and 11</b>. Each network is 20 MHz wide (about 4 channel numbers), so channels 3 and 6 overlap and interfere badly.</p><p><b>5 GHz</b> has many non-overlapping channels and much more speed, but shorter range and more loss through walls.</p><ul><li><b>Co-channel</b> (same channel): radios take turns – the airtime is shared, everyone is slower.</li><li><b>Overlapping channel</b> (e.g. 4 vs 6): the other signal is just noise – errors and retries.</li></ul><p>Plan: neighbouring APs on 1 / 6 / 11, avoid the neighbour's channel, different 5 GHz channels.</p>`, w: 'chan24', check: [
      { q: 'Two APs in the same open office are both on 2.4 GHz channel 6. What happens?', a: ['Double the speed', 'They share airtime – clients on both are slower', 'Nothing', 'Clients cannot connect'], c: 1, why: 'Co-channel contention.' },
      { q: 'Which set of 2.4 GHz channels do not overlap?', a: ['1, 2, 3', '1, 6, 11', '6, 7, 8', '1, 5, 9, 13 in every country'], c: 1, why: '20 MHz channels 5 apart.' },
    ] },
    { h: 'Security: WPA2, WPA3, enterprise', html: `<p><b>WPA2-Personal</b>: one passphrase for everyone. <b>WPA3-Personal</b> (SAE) is stronger against password guessing, but older devices do not support it. <b>WPA2/WPA3 transition mode</b> lets both join. <b>Enterprise</b> (802.1X) gives each user their own login via a RADIUS server – best for staff.</p><p>Wrong passphrase = "4-way handshake failed" in the controller log, and on Windows <i>"Can't connect to this network"</i>. A client that only supports WPA2 cannot join a WPA3-only SSID.</p>`, check: [
      { q: 'After switching the staff SSID to WPA3-only, one old laptop cannot join. Best fix?', a: ['Open network', 'WPA2/WPA3 transition mode (or replace the laptop)', 'Hide the SSID', 'Change the VLAN'], c: 1, why: 'Keep security, allow WPA2 clients.' },
    ] },
    { h: 'Site survey basics', html: `<p>Targets for a good office: signal <b>≥ −67 dBm</b> (for voice/video) everywhere people work, <b>SNR ≥ 25 dB</b>, and APs overlapping a little so laptops can roam. Concrete walls cost about 12 dB, drywall 3–5 dB – and more at 5 GHz.</p><p>A survey walks the floor and measures; here you click on the floor plan to take readings, and drag APs to better places. Turning the power up is rarely the answer – the AP gets louder but the laptop does not.</p>`, w: 'rssi', check: [
      { q: 'A desk measures −79 dBm. What should you do first?', a: ['Max out AP power', 'Move an AP (or add one) closer, past the concrete wall', 'Change the SSID name', 'Switch to WPA3'], c: 1, why: 'Fix coverage with placement.' },
    ] },
  ],
  lab: {
    title: 'Lab: staff and guest Wi-Fi on separate VLANs, a clean channel plan and full coverage',
    intro: `<p>Two FortiAP-style access points (AP-WEST, AP-EAST) hang off <b>SW-FLOOR1</b> ports Gi1/0/1–2. The FortiGate already has VLAN 10 (staff 10.10.10.0/24) and VLAN 20 (guest 10.10.20.0/24) on port2, with DHCP and internet policies; staff and guest cannot reach each other. Open an AP to reach the <b>Wireless controller</b>. Open a laptop's <b>Wi-Fi</b> screen to connect it.</p><ul><li>DIMO-STAFF → VLAN 10, passphrase <code>${WF7.staff}</code>. STORES-LT02 is an old laptop: 2.4 GHz and WPA2 only.</li><li>DIMO-GUEST → VLAN 20, passphrase <code>${WF7.guest}</code>, guests must not see each other.</li></ul>`,
    build: () => wifiOffice(), open: ['AP1', 'SW'],
    tasks: [
      { id: 'trunk', t: 'SW-FLOOR1 Gi1/0/1 and Gi1/0/2 (the APs) are trunks: native VLAN 1, carrying VLANs 10 and 20.', check: (L) => ['Gi1/0/1', 'Gi1/0/2'].every((x) => { const p = L.devs.SW.ports[x]; return trunkFor(p, [1, 10, 20]) && +(p.native ?? 1) === 1; }), hint: '<code>interface range g1/0/1 - 2</code> → <code>switchport mode trunk</code> → <code>switchport trunk allowed vlan 1,10,20</code>.' },
      { id: 'ssid', t: 'SSIDs on the controller: DIMO-STAFF (VLAN 10) and DIMO-GUEST (VLAN 20, client isolation on), both secured with the passphrases above.', check: (L) => { const a = ssidOf(L, 'DIMO-STAFF'), b = ssidOf(L, 'DIMO-GUEST'); return !!a && !!b && a.vlan === 10 && b.vlan === 20 && !!b.isolate && a.sec !== 'open' && b.sec !== 'open' && a.psk === WF7.staff && b.psk === WF7.guest; } },
      { id: 'staff', t: 'STAFF-LT01 and STORES-LT02 are on DIMO-STAFF with a 10.10.10.x address and open the file server (\\\\10.10.10.10, SMB 445).', check: (L) => ['LT1', 'LTO'].every((c) => wifiQuality(L, L.devs[c])?.ssid.name === 'DIMO-STAFF' && inSub(L, c, '10.10.10.0', 24) && C.reach(L, c, '10.10.10.10', 445)), hint: 'The old laptop only speaks WPA2 – choose WPA2/WPA3 transition mode for the staff SSID.' },
      { id: 'guest', t: 'GUEST-LT and GUEST-PHONE are on DIMO-GUEST with 10.10.20.x addresses, reach the internet (8.8.8.8), and cannot reach the file server.', check: (L) => ['LTG', 'LTG2'].every((c) => wifiQuality(L, L.devs[c])?.ssid.name === 'DIMO-GUEST' && inSub(L, c, '10.10.20.0', 24) && C.ping(L, c, '8.8.8.8') && !C.reach(L, c, '10.10.10.10', 445)) },
      { id: 'chan', t: 'Channel plan: 2.4 GHz on non-overlapping channels (1/6/11), the two APs different and away from the neighbour; different 5 GHz channels. STORES-LT02 then gets at least 25 Mbps.', check: (L) => { const a = L.devs.AP1, b = L.devs.AP2; return [a.ch, b.ch].every((c) => [1, 6, 11].includes(c)) && a.ch !== b.ch && a.ch5 !== b.ch5 && (wifiQuality(L, L.devs.LTO)?.mbps || 0) >= 25; }, hint: 'Use Spectrum (scan from STORES-LT02) to see who is on which channel.' },
      { id: 'cover', t: 'Site survey: STAFF-LT07 in the store room corner gets at least −67 dBm on 5 GHz. Move an AP – do not just turn the power up.', check: (L) => { const q = wifiQuality(L, L.devs.LTF); return !!q && q.band === '5' && q.rssi >= -67; }, hint: 'Floor plan → 5 GHz. The store room has concrete walls. Drag AP-EAST near the store room door and take readings.' },
      { id: 'nb', t: 'Which 2.4 GHz channel is NEIGHBOUR-WIFI on?', ans: () => '6', hint: 'Spectrum tab, or <code>netsh wlan show networks mode=bssid</code> on a laptop.' },
    ],
  },
  tickets: [
    { id: 't1', no: 4703, title: 'Wi-Fi in the stores area is painfully slow', who: 'Stores', text: '<p>"The stores laptop takes ages to load anything. It connects fine, just slow." (A contractor "optimised" the APs on Monday.)</p>', build: () => wifiOffice({ done: true }), open: ['AP2', 'LTO'], fault: (L) => { L.devs.AP2.ch = 6; L.devs.AP1.ch = 6; }, hint: 'Clients tab: look at channel busy and SNR for STORES-LT02. Then Spectrum.', checks: [{ t: 'STORES-LT02 gets at least 25 Mbps', f: (L) => (wifiQuality(L, L.devs.LTO)?.mbps || 0) >= 25 }, { t: 'Both APs on non-overlapping 2.4 GHz channels', f: (L) => [L.devs.AP1.ch, L.devs.AP2.ch].every((c) => [1, 6, 11].includes(c)) && L.devs.AP1.ch !== L.devs.AP2.ch }] },
    { id: 't2', no: 4710, title: 'Visitors cannot join the guest Wi-Fi', who: 'Reception', prio: 'High', text: `<p>"Since this morning no visitor can connect to DIMO-GUEST. The card on the desk says <b>${WF7.guest}</b>, same as always." (IT changed the guest passphrase last night as part of a rotation – then rolled it back.)</p>`, build: () => wifiOffice({ done: true }), open: ['LTG', 'AP1'], fault: (L) => { ssidOf(L, 'DIMO-GUEST').psk = 'Welcome@Dim0'; }, hint: 'Clients tab shows why association fails. Compare the controller with the card – letter O or zero?', checks: [{ t: 'GUEST-LT connected', f: (L) => wifiQuality(L, L.devs.LTG)?.ssid.name === 'DIMO-GUEST' }, { t: 'GUEST-LT reaches the internet', f: (L) => C.ping(L, 'LTG', '8.8.8.8') }] },
    { id: 't3', no: 4716, title: 'Stores laptop can\'t connect to this network', who: 'Stores', text: '<p>"After IT\'s security upgrade on Friday my laptop says <i>Can\'t connect to this network</i>. Everyone else is fine."</p>', build: () => wifiOffice({ done: true }), open: ['LTO', 'AP1'], fault: (L) => { ssidOf(L, 'DIMO-STAFF').sec = 'wpa3'; }, hint: 'What does the old laptop support? What did the upgrade change?', checks: [{ t: 'STORES-LT02 connected to DIMO-STAFF', f: (L) => wifiQuality(L, L.devs.LTO)?.ssid.name === 'DIMO-STAFF' }, { t: 'DIMO-STAFF is still secured', f: (L) => ssidOf(L, 'DIMO-STAFF').sec !== 'open' }, { t: 'STAFF-LT01 still connected', f: (L) => !!wifiQuality(L, L.devs.LT1) }] },
    { id: 't4', no: 4722, title: 'A visitor could browse our file server!', who: 'IT security', prio: 'High', text: '<p>"A guest on DIMO-GUEST opened \\\\10.10.10.10 during a meeting. Fix it now and tell me why it happened."</p>', build: () => wifiOffice({ done: true }), open: ['AP1', 'LTG'], fault: (L) => { ssidOf(L, 'DIMO-GUEST').vlan = 10; }, hint: 'Which address did GUEST-LT get? Which VLAN is the guest SSID mapped to?', checks: [{ t: 'GUEST-LT has a 10.10.20.x address', f: (L) => inSub(L, 'LTG', '10.10.20.0', 24) }, { t: 'GUEST-LT cannot reach the file server', f: (L) => !C.reach(L, 'LTG', '10.10.10.10', 445) }, { t: 'GUEST-LT reaches the internet', f: (L) => C.ping(L, 'LTG', '8.8.8.8') }] },
  ],
  quiz: [
    { q: 'An AP serves SSIDs on VLAN 10 and 20. The switch port to the AP is an access port in VLAN 1. Result?', a: ['Works', 'Clients associate but get no DHCP – the VLANs are not carried', 'The AP has no power', 'Only 5 GHz works'], c: 1, why: 'AP uplinks are trunks.' },
    { q: 'Why give guests their own VLAN?', a: ['Speed', 'So firewall policies can keep them away from company systems', 'WPA3 needs it', 'DHCP needs it'], c: 1, why: 'Separation is enforced at layer 3.' },
    { q: 'Client isolation stops…', a: ['Guests reaching the internet', 'Wireless clients on the same SSID talking to each other', 'Roaming', 'DHCP'], c: 1, why: 'Peer-to-peer blocked at the AP.' },
    { q: 'Which band normally gives the most speed indoors at short range?', a: ['2.4 GHz', '5 GHz', 'Both the same', 'Neither'], c: 1, why: 'Wider channels, less interference.' },
    { q: 'A neighbour\'s Wi-Fi is on channel 6. Your two APs should use…', a: ['6 and 6', '1 and 11', '3 and 9', '5 and 7'], c: 1, why: 'Non-overlapping and away from 6.' },
    { q: 'Minimum signal usually targeted for voice/video calls?', a: ['−90 dBm', '−80 dBm', '−67 dBm', '−20 dBm'], c: 2, why: 'With SNR around 25 dB.' },
    { q: 'What does a controller give you over standalone APs?', a: ['More power', 'Central SSID config, channel planning and one view of all clients', 'Free licences', 'No need for VLANs'], c: 1, why: 'Manage once, push everywhere.' },
    { q: '"4-way handshake failed" in the log means…', a: ['Weak signal', 'Wrong passphrase', 'No DHCP', 'Wrong VLAN'], c: 1, why: 'The keys did not match.' },
  ],
});
WIDGETS.chan24 = (el) => {
  const st = { a: 1, b: 6 };
  const draw = () => {
    const gap = Math.abs(st.a - st.b); const verdict = gap === 0 ? ['Co-channel: the two networks take turns – airtime is shared.', '#e0812b'] : gap < 5 ? ['Overlapping: each one is noise to the other – errors and retries. Worst case.', '#b4232f'] : ['No overlap – both run at full speed.', '#2e9d57'];
    const x = (c) => 20 + (c - 1) * 28; const arc = (c, col) => `<path d="M${x(c) - 56} 100 Q${x(c)} -10 ${x(c) + 56} 100" fill="${col}" fill-opacity=".18" stroke="${col}" stroke-width="2"/>`;
    el.innerHTML = `<div class="wt">2.4 GHz channel overlap</div><div class="tb">AP A <select id="ca">${WIFI_CH24.map((c) => `<option ${c === st.a ? 'selected' : ''}>${c}</option>`).join('')}</select> AP B <select id="cb">${WIFI_CH24.map((c) => `<option ${c === st.b ? 'selected' : ''}>${c}</option>`).join('')}</select></div><svg viewBox="0 0 400 120" style="width:100%;max-width:400px">${arc(st.a, '#2563a8')}${arc(st.b, '#7a5cc4')}${WIFI_CH24.map((c) => `<text x="${x(c)}" y="114" font-size="10" text-anchor="middle">${c}</text>`).join('')}</svg><p style="color:${verdict[1]}"><b>${verdict[0]}</b></p>`;
    $('#ca', el).onchange = (e) => { st.a = +e.target.value; draw(); }; $('#cb', el).onchange = (e) => { st.b = +e.target.value; draw(); };
  };
  draw();
};
WIDGETS.rssi = (el) => {
  const st = { d: 10, w: 1, cw: 0, b: '5', p: 17 };
  const draw = () => {
    const rx = Math.round(st.p + 3 - (st.b === '5' ? 46 : 40) - 30 * Math.log10(Math.max(1, st.d)) - (st.w * 4 + st.cw * 12) * (st.b === '5' ? 1.3 : 1));
    const ok = rx >= -67 ? ['Good for voice and video', 'ok'] : rx >= -75 ? ['Works, but slower', ''] : rx >= -82 ? ['Unreliable', 'bad'] : ['No connection', 'bad'];
    el.innerHTML = `<div class="wt">Signal at a desk</div><div class="grid3"><label class="f">Distance (m)<input type="range" min="1" max="40" id="rd" value="${st.d}"> ${st.d} m</label><label class="f">Drywall walls<input type="range" min="0" max="4" id="rw" value="${st.w}"> ${st.w}</label><label class="f">Concrete walls<input type="range" min="0" max="3" id="rc" value="${st.cw}"> ${st.cw}</label></div><div class="tb">Band <select id="rb"><option ${st.b === '2.4' ? 'selected' : ''}>2.4</option><option ${st.b === '5' ? 'selected' : ''}>5</option></select> AP power <select id="rp">${[8, 11, 14, 17, 20, 23].map((p) => `<option ${p === st.p ? 'selected' : ''}>${p}</option>`).join('')}</select> dBm</div><p style="font-size:20px;margin:6px 0"><b>${rx} dBm</b> <span class="${ok[1]}">${ok[0]}</span></p>`;
    $('#rd', el).oninput = (e) => { st.d = +e.target.value; draw(); }; $('#rw', el).oninput = (e) => { st.w = +e.target.value; draw(); }; $('#rc', el).oninput = (e) => { st.cw = +e.target.value; draw(); }; $('#rb', el).onchange = (e) => { st.b = e.target.value; draw(); }; $('#rp', el).onchange = (e) => { st.p = +e.target.value; draw(); };
  };
  draw();
};
