/* BS 7671 course – widgets 2: the Level 2 simulators (protection layers, touch voltage and body current, Zs check, bonding, SELV,
   overload bars, time–current curves and discrimination, loose terminations, arc faults, SPD risk, cable sizing, voltage drop,
   adiabatic check, RCD types and core balance, earth rods, safety services changeover) */
(function () {
  const tx = W.tx;
  // log–log chart frame: returns { s, X, Y } for currents / times between the limits
  const logFrame = (w, h, x0, x1, y0, y1, xl, yl, pad) => {
    pad = pad || { l: 54, r: 14, t: 14, b: 38 };
    const X = (v) => pad.l + ((Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) * (w - pad.l - pad.r), Y = (v) => h - pad.b - ((Math.log10(v) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0))) * (h - pad.t - pad.b);
    let s = `<rect x="${pad.l}" y="${pad.t}" width="${w - pad.l - pad.r}" height="${h - pad.t - pad.b}" fill="#fff" stroke="#cbd5e1"/>`;
    for (let e = Math.floor(Math.log10(x0)); e <= Math.ceil(Math.log10(x1)); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v < x0 || v > x1) continue; s += `<line x1="${X(v)}" y1="${pad.t}" x2="${X(v)}" y2="${h - pad.b}" stroke="${m === 1 ? '#cbd5e1' : '#eef0f4'}"/>`; if (m === 1 || m === 5) s += `<text x="${X(v) - 8}" y="${h - pad.b + 14}" font-size="10" fill="#64748b">${v >= 1000 ? v / 1000 + 'k' : v}</text>`; }
    for (let e = Math.floor(Math.log10(y0)); e <= Math.ceil(Math.log10(y1)); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v < y0 || v > y1) continue; s += `<line x1="${pad.l}" y1="${Y(v)}" x2="${w - pad.r}" y2="${Y(v)}" stroke="${m === 1 ? '#cbd5e1' : '#eef0f4'}"/>`; if (m === 1) s += `<text x="${pad.l - 6}" y="${Y(v) + 3}" font-size="10" fill="#64748b" text-anchor="end">${v}</text>`; }
    s += `<text x="${(w + pad.l) / 2}" y="${h - 6}" font-size="11" fill="#475569" text-anchor="middle">${xl}</text><text x="12" y="${(h - pad.b + pad.t) / 2}" font-size="11" fill="#475569" text-anchor="middle" transform="rotate(-90 12 ${(h - pad.b + pad.t) / 2})">${yl}</text>`;
    return { s, X, Y };
  };
  const curvePath = (f, X, Y, i0, i1, tmin, tmax) => { let d = '', on = false; for (let k = 0; k <= 240; k++) { const I = i0 * Math.pow(i1 / i0, k / 240), t = f(I); if (!Number.isFinite(t) || t > tmax) { on = false; continue; } const tt = Math.max(tmin, t); d += (on ? 'L' : 'M') + X(I).toFixed(1) + ',' + Y(tt).toFixed(1); on = true; } return d; };
  const devOpts = [['B6', 'B 6 A MCB'], ['B10', 'B 10 A MCB'], ['B16', 'B 16 A MCB'], ['B20', 'B 20 A MCB'], ['B32', 'B 32 A MCB'], ['B40', 'B 40 A MCB'], ['C10', 'C 10 A MCB'], ['C16', 'C 16 A MCB'], ['C20', 'C 20 A MCB'], ['C32', 'C 32 A MCB'], ['C63', 'C 63 A MCB'], ['D16', 'D 16 A MCB'], ['D32', 'D 32 A MCB'], ['F16', 'BS 88 16 A fuse'], ['F32', 'BS 88 32 A fuse'], ['F63', 'BS 88 63 A fuse'], ['F100', 'BS 88 100 A fuse'], ['F160', 'BS 88 160 A fuse']];
  const devOf = (k) => BS.dev(k[0] === 'F' ? 'fuse' : k[0], +k.slice(1));
  W.devOpts = devOpts; W.devOf = devOf; W.logFrame = logFrame; W.curvePath = curvePath;

  // ---------------------------------------------------------------- protection layers: basic, fault, additional
  W.onion = (el) => {
    const L = [['Basic protection', '#2563eb', 'Stops you touching live parts in normal use: insulation of live parts, barriers and enclosures (at least IP2X / IPXXB, top surfaces IP4X / IPXXD). Regulation 416.'], ['Fault protection', '#16a34a', 'If basic insulation fails, exposed metal must not stay at a dangerous voltage: protective earthing, protective equipotential bonding and automatic disconnection of supply (ADS) in the required time. Regulation 411.3.'], ['Additional protection', '#ea580c', 'A back-up in case basic and fault protection fail or someone is careless: 30 mA RCDs (Regulation 415.1) and supplementary bonding (415.2). Never the only protection.'], ['Live part', '#dc2626', 'The conductor at 230 V – the danger the layers keep away from you.']];
    let on = 0;
    const draw = () => { let s = ''; [[190, 2], [140, 1], [92, 0], [40, 3]].forEach(([r, i]) => (s += `<circle cx="210" cy="210" r="${r}" fill="${L[i][1]}" opacity="${on === i ? 0.95 : 0.35}" stroke="#fff" stroke-width="3" data-i="${i}" style="cursor:pointer"/>`)); s += `<text x="210" y="214" text-anchor="middle" fill="#fff" font-weight="700" font-size="13" pointer-events="none">230 V</text>`;
      ['Additional', 'Fault', 'Basic'].forEach((t, k) => (s += `<text x="210" y="${42 + k * 50}" text-anchor="middle" fill="#fff" font-size="12" font-weight="700" pointer-events="none">${t}</text>`));
      el.innerHTML = `<div class="two"><div class="panel" style="background:#0f1a33"><svg viewBox="0 0 420 420">${s}</svg></div><div style="border:1px solid var(--line);border-radius:10px;padding:12px"><b style="color:${L[on][1]}">${L[on][0]}</b><p>${L[on][2]}</p><p class="note">Tap the rings. Each layer must work on its own – an RCD is <b>additional</b> protection, never a replacement for a good earth.</p></div></div>`;
      el.querySelectorAll('[data-i]').forEach((c) => (c.onclick = () => { on = +c.dataset.i; draw(); })); };
    draw();
  };

  // ---------------------------------------------------------------- touch voltage and body current: effect zones (simplified from IEC 60479-1)
  W.touch = (el, o) => {
    el.innerHTML = `<div class="panel"><svg id="toS" viewBox="0 0 720 360"></svg></div><div class="ctl">${sl('toU', 'Touch voltage', 10, 230, 5, o.u || 115, ' V')}${sel('toR', 'Body path and condition', [[2000, 'Hand to feet, dry, shoes – about 2000 Ω'], [1000, 'Hand to hand, dry – about 1000 Ω'], [600, 'Wet hands, bare feet – about 600 Ω']], 1000)}${sel('toT', 'How fast the supply is disconnected', [[0.008, 'MCB instantaneous – under 0.1 s'], [0.04, '30 mA RCD at 5 × IΔn – 40 ms'], [0.3, 'RCD at 1 × IΔn – 300 ms'], [0.4, 'Limit for final circuits – 0.4 s'], [5, 'Distribution circuit limit – 5 s'], [10000, 'Never – no disconnection']], 0.4)}</div><div id="toK"></div><div class="note" id="toN"></div>`;
    const c1 = [[10, 500], [100, 400], [200, 200], [500, 60], [1000, 50], [10000, 40]], b = [[10, 200], [50, 60], [200, 20], [1000, 10], [10000, 10]];
    bind(el, () => {
      const U = num('toU'), R = num('toR'), ms = num('toT') * 1000, I = (U / R) * 1000, f = logFrame(720, 360, 0.1, 5000, 1, 10000, 'Body current (mA)', 'Time (ms)');
      const area = (pts, col, lbl, lx, ly) => `<path d="M${f.X(pts[0][1])},${f.Y(10)} ${pts.map(([t, i]) => `L${f.X(i)},${f.Y(t)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="2.5"/><text x="${lx}" y="${f.Y(ly)}" font-size="11" fill="${col}" font-weight="700">${lbl}</text>`;
      let s = f.s + `<line x1="${f.X(0.5)}" y1="${f.Y(10000)}" x2="${f.X(0.5)}" y2="${f.Y(1)}" stroke="#16a34a" stroke-width="2.5"/><text x="${f.X(0.5) + 4}" y="${f.Y(5)}" font-size="11" fill="#16a34a" font-weight="700">AC-1 felt</text>`;
      s += area(b, '#ca8a04', 'AC-2 let-go limit', f.X(11), 6000) + area(c1, '#dc2626', 'AC-4 fibrillation risk', f.X(65), 2200);
      s += `<text x="${f.X(1.4)}" y="${f.Y(60)}" font-size="11" fill="#64748b">harmless effects</text><text x="${f.X(16)}" y="${f.Y(30)}" font-size="11" fill="#64748b">muscle cramp, cannot let go</text><text x="${f.X(800)}" y="${f.Y(30)}" font-size="11" fill="#7f1d1d">heart may stop</text>`;
      const tms = Math.min(ms, 10000), dang = (() => { let k = 0; while (k < c1.length - 1 && c1[k + 1][0] < tms) k++; const lim = tms <= c1[0][0] ? c1[0][1] : k >= c1.length - 1 ? c1[c1.length - 1][1] : c1[k][1] + ((c1[k + 1][1] - c1[k][1]) * (tms - c1[k][0])) / (c1[k + 1][0] - c1[k][0]); return I >= lim; })();
      s += `<circle cx="${f.X(Math.min(I, 5000))}" cy="${f.Y(Math.max(1, tms))}" r="8" fill="${dang ? '#dc2626' : '#244286'}" stroke="#fff" stroke-width="2"/><text x="${f.X(Math.min(I, 5000)) - 40}" y="${f.Y(Math.max(1, tms)) - 12}" font-size="12" font-weight="700" fill="#14161c">you are here</text>`;
      $('toS').innerHTML = s;
      $('toK').innerHTML = kpi([[fx(I, 0) + ' mA', 'body current = U / R'], [ms >= 10000 ? 'never' : ms + ' ms', 'time to disconnect'], [dang ? 'Danger' : 'Survivable', 'effect zone', dang]]);
      $('toN').innerHTML = `Current through the body is what kills, and how long it flows matters as much as how big it is. ${U > 50 ? 'Above about 50 V AC a dangerous current can flow through a person in normal dry conditions – that is why exposed metal must not stay above 50 V for long and the disconnection times in Table 41.1 exist.' : 'At or below 50 V AC the body current in normal conditions stays low – 50 V is the conventional limit used in BS 7671 (e.g. RA × IΔn ≤ 50 V).'} Try the 30 mA RCD at 40 ms with 230 V and wet hands: the point stays left of the red line. <span class="chk">Curves simplified for teaching.</span>`;
    });
  };

  // ---------------------------------------------------------------- Zs check: maximum Zs from 0.95 × U0 / Ia, the 80 % rule, measured value
  W.zs = (el, o) => {
    el.innerHTML = `<div class="ctl">${sel('zsD', 'Protective device', devOpts, o.dev || 'B32')}${sel('zsT', 'Circuit', [[0.4, 'Final circuit ≤ 63 A (TN, 230 V) – 0.4 s'], [5, 'Distribution circuit / final > 63 A – 5 s']], 0.4)}${sl('zsM', 'Measured Zs', 0.05, 8, 0.01, o.zs || 0.92, ' Ω')}${sel('zsC', 'Measured when the cable was', [['cold', 'Cold (at test, about 20 °C) – use the 80 % rule'], ['hot', 'At operating temperature – compare with 100 %']], 'cold')}</div><div class="two" style="margin-top:8px"><div class="panel"><svg id="zsS" viewBox="0 0 520 300"></svg></div><div id="zsK"></div></div><div class="note" id="zsN"></div>`;
    bind(el, () => {
      const d = devOf($('zsD').value), t = num('zsT'), z = num('zsM'), cold = $('zsC').value === 'cold', Ia = BS.ia(d, t), zmax = BS.zsMax(d, t), lim = cold ? zmax * 0.8 : zmax, ok = z <= lim + 1e-9, If = (230 * 0.95) / z;
      const f = logFrame(520, 300, 5, 10000, 0.005, 10000, 'Current (A)', 'Time (s)');
      let s = f.s + `<path d="${curvePath((I) => BS.tAt(d, I), f.X, f.Y, 5, 10000, 0.005, 10000)}" fill="none" stroke="#244286" stroke-width="3"/>`;
      s += `<line x1="${f.X(5)}" y1="${f.Y(t)}" x2="${f.X(10000)}" y2="${f.Y(t)}" stroke="#ea580c" stroke-dasharray="6 4"/><text x="${f.X(6)}" y="${f.Y(t) - 4}" font-size="11" fill="#ea580c">${t} s limit</text>`;
      s += `<line x1="${f.X(Ia)}" y1="${f.Y(0.005)}" x2="${f.X(Ia)}" y2="${f.Y(10000)}" stroke="#16a34a" stroke-dasharray="4 4"/><text x="${f.X(Ia) + 3}" y="${f.Y(2000)}" font-size="11" fill="#16a34a">Ia ${fx(Ia, 0)} A</text>`;
      s += `<line x1="${f.X(Math.min(If, 9999))}" y1="${f.Y(0.005)}" x2="${f.X(Math.min(If, 9999))}" y2="${f.Y(10000)}" stroke="${ok ? '#16a34a' : '#dc2626'}" stroke-width="3"/><text x="${f.X(Math.min(If, 9999)) + 3}" y="${f.Y(200)}" font-size="11" font-weight="700" fill="${ok ? '#16a34a' : '#dc2626'}">fault ${fx(If, 0)} A</text>`;
      $('zsS').innerHTML = s;
      $('zsK').innerHTML = kpi([[fx(Ia, 0) + ' A', `Ia – current to disconnect in ${t} s`], [fx(zmax, 2) + ' Ω', 'Zs max = 0.95 × 230 / Ia'], [fx(lim, 2) + ' Ω', cold ? 'limit for a cold test (80 %)' : 'limit (hot)'], [z + ' Ω', ok ? 'measured – PASS' : 'measured – FAIL', !ok]]);
      $('zsN').innerHTML = `${d.kind === 'fuse' ? 'For a fuse, Ia is read from its time–current curve at ' + t + ' s (Appendix 3).' : `A Type ${d.kind} MCB disconnects instantly at ${BS.MCB_MULT[d.kind][1]} × In = ${fx(Ia, 0)} A, so 0.4 s and 5 s give the same Ia.`} The 0.95 (Cmin) allows for the supply voltage being lower than 230 V. Conductor resistance rises about 20 % from 20 °C to 70 °C, so a cold reading must be no more than about 80 % of the table value. ${ok ? '' : 'To fix a failing Zs: shorter run, bigger CPC / line conductor, a lower-rated or Type B device – or an RCD where the regulations allow (Regulation 411.4.204 for TN).'} <span class="chk">Compare with Table 41.3 / 41.2 of your copy.</span>`;
    });
  };

  // ---------------------------------------------------------------- protective bonding: tap what must be bonded, size the conductor
  W.bond = (el) => {
    const items = [['Metal water pipe entering the building', true, 'An extraneous-conductive-part: it can bring earth potential into the building. Bond it within 600 mm of where it enters, after the meter (544.1.2).'], ['Metal gas pipe entering the building', true, 'Extraneous-conductive-part – bond on the consumer side of the meter, within 600 mm.'], ['Plastic water pipe entering the building', false, 'Plastic does not conduct – no bonding. Check it does not change to metal inside.'], ['Structural steel frame in the ground', true, 'Exposed structural steel that is in contact with earth is extraneous – bond it.'], ['Lightning protection system down conductor', true, 'Bond as required by the lightning protection design (BS EN 62305) – usually at the MET.'], ['Metal window frame (not connected to anything)', false, 'Not able to introduce a potential – it is not extraneous. Bonding it adds no safety.'], ['Metal kitchen sink on plastic pipes', false, 'Not extraneous – it is isolated from earth by the plastic pipes.'], ['Metal oil pipe from a buried tank', true, 'Extraneous-conductive-part – bond where it enters.'], ['Metal ducting of air conditioning (inside only)', false, 'Only if it can introduce earth potential (e.g. touching the steel frame or outside metalwork). Usually not – test with a long lead: below about 22 kΩ means extraneous.']];
    let pick = new Set();
    el.innerHTML = `<div class="two"><div><div class="chips" id="boI"></div><div class="row" style="margin-top:6px"><span class="btn p s" id="boChk">Check my choices</span><span class="btn s" id="boClr">Clear</span></div><div class="note" id="boOut"></div></div><div style="border:1px solid var(--line);border-radius:10px;padding:12px"><b>Size the main bonding conductor</b><div class="ctl" style="grid-template-columns:1fr">${sel('boSys', 'Earthing system', [['pme', 'TN-C-S (PME)'], ['tns', 'TN-S'], ['tt', 'TT']], 'pme')}${sel('boN', 'Supply neutral / PEN (PME) or earthing conductor (TN-S, TT)', [[16, '16 mm²'], [25, '25 mm²'], [35, '35 mm²'], [50, '50 mm²'], [70, '70 mm²'], [95, '95 mm²'], [120, '120 mm²'], [150, '150 mm²'], [185, '185 mm²']], 25)}</div><div id="boSz"></div></div></div>`;
    const draw = () => { $('boI').innerHTML = items.map(([t], i) => `<span class="tile ${pick.has(i) ? 'sel' : ''}" data-i="${i}">${pick.has(i) ? '🔗 ' : ''}${t}</span>`).join(''); $('boI').querySelectorAll('[data-i]').forEach((x) => (x.onclick = () => { const i = +x.dataset.i; pick.has(i) ? pick.delete(i) : pick.add(i); draw(); })); };
    draw();
    $('boClr').onclick = () => { pick = new Set(); $('boOut').innerHTML = ''; draw(); };
    $('boChk').onclick = () => { let right = 0; $('boOut').innerHTML = items.map(([t, need, why], i) => { const ok = pick.has(i) === need; if (ok) right++; return `${ok ? '<span class="okc">✓</span>' : '<span class="noc">✗</span>'} <b>${t}</b>: ${need ? 'bond' : 'no bond'} – ${why}`; }).join('<br>') + `<p><b>${right} of ${items.length} right.</b></p>`; };
    bind(el, () => {
      const sys = $('boSys').value, n = num('boN');
      const sz = sys === 'pme' ? (n <= 35 ? 10 : n <= 50 ? 16 : n <= 95 ? 25 : n <= 150 ? 35 : 50) : [6, 10, 16, 25].find((x) => x >= n / 2) || 25;
      $('boSz').innerHTML = kpi([[sz + ' mm²', 'copper main protective bonding conductor']]) + `<p class="note">${sys === 'pme' ? 'PME: the size comes from the supply neutral (Table 54.8) – the bonding may carry diverted neutral current if the PEN is lost.' : 'TN-S / TT: at least half the earthing conductor, not less than 6 mm², need not exceed 25 mm² copper (544.1.1).'} Supplementary bonding: at least 2.5 mm² with mechanical protection, 4 mm² without (544.2). <span class="chk">Check Table 54.8 of your copy.</span></p>`;
    });
  };

  // ---------------------------------------------------------------- SELV: why a safety isolating transformer is safe
  W.selv = (el) => {
    el.innerHTML = `<div class="stage"><svg id="seS" viewBox="0 0 760 300"></svg></div><div class="ctl">${sel('seT', 'Source', [['selv', 'Safety isolating transformer – SELV (secondary not earthed)'], ['pelv', 'Safety isolating transformer – PELV (secondary earthed)'], ['auto', 'Autotransformer / ordinary step-down (not isolating)']], 'selv')}${sel('seTouch', 'Person touches', [['one', 'One secondary conductor, standing on the ground'], ['two', 'Both secondary conductors at once']], 'one')}</div><div class="note" id="seN"></div>`;
    let raf, ph = 0;
    const draw = () => {
      ph += 0.05; const t = $('seT').value, two = $('seTouch').value === 'two';
      const danger = t === 'auto' && !two, cur = danger ? 230 / 1500 : two ? 12 / 1000 : t === 'pelv' ? 12 / 1500 : 0;
      let s = `<rect x="0" y="260" width="760" height="40" fill="#3f2d1d"/><circle cx="200" cy="120" r="50" fill="none" stroke="#94a3b8" stroke-width="3"/><circle cx="${t === 'auto' ? 200 : 260}" cy="120" r="50" fill="none" stroke="#94a3b8" stroke-width="3"/>`;
      if (t !== 'auto') s += `<line x1="230" y1="60" x2="230" y2="180" stroke="#f59e0b" stroke-width="3" stroke-dasharray="6 4"/><text x="200" y="200" fill="#fcd34d" font-size="11">earthed screen between windings</text>`;
      s += `<line x1="40" y1="90" x2="150" y2="90" stroke="#a16207" stroke-width="4"/><line x1="40" y1="150" x2="150" y2="150" stroke="#3b82f6" stroke-width="4"/><text x="40" y="80" fill="#e2e8f0" font-size="12">230 V supply</text>`;
      s += `<line x1="310" y1="90" x2="560" y2="90" stroke="#facc15" stroke-width="4"/><line x1="310" y1="150" x2="560" y2="150" stroke="#facc15" stroke-width="4"/><text x="380" y="80" fill="#fde68a" font-size="12">${t === 'auto' ? '12 V – but still connected to the 230 V side' : '12 V – separated from the supply'}</text>`;
      if (t === 'pelv') s += `<line x1="520" y1="150" x2="520" y2="260" stroke="#22c55e" stroke-width="3"/><text x="526" y="220" fill="#86efac" font-size="11">earthed</text>`;
      if (t === 'auto') s += `<line x1="150" y1="150" x2="150" y2="260" stroke="#22c55e" stroke-width="3"/><text x="40" y="240" fill="#86efac" font-size="11">neutral earthed at the source</text>`;
      const hx = 640; s += `<g><circle cx="${hx}" cy="110" r="12" fill="${danger ? '#ef4444' : '#e2e8f0'}"/><line x1="${hx}" y1="122" x2="${hx}" y2="200" stroke="${danger ? '#ef4444' : '#e2e8f0'}" stroke-width="5"/><line x1="${hx}" y1="200" x2="${hx - 14}" y2="260" stroke="#e2e8f0" stroke-width="5"/><line x1="${hx}" y1="200" x2="${hx + 14}" y2="260" stroke="#e2e8f0" stroke-width="5"/><line x1="${hx}" y1="140" x2="560" y2="92" stroke="#e2e8f0" stroke-width="5"/>${two ? `<line x1="${hx}" y1="150" x2="560" y2="150" stroke="#e2e8f0" stroke-width="5"/>` : ''}</g>`;
      if (cur > 0.001) { const k = (ph * 40) % 40; s += `<path d="M560 92 L${hx} 140 L${hx} 200 ${two ? `M${hx} 150 L560 150` : 'L640 260 L150 260 L150 150'}" fill="none" stroke="#fb923c" stroke-width="4" stroke-dasharray="8 12" stroke-dashoffset="${-k}"/>`; }
      s += `<text x="20" y="28" fill="#fff" font-size="15" font-weight="700">${cur > 0.05 ? 'Dangerous current: ' + fx(cur * 1000, 0) + ' mA' : cur > 0.001 ? 'Small current: ' + fx(cur * 1000, 0) + ' mA – below the danger level' : 'No path back to the source – no current'}</text>`;
      $('seS').innerHTML = s; raf = requestAnimationFrame(draw);
      $('seN').innerHTML = t === 'selv' ? 'SELV: an isolated, unearthed source at extra-low voltage (≤ 50 V AC / 120 V ripple-free DC). Touching one conductor gives no circuit, touching both gives only 12 V. Keep SELV circuits separate from other circuits and never earth them (Regulation 414).' : t === 'pelv' ? 'PELV: the same isolated extra-low voltage, but earthed – used where control circuits must be earthed. Touching one conductor and earth gives a small current at 12 V; basic protection is still needed above 25 V AC in dry areas.' : 'An autotransformer or a transformer that is not a safety isolating type does not separate the 12 V side from the supply – a person touching one conductor can be in series with the full 230 V to earth. This is not SELV.';
    };
    raf = requestAnimationFrame(draw); onStop(() => cancelAnimationFrame(raf));
  };

  // ---------------------------------------------------------------- overload: Ib ≤ In ≤ Iz and I2 ≤ 1.45 Iz
  W.ohm = (el) => {
    el.innerHTML = `<div class="ctl">${sl('ohIb', 'Design current Ib', 1, 100, 1, 26, ' A')}${sel('ohIn', 'Device rating In', BS.STD.slice(0, 11).map((x) => [x, x + ' A']), 32)}${sl('ohIz', 'Cable capacity after factors Iz', 5, 140, 0.5, 37, ' A')}${sel('ohDev', 'Device type', [['mcb', 'MCB / RCBO / BS 88 fuse (I2 ≤ 1.45 In)'], ['3036', 'BS 3036 rewireable fuse (I2 = 2 In)']], 'mcb')}</div><div class="panel" style="margin-top:8px"><svg id="ohS" viewBox="0 0 720 230"></svg></div><div class="note" id="ohN"></div>`;
    bind(el, () => {
      const Ib = num('ohIb'), In = num('ohIn'), Iz = num('ohIz'), d3036 = $('ohDev').value === '3036', I2 = (d3036 ? 2 : 1.45) * In, ok1 = Ib <= In, ok2 = In <= Iz, ok3 = I2 <= 1.45 * Iz + 1e-9, mx = Math.max(Ib, In, Iz, I2) * 1.1, X = (v) => 140 + (v / mx) * 540;
      const bar = (y, v, lbl, col) => `<text x="10" y="${y + 18}" font-size="13" fill="#14161c">${lbl}</text><rect x="140" y="${y}" width="${X(v) - 140}" height="26" rx="5" fill="${col}"/><text x="${X(v) + 6}" y="${y + 18}" font-size="13" font-weight="700" fill="#14161c">${fx(v, 1)} A</text>`;
      $('ohS').innerHTML = bar(20, Ib, 'Ib – load', '#64748b') + bar(64, In, 'In – device', ok1 && ok2 ? '#244286' : '#dc2626') + bar(108, Iz, 'Iz – cable', ok2 ? '#16a34a' : '#dc2626') + bar(152, I2, 'I2 – trips at', ok3 ? '#a3a3a3' : '#dc2626') + `<line x1="${X(1.45 * Iz)}" y1="10" x2="${X(1.45 * Iz)}" y2="190" stroke="#ea580c" stroke-dasharray="5 4"/><text x="${Math.min(X(1.45 * Iz) + 4, 600)}" y="210" font-size="12" fill="#ea580c">1.45 × Iz = ${fx(1.45 * Iz, 1)} A</text>`;
      $('ohN').innerHTML = `${ok1 ? '✓' : '✗'} Ib ≤ In (${Ib} ≤ ${In}) – the device must carry the load. ${ok2 ? '✓' : '✗'} In ≤ Iz (${In} ≤ ${Iz}) – the device must protect the cable. ${ok3 ? '✓' : '✗'} I2 ≤ 1.45 Iz – the current that surely trips the device must not overheat the cable (Regulation 433.1.1). ${d3036 ? 'A BS 3036 fuse needs about 2 × In to blow, so the cable must be derated by 0.725 (Cc).' : 'For MCBs and BS 88 fuses, In ≤ Iz automatically meets the third rule.'}`;
    });
  };

  // ---------------------------------------------------------------- time–current curves: one or two devices, a fault current, discrimination
  W.tcc = (el, o) => {
    el.innerHTML = `<div class="ctl">${sel('tcA', 'Downstream device (closer to the load)', devOpts, o.a || 'B16')}${sel('tcB', 'Upstream device (closer to the supply)', [['none', 'None'], ...devOpts], o.b || 'F63')}${sl('tcI', 'Fault current', 10, 6000, 10, o.i || 300, ' A')}</div><div class="panel" style="margin-top:8px"><svg id="tcS" viewBox="0 0 720 420"></svg></div><div id="tcK"></div><div class="note" id="tcN"></div>`;
    bind(el, () => {
      const a = devOf($('tcA').value), bk = $('tcB').value, b = bk === 'none' ? null : devOf(bk), I = num('tcI'), f = logFrame(720, 420, 1, 10000, 0.005, 10000, 'Prospective current (A)', 'Time (s)');
      let s = f.s;
      const band = (d, col) => { const up = curvePath((x) => BS.tAt(d, x), f.X, f.Y, 1, 10000, 0.005, 10000), lo = curvePath((x) => BS.tMin(d, x), f.X, f.Y, 1, 10000, 0.005, 10000); return `<path d="${lo}" fill="none" stroke="${col}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.7"/><path d="${up}" fill="none" stroke="${col}" stroke-width="3"/>`; };
      s += band(a, '#244286'); if (b) s += band(b, '#c2410c');
      s += `<line x1="${f.X(I)}" y1="${f.Y(0.005)}" x2="${f.X(I)}" y2="${f.Y(10000)}" stroke="#16a34a" stroke-width="2.5"/><text x="${f.X(I) + 4}" y="${f.Y(5000)}" font-size="12" fill="#16a34a" font-weight="700">${I} A</text>`;
      s += `<rect x="560" y="22" width="150" height="${b ? 50 : 30}" fill="#fff" stroke="#cbd5e1"/><line x1="570" y1="36" x2="596" y2="36" stroke="#244286" stroke-width="3"/><text x="602" y="40" font-size="11">${a.label}</text>${b ? `<line x1="570" y1="58" x2="596" y2="58" stroke="#c2410c" stroke-width="3"/><text x="602" y="62" font-size="11">${b.label}</text>` : ''}`;
      const ta = BS.tAt(a, I), tb = b ? BS.tMin(b, I) : Infinity;
      let disc = true, firstBad = null; if (b) for (let k = 0; k <= 200; k++) { const x = a.In * Math.pow(10000 / a.In, k / 200); if (x > I) break; const t1 = BS.tAt(a, x), t2 = BS.tMin(b, x); if (Number.isFinite(t1) && t2 <= t1) { disc = false; firstBad = x; break; } }
      if (firstBad) s += `<rect x="${f.X(firstBad)}" y="14" width="${Math.max(0, f.X(I) - f.X(firstBad))}" height="368" fill="#dc2626" opacity="0.08"/>`;
      $('tcS').innerHTML = s;
      $('tcK').innerHTML = kpi([[ta === Infinity ? 'never' : ta < 0.01 ? '< 0.01 s' : fx(ta, 2) + ' s', a.label + ' clears in'], [b ? (tb === Infinity ? 'not affected' : fx(tb, 3) + ' s') : '—', b ? 'upstream starts to operate' : 'no upstream device'], [b ? (disc ? 'Yes' : 'No') : '—', 'discrimination up to ' + I + ' A', b ? !disc : undefined]]);
      $('tcN').innerHTML = `Solid line: the time the device will certainly have cleared the fault; dashed: the earliest it may start to operate. Discrimination (selectivity, Regulation 536.4) means only the device nearest the fault opens – the downstream curve must stay below and left of the upstream band for every current up to the maximum fault current. ${b && !disc ? `Here it is lost from about ${fx(firstBad, 0)} A (shaded): both devices may open.` : ''} MCBs in series rarely discriminate in their instantaneous region – use the maker's selectivity tables. <span class="chk">Curves are teaching models – use Appendix 3 and maker data.</span>`;
    });
  };

  // ---------------------------------------------------------------- loose termination: contact resistance × current² = heat
  W.heat = (el) => {
    el.innerHTML = `<div class="stage"><svg id="heS" viewBox="0 0 760 260"></svg></div><div class="ctl">${sl('heI', 'Load current', 1, 40, 1, 20, ' A')}${sl('heR', 'Contact resistance of the termination', 1, 300, 1, 5, ' mΩ')}</div><div id="heK"></div><div class="note">A good termination is about 1 mΩ. A loose screw, under-tightened terminal or a strand cut back can be 50–300 mΩ. The heat P = I² × R is concentrated in a few cubic millimetres – enough to melt insulation, char the terminal block and start a fire without tripping any MCB. Torque terminals to the maker's value (Regulation 526.1) and check with a thermal camera under load.</div>`;
    let raf, T = 30;
    const draw = () => {
      const I = num('heI'), R = num('heR') / 1000, P = I * I * R, Tt = 30 + P * 28; T += (Tt - T) * 0.03;
      const col = T < 60 ? '#22c55e' : T < 90 ? '#facc15' : T < 150 ? '#f97316' : '#dc2626';
      let s = `<rect x="200" y="70" width="360" height="120" rx="10" fill="#475569"/><text x="210" y="62" fill="#e2e8f0" font-size="12">Terminal block</text><rect x="20" y="118" width="360" height="24" rx="8" fill="#a16207"/><rect x="380" y="114" width="160" height="32" fill="#cbd5e1"/>`;
      s += `<circle cx="390" cy="130" r="${30 + Math.min(70, (T - 30) * 0.5)}" fill="${col}" opacity="0.45"/><circle cx="390" cy="130" r="${18 + Math.min(40, (T - 30) * 0.25)}" fill="${col}" opacity="0.7"/>`;
      if (T > 150) for (let k = 0; k < 5; k++) s += `<circle cx="${370 + k * 12}" cy="${60 - ((performance.now() / 20 + k * 30) % 60)}" r="${8 + k}" fill="#64748b" opacity="0.5"/>`;
      s += `<text x="20" y="230" fill="#fff" font-size="15" font-weight="700">Terminal ${fx(T, 0)} °C · ${fx(P, 1)} W in the joint</text><text x="520" y="230" fill="${col}" font-size="13" font-weight="700">${T < 70 ? 'Normal' : T < 90 ? 'Hot – PVC limit 70 °C exceeded' : T < 150 ? 'Insulation softening' : 'Charring – fire risk'}</text>`;
      $('heS').innerHTML = s; $('heK').innerHTML = kpi([[fx(P, 1) + ' W', 'P = I² × R'], [fx(T, 0) + ' °C', 'joint temperature (estimate)', T > 90]]);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw); onStop(() => cancelAnimationFrame(raf));
  };

  // ---------------------------------------------------------------- arc faults: normal, series and parallel arc current signatures
  W.arc = (el) => {
    el.innerHTML = `<div class="row" style="margin-bottom:6px"><span class="btn s on" data-a="n">Normal load</span><span class="btn s" data-a="s">Series arc – loose / damaged conductor</span><span class="btn s" data-a="p">Parallel arc – L to N or L to E</span></div><div class="stage"><svg id="arS" viewBox="0 0 760 260"></svg></div><div class="note" id="arN"></div>`;
    let mode = 'n', raf, ph = 0;
    el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => { mode = b.dataset.a; el.querySelectorAll('[data-a]').forEach((x) => x.classList.toggle('on', x === b)); }));
    const draw = () => {
      ph += 0.02; let d = '';
      for (let i = 0; i <= 600; i++) { const a = (i / 600) * 6 * Math.PI + ph; let v = Math.sin(a);
        if (mode === 's') { v = Math.abs(v) < 0.25 ? 0 : v * 0.85; v += (Math.random() - 0.5) * 0.18 * (Math.abs(v) > 0 ? 1 : 0); }
        if (mode === 'p') { const burst = Math.sin(a * 0.5 + 1) > 0.7; v = burst ? v * 2.6 + (Math.random() - 0.5) * 0.6 : v; }
        d += (i ? 'L' : 'M') + (40 + i * 1.15).toFixed(1) + ',' + (130 - v * 45).toFixed(1); }
      $('arS').innerHTML = `<line x1="40" y1="130" x2="730" y2="130" stroke="#334155"/><path d="${d}" fill="none" stroke="${mode === 'n' ? '#22c55e' : mode === 's' ? '#facc15' : '#ef4444'}" stroke-width="2.5"/><text x="20" y="28" fill="#fff" font-size="15" font-weight="700">${mode === 'n' ? 'Normal current – smooth sine wave' : mode === 's' ? 'Series arc: flat spots at each zero crossing and high-frequency noise – current is not higher than normal' : 'Parallel arc: sharp bursts of high current, but too short for an MCB to trip'}</text>`;
      raf = requestAnimationFrame(draw);
    };
    $('arN').innerHTML = 'A series arc (a loose connection, a cable crushed by a screw, damaged flex) draws no more current than the load, so MCBs and RCDs cannot see it. An AFDD (arc fault detection device, BS EN 62606) analyses the waveform for these signatures. BS 7671 Regulation 421.1.7 requires AFDDs for single-phase AC final circuits up to 32 A in certain higher-risk premises (high-rise residential, HMOs, purpose-built student accommodation, care homes) and recommends them elsewhere. <span class="chk">Check the current wording of 421.1.7 in your copy (Amendment 4 changed it).</span>';
    raf = requestAnimationFrame(draw); onStop(() => cancelAnimationFrame(raf));
  };

  // ---------------------------------------------------------------- surge protection: is an SPD needed (443.4 / 443.5 risk assessment), which type
  W.spd = (el) => {
    el.innerHTML = `<div class="two"><div class="ctl" style="grid-template-columns:1fr">${sel('spCon', 'What could a surge lead to?', [['life', 'Serious injury or loss of life (hospital, care home)'], ['pub', 'Interruption of public services or cultural heritage'], ['com', 'Interruption of commercial or industrial activity'], ['many', 'Many people in one place (stadium, mall, hotel)'], ['other', 'None of these – ordinary building']], 'other')}${sel('spEnv', 'Environment', [[85, 'Rural or suburban (fenv 85)'], [850, 'Urban (fenv 850)']], 85)}${sl('spAL', 'Overhead LV line to the building (LPAL)', 0, 1, 0.05, 0.3, ' km')}${sl('spCL', 'Underground LV cable (LPCL)', 0, 1, 0.05, 0.2, ' km')}${sl('spAH', 'Overhead HV line (LPAH)', 0, 5, 0.1, 1, ' km')}${sl('spCH', 'Underground HV cable (LPCH)', 0, 5, 0.1, 0, ' km')}${sl('spNg', 'Ground flash density Ng', 0.5, 30, 0.5, 12, ' /km²/yr')}${sel('spLps', 'Lightning protection system (LPS) on the building', [['0', 'No'], ['1', 'Yes']], '0')}</div><div id="spOut" style="border:1px solid var(--line);border-radius:10px;padding:12px"></div></div>`;
    bind(el, () => {
      const con = $('spCon').value, fenv = num('spEnv'), LP = 2 * num('spAL') + num('spCL') + 0.4 * num('spAH') + 0.2 * num('spCH'), Ng = num('spNg'), lps = $('spLps').value === '1', CRL = LP > 0 ? fenv / (LP * Ng) : Infinity;
      const must = con !== 'other', need = must || CRL < 1000;
      $('spOut').innerHTML = `<h5 style="margin:0 0 6px;font-size:15px">Surge protection</h5>${must ? '<p><b>Required</b> – the consequence of an overvoltage is one of the listed cases (Regulation 443.4), no risk calculation needed.</p>' : `${kpi([[fx(LP, 2) + ' km', 'LP = 2 LPAL + LPCL + 0.4 LPAH + 0.2 LPCH'], [CRL === Infinity ? '∞' : fx(CRL, 0), 'CRL = fenv / (LP × Ng)', CRL < 1000]])}<p>${CRL < 1000 ? '<b>CRL below 1000 → SPDs are required.</b>' : 'CRL is 1000 or more → SPDs are not required by the risk assessment (they may still be good practice).'}</p>`}
        ${need ? `<p><b>Which type:</b> ${lps || num('spAL') > 0 ? 'Type 1 (or combined Type 1+2) at the origin – the building has an LPS or an overhead line can bring partial lightning current.' : 'Type 2 at the origin.'} Add Type 3 near sensitive equipment more than about 10 m from the Type 2. Keep SPD connecting leads as short as possible – ideally under 0.5 m in total (Regulation 534.4.8).</p>` : ''}<p class="note">Values in the formula as given in Section 443 (2018 edition). <span class="chk">Check against your copy.</span></p>`;
    });
  };

  // ---------------------------------------------------------------- cable sizing workbench: rating factors and the smallest cable that carries In
  W.cable = (el, o) => {
    const types = Object.keys(BS.CABLES);
    el.innerHTML = `<div class="ctl">${sel('cbT', 'Cable', types.map((k) => [k, BS.CABLES[k].name]), o.type || 'te')}${sel('cbM', 'Installation method', [], '')}${sel('cbP', 'Circuit', [['1', 'Single-phase (2 loaded conductors)'], ['3', 'Three-phase (3 loaded conductors)']], '1')}${sel('cbIn', 'Protective device rating In', BS.STD.slice(0, 13).map((x) => [x, x + ' A']), o.In || 32)}${sl('cbTa', 'Ambient temperature', 25, 60, 1, o.ta || 35, ' °C')}${sl('cbN', 'Circuits grouped together', 1, 12, 1, o.n || 1)}${sel('cbG', 'Grouping arrangement', [['bunched', 'Bunched / enclosed'], ['wall', 'Single layer on a wall'], ['tray', 'Single layer on a perforated tray']], o.arr || 'bunched')}${sel('cbCi', 'Surrounded by thermal insulation', BS.CI.map((c) => [c[0], c[2] + ' (Ci ' + c[1] + ')']), 0)}${sel('cbCc', 'Device', [['1', 'MCB / RCBO / BS 88 (Cc 1)'], ['0.725', 'BS 3036 rewireable fuse (Cc 0.725)']], '1')}</div><div class="panel" style="margin-top:8px"><svg id="cbS" viewBox="0 0 720 300"></svg></div><div id="cbK"></div><div class="note" id="cbN"></div>`;
    const fillM = () => { const c = BS.CABLES[$('cbT').value], ms = Object.keys(c.methods), cur = $('cbM').value; $('cbM').innerHTML = ms.map((m) => `<option value="${m}"${m === (ms.includes(cur) ? cur : o.method && ms.includes(o.method) ? o.method : 'C') ? ' selected' : ''}>${BS.METHOD_NAMES[m]}</option>`).join(''); if (!ms.includes($('cbM').value)) $('cbM').value = ms[0]; };
    fillM(); $('cbT').addEventListener('input', fillM);
    bind(el, () => {
      const c = BS.CABLES[$('cbT').value], m = $('cbM').value, three = $('cbP').value === '3', tab = (three && c.methods3 && c.methods3[m]) || c.methods[m], In = num('cbIn');
      const Ca = BS.ca(num('cbTa'), c.ins), Cg = BS.cg(num('cbN'), m === 'C' || m === 'E' ? $('cbG').value : 'bunched'), Ci = BS.ci(num('cbCi')), Cc = num('cbCc'), F = Ca * Cg * Ci * Cc, It = In / F;
      const k = tab.findIndex((v) => v != null && v >= It - 1e-9), size = k >= 0 ? c.sizes[k] : null;
      const n = Math.min(tab.length, c.sizes.length, 12), bw = 600 / n, mx = Math.max(It, ...tab.slice(0, n).filter((v) => v != null)) * 1.08, Y = (v) => 250 - (v / mx) * 220;
      let s = `<line x1="60" y1="250" x2="700" y2="250" stroke="#94a3b8"/>`;
      for (let i = 0; i < n; i++) { const v = tab[i]; if (v == null) continue; const x = 70 + i * bw, iz = v * F, okk = iz >= In;
        s += `<rect x="${x}" y="${Y(v)}" width="${bw * 0.7}" height="${250 - Y(v)}" fill="#e2e8f0"/><rect x="${x}" y="${Y(iz)}" width="${bw * 0.7}" height="${250 - Y(iz)}" fill="${i === k ? '#244286' : okk ? '#86efac' : '#fca5a5'}"/><text x="${x + bw * 0.35}" y="268" font-size="11" text-anchor="middle" fill="#475569">${c.sizes[i]}</text><text x="${x + bw * 0.35}" y="${Y(v) - 4}" font-size="10" text-anchor="middle" fill="#64748b">${v}</text>`; }
      s += `<line x1="60" y1="${Y(In)}" x2="700" y2="${Y(In)}" stroke="#ea580c" stroke-width="2" stroke-dasharray="6 4"/><text x="696" y="${Y(In) - 4}" font-size="11" fill="#ea580c" text-anchor="end">In = ${In} A</text><line x1="60" y1="${Y(It)}" x2="700" y2="${Y(It)}" stroke="#7c3aed" stroke-width="2"/><text x="64" y="${Y(It) + 14}" font-size="11" fill="#7c3aed">It needed = ${fx(It, 1)} A</text><text x="380" y="290" font-size="11" text-anchor="middle" fill="#475569">Cable size (mm²) – grey: table value It · colour: Iz after factors</text>`;
      $('cbS').innerHTML = s;
      $('cbK').innerHTML = kpi([[fx(Ca, 2), 'Ca ambient'], [fx(Cg, 2), 'Cg grouping'], [fx(Ci, 2), 'Ci insulation'], [fx(Cc, 3), 'Cc device'], [fx(It, 1) + ' A', 'It ≥ In / (Ca Cg Ci Cc)'], [size ? size + ' mm²' : 'none', size ? `smallest cable – Iz ${fx(tab[k] * F, 1)} A` : 'no size in this method', !size]]);
      $('cbN').innerHTML = `The table gives the current a cable can carry in standard conditions (30 °C, alone). Divide the device rating by every factor that applies to find the tabulated value It you need, then pick the first size at or above it (Appendix 4). Then check voltage drop and Zs – the cable may need to be bigger still. <span class="chk">Ratings as in the Design Tools catalogue (Appendix 4 tables) – check against your copy.</span>`;
    });
  };

  // ---------------------------------------------------------------- voltage drop along a run
  W.vd = (el, o) => {
    el.innerHTML = `<div class="ctl">${sel('vdT', 'Cable', Object.keys(BS.CABLES).map((k) => [k, BS.CABLES[k].short]), o.type || 'te')}${sel('vdS', 'Size', [], '')}${sel('vdP', 'Circuit', [['1', 'Single-phase'], ['3', 'Three-phase']], '1')}${sl('vdI', 'Design current Ib', 1, 200, 1, o.ib || 20, ' A')}${sl('vdL', 'Length of run', 5, 300, 5, o.len || 40, ' m')}${sel('vdU', 'Load and supply', [['3', 'Lighting, public supply – 3 %'], ['5', 'Other uses, public supply – 5 %'], ['6', 'Lighting, private supply – 6 %'], ['8', 'Other uses, private supply – 8 %']], o.lim || '5')}</div><div class="panel" style="margin-top:8px"><svg id="vdSv" viewBox="0 0 720 260"></svg></div><div id="vdK"></div><div class="note" id="vdN"></div>`;
    const fill = () => { const c = BS.CABLES[$('vdT').value], cur = +$('vdS').value || o.size || 4; $('vdS').innerHTML = c.sizes.map((z) => `<option value="${z}"${z === (c.sizes.includes(cur) ? cur : c.sizes[2]) ? ' selected' : ''}>${z} mm²</option>`).join(''); };
    fill(); $('vdT').addEventListener('input', fill);
    bind(el, () => {
      const c = BS.CABLES[$('vdT').value], z = num('vdS'), i = c.sizes.indexOf(z), three = $('vdP').value === '3', mv1 = c.mv ? c.mv[i] : (c.mv3[i] * 2) / Math.sqrt(3), mv = three ? (c.mv3 ? c.mv3[i] : (mv1 * Math.sqrt(3)) / 2) : mv1, Ib = num('vdI'), Lm = num('vdL'), lim = num('vdU'), U = three ? 400 : 230;
      const vd = (mv * Ib * Lm) / 1000, pct = (100 * vd) / U, maxL = ((lim / 100) * U * 1000) / (mv * Ib), X = (l) => 60 + (l / 300) * 630, Y = (p) => 220 - (p / 12) * 200;
      let s = `<rect x="60" y="20" width="630" height="200" fill="#fff" stroke="#cbd5e1"/>`; for (let p = 0; p <= 12; p += 2) s += `<line x1="60" y1="${Y(p)}" x2="690" y2="${Y(p)}" stroke="#eef0f4"/><text x="54" y="${Y(p) + 4}" font-size="10" text-anchor="end" fill="#64748b">${p}%</text>`;
      for (let l = 0; l <= 300; l += 50) s += `<text x="${X(l)}" y="236" font-size="10" text-anchor="middle" fill="#64748b">${l} m</text>`;
      s += `<line x1="60" y1="${Y(lim)}" x2="690" y2="${Y(lim)}" stroke="#dc2626" stroke-dasharray="6 4"/><text x="66" y="${Y(lim) - 4}" font-size="11" fill="#dc2626">limit ${lim} %</text>`;
      const lEnd = Math.min(300, (12 * U * 1000) / 100 / (mv * Ib));
      s += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(lEnd)}" y2="${Y((mv * Ib * lEnd) / 1000 / U * 100)}" stroke="#244286" stroke-width="3"/>`;
      s += `<circle cx="${X(Lm)}" cy="${Y(Math.min(12, pct))}" r="7" fill="${pct <= lim ? '#16a34a' : '#dc2626'}" stroke="#fff" stroke-width="2"/><text x="${X(Lm) + 10}" y="${Y(Math.min(12, pct)) + 4}" font-size="12" font-weight="700">${fx(pct, 2)} %</text>`;
      $('vdSv').innerHTML = s;
      $('vdK').innerHTML = kpi([[mv + ' mV/A/m', 'tabulated voltage drop'], [fx(vd, 2) + ' V', 'VD = mV/A/m × Ib × L / 1000'], [fx(pct, 2) + ' %', `of ${U} V`, pct > lim], [fx(maxL, 0) + ' m', 'longest run within the limit']]);
      $('vdN').innerHTML = `Voltage drop grows in a straight line with current and length. Appendix 4 suggests 3 % for lighting and 5 % for other uses from a public LV supply (6 % and 8 % from a private supply) – the drop is measured from the origin, so the submain's share counts too. Too much drop: lights dim, motors start badly, LED drivers may drop out. <span class="chk">mV/A/m values as in the Design Tools catalogue.</span>`;
    });
  };

  // ---------------------------------------------------------------- adiabatic check: k²S² ≥ I²t
  W.adia = (el, o) => {
    el.innerHTML = `<div class="ctl">${sl('adI', 'Fault current I', 100, 6000, 50, o.i || 1000, ' A')}${sel('adD', 'Device (sets the time t)', devOpts, o.dev || 'C32')}${sel('adK', 'Protective conductor', [[115, 'In a 70 °C PVC cable – k 115'], [143, 'In a 90 °C XLPE cable – k 143'], [143, 'Separate PVC-insulated copper – k 143'], [176, 'Separate XLPE-insulated copper – k 176']], 115)}${sel('adS', 'Protective conductor size S', [1, 1.5, 2.5, 4, 6, 10, 16, 25].map((x) => [x, x + ' mm²']), o.s || 1.5)}</div><div class="panel" style="margin-top:8px"><svg id="adSv" viewBox="0 0 720 170"></svg></div><div id="adK2"></div><div class="note" id="adN"></div>`;
    bind(el, () => {
      const I = num('adI'), d = devOf($('adD').value), k = num('adK'), S = num('adS'), t = Math.max(0.01, Math.min(5, BS.tAt(d, I))), i2t = I * I * t, k2s2 = k * k * S * S, Smin = Math.sqrt(i2t) / k, ok = k2s2 >= i2t, mx = Math.max(i2t, k2s2) * 1.1, X = (v) => 180 + (v / mx) * 500;
      $('adSv').innerHTML = `<text x="10" y="48" font-size="13">I²t – energy let through</text><rect x="180" y="30" width="${X(i2t) - 180}" height="28" rx="5" fill="#ea580c"/><text x="${X(i2t) + 6}" y="49" font-size="12" font-weight="700">${fx(i2t / 1000, 1)} kA²s</text><text x="10" y="108" font-size="13">k²S² – what S can take</text><rect x="180" y="90" width="${X(k2s2) - 180}" height="28" rx="5" fill="${ok ? '#16a34a' : '#dc2626'}"/><text x="${X(k2s2) + 6}" y="109" font-size="12" font-weight="700">${fx(k2s2 / 1000, 1)} kA²s</text><text x="10" y="150" font-size="12" fill="#475569">t = ${BS.tAt(d, I) === Infinity ? 'never – device does not trip (capped at 5 s)' : fx(t, 3) + ' s from the ' + d.label + ' curve'}</text>`;
      $('adK2').innerHTML = kpi([[fx(t, 3) + ' s', 'disconnection time t'], [fx(Smin, 2) + ' mm²', 'S ≥ √(I²t) / k'], [S + ' mm²', ok ? 'chosen – OK' : 'chosen – too small', !ok]]);
      $('adN').innerHTML = `During a fault the protective conductor heats up before the device opens. The adiabatic equation (Regulation 543.1.3) checks it does not get hot enough to damage its insulation: S = √(I²t) / k. k depends on the conductor material and insulation (Tables 54.2–54.6). Alternatively choose the CPC from Table 54.7 (same as the line conductor up to 16 mm², then 16 mm² up to 35 mm², then half). Very short MCB times give small I²t – long fuse times need bigger CPCs. <span class="chk">k values as in the 2018 tables – check your copy.</span>`;
    });
  };

  // ---------------------------------------------------------------- RCDs: core balance and which type sees which residual current waveform
  W.rcd = (el, o) => {
    el.innerHTML = `<div class="row" style="margin-bottom:6px"><span class="btn s ${o.view === 'type' ? '' : 'on'}" data-v="core">How an RCD works</span><span class="btn s ${o.view === 'type' ? 'on' : ''}" data-v="type">RCD types and waveforms</span></div><div class="stage"><svg id="rcS" viewBox="0 0 760 300"></svg></div><div class="ctl" id="rcC"></div><div id="rcK"></div><div class="note" id="rcN"></div>`;
    let view = o.view || 'core', raf, ph = 0;
    const WAVES = [['ac', 'Sinusoidal AC – heaters, lighting', [1, 1, 1, 1]], ['hw', 'Pulsating DC – single-phase rectifier, LED drivers, IT equipment', [0, 1, 1, 1]], ['mf', 'Mixed frequency – single-phase variable speed drives (inverter AC units, pumps)', [0, 0, 1, 1]], ['dc', 'Smooth DC – three-phase drives, EV chargers, PV inverters', [0, 0, 0, 1]]];
    const ctl = () => { $('rcC').innerHTML = view === 'core' ? sl('rcL', 'Leakage to earth', 0, 40, 1, 0, ' mA') + sel('rcIdn', 'Rated residual current IΔn', [[30, '30 mA'], [100, '100 mA'], [300, '300 mA']], 30) : sel('rcW', 'Residual current waveform from the load', WAVES.map((w) => [w[0], w[1]]), 'hw'); bind($('rcC'), () => {}); };
    el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { view = b.dataset.v; el.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b)); ctl(); }));
    ctl();
    const draw = () => {
      ph += 0.08; let s = '';
      if (view === 'core') {
        const leak = num('rcL'), idn = num('rcIdn'), trip = leak >= idn * 0.75, k = (ph * 30) % 40;
        s += `<ellipse cx="300" cy="150" rx="70" ry="90" fill="none" stroke="#94a3b8" stroke-width="18"/><text x="230" y="270" fill="#cbd5e1" font-size="12">toroid core with sensing coil</text>`;
        s += `<line x1="40" y1="130" x2="720" y2="130" stroke="#a16207" stroke-width="5"/><line x1="40" y1="170" x2="${leak > 0 ? 560 : 720}" y2="170" stroke="#3b82f6" stroke-width="5"/><text x="40" y="122" fill="#fcd34d" font-size="12">L – current out ${fx(10 + leak / 1000, 3)} A</text><text x="40" y="190" fill="#93c5fd" font-size="12">N – current back ${fx(10, 3)} A</text>`;
        s += `<path d="M40 130 L720 130" stroke="#fb923c" stroke-width="3" stroke-dasharray="8 12" stroke-dashoffset="${-k}"/><path d="M720 170 L40 170" stroke="#60a5fa" stroke-width="3" stroke-dasharray="8 12" stroke-dashoffset="${-k}"/>`;
        if (leak > 0) s += `<line x1="560" y1="130" x2="560" y2="280" stroke="#22c55e" stroke-width="3"/><path d="M560 130 L560 280" stroke="#22c55e" stroke-width="3" stroke-dasharray="6 10" stroke-dashoffset="${-k}"/><text x="568" y="250" fill="#86efac" font-size="12">${leak} mA leaking to earth</text>`;
        s += `<rect x="390" y="30" width="110" height="50" rx="8" fill="${trip ? '#dc2626' : '#1e293b'}" stroke="#cbd5e1"/><text x="445" y="60" text-anchor="middle" fill="#fff" font-size="13" font-weight="700">${trip ? 'TRIP' : 'balanced'}</text><line x1="370" y1="110" x2="400" y2="80" stroke="#cbd5e1" stroke-width="2"/>`;
        $('rcK').innerHTML = kpi([[leak + ' mA', 'residual current (L − N)'], [`${idn / 2}–${idn} mA`, 'trips somewhere in this band'], [trip ? 'Trips' : 'Holds', 'result', trip]]);
        $('rcN').innerHTML = 'Line and neutral both pass through the core. When everything that goes out comes back, their magnetic fields cancel. Current leaking to earth (through a fault – or a person) unbalances them, the coil sees the difference and trips the RCD. An RCD must trip at IΔn and must not trip below IΔn / 2. It does not limit the current through you – it limits the time.';
      } else {
        const w = WAVES.find((x) => x[0] === $('rcW').value); let d = '';
        for (let i = 0; i <= 500; i++) { const a = (i / 500) * 6 * Math.PI + ph; let v = Math.sin(a);
          if (w[0] === 'hw') v = Math.max(0, v); if (w[0] === 'mf') v = 0.6 * Math.sin(a) + 0.4 * Math.sin(a * 7.3); if (w[0] === 'dc') v = 0.75 + 0.03 * Math.sin(a * 6);
          d += (i ? 'L' : 'M') + (40 + i * 1.36).toFixed(1) + ',' + (110 - v * 60).toFixed(1); }
        s += `<line x1="40" y1="110" x2="720" y2="110" stroke="#334155"/><path d="${d}" fill="none" stroke="#B0D035" stroke-width="3"/>`;
        ['AC', 'A', 'F', 'B'].forEach((t, k) => { const ok = w[2][k]; s += `<rect x="${60 + k * 170}" y="210" width="150" height="60" rx="10" fill="${ok ? '#14532d' : '#7f1d1d'}" stroke="#cbd5e1"/><text x="${135 + k * 170}" y="238" text-anchor="middle" fill="#fff" font-size="16" font-weight="800">Type ${t}</text><text x="${135 + k * 170}" y="258" text-anchor="middle" fill="#fff" font-size="12">${ok ? 'detects it ✓' : 'may not trip ✗'}</text>`; });
        $('rcK').innerHTML = '';
        $('rcN').innerHTML = 'Electronic loads produce residual currents that are not pure sine waves. Type AC only sees sinusoidal AC; Type A adds pulsating DC; Type F adds mixed frequencies; Type B also sees smooth DC. Smooth DC above about 6 mA can blind a Type AC or A RCD upstream, so it does not trip even for a real shock. Choose the type from the loads (Regulation 531.3.3) – Type AC only for fixed loads known to have no DC component. EV chargers: Type B, or Type A plus a 6 mA DC detecting device (RDC-DD).';
      }
      $('rcS').innerHTML = s; raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw); onStop(() => cancelAnimationFrame(raf));
  };

  // ---------------------------------------------------------------- earth electrodes: resistance of a rod vs soil, length, number of rods
  W.rod = (el) => {
    el.innerHTML = `<div class="ctl">${sel('roRho', 'Soil', [[30, 'Wet clay / marsh – about 30 Ω·m'], [100, 'Loam / garden soil – about 100 Ω·m'], [300, 'Laterite / sandy clay – about 300 Ω·m'], [1000, 'Dry sand / gravel – about 1000 Ω·m'], [3000, 'Rock – about 3000 Ω·m']], 100)}${sl('roL', 'Rod length driven', 1.2, 6, 0.3, 2.4, ' m')}${sl('roD', 'Rod diameter', 12, 20, 1, 16, ' mm')}${sl('roN', 'Number of rods (spaced at least their length apart)', 1, 6, 1, 1)}</div><div class="panel" style="margin-top:8px"><svg id="roS" viewBox="0 0 720 260"></svg></div><div id="roK"></div><div class="note" id="roN2"></div>`;
    bind(el, () => {
      const rho = num('roRho'), Lr = num('roL'), dm = num('roD') / 1000, n = num('roN'), R1 = (L) => (rho / (2 * Math.PI * L)) * (Math.log((8 * L) / dm) - 1), R = (R1(Lr) / n) * (n > 1 ? 1.15 : 1);
      const X = (L) => 60 + ((L - 1) / 5) * 630, mx = R1(1) * 1.1, Y = (r) => 220 - (Math.min(r, mx) / mx) * 190; let d = '';
      for (let L = 1; L <= 6.001; L += 0.1) d += (L === 1 ? 'M' : 'L') + X(L).toFixed(1) + ',' + Y(R1(L) / n * (n > 1 ? 1.15 : 1)).toFixed(1);
      let s = `<rect x="60" y="20" width="630" height="200" fill="#fff" stroke="#cbd5e1"/><path d="${d}" fill="none" stroke="#244286" stroke-width="3"/>`;
      [1, 2, 3, 4, 5, 6].forEach((L) => (s += `<text x="${X(L)}" y="236" font-size="10" text-anchor="middle" fill="#64748b">${L} m</text>`));
      s += `<line x1="60" y1="${Y(200)}" x2="690" y2="${Y(200)}" stroke="#ea580c" stroke-dasharray="6 4"/><text x="66" y="${Y(200) - 4}" font-size="11" fill="#ea580c">200 Ω – above this it may not be stable</text>`;
      s += `<circle cx="${X(Lr)}" cy="${Y(R)}" r="7" fill="#16a34a" stroke="#fff" stroke-width="2"/><text x="${X(Lr) + 10}" y="${Y(R) - 6}" font-size="12" font-weight="700">${fx(R, 0)} Ω</text><text x="375" y="254" font-size="11" text-anchor="middle" fill="#475569">Rod length – the curve flattens: longer helps less and less</text>`;
      $('roS').innerHTML = s;
      $('roK').innerHTML = kpi([[fx(R, 0) + ' Ω', 'electrode resistance RA (estimate)'], [fx(R * 0.03, 1) + ' V', 'RA × 30 mA – must be ≤ 50 V', R * 0.03 > 50], [R <= 200 ? 'OK' : 'High', 'stability guidance (≤ 200 Ω)', R > 200]]);
      $('roN2').innerHTML = `Single rod: R = ρ / (2πL) × (ln(8L/d) − 1). Resistance depends mostly on the soil – and soil dries out and changes with the season, so measure in the dry season and allow a margin. With a 30 mA RCD almost any electrode meets RA × IΔn ≤ 50 V (up to 1667 Ω), but values above about 200 Ω may not be stable. Use rods, tapes or plates (Regulation 542.2); water and gas pipes must not be used as the earth electrode.`;
    });
  };

  // ---------------------------------------------------------------- safety services: supply fails, the safety source takes over within its class
  W.emerg = (el) => {
    el.innerHTML = `<div class="stage"><svg id="emS" viewBox="0 0 760 260"></svg></div><div class="ctl">${sel('emSrc', 'Safety source', [['bat', 'Central battery (no-break / ≤ 0.5 s)'], ['self', 'Self-contained emergency luminaires'], ['gen', 'Standby generator (≤ 15 s)']], 'bat')}<div><label>Mains supply</label><select id="emOn"><option value="1">On</option><option value="0">Fails now</option></select></div></div><div class="note" id="emN"></div>`;
    let raf, tFail = null;
    $('emOn').addEventListener('input', () => { tFail = $('emOn').value === '0' ? performance.now() : null; });
    const draw = (now) => {
      const src = $('emSrc').value, t = tFail ? (now - tFail) / 1000 : -1, delay = src === 'gen' ? 12 : src === 'bat' ? 0.3 : 0.2, on = !tFail || t >= delay;
      let s = `<rect x="0" y="0" width="760" height="260" fill="${tFail ? (on ? '#0b1220' : '#000') : '#1e293b'}"/>`;
      for (let i = 0; i < 6; i++) { const lit = !tFail || (on && i % 2 === 0); s += `<rect x="${60 + i * 115}" y="40" width="70" height="14" rx="4" fill="${lit ? '#fef9c3' : '#334155'}"/>${lit ? `<path d="M${60 + i * 115} 54 l-30 150 h130 l-30 -150 z" fill="#fef9c3" opacity="${tFail ? 0.18 : 0.25}"/>` : ''}`; }
      s += `<rect x="600" y="180" width="120" height="44" rx="6" fill="#16a34a"/><text x="660" y="207" text-anchor="middle" fill="#fff" font-size="14" font-weight="700">EXIT →</text>`;
      s += `<text x="20" y="245" fill="#fff" font-size="14" font-weight="700">${!tFail ? 'Normal supply' : on ? `Safety source on after ${fx(Math.min(t, delay), 1)} s – escape lighting (every second luminaire)` : `Dark: ${fx(t, 1)} s since the supply failed…`}</text>`;
      $('emS').innerHTML = s; raf = requestAnimationFrame(draw);
      $('emN').innerHTML = 'Safety services (Chapter 56) must keep working when the normal supply fails: emergency escape lighting, fire alarm, fire-fighting lifts, smoke extraction. BS 7671 classes the changeover by time: no-break, very short (≤ 0.15 s), short (≤ 0.5 s), medium (≤ 15 s) and long (> 15 s). Escape lighting must come on fast enough for its use (BS 5266 / EN 1838) – a 12 s generator start alone is too slow for escape routes in a theatre, so central batteries or self-contained luminaires cover the gap. Safety circuits must be separate and fire-resistant (Regulation 560.8).';
    };
    raf = requestAnimationFrame(draw); onStop(() => cancelAnimationFrame(raf));
  };
})();
