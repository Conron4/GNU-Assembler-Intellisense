'use strict';
const vscode = require('vscode');
const { parseDocument } = require('./parser');

/**
 * Caches parse results per document and maintains a lightweight index of every
 * assembly file in the workspace (for cross-file definitions, references, rename).
 */
class Store {
  constructor() {
    /** @type {Map<string,{version:number,parsed:any}>} */
    this.cache = new Map();
    /** @type {Map<string,{uri:vscode.Uri,parsed:any}>} files indexed from disk or open editors */
    this.files = new Map();
    this.disposables = [];
    this.indexing = null;
  }

  config() {
    return vscode.workspace.getConfiguration('gas');
  }

  /** Parsed result for an open document (cached by version). */
  get(doc) {
    const key = doc.uri.toString();
    const c = this.cache.get(key);
    if (c && c.version === doc.version) return c.parsed;
    const parsed = parseDocument(doc.getText());
    this.cache.set(key, { version: doc.version, parsed });
    if (doc.uri.scheme === 'file') this.files.set(key, { uri: doc.uri, parsed });
    return parsed;
  }

  forget(doc) {
    this.cache.delete(doc.uri.toString());
  }

  /** Index every matching file in the workspace. */
  async indexWorkspace() {
    if (this.indexing) return this.indexing;
    this.indexing = (async () => {
      const cfg = this.config();
      const include = cfg.get('workspace.include', '**/*.{s,S,inc,gas}');
      const exclude = cfg.get('workspace.exclude', '**/{node_modules,.git,build,out}/**');
      const max = cfg.get('workspace.maxFiles', 2000);
      let uris = [];
      try {
        uris = await vscode.workspace.findFiles(include, exclude, max);
      } catch (e) {
        uris = [];
      }
      const queue = uris.slice();
      const worker = async () => {
        while (queue.length) {
          const uri = queue.pop();
          await this.indexUri(uri);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })().finally(() => {
      this.indexing = null;
    });
    return this.indexing;
  }

  async indexUri(uri) {
    const key = uri.toString();
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
    try {
      if (open) {
        this.get(open);
        return;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      this.files.set(key, { uri, parsed: parseDocument(text) });
    } catch (e) {
      this.files.delete(key);
    }
  }

  startWatching() {
    const cfg = this.config();
    const glob = cfg.get('workspace.include', '**/*.{s,S,inc,gas}');
    const w = vscode.workspace.createFileSystemWatcher(glob);
    w.onDidCreate((u) => this.indexUri(u), null, this.disposables);
    w.onDidChange((u) => this.indexUri(u), null, this.disposables);
    w.onDidDelete((u) => this.files.delete(u.toString()), null, this.disposables);
    this.disposables.push(w);
  }

  async reindex() {
    this.files.clear();
    await this.indexWorkspace();
  }

  /** Iterate over every known parsed file (open documents first). */
  allFiles() {
    return Array.from(this.files.values());
  }

  /**
   * Find definitions for `name`.  Same-file definitions win; otherwise search the workspace
   * (excluding file-local `.L` labels and numeric labels).
   */
  findDefs(name, doc, R) {
    const own = (R || this.get(doc)).byName.get(name);
    const here = own ? own.filter((d) => !(d.kind === 'label' && d.inMacro)) : [];
    if (here.length) return here.map((d) => ({ uri: doc.uri, def: d, parsed: R || this.get(doc) }));
    if (/^\.L/.test(name)) return [];
    const out = [];
    for (const f of this.files.values()) {
      if (f.uri.toString() === doc.uri.toString()) continue;
      const list = f.parsed.byName.get(name);
      if (!list) continue;
      for (const d of list) {
        if (d.kind === 'label' && (d.numeric || d.inMacro)) continue;
        if (d.local) continue;
        out.push({ uri: f.uri, def: d, parsed: f.parsed });
      }
    }
    // prefer globally visible definitions
    out.sort((a, b) => Number(b.parsed.globals.has(name)) - Number(a.parsed.globals.has(name)));
    return out;
  }

  /** Is there any definition of this name anywhere in the workspace? */
  hasGlobal(name) {
    for (const f of this.files.values()) {
      const list = f.parsed.byName.get(name);
      if (list && list.some((d) => !d.local && !d.inMacro)) return true;
    }
    return false;
  }

  /** Macros visible from a document (own file + workspace). */
  allMacros(R) {
    const out = new Map();
    for (const f of this.files.values()) for (const [n, m] of f.parsed.macros) out.set(n, m);
    for (const [n, m] of R.macros) out.set(n, m);
    return out;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}

module.exports = { Store };
