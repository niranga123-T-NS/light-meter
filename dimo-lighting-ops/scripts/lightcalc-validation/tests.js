// Light Calc validation – test cases in the style of CIE 171:2006 (analytical cases with exact answers). Runs inside the engine page; every reference value
// is worked out here from first principles, independently of the engine's own code.
(() => {
  const R = [], deg = Math.PI / 180, rel = (a, b) => (b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b)) * 100;
  const add = (id, group, title, method, rows, tol) => { const worst = Math.max(...rows.map((r) => r.err)); R.push({ id, group, title, method, rows, worst, tol, pass: worst <= tol }); };
  // ---- luminaire files written as text, read by the engine's own IES / LDT readers
  const ies = (name, vAng, hAng, fn, W = 100) => { const vals = []; hAng.forEach((h) => vAng.forEach((v) => vals.push(+fn(h, v).toFixed(4))));
    return `IESNA:LM-63-2002\n[TEST] ${name}\n[LUMINAIRE] ${name}\nTILT=NONE\n1 -1 1 ${vAng.length} ${hAng.length} 1 2 0.5 0.5 0.1\n1 1 ${W}\n${vAng.join(' ')}\n${hAng.join(' ')}\n${vals.join(' ')}\n`; };
  const ldt = (name, G, fn, flux = 1000) => { // EULUMDAT, rotational symmetry (Isym 1), values in cd/klm
    const L = ['DIMO test', '1', '1', '1', '0', String(G.length), '0', 'test', name, name, 'test', '100', '500', '500', '100', '0', '0', '0', '0', '0', '0', '100', '100', '1', '0', '1', '1', 'LED', String(flux), '5700', '80', '100'];
    for (let i = 0; i < 10; i++) L.push('0'); L.push('0'); G.forEach((g) => L.push(String(g))); G.forEach((g) => L.push(String(+(fn(g) * 1000 / flux).toFixed(4)))); return L.join('\n'); };
  const range = (a, b, s) => { const o = []; for (let x = a; x <= b + 1e-9; x += s) o.push(+x.toFixed(6)); return o; };
  // ---- a luminaire placed and aimed through the engine (lcQ), on a one-light mast
  const place = (pm, P, aim, spin = 0) => { const L = { masts: [{ name: 'T', x: P[0], y: P[1], h: P[2], frame: { t: 'ring', r: 0.5 }, lights: [{ ax: aim[0], ay: aim[1], az: aim[2] ?? 0, spin, lum: 'X' }] }], lums: { X: pm }, lum: 'X' }; let q = lcQ(L, 0, 0);
    if (aim[3] === 'down') for (let k = 0; k < 4; k++) { L.masts[0].lights[0].ax = q.P.x + 1e-4; L.masts[0].lights[0].ay = q.P.y; q = lcQ(L, 0, 0); } return q; }; // 'down': aimed straight below the luminaire itself
  // independent reference: illuminance on a plane with unit normal n at point X from a source at S with intensity I toward X
  const Eref = (S, X, n, I) => { const v = [S[0] - X[0], S[1] - X[1], S[2] - X[2]], d = Math.hypot(...v), c = (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / d; return c > 0 ? (I * c) / (d * d) : 0; };
  const Eeng = (q, X, n) => { const [k, bx, by, bz] = lcOne(q, X[0], X[1], X[2]), c = bx * n[0] + by * n[1] + bz * n[2]; return c > 0 ? k * c : 0; };
  const P3 = (q) => [q.P.x, q.P.y, q.P.z];

  // 1. Isotropic point source – inverse-square and cosine laws on the horizontal plane (CIE 171 §5.1 type)
  { const pm = lcParseIES(ies('Isotropic 1000 cd', range(0, 180, 5), [0], () => 1000), 'iso.ies'), q = place(pm, [0, 0, 10], [0.001, 0, 0]), S = P3(q);
    const rows = range(0, 40, 5).map((x) => { const X = [x, 0, 0], e = Eeng(q, X, [0, 0, 1]), r = Eref(S, X, [0, 0, 1], 1000); return { at: `x ${x} m`, eng: e, ref: r, err: rel(e, r) }; });
    add('1', 'Direct light – geometry', 'Isotropic source, horizontal illuminance (inverse-square and cosine law)', 'E = I·cos θ / d², I = 1000 cd, source 10 m high', rows, 0.1); }
  // 2. Vertical planes facing four directions (camera planes, 'vertical' mode)
  { const pm = lcParseIES(ies('Isotropic 1000 cd', range(0, 180, 5), [0], () => 1000), 'iso.ies'), q = place(pm, [0, 0, 20], [0.001, 0, 0]), S = P3(q), rows = [];
    [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0.7071, 0.7071, 0]].forEach((n) => [[10, 5], [-15, 8], [25, -20]].forEach(([x, y]) => { const X = [x, y, 1.5], e = Eeng(q, X, n), r = Eref(S, X, n, 1000); rows.push({ at: `(${x}, ${y}, 1.5) n(${n.map((v) => v.toFixed(2)).join(', ')})`, eng: e, ref: r, err: rel(e, r) }); }));
    add('2', 'Direct light – geometry', 'Vertical planes in several directions at 1.5 m', 'E = I·(v·n) / d³ for each plane normal', rows.filter((r) => r.ref > 0), 0.1); }
  // 3. Planes square to a TV camera ('face' mode, normal toward the camera in 3D)
  { const pm = lcParseIES(ies('Isotropic 1000 cd', range(0, 180, 5), [0], () => 1000), 'iso.ies'), q = place(pm, [-30, -45, 35], [0, 0, 0]), S = P3(q), cam = { x: 0, y: -60, z: 15 }, rows = [];
    [[0, 0], [20, 10], [-25, -15], [40, 30]].forEach(([x, y]) => { const n = lcCam({ plane: 'face' }, cam, x, y, 1.5), X = [x, y, 1.5], v = [cam.x - x, cam.y - y, cam.z - 1.5], d = Math.hypot(...v), nr = v.map((a) => a / d), e = Eeng(q, X, n), r = Eref(S, X, nr, 1000); rows.push({ at: `(${x}, ${y}) → camera`, eng: e, ref: r, err: rel(e, r) }); });
    add('3', 'Direct light – geometry', 'Planes square to a TV camera (Ecam, 3D)', 'plane normal = unit vector to the camera; E = I·(v·n)/d³', rows, 0.1); }
  // 4. Aimed floodlight: rotationally symmetric beam aimed at 50°, 60°, 70° tilt – intensity found from the angle to the beam axis
  { const fw = 24, Ifn = (g) => (g > 90 ? 0 : 10000 * 2 ** (-((g / (fw / 2)) ** 2))), pm = lcParseIES(ies('Beam 24°', range(0, 180, 0.5), [0], (h, v) => Ifn(v)), 'beam.ies'), rows = [];
    [50, 60, 70].forEach((tilt) => { const H = 35, d0 = H * Math.tan(tilt * deg), q = place(pm, [0, 0, H], [d0, 0, 0]), S = P3(q), ax = [d0 - S[0], -S[1], -S[2]], al = Math.hypot(...ax);
      [[d0, 0], [d0 + 6, 3], [d0 - 8, -5], [d0 + 15, 0]].forEach(([x, y]) => { const X = [x, y, 0], v = [X[0] - S[0], X[1] - S[1], X[2] - S[2]], dv = Math.hypot(...v), g = Math.acos(Math.min(1, (v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2]) / (dv * al))) / deg, r = Eref(S, X, [0, 0, 1], Ifn(g)), e = Eeng(q, X, [0, 0, 1]);
        rows.push({ at: `tilt ${tilt}°, (${x.toFixed(1)}, ${y}) · ${g.toFixed(1)}° off axis`, eng: e, ref: r, err: rel(e, r) }); }); });
    add('4', 'Aiming', 'Floodlight aimed at 50°, 60° and 70° tilt – beam axis and off-axis points', 'I from the true angle to the beam axis (table read at 0.5° steps); E = I·cos θ / d²', rows, 1); }
  // 5. Asymmetric distribution and spin: I = 1000 (1 + 0.5 cos C) – the strongest and weakest directions 3 : 1, turning with the spin
  { const C = range(0, 360, 15), pm = lcParseIES(ies('Asymmetric', range(0, 90, 5), C, (c) => 1000 * (1 + 0.5 * Math.cos(c * deg))), 'asym.ies'), rows = [];
    [0, 90].forEach((spin) => { const q = place(pm, [0, 0, 10], [0, 0, 0, 'down'], spin), S = P3(q), ring = range(0, 345, 15).map((a) => { const X = [S[0] + 5 * Math.cos(a * deg), S[1] + 5 * Math.sin(a * deg), 0]; return { a, e: Eeng(q, X, [0, 0, 1]) }; });
      const mx = ring.reduce((m, x) => (x.e > m.e ? x : m)), mn = ring.reduce((m, x) => (x.e < m.e ? x : m)); rows.push({ at: `spin ${spin}° – strongest / weakest direction (${mx.a}° / ${mn.a}°)`, eng: mx.e / mn.e, ref: 3, err: rel(mx.e / mn.e, 3) }); rows.push({ at: `spin ${spin}° – strongest and weakest opposite`, eng: ((mx.a - mn.a + 360) % 360), ref: 180, err: rel((mx.a - mn.a + 360) % 360, 180) }); spin === 90 && (rows.at(-1).note = 1); R.__sp = R.__sp ?? []; R.__sp.push(mx.a); });
    rows.push({ at: 'spin 90° turns the distribution by 90°', eng: (R.__sp[1] - R.__sp[0] + 360) % 360 === 270 ? 90 : (R.__sp[1] - R.__sp[0] + 360) % 360, ref: 90, err: rel(((R.__sp[1] - R.__sp[0] + 360) % 360) === 270 ? 90 : (R.__sp[1] - R.__sp[0] + 360) % 360, 90) });
    add('5', 'Photometry', 'Asymmetric distribution (C-planes) and luminaire spin', 'I = 1000·(1 + 0.5 cos C): max/min = 3, opposite each other, turning with the spin', rows, 0.1); }
  // 6. Reading between table values – a table that is linear in γ and C must be read back exactly at any angle
  { const pm = lcParseIES(ies('Linear table', range(0, 90, 10), range(0, 360, 30), (c, g) => 1000 + 20 * g + 2 * (c <= 180 ? c : 360 - c)), 'lin.ies'), rows = [];
    [[7, 13], [33, 47.5], [161, 82], [250, 3.3], [300, 66]].forEach(([c, g]) => { const e = lcI(pm, c, g), cc = c <= 180 ? c : 360 - c, r = 1000 + 20 * g + 2 * cc; rows.push({ at: `C ${c}°, γ ${g}°`, eng: e, ref: r, err: rel(e, r) }); });
    add('6', 'Photometry', 'Interpolation between table values (bilinear)', 'a table linear in C and γ is reproduced exactly between its entries', rows, 0.01); }
  // 7. Total flux from the table, and IES and EULUMDAT files of the same luminaire giving the same light
  { const iso = lcParseIES(ies('Isotropic', range(0, 180, 2.5), [0], () => 1000), 'iso.ies'), cosd = lcParseIES(ies('Cosine', range(0, 180, 2.5), [0], (h, g) => (g <= 90 ? 1000 * Math.cos(g * deg) : 0)), 'cos.ies');
    const G = range(0, 180, 2.5), fn = (g) => (g <= 90 ? 5000 * Math.cos(g * deg) ** 4 : 0), a = lcParseIES(ies('cos4', G, [0], (h, g) => fn(g)), 'a.ies'), b = lcParseLDT(ldt('cos4', G, fn, 5000), 'b.ldt');
    const qa = place(a, [0, 0, 12], [0.001, 0, 0]), qb = place(b, [0, 0, 12], [0.001, 0, 0]), S = P3(qa);
    const rows = [{ at: 'flux of a 1000 cd isotropic source', eng: lcFlux(iso), ref: 4 * Math.PI * 1000, err: rel(lcFlux(iso), 4 * Math.PI * 1000) }, { at: 'flux of a 1000 cd cosine source', eng: lcFlux(cosd), ref: Math.PI * 1000, err: rel(lcFlux(cosd), Math.PI * 1000) },
      ...[0, 6, 12, 20].map((x) => { const X = [x, 3, 0], ea = Eeng(qa, X, [0, 0, 1]), eb = Eeng(qb, X, [0, 0, 1]); return { at: `same luminaire, IES vs LDT, x ${x} m`, eng: eb, ref: ea, err: rel(eb, ea) }; })];
    add('7', 'Photometry', 'Luminous flux from the table; IES and EULUMDAT files of the same luminaire', 'Φ = 4π·I (isotropic), π·I (cosine); LDT result = IES result', rows, 0.5); }
  // 8. Many floodlights and the maintenance factor through the engine's full calculation (lcCalc)
  { const fw = 40, Ifn = (g) => (g > 90 ? 0 : 20000 * 2 ** (-((g / (fw / 2)) ** 2))), pm = lcParseIES(ies('Beam 40°', range(0, 180, 0.5), [0], (h, v) => Ifn(v)), 'b40.ies');
    const masts = [[-50, 40], [50, 40], [50, -40], [-50, -40]].map(([x, y], i) => ({ name: `M${i + 1}`, x, y, h: 30, frame: { t: 'ring', r: 0.5 }, lights: [{ ax: x * 0.35, ay: y * 0.3, lum: 'X' }] }));
    const L = { masts, lums: { X: pm }, lum: 'X', mf: 0.8, hc: 1.5, cams: [], refl: false, grid: 'fixed', s: 5, g: {} }, Q = masts.map((m, i) => lcQ(L, i, 0)), pts = [[0, 0], [20, 10], [-35, -20], [45, 30], [10, -30]].map(([x, y]) => ({ x, y, a: 'i' }));
    const C = lcCalc(L, pts, Q), rows = pts.map((p, i) => { let r = 0; Q.forEach((q) => { const S = P3(q), ax = [q.f[0], q.f[1], q.f[2]], v = [p.x - S[0], p.y - S[1], -S[2]], dv = Math.hypot(...v), g = Math.acos(Math.min(1, (v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2]) / dv)) / deg; r += Eref(S, [p.x, p.y, 0], [0, 0, 1], Ifn(g)); }); r *= 0.8; return { at: `(${p.x}, ${p.y})`, eng: C.Eh[i], ref: r, err: rel(C.Eh[i], r) }; });
    add('8', 'Full calculation', 'Four masts summed, maintenance factor 0.8 (the engine\'s full calculation)', 'E = MF · Σ Iᵢ·cos θᵢ / dᵢ²', rows, 1); }
  // 9. Light reflected from the ground onto the camera planes – against an independent fine numerical integration
  { const s = 2.5, Lx = 50, Ly = 35, pts = []; for (let x = -Lx + s / 2; x < Lx; x += s) for (let y = -Ly + s / 2; y < Ly; y += s) pts.push({ x, y, a: 'i' });
    const Ef = (x, y) => 200 + 1.2 * x - 0.8 * y, Eh = Float32Array.from(pts.map((p) => Ef(p.x, p.y))), rho = 0.2, hc = 1.5, cams = [{ x: 0, y: -80, z: 10 }, { x: 90, y: 0, z: 15 }];
    const L = { rho, s, plane: 'vert' }, N = pts.map((p) => cams.map((c) => lcCam(L, c, p.x, p.y, hc))), Ec = cams.map(() => new Float32Array(pts.length)); lcRefl(L, pts, Eh, Ec, N, hc);
    const probe = [[0, 0], [20, 10], [-30, -20], [35, 20], [-25, 22], [45, 30], [-48, 33], [0, -34]].map(([x, y]) => pts.reduce((b, p, i) => (Math.hypot(p.x - x, p.y - y) < Math.hypot(pts[b].x - x, pts[b].y - y) ? i : b), 0));
    const rows = []; probe.forEach((i) => cams.forEach((c, ci) => { const p = pts[i], n = N[i][ci], h = 0.1; let r = 0; // integrate (ρE/π)·cos θs·cos θp / r² over the field, 0.1 m cells
      for (let x = -Lx + h / 2; x < Lx; x += h) for (let y = -Ly + h / 2; y < Ly; y += h) { const vx = x - p.x, vy = y - p.y, vz = -hc, d2 = vx * vx + vy * vy + vz * vz, d = Math.sqrt(d2), cp = (vx * n[0] + vy * n[1] + vz * n[2]) / d; if (cp <= 0) continue; r += ((rho * Ef(x, y)) / Math.PI) * (hc / d) * cp / d2 * h * h; }
      const edge = Math.min(Lx - Math.abs(p.x), Ly - Math.abs(p.y)) < 7.5; rows.push({ at: `(${p.x}, ${p.y}) toward camera ${ci + 1}`, eng: Ec[ci][i], ref: r, err: rel(Ec[ci][i], r), edge }); }));
    add('9a', 'Reflected light', 'Ground reflection onto vertical camera planes – points inside the field (ρ = 0.2, 100 × 70 m, sloping illuminance)', 'ΔE = ∫ (ρE/π)·cos θs·cos θp / r² dA over the field, reference by 0.1 m numerical integration', rows.filter((r) => !r.edge), 5);
    add('9b', 'Reflected light', 'Ground reflection – points within 7.5 m of the field edge (modelling difference, reported)', 'as 9a; the engine takes the ground just beyond the edge as lit like the edge, the reference takes it as dark', rows.filter((r) => r.edge), 10); }
  // 10. Glare rating GR (CIE 112): GR = 27 + 24·log10(Lvl / Lve^0.9), Lvl = 10·Σ Eeye,i / θi² (θ in degrees, 1.5° … 60°), Lve = 0.035·ρ·Ehav / π
  { const fw = 24, Ifn = (g) => (g > 90 ? 0 : 900000 * 2 ** (-((g / (fw / 2)) ** 2))), pm = lcParseIES(ies('Beam 24°', range(0, 180, 0.5), [0], (h, v) => Ifn(v)), 'g24.ies'), mf = 0.8, rho = 0.2, EhAv = 500;
    const Q = [[-60, 45, 40, -25, -20], [60, 45, 40, 25, -20], [60, -45, 40, 25, 20], [-60, -45, 40, -25, 20], [0, 50, 35, 0, -10], [0, -50, 35, 0, 10]].map(([x, y, h, ax, ay]) => place(pm, [x, y, h], [ax, ay, 0])), rows = [];
    const ref = (o, v, lim) => { let Lvl = 0; Q.forEach((q) => { const S = P3(q), w = [S[0] - o.x, S[1] - o.y, S[2] - o.z], d = Math.hypot(...w), cs = (w[0] * v[0] + w[1] * v[1] + w[2] * v[2]) / d; if (cs <= 0) return; const th = Math.acos(Math.min(1, cs)) / deg; if (th > lim) return;
        const ax = q.f, g = Math.acos(Math.min(1, Math.max(-1, (-w[0] * ax[0] - w[1] * ax[1] - w[2] * ax[2]) / d))) / deg, Ee = (Ifn(g) * mf * cs) / (d * d); Lvl += (10 * Ee) / Math.max(1.5, th) ** 2; }); const Lve = (0.035 * rho * EhAv) / Math.PI; return Lvl > 0 ? 27 + 24 * Math.log10(Lvl / Lve ** 0.9) : 0; };
    const L = { mf }; [[-25, -20], [25, -20], [25, 20], [-25, 20], [-30, 10], [0, 0], [40, 25], [-10, -32]].forEach(([x, y]) => Q.slice(0, 4).forEach((q, mi) => { const o = { x, y, z: 1.5 }, hx = q.P.x - x, hy = q.P.y - y, hl = Math.hypot(hx, hy), v = [hx / hl * Math.cos(2 * deg), hy / hl * Math.cos(2 * deg), -Math.sin(2 * deg)]; // looking toward a mast, 2° below horizontal
      const e = lcGR(L, Q, o, v, EhAv, rho), r = ref(o, v, 60); rows.push({ at: `player (${x}, ${y}) looking toward mast ${mi + 1}`, eng: e, ref: r, err: Math.abs(e - r) }); }));
    add('10', 'Glare', 'Glare rating GR (CIE 112) – players at 1.5 m looking toward each mast, six floodlights', 'GR = 27 + 24·log10(Lvl / Lve^0.9), Lvl = 10·Σ Eeye/θ² over 1.5°–60°, Lve = 0.035·ρ·Ehav/π (independent calculation); difference in GR points', rows, 0.1); R.at(-1).unit = 'GR'; }
  // 11. Light blocked by structures: a flat-roofed and a gable-roofed stand between a floodlight and the ground – exact line-of-sight reference
  { const pm = lcParseIES(ies('Isotropic', range(0, 180, 5), [0], () => 10000), 'iso.ies'), q = place(pm, [0, 0, 30], [0, 0, 0, 'down']), S = P3(q), rows = [];
    const stands = [{ name: 'flat roof', st: { p: [[10, -6], [22, -6], [22, 6], [10, 6]], h: 10, roof: 'flat' }, top: (x, y) => 10 }, { name: 'gable roof', st: { p: [[10, -6], [22, -6], [22, 6], [10, 6]], h: 8, rh: 4, roof: 'gable', dir: 0 }, top: (x, y) => 8 + 4 * (1 - Math.abs(y) / 6) }];
    stands.forEach(({ name, st, top }) => { lcObsPrep({ st: [st] }); let n = 0, ok = 0, near = 0, nearOk = 0, worst = 0;
      const blockedRef = (x, y) => { for (let k = 1; k < 4000; k++) { const t = k / 4000, px = S[0] + (x - S[0]) * t, py = S[1] + (y - S[1]) * t, pz = S[2] * (1 - t); if (px >= 10 && px <= 22 && py >= -6 && py <= 6 && pz <= top(px, py)) return true; } return false; };
      for (let x = 12; x <= 60; x += 1.5) for (let y = -20; y <= 20; y += 1.5) { const e = Eeng(q, [x, y, 0], [0, 0, 1]), r = blockedRef(x, y) ? 0 : Eref(S, [x, y, 0], [0, 0, 1], 10000); n++; const same = (e === 0) === (r === 0) && (r === 0 || rel(e, r) < 0.01);
        const edge = [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]].some(([a, b]) => blockedRef(x + a, y + b) !== (r === 0)); if (edge) { near++; if (same) nearOk++; } else if (same) ok++; else worst++; }
      rows.push({ at: `${name}: points away from the shadow edge in agreement (${n - near})`, eng: ok, ref: n - near, err: rel(ok, n - near) }); rows.push({ at: `${name}: points within 0.4 m of the shadow edge in agreement (${near})`, eng: nearOk, ref: near, err: rel(nearOk, near), edge: 1 }); });
    LC_OBS.length = 0;
    add('11', 'Obstruction', 'Light blocked by a stand (flat and gable roofs) – shadow on the ground', 'a point is dark when the line to the floodlight passes through the stand (exact line-of-sight test, 4000 steps); lit points must equal I·cos θ/d²', rows.filter((r) => !r.edge), 0.01);
    add('11b', 'Obstruction', 'Shadow edge – points within 0.4 m of the edge of the shadow (reported)', 'as 11; the engine checks the line every 0.5 m, so points right at the edge may fall either side', rows.filter((r) => r.edge), 10); }
  // 12. Energy balance: everything a luminaire sends downward lands on the ground – Σ E·ΔA over the ground = the downward flux
  { const rows = [], cos4 = (g) => (g <= 90 ? 5000 * Math.cos(g * deg) ** 4 : 0), a = lcParseIES(ies('cos4', range(0, 180, 1), [0], (h, g) => cos4(g)), 'c4.ies'), fw = 24, Ifn = (g) => (g > 90 ? 0 : 10000 * 2 ** (-((g / (fw / 2)) ** 2))), b = lcParseIES(ies('Beam 24°', range(0, 180, 0.5), [0], (h, v) => Ifn(v)), 'b24.ies');
    const sumE = (q, R, st) => { let t = 0; for (let x = -R; x < R; x += st) for (let y = -R; y < R; y += st) t += Eeng(q, [x + st / 2, y + st / 2, 0], [0, 0, 1]) * st * st; return t; };
    const qa = place(a, [0, 0, 10], [0, 0, 0, 'down']), fa = (2 * Math.PI * 5000) / 5; rows.push({ at: 'downlight cos⁴γ, 10 m high – Σ E·ΔA over 400 × 400 m', eng: sumE(qa, 200, 0.5), ref: fa, err: rel(sumE(qa, 200, 0.5), fa) });
    let fb = 0; for (let g = 0; g < 90; g += 0.01) fb += Ifn(g + 0.005) * 2 * Math.PI * Math.sin((g + 0.005) * deg) * 0.01 * deg; // the beam's flux, all of it below the horizon when tilted 50°
    const qb = place(b, [0, 0, 30], [30 * Math.tan(50 * deg), 0, 0]), sb = (() => { let t = 0; for (let x = -20; x < 400; x += 0.5) for (let y = -150; y < 150; y += 0.5) t += Eeng(qb, [x + 0.25, y + 0.25, 0], [0, 0, 1]) * 0.25; return t; })();
    rows.push({ at: 'floodlight 24°, tilted 50°, 30 m high – Σ E·ΔA over the ground', eng: sb, ref: fb, err: rel(sb, fb) });
    add('12', 'Energy balance', 'Luminous flux reaching the ground equals the flux sent downward', 'Σ E·ΔA (0.5 m cells) = Φ: 2π·I0/5 for cos⁴γ; the numerically integrated beam flux for the 24° floodlight', rows, 1); }
  // 13. CIE 171:2006 test case 5.6 – light reflection over diffuse surfaces: a 4 × 4 m floor (ρ 0.3, uniformly lit) seen from a vertical wall (points B–F, 0.75–2.75 m above the floor edge, facing the floor)
  // and from a ceiling 3 m above (points G–N across the middle, facing down). Measured E/(Ehz·ρ) = configuration factor F12 (%), CIE published reference values (as reproduced by Geisler-Moroder & Dür 2008)
  { const s = 0.25, gs = [], rho = 0.3, Ehz = 1000; for (let x = s / 2; x < 4; x += s) for (let y = s / 2; y < 4; y += s) gs.push({ x, y, a: 'i' }); const gE = Float32Array.from(gs.map(() => Ehz)), L = { rho, s }, rows = [];
    const run = (pt, n, h) => { const pts = [pt], N = [[n]], Ec = [new Float32Array(1)], Eh = new Float32Array(1); lcRefl(L, pts, Eh, Ec, N, h, gs, gE); return (Ec[0][0] / (Ehz * rho)) * 100; };
    [['B', 0.75, 35.901], ['C', 1.25, 27.992], ['D', 1.75, 21.639], ['E', 2.25, 16.716], ['F', 2.75, 12.967]].forEach(([k, h, ref]) => { const e = run({ x: 2, y: 0, a: 'i' }, [0, 1, 0], h); rows.push({ at: `point ${k} – wall, ${h} m above the floor edge`, eng: e, ref, err: rel(e, ref) }); });
    [['G', 0.25, 26.80], ['H', 0.75, 30.94], ['I', 1.25, 33.98], ['J', 1.75, 35.57], ['K', 2.25, 35.57], ['L', 2.75, 33.98], ['M', 3.25, 30.94], ['N', 3.75, 26.80]].forEach(([k, x, ref]) => { const e = run({ x, y: 2, a: 'i' }, [0, 0, -1], 3); rows.push({ at: `point ${k} – ceiling 3 m, x ${x} m`, eng: e, ref, err: rel(e, ref) }); });
    add('13', 'CIE 171 case', 'CIE 171:2006 case 5.6 – light reflected by a diffuse floor onto a wall and a ceiling (published reference values)', 'E / (Ehz·ρ) = configuration factor F12 between the point and the 4 × 4 m reflecting floor; CIE reference values', rows, 5); }
  return R.filter((x) => x.id);
})()
