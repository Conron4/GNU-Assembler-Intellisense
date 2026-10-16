'use strict';
const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { heuristicDiagnostics } = require('./diagnostics');
const { parseAsOutput, run } = require('./assembler');

const SEV = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint
};

const STDIN_NAMES = /^(\{standard input\}|<stdin>|stdin|-)$/;

class DiagnosticsManager {
  constructor(store) {
    this.store = store;
    this.collection = vscode.languages.createDiagnosticCollection('gas');
    this.heuristic = new Map(); // uri -> Diagnostic[]
    this.assembler = new Map(); // uri -> Diagnostic[]
    this.timers = new Map();
    this.warnedMissing = false;
    this.running = new Map();
  }

  cfg() {
    return vscode.workspace.getConfiguration('gas');
  }

  static supports(doc) {
    return doc.languageId === 'gas' && (doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled');
  }

  // ---- heuristics ------------------------------------------------------------
  updateHeuristics(doc) {
    if (!DiagnosticsManager.supports(doc)) return;
    const key = doc.uri.toString();
    const cfg = this.cfg();
    if (!cfg.get('lint.enable', true)) {
      this.heuristic.delete(key);
      this.publish(doc);
      return;
    }
    const R = this.store.get(doc);
    const list = heuristicDiagnostics(R, {
      unknownDirectives: cfg.get('lint.unknownDirectives', true),
      unknownInstructions: cfg.get('lint.unknownInstructions', false),
      undefinedSymbols: cfg.get('lint.undefinedSymbols', false),
      isKnownSymbol: (n) => this.store.hasGlobal(n)
    });
    this.heuristic.set(
      key,
      list.map((d) => {
        const lineLen = doc.lineAt(Math.min(d.line, doc.lineCount - 1)).text.length;
        const diag = new vscode.Diagnostic(new vscode.Range(d.line, d.col, d.line, Math.min(Math.max(d.end, d.col + 1), Math.max(lineLen, d.col + 1))), d.message, SEV[d.severity]);
        diag.source = 'gas';
        diag.code = d.code;
        return diag;
      })
    );
    this.publish(doc);
  }

  scheduleHeuristics(doc, delay = 250) {
    if (!DiagnosticsManager.supports(doc)) return;
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.updateHeuristics(doc), delay));
  }

  // ---- real assembler ----------------------------------------------------------
  scheduleAssembler(doc, delay) {
    if (!DiagnosticsManager.supports(doc)) return;
    const key = 'as:' + doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.runAssembler(doc), delay));
  }

  includeArgs(doc) {
    const out = [];
    const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
    const base = ws ? ws.uri.fsPath : doc.uri.scheme === 'file' ? path.dirname(doc.uri.fsPath) : process.cwd();
    for (const p of this.cfg().get('includePaths', [])) out.push('-I', path.isAbsolute(p) ? p : path.join(base, p));
    return out;
  }

  async runAssembler(doc) {
    const cfg = this.cfg();
    const mode = cfg.get('lint.assembler', 'onSave');
    const key = doc.uri.toString();
    if (mode === 'off') {
      this.assembler.delete(key);
      this.publish(doc);
      return;
    }
    const version = doc.version;
    const isCpp = doc.uri.scheme === 'file' && /\.S$/.test(doc.uri.fsPath);
    const cwd = doc.uri.scheme === 'file' ? path.dirname(doc.uri.fsPath) : undefined;
    let cmd;
    let args;
    if (isCpp) {
      cmd = cfg.get('preprocessor.path', 'gcc');
      args = ['-x', 'assembler-with-cpp', ...cfg.get('preprocessor.args', []), ...this.includeArgs(doc), '-c', '-o', os.devNull, '-'];
    } else {
      cmd = cfg.get('assembler.path', 'as');
      args = [...cfg.get('assembler.args', ['--64']), ...this.includeArgs(doc), '-o', os.devNull, '-'];
    }
    const res = await run(cmd, args, { cwd, input: doc.getText(), timeout: 20000 });
    if (res.error && res.error.code === 'ENOENT') {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        vscode.window.showInformationMessage(`GNU Assembler: '${cmd}' was not found, so assembler-based diagnostics are disabled. Install binutils or set "gas.assembler.path" (or set "gas.lint.assembler" to "off").`);
      }
      return;
    }
    if (doc.version !== version && mode === 'onType') return; // stale
    const msgs = parseAsOutput(res.stderr).filter((m) => STDIN_NAMES.test(m.file) || (doc.uri.scheme === 'file' && path.resolve(cwd || '', m.file) === doc.uri.fsPath));
    const diags = msgs.map((m) => {
      const line = Math.min(m.line, doc.lineCount - 1);
      const text = doc.lineAt(line).text;
      const start = text.length - text.trimStart().length;
      const d = new vscode.Diagnostic(new vscode.Range(line, start, line, Math.max(text.length, start)), m.message, SEV[m.severity]);
      d.source = 'as';
      return d;
    });
    this.assembler.set(key, diags);
    this.publish(doc);
  }

  // ---- combine ---------------------------------------------------------------
  publish(doc) {
    const key = doc.uri.toString();
    const asDiags = this.assembler.get(key) || [];
    const errorLines = new Set(asDiags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).map((d) => d.range.start.line));
    // the assembler is authoritative: drop heuristic errors/warnings it already reports on the same line
    const heur = (this.heuristic.get(key) || []).filter((d) => !(errorLines.has(d.range.start.line) && d.severity <= vscode.DiagnosticSeverity.Warning && !/^gas\.(unterminated|unmatched)/.test(String(d.code))));
    this.collection.set(doc.uri, [...heur, ...asDiags]);
  }

  clear(doc) {
    const key = doc.uri.toString();
    this.heuristic.delete(key);
    this.assembler.delete(key);
    this.collection.delete(doc.uri);
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.collection.dispose();
  }
}

module.exports = { DiagnosticsManager };
