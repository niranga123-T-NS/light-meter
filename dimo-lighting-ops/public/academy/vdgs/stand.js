// Units 1–2: what an A-VDGS does (lesson + watch a docking) and stand planning (stop positions from the layout drawing, mounting height from the side view)
(() => {
  const { pd, dock, PHASE, quiz, result, loop, pick, shuffle, AC, GROUPS, STANDS, stopOf } = VD;

  // a top-view aircraft (nose at x, pointing to the unit on the left); px per metre k
  const plane = (x, y, a, k, col = '#c9ced6') => {
    const L = a.len * k, S = a.span * k, F = 2.1 * k, wx = x + L * 0.42, tx = x + L * 0.9;
    return `<g fill="none" stroke="${col}" stroke-width="1.4"><path d="M${x} ${y} C ${x + 3 * k} ${y - F} ${x + 6 * k} ${y - F} ${x + 8 * k} ${y - F} L ${x + L} ${y - F * 0.4} L ${x + L} ${y + F * 0.4} L ${x + 8 * k} ${y + F} C ${x + 6 * k} ${y + F} ${x + 3 * k} ${y + F} ${x} ${y} Z"/><path d="M${wx} ${y - F} L ${wx + 0.18 * L} ${y - S / 2} L ${wx + 0.26 * L} ${y - S / 2} L ${wx + 0.2 * L} ${y - F} M${wx} ${y + F} L ${wx + 0.18 * L} ${y + S / 2} L ${wx + 0.26 * L} ${y + S / 2} L ${wx + 0.2 * L} ${y + F}"/><path d="M${tx} ${y - F * 0.6} L ${tx + 0.05 * L} ${y - S * 0.17} L ${tx + 0.09 * L} ${y - S * 0.17} L ${tx + 0.08 * L} ${y} L ${tx + 0.09 * L} ${y + S * 0.17} L ${tx + 0.05 * L} ${y + S * 0.17} L ${tx} ${y + F * 0.6}"/></g>`;
  };

  // ===== Unit 1 lesson
  const PARTS = [
    ['scan', 'FleX scanner unit', 'A 3D laser scanner on the stand centreline, 4–8 m up. It finds the aircraft, checks its type from its shape (nose, engines, wings), measures its distance to the stop and its offset from the centreline many times a second.'],
    ['pd', 'Pilot display (PDFleX)', 'A full-colour LED display above the scanner. It shows the aircraft type, the distance to go, the centreline with the aircraft symbol, a red arrow to steer, and STOP / OK / TOO FAR / WAIT / SLOW / ID FAIL.'],
    ['op', 'Fixed Operator Panel Light (FOP-L)', 'At apron level, near the bridge. Ground staff confirm or change the aircraft type, start or cancel a docking and press the emergency stop. It has its own power and network connection.'],
    ['pbb', 'Passenger boarding bridge', 'Connected by dry contacts: while the bridge is not PARKED the A-VDGS will not dock (it shows WAIT), and during a docking the bridge is held.'],
    ['srv', 'AiPRON Manager server', 'The central software: takes flights from FIDS, schedules each Safedock, shows every stand to the apron controllers, stores the docking logs and sends the in-block and off-block times back to FIDS.'],
    ['fids', 'FIDS / AODB', 'The airport flight database. Sends flight plans (stand, type, ETA, EIBT, TOBT…) over the AIDX 16.1 interface and receives AIBT / AOBT.'],
  ];
  const FLOW = [['ready', 'Ready', 'Idle. The display shows RIDS: stand ID and time, or the next flight.', { rows: [['A7', 'a'], ['14:12', 'a']] }], ['sched', 'Scheduled', 'AiPRON has sent the next flight. At BIA the arrival appears on the RIDS 20 min before SEQT and the Safedock is scheduled at ALDT (landing).', { rows: [['UL504', 'a'], ['B738', 'a'], ['EIBT', 'a'], ['14:35', 'a']] }], ['active', 'Active', 'Ground staff confirmed the type on the operator panel (or the HMI). The display shows the type and moving arrows: it is waiting for the aircraft.', { l1: 'B738', float: 8 }], ['docking', 'Docking', 'Aircraft captured: lead-in on the centreline, steering arrow, then the distance to go from 20 m and the closing bar.', { l1: 'B738', l2: '6.4m', guide: { dist: 6.4, lat: -0.6, arrow: 'r' } }], ['parked', 'Parked', 'STOP, then OK. The in-block time (AIBT) goes to FIDS. The aircraft is checked every 60 s while parked.', { l1: 'B738', big: 'OK', bc: 'g' }], ['psched', 'Parked – scheduled', 'The departure is scheduled (40 min before). When the aircraft has pushed back far enough the stand goes to Ready and AOBT is sent.', { rows: [['UL505', 'a'], ['TOBT', 'a'], ['15:40', 'a']] }]];
  item('intro', 'intro', '🛬', 'The A-VDGS on a BIA stand', 'Scanner, pilot display, operator panel, AiPRON, the docking states', 'lesson', (el, done) => {
    el.innerHTML = `<div class="tw"><div>
      <p>An <b>A-VDGS</b> (Advanced Visual Docking Guidance System, ICAO Annex 14 §5.3.25 and §5.3.26) guides the pilot from the taxi lane to the exact stop position of the stand. At BIA eight <b>Safedock FleX</b> units (A6–A9, B10–B12, B14) are run from <b>AiPRON Manager</b>. Tap each part of the stand.</p>
      <div class="panel"><svg viewBox="0 0 640 300" id="iStand" style="cursor:pointer">
        <rect width="640" height="300" fill="#3a3f47"/><rect width="70" height="300" fill="#50565f"/><text x="35" y="150" fill="#c9ced6" font-size="11" text-anchor="middle" transform="rotate(-90 35 150)">PIER 01</text>
        <line x1="70" y1="150" x2="640" y2="150" stroke="#f2b705" stroke-width="3"/>
        ${plane(250, 150, AC.B738, 6.2)}
        <g data-p="pbb"><rect x="70" y="58" width="190" height="20" fill="#8a929c"/><rect x="250" y="50" width="34" height="36" fill="#a7afb8"/><text x="160" y="50" fill="#e7eaf0" font-size="11" text-anchor="middle">Boarding bridge</text></g>
        <g data-p="scan"><rect x="72" y="140" width="22" height="20" fill="#e7eaf0"/><text x="100" y="178" fill="#e7eaf0" font-size="11">FleX</text></g>
        <g data-p="pd"><rect x="74" y="112" width="18" height="24" fill="#000" stroke="#ffb000"/><text x="100" y="128" fill="#ffb000" font-size="11">Display</text></g>
        <g data-p="op"><rect x="230" y="96" width="16" height="16" fill="#dfe3e8"/><circle cx="238" cy="104" r="4" fill="#dc2626"/><text x="252" y="108" fill="#e7eaf0" font-size="11">Operator panel</text></g>
        <g data-p="srv"><rect x="470" y="232" width="150" height="54" rx="6" fill="#0e2a33" stroke="#8fd0e0"/><text x="545" y="256" fill="#e8f1f3" font-size="12" text-anchor="middle">AiPRON Manager</text><text x="545" y="274" fill="#8fd0e0" font-size="10" text-anchor="middle">server room</text></g>
        <g data-p="fids"><rect x="300" y="232" width="150" height="54" rx="6" fill="#1d2430" stroke="#9aa3b2"/><text x="375" y="262" fill="#e8f1f3" font-size="12" text-anchor="middle">FIDS / AODB</text></g>
        <path d="M94 150 L640 -150 M94 150 L640 450" stroke="#ffb000" stroke-dasharray="5 5" opacity=".5"/>
      </svg></div>
      <div id="iInfo" class="say">Tap a part of the stand.</div>
    </div><div><h4>Docking states</h4><div class="chips" id="iFlow">${FLOW.map(([k, n]) => `<button class="btn s" data-f="${k}">${n}</button>`).join('')}</div><div class="row" style="align-items:flex-start;gap:12px"><div id="iPd" style="width:160px"></div><div id="iFt" class="m" style="flex:1;min-width:160px"></div></div></div></div>
      <h3>Check yourself</h3><div id="iQ"></div>`;
    const seen = new Set();
    el.querySelectorAll('#iStand [data-p]').forEach((g) => (g.onclick = () => { const p = PARTS.find((x) => x[0] === g.dataset.p); seen.add(p[0]); $('iInfo').innerHTML = `<b>${p[1]}</b><br>${p[2]}<div class="note">${seen.size} of ${PARTS.length} parts seen</div>`; }));
    const showF = (k) => { const f = FLOW.find((x) => x[0] === k); $('iPd').innerHTML = pd(f[3], 160); $('iFt').innerHTML = `<b>${f[1]}</b><br>${f[2]}`; el.querySelectorAll('#iFlow .btn').forEach((b) => b.classList.toggle('on', b.dataset.f === k)); };
    el.querySelectorAll('#iFlow .btn').forEach((b) => (b.onclick = () => showF(b.dataset.f))); showF('ready');
    quiz($('iQ'), [
      { q: 'Which ICAO document sets the requirements for an A-VDGS?', a: ['Annex 14 Volume I, §5.3.25–5.3.26', 'Annex 6, Part I', 'Doc 9137 Part 9', 'Annex 10 Volume III'], c: 0, why: 'The installation guide quotes ICAO Annex 14 Vol I, 8th edition, §5.3.25 VDGS and §5.3.26 A-VDGS.' },
      { q: 'What finds the aircraft and measures its distance to the stop?', a: ['The FleX laser scanner', 'The pilot display', 'The operator panel', 'AiPRON Manager'], c: 0, why: 'The scanner unit scans the stand in 3D; the display only shows the result.' },
      { q: 'In semi-automatic mode, what must happen before the Safedock docks the aircraft?', a: ['Ground staff confirm the flight on the operator panel or the HMI', 'Nothing – it docks every aircraft it sees', 'The pilot calls the tower', 'The PBB is moved out by hand'], c: 0, why: 'Semi-automatic: AiPRON schedules the flight, a person confirms it on the OP panel or the HMI, then the system docks.' },
      { q: 'At BIA, when does an arrival appear on the RIDS?', a: ['20 minutes before SEQT', '5 minutes before landing', 'At block-in', '40 minutes before ETD'], c: 0, why: 'Agreed trigger times: RIDS 20 min before SEQT, scheduling at ALDT.' },
      { q: 'What does the pilot display show while the boarding bridge is not parked?', a: ['WAIT – the docking is held', 'OK', 'The distance to go', 'Nothing – the unit switches off'], c: 0, why: 'The PBB dry contact blocks the docking: the display shows WAIT.' },
      { q: 'Which time does AiPRON send to FIDS when the aircraft is parked?', a: ['AIBT – actual in-block time', 'ETA', 'TOBT', 'SOBT'], c: 0, why: 'The A-VDGS detects in-block; AiPRON sends AIBT to FIDS, later AOBT at push-back.' },
      { q: 'If the AiPRON server or the network fails, what does the Safedock do?', a: ['Keeps working on its own (standalone)', 'Stops every docking', 'Shows TOO FAR', 'Reboots every minute'], c: 0, why: 'The SSDD requires standalone operation when AiPRON or the network is unavailable.' },
      { q: 'How often is a parked aircraft checked for presence (park-off detection)?', a: ['Every 60 seconds', 'Every 10 minutes', 'Only at push-back', 'Never'], c: 0, why: 'Park-off checks run every 60 s while the Safedock is Parked.' },
    ], done, { n: 6 });
  });

  // ===== Unit 1 lab: watch a docking and name what the display says
  item('intro', 'watch', '👀', 'Watch a docking', 'The simulation stops at each moment – say what the display is telling the pilot', 'lab', (el, done) => {
    const run = () => {
      const ev = pick(['normal', 'normal', 'slow', 'idfail', 'toofar', 'wait']), type = pick(['A320', 'B738', 'A332', 'B788', 'B77W']);
      const S = dock({ type, idOk: ev !== 'idfail', fast: ev === 'slow', overshoot: ev === 'toofar' ? 1.2 : 0, blocked: ev === 'wait', x0: 62 });
      if (ev === 'wait') setTimeout(() => (S.blocked = false), 4000);
      const stops = [];
      let asked = 0, score = 0, paused = false, endAsked = false;
      el.innerHTML = `<div class="tw"><div><div class="task">A ${AC[type].n} is coming on to stand A7. Watch the pilot display. At each pause choose what it is telling the pilot.</div><div id="wQ"></div><div id="wRes"></div></div><div><div id="wPd" style="max-width:220px;margin:auto"></div><div class="note" style="text-align:center" id="wX"></div></div></div>`;
      const opts = Object.keys(PHASE).filter((k) => k !== 'ready');
      const ask = (ph, last) => {
        paused = true; asked++;
        const o = shuffle([ph, ...shuffle(opts.filter((k) => k !== ph)).slice(0, 3)]);
        $('wQ').innerHTML = `<div class="q"><b>${last ? 'How did this docking end?' : 'What is the display telling the pilot now?'}</b>${o.map((k) => `<label><input type="radio" name="w" value="${k}"> ${PHASE[k]}</label>`).join('')}<button class="btn p s" id="wGo">Answer and continue</button><div class="why"></div></div>`;
        $('wGo').onclick = () => { const v = el.querySelector('input[name=w]:checked'); if (!v) return; const ok = v.value === ph; if (ok) score++; el.querySelector('.q .why').innerHTML = ok ? '<span class="okc">✓ Right</span>' : `<span class="noc">✗ It was: ${PHASE[ph]}</span>`; $('wGo').disabled = true; setTimeout(() => { paused = false; if (last) finish(); }, 900); };
      };
      const finish = () => { done(score, asked); result($('wRes'), score, asked, null, run); };
      const pts = [['active', (s) => s.t > 2], ['lead', (s) => s.x < 35], ['closing', (s) => s.phase === 'closing' && s.x < 9 && !s.msg]];
      loop((dt) => {
        if (paused || endAsked) return; S.step(Math.min(dt, 0.1) * 2.2);
        $('wPd').innerHTML = pd(S.view(), 220); $('wX').textContent = `${S.x.toFixed(1)} m to the stop · ${S.v.toFixed(1)} m/s`;
        if (S.phase === 'wait' && !stops.includes('wait')) { stops.push('wait'); return ask('wait'); }
        if (S.msg === 'SLOW' && !stops.includes('slow')) { stops.push('slow'); return ask('slow'); }
        for (const [ph, f] of pts) if (!stops.includes(ph) && S.phase === ph && f(S)) { stops.push(ph); return ask(ph); }
        if (['ok', 'toofar', 'idfail'].includes(S.phase) && S.t - (S.stoppedAt ?? S.t) >= 0) { endAsked = true; setTimeout(() => ask(S.phase, true), 600); }
      });
    };
    run();
  });

  // ===== Unit 2 lab: stop positions from the layout drawing
  const CHAIN = (gs) => { const ds = gs.map((g) => [g, stopOf(g)]).sort((a, b) => a[1] - b[1]); return ds.map((d, i) => [d[0], d[1], i ? +(d[1] - ds[i - 1][1]).toFixed(2) : d[1]]); };
  item('stand', 'plan', '📐', 'Stand planner – stop positions', 'Read the dimension chain of drawing L-001, set the unit on the centreline, enter each stop', 'lab', (el, done) => {
    const run = () => {
      const st = pick(Object.keys(STANDS)), S = STANDS[st], ch = CHAIN(S.groups), k = 11;
      const off0 = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random()), az0 = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.round(Math.random() * 4));
      el.innerHTML = `<div class="task"><b>Stand ${st}</b> takes ${S.groups.length} aircraft groups. The drawing gives the stop positions as a <b>dimension chain</b>: the first dimension from the FleX to the nearest stop, then the gap to each next stop. Work out each stop's distance from the unit, enter it, then put the unit on the centreline and aim it straight down the stand.</div>
        <div class="tw"><div class="panel scroll"><svg viewBox="0 0 760 340" id="pSv"></svg></div><div>
          <div class="card" style="padding:10px"><b>Drawing ADE-ED1970-VCBI-DD-L-001 · ${st}</b><table class="spec" style="margin-top:6px"><tr><th>Dimension</th><th>Value m</th><th>To stop of</th></tr>${ch.map(([g, , d], i) => `<tr><td>${i ? `+ gap ${i}` : 'FleX → first stop'}</td><td>${d.toFixed(2)}</td><td>${g}</td></tr>`).join('')}</table></div>
          <div class="ctl">${ch.map(([g]) => `<div><label>${g} stop – m from the FleX</label><input type="number" step="0.01" id="pS_${g.replace(/\W/g, '')}" placeholder="e.g. 27.50"></div>`).join('')}
            <div><label>Unit offset from centreline <b id="pOffV"></b></label><input type="range" id="pOff" min="-2" max="2" step="0.05" value="${off0.toFixed(2)}"></div>
            <div><label>Scanner aim (azimuth) <b id="pAzV"></b></label><input type="range" id="pAz" min="-8" max="8" step="0.5" value="${az0}"></div></div>
          <div class="row" style="margin-top:8px"><button class="btn p" id="pChk">Check the layout</button></div><div id="pRes"></div></div></div>`;
      const draw = () => {
        const off = +$('pOff').value, az = +$('pAz').value; $('pOffV').textContent = `${off.toFixed(2)} m`; $('pAzV').textContent = `${az > 0 ? '+' : ''}${az}°`;
        const X = (d) => 40 + d * k, y0 = 170, uy = y0 + off * k, a1 = ((az - 30) * Math.PI) / 180, a2 = ((az + 30) * Math.PI) / 180;
        let s = `<rect width="760" height="340" fill="#3a3f47"/><rect width="34" height="340" fill="#50565f"/><line x1="34" y1="${y0}" x2="760" y2="${y0}" stroke="#f2b705" stroke-width="3"/>`;
        s += `<path d="M40 ${uy} L ${40 + 700 * Math.cos(a1)} ${uy + 700 * Math.sin(a1)} L ${40 + 700 * Math.cos(a2)} ${uy + 700 * Math.sin(a2)} Z" fill="rgba(255,176,0,.10)" stroke="rgba(255,176,0,.6)" stroke-dasharray="5 5"/>`;
        s += `<rect x="34" y="${uy - 7}" width="12" height="14" fill="#e7eaf0"/><text x="50" y="${uy - 10}" fill="#e7eaf0" font-size="11">FleX</text>`;
        ch.forEach(([g, d], i) => { const v = parseFloat(($(`pS_${g.replace(/\W/g, '')}`) || {}).value); if (Number.isFinite(v)) s += `<circle cx="${X(v)}" cy="${y0}" r="6" fill="#f2b705"/><text x="${X(v)}" y="${y0 + (i % 2 ? -14 : 24)}" fill="#e7eaf0" font-size="10" text-anchor="middle">${g}</text>`; });
        const big = ch[0]; s += plane(X(big[1]), y0, AC[Object.keys(AC).find((a) => AC[a].g === big[0])], k * 0.85, 'rgba(201,206,214,.6)');
        for (let m = 0; m <= 60; m += 10) s += `<line x1="${X(m)}" y1="330" x2="${X(m)}" y2="336" stroke="#c9ced6"/><text x="${X(m)}" y="326" fill="#c9ced6" font-size="9" text-anchor="middle">${m} m</text>`;
        $('pSv').innerHTML = s;
      };
      el.querySelectorAll('input').forEach((i) => i.addEventListener('input', draw)); draw();
      $('pChk').onclick = () => {
        const off = +$('pOff').value, az = +$('pAz').value, rows = [];
        rows.push([Math.abs(off) <= 0.05, `Unit on the centreline (offset ${off.toFixed(2)} m – the guide says centre it over the stand centreline)`]);
        rows.push([Math.abs(az) < 0.5, `Scanner aimed down the centreline (${az}°)`]);
        ch.forEach(([g, d]) => { const v = parseFloat($(`pS_${g.replace(/\W/g, '')}`).value); rows.push([Number.isFinite(v) && Math.abs(v - d) <= 0.02, `${g}: ${Number.isFinite(v) ? v.toFixed(2) : '—'} m${Math.abs(v - d) <= 0.02 ? '' : ` (add the gaps along the chain: ${d.toFixed(2)} m)`}`]); });
        const sc = rows.filter((r) => r[0]).length; done(sc, rows.length); result($('pRes'), sc, rows.length, rows, run);
      };
    };
    run();
  });

  // ===== Unit 2 lab: mounting height from the side view
  item('stand', 'side', '📏', 'Side view – mounting height', 'Find a height that every pilot on the stand can see, above the bridge keep-out', 'lab', (el, done) => {
    const UP = 10; // course design rule: pilot looks up at most 10° from eye level to the display centre at the stop
    const run = () => {
      const st = pick(Object.keys(STANDS)), S = STANDS[st], keep = +(4 + Math.round(Math.random() * 8) / 10).toFixed(1);
      const types = Object.keys(AC).filter((a) => S.groups.includes(AC[a].g));
      el.innerHTML = `<div class="task"><b>Stand ${st}.</b> The bridge cab and the vehicles below the unit need a keep-out up to <b>${keep} m</b>. Set the height of the bottom edge of the FleX so that: it is between <b>4 and 8 m</b> (installation guide), above the keep-out, and every pilot on this stand looks up no more than <b>${UP}°</b> to the display centre at their stop.</div>
        <div class="tw"><div class="panel scroll"><svg viewBox="0 0 760 320" id="hSv" style="overflow:hidden"></svg></div><div>
          <div class="ctl"><div><label>Bottom edge of the unit <b id="hHV"></b></label><input type="range" id="hH" min="2" max="10" step="0.1" value="${(2.5 + Math.random()).toFixed(1)}"></div><div><label>Show aircraft</label><select id="hT">${types.map((t) => `<option value="${t}">${AC[t].n}</option>`).join('')}</select></div></div>
          <div class="tablewrap"><table class="spec" style="margin-top:8px" id="hTab"></table></div>
          <div class="note">The display centre is about 1.32 m above the bottom edge (scanner 600 mm rails, 220 mm gap, display 845 mm rails). Eye heights are approximate training values.</div>
          <div class="row" style="margin-top:8px"><button class="btn p" id="hChk">Check the height</button></div><div id="hRes"></div></div></div>`;
      const ang = (H, t) => (Math.atan2(H + 1.32 - AC[t].eye, stopOf(AC[t].g)) * 180) / Math.PI;
      const draw = () => {
        const H = +$('hH').value, t = $('hT').value, a = AC[t], d = stopOf(a.g), k = 22, X = (m) => 50 + m * 9, Y = (m) => 300 - m * k;
        $('hHV').textContent = `${H.toFixed(1)} m`;
        let s = `<rect width="760" height="320" fill="#fff"/><line x1="0" y1="${Y(0)}" x2="760" y2="${Y(0)}" stroke="#5f6673"/>`;
        s += `<rect x="${X(0.2)}" y="${Y(keep)}" width="${X(6) - X(0.2)}" height="${Y(0) - Y(keep)}" fill="rgba(234,88,12,.15)" stroke="#ea580c" stroke-dasharray="4 3"/><text x="${X(0.4)}" y="${Y(keep) + 14}" font-size="10" fill="#c2410c">keep-out ${keep} m</text>`;
        s += `<rect x="${X(0) - 4}" y="${Y(H + 2.2)}" width="8" height="${Y(0) - Y(H + 2.2)}" fill="#9aa3ad"/><path d="M${X(0) + 4} ${Y(H + 0.6)} h26 l-6 ${0.6 * k} h-20 z" fill="#dfe3e8" stroke="#8a929c"/><rect x="${X(0) + 4}" y="${Y(H + 1.75)}" width="26" height="${0.9 * k}" fill="#111"/>`;
        const ey = Y(a.eye), ex = X(d) + 4; s += `<line x1="${ex}" y1="${ey}" x2="${X(0) + 17}" y2="${Y(H + 1.32)}" stroke="${ang(H, t) <= UP ? '#15803d' : '#dc2626'}" stroke-width="2" stroke-dasharray="6 4"/><line x1="${ex}" y1="${ey}" x2="${X(0) + 17}" y2="${ey}" stroke="#9aa3b2" stroke-dasharray="2 3"/>`;
        s += `<path d="M${ex} ${ey + 4} q 10 -8 40 -6 l ${a.len * 9 - 40} 2 v ${Y(0.6) - ey - 4} h -${a.len * 9} z" fill="#eef0f4" stroke="#5f6673"/><circle cx="${ex + 6}" cy="${ey}" r="3" fill="#2a6fdb"/>`;
        s += `<text x="${ex + 10}" y="${ey - 8}" font-size="11" fill="#14161c">${a.n} · eye ${a.eye} m · stop ${d} m · ${ang(H, t).toFixed(1)}° up</text>`;
        s += `<text x="${X(0) + 36}" y="${Y(H) + 4}" font-size="11" fill="#14161c">${H.toFixed(1)} m</text>`;
        $('hSv').innerHTML = s;
        $('hTab').innerHTML = `<tr><th>Aircraft</th><th>Stop m</th><th>Look up</th></tr>${types.map((x) => { const v = ang(H, x); return `<tr><td>${AC[x].n}</td><td>${stopOf(AC[x].g)}</td><td class="${v <= UP ? 'okc' : 'noc'}">${v.toFixed(1)}°</td></tr>`; }).join('')}`;
      };
      el.querySelectorAll('input,select').forEach((i) => i.addEventListener('input', draw)); draw();
      $('hChk').onclick = () => {
        const H = +$('hH').value, rows = [[H >= 4 && H <= 8, `Bottom edge between 4 and 8 m (${H.toFixed(1)} m)`], [H >= keep, `Above the keep-out of ${keep} m`]];
        types.forEach((t) => rows.push([ang(H, t) <= UP, `${AC[t].n}: ${ang(H, t).toFixed(1)}° up to the display`]));
        const sc = rows.filter((r) => r[0]).length; done(sc, rows.length); result($('hRes'), sc, rows.length, rows, run);
      };
    };
    run();
  });
})();
