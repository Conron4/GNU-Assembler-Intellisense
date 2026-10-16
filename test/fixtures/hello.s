# Hello world
    .intel_syntax noprefix
    .att_syntax
    .section .rodata
msg:    .asciz "Hello, # world\n"
.equ    LEN, . - msg
SYS_write = 1

    .text
    .globl _start
    .type _start, @function
_start:
    mov $SYS_write, %eax       # write
    mov $1, %edi
    lea msg(%rip), %rsi
    mov $LEN, %edx
    syscall
1:  dec %rcx
    jnz 1b
    jmp 2f
2:  mov $60, %eax; xor %edi, %edi
    syscall
    .size _start, .-_start
    .macro push2 a, b
    push \a
    push \b
    .endm
    push2 %rax, %rbx
