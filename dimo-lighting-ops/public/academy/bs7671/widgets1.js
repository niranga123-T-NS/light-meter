/* BS 7671 course – widgets 1: generic games (flip cards, sort, sequence, scenarios) and the Level 1 simulators
   (installation profile, waveforms and phasors, earthing system explorer, source impedance and fault level, external influences, fire spread) */
(function () {
  const svgWrap = (w, h, inner, cls) => `<svg viewBox="0 0 ${w} ${h}" ${cls ? `class="${cls}"` : ''} xmlns="http://www.w3.org/2000/svg" font-family="system-ui,sans-serif">${inner}</svg>`;
  const pl = (pts, st, extra) => `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" style="${st}" ${extra || ''}/>`;
  const tx = (x, y, t, st) => `<text x="${x}" y="${y}" style="${st || 'fill:#cbd5e1;font-size:12px'}">${t}</text>`;

  // ---------------------------------------------------------------- flip cards: tap a card to turn it over
  W.flip = (el, o) => {
    el.innerHTML = `<div class="flip">${o.cards.map(([f, b], i) => `<div data-i="${i}"><b>${f}</b><span class="m" style="font-size:12px">Tap to turn over</span></div>`).join('')}</div><div class="note" id="flN">0 of ${o.cards.length} turned over</div>`;
    const seen = new Set();
    el.querySelectorAll('.flip div').forEach((d) => d.onclick = () => { const i = +d.dataset.i, on = d.classList.toggle('on'); const [f, b] = o.cards[i]; d.innerHTML = on ? `<b>${f}</b><span style="font-size:13px">${b}</span>` : `<b>${f}</b><span class="m" style="font-size:12px">Tap to turn over</span>`; seen.add(i); $('flN').textContent = `${seen.size} of ${o.cards.length} turned over`; });
  };

  // ---------------------------------------------------------------- sort: tap an item, then the box it belongs in
  W.sort = (el, o) => {
    let items = o.items.map((x, i) => ({ t: x[0], c: x[1], why: x[2], i, put: null })).sort(() => Math.random() - 0.5), cur = null;
    const draw = () => {
      const right = items.filter((x) => x.put === x.c).length, done = items.every((x) => x.put != null);
      el.innerHTML = `<p class="m" style="margin:0 0 6px">${o.ask || 'Tap an item, then tap the box it belongs in.'}</p><div class="chips">${items.filter((x) => x.put == null).map((x) => `<span class="tile ${cur === x.i ? 'sel' : ''}" data-i="${x.i}">${x.t}</span>`).join('') || '<span class="m">All placed.</span>'}</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:8px">${o.bins.map((b, k) => `<div class="tile" data-b="${k}" style="min-height:90px;cursor:pointer"><b style="color:${o.colors ? o.colors[k] : 'var(--navy)'}">${b}</b><div class="chips">${items.filter((x) => x.put === k).map((x) => `<span class="tile ${done ? (x.c === k ? 'ok' : 'no') : ''}" title="${esc(x.why || '')}" style="cursor:default">${x.t}</span>`).join('')}</div></div>`).join('')}</div>
        ${done ? `${kpi([[`${right} / ${items.length}`, 'in the right box', right < items.length]])}<div class="note">${items.filter((x) => x.put !== x.c).map((x) => `✗ <b>${x.t}</b> → ${o.bins[x.c]}${x.why ? ' – ' + x.why : ''}`).join('<br>')}</div><span class="btn s" id="soAgain">Shuffle and try again</span>` : ''}`;
      el.querySelectorAll('.chips .tile[data-i]').forEach((t) => t.onclick = () => { cur = +t.dataset.i; draw(); });
      el.querySelectorAll('[data-b]').forEach((b) => b.onclick = () => { if (cur == null) return; items.find((x) => x.i === cur).put = +b.dataset.b; cur = null; draw(); });
      if ($('soAgain')) $('soAgain').onclick = () => { items.forEach((x) => (x.put = null)); items.sort(() => Math.random() - 0.5); draw(); };
    };
    draw();
  };

  // ---------------------------------------------------------------- sequence: tap the steps in the right order
  W.seq = (el, o) => {
    let order = o.steps.map((s, i) => i).sort(() => Math.random() - 0.5), got = [], miss = 0;
    const draw = () => {
      const fin = got.length === o.steps.length;
      el.innerHTML = `<p class="m" style="margin:0 0 6px">${o.ask || 'Tap the steps in the right order.'}</p><ol style="margin:0 0 8px;padding-left:20px">${got.map((i) => `<li class="okc" style="font-weight:600">${o.steps[i]}</li>`).join('')}</ol>
        ${fin ? `${kpi([[miss, 'wrong taps', miss > 0], ['✓', 'sequence complete', false]])}${o.after ? `<div class="say">${o.after}</div>` : ''}<span class="btn s" id="sqAgain" style="margin-top:8px">Again</span>` : `<div class="chips">${order.filter((i) => !got.includes(i)).map((i) => `<span class="tile" data-i="${i}">${o.steps[i]}</span>`).join('')}</div><div class="note" id="sqN"></div>`}`;
      el.querySelectorAll('[data-i]').forEach((t) => t.onclick = () => { const i = +t.dataset.i; if (i === got.length) { got.push(i); draw(); } else { miss++; t.classList.add('no'); $('sqN').innerHTML = `<span class="noc">Not yet.</span> ${o.hints && o.hints[got.length] ? o.hints[got.length] : 'What has to happen before this?'}`; setTimeout(() => t.classList.remove('no'), 600); } });
      if ($('sqAgain')) $('sqAgain').onclick = () => { order.sort(() => Math.random() - 0.5); got = []; miss = 0; draw(); };
    };
    draw();
  };

  // ---------------------------------------------------------------- scenarios: one at a time, pick the answer, see why (also the scenario assessment)
  W.scen = (el, o) => {
    const set = o.assess ? (o.items || W.scen.BANK).slice().sort(() => Math.random() - 0.5).slice(0, o.n || 10) : o.items;
    let i = 0, score = 0;
    const draw = () => {
      if (i >= set.length) { el.innerHTML = kpi([[`${score} / ${set.length}`, o.assess ? 'right – 7 of 10 passes' : 'right first time', score < set.length * 0.7]]) + (o.assess ? '' : '<span class="btn s" id="scAgain">Play again</span>'); if ($('scAgain')) $('scAgain').onclick = () => { i = 0; score = 0; draw(); }; if (o.done) o.done(score, set.length); return; }
      const [s, opts, c, why] = set[i], rnd = seeded('sc' + s), ord = opts.map((x, k) => [k, rnd()]).sort((a, b) => a[1] - b[1]).map(([k]) => k);
      el.innerHTML = `<div class="m" style="font-size:12px">${o.label || 'Scenario'} ${i + 1} of ${set.length}</div><p style="margin:4px 0 6px"><b>${s}</b></p>${ord.map((k) => `<button class="opt" data-k="${k}">${opts[k]}</button>`).join('')}<div class="note" id="scWhy"></div>`;
      let answered = false;
      el.querySelectorAll('.opt').forEach((b) => b.onclick = () => { if (answered) return; answered = true; const ok = +b.dataset.k === c; if (ok) score++; b.classList.add(ok ? 'ok' : 'no'); el.querySelector(`.opt[data-k="${c}"]`).classList.add('ok');
        $('scWhy').innerHTML = `${ok ? '<span class="okc">✓</span>' : '<span class="noc">✗</span>'} ${why || ''} <span class="btn p s" id="scNext">Next ▶</span>`; $('scNext').onclick = () => { i++; draw(); }; });
    };
    draw();
  };

  // ---------------------------------------------------------------- installation profile (Chapter 31 – assessment of general characteristics)
  W.profile = (el) => {
    el.innerHTML = `<div class="two"><div class="ctl" style="grid-template-columns:1fr 1fr">${sel('pfSup', 'Supply', [['ceb', 'Public LV supply (CEB / LECO)'], ['tx', 'Own transformer (HV intake)'], ['gen', 'Generator only']], 'ceb')}${sel('pfEarth', 'Earthing arrangement', ['TN-S', 'TN-C-S', 'TT', 'IT'], 'TT')}${sel('pfPh', 'Live conductors', [['1', 'Single-phase 2-wire'], ['3', 'Three-phase 4-wire']], '1')}${sel('pfIn', 'Supply fuse / main protective device', [[60, '60 A'], [63, '63 A'], [80, '80 A'], [100, '100 A'], [200, '200 A'], [400, '400 A'], [800, '800 A']], 63)}
      ${sl('pfZe', 'External earth fault loop impedance Ze', 0.05, 200, 0.05, 0.35, ' Ω')}${sl('pfPf', 'Prospective fault current at the origin', 0.5, 25, 0.5, 3, ' kA')}${sl('pfMd', 'Maximum demand (after diversity)', 5, 600, 5, 45, ' A')}${sel('pfUse', 'Use', [['dom', 'House / apartment'], ['com', 'Shop / office'], ['ind', 'Factory / warehouse'], ['hotel', 'Hotel / hospital']], 'com')}</div>
      <div class="info" id="pfOut" style="border:1px solid var(--line);border-radius:10px;padding:12px"></div></div>`;
    bind(el, () => {
      const sup = $('pfSup').value, e = $('pfEarth').value, ze = num('pfZe'), pf = num('pfPf'), md = num('pfMd'), In = num('pfIn'), ph = $('pfPh').value, notes = [];
      if (e === 'TT' && ze < 5) notes.push('⚠ A TT installation\'s earth fault loop impedance includes the installation earth electrode – a value below about 5 Ω is unusual. Re-measure with the main earthing conductor connected.');
      if (e === 'TT') notes.push('TT: the fault current is too small for MCBs or fuses to disconnect in time – RCDs give fault protection (Regulation 411.5). Keep RA × IΔn ≤ 50 V.');
      if (e === 'TN-C-S') notes.push('TN-C-S (PME): bond extraneous-conductive-parts with conductors sized from the supply neutral (Table 54.8). Consider the lost-PEN risk for EV chargers and outdoor equipment.');
      if (e === 'IT') notes.push('IT: an insulation monitoring device must alarm on the first fault; the second fault must be cleared like TN or TT.');
      if (e === 'TN-S' && ze > 0.8) notes.push('⚠ Ze above the typical 0.8 Ω for TN-S – check the measurement and ask the supplier.');
      if (e === 'TN-C-S' && ze > 0.35) notes.push('⚠ Ze above the typical 0.35 Ω for TN-C-S – check the measurement and ask the supplier.');
      if (pf > 6) notes.push(`Prospective fault current ${pf} kA – devices rated 6 kA are not enough; choose ${pf > 10 ? '15–25 kA or BS 88 fuses, or rely on back-up protection from the supplier\'s fuse' : '10 kA'} breaking capacity (Regulation 434.5.1).`);
      if (md > In) notes.push(`⚠ Maximum demand ${md} A is more than the ${In} A supply device – apply for a larger supply or reduce the load.`);
      if (sup === 'gen') notes.push('Generator supply: Ze and fault current are much lower than from the grid – check that protective devices still disconnect in time (Section 551).');
      if (sup === 'tx') notes.push('Own transformer: you are the supplier as well – voltage drop limits for a private supply apply (6 % lighting, 8 % other) and you choose the earthing system.');
      $('pfOut').innerHTML = `<h5 style="margin:0 0 6px;font-size:15px">Installation profile</h5><table class="spec"><tr><td>Nominal voltage</td><td>${ph === '3' ? '400 V line / 230 V to earth (U0)' : '230 V (U0)'}, 50 Hz</td></tr><tr><td>Earthing</td><td>${e}</td></tr><tr><td>Ze</td><td>${ze} Ω</td></tr><tr><td>PFC at origin</td><td>${pf} kA</td></tr><tr><td>Max. demand</td><td>${md} A of ${In} A</td></tr><tr><td>Use</td><td>${$('pfUse').selectedOptions[0].text}</td></tr></table><div style="margin-top:8px;font-size:13px">${notes.map((n) => `<div style="margin:4px 0">${n}</div>`).join('') || '<span class="okc">No warnings – record these values on the certificate.</span>'}</div>`;
    });
  };

  // ---------------------------------------------------------------- waveforms and phasors: single-phase and three-phase, rotating phasors
  W.wave = (el, o) => {
    el.innerHTML = `<div class="stage"><svg id="wvS" viewBox="0 0 760 300"></svg></div><div class="ctl">${sel('wvMode', 'Show', [['1', 'Single-phase (L–N)'], ['3', 'Three-phase (L1, L2, L3)'], ['ll', 'Line voltage L1–L2']], o.mode || '3')}${sl('wvSp', 'Animation speed', 0, 3, 0.25, 1, '×')}</div>${kpi([['230 V', 'U0 – r.m.s. line to earth'], ['325 V', 'peak (230 × √2)'], ['400 V', 'line to line (230 × √3)'], ['50 Hz', '20 ms per cycle']])}`;
    const vis = ['#f59e0b', '#e2e8f0', '#38bdf8'];
    let ph = 0, raf, last = performance.now();
    const draw = (t) => {
      const dt = (t - last) / 1000; last = t; ph += dt * 2 * Math.PI * 0.5 * num('wvSp');
      const m = $('wvMode').value, cx = 120, cy = 150, R = 95, x0 = 250, w = 490, A = 105; let s = '';
      s += `<line x1="${x0}" y1="${cy}" x2="${x0 + w}" y2="${cy}" stroke="#334155"/><line x1="${x0}" y1="40" x2="${x0}" y2="260" stroke="#334155"/>${tx(x0 + w - 70, cy + 16, '20 ms →')}${tx(x0 + 4, 36, '+325 V')}${tx(x0 + 4, 272, '−325 V')}`;
      s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#334155" stroke-dasharray="3 4"/>`;
      const phases = m === '1' ? [0] : [0, 1, 2];
      phases.forEach((k) => { const sh = (k * 2 * Math.PI) / 3; let d = '';
        for (let i = 0; i <= 120; i++) { const a = (i / 120) * 2 * Math.PI; d += (i ? 'L' : 'M') + (x0 + (i / 120) * w).toFixed(1) + ',' + (cy - A * Math.sin(a - sh + ph)).toFixed(1); }
        s += `<path d="${d}" fill="none" stroke="${vis[k]}" stroke-width="${m === 'll' ? 1.2 : 2.5}" opacity="${m === 'll' ? 0.45 : 1}"/>`;
        const ax = cx + R * Math.cos(ph - sh), ay = cy - R * Math.sin(ph - sh);
        s += `<line x1="${cx}" y1="${cy}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="${vis[k]}" stroke-width="3"/><circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="4" fill="${vis[k]}"/>${tx(ax + 6, ay, m === '1' ? 'L' : 'L' + (k + 1), `fill:${vis[k]};font-size:12px;font-weight:700`)}`;
      });
      if (m === 'll') { let d = ''; for (let i = 0; i <= 120; i++) { const a = (i / 120) * 2 * Math.PI; d += (i ? 'L' : 'M') + (x0 + (i / 120) * w).toFixed(1) + ',' + (cy - A * Math.sqrt(3) * 0.75 * Math.sin(a + ph + Math.PI / 6)).toFixed(1); }
        s += `<path d="${d}" fill="none" stroke="#B0D035" stroke-width="3"/>${tx(x0 + 10, 56, 'L1 – L2 = 400 V r.m.s. (565 V peak, 30° ahead of L1) – scaled', 'fill:#B0D035;font-size:12px;font-weight:700')}`;
        const a1 = [cx + R * Math.cos(ph), cy - R * Math.sin(ph)], a2 = [cx + R * Math.cos(ph - 2.094), cy - R * Math.sin(ph - 2.094)];
        s += `<line x1="${a2[0].toFixed(1)}" y1="${a2[1].toFixed(1)}" x2="${a1[0].toFixed(1)}" y2="${a1[1].toFixed(1)}" stroke="#B0D035" stroke-width="3"/>`; }
      s += tx(20, 24, m === '1' ? 'Single phase: one line conductor, the neutral at 0 V' : m === '3' ? 'Three phases 120° apart – at every instant they add up to zero' : 'Line voltage = difference between two phases', 'fill:#e2e8f0;font-size:13px;font-weight:600');
      if (m !== '1') s += tx(20, 290, 'Colours: L1 brown · L2 black · L3 grey · N blue (shown lighter on screen)', 'fill:#94a3b8;font-size:11px');
      $('wvS').innerHTML = s; raf = requestAnimationFrame(draw);
    };
    bind(el, () => {}); raf = requestAnimationFrame(draw); onStop(() => cancelAnimationFrame(raf));
  };

  // ---------------------------------------------------------------- earthing system explorer: TN-S, TN-C-S, TT, IT, a fault on a Class I appliance, the loop animated
  W.earth = (el, o) => {
    el.innerHTML = `<div class="stage"><svg id="eaS" viewBox="0 0 760 360"></svg></div>
      <div class="ctl">${sel('eaSys', 'Earthing system', ['TN-S', 'TN-C-S', 'TT', 'IT'], o.sys || 'TN-C-S')}${sel('eaMode', 'What happens', [['fault', 'Earth fault: line touches the metal case'], ['pen', 'Broken PEN conductor in the street (no fault)'], ['f2', 'IT: second fault on another phase']], o.mode || 'fault')}
      ${sl('eaZe', 'Ze (supply part of the loop)', 0.05, 1.5, 0.05, 0.35, ' Ω')}${sl('eaRA', 'Installation electrode RA (TT)', 5, 400, 5, 100, ' Ω')}${sl('eaR12', 'Circuit R1 + R2', 0.1, 2.5, 0.05, 0.6, ' Ω')}${sel('eaDev', 'Circuit protection', [['B32', 'Type B 32 A MCB'], ['B16', 'Type B 16 A MCB'], ['C32', 'Type C 32 A MCB'], ['D16', 'Type D 16 A MCB']], 'B32')}
      <div><label>30 mA RCD on the circuit</label><select id="eaRcd"><option value="1">Yes</option><option value="0">No</option></select></div>${sl('eaLoad', 'Load on (for broken PEN)', 0.5, 9, 0.5, 3, ' kW')}</div><div id="eaK"></div><div class="note" id="eaN"></div>`;
    bind(el, () => {
      const sys = $('eaSys').value; let mode = $('eaMode').value;
      if (mode === 'pen' && sys !== 'TN-C-S') { mode = 'fault'; $('eaMode').value = 'fault'; }
      if (mode === 'f2' && sys !== 'IT') { mode = 'fault'; $('eaMode').value = 'fault'; }
      const ze = num('eaZe'), RA = num('eaRA'), r12 = num('eaR12'), dk = $('eaDev').value, d = BS.dev(dk[0], +dk.slice(1)), Ia = BS.ia(d, 0.4), rcd = $('eaRcd').value === '1', RB = 10;
      let If, Ut, t, how, zs, warn = false;
      if (mode === 'pen') {
        const Rl = (230 * 230) / (num('eaLoad') * 1000), Re = 20; Ut = (230 * Re) / (Re + Rl); If = 230 / (Re + Rl); zs = null; t = Infinity; warn = Ut > 50;
        how = `The PEN is broken upstream: load current (${fx(If, 1)} A) can only return through the earthing terminal, bonded metalwork and the ground. Every earthed metal part rises to about ${fx(Ut, 0)} V. No fuse, MCB or RCD sees a fault – this is why PME is restricted for EV chargers, caravans and boats, and why open-PEN devices exist.`;
      } else if (sys === 'TT') {
        zs = ze + r12 + RA + RB; If = 230 / zs; Ut = If * RA; const tm = BS.tAt(d, If);
        t = rcd ? (If >= 0.15 ? 0.04 : If >= 0.03 ? 0.3 : Infinity) : tm; warn = !(t <= 0.2) || (!rcd && Ut > 50);
        how = `The fault current returns through the ground between your electrode (RA ${RA} Ω) and the supply electrode (about ${RB} Ω): only ${fx(If, 2)} A. The ${d.label} needs ${fx(Ia, 0)} A to trip instantly – ${tm === Infinity ? 'it will never trip' : 'it would take ' + fx(tm, 1) + ' s'}. ${rcd ? 'The RCD sees the ' + fx(If, 2) + ' A leaving through earth and trips in about ' + (If >= 0.15 ? '40 ms' : '300 ms') + '.' : 'Without an RCD the case stays at ' + fx(Ut, 0) + ' V.'} Rule for TT: RA × IΔn ≤ 50 V → ${RA} × 0.03 = ${fx(RA * 0.03, 1)} V ${RA * 0.03 <= 50 ? '✓' : '✗'}.`;
      } else if (sys === 'IT' && mode !== 'f2') {
        If = 0.25; Ut = If * RA; zs = null; t = Infinity; warn = false;
        how = `First fault in an IT system: the source is not earthed (or earthed through a high impedance), so only a tiny capacitive current flows (about ${If} A). Touch voltage ≈ ${fx(Ut, 1)} V – safe. Nothing trips: the insulation monitoring device alarms and the fault must be found before a second fault happens. Used for operating theatres and critical process plant.`;
      } else if (sys === 'IT') {
        zs = 2 * r12 + 0.05; If = 400 / zs; Ut = (If * r12) / 2; t = BS.tAt(d, If * 0.87); warn = t > 0.4;
        how = `Second fault on another phase: a line-to-line fault through the two metal cases and the protective conductors – ${fx(If, 0)} A at 400 V. Now the overcurrent device must disconnect like a TN system (the IT rules use 400 V and 2 × the loop). ${t <= 0.4 ? 'It trips in time.' : 'Too slow – the loop impedance is too high.'}`;
      } else {
        const pe = sys === 'TN-S' ? 0.5 : 0.4; zs = ze + r12; If = 230 / zs; Ut = (230 * (r12 * 0.62 + ze * pe)) / zs; t = BS.tAt(d, If); if (rcd) t = Math.min(t, 0.04); warn = t > 0.4;
        how = `Zs = Ze + (R1 + R2) = ${ze} + ${r12} = ${fx(zs, 2)} Ω → fault current ${fx(If, 0)} A. The ${d.label} trips instantly at ${fx(Ia, 0)} A or more, so it ${If >= Ia ? 'disconnects in under 0.1 s ✓' : 'is too slow: ' + (BS.tAt(d, If) === Infinity ? 'never trips' : fx(BS.tAt(d, If), 1) + ' s') + (rcd ? ' – but the RCD disconnects in about 40 ms' : ' ✗ – reduce Zs or add an RCD')}. Until then the case rises to about ${fx(Ut, 0)} V above earth.`;
      }
      // drawing
      const tn = sys === 'TN-S' || sys === 'TN-C-S', fl = 'stroke:#fb923c;stroke-width:5', base = (c) => `stroke:${c};stroke-width:3`;
      let s = `<rect x="0" y="300" width="760" height="60" fill="#3f2d1d"/><text x="12" y="350" style="fill:#d6c3a5;font-size:11px">Ground</text>`;
      s += `<circle cx="70" cy="110" r="34" fill="none" stroke="#94a3b8" stroke-width="2"/><circle cx="92" cy="110" r="34" fill="none" stroke="#94a3b8" stroke-width="2"/>${tx(40, 60, 'Supply transformer')}`;
      s += pl([[126, 80], [320, 80]], base('#a16207')) + pl([[320, 80], [600, 80], [600, 112]], base('#a16207')) + tx(130, 74, 'L');
      if (sys === 'TN-C-S') s += pl([[126, 130], [300, 130]], mode === 'pen' ? 'stroke:#22c55e;stroke-width:3' : base('#22c55e')) + tx(150, 146, 'PEN (combined N + PE)', 'fill:#86efac;font-size:12px') + (mode === 'pen' ? `<g class="blink"><line x1="210" y1="120" x2="226" y2="140" stroke="#ef4444" stroke-width="4"/><line x1="226" y1="120" x2="210" y2="140" stroke="#ef4444" stroke-width="4"/></g>${tx(190, 112, 'PEN broken', 'fill:#fca5a5;font-size:12px;font-weight:700')}` : '');
      else s += pl([[126, 120], [300, 120]], base('#3b82f6')) + tx(130, 114, 'N');
      s += pl([[300, 120], [580, 120], [580, 112]], base('#3b82f6'));
      if (sys === 'TN-S') s += pl([[110, 145], [110, 160], [300, 160]], base('#22c55e')) + tx(130, 176, 'PE (cable sheath / separate)', 'fill:#86efac;font-size:12px');
      if (sys === 'TN-C-S') s += pl([[300, 130], [300, 160]], base('#22c55e'));
      if (sys !== 'IT') s += pl([[110, 145], [110, 220]], base('#22c55e')) + `<rect x="104" y="220" width="12" height="80" fill="#9ca3af"/>`; else s += `<rect x="96" y="150" width="28" height="40" rx="4" fill="#1e293b" stroke="#f59e0b"/>${tx(84, 206, 'high Z / none', 'fill:#fcd34d;font-size:11px')}`;
      s += `<rect x="296" y="56" width="80" height="140" rx="8" fill="#1e293b" stroke="#64748b"/>${tx(304, 52, 'Consumer unit')}<rect x="300" y="152" width="70" height="16" fill="#14532d"/>${tx(304, 164, 'MET', 'fill:#bbf7d0;font-size:11px;font-weight:700')}`;
      s += pl([[370, 160], [640, 160], [640, 140]], base('#22c55e')) + tx(420, 176, 'Circuit protective conductor (R2)', 'fill:#86efac;font-size:12px');
      if (sys === 'TT' || sys === 'IT') s += pl([[370, 160], [430, 160], [430, 220]], base('#22c55e')) + `<rect x="424" y="220" width="12" height="80" fill="#9ca3af"/>${tx(442, 250, 'RA', 'fill:#e2e8f0;font-size:12px;font-weight:700')}`;
      s += `<rect x="560" y="90" width="110" height="60" rx="6" fill="${warn && mode !== 'pen' ? '#7f1d1d' : '#334155'}" stroke="#cbd5e1"/>${tx(566, 144, 'Class I appliance', 'fill:#e2e8f0;font-size:10px')}`;
      if (mode !== 'pen') s += `<path d="M600 112 l8 6 -6 2 10 8" stroke="#fde047" stroke-width="3" fill="none"/>`;
      if (mode === 'f2') s += `<rect x="480" y="210" width="70" height="50" rx="6" fill="#334155" stroke="#cbd5e1"/>${tx(486, 240, '2nd appliance', 'fill:#e2e8f0;font-size:10px')}` + pl([[520, 160], [520, 210]], base('#22c55e'));
      const hot = (Ut > 50 && t > 0.4) || (mode === 'pen' && Ut > 50);
      s += `<g transform="translate(690,150)"><circle cx="20" cy="0" r="10" fill="${hot ? '#ef4444' : '#e2e8f0'}"/><line x1="20" y1="10" x2="20" y2="80" stroke="${hot ? '#ef4444' : '#e2e8f0'}" stroke-width="4"/><line x1="20" y1="30" x2="-18" y2="-8" stroke="${hot ? '#ef4444' : '#e2e8f0'}" stroke-width="4"/><line x1="20" y1="80" x2="8" y2="150" stroke="${hot ? '#ef4444' : '#e2e8f0'}" stroke-width="4"/><line x1="20" y1="80" x2="32" y2="150" stroke="${hot ? '#ef4444' : '#e2e8f0'}" stroke-width="4"/></g>`;
      let loop = [];
      if (mode === 'pen') loop = [[580, 112], [580, 120], [300, 120], [300, 160], [370, 160], [430, 160], [430, 300], [110, 300], [110, 145]];
      else if (sys === 'TN-S') loop = [[126, 80], [600, 80], [600, 125], [640, 140], [640, 160], [300, 160], [110, 160], [110, 145]];
      else if (sys === 'TN-C-S') loop = [[126, 80], [600, 80], [600, 125], [640, 140], [640, 160], [300, 160], [300, 130], [126, 130]];
      else if (sys === 'TT') loop = [[126, 80], [600, 80], [600, 125], [640, 140], [640, 160], [430, 160], [430, 300], [110, 300], [110, 145]];
      else if (mode === 'f2') loop = [[126, 80], [600, 80], [600, 125], [640, 140], [640, 160], [520, 160], [520, 210], [500, 210]];
      if (loop.length && !(sys === 'IT' && mode === 'fault')) s += pl(loop, fl, 'class="flow" opacity="0.9"');
      if (mode === 'pen') s += `<rect x="296" y="300" width="0" height="0"/>${tx(450, 290, 'current returns through the ground', 'fill:#fdba74;font-size:12px')}`;
      s += tx(16, 24, `${sys}${mode === 'pen' ? ' – broken PEN' : mode === 'f2' ? ' – second fault' : ' – earth fault'}`, 'fill:#fff;font-size:15px;font-weight:700') + tx(16, 42, 'Orange dashes: the path of the fault current', 'fill:#fdba74;font-size:12px');
      $('eaS').innerHTML = s;
      $('eaK').innerHTML = kpi([[zs == null ? '—' : fx(zs, 2) + ' Ω', 'loop impedance'], [fx(If, If < 10 ? 2 : 0) + ' A', mode === 'pen' ? 'current through earth' : 'fault current'], [fx(Ut, 0) + ' V', 'touch voltage on the case', Ut > 50], [t === Infinity ? 'never' : t < 0.1 ? '< 0.1 s' : fx(t, 2) + ' s', 'disconnection', t > 0.4]]);
      $('eaN').innerHTML = how;
    });
  };

  // ---------------------------------------------------------------- source impedance → prospective fault current → breaking capacity
  W.ze = (el) => {
    el.innerHTML = `<div class="ctl">${sl('zeZ', 'Ze at the origin', 0.02, 1.2, 0.01, 0.2, ' Ω')}${sel('zePh', 'Supply', [['1', 'Single-phase'], ['3', 'Three-phase (≈ 2 × the single-phase value)']], '1')}${sel('zeDev', 'Device at the origin', [[6, 'MCB 6 kA (Icn 6000)'], [10, 'MCB 10 kA'], [16, 'MCCB 16 kA'], [25, 'MCCB 25 kA'], [80, 'BS 88 fuse 80 kA']], 6)}</div><div class="panel" style="margin-top:8px"><svg id="zeS" viewBox="0 0 720 150"></svg></div><div id="zeK"></div><div class="note" id="zeN"></div>`;
    bind(el, () => {
      const z = num('zeZ'), ph = $('zePh').value, kA = (230 / z / 1000) * (ph === '3' ? 2 : 1), cap = num('zeDev'), ok = kA <= cap, x = (v) => 30 + (Math.min(v, 40) / 40) * 660;
      let s = `<rect x="30" y="50" width="660" height="30" rx="6" fill="#e5e7eb"/><rect x="30" y="50" width="${x(kA) - 30}" height="30" rx="6" fill="${ok ? '#22c55e' : '#ef4444'}"/>`;
      [1, 3, 6, 10, 16, 25, 40].forEach((v) => (s += `<line x1="${x(v)}" y1="44" x2="${x(v)}" y2="86" stroke="#94a3b8"/><text x="${x(v) - 6}" y="102" font-size="11" fill="#475569">${v}</text>`));
      s += `<line x1="${x(cap)}" y1="30" x2="${x(cap)}" y2="96" stroke="#244286" stroke-width="3"/><text x="${Math.min(x(cap) + 4, 600)}" y="28" font-size="12" font-weight="700" fill="#244286">device breaks ${cap} kA</text><text x="30" y="128" font-size="12" fill="#475569">Prospective fault current (kA) – PSCC / PEFC at the origin</text>`;
      $('zeS').innerHTML = s;
      $('zeK').innerHTML = kpi([[fx(kA, 2) + ' kA', 'prospective fault current'], [cap + ' kA', 'breaking capacity'], [ok ? 'OK' : 'Too low', 'device can break the fault', !ok]]);
      $('zeN').innerHTML = `Ipf = U0 / Ze = 230 / ${z} = ${fx(230 / z, 0)} A${ph === '3' ? ' – for three-phase take about twice the single-phase value' : ''}. The lower Ze, the higher the fault current: close to a transformer it can exceed 16 kA. Every device must be able to break the highest fault current where it is installed (Regulation 434.5.1) – unless a device upstream gives back-up protection and the maker confirms the combination. Measure Ipf at the origin and record the highest value.`;
    });
  };

  // ---------------------------------------------------------------- external influences → IP / IK and wiring system
  W.extinf = (el) => {
    const AD = [['AD1', 'Negligible water – dry room', 'X0'], ['AD2', 'Falling drops – condensation', 'X1'], ['AD3', 'Spraying water – up to 60°', 'X3'], ['AD4', 'Splashing from any direction – outdoors, kitchens', 'X4'], ['AD5', 'Water jets – wash-down areas', 'X5'], ['AD6', 'Waves / heavy jets – jetties', 'X6'], ['AD7', 'Temporary immersion – in-ground, pits', 'X7'], ['AD8', 'Submersion – pools, fountains', 'X8']];
    const AE = [['AE1', 'Negligible solids', '2X'], ['AE2', 'Small objects ≥ 2.5 mm – tools', '3X'], ['AE3', 'Very small objects ≥ 1 mm – wires', '4X'], ['AE4', 'Light dust', '5X'], ['AE5', 'Moderate dust – workshops', '6X'], ['AE6', 'Heavy dust – cement, flour, sawmills', '6X']];
    const AG = [['AG1', 'Low impact – offices', 'IK05'], ['AG2', 'Medium impact – industry, public areas', 'IK07'], ['AG3', 'High impact – warehouses with forklifts, sports halls', 'IK08–IK10']];
    el.innerHTML = `<div class="two"><div class="ctl" style="grid-template-columns:1fr">${sel('exW', 'Water (AD)', AD.map((a) => [a[0], a[0] + ' – ' + a[1]]), 'AD4')}${sel('exS', 'Solid objects and dust (AE)', AE.map((a) => [a[0], a[0] + ' – ' + a[1]]), 'AE4')}${sel('exI', 'Impact (AG)', AG.map((a) => [a[0], a[0] + ' – ' + a[1]]), 'AG2')}${sl('exT', 'Highest ambient temperature (AA)', 25, 60, 1, 35, ' °C')}${sel('exU', 'Sun (AN)', [['AN1', 'Indoors / no sun'], ['AN3', 'Direct sun outdoors']], 'AN3')}${sel('exC', 'Corrosion (AF)', [['AF1', 'Normal'], ['AF2', 'Coastal / salt air, fertiliser'], ['AF4', 'Chemicals – continuous']], 'AF2')}</div><div id="exOut" style="border:1px solid var(--line);border-radius:10px;padding:12px"></div></div>`;
    bind(el, () => {
      const w = AD.find((a) => a[0] === $('exW').value), so = AE.find((a) => a[0] === $('exS').value), im = AG.find((a) => a[0] === $('exI').value), T = num('exT'), sun = $('exU').value, cor = $('exC').value;
      const ip = 'IP' + so[2][0] + w[2][1], ca = BS.ca(T, 'PVC'), cax = BS.ca(T, 'XLPE');
      const sys = [];
      if (w[0] >= 'AD7') sys.push('Cables suitable for immersion (e.g. H07RN-F or armoured XLPE); glands and joints rated ' + ip);
      if (sun === 'AN3') sys.push('UV-resistant sheath (black PE / LSZH rated for UV) – plain PVC trunking and cable ties go brittle in the sun');
      if (cor !== 'AF1') sys.push('Stainless steel or hot-dip galvanised fixings, brass / nylon glands, no bare steel; ' + (cor === 'AF4' ? 'chemical-resistant sheath' : 'sealed enclosures'));
      if (im[0] === 'AG3') sys.push('Steel conduit / trunking or armoured cable; luminaires IK08 or more (IK10 where balls hit)');
      if (so[0] >= 'AE4') sys.push('Dust-protected enclosures, sealed cable entries');
      $('exOut').innerHTML = `<h5 style="margin:0 0 6px;font-size:15px">What the location needs</h5>${kpi([[ip, 'minimum IP code'], [im[2], 'impact (IK)'], [fx(ca, 2), 'Ca for 70 °C PVC'], [fx(cax, 2), 'Ca for 90 °C XLPE']])}<ul style="margin:0;padding-left:18px;font-size:13px">${sys.map((x) => `<li>${x}</li>`).join('') || '<li>Ordinary wiring system for a dry, clean location</li>'}</ul><p class="note">First IP digit = solid objects and dust, second = water. Choose equipment for the worst external influence it will meet (Chapter 51 and Section 522). The ambient temperature changes the current-carrying capacity – see the factor Ca.</p>`;
    });
  };

  // ---------------------------------------------------------------- fire: sealing a penetration and premature collapse of wiring systems
  W.fire = (el, o) => {
    el.innerHTML = `<div class="row" style="margin-bottom:8px"><span class="btn s on" data-v="pen">Penetration through a fire wall</span><span class="btn s" data-v="col">Cables over an escape route</span></div><div class="stage"><svg id="fiS" viewBox="0 0 760 300"></svg></div><div class="ctl" id="fiC"></div><div class="note" id="fiN"></div>`;
    let view = o.view || 'pen', t0 = performance.now(), raf;
    const ctl = () => { $('fiC').innerHTML = view === 'pen' ? `<div><label>Fire-stopping around the cables</label><select id="fiSeal"><option value="0">None – gap left</option><option value="1">Sealed to the wall's fire rating</option></select></div>` : `<div><label>Cable support</label><select id="fiSup"><option value="0">Plastic clips / plastic trunking only</option><option value="1">Metal clips / fire-resistant supports</option></select></div>`; $('fiC').querySelectorAll('select').forEach((s) => (s.onchange = () => { t0 = performance.now(); })); };
    el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { view = b.dataset.v; el.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b)); t0 = performance.now(); ctl(); }));
    ctl();
    const flame = (x, y, k) => `<path d="M${x} ${y} q${-12 * k} ${-24 * k} 0 ${-50 * k} q${4 * k} ${18 * k} ${14 * k} ${20 * k} q${2 * k} ${-14 * k} ${8 * k} ${-24 * k} q${14 * k} ${30 * k} ${-4 * k} ${54 * k} z" fill="#f97316" opacity="0.9"/>`;
    const draw = (t) => {
      const sec = ((t - t0) / 1000) % 12; let s = '';
      if (view === 'pen') {
        const seal = ($('fiSeal') || {}).value === '1', spread = Math.max(0, Math.min(1, (sec - 2) / 6));
        s += `<rect x="350" y="20" width="60" height="260" fill="#9ca3af"/><text x="330" y="16" fill="#e2e8f0" font-size="12">Fire-rated wall (60 min)</text>`;
        s += `<rect x="0" y="20" width="350" height="260" fill="#431407" opacity="${0.35 + 0.3 * Math.sin(sec * 3) ** 2}"/>${flame(120, 270, 1.4)}${flame(200, 270, 1)}${flame(270, 270, 1.2)}<text x="20" y="40" fill="#fed7aa" font-size="13" font-weight="700">Fire compartment</text><text x="560" y="40" fill="#e2e8f0" font-size="13" font-weight="700">Escape corridor</text>`;
        s += `<rect x="345" y="130" width="70" height="40" fill="${seal ? '#dc2626' : '#0f1a33'}" stroke="#e2e8f0"/>`;
        [140, 150, 160].forEach((y) => (s += `<line x1="0" y1="${y}" x2="760" y2="${y}" stroke="#facc15" stroke-width="5"/>`));
        if (seal) s += `<text x="420" y="200" fill="#fca5a5" font-size="12">Intumescent sealant / pillows – the hole is closed to the wall's rating</text>`;
        else { for (let i = 0; i < 6; i++) { const x = 410 + spread * (60 + i * 50), y = 120 - i * 12 + Math.sin(sec * 2 + i) * 8; s += `<circle cx="${x}" cy="${y}" r="${18 + i * 4}" fill="#64748b" opacity="${0.55 * spread}"/>`; } if (spread > 0.5) s += flame(440, 175, 0.8 * spread); s += `<text x="420" y="230" fill="#fecaca" font-size="12" font-weight="700">Smoke and fire pass through the gap around the cables</text>`; }
        $('fiN').innerHTML = 'Where a wiring system passes through a fire-rated wall or floor, seal the opening to the same fire resistance (Regulation 527.2). This includes the inside of conduit and trunking. After any alteration, re-seal – it is one of the most common defects found in hotel and hospital risers.';
      } else {
        const metal = ($('fiSup') || {}).value === '1', fall = metal ? 0 : Math.max(0, Math.min(1, (sec - 3) / 2));
        s += `<rect x="0" y="0" width="760" height="30" fill="#475569"/><text x="10" y="20" fill="#e2e8f0" font-size="12">Ceiling</text><rect x="0" y="270" width="760" height="30" fill="#334155"/><text x="10" y="290" fill="#e2e8f0" font-size="12">Escape route</text>`;
        s += `<rect x="0" y="0" width="760" height="300" fill="#7c2d12" opacity="${0.15 + 0.15 * Math.sin(sec * 3) ** 2}"/>`;
        for (let i = 0; i < 8; i++) { const x = 40 + i * 92; s += `<rect x="${x}" y="34" width="14" height="14" fill="${metal ? '#cbd5e1' : '#f8fafc'}" opacity="${metal ? 1 : 1 - fall}"/>`; }
        const sag = fall * 200; s += `<path d="M0 46 Q 380 ${46 + sag * 1.4} 760 46" stroke="#facc15" stroke-width="6" fill="none"/>`;
        s += `<g transform="translate(${300 + 40 * Math.sin(sec)},180)"><circle cx="0" cy="0" r="10" fill="#e2e8f0"/><line x1="0" y1="10" x2="0" y2="55" stroke="#e2e8f0" stroke-width="4"/><line x1="0" y1="55" x2="-12" y2="88" stroke="#e2e8f0" stroke-width="4"/><line x1="0" y1="55" x2="12" y2="88" stroke="#e2e8f0" stroke-width="4"/></g>`;
        s += `<text x="420" y="${metal ? 90 : 240}" fill="${metal ? '#bbf7d0' : '#fecaca'}" font-size="13" font-weight="700">${metal ? 'Metal supports hold the cables up' : 'Plastic clips melt – cables fall and trap people'}</text>`;
        $('fiN').innerHTML = 'Wiring systems in escape routes must be supported so they will not collapse early in a fire (Regulation 521.10.202) – non-metallic clips, ties or trunking alone are not enough. Use metal clips, fire-resistant ties or metal cable baskets as the primary support.';
      }
      $('fiS').innerHTML = s; raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw); onStop(() => cancelAnimationFrame(raf));
  };
  W.svgWrap = svgWrap; W.pl = pl; W.tx = tx;
})();
