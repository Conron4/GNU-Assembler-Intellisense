# GNU Assembler (x86-64, AT&T) for VS Code

Full language support for **GNU as (GAS)** x86-64 assembly: `.s`, `.S`, `.gas`, `.att`.
AT&T syntax is the default; `.intel_syntax noprefix … .att_syntax` regions are highlighted and understood too.
No build step and no runtime dependencies.

## Features

| Area | What you get |
|---|---|
| **Highlighting** | TextMate grammar (labels, local `1:`/`.L` labels, directives, registers by class, immediates, relocations such as `@PLT`, macros `\arg`, `#include/#define` in `.S` files, Intel regions) plus **semantic highlighting** that colours functions, data, constants, macros and labels by what they really are |
| **Completion** | ~1000 mnemonics (integer, x87, SSE→SSE4.2, AES/SHA, BMI, AVX/AVX2/FMA, AVX-512 basics), ~150 directives, all registers (`%` trigger), your own labels/constants/macros (workspace-wide), section names/flags/types, `@relocations`, 27 snippets |
| **Hover** | Instruction docs with forms and flag effects (also for suffixed forms like `movl`/`addq`), directive docs, register docs with System V ABI roles, number conversions (hex/bin/signed), symbol definitions with doc-comments, `1b`/`1f` targets, **Linux syscall names** for `syscall` and `mov $N, %eax` |
| **Signature help** | Operand forms while typing instruction operands |
| **Navigation** | Go to definition / declaration (incl. `1b`/`1f`), references, highlights, rename (workspace-wide), outline (sections › functions › labels), breadcrumbs, Ctrl+T workspace symbols, folding (macros, `.if`, functions, comments), clickable `.include` / `#include` paths |
| **Diagnostics** | Built-in checks: unbalanced `.macro/.if/.rept`, duplicate labels, missing `1f`/`1b` targets, unknown directives, Intel-style registers without `%`, bare numbers that should be `$imm`, ambiguous operand size (`mov $1, (%rax)`), suffix/register size mismatch (`movl %rax, …`). Plus **real `as` errors** inline (on save or while typing) |
| **Quick fixes** | Add `%` / `$`, pick a size suffix, correct the suffix |
| **Formatter** | Aligns labels, mnemonics, operands and trailing comments; format document/selection; optional mnemonic case |
| **Commands** | Assemble, Assemble+Link, Build+Run in terminal, Show disassembly (objdump), Instruction lookup, Insert syscall |

## Requirements

Only for the build/diagnostic commands: GNU binutils (`as`, `ld`, `objdump`) — and `gcc` for `.S` files.
On Windows use WSL or MSYS2/MinGW and point the `gas.*.path` settings at them.

## Commands (Command Palette → "GAS: …")

| Command | Description |
|---|---|
| Assemble Current File | `as` → `build/<name>.o`, errors appear in Problems |
| Assemble and Link | `as` + `ld` → `build/<name>` |
| Build and Run in Terminal | builds, then runs the executable |
| Show Disassembly | `objdump -d -M att` of the assembled object, beside the editor |
| Look Up Instruction or Directive | searchable reference |
| Insert Linux x86-64 System Call | picks a syscall and inserts `mov $N, %eax` / `syscall` with argument-register hints |
| Run Assembler Diagnostics Now / Rebuild Workspace Symbol Index | housekeeping |

## Settings (excerpt)

| Setting | Default | Notes |
|---|---|---|
| `gas.assembler.path` / `gas.assembler.args` | `as` / `["--64"]` | add `-g`, `--defsym` … |
| `gas.linker.path` / `gas.linker.args` | `ld` / `[]` | use `gcc` + `["-no-pie"]` for libc programs |
| `gas.lint.assembler` | `onSave` | `off`, `onSave`, `onType` |
| `gas.lint.unknownInstructions` | `false` | the instruction DB is not exhaustive for AVX-512 |
| `gas.lint.undefinedSymbols` | `false` | report symbols defined nowhere in the workspace |
| `gas.format.*` | 4 / 8 / col 40 | indent, mnemonic width, comment column, tabs, case |
| `gas.includePaths` | `[]` | `-I` dirs and `.include` link resolution |
| `gas.workspace.include` | `**/*.{s,S,inc,gas}` | files indexed for cross-file features |

## Notes on `.S` files and the preprocessor

`#define`, `#include`, `#if…` lines are recognised (write them without a space after `#`; `# if` is a comment, as in GAS).
Diagnostics for `.S` files run through `gcc -x assembler-with-cpp`.

## Example

`examples/hello.s` (plain GAS) and `examples/features.S` (macros, CFI, preprocessor, Intel region).

## Development

```
node test/run.js            # unit tests for parser, formatter, diagnostics, …
node test/smoke-vscode.js   # exercises all providers against a stubbed vscode API
node scripts/gen-grammar.js # regenerates syntaxes/gas.tmLanguage.json
```
Press **F5** in VS Code to launch an Extension Development Host. To package: `npx @vscode/vsce package`.

## Known limitations

* The instruction database is hand-written; unusual AVX-512 forms may lack hover docs (turn off `gas.lint.unknownInstructions`).
* Macro *expansion* is not simulated, so errors inside macro bodies are only found by the real assembler.
* `.altmacro` syntax, `.irp` bodies and expression evaluation are only approximated.
