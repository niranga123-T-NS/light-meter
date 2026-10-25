// VDGS course core: the BIA project data (stands, fleet groups, stop distances, trigger times), the FleX pilot display, a docking model and the quiz / result helpers.
// Stop distances, stands, timings and installation values are from the BIA drawings and documents; aircraft eye heights are approximate training values.
const VD = (() => {
  const AC = {
    A320: { n: 'A320-200', g: 'A320/B737', eye: 2.6, len: 37.6, span: 35.8 },
    B738: { n: 'B737-800', g: 'A320/B737', eye: 2.6, len: 39.5, span: 35.8 },
    B739: { n: 'B737-900', g: 'A320/B737', eye: 2.6, len: 42.1, span: 35.8 },
    A310: { n: 'A310-300', g: 'A310/MD11', eye: 4.3, len: 46.7, span: 43.9 },
    MD11: { n: 'MD-11', g: 'A310/MD11', eye: 5.0, len: 61.2, span: 51.7 },
    A306: { n: 'A300-600R', g: 'A300/B767/A330/A340', eye: 4.4, len: 54.1, span: 44.8 },
    B762: { n: 'B767-200', g: 'A300/B767/A330/A340', eye: 4.5, len: 48.5, span: 47.6 },
    A332: { n: 'A330-200', g: 'A300/B767/A330/A340', eye: 4.6, len: 58.8, span: 60.3 },
    A343: { n: 'A340-300', g: 'A300/B767/A330/A340', eye: 4.6, len: 63.7, span: 60.3 },
    B788: { n: 'B787-8', g: 'B787-8', eye: 4.9, len: 56.7, span: 60.1 },
    B77W: { n: 'B777-300ER', g: 'B747/B777', eye: 5.4, len: 73.9, span: 64.8 },
    B744: { n: 'B747-400', g: 'B747/B777', eye: 8.4, len: 70.7, span: 64.4 },
    A359: { n: 'A350-900', g: 'A350', eye: 5.0, len: 66.8, span: 64.8 },
  };
  // distance from the FleX to each stop position (m) – drawing ADE-ED1970-VCBI-DD-L-001
  const GROUPS = [['A320/B737', 30.74], ['A310/MD11', 28.74], ['A300/B767/A330/A340', 28.44], ['B787-8', 26.19], ['B747/B777', 25.64], ['A350', 24.94]];
  const ALLG = GROUPS.map((g) => g[0]);
  const STANDS = {
    A6: { apron: 'A', groups: ALLG }, A7: { apron: 'A', groups: ALLG.slice(0, 5) }, A8: { apron: 'A', groups: ALLG.slice(0, 5) }, A9: { apron: 'A', groups: ALLG.slice(0, 3) },
    B10: { apron: 'B', groups: ALLG }, B11: { apron: 'B', groups: ['A320/B737', 'A310/MD11', 'A300/B767/A330/A340', 'B747/B777'] }, B12: { apron: 'B', groups: ALLG.slice(0, 4) }, B14: { apron: 'B', groups: ALLG.slice(0, 3) },
  };
  const stopOf = (g) => (GROUPS.find((x) => x[0] === g) || [0, 30])[1];
  // AiPRON Manager trigger times agreed for BIA (minutes)
  const TIMES = { ridsArr: 20, skipArr: 45, noShow: 45, ridsDep: 40, schedDep: 40, skipDep: 60, noLeave: 90, parkOffSec: 60 };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const r1 = (v) => Math.round(v * 10) / 10;

  // ---- the FleX pilot display (PDFleX): type, distance, the T stop bar, centreline with the aircraft symbol, red steering arrow, or a big text
  const COL = { a: '#ffb000', g: '#36e06a', r: '#ff3b30', w: '#f4f4f4' };
  function pd(o = {}, w = 200) {
    const t = (x, y, s, c, txt, extra = '') => `<text x="${x}" y="${y}" font-size="${s}" fill="${COL[c] || c}" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-weight="700" ${extra}>${esc(txt)}</text>`;
    let b = `<rect x="2" y="2" width="196" height="296" rx="10" fill="#060606" stroke="#3a3a3a" stroke-width="3"/>`;
    if (o.l1) b += t(100, 42, o.s1 || 30, o.c1 || 'g', o.l1);
    if (o.l2) b += t(100, 80, o.s2 || 28, o.c2 || 'a', o.l2);
    if (o.guide) {
      const { dist, lat = 0, arrow } = o.guide, cl = Math.max(0, Math.min(1, dist / 15));
      b += `<rect x="60" y="104" width="80" height="7" fill="${COL.a}"/>`;
      const y2 = 111 + 170 * cl; b += `<rect x="97" y="111" width="6" height="${Math.max(0, y2 - 111)}" fill="${COL.a}"/>`;
      if (dist > 15) b += `<rect x="97" y="111" width="6" height="170" fill="${COL.a}" opacity=".35"/>`;
      const ax = 100 + Math.max(-3, Math.min(3, lat)) * 14, ay = Math.min(270, y2 + 6);
      b += `<path transform="translate(${ax} ${ay})" d="M0 -14 L3 -6 L18 2 L18 6 L3 3 L2 12 L7 16 L7 18 L0 16 L-7 18 L-7 16 L-2 12 L-3 3 L-18 6 L-18 2 L-3 -6 Z" fill="${COL.a}"/>`;
      if (arrow) b += `<path class="blink" d="${arrow === 'r' ? 'M150 190 L178 205 L150 220 Z' : 'M50 190 L22 205 L50 220 Z'}" fill="${COL.r}"/>`;
    }
    if (o.big) { const lines = [].concat(o.big); lines.forEach((ln, i) => { b += t(100, (o.l1 ? 170 : 140) + i * 52 - (lines.length - 1) * 20, o.bs || 46, o.bc || 'r', ln, o.blink ? 'class="blink"' : ''); }); }
    if (o.rows) o.rows.forEach((ln, i) => { b += t(100, 40 + i * 34, 22, ln[1] || 'a', ln[0]); });
    if (o.float) for (let i = 0; i < 3; i++) b += `<path d="M100 ${200 + i * 26 - (o.float % 26)} l-16 14 h32 z" fill="${COL.a}" opacity="${0.4 + i * 0.2}"/>`;
    return `<svg viewBox="0 0 200 300" width="${w}" style="max-width:100%;height:auto;display:block" role="img" aria-label="Pilot display">${b}</svg>`;
  }

  // ---- docking model: x = metres to the stop (positive before it), lat = metres off the centreline, v = closing speed m/s
  function dock(o) {
    const s = { type: o.type, x: o.x0 ?? 60, lat: o.lat0 ?? (Math.random() * 2 - 1) * 1.5, v: 1.6, phase: o.phase || 'active', idOk: o.idOk !== false, slowNeeded: !!o.fast, t: 0, msg: '', blocked: !!o.blocked, estop: false, stoppedAt: null, overshoot: o.overshoot || 0 };
    s.step = (dt) => {
      s.t += dt;
      if (s.phase === 'ok' || s.phase === 'toofar' || s.phase === 'idfail' || s.phase === 'estop') return s;
      if (s.estop) { s.phase = 'estop'; s.v = 0; return s; }
      if (s.phase === 'stop') { s.v = 0; if (s.t - s.stoppedAt > 1.5) s.phase = 'ok'; return s; }
      if (s.blocked) { s.phase = 'wait'; return s; } // PBB not parked: the system waits, the aircraft holds
      if (s.phase === 'wait') s.phase = 'active';
      if (s.phase === 'active' && s.x <= 50) s.phase = 'lead';
      if (s.phase === 'lead' && s.x <= 12) { if (!s.idOk) { s.phase = 'idfail'; s.v = 0; return s; } s.phase = 'closing'; }
      // the pilot follows the display: steer back to the line, slow down near the stop (or too fast when the case says so)
      const target = s.slowNeeded && s.x > 5 ? 2.6 : s.x > 20 ? 1.6 : Math.max(0.25, s.x / 12);
      s.v += (target - s.v) * Math.min(1, dt * 0.8);
      if (s.phase === 'closing' && s.v > 1.8 && s.x < 20) s.msg = 'SLOW'; else s.msg = '';
      s.lat += -s.lat * Math.min(1, dt * 0.25) + (Math.random() - 0.5) * 0.02;
      s.x -= s.v * dt;
      if (s.x <= 0.15 + (s.overshoot ? -1 - s.overshoot : 0)) { s.v = 0; s.phase = s.x < -0.5 ? 'toofar' : 'stop'; s.stoppedAt = s.t; }
      if (s.phase === 'stop' && s.t - s.stoppedAt > 1.5) s.phase = 'ok';
      return s;
    };
    s.view = () => {
      const T = s.type || '';
      switch (s.phase) {
        case 'ready': return { rows: [[o.stand || '', 'a'], [o.clock || '', 'a']] };
        case 'active': return { l1: T, float: Math.round(s.t * 20) };
        case 'wait': return { l1: T, big: 'WAIT', bc: 'a' };
        case 'lead': return { l1: T, guide: { dist: s.x, lat: s.lat, arrow: Math.abs(s.lat) > 0.3 ? (s.lat > 0 ? 'l' : 'r') : null } };
        case 'slow': case 'closing': return s.msg ? { l1: T, big: 'SLOW', blink: true } : { l1: T, l2: s.x < 20 ? `${s.x.toFixed(1)}m` : '', guide: { dist: s.x, lat: s.lat, arrow: Math.abs(s.lat) > 0.3 ? (s.lat > 0 ? 'l' : 'r') : null } };
        case 'stop': return { l1: T, big: 'STOP' };
        case 'ok': return { l1: T, big: 'OK', bc: 'g' };
        case 'toofar': return { l1: T, big: ['TOO', 'FAR'] };
        case 'idfail': return { l1: 'ID FAIL', c1: 'r', big: 'STOP' };
        case 'estop': return { big: ['STOP'], blink: true };
        default: return {};
      }
    };
    return s;
  }
  const PHASE = { ready: 'Ready', active: 'Active – waiting for the aircraft', wait: 'Wait – blocked', lead: 'Captured – lead-in', closing: 'Closing – distance shown', slow: 'SLOW – closing too fast', stop: 'Stop', ok: 'Parked – OK', toofar: 'Too far', idfail: 'ID fail – stop', estop: 'Emergency stop' };

  // ---- quiz: all questions on one page, then Check
  function quiz(el, qs, done, opt = {}) {
    const Q = (opt.keep ? qs : shuffle(qs).slice(0, opt.n || qs.length)).map((q) => { const o = shuffle(q.a.map((a, j) => [a, j])); return { ...q, a: o.map((x) => x[0]), c: o.findIndex((x) => x[1] === q.c) }; });
    el.innerHTML = `${opt.intro || ''}${Q.map((q, i) => `<div class="q" id="q${i}"><b>${i + 1}. ${esc(q.q)}</b>${q.a.map((a, j) => `<label><input type="radio" name="q${i}" value="${j}"> <span>${esc(a)}</span></label>`).join('')}<div class="why hidden"></div></div>`).join('')}<div class="row"><button class="btn p" id="qChk">Check my answers</button><span id="qRes"></span></div>`;
    el.querySelector('#qChk').onclick = () => {
      let sc = 0;
      Q.forEach((q, i) => { const v = el.querySelector(`input[name=q${i}]:checked`), ok = v && +v.value === q.c; if (ok) sc++; const w = el.querySelector(`#q${i} .why`); w.classList.remove('hidden'); w.innerHTML = `<span class="${ok ? 'okc' : 'noc'}">${ok ? '✓ Correct.' : `✗ Answer: ${esc(q.a[q.c])}.`}</span> ${esc(q.why || '')}`; });
      const pass = sc * 3 >= Q.length * 2;
      el.querySelector('#qRes').innerHTML = `<b class="${pass ? 'okc' : 'noc'}">${sc} / ${Q.length}${pass ? ' – passed' : ' – 2 of 3 needed, read the notes and try again'}</b>`;
      el.querySelector('#qChk').textContent = 'Check again'; done(sc, Q.length);
    };
  }
  const checks = (rows) => `<div class="chk">${rows.map(([ok, t]) => `<div class="${ok ? 'y' : 'n'}">${ok ? '✓' : '✗'} ${t}</div>`).join('')}</div>`;
  // the result of a lab: score, the checks and a retry
  function result(box, score, total, rows, retry) {
    const pass = score * 3 >= total * 2;
    box.innerHTML = `<div class="${pass ? 'say' : 'watch'}"><b>${pass ? 'Passed' : 'Not yet'} – ${score} / ${total}</b>${rows ? checks(rows) : ''}${retry ? '<button class="btn s" data-retry>Try again</button>' : ''}</div>`;
    if (retry) box.querySelector('[data-retry]').onclick = retry;
    box.scrollIntoView({ block: 'nearest' });
  }
  // a timer that stops when the learner leaves the page
  function loop(fn, ms = 50) { let last = performance.now(); const id = setInterval(() => { const n = performance.now(); fn((n - last) / 1000); last = n; }, ms); onStop(() => clearInterval(id)); return () => clearInterval(id); }
  const clock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  return { AC, GROUPS, STANDS, TIMES, stopOf, pick, shuffle, r1, pd, dock, PHASE, quiz, checks, result, loop, clock };
})();
