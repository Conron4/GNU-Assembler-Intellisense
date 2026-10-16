/* features.S - tour of what the extension understands (uses the C preprocessor) */
#include <sys/syscall.h>
#define STDOUT 1
#define SYSCALL_EXIT(code) mov $60, %eax; mov code, %edi; syscall

    .macro  prologue size=16
    push    %rbp
    mov     %rsp, %rbp
    sub     $\size, %rsp
    .endm

    .macro  epilogue
    leave
    ret
    .endm

    .data
counter:    .quad 0
table:      .long 10, 20, 30

    .text
    .globl  sum_table
    .type   sum_table, @function
sum_table:                          # long sum_table(void)
    .cfi_startproc
    prologue 16
    xor     %eax, %eax
    lea     table(%rip), %rsi
    mov     $3, %ecx
1:  addl    (%rsi), %eax            # hover: 'l' suffix => 32-bit
    add     $4, %rsi
    dec     %ecx
    jnz     1b                      # ctrl+click jumps to 1:
    movl    %eax, counter(%rip)
    epilogue
    .cfi_endproc
    .size   sum_table, .-sum_table

    .intel_syntax noprefix
intel_demo:
    mov     rax, qword ptr [rbx + rcx*8 + 16]
    .att_syntax prefix
