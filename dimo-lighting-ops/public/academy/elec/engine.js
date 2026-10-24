/* Electrical troubleshooting simulator – a site is a tree of elements (supply → boards → protective devices → controls → cables / joints → loads)
   plus control elements (key cards, timers, photocells, sensors, KNX, DALI, DMX, 1-10 V) and bus systems. Faults change how each element
   behaves; evaluate() works out what is live, which devices trip, what each load does and what every instrument reads.
   A session hides one or more random faults from the scenario's pool; the learner tests, isolates safely and names the faults. */
var EF = (function () {
  const OC = ['mcb', 'rcbo', 'fuse', 'mccb', 'cutout', 'olr'];
  const RCD = ['rcd', 'rcbo'];
  const PROT = OC.concat(['rcd', 'isolator', 'ccr']);
  const CTL = ['keycard', 'timer', 'photocell', 'pir', 'knxsw', 'knxpsu', 'dalipsu', 'dalictl', 'dmxcon', 'ctl110', 'push', 'knxcoupler', 'sense'];
  const LIGHT = ['lum', 'rgbw', 'profile', 'lamp'];
  const LOAD = ['lum', 'socket', 'motor', 'heater', 'emerg', 'rgbw', 'profile', 'lamp', 'fan'];
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const r1 = (x, n = 2) => (Number.isFinite(x) ? (+x.toFixed(n)).toString() : '∞');
  const R20 = { 1: 18.1, 1.5: 12.1, 2.5: 7.41, 4: 4.61, 6: 3.08, 10: 1.83, 16: 1.15, 25: 0.727, 35: 0.524, 50: 0.387, 70: 0.268, 95: 0.193 };

  // ---------------------------------------------------------------- model helpers
  function build(S) {
    const els = {}, kids = {};
    S.els.forEach((e) => { els[e.id] = e; kids[e.id] = []; });
    S.els.forEach((e) => { if (e.parent) kids[e.parent].push(e.id); });
    const order = [], seen = new Set();
    const visit = (id) => { if (seen.has(id)) return; seen.add(id); order.push(id); kids[id].forEach(visit); };
    S.els.filter((e) => !e.parent).forEach((e) => visit(e.id));
    S.els.forEach((e) => { let p = e.parent; e.ph = e.ph || null; while (!e.ph && p) { e.ph = els[p].ph; p = els[p].parent; } if (!e.ph) e.ph = 'L1'; });
    const anc = (id) => { const a = []; let p = els[id].parent; while (p) { a.push(p); p = els[p].parent; } return a; };
    const sub = (id) => { const out = []; const go = (x) => { out.push(x); kids[x].forEach(go); }; go(id); return out; };
    S._ = { els, kids, order, anc, sub };
    return S;
  }
  const isLoad = (e) => LOAD.includes(e.kind);
  const isCtl = (e) => CTL.includes(e.kind);

  // ---------------------------------------------------------------- session state
  function newState(S, faults, inputs) {
    const st = { S, faults, fm: {}, in: {}, tripped: new Set(), tripWhy: {}, off: new Set(), locked: new Set(), proved: new Set(), latch: {}, disc: false, log: [], safety: 2, hints: 0, meas: 0, msgs: [], fuseOut: new Set() };
    (S.inputs || []).forEach((i) => { st.in[i.k] = i.v; });
    Object.assign(st.in, inputs || {});
    faults.forEach((f) => { (st.fm[f.el] = st.fm[f.el] || {})[f.mode] = f.val ?? true; if (f.mode === 'blown') { st.tripped.add(f.el); st.tripWhy[f.el] = 'blown'; } });
    (S.els || []).forEach((e) => { if (e.latch) st.latch[e.id] = !!e.on; });
    return st;
  }
  const F = (st, id, mode) => (st.fm[id] ? st.fm[id][mode] : undefined);

  // ---------------------------------------------------------------- the simulation
  function evaluate(st, opt) {
    const S = st.S, { els, kids, order, anc, sub } = S._, sup = els[order[0]];
    const lost = new Set(); if (F(st, sup.id, 'lost')) lost.add(F(st, sup.id, 'lost'));
    const pen = !!F(st, sup.id, 'pen'), baseV = F(st, sup.id, 'lowV') ? 196 : 230;
    const R = { live: {}, nOk: {}, eOk: {}, loads: {}, cur: {}, leak: {}, danger: {}, hot: {}, out: {}, flick: {}, trips: [], bus: {}, v: baseV, pen, lost };
    for (let it = 0; it < 8; it++) {
      let changed = false;
      // control outputs (need their own supply) – from the previous pass
      order.forEach((id) => {
        const e = els[id], p = e.parent;
        const pl = p ? R.live[p] : true, pn = p ? R.nOk[p] : true, pe = p ? R.eOk[p] : true;
        const phOk = e.ph === '3P' ? lost.size === 0 : !lost.has(e.ph);
        let pass = true;
        switch (e.kind) {
          case 'supply': pass = !F(st, id, 'dead'); break;
          case 'mcb': case 'rcbo': case 'fuse': case 'mccb': case 'cutout': case 'rcd': case 'isolator': case 'olr': case 'ccr':
            pass = !st.tripped.has(id) && !st.off.has(id) && !st.locked.has(id) && !(F(st, id, 'stuck') && st.tripped.has(id)) && !F(st, id, 'open'); break;
          case 'cable': case 'jb': pass = !F(st, id, 'openL'); break;
          case 'switch': pass = (!!st.in[e.in] || !!F(st, id, 'stuckOn')) && !F(st, id, 'stuckOff'); break;
          case '2way': { const a = !!st.in[e.in[0]], b = !!st.in[e.in[1]]; pass = F(st, id, 'strapper') ? a : a !== b; if (F(st, id, 'stuckOff')) pass = false; break; }
          case 'contactor': pass = contactorPass(st, R, e); break;
          case 'knxact': pass = knxActPass(st, R, e); break;
          case 'cvpsu': pass = !F(st, id, 'dead'); break;
          default: pass = true;
        }
        const live = !!(pl && phOk && (isCtl(e) || isLoad(e) ? true : pass));
        const nOk = !!(pn && !F(st, id, 'openN') && !(pen && e.kind === 'board'));
        const eOk = !!(pe && !F(st, id, 'openE'));
        R.out[id] = pass;
        if (R.live[id] !== live || R.nOk[id] !== nOk || R.eOk[id] !== eOk) changed = true;
        R.live[id] = live; R.nOk[id] = nOk; R.eOk[id] = eOk;
      });
      // controls and buses
      order.forEach((id) => { const e = els[id]; if (isCtl(e)) R.out[id] = ctlOut(st, R, e); });
      busEval(st, R);
      // loads
      const cur = {};
      order.forEach((id) => { const e = els[id]; if (isLoad(e)) { R.loads[id] = loadState(st, R, e); } });
      // currents up the tree
      order.slice().reverse().forEach((id) => { const e = els[id]; let c = isLoad(e) ? R.loads[id].amps : 0; kids[id].forEach((k) => { c += cur[k] || 0; }); cur[id] = c; });
      R.cur = cur;
      // trips
      const trip = (dev, why) => { if (!dev || st.tripped.has(dev)) return; st.tripped.add(dev); st.tripWhy[dev] = why; R.trips.push(dev); changed = true; };
      const nearest = (id, kinds, skip) => anc(id).find((a) => kinds.includes(els[a].kind) && !(skip && skip(a)));
      const leakBy = {};
      st.faults.forEach((f) => {
        const e = els[f.el]; if (!e) return;
        const atLive = R.live[f.el] && (!isLoad(e) || R.loads[f.el].supplied);
        if (f.mode === 'shortLN' && atLive && (!isLoad(e) || R.loads[f.el].switchedOn)) trip(nearest(f.el, OC, (a) => F(st, a, 'weld') || els[a].kind === 'olr'), 'Short circuit (overcurrent)');
        if (f.mode === 'faultLE' && atLive && (!isLoad(e) || R.loads[f.el].switchedOn)) {
          const rc = nearest(f.el, RCD, (a) => F(st, a, 'notrip'));
          if (rc) trip(rc, 'Earth leakage (residual current)');
          else if (S.earthing !== 'TT' && R.eOk[f.el]) trip(nearest(f.el, OC, (a) => F(st, a, 'weld') || els[a].kind === 'olr'), 'Earth fault (overcurrent)');
        }
        if (f.mode === 'faultNE' && !anc(f.el).some((a) => st.locked.has(a))) {
          const rc = nearest(f.el, RCD, (a) => F(st, a, 'notrip'));
          if (rc && sub(rc).some((x) => R.loads[x] && R.loads[x].on)) trip(rc, 'Earth leakage (residual current)');
        }
        if (f.mode === 'irLow' && R.live[f.el] && (!f.when || st.in[f.when])) {
          const rc = nearest(f.el, RCD); if (rc) leakBy[rc] = (leakBy[rc] || 0) + (f.leak || 22);
        }
      });
      Object.keys(leakBy).forEach((rc) => { if (!F(st, rc, 'notrip') && leakBy[rc] >= 0.6 * (els[rc].idn || 30)) trip(rc, 'Earth leakage (residual current)'); });
      order.forEach((id) => {
        const e = els[id];
        if (!R.live[id] && !(st.tripped.has(id))) return;
        if (OC.includes(e.kind) && R.live[e.parent] && !st.tripped.has(id)) {
          const In = (e.rating || 16) * (F(st, id, 'under') ? 0.5 : 1);
          if (cur[id] > In * 1.3 && !F(st, id, 'over') && e.kind !== 'olr') trip(id, 'Overload');
          if (F(st, id, 'curve') && sub(id).some((x) => R.loads[x] && R.loads[x].on && els[x].kind === 'lum')) trip(id, 'Inrush current of the LED drivers (instantaneous trip)');
        }
        if (e.kind === 'rcd' || e.kind === 'rcbo') { if (F(st, id, 'nuisance') && R.live[e.parent] && sub(id).some((x) => R.loads[x] && R.loads[x].on && (els[x].kind === 'motor' || els[x].drive))) trip(id, 'Earth leakage (residual current)'); }
        if (e.kind === 'olr' && R.live[e.parent] && !st.tripped.has(id)) {
          const m = sub(id).map((x) => R.loads[x]).find((l) => l && l.single);
          const run = sub(id).map((x) => R.loads[x]).find((l) => l && l.on && l.motor);
          if (m && !F(st, id, 'setHigh')) trip(id, 'Motor overload (single-phasing)');
          if (run && F(st, id, 'setLow')) trip(id, 'Motor overload (setting below the motor current)');
        }
        if (e.kind === 'ccr' && R.live[e.parent] && !st.tripped.has(id) && sub(id).some((x) => els[x].kind === 'cable' && F(st, x, 'openL'))) trip(id, 'Open circuit in the series loop');
      });
      if (!changed) break;
    }
    // danger, heat and leakage
    st.faults.forEach((f) => {
      const e = els[f.el]; if (!e) return;
      if (f.mode === 'faultLE' && R.live[f.el] && (!isLoad(e) || (R.loads[f.el].supplied && R.loads[f.el].switchedOn))) R.danger[f.el] = S.earthing === 'TT' || !R.eOk[f.el] ? 'about 200 V on metalwork' : 'about 115 V on metalwork';
      if (f.mode === 'hrL' || f.mode === 'hrN') { if (R.cur[f.el] > 0.05) R.hot[f.el] = Math.round(35 + R.cur[f.el] * R.cur[f.el] * 0.25 + 25); }
      if (f.mode === 'over' && R.cur[f.el] > (els[f.el].rating || 16) * 0.6) R.hot[f.el] = Math.round(70 + R.cur[f.el]);
      if (f.mode === 'irLow' && R.live[f.el] && (!f.when || st.in[f.when])) R.leak[f.el] = f.leak || 22;
    });
    if (pen) order.forEach((id) => { if (els[id].metal || els[id].kind === 'board') R.danger[id] = 'up to 230 V on earthed metalwork (broken PEN)'; });
    return R;
  }

  function contactorPass(st, R, e) {
    if (F(st, e.id, 'welded')) return true;
    if (F(st, e.id, 'coilOpen')) return false;
    let cmd;
    if (e.latch) cmd = !!st.latch[e.id] && (!e.olr || !st.tripped.has(e.olr));
    else cmd = !!R.out[e.coil] && !!R.live[e.coil];
    if (e.coil2) cmd = cmd || (!!R.out[e.coil2] && !!R.live[e.coil2]);
    if (e.manual && st.in[e.manual] === 'on') cmd = true;
    if (e.manual && st.in[e.manual] === 'off') cmd = false;
    return cmd;
  }
  function knxActPass(st, R, e) {
    if (F(st, e.id, 'welded')) return true;
    if (F(st, e.id, 'dead')) return false;
    const ga = F(st, e.id, 'gaMissing') ? null : e.ga;
    const v = ga ? R.bus['ga:' + ga] : undefined;
    if (v === undefined) return !!st.latch[e.id];
    st.latch[e.id] = !!v; return !!v;
  }
  function ctlOut(st, R, e) {
    const id = e.id, on = R.live[id];
    switch (e.kind) {
      case 'keycard': return on && !!st.in[e.in] && !F(st, id, 'dead');
      case 'timer': {
        if (!on || F(st, id, 'dead')) return false;
        let t = +st.in[e.in]; if (F(st, id, 'clock')) t = (t + 12) % 24;
        const p = F(st, id, 'prog') || e.prog, a = p[0], b = p[1];
        return a > b ? t >= a || t < b : t >= a && t < b;
      }
      case 'photocell': if (!on) return false; if (F(st, id, 'stuckDay')) return false; if (F(st, id, 'stuckNight') || F(st, id, 'dirty')) return true; return !!st.in[e.in];
      case 'sense': if (!on || F(st, id, 'stuckOpen')) return false; return !!(R.loads[e.src] && R.loads[e.src].on);
      case 'pir': if (!on || F(st, id, 'dead')) return false; if (F(st, id, 'stuckOn')) return true; return !!st.in[e.in] && !(F(st, id, 'lux') && st.in[e.dayIn || 'day']);
      default: return on;
    }
  }

  // buses: KNX (power supply, couplers, sensors → group values), DALI (power supply, controller → levels), DMX (console → chain), 1-10 V
  function busEval(st, R) {
    const S = st.S, { els } = S._;
    (S.buses || []).forEach((b) => {
      if (b.kind === 'knx') {
        const psu = els[b.psu], ok = R.live[b.psu] && !F(st, b.psu, 'dead') && !F(st, b.id, 'short');
        const low = F(st, b.id, 'low') || F(st, b.psu, 'noChoke');
        R.bus[b.id] = { ok, v: !ok ? (F(st, b.id, 'short') ? 0.3 : 0) : low ? 20.5 : psu.v || 29.2, low };
        (b.sensors || []).forEach((sid) => {
          const s = els[sid]; if (!ok || F(st, sid, 'dead')) return;
          if (low && Math.random() < 0.5) return;
          const ga = F(st, sid, 'gaWrong') || s.ga;
          const line = s.line || 1, coupler = b.coupler;
          if (coupler && F(st, coupler, 'filter') === ga && line !== (b.actLine || line)) return;
          if (st.in[s.in] !== undefined) R.bus['ga:' + ga] = !!st.in[s.in];
        });
      }
      if (b.kind === 'dali') {
        const ok = R.live[b.psu] && !F(st, b.psu, 'dead') && !F(st, b.id, 'short');
        R.bus[b.id] = { ok, v: ok ? 16.2 : F(st, b.id, 'short') ? 0.2 : 0, mains: !!F(st, b.id, 'mains') };
      }
      if (b.kind === 'dmx') {
        R.bus[b.id] = { ok: R.live[b.console] && !F(st, b.console, 'dead'), term: !F(st, b.id, 'noTerm'), chain: b.chain };
      }
      if (b.kind === '1-10v') {
        const c = els[b.ctl], lvl = +st.in[c.in];
        R.bus[b.id] = { v: 1 + 9 * lvl, n: b.drivers.length, sink: F(st, b.ctl, 'overload') };
      }
    });
  }

  function loadState(st, R, e) {
    const id = e.id, S = st.S, sup = R.live[e.parent] && R.nOk[id];
    const L = { supplied: !!R.live[e.parent], on: false, lvl: 0, flick: false, col: null, amps: 0, note: '', switchedOn: true };
    if (e.in !== undefined && e.kind !== 'lum') L.switchedOn = !!st.in[e.in];
    if (!sup) { if (e.kind === 'emerg' && !F(st, id, 'battery')) { L.on = true; L.lvl = 0.35; L.note = 'on battery (emergency mode)'; } return L; }
    let lvl = 1, flick = false, col = e.col || null;
    const path = S._.anc(id);
    if (path.some((a) => F(st, a, 'hrL') || F(st, a, 'hrN')) || F(st, id, 'hrL') || F(st, id, 'hrN')) flick = true;
    if (path.some((a) => S._.els[a].kind === 'contactor' && F(st, a, 'chatter'))) flick = true;
    if (R.v < 210) lvl *= 0.9;
    switch (e.kind) {
      case 'lum': case 'lamp': case 'rgbw': case 'profile': {
        if (F(st, id, 'dead')) { L.note = 'driver failed'; return L; }
        if (F(st, id, 'lampFail')) { L.note = 'driver OK – LED module open circuit'; return L; }
        if (F(st, id, 'flicker')) flick = true;
        if (e.in !== undefined && !st.in[e.in]) { L.switchedOn = false; return L; }
        if (e.drv === 'dali') { const d = daliLevel(st, R, e); if (d == null) return L; lvl *= d; }
        if (e.drv === 'dmx' || e.kind === 'rgbw') { const d = dmxState(st, R, e); if (!d) return L; lvl *= d.lvl; col = d.col; flick = flick || d.flick; }
        if (e.drv === '1-10v') { lvl *= analogLevel(st, R, e); }
        if (e.cv) { const p = S._.els[e.cv]; const tot = S._.sub(e.cv).reduce((t, x) => t + (S._.els[x].w || 0), 0); if (tot > (p.w || 100) * (F(st, e.cv, 'small') ? 0.6 : 1)) { flick = true; L.note = 'power supply overloaded – hiccups'; } if (e.far) lvl *= F(st, e.cv, 'thin') ? 0.45 : 0.85; }
        if (e.series) { const ccr = S._.els[e.series]; lvl *= F(st, ccr.id, 'lowI') ? 0.55 : st.in[ccr.in] ? [0.1, 0.25, 0.5, 0.8, 1][+st.in[ccr.in] - 1] || 1 : 1; }
        if (F(st, id, 'ledShort')) lvl *= 1.1;
        if (lvl <= 0.001) return L;
        L.on = true; L.lvl = Math.min(1, lvl); L.flick = flick; L.col = col; L.amps = ((e.w || 20) / 230) * L.lvl; return L;
      }
      case 'emerg': { if (e.maint && !st.in[e.maintIn || '_none'] && e.maintIn) { return L; } L.on = !!e.maint; L.lvl = e.maint ? 1 : 0; L.amps = 0.03; L.note = F(st, id, 'battery') ? 'charging LED off – battery fault' : 'charging LED on'; return L; }
      case 'socket': case 'heater': case 'fan': {
        if (e.in !== undefined && !st.in[e.in]) { L.switchedOn = false; return L; }
        if (F(st, id, 'dead')) { L.note = 'appliance dead'; return L; }
        if (e.ph === '3P' && R.lost.size) { L.on = true; L.lvl = 0.66; L.note = 'only two of the three heating elements work'; L.amps = ((e.w || 3000) / 230 / 3) * 0.66; return L; }
        L.on = true; L.lvl = 1; L.flick = flick; L.amps = e.ph === '3P' ? (e.w || 3000) / 692.8 : (e.w || 1000) / 230; return L;
      }
      case 'motor': {
        if (e.in !== undefined && !st.in[e.in]) { L.switchedOn = false; return L; }
        const three = e.ph === '3P';
        if (three && R.lost.size) { L.single = true; L.on = false; L.note = 'hums – does not start (single-phasing)'; L.amps = (e.kw || 4) * 6; return L; }
        if (F(st, id, 'cap')) { L.note = 'hums – does not start (run capacitor failed)'; L.amps = (e.kw || 1) * 8; L.single = true; return L; }
        L.on = true; L.motor = true; L.lvl = 1; L.amps = three ? ((e.kw || 4) * 1000) / (1.732 * 400 * 0.85) : ((e.kw || 1) * 1000) / (230 * 0.85); return L;
      }
    }
    return L;
  }
  function daliLevel(st, R, e) {
    const b = (st.S.buses || []).find((x) => x.id === e.bus), B = R.bus[e.bus];
    if (!B) return 1;
    if (B.mains) return null;
    if (!B.ok) return 1;
    const ctl = st.S._.els[b.ctl]; let scene = st.in[ctl.in];
    if (ctl.knxBus && (!(R.bus[ctl.knxBus] || {}).ok || F(st, ctl.id, 'gaWrong'))) scene = ctl.def ?? 1;
    const levels = (ctl.scenes || {})[scene] || {};
    if (F(st, e.id, 'addr')) return levels.broadcast ?? 1;
    const g = F(st, e.id, 'group') || e.group;
    const v = levels['g' + g];
    return v == null ? 0 : v;
  }
  function dmxState(st, R, e) {
    const b = (st.S.buses || []).find((x) => x.id === e.bus), B = R.bus[e.bus];
    if (!B || !B.ok) return F(st, e.id, 'hold') ? { lvl: 1, col: e.col } : null;
    const i = b.chain.indexOf(e.id);
    for (let k = 0; k < i; k++) if (F(st, b.chain[k], 'thruBroken')) return null;
    const ctl = st.S._.els[b.console];
    let addr = F(st, e.id, 'addr') || e.addr;
    const ch = (a) => { const pat = st.in[ctl.in] || 'white'; const P = (ctl.patterns || {})[pat] || {}; return P[a] ?? P.all ?? 0; };
    let r = ch(addr), g = ch(addr + 1), bl = ch(addr + 2), w = ch(addr + 3);
    if (F(st, e.id, 'mode3')) { w = 0; }
    const pol = b.chain.slice(0, i + 1).some((x) => F(st, x, 'polarity'));
    let flick = !B.term && i >= b.chain.length - 3;
    if (pol) return { lvl: Math.random(), col: ['#f00', '#0f0', '#00f', '#fff'][Math.floor(Math.random() * 4)], flick: true };
    if (F(st, e.id, 'chShort')) r = 1;
    const lvl = Math.max(r, g, bl, w);
    if (lvl <= 0) return null;
    const hx = (v) => Math.round(Math.min(1, v + w * 0.8) * 255).toString(16).padStart(2, '0');
    return { lvl, col: '#' + hx(r) + hx(g) + hx(bl), flick };
  }
  function analogLevel(st, R, e) {
    const B = R.bus[e.bus]; if (!B) return 1;
    if (F(st, e.id, 'ctlOpen')) return 1;
    if (F(st, e.id, 'ctlRev') || F(st, e.id, 'ctlShort')) return 0.1;
    const b = (st.S.buses || []).find((x) => x.id === e.bus);
    const i = b.drivers.indexOf(e.id);
    if (b.drivers.slice(0, i).some((x) => F(st, x, 'wireOpen'))) return 1;
    let v = B.v; if (B.sink) v = Math.max(v, 6);
    return v <= 1.05 ? 0.1 : Math.min(1, 0.1 + ((v - 1) / 9) * 0.9);
  }

  // ---------------------------------------------------------------- readings for every instrument
  const resTo = (st, id, cond) => { const { els, anc } = st.S._; let rL = 0, rN = 0, rE = 0, openL = false, openN = false, openE = false, hr = 0; [id].concat(anc(id)).forEach((a) => { const e = els[a]; if (e.kind === 'cable') { const r = (R20[e.size || 2.5] || 7.41) * (e.len || 10) / 1000; rL += r; rN += r; rE += (R20[e.cpc || (e.size <= 2.5 ? 1.5 : e.size)] || 12.1) * (e.len || 10) / 1000; } if (F(st, a, 'openL')) openL = true; if (F(st, a, 'openN')) openN = true; if (F(st, a, 'openE')) openE = true; if (F(st, a, 'hrL')) hr += 0.6; }); void cond; return { rL: rL + hr, rN, rE, openL, openN, openE }; };
  function volts(st, R, id) {
    const { kids, sub, els } = st.S._, v = R.v;
    if (R.pen) return { LN: R.live[id] ? '3 V' : '0 V', LE: R.live[id] ? '115–230 V (unstable)' : '0 V', NE: R.live[id] ? '112–228 V' : '0 V' };
    if (!R.live[id]) return { LN: '0 V', LE: '0 V', NE: '0 V' };
    const path = [id].concat(st.S._.anc(id)), I = R.cur[id] > 0.05 || sub(id).some((x) => R.loads[x] && R.loads[x].on);
    const drop = path.reduce((t, a) => t + (F(st, a, 'hrL') && R.cur[a] > 0.05 ? 28 : 0) + (F(st, a, 'hrN') && R.cur[a] > 0.05 ? 24 : 0), 0);
    const nDrop = path.reduce((t, a) => t + (F(st, a, 'hrN') && R.cur[a] > 0.05 ? 24 : 0), 0);
    let LN, NE, LE;
    if (R.nOk[id]) { LN = `${Math.round(v - drop - (I ? 2 : 0))} V`; NE = `${(nDrop + (I ? 0.8 : 0.2)).toFixed(1)} V`; }
    else { const loadOn = sub(id).some((x) => els[x] && isLoad(els[x])); LN = loadOn ? '1.6 V' : 'floating 20–90 V'; NE = loadOn ? `${Math.round(v - 3)} V` : 'floating'; }
    LE = R.eOk[id] ? `${Math.round(v - (drop - nDrop))} V` : 'unstable 30–120 V (no earth reference)';
    void kids;
    return { LN, LE, NE };
  }
  function zs(st, R, id) {
    if (!R.live[id]) return 'no reading – not live';
    const r = resTo(st, id), ze = st.S.ze || 0.35;
    if (r.openE || !R.eOk[id]) return '> 1999 Ω (no earth path)';
    if (st.S.earthing === 'TT') return `${r1((st.S.ra || 85) + r.rL + r.rE, 1)} Ω`;
    return `${r1(ze + (r.rL + r.rE) * 1.2, 2)} Ω`;
  }
  function irTest(st, R, id) {
    const { sub, els } = st.S._, ids = sub(id), lamps = ids.some((x) => isLoad(els[x]));
    const inSub = (mode) => st.faults.filter((f) => f.mode === mode && ids.includes(f.el) && !(st.disc && isLoad(els[f.el])));
    let LN = '> 299 MΩ', LNE = '> 299 MΩ';
    if (inSub('shortLN').length) LN = '0.00 MΩ'; else if (lamps && !st.disc) LN = '0.04 MΩ';
    if (inSub('faultLE').length || inSub('faultNE').length) LNE = '0.01 MΩ';
    else { const ir = inSub('irLow'); if (ir.length) LNE = `${(ir[0].ir ?? 0.35).toFixed(2)} MΩ`; }
    return { LN, LNE, note: lamps && !st.disc ? 'Loads / drivers are still connected – L–N will read low' : '' };
  }

  // the tests offered for an element
  function testsFor(st, R, e) {
    const k = e.kind, T = [];
    const add = (key, label, group, fn, dead) => T.push({ key, label, group, fn, dead });
    add('look', 'Look / inspect', 'Look', () => inspect(st, R, e));
    if (e.kind !== 'supply') add('heat', 'Thermal camera', 'Look', () => (R.hot[e.id] ? `Hot spot ${R.hot[e.id]} °C at the terminals` : `No hot spots (about ${30 + Math.round((R.cur[e.id] || 0) * 0.8)} °C)`));
    if (!isCtl(e) && e.kind !== 'supply' && !e.nogen) {
      add('vln', 'Voltage L–N', 'Live tests', () => volts(st, R, e.id).LN);
      add('vle', 'Voltage L–E', 'Live tests', () => volts(st, R, e.id).LE);
      add('vne', 'Voltage N–E', 'Live tests', () => volts(st, R, e.id).NE);
      add('clamp', 'Clamp meter – line current', 'Live tests', () => `${r1(R.cur[e.id] || 0, 2)} A`);
      add('leak', 'Leakage clamp (L and N together)', 'Live tests', () => { const ids = st.S._.sub(e.id); let mA = ids.reduce((t, x) => t + (R.leak[x] || 0), 0); if (st.faults.some((f) => f.mode === 'faultNE' && ids.includes(f.el))) mA += Math.round((R.cur[e.id] || 0) * 400); if (st.faults.some((f) => f.mode === 'faultLE' && ids.includes(f.el) && R.danger[f.el])) mA += 900; return `${mA ? mA : 0.4} mA`; });
      add('zs', 'Earth fault loop impedance Zs', 'Live tests', () => zs(st, R, e.id));
      add('r12', 'R1 + R2 (board to here)', 'Dead tests', () => { const r = resTo(st, e.id); return r.openL || r.openE ? 'OL (open circuit)' : `${r1(r.rL + r.rE, 2)} Ω`; }, true);
      add('rn', 'Neutral continuity (board to here)', 'Dead tests', () => { const r = resTo(st, e.id); return r.openN ? 'OL (open circuit)' : `${r1(r.rN, 2)} Ω`; }, true);
      add('ir', 'Insulation resistance from here on (500 V)', 'Dead tests', () => { const x = irTest(st, R, e.id); return `L–N ${x.LN} · L+N–E ${x.LNE}${x.note ? ' – ' + x.note : ''}`; }, true);
    }
    if (RCD.includes(k)) add('rcdt', 'RCD test at IΔn', 'Live tests', () => { if (!R.live[e.id]) return 'no supply'; if (F(st, e.id, 'notrip')) return 'did not trip in 300 ms ✗'; st.tripped.add(e.id); st.tripWhy[e.id] = 'RCD test'; return F(st, e.id, 'slow') ? 'tripped in 420 ms' : 'tripped in 23 ms'; });
    if (RCD.includes(k)) add('rcdb', 'Press the RCD test button', 'Live tests', () => { if (!R.live[e.id]) return 'no supply'; if (F(st, e.id, 'notrip')) return 'nothing happens'; st.tripped.add(e.id); st.tripWhy[e.id] = 'test button'; return 'tripped'; });
    (KTESTS[k] || []).forEach((t) => add(t[0], t[1], t[2] || 'Special', () => t[3](st, R, e), t[4]));
    (e.tests || []).forEach((t) => add(t[0], t[1], t[2] || 'Special', () => t[3](st, R, e, F), t[4]));
    return T;
  }
  const KTESTS = {
    contactor: [['coilv', 'Coil voltage A1–A2', 'Live tests', (st, R, e) => { const c = e.latch ? !!st.latch[e.id] : !!(R.out[e.coil] && R.live[e.coil]); return c ? '230 V' : '0 V'; }], ['coilr', 'Coil resistance A1–A2', 'Dead tests', (st, R, e) => (F(st, e.id, 'coilOpen') ? 'OL (coil open)' : '540 Ω'), true], ['contacts', 'Voltage across the main contacts', 'Live tests', (st, R, e) => (R.live[e.parent] ? (R.out[e.id] ? '0 V (closed)' : '230 V (open)') : '0 V')]],
    keycard: [['kout', 'Output to the contactor coil', 'Live tests', (st, R, e) => (R.out[e.id] ? '230 V' : '0 V')]],
    timer: [['tread', 'Read the clock and the program', 'Special', (st, R, e) => { const t = +st.in[e.in], shown = F(st, e.id, 'clock') ? (t + 12) % 24 : t, p = F(st, e.id, 'prog') || e.prog; return F(st, e.id, 'dead') ? 'Display blank' : `Clock shows ${fmtT(shown)} (real ${fmtT(t)}) · program ON ${fmtT(p[0])} – OFF ${fmtT(p[1])}`; }], ['tout', 'Timer output contact', 'Live tests', (st, R, e) => (R.out[e.id] ? '230 V' : '0 V')]],
    photocell: [['pcover', 'Cover the cell (darkness)', 'Special', (st, R, e) => (F(st, e.id, 'stuckDay') ? 'No click – output stays off' : 'Click – output on after a few seconds')], ['ptorch', 'Shine a torch on it (daylight)', 'Special', (st, R, e) => (F(st, e.id, 'stuckNight') ? 'Output stays on' : F(st, e.id, 'dirty') ? 'Output stays on – the lens is covered in dirt / paint' : 'Click – output off')], ['pout', 'Photocell output', 'Live tests', (st, R, e) => (R.out[e.id] ? '230 V' : '0 V')]],
    sense: [['sout', 'Switch output (contact closed?)', 'Live tests', (st, R, e) => (R.out[e.id] ? 'Closed – 230 V out' : 'Open – 0 V out')], ['sflow', 'Check the switch while the fan runs', 'Special', (st, R, e) => (F(st, e.id, 'stuckOpen') ? 'Fan running, air flowing – contact stays OPEN (switch faulty or tube blocked)' : R.loads[e.src] && R.loads[e.src].on ? 'Fan running – contact closes' : 'Fan stopped – contact open (correct)')]],
    pir: [['walk', 'Walk test', 'Special', (st, R, e) => (F(st, e.id, 'dead') ? 'Detector LED does not light' : F(st, e.id, 'stuckOn') ? 'LED on all the time – output never drops' : F(st, e.id, 'lux') ? 'LED flashes, but the output stays off – lux threshold set too low (dark only)' : 'LED flashes and the output switches')], ['pout', 'Sensor output', 'Live tests', (st, R, e) => (R.out[e.id] ? '230 V' : '0 V')]],
    knxpsu: [['busv', 'KNX bus voltage at the supply', 'Live tests', (st, R, e) => busV(st, R, e)]],
    knxsw: [['busv', 'KNX bus voltage at this device', 'Live tests', (st, R, e) => busV(st, R, e)], ['mon', 'ETS group monitor – press the button', 'Special', (st, R, e) => { const b = busOf(st, e); if (!R.bus[b.id] || !R.bus[b.id].ok) return 'No telegrams – bus down'; if (F(st, e.id, 'dead')) return 'No telegram from this device'; return `Telegram from ${e.pa}: write ${F(st, e.id, 'gaWrong') || e.ga} = ${st.in[e.in] ? 'On' : 'Off'}`; }], ['pa', 'Programming button – LED', 'Special', (st, R, e) => (F(st, e.id, 'dead') ? 'LED does not light – device not powered from the bus' : `LED lights – physical address ${e.pa}`)]],
    knxact: [['busv', 'KNX bus voltage at the actuator', 'Live tests', (st, R, e) => busV(st, R, e)], ['knxread', 'ETS – read the channel parameters', 'Special', (st, R, e) => (F(st, e.id, 'dead') ? 'Device does not respond' : `Channel ${e.ch} listens to ${F(st, e.id, 'gaMissing') ? '(no group address linked)' : e.ga}`)], ['manual', 'Manual override button on the channel', 'Special', (st, R, e) => (F(st, e.id, 'welded') ? 'Relay does not open – contacts welded' : F(st, e.id, 'dead') ? 'No response' : 'Relay clicks, the load switches')]],
    knxcoupler: [['filt', 'ETS – coupler filter table', 'Special', (st, R, e) => (F(st, e.id, 'filter') ? `Group ${F(st, e.id, 'filter')} is NOT in the filter table – telegrams blocked` : 'All used groups pass the coupler')]],
    dalipsu: [['dbus', 'DALI bus voltage', 'Live tests', (st, R, e) => { const b = (st.S.buses || []).find((x) => x.psu === e.id), B = R.bus[b.id]; return `${B.v} V DC${B.mains ? ' – and 230 V AC on the bus!' : ''}`; }]],
    dalictl: [['dscan', 'Scan the DALI line', 'Special', (st, R, e) => daliScan(st, R, e)], ['dbc', 'Send broadcast ON', 'Special', (st, R, e) => { const b = (st.S.buses || []).find((x) => x.ctl === e.id); return R.bus[b.id].ok ? 'Every working driver goes to full' : 'No response – no bus voltage'; }]],
    dmxcon: [['patch', 'Console patch view', 'Special', (st, R, e) => { const b = (st.S.buses || []).find((x) => x.console === e.id); return b.chain.map((x) => `${st.S._.els[x].name}: ${st.S._.els[x].addr}`).join(' · '); }]],
    ctl110: [['v110', 'Control voltage at the controller', 'Live tests', (st, R, e) => { const b = (st.S.buses || []).find((x) => x.ctl === e.id); return `${r1(F(st, e.id, 'overload') ? Math.max(R.bus[b.id].v, 6) : R.bus[b.id].v, 1)} V DC (${b.drivers.length} drivers)`; }]],
    ccr: [['ccrd', 'CCR display', 'Special', (st, R, e) => (st.tripped.has(e.id) ? 'Tripped – OPEN CIRCUIT alarm' : F(st, e.id, 'lowI') ? 'Output 5.2 A on step 5 (should be 6.6 A)' : `Output ${[2.8, 3.4, 4.1, 5.2, 6.6][(+st.in[e.in] || 5) - 1]} A · step ${st.in[e.in] || 5}${st.faults.some((f) => f.mode === 'earth' && st.S._.sub(e.id).includes(f.el)) ? ' · EARTH FAULT alarm on the insulation monitor' : ''}`)], ['loop', 'Series loop insulation to earth (5 kV, isolated)', 'Dead tests', (st, R, e) => (st.faults.some((f) => f.mode === 'earth' && st.S._.sub(e.id).includes(f.el)) ? '0.8 MΩ ✗' : '> 500 MΩ'), true], ['cont', 'Series loop continuity (isolated)', 'Dead tests', (st, R, e) => (st.S._.sub(e.id).some((x) => F(st, x, 'openL')) ? 'OL – loop open' : '12.4 Ω'), true]],
    cvpsu: [['vout', 'Output voltage at the power supply', 'Live tests', (st, R, e) => { if (!R.live[e.id] || F(st, e.id, 'dead')) return '0 V'; const tot = st.S._.sub(e.id).reduce((t, x) => t + (st.S._.els[x].w || 0), 0); return tot > (e.w || 100) ? '0–24 V cycling (overload hiccup)' : '24.1 V DC'; }], ['iout', 'Output current vs rating', 'Live tests', (st, R, e) => { const tot = st.S._.sub(e.id).reduce((t, x) => t + (st.S._.els[x].w || 0), 0); return `${r1(tot / 24, 1)} A load on a ${r1((e.w || 100) / 24, 1)} A supply`; }]],
    profile: [['vend', 'Voltage at the far end of the profile', 'Live tests', (st, R, e) => (R.loads[e.id] && R.loads[e.id].on ? (F(st, e.cv, 'thin') ? '17.9 V DC' : '22.8 V DC') : '0 V')]],
    rgbw: [['menu', 'Fixture menu – address and mode', 'Special', (st, R, e) => `Address ${F(st, e.id, 'addr') || e.addr} · mode ${F(st, e.id, 'mode3') ? '3 ch RGB' : '4 ch RGBW'}`], ['dmxa', 'DMX analyser at the fixture input', 'Special', (st, R, e) => dmxAnalyse(st, R, e)], ['term', 'Check the last fixture for a terminator', 'Special', (st, R, e) => { const b = (st.S.buses || []).find((x) => x.id === e.bus); return b.chain[b.chain.length - 1] === e.id ? (F(st, b.id, 'noTerm') ? 'DMX OUT is empty – no 120 Ω terminator' : '120 Ω terminator fitted') : 'Not the last fixture'; }]],
    lum: [['driver', 'Driver status LED / label', 'Special', (st, R, e) => (F(st, e.id, 'dead') ? 'No output; input voltage present' : e.drv === 'dali' ? `DALI driver, address ${F(st, e.id, 'addr') ? '(none – lost)' : e.addr}, group ${F(st, e.id, 'group') || e.group}` : e.drv === '1-10v' ? `1-10 V driver · control ${F(st, e.id, 'ctlOpen') ? '0 V – wire open?' : F(st, e.id, 'ctlRev') ? 'reversed polarity' : 'connected'}` : 'Driver OK')], ['v110', 'Control voltage at the driver (1-10 V)', 'Live tests', (st, R, e) => { if (e.drv !== '1-10v') return 'not a 1-10 V driver'; if (F(st, e.id, 'ctlOpen')) return '10.6 V (open circuit – driver sees full)'; if (F(st, e.id, 'ctlRev') || F(st, e.id, 'ctlShort')) return '0.2 V'; const b = (st.S.buses || []).find((x) => x.id === e.bus), i = b.drivers.indexOf(e.id); if (b.drivers.slice(0, i).some((x) => F(st, x, 'wireOpen'))) return '10.6 V (no controller connected – the pair is open upstream)'; return `${r1(R.bus[e.bus].sink ? Math.max(R.bus[e.bus].v, 6) : R.bus[e.bus].v, 1)} V DC`; }]],
    motor: [['mi', 'Motor current (clamp each phase)', 'Live tests', (st, R, e) => { const l = R.loads[e.id]; if (!l) return '0 A'; if (l.single) return 'L1 38 A · L2 0 A · L3 38 A (single-phasing)'; return l.on ? `${r1(l.amps, 1)} A per phase` : '0 A'; }], ['wind', 'Winding resistance U-V / V-W / W-U (isolated)', 'Dead tests', () => '1.92 / 1.93 / 1.92 Ω (balanced)', true]],
    olr: [['olset', 'Overload relay setting', 'Special', (st, R, e) => { const m = st.S._.els[e.motor]; const In = m ? ((m.kw || 4) * 1000) / (1.732 * 400 * 0.85) : 8; return `Dial at ${r1(F(st, e.id, 'setLow') ? In * 0.6 : F(st, e.id, 'setHigh') ? In * 1.8 : In * 1.05, 1)} A · motor nameplate ${r1(In, 1)} A`; }]],
    emerg: [['etest', 'Emergency test (simulate mains failure)', 'Special', (st, R, e) => (F(st, e.id, 'battery') ? 'Goes out after 3 minutes – battery failed (needs 3 h)' : 'Stays on – full duration')]],
    socket: [['app', 'Plug in a known-good lamp', 'Special', (st, R, e) => (R.live[e.parent] && R.nOk[e.id] ? 'Lamp lights' : 'Lamp does not light')]],
  };
  const fmtT = (t) => `${String(Math.floor(t)).padStart(2, '0')}:${t % 1 ? '30' : '00'}`;
  const busOf = (st, e) => (st.S.buses || []).find((b) => (b.devices || []).includes(e.id) || b.psu === e.id || (b.sensors || []).includes(e.id)) || (st.S.buses || [])[0];
  const busV = (st, R, e) => { const b = busOf(st, e), B = R.bus[b.id]; if (!B) return '—'; if (F(st, e.id, 'dead') && e.kind !== 'knxpsu') return `${B.v} V DC at the terminals – device does not start`; return `${B.v} V DC${B.low ? ' (too low – needs at least 21 V)' : ''}`; };
  function daliScan(st, R, e) {
    const b = (st.S.buses || []).find((x) => x.ctl === e.id), B = R.bus[b.id];
    if (!B.ok) return 'Scan failed – no DALI bus voltage';
    const drv = st.S.els.filter((x) => x.bus === b.id);
    return drv.map((x) => F(st, x.id, 'dead') ? `${x.name}: not found` : F(st, x.id, 'addr') ? `${x.name}: found without a short address` : `A${x.addr} G${F(st, x.id, 'group') || x.group}${F(st, x.id, 'lampFail') ? ' lamp failure' : ''}`).join(' · ');
  }
  function dmxAnalyse(st, R, e) {
    const b = (st.S.buses || []).find((x) => x.id === e.bus), B = R.bus[b.id];
    if (!B.ok) return 'No DMX signal';
    const i = b.chain.indexOf(e.id);
    for (let k = 0; k < i; k++) if (F(st, b.chain[k], 'thruBroken')) return 'No DMX signal (the line is open before this fixture)';
    if (b.chain.slice(0, i + 1).some((x) => F(st, x, 'polarity'))) return 'Signal present – framing errors, data inverted (Data+ / Data− swapped)';
    if (!B.term && i >= b.chain.length - 3) return 'Signal present – reflections, 3–8 % packet errors';
    return 'Signal OK – 512 channels, 44 Hz, no errors';
  }
  function inspect(st, R, e) {
    const out = [];
    const pool = st.faults.filter((f) => f.el === e.id && f.look);
    if (PROT.includes(e.kind)) out.push(st.locked.has(e.id) ? 'Locked off' : st.tripped.has(e.id) ? `Tripped${e.kind === 'rcbo' ? ' – trip flag shows ' + (/Earth|RCD|test/.test(st.tripWhy[e.id] || '') ? 'RESIDUAL (earth leakage)' : 'OVERCURRENT') : ''}` : st.off.has(e.id) ? 'Switched off' : 'On');
    if (e.kind === 'contactor') out.push(R.out[e.id] ? 'Contactor pulled in' : 'Contactor released');
    if (e.kind === 'fuse' || e.kind === 'cutout') out.push(st.tripped.has(e.id) ? 'Fuse blown' : 'Fuse intact');
    if (R.loads[e.id]) { const l = R.loads[e.id]; out.push(l.on ? (l.flick ? 'On – flickering' : l.lvl < 0.6 ? 'On – dim' : 'On') : l.switchedOn === false ? 'Switched off' : 'Off'); if (l.note) out.push(l.note); }
    if (R.danger[e.id]) out.push('⚠ Tingle reported when touching the metal');
    pool.forEach((f) => out.push(f.look));
    if (e.look) out.push(e.look);
    return out.join(' · ') || 'Nothing unusual';
  }

  // ---------------------------------------------------------------- symptoms the client sees (compared with a healthy installation)
  function symptoms(st, R) {
    const S = st.S, { els } = S._, healthy = newState(S, [], st.in); healthy.latch = { ...st.latch }; const H = evaluate(healthy);
    const out = [];
    S.els.forEach((e) => {
      if (!isLoad(e)) return;
      const a = R.loads[e.id], h = H.loads[e.id]; if (!a || !h) return;
      const nm = e.name || e.id;
      if (h.on && !a.on) out.push(`${nm}: not working`);
      else if (!h.on && a.on && !(e.kind === 'emerg')) out.push(`${nm}: stays on`);
      else if (a.on && a.flick && !h.flick && LIGHT.includes(e.kind)) out.push(`${nm}: flickering`);
      else if (a.on && h.on && a.lvl < h.lvl * 0.75) out.push(LIGHT.includes(e.kind) ? `${nm}: dim` : `${nm}: ${e.weak || 'works weakly'}`);
      else if (a.on && h.on && a.lvl > h.lvl * 1.4) out.push(`${nm}: brighter than set`);
      else if (a.on && a.col && h.col && a.col !== h.col) out.push(`${nm}: wrong colour`);
    });
    st.tripped.forEach((d) => { if (!/test/.test(st.tripWhy[d] || '')) out.push(`${els[d].name || d}: ${els[d].kind === 'fuse' || els[d].kind === 'cutout' ? 'fuse blown' : 'tripped'}`); });
    Object.keys(R.danger).forEach((d) => { if (isLoad(els[d]) || els[d].metal) out.push(`Someone felt a tingle from ${els[d].name || d}`); });
    if (S.busSymptoms) S.busSymptoms(st, R, out, F);
    return [...new Set(out)];
  }

  // ---------------------------------------------------------------- choose random faults for a session
  function pickFaults(S, n) {
    const pool = S.pool.slice(), out = [], used = new Set();
    for (let tries = 0; out.length < n && tries < 200; tries++) {
      const f = pool[Math.floor(Math.random() * pool.length)];
      if (out.includes(f) || used.has(f.el) || (f.excl || []).some((x) => out.some((o) => o.id === x))) continue;
      out.push(f); used.add(f.el);
    }
    return out;
  }

  return { build, newState, evaluate, testsFor, symptoms, pickFaults, isLoad, isCtl, PROT, OC, RCD, F, esc, r1, fmtT, volts };
})();
