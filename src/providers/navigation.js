'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { tokenAt, resolveLocalRef } = require('../parser');
const { buildOutline, workspaceSymbols, foldingRanges, classifyLabel } = require('../symbols');
const { isRegister } = require('../data/registers');
const { isKnownMnemonic } = require('../data/instructions');

const SK = vscode.SymbolKind;
const KIND_MAP = {
  namespace: SK.Namespace,
  function: SK.Function,
  label: SK.Key,
  data: SK.Variable,
  constant: SK.Constant,
  macro: SK.Event
};

function lineRange(doc, a, b) {
  const last = Math.min(b, doc.lineCount - 1);
  return new vscode.Range(a, 0, last, doc.lineAt(last).text.length);
}

/** Symbol-like token under the cursor (names that can be navigated / renamed). */
function symbolAt(R, pos) {
  const t = tokenAt(R, pos.line, pos.character);
  if (!t) return null;
  if (t.type === 'symbol' || t.type === 'label' || t.type === 'macro-call') return t;
  if (t.type === 'local-ref') return t;
  return null;
}

class DefinitionProvider {
  constructor(store) {
    this.store = store;
  }

  provideDefinition(doc, pos) {
    const R = this.store.get(doc);
    const t = symbolAt(R, pos);
    if (!t) return undefined;
    if (t.type === 'local-ref') {
      const d = resolveLocalRef(R, { name: t.name, line: pos.line, col: t.col });
      return d ? new vscode.Location(doc.uri, new vscode.Range(d.line, d.col, d.line, d.end)) : undefined;
    }
    if (t.type === 'label' && t.def && t.def.numeric) return undefined;
    const found = this.store.findDefs(t.name, doc, R);
    return found.map(({ uri, def }) => new vscode.Location(uri, new vscode.Range(def.line, def.col, def.line, def.end)));
  }
}

/** All occurrences of a named symbol in a parsed file. */
function occurrences(parsed, name, includeDefs) {
  const out = [];
  if (includeDefs) {
    for (const d of parsed.defs) if (d.name === name) out.push({ line: d.line, col: d.col, end: d.end, def: true });
  }
  for (const r of parsed.refsByName.get(name) || []) out.push({ line: r.line, col: r.col, end: r.end, def: false });
  // macro invocations
  for (const L of parsed.lines) {
    for (const s of L.stmts) if (s.kind === 'macro-call' && s.mnemonic === name) out.push({ line: s.line, col: s.mcol, end: s.mend, def: false });
  }
  return out;
}

class ReferenceProvider {
  constructor(store) {
    this.store = store;
  }

  provideReferences(doc, pos, ctx) {
    const R = this.store.get(doc);
    const t = symbolAt(R, pos);
    if (!t) return undefined;
    const locs = [];
    if (t.type === 'local-ref' || (t.type === 'label' && t.def && t.def.numeric)) {
      const target = t.type === 'local-ref' ? resolveLocalRef(R, { name: t.name, line: pos.line, col: t.col }) : t.def;
      if (!target) return [];
      if (ctx.includeDeclaration) locs.push(new vscode.Location(doc.uri, new vscode.Range(target.line, target.col, target.line, target.end)));
      for (const r of R.refs) {
        if (r.numeric && r.name.slice(0, -1) === target.name) {
          const d = resolveLocalRef(R, r);
          if (d === target) locs.push(new vscode.Location(doc.uri, new vscode.Range(r.line, r.col, r.line, r.end)));
        }
      }
      return locs;
    }
    const local = /^\.L/.test(t.name);
    const files = local ? [{ uri: doc.uri, parsed: R }] : this.store.allFiles().filter((f) => f.uri.toString() !== doc.uri.toString()).concat([{ uri: doc.uri, parsed: R }]);
    for (const f of files) {
      for (const o of occurrences(f.parsed, t.name, ctx.includeDeclaration)) {
        locs.push(new vscode.Location(f.uri, new vscode.Range(o.line, o.col, o.line, o.end)));
      }
    }
    return locs;
  }
}

class HighlightProvider {
  constructor(store) {
    this.store = store;
  }

  provideDocumentHighlights(doc, pos) {
    const R = this.store.get(doc);
    const t = symbolAt(R, pos);
    if (!t) return undefined;
    if (t.type === 'local-ref' || (t.type === 'label' && t.def && t.def.numeric)) {
      const target = t.type === 'local-ref' ? resolveLocalRef(R, { name: t.name, line: pos.line, col: t.col }) : t.def;
      if (!target) return [];
      const out = [new vscode.DocumentHighlight(new vscode.Range(target.line, target.col, target.line, target.end), vscode.DocumentHighlightKind.Write)];
      for (const r of R.refs) {
        if (r.numeric && r.name.slice(0, -1) === target.name && resolveLocalRef(R, r) === target) {
          out.push(new vscode.DocumentHighlight(new vscode.Range(r.line, r.col, r.line, r.end), vscode.DocumentHighlightKind.Read));
        }
      }
      return out;
    }
    return occurrences(R, t.name, true).map(
      (o) => new vscode.DocumentHighlight(new vscode.Range(o.line, o.col, o.line, o.end), o.def ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read)
    );
  }
}

class RenameProvider {
  constructor(store) {
    this.store = store;
  }

  prepareRename(doc, pos) {
    const R = this.store.get(doc);
    const t = symbolAt(R, pos);
    if (!t) throw new Error('Place the cursor on a label, constant or macro name to rename it.');
    if (t.type === 'local-ref' || (t.type === 'label' && t.def && t.def.numeric)) throw new Error('Numeric local labels (1:, 1b, 1f) cannot be renamed.');
    if (!R.byName.has(t.name) && this.store.findDefs(t.name, doc, R).length === 0) {
      throw new Error(`'${t.name}' is not defined in this workspace, so it cannot be renamed safely.`);
    }
    return new vscode.Range(pos.line, t.col, pos.line, t.end);
  }

  provideRenameEdits(doc, pos, newName) {
    const R = this.store.get(doc);
    const t = symbolAt(R, pos);
    if (!t) return undefined;
    if (!/^[A-Za-z_.][\w.$]*$/.test(newName)) throw new Error(`'${newName}' is not a valid symbol name.`);
    if (isRegister(newName) || isKnownMnemonic(newName)) throw new Error(`'${newName}' clashes with a register or instruction name.`);
    const edit = new vscode.WorkspaceEdit();
    const local = /^\.L/.test(t.name);
    const files = local ? [{ uri: doc.uri, parsed: R }] : this.store.allFiles().filter((f) => f.uri.toString() !== doc.uri.toString()).concat([{ uri: doc.uri, parsed: R }]);
    for (const f of files) {
      const seen = new Set();
      for (const o of occurrences(f.parsed, t.name, true)) {
        const key = o.line + ':' + o.col;
        if (seen.has(key)) continue;
        seen.add(key);
        edit.replace(f.uri, new vscode.Range(o.line, o.col, o.line, o.end), newName);
      }
    }
    return edit;
  }
}

class SymbolProvider {
  constructor(store) {
    this.store = store;
  }

  provideDocumentSymbols(doc) {
    const R = this.store.get(doc);
    const outline = buildOutline(R, { showLocalLabels: this.store.config().get('outline.showLocalLabels', false) });
    const conv = (n) => {
      const sym = new vscode.DocumentSymbol(
        n.name || '(unnamed)',
        n.detail || '',
        KIND_MAP[n.kind] || SK.Variable,
        lineRange(doc, n.startLine, n.endLine),
        new vscode.Range(n.selLine, n.selCol, n.selLine, Math.max(n.selEnd, n.selCol))
      );
      sym.children = n.children.map(conv);
      return sym;
    };
    return outline.map(conv);
  }
}

class WorkspaceSymbolProvider {
  constructor(store) {
    this.store = store;
  }

  async provideWorkspaceSymbols(query) {
    if (!this.store.files.size) await this.store.indexWorkspace();
    const q = query.toLowerCase();
    const out = [];
    for (const f of this.store.allFiles()) {
      for (const s of workspaceSymbols(f.parsed)) {
        if (q && !s.name.toLowerCase().includes(q)) continue;
        out.push(new vscode.SymbolInformation(s.name, KIND_MAP[s.kind] || SK.Variable, path.basename(f.uri.fsPath), new vscode.Location(f.uri, new vscode.Range(s.line, s.col, s.line, s.end))));
        if (out.length > 500) return out;
      }
    }
    return out;
  }
}

class FoldingProvider {
  constructor(store) {
    this.store = store;
  }

  provideFoldingRanges(doc) {
    const R = this.store.get(doc);
    return foldingRanges(R).map((r) => new vscode.FoldingRange(r.start, r.end, r.kind === 'comment' ? vscode.FoldingRangeKind.Comment : vscode.FoldingRangeKind.Region));
  }
}

class LinkProvider {
  constructor(store) {
    this.store = store;
  }

  provideDocumentLinks(doc) {
    if (doc.uri.scheme !== 'file') return [];
    const R = this.store.get(doc);
    const cfg = this.store.config();
    const dirs = [path.dirname(doc.uri.fsPath)];
    const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
    for (const p of cfg.get('includePaths', [])) dirs.push(path.isAbsolute(p) ? p : path.join(ws ? ws.uri.fsPath : dirs[0], p));
    const links = [];
    for (const inc of R.includes) {
      const target = path.isAbsolute(inc.path) ? inc.path : dirs.map((d) => path.join(d, inc.path)).find((p) => fs.existsSync(p));
      if (!target || !fs.existsSync(target)) continue;
      const link = new vscode.DocumentLink(new vscode.Range(inc.line, inc.col, inc.line, inc.end), vscode.Uri.file(target));
      link.tooltip = 'Open ' + inc.path;
      links.push(link);
    }
    return links;
  }
}

// ---------------------------------------------------------------------------
// semantic tokens
// ---------------------------------------------------------------------------

const TOKEN_TYPES = ['function', 'variable', 'macro', 'label', 'enumMember'];
const TOKEN_MODS = ['declaration', 'readonly', 'global'];
const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODS);

class SemanticProvider {
  constructor(store) {
    this.store = store;
  }

  classify(parsed, def) {
    switch (def.kind) {
      case 'label': {
        const c = classifyLabel(parsed, def);
        return { type: c === 'function' ? 0 : c === 'data' ? 1 : 3, mods: parsed.globals.has(def.name) ? 4 : 0 };
      }
      case 'macro':
        return { type: 2, mods: 0 };
      case 'data':
        return { type: 1, mods: 0 };
      default:
        return { type: 4, mods: 2 };
    }
  }

  provideDocumentSemanticTokens(doc) {
    const R = this.store.get(doc);
    const items = [];
    const cache = new Map();
    const lookup = (name) => {
      if (cache.has(name)) return cache.get(name);
      let res = null;
      const own = R.byName.get(name);
      if (own && own.length) res = this.classify(R, own[0]);
      else {
        const found = this.store.findDefs(name, doc, R);
        if (found.length) res = this.classify(found[0].parsed, found[0].def);
      }
      cache.set(name, res);
      return res;
    };
    for (const d of R.defs) {
      if (d.numeric) { items.push({ line: d.line, col: d.col, len: d.end - d.col, type: 3, mods: 1 }); continue; }
      if (d.inMacro && d.kind !== 'macro') continue;
      const c = this.classify(R, d);
      items.push({ line: d.line, col: d.col, len: d.end - d.col, type: c.type, mods: c.mods | 1 });
    }
    for (const r of R.refs) {
      if (r.pp) {
        const c = lookup(r.name);
        if (c) items.push({ line: r.line, col: r.col, len: r.end - r.col, type: c.type, mods: c.mods });
        continue;
      }
      if (r.numeric) { items.push({ line: r.line, col: r.col, len: r.end - r.col, type: 3, mods: 0 }); continue; }
      const c = lookup(r.name);
      if (c) items.push({ line: r.line, col: r.col, len: r.end - r.col, type: c.type, mods: c.mods });
    }
    for (const L of R.lines) {
      for (const s of L.stmts) if (s.kind === 'macro-call') items.push({ line: s.line, col: s.mcol, len: s.mend - s.mcol, type: 2, mods: 0 });
    }
    items.sort((a, b) => a.line - b.line || a.col - b.col);
    const builder = new vscode.SemanticTokensBuilder(LEGEND);
    let lastLine = -1;
    let lastEnd = -1;
    for (const it of items) {
      if (it.len <= 0) continue;
      if (it.line === lastLine && it.col < lastEnd) continue; // overlap
      builder.push(it.line, it.col, it.len, it.type, it.mods);
      lastLine = it.line;
      lastEnd = it.col + it.len;
    }
    return builder.build();
  }
}

module.exports = {
  DefinitionProvider, ReferenceProvider, HighlightProvider, RenameProvider, SymbolProvider,
  WorkspaceSymbolProvider, FoldingProvider, LinkProvider, SemanticProvider, LEGEND
};
