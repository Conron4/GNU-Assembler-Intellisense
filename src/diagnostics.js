'use strict';
/**
 * Static checks that do not need the assembler.  Pure functions: they take a parsed
 * document and return plain objects { line, col, end, severity, message, code }.
 * severity: 'error' | 'warning' | 'info' | 'hint'
 */
const { resolveLocalRef } = require('./parser');
const { isRegister, getRegister, gprBits, gprSuffix } = require('./data/registers');
const { isKnownDirective } = require('./data/directives');
const { isKnownMnemonic, isBranch, SIZE_REQUIRED, SHIFTS, SUFFIX_BITS } = require('./data/instructions');

const MISMATCH_BASES = new Set('mov add adc sub sbb cmp and or xor test xchg inc dec neg not lea'.split(' '));
const NUMBER_RE = /^-?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)$/;
const SINGLE_IMM = new Set('int push pushq pushw ret retq lret enter'.split(' '));
const DECLARATIVE = new Set(['.globl', '.global', '.weak', '.extern', '.hidden', '.protected', '.internal', '.local', '.type', '.size', '.ifdef', '.ifndef', '.ifnotdef', '.symver', '.weakref']);

/** Classify an AT&T operand: 'imm' | 'reg' | 'mem'. */
function classifyOperand(text) {
  let t = text.trim();
  if (t.startsWith('*')) t = t.slice(1).trim();
  if (t.startsWith('$')) return 'imm';
  if (/^%[A-Za-z_]\w*(\(\d\))?$/.test(t)) return 'reg';
  return 'mem';
}

function heuristicDiagnostics(R, opts = {}) {
  const out = [];
  const push = (line, col, end, severity, message, code) => out.push({ line, col, end, severity, message, code });
  const unknownDirectives = opts.unknownDirectives !== false;

  for (const p of R.problems) push(p.line, p.col, p.end, p.severity, p.message, p.code);

  // duplicate labels
  const seen = new Map();
  for (const d of R.defs) {
    if (d.kind !== 'label' || d.numeric || d.inMacro || d.inRept) continue;
    const prev = seen.get(d.name);
    if (!prev) seen.set(d.name, d);
    else if (!prev.cond && !d.cond) push(d.line, d.col, d.end, 'error', `Symbol '${d.name}' is already defined (first defined on line ${prev.line + 1})`, 'gas.duplicate-label');
  }

  // numeric local label references
  for (const r of R.refs) {
    if (!r.numeric || r.inMacro) continue;
    if (!resolveLocalRef(R, r)) {
      const dir = r.name[r.name.length - 1].toLowerCase();
      const base = r.name.slice(0, -1);
      push(r.line, r.col, r.end, 'error', `No local label '${base}:' found ${dir === 'f' ? 'after' : 'before'} this point`, 'gas.undefined-local');
    }
  }

  for (const L of R.lines) {
    if (L.pp) continue;
    for (const s of L.stmts) {
      if (s.kind === 'directive') {
        if (unknownDirectives && !isKnownDirective(s.mnemonic) && !R.macros.has(s.mnemonic)) {
          push(s.line, s.mcol, s.mend, 'warning', `Unknown directive '${s.mnemonic}'`, 'gas.unknown-directive');
        }
        continue;
      }
      if (s.kind !== 'instruction' || s.intel || s.inMacro) continue;
      const mn = s.mnemonic.toLowerCase();
      if (!isKnownMnemonic(mn)) {
        if (opts.unknownInstructions) push(s.line, s.mcol, s.mend, 'warning', `Unknown instruction '${s.mnemonic}'`, 'gas.unknown-instruction');
        continue;
      }
      if (s.operands.some((o) => o.text.includes('\\'))) continue; // macro parameters

      // --- Intel-style register names without '%'
      for (const t of s.tokens) {
        if (t.kind === 'sym' && !t.dollar && isRegister(t.name) && !R.byName.has(t.name) && !R.macros.has(t.name)) {
          push(s.line, t.col, t.end, 'warning', `'${t.name}' looks like a register: AT&T syntax needs the '%' prefix (%${t.name.toLowerCase()})`, 'gas.bare-register');
        }
      }

      const ops = s.operands;
      const classes = ops.map((o) => classifyOperand(o.text));

      // --- bare numbers are memory references in AT&T syntax
      if (!isBranch(mn)) {
        ops.forEach((o, i) => {
          if (!NUMBER_RE.test(o.text.trim())) return;
          if ((i === 0 && ops.length >= 2) || (SINGLE_IMM.has(mn) && ops.length === 1)) {
            push(s.line, o.col, o.end, 'warning', `'${o.text.trim()}' without '$' is a memory address; did you mean $${o.text.trim()}?`, 'gas.bare-number');
          }
        });
      }

      // --- operand-size ambiguity
      if (SIZE_REQUIRED.has(mn) && ops.length) {
        const sizing = ops.filter((o, i) => classes[i] === 'reg' && !(SHIFTS.has(mn) && /^%cl$/i.test(o.text.trim())));
        const hasMem = classes.includes('mem');
        if (!sizing.length && hasMem) {
          push(s.line, s.mcol, s.mend, 'warning', `Ambiguous operand size for '${mn}': no register operand. Add a suffix (${mn}b, ${mn}w, ${mn}l or ${mn}q).`, 'gas.ambiguous-size');
        }
      }

      // --- suffix vs register size
      const last = mn[mn.length - 1];
      if (mn.length > 2 && SUFFIX_BITS[last] && MISMATCH_BASES.has(mn.slice(0, -1))) {
        for (let i = 0; i < ops.length; i++) {
          if (classes[i] !== 'reg') continue;
          const name = ops[i].text.trim().replace(/^\*?%/, '').toLowerCase();
          const bits = gprBits(name);
          if (!bits) continue;
          if (SHIFTS.has(mn.slice(0, -1)) && name === 'cl') continue;
          if (bits !== SUFFIX_BITS[last]) {
            push(s.line, s.mcol, s.mend, 'error', `Operand size mismatch: '${mn}' works on ${SUFFIX_BITS[last]}-bit values but %${name} is ${bits}-bit`, 'gas.size-mismatch:' + gprSuffix(name));
            break;
          }
        }
      }
    }
  }

  if (opts.undefinedSymbols) {
    const reported = new Set();
    for (const r of R.refs) {
      if (r.numeric || r.pp || r.inMacro || r.name === '.' || R.byName.has(r.name) || R.externs.has(r.name)) continue;
      if (isRegister(r.name) || (r.stmt && r.stmt.directive && DECLARATIVE.has(r.stmt.directive))) continue;
      if (opts.isKnownSymbol && opts.isKnownSymbol(r.name)) continue;
      const key = r.name + ':' + r.line;
      if (reported.has(key)) continue;
      reported.add(key);
      push(r.line, r.col, r.end, 'info', `'${r.name}' is not defined in the workspace (must come from another object file or library)`, 'gas.undefined-symbol');
    }
  }
  return out;
}

module.exports = { heuristicDiagnostics, classifyOperand };
