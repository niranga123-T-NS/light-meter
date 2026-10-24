/* Troubleshooting – KNX: lighting and blinds on one line, KNX–DALI gateway, two lines with a line coupler */
(function () {
  const t = (x, y, w, h, l) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#16213e" stroke="#475569"/><text x="${x + 8}" y="${y + 16}" fill="#94a3b8" font-size="11">${l}</text>`;

  // ================================================================ KNX lighting and blinds
  scen('knx', 'k_line', '🔘', {
    title: 'KNX suite – lighting and blinds', sub: 'KNX power supply, push-button sensors, switch actuator channels, blind actuator', earthing: 'TN-S', ze: 0.3,
    brief: 'Hotel suite on KNX. Button 1 → GA 1/0/1 (ceiling lights), button 2 → 1/0/2 (wall lights), button 3 → 2/0/1 (blinds). Housekeeping reports problems.',
    inputs: [{ k: 'b1', label: 'Button 1 – ceiling lights', v: true }, { k: 'b2', label: 'Button 2 – wall lights', v: true }, { k: 'b3', label: 'Button 3 – blinds down', v: true }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-S)' }, { id: 'DB', kind: 'board', parent: 'SUP', name: 'Suite DB with KNX devices' }, { id: 'M0', kind: 'mcb', parent: 'DB', rating: 6, curve: 'B', name: 'KNX supply MCB' }, { id: 'KPSU', kind: 'knxpsu', parent: 'M0', name: 'KNX power supply 640 mA', short: 'KNX PSU' },
      { id: 'PB1', kind: 'knxsw', parent: 'M0', in: 'b1', ga: '1/0/1', pa: '1.1.10', name: 'Push-button 1 (1.1.10)', short: 'PB 1' }, { id: 'PB2', kind: 'knxsw', parent: 'M0', in: 'b2', ga: '1/0/2', pa: '1.1.11', name: 'Push-button 2 (1.1.11)', short: 'PB 2' }, { id: 'PB3', kind: 'knxsw', parent: 'M0', in: 'b3', ga: '2/0/1', pa: '1.1.12', name: 'Push-button 3 (1.1.12)', short: 'PB 3' },
      { id: 'RC', kind: 'rcbo', parent: 'DB', rating: 10, curve: 'B', idn: 30, name: 'Lighting RCBO' },
      { id: 'A1', kind: 'knxact', parent: 'RC', ch: 'A', ga: '1/0/1', pa: '1.1.20', name: 'Switch actuator ch A (1.1.20)' }, { id: 'C1', kind: 'cable', parent: 'A1', len: 10, size: 1.5, name: 'Ceiling lights cable' }, { id: 'L1', kind: 'lum', parent: 'C1', w: 30, name: 'Ceiling lights' },
      { id: 'A2', kind: 'knxact', parent: 'RC', ch: 'B', ga: '1/0/2', pa: '1.1.20', name: 'Switch actuator ch B (1.1.20)' }, { id: 'C2', kind: 'cable', parent: 'A2', len: 12, size: 1.5, name: 'Wall lights cable' }, { id: 'L2', kind: 'lum', parent: 'C2', w: 20, name: 'Wall lights' },
      { id: 'MB', kind: 'mcb', parent: 'DB', rating: 6, curve: 'B', name: 'Blinds MCB' }, { id: 'A3', kind: 'knxact', parent: 'MB', ch: 'A', ga: '2/0/1', pa: '1.1.21', name: 'Blind actuator (1.1.21)' }, { id: 'C3', kind: 'cable', parent: 'A3', len: 8, size: 1.5, name: 'Blind motor cable' }, { id: 'BL', kind: 'motor', parent: 'C3', kw: 0.12, name: 'Blind motor' },
    ],
    buses: [{ id: 'kb', kind: 'knx', psu: 'KPSU', sensors: ['PB1', 'PB2', 'PB3'], devices: ['A1', 'A2', 'A3'] }],
    busSymptoms: (st, R, out) => { if (!R.bus.kb.ok) out.push('Push-buttons do nothing – their status LEDs are off'); },
    pool: [
      { id: 'psu', el: 'KPSU', mode: 'dead', title: 'KNX power supply failed – no bus voltage', hint: 'Measure the bus voltage at the supply and at a device.', why: 'Without about 29 V DC on the bus no telegrams are sent – actuators keep (or drop to) their bus-failure state.', fix: 'Replace the KNX supply (with choke); check its load against the number of devices.' },
      { id: 'short', el: 'kb', mode: 'short', title: 'Bus cable short circuit (red/black damaged by a fixing)', hint: 'Bus voltage near 0 V. Disconnect the PSU from the bus – does its output come back?', why: 'A short pulls the bus down – the supply limits its current.', fix: 'Split the line to find the short, repair the cable.' },
      { id: 'low', el: 'kb', mode: 'low', say: 'Buttons work only sometimes', title: 'Bus voltage too low (overloaded / too long line) – intermittent', hint: 'Measure the bus voltage at the furthest device.', why: 'Below about 21 V devices reset and miss telegrams.', fix: 'Add a power supply / shorten the line / reduce devices per segment.' },
      { id: 'ga', el: 'PB2', mode: 'gaWrong', val: '1/0/9', say: 'Wall lights do not respond to button 2', title: 'Push-button 2 sends to group 1/0/9 instead of 1/0/2', hint: 'Group monitor while you press button 2; read the actuator\'s group address.', why: 'The sensor and the actuator are not linked to the same group address.', fix: 'Correct the association in ETS and download.' },
      { id: 'gam', el: 'A1', mode: 'gaMissing', say: 'Ceiling lights do not respond', title: 'Actuator channel A has no group address (download incomplete)', hint: 'Read the channel parameters in ETS.', why: 'Telegrams arrive but the channel is not listening to any group.', fix: 'Link 1/0/1 to channel A and download.' },
      { id: 'weld', el: 'A2', mode: 'welded', say: 'Wall lights never switch off', title: 'Actuator channel B relay contacts welded', hint: 'Use the manual override on channel B. Telegrams correct?', why: 'Overloaded relay (LED inrush) welded its contacts.', fix: 'Replace the actuator; use a channel rated for capacitive (LED) loads.' },
      { id: 'pb1', el: 'PB1', mode: 'dead', title: 'Push-button 1 bus coupler failed', hint: 'Press the programming button – does its LED light? Group monitor.', why: 'The device does not send telegrams.', fix: 'Replace the push-button bus coupler, re-download.' },
      { id: 'rc', el: 'RC', mode: 'faultLE', excl: [], say: 'Lights and switches dead in the suite', title: 'Lighting RCBO tripped – earth fault in the ceiling lights cable', hint: 'RCBO flag, then insulation tests.', why: 'Earth fault in the cable.', fix: 'Repair the cable.' },
    ].map((f) => (f.id === 'rc' ? { ...f, el: 'C1' } : f)),
    site: { w: 720, h: 300, bg: t(20, 20, 680, 260, 'Suite'), at: { L1: [200, 90, 'Ceiling'], L2: [420, 90, 'Wall lights'], BL: [600, 90, 'Blinds'], PB1: [120, 220, 'PB 1'], PB2: [220, 220, 'PB 2'], PB3: [320, 220, 'PB 3'], KPSU: [520, 220, 'KNX PSU'] } },
    demo: { title: 'a button that does nothing', sub: 'KNX: group monitor and the group address association', faults: ['ga'], in: {}, steps: [
      { say: 'Button 2 should switch the wall lights. First check the bus: tap <b>push-button 2</b> and measure the <b>bus voltage</b>.', act: 'test:busv:PB2' },
      { say: 'The bus is healthy. Open the <b>ETS group monitor</b> and press button 2.', act: 'test:mon:PB2' },
      { say: 'Button 2 sends a telegram – but to <b>1/0/9</b>. Read actuator channel B\'s parameters.', act: 'test:knxread:A2' },
      { say: 'Channel B listens to <b>1/0/2</b>. Sensor and actuator are on different groups. Tick the fault and submit.', act: 'diag' },
    ] },
  });

  // ================================================================ KNX–DALI gateway
  scen('knx', 'k_dali', '🔀', {
    title: 'KNX–DALI gateway – office floor', sub: 'KNX scene button → KNX/DALI gateway (with DALI supply) → DALI groups', earthing: 'TN-S', ze: 0.3,
    brief: 'Office floor: KNX scene 1 "Work" = group 1 at 80 %, group 2 at 100 %; scene 2 "Meeting" = group 1 at 20 %, group 2 at 50 %.',
    inputs: [{ k: 'scene', label: 'KNX scene button', type: 'select', opts: [[1, 'Scene 1 – Work'], [2, 'Scene 2 – Meeting'], [0, 'All off']], v: 2 }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-S)' }, { id: 'DB', kind: 'board', parent: 'SUP', name: 'Floor DB' }, { id: 'M0', kind: 'mcb', parent: 'DB', rating: 6, curve: 'B', name: 'KNX / gateway MCB' }, { id: 'KPSU', kind: 'knxpsu', parent: 'M0', name: 'KNX power supply', short: 'KNX PSU' },
      { id: 'SB', kind: 'knxsw', parent: 'M0', in: 'scene', ga: '1/2/0', pa: '1.1.30', name: 'Scene push-button (1.1.30)', short: 'SCENE' },
      { id: 'GW', kind: 'dalictl', parent: 'M0', in: 'scene', knxBus: 'kb', def: 1, name: 'KNX–DALI gateway (1.1.40)', short: 'GATEWAY', scenes: { 0: { g1: 0, g2: 0 }, 1: { g1: 0.8, g2: 1 }, 2: { g1: 0.2, g2: 0.5 } }, tests: [['gwd', 'Gateway display / web page', 'Special', (st, R, e, F) => (F(st, e.id, 'dead') ? 'Display blank' : `KNX ${R.bus.kb.ok ? 'OK' : 'NO BUS'} · DALI bus ${R.bus.d.ok ? '16 V OK' : 'FAULT'} · scene object ${F(st, e.id, 'gaWrong') ? '1/2/9' : '1/2/0'}`)], ['dbus', 'DALI bus voltage at the gateway', 'Live tests', (st, R) => `${R.bus.d.v} V DC`]] },
      { id: 'RC', kind: 'rcd', parent: 'DB', idn: 30, name: 'Lighting RCD' }, { id: 'M1', kind: 'mcb', parent: 'RC', rating: 10, curve: 'C', name: 'Office lighting MCB' }, { id: 'C1', kind: 'cable', parent: 'M1', len: 30, size: 1.5, name: 'Lighting cable + DALI pair' },
      { id: 'D1', kind: 'lum', parent: 'C1', drv: 'dali', bus: 'd', addr: 0, group: 1, w: 34, name: 'Panel 1 (G1)' }, { id: 'D2', kind: 'lum', parent: 'C1', drv: 'dali', bus: 'd', addr: 1, group: 1, w: 34, name: 'Panel 2 (G1)' }, { id: 'D3', kind: 'lum', parent: 'C1', drv: 'dali', bus: 'd', addr: 2, group: 2, w: 34, name: 'Panel 3 (G2)' }, { id: 'D4', kind: 'lum', parent: 'C1', drv: 'dali', bus: 'd', addr: 3, group: 2, w: 34, name: 'Panel 4 (G2)' },
    ],
    buses: [{ id: 'kb', kind: 'knx', psu: 'KPSU', sensors: ['SB'], devices: ['GW'] }, { id: 'd', kind: 'dali', psu: 'GW', ctl: 'GW' }],
    pool: [
      { id: 'gw', el: 'GW', mode: 'dead', say: 'Every panel at full; scenes do nothing', title: 'KNX–DALI gateway failed (its DALI supply too)', hint: 'Gateway display; DALI bus voltage.', why: 'With the gateway dead there is no DALI bus voltage – drivers go to failure level (full).', fix: 'Replace the gateway, restore its configuration from the ETS project.' },
      { id: 'gaw', el: 'GW', mode: 'gaWrong', say: 'Scene button has no effect – the lights stay in the Work scene', title: 'Gateway scene object linked to the wrong group address (1/2/9)', hint: 'Group monitor on the scene button, then read the gateway\'s scene object.', why: 'Telegrams go to 1/2/0, the gateway listens to 1/2/9.', fix: 'Correct the association in ETS.' },
      { id: 'knx', el: 'KPSU', mode: 'dead', say: 'Scene button has no effect', title: 'KNX power supply failed', hint: 'KNX bus voltage.', why: 'No KNX bus – the gateway never receives the scene; it keeps its default scene.', fix: 'Replace the KNX supply.' },
      { id: 'addr', el: 'D2', mode: 'addr', title: 'Panel 2 – new driver not addressed', hint: 'Scan the DALI line from the gateway.', why: 'Unaddressed – stays at power-on level.', fix: 'Address and group it from the gateway.' },
      { id: 'grp', el: 'D3', mode: 'group', val: 1, title: 'Panel 3 in group 1 instead of group 2', hint: 'DALI scan – compare groups.', why: 'Follows group 1\'s level.', fix: 'Correct the group.' },
      { id: 'short', el: 'd', mode: 'short', say: 'Every panel at full; scenes do nothing', excl: ['gw'], title: 'DALI bus short in the ceiling', hint: 'DALI bus voltage 0 V – disconnect the field bus at the gateway.', why: 'Shorted bus – no DALI voltage.', fix: 'Find the short.' },
      { id: 'd4', el: 'D4', mode: 'lampFail', title: 'Panel 4 LED module failed (lamp failure flag)', hint: 'Scan: driver status.', why: 'Driver alive, LED module open.', fix: 'Replace the module.' },
    ],
    site: { w: 720, h: 280, bg: t(20, 20, 680, 240, 'Office floor'), at: { D1: [140, 100, 'Panel 1'], D2: [300, 100, 'Panel 2'], D3: [460, 100, 'Panel 3'], D4: [620, 100, 'Panel 4'], SB: [140, 220, 'Scene button'], GW: [460, 220, 'Gateway'] } },
  });

  // ================================================================ two lines with a line coupler
  scen('knx', 'k_lines', '🧩', {
    title: 'KNX – two lines with a line coupler', sub: 'Sensors on line 1.1, actuators on line 1.2, line coupler filter table, presence detector', earthing: 'TN-S', ze: 0.3,
    brief: 'Meeting floor: button (1.1.5) → 1/0/5 lights, presence (1.1.6) → 1/0/6 fan coil enable. Actuators are on line 1.2 behind line coupler 1.2.0.',
    inputs: [{ k: 'btn', label: 'Room light button', v: true }, { k: 'occ', label: 'Room occupied (presence)', v: true }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-S)' }, { id: 'DB', kind: 'board', parent: 'SUP', name: 'Floor DB' }, { id: 'M0', kind: 'mcb', parent: 'DB', rating: 6, curve: 'B', name: 'KNX supplies MCB' },
      { id: 'P1', kind: 'knxpsu', parent: 'M0', name: 'KNX PSU line 1.1', short: 'PSU 1.1' }, { id: 'LC', kind: 'knxcoupler', parent: 'M0', name: 'Line coupler 1.2.0', short: 'COUPLER' },
      { id: 'BT', kind: 'knxsw', parent: 'M0', in: 'btn', ga: '1/0/5', pa: '1.1.5', line: 1, name: 'Light button (1.1.5)', short: 'BUTTON' }, { id: 'PR', kind: 'knxsw', parent: 'M0', in: 'occ', ga: '1/0/6', pa: '1.1.6', line: 1, name: 'Presence detector (1.1.6)', short: 'PRESENCE' },
      { id: 'RC', kind: 'rcbo', parent: 'DB', rating: 10, curve: 'B', idn: 30, name: 'Meeting room RCBO' },
      { id: 'A1', kind: 'knxact', parent: 'RC', ch: 'A', ga: '1/0/5', pa: '1.2.10', name: 'Actuator 1.2.10 ch A – lights' }, { id: 'C1', kind: 'cable', parent: 'A1', len: 12, size: 1.5, name: 'Lights cable' }, { id: 'L1', kind: 'lum', parent: 'C1', w: 60, name: 'Meeting room lights' },
      { id: 'A2', kind: 'knxact', parent: 'RC', ch: 'B', ga: '1/0/6', pa: '1.2.10', name: 'Actuator 1.2.10 ch B – fan coil' }, { id: 'C2', kind: 'cable', parent: 'A2', len: 10, size: 1.5, name: 'Fan coil cable' }, { id: 'FC', kind: 'fan', parent: 'C2', w: 150, name: 'Fan coil unit' },
    ],
    buses: [{ id: 'kb', kind: 'knx', psu: 'P1', coupler: 'LC', actLine: 2, sensors: ['BT', 'PR'], devices: ['A1', 'A2', 'LC'] }],
    pool: [
      { id: 'filt', el: 'LC', mode: 'filter', val: '1/0/5', say: 'Room lights do not respond to the button; the fan coil works', title: 'Line coupler filter table blocks group 1/0/5', hint: 'Group monitor on line 1.1 sees the telegram – does it reach line 1.2? Read the coupler filter table.', why: 'The coupler only passes groups that are in its filter table; 1/0/5 was added after the coupler was last downloaded.', fix: 'Download the line coupler (filter table) in ETS.' },
      { id: 'filt2', el: 'LC', mode: 'filter', val: '1/0/6', excl: ['filt'], say: 'Fan coil does not come on when the room is occupied', title: 'Line coupler filter table blocks group 1/0/6', hint: 'Read the coupler filter table.', why: 'The presence group was never downloaded to the coupler.', fix: 'Download the coupler.' },
      { id: 'pr', el: 'PR', mode: 'dead', title: 'Presence detector failed', hint: 'Programming LED and group monitor.', why: 'No telegrams from the detector.', fix: 'Replace the detector.' },
      { id: 'psu', el: 'P1', mode: 'dead', say: 'Nothing on the meeting floor responds', title: 'KNX supply for line 1.1 failed', hint: 'Bus voltage on line 1.1.', why: 'No bus voltage – no telegrams.', fix: 'Replace the supply.' },
      { id: 'gam', el: 'A2', mode: 'gaMissing', title: 'Fan coil channel not linked to 1/0/6', hint: 'Read actuator 1.2.10 channel B.', why: 'Channel B is not listening to the presence group.', fix: 'Link the group and download.' },
      { id: 'bt', el: 'BT', mode: 'gaWrong', val: '1/0/50', title: 'Light button sends to 1/0/50 (typing error)', hint: 'Group monitor on the button.', why: 'Wrong group address – nobody listens.', fix: 'Correct and download.' },
    ],
    site: { w: 720, h: 260, bg: t(20, 20, 680, 220, 'Meeting room'), at: { L1: [200, 100, 'Lights'], FC: [480, 100, 'Fan coil'], BT: [120, 200, 'Button'], PR: [300, 200, 'Presence'], LC: [560, 200, 'Coupler'] } },
  });
})();
