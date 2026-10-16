'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../src/parser');
const { heuristicDiagnostics } = require('../src/diagnostics');
const { formatDocument } = require('../src/formatter');
const { buildOutline, foldingRanges } = require('../src/symbols');
const { cursorContext } = require('../src/context');
const { lookupInstruction } = require('../src/data/instructions');
const { parseAsOutput } = require('../src/assembler');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('FAIL  ' + name + '\n', e.message); process.exitCode = 1; }
}
const diag = (src, o) => heuristicDiagnostics(P.parseDocument(src), o);
const codes = (src, o) => diag(src, o).map((d) => d.code);
const fmt = (src, o) => {
  const R = P.parseDocument(src);
  const lines = src.split('\n');
  for (const e of formatDocument(R, o)) lines[e.line] = e.text;
  return lines.join('\n');
};

const hello = fs.readFileSync(path.join(__dirname, 'fixtures', 'hello.s'), 'utf8');

test('parser: labels, constants, macros, sections', () => {
  const R = P.parseDocument(hello);
  const names = R.defs.map((d) => d.name);
  for (const n of ['msg', 'LEN', 'SYS_write', '_start', 'push2']) assert(names.includes(n), n);
  assert.strictEqual(R.types.get('_start'), 'function');
  assert(R.globals.has('_start'));
  assert.deepStrictEqual(R.problems, []);
  assert.strictEqual(R.sections.map((s) => s.name).join(), '.rodata,.text');
});
test('parser: comment char inside string is not a comment', () => {
  const R = P.parseDocument('msg: .asciz "a # b"  # real');
  assert(R.lines[0].commentCol > 15);
});
test('parser: local numeric labels resolve', () => {
  const R = P.parseDocument('1: nop\n jmp 1b\n jmp 1f\n1: nop\n');
  const b = R.refs.find((r) => r.name === '1b');
  const f = R.refs.find((r) => r.name === '1f');
  assert.strictEqual(P.resolveLocalRef(R, b).line, 0);
  assert.strictEqual(P.resolveLocalRef(R, f).line, 3);
});
test('parser: tokenAt finds register and symbol', () => {
  const R = P.parseDocument('  mov %rax, foo(%rip)\n');
  assert.strictEqual(P.tokenAt(R, 0, 7).type, 'register');
  assert.strictEqual(P.tokenAt(R, 0, 14).name, 'foo');
  assert.strictEqual(P.tokenAt(R, 0, 3).type, 'mnemonic');
});
test('parser: segment override is not a label', () => {
  const R = P.parseDocument('mov %fs:0x28, %rax\nmov %fs:foo@tpoff, %rax\n');
  assert.strictEqual(R.defs.length, 0);
});
test('parser: block comment spans', () => {
  const R = P.parseDocument('/* a\n b */ nop\n');
  assert.strictEqual(R.blockComments.length, 1);
  assert.strictEqual(R.lines[1].stmts.length, 1);
});
test('diagnostics: unbalanced blocks', () => {
  assert(codes('.macro foo\nnop\n').includes('gas.unterminated'));
  assert(codes('.endif\n').includes('gas.unmatched-end'));
  assert.deepStrictEqual(codes('.if 1\nnop\n.else\nnop\n.endif\n'), []);
});
test('diagnostics: duplicate label & bad local ref', () => {
  assert(codes('a: nop\na: nop\n').includes('gas.duplicate-label'));
  assert(codes('jmp 1f\n').includes('gas.undefined-local'));
});
test('diagnostics: AT&T slips', () => {
  assert(codes('mov rax, rbx').includes('gas.bare-register'));
  assert(codes('mov 5, %rax').includes('gas.bare-number'));
  assert(codes('int 0x80').includes('gas.bare-number'));
  assert(codes('mov $1, (%rax)').includes('gas.ambiguous-size'));
  assert(codes('incl (%rax)').length === 0);
  assert(codes('shl %cl, (%rax)').includes('gas.ambiguous-size'));
  assert(codes('movl %rax, %rbx').some((c) => c.startsWith('gas.size-mismatch')));
  assert(codes('shlq %cl, %rax').length === 0);
  assert(codes('movq %xmm0, %rax').length === 0);
  assert(codes('mov %fs:0x28, %rax').length === 0);
  assert(codes('mov $1, %eax\nlea msg(%rip), %rsi\ncall *%rax\njmp 0x1000').length === 0);
});
test('diagnostics: no AT&T checks in intel regions', () => {
  assert.deepStrictEqual(codes('.intel_syntax noprefix\nmov rax, rbx\nmov dword ptr [rax], 1\n'), []);
});
test('diagnostics: unknown directive', () => {
  assert(codes('.foobar 1').includes('gas.unknown-directive'));
  assert.deepStrictEqual(codes('.globl x\n.p2align 4\n.cfi_startproc\n.cfi_endproc\n.2byte 1\n'), []);
});
test('formatter: layout', () => {
  const out = fmt('start:\nmov %rax,%rbx   # hi\n  .globl   foo\nloop: dec    %rcx\n\t\tjnz loop\n', { commentColumn: 0 });
  assert.strictEqual(out, 'start:\n    mov     %rax, %rbx # hi\n    .globl  foo\nloop: dec     %rcx\n    jnz     loop\n'.replace(/\n$/, '\n'));
});
test('formatter: memory operands and comment alignment', () => {
  const out = fmt('mov 8( %rax , %rbx , 4 ), %rcx # c');
  assert(out.startsWith('    mov     8(%rax,%rbx,4), %rcx'));
  assert(out.indexOf('# c') === 40);
});
test('formatter: leaves strings and multi-statement lines safe', () => {
  assert.strictEqual(fmt('.asciz "a ,  b"'), '    .asciz  "a ,  b"');
  assert.strictEqual(fmt('mov $1, %eax; nop'), '    mov $1, %eax; nop');
});
test('formatter: idempotent', () => {
  const once = fmt(hello);
  assert.strictEqual(fmt(once), once);
});
test('outline: sections > functions > labels', () => {
  const R = P.parseDocument('.text\n.globl f\nf:\n  nop\n.Lx:\nloop:\n  ret\n.data\nv: .quad 1\n');
  const o = buildOutline(R);
  assert.strictEqual(o[0].name, '.text');
  assert.strictEqual(o[0].children[0].name, 'f');
  assert.strictEqual(o[0].children[0].children[0].name, 'loop');
  assert.strictEqual(o[1].children[0].name, 'v');
  assert(foldingRanges(R).length >= 1);
});
test('context: completion positions', () => {
  assert.strictEqual(cursorContext('  mo', 4).kind, 'mnemonic');
  assert.strictEqual(cursorContext('  .gl', 5).kind, 'directive');
  assert.strictEqual(cursorContext('foo: mov %r', 11).wordKind, 'register');
  assert.strictEqual(cursorContext('  mov $1, ', 10).operandIndex, 1);
  assert.strictEqual(cursorContext('  mov $1, # x', 13).kind, 'none');
  assert.strictEqual(cursorContext('  call fo', 10).wordKind, 'symbol');
  assert.strictEqual(cursorContext('  rep st', 8).kind, 'mnemonic');
});
test('instructions: lookup with suffixes', () => {
  assert(lookupInstruction('movl').length === 1);
  assert(lookupInstruction('addq')[0].viaSuffix === 'q');
  assert(lookupInstruction('jne').length === 1);
  assert(lookupInstruction('nonsense').length === 0);
});
test('assembler output parsing', () => {
  const out = parseAsOutput("{standard input}: Assembler messages:\n{standard input}:3: Error: no such instruction: `foo'\nx.s:9: Warning: something\n");
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].line, 2);
  assert.strictEqual(out[0].severity, 'error');
  assert.strictEqual(out[1].severity, 'warning');
});
console.log(`\n${passed} tests passed`);
