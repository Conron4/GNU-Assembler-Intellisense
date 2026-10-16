'use strict';
/** Helpers for running as/gcc/ld and parsing their diagnostics. Pure Node (no vscode). */
const cp = require('child_process');

const MSG_RE = /^(.+?):(\d+): (Error|Warning|Fatal error|Info|Note): (.*)$/;
const NOLINE_RE = /^(.+?): (Error|Warning|Fatal error): (.*)$/;

/** Parse GNU as / gcc stderr into [{ line (0-based), severity, message, file }]. */
function parseAsOutput(stderr) {
  const out = [];
  for (const raw of String(stderr).split(/\r?\n/)) {
    let m = MSG_RE.exec(raw);
    if (m) {
      const sev = /^Warning$/.test(m[3]) ? 'warning' : /^(Info|Note)$/.test(m[3]) ? 'info' : 'error';
      out.push({ file: m[1], line: Math.max(0, parseInt(m[2], 10) - 1), severity: sev, message: m[4] });
      continue;
    }
    m = NOLINE_RE.exec(raw);
    if (m && !/Assembler messages/.test(raw)) {
      out.push({ file: m[1], line: 0, severity: /Warning/.test(m[2]) ? 'warning' : 'error', message: m[3] });
    }
  }
  return out;
}

/** Run a command; resolves { code, stdout, stderr, error }. Never rejects. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    try {
      child = cp.spawn(cmd, args, { cwd: opts.cwd, shell: false, windowsHide: true });
    } catch (error) {
      return done({ code: -1, stdout, stderr, error });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch (e) { /* ignore */ } done({ code: -1, stdout, stderr, error: new Error('timeout') }); }, opts.timeout || 15000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => { clearTimeout(timer); done({ code: -1, stdout, stderr, error }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    if (opts.input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(opts.input);
    }
  });
}

module.exports = { parseAsOutput, run };
