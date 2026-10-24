/* High-power LED driver workbench – a 1700 W, 3-channel, DMX-RDM, 220-400 VAC driver of the RHPS576BC-T type (high masts, stadiums, ports).
   Explore: break parts and loads, change the supply, current setting, ambient and cable length. Challenge: hidden faults.
   Trip case: the driver ran perfectly, then the breaker tripped – after the reset it does not work. Find out why. */
(function () {
  const { SYM, ln, txt } = window.__DRV;
  const r1 = (v) => Math.round(v * 10) / 10;
  const MCBS = ['B10', 'B16', 'B20', 'B25', 'C10', 'C16', 'C20', 'C25', 'D10', 'D16', 'D20', 'D25'];
  const MAXN = { 230: [1, 1, 2, 2, 1, 1, 2, 2, 1, 1, 2, 2], 400: [0, 1, 1, 1, 1, 1, 2, 3, 1, 2, 2, 3] };
  const maxDrivers = (vin, mcb) => MAXN[vin][MCBS.indexOf(mcb)];
  const DERATE = [[25, 1700], [30, 1625], [35, 1550], [40, 1475], [45, 1400], [50, 1306], [55, 1212]];
  const allowedW = (t) => { if (t <= 25) return 1700; for (let i = 1; i < DERATE.length; i++) if (t <= DERATE[i][0]) { const [a, pa] = DERATE[i - 1], [b, pb] = DERATE[i]; return pa + ((pb - pa) * (t - a)) / (b - a); } return 1212; };
  const CODE = { 1: 'CCR module not working', 2: 'output short-circuited', 3: 'output disconnected from load', 4: 'thermal derating active', 5: 'CCR firmware not compatible' };

  // ---------------------------------------------------------------- parts (x, y = centre on the schematic)
  const P = (id, sym, x, y, name, role, modes, extra) => ({ id, sym, x, y, name, role, modes, ...extra });
  const PARTS = [
    P('F1', 'fuse', 90, 90, 'F1 – input fuse 15 A', 'Disconnects the driver if anything on the primary side short-circuits.', { open: 'Open – the driver is dead (signal LED off).' }, { look: { open: 'Fuse body blackened' }, ok: '0.01 Ω' }),
    P('MOV1', 'mov', 140, 180, 'MOV1 – surge varistor L1–L2', 'Clamps differential-mode surges (the driver is rated 10 kV) – it can only take so many before it fails.', { short: 'Failed short after a big surge – blows F1 (and usually trips the breaker).' }, { v: 1, look: { short: 'Varistor cracked and burnt' }, ok: 'OL' }),
    P('GDT', 'mov', 190, 285, 'MOV2 + GDT – surge path to PE', 'Common-mode surge protection: line to protective earth through a gas discharge tube.', { short: 'Failed short to PE – earth fault: the RCD trips as soon as the supply is on.' }, { v: 1, look: { short: 'GDT blackened' }, ok: 'OL' }),
    P('CY', 'cap', 245, 285, 'CY1/CY2 – Y capacitors to PE', 'EMI filter capacitors line-to-earth. They cause a small normal earth leakage (about 1.5 mA).', { short: 'Short to PE – earth fault: the RCD trips immediately.' }, { v: 1, ok: 'OL' }),
    P('LCM', 'cmc', 310, 180, 'LCM – common-mode choke', 'EMI filter.', { open: 'Winding open – no power, driver dead.' }, { ok: '0.05 Ω per winding' }),
    P('NTCR', 'ntc', 390, 90, 'NTCR – inrush limiter', 'Limits the switch-on current into the big bulk capacitors (40 A peak at 230 V, 68 A at 400 V).', { open: 'Open – no power reaches the bridge.' }, { look: { open: 'Cracked, discoloured' }, ok: '2 Ω cold' }),
    P('K1', 'sw', 390, 50, 'K1 – inrush bypass relay', 'Shorts out the NTC once the bulk capacitors are charged – also what makes hot restrike in < 1 s possible.', { weld: 'Contacts welded – no inrush limiting: the breaker trips at every cold switch-on.', stuck: 'Never closes – the NTC carries the full 7 A, gets very hot and burns open after a while.' }, { ok: 'coil 400 Ω' }),
    P('BR1', 'bridge', 470, 180, 'BR1 – bridge rectifier', 'AC to pulsating DC.', { short: 'Diode short – blows F1.', open: 'Open – no DC bus.' }, { ok: 'diodes 0.5 V' }),
    P('L1', 'ind', 545, 90, 'L1 – PFC boost inductor', 'Boosts the bus to about 620 V DC for any input from 198 to 440 V AC, power factor 0.99.', { open: 'Open – no DC bus, driver dead.' }, { ok: '0.1 Ω' }),
    P('Q1', 'fet', 600, 180, 'Q1 – PFC MOSFET', 'Switches the boost inductor. Heat and over-voltage stress are its enemies.', { short: 'Shorted – blows F1 (and often trips the breaker).', open: 'Open – no boost: bus only the peak of the mains.' }, { look: { short: 'Burnt, cracked package' }, ok: 'D–S OL' }),
    P('D1', 'dio', 650, 90, 'D1 – boost diode (SiC)', 'Passes the boosted energy to the bulk capacitors.', { open: 'Open – no DC bus, driver dead.' }, { ok: '1.1 V forward' }),
    P('U1', 'ic', 590, 345, 'U1 – PFC controller', 'Runs the PFC stage.', { dead: 'Dead – no boost: bus = mains peak (325 V on 230 V, 565 V on 400 V).' }, { w: 90, l: 'PFC CTRL', ok: '—' }),
    P('CB1', 'ecap', 705, 180, 'CB1/CB2 – bulk electrolytics 2 × 220 µF 450 V (in series)', 'Store energy on the 620 V bus. Their life halves for every 10 °C hotter.', { dry: 'Dried out – low-frequency ripple: 100 Hz flicker on camera, and the PFC MOSFET is stressed.', short: 'Shorted – blows F1.' }, { v: 1, look: { dry: 'Tops bulging, brown residue' }, ok: '0.2 Ω ESR, 215 µF' }),
    P('U3', 'ic', 720, 345, 'U3 – auxiliary supply', 'Makes 12 V and 3.3 V for the micro-controller, the CCR drivers and the DMX interface.', { dead: 'Dead – the bus is there but nothing works; signal LED off.' }, { w: 90, l: 'AUX 12V', ok: '—' }),
    ...[1, 2, 3].map((n) => P('CCR' + n, 'ccr', 760 + n * 100, 175, `CCR${n} – constant current regulator, channel ${n}`, `Buck converter from the 620 V bus to the LED module (260–350 V, 700–1700 mA, max 566 W). Its MOSFET, inductor, diode and current sense sit inside.`, { dead: `Module not working – channel ${n} dark, signal LED 1 pulse.`, short: `Buck MOSFET shorted – the full 620 V bus hits LED module ${n}: it flashes bright and is destroyed.` }, { ok: '—' })),
    P('U5', 'ic', 860, 345, 'U5 – main micro-controller', 'DMX-RDM, current setting, thermal management, protections, signal LED, firmware.', { dead: 'Dead – all outputs off, signal LED off.' }, { w: 100, l: 'MCU', ok: '—' }),
    P('U6', 'ic', 560, 465, 'U6 – isolated RS-485 (DMX) interface', 'Reinforced insulation between the DMX line and the mains-referenced electronics.', { dead: 'Dead – no DMX: the driver runs at its default level and does not answer RDM.' }, { w: 120, l: 'RS-485 ISO', ok: '—' }),
    P('DMX', 'xlr', 420, 465, 'DMX terminals A, B, S (in and re-launch)', 'Daisy-chained DMX-RDM. Terminate the last driver with 120 Ω.', { swap: 'A and B swapped – data inverted: no DMX control (default level).' }, { l: 'DMX', ok: 'continuity OK' }),
    ...[1, 2, 3].map((n) => P('LED' + n, 'mod', 760 + n * 100, 470, `LED module ${n} and its cable (on the mast head)`, 'Up to 200 m from the driver; total drop under 3 V. The outputs are NOT isolated from the mains – a cable fault to earth is an earth fault.', { short: 'Cable / module short – the channel shuts down and restarts every 5 s (signal LED 2 pulses).', open: 'Open circuit (cable cut, connector) – output rises to 400 V, shuts down, restarts every 5 s (3 pulses).', earth: 'Insulation fault to earth (water in the junction box) – the RCD trips about 1 s after switch-on when the outputs start.', ...(n === 1 ? { ntc: 'Module NTC shorted – the driver reads "very hot" and derates ALL channels (4 pulses).' } : {}) }, { look: { earth: 'Water and green corrosion in the junction box', open: 'Connector burnt open' }, ok: '—' })),
  ];

  // ---------------------------------------------------------------- what the driver does
  function evalHP(F, c) {
    const f = (id, m) => F[id] === m;
    const R = { ch: [0, 1, 2].map(() => ({ lvl: 0, st: 'off', I: 0, V: 0 })), code: 0, tp: {}, notes: [], leak: 0, rcd: false, mcb: false, bus: 0, pin: 0, pf: 0, tc: c.amb, ntcT: c.amb, ledOn: false };
    const earth = f('GDT', 'short') || f('CY', 'short') || [1, 2, 3].some((n) => f('LED' + n, 'earth'));
    R.leak = c.nd * (1.5 + 0.016 * c.len * 3) + (earth ? 400 : 0);
    if (!c.on) { R.tp = { TP1: '0 V', TP2: '0 V', TP3: '0 V', TP4: '0 V' }; return R; }
    if (c.cold && (f('K1', 'weld') || c.nd > maxDrivers(c.vin, c.mcb))) { R.mcb = true; R.notes.push(f('K1', 'weld') ? `Cold switch-on: no inrush limiting (K1 welded) – about 300 A peak: the ${c.mcb} trips instantly.` : `Cold switch-on: ${c.nd} drivers × ${c.vin === 400 ? 68 : 40} A inrush – the datasheet allows ${maxDrivers(c.vin, c.mcb)} on a ${c.mcb} at ${c.vin} V: it trips instantly.`); R.tp = { TP1: '0 V (breaker tripped)', TP2: '0 V', TP3: '0 V', TP4: '0 V' }; return R; }
    if (R.leak > c.rcd * 0.75) { R.rcd = true; R.notes.push(earth ? (f('GDT', 'short') || f('CY', 'short') ? 'Earth fault inside the driver – the RCD trips instantly.' : 'Earth fault on an LED cable – the RCD trips about 1 s after switch-on, when the outputs start.') : `Normal leakage ${r1(R.leak)} mA (${c.nd} drivers, ${c.len} m of output cable each) is too close to the ${c.rcd} mA RCD – it trips (worse when damp).`); R.tp = { TP1: '0 V (RCD tripped)', TP2: '0 V', TP3: '0 V', TP4: '0 V' }; return R; }
    const blow = ['MOV1', 'BR1', 'Q1', 'CB1'].some((i) => f(i, 'short'));
    const fuse = !f('F1', 'open') && !blow, inOk = fuse && !f('LCM', 'open') && !f('NTCR', 'open') && !f('BR1', 'open');
    const vpk = Math.round(c.vin * 1.414);
    R.bus = inOk ? (f('L1', 'open') || f('D1', 'open') ? 0 : f('Q1', 'open') || f('U1', 'dead') ? vpk : 620) : 0;
    R.tp.TP1 = `${c.vin} V AC`; R.tp.TP2 = fuse ? `${c.vin} V AC` : '0 V – F1 open'; R.tp.TP3 = R.bus ? `${R.bus} V DC${f('CB1', 'dry') ? ' – 60 V of 100 Hz ripple' : ''}` : '0 V';
    if (blow) R.notes.push('A shorted primary part has blown F1' + (c.mcb.startsWith('B') ? ' and tripped the breaker' : ''));
    if (f('K1', 'stuck')) { R.ntcT = 185; R.notes.push('K1 never closes: the inrush NTC carries the full current at 185 °C – it will burn open soon (works now, dead later)'); }
    const aux = R.bus > 0 && !f('U3', 'dead'), mcu = aux && !f('U5', 'dead');
    R.tp.TP4 = aux ? '12.1 V / 3.3 V' : '0 V';
    R.ledOn = mcu;
    if (!mcu) return R;
    const dmxOk = c.dmx && !f('U6', 'dead') && !f('DMX', 'swap');
    R.tp.TPD = !c.dmx ? 'no DMX connected' : dmxOk ? 'DMX OK, 33 fps, RDM answering' : f('DMX', 'swap') ? 'framing errors – data inverted' : 'DMX at the terminals, nothing from the interface';
    if (!dmxOk) R.notes.push('No DMX – running at the default level (100 %)');
    const iset = c.iset / 1000, drop = 2 * c.len * 0.00741 * iset, vfe = c.vf + drop;
    if (drop > 3) R.notes.push(`Output cable drop ${r1(drop)} V per channel – more than the 3 V the datasheet allows`);
    const lv = [0, 1, 2].map((i) => (dmxOk ? c.lv[i] : 1));
    let k = 1;
    const pTot = lv.reduce((s, l) => s + l * iset * c.vf, 0), allow = allowedW(c.amb);
    if (pTot > allow) { k = Math.max(0.2, allow / pTot); R.code = 4; R.notes.push(`Internal over-temperature: ${Math.round(pTot)} W at ${c.amb} °C (allowed ${Math.round(allow)} W) – current gradually reduced to ${Math.round(k * 100)} %`); }
    if (f('LED1', 'ntc')) { k = 0.2; R.code = 4; R.notes.push('Module NTC reads very hot – ALL channels derated to 20 %'); }
    if (iset * c.vf > 580) { k = Math.min(k, 580 / (iset * c.vf)); R.notes.push('Over-power per channel (> 580 W) – current reduced'); }
    const nobuck = R.bus > 0 && R.bus < vfe + 20;
    let pout = 0;
    [0, 1, 2].forEach((i) => {
      const n = i + 1, ch = R.ch[i];
      if (f('CCR' + n, 'dead')) { R.code = 1; return; }
      if (f('CCR' + n, 'short')) { R.code = Math.min(R.code || 9, 3); R.notes.push(`Channel ${n}: LED module destroyed by the full bus voltage`); ch.st = 'dead'; return; }
      if (f('LED' + n, 'short')) { ch.st = 'blink'; ch.lvl = 0.15; ch.V = 0; if (R.code !== 1) R.code = 2; return; }
      if (f('LED' + n, 'open')) { ch.st = 'off'; ch.V = 400; if (R.code !== 1 && R.code !== 2) R.code = 3; return; }
      if (vfe > 350) { ch.st = 'dim'; ch.lvl = 0.05; ch.V = 350; ch.I = 0.05 * iset; R.notes.push(`Channel ${n}: LED string ${Math.round(vfe)} V is above the 350 V maximum – the driver cannot push the current`); return; }
      if (nobuck) { ch.st = 'flicker'; ch.lvl = 0.35; ch.V = R.bus - 15; ch.I = 0.35 * iset; return; }
      ch.lvl = lv[i] * k; ch.I = iset * ch.lvl; ch.V = c.vf + drop * ch.lvl; ch.st = ch.lvl < 0.01 ? 'off' : f('CB1', 'dry') ? 'flicker' : 'on'; pout += ch.I * ch.V;
    });
    if (nobuck) R.notes.push(`DC bus only ${R.bus} V (PFC not boosting) – lower than the LED string: the regulators cannot work – dim and flickering`);
    if (R.bus === vpk && !nobuck) R.notes.push('PFC not boosting – works on 400 V but power factor about 0.6 and high THD');
    R.pf = R.bus === 620 ? 0.99 : 0.6; R.pin = pout / 0.955; R.iin = R.pin / (c.vin * R.pf); R.tc = Math.round(c.amb + 31 * (R.pin / 1460));
    [0, 1, 2].forEach((i) => { R.tp['TPO' + (i + 1)] = `${Math.round(R.ch[i].V)} V · ${Math.round(R.ch[i].I * 1000)} mA${R.ch[i].st === 'blink' || (R.ch[i].st === 'off' && R.ch[i].V === 400) ? ' – shuts down, restarts every 5 s' : ''}`; });
    R.tp.TPN = f('LED1', 'ntc') ? 'module NTC: 135 °C (shorted sensor)' : `module NTC: ${Math.round(c.amb + 35)} °C`;
    if (R.tc > 79) R.notes.push(`Case temperature ${R.tc} °C – above the 79 °C Tc limit: short life`);
    return R;
  }

  // ---------------------------------------------------------------- the trip-and-reset case: five real causes
  const TRIP = {
    surge: { name: 'Lightning surge: varistor failed short, input fuse blown', story: '18:30 the mast came on – all three channels perfect. 02:10 a thunderstorm passed over the port; the mast went dark and breaker Q3 (C16) had tripped. 07:30 Q3 was reset: it stays in, but the driver does not light – signal LED dark.', dev: 'MCB Q3', reset: 'Q3 stays in. Supply at the driver terminals 400 V – but no light and the signal LED is dark.', F: { F1: 'open', MOV1: 'short' }, fix: 'Replace the driver (or have it repaired: MOV1 + F1), fit / replace the Type 2 SPD in the mast DB, check the mast earthing and bonding.' },
    thermal: { name: 'Overheating: run above the derating curve – PFC MOSFET failed, fuse blown', story: 'The mast is used for evening events at full power. Ambient at the mast head reaches 50 °C in the afternoon sun. Last night at 21:40 the mast went dark and Q3 had tripped. Reset: Q3 stays in, driver dead.', dev: 'MCB Q3', reset: 'Q3 stays in. 400 V at the driver terminals – no light, signal LED dark.', F: { F1: 'open', Q1: 'short', CB1: 'dry' }, set: { amb: 50, iset: 1700 }, fix: 'Replace the driver. Then: set the current so the total power stays under the derating curve (≤ 1306 W at 50 °C, e.g. 1400 mA), mount it as the installation notice says (clearance, shade), check Tc ≤ 79 °C.' },
    earth: { name: 'Earth fault on an LED output cable (water in the junction box)', story: 'Heavy rain from 23:00. At 23:20 the RCD on the mast circuit tripped. Reset in the morning: the RCD trips again about one second later, every time.', dev: 'RCD (300 mA)', reset: 'RCD trips again about 1 s after the reset – just when the driver starts its outputs (turn-on 0.7 s).', F: { LED2: 'earth' }, fix: 'Dry out / replace the junction box and gland on channel 2, repair the cable, IP66 glands, re-test insulation – then reconnect.' },
    inrush: { name: 'Too many drivers on one breaker – inrush on simultaneous restart', story: 'The mast ran fine all evening. 01:30 the utility supply was interrupted for 15 minutes. When it came back, breaker Q3 tripped. Every reset trips it again instantly.', dev: 'MCB Q3', reset: 'Q3 trips INSTANTLY at every reset (magnetic trip, no delay).', F: {}, set: { nd: 3, mcb: 'C16', vin: 400 }, fix: 'Datasheet: at 400 V a C16 takes ONE driver (68 A inrush). Split the drivers onto separate breakers, or C25 (3 drivers) if the cable allows, or D-curve, or an inrush limiter / staggered switch-on. Hot restrike after a short dip is fine – a cold restart of all drivers together is not.' },
    leak: { name: 'Cumulative earth leakage on a 30 mA RCD', story: 'After months of trouble-free running, the 30 mA RCD tripped at 04:00 on a damp night. Reset: it trips again about one second later.', dev: 'RCD (30 mA)', reset: 'RCD trips again about 1 s after the reset, when the outputs start.', F: {}, set: { rcd: 30, nd: 3, len: 200 }, fix: 'The outputs are not isolated: each driver with 3 × 200 m of output cable leaks about 11–12 mA in normal service – three drivers (34 mA) cannot share a 30 mA RCD, which may trip from 15 mA. Use a 300 mA time-delayed (S) RCD for the mast feeder, or one RCD per driver as the design allows.' },
  };
  const TRIPKEYS = Object.keys(TRIP);
  const WHY = {
    board: 'Start at the board: WHICH device tripped tells you the kind of fault – an MCB is over-current (short or inrush), an RCD is current to earth.',
    reset: 'Reset once and WATCH: instant trip = short or inrush; trip after about 1 s = something when the driver starts its outputs; holds but dark = the driver itself has died.',
    vin: 'Supply at the driver terminals: if it is there and the driver is dark, the fault is inside the driver.',
    led: 'The signal LED is dark – the driver electronics have no supply at all: the input fuse is the prime suspect.',
    wx: 'What happened at the moment of the trip? Storm, heat, rain or a supply interruption each point to a different cause.',
    spd: 'After a storm, check the surge protective device – a red window means it has done its job and is used up.',
    rdm: 'The driver logs its own history: settings, maximum temperature, derating and surge events.',
    one: 'Switch the drivers on one at a time – if each works alone but not together, the problem is the sum of them (inrush or leakage).',
    disc: 'Disconnect the outputs one at a time: the trip disappears when the faulty cable is off.',
    leak: 'Measure the earth leakage of each driver while it runs – the outputs are not isolated, so long cables leak.',
    table: 'Compare with the datasheet table of drivers per breaker – inrush, not overload, trips the breaker at switch-on.',
    iso: 'Before any dead test: isolate, lock off, prove dead, and wait for the 620 V bus capacitors to discharge.',
    ir: 'Insulation-test each LED cable with the driver DISCONNECTED (the outputs are not isolated from the mains).',
    open: 'Open the driver: the input fuse, the varistor, the PFC MOSFET and the bulk capacitors tell the story.',
  };
  const SHOW = { surge: ['board', 'reset', 'vin', 'led', 'wx', 'spd', 'iso', 'open'], thermal: ['board', 'reset', 'vin', 'led', 'wx', 'rdm', 'iso', 'open'], earth: ['board', 'reset', 'wx', 'disc', 'iso', 'ir'], inrush: ['board', 'reset', 'wx', 'table', 'one'], leak: ['board', 'reset', 'wx', 'one', 'leak', 'iso', 'ir'] };

  function bench(el, opt, done) {
    let mode = opt.trip ? 'trip' : 'explore', F = {}, sel = null, round = 0, score = 0, hidden = null, tries = 0, hintN = 0, log = [], stopped = false, trip = null, tripState = null, tested = new Set();
    const base = () => ({ on: true, cold: false, vin: 400, iset: 1400, vf: 333, amb: 30, len: 120, dmx: true, lv: [1, 1, 1], nd: 1, mcb: 'C16', rcd: 300 });
    let c = base();
    onStop(() => (stopped = true));
    el.innerHTML = `${opt.trip ? '' : '<div class="row" style="margin-bottom:8px"><span class="btn s on" data-m="explore">Explore – break parts, change settings</span><span class="btn s" data-m="challenge">Challenge – find the hidden fault (3 rounds)</span></div>'}<div id="hpTop"></div><div class="panel scroll" style="margin-top:8px"><svg id="hpSch" viewBox="0 0 1180 540" style="min-width:900px;color:#334155"></svg></div><div class="two" style="margin-top:10px"><div><div id="hpPart" class="card" style="padding:12px"></div><div id="hpDiag" style="margin-top:10px"></div></div><div><div class="sec">Test points and measurements</div><div id="hpTP" class="chips"></div><div class="meter" id="hpMeter"><div class="mm">— — —</div><div class="ms">Pick a test</div></div><div class="sec">Log</div><div id="hpLog" class="note"></div></div></div>`;
    el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); round = 0; score = 0; c = base(); F = {}; if (mode === 'challenge') newRound(); draw(); }));
    const meter = (a, b) => { $('hpMeter').innerHTML = `<div class="mm ${/⚠|OL –|trips|0 V|dark/i.test(a) ? 'warn' : ''}">${esc(a)}</div><div class="ms">${esc(b)}</div>`; log.unshift(`${b}: ${a}`); $('hpLog').innerHTML = log.slice(0, 12).map(esc).join('<br>'); };
    const CAND = PARTS.flatMap((p) => Object.keys(p.modes).map((m) => [p.id, m])).filter(([i, m]) => !(i === 'K1' && m === 'stuck'));
    function newRound() { c = base(); F = {}; hidden = CAND[Math.floor(Math.random() * CAND.length)]; F[hidden[0]] = hidden[1]; if (hidden[0] === 'K1') c.cold = true; tries = 0; hintN = 0; log = []; sel = null; }
    function newTrip() { const used = tripState ? tripState.used : []; const pool = TRIPKEYS.filter((k) => !used.includes(k)); trip = pool[Math.floor(Math.random() * pool.length)]; tripState = { used: [...used, trip], iso: false, open: false, choice: null, result: null, unsafe: 0, phase: 0, shown: false }; c = { ...base(), ...(TRIP[trip].set || {}) }; F = { ...TRIP[trip].F }; tested = new Set(); log = []; sel = null; }
    if (mode === 'trip') { newTrip(); setTimeout(() => !stopped && replay(), 300); }
    function replay() { const st = tripState; st.phase = 1; draw(); setTimeout(() => { if (stopped || tripState !== st) return; st.phase = 2; draw(); setTimeout(() => { if (stopped || tripState !== st) return; st.phase = 0; draw(); }, 1600); }, 2600); }
    function showMe() { const st = tripState, steps = SHOW[trip]; st.shown = true; let i = 0; const next = () => { if (stopped || tripState !== st || i >= steps.length) { if (tripState === st && !stopped) { st.say = `<b>Conclusion:</b> ${esc(TRIP[trip].name)}. <b>Fix:</b> ${esc(TRIP[trip].fix)}`; draw(); } return; } const k = steps[i++]; tested.add(k); tripTest(k); st.say = `<b>Step ${i} of ${steps.length}:</b> ${esc(WHY[k])}`; draw(); setTimeout(next, 2600); }; next(); }

    function draw() {
      if (stopped) return;
      const R = evalHP(F, mode === 'trip' ? { ...c, on: false } : c);
      const CH = mode === 'trip' ? [0, 1, 2].map(() => (tripState.phase === 1 ? { lvl: 1, st: 'on' } : { lvl: 0, st: 'dark' })) : R.ch;
      const beam = (i) => { const ch = CH[i], g = Math.max(0, Math.min(1, ch.lvl)); return `<path d="M${40 + i * 110} 40 L${110 + i * 110} 40 L${130 + i * 110} 130 L${20 + i * 110} 130 Z" fill="#fff7d6" opacity="${0.04 + 0.7 * g}" ${ch.st === 'blink' ? 'class="hic"' : ch.st === 'flicker' ? 'class="blink"' : ''}/><rect x="${40 + i * 110}" y="30" width="70" height="10" rx="3" fill="${g > 0.02 ? '#fde68a' : '#1f2937'}"/>${txt(75 + i * 110, 146, `CH${i + 1} ${ch.st === 'on' ? Math.round(g * 100) + ' %' : ch.st}`, 10, '#cbd5e1', 'middle', 700)}`; };
      const pulses = R.code ? `${R.code} pulse${R.code > 1 ? 's' : ''} every 4 s – ${CODE[R.code]}` : R.ledOn ? 'steady – no fault' : 'dark';
      let top = '';
      if (mode === 'trip') {
        const T = TRIP[trip];
        top = `<div class="ticket"><b>Port high mast HM-11 – case ${tripState.used.length} of 3</b> · score ${score}<div style="margin-top:4px">${esc(T.story)}</div><div class="note">Driver: 1700 W, 3 channels, DMX-RDM, supplied L1–L2 400 V. Investigate the breaker, the driver and the cables. Safe isolation before any dead test or opening the driver.</div><div class="row" style="margin-top:8px"><span class="btn s" id="hpReplay">▶ Replay the night</span><span class="btn s" id="hpShow">🎓 Show me how to solve it${tripState.shown ? ' (this case will not count)' : ''}</span></div><div id="hpSay" class="say" style="margin-top:8px${tripState.shown ? '' : ';display:none'}">${tripState.say || ''}</div></div>`;
      } else if (mode === 'challenge') top = `<div class="ticket"><b>Challenge – round ${round + 1} of 3</b> · score ${score}<div>A high-mast driver has a problem. Watch the three channels and the signal LED, measure, then switch off and test parts. Replace / repair what has failed (3 tries).</div></div>`;
      else top = `<div class="say">1700 W, 3 independent constant-current channels (260–350 V, 700–1700 mA), DMX-RDM, 220–400 V AC, IP66 – the type used on high masts and stadiums. Tap any part to read it and make it fail; change the supply, current, ambient and cable length.</div>`;
      const ctl = mode === 'trip' ? '' : `<div class="row" style="margin-top:8px"><span class="btn s ${c.on ? 'on' : ''}" id="hpOn">${c.on ? '✓ Supply ON' : 'Supply OFF'}</span><span class="btn s" id="hpCold">Switch off and on again (cold start)</span><label class="inl">Supply <select id="hpVin"><option ${c.vin === 230 ? 'selected' : ''}>230</option><option ${c.vin === 400 ? 'selected' : ''}>400</option></select> V</label><label class="inl">Current <select id="hpI">${[700, 1400, 1500, 1600, 1700].map((v) => `<option ${c.iset === v ? 'selected' : ''}>${v}</option>`).join('')}</select> mA</label><label class="inl">LED string <select id="hpVf">${[300, 333, 380].map((v) => `<option ${c.vf === v ? 'selected' : ''}>${v}</option>`).join('')}</select> V</label><label class="inl">Ambient <input type="range" id="hpAmb" min="20" max="55" step="1" value="${c.amb}" style="width:80px"> ${c.amb} °C</label><label class="inl">Cable <input type="range" id="hpLen" min="20" max="300" step="10" value="${c.len}" style="width:80px"> ${c.len} m</label><label class="inl"><input type="checkbox" id="hpDmx" ${c.dmx ? 'checked' : ''}> DMX connected</label>${[0, 1, 2].map((i) => `<label class="inl">CH${i + 1} <input type="range" data-lv="${i}" min="0" max="1" step="0.05" value="${c.lv[i]}" style="width:60px"></label>`).join('')}<label class="inl">Breaker <select id="hpMcb">${MCBS.map((v) => `<option ${c.mcb === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="inl">Drivers on it <select id="hpNd">${[1, 2, 3].map((v) => `<option ${c.nd === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label class="inl">RCD <select id="hpRcd">${[30, 100, 300].map((v) => `<option ${c.rcd === v ? 'selected' : ''}>${v}</option>`).join('')}</select> mA</label>${mode === 'explore' ? '<span class="btn s" id="hpFix">Repair everything</span>' : ''}</div>`;
      const shown = mode === 'trip' ? tripView() : R;
      $('hpTop').innerHTML = `<div class="two"><div>${top}${ctl}${mode !== 'trip' && R.notes.length ? `<div class="note" style="margin-top:6px">${R.notes.map(esc).join(' · ')}</div>` : ''}${mode !== 'trip' && (R.mcb || R.rcd) ? `<div class="watch" style="margin-top:6px"><b>${R.mcb ? 'Breaker tripped' : 'RCD tripped'}</b></div>` : ''}</div><div style="background:#0b1220;border-radius:12px"><svg viewBox="0 0 360 200" style="display:block;width:100%">${[0, 1, 2].map(beam).join('')}<circle cx="30" cy="178" r="7" fill="${shown.ledOn || (mode === 'trip' && tripState.phase === 1) ? '#22c55e' : '#1f2937'}" ${R.code && mode !== 'trip' ? 'class="blink"' : ''}/>${txt(44, 182, `Signal LED: ${mode === 'trip' ? (tripState.phase === 1 ? 'steady – no fault' : shown.led) : pulses}`, 10, '#e2e8f0', 'start')}${mode === 'trip' && tripState.phase ? txt(350, 20, tripState.phase === 1 ? 'Last night – running perfectly' : `${TRIP[trip].dev} TRIPS`, 12, tripState.phase === 1 ? '#86efac' : '#fca5a5', 'end', 700) : ''}</svg></div></div><style>@keyframes hic{0%,80%{opacity:.05}85%,95%{opacity:1}100%{opacity:.05}}.hic{animation:hic 5s infinite}</style>`;
      bindCtl();
      if ($('hpReplay')) { $('hpReplay').onclick = replay; $('hpShow').onclick = () => { if (!tripState.shown) showMe(); }; }
      drawSch(R); drawPart(R); drawTests(R); drawDiag();
    }
    function bindCtl() {
      const on = (id, ev, fn) => { const n = $(id); if (n) n[ev] = fn; };
      on('hpOn', 'onclick', () => { c.on = !c.on; c.cold = c.on; draw(); });
      on('hpCold', 'onclick', () => { c.on = true; c.cold = true; draw(); meter(evalHP(F, c).mcb ? 'Breaker tripped at switch-on' : 'Started normally', 'Cold start'); });
      on('hpVin', 'onchange', (e) => { c.vin = +e.target.value; draw(); });
      on('hpI', 'onchange', (e) => { c.iset = +e.target.value; draw(); });
      on('hpVf', 'onchange', (e) => { c.vf = +e.target.value; draw(); });
      on('hpAmb', 'onchange', (e) => { c.amb = +e.target.value; draw(); });
      on('hpLen', 'onchange', (e) => { c.len = +e.target.value; draw(); });
      on('hpDmx', 'onchange', (e) => { c.dmx = e.target.checked; draw(); });
      on('hpMcb', 'onchange', (e) => { c.mcb = e.target.value; draw(); });
      on('hpNd', 'onchange', (e) => { c.nd = +e.target.value; draw(); });
      on('hpRcd', 'onchange', (e) => { c.rcd = +e.target.value; draw(); });
      on('hpFix', 'onclick', () => { F = {}; c.cold = false; draw(); });
      el.querySelectorAll('[data-lv]').forEach((s) => (s.onchange = () => { c.lv[+s.dataset.lv] = +s.value; draw(); }));
    }
    function drawSch(R) {
      const live = (x) => (x ? '#a16207' : '#cbd5e1');
      let s = '';
      s += ln([[30, 90], [370, 90]], live(R.bus || R.tp.TP2 !== '0 V')) + ln([[30, 270], [440, 270]]) + ln([[30, 300], [300, 300]], '#16a34a', 2, true) + txt(22, 94, 'L1', 11, '#a16207', 'end', 700) + txt(22, 274, 'L2', 11, '#334155', 'end', 700) + txt(22, 304, 'PE', 11, '#16a34a', 'end', 700);
      s += ln([[140, 90], [140, 164]]) + ln([[140, 196], [140, 270]]) + ln([[190, 270], [190, 269]]) + ln([[230, 90], [230, 176]]) + ln([[230, 184], [230, 270]]) + ln([[245, 270], [245, 281]]) + ln([[245, 289], [245, 300]], '#16a34a') + ln([[190, 270], [190, 300]], '#16a34a', 1.2);
      s += SYM.cap(230, 180) + ln([[410, 90], [470, 90], [470, 150]]) + ln([[470, 210], [470, 270]]) + ln([[370, 50], [370, 90]]) + ln([[410, 50], [410, 90]]);
      s += ln([[500, 180], [515, 180], [515, 90], [523, 90]], '#a16207') + ln([[567, 90], [632, 90]], '#a16207') + ln([[600, 90], [600, 162]]) + ln([[600, 198], [600, 300]]) + ln([[668, 90], [1150, 90]], R.bus ? '#dc2626' : '#cbd5e1', 2.4) + txt(1150, 84, `DC bus ${R.bus} V`, 10, '#dc2626', 'end', 700) + ln([[440, 180], [430, 180], [430, 300], [1150, 300]]);
      s += ln([[705, 90], [705, 176]]) + ln([[705, 186], [705, 300]]) + ln([[590, 327], [590, 230], [600, 230]], '#7c3aed', 1.2, true) + ln([[720, 300], [720, 327]]) + ln([[765, 345], [810, 345]], '#7c3aed', 1.2, true);
      [1, 2, 3].forEach((n) => { const x = 760 + n * 100, ch = R.ch[n - 1]; s += ln([[x, 90], [x, 125]]) + ln([[x, 225], [x, 300]]) + ln([[x + 20, 225], [x + 20, 250], [x + 20, 440]], ch.st === 'on' || ch.st === 'flicker' ? '#16a34a' : '#94a3b8', 2) + ln([[x - 20, 225], [x - 20, 250], [x - 20, 440]], '#94a3b8', 2) + txt(x + 24, 410, `LED${n}+`, 8, '#16a34a', 'start') + ln([[860, 327], [860, 250], [x, 250]], '#7c3aed', 1, true); });
      s += `<line x1="770" y1="40" x2="770" y2="520" stroke="#94a3b8" stroke-dasharray="2 6"/>` + txt(775, 40, 'outputs NOT isolated from mains', 9, '#dc2626', 'start');
      s += `<line x1="490" y1="420" x2="490" y2="520" stroke="#dc2626" stroke-dasharray="6 5"/>` + txt(490, 414, 'reinforced insulation', 9, '#dc2626') + ln([[442, 465], [500, 465]], '#7c3aed') + ln([[620, 465], [800, 465], [800, 363], [810, 345]], '#7c3aed', 1.2, true) + ln([[860, 440], [860, 363]], '#7c3aed', 1, true) + txt(880, 432, 'NTC', 8, '#7c3aed', 'start');
      s += `<circle cx="960" cy="345" r="6" fill="${R.ledOn ? '#22c55e' : '#1f2937'}" stroke="#334155"/>` + txt(970, 349, 'signal LED', 9, '#334155', 'start');
      PARTS.forEach((p) => {
        const bad = mode === 'explore' && F[p.id], isSel = sel === p.id, col = bad ? '#dc2626' : isSel ? '#244286' : '#334155';
        let g = '';
        if (p.sym === 'cmc') g = SYM.cmc(p.x, 90, 270);
        else if (p.sym === 'ic') g = SYM.ic(p.x, p.y, p.w || 80, p.h || 36, p.l || p.id);
        else if (p.sym === 'xlr') g = SYM.xlr(p.x, p.y, p.l);
        else if (p.sym === 'ccr') g = `<rect x="${p.x - 40}" y="125" width="80" height="100" rx="6" fill="#f8fafc" stroke="currentColor" stroke-width="1.6"/>${SYM.fet(p.x - 8, 160)}${SYM.ind(p.x + 8, 205).replace('M' + (p.x + 8 - 18), 'M' + (p.x - 10))}${txt(p.x, 142, p.id, 10, 'currentColor', 'middle', 700)}`;
        else if (p.sym === 'mod') g = `<rect x="${p.x - 34}" y="${p.y - 22}" width="68" height="44" rx="6" fill="${R.ch[+p.id.slice(3) - 1].lvl > 0.02 ? '#fef3c7' : '#e2e8f0'}" stroke="currentColor" stroke-width="1.6"/>${[0, 1, 2, 3].map((k) => SYM.led1(p.x - 22 + k * 14, p.y - 2)).join('')}`;
        else g = SYM[p.sym](p.x, p.y, p.v);
        const bb = p.sym === 'cmc' ? [p.x - 22, 80, 44, 200] : p.sym === 'ccr' ? [p.x - 44, 120, 88, 110] : p.sym === 'mod' ? [p.x - 38, p.y - 26, 76, 52] : p.sym === 'ic' ? [p.x - (p.w || 80) / 2 - 4, p.y - 22, (p.w || 80) + 8, 44] : [p.x - 22, p.y - 22, 44, 44];
        const ly = p.sym === 'ic' ? p.y + 30 : p.sym === 'cmc' ? 290 : p.sym === 'ccr' ? 240 : p.sym === 'mod' ? p.y + 36 : p.sym === 'xlr' ? p.y - 18 : p.y + (p.v ? 4 : 22);
        s += `<g style="color:${col}">${g}</g>${p.sym === 'ccr' ? '' : txt(p.sym === 'ic' || p.sym === 'mod' ? p.x : p.x + (p.v ? 22 : 0), ly, p.id, 9, col, p.v ? 'start' : 'middle', 700)}<rect x="${bb[0]}" y="${bb[1]}" width="${bb[2]}" height="${bb[3]}" fill="${isSel ? 'rgba(36,66,134,.08)' : 'transparent'}" stroke="${isSel ? '#244286' : 'none'}" rx="6" data-p="${p.id}" style="cursor:pointer"><title>${esc(p.name)}</title></rect>`;
      });
      $('hpSch').innerHTML = s;
      $('hpSch').querySelectorAll('[data-p]').forEach((n) => (n.onclick = () => { sel = n.dataset.p; draw(); }));
    }
    function drawPart() {
      const box = $('hpPart');
      if (!sel) { box.innerHTML = `<p class="m" style="margin:0">${mode === 'trip' ? 'Tap a part of the driver to read what it does. Use the tests on the right to investigate the trip.' : 'Tap any part on the circuit.'}</p>`; return; }
      const p = PARTS.find((x) => x.id === sel), f = F[p.id];
      if (mode === 'explore') {
        box.innerHTML = `<b>${esc(p.name)}</b><p style="margin:4px 0">${esc(p.role)}</p><div class="chips">${Object.keys(p.modes).map((m) => `<span class="btn s ${f === m ? 'red' : ''}" data-fail="${m}">${f === m ? '✓ ' : ''}Fail: ${({ open: 'open', short: 'short', dry: 'dried out', dead: 'dead', weld: 'welded', stuck: 'never closes', swap: 'A/B swapped', earth: 'earth fault', ntc: 'NTC shorted' })[m] || m}</span>`).join('')}${f ? '<span class="btn s" data-fail="">Repair</span>' : ''}</div><div class="note">${Object.entries(p.modes).map(([m, d]) => `<b>${m}:</b> ${esc(d)}`).join('<br>')}</div>`;
        box.querySelectorAll('[data-fail]').forEach((b) => (b.onclick = () => { if (b.dataset.fail) F[p.id] = b.dataset.fail; else delete F[p.id]; if (p.id === 'K1' && F.K1 === 'weld') c.cold = true; draw(); }));
      } else if (mode === 'challenge') {
        const load = p.id.startsWith('LED');
        box.innerHTML = `<b>${esc(p.name)}</b><p style="margin:4px 0">${esc(p.role)}</p><div class="chips"><span class="btn s" data-t="look">Look</span>${load ? '<span class="btn s" data-t="ir">Insulation test of the cable (driver disconnected)</span>' : '<span class="btn s" data-t="ohm">Resistance / diode test (supply off)</span>'}${p.sym === 'ecap' ? '<span class="btn s" data-t="esr">ESR (supply off)</span>' : ''}<span class="btn s p" data-t="rep">${load ? 'Repair this module / cable' : 'Replace this part'} (${3 - tries} tries left)</span></div><div class="row" style="margin-top:8px"><span class="btn s" id="hpHint">💡 Hint</span><span class="note" id="hpHintT"></span></div>`;
        box.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => ctest(p, b.dataset.t)));
        $('hpHint').onclick = () => { hintN++; const h = PARTS.find((x) => x.id === hidden[0]); $('hpHintT').textContent = hintN === 1 ? 'Start with the signal LED and the breaker/RCD, then TP2 (after F1), TP3 (bus), TP4 (aux) and the channel outputs.' : `Look at: ${h.name}.`; };
      } else box.innerHTML = `<b>${esc(p.name)}</b><p style="margin:4px 0">${esc(p.role)}</p>`;
    }
    function ctest(p, k) {
      const f = F[p.id] || (p.id === 'F1' && ['MOV1', 'BR1', 'Q1', 'CB1'].some((i) => F[i] === 'short') ? 'open' : null);
      if (k === 'look') return meter((p.look && f && p.look[f]) || 'Looks normal', `Look · ${p.id}`);
      if (k === 'ohm' || k === 'esr') { if (c.on) return meter('⚠ Switch the supply OFF, isolate and wait for the bus capacitors to discharge (620 V!)', `${p.id}`); return meter(k === 'esr' ? (f === 'dry' ? 'ESR 4.8 Ω · 38 % of rated µF – dried out' : f === 'short' ? 'Short' : p.ok) : f === 'short' ? '0.2 Ω – short circuit' : f === 'open' ? 'OL – open circuit' : f === 'weld' ? 'K1 contacts 0 Ω with the coil off – welded' : f === 'stuck' ? 'K1 does not close with 12 V on the coil' : p.ok, `Resistance · ${p.id}`); }
      if (k === 'ir') { if (c.on) return meter('⚠ Isolate first – and disconnect the driver: the outputs are not isolated from the mains', 'Insulation test'); return meter(f === 'earth' ? '0.04 MΩ to PE – insulation fault' : f === 'short' ? 'Core to core 0.3 Ω – short' : f === 'open' ? 'Continuity OL – open circuit' : '> 200 MΩ – OK', `Insulation test · ${p.id} cable`); }
      if (k === 'rep') {
        tries++;
        if (p.id === hidden[0]) { score++; meter(`✓ Correct – ${p.name}: ${p.modes[hidden[1]]}`, 'Repaired'); nextRound(); }
        else if (p.id === 'F1' && ['MOV1', 'BR1', 'Q1', 'CB1'].some((i) => F[i] === 'short')) { meter('✗ The new fuse blew the moment the supply came on – a primary part is still shorted', 'Replaced F1'); if (tries >= 3) out(); else drawPart(); }
        else if (tries >= 3) out(); else { meter(`✗ ${p.id} was fine – the fault is still there`, 'Replaced'); drawPart(); }
      }
    }
    function out() { const h = PARTS.find((x) => x.id === hidden[0]); meter(`✗ Out of tries – it was ${h.name}: ${h.modes[hidden[1]]}`, 'Replaced'); nextRound(); }
    function nextRound() {
      round++;
      if (round >= 3) { $('hpPart').innerHTML = `${kpi([[`${score} / 3`, 'faults found', score < 2]])}<p>${score >= 2 ? 'Passed ✓' : 'Not yet – 2 of 3 passes.'}</p><span class="btn p" id="hpAgain">Play again</span>`; $('hpAgain').onclick = () => { round = 0; score = 0; newRound(); draw(); }; if (done) done(score, 3); return; }
      setTimeout(() => { if (!stopped) { newRound(); draw(); } }, 2200);
    }
    function drawTests(R) {
      const box = $('hpTP');
      if (mode === 'trip') {
        const T = TRIP[trip], st = tripState;
        const TT = [
          ['board', 'Look at the mast DB: what tripped, breaker and RCD ratings, drivers on the circuit'],
          ['reset', 'Reset the tripped device and watch'],
          ['vin', 'Voltage at the driver input terminals after the reset'],
          ['led', 'Driver signal LED after the reset'],
          ['spd', 'Surge protective device (SPD) in the mast DB'],
          ['wx', 'Site log / weather for the night'],
          ['rdm', 'Read the driver over RDM (settings, max temperature, events)'],
          ['one', 'Switch the drivers on one at a time'],
          ['disc', 'Disconnect the LED channels one by one and reset'],
          ['leak', 'Earth leakage clamp on each driver supply (while it runs)'],
          ['table', 'Datasheet: drivers per breaker (inrush table)'],
          ['iso', st.iso ? '🔒 Isolated and locked off (remove)' : 'Isolate and lock off the mast circuit'],
          ['ir', '🔒 Insulation test of each LED cable – driver disconnected'],
          ['irdrv', '🔒 Insulation test with the driver still connected'],
          ['open', '🔒 Open the driver: fuse, varistor, MOSFET, capacitors'],
        ];
        box.innerHTML = TT.map(([k, l]) => `<span class="btn s ${tested.has(k) ? 'on' : ''}" data-tt="${k}">${esc(l)}</span>`).join('');
        box.querySelectorAll('[data-tt]').forEach((b) => (b.onclick = () => { tested.add(b.dataset.tt); tripTest(b.dataset.tt); draw(); }));
        return;
      }
      const keys = ['TP1', 'TP2', 'TP3', 'TP4', 'TPO1', 'TPO2', 'TPO3', 'TPD', 'TPN'];
      const NM = { TP1: 'supply at the terminals', TP2: 'after F1', TP3: 'DC bus', TP4: 'aux 12 V / 3.3 V', TPO1: 'output CH1', TPO2: 'output CH2', TPO3: 'output CH3', TPD: 'DMX', TPN: 'NTC reading' };
      box.innerHTML = keys.map((k) => `<span class="btn s" data-tpb="${k}">${k} · ${NM[k]}</span>`).join('') + '<span class="btn s" data-x="pin">Input power, current, PF</span><span class="btn s" data-x="tc">Case temperature Tc</span><span class="btn s" data-x="leak">Earth leakage</span><span class="btn s" data-x="led">Signal LED</span><span class="btn s" data-x="ntcr">Inrush NTC temperature</span>';
      box.querySelectorAll('[data-tpb]').forEach((b) => (b.onclick = () => meter(R.tp[b.dataset.tpb] ?? (R.mcb || R.rcd ? '0 V – supply tripped' : '—'), `${b.dataset.tpb} ${NM[b.dataset.tpb]}`)));
      box.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => { const k = b.dataset.x; meter(k === 'pin' ? `${Math.round(R.pin)} W · ${r1(R.iin || 0)} A · PF ${R.pf}` : k === 'tc' ? `${R.tc} °C (limit 79 °C)` : k === 'leak' ? `${r1(R.leak)} mA on the circuit (${c.nd} driver${c.nd > 1 ? 's' : ''})` : k === 'led' ? (R.code ? `${R.code} pulses every 4 s – ${CODE[R.code]}` : R.ledOn ? 'steady' : 'dark') : `${R.ntcT} °C`, b.textContent); }));
    }
    function tripView() { return { lit: false, ledOn: false, led: trip === 'earth' || trip === 'leak' || trip === 'inrush' ? 'dark (no supply – trips again)' : 'dark – driver dead' }; }
    function tripTest(k) {
      const T = TRIP[trip], st = tripState, t = trip;
      const dead = ['ir', 'irdrv', 'open'];
      if (dead.includes(k) && !st.iso) { st.unsafe++; return meter('⚠ Not isolated! Isolate, lock off and prove dead first (the bus capacitors hold 620 V).', 'Safety'); }
      const res = {
        board: `${T.dev} has tripped. Circuit: ${c.mcb} breaker, RCD ${c.rcd} mA, ${c.nd} driver${c.nd > 1 ? 's' : ''} on it, supplied L1–L2 ${c.vin} V. Cable 4 mm².`,
        reset: T.reset,
        vin: t === 'surge' || t === 'thermal' ? '400 V AC – the supply is there' : '0 V – it trips again',
        led: t === 'surge' || t === 'thermal' ? 'Dark – the electronics have no supply (F1 open?)' : t === 'inrush' ? 'Never lights – the breaker trips the instant it closes' : 'Lights for a moment, then everything trips',
        spd: t === 'surge' ? 'Type 2 SPD: status window RED – end of life (it took the strike and failed). Surge counter: 3 events last night.' : 'Type 2 SPD: status window green – OK',
        wx: t === 'surge' ? 'Thunderstorm 01:50–02:30, lightning strikes near the port.' : t === 'thermal' ? 'Clear, very hot day – 36 °C shade, mast head in full sun.' : t === 'earth' ? 'Heavy rain 23:00–05:00.' : t === 'leak' ? 'Damp, misty night, humidity 95 %.' : 'Dry. Utility interruption 01:30–01:45 (feeder fault).',
        rdm: t === 'thermal' ? 'No answer (driver dead). Last logged: current setting 1700 mA × 3 channels = 1700 W, max case temperature 94 °C (limit 79), thermal derating active 41 times.' : t === 'surge' ? 'No answer (driver dead). Last logged: surge events, input over-voltage 01:58, 02:09.' : t === 'inrush' ? 'Cannot read – supply trips. (Before: all normal, 1400 mA, case 61 °C.)' : 'Cannot read – supply trips. (Before: all normal.)',
        one: t === 'inrush' ? 'One driver at a time: each starts normally and the breaker holds! All three together: instant trip.' : t === 'leak' ? 'One driver: holds (about 11 mA). Two: holds, just (about 23 mA). Three: RCD trips about 1 s after start.' : t === 'earth' ? 'Driver 1 and 3 alone: fine. Driver 2 (the one with channel 2 cable): RCD trips 1 s after switch-on.' : 'Only one driver on this circuit.',
        disc: t === 'earth' ? 'With LED2 disconnected the RCD holds and channels 1 and 3 light. Reconnect LED2: trips 1 s after start.' : t === 'leak' ? 'Every disconnected channel lowers the leakage a little – with two channels off on each driver the RCD holds.' : t === 'inrush' ? 'No change – it trips instantly at reset, before the outputs even start.' : 'No change – the driver is dead.',
        leak: t === 'leak' ? 'Each driver about 10–11 mA dry, 12 mA damp → 34 mA total on a 30 mA RCD (trips at 15–30 mA).' : t === 'earth' ? 'Cannot measure – the RCD trips within 1 s.' : t === 'inrush' ? 'Cannot measure – trips at reset.' : 'No load – driver dead.',
        table: `Inrush ${c.vin === 400 ? '68 A / 2 ms' : '40 A / 2.5 ms'} per driver. At ${c.vin} V: ${MCBS.map((m) => `${m} ${maxDrivers(c.vin, m)}`).join(' · ')}. This circuit: ${c.nd} on a ${c.mcb}${c.nd > maxDrivers(c.vin, c.mcb) ? ' – TOO MANY' : ''}.`,
        ir: t === 'earth' ? 'LED1 > 200 MΩ · LED2 0.03 MΩ to PE – FAULT · LED3 > 200 MΩ' : 'LED1 > 200 MΩ · LED2 > 200 MΩ · LED3 > 200 MΩ – all OK',
        irdrv: '⚠ Do not insulation-test with the driver connected: the outputs are not isolated – the reading is meaningless (Y-caps, electronics) and 500 V DC can damage the driver.',
        open: t === 'surge' ? 'F1 OPEN · MOV1 cracked, 0.2 Ω – SHORT · Q1 OK · bulk caps OK' : t === 'thermal' ? 'F1 OPEN · MOV1 OK · Q1 (PFC MOSFET) 0.1 Ω – SHORT, burnt · bulk capacitors bulging, ESR 5 Ω · board discoloured around the PFC' : 'Inside the driver everything is OK (F1 0.01 Ω, MOV OL, Q1 OL, caps OK).',
      };
      if (k === 'irdrv') st.unsafe++;
      if (k === 'iso') { st.iso = !st.iso; return meter(st.iso ? 'Isolated, locked off, proved dead (and waited 5 min for the bus capacitors)' : 'Lock removed', 'Isolation'); }
      meter(res[k], k === 'board' ? 'Mast DB' : k);
    }
    function drawDiag() {
      const box = $('hpDiag');
      if (mode !== 'trip') { box.innerHTML = ''; return; }
      const st = tripState;
      if (st.result) { box.innerHTML = st.result; $('hpNext').onclick = () => { if (st.used.length >= 3) { score = 0; tripState = null; } newTrip(); draw(); replay(); }; return; }
      box.innerHTML = `<div class="card"><b>Root cause – why did it trip, and why does it not work after the reset?</b>${TRIPKEYS.map((k) => `<label class="dg"><input type="radio" name="hpc" value="${k}" ${st.choice === k ? 'checked' : ''}> <span>${esc(TRIP[k].name)}</span></label>`).join('')}<div class="row" style="margin-top:8px"><span class="btn p" id="hpSub">Submit</span><span class="btn s" id="hpH">💡 Hint</span><span class="note" id="hpHT"></span></div></div>`;
      box.querySelectorAll('input[name=hpc]').forEach((i) => (i.onchange = () => (st.choice = i.value)));
      $('hpH').onclick = () => { $('hpHT').textContent = 'First: WHAT tripped (MCB or RCD)? HOW does it trip at the reset – instantly, after about 1 s (outputs starting), or does it hold with the driver dead?'; };
      $('hpSub').onclick = () => {
        if (!st.choice) return;
        const ok = st.choice === trip, T = TRIP[trip];
        if (ok && !st.shown) score++;
        st.result = `<div class="card">${kpi([[ok ? '✓' : '✗', ok ? 'root cause found' : 'not the cause', !ok], [tested.size, 'tests used'], [st.unsafe, 'safety slips', st.unsafe > 0], [`${score} / ${st.used.length}`, 'cases solved']])}<div class="${ok ? 'say' : 'watch'}"><b>${ok ? '✓' : '✗ It was:'} ${esc(T.name)}</b><br>${esc(T.reset)}<br><b>Fix:</b> ${esc(T.fix)}</div><div class="row" style="margin-top:10px">${st.used.length >= 3 ? `<b>${score >= 2 ? 'Passed ✓' : 'Not yet – solve 2 of 3 cases.'}</b>` : ''}<span class="btn p" id="hpNext">${st.used.length >= 3 ? 'Play again' : 'Next case'}</span></div></div>`;
        if (st.used.length >= 3 && done) done(score, 3);
        draw();
      };
    }
    draw();
  }
  W.hpdriver = bench;
  work('driver', 'd_hp', '🏟️', 'High-power 1700 W DMX driver (high mast)', '3 × 566 W constant-current channels, 220–400 V, DMX-RDM: surge, PFC, CCR modules, NTC, derating, blink codes', 'hpdriver', {});
  work('driver', 'd_hptrip', '⚡', 'Special case – works, trips, dead after reset', 'A high-mast driver ran perfectly, then the breaker tripped. After the reset it does not work. Find the real cause', 'hpdriver', { trip: true });
})();
