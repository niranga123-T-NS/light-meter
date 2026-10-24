/* Troubleshooting – Residence: consumer unit and RCD trips, lighting circuits, sockets and kitchen, shower / water heater / garden */
(function () {
  const t = (x, y, w, h, l) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#16213e" stroke="#475569"/><text x="${x + 8}" y="${y + 16}" fill="#94a3b8" font-size="11">${l}</text>`;

  // ================================================================ consumer unit – RCD trips
  scen('home', 'r_cu', '🧰', {
    title: 'Consumer unit – the RCD keeps tripping', sub: 'Split-load board with two RCDs, immersion heater, washing machine, home office', earthing: 'TN-C-S', ze: 0.28,
    brief: 'Home owner: "Half the house goes off several times a day." Dual-RCD consumer unit under the stairs.',
    inputs: [{ k: 'wash', label: 'Washing machine running', v: false }, { k: 'imm', label: 'Immersion heater on', v: true }, { k: 'pc', label: 'Office computers on', v: true }, { k: 'lights', label: 'Lights on', v: true }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-C-S)' }, { id: 'CU', kind: 'board', parent: 'SUP', name: 'Consumer unit', metal: true }, { id: 'MS', kind: 'isolator', parent: 'CU', name: 'Main switch 100 A' },
      { id: 'RCD1', kind: 'rcd', parent: 'MS', idn: 30, name: 'RCD 1 (30 mA)' }, { id: 'RCD2', kind: 'rcd', parent: 'MS', idn: 30, name: 'RCD 2 (30 mA)' },
      { id: 'M1', kind: 'mcb', parent: 'RCD1', rating: 6, curve: 'B', name: 'Lights downstairs' }, { id: 'C1', kind: 'cable', parent: 'M1', len: 25, size: 1.5, name: 'Lighting cable' }, { id: 'SW1', kind: 'switch', parent: 'C1', in: 'lights', name: 'Light switches' }, { id: 'L1', kind: 'lum', parent: 'SW1', w: 40, name: 'Living room lights' }, { id: 'L2', kind: 'lum', parent: 'SW1', w: 30, name: 'Kitchen lights' },
      { id: 'M2', kind: 'mcb', parent: 'RCD1', rating: 16, curve: 'B', name: 'Immersion heater' }, { id: 'C2', kind: 'cable', parent: 'M2', len: 15, size: 2.5, name: 'Immersion cable' }, { id: 'IMM', kind: 'heater', parent: 'C2', in: 'imm', w: 3000, name: 'Immersion heater', metal: true },
      { id: 'M3', kind: 'mcb', parent: 'RCD2', rating: 32, curve: 'B', name: 'Sockets – utility room' }, { id: 'C3', kind: 'cable', parent: 'M3', len: 20, size: 2.5, name: 'Utility socket cable' }, { id: 'WM', kind: 'motor', parent: 'C3', in: 'wash', kw: 0.5, drive: true, name: 'Washing machine', metal: true },
      { id: 'M4', kind: 'mcb', parent: 'RCD2', rating: 20, curve: 'B', name: 'Sockets – home office' }, { id: 'C4', kind: 'cable', parent: 'M4', len: 18, size: 2.5, name: 'Office socket cable' }, { id: 'J4', kind: 'jb', parent: 'C4', name: 'Office desk sockets' }, { id: 'PC', kind: 'socket', parent: 'J4', in: 'pc', w: 600, name: 'Computers and printers' },
      { id: 'M5', kind: 'mcb', parent: 'RCD2', rating: 6, curve: 'B', name: 'Lights upstairs' }, { id: 'C5', kind: 'cable', parent: 'M5', len: 22, size: 1.5, name: 'Upstairs lighting cable' }, { id: 'L3', kind: 'lum', parent: 'C5', in: 'lights', w: 40, name: 'Bedroom lights' },
    ],
    pool: [
      { id: 'ne', el: 'C2', mode: 'faultNE', say: 'RCD 1 trips whenever the lights or the immersion are on', title: 'Neutral–earth fault in the immersion heater cable', look: 'Cable crushed under a floorboard nail', hint: 'Switch MCBs off one at a time under RCD 1 and see when it holds. Then insulation-test N–E of that circuit, dead and locked off.', why: 'Part of the neutral current returns through the earth, so the RCD sees a difference between L and N whenever load current flows on any circuit under it.', fix: 'Replace the damaged cable; never just move the circuit to the other RCD.' },
      { id: 'wm', el: 'WM', mode: 'faultLE', say: 'RCD 2 trips when the washing machine starts heating', title: 'Washing machine heater earth fault', hint: 'Run the washing machine. Then insulation-test the circuit with the machine unplugged.', why: 'The appliance leaks to earth – the installation is fine.', fix: 'Repair / replace the washing machine.' },
      { id: 'leak', el: 'J4', mode: 'irLow', leak: 20, ir: 0.9, when: 'pc', say: 'RCD 2 trips "randomly", more often when the office is busy', title: 'Too much standing leakage on RCD 2 – computers, printers and their filters', hint: 'Use the leakage clamp on each circuit under RCD 2 with everything on.', why: 'IT equipment leaks a little to earth through its filters. Many items on one RCD add up past half its trip current.', fix: 'Spread the load: RCBOs per circuit, or move the office to its own RCD; keep standing leakage below 30 % of IΔn.' },
      { id: 'nuis', el: 'RCD2', mode: 'nuisance', say: 'RCD 2 trips when the washing machine motor starts – the machine tests fine elsewhere', title: 'RCD 2 faulty / wrong type – trips on the washing machine\'s motor drive', hint: 'The appliance tests fine on another circuit. Test the RCD itself and read its type.', why: 'A worn RCD (or a Type AC with an inverter drive load) can trip on normal transients and DC components.', fix: 'Replace with a Type A (or F) RCD / RCBO.' },
      { id: 'over', el: 'M3', mode: 'over', say: 'Burning smell from the utility room socket cable when the dryer and washer run', title: 'Utility socket circuit: 32 A MCB on a 2.5 mm² radial (should be 20 A)', look: 'MCB 32 A on a 2.5 mm² radial cable', hint: 'Compare the MCB rating with the cable size and installation method. Thermal-image the cable under load.', why: 'The cable can carry about 20–27 A; a 32 A MCB will not protect it from overload.', fix: 'Fit a 20 A MCB, or rewire as 4 mm² / a ring.' },
      { id: 'pen', el: 'SUP', mode: 'pen', say: 'Lights went very dim / off and people get tingles from taps', title: 'Broken PEN conductor in the supplier\'s cable (lost neutral)', hint: 'Everything is dead or odd and metalwork is live. Measure L–N and N–E at the main switch.', why: 'With the PEN broken, the installation\'s earth is connected to a floating neutral – metalwork can rise to dangerous voltage. This is an emergency.', fix: 'Switch off at the main switch, keep people away from metalwork, call the supplier (CEB / LECO) as an emergency.' },
      { id: 'rcd1', el: 'RCD1', mode: 'notrip', title: 'RCD 1 does not trip on test', hint: 'Test both RCDs at IΔn.', why: 'Additional protection lost for half the house.', fix: 'Replace the RCD.' },
      { id: 'l1', el: 'L1', mode: 'dead', title: 'Living room LED panel driver failed', hint: 'One fitting out – voltage at the fitting?', why: 'The driver has failed.', fix: 'Replace the driver.' },
    ],
    site: { w: 720, h: 360, bg: t(20, 20, 340, 160, 'Living / kitchen') + t(370, 20, 330, 160, 'Utility / office') + t(20, 190, 680, 150, 'Upstairs'), at: { L1: [100, 90, 'Living'], L2: [260, 90, 'Kitchen'], IMM: [300, 150, 'Immersion'], WM: [440, 100, 'Washer'], PC: [600, 100, 'Office'], L3: [300, 260, 'Bedrooms'], CU: [640, 300, 'CU'] } },
    demo: { title: 'RCD trips – find the circuit, then the fault', sub: 'Isolate circuits one by one, then an N–E insulation test', faults: ['ne'], in: {}, steps: [
      { say: 'RCD 1 has tripped. Tap <b>RCD 1</b> and look at it.', act: 'test:look:RCD1' },
      { say: 'Find which circuit trips it. Switch off the <b>Immersion heater MCB</b>.', act: 'off:M2' },
      { say: 'Now <b>reset RCD 1</b>.', act: 'reset:RCD1' },
      { say: 'It trips again – even with the immersion MCB off! An MCB breaks only the <b>line</b>; the circuit\'s neutral is still on the neutral bar, so a neutral–earth fault still unbalances the RCD. Isolate the circuit properly: <b>lock off</b> the immersion MCB (in the simulator this also lifts its neutral).', act: 'lock:M2' },
      { say: '<b>Reset RCD 1</b> again.', act: 'reset:RCD1' },
      { say: 'It holds now – the fault is on the immersion circuit. <b>Prove dead</b>: L–N at the immersion cable.', act: 'test:vln:C2' },
      { say: 'Disconnect the heater (tick "Loads disconnected") so you test only the wiring.', act: 'disc' },
      { say: '<b>Insulation test</b> of the immersion cable.', act: 'test:ir:C2' },
      { say: 'L+N–E is near zero with the heater disconnected, L–N is fine, and it tripped only when current flowed in the neutral – a <b>neutral–earth fault</b> in the cable. Tick it and submit.', act: 'diag' },
    ] },
  });

  // ================================================================ lighting circuits
  scen('home', 'r_light', '💡', {
    title: 'House lighting circuits', sub: 'Two-way stair lighting, ceiling roses, outside light with photocell', earthing: 'TN-C-S', ze: 0.3,
    brief: 'Owner of a two-storey house reports lighting problems after a new ceiling was fitted.',
    inputs: [{ k: 'up', label: 'Stair switch – top', v: true }, { k: 'down', label: 'Stair switch – bottom', v: false }, { k: 'hall', label: 'Hall switch', v: true }, { k: 'bed', label: 'Bedroom switch', v: true }, { k: 'dark', label: 'Dark outside', v: true }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-C-S)' }, { id: 'CU', kind: 'board', parent: 'SUP', name: 'Consumer unit' }, { id: 'RCD', kind: 'rcd', parent: 'CU', idn: 30, name: 'RCD 30 mA' },
      { id: 'M1', kind: 'mcb', parent: 'RCD', rating: 6, curve: 'B', name: 'Lights MCB' }, { id: 'C1', kind: 'cable', parent: 'M1', len: 12, size: 1.5, name: 'Lighting cable ground floor' }, { id: 'R1', kind: 'jb', parent: 'C1', name: 'Hall ceiling rose (loop-in)' },
      { id: 'SW1', kind: 'switch', parent: 'R1', in: 'hall', name: 'Hall switch' }, { id: 'L1', kind: 'lum', parent: 'SW1', w: 12, name: 'Hall light', metal: true },
      { id: 'S2', kind: '2way', parent: 'R1', in: ['up', 'down'], name: 'Two-way stair switches' }, { id: 'L2', kind: 'lum', parent: 'S2', w: 12, name: 'Stair light' },
      { id: 'C2', kind: 'cable', parent: 'R1', len: 14, size: 1.5, name: 'Cable to the loft' }, { id: 'R2', kind: 'jb', parent: 'C2', name: 'Bedroom ceiling rose' }, { id: 'SW3', kind: 'switch', parent: 'R2', in: 'bed', name: 'Bedroom switch' }, { id: 'L3', kind: 'lum', parent: 'SW3', w: 15, name: 'Bedroom pendant' },
      { id: 'C3', kind: 'cable', parent: 'R1', len: 9, size: 1.5, name: 'Cable to the porch' }, { id: 'PC', kind: 'photocell', parent: 'C3', in: 'dark', name: 'Outside photocell', short: 'PHOTO' }, { id: 'K', kind: 'contactor', parent: 'C3', coil: 'PC', name: 'Photocell relay' }, { id: 'L4', kind: 'lum', parent: 'K', w: 10, name: 'Porch light', metal: true },
    ],
    pool: [
      { id: 'strap', el: 'S2', mode: 'strapper', say: 'Stair light only works from the top switch', title: 'Two-way switching wired wrong – strapper and common swapped at the bottom switch', hint: 'Try every combination of the two stair switches and write down when the light is on.', why: 'With a strapper on the common terminal the light follows only one switch.', fix: 'Identify the commons and strappers with a continuity test and re-terminate.' },
      { id: 'hrn', el: 'R2', mode: 'hrN', title: 'Loose neutral in the bedroom ceiling rose – pendant flickers', look: 'Neutral loop terminal loose, scorch mark', hint: 'Voltage at the rose under load and the thermal camera.', why: 'The high-resistance joint heats and drops voltage.', fix: 'Remake the terminals in the rose.' },
      { id: 'openN', el: 'C2', mode: 'openN', say: 'Bedroom light dead since the new ceiling went up', title: 'Neutral cut in the cable to the loft (new ceiling fixing)', look: 'Ceiling screw through the cable', hint: 'Measure L–N and N–E at the bedroom rose with the switch on. What does a 230 V reading N–E mean?', why: 'The line is still there, but with no neutral the "neutral" at the rose rises to 230 V through the lamp – dangerous to anyone who thinks it is dead.', fix: 'Replace the damaged length; route away from fixings.' },
      { id: 'sw', el: 'SW1', mode: 'stuckOff', title: 'Hall switch faulty – contacts do not close', hint: 'Voltage in and out of the switch.', why: 'The switch never makes.', fix: 'Replace the switch.' },
      { id: 'pcd', el: 'PC', mode: 'dirty', say: 'Porch light stays on all day', title: 'Photocell covered in paint / dirt – thinks it is always dark', look: 'Lens painted over during redecoration', hint: 'Simulate daylight with a torch. Look at the cell.', why: 'A covered cell sees darkness all day.', fix: 'Clean / replace the cell; mask it when painting.' },
      { id: 'pcs', el: 'PC', mode: 'stuckDay', excl: ['pcd'], say: 'Porch light never comes on', title: 'Photocell failed – output never switches on', hint: 'Cover the cell and measure its output.', why: 'The cell\'s relay has failed open.', fix: 'Replace the photocell.' },
      { id: 'cpc', el: 'C1', mode: 'openE', title: 'CPC not connected at the hall rose – metal hall light unearthed', hint: 'Measure R1+R2 / Zs at the metal fittings.', why: 'Class I metal fittings need their CPC – a fault would leave them live.', fix: 'Connect and sleeve the CPC; re-test.' },
      { id: 'drv', el: 'L3', mode: 'dead', title: 'Bedroom LED lamp failed', hint: 'Voltage at the lamp holder with the switch on?', why: 'The lamp\'s internal driver has failed.', fix: 'Replace the lamp.' },
    ],
    site: { w: 720, h: 360, bg: t(20, 20, 330, 320, 'Ground floor') + t(370, 20, 330, 320, 'First floor') , at: { L1: [120, 100, 'Hall'], L2: [260, 200, 'Stairs'], L3: [520, 140, 'Bedroom'], L4: [120, 290, 'Porch'], PC: [60, 250, 'Photocell'] } },
  });

  // ================================================================ sockets and kitchen
  scen('home', 'r_sock', '🔌', {
    title: 'Sockets and kitchen', sub: 'Ring final circuit, cooker circuit, fridge, kettle', earthing: 'TN-C-S', ze: 0.3,
    brief: 'Tenant reports trips and a smell from the kitchen. Landlord wants a full check of the socket circuits.',
    inputs: [{ k: 'kettle', label: 'Kettle on', v: false }, { k: 'hob', label: 'Cooker hob on', v: true }, { k: 'tv', label: 'Living room TV on', v: true }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-C-S)' }, { id: 'CU', kind: 'board', parent: 'SUP', name: 'Consumer unit' }, { id: 'RCD', kind: 'rcd', parent: 'CU', idn: 30, name: 'RCD 30 mA' },
      { id: 'M1', kind: 'mcb', parent: 'RCD', rating: 32, curve: 'B', name: 'Ring final – ground floor' },
      { id: 'RC', kind: 'cable', parent: 'M1', len: 45, size: 2.5, name: 'Ring final cable', tests: [['ring', 'Ring end-to-end r1 / rn / r2', 'Dead tests', (st, R, e, F) => (F(st, e.id, 'ringOpen') ? 'r1 OL · rn 0.33 Ω · r2 0.55 Ω' : 'r1 0.33 Ω · rn 0.33 Ω · r2 0.55 Ω'), true]] },
      { id: 'K1', kind: 'socket', parent: 'RC', in: 'kettle', w: 2200, name: 'Kitchen worktop – kettle', metal: true }, { id: 'K2', kind: 'socket', parent: 'RC', w: 150, name: 'Fridge-freezer' }, { id: 'K3', kind: 'socket', parent: 'RC', in: 'tv', w: 200, name: 'Living room TV' },
      { id: 'M2', kind: 'mcb', parent: 'RCD', rating: 32, curve: 'B', name: 'Cooker circuit' }, { id: 'CC', kind: 'cable', parent: 'M2', len: 12, size: 6, name: 'Cooker cable' }, { id: 'CS', kind: 'jb', parent: 'CC', name: 'Cooker control switch' }, { id: 'HOB', kind: 'heater', parent: 'CS', in: 'hob', w: 6500, name: 'Cooker hob', metal: true },
    ],
    pool: [
      { id: 'ring', el: 'RC', mode: 'ringOpen', title: 'Ring final broken – the line conductor is open in one leg (now two radials)', hint: 'Everything works. Do the ring continuity test: end-to-end r1, rn, r2.', why: 'Each leg now carries the whole load on 2.5 mm² behind a 32 A MCB – overload risk with nothing to show it.', fix: 'Find the break (cross-connect test, readings rise towards the break) and repair it.' },
      { id: 'kettle', el: 'K1', mode: 'shortLN', say: 'The sockets trip when the kettle goes on', title: 'Kettle flex short circuit', look: 'Kettle flex melted near the plug', hint: 'MCB or RCD? Then test with the kettle unplugged.', why: 'A short circuit – the MCB trips instantly.', fix: 'Replace the kettle.' },
      { id: 'fridge', el: 'K2', mode: 'faultLE', say: 'The RCD trips at night – the fridge is warm in the morning', title: 'Fridge-freezer earth fault (defrost heater)', hint: 'Which appliance runs at night? Leakage-clamp the fridge flex, or unplug appliances one by one.', why: 'The defrost heater element leaks to earth when it switches on.', fix: 'Repair / replace the fridge.' },
      { id: 'cs', el: 'CS', mode: 'hrL', say: 'Smell of hot plastic from the cooker switch', title: 'Loose terminal in the cooker control switch – overheating', look: 'Cooker switch face discoloured, terminal melted', hint: 'Thermal camera on the cooker switch with the hob on.', why: '28 A through a loose terminal heats quickly – fire risk.', fix: 'Replace the cooker switch, torque the terminals.' },
      { id: 'cpc', el: 'RC', mode: 'openE', excl: ['ring'], title: 'CPC open at one socket on the ring', hint: 'R1+R2 / Zs at each socket.', why: 'Metal-cased appliances there are unearthed.', fix: 'Reconnect the CPC; test every socket.' },
      { id: 'rcd', el: 'RCD', mode: 'slow', title: 'RCD trips too slowly (420 ms)', hint: 'RCD test.', why: 'Above the 300 ms limit.', fix: 'Replace the RCD.' },
      { id: 'tv', el: 'K3', mode: 'dead', title: 'TV power supply failed (appliance fault)', hint: 'Plug a known-good lamp into the TV socket.', why: 'The socket is fine – the TV is faulty.', fix: 'TV repair – not an electrical installation fault.' },
    ],
    site: { w: 720, h: 360, bg: t(20, 20, 400, 320, 'Kitchen') + t(440, 20, 260, 320, 'Living room'), at: { K1: [100, 120, 'Kettle'], K2: [260, 120, 'Fridge'], HOB: [180, 260, 'Hob'], CS: [320, 260, 'Cooker switch'], K3: [560, 160, 'TV'] } },
  });

  // ================================================================ shower, water heater, garden
  scen('home', 'r_out', '🚿', {
    title: 'Shower, water heater and garden', sub: 'Electric shower, storage water heater, garden lighting with a photocell and outdoor socket', earthing: 'TN-C-S', ze: 0.3,
    brief: 'Villa owner: problems with the shower and the garden lighting after the rains.',
    inputs: [{ k: 'shower', label: 'Shower on', v: true }, { k: 'heat', label: 'Water heater on', v: true }, { k: 'rain', label: 'Raining', v: true }, { k: 'dark', label: 'Dark outside', v: true }, { k: 'mower', label: 'Lawn mower plugged in', v: false }],
    els: [
      { id: 'SUP', kind: 'supply', name: 'Supply (TN-C-S)' }, { id: 'CU', kind: 'board', parent: 'SUP', name: 'Consumer unit' }, { id: 'RCD', kind: 'rcd', parent: 'CU', idn: 30, name: 'RCD 30 mA' },
      { id: 'M1', kind: 'mcb', parent: 'RCD', rating: 45, curve: 'B', name: 'Shower MCB' }, { id: 'CS', kind: 'cable', parent: 'M1', len: 14, size: 10, name: 'Shower cable' }, { id: 'PS', kind: 'jb', parent: 'CS', name: 'Shower pull-cord switch' }, { id: 'SH', kind: 'heater', parent: 'PS', in: 'shower', w: 9500, name: 'Electric shower', weak: 'runs cold', metal: true },
      { id: 'M2', kind: 'mcb', parent: 'RCD', rating: 16, curve: 'B', name: 'Water heater MCB' }, { id: 'CW', kind: 'cable', parent: 'M2', len: 10, size: 2.5, name: 'Water heater cable' }, { id: 'WH', kind: 'heater', parent: 'CW', in: 'heat', w: 3000, name: 'Storage water heater', metal: true },
      { id: 'M3', kind: 'mcb', parent: 'RCD', rating: 6, curve: 'B', name: 'Garden lighting MCB' }, { id: 'PC', kind: 'photocell', parent: 'M3', in: 'dark', name: 'Garden photocell', short: 'PHOTO' }, { id: 'KG', kind: 'contactor', parent: 'M3', coil: 'PC', name: 'Garden lighting relay' }, { id: 'CG', kind: 'cable', parent: 'KG', len: 40, size: 2.5, name: 'Buried SWA to the garden' }, { id: 'JG', kind: 'jb', parent: 'CG', name: 'Garden junction box' }, { id: 'G1', kind: 'lum', parent: 'JG', w: 10, name: 'Path bollard 1' }, { id: 'G2', kind: 'lum', parent: 'JG', w: 10, name: 'Path bollard 2' }, { id: 'G3', kind: 'lum', parent: 'JG', w: 15, name: 'Tree spike light' },
      { id: 'M4', kind: 'mcb', parent: 'RCD', rating: 16, curve: 'B', name: 'Outdoor socket MCB' }, { id: 'CO', kind: 'cable', parent: 'M4', len: 15, size: 2.5, name: 'Outdoor socket cable' }, { id: 'SO', kind: 'socket', parent: 'CO', in: 'mower', w: 1200, name: 'Outdoor socket (mower)', metal: true },
    ],
    pool: [
      { id: 'pull', el: 'PS', mode: 'hrL', say: 'Shower runs cold some days; the pull-cord switch is brown', title: 'Shower pull-cord switch contacts burnt (high resistance)', look: 'Pull-cord switch casing brown, contacts pitted', hint: 'Voltage at the shower under load, thermal camera on the pull-cord switch.', why: 'A 40 A load through burnt contacts drops voltage and overheats – common failure.', fix: 'Replace with a 45 A double-pole switch, torque terminals.' },
      { id: 'wet', el: 'JG', mode: 'irLow', when: 'rain', leak: 24, ir: 0.15, say: 'The whole house goes off when it rains at night', title: 'Water in the garden junction box – leakage trips the RCD in the rain', look: 'Junction box full of water, gland not tightened', hint: 'Leakage clamp on the garden circuit with the rain on, then insulation-test from the junction box onwards.', why: 'Water ingress lets current leak to earth – above half the RCD\'s rating it trips everything on that RCD.', fix: 'Replace with an IP68 resin-filled junction box / correct glands; consider an RCBO for the garden.' },
      { id: 'g3', el: 'G3', mode: 'dead', title: 'Tree spike light failed', hint: 'One light out – voltage at it.', why: 'The fitting has failed.', fix: 'Replace the fitting.' },
      { id: 'pc', el: 'PC', mode: 'stuckNight', say: 'Garden lights are on all day', title: 'Garden photocell stuck on', hint: 'Shine a torch on it – does the output drop?', why: 'The cell\'s relay is welded / the sensor failed.', fix: 'Replace the photocell.' },
      { id: 'heat', el: 'WH', mode: 'faultLE', say: 'RCD trips when the water heater switches on', title: 'Water heater element earth fault', hint: 'Test with the heater disconnected.', why: 'The element sheath has corroded through.', fix: 'Replace the element.' },
      { id: 'mower', el: 'SO', mode: 'faultLE', say: 'RCD trips when the lawn mower is plugged in', title: 'Lawn mower cable damaged – earth fault', hint: 'Plug in the mower and check the RCD; test the circuit with it unplugged.', why: 'The mower cable has been cut and leaks to earth.', fix: 'Replace the mower cable; use a cable reel with an RCD outdoors.' },
      { id: 'pen', el: 'SUP', mode: 'pen', say: 'Tingle from the shower and taps; lights strange', title: 'Broken PEN in the supply cable', hint: 'Measure L–N and N–E at the main switch.', why: 'Lost PEN – exposed and extraneous metalwork can become live. Emergency.', fix: 'Switch off, warn the occupants, call the supplier immediately.' },
      { id: 'shM', el: 'M1', mode: 'under', say: 'Shower MCB trips after a few minutes', title: 'Shower MCB is 20 A – the 9.5 kW shower needs 45 A', look: 'MCB fitted is B20', hint: 'Clamp the shower current and read the MCB rating.', why: 'A 9.5 kW shower draws about 41 A.', fix: 'Fit a 45 A MCB / RCBO suitable for the 10 mm² cable.' },
    ],
    site: { w: 720, h: 360, bg: t(20, 20, 330, 320, 'House') + '<rect x="370" y="20" width="330" height="320" fill="#14532d" opacity="0.5"/><text x="380" y="38" fill="#bbf7d0" font-size="11">Garden</text>', at: { SH: [120, 100, 'Shower'], PS: [240, 100, 'Pull-cord'], WH: [120, 250, 'Water heater'], G1: [450, 120, 'Bollard 1'], G2: [560, 120, 'Bollard 2'], G3: [640, 220, 'Tree light'], JG: [500, 220, 'JB'], SO: [460, 300, 'Socket'], PC: [300, 300, 'Photocell'] } },
  });
})();
