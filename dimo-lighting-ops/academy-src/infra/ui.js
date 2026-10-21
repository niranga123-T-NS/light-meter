// =================== The course page: navigation, sessions, concept pages, lab workspace (topology, consoles, device screens), tickets, quizzes, write-ups, progress
const SESSIONS = [];
const MODS = [{ n: 1, t: 'Module 1 · Network setup & troubleshooting', w: 'Weeks 1–4' }, { n: 2, t: 'Module 2 · Server setup & scripting', w: 'Weeks 5–8' }, { n: 3, t: 'Module 3 · Virtualization', w: 'Weeks 9–11' }, { n: 4, t: 'Capstone', w: 'Week 12' }];
const WIDGETS = {}, TOOLS = {};
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const APP = { sid: null, tab: 'concept', L: null, mode: null, tk: null, shells: {}, open: [], active: null, timer: null };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };
let PROG = store.get('infra:prog', {});
const sp = (sid) => (PROG[sid] ??= { concept: false, tasks: {}, tickets: {}, quiz: null, wu: null });
function toast(t, ms = 3200) { let box = document.getElementById('toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.style.cssText = 'position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:6px;z-index:60;align-items:flex-end'; document.body.appendChild(box); } const d = document.createElement('div'); d.className = 'toast'; d.style.position = 'static'; d.textContent = t; box.appendChild(d); while (box.children.length > 4) box.firstChild.remove(); setTimeout(() => d.remove(), ms); }

// ---------------------------------------------------------------- saving progress to the person's Dacademy record
let CFG = null;
function api(fn, body) { if (!CFG) return Promise.resolve(null); return fetch(`${CFG.sb}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: CFG.key, Authorization: `Bearer ${CFG.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => (r.ok ? r.json().catch(() => null) : Promise.reject(r))); }
function saveProg(sid) {
  store.set('infra:prog', PROG); if (!sid) return; const S = SESSIONS.find((x) => x.id === sid); if (!S) return;
  const p = sp(sid); const score = sessionScore(S, p);
  api('academy_record', { p_lesson: `infra_${sid}`, p_score: score, p_total: 10 }).catch(() => void 0);
  if (window.parent !== window) window.parent.postMessage({ type: 'academy:progress', lesson: `infra_${sid}`, score, total: 10 }, '*');
  renderSide();
}
/** A session out of 10: concept read 1, lab tasks 4, tickets 3, review quiz 2 (graded sessions: the test result) */
function sessionScore(S, p) {
  if (S.graded && p.test?.done) return Math.round(10 * p.test.score);
  const tk = (S.lab?.tasks || []).length, tt = (S.tickets || []).length;
  const a = p.concept ? 1 : 0, b = tk ? (4 * Object.keys(p.tasks).filter((k) => S.lab.tasks.some((t) => t.id === k)).length) / tk : 4, c = tt ? (3 * Object.values(p.tickets).filter((x) => x.solved).length) / tt : 3, d = p.quiz ? (2 * p.quiz.ok) / p.quiz.n : 0;
  return Math.min(10, Math.round(a + b + c + d));
}

// ---------------------------------------------------------------- sidebar and session header
function renderSide() {
  const done = SESSIONS.filter((S) => sessionScore(S, sp(S.id)) >= 7).length;
  $('#side').innerHTML = `<h1>Infrastructure Engineer Program</h1><div class="sub">${done} of ${SESSIONS.length} sessions passed · 12 weeks</div><div class="bar"><i style="width:${(100 * done) / Math.max(1, SESSIONS.length)}%"></i></div>${MODS.map((m) => `<div class="mod"><b>${m.t}</b>${SESSIONS.filter((S) => S.mod === m.n).map((S) => { const sc = sessionScore(S, sp(S.id)); return `<div class="ses ${APP.sid === S.id ? 'on' : ''}" data-s="${S.id}"><span class="n">${String(S.n).padStart(2, '0')}</span><span>${esc(S.title)}${S.graded ? ' <span class="gr">● graded</span>' : ''}</span><span class="st">${sc >= 7 ? '✅' : sc > 0 ? `<span class="m">${sc}/10</span>` : ''}</span></div>`; }).join('')}</div>`).join('')}<div class="mod"><b>About</b><div class="ses" data-s="about"><span class="n">i</span><span>How the course works</span></div></div>`;
  $$('#side .ses').forEach((e) => (e.onclick = () => { $('#side').classList.remove('open'); openSession(e.dataset.s); }));
}
function openSession(sid, tab) {
  if (APP.timer) { clearInterval(APP.timer); APP.timer = null; }
  APP.sid = sid; APP.tab = tab || (sid === 'about' ? 'about' : 'concept'); APP.L = null; APP.shells = {}; APP.open = []; APP.active = null; APP.mode = null; APP.tk = null;
  store.set('infra:last', { sid, tab: APP.tab }); renderSide(); renderMain(); $('#main').scrollTop = 0;
}
function renderMain() {
  const m = $('#main');
  if (APP.sid === 'about') { m.innerHTML = aboutHtml(); $('.menu-btn', m)?.addEventListener('click', () => $('#side').classList.add('open')); return; }
  const S = SESSIONS.find((x) => x.id === APP.sid); const p = sp(S.id);
  const tabs = S.graded ? [['concept', '1 · Brief'], ['lab', '2 · Practice lab'], ['test', `3 · Graded test`], ['review', '4 · Review']] : [['concept', '1 · Concept'], ['lab', '2 · Virtual lab'], ['fix', '3 · Break & fix'], ['review', '4 · Review']];
  const cnt = { concept: p.concept ? '✓' : '', lab: S.lab ? `${Object.keys(p.tasks).filter((k) => S.lab.tasks.some((t) => t.id === k)).length}/${S.lab.tasks.length}` : '', fix: S.tickets ? `${Object.values(p.tickets).filter((x) => x.solved).length}/${S.tickets.length}` : '', test: p.test?.done ? `${Math.round(100 * p.test.score)}%` : '', review: p.quiz ? `${p.quiz.ok}/${p.quiz.n}` : '' };
  m.innerHTML = `<div class="head"><div class="eb"><button class="btn sm menu-btn" id="menuBtn">☰ Sessions</button> Session ${S.n} · ${esc(MODS[S.mod - 1].t.split('·')[1] || '')}</div><h2>${esc(S.title)}</h2><div class="meta">${esc(S.focus)}${S.milestone ? ` · Milestone: <b>${esc(S.milestone)}</b>` : ''}</div><div class="tabs">${tabs.map(([k, t]) => `<button class="tab ${APP.tab === k ? 'on' : ''}" data-t="${k}">${t}<span class="c">${cnt[k] || ''}</span></button>`).join('')}</div></div><div class="body" id="body"></div>`;
  $('#menuBtn').onclick = () => $('#side').classList.add('open');
  $$('.tab', m).forEach((b) => (b.onclick = () => { APP.tab = b.dataset.t; APP.L = null; APP.shells = {}; APP.open = []; APP.active = null; APP.mode = null; APP.tk = null; if (APP.timer) { clearInterval(APP.timer); APP.timer = null; } store.set('infra:last', { sid: S.id, tab: APP.tab }); renderMain(); }));
  const body = $('#body');
  if (APP.tab === 'concept') renderConcept(body, S);
  if (APP.tab === 'lab') renderLabTab(body, S);
  if (APP.tab === 'fix') renderFixTab(body, S);
  if (APP.tab === 'test') renderTestTab(body, S);
  if (APP.tab === 'review') renderReview(body, S);
}
function aboutHtml() { return `<div class="head"><div class="eb"><button class="btn sm menu-btn">☰ Sessions</button> DIMO Academy</div><h2>How the course works</h2><div class="meta">A 12-week, 24-session programme with a virtual lab for every session</div></div><div class="body"><div class="card"><h3>Every session has four steps</h3><div class="grid2"><div><b>1 · Concept</b><p class="m">Read the notes and use the live diagrams. Short check questions confirm you understood.</p></div><div><b>2 · Virtual lab</b><p class="m">A simulated office network with PCs, servers, Cisco-style switches and routers, FortiGate firewalls, Wi-Fi and a hypervisor. Type real commands; every task is checked automatically from the state of the lab.</p></div><div><b>3 · Break &amp; fix</b><p class="m">Tickets from users. The lab is broken the way real networks break; find the cause, fix it, prove it and write the ticket up (symptom, cause, fix, prevention).</p></div><div><b>4 · Review</b><p class="m">A short quiz and the weekly ticket write-up for your trainer.</p></div></div></div><div class="card"><h3>Assessment (from the programme)</h3><table class="t"><tr><th>Assessment</th><th>When</th><th>Weight</th></tr><tr><td>Weekly ticket write-ups</td><td>Every week</td><td>15%</td></tr><tr><td>Lab completion</td><td>Every session</td><td>15%</td></tr><tr><td>Network troubleshooting test (6 faults / 90 min)</td><td>Session 8</td><td>20%</td></tr><tr><td>Automation script</td><td>Session 16</td><td>15%</td></tr><tr><td>VM troubleshooting test (5 faults / 75 min)</td><td>Session 22</td><td>15%</td></tr><tr><td>Capstone</td><td>Sessions 23–24</td><td>20%</td></tr></table><p>75% or more signs you off to work independently in that area; below that you shadow a senior engineer for the weak module.</p></div><div class="card"><h3>Tips for the consoles</h3><ul><li>Type <kbd>help</kbd> or <kbd>?</kbd> in any console. Cisco commands can be shortened (<kbd>sh ip int br</kbd>, <kbd>conf t</kbd>).</li><li>↑ / ↓ recall earlier commands; <kbd>Tab</kbd> completes command and file names.</li><li>Your lab is saved on this device as you work. <b>Reset</b> starts the lab again.</li><li>On a phone, turn it sideways for the consoles; a tablet or PC is best.</li></ul></div></div>`; }

// ---------------------------------------------------------------- concept pages
function renderConcept(body, S) {
  const p = sp(S.id);
  body.innerHTML = `<div class="concept">${S.concept.map((c, i) => `<div class="card">${c.h ? `<h3>${esc(c.h)}</h3>` : ''}${c.html || ''}${c.w ? `<div class="wid" id="w${i}"></div>` : ''}${c.check ? `<div id="cq${i}"></div>` : ''}</div>`).join('')}<div class="card"><button class="btn p" id="cDone">${p.concept ? '✓ Concept done – go to the lab' : 'I have read this – go to the lab →'}</button></div></div>`;
  S.concept.forEach((c, i) => { if (c.w && WIDGETS[c.w]) WIDGETS[c.w]($(`#w${i}`), c.wa || {}); if (c.check) renderQuiz($(`#cq${i}`), c.check, () => {}); });
  $('#cDone').onclick = () => { p.concept = true; saveProg(S.id); APP.tab = S.graded ? 'lab' : 'lab'; renderMain(); };
}
function renderQuiz(el, qs, onDone, o = {}) {
  const st = qs.map(() => null);
  el.innerHTML = qs.map((q, i) => `<div class="q" data-i="${i}"><div class="qq">${o.num !== false ? `${i + 1}. ` : ''}${q.q}</div>${q.a.map((a, j) => `<label><input type="radio" name="q${o.key || ''}${i}" value="${j}"> <span>${a}</span></label>`).join('')}<div class="why" hidden></div></div>`).join('') + (o.submit ? `<button class="btn p" id="qsub${o.key || ''}">Check my answers</button><div id="qres${o.key || ''}"></div>` : '');
  const mark = (i, j) => { const box = $(`.q[data-i="${i}"]`, el); const q = qs[i]; box.classList.add('done'); $$('label', box).forEach((lb, k) => { lb.classList.toggle('c', k === q.c); lb.classList.toggle('w', k === j && j !== q.c); }); const w = $('.why', box); w.hidden = false; w.innerHTML = (j === q.c ? '✅ ' : '❌ ') + (q.why || ''); };
  if (!o.submit) $$('input', el).forEach((r) => (r.onchange = () => { const i = +r.closest('.q').dataset.i; st[i] = +r.value; mark(i, st[i]); if (st.every((x) => x != null)) onDone(st.filter((x, k) => x === qs[k].c).length, qs.length); }));
  else { $$('input', el).forEach((r) => (r.onchange = () => { st[+r.closest('.q').dataset.i] = +r.value; })); $(`#qsub${o.key || ''}`, el).onclick = () => { if (st.some((x) => x == null)) return toast('Answer every question first.'); st.forEach((j, i) => mark(i, j)); const ok = st.filter((x, k) => x === qs[k].c).length; $(`#qres${o.key || ''}`, el).innerHTML = `<p class="score">${ok} / ${qs.length}</p>`; onDone(ok, qs.length); }; }
}

// ---------------------------------------------------------------- the lab: build, save, restore
const labKey = (sid, mode, tk) => `infra:lab:${sid}:${mode}${tk ? ':' + tk : ''}`;
function labSave() { if (!APP.L) return; const o = {}; Object.entries(APP.L).forEach(([k, v]) => { if (!k.startsWith('_')) o[k] = v; }); try { store.set(labKey(APP.sid, APP.mode, APP.tk), o); } catch {} }
function labBuild(S, mode, tk) {
  const saved = store.get(labKey(S.id, mode, tk?.id), null);
  let L;
  if (saved && saved.devs) { L = Object.assign(labNew({ devs: [] }), saved); }
  else { const spec = (tk?.build || S.lab.build)(); L = labNew(spec); if (spec.post) spec.post(L); settle(L); if (tk?.fault) { tk.fault(L); settle(L); } L.cmdlog = []; }
  L.cmdlog ??= []; L.flags ??= {}; L.ans ??= {};
  settle(L); return L;
}
function labReset() { store.del(labKey(APP.sid, APP.mode, APP.tk)); APP.L = null; APP.shells = {}; APP.open = []; APP.active = null; renderMain(); }
/** After every command or screen action: re-check tasks, redraw, save */
function afterAction() {
  const S = SESSIONS.find((x) => x.id === APP.sid); if (!S || !APP.L) return;
  try { settle(APP.L, 'nodhcp'); } catch (e) { console.warn(e); }
  APP.L._probe = true;
  try { if (APP.mode === 'lab') checkTasks(S); if (APP.mode === 'fix' || APP.mode === 'test') checkTicket(S); } finally { APP.L._probe = false; }
  drawTopo(); labSave();
}

// ---------------------------------------------------------------- the workspace: topology, tasks, device panel
function renderLabTab(body, S) {
  if (!S.lab) { body.innerHTML = '<div class="card">This session has no lab.</div>'; return; }
  APP.mode = 'lab'; APP.L = APP.L || labBuild(S, 'lab');
  body.innerHTML = `<div class="card"><h3>${esc(S.lab.title)}</h3>${S.lab.intro || ''}</div>${S.lab.side ? '<div class="card" id="lside"></div>' : ''}<div class="ws"><div><div class="topo" id="topo"></div><div class="card tasks" style="margin-top:12px"><h3>Tasks <span class="m" id="tcount"></span></h3><div id="tasks"></div><div class="tb" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn sm" id="bReset">↺ Reset the lab</button>${S.lab.extra ? S.lab.extra.map((x, i) => `<button class="btn sm" data-x="${i}">${esc(x.t)}</button>`).join('') : ''}</div></div></div><div class="dpanel" id="dpanel"></div></div>`;
  $('#bReset').onclick = () => confirmBox('Reset the lab? Everything you configured here starts again (completed tasks stay ticked).', () => labReset());
  $$('[data-x]', body).forEach((b) => (b.onclick = () => { S.lab.extra[+b.dataset.x].fn(APP.L); afterAction(); renderDevicePanel(); }));
  if (S.lab.side) { const draw = () => S.lab.side($('#lside'), APP.L, () => { afterAction(); draw(); }); draw(); }
  drawTopo(); renderTasks(S); if (!APP.open.length) (S.lab.open || [Object.keys(APP.L.devs)[0]]).forEach((id) => openDevice(id, null, true)); renderDevicePanel(); checkTasks(S);
}
function renderTasks(S) {
  const p = sp(S.id); const L = APP.L;
  $('#tasks').innerHTML = S.lab.tasks.map((t, i) => `<div class="tk ${p.tasks[t.id] ? 'done' : ''}"><span class="bx">${p.tasks[t.id] ? '✓' : i + 1}</span><div><div>${t.t}</div>${t.ans ? `<div style="margin-top:4px"><input class="ans" data-a="${t.id}" placeholder="your answer" value="${esc(L.ans[t.id] || '')}"> <button class="btn sm" data-ac="${t.id}">Check</button> <span class="m" id="ar_${t.id}"></span></div>` : ''}${t.hint ? `<details class="ht"><summary>Hint</summary>${t.hint}</details>` : ''}</div></div>`).join('');
  $('#tcount').textContent = `${S.lab.tasks.filter((t) => p.tasks[t.id]).length} of ${S.lab.tasks.length}`;
  $$('[data-ac]').forEach((b) => (b.onclick = () => { const id = b.dataset.ac; const t = S.lab.tasks.find((x) => x.id === id); const v = $(`[data-a="${id}"]`).value.trim(); L.ans[id] = v; const ok = ansOk(t, v, L); $(`#ar_${id}`).innerHTML = ok ? '<span class="ok">Correct</span>' : '<span class="bad">Not right yet – check again in the lab</span>'; if (ok) { L.flags['ans_' + id] = true; afterAction(); } }));
}
const ansOk = (t, v, L) => { const want = t.ans(L); const norm = (x) => String(x).toLowerCase().replace(/\s+/g, '').replace(/^\/|\.$/, ''); return (Array.isArray(want) ? want : [want]).some((w) => norm(w) === norm(v)); };
function checkTasks(S) {
  const p = sp(S.id); let changed = false; const L = APP.L;
  S.lab.tasks.forEach((t) => { if (p.tasks[t.id]) return; let ok = false; try { ok = t.ans ? !!L.flags['ans_' + t.id] : !!t.check(L); } catch (e) { ok = false; } if (ok) { p.tasks[t.id] = Date.now(); changed = true; toast(`✓ Task done: ${t.t.replace(/<[^>]+>/g, '').slice(0, 80)}`); } });
  if (changed) { saveProg(S.id); renderTasks(S); const c = $$('.tab')[1]?.querySelector('.c'); if (c) c.textContent = `${Object.keys(p.tasks).filter((k) => S.lab.tasks.some((t) => t.id === k)).length}/${S.lab.tasks.length}`; }
}
const KIND_ICON = { pc: '🖥', laptop: '💻', srv: '🗄', vm: '▣', sw: '⇄', hub: '⇄', rt: '⊕', fw: '🛡', isp: '☁', ap: '📶', phone: '☎', cam: '📷', printer: '🖨', hv: '▦', rogue: '⚠' };
function drawTopo() {
  const el = $('#topo'); if (!el || !APP.L) return; const L = APP.L;
  const devs = Object.values(L.devs).filter((d) => d.x != null && !d.hidden);
  const W = Math.max(480, ...devs.map((d) => d.x + 60)), H = Math.max(280, ...devs.map((d) => d.y + 40));
  const pos = (id) => L.devs[id];
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lab network diagram">`;
  L.links.forEach(([a, b]) => { const A = splitPk(a), B = splitPk(b); const da = pos(A.dev), db = pos(B.dev); if (!da || !db || da.x == null || db.x == null || da.hidden || db.hidden) return; const up = linkUp(L, A.dev, A.port); const ea = da.kind === 'sw' && da.ports?.[A.port]?.err, eb = db.kind === 'sw' && db.ports?.[B.port]?.err; const blk = stpBlocked(L, A.dev, A.port) || stpBlocked(L, B.dev, B.port); const wan = da.kind === 'isp' || db.kind === 'isp'; const storm = L._storm && L._storm.size && [...L._storm].some((k) => k.startsWith(A.dev + '|') || k.startsWith(B.dev + '|')) && up; const col = ea || eb ? '#b4232f' : !up ? '#b9c3c0' : storm ? '#e0412b' : blk ? '#e0812b' : wan ? '#e0812b' : '#2563a8'; const mx = (da.x + db.x) / 2, my = (da.y + db.y) / 2; s += `<line x1="${da.x}" y1="${da.y}" x2="${db.x}" y2="${db.y}" stroke="${col}" stroke-width="${storm ? 4 : 2.5}" ${!up ? 'stroke-dasharray="5 4"' : ''}${storm ? ' class="storm"' : ''}/>`; if (blk && up) s += `<text x="${mx}" y="${my + 4}" text-anchor="middle" style="fill:#e0812b;font-weight:700">✕</text>`; if (APP.showPorts !== false) { const lbl = (d, p, o) => { const t = 0.22; const x = d.x + (o.x - d.x) * t, y = d.y + (o.y - d.y) * t; return `<text class="pl" x="${x}" y="${y - 3}" text-anchor="middle">${esc(p.replace(/^GigabitEthernet|^Gi1\/0\//, (m) => (m === 'Gi1/0/' ? 'g' : 'g')).replace('Gi', 'g').replace('Te1/1/', 'te'))}</text>`; }; if (da.kind !== 'isp') s += lbl(da, A.port, db); if (db.kind !== 'isp') s += lbl(db, B.port, da); } });
  devs.filter((d) => d.vmHost && pos(d.vmHost)?.x != null).forEach((d) => { const A = pos(d.vmHost); s += `<line x1="${d.x}" y1="${d.y}" x2="${A.x}" y2="${A.y}" stroke="${d.run !== false ? '#e57000' : '#e9c9a8'}" stroke-width="1.2" stroke-dasharray="1 3"><title>VM on ${esc(A.hostname)}</title></line>`; });
  devs.filter((d) => d.wifi && pos(d.wifi)?.x != null).forEach((d) => { const A = pos(d.wifi), ok = wifiAssoc(L, A, d).ok; s += `<line x1="${d.x}" y1="${d.y}" x2="${A.x}" y2="${A.y}" stroke="${ok ? '#7a5cc4' : '#c9b8e8'}" stroke-width="1.4" stroke-dasharray="2 4"><title>Wi-Fi ${ok ? 'connected' : 'not connected'}</title></line>`; });
  devs.forEach((d) => { const on = APP.active?.dev === d.id; const ip = l3ifs(L, d).filter((e) => e.ip && !e.loop).map((e) => e.ip)[0] || (d.nics && !Array.isArray(d.nics) ? (Object.values(d.nics)[0]?.apipa ? 'APIPA' : Object.values(d.nics)[0]?.dhcp ? 'DHCP…' : '') : ''); const off = d.off || d.run === false || (d.poe && !powered(L, d)); s += `<g class="dv ${on ? 'on' : ''}" data-d="${d.id}" tabindex="0" role="button" aria-label="Open ${esc(d.hostname || d.name)}"><rect class="box" x="${d.x - 38}" y="${d.y - 17}" width="76" height="34" rx="${d.kind === 'sw' || d.kind === 'rt' || d.kind === 'fw' ? 4 : 9}" fill="${off ? '#eef1f0' : d.kind === 'fw' ? '#fff4ea' : d.kind === 'isp' ? '#f2f6fb' : '#fff'}" stroke="${off ? '#c3cbc8' : '#18232b'}" stroke-width="1.4"/><text x="${d.x - 31}" y="${d.y + 5}" style="font-size:13px">${KIND_ICON[d.kind] || '•'}</text><text x="${d.x + 6}" y="${d.y + 4}" text-anchor="middle" style="font-weight:600;${off ? 'fill:#9aa' : ''}">${esc((d.hostname || d.name).slice(0, 10))}</text>${ip ? `<text class="ipl" x="${d.x}" y="${d.y + 29}" text-anchor="middle">${esc(ip)}</text>` : ''}</g>`; });
  s += '</svg>'; el.innerHTML = s + `<div class="hint" style="padding:2px 6px 4px">Click a device to open it. <span style="color:#2563a8">━</span> up · <span style="color:#b9c3c0">┅</span> down · <span style="color:#e0812b">✕</span> blocked by spanning tree · <span style="color:#b4232f">━</span> err-disabled</div>`;
  $$('.dv', el).forEach((g) => { const go = () => openDevice(g.dataset.d); g.onclick = go; g.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
}
/** Open a device: one tab per tool (console, PowerShell, settings screens …) */
function openDevice(id, tool, quiet) {
  const d = APP.L.devs[id]; if (!d) return; const tools = toolsFor(d); if (!tools.length) { if (!quiet) toast(`${d.hostname || d.name} has no console in this lab – test it from another device (ping, nslookup, curl …)`); return; }
  const t = tool || tools[0].id; const key = `${id}|${t}`;
  if (!APP.open.includes(key)) APP.open.push(key);
  APP.active = { dev: id, tool: t }; if (!quiet) { renderDevicePanel(); drawTopo(); }
}
function toolsFor(d) { if (d.kind === 'hv' && d.pvesetup) return [{ id: 'setup', label: 'Console (Proxmox installer)', gui: guiPveSetup }]; if (d.kind === 'vm' && d.vm && (d.vm.status !== 'running' || d.vm.template)) return [{ id: 'off', label: 'Console', gui: guiVmOff }]; if (d.setup) return [{ id: 'setup', label: 'Console (Windows Setup)', gui: guiWinSetup }]; if (d.lxsetup) return [{ id: 'setup', label: 'Console (installer)', gui: guiLxSetup }]; return (TOOLS[d.kind] || []).concat(TOOLS['*'] || []).filter((t) => !t.when || t.when(d, APP.L)); }
function renderDevicePanel() {
  const el = $('#dpanel'); if (!el) return; const L = APP.L;
  if (!APP.active) { el.innerHTML = '<div class="gui m">Click a device in the drawing to open its console.</div>'; return; }
  const a = APP.active; const d = L.devs[a.dev]; const tools = toolsFor(d);
  el.innerHTML = `<div class="dtabs">${APP.open.map((k) => { const [id, t] = k.split('|'); const D = L.devs[id]; if (!D) return ''; const T = toolsFor(D).find((x) => x.id === t); return `<button class="dtab ${a.dev === id && a.tool === t ? 'on' : ''}" data-k="${k}">${esc(D.hostname || D.name)} · ${esc(T?.label || t)}<span class="x" data-c="${k}">✕</span></button>`; }).join('')}</div><div class="dtabs" style="background:#f4f7f6;padding-top:4px">${tools.map((t) => `<button class="dtab ${a.tool === t.id ? 'on' : ''}" data-t="${t.id}" style="font-weight:500">${esc(t.label)}</button>`).join('')}</div><div id="view"></div>`;
  $$('.dtab[data-k]', el).forEach((b) => (b.onclick = (e) => { if (e.target.dataset.c) { APP.open = APP.open.filter((x) => x !== e.target.dataset.c); const [id, t] = (APP.open[APP.open.length - 1] || '').split('|'); APP.active = id ? { dev: id, tool: t } : null; renderDevicePanel(); drawTopo(); return; } const [id, t] = b.dataset.k.split('|'); APP.active = { dev: id, tool: t }; renderDevicePanel(); drawTopo(); }));
  $$('.dtab[data-t]', el).forEach((b) => (b.onclick = () => openDevice(a.dev, b.dataset.t)));
  const T = tools.find((x) => x.id === a.tool) || tools[0]; const view = $('#view', el);
  if (T.term) { const k = `${a.dev}|${T.id}`; APP.shells[k] ??= { sh: T.term(L, d), buf: '' }; makeTerm(view, APP.shells[k], d); }
  else T.gui(view, L, d, () => { afterAction(); renderDevicePanel(); });
}

// ---------------------------------------------------------------- the terminal
const ansi = (t) => esc(t).replace(/\x1b\[(\d+)m([\s\S]*?)(?=\x1b\[0m|$)\x1b\[0m?/g, (m, c, s) => `<span class="c${c}">${s}</span>`).replace(/\x1b\[\d+m/g, '');
function makeTerm(view, st, d) {
  const sh = st.sh;
  view.innerHTML = `<div class="term"><div class="bar"><span>${esc(sh.title ? sh.title() : '')}</span><span class="sp"></span><button data-b="clear">Clear</button><button data-b="copy">Copy</button></div><div class="out"></div><div class="ln"><span class="pr"></span><input autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Command"></div></div>`;
  const out = $('.out', view), inp = $('input', view), pr = $('.pr', view);
  const draw = () => { out.innerHTML = ansi(st.buf); out.scrollTop = out.scrollHeight; pr.textContent = sh.prompt(); inp.type = sh.isPw && sh.isPw() ? 'password' : 'text'; };
  if (!st.buf && sh.banner) st.buf = sh.banner;
  draw(); st.hist ??= []; st.hi = st.hist.length;
  $('[data-b="clear"]', view).onclick = () => { st.buf = ''; draw(); inp.focus(); };
  $('[data-b="copy"]', view).onclick = () => { try { navigator.clipboard.writeText(st.buf.replace(/\x1b\[\d+m/g, '')); toast('Copied'); } catch {} };
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowUp') { if (st.hi > 0) inp.value = st.hist[--st.hi] ?? ''; e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { if (st.hi < st.hist.length) inp.value = st.hist[++st.hi] ?? ''; e.preventDefault(); return; }
    if (e.key === 'Tab') { e.preventDefault(); const c = complete(sh, inp.value, d); if (c.length === 1) inp.value = c[0]; else if (c.length > 1) { st.buf += `${sh.prompt()}${inp.value}\n${c.map((x) => x.split(/\s/).pop()).join('  ')}\n`; draw(); } return; }
    if (e.key === 'c' && e.ctrlKey) { st.buf += `${sh.prompt()}${inp.value}^C\n`; inp.value = ''; draw(); return; }
    if (e.key !== 'Enter') return;
    const line = inp.value; inp.value = ''; const pw = sh.isPw && sh.isPw();
    st.buf += `${sh.prompt()}${pw ? '' : line}\n`;
    if (line.trim() && !pw) { st.hist.push(line); st.hi = st.hist.length; }
    let r; try { r = sh.run(line); } catch (err) { console.error(err); r = `\x1b[31m(the lab hit an internal error running that command: ${err.message})\x1b[0m\n`; }
    APP.L.cmdlog.push({ dev: d.id, kind: sh.kind, line: line.trim(), t: APP.L.clock, ps: sh.isPs ? sh.isPs() : false }); if (APP.L.cmdlog.length > 600) APP.L.cmdlog.shift(); tick(APP.L, 1500);
    if (r && typeof r === 'object') { if (r.clear) st.buf = ''; if (r.text) st.buf += r.text; if (r.edit) { draw(); openEditor(r.edit, sh.load ? sh.load(r.edit) : psFileGet(sh.H(), r.edit) ?? '', (txt) => { const m = sh.save ? sh.save(r.edit, txt) : null; if (m) { st.buf += m + '\n'; } afterAction(); draw(); }); } }
    else st.buf += r || '';
    if (st.buf.length > 200000) st.buf = st.buf.slice(-150000);
    const fw = Object.values(APP.L.devs).find((x) => x.kind === 'fw' && x.flowShow && (x.flowBuf || []).length); if (fw && APP.active?.dev === fw.id && d.id === fw.id) { st.buf += fw.flowBuf.join('\n') + '\n'; fw.flowBuf = []; }
    draw(); afterAction();
    const fwSt = Object.entries(APP.shells).find(([k]) => APP.L.devs[k.split('|')[0]]?.flowShow);
    if (fwSt) { const D = APP.L.devs[fwSt[0].split('|')[0]]; if ((D.flowBuf || []).length) { fwSt[1].buf += D.flowBuf.join('\n') + '\n'; D.flowBuf = []; } }
  };
  view.querySelector('.term').onclick = (e) => { if (!window.getSelection().toString()) inp.focus(); };
  setTimeout(() => inp.focus({ preventScroll: true }), 30);
}
function complete(sh, v, d) {
  const w = v.split(/\s+/); const last = w[w.length - 1]; if (!last) return [];
  let cands = [];
  if (sh.kind === 'linux') { if (w.length === 1) cands = Object.keys(LX); else { const s = sh.S(); const p = last.includes('/') ? last.slice(0, last.lastIndexOf('/') + 1) : ''; const dir = lxNorm(s.cwd, p || '.', s.vars.HOME); const pre = dir === '/' ? '/' : dir + '/'; cands = Object.keys(s.d.lfs).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/') && k !== dir).map((k) => p + k.slice(pre.length) + (s.d.lfs[k].t === 'd' ? '/' : '')); } }
  else if (sh.kind === 'win') { cands = sh.isPs() ? Object.values(PS_CMD).map((c) => c.name).concat(Object.keys(WIN_EXE)) : Object.keys(WIN_EXE).concat(['powershell', 'cd', 'dir', 'type']); }
  else if (sh.kind === 'ios') cands = [];
  const m = cands.filter((c) => c.toLowerCase().startsWith(last.toLowerCase()));
  return m.map((c) => [...w.slice(0, -1), c].join(' '));
}

// ---------------------------------------------------------------- dialogs
function modal(title, html, buttons = [{ t: 'Close' }], o = {}) { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div class="box" style="${o.w ? `max-width:${o.w}px` : ''}"><div class="mh"><b>${esc(title)}</b></div><div class="mb">${html}</div><div class="mf">${buttons.map((b, i) => `<button class="btn ${b.p ? 'p' : ''}" data-i="${i}">${esc(b.t)}</button>`).join('')}</div></div>`; document.body.appendChild(m); const close = () => m.remove(); $$('.mf button', m).forEach((b) => (b.onclick = () => { const f = buttons[+b.dataset.i].fn; if (f && f(m) === false) return; close(); })); m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }); return m; }
function confirmBox(t, fn) { modal('Please confirm', `<p>${esc(t)}</p>`, [{ t: 'Cancel' }, { t: 'Yes', p: true, fn }]); }
function openEditor(path, text, onSave) { const m = modal(`${path.startsWith('@crontab') ? 'crontab -e' : path} – editor`, `<div class="editor"><textarea spellcheck="false">${esc(text)}</textarea><p class="hint">Edit the file, then Save. (Like nano: Ctrl+S saves, Esc closes without saving.)</p></div>`, [{ t: 'Close without saving' }, { t: 'Save', p: true, fn: (el) => { onSave($('textarea', el).value); } }], { w: 980 }); const ta = $('textarea', m); ta.focus(); ta.onkeydown = (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 4; } if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave(ta.value); m.remove(); } }; }

// ---------------------------------------------------------------- break & fix
function renderFixTab(body, S) {
  const p = sp(S.id);
  if (APP.tk) return renderTicket(body, S, S.tickets.find((t) => t.id === APP.tk));
  body.innerHTML = `<div class="card"><h3>Your ticket queue</h3><p class="m">Each ticket loads the lab with a fault, just as a user would report it. Find the cause with commands, fix it, prove it works and write the ticket up. The checks tick when the network really works again.</p><div class="tick-list">${S.tickets.map((t) => `<div class="tl" data-t="${t.id}"><span class="flag">#${t.no}</span><div><b>${esc(t.title)}</b><div class="m" style="font-size:12.5px">${esc(t.who)}</div></div><span class="s">${p.tickets[t.id]?.solved ? '<span class="pill g">Solved</span>' : p.tickets[t.id] ? '<span class="pill y">In progress</span>' : '<span class="pill n">New</span>'}</span></div>`).join('')}</div></div>`;
  $$('.tl', body).forEach((e) => (e.onclick = () => { APP.tk = e.dataset.t; renderMain(); }));
}
function renderTicket(body, S, T, test) {
  const p = sp(S.id); APP.mode = test ? 'test' : 'fix'; APP.tk = T.id; APP.L = APP.L || labBuild(S, APP.mode, T);
  const pt = test ? (p.test.faults[T.id] ??= { start: Date.now() }) : (p.tickets[T.id] ??= { start: Date.now() }); if (!test) saveProg();
  body.innerHTML = `<div class="card"><div class="tb" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn sm" id="tBack">← ${test ? 'All faults' : 'Ticket queue'}</button>${test ? `<span class="timer" id="tTimer"></span>` : ''}<span class="sp" style="flex:1"></span><button class="btn sm" id="tReset">↺ Reload the ticket</button></div><div class="ticket" style="margin-top:8px"><div class="t">TICKET #${T.no} · ${esc(T.prio || 'Normal')} · ${esc(T.who)}</div><div style="margin-top:4px"><b>${esc(T.title)}</b></div><div>${T.text}</div></div></div><div class="ws"><div><div class="topo" id="topo"></div><div class="card tasks" style="margin-top:12px"><h3>Checks</h3><div id="tchecks"></div>${test ? '' : `<details style="margin-top:8px"><summary class="m">I'm stuck – show a hint</summary><div class="hint" style="margin-top:6px">${T.hint || ''}</div></details>`}</div><div class="card" id="twu"></div></div><div class="dpanel" id="dpanel"></div></div>`;
  $('#tBack').onclick = () => { APP.tk = null; APP.L = null; APP.shells = {}; APP.open = []; APP.active = null; renderMain(); };
  $('#tReset').onclick = () => confirmBox('Reload this ticket? The lab goes back to how the user reported it.', () => labReset());
  drawTopo(); if (!APP.open.length) (T.open || S.lab?.open || [Object.keys(APP.L.devs)[0]]).forEach((id) => openDevice(id, null, true)); renderDevicePanel(); checkTicket(S);
  if (test) { const tick2 = () => { const el = $('#tTimer'); if (!el) return; const left = p.test.end - Date.now(); el.textContent = left > 0 ? `⏱ ${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} left` : '⏱ time is up'; if (left <= 0) { clearInterval(APP.timer); APP.timer = null; finishTest(S); } }; tick2(); APP.timer = setInterval(tick2, 1000); }
}
function checkTicket(S) {
  const T = (APP.mode === 'test' ? S.test.faults : S.tickets).find((t) => t.id === APP.tk); if (!T || !APP.L) return; const L = APP.L; const p = sp(S.id);
  const res = T.checks.map((c) => { let ok = false; try { ok = !!c.f(L); } catch { ok = false; } return { t: c.t, ok }; });
  const el = $('#tchecks'); if (el) el.innerHTML = res.map((r) => `<div class="tk ${r.ok ? 'done' : ''}"><span class="bx">${r.ok ? '✓' : '○'}</span><div>${r.t}</div></div>`).join('');
  const all = res.every((r) => r.ok); const pt = APP.mode === 'test' ? p.test.faults[T.id] : p.tickets[T.id];
  if (all && !pt.fixedAt) { pt.fixedAt = Date.now(); toast('All checks pass – write the ticket up to close it.'); if (APP.mode === 'test') { pt.solved = true; pt.mins = Math.round((pt.fixedAt - pt.start) / 60000); } store.set('infra:prog', PROG); }
  const wu = $('#twu'); if (wu && APP.mode === 'fix') renderWriteup(wu, S, T, pt, all);
  if (wu && APP.mode === 'test') wu.innerHTML = pt.solved ? `<p class="ok"><b>Fixed in ${pt.mins} min.</b> Go back to the fault list for the next one.</p><p class="hint">Note in one line what the cause was – your trainer reads it.</p><textarea id="tnote" style="width:100%;min-height:60px" placeholder="Cause and fix in one line">${esc(pt.note || '')}</textarea><button class="btn sm" id="tns">Save note</button>` : '<p class="m">Fix the fault – the checks tick when the service works again.</p>';
  if ($('#tns')) $('#tns').onclick = () => { pt.note = $('#tnote').value; store.set('infra:prog', PROG); toast('Saved'); };
}
function renderWriteup(el, S, T, pt, all) {
  const w = pt.wu || {};
  el.innerHTML = `<h3>Ticket write-up</h3><p class="hint">Write it the way you would in the helpdesk: what the user saw, the real cause, what you changed, and how to stop it happening again.</p>${['symptom', 'cause', 'fix', 'prevention'].map((k) => `<label class="f" style="display:block;margin:6px 0"><b style="font-size:12.5px;text-transform:capitalize">${k}</b><textarea data-w="${k}" style="width:100%;min-height:52px;padding:6px;border:1px solid var(--line);border-radius:6px">${esc(w[k] || '')}</textarea></label>`).join('')}<button class="btn p" id="wuSave" ${all ? '' : 'disabled'}>${pt.solved ? 'Update the write-up' : 'Close the ticket'}</button> ${all ? '' : '<span class="m">The checks must pass first.</span>'}${pt.solved ? ' <span class="pill g">Solved</span>' : ''}`;
  $('#wuSave').onclick = () => { const v = {}; $$('[data-w]', el).forEach((t) => (v[t.dataset.w] = t.value.trim())); if (Object.values(v).some((x) => x.length < 12)) return toast('Write a sentence or two in each box.'); pt.wu = v; pt.solved = true; pt.mins = Math.round(((pt.fixedAt || Date.now()) - pt.start) / 60000); saveProg(S.id); api('academy_writeup_save', { p_lesson: `infra_${S.id}_${T.id}`, p_kind: 'ticket', p_body: { ticket: T.no, title: T.title, minutes: pt.mins, ...v } }).catch(() => void 0); toast('Ticket closed and the write-up saved for your trainer.'); renderWriteup(el, S, T, pt, all); };
}

// ---------------------------------------------------------------- graded tests (session 8, 16, 22, 24)
function renderTestTab(body, S) {
  const p = sp(S.id); const X = S.test;
  if (APP.tk && p.test && !p.test.done) return renderTicket(body, S, X.faults.find((f) => f.id === APP.tk), true);
  if (!p.test) { body.innerHTML = `<div class="card"><h3>${esc(X.title)}</h3>${X.intro}<p><b>${X.faults.length} faults · ${X.mins} minutes.</b> The clock starts when you press Start and keeps running if you leave the page. Hints are switched off.</p><button class="btn p" id="tStart">Start the test</button></div>`; $('#tStart').onclick = () => confirmBox(`Start the ${X.mins}-minute test now?`, () => { p.test = { start: Date.now(), end: Date.now() + X.mins * 60000, faults: {} }; X.faults.forEach((f) => store.del(labKey(S.id, 'test', f.id))); saveProg(); renderMain(); }); return; }
  const left = p.test.end - Date.now(); if (left <= 0 && !p.test.done) finishTest(S);
  const solved = X.faults.filter((f) => p.test.faults[f.id]?.solved).length;
  body.innerHTML = `<div class="card"><h3>${esc(X.title)} ${p.test.done ? `<span class="pill ${p.test.score >= 0.75 ? 'g' : 'r'}">${Math.round(100 * p.test.score)}%</span>` : `<span class="timer" id="tTimer"></span>`}</h3><p class="m">${solved} of ${X.faults.length} fixed.${p.test.done ? ' The test is finished – your result is saved for your trainer.' : ' Open a fault, fix it, then come back for the next.'}</p><div class="tick-list">${X.faults.map((f, i) => { const r = p.test.faults[f.id]; return `<div class="tl" data-t="${f.id}"><span class="flag">F${i + 1}</span><div><b>${esc(f.title)}</b><div class="m" style="font-size:12.5px">${esc(f.who)}</div></div><span class="s">${r?.solved ? `<span class="pill g">Fixed · ${r.mins} min</span>` : r ? '<span class="pill y">Open</span>' : '<span class="pill n">Not started</span>'}</span></div>`; }).join('')}</div>${p.test.done ? '' : '<div style="margin-top:10px"><button class="btn" id="tFin">I have finished – hand in</button></div>'}</div>`;
  $$('.tl', body).forEach((e) => (e.onclick = () => { if (p.test.done) return toast('The test is finished.'); APP.tk = e.dataset.t; APP.L = null; APP.shells = {}; APP.open = []; APP.active = null; renderMain(); }));
  if ($('#tFin')) $('#tFin').onclick = () => confirmBox('Hand in the test now?', () => { finishTest(S); renderMain(); });
  if (!p.test.done) { const tick2 = () => { const el = $('#tTimer'); if (!el) return; const l = p.test.end - Date.now(); el.textContent = l > 0 ? `⏱ ${Math.floor(l / 60000)}:${String(Math.floor(l / 1000) % 60).padStart(2, '0')} left` : '⏱ time is up'; if (l <= 0) { clearInterval(APP.timer); APP.timer = null; finishTest(S); renderMain(); } }; tick2(); APP.timer = setInterval(tick2, 1000); }
}
function finishTest(S) { const p = sp(S.id); if (p.test.done) return; const X = S.test; const n = X.faults.filter((f) => p.test.faults[f.id]?.solved).length; p.test.done = true; p.test.score = n / X.faults.length; p.test.at = Date.now(); saveProg(S.id); api('academy_record', { p_lesson: `infra_t${String(S.n).padStart(2, '0')}`, p_score: n, p_total: X.faults.length }).catch(() => void 0); api('academy_writeup_save', { p_lesson: `infra_t${String(S.n).padStart(2, '0')}`, p_kind: 'test', p_body: { score: n, of: X.faults.length, faults: X.faults.map((f) => ({ id: f.id, title: f.title, solved: !!p.test.faults[f.id]?.solved, minutes: p.test.faults[f.id]?.mins ?? null, note: p.test.faults[f.id]?.note || '' })) } }).catch(() => void 0); toast(`Test handed in: ${n} of ${X.faults.length} fixed.`); }

// ---------------------------------------------------------------- review: quiz and the weekly write-up
function renderReview(body, S) {
  const p = sp(S.id);
  body.innerHTML = `<div class="card"><h3>Quiz</h3>${p.quiz ? `<p>Last result: <b>${p.quiz.ok} / ${p.quiz.n}</b>. You can try again.</p>` : '<p class="m">Answer every question, then check.</p>'}<div id="quiz"></div></div><div class="card"><h3>This week's ticket write-up</h3><p class="hint">One real support ticket from your work this week (or one of the lab tickets): symptom, cause, fix, prevention. Your trainer reads and marks it.</p><div id="wwu"></div></div><div class="card"><h3>Session summary</h3><p>Concept ${p.concept ? '✓' : '–'} · Lab tasks ${S.lab ? `${Object.keys(p.tasks).filter((k) => S.lab.tasks.some((t) => t.id === k)).length}/${S.lab.tasks.length}` : '–'} · ${S.graded ? `Test ${p.test?.done ? Math.round(100 * p.test.score) + '%' : 'not taken'}` : `Tickets ${Object.values(p.tickets).filter((x) => x.solved).length}/${(S.tickets || []).length}`} · Quiz ${p.quiz ? `${p.quiz.ok}/${p.quiz.n}` : '–'}</p><p class="score">${sessionScore(S, p)} / 10</p></div>`;
  renderQuiz($('#quiz'), S.quiz, (ok, n) => { p.quiz = { ok, n, at: Date.now() }; saveProg(S.id); }, { submit: true, key: 'r' });
  const w = p.wu || {}; const el = $('#wwu');
  el.innerHTML = `${['ticket', 'symptom', 'cause', 'fix', 'prevention'].map((k) => `<label class="f" style="display:block;margin:6px 0"><b style="font-size:12.5px;text-transform:capitalize">${k === 'ticket' ? 'Ticket (number / short title)' : k}</b><textarea data-w="${k}" style="width:100%;min-height:${k === 'ticket' ? 34 : 52}px;padding:6px;border:1px solid var(--line);border-radius:6px">${esc(w[k] || '')}</textarea></label>`).join('')}<button class="btn p" id="wwSave">Save for my trainer</button> ${p.wu?.at ? `<span class="m">Saved ${new Date(p.wu.at).toLocaleDateString()}</span>` : ''}`;
  $('#wwSave').onclick = () => { const v = {}; $$('[data-w]', el).forEach((t) => (v[t.dataset.w] = t.value.trim())); if (Object.values(v).some((x) => x.length < 6)) return toast('Fill in every box.'); p.wu = { ...v, at: Date.now() }; saveProg(S.id); api('academy_writeup_save', { p_lesson: `infra_${S.id}_week`, p_kind: 'weekly', p_body: v }).catch(() => void 0); toast('Saved for your trainer.'); renderReview(body, S); };
  if (S.submit) renderSubmit(body, S, p);
}
/** A graded hand-in (session 16: one script for a real team task) – saved as a write-up of kind 'script' for the trainer to mark */
function renderSubmit(body, S, p) {
  const X = S.submit; const v = p.sub || {}; const card = document.createElement('div'); card.className = 'card'; body.insertBefore(card, body.children[1] || null);
  card.innerHTML = `<h3>${esc(X.title)} ${v.at ? '<span class="pill g">Handed in</span>' : '<span class="pill y">To do</span>'}</h3><p class="hint">${esc(X.intro)}</p>${X.fields.map(([k, label, h]) => `<label class="f" style="display:block;margin:6px 0"><b style="font-size:12.5px">${esc(label)}</b><textarea data-s="${k}" spellcheck="false" style="width:100%;min-height:${h}px;padding:6px;border:1px solid var(--line);border-radius:6px;${k === 'script' ? 'font-family:var(--mono);font-size:12px;white-space:pre' : ''}">${esc(v[k] || '')}</textarea></label>`).join('')}<button class="btn p" id="subSave">${v.at ? 'Hand in again' : 'Hand in to my trainer'}</button> ${v.at ? `<span class="m">Handed in ${new Date(v.at).toLocaleDateString()}</span>` : ''}`;
  $('#subSave', card).onclick = () => { const o = {}; $$('[data-s]', card).forEach((t) => (o[t.dataset.s] = t.value.replace(/\s+$/, ''))); if (Object.values(o).some((x) => x.trim().length < 6) || (o.script || '').split('\n').length < 5) return toast('Fill in every box – the script needs at least a few lines.'); if (/(password|passwd|secret)\s*[=:]\s*['"]?[^\s'"$]{4,}/i.test(o.script) || /BEGIN [A-Z ]*PRIVATE KEY/.test(o.script)) return toast('Take the password or key out of the script first.'); p.sub = { ...o, at: Date.now() }; saveProg(S.id); api('academy_writeup_save', { p_lesson: `infra_${S.id}_${X.kind || 'script'}`, p_kind: X.kind || 'script', p_body: o }).catch(() => void 0); toast('Handed in.'); renderSubmit2(card, body, S, p); };
}
const renderSubmit2 = (card, body, S, p) => { card.remove(); renderSubmit(body, S, p); };

// ---------------------------------------------------------------- start
function boot() {
  const m = location.hash.match(/cfg=([^&]+)/);
  if (m) { try { CFG = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1]))))); history.replaceState(null, '', location.pathname); } catch { CFG = null; } }
  else if (window.parent !== window) window.parent.postMessage({ type: 'academy:ready' }, '*');
  window.addEventListener('message', (e) => { if (e.data && e.data.type === 'academy:cfg') CFG = e.data.cfg; });
  SESSIONS.sort((a, b) => a.n - b.n);
  const last = store.get('infra:last', null);
  const sid = last && (last.sid === 'about' || SESSIONS.some((s) => s.id === last.sid)) ? last.sid : 'about';
  openSession(sid, last?.tab);
}
