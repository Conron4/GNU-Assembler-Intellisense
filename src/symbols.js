'use strict';
/**
 * Builds a hierarchical outline (sections > functions > labels) from a parsed document.
 * Pure data - converted to vscode.DocumentSymbol in the provider.
 */

function classifyLabel(R, d) {
  if (R.types.get(d.name) === 'function') return 'function';
  if (R.types.get(d.name) === 'object' || R.types.get(d.name) === 'tls_object') return 'data';
  if (d.exec) return R.globals.has(d.name) ? 'function' : 'label';
  return 'data';
}

function trimEnd(R, start, end) {
  let e = end;
  while (e > start) {
    const L = R.lines[e];
    if (L && L.stmts.length === 0 && !L.pp) e--;
    else break;
  }
  return e;
}

function buildOutline(R, opts = {}) {
  const showLocal = !!opts.showLocalLabels;
  const items = [];
  for (const d of R.defs) {
    if (d.inMacro && d.kind !== 'macro') continue;
    if (d.kind === 'label') {
      if (!showLocal && (d.numeric || d.local)) continue;
      items.push({ def: d, kind: classifyLabel(R, d) });
    } else if (d.kind === 'macro') items.push({ def: d, kind: 'macro' });
    else if (d.kind === 'const' || d.kind === 'define') items.push({ def: d, kind: 'constant' });
    else if (d.kind === 'data') items.push({ def: d, kind: 'data' });
  }

  const sections = R.sections.filter((s) => s.line <= s.endLine || !s.implicit);
  const nodes = new Map(); // section -> node

  const sectionFor = (line) => {
    for (let i = sections.length - 1; i >= 0; i--) if (sections[i].line <= line) return sections[i];
    return sections[0] || null;
  };

  const top = [];
  const sectionNode = (sec) => {
    if (!nodes.has(sec)) {
      const node = {
        name: sec.name, kind: 'namespace', detail: sec.exec ? 'code' : 'data',
        startLine: sec.line, endLine: Math.max(sec.line, trimEnd(R, sec.line, sec.endLine)),
        selLine: sec.line, selCol: 0, selEnd: Math.max(1, (R.lines[sec.line] || { text: '' }).text.length),
        children: [], lastFunction: null
      };
      nodes.set(sec, node);
      top.push(node);
    }
    return nodes.get(sec);
  };

  // line ranges for labels: until the next function/data label in the same section
  const rangeOwners = items.filter((i) => i.kind === 'function' || i.kind === 'data');

  for (const it of items) {
    const d = it.def;
    const sec = sectionFor(d.line);
    const parent = sec ? sectionNode(sec) : null;
    let endLine = d.line;
    if (it.kind === 'macro') endLine = d.endLine;
    else if (it.kind === 'function' || it.kind === 'data') {
      const next = rangeOwners.find((o) => o.def.line > d.line && o.def.section === d.section);
      let limit = sec ? sec.endLine : R.lines.length - 1;
      if (next) limit = Math.min(limit, next.def.line - 1);
      endLine = Math.max(d.line, trimEnd(R, d.line, limit));
    }
    const detail =
      it.kind === 'constant' ? String(d.value || '').slice(0, 40)
        : it.kind === 'macro' ? d.paramText
          : it.kind === 'function' ? (R.globals.has(d.name) ? 'global' : 'local')
            : '';
    const node = {
      name: d.name, kind: it.kind, detail, startLine: d.line, endLine,
      selLine: d.line, selCol: d.col, selEnd: d.end, children: []
    };
    if (it.kind === 'label' && parent && parent.lastFunction && parent.lastFunction.endLine >= d.line) {
      parent.lastFunction.children.push(node);
    } else if (parent) {
      parent.children.push(node);
      if (it.kind === 'function') parent.lastFunction = node;
    } else top.push(node);
  }

  // drop empty sections (keep order), strip helper fields, ensure containment
  const clean = (n) => {
    delete n.lastFunction;
    n.children.forEach(clean);
    for (const c of n.children) {
      if (c.startLine < n.startLine) n.startLine = c.startLine;
      if (c.endLine > n.endLine) n.endLine = c.endLine;
    }
    return n;
  };
  return top.filter((n) => n.kind !== 'namespace' || n.children.length).map(clean);
}

/** Flat list of symbols for workspace search. */
function workspaceSymbols(R) {
  const out = [];
  for (const d of R.defs) {
    if (d.inMacro && d.kind !== 'macro') continue;
    if (d.kind === 'label' && (d.numeric || d.local)) continue;
    const kind = d.kind === 'label' ? classifyLabel(R, d) : d.kind === 'macro' ? 'macro' : d.kind === 'data' ? 'data' : 'constant';
    out.push({ name: d.name, kind, line: d.line, col: d.col, end: d.end });
  }
  return out;
}

/** Folding ranges: blocks, sections, functions, comments, preprocessor. */
function foldingRanges(R) {
  const out = [];
  for (const b of R.blocks) if (b.endLine > b.startLine) out.push({ start: b.startLine, end: b.endLine - (b.kind === 'ppif' ? 1 : 0), kind: 'region' });
  for (const c of R.blockComments) out.push({ start: c.startLine, end: c.endLine, kind: 'comment' });
  // runs of comment-only lines
  let runStart = -1;
  for (let i = 0; i <= R.lines.length; i++) {
    const L = R.lines[i];
    const isComment = L && L.commentCol >= 0 && L.stmts.length === 0 && L.text.slice(0, L.commentCol).trim() === '' && !L.pp;
    if (isComment) { if (runStart < 0) runStart = i; }
    else {
      if (runStart >= 0 && i - 1 > runStart) out.push({ start: runStart, end: i - 1, kind: 'comment' });
      runStart = -1;
    }
  }
  const outline = buildOutline(R, { showLocalLabels: false });
  const walk = (n) => {
    if (n.endLine > n.startLine && (n.kind === 'function' || n.kind === 'data' || n.kind === 'macro')) out.push({ start: n.startLine, end: n.endLine, kind: 'region' });
    n.children.forEach(walk);
  };
  outline.forEach(walk);
  // de-duplicate identical ranges
  const seen = new Set();
  return out.filter((r) => {
    const k = r.start + ':' + r.end;
    if (seen.has(k) || r.end <= r.start) return false;
    seen.add(k);
    return true;
  });
}

module.exports = { buildOutline, workspaceSymbols, foldingRanges, classifyLabel };
