/* LED driver workbench – component-level circuits of an On/Off constant-current driver, a DALI driver, a DMX RGBW decoder with its 24 V supply
   and a 1-10 V driver. Explore: make any part fail and see the light and the test points change. Challenge: a hidden failed part to find. */
(function () {
  // ---------------------------------------------------------------- schematic symbols (x, y = centre)
  const ln = (pts, c = '#334155', w = 2, dash) => `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}" ${dash ? 'stroke-dasharray="5 4"' : ''}/>`;
  const txt = (x, y, t, s = 10, c = '#334155', a = 'middle', wgt = 400) => `<text x="${x}" y="${y}" font-size="${s}" fill="${c}" text-anchor="${a}" font-weight="${wgt}">${t}</text>`;
  const SYM = {
    fuse: (x, y) => `<rect x="${x - 14}" y="${y - 5}" width="28" height="10" fill="#fff" stroke="currentColor" stroke-width="1.6"/><line x1="${x - 14}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="currentColor"/>`,
    res: (x, y, v) => (v ? `<rect x="${x - 5}" y="${y - 14}" width="10" height="28" fill="#fff" stroke="currentColor" stroke-width="1.6"/>` : `<rect x="${x - 14}" y="${y - 5}" width="28" height="10" fill="#fff" stroke="currentColor" stroke-width="1.6"/>`),
    ntc: (x, y, v) => SYM.res(x, y, v) + `<line x1="${x - 12}" y1="${y + 10}" x2="${x + 12}" y2="${y - 10}" stroke="currentColor"/>`,
    mov: (x, y) => `<rect x="${x - 6}" y="${y - 16}" width="12" height="32" fill="#fff" stroke="currentColor" stroke-width="1.6"/><path d="M${x - 10} ${y + 12} L${x - 4} ${y + 12} L${x + 4} ${y - 12} L${x + 10} ${y - 12}" fill="none" stroke="currentColor"/>`,
    cap: (x, y) => `<line x1="${x - 12}" y1="${y - 4}" x2="${x + 12}" y2="${y - 4}" stroke="currentColor" stroke-width="2.4"/><line x1="${x - 12}" y1="${y + 4}" x2="${x + 12}" y2="${y + 4}" stroke="currentColor" stroke-width="2.4"/>`,
    ecap: (x, y) => `<line x1="${x - 12}" y1="${y - 4}" x2="${x + 12}" y2="${y - 4}" stroke="currentColor" stroke-width="2.4"/><path d="M${x - 12} ${y + 7} Q${x} ${y + 1} ${x + 12} ${y + 7}" fill="none" stroke="currentColor" stroke-width="2.4"/><text x="${x - 16}" y="${y - 6}" font-size="10" fill="currentColor">+</text>`,
    dio: (x, y, v) => (v ? `<path d="M${x - 9} ${y + 7} L${x + 9} ${y + 7} L${x} ${y - 7} Z" fill="#fff" stroke="currentColor" stroke-width="1.6"/><line x1="${x - 9}" y1="${y - 7}" x2="${x + 9}" y2="${y - 7}" stroke="currentColor" stroke-width="2"/>` : `<path d="M${x - 7} ${y - 9} L${x - 7} ${y + 9} L${x + 7} ${y} Z" fill="#fff" stroke="currentColor" stroke-width="1.6"/><line x1="${x + 7}" y1="${y - 9}" x2="${x + 7}" y2="${y + 9}" stroke="currentColor" stroke-width="2"/>`),
    tvs: (x, y) => SYM.dio(x, y, true) + `<path d="M${x - 9} ${y - 7} L${x - 12} ${y - 10} M${x + 9} ${y - 7} L${x + 12} ${y - 4}" stroke="currentColor"/>`,
    ind: (x, y) => `<path d="M${x - 18} ${y} ${[0, 1, 2, 3].map((i) => `a4.5 4.5 0 0 1 9 0`).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.8" transform="translate(0,0)"/>`,
    cmc: (x, y1, y2) => `<path d="M${x - 18} ${y1} a4.5 4.5 0 0 1 9 0 a4.5 4.5 0 0 1 9 0 a4.5 4.5 0 0 1 9 0 a4.5 4.5 0 0 1 9 0" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M${x - 18} ${y2} a4.5 4.5 0 0 0 9 0 a4.5 4.5 0 0 0 9 0 a4.5 4.5 0 0 0 9 0 a4.5 4.5 0 0 0 9 0" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="${x - 18}" y1="${y1 + 10}" x2="${x + 18}" y2="${y1 + 10}" stroke="currentColor"/><line x1="${x - 18}" y1="${y2 - 10}" x2="${x + 18}" y2="${y2 - 10}" stroke="currentColor"/>`,
    bridge: (x, y) => `<path d="M${x} ${y - 30} L${x + 30} ${y} L${x} ${y + 30} L${x - 30} ${y} Z" fill="#fff" stroke="currentColor" stroke-width="1.6"/>${[[x - 15, y - 15], [x + 15, y - 15], [x - 15, y + 15], [x + 15, y + 15]].map(([a, b], i) => `<path d="M${a - 4} ${b + (i < 2 ? 4 : -4)} L${a + 4} ${b + (i < 2 ? 4 : -4)} L${a} ${b + (i < 2 ? -3 : 3)} Z" fill="currentColor"/>`).join('')}`,
    fet: (x, y) => `<line x1="${x - 14}" y1="${y}" x2="${x - 6}" y2="${y}" stroke="currentColor" stroke-width="1.6"/><line x1="${x - 6}" y1="${y - 12}" x2="${x - 6}" y2="${y + 12}" stroke="currentColor" stroke-width="2"/><line x1="${x - 2}" y1="${y - 12}" x2="${x - 2}" y2="${y + 12}" stroke="currentColor" stroke-width="2"/><path d="M${x - 2} ${y - 9} L${x + 8} ${y - 9} L${x + 8} ${y - 18} M${x - 2} ${y + 9} L${x + 8} ${y + 9} L${x + 8} ${y + 18} M${x - 2} ${y} L${x + 8} ${y} L${x + 8} ${y + 9}" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
    ic: (x, y, w = 80, h = 36, l = '') => `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3" fill="#f1f5f9" stroke="currentColor" stroke-width="1.6"/><text x="${x}" y="${y + 4}" font-size="10" text-anchor="middle" fill="currentColor" font-weight="700">${l}</text>`,
    xfmr: (x, y1, y2) => `<path d="M${x - 8} ${y1} ${Array.from({ length: 4 }, () => 'a6 6 0 0 0 0 12').join(' ')}" fill="none" stroke="currentColor" stroke-width="1.8" transform="translate(0,${(y2 - y1 - 48) / 2})"/><path d="M${x + 14} ${y1} ${Array.from({ length: 4 }, () => 'a6 6 0 0 1 0 12').join(' ')}" fill="none" stroke="currentColor" stroke-width="1.8" transform="translate(0,${(y2 - y1 - 48) / 2})"/><line x1="${x + 2}" y1="${y1}" x2="${x + 2}" y2="${y2}" stroke="currentColor"/><line x1="${x + 6}" y1="${y1}" x2="${x + 6}" y2="${y2}" stroke="currentColor"/>`,
    opto: (x, y) => `<rect x="${x - 26}" y="${y - 18}" width="52" height="36" rx="3" fill="#fff" stroke="currentColor" stroke-width="1.6"/>${SYM.dio(x + 12, y, true).replace(/currentColor/g, 'currentColor')}<line x1="${x - 14}" y1="${y - 10}" x2="${x - 14}" y2="${y + 10}" stroke="currentColor" stroke-width="2"/><path d="M${x + 2} ${y - 4} L${x - 8} ${y - 4} M${x + 2} ${y + 4} L${x - 8} ${y + 4}" stroke="currentColor"/><text x="${x}" y="${y + 30}" font-size="9" text-anchor="middle" fill="currentColor">opto</text>`,
    leds: (x, y1, y2) => Array.from({ length: 6 }, (_, i) => SYM.dio(x, y1 + 16 + (i * (y2 - y1 - 32)) / 5, true)).join(''),
    led1: (x, y) => SYM.dio(x, y, true) + `<path d="M${x + 10} ${y - 4} l6 -6 M${x + 10} ${y + 2} l6 -6" stroke="currentColor"/>`,
    sw: (x, y) => `<circle cx="${x - 10}" cy="${y}" r="2.5" fill="currentColor"/><circle cx="${x + 10}" cy="${y}" r="2.5" fill="currentColor"/><line x1="${x - 10}" y1="${y}" x2="${x + 8}" y2="${y - 9}" stroke="currentColor" stroke-width="2"/>`,
    xlr: (x, y, l) => `<circle cx="${x}" cy="${y}" r="13" fill="#fff" stroke="currentColor" stroke-width="1.6"/>${[[-5, -3], [5, -3], [0, 5]].map(([a, b]) => `<circle cx="${x + a}" cy="${y + b}" r="2" fill="currentColor"/>`).join('')}<text x="${x}" y="${y + 26}" font-size="9" text-anchor="middle" fill="currentColor">${l}</text>`,
  };

  // ---------------------------------------------------------------- the circuits
  const STAGE_HINT = {
    input: 'Nothing at all and the fuse is open. If a new fuse blows at once, something on the primary side is shorted: MOV, X-capacitor, bridge, PFC MOSFET, boost diode, bulk capacitor or the switching MOSFET. Measure each across, mains off.',
    pfc: 'Check the DC bus (TP3). 400 V means the PFC is boosting; 325 V means it is not (light still works, but power factor is poor); 0 V means the path through the boost inductor or diode is open.',
    conv: 'DC bus is there but nothing comes out: the converter is not switching. Check the controller supply (TP4) – start-up resistor, controller, transformer, switching MOSFET.',
    out: 'Look at the output: a hiccup / blinking light and 0–3 V output points to a short on the output; flicker points to a tired output capacitor (ESR test).',
    fb: 'Blinking once a second with the output rising then collapsing = over-voltage protection: the feedback loop (opto, reference) is broken. A steady low output = the reference or the sense resistor.',
    led: 'Output voltage rises to the open-circuit limit with no current: the LED string is open. One LED shorted: the string still lights, the others work harder.',
    dali: 'Light works but does not dim or answer: the DALI interface (input bridge, opto, micro-controller, memory). If every driver on the line stopped answering, measure the DALI bus voltage – a shorted protection diode in one driver pulls the whole line down.',
    dmx: 'The 24 V is fine but the colours are wrong or missing: the decoder side – RS-485 receiver, address switches, termination, the four output MOSFETs.',
    i110: 'Light works but does not follow the 1-10 V dimmer: measure the control voltage at the driver, then the interface – current source, filter, opto.',
  };
  const P = (id, sym, x, y, name, role, stage, modes, extra) => ({ id, sym, x, y, name, role, stage, modes, ...extra });
  const powerStage = (pfc, dmx) => {
    const parts = [
      P('F1', 'fuse', 80, 90, 'F1 – input fuse 2 A T', 'Disconnects the driver if anything inside short-circuits.', 'input', { open: 'Fuse open – the driver is completely dead.' }, { look: { open: 'Fuse glass blackened – it blew on a short' }, ok: '0.1 Ω' }),
      P('RV1', 'mov', 130, 180, 'RV1 – varistor (MOV) 275 V', 'Clamps surges from the mains (lightning, switching).', 'input', { short: 'Shorted after a big surge – blows F1.' }, { v: 1, look: { short: 'MOV cracked and burnt' }, ok: 'OL' }),
      P('NTC1', 'ntc', 180, 90, 'NTC1 – inrush limiter', 'Limits the switch-on current into the bulk capacitor.', 'input', { open: 'Open – no power reaches the bridge, driver dead.' }, { look: { open: 'Cracked body' }, ok: '5 Ω (cold)' }),
      P('CX1', 'cap', 230, 180, 'CX1 – X capacitor 220 nF', 'EMI filter across the mains.', 'input', { short: 'Short across the mains – blows F1.' }, { v: 1, ok: 'OL (charges up)' }),
      P('LCM', 'cmc', 290, 180, 'LCM – common-mode choke', 'EMI filter: blocks interference going back to the mains.', 'input', { open: 'Winding open – no power to the bridge.' }, { ok: '0.4 Ω per winding' }),
      P('BR1', 'bridge', 390, 180, 'BR1 – bridge rectifier', 'Turns 230 V AC into pulsating DC.', 'input', { short: 'Diode shorted – blows F1.', open: 'Diode open – no DC bus.' }, { ok: '0.5 V each diode forward, OL reverse' }),
    ];
    if (pfc) parts.push(
      P('L1', 'ind', 460, 90, 'L1 – PFC boost inductor', 'Stores energy so the PFC can boost the bus to 400 V and draw a sinusoidal current.', 'pfc', { open: 'Open – no DC bus, driver dead.' }, { ok: '0.8 Ω' }),
      P('Q1', 'fet', 515, 180, 'Q1 – PFC MOSFET', 'Switches the boost inductor at about 60 kHz.', 'pfc', { short: 'Shorted – blows F1.', open: 'Open – PFC stops: bus only 325 V, power factor drops, light still works.' }, { look: { short: 'Burnt, cracked case' }, ok: 'D–S OL' }),
      P('D1', 'dio', 565, 90, 'D1 – boost diode (fast)', 'Passes the boosted energy to the bulk capacitor.', 'pfc', { open: 'Open – no DC bus, driver dead.', short: 'Shorted – PFC MOSFET shorts the bus, blows F1.' }, { ok: '0.6 V forward' }),
      P('U1', 'ic', 500, 345, 'U1 – PFC controller', 'Runs the PFC stage.', 'pfc', { dead: 'Dead – PFC does not boost: bus 325 V, poor power factor.' }, { w: 90, l: 'PFC CTRL', ok: '—' }),
    );
    const ox = dmx ? -120 : 0;
    parts.push(
      P('CB1', 'ecap', 615 + ox, 180, 'CB1 – bulk electrolytic 47 µF 450 V', 'Stores energy – smooths the DC bus.', 'out', { dry: 'Dried out (high ESR) – big 100 Hz ripple: flicker, the driver may not start when hot.', short: 'Shorted – blows F1.' }, { v: 1, look: { dry: 'Top vent bulging, brown residue' }, ok: '0.1 Ω ESR, 46 µF' }),
      P('R1', 'res', 655 + ox, 160, 'R1 – start-up resistor 1 MΩ', 'Gives the controller its first supply at switch-on.', 'conv', { open: 'Open – the controller never starts: bus present, no output.' }, { v: 1, ok: '1.0 MΩ' }),
      P('T1', 'xfmr', 720 + ox, 150, 'T1 – flyback transformer', 'Transfers energy across the safety isolation barrier.', 'conv', { open: 'Winding open – no output.' }, { y2: 210, ok: 'primary 1.2 Ω, secondary 0.1 Ω' }),
      P('Q2', 'fet', 715 + ox, 240, 'Q2 – switching MOSFET', 'Switches the transformer primary.', 'conv', { short: 'Shorted – blows F1.', open: 'Open – no output.' }, { look: { short: 'Burnt' }, ok: 'D–S OL' }),
      P('U3', 'ic', 660 + ox, 345, 'U3 – PWM controller', 'Runs the converter, regulates the output current, does the protections.', 'conv', { dead: 'Dead – no switching, no output.' }, { w: 90, l: 'PWM CTRL', ok: '—' }),
      P('D2', 'dio', 815 + ox, 90, 'D2 – output rectifier', 'Rectifies the transformer secondary.', 'out', { open: 'Open – no output.', short: 'Shorted – output short: hiccup, light blinks dimly.' }, { ok: '0.4 V forward' }),
      P('CO1', 'ecap', 870 + ox, 180, 'CO1 – output electrolytic 470 µF 63 V', 'Smooths the LED current.', 'out', { dry: 'Dried out – ripple on the LED current: flicker (shows on phone cameras), whining.', short: 'Shorted – output short: hiccup.' }, { v: 1, look: { dry: 'Top bulging' }, ok: '0.05 Ω ESR, 465 µF' }),
      P('U2', 'opto', 765 + ox, 345, 'U2 – feedback optocoupler', 'Tells the primary controller what the output is doing – across the isolation barrier.', 'fb', { open: 'Open – no feedback: output overshoots, over-voltage protection trips again and again – the light blinks.' }, { ok: 'LED 1.1 V forward' }),
    );
    return parts;
  };
  const ccOut = () => [
    P('RS1', 'res', 930, 270, 'RS1 – current-sense resistor 0.47 Ω', 'Measures the LED current for regulation.', 'fb', { drift: 'Value drifted high – the driver thinks the current is higher: light dim.', open: 'Open – current path broken, protection: no light.' }, { ok: '0.47 Ω' }),
    P('U4', 'ic', 985, 180, 'U4 – TL431 reference', 'Compares the sensed current with the reference.', 'fb', { short: 'Shorted – driver turns the current down: very dim.' }, { w: 44, h: 30, l: 'TL431', ok: '—' }),
    P('RT1', 'ntc', 1040, 330, 'RT1 – LED temperature sensor (NTC)', 'Dims the light if the LEDs get too hot (thermal foldback).', 'fb', { open: 'Open – reads "very hot": light at 50 % all the time.' }, { ok: '10 kΩ at 25 °C' }),
    P('LEDS', 'leds', 1095, 180, 'LED string (6 LEDs in series)', 'The light source – constant current through every LED.', 'led', { open: 'One LED open – the whole series string is off; output voltage rises to its open-circuit limit.', short: 'One LED shorted – the string still lights; the other LEDs work slightly harder.' }, { look: { open: 'One LED has a black spot' }, ok: 'Each LED glows faintly on diode test' }),
  ];
  const DALI = () => [
    P('TV1', 'tvs', 100, 430, 'TV1 – DALI input protection diode', 'Protects the interface from surges and mis-wiring.', 'dali', { short: 'Shorted – the DALI bus is shorted: the WHOLE DALI line stops working.' }, { v: 1, ok: 'OL' }),
    P('BRD', 'bridge', 170, 430, 'BRD – DALI input bridge', 'Makes the DALI input polarity-free.', 'dali', { open: 'Open – the driver does not hear DALI: stays at its power-on level.' }, { ok: 'diodes OK' }),
    P('U5', 'opto', 260, 430, 'U5 – DALI isolation opto', 'Isolates the DALI bus from the driver electronics.', 'dali', { open: 'Open – no DALI reception: no dimming, not found on a scan.' }, { ok: '—' }),
    P('U6', 'ic', 370, 430, 'U6 – micro-controller', 'Decodes DALI commands and sets the dim level.', 'dali', { dead: 'Dead – output disabled: no light.' }, { w: 90, l: 'MCU', ok: '—' }),
    P('EE1', 'ic', 480, 430, 'EE1 – memory (address, groups, scenes)', 'Keeps the short address, groups and scenes.', 'dali', { corrupt: 'Corrupt – the address and groups are lost: the driver answers only broadcast commands.' }, { w: 70, l: 'EEPROM', ok: '—' }),
  ];
  const I110 = () => [
    P('Q3', 'fet', 1080, 430, 'Q3 – 1-10 V current source', 'Pushes a small current (about 0.2 mA) into the 1-10 V line; the controller sinks it to set the voltage.', 'i110', { short: 'Shorted – the input is pulled to 10 V: always full.' }, { ok: '—' }),
    P('R10', 'res', 1010, 430, 'R10 – current-source resistor', 'Sets the source current.', 'i110', { open: 'Open – no source current: the input reads 0 V, the light stays at minimum.' }, { ok: '47 kΩ' }),
    P('CF1', 'cap', 950, 430, 'CF1 – control filter capacitor', 'Filters noise on the control line.', 'i110', { short: 'Shorted – control reads 0 V: minimum.' }, { v: 1, ok: 'OL' }),
    P('U7', 'opto', 860, 430, 'U7 – dimming opto', 'Passes the dim level across to the controller.', 'i110', { open: 'Open – the controller gets no dim signal: full light whatever the dimmer.' }, { ok: '—' }),
  ];
  const DMXD = () => [
    P('U10', 'ic', 860, 345, 'U10 – 3.3 V regulator', 'Supplies the decoder\'s micro-controller and receiver.', 'dmx', { dead: 'Dead – decoder off: all colours off.' }, { w: 60, l: '3V3 REG', ok: '—' }),
    P('U8', 'ic', 1000, 345, 'U8 – decoder micro-controller + address DIP', 'Reads its 4 channels from the DMX stream, drives the MOSFETs with PWM.', 'dmx', { addr: 'DIP switch set to the wrong address – the fixture shows another fixture\'s channels.' }, { w: 120, l: 'MCU + DIP', ok: '—' }),
    P('U9', 'ic', 860, 430, 'U9 – RS-485 receiver', 'Receives the DMX signal.', 'dmx', { dead: 'Dead – no DMX: the fixture goes dark (or holds its last colour).' }, { w: 80, l: 'RS-485', ok: '—' }),
    P('RT', 'sw', 760, 430, 'RT – 120 Ω termination switch', 'ON only in the last fixture of the line.', 'dmx', { missing: 'OFF in the last fixture – reflections: the end of the line flickers.', wrongOn: 'ON in a middle fixture – loads the line: fixtures after it get a weak signal.' }, { ok: '120 Ω when ON' }),
    P('XLR', 'xlr', 690, 430, 'DMX IN connector (pin 2 Data−, pin 3 Data+)', 'DMX input from the previous fixture.', 'dmx', { swap: 'Data+ / Data− swapped in the cable – data inverted: random colours.' }, { l: 'DMX IN', ok: 'continuity OK' }),
    ...['R', 'G', 'B', 'W'].map((c, i) => P('Q' + c, 'fet', 880 + i * 70, 240, `Q${c} – ${({ R: 'red', G: 'green', B: 'blue', W: 'white' })[c]} channel MOSFET`, `Switches the ${({ R: 'red', G: 'green', B: 'blue', W: 'white' })[c]} LEDs with PWM.`, 'dmx', { short: `Shorted – ${({ R: 'red', G: 'green', B: 'blue', W: 'white' })[c]} always full on.`, open: `Open – no ${({ R: 'red', G: 'green', B: 'blue', W: 'white' })[c]} at all.` }, { look: { short: 'Burnt mark' }, ok: 'D–S OL' })),
  ];
  const TYPES = {
    onoff: { title: 'On/Off constant-current LED driver (700 mA, 36 V, with PFC)', parts: () => [...powerStage(true), ...ccOut()], ctl: null, pfc: true },
    dali: { title: 'DALI dimmable LED driver (DT6)', parts: () => [...powerStage(true), ...ccOut(), ...DALI()], ctl: 'dali', pfc: true },
    dmx: { title: 'DMX RGBW decoder with its 24 V constant-voltage supply', parts: () => [...powerStage(false, true), ...DMXD()], ctl: 'dmx', pfc: false, cv: true },
    i110: { title: '1-10 V dimmable LED driver', parts: () => [...powerStage(true), ...ccOut(), ...I110()], ctl: '110', pfc: true },
  };

  // ---------------------------------------------------------------- what the driver does with a set of failed parts
  const BLOW = [['RV1', 'short'], ['CX1', 'short'], ['BR1', 'short'], ['Q1', 'short'], ['D1', 'short'], ['CB1', 'short'], ['Q2', 'short']];
  const blows = (F) => BLOW.some(([i, m]) => F[i] === m);
  function evalDrv(T, F, c) {
    const f = (id, m) => F[id] === m;
    const r = { lvl: 0, flick: false, blink: false, col: null, tp: {}, notes: [], bus: null };
    const blow = blows(F);
    if (T.ctl === 'dali') r.bus = f('TV1', 'short') ? 0 : 16;
    if (!c.mains) { r.tp = { TP1: '0 V', TP2: '0 V', TP3: '0 V', TP4: '0 V', TP5: '0 V', TP6: '0 mA' }; if (T.ctl === 'dali') r.tp.TPD = `${r.bus} V DC`; return r; }
    const fuse = !f('F1', 'open') && !blow;
    const inOk = fuse && !f('NTC1', 'open') && !f('LCM', 'open') && !f('BR1', 'open');
    let bus = 0;
    if (inOk) bus = T.pfc ? (f('L1', 'open') || f('D1', 'open') ? 0 : f('Q1', 'open') || f('U1', 'dead') ? 325 : 400) : 325;
    const ripple = f('CB1', 'dry');
    const run = bus > 0 && !f('R1', 'open') && !f('U3', 'dead') && !f('T1', 'open') && !f('Q2', 'open');
    r.tp.TP1 = '230 V AC'; r.tp.TP2 = fuse ? '230 V AC' : '0 V (fuse open)'; r.tp.TP3 = bus ? `${bus} V DC${ripple ? ' – 80 V of 100 Hz ripple' : ''}` : '0 V';
    const fb = f('U2', 'open'), outShort = f('D2', 'short') || f('CO1', 'short');
    r.tp.TP4 = !bus || f('R1', 'open') || f('U3', 'dead') ? '0 V' : fb || outShort ? 'cycling 9–16 V (restarting)' : '14.2 V';
    if (T.pfc) r.notes.push(bus === 325 ? 'Power factor 0.55 – the PFC is not working' : bus === 400 ? 'Power factor 0.97' : '');
    if (!run) { r.tp.TP5 = '0 V'; r.tp.TP6 = '0 mA'; return finishCtl(T, F, c, r); }
    if (T.cv) {
      if (outShort) { r.blink = true; r.lvl = 0.1; r.tp.TP5 = '0–3 V (hiccup)'; return finishCtl(T, F, c, r); }
      if (f('D2', 'open')) { r.tp.TP5 = '0 V'; return finishCtl(T, F, c, r); }
      if (fb) { r.blink = true; r.lvl = 0.6; r.tp.TP5 = 'rises to 30 V then collapses'; return finishCtl(T, F, c, r); }
      r.tp.TP5 = '24.1 V DC'; r.lvl = 1; if (ripple || f('CO1', 'dry')) r.flick = true; return finishCtl(T, F, c, r);
    }
    if (outShort) { r.blink = true; r.lvl = 0.08; r.tp.TP5 = '0–3 V (hiccup)'; r.tp.TP6 = 'pulses'; }
    else if (f('D2', 'open') || f('RS1', 'open')) { r.tp.TP5 = f('RS1', 'open') ? '0 V – protection latched' : '0 V'; r.tp.TP6 = '0 mA'; }
    else if (f('LEDS', 'open')) { r.tp.TP5 = '54 V (open-circuit limit)'; r.tp.TP6 = '0 mA'; }
    else if (fb) { r.blink = true; r.lvl = 0.7; r.tp.TP5 = 'rises to 54 V, trips, restarts'; r.tp.TP6 = 'bursts'; }
    else {
      let lvl = 1; if (f('U4', 'short')) lvl = 0.25; if (f('RS1', 'drift')) lvl *= 0.55; if (f('RT1', 'open')) { lvl *= 0.5; r.notes.push('Thermal foldback active (sensor reads hot)'); }
      if (ripple || f('CO1', 'dry')) r.flick = true;
      if (f('LEDS', 'short')) r.notes.push('One LED dark, the others slightly hotter');
      r.lvl = lvl; r.tp.TP5 = f('LEDS', 'short') ? '30.2 V' : '36.1 V'; r.tp.TP6 = `${Math.round(700 * lvl)} mA`;
    }
    return finishCtl(T, F, c, r);
  }
  function finishCtl(T, F, c, r) {
    const f = (id, m) => F[id] === m;
    if (T.ctl === 'dali') {
      r.tp.TPD = `${r.bus} V DC${r.bus === 0 ? ' – bus shorted' : ''}`;
      let d = c.level;
      if (r.bus === 0) { d = 1; r.notes.push('No DALI bus – driver at system failure level (100 %); every driver on this line is affected'); }
      else if (f('BRD', 'open') || f('U5', 'open')) { d = 1; r.notes.push('Driver does not hear DALI – stays at power-on level, not found on a scan'); }
      else if (f('EE1', 'corrupt') && c.dest !== 'bc') { d = 1; r.notes.push('Address lost – ignores address and group commands'); }
      if (f('U6', 'dead')) { d = 0; r.notes.push('Micro-controller dead – output disabled'); }
      r.lvl *= d;
    }
    if (T.ctl === '110') {
      let v = c.v110; if (f('R10', 'open') || f('CF1', 'short')) v = 0.2; if (f('Q3', 'short')) v = 10.5;
      r.tp.TPV = `${v.toFixed(1)} V DC`;
      let d = v <= 1 ? 0.1 : Math.min(1, 0.1 + ((v - 1) / 9) * 0.9); if (f('U7', 'open')) d = 1;
      r.lvl *= d;
    }
    if (T.ctl === 'dmx') {
      const on = r.lvl > 0 && !f('U10', 'dead');
      let ch = { ...c.dmx };
      if (f('U10', 'dead') || f('U9', 'dead')) ch = { r: 0, g: 0, b: 0, w: 0 };
      if (f('U8', 'addr')) ch = { r: 0.9, g: 0, b: 0.6, w: 0 };
      if (f('XLR', 'swap')) { ch = { r: Math.random(), g: Math.random(), b: Math.random(), w: 0 }; r.flick = true; }
      if (f('RT', 'missing')) r.flick = true;
      if (f('RT', 'wrongOn')) r.notes.push('This fixture is fine – the ones after it lose signal');
      ['r', 'g', 'b', 'w'].forEach((k) => { if (f('Q' + k.toUpperCase(), 'short')) ch[k] = 1; if (f('Q' + k.toUpperCase(), 'open')) ch[k] = 0; });
      r.tp.TPX = f('U9', 'dead') ? 'DMX present at the input – no data out of the receiver' : f('XLR', 'swap') ? 'Data inverted (framing errors)' : 'DMX OK, 44 frames/s';
      const lv = Math.max(ch.r, ch.g, ch.b, ch.w);
      const hx = (v) => Math.round(Math.min(1, v + ch.w * 0.85) * 255).toString(16).padStart(2, '0');
      r.col = '#' + hx(ch.r) + hx(ch.g) + hx(ch.b); r.lvl = on ? r.lvl * lv : 0;
      if (r.lvl > 0.02) r.notes.push(`Light output R ${Math.round(ch.r * 100)} % · G ${Math.round(ch.g * 100)} % · B ${Math.round(ch.b * 100)} % · W ${Math.round(ch.w * 100)} %`);
    }
    return r;
  }

  // ---------------------------------------------------------------- the workbench
  function bench(el, opt, done) {
    let type = opt.type || 'onoff', T, parts, F = {}, sel = null, mode = opt.challenge ? 'challenge' : 'explore', hidden = null, round = 0, score = 0, tries = 0, hintN = 0, log = [];
    const c = { mains: true, level: 0.6, dest: 'g1', v110: 6, dmx: { r: 0, g: 0.3, b: 1, w: 0 } };
    const setType = (k) => { type = k; T = TYPES[k]; parts = T.parts(); F = {}; sel = null; };
    setType(opt.mystery ? Object.keys(TYPES)[Math.floor(Math.random() * 4)] : type);
    const newRound = () => { if (opt.mystery) setType(Object.keys(TYPES)[Math.floor(Math.random() * 4)]); F = {}; const cand = []; parts.forEach((p) => Object.keys(p.modes).forEach((m) => cand.push([p.id, m]))); hidden = cand[Math.floor(Math.random() * cand.length)]; F[hidden[0]] = hidden[1]; tries = 0; hintN = 0; log = []; sel = null; };
    if (mode === 'challenge') newRound();
    el.innerHTML = `<div class="row" style="margin-bottom:8px">${opt.mystery ? '' : `<span class="btn s ${mode === 'explore' ? 'on' : ''}" data-m="explore">Explore – break parts yourself</span><span class="btn s ${mode === 'challenge' ? 'on' : ''}" data-m="challenge">Challenge – find the hidden failed part (3 rounds)</span>`}</div><div id="dvTop"></div><div class="panel scroll" style="margin-top:8px"><svg id="dvSch" viewBox="0 0 1180 480" style="min-width:900px;color:#334155"></svg></div><div class="two" style="margin-top:10px"><div id="dvPart" class="card" style="padding:12px"></div><div><div class="sec">Test points (mains on)</div><div id="dvTP" class="chips"></div><div class="meter" id="dvMeter"><div class="mm">— — —</div><div class="ms">Pick a test point or a part</div></div><div class="sec">Log</div><div id="dvLog" class="note"></div></div></div>`;
    el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m; el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); round = 0; score = 0; if (mode === 'challenge') newRound(); else F = {}; draw(); }));
    const meter = (a, b) => { $('dvMeter').innerHTML = `<div class="mm">${esc(a)}</div><div class="ms">${esc(b)}</div>`; log.unshift(`${b}: ${a}`); $('dvLog').innerHTML = log.slice(0, 12).map(esc).join('<br>'); };
    function draw() {
      const R = evalDrv(T, F, c);
      // top: title, controls, the light
      const glow = Math.max(0, Math.min(1, R.lvl)), col = R.col || '#fff7d6';
      $('dvTop').innerHTML = `<div class="two"><div><b>${esc(T.title)}</b>${mode === 'challenge' ? `<div class="ticket" style="margin-top:6px"><b>${opt.mystery ? 'Mystery driver' : 'Challenge'} – round ${round + 1} of 3</b> · score ${score}<div>A driver came back from site. Something inside has failed. Watch the light, use the test points, then mains off and test the parts. Replace the part you think has failed (3 tries).</div></div>` : '<p class="m" style="margin:4px 0 0">Tap any part on the circuit to read what it does and make it fail. Watch the light and the test points.</p>'}
        <div class="row" style="margin-top:8px"><span class="btn s ${c.mains ? 'on' : ''}" id="dvMains">${c.mains ? '✓ Mains ON' : 'Mains OFF'}</span>${T.ctl === 'dali' ? `<label class="inl">DALI level <input type="range" id="dvLvl" min="0" max="1" step="0.05" value="${c.level}"> ${Math.round(c.level * 100)} %</label><label class="inl">sent to <select id="dvDest"><option value="g1"${c.dest === 'g1' ? ' selected' : ''}>group 1</option><option value="bc"${c.dest === 'bc' ? ' selected' : ''}>broadcast</option></select></label>` : ''}${T.ctl === '110' ? `<label class="inl">1-10 V dimmer <input type="range" id="dvV" min="1" max="10" step="0.5" value="${c.v110}"> ${c.v110} V</label>` : ''}${T.ctl === 'dmx' ? ['r', 'g', 'b', 'w'].map((k) => `<label class="inl">${k.toUpperCase()} <input type="range" data-ch="${k}" min="0" max="1" step="0.05" value="${c.dmx[k]}" style="width:70px"></label>`).join('') : ''}${mode === 'explore' ? '<span class="btn s" id="dvFix">Repair everything</span>' : ''}</div>
        ${R.notes.filter(Boolean).length ? `<div class="note">${R.notes.filter(Boolean).map(esc).join(' · ')}</div>` : ''}</div>
        <div class="stage" style="background:#0b1220;border-radius:12px"><svg viewBox="0 0 360 150" style="display:block;width:100%"><rect x="80" y="20" width="200" height="22" rx="6" fill="#475569"/><path d="M90 42 L270 42 L320 122 L40 122 Z" fill="${col}" opacity="${0.05 + 0.6 * glow}" id="dvBeam" ${R.blink ? 'class="hic"' : R.flick ? 'class="blink"' : ''}/><rect x="90" y="40" width="180" height="6" rx="3" fill="${glow > 0.02 ? col : '#1f2937'}" ${R.blink ? 'class="hic"' : R.flick ? 'class="blink"' : ''}/><text x="180" y="146" text-anchor="middle" font-size="11" fill="#94a3b8">${glow <= 0.02 ? 'No light' : R.blink ? 'Blinking (hiccup)' : R.flick ? 'Flickering' : `Light ${Math.round(glow * 100)} %`}</text></svg></div></div><style>@keyframes hic{0%,60%{opacity:0}70%,90%{opacity:1}100%{opacity:0}}.hic{animation:hic 1.2s infinite}</style>`;
      $('dvMains').onclick = () => { c.mains = !c.mains; draw(); };
      if ($('dvLvl')) $('dvLvl').oninput = (e) => { c.level = +e.target.value; draw(); };
      if ($('dvDest')) $('dvDest').onchange = (e) => { c.dest = e.target.value; draw(); };
      if ($('dvV')) $('dvV').oninput = (e) => { c.v110 = +e.target.value; draw(); };
      el.querySelectorAll('[data-ch]').forEach((s) => (s.oninput = () => { c.dmx[s.dataset.ch] = +s.value; draw(); }));
      if ($('dvFix')) $('dvFix').onclick = () => { F = {}; draw(); };
      drawSch(R); drawPart(R); drawTP(R);
    }
    function drawSch(R) {
      let s = '';
      const cv = T.cv, ox = cv ? -120 : 0, X = (x) => x;
      // rails and wiring
      s += ln([[30, 90], [370, 90]]) + ln([[30, 270], [370, 270]]) + txt(22, 94, 'L', 12, '#a16207', 'end', 700) + txt(22, 274, 'N', 12, '#2563eb', 'end', 700);
      s += ln([[130, 90], [130, 164]]) + ln([[130, 196], [130, 270]]) + ln([[230, 90], [230, 176]]) + ln([[230, 184], [230, 270]]) + ln([[390, 90], [390, 150]]) + ln([[390, 210], [390, 270]]);
      s += ln([[420, 180], [430, 180], [430, 90], cv ? [X(655 + ox), 90] : [440, 90]], '#a16207') + ln([[360, 180], [350, 180], [350, 300], [1150, 300]], '#475569');
      if (T.pfc) s += ln([[480, 90], [545, 90]], '#a16207') + ln([[515, 90], [515, 162]]) + ln([[515, 198], [515, 300]]) + ln([[585, 90], [715, 90]], '#a16207') + ln([[500, 327], [500, 220], [500, 180]], '#7c3aed', 1.2, true);
      s += ln([[X(615 + ox), 90], [X(615 + ox), 176]]) + ln([[X(615 + ox), 186], [X(615 + ox), 300]]) + ln([[X(655 + ox), 90], [X(655 + ox), 146]]) + ln([[X(655 + ox), 174], [X(655 + ox), 327]], '#334155', 1.4);
      s += ln([[X(712 + ox), 90], [X(712 + ox), 126]]) + ln([[X(712 + ox), 200], [X(712 + ox), 222]]) + ln([[X(723 + ox), 258], [X(723 + ox), 300]]) + ln([[X(660 + ox), 327], [X(660 + ox), 240], [X(701 + ox), 240]], '#7c3aed', 1.2, true);
      s += `<line x1="${X(745 + ox)}" y1="60" x2="${X(745 + ox)}" y2="${T.ctl === 'dali' ? 370 : 470}" stroke="#dc2626" stroke-dasharray="6 5"/>` + txt(X(745 + ox), 54, 'isolation barrier', 9, '#dc2626');
      s += ln([[X(735 + ox), 90], [X(735 + ox), 80], [X(800 + ox), 80], [X(800 + ox), 90]], '#a16207') + ln([[X(830 + ox), 90], [1150, 90]], '#16a34a', 2.4) + ln([[X(870 + ox), 90], [X(870 + ox), 176]]) + ln([[X(870 + ox), 186], [X(870 + ox), 270]]) + ln([[X(735 + ox), 200], [X(735 + ox), 270], [1150, 270]], '#334155');
      s += ln([[X(765 + ox), 327], [X(765 + ox), 300]], '#7c3aed', 1.2, true) + ln([[X(705 + ox), 345], [X(739 + ox), 345]], '#7c3aed', 1.2, true);
      if (!cv) { s += ln([[1095, 90], [1095, 100]]) + ln([[1095, 260], [1095, 270]]) + ln([[985, 165], [985, 90]], '#334155', 1.2) + ln([[985, 195], [985, 270]], '#334155', 1.2) + ln([[985, 180], [960, 180], [960, 345], [791, 345]], '#7c3aed', 1.2, true) + ln([[1040, 345], [1040, 400]], '#7c3aed', 1.2, true) + txt(1150, 84, 'LED +', 10, '#16a34a', 'end') + txt(1150, 264, 'LED −', 10, '#334155', 'end'); }
      if (cv) { ['R', 'G', 'B', 'W'].forEach((k, i) => { const x = 880 + i * 70, cl = { R: '#dc2626', G: '#16a34a', B: '#2563eb', W: '#94a3b8' }[k]; s += ln([[x + 8, 90], [x + 8, 130]], cl) + `<g style="color:${cl}">${SYM.led1(x + 8, 150)}</g>` + ln([[x + 8, 160], [x + 8, 222]], cl) + ln([[x + 8, 258], [x + 8, 300]]) + ln([[x - 14, 240], [x - 24, 240], [x - 24, 330], [1000, 330]], '#7c3aed', 1.2, true); }); s += txt(1150, 84, '+24 V', 10, '#16a34a', 'end') + txt(985, 125, 'RGBW LED tape', 10, '#475569'); s += ln([[703, 430], [740, 430]]) + ln([[780, 430], [820, 430]]) + ln([[900, 430], [1000, 430], [1000, 363]], '#7c3aed', 1.2, true) + ln([[860, 327], [860, 300]]); }
      if (T.ctl === 'dali') { s += txt(40, 424, 'DA+', 10, '#7c3aed', 'end', 700) + txt(40, 444, 'DA−', 10, '#7c3aed', 'end', 700) + ln([[45, 420], [140, 420]], '#7c3aed') + ln([[45, 440], [140, 440]], '#7c3aed') + ln([[200, 430], [234, 430]], '#7c3aed') + ln([[286, 430], [325, 430]], '#7c3aed') + ln([[415, 430], [445, 430]], '#7c3aed') + ln([[370, 412], [370, 398], [640, 398], [640, 363]], '#7c3aed', 1.2, true) + txt(540, 393, 'dim level → PWM controller', 9, '#7c3aed'); }
      if (T.ctl === '110') { s += txt(1150, 424, 'DIM+', 10, '#7c3aed', 'end', 700) + txt(1150, 444, 'DIM−', 10, '#7c3aed', 'end', 700) + ln([[1100, 430], [1120, 430]], '#7c3aed') + ln([[1020, 430], [1066, 430]], '#7c3aed') + ln([[960, 430], [1000, 430]], '#7c3aed') + ln([[886, 430], [940, 430]], '#7c3aed') + ln([[834, 430], [640, 430], [640, 363]], '#7c3aed', 1.2, true) + txt(740, 424, 'dim level → PWM controller', 9, '#7c3aed'); }
      ['TP1', 'TP2', 'TP3', 'TP4', 'TP5', 'TP6', 'TPD', 'TPV', 'TPX'].forEach((k) => { const at = { TP1: [50, 90], TP2: [105, 90], TP3: [X(615 + ox), 110], TP4: [X(660 + ox), 315], TP5: [cv ? 1060 : 1060, 90], TP6: [930, 286], TPD: [60, 460], TPV: [1130, 460], TPX: [720, 460] }[k]; if (!at || (k === 'TPD' && T.ctl !== 'dali') || (k === 'TPV' && T.ctl !== '110') || (k === 'TPX' && T.ctl !== 'dmx') || (k === 'TP6' && cv)) return; s += `<circle cx="${at[0]}" cy="${at[1]}" r="6" fill="#B0D035" stroke="#14161c" data-tp="${k}" style="cursor:pointer"/><text x="${at[0] + 8}" y="${at[1] - 6}" font-size="9" fill="#4d7c0f" font-weight="700">${k}</text>`; });
      // parts
      parts.forEach((p) => {
        const bad = mode === 'explore' && F[p.id], isSel = sel === p.id, col = bad ? '#dc2626' : isSel ? '#244286' : '#334155';
        let g = '';
        if (p.sym === 'cmc') g = SYM.cmc(p.x, 90, 270);
        else if (p.sym === 'xfmr') g = SYM.xfmr(p.x, 100, 210);
        else if (p.sym === 'leds') g = SYM.leds(p.x, 90, 270);
        else if (p.sym === 'ic') g = SYM.ic(p.x, p.y, p.w || 80, p.h || 36, p.l || p.id);
        else if (p.sym === 'xlr') g = SYM.xlr(p.x, p.y, p.l);
        else g = SYM[p.sym](p.x, p.y, p.v);
        const bb = p.sym === 'leds' ? [p.x - 18, 95, 36, 170] : p.sym === 'cmc' ? [p.x - 22, 80, 44, 200] : p.sym === 'xfmr' ? [p.x - 14, 96, 44, 120] : p.sym === 'ic' ? [p.x - (p.w || 80) / 2 - 4, p.y - (p.h || 36) / 2 - 4, (p.w || 80) + 8, (p.h || 36) + 8] : [p.x - 22, p.y - 22, 44, 44];
        s += `<g style="color:${col}">${g}</g>${txt(p.sym === 'ic' ? p.x : p.x + (p.v ? 22 : 0), p.sym === 'ic' ? p.y + (p.h || 36) / 2 + 12 : p.sym === 'xlr' ? p.y - 18 : p.sym === 'leds' ? 284 : p.sym === 'cmc' ? 290 : p.y + (p.v ? 4 : 22), p.id, 9, col, p.v ? 'start' : 'middle', 700)}<rect x="${bb[0]}" y="${bb[1]}" width="${bb[2]}" height="${bb[3]}" fill="${isSel ? 'rgba(36,66,134,.08)' : 'transparent'}" stroke="${isSel ? '#244286' : 'none'}" rx="6" data-p="${p.id}" style="cursor:pointer"><title>${esc(p.name)}</title></rect>`;
      });
      $('dvSch').innerHTML = s;
      $('dvSch').querySelectorAll('[data-p]').forEach((n) => (n.onclick = () => { sel = n.dataset.p; draw(); }));
      $('dvSch').querySelectorAll('[data-tp]').forEach((n) => (n.onclick = () => { const k = n.dataset.tp; meter(R.tp[k] ?? '—', `${k} ${TPNAME[k]}`); }));
      void R;
    }
    const TPNAME = { TP1: 'mains input', TP2: 'after the fuse', TP3: 'DC bus (bulk capacitor)', TP4: 'controller supply Vcc', TP5: 'output voltage', TP6: 'LED current', TPD: 'DALI bus', TPV: '1-10 V control', TPX: 'DMX signal at the receiver' };
    function drawTP(R) { const keys = ['TP1', 'TP2', 'TP3', 'TP4', 'TP5'].concat(T.cv ? [] : ['TP6']).concat(T.ctl === 'dali' ? ['TPD'] : T.ctl === '110' ? ['TPV'] : T.ctl === 'dmx' ? ['TPX'] : []); $('dvTP').innerHTML = keys.map((k) => `<span class="btn s" data-tpb="${k}">${k} · ${TPNAME[k]}</span>`).join(''); $('dvTP').querySelectorAll('[data-tpb]').forEach((b) => (b.onclick = () => meter(R.tp[b.dataset.tpb] ?? '—', `${b.dataset.tpb} ${TPNAME[b.dataset.tpb]}`))); }
    function drawPart() {
      const box = $('dvPart');
      if (!sel) { box.innerHTML = `<p class="m" style="margin:0">${mode === 'explore' ? 'Tap a part on the circuit.' : 'Watch the light and measure the test points first. Then switch the mains OFF and test the suspect parts.'}</p>${mode === 'challenge' ? hintBtn() : ''}`; bindHint(); return; }
      const p = parts.find((x) => x.id === sel), f = F[p.id];
      if (mode === 'explore') {
        box.innerHTML = `<b>${esc(p.name)}</b><p style="margin:4px 0">${esc(p.role)}</p><div class="chips">${Object.entries(p.modes).map(([m, d]) => `<span class="btn s ${f === m ? 'red' : ''}" data-fail="${m}">${f === m ? '✓ ' : ''}Fail: ${({ open: 'open', short: 'short', dry: 'dried out', drift: 'drifted', dead: 'dead', corrupt: 'corrupt', addr: 'wrong address', missing: 'termination off', wrongOn: 'termination on mid-line', swap: 'swapped' })[m] || m}</span>`).join('')}${f ? '<span class="btn s" data-fail="">Repair</span>' : ''}</div><div class="note">${Object.entries(p.modes).map(([m, d]) => `<b>${m}:</b> ${esc(d)}`).join('<br>')}</div>`;
        box.querySelectorAll('[data-fail]').forEach((b) => (b.onclick = () => { if (b.dataset.fail) { F[p.id] = b.dataset.fail; } else delete F[p.id]; draw(); }));
      } else {
        box.innerHTML = `<b>${esc(p.name)}</b><p style="margin:4px 0">${esc(p.role)}</p><div class="chips"><span class="btn s" data-t="look">Look</span><span class="btn s" data-t="ohm">Resistance / diode test (mains off)</span>${p.sym === 'ecap' ? '<span class="btn s" data-t="esr">ESR and capacitance (mains off)</span>' : ''}<span class="btn s p" data-t="rep">Replace this part (${3 - tries} tries left)</span></div>${hintBtn()}`;
        box.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => test(p, b.dataset.t)));
        bindHint();
      }
    }
    const hintBtn = () => (mode === 'challenge' ? `<div class="row" style="margin-top:8px"><span class="btn s" id="dvHint">💡 Hint</span><span class="note" id="dvHintT"></span></div>` : '');
    const bindHint = () => { if (!$('dvHint')) return; $('dvHint').onclick = () => { const p = parts.find((x) => x.id === hidden[0]); hintN++; $('dvHintT').textContent = hintN === 1 ? STAGE_HINT[p.stage] : `Look closely at the ${p.stage === 'input' ? 'input stage' : p.stage === 'led' ? 'LED string' : 'part'}: ${p.name.split(' – ')[1] || p.name}.`; }; };
    function test(p, k) {
      const f = F[p.id] || (p.id === 'F1' && blows(F) ? 'open' : null);
      if (k === 'look') { meter((p.look && f && p.look[f]) || 'Looks normal', `Look · ${p.id}`); return; }
      if (k === 'ohm') { if (c.mains) { meter('⚠ Switch the mains OFF first (and let the bulk capacitor discharge)', `Resistance · ${p.id}`); return; } meter(f === 'short' ? '0.3 Ω – short circuit' : f === 'open' ? 'OL – open circuit' : f === 'drift' ? '1.4 Ω (should be 0.47 Ω)' : p.ok || 'as expected', `Resistance · ${p.id}`); return; }
      if (k === 'esr') { if (c.mains) { meter('⚠ Mains OFF first', `ESR · ${p.id}`); return; } meter(f === 'dry' ? 'ESR 9.6 Ω · 31 % of rated µF – dried out' : f === 'short' ? 'Short circuit' : p.ok, `ESR · ${p.id}`); return; }
      if (k === 'rep') {
        tries++;
        const blewAgain = p.id === 'F1' && hidden[0] !== 'F1' && blows(F);
        if (blewAgain) meter('✗ The new fuse blew the moment the mains came on – something on the primary side is still shorted', 'Replaced F1');
        if (p.id === hidden[0]) { score++; meter(`✓ Correct – ${p.name} had failed (${hidden[1]}). ${p.modes[hidden[1]]}`, 'Replaced'); nextRound(); }
        else if (tries >= 3) { const h = parts.find((x) => x.id === hidden[0]); meter(`✗ Out of tries – it was ${h.name} (${hidden[1]}): ${h.modes[hidden[1]]}`, 'Replaced'); nextRound(); }
        else { if (!blewAgain) meter(`✗ ${p.id} was fine – the fault is still there`, 'Replaced'); drawPart(); }
      }
    }
    function nextRound() {
      round++;
      if (round >= 3) { const b = $('dvPart'); b.innerHTML = `${kpi([[`${score} / 3`, 'parts found', score < 2]])}<p>${score >= 2 ? 'Passed ✓' : 'Not yet – 2 of 3 passes. Explore mode shows what each failure looks like.'}</p><span class="btn p" id="dvAgain">Play again</span>`; $('dvAgain').onclick = () => { round = 0; score = 0; newRound(); draw(); }; if (done) done(score, 3); return; }
      setTimeout(() => { if (!stopped) { newRound(); draw(); } }, 2200);
    }
    let stopped = false; onStop(() => (stopped = true));
    draw();
  }
  W.driver = bench;
  window.__DRV = { SYM, ln, txt };
  work('driver', 'd_onoff', '💡', 'On/Off constant-current driver', 'Input filter, PFC, flyback converter, feedback, LED string', 'driver', { type: 'onoff' });
  work('driver', 'd_dali', '🎛️', 'DALI dimmable driver', 'Power stage + DALI interface: bridge, opto, micro-controller, memory', 'driver', { type: 'dali' });
  work('driver', 'd_dmx', '🌈', 'DMX RGBW decoder and 24 V supply', 'RS-485 receiver, address, termination, four PWM MOSFETs', 'driver', { type: 'dmx' });
  work('driver', 'd_110', '🎚️', '1-10 V dimmable driver', 'Power stage + 1-10 V interface: current source, filter, opto', 'driver', { type: 'i110' });
  work('driver', 'd_mystery', '❓', 'Mystery drivers – random type, random fault', 'Three drivers back from site: find the failed part in each', 'driver', { mystery: true, challenge: true });
})();
