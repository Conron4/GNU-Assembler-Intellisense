'use strict';
const vscode = require('vscode');
const { formatDocument } = require('../formatter');

class FormattingProvider {
  constructor(store) {
    this.store = store;
  }

  options() {
    const c = this.store.config();
    return {
      useTabs: c.get('format.useTabs', false),
      indentSize: c.get('format.indentSize', 4),
      mnemonicWidth: c.get('format.mnemonicWidth', 8),
      commentColumn: c.get('format.commentColumn', 40),
      indentDirectives: c.get('format.indentDirectives', true),
      mnemonicCase: c.get('format.mnemonicCase', 'preserve')
    };
  }

  edits(doc, range) {
    const R = this.store.get(doc);
    const r = range ? { start: range.start.line, end: range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line } : undefined;
    return formatDocument(R, this.options(), r).map((e) => vscode.TextEdit.replace(doc.lineAt(e.line).range, e.text));
  }

  provideDocumentFormattingEdits(doc) {
    return this.edits(doc);
  }

  provideDocumentRangeFormattingEdits(doc, range) {
    return this.edits(doc, range);
  }
}

class CodeActionProvider {
  provideCodeActions(doc, range, context) {
    const actions = [];
    for (const d of context.diagnostics) {
      if (d.source !== 'gas') continue;
      const code = typeof d.code === 'object' && d.code ? String(d.code.value) : String(d.code || '');
      const make = (title, fn) => {
        const a = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        a.diagnostics = [d];
        a.edit = new vscode.WorkspaceEdit();
        fn(a.edit);
        actions.push(a);
        return a;
      };
      if (code === 'gas.bare-register') {
        make("Add '%' register prefix", (e) => e.insert(doc.uri, d.range.start, '%')).isPreferred = true;
      } else if (code === 'gas.bare-number') {
        make("Add '$' to make it an immediate", (e) => e.insert(doc.uri, d.range.start, '$')).isPreferred = true;
      } else if (code === 'gas.ambiguous-size') {
        const mn = doc.getText(d.range);
        for (const s of ['q', 'l', 'w', 'b']) make(`Use '${mn}${s}'`, (e) => e.insert(doc.uri, d.range.end, s));
      } else if (code.startsWith('gas.size-mismatch:')) {
        const s = code.split(':')[1];
        if (s) {
          const mn = doc.getText(d.range);
          const fixed = mn.slice(0, -1) + s;
          make(`Change to '${fixed}'`, (e) => e.replace(doc.uri, d.range, fixed)).isPreferred = true;
        }
      }
    }
    return actions;
  }
}

module.exports = { FormattingProvider, CodeActionProvider };
