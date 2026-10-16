'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { run, parseAsOutput } = require('./assembler');
const { allMnemonics, instructionMarkdown } = require('./data/instructions');
const { DIRECTIVES } = require('./data/directives');
const { TABLE } = require('./data/syscalls');

const SEV = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, info: vscode.DiagnosticSeverity.Information };

class Commands {
  constructor(store, diagnostics) {
    this.store = store;
    this.diagnostics = diagnostics;
    this.out = vscode.window.createOutputChannel('GNU Assembler');
    this.buildDiagnostics = vscode.languages.createDiagnosticCollection('gas-build');
    this.disasm = new Map();
    this.disasmEmitter = new vscode.EventEmitter();
  }

  register(ctx) {
    const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
    reg('gas.assemble', () => this.withDoc((d) => this.assemble(d)));
    reg('gas.build', () => this.withDoc((d) => this.build(d)));
    reg('gas.run', () => this.withDoc((d) => this.buildAndRun(d)));
    reg('gas.disassemble', () => this.withDoc((d) => this.disassemble(d)));
    reg('gas.lookupInstruction', () => this.lookup());
    reg('gas.insertSyscall', () => this.insertSyscall());
    reg('gas.lintNow', () => this.withDoc(async (d) => { this.diagnostics.updateHeuristics(d); await this.diagnostics.runAssembler(d); }));
    reg('gas.reindexWorkspace', async () => {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Indexing assembly files…' }, () => this.store.reindex());
      vscode.window.setStatusBarMessage(`GAS: indexed ${this.store.files.size} files`, 3000);
    });
    ctx.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider('gas-disasm', {
        onDidChange: this.disasmEmitter.event,
        provideTextDocumentContent: (uri) => this.disasm.get(uri.toString()) || ''
      }),
      this.out,
      this.buildDiagnostics
    );
  }

  async withDoc(fn) {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.languageId !== 'gas') {
      vscode.window.showWarningMessage('Open a GNU assembler file first.');
      return;
    }
    return fn(ed.document);
  }

  cfg() {
    return vscode.workspace.getConfiguration('gas');
  }

  vars(str, doc) {
    const file = doc.uri.fsPath;
    const ws = vscode.workspace.getWorkspaceFolder(doc.uri);
    return str
      .replace(/\$\{workspaceFolder\}/g, ws ? ws.uri.fsPath : path.dirname(file))
      .replace(/\$\{fileDirname\}/g, path.dirname(file))
      .replace(/\$\{fileBasenameNoExtension\}/g, path.basename(file, path.extname(file)))
      .replace(/\$\{file\}/g, file);
  }

  paths(doc) {
    const dir = this.vars(this.cfg().get('build.outputDirectory', '${fileDirname}/build'), doc);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(doc.uri.fsPath, path.extname(doc.uri.fsPath));
    return { dir, obj: path.join(dir, base + '.o'), exe: path.join(dir, base + (process.platform === 'win32' ? '.exe' : '')) };
  }

  async ensureSaved(doc) {
    if (doc.uri.scheme !== 'file') {
      vscode.window.showWarningMessage('Save the file to disk first.');
      return false;
    }
    if (doc.isDirty) await doc.save();
    return true;
  }

  log(cmd, args) {
    this.out.appendLine('$ ' + [cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '));
  }

  showMessages(doc, stderr) {
    const msgs = parseAsOutput(stderr);
    const diags = msgs
      .filter((m) => path.resolve(path.dirname(doc.uri.fsPath), m.file) === doc.uri.fsPath || path.basename(m.file) === path.basename(doc.uri.fsPath))
      .map((m) => {
        const line = Math.min(m.line, doc.lineCount - 1);
        const t = doc.lineAt(line).text;
        const d = new vscode.Diagnostic(new vscode.Range(line, t.length - t.trimStart().length, line, t.length), m.message, SEV[m.severity] || SEV.error);
        d.source = 'as';
        return d;
      });
    this.buildDiagnostics.set(doc.uri, diags);
  }

  async assemble(doc) {
    if (!(await this.ensureSaved(doc))) return null;
    const cfg = this.cfg();
    const { obj } = this.paths(doc);
    const cwd = path.dirname(doc.uri.fsPath);
    const isCpp = /\.S$/.test(doc.uri.fsPath);
    const cmd = isCpp ? cfg.get('preprocessor.path', 'gcc') : cfg.get('assembler.path', 'as');
    const inc = [];
    for (const p of cfg.get('includePaths', [])) inc.push('-I', path.isAbsolute(p) ? p : path.join(cwd, p));
    const args = isCpp
      ? ['-x', 'assembler-with-cpp', ...cfg.get('preprocessor.args', []), ...inc, '-c', doc.uri.fsPath, '-o', obj]
      : [...cfg.get('assembler.args', ['--64']), ...inc, doc.uri.fsPath, '-o', obj];
    this.out.show(true);
    this.log(cmd, args);
    const res = await run(cmd, args, { cwd, timeout: 60000 });
    if (res.error) {
      this.out.appendLine(`error: could not run '${cmd}': ${res.error.message}`);
      vscode.window.showErrorMessage(`Could not run '${cmd}'. Check "gas.assembler.path".`);
      return null;
    }
    if (res.stdout) this.out.appendLine(res.stdout.trimEnd());
    if (res.stderr) this.out.appendLine(res.stderr.trimEnd());
    this.showMessages(doc, res.stderr);
    if (res.code !== 0) {
      vscode.window.showErrorMessage('Assembly failed — see the "GNU Assembler" output and Problems panel.');
      return null;
    }
    this.buildDiagnostics.delete(doc.uri);
    this.out.appendLine(`ok: ${obj}`);
    vscode.window.setStatusBarMessage(`GAS: assembled ${path.basename(obj)}`, 3000);
    return obj;
  }

  async build(doc) {
    const obj = await this.assemble(doc);
    if (!obj) return null;
    const cfg = this.cfg();
    const { exe } = this.paths(doc);
    const cmd = cfg.get('linker.path', 'ld');
    const args = [obj, ...cfg.get('linker.args', []), '-o', exe];
    this.log(cmd, args);
    const res = await run(cmd, args, { cwd: path.dirname(doc.uri.fsPath), timeout: 60000 });
    if (res.error) {
      this.out.appendLine(`error: could not run '${cmd}': ${res.error.message}`);
      vscode.window.showErrorMessage(`Could not run '${cmd}'. Check "gas.linker.path".`);
      return null;
    }
    if (res.stdout) this.out.appendLine(res.stdout.trimEnd());
    if (res.stderr) this.out.appendLine(res.stderr.trimEnd());
    if (res.code !== 0) {
      vscode.window.showErrorMessage('Linking failed — see the "GNU Assembler" output.');
      return null;
    }
    this.out.appendLine(`ok: ${exe}`);
    vscode.window.setStatusBarMessage(`GAS: built ${path.basename(exe)}`, 3000);
    return exe;
  }

  async buildAndRun(doc) {
    const exe = await this.build(doc);
    if (!exe) return;
    let term = vscode.window.terminals.find((t) => t.name === 'GAS');
    if (!term) term = vscode.window.createTerminal({ name: 'GAS', cwd: path.dirname(exe) });
    term.show(true);
    term.sendText(JSON.stringify(exe), true);
  }

  async disassemble(doc) {
    const obj = await this.assemble(doc);
    if (!obj) return;
    const cfg = this.cfg();
    const cmd = cfg.get('objdump.path', 'objdump');
    const args = [...cfg.get('objdump.args', ['-d', '-r', '-M', 'att']), obj];
    this.log(cmd, args);
    const res = await run(cmd, args, { timeout: 30000 });
    if (res.error || res.code !== 0) {
      vscode.window.showErrorMessage(`objdump failed: ${res.error ? res.error.message : res.stderr.trim()}`);
      return;
    }
    const uri = vscode.Uri.parse(`gas-disasm:/${path.basename(obj)}.disasm`);
    this.disasm.set(uri.toString(), res.stdout);
    this.disasmEmitter.fire(uri);
    const d = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(d, 'gas');
    await vscode.window.showTextDocument(d, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true, preview: true });
  }

  async lookup() {
    const items = [];
    for (const { name, entries } of allMnemonics()) {
      items.push({ label: name, description: entries[0].group, detail: entries[0].summary.replace(/\*\*/g, ''), kind: 'insn', entries });
    }
    for (const d of DIRECTIVES.values()) items.push({ label: d.name, description: d.category + ' directive', detail: d.summary, kind: 'dir', d });
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Search instructions and directives', matchOnDescription: true, matchOnDetail: true });
    if (!pick) return;
    const body = pick.kind === 'insn' ? pick.entries.flatMap((e) => [e.summary.replace(/\*\*/g, ''), ...e.forms, e.flags ? 'Flags: ' + e.flags : '']).filter(Boolean).join('\n') : `${pick.d.summary}\n${pick.d.syntax}`;
    vscode.window.showInformationMessage(pick.label, { modal: true, detail: body.replace(/`/g, '') });
  }

  async insertSyscall() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.languageId !== 'gas') return;
    const pick = await vscode.window.showQuickPick(
      TABLE.map(([num, name, sig]) => ({ label: `${num}  ${name}`, description: '', detail: sig, num, name, sig })),
      { placeHolder: 'Linux x86-64 system call', matchOnDetail: true }
    );
    if (!pick) return;
    const params = (pick.sig.match(/\(([^)]*)\)/) || [, ''])[1].split(',').map((p) => p.trim()).filter((p) => p && p !== 'void');
    const regs = ['%rdi', '%rsi', '%rdx', '%r10', '%r8', '%r9'];
    const names = params.map((p, i) => `${regs[i]}=${(p.match(/(\w+)(\[\d*\])?$/) || [, p])[1]}`);
    const line = ed.document.lineAt(ed.selection.active.line).text;
    const indent = /^\s*/.exec(line)[0] || '    ';
    const lines = [];
    if (names.length) lines.push(`# ${pick.name}(${names.join(', ')})`);
    lines.push(`mov     $${pick.num}, %eax        # sys_${pick.name}`);
    lines.push('syscall');
    const text = lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n') + '\n' + indent;
    await ed.edit((b) => b.insert(ed.selection.active, text));
  }
}

module.exports = { Commands };
