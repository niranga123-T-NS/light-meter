// Units 7–8: commissioning with the Safedock Maintenance Tool (training replica), the PBB / E-stop interlock test, fault-finding cases and the final test.
(() => {
  const { pd, dock, quiz, result, pick, shuffle, AC, GROUPS, STANDS, stopOf } = VD;
  const SCSS = `<style>.smt{border:1px solid #9aa3ad;border-radius:6px;overflow:hidden;font:12px "Segoe UI",Arial,sans-serif;background:#f3f3f3}.smt .tt{background:#1f3a60;color:#fff;padding:6px 10px;display:flex;justify-content:space-between}.smt .tabs{display:flex;flex-wrap:wrap;background:#e1e4e8;border-bottom:1px solid #c5c9cf}.smt .tabs span{padding:6px 10px;cursor:pointer}.smt .tabs span.on{background:#fff;border-top:2px solid #1f6fd1;font-weight:700}.smt .bd{background:#fff;padding:12px;min-height:280px}.smt label{display:grid;grid-template-columns:200px 1fr;gap:8px;align-items:center;margin:4px 0}.smt input,.smt select{border:1px solid #9aa3ad;padding:3px 6px;font:12px "Segoe UI",Arial,sans-serif}.smt .sb{background:#e1e4e8;border-top:1px solid #c5c9cf;padding:4px 10px;font-size:11px}</style>`;

  // ===== Unit 7 lab: commission a stand with SMT
  item('comm', 'smt', '🛠️', 'Commission stand A7 with SMT', 'Connect, network, calibration, stops, aircraft types, PBB I/O, display, test dockings, backup', 'lab', (el, done) => {
    const run = () => {
      const st = 'A7', IPA = AIP.IP[st], gs = STANDS[st].groups;
      const C = { conn: false, net: { gw: '', srv: '', ntp: '' }, written: false, stops: {}, types: new Set(Object.keys(AC)), cal: { az0: +(Math.random() * 1.4 - 0.7).toFixed(2), r0: +(Math.random() * 0.6 - 0.3).toFixed(2), az: 0, r: 0 }, io: { in1: '', rule: '', out1: '' }, disp: { auto: false, units: 'm' }, ver: {}, backup: '' };
      let tab = 'Connect';
      const TABS = ['Connect', 'Status', 'Network', 'Calibration', 'Stand', 'Aircraft', 'I/O', 'Display', 'Test docking', 'Backup'];
      el.innerHTML = `<div class="task">Commission <b>${st}</b> from the mgmt-tools workstation. Unit DGS-${st} is at <b>${IPA}</b> (field VLAN, gateway 10.20.0.1). AiPRON server 10.30.0.21, NTP 192.168.1.20. Stop positions from drawing L-001 (see Unit 2). A reference reflector stands on the centreline exactly <b>20.00 m</b> from the scanner. The PBB “parked” contact is wired to extended input 1 (normally closed); extended output 1 goes to the PBB drive inhibit.</div><div class="tw" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div id="mS"></div><div id="mO"></div></div>`;
      const ch = GROUPS.filter(([g]) => gs.includes(g));
      const meas = () => ({ lat: +(20 * Math.tan(((C.cal.az0 - C.cal.az) * Math.PI) / 180)).toFixed(2), dist: +(20 + (C.cal.r0 - C.cal.r)).toFixed(2) });
      const calOk = () => { const m = meas(); return Math.abs(m.lat) <= 0.02 && Math.abs(m.dist - 20) <= 0.02; };
      const R = () => {
        const body = !C.conn && tab !== 'Connect' ? '<p>Not connected – use Connect first.</p>' : {
          Connect: () => `<label>Safedock IP address <input id="cIp" value="${C.ip || ''}" placeholder="e.g. 10.20.0.x"></label><label>Service password <input type="password" id="cPw" value="${C.pw || ''}"></label><button class="btn p s" id="cGo">Connect</button> <span id="cM"></span><p class="note">Ping it first from the workstation if it does not answer.</p>`,
          Status: () => `<table class="spec"><tr><td>Unit</td><td>DGS-${st} · Safedock FleX</td></tr><tr><td>Software</td><td>FleX 3.x (example)</td></tr><tr><td>State</td><td>Ready</td></tr><tr><td>Scanner temperature</td><td>41 °C</td></tr><tr><td>Display</td><td>PDFleX connected · photosensor ${C.disp.auto ? 'in use' : 'not used'}</td></tr><tr><td>Emergency stop</td><td>Released</td></tr></table>`,
          Network: () => `<label>IP address <input value="${IPA}" disabled></label><label>Subnet mask <input value="255.255.255.0" disabled></label><label>Default gateway <input id="nGw" value="${C.net.gw}"></label><label>AiPRON Manager server <input id="nSv" value="${C.net.srv}"></label><label>NTP server <input id="nNt" value="${C.net.ntp}"></label><button class="btn p s" id="nWr">Write to unit</button>`,
          Calibration: () => { const m = meas(); return `<p>The reflector is on the centreline at 20.00 m. Adjust the azimuth and range offsets until the unit reads lateral 0.00 m and distance 20.00 m.</p><div class="ctl"><div><label>Azimuth offset <b>${C.cal.az.toFixed(2)}°</b></label><input type="range" id="kAz" min="-1" max="1" step="0.01" value="${C.cal.az}"></div><div><label>Range offset <b>${C.cal.r.toFixed(2)} m</b></label><input type="range" id="kR" min="-0.5" max="0.5" step="0.01" value="${C.cal.r}"></div></div><div class="kpis"><div><b style="color:${Math.abs(m.lat) <= 0.02 ? 'var(--good)' : 'var(--bad)'}">${m.lat.toFixed(2)} m</b>Measured lateral</div><div><b style="color:${Math.abs(m.dist - 20) <= 0.02 ? 'var(--good)' : 'var(--bad)'}">${m.dist.toFixed(2)} m</b>Measured distance</div></div>`; },
          Stand: () => `<p>Stop position of each aircraft group, metres from the scanner (drawing L-001 chain: ${ch.map(([g, d], i) => (i ? `+${(d - ch[i - 1][1]).toFixed(2)}` : d.toFixed(2))).sort().join(' … ')} – read Unit 2).</p>${[...ch].sort((a, b) => a[1] - b[1]).map(([g]) => `<label>${g} <input type="number" step="0.01" data-sp="${g}" value="${C.stops[g] ?? ''}"></label>`).join('')}`,
          Aircraft: () => `<p>Enable only the types this stand takes (its fleet groups: ${gs.join(', ')}).</p><div style="columns:2">${Object.keys(AC).map((t) => `<label style="display:flex;gap:6px"><input type="checkbox" data-ty="${t}" ${C.types.has(t) ? 'checked' : ''}> ${t} – ${AC[t].n} <span class="m">(${AC[t].g})</span></label>`).join('')}</div>`,
          'I/O': () => `<label>Extended input 1 <select id="iI1"><option></option><option>PBB parked (NC contact)</option><option>PBB parked (NO contact)</option><option>GPU connected</option></select></label><label>Rule <select id="iRu"><option></option><option>Block docking (WAIT) when PBB not parked</option><option>Log only</option><option>Stop the scanner</option></select></label><label>Extended output 1 <select id="iO1"><option></option><option>Docking active → PBB drive inhibit</option><option>Parked → PBB drive inhibit</option><option>Not used</option></select></label><div class="note">A normally-closed contact fails safe: a broken wire reads “not parked” and blocks the docking.</div>`,
          Display: () => `<label>Brightness <select id="dB"><option>Fixed 100 %</option><option ${C.disp.auto ? 'selected' : ''}>Automatic from the photosensor</option></select></label><label>Distance units <select id="dU"><option>m</option><option>ft</option></select></label><label>Language <select><option>English</option></select></label>`,
          'Test docking': () => `<p>Run one verification docking per aircraft group. A docking passes when the nose stops within 0.10 m of the real stop position.</p><table class="spec"><tr><th>Group</th><th>Real stop m</th><th>Stopped at m</th><th>Result</th><th></th></tr>${ch.map(([g, d]) => { const v = C.ver[g]; return `<tr><td>${g}</td><td>${d.toFixed(2)}</td><td>${v ? v.at.toFixed(2) : '—'}</td><td>${v ? (v.ok ? '<span class="okc">PASS</span>' : '<span class="noc">FAIL</span>') : ''}</td><td><button class="btn s" data-tv="${g}">Run test docking</button></td></tr>`; }).join('')}</table>`,
          Backup: () => `<p>Save the configuration to the server share using the AiPRON naming scheme.</p><label>File name <input id="bF" style="width:100%" value="${C.backup}" placeholder="SafedockConfiguration_Stand-ID_DATETTIME.scfg"></label><button class="btn p s" id="bS">Save</button> <span id="bM"></span>`,
        }[tab]();
        $('mS').innerHTML = `${SCSS}<div class="smt"><div class="tt"><span>Safedock Maintenance Tool (training replica)</span><span>${C.conn ? `● DGS-${st} ${IPA}` : '○ not connected'}</span></div><div class="tabs">${TABS.map((t) => `<span class="${t === tab ? 'on' : ''}" data-tb="${t}">${t}</span>`).join('')}</div><div class="bd">${body}</div><div class="sb">mgmt-tools · 10.30.0.22 → field VLAN 20</div></div>`;
        el.querySelectorAll('[data-tb]').forEach((x) => (x.onclick = () => { tab = x.dataset.tb; R(); }));
        const q = (s) => el.querySelector(s);
        if (q('#cGo')) q('#cGo').onclick = () => { C.ip = q('#cIp').value.trim(); C.pw = q('#cPw').value; if (C.ip !== IPA) q('#cM').innerHTML = '<span class="noc">No answer from ' + esc(C.ip) + ' (timeout)</span>'; else if (!C.pw) q('#cM').innerHTML = '<span class="noc">Password needed</span>'; else { C.conn = true; tab = 'Status'; R(); } };
        if (q('#nWr')) q('#nWr').onclick = () => { C.net = { gw: q('#nGw').value.trim(), srv: q('#nSv').value.trim(), ntp: q('#nNt').value.trim() }; C.written = true; R(); };
        if (q('#kAz')) { q('#kAz').oninput = () => { C.cal.az = +q('#kAz').value; R(); }; q('#kR').oninput = () => { C.cal.r = +q('#kR').value; R(); }; }
        el.querySelectorAll('[data-sp]').forEach((x) => (x.onchange = () => { C.stops[x.dataset.sp] = parseFloat(x.value); C.ver = {}; upd(); }));
        el.querySelectorAll('[data-ty]').forEach((x) => (x.onchange = () => { x.checked ? C.types.add(x.dataset.ty) : C.types.delete(x.dataset.ty); upd(); }));
        if (q('#iI1')) { q('#iI1').value = C.io.in1; q('#iRu').value = C.io.rule; q('#iO1').value = C.io.out1; ['iI1', 'iRu', 'iO1'].forEach((id) => (q('#' + id).onchange = () => { C.io = { in1: q('#iI1').value, rule: q('#iRu').value, out1: q('#iO1').value }; upd(); })); }
        if (q('#dB')) q('#dB').onchange = () => { C.disp.auto = q('#dB').selectedIndex === 1; upd(); };
        el.querySelectorAll('[data-tv]').forEach((x) => (x.onclick = () => { const g = x.dataset.tv, real = stopOf(g), set = C.stops[g], m = meas(); const at = Number.isFinite(set) ? set + (m.dist - 20) : NaN; C.ver[g] = { at: Number.isFinite(at) ? at : 0, ok: Number.isFinite(at) && Math.abs(at - real) <= 0.1 && Math.abs(m.lat) <= 0.05 && [...C.types].some((t) => AC[t].g === g) }; R(); }));
        if (q('#bS')) q('#bS').onclick = () => { C.backup = q('#bF').value.trim(); q('#bM').innerHTML = /^SafedockConfiguration_A7_\d{8}T\d{4,6}\.scfg$/.test(C.backup) ? '<span class="okc">Saved</span>' : '<span class="noc">Use SafedockConfiguration_A7_YYYYMMDDThhmm.scfg</span>'; upd(); };
        upd();
      };
      const typesOk = () => Object.keys(AC).every((t) => C.types.has(t) === gs.includes(AC[t].g));
      const upd = VDOBJ($('mO'), [
        { t: `Connected to DGS-${st} (${IPA})`, ok: () => C.conn, h: `Connect tab: ${IPA} and the service password` },
        { t: 'Network: gateway 10.20.0.1, AiPRON 10.30.0.21, NTP 192.168.1.20 written', ok: () => C.written && C.net.gw === '10.20.0.1' && C.net.srv === '10.30.0.21' && C.net.ntp === '192.168.1.20', h: 'Network tab, then Write to unit' },
        { t: 'Calibrated on the 20.00 m reflector (lateral 0.00, distance 20.00)', ok: calOk, h: 'Calibration: move the offsets until both readings turn green' },
        { t: 'Stop position of every group entered', ok: () => ch.every(([g, d]) => Math.abs((C.stops[g] ?? -9) - d) <= 0.02), h: 'Stand tab: add the chain dimensions in order, e.g. 25.64, 26.19, 28.44 …' },
        { t: `Only ${st}'s aircraft types enabled`, ok: typesOk, h: `Aircraft tab: untick the A350-900 – ${st} does not take the A350 group` },
        { t: 'PBB interlock: NC parked input blocks docking; docking output inhibits the bridge', ok: () => /NC/.test(C.io.in1) && /Block docking/.test(C.io.rule) && /Docking active/.test(C.io.out1), h: 'I/O tab: PBB parked (NC), Block docking when not parked, Docking active → PBB drive inhibit' },
        { t: 'Display brightness automatic (photosensor)', ok: () => C.disp.auto, h: 'Display tab' },
        { t: 'A passing test docking for every group', ok: () => ch.every(([g]) => C.ver[g] && C.ver[g].ok), h: 'Test docking tab – calibrate and enter the stops first; changing a stop clears the tests' },
        { t: 'Configuration backed up with the right name', ok: () => /^SafedockConfiguration_A7_\d{8}T\d{4,6}\.scfg$/.test(C.backup), h: `e.g. SafedockConfiguration_A7_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}T1430.scfg` },
      ], done, run);
      R();
    };
    run();
  });

  // ===== Unit 7 lab: the interlock tests
  item('comm', 'pbb', '🛂', 'PBB & emergency stop tests', 'Prove the bridge interlock and the E-stop on a live docking, and fill in the test sheet', 'lab', (el, done) => {
    const run = () => {
      let S = null, pbb = 'OUT', inhibit = false, est = false, did = new Set(), driveTried = false;
      const OBS = [['WAIT – docking held', 'Lead-in, docking goes on', 'STOP', 'OK'], ['Lead-in, docking goes on', 'WAIT – docking held', 'TOO FAR', 'Nothing'], ['Bridge will not drive (inhibited)', 'Bridge drives', 'Display shows STOP'], ['STOP on the display, active alert in AiPRON', 'Docking continues', 'OK'], ['Docking can be started again and ends OK', 'Unit needs a reboot', 'TOO FAR'], ['Bridge may drive again', 'Bridge still inhibited', 'Display shows WAIT']];
      const TESTS = ['With the PBB OUT, activate a docking for B738', 'Park the PBB', 'While docking, try to drive the PBB', 'Press the E-stop on the FOP-L at about 8 m', 'Release the E-stop, re-activate, let it park', 'After OK, try to drive the PBB'];
      el.innerHTML = `<div class="task">Interlock tests on stand A7 before handover. Do each test on the simulator and record what you <b>see</b> on the sheet. The sheet is only signed if every test was done and recorded correctly.</div>
        <div class="tw"><div><div class="row"><span class="pill" id="pP">PBB: OUT</span><button class="btn s" id="pPark">Park PBB</button><button class="btn s" id="pOut">Move PBB out</button><button class="btn s" id="pDrive">Drive PBB</button><button class="btn s" id="pAct">Activate docking B738</button><button class="btn red s" id="pE">E-STOP</button><button class="btn s" id="pRel">Release E-stop</button></div><div id="pMsg" class="note"></div>
          <table class="spec" style="margin-top:8px"><tr><th>#</th><th>Test</th><th>Observed</th></tr>${TESTS.map((t, i) => `<tr><td>${i + 1}</td><td>${t}</td><td><select id="pO${i}"><option></option>${shuffle(OBS[i]).map((o) => `<option>${o}</option>`).join('')}</select></td></tr>`).join('')}</table><button class="btn p" id="pSign" style="margin-top:8px">Sign the test sheet</button><div id="pRes"></div></div>
        <div><div id="pPd" style="max-width:220px;margin:auto"></div><div class="note" style="text-align:center" id="pX"></div></div></div>`;
      const msg = (m) => ($('pMsg').textContent = m);
      const sync = () => { $('pP').textContent = `PBB: ${pbb}${inhibit ? ' · drive inhibited' : ''}`; };
      $('pPark').onclick = () => { if (inhibit) return msg('The bridge drive is inhibited.'); pbb = 'PARKED'; if (S && S.blocked) did.add(1); sync(); };
      $('pOut').onclick = () => { if (inhibit) return msg('The bridge drive is inhibited.'); pbb = 'OUT'; sync(); };
      $('pDrive').onclick = () => { if (inhibit) { did.add(2); msg('PBB drive pressed – nothing moves: the drive is inhibited by the Safedock.'); } else { if (did.has(4)) did.add(5); msg('The bridge drives.'); } driveTried = true; };
      $('pAct').onclick = () => { if (est) return msg('Release and reset the E-stop first.'); S = dock({ type: 'B738', x0: 60 }); S.blocked = pbb !== 'PARKED'; if (S.blocked) did.add(0); if (did.has(3)) did.add('re'); msg('Docking activated.'); };
      $('pE').onclick = () => { if (S && ['lead', 'closing'].includes(S.phase) && S.x < 12) did.add(3); est = true; if (S) S.estop = true; msg('E-stop pressed. AiPRON alert: “Emergency stop” (active – cannot be acknowledged).'); };
      $('pRel').onclick = () => { est = false; msg('E-stop released and reset.'); S = null; };
      VD.loop((dt) => {
        if (S) { S.blocked = pbb !== 'PARKED'; S.step(Math.min(dt, 0.1) * 2.5); inhibit = ['lead', 'closing', 'active'].includes(S.phase) && !S.blocked; if (S.phase === 'ok') { inhibit = false; if (did.has('re')) did.add(4); } }
        $('pPd').innerHTML = pd(S ? S.view() : est ? { big: 'STOP', blink: true } : { rows: [['A7', 'a'], [VD.clock(), 'a']] }, 220); $('pX').textContent = S ? `${S.x.toFixed(1)} m to stop` : ''; sync();
      }, 100);
      $('pSign').onclick = () => {
        const rows = TESTS.map((t, i) => [did.has(i) && $(`pO${i}`).value === OBS[i][0], `${i + 1}. ${t} → ${OBS[i][0]}${did.has(i) ? '' : ' (test not done on the simulator)'}`]);
        const sc = rows.filter((r) => r[0]).length; done(sc, rows.length); result($('pRes'), sc, rows.length, rows, run);
      };
    };
    run();
  });

  // ===== Unit 8 lab: fault-finding cases
  const CASES = [
    { t: 'Stand B11 is red on the AiPRON map (“Safedock connection lost”) but the display still docks aircraft.', tools: { 'Ping 10.20.0.21 from aipron-node': 'Destination Host Unreachable', 'Ping it from a laptop on the stand switch': 'Reply from 10.20.0.21 time<1ms', 'Field switch: show port Gi1/0/11': 'Port up, 100 Mb full, VLAN 1 (default) – the other Safedock ports are in VLAN 20', 'Pilot display': 'Docks normally – standalone mode', 'Multimeter at the scanner supply': '231 V' }, causes: ['The switch port was replaced and left in VLAN 1', 'The scanner is broken', 'AiPRON server is down', 'The network cable is cut'], fix: ['Put the port in VLAN 20 (access) and check the map turns green', 'Replace the scanner', 'Reboot the AiPRON server', 'Re-terminate the cable'] },
    { t: 'The PDFleX on A8 is dark after heavy rain. The scanner and the operator panel work.', tools: { 'Stand DB': 'MCB “PD” tripped', 'Insulation test of the PD supply cable': '0.3 MΩ at 500 V (low)', 'Look at the PDFleX power connector': 'powerCON plug not twisted to lock – water inside the connector', 'AiPRON alerts': '“Display not responding” on A8' }, causes: ['Water in an unlocked powerCON connector made an earth fault', 'The LED modules are worn out', 'Wrong network cable', 'Photosensor dirty'], fix: ['Dry it, re-make and lock the NAC3FX-W-TOP, prove insulation > 1 MΩ, reset the MCB', 'Reset the MCB only', 'Change the display', 'Turn brightness down'] },
    { t: 'On A6 every B787-8 stops 1.2 m short of the bridge; other types are fine.', tools: { 'SMT – Stand tab': 'B787-8 stop: 24.99 m · A350: 24.94 m · B747/B777: 25.64 m', 'Drawing L-001': 'B787-8 stop 26.19 m from the scanner', 'pdock log of the last docking': 'type B788, final distance 0.0 m to the configured stop', 'Calibration reading': 'Reflector 20.00 m, lateral 0.00 m' }, causes: ['The B787-8 stop position was typed wrong in SMT', 'The scanner is mis-calibrated', 'Pilots stop too early', 'The pole bends'], fix: ['Correct the stop to 26.19 m, run a verification docking, back up the .scfg', 'Recalibrate the scanner', 'Brief the pilots', 'Stiffen the pole'] },
    { t: 'On B10 every docking shows WAIT although the bridge is parked.', tools: { 'SMT – I/O status': 'Extended input 1 (PBB parked, NC): OPEN', 'Bridge control panel': 'Bridge in PARKED position', 'Continuity of the contact pair at the FOP-L terminal': 'Open circuit', 'Bridge limit switch': 'Contact closes when parked' }, causes: ['The PBB parked signal wire is broken between the bridge and the FOP-L', 'The Safedock software is wrong', 'The PBB is not parked', 'The E-stop is pressed'], fix: ['Repair the wire, prove the input reads CLOSED when parked, re-test the interlock', 'Bridge the input permanently', 'Change the rule to Log only', 'Reboot the FOP-L'] },
    { t: 'AIBT times sent to FIDS are 4 minutes different from the tower clock.', tools: { 'chronyc sources on aipron-node': '^? 192.168.1.20 – Reach 0', 'Firewall log (integration)': 'DENY udp 10.30.0.21 → 192.168.1.20:123', 'timedatectl': 'System clock synchronized: no', 'AiPRON STATUS chips': 'NTP: warning' }, causes: ['NTP (UDP 123) to 192.168.1.20 is blocked by the firewall', 'The time zone is wrong', 'FIDS sends wrong times', 'The CMOS battery is flat'], fix: ['Allow UDP 123 from the server segment to 192.168.1.20, check chronyc shows ^*', 'Change the time zone', 'Set the clock by hand', 'Restart AiPRON'] },
    { t: 'Every HMI PC shows “Your connection is not private” on web.aipron.<domain>.', tools: { 'Certificate in the browser': 'Issued by: cert-manager self-signed CA', 'kubectl get certificate -n aipron': 'aipron-web-tls READY True (issuer selfsigned)', 'PC certificate store': 'Root not present' }, causes: ['Self-signed certificates were used and the root is not on the PCs', 'The site is hacked', 'DNS is wrong', 'Chrome is too old'], fix: ['Use the BIA-issued certificate (bia-ca issuer) or push the root to all PCs by group policy', 'Tell users to click Proceed', 'Switch to HTTP', 'Reinstall Chrome'] },
    { t: 'A new A20N (A320neo) flight to B12 shows ID FAIL and STOP every time.', tools: { 'SMT – Aircraft tab': 'A20N not in the enabled list / not in the database', 'pevent log': 'ID check failed: profile A20N unknown', 'Flight list': 'AC type A20N from FIDS' }, causes: ['The A20N type is not in the Safedock aircraft database for B12', 'The scanner window is dirty', 'The pilot steered off the line', 'FIDS is down'], fix: ['Add / enable the A20N profile with SMT (from the central tool), test-dock, back up the .scfg', 'Clean the window', 'Dock it as A320', 'Turn off the ID check'] },
    { t: 'At night the B14 pilot display is dazzling; by day it is fine.', tools: { 'SMT – Display tab': 'Brightness: fixed 100 %', 'Photosensor reading': '— (not used)', 'AiPRON alerts': '“Photocell: display brightness fixed at maximum”' }, causes: ['Automatic brightness from the photosensor is turned off', 'LED modules failing', 'Wrong video cable', 'Too much voltage'], fix: ['Set brightness to automatic from the photosensor and check day/night', 'Change the LED modules', 'Fit a dimmer', 'Cover half the display'] },
    { t: 'No FIDS flights in the AiPRON flight list since this morning.', tools: { 'kubectl get pods -n aipron': 'fids-aidx-adapter 0/1 CrashLoopBackOff', 'kubectl logs fids-aidx-adapter': 'x509: certificate has expired (fids.bia.local)', 'STATUS chip': 'FIDS ✗' }, causes: ['The FIDS server certificate expired, the adapter refuses the connection', 'The aircraft are all late', 'The Safedocks are offline', 'Disk full'], fix: ['Ask AASL IT to renew the FIDS certificate, then restart the adapter pod; run manual mode meanwhile', 'Turn off certificate checks', 'Reinstall AiPRON', 'Wait for tomorrow'] },
    { t: 'The nightly backup of VM 101 failed twice this week.', tools: { 'Proxmox task log': 'ERROR: Backup of VM 101 failed – unable to open file … No space left on device', 'Storage backup-pve2': 'Usage 99.6 %', 'Backup job retention': 'keep-daily 0, keep-weekly 0 (keep all)' }, causes: ['The job has no retention, so pve2 filled up', 'The VM is too big', 'NFS is slow', 'The guest agent is missing'], fix: ['Set retention (keep 7 daily, 4 weekly), prune old backups, run the job and check it', 'Stop backing up', 'Delete the VM', 'Back up only on Sundays'] },
  ];
  item('fault', 'faults', '🔎', 'Fault-finding on the live system', 'Three random cases each time – use the tools, name the root cause, choose the fix', 'lab', (el, done) => {
    const run = () => {
      const picks = shuffle(CASES).slice(0, 3); let ci = 0, score = 0;
      const show = () => {
        if (ci >= picks.length) { done(score, picks.length * 2); el.innerHTML = '<div id="fRes"></div>'; result($('fRes'), score, picks.length * 2, [[score === picks.length * 2, `${score} of ${picks.length * 2}: a point for the root cause, a point for the fix`]], run); return; }
        const c = picks[ci], ca = shuffle(c.causes), fx = shuffle(c.fix);
        el.innerHTML = `<div class="task"><b>Case ${ci + 1} of 3.</b> ${esc(c.t)}</div><div class="two"><div><h4>Tools</h4><div class="chips">${Object.keys(c.tools).map((k, i) => `<button class="btn s" data-tl="${i}">${esc(k)}</button>`).join('')}</div><div class="term" style="min-height:140px" id="fOut">Choose a tool to see what it shows.</div></div>
          <div><h4>Root cause</h4>${ca.map((x, i) => `<label style="display:block"><input type="radio" name="fc" value="${esc(x)}"> ${esc(x)}</label>`).join('')}<h4>Fix</h4>${fx.map((x) => `<label style="display:block"><input type="radio" name="ff" value="${esc(x)}"> ${esc(x)}</label>`).join('')}<button class="btn p" id="fGo" style="margin-top:8px">Close the case</button><div id="fM"></div></div></div>`;
        let used = 0; el.querySelectorAll('[data-tl]').forEach((b) => (b.onclick = () => { used++; const k = Object.keys(c.tools)[+b.dataset.tl]; $('fOut').textContent += `\n> ${k}\n${c.tools[k]}`; $('fOut').scrollTop = 1e6; }));
        $('fGo').onclick = () => { const a = el.querySelector('input[name=fc]:checked'), f = el.querySelector('input[name=ff]:checked'); if (!a || !f) return ($('fM').innerHTML = '<span class="noc">Choose a cause and a fix</span>'); const ok1 = a.value === c.causes[0], ok2 = f.value === c.fix[0]; score += ok1 + ok2; $('fM').innerHTML = `<div class="${ok1 && ok2 ? 'say' : 'watch'}">${ok1 ? '✓' : '✗'} Cause: ${esc(c.causes[0])}<br>${ok2 ? '✓' : '✗'} Fix: ${esc(c.fix[0])}${used === 0 ? '<br>Next time prove it with a tool before you decide.' : ''}</div><button class="btn s" id="fNx">Next case</button>`; $('fGo').disabled = true; $('fNx').onclick = () => { ci++; show(); }; };
      };
      show();
    };
    run();
  });

  // ===== final test
  item('fault', 'final', '🎓', 'Final test', '20 questions across the course – pass with 2 of 3', 'exam', (el, done) => {
    quiz(el, [
      { q: 'Mounting height of the FleX (bottom edge) above ground?', a: ['4–8 m', '1–2 m', '10–12 m', '15 m'], c: 0 },
      { q: 'Clamp torque recommended by the guide?', a: ['35 Nm', '15 Nm', '60 Nm', '100 Nm'], c: 0 },
      { q: 'Rail spacing on the pole for the PDFleX?', a: ['845 mm', '600 mm', '220 mm', '1000 mm'], c: 0 },
      { q: 'Minimum gap between pilot display and scanner?', a: ['220 mm', '50 mm', '600 mm', '1 m'], c: 0 },
      { q: 'Mains cable recommended for each unit?', a: ['3 × 1.5 mm²', '2 × 0.75 mm²', '4 × 10 mm²', 'CAT6'], c: 0 },
      { q: 'Minimum rating of the protective device per unit?', a: ['10 A', '2 A', '63 A', '100 mA'], c: 0 },
      { q: 'Maximum cable length to the switch / DB recommended?', a: ['100 m', '300 m', '1 km', 'No limit'], c: 0 },
      { q: 'Cable diameter range of the NE8MX-TOP etherCON?', a: ['5–8 mm', '8–13 mm', '6–12 mm', '2–4 mm'], c: 0 },
      { q: 'At 30 m from the scanner, the front-to-back deflection allowed is…', a: ['0.4°', '0.8°', '0.1°', '2°'], c: 0 },
      { q: 'At BIA the arrival appears on the RIDS…', a: ['20 min before SEQT', 'At ALDT', '40 min before ETD', 'At AIBT'], c: 0 },
      { q: 'A departure is scheduled on the Safedock…', a: ['40 min before', 'At TOBT', '5 min before', 'After push-back'], c: 0 },
      { q: 'No-leave timeout after ETD?', a: ['90 min', '45 min', '20 min', '10 min'], c: 0 },
      { q: 'Which OS runs the AiPRON server?', a: ['RHEL 8.8', 'Windows Server 2022', 'Ubuntu Desktop', 'ESXi'], c: 0 },
      { q: 'Kubernetes at BIA runs as…', a: ['A single node, not highly available', 'A three-node cluster', 'Docker Compose only', 'On the Safedocks'], c: 0 },
      { q: 'Why disconnect the restored VM’s network before its first start in a restore drill?', a: ['So its IP does not clash with the live server', 'To make it boot faster', 'Proxmox requires it', 'To save licences'], c: 0 },
      { q: 'The airport NTP server for the project is…', a: ['192.168.1.20 (UDP 123)', 'pool.ntp.org', '10.20.0.1', 'The FIDS server'], c: 0 },
      { q: 'Safedock log files pulled by AiPRON are…', a: ['pdock, pbrief, pevent', 'syslog only', '.scfg', 'Windows event logs'], c: 0 },
      { q: 'The tool used to add aircraft types to a Safedock?', a: ['SMT – Safedock Maintenance Tool', 'SLV', 'Grafana', 'ETS'], c: 0 },
      { q: 'A normally-closed PBB “parked” contact is used because…', a: ['A broken wire reads not parked and blocks the docking (fail safe)', 'It is cheaper', 'NO contacts are not allowed', 'It uses less power'], c: 0 },
      { q: 'The E-stop on the current FOP-L is connected…', a: ['Over the network', 'Hard-wired to the scanner', 'To the PBB', 'To AiPRON only'], c: 0 },
      { q: 'Which DNS name is Keycloak?', a: ['login.aipron.<domain>', 'web.aipron.<domain>', 'grafana.aipron.<domain>', 'idp.local'], c: 0 },
      { q: 'Proxmox web UI port?', a: ['8006', '443', '8080', '22'], c: 0 },
      { q: 'Which VM setting lets Proxmox shut the guest down and freeze it cleanly for backups?', a: ['QEMU guest agent', 'Ballooning', 'IO thread', 'VLAN tag'], c: 0 },
      { q: 'What does the Safedock do if AiPRON or the network fails?', a: ['Keeps docking standalone', 'Stops all dockings', 'Shows WAIT forever', 'Reboots'], c: 0 },
    ], done, { n: 20 });
  });
})();
