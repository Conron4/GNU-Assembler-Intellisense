'use strict';
/**
 * Line-based formatter for GNU as sources.  Pure: returns [{ line, text }] edits.
 *
 * Layout:  label:<pad>mnemonic<pad>operands<pad># comment
 */
const { isKnownMnemonic } = require('./data/instructions');

const DEFAULTS = {
  useTabs: false,
  indentSize: 4,
  mnemonicWidth: 8,
  commentColumn: 40,
  indentDirectives: true,
  mnemonicCase: 'preserve'
};

function normalizeOperand(text) {
  let t = text.trim();
  if (t.includes('"') || t.includes("'")) return t;
  return t.replace(/\(([^()]*)\)/g, (m, inner) => '(' + inner.replace(/\s*,\s*/g, ',').trim() + ')');
}

function visualLength(s, tabSize) {
  let n = 0;
  for (const c of s) n += c === '\t' ? tabSize - (n % tabSize) : 1;
  return n;
}

function formatLine(L, o) {
  const text = L.text;
  const trimmed = text.replace(/\s+$/, '');
  if (L.pp) return trimmed;
  if (!trimmed) return '';
  if (L.stmts.length === 0) return trimmed; // comment-only / inside block comment
  if (text.includes('/*') || text.includes('*/')) return trimmed;

  const indent = o.useTabs ? '\t' : ' '.repeat(o.indentSize);
  const comment = L.commentCol >= 0 ? text.slice(L.commentCol).replace(/\s+$/, '') : '';
  const codePart = L.bare.slice(0, L.commentCol >= 0 ? L.commentCol : undefined);

  // multiple statements / trailing ';' -> only fix leading indentation
  if (L.stmts.length > 1 || codePart.includes(';')) {
    const first = L.stmts[0];
    const lead = first.labels.length ? '' : indent;
    return lead + trimmed.replace(/^\s+/, '');
  }

  const s = L.stmts[0];
  if (s.kind === 'unknown') return trimmed;

  const labels = s.labels.map((l) => l.name + ':').join(' ');
  let body = '';
  let isDirective = false;
  if (s.kind === 'labels') {
    body = '';
  } else if (s.kind === 'assign') {
    return finish(labels ? labels + ' ' : '', `${s.mnemonic} = ${s.argsRaw.trim()}`, comment, o, true);
  } else {
    isDirective = s.kind === 'directive';
    let mn = s.mnemonic;
    if (s.kind === 'instruction' && o.mnemonicCase !== 'preserve' && isKnownMnemonic(mn.toLowerCase())) {
      mn = o.mnemonicCase === 'lower' ? mn.toLowerCase() : mn.toUpperCase();
    }
    const pre = s.prefixes.map((p) => (o.mnemonicCase === 'preserve' ? p.text : o.mnemonicCase === 'lower' ? p.text.toLowerCase() : p.text.toUpperCase())).concat(mn).join(' ');
    const ops = s.operands.map((op) => normalizeOperand(op.text)).join(', ');
    if (ops) {
      const gap = Math.max(1, o.mnemonicWidth - pre.length);
      body = pre + ' '.repeat(gap) + ops;
    } else body = pre;
  }

  let lead;
  if (labels) {
    const pad = labels.length < o.indentSize ? o.indentSize - labels.length : 1;
    lead = labels + (body ? ' '.repeat(pad) : '');
  } else if (isDirective && !o.indentDirectives) lead = '';
  else lead = body ? indent : '';
  return finish(lead, body, comment, o, false);
}

function finish(lead, body, comment, o) {
  const code = lead + body;
  if (!comment) return code.replace(/\s+$/, '');
  if (!code.trim()) return comment;
  if (o.commentColumn > 0) {
    const len = visualLength(code, o.indentSize);
    const pad = Math.max(1, o.commentColumn - len);
    return code + ' '.repeat(pad) + comment;
  }
  return code + ' ' + comment;
}

/** Returns edits for lines whose text changes. range = { start, end } (inclusive) or undefined. */
function formatDocument(R, options = {}, range) {
  const o = Object.assign({}, DEFAULTS, options);
  const edits = [];
  const start = range ? range.start : 0;
  const end = range ? range.end : R.lines.length - 1;
  for (let i = start; i <= end && i < R.lines.length; i++) {
    const L = R.lines[i];
    const next = formatLine(L, o);
    if (next !== L.text) edits.push({ line: i, text: next });
  }
  return edits;
}

module.exports = { formatDocument, formatLine, DEFAULTS, normalizeOperand };
