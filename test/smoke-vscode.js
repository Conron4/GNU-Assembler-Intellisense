'use strict';
// Smoke test: load the extension against a stub `vscode` module and exercise the providers.
const Module = require('module');
const fs = require('fs');
const path = require('path');

class Generic { constructor(...a) { this.args = a; } }
const named = (n) => ({ [n]: class extends Generic {} })[n];
class Range { constructor(a, b, c, d) { if (typeof a === 'object') { this.start = a; this.end = b; } else { this.start = { line: a, character: b }; this.end = { line: c, character: d }; } } }
class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind; } }
class MarkdownString { constructor(v) { this.value = v; } }
class Hover { constructor(c, r) { this.contents = c; this.range = r; } }
class Diagnostic { constructor(r, m, s) { this.range = r; this.message = m; this.severity = s; } }
class DocumentSymbol { constructor(n, d, k, r, s) { Object.assign(this, { name: n, detail: d, kind: k, range: r, selectionRange: s, children: [] }); } }
class SemanticTokensBuilder { constructor() { this.t = []; } push(...a) { this.t.push(a); } build() { return this.t; } }
const registered = {};
const reg = (name) => (...a) => { registered[name] = a; return { dispose() {} }; };
const config = { get: (k, d) => d };
const vscode = new Proxy({
  Range, CompletionItem, MarkdownString, Hover, Diagnostic, DocumentSymbol, SemanticTokensBuilder,
  Position: class { constructor(l, c) { this.line = l; this.character = c; } },
  SemanticTokensLegend: Generic,
  TextEdit: { replace: (r, t) => ({ range: r, newText: t }) },
  WorkspaceEdit: class { constructor() { this.edits = []; } replace(u, r, t) { this.edits.push([u, r, t]); } insert(u, p, t) { this.edits.push([u, p, t]); } },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  CompletionItemKind: new Proxy({}, { get: (_, k) => k }),
  SymbolKind: new Proxy({}, { get: (_, k) => k }),
  FoldingRangeKind: { Comment: 1, Region: 3 },
  DocumentHighlightKind: { Read: 1, Write: 2 },
  CodeActionKind: { QuickFix: 'quickfix' },
  ProgressLocation: { Window: 10 }, ViewColumn: { Beside: -2 },
  EventEmitter: class { constructor() { this.event = () => {}; } fire() {} },
  Uri: { file: (p) => ({ fsPath: p, scheme: 'file', toString: () => 'file://' + p }), parse: (s) => ({ toString: () => s }) },
  languages: new Proxy({ createDiagnosticCollection: () => ({ set() {}, delete() {}, dispose() {} }) }, { get: (t, k) => t[k] || reg(k) }),
  window: { createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }), showInformationMessage() {}, setStatusBarMessage() {}, terminals: [] },
  workspace: {
    textDocuments: [], workspaceFolders: undefined, getConfiguration: () => config,
    onDidOpenTextDocument: reg('o1'), onDidChangeTextDocument: reg('o2'), onDidSaveTextDocument: reg('o3'),
    onDidCloseTextDocument: reg('o4'), onDidChangeConfiguration: reg('o5'),
    registerTextDocumentContentProvider: reg('tdcp'), getWorkspaceFolder: () => undefined
  },
  commands: { registerCommand: reg('cmd') }
}, { get: (t, k) => (k in t ? t[k] : named(String(k))) });

const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : origLoad.call(this, req, ...rest); };

const ext = require('../src/extension');
ext.activate({ subscriptions: [] });

let docId = 0;
function makeDoc(text) {
  const id = ++docId;
  const lines = text.split('\n');
  return {
    languageId: 'gas', version: 1, lineCount: lines.length, isDirty: false,
    uri: { scheme: 'file', fsPath: `/tmp/t${id}.s`, toString: () => `file:///tmp/t${id}.s` },
    getText: (r) => (r ? lines[r.start.line].slice(r.start.character, r.end.character) : text),
    lineAt: (n) => ({ text: lines[n], range: new Range(n, 0, n, lines[n].length) })
  };
}
const doc = makeDoc(fs.readFileSync(path.join(__dirname, 'fixtures', 'hello.s'), 'utf8'));
const P = (l, c) => ({ line: l, character: c });
let ok = 0;
const check = (name, cond) => { if (!cond) { console.error('FAIL', name); process.exitCode = 1; } else { ok++; console.log('  ok  ' + name); } };

const [, completion] = registered.registerCompletionItemProvider;
const hover = registered.registerHoverProvider[1];
const sig = registered.registerSignatureHelpProvider[1];
const defp = registered.registerDefinitionProvider[1];
const sym = registered.registerDocumentSymbolProvider[1];
const fold = registered.registerFoldingRangeProvider[1];
const sem = registered.registerDocumentSemanticTokensProvider[1];
const fmtp = registered.registerDocumentFormattingEditProvider[1];
const refp = registered.registerReferenceProvider[1];
const ren = registered.registerRenameProvider[1];

const doc2 = makeDoc('  mov %r\n  mov $1, (%\n  .sec\n  .section \n  jmp l\nloop: nop\n  syscall');
check('completion: registers after %', completion.provideCompletionItems(doc2, P(0, 8)).some((i) => i.label === '%rax'));
check('completion: registers in memory operand', completion.provideCompletionItems(doc2, P(1, 12)).some((i) => i.label === '%rbx'));
check('completion: directives', completion.provideCompletionItems(doc2, P(2, 6)).some((i) => i.label === '.section'));
check('completion: section names', completion.provideCompletionItems(doc2, P(3, 11)).some((i) => i.label === '.rodata'));
check('completion: mnemonics at line start', completion.provideCompletionItems(makeDoc('  mo'), P(0, 4)).some((i) => i.label === 'mov'));
check('completion: label symbols for jmp', completion.provideCompletionItems(doc2, P(4, 7)).some((i) => i.label === 'loop'));
check('completion: resolve docs', !!completion.resolveCompletionItem(completion.provideCompletionItems(makeDoc('  mo'), P(0, 4)).find((i) => i.label === 'mov')).documentation);

const L = (s) => doc.getText().split('\n').findIndex((x) => x.includes(s));
let h = hover.provideHover(doc, P(L("lea msg"), 5)); console.log("DEBUG", L("lea msg"), h);
check('hover: instruction', /Move|Load effective/.test(h.contents.value));
h = hover.provideHover(doc, P(L('lea msg'), 22));
check('hover: register', /rsi/.test(h.contents.value));
h = hover.provideHover(doc, P(L('lea msg'), 11));
check('hover: symbol definition', /msg/.test(h.contents.value));
const sysLine = L('syscall');
h = hover.provideHover(doc, P(sysLine, 6));
check('hover: syscall inference (write)', /write/.test(h.contents.value));
h = hover.provideHover(doc, P(L('mov $60'), 10));
check('hover: number in mov $60,%eax names exit', /exit/.test(h.contents.value));
h = hover.provideHover(doc, P(L('jnz 1b'), 9));
check('hover: local label ref', /Local label/.test(h.contents.value));
check('hover: directive', /globl/.test(hover.provideHover(doc, P(L('.globl'), 6)).contents.value));

check('signature help', sig.provideSignatureHelp(makeDoc('  mov $1, '), P(0, 10)).activeParameter === 1);
const d = defp.provideDefinition(doc, P(L('lea msg'), 11));
check('definition: msg', d.length === 1 && d[0].args[1].start.line === 4);
check('definition: 1b', defp.provideDefinition(doc, P(L('jnz 1b'), 9)).args[1].start.line === L('1:  dec'));
const syms = sym.provideDocumentSymbols(doc);
check('document symbols', syms.length >= 2 && syms.some((s) => s.children.some((c) => c.name === '_start')));
check('folding', fold.provideFoldingRanges(doc).length > 0);
check('semantic tokens', sem.provideDocumentSemanticTokens(doc).length > 5);
check('formatting', Array.isArray(fmtp.provideDocumentFormattingEdits(doc)));
check('references', refp.provideReferences(doc, P(L('lea msg'), 11), { includeDeclaration: true }).length >= 2);
const edit = ren.provideRenameEdits(doc, P(L('lea msg'), 11), 'message');
check('rename edit created', edit.edits.length >= 2);
console.log(`\n${ok} smoke checks passed`);
