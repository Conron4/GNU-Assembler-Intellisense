'use strict';
/** GNU as (binutils) directives relevant to x86-64 ELF targets. */

// [name(s) separated by '|', category, summary, syntax]
const RAW = [
  // ---- sections ----------------------------------------------------------
  ['section', 'Sections', 'Switch to the named section, creating it if needed. Flags: `a` alloc, `w` write, `x` exec, `M` merge, `S` strings, `G` group, `T` TLS, `o` link-order.', '.section name[, "flags"[, @type[, entsize]]]'],
  ['text', 'Sections', 'Switch to the `.text` (code) section.', '.text [subsection]'],
  ['data', 'Sections', 'Switch to the `.data` (initialised, writable data) section.', '.data [subsection]'],
  ['bss', 'Sections', 'Switch to the `.bss` (zero-initialised data) section.', '.bss [subsection]'],
  ['pushsection', 'Sections', 'Push the current section on a stack and switch to another. Undo with `.popsection`.', '.pushsection name[, "flags"[, @type]]'],
  ['popsection', 'Sections', 'Return to the section saved by the matching `.pushsection`.', '.popsection'],
  ['previous', 'Sections', 'Swap back to the previously active section.', '.previous'],
  ['subsection', 'Sections', 'Select a numbered subsection of the current section.', '.subsection n'],
  ['org', 'Sections', 'Advance the location counter to an offset inside the current section, padding with `fill`.', '.org new-lc[, fill]'],

  // ---- alignment ---------------------------------------------------------
  ['align', 'Alignment', 'Align the location counter. On x86 ELF the argument is a **byte** count (same as `.balign`).', '.align abs-expr[, fill[, max-skip]]'],
  ['balign|balignw|balignl', 'Alignment', 'Align to a power-of-two byte boundary. `w`/`l` variants fill with 16/32-bit values.', '.balign bytes[, fill[, max-skip]]'],
  ['p2align|p2alignw|p2alignl', 'Alignment', 'Align to 2^n bytes. Common: `.p2align 4` (16 bytes) before hot loops or functions.', '.p2align power[, fill[, max-skip]]'],

  // ---- symbols -----------------------------------------------------------
  ['globl|global', 'Symbols', 'Make symbols visible to the linker (external linkage).', '.globl symbol[, symbol…]'],
  ['local', 'Symbols', 'Mark symbols as local (not exported).', '.local symbol[, symbol…]'],
  ['weak', 'Symbols', 'Mark symbols as weak: they may be overridden by a strong definition and may stay undefined.', '.weak symbol[, symbol…]'],
  ['extern', 'Symbols', 'Accepted for compatibility; undefined symbols are treated as external automatically.', '.extern symbol'],
  ['hidden', 'Symbols', 'ELF visibility: not exported from the shared object.', '.hidden symbol[, symbol…]'],
  ['internal', 'Symbols', 'ELF visibility: internal (stricter than hidden).', '.internal symbol[, symbol…]'],
  ['protected', 'Symbols', 'ELF visibility: exported but not preemptible.', '.protected symbol[, symbol…]'],
  ['type', 'Symbols', 'Set the ELF symbol type: `@function`, `@object`, `@tls_object`, `@notype`, `@common`, `@gnu_indirect_function`.', '.type name, @function'],
  ['size', 'Symbols', 'Set the size of a symbol, usually `.-name` right after the function body.', '.size name, expression'],
  ['set', 'Symbols', 'Assign a (re-definable) value to a symbol.', '.set symbol, expression'],
  ['equ', 'Symbols', 'Assign a value to a symbol. Same as `.set`.', '.equ symbol, expression'],
  ['equiv', 'Symbols', 'Like `.equ`, but errors if the symbol is already defined.', '.equiv symbol, expression'],
  ['eqv', 'Symbols', 'Like `.equiv`, but the expression is evaluated lazily.', '.eqv symbol, expression'],
  ['comm', 'Symbols', 'Declare a common symbol of the given size and optional alignment.', '.comm symbol, length[, alignment]'],
  ['lcomm', 'Symbols', 'Reserve zero-initialised local storage in `.bss`.', '.lcomm symbol, length[, alignment]'],
  ['symver', 'Symbols', 'Bind a symbol to a version node.', '.symver name, name2@nodename'],
  ['weakref', 'Symbols', 'Declare a weak reference alias.', '.weakref alias, target'],
  ['linkonce', 'Symbols', 'Mark the section as link-once (COMDAT-like).', '.linkonce [type]'],
  ['ident', 'Symbols', 'Add a string to the `.comment` section.', '.ident "string"'],
  ['file', 'Symbols', 'Set the source file name recorded in the symbol table (and DWARF file 1 with `.file n "name"`).', '.file "name"'],
  ['reloc', 'Symbols', 'Emit an explicit relocation.', '.reloc offset, reloc_name[, expression]'],

  // ---- data --------------------------------------------------------------
  ['byte', 'Data', 'Emit 1-byte values.', '.byte expr[, expr…]'],
  ['word|short|value|hword|2byte', 'Data', 'Emit 2-byte (16-bit) values on x86.', '.word expr[, expr…]'],
  ['int|long|4byte', 'Data', 'Emit 4-byte (32-bit) values.', '.long expr[, expr…]'],
  ['quad|8byte', 'Data', 'Emit 8-byte (64-bit) values.', '.quad expr[, expr…]'],
  ['octa', 'Data', 'Emit 16-byte (128-bit) integers.', '.octa bignum[, bignum…]'],
  ['float|single', 'Data', 'Emit IEEE single-precision (32-bit) floats.', '.float 3.14[, …]'],
  ['double', 'Data', 'Emit IEEE double-precision (64-bit) floats.', '.double 3.14[, …]'],
  ['ascii', 'Data', 'Emit strings **without** a trailing NUL.', '.ascii "string"[, "string"…]'],
  ['asciz|string', 'Data', 'Emit NUL-terminated strings.', '.asciz "string"[, "string"…]'],
  ['string8|string16|string32|string64', 'Data', 'Emit NUL-terminated strings with 8/16/32/64-bit characters.', '.string16 "string"'],
  ['zero', 'Data', 'Emit N zero bytes.', '.zero count'],
  ['space|skip', 'Data', 'Reserve N bytes filled with a value (default 0).', '.space count[, fill]'],
  ['fill', 'Data', 'Emit `repeat` copies of a `size`-byte `value`.', '.fill repeat[, size[, value]]'],
  ['sleb128', 'Data', 'Emit signed LEB128-encoded values.', '.sleb128 expr[, expr…]'],
  ['uleb128', 'Data', 'Emit unsigned LEB128-encoded values.', '.uleb128 expr[, expr…]'],
  ['incbin', 'Data', 'Include a binary file verbatim.', '.incbin "file"[, skip[, count]]'],
  ['nops', 'Data', 'Emit optimal multi-byte NOP padding.', '.nops size[, control]'],
  ['nop', 'Data', 'Emit a single one-byte NOP (directive form).', '.nop'],

  // ---- macros & control --------------------------------------------------
  ['macro', 'Macros', 'Define a macro. Parameters can have defaults (`a=1`), be required (`a:req`) or variadic (`a:vararg`). Reference them as `\\a`; `\\@` is a unique counter.', '.macro name [param[=default]…]'],
  ['endm', 'Macros', 'End a macro definition.', '.endm'],
  ['exitm', 'Macros', 'Leave the current macro expansion early.', '.exitm'],
  ['purgem', 'Macros', 'Undefine a macro.', '.purgem name'],
  ['altmacro', 'Macros', 'Enable alternate macro syntax (`%expr`, `<string>`, `LOCAL`).', '.altmacro'],
  ['noaltmacro', 'Macros', 'Disable alternate macro syntax.', '.noaltmacro'],
  ['rept', 'Macros', 'Repeat the lines up to `.endr` a given number of times.', '.rept count'],
  ['irp', 'Macros', 'Repeat the block once per argument, substituting `\\symbol`.', '.irp symbol, value[, value…]'],
  ['irpc', 'Macros', 'Repeat the block once per character of a string.', '.irpc symbol, string'],
  ['endr', 'Macros', 'End a `.rept`/`.irp`/`.irpc` block.', '.endr'],
  ['include', 'Macros', 'Insert the contents of another source file here.', '.include "file"'],

  // ---- conditionals ------------------------------------------------------
  ['if', 'Conditionals', 'Assemble the following block if the expression is non-zero.', '.if expression'],
  ['ifdef', 'Conditionals', 'Assemble the block if the symbol is defined.', '.ifdef symbol'],
  ['ifndef|ifnotdef', 'Conditionals', 'Assemble the block if the symbol is not defined.', '.ifndef symbol'],
  ['ifb', 'Conditionals', 'Assemble the block if the argument is blank.', '.ifb text'],
  ['ifnb', 'Conditionals', 'Assemble the block if the argument is not blank.', '.ifnb text'],
  ['ifc', 'Conditionals', 'Assemble the block if two strings are equal.', '.ifc string1, string2'],
  ['ifnc', 'Conditionals', 'Assemble the block if two strings differ.', '.ifnc string1, string2'],
  ['ifeq', 'Conditionals', 'Assemble the block if the expression equals zero.', '.ifeq expression'],
  ['ifne', 'Conditionals', 'Assemble the block if the expression is not zero.', '.ifne expression'],
  ['ifge', 'Conditionals', 'Assemble the block if the expression is ≥ 0.', '.ifge expression'],
  ['ifgt', 'Conditionals', 'Assemble the block if the expression is > 0.', '.ifgt expression'],
  ['ifle', 'Conditionals', 'Assemble the block if the expression is ≤ 0.', '.ifle expression'],
  ['iflt', 'Conditionals', 'Assemble the block if the expression is < 0.', '.iflt expression'],
  ['ifeqs', 'Conditionals', 'Assemble the block if two strings are equal (quoted).', '.ifeqs "a", "b"'],
  ['ifnes', 'Conditionals', 'Assemble the block if two strings differ (quoted).', '.ifnes "a", "b"'],
  ['else', 'Conditionals', 'Alternative branch of a conditional block.', '.else'],
  ['elseif', 'Conditionals', 'Alternative branch with a new condition.', '.elseif expression'],
  ['endif', 'Conditionals', 'End a conditional block.', '.endif'],

  // ---- diagnostics -------------------------------------------------------
  ['error', 'Diagnostics', 'Print an error message and fail the assembly.', '.error "message"'],
  ['err', 'Diagnostics', 'Print a generic error and fail the assembly.', '.err'],
  ['warning', 'Diagnostics', 'Print a warning message.', '.warning "message"'],
  ['print', 'Diagnostics', 'Print a string to standard output during assembly.', '.print "string"'],
  ['fail', 'Diagnostics', 'Emit an error (or warning if the value is < 500).', '.fail expression'],
  ['abort', 'Diagnostics', 'Abort assembly immediately.', '.abort'],

  // ---- machine -----------------------------------------------------------
  ['code64', 'Machine', 'Assemble 64-bit code (the default for `--64`).', '.code64'],
  ['code32', 'Machine', 'Assemble 32-bit code.', '.code32'],
  ['code16', 'Machine', 'Assemble 16-bit code.', '.code16'],
  ['code16gcc', 'Machine', 'Assemble 16-bit code for GCC output.', '.code16gcc'],
  ['arch', 'Machine', 'Select the target CPU / instruction-set extensions.', '.arch cpu[, +extension…]'],
  ['intel_syntax', 'Machine', 'Switch to Intel syntax. `noprefix` drops the `%` register prefix.', '.intel_syntax [noprefix|prefix]'],
  ['att_syntax', 'Machine', 'Switch back to AT&T syntax (the default).', '.att_syntax [prefix|noprefix]'],
  ['intel_mnemonic', 'Machine', 'Use Intel mnemonics (e.g. `fsub` semantics) in AT&T syntax.', '.intel_mnemonic'],
  ['att_mnemonic', 'Machine', 'Use AT&T mnemonics (the default).', '.att_mnemonic'],
  ['arch_extension', 'Machine', 'Enable or disable an architecture extension.', '.arch_extension name'],
  ['secrel32', 'Machine', 'Section-relative 32-bit value (PE targets).', '.secrel32 symbol'],

  // ---- struct ------------------------------------------------------------
  ['struct', 'Layout', 'Switch to the absolute section at the given offset; labels become field offsets.', '.struct expression'],

  // ---- listing -----------------------------------------------------------
  ['list', 'Listing', 'Turn assembly listing output on.', '.list'],
  ['nolist', 'Listing', 'Turn assembly listing output off.', '.nolist'],
  ['eject', 'Listing', 'Force a page break in listings.', '.eject'],
  ['title', 'Listing', 'Set the listing title.', '.title "heading"'],
  ['sbttl', 'Listing', 'Set the listing subtitle.', '.sbttl "subheading"'],
  ['psize', 'Listing', 'Set listing page size.', '.psize lines[, columns]'],

  // ---- debug -------------------------------------------------------------
  ['loc', 'Debug', 'Emit a DWARF line-number entry.', '.loc fileno lineno [column] [options]'],
  ['line', 'Debug', 'Set the logical line number (COFF).', '.line n'],
  ['stabs', 'Debug', 'Emit a stab debugging entry.', '.stabs "string", type, other, desc, value'],
  ['stabn', 'Debug', 'Emit a stab entry without a string.', '.stabn type, other, desc, value'],
  ['stabd', 'Debug', 'Emit a dot stab entry.', '.stabd type, other, desc'],
  ['def', 'Debug', 'Begin a COFF symbol definition.', '.def name'],
  ['endef', 'Debug', 'End a COFF symbol definition.', '.endef'],
  ['scl', 'Debug', 'Set COFF storage class.', '.scl class'],
  ['tag', 'Debug', 'Set COFF struct tag.', '.tag structname'],
  ['val', 'Debug', 'Set COFF symbol value.', '.val addr'],
  ['dim', 'Debug', 'Set COFF array dimensions.', '.dim dim[, dim…]'],

  // ---- CFI ---------------------------------------------------------------
  ['cfi_startproc', 'CFI', 'Begin a function for DWARF call-frame information. Add `simple` to skip default initial rules.', '.cfi_startproc [simple]'],
  ['cfi_endproc', 'CFI', 'End the function opened by `.cfi_startproc`.', '.cfi_endproc'],
  ['cfi_sections', 'CFI', 'Choose where CFI is emitted (`.eh_frame` and/or `.debug_frame`).', '.cfi_sections .eh_frame[, .debug_frame]'],
  ['cfi_def_cfa', 'CFI', 'Define the CFA as register + offset.', '.cfi_def_cfa register, offset'],
  ['cfi_def_cfa_register', 'CFI', 'Change the CFA register, keep the offset.', '.cfi_def_cfa_register register'],
  ['cfi_def_cfa_offset', 'CFI', 'Change the CFA offset, keep the register.', '.cfi_def_cfa_offset offset'],
  ['cfi_adjust_cfa_offset', 'CFI', 'Add a delta to the CFA offset (after `push`/`sub %rsp`).', '.cfi_adjust_cfa_offset delta'],
  ['cfi_offset', 'CFI', 'Register is saved at CFA + offset.', '.cfi_offset register, offset'],
  ['cfi_rel_offset', 'CFI', 'Register is saved at (CFA register) + offset.', '.cfi_rel_offset register, offset'],
  ['cfi_restore', 'CFI', 'Register has been restored to its initial rule.', '.cfi_restore register'],
  ['cfi_undefined', 'CFI', 'Register value cannot be unwound.', '.cfi_undefined register'],
  ['cfi_same_value', 'CFI', 'Register holds its caller value.', '.cfi_same_value register'],
  ['cfi_register', 'CFI', 'Register is saved in another register.', '.cfi_register reg1, reg2'],
  ['cfi_remember_state', 'CFI', 'Push the current CFI rules.', '.cfi_remember_state'],
  ['cfi_restore_state', 'CFI', 'Pop CFI rules saved by `.cfi_remember_state`.', '.cfi_restore_state'],
  ['cfi_personality', 'CFI', 'Set the personality routine.', '.cfi_personality encoding[, symbol]'],
  ['cfi_lsda', 'CFI', 'Set the language-specific data area.', '.cfi_lsda encoding[, symbol]'],
  ['cfi_escape', 'CFI', 'Emit raw DWARF CFI bytes.', '.cfi_escape expr[, expr…]'],
  ['cfi_signal_frame', 'CFI', 'Mark the frame as a signal frame.', '.cfi_signal_frame'],
  ['cfi_return_column', 'CFI', 'Set the return-address column.', '.cfi_return_column register'],
  ['cfi_val_offset', 'CFI', 'Register value is CFA + offset.', '.cfi_val_offset register, offset'],
  ['cfi_def_cfa_expression', 'CFI', 'Define the CFA with a DWARF expression.', '.cfi_def_cfa_expression expr'],
  ['cfi_expression', 'CFI', 'Register saved at a DWARF-expression address.', '.cfi_expression register, expr'],
  ['cfi_val_expression', 'CFI', 'Register value is a DWARF expression.', '.cfi_val_expression register, expr'],
  ['cfi_label', 'CFI', 'Emit a label that tracks CFI position.', '.cfi_label name'],
  ['cfi_window_save', 'CFI', 'Register-window save (SPARC; accepted for compatibility).', '.cfi_window_save'],
  ['cfi_inline_lsda', 'CFI', 'Inline the LSDA after the function.', '.cfi_inline_lsda align']
];

const DIRECTIVES = new Map(); // ".name" (lowercase) -> entry

for (const [names, category, summary, syntax] of RAW) {
  for (const n of names.split('|')) {
    DIRECTIVES.set('.' + n, { name: '.' + n, category, summary, syntax });
  }
}

function getDirective(name) {
  if (!name) return undefined;
  const n = name.toLowerCase();
  return DIRECTIVES.get(n);
}

/** Is this a known directive? Handles `.2byte`-like variants and .cfi_* */
function isKnownDirective(name) {
  const n = name.toLowerCase();
  return DIRECTIVES.has(n) || /^\.\d+byte$/.test(n) || /^\.dc(\.[a-z])?$/.test(n);
}

function directiveMarkdown(d) {
  return [`**${d.name}** — *${d.category} directive*`, '', d.summary, '', '```gas', d.syntax, '```'].join('\n');
}

const SECTION_NAMES = [
  ['.text', 'Executable code'],
  ['.data', 'Initialised writable data'],
  ['.bss', 'Zero-initialised data'],
  ['.rodata', 'Read-only data'],
  ['.rodata.str1.1', 'Mergeable read-only strings'],
  ['.tdata', 'Initialised thread-local data'],
  ['.tbss', 'Zero-initialised thread-local data'],
  ['.init_array', 'Constructor function pointers'],
  ['.fini_array', 'Destructor function pointers'],
  ['.note.GNU-stack', 'Marks the stack non-executable (use with "", @progbits)'],
  ['.eh_frame', 'Exception-handling frame data'],
  ['.comment', 'Compiler / assembler version strings'],
  ['.data.rel.ro', 'Relocated read-only data'],
  ['.init', 'Process initialisation code'],
  ['.fini', 'Process termination code']
];

const SECTION_FLAGS = [
  ['"a"', 'allocatable (read-only data)'],
  ['"aw"', 'allocatable, writable'],
  ['"ax"', 'allocatable, executable'],
  ['"awx"', 'allocatable, writable, executable'],
  ['"aMS"', 'mergeable strings (also give @progbits, entsize)'],
  ['"awT"', 'allocatable, writable, thread-local'],
  ['""', 'no flags (e.g. .note.GNU-stack)']
];

const SECTION_TYPES = ['@progbits', '@nobits', '@note', '@init_array', '@fini_array', '@preinit_array'];
const SYMBOL_TYPES = ['@function', '@object', '@tls_object', '@notype', '@common', '@gnu_indirect_function'];
const RELOCATIONS = [
  ['@plt', 'Call through the procedure linkage table'],
  ['@PLT', 'Call through the procedure linkage table'],
  ['@GOTPCREL', 'RIP-relative reference to the symbol\'s GOT entry'],
  ['@GOT', 'Offset of the GOT entry'],
  ['@GOTOFF', 'Offset relative to the GOT'],
  ['@TPOFF', 'Thread-pointer-relative offset (local-exec TLS)'],
  ['@GOTTPOFF', 'GOT entry holding the TLS offset (initial-exec TLS)'],
  ['@TLSGD', 'TLS general-dynamic model'],
  ['@TLSLD', 'TLS local-dynamic model'],
  ['@DTPOFF', 'Offset within the TLS block (local-dynamic)'],
  ['@SIZE', 'Size of the symbol']
];

module.exports = {
  DIRECTIVES,
  getDirective,
  isKnownDirective,
  directiveMarkdown,
  SECTION_NAMES,
  SECTION_FLAGS,
  SECTION_TYPES,
  SYMBOL_TYPES,
  RELOCATIONS
};
