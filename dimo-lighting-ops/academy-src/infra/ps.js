// =================== PowerShell: the language (variables, pipelines, loops, functions, try/catch, scriptblocks) and output formatting; cmdlets live in win.js and ad.js
class PSErr extends Error { constructor(m, o = {}) { super(m); Object.assign(this, o); } }
class PSFlow { constructor(kind, val) { this.kind = kind; this.val = val; } }
const PS_OPS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'like', 'notlike', 'match', 'notmatch', 'contains', 'notcontains', 'in', 'notin', 'replace', 'split', 'join', 'and', 'or', 'not', 'f', 'is', 'isnot', 'as', 'ieq', 'ine', 'ceq', 'cne', 'imatch', 'cmatch', 'ilike', 'band', 'bor', 'xor'];

// ---------------------------------------------------------------- tokenizer
function psLex(src) {
  const T = []; let i = 0; const n = src.length;
  const push = (t, v, x = {}) => T.push({ t, v, ...x, pos: i });
  while (i < n) {
    const c = src[i];
    if (c === '`' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '\r') { i++; continue; }
    if (c === ' ' || c === '\t') { i++; if (T.length) T[T.length - 1].sp = true; continue; }
    if (c === '#') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '<' && src[i + 1] === '#') { const j = src.indexOf('#>', i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === '\n' || c === ';') { push('nl', c); i++; continue; }
    if (c === '@' && (src[i + 1] === '"' || src[i + 1] === "'") && src[i + 2] === '\n') { const q = src[i + 1], end = src.indexOf(`\n${q}@`, i + 3); const body = src.slice(i + 3, end < 0 ? n : end); i = end < 0 ? n : end + 3; push('str', body, { dq: q === '"' }); continue; }
    if (c === '"' || c === '“' || c === '”') { let j = i + 1, s = ''; while (j < n && !['"', '“', '”'].includes(src[j])) { if (src[j] === '`' && j + 1 < n) { const e = src[j + 1]; s += { n: '\n', t: '\t', r: '', '0': '\0', '`': '`', '"': '"', $: '`$' }[e] ?? e; j += 2; continue; } if (src[j] === '$' && src[j + 1] === '(') { let dep = 0, k = j + 1; for (; k < n; k++) { if (src[k] === '(') dep++; else if (src[k] === ')') { dep--; if (!dep) break; } } s += src.slice(j, k + 1); j = k + 1; continue; } s += src[j++]; } push('str', s, { dq: true }); i = j + 1; continue; }
    if (c === "'" || c === '‘' || c === '’') { let j = i + 1, s = ''; while (j < n) { if ((src[j] === "'" || src[j] === '’') && src[j + 1] === "'") { s += "'"; j += 2; continue; } if (src[j] === "'" || src[j] === '’' || src[j] === '‘') break; s += src[j++]; } push('str', s, { dq: false }); i = j + 1; continue; }
    if (c === '$') {
      if (src[i + 1] === '(') { push('subx', '$('); i += 2; continue; }
      if (src[i + 1] === '{') { const j = src.indexOf('}', i); push('var', src.slice(i + 2, j)); i = j + 1; continue; }
      const m = src.slice(i + 1).match(/^([A-Za-z_][\w]*:)?[A-Za-z_?][\w]*|^_|^\$|^\?/); if (m) { push('var', m[0]); i += 1 + m[0].length; continue; }
      push('word', '$'); i++; continue;
    }
    if (c === '@' && src[i + 1] === '(') { push('arr', '@('); i += 2; continue; }
    if (c === '@' && src[i + 1] === '{') { push('hash', '@{'); i += 2; continue; }
    if (c === '@' && /[A-Za-z_]/.test(src[i + 1] || '')) { const m = src.slice(i + 1).match(/^\w+/); push('splat', m[0]); i += 1 + m[0].length; continue; }
    if ('{}()[],|'.includes(c)) { if (c === '|' && src[i + 1] === '|') { push('op', '||'); i += 2; continue; } push(c, c); i++; continue; }
    if (c === '&' && src[i + 1] === '&') { push('op', '&&'); i += 2; continue; }
    if (c === '&') { push('call', '&'); i++; continue; }
    if (c === ':' && src[i + 1] === ':') { push('::', '::'); i += 2; continue; }
    if (c === '2' && src[i + 1] === '>' && (src[i + 2] === '&' || src[i + 2] === '$')) { i += src[i + 2] === '&' ? 4 : 2; continue; }
    if (c === '>') { if (src[i + 1] === '>') { push('redir', '>>'); i += 2; } else { push('redir', '>'); i++; } continue; }
    if (c === '=' && src[i + 1] !== '=') { push('assign', '='); i++; continue; }
    if ('+-*/%'.includes(c) && src[i + 1] === '=') { push('assign', c + '='); i += 2; continue; }
    if (c === '+' && src[i + 1] === '+') { push('incr', '++'); i += 2; continue; }
    if (c === '-' && src[i + 1] === '-' && !/[A-Za-z]/.test(src[i + 2] || '')) { push('incr', '--'); i += 2; continue; }
    if (c === '-' && /[A-Za-z]/.test(src[i + 1] || '')) { const m = src.slice(i + 1).match(/^[A-Za-z][\w-]*(:)?/); const w = m[0].replace(/:$/, ''); const wl = w.toLowerCase(); if (PS_OPS.includes(wl) && !psIsCmdCtx(T)) { push('op', '-' + wl); i += 1 + w.length; continue; } push('param', w, { colon: !!m[1] }); i += 1 + m[0].length; continue; }
    if (c === '!' && src[i + 1] !== '=') { push('op', '!'); i++; continue; }
    if (c === '.' && src[i + 1] === '.') { push('op', '..'); i += 2; continue; }
    if (c === '.' && /[\\/]/.test(src[i + 1] || '')) { const m = src.slice(i).match(/^[^\s|;)}]+/); push('word', m[0]); i += m[0].length; continue; }
    if (c === '.' && /\s/.test(src[i + 1] || '') && (!T.length || T[T.length - 1].t === 'nl')) { push('dot', '.'); i++; continue; }
    if (c === '.') { push('.', '.'); i++; continue; }
    if (/[0-9]/.test(c) && !(T.length && T[T.length - 1].t === 'word' && !T[T.length - 1].sp)) { const m = src.slice(i).match(/^0x[0-9a-f]+|^\d+(\.\d+)?([kmgt]b)?/i); const nx = src[i + m[0].length]; if (nx && (/[A-Za-z_\\/:-]/.test(nx) || (nx === '.' && /\d/.test(src[i + m[0].length + 1] || ''))) && !/[kmgt]b$/i.test(m[0])) { const w = src.slice(i).match(/^[^\s|;(){},]+/)[0]; push('word', w); i += w.length; continue; } let v = m[0].toLowerCase(); let num = v.startsWith('0x') ? parseInt(v, 16) : parseFloat(v); const u = v.match(/([kmgt])b$/); if (u) num *= { k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[u[1]]; push('num', num); i += m[0].length; continue; }
    if ((c === '*' || c === '?') && psIsCmdCtx(T) && T[T.length - 1]?.t !== 'op') { const m = src.slice(i).match(/^[^\s|;(){},]+/); push('word', m[0]); i += m[0].length; continue; }
    if (c === '/' && /[A-Za-z?]/.test(src[i + 1] || '') && psIsCmdCtx(T)) { const m = src.slice(i).match(/^[^\s|;(){},]+/); push('word', m[0]); i += m[0].length; continue; }
    if ('+-*/%'.includes(c)) { push('op', c); i++; continue; }
    if (c === '=' && src[i + 1] === '=') { push('op', '-eq'); i += 2; continue; }
    if (c === '!' && src[i + 1] === '=') { push('op', '-ne'); i += 2; continue; }
    const m = src.slice(i).match(/^[^\s|;(){}\[\],'"=]+/);
    if (m) { let w = m[0]; const prev = T[T.length - 1]; if (w.includes('.') && /^[A-Za-z]/.test(w) && prev && prev.t !== 'nl' && prev.t !== '|' && prev.t !== '{' && !(T.length && psIsCmdCtx(T))) { w = w.split('.')[0]; } push('word', w); i += w.length; continue; }
    push('word', c); i++;
  }
  push('nl', '\n'); return T;
}
/** After a command name the rest of the line is arguments: -x is a parameter, not an operator */
function psIsCmdCtx(T) { let dep = 0; for (let k = T.length - 1; k >= 0; k--) { const t = T[k]; if (t.t === ')' || t.t === '}' || t.t === ']') { dep++; continue; } if (dep && (t.t === '(' || t.t === '{' || t.t === 'subx' || t.t === 'arr' || t.t === 'hash' || t.t === '[')) { dep--; continue; } if (dep) continue; if (t.t === 'nl' || t.t === '|' || t.t === '{' || t.t === '(' || t.t === 'subx' || t.t === 'arr' || t.t === 'hash' || (t.t === 'op' && (t.v === '&&' || t.v === '||'))) { const nx = T[k + 1]; return !!nx && nx.t === 'word' && /^[A-Za-z][\w-]*$/.test(nx.v) && !['if', 'elseif', 'foreach', 'while', 'for', 'switch', 'return', 'function', 'param', 'try', 'catch', 'throw', 'else', 'do', 'until', 'in', 'finally', 'filter', 'begin', 'process', 'end', 'break', 'continue', 'exit'].includes(nx.v.toLowerCase()); } } return !!T[0] && T[0].t === 'word' && /^[A-Za-z][\w-]*$/.test(T[0].v); }

// ---------------------------------------------------------------- parser
function psParse(src) {
  const T = psLex(src); let p = 0;
  const peek = (o = 0) => T[p + o] || { t: 'eof' }, next = () => T[p++] || { t: 'eof' };
  const skipNl = () => { while (peek().t === 'nl') p++; };
  const expect = (t) => { const x = next(); if (x.t !== t) throw new PSErr(`Missing '${t === '{' ? '{' : t === '}' ? '}' : t === ')' ? ')' : t}' near '${x.v ?? ''}'.`, { parse: true }); return x; };
  const kw = (w) => peek().t === 'word' && String(peek().v).toLowerCase() === w;
  function block() { skipNl(); expect('{'); const s = stmts('}'); expect('}'); return s; }
  function stmts(end) { const out = []; skipNl(); while (peek().t !== 'eof' && peek().t !== end) { out.push(stmt()); skipNl(); } return out; }
  function stmt() {
    if (kw('if')) { next(); const br = []; expect('('); skipNl(); const c = pipeline(); skipNl(); expect(')'); br.push([c, block()]); let els = null; for (;;) { const save = p; skipNl(); if (kw('elseif')) { next(); expect('('); const c2 = pipeline(); expect(')'); br.push([c2, block()]); } else if (kw('else')) { next(); els = block(); break; } else { p = save; break; } } return { k: 'if', br, els }; }
    if (kw('foreach') && peek(1).t === '(') { next(); expect('('); const v = next().v; if (!kw('in')) throw new PSErr("Missing 'in' after variable in foreach loop."); next(); const e = pipeline(); expect(')'); return { k: 'foreach', v, e, b: block() }; }
    if (kw('for') && peek(1).t === '(') { next(); expect('('); const a = peek().t === 'nl' ? null : pipelineOrAssign(); if (peek().t === 'nl') next(); const c = peek().t === 'nl' ? null : pipeline(); if (peek().t === 'nl') next(); const s = peek().t === ')' ? null : pipelineOrAssign(); expect(')'); return { k: 'for', a, c, s, b: block() }; }
    if (kw('while')) { next(); expect('('); const c = pipeline(); expect(')'); return { k: 'while', c, b: block() }; }
    if (kw('do')) { next(); const b = block(); skipNl(); const until = kw('until'); next(); expect('('); const c = pipeline(); expect(')'); return { k: 'do', b, c, until }; }
    if (kw('function') || kw('filter')) { next(); const name = next().v; let params = []; if (peek().t === '(') { next(); params = paramList(')'); expect(')'); } skipNl(); expect('{'); skipNl(); let body; if (kw('param')) { next(); expect('('); params = paramList(')'); expect(')'); } body = stmts('}'); expect('}'); return { k: 'func', name, params, body }; }
    if (kw('param')) { next(); expect('('); const params = paramList(')'); expect(')'); return { k: 'param', params }; }
    if (kw('try')) { next(); const b = block(); let c = null, f = null; skipNl(); if (kw('catch')) { next(); if (peek().t === '[') { while (next().t !== ']'); } c = block(); skipNl(); } if (kw('finally')) { next(); f = block(); } return { k: 'try', b, c, f }; }
    if (kw('return')) { next(); return { k: 'return', e: peek().t === 'nl' || peek().t === '}' ? null : pipeline() }; }
    if (kw('break')) { next(); return { k: 'break' }; }
    if (kw('continue')) { next(); return { k: 'continue' }; }
    if (kw('exit')) { next(); if (peek().t === 'num') next(); return { k: 'exit' }; }
    if (kw('throw')) { next(); return { k: 'throw', e: peek().t === 'nl' ? null : pipeline() }; }
    if (kw('switch')) { next(); const opts = []; while (peek().t === 'param') opts.push(next().v.toLowerCase()); expect('('); const e = pipeline(); expect(')'); skipNl(); expect('{'); const cases = []; skipNl(); while (peek().t !== '}') { let m; if (kw('default')) { next(); m = { def: true }; } else m = { e: primary() }; cases.push([m, block()]); skipNl(); } expect('}'); return { k: 'switch', e, cases, opts }; }
    return pipelineOrAssign();
  }
  function paramList(end) { const ps = []; skipNl(); while (peek().t !== end) { while (peek().t === '[') { let dep = 0; do { const x = next(); if (x.t === '[') dep++; if (x.t === ']') dep--; } while (dep > 0); skipNl(); } const v = next(); if (v.t !== 'var') throw new PSErr('Bad param() block'); let def = null; if (peek().t === 'assign') { next(); def = expr(); } ps.push({ name: v.v, def }); skipNl(); if (peek().t === ',') { next(); skipNl(); } } return ps; }
  function pipelineOrAssign() {
    const save = p;
    if (peek().t === 'var' || (peek().t === '[' )) {
      let target; try { target = postfix(); } catch { p = save; return pipeline(); }
      if (peek().t === 'assign') { const op = next().v; skipNl(); const val = kw('if') || kw('switch') || kw('foreach') ? { k: 'stmtval', s: stmt() } : pipeline(); return { k: 'assign', target, op, val }; }
      if (peek().t === 'incr') { const op = next().v; return { k: 'assign', target, op: op === '++' ? '+=' : '-=', val: { k: 'lit', v: 1 } }; }
      p = save;
    }
    if (peek().t === 'incr') { const op = next().v; const target = postfix(); return { k: 'assign', target, op: op === '++' ? '+=' : '-=', val: { k: 'lit', v: 1 } }; }
    return pipeline();
  }
  function pipeline() {
    const els = [element()]; let redir = null;
    while (peek().t === '|') { next(); skipNl(); els.push(element()); }
    if (peek().t === 'redir') { const r = next().v; redir = { app: r === '>>', to: argument() }; }
    let pl = { k: 'pipe', els, redir };
    while (peek().t === 'op' && (peek().v === '&&' || peek().v === '||')) { const o = next().v; pl = { k: 'chain', a: pl, op: o, b: pipeline() }; }
    return pl;
  }
  function element() {
    const t = peek();
    if (t.t === 'call' || t.t === 'dot') { next(); const target = primary(); return { k: 'cmd', name: target, args: args(), dyn: true, dot: t.t === 'dot' }; }
    if (t.t === 'word' && !/^[0-9]/.test(t.v) && !(peek(1).t === '::')) { next(); return { k: 'cmd', name: t.v, args: args() }; }
    return { k: 'expr', e: expr() };
  }
  function args() {
    const out = [];
    while (!['nl', '|', ')', '}', 'eof', 'redir'].includes(peek().t) && !(peek().t === 'op' && (peek().v === '&&' || peek().v === '||'))) {
      const t = peek();
      if (t.t === 'param') { next(); if (t.colon) { out.push({ param: t.v, val: argument() }); } else out.push({ param: t.v }); continue; }
      if (t.t === 'op' && t.v.startsWith('-') && !['-'].includes(t.v)) { next(); out.push({ param: t.v.slice(1) }); continue; }
      if (t.t === 'splat') { next(); out.push({ splat: t.v }); continue; }
      out.push({ val: argument() });
    }
    return out;
  }
  function argument() {
    const t = peek();
    let v;
    if (t.t === 'word' || (t.t === 'op' && t.v === '-')) { next(); let s = t.v; while (!peek(-1).sp && ['word', '.', 'num', 'op'].includes(peek().t) && peek().t !== 'nl' && !(peek().t === 'op' && (peek().v === '&&' || peek().v === '||'))) { const x = next(); s += x.t === 'op' && x.v.startsWith('-') ? x.v : x.v; } v = { k: 'lit', v: s, bare: true }; }
    else if (t.t === 'num' && !peek(1).sp && peek(1).t === 'word') { next(); const w = next(); v = { k: 'lit', v: String(t.v) + w.v, bare: true }; }
    else v = postfix();
    if (peek().t === ',' ) { const arr = [v]; while (peek().t === ',') { next(); arr.push(peek().t === 'word' ? { k: 'lit', v: next().v } : postfix()); } return { k: 'array', items: arr }; }
    return v;
  }
  function expr() { return binary(0); }
  const PREC = [['-or', '||'], ['-and', '&&', '-xor'], ['-band', '-bor'], ['-eq', '-ne', '-gt', '-ge', '-lt', '-le', '-like', '-notlike', '-match', '-notmatch', '-contains', '-notcontains', '-in', '-notin', '-replace', '-split', '-join', '-is', '-isnot', '-as', '-ieq', '-ine', '-ceq', '-cne', '-imatch', '-cmatch', '-ilike'], ['..'], ['+', '-'], ['*', '/', '%'], ['-f']];
  function binary(lv) {
    if (lv >= PREC.length) return unary();
    let l = binary(lv + 1);
    while (peek().t === 'op' && PREC[lv].includes(peek().v)) { const op = next().v; skipNl(); const r = binary(lv + 1); l = { k: 'bin', op, l, r }; }
    if (lv === 6 && peek().t === ',' && false) { }
    return l;
  }
  function unary() {
    const t = peek();
    if (t.t === 'op' && (t.v === '-not' || t.v === '!')) { next(); return { k: 'not', e: unary() }; }
    if (t.t === 'op' && t.v === '-') { next(); return { k: 'neg', e: unary() }; }
    if (t.t === 'op' && t.v === '-split') { next(); return { k: 'bin', op: '-split', l: unary(), r: { k: 'lit', v: '\\s+' } }; }
    if (t.t === 'op' && t.v === '-join') { next(); return { k: 'bin', op: '-join', l: unary(), r: { k: 'lit', v: '' } }; }
    if (t.t === '[' && peek(1).t === 'word' && peek(2).t === ']' && peek(3).t !== '::') { next(); const ty = next().v; next(); return { k: 'cast', ty, e: unary() }; }
    const e = postfix();
    if (peek().t === ',' && inArrayCtx) { const items = [e]; while (peek().t === ',') { next(); skipNl(); items.push(postfix()); } return { k: 'array', items }; }
    return e;
  }
  let inArrayCtx = true;
  function postfix() {
    let e = primary();
    for (;;) {
      const t = peek();
      if (t.t === '.' && !T[p - 1].sp) { next(); const name = next(); if (peek().t === '(' && !peek(-1).sp) { next(); const a = callArgs(); e = { k: 'mcall', o: e, m: name.v, a }; } else e = { k: 'prop', o: e, m: name.t === 'var' ? { k: 'var', v: name.v } : name.v }; continue; }
      if (t.t === '::') { next(); const name = next(); if (peek().t === '(') { next(); const a = callArgs(); e = { k: 'smcall', o: e, m: name.v, a }; } else e = { k: 'sprop', o: e, m: name.v }; continue; }
      if (t.t === '[' && !T[p - 1].sp) { next(); const i = expr(); expect(']'); e = { k: 'index', o: e, i }; continue; }
      break;
    }
    return e;
  }
  function callArgs() { const a = []; skipNl(); while (peek().t !== ')') { const s = inArrayCtx; inArrayCtx = false; a.push(expr()); inArrayCtx = s; skipNl(); if (peek().t === ',') { next(); skipNl(); } } expect(')'); return a; }
  function primary() {
    const t = next();
    switch (t.t) {
      case 'num': return { k: 'lit', v: t.v };
      case 'str': return t.dq ? { k: 'istr', v: t.v } : { k: 'lit', v: t.v };
      case 'var': return { k: 'var', v: t.v };
      case '(': { skipNl(); const e = pipelineOrAssign(); skipNl(); expect(')'); return { k: 'paren', e }; }
      case 'subx': { const s = stmts(')'); expect(')'); return { k: 'subx', s }; }
      case 'arr': { const s = stmts(')'); expect(')'); return { k: 'arrx', s }; }
      case 'hash': { const items = []; skipNl(); while (peek().t !== '}') { const kt = next(); const key = kt.t === 'str' || kt.t === 'word' || kt.t === 'num' ? String(kt.v) : kt.v; expect('assign'); skipNl(); const s = inArrayCtx; inArrayCtx = true; const v = kw('if') ? { k: 'stmtval', s: stmt() } : pipeline(); inArrayCtx = s; items.push([key, v]); skipNl(); } expect('}'); return { k: 'hash', items }; }
      case '{': { const s = stmts('}'); expect('}'); return { k: 'sb', s, src: '' }; }
      case '[': { let ty = ''; while (peek().t !== ']') ty += next().v; next(); if (peek().t === '::') return { k: 'type', ty }; return { k: 'cast', ty, e: unary() }; }
      case 'word': if (/^(true|false|null)$/i.test(t.v)) return { k: 'lit', v: t.v }; return { k: 'lit', v: t.v, bare: true };
      case 'op': if (t.v === '-' ) return { k: 'neg', e: primary() };
    }
    throw new PSErr(`Unexpected token '${t.v ?? t.t}' in expression or statement.`, { parse: true });
  }
  const prog = stmts('eof'); return prog;
}

// ---------------------------------------------------------------- values and helpers
const psIsObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !v.__sb;
function psStr(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (Array.isArray(v)) return v.map(psStr).join(' ');
  if (v instanceof Date) return psDate(v, 'G');
  if (v.__sb) return v.src || '{ … }';
  if (v.__ss) return 'System.Security.SecureString';
  if (psIsObj(v)) { if (v.__ht) return 'System.Collections.Hashtable'; if (v.__str) return v.__str; if (v.Name != null) return String(v.Name); return `@{${psProps(v).map((k) => `${k}=${psStr(v[k])}`).join('; ')}}`; }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(10));
  return String(v);
}
const psProps = (o) => Object.keys(o).filter((k) => !k.startsWith('__'));
function psBool(v) { if (Array.isArray(v)) return v.length > 0 && (v.length > 1 || psBool(v[0])); if (v === '' || v == null || v === 0 || v === false) return false; return true; }
function psDate(d, f) {
  const p2 = (x) => String(x).padStart(2, '0'), M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], D = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (!f || f === 'G') return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()} ${d.getHours() % 12 || 12}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  if (f === 'F' || f === 'full') return `${D[d.getDay()]}, ${M[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${d.getHours() % 12 || 12}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  return f.replace(/yyyy|yy|MMMM|MMM|MM|dddd|ddd|dd|HH|hh|mm|ss|tt|d|M|h|H/g, (k) => ({ yyyy: d.getFullYear(), yy: String(d.getFullYear()).slice(2), MMMM: M[d.getMonth()], MMM: M[d.getMonth()].slice(0, 3), MM: p2(d.getMonth() + 1), dddd: D[d.getDay()], ddd: D[d.getDay()].slice(0, 3), dd: p2(d.getDate()), HH: p2(d.getHours()), hh: p2(d.getHours() % 12 || 12), mm: p2(d.getMinutes()), ss: p2(d.getSeconds()), tt: d.getHours() < 12 ? 'AM' : 'PM', d: d.getDate(), M: d.getMonth() + 1, h: d.getHours() % 12 || 12, H: d.getHours() }[k]));
}
function psFmt(fmt, args) { return String(fmt).replace(/\{(\d+)(,(-?\d+))?(:([^}]+))?\}/g, (m, i, _a, w, _b, f) => { let v = args[+i]; let s; if (f && typeof v === 'number') { const t = f[0].toUpperCase(), n = +(f.slice(1) || 2); s = t === 'N' ? v.toLocaleString('en-US', { minimumFractionDigits: n, maximumFractionDigits: n }) : t === 'F' ? v.toFixed(n) : t === 'P' ? (v * 100).toFixed(n) + ' %' : t === 'D' ? String(Math.round(v)).padStart(n, '0') : /^0+(\.0+)?$/.test(f) ? v.toFixed((f.split('.')[1] || '').length) : String(v); } else if (f && v instanceof Date) s = psDate(v, f); else s = psStr(v); if (w) s = +w < 0 ? s.padEnd(-w) : s.padStart(+w); return s; }); }
function psLike(s, pat) { const re = new RegExp('^' + String(pat).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[([^\]]+)\]/g, '[$1]') + '$', 'i'); return re.test(String(s)); }
function psCmp(a, b) { if (typeof a === 'number' || (typeof a === 'string' && typeof b === 'number')) { const x = +a, y = +b; if (!isNaN(x) && !isNaN(y)) return x - y; } if (a instanceof Date) return a - (b instanceof Date ? b : new Date(b)); return String(a ?? '').toLowerCase() < String(b ?? '').toLowerCase() ? -1 : String(a ?? '').toLowerCase() > String(b ?? '').toLowerCase() ? 1 : 0; }
function psEq(a, b) { if (a == null || b == null) return a == b; if (typeof a === 'boolean') return a === psBool(b); if (typeof a === 'number') return a === +b; return String(psStr(a)).toLowerCase() === String(psStr(b)).toLowerCase(); }
function psObj(type, props, view) { return Object.assign(Object.defineProperty({}, '__type', { value: type, enumerable: false, writable: true }), view ? Object.defineProperty({}, '__view', { value: view, enumerable: false }) : {}, props); }
function psNew(type, props, view, str) { const o = {}; Object.defineProperty(o, '__type', { value: type, enumerable: false }); if (view) Object.defineProperty(o, '__view', { value: view, enumerable: false }); if (str) Object.defineProperty(o, '__str', { value: str, enumerable: false }); return Object.assign(o, props); }
function psGet(o, k) {
  if (o == null) return null;
  if (Array.isArray(o)) { const kl = String(k).toLowerCase(); if (kl === 'count' || kl === 'length') return o.length; return o.map((x) => psGet(x, k)).filter((x) => x != null); }
  const kl = String(k).toLowerCase();
  if (typeof o === 'string') { if (kl === 'length') return o.length; return null; }
  if (o instanceof Date) return { year: o.getFullYear(), month: o.getMonth() + 1, day: o.getDate(), hour: o.getHours(), minute: o.getMinutes(), dayofweek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][o.getDay()], date: new Date(o.getFullYear(), o.getMonth(), o.getDate()), ticks: o.getTime() }[kl];
  if (typeof o === 'object') { const key = Object.keys(o).find((x) => x.toLowerCase() === kl); if (key != null) return o[key]; if (kl === 'count' && o.__ht) return psProps(o).length; if (kl === 'keys' && o.__ht) return psProps(o); if (kl === 'values' && o.__ht) return psProps(o).map((x) => o[x]); if (kl === 'count') return 1; return null; }
  if (typeof o === 'number') return null;
  return null;
}
function psSet(o, k, v) { if (o == null) throw new PSErr("The property cannot be found on this object. Verify that the property exists and can be set."); const key = Object.keys(o).find((x) => x.toLowerCase() === String(k).toLowerCase()) ?? k; o[key] = v; }
const psFlat = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const psOne = (out) => (out.length === 0 ? null : out.length === 1 ? out[0] : out);

// ---------------------------------------------------------------- evaluator
function psRun(H, src, o = {}) {
  let ast; try { ast = psParse(src); } catch (e) { return { out: [], err: [psErrRec(e, '')], parse: true }; }
  const ctx = { H, err: [], warn: [], host: [], scope: o.scope || H.vars };
  let out = [];
  try { out = psStmts(ctx, ast, ctx.scope); } catch (e) { if (e instanceof PSFlow) { if (e.kind === 'return') out = psFlat(e.val); } else ctx.err.push(psErrRec(e, '')); }
  return { out, err: ctx.err, host: ctx.host };
}
const psErrRec = (e, cmd) => ({ msg: String(e.message).replace(/^[\w.-]+ : /, ''), cmd: e.cmd ?? cmd, cat: e.cat || (e.parse ? 'ParserError' : e.notfound ? 'ObjectNotFound: (' + (e.target || '') + ':String) [], CommandNotFoundException' : 'InvalidOperation'), id: e.fqid });
function psStmts(ctx, list, sc) { const out = []; for (const s of list) { const r = psStmt(ctx, s, sc); if (r && r.length) out.push(...r); } return out; }
function psScope(parent) { const s = Object.create(null); Object.defineProperty(s, '__parent', { value: parent, enumerable: false }); return s; }
function psLookup(sc, name) { const n = name.toLowerCase(); for (let s = sc; s; s = s.__parent) if (n in s) return { s, n }; return null; }
function psVarGet(ctx, sc, name) {
  const n = name.toLowerCase().replace(/^(global|script|local|private):/, '');
  if (n === 'true') return true; if (n === 'false') return false; if (n === 'null') return null;
  if (n === '_' || n === 'psitem') { const r = psLookup(sc, '_'); return r ? r.s[r.n] : null; }
  if (n.startsWith('env:')) { const e = ctx.H.env || {}; const k = Object.keys(e).find((x) => x.toLowerCase() === n.slice(4)); return k ? e[k] : null; }
  if (n === 'pwd') return psNew('PathInfo', { Path: ctx.H.cwd }, null, ctx.H.cwd);
  if (n === 'error') return ctx.err.map((x) => x.msg).reverse();
  if (n === 'lastexitcode') return ctx.H.lastExit ?? 0;
  if (n === 'psversiontable') return psNew('Hashtable', { PSVersion: '5.1.20348.2849', PSEdition: 'Desktop', BuildVersion: '10.0.20348.2849', CLRVersion: '4.0.30319.42000' });
  if (n === 'home') return `C:\\Users\\${ctx.H.user || 'Administrator'}`;
  if (n === 'host') return psNew('Host', { Name: 'ConsoleHost', Version: '5.1' });
  if (n === 'args') { const r = psLookup(sc, 'args'); return r ? r.s[r.n] : []; }
  const r = psLookup(sc, n); return r ? r.s[r.n] : null;
}
function psVarSet(sc, name, v) { const n = name.toLowerCase().replace(/^(local|private):/, ''); if (n.startsWith('global:') || n.startsWith('script:')) { let s = sc; while (s.__parent) s = s.__parent; s[n.split(':')[1]] = v; return; } const r = psLookup(sc, n); (r ? r.s : sc)[n] = v; }
function psStmt(ctx, s, sc) {
  switch (s.k) {
    case 'if': for (const [c, b] of s.br) if (psBool(psOne(psEvalPipe(ctx, c, sc)))) return psStmts(ctx, b, sc); return s.els ? psStmts(ctx, s.els, sc) : [];
    case 'foreach': { const out = []; for (const x of psFlat(psOne(psEvalPipe(ctx, s.e, sc)))) { psVarSet(sc, s.v, x); try { out.push(...psStmts(ctx, s.b, sc)); } catch (e) { if (e instanceof PSFlow && e.kind === 'break') break; if (e instanceof PSFlow && e.kind === 'continue') continue; throw e; } psGuard(ctx); } return out; }
    case 'for': { const out = []; if (s.a) psStmt(ctx, s.a, sc); while (!s.c || psBool(psOne(psEvalPipe(ctx, s.c, sc)))) { try { out.push(...psStmts(ctx, s.b, sc)); } catch (e) { if (e instanceof PSFlow && e.kind === 'break') break; if (!(e instanceof PSFlow && e.kind === 'continue')) throw e; } if (s.s) psStmt(ctx, s.s, sc); psGuard(ctx); } return out; }
    case 'while': { const out = []; while (psBool(psOne(psEvalPipe(ctx, s.c, sc)))) { try { out.push(...psStmts(ctx, s.b, sc)); } catch (e) { if (e instanceof PSFlow && e.kind === 'break') break; if (!(e instanceof PSFlow && e.kind === 'continue')) throw e; } psGuard(ctx); } return out; }
    case 'do': { const out = []; do { try { out.push(...psStmts(ctx, s.b, sc)); } catch (e) { if (e instanceof PSFlow && e.kind === 'break') break; if (!(e instanceof PSFlow && e.kind === 'continue')) throw e; } psGuard(ctx); } while (s.until ? !psBool(psOne(psEvalPipe(ctx, s.c, sc))) : psBool(psOne(psEvalPipe(ctx, s.c, sc)))); return out; }
    case 'func': { let root = sc; while (root.__parent && !root.__fnroot) root = root.__parent; (ctx.H.funcs ??= {})[s.name.toLowerCase()] = { name: s.name, params: s.params, body: s.body }; return []; }
    case 'param': s.params.forEach((pp) => { if (psLookup(sc, pp.name) == null || !(pp.name.toLowerCase() in sc)) sc[pp.name.toLowerCase()] = pp.def ? psEval(ctx, pp.def, sc) : null; }); return [];
    case 'try': { let out = []; try { out = psStmts(ctx, s.b, sc); } catch (e) { if (e instanceof PSFlow) throw e; if (!s.c) throw e; const msg = String(e.message).replace(/^[\w.-]+ : /, ''); const ex = psNew('ErrorRecord', { Exception: psNew('Exception', { Message: msg }, null, msg) }, null, msg); const inner = psScope(sc); inner._ = ex; inner.psitem = ex; out = psStmts(ctx, s.c, inner); } finally { if (s.f) psStmts(ctx, s.f, sc); } return out; }
    case 'return': throw new PSFlow('return', s.e ? psOne(psEvalPipe(ctx, s.e, sc)) : null);
    case 'break': throw new PSFlow('break'); case 'continue': throw new PSFlow('continue');
    case 'exit': throw new PSFlow('return', null);
    case 'throw': throw new PSErr(s.e ? psStr(psOne(psEvalPipe(ctx, s.e, sc))) : 'ScriptHalted');
    case 'switch': { const v = psOne(psEvalPipe(ctx, s.e, sc)); const out = []; for (const x of psFlat(v)) { let hit = false; for (const [m, b] of s.cases) { if (m.def) continue; const mv = psEval(ctx, m.e, sc); const ok = mv && mv.__sb ? psBool(psOne(psCallSb(ctx, mv, sc, x))) : s.opts.includes('wildcard') ? psLike(x, mv) : s.opts.includes('regex') ? new RegExp(mv, 'i').test(x) : psEq(x, mv); if (ok) { hit = true; const inner = psScope(sc); inner._ = x; try { out.push(...psStmts(ctx, b, inner)); } catch (e) { if (e instanceof PSFlow && e.kind === 'break') return out; throw e; } } } if (!hit) { const d = s.cases.find(([m]) => m.def); if (d) { const inner = psScope(sc); inner._ = x; out.push(...psStmts(ctx, d[1], inner)); } } } return out; }
    case 'assign': { const cur = s.op === '=' ? null : psEval(ctx, s.target, sc); let v = s.val.k === 'stmtval' ? psOne(psStmt(ctx, s.val.s, sc)) : s.val.k === 'pipe' || s.val.k === 'chain' ? psOne(psEvalPipe(ctx, s.val, sc)) : psEval(ctx, s.val, sc); if (s.val.k === 'pipe' && s.val.els.length === 1 && s.val.els[0].k === 'expr' && (s.val.els[0].e.k === 'arrx')) v = psFlat(psEvalPipe(ctx, s.val, sc)); if (s.op !== '=') v = psBin(ctx, s.op[0], cur, v); psAssign(ctx, s.target, v, sc); return []; }
    default: return psEvalPipe(ctx, s, sc);
  }
}
function psGuard(ctx) { ctx.steps = (ctx.steps || 0) + 1; if (ctx.steps > 200000) throw new PSErr('The script ran too long (an endless loop?) and was stopped.'); }
function psAssign(ctx, t, v, sc) {
  if (t.k === 'var') return psVarSet(sc, t.v, v);
  if (t.k === 'prop') return psSet(psEval(ctx, t.o, sc), typeof t.m === 'string' ? t.m : psEval(ctx, t.m, sc), v);
  if (t.k === 'index') { const o = psEval(ctx, t.o, sc), i = psEval(ctx, t.i, sc); if (Array.isArray(o)) o[i < 0 ? o.length + i : i] = v; else psSet(o, i, v); return; }
  if (t.k === 'cast') return psAssign(ctx, t.e, psCast(t.ty, v), sc);
  throw new PSErr('The assignment expression is not valid.');
}
function psEvalPipe(ctx, pl, sc) {
  if (pl.k === 'chain') { const a = psEvalPipe(ctx, pl.a, sc); const ok = !ctx.lastFailed; if ((pl.op === '&&' && ok) || (pl.op === '||' && !ok)) return a.concat(psEvalPipe(ctx, pl.b, sc)); return a; }
  if (pl.k !== 'pipe') return psFlatOut(psEval(ctx, pl, sc));
  let input = null; ctx.lastFailed = false;
  pl.els.forEach((el, i) => { input = psElement(ctx, el, sc, input, i === 0); });
  let out = input || [];
  if (pl.redir) { const path = psStr(psEval(ctx, pl.redir.to, sc)); psWriteFile(ctx.H, path, psFormat(out, ctx.H).replace(/\n$/, ''), pl.redir.app); return []; }
  return out;
}
const psFlatOut = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
function psElement(ctx, el, sc, input, first) {
  if (el.k === 'expr') { const v = psEval(ctx, el.e, sc); if (el.e.k === 'paren' || el.e.k === 'subx' || el.e.k === 'arrx') return psFlatOut(v); return Array.isArray(v) ? v : v === undefined ? [] : [v]; }
  let name = el.dyn ? psEval(ctx, el.name, sc) : el.name;
  if (name && name.__sb) return psFlat(psCallSb(ctx, name, sc, input && input[0], psArgVals(ctx, el.args, sc)));
  name = psStr(name);
  const args = psArgs(ctx, el.args, sc);
  return psInvoke(ctx, name, args, input, sc, el);
}
function psArgVals(ctx, A, sc) { return A.filter((a) => a.val).map((a) => psEval(ctx, a.val, sc)); }
function psArgs(ctx, A, sc) {
  const out = { named: {}, pos: [], rawArgv: [] };
  for (let i = 0; i < A.length; i++) {
    const a = A[i];
    if (a.splat) { const h = psVarGet(ctx, sc, a.splat); if (Array.isArray(h)) out.pos.push(...h); else if (h) psProps(h).forEach((k) => (out.named[k.toLowerCase()] = h[k])); continue; }
    if (a.param != null) {
      const k = a.param.toLowerCase();
      if (a.val) { const v = psEval(ctx, a.val, sc); out.named[k] = v; out.rawArgv.push(`-${a.param}:${psStr(v)}`); continue; }
      out.rawArgv.push(`-${a.param}`); const nx = A[i + 1];
      if (nx && nx.val && nx.param == null && !nx.splat) { const v = psEval(ctx, nx.val, sc); out.named[k] = { __pend: v }; out.rawArgv.push(psFlat(v).map(psStr).join(',')); i++; } else out.named[k] = psSwitch;
      continue;
    }
    const v = psEval(ctx, a.val, sc); out.pos.push(v); out.rawArgv.push(psFlat(v).map(psStr).join(','));
  }
  return out;
}
const psSwitch = Object.freeze({ __switch: true });
/** Call a scriptblock with $_ (and arguments) */
function psCallSb(ctx, sb, sc, item, args) { const inner = psScope(sb.sc || sc); inner._ = item; inner.psitem = item; inner.args = args || []; try { return psStmts(ctx, sb.s, inner); } catch (e) { if (e instanceof PSFlow && e.kind === 'return') return psFlat(e.val); throw e; } }
function psEval(ctx, e, sc) {
  switch (e.k) {
    case 'lit': return e.bare && /^-?\d+(\.\d+)?$/.test(e.v) ? +e.v : /^\$?true$/i.test(e.v) && !e.bare ? true : e.v;
    case 'istr': return psInterp(ctx, e.v, sc);
    case 'var': return psVarGet(ctx, sc, e.v);
    case 'paren': { if (e.e.k === 'assign') { psStmt(ctx, e.e, sc); return psEval(ctx, e.e.target, sc); } const r = psEvalPipe(ctx, e.e, sc); return r.length === 1 ? r[0] : r; }
    case 'subx': { const r = psStmts(ctx, e.s, sc); return r.length === 1 ? r[0] : r; }
    case 'arrx': return psStmts(ctx, e.s, sc).flatMap((x) => x);
    case 'array': return e.items.map((x) => psEval(ctx, x, sc));
    case 'hash': { const h = {}; Object.defineProperty(h, '__ht', { value: true, enumerable: false }); e.items.forEach(([k, v]) => (h[k] = v.k === 'stmtval' ? psOne(psStmt(ctx, v.s, sc)) : v.k === 'pipe' ? psOne(psEvalPipe(ctx, v, sc)) : psEval(ctx, v, sc))); return h; }
    case 'sb': return { __sb: true, s: e.s, sc };
    case 'not': return !psBool(psEval(ctx, e.e, sc));
    case 'neg': return -psEval(ctx, e.e, sc);
    case 'cast': return psCast(e.ty, psEval(ctx, e.e, sc));
    case 'bin': if (e.op === '-and') return psBool(psEval(ctx, e.l, sc)) && psBool(psEval(ctx, e.r, sc)); if (e.op === '-or') return psBool(psEval(ctx, e.l, sc)) || psBool(psEval(ctx, e.r, sc)); return psBin(ctx, e.op, psEval(ctx, e.l, sc), psEval(ctx, e.r, sc));
    case 'prop': { const o = psEval(ctx, e.o, sc); const k = typeof e.m === 'string' ? e.m : psEval(ctx, e.m, sc); return psGet(o, k); }
    case 'index': { const o = psEval(ctx, e.o, sc), i = psEval(ctx, e.i, sc); if (Array.isArray(o)) { if (Array.isArray(i)) return i.map((x) => o[x < 0 ? o.length + x : x]); return o[i < 0 ? o.length + i : i]; } if (typeof o === 'string') return o[i]; return psGet(o, i); }
    case 'mcall': return psMethod(ctx, psEval(ctx, e.o, sc), e.m, e.a.map((x) => psEval(ctx, x, sc)));
    case 'smcall': return psStatic(ctx, e.o.ty, e.m, e.a.map((x) => psEval(ctx, x, sc)));
    case 'sprop': return psStatic(ctx, e.o.ty, e.m, null);
    case 'type': return { __typeName: e.ty };
    case 'pipe': case 'chain': return psOne(psEvalPipe(ctx, e, sc));
  }
  throw new PSErr('Cannot evaluate the expression');
}
function psInterp(ctx, s, sc) {
  return s.replace(/`\$/g, '\u0001').replace(/\$\(((?:[^()]|\([^()]*\))*)\)|\$\{([^}]+)\}|\$([A-Za-z_][\w]*(?::[A-Za-z_]\w*)?|_)/g, (m, x, y, z) => { if (x != null) { const r = psRun(ctx.H, x, { scope: sc }); return psStr(psOne(r.out)); } return psStr(psVarGet(ctx, sc, y ?? z)); }).replace(/\u0001/g, '$');
}
function psBin(ctx, op, a, b) {
  const arr = Array.isArray(a);
  switch (op) {
    case '+': if (arr) return a.concat(psFlat(b)); if (a && a.__ht) { const h = {}; Object.defineProperty(h, '__ht', { value: true, enumerable: false }); Object.assign(h, a, b); return h; } if (typeof a === 'string') return a + psStr(b); if (a instanceof Date) return new Date(a.getTime() + +b); if (a == null) return b; return +a + +b;
    case '-': if (a instanceof Date && b instanceof Date) return psNew('TimeSpan', { Days: Math.floor((a - b) / 864e5), Hours: Math.floor(((a - b) / 36e5) % 24), TotalDays: (a - b) / 864e5, TotalHours: (a - b) / 36e5, TotalMinutes: (a - b) / 6e4 }); return +a - +b;
    case '*': if (typeof a === 'string') return a.repeat(+b); return +a * +b;
    case '/': if (+b === 0) throw new PSErr('Attempted to divide by zero.'); return +a / +b;
    case '%': return +a % +b;
    case '..': { const r = []; for (let i = +a; a <= b ? i <= +b : i >= +b; i += a <= b ? 1 : -1) r.push(i); return r; }
    case '-eq': case '-ieq': case '-ceq': return arr ? a.filter((x) => psEq(x, b)) : psEq(a, b);
    case '-ne': case '-ine': case '-cne': return arr ? a.filter((x) => !psEq(x, b)) : !psEq(a, b);
    case '-gt': return arr ? a.filter((x) => psCmp(x, b) > 0) : psCmp(a, b) > 0;
    case '-ge': return arr ? a.filter((x) => psCmp(x, b) >= 0) : psCmp(a, b) >= 0;
    case '-lt': return arr ? a.filter((x) => psCmp(x, b) < 0) : psCmp(a, b) < 0;
    case '-le': return arr ? a.filter((x) => psCmp(x, b) <= 0) : psCmp(a, b) <= 0;
    case '-like': case '-ilike': return arr ? a.filter((x) => psLike(x, b)) : psLike(a, b);
    case '-notlike': return arr ? a.filter((x) => !psLike(x, b)) : !psLike(a, b);
    case '-match': case '-imatch': case '-cmatch': { const re = new RegExp(psStr(b), op === '-cmatch' ? '' : 'i'); if (arr) return a.filter((x) => re.test(psStr(x))); const m = psStr(a).match(re); if (m) { const h = {}; Object.defineProperty(h, '__ht', { value: true, enumerable: false }); m.forEach((v, i) => (h[i] = v)); Object.assign(h, m.groups || {}); ctx.scope.matches = h; } return !!m; }
    case '-notmatch': { const re = new RegExp(psStr(b), 'i'); return arr ? a.filter((x) => !re.test(psStr(x))) : !re.test(psStr(a)); }
    case '-contains': return psFlat(a).some((x) => psEq(x, b));
    case '-notcontains': return !psFlat(a).some((x) => psEq(x, b));
    case '-in': return psFlat(b).some((x) => psEq(x, a));
    case '-notin': return !psFlat(b).some((x) => psEq(x, a));
    case '-replace': { const [pat, rep] = Array.isArray(b) ? b : [b, '']; const re = new RegExp(psStr(pat), 'gi'); const f = (x) => psStr(x).replace(re, psStr(rep).replace(/\$(\d)/g, '$$$1')); return arr ? a.map(f) : f(a); }
    case '-split': return psStr(a).split(new RegExp(psStr(b), 'i'));
    case '-join': return psFlat(a).map(psStr).join(psStr(b));
    case '-f': return psFmt(a, psFlat(b));
    case '-is': return psIsType(a, b);
    case '-isnot': return !psIsType(a, b);
    case '-as': return psCast(b.__typeName || b, a);
    case '-band': return +a & +b; case '-bor': return +a | +b; case '-xor': return psBool(a) !== psBool(b);
  }
  throw new PSErr(`Unknown operator ${op}`);
}
function psIsType(a, t) { const n = String(t.__typeName || t).toLowerCase(); if (n === 'string') return typeof a === 'string'; if (n === 'int' || n === 'int32') return Number.isInteger(a); if (n === 'array') return Array.isArray(a); if (n === 'datetime') return a instanceof Date; return false; }
function psCast(ty, v) {
  const t = String(ty).toLowerCase().replace(/^system\./, '');
  if (t === 'int' || t === 'int32' || t === 'int64' || t === 'long') { const n = Math.round(+psStr(v)); if (isNaN(n)) throw new PSErr(`Cannot convert value "${psStr(v)}" to type "System.Int32". Error: "Input string was not in a correct format."`); return n; }
  if (t === 'double' || t === 'decimal' || t === 'float') return +psStr(v);
  if (t === 'string') return psStr(v);
  if (t === 'bool' || t === 'boolean') return psBool(v);
  if (t === 'datetime') { const d = new Date(psStr(v)); if (isNaN(d)) throw new PSErr(`Cannot convert value "${psStr(v)}" to type "System.DateTime".`); return d; }
  if (t === 'array' || t.endsWith('[]')) return psFlat(v);
  if (t === 'pscustomobject' || t === 'psobject') { if (v && v.__ht) { const o = {}; Object.defineProperty(o, '__type', { value: 'PSCustomObject', enumerable: false }); psProps(v).forEach((k) => (o[k] = v[k])); return o; } return v; }
  if (t === 'ordered') return v;
  if (t === 'ipaddress' || t === 'net.ipaddress') { if (!isIp(psStr(v))) throw new PSErr(`Cannot convert value "${psStr(v)}" to type "System.Net.IPAddress". Error: "An invalid IP address was specified."`); return psStr(v); }
  if (t === 'securestring' || t === 'security.securestring') return { __ss: true, v: psStr(v) };
  return v;
}
function psMethod(ctx, o, m, a) {
  const ml = m.toLowerCase();
  if (o == null) throw new PSErr(`You cannot call a method on a null-valued expression.`);
  if (typeof o === 'string') {
    switch (ml) { case 'toupper': return o.toUpperCase(); case 'tolower': return o.toLowerCase(); case 'trim': return a[0] ? o.replace(new RegExp(`^[${a[0]}]+|[${a[0]}]+$`, 'g'), '') : o.trim(); case 'trimend': return a[0] ? o.replace(new RegExp(`[${a[0]}]+$`), '') : o.trimEnd(); case 'trimstart': return o.trimStart(); case 'split': return o.split(a[0] ?? ' '); case 'replace': return o.split(psStr(a[0])).join(psStr(a[1])); case 'substring': return a.length > 1 ? o.substr(a[0], a[1]) : o.slice(a[0]); case 'startswith': return o.toLowerCase().startsWith(psStr(a[0]).toLowerCase()); case 'endswith': return o.toLowerCase().endsWith(psStr(a[0]).toLowerCase()); case 'contains': return o.includes(psStr(a[0])); case 'indexof': return o.indexOf(psStr(a[0])); case 'padleft': return o.padStart(a[0], a[1] ?? ' '); case 'padright': return o.padEnd(a[0], a[1] ?? ' '); case 'tostring': return o; case 'length': return o.length; case 'equals': return psEq(o, a[0]); case 'tochararray': return [...o]; }
  }
  if (typeof o === 'number') { if (ml === 'tostring') return a[0] ? psFmt(`{0:${a[0]}}`, [o]) : psStr(o); if (ml === 'equals') return o === +a[0]; }
  if (o instanceof Date) { switch (ml) { case 'adddays': return new Date(o.getTime() + a[0] * 864e5); case 'addhours': return new Date(o.getTime() + a[0] * 36e5); case 'addminutes': return new Date(o.getTime() + a[0] * 6e4); case 'addmonths': { const d = new Date(o); d.setMonth(d.getMonth() + a[0]); return d; } case 'tostring': return psDate(o, a[0] || 'G'); case 'toshortdatestring': return psDate(o, 'M/d/yyyy'); } }
  if (Array.isArray(o)) { switch (ml) { case 'contains': return o.some((x) => psEq(x, a[0])); case 'indexof': return o.findIndex((x) => psEq(x, a[0])); case 'add': o.push(a[0]); return undefined; case 'remove': { const i = o.findIndex((x) => psEq(x, a[0])); if (i >= 0) o.splice(i, 1); return undefined; } case 'count': return o.length; case 'where': return o.filter((x) => psBool(psOne(psCallSb(ctx, a[0], ctx.scope, x)))); case 'foreach': return o.map((x) => psOne(psCallSb(ctx, a[0], ctx.scope, x))); case 'tostring': return 'System.Object[]'; } }
  if (o && o.__ht) { switch (ml) { case 'add': o[psStr(a[0])] = a[1]; return undefined; case 'containskey': return psProps(o).some((k) => k.toLowerCase() === psStr(a[0]).toLowerCase()); case 'remove': delete o[psStr(a[0])]; return undefined; case 'keys': return psProps(o); } }
  if (o && o.__methods && o.__methods[ml]) return o.__methods[ml](...a);
  if (ml === 'tostring') return psStr(o);
  if (ml === 'gettype') return psNew('RuntimeType', { Name: typeof o === 'string' ? 'String' : Array.isArray(o) ? 'Object[]' : typeof o === 'number' ? (Number.isInteger(o) ? 'Int32' : 'Double') : o.__type || 'PSCustomObject', FullName: 'System.' + (typeof o === 'string' ? 'String' : 'Object') });
  throw new PSErr(`Method invocation failed because [${o.__type || (typeof o === 'string' ? 'System.String' : 'System.Object')}] does not contain a method named '${m}'.`);
}
function psStatic(ctx, ty, m, a) {
  const t = ty.toLowerCase().replace(/^system\./, ''), ml = m.toLowerCase();
  if (t === 'math') { const f = { round: (x, n = 0) => +(+x).toFixed(n), floor: Math.floor, ceiling: Math.ceil, max: Math.max, min: Math.min, abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow, truncate: Math.trunc }[ml]; if (f) return f(...a); if (ml === 'pi') return Math.PI; }
  if (t === 'datetime' && ml === 'now') return psNow(ctx.H);
  if (t === 'datetime' && ml === 'today') { const n = psNow(ctx.H); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  if (t === 'datetime' && ml === 'parse') return new Date(a[0]);
  if (t === 'environment' && ml === 'newline') return '\n';
  if (t === 'environment' && ml === 'machinename') return ctx.H.d.hostname;
  if ((t === 'io.path') && ml === 'getfilename') return psStr(a[0]).split(/[\\/]/).pop();
  if ((t === 'io.path') && ml === 'getextension') return (psStr(a[0]).match(/\.[^.\\]+$/) || [''])[0];
  if ((t === 'io.path') && ml === 'combine') return a.map(psStr).join('\\').replace(/\\\\+/g, '\\');
  if ((t === 'io.file') && ml === 'exists') return psFileGet(ctx.H, psStr(a[0])) != null;
  if (t === 'string' && ml === 'isnullorempty') return a[0] == null || a[0] === '';
  if (t === 'string' && ml === 'join') return psFlat(a[1]).map(psStr).join(psStr(a[0]));
  if (t === 'string' && ml === 'empty') return '';
  if (t === 'int' && ml === 'maxvalue') return 2147483647;
  if (t === 'net.dns' && ml === 'gethostaddresses') { const r = resolve(ctx.H.L, ctx.H.d, psStr(a[0])); if (!r.ip) throw new PSErr(`Exception calling "GetHostAddresses" with "1" argument(s): "No such host is known"`); return [r.ip]; }
  if (t === 'guid' && ml === 'newguid') return 'b1c4f3a2-7d1e-4f6a-9c2b-' + (Date.now() % 1e12).toString(16).padStart(12, '0');
  throw new PSErr(`Unable to find type [${ty}] or method ${m}.`);
}
const psNow = (H) => new Date(Date.UTC(2026, 9, 21, 3, 30, 0) + H.L.clock + (H.d.clockSkew || 0) * 60000);

// ---------------------------------------------------------------- invoking commands: functions, cmdlets (with parameter binding), aliases, external programs, scripts
const PS_ALIAS = { ls: 'Get-ChildItem', dir: 'Get-ChildItem', gci: 'Get-ChildItem', cat: 'Get-Content', gc: 'Get-Content', type: 'Get-Content', echo: 'Write-Output', write: 'Write-Output', cd: 'Set-Location', sl: 'Set-Location', pwd: 'Get-Location', gl: 'Get-Location', cls: 'Clear-Host', clear: 'Clear-Host', '?': 'Where-Object', where: 'Where-Object', '%': 'ForEach-Object', foreach: 'ForEach-Object', select: 'Select-Object', sort: 'Sort-Object', ft: 'Format-Table', fl: 'Format-List', gm: 'Get-Member', measure: 'Measure-Object', group: 'Group-Object', gsv: 'Get-Service', gps: 'Get-Process', ps: 'Get-Process', copy: 'Copy-Item', cp: 'Copy-Item', del: 'Remove-Item', rm: 'Remove-Item', erase: 'Remove-Item', move: 'Move-Item', mv: 'Move-Item', md: 'mkdir', ni: 'New-Item', iex: 'Invoke-Expression', icm: 'Invoke-Command', sleep: 'Start-Sleep', tnc: 'Test-NetConnection', man: 'Get-Help', help: 'Get-Help', h: 'Get-History', history: 'Get-History', gcm: 'Get-Command', kill: 'Stop-Process', sajb: 'Start-Job', ipmo: 'Import-Module', sc: 'Set-Content', ac: 'Add-Content', epcsv: 'Export-Csv', ipcsv: 'Import-Csv', curl: 'Invoke-WebRequest', wget: 'Invoke-WebRequest', iwr: 'Invoke-WebRequest', irm: 'Invoke-RestMethod', ogv: 'Out-GridView', tee: 'Tee-Object', gwmi: 'Get-WmiObject' };
const PS_CMD = {};
/** Register a cmdlet: { p: ['Name',...positional order], s: [switches], fn(H, a, input, ctx) } */
function psDef(name, def) { PS_CMD[name.toLowerCase()] = { name, ...def }; }
function psBind(cmd, args, name) {
  const all = (cmd.p || []).concat(cmd.o || []).concat(cmd.s || []), a = {};
  const find = (k) => { const ks = all.filter((x) => x.toLowerCase() === k); if (ks.length) return ks[0]; const al = cmd.al?.[k]; if (al) return al; const pre = all.filter((x) => x.toLowerCase().startsWith(k)); if (pre.length === 1) return pre[0]; if (pre.length > 1) throw new PSErr(`${name} : Parameter cannot be processed because the parameter name '${k}' is ambiguous. Possible matches include: ${pre.map((x) => '-' + x).join(' ')}.`, { cmd: name }); if (['erroraction', 'verbose', 'whatif', 'confirm', 'warningaction', 'debug', 'outvariable', 'errorvariable', 'ea', 'wa'].includes(k)) return '_' + k; throw new PSErr(`${name} : A parameter cannot be found that matches parameter name '${k}'.`, { cmd: name, cat: `InvalidArgument: (:) [${name}], ParameterBindingException` }); };
  Object.entries(args.named).forEach(([k, v]) => { const n = find(k); if (v && v.__pend !== undefined) { if ((cmd.s || []).includes(n)) { a[n] = true; args.pos.unshift(v.__pend); } else a[n] = v.__pend; } else a[n] = v === psSwitch ? true : v; });
  const free = (cmd.p || []).filter((x) => !(x in a)); args.pos.forEach((v, i) => { if (free[i]) a[free[i]] = v; else (a._extra ??= []).push(v); });
  return a;
}
function psInvoke(ctx, name, args, input, sc, el) {
  const H = ctx.H; const ln = name.toLowerCase();
  const fn = H.funcs?.[ln];
  if (fn) { const inner = psScope(H.vars); inner.args = args.pos; const named = args.named; fn.params.forEach((p, i) => { const k = p.name.toLowerCase(); let v = named[k] ?? Object.entries(named).find(([x]) => k.startsWith(x))?.[1]; if (v && v.__pend !== undefined) v = v.__pend; if (v === psSwitch) v = true; inner[k] = v !== undefined ? v : args.pos[i] !== undefined ? args.pos[i] : p.def ? psEval(ctx, p.def, inner) : null; }); if (input && input.length) inner.input = input; const body = fn.body.filter((s) => s.k !== 'param'); const ps = fn.body.find((s) => s.k === 'param'); if (ps) ps.params.forEach((p, i) => { const k = p.name.toLowerCase(); let v = named[k]; if (v && v.__pend !== undefined) v = v.__pend; if (v === psSwitch) v = true; inner[k] = v !== undefined ? v : args.pos[i] !== undefined ? args.pos[i] : p.def ? psEval(ctx, p.def, inner) : null; }); try { return psStmts(ctx, body, inner); } catch (e) { if (e instanceof PSFlow && e.kind === 'return') return psFlat(e.val); throw e; } }
  const real = PS_CMD[ln] ? ln : PS_ALIAS[ln] ? PS_ALIAS[ln].toLowerCase() : null;
  if (real && PS_CMD[real]) {
    const cmd = PS_CMD[real];
    if (cmd.need && !cmd.need(H)) { const e = new PSErr(`The term '${cmd.name}' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.`, { notfound: true, target: cmd.name, cmd: cmd.name }); ctx.err.push(psErrRec(e, cmd.name)); ctx.lastFailed = true; return []; }
    try {
      const a = psBind(cmd, args, cmd.name);
      if (cmd.pipe) { const items = input ?? []; const r = cmd.fn(H, a, items, ctx, sc); return psFlat(r); }
      if (input && input.length && cmd.vp) { const out = []; input.forEach((x) => { const b = { ...a }; if (b[cmd.vp] == null) b[cmd.vp] = psGet(x, cmd.vp) ?? (cmd.vpAny ? x : psGet(x, 'Name') ?? x); out.push(...psFlat(cmd.fn(H, b, [x], ctx, sc))); }); return out; }
      return psFlat(cmd.fn(H, a, input ?? [], ctx, sc));
    } catch (e) { if (e instanceof PSFlow) throw e; const ea = (args.named.erroraction || args.named.ea); if (ea && /silently|ignore/i.test(psStr(ea.__pend ?? ea))) return []; if (ea && /stop/i.test(psStr(ea.__pend ?? ea))) throw e; if (ctx.inTry) throw e; ctx.err.push(psErrRec(e, cmd.name)); ctx.lastFailed = true; if (e.terminating) throw e; return []; }
  }
  if (/\.ps1$/i.test(name) || /^\.[\\/]/.test(name)) return psScript(ctx, name, args, sc);
  const ex = typeof winExe === 'function' ? winExe(H, name, args, ctx) : null;
  if (ex != null) { H.lastExit = ex.code ?? 0; ctx.lastFailed = !!ex.code; return ex.lines ?? psLines(ex.text ?? ''); }
  const e = new PSErr(`${name} : The term '${name}' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.`, { notfound: true, target: name, cmd: name });
  ctx.err.push(psErrRec(e, name)); ctx.lastFailed = true; return [];
}
const psLines = (t) => { const s = String(t).replace(/\n$/, ''); return s === '' ? [] : s.split('\n').map((x) => Object.assign(new String(x), {})).map(String); };
function psScript(ctx, name, args, sc) {
  const H = ctx.H; const path = psPath(H, name); const f = psFileGet(H, path);
  if (f == null) { const e = new PSErr(`${name} : The term '${name}' is not recognized as the name of a cmdlet, function, script file, or operable program.`, { notfound: true, target: name }); ctx.err.push(psErrRec(e, name)); return []; }
  if ((H.d.execPolicy ?? (H.d.kind === 'srv' ? 'RemoteSigned' : 'Restricted')) === 'Restricted') { const e = new PSErr(`File ${path} cannot be loaded because running scripts is disabled on this system. For more information, see about_Execution_Policies at https:/go.microsoft.com/fwlink/?LinkID=135170.`, { cat: 'SecurityError: (:) [], PSSecurityException' }); ctx.err.push(psErrRec(e, name)); return []; }
  const inner = psScope(H.vars); inner.args = args.pos; inner.myinvocation = psNew('InvocationInfo', { MyCommand: path });
  Object.entries(args.named).forEach(([k, v]) => (inner[k] = v && v.__pend !== undefined ? v.__pend : v === psSwitch ? true : v));
  let ast; try { ast = psParse(f); } catch (e) { ctx.err.push(psErrRec(new PSErr(`At ${path}:${(f.slice(0, e.pos || 0).match(/\n/g) || []).length + 1} char:1\n+ ${e.message}`, { parse: true }), '')); return []; }
  const pp = ast.find((s) => s.k === 'param'); if (pp) pp.params.forEach((p, i) => { const k = p.name.toLowerCase(); if (!(k in inner) || inner[k] == null) inner[k] = args.pos[i] !== undefined ? args.pos[i] : p.def ? psEval(ctx, p.def, inner) : null; });
  try { return psStmts(ctx, ast.filter((s) => s.k !== 'param'), inner); } catch (e) { if (e instanceof PSFlow) return psFlat(e.val); ctx.err.push(psErrRec(e, path)); return []; }
}

// ---------------------------------------------------------------- the file system of a Windows machine (simple: path → text, folders implied)
function psPath(H, p) {
  p = psStr(p).replace(/\//g, '\\').replace(/^~/, `C:\\Users\\${H.user || 'Administrator'}`);
  if (/^\\\\/.test(p)) return p;
  if (typeof driveUnc === 'function' && /^[A-Za-z]:/.test(p)) { const u = driveUnc(H, p); if (u) return u; }
  if (/^[A-Za-z]:\\?/.test(p)) return p.replace(/^([a-z])/, (m) => m.toUpperCase()).replace(/\\$/, '') || p;
  if (/^[A-Za-z]:$/.test(p)) return p.toUpperCase() + '\\';
  const parts = H.cwd.split('\\').filter(Boolean); p.split('\\').forEach((x) => { if (x === '..') parts.length > 1 && parts.pop(); else if (x && x !== '.') parts.push(x); });
  return parts.join('\\');
}
function psFileGet(H, path) { if (/^\\\\/.test(path)) return typeof smbFileGet === 'function' ? smbFileGet(H, path) : null; const fs = H.d.fs ??= {}; const k = Object.keys(fs).find((x) => x.toLowerCase() === path.toLowerCase()); return k != null ? fs[k] : null; }
function psWriteFile(H, path, text, app) { path = psPath(H, path); if (/^\\\\/.test(path)) { if (typeof smbFileWrite === 'function') return smbFileWrite(H, path, text, app); throw new PSErr('Access is denied.'); } const fs = H.d.fs ??= {}; const k = Object.keys(fs).find((x) => x.toLowerCase() === path.toLowerCase()) ?? path; fs[k] = app && fs[k] != null ? fs[k] + '\n' + text : text; (H.d.dirs ??= []).includes(path.split('\\').slice(0, -1).join('\\')) || H.d.dirs.push(path.split('\\').slice(0, -1).join('\\')); }
const psDirExists = (H, p) => { const l = p.toLowerCase().replace(/\\$/, ''); if (/^[a-z]:$/i.test(l)) return true; return (H.d.dirs || []).some((x) => x.toLowerCase() === l || x.toLowerCase().startsWith(l + '\\')) || Object.keys(H.d.fs || {}).some((x) => x.toLowerCase().startsWith(l + '\\')); };

// ---------------------------------------------------------------- output formatting (what the console shows at the end of a pipeline)
function psFormat(items, H) {
  if (!items.length) return '';
  const out = []; let i = 0;
  while (i < items.length) {
    const x = items[i];
    if (x && x.__fmt) { out.push(x.__fmt); i++; continue; }
    if (!psIsObj(x) || x.__str && !x.__view) { out.push(psStr(x)); i++; continue; }
    let j = i; const ty = x.__type; while (j < items.length && psIsObj(items[j]) && items[j].__type === ty && !items[j].__fmt) j++;
    const group = items.slice(i, j);
    if (x.__ht) { group.forEach((h) => { const ks = psProps(h); const w = Math.max(4, ...ks.map((k) => k.length)); out.push('', `${'Name'.padEnd(w)} Value`, `${'----'.padEnd(w)} -----`, ...ks.map((k) => `${k.padEnd(w)} ${psStr(h[k])}`), ''); }); i = j; continue; }
    const view = x.__view || psProps(x);
    if (x.__list || (view.length > 5 && !x.__view)) out.push(psFmtList(group, x.__view || psProps(x))); else out.push(psFmtTable(group, view));
    i = j;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
function psFmtTable(rows, cols) {
  const val = (r, c) => { const v = typeof c === 'object' ? c.v(r) : psGet(r, c); if (Array.isArray(v)) return `{${v.map(psStr).join(', ')}}`; return psStr(v); };
  const names = cols.map((c) => (typeof c === 'object' ? c.h : c));
  const W = names.map((n, i) => Math.min(40, Math.max(n.length, ...rows.map((r) => val(r, cols[i]).length))));
  const num = cols.map((c, i) => rows.every((r) => { const v = typeof c === 'object' ? c.v(r) : psGet(r, c); return typeof v === 'number'; }));
  const cell = (s, i) => { s = s.length > W[i] ? s.slice(0, W[i] - 3) + '...' : s; return num[i] ? s.padStart(W[i]) : s.padEnd(W[i]); };
  return '\n' + [names.map((n, i) => cell(n, i)).join(' ').trimEnd(), names.map((n, i) => cell('-'.repeat(n.length), i)).join(' ').trimEnd(), ...rows.map((r) => cols.map((c, i) => cell(val(r, c), i)).join(' ').trimEnd())].join('\n') + '\n';
}
function psFmtList(rows, cols) { const names = cols.map((c) => (typeof c === 'object' ? c.h : c)); const w = Math.max(...names.map((n) => n.length)); return '\n' + rows.map((r) => cols.map((c, i) => { const v = typeof c === 'object' ? c.v(r) : psGet(r, c); return `${names[i].padEnd(w)} : ${Array.isArray(v) ? `{${v.map(psStr).join(', ')}}` : psStr(v)}`; }).join('\n')).join('\n\n') + '\n'; }
function psErrText(e) { return `${e.cmd && !e.cat.includes('CommandNotFound') ? e.cmd + ' : ' : e.cat.includes('CommandNotFound') ? e.cmd + ' : ' : ''}${e.msg}\n${e.cmd ? `At line:1 char:1\n+ ${e.cmd}\n+ ${'~'.repeat(Math.min(40, e.cmd.length))}\n` : ''}    + CategoryInfo          : ${e.cat}\n    + FullyQualifiedErrorId : ${e.id || (e.cat.includes('CommandNotFound') ? 'CommandNotFoundException' : e.cat.includes('Parser') ? 'ParserError' : 'Microsoft.PowerShell.Commands.' + (e.cmd || 'Command').replace(/-/g, ''))}\n`; }

// ---------------------------------------------------------------- the language cmdlets (pipeline, objects, files)
const psSbOrProp = (ctx, f, x, sc) => (f && f.__sb ? psOne(psCallSb(ctx, f, sc, x)) : psGet(x, f));
psDef('Where-Object', { p: ['FilterScript'], o: ['Property', 'Value', 'EQ', 'NE', 'GT', 'LT', 'Like', 'Match', 'Contains'], pipe: true, fn: (H, a, inp, ctx, sc) => { if (a.FilterScript && a.FilterScript.__sb) return inp.filter((x) => psBool(psOne(psCallSb(ctx, a.FilterScript, sc, x)))); const prop = a.Property ?? a.FilterScript; const op = ['EQ', 'NE', 'GT', 'LT', 'Like', 'Match', 'Contains'].find((k) => a[k] !== undefined); const v = op ? a[op] : a.Value; return inp.filter((x) => { const y = psGet(x, prop); return !op ? psBool(y) : psBool(psBin(ctx, '-' + op.toLowerCase(), y, v)); }); } });
psDef('ForEach-Object', { p: ['Process'], o: ['Begin', 'End', 'MemberName'], pipe: true, fn: (H, a, inp, ctx, sc) => { const out = []; if (a.Begin) out.push(...psCallSb(ctx, a.Begin, sc)); inp.forEach((x) => { if (a.Process?.__sb) out.push(...psCallSb(ctx, a.Process, sc, x)); else out.push(psGet(x, a.Process ?? a.MemberName)); }); if (a.End) out.push(...psCallSb(ctx, a.End, sc)); return out; } });
psDef('Select-Object', { p: ['Property'], o: ['First', 'Last', 'ExpandProperty', 'Skip', 'Index'], s: ['Unique'], pipe: true, fn: (H, a, inp, ctx, sc) => { let r = inp; if (a.Skip) r = r.slice(a.Skip); if (a.First != null) r = r.slice(0, a.First); if (a.Last != null) r = r.slice(-a.Last); if (a.Unique) r = r.filter((x, i) => r.findIndex((y) => psStr(y) === psStr(x)) === i); if (a.ExpandProperty) return r.flatMap((x) => psFlat(psGet(x, a.ExpandProperty))); if (a.Property) { const ps = psFlat(a.Property); if (ps.length === 1 && ps[0] === '*') return r; return r.map((x) => { const o = psNew('Selected.' + (x?.__type || 'Object'), {}); ps.forEach((p) => { if (p && p.__ht) { const n = psGet(p, 'Name') ?? psGet(p, 'Label') ?? psGet(p, 'n') ?? psGet(p, 'l'); const e = psGet(p, 'Expression') ?? psGet(p, 'e'); o[n] = e && e.__sb ? psOne(psCallSb(ctx, e, sc, x)) : psGet(x, e); } else { const ks = psIsObj(x) ? Object.keys(x).filter((k) => psLike(k, p)) : []; if (ks.length && String(p).includes('*')) ks.forEach((k) => (o[k] = x[k])); else o[ks[0] ?? p] = psGet(x, p); } }); return o; }); } return r; } });
psDef('Sort-Object', { p: ['Property'], s: ['Descending', 'Unique'], pipe: true, fn: (H, a, inp, ctx, sc) => { const ps = a.Property ? psFlat(a.Property) : [null]; const key = (x, p) => (p == null ? x : p.__sb ? psOne(psCallSb(ctx, p, sc, x)) : p.__ht ? psSbOrProp(ctx, psGet(p, 'Expression') ?? psGet(p, 'e'), x, sc) : psGet(x, p)); let r = inp.slice().sort((x, y) => { for (const p of ps) { const c = psCmp(key(x, p), key(y, p)); if (c) return (p && p.__ht && psBool(psGet(p, 'Descending'))) || a.Descending ? -c : c; } return 0; }); if (a.Unique) r = r.filter((x, i) => !i || psStr(r[i - 1]) !== psStr(x)); return r; } });
psDef('Group-Object', { p: ['Property'], s: ['NoElement'], pipe: true, fn: (H, a, inp, ctx, sc) => { const g = {}; inp.forEach((x) => { const k = psStr(psSbOrProp(ctx, a.Property, x, sc)); (g[k] ??= []).push(x); }); return Object.entries(g).map(([k, v]) => psNew('GroupInfo', { Count: v.length, Name: k, Group: v }, ['Count', 'Name', { h: 'Group', v: (r) => `{${r.Group.map(psStr).slice(0, 4).join(', ')}${r.Group.length > 4 ? '...' : ''}}` }])); } });
psDef('Measure-Object', { p: ['Property'], s: ['Sum', 'Average', 'Maximum', 'Minimum', 'Line', 'Word', 'Character'], pipe: true, fn: (H, a, inp) => { const v = a.Property ? inp.map((x) => +psGet(x, a.Property)) : inp.map((x) => +x); const o = psNew('GenericMeasureInfo', { Count: inp.length }); if (a.Average) o.Average = v.reduce((s, x) => s + x, 0) / (v.length || 1); if (a.Sum) o.Sum = v.reduce((s, x) => s + x, 0); if (a.Maximum) o.Maximum = Math.max(...v); if (a.Minimum) o.Minimum = Math.min(...v); if (a.Property) o.Property = a.Property; if (a.Line) return psNew('TextMeasureInfo', { Lines: inp.length }); return o; } });
psDef('Format-Table', { p: ['Property'], s: ['AutoSize', 'Wrap', 'HideTableHeaders'], o: ['GroupBy'], pipe: true, fn: (H, a, inp, ctx, sc) => { if (!inp.length) return []; const cols = a.Property ? psFlat(a.Property).map((p) => (p && p.__ht ? { h: psStr(psGet(p, 'Name') ?? psGet(p, 'Label') ?? psGet(p, 'n') ?? psGet(p, 'l')), v: (r) => psSbOrProp(ctx, psGet(p, 'Expression') ?? psGet(p, 'e'), r, sc) } : p)) : inp[0].__view || psProps(inp[0]); return [{ __fmt: psFmtTable(inp, cols).replace(/\n$/, '') }]; } });
psDef('Format-List', { p: ['Property'], pipe: true, fn: (H, a, inp) => { if (!inp.length) return []; const cols = a.Property ? psFlat(a.Property).flatMap((p) => (p === '*' ? psProps(inp[0]) : [p])) : inp[0].__view || psProps(inp[0]); return [{ __fmt: psFmtList(inp, psIsObj(inp[0]) ? cols : ['Value']).replace(/\n$/, '') }]; } });
psDef('Out-String', { pipe: true, fn: (H, a, inp) => [psFormat(inp, H)] });
psDef('Out-Null', { pipe: true, fn: () => [] });
psDef('Out-Host', { pipe: true, fn: (H, a, inp) => inp });
psDef('Out-GridView', { o: ['Title'], s: ['PassThru'], pipe: true, fn: (H, a, inp) => inp });
psDef('Out-File', { p: ['FilePath'], s: ['Append', 'NoClobber'], o: ['Encoding', 'Width'], pipe: true, fn: (H, a, inp) => { psWriteFile(H, a.FilePath, psFormat(inp, H).replace(/^\n|\n$/g, ''), a.Append); return []; } });
psDef('Tee-Object', { p: ['FilePath'], o: ['Variable'], pipe: true, fn: (H, a, inp) => { if (a.FilePath) psWriteFile(H, a.FilePath, psFormat(inp, H).trim()); return inp; } });
psDef('Get-Member', { pipe: true, fn: (H, a, inp) => { const x = inp[0]; if (x == null) return []; const ty = typeof x === 'string' ? 'System.String' : x.__type || 'System.Management.Automation.PSCustomObject'; return [{ __fmt: `\n   TypeName: ${ty}\n\nName        MemberType   Definition\n----        ----------   ----------\n${(typeof x === 'string' ? ['Length', 'ToUpper', 'ToLower', 'Trim', 'Split', 'Replace', 'Substring', 'Contains', 'StartsWith', 'EndsWith'] : psProps(x)).map((k) => `${k.padEnd(12)}${(typeof x === 'string' && k !== 'Length' ? 'Method' : 'Property').padEnd(13)}${typeof x === 'string' ? (k === 'Length' ? 'int Length {get;}' : `string ${k}()`) : `${typeof x[k] === 'number' ? 'int' : typeof x[k] === 'boolean' ? 'bool' : 'string'} ${k} {get;set;}`}`).join('\n')}` }]; } });
psDef('Write-Host', { p: ['Object'], o: ['ForegroundColor', 'BackgroundColor', 'Separator'], s: ['NoNewline'], fn: (H, a, inp, ctx) => { const t = [a.Object, ...(a._extra || [])].filter((x) => x !== undefined).map(psStr).join(a.Separator ?? ' '); return [{ __fmt: t, host: a.ForegroundColor }]; } });
psDef('Write-Output', { p: ['InputObject'], fn: (H, a) => [a.InputObject, ...(a._extra || [])].filter((x) => x !== undefined).flatMap(psFlat) });
psDef('Write-Warning', { p: ['Message'], fn: (H, a) => [{ __fmt: `WARNING: ${psStr(a.Message)}`, warn: true }] });
psDef('Write-Verbose', { p: ['Message'], fn: () => [] });
psDef('Write-Error', { p: ['Message'], fn: (H, a) => { throw new PSErr(psStr(a.Message), { cat: 'NotSpecified: (:) [Write-Error], WriteErrorException' }); } });
psDef('Write-Progress', { p: ['Activity'], o: ['Status', 'PercentComplete'], fn: () => [] });
psDef('Clear-Host', { fn: () => [{ __fmt: '', clear: true }] });
psDef('Start-Sleep', { p: ['Seconds'], o: ['Milliseconds'], fn: (H, a) => { tick(H.L, (+a.Seconds || 0) * 1000 + (+a.Milliseconds || 0)); return []; } });
psDef('Get-Date', { p: ['Date'], o: ['Format', 'UFormat'], fn: (H, a) => { const d = a.Date ? new Date(psStr(a.Date)) : psNow(H); if (a.Format) return psDate(d, a.Format); if (a.UFormat) return psStr(a.UFormat).replace(/%Y/g, d.getFullYear()).replace(/%m/g, String(d.getMonth() + 1).padStart(2, '0')).replace(/%d/g, String(d.getDate()).padStart(2, '0')); return d; } });
psDef('New-Object', { p: ['TypeName', 'ArgumentList'], o: ['Property'], fn: (H, a) => { const t = psStr(a.TypeName).toLowerCase(); if (t.includes('pscustomobject') || t === 'psobject') { const o = psNew('PSCustomObject', {}); if (a.Property) psProps(a.Property).forEach((k) => (o[k] = a.Property[k])); return o; } if (t.includes('pscredential')) { const [u, p] = psFlat(a.ArgumentList); return psNew('PSCredential', { UserName: u, Password: p }); } if (t.includes('arraylist') || t.includes('list')) return []; if (t.includes('mail.mailmessage')) return psNew('MailMessage', {}); throw new PSErr(`New-Object : Cannot find type [${a.TypeName}]: verify that the assembly containing this type is loaded.`); } });
psDef('Get-Variable', { p: ['Name'], fn: (H, a) => [psNew('PSVariable', { Name: a.Name, Value: H.vars[psStr(a.Name).toLowerCase()] })] });
psDef('Set-Variable', { p: ['Name', 'Value'], fn: (H, a) => { H.vars[psStr(a.Name).toLowerCase()] = a.Value; return []; } });
psDef('Invoke-Expression', { p: ['Command'], fn: (H, a, inp, ctx, sc) => { const r = psRun(H, psStr(a.Command), { scope: sc }); ctx.err.push(...r.err); return r.out; } });
psDef('Get-Command', { p: ['Name'], o: ['Module', 'Verb', 'Noun'], fn: (H, a) => Object.values(PS_CMD).filter((c) => (!c.need || c.need(H)) && (!a.Name || psLike(c.name, a.Name)) && (!a.Verb || psLike(c.name.split('-')[0], a.Verb)) && (!a.Noun || psLike(c.name.split('-').slice(1).join('-'), a.Noun))).map((c) => psNew('CmdletInfo', { CommandType: 'Cmdlet', Name: c.name, Version: '', Source: c.mod || 'Microsoft.PowerShell.Management' }, ['CommandType', 'Name', 'Source'])) });
psDef('Get-Help', { p: ['Name'], s: ['Examples', 'Full', 'Online'], fn: (H, a) => { const c = PS_CMD[psStr(a.Name).toLowerCase()] || PS_CMD[(PS_ALIAS[psStr(a.Name).toLowerCase()] || '').toLowerCase()]; if (!c) return `Get-Help : Get-Help could not find ${a.Name} in a help file in this session.`; return `\nNAME\n    ${c.name}\n\nSYNTAX\n    ${c.name} ${(c.p || []).map((x) => `[-${x}] <Object>`).join(' ')} ${(c.o || []).map((x) => `[-${x} <Object>]`).join(' ')} ${(c.s || []).map((x) => `[-${x}]`).join(' ')}\n\nDESCRIPTION\n    ${c.help || 'See the lesson notes for what this command does in the lab.'}\n${c.ex ? `\nEXAMPLE\n    ${c.ex}\n` : ''}`; } });
psDef('Get-History', { fn: (H) => (H.hist || []).map((c, i) => psNew('HistoryInfo', { Id: i + 1, CommandLine: c }, ['Id', 'CommandLine'])) });
psDef('Import-Module', { p: ['Name'], fn: (H, a) => { const n = psStr(a.Name).toLowerCase(); const ok = { activedirectory: H.d.features?.includes('RSAT-AD-PowerShell') || H.d.features?.includes('AD-Domain-Services'), dnsserver: H.d.features?.includes('DNS'), dhcpserver: H.d.features?.includes('DHCP'), grouppolicy: H.d.features?.includes('GPMC') || H.d.features?.includes('AD-Domain-Services'), smbshare: true, nettcpip: true, servermanager: true, scheduledtasks: true }[n]; if (ok === undefined || ok) return []; throw new PSErr(`Import-Module : The specified module '${a.Name}' was not loaded because no valid module file was found in any module directory.`); } });
psDef('Set-ExecutionPolicy', { p: ['ExecutionPolicy'], o: ['Scope'], s: ['Force'], fn: (H, a) => { H.d.execPolicy = psStr(a.ExecutionPolicy); return []; } });
psDef('Get-ExecutionPolicy', { fn: (H) => H.d.execPolicy ?? (H.d.kind === 'srv' ? 'RemoteSigned' : 'Restricted') });
psDef('ConvertTo-SecureString', { p: ['String'], s: ['AsPlainText', 'Force'], fn: (H, a) => ({ __ss: true, v: psStr(a.String) }) });
psDef('Get-Credential', { p: ['Credential'], o: ['Message', 'UserName'], fn: (H, a) => psNew('PSCredential', { UserName: psStr(a.Credential ?? a.UserName ?? 'DIMO\\Administrator'), Password: { __ss: true, v: H.d.adminPass || 'Passw0rd!' } }) });
psDef('Read-Host', { p: ['Prompt'], s: ['AsSecureString'], fn: (H, a) => (a.AsSecureString ? { __ss: true, v: 'Passw0rd!' } : '') });
psDef('Get-Location', { fn: (H) => psNew('PathInfo', { Path: H.cwd }, ['Path']) });
psDef('Set-Location', { p: ['Path'], fn: (H, a) => { const p = psPath(H, a.Path ?? '~'); if (!psDirExists(H, p)) throw new PSErr(`Set-Location : Cannot find path '${p}' because it does not exist.`); H.cwd = p; return []; } });
psDef('Test-Path', { p: ['Path'], o: ['PathType'], fn: (H, a) => { const p = psPath(H, a.Path); return psFileGet(H, p) != null || psDirExists(H, p); } });
psDef('Get-Content', { p: ['Path'], o: ['Tail', 'TotalCount', 'First', 'Head'], s: ['Raw', 'Wait'], fn: (H, a) => { const p = psPath(H, a.Path); const f = psFileGet(H, p); if (f == null) throw new PSErr(`Get-Content : Cannot find path '${p}' because it does not exist.`, { cat: `ObjectNotFound: (${p}:String) [Get-Content], ItemNotFoundException` }); if (a.Raw) return f; let l = f.split('\n'); if (a.Tail) l = l.slice(-a.Tail); if (a.TotalCount || a.First || a.Head) l = l.slice(0, a.TotalCount || a.First || a.Head); return l; } });
psDef('Set-Content', { p: ['Path', 'Value'], fn: (H, a, inp) => { psWriteFile(H, a.Path, (a.Value !== undefined ? psFlat(a.Value) : inp).map(psStr).join('\n')); return []; }, pipe: true });
psDef('Add-Content', { p: ['Path', 'Value'], fn: (H, a, inp) => { psWriteFile(H, a.Path, (a.Value !== undefined ? psFlat(a.Value) : inp).map(psStr).join('\n'), true); return []; }, pipe: true });
psDef('Clear-Content', { p: ['Path'], fn: (H, a) => { psWriteFile(H, a.Path, ''); return []; } });
psDef('New-Item', { p: ['Path'], o: ['ItemType', 'Name', 'Value'], s: ['Force'], fn: (H, a) => { let p = psPath(H, a.Path ?? '.'); if (a.Name) p = `${p}\\${a.Name}`; if (/dir/i.test(psStr(a.ItemType))) { (H.d.dirs ??= []).push(p); if (/^\\\\/.test(p) && typeof smbFileWrite === 'function') smbFileWrite(H, p + '\\.dir', '', false); return psNew('DirectoryInfo', { Mode: 'd-----', LastWriteTime: psNow(H), Length: '', Name: p.split('\\').pop() }, ['Mode', 'LastWriteTime', 'Length', 'Name']); } psWriteFile(H, p, psStr(a.Value ?? '')); return psNew('FileInfo', { Mode: '-a----', LastWriteTime: psNow(H), Length: psStr(a.Value ?? '').length, Name: p.split('\\').pop() }, ['Mode', 'LastWriteTime', 'Length', 'Name']); } });
psDef('Remove-Item', { p: ['Path'], s: ['Recurse', 'Force'], fn: (H, a) => { const p = psPath(H, a.Path); const fs = H.d.fs || {}; const ks = Object.keys(fs).filter((k) => psLike(k, p) || k.toLowerCase().startsWith(p.toLowerCase() + '\\')); if (!ks.length && !psDirExists(H, p)) throw new PSErr(`Remove-Item : Cannot find path '${p}' because it does not exist.`); ks.forEach((k) => delete fs[k]); H.d.dirs = (H.d.dirs || []).filter((x) => !x.toLowerCase().startsWith(p.toLowerCase())); return []; } });
psDef('Copy-Item', { p: ['Path', 'Destination'], s: ['Recurse', 'Force'], fn: (H, a) => { const s = psPath(H, a.Path), f = psFileGet(H, s); if (f == null) throw new PSErr(`Copy-Item : Cannot find path '${s}' because it does not exist.`); let d = psPath(H, a.Destination); if (psDirExists(H, d)) d = `${d}\\${s.split('\\').pop()}`; psWriteFile(H, d, f); return []; } });
psDef('Move-Item', { p: ['Path', 'Destination'], fn: (H, a) => { PS_CMD['copy-item'].fn(H, a); PS_CMD['remove-item'].fn(H, { Path: a.Path }); return []; } });
psDef('Rename-Item', { p: ['Path', 'NewName'], fn: (H, a) => { const s = psPath(H, a.Path), f = psFileGet(H, s); if (f == null) throw new PSErr(`Rename-Item : Cannot rename because item at '${s}' does not exist.`); delete H.d.fs[Object.keys(H.d.fs).find((k) => k.toLowerCase() === s.toLowerCase())]; psWriteFile(H, s.split('\\').slice(0, -1).concat([psStr(a.NewName)]).join('\\'), f); return []; } });
psDef('Get-ChildItem', { p: ['Path'], o: ['Filter', 'Include'], s: ['Recurse', 'File', 'Directory', 'Force'], fn: (H, a) => { const p = psPath(H, a.Path ?? '.'); if (/^\\\\/.test(p) && typeof smbList === 'function') return smbList(H, p); const fs = H.d.fs || {}; const lp = p.toLowerCase() + '\\'; const files = Object.keys(fs).filter((k) => k.toLowerCase().startsWith(lp) && (a.Recurse || !k.slice(lp.length).includes('\\'))); const dirs = [...new Set((H.d.dirs || []).concat(Object.keys(fs).map((k) => k.split('\\').slice(0, -1).join('\\'))).filter((x) => x.toLowerCase().startsWith(lp) && !x.slice(lp.length).includes('\\') && x.length > lp.length))]; if (!psDirExists(H, p) && !files.length) throw new PSErr(`Get-ChildItem : Cannot find path '${p}' because it does not exist.`); const flt = a.Filter ? (k) => psLike(k.split('\\').pop(), a.Filter) : () => true; const view = ['Mode', 'LastWriteTime', 'Length', 'Name']; const D = a.File ? [] : dirs.filter(flt).map((k) => psNew('DirectoryInfo', { Mode: 'd-----', LastWriteTime: psNow(H), Length: '', Name: k.split('\\').pop(), FullName: k }, view)); const F = a.Directory ? [] : files.filter(flt).map((k) => psNew('FileInfo', { Mode: '-a----', LastWriteTime: H.d.ftime?.[k] ? new Date(H.d.ftime[k]) : psNow(H), Length: (fs[k] || '').length, Name: k.split('\\').pop(), FullName: k, Extension: (k.match(/\.[^.]+$/) || [''])[0] }, view)); return [...D, ...F]; } });
psDef('Import-Csv', { p: ['Path'], o: ['Delimiter', 'Header'], fn: (H, a) => { const f = psFileGet(H, psPath(H, a.Path)); if (f == null) throw new PSErr(`Import-Csv : Could not find file '${psPath(H, a.Path)}'.`); const del = psStr(a.Delimiter ?? ','); const lines = f.split('\n').filter((l) => l.trim()); const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === del && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); }; const hd = a.Header ? psFlat(a.Header) : split(lines.shift()); return lines.map((l) => { const v = split(l), o = psNew('PSCustomObject', {}); hd.forEach((h, i) => (o[h] = v[i] ?? '')); return o; }); } });
psDef('Export-Csv', { p: ['Path'], s: ['NoTypeInformation', 'Append'], o: ['Delimiter', 'Encoding'], pipe: true, fn: (H, a, inp) => { if (!inp.length) return []; const cols = psProps(inp[0]); psWriteFile(H, a.Path, [cols.map((c) => `"${c}"`).join(','), ...inp.map((r) => cols.map((c) => `"${psStr(psGet(r, c))}"`).join(','))].join('\n'), a.Append); return []; } });
psDef('ConvertTo-Csv', { s: ['NoTypeInformation'], pipe: true, fn: (H, a, inp) => { if (!inp.length) return []; const cols = psProps(inp[0]); return [cols.map((c) => `"${c}"`).join(','), ...inp.map((r) => cols.map((c) => `"${psStr(psGet(r, c))}"`).join(','))]; } });
psDef('ConvertTo-Html', { o: ['Title', 'PreContent', 'PostContent', 'Property', 'Head', 'Body'], s: ['Fragment'], pipe: true, fn: (H, a, inp) => { const cols = inp.length ? psProps(inp[0]) : []; return [`<html><head><title>${psStr(a.Title || 'HTML TABLE')}</title></head><body>${psStr(a.PreContent || '')}<table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${inp.map((r) => `<tr>${cols.map((c) => `<td>${psStr(psGet(r, c))}</td>`).join('')}</tr>`).join('')}</table>${psStr(a.PostContent || '')}</body></html>`]; } });
psDef('ConvertTo-Json', { o: ['Depth'], pipe: true, fn: (H, a, inp) => JSON.stringify(inp.length === 1 ? inp[0] : inp, null, 4) });
psDef('ConvertFrom-Json', { p: ['InputObject'], pipe: true, fn: (H, a, inp) => psFlat(JSON.parse(psStr(a.InputObject ?? inp.join('\n')))) });
psDef('Join-Path', { p: ['Path', 'ChildPath'], fn: (H, a) => `${psStr(a.Path).replace(/\\$/, '')}\\${psStr(a.ChildPath).replace(/^\\/, '')}` });
psDef('Split-Path', { p: ['Path'], s: ['Leaf', 'Parent'], fn: (H, a) => (a.Leaf ? psStr(a.Path).split('\\').pop() : psStr(a.Path).split('\\').slice(0, -1).join('\\')) });
psDef('Compare-Object', { p: ['ReferenceObject', 'DifferenceObject'], fn: (H, a) => { const r = psFlat(a.ReferenceObject).map(psStr), d = psFlat(a.DifferenceObject).map(psStr); return [...r.filter((x) => !d.includes(x)).map((x) => psNew('PSCustomObject', { InputObject: x, SideIndicator: '<=' })), ...d.filter((x) => !r.includes(x)).map((x) => psNew('PSCustomObject', { InputObject: x, SideIndicator: '=>' }))]; } });
psDef('Select-String', { p: ['Pattern', 'Path'], s: ['SimpleMatch', 'CaseSensitive', 'NotMatch'], pipe: true, fn: (H, a, inp) => { const re = new RegExp(a.SimpleMatch ? psStr(a.Pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : psStr(a.Pattern), a.CaseSensitive ? '' : 'i'); const src = a.Path ? Object.keys(H.d.fs || {}).filter((k) => psLike(k, psPath(H, a.Path))).flatMap((k) => H.d.fs[k].split('\n').map((l, i) => ({ f: k, l, i }))) : inp.map((x, i) => ({ f: 'InputStream', l: psStr(x), i })); return src.filter((x) => re.test(x.l) !== !!a.NotMatch).map((x) => psNew('MatchInfo', { Line: x.l, LineNumber: x.i + 1, Path: x.f, Filename: x.f.split('\\').pop() }, null, a.Path ? `${x.f}:${x.i + 1}:${x.l}` : x.l)); } });
