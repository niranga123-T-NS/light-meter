// Unit 6: AiPRON Manager – a training replica of the web HMI shown in the BIA SSDD (map, stand panels, RIDS, Safedocks, flights, alerts)
// and a live shift on the 8 BIA stands. Flights, IPs and times are examples; the screens, states and trigger times follow the SSDD.
const AIP = (() => {
  const STANDS = Object.keys(VD.STANDS);
  const IP = { A6: '10.20.0.16', A7: '10.20.0.17', A8: '10.20.0.18', A9: '10.20.0.19', B10: '10.20.0.20', B11: '10.20.0.21', B12: '10.20.0.22', B14: '10.20.0.24' };
  const CSS = `<style>
  .ap{background:#13353f;color:#e8f1f3;font:12px/1.4 Roboto,"Segoe UI",Arial,sans-serif;border-radius:6px;overflow:hidden;position:relative;user-select:none}
  .ap .top{display:flex;align-items:center;gap:16px;background:#0b2730;padding:6px 12px;flex-wrap:wrap}.ap .top b{letter-spacing:.5px}.ap .nav span{margin-right:14px;font-weight:700;color:#9fc3cc;cursor:pointer;font-size:11px;padding-bottom:3px}.ap .nav span.on{color:#fff;border-bottom:2px solid #f0a020}
  .ap .ic{cursor:pointer;position:relative}.ap .badge{position:absolute;top:-6px;right:-8px;background:#d43b2f;color:#fff;border-radius:8px;font-size:9px;padding:0 4px}
  .ap .wrap2{display:flex;gap:8px;padding:8px;align-items:flex-start;flex-wrap:wrap}.ap .pane{background:#0e2a33;border:1px solid #2c5260}
  .ap .st{width:200px}.ap .sh{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;font-weight:700;font-size:13px}.ap .sh span{cursor:pointer;font-weight:400;opacity:.8}
  .ap .apill{border:1px solid #cfe3e8;border-radius:12px;padding:2px 10px;font-size:10px;cursor:pointer;display:inline-block;margin:0 8px 6px auto}.ap .sec{background:#0b3a47;padding:5px 8px;font-weight:700;font-size:11px;margin-top:6px;cursor:pointer}
  .ap .chip{display:inline-block;background:#3b4a52;border-radius:10px;padding:2px 9px;font-size:10px;margin:6px 8px}.ap .cm{position:absolute;background:#0b2730;border:1px solid #2c5260;z-index:4;min-width:180px}.ap .cm div{padding:6px 10px;cursor:pointer}.ap .cm div:hover{background:#1c4c5a}
  .ap table{border-collapse:collapse;width:100%}.ap th{color:#8fb3bc;text-align:left;font-weight:700;padding:5px 6px;font-size:11px;border-bottom:1px solid #2c5260}.ap td{padding:4px 6px;border-bottom:1px solid #1d4450}.ap tr:nth-child(even) td{background:#103540}
  .ap input,.ap select{background:#0b2730;color:#e8f1f3;border:1px solid #2c5260;padding:3px 6px;font:12px Roboto,Arial,sans-serif}.ap .btnA{border:1px solid #cfe3e8;border-radius:14px;padding:4px 14px;cursor:pointer;display:inline-block;font-size:11px;font-weight:700}.ap .btnA.f{background:#8fd0e0;color:#0b2730;border-color:#8fd0e0}
  .ap .ov{position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding-top:30px;z-index:6}.ap .dl{background:#0e2a33;border:1px solid #2c5260;width:min(340px,94%);padding:14px}
  .ap .al{background:#13353f;margin:4px 6px;padding:6px 8px;display:flex;justify-content:space-between;gap:6px;align-items:center}.ap .stc{display:inline-block;border-radius:10px;padding:1px 9px;font-size:10px;margin-right:4px}
  </style>`;
  // a RIDS tile: dark dot-matrix with yellow (or red) lines
  const rids = (lines, col = '#f2c200', w = 84, big = false) => { let s = `<svg viewBox="0 0 84 96" width="${w}"><rect width="84" height="96" fill="#0a3442"/>`; for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) s += `<rect x="${3 + x * 13.2}" y="${3 + y * 11.5}" width="12" height="10.5" fill="#0c3f50"/>`; lines.slice(0, 6).forEach((l, i) => { s += `<text x="42" y="${(big && lines.length === 1 ? 32 : 16) + i * 14}" font-size="${big && lines.length === 1 ? 22 : 10}" fill="${col}" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-weight="700">${esc(l)}</text>`; }); return s + '</svg>'; };
  const plane = (col) => `<path d="M0 -16 l3 8 l17 7 v4 l-17 -3 l-2 12 l6 5 v3 l-7 -2 l-7 2 v-3 l6 -5 l-2 -12 l-17 3 v-4 l17 -7 z" fill="${col}"/>`;
  const STL = { ready: 'READY IDLE', sched: 'SCHEDULED', active: 'ACTIVE', docking: 'DOCKING', parked: 'PARKED', psched: 'PARKED SCHEDULED', closed: 'CLOSED', offline: 'NO CONNECTION' };
  const hm = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(Math.floor(((m % 60) + 60) % 60)).padStart(2, '0')}`;

  function state(t0) {
    const S = { t: t0, view: 'map', open: [], drawer: false, alTab: 'ALL', dlg: null, menu: null, log: [], stands: {}, flights: [], alerts: [], fidsUp: true, ntpOk: true, aid: 0 };
    STANDS.forEach((k) => (S.stands[k] = { k, state: 'ready', type: null, closed: false, pbb: 'PARKED', conn: true, rids: null, dock: null, flight: null, parkedAt: null }));
    return S;
  }
  const alert = (S, stand, text, sev = 'op', active = false) => { const a = S.alerts.find((x) => x.stand === stand && x.text === text && !x.ack); if (a) { a.count++; a.t = S.t; a.active = active; return a; } const n = { id: ++S.aid, stand, text, sev, active, ack: false, t: S.t, count: 1 }; S.alerts.unshift(n); return n; };

  // ---- the HMI renderer
  function hmi(el, S, opt = {}) {
    const R = () => {
      const unack = S.alerts.filter((a) => !a.ack).length;
      el.innerHTML = `${CSS}<div class="ap"><div class="top"><b>AiPRON</b><span class="nav">${['MAP', 'RIDS', 'SAFEDOCKS', 'FLIGHTS'].map((v) => `<span data-v="${v.toLowerCase()}" class="${S.view === v.toLowerCase() ? 'on' : ''}">${v}</span>`).join('')}</span><span style="flex:1"></span><span class="ic" data-dr>🔔${unack ? `<span class="badge">${unack}</span>` : ''}</span><span class="ic">👤</span><span class="ic">⚙</span><span>🔍</span><span style="font-family:ui-monospace,monospace">${new Date().toISOString().slice(0, 10)} ${hm(S.t)}:${String(Math.floor((S.t % 1) * 60)).padStart(2, '0')} IST</span></div>
        <div class="wrap2"><div style="flex:1;min-width:280px">${S.view === 'map' ? map() : S.view === 'rids' ? ridsView() : S.view === 'safedocks' ? sdView() : flView()}</div>${S.open.map(panel).join('')}${S.drawer ? drawer() : ''}</div>
        ${S.menu ? menu() : ''}${S.dlg ? S.dlg.html() : ''}</div>`;
      el.querySelectorAll('[data-v]').forEach((x) => (x.onclick = () => { S.view = x.dataset.v; R(); }));
      el.querySelector('[data-dr]').onclick = () => { S.drawer = !S.drawer; R(); };
      el.querySelectorAll('[data-os]').forEach((x) => (x.onclick = () => { const k = x.dataset.os; if (!S.open.includes(k)) { S.open.push(k); if (S.open.length > 4) S.open.shift(); } R(); }));
      el.querySelectorAll('[data-cs]').forEach((x) => (x.onclick = () => { S.open = S.open.filter((k) => k !== x.dataset.cs); R(); }));
      el.querySelectorAll('[data-close]').forEach((x) => (x.onclick = () => { const s = S.stands[x.dataset.close]; s.closed = !s.closed; s.state = s.closed ? 'closed' : 'ready'; S.log.push(['close', s.k, s.closed]); R(); }));
      el.querySelectorAll('[data-km]').forEach((x) => (x.onclick = (e) => { const r = el.querySelector('.ap').getBoundingClientRect(), b = x.getBoundingClientRect(); S.menu = { k: x.dataset.km, x: b.left - r.left - 150, y: b.bottom - r.top }; R(); }));
      el.querySelectorAll('[data-mi]').forEach((x) => (x.onclick = () => cmd(S.menu.k, x.dataset.mi)));
      el.querySelectorAll('[data-mx]').forEach((x) => (x.onclick = () => { S.menu = null; R(); }));
      el.querySelectorAll('[data-er]').forEach((x) => (x.onclick = () => editRids(x.dataset.er.split(','))));
      el.querySelectorAll('[data-ack]').forEach((x) => (x.onclick = () => { const a = S.alerts.find((y) => y.id === +x.dataset.ack); if (a && !a.active) { a.ack = true; S.log.push(['ack', a.stand, a.text]); } R(); }));
      el.querySelectorAll('[data-ackall]').forEach((x) => (x.onclick = () => { S.alerts.forEach((a) => { if (!a.active) a.ack = true; }); S.log.push(['ackall']); R(); }));
      el.querySelectorAll('[data-at]').forEach((x) => (x.onclick = () => { S.alTab = x.dataset.at; R(); }));
      el.querySelectorAll('[data-ms]').forEach((x) => (x.onclick = () => { S.multi = !S.multi; S.msel = []; R(); }));
      el.querySelectorAll('[data-pick]').forEach((x) => (x.onclick = () => { const k = x.dataset.pick; S.msel = S.msel || []; S.msel = S.msel.includes(k) ? S.msel.filter((y) => y !== k) : [...S.msel, k]; R(); }));
      el.querySelectorAll('[data-flf]').forEach((x) => (x.oninput = () => { S.flf = S.flf || {}; S.flf[x.dataset.flf] = x.value; const pos = x.selectionStart; R(); const n = el.querySelector(`[data-flf="${x.dataset.flf}"]`); n.focus(); n.setSelectionRange(pos, pos); }));
      if (S.dlg && S.dlg.init) S.dlg.init();
      if (opt.after) opt.after();
    };
    const col = (s) => (s.closed ? '#6b7a80' : !s.conn ? '#d43b2f' : s.state === 'ready' ? '#1f8a4c' : s.state === 'parked' || s.state === 'psched' ? '#e8f1f3' : '#f2c200');
    const map = () => {
      const pos = { A6: [346, 84], A7: [346, 146], A8: [346, 208], A9: [346, 270], B10: [92, 70], B11: [92, 130], B12: [92, 190], B14: [92, 300] };
      return `<div class="pane" style="padding:6px"><svg viewBox="0 0 440 340" style="width:100%;max-width:640px;display:block"><rect width="440" height="340" fill="#3b4a52"/><rect x="190" y="20" width="58" height="310" fill="#8a989f"/><text x="219" y="190" font-size="10" fill="#22313a" text-anchor="middle" transform="rotate(-90 219 190)">PIER 01 · APRON A │ APRON B</text>
        ${STANDS.map((k) => { const [x, y] = pos[k], s = S.stands[k], right = k[0] === 'A'; return `<g data-os="${k}" style="cursor:pointer"><line x1="${right ? 248 : 190}" y1="${y}" x2="${x + (right ? -16 : 16)}" y2="${y}" stroke="#c9d3d8"/><circle cx="${x}" cy="${y}" r="10" fill="${col(s)}"/>${s.state === 'docking' || s.state === 'active' ? `<g transform="translate(${x + (right ? 40 : -40)} ${y}) rotate(${right ? -90 : 90}) scale(.7)">${plane(s.state === 'docking' ? '#f2c200' : '#8fb3bc')}</g>` : ''}<text x="${right ? x + 18 : x - 18}" y="${y + 4}" font-size="11" fill="#e8f1f3" text-anchor="${right ? 'start' : 'end'}">${k}</text></g>`; }).join('')}</svg>
        <div style="padding:4px 2px;font-size:11px;color:#8fb3bc">Tap a stand to open it (up to 4). <span class="stc" style="background:#1f8a4c">Ready</span><span class="stc" style="background:#f2c200;color:#13353f">Scheduled / active / docking</span><span class="stc" style="background:#e8f1f3;color:#13353f">Parked</span><span class="stc" style="background:#d43b2f">No connection</span><span class="stc" style="background:#6b7a80">Closed</span></div>
        <div style="padding:4px 2px">STATUS <span class="stc" style="background:#1f8a4c">✓ SAM 1</span><span class="stc" style="background:${S.fidsUp ? '#1f8a4c' : '#d43b2f'}">${S.fidsUp ? '✓' : '✗'} FIDS</span><span class="stc" style="background:${S.ntpOk ? '#1f8a4c' : '#f2c200;color:#13353f'}">${S.ntpOk ? '✓' : '!'} NTP</span></div></div>`;
    };
    const ridsOf = (s) => (s.rids ? s.rids.lines : s.closed ? ['CLOSED'] : s.state === 'docking' ? ['Docking', s.type] : s.state === 'active' ? ['Active', s.type] : s.state === 'parked' ? ['PARKED', 'OK'] : s.flight && (s.state === 'sched' || s.state === 'psched') ? [s.flight.no, s.flight.type, s.state === 'psched' ? 'TOBT' : 'EIBT', hm(s.state === 'psched' ? s.flight.tobt : s.flight.eibt)] : [s.k]);
    const ridsView = () => `<div class="pane" style="padding:8px"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:14px">Rids</b><span><label style="font-size:11px"><input type="checkbox" data-ms ${S.multi ? 'checked' : ''}> Multiselect</label> ${S.multi && (S.msel || []).length ? `<span class="btnA" data-er="${S.msel.join(',')}">EDIT ${S.msel.length}</span>` : ''}</span></div><div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:8px">${STANDS.map((k) => { const s = S.stands[k]; return `<div class="pane" style="padding:8px;width:116px${S.multi && (S.msel || []).includes(k) ? ';outline:2px solid #f0a020' : ''}" ${S.multi ? `data-pick="${k}"` : ''}>${rids(ridsOf(s), s.rids ? s.rids.col : '#f2c200', 96, true)}<div style="display:flex;justify-content:space-between;font-size:10px;margin-top:4px"><span>${k} ${s.state === 'ready' ? '○' : '●'}</span>${S.multi ? '' : `<span data-er="${k}" style="cursor:pointer">✎ EDIT</span>`}</div></div>`; }).join('')}</div></div>`;
    const sdView = () => `<div class="pane" style="padding:8px;overflow-x:auto"><b style="font-size:14px">Safedocks</b><table style="margin-top:6px"><tr><th>Name</th><th>Stand</th><th>Type</th><th>State</th><th>IP address</th><th>Connection</th><th>Last log download</th><th>Config backup</th></tr>${STANDS.map((k) => { const s = S.stands[k]; return `<tr><td>DGS-${k}</td><td>${k}</td><td>FleX</td><td>${STL[s.closed ? 'closed' : s.conn ? s.state : 'offline']}</td><td>${IP[k]}</td><td style="color:${s.conn ? '#7fe0a0' : '#ff9a8c'}">${s.conn ? 'Connected' : 'Lost since ' + hm(s.lostAt || S.t)}</td><td>${s.conn ? hm(S.t - 7) : '—'}</td><td>SafedockConfiguration_${k}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}T0200.scfg</td></tr>`; }).join('')}</table></div>`;
    const flView = () => {
      const f = S.flf || {}, cols = [['state', 'State'], ['ad', 'Type'], ['no', 'Flight'], ['stand', 'Stand'], ['reg', 'Registration'], ['type', 'AC type'], ['seqt', 'SEQT'], ['aldt', 'ALDT'], ['eta', 'ETA'], ['tobt', 'TOBT'], ['aibt', 'AIBT'], ['aobt', 'AOBT']];
      const rows = S.flights.filter((x) => cols.every(([k]) => !f[k] || String(fv(x, k)).toLowerCase().includes(f[k].toLowerCase())));
      return `<div class="pane" style="padding:8px;overflow-x:auto"><div style="font-size:11px;color:#8fb3bc">› Apron filter</div><table style="margin-top:6px"><tr>${cols.map(([k, n]) => `<th>${n}<br><input data-flf="${k}" value="${esc(f[k] || '')}" style="width:62px"></th>`).join('')}</tr>${rows.map((x) => `<tr>${cols.map(([k]) => `<td style="${k === 'state' ? `color:${x.state === 'Completed' ? '#7fe0a0' : x.state === 'Pending' ? '#f2c200' : '#ff9a8c'}` : ''}">${fv(x, k)}</td>`).join('')}</tr>`).join('')}</table><div style="text-align:center;margin-top:8px"><span class="btnA">⟳ AUTO REFRESH</span></div></div>`;
    };
    const fv = (x, k) => (k === 'ad' ? (x.ad === 'A' ? '🛬' : '🛫') : ['seqt', 'aldt', 'eta', 'tobt', 'aibt', 'aobt'].includes(k) ? (x[k] != null ? hm(x[k]) : '') : x[k] ?? '');
    const panel = (k) => {
      const s = S.stands[k], c = s.state === 'docking' || s.state === 'active' ? '#f2c200' : '#ffffff', showPlane = ['active', 'docking', 'parked', 'psched'].includes(s.state) && !s.closed;
      const fl = S.flights.filter((x) => x.stand === k).slice(0, 4), al = S.alerts.filter((a) => a.stand === k && !a.ack);
      return `<div class="pane st"><div class="sh">⌄ Stand ${k}<span><span>📌</span> <span>◧</span> <span data-cs="${k}">✕</span></span></div><div style="display:flex"><span class="apill" data-close="${k}">${s.closed ? 'OPEN STAND' : 'CLOSE STAND'}</span></div>
        <div style="margin:0 8px;background:#0b2128;border:1px solid #2c5260;height:190px;position:relative"><div style="display:flex;justify-content:space-between;padding:4px 6px"><span>${s.closed ? '⛔' : s.state === 'parked' ? 'Ⓟ' : s.state === 'docking' || s.state === 'active' ? '<span style="color:#f2c200">✈</span>' : '○'}</span><span data-km="${k}" style="cursor:pointer;padding:0 6px">⋮</span></div><div style="font-size:9px;color:#8fb3bc;padding:0 6px">${s.type || ''}</div>
          <svg viewBox="0 0 180 130" style="position:absolute;left:0;top:30px;width:100%;height:130px"><line x1="90" y1="4" x2="90" y2="112" stroke="#cfe3e8"/>${showPlane ? `<g transform="translate(90 ${s.state === 'docking' && s.dock ? 30 + Math.min(1, Math.max(0, s.dock.x / 40)) * -20 + 30 : 50}) scale(1.6)">${plane(c)}</g>` : ''}<text x="90" y="124" font-size="9" fill="#cfe3e8" text-anchor="middle">${k}</text></svg>
          <div style="position:absolute;bottom:4px;width:100%;text-align:center;font-weight:700;font-size:10px">${STL[s.closed ? 'closed' : s.conn ? s.state : 'offline']}</div></div>
        <div class="sec">⌄ RIDS</div><div style="display:flex;justify-content:center;padding:6px;position:relative">${rids(ridsOf(s), s.rids ? s.rids.col : '#f2c200', 70)}<span data-er="${k}" style="position:absolute;right:58px;bottom:8px;cursor:pointer">✎</span></div>
        <div class="sec">⌄ STAND EQUIPMENT</div><span class="chip">🛂 PBB-${k} · ${s.pbb}</span>
        <div class="sec">⌄ FLIGHTS</div>${fl.map((x) => `<div style="padding:2px 8px;font-size:11px">${x.ad === 'A' ? '🛬' : '🛫'} ${x.no} · ${x.type} · ${x.ad === 'A' ? 'EIBT ' + hm(x.eibt) : 'TOBT ' + hm(x.tobt)} · ${x.state}</div>`).join('') || '<div style="padding:2px 8px;color:#8fb3bc">—</div>'}
        <div class="sec">⌄ ALERTS</div>${al.map((a) => `<div class="al"><span>${esc(a.text)}</span>${a.active ? '' : `<span class="btnA" data-ack="${a.id}">ACK</span>`}</div>`).join('') || '<div style="padding:2px 8px;color:#8fb3bc">—</div>'}</div>`;
    };
    const drawer = () => {
      const L = S.alerts.filter((a) => !a.ack && (S.alTab === 'ALL' || (S.alTab === 'OPERATIONAL' ? a.sev === 'op' : a.sev === 'tech')));
      return `<div class="pane" style="width:250px"><div style="display:flex;gap:10px;padding:6px 8px;font-weight:700;font-size:11px">${['ALL', 'OPERATIONAL', 'TECHNICAL'].map((t) => `<span data-at="${t}" style="cursor:pointer;color:${S.alTab === t ? '#fff' : '#8fb3bc'}">${t}</span>`).join('')}</div>
        ${L.map((a) => `<div class="al"><span style="font-size:11px">${a.stand} | SAM-1 | ${a.stand}<br><span style="color:${a.sev === 'tech' ? '#ffb4a8' : '#cfe3e8'}">${hm(a.t)} – ${esc(a.text)}${a.count > 1 ? ` (${a.count})` : ''}</span></span>${a.active ? '<span style="font-size:10px;color:#f2c200">ACTIVE</span>' : `<span class="btnA" data-ack="${a.id}">ACK</span>`}</div>`).join('') || '<div style="padding:8px;color:#8fb3bc">No alerts</div>'}
        <div style="text-align:center;margin:8px"><span class="btnA" data-ackall>ACKNOWLEDGE ALL</span></div></div>`;
    };
    const menu = () => { const m = S.menu, s = S.stands[m.k]; return `<div class="cm" style="left:${Math.max(4, m.x)}px;top:${m.y}px">${[['parkon', 'Park On'], ['parkoff', 'Park Off'], ['start', 'Start docking…'], ['shutdown', 'Shutdown (cancel activation)'], ['maint', s.maint ? 'Exit Close for Maintenance' : 'Enter Close for Maintenance']].map(([k, n]) => `<div data-mi="${k}">${n}</div>`).join('')}<div data-mx style="color:#8fb3bc">Cancel</div></div>`; };
    const cmd = (k, c) => {
      S.menu = null; const s = S.stands[k];
      if (c === 'parkon') { s.state = 'parked'; s.dock = null; S.log.push(['parkon', k]); }
      if (c === 'parkoff') { if (s.state === 'parked' || s.state === 'psched') { s.state = 'ready'; s.type = null; S.log.push(['parkoff', k]); if (s.flight && s.flight.ad === 'D') { s.flight.aobt = S.t; s.flight.state = 'Completed'; } } }
      if (c === 'shutdown') { if (s.state === 'active' || s.state === 'docking') { s.state = 'ready'; s.dock = null; s.type = null; S.log.push(['shutdown', k]); } }
      if (c === 'maint') { s.maint = !s.maint; s.closed = s.maint; s.state = s.maint ? 'closed' : 'ready'; S.log.push(['maint', k, s.maint]); }
      if (c === 'start') { S.dlg = { html: () => `<div class="ov"><div class="dl"><b style="font-size:14px">Start docking – Stand ${k}</b><div style="margin:10px 0"><label>Aircraft type (ICAO)<br><select id="apT" style="width:100%">${Object.keys(VD.AC).filter((t) => VD.STANDS[k].groups.includes(VD.AC[t].g)).map((t) => `<option value="${t}">${t} – ${VD.AC[t].n}</option>`).join('')}</select></label></div><div style="display:flex;justify-content:flex-end;gap:8px"><span class="btnA" data-dx>CANCEL</span><span class="btnA f" data-dok>START</span></div></div></div>`, init: () => { el.querySelector('[data-dx]').onclick = () => { S.dlg = null; R(); }; el.querySelector('[data-dok]').onclick = () => { const t = el.querySelector('#apT').value; if (s.closed) { S.dlg = null; return R(); } s.type = t; s.state = 'active'; s.manual = true; s.dock = VD.dock({ type: t, x0: 70 }); s.dock.blocked = s.pbb !== 'PARKED'; S.log.push(['start', k, t]); S.dlg = null; R(); }; } }; }
      R();
    };
    const editRids = (ks) => {
      S.dlg = { html: () => `<div class="ov"><div class="dl"><div style="display:flex;justify-content:space-between"><b style="font-size:15px">EDIT ${ks.join(', ')}</b><span data-dx style="cursor:pointer">✕</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;font-size:11px;color:#8fd0e0"><label>Template<br><select id="rTp" style="width:100%"><option>Free Text</option><option>Stand closed</option><option>Wait for marshaller</option></select></label><label>Duration<br><select id="rDu" style="width:100%"><option>All the time</option><option>30 minutes</option><option>Until next flight</option></select></label></div>
        <label style="display:block;margin:8px 0"><input type="checkbox" id="rBl" checked> Blank other content</label><div style="font-size:11px;color:#8fd0e0">Colour <label><input type="radio" name="rC" value="#f2c200" checked> 🟡</label> <label><input type="radio" name="rC" value="#ff5a4a"> 🔴</label></div>
        <div style="display:grid;gap:4px;margin:8px auto;width:160px">${[0, 1, 2, 3, 4, 5].map((i) => `<input id="rL${i}" maxlength="8" style="text-align:center;font-family:ui-monospace,monospace;color:#f2c200;background:#0a3442;border-color:#0c3f50">`).join('')}</div>
        <div style="text-align:center;color:#8fb3bc;font-size:11px">DGS${ks[0]} · T1-42</div><div style="display:flex;justify-content:space-between;margin-top:10px"><span class="btnA" data-rc>✕ CLEAR</span><span class="btnA" data-dx>CANCEL</span><span class="btnA f" data-ra>APPLY</span></div></div></div>`,
      init: () => {
        el.querySelectorAll('[data-dx]').forEach((x) => (x.onclick = () => { S.dlg = null; R(); }));
        el.querySelector('#rTp').onchange = () => { const v = el.querySelector('#rTp').value, L = v === 'Stand closed' ? ['STAND', 'CLOSED'] : v === 'Wait for marshaller' ? ['WAIT', 'FOR', 'MARSHAL'] : []; [0, 1, 2, 3, 4, 5].forEach((i) => (el.querySelector('#rL' + i).value = L[i] || '')); };
        el.querySelector('[data-rc]').onclick = () => { ks.forEach((k) => (S.stands[k].rids = null)); S.log.push(['ridsclear', ks]); S.dlg = null; R(); };
        el.querySelector('[data-ra]').onclick = () => { const lines = [0, 1, 2, 3, 4, 5].map((i) => el.querySelector('#rL' + i).value.trim().toUpperCase()).filter(Boolean), c = el.querySelector('input[name=rC]:checked').value, dur = el.querySelector('#rDu').value; ks.forEach((k) => (S.stands[k].rids = lines.length ? { lines, col: c, dur } : null)); S.log.push(['rids', ks, lines.join(' '), c, dur]); S.dlg = null; R(); };
      } };
      R();
    };
    return { R, cmd };
  }

  // ---- the simulation: flights from FIDS, scheduling by the BIA trigger times, the Safedocks docking
  function tick(S, dtMin) {
    S.t += dtMin; const T = VD.TIMES;
    S.flights.forEach((f) => {
      const s = S.stands[f.stand]; if (!s || f.state === 'Completed' || f.state === 'Skipped' || f.state === 'No show') return;
      if (f.ad === 'A') {
        if (f.state === 'Pending' && S.t >= f.seqt - T.ridsArr && !s.flight && s.state === 'ready' && !s.closed) { s.flight = f; }
        if (f.aldt != null && S.t >= f.aldt && s.flight === f && s.state === 'ready' && !s.closed) { s.state = 'sched'; s.type = f.type; alert(S, f.stand, `Flight ${f.no} scheduled`); }
        if (s.flight === f && s.state === 'sched' && S.t >= (f.confirmAt ?? f.aldt + 3)) { s.state = 'active'; s.dock = VD.dock({ type: f.type, x0: 70 }); s.dock.blocked = s.pbb !== 'PARKED'; if (f.idFail) s.dock.idOk = false; }
        if (f.aldt == null && S.t > f.seqt + T.noShow && f.state === 'Pending') { f.state = 'No show'; if (s.flight === f) { s.flight = null; } alert(S, f.stand, `Flight ${f.no} no show`); }
      }
      if (f.ad === 'D' && s.state === 'parked' && S.t >= f.tobt - T.schedDep) { s.state = 'psched'; s.flight = f; }
      if (f.ad === 'D' && s.state === 'psched' && f.pushAt != null && S.t >= f.pushAt) { s.state = 'ready'; s.type = null; f.aobt = S.t; f.state = 'Completed'; s.flight = null; }
    });
    Object.values(S.stands).forEach((s) => {
      if (!s.conn || s.closed) return;
      if ((s.state === 'active' || s.state === 'docking') && s.dock) {
        s.dock.blocked = s.pbb !== 'PARKED';
        if (s.dock.blocked) { alert(S, s.k, 'Docking blocked – PBB not parked', 'op', true); }
        else S.alerts.forEach((a) => { if (a.stand === s.k && /PBB not parked/.test(a.text)) a.active = false; });
        for (let rem = dtMin * 60 * 0.6; rem > 0 && s.dock; rem -= 0.2) s.dock.step(Math.min(0.2, rem));
        if (s.dock.phase === 'lead' || s.dock.phase === 'closing') s.state = 'docking';
        if (s.dock.phase === 'ok') { s.state = 'parked'; s.parkedAt = S.t; const f = s.flight; if (f) { f.aibt = S.t; f.state = 'Completed'; s.flight = null; } s.dock = null; }
        if (s.dock && s.dock.phase === 'idfail') { alert(S, s.k, 'ID fail – docking stopped', 'op'); s.state = 'active'; s.dock.idOk = true; s.dock.phase = 'active'; s.dock.x = 30; }
      }
    });
  }
  return { hmi, state, tick, alert, rids, IP, STANDS, hm, plane };
})();

(() => {
  const { quiz, TIMES } = VD;
  // ===== lesson: a tour of the HMI
  item('ops', 'hmi', '🗺️', 'AiPRON Manager HMI tour', 'Map, stand panel, RIDS, Safedocks, flights, alerts – and the timing rules', 'lesson', (el, done) => {
    const S = AIP.state(14 * 60 + 10);
    S.stands.A7.state = 'docking'; S.stands.A7.type = 'B738'; S.stands.A7.dock = VD.dock({ type: 'B738', x0: 20 }); S.stands.A8.state = 'parked'; S.stands.A8.type = 'A333'; S.stands.B11.conn = false; S.stands.A9.closed = true; S.stands.A9.state = 'closed';
    S.flights = [{ ad: 'A', no: 'UL 504', stand: 'A7', reg: '4R-ABN', type: 'B738', seqt: 875, eibt: 875, eta: 873, aldt: 868, state: 'Pending' }, { ad: 'A', no: 'EK 650', stand: 'A8', reg: 'A6-EKR', type: 'A333', seqt: 835, eibt: 835, eta: 832, aldt: 827, aibt: 836, state: 'Completed' }, { ad: 'D', no: 'EK 651', stand: 'A8', reg: 'A6-EKR', type: 'A333', seqt: 970, tobt: 970, state: 'Pending' }];
    S.alerts = [{ id: 1, stand: 'B11', text: 'Safedock connection lost', sev: 'tech', active: true, t: 845, count: 1 }, { id: 2, stand: 'A7', text: 'Flight UL 504 scheduled', sev: 'op', t: 848, count: 1 }];
    S.open = ['A7', 'A8'];
    const TOUR = [['MAP', 'The airport layout: every stand with its state colour. Tap a stand to open its panel – up to 4 at once.'], ['Stand panel', 'CLOSE STAND, the centreline with the aircraft (yellow while active or docking, white when parked), the state, the RIDS tile, stand equipment (the PBB dry contact), the stand’s flights and alerts.'], ['⋮ menu', 'Park On, Park Off, Start docking (manual type), Shutdown (cancel the activation), Enter / Exit Close for Maintenance.'], ['RIDS', 'What each display shows when it is not docking. The pencil opens the editor: template, duration, blank other content, colour and up to 6 lines – to one stand or many with Multiselect.'], ['SAFEDOCKS', 'Every unit with its state, IP, connection, last log download and the configuration backup (SafedockConfiguration_Stand-ID_DATETTIME.scfg).'], ['FLIGHTS', 'Flights from FIDS, 24 h back and 24 h ahead: State, Type, Flight, Stand, Registration, AC type (ICAO), SEQT, ALDT, ETA, TOBT, AIBT, AOBT – a filter box under each column.'], ['🔔 Alerts', 'ALL / OPERATIONAL / TECHNICAL. ACK removes an alert that is no longer active; active ones (like E-stop pressed) cannot be acknowledged. ACKNOWLEDGE ALL clears every inactive one. STATUS chips show the server, FIDS and NTP links.']];
    el.innerHTML = `<div class="tw" style="grid-template-columns:minmax(0,2.2fr) minmax(0,1fr)"><div id="hH"></div><div><div class="steps">${TOUR.map(([n, t], i) => `<div data-tr="${i}" style="cursor:pointer"><b>${n}</b> – ${t}</div>`).join('')}</div>
      <h4>Trigger times agreed for BIA</h4><table class="spec"><tr><th>Arrival</th><th>min</th></tr><tr><td>RIDS shows the arrival before SEQT</td><td>${TIMES.ridsArr}</td></tr><tr><td>Safedock scheduled</td><td>at ALDT</td></tr><tr><td>Skip flight (stand already parked)</td><td>${TIMES.skipArr}</td></tr><tr><td>No-show timeout after ETA</td><td>${TIMES.noShow}</td></tr><tr><th>Departure</th><th></th></tr><tr><td>RIDS before departure</td><td>${TIMES.ridsDep}</td></tr><tr><td>Safedock scheduled</td><td>${TIMES.schedDep}</td></tr><tr><td>Skip flight (no aircraft)</td><td>${TIMES.skipDep}</td></tr><tr><td>No-leave timeout after ETD</td><td>${TIMES.noLeave}</td></tr></table><div class="note">Times used: arrivals EIBT then SIBT; departures TOBT, SOBT, then ATOT. Aircraft types in ICAO codes. Stands A6, A7, A8, A9, B10, B11, B12, B14.</div></div></div><h3>Check yourself</h3><div id="hQ"></div>`;
    const ui = AIP.hmi($('hH'), S); ui.R();
    el.querySelectorAll('[data-tr]').forEach((d) => (d.onclick = () => { const i = +d.dataset.tr; S.view = ['map', 'map', 'map', 'rids', 'safedocks', 'flights', 'map'][i]; S.drawer = i === 6; ui.R(); el.querySelectorAll('[data-tr]').forEach((x) => x.classList.toggle('cur', x === d)); }));
    quiz($('hQ'), [
      { q: 'What colour is the aircraft on the stand panel while it is docking?', a: ['Yellow', 'White', 'Green', 'Red'], c: 0 },
      { q: 'How many detailed stand views can be open at once?', a: ['4', '1', '8', 'Unlimited'], c: 0 },
      { q: 'Which alerts can NOT be acknowledged?', a: ['Active ones, e.g. an emergency stop still pressed', 'Technical ones', 'Alerts older than 1 hour', 'None – all can'], c: 0 },
      { q: 'Default operational mode at BIA?', a: ['Semi-automatic', 'Manual', 'Fully automatic', 'Standalone'], c: 0 },
      { q: 'In manual mode, how is a docking started?', a: ['From the operator panel or HMI by choosing the aircraft type', 'Automatically from FIDS', 'By the pilot', 'It cannot be'], c: 0 },
      { q: 'An arrival is still not on stand 45 min after ETA. AiPRON marks it…', a: ['No show', 'Skipped', 'Cancelled', 'Completed'], c: 0 },
      { q: 'Which command cancels an activation by mistake?', a: ['Shutdown', 'Park Off', 'Close stand', 'Acknowledge all'], c: 0 },
      { q: 'Which time is used first for an arrival’s sequence time?', a: ['EIBT', 'SIBT', 'ALDT', 'TOBT'], c: 0 },
    ], done, { n: 6 });
  });

  // ===== lab: run a shift
  item('ops', 'shift', '🗼', 'Run a shift on Pier 01', 'Live flights, a type change, a closed stand, lost connection, alerts and RIDS messages', 'lab', (el, done) => {
    const run = () => {
      const S = AIP.state(14 * 60 + 10);
      const F = (ad, no, stand, reg, type, seqt, extra = {}) => ({ ad, no, stand, reg, type, seqt, eibt: ad === 'A' ? seqt : null, eta: ad === 'A' ? seqt - 2 : null, tobt: ad === 'D' ? seqt : null, state: 'Pending', ...extra });
      S.flights = [F('A', 'UL 504', 'A7', '4R-ABN', 'B738', 14 * 60 + 25, { aldt: 14 * 60 + 13, confirmAt: 14 * 60 + 15 }), F('A', 'EK 650', 'A8', 'A6-EKR', 'A333', 13 * 60 + 55, { aldt: 13 * 60 + 47, aibt: 13 * 60 + 56, state: 'Completed' }), F('D', 'EK 651', 'A8', 'A6-EKR', 'A333', 14 * 60 + 40, { pushAt: 99999 }), F('A', 'QR 664', 'B12', 'A7-AHK', 'A320', 15 * 60 + 5), F('A', '6E 1171', 'B10', 'VT-IZK', 'A320', 13 * 60 + 20), F('A', 'SQ 468', 'B14', '9V-MBA', 'A306', 15 * 60 + 35), F('A', 'MH 179', 'A6', '9M-MXA', 'B738', 15 * 60 + 50)];
      S.stands.A8.state = 'parked'; S.stands.A8.type = 'A333';
      S.stands.B11.conn = false; S.stands.B11.lostAt = 13 * 60 + 58; AIP.alert(S, 'B11', 'Safedock connection lost', 'tech', true);
      S.stands.A7.pbb = 'OUT';
      AIP.alert(S, 'B14', 'Photocell: display brightness fixed at maximum', 'tech');
      const TK = [
        { t: 'Lighting works on A9 tonight: close stand A9.', ok: () => S.stands.A9.closed },
        { t: 'Show "STAND / CLOSED" in red on the A9 RIDS, all the time.', ok: () => { const r = S.stands.A9.rids; return r && /STAND/.test(r.lines.join(' ')) && /CLOSED/.test(r.lines.join(' ')) && r.col === '#ff5a4a' && r.dur === 'All the time'; } },
        { t: 'UL 504 is landing for A7, but the bridge on A7 is still OUT. Find the alert. (The bridge team parks it when you ask – press the PBB button below.)', ok: () => S.stands.A7.pbb === 'PARKED' && S.log.some((l) => l[0] === 'pbbcall') },
        { t: 'Let UL 504 dock on A7, then acknowledge its alerts.', ok: () => S.flights[0].aibt != null && !S.alerts.some((a) => a.stand === 'A7' && !a.ack) },
        { t: 'QR 664 for B12 comes with a B737-900 (B739), not the A320 FIDS still shows. Start the docking on B12 by hand with B739.', ok: () => S.log.some((l) => l[0] === 'start' && l[1] === 'B12' && l[2] === 'B739') },
        { t: 'EK 651 on A8 has been towed off but the stand still shows PARKED. Clear it.', ok: () => S.log.some((l) => l[0] === 'parkoff' && l[1] === 'A8') },
        { t: 'B11 has no connection. Find its Safedock IP for the field team and enter it here.', ok: () => (S.ans || {}).ip === AIP.IP.B11, ask: 'ip' },
        { t: 'When was 6E 1171 to B10 due (its SEQT)? It never arrived – what state is it in? Enter "hh:mm state".', ok: () => /^13:20\s+no\s*show$/i.test(((S.ans || {}).fl || '').trim()), ask: 'fl' },
        { t: 'Finish: acknowledge every alert that can be acknowledged.', ok: () => S.log.some((l) => l[0] === 'ackall') && !S.alerts.some((a) => !a.ack && !a.active) },
      ];
      el.innerHTML = `<div class="task">You are the apron controller on Pier 01 from 14:10. Work through the tasks in the HMI. Time runs ×6; use ×30 to move on. The pilot display of the stand you open last is shown under the tasks.</div>
        <div class="tw" style="grid-template-columns:minmax(0,2.3fr) minmax(0,1fr)"><div id="sH"></div><div><div class="row"><span class="m">Speed</span>${[1, 6, 30].map((v) => `<button class="btn s ${v === 6 ? 'on' : ''}" data-sp="${v}">×${v}</button>`).join('')}<button class="btn s" id="sPbb">Ask bridge team: park PBB on A7</button></div>
        <div class="steps" id="sTk"></div><div class="ctl"><div><label>B11 IP</label><input type="text" id="sIp"></div><div><label>6E 1171</label><input type="text" id="sFl" placeholder="hh:mm state"></div></div><div class="row" style="margin-top:6px"><button class="btn p s" id="sHo">Hand over the shift</button></div><div id="sRes"></div><div id="sPd" style="max-width:170px;margin:10px auto 0"></div></div></div>`;
      let sp = 6; const ui = AIP.hmi($('sH'), S, { after: () => upd() });
      const upd = () => { const tk = $('sTk'); if (!tk) return; tk.innerHTML = TK.map((x, i) => `<div class="${x.ok() ? 'ok' : ''}">${x.ok() ? '✓' : i + 1 + '.'} ${x.t}</div>`).join(''); const k = S.open[S.open.length - 1], s = k && S.stands[k]; $('sPd').innerHTML = s ? `${VD.pd(s.dock ? s.dock.view() : s.closed ? { rows: [[s.rids ? s.rids.lines[0] : 'CLOSED', 'r']] } : s.state === 'parked' ? { l1: s.type, big: 'OK', bc: 'g' } : { rows: [[k, 'a'], [AIP.hm(S.t), 'a']] }, 170)}<div class="note" style="text-align:center">Pilot display ${k}</div>` : ''; };
      el.querySelectorAll('[data-sp]').forEach((b) => (b.onclick = () => { sp = +b.dataset.sp; el.querySelectorAll('[data-sp]').forEach((x) => x.classList.toggle('on', x === b)); }));
      $('sPbb').onclick = () => { S.stands.A7.pbb = 'PARKED'; S.log.push(['pbbcall']); ui.R(); };
      $('sIp').oninput = () => { S.ans = { ...(S.ans || {}), ip: $('sIp').value.trim() }; upd(); };
      $('sFl').oninput = () => { S.ans = { ...(S.ans || {}), fl: $('sFl').value }; upd(); };
      $('sHo').onclick = () => { const n = TK.filter((x) => x.ok()).length; done(n, TK.length); VD.result($('sRes'), n, TK.length, TK.map((x) => [x.ok(), x.t]), run); };
      ui.R();
      VD.loop((dt) => { if (S.dlg || S.menu) return; AIP.tick(S, (dt * sp) / 60); if (!el.querySelector('#sH input:focus')) ui.R(); }, 500);
    };
    run();
  });
})();
