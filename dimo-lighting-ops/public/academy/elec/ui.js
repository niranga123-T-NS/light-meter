/* Troubleshooting session screen: job ticket, operator controls, site view, live schematic, instrument panel with live / dead tests,
   safe isolation (lock off, prove dead), results log, hints, diagnosis and scoring – and the guided demo that walks through the same screen */
var EFUI = (function () {
  const { esc } = EF;
  const NORMAL = { vln: 'about 230 V (216–253 V)', vle: 'about 230 V', vne: 'below 2 V', clamp: 'the load current', leak: 'below 30 % of IΔn (under 9 mA for 30 mA)', zs: 'below the limit for the device (e.g. B16 ≤ 2.19 Ω cold)', r12: 'a few tenths of an ohm', rn: 'about the same as R1', ir: 'at least 1 MΩ – a new circuit reads hundreds of MΩ', rcdt: 'trips within 300 ms', heat: 'close to the room temperature', coilv: 'rated coil voltage when commanded', coilr: 'a few hundred ohms', busv: '28–30 V DC (at least 21 V)', dbus: 'about 16 V DC', v110: '1–10 V DC following the dimmer', vout: '24 V DC', vend: 'within 5 % of 24 V' };
  let st, R, S, box, mode, sel = null, last = null, demo = null, step = 0, onDone, showNorm = true, done = false;

  function start(el, scen, opts) {
    S = scen; box = el; mode = opts.mode; onDone = opts.onDone; showNorm = true; done = false; sel = null; last = null;
    if (mode === 'demo') { demo = S.demo; step = 0; st = EF.newState(S, demo.faults.map((id) => S.pool.find((f) => f.id === id)), demo.in); }
    else { demo = null; const n = Math.max(1, Math.min(S.maxFaults || 3, 1 + Math.floor(Math.random() * (S.maxFaults || 3)))); st = EF.newState(S, EF.pickFaults(S, n), {}); }
    R = EF.evaluate(st);
    st.ticket = [...new Set(EF.symptoms(st, R).concat(st.faults.filter((f) => f.say).map((f) => f.say)))];
    draw();
  }

  // ---------------------------------------------------------------- the screen
  function draw() {
    box.innerHTML = `<div class="ticket"><div class="row" style="justify-content:space-between"><b>🧾 Job ticket – ${esc(S.title)}</b><span class="pill">${mode === 'demo' ? 'Guided demo' : `${st.faults.length > 1 ? 'one or more faults' : 'one or more faults'} hidden`}</span></div><div style="margin-top:4px">${esc(S.brief || '')}</div><ul style="margin:6px 0 0;padding-left:18px">${(st.ticket.length ? st.ticket : ['No complaint – periodic inspection and test after an alteration by another contractor']).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      ${mode === 'demo' ? '<div id="efDemo" class="demo"></div>' : ''}
      <div class="ctlbar" id="efIn"></div>
      <div class="sec">Site – tap a light, socket or board</div><div class="panel" id="efSite" style="max-width:860px"></div>
      <div class="sec">Schematic – tap any part to test it</div><div class="panel scroll" id="efSch"></div>
      <div class="two" style="margin-top:12px"><div><div class="sec" id="efSelH">Select a part</div><div id="efTools" class="card" style="padding:12px"></div></div><div><div class="sec">Meter</div><div class="meter" id="efMeter"><div class="mm">— — —</div><div class="ms">Choose a part and a test</div></div><div class="sec">Results log</div><div class="tablewrap" style="max-height:260px;overflow:auto"><table class="spec" id="efLog"></table></div></div></div>
      <div class="card" style="margin-top:12px" id="efDiag"></div>`;
    drawInputs(); drawSite(); drawSch(); drawTools(); drawLog(); drawDiag(); if (mode === 'demo') drawDemo();
  }
  function refresh() { R = EF.evaluate(st); drawInputs(); drawSite(); drawSch(); drawTools(); drawLog(); if (mode === 'demo') drawDemo(); }

  function drawInputs() {
    const el = $('efIn'); if (!el) return;
    el.innerHTML = '<b style="margin-right:6px">Operate:</b>' + (S.inputs || []).map((i) => {
      if (i.type === 'btn') return `<span class="btn s" data-btn="${i.k}">${esc(i.label)}</span>`;
      if (i.type === 'select') return `<label class="inl">${esc(i.label)} <select data-in="${i.k}">${i.opts.map(([v, t]) => `<option value="${v}"${String(st.in[i.k]) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
      if (i.type === 'range') return `<label class="inl">${esc(i.label)} <b>${i.fmt ? i.fmt(st.in[i.k]) : st.in[i.k]}</b> <input type="range" data-in="${i.k}" min="${i.min}" max="${i.max}" step="${i.step || 1}" value="${st.in[i.k]}"></label>`;
      return `<span class="btn s ${st.in[i.k] ? 'on' : ''}" data-tg="${i.k}">${st.in[i.k] ? '✓ ' : ''}${esc(i.label)}</span>`;
    }).join('');
    el.querySelectorAll('[data-tg]').forEach((b) => (b.onclick = () => { st.in[b.dataset.tg] = !st.in[b.dataset.tg]; act('input:' + b.dataset.tg); }));
    el.querySelectorAll('[data-in]').forEach((s) => (s.oninput = () => { const i = S.inputs.find((x) => x.k === s.dataset.in); st.in[i.k] = i.type === 'range' ? +s.value : isNaN(+s.value) ? s.value : +s.value; act('input:' + i.k); }));
    el.querySelectorAll('[data-btn]').forEach((b) => (b.onclick = () => { const i = S.inputs.find((x) => x.k === b.dataset.btn); i.act(st, R, EF.F, msg); act('input:' + i.k); }));
  }
  const msg = (t) => { last = { t: '', r: t, n: '' }; showMeter(); };

  // site view: the plan with the loads glowing as they behave
  function drawSite() {
    const el = $('efSite'); if (!el) return;
    if (!S.site) { el.innerHTML = '<div class="m" style="padding:12px">No site plan – use the schematic.</div>'; return; }
    const W = S.site.w || 700, H = S.site.h || 360;
    let s = `<svg viewBox="0 0 ${W} ${H}" style="background:#0f1a33">${S.site.bg || ''}`;
    Object.entries(S.site.at).forEach(([id, [x, y, lbl]]) => {
      const e = S._.els[id], L = R.loads[id];
      if (!e) return;
      const on = L && L.on, col = (L && L.col) || (e.kind === 'emerg' ? '#bbf7d0' : '#fde68a'), dng = R.danger[id], selC = sel === id;
      if (EF.isLoad(e)) {
        if (on) s += `<circle cx="${x}" cy="${y}" r="${18 + 16 * (L.lvl || 1)}" fill="${col}" opacity="${0.18 + 0.3 * (L.lvl || 1)}" ${L.flick ? 'class="blink"' : ''}/>`;
        s += icon(e, x, y, on, col, L);
      } else s += `<rect x="${x - 16}" y="${y - 12}" width="32" height="24" rx="4" fill="${st.tripped.has(id) ? '#dc2626' : '#334155'}" stroke="#cbd5e1"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" fill="#fff">${esc(e.short || e.kind.toUpperCase().slice(0, 4))}</text>`;
      if (dng) s += `<text x="${x + 14}" y="${y - 12}" font-size="16">⚡</text>`;
      if (R.hot[id]) s += `<text x="${x - 26}" y="${y - 12}" font-size="14">🔥</text>`;
      s += `<rect x="${x - 22}" y="${y - 22}" width="44" height="44" fill="transparent" stroke="${selC ? '#B0D035' : 'none'}" stroke-width="3" rx="8" data-id="${id}" style="cursor:pointer"/>`;
      if (lbl) s += `<text x="${x}" y="${y + 34}" text-anchor="middle" font-size="10" fill="#cbd5e1" pointer-events="none">${esc(lbl)}</text>`;
    });
    el.innerHTML = s + '</svg>';
    el.querySelectorAll('[data-id]').forEach((n) => (n.onclick = () => select(n.dataset.id)));
  }
  function icon(e, x, y, on, col, L) {
    const k = e.kind;
    if (k === 'socket' || k === 'heater' || k === 'fan') return `<rect x="${x - 12}" y="${y - 10}" width="24" height="20" rx="4" fill="${on ? '#fef9c3' : '#475569'}" stroke="#cbd5e1"/><circle cx="${x - 5}" cy="${y}" r="2" fill="#111"/><circle cx="${x + 5}" cy="${y}" r="2" fill="#111"/>`;
    if (k === 'motor') return `<circle cx="${x}" cy="${y}" r="13" fill="${on ? '#86efac' : L && L.single ? '#f97316' : '#475569'}" stroke="#cbd5e1"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="700">M</text>`;
    if (k === 'emerg') return `<rect x="${x - 13}" y="${y - 8}" width="26" height="16" rx="3" fill="${on ? '#16a34a' : '#475569'}" stroke="#cbd5e1"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" fill="#fff">EXIT</text>`;
    if (k === 'profile') return `<rect x="${x - 26}" y="${y - 4}" width="52" height="8" rx="3" fill="${on ? col : '#475569'}" stroke="#cbd5e1" ${on && L.flick ? 'class="blink"' : ''}/>`;
    return `<circle cx="${x}" cy="${y}" r="11" fill="${on ? col : '#475569'}" stroke="#cbd5e1" ${on && L.flick ? 'class="blink"' : ''}/><path d="M${x - 7} ${y - 7}L${x + 7} ${y + 7}M${x + 7} ${y - 7}L${x - 7} ${y + 7}" stroke="#1e293b" stroke-width="1.5"/>`;
  }

  // schematic: tree layout, one column per leaf
  function drawSch() {
    const el = $('efSch'); if (!el) return;
    const { els, kids, order } = S._, pos = {}, X = 100, Y = 80;
    let leaf = 0;
    const place = (id, d) => { const k = kids[id]; if (!k.length) { pos[id] = [leaf++ * X + 46, d * Y + 40]; return; } k.forEach((c) => place(c, d + 1)); const xs = k.map((c) => pos[c][0]); pos[id] = [(Math.min(...xs) + Math.max(...xs)) / 2, d * Y + 40]; };
    place(order[0], 0);
    const W = Math.max(500, leaf * X + 40), H = Math.max(...Object.values(pos).map((p) => p[1])) + 70;
    let s = `<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.min(W, 1400)}px;background:#fff">`;
    order.forEach((id) => { const e = els[id]; if (!e.parent) return; const [x1, y1] = pos[e.parent], [x2, y2] = pos[id], live = R.live[id] && !EF.isCtl(e);
      s += `<path d="M${x1} ${y1 + 18} L${x1} ${(y1 + y2) / 2} L${x2} ${(y1 + y2) / 2} L${x2} ${y2 - 18}" fill="none" stroke="${EF.isCtl(e) ? '#94a3b8' : live ? '#a16207' : '#cbd5e1'}" stroke-width="${live ? 2.5 : 1.5}" ${EF.isCtl(e) ? 'stroke-dasharray="4 3"' : ''}/>`; });
    order.forEach((id) => { const e = els[id]; if (e.kind === 'contactor' && e.coil && pos[e.coil]) { const [a, b] = pos[e.coil], [c, d] = pos[id]; s += `<path d="M${a} ${b} L${c + 20} ${d}" stroke="#7c3aed" stroke-dasharray="3 4" fill="none"/>`; } });
    order.forEach((id) => { const [x, y] = pos[id]; s += sym(els[id], x, y) + `<text x="${x}" y="${y + 31}" text-anchor="middle" font-size="9" fill="#334155">${esc((els[id].short || els[id].name || id).slice(0, 20))}</text><rect x="${x - 30}" y="${y - 24}" width="60" height="60" fill="transparent" stroke="${sel === id ? '#244286' : 'none'}" stroke-width="2.5" rx="8" data-id="${id}" style="cursor:pointer"><title>${esc(els[id].name || id)}</title></rect>`; });
    el.innerHTML = s + '</svg>';
    el.querySelectorAll('[data-id]').forEach((n) => (n.onclick = () => select(n.dataset.id)));
  }
  function sym(e, x, y) {
    const k = e.kind, id = e.id, trip = st.tripped.has(id), lock = st.locked.has(id), off = st.off.has(id), L = R.loads[id];
    if (k === 'supply') return `<circle cx="${x}" cy="${y}" r="16" fill="#fef3c7" stroke="#a16207" stroke-width="2"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="16">~</text>`;
    if (k === 'board') return `<rect x="${x - 26}" y="${y - 14}" width="52" height="28" rx="4" fill="#e2e8f0" stroke="#475569"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" font-weight="700">DB</text>`;
    if (EF.PROT.includes(k)) { const c = lock ? '#7c3aed' : trip ? '#dc2626' : off ? '#94a3b8' : '#16a34a'; return `<rect x="${x - 13}" y="${y - 18}" width="26" height="36" rx="3" fill="#fff" stroke="#334155" stroke-width="1.5"/><rect x="${x - 6}" y="${trip || off || lock ? y + 1 : y - 13}" width="12" height="12" rx="2" fill="${c}"/><text x="${x}" y="${y - 21}" text-anchor="middle" font-size="8" fill="#475569">${esc((k === 'olr' ? 'OL' : k.toUpperCase()) + (e.rating ? ' ' + (e.curve || '') + e.rating : ''))}</text>${lock ? `<text x="${x + 15}" y="${y - 6}" font-size="12">🔒</text>` : ''}`; }
    if (k === 'contactor' || k === 'knxact') return `<rect x="${x - 15}" y="${y - 15}" width="30" height="30" rx="3" fill="${R.out[id] ? '#dcfce7' : '#fff'}" stroke="#334155" stroke-width="1.5"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" font-weight="700">${k === 'knxact' ? 'KNX' : 'K'}</text>`;
    if (k === 'switch' || k === '2way') return `<circle cx="${x}" cy="${y + 10}" r="3" fill="#334155"/><line x1="${x}" y1="${y + 10}" x2="${R.out[id] ? x : x + 12}" y2="${y - 10}" stroke="#334155" stroke-width="2.5"/><circle cx="${x}" cy="${y - 12}" r="3" fill="#334155"/>`;
    if (k === 'cable') return `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" transform="rotate(45 ${x} ${y})" fill="#fff" stroke="#a16207"/><text x="${x + 10}" y="${y + 4}" font-size="8" fill="#64748b">${e.len || ''}m</text>`;
    if (k === 'jb') return `<circle cx="${x}" cy="${y}" r="8" fill="#fff" stroke="#334155" stroke-width="1.5"/>`;
    if (k === 'cvpsu') return `<rect x="${x - 16}" y="${y - 12}" width="32" height="24" rx="3" fill="#fff" stroke="#334155"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9">24 V</text>`;
    if (EF.isCtl(e)) return `<rect x="${x - 18}" y="${y - 12}" width="36" height="24" rx="6" fill="${R.out[id] ? '#ede9fe' : '#f8fafc'}" stroke="#7c3aed"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="9" fill="#5b21b6">${esc(e.short || e.kind)}</text>`;
    if (EF.isLoad(e)) return icon(e, x, y, L && L.on, (L && L.col) || '#fde68a', L).replace(/fill="#475569"/g, 'fill="#e2e8f0"');
    return `<circle cx="${x}" cy="${y}" r="6" fill="#334155"/>`;
  }

  // ---------------------------------------------------------------- tools for the selected part
  function select(id) { sel = id; act('select:' + id); }
  function drawTools() {
    const el = $('efTools'); if (!el) return;
    if (!sel) { $('efSelH').textContent = 'Select a part'; el.innerHTML = '<p class="m" style="margin:0">Tap a part on the schematic or the site plan. Look first, then test live where it is safe, and isolate, lock off and prove dead before any dead test.</p>'; return; }
    const e = S._.els[sel]; $('efSelH').textContent = e.name || e.id;
    const T = EF.testsFor(st, R, e), groups = [...new Set(T.map((t) => t.group))];
    let ops = '';
    if (EF.PROT.includes(e.kind)) {
      if (st.locked.has(e.id)) ops += `<span class="btn s" data-op="unlock">Remove lock and switch on</span>`;
      else { ops += st.tripped.has(e.id) ? `<span class="btn s p" data-op="reset">${e.kind === 'fuse' || e.kind === 'cutout' ? 'Replace the fuse' : 'Reset'}</span>` : st.off.has(e.id) ? `<span class="btn s" data-op="on">Switch on</span>` : `<span class="btn s" data-op="off">Switch off</span>`; ops += `<span class="btn s" data-op="lock">🔒 Isolate and lock off</span>`; }
    }
    el.innerHTML = `${ops ? `<div class="chips">${ops}</div>` : ''}${groups.map((g) => `<div class="m" style="font-size:12px;margin-top:6px">${g}${g === 'Dead tests' ? ' – isolate, lock off and prove dead first' : ''}</div><div class="chips">${T.filter((t) => t.group === g).map((t) => `<span class="btn s" data-t="${t.key}">${esc(t.label)}</span>`).join('')}</div>`).join('')}
      <label class="inl" style="margin-top:6px"><input type="checkbox" id="efDisc" ${st.disc ? 'checked' : ''}> Loads and drivers disconnected for insulation tests</label> <label class="inl"><input type="checkbox" id="efNorm" ${showNorm ? 'checked' : ''}> Show normal values</label>`;
    el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => runTest(T.find((t) => t.key === b.dataset.t))));
    el.querySelectorAll('[data-op]').forEach((b) => (b.onclick = () => op(b.dataset.op)));
    $('efDisc').onchange = () => { st.disc = $('efDisc').checked; act('disc'); };
    $('efNorm').onchange = () => { showNorm = $('efNorm').checked; showMeter(); };
  }
  const deadOk = (id) => { const chain = [id].concat(S._.anc(id)); const lk = chain.find((a) => st.locked.has(a)); return lk ? { lk, proved: st.proved.has(lk) } : null; };
  function runTest(t) {
    const e = S._.els[sel]; st.meas++;
    if (t.dead) {
      const d = deadOk(sel);
      if (!d) { st.safety = Math.max(0, st.safety - 1); last = { t: t.label, at: e.name || e.id, r: '⚠ STOP – this part is live. Dead tests need the circuit isolated and locked off first. (Safety mark lost.)', n: '', warn: true }; showMeter(); act('unsafe'); return; }
      if (!d.proved) { st.safety = Math.max(0, st.safety - 0.5); st.proved.add(d.lk); st.msgs.push('proved'); last = { t: t.label, at: e.name, r: '⚠ You did not prove dead before testing – always test L–N, L–E, N–E with a voltage indicator first. (Half a safety mark lost.)', n: '', warn: true }; showMeter(); }
    }
    const r = t.fn();
    if (['vln', 'vle', 'vne'].includes(t.key)) { const d = deadOk(sel); if (d && /^0 V/.test(r)) st.proved.add(d.lk); }
    last = { t: t.label, at: e.name || e.id, r, n: NORMAL[t.key] || '' };
    st.log.push(last); refresh(); showMeter(); act(`test:${t.key}:${sel}`);
  }
  function op(o) {
    const e = S._.els[sel], nm = e.name || e.id;
    if (o === 'reset') { if (EF.F(st, sel, 'stuck')) { msg(`${nm} will not reset – the mechanism does not latch`); st.log.push({ t: 'Reset', at: nm, r: 'will not latch' }); act('reset:' + sel); return; } st.tripped.delete(sel); R = EF.evaluate(st); const again = st.tripped.has(sel); st.log.push({ t: e.kind === 'fuse' || e.kind === 'cutout' ? 'Replace fuse' : 'Reset', at: nm, r: again ? 'trips again at once' : 'holds' }); msg(again ? `${nm} trips again at once` : `${nm} holds`); }
    if (o === 'off') st.off.add(sel);
    if (o === 'on') st.off.delete(sel);
    if (o === 'lock') { st.locked.add(sel); st.off.add(sel); st.tripped.delete(sel); st.log.push({ t: 'Isolate and lock off', at: nm, r: '🔒 locked – now prove dead' }); msg(`${nm} locked off – line and neutral of the circuit disconnected. Prove dead before any dead test.`); }
    if (o === 'unlock') { st.locked.delete(sel); st.off.delete(sel); st.proved.delete(sel); R = EF.evaluate(st); const again = st.tripped.has(sel); st.log.push({ t: 'Lock removed, switched on', at: nm, r: again ? 'trips at once' : 'on' }); if (again) msg(`${nm} trips as soon as it is switched on`); }
    act(o + ':' + sel);
  }
  function showMeter() { const el = $('efMeter'); if (!el || !last) return; el.innerHTML = `<div class="mm ${last.warn ? 'warn' : ''}">${esc(last.r)}</div><div class="ms">${esc(last.t)}${last.at ? ' · ' + esc(last.at) : ''}</div>${showNorm && last.n ? `<div class="ms" style="color:#B0D035">Normal: ${esc(last.n)}</div>` : ''}`; }
  function drawLog() { const el = $('efLog'); if (!el) return; el.innerHTML = '<tr><th>#</th><th>Test</th><th>Where</th><th>Reading</th></tr>' + st.log.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.t)}</td><td>${esc(l.at || '')}</td><td><b>${esc(l.r)}</b></td></tr>`).reverse().join(''); }

  // ---------------------------------------------------------------- diagnosis and score
  function drawDiag() {
    const el = $('efDiag'); if (!el) return;
    const pool = S.pool;
    el.innerHTML = `<h3 style="margin-top:0">Your diagnosis</h3><p class="m" style="margin-top:0">Tick every fault you have found (there may be more than one). Wrong ticks cost half a fault.</p>${pool.map((f) => `<label class="dg"><input type="checkbox" data-f="${f.id}"> ${esc(f.title)}</label>`).join('')}<div class="row" style="margin-top:10px"><span class="btn p" id="efSubmit">Submit diagnosis</span>${mode !== 'demo' ? '<span class="btn" id="efHint">💡 Hint (costs the efficiency mark)</span>' : ''}<span class="m" id="efHintT"></span></div>`;
    $('efSubmit').onclick = submit;
    if ($('efHint')) $('efHint').onclick = () => { const f = st.faults[st.hints % st.faults.length]; st.hints++; $('efHintT').textContent = f.hint || 'Compare what works with what does not – the fault lies in what they do not share.'; };
  }
  function submit() {
    if (done) return; done = true;
    const ticked = new Set([...$('efDiag').querySelectorAll('[data-f]')].filter((c) => c.checked).map((c) => c.dataset.f)), real = new Set(st.faults.map((f) => f.id));
    const tp = [...ticked].filter((x) => real.has(x)).length, fp = [...ticked].filter((x) => !real.has(x)).length, n = real.size;
    const diag = Math.max(0, (tp - 0.5 * fp) / n) * 7, eff = st.hints === 0 && st.meas <= 14 * n ? 1 : 0, score = Math.round(diag + st.safety + eff);
    act('diag');
    $('efDiag').innerHTML = `<h3 style="margin-top:0">Result</h3>${kpi([[`${score} / 10`, mode === 'demo' ? 'demo complete' : score >= 7 ? 'passed ✓' : 'not yet – 7 passes', mode !== 'demo' && score < 7], [`${tp} of ${n}`, 'faults found'], [fp, 'wrong ticks', fp > 0], [`${EF.r1(st.safety, 1)} / 2`, 'safety'], [eff, 'efficiency (no hints, few tests)']])}
      ${st.faults.map((f) => `<div class="say" style="margin:8px 0"><b>${ticked.has(f.id) ? '✓' : '✗ missed:'} ${esc(f.title)}</b><br>${esc(f.why || '')}<br><b>Fix:</b> ${esc(f.fix || '')}</div>`).join('')}
      ${[...ticked].filter((x) => !real.has(x)).map((x) => `<div class="watch" style="margin:6px 0">✗ Not a fault this time: ${esc(S.pool.find((f) => f.id === x).title)}</div>`).join('')}
      <div class="row"><span class="btn p" id="efAgain">${mode === 'demo' ? 'Back' : 'New job – new random faults'}</span></div>`;
    $('efAgain').onclick = () => (mode === 'demo' ? back() : start(box, S, { mode, onDone }));
    if (onDone) onDone(mode === 'demo' ? 10 : score, 10);
  }

  // ---------------------------------------------------------------- guided demo
  function drawDemo() {
    const el = $('efDemo'); if (!el) return;
    const s = demo.steps[step];
    if (!s) { el.innerHTML = '<b>Demo complete.</b> Now try a real job with random faults.'; return; }
    el.innerHTML = `<div class="row" style="justify-content:space-between"><b>Step ${step + 1} of ${demo.steps.length}</b><span class="m" style="font-size:12px">${demo.steps.map((_, i) => (i < step ? '●' : i === step ? '◉' : '○')).join(' ')}</span></div><div style="margin:6px 0">${s.say}</div>${s.act === 'diag' ? '' : `<span class="btn p s" id="efShow">Show me</span>`}`;
    if ($('efShow')) $('efShow').onclick = () => perform(s.act);
  }
  function perform(a) {
    const [kind, x, y] = a.split(':');
    if (kind === 'select') { select(x); return; }
    if (kind === 'test') { sel = y; refresh(); const T = EF.testsFor(st, R, S._.els[y]); runTest(T.find((t) => t.key === x)); return; }
    if (kind === 'input') { const i = S.inputs.find((q) => q.k === x); if (i.type === 'btn') i.act(st, R, EF.F, msg); else st.in[x] = i.type === 'toggle' || !i.type ? !st.in[x] : st.in[x]; act(a); return; }
    if (kind === 'disc') { st.disc = true; act('disc'); return; }
    if (['reset', 'lock', 'unlock', 'off', 'on'].includes(kind)) { sel = x; op(kind); return; }
  }
  function act(ev) {
    refresh();
    if (mode !== 'demo' || !demo.steps[step]) return;
    const s = demo.steps[step];
    if (ev === s.act || (s.act.startsWith('select:') && ev === s.act)) { step++; drawDemo(); if (demo.steps[step] && demo.steps[step].act === 'diag') { const f = demo.faults[0]; const c = $('efDiag').querySelector(`[data-f="${f}"]`); if (c) c.parentElement.style.outline = '2px solid #B0D035'; } }
  }
  return { start };
})();
