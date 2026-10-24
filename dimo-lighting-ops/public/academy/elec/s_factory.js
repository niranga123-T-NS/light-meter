/* Troubleshooting – Factories: warehouse distribution and high-bays, motor starters (DOL and star-delta), VFD pump on an RCD */
(function () {
  const t = (x, y, w, h, l) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#16213e" stroke="#475569"/><text x="${x + 8}" y="${y + 16}" fill="#94a3b8" font-size="11">${l}</text>`;

  // ================================================================ warehouse distribution and high-bays
  scen('factory', 'f_ware', '🏬', {
    title: 'Warehouse – sub-main and high-bay lighting', sub: 'MCCB sub-main to a lighting DB, three high-bay rows on L1/L2/L3 with contactors and a time switch', earthing: 'TN-S', ze: 0.1,
    brief: 'Logistics centre: night-shift complaints about the high-bay lighting in aisles A–C.',
    inputs: [{ k: 'time', label: 'Time', type: 'range', min: 0, max: 23.5, step: 0.5, v: 22, fmt: (v) => EF.fmtT(+v) }, { k: 'man', label: 'Override switch', type: 'select', opts: [['auto', 'AUTO'], ['on', 'ON'], ['off', 'OFF']], v: 'auto' }],
    els: [
      { id: 'SUP', kind: 'supply', ph: '3P', name: 'Factory substation 400 V' }, { id: 'MSB', kind: 'board', parent: 'SUP', ph: '3P', name: 'Main switchboard' },
      { id: 'MC', kind: 'mccb', parent: 'MSB', ph: '3P', rating: 63, name: 'Sub-main MCCB 63 A' }, { id: 'SM', kind: 'cable', parent: 'MC', ph: '3P', len: 120, size: 16, name: 'Sub-main SWA 4C 16 mm²' },
      { id: 'LDB', kind: 'board', parent: 'SM', ph: '3P', name: 'Lighting DB (warehouse)', metal: true },
      { id: 'TS', kind: 'timer', parent: 'LDB', ph: 'L1', in: 'time', prog: [18, 7], name: 'Lighting time switch', short: 'TIMER' },
      { id: 'MA', kind: 'mcb', parent: 'LDB', ph: 'L1', rating: 16, curve: 'C', name: 'Aisle A MCB (L1)' }, { id: 'KA', kind: 'contactor', parent: 'MA', coil: 'TS', manual: 'man', name: 'Aisle A contactor' }, { id: 'CA', kind: 'cable', parent: 'KA', len: 60, size: 2.5, name: 'Aisle A cable' }, { id: 'A1', kind: 'lum', parent: 'CA', w: 150, name: 'High-bay A1', metal: true }, { id: 'A2', kind: 'lum', parent: 'CA', w: 150, name: 'High-bay A2', metal: true },
      { id: 'MB', kind: 'mcb', parent: 'LDB', ph: 'L2', rating: 16, curve: 'C', name: 'Aisle B MCB (L2)' }, { id: 'KB', kind: 'contactor', parent: 'MB', coil: 'TS', manual: 'man', name: 'Aisle B contactor' }, { id: 'CB', kind: 'cable', parent: 'KB', len: 60, size: 2.5, name: 'Aisle B cable' }, { id: 'B1', kind: 'lum', parent: 'CB', w: 150, name: 'High-bay B1', metal: true }, { id: 'B2', kind: 'lum', parent: 'CB', w: 150, name: 'High-bay B2', metal: true },
      { id: 'MCc', kind: 'mcb', parent: 'LDB', ph: 'L3', rating: 16, curve: 'C', name: 'Aisle C MCB (L3)' }, { id: 'KC', kind: 'contactor', parent: 'MCc', coil: 'TS', manual: 'man', name: 'Aisle C contactor' }, { id: 'CC', kind: 'cable', parent: 'KC', len: 60, size: 2.5, name: 'Aisle C cable' }, { id: 'C1', kind: 'lum', parent: 'CC', w: 150, name: 'High-bay C1', metal: true }, { id: 'C2', kind: 'lum', parent: 'CC', w: 150, name: 'High-bay C2', metal: true },
    ],
    pool: [
      { id: 'phase', el: 'SUP', mode: 'lost', val: 'L2', say: 'Aisle B completely dark', title: 'Lost phase L2 on the sub-main', hint: 'Measure L–N of each phase at the lighting DB, then at the MCCB.', why: 'One phase missing – every circuit on L2 is dead.', fix: 'Trace upstream: MCCB pole, cable joint or busbar connection.' },
      { id: 'nbar', el: 'LDB', mode: 'hrN', say: 'High-bays in all aisles flicker and some look brighter than others', title: 'Loose neutral bar connection in the lighting DB (shared neutral)', look: 'Sub-main neutral lug loose, discoloured', hint: 'All aisles flicker together. Thermal camera on the DB, voltage L–N on each phase under load.', why: 'With a high-resistance shared neutral, the star point floats – phase voltages become unequal and drivers flicker or fail.', fix: 'Re-terminate and torque the neutral; check drivers for damage from overvoltage.' },
      { id: 'kb', el: 'KB', mode: 'coilOpen', say: 'Aisle B dark at night', title: 'Aisle B contactor coil open', hint: 'Is the timer output on? Coil voltage and resistance of KB.', why: 'The coil gets its command but cannot pull in.', fix: 'Replace the contactor.' },
      { id: 'clock', el: 'TS', mode: 'clock', say: 'Lights go off in the middle of the night shift and come on during the day', title: 'Time switch clock 12 hours out (reset after a power cut)', hint: 'Read the time switch clock and program.', why: 'The clock lost its time after a power cut.', fix: 'Set the clock; fit a time switch with a reserve battery or GPS / astronomical clock.' },
      { id: 'a2', el: 'A2', mode: 'dead', title: 'High-bay A2 driver failed', hint: 'One fitting out – voltage at it?', why: 'Driver failed.', fix: 'Replace the driver (use a MEWP – work at height permit).' },
      { id: 'under', el: 'MC', mode: 'under', say: 'The sub-main MCCB trips after the lights have been on for a while', title: 'MCCB overload setting (Ir) too low for the sub-main load', look: 'Ir dial at 0.4 × In', hint: 'Clamp the sub-main current and compare with the Ir setting.', why: 'The overload setting is below the normal load.', fix: 'Set Ir for the design current and cable (check discrimination with upstream).' },
      { id: 'cpc', el: 'CC', mode: 'openE', title: 'CPC open in the aisle C cable – metal high-bays unearthed', hint: 'Zs at the high-bays.', why: 'No earth path for the Class I fittings.', fix: 'Repair the CPC; on SWA check the gland earth tags.' },
      { id: 'weld', el: 'KA', mode: 'welded', say: 'Aisle A lights stay on in the daytime', title: 'Aisle A contactor welded', hint: 'Set the override to OFF – does aisle A go off?', why: 'Welded contacts.', fix: 'Replace the contactor (check rating for LED driver inrush).' },
    ],
    site: { w: 720, h: 320, bg: t(20, 20, 680, 280, 'Warehouse') + '<line x1="250" y1="40" x2="250" y2="290" stroke="#334155" stroke-width="8"/><line x1="480" y1="40" x2="480" y2="290" stroke="#334155" stroke-width="8"/>', at: { A1: [130, 100, 'A1'], A2: [130, 220, 'A2'], B1: [360, 100, 'B1'], B2: [360, 220, 'B2'], C1: [590, 100, 'C1'], C2: [590, 220, 'C2'], LDB: [660, 290, 'LDB'] } },
  });

  // ================================================================ motor starters – DOL conveyor and star-delta compressor
  const sd = (st, F, msg) => { if (st.tripped.has('MK')) { msg('Compressor MCB is tripped – reset it first'); return; } if (F(st, 'KS', 'sdTimer')) { st.tripped.add('MK'); st.tripWhy.MK = 'Overcurrent at changeover'; msg('Star… delta after 0.5 s – BANG, the compressor MCB trips'); return; } st.latch.KS = true; msg('Starts in star, changes to delta after 8 s – running'); };
  scen('factory', 'f_motor', '⚙️', {
    title: 'Production line – motor starters', sub: 'DOL conveyor with overload relay and hold-in contact, star-delta compressor, emergency stop', earthing: 'TN-S', ze: 0.12,
    brief: 'Production supervisor: the line will not run properly. MCC panel in the plant room.',
    inputs: [{ k: 'cstart', type: 'btn', label: '▶ Conveyor START', act: (st, R, F, msg) => { if (F(st, 'KV', 'auxFail')) { st.latch.KV = false; msg('Conveyor runs only while START is held'); } else st.latch.KV = true; } }, { k: 'cstop', type: 'btn', label: '■ Conveyor STOP', act: (st) => { st.latch.KV = false; } }, { k: 'kstart', type: 'btn', label: '▶ Compressor START', act: (st, R, F, msg) => sd(st, F, msg) }, { k: 'kstop', type: 'btn', label: '■ Compressor STOP', act: (st) => { st.latch.KS = false; } }, { k: 'es', label: 'Emergency stop released', v: true }],
    els: [
      { id: 'SUP', kind: 'supply', ph: '3P', name: 'Supply 400 V' }, { id: 'MCC', kind: 'board', parent: 'SUP', ph: '3P', name: 'Motor control centre', metal: true },
      { id: 'MV', kind: 'mcb', parent: 'MCC', ph: '3P', rating: 16, curve: 'D', name: 'Conveyor MCB' }, { id: 'ES', kind: 'switch', parent: 'MV', in: 'es', name: 'Emergency stop (NC contact)' }, { id: 'OV', kind: 'olr', parent: 'ES', motor: 'CV', name: 'Conveyor overload relay' }, { id: 'KV', kind: 'contactor', parent: 'OV', latch: true, on: true, olr: 'OV', name: 'Conveyor DOL contactor' }, { id: 'CV1', kind: 'cable', parent: 'KV', len: 40, size: 2.5, name: 'Conveyor motor cable' }, { id: 'CV', kind: 'motor', parent: 'CV1', ph: '3P', kw: 4, name: 'Conveyor motor 4 kW', metal: true },
      { id: 'MK', kind: 'mccb', parent: 'MCC', ph: '3P', rating: 63, name: 'Compressor MCCB' }, { id: 'OK', kind: 'olr', parent: 'MK', motor: 'CP', name: 'Compressor overload' }, { id: 'KS', kind: 'contactor', parent: 'OK', latch: true, on: true, olr: 'OK', name: 'Star-delta starter' }, { id: 'CK', kind: 'cable', parent: 'KS', len: 25, size: 10, name: 'Compressor cables (6-wire)' }, { id: 'CP', kind: 'motor', parent: 'CK', ph: '3P', kw: 22, name: 'Air compressor 22 kW', metal: true },
    ],
    pool: [
      { id: 'olset', el: 'OV', mode: 'setLow', say: 'Conveyor stops after a few minutes', title: 'Conveyor overload set too low', hint: 'Read the overload dial and the motor nameplate.', why: 'Set below full-load current – trips a healthy motor.', fix: 'Set to the nameplate current.' },
      { id: 'aux', el: 'KV', mode: 'auxFail', say: 'The conveyor will not keep running after START', title: 'Conveyor contactor hold-in (auxiliary) contact faulty', hint: 'STOP, then START: what happens when you let go?', why: 'Without the hold-in contact the coil drops out when START is released.', fix: 'Replace the auxiliary block.' },
      { id: 'es', el: 'ES', mode: 'stuckOff', say: 'Conveyor will not start at all – E-stop is released', title: 'Emergency stop NC contact block faulty (open)', look: 'Contact block clipped on loosely – contact open', hint: 'Voltage across the E-stop contact with it released.', why: 'The safety contact never closes – correct fail-safe behaviour, but the device is faulty.', fix: 'Replace the contact block; test the E-stop function.' },
      { id: 'phase', el: 'SUP', mode: 'lost', val: 'L1', say: 'Motors hum and trip', title: 'Lost phase L1 at the MCC', hint: 'Motor current on each phase; voltage at the MCC.', why: 'Single-phasing – motors hum, draw high current and trip on overload (or burn out if the overload is wrong).', fix: 'Find the missing phase; fit a phase-failure relay.' },
      { id: 'sd', el: 'KS', mode: 'sdTimer', say: 'Compressor MCCB trips when it changes from star to delta', title: 'Star-delta timer set too short (0.5 s)', look: 'Timer dial at 0.5 s', hint: 'STOP then START the compressor. When does it trip?', why: 'Changing to delta before the motor has run up draws a huge current.', fix: 'Set the timer so the motor reaches about 80 % speed in star (typically 5–10 s).' },
      { id: 'olh', el: 'OK', mode: 'setHigh', title: 'Compressor overload set far above the motor current', hint: 'Read the overload setting.', why: 'The motor is not protected against overload or single-phasing.', fix: 'Set to the nameplate current.' },
      { id: 'cv', el: 'CV', mode: 'faultLE', say: 'Conveyor MCB trips when it starts', title: 'Conveyor motor winding earth fault', hint: 'Insulation-test the motor and its cable separately.', why: 'Winding insulation broken down to the frame.', fix: 'Rewind / replace the motor.' },
      { id: 'hr', el: 'CK', mode: 'hrL', title: 'Loose terminal at the compressor motor terminal box – overheating', look: 'Terminal discoloured', hint: 'Thermal camera on the motor cables.', why: 'High-resistance joint carrying 40 A.', fix: 'Remake and torque the terminals.' },
    ],
    site: { w: 720, h: 300, bg: t(20, 20, 680, 260, 'Production hall'), at: { CV: [180, 130, 'Conveyor'], CP: [520, 130, 'Compressor'], ES: [180, 240, 'E-stop'], MCC: [360, 240, 'MCC'] } },
    demo: { title: 'conveyor will not keep running', sub: 'Motor control: the hold-in contact', faults: ['aux'], in: {}, steps: [
      { say: 'Press <b>STOP</b> on the conveyor (in the Operate bar).', act: 'input:cstop' },
      { say: 'Now press <b>START</b>.', act: 'input:cstart' },
      { say: 'It runs only while START is held. Check the coil supply: tap the <b>conveyor contactor</b> and measure the <b>coil voltage</b>.', act: 'test:coilv:KV' },
      { say: '0 V once START is released – nothing holds the coil in. That is the job of the auxiliary (hold-in) contact. Tick it and submit.', act: 'diag' },
    ] },
  });

  // ================================================================ VFD pump on an RCD
  scen('factory', 'f_vfd', '🌀', {
    title: 'Process pump on a variable speed drive', sub: 'VFD-fed 7.5 kW pump, RCD protection, motor cable, the drive\'s own trips', earthing: 'TN-S', ze: 0.15,
    brief: 'Water treatment plant: the transfer pump keeps stopping. The VFD is in panel P3.',
    inputs: [{ k: 'run', label: 'Pump run command', v: true }],
    els: [
      { id: 'SUP', kind: 'supply', ph: '3P', name: 'Supply 400 V' }, { id: 'P3', kind: 'board', parent: 'SUP', ph: '3P', name: 'Panel P3', metal: true },
      { id: 'RC', kind: 'rcd', parent: 'P3', ph: '3P', idn: 300, name: 'RCD 300 mA (fire protection)' }, { id: 'MP', kind: 'mcb', parent: 'RC', ph: '3P', rating: 25, curve: 'C', name: 'VFD supply MCB' },
      { id: 'VFD', kind: 'cable', parent: 'MP', ph: '3P', len: 1, size: 4, name: 'Variable speed drive (VFD)', short: 'VFD', tests: [['vfd', 'VFD display / fault log', 'Special', (st, R, e, F) => (F(st, e.id, 'overV') ? 'Trip F0002 – DC bus overvoltage during stop' : R.lost.size ? 'Trip F0021 – input phase loss' : F(st, 'PM', 'faultLE') ? 'Trip F0013 – earth fault on the output' : 'Ready / running 48 Hz')]] },
      { id: 'MC', kind: 'cable', parent: 'VFD', ph: '3P', len: 80, size: 4, name: 'Screened motor cable' }, { id: 'PM', kind: 'motor', parent: 'MC', ph: '3P', in: 'run', kw: 7.5, drive: true, name: 'Transfer pump 7.5 kW', metal: true },
    ],
    pool: [
      { id: 'type', el: 'RC', mode: 'nuisance', say: 'The RCD trips when the pump starts', title: 'Wrong RCD type (Type AC) for a VFD – trips on the drive\'s leakage and DC components', look: 'RCD marked Type AC', hint: 'Read the RCD type; leakage clamp on the VFD supply while running.', why: 'VFDs leak high-frequency current through their filters and can produce smooth DC residual current – a Type AC RCD misreads it (or is blinded by it).', fix: 'Fit a Type B RCD (as the drive maker requires); check the drive\'s filter earth.' },
      { id: 'phase', el: 'SUP', mode: 'lost', val: 'L3', say: 'Pump stops, VFD shows a fault', title: 'Input phase loss to the VFD', hint: 'Read the VFD fault log; measure the three input phases.', why: 'The drive detects input phase loss and trips to protect its DC bus.', fix: 'Restore the missing phase.' },
      { id: 'earth', el: 'PM', mode: 'faultLE', say: 'Pump stops, VFD shows a fault', title: 'Earth fault in the pump motor (water in the terminal box)', look: 'Water in the motor terminal box', hint: 'VFD fault log; insulation-test the motor and cable with the VFD disconnected (never megger through a drive).', why: 'The drive detects output earth current.', fix: 'Dry / repair the motor, seal the gland.' },
      { id: 'ov', el: 'VFD', mode: 'overV', say: 'VFD trips when the pump is stopped', title: 'VFD DC-bus overvoltage on stop – deceleration ramp too short', hint: 'Read the VFD fault log.', why: 'Fast deceleration of a high-inertia load regenerates energy into the drive.', fix: 'Lengthen the decel ramp or fit a braking resistor.' },
      { id: 'hr', el: 'MC', mode: 'hrL', title: 'Loose terminal at the motor', hint: 'Thermal camera with the pump running.', why: 'High resistance – heat.', fix: 'Remake and torque.' },
      { id: 'scr', el: 'MC', mode: 'openE', excl: ['hr'], title: 'Motor cable screen / CPC not terminated at the drive', hint: 'R1+R2 / continuity of the CPC to the motor frame.', why: 'Without the screen and CPC bonded at both ends, EMC and earth-fault protection suffer.', fix: 'Terminate the screen with a 360° EMC gland at both ends.' },
    ],
    site: { w: 720, h: 260, bg: t(20, 20, 680, 220, 'Pump house'), at: { PM: [520, 130, 'Pump'], P3: [160, 130, 'Panel P3'] } },
  });
})();
