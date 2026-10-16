'use strict';
/**
 * Work out what the user is typing at a given column of a line.
 * Pure helper used by the completion and signature-help providers.
 */
const PREFIX_WORDS = 'lock|rep|repe|repz|repne|repnz|bnd|notrack|xacquire|xrelease|data16|data32|addr32|addr16';
const FIRST_WORD_RE = new RegExp(`^\\s*(?:(?:${PREFIX_WORDS})\\s+)*([A-Za-z_.][\\w.]*)?$`, 'i');
const INSTR_RE = new RegExp(`^\\s*(?:(?:${PREFIX_WORDS})\\s+)*([A-Za-z_.][\\w.]*)\\s+([\\s\\S]*)$`, 'i');
const LABEL_PREFIX_RE = /^\s*(?:[A-Za-z_.][\w.$]*|\d+)\s*:(?!:)/;

/** Returns the text of the current statement before the cursor, or null in a comment/string. */
function currentSegment(text, col) {
  const before = text.slice(0, col);
  let inStr = false;
  let segStart = 0;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (c === '\\' && inStr) { i++; continue; }
    if (c === '"') inStr = !inStr;
    else if (!inStr && c === '#') return null;
    else if (!inStr && c === ';') segStart = i + 1;
  }
  if (inStr) return null;
  let seg = before.slice(segStart);
  let offset = segStart;
  for (;;) {
    const m = LABEL_PREFIX_RE.exec(seg);
    if (!m) break;
    seg = seg.slice(m[0].length);
    offset += m[0].length;
  }
  return { seg, offset };
}

function topLevelCommas(s) {
  let depth = 0;
  let n = 0;
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) n++;
  }
  return n;
}

function cursorContext(text, col) {
  const cs = currentSegment(text, col);
  if (!cs) return { kind: 'none' };
  const { seg } = cs;

  const first = FIRST_WORD_RE.exec(seg);
  if (first) {
    const word = first[1] || '';
    return { kind: word.startsWith('.') ? 'directive' : 'mnemonic', word, start: col - word.length };
  }

  const m = INSTR_RE.exec(seg);
  if (!m) return { kind: 'none' };
  const mnemonic = m[1];
  const operands = m[2];
  const wm = /(%[A-Za-z0-9_]*|\$[\w.]*|@\w*|[A-Za-z_.\\][\w.$\\]*)$/.exec(operands);
  const word = wm ? wm[1] : '';
  const start = col - word.length;
  let opens = 0;
  for (const c of operands) { if (c === '(') opens++; else if (c === ')') opens--; }
  const out = { kind: 'operand', mnemonic, operandIndex: topLevelCommas(operands), word, start, inMem: opens > 0, operandText: operands };
  if (word.startsWith('%')) out.wordKind = 'register';
  else if (word.startsWith('@')) out.wordKind = 'reloc';
  else if (word.startsWith('$')) out.wordKind = 'immediate';
  else if (word) out.wordKind = 'symbol';
  else out.wordKind = 'empty';
  // `foo@` style relocation typing: symbol followed immediately by @ handled by '@' word above
  return out;
}

module.exports = { cursorContext, currentSegment, topLevelCommas };
