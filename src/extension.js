'use strict';
const vscode = require('vscode');
const { Store } = require('./store');
const { DiagnosticsManager } = require('./diagnosticsManager');
const { Commands } = require('./commands');
const { CompletionProvider, HoverProvider, SignatureProvider } = require('./providers/intellisense');
const nav = require('./providers/navigation');
const { FormattingProvider, CodeActionProvider } = require('./providers/editing');

const SELECTOR = [{ language: 'gas' }];

function activate(context) {
  const store = new Store();
  const diagnostics = new DiagnosticsManager(store);
  const commands = new Commands(store, diagnostics);
  commands.register(context);

  const reg = (d) => context.subscriptions.push(d);
  const L = vscode.languages;

  const completion = new CompletionProvider(store);
  reg(L.registerCompletionItemProvider(SELECTOR, completion, '%', '.', '$', '@'));
  reg(L.registerHoverProvider(SELECTOR, new HoverProvider(store)));
  reg(L.registerSignatureHelpProvider(SELECTOR, new SignatureProvider(store), ' ', ','));
  const def = new nav.DefinitionProvider(store);
  reg(L.registerDefinitionProvider(SELECTOR, def));
  reg(L.registerDeclarationProvider(SELECTOR, { provideDeclaration: (d, p) => def.provideDefinition(d, p) }));
  reg(L.registerReferenceProvider(SELECTOR, new nav.ReferenceProvider(store)));
  reg(L.registerDocumentHighlightProvider(SELECTOR, new nav.HighlightProvider(store)));
  reg(L.registerRenameProvider(SELECTOR, new nav.RenameProvider(store)));
  reg(L.registerDocumentSymbolProvider(SELECTOR, new nav.SymbolProvider(store)));
  reg(L.registerWorkspaceSymbolProvider(new nav.WorkspaceSymbolProvider(store)));
  reg(L.registerFoldingRangeProvider(SELECTOR, new nav.FoldingProvider(store)));
  reg(L.registerDocumentLinkProvider(SELECTOR, new nav.LinkProvider(store)));
  reg(L.registerDocumentSemanticTokensProvider(SELECTOR, new nav.SemanticProvider(store), nav.LEGEND));
  const fmt = new FormattingProvider(store);
  reg(L.registerDocumentFormattingEditProvider(SELECTOR, fmt));
  reg(L.registerDocumentRangeFormattingEditProvider(SELECTOR, fmt));
  reg(L.registerCodeActionsProvider(SELECTOR, new CodeActionProvider(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }));

  // ---- document lifecycle -------------------------------------------------------
  const onOpen = (doc) => {
    if (doc.languageId !== 'gas') return;
    store.get(doc);
    diagnostics.updateHeuristics(doc);
    if (diagnostics.cfg().get('lint.assembler', 'onSave') !== 'off') diagnostics.scheduleAssembler(doc, 100);
  };
  vscode.workspace.textDocuments.forEach(onOpen);
  reg(vscode.workspace.onDidOpenTextDocument(onOpen));
  reg(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const doc = e.document;
      if (doc.languageId !== 'gas') return;
      diagnostics.scheduleHeuristics(doc);
      if (diagnostics.cfg().get('lint.assembler', 'onSave') === 'onType') diagnostics.scheduleAssembler(doc, 700);
    })
  );
  reg(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId !== 'gas') return;
      diagnostics.updateHeuristics(doc);
      if (diagnostics.cfg().get('lint.assembler', 'onSave') !== 'off') diagnostics.scheduleAssembler(doc, 0);
    })
  );
  reg(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.languageId !== 'gas') return;
      store.forget(doc);
      diagnostics.clear(doc);
    })
  );
  reg(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('gas')) return;
      vscode.workspace.textDocuments.forEach((d) => {
        if (d.languageId === 'gas') {
          diagnostics.updateHeuristics(d);
          if (e.affectsConfiguration('gas.lint.assembler') || e.affectsConfiguration('gas.assembler') || e.affectsConfiguration('gas.includePaths')) diagnostics.scheduleAssembler(d, 100);
        }
      });
      if (e.affectsConfiguration('gas.workspace')) store.reindex();
    })
  );

  // ---- workspace index ------------------------------------------------------------
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length) {
    store.indexWorkspace().then(() => {
      vscode.workspace.textDocuments.forEach((d) => d.languageId === 'gas' && diagnostics.scheduleHeuristics(d, 50));
    });
    store.startWatching();
  }
  reg({ dispose: () => store.dispose() });
  reg({ dispose: () => diagnostics.dispose() });
}

function deactivate() {}

module.exports = { activate, deactivate };
