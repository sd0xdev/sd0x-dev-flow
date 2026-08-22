'use strict';

// The single definition of the "no controlling terminal" spawn used by
// test/scripts/pre-push-gate.test.js. It lives in its own module for one reason: the
// discriminator test has to run *this* function inside a real pty, which means a second
// node process has to be able to require it. A copy inside the test file could not be
// reached from there, and a look-alike written inline would prove nothing about the
// helper the gate tests actually use.
//
// `detached: true` is the load-bearing option. /dev/tty is the controlling terminal of
// the session, reached independently of fds 0-2, so piping stdio does not remove it —
// a child with all three piped still opens it whenever its parent has one. setsid(2),
// which `detached` calls, is what actually removes it.
const { spawnSync } = require('node:child_process');

const DEFAULT_INPUT =
  'refs/heads/main abc123 refs/heads/main 0000000000000000000000000000000000000000\n';

function spawnDetached(command, { cwd, input } = {}) {
  const r = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(cwd ? { cwd } : {}),
    input: input === undefined ? DEFAULT_INPUT : input,
  });
  return (r.stdout || '') + (r.stderr || '');
}

// The same topology minus the one option under test. Used only by the discriminator, as
// its positive control: under a pty this must find a terminal, which is what proves the
// pty was real and that piping alone never removed anything.
function spawnAttached(command, { cwd, input } = {}) {
  const r = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(cwd ? { cwd } : {}),
    input: input === undefined ? DEFAULT_INPUT : input,
  });
  return (r.stdout || '') + (r.stderr || '');
}

const TTY_PROBE = '{ exec 3</dev/tty; } 2>/dev/null && echo HAS_TTY || echo NO_TTY';

module.exports = { spawnDetached, spawnAttached, TTY_PROBE, DEFAULT_INPUT };
