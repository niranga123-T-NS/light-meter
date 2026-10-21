// =================== Wi-Fi: a floor plan with walls, signal and interference, roaming clients, the wireless controller and the Windows Wi-Fi screens
// L.floor = { w, h (metres), walls: [[x1, y1, x2, y2, dB, label]], foreign: [{ name, fx, fy, ch, ch5, pw, sec }] }
// AP: fx, fy, ch (2.4 GHz), ch5, pw / pw5 (dBm), r24 / r5 (radio on, default true). Client: fx, fy, wprof { ssid, psk }, wband, wsec, wstd.
const WIFI_NOISE = -95, WIFI_CH24 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], WIFI_CH5 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 132, 136, 140, 149, 153, 157, 161, 165];
const wifiCross = (ax, ay, bx, by, cx, cy, dx, dy) => { const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (!d) return false; const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d; return t > 0 && t < 1 && u > 0 && u < 1; };
function wifiWalls(L, x1, y1, x2, y2) { return (L.floor?.walls || []).reduce((s, w) => s + (wifiCross(x1, y1, x2, y2, w[0], w[1], w[2], w[3]) ? w[4] : 0), 0); }
/** Received power (dBm) at a point from a radio: log-distance path loss (exponent 3) plus wall losses (higher at 5 GHz) */
function wifiRx(L, src, band, x, y) {
  const dist = Math.max(1, Math.hypot(src.fx - x, src.fy - y)); const pw = band === '5' ? src.pw5 ?? src.pw ?? 17 : src.pw ?? 17;
  return Math.round(pw + 3 - (band === '5' ? 46 : 40) - 30 * Math.log10(dist) - wifiWalls(L, src.fx, src.fy, x, y) * (band === '5' ? 1.3 : 1));
}
const wifiRadioOn = (ap, band) => (band === '5' ? ap.r5 !== false && ap.ch5 : ap.r24 !== false && ap.ch);
/** Which band a client uses on an AP for an SSID, and the signal there */
function wifiPick(L, ap, C, s) {
  const allow = s.band || 'both', cb = C.wband || ['2.4', '5'];
  const r5 = (allow === 'both' || allow === '5') && cb.includes('5') && wifiRadioOn(ap, '5') ? wifiRx(L, ap, '5', C.fx, C.fy) : -999;
  const r24 = (allow === 'both' || allow === '2.4') && cb.includes('2.4') && wifiRadioOn(ap, '2.4') ? wifiRx(L, ap, '2.4', C.fx, C.fy) : -999;
  return r5 >= -72 || r5 >= r24 ? { band: '5', ch: ap.ch5, rssi: r5 } : { band: '2.4', ch: ap.ch, rssi: r24 };
}
wifiSignal = (L, ap, C, s) => (C.fx == null ? { rssi: -50 } : wifiPick(L, ap, C, s));
const wifiAps = (L) => Object.values(L.devs).filter((d) => d.kind === 'ap');
const wifiPct = (rssi) => Math.max(0, Math.min(100, 2 * (rssi + 100)));
/** Everything a client sees: its link, the radios around it, noise, airtime, and the speed that gives */
function wifiQuality(L, C) {
  const A = C.wifi && L.devs[C.wifi]; if (!A || !wifiAssoc(L, A, C).ok) return null;
  const c = A.clients.find((x) => x.dev === C.id); const s = A.ssids.find((x) => x.name === c.ssid); const p = wifiPick(L, A, C, s);
  let noise = WIFI_NOISE, util = 5 + 6 * wifiAps(L).filter((x) => x === A).reduce((n, x) => n + x.clients.filter((k) => { const K = L.devs[k.dev]; return K && wifiAssoc(L, x, K).ok && wifiPick(L, x, K, x.ssids.find((y) => y.name === k.ssid) || {}).band === p.band; }).length, 0);
  const heard = [];
  const others = [...wifiAps(L).filter((x) => x !== A && powered(L, x)).map((x) => ({ name: x.hostname, fx: x.fx, fy: x.fy, ch: x.ch, ch5: x.ch5, pw: x.pw, pw5: x.pw5, r24: x.r24, r5: x.r5, own: true })), ...(L.floor?.foreign || [])];
  others.forEach((o) => {
    if (p.band === '2.4') { if (o.r24 === false || !o.ch) return; const rx = wifiRx(L, o, '2.4', C.fx, C.fy); const gap = Math.abs(o.ch - p.ch);
      if (gap === 0 && rx > -82) { util += rx > -65 ? 45 : 30; heard.push({ name: o.name, ch: o.ch, rx, kind: 'co-channel' }); }
      else if (gap < 5 && rx > -85) { noise = Math.max(noise, rx - 4 * gap); heard.push({ name: o.name, ch: o.ch, rx, kind: 'overlapping channel' }); } }
    else { if (o.r5 === false || !o.ch5 || o.ch5 !== p.ch) return; const rx = wifiRx(L, o, '5', C.fx, C.fy); if (rx > -82) { util += rx > -65 ? 40 : 25; heard.push({ name: o.name, ch: o.ch5, rx, kind: 'co-channel' }); } }
  });
  util = Math.min(95, util);
  const snr = p.rssi - noise, std = C.wstd || 'ax';
  const max = p.band === '5' ? { ax: 1201, ac: 866, n: 300 }[std] || 866 : { ax: 287, ac: 144, n: 144, g: 54 }[std] || 144;
  const phy = Math.max(6, Math.round(max * Math.max(0.03, Math.min(1, (snr - 8) / 27))));
  const mbps = Math.round(phy * 0.55 * (1 - util / 100));
  return { ap: A, ssid: s, band: p.band, ch: p.ch, rssi: p.rssi, noise, snr, util, phy, mbps, retry: snr < 15 ? 31 : util > 50 ? 18 : 3, heard };
}
/** Before each settle: clients with a profile join the strongest AP that broadcasts their SSID; a new association asks DHCP again */
SETTLE_PRE.push((L) => {
  if (!L.floor) return;
  if (L.wlc) wifiAps(L).filter((a) => a.wlc !== false).forEach((a) => (a.ssids = L.wlc.ssids.map((s) => ({ ...s }))));
  Object.values(L.devs).filter((C) => C.wprof !== undefined && C.nics).forEach((C) => {
    wifiAps(L).forEach((a) => (a.clients = a.clients.filter((k) => k.dev !== C.id)));
    const pr = C.wprof; let best = null;
    if (pr) wifiAps(L).filter((a) => powered(L, a)).forEach((a) => { const s = a.ssids.find((x) => x.name === pr.ssid && !x.off); if (!s) return; const q = wifiPick(L, a, C, s); if (!best || q.rssi > best.q.rssi) best = { a, q }; });
    C.wifi = best ? best.a.id : null; if (best) best.a.clients.push({ dev: C.id, ssid: pr.ssid, psk: pr.psk });
    const ok = !!best && wifiAssoc(L, best.a, C).ok; const key = ok ? `${best.a.id}|${(best.a.ssids.find((x) => x.name === pr.ssid) || {}).vlan}` : null;
    const nic = Object.values(C.nics)[0];
    if (key !== C._wkey) { if (nic.dhcp) Object.assign(nic, { ip: null, mask: null, gw: null, tried: false, apipa: null, dup: false }); C._wkey = key; C.dnsCache = {}; }
  });
});
/** Networks a client can see where it stands (all APs and neighbours), strongest first */
function wifiScan(L, C) {
  const out = [];
  wifiAps(L).filter((a) => powered(L, a)).forEach((a) => a.ssids.filter((s) => !s.off).forEach((s) => ['2.4', '5'].forEach((b) => { if ((s.band || 'both') !== 'both' && s.band !== b) return; if (!wifiRadioOn(a, b) || !(C.wband || ['2.4', '5']).includes(b)) return; const rx = wifiRx(L, a, b, C.fx, C.fy); if (rx >= -88) out.push({ ssid: s.name, sec: s.sec, bssid: macColon(a.mac, b === '5' ? 1 : 0), ap: a.hostname, band: b, ch: b === '5' ? a.ch5 : a.ch, rssi: rx }); })));
  (L.floor?.foreign || []).forEach((f) => ['2.4', '5'].forEach((b) => { const ch = b === '5' ? f.ch5 : f.ch; if (!ch) return; const rx = wifiRx(L, f, b, C.fx, C.fy); if (rx >= -88) out.push({ ssid: f.name, sec: f.sec || 'wpa2', bssid: f.bssid || '64:66:b3:1c:22:0' + (b === '5' ? 'b' : 'a'), ap: '(not ours)', band: b, ch, rssi: rx }); }));
  return out.sort((a, b) => b.rssi - a.rssi);
}
const macColon = (m, k) => { const p = m.split(':'); p[5] = ((parseInt(p[5], 16) + k) % 256).toString(16).padStart(2, '0'); return p.join(':'); };
const WIFI_SEC = { open: 'Open', wpa2: 'WPA2-Personal', wpa3: 'WPA3-Personal', 'wpa2/3': 'WPA2-Personal / WPA3-Personal', enterprise: 'WPA2-Enterprise' };
/** Connect a client (what the Windows Wi-Fi screen and netsh do) */
function wifiConnect(L, C, ssid, psk) { C.wprof = { ssid, psk }; (C.wsaved ??= {})[ssid] = psk; settle(L); const A = C.wifi && L.devs[C.wifi]; const r = A ? wifiAssoc(L, A, C) : { ok: false, why: 'network not in range' }; return r; }
// ---------------------------------------------------------------- netsh wlan …
function wifiNetsh(H, a) {
  const { L, d } = H; const low = a.join(' ').toLowerCase(); const n = Object.keys(d.nics)[0];
  if (!L.floor || d.wprof === undefined) return 'The Wireless AutoConfig Service (wlansvc) is not running.\n';
  if (/^wlan show interfaces?/.test(low)) {
    const q = wifiQuality(L, d); const A = d.wifi && L.devs[d.wifi];
    const st = q ? 'connected' : d.wprof ? (A ? 'authenticating' : 'disconnected') : 'disconnected';
    let o = `\nThere is 1 interface on the system:\n\n    Name                   : ${n}\n    Description            : Intel(R) Wi-Fi 6E AX211 160MHz\n    GUID                   : 4f2b1e6a-7c0d-4b9e-9a51-6c1d2e3f4a5b\n    Physical address       : ${d.nics[n].mac}\n    Interface type         : Primary\n    State                  : ${st}\n`;
    if (q) o += `    SSID                   : ${q.ssid.name}\n    AP BSSID               : ${macColon(q.ap.mac, q.band === '5' ? 1 : 0)}\n    Band                   : ${q.band} GHz\n    Channel                : ${q.ch}\n    Network type           : Infrastructure\n    Radio type             : 802.11${d.wstd || 'ax'}\n    Authentication         : ${WIFI_SEC[q.ssid.sec]}\n    Cipher                 : ${q.ssid.sec === 'open' ? 'None' : 'CCMP'}\n    Connection mode        : Auto Connect\n    Receive rate (Mbps)    : ${q.phy}\n    Transmit rate (Mbps)   : ${Math.round(q.phy * 0.85)}\n    Signal                 : ${wifiPct(q.rssi)}% \n    Profile                : ${q.ssid.name}\n`;
    else if (d.wprof && A) o += `    SSID                   : ${d.wprof.ssid}\n    (last attempt failed: ${wifiAssoc(L, A, d).why})\n`;
    return o + '\n    Hosted network status  : Not available\n\n';
  }
  if (/^wlan show networks/.test(low)) {
    const S = wifiScan(L, d); const by = {}; S.forEach((x) => (by[x.ssid] ??= []).push(x)); const full = /bssid/.test(low);
    return `\nInterface name : ${n} \nThere are ${Object.keys(by).length} networks currently visible. \n\n` + Object.entries(by).map(([ss, l], i) => `SSID ${i + 1} : ${ss}\n    Network type            : Infrastructure\n    Authentication          : ${WIFI_SEC[l[0].sec] || 'WPA2-Personal'}\n    Encryption              : ${l[0].sec === 'open' ? 'None' : 'CCMP'} \n${full ? l.map((x, j) => `    BSSID ${j + 1}                 : ${x.bssid}\n         Signal             : ${wifiPct(x.rssi)}%  \n         Radio type         : 802.11ax\n         Band               : ${x.band} GHz\n         Channel            : ${x.ch} \n`).join('') : ''}`).join('\n') + '\n';
  }
  if (/^wlan show profiles?/.test(low)) return `\nProfiles on interface ${n}:\n\nGroup policy profiles (read only)\n---------------------------------\n    <None>\n\nUser profiles\n-------------\n${Object.keys(d.wsaved || {}).map((s) => `    All User Profile     : ${s}`).join('\n') || '    <None>'}\n\n`;
  if (/^wlan disconnect/.test(low)) { d.wprof = null; settle(L, 'nodhcp'); return `Disconnection request was completed successfully for interface "${n}".\n`; }
  if (/^wlan connect/.test(low)) { const m = a.join(' ').match(/name\s*=\s*"?([^"]+?)"?(\s|$)/i); const ss = m?.[1]; if (!ss || !(d.wsaved || {})[ss] && (d.wsaved || {})[ss] !== '') return `There is no profile "${ss || ''}" assigned to the specified interface.\n`; const r = wifiConnect(L, d, ss, d.wsaved[ss]); return r.ok ? 'Connection request was completed successfully.\n' : `Connection request was completed successfully.\n(Windows then reports: ${r.why})\n`; }
  if (/^wlan delete profile/.test(low)) { const m = a.join(' ').match(/name\s*=\s*"?([^"]+?)"?(\s|$)/i); if (m && d.wsaved?.[m[1]] !== undefined) { delete d.wsaved[m[1]]; if (d.wprof?.ssid === m[1]) d.wprof = null; settle(L, 'nodhcp'); return `Profile "${m[1]}" is deleted from interface "${n}".\n`; } return 'Profile is not found on the system.\n'; }
  return 'The following command was not found: ' + a.join(' ') + '.\n';
}
// ---------------------------------------------------------------- Windows: Wi-Fi networks (the taskbar flyout)
function guiWifi(el, L, d, done) {
  const q = wifiQuality(L, d); const S = wifiScan(L, d); const by = {}; S.forEach((x) => { if (!by[x.ssid] || by[x.ssid].rssi < x.rssi) by[x.ssid] = x; });
  const bars = (r) => { const n = r >= -60 ? 4 : r >= -67 ? 3 : r >= -75 ? 2 : 1; return `<span class="mono" title="${r} dBm">${'▂▄▆█'.slice(0, n)}${'·'.repeat(4 - n)}</span>`; };
  const A = d.wifi && L.devs[d.wifi]; const fail = d.wprof && A && !q ? wifiAssoc(L, A, d).why : d.wprof && !A ? 'not in range' : '';
  el.innerHTML = `<div class="gui"><h3>📶 Wi-Fi</h3>${q ? `<p><span class="pill g">Connected</span> <b>${esc(q.ssid.name)}</b>, ${WIFI_SEC[q.ssid.sec]}</p><table><tr><td>Access point</td><td>${esc(q.ap.hostname)} · ${q.band} GHz channel ${q.ch}</td></tr><tr><td>Signal</td><td>${q.rssi} dBm (${wifiPct(q.rssi)}%) · SNR ${q.snr} dB</td></tr><tr><td>Link speed</td><td>${q.phy} Mbps (real throughput about ${q.mbps} Mbps)</td></tr></table><div class="tb"><button class="btn" id="wDis">Disconnect</button></div>` : fail ? `<p class="bad">Can't connect to ${esc(d.wprof.ssid)}: ${esc(fail)}</p><div class="tb"><button class="btn" id="wDis">Forget this attempt</button></div>` : '<p class="m">Not connected</p>'}
  <p style="margin-top:10px"><b>Available networks</b></p><table>${Object.values(by).map((x) => `<tr><td>${bars(x.rssi)}</td><td><b>${esc(x.ssid)}</b><br><span class="m">${x.sec === 'open' ? 'Open' : 'Secured'} · ${x.band} GHz</span></td><td><button class="btn sm" data-ss="${esc(x.ssid)}" data-sec="${esc(x.sec)}">Connect</button></td></tr>`).join('') || '<tr><td class="m">No networks found</td></tr>'}</table><div id="wForm"></div></div>`;
  const D = $('#wDis', el); if (D) D.onclick = () => { d.wprof = null; L.cmdlog.push({ dev: d.id, kind: 'wifi', line: 'disconnect', t: L.clock }); settle(L); done(); };
  $$('[data-ss]', el).forEach((b) => (b.onclick = () => {
    const ss = b.dataset.ss, open = b.dataset.sec === 'open';
    const go = (psk) => { const r = wifiConnect(L, d, ss, psk); L.cmdlog.push({ dev: d.id, kind: 'wifi', line: `connect ${ss}`, ok: r.ok, t: L.clock }); if (!r.ok) toast(`Can't connect to this network – ${r.why}`, 6000); done(); };
    if (open) return go('');
    $('#wForm', el).innerHTML = `<div class="grid2" style="margin-top:8px;max-width:420px"><label class="f">Network security key for ${esc(ss)}<input id="wK" type="password" value="${esc(d.wsaved?.[ss] || '')}"></label></div><div class="tb"><button class="btn p" id="wGo">Next</button></div>`;
    $('#wGo', el).onclick = () => go($('#wK', el).value); $('#wK', el).onkeydown = (e) => { if (e.key === 'Enter') go($('#wK', el).value); };
  }));
}
// ---------------------------------------------------------------- the wireless controller (all APs, SSIDs pushed to every AP)
function guiWlc(el, L, d, done) {
  const st = ((APP.wlc ??= {})[L.id || 'lab'] ??= { pg: 'map', band: '5', ed: null, sel: null });
  const F = L.floor || { w: 40, h: 20, walls: [] }; const S = (L.wlc ??= { ssids: [] }).ssids; const redraw = () => guiWlc(el, L, d, done);
  const apply = (line) => { L.cmdlog.push({ dev: d.id, kind: 'wlc', line, t: L.clock }); settle(L); st.ed = null; done(); redraw(); };
  const err = (m) => { $('#wErr', el).innerHTML = `<span class="bad">⚠ ${esc(m)}</span>`; };
  const tabs = [['map', 'Floor plan & survey'], ['ssid', 'SSIDs'], ['aps', 'Access points & radios'], ['cl', 'Clients'], ['scan', 'Spectrum']];
  const clients = Object.values(L.devs).filter((c) => c.wprof !== undefined);
  let h = '';
  if (st.pg === 'map') {
    const sc = 16, W = F.w * sc, Hh = F.h * sc; let cells = '';
    for (let x = 0; x < F.w; x++) for (let y = 0; y < F.h; y++) { const best = Math.max(-120, ...wifiAps(L).filter((a) => powered(L, a) && wifiRadioOn(a, st.band)).map((a) => wifiRx(L, a, st.band, x + 0.5, y + 0.5))); const col = best >= -60 ? '#2e9d57' : best >= -67 ? '#8cc152' : best >= -72 ? '#f2c94c' : best >= -80 ? '#f2994a' : '#e8e8e8'; cells += `<rect x="${x * sc}" y="${y * sc}" width="${sc}" height="${sc}" fill="${col}" fill-opacity=".55"/>`; }
    const walls = F.walls.map((w) => `<line x1="${w[0] * sc}" y1="${w[1] * sc}" x2="${w[2] * sc}" y2="${w[3] * sc}" stroke="${w[4] >= 10 ? '#333' : '#777'}" stroke-width="${w[4] >= 10 ? 4 : 2}"><title>${esc(w[5] || '')} (${w[4]} dB)</title></line>`).join('');
    const aps = wifiAps(L).map((a) => `<g data-ap="${a.id}" style="cursor:grab"><circle cx="${a.fx * sc}" cy="${a.fy * sc}" r="9" fill="${powered(L, a) ? '#2563a8' : '#999'}" stroke="#fff" stroke-width="2"/><text x="${a.fx * sc}" y="${a.fy * sc - 12}" text-anchor="middle" font-size="11" font-weight="700">${esc(a.hostname)}</text></g>`).join('');
    const fo = (F.foreign || []).map((f) => `<g><circle cx="${f.fx * sc}" cy="${f.fy * sc}" r="7" fill="#b4232f"/><text x="${Math.min(f.fx, F.w - 0.5) * sc}" y="${f.fy * sc + 16}" text-anchor="${f.fx > F.w - 8 ? 'end' : 'middle'}" font-size="10" fill="#b4232f">${esc(f.name)} (ch ${f.ch})</text></g>`).join('');
    const cl = clients.filter((c) => c.fx != null).map((c) => { const q = wifiQuality(L, c); return `<g><rect x="${c.fx * sc - 6}" y="${c.fy * sc - 5}" width="12" height="10" rx="2" fill="${q ? '#fff' : '#fde2e2'}" stroke="#333"/><text x="${c.fx * sc}" y="${c.fy * sc + 18}" text-anchor="middle" font-size="10">${esc(c.hostname)}</text></g>`; }).join('');
    const sp = st.sel; let survey = '<p class="hint">Click anywhere on the plan to take a survey reading there. Drag an AP to move it (it is mounted where you drop it).</p>';
    if (sp) { const rows = [...wifiAps(L).filter((a) => powered(L, a)).flatMap((a) => ['2.4', '5'].filter((b) => wifiRadioOn(a, b)).map((b) => ({ n: a.hostname, b, ch: b === '5' ? a.ch5 : a.ch, rx: wifiRx(L, a, b, sp[0], sp[1]) }))), ...(F.foreign || []).flatMap((f) => ['2.4', '5'].filter((b) => (b === '5' ? f.ch5 : f.ch)).map((b) => ({ n: f.name + ' (neighbour)', b, ch: b === '5' ? f.ch5 : f.ch, rx: wifiRx(L, f, b, sp[0], sp[1]) })))].sort((a, b) => b.rx - a.rx); survey = `<p><b>Survey point</b> ${sp[0].toFixed(1)} m, ${sp[1].toFixed(1)} m</p><table><tr><th>Radio</th><th>Band</th><th>Channel</th><th>Signal</th></tr>${rows.map((r) => `<tr><td>${esc(r.n)}</td><td>${r.b} GHz</td><td>${r.ch}</td><td class="${r.rx >= -67 ? 'ok' : r.rx >= -75 ? '' : 'bad'}">${r.rx} dBm</td></tr>`).join('')}</table>`; }
    h = `<div class="tb"><b>Coverage:</b><button class="btn sm ${st.band === '2.4' ? 'p' : ''}" data-bd="2.4">2.4 GHz</button><button class="btn sm ${st.band === '5' ? 'p' : ''}" data-bd="5">5 GHz</button><span class="m" style="font-size:11.5px"><span style="color:#2e9d57">■</span> ≥ −60 <span style="color:#8cc152">■</span> ≥ −67 (voice/video) <span style="color:#f2c94c">■</span> ≥ −72 <span style="color:#f2994a">■</span> ≥ −80 dBm</span></div><div style="overflow:auto"><svg id="wMap" viewBox="0 0 ${W} ${Hh}" style="width:100%;max-width:${W}px;background:#fafafa;border:1px solid var(--line);touch-action:none">${cells}${walls}${fo}${cl}${aps}${sp ? `<circle cx="${sp[0] * sc}" cy="${sp[1] * sc}" r="5" fill="none" stroke="#000" stroke-width="2"/>` : ''}</svg></div><p class="m" style="font-size:11.5px">${F.w} m × ${F.h} m · thick walls are concrete (12 dB), thin are drywall/glass.</p>${survey}`;
  }
  if (st.pg === 'ssid') {
    if (st.ed != null) { const x = st.ed === '+' ? { sec: 'wpa2/3', band: 'both', vlan: 10 } : S[st.ed];
      h = `<h3>${st.ed === '+' ? 'New SSID' : `Edit ${esc(x.name)}`}</h3><div class="grid2" style="max-width:560px"><label class="f">Network name (SSID)<input id="sN" value="${esc(x.name || '')}"></label><label class="f">Security<select id="sS">${Object.entries(WIFI_SEC).filter(([k]) => k !== 'enterprise').map(([k, v]) => `<option value="${k}" ${x.sec === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="f">Passphrase (8–63 characters)<input id="sK" value="${esc(x.psk || '')}"></label><label class="f">VLAN<input id="sV" value="${esc(x.vlan ?? '')}"></label><label class="f">Bands<select id="sB">${[['both', '2.4 GHz and 5 GHz'], ['5', '5 GHz only'], ['2.4', '2.4 GHz only']].map(([k, v]) => `<option value="${k}" ${(x.band || 'both') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="f" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" id="sI" ${x.isolate ? 'checked' : ''}> Client isolation (clients cannot talk to each other)</label><label class="f" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" id="sO" ${x.off ? '' : 'checked'}> Broadcast / enabled</label></div><div class="tb"><button class="btn p" id="wOk">Save and push to all APs</button><button class="btn" id="wX">Cancel</button></div><div id="wErr"></div>`;
    } else h = `<div class="tb"><button class="btn sm" id="wNew">+ New SSID</button></div><table><tr><th>SSID</th><th>Security</th><th>VLAN</th><th>Bands</th><th>Isolation</th><th>Status</th><th></th></tr>${S.map((x, i) => `<tr><td><b>${esc(x.name)}</b></td><td>${WIFI_SEC[x.sec]}</td><td>${esc(x.vlan ?? 'native')}</td><td>${x.band === '5' ? '5 GHz' : x.band === '2.4' ? '2.4 GHz' : '2.4 + 5 GHz'}</td><td>${x.isolate ? 'On' : 'Off'}</td><td>${x.off ? '<span class="pill n">Disabled</span>' : '<span class="pill g">Broadcasting</span>'}</td><td><button class="btn sm" data-es="${i}">Edit</button> <button class="btn sm" data-ds="${i}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="m">No SSIDs yet</td></tr>'}</table>`;
  }
  if (st.pg === 'aps') {
    h = `<table><tr><th>AP</th><th>Switch port</th><th>2.4 GHz</th><th>5 GHz</th><th>Clients</th></tr>${wifiAps(L).map((a) => { const pr = peerOf(L, a.id, 'eth0'); return `<tr><td><b>${esc(a.hostname)}</b><br><span class="m">${powered(L, a) ? 'online' : '<span class="bad">offline – no PoE / no link</span>'} · ${a.fx} m, ${a.fy} m</span></td><td>${pr ? esc(`${L.devs[pr.dev].hostname} ${pr.port}`) : '—'}</td><td><label><input type="checkbox" data-r24="${a.id}" ${a.r24 !== false ? 'checked' : ''}> on</label> ch <select data-ch="${a.id}">${WIFI_CH24.map((c) => `<option ${a.ch === c ? 'selected' : ''}>${c}</option>`).join('')}</select> <select data-pw="${a.id}">${[5, 8, 11, 14, 17, 20].map((p) => `<option value="${p}" ${(a.pw ?? 17) === p ? 'selected' : ''}>${p} dBm</option>`).join('')}</select></td><td><label><input type="checkbox" data-r5="${a.id}" ${a.r5 !== false ? 'checked' : ''}> on</label> ch <select data-ch5="${a.id}">${WIFI_CH5.map((c) => `<option ${a.ch5 === c ? 'selected' : ''}>${c}</option>`).join('')}</select> <select data-pw5="${a.id}">${[8, 11, 14, 17, 20, 23].map((p) => `<option value="${p}" ${(a.pw5 ?? a.pw ?? 17) === p ? 'selected' : ''}>${p} dBm</option>`).join('')}</select></td><td>${a.clients.filter((k) => L.devs[k.dev] && wifiAssoc(L, a, L.devs[k.dev]).ok).length}</td></tr>`; }).join('')}</table><div class="tb" style="margin-top:8px"><button class="btn p" id="wRad">Apply radio settings</button></div><p class="hint">2.4 GHz: only channels 1, 6 and 11 do not overlap. Neighbouring APs that hear each other must not share a channel.</p>`;
  }
  if (st.pg === 'cl') {
    h = `<table><tr><th>Client</th><th>SSID</th><th>AP / band / ch</th><th>VLAN · IP</th><th>Signal</th><th>SNR</th><th>Rate</th><th>Channel busy</th><th>Status</th></tr>${clients.map((c) => { const q = wifiQuality(L, c); const A = c.wifi && L.devs[c.wifi]; const nic = Object.values(c.nics)[0]; return `<tr><td>${esc(c.hostname)}</td><td>${esc(c.wprof?.ssid || '—')}</td><td>${q ? `${esc(q.ap.hostname)} · ${q.band} · ${q.ch}` : ''}</td><td>${q ? `${esc(q.ssid.vlan ?? '')} · ${esc(nic.ip || nic.apipa || '')}` : ''}</td><td>${q ? `${q.rssi} dBm` : ''}</td><td>${q ? q.snr : ''}</td><td>${q ? `${q.phy} / ~${q.mbps} Mbps` : ''}</td><td>${q ? `${q.util}%` : ''}</td><td>${q ? '<span class="pill g">Associated</span>' : c.wprof ? `<span class="pill r">${esc(A ? wifiAssoc(L, A, c).why : 'SSID not found')}</span>` : '<span class="m">idle</span>'}</td></tr>`; }).join('')}</table><p class="hint">Rate = PHY link rate / estimated real throughput. "Channel busy" rises when other radios on the same channel are heard.</p>`;
  }
  if (st.pg === 'scan') {
    const at = clients.find((c) => c.id === st.at) || clients[0]; const R = at ? wifiScan(L, at) : [];
    const g = (b) => { const list = R.filter((x) => x.band === b); const xs = b === '2.4' ? (c) => 20 + (c - 1) * 30 : (c) => 20 + WIFI_CH5.indexOf(c) * 18; const Wd = b === '2.4' ? 400 : 420; return `<svg viewBox="0 0 ${Wd} 130" style="width:100%;max-width:${Wd}px;background:#fafafa;border:1px solid var(--line)">${(b === '2.4' ? WIFI_CH24 : WIFI_CH5).map((c) => `<text x="${xs(c)}" y="126" font-size="9" text-anchor="middle">${c}</text>`).join('')}${list.map((x, i) => { const hgt = Math.max(4, (x.rssi + 95) * 1.8); const half = b === '2.4' ? 60 : 9; const cx = xs(x.ch); const col = ['#2563a8', '#7a5cc4', '#2e9d57', '#b4232f', '#e0812b'][i % 5]; return `<path d="M${cx - half} 115 Q${cx} ${115 - hgt * 2} ${cx + half} 115" fill="${col}" fill-opacity=".15" stroke="${col}"/><text x="${cx}" y="${112 - hgt}" font-size="9" text-anchor="middle" fill="${col}">${esc(x.ssid)} ${x.rssi}</text>`; }).join('')}</svg>`; };
    h = `<div class="tb">Scan from <select id="wAt">${clients.map((c) => `<option value="${c.id}" ${c === at ? 'selected' : ''}>${esc(c.hostname)}</option>`).join('')}</select></div><p><b>2.4 GHz</b> (each network is 20 MHz wide – about 4 channels)</p>${g('2.4')}<p style="margin-top:8px"><b>5 GHz</b></p>${g('5')}<table style="margin-top:8px"><tr><th>SSID</th><th>BSSID</th><th>Radio</th><th>Band</th><th>Ch</th><th>Signal</th></tr>${R.map((x) => `<tr><td>${esc(x.ssid)}</td><td class="mono">${esc(x.bssid)}</td><td>${esc(x.ap)}</td><td>${x.band}</td><td>${x.ch}</td><td>${x.rssi} dBm</td></tr>`).join('')}</table>`;
  }
  el.innerHTML = `<div class="gui"><h3>📶 Wireless controller – ${wifiAps(L).length} APs</h3><div class="tb">${tabs.map(([k, t]) => `<button class="btn sm ${st.pg === k ? 'p' : ''}" data-wp="${k}">${t}</button>`).join('')}</div>${h}</div>`;
  $$('[data-wp]', el).forEach((b) => (b.onclick = () => { st.pg = b.dataset.wp; st.ed = null; redraw(); }));
  if (st.pg === 'map') {
    $$('[data-bd]', el).forEach((b) => (b.onclick = () => { st.band = b.dataset.bd; redraw(); }));
    const svg = $('#wMap', el); const toM = (e) => { const r = svg.getBoundingClientRect(); return [Math.max(0, Math.min(F.w, ((e.clientX - r.left) / r.width) * F.w)), Math.max(0, Math.min(F.h, ((e.clientY - r.top) / r.height) * F.h))]; };
    let drag = null;
    $$('[data-ap]', el).forEach((g) => (g.onpointerdown = (e) => { e.stopPropagation(); drag = g.dataset.ap; svg.setPointerCapture(e.pointerId); }));
    svg.onpointerup = (e) => { const [x, y] = toM(e); if (drag) { const a = L.devs[drag]; a.fx = Math.round(x * 2) / 2; a.fy = Math.round(y * 2) / 2; const id = drag; drag = null; apply(`move ${a.hostname} to ${a.fx},${a.fy}`); return; } st.sel = [x, y]; L.cmdlog.push({ dev: d.id, kind: 'wlc', line: `survey ${x.toFixed(1)},${y.toFixed(1)}`, t: L.clock }); redraw(); };
  }
  if (st.pg === 'ssid') {
    const N = $('#wNew', el); if (N) N.onclick = () => { st.ed = '+'; redraw(); };
    $$('[data-es]', el).forEach((b) => (b.onclick = () => { st.ed = +b.dataset.es; redraw(); }));
    $$('[data-ds]', el).forEach((b) => (b.onclick = () => { const x = S.splice(+b.dataset.ds, 1)[0]; apply(`delete ssid ${x.name}`); }));
    const X = $('#wX', el); if (X) X.onclick = () => { st.ed = null; redraw(); };
    const OK = $('#wOk', el); if (OK) OK.onclick = () => {
      const v = (id) => $(id, el).value.trim(); const name = v('#sN'), sec = v('#sS'), psk = $('#sK', el).value, vl = v('#sV');
      if (!name || name.length > 32) return err('SSID: 1–32 characters.'); if (S.some((x, i) => x.name === name && i !== st.ed)) return err('That SSID already exists.');
      if (sec !== 'open' && (psk.length < 8 || psk.length > 63)) return err('Passphrase: 8–63 characters.'); if (vl && !(+vl >= 1 && +vl <= 4094)) return err('VLAN must be 1–4094 (or empty for the AP\'s native VLAN).');
      const x = { name, sec, psk: sec === 'open' ? '' : psk, band: v('#sB'), isolate: $('#sI', el).checked, off: !$('#sO', el).checked }; if (vl) x.vlan = +vl;
      if (st.ed === '+') S.push(x); else S[st.ed] = x; apply(`ssid ${name} ${sec} vlan ${vl || 'native'}`);
    };
  }
  if (st.pg === 'aps') $('#wRad', el).onclick = () => { wifiAps(L).forEach((a) => { const g = (k) => $(`[data-${k}="${a.id}"]`, el); a.ch = +g('ch').value; a.ch5 = +g('ch5').value; a.pw = +g('pw').value; a.pw5 = +g('pw5').value; a.r24 = g('r24').checked; a.r5 = g('r5').checked; }); apply(`radios ${wifiAps(L).map((a) => `${a.hostname}:${a.ch}/${a.ch5}`).join(' ')}`); };
  if (st.pg === 'scan') { const s2 = $('#wAt', el); if (s2) s2.onchange = () => { st.at = s2.value; redraw(); }; }
}
