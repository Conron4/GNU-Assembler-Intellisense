'use strict';
/**
 * Common Linux x86-64 system calls.
 * Calling convention: number in %rax; args in %rdi, %rsi, %rdx, %r10, %r8, %r9;
 * result in %rax (negative errno on failure); %rcx and %r11 are clobbered.
 */
const ARG_REGS = ['%rdi', '%rsi', '%rdx', '%r10', '%r8', '%r9'];

// [number, name, C-like signature]
const TABLE = [
  [0, 'read', 'ssize_t read(int fd, void *buf, size_t count)'],
  [1, 'write', 'ssize_t write(int fd, const void *buf, size_t count)'],
  [2, 'open', 'int open(const char *pathname, int flags, mode_t mode)'],
  [3, 'close', 'int close(int fd)'],
  [4, 'stat', 'int stat(const char *pathname, struct stat *statbuf)'],
  [5, 'fstat', 'int fstat(int fd, struct stat *statbuf)'],
  [6, 'lstat', 'int lstat(const char *pathname, struct stat *statbuf)'],
  [7, 'poll', 'int poll(struct pollfd *fds, nfds_t nfds, int timeout)'],
  [8, 'lseek', 'off_t lseek(int fd, off_t offset, int whence)'],
  [9, 'mmap', 'void *mmap(void *addr, size_t length, int prot, int flags, int fd, off_t offset)'],
  [10, 'mprotect', 'int mprotect(void *addr, size_t len, int prot)'],
  [11, 'munmap', 'int munmap(void *addr, size_t length)'],
  [12, 'brk', 'int brk(void *addr)'],
  [13, 'rt_sigaction', 'int rt_sigaction(int sig, const struct sigaction *act, struct sigaction *oact, size_t sigsetsize)'],
  [14, 'rt_sigprocmask', 'int rt_sigprocmask(int how, const sigset_t *set, sigset_t *oset, size_t sigsetsize)'],
  [15, 'rt_sigreturn', 'long rt_sigreturn(void)'],
  [16, 'ioctl', 'int ioctl(int fd, unsigned long request, unsigned long arg)'],
  [17, 'pread64', 'ssize_t pread64(int fd, void *buf, size_t count, off_t offset)'],
  [18, 'pwrite64', 'ssize_t pwrite64(int fd, const void *buf, size_t count, off_t offset)'],
  [19, 'readv', 'ssize_t readv(int fd, const struct iovec *iov, int iovcnt)'],
  [20, 'writev', 'ssize_t writev(int fd, const struct iovec *iov, int iovcnt)'],
  [21, 'access', 'int access(const char *pathname, int mode)'],
  [22, 'pipe', 'int pipe(int pipefd[2])'],
  [23, 'select', 'int select(int nfds, fd_set *rfds, fd_set *wfds, fd_set *efds, struct timeval *timeout)'],
  [24, 'sched_yield', 'int sched_yield(void)'],
  [25, 'mremap', 'void *mremap(void *old_address, size_t old_size, size_t new_size, int flags, void *new_address)'],
  [28, 'madvise', 'int madvise(void *addr, size_t length, int advice)'],
  [32, 'dup', 'int dup(int oldfd)'],
  [33, 'dup2', 'int dup2(int oldfd, int newfd)'],
  [34, 'pause', 'int pause(void)'],
  [35, 'nanosleep', 'int nanosleep(const struct timespec *req, struct timespec *rem)'],
  [39, 'getpid', 'pid_t getpid(void)'],
  [41, 'socket', 'int socket(int domain, int type, int protocol)'],
  [42, 'connect', 'int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen)'],
  [43, 'accept', 'int accept(int sockfd, struct sockaddr *addr, socklen_t *addrlen)'],
  [44, 'sendto', 'ssize_t sendto(int sockfd, const void *buf, size_t len, int flags, const struct sockaddr *dest, socklen_t addrlen)'],
  [45, 'recvfrom', 'ssize_t recvfrom(int sockfd, void *buf, size_t len, int flags, struct sockaddr *src, socklen_t *addrlen)'],
  [48, 'shutdown', 'int shutdown(int sockfd, int how)'],
  [49, 'bind', 'int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen)'],
  [50, 'listen', 'int listen(int sockfd, int backlog)'],
  [56, 'clone', 'long clone(unsigned long flags, void *stack, int *parent_tid, int *child_tid, unsigned long tls)'],
  [57, 'fork', 'pid_t fork(void)'],
  [58, 'vfork', 'pid_t vfork(void)'],
  [59, 'execve', 'int execve(const char *pathname, char *const argv[], char *const envp[])'],
  [60, 'exit', 'void exit(int status)'],
  [61, 'wait4', 'pid_t wait4(pid_t pid, int *wstatus, int options, struct rusage *rusage)'],
  [62, 'kill', 'int kill(pid_t pid, int sig)'],
  [63, 'uname', 'int uname(struct utsname *buf)'],
  [72, 'fcntl', 'int fcntl(int fd, int cmd, unsigned long arg)'],
  [78, 'getdents', 'int getdents(unsigned int fd, struct linux_dirent *dirp, unsigned int count)'],
  [79, 'getcwd', 'char *getcwd(char *buf, size_t size)'],
  [80, 'chdir', 'int chdir(const char *path)'],
  [82, 'rename', 'int rename(const char *oldpath, const char *newpath)'],
  [83, 'mkdir', 'int mkdir(const char *pathname, mode_t mode)'],
  [84, 'rmdir', 'int rmdir(const char *pathname)'],
  [85, 'creat', 'int creat(const char *pathname, mode_t mode)'],
  [87, 'unlink', 'int unlink(const char *pathname)'],
  [89, 'readlink', 'ssize_t readlink(const char *pathname, char *buf, size_t bufsiz)'],
  [90, 'chmod', 'int chmod(const char *pathname, mode_t mode)'],
  [96, 'gettimeofday', 'int gettimeofday(struct timeval *tv, struct timezone *tz)'],
  [97, 'getrlimit', 'int getrlimit(int resource, struct rlimit *rlim)'],
  [99, 'sysinfo', 'int sysinfo(struct sysinfo *info)'],
  [102, 'getuid', 'uid_t getuid(void)'],
  [104, 'getgid', 'gid_t getgid(void)'],
  [105, 'setuid', 'int setuid(uid_t uid)'],
  [110, 'getppid', 'pid_t getppid(void)'],
  [158, 'arch_prctl', 'int arch_prctl(int code, unsigned long addr)'],
  [186, 'gettid', 'pid_t gettid(void)'],
  [201, 'time', 'time_t time(time_t *tloc)'],
  [202, 'futex', 'long futex(uint32_t *uaddr, int op, uint32_t val, const struct timespec *timeout, uint32_t *uaddr2, uint32_t val3)'],
  [217, 'getdents64', 'ssize_t getdents64(unsigned int fd, struct linux_dirent64 *dirp, unsigned int count)'],
  [228, 'clock_gettime', 'int clock_gettime(clockid_t clockid, struct timespec *tp)'],
  [230, 'clock_nanosleep', 'int clock_nanosleep(clockid_t clockid, int flags, const struct timespec *req, struct timespec *rem)'],
  [231, 'exit_group', 'void exit_group(int status)'],
  [257, 'openat', 'int openat(int dirfd, const char *pathname, int flags, mode_t mode)'],
  [262, 'newfstatat', 'int newfstatat(int dirfd, const char *pathname, struct stat *statbuf, int flags)'],
  [293, 'pipe2', 'int pipe2(int pipefd[2], int flags)'],
  [318, 'getrandom', 'ssize_t getrandom(void *buf, size_t buflen, unsigned int flags)'],
  [332, 'statx', 'int statx(int dirfd, const char *pathname, int flags, unsigned int mask, struct statx *statxbuf)']
];

const BY_NUMBER = new Map(TABLE.map((e) => [e[0], { number: e[0], name: e[1], signature: e[2] }]));
const BY_NAME = new Map(TABLE.map((e) => [e[1], { number: e[0], name: e[1], signature: e[2] }]));

function syscallByNumber(n) {
  return BY_NUMBER.get(n);
}

function syscallByName(name) {
  return BY_NAME.get(name);
}

/** Markdown for hover on a syscall. */
function syscallMarkdown(sc) {
  const argCount = (sc.signature.match(/\(([^)]*)\)/) || [, ''])[1].split(',').filter((s) => s.trim() && s.trim() !== 'void').length;
  const regs = ARG_REGS.slice(0, argCount).join(', ');
  return [
    `**syscall ${sc.number}** — \`${sc.name}\``,
    '',
    '```c',
    sc.signature,
    '```',
    regs ? `Arguments: ${regs}` : 'No arguments.',
    '',
    'Number in `%rax`; result (or `-errno`) returned in `%rax`. `%rcx` and `%r11` are clobbered.'
  ].join('\n');
}

module.exports = { TABLE, ARG_REGS, syscallByNumber, syscallByName, syscallMarkdown };
