#!/usr/bin/env node
'use strict';
/**
 * Generates syntaxes/gas.tmLanguage.json.
 * The grammar is generated (rather than hand-written) so that the big
 * alternations stay readable and consistent.  Run:  node scripts/gen-grammar.js
 */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- helpers
// start of a statement: line start, after ';', or after a label colon (but not after a '%fs:'-style segment override)
const STMT_START = '(?:^|(?<=[;:]))(?<!(?i:%[c-gs]s):)[ \\t]*';

const GPR =
  'r(?:ax|bx|cx|dx|si|di|bp|sp|ip)|e(?:ax|bx|cx|dx|si|di|bp|sp|ip)|[a-d]x|[sd]i|[sb]p|[a-d][lh]|[sd]il|[sb]pl|r(?:[89]|1[0-5])[dwbl]?';
const SEG = '[c-gs]s';
const FPU = 'st(?:\\([0-7]\\))?|mm[0-7]';
const VEC = '[xyz]mm(?:[0-9]|[12][0-9]|3[01])|k[0-7]|tmm[0-7]';
const SYS = 'cr(?:[0-9]|1[0-5])|dr(?:[0-9]|1[0-5])|tr[0-7]|bnd[0-3]|eiz|riz';

const PREFIXES =
  'lock|rep|repe|repz|repne|repnz|bnd|notrack|xacquire|xrelease|data16|data32|addr32|addr16|rex(?:\\.[wrxb]+)?|vex[23]?|evex|\\{[a-z0-9]+\\}';

const CONTROL_DIRECTIVES =
  'macro|endm|exitm|purgem|if(?:n?def|notdef|n?b|n?c|eq|ne|ge|gt|le|lt|eqs|nes)?|else(?:if)?|endif|rept|irpc?|endr|include|incbin|(?:no)?altmacro|err(?:or)?|warning|print|fail|abort';
const DATA_DIRECTIVES =
  'byte|word|short|value|hword|int|long|quad|octa|[248]byte|float|single|double|ascii|asciz|string(?:8|16|32|64)?|zero|space|skip|fill|sleb128|uleb128|nops?';
const SECTION_DIRECTIVES = 'text|data|bss|popsection|previous|subsection|org';
const CFI_DIRECTIVES = 'cfi_[a-z_]+';

// mnemonics that alter control flow / enter the kernel
const CONTROL_MNEMONICS =
  '(?:j(?:mp|[a-z]{1,3})|call|ret|lret|iret|loop(?:n?[ez])?|syscall|sysret|sysenter|sysexit|int[o3]?|leave|enter|hlt|ud[012]|xbegin|xend|xabort|lcall|ljmp)[bwlq]?';

const reg = (names) => `(?i)(%)(${names})(?![\\w$])`;

// ---------------------------------------------------------------- repository
const repository = {
  comments: {
    patterns: [
      {
        name: 'comment.block.gas',
        begin: '/\\*',
        end: '\\*/',
        beginCaptures: { 0: { name: 'punctuation.definition.comment.begin.gas' } },
        endCaptures: { 0: { name: 'punctuation.definition.comment.end.gas' } }
      },
      {
        name: 'comment.line.number-sign.gas',
        match: '(#).*$',
        captures: { 1: { name: 'punctuation.definition.comment.gas' } }
      }
    ]
  },

  preprocessor: {
    name: 'meta.preprocessor.gas',
    begin: '^\\s*(#)(include|include_next|define|undef|ifdef|ifndef|if|elif|else|endif|error|warning|pragma|line)\\b',
    end: '(?<!\\\\)$',
    beginCaptures: {
      1: { name: 'punctuation.definition.directive.gas' },
      2: { name: 'keyword.control.directive.preprocessor.gas' }
    },
    patterns: [
      { match: '(\\\\)$', name: 'constant.character.escape.line-continuation.gas' },
      { name: 'comment.block.gas', begin: '/\\*', end: '\\*/' },
      { name: 'string.quoted.other.lt-gt.include.gas', match: '<[^>\\s]*>' },
      { include: '#strings' },
      { include: '#numbers' },
      { name: 'entity.name.function.preprocessor.gas', match: '(?<=define\\s)\\s*[A-Za-z_]\\w*' },
      { name: 'variable.other.symbol.gas', match: '[A-Za-z_]\\w*' },
      { name: 'keyword.operator.gas', match: '[-+*/%<>=!&|^~?:]+' }
    ]
  },

  strings: {
    patterns: [
      {
        name: 'string.quoted.double.gas',
        begin: '"',
        end: '"|$',
        beginCaptures: { 0: { name: 'punctuation.definition.string.begin.gas' } },
        endCaptures: { 0: { name: 'punctuation.definition.string.end.gas' } },
        patterns: [
          {
            name: 'constant.character.escape.gas',
            match: '\\\\(?:[0-7]{1,3}|x[0-9A-Fa-f]+|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)'
          }
        ]
      },
      {
        name: 'constant.character.gas',
        match: "'(?:\\\\(?:[0-7]{1,3}|x[0-9A-Fa-f]+|.)|[^\\\\])'?"
      }
    ]
  },

  numbers: {
    patterns: [
      { name: 'constant.numeric.hex.gas', match: '(?i)\\b0x[0-9a-f]+(?:\\.[0-9a-f]*(?:p[+-]?\\d+)?)?\\b' },
      { name: 'constant.numeric.binary.gas', match: '(?i)\\b0b[01]+\\b' },
      { name: 'entity.name.label.reference.gas', match: '(?i)\\b\\d+[fb]\\b' },
      { name: 'constant.numeric.float.gas', match: '(?i)\\b(?:\\d+\\.\\d*|\\.\\d+)(?:e[+-]?\\d+)?\\b|\\b\\d+e[+-]?\\d+\\b|\\b0[fdeFDE][+-]?\\d*\\.?\\d+(?:e[+-]?\\d+)?\\b' },
      { name: 'constant.numeric.octal.gas', match: '\\b0[0-7]+\\b' },
      { name: 'constant.numeric.decimal.gas', match: '\\b\\d+\\b' }
    ]
  },

  'label-def': {
    patterns: [
      {
        match: `${STMT_START}(\\.L[\\w.$]*)(:)`,
        captures: {
          1: { name: 'entity.name.label.local.gas' },
          2: { name: 'punctuation.separator.label.gas' }
        }
      },
      {
        match: `${STMT_START}(\\d+)(:)`,
        captures: {
          1: { name: 'entity.name.label.numeric.gas' },
          2: { name: 'punctuation.separator.label.gas' }
        }
      },
      {
        match: `${STMT_START}([A-Za-z_.][\\w.$]*)(:)`,
        captures: {
          1: { name: 'entity.name.function.label.gas' },
          2: { name: 'punctuation.separator.label.gas' }
        }
      }
    ]
  },

  assignment: {
    match: `^[ \\t]*([A-Za-z_.][\\w.$]*)[ \\t]*(=)(?!=)`,
    captures: {
      1: { name: 'entity.name.constant.gas' },
      2: { name: 'keyword.operator.assignment.gas' }
    }
  },

  directives: {
    patterns: [
      {
        match: `(?i)${STMT_START}(\\.(?:section|pushsection))\\b(?:[ \\t]+([^\\s,"#;]+))?`,
        captures: {
          1: { name: 'keyword.control.section.gas' },
          2: { name: 'entity.name.section.gas' }
        }
      },
      {
        match: `(?i)${STMT_START}(\\.(?:${SECTION_DIRECTIVES})(?![\\w.]))`,
        captures: { 1: { name: 'keyword.control.section.gas' } }
      },
      {
        match: `(?i)${STMT_START}(\\.(?:${CONTROL_DIRECTIVES})(?![\\w.]))`,
        captures: { 1: { name: 'keyword.control.directive.gas' } }
      },
      {
        match: `(?i)${STMT_START}(\\.(?:${DATA_DIRECTIVES})(?![\\w.]))`,
        captures: { 1: { name: 'storage.type.directive.gas' } }
      },
      {
        match: `(?i)${STMT_START}(\\.(?:${CFI_DIRECTIVES}))(?![\\w.])`,
        captures: { 1: { name: 'keyword.other.directive.cfi.gas' } }
      },
      {
        match: `${STMT_START}(\\.[A-Za-z_][\\w.]*)`,
        captures: { 1: { name: 'keyword.other.directive.gas' } }
      }
    ]
  },

  instructions: {
    patterns: [
      {
        match: `(?i)${STMT_START}(?:\\b(${PREFIXES})(?![\\w.])[ \\t]+)?(${CONTROL_MNEMONICS})(?![\\w.$])`,
        captures: {
          1: { name: 'storage.modifier.prefix.gas' },
          2: { name: 'keyword.control.flow.gas' }
        }
      },
      {
        match: `(?i)${STMT_START}(?:\\b(${PREFIXES})(?![\\w.])[ \\t]+)?([A-Za-z_]\\w*)(?![\\w.$:])`,
        captures: {
          1: { name: 'storage.modifier.prefix.gas' },
          2: { name: 'support.function.mnemonic.gas' }
        }
      }
    ]
  },

  'att-registers': {
    patterns: [
      { match: reg(GPR), name: 'variable.parameter.register.gpr.gas', captures: { 1: { name: 'punctuation.definition.register.gas' } } },
      { match: reg(VEC), name: 'variable.parameter.register.vector.gas', captures: { 1: { name: 'punctuation.definition.register.gas' } } },
      { match: reg(SEG), name: 'variable.parameter.register.segment.gas', captures: { 1: { name: 'punctuation.definition.register.gas' } } },
      { match: reg(FPU), name: 'variable.parameter.register.fpu.gas', captures: { 1: { name: 'punctuation.definition.register.gas' } } },
      { match: reg(SYS), name: 'variable.parameter.register.system.gas', captures: { 1: { name: 'punctuation.definition.register.gas' } } }
    ]
  },

  operands: {
    patterns: [
      { name: 'variable.parameter.macro.gas', match: '\\\\(?:[A-Za-z_]\\w*|@|\\(\\))' },
      { include: '#att-registers' },
      { name: 'punctuation.definition.immediate.gas', match: '\\$' },
      {
        name: 'storage.type.symbol-type.gas',
        match: '(?i)[@%](function|object|tls_object|notype|common|gnu_indirect_function|gnu_unique_object|progbits|nobits|note|init_array|fini_array|preinit_array)\\b'
      },
      { name: 'keyword.other.relocation.gas', match: '@[A-Za-z_]\\w*' },
      { include: '#numbers' },
      { name: 'constant.language.location-counter.gas', match: '(?<![\\w.$])\\.(?![\\w.$])' },
      { name: 'entity.name.label.local-ref.gas', match: '(?<![\\w.$%@\\\\])\\.L[\\w.$]*' },
      { name: 'variable.other.symbol.gas', match: '(?<![\\w.$%@\\\\])[A-Za-z_.][\\w.$]*' },
      { name: 'punctuation.separator.comma.gas', match: ',' },
      { name: 'punctuation.section.memory.gas', match: '[()\\[\\]]' },
      { name: 'keyword.operator.indirect.gas', match: '\\*' },
      { name: 'keyword.operator.gas', match: '<<|>>|==|!=|<=|>=|&&|\\|\\||[-+/%<>=!&|^~]' },
      { name: 'punctuation.separator.segment.gas', match: ':' }
    ]
  },

  'statement-common': {
    patterns: [
      { include: '#comments' },
      { include: '#strings' },
      { include: '#label-def' },
      { include: '#assignment' },
      { include: '#directives' },
      { include: '#instructions' },
      { include: '#operands' }
    ]
  },

  'intel-region': {
    name: 'meta.syntax.intel.gas',
    begin: `(?i)${STMT_START}(\\.intel_syntax)\\b`,
    end: '(?i)(?=^[ \\t]*\\.att_syntax\\b)',
    beginCaptures: { 1: { name: 'keyword.control.directive.gas' } },
    patterns: [
      { name: 'storage.modifier.noprefix.gas', match: '(?i)\\b(?:no)?prefix\\b' },
      {
        name: 'variable.parameter.register.intel.gas',
        match: `(?i)(?<![\\w.$%@\\\\])(?:${GPR}|${SEG}|${FPU}|${VEC}|${SYS})(?![\\w.$])`
      },
      {
        name: 'storage.type.size.intel.gas',
        match: '(?i)(?<![\\w.$%@\\\\])(?:byte|word|dword|qword|xmmword|ymmword|zmmword|tbyte|oword|fword|ptr|offset|short|near|far|flat)(?![\\w.$])'
      },
      { include: '#statement-common' }
    ]
  }
};

const grammar = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: 'GNU Assembler (x86-64)',
  scopeName: 'source.asm.gas-x86-64',
  patterns: [
    { include: '#comments-block-first' },
    { include: '#preprocessor' },
    { include: '#intel-region' },
    { include: '#statement-common' }
  ],
  repository
};

// block comments must win over everything else on a line
repository['comments-block-first'] = { patterns: [repository.comments.patterns[0]] };

const out = path.join(__dirname, '..', 'syntaxes', 'gas.tmLanguage.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(grammar, null, 2) + '\n');
console.log('wrote', out);
