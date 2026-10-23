/* BS 7671 course – shared data: cable ratings, rating factors, conductor resistance, protective device models.
   Cable ratings are the same figures the Design Tools cable engine uses (ACL catalogue, which reproduces the BS 7671 Appendix 4 tables).
   Device curves are teaching models fitted to the BS EN 60898 / BS 88 limits – every number carries "check against BS 7671". */
var BS = (function () {
  var CABLES = {
    te: { name: 'Flat twin and earth 70 °C PVC (6242Y)', short: 'Twin & earth', ins: 'PVC', k: 115, sizes: [1, 1.5, 2.5, 4, 6, 10, 16],
      methods: { C: [16, 20, 27, 37, 47, 64, 85], A: [11.5, 14.5, 20, 26, 32, 44, 57], '100': [13, 16, 21, 27, 34, 45, 57], '101': [10.5, 13, 17, 22, 27, 36, 46], '102': [13, 16, 21, 27, 35, 47, 63], '103': [8, 10, 13.5, 17.5, 23.5, 32, 42.5] },
      mv: [44, 29, 18, 11, 7.3, 4.4, 2.8], cpc: { 1: 1, 1.5: 1, 2.5: 1.5, 4: 1.5, 6: 2.5, 10: 4, 16: 6 } },
    cu1: { name: 'Single-core 70 °C PVC in conduit / trunking', short: 'Singles in conduit', ins: 'PVC', k: 115, sizes: [1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300],
      methods: { A: [11, 14.5, 19.5, 26, 34, 46, 61, 80, 99, 119, 151, 182, 210, 240, 273, 321, 367], B: [13.5, 17.5, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269, 300, 341, 400, 458], C: [15.5, 20, 27, 37, 47, 65, 87, 114, 141, 182, 234, 284, 330, 381, 436, 515, 594] },
      methods3: { A: [10.5, 13.5, 18, 24, 31, 42, 56, 73, 89, 108, 136, 164, 188, 216, 245, 286, 328], B: [12, 15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239, 262, 296, 346, 394], C: [14, 18, 25, 33, 43, 59, 79, 104, 129, 167, 214, 261, 303, 349, 400, 472, 545] },
      mv3: [38, 25, 15, 9.5, 6.4, 3.8, 2.4, 1.5, 1.1, 0.84, 0.6, 0.47, 0.4, 0.34, 0.31, 0.27, 0.25] },
    swa: { name: 'Multicore 70 °C PVC armoured (SWA)', short: 'PVC/SWA/PVC', ins: 'PVC', k: 115, sizes: [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300],
      methods: { C: [21, 28, 38, 49, 67, 89, 118, 145, 175, 222, 269, 310, 356, 405, 476, 547], E: [22, 31, 41, 53, 72, 97, 128, 157, 190, 241, 291, 336, 386, 439, 516, 592], D: [22, 29, 37, 46, 60, 78, 99, 119, 140, 173, 204, 231, 261, 292, 336, 379] },
      methods3: { C: [18, 25, 33, 42, 58, 77, 102, 125, 151, 192, 231, 267, 306, 348, 409, 469], E: [19, 26, 35, 45, 62, 83, 110, 135, 163, 207, 251, 290, 332, 378, 445, 510], D: [18, 24, 30, 38, 50, 64, 82, 98, 116, 143, 169, 192, 217, 243, 280, 316] },
      mv3: [25, 15, 9.5, 6.4, 3.8, 2.4, 1.5, 1.1, 0.81, 0.57, 0.43, 0.35, 0.29, 0.25, 0.21, 0.185] },
    xswa: { name: 'Multicore 90 °C XLPE armoured (SWA)', short: 'XLPE/SWA/LSZH', ins: 'XLPE', k: 143, sizes: [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300],
      methods: { C: [27, 36, 49, 62, 85, 110, 146, 180, 219, 279, 338, 392, 451, 515, 607, 698], E: [29, 39, 52, 66, 90, 115, 152, 188, 228, 291, 354, 410, 472, 539, 636, 732], D: [25, 33, 43, 53, 71, 91, 116, 139, 164, 203, 239, 271, 306, 343, 395, 446] },
      methods3: { C: [23, 31, 42, 53, 73, 94, 124, 154, 187, 238, 289, 335, 386, 441, 520, 599], E: [25, 33, 44, 56, 78, 99, 131, 162, 197, 251, 304, 353, 406, 463, 546, 628], D: [21, 28, 36, 44, 58, 75, 96, 115, 135, 167, 197, 223, 251, 281, 324, 365] },
      mv3: [27, 16, 10, 6.8, 4, 2.5, 1.65, 1.15, 0.87, 0.6, 0.45, 0.37, 0.3, 0.26, 0.22, 0.195] }
  };
  var METHOD_NAMES = { A: 'A – enclosed in conduit in a thermally insulating wall', B: 'B – enclosed in conduit / trunking on a wall', C: 'C – clipped direct', D: 'D – in a duct in the ground', E: 'E – on a perforated tray / free air', '100': '100 – above a plasterboard ceiling, insulation ≤ 100 mm', '101': '101 – above a plasterboard ceiling, insulation > 100 mm', '102': '102 – in a stud wall with insulation, touching the inner wall', '103': '103 – in a stud wall with insulation, not touching the inner wall' };
  var CA_PVC = [[25, 1.03], [30, 1], [35, 0.94], [40, 0.87], [45, 0.79], [50, 0.71], [55, 0.61], [60, 0.5]];
  var CA_XLPE = [[25, 1.02], [30, 1], [35, 0.96], [40, 0.91], [45, 0.87], [50, 0.82], [55, 0.76], [60, 0.71]];
  var CG = { n: [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 20], bunched: [1, 0.8, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.5, 0.45, 0.41, 0.38], wall: [1, 0.85, 0.79, 0.75, 0.73, 0.72, 0.72, 0.71, 0.7, 0.7, 0.7, 0.7], tray: [1, 0.88, 0.82, 0.77, 0.75, 0.73, 0.73, 0.72, 0.72, 0.72, 0.72, 0.72] };
  var CI = [[0, 1, 'none'], [50, 0.88, '50 mm'], [100, 0.78, '100 mm'], [200, 0.63, '200 mm'], [400, 0.51, '400 mm'], [500, 0.5, '500 mm or more']];
  var R20 = { 1: 18.1, 1.5: 12.1, 2.5: 7.41, 4: 4.61, 6: 3.08, 10: 1.83, 16: 1.15, 25: 0.727, 35: 0.524, 50: 0.387, 70: 0.268, 95: 0.193, 120: 0.153, 150: 0.124, 185: 0.0991, 240: 0.0754, 300: 0.0601 };
  var STD = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400];
  var MCB_MULT = { B: [3, 5], C: [5, 10], D: [10, 20] };
  var FUSE_IA04 = { 6: 26, 10: 43, 16: 81, 20: 123, 25: 152, 32: 210, 40: 266, 50: 364, 63: 486, 80: 640, 100: 850, 125: 1100, 160: 1450, 200: 1900 };

  var stepUp = function (pairs, v) { for (var i = 0; i < pairs.length; i++) if (pairs[i][0] >= v - 1e-9) return pairs[i][1]; return pairs[pairs.length - 1][1]; };
  var cg = function (n, arr) { var i = 0; while (i < CG.n.length - 1 && CG.n[i] < n) i++; return CG[arr || 'bunched'][i]; };
  var ca = function (t, ins) { return stepUp(ins === 'XLPE' ? CA_XLPE : CA_PVC, t); };
  var ci = function (mm) { var r = 1; CI.forEach(function (x) { if (mm >= x[0]) r = x[1]; }); return r; };
  var tempMult = function (ins) { return ins === 'XLPE' ? 1.28 : 1.2; };
  var r12 = function (line, cpc, ins) { return ((R20[line] + R20[cpc]) / 1000) * tempMult(ins || 'PVC'); };

  /* Protective devices: { kind: 'B' | 'C' | 'D' | 'fuse' | 'rcbo-B' …, In }. ia(dev, t) = current that disconnects in time t (s). */
  var dev = function (kind, In) { return { kind: kind, In: In, label: kind === 'fuse' ? In + ' A BS 88 gG fuse' : 'Type ' + kind + ' ' + In + ' A MCB' }; };
  var ia = function (d, t) {
    if (d.kind === 'fuse') { var a = FUSE_IA04[d.In] || d.In * 7, c = 1.5 * d.In, m = 4.2; return c + (a - c) * Math.pow(0.4 / (t || 0.4), 1 / m); }
    return MCB_MULT[d.kind][1] * d.In;
  };
  var zsMax = function (d, t, u0) { return (0.95 * (u0 || 230)) / ia(d, t || 0.4); };
  /* Disconnection time for a fault current I (typical curve; MCBs use the top of the magnetic band – the worst case) */
  var tAt = function (d, I) {
    if (d.kind === 'fuse') { var a = FUSE_IA04[d.In] || d.In * 7, c = 1.5 * d.In, m = 4.2; if (I <= c * 1.0001) return Infinity; return Math.min(1e4, 0.4 * Math.pow((a - c) / (I - c), m)); }
    var r = I / d.In, hi = MCB_MULT[d.kind][1], lo = MCB_MULT[d.kind][0];
    if (r >= hi) return 0.008;
    if (r <= 1.13) return Infinity;
    var th = 40 / (r * r - 1.2769);
    if (r >= lo) return Math.min(th, 5);
    return Math.min(th, 1e4);
  };
  var tMin = function (d, I) { if (d.kind === 'fuse') return tAt(d, I * 1.25); var r = I / d.In, lo = MCB_MULT[d.kind][0]; if (r >= lo) return 0.005; if (r <= 1.45) return Infinity; return Math.min(1e4, 20 / (r * r - 2.1)); };
  var nextStd = function (x) { for (var i = 0; i < STD.length; i++) if (STD[i] >= x - 1e-9) return STD[i]; return null; };
  var r = function (x, n) { var p = Math.pow(10, n == null ? 2 : n); return Math.round(x * p) / p; };
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  var rnd = function (lo, hi, st) { st = st || 1; return r(lo + Math.floor(Math.random() * ((hi - lo) / st + 1)) * st, 4); };
  return { CABLES: CABLES, METHOD_NAMES: METHOD_NAMES, CA_PVC: CA_PVC, CA_XLPE: CA_XLPE, CG: CG, CI: CI, R20: R20, STD: STD, MCB_MULT: MCB_MULT, FUSE_IA04: FUSE_IA04,
    ca: ca, cg: cg, ci: ci, r12: r12, tempMult: tempMult, dev: dev, ia: ia, zsMax: zsMax, tAt: tAt, tMin: tMin, nextStd: nextStd, r: r, pick: pick, rnd: rnd, stepUp: stepUp };
})();
