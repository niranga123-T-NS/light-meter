/* Troubleshooting – Indoor lighting: switched downlights with 24 V LED profiles, DALI office, DMX RGBW retail façade, 1-10 V dimming */
(function () {
  const t = (x, y, w, h, l) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#16213e" stroke="#475569"/><text x="${x + 8}" y="${y + 16}" fill="#94a3b8" font-size="11">${l}</text>`;

  // ================================================================ switched downlights + LED profiles
  scen('indoor', 'i_prof', '📏', {
    title: 'Showroom – downlights and LED profiles', sub: 'Switched 230 V downlights, 24 V constant-voltage power supply feeding LED profile runs', earthing: 'TN-C-S', ze: 0.3,
    brief: 'Showroom manager: lighting problems after the fit-out contractor added extra LED profiles over the display.',
    inputs: [{ k: 'down', label: 'Downlights switch', v: true }, { k: 'prof', label: 'Profiles switch', v: true }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-C-S)' }, { id: 'DB', kind: 'board', parent: 'SUP', name: 'Showroom DB' }, { id: 'RCD', kind: 'rcd', parent: 'DB', idn: 30, name: 'Lighting RCD' },
      { id: 'M1', kind: 'mcb', parent: 'RCD', rating: 10, curve: 'B', name: 'Downlights MCB' }, { id: 'C1', kind: 'cable', parent: 'M1', len: 20, size: 1.5, name: 'Downlight cable' }, { id: 'J1', kind: 'jb', parent: 'C1', name: 'Ceiling junction box' }, { id: 'SW1', kind: 'switch', parent: 'J1', in: 'down', name: 'Downlights switch' },
      { id: 'D1', kind: 'lum', parent: 'SW1', w: 15, name: 'Downlight 1' }, { id: 'D2', kind: 'lum', parent: 'SW1', w: 15, name: 'Downlight 2' }, { id: 'D3', kind: 'lum', parent: 'SW1', w: 15, name: 'Downlight 3' }, { id: 'D4', kind: 'lum', parent: 'SW1', w: 15, name: 'Downlight 4' },
      { id: 'M2', kind: 'mcb', parent: 'RCD', rating: 6, curve: 'B', name: 'Profiles MCB' }, { id: 'C2', kind: 'cable', parent: 'M2', len: 15, size: 1.5, name: 'Supply to the 24 V PSU' }, { id: 'SW2', kind: 'switch', parent: 'C2', in: 'prof', name: 'Profiles switch' },
      { id: 'PSU', kind: 'cvpsu', parent: 'SW2', w: 150, name: '24 V LED power supply 150 W', short: '24 V PSU' }, { id: 'C3', kind: 'cable', parent: 'PSU', len: 12, size: 1.5, name: '24 V cable to the profiles' },
      { id: 'P1', kind: 'profile', parent: 'C3', cv: 'PSU', w: 36, name: 'Profile run 1 (2 m)' }, { id: 'P2', kind: 'profile', parent: 'C3', cv: 'PSU', w: 36, name: 'Profile run 2 (2 m)' }, { id: 'P3', kind: 'profile', parent: 'C3', cv: 'PSU', w: 48, far: true, name: 'Profile run 3 (far end, 3 m)' },
    ],
    pool: [
      { id: 'over', el: 'PSU', mode: 'small', say: 'LED profiles flash on and off since the extra profile was added', title: '24 V power supply overloaded – the new profile pushed the load above its rating', look: 'Rating plate reads 90 W (a smaller unit was fitted)', hint: 'Measure the PSU output voltage and compare the total profile load with the PSU rating.', why: 'When the load exceeds the rating the PSU\'s protection shuts down and restarts (hiccup mode) – the profiles flash.', fix: 'Fit a PSU rated for the total load + 20 %, or split the runs over two supplies.' },
      { id: 'thin', el: 'PSU', mode: 'thin', excl: ['over'], say: 'The far LED profile is dimmer and warmer in colour than the others', title: '24 V cable to the far profile too small – voltage drop', hint: 'Measure the voltage at the far end of profile 3 with everything on.', why: 'At 24 V a few volts of drop is a large percentage – the far profile gets too little voltage.', fix: 'Larger 24 V cable, feed the run from both ends, or move the PSU closer.' },
      { id: 'psu', el: 'PSU', mode: 'dead', excl: ['over', 'thin'], say: 'No profiles work', title: '24 V power supply failed', hint: '230 V in, 24 V out?', why: 'The PSU has failed.', fix: 'Replace the PSU (constant-voltage, correct wattage, IP rating).' },
      { id: 'p2', el: 'P2', mode: 'dead', title: 'Profile run 2 – LED tape connected with reversed polarity', look: 'Red / black swapped at the profile end cap', hint: '24 V at the profile but no light – check the polarity at its end cap.', why: 'LED tape only lights with + and − the right way round.', fix: 'Correct the connection.' },
      { id: 'd3', el: 'D3', mode: 'dead', title: 'Downlight 3 driver failed', hint: 'Voltage at the downlight?', why: 'The driver has failed.', fix: 'Replace the driver.' },
      { id: 'hrn', el: 'J1', mode: 'hrN', title: 'Loose neutral in the ceiling junction box – all downlights flicker', hint: 'All downlights flicker together – their common point.', why: 'High-resistance neutral joint.', fix: 'Remake the joint.' },
      { id: 'inrush', el: 'M1', mode: 'curve', say: 'Downlight MCB trips when the lights are switched on', title: 'Downlight MCB trips on driver inrush (Type B)', hint: 'Trips at switch-on: inrush. Compare drivers per MCB.', why: 'Inrush of many drivers trips a Type B.', fix: 'Type C (check Zs) or inrush limiter.' },
      { id: 'sw', el: 'SW2', mode: 'stuckOff', say: 'No profiles work', excl: ['psu'], title: 'Profiles switch faulty', hint: 'Is there 230 V at the PSU input?', why: 'The switch never closes.', fix: 'Replace the switch.' },
    ],
    site: { w: 720, h: 340, bg: t(20, 20, 680, 300, 'Showroom'), at: { D1: [100, 80, 'DL 1'], D2: [220, 80, 'DL 2'], D3: [340, 80, 'DL 3'], D4: [460, 80, 'DL 4'], P1: [150, 220, 'Profile 1'], P2: [300, 220, 'Profile 2'], P3: [500, 220, 'Profile 3 (far)'], PSU: [620, 120, '24 V PSU'] } },
    demo: { title: 'LED profiles flash after the extension', sub: 'Constant-voltage supply: voltage, current and rating', faults: ['over'], in: {}, steps: [
      { say: 'All three profiles flash together – their common part is the 24 V power supply. Measure its <b>output voltage</b>.', act: 'test:vout:PSU' },
      { say: 'The output cycles between 0 and 24 V – the supply is protecting itself (hiccup). Check the <b>load against the rating</b>.', act: 'test:iout:PSU' },
      { say: 'The load is above the supply\'s rating. <b>Look</b> at the supply\'s rating plate.', act: 'test:look:PSU' },
      { say: 'A smaller supply was fitted than designed. Tick the fault and submit.', act: 'diag' },
    ] },
  });

  // ================================================================ DALI office
  scen('indoor', 'i_dali', '🏢', {
    title: 'Open-plan office – DALI lighting', sub: 'DALI drivers in window and core groups, bus power supply, scene controller', earthing: 'TN-S', ze: 0.35,
    brief: 'Facilities manager: the office lighting control misbehaves. Scene "Work" = window row 60 %, core 100 %; "Presentation" = window 0 %, core 30 %.',
    inputs: [{ k: 'scene', label: 'Scene', type: 'select', opts: [[0, 'Off'], [1, 'Work'], [2, 'Presentation'], [3, 'Cleaning']], v: 1 }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-S)' }, { id: 'DB', kind: 'board', parent: 'SUP', name: 'Office lighting DB' }, { id: 'RCD', kind: 'rcd', parent: 'DB', idn: 30, name: 'Lighting RCD' },
      { id: 'M1', kind: 'mcb', parent: 'RCD', rating: 10, curve: 'C', name: 'Office lighting MCB' }, { id: 'DPSU', kind: 'dalipsu', parent: 'M1', name: 'DALI bus power supply', short: 'DALI PSU' }, { id: 'DCTL', kind: 'dalictl', parent: 'M1', in: 'scene', name: 'DALI controller', short: 'DALI CTL', scenes: { 0: { g1: 0, g2: 0 }, 1: { g1: 0.6, g2: 1 }, 2: { g1: 0, g2: 0.3 }, 3: { g1: 1, g2: 1 } } },
      { id: 'C1', kind: 'cable', parent: 'M1', len: 30, size: 1.5, name: '5-core mains + DALI cable' }, { id: 'J1', kind: 'jb', parent: 'C1', name: 'Ceiling distribution box' },
      { id: 'W1', kind: 'lum', parent: 'J1', drv: 'dali', bus: 'd1', addr: 0, group: 1, w: 34, name: 'Window panel 1 (G1)' }, { id: 'W2', kind: 'lum', parent: 'J1', drv: 'dali', bus: 'd1', addr: 1, group: 1, w: 34, name: 'Window panel 2 (G1)' }, { id: 'W3', kind: 'lum', parent: 'J1', drv: 'dali', bus: 'd1', addr: 2, group: 1, w: 34, name: 'Window panel 3 (G1)' },
      { id: 'K1', kind: 'lum', parent: 'J1', drv: 'dali', bus: 'd1', addr: 3, group: 2, w: 34, name: 'Core panel 1 (G2)' }, { id: 'K2', kind: 'lum', parent: 'J1', drv: 'dali', bus: 'd1', addr: 4, group: 2, w: 34, name: 'Core panel 2 (G2)' }, { id: 'K3', kind: 'lum', parent: 'J1', drv: 'dali', bus: 'd1', addr: 5, group: 2, w: 34, name: 'Core panel 3 (G2)' },
    ],
    buses: [{ id: 'd1', kind: 'dali', psu: 'DPSU', ctl: 'DCTL' }],
    pool: [
      { id: 'short', el: 'd1', mode: 'short', say: 'All lights are at full and the scene buttons do nothing', title: 'DALI bus short circuit', hint: 'DALI bus voltage at the supply.', why: 'No bus voltage – drivers go to system failure level (full).', fix: 'Find and clear the short (split the bus), check terminations in the distribution box.' },
      { id: 'psu', el: 'DPSU', mode: 'dead', say: 'All lights are at full and the scene buttons do nothing', title: 'DALI bus power supply failed', hint: 'Bus voltage 0 V – disconnect the bus at the supply: is there still 0 V at the supply terminals?', why: 'No bus voltage – same symptom as a short.', fix: 'Replace the bus power supply (check its rating against the number of devices).' },
      { id: 'addr', el: 'W2', mode: 'addr', title: 'Window panel 2 – replacement driver not addressed', hint: 'Scan the DALI line.', why: 'Unaddressed drivers stay at power-on level (full).', fix: 'Address and group the new driver.' },
      { id: 'grp', el: 'K3', mode: 'group', val: 1, title: 'Core panel 3 programmed in the window group (G1)', hint: 'Scan and compare groups with the drawing.', why: 'It follows the window row\'s daylight level.', fix: 'Correct the group.' },
      { id: 'lamp', el: 'W3', mode: 'lampFail', title: 'Window panel 3 – LED module failed (driver reports lamp failure)', hint: 'Scan the DALI line – look at the status of each driver.', why: 'The driver is alive and answers, but its LED module is open.', fix: 'Replace the LED module / panel.' },
      { id: 'drv', el: 'K1', mode: 'dead', title: 'Core panel 1 driver failed (not found on the bus)', hint: 'Scan – which addresses are missing?', why: 'Driver failed – no light and no DALI response.', fix: 'Replace the driver; address and group it.' },
      { id: 'hr', el: 'J1', mode: 'hrL', title: 'Loose line terminal in the ceiling distribution box – all panels flicker', hint: 'All panels flicker – common point.', why: 'High-resistance joint.', fix: 'Remake the terminal.' },
      { id: 'mains', el: 'd1', mode: 'mains', say: 'Office lights dead after an electrician added a socket', title: 'Mains connected to the DALI pair (grey/black cores used as spare line)', hint: 'Measure the DALI bus for AC as well as DC.', why: 'The DALI cores in a 5-core cable were taken for mains by mistake.', fix: 'Remove the connection, replace damaged drivers; label DALI cores.' },
    ],
    site: { w: 720, h: 320, bg: t(20, 20, 680, 280, 'Open-plan office') + '<rect x="20" y="20" width="680" height="12" fill="#38bdf8" opacity="0.5"/><text x="560" y="45" fill="#bae6fd" font-size="10">Windows</text>', at: { W1: [140, 90, 'Window 1'], W2: [360, 90, 'Window 2'], W3: [580, 90, 'Window 3'], K1: [140, 220, 'Core 1'], K2: [360, 220, 'Core 2'], K3: [580, 220, 'Core 3'], DCTL: [60, 160, 'Controller'] } },
  });

  // ================================================================ DMX RGBW retail façade
  scen('indoor', 'i_dmx', '🌈', {
    title: 'Retail façade – DMX RGBW', sub: 'Six RGBW linear wash fixtures daisy-chained on one DMX universe from a playback controller', earthing: 'TN-C-S', ze: 0.3,
    brief: 'Mall operator: the façade colour show is wrong. Show "Brand" should be blue on all fixtures; "Rainbow" gives each fixture a different colour.',
    inputs: [{ k: 'show', label: 'Show', type: 'select', opts: [['brand', 'Brand (all blue)'], ['rainbow', 'Rainbow'], ['white', 'White']], v: 'rainbow' }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-C-S)' }, { id: 'DB', kind: 'board', parent: 'SUP', name: 'Façade DB' }, { id: 'RCD', kind: 'rcd', parent: 'DB', idn: 30, name: 'Façade RCD' },
      { id: 'M1', kind: 'mcb', parent: 'RCD', rating: 16, curve: 'C', name: 'Façade lighting MCB' }, { id: 'PB', kind: 'dmxcon', parent: 'M1', in: 'show', name: 'DMX playback controller', short: 'DMX', patterns: { brand: { 3: 1, 7: 1, 11: 1, 15: 1, 19: 1, 23: 1 }, rainbow: { 1: 1, 6: 1, 11: 1, 16: 1, 17: 1, 18: 1, 23: 1, 24: 1 }, white: { all: 1 } } },
      { id: 'C1', kind: 'cable', parent: 'M1', len: 25, size: 2.5, name: 'Façade power cable' }, { id: 'J1', kind: 'jb', parent: 'C1', name: 'Façade power box (IP66)' },
      { id: 'X1', kind: 'rgbw', parent: 'J1', bus: 'm', addr: 1, w: 60, name: 'Wash 1 (addr 1)' }, { id: 'X2', kind: 'rgbw', parent: 'J1', bus: 'm', addr: 5, w: 60, name: 'Wash 2 (addr 5)' }, { id: 'X3', kind: 'rgbw', parent: 'J1', bus: 'm', addr: 9, w: 60, name: 'Wash 3 (addr 9)' }, { id: 'X4', kind: 'rgbw', parent: 'J1', bus: 'm', addr: 13, w: 60, name: 'Wash 4 (addr 13)' }, { id: 'X5', kind: 'rgbw', parent: 'J1', bus: 'm', addr: 17, w: 60, name: 'Wash 5 (addr 17)' }, { id: 'X6', kind: 'rgbw', parent: 'J1', bus: 'm', addr: 21, w: 60, name: 'Wash 6 (addr 21)' },
    ],
    buses: [{ id: 'm', kind: 'dmx', console: 'PB', chain: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6'] }],
    pool: [
      { id: 'term', el: 'm', mode: 'noTerm', title: 'No terminator at the end of the DMX line', hint: 'Analyse DMX at the first and last fixtures.', why: 'Reflections corrupt data at the end of the line.', fix: 'Fit a 120 Ω terminator.' },
      { id: 'pol', el: 'X4', mode: 'polarity', title: 'Data+ / Data− swapped at wash 4 input', hint: 'Analyse DMX at washes 3 and 4.', why: 'Inverted data from the swapped connector onwards.', fix: 'Correct the connector wiring.' },
      { id: 'thru', el: 'X3', mode: 'thruBroken', title: 'DMX link cable broken after wash 3', hint: 'Washes 4–6 do not follow the show – analyse DMX at wash 3 and 4.', why: 'No signal downstream of the break.', fix: 'Replace the link cable (outdoor-rated, IP67 connectors).' },
      { id: 'hold', el: 'X5', mode: 'addr', val: 1, title: 'Wash 5 addressed to 1 – copies wash 1', hint: 'Compare the fixture menus with the patch.', why: 'Duplicate address.', fix: 'Set wash 5 to address 17.' },
      { id: 'mode', el: 'X6', mode: 'mode3', title: 'Wash 6 in 3-channel mode', hint: 'Wash 6 shows the wrong colour in "Rainbow" (it should be warm white + blue). Read its mode.', why: 'In 3-channel mode the white channel is missing and the addresses shift.', fix: 'Set 4-channel RGBW mode.' },
      { id: 'con', el: 'PB', mode: 'dead', say: 'Façade completely dark', title: 'DMX playback controller dead', hint: 'Power at the fixtures? DMX signal at wash 1?', why: 'The fixtures are powered but receive no DMX.', fix: 'Replace / reboot the controller; check its PSU.' },
      { id: 'chs', el: 'X2', mode: 'chShort', title: 'Wash 2 red output stage shorted – red always on', hint: 'Try different shows – is wash 2 always reddish?', why: 'A shorted MOSFET keeps that colour full on.', fix: 'Repair the fixture driver board.' },
      { id: 'wet', el: 'J1', mode: 'irLow', leak: 26, ir: 0.12, say: 'The façade RCD trips every evening when the show starts – worse after rain', title: 'Water in the façade power box – leakage trips the RCD', look: 'Gland not tightened, water inside', hint: 'Leakage clamp on the façade circuit, insulation test from the power box.', why: 'Water ingress leaks current to earth.', fix: 'Dry, replace terminals, correct IP glands.' },
    ],
    site: { w: 720, h: 260, bg: '<rect x="20" y="40" width="680" height="180" fill="#1e293b" stroke="#475569"/><text x="30" y="58" fill="#94a3b8" font-size="11">Mall façade</text>', at: { X1: [90, 130, 'Wash 1'], X2: [200, 130, 'Wash 2'], X3: [310, 130, 'Wash 3'], X4: [420, 130, 'Wash 4'], X5: [530, 130, 'Wash 5'], X6: [640, 130, 'Wash 6'], PB: [360, 200, 'Controller'] } },
  });

  // ================================================================ 1-10 V dimming
  scen('indoor', 'i_110', '🎚️', {
    title: 'Meeting rooms – 1-10 V dimming', sub: 'Four 1-10 V drivers on a rotary 1-10 V controller, switched mains', earthing: 'TN-S', ze: 0.35,
    brief: 'Conference centre: dimming in meeting room B does not work properly. Set the dimmer to 30 % and check.',
    inputs: [{ k: 'on', label: 'Lights switched on', v: true }, { k: 'dim', label: 'Dimmer', type: 'range', min: 0, max: 1, step: 0.1, v: 0.3, fmt: (v) => Math.round(v * 100) + ' %' }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-S)' }, { id: 'DB', kind: 'board', parent: 'SUP', name: 'Conference DB' }, { id: 'RCD', kind: 'rcd', parent: 'DB', idn: 30, name: 'Lighting RCD' },
      { id: 'M1', kind: 'mcb', parent: 'RCD', rating: 10, curve: 'B', name: 'Room B lighting MCB' }, { id: 'DIM', kind: 'ctl110', parent: 'M1', in: 'dim', name: '1-10 V controller (wall)', short: '1-10 V' },
      { id: 'SW', kind: 'switch', parent: 'M1', in: 'on', name: 'Controller mains switch' }, { id: 'C1', kind: 'cable', parent: 'SW', len: 15, size: 1.5, name: 'Mains + 1-10 V pair' },
      { id: 'A1', kind: 'lum', parent: 'C1', drv: '1-10v', bus: 'a', w: 40, name: 'Panel A1' }, { id: 'A2', kind: 'lum', parent: 'C1', drv: '1-10v', bus: 'a', w: 40, name: 'Panel A2' }, { id: 'A3', kind: 'lum', parent: 'C1', drv: '1-10v', bus: 'a', w: 40, name: 'Panel A3' }, { id: 'A4', kind: 'lum', parent: 'C1', drv: '1-10v', bus: 'a', w: 40, name: 'Panel A4' },
    ],
    buses: [{ id: 'a', kind: '1-10v', ctl: 'DIM', drivers: ['A1', 'A2', 'A3', 'A4'] }],
    pool: [
      { id: 'open', el: 'A2', mode: 'ctlOpen', title: 'Panel A2 – 1-10 V wires not connected (stays at full)', look: 'Purple / grey control cores loose in the connector', hint: 'Measure the 1-10 V voltage at each driver.', why: 'An open 1-10 V input reads as 10 V – the driver runs at full.', fix: 'Connect the control pair.' },
      { id: 'rev', el: 'A3', mode: 'ctlRev', title: 'Panel A3 – 1-10 V pair reversed (stays at minimum)', hint: 'Control voltage at A3 compared with the others.', why: 'Reversed polarity pulls the input low – minimum output.', fix: 'Swap the + and − control wires at A3.' },
      { id: 'wire', el: 'A1', mode: 'wireOpen', title: '1-10 V pair broken after panel A1 – A2 to A4 stay at full', hint: 'A1 dims, the others do not. Measure control voltage along the line.', why: 'Downstream drivers lose the controller and see an open input (full).', fix: 'Repair the control pair (loop-in terminals at A1).' },
      { id: 'sink', el: 'DIM', mode: 'overload', title: 'Too many drivers for the controller – it cannot pull the voltage below about 6 V', look: 'Controller rated 4 × 0.5 mA sink, drivers 2 mA each', hint: 'Measure the control voltage at the controller at 0 %.', why: 'Each driver sources current into the control line; the controller can only sink a limited amount.', fix: 'Use a controller with enough sink current, or a 1-10 V amplifier.' },
      { id: 'a4', el: 'A4', mode: 'dead', title: 'Panel A4 driver failed', hint: 'Mains at A4?', why: 'Driver failed.', fix: 'Replace the driver.' },
      { id: 'sw', el: 'SW', mode: 'stuckOff', say: 'Room B lights do not switch on', title: 'Controller mains switch faulty', hint: 'Mains in and out of the controller switch.', why: 'The switch section never closes.', fix: 'Replace the controller.' },
    ],
    site: { w: 720, h: 300, bg: t(20, 20, 680, 260, 'Meeting room B'), at: { A1: [140, 110, 'A1'], A2: [300, 110, 'A2'], A3: [460, 110, 'A3'], A4: [620, 110, 'A4'], DIM: [80, 240, 'Dimmer'] } },
  });
})();
