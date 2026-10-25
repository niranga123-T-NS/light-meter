// Units 3–4: mechanical installation (mounting bench, lifting and deflection) and power & network cabling (wiring bench, connectors)
// Values: Safedock FleX supervision & installation guide for BIA.
const VDSTEP = (el, title, steps, done, retry, side) => {
  // a guided procedure: each step must be right to go on; a step right at the first try scores a point
  let i = 0, score = 0, tries = 0;
  el.innerHTML = `<div class="tw"><div><div class="task">${title}</div><div id="sxBody"></div><div id="sxRes"></div></div><div><div class="steps" id="sxList"></div>${side ? '<div id="sxSide" class="panel" style="margin-top:10px"></div>' : ''}</div></div>`;
  const list = () => ($('sxList').innerHTML = steps.map((s, j) => `<div class="${j < i ? 'ok' : j === i ? 'cur' : ''}">${j < i ? '✓' : j + 1 + '.'} ${s.t}</div>`).join(''));
  const show = () => {
    list(); if (side) $('sxSide').innerHTML = side(i);
    if (i >= steps.length) { done(score, steps.length); VD.result($('sxRes'), score, steps.length, [[score === steps.length, `${score} of ${steps.length} steps right first time`]], retry); $('sxBody').innerHTML = ''; return; }
    const s = steps[i]; tries = 0;
    $('sxBody').innerHTML = `<div class="card" style="padding:12px"><b>Step ${i + 1}: ${s.t}</b><div style="margin-top:8px">${s.html()}</div><div class="row" style="margin-top:10px"><button class="btn p" id="sxGo">Check</button><span id="sxMsg"></span></div></div>`;
    if (s.init) s.init();
    $('sxGo').onclick = () => { const [ok, msg] = s.check(); tries++; if (ok) { if (tries === 1) score++; $('sxMsg').innerHTML = `<span class="okc">✓ ${msg || 'Right'}</span>`; setTimeout(() => { i++; show(); }, 700); } else $('sxMsg').innerHTML = `<span class="noc">✗ ${msg}</span>`; };
  };
  show();
};
(() => {
  const { quiz, pick } = VD;
  const radios = (name, opts) => opts.map((o, j) => `<label style="display:block"><input type="radio" name="${name}" value="${j}"> ${o}</label>`).join('');
  const got = (name) => { const v = document.querySelector(`input[name=${name}]:checked`); return v ? +v.value : -1; };
  const gotAll = (name) => [...document.querySelectorAll(`input[name=${name}]:checked`)].map((v) => +v.value).sort().join(',');
  const val = (id) => parseFloat($(id).value);

  // the pole with what is on it so far
  const pole = (i, tilt) => `<svg viewBox="0 0 260 380"><rect width="260" height="380" fill="#f8fafc"/><g transform="rotate(${tilt || 0} 70 370)"><rect x="60" y="20" width="20" height="350" fill="#9aa3ad"/>
    ${i > 3 ? '<rect x="90" y="40" width="130" height="100" rx="4" fill="#111"/><text x="155" y="80" fill="#36e06a" font-size="18" text-anchor="middle" font-family="monospace" font-weight="700">B738</text><text x="155" y="110" fill="#ffb000" font-size="16" text-anchor="middle" font-family="monospace">12.0m</text>' : ''}
    ${i > 2 ? '<rect x="52" y="52" width="36" height="8" fill="#b45309"/><rect x="52" y="124" width="36" height="8" fill="#b45309"/><rect x="52" y="178" width="36" height="8" fill="#b45309"/><rect x="52" y="226" width="36" height="8" fill="#b45309"/>' : ''}
    ${i > 4 ? '<path d="M90 170 L220 170 L204 240 L106 240 Z" fill="#dfe3e8" stroke="#8a929c"/><rect x="122" y="180" width="66" height="34" fill="#2a2f36"/>' : ''}
    <text x="70" y="378" font-size="10" text-anchor="middle" fill="#5f6673">Ø139.7 pole</text></g></svg>`;

  // ===== Unit 3 lab: mounting bench
  item('mech', 'mount', '🔩', 'Mounting bench', 'Pole check, clamps, rail spacing, torque, pins, lifting and level', 'lab', (el, done) => {
    const run = () => {
      let tilt = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.round(Math.random() * 6) / 10);
      VDSTEP(el, 'Mount a Safedock FleX scanner and PDFleX pilot display on a new support pole at stand A8. Follow the installation guide; every step is checked.', [
        { t: 'Check the support fixture is vertical', html: () => `<p>Put the level on the pole. Adjust the base until it reads 0.0°, then tighten the fixings.</p><div class="ctl"><div><label>Pole tilt <b id="mtV"></b></label><input type="range" id="mt" min="-2" max="2" step="0.1" value="${tilt}"></div></div><label style="display:block;margin-top:6px"><input type="checkbox" id="mtF"> All fasteners holding the pole tightened</label>`, init: () => { const u = () => { tilt = +$('mt').value; $('mtV').textContent = `${tilt.toFixed(1)}°`; $('sxSide').innerHTML = pole(0, tilt * 4); }; $('mt').oninput = u; u(); }, check: () => [Math.abs(tilt) < 0.05 && $('mtF').checked, Math.abs(tilt) >= 0.05 ? `Still ${tilt.toFixed(1)}° off vertical` : 'Tighten all the fasteners'] },
        { t: 'Choose the clamps', html: () => `<p>The pole is a 5½-inch steel pipe. Which clamp kit fits, and what comes in it?</p>${radios('mc', ['U-clamp 114.3 mm, 2 per unit, M10 bolts', 'U-clamp 139.7 mm (5½"), 2 per unit, 4 T-head bolts M12 × 40, 8 hex nuts M12', 'Band clamps 168.3 mm, 4 per unit', 'Any clamp – the pole is supplied with the unit'])}`, check: () => [got('mc') === 1, 'Check the install kit: 139.7 mm U-clamps with M12 T-head bolts and nuts. The pole itself is not supplied.'] },
        { t: 'Set the rail spacing', html: () => `<p>Mark the clamp positions on the pole, centre to centre of the mounting rails.</p><div class="ctl"><div><label>PDFleX rails (mm)</label><input type="number" id="ms1"></div><div><label>Scanner rails (mm)</label><input type="number" id="ms2"></div><div><label>Gap display → scanner, at least (mm)</label><input type="number" id="ms3"></div></div>`, check: () => [val('ms1') === 845 && val('ms2') === 600 && val('ms3') === 220, 'Guide: PDFleX 845 mm, scanner 600 mm, minimum 220 mm between them'] },
        { t: 'Tighten the clamps', html: () => `<p>Two bolts and two nuts on each side of the fixture. Set the torque wrench.</p><div class="ctl"><div><label>Torque <b id="mqV"></b></label><input type="range" id="mq" min="10" max="80" step="1" value="20"></div></div>`, init: () => { const u = () => ($('mqV').textContent = `${$('mq').value} Nm`); $('mq').oninput = u; u(); }, check: () => [+$('mq').value === 35, `${$('mq').value} Nm – the recommended torque is 35 Nm`] },
        { t: 'Lock the clamps against rotation', html: () => `<p>How do you stop the assembly turning on the pole?</p>${radios('mp', ['Drill Ø6 mm through the clamp’s pre-drilled hole and the pole, hammer in the spring pin', 'Weld the clamp to the pole', 'Add a third bolt', 'Nothing – 35 Nm is enough'])}<div class="note">The pre-drilled hole may be filled with zinc from galvanising – clear it first.</div>`, check: () => [got('mp') === 0, 'The guide: drill 6 mm through the pre-drilled hole and the fixture, then the spring pin'] },
        { t: 'Lift the unit into place', html: () => `<p>Choose all that are right for lifting the scanner (about 60 kg) to 6 m.</p>${['Light crane, lift capacity 155 kg, lifting height 10 m', 'Lift by the built-in eyebolt with an anchor shackle or a nylon web sling', 'Use an open lifting hook in the eyebolt', 'Load the eyebolt at an angle to save height', 'Portable lift for 1–2 people, at least 6 m, for the fitters'].map((o, j) => `<label style="display:block"><input type="checkbox" name="ml" value="${j}"> ${o}</label>`).join('')}`, check: () => [gotAll('ml') === '0,1,4', 'Crane 155 kg / 10 m, shackle or nylon sling in the eyebolt, load only in the plane of the eyebolt, people on a portable lift – never an open hook'] },
        { t: 'Hang the units and level them', html: () => `<p>Order the last steps.</p>${[0, 1, 2, 3].map((n) => `<div class="row" style="margin:3px 0"><select id="mo${n}">${['—', 'Lift the unit into position with the crane', 'Put two clamp bolts in each rail, either side of the centre hole', 'Fasten the unit to the fixture with the clamps', 'Check with a level that the unit is straight'].map((o, j) => `<option value="${j}">${o}</option>`).join('')}</select></div>`).join('')}`, check: () => [[0, 1, 2, 3].every((n) => +$(`mo${n}`).value === n + 1), 'Lift → bolts in the rails → clamp → level'] },
        { t: 'Check the deflection allowance', html: () => `<p>The farthest stop is 30 m from the scanner. From the deflection table, what is the maximum angle allowed front-to-back (A) and side-to-side (B) at the top of the pole?</p><table class="spec"><tr><th>Scanner → stop</th><th>A °</th><th>B °</th></tr>${[[10, 0.8, 0.6], [20, 0.5, 0.3], [30, 0.4, 0.2], [40, 0.3, 0.1], [50, 0.3, 0.1], [60, 0.2, 0.1]].map((r) => `<tr><td>${r[0]} m</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table><div class="ctl"><div><label>A – front to back (°)</label><input type="number" step="0.1" id="md1"></div><div><label>B – side to side (°)</label><input type="number" step="0.1" id="md2"></div></div><div class="note">Normal accuracy is 10 cm; in extreme wind the measurement error may reach 50 cm.</div>`, check: () => [val('md1') === 0.4 && val('md2') === 0.2, 'Read the 30 m row: A 0.4°, B 0.2°'] },
      ], done, run, (i) => pole(i, i === 0 ? tilt * 4 : 0));
    };
    run();
  });

  // ===== Unit 3 lesson: tools, lifting and the deflection rule
  item('mech', 'tools', '🧰', 'Tools, lifting & deflection', 'What to bring, how to lift, why the pole must be stiff', 'lesson', (el, done) => {
    el.innerHTML = `<div class="two"><div>
      <h4>Mounting height and position</h4><p>The FleX is mounted 4–8 m above the ground, measured to the bottom edge of the unit. The height depends on the stand and the aircraft (wide- or narrow-body). Where possible it sits centred over the stand centreline. The support (a Ø139.7 mm / 5½" steel pipe, or a wall or mast fixture) is local supply: it is not in the delivery, and local codes decide its fixings.</p>
      <h4>Tools and equipment</h4><ul><li>Screwdrivers, pliers (regular, needle nose, diagonal), adjustable wrenches, wire strippers</li><li>Level, tape measure longer than 10 m</li><li>Laptop with the SMT software (Safedock Maintenance Tool)</li><li>Multimeter (U, I, R)</li><li>Portable lift for 1–2 people, at least 6 m</li><li>Light crane: 155 kg capacity, 10 m lifting height</li></ul>
    </div><div>
      <h4>Lifting</h4><p>Lift by the built-in eyebolt on top, with an anchor shackle or a nylon web sling – never an open hook. Load the eyebolt only in its own plane: a side pull can break it. Lift slowly, no jerks.</p>
      <h4>Deflection</h4><p>The scanner measures the aircraft position to about 10 cm. If the pole bends in wind or sun, the whole picture moves. The table limits the angle at the top: the further the stop, the smaller the angle allowed – at 30 m only 0.4° front-to-back and 0.2° side-to-side.</p>
      <div class="watch">Galvanised clamps: the 6 mm pre-drilled hole for the spring pin may be filled with zinc – drill it out through the pole too.</div>
    </div></div><h3>Check yourself</h3><div id="tQ"></div>`;
    quiz($('tQ'), [
      { q: 'The mounting height of 4–8 m is measured to…', a: ['the bottom edge of the unit', 'the top of the display', 'the centre of the scanner window', 'the top of the pole'], c: 0 },
      { q: 'Who supplies the support pole?', a: ['It is local supply – not in the delivery', 'It comes with each unit', 'The airport always', 'The aircraft operator'], c: 0, why: 'The guide: a support fixture is not supplied as standard as local requirements differ.' },
      { q: 'Which lifting gear is NOT allowed in the eyebolt?', a: ['An open lifting hook', 'An anchor shackle', 'A nylon web sling', 'A shackle with a round sling'], c: 0 },
      { q: 'The crane for the scanner needs at least…', a: ['155 kg capacity and 10 m lifting height', '50 kg and 4 m', '1 t and 30 m', 'no crane – lift by hand'], c: 0 },
      { q: 'Why is the deflection allowed at 60 m smaller than at 10 m?', a: ['The same angle moves the measured point further away', 'Large aircraft are heavier', 'The display is bigger', 'It is not – both are the same'], c: 0, why: 'An angle error grows with distance: 0.2° at 60 m is about 21 cm.' },
      { q: 'What software do you bring to the stand?', a: ['SMT – Safedock Maintenance Tool', 'Relux', 'ETS', 'AutoCAD only'], c: 0 },
      { q: 'What torque is recommended for the clamp nuts?', a: ['35 Nm', '10 Nm', '80 Nm', 'Hand tight'], c: 0 },
    ], done, { n: 6 });
  });

  // ===== Unit 4 lab: wiring bench
  item('cable', 'wire', '🔌', 'Wiring bench', 'Supplies, protection, Neutrik connectors, glands, termination and tests', 'lab', (el, done) => {
    const run = () => {
      const netOD = pick([6.2, 7.0, 7.6, 8.4]), pwOD = pick([8.5, 9.6, 11.0]);
      const U = [['pd', 'PDFleX pilot display'], ['sc', 'FleX scanner'], ['op', 'FOP-L operator panel']];
      el.innerHTML = `<div class="task">Wire stand B12: give each unit its own supply from the stand DB and a network link to the field switch, choose the connectors and glands, terminate, then test before switching on. The power cable on site is Ø${pwOD} mm, the network patch cable Ø${netOD} mm.</div>
      <div class="tw"><div>
        <h4>1 · Supply and protection (each unit)</h4><div class="ctl">
          <div><label>Mains cable</label><select id="wC"><option>—</option><option>2 × 1.0 mm² flex</option><option>3 × 1.5 mm² (L, N, PE)</option><option>4 × 6 mm² SWA</option></select></div>
          <div><label>Protective device in the DB</label><select id="wB"><option>—</option><option>MCB 6 A, one for all three units</option><option>MCB 10 A per unit, rated 240 V</option><option>MCB 32 A per unit</option></select></div>
          <div><label>Switch near the operator panel</label><select id="wS"><option>—</option><option>None needed</option><option>Labelled main switch, ≥10 A, breaks all phases and neutral</option><option>Single-pole switch in the live only</option></select></div>
          <div><label>Supply voltage</label><select id="wV"><option>—</option><option>100–240 V AC, 50/60 Hz, single phase</option><option>400 V three phase</option><option>48 V DC</option></select></div></div>
        <h4>2 · Connectors and glands</h4><div class="ctl">
          <div><label>PDFleX power plug (cable side)</label><select id="wPp"><option>—</option><option>Neutrik NAC3FX-W-TOP powerCON TRUE1 TOP</option><option>Schuko plug</option><option>Neutrik NE8MX-TOP</option></select></div>
          <div><label>PDFleX network plug (cable side)</label><select id="wPn"><option>—</option><option>Neutrik NE8MX-TOP etherCON TOP</option><option>Standard RJ45 boot</option><option>Neutrik NAC3FX-W-TOP</option></select></div>
          <div><label>Network cable</label><select id="wN"><option>—</option><option>CAT3 telephone cable</option><option>CAT5e or CAT6, not pre-assembled</option><option>Pre-made CAT6 patch lead with moulded boot</option></select></div>
          <div><label>Scanner & FOP-L entries</label><select id="wG"><option>—</option><option>M20 cable glands (cable Ø8–13 mm), M12 × 1.5 plugs in spare holes</option><option>Leave the plugs out for air</option><option>Silicone the cables through the holes</option></select></div>
          <div><label>Conduit ½" into the scanner</label><select id="wH"><option>—</option><option>Use the 20.5 mm hole as it is</option><option>Open the hole to 22 mm</option></select></div>
          <div><label>EMC on the FOP-L supply</label><select id="wF"><option>—</option><option>Ferrite core 100 Ω on the power cable just before its connector inside the FOP-L</option><option>No ferrite</option><option>Ferrite on the network cable at the switch</option></select></div>
          <div><label>Cable length to the switch / DB</label><select id="wL"><option>—</option><option>As short as possible, under 100 m</option><option>Up to 300 m</option></select></div></div>
        <h4>3 · Terminate the supply</h4><div class="ctl">${['L', 'N', 'PE'].map((t) => `<div><label>Terminal ${t}</label><select id="wT${t}"><option>—</option><option>brown</option><option>blue</option><option>green/yellow</option></select></div>`).join('')}</div>
        <div class="row" style="margin-top:10px"><button class="btn p" id="wTest">Test, then switch on</button></div><div id="wRes"></div>
      </div><div class="panel"><svg viewBox="0 0 320 380" id="wSv"></svg><div class="note" style="padding:0 10px 10px">Each unit has its own supply. The FOP-L may also take 24 V DC from the scanner instead of mains.</div></div></div>`;
      const sv = (ok) => { $('wSv').innerHTML = `<rect width="320" height="380" fill="#fff"/><rect x="14" y="20" width="80" height="150" rx="6" fill="#eef0f4" stroke="#cbd5e1"/><text x="54" y="40" font-size="11" text-anchor="middle" font-weight="700">Stand DB</text>${[0, 1, 2].map((i) => `<rect x="26" y="${54 + i * 36}" width="56" height="24" rx="3" fill="#fff" stroke="#cbd5e1"/><text x="54" y="${70 + i * 36}" font-size="9" text-anchor="middle">${['PD', 'SC', 'OP'][i]}</text>`).join('')}<rect x="14" y="230" width="80" height="60" rx="6" fill="#eef0f4" stroke="#cbd5e1"/><text x="54" y="262" font-size="10" text-anchor="middle">Field switch</text>${U.map(([k, n], i) => `<rect x="190" y="${30 + i * 115}" width="116" height="70" rx="6" fill="${k === 'pd' ? '#111' : '#dfe3e8'}" stroke="#8a929c"/><text x="248" y="${70 + i * 115}" font-size="11" text-anchor="middle" fill="${k === 'pd' ? (ok ? '#36e06a' : '#555') : '#14161c'}" font-weight="700">${n.split(' ')[0]}</text><path d="M94 ${66 + i * 36} C 140 ${66 + i * 36} 140 ${55 + i * 115} 190 ${55 + i * 115}" stroke="#dc2626" stroke-width="2.5" fill="none"/><path d="M94 ${250 + i * 10} C 150 ${250 + i * 10} 150 ${80 + i * 115} 190 ${80 + i * 115}" stroke="#244286" stroke-width="2" stroke-dasharray="6 4" fill="none"/>`).join('')}`; };
      sv(false);
      $('wTest').onclick = () => {
        const g = (id) => $(id).selectedIndex, rows = [];
        rows.push([g('wC') === 2, 'Mains cable 3 × 1.5 mm² (or per local standard)']);
        rows.push([g('wB') === 2, 'Separate protection per unit, at least 10 A / 240 V']);
        rows.push([g('wS') === 2, 'Labelled main switch near the panel, all poles broken together']);
        rows.push([g('wV') === 1, 'Supply 100–240 V AC single phase, 50/60 Hz']);
        rows.push([g('wPp') === 1 && pwOD >= 6 && pwOD <= 12, `Power plug NAC3FX-W-TOP (takes Ø6–12 mm; your cable is ${pwOD} mm)`]);
        const netFits = netOD >= 5 && netOD <= 8;
        rows.push([g('wPn') === 1 && netFits, `Network plug NE8MX-TOP (takes Ø5–8 mm; your cable is ${netOD} mm${netFits ? '' : ' – too thick: get a thinner CAT6 cable'})`]);
        rows.push([g('wN') === 2, 'CAT5e/CAT6 cable, not pre-assembled – the RJ45 is fitted after the boot is on']);
        rows.push([g('wG') === 1, 'M20 glands for Ø8–13 mm cables, spare holes plugged']);
        rows.push([g('wH') === 2, '½" conduit needs a 22 mm hole (non-standard for US conduit)']);
        rows.push([g('wF') === 1, 'Ferrite 100 Ω on the power cable at the FOP-L connector']);
        rows.push([g('wL') === 1, 'Cables as short as possible, not over 100 m']);
        const term = $('wTL').selectedIndex === 1 && $('wTN').selectedIndex === 2 && $('wTPE').selectedIndex === 3;
        rows.push([term, term ? 'Polarity right, PE continuous – insulation resistance > 1 MΩ at 500 V' : 'Polarity / earth test failed – brown to L, blue to N, green/yellow to PE']);
        const sc = rows.filter((r) => r[0]).length; sv(sc === rows.length); done(sc, rows.length); VD.result($('wRes'), sc, rows.length, rows, run);
      };
    };
    run();
  });

  // ===== Unit 4 lesson: inside the units
  item('cable', 'inside', '🔍', 'Inside the units', 'PDFleX control box, scanner entries, FOP-L boards and I/O', 'lesson', (el, done) => {
    el.innerHTML = `<div class="two"><div>
      <h4>PDFleX – pilot display</h4><ul><li><b>Control unit enclosure</b> behind the LED door: single-board PC and the <b>sending board</b> (“the brain” for the LED hardware: converts DVI/HDMI to the LED data, reads the photosensor).</li><li>5 V DC and 24 V DC power supplies, a 16 A main circuit breaker, the input main power terminal block.</li><li>Outside: <b>Neutrik NAC3MPX-TOP</b> power inlet (250 V, 16 A, breaking capacity) and <b>NE8FDP-TOP</b> sealed RJ45 (IP65 when mated). Entry hole 35 mm, 27 mm (1") conduit.</li><li>Cable side: <b>NAC3FX-W-TOP</b> (3 × 1.5 mm², solid conductor, Ø6–12 mm) and <b>NE8MX-TOP</b> (CAT5e/6, Ø5–8 mm, not pre-assembled). The connector kit comes with each PDFleX; the cables do not.</li></ul>
      <h4>FleX scanner</h4><ul><li>Three cable entries underneath: remove the plugs, fit the cable glands (kit of 3 × M20 with lock nuts, Ø8–13 mm), tighten the gland dome top and the locking nut inside.</li><li>Hole 20.5 mm; spare holes take M12 × 1.5 screw plugs (12.5 mm). ½" conduit needs 22 mm.</li><li>Mains 100–240 V AC single phase 50/60 Hz; CAT5 network. Option: 24 V DC out to power the FOP-L.</li></ul>
    </div><div>
      <h4>FOP-L – fixed operator panel</h4><ul><li>Power supply unit: 264 V AC max, 50/60 Hz input, 24 V DC version optional, about 10 W.</li><li>Single-board industrial computer (Cortex-M4 coprocessor).</li><li><b>Standard I/O</b>: 7 inputs / 7 outputs at 24 V DC, opto-coupled, USB to the PC. <b>Extended I/O</b>: 8 in / 8 out, used for the bridge dry contacts.</li><li>Service port: RJ45 Ethernet, used by Service to reach the network.</li><li><b>Emergency stop</b> button: now on the network, no longer hard-wired to the scanner.</li><li>Cable glands: hole 20 mm; installer supplies glands if the cable is not Ø8–13 mm.</li></ul>
      <div class="watch">Every part of the system has its own mains connection and its own network cable. Isolate all three before working inside any of them.</div></div></div><h3>Check yourself</h3><div id="nQ"></div>`;
    quiz($('nQ'), [
      { q: 'What does the sending board in the PDFleX do?', a: ['Turns the video signal into data for the LED modules and reads the photosensor', 'Measures the aircraft', 'Talks to FIDS', 'Charges a battery'], c: 0 },
      { q: 'Which cable-side connector carries the PDFleX network?', a: ['Neutrik NE8MX-TOP', 'Neutrik NAC3FX-W-TOP', 'Neutrik NAC3MPX-TOP', 'A plain RJ45 boot'], c: 0 },
      { q: 'A CAT6 cable is 8.6 mm thick. Can you use it on the PDFleX etherCON?', a: ['No – the NE8MX-TOP takes 5–8 mm', 'Yes, any CAT6 fits', 'Yes, with tape', 'Only outdoors'], c: 0 },
      { q: 'Where are the bridge (PBB) dry contacts wired?', a: ['The FOP-L I/O', 'The pilot display', 'The AiPRON server', 'The field switch'], c: 0 },
      { q: 'The FOP-L can be powered from…', a: ['its own mains, or 24 V DC from the scanner', 'only a battery', 'PoE from the switch only', 'the pilot display'], c: 0 },
      { q: 'How is the emergency stop connected on the current FOP-L?', a: ['Over the network, not hard-wired to the scanner', 'Hard-wired to the scanner', 'To the PBB', 'It is not connected'], c: 0 },
      { q: 'Before working inside a unit you isolate…', a: ['all three units – each has its own supply', 'only the unit you open', 'the field switch', 'nothing, it is 24 V'], c: 0 },
    ], done, { n: 6 });
  });
})();
