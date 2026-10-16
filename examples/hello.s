# hello.s - Linux x86-64, GNU as (AT&T syntax)
#
# Build:  as --64 -o hello.o hello.s && ld -o hello hello.o
# Run:    ./hello

    .section .rodata
msg:
    .ascii  "Hello, world!\n"
.set msg_len, . - msg

    .text
    .globl  _start
    .type   _start, @function
_start:
    mov     $1, %eax                # sys_write
    mov     $1, %edi                # fd = stdout
    lea     msg(%rip), %rsi
    mov     $msg_len, %edx
    syscall

    mov     $60, %eax               # sys_exit
    xor     %edi, %edi
    syscall
    .size   _start, .-_start

    .section .note.GNU-stack,"",@progbits
