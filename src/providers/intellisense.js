'use strict';
const vscode = require('vscode');
const path = require('path');
const { tokenAt, resolveLocalRef } = require('../parser');
const { cursorContext } = require('../context');
const { allRegisters, registerMarkdown } = require('../data/registers');
const { allMnemonics, lookupInstruction, instructionMarkdown, isBranch } = require('../data/instructions');
const {
  DIRECTIVES, getDirective, directiveMarkdown, SECTION_NAMES, SECTION_FLAGS, SECTION_TYPES, SYMBOL_TYPES, RELOCATIONS
} = require('../data/directives');
const { syscallMarkdown, syscallByNumber } = require('../data/syscalls');
const { classifyLabel } = require('../symbols');
const { numberMarkdown, evalConst, inferSyscall, docCommentAbove, parseInteger } = require('../util');

const md = (text) => {
  const m = new vscode.MarkdownString(text);
  m.isTrusted = false;
  return m;
};

const GROUP_ORDER = { gpr: '0', ip: '1', segment: '2', vector: '3', fpu: '4', mmx: '5', mask: '6', system: '7' };
const SYMBOL_DIRECTIVES = new Set(['.globl', '.global', '.weak', '.hidden', '.protected', '.internal', '.local', '.extern', '.size', '.type', '.symver', '.comm', '.lcomm']);

function inBlockComment(R, line) {
  return R.blockComments.some((c) => line > c.startLine && line <= c.endLine);
}

// ---------------------------------------------------------------------------
// completion
// ---------------------------------------------------------------------------

class CompletionProvider {
  constructor(store) {
    this.store = store;
    this.mnemonicItems = null;
    this.directiveItems = null;
    this.registerItems = null;
  }

  buildStatic() {
    if (this.mnemonicItems) return;
    this.mnemonicItems = allMnemonics().map(({ name, entries }) => {
      const it = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
      it.detail = entries[0].group;
      it.sortText = '1_' + name;
      it.data = { type: 'mnemonic', name };
      return it;
    });
    this.directiveItems = Array.from(DIRECTIVES.values()).map((d) => {
      const it = new vscode.CompletionItem(d.name, vscode.CompletionItemKind.Keyword);
      it.detail = d.category + ' directive';
      it.sortText = '2_' + d.name;
      it.data = { type: 'directive', name: d.name };
      return it;
    });
    this.registerItems = allRegisters().map((r) => {
      const it = new vscode.CompletionItem('%' + r.name, vscode.CompletionItemKind.Variable);
      it.detail = `${r.bits}-bit ${r.group}`;
      it.filterText = '%' + r.name;
      it.sortText = (GROUP_ORDER[r.group] || '9') + '_' + String(r.bits === 64 ? 0 : r.bits === 32 ? 1 : r.bits === 16 ? 2 : 3) + r.name;
      it.data = { type: 'register', name: r.name };
      return it;
    });
  }

  resolveCompletionItem(item) {
    const d = item.data;
    if (!d) return item;
    if (d.type === 'mnemonic') item.documentation = md(instructionMarkdown(lookupInstruction(d.name)));
    else if (d.type === 'directive') item.documentation = md(directiveMarkdown(getDirective(d.name)));
    else if (d.type === 'register') item.documentation = md(registerMarkdown(d.name));
    return item;
  }

  withRange(items, range) {
    return items.map((it) => {
      const c = new vscode.CompletionItem(it.label, it.kind);
      Object.assign(c, it);
      c.range = range;
      return c;
    });
  }

  symbolItems(doc, R, { branch, onlyCode, prefixSkip }) {
    const items = [];
    const seen = new Set();
    const add = (name, def, parsed, fromWorkspace) => {
      if (seen.has(name)) return;
      seen.add(name);
      let kind = vscode.CompletionItemKind.Reference;
      let detail = '';
      if (def.kind === 'label') {
        const c = classifyLabel(parsed, def);
        kind = c === 'function' ? vscode.CompletionItemKind.Function : c === 'data' ? vscode.CompletionItemKind.Variable : vscode.CompletionItemKind.Field;
        detail = c === 'function' ? 'function' : c === 'data' ? 'data' : 'label';
        if (onlyCode && c === 'data') return;
      } else if (def.kind === 'macro') return;
      else if (def.kind === 'data') { kind = vscode.CompletionItemKind.Variable; detail = 'data'; }
      else { kind = vscode.CompletionItemKind.Constant; detail = def.value ? `= ${def.value}` : 'constant'; if (onlyCode) return; }
      const it = new vscode.CompletionItem(name, kind);
      it.detail = fromWorkspace ? `${detail} (workspace)` : detail;
      const isCode = def.kind === 'label' && classifyLabel(parsed, def) !== 'data';
      it.sortText = (branch ? (isCode ? '0_' : '1_') : (isCode ? '1_' : '0_')) + name;
      const doc2 = docCommentAbove(parsed, def.line);
      if (doc2) it.documentation = md(doc2);
      items.push(it);
    };
    for (const d of R.defs) {
      if (d.numeric || d.inMacro) continue;
      add(d.name, d, R, false);
    }
    for (const f of this.store.allFiles()) {
      if (f.uri.toString() === doc.uri.toString()) continue;
      for (const d of f.parsed.defs) {
        if (d.numeric || d.inMacro || d.local || (d.kind === 'label' && /^\.L/.test(d.name))) continue;
        add(d.name, d, f.parsed, true);
      }
    }
    return items;
  }

  provideCompletionItems(doc, pos) {
    this.buildStatic();
    const R = this.store.get(doc);
    if (inBlockComment(R, pos.line) || (R.lines[pos.line] && R.lines[pos.line].pp)) return undefined;
    const text = doc.lineAt(pos.line).text;
    const ctx = cursorContext(text, pos.character);
    if (ctx.kind === 'none') return undefined;
    const range = new vscode.Range(pos.line, ctx.start === undefined ? pos.character : ctx.start, pos.line, pos.character);

    if (ctx.kind === 'mnemonic') {
      const items = this.withRange(this.mnemonicItems, range);
      for (const [name, m] of this.store.allMacros(R)) {
        const it = new vscode.CompletionItem(name, vscode.CompletionItemKind.Method);
        it.detail = `macro ${m.paramText || ''}`.trim();
        it.sortText = '0_' + name;
        it.range = range;
        items.push(it);
      }
      for (const [name, d] of R.defines) {
        if (!d.params) continue;
        const it = new vscode.CompletionItem(name, vscode.CompletionItemKind.Method);
        it.detail = `#define ${name}${d.params}`;
        it.sortText = '0_' + name;
        it.range = range;
        items.push(it);
      }
      return items;
    }
    if (ctx.kind === 'directive') return this.withRange(this.directiveItems, range);

    // ---- operands ----------------------------------------------------------
    const mn = ctx.mnemonic.toLowerCase();
    const idx = ctx.operandIndex;

    if (mn[0] === '.') {
      if (mn === '.section' || mn === '.pushsection') {
        if (idx === 0) {
          return SECTION_NAMES.map(([n, d]) => {
            const it = new vscode.CompletionItem(n, vscode.CompletionItemKind.Module);
            it.detail = d;
            it.range = range;
            return it;
          });
        }
        if (idx === 1) {
          const q = /"[A-Za-z]*$/.exec(text.slice(0, pos.character));
          const r = new vscode.Range(pos.line, q ? pos.character - q[0].length : pos.character, pos.line, pos.character);
          return SECTION_FLAGS.map(([f, d]) => {
            const it = new vscode.CompletionItem(f, vscode.CompletionItemKind.EnumMember);
            it.detail = d;
            it.range = r;
            return it;
          });
        }
        if (idx >= 2) return SECTION_TYPES.map((t) => Object.assign(new vscode.CompletionItem(t, vscode.CompletionItemKind.EnumMember), { range }));
      }
      if (mn === '.type' && idx === 1) {
        return SYMBOL_TYPES.map((t) => Object.assign(new vscode.CompletionItem(t, vscode.CompletionItemKind.EnumMember), { range }));
      }
      if (mn === '.intel_syntax' || mn === '.att_syntax') {
        return ['noprefix', 'prefix'].map((t) => Object.assign(new vscode.CompletionItem(t, vscode.CompletionItemKind.EnumMember), { range }));
      }
      if (ctx.wordKind === 'reloc') return this.relocItems(range);
      if (SYMBOL_DIRECTIVES.has(mn) || ctx.wordKind === 'symbol' || ctx.wordKind === 'empty') {
        return this.symbolItems(doc, R, { branch: false }).map((i) => Object.assign(i, { range }));
      }
      return undefined;
    }

    if (ctx.wordKind === 'register' || (ctx.wordKind === 'empty' && ctx.inMem)) {
      const rr = ctx.wordKind === 'register' ? range : new vscode.Range(pos, pos);
      return this.withRange(this.registerItems, rr);
    }
    if (ctx.wordKind === 'reloc') return this.relocItems(range);

    const branch = isBranch(mn);
    let items;
    if (ctx.wordKind === 'immediate') {
      const r2 = new vscode.Range(pos.line, range.start.character + 1, pos.line, pos.character);
      items = this.symbolItems(doc, R, { branch: false }).map((i) => Object.assign(i, { range: r2 }));
      return items;
    }
    items = this.symbolItems(doc, R, { branch }).map((i) => Object.assign(i, { range }));
    if (ctx.wordKind === 'empty') {
      // offer registers too, after the symbols (they insert with '%')
      items.push(...this.withRange(this.registerItems, new vscode.Range(pos, pos)).map((r) => Object.assign(r, { sortText: '9_' + r.sortText })));
    }
    return items;
  }

  relocItems(range) {
    return RELOCATIONS.map(([n, d]) => {
      const it = new vscode.CompletionItem(n, vscode.CompletionItemKind.Keyword);
      it.detail = d;
      it.range = range;
      return it;
    });
  }
}

// ---------------------------------------------------------------------------
// hover
// ---------------------------------------------------------------------------

class HoverProvider {
  constructor(store) {
    this.store = store;
  }

  provideHover(doc, pos) {
    const R = this.store.get(doc);
    const t = tokenAt(R, pos.line, pos.character);
    if (!t) return undefined;
    const range = new vscode.Range(pos.line, t.col, pos.line, t.end);
    const showSys = this.store.config().get('hover.showSyscalls', true);
    const wrap = (text) => new vscode.Hover(md(text), range);

    switch (t.type) {
      case 'mnemonic':
      case 'prefix': {
        const entries = lookupInstruction(t.name);
        if (!entries.length) return undefined;
        let text = instructionMarkdown(entries, t.name);
        if (t.name.toLowerCase() === 'syscall' && showSys && t.stmt) {
          const inf = inferSyscall(R, pos.line, t.stmt.start);
          if (inf && inf.sc) text += `\n\n---\n\n${syscallMarkdown(inf.sc)}`;
          else if (inf) text += `\n\n---\n\nSyscall number ${inf.number} (not in the built-in table).`;
        }
        return wrap(text);
      }
      case 'directive': {
        const d = getDirective(t.name);
        return d ? wrap(directiveMarkdown(d)) : undefined;
      }
      case 'register': {
        const text = registerMarkdown(t.name);
        return text ? wrap(text) : undefined;
      }
      case 'reloc': {
        const r = RELOCATIONS.find(([n]) => n.toLowerCase() === '@' + t.name.toLowerCase());
        return r ? wrap(`**${r[0]}** — ${r[1]}`) : undefined;
      }
      case 'number': {
        const bare = R.lines[pos.line].bare;
        const neg = bare[t.col - 1] === '-' && !/[\w)\]]/.test(bare[t.col - 2] || '');
        const text0 = numberMarkdown(t.text, neg);
        let text = text0;
        if (!text) return undefined;
        // `mov $N, %eax` immediately before a syscall: name the syscall
        if (showSys && t.stmt && /^mov[lqw]?$/i.test(t.stmt.mnemonic) && t.dollar && t.stmt.operands.length === 2 && /^%(rax|eax|ax)$/i.test(t.stmt.operands[1].text.trim())) {
          const v = parseInteger(t.text);
          const sc = v !== null ? syscallByNumber(Number(v)) : null;
          if (sc) text += `\n\nIf this feeds a \`syscall\`: **${sc.name}** — \`${sc.signature}\``;
        }
        return wrap(text);
      }
      case 'local-ref': {
        const def = resolveLocalRef(R, { name: t.name, line: pos.line, col: t.col });
        if (!def) return wrap(`No matching local label \`${t.name.slice(0, -1)}:\` ${/f/i.test(t.name.slice(-1)) ? 'after' : 'before'} this point.`);
        return wrap(`Local label \`${def.name}:\` on line ${def.line + 1}\n\n\`\`\`gas\n${R.lines[def.line].text.trim()}\n\`\`\``);
      }
      case 'symbol':
      case 'label':
      case 'macro-call': {
        const found = this.store.findDefs(t.name, doc, R);
        if (!found.length) {
          if (t.type === 'macro-call') return undefined;
          return undefined;
        }
        const parts = found.slice(0, 3).map((f) => this.describeDef(f, doc));
        return wrap(parts.join('\n\n---\n\n'));
      }
      default:
        return undefined;
    }
  }

  describeDef({ uri, def, parsed }, doc) {
    const here = uri.toString() === doc.uri.toString();
    const where = here ? `line ${def.line + 1}` : `${path.basename(uri.fsPath)}:${def.line + 1}`;
    const lineText = parsed.lines[def.line] ? parsed.lines[def.line].text.trim() : '';
    let title;
    let extra = '';
    switch (def.kind) {
      case 'label': {
        const c = classifyLabel(parsed, def);
        const vis = parsed.globals.has(def.name) ? 'global ' : parsed.weaks.has(def.name) ? 'weak ' : '';
        title = `${vis}${c === 'function' ? 'function' : c === 'data' ? 'data label' : 'label'} **${def.name}**`;
        extra = ` in \`${def.section}\``;
        break;
      }
      case 'macro':
        title = `macro **${def.name}**`;
        return `${title} — ${where}\n\n\`\`\`gas\n.macro ${def.name} ${def.paramText}\n\`\`\`${this.docBlock(parsed, def)}`;
      case 'define':
        title = `#define **${def.name}**`;
        return `${title} — ${where}\n\n\`\`\`c\n#define ${def.name}${def.params} ${def.value}\n\`\`\`${this.docBlock(parsed, def)}`;
      case 'data':
        title = `common symbol **${def.name}**`;
        break;
      default: {
        title = `constant **${def.name}**`;
        const v = evalConst(parsed, def.value || '');
        if (v !== null) extra = ` = \`${v}\` (\`0x${BigInt.asUintN(64, v).toString(16)}\`)`;
        else if (def.value) extra = ` = \`${def.value}\``;
      }
    }
    return `${title}${extra} — ${where}\n\n\`\`\`gas\n${lineText}\n\`\`\`${this.docBlock(parsed, def)}`;
  }

  docBlock(parsed, def) {
    const d = docCommentAbove(parsed, def.line);
    return d ? `\n\n${d}` : '';
  }
}

// ---------------------------------------------------------------------------
// signature help
// ---------------------------------------------------------------------------

class SignatureProvider {
  constructor(store) {
    this.store = store;
  }

  provideSignatureHelp(doc, pos) {
    const text = doc.lineAt(pos.line).text;
    const ctx = cursorContext(text, pos.character);
    if (ctx.kind !== 'operand' || ctx.mnemonic[0] === '.') return undefined;
    const entries = lookupInstruction(ctx.mnemonic);
    if (!entries.length) return undefined;

    const sigs = [];
    for (const e of entries) {
      for (const form of e.forms) {
        const operandsPart = form.replace(/^\S+\s*/, '').replace(/\s+#.*$/, '');
        const params = splitTop(operandsPart).map((p) => new vscode.ParameterInformation(p));
        const label = form.replace(/\s+#.*$/, '');
        const sig = new vscode.SignatureInformation(label, md(e.summary));
        // parameter labels must be substrings of the label
        sig.parameters = params.filter((p) => label.includes(p.label));
        sigs.push({ sig, count: params.length });
      }
    }
    if (!sigs.length) return undefined;
    const help = new vscode.SignatureHelp();
    help.signatures = sigs.map((s) => s.sig);
    let active = sigs.findIndex((s) => s.count > ctx.operandIndex);
    if (active < 0) active = 0;
    help.activeSignature = active;
    help.activeParameter = ctx.operandIndex;
    return help;
  }
}

function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(' || c === '{') depth++;
    if (c === ')' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

module.exports = { CompletionProvider, HoverProvider, SignatureProvider };
