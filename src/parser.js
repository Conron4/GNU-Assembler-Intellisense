'use strict';
/**
 * Lightweight GNU as (x86, AT&T / Intel) source parser.
 * Pure JavaScript - no dependency on the `vscode` module - so it can be unit tested.
 *
 * parseDocument(text) returns a "parsed" object:
 *   lines[]      per-line info: { text, code, bare, commentCol, stmts[], pp }
 *   defs[]       symbol definitions (labels, constants, macros, defines, comm)
 *   refs[]       symbol references { name, line, col, end, numeric?, ... }
 *   macros, defines, globals, weaks, types, sizes, sections, blocks, problems, includes, numeric
 */
const { isRegister } = require('./data/registers');

const PP_RE = /^\s*#(include|include_next|define|undef|ifdef|ifndef|if|elif|else|endif|error|warning|pragma|line)\b/;

const PREFIXES = new Set([
  'lock', 'rep', 'repe', 'repz', 'repne', 'repnz', 'bnd', 'notrack', 'xacquire', 'xrelease',
  'data16', 'data32', 'addr32', 'addr16', 'rex', 'rex64', 'vex', 'vex2', 'vex3', 'evex'
]);

// directives whose operands never contain symbol references worth tracking
const NO_REF = new Set([
  '.section', '.pushsection', '.macro', '.include', '.incbin', '.file', '.ident', '.arch', '.irp', '.irpc',
  '.loc', '.intel_syntax', '.att_syntax', '.code16', '.code32', '.code64', '.code16gcc', '.cfi_sections',
  '.string', '.ascii', '.asciz', '.error', '.warning', '.print', '.title', '.sbttl', '.arch_extension'
]);

const INTEL_KEYWORDS = new Set([
  'byte', 'word', 'dword', 'qword', 'xmmword', 'ymmword', 'zmmword', 'tbyte', 'oword', 'fword', 'ptr',
  'offset', 'short', 'near', 'far', 'flat', 'rip'
]);

const LABEL_RE = /^(\s*)([A-Za-z_.][\w.$]*|\d+)\s*:(?!:)/;
const TOKEN_RE = /\\[\w@]*(?:\(\))?|%[A-Za-z_]\w*|@[A-Za-z_]\w*|\$?[A-Za-z_.][\w.$]*|\d[\w.]*|"[^"]*"/g;

// ---------------------------------------------------------------------------
// line scanning
// ---------------------------------------------------------------------------

/**
 * Remove comments and blank string contents.
 * code: comments replaced with spaces, strings intact
 * bare: additionally string/char contents replaced with spaces
 * Both have exactly the same length as the input.
 */
function scanLine(text, st) {
  const n = text.length;
  const code = new Array(n);
  const bare = new Array(n);
  let commentCol = -1;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (st.inBlock) {
      const e = text.indexOf('*/', i);
      const stop = e < 0 ? n : e + 2;
      for (let k = i; k < stop; k++) { code[k] = ' '; bare[k] = ' '; }
      if (e >= 0) st.inBlock = false;
      i = stop;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      st.inBlock = true;
      code[i] = bare[i] = ' ';
      code[i + 1] = bare[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (c === '#') {
      commentCol = i;
      for (let k = i; k < n; k++) { code[k] = ' '; bare[k] = ' '; }
      break;
    }
    if (c === '"') {
      code[i] = bare[i] = '"';
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < n) { code[j] = text[j]; bare[j] = ' '; j++; }
        code[j] = text[j];
        bare[j] = ' ';
        j++;
      }
      if (j < n) { code[j] = bare[j] = '"'; j++; }
      i = j;
      continue;
    }
    if (c === "'" && i + 1 < n) {
      let len = 2; // quote + char
      if (text[i + 1] === '\\' && i + 2 < n) len = 3;
      if (text[i + len] === "'") len++;
      for (let k = i; k < Math.min(n, i + len); k++) { code[k] = text[k]; bare[k] = ' '; }
      i += len;
      continue;
    }
    code[i] = bare[i] = c;
    i++;
  }
  return { code: code.join(''), bare: bare.join(''), commentCol };
}

/** Split on top-level ';' (statement separators) and return [start,end) spans with content. */
function splitStatements(bare) {
  const spans = [];
  let start = 0;
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] === ';') {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, bare.length]);
  return spans.filter(([s, e]) => bare.slice(s, e).trim().length > 0);
}

/** Tokenise operand text (comments/strings already blanked). */
function tokenizeOperands(bare, offset, intel) {
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(bare))) {
    let text = m[0];
    let col = offset + m.index;
    const end = offset + m.index + text.length;
    const c0 = text[0];
    const tok = { text, col, end, kind: 'sym', name: text, dollar: false };
    if (c0 === '\\') {
      if (text.length === 1) continue;
      tok.kind = 'param';
    } else if (c0 === '%') {
      tok.kind = 'reg';
      tok.name = text.slice(1).toLowerCase();
    } else if (c0 === '@') {
      tok.kind = 'reloc';
      tok.name = text.slice(1);
    } else if (c0 === '"') {
      tok.kind = 'str';
    } else if (c0 >= '0' && c0 <= '9') {
      tok.kind = /^\d+[fFbB]$/.test(text) ? 'local' : 'num';
    } else {
      if (c0 === '$') {
        tok.dollar = true;
        tok.text = text = text.slice(1);
        tok.col = col + 1;
        tok.name = text;
        if (!text) continue;
      }
      if (text === '.') tok.kind = 'dot';
      else if (intel) {
        const low = text.toLowerCase();
        if (INTEL_KEYWORDS.has(low) && low !== 'rip') tok.kind = 'kw';
        else if (isRegister(low)) { tok.kind = 'reg'; tok.name = low; tok.bare = true; }
      }
    }
    tokens.push(tok);
  }
  return tokens;
}

/** Split operand text on top-level commas. `code` has the real text, `bare` the blanked one. */
function splitOperands(bare, code, offset) {
  const out = [];
  let depth = 0;
  let start = 0;
  const push = (s, e) => {
    let a = s;
    let b = e;
    while (a < b && /\s/.test(bare[a])) a++;
    while (b > a && /\s/.test(bare[b - 1])) b--;
    if (b > a || out.length || e < bare.length) out.push({ text: code.slice(a, b), bare: bare.slice(a, b), col: offset + a, end: offset + b });
  };
  for (let i = 0; i < bare.length; i++) {
    const c = bare[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) {
      push(start, i);
      start = i + 1;
    }
  }
  push(start, bare.length);
  // drop a single empty trailing operand produced by empty input
  if (out.length === 1 && out[0].text === '') return [];
  return out;
}

function cmpPos(a, b) {
  return a.line - b.line || a.col - b.col;
}

// ---------------------------------------------------------------------------
// main parse
// ---------------------------------------------------------------------------

function isExecSection(name, flags) {
  if (flags) return flags.includes('x');
  return /^\.(text|init|fini|plt|plt\.\w+)(\.|$)/.test(name) || name === '.text';
}

function parseDocument(text) {
  const rawLines = text.split(/\r\n|\r|\n/);
  const R = {
    lines: [],
    defs: [],
    refs: [],
    macros: new Map(),
    defines: new Map(),
    globals: new Set(),
    weaks: new Set(),
    externs: new Set(),
    types: new Map(),
    sizes: new Map(),
    sections: [],
    blocks: [],
    problems: [],
    includes: [],
    numeric: new Map(),
    blockComments: [],
    hasIntel: false
  };

  const st = { inBlock: false, ppCont: false };
  let intel = false;
  let blockCommentStart = -1;

  // section tracking
  let cur = { name: '.text', exec: true };
  let curBlock = { name: '.text', line: 0, endLine: rawLines.length - 1, exec: true, implicit: true, used: false };
  R.sections.push(curBlock);
  const secStack = [];
  let prevSection = null;

  const blockStack = [];
  let macroDepth = 0;
  let reptDepth = 0;
  let condDepth = 0;
  let openMacro = null;

  const switchSection = (ln, name, exec, push) => {
    if (curBlock.implicit && !curBlock.used) R.sections.pop();
    else curBlock.endLine = Math.max(curBlock.line, ln - 1);
    if (push) secStack.push({ cur, prev: prevSection });
    prevSection = cur;
    cur = { name, exec };
    curBlock = { name, line: ln, endLine: rawLines.length - 1, exec, implicit: false, used: false };
    R.sections.push(curBlock);
  };

  const addDef = (def) => {
    def.section = cur.name;
    def.exec = cur.exec;
    def.inMacro = macroDepth > 0;
    def.inRept = reptDepth > 0;
    def.cond = condDepth > 0;
    R.defs.push(def);
    curBlock.used = true;
    if (def.kind === 'label' && def.numeric) {
      const list = R.numeric.get(def.name) || [];
      list.push(def);
      R.numeric.set(def.name, list);
    }
    return def;
  };

  const problem = (line, col, end, severity, message, code) => R.problems.push({ line, col, end, severity, message, code });

  const openBlk = (kind, name, line, col, end) => {
    blockStack.push({ kind, name, line, col, end });
    if (kind === 'if' || kind === 'ppif') condDepth++;
    if (kind === 'macro') macroDepth++;
    if (kind === 'rept') reptDepth++;
  };
  const closeBlk = (kind, line, col, end, closer) => {
    let idx = -1;
    for (let i = blockStack.length - 1; i >= 0; i--) {
      if (blockStack[i].kind === kind) { idx = i; break; }
    }
    if (idx < 0) {
      problem(line, col, end, 'error', `${closer} without a matching ${OPENERS[kind]}`, 'gas.unmatched-end');
      return null;
    }
    while (blockStack.length - 1 > idx) {
      const b = blockStack.pop();
      reportUnterminated(b);
      dec(b.kind);
    }
    const b = blockStack.pop();
    dec(b.kind);
    R.blocks.push({ kind, name: b.name, startLine: b.line, endLine: line });
    return b;
  };
  const dec = (kind) => {
    if (kind === 'if' || kind === 'ppif') condDepth--;
    if (kind === 'macro') macroDepth--;
    if (kind === 'rept') reptDepth--;
  };
  const OPENERS = { macro: '.macro', rept: '.rept/.irp/.irpc', if: '.if', push: '.pushsection', cfi: '.cfi_startproc', ppif: '#if' };
  const CLOSERS = { macro: '.endm', rept: '.endr', if: '.endif', push: '.popsection', cfi: '.cfi_endproc', ppif: '#endif' };
  const reportUnterminated = (b) => {
    const sev = b.kind === 'macro' || b.kind === 'if' || b.kind === 'rept' ? 'error' : 'warning';
    problem(b.line, b.col, b.end, sev, `${OPENERS[b.kind]}${b.name ? ' ' + b.name : ''} is never closed (missing ${CLOSERS[b.kind]})`, 'gas.unterminated');
  };

  for (let ln = 0; ln < rawLines.length; ln++) {
    const raw = rawLines[ln];
    const L = { text: raw, code: '', bare: '', commentCol: -1, stmts: [], pp: null };
    R.lines.push(L);

    // ---- preprocessor lines -------------------------------------------------
    if (!st.inBlock && (st.ppCont || PP_RE.test(raw))) {
      L.code = L.bare = ' '.repeat(raw.length);
      if (st.ppCont) {
        L.pp = { directive: 'cont' };
      } else {
        const m = PP_RE.exec(raw);
        const hash = raw.indexOf('#');
        const dir = m[1];
        const restStart = m.index + m[0].length;
        const rest = raw.slice(restStart);
        L.pp = { directive: dir, col: hash, tokens: [] };
        const restBare = scanLine(rest, { inBlock: false });
        L.pp.tokens = tokenizeOperands(restBare.bare, restStart, false).filter((t) => t.kind === 'sym');
        if (dir === 'define') {
          const dm = /^(\s+)([A-Za-z_]\w*)(\([^)]*\))?\s*(.*)$/.exec(rest);
          if (dm) {
            const col = restStart + dm[1].length;
            const def = addDef({ name: dm[2], kind: 'define', line: ln, col, end: col + dm[2].length, params: dm[3] || '', value: dm[4].trim() });
            R.defines.set(dm[2], def);
            L.pp.tokens = L.pp.tokens.filter((t) => t.col !== col);
          }
        } else if (dir === 'include' || dir === 'include_next') {
          const im = /^(\s*)(?:"([^"]+)"|<([^>]+)>)/.exec(rest);
          if (im) {
            const p = im[2] || im[3];
            const col = restStart + im[0].indexOf(p);
            R.includes.push({ path: p, angle: !!im[3], line: ln, col, end: col + p.length, kind: '#include' });
          }
        } else if (dir === 'if' || dir === 'ifdef' || dir === 'ifndef') {
          openBlk('ppif', '', ln, hash, hash + 1 + dir.length);
        } else if (dir === 'endif') {
          closeBlk('ppif', ln, hash, hash + 1 + dir.length, '#endif');
        } else if (dir === 'else' || dir === 'elif') {
          if (!blockStack.some((b) => b.kind === 'ppif')) problem(ln, hash, hash + 1 + dir.length, 'error', `#${dir} without a matching #if`, 'gas.unmatched-end');
        }
        for (const t of L.pp.tokens) R.refs.push({ name: t.name, line: ln, col: t.col, end: t.end, pp: true });
      }
      st.ppCont = /\\\s*$/.test(raw);
      continue;
    }

    // ---- comments & strings -------------------------------------------------
    const wasIn = st.inBlock;
    const sc = scanLine(raw, st);
    L.code = sc.code;
    L.bare = sc.bare;
    L.commentCol = sc.commentCol;
    if (!wasIn && st.inBlock) blockCommentStart = ln;
    else if (wasIn && !st.inBlock && blockCommentStart >= 0) {
      if (ln > blockCommentStart) R.blockComments.push({ startLine: blockCommentStart, endLine: ln });
      blockCommentStart = -1;
    }
    if (!sc.bare.trim()) continue;

    // ---- statements ---------------------------------------------------------
    for (const [s, e] of splitStatements(sc.bare)) {
      const stmt = {
        line: ln, start: s, end: e, labels: [], prefixes: [], kind: 'empty', mnemonic: '', mcol: -1, mend: -1,
        argsStart: e, args: '', argsRaw: '', tokens: [], operands: [], intel, inMacro: macroDepth > 0, inRept: reptDepth > 0, cond: condDepth > 0
      };
      L.stmts.push(stmt);
      let pos = s;

      // labels
      let m;
      while ((m = LABEL_RE.exec(sc.bare.slice(pos, e)))) {
        const name = m[2];
        const col = pos + m[1].length;
        const numeric = /^\d+$/.test(name);
        const def = addDef({ name, kind: 'label', line: ln, col, end: col + name.length, numeric, local: !numeric && /^\.L/.test(name) });
        stmt.labels.push({ name, col, end: col + name.length, def });
        pos += m[0].length;
      }
      const restBare = sc.bare.slice(pos, e);
      if (!restBare.trim()) { stmt.kind = 'labels'; continue; }

      // assignment:  name = expr
      const am = /^(\s*)([A-Za-z_.][\w.$]*)\s*=(?!=)\s*/.exec(restBare);
      if (am) {
        const col = pos + am[1].length;
        stmt.kind = 'assign';
        stmt.mnemonic = am[2];
        stmt.mcol = col;
        stmt.mend = col + am[2].length;
        stmt.argsStart = pos + am[0].length;
        stmt.args = sc.bare.slice(stmt.argsStart, e);
        stmt.argsRaw = sc.code.slice(stmt.argsStart, e);
        const def = addDef({ name: am[2], kind: 'const', line: ln, col, end: col + am[2].length, value: stmt.argsRaw.trim() });
        stmt.def = def;
        stmt.tokens = tokenizeOperands(stmt.args, stmt.argsStart, intel);
        stmt.operands = splitOperands(stmt.args, stmt.argsRaw, stmt.argsStart);
        collectRefs(R, stmt, ln, 0);
        continue;
      }

      // mnemonic (with prefixes)
      let p2 = pos;
      let mm;
      for (;;) {
        mm = /^(\s*)([A-Za-z_.][\w.]*)/.exec(sc.bare.slice(p2, e));
        if (!mm) break;
        const tokenEnd = p2 + mm[0].length;
        const low = mm[2].toLowerCase();
        if (PREFIXES.has(low) && sc.bare.slice(tokenEnd, e).trim()) {
          stmt.prefixes.push({ text: mm[2], col: p2 + mm[1].length, end: tokenEnd });
          p2 = tokenEnd;
          continue;
        }
        break;
      }
      if (!mm) {
        stmt.kind = 'unknown';
        stmt.argsStart = p2;
        stmt.args = sc.bare.slice(p2, e);
        stmt.argsRaw = sc.code.slice(p2, e);
        stmt.tokens = tokenizeOperands(stmt.args, p2, intel);
        collectRefs(R, stmt, ln, 0);
        continue;
      }
      const mcol = p2 + mm[1].length;
      stmt.mnemonic = mm[2];
      stmt.mcol = mcol;
      stmt.mend = p2 + mm[0].length;
      stmt.argsStart = stmt.mend;
      stmt.args = sc.bare.slice(stmt.argsStart, e);
      stmt.argsRaw = sc.code.slice(stmt.argsStart, e);
      stmt.tokens = tokenizeOperands(stmt.args, stmt.argsStart, intel);
      stmt.operands = splitOperands(stmt.args, stmt.argsRaw, stmt.argsStart);
      const dname = stmt.mnemonic.toLowerCase();

      if (stmt.mnemonic[0] !== '.') {
        stmt.kind = 'instruction';
        curBlock.used = true;
        collectRefs(R, stmt, ln, 0);
        continue;
      }

      // ---- directives -------------------------------------------------------
      stmt.kind = 'directive';
      stmt.directive = dname;
      const opText = stmt.argsRaw;
      const firstArgName = () => {
        const fm = /^(\s*)([A-Za-z_.][\w.$]*)/.exec(stmt.args);
        return fm ? { name: fm[2], col: stmt.argsStart + fm[1].length } : null;
      };
      let skipFirstToken = false;

      switch (dname) {
        case '.section':
        case '.pushsection': {
          const nm = /^\s*("[^"]+"|[^\s,]+)/.exec(opText);
          const fl = /,\s*"([^"]*)"/.exec(opText);
          const name = nm ? nm[1].replace(/^"|"$/g, '') : '.text';
          if (dname === '.pushsection') openBlk('push', name, ln, stmt.mcol, stmt.mend);
          if (macroDepth === 0) switchSection(ln, name, isExecSection(name, fl ? fl[1] : null), dname === '.pushsection');
          break;
        }
        case '.text':
        case '.data':
        case '.bss':
          if (macroDepth === 0) switchSection(ln, dname, dname === '.text', false);
          break;
        case '.popsection':
          closeBlk('push', ln, stmt.mcol, stmt.mend, '.popsection');
          if (macroDepth === 0 && secStack.length) {
            const top = secStack.pop();
            switchSection(ln, top.cur.name, top.cur.exec, false);
          }
          break;
        case '.previous':
          if (macroDepth === 0 && prevSection) switchSection(ln, prevSection.name, prevSection.exec, false);
          break;
        case '.globl':
        case '.global':
        case '.weak':
        case '.extern':
        case '.hidden':
        case '.protected':
        case '.internal':
        case '.local': {
          for (const t of stmt.tokens) {
            if (t.kind !== 'sym') continue;
            if (dname === '.weak') R.weaks.add(t.name);
            else if (dname === '.extern') R.externs.add(t.name);
            else if (dname === '.globl' || dname === '.global') R.globals.add(t.name);
          }
          break;
        }
        case '.type': {
          const tm = /^\s*([A-Za-z_.][\w.$]*)\s*,\s*[@%"]*\s*(\w+)/.exec(stmt.args);
          if (tm) {
            const k = tm[2].toLowerCase();
            R.types.set(tm[1], k === 'stt_func' ? 'function' : k === 'stt_object' ? 'object' : k);
          }
          break;
        }
        case '.size': {
          const fn = firstArgName();
          if (fn) R.sizes.set(fn.name, ln);
          break;
        }
        case '.set':
        case '.equ':
        case '.equiv':
        case '.eqv':
        case '.comm':
        case '.lcomm': {
          const fn = firstArgName();
          if (fn) {
            const comm = dname === '.comm' || dname === '.lcomm';
            addDef({
              name: fn.name, kind: comm ? 'data' : 'const', line: ln, col: fn.col, end: fn.col + fn.name.length,
              value: opText.replace(/^\s*[^,]+,\s*/, '').trim(), comm: true === comm, local: dname === '.lcomm'
            });
            if (dname === '.comm') R.globals.add(fn.name);
            skipFirstToken = true;
          }
          break;
        }
        case '.macro': {
          const nm = /^(\s*)([A-Za-z_.\\][\w.$\\]*)(.*)$/.exec(stmt.args);
          if (nm) {
            const col = stmt.argsStart + nm[1].length;
            const params = nm[3].split(/[\s,]+/).filter(Boolean);
            const mac = { name: nm[2], kind: 'macro', line: ln, col, end: col + nm[2].length, params, paramText: nm[3].trim(), endLine: ln };
            // macro definitions are file scoped; the def itself is not "in" a macro
            const d = addDef(mac);
            d.inMacro = macroDepth > 0;
            R.macros.set(nm[2], mac);
            openMacro = mac;
          }
          openBlk('macro', nm ? nm[2] : '', ln, stmt.mcol, stmt.mend);
          break;
        }
        case '.endm': {
          const b = closeBlk('macro', ln, stmt.mcol, stmt.mend, '.endm');
          if (b && openMacro) { openMacro.endLine = ln; openMacro = null; }
          break;
        }
        case '.rept':
        case '.irp':
        case '.irpc':
          openBlk('rept', '', ln, stmt.mcol, stmt.mend);
          break;
        case '.endr':
          closeBlk('rept', ln, stmt.mcol, stmt.mend, '.endr');
          break;
        case '.endif':
          closeBlk('if', ln, stmt.mcol, stmt.mend, '.endif');
          break;
        case '.else':
        case '.elseif':
          if (!blockStack.some((b) => b.kind === 'if')) problem(ln, stmt.mcol, stmt.mend, 'error', `${dname} without a matching .if`, 'gas.unmatched-end');
          break;
        case '.cfi_startproc':
          openBlk('cfi', '', ln, stmt.mcol, stmt.mend);
          break;
        case '.cfi_endproc':
          closeBlk('cfi', ln, stmt.mcol, stmt.mend, '.cfi_endproc');
          break;
        case '.intel_syntax':
          intel = true;
          R.hasIntel = true;
          break;
        case '.att_syntax':
          intel = false;
          break;
        case '.include': {
          const im = /^\s*"([^"]+)"/.exec(opText);
          if (im) {
            const col = stmt.argsStart + opText.indexOf(im[1]);
            R.includes.push({ path: im[1], angle: false, line: ln, col, end: col + im[1].length, kind: '.include' });
          }
          break;
        }
        case '.incbin': {
          const im = /^\s*"([^"]+)"/.exec(opText);
          if (im) {
            const col = stmt.argsStart + opText.indexOf(im[1]);
            R.includes.push({ path: im[1], angle: false, line: ln, col, end: col + im[1].length, kind: '.incbin' });
          }
          break;
        }
        default:
          if (/^\.if/.test(dname)) openBlk('if', '', ln, stmt.mcol, stmt.mend);
      }

      if (!NO_REF.has(dname) && !dname.startsWith('.cfi_')) collectRefs(R, stmt, ln, skipFirstToken ? 1 : 0);
    }
  }

  // ---- finalise -------------------------------------------------------------
  while (blockStack.length) reportUnterminated(blockStack.pop());
  if (st.inBlock && blockCommentStart >= 0) {
    R.problems.push({ line: blockCommentStart, col: 0, end: 2, severity: 'error', message: 'Unterminated /* comment', code: 'gas.unterminated' });
  }
  if (curBlock) curBlock.endLine = rawLines.length - 1;

  // macro-call classification
  for (const L of R.lines) {
    for (const s of L.stmts) {
      if (s.kind === 'instruction' && (R.macros.has(s.mnemonic) || R.defines.has(s.mnemonic))) s.kind = 'macro-call';
    }
  }

  // name indexes
  R.byName = new Map();
  for (const d of R.defs) {
    const l = R.byName.get(d.name);
    if (l) l.push(d);
    else R.byName.set(d.name, [d]);
  }
  R.refsByName = new Map();
  for (const r of R.refs) {
    const l = R.refsByName.get(r.name);
    if (l) l.push(r);
    else R.refsByName.set(r.name, [r]);
  }
  return R;
}

function collectRefs(R, stmt, ln, skip) {
  let skipped = 0;
  for (const t of stmt.tokens) {
    if (t.kind === 'sym') {
      if (skipped < skip) { skipped++; continue; }
      R.refs.push({ name: t.name, line: ln, col: t.col, end: t.end, stmt, mnemonic: stmt.mnemonic, inMacro: stmt.inMacro });
    } else if (t.kind === 'local') {
      R.refs.push({ name: t.text, line: ln, col: t.col, end: t.end, numeric: true, stmt, inMacro: stmt.inMacro });
    }
  }
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

/** Resolve a numeric local reference like `1f` / `1b` to its definition. */
function resolveLocalRef(R, ref) {
  const text = ref.name;
  const base = text.slice(0, -1);
  const dir = text[text.length - 1].toLowerCase();
  const list = R.numeric.get(base);
  if (!list) return null;
  if (dir === 'f') {
    for (const d of list) if (cmpPos(d, { line: ref.line, col: ref.col }) > 0) return d;
    return null;
  }
  let best = null;
  for (const d of list) {
    if (cmpPos(d, { line: ref.line, col: ref.col }) < 0) best = d;
    else break;
  }
  return best;
}

/** Describe what is under the cursor at (line, col). */
function tokenAt(R, ln, col) {
  const L = R.lines[ln];
  if (!L) return null;
  const mk = (type, extra) => Object.assign({ type, line: ln }, extra);
  if (L.pp) {
    if (L.pp.directive === 'define' || L.pp.directive === 'undef' || L.pp.directive === 'ifdef' || L.pp.directive === 'ifndef' || L.pp.directive === 'if' || L.pp.directive === 'elif') {
      for (const d of R.defs) {
        if (d.line === ln && d.kind === 'define' && col >= d.col && col <= d.end) return mk('symbol', { name: d.name, col: d.col, end: d.end, isDef: true });
      }
      for (const t of L.pp.tokens || []) if (col >= t.col && col <= t.end) return mk('symbol', { name: t.name, col: t.col, end: t.end });
    }
    return null;
  }
  if (L.commentCol >= 0 && col >= L.commentCol) return mk('comment');
  const within = (a, b, inclusiveEnd) => col >= a && (inclusiveEnd ? col <= b : col < b);
  for (const inclusiveEnd of [false, true]) {
    for (const s of L.stmts) {
      for (const lab of s.labels) {
        if (within(lab.col, lab.end, inclusiveEnd)) return mk('label', { name: lab.name, col: lab.col, end: lab.end, isDef: true, def: lab.def, stmt: s });
      }
      for (const p of s.prefixes) {
        if (within(p.col, p.end, inclusiveEnd)) return mk('prefix', { name: p.text, col: p.col, end: p.end, stmt: s });
      }
      if (s.mcol >= 0 && within(s.mcol, s.mend, inclusiveEnd)) {
        if (s.kind === 'assign') return mk('symbol', { name: s.mnemonic, col: s.mcol, end: s.mend, isDef: true, def: s.def, stmt: s });
        const type = s.kind === 'directive' ? 'directive' : s.kind === 'macro-call' ? 'macro-call' : 'mnemonic';
        return mk(type, { name: s.mnemonic, col: s.mcol, end: s.mend, stmt: s });
      }
      for (const t of s.tokens) {
        if (!within(t.col, t.end, inclusiveEnd)) continue;
        switch (t.kind) {
          case 'reg': return mk('register', { name: t.name, text: t.text, col: t.col, end: t.end, stmt: s });
          case 'sym': {
            // directive first operands that define symbols
            const isDef = s.kind === 'directive' && /^\.(set|equ|equiv|eqv|comm|lcomm)$/.test(s.directive) && s.tokens.find((x) => x.kind === 'sym') === t;
            return mk('symbol', { name: t.name, col: t.col, end: t.end, stmt: s, isDef, dollar: t.dollar });
          }
          case 'local': return mk('local-ref', { name: t.text, col: t.col, end: t.end, stmt: s });
          case 'num': return mk('number', { name: t.text, text: t.text, col: t.col, end: t.end, stmt: s, dollar: L.bare[t.col - 1] === '$' });
          case 'reloc': return mk('reloc', { name: t.name, text: t.text, col: t.col, end: t.end, stmt: s });
          case 'str': return mk('string', { col: t.col, end: t.end, stmt: s });
          default: return mk(t.kind, { name: t.name, col: t.col, end: t.end, stmt: s });
        }
      }
    }
  }
  return null;
}

module.exports = {
  parseDocument, scanLine, splitStatements, tokenizeOperands, splitOperands, resolveLocalRef, tokenAt, cmpPos,
  PREFIXES, LABEL_RE, PP_RE
};
