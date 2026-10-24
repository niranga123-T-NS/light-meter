/* Panel board workbench – realistic panel interiors with working components: star-delta starter, lighting control panel, incomer protection
   (MCCB trip unit, PFR, EFR + CBCT), ATS, power quality (unbalance, neutral current, harmonics, filters) and power factor correction.
   Explore: change the settings, make parts fail and watch what happens. Challenge: three rounds of random hidden faults to name. */
(function () {
  const PAN = {};
  const r1 = (v) => Math.round(v * 10) / 10;
  const fmtS = (t) => (t >= 3600 ? `${r1(t / 3600)} h` : t >= 120 ? `${Math.round(t / 60)} min` : t > 0 && t < 1 ? `${Math.round(t * 1000)} ms` : `${r1(t)} s`);

  // ---------------------------------------------------------------- drawing helpers (realistic panel components)
  const T = (x, y, t, s = 10, c = '#334155', a = 'middle', w = 400) => `<text x="${x}" y="${y}" font-size="${s}" fill="${c}" text-anchor="${a}" font-weight="${w}">${t}</text>`;
  const wire = (pts, c = '#334155', w = 2, dash) => `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="round" ${dash ? 'stroke-dasharray="5 4"' : ''}/>`;
  const PH = { L1: '#8b5a2b', L2: '#111827', L3: '#6b7280', N: '#2563eb', PE: '#16a34a', C: '#dc2626', D: '#7c3aed' };
  const hit = (id, x, y, w, h, sel) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${sel === id ? 'rgba(36,66,134,.10)' : 'transparent'}" stroke="${sel === id ? '#244286' : 'none'}" stroke-width="2" data-p="${id}" style="cursor:pointer"/>`;
  const screw = (x, y) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#cbd5e1" stroke="#64748b"/><line x1="${x - 2}" y1="${y}" x2="${x + 2}" y2="${y}" stroke="#475569"/>`;
  const mcb = (x, y, poles, rate, lab, on, hot) => { let s = ''; for (let i = 0; i < poles; i++) { const X = x + i * 20; s += `<rect x="${X}" y="${y}" width="20" height="84" rx="2" fill="#fff" stroke="#94a3b8"/>${screw(X + 10, y + 7)}${screw(X + 10, y + 77)}<rect x="${X + 5}" y="${y + 18}" width="10" height="34" rx="2" fill="#e2e8f0"/><rect x="${X + 5}" y="${on ? y + 18 : y + 36}" width="10" height="16" rx="2" fill="#1e293b"/><rect x="${X + 6}" y="${y + 56}" width="8" height="5" fill="${on ? '#dc2626' : '#16a34a'}"/>`; } return s + T(x + poles * 10, y + 70, rate, 8, '#334155', 'middle', 700) + (hot ? `<circle cx="${x + poles * 10}" cy="${y + 80}" r="9" fill="#f97316" opacity=".55"/>` : '') + T(x + poles * 10, y + 98, lab, 10, '#14161c', 'middle', 700); };
  const dial = (x, y, frac, lab, val, r = 10) => { const a = (-135 + 270 * Math.max(0, Math.min(1, frac))) * (Math.PI / 180); return `<circle cx="${x}" cy="${y}" r="${r}" fill="#e2e8f0" stroke="#475569"/><line x1="${x}" y1="${y}" x2="${r1(x + Math.sin(a) * (r - 2))}" y2="${r1(y - Math.cos(a) * (r - 2))}" stroke="#b91c1c" stroke-width="2"/>${T(x, y + r + 9, lab, 7, '#475569')}${T(x, y - r - 3, val, 7, '#14161c', 'middle', 700)}`; };
  const led = (x, y, col, on, lab) => `<circle cx="${x}" cy="${y}" r="4" fill="${on ? col : '#cbd5e1'}" stroke="#64748b" ${on ? `style="filter:drop-shadow(0 0 3px ${col})"` : ''}/>${lab ? T(x, y + 12, lab, 6.5, '#475569') : ''}`;
  const relay = (x, y, w, lab, leds = [], dials = [], sub = '') => `<rect x="${x}" y="${y}" width="${w}" height="84" rx="3" fill="#f8fafc" stroke="#94a3b8"/>${screw(x + 8, y + 7)}${screw(x + w - 8, y + 7)}${screw(x + 8, y + 77)}${screw(x + w - 8, y + 77)}${leds.map(([c, on, l], i) => led(x + 12 + i * ((w - 24) / Math.max(1, leds.length - 1 || 1)), y + 20, c, on, l)).join('')}${dials.map(([f, l, v], i) => dial(x + (w / (dials.length + 1)) * (i + 1), y + 54, f, l, v, 8)).join('')}${T(x + w / 2, y + 98, lab, 10, '#14161c', 'middle', 700)}${sub ? T(x + w / 2, y + 109, sub, 8, '#64748b') : ''}`;
  const cont = (x, y, lab, on, opt = {}) => `<rect x="${x}" y="${y}" width="56" height="84" rx="3" fill="#e5e7eb" stroke="#64748b"/>${[0, 1, 2].map((i) => screw(x + 12 + i * 16, y + 7) + screw(x + 12 + i * 16, y + 77)).join('')}<rect x="${x + 14}" y="${y + 24}" width="28" height="22" rx="2" fill="#f8fafc" stroke="#64748b"/><rect x="${x + 18}" y="${on ? y + 34 : y + 27}" width="20" height="9" fill="${opt.weld ? '#b91c1c' : '#1e293b'}"/>${T(x + 6, y + 20, 'A1', 6.5, '#475569', 'start')}${T(x + 50, y + 20, 'A2', 6.5, '#475569', 'end')}<rect x="${x + 8}" y="${y + 52}" width="40" height="14" rx="2" fill="#cbd5e1"/>${T(x + 28, y + 62, '13 14 21 22', 6, '#334155')}${opt.buzz ? T(x + 28, y - 4, '≈ hum ≈', 9, '#b45309', 'middle', 700) : ''}${opt.hot ? `<circle cx="${x + 28}" cy="${y + 78}" r="11" fill="#f97316" opacity=".55"/>` : ''}${opt.burnt ? `<path d="M${x + 8} ${y + 10} q10 -14 20 0 q10 -14 20 0" stroke="#1f2937" stroke-width="3" fill="none" opacity=".6"/>` : ''}${T(x + 28, y + 98, lab, 10, '#14161c', 'middle', 700)}${opt.sub ? T(x + 28, y + 109, opt.sub, 8, '#64748b') : ''}`;
  const olr = (x, y, lab, setA, range, trip) => `<rect x="${x}" y="${y}" width="56" height="46" rx="3" fill="#d1d5db" stroke="#64748b"/>${dial(x + 18, y + 24, (setA - range[0]) / (range[1] - range[0]), '', `${setA} A`, 9)}<circle cx="${x + 42}" cy="${y + 24}" r="6" fill="#2563eb"/>${trip ? `<rect x="${x + 36}" y="${y + 4}" width="12" height="7" fill="#f59e0b"/>` : ''}${T(x + 28, y + 58, lab, 10, '#14161c', 'middle', 700)}`;
  const lcd = (x, y, w, h, lines, bg = '#1f3b2c', fg = '#a7f3d0') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${bg}" stroke="#0f172a" stroke-width="2"/>${lines.map((l, i) => `<text x="${x + 6}" y="${y + 14 + i * 12}" font-size="10" fill="${fg}" font-family="ui-monospace,Menlo,monospace" style="white-space:pre">${l}</text>`).join('')}`;
  const pb = (x, y, col, lab, sub) => `<circle cx="${x}" cy="${y}" r="15" fill="#e5e7eb" stroke="#475569"/><circle cx="${x}" cy="${y}" r="10" fill="${col}"/>${T(x, y + 27, lab, 9, '#14161c', 'middle', 700)}${sub ? T(x, y + 37, sub, 7, '#64748b') : ''}`;
  const lamp = (x, y, col, on, lab) => `<circle cx="${x}" cy="${y}" r="12" fill="#e5e7eb" stroke="#475569"/><circle cx="${x}" cy="${y}" r="8" fill="${on ? col : '#94a3b8'}" ${on ? `style="filter:drop-shadow(0 0 5px ${col})"` : ''}/>${T(x, y + 24, lab, 8, '#14161c', 'middle', 700)}`;
  const estop = (x, y, latched) => `<rect x="${x - 20}" y="${y - 20}" width="40" height="40" rx="4" fill="#facc15" stroke="#a16207"/><circle cx="${x}" cy="${y}" r="${latched ? 13 : 15}" fill="#dc2626" stroke="#7f1d1d"/>${T(x, y + 32, latched ? 'E-STOP (in)' : 'E-STOP', 8, latched ? '#b91c1c' : '#14161c', 'middle', 700)}`;
  const capCan = (x, y, lab, on, bad) => `<rect x="${x}" y="${y}" width="34" height="70" rx="6" fill="${bad === 'bulge' ? '#fde68a' : '#cbd5e1'}" stroke="#64748b"/>${bad === 'bulge' ? `<path d="M${x + 4} ${y} q13 -10 26 0" fill="#fde68a" stroke="#64748b"/>` : ''}${screw(x + 10, y + 8)}${screw(x + 24, y + 8)}${T(x + 17, y + 46, on ? 'ON' : '', 8, '#15803d', 'middle', 700)}${T(x + 17, y + 84, lab, 9, '#14161c', 'middle', 700)}`;
  const heat = (x, y, r = 14) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#f97316" opacity=".5"/>`;
  const busbars = (x1, x2, y, labs = ['L1', 'L2', 'L3', 'N'], gap = 10) => labs.map((l, i) => `<rect x="${x1}" y="${y + i * gap}" width="${x2 - x1}" height="5" rx="1" fill="${l === 'N' ? '#93c5fd' : l === 'PE' ? '#86efac' : '#d4a373'}" stroke="#92400e" stroke-width=".5"/>${T(x1 - 4, y + i * gap + 5, l, 8, PH[l] || '#334155', 'end', 700)}`).join('');
  const chart = (w, h, xmax, ymax, series, o = {}) => {
    const L = 46, B = h - 26, X = (t) => L + (Math.min(t, xmax) / xmax) * (w - L - 10), Y = (v) => B - (Math.max(0, Math.min(v, ymax)) / ymax) * (B - 14);
    let s = `<rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/><line x1="${L}" y1="${B}" x2="${w - 10}" y2="${B}" stroke="#94a3b8"/><line x1="${L}" y1="14" x2="${L}" y2="${B}" stroke="#94a3b8"/>`;
    for (let i = 0; i <= 4; i++) { s += (o.noY ? '' : T(L - 4, Y((ymax * i) / 4) + 3, Math.round((ymax * i) / 4), 9, '#64748b', 'end')) + T(X((xmax * i) / 4), B + 13, r1((xmax * i) / 4), 9, '#64748b'); if (i) s += `<line x1="${L}" y1="${Y((ymax * i) / 4)}" x2="${w - 10}" y2="${Y((ymax * i) / 4)}" stroke="#f1f5f9"/>`; }
    (o.h || []).forEach(([v, l, c]) => { s += `<line x1="${L}" y1="${Y(v)}" x2="${w - 10}" y2="${Y(v)}" stroke="${c}" stroke-dasharray="5 4"/>${T(L + 4, Y(v) - 3, l, 9, c, 'start')}`; });
    (o.marks || []).forEach(([t, l, c = '#7c3aed']) => { s += `<line x1="${X(t)}" y1="14" x2="${X(t)}" y2="${B}" stroke="${c}" stroke-dasharray="3 3"/>${T(X(t) + 3, 24, l, 9, c, 'start')}`; });
    series.forEach(({ pts, c, lab }) => { if (pts.length) s += `<polyline points="${pts.map(([t, v]) => `${r1(X(t))},${r1(Y(v))}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2"/>${lab ? T(r1(X(pts[pts.length - 1][0])) - 4, r1(Y(pts[pts.length - 1][1])) - 5, lab, 9, c, 'end', 700) : ''}`; });
    return s + T(L, 10, o.yl || '', 9, '#475569', 'start', 700) + T(w - 10, h - 2, o.xl || '', 9, '#475569', 'end');
  };
  const bars = (w, h, items, ymax, o = {}) => { const L = 40, B = h - 22, bw = (w - L - 10) / items.length; let s = `<rect width="${w}" height="${h}" fill="#fff"/><line x1="${L}" y1="${B}" x2="${w - 6}" y2="${B}" stroke="#94a3b8"/>`; for (let i = 0; i <= 4; i++) s += T(L - 4, B - ((B - 14) * i) / 4 + 3, Math.round((ymax * i) / 4), 9, '#64748b', 'end'); items.forEach(([l, v, c], i) => { const hh = (Math.min(v, ymax) / ymax) * (B - 14); s += `<rect x="${L + i * bw + 4}" y="${B - hh}" width="${bw - 8}" height="${hh}" fill="${c || '#244286'}"/>${T(L + i * bw + bw / 2, B + 12, l, 9, '#475569')}${v > 0.5 ? T(L + i * bw + bw / 2, B - hh - 3, Math.round(v), 8, '#14161c') : ''}`; }); return s + T(L, 10, o.yl || '', 9, '#475569', 'start', 700); };
  const loglog = (w, h, curves, pts, o = {}) => {
    const L = 46, B = h - 26, x0 = Math.log10(o.x0 || 100), x1 = Math.log10(o.x1 || 30000), y0 = -2, y1 = 4, X = (i) => L + ((Math.log10(Math.max(i, 1)) - x0) / (x1 - x0)) * (w - L - 10), Y = (t) => B - ((Math.log10(Math.max(t, 0.005)) - y0) / (y1 - y0)) * (B - 10);
    let s = `<rect width="${w}" height="${h}" fill="#fff"/>`;
    for (let e = Math.ceil(x0); e <= x1; e++) s += `<line x1="${X(10 ** e)}" y1="10" x2="${X(10 ** e)}" y2="${B}" stroke="#e2e8f0"/>${T(X(10 ** e), B + 13, 10 ** e >= 1000 ? `${10 ** e / 1000} kA` : `${10 ** e} A`, 9, '#64748b')}`;
    for (let e = y0; e <= y1; e++) s += `<line x1="${L}" y1="${Y(10 ** e)}" x2="${w - 10}" y2="${Y(10 ** e)}" stroke="#e2e8f0"/>${T(L - 4, Y(10 ** e) + 3, 10 ** e >= 1 ? `${10 ** e} s` : `${10 ** e}`, 9, '#64748b', 'end')}`;
    curves.forEach(({ f, c, lab }) => { const p = []; for (let k = 0; k <= 160; k++) { const i = 10 ** (x0 + ((x1 - x0) * k) / 160), t = f(i); if (t != null && t < 1e4) p.push(`${r1(X(i))},${r1(Y(t))}`); } if (p.length) s += `<polyline points="${p.join(' ')}" fill="none" stroke="${c}" stroke-width="2.2"/>${T(+p[0].split(',')[0] + 4, +p[0].split(',')[1] - 4, lab, 9, c, 'start', 700)}`; });
    pts.forEach(([i, t, l, c]) => { s += `<line x1="${X(i)}" y1="10" x2="${X(i)}" y2="${B}" stroke="${c}" stroke-dasharray="4 3"/>${T(X(i) + 3, 22, l, 9, c, 'start', 700)}${t != null ? `<circle cx="${X(i)}" cy="${Y(t)}" r="4" fill="${c}"/>` : ''}`; });
    return s + `<line x1="${L}" y1="${B}" x2="${w - 10}" y2="${B}" stroke="#94a3b8"/><line x1="${L}" y1="10" x2="${L}" y2="${B}" stroke="#94a3b8"/>` + T(L + 4, 20, o.yl || 'trip time', 9, '#475569', 'start', 700);
  };

  // ---------------------------------------------------------------- 1. star-delta motor starter
  PAN.motor = {
    title: 'Star-delta motor starter – 15 kW ventilation fan',
    intro: 'Motor nameplate: 15 kW · 400 V Δ · 28 A · 1460 rpm. Press START: K1 (main) and K2 (star) close, the timer runs, then K2 opens and K3 (delta) closes. The overload relay F2 sits in the K1 line and carries the WINDING current, so it is set to 28 ÷ √3 ≈ 16 A.',
    parts: {
      Q0: ['Q0 – motor MCCB 40 A', 'Short-circuit protection for the starter. Its magnetic trip Ii must stay above the starting current peaks (star start and the change-over transient).'],
      F1: ['F1 – control circuit MCB 2 A', 'Feeds the 230 V control circuit (L1–N): E-stop, STOP, START, the coils, the timer and the lamps.'],
      KT: ['KT – star-delta timer', 'How long the motor runs in star before change-over. Set it to the run-up time of the load: watch the ammeter – change over when the current has fallen back.'],
      K1: ['K1 – main contactor', 'Feeds the winding starts U1 V1 W1. Its auxiliary contact 13-14 is the hold-in (self-latch) across START.'],
      K2: ['K2 – star contactor', 'Joins U2 V2 W2 together = star (each winding gets 230 V, a third of the DOL current). Its NC auxiliary 21-22 sits in the K3 coil circuit – the interlock.'],
      K3: ['K3 – delta contactor', 'Connects U2 V2 W2 to the lines = delta (each winding gets 400 V). Its NC auxiliary is in the K2 coil circuit.'],
      F2: ['F2 – thermal overload relay', 'Class 10. Carries the winding (phase) current: set to FLC ÷ √3. Has a phase-loss (differential) trip.'],
      DOOR: ['Door – E-stop, STOP, START, lamps, ammeter', 'H1 green = running, H2 amber = overload tripped. The ammeter reads the line current to the motor.'],
      M: ['Motor 15 kW, 6 terminals (U1 V1 W1 / U2 V2 W2)', 'A fan load: torque rises with speed squared. Run-up time in star depends on the load.'],
      CT: ['Control circuit supply', '230 V from L1–N through F1. Contactor coils pull in at about 85 % and drop out below about 60 % of their rated voltage.'],
    },
    sets: [['ii', 'Q0', 'Magnetic trip Ii', 'range', 3, 12, 1, ' × 40 A'], ['tsd', 'KT', 'Star time', 'range', 1, 30, 1, ' s'], ['olr', 'F2', 'Overload setting', 'range', 9, 30, 0.5, ' A'], ['coilV', 'K1', 'Coil voltage fitted (K1, K2, K3)', 'select', [[24, '24 V AC'], [230, '230 V AC'], [400, '400 V AC']]], ['load', 'M', 'Fan load (fraction of rated)', 'range', 0.3, 1, 0.05, '']],
    init: () => ({ ii: 10, tsd: 10, olr: 16, coilV: 230, load: 0.7, ev: 'off', estop: false, iso: false }),
    ops: [
      { l: () => 'Press START', on: (c) => c.ev === 'start', a: (c) => { c.ev = 'start'; } },
      { l: () => 'Hold START down', on: (c) => c.ev === 'hold', a: (c) => { c.ev = 'hold'; } },
      { l: () => 'STOP / reset', on: (c) => c.ev === 'off', a: (c) => { c.ev = 'off'; } },
      { l: (c) => (c.estop ? 'E-stop IN – twist to release' : 'Press E-stop'), on: (c) => c.estop, a: (c) => { c.estop = !c.estop; } },
      { l: (c) => (c.iso ? '🔒 Q0 off and locked' : 'Isolate Q0 and lock off'), on: (c) => c.iso, a: (c) => { c.iso = !c.iso; c.ev = 'off'; } },
    ],
    faults: [
      { id: 'phase', label: 'One supply phase lost (single phasing)', say: 'The fan hums and does not turn, then the overload trips.', hint: 'Measure the three line voltages at Q0 outgoing. A motor cannot start on two phases.', why: 'With L3 lost the motor gets a single-phase supply: no rotating field, locked rotor current, the overload\'s phase-loss trip operates.', fix: 'Find the lost phase upstream (fuse, cable joint, supply). Never reset repeatedly – the motor overheats.' },
      { id: 'hold', label: 'K1 hold-in contact 13-14 not working', say: 'The fan only runs while someone holds the START button.', hint: 'Hold START: it runs. Let go: it stops. What keeps the coil energised after START is released?', why: 'The auxiliary 13-14 of K1 is wired across START to latch the circuit. Broken contact or wire = no latch.', fix: 'Test 13-14 with K1 pushed in (dead test). Replace the auxiliary block or the wire.' },
      { id: 'stopOpen', label: 'STOP button contact open (broken NC)', say: 'Nothing happens when START is pressed. No lamps.', hint: 'Control voltage at F1 is fine. Follow the series chain: E-stop → STOP → START → coils.', why: 'STOP is a normally-closed contact in series with everything. Open = nothing can start.', fix: 'Continuity test the STOP NC contact (dead). Replace the contact block.' },
      { id: 'k3open', label: 'K3 (delta) coil open circuit', say: 'The fan starts, then slows down and stops at the change-over. H1 stays on.', hint: 'Watch the sequence after the timer: which contactor should close and does it?', why: 'K2 drops out at the end of the star time but K3 never pulls in: the windings are left open, the motor coasts to a stop.', fix: 'Coil resistance K3 A1-A2 (dead) reads OL. Replace the coil.' },
      { id: 'k2weld', label: 'K2 (star) contacts welded', say: 'The fan stays slow and humming, never changes to full speed, and the overload trips after a few minutes.', hint: 'Look at the contactor indicators with the starter stopped.', why: 'K2 main contacts are welded closed. Its NC interlock stays open, so K3 can never close: the motor runs in star forever, overloaded.', fix: 'Replace K2. Find why it welded (too small, chattering, short at change-over).' },
      { id: 'ilk', label: 'Star/delta interlock bridged out', say: 'Q0 trips with a bang at the moment of change-over.', hint: 'What stops K2 and K3 being closed together? Test the interlock path.', why: 'The K2 NC aux in the K3 coil circuit is bridged. K3 closes before the arc on K2 is out – a phase-to-phase short through the two contactors.', fix: 'Remove the bridge, restore the mechanical/electrical interlock, check both contactors for damage.' },
      { id: 'ktDead', label: 'Star-delta timer failed (never times out)', say: 'The fan runs slowly with a hum and never comes up to full speed; after a few minutes the overload trips.', hint: 'The motor stays in star. Which part decides when to change to delta?', why: 'The timer has failed: it never changes over. In star the motor only gives a third of its torque – it overloads.', fix: 'Check the timer supply and output contact; replace it.' },
      { id: 'ctlLow', label: 'Control supply voltage too low (contactors chatter)', say: 'The contactors chatter loudly when START is pressed and the motor jerks.', hint: 'Measure the control voltage at F1 with START pressed.', why: 'Only 172 V control (overloaded control transformer / long control cable). The coils need about 85 % to pull in and hold.', fix: 'Correct the control transformer tapping/size, or shorten / up-size the control wiring.' },
      { id: 'k1burn', label: 'K1 main contact on L2 burnt (high resistance)', say: 'The fan works but the panel smells hot; the K1 terminal is discoloured.', hint: 'Thermal camera on the panel while running, then a contact resistance test.', why: 'A pitted / burnt main contact has high resistance: heat at that pole, a small voltage drop and current unbalance.', fix: 'Replace the contactor (or the contact kit). Check terminal torque.' },
      { id: 'olrLow', label: 'Overload relay set too low', say: 'The fan trips on overload after about 10 minutes of normal running.', hint: 'Compare the overload dial with the motor nameplate – and remember where F2 is.', why: 'F2 set below the winding current trips the motor during normal running.', fix: 'Set F2 to FLC ÷ √3 = 16 A (in the line to the windings).', set: { olr: 9 } },
      { id: 'olrHigh', label: 'Overload relay set to the line current (28 A)', say: 'The motor burnt out last month after a phase was lost – the overload never tripped in time.', hint: 'F2 carries the winding current, not the line current.', why: 'At 28 A the relay is set 1.73 × too high: on single phasing or overload it trips far too late – the winding cooks.', fix: 'Set 16 A (28 ÷ √3).', set: { olr: 28 }, also: 'phase' },
      { id: 'tShort', label: 'Star time too short', say: 'The lights in the workshop dip and the belt squeals at every start; sometimes Q0 trips.', hint: 'Watch the ammeter and the change-over current peak.', why: 'Change-over before the fan has run up = almost direct-on-line current at change-over. The benefit of star-delta is lost.', fix: 'Set the timer to the run-up time (about 8–10 s here).', set: { tsd: 2, ii: 6 } },
      { id: 'tLong', label: 'Star time far too long', say: 'The fan takes half a minute to reach full speed and hums meanwhile.', hint: 'When does the current fall back during start? When does the change-over happen?', why: 'The motor stays in star long after it has run up – reduced torque, extra heating.', fix: 'Set the timer to the run-up time (8–10 s).', set: { tsd: 30 } },
      { id: 'coil400', label: 'Wrong contactor coils fitted (400 V coils on 230 V control)', say: 'The contactors hum but do not close.', hint: 'Read the coil label on the contactors and the control voltage.', why: '400 V coils on 230 V get 58 % of their voltage: not enough to pull in.', fix: 'Fit 230 V AC coils to match the control supply.', set: { coilV: 400 } },
      { id: 'coil24', label: 'Wrong contactor coil fitted (24 V coil on 230 V control)', say: 'There was a flash and a smell when START was pressed; F1 tripped and will not stay in.', hint: 'Read the coil label. What happens to a 24 V coil on 230 V?', why: 'Ten times its rated voltage – the coil burns out at once and shorts, tripping F1.', fix: 'Replace the burnt coil with a 230 V AC coil.', set: { coilV: 24 } },
    ],
    sim(c, F) {
      const flc = 28, ilr = 6 * flc, R = { K1: 0, K2: F.k2weld ? 1 : 0, K3: 0, KT: 0, H1: 0, H2: 0, q0: !c.iso, f1: true, olrTrip: false, q0Trip: false, spd: 0, conn: '', ctlV: 0, tl: [], tr: [], I: [0, 0, 0], wT: 40, buzz: false, burnt: false, hot: {}, mark: [], xmax: 20 };
      const tl = (t, s, bad) => R.tl.push([t, s, bad]);
      R.vl = c.iso ? [0, 0, 0] : F.phase ? [400, 4, 4] : [400, 400, 400];
      if (c.iso) { tl(0, 'Q0 is OFF and locked – the starter is dead.'); return R; }
      R.ctlV = F.ctlLow ? 172 : 230;
      if (c.ev === 'off') { tl(0, F.k2weld ? 'Stopped. Note: K2 indicator shows CLOSED although nothing is energised.' : 'Stopped – press START.', F.k2weld); return R; }
      if (c.estop) { tl(0, 'START pressed – nothing happens: the E-stop is latched in (twist to release).', 1); return R; }
      if (F.stopOpen) { tl(0, 'START pressed – nothing happens, no lamp. F1 is on and gives 230 V.', 1); return R; }
      if (c.coilV === 24) { R.f1 = false; R.ctlV = 0; R.burnt = true; tl(0, 'START pressed – a flash and smell from the coils, F1 trips at once.', 1); tl(1, 'F1 trips again as soon as it is reset.', 1); return R; }
      if (c.coilV === 400) { R.buzz = true; tl(0, 'START pressed – the coils hum but the contactors do not pull in (58 % of coil voltage).', 1); return R; }
      if (F.ctlLow) { R.buzz = true; tl(0, 'START pressed – K1 and K2 chatter (172 V control, 75 % of coil voltage).', 1); tl(0.3, 'The motor jerks, the contacts arc and pit.', 1); for (let t = 0; t < 4; t += 0.25) R.tr.push([t, (Math.floor(t * 4) % 2) * 40]); R.xmax = 5; return R; }
      R.K1 = 1; R.K2 = 1; R.KT = 1; R.H1 = 1; R.conn = 'star';
      tl(0, F.k2weld ? 'K1 closes (K2 was already closed – welded). Motor starts in STAR.' : 'K2 (star) and K1 close – motor starts in STAR.');
      const pk0 = (ilr / 3) * 2.2, iiA = c.ii * 40;
      R.mark.push([0, 'start']);
      if (pk0 > iiA) { R.q0 = false; R.q0Trip = true; R.K1 = R.K2 = R.KT = R.H1 = 0; R.conn = ''; R.tr = [[0, 0], [0.01, ilr / 3], [0.05, 0]]; R.xmax = 2; tl(0.01, `Q0 trips at switch-on: the inrush peak ${Math.round(pk0)} A is above Ii = ${iiA} A.`, 1); return R; }
      if (F.hold && c.ev === 'start') { R.K1 = R.K2 = R.KT = R.H1 = 0; R.conn = ''; R.tr = [[0, 0], [0.02, 56], [0.6, 55], [0.62, 0]]; R.xmax = 3; tl(0.6, 'START released – K1 and K2 drop out immediately. The fan stops.', 1); return R; }
      if (F.phase) {
        const iL = 49, x = iL / c.olr, tt = Math.min(900, (0.5 * 300) / Math.max(0.05, x * x - 1));
        R.I = [iL, iL, 0]; R.wT = Math.min(240, 40 + 0.35 * (iL / 16.2) ** 2 * Math.min(tt, 300)); R.xmax = Math.min(120, tt + 10);
        for (let t = 0; t <= R.xmax; t += R.xmax / 40) R.tr.push([t, t < tt ? iL : 0]);
        tl(0.1, 'The motor hums loudly and does not turn (locked rotor on two phases).', 1);
        if (x > 1.1) { R.K1 = R.K2 = R.KT = R.H1 = 0; R.olrTrip = true; R.H2 = 1; R.conn = ''; R.I = [0, 0, 0]; R.mark.push([tt, 'F2 trips']); tl(tt, `F2 overload (phase-loss) trips after ${fmtS(tt)}. Winding reached about ${Math.round(R.wT)} °C${R.wT > 155 ? ' – insulation damaged' : ''}.`, 1); }
        else tl(5, 'F2 does not trip – the motor keeps humming and overheats.', 1);
        return R;
      }
      const tr = 5 * (1 + c.load), ise = c.load <= 0.8 ? c.load * flc * 1.15 : 45, ts = F.ktDead ? Infinity : c.tsd;
      const star = (t) => ise + (56 - ise) * (1 - Math.min(1, (t / tr) ** 3));
      const tEnd = Math.min(ts, 600);
      R.xmax = Math.min(60, Math.max(20, (Number.isFinite(ts) ? ts : 40) + 10));
      for (let t = 0; t <= Math.min(tEnd, R.xmax); t += 0.25) R.tr.push([t, star(t)]);
      tl(Math.min(tr, tEnd), Math.min(tr, tEnd) === tr ? `The fan has run up in star (${r1(tr)} s) – current down to ${Math.round(ise)} A.` : 'Still running up in star…');
      if (!Number.isFinite(ts) || F.k2weld) {
        const x = ise / c.olr, tt = x > 1.05 ? 300 / (x * x - 1) : null;
        R.spd = c.load <= 0.8 ? 0.93 : 0.8; R.I = [ise, ise, ise];
        tl(R.xmax - 5, F.k2weld ? 'Timer times out, K2 should open – but K2 is welded; the interlock keeps K3 out. Still in STAR.' : 'No change-over – the timer never times out. Still in STAR, humming, slow.', 1);
        if (tt) { R.olrTrip = true; R.H2 = 1; R.H1 = 0; R.K1 = R.KT = 0; R.conn = ''; R.spd = 0; R.I = [0, 0, 0]; tl(tt, `F2 overload trips after ${fmtS(tt)} (star current ${Math.round(ise)} A through the winding).`, 1); }
        return R;
      }
      const sp = Math.min(1, ts / tr), ichg = ilr * (1 - 0.8 * sp * sp), pk = ichg * 1.8;
      R.mark.push([ts, 'Y→Δ']);
      if (F.ilk) { R.q0 = false; R.q0Trip = true; R.K1 = R.K2 = R.KT = R.H1 = 0; R.conn = ''; R.tr.push([ts, 2400], [ts + 0.05, 0]); tl(ts, 'Change-over: K3 closes while K2 is still arcing – phase-to-phase short. Bang – Q0 trips.', 1); R.hot.K2 = 1; return R; }
      R.K2 = 0;
      if (F.k3open) { R.KT = 1; R.conn = ''; for (let t = ts; t <= R.xmax; t += 0.5) R.tr.push([t, 0]); tl(ts, 'Timer times out: K2 opens… K3 does NOT close. The motor windings are open – the fan coasts and stops. H1 still on.', 1); return R; }
      R.K3 = 1; R.conn = 'delta';
      const ir = c.load * flc;
      for (let t = ts; t <= R.xmax; t += 0.25) R.tr.push([t, t === ts ? Math.min(ichg, 300) : ir + (ichg - ir) * Math.exp(-(t - ts) / 0.4)]);
      tl(ts, `Change-over: K2 opens, K3 closes – DELTA. Current peak ${Math.round(ichg)} A${sp < 0.8 ? ' – the fan had not run up yet: almost direct-on-line current' : ''}.`, sp < 0.8);
      if (pk > iiA) { R.q0 = false; R.q0Trip = true; R.K1 = R.K3 = R.KT = R.H1 = 0; R.conn = ''; tl(ts + 0.01, `Q0 trips at change-over: transient peak ${Math.round(pk)} A above Ii = ${iiA} A.`, 1); return R; }
      R.spd = 0.98; R.I = [ir, F.k1burn ? ir * 0.94 : ir, ir]; R.wT = 40 + 45 * c.load * c.load;
      if (F.k1burn) { R.hot.K1 = 1; tl(ts + 2, 'K1 terminal L2 running hot (thermal camera 96 °C).', 1); }
      const iw = ir / Math.sqrt(3), x = iw / c.olr;
      if (x > 1.05) { const tt = 300 / (x * x - 1); R.olrTrip = true; R.H2 = 1; R.H1 = 0; R.K1 = R.K3 = R.KT = 0; R.conn = ''; R.spd = 0; R.I = [0, 0, 0]; tl(ts + tt, `F2 trips after ${fmtS(tt)} of normal running: winding current ${r1(iw)} A is above the ${c.olr} A setting.`, 1); }
      else tl(ts + 1, `Running in delta: ${r1(ir)} A per line, ${r1(iw)} A per winding (F2 set ${c.olr} A).`);
      if (c.olr > 20) tl(ts + 2, `Note: F2 at ${c.olr} A protects nothing – the winding current at full load is only 16 A.`, 1);
      return R;
    },
    tests: [
      ['vctl', 'Voltage at F1 outgoing (control supply)', (R) => `${R.f1 ? R.ctlV : 0} V`],
      ['vline', 'Line voltages at Q0 outgoing L1-L2 / L2-L3 / L3-L1', (R) => `${R.vl[0]} V / ${R.vl[1]} V / ${R.vl[2]} V`],
      ['vk1', 'Voltage across K1 coil A1-A2 (while START held)', (R, c, F) => (c.iso || !R.f1 || c.estop || F.stopOpen ? '0 V' : `${R.ctlV} V`)],
      ['vk3', 'Voltage across K3 coil A1-A2 after the star time', (R, c, F) => (c.iso || !R.f1 || R.K1 === 0 && !F.k3open ? '0 V' : F.k2weld || F.ktDead ? '0 V (K2 interlock open / timer not timed out)' : `${R.ctlV} V`)],
      ['clamp', 'Clamp meter – motor line currents L1 / L2 / L3', (R) => `${r1(R.I[0])} A / ${r1(R.I[1])} A / ${r1(R.I[2])} A`],
      ['therm', 'Thermal camera on the panel and motor', (R, c, F) => [R.hot.K1 ? 'K1 terminal L2: 96 °C (others 41 °C)' : 'Contactors 35–42 °C – normal', `Motor winding (estimated) ${Math.round(R.wT)} °C`, R.burnt ? 'Coils burnt (blackened)' : ''].filter(Boolean).join(' · ')],
      ['plate', 'Read the nameplate and the device labels', (R, c) => `Motor 15 kW 400 V Δ 28 A · coils fitted: ${c.coilV} V AC · F2 dial ${c.olr} A · KT ${c.tsd} s · Q0 Ii ${c.ii} × 40 A`],
      ['rk1', 'Coil resistance K1 A1-A2', (R, c) => (c.coilV === 24 ? '0.6 Ω – coil burnt / shorted' : c.coilV === 400 ? '1.6 kΩ (400 V coil)' : '560 Ω'), 1],
      ['rk3', 'Coil resistance K3 A1-A2', (R, c, F) => (F.k3open ? 'OL – coil open' : c.coilV === 24 ? '0.6 Ω – burnt' : c.coilV === 400 ? '1.6 kΩ' : '560 Ω'), 1],
      ['rstop', 'Continuity STOP button (NC)', (R, c, F) => (F.stopOpen ? 'OL – open (should be 0 Ω)' : '0.1 Ω'), 1],
      ['raux', 'K1 13-14 with K1 pushed in by hand', (R, c, F) => (F.hold ? 'OL – contact not closing' : '0.1 Ω'), 1],
      ['rilk', 'K2 21-22 (interlock) with K2 pushed in', (R, c, F) => (F.ilk ? '0 Ω – stays closed: bridged out!' : F.k2weld ? 'OL with K2 released too – K2 is stuck closed' : 'OL (opens correctly)'), 1],
      ['rk2', 'K2 main contacts with coil off', (R, c, F) => (F.k2weld ? '0.002 Ω on all three poles – WELDED' : 'OL – open, correct'), 1],
      ['rk1c', 'K1 main contact resistance (pushed in) L1 / L2 / L3', (R, c, F) => (F.k1burn ? '1 mΩ / 85 mΩ / 1 mΩ – L2 burnt' : '1 mΩ / 1 mΩ / 1 mΩ'), 1],
    ],
    view(R, c, F, sel) {
      let s = `<rect x="10" y="10" width="640" height="500" rx="8" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>${T(640, 28, 'Starter panel (inside)', 11, '#475569', 'end', 700)}`;
      s += [80, 220, 360].map((y) => `<rect x="20" y="${y + 36}" width="620" height="12" fill="#cbd5e1"/>`).join('');
      s += `<rect x="30" y="40" width="96" height="120" rx="4" fill="#d1d5db" stroke="#475569"/>${[0, 1, 2].map((i) => screw(48 + i * 30, 50) + screw(48 + i * 30, 150)).join('')}<rect x="66" y="${R.q0 ? 74 : R.q0Trip ? 88 : 104}" width="22" height="26" rx="3" fill="#1e293b"/>${T(77, 132, R.q0Trip ? 'TRIPPED' : R.q0 ? 'ON' : 'OFF', 8, R.q0Trip ? '#b91c1c' : '#14161c', 'middle', 700)}${dial(108, 132, (c.ii - 3) / 9, 'Ii', `${c.ii}×`, 8)}${T(78, 36, 'Q0  40 A', 10, '#14161c', 'middle', 700)}${hit('Q0', 26, 24, 104, 140, sel)}`;
      s += mcb(150, 60, 1, 'C2', 'F1', R.f1) + hit('F1', 146, 56, 28, 106, sel);
      s += relay(196, 60, 60, 'KT', [['#16a34a', R.ctlV > 0 && !c.iso, 'U'], ['#f59e0b', R.KT === 1, 'R']], [[(c.tsd - 1) / 29, 't', `${c.tsd}s`]], 'Y-Δ timer') + hit('KT', 192, 56, 68, 118, sel);
      s += cont(290, 200, 'K1', R.K1, { buzz: R.buzz, hot: R.hot.K1, burnt: R.burnt, sub: 'main' }) + hit('K1', 286, 186, 64, 128, sel);
      s += cont(370, 200, 'K2', R.K2, { weld: F.k2weld, buzz: R.buzz, hot: R.hot.K2, sub: 'star' }) + hit('K2', 366, 186, 64, 128, sel);
      s += cont(450, 200, 'K3', R.K3, { sub: 'delta' }) + hit('K3', 446, 186, 64, 128, sel);
      s += olr(290, 330, 'F2', c.olr, [9, 30], R.olrTrip) + hit('F2', 286, 326, 64, 70, sel);
      s += wire([[50, 160], [50, 180], [300, 180], [300, 200]], PH.L1) + wire([[78, 160], [78, 186], [318, 186], [318, 200]], PH.L2) + wire([[106, 160], [106, 192], [334, 192], [334, 200]], PH.L3);
      s += wire([[302, 284], [302, 330]], PH.L1) + wire([[318, 284], [318, 330]], PH.L2) + wire([[334, 284], [334, 330]], PH.L3);
      s += wire([[382, 284], [382, 292], [414, 292]], '#334155', 1.5) + wire([[398, 284], [398, 292]], '#334155', 1.5) + wire([[414, 284], [414, 292]], '#334155', 1.5) + T(418, 295, 'star point', 7, '#64748b', 'start');
      s += `<rect x="40" y="420" width="580" height="30" rx="3" fill="#e2e8f0" stroke="#94a3b8"/>${['U1', 'V1', 'W1', 'U2', 'V2', 'W2', 'PE'].map((t, i) => `<rect x="${60 + i * 34}" y="424" width="28" height="22" fill="#fff" stroke="#94a3b8"/>${T(74 + i * 34, 439, t, 8, '#14161c', 'middle', 700)}`).join('')}${T(330, 438, 'X1 – motor terminals', 9, '#475569', 'start')}`;
      s += wire([[302, 376], [302, 400], [74, 400], [74, 424]], PH.L1, 1.5) + wire([[318, 376], [318, 406], [108, 406], [108, 424]], PH.L2, 1.5) + wire([[334, 376], [334, 412], [142, 412], [142, 424]], PH.L3, 1.5) + wire([[462, 284], [462, 400], [176, 400], [176, 424]], '#475569', 1.2) + wire([[478, 284], [478, 406], [210, 406], [210, 424]], '#475569', 1.2) + wire([[494, 284], [494, 412], [244, 412], [244, 424]], '#475569', 1.2);
      s += `${T(560, 120, 'Control', 9, '#64748b')}${relay(530, 60, 60, 'TC', [['#16a34a', R.ctlV > 0 && R.f1 && !c.iso, '230V']], [], `${R.f1 && !c.iso ? R.ctlV : 0} V`)}` + hit('CT', 526, 56, 68, 118, sel);
      s += `<rect x="670" y="10" width="320" height="300" rx="10" fill="#e5e7eb" stroke="#64748b" stroke-width="2"/>${T(680, 28, 'Door', 11, '#475569', 'start', 700)}`;
      s += estop(720, 80, c.estop) + pb(790, 80, '#dc2626', 'STOP') + pb(850, 80, '#16a34a', 'START') + lamp(730, 170, '#22c55e', R.H1, 'H1 RUN') + lamp(800, 170, '#f59e0b', R.H2, 'H2 TRIP');
      const amps = R.I[0];
      s += `<rect x="860" y="140" width="110" height="84" rx="4" fill="#fff" stroke="#475569"/>${dial(915, 182, Math.min(1, amps / 60), '0 – 60 A', `${Math.round(amps)} A`, 22)}${T(915, 236, 'ammeter', 8, '#64748b')}`;
      s += T(830, 270, R.conn ? (R.conn === 'star' ? 'running in STAR (Y)' : 'running in DELTA (Δ)') : R.buzz ? 'contactors humming' : 'motor stopped', 11, R.conn ? '#15803d' : '#64748b', 'middle', 700) + hit('DOOR', 676, 40, 308, 260, sel);
      s += `<circle cx="830" cy="410" r="62" fill="#cbd5e1" stroke="#475569" stroke-width="3"/><g ${R.spd > 0.2 ? 'class="spin"' : ''} style="transform-origin:830px 410px">${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M830 410 L${r1(830 + 50 * Math.cos((i * Math.PI) / 3))} ${r1(410 + 50 * Math.sin((i * Math.PI) / 3))} A50 50 0 0 1 ${r1(830 + 50 * Math.cos((i * Math.PI) / 3 + 0.5))} ${r1(410 + 50 * Math.sin((i * Math.PI) / 3 + 0.5))} Z" fill="#94a3b8"/>`).join('')}</g><circle cx="830" cy="410" r="8" fill="#334155"/>${T(830, 492, `Fan motor · ${Math.round(R.spd * 1460)} rpm`, 10, '#14161c', 'middle', 700)}${hit('M', 764, 344, 132, 156, sel)}`;
      return s + `<style>@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin .6s linear infinite}</style>`;
    },
    chart: (R) => (R.tr.length ? chart(560, 200, R.xmax, 180, [{ pts: R.tr, c: '#244286', lab: 'line current' }], { yl: 'A', xl: 'seconds after START', marks: R.mark.map(([t, l]) => [t, l]), h: [[28, 'FLC 28 A', '#16a34a']] }) : ''),
  };

  // ---------------------------------------------------------------- 2. lighting control panel
  const hhmm = (h) => `${String(Math.floor(((h % 24) + 24) % 24)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
  const daylux = (h) => (h < 5.9 || h > 18.5 ? 0.5 : h < 6.5 ? 0.5 * 20000 ** ((h - 5.9) / 0.6) : h > 17.9 ? 0.5 * 20000 ** ((18.5 - h) / 0.6) : 10000);
  const inWin = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b);
  const MVAM = { 1.5: 29, 2.5: 18, 4: 11, 6: 7.3, 10: 4.4 }, IZ = { 1.5: 17.5, 2.5: 24, 4: 32, 6: 41, 10: 57 };
  const LC = [
    { id: 'C1', n: 'Car park floodlights', drv: 16, w: 150, mcb: 'c1', cab: 2.5, maxB: 10, maxC: 17 },
    { id: 'C2', n: 'Façade wash', drv: 24, w: 40, mcb: 'C10', cab: 1.5, maxB: 30, maxC: 50 },
    { id: 'C3', n: 'Path bollards', drv: 30, w: 20, mcb: 'C10', cab: 1.5, maxB: 40, maxC: 66 },
    { id: 'C4', n: 'Signage', drv: 4, w: 0, mcb: 'c4', cab: 'c4cab', maxB: 20, maxC: 34 },
    { id: 'C5', n: 'Access road lanterns (300 m)', drv: 10, w: 120, mcb: 'C10', cab: 'c5cab', maxB: 12, maxC: 20, len: 300 },
  ];
  PAN.light = {
    title: 'Lighting control panel – car park and façade',
    intro: 'Five lighting circuits switched by one 4-pole contactor KM1. In AUTO, KM1 is on when the photocell says dark AND the time switch is inside its ON window (16:30 → 06:30). Slide the time of day and watch.',
    parts: {
      Q0: ['Q0 – incomer 4-pole MCB 63 A', 'Feeds the panel.'],
      F0: ['F0 – control MCB 2 A', 'Feeds the time switch, photocell relay and the KM1 coil.'],
      TS: ['TS – digital time switch', 'ON window 16:30 → 06:30. Has a back-up battery that keeps the clock running through power cuts.'],
      PC: ['PC – photocell (on the roof)', 'Switches when the daylight falls below the set level (typically 20–50 lux). Must look at the sky, not at the lights.'],
      SA: ['SA – AUTO / OFF / MANUAL selector (door)', 'MANUAL bypasses the time switch and photocell – for testing only.'],
      KM1: ['KM1 – lighting contactor 4P 40 A', 'Switches the five circuits. LED drivers have a big capacitive inrush – contactors must be rated for it (AC-5a / LED rating) or they weld.'],
      C1: ['C1 – car park floods: 16 × 150 W LED', 'Driver datasheet: max 10 drivers on a B16, 17 on a C16 (inrush). Cable 2.5 mm² (Iz 24 A).'],
      C2: ['C2 – façade wash: 24 × 40 W LED', 'C10, 1.5 mm².'],
      C3: ['C3 – path bollards: 30 × 20 W LED', 'C10, 1.5 mm².'],
      C4: ['C4 – illuminated signage', 'The sign contractor may add signs – the circuit must stay within the MCB and cable rating: Ib ≤ In ≤ Iz.'],
      C5: ['C5 – access road lanterns, 300 m run', 'Long run: voltage drop matters. LED drivers drop out / flicker below about 210 V.'],
    },
    sets: [['c1', 'C1', 'C1 MCB', 'select', [['B16', 'B16'], ['C16', 'C16'], ['C20', 'C20']]], ['c4', 'C4', 'C4 MCB', 'select', [['C10', 'C10'], ['C16', 'C16'], ['C20', 'C20'], ['C32', 'C32']]], ['c4cab', 'C4', 'C4 cable mm²', 'select', [[1.5, '1.5'], [2.5, '2.5'], [4, '4'], [6, '6']]], ['c4kw', 'C4', 'Sign load', 'range', 0.5, 7, 0.1, ' kW'], ['c5cab', 'C5', 'C5 cable mm²', 'select', [[2.5, '2.5'], [4, '4'], [6, '6'], [10, '10']]], ['ton', 'TS', 'ON at', 'range', 0, 23.5, 0.5, ' h'], ['toff', 'TS', 'OFF at', 'range', 0, 23.5, 0.5, ' h'], ['lux', 'PC', 'Switch-on level', 'range', 5, 2000, 5, ' lux'], ['sa', 'SA', 'Selector', 'select', [['auto', 'AUTO'], ['off', 'OFF'], ['man', 'MANUAL']]]],
    init: () => ({ hr: 19, cut: false, sa: 'auto', ton: 16.5, toff: 6.5, lux: 30, c1: 'C16', c4: 'C16', c4cab: 2.5, c4kw: 2, c5cab: 6, iso: false }),
    ops: [
      { range: [0, 23.75, 0.25], l: () => 'Time of day', v: (c) => c.hr, fmt: (v) => hhmm(v), a: (c, v) => { c.hr = v; } },
      { l: (c) => `Selector: ${({ auto: 'AUTO', off: 'OFF', man: 'MANUAL' })[c.sa]}`, a: (c) => { c.sa = ({ auto: 'off', off: 'man', man: 'auto' })[c.sa]; } },
      { l: (c) => (c.cut ? '⚡ Power cut 01:00–03:00 last night' : 'No power cut last night'), on: (c) => c.cut, a: (c) => { c.cut = !c.cut; } },
      { l: (c) => (c.iso ? '🔒 Q0 off and locked' : 'Isolate Q0 and lock off'), on: (c) => c.iso, a: (c) => { c.iso = !c.iso; } },
    ],
    faults: [
      { id: 'kmweld', label: 'KM1 contacts welded', say: 'The car park lights stay on all day, even with the selector at OFF.', hint: 'Selector OFF: is there voltage on the KM1 coil? Are the lights still on?', why: 'LED driver inrush welded the KM1 main contacts. The coil is off but the contacts stay closed.', fix: 'Replace KM1 with a contactor rated for LED / capacitive loads (AC-5a, or a contactor with inrush rating), or add inrush limiters.' },
      { id: 'kmcoil', label: 'KM1 coil open circuit', say: 'None of the outside lights come on at night – not even on MANUAL.', hint: 'Selector MANUAL: measure the voltage across KM1 A1-A2, then the coil resistance.', why: 'The coil has 230 V across it but is open: KM1 never closes.', fix: 'Replace the coil (or the contactor).' },
      { id: 'tsbatt', label: 'Time switch back-up battery dead', say: 'Since the power cut last week the lights go off at 03:30 in the morning and come on late.', hint: 'Read the time switch clock and compare with the real time. Was there a power cut?', why: 'The back-up battery is flat: after a power cut the clock restarts from 00:00 and runs 3 hours late (or with the wrong date).', fix: 'Replace the battery (or the time switch), set the clock. Astronomical time switches with GPS/radio sync avoid this.' },
      { id: 'tsrelay', label: 'Time switch output contact failed', say: 'The lights only work with the selector on MANUAL.', hint: 'AUTO at night: the photocell says dark, the time switch display says ON – is there voltage on its output terminal?', why: 'The output relay of the time switch does not close: AUTO never energises KM1; MANUAL bypasses it.', fix: 'Replace the time switch.' },
      { id: 'pcdirty', label: 'Photocell dirty / covered', say: 'The car park lights come on at 16:30 in bright daylight.', hint: 'Measure the light level at the photocell and compare with what the photocell reports.', why: 'Dirt / bird mess / paint on the photocell window: it sees dark all the time. The lights come on as soon as the time switch window opens.', fix: 'Clean or replace the photocell; check it is facing north (away from the sun) and the sky.' },
      { id: 'pcface', label: 'Photocell sees the floodlights', say: 'At dusk the lights keep switching on and off every minute or so.', hint: 'Where is the photocell looking? What happens to the light level at the photocell when the floods come on?', why: 'The photocell sees light from the car park floods: lights on → photocell says "day" → lights off → "dark" → on … (cycling).', fix: 'Move / shield the photocell so it only sees the sky.' },
      { id: 'c2n', label: 'Loose neutral on C2 at the terminal', say: 'The façade lights flicker and a few drivers have failed.', hint: 'Thermal camera on the terminal rail, then voltage at a façade fitting.', why: 'A loose neutral connection: arcing, voltage variations and heating – drivers fail early.', fix: 'Isolate, re-terminate the neutral with the correct torque, replace damaged ferrule/terminal.' },
      { id: 'manual', label: 'Selector left on MANUAL', say: 'The lights are on day and night.', hint: 'Look at the door.', why: 'MANUAL bypasses the photocell and time switch.', fix: 'Return the selector to AUTO.', set: { sa: 'man' } },
      { id: 'tswrong', label: 'Time switch programmed the wrong way round', say: 'The outside lights never come on at night.', hint: 'Read the time switch program.', why: 'ON 06:30 / OFF 16:30 – the window is the day, and in the day the photocell says light.', fix: 'Program ON 16:30 → OFF 06:30 (or use an astronomical time switch).', set: { ton: 6.5, toff: 16.5 } },
      { id: 'luxhigh', label: 'Photocell switch-on level set far too high', say: 'The lights come on in the afternoon whenever it is cloudy.', hint: 'Read the photocell setting.', why: 'At 2000 lux the photocell says "dark" on a cloudy afternoon. Normal setting is 20–50 lux.', fix: 'Set 30 lux.', set: { lux: 2000 } },
      { id: 'c1b', label: 'C1: B-curve MCB too small for the LED inrush', say: 'Circuit C1 trips every evening the moment the lights come on – it resets fine later.', hint: 'Count the drivers and read the driver datasheet: maximum drivers per MCB type.', why: '16 drivers on a B16 – the datasheet allows 10. The combined capacitor inrush trips the magnetic part of the B-curve MCB.', fix: 'Use a C16 (17 allowed), split the circuit, or add an inrush limiter.', set: { c1: 'B16' } },
      { id: 'c4big', label: 'C4: MCB larger than the cable can carry', say: 'The sign contractor added more signs. The C4 cable is discoloured and hot – but the MCB never trips.', hint: 'Compare the load current, the MCB rating and the cable rating: Ib ≤ In ≤ Iz.', why: 'C32 on 2.5 mm² (Iz 24 A): the cable carries 24 A continuously and is not protected against overload.', fix: 'MCB must not exceed the cable rating: C20 max on 2.5 mm² here, and a bigger cable (6 mm²) for the extra signs.', set: { c4: 'C32', c4kw: 5.5 } },
      { id: 'c4small', label: 'C4: MCB too small for the load', say: 'The signage goes off about an hour after it comes on, every night.', hint: 'Clamp the C4 current and compare it with the MCB rating.', why: '2.6 kW = 11.3 A on a C10: 1.13 × In – the thermal part trips after about an hour.', fix: 'C16 on the 2.5 mm² cable (Ib 11.3 ≤ In 16 ≤ Iz 24).', set: { c4: 'C10', c4kw: 2.6 } },
      { id: 'c5thin', label: 'C5: cable too small for the 300 m run (voltage drop)', say: 'The last lanterns on the access road flicker or go out late at night.', hint: 'Measure the voltage at the last lantern with the lights on.', why: '2.5 mm² over 300 m: 28 V drop (12 %). The far drivers get under 200 V and drop out.', fix: 'Up-size to 10 mm² (3 % drop) or feed from the middle.', set: { c5cab: 2.5 } },
    ],
    sim(c, F) {
      const R = { tl: [], km: 0, coil: 0, pcDark: false, win: false, clk: c.hr, ckt: {}, lux: daylux(c.hr), day: [] };
      const tl = (s, bad) => R.tl.push([null, s, bad]);
      if (c.iso) { tl('Q0 off and locked – the panel is dead.'); LC.forEach((k) => (R.ckt[k.id] = { on: 0, I: 0, st: 'off' })); return R; }
      const clk = (h) => (F.tsbatt && c.cut && h >= 3 ? h - 3 : h);
      const state = (h, prevOn) => {
        const seen = F.pcdirty ? daylux(h) * 0.002 : daylux(h) + (F.pcface && prevOn ? 400 : 0);
        const dark = seen < c.lux, win = inWin(clk(h), c.ton, c.toff);
        const coil = !F.kmcoil && (c.sa === 'man' || (c.sa === 'auto' && dark && win && !F.tsrelay));
        return { dark, win, seen, coilV: c.sa === 'man' || (c.sa === 'auto' && dark && win && !F.tsrelay), on: coil || F.kmweld };
      };
      for (let h = 0; h <= 24; h += 0.25) { const s = state(h, false), cyc = F.pcface && s.on && !state(h, true).on; R.day.push([h, cyc ? 0.5 : s.on ? 1 : 0, s.dark ? 1 : 0]); }
      const s = state(c.hr, false), s2 = F.pcface ? state(c.hr, s.on) : s;
      R.pcDark = s.dark; R.win = s.win; R.coil = s.coilV; R.km = s.on; R.seen = s.seen; R.clk = clk(c.hr);
      R.cycle = F.pcface && s.on && !s2.on;
      tl(`${hhmm(c.hr)} – daylight ${R.lux >= 100 ? Math.round(R.lux) : r1(R.lux)} lux at the photocell${F.pcdirty ? ` (it sees only ${r1(s.seen)} lux)` : ''} → photocell says ${s.dark ? 'DARK' : 'LIGHT'}.`);
      tl(`Time switch clock reads ${hhmm(R.clk)}${R.clk !== c.hr ? ` – WRONG (real time ${hhmm(c.hr)})` : ''} → ${s.win ? 'inside' : 'outside'} its ON window ${hhmm(c.ton)}–${hhmm(c.toff)}.`, R.clk !== c.hr);
      tl(`Selector ${({ auto: 'AUTO', off: 'OFF', man: 'MANUAL' })[c.sa]} → KM1 coil ${s.coilV ? '230 V' : '0 V'}${s.coilV && F.kmcoil ? ' – but KM1 does not close' : ''}${!s.coilV && F.kmweld ? ' – but KM1 is still CLOSED' : ''}.`, (s.coilV && F.kmcoil) || (!s.coilV && F.kmweld));
      if (R.cycle) tl('The floods light the photocell: it now says LIGHT → KM1 drops → dark again → on … cycling about every minute.', 1);
      const daytime = R.lux > 1000;
      LC.forEach((k) => {
        const mcb = /^[BC]\d/.test(k.mcb) ? k.mcb : c[k.mcb], cab = typeof k.cab === 'string' ? c[k.cab] : k.cab, In = +mcb.slice(1), curve = mcb[0];
        const watts = k.id === 'C4' ? c.c4kw * 1000 : k.drv * k.w, Ib = watts / 230, iz = IZ[cab];
        const r = { mcb, cab, In, Ib, iz, on: 0, I: 0, st: 'off', notes: [] };
        if (R.km) {
          const maxN = curve === 'B' ? k.maxB : k.maxC;
          if (k.id !== 'C4' && k.drv > maxN) { r.st = 'tripped'; r.notes.push(`tripped at switch-on (inrush: ${k.drv} drivers, max ${maxN} on a ${mcb})`); }
          else if (Ib / In > 1.13) { r.on = 1; r.I = Ib; r.st = 'trips later'; r.notes.push(`${r1(Ib)} A on a ${mcb} (${r1(Ib / In)} × In) – thermal trip after about ${Ib / In > 1.45 ? '10 min' : '1 hour'}`); }
          else { r.on = 1; r.I = Ib; r.st = 'on'; }
          if (r.on && Ib > iz * 0.95) r.notes.push(`cable ${cab} mm² carries ${r1(Ib)} A (Iz ${iz} A) – hot`);
          if (k.len && r.on) { const vd = (MVAM[cab] * Ib * k.len) / 1000, ve = 225 - vd; r.vend = ve; if (ve < 210) { r.st = 'flicker'; r.notes.push(`${r1(vd)} V drop – last lantern gets ${Math.round(ve)} V: drivers drop out`); } }
          if (k.id === 'C2' && F.c2n && r.on) { r.st = 'flicker'; r.notes.push('flickering – loose neutral'); }
        }
        if (In > iz) r.notes.push(`${mcb} on ${cab} mm² (Iz ${iz} A): cable not protected against overload`);
        R.ckt[k.id] = r;
      });
      LC.forEach((k) => { const r = R.ckt[k.id]; tl(`${k.id} ${k.n}: ${r.st.toUpperCase()}${r.notes.length ? ' – ' + r.notes.join('; ') : ''}`, r.st === 'tripped' || r.st === 'flicker' || r.st === 'trips later' || r.notes.some((n) => /hot|not protected/.test(n))); });
      if (R.km && daytime) tl('Lights ON in daylight – wasting energy.', 1);
      if (!R.km && !daytime && c.hr > 19 || !R.km && c.hr < 5) tl('Lights OFF at night – car park dark.', 1);
      return R;
    },
    tests: [
      ['lux', 'Lux meter next to the photocell', (R, c, F) => `${R.lux >= 100 ? Math.round(R.lux) : r1(R.lux)} lux${F.pcface && R.km ? ' · plus about 400 lux from the floodlights when they are on!' : ''}`],
      ['pcout', 'Photocell relay output (live)', (R, c) => (c.iso ? '0 V' : R.pcDark ? '230 V – says DARK' : '0 V – says LIGHT')],
      ['tsdisp', 'Read the time switch display', (R, c) => `Clock ${hhmm(R.clk)} · program ON ${hhmm(c.ton)} OFF ${hhmm(c.toff)} · ${R.win ? 'channel ON' : 'channel OFF'}`],
      ['tsout', 'Voltage at the time switch output terminal', (R, c, F) => (c.iso ? '0 V' : R.win && R.pcDark && c.sa === 'auto' ? (F.tsrelay ? '0 V – display says ON but no output!' : '230 V') : '0 V')],
      ['vcoil', 'Voltage across KM1 coil A1-A2', (R, c) => (c.iso ? '0 V' : R.coil ? '230 V' : '0 V')],
      ['clamp', 'Clamp meter on each circuit C1…C5', (R) => LC.map((k) => `${k.id} ${r1(R.ckt[k.id].I)} A`).join(' · ')],
      ['vend', 'Voltage at the last lantern on C5', (R) => (R.ckt.C5.on ? `${Math.round(R.ckt.C5.vend)} V` : '0 V – circuit off')],
      ['therm', 'Thermal camera on the panel', (R, c, F) => [F.c2n ? 'C2 neutral terminal 88 °C' : '', R.ckt.C4 && R.ckt.C4.I > R.ckt.C4.iz * 0.95 ? `C4 cable ${Math.round(30 + 40 * (R.ckt.C4.I / R.ckt.C4.iz) ** 2)} °C (PVC limit 70 °C)` : '', R.ckt.C4 && R.ckt.C4.st === 'trips later' ? 'C4 MCB warm 52 °C' : ''].filter(Boolean).join(' · ') || 'Nothing unusual (28–38 °C)'],
      ['ds', 'Driver datasheet – max drivers per MCB', () => 'C1 150 W driver: B16 → 10, C16 → 17 · C5 120 W: B10 → 12, C10 → 20'],
      ['rcoil', 'KM1 coil resistance', (R, c, F) => (F.kmcoil ? 'OL – coil open' : '480 Ω'), 1],
      ['rkm', 'KM1 main contacts with the coil off', (R, c, F) => (F.kmweld ? '0.002 Ω on L1 and L2 – welded!' : 'OL – open, correct'), 1],
    ],
    view(R, c, F, sel) {
      let s = `<rect x="10" y="10" width="620" height="500" rx="8" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>${T(620, 28, 'Lighting control panel (inside)', 11, '#475569', 'end', 700)}`;
      s += [40, 200, 360].map((y) => `<rect x="20" y="${y + 36}" width="600" height="12" fill="#cbd5e1"/>`).join('');
      s += mcb(30, 40, 4, 'C63', 'Q0', !c.iso) + hit('Q0', 26, 36, 88, 110, sel) + mcb(126, 40, 1, 'C2', 'F0', !c.iso) + hit('F0', 122, 36, 28, 110, sel);
      s += `<rect x="170" y="40" width="96" height="84" rx="3" fill="#f8fafc" stroke="#94a3b8"/>${lcd(178, 48, 80, 40, [hhmm(R.clk), R.win ? 'CH1 ON' : 'CH1 OFF', ''], '#1f3b2c', R.clk !== c.hr ? '#fca5a5' : '#a7f3d0')}${led(190, 104, '#16a34a', R.win && !c.iso && !F.tsrelay, 'out')}${led(246, 104, '#f59e0b', F.tsbatt, 'bat')}${T(218, 138, 'TS', 10, '#14161c', 'middle', 700)}${hit('TS', 166, 36, 104, 110, sel)}`;
      s += relay(286, 40, 60, 'PC relay', [['#7c3aed', R.pcDark && !c.iso, 'dark']], [[Math.log10(c.lux / 5) / Math.log10(400), 'lux', c.lux]]) + hit('PC', 282, 36, 68, 110, sel);
      s += cont(380, 200, 'KM1', R.km, { weld: F.kmweld, sub: '4P 40 A' }) + hit('KM1', 376, 186, 64, 128, sel);
      LC.forEach((k, i) => { const r = R.ckt[k.id], x = 40 + i * 60; s += mcb(x, 360, 1, r.mcb || '', k.id, r.st !== 'tripped' && !c.iso, r.notes && r.notes.some((n) => /hot|thermal/.test(n))) + hit(k.id, x - 4, 356, 30, 110, sel); s += wire([[x + 10, 360], [x + 10, 340], [400 + (i % 4) * 8, 340], [400 + (i % 4) * 8, 284]], i === 4 ? PH.L2 : PH.L1, 1.2); });
      s += wire([[50, 124], [50, 160], [392, 160], [392, 200]], PH.L1, 1.6) + wire([[70, 124], [70, 166], [408, 166], [408, 200]], PH.L2, 1.6);
      s += `<rect x="640" y="10" width="350" height="190" rx="10" fill="#e5e7eb" stroke="#64748b" stroke-width="2"/>${T(650, 28, 'Door', 11, '#475569', 'start', 700)}`;
      const ang = { auto: 0, off: -45, man: 45 }[c.sa];
      s += `<circle cx="720" cy="100" r="30" fill="#f8fafc" stroke="#475569"/><rect x="716" y="74" width="8" height="40" rx="3" fill="#1e293b" transform="rotate(${ang} 720 100)"/>${T(690, 64, 'OFF', 8, '#475569')}${T(720, 60, 'AUTO', 8, '#475569')}${T(752, 64, 'MAN', 8, '#475569')}${T(720, 148, 'SA', 10, '#14161c', 'middle', 700)}${hit('SA', 680, 50, 80, 110, sel)}`;
      s += lamp(820, 100, '#22c55e', R.km && !c.iso, 'LIGHTS ON') + lamp(900, 100, '#f59e0b', LC.some((k) => R.ckt[k.id].st === 'tripped'), 'MCB TRIP');
      s += `<rect x="640" y="210" width="350" height="300" rx="10" fill="${R.lux > 1000 ? '#e0f2fe' : R.lux > 5 ? '#475569' : '#0f172a'}"/>${T(650, 228, 'Outside', 11, R.lux > 1000 ? '#475569' : '#cbd5e1', 'start', 700)}`;
      s += `<g>${T(950, 240, '☁', 18, '#94a3b8')}<rect x="930" y="250" width="28" height="18" rx="4" fill="${F.pcdirty ? '#78716c' : '#f8fafc'}" stroke="#334155"/>${T(944, 282, 'PC', 9, R.lux > 1000 ? '#475569' : '#cbd5e1', 'middle', 700)}</g>${hit('PC', 922, 232, 46, 56, sel)}`;
      LC.forEach((k, i) => { const r = R.ckt[k.id], on = r.on && r.st !== 'tripped', y = 270 + i * 46, fl = r.st === 'flicker'; s += `${T(652, y + 4, k.id, 10, R.lux > 1000 ? '#334155' : '#e2e8f0', 'start', 700)}${Array.from({ length: 6 }, (_, j) => `<circle cx="${690 + j * 34}" cy="${y}" r="9" fill="${on ? '#fde68a' : '#334155'}" stroke="#94a3b8" ${on && fl && (k.id !== 'C5' || j >= 3) ? 'class="blink"' : ''} ${on && !fl ? 'style="filter:drop-shadow(0 0 6px #fde68a)"' : ''}/>`).join('')}${T(900, y + 4, r.st, 9, r.st === 'on' ? '#86efac' : r.st === 'off' ? '#94a3b8' : '#fca5a5', 'start', 700)}`; });
      return s;
    },
    chart: (R, c) => chart(560, 200, 24, 2.4, [{ pts: R.day.flatMap(([h, on], i, a) => (i ? [[h, a[i - 1][1]], [h, on]] : [[h, on]])), c: '#16a34a', lab: 'lights (½ = cycling)' }, { pts: R.day.flatMap(([h, , d], i, a) => (i ? [[h, a[i - 1][2] ? 2.1 : 1.3], [h, d ? 2.1 : 1.3]] : [[h, d ? 2.1 : 1.3]])), c: '#7c3aed', lab: 'photocell dark' }], { yl: 'state over 24 h', xl: 'hour of day', noY: true, marks: [[c.hr, 'now']] }),
  };
  PAN.light.iso = (c) => c.iso;

  // ---------------------------------------------------------------- 3. main switchboard protection – MCCB trip unit, PFR, EFR + CBCT
  const PEV = { load: ['Normal day load', 350, 'Incomer 350 A, neutral 140 A (IT and LED loads), pump room 40 A.'], motor: ['Chiller starts on F1', 1750, 'Chiller compressor start: 1 400 A for 0.5 s on F1, on top of the 350 A load.'], sc: ['Short circuit on F1 feeder', 8000, 'A 3-phase short circuit at the far end of the F1 cable: 8 kA.'], ef2: ['Earth fault on the pump (F2)', 350, 'Pump motor winding to frame: 2 A earth fault current.'], lose: ['Phase L2 lost upstream', 300, 'A utility fuse on L2 blows.'], seq: ['Phase sequence reversed (after utility works)', 350, 'The utility reconnected the service cable L1-L3 swapped.'], dip: ['Voltage dip to 80 % for 0.3 s', 350, 'A big load starts in the neighbourhood.'], uv: ['Low supply: 196 V for hours', 350, 'Evening peak – the supply sits at 196 V (85 %).'] };
  PAN.prot = {
    title: 'Main switchboard – incomer MCCB trip unit, PFR, EFR',
    intro: 'Incomer Q1 is a 400 A MCCB with an electronic LSIG trip unit. F1 (250 A, thermal-magnetic) feeds the chiller plant, F2 (125 A) the pump room with an earth-fault relay (EFR) and core-balance CT. A phase failure relay (PFR) holds the incomer\'s under-voltage release. Pick an event and see who trips.',
    parts: {
      Q1: ['Q1 – incomer MCCB 400 A, LSIG trip unit', 'L: long time (overload) Ir × In, tr at 6 × Ir. S: short time Isd × Ir with delay tsd – this delay gives discrimination with the feeders. I: instantaneous Ii × In (OFF for full discrimination). G: earth fault Ig × In, tg. A 4-pole board needs the neutral CT (ENCT) connected or the neutral current looks like an earth fault.'],
      F1: ['F1 – chiller feeder MCCB 250 A (thermal-magnetic)', 'Thermal trip 250 A, magnetic trip 10 × In = 2 500 A instantaneous.'],
      F2: ['F2 – pump room feeder MCCB 125 A + shunt trip MX', 'The EFR trips it through the shunt trip coil MX.'],
      EFR: ['EFR – earth-fault relay with CBCT', 'Core-balance CT around ALL live conductors (L1 L2 L3 N) – never the earth wire. IΔn and delay are set on the relay.'],
      CBCT: ['CBCT – core-balance current transformer', 'Measures the residual (unbalanced) current = earth leakage. Phases AND neutral through it; the PE conductor outside it.'],
      PFR: ['PFR – phase failure relay', 'Watches all three phases: loss, sequence, asymmetry, under/over voltage. Its contact holds the incomer\'s under-voltage release MN – when the PFR trips, Q1 opens. Delay rides through short dips.'],
      MET: ['Multi-function meter', 'Voltages, currents, neutral current.'],
    },
    sets: [['ir', 'Q1', 'Ir (× 400 A)', 'range', 0.4, 1, 0.05, ''], ['tr', 'Q1', 'tr (s at 6 Ir)', 'range', 2, 24, 1, ' s'], ['isd', 'Q1', 'Isd (× Ir)', 'range', 1.5, 10, 0.5, ''], ['tsd', 'Q1', 'tsd', 'select', [[0, '0 s (instant)'], [0.1, '0.1 s'], [0.2, '0.2 s'], [0.3, '0.3 s'], [0.4, '0.4 s']]], ['ii', 'Q1', 'Ii (× 400 A)', 'select', [[4, '4'], [6, '6'], [8, '8'], [12, '12'], [15, '15'], ['off', 'OFF']]], ['ig', 'Q1', 'Ig (× 400 A)', 'range', 0.2, 1, 0.1, ''], ['tg', 'Q1', 'tg', 'select', [[0.1, '0.1 s'], [0.2, '0.2 s'], [0.4, '0.4 s']]], ['efr', 'EFR', 'IΔn', 'select', [[0.3, '0.3 A'], [1, '1 A'], [3, '3 A'], [10, '10 A'], [30, '30 A']]], ['efrT', 'EFR', 'Delay', 'select', [[0, '0 s'], [0.1, '0.1 s'], [0.5, '0.5 s'], [1, '1 s']]], ['pU', 'PFR', 'Under-voltage U<', 'range', 75, 95, 1, ' %'], ['pT', 'PFR', 'Delay', 'select', [[0.1, '0.1 s'], [0.5, '0.5 s'], [2, '2 s'], [5, '5 s']]], ['pSeq', 'PFR', 'Phase sequence check', 'select', [['on', 'ON'], ['off', 'OFF']]]],
    init: () => ({ ir: 0.9, tr: 12, isd: 6, tsd: 0.2, ii: 'off', ig: 0.3, tg: 0.2, efr: 1, efrT: 0.5, pU: 85, pT: 2, pSeq: 'on', ev: 'load', iso: false }),
    ops: [...Object.keys(PEV).map((k) => ({ l: () => PEV[k][0], on: (c) => c.ev === k, a: (c) => { c.ev = k; c.iso = false; } })), { l: (c) => (c.iso ? '🔒 Q1 off and locked' : 'Isolate Q1 and lock off'), on: (c) => c.iso, a: (c) => { c.iso = !c.iso; } }],
    faults: [
      { id: 'enct', label: 'Incomer neutral CT (ENCT) not connected', say: 'The incomer trips on earth fault (G) during busy office hours – nobody can find an earth fault.', hint: 'Read the trip unit\'s last trip cause and compare the neutral current with the Ig setting.', why: 'In a 4-pole board the trip unit must see the neutral current too. Without ENCT it adds only L1+L2+L3: the 140 A of neutral current looks like an earth fault.', fix: 'Connect the external neutral CT to the trip unit (or set the unit to 3P+N correctly).' },
      { id: 'cbctE', label: 'Earth wire passed through the CBCT', say: 'The pump tripped its RCD-style alarm once, but now a real earth fault on the pump does not trip anything – the pump casing gave someone a shock.', hint: 'What passes through the CBCT ring? The earth fault current returns along which conductor?', why: 'The fault current goes out on the phase and back on the PE – both through the CBCT, so they cancel. The relay sees nothing.', fix: 'Take the PE conductor outside the CBCT (or back through it once more to cancel – check the manual).' },
      { id: 'cbctN', label: 'Neutral not passed through the CBCT', say: 'The pump room feeder trips on earth fault every time the lights and sockets in the pump room are on.', hint: 'The CBCT should see L1 L2 L3 AND N. What does it read with normal load?', why: 'With the neutral outside, the single-phase load current in the phases has no return through the CBCT: it reads 18 A residual – a false earth fault.', fix: 'Pass the neutral through the CBCT with the phases.' },
      { id: 'shunt', label: 'F2 shunt trip coil (MX) burnt / not wired', say: 'The EFR shows TRIPPED but the pump feeder stays on.', hint: 'The relay trips – what should open the MCCB? Test the coil.', why: 'The EFR closes its contact but the shunt trip coil is open – the MCCB never trips. The earth fault stays on.', fix: 'Replace the MX coil, test the trip chain regularly (test button on the relay).' },
      { id: 'pfrFuse', label: 'PFR supply / sensing fuse blown', say: 'The main incomer will not close – it trips free as soon as it is closed.', hint: 'What holds the under-voltage release of Q1? Is the PFR powered?', why: 'With no supply the PFR drops its contact, the under-voltage release (MN) is de-energised and Q1 cannot close.', fix: 'Replace the sensing fuse, find why it blew.' },
      { id: 'hotlug', label: 'Incomer L3 cable lug loose', say: 'The switchboard room smells hot; the L3 cable insulation at the incomer is brown.', hint: 'Thermal camera on the incomer terminals under load.', why: 'A loose lug has high resistance: at 350 A it dissipates hundreds of watts.', fix: 'Isolate, clean and re-make the lug, torque to the maker\'s value, re-check with thermal camera.' },
      { id: 'irLow', label: 'Incomer Ir set too low', say: 'The incomer trips a few minutes after the afternoon peak starts.', hint: 'Compare the peak load current with Ir × 400 A.', why: 'Ir 0.6 = 240 A, the load is 350 A: long-time (overload) trip after a few minutes.', fix: 'Set Ir to cover the maximum demand (0.9 = 360 A) – check the cable rating too.', set: { ir: 0.6 } },
      { id: 'isdLow', label: 'Incomer short-time pick-up Isd set too low', say: 'The whole building goes dark when the chiller starts.', hint: 'Starting current 1 400 A + load. Where does the S part of the incomer curve start?', why: 'Isd 2 × Ir = 720 A; the chiller start puts 1 750 A through the incomer for 0.5 s – longer than tsd.', fix: 'Raise Isd above the starting current (6 × Ir = 2 160 A).', set: { isd: 2 } },
      { id: 'tsd0', label: 'Incomer short-time delay tsd = 0 (no discrimination)', say: 'A short circuit on the chiller feeder blacked out the whole building.', hint: 'For a fault on F1, which breaker should trip first and how is the incomer kept waiting?', why: 'With tsd = 0 the incomer trips as fast as F1 – no time discrimination.', fix: 'tsd 0.2 s (S part above the feeder\'s magnetic trip time) and Ii OFF.', set: { tsd: 0 } },
      { id: 'iiLow', label: 'Incomer instantaneous Ii set low', say: 'The incomer trips with the chiller starts and with every feeder fault.', hint: 'Where is the instantaneous trip level compared with 1 750 A and 8 kA?', why: 'Ii 4 × 400 = 1 600 A – instant trip on the chiller start and on any feeder short circuit.', fix: 'Ii OFF (or above the maximum feeder fault level) for discrimination.', set: { ii: 4 } },
      { id: 'efrHigh', label: 'EFR set far too high (30 A)', say: 'The pump casing was found live at 50 V after an earth fault – the EFR never tripped.', hint: 'Read the EFR IΔn. What is the fault current?', why: 'A 2 A earth fault on a 30 A setting never trips.', fix: 'Set IΔn to suit the circuit (e.g. 1 A with 0.5 s for a pump room; 30 mA RCDs for sockets).', set: { efr: 30 } },
      { id: 'efrFast', label: 'EFR set too sensitive and instant', say: 'The pump feeder trips at random, usually when the pumps start.', hint: 'Compare the normal leakage of the pump drives with the setting.', why: '0.3 A, 0 s: the normal 0.2 A leakage of the VFD filters plus switching spikes reach the setting.', fix: 'IΔn 1 A with 0.5 s delay (or a relay with harmonic filtering).', set: { efr: 0.3, efrT: 0 } },
      { id: 'pfrU', label: 'PFR set too tight (U< 95 %, 0.1 s)', say: 'The building blacks out whenever the voltage dips – a few times a week.', hint: 'Read the PFR settings and look at the dip event.', why: 'U< at 95 % with 0.1 s trips on every short dip and on the normal low evening voltage.', fix: 'U< about 80–85 %, delay 2–5 s (ride through dips).', set: { pU: 95, pT: 0.1 } },
      { id: 'pfrSeq', label: 'PFR sequence check switched OFF', say: 'After the utility worked on the supply, the pumps and fans run backwards.', hint: 'Phase rotation meter on the incoming supply. Why didn\'t the PFR stop it?', why: 'The sequence check is off, so a reversed supply is accepted – every 3-phase motor reverses.', fix: 'Switch the sequence check ON; get the utility to correct the rotation.', set: { pSeq: 'off' } },
    ],
    sim(c, F) {
      const In = 400, Ir = c.ir * In, R = { tl: [], q1: !c.iso, f1: true, f2: true, efrTrip: false, pfrOk: true, pfrLed: '', trips: [], I: 0, In: 0, V: [231, 230, 229], sev: '', resid: 0.2, rot: 'L1-L2-L3 (clockwise)', hot: false };
      const tl = (t, s, bad) => R.tl.push([t, s, bad]);
      const fin = (I) => { const ts = []; if (I > 1.05 * Ir) ts.push(c.tr * (6 * Ir / I) ** 2); if (I > c.isd * Ir) ts.push(c.tsd || 0.03); if (c.ii !== 'off' && I > c.ii * In) ts.push(0.02); return ts.length ? Math.min(...ts) : null; };
      const ff1 = (I) => (I > 2500 ? 0.015 : I > 262 ? Math.min(9000, 400 / ((I / 250) ** 2 - 1)) : null);
      R.fin = fin; R.ff1 = ff1;
      if (c.iso) { tl(0, 'Q1 off and locked – the board is dead.'); R.V = [0, 0, 0]; return R; }
      const ev = c.ev, e = PEV[ev];
      tl(0, e[2]);
      if (F.pfrFuse) { R.q1 = false; R.pfrOk = false; R.V = [0, 0, 0]; tl(0, 'Q1 trips free as soon as it is closed – the under-voltage release MN has no supply (PFR dead, all LEDs off).', 1); return R; }
      R.I = ev === 'motor' ? 1750 : ev === 'sc' ? 8000 : ev === 'lose' ? 300 : 350; R.In = ev === 'lose' ? 260 : 140; R.sev = ev;
      if (F.hotlug) { R.hot = true; tl(1, 'Thermal camera: Q1 L3 incoming lug 118 °C – L1/L2 46 °C.', 1); }
      const iTrip = (t, why) => { R.q1 = false; tl(t, `Q1 INCOMER TRIPS (${why}) – the whole building is dark.`, 1); };
      if (ev === 'load' || ev === 'ef2' || ev === 'dip' || ev === 'uv' || ev === 'seq') {
        const t = fin(350); if (t != null) iTrip(t, `long time: 350 A > ${1.05 * Ir} A`);
        if (F.enct) { const resid = R.In; if (resid > c.ig * In) iTrip(c.tg, `earth fault G: the unit "sees" ${resid} A residual – really the neutral current (ENCT missing), Ig ${c.ig * In} A`); }
        const leak = ev === 'ef2' ? 2.2 : 0.2, seen = F.cbctE ? 0.02 : F.cbctN ? 18 + leak : leak; R.resid = seen;
        if (seen > c.efr || (c.efrT === 0 && seen > c.efr * 0.6)) { R.efrTrip = true; if (F.shunt) tl(c.efrT || 0.02, `EFR trips (${r1(seen)} A seen, IΔn ${c.efr} A) – but F2 stays CLOSED: the shunt trip coil does not operate.`, 1); else { R.f2 = false; tl(c.efrT || 0.02, `EFR trips F2 (${r1(seen)} A seen ≥ IΔn ${c.efr} A)${ev === 'ef2' ? ' – correct' : F.cbctN ? ' – but there is no earth fault: it sees the neutral current' : ' – nuisance trip on normal leakage'}.`, ev !== 'ef2'); } }
        else if (ev === 'ef2') tl(1, `EFR does not trip: it sees ${r1(seen)} A (IΔn ${c.efr} A). The pump frame stays live – about 50 V touch voltage.`, 1);
        if (ev === 'dip') { if (c.pU > 80 && c.pT < 0.3) { R.pfrOk = false; R.q1 = false; tl(c.pT, `PFR trips on the dip (80 % < U< ${c.pU} %, delay ${c.pT} s < 0.3 s) → MN drops → Q1 opens. Building dark.`, 1); } else tl(0.3, 'PFR rides through the dip (delay longer than the dip) – nothing trips.'); R.V = [184, 184, 184]; }
        if (ev === 'uv') { R.V = [196, 196, 197]; if (85.2 < c.pU) { R.pfrOk = false; R.q1 = false; tl(c.pT, `PFR under-voltage: 196 V (85 %) below U< ${c.pU} % → Q1 opens.`, 1); } else tl(5, 'PFR stays in (85 % is above its U< setting). Motors run hotter at low voltage.'); }
        if (ev === 'seq') { R.rot = 'L1-L3-L2 (anticlockwise!)'; if (c.pSeq === 'on') { R.pfrOk = false; R.q1 = false; tl(c.pT, 'PFR: wrong phase sequence → MN drops → Q1 opens (and cannot be closed) – the motors are protected.'); } else tl(3, 'PFR sequence check OFF – Q1 stays in. Every 3-phase pump and fan now runs BACKWARDS.', 1); }
      }
      if (ev === 'motor') {
        const t1 = ff1(1400 + 100); tl(0, 'Chiller compressor starting current 1 400 A for 0.5 s.');
        const t = fin(1750); if (t != null && t < 0.5) iTrip(t, c.ii !== 'off' && 1750 > c.ii * In ? `instantaneous: 1 750 A > Ii ${c.ii * In} A` : `short time: 1 750 A > Isd ${c.isd * Ir} A for longer than tsd ${c.tsd} s`); else tl(0.5, `Chiller runs up – no trip (Isd ${c.isd * Ir} A${c.ii !== 'off' ? `, Ii ${c.ii * In} A` : ''} above 1 750 A). F1 thermal would need ${t1 ? fmtS(t1) : '—'}.`);
      }
      if (ev === 'sc') {
        const t1 = ff1(8000), t = fin(8000); R.f1 = false; tl(t1, 'F1 magnetic trip – clears the fault in 15 ms.');
        if (t != null && t < t1 + 0.08) iTrip(t, `${c.ii !== 'off' && 8000 > c.ii * In ? 'instantaneous' : 'short time with tsd 0'} – no discrimination with F1`); else tl(t1 + 0.01, `Q1 sees 8 kA but waits tsd ${c.tsd} s – F1 has already cleared it. Discrimination OK: only the chiller plant is off.`);
      }
      if (ev === 'lose') {
        R.V = [231, 0, 229];
        R.pfrOk = false; R.q1 = false; tl(c.pT, `PFR: phase L2 missing → MN drops → Q1 opens after ${c.pT} s. Protects 3-phase motors from single phasing.`);
      }
      if (R.q1 && R.f1 && R.f2 && !R.tl.some((x) => x[2])) tl(2, 'Everything stays on.');
      return R;
    },
    tests: [
      ['met', 'Read the multi-function meter', (R) => `V ${R.V.join(' / ')} V · I ${Math.min(R.I, 400)} A · In ${R.In} A`],
      ['tu', 'Read the Q1 trip unit (settings and last trip)', (R, c) => `Ir ${c.ir} (${c.ir * 400} A) · tr ${c.tr} s · Isd ${c.isd} (${Math.round(c.isd * c.ir * 400)} A) · tsd ${c.tsd} s · Ii ${c.ii} · Ig ${c.ig} (${c.ig * 400} A) tg ${c.tg} s${R.q1 ? '' : ' · last trip: ' + (R.tl.filter((x) => /Q1/.test(x[1])).map((x) => x[1].match(/\(([^)]*)\)/)?.[1] || 'MN under-voltage')[0] || '')}`],
      ['efr', 'Read the EFR display', (R, c) => `Residual ${r1(R.resid)} A · IΔn ${c.efr} A · delay ${c.efrT} s · ${R.efrTrip ? 'TRIPPED' : 'healthy'}`],
      ['pfr', 'Read the PFR LEDs and settings', (R, c, F) => (F.pfrFuse ? 'All LEDs OFF – no supply' : `${R.pfrOk ? 'OK (relay energised)' : 'TRIPPED'} · U< ${c.pU} % · delay ${c.pT} s · sequence check ${c.pSeq}`)],
      ['rot', 'Phase rotation meter on the incoming supply', (R) => R.rot],
      ['clampN', 'Clamp meter around the F2 neutral, then around all four F2 conductors', (R, c, F) => `Neutral ${F.cbctN ? 18 : 18} A · all four together ${r1(R.sev === 'ef2' ? 2.2 : 0.2)} A (= true residual)`],
      ['cbct', 'Look at what passes through the CBCT', (R, c, F) => (F.cbctE ? 'L1 L2 L3 N AND the green-yellow PE pass through it!' : F.cbctN ? 'Only L1 L2 L3 – the neutral runs outside the ring!' : 'L1 L2 L3 N through it, PE outside – correct')],
      ['therm', 'Thermal camera on the incomer', (R, c, F) => (F.hotlug ? 'Q1 L3 lug 118 °C · L1 46 °C · L2 47 °C' : 'Q1 terminals 44–48 °C – normal')],
      ['vfuse', 'Voltage at the PFR terminals', (R, c, F) => (F.pfrFuse ? '0 V on the PFR side – sensing fuse open (400 V on the busbar side)' : `${R.V[0]} / ${R.V[1]} / ${R.V[2]} V`)],
      ['mx', 'Resistance of the F2 shunt trip coil MX', (R, c, F) => (F.shunt ? 'OL – coil open' : '42 Ω'), 1],
      ['ftest', 'Press the EFR test button', (R, c, F) => (F.shunt ? 'EFR trips (LED) – F2 does NOT open!' : 'EFR trips and F2 opens – chain OK')],
    ],
    view(R, c, F, sel) {
      let s = `<rect x="10" y="10" width="980" height="500" rx="8" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>${T(980, 28, 'Main switchboard (doors open)', 11, '#475569', 'end', 700)}`;
      s += `<rect x="30" y="50" width="200" height="250" rx="6" fill="#cbd5e1" stroke="#475569" stroke-width="1.5"/>${[0, 1, 2, 3].map((i) => screw(60 + i * 46, 64) + screw(60 + i * 46, 286)).join('')}<rect x="112" y="${R.q1 ? 82 : c.iso ? 118 : 100}" width="36" height="30" rx="4" fill="#1e293b"/>${T(130, 136, c.iso ? 'OFF 🔒' : R.q1 ? 'ON' : 'TRIPPED', 9, R.q1 ? '#14161c' : '#b91c1c', 'middle', 700)}`;
      s += `<rect x="44" y="148" width="172" height="120" rx="4" fill="#0f172a"/>${T(130, 162, 'LSIG trip unit', 9, '#e2e8f0', 'middle', 700)}`;
      s += [[(c.ir - 0.4) / 0.6, 'Ir', c.ir], [(c.tr - 2) / 22, 'tr', c.tr], [(c.isd - 1.5) / 8.5, 'Isd', c.isd], [c.tsd / 0.4, 'tsd', c.tsd]].map(([f, l, v], i) => dial(66 + i * 42, 190, f, l, v, 9).replace(/#475569|#14161c/g, '#e2e8f0')).join('') + [[c.ii === 'off' ? 1 : (c.ii - 4) / 11, 'Ii', c.ii], [(c.ig - 0.2) / 0.8, 'Ig', c.ig], [c.tg / 0.4, 'tg', c.tg]].map(([f, l, v], i) => dial(66 + i * 42, 240, f, l, v, 9).replace(/#475569|#14161c/g, '#e2e8f0')).join('') + led(200, 240, '#ef4444', !R.q1 && !c.iso, 'trip').replace('#475569', '#e2e8f0');
      s += T(130, 318, 'Q1  400 A incomer', 10, '#14161c', 'middle', 700) + (R.hot ? heat(176, 64, 16) : '') + hit('Q1', 26, 46, 208, 280, sel);
      s += relay(250, 50, 90, 'PFR', [['#16a34a', R.pfrOk && !F.pfrFuse && !c.iso, 'U'], ['#16a34a', R.rot.startsWith('L1-L2') && !F.pfrFuse && !c.iso, 'seq'], ['#ef4444', !R.pfrOk && !F.pfrFuse, 'trip']], [[(c.pU - 75) / 20, 'U<', `${c.pU}%`], [Math.log10(c.pT * 10) / Math.log10(50), 't', `${c.pT}s`]]) + hit('PFR', 246, 46, 98, 118, sel);
      s += lcd(250, 190, 140, 62, [`V ${R.V.join(' ')}`, `I  ${Math.min(R.I, 400)} A`, `In ${R.In} A`, ''], '#0b1220', '#bef264') + T(320, 268, 'Meter', 10, '#14161c', 'middle', 700) + hit('MET', 246, 186, 148, 92, sel);
      s += busbars(420, 960, 70, ['L1', 'L2', 'L3', 'N']) + wire([[130, 50], [130, 36], [400, 36], [400, 70], [420, 72]], '#92400e', 4);
      const brk = (x, lab, on, sub, id) => `<rect x="${x}" y="130" width="120" height="170" rx="6" fill="#cbd5e1" stroke="#475569" stroke-width="1.5"/>${[0, 1, 2].map((i) => screw(x + 24 + i * 36, 144) + screw(x + 24 + i * 36, 286)).join('')}<rect x="${x + 44}" y="${on ? 172 : 196}" width="32" height="26" rx="4" fill="#1e293b"/>${T(x + 60, 238, on ? 'ON' : 'TRIPPED', 9, on ? '#14161c' : '#b91c1c', 'middle', 700)}${T(x + 60, 260, lab, 10, '#14161c', 'middle', 700)}${T(x + 60, 272, sub, 8, '#475569')}${hit(id, x - 4, 126, 128, 210, sel)}` + [0, 1, 2].map((i) => wire([[x + 24 + i * 36, 130], [x + 24 + i * 36, 72 + i * 10]], '#92400e', 2)).join('');
      s += brk(460, 'F1  250 A TM', R.f1, 'chiller plant', 'F1') + brk(680, 'F2  125 A + MX', R.f2, 'pump room', 'F2');
      s += `<ellipse cx="740" cy="380" rx="58" ry="20" fill="none" stroke="#7c3aed" stroke-width="7"/>${T(812, 384, 'CBCT', 10, '#7c3aed', 'start', 700)}${hit('CBCT', 676, 352, 180, 56, sel)}`;
      s += [0, 1, 2].map((i) => wire([[704 + i * 36, 300], [704 + i * 36, 470]], PH['L' + (i + 1)], 3)).join('') + wire([[960, 110], [960, 330], (F.cbctN ? [860, 330] : [740, 330]), (F.cbctN ? [860, 470] : [740, 470])], PH.N, 3) + wire([[F.cbctE ? 760 : 900, 340], [F.cbctE ? 760 : 900, 470]], PH.PE, 3) + T(F.cbctE ? 768 : 908, 466, 'PE', 9, PH.PE, 'start', 700) + T(F.cbctN ? 868 : 748, 466, 'N', 9, PH.N, 'start', 700);
      s += relay(860, 180, 100, 'EFR', [['#16a34a', !c.iso, 'on'], ['#ef4444', R.efrTrip, 'trip']], [[[0.3, 1, 3, 10, 30].indexOf(c.efr) / 4, 'IΔn', `${c.efr}A`], [[0, 0.1, 0.5, 1].indexOf(c.efrT) / 3, 't', `${c.efrT}s`]]) + hit('EFR', 856, 176, 108, 118, sel) + wire([[798, 380], [870, 380], [870, 264]], '#7c3aed', 1.4, 1) + wire([[910, 180], [910, 160], [800, 160], [800, 180]], F.shunt ? '#dc2626' : '#7c3aed', 1.4, 1) + T(850, 156, F.shunt ? 'MX ✗' : 'to MX', 8, F.shunt ? '#dc2626' : '#7c3aed');
      s += wire([[540, 300], [540, 470]], '#475569', 6) + T(548, 466, 'to chiller', 9, '#475569', 'start');
      return s;
    },
    chart: (R, c) => `<!--vb 560 230-->${loglog(560, 230, [{ f: (i) => R.fin(i), c: '#244286', lab: 'Q1 incomer' }, { f: (i) => R.ff1(i), c: '#b45309', lab: 'F1' }], R.I && !c.iso && ['load', 'motor', 'sc'].includes(c.ev) ? [[R.I, null, c.ev === 'sc' ? '8 kA fault' : c.ev === 'motor' ? 'chiller start' : 'load', '#dc2626']] : [], { x0: 100, x1: 20000 })}`,
  };
  PAN.prot.iso = (c) => c.iso;

  // ---------------------------------------------------------------- 4. ATS – automatic transfer switch with generator
  const AEV = { ok: ['Mains healthy', 300], fail: ['Mains fails', 300], ret: ['Mains returns (load on generator)', 420], flick: ['Mains unstable (3 cuts, then short dips)', 300], test: ['Press TEST (simulated mains fail 2 min)', 420] };
  const mainsOn = (ev, t) => (ev === 'fail' ? false : ev === 'flick' ? !((t >= 0 && t < 15) || (t >= 25 && t < 40) || (t >= 55 && t < 60) || (t >= 100 && t < 101.5) || (t >= 230 && t < 231)) : true);
  PAN.ats = {
    title: 'ATS panel – mains / generator changeover',
    intro: 'The ATS controller watches the mains through sensing fuses. Mains fails → wait T1 → start the generator → warm-up T2 → open QM → neutral delay T3 → close QG. Mains returns → wait T4 (is it stable?) → open QG → T3 → close QM → generator cools down T5 and stops. QM and QG are mechanically and electrically interlocked.',
    parts: {
      FU: ['FU1–FU3 – mains sensing fuses', 'Feed the ATS voltage sensing. A blown sensing fuse looks exactly like a lost mains phase to the controller.'],
      QM: ['QM – mains breaker (motorised)', 'Opened / closed by the ATS. Its auxiliary contacts tell the ATS its position.'],
      QG: ['QG – generator breaker (motorised)', 'Closed by the ATS when the generator is ready.'],
      ILK: ['Mechanical + electrical interlock', 'Makes it impossible for QM and QG to be closed together – that would parallel the generator with the mains out of phase.'],
      ATS: ['ATS controller', 'T1 mains-fail delay, T2 generator warm-up, T3 neutral (dead) time, T4 mains-return delay, T5 cool-down. Sends a volt-free start signal to the generator.'],
      GEN: ['Generator 250 kVA + controller', 'Its controller must be in AUTO to answer the remote start signal. Battery 12 V for the starter.'],
      LOAD: ['Essential load busbar', 'Lifts, pumps, emergency lighting, IT.'],
    },
    sets: [['t1', 'ATS', 'T1 mains-fail delay', 'range', 0, 10, 1, ' s'], ['t2', 'ATS', 'T2 warm-up', 'range', 0, 60, 5, ' s'], ['t3', 'ATS', 'T3 neutral delay', 'range', 0, 5, 1, ' s'], ['t4', 'ATS', 'T4 mains-return delay', 'range', 0, 300, 10, ' s'], ['t5', 'ATS', 'T5 cool-down', 'range', 0, 300, 30, ' s'], ['gm', 'GEN', 'Generator controller mode', 'select', [['auto', 'AUTO'], ['man', 'MANUAL'], ['off', 'OFF']]]],
    init: () => ({ t1: 3, t2: 10, t3: 1, t4: 120, t5: 180, gm: 'auto', ev: 'ok' }),
    ops: Object.keys(AEV).map((k) => ({ l: () => AEV[k][0], on: (c) => c.ev === k, a: (c) => { c.ev = k; } })),
    faults: [
      { id: 'sense', label: 'Mains sensing fuse FU2 blown', say: 'The generator starts and takes the load although the mains is perfectly fine – and never goes back.', hint: 'Compare the mains voltage on the busbar side and on the ATS side of the sensing fuses.', why: 'The ATS sees L2 missing → "mains failed" → transfers to the generator and stays there.', fix: 'Replace FU2, find out why it blew.' },
      { id: 'startRelay', label: 'Generator start signal not reaching the generator', say: 'During the last power cut the generator never started – total blackout.', hint: 'The ATS shows "start requested". Is the volt-free start contact closing, and does the signal reach the generator?', why: 'The start relay contact / wire is open: the generator never gets the start command.', fix: 'Test the start contact and the cable to the generator controller, replace the relay.' },
      { id: 'batt', label: 'Generator battery flat', say: 'During the power cut the generator cranked slowly three times and then showed "fail to start".', hint: 'Measure the battery voltage, and while cranking.', why: '9.8 V battery: the starter turns too slowly, three attempts then lock-out.', fix: 'Replace/charge the battery, check the battery charger and its supply.' },
      { id: 'qmweld', label: 'QM motor operator stuck (QM will not open)', say: 'In the power cut the generator ran but the load stayed dead.', hint: 'The generator is ready – why does the ATS not close QG? Look at QM.', why: 'QM cannot open; the interlock correctly stops QG closing. The load stays on the dead mains.', fix: 'Repair the QM motor operator / spring charge; check its auxiliary contacts.' },
      { id: 'qgmotor', label: 'QG motor operator failed', say: 'The generator runs during power cuts but the ATS shows "transfer fail".', hint: 'QM opened – what about QG?', why: 'The QG closing coil / motor does not operate.', fix: 'Repair the QG operator; test the close coil.' },
      { id: 'ilk', label: 'Interlock defeated and QG slow to open', say: 'When the mains came back there was a loud bang in the ATS and the generator breaker tripped.', hint: 'Look at the order of QG opening and QM closing on retransfer.', why: 'QM closed while QG was still closed: generator paralleled with the mains out of phase.', fix: 'Restore the mechanical and electrical interlock; repair QG\'s slow opening.' },
      { id: 'genseq', label: 'Generator phase rotation different from the mains', say: 'Whenever the building is on generator, the pumps and fans run backwards.', hint: 'Phase rotation meter on the mains side and on the generator side.', why: 'L1 and L3 swapped on the generator side: anticlockwise rotation – every motor reverses on generator.', fix: 'Swap two phases at the generator terminals (after confirming with the meter).' },
      { id: 'gmOff', label: 'Generator controller left in OFF / MANUAL', say: 'After the generator service the generator does not start in power cuts.', hint: 'Look at the generator controller mode.', why: 'In OFF (or MANUAL) the generator ignores the remote start signal.', fix: 'Return the controller to AUTO after any maintenance.', set: { gm: 'off' } },
      { id: 't4zero', label: 'Mains-return delay T4 set to 0', say: 'When the mains is unstable the ATS changes over again and again – the lifts and computers keep resetting.', hint: 'Look at the timeline when the mains flickers.', why: 'T4 = 0 returns to the mains the instant it comes back – if it fails again the load is dropped again and again.', fix: 'T4 1–5 minutes so the mains must prove stable first.', set: { t4: 0 } },
      { id: 't1zero', label: 'Mains-fail delay T1 set to 0', say: 'The generator starts several times a day for tiny dips.', hint: 'Look at what starts the generator.', why: 'T1 = 0: every short dip starts the generator.', fix: 'T1 about 3–5 s (ride through dips and auto-reclosers).', set: { t1: 0 } },
      { id: 't5zero', label: 'Cool-down T5 set to 0', say: 'The generator turbocharger failed early – the engine always stops immediately after retransfer.', hint: 'What happens to the generator after the load goes back to the mains?', why: 'No cool-down: the hot turbo and engine stop without cooling.', fix: 'T5 3–5 minutes off-load running.', set: { t5: 0 } },
    ],
    sim(c, F) {
      const ev = c.ev, dur = AEV[ev][1], dt = 0.5, R = { tl: [], ser: [], mser: [], transfers: 0, dead: 0, QM: true, QG: false, gen: 'stopped', alarm: '', sensed: true, vm: [230, 230, 230], vg: [0, 0, 0], bat: F.batt ? 9.8 : 12.7, rotG: F.genseq ? 'anticlockwise (L1-L3-L2)' : 'clockwise', reversed: false, bang: false };
      const tl = (t, s, bad) => R.tl.push([t, s, bad]);
      let QM = ev !== 'ret', QG = ev === 'ret', gen = ev === 'ret' ? 'ready' : 'off', warm = ev === 'ret' ? 999 : 0, failT = -dt, okT = -dt, req = ev === 'ret', crank = 0, tries = 0, lock = false, cool = -1, pend = null, alarmed = {};
      const once = (k, t, s, bad) => { if (!alarmed[k]) { alarmed[k] = 1; tl(t, s, bad); } };
      if (ev === 'ret') tl(0, 'Load is on the generator. The mains comes back.');
      if (ev === 'test') tl(0, 'TEST pressed – the ATS behaves as if the mains has failed for 2 minutes.');
      for (let t = 0; t <= dur; t += dt) {
        const mOn = mainsOn(ev, t), sensed = mOn && !F.sense && !(ev === 'test' && t < 120);
        if (sensed) { okT += dt; failT = 0; } else { failT += dt; okT = 0; }
        if (!sensed && failT >= c.t1 && !req) { req = true; once('req' + Math.floor(t), t, `Mains ${mOn ? 'SEEN as failed (it is actually on)' : 'failed'} for ${c.t1} s → ATS sends the generator START signal.`, mOn); }
        if (req && gen === 'off' && !lock) {
          if (F.startRelay || c.gm !== 'auto') { if (failT > c.t1 + 30) { lock = true; R.alarm = 'GEN FAIL TO START'; once('nf', t, `No answer from the generator – ATS alarm "generator fail to start". ${c.gm !== 'auto' ? `(Generator controller is in ${c.gm.toUpperCase()}.)` : ''}`, 1); } }
          else { crank += dt; if (F.batt) { if (crank >= 10) { crank = 0; tries++; once('cr' + tries, t, `Cranking slowly (battery ${R.bat} V) – attempt ${tries} failed.`, 1); if (tries >= 3) { lock = true; R.alarm = 'GEN FAIL TO START'; once('fs', t, 'Generator controller: FAIL TO START – locked out.', 1); } } } else if (crank >= 2) { gen = 'running'; warm = 0; crank = 0; once('st' + Math.floor(t), t, 'Generator starts.'); } }
        }
        if (gen === 'running') { warm += dt; if (warm >= 4) { gen = 'ready'; once('rd' + Math.floor(t), t, 'Generator voltage and frequency OK.'); } }
        if (gen === 'ready') warm += dt;
        if (!sensed && failT >= c.t1 && gen === 'ready' && warm >= c.t2 + 4 && !QG && pend == null) {
          if (QM) { if (F.qmweld) { R.alarm = 'TRANSFER FAIL (QM)'; once('qmw', t, 'ATS tries to open QM – QM does not open. The interlock blocks QG. Load stays dead.', 1); } else { QM = false; pend = t + c.t3; once('oq' + Math.floor(t), t, 'QM opens.'); } }
          else pend = pend == null ? t + c.t3 : pend;
        }
        if (pend != null && t >= pend && !QM && !QG) { pend = null; if (F.qgmotor) { R.alarm = 'TRANSFER FAIL (QG)'; once('qgf', t, 'ATS commands QG to close – nothing happens. Alarm "transfer fail".', 1); } else { QG = true; R.transfers++; tl(t, `QG closes – load ON GENERATOR (after ${c.t3} s neutral delay).`); if (F.genseq && !R.reversed) { R.reversed = true; tl(t + 1, 'Pumps and fans run BACKWARDS on the generator.', 1); } } }
        if (sensed && okT >= c.t4 && QG) {
          if (F.ilk) { QM = true; R.bang = true; QG = false; R.transfers++; tl(t, 'Retransfer: QM closes while QG is still closed – BANG: out-of-phase paralleling, the generator breaker trips. Mains back on the load.', 1); }
          else { QG = false; tl(t, `Mains stable for ${c.t4} s → QG opens.`, c.t4 === 0); QM = true; R.transfers++; tl(t + c.t3, `QM closes – load back ON MAINS. Generator cooling down for ${c.t5} s.`); }
          cool = t + c.t5;
        }
        if (sensed && okT >= c.t4 && !QG && req && cool < 0 && gen !== 'off') { cool = t + c.t5; once('cx' + Math.floor(t), t, 'Mains back before the transfer – start cancelled, generator cooling down.'); }
        if (cool >= 0 && t >= cool && !QG && sensed) { if (gen !== 'off') tl(t, c.t5 === 0 ? 'Generator stops at once – NO cool-down (hot turbocharger).' : 'Cool-down finished – generator stops.', c.t5 === 0); gen = 'off'; req = false; cool = -1; warm = 0; }
        if (!sensed && cool >= 0) cool = -1;
        const src = QM && mOn ? 2 : QG && gen === 'ready' ? 1 : 0;
        if (!src) R.dead += dt;
        R.ser.push([t, src]); R.mser.push([t, mOn ? 2.2 : 1.3]);
      }
      R.QM = QM; R.QG = QG; R.gen = gen; R.sensed = !F.sense && mainsOn(ev, dur);
      R.vm = mainsOn(ev, dur) ? [230, 230, 230] : [0, 0, 0]; R.vg = gen === 'ready' ? [231, 230, 231] : [0, 0, 0];
      tl(dur, `Summary: ${R.transfers} transfer(s), load without supply for ${fmtS(R.dead)}${R.alarm ? ` · ATS alarm: ${R.alarm}` : ''}.`, R.dead > 30 || R.transfers > 3 || !!R.alarm);
      return R;
    },
    tests: [
      ['disp', 'Read the ATS display', (R) => `Mains ${R.sensed ? 'OK' : 'FAIL'} · ${R.QM ? 'QM closed' : 'QM open'} · ${R.QG ? 'QG closed' : 'QG open'} · gen ${R.gen}${R.alarm ? ' · ALARM ' + R.alarm : ''}`],
      ['vbus', 'Mains voltage on the busbar side of FU1–FU3', (R) => R.vm.map((v) => `${v} V`).join(' / ')],
      ['vsense', 'Mains voltage on the ATS side of FU1–FU3', (R, c, F) => R.vm.map((v, i) => `${F.sense && i === 1 ? 0 : v} V`).join(' / ')],
      ['vgen', 'Generator voltage', (R) => R.vg.map((v) => `${v} V`).join(' / ')],
      ['bat', 'Generator battery voltage (rest / cranking)', (R) => `${R.bat} V / ${R.bat < 11 ? '7.1 V' : '10.4 V'}`],
      ['start', 'Start contact at the generator end (with start requested)', (R, c, F) => (F.startRelay ? 'OL – the start signal does not arrive' : '0.1 Ω – start command present')],
      ['gm', 'Look at the generator controller', (R, c) => `Mode: ${c.gm.toUpperCase()}${c.gm !== 'auto' ? ' – will not answer a remote start!' : ''}`],
      ['rot', 'Phase rotation – mains side and generator side', (R) => `Mains clockwise · Generator ${R.rotG}`],
      ['timers', 'Read the ATS timers', (R, c) => `T1 ${c.t1} s · T2 ${c.t2} s · T3 ${c.t3} s · T4 ${c.t4} s · T5 ${c.t5} s`],
      ['ilk', 'Check the interlock (try to close QG with QM closed – off-load)', (R, c, F) => (F.ilk ? 'QG CAN be closed with QM closed – interlock defeated!' : 'QG is blocked – interlock OK')],
    ],
    view(R, c, F, sel) {
      let s = `<rect x="10" y="10" width="980" height="500" rx="8" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>${T(980, 28, 'ATS panel and generator', 11, '#475569', 'end', 700)}`;
      const mOn = R.vm[0] > 0;
      s += `${T(120, 46, 'MAINS (utility)', 11, mOn ? '#15803d' : '#b91c1c', 'middle', 700)}${[0, 1, 2].map((i) => wire([[80 + i * 40, 54], [80 + i * 40, 90]], mOn ? PH['L' + (i + 1)] : '#cbd5e1', 3)).join('')}`;
      s += [0, 1, 2].map((i) => `<rect x="${170 + i * 26}" y="70" width="18" height="40" rx="3" fill="${F.sense && i === 1 ? '#fecaca' : '#fff'}" stroke="#64748b"/>${T(179 + i * 26, 122, `FU${i + 1}`, 8, '#14161c', 'middle', 700)}`).join('') + hit('FU', 164, 64, 82, 66, sel) + wire([[218, 110], [218, 150], [420, 150]], '#7c3aed', 1.2, 1);
      const brk = (x, lab, on, id, sub) => `<rect x="${x}" y="150" width="120" height="150" rx="6" fill="#cbd5e1" stroke="#475569" stroke-width="1.5"/>${[0, 1, 2, 3].map((i) => screw(x + 18 + i * 28, 162) + screw(x + 18 + i * 28, 288)).join('')}<rect x="${x + 44}" y="${on ? 172 : 194}" width="32" height="24" rx="4" fill="#1e293b"/>${T(x + 60, 255, on ? 'CLOSED' : 'OPEN', 9, on ? '#15803d' : '#475569', 'middle', 700)}<rect x="${x + 20}" y="262" width="80" height="14" rx="3" fill="#94a3b8"/>${T(x + 60, 272, 'motor operator', 7, '#fff')}${T(x + 60, 238, lab, 11, '#14161c', 'middle', 700)}${T(x + 60, 146, sub, 8, '#64748b')}${hit(id, x - 4, 146, 128, 190, sel)}`;
      s += brk(60, 'QM', R.QM, 'QM', 'mains 400 A 4P') + brk(600, 'QG', R.QG, 'QG', 'generator 400 A 4P');
      s += [0, 1, 2].map((i) => wire([[80 + i * 40, 90], [80 + i * 40, 150]], mOn ? PH['L' + (i + 1)] : '#cbd5e1', 3)).join('');
      s += `<rect x="190" y="210" width="400" height="12" rx="3" fill="${F.ilk ? '#fecaca' : '#94a3b8'}" stroke="#475569"/>${T(390, 240, F.ilk ? 'interlock DEFEATED' : 'mechanical interlock', 9, F.ilk ? '#b91c1c' : '#475569', 'middle', 700)}${hit('ILK', 186, 200, 408, 48, sel)}`;
      s += `<rect x="300" y="50" width="180" height="140" rx="6" fill="#f8fafc" stroke="#64748b"/>${lcd(312, 60, 156, 64, [`MAINS ${R.sensed ? 'OK ' : 'FAIL'}`, `GEN   ${R.gen.toUpperCase()}`, R.alarm ? R.alarm : R.QG ? 'LOAD ON GEN' : 'LOAD ON MAINS', `T1 ${c.t1} T4 ${c.t4}`], '#0b1220', R.alarm ? '#fca5a5' : '#a7f3d0')}${led(330, 144, '#16a34a', R.sensed, 'mains')}${led(390, 144, '#f59e0b', R.gen !== 'off', 'gen')}${led(450, 144, '#ef4444', !!R.alarm, 'alarm')}${T(390, 182, 'ATS controller', 10, '#14161c', 'middle', 700)}${hit('ATS', 296, 46, 188, 148, sel)}`;
      s += `<rect x="70" y="370" width="660" height="22" rx="3" fill="#d4a373" stroke="#92400e"/>${T(400, 386, 'ESSENTIAL LOAD BUSBAR – ' + (R.QM && mOn ? 'on MAINS' : R.QG ? 'on GENERATOR' : 'DEAD'), 10, '#14161c', 'middle', 700)}${hit('LOAD', 66, 364, 668, 34, sel)}` + wire([[120, 300], [120, 370]], R.QM && mOn ? PH.L1 : '#cbd5e1', 4) + wire([[660, 300], [660, 370]], R.QG ? PH.L1 : '#cbd5e1', 4);
      s += `<rect x="770" y="140" width="200" height="160" rx="10" fill="${R.gen === 'off' ? '#e5e7eb' : '#fef3c7'}" stroke="#475569" stroke-width="2"/>${T(870, 164, 'GENERATOR 250 kVA', 10, '#14161c', 'middle', 700)}${lcd(790, 176, 110, 40, [c.gm.toUpperCase(), R.gen === 'off' ? (R.alarm.includes('START') ? 'FAIL START' : 'STANDBY') : R.gen.toUpperCase()], '#0b1220', c.gm === 'auto' ? '#a7f3d0' : '#fca5a5')}<rect x="910" y="236" width="46" height="34" rx="3" fill="${F.batt ? '#fecaca' : '#334155'}"/>${T(933, 258, `${R.bat} V`, 9, '#fff', 'middle', 700)}${T(870, 292, R.gen === 'off' ? 'stopped' : 'running', 10, R.gen === 'off' ? '#64748b' : '#b45309', 'middle', 700)}${hit('GEN', 766, 136, 208, 168, sel)}` + wire([[770, 220], [720, 220], [720, 150], [700, 150]], R.gen === 'ready' ? PH.L1 : '#cbd5e1', 4) + wire([[480, 100], [870, 100], [870, 140]], F.startRelay ? '#dc2626' : '#7c3aed', 1.4, 1) + T(680, 94, F.startRelay ? 'start signal ✗' : 'start signal (volt-free)', 8, F.startRelay ? '#dc2626' : '#7c3aed');
      return s;
    },
    chart: (R) => chart(560, 200, R.ser.length ? R.ser[R.ser.length - 1][0] : 300, 2.4, [{ pts: R.mser, c: '#94a3b8', lab: 'mains present' }, { pts: R.ser, c: '#244286', lab: 'load: 2 mains · 1 gen · 0 dead' }], { yl: 'supply to the load', xl: 'seconds', noY: true }),
  };

  // ---------------------------------------------------------------- 5. power quality – unbalance, neutral current, harmonics, filters
  const cx = (re, im = 0) => ({ re, im }), cadd = (a, b) => cx(a.re + b.re, a.im + b.im), csub = (a, b) => cx(a.re - b.re, a.im - b.im), cmul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re), cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); }, cabs = (a) => Math.hypot(a.re, a.im), pol = (m, deg) => cx(m * Math.cos((deg * Math.PI) / 180), m * Math.sin((deg * Math.PI) / 180));
  const SPEC = { res: {}, led: { 3: 0.12, 5: 0.08, 7: 0.05, 9: 0.03 }, it: { 3: 0.55, 5: 0.35, 7: 0.2, 9: 0.1, 11: 0.06, 13: 0.04 } }, VSPEC = { 5: 0.35, 7: 0.2, 11: 0.08, 13: 0.06 }, HS = [3, 5, 7, 9, 11, 13];
  PAN.pq = {
    title: 'Power quality – unbalance, neutral current, harmonics and filters',
    intro: 'A 4-wire sub-main (400 A phases) feeds single-phase loads on L1, L2, L3 and a group of 3-phase drives (VFDs). Single-phase electronic loads make triplen harmonics (3rd, 9th) that ADD in the neutral; drives make 5th and 7th. An active harmonic filter (AHF) or a passive 5th-harmonic filter can be fitted. Change the loads and watch the phase and neutral currents, voltages and THD.',
    parts: {
      TX: ['Transformer 500 kVA, 5 %', 'Its impedance turns harmonic currents into voltage distortion (THDv) for everyone on the busbar.'],
      LD1: ['Single-phase loads on L1', 'Lighting, sockets, IT. Type sets the harmonic content.'], LD2: ['Single-phase loads on L2', ''], LD3: ['Single-phase loads on L3', ''],
      VFD: ['VFD group (3-phase drives)', '6-pulse drives: 5th 35 %, 7th 20 %, 11th, 13th. Balanced – nothing in the neutral.'],
      AHF: ['Harmonic filter', 'Active filter (AHF): measures the harmonics with its CTs and injects the opposite – 4-wire type cancels the neutral triplens too. Passive 5th filter: tuned L-C trap for the 5th only.'],
      NB: ['Neutral bar and neutral conductor', 'Full-size (400 A) or half-size (200 A) neutral. With triplen harmonics the neutral can carry MORE than the phases.'],
      AN: ['Power analyser', 'Reads each phase and the neutral: rms current, THDi, voltage, THDv, spectrum.'],
    },
    sets: [['l1', 'LD1', 'L1 load', 'range', 0, 80, 1, ' kW'], ['l2', 'LD2', 'L2 load', 'range', 0, 80, 1, ' kW'], ['l3', 'LD3', 'L3 load', 'range', 0, 80, 1, ' kW'], ['typ', 'LD1', 'Load type (all single-phase loads)', 'select', [['res', 'Resistive (heaters)'], ['led', 'LED drivers with PFC'], ['it', 'IT / SMPS without PFC']]], ['vfd', 'VFD', 'Drive load', 'range', 0, 200, 5, ' kW'], ['filt', 'AHF', 'Filter fitted', 'select', [['none', 'None'], ['p5', 'Passive 5th filter'], ['ahf', 'Active harmonic filter (4-wire)']]], ['ahf', 'AHF', 'AHF rating', 'range', 30, 300, 10, ' A'], ['nsz', 'NB', 'Neutral size', 'select', [['full', 'Full size (400 A)'], ['half', 'Half size (200 A)']]]],
    init: () => ({ l1: 40, l2: 36, l3: 38, typ: 'led', vfd: 60, filt: 'ahf', ahf: 150, nsz: 'full', ch: 'N' }),
    ops: [...['L1', 'L2', 'L3', 'N'].map((k) => ({ l: () => `Analyser: ${k}`, on: (c) => c.ch === k, a: (c) => { c.ch = k; } }))],
    faults: [
      { id: 'pen', label: 'Supply neutral (PEN) broken', say: 'Half the building\'s equipment failed at once: some lights very bright, others dim; someone felt a tingle from a metal cabinet.', hint: 'Measure the phase-to-neutral voltages at the board – are they 230 V?', why: 'With the neutral open the star point floats: the lightly loaded phase rises towards 400 V, the heavily loaded one falls. In TN-C-S the exposed metalwork follows the floating neutral.', fix: 'Emergency: switch off. Utility repairs the PEN; check equipment; consider PEN-loss protection (voltage-monitoring relay).', hw: true, set: { l1: 70, l2: 15, l3: 30 } },
      { id: 'nloose', label: 'Loose neutral at the board', say: 'Lights flicker and dim when big loads switch; the neutral terminal is discoloured.', hint: 'Phase voltages move with the load. Thermal camera on the neutral bar.', why: 'A high-resistance neutral shifts the star point with the unbalance current: voltages swing, the joint overheats.', fix: 'Isolate, re-make the neutral connection, torque, thermal check.', hw: true, set: { l1: 65, l2: 20, l3: 30 } },
      { id: 'ahfpol', label: 'AHF current transformer on L2 reversed', say: 'Since the active filter was installed, L2 equipment overheats and THD on L2 is worse than before.', hint: 'Compare THDi per phase with the filter on – one phase is worse than without it.', why: 'With its CT reversed the AHF injects the harmonics IN PHASE on L2 – it doubles them instead of cancelling.', fix: 'Correct the CT polarity (P1 towards the supply) and re-commission.' },
      { id: 'ahfoff', label: 'AHF tripped (cooling fan failed)', say: 'Harmonics and the neutral current went up last week; the filter shows an alarm.', hint: 'Read the AHF display.', why: 'The AHF tripped on over-temperature after its fan failed – it is not filtering.', fix: 'Replace the fan / clean the filters, reset and check the cabinet ventilation.' },
      { id: 'p5aged', label: 'Passive filter capacitors aged (detuned)', say: 'The 5th harmonic is back and the passive filter capacitors are hot.', hint: 'Measure the filter current and the capacitance.', why: 'Lost capacitance moves the tuning frequency up: the trap no longer sits on the 5th and carries a lot of current near resonance.', fix: 'Replace the capacitor bank, re-check tuning.', hw: true, set: { filt: 'p5', vfd: 120 } },
      { id: 'unbal', label: 'Loads badly unbalanced across the phases', say: 'L1 breaker runs hot and the neutral current is high; L2 and L3 are lightly loaded.', hint: 'Compare the three phase currents.', why: '75 / 10 / 15 kW: the neutral carries the unbalance, the L1 voltage drops, the transformer is poorly used.', fix: 'Re-distribute circuits across the phases (within about 10–15 %).', set: { l1: 75, l2: 10, l3: 15 } },
      { id: 'itHalf', label: 'Half-size neutral with IT loads (triplens)', say: 'The neutral cable of the IT floor is overheating although the phase currents are within rating.', hint: 'Look at the neutral current and its spectrum.', why: 'The 3rd harmonics of the three phases add in the neutral: the neutral carries more than the phases – a half-size neutral overloads.', fix: 'Full-size (or double) neutral for IT loads, or a 4-wire AHF.', set: { typ: 'it', nsz: 'half', filt: 'none' } },
      { id: 'ahfSmall', label: 'AHF undersized', say: 'Since more drives were added, the harmonic filter runs at 100 % all the time and THDv is still high.', hint: 'Read the AHF load and compare its rating with the harmonic current.', why: 'The harmonic current needed is far above the AHF rating – it saturates and only cancels part of it.', fix: 'Add AHF modules (size on the measured harmonic current + margin).', set: { filt: 'ahf', ahf: 30, vfd: 160 } },
      { id: 'p5Wrong', label: 'Passive 5th filter used for an IT (triplen) problem', say: 'A 5th-harmonic filter was fitted for the hot neutral on the IT floor – the neutral is still hot.', hint: 'Which harmonics cause the neutral current? Which one does the filter trap?', why: 'The neutral current is 3rd (triplen) harmonics. A 3-wire passive 5th filter does nothing for them.', fix: '4-wire active filter, or zig-zag / neutral blocking, and a full-size neutral.', set: { filt: 'p5', typ: 'it', l1: 55, l2: 55, l3: 55 } },
    ],
    sim(c, F) {
      const R = { tl: [], ph: [], N: {}, V: [], thdv: 0, ahfLoad: 0, notes: [] };
      const tl = (s, bad) => R.tl.push([null, s, bad]);
      const P = [c.l1, c.l2, c.l3], ang = [0, -120, 120], Xt = 0.016, Rf = 0.01, Rn = (c.nsz === 'half' ? 0.02 : 0.01) + (F.nloose ? 0.04 : 0), pf1 = { res: 1, led: 0.95, it: 0.98 }[c.typ];
      const Vs = ang.map((a) => pol(230, a)), Y = P.map((p) => (p > 0 ? (p * 1000) / 230 ** 2 : 0)), Yb = Y.map((y) => (y > 0 ? 1 / (1 / y + Rf) : 0)), Yn = F.pen ? 0 : 1 / Rn;
      const Vn = cdiv(Vs.reduce((s, v, k) => cadd(s, cmul(v, cx(Yb[k]))), cx(0)), cx(Yb.reduce((a, b) => a + b, 0) + Yn));
      const I1 = Vs.map((v, k) => cmul(csub(v, Vn), cx(Yb[k] / pf1)));
      const Vl = I1.map((i, k) => (Y[k] ? cabs(i) * pf1 / Y[k] : cabs(csub(Vs[k], Vn))));
      const iv1 = (c.vfd * 1000) / (Math.sqrt(3) * 400 * 0.95);
      const H = {};
      HS.forEach((h) => { H[h] = [0, 1, 2].map((k) => cadd(pol((SPEC[c.typ][h] || 0) * cabs(I1[k]), h * ang[k]), pol((VSPEC[h] || 0) * iv1, h * ang[k]))); });
      if (c.filt === 'p5') HS.forEach((h) => { const m = h === 5 ? (F.p5aged ? 0.75 : 0.15) : h === 7 ? 0.85 : 1; H[h] = H[h].map((z) => cmul(z, cx(m))); });
      if (c.filt === 'ahf' && !F.ahfoff) {
        const need = Math.max(...[0, 1, 2].map((k) => Math.sqrt(HS.reduce((s, h) => s + cabs(H[h][k]) ** 2, 0))));
        const f = need > 0 ? Math.min(1, c.ahf / need) : 1; R.ahfLoad = need > 0 ? Math.min(100, (100 * need) / c.ahf) : 0;
        HS.forEach((h) => { H[h] = H[h].map((z, k) => cmul(z, cx(F.ahfpol && k === 1 ? 1 + 0.95 * f : 1 - 0.95 * f))); });
      }
      const Itot1 = [0, 1, 2].map((k) => cabs(cadd(I1[k], pol(iv1, ang[k] - 18))));
      [0, 1, 2].map((k) => { const hr = Math.sqrt(HS.reduce((s, h) => s + cabs(H[h][k]) ** 2, 0)), vh = Math.sqrt(HS.reduce((s, h) => s + (cabs(H[h][k]) * h * Xt) ** 2, 0)); R.ph.push({ I: Math.hypot(Itot1[k], hr), I1: Itot1[k], thdi: Itot1[k] > 1 ? (100 * hr) / Itot1[k] : 0, V: Vl[k], thdv: (100 * vh) / 230, spec: [Itot1[k], ...HS.map((h) => cabs(H[h][k]))] }); });
      const In1 = F.pen ? 0 : cabs(I1.reduce((s, z) => cadd(s, z), cx(0))), Inh = HS.map((h) => (F.pen ? 0 : cabs(H[h].reduce((s, z) => cadd(s, z), cx(0)))));
      R.N = { I: Math.sqrt(In1 ** 2 + Inh.reduce((s, x) => s + x * x, 0)), spec: [In1, ...Inh], rating: c.nsz === 'half' ? 200 : 400 };
      R.thdv = Math.max(...R.ph.map((p) => p.thdv)); R.vn = cabs(Vn); R.I1 = I1; R.Vs = Vs; R.Vnp = Vn;
      const avg = (R.ph[0].I + R.ph[1].I + R.ph[2].I) / 3, unb = avg ? (100 * Math.max(...R.ph.map((p) => Math.abs(p.I - avg)))) / avg : 0;
      tl(`Phase currents ${R.ph.map((p, k) => `L${k + 1} ${Math.round(p.I)} A`).join(' · ')} – unbalance ${Math.round(unb)} %`, unb > 20);
      tl(`Neutral current ${Math.round(R.N.I)} A = ${Math.round((100 * R.N.I) / R.N.rating)} % of the ${R.N.rating} A neutral${R.N.I > R.N.rating ? ' – OVERLOADED, overheating' : R.N.I > 0.7 * R.N.rating ? ' – running warm' : ''}${Inh[0] > In1 && Inh[0] > 20 ? ` (mostly 3rd harmonic: ${Math.round(Inh[0])} A)` : ''}.`, R.N.I > 0.7 * R.N.rating);
      tl(`Voltages at the loads ${R.ph.map((p, k) => `L${k + 1} ${Math.round(p.V)} V`).join(' · ')}`, R.ph.some((p) => p.V > 253 || p.V < 216));
      if (F.pen) tl(`PEN broken: the star point has floated ${Math.round(R.vn)} V away from earth – exposed metalwork is at about ${Math.round(R.vn)} V, equipment on the high phase is being destroyed.`, 1);
      if (F.nloose) tl(`Neutral joint: ${Math.round(R.N.I)} A through 0.04 Ω = ${Math.round(R.N.I * R.N.I * 0.04)} W of heat at the terminal.`, 1);
      tl(`THDi ${R.ph.map((p, k) => `L${k + 1} ${Math.round(p.thdi)} %`).join(' · ')} · THDv at the busbar ${r1(R.thdv)} %${R.thdv > 5 ? ' – above the 5 % planning limit' : ''}`, R.thdv > 5);
      if (c.filt === 'ahf') tl(F.ahfoff ? 'AHF: ALARM – over-temperature, fan failure. Not filtering.' : `AHF running at ${Math.round(R.ahfLoad)} % of its ${c.ahf} A rating${R.ahfLoad >= 100 ? ' – SATURATED (undersized)' : ''}.`, F.ahfoff || R.ahfLoad >= 100);
      if (c.filt === 'p5') tl(F.p5aged ? 'Passive filter: capacitors hot, current 2 × rated – detuned, the 5th is back.' : 'Passive 5th filter: traps the 5th harmonic only (3-wire – nothing for the neutral).', F.p5aged);
      const K = (() => { const s = R.ph[0].spec, h = [1, ...HS], a = s.reduce((t, x, i) => t + x * x * h[i] * h[i], 0), b = s.reduce((t, x) => t + x * x, 0); return b ? a / b : 1; })();
      tl(`Transformer K-factor ${r1(K)}${K > 4 ? ' – harmonic heating: derate the transformer or use a K-rated one' : ''}.`, K > 4);
      return R;
    },
    tests: [
      ['an', 'Power analyser – all phases and neutral', (R) => R.ph.map((p, k) => `L${k + 1}: ${Math.round(p.I)} A, THDi ${Math.round(p.thdi)} %, ${Math.round(p.V)} V`).join(' · ') + ` · N: ${Math.round(R.N.I)} A`],
      ['spec', 'Harmonic spectrum of the selected channel', (R, c) => { const s = c.ch === 'N' ? R.N.spec : R.ph[+c.ch[1] - 1].spec; return `${c.ch}: ${['1st', ...HS.map((h) => h + 'th')].map((l, i) => `${l} ${Math.round(s[i])} A`).join(' · ')}`; }],
      ['ne', 'Neutral–earth voltage at the board', (R, c, F) => `${r1(R.vn + (F.pen ? 0 : (R.N.spec[1] || 0) * 0.01))} V${R.vn > 10 ? ' – far too high (normal < 2 V)' : ''}`],
      ['thdv', 'Voltage THD at the busbar', (R) => `${r1(R.thdv)} %`],
      ['ahfd', 'Read the filter display', (R, c, F) => (c.filt === 'ahf' ? (F.ahfoff ? 'ALARM: OVERTEMP – FAN FAULT · output 0 A' : `Load ${Math.round(R.ahfLoad)} % · CT check: ${F.ahfpol ? 'L2 phase angle 180° – CT REVERSED' : 'OK'}`) : c.filt === 'p5' ? `Passive filter current ${F.p5aged ? '2.1 × rated' : '0.8 × rated'}` : 'No filter fitted')],
      ['therm', 'Thermal camera on the board', (R, c, F) => [F.nloose ? 'Neutral terminal 104 °C' : '', R.N.I > R.N.rating ? `Neutral cable ${Math.round(40 + 45 * (R.N.I / R.N.rating) ** 2)} °C` : '', R.ph.some((p) => p.I > 300) ? 'L1 breaker 68 °C' : '', F.p5aged && c.filt === 'p5' ? 'Filter capacitors 72 °C' : ''].filter(Boolean).join(' · ') || 'Nothing hot (35–45 °C)'],
      ['cap', 'Passive filter capacitance (isolated)', (R, c, F) => (c.filt !== 'p5' ? 'No passive filter fitted' : F.p5aged ? '68 % of nameplate – aged' : '99 % of nameplate'), 0],
    ],
    view(R, c, F, sel) {
      let s = `<rect x="10" y="10" width="980" height="500" rx="8" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>${T(980, 28, 'Sub-main distribution board', 11, '#475569', 'end', 700)}`;
      s += `<circle cx="70" cy="80" r="26" fill="none" stroke="#475569" stroke-width="2.5"/><circle cx="70" cy="110" r="26" fill="none" stroke="#475569" stroke-width="2.5"/>${T(70, 156, 'TX 500 kVA', 10, '#14161c', 'middle', 700)}${hit('TX', 40, 50, 60, 116, sel)}`;
      s += busbars(150, 900, 60, ['L1', 'L2', 'L3', 'N'], 12) + wire([[96, 80], [150, 62]], '#92400e', 3) + (R.N.I > R.N.rating || F.nloose ? `<rect x="150" y="96" width="750" height="7" fill="#f97316" opacity=".5"/>` : '') + hit('NB', 140, 92, 770, 16, sel);
      [0, 1, 2].forEach((k) => { const x = 180 + k * 150, p = R.ph[k], hot = p.I > 300; s += wire([[x + 30, 62 + k * 12], [x + 30, 160]], PH['L' + (k + 1)], 3) + wire([[x + 60, 98], [x + 60, 160]], PH.N, 3) + `<rect x="${x}" y="160" width="110" height="110" rx="6" fill="#fff" stroke="${hot ? '#dc2626' : '#94a3b8'}" stroke-width="${hot ? 2.5 : 1.2}"/>${T(x + 55, 182, `L${k + 1} loads`, 11, '#14161c', 'middle', 700)}${T(x + 55, 202, `${c['l' + (k + 1)]} kW`, 13, '#244286', 'middle', 700)}${T(x + 55, 222, ({ res: 'heaters', led: 'LED drivers', it: 'IT / SMPS' })[c.typ], 9, '#64748b')}${T(x + 55, 242, `phase ${Math.round(p.I)} A`, 12, hot ? '#dc2626' : '#14161c', 'middle', 700)}${T(x + 55, 260, `${Math.round(p.V)} V`, 10, p.V > 253 || p.V < 216 ? '#dc2626' : '#15803d', 'middle', 700)}${hit('LD' + (k + 1), x - 4, 156, 118, 118, sel)}`; });
      s += [0, 1, 2].map((k) => wire([[650 + k * 14, 62 + k * 12], [650 + k * 14, 160]], PH['L' + (k + 1)], 3)).join('') + `<rect x="630" y="160" width="90" height="110" rx="6" fill="#e0e7ff" stroke="#6366f1"/>${T(675, 184, 'VFDs', 11, '#14161c', 'middle', 700)}${T(675, 206, `${c.vfd} kW`, 13, '#244286', 'middle', 700)}${T(675, 226, '6-pulse', 9, '#64748b')}${hit('VFD', 626, 156, 98, 118, sel)}`;
      s += [0, 1, 2, 3].map((k) => wire([[780 + k * 14, k < 3 ? 62 + k * 12 : 98], [780 + k * 14, 160]], k < 3 ? PH['L' + (k + 1)] : PH.N, c.filt === 'ahf' ? 3 : k < 3 && c.filt === 'p5' ? 3 : 0.5)).join('') + `<rect x="760" y="160" width="110" height="110" rx="6" fill="${c.filt === 'none' ? '#f8fafc' : '#dcfce7'}" stroke="${(F.ahfoff && c.filt === 'ahf') || (F.p5aged && c.filt === 'p5') ? '#dc2626' : '#16a34a'}" stroke-dasharray="${c.filt === 'none' ? '5 4' : ''}"/>${T(815, 184, c.filt === 'ahf' ? 'Active filter' : c.filt === 'p5' ? 'Passive 5th' : 'no filter', 11, '#14161c', 'middle', 700)}${c.filt === 'ahf' ? lcd(772, 194, 86, 40, [F.ahfoff ? 'ALARM TEMP' : `LOAD ${Math.round(R.ahfLoad)}%`, `${c.ahf} A`], '#0b1220', F.ahfoff || R.ahfLoad >= 100 ? '#fca5a5' : '#a7f3d0') : ''}${hit('AHF', 756, 156, 118, 118, sel)}`;
      s += `${lcd(150, 300, 330, 92, ['      I(A)  THDi  V    THDv', ...R.ph.map((p, k) => `L${k + 1}   ${String(Math.round(p.I)).padStart(4)}  ${String(Math.round(p.thdi)).padStart(3)}%  ${String(Math.round(p.V)).padStart(3)}  ${r1(p.thdv)}%`), `N    ${String(Math.round(R.N.I)).padStart(4)}  of ${R.N.rating} A`], '#0b1220', '#bef264')}${T(315, 408, 'Power analyser', 10, '#14161c', 'middle', 700)}${hit('AN', 146, 296, 338, 120, sel)}`;
      const cxp = 640, cyp = 400, sc = 0.28; s += `<circle cx="${cxp}" cy="${cyp}" r="90" fill="#fff" stroke="#e2e8f0"/>${T(cxp, cyp - 96, 'Fundamental current phasors', 9, '#475569', 'middle', 700)}`;
      R.I1.forEach((z, k) => { s += `<line x1="${cxp}" y1="${cyp}" x2="${r1(cxp + z.re * sc)}" y2="${r1(cyp - z.im * sc)}" stroke="${PH['L' + (k + 1)]}" stroke-width="3"/>${T(r1(cxp + z.re * sc * 1.1), r1(cyp - z.im * sc * 1.1), 'L' + (k + 1), 9, PH['L' + (k + 1)], 'middle', 700)}`; });
      const nz = R.I1.reduce((a, z) => cadd(a, z), cx(0)); s += `<line x1="${cxp}" y1="${cyp}" x2="${r1(cxp + nz.re * sc)}" y2="${r1(cyp - nz.im * sc)}" stroke="${PH.N}" stroke-width="3" stroke-dasharray="5 3"/>${T(r1(cxp + nz.re * sc) + 6, r1(cyp - nz.im * sc), 'N (fund.)', 9, PH.N, 'start', 700)}`;
      s += `${T(830, 330, 'N–E voltage', 10, '#475569', 'middle', 700)}${T(830, 356, `${r1(R.vn)} V`, 20, R.vn > 10 ? '#dc2626' : '#15803d', 'middle', 700)}${F.pen ? T(830, 384, '⚠ PEN broken', 12, '#dc2626', 'middle', 700) : ''}`;
      return s;
    },
    chart: (R, c) => { const s = c.ch === 'N' ? R.N.spec : R.ph[+c.ch[1] - 1].spec, mx = Math.max(50, ...s) * 1.15; return bars(560, 200, ['1', ...HS.map(String)].map((l, i) => [l, s[i], i === 0 ? '#94a3b8' : [3, 9].includes(+l) ? '#dc2626' : '#244286']), Math.ceil(mx / 50) * 50, { yl: `${c.ch} – current by harmonic order (A) · red = triplen` }); },
  };

  // ---------------------------------------------------------------- 6. power factor correction – APFC panel
  const STEPS = [12.5, 25, 50, 50, 50, 50], SSC = 1000 / 0.06, XT = 0.0096;
  PAN.pfc = {
    title: 'Power factor correction – APFC panel',
    intro: 'Six capacitor steps (12.5 + 25 + 4 × 50 = 237.5 kvar) with fuses, capacitor-duty contactors and 7 % detuning reactors, switched by the APFC controller. The controller reads one CT on the incomer (L1) and the voltage L2–L3, works out cos φ and switches steps to reach the target. Try day and night load.',
    parts: {
      CT: ['CT on the incomer – L1', 'Must be on the supply side of BOTH the load and the capacitor bank, on the phase the controller is set for, P1 towards the supply.'],
      APFC: ['APFC controller', 'Target cos φ, C/k (response threshold relative to the smallest step), switching delay (must allow the capacitors to discharge – typically 40–60 s), CT phase setting.'],
      ST: ['Capacitor steps 1–6', 'Each: 3 HRC fuses → capacitor-duty contactor (pre-charge resistors) → detuning reactor → 3-phase capacitor with discharge resistors.'],
      DET: ['Detuning reactors 7 %', 'Tune the bank to 189 Hz (below the 5th harmonic) so the capacitors cannot resonate with the transformer at the 5th, 7th, 11th…'],
      FAN: ['Cabinet fan and thermostat', 'Reactors and capacitors make heat; capacitor life halves for every 10 °C.'],
      PF: ['Incomer power factor meter', 'The true cos φ seen by the utility.'],
      LOAD: ['Plant load', 'Motors, drives (VFD share sets the harmonics).'],
    },
    sets: [['P', 'LOAD', 'Day load', 'range', 100, 400, 10, ' kW'], ['pf', 'LOAD', 'Load cos φ (uncorrected)', 'range', 0.6, 0.95, 0.01, ''], ['vfd', 'LOAD', 'Share of load on VFDs', 'range', 0, 80, 5, ' %'], ['tgt', 'APFC', 'Target cos φ', 'range', 0.85, 1, 0.01, ''], ['ck', 'APFC', 'C/k', 'range', 0.05, 1, 0.05, ''], ['dly', 'APFC', 'Switching delay', 'range', 2, 120, 1, ' s'], ['ctph', 'APFC', 'CT phase setting', 'select', [['L1', 'CT in L1, voltage L2-L3'], ['L2', 'CT in L2, voltage L3-L1'], ['L3', 'CT in L3, voltage L1-L2']]], ['det', 'DET', 'Detuning reactors', 'select', [['yes', 'Fitted (7 %)'], ['no', 'Not fitted']]]],
    init: () => ({ P: 250, pf: 0.78, vfd: 25, tgt: 0.95, ck: 0.6, dly: 45, ctph: 'L1', det: 'yes', ev: 'day' }),
    ops: [{ l: () => 'Day – full production', on: (c) => c.ev === 'day', a: (c) => { c.ev = 'day'; } }, { l: () => 'Night – light load', on: (c) => c.ev === 'night', a: (c) => { c.ev = 'night'; } }],
    faults: [
      { id: 'ctPol', label: 'CT polarity reversed (P1/P2 swapped)', say: 'The utility charges a low power factor penalty although the APFC panel is "on"; the controller shows a minus sign.', hint: 'Read the controller display – what does it think the power is doing?', why: 'With the CT reversed the controller sees power flowing back (export) and a wrong angle: it switches every step off.', fix: 'Swap S1/S2 at the controller (with the CT shorted) or set "CT inverted" in the controller.' },
      { id: 'ctPlace', label: 'CT on the load side (does not see the capacitors)', say: 'At night the power factor meter shows LEADING and the voltage is high; in the day the bank is always fully on.', hint: 'Does the controller ever see the effect of the capacitors it switches in?', why: 'The CT measures only the load current: the controller never sees its own correction, so it switches everything in – over-compensation at light load.', fix: 'Move the CT to the incomer, upstream of the capacitor bank connection.' },
      { id: 'fuse4', label: 'Step 4 fuse blown', say: 'The power factor is a little low in the day and the controller shows a step alarm.', hint: 'Clamp each step\'s current when it is switched in.', why: 'One fuse of step 4 is open: the step gives almost nothing (and unbalanced). The controller flags it.', fix: 'Find why it blew (harmonics, failed capacitor), replace with the correct gG/aM capacitor fuse.' },
      { id: 'aged3', label: 'Step 3 capacitor lost capacitance', say: 'The bank does not reach the target any more; one capacitor can looks swollen.', hint: 'Clamp the step currents and compare with the nameplate (50 kvar ≈ 72 A).', why: 'Self-healing capacitors lose µF with age, heat and over-voltage: 50 kvar now gives 30.', fix: 'Replace the capacitor; check temperature and harmonics.' },
      { id: 'weld3', label: 'Step 3 contactor welded', say: 'At night the power factor goes leading and the controller shows "over-compensation" although all its outputs are off.', hint: 'Which steps carry current with their outputs off?', why: 'The step 3 contactor contacts are welded: 50 kvar is on all the time – too much at night.', fix: 'Replace with a capacitor-duty contactor (pre-charge resistors); check the switching delay.' },
      { id: 'fan', label: 'Cabinet fan / thermostat failed', say: 'Capacitors in the APFC panel keep failing; the panel is hot to touch.', hint: 'Thermal camera / thermometer inside the cabinet.', why: 'No ventilation: 55 °C inside – capacitor life drops sharply, reactors run hot.', fix: 'Repair the fan and thermostat, clean the filters.' },
      { id: 'noDet', label: 'Bank without detuning reactors on a drive-heavy plant', say: 'Capacitor fuses blow every few weeks, the capacitors are hot and the drives trip on over-voltage.', hint: 'Measure THDv with the bank in and out, and the capacitor currents.', why: 'Plain capacitors with the transformer form a parallel resonance near the 11th–7th harmonic: the drive harmonics are amplified, THDv rises, capacitor currents and fuses overload.', fix: 'Fit 7 % detuned reactors (or a detuned bank), or an active filter.', set: { det: 'no', vfd: 60 } },
      { id: 'ctph', label: 'Controller CT phase setting wrong', say: 'After the controller was replaced, it shows a strange cos φ and keeps all steps off.', hint: 'Which phase is the CT on, and what is the controller set to?', why: 'The controller assumes CT in L3 / voltage L1-L2, but the CT is in L1: the measured angle is 120° wrong.', fix: 'Set the controller to the actual CT phase (or run its auto-detection).', set: { ctph: 'L3' } },
      { id: 'ckLow', label: 'C/k set far too low (hunting)', say: 'The capacitor contactors click in and out all day long; contactors wear out quickly.', hint: 'Watch the step switching and read C/k.', why: 'C/k too small: the controller reacts to changes smaller than its smallest step, so it switches a step in and out continuously.', fix: 'Set C/k to the real ratio (smallest step current ÷ CT ratio, typically 0.5–0.7).', set: { ck: 0.1 } },
      { id: 'dlyShort', label: 'Switching delay shorter than the discharge time', say: 'Loud bangs from the APFC panel when steps switch; contactor contacts pitted.', hint: 'Compare the switching delay with the capacitor discharge time.', why: 'A step is reconnected 5 s after switching off, while still charged: huge inrush, contact damage, capacitor stress.', fix: 'Delay ≥ the discharge time (60 s to < 50 V), or fast discharge resistors.', set: { dly: 5, ck: 0.2 } },
    ],
    sim(c, F) {
      const R = { tl: [], on: [0, 0, 0, 0, 0, 0], kv: STEPS.map((k, i) => (F.fuse4 && i === 3 ? 4 : F.aged3 && i === 2 ? 30 : k)), alarms: [] };
      const tl = (s, bad) => R.tl.push([null, s, bad]);
      const P = c.ev === 'day' ? c.P : 40, pf = c.ev === 'day' ? c.pf : 0.85, Q = P * Math.tan(Math.acos(pf)), Qt = P * Math.tan(Math.acos(Math.min(0.999, c.tgt)));
      R.P = P; R.Q = Q;
      let mode = 'ok';
      if (F.ctPol || c.ctph === 'L2') mode = 'export'; else if (c.ctph === 'L3') mode = 'lead';
      if (F.ctPlace) mode = 'blind';
      const th = c.ck * 25 * 0.6;
      let best = 0;
      if (mode === 'ok') { const need = Q - Qt - (F.weld3 ? R.kv[2] : 0); let bv = -1; for (let m = 0; m < 64; m++) { if (F.weld3 && m & 4) continue; const q = STEPS.reduce((s, k, i) => s + (m >> i & 1 ? k : 0), 0); if (q <= need + th && q > bv) { bv = q; best = m; } } }
      if (mode === 'blind') best = 63;
      R.on = STEPS.map((k, i) => (best >> i & 1) || (F.weld3 && i === 2) ? 1 : 0);
      R.out = STEPS.map((k, i) => best >> i & 1);
      const Qc = R.kv.reduce((s, k, i) => s + (R.on[i] ? k : 0), 0), Qn = Q - Qc, S = Math.hypot(P, Qn);
      R.Qc = Qc; R.Qn = Qn; R.cos = P / S; R.lead = Qn < 0; R.I = (S * 1000) / (Math.sqrt(3) * 400);
      const measF = () => mode === 'export' ? `-${r1(pf).toFixed(2)} EXP` : mode === 'lead' ? '0.15 CAP' : mode === 'blind' ? `${pf.toFixed(2)} IND` : `${R.cos.toFixed(2)} ${R.lead ? 'CAP' : 'IND'}`;
      R.meas = measF();
      const iv = ((c.vfd / 100) * P * 1000) / (Math.sqrt(3) * 400 * 0.95), hr = Qc > 0 ? Math.sqrt(SSC / Qc) : 99;
      const Hh = { 5: 0.35, 7: 0.2, 11: 0.08, 13: 0.06 };
      let v2 = 0, ic2 = 0;
      Object.entries(Hh).forEach(([h, m]) => { h = +h; const A = Qc === 0 ? 1 : c.det === 'yes' ? (h === 5 ? 0.7 : 0.9) : Math.min(15, 1 / Math.abs(1 - (h / hr) ** 2)), Ih = m * iv, vh = Ih * h * XT * A; v2 += vh * vh; if (Qc > 0) ic2 += (c.det === 'yes' ? Ih * (h === 5 ? 0.3 : 0.1) : Ih * A * Math.min(1, (h / hr) ** 2)) ** 2; });
      R.thdv = (100 * Math.sqrt(v2)) / 230; const ic1 = (Qc * 1000) / (Math.sqrt(3) * 400); R.capRatio = ic1 > 0 ? Math.sqrt(ic1 * ic1 + ic2) / ic1 : 1; R.hr = hr;
      R.temp = (F.fan ? 55 : 34) + (R.capRatio > 1.3 ? 12 : 0) + (c.det === 'yes' ? 4 : 0);
      R.V = Math.round(230 * (1 - Qn / SSC));
      tl(`${c.ev === 'day' ? 'Day' : 'Night'}: load ${P} kW at cos φ ${pf.toFixed(2)} = ${Math.round(Q)} kvar. Target ${c.tgt.toFixed(2)} needs about ${Math.round(Math.max(0, Q - Qt))} kvar.`);
      tl(`Controller reads ${R.meas}${mode === 'export' ? ' – thinks the site is exporting / wrong angle: ALL STEPS OFF' : mode === 'lead' ? ' – thinks it is over-compensated: ALL STEPS OFF' : mode === 'blind' ? ' – never sees the capacitors: switches ALL STEPS IN' : ''}.`, mode !== 'ok');
      tl(`Steps in: ${R.on.map((o, i) => (o ? `S${i + 1}` : '')).filter(Boolean).join(' ') || 'none'} = ${r1(Qc)} kvar${F.weld3 && !R.out[2] ? ' (S3 IN although its output is OFF – welded)' : ''}${F.fuse4 && R.on[3] ? ' (S4 gives almost nothing – fuse open)' : ''}${F.aged3 && R.on[2] ? ' (S3 gives only 30 kvar – aged)' : ''}.`, (F.weld3 && !R.out[2]) || (F.fuse4 && R.on[3]) || (F.aged3 && R.on[2]));
      tl(`True power factor at the incomer: ${R.cos.toFixed(2)} ${R.lead ? 'LEADING' : 'lagging'}${!R.lead && R.cos < 0.9 ? ' – below 0.9: utility penalty' : ''}${R.lead && R.cos < 0.95 ? ' – over-compensated: voltage rise, utility penalty' : ''}. Incomer current ${Math.round(R.I)} A.`, (!R.lead && R.cos < 0.9) || (R.lead && R.cos < 0.95));
      if (F.fuse4 && R.out[3]) R.alarms.push('STEP 4 FAULT');
      if (F.weld3 && !R.out[2] && c.ev === 'night') R.alarms.push('OVERCOMP');
      tl(`THDv ${r1(R.thdv)} %${c.det === 'no' && Qc > 0 ? ` · bank resonance at the ${r1(hr)}th harmonic (no detuning)` : ''}${R.capRatio > 1.3 ? ` · capacitor current ${Math.round(R.capRatio * 100)} % of rated – fuses blow, capacitors overheat` : ''}.`, R.thdv > 5 || R.capRatio > 1.3);
      if (c.ck < 0.3 || c.tgt >= 0.99) tl(`Hunting: the smallest step switches in and out every ${c.dly} s (C/k ${c.ck}${c.tgt >= 0.99 ? ', target 1.00' : ''}).`, 1);
      if (c.dly < 30) tl(`Switching delay ${c.dly} s is shorter than the 60 s discharge time – steps reconnect while charged: bangs, contact wear.`, 1);
      if (F.fan) tl('Cabinet 55 °C – the fan is not running.', 1);
      return R;
    },
    tests: [
      ['apfc', 'Read the APFC controller display', (R, c) => `cos φ ${R.meas} · outputs ${R.out.map((o, i) => (o ? i + 1 : '·')).join('')} · target ${c.tgt} · C/k ${c.ck} · delay ${c.dly} s · CT ${c.ctph}${R.alarms.length ? ' · ALARM ' + R.alarms.join(', ') : ''}`],
      ['pfm', 'Incomer power factor meter', (R) => `${R.cos.toFixed(2)} ${R.lead ? 'CAP (leading)' : 'IND (lagging)'} · ${R.P} kW · ${Math.round(R.Qn)} kvar · ${R.V} V`],
      ['clamp', 'Clamp meter on each step (A per phase)', (R, c, F) => R.kv.map((k, i) => `S${i + 1} ${R.on[i] ? (F.fuse4 && i === 3 ? '0 / 36 / 36 A (one phase 0)' : Math.round(((k * 1000) / (Math.sqrt(3) * 400)) * Math.min(R.capRatio, 1.6)) + ' A') : '0 A'}`).join(' · ')],
      ['thdv', 'Power analyser – THDv, bank in', (R) => `THDv ${r1(R.thdv)} %`],
      ['therm', 'Thermal camera / thermometer in the cabinet', (R, c, F) => `Air ${R.temp} °C${F.aged3 ? ' · S3 can bulged' : ''}${R.capRatio > 1.3 ? ' · capacitors 65 °C, fuse holders hot' : ''}`],
      ['ctchk', 'Check the CT: position, phase and P1 direction', (R, c, F) => `${F.ctPlace ? 'CT is on the LOAD cable, downstream of the capacitor connection!' : 'CT on the incomer (sees load + capacitors)'} · phase L1 · ${F.ctPol ? 'P1 faces the LOAD – reversed' : 'P1 towards the supply'}`],
      ['look', 'Look at the step contactors', (R, c, F) => (F.weld3 ? 'S3 contactor indicator IN while its coil is off – welded' : c.dly < 30 ? 'Contacts blackened and pitted' : 'All normal, pre-charge resistors intact')],
      ['cap', 'Capacitance of each step (isolated, discharged)', (R, c, F) => R.kv.map((k, i) => `S${i + 1} ${F.aged3 && i === 2 ? '60 %' : '99 %'}`).join(' · ') + (F.fuse4 ? ' · S4 fuse L1 OPEN' : ''), 1],
    ],
    view(R, c, F, sel) {
      let s = `<rect x="10" y="10" width="980" height="500" rx="8" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2"/>${T(980, 28, 'APFC panel (doors open)', 11, '#475569', 'end', 700)}`;
      s += busbars(120, 940, 44, ['L1', 'L2', 'L3'], 12) + wire([[40, 56], [120, 56]], '#92400e', 4) + `<ellipse cx="${F.ctPlace ? 90 : 70}" cy="56" rx="10" ry="16" fill="none" stroke="${F.ctPol ? '#dc2626' : '#7c3aed'}" stroke-width="5"/>${T(70, 92, 'CT', 10, '#7c3aed', 'middle', 700)}${hit('CT', 52, 34, 56, 64, sel)}`;
      s += `<rect x="30" y="120" width="140" height="150" rx="6" fill="#f8fafc" stroke="#64748b"/>${lcd(42, 132, 116, 52, [R.meas, `${R.out.map((o) => (o ? '■' : '□')).join('')}`, R.alarms[0] || `target ${c.tgt.toFixed(2)}`], '#0b1220', R.alarms.length || /EXP|CAP/.test(R.meas) ? '#fca5a5' : '#a7f3d0')}${dial(70, 220, (c.ck - 0.05) / 0.95, 'C/k', c.ck, 9)}${dial(130, 220, (c.dly - 2) / 118, 'delay', `${c.dly}s`, 9)}${T(100, 288, 'APFC controller', 10, '#14161c', 'middle', 700)}${hit('APFC', 26, 116, 148, 180, sel)}`;
      STEPS.forEach((k, i) => {
        const x = 200 + i * 125, on = R.on[i];
        s += [0, 1, 2].map((p) => wire([[x + 18 + p * 18, 44 + p * 12], [x + 18 + p * 18, 90]], PH['L' + (p + 1)], 2)).join('');
        s += [0, 1, 2].map((p) => `<rect x="${x + 12 + p * 18}" y="90" width="12" height="30" rx="2" fill="${F.fuse4 && i === 3 && p === 0 ? '#fecaca' : '#fff'}" stroke="#64748b"/>`).join('');
        s += cont(x + 8, 140, `S${i + 1}`, on, { weld: F.weld3 && i === 2 }).replace(/A1|A2|13 14 21 22/g, '');
        if (c.det === 'yes') s += `<rect x="${x + 14}" y="262" width="44" height="40" rx="4" fill="#a8a29e" stroke="#57534e"/>${T(x + 36, 286, 'L 7%', 8, '#fff', 'middle', 700)}`;
        s += capCan(x + 19, 316, `${k} kvar`, on, F.aged3 && i === 2 ? 'bulge' : '') + (R.capRatio > 1.3 && on ? heat(x + 36, 350, 18) : '');
        s += wire([[x + 36, 224], [x + 36, c.det === 'yes' ? 262 : 316]], '#475569', 1.5) + (c.det === 'yes' ? wire([[x + 36, 302], [x + 36, 316]], '#475569', 1.5) : '');
      });
      s += hit('ST', 196, 86, 750, 330, sel) + (c.det === 'yes' ? '' : T(570, 290, 'no detuning reactors', 10, '#b91c1c', 'middle', 700)) + `<rect x="940" y="60" width="40" height="40" rx="20" fill="${F.fan ? '#fecaca' : '#e2e8f0'}" stroke="#475569"/>${T(960, 85, F.fan ? '✗' : '✣', 18, '#334155')}${T(960, 116, `${R.temp} °C`, 10, R.temp > 45 ? '#dc2626' : '#14161c', 'middle', 700)}${hit('FAN', 934, 54, 52, 70, sel)}${hit('DET', 210, 258, 120, 48, sel)}`;
      s += `<rect x="30" y="320" width="140" height="80" rx="6" fill="#fff" stroke="#475569"/>${dial(100, 362, R.lead ? 0.5 + (1 - R.cos) * 2 : 0.5 - (1 - R.cos) * 2, 'IND · 1 · CAP', R.cos.toFixed(2) + (R.lead ? ' cap' : ''), 22)}${T(100, 418, 'PF meter', 10, '#14161c', 'middle', 700)}${hit('PF', 26, 316, 148, 110, sel)}`;
      s += `<rect x="200" y="440" width="740" height="56" rx="6" fill="#e0e7ff" stroke="#6366f1"/>${T(570, 464, `Plant load: ${R.P} kW · ${Math.round(R.Q)} kvar · ${c.vfd} % on drives`, 11, '#14161c', 'middle', 700)}${T(570, 482, `THDv ${r1(R.thdv)} % · incomer ${Math.round(R.I)} A · ${R.V} V`, 10, R.thdv > 5 ? '#dc2626' : '#475569', 'middle', 700)}${hit('LOAD', 196, 436, 748, 64, sel)}`;
      return s;
    },
    chart: (R) => bars(560, 200, [['load', R.Q, '#94a3b8'], ...R.kv.map((k, i) => [`S${i + 1}`, R.on[i] ? k : 0, '#16a34a']), ['net', Math.abs(R.Qn), R.lead ? '#dc2626' : '#244286']], 260, { yl: 'kvar – load, steps in, net (red = leading)' }),
  };

  // ---------------------------------------------------------------- framework
  function bench(el, opt, done) {
    const P = PAN[opt.p];
    let mode = 'explore', c = P.init(), F = {}, sel = null, round = 0, score = 0, hid = [], hintN = 0, ticks = new Set(), log = [], order = [], result = null, stopped = false;
    onStop(() => (stopped = true));
    el.innerHTML = `<div class="row" style="margin-bottom:8px"><span class="btn s on" data-m="explore">Explore – change settings, break parts</span><span class="btn s" data-m="challenge">Challenge – find the hidden faults (3 rounds)</span></div><div id="pbTop"></div><div class="ctlbar" id="pbOps"></div><div class="panel scroll" style="margin-top:8px"><svg id="pbView" viewBox="0 0 1000 ${P.vh || 520}" style="min-width:860px"></svg></div><div class="two" style="margin-top:10px"><div><div id="pbPart" class="card" style="padding:12px"></div><div id="pbWhat" style="margin-top:10px"></div></div><div><div class="sec">What happened</div><div id="pbTL" class="card" style="padding:10px;font-size:13px"></div><div class="panel" style="margin-top:8px" id="pbChartW"><svg id="pbChart" viewBox="0 0 560 200"></svg></div><div class="sec">Tests and measurements</div><div id="pbTests" class="chips"></div><div class="meter" id="pbMeter" style="margin-top:6px"><div class="mm">— — —</div><div class="ms">Pick a test</div></div><div id="pbLog" class="note"></div></div></div><div id="pbDiag" style="margin-top:12px"></div>`;
    el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); round = 0; score = 0; log = []; if (mode === 'challenge') newRound(); else { c = P.init(); F = {}; result = null; } draw(); }));
    const meter = (a, b) => { $('pbMeter').innerHTML = `<div class="mm ${/⚠|OL –|WELD|burnt|bridged|0 V \(|TRIP/i.test(a) ? 'warn' : ''}">${esc(a)}</div><div class="ms">${esc(b)}</div>`; log.unshift(`${b}: ${a}`); $('pbLog').innerHTML = log.slice(0, 10).map(esc).join('<br>'); };
    function newRound() {
      c = P.init(); F = {}; result = null; ticks = new Set(); hintN = 0; log = []; sel = null;
      if (P.rand) P.rand(c);
      const pool = P.faults.slice(), n = Math.random() < 0.35 ? 2 : 1; hid = [];
      while (hid.length < n && pool.length) { const f = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; if (hid.some((h) => (h.excl || []).includes(f.id) || (f.excl || []).includes(h.id) || h.set && f.set && Object.keys(f.set).some((k) => k in h.set))) continue; hid.push(f); if (f.also && !hid.find((x) => x.id === f.also)) { const a = P.faults.find((x) => x.id === f.also); if (a) hid.push(a); } }
      hid.forEach((f) => { if (f.set) Object.assign(c, f.set); if (!f.set || f.hw) F[f.id] = true; });
      order = P.faults.map((f) => f.id).sort(() => Math.random() - 0.5);
    }
    function draw() {
      const R = P.sim(c, F); R.tl.sort((a, b) => (a[0] || 0) - (b[0] || 0));
      $('pbTop').innerHTML = mode === 'challenge' ? `<div class="ticket"><b>Job ${round + 1} of 3</b> · score ${score}<div style="margin-top:4px">${hid.map((f) => `• ${esc(f.say)}`).join('<br>')}</div><div class="note">Operate the panel, measure, then tick every fault you find below. ${P.intro ? esc(P.intro) : ''}</div></div>` : `<div class="say">${esc(P.intro)}</div>`;
      $('pbOps').innerHTML = P.ops.map((o, i) => (o.range ? `<label class="inl">${esc(o.l(c))} <input type="range" data-or="${i}" min="${o.range[0]}" max="${o.range[1]}" step="${o.range[2]}" value="${o.v(c)}" style="width:150px"> <b>${esc(o.fmt ? o.fmt(o.v(c)) : o.v(c))}</b></label>` : `<span class="btn s ${o.on && o.on(c) ? 'on' : ''}" data-o="${i}">${esc(o.l(c))}</span>`)).join('');
      $('pbOps').querySelectorAll('[data-o]').forEach((b) => (b.onclick = () => { P.ops[+b.dataset.o].a(c); draw(); }));
      $('pbOps').querySelectorAll('[data-or]').forEach((b) => (b.oninput = () => { P.ops[+b.dataset.or].a(c, +b.value); draw(); }));
      $('pbView').innerHTML = P.view(R, c, F, sel);
      $('pbView').querySelectorAll('[data-p]').forEach((n) => (n.onclick = () => { sel = sel === n.dataset.p ? null : n.dataset.p; draw(); }));
      $('pbTL').innerHTML = R.tl.length ? R.tl.map(([t, s, bad]) => `<div style="display:flex;gap:8px;padding:2px 0">${t == null ? '' : `<b style="min-width:70px;color:var(--mut);white-space:nowrap">t = ${fmtS(t)}</b>`}<span style="${bad ? 'color:var(--bad)' : ''}">${esc(s)}</span></div>`).join('') : '<span class="m">—</span>';
      const ch = P.chart ? P.chart(R, c) : '';
      $('pbChartW').classList.toggle('hidden', !ch); if (ch) { $('pbChart').innerHTML = ch; const vb = ch.match(/^<!--vb (\d+) (\d+)-->/); $('pbChart').setAttribute('viewBox', vb ? `0 0 ${vb[1]} ${vb[2]}` : '0 0 560 200'); }
      $('pbTests').innerHTML = P.tests.map(([k, l, , dead]) => `<span class="btn s" data-t="${k}">${dead ? '🔒 ' : ''}${esc(l)}</span>`).join('');
      $('pbTests').querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { const t = P.tests.find((x) => x[0] === b.dataset.t); if (t[3] && P.iso && !P.iso(c)) { meter('⚠ Dead test – isolate and lock off first', t[1]); return; } const v = t[2](R, c, F); meter(Array.isArray(v) ? v.join(' · ') : v, t[1]); }));
      drawPart(R); drawWhat(); drawDiag();
    }
    function drawPart() {
      const box = $('pbPart');
      if (!sel) { box.innerHTML = `<p class="m" style="margin:0">Tap any component in the panel to read what it does${P.sets.length ? ' and change its settings' : ''}.</p>`; return; }
      const [name, role] = P.parts[sel] || [sel, ''], st = P.sets.filter((x) => x[1] === sel);
      box.innerHTML = `<b>${esc(name)}</b><p style="margin:4px 0">${esc(role)}</p><div class="ctl">${st.map(([k, , l, kind, a, b, stp, u]) => (kind === 'range' ? `<div><label>${esc(l)} <b>${esc(String(c[k]) + (u || ''))}</b></label><input type="range" data-s="${k}" min="${a}" max="${b}" step="${stp}" value="${c[k]}" style="width:100%"></div>` : `<div><label>${esc(l)}</label><select data-s="${k}">${a.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(c[k]) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`)).join('')}</div>`;
      box.querySelectorAll('[data-s]').forEach((i) => (i.onchange = i.oninput = () => { const v = i.value; c[i.dataset.s] = isNaN(+v) || v === '' ? v : +v; draw(); }));
    }
    function drawWhat() {
      const box = $('pbWhat');
      if (mode !== 'explore') { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="card" style="padding:12px"><b>What if… make it fail</b><div class="note">Hardware faults switch on and off. Setting faults put a wrong setting in (change it back on the component).</div><div class="chips" style="margin-top:6px">${P.faults.map((f) => `<span class="btn s ${F[f.id] ? 'red' : ''}" data-f="${f.id}">${f.set && !f.hw ? '⚙ ' : ''}${esc(f.label)}</span>`).join('')}<span class="btn s" data-f="">Reset everything</span></div><div id="pbWhy" class="note" style="margin-top:6px"></div></div>`;
      box.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { const f = P.faults.find((x) => x.id === b.dataset.f); if (!f) { c = P.init(); F = {}; draw(); return; } if (F[f.id]) delete F[f.id]; else { if (f.set) Object.assign(c, f.set); if (!f.set || f.hw) F[f.id] = true; } draw(); $('pbWhy').innerHTML = `<b>${esc(f.label)}</b> – ${esc(f.why)}<br><b>Fix:</b> ${esc(f.fix)}`; }));
    }
    function drawDiag() {
      const box = $('pbDiag');
      if (mode !== 'challenge') { box.innerHTML = ''; return; }
      if (result) { box.innerHTML = result; const b = $('pbNext'); if (b) b.onclick = () => { if (round >= 3) { round = 0; score = 0; } newRound(); draw(); }; return; }
      box.innerHTML = `<div class="card"><b>Diagnosis – tick every fault you found</b><div style="columns:2;column-gap:18px;margin-top:6px">${order.map((id) => { const f = P.faults.find((x) => x.id === id); return `<label class="dg"><input type="checkbox" data-d="${id}" ${ticks.has(id) ? 'checked' : ''}> <span>${esc(f.label)}</span></label>`; }).join('')}</div><div class="row" style="margin-top:8px"><span class="btn p" id="pbSub">Submit diagnosis</span><span class="btn s" id="pbHint">💡 Hint</span><span class="note" id="pbHintT"></span></div></div>`;
      box.querySelectorAll('[data-d]').forEach((i) => (i.onchange = () => { if (i.checked) ticks.add(i.dataset.d); else ticks.delete(i.dataset.d); }));
      $('pbHint').onclick = () => { const f = hid[hintN % hid.length]; hintN++; $('pbHintT').textContent = f.hint; };
      $('pbSub').onclick = () => {
        const ids = hid.map((f) => f.id), tp = ids.filter((i) => ticks.has(i)).length, fp = [...ticks].filter((i) => !ids.includes(i)).length, ok = tp === ids.length && fp === 0;
        if (ok) score++; round++;
        result = `<div class="card">${kpi([[ok ? '✓' : '✗', ok ? 'all faults found' : 'not quite', !ok], [`${tp} / ${ids.length}`, 'faults found'], [fp, 'wrong ticks', fp > 0], [`${score} / ${round}`, 'jobs solved']])}${hid.map((f) => `<div class="${ticks.has(f.id) ? 'say' : 'watch'}" style="margin-top:6px"><b>${ticks.has(f.id) ? '✓' : '✗ missed:'} ${esc(f.label)}</b><br>${esc(f.why)}<br><b>Fix:</b> ${esc(f.fix)}</div>`).join('')}${[...ticks].filter((i) => !ids.includes(i)).map((i) => `<div class="note">✗ Not a fault this time: ${esc(P.faults.find((x) => x.id === i).label)}</div>`).join('')}<div class="row" style="margin-top:10px">${round >= 3 ? `<b>${score >= 2 ? 'Passed ✓' : 'Not yet – solve 2 of 3 jobs. Use Explore to see each fault.'}</b>` : ''}<span class="btn p" id="pbNext">${round >= 3 ? 'Play again' : 'Next job'}</span></div></div>`;
        if (round >= 3 && done) done(score, 3);
        draw();
      };
    }
    if (stopped) return;
    draw();
  }
  W.panel = bench;
  PAN.motor.iso = (c) => c.iso;
  [['p_motor', '⚙️', 'Motor starter – star-delta', 'Contactors and coils, interlocks, star-delta timer, overload relay, MCCB magnetic setting', 'motor'], ['p_light', '💡', 'Lighting control panel', 'Contactor, time switch, photocell, selector, MCB vs cable, LED inrush, voltage drop', 'light'], ['p_prot', '🛡️', 'Incomer protection – MCCB, PFR, EFR', 'LSIG trip unit settings and discrimination, phase failure relay, earth-fault relay with CBCT', 'prot'], ['p_ats', '🔁', 'ATS – mains / generator changeover', 'Sensing, timers T1–T5, generator start, interlock, phase rotation', 'ats'], ['p_pq', '〰️', 'Power quality – unbalance and harmonics', 'Unbalance, neutral current, triplens, THD, active and passive filters, broken PEN', 'pq'], ['p_pfc', '⚡', 'Power factor correction – APFC', 'Controller settings, CT location and polarity, steps, fuses, detuning and resonance', 'pfc']].forEach(([id, ic, t, sub, p]) => PAN[p] && work('panel', id, ic, t, sub, 'panel', { p }));
  window.__PAN = PAN;
})();
