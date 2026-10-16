'use strict';
/**
 * x86-64 instruction database (AT&T syntax, operand order: source, destination).
 * Not exhaustive (AVX-512 in particular), but covers the integer ISA, x87,
 * SSE through SSE4.2, AES/CLMUL/SHA, BMI1/2, AVX/AVX2/FMA and a few AVX-512 basics.
 */

/** name -> entry[] */
const DB = new Map();

function put(name, entry) {
  const list = DB.get(name);
  if (list) list.push(entry);
  else DB.set(name, [entry]);
}

function add(names, group, summary, forms, flags) {
  const entry = { group, summary, forms: forms ? [].concat(forms) : [], flags: flags || '' };
  for (const n of names.split('|')) put(n, Object.assign({ name: n }, entry));
}

const NONE = 'none';
const ARITH = 'OF, SF, ZF, AF, CF, PF set according to the result';
const LOGIC = 'OF and CF cleared; SF, ZF, PF set according to the result; AF undefined';
const INCDEC = 'OF, SF, ZF, AF, PF set according to the result; CF unchanged';
const UNDEF = 'OF, SF, ZF, AF, PF, CF undefined';

// ---------------------------------------------------------------------------
// Integer: data transfer
// ---------------------------------------------------------------------------
const G_MOV = 'Data Transfer';
add('mov', G_MOV, 'Copy the source operand to the destination. Memory-to-memory moves are not encodable. A write to a 32-bit register zero-extends into the full 64-bit register.', ['mov{b,w,l,q} $imm, r/m', 'mov{b,w,l,q} r, r/m', 'mov{b,w,l,q} r/m, r', 'mov %seg, r/m   /   mov r/m, %seg', 'mov %cr0, %rax   /   mov %rax, %cr0'], NONE);
add('movabs', G_MOV, 'Move with a full 64-bit immediate or a 64-bit absolute address (moffs).', ['movabs $imm64, %r64', 'movabs moffs64, %al|%ax|%eax|%rax', 'movabs %al|%ax|%eax|%rax, moffs64'], NONE);
add('movzbw|movzbl|movzbq', G_MOV, 'Move byte with zero-extension to 16/32/64 bits.', ['movzb{w,l,q} r/m8, r'], NONE);
add('movzwl|movzwq', G_MOV, 'Move word with zero-extension to 32/64 bits.', ['movzw{l,q} r/m16, r'], NONE);
add('movsbw|movsbl|movsbq', G_MOV, 'Move byte with sign-extension to 16/32/64 bits (Intel MOVSX).', ['movsb{w,l,q} r/m8, r'], NONE);
add('movswl|movswq', G_MOV, 'Move word with sign-extension to 32/64 bits (Intel MOVSX).', ['movsw{l,q} r/m16, r'], NONE);
add('movslq|movsxd', G_MOV, 'Move doubleword with sign-extension to 64 bits (Intel MOVSXD).', ['movslq r/m32, %r64'], NONE);
add('cbtw|cbw', G_MOV, 'Sign-extend %al into %ax.', 'cbtw', NONE);
add('cwtl|cwde', G_MOV, 'Sign-extend %ax into %eax.', 'cwtl', NONE);
add('cltq|cdqe', G_MOV, 'Sign-extend %eax into %rax.', 'cltq', NONE);
add('cwtd|cwd', G_MOV, 'Sign-extend %ax into %dx:%ax.', 'cwtd', NONE);
add('cltd|cdq', G_MOV, 'Sign-extend %eax into %edx:%eax. Use before idivl.', 'cltd', NONE);
add('cqto|cqo', G_MOV, 'Sign-extend %rax into %rdx:%rax. Use before idivq.', 'cqto', NONE);
add('push', G_MOV, 'Decrement %rsp by the operand size (8 in 64-bit mode) and store the operand on the stack.', ['push{w,q} $imm', 'push{w,q} r/m'], NONE);
add('pop', G_MOV, 'Load the top of stack into the operand and increment %rsp.', ['pop{w,q} r/m'], NONE);
add('pushf|pushfq', G_MOV, 'Push RFLAGS onto the stack.', 'pushfq', NONE);
add('popf|popfq', G_MOV, 'Pop the top of stack into RFLAGS.', 'popfq', 'all modifiable flags loaded from the stack');
add('xchg', G_MOV, 'Exchange two operands. With a memory operand the exchange is implicitly **locked** (atomic).', ['xchg{b,w,l,q} r, r/m'], NONE);
add('xadd', G_MOV, 'Exchange and add: dst gets src+dst, src gets the old dst. Use with `lock` for atomic fetch-and-add.', ['lock xadd{b,w,l,q} r, r/m'], ARITH);
add('cmpxchg', G_MOV, 'Compare %al/%ax/%eax/%rax with dst; if equal, store src into dst (ZF=1), else load dst into the accumulator (ZF=0). Use with `lock`.', ['lock cmpxchg{b,w,l,q} r, r/m'], ARITH);
add('cmpxchg8b', G_MOV, 'Compare %edx:%eax with m64; if equal store %ecx:%ebx there.', 'cmpxchg8b m64', 'ZF');
add('cmpxchg16b', G_MOV, 'Compare %rdx:%rax with m128 (16-byte aligned); if equal store %rcx:%rbx there.', 'cmpxchg16b m128', 'ZF');
add('bswap', G_MOV, 'Reverse the byte order of a 32- or 64-bit register (endianness swap).', ['bswap %r32', 'bswap %r64'], NONE);
add('lea', G_MOV, 'Load effective address: computes the address of the memory operand without accessing memory. Also a handy 3-operand add/shift: `lea (%rax,%rax,4), %rdx`.', ['lea{w,l,q} mem, r'], NONE);
add('movbe', G_MOV, 'Move data with byte swapping between memory and a register.', ['movbe m, r', 'movbe r, m'], NONE);
add('lahf', G_MOV, 'Load SF, ZF, AF, PF, CF into %ah.', 'lahf', NONE);
add('sahf', G_MOV, 'Store %ah into SF, ZF, AF, PF, CF.', 'sahf', 'SF, ZF, AF, PF, CF loaded from %ah');
add('xlat|xlatb', G_MOV, 'Table lookup: %al = (%rbx + %al).', 'xlatb', NONE);
add('movnti', G_MOV, 'Non-temporal store of a general register to memory (bypasses the cache).', 'movnti r32|r64, m', NONE);

// ---------------------------------------------------------------------------
// Integer: arithmetic
// ---------------------------------------------------------------------------
const G_ARI = 'Arithmetic';
add('add', G_ARI, 'Add: dst = dst + src.', ['add{b,w,l,q} $imm, r/m', 'add{b,w,l,q} r, r/m', 'add{b,w,l,q} r/m, r'], ARITH);
add('adc', G_ARI, 'Add with carry: dst = dst + src + CF.', ['adc{b,w,l,q} src, dst'], ARITH);
add('sub', G_ARI, 'Subtract: dst = dst - src.', ['sub{b,w,l,q} src, dst'], ARITH);
add('sbb', G_ARI, 'Subtract with borrow: dst = dst - src - CF.', ['sbb{b,w,l,q} src, dst'], ARITH);
add('inc', G_ARI, 'Increment by one.', ['inc{b,w,l,q} r/m'], INCDEC);
add('dec', G_ARI, 'Decrement by one.', ['dec{b,w,l,q} r/m'], INCDEC);
add('neg', G_ARI, 'Two\'s complement negation: dst = -dst. CF=0 only if the operand was 0.', ['neg{b,w,l,q} r/m'], ARITH);
add('cmp', G_ARI, 'Compare: computes dst - src, sets flags, discards the result. In AT&T syntax `cmp %rbx, %rax` followed by `jg` jumps if %rax > %rbx.', ['cmp{b,w,l,q} src, dst'], ARITH);
add('mul', G_ARI, 'Unsigned multiply of %al/%ax/%eax/%rax by the operand; the double-width result goes to %ax, %dx:%ax, %edx:%eax or %rdx:%rax.', ['mul{b,w,l,q} r/m'], 'CF and OF set if the upper half is non-zero; others undefined');
add('imul', G_ARI, 'Signed multiply. One-, two- and three-operand forms.', ['imul{b,w,l,q} r/m           # %rdx:%rax = %rax * r/m', 'imul{w,l,q} r/m, r         # r *= r/m', 'imul{w,l,q} $imm, r/m, r   # r = r/m * imm'], 'CF and OF set if the result was truncated; others undefined');
add('div', G_ARI, 'Unsigned divide of %dx:%ax / %edx:%eax / %rdx:%rax by the operand. Quotient in %rax, remainder in %rdx. Raises #DE on zero or overflow. Zero %rdx first (`xor %edx, %edx`).', ['div{b,w,l,q} r/m'], UNDEF);
add('idiv', G_ARI, 'Signed divide of %rdx:%rax by the operand (sign-extend first with `cqto`). Quotient in %rax, remainder in %rdx.', ['idiv{b,w,l,q} r/m'], UNDEF);
add('adcx', G_ARI, 'Unsigned add with carry that only reads and writes CF (ADX extension).', 'adcx r/m, r', 'CF');
add('adox', G_ARI, 'Unsigned add with carry that only reads and writes OF (ADX extension).', 'adox r/m, r', 'OF');

// ---------------------------------------------------------------------------
// Integer: logic, shifts, bit manipulation
// ---------------------------------------------------------------------------
const G_LOG = 'Logic & Shifts';
add('and', G_LOG, 'Bitwise AND: dst = dst & src.', ['and{b,w,l,q} src, dst'], LOGIC);
add('or', G_LOG, 'Bitwise OR: dst = dst | src.', ['or{b,w,l,q} src, dst'], LOGIC);
add('xor', G_LOG, 'Bitwise XOR: dst = dst ^ src. `xor %eax, %eax` is the idiomatic way to zero a register.', ['xor{b,w,l,q} src, dst'], LOGIC);
add('not', G_LOG, 'Bitwise complement: dst = ~dst.', ['not{b,w,l,q} r/m'], NONE);
add('test', G_LOG, 'Bitwise AND that sets flags and discards the result. `test %rax, %rax` tests for zero/sign.', ['test{b,w,l,q} src, dst'], LOGIC);
add('shl|sal', G_LOG, 'Shift left (logical = arithmetic). The count is an immediate, 1, or %cl.', ['shl{b,w,l,q} $imm8, r/m', 'shl{b,w,l,q} %cl, r/m', 'shl{b,w,l,q} r/m   # by 1'], 'CF = last bit shifted out; OF defined for 1-bit shifts; SF, ZF, PF set');
add('shr', G_LOG, 'Logical shift right (zero fill).', ['shr{b,w,l,q} $imm8|%cl, r/m'], 'CF = last bit shifted out; SF, ZF, PF set');
add('sar', G_LOG, 'Arithmetic shift right (sign fill).', ['sar{b,w,l,q} $imm8|%cl, r/m'], 'CF = last bit shifted out; SF, ZF, PF set');
add('rol', G_LOG, 'Rotate left.', ['rol{b,w,l,q} $imm8|%cl, r/m'], 'CF, OF');
add('ror', G_LOG, 'Rotate right.', ['ror{b,w,l,q} $imm8|%cl, r/m'], 'CF, OF');
add('rcl', G_LOG, 'Rotate left through the carry flag.', ['rcl{b,w,l,q} $imm8|%cl, r/m'], 'CF, OF');
add('rcr', G_LOG, 'Rotate right through the carry flag.', ['rcr{b,w,l,q} $imm8|%cl, r/m'], 'CF, OF');
add('shld', G_LOG, 'Double-precision shift left: shifts dst left, filling from the high bits of src.', ['shld{w,l,q} $imm8|%cl, src, dst'], 'CF, SF, ZF, PF');
add('shrd', G_LOG, 'Double-precision shift right: shifts dst right, filling from the low bits of src.', ['shrd{w,l,q} $imm8|%cl, src, dst'], 'CF, SF, ZF, PF');
add('bt', G_LOG, 'Bit test: copy the selected bit into CF.', ['bt{w,l,q} $imm8|r, r/m'], 'CF = selected bit');
add('bts', G_LOG, 'Bit test and set.', ['bts{w,l,q} $imm8|r, r/m'], 'CF = old bit');
add('btr', G_LOG, 'Bit test and reset (clear).', ['btr{w,l,q} $imm8|r, r/m'], 'CF = old bit');
add('btc', G_LOG, 'Bit test and complement.', ['btc{w,l,q} $imm8|r, r/m'], 'CF = old bit');
add('bsf', G_LOG, 'Bit scan forward: index of the least-significant set bit. ZF=1 and dst undefined if the source is 0.', ['bsf{w,l,q} r/m, r'], 'ZF');
add('bsr', G_LOG, 'Bit scan reverse: index of the most-significant set bit. ZF=1 and dst undefined if the source is 0.', ['bsr{w,l,q} r/m, r'], 'ZF');
add('popcnt', G_LOG, 'Count the number of set bits.', ['popcnt{w,l,q} r/m, r'], 'ZF set if source is zero; others cleared');
add('lzcnt', G_LOG, 'Count leading zero bits (ABM/BMI1). Returns the operand size for a zero input.', ['lzcnt{w,l,q} r/m, r'], 'CF set if source is zero; ZF set if result is zero');
add('tzcnt', G_LOG, 'Count trailing zero bits (BMI1). Returns the operand size for a zero input.', ['tzcnt{w,l,q} r/m, r'], 'CF set if source is zero; ZF set if result is zero');
add('andn', G_LOG, 'BMI1: dst = ~src1 & src2.', 'andn r/m, src1, dst', 'SF, ZF set; OF, CF cleared');
add('bextr', G_LOG, 'BMI1: extract a bit field (start/length in the control register).', 'bextr ctrl, r/m, dst', 'ZF');
add('blsi', G_LOG, 'BMI1: isolate the lowest set bit (src & -src).', 'blsi r/m, dst', 'SF, ZF, CF');
add('blsmsk', G_LOG, 'BMI1: mask up to and including the lowest set bit (src ^ (src-1)).', 'blsmsk r/m, dst', 'SF, CF');
add('blsr', G_LOG, 'BMI1: reset the lowest set bit (src & (src-1)).', 'blsr r/m, dst', 'SF, ZF, CF');
add('bzhi', G_LOG, 'BMI2: zero the bits of src from the given index upward.', 'bzhi index, r/m, dst', 'SF, ZF, CF');
add('pdep', G_LOG, 'BMI2: parallel bit deposit.', 'pdep mask, src, dst', NONE);
add('pext', G_LOG, 'BMI2: parallel bit extract.', 'pext mask, src, dst', NONE);
add('rorx', G_LOG, 'BMI2: rotate right by an immediate without touching flags.', 'rorx $imm8, r/m, dst', NONE);
add('sarx', G_LOG, 'BMI2: arithmetic shift right by a register count, no flags.', 'sarx count, r/m, dst', NONE);
add('shlx', G_LOG, 'BMI2: shift left by a register count, no flags.', 'shlx count, r/m, dst', NONE);
add('shrx', G_LOG, 'BMI2: logical shift right by a register count, no flags.', 'shrx count, r/m, dst', NONE);
add('mulx', G_LOG, 'BMI2: unsigned multiply %rdx * src into hi:lo without affecting flags.', 'mulx src, lo, hi', NONE);
add('crc32', 'Arithmetic', 'Accumulate a CRC-32C (Castagnoli) value.', ['crc32{b,w,l,q} r/m, r32|r64'], NONE);

// ---------------------------------------------------------------------------
// Control flow
// ---------------------------------------------------------------------------
const G_CTL = 'Control Flow';
add('jmp', G_CTL, 'Unconditional jump. Indirect targets are written with `*`.', ['jmp label', 'jmp *%reg', 'jmp *mem', 'jmp *table(,%rax,8)'], NONE);
add('call', G_CTL, 'Push the return address and jump. Keep %rsp 16-byte aligned at the call (System V ABI).', ['call label', 'call *%reg', 'call *mem', 'call func@PLT'], NONE);
add('ret|retq', G_CTL, 'Pop the return address into %rip. Optionally also release N bytes of stack.', ['ret', 'ret $imm16'], NONE);
add('lret|lretq', G_CTL, 'Far return.', 'lret [$imm16]', 'all flags may change');
add('leave|leaveq', G_CTL, 'Tear down a stack frame: `mov %rbp, %rsp; pop %rbp`.', 'leave', NONE);
add('enter', G_CTL, 'Create a stack frame. Rarely used (slow); prefer push/mov.', 'enter $size, $nesting', NONE);
add('loop', G_CTL, 'Decrement %rcx and jump if it is non-zero.', 'loop label', NONE);
add('loope|loopz', G_CTL, 'Decrement %rcx and jump if non-zero and ZF=1.', 'loope label', NONE);
add('loopne|loopnz', G_CTL, 'Decrement %rcx and jump if non-zero and ZF=0.', 'loopne label', NONE);
add('jrcxz|jecxz|jcxz', G_CTL, 'Jump if %rcx (jrcxz), %ecx (jecxz) or %cx (jcxz) is zero.', 'jrcxz label', NONE);
add('int', G_CTL, 'Software interrupt. The vector is an immediate: `int $0x80` is the legacy 32-bit Linux syscall gate.', 'int $imm8', 'all flags may change');
add('int3', G_CTL, 'Breakpoint trap (one-byte encoding 0xCC).', 'int3', NONE);
add('iret|iretq', G_CTL, 'Return from an interrupt.', 'iretq', 'loaded from the stack');
add('syscall', G_CTL, 'Fast system call (Linux x86-64): number in %rax, args in %rdi, %rsi, %rdx, %r10, %r8, %r9. Result in %rax. Clobbers %rcx and %r11.', 'syscall', 'RFLAGS saved in %r11');
add('sysret|sysretq', G_CTL, 'Return from a fast system call (kernel use).', 'sysretq', 'loaded from %r11');
add('sysenter', G_CTL, 'Fast system call (32-bit entry, legacy).', 'sysenter', NONE);
add('sysexit', G_CTL, 'Fast return from privileged code (legacy).', 'sysexit', NONE);
add('ud2', G_CTL, 'Raise an invalid-opcode exception (guaranteed undefined instruction).', 'ud2', NONE);
add('nop|nopw|nopl|nopq', G_CTL, 'No operation. Multi-byte forms (`nopw`, `nopl` with a memory operand) are used for alignment.', ['nop', 'nop{w,l} mem'], NONE);
add('hlt', G_CTL, 'Halt the processor until the next interrupt (privileged).', 'hlt', NONE);
add('pause', G_CTL, 'Spin-wait hint: improves spin loops and reduces power.', 'pause', NONE);
add('endbr64', G_CTL, 'Valid indirect-branch target marker for Intel CET IBT (64-bit).', 'endbr64', NONE);
add('endbr32', G_CTL, 'Valid indirect-branch target marker for Intel CET IBT (32-bit).', 'endbr32', NONE);
add('xbegin', G_CTL, 'Start a transactional (RTM) region; jumps to the fallback label on abort.', 'xbegin label', NONE);
add('xend', G_CTL, 'Commit a transactional (RTM) region.', 'xend', NONE);
add('xabort', G_CTL, 'Abort a transaction with an 8-bit code in %eax[31:24].', 'xabort $imm8', NONE);
add('xtest', G_CTL, 'Test whether execution is inside a transactional region (ZF=0 if so).', 'xtest', 'ZF');

// Conditional families -------------------------------------------------------
const CC = [
  ['o', 'OF=1 (overflow)'],
  ['no', 'OF=0 (no overflow)'],
  ['b|c|nae', 'CF=1 (unsigned below / carry)'],
  ['ae|nb|nc', 'CF=0 (unsigned above or equal / no carry)'],
  ['e|z', 'ZF=1 (equal / zero)'],
  ['ne|nz', 'ZF=0 (not equal / not zero)'],
  ['be|na', 'CF=1 or ZF=1 (unsigned below or equal)'],
  ['a|nbe', 'CF=0 and ZF=0 (unsigned above)'],
  ['s', 'SF=1 (negative)'],
  ['ns', 'SF=0 (non-negative)'],
  ['p|pe', 'PF=1 (parity even)'],
  ['np|po', 'PF=0 (parity odd)'],
  ['l|nge', 'SF≠OF (signed less)'],
  ['ge|nl', 'SF=OF (signed greater or equal)'],
  ['le|ng', 'ZF=1 or SF≠OF (signed less or equal)'],
  ['g|nle', 'ZF=0 and SF=OF (signed greater)']
];
for (const [aliases, cond] of CC) {
  const list = aliases.split('|');
  add(list.map((c) => 'j' + c).join('|'), G_CTL, `Jump if ${cond}.`, `j${list[0]} label`, NONE);
  add(list.map((c) => 'set' + c).join('|'), G_MOV, `Set the byte operand to 1 if ${cond}, else 0.`, `set${list[0]} r/m8`, NONE);
  add(list.map((c) => 'cmov' + c).join('|'), G_MOV, `Move if ${cond}. Not encodable with an immediate; a 32-bit destination is zero-extended even when the condition is false.`, `cmov${list[0]}{w,l,q} r/m, r`, NONE);
}

// ---------------------------------------------------------------------------
// String, flags, system
// ---------------------------------------------------------------------------
const G_STR = 'String';
const STR = [
  ['movs', 'Copy from (%rsi) to (%rdi) and advance both by the element size (direction per DF).', '%rsi/%rdi'],
  ['cmps', 'Compare (%rsi) with (%rdi) and advance both.', '%rsi/%rdi'],
  ['scas', 'Compare %al/%ax/%eax/%rax with (%rdi) and advance %rdi.', '%rdi'],
  ['lods', 'Load from (%rsi) into %al/%ax/%eax/%rax and advance %rsi.', '%rsi'],
  ['stos', 'Store %al/%ax/%eax/%rax at (%rdi) and advance %rdi.', '%rdi']
];
for (const [base, text] of STR) {
  const names = ['b', 'w', 'l'].concat(base === 'ins' || base === 'outs' ? [] : ['q']).map((s) => base + s);
  add(names.join('|'), G_STR, text + ' Combine with `rep`/`repe`/`repne` and %rcx as the count.', `${base}{b,w,l,q}`, base === 'cmps' || base === 'scas' ? ARITH : NONE);
}
add('insb|insw|insl', G_STR, 'Input from the port in %dx to (%rdi), advancing %rdi.', 'insb', NONE);
add('outsb|outsw|outsl', G_STR, 'Output (%rsi) to the port in %dx, advancing %rsi.', 'outsb', NONE);
add('rep', G_STR, 'Repeat the following string instruction %rcx times.', 'rep movsb|stosb|…', NONE);
add('repe|repz', G_STR, 'Repeat while %rcx != 0 and ZF=1 (use with cmps/scas).', 'repe cmpsb|scasb', 'ZF');
add('repne|repnz', G_STR, 'Repeat while %rcx != 0 and ZF=0 (e.g. `repne scasb` = strlen).', 'repne scasb', 'ZF');
add('lock', G_STR, 'Bus-lock prefix: make the following read-modify-write instruction atomic.', 'lock add|and|or|xor|inc|dec|neg|not|xchg|xadd|cmpxchg|bts|btr|btc …', NONE);
add('bnd', G_STR, 'MPX bounds-checking prefix for the following branch.', 'bnd call|jmp|ret|jcc', NONE);
add('notrack', G_STR, 'CET: do not track the following indirect jump/call for IBT.', 'notrack jmp *%rax', NONE);
add('xacquire|xrelease', G_STR, 'HLE (hardware lock elision) prefixes.', 'xacquire lock …', NONE);
add('data16', G_STR, 'Operand-size override prefix (0x66). Also used for TLS code sequences.', 'data16', NONE);

const G_FLAG = 'Flags';
add('clc', G_FLAG, 'Clear the carry flag.', 'clc', 'CF=0');
add('stc', G_FLAG, 'Set the carry flag.', 'stc', 'CF=1');
add('cmc', G_FLAG, 'Complement the carry flag.', 'cmc', 'CF toggled');
add('cld', G_FLAG, 'Clear the direction flag: string instructions go upward. Required by the System V ABI at function entry.', 'cld', 'DF=0');
add('std', G_FLAG, 'Set the direction flag: string instructions go downward.', 'std', 'DF=1');
add('cli', G_FLAG, 'Clear the interrupt flag (privileged).', 'cli', 'IF=0');
add('sti', G_FLAG, 'Set the interrupt flag (privileged).', 'sti', 'IF=1');

const G_SYS = 'System';
add('cpuid', G_SYS, 'CPU identification: leaf in %eax (sub-leaf in %ecx); results in %eax, %ebx, %ecx, %edx.', 'cpuid', NONE);
add('rdtsc', G_SYS, 'Read the time-stamp counter into %edx:%eax.', 'rdtsc', NONE);
add('rdtscp', G_SYS, 'Read the time-stamp counter into %edx:%eax and IA32_TSC_AUX into %ecx; waits for prior instructions.', 'rdtscp', NONE);
add('rdmsr', G_SYS, 'Read the model-specific register selected by %ecx into %edx:%eax (privileged).', 'rdmsr', NONE);
add('wrmsr', G_SYS, 'Write %edx:%eax to the model-specific register selected by %ecx (privileged).', 'wrmsr', NONE);
add('rdpmc', G_SYS, 'Read a performance-monitoring counter.', 'rdpmc', NONE);
add('xgetbv', G_SYS, 'Read an extended control register (e.g. XCR0 to see which AVX state is enabled).', 'xgetbv', NONE);
add('xsetbv', G_SYS, 'Write an extended control register (privileged).', 'xsetbv', NONE);
add('rdrand', G_SYS, 'Hardware random number. CF=1 if the value is valid.', 'rdrand r', 'CF');
add('rdseed', G_SYS, 'Hardware seed-quality random number. CF=1 if valid.', 'rdseed r', 'CF');
add('rdfsbase|rdgsbase', G_SYS, 'Read the FS/GS segment base into a register.', 'rdfsbase %r', NONE);
add('wrfsbase|wrgsbase', G_SYS, 'Write the FS/GS segment base from a register.', 'wrfsbase %r', NONE);
add('swapgs', G_SYS, 'Swap the GS base with IA32_KERNEL_GS_BASE (kernel entry/exit).', 'swapgs', NONE);
add('lgdt|lidt|sgdt|sidt|lldt|ltr', G_SYS, 'Load/store descriptor-table registers (privileged).', 'lgdt m', NONE);
add('invlpg', G_SYS, 'Invalidate the TLB entry for a page (privileged).', 'invlpg m', NONE);
add('wbinvd|invd', G_SYS, 'Write back and invalidate (or just invalidate) caches (privileged).', 'wbinvd', NONE);
add('clflush', G_SYS, 'Flush the cache line containing the address.', 'clflush m8', NONE);
add('clflushopt', G_SYS, 'Optimised cache-line flush (weakly ordered).', 'clflushopt m8', NONE);
add('clwb', G_SYS, 'Write back a cache line without invalidating it.', 'clwb m8', NONE);
add('lfence', G_SYS, 'Load fence; also serialises instruction dispatch.', 'lfence', NONE);
add('sfence', G_SYS, 'Store fence.', 'sfence', NONE);
add('mfence', G_SYS, 'Full memory fence (loads and stores).', 'mfence', NONE);
add('prefetcht0|prefetcht1|prefetcht2|prefetchnta', G_SYS, 'Prefetch a cache line into the cache hierarchy (t0 = all levels, nta = non-temporal).', 'prefetcht0 m8', NONE);
add('prefetchw', G_SYS, 'Prefetch a cache line in anticipation of a write.', 'prefetchw m8', NONE);
add('in|inb|inw|inl', G_SYS, 'Read from an I/O port.', ['in $imm8, %al|%ax|%eax', 'in (%dx), %al|%ax|%eax'], NONE);
add('out|outb|outw|outl', G_SYS, 'Write to an I/O port.', ['out %al|%ax|%eax, $imm8', 'out %al|%ax|%eax, (%dx)'], NONE);
add('fxsave|fxrstor|fxsave64|fxrstor64', G_SYS, 'Save/restore x87, MMX and SSE state (512 bytes, 16-byte aligned).', 'fxsave m512', NONE);
add('xsave|xrstor|xsaveopt|xsavec|xsave64|xrstor64', G_SYS, 'Save/restore extended processor state selected by %edx:%eax.', 'xsave m', NONE);
add('wait|fwait', G_SYS, 'Wait for pending unmasked x87 exceptions.', 'fwait', NONE);

// ---------------------------------------------------------------------------
// x87 FPU
// ---------------------------------------------------------------------------
const G_X87 = 'x87 FPU';
const X87 = [
  ['fld', 'Push a float (m32/m64/m80 or %st(i)) onto the FPU stack.', 'fld{s,l,t} m | fld %st(i)'],
  ['fst', 'Copy %st(0) to a memory operand or %st(i).', 'fst{s,l} m | fst %st(i)'],
  ['fstp', 'Store %st(0) and pop the FPU stack.', 'fstp{s,l,t} m | fstp %st(i)'],
  ['fild', 'Push a signed integer (16/32/64-bit memory) converted to float.', 'fild{s,l,ll} m'],
  ['fist', 'Store %st(0) as an integer using the current rounding mode.', 'fist{s,l} m'],
  ['fistp', 'Store %st(0) as an integer and pop.', 'fistp{s,l,ll} m'],
  ['fisttp', 'Store %st(0) as an integer with truncation and pop (SSE3).', 'fisttp{s,l,ll} m'],
  ['fadd', 'Add: %st(0) = %st(0) + operand.', 'fadd{s,l} m | fadd %st(i), %st | fadd %st, %st(i)'],
  ['faddp', 'Add and pop: %st(i) += %st(0), then pop.', 'faddp [%st, %st(i)]'],
  ['fsub', 'Subtract.', 'fsub{s,l} m | fsub %st(i), %st'],
  ['fsubp', 'Subtract and pop.', 'fsubp'],
  ['fsubr', 'Reverse subtract.', 'fsubr{s,l} m'],
  ['fsubrp', 'Reverse subtract and pop.', 'fsubrp'],
  ['fmul', 'Multiply.', 'fmul{s,l} m | fmul %st(i), %st'],
  ['fmulp', 'Multiply and pop.', 'fmulp'],
  ['fdiv', 'Divide.', 'fdiv{s,l} m | fdiv %st(i), %st'],
  ['fdivp', 'Divide and pop.', 'fdivp'],
  ['fdivr', 'Reverse divide.', 'fdivr{s,l} m'],
  ['fdivrp', 'Reverse divide and pop.', 'fdivrp'],
  ['fiadd|fisub|fisubr|fimul|fidiv|fidivr', 'Arithmetic with a 16/32-bit integer memory operand.', 'fiadd{s,l} m'],
  ['fchs', 'Negate %st(0).', 'fchs'],
  ['fabs', 'Absolute value of %st(0).', 'fabs'],
  ['fsqrt', 'Square root of %st(0).', 'fsqrt'],
  ['fsin', 'Sine of %st(0) (radians).', 'fsin'],
  ['fcos', 'Cosine of %st(0).', 'fcos'],
  ['fsincos', 'Replace %st(0) by sin, push cos.', 'fsincos'],
  ['fptan', 'Partial tangent; pushes 1.0.', 'fptan'],
  ['fpatan', 'Partial arctangent: %st(1) = atan(%st(1)/%st(0)), pop.', 'fpatan'],
  ['fyl2x', '%st(1) = %st(1) * log2(%st(0)), pop.', 'fyl2x'],
  ['fyl2xp1', '%st(1) = %st(1) * log2(%st(0)+1), pop.', 'fyl2xp1'],
  ['f2xm1', '%st(0) = 2^%st(0) - 1.', 'f2xm1'],
  ['fscale', '%st(0) *= 2^trunc(%st(1)).', 'fscale'],
  ['frndint', 'Round %st(0) to an integer.', 'frndint'],
  ['fxch', 'Exchange %st(0) with %st(i).', 'fxch [%st(i)]'],
  ['fcom|fcomp|fcompp', 'Compare %st(0) with an operand (setting C0-C3), optionally popping.', 'fcom[p] [%st(i) | m]'],
  ['fucom|fucomp|fucompp', 'Unordered compare of %st(0).', 'fucom[p] %st(i)'],
  ['fcomi|fcomip|fucomi|fucomip', 'Compare %st(0) with %st(i) and set ZF/PF/CF directly (use `jp` for unordered).', 'fcomi[p] %st(i), %st'],
  ['fld1', 'Push +1.0.', 'fld1'],
  ['fldz', 'Push +0.0.', 'fldz'],
  ['fldpi', 'Push pi.', 'fldpi'],
  ['fldl2e', 'Push log2(e).', 'fldl2e'],
  ['fldl2t', 'Push log2(10).', 'fldl2t'],
  ['fldlg2', 'Push log10(2).', 'fldlg2'],
  ['fldln2', 'Push ln(2).', 'fldln2'],
  ['finit|fninit', 'Initialise the FPU (fn- skips the pending-exception check).', 'finit'],
  ['fldcw', 'Load the FPU control word.', 'fldcw m16'],
  ['fnstcw|fstcw', 'Store the FPU control word.', 'fnstcw m16'],
  ['fnstsw|fstsw', 'Store the FPU status word (to memory or %ax).', 'fnstsw %ax | m16'],
  ['fnclex|fclex', 'Clear pending FPU exceptions.', 'fnclex'],
  ['fnop', 'FPU no-operation.', 'fnop'],
  ['ffree', 'Mark %st(i) as empty.', 'ffree %st(i)'],
  ['fxam', 'Classify %st(0) in C0-C3.', 'fxam'],
  ['ftst', 'Compare %st(0) with 0.0.', 'ftst'],
  ['fprem|fprem1', 'Partial remainder (IEEE for fprem1).', 'fprem'],
  ['fcmovb|fcmove|fcmovbe|fcmovu|fcmovnb|fcmovne|fcmovnbe|fcmovnu', 'Conditionally move %st(i) to %st(0) based on integer flags.', 'fcmove %st(i), %st']
];
for (const [n, s, f] of X87) add(n, G_X87, s, f, 'FPU status word (C0-C3) / EFLAGS for fcomi*');

// ---------------------------------------------------------------------------
// SSE / SSE2 / SSE3 / SSSE3 / SSE4 / AES / CLMUL / SHA  (+ derived VEX forms)
// ---------------------------------------------------------------------------
const SSE_ENTRIES = [];
function sse(group, names, summary, forms, flags, noVex) {
  add(names, group, summary, forms, flags);
  if (!noVex) SSE_ENTRIES.push({ group, names, summary, forms: [].concat(forms), flags });
}

const G_SSE = 'SSE / SIMD Floating Point';
const G_INT = 'SIMD Integer';
const KIND = {
  ps: 'packed single-precision floats (4 × 32-bit)',
  pd: 'packed double-precision floats (2 × 64-bit)',
  ss: 'the scalar single-precision float in the low 32 bits',
  sd: 'the scalar double-precision float in the low 64 bits'
};
const FP_OPS = [
  ['add', 'Add'],
  ['sub', 'Subtract'],
  ['mul', 'Multiply'],
  ['div', 'Divide'],
  ['min', 'Minimum of'],
  ['max', 'Maximum of'],
  ['sqrt', 'Square root of']
];
for (const [op, verb] of FP_OPS) {
  for (const k of ['ps', 'pd', 'ss', 'sd']) {
    const extra = k === 'ss' || k === 'sd' ? ' The upper bits of the destination are preserved.' : '';
    const sem = op === 'sqrt' ? 'dst = sqrt(src).' : op === 'min' || op === 'max' ? `dst = ${op}(dst, src).` : `dst ${{ add: '+=', sub: '-=', mul: '*=', div: '/=' }[op]} src.`;
    sse(G_SSE, op + k, `${verb} ${KIND[k]}: ${sem}${extra}`, `${op}${k} xmm/m, xmm`, 'MXCSR exception flags');
  }
}
sse(G_SSE, 'rsqrtps|rsqrtss', 'Approximate reciprocal square root (≈12-bit precision).', 'rsqrtps xmm/m, xmm', 'MXCSR');
sse(G_SSE, 'rcpps|rcpss', 'Approximate reciprocal (≈12-bit precision).', 'rcpps xmm/m, xmm', 'MXCSR');
sse(G_SSE, 'andps|andpd', 'Bitwise AND of packed floats.', 'andps xmm/m, xmm', NONE);
sse(G_SSE, 'andnps|andnpd', 'Bitwise AND-NOT of packed floats: dst = ~dst & src.', 'andnps xmm/m, xmm', NONE);
sse(G_SSE, 'orps|orpd', 'Bitwise OR of packed floats.', 'orps xmm/m, xmm', NONE);
sse(G_SSE, 'xorps|xorpd', 'Bitwise XOR of packed floats. `xorps %xmm0, %xmm0` zeroes a register.', 'xorps xmm/m, xmm', NONE);
sse(G_SSE, 'movaps|movapd', 'Move aligned packed floats (memory must be 16-byte aligned or #GP).', ['movaps xmm/m128, xmm', 'movaps xmm, m128'], NONE);
sse(G_SSE, 'movups|movupd', 'Move unaligned packed floats.', ['movups xmm/m128, xmm', 'movups xmm, m128'], NONE);
sse(G_SSE, 'movss', 'Move a scalar single-precision float. Register→register preserves bits 32-127; memory→register zeroes them.', ['movss xmm/m32, xmm', 'movss xmm, m32'], NONE);
sse(G_SSE, 'movsd', 'SSE2: move a scalar double-precision float. (Not to be confused with the string instruction `movsl`.)', ['movsd xmm/m64, xmm', 'movsd xmm, m64'], NONE);
sse(G_SSE, 'movlps|movlpd', 'Move 64 bits to/from the low half of an XMM register.', ['movlps m64, xmm', 'movlps xmm, m64'], NONE);
sse(G_SSE, 'movhps|movhpd', 'Move 64 bits to/from the high half of an XMM register.', ['movhps m64, xmm', 'movhps xmm, m64'], NONE);
sse(G_SSE, 'movhlps', 'Move the high half of the source into the low half of the destination.', 'movhlps xmm, xmm', NONE);
sse(G_SSE, 'movlhps', 'Move the low half of the source into the high half of the destination.', 'movlhps xmm, xmm', NONE);
sse(G_SSE, 'movmskps|movmskpd', 'Extract the sign bits of packed floats into a general register.', 'movmskps xmm, r32', NONE);
sse(G_SSE, 'movddup', 'Duplicate the low double into both halves (SSE3).', 'movddup xmm/m64, xmm', NONE);
sse(G_SSE, 'movshdup|movsldup', 'Duplicate odd/even single-precision elements (SSE3).', 'movshdup xmm/m128, xmm', NONE);
sse(G_SSE, 'movntps|movntpd', 'Non-temporal store of packed floats.', 'movntps xmm, m128', NONE);
sse(G_INT, 'movdqa', 'Move aligned 128-bit integer data (16-byte alignment required for memory).', ['movdqa xmm/m128, xmm', 'movdqa xmm, m128'], NONE);
sse(G_INT, 'movdqu', 'Move unaligned 128-bit integer data.', ['movdqu xmm/m128, xmm', 'movdqu xmm, m128'], NONE);
sse(G_INT, 'movd', 'Move a 32-bit value between a general register / memory and an XMM or MMX register.', ['movd r/m32, xmm', 'movd xmm, r/m32'], NONE);
sse(G_INT, 'movq', 'SSE: move 64 bits between XMM, MMX, general registers and memory (in AT&T this is also the 64-bit suffix form of `mov`).', ['movq r/m64, xmm', 'movq xmm, r/m64', 'movq xmm/m64, xmm'], NONE);
sse(G_INT, 'movntdq', 'Non-temporal store of 128 bits.', 'movntdq xmm, m128', NONE);
sse(G_INT, 'movntdqa', 'Non-temporal aligned load of 128 bits (SSE4.1).', 'movntdqa m128, xmm', NONE);
sse(G_INT, 'lddqu', 'Unaligned 128-bit load optimised for cache-line splits (SSE3).', 'lddqu m128, xmm', NONE);
sse(G_INT, 'movq2dq', 'Move an MMX register into the low half of an XMM register.', 'movq2dq mm, xmm', NONE, true);
sse(G_INT, 'movdq2q', 'Move the low half of an XMM register into an MMX register.', 'movdq2q xmm, mm', NONE, true);
sse(G_INT, 'maskmovdqu', 'Byte-masked store to (%rdi).', 'maskmovdqu xmm_mask, xmm', NONE);

// compare & convert
sse(G_SSE, 'cmpps|cmppd|cmpss|cmpsd', 'Compare floats using an immediate predicate (0 eq, 1 lt, 2 le, 3 unord, 4 neq, 5 nlt, 6 nle, 7 ord). Result lanes are all-ones or all-zeros. Pseudo-ops such as `cmpltps` set the predicate for you.', 'cmpps $pred, xmm/m, xmm', NONE);
sse(G_SSE, 'comiss|comisd', 'Ordered compare of scalar floats; sets ZF, PF, CF (PF=1 means unordered/NaN).', 'comiss xmm/m32, xmm', 'ZF, PF, CF set; OF, SF, AF cleared');
sse(G_SSE, 'ucomiss|ucomisd', 'Unordered compare of scalar floats; sets ZF, PF, CF. Use `ja`/`jb` for the usual float comparison.', 'ucomisd xmm/m64, xmm', 'ZF, PF, CF set; OF, SF, AF cleared');
sse(G_SSE, 'cvtsi2ss|cvtsi2sd|cvtsi2ssl|cvtsi2ssq|cvtsi2sdl|cvtsi2sdq', 'Convert a signed integer to scalar float/double. Add `l`/`q` to give the integer width for a memory source.', 'cvtsi2sd{l,q} r/m, xmm', NONE);
sse(G_SSE, 'cvtss2si|cvtsd2si', 'Convert a scalar float/double to a signed integer using the current rounding mode.', 'cvtsd2si xmm/m, r32|r64', NONE);
sse(G_SSE, 'cvttss2si|cvttsd2si', 'Convert a scalar float/double to a signed integer with truncation toward zero.', 'cvttsd2si xmm/m, r32|r64', NONE);
sse(G_SSE, 'cvtss2sd', 'Convert scalar single to double.', 'cvtss2sd xmm/m32, xmm', NONE);
sse(G_SSE, 'cvtsd2ss', 'Convert scalar double to single.', 'cvtsd2ss xmm/m64, xmm', NONE);
sse(G_SSE, 'cvtps2pd|cvtpd2ps', 'Convert packed single↔double.', 'cvtps2pd xmm/m, xmm', NONE);
sse(G_SSE, 'cvtdq2ps|cvtdq2pd', 'Convert packed int32 to packed single / double.', 'cvtdq2ps xmm/m, xmm', NONE);
sse(G_SSE, 'cvtps2dq|cvtpd2dq', 'Convert packed float/double to packed int32 (current rounding mode).', 'cvtps2dq xmm/m, xmm', NONE);
sse(G_SSE, 'cvttps2dq|cvttpd2dq', 'Convert packed float/double to packed int32 with truncation.', 'cvttps2dq xmm/m, xmm', NONE);
sse(G_SSE, 'roundps|roundpd|roundss|roundsd', 'Round floats using an immediate mode (0 nearest, 1 floor, 2 ceil, 3 truncate) (SSE4.1).', 'roundsd $mode, xmm/m, xmm', NONE);
sse(G_SSE, 'dpps|dppd', 'Dot product of packed floats under an immediate mask (SSE4.1).', 'dpps $mask, xmm/m, xmm', NONE);
sse(G_SSE, 'haddps|haddpd', 'Horizontal add (SSE3).', 'haddps xmm/m, xmm', NONE);
sse(G_SSE, 'hsubps|hsubpd', 'Horizontal subtract (SSE3).', 'hsubps xmm/m, xmm', NONE);
sse(G_SSE, 'addsubps|addsubpd', 'Alternately subtract and add lanes (SSE3).', 'addsubps xmm/m, xmm', NONE);

// shuffles, unpack, blend, insert/extract
sse(G_SSE, 'shufps|shufpd', 'Shuffle packed floats selected by an immediate.', 'shufps $imm8, xmm/m, xmm', NONE);
sse(G_SSE, 'unpcklps|unpcklpd', 'Interleave the low halves of two registers.', 'unpcklps xmm/m, xmm', NONE);
sse(G_SSE, 'unpckhps|unpckhpd', 'Interleave the high halves of two registers.', 'unpckhps xmm/m, xmm', NONE);
sse(G_SSE, 'blendps|blendpd', 'Blend packed floats using an immediate mask (SSE4.1).', 'blendps $mask, xmm/m, xmm', NONE);
sse(G_SSE, 'blendvps|blendvpd', 'Blend packed floats using the sign bits of %xmm0 (SSE4.1).', 'blendvps %xmm0, xmm/m, xmm', NONE);
sse(G_SSE, 'insertps', 'Insert a single float from the source into the destination (SSE4.1).', 'insertps $imm8, xmm/m32, xmm', NONE);
sse(G_SSE, 'extractps', 'Extract a single float into a general register or memory (SSE4.1).', 'extractps $imm8, xmm, r/m32', NONE);
sse(G_INT, 'pshufd', 'Shuffle packed doublewords selected by an immediate.', 'pshufd $imm8, xmm/m128, xmm', NONE);
sse(G_INT, 'pshufhw|pshuflw', 'Shuffle the high/low four words.', 'pshufhw $imm8, xmm/m128, xmm', NONE);
sse(G_INT, 'pshufb', 'Shuffle bytes using the low nibble of each byte in the control operand (SSSE3). A byte with bit 7 set produces zero.', 'pshufb xmm/m128, xmm', NONE);
sse(G_INT, 'palignr', 'Concatenate and shift right by an immediate byte count (SSSE3).', 'palignr $imm8, xmm/m128, xmm', NONE);
sse(G_INT, 'punpcklbw|punpcklwd|punpckldq|punpcklqdq', 'Interleave the low elements of two registers.', 'punpcklbw xmm/m, xmm', NONE);
sse(G_INT, 'punpckhbw|punpckhwd|punpckhdq|punpckhqdq', 'Interleave the high elements of two registers.', 'punpckhbw xmm/m, xmm', NONE);
sse(G_INT, 'packsswb|packssdw', 'Pack signed words/dwords into signed bytes/words with saturation.', 'packsswb xmm/m, xmm', NONE);
sse(G_INT, 'packuswb|packusdw', 'Pack signed words/dwords into unsigned bytes/words with saturation.', 'packuswb xmm/m, xmm', NONE);
sse(G_INT, 'pblendw', 'Blend words by an immediate mask (SSE4.1).', 'pblendw $imm8, xmm/m, xmm', NONE);
sse(G_INT, 'pblendvb', 'Blend bytes using the sign bits of %xmm0 (SSE4.1).', 'pblendvb %xmm0, xmm/m, xmm', NONE);
sse(G_INT, 'pinsrb|pinsrw|pinsrd|pinsrq', 'Insert a byte/word/dword/qword from a general register or memory at an immediate index.', 'pinsrw $imm8, r/m, xmm', NONE);
sse(G_INT, 'pextrb|pextrw|pextrd|pextrq', 'Extract a byte/word/dword/qword at an immediate index.', 'pextrw $imm8, xmm, r/m', NONE);

// integer arithmetic
for (const w of ['b', 'w', 'd', 'q']) {
  const bits = { b: 8, w: 16, d: 32, q: 64 }[w];
  sse(G_INT, `padd${w}`, `Packed ${bits}-bit integer add (wraps).`, `padd${w} xmm/m, xmm`, NONE);
  sse(G_INT, `psub${w}`, `Packed ${bits}-bit integer subtract (wraps).`, `psub${w} xmm/m, xmm`, NONE);
  sse(G_INT, `pcmpeq${w}`, `Compare packed ${bits}-bit integers for equality (all-ones / all-zeros).`, `pcmpeq${w} xmm/m, xmm`, NONE);
  sse(G_INT, `pcmpgt${w}`, `Compare packed signed ${bits}-bit integers for greater-than.`, `pcmpgt${w} xmm/m, xmm`, NONE);
}
sse(G_INT, 'paddsb|paddsw', 'Packed signed add with saturation.', 'paddsb xmm/m, xmm', NONE);
sse(G_INT, 'paddusb|paddusw', 'Packed unsigned add with saturation.', 'paddusb xmm/m, xmm', NONE);
sse(G_INT, 'psubsb|psubsw', 'Packed signed subtract with saturation.', 'psubsb xmm/m, xmm', NONE);
sse(G_INT, 'psubusb|psubusw', 'Packed unsigned subtract with saturation.', 'psubusb xmm/m, xmm', NONE);
sse(G_INT, 'pmullw|pmulld', 'Packed multiply keeping the low 16/32 bits of each product (pmulld is SSE4.1).', 'pmullw xmm/m, xmm', NONE);
sse(G_INT, 'pmulhw|pmulhuw', 'Packed multiply keeping the high 16 bits (signed / unsigned).', 'pmulhw xmm/m, xmm', NONE);
sse(G_INT, 'pmuludq|pmuldq', 'Multiply the even dwords into 64-bit results (unsigned / signed).', 'pmuludq xmm/m, xmm', NONE);
sse(G_INT, 'pmaddwd', 'Multiply signed words and add adjacent pairs into dwords.', 'pmaddwd xmm/m, xmm', NONE);
sse(G_INT, 'pmaddubsw', 'Multiply unsigned×signed bytes and add adjacent pairs with saturation (SSSE3).', 'pmaddubsw xmm/m, xmm', NONE);
sse(G_INT, 'pavgb|pavgw', 'Packed unsigned average with rounding.', 'pavgb xmm/m, xmm', NONE);
sse(G_INT, 'pminub|pminuw|pminud|pminsb|pminsw|pminsd', 'Packed integer minimum (u = unsigned, s = signed).', 'pminud xmm/m, xmm', NONE);
sse(G_INT, 'pmaxub|pmaxuw|pmaxud|pmaxsb|pmaxsw|pmaxsd', 'Packed integer maximum (u = unsigned, s = signed).', 'pmaxud xmm/m, xmm', NONE);
sse(G_INT, 'pabsb|pabsw|pabsd', 'Packed absolute value (SSSE3).', 'pabsd xmm/m, xmm', NONE);
sse(G_INT, 'psignb|psignw|psignd', 'Negate, zero or keep elements depending on the sign of the source (SSSE3).', 'psignb xmm/m, xmm', NONE);
sse(G_INT, 'phaddw|phaddd|phaddsw', 'Horizontal packed add (SSSE3).', 'phaddw xmm/m, xmm', NONE);
sse(G_INT, 'phsubw|phsubd|phsubsw', 'Horizontal packed subtract (SSSE3).', 'phsubw xmm/m, xmm', NONE);
sse(G_INT, 'psadbw', 'Sum of absolute byte differences into two 64-bit lanes.', 'psadbw xmm/m, xmm', NONE);
sse(G_INT, 'pand', 'Bitwise AND of 128-bit integer data.', 'pand xmm/m, xmm', NONE);
sse(G_INT, 'pandn', 'Bitwise AND-NOT: dst = ~dst & src.', 'pandn xmm/m, xmm', NONE);
sse(G_INT, 'por', 'Bitwise OR of 128-bit integer data.', 'por xmm/m, xmm', NONE);
sse(G_INT, 'pxor', 'Bitwise XOR. `pxor %xmm0, %xmm0` zeroes a register.', 'pxor xmm/m, xmm', NONE);
sse(G_INT, 'psllw|pslld|psllq', 'Shift packed words/dwords/qwords left (immediate or xmm count).', 'pslld $imm8|xmm/m, xmm', NONE);
sse(G_INT, 'psrlw|psrld|psrlq', 'Logical shift packed elements right.', 'psrld $imm8|xmm/m, xmm', NONE);
sse(G_INT, 'psraw|psrad', 'Arithmetic shift packed words/dwords right.', 'psrad $imm8|xmm/m, xmm', NONE);
sse(G_INT, 'pslldq|psrldq', 'Shift the whole 128-bit register left/right by an immediate number of **bytes**.', 'pslldq $imm8, xmm', NONE);
sse(G_INT, 'pmovmskb', 'Collect the sign bit of every byte into a general register (one bit per byte). Key to fast strlen/memchr.', 'pmovmskb xmm, r32', NONE);
sse(G_INT, 'ptest', 'AND/ANDN test of two registers setting ZF and CF (SSE4.1).', 'ptest xmm/m, xmm', 'ZF, CF set; others cleared');
sse(G_INT, 'pcmpistri|pcmpistrm|pcmpestri|pcmpestrm', 'String compare with implicit/explicit lengths (SSE4.2). `...i` returns an index in %ecx, `...m` a mask in %xmm0.', 'pcmpistri $imm8, xmm/m128, xmm', 'CF, ZF, SF, OF');
sse(G_INT, 'pmovzxbw|pmovzxbd|pmovzxbq|pmovzxwd|pmovzxwq|pmovzxdq', 'Zero-extend packed small integers to wider ones (SSE4.1).', 'pmovzxbw xmm/m64, xmm', NONE);
sse(G_INT, 'pmovsxbw|pmovsxbd|pmovsxbq|pmovsxwd|pmovsxwq|pmovsxdq', 'Sign-extend packed small integers to wider ones (SSE4.1).', 'pmovsxbw xmm/m64, xmm', NONE);
sse(G_INT, 'phminposuw', 'Horizontal minimum of unsigned words with position (SSE4.1).', 'phminposuw xmm/m128, xmm', NONE);

// crypto
sse('Crypto', 'aesenc|aesenclast', 'One round of AES encryption (last round for `…last`).', 'aesenc xmm/m128, xmm', NONE);
sse('Crypto', 'aesdec|aesdeclast', 'One round of AES decryption (last round for `…last`).', 'aesdec xmm/m128, xmm', NONE);
sse('Crypto', 'aesimc', 'AES InvMixColumns transformation.', 'aesimc xmm/m128, xmm', NONE);
sse('Crypto', 'aeskeygenassist', 'Assist in AES round-key generation.', 'aeskeygenassist $imm8, xmm/m128, xmm', NONE);
sse('Crypto', 'pclmulqdq', 'Carry-less multiplication of selected quadwords (GF(2) polynomial multiply).', 'pclmulqdq $imm8, xmm/m128, xmm', NONE, false);
add('sha1rnds4|sha1nexte|sha1msg1|sha1msg2|sha256rnds2|sha256msg1|sha256msg2', 'Crypto', 'SHA-1 / SHA-256 acceleration instructions.', 'sha256rnds2 %xmm0, xmm/m128, xmm', NONE);

// MMX-only helpers
add('emms', 'MMX', 'Empty the MMX state; required before using x87 after MMX code.', 'emms', NONE);
add('ldmxcsr', G_SSE, 'Load the MXCSR control/status register.', 'ldmxcsr m32', NONE);
add('stmxcsr', G_SSE, 'Store the MXCSR control/status register.', 'stmxcsr m32', NONE);

// ---------------------------------------------------------------------------
// Derived VEX (AVX) forms of every SSE instruction above
// ---------------------------------------------------------------------------
for (const e of SSE_ENTRIES) {
  for (const n of e.names.split('|')) {
    const vname = 'v' + n;
    put(vname, {
      name: vname,
      group: 'AVX',
      summary:
        `VEX-encoded form of **${n}**. ${e.summary} ` +
        'Arithmetic and logic forms gain a separate destination (`' + vname + ' src2, src1, dst`, non-destructive); ' +
        'move, convert, compare and unary forms keep the legacy operand count. ' +
        'The upper bits of the destination YMM/ZMM register are zeroed, and packed forms also accept %ymm operands.',
      forms: e.forms.map((f) => 'v' + f),
      flags: e.flags
    });
  }
}

// ---------------------------------------------------------------------------
// AVX / AVX2 / FMA / AVX-512 extras (not derived from SSE)
// ---------------------------------------------------------------------------
const G_AVX = 'AVX';
add('vzeroupper', G_AVX, 'Zero bits 128-255 of all YMM registers. Execute before calling non-AVX code to avoid SSE/AVX transition penalties.', 'vzeroupper', NONE);
add('vzeroall', G_AVX, 'Zero all YMM registers.', 'vzeroall', NONE);
add('vbroadcastss|vbroadcastsd', G_AVX, 'Broadcast a scalar float/double from memory (AVX2: also from xmm) to all lanes.', 'vbroadcastss m32|xmm, ymm', NONE);
add('vbroadcastf128|vbroadcasti128', G_AVX, 'Broadcast a 128-bit value to both halves of a YMM register.', 'vbroadcastf128 m128, ymm', NONE);
add('vperm2f128|vperm2i128', G_AVX, 'Select 128-bit halves from two sources via an immediate.', 'vperm2f128 $imm8, ymm/m256, ymm, ymm', NONE);
add('vpermilps|vpermilpd', G_AVX, 'Permute within each 128-bit lane.', 'vpermilps $imm8|ymm/m, ymm/m, ymm', NONE);
add('vpermq|vpermpd', G_AVX, 'Permute 64-bit elements across a 256-bit register (AVX2).', 'vpermq $imm8, ymm/m256, ymm', NONE);
add('vpermd|vpermps', G_AVX, 'Permute 32-bit elements across a 256-bit register using index vector (AVX2).', 'vpermd ymm/m256, ymm_idx, ymm', NONE);
add('vextractf128|vextracti128', G_AVX, 'Extract a 128-bit half from a YMM register.', 'vextractf128 $imm8, ymm, xmm/m128', NONE);
add('vinsertf128|vinserti128', G_AVX, 'Insert a 128-bit value into half of a YMM register.', 'vinsertf128 $imm8, xmm/m128, ymm, ymm', NONE);
add('vmaskmovps|vmaskmovpd|vpmaskmovd|vpmaskmovq', G_AVX, 'Masked load/store of packed elements.', 'vmaskmovps m256, ymm_mask, ymm', NONE);
add('vpbroadcastb|vpbroadcastw|vpbroadcastd|vpbroadcastq', G_AVX, 'Broadcast a byte/word/dword/qword to all lanes (AVX2).', 'vpbroadcastd xmm/m32, ymm', NONE);
add('vtestps|vtestpd', G_AVX, 'Test sign bits of packed floats, setting ZF and CF.', 'vtestps ymm/m, ymm', 'ZF, CF');
add('vcvtph2ps|vcvtps2ph', G_AVX, 'Convert between half- and single-precision floats (F16C).', 'vcvtph2ps xmm/m64, ymm', NONE);
add('vpsllvd|vpsllvq|vpsrlvd|vpsrlvq|vpsravd', G_AVX, 'Per-element variable shifts (AVX2).', 'vpsllvd ymm/m256, ymm, ymm', NONE);
add('vpblendd', G_AVX, 'Blend dwords by an immediate mask (AVX2).', 'vpblendd $imm8, ymm/m256, ymm, ymm', NONE);
add('vgatherdps|vgatherdpd|vgatherqps|vgatherqpd|vpgatherdd|vpgatherdq|vpgatherqd|vpgatherqq', G_AVX, 'Gather elements from memory using vector indices under a mask (AVX2).', 'vgatherdps ymm_mask, vsib, ymm', NONE);
for (const op of ['fmadd', 'fmsub', 'fnmadd', 'fnmsub']) {
  const desc = { fmadd: 'a*b + c', fmsub: 'a*b - c', fnmadd: '-(a*b) + c', fnmsub: '-(a*b) - c' }[op];
  for (const order of ['132', '213', '231']) {
    const names = ['ps', 'pd', 'ss', 'sd'].map((t) => `v${op}${order}${t}`).join('|');
    const sem = { 132: 'dst = dst*src3 ± src2', 213: 'dst = src2*dst ± src3', 231: 'dst = src2*src3 ± dst' }[order];
    add(names, 'FMA', `Fused multiply-add family (${desc}) with a single rounding. Operand order ${order}: ${sem}.`, `v${op}${order}ps ymm/m, ymm, ymm`, 'MXCSR');
  }
}
add('vfmaddsub132ps|vfmaddsub213ps|vfmaddsub231ps|vfmaddsub132pd|vfmaddsub213pd|vfmaddsub231pd|vfmsubadd132ps|vfmsubadd213ps|vfmsubadd231ps|vfmsubadd132pd|vfmsubadd213pd|vfmsubadd231pd', 'FMA', 'Fused multiply with alternating add/subtract across lanes.', 'vfmaddsub213ps ymm/m, ymm, ymm', 'MXCSR');
add('vmovdqa32|vmovdqa64|vmovdqu8|vmovdqu16|vmovdqu32|vmovdqu64', 'AVX-512', 'AVX-512 integer moves with element width for masking: `vmovdqu8 (%rsi), %zmm0{%k1}{z}`.', 'vmovdqu64 zmm/m512, zmm', NONE);
add('vpternlogd|vpternlogq', 'AVX-512', 'Bitwise ternary logic: the immediate is a truth table over three inputs.', 'vpternlogd $imm8, zmm/m512, zmm, zmm', NONE);
add('kmovb|kmovw|kmovd|kmovq', 'AVX-512', 'Move between opmask registers, general registers and memory.', 'kmovw %k1, %eax', NONE);
add('kortestb|kortestw|kortestd|kortestq|ktestb|ktestw|ktestd|ktestq', 'AVX-512', 'Test opmask registers, setting ZF/CF.', 'kortestw %k1, %k2', 'ZF, CF');
add('kandb|kandw|kandd|kandq|korb|korw|kord|korq|kxorb|kxorw|kxord|kxorq|knotb|knotw|knotd|knotq', 'AVX-512', 'Logical operations on opmask registers.', 'kandw %k1, %k2, %k3', NONE);
add('vpopcntd|vpopcntq|vpopcntb|vpopcntw', 'AVX-512', 'Population count per element (AVX512_VPOPCNTDQ / BITALG).', 'vpopcntd zmm/m512, zmm', NONE);

// ---------------------------------------------------------------------------
// Lookup API
// ---------------------------------------------------------------------------

/** Mnemonics that accept an AT&T size suffix (b/w/l/q) on top of the base name. */
const SUFFIX_BASES = new Set(
  (
    'mov add adc sub sbb inc dec neg not cmp mul imul div idiv and or xor test shl sal shr sar rol ror rcl rcr shld shrd ' +
    'xchg xadd cmpxchg lea push pop bt bts btr btc bsf bsr popcnt lzcnt tzcnt call jmp ret leave iret pushf popf nop in out ' +
    'movs cmps scas lods stos ins outs crc32 enter lret movbe cmov'
  ).split(' ')
);

/** Mnemonics whose size is determined by a register operand and that require a suffix otherwise. */
const SIZE_REQUIRED = new Set(
  'mov add adc sub sbb inc dec neg not cmp mul imul div idiv and or xor test shl sal shr sar rol ror rcl rcr bt bts btr btc'.split(' ')
);
const SHIFTS = new Set('shl sal shr sar rol ror rcl rcr'.split(' '));
const SUFFIX_BITS = { b: 8, w: 16, l: 32, q: 64 };

function isBranch(name) {
  const n = name.toLowerCase();
  return /^(j[a-z]{1,4}|call[bwlq]?|loop(n?[ez])?|lcall|ljmp|xbegin)$/.test(n);
}

/**
 * Find documentation entries for a mnemonic. Returns [] if unknown.
 * Handles AT&T size suffixes (`movl`, `addq`) by falling back to the base.
 */
function lookupInstruction(name) {
  if (!name) return [];
  const n = name.toLowerCase();
  const out = [];
  const exact = DB.get(n);
  if (exact) out.push(...exact);
  const last = n[n.length - 1];
  if (n.length > 2 && 'bwlq'.includes(last)) {
    const base = n.slice(0, -1);
    if (SUFFIX_BASES.has(base) || /^cmov[a-z]+$/.test(base)) {
      const list = DB.get(base) || [];
      for (const e of list) {
        out.push(Object.assign({}, e, { viaSuffix: last, requested: n }));
      }
    }
  }
  return out;
}

function isKnownMnemonic(name) {
  return lookupInstruction(name).length > 0;
}

/** All distinct mnemonics (first entry per name), for completion. */
function allMnemonics() {
  return Array.from(DB.entries()).map(([name, list]) => ({ name, entries: list }));
}

const SUFFIX_NAMES = { b: 'byte (8-bit)', w: 'word (16-bit)', l: 'long (32-bit)', q: 'quad (64-bit)' };

/** Markdown for hover. */
function instructionMarkdown(entries, shown) {
  const parts = [];
  for (const e of entries) {
    const title = e.viaSuffix ? `**${shown || e.requested}** — \`${e.name}\` with the \`${e.viaSuffix}\` suffix (${SUFFIX_NAMES[e.viaSuffix]} operands)` : `**${e.name}**`;
    const lines = [`${title} — *${e.group}*`, '', e.summary];
    if (e.forms.length) lines.push('', '```gas', ...e.forms, '```');
    if (e.flags) lines.push('', `**Flags:** ${e.flags}`);
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n---\n\n');
}

module.exports = {
  DB,
  SUFFIX_BASES,
  SIZE_REQUIRED,
  SHIFTS,
  SUFFIX_BITS,
  isBranch,
  lookupInstruction,
  isKnownMnemonic,
  allMnemonics,
  instructionMarkdown
};
