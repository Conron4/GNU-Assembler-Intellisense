'use strict';
/**
 * x86-64 register database (names without the AT&T '%' prefix).
 * Each entry: { name, group, bits, parent?, desc }
 */

const REGS = new Map();

function add(name, group, bits, desc, parent) {
  REGS.set(name, { name, group, bits, desc, parent: parent || null });
}

// ---- general purpose -------------------------------------------------------
const GPR_ABI = {
  rax: 'Accumulator. Function return value; syscall number on entry and result on return; implicit operand of mul/div.',
  rbx: 'Base register. Callee-saved in the System V ABI.',
  rcx: '4th integer argument (System V). Count for rep/shifts/loop. Clobbered by `syscall` (holds the return RIP).',
  rdx: '3rd integer argument (System V). High half for mul/div/cqto; 2nd return value.',
  rsi: '2nd integer argument (System V). Source index for string instructions.',
  rdi: '1st integer argument (System V). Destination index for string instructions.',
  rbp: 'Frame pointer (by convention). Callee-saved.',
  rsp: 'Stack pointer. Must be 16-byte aligned at a `call` in the System V ABI.',
  r8: '5th integer argument (System V); 5th syscall argument.',
  r9: '6th integer argument (System V); 6th syscall argument.',
  r10: 'Syscall 4th argument (instead of %rcx). Scratch register / static chain pointer.',
  r11: 'Scratch register. Clobbered by `syscall` (holds the saved RFLAGS).',
  r12: 'Callee-saved in the System V ABI.',
  r13: 'Callee-saved in the System V ABI.',
  r14: 'Callee-saved in the System V ABI.',
  r15: 'Callee-saved in the System V ABI.'
};

const LEGACY = [
  // 64, 32, 16, 8-low, 8-high
  ['rax', 'eax', 'ax', 'al', 'ah'],
  ['rbx', 'ebx', 'bx', 'bl', 'bh'],
  ['rcx', 'ecx', 'cx', 'cl', 'ch'],
  ['rdx', 'edx', 'dx', 'dl', 'dh'],
  ['rsi', 'esi', 'si', 'sil', null],
  ['rdi', 'edi', 'di', 'dil', null],
  ['rbp', 'ebp', 'bp', 'bpl', null],
  ['rsp', 'esp', 'sp', 'spl', null]
];

for (const [r64, r32, r16, r8, r8h] of LEGACY) {
  add(r64, 'gpr', 64, GPR_ABI[r64]);
  add(r32, 'gpr', 32, `Low 32 bits of %${r64}. Writing it zero-extends into %${r64}.`, r64);
  add(r16, 'gpr', 16, `Low 16 bits of %${r64}. Writing it leaves the upper bits unchanged.`, r64);
  add(r8, 'gpr', 8, `Low 8 bits of %${r64}. Writing it leaves the upper bits unchanged.`, r64);
  if (r8h) add(r8h, 'gpr', 8, `Bits 8-15 of %${r64}. Cannot be used together with a REX prefix (%r8-%r15, %sil, %dil, ...).`, r64);
}
for (let i = 8; i <= 15; i++) {
  const r = `r${i}`;
  add(r, 'gpr', 64, GPR_ABI[r]);
  add(`${r}d`, 'gpr', 32, `Low 32 bits of %${r}. Writing it zero-extends into %${r}.`, r);
  add(`${r}w`, 'gpr', 16, `Low 16 bits of %${r}.`, r);
  add(`${r}b`, 'gpr', 8, `Low 8 bits of %${r}.`, r);
  add(`${r}l`, 'gpr', 8, `Low 8 bits of %${r} (alias of %${r}b).`, r);
}
add('rip', 'ip', 64, 'Instruction pointer. Used for RIP-relative addressing: `lea msg(%rip), %rdi`.');
add('eip', 'ip', 32, 'Low 32 bits of the instruction pointer (address-size override form).');
add('eiz', 'pseudo', 32, 'Pseudo index register meaning "no index" (32-bit); used to force a SIB byte.');
add('riz', 'pseudo', 64, 'Pseudo index register meaning "no index" (64-bit); used to force a SIB byte.');

// ---- segment ---------------------------------------------------------------
const SEG = {
  cs: 'Code segment selector.',
  ds: 'Data segment selector (ignored for addressing in 64-bit mode).',
  es: 'Extra segment selector (ignored for addressing in 64-bit mode).',
  ss: 'Stack segment selector.',
  fs: 'Segment with a programmable base. On Linux x86-64 it points at the thread control block: `%fs:0` is the thread pointer, `%fs:0x28` the stack-protector canary.',
  gs: 'Segment with a programmable base. Used by the Linux kernel for per-CPU data and by Windows for the TEB.'
};
for (const [n, d] of Object.entries(SEG)) add(n, 'segment', 16, d);

// ---- x87 / MMX ---------------------------------------------------------------
add('st', 'fpu', 80, 'x87 FPU stack register. `%st` is the top of stack (same as `%st(0)`); `%st(1)`..`%st(7)` are deeper entries.');
for (let i = 0; i < 8; i++) add(`mm${i}`, 'mmx', 64, `MMX register ${i} (aliases the low 64 bits of x87 register ${i}).`);

// ---- vector ------------------------------------------------------------------
for (let i = 0; i < 32; i++) {
  add(`xmm${i}`, 'vector', 128, `128-bit SSE register ${i}${i < 8 ? '' : ' (REX)'}${i >= 16 ? ' - needs AVX-512' : ''}.${i < 8 ? ' Scalar float args: xmm0-xmm7 in the System V ABI.' : ''}`);
  add(`ymm${i}`, 'vector', 256, `256-bit AVX register ${i}; low half is %xmm${i}.${i >= 16 ? ' Needs AVX-512VL.' : ''}`, `xmm${i}`);
  add(`zmm${i}`, 'vector', 512, `512-bit AVX-512 register ${i}; low halves are %ymm${i} and %xmm${i}.`, `ymm${i}`);
}
for (let i = 0; i < 8; i++) add(`k${i}`, 'mask', 64, `AVX-512 opmask register ${i}.${i === 0 ? ' %k0 cannot be used as a write mask (it means "no masking").' : ''}`);
for (let i = 0; i < 8; i++) add(`tmm${i}`, 'tile', 8192, `AMX tile register ${i}.`);

// ---- control / debug / misc --------------------------------------------------
const CR = {
  0: 'Control register 0 (PE, MP, EM, TS, WP, PG, ...).',
  2: 'Control register 2: faulting linear address after a page fault.',
  3: 'Control register 3: page-table base (PML4 physical address) and PCID.',
  4: 'Control register 4 (PAE, PGE, OSFXSR, OSXSAVE, SMEP, SMAP, ...).',
  8: 'Control register 8 (CR8): task priority register (TPR).'
};
for (let i = 0; i < 16; i++) add(`cr${i}`, 'system', 64, CR[i] || `Control register ${i}.`);
for (let i = 0; i < 16; i++) {
  let d = `Debug register ${i}.`;
  if (i < 4) d = `Debug register ${i}: hardware breakpoint address ${i}.`;
  else if (i === 6) d = 'Debug register 6 (DR6): debug status.';
  else if (i === 7) d = 'Debug register 7 (DR7): debug control.';
  add(`dr${i}`, 'system', 64, d);
}
for (let i = 0; i < 8; i++) add(`tr${i}`, 'system', 32, `Test register ${i} (legacy, not available in 64-bit mode).`);
for (let i = 0; i < 4; i++) add(`bnd${i}`, 'system', 128, `MPX bounds register ${i}.`);

// ---------------------------------------------------------------------------
const SIZE_SUFFIX = { 8: 'b', 16: 'w', 32: 'l', 64: 'q' };

/** Look up a register by name with or without '%'. */
function getRegister(name) {
  if (!name) return undefined;
  let n = name.toLowerCase();
  if (n[0] === '%') n = n.slice(1);
  n = n.replace(/\(\d\)$/, ''); // st(3) -> st
  return REGS.get(n);
}

function isRegister(name) {
  return getRegister(name) !== undefined;
}

/** Size in bits for a general-purpose register (0 if not a GPR). */
function gprBits(name) {
  const r = getRegister(name);
  return r && r.group === 'gpr' ? r.bits : 0;
}

/** AT&T size suffix (b/w/l/q) for a GPR, or ''. */
function gprSuffix(name) {
  return SIZE_SUFFIX[gprBits(name)] || '';
}

/** Markdown documentation for hover. */
function registerMarkdown(name) {
  const r = getRegister(name);
  if (!r) return null;
  const sizeText = r.bits >= 8192 ? `${r.bits / 8192} KiB` : `${r.bits}-bit`;
  const lines = [`**%${r.name}** — ${sizeText} ${groupLabel(r.group)} register`, '', r.desc];
  if (r.parent) lines.push('', `Part of **%${r.parent}**.`);
  return lines.join('\n');
}

function groupLabel(g) {
  return (
    {
      gpr: 'general-purpose',
      ip: 'instruction pointer',
      segment: 'segment',
      fpu: 'x87',
      mmx: 'MMX',
      vector: 'SIMD',
      mask: 'opmask',
      tile: 'AMX tile',
      system: 'system',
      pseudo: 'pseudo'
    }[g] || g
  );
}

/** Registers worth listing in completion (everything, ordered by group). */
function allRegisters() {
  return Array.from(REGS.values());
}

module.exports = { REGS, getRegister, isRegister, gprBits, gprSuffix, registerMarkdown, allRegisters, SIZE_SUFFIX };
