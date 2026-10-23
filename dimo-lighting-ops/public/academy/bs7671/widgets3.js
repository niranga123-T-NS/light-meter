/* BS 7671 course – widgets 3: the Level 3 simulators (circuit design wizard, ring vs radial and diversity, test instrument simulator
   with the graded fault-finding assessment, defect hunt on a distribution board, 3D zones for bathrooms and pools, PV and EV charging,
   prosumer energy flows, Amendment 4 before / after) */
(function () {

  // ---------------------------------------------------------------- circuit design wizard: Ib → In → It → size → VD → CPC → Zs → adiabatic
  W.design = (el, o) => {
    const P = Object.assign({ kind: 'light', kw: 2.2, pf: 0.95, ph: '1', len: 45, type: 'te', method: 'C', ta: 35, n: 1, ci: 0, dev: 'B', ze: 0.35, lim: 3 }, o);
    el.innerHTML = `<div class="ctl">${sel('dsK', 'Circuit', [['light', 'Lighting (VD limit 3 %)'], ['sock', 'Sockets / power (VD limit 5 %)'], ['sub', 'Submain to a board (allow 1.5–2 %)']], P.kind)}${sl('dsP', 'Load', 0.2, 60, 0.1, P.kw, ' kW')}${sl('dsPf', 'Power factor', 0.7, 1, 0.01, P.pf)}${sel('dsPh', 'Supply to the circuit', [['1', 'Single-phase 230 V'], ['3', 'Three-phase 400 V']], P.ph)}${sl('dsL', 'Length', 5, 250, 1, P.len, ' m')}${sel('dsT', 'Cable', Object.keys(BS.CABLES).map((k) => [k, BS.CABLES[k].short]), P.type)}${sel('dsM', 'Method', [], P.method)}${sl('dsTa', 'Ambient', 25, 55, 1, P.ta, ' °C')}${sl('dsN', 'Grouped circuits', 1, 12, 1, P.n)}${sel('dsCi', 'Thermal insulation around it', BS.CI.map((c) => [c[0], c[2]]), P.ci)}${sel('dsD', 'Device type', [['B', 'Type B MCB / RCBO'], ['C', 'Type C MCB / RCBO'], ['D', 'Type D MCB'], ['fuse', 'BS 88 gG fuse']], P.dev)}${sl('dsZe', 'Ze at the board', 0.05, 1.5, 0.01, P.ze, ' Ω')}</div><div id="dsOut" style="margin-top:8px"></div>`;
    const fillM = () => { const c = BS.CABLES[$('dsT').value], ms = Object.keys(c.methods), cur = $('dsM').value || P.method; $('dsM').innerHTML = ms.map((m) => `<option value="${m}"${m === (ms.includes(cur) ? cur : ms.includes('C') ? 'C' : ms[0]) ? ' selected' : ''}>${BS.METHOD_NAMES[m]}</option>`).join(''); };
    fillM(); $('dsT').addEventListener('input', fillM);
    bind(el, () => {
      const kind = $('dsK').value, kw = num('dsP'), pf = num('dsPf'), three = $('dsPh').value === '3', Lm = num('dsL'), c = BS.CABLES[$('dsT').value], m = $('dsM').value, ze = num('dsZe'), dk = $('dsD').value;
      const lim = kind === 'light' ? 3 : kind === 'sock' ? 5 : 2, U = three ? 400 : 230, Ib = three ? (kw * 1000) / (Math.sqrt(3) * 400 * pf) : (kw * 1000) / (230 * pf), In = BS.nextStd(Ib), d = BS.dev(dk, In);
      const tab = (three && c.methods3 && c.methods3[m]) || c.methods[m], F = BS.ca(num('dsTa'), c.ins) * BS.cg(num('dsN'), m === 'C' || m === 'E' ? 'wall' : 'bunched') * BS.ci(num('dsCi')), It = In / F;
      const rows = []; let k0 = tab.findIndex((v) => v != null && v >= It - 1e-9);
      rows.push(['Design current Ib', three ? `${kw} kW / (√3 × 400 × ${pf})` : `${kw} kW / (230 × ${pf})`, fx(Ib, 1) + ' A', true]);
      rows.push(['Device In ≥ Ib', 'next standard rating', d.label, true]);
      rows.push(['Tabulated It ≥ In / factors', `${In} / (${fx(F, 3)})`, fx(It, 1) + ' A', true]);
      if (k0 < 0) { rows.push(['Size for current', 'no size in this table is big enough', '—', false]); return out(rows, null); }
      rows.push(['Size for current', `first size with It ≥ ${fx(It, 1)} A`, c.sizes[k0] + ' mm² (' + tab[k0] + ' A)', true]);
      const mvOf = (i) => (three ? (c.mv3 ? c.mv3[i] : (c.mv[i] * Math.sqrt(3)) / 2) : c.mv ? c.mv[i] : (c.mv3[i] * 2) / Math.sqrt(3));
      let k = k0; while (k < c.sizes.length - 1 && (mvOf(k) * Ib * Lm) / 1000 / U * 100 > lim) k++;
      const vdp = (mvOf(k) * Ib * Lm) / 1000 / U * 100;
      rows.push(['Voltage drop ≤ ' + lim + ' %', `${mvOf(k)} mV/A/m × ${fx(Ib, 1)} A × ${Lm} m`, fx(vdp, 2) + ' %' + (k > k0 ? ` → upsized to ${c.sizes[k]} mm²` : ''), vdp <= lim]);
      const zsFor = (kk) => { const S = c.sizes[kk], cpc = $('dsT').value === 'te' ? c.cpc[S] : S <= 16 ? S : S <= 35 ? 16 : S / 2; const cp = BS.R20[cpc] ? cpc : S; return { S, cpc: cp, zs: ze + BS.r12(S, cp, c.ins) * Lm }; };
      const zmax = BS.zsMax(d, kind === 'sub' ? 5 : 0.4); let z = zsFor(k); while (z.zs > zmax && k < c.sizes.length - 1 && BS.R20[c.sizes[k + 1]]) { k++; z = zsFor(k); }
      rows.push(['Earth loop Zs ≤ max', `Ze ${ze} + (R1+R2) ${fx(BS.r12(z.S, z.cpc, c.ins) * 1000, 1)} mΩ/m × ${Lm} m (hot)`, `${fx(z.zs, 2)} Ω ≤ ${fx(zmax, 2)} Ω` + (z.S > c.sizes[Math.max(k0, 0)] && z.S !== c.sizes[k] ? '' : ''), z.zs <= zmax]);
      const If = (0.95 * 230) / z.zs, t = Math.max(0.01, Math.min(5, BS.tAt(d, If))), Smin = Math.sqrt(If * If * t) / c.k;
      rows.push(['Protective conductor (adiabatic)', `√(${fx(If, 0)}² × ${fx(t, 3)}) / ${c.k}`, `${fx(Smin, 2)} mm² needed – CPC ${z.cpc} mm²`, Smin <= z.cpc]);
      out(rows, z);
      function out(rs, zz) { const ok = rs.every((r) => r[3]);
        $('dsOut').innerHTML = `<div class="tablewrap"><table class="spec"><tr><th>Check</th><th>Working</th><th>Result</th><th></th></tr>${rs.map(([a, b, v, okk]) => `<tr><td>${a}</td><td>${b}</td><td><b>${v}</b></td><td>${okk ? '<span class="okc">✓</span>' : '<span class="noc">✗</span>'}</td></tr>`).join('')}</table></div>${zz ? kpi([[zz.S + ' mm²', 'line conductors'], [zz.cpc + ' mm²', 'CPC'], [d.label, 'protection'], [ok ? 'Complies' : 'Check', 'design result', !ok]]) : ''}<p class="note">${ok ? 'Every check passes. Record Ib, In, size, Zs and VD on the design schedule – the same steps the Design Tools cable engine runs for every circuit.' : 'One check fails – change the method, length, device or add an RCD (for Zs, where the regulations allow it).'} Size up for voltage drop and Zs is automatic here; in real life also consider cost, space in containment and future load. <span class="chk">Teaching values – check against Appendix 4 and Table 41.3.</span></p>`; }
    });
  };

  // ---------------------------------------------------------------- ring final vs radial, and diversity / maximum demand
  W.ring = (el, o) => {
    el.innerHTML = `<div class="row" style="margin-bottom:6px"><span class="btn s ${o.view === 'div' ? '' : 'on'}" data-v="ring">Ring vs radial</span><span class="btn s ${o.view === 'div' ? 'on' : ''}" data-v="div">Diversity and maximum demand</span></div><div id="rgB"></div>`;
    let view = o.view || 'ring', raf, ph = 0;
    const show = () => {
      cancelAnimationFrame(raf);
      if (view === 'ring') {
        $('rgB').innerHTML = `<div class="stage"><svg id="rgS" viewBox="0 0 760 300"></svg></div><div class="ctl">${sl('rgP', 'Where the load is on the ring', 0.05, 0.95, 0.05, 0.5)}${sl('rgI', 'Load current', 1, 32, 1, 26, ' A')}</div><div class="note">A ring final (2.5 mm² line / neutral, 1.5 mm² CPC, 32 A device) feeds each socket from both ends, so the current splits. A load in the middle shares equally; near one end most current takes the short leg. That is why loads should be spread round the ring and heavy fixed loads (water heaters, ovens) get their own radial circuits. The On-Site Guide suggests a ring serves up to about 100 m² of floor area; a 20 A radial on 2.5 mm² serves about 50 m², a 32 A radial on 4 mm² about 75 m². <span class="chk">Appendix 15 / On-Site Guide.</span></div>`;
        const draw = () => { ph += 0.06; const p = num('rgP'), I = num('rgI'), a = I * (1 - p), b = I * p, cx = 380, cy = 160, rx = 260, ry = 100, k = (ph * 30) % 40;
          let s = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#a16207" stroke-width="6"/><rect x="${cx - 40}" y="${cy + ry - 14}" width="80" height="34" rx="5" fill="#1e293b" stroke="#cbd5e1"/><text x="${cx}" y="${cy + ry + 8}" text-anchor="middle" fill="#fff" font-size="12">32 A</text>`;
          for (let i = 1; i < 10; i++) { const t = Math.PI / 2 + (i / 10) * 2 * Math.PI, x = cx + rx * Math.cos(t), y = cy + ry * Math.sin(t); s += `<rect x="${x - 10}" y="${y - 10}" width="20" height="20" rx="3" fill="#e2e8f0"/>`; }
          const t = Math.PI / 2 + p * 2 * Math.PI, lx = cx + rx * Math.cos(t), ly = cy + ry * Math.sin(t);
          s += `<circle cx="${lx}" cy="${ly}" r="16" fill="#f97316"/><text x="${lx}" y="${ly + 4}" text-anchor="middle" fill="#fff" font-size="11" font-weight="700">${I} A</text>`;
          s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#fb923c" stroke-width="${2 + a / 3}" stroke-dasharray="8 12" stroke-dashoffset="${-k}" opacity="0.8" pathLength="1000"/>`;
          s += `<text x="40" y="40" fill="#fdba74" font-size="14" font-weight="700">Left leg ${fx(b, 1)} A · right leg ${fx(a, 1)} A</text><text x="40" y="60" fill="#cbd5e1" font-size="12">Each 2.5 mm² leg is rated about 27 A clipped direct – the two together protect a 32 A circuit</text>`;
          $('rgS').innerHTML = s; raf = requestAnimationFrame(draw); };
        bind($('rgB'), () => {}); raf = requestAnimationFrame(draw);
      } else {
        const loads = [['Lighting', 'light', 2.4], ['Socket circuits (number)', 'sock', 4], ['Cooker (kW)', 'cook', 10], ['Storage water heater (kW)', 'wh', 3], ['Air conditioners (kW each, number 3)', 'ac', 1.5], ['Instant shower (kW)', 'sh', 9.5]];
        $('rgB').innerHTML = `<div class="ctl">${loads.map(([t, k, v]) => sl('dv' + k, t, 0, k === 'sock' ? 8 : 15, k === 'sock' ? 1 : 0.1, v, k === 'sock' ? '' : ' kW')).join('')}</div><div id="dvOut"></div>`;
        bind($('rgB'), () => {
          const g = (k) => num('dv' + k), A = (kw) => (kw * 1000) / 230;
          const r = [['Lighting', A(g('light')), 0.66 * A(g('light')), '66 % of the total'], ['Sockets', g('sock') * 32, g('sock') ? 32 + (g('sock') - 1) * 32 * 0.4 : 0, '100 % of the largest circuit + 40 % of every other'], ['Cooker', A(g('cook')), g('cook') ? Math.min(A(g('cook')), 10 + 0.3 * Math.max(0, A(g('cook')) - 10) + 5) : 0, '10 A + 30 % of the rest + 5 A for a socket on the cooker unit'], ['Water heater', A(g('wh')), A(g('wh')), '100 % – no diversity'], ['Air conditioners', 3 * A(g('ac')), A(g('ac')) + 0.5 * 2 * A(g('ac')), '100 % of the largest + 50 % of the rest (heating / cooling)'], ['Instant shower', A(g('sh')), A(g('sh')), '100 % – no diversity']];
          const conn = r.reduce((t, x) => t + x[1], 0), md = r.reduce((t, x) => t + x[2], 0);
          $('dvOut').innerHTML = `<div class="tablewrap"><table class="spec"><tr><th>Load</th><th>Connected</th><th>After diversity</th><th>Rule used</th></tr>${r.map(([a, b, c2, d2]) => `<tr><td>${a}</td><td>${fx(b, 1)} A</td><td><b>${fx(c2, 1)} A</b></td><td>${d2}</td></tr>`).join('')}</table></div>${kpi([[fx(conn, 0) + ' A', 'total connected'], [fx(md, 0) + ' A', 'maximum demand (after diversity)'], [md <= 63 ? '63 A OK' : '> 63 A', 'single-phase 63 A supply', md > 63]])}<p class="note">Not every load runs at full power at the same time, so the supply and the main switch are sized for the maximum demand, not the sum. The allowances above are the typical household figures from the On-Site Guide – commercial buildings use the designer's own assessment (Regulation 311.1). Circuits themselves are never reduced by diversity below their own load.</p>`;
        });
      }
    };
    el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { view = b.dataset.v; el.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b)); show(); }));
    show(); onStop(() => cancelAnimationFrame(raf));
  };

  // ---------------------------------------------------------------- test instrument simulator: ring continuity, insulation resistance, polarity, Ze / Zs / PFC, RCD
  const FAULTS = [['open_l', 'The ring line conductor is open (broken) somewhere'], ['open_cpc', 'The ring CPC is open somewhere'], ['pol', 'One socket has line and neutral reversed (polarity)'], ['hr', 'A high-resistance (loose) joint at one socket'], ['ir_ln', 'Insulation between line and neutral is too low'], ['ir_e', 'Insulation between live conductors and earth is too low'], ['zs', 'Zs at the far end of the circuit is too high'], ['ze', 'Ze of the supply is far higher than expected'], ['rcd', 'The RCD trips too slowly at its rated current'], ['none_rcd_btn', 'The RCD test button does not work']];
  W.tester = (el, o) => {
    const assess = !!o.assess, fset = new Set();
    if (assess) { const pool = FAULTS.map((f) => f[0]).sort(() => Math.random() - 0.5); pool.slice(0, 2 + Math.floor(Math.random() * 3)).forEach((f) => fset.add(f)); } else if (o.fault) fset.add(o.fault);
    let mode = o.mode || 'ring', link = 'none', volts = 500, disc = false, log = [], sockets = 10, hrAt = 6, polAt = 3, rcdState = 'on';
    const r1 = 0.37, rn = 0.37, r2 = 0.61, OL = '> 1999 Ω';
    const has = (f) => fset.has(f);
    const tabs = [['ring', 'Ring continuity'], ['ir', 'Insulation resistance'], ['live', 'Ze, Zs, PFC'], ['rcd', 'RCD']];
    el.innerHTML = `${assess ? '<p class="note" style="margin-top:0">A ring final circuit (2.5 / 1.5 mm² twin and earth, about 50 m, Type B 32 A RCBO, TN-C-S) has between two and four hidden faults. Run the tests you need, then tick the faults you found. Score out of 10: the share of the faults you found, less half a fault for every wrong tick – 7 passes.</p>' : ''}<div class="row" id="tsTabs">${tabs.map(([k, t]) => `<span class="btn s ${k === mode ? 'on' : ''}" data-m="${k}">${t}</span>`).join('')}${!assess && !o.fault ? '<span class="btn s" id="tsFault">Hide a random fault</span>' : ''}</div><div class="two" style="margin-top:8px"><div><div class="stage" style="padding:12px;color:#e2e8f0"><div style="background:#0b1220;border:2px solid #334155;border-radius:12px;padding:14px;font-family:ui-monospace,Menlo,monospace"><div style="font-size:12px;color:#94a3b8" id="tsMode"></div><div style="font-size:34px;color:#B0D035;font-weight:700;margin:6px 0" id="tsRead">– – –</div><div style="font-size:12px;color:#94a3b8" id="tsSub">Choose a test below</div></div></div><div id="tsCtl" style="margin-top:8px"></div></div><div><b>Results recorded</b><div class="tablewrap"><table class="spec" id="tsLog"></table></div></div></div>${assess ? `<div style="margin-top:12px"><b>Which of these did you find?</b>${FAULTS.map(([k, t]) => `<label style="display:flex;gap:8px;padding:3px 0"><input type="checkbox" data-f="${k}"> ${t}</label>`).join('')}<span class="btn p" id="tsSubmit">Submit my findings</span></div>` : ''}<div class="note" id="tsN"></div>`;
    const show = (v, sub) => { $('tsRead').textContent = v; $('tsSub').textContent = sub; };
    const rec = (t, v, okk) => { log.push([t, v, okk]); $('tsLog').innerHTML = `<tr><th>Test</th><th>Reading</th></tr>` + log.slice(-14).map(([a, b, c]) => `<tr><td>${a}</td><td><b style="color:${c === false ? 'var(--bad)' : 'inherit'}">${b}</b></td></tr>`).join(''); };
    const ringRead = (kind, i) => {
      if (kind === 'ee') return { l: has('open_l') ? OL : fx(r1, 2) + ' Ω', n: fx(rn, 2) + ' Ω', e: has('open_cpc') ? OL : fx(r2, 2) + ' Ω' };
      const p = i / sockets, base = kind === 'ln' ? (r1 + rn) / 4 : (r1 + r2) / 4, open = kind === 'ln' ? has('open_l') : has('open_l') || has('open_cpc');
      if (kind === 'le' && has('pol') && i === polAt) return OL;
      let v = open ? base + 0.9 * Math.min(p, 1 - p) * 2 * base : base;
      if (has('hr') && Math.abs(i - hrAt) <= 1) v += i === hrAt ? 0.25 : 0.1;
      return fx(v + (Math.random() - 0.5) * 0.004, 2) + ' Ω';
    };
    const ctl = () => {
      $('tsMode').textContent = { ring: 'Ω  LOW-RESISTANCE OHMMETER', ir: 'MΩ  INSULATION TESTER', live: 'LOOP  Zs / PFC', rcd: 'RCD  TRIP TIME' }[mode];
      if (mode === 'ring') $('tsCtl').innerHTML = `<div class="m" style="font-size:12px">Step 1 – end-to-end of each conductor at the board</div><div class="chips"><span class="btn s" data-t="ee">Measure r1, rn, r2</span></div><div class="m" style="font-size:12px">Step 2 / 3 – cross-connect the ends, then measure at every socket</div><div class="chips"><span class="btn s ${link === 'ln' ? 'on' : ''}" data-k="ln">Cross-connect L with N</span><span class="btn s ${link === 'le' ? 'on' : ''}" data-k="le">Cross-connect L with CPC</span></div><div class="chips">${Array.from({ length: sockets - 1 }, (_, i) => `<span class="btn s" data-s="${i + 1}">Socket ${i + 1}</span>`).join('')}</div>`;
      if (mode === 'ir') $('tsCtl').innerHTML = `<div class="ctl">${sel('tsV', 'Test voltage', [[250, '250 V DC'], [500, '500 V DC'], [1000, '1000 V DC']], volts)}<div><label><input type="checkbox" id="tsDisc" ${disc ? 'checked' : ''}> Lamps removed, SPD and electronic equipment disconnected</label></div></div><div class="chips"><span class="btn s" data-i="ln">Test L – N</span><span class="btn s" data-i="le">Test L+N – E</span></div>`;
      if (mode === 'live') $('tsCtl').innerHTML = `<div class="chips"><span class="btn s" data-z="ze">Ze at the origin (main earthing conductor disconnected, installation isolated)</span><span class="btn s" data-z="zs">Zs at the furthest socket</span><span class="btn s" data-z="pfc">PFC at the origin</span></div>`;
      if (mode === 'rcd') $('tsCtl').innerHTML = `<div class="chips"><span class="btn s" data-r="half">½ × IΔn (15 mA) – must not trip</span><span class="btn s" data-r="one">1 × IΔn (30 mA)</span><span class="btn s" data-r="five">5 × IΔn (150 mA)</span><span class="btn s" data-r="ramp">Ramp test</span><span class="btn s" data-r="btn">Press the test button</span><span class="btn s" data-r="reset">Reset the RCD</span></div>`;
      $('tsCtl').querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { const r = ringRead('ee'); show(`${r.l} | ${r.n} | ${r.e}`, 'r1 | rn | r2 end to end'); rec('End-to-end r1 / rn / r2', `${r.l} / ${r.n} / ${r.e}`, !(has('open_l') || has('open_cpc'))); }));
      $('tsCtl').querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { link = b.dataset.k; ctl(); show('– – –', 'Linked ' + (link === 'ln' ? 'L–N' : 'L–CPC') + ' at the board – now test each socket'); }));
      $('tsCtl').querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { if (link === 'none') { show('– – –', 'Cross-connect the ring ends first'); return; } const i = +b.dataset.s, v = ringRead(link, i); show(v, `Socket ${i}: ${link === 'ln' ? 'L–N' : 'L–CPC'}`); rec(`Socket ${i} ${link === 'ln' ? 'L–N' : 'L–E'}`, v); }));
      $('tsCtl').querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { if (!$('tsV')) return; volts = num('tsV'); disc = $('tsDisc').checked; const k = b.dataset.i; let v, note = '';
        if (volts !== 500) note = 'Wrong test voltage – a 230 V circuit is tested at 500 V DC (Table 64). ';
        if (!disc) { v = k === 'ln' ? '0.02 MΩ' : '0.85 MΩ'; note += 'Something is still connected (lamps, LED drivers, an SPD) – it gives a false low reading and may be damaged.'; }
        else v = k === 'ln' ? (has('ir_ln') ? '0.31 MΩ' : '> 299 MΩ') : has('ir_e') ? '0.42 MΩ' : '> 299 MΩ';
        show(v, `${k === 'ln' ? 'L–N' : 'L+N–E'} at ${volts} V`); rec(`IR ${k === 'ln' ? 'L–N' : 'L+N–E'} @${volts} V${disc ? '' : ' (not disconnected)'}`, v, parseFloat(v) >= 1 || v.startsWith('>')); $('tsN').textContent = note || 'Minimum 1 MΩ at 500 V for circuits up to 500 V (Table 64) – a healthy new circuit reads hundreds of MΩ.'; }));
      $('tsCtl').querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => { const k = b.dataset.z, ze = has('ze') ? 1.85 : 0.33, r12 = (r1 + r2) / 4 + (has('hr') ? 0.25 : 0) + (has('zs') ? 1.1 : 0), zs = ze + r12;
        if (k === 'ze') { show(fx(ze, 2) + ' Ω', 'Ze'); rec('Ze', fx(ze, 2) + ' Ω', ze <= 0.35); }
        if (k === 'zs') { show(fx(zs, 2) + ' Ω', 'Zs at socket 5 (furthest point)'); rec('Zs furthest point', fx(zs, 2) + ' Ω', zs <= 1.09); $('tsN').textContent = 'Type B 32 A: Zs max 1.37 Ω, 1.09 Ω for a cold test (80 %).'; }
        if (k === 'pfc') { const kA = 230 / ze / 1000; show(fx(kA, 2) + ' kA', 'PFC at the origin'); rec('PFC', fx(kA, 2) + ' kA'); } }));
      $('tsCtl').querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { const k = b.dataset.r;
        if (k === 'reset') { rcdState = 'on'; show('ON', 'RCD reset'); return; }
        if (rcdState === 'off') { show('– – –', 'The RCD is off – reset it first'); return; }
        if (k === 'btn') { if (has('none_rcd_btn')) { show('no trip', 'Test button pressed'); rec('Test button', 'did not trip', false); } else { rcdState = 'off'; show('TRIPPED', 'Test button pressed'); rec('Test button', 'tripped'); } return; }
        if (k === 'half') { show('no trip', '15 mA for 2 s'); rec('½ × IΔn', 'no trip ✓'); return; }
        const t = k === 'one' ? (has('rcd') ? 412 : 23) : k === 'five' ? (has('rcd') ? 46 : 11) : null;
        rcdState = 'off';
        if (k === 'ramp') { const ma = has('rcd') ? 29 : 21; show(ma + ' mA', 'Trip current (ramp)'); rec('Ramp', ma + ' mA'); return; }
        show(t + ' ms', k === 'one' ? '1 × IΔn (30 mA)' : '5 × IΔn (150 mA)'); rec(k === 'one' ? '1 × IΔn' : '5 × IΔn', t + ' ms', k === 'one' ? t <= 300 : t <= 40);
        $('tsN').textContent = 'Required test (Regulation 643.8): at IΔn – a general RCD must trip within 300 ms. The ½ × and 5 × tests and the ramp are useful for fault finding.'; }));
    };
    el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m; link = 'none'; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); ctl(); show('– – –', 'Choose a test below'); }));
    if ($('tsFault')) $('tsFault').onclick = () => { fset.clear(); fset.add(FAULTS[Math.floor(Math.random() * FAULTS.length)][0]); log = []; rec('— new circuit —', 'a fault is hidden'); $('tsN').innerHTML = 'A fault is hidden in this circuit. Test until you find it – then <span class="btn s" id="tsReveal">reveal it</span>'; $('tsReveal').onclick = () => { $('tsN').textContent = 'The hidden fault: ' + FAULTS.find((f) => fset.has(f[0]))[1] + '.'; }; };
    if (assess) $('tsSubmit').onclick = () => { let tp = 0, fp = 0; const lines = FAULTS.map(([k, t]) => { const said = el.querySelector(`[data-f="${k}"]`).checked, ok = said === has(k); if (said && has(k)) tp++; if (said && !has(k)) fp++; return `${ok ? '<span class="okc">✓</span>' : '<span class="noc">✗</span>'} ${t} – ${has(k) ? 'present' : 'not present'}`; });
      const score = Math.max(0, Math.round((10 * (tp - 0.5 * fp)) / fset.size));
      $('tsN').innerHTML = lines.join('<br>') + `<p><b>${tp} of ${fset.size} faults found, ${fp} wrong tick${fp === 1 ? '' : 's'} → ${score} / 10.</b></p>`; $('tsSubmit').remove(); if (o.done) o.done(score, 10); };
    ctl();
  };

  // ---------------------------------------------------------------- defect hunt: tap the defects on a distribution board
  W.photo = (el) => {
    const D = [[110, 70, 'A blank is missing – a gap in the cover lets fingers reach live parts (IP2X / IPXXB not met)'], [430, 60, 'No circuit chart / labelling inside the door (Regulation 514.9)'], [300, 210, 'Bare copper showing outside the terminal – conductor not fully inserted'], [520, 220, 'CPC with no green-and-yellow sleeving'], [200, 330, 'Cable sheath stops outside the enclosure – the cores are unprotected'], [610, 320, 'Cable through a sharp hole in the metal case – no grommet / gland'], [640, 120, 'No RCD test notice (Regulation 514.12.2)'], [80, 260, 'Main earth missing its "Safety electrical connection – do not remove" label (514.13)'], [420, 160, 'Neutral of one circuit in the wrong RCD bank – will cause nuisance tripping']];
    let found = new Set(), miss = 0;
    const draw = () => {
      let s = `<rect x="40" y="30" width="660" height="340" rx="14" fill="#e5e7eb" stroke="#64748b" stroke-width="4"/><rect x="70" y="50" width="600" height="60" rx="6" fill="#cbd5e1"/>`;
      for (let i = 0; i < 14; i++) { const x = 80 + i * 42; if (i === 1) { s += `<rect x="${x}" y="54" width="34" height="52" fill="#0f172a"/><rect x="${x + 8}" y="60" width="4" height="40" fill="#a16207"/>`; continue; } s += `<rect x="${x}" y="54" width="34" height="52" rx="3" fill="${i < 2 ? '#fde68a' : i === 7 ? '#bfdbfe' : '#fff'}" stroke="#64748b"/><rect x="${x + 12}" y="66" width="10" height="16" fill="#334155"/>`; }
      s += `<rect x="100" y="150" width="540" height="22" fill="#a16207" opacity="0.4"/><rect x="100" y="190" width="540" height="22" fill="#2563eb" opacity="0.35"/><text x="110" y="166" font-size="11">L busbar</text><text x="110" y="206" font-size="11">N bars (two RCD banks)</text>`;
      s += `<rect x="60" y="240" width="90" height="20" fill="#16a34a"/><text x="66" y="254" font-size="11" fill="#fff">MET</text>`;
      s += `<path d="M300 212 L300 300" stroke="#a16207" stroke-width="5"/><rect x="294" y="206" width="12" height="10" fill="#fbbf24"/><path d="M520 212 L520 330" stroke="#94a3b8" stroke-width="4"/><path d="M180 300 L180 400" stroke="#64748b" stroke-width="16"/><path d="M174 300 L170 345 M186 300 L190 345" stroke="#a16207" stroke-width="4"/><circle cx="610" cy="330" r="14" fill="#0f172a"/><path d="M610 330 L610 400" stroke="#475569" stroke-width="10"/><path d="M420 172 Q 430 190 400 190" stroke="#2563eb" stroke-width="3" fill="none"/>`;
      found.forEach((i) => (s += `<circle cx="${D[i][0]}" cy="${D[i][1]}" r="22" fill="none" stroke="#16a34a" stroke-width="4"/>`));
      el.innerHTML = `<div class="panel"><svg id="phS" viewBox="0 0 740 410" style="cursor:crosshair">${s}</svg></div>${kpi([[`${found.size} / ${D.length}`, 'defects found'], [miss, 'taps on nothing']])}<div class="note">${[...found].map((i) => '✓ ' + D[i][2]).join('<br>') || 'Tap anything that would fail an inspection.'}</div>${found.size === D.length ? '<p class="okc">All found – these are the defects inspectors find most often on DIMO jobs.</p>' : '<span class="btn s" id="phShow">Show the ones I missed</span>'}`;
      $('phS').onclick = (e) => { const pt = $('phS').createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform($('phS').getScreenCTM().inverse()); const i = D.findIndex(([x, y]) => Math.hypot(p.x - x, p.y - y) < 34); if (i >= 0) found.add(i); else miss++; draw(); };
      if ($('phShow')) $('phShow').onclick = () => { D.forEach((_, i) => found.add(i)); draw(); };
    };
    draw();
  };

  // ---------------------------------------------------------------- 3D zones: bathroom (bath, walk-in shower) and swimming pool, rotatable
  W.zones = (el, o) => {
    el.innerHTML = `<div class="row" style="margin-bottom:6px">${[['bath', 'Bathroom with a bath'], ['shower', 'Walk-in shower (no tray)'], ['pool', 'Swimming pool']].map(([k, t]) => `<span class="btn s ${k === (o.mode || 'bath') ? 'on' : ''}" data-z="${k}">${t}</span>`).join('')}</div><div class="two"><div class="stage"><svg id="znS" viewBox="0 0 520 400" style="touch-action:none;cursor:grab"></svg></div><div id="znI" style="border:1px solid var(--line);border-radius:10px;padding:12px"></div></div><div class="ctl">${sl('znY', 'Turn', -180, 180, 1, 35, '°')}${sl('znP', 'Tilt', 10, 70, 1, 30, '°')}</div><div class="note">Drag the picture or use the sliders to turn it. Tap a zone (or the list) for its rules. <span class="chk">Dimensions as in Sections 701 / 702 – check your copy.</span></div>`;
    let mode = o.mode || 'bath', on = 0;
    const SETS = {
      bath: { room: [3, 2.5, 2.6], zones: [['Zone 0', [0, 0, 0], [1.7, 0.75, 0.5], '#2563eb', 'Inside the bath. Only SELV at no more than 12 V AC / 30 V ripple-free DC, source outside the zones; equipment IPX7 and made for zone 0.'], ['Zone 1', [0, 0, 0], [1.7, 0.75, 2.25], '#16a34a', 'Above the bath up to 2.25 m from the floor. Only fixed equipment made for zone 1 (e.g. a shower pump, water heater, SELV luminaire); IPX4 minimum; switches only SELV ≤ 12 V.'], ['Zone 2', [0, 0, 0], [2.3, 1.35, 2.25], '#ca8a04', '0.6 m beyond zone 1, up to 2.25 m. IPX4 minimum. No socket-outlets except SELV and shaver supply units to BS EN 61558-2-5.'], ['Outside the zones', [0, 0, 0], [3, 2.5, 2.6], '#64748b', 'Normal equipment allowed, but socket-outlets at least 3 m horizontally from the boundary of zone 1 (Regulation 701.512.3). All circuits in the room: 30 mA RCD (701.411.3.3). Supplementary bonding may be left out if all circuits have RCDs, ADS is met and the main bonding is in place (701.415.2).']], fixt: [[0, 0, 0], [1.7, 0.75, 0.55]] },
      shower: { room: [3, 2.5, 2.6], zones: [['Zone 0', [0, 0, 0], [1.2, 1.2, 0.1], '#2563eb', 'The floor area where water collects (up to 10 cm where there is no tray). SELV ≤ 12 V only, IPX7.'], ['Zone 1', [0, 0, 0], [1.2, 1.2, 2.25], '#16a34a', 'For a shower without a tray: 1.2 m horizontally from the fixed water outlet on the wall or ceiling, up to 2.25 m. IPX4, only fixed equipment for zone 1.'], ['Zone 2', [0, 0, 0], [1.8, 1.8, 2.25], '#ca8a04', 'For a walk-in shower there is usually no zone 2 – the larger zone 1 covers it. Shown here only to compare: the rules of zone 2 are the same as a bathroom.'], ['Outside the zones', [0, 0, 0], [3, 2.5, 2.6], '#64748b', 'Sockets 3 m from zone 1, 30 mA RCD for every circuit in the room.']], fixt: [[0, 0, 0], [0.9, 0.9, 0.04]] },
      pool: { room: [12, 8, 3], zones: [['Zone 0', [2, 2, -1.2], [10, 6, 0], '#2563eb', 'Inside the basin, its wall openings and water jets. SELV at no more than 12 V AC / 30 V DC with the source outside zones 0, 1 and 2; underwater luminaires to BS EN 60598-2-18; IPX8.'], ['Zone 1', [0, 0, 0], [12, 8, 2.5], '#16a34a', '2 m horizontally from the rim and up to 2.5 m above the floor (or any diving board / slide). SELV, or fixed pool equipment protected as Section 702 allows; IPX5 where water jets are used for cleaning.'], ['Zone 2', [-1.5, -1.5, 0], [13.5, 9.5, 2.5], '#ca8a04', 'A further 1.5 m beyond zone 1 (indoor pools may have no zone 2). Socket-outlets only with SELV, electrical separation or a 30 mA RCD; IPX4 (IPX5 if hosed).'], ['Outside the zones', [-1.5, -1.5, 0], [13.5, 9.5, 3], '#64748b', 'Supplementary bonding connects all extraneous-conductive-parts in zones 0, 1 and 2 to the protective conductors (702.415.2).']], fixt: null }
    };
    let yaw = 35, pitch = 30, drag = null;
    const P3 = (x, y, z, S) => { const [W0, D0] = S.room, cx = W0 / 2, cy = D0 / 2, sc = mode === 'pool' ? 22 : 80, a = (yaw * Math.PI) / 180, b = (pitch * Math.PI) / 180; const X = x - cx, Y = y - cy; const xr = X * Math.cos(a) - Y * Math.sin(a), yr = X * Math.sin(a) + Y * Math.cos(a); return [260 + xr * sc, 250 + (yr * Math.sin(b) - z * Math.cos(b)) * sc, yr * Math.cos(b) + z * Math.sin(b)]; };
    const box = (p0, p1, col, op, S, idx, stroke) => { const [x0, y0, z0] = p0, [x1, y1, z1] = p1, V = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map((v) => P3(...v, S)), F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
      return F.map((f) => ({ d: f.reduce((t, i) => t + V[i][2], 0) / 4, s: `<polygon points="${f.map((i) => V[i][0].toFixed(1) + ',' + V[i][1].toFixed(1)).join(' ')}" fill="${col}" fill-opacity="${op}" stroke="${stroke || col}" stroke-opacity="0.8" ${idx != null ? `data-z="${idx}" style="cursor:pointer"` : ''}/>` })); };
    const draw = () => {
      const S = SETS[mode]; yaw = num('znY'); pitch = num('znP'); let faces = [];
      faces = faces.concat(box([0, 0, 0], [S.room[0], S.room[1], 0], '#334155', 0.9, S, null, '#475569'));
      if (mode === 'pool') faces = faces.concat(box([2, 2, -1.2], [10, 6, 0], '#0ea5e9', 0.35, S, null));
      if (S.fixt) faces = faces.concat(box(S.fixt[0], S.fixt[1], '#f8fafc', 0.85, S, null, '#94a3b8'));
      S.zones.forEach(([n, p0, p1, col], i) => { if (i === 3) return; faces = faces.concat(box(p0, p1, col, on === i ? 0.32 : 0.1, S, i)); });
      faces.sort((a, b) => a.d - b.d);
      $('znS').innerHTML = faces.map((f) => f.s).join('') + `<text x="12" y="22" fill="#fff" font-size="14" font-weight="700">${S.zones[on][0]}</text>`;
      $('znI').innerHTML = `${S.zones.map(([n, , , col], i) => `<span class="tile ${i === on ? 'sel' : ''}" data-l="${i}" style="display:inline-block;margin:2px;border-color:${col}">${n}</span>`).join('')}<p><b style="color:${S.zones[on][3]}">${S.zones[on][0]}</b> – ${S.zones[on][4]}</p>`;
      $('znS').querySelectorAll('[data-z]').forEach((p) => (p.onclick = () => { on = +p.dataset.z; draw(); }));
      $('znI').querySelectorAll('[data-l]').forEach((p) => (p.onclick = () => { on = +p.dataset.l; draw(); }));
    };
    el.querySelectorAll('[data-z]').forEach((b) => b.tagName === 'SPAN' && (b.onclick = () => { mode = b.dataset.z; on = 0; el.querySelectorAll('.row [data-z]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    $('znS').addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, num('znY'), num('znP')]; });
    window.addEventListener('pointerup', () => (drag = null));
    $('znS').addEventListener('pointermove', (e) => { if (!drag) return; $('znY').value = Math.max(-180, Math.min(180, drag[2] + (e.clientX - drag[0]) * 0.5)); $('znP').value = Math.max(10, Math.min(70, drag[3] + (e.clientY - drag[1]) * 0.3)); $('znYV').textContent = $('znY').value + '°'; $('znPV').textContent = $('znP').value + '°'; draw(); });
    bind(el, draw);
  };

  // ---------------------------------------------------------------- solar PV and EV charging: what each part needs, and a compliance check
  W.pvev = (el, o) => {
    el.innerHTML = `<div class="row" style="margin-bottom:6px"><span class="btn s ${o.view === 'ev' ? '' : 'on'}" data-v="pv">Solar PV (Section 712)</span><span class="btn s ${o.view === 'ev' ? 'on' : ''}" data-v="ev">EV charging (Section 722)</span></div><div id="pvB"></div>`;
    let view = o.view || 'pv';
    const PV = [['PV modules and strings', 'DC up to about 1000 V that cannot be switched off while the sun shines. Class II construction for modules and DC cables; cable rated for at least 1.25 × Isc(STC); string fuses where three or more strings are in parallel.'], ['DC isolator', 'A switch-disconnector on the DC side next to the inverter so it can be worked on safely; DC-rated (AC switches cannot break DC arcs).'], ['Inverter', 'Converts to 230 / 400 V AC. If it cannot keep DC fault current out of the AC side, the RCD must be Type B (Regulation 712.411.3.2.1.2). Must disconnect when the grid fails (anti-islanding, utility approval).'], ['AC isolator', 'Lockable switch between the inverter and the board so the PV can be isolated from the installation.'], ['Distribution board', 'A supply from two directions: label the board and the origin "dual supply"; the protective devices must be suitable for current in either direction (bidirectional devices).'], ['Earthing and SPD', 'Frame earthing / equipotential bonding as the design requires; surge protection on DC and AC sides is usually needed in Sri Lanka because of lightning.']];
    const draw = () => {
      if (view === 'pv') {
        let on = 0; const pd = () => { let s = ''; PV.forEach(([t], i) => { const x = 20 + i * 122; s += `<rect x="${x}" y="70" width="108" height="70" rx="10" fill="${i === on ? '#244286' : '#1e293b'}" stroke="#cbd5e1" data-i="${i}" style="cursor:pointer"/><text x="${x + 54}" y="110" text-anchor="middle" fill="#fff" font-size="11" pointer-events="none">${t.split(' ').slice(0, 2).join(' ')}</text>`; if (i < 5) s += `<line x1="${x + 108}" y1="105" x2="${x + 122}" y2="105" stroke="${i < 2 ? '#f59e0b' : '#a16207'}" stroke-width="4"/>`; });
          s += `<text x="20" y="40" fill="#fcd34d" font-size="12">DC side →</text><text x="300" y="40" fill="#fde68a" font-size="12">← inverter → AC side</text>`;
          $('pvB').innerHTML = `<div class="stage"><svg viewBox="0 0 760 180" id="pvS">${s}</svg></div><div style="border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:8px"><b>${PV[on][0]}</b><p style="margin-bottom:0">${PV[on][1]}</p></div><p class="note">Tap each part. <span class="chk">Section 712 – check your copy and the utility's net-metering rules.</span></p>`;
          $('pvS').querySelectorAll('[data-i]').forEach((r) => (r.onclick = () => { on = +r.dataset.i; pd(); })); };
        pd();
      } else {
        $('pvB').innerHTML = `<div class="ctl">${sel('evE', 'Earthing of the supply', [['pme', 'TN-C-S (PME)'], ['tns', 'TN-S'], ['tt', 'TT']], 'pme')}${sel('evL', 'Where the charger is', [['out', 'Outdoors (car park, driveway)'], ['in', 'Inside a garage']], 'out')}${sel('evO', 'Open-PEN protection (for PME)', [['dev', 'Charger has an open-PEN detection device'], ['rod', 'Separate TT earth electrode for the charger'], ['none', 'Neither']], 'dev')}${sel('evR', 'RCD arrangement', [['b', 'Type B RCD'], ['a6', 'Type A RCD + 6 mA DC detection (RDC-DD) in the charger'], ['a', 'Type A RCD only'], ['ac', 'Type AC RCD']], 'a6')}${sel('evC', 'Circuit', [['ded', 'Dedicated final circuit'], ['shared', 'Shared with sockets']], 'ded')}</div><div id="evOut" style="margin-top:8px"></div>`;
        bind($('pvB'), () => {
          const e = $('evE').value, loc = $('evL').value, op = $('evO').value, r = $('evR').value, c = $('evC').value, L = [];
          L.push([c === 'ded', 'Each charging point on its own dedicated final circuit (722.311.201).']);
          L.push([r === 'b' || r === 'a6', 'Each charging point has its own 30 mA RCD, Type B – or Type A / F with a means of disconnecting on smooth DC above 6 mA (722.531.3.101).']);
          L.push([e !== 'pme' || loc === 'in' || op !== 'none', 'PME outdoors: the lost-PEN danger must be dealt with – an open-PEN device, a TT electrode for the charger, or another method Section 722 allows (722.411.4.1).']);
          L.push([true, 'Socket-outlets and connectors at least IP44 outdoors; protected from impact (AG) where vehicles move.']);
          $('evOut').innerHTML = `${L.map(([ok, t]) => `<div style="margin:4px 0">${ok ? '<span class="okc">✓</span>' : '<span class="noc">✗</span>'} ${t}</div>`).join('')}${kpi([[L.every((x) => x[0]) ? 'Complies' : 'Does not comply', 'this arrangement', !L.every((x) => x[0])]])}<p class="note">Smooth DC fault current from the car's charger can blind an ordinary Type AC or A RCD – that is the reason for Type B or RDC-DD. <span class="chk">Regulation numbers from Section 722 – check your copy.</span></p>`;
        });
      }
    };
    el.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { view = b.dataset.v; el.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    draw();
  };

  // ---------------------------------------------------------------- prosumer installation: grid, PV, battery and loads through a day
  W.energy = (el) => {
    el.innerHTML = `<div class="stage"><svg id="enS" viewBox="0 0 760 320"></svg></div><div class="ctl">${sl('enH', 'Time of day', 0, 23.5, 0.5, 12, ' h')}${sl('enPv', 'PV size', 0, 20, 1, 8, ' kWp')}${sl('enBat', 'Battery', 0, 20, 1, 10, ' kWh')}<div><label><input type="checkbox" id="enPlay" checked> Play the day</label></div></div><div id="enK"></div><div class="note">A prosumer installation both uses and produces energy. Part 8 (Chapter 82) adds rules for these installations – energy management, operating modes (connected to the grid or islanded) and safety when the source can be the battery, the PV or the grid. Stationary batteries have their own Chapter 57 (Amendment 4): location, ventilation, fire risk and isolation. Protective devices must work for current in both directions. <span class="chk">Check Part 8 and Chapter 57 in your copy.</span></div>`;
    let raf, soc = 0.4, last = performance.now();
    const pvAt = (h, kwp) => Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) * kwp * 0.8, loadAt = (h) => 0.6 + (h >= 7 && h <= 9 ? 1.5 : 0) + (h >= 18 && h <= 22 ? 2.5 : 0) + (h > 10 && h < 16 ? 1.2 : 0);
    const draw = (now) => {
      const dt = (now - last) / 1000; last = now; if ($('enPlay').checked) { const h = (num('enH') + dt * 0.8) % 24; $('enH').value = Math.round(h * 2) / 2; $('enHV').textContent = $('enH').value + ' h'; }
      const h = num('enH'), kwp = num('enPv'), cap = num('enBat'), pv = pvAt(h, kwp), ld = loadAt(h); let bat = 0, grid = 0, net = pv - ld;
      if (cap > 0) { if (net > 0 && soc < 1) bat = Math.min(net, 5); if (net < 0 && soc > 0.1) bat = Math.max(net, -5); soc = Math.max(0.1, Math.min(1, soc + (bat * dt * 0.8) / Math.max(1, cap))); }
      grid = -(net - bat);
      const node = (x, y, t, v, col) => `<rect x="${x - 70}" y="${y - 34}" width="140" height="68" rx="12" fill="#1e293b" stroke="${col}" stroke-width="3"/><text x="${x}" y="${y - 6}" text-anchor="middle" fill="#fff" font-size="13" font-weight="700">${t}</text><text x="${x}" y="${y + 16}" text-anchor="middle" fill="${col}" font-size="13">${v}</text>`;
      const flow = (x1, y1, x2, y2, p, col) => (Math.abs(p) < 0.05 ? `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#334155" stroke-width="2"/>` : `<line x1="${p > 0 ? x1 : x2}" y1="${p > 0 ? y1 : y2}" x2="${p > 0 ? x2 : x1}" y2="${p > 0 ? y2 : y1}" stroke="${col}" stroke-width="${2 + Math.abs(p) * 1.5}" class="flow"/>`);
      let s = `<rect x="0" y="0" width="760" height="320" fill="${h < 6 || h > 18.5 ? '#0b1220' : '#0f1a33'}"/><circle cx="${60 + (h / 24) * 640}" cy="${70 - Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) * 40}" r="14" fill="${pv > 0 ? '#facc15' : '#475569'}"/>`;
      s += flow(170, 160, 330, 160, pv, '#facc15') + flow(430, 160, 590, 160, ld, '#60a5fa') + flow(380, 194, 380, 250, bat, '#22c55e') + flow(380, 126, 380, 70, -grid, '#f97316');
      s += node(110, 160, 'PV', fx(pv, 1) + ' kW', '#facc15') + node(380, 160, 'Board', '', '#cbd5e1') + node(650, 160, 'Loads', fx(ld, 1) + ' kW', '#60a5fa') + node(380, 280, 'Battery', `${fx(bat, 1)} kW · ${Math.round(soc * 100)} %`, '#22c55e') + node(380, 40, 'Grid', grid >= 0 ? `import ${fx(grid, 1)} kW` : `export ${fx(-grid, 1)} kW`, '#f97316');
      $('enS').innerHTML = s;
      $('enK').innerHTML = kpi([[fx(h, 1) + ' h', 'time'], [fx(pv, 1) + ' kW', 'solar'], [fx(ld, 1) + ' kW', 'load'], [grid >= 0 ? 'Import' : 'Export', fx(Math.abs(grid), 1) + ' kW']]);
      raf = requestAnimationFrame(draw);
    };
    bind(el, () => {}); raf = requestAnimationFrame(draw); onStop(() => cancelAnimationFrame(raf));
  };

  // ---------------------------------------------------------------- Amendment 4: before / after for each change
  W.amend = (el) => {
    const C = [['Chapter 57 – stationary secondary batteries', 'No dedicated chapter – battery systems were designed from maker data and general rules.', 'A new chapter for battery energy storage: where batteries may be located, ventilation, fire and thermal-runaway risk, safe isolation and labelling.', 'Every DIMO solar + battery job (homes, hotels, telecom sites) – check the battery location and isolation at design stage.'], ['Section 545 – functional earthing and bonding for ICT', 'Functional earthing of IT and telecom equipment was covered only briefly.', 'A new section on functional earthing and bonding for information and communication technology equipment.', 'Data rooms, BMS and lighting control racks: keep functional and protective earthing correct and documented.'], ['Section 716 – Power over Ethernet (PoE)', 'PoE cabling was outside BS 7671 in practice.', 'A new section for PoE installations: extra-low voltage DC power carried on data cabling, with limits and cable requirements (BS ISO/IEC 11801-1).', 'PoE lighting, cameras and access points: bundle sizes and cable heating now have rules.'], ['Section 710 – medical locations (major revision)', 'Section 710 based on the older IEC edition.', 'Revised and aligned with IEC 60364-7-710:2021; Group 0 / 1 / 2 classification kept; a schedule for recording supplementary bonding resistances.', 'Hospital and clinic projects: use the new forms and check the Group of each room with the medical staff.'], ['Regulation 421.1.7 – AFDDs', '"Higher risk residential buildings" and the list of premises where AFDDs are required.', 'Wording changed (reported as "high-rise residential buildings") and a new AFDD item on the inspection schedule.', 'Apartments, student housing and care homes: AFDDs on socket circuits – and inspect for them on EICRs.'], ['Chapter 81 – energy efficiency', 'Appendix 17 (information only).', 'Energy efficiency moves into Part 8 as Chapter 81 (still guidance in nature).', 'Use it with Design Tools: voltage drop, transformer and circuit losses, lighting control.'], ['Regulations 422.2.201 / 422.2.202 – protected escape routes', '—', 'New regulations about wiring in protected escape routes (reported).', 'Hotels and apartments: check what wiring passes through protected stairs and corridors.'], ['Model forms', 'Forms of the A3:2024 edition.', 'New model forms for certificates and reports; the old forms withdrawn on 15 October 2026.', 'Update DIMO test certificate templates and the QA test records.']];
    let on = 0, after = true;
    const draw = () => {
      const c = C[on];
      el.innerHTML = `<div class="chips">${C.map((x, i) => `<span class="tile ${i === on ? 'sel' : ''}" data-i="${i}">${x[0].split(' – ')[0]}</span>`).join('')}</div><div style="border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:8px"><b>${c[0]}</b><div class="row" style="margin:8px 0"><span class="btn s ${after ? '' : 'on'}" id="amB">Before (A3:2024)</span><span class="btn s ${after ? 'on' : ''}" id="amA">After (A4:2026)</span></div><div class="${after ? 'say' : 'watch'}">${after ? c[2] : c[1]}</div><p style="margin-bottom:0"><b>What it means for DIMO:</b> ${c[3]}</p></div><p class="note">Amendment 4 was published in April 2026; the previous edition (A2:2022 + A3:2024) was withdrawn on 15 October 2026. This list is from published summaries – <span class="chk">confirm every item and number against the licensed copy of BS 7671:2018+A4:2026 before relying on it.</span></p>`;
      el.querySelectorAll('[data-i]').forEach((t) => (t.onclick = () => { on = +t.dataset.i; draw(); }));
      $('amB').onclick = () => { after = false; draw(); }; $('amA').onclick = () => { after = true; draw(); };
    };
    draw();
  };
  // ---------------------------------------------------------------- ELV lighting (Section 715): 12 V / 24 V current and voltage drop
  W.elv = (el) => {
    el.innerHTML = `<div class="ctl">${sel('elU', 'System voltage', [[12, '12 V'], [24, '24 V'], [48, '48 V']], 12)}${sl('elP', 'Total lamp load', 20, 600, 10, 200, ' W')}${sl('elL', 'Cable run (one way)', 1, 30, 0.5, 8, ' m')}${sel('elS', 'Conductor size', [1.5, 2.5, 4, 6, 10, 16].map((x) => [x, x + ' mm²']), 4)}</div><div class="panel" style="margin-top:8px"><svg id="elSv" viewBox="0 0 720 150"></svg></div><div id="elK"></div><div class="note">At extra-low voltage the same power needs a much larger current, so voltage drop decides the cable – not the current rating. VD = 2 × L × I × ρ / S (ρ ≈ 0.0225 Ω·mm²/m for warm copper). Keep the drop within about 5 % of the ELV supply (Section 715), and protect against fire: a short circuit on a 12 V track can deliver enough energy to start a fire, so use a transformer / driver with short-circuit protection and keep bare conductors out of reach (715.422.106). <span class="chk">Check Section 715.</span></div>`;
    bind(el, () => {
      const U = num('elU'), P = num('elP'), Lm = num('elL'), S = num('elS'), I = P / U, vd = (2 * Lm * I * 0.0225) / S, pct = (100 * vd) / U, X = (p) => 40 + Math.min(p, 20) / 20 * 640;
      $('elSv').innerHTML = `<rect x="40" y="50" width="640" height="30" rx="6" fill="#e5e7eb"/><rect x="40" y="50" width="${X(pct) - 40}" height="30" rx="6" fill="${pct <= 5 ? '#16a34a' : '#dc2626'}"/><line x1="${X(5)}" y1="36" x2="${X(5)}" y2="92" stroke="#ea580c" stroke-width="3"/><text x="${X(5) + 4}" y="34" font-size="12" fill="#ea580c">5 %</text>${[0, 5, 10, 15, 20].map((p) => `<text x="${X(p)}" y="108" font-size="11" text-anchor="middle" fill="#475569">${p} %</text>`).join('')}<text x="40" y="136" font-size="12" fill="#475569">Voltage drop as a share of the ${U} V supply</text>`;
      $('elK').innerHTML = kpi([[fx(I, 1) + ' A', 'current = P / U'], [fx(vd, 2) + ' V', 'voltage drop'], [fx(pct, 1) + ' %', 'of ' + U + ' V', pct > 5], [fx(U - vd, 1) + ' V', 'at the lamps']]);
    });
  };
})();
