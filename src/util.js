'use strict';
const { syscallByNumber } = require('./data/syscalls');
const { isBranch } = require('./data/instructions');

/** Parse a gas integer literal into a BigInt, or null. */
function parseInteger(text) {
  let t = String(text).trim();
  let neg = false;
  if (t.startsWith('-')) { neg = true; t = t.slice(1); }
  else if (t.startsWith('+')) t = t.slice(1);
  let v = null;
  try {
    if (/^0[xX][0-9a-fA-F]+$/.test(t)) v = BigInt(t);
    else if (/^0[bB][01]+$/.test(t)) v = BigInt(t);
    else if (/^0[0-7]+$/.test(t)) v = BigInt('0o' + t.slice(1));
    else if (/^\d+$/.test(t)) v = BigInt(t);
  } catch (e) {
    return null;
  }
  if (v === null) return null;
  return neg ? -v : v;
}

/** Markdown describing a numeric literal in several bases. */
function numberMarkdown(text, negative) {
  let v = parseInteger(text);
  if (v === null) return null;
  if (negative) v = -v;
  const u64 = BigInt.asUintN(64, v);
  const rows = [
    ['Decimal', v.toString()],
    ['Hex', '0x' + u64.toString(16).toUpperCase().padStart(v < 0n || u64 > 0xffffffffn ? 16 : 1, '0')],
    ['Binary', '0b' + (v >= 0n ? v : u64).toString(2)],
    ['Octal', '0' + (v >= 0n ? v : u64).toString(8)]
  ];
  if (v >= 0n && v <= 0x10ffffn && v >= 32n && v < 127n) rows.push(['ASCII', `'${String.fromCharCode(Number(v))}'`]);
  const lines = rows.map(([k, val]) => `| ${k} | \`${val}\` |`);
  const signed = [8, 16, 32, 64]
    .filter((b) => u64 < 1n << BigInt(b) || v < 0n)
    .map((b) => `i${b}: ${BigInt.asIntN(b, v)}`)
    .slice(0, 4);
  return ['| | |', '|---|---|', ...lines].join('\n') + (signed.length ? `\n\nSigned: ${signed.join(' · ')}` : '');
}

/** Evaluate a trivially numeric constant (literal or symbol bound to a literal). */
function evalConst(R, text, depth = 0) {
  if (depth > 4) return null;
  const t = String(text).trim();
  const lit = parseInteger(t);
  if (lit !== null) return lit;
  if (/^[A-Za-z_.][\w.$]*$/.test(t)) {
    const defs = R.byName.get(t);
    const d = defs && defs.find((x) => x.kind === 'const' || x.kind === 'define');
    if (d && d.value) return evalConst(R, d.value.replace(/\s*(#|\/\*).*$/, ''), depth + 1);
  }
  return null;
}

/**
 * If statement `s` loads an integer into %rax/%eax/%ax/%al, return it (BigInt), else undefined.
 * Returns null when it writes the register with something we cannot evaluate.
 */
function raxLoad(R, s) {
  if (s.kind !== 'instruction') return undefined;
  const mn = s.mnemonic.toLowerCase();
  const ops = s.operands.map((o) => o.text.trim());
  const isRax = (x) => /^%(rax|eax|ax|al)$/i.test(x);
  if (/^mov[lqwb]?$/.test(mn) && ops.length === 2 && isRax(ops[1])) {
    if (ops[0].startsWith('$')) {
      const v = evalConst(R, ops[0].slice(1));
      return v === null ? null : v;
    }
    return null;
  }
  if (/^xor[lq]?$/.test(mn) && ops.length === 2 && isRax(ops[0]) && isRax(ops[1])) return 0n;
  if (ops.length && isRax(ops[ops.length - 1]) && !/^(cmp|test|push|jmp|call|bt)/.test(mn)) return null;
  return undefined;
}

/** Walk backwards from a `syscall` statement to find the syscall number loaded into %rax. */
function inferSyscall(R, line, col) {
  let seenStart = false;
  for (let ln = line; ln >= 0 && ln > line - 40; ln--) {
    const L = R.lines[ln];
    if (!L) break;
    for (let i = L.stmts.length - 1; i >= 0; i--) {
      const s = L.stmts[i];
      if (ln === line && s.start >= col) continue; // statements after the syscall on this line
      if (!seenStart && ln === line && s.start === col) continue;
      seenStart = true;
      const v = raxLoad(R, s);
      if (v !== undefined) {
        if (v === null) return null;
        return { number: Number(v), sc: syscallByNumber(Number(v)) };
      }
      if (s.kind === 'instruction' && (isBranch(s.mnemonic) || /^ret/i.test(s.mnemonic))) return null;
    }
    if (ln !== line && L.stmts.some((s) => s.labels.length)) {
      // a label above: stop unless the mov is on that same line (already handled above)
      return null;
    }
  }
  return null;
}

/** Build a doc-comment string from comment-only lines directly above `line`. */
function docCommentAbove(R, line) {
  const out = [];
  for (let i = line - 1; i >= 0 && out.length < 8; i--) {
    const L = R.lines[i];
    if (!L || L.stmts.length || L.pp) break;
    if (L.commentCol < 0) {
      if (L.text.trim()) break; // inside block comment or other text
      break;
    }
    out.unshift(L.text.slice(L.commentCol).replace(/^#+\s?/, '').trimEnd());
  }
  const L = R.lines[line];
  if (L && L.commentCol >= 0 && L.stmts.length) out.push(L.text.slice(L.commentCol).replace(/^#+\s?/, '').trimEnd());
  return out.join('\n').trim();
}

module.exports = { parseInteger, numberMarkdown, evalConst, inferSyscall, docCommentAbove };
