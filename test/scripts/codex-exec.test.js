'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const ADAPTER = path.join(ROOT, 'scripts', 'codex-exec.js');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'codex-exec', 'fake-codex.js');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STDERR_TAIL_LIMIT = Number(fs.readFileSync(ADAPTER, 'utf8').match(/STDERR_TAIL = (\d+)/)[1]);

let sandbox, bin, codexHome, repo, log;

before(() => {
  sandbox = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cx-adapter-test-'));
  bin = path.join(sandbox, 'bin'); fs.mkdirSync(bin);
  fs.copyFileSync(FAKE, path.join(bin, 'codex')); fs.chmodSync(path.join(bin, 'codex'), 0o755);
  codexHome = path.join(sandbox, 'codex-home'); fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, 'review.config.toml'), 'model = "fake"\n');
  repo = path.join(sandbox, 'repo'); fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  log = path.join(sandbox, 'argv.log');
});
after(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  // `allocDir()` creates directories directly under the OS temp root, not inside `sandbox`, so the
  // line above never reached them — a reviewer measured a normal run leaving dozens behind, and the
  // repo had accumulated well over a thousand. Track every allocation and remove it here.
  for (const dir of allocated) if (dir) fs.rmSync(dir, { recursive: true, force: true });
  allocated.length = 0;
});

function adapter(args, env = {}) {
  fs.writeFileSync(log, '');
  const r = spawnSync(process.execPath, [ADAPTER, ...args], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, FAKE_CODEX_LOG: log, ...env },
  });
  const launches = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { ...r, launches, record: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null };
}
const allocated = [];   // every dir this suite creates, so teardown can remove all of them
function allocDir() {
  const r = adapter(['--protocol', '1', 'alloc']);
  assert.equal(r.status, 0, r.stderr);
  allocated.push(r.record.dir);
  fs.writeFileSync(r.record.promptFile, 'Review this change. Report format: ## Document Review …');
  return r.record;
}
const UUIDish = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const startArgs = (a, extra = []) => ['--protocol', '1', 'start', '--class', 'review', '--prompt-file', a.promptFile, '--report-file', a.reportFile, ...extra];

describe('alloc', () => {
  test('alloc creates a 0700 dir under tmpdir and prints the three paths', () => {
    const r = adapter(['--protocol', '1', 'alloc']);
    allocated.push(r.record?.dir);   // this one bypasses allocDir(); teardown must still see it
    assert.equal(r.status, 0);
    assert.equal(r.record.protocol, 1);
    assert.ok(path.basename(r.record.dir).startsWith('codex-exec-'));
    assert.equal(fs.statSync(r.record.dir).mode & 0o777, 0o700);
    assert.equal(path.dirname(r.record.promptFile), r.record.dir);
    assert.equal(path.dirname(r.record.reportFile), r.record.dir);
  });
});

describe('start / resume — happy paths', () => {
  test('start review: argv order, safety flags, record, modes', () => {
    const a = allocDir();
    const r = adapter(startArgs(a, ['--profile', 'review']));
    assert.equal(r.status, 0, r.stderr);
    const argv = r.launches[0];
    assert.deepEqual(argv.slice(0, 3), ['exec', '-p', 'review']);
    assert.ok(argv.indexOf('-s') > argv.indexOf('-p'), 'safety flags come after the profile');
    assert.equal(argv[argv.indexOf('-s') + 1], 'read-only');
    assert.equal(argv[argv.indexOf('-c') + 1], 'approval_policy="never"');
    assert.deepEqual(argv.slice(-4), ['--json', '-o', a.reportFile, '-']);
    // The WHOLE argv, not spliced ends: the three prior assertions each check one slice and leave
    // the middle unconstrained — deleting `-C <toplevel> --color never` from the adapter left all
    // 48 cases green until this one. `-C` pins the child's working root and is the sole reason the
    // `no_git_toplevel` preflight exists, so it is the word with the most safety weight this AC
    // names and, until now, the least coverage.
    assert.deepEqual(argv, ['exec', '-p', 'review', '-s', 'read-only', '-c', 'approval_policy="never"',
      '-C', fs.realpathSync(repo), '--color', 'never', '--json', '-o', a.reportFile, '-']);
    assert.match(r.record.threadId, UUID);
    // `reportFile` is asserted on the alloc record, never on a success record — every skill that
    // reads a review's report reads this field, per codex-transport.md § Completion. Mutation-proven:
    // dropping it from the emit() call left all 52 cases green until this line existed.
    assert.equal(r.record.reportFile, a.reportFile);
    assert.equal(r.record.protocol, 1);
    assert.equal(r.record.requestedProfile, 'review');
    assert.equal(fs.statSync(a.reportFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(a.promptFile).mode & 0o777, 0o600);
  });
  test('start implement uses workspace-write; no profile → no -p and requestedProfile null', () => {
    const a = allocDir();
    const r = adapter(['--protocol', '1', 'start', '--class', 'implement', '--prompt-file', a.promptFile, '--report-file', a.reportFile]);
    assert.equal(r.status, 0, r.stderr);
    // Whole argv, not slices — the review class already had this; implement did not, and "both
    // classes" in the AC covers both.
    assert.deepEqual(r.launches[0], ['exec', '-s', 'workspace-write', '-c', 'approval_policy="never"',
      '-C', fs.realpathSync(repo), '--color', 'never', '--json', '-o', a.reportFile, '-']);
    assert.equal(r.record.requestedProfile, null);
    assert.equal(r.record.reportFile, a.reportFile);
    assert.equal(r.record.class, 'implement');
  });
  test('prompt reaches the child on stdin', () => {
    const a = allocDir();
    const stdinFile = path.join(a.dir, 'seen.txt');
    const r = adapter(startArgs(a), { FAKE_CODEX_STDIN: stdinFile });
    assert.equal(r.status, 0);
    assert.equal(fs.readFileSync(stdinFile, 'utf8'), fs.readFileSync(a.promptFile, 'utf8'));
  });
  test('resume: flags before the subcommand, id and dash last, threadId echoed', () => {
    const a = allocDir();
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const r = adapter(['--protocol', '1', 'resume', '--thread-id', id, '--class', 'review', '--prompt-file', a.promptFile, '--report-file', a.reportFile]);
    assert.equal(r.status, 0, r.stderr);
    const argv = r.launches[0];
    assert.ok(argv.indexOf('-s') < argv.indexOf('resume'));
    assert.deepEqual(argv.slice(argv.indexOf('resume')), ['resume', '--json', '-o', a.reportFile, id, '-']);
    // The whole argv, for the same reason as the start case: no profile was passed, so `-p` must be
    // absent, and `-C`/`--color never` must still precede the `resume` subcommand.
    assert.deepEqual(argv, ['exec', '-s', 'read-only', '-c', 'approval_policy="never"',
      '-C', fs.realpathSync(repo), '--color', 'never', 'resume', '--json', '-o', a.reportFile, id, '-']);
    assert.equal(r.record.threadId, id);
    assert.equal(r.record.reportFile, a.reportFile);
    assert.equal(r.record.protocol, 1);
  });
});

describe('exit 2 — configuration / usage, child never launched', () => {
  const cases = [
    ['protocol 0', (a) => ['--protocol', '0', 'start', '--class', 'review', '--prompt-file', a.promptFile, '--report-file', a.reportFile], 'CODEX_EXEC_CONFIG] code=protocol_mismatch'],
    ['profile missing', (a) => startArgs(a, ['--profile', 'nope']), 'CODEX_EXEC_CONFIG] code=profile_missing profile=nope'],
    ['invalid profile name', (a) => startArgs(a, ['--profile', '../x']), 'code=invalid_profile_name'],
    ['invalid class', (a) => ['--protocol', '1', 'start', '--class', 'danger', '--prompt-file', a.promptFile, '--report-file', a.reportFile], 'code=invalid_class'],
    ['empty prompt', (a) => { fs.writeFileSync(a.promptFile, ''); return startArgs(a); }, 'code=invalid_prompt_file'],
    ['report in tree', (a) => ['--protocol', '1', 'start', '--class', 'review', '--prompt-file', a.promptFile, '--report-file', path.join(repo, 'report.md')], 'code=invalid_report_file'],
    ['report in a different alloc dir', (a) => { const b = allocDir(); return ['--protocol', '1', 'start', '--class', 'review', '--prompt-file', a.promptFile, '--report-file', b.reportFile]; }, 'code=invalid_report_file'],
    ['prompt outside an alloc dir', (a) => { const p = path.join(sandbox, 'prompt.md'); fs.writeFileSync(p, 'x'); return ['--protocol', '1', 'start', '--class', 'review', '--prompt-file', p, '--report-file', a.reportFile]; }, 'code=invalid_prompt_file'],
    ['prompt is a symlink', (a) => { const real = path.join(sandbox, 'real-prompt.md'); fs.writeFileSync(real, 'x'); fs.unlinkSync(a.promptFile); fs.symlinkSync(real, a.promptFile); return startArgs(a); }, 'code=invalid_prompt_file'],
    ['prompt with wrong basename', (a) => { const p = path.join(a.dir, 'other.md'); fs.writeFileSync(p, 'x'); return ['--protocol', '1', 'start', '--class', 'review', '--prompt-file', p, '--report-file', a.reportFile]; }, 'code=invalid_prompt_file'],
    // Regression: a DANGLING symlink at the report position answers existsSync false, so the
    // child's -o would write — and the adapter would chmod 0600 — through it, outside the alloc
    // dir. Reproduced end to end before the fix (P3 fallback review, 2026-09-03).
    ['report is a dangling symlink', (a) => { fs.symlinkSync(path.join(sandbox, 'OUTSIDE-does-not-exist.txt'), a.reportFile); return startArgs(a); }, 'code=invalid_report_file'],
    ['report is a symlink to an existing file', (a) => { const t = path.join(sandbox, 'OUTSIDE-exists.txt'); fs.writeFileSync(t, 'keep'); fs.symlinkSync(t, a.reportFile); return startArgs(a); }, 'code=invalid_report_file'],
    ['report path is a directory', (a) => { fs.mkdirSync(a.reportFile); return startArgs(a); }, 'code=invalid_report_file'],
    ['report exists', (a) => { fs.writeFileSync(a.reportFile, 'old'); return startArgs(a); }, 'code=invalid_report_file'],
    ['bad thread id', (a) => ['--protocol', '1', 'resume', '--thread-id', 'not-a-uuid', '--class', 'review', '--prompt-file', a.promptFile, '--report-file', a.reportFile], 'code=invalid_thread_id'],
  ];
  test('no git toplevel — outside a repository, before any child launch', () => {
    const a = allocDir();
    const outside = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cx-nogit-'));
    fs.writeFileSync(log, '');
    const r = spawnSync(process.execPath, [ADAPTER, ...startArgs(a)], {
      cwd: outside, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, FAKE_CODEX_LOG: log },
    });
    fs.rmSync(outside, { recursive: true, force: true });
    // The AC names the launch log as the proof, not just the exit code and diagnostic — this test's
    // own title claims "before any child launch" and, until now, never read the log to check.
    const launches = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('code=no_git_toplevel'), r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(launches.length, 0, 'fake codex must not have been launched');
  });
  for (const [name, args, diag] of cases) {
    test(name, () => {
      const a = allocDir();
      const r = adapter(args(a));
      assert.equal(r.status, 2, r.stderr);
      assert.ok(r.stderr.includes(diag), r.stderr);
      assert.equal(r.launches.length, 0, 'fake codex must not have been launched');
      assert.equal(r.stdout, '');
    });
  }
});

describe('exit 1 — codex_fail', () => {
  const modes = [['no_thread', 'no thread.started'], ['malformed', 'malformed JSONL'], ['empty_report', 'empty, missing or non-regular report'], ['exit3', 'fake codex stderr line']];
  for (const [mode, needle] of modes) {
    test(`start under FAKE_CODEX_MODE=${mode}`, () => {
      const a = allocDir();
      const r = adapter(startArgs(a), { FAKE_CODEX_MODE: mode });
      assert.equal(r.status, 1);
      assert.ok(r.stderr.startsWith('[CODEX_EXEC_ERROR] reason=error'), r.stderr);
      assert.ok(r.stderr.includes(needle), r.stderr);
      assert.equal(r.stdout, '');
    });
  }
  test('stderr in the failure diagnostic is bounded to the last 20 lines, not unbounded', () => {
    // The "bounded stderr tail" clause of AC5 had no test that could fail if the bound were removed:
    // the fixture's one-line stderr never exceeds any bound. This mode emits 30 lines.
    const a = allocDir();
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'verbose_stderr' });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.startsWith('[CODEX_EXEC_ERROR] reason=error'), r.stderr);
    const tailLines = r.stderr.split('\n').filter((l) => l.startsWith('stderr line '));
    // Not an exact byte count — how the pipe chunks 30 rapid writes is not this adapter's contract —
    // but the two properties the "bounded" clause actually promises: fewer than the 30 emitted
    // survive, and what survives is the END of the stream, not the start.
    assert.ok(tailLines.length < 30 && tailLines.length <= STDERR_TAIL_LIMIT,
      `expected a bounded tail, got ${tailLines.length} of 30 lines`);
    assert.equal(tailLines[tailLines.length - 1], 'stderr line 30', 'the tail must end at the last line emitted');
    assert.ok(!tailLines.includes('stderr line 1'), 'the FIRST lines must be dropped, not the last ones');
  });

  test('a child that exits before draining a large prompt fails tagged, never with a raw stack', () => {
    // Regression: `child.stdin` had no error handler. A prompt bigger than the pipe buffer whose
    // reader leaves early makes the write side EPIPE; unhandled, node crashed with a raw exception
    // and exit 1 — and exit 1 is the ONE code meaning codex_fail, so an internal adapter stream
    // failure was indistinguishable from a Codex failure and would have dispatched a fallback
    // reviewer off the back of a bug. Reachable in normal use: a resume prompt carries a full diff.
    const a = allocDir();
    const big = `${'x'.repeat(2 * 1024 * 1024)}\n`;   // 2 MiB — far past any pipe buffer
    fs.writeFileSync(a.promptFile, big);
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'early_exit' });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.startsWith('[CODEX_EXEC_ERROR] reason=error'),
      `the failure must carry the adapter's own diagnostic, not a node stack — got: ${r.stderr.slice(0, 200)}`);
    assert.doesNotMatch(r.stderr, /EPIPE|at ChildProcess|at Socket/,
      'a raw stream exception must never reach stderr');
    assert.equal(r.stdout, '', 'no control record may be emitted for a failed run');
  });

  test('a child that dies mid-write on a large prompt is a failure, not a codex_ok', () => {
    // The dangerous sibling of the test above, and the one a bare "swallow EPIPE" lets through: the
    // child closes stdin early but otherwise succeeds — valid thread.started, valid 0600 report,
    // exit 0 — so every success check passes and the adapter would report a completed review of a
    // prompt the reviewer only half received. Exit 0 must additionally require proven delivery.
    const a = allocDir();
    fs.writeFileSync(a.promptFile, `${'z'.repeat(2 * 1024 * 1024)}\n`);
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'partial_stdin' });
    assert.equal(r.status, 1, `a truncated prompt must not pass — stdout was: ${r.stdout}`);
    assert.match(r.stderr, /prompt not fully written/);
    assert.equal(r.stdout, '', 'no control record: there is no verdict to report');
  });

  test('KNOWN LIMIT: a buffered prompt the child never reads still exits 0 — `finish` is not consumption', () => {
    // Characterization, not a guard. The two tests above bracket a range they do not cover: 2 MiB
    // hits backpressure so `finish` never fires, and 12 bytes fits the fake's single 64-byte read.
    // Between 65 bytes and the pipe capacity the prompt is written whole — `finish` fires — while
    // the child read one buffer and left. The adapter reports success, and nothing at this layer can
    // tell: proving CONSUMPTION needs an acknowledgement in the child's protocol, which `codex exec`
    // does not offer. This test exists so the limit is visible and cannot be silently widened; if a
    // future adapter does prove consumption, this test flips to expect status 1 and that is the
    // signal the claim in codex-transport.md § Completion may finally be strengthened.
    const a = allocDir();
    fs.writeFileSync(a.promptFile, `${'q'.repeat(4096)}\n`);   // > 64 B read, << pipe capacity
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'partial_stdin' });
    assert.equal(r.status, 0, `today this is a success; if it now fails, the guarantee grew — ${r.stderr}`);
    assert.ok(r.record, 'and it emits a control record, which is exactly the residual being recorded');
  });

  test('the partial_stdin fake is otherwise a SUCCESS — so the failure above is delivery, not sloppiness', () => {
    // Positive control. With a prompt small enough to be taken whole, the same mode must exit 0 and
    // emit a record; otherwise the test above would pass for any number of unrelated reasons.
    const a = allocDir();
    fs.writeFileSync(a.promptFile, 'tiny prompt\n');
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'partial_stdin' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.record && UUIDish.test(r.record.threadId), r.stdout);
  });

  test('the fake really does exit before reading stdin — the probe can go positive', () => {
    // Without this, the test above would pass just as well against a fake that drains stdin and the
    // EPIPE path would never be exercised. Prove the child never saw the prompt.
    const a = allocDir();
    const seen = path.join(sandbox, `stdin-seen-${Date.now()}.txt`);   // inside the suite sandbox, so teardown removes it
    fs.writeFileSync(a.promptFile, `${'y'.repeat(2 * 1024 * 1024)}\n`);
    adapter(startArgs(a), { FAKE_CODEX_MODE: 'early_exit', FAKE_CODEX_STDIN: seen });
    assert.equal(fs.existsSync(seen), false, 'early_exit must leave before the stdin read');
  });

  test('a report written on a FAILURE path is still chmod 0600', () => {
    // The mode guarantee is not conditional on success: a partial report carries the same review
    // content, and exit-1 paths used to return before the only chmod.
    const a = allocDir();
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'exit3' });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(fs.existsSync(a.reportFile), 'the fake wrote a report before failing');
    assert.equal(fs.statSync(a.reportFile).mode & 0o777, 0o600);
  });
  test('a report written before a malformed-JSONL failure is also 0600', () => {
    const a = allocDir();
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'malformed' });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(fs.statSync(a.reportFile).mode & 0o777, 0o600);
  });
  test('the report is 0600 while the child is provably still running', () => {
    // The earlier version of this test polled for the report — which preflight creates BEFORE
    // spawn — so it could pass without a child ever existing, and would have passed with the
    // fake's wait block deleted. It now waits for the fake's own readiness marker, written from
    // inside the wait, and asserts the adapter has not exited before inspecting the mode.
    const a = allocDir();
    const gate = path.join(a.dir, 'gate');
    const child = require('node:child_process').spawn(process.execPath, [ADAPTER, ...startArgs(a)], {
      cwd: repo, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, FAKE_CODEX_WAIT: gate },
      stdio: 'ignore',
    });
    let exited = false;
    child.on('exit', () => { exited = true; });
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(`${gate}.ready`) && !exited && Date.now() < deadline) { /* spin */ }
    assert.ok(fs.existsSync(`${gate}.ready`), 'the fake must have entered its wait — a live child');
    assert.equal(exited, false, 'the adapter is still running with the child blocked');
    assert.equal(fs.statSync(a.reportFile).mode & 0o777, 0o600);
    fs.writeFileSync(gate, 'go');
    child.kill('SIGKILL');
  });

  // I claimed these branches could not be driven from outside without a production seam, and pinned
  // the shape instead. Both halves of that were wrong, and a reviewer showed why: `node:fs`'s exports
  // are mutable, so `NODE_OPTIONS=--require` patches them before the adapter loads — no seam needed;
  // and the structural regex was vacuous, because its greedy `[\s\S]*` reached past `alloc()` into
  // `cleanup()`'s own `rmSync`/`fail('fs')`, so deleting alloc's cleanup left it green. Replaced with
  // three real runs, one per branch of the guard.
  for (const [fault, what] of [
    ['chmod', 'chmodSync throws'],
    ['stat', 'statSync throws'],
    ['mode', 'the mode comes back wrong without either call throwing'],
  ]) {
    test(`alloc fails tagged and leaves nothing behind when ${what}`, () => {
      // A DEDICATED, EMPTY temp root for this one invocation — via TMPDIR, which `os.tmpdir()`
      // reads. Two prior attempts at this check both scanned the SHARED OS temp root and both were
      // shown flaky by review: a global count collided with any other `codex-exec-*` entry already
      // there, and a before/after set difference still collided whenever this same test process's
      // OWN other `allocDir()` calls (elsewhere in this suite) landed a legitimate directory inside
      // the snapshot window — reproduced at roughly 1 run in 10 under strictly sequential execution,
      // no concurrency involved. Giving this spawn a temp root nothing else ever writes to removes
      // the shared resource entirely, rather than approximating around it.
      const isolatedTmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cx-fault-root-'));
      const r = spawnSync(process.execPath, [ADAPTER, '--protocol', '1', 'alloc'], {
        cwd: repo, encoding: 'utf8',
        env: { ...process.env, TMPDIR: isolatedTmp, FS_FAULT: fault, NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` },
      });
      const leftBehind = fs.readdirSync(isolatedTmp);
      fs.rmSync(isolatedTmp, { recursive: true, force: true });
      assert.equal(r.status, 1, r.stderr);
      assert.ok(r.stderr.startsWith('[CODEX_EXEC_ERROR] reason=fs'), r.stderr);
      assert.equal(r.stdout, '', 'a failed alloc emits no record');
      assert.deepEqual(leftBehind, [], 'no directory may survive the failure, in a root only this invocation could have written to');
    });
  }

  test('an unrecognized subcommand is refused before anything runs', () => {
    // "exposes exactly alloc, start, resume, cleanup" had no negative case: nothing proved a fifth
    // word is refused rather than silently accepted.
    const r = spawnSync(process.execPath, [ADAPTER, '--protocol', '1', 'summarize'], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('code=invalid_command'), r.stderr);
    assert.equal(r.stdout, '');
  });

  test('protocol is checked before any other flag, even one for a class the child could act on', () => {
    // "before anything else runs" — the existing protocol-mismatch case supplies otherwise-valid
    // arguments, so it passes whether protocol is checked first or last. Pairing the mismatch with
    // an invalid class proves the ORDER: if class were checked first, this would fail invalid_class
    // instead, and the diagnostic would name the wrong problem.
    const a = allocDir();
    const r = adapter(['--protocol', '0', 'start', '--class', 'not-a-real-class',
      '--prompt-file', a.promptFile, '--report-file', a.reportFile]);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('code=protocol_mismatch'), r.stderr);
    assert.ok(!r.stderr.includes('invalid_class'), 'protocol must be checked before class, not after');
    assert.equal(r.launches.length, 0);
  });

  test('the alloc DIRECTORY is 0700 under a restrictive ambient umask, or alloc fails', () => {
    // Sibling of the report-mode test below, and the case it did not cover: `mkdtemp`'s 0700 is
    // masked exactly as a create mode is. Measured — under `umask 277` the directory lands at 0500,
    // and the caller then cannot write prompt.md at all (EACCES) while alloc has already exited 0,
    // so the run dies later at preflight for a reason nothing points back to allocation.
    const r = spawnSync('sh', ['-c', 'umask 277; exec "$0" "$@"', process.execPath, ADAPTER, '--protocol', '1', 'alloc'], {
      cwd: repo, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome },
    });
    assert.equal(r.status, 0, r.stderr);
    const rec = JSON.parse(r.stdout.trim());
    allocated.push(rec.dir);   // register BEFORE asserting: a failing assertion below would otherwise
                               // abort the test and leak the directory it just created
    assert.equal(fs.statSync(rec.dir).mode & 0o777, 0o700, 'umask must not reach the alloc directory mode');
    fs.writeFileSync(rec.promptFile, 'the caller must be able to write here');   // the real consequence
  });

  test('the report is exactly 0600 even under a restrictive ambient umask', () => {
    // A create-mode argument is masked by the umask: measured, `umask 277` yields 0400, which the
    // success check would then reject — a run failing for a reason that has nothing to do with the
    // review. `fchmod` after the exclusive create is not masked, and is scoped to this descriptor.
    const a = allocDir();
    const r = spawnSync('sh', ['-c', `umask 277; exec "$0" "$@"`, process.execPath, ADAPTER, ...startArgs(a)], {
      cwd: repo, encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.statSync(a.reportFile).mode & 0o777, 0o600, 'umask must not reach the report mode');
  });

  test('a widened report fails closed on the SUCCESS path', () => {
    // The child writes a perfectly good report and exits 0, but chmods it 0644 on the way out.
    // Everything else about the run is a success, so this is the only test that reaches the
    // success-path mode check — `replace_report` exits nonzero and never gets there. Without this,
    // deleting that check turned nothing red.
    const a = allocDir();
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'widen_report' });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes('report is not 0600'), r.stderr);
    assert.equal(r.stdout, '', 'no control record for a report we cannot vouch for');
  });

  test('a replaced report plus a nonzero exit fails — and the rejection is the EXIT CODE, not the swap', () => {
    // Named for what it demonstrates, after a reviewer showed the old name claimed more: this
    // fixture also exits 3, and the adapter rejects any nonzero child before it ever looks at the
    // report, so every assertion here survives deleting all replacement handling.
    //
    // That is not a gap to close — it is § Files' stated boundary. The adapter cannot stop a
    // same-UID child replacing the file; it refuses to CALL the result a success, and the 0700
    // directory, not the file mode, is what keeps another user out. A replacement written at 0600
    // by a child that exits 0 is therefore undetectable here **by design**, and the residual is
    // documented rather than guarded. What IS guarded is the success-path mode check, and the
    // `widen_report` test above is the one that reaches it. An earlier attempt used a process-wide
    // umask(077); it constrained the replacement but leaked into everything the child created.
    const a = allocDir();
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'replace_report' });
    // Observe the replacement itself. Without this, deleting the fixture's unlink/write and keeping
    // only its exit-3 would leave every assertion below true — a test named for a behaviour it
    // never saw. (There is no "before" inode to compare: `alloc` only returns paths; preflight
    // inside `start` is what creates the report, so an untouched run leaves it empty.)
    assert.match(fs.readFileSync(a.reportFile, 'utf8'), /replacement written by the child/,
      'the child must actually have replaced the adapter-created report');
    assert.notEqual(r.status, 0, 'a replaced report must not produce a success record');
    assert.equal(r.stdout, '', 'no control record on a failure path');
    assert.equal(fs.statSync(a.dir).mode & 0o777, 0o700, 'the directory is the boundary that holds');
  });

  test('the implement class does not constrain unrelated files the child creates', () => {
    // Regression for the removed umask: a report-scoped control may not reach outside the report.
    // The fake writes an unrelated workspace file; its mode must follow the ambient umask, not 077.
    const a = allocDir();
    const side = path.join(a.dir, 'workspace-artifact.txt');
    const r = adapter(['--protocol', '1', 'start', '--class', 'implement', '--prompt-file', a.promptFile,
      '--report-file', a.reportFile], { FAKE_CODEX_SIDE_FILE: side });
    assert.equal(r.status, 0, r.stderr);
    const expected = 0o666 & ~parseInt(execSync('sh -c umask', { encoding: 'utf8' }).trim(), 8);
    assert.equal(fs.statSync(side).mode & 0o777, expected,
      'an unrelated file must follow the caller ambient umask, not a transport-imposed one');
  });

  test('a pre-existing report is refused — including a dangling symlink (O_EXCL, not a stat check)', () => {
    for (const make of [
      (f) => fs.writeFileSync(f, 'squatted'),
      (f) => fs.symlinkSync(path.join(sandbox, 'OUTSIDE-nope.md'), f),
      (f) => fs.mkdirSync(f),
    ]) {
      const a = allocDir();
      fs.rmSync(a.reportFile, { force: true });
      make(a.reportFile);
      const r = adapter(startArgs(a));
      assert.equal(r.status, 2, r.stderr);
      assert.ok(r.stderr.includes('code=invalid_report_file'), r.stderr);
      assert.equal(r.launches.length, 0, 'the child must not run');
    }
  });

  test('resume with a different thread.started id is a protocol failure', () => {
    const a = allocDir();
    const r = adapter(['--protocol', '1', 'resume', '--thread-id', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '--class', 'review', '--prompt-file', a.promptFile, '--report-file', a.reportFile], { FAKE_CODEX_MODE: 'other_id' });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes('thread id mismatch'));
  });
  test('missing codex binary', () => {
    const a = allocDir();
    const gitOnly = path.join(sandbox, 'bin-git-only');
    if (!fs.existsSync(gitOnly)) { fs.mkdirSync(gitOnly); fs.symlinkSync(spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim(), path.join(gitOnly, 'git')); }
    const r = adapter(startArgs(a), { PATH: gitOnly });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.startsWith('[CODEX_EXEC_ERROR]'));
  });
});

describe('cleanup', () => {
  test('removes an alloc path; refuses any other path', () => {
    const a = allocDir();
    const r = adapter(['--protocol', '1', 'cleanup', a.dir]);
    assert.equal(r.status, 0);
    assert.ok(!fs.existsSync(a.dir));
    const other = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'not-alloc-'));
    const r2 = adapter(['--protocol', '1', 'cleanup', other]);
    assert.equal(r2.status, 2);
    assert.ok(r2.stderr.includes('code=invalid_dir'));
    // `cleanup` has no spawn path, so this is a structural guarantee rather than a race, but the
    // Adequacy Gate found no test said so for this one code — asserted for every other exit-2 case.
    assert.equal(r2.stdout, '');
    assert.equal(r2.launches.length, 0);
    assert.ok(fs.existsSync(other));
    fs.rmSync(other, { recursive: true });
    const r3 = adapter(['--protocol', '1', 'cleanup', repo]);
    assert.equal(r3.status, 2);
    assert.ok(fs.existsSync(repo));
  });

  // `alloc`'s three fs-fault branches were proven; `cleanup`'s own `rmSync` — the only fs call on
  // its path — never was. Same injector, its fourth mode, loaded the same way.
  test('a filesystem failure during cleanup fails tagged with reason=fs', () => {
    const a = allocDir();
    const r = spawnSync(process.execPath, [ADAPTER, '--protocol', '1', 'cleanup', a.dir], {
      cwd: repo, encoding: 'utf8',
      env: { ...process.env, FS_FAULT: 'rm', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` },
    });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.startsWith('[CODEX_EXEC_ERROR] reason=fs'), r.stderr);
    assert.equal(r.stdout, '', 'a failed cleanup emits no record');
  });
});

describe('size budget', () => {
  test('adapter is ≤150 lines with no npm dependencies', () => {
    const src = fs.readFileSync(ADAPTER, 'utf8');
    assert.ok(src.split('\n').length <= 150, `adapter has ${src.split('\n').length} lines`);
    // Two regex attempts failed in opposite directions — first too narrow (single-quoted `require`
    // only), then too broad (comments and strings read as imports). A reviewer then broke the
    // masking chain four ways, including `"import('left-pad')"` counted and a real `require` inside
    // a template literal erased. Regexes cannot tell JavaScript's lexical contexts apart, so stop
    // trying: this adapter's imports are a fixed contiguous preamble. Pin it exactly, then require
    // that no loader expression appears anywhere else in the file.
    const PREAMBLE = [
      "const { spawn, spawnSync } = require('node:child_process');",
      "const fs = require('node:fs');",
      "const os = require('node:os');",
      "const path = require('node:path');",
    ];
    const lines = src.split('\n');
    const first = lines.findIndex((l) => l.startsWith('const { spawn'));
    assert.notEqual(first, -1, 'the import preamble must be present and start where it always has');
    assert.deepEqual(lines.slice(first, first + PREAMBLE.length), PREAMBLE,
      'the permitted imports are exactly these four builtins, in this order — change them here deliberately');

    // Matching CALL SHAPES was the third failed attempt: a reviewer executed
    // `require /* c */ ("x")`, `require?.("x")`, `(0, require)("x")` and `const load = require;
    // load("x")`, none of which a shape pattern sees. Under this adapter's fixed-source policy the
    // answer is not a better pattern but a stricter rule — the IDENTIFIER may not appear at all
    // outside the preamble, whatever is done with it. `\b` keeps the word "requires" in a comment
    // legal, which is the only reason this is livable; it does forbid the bare words elsewhere, and
    // that is the intended trade rather than an accident.
    const rest = lines.filter((_, i) => i < first || i >= first + PREAMBLE.length).join('\n');
    const LOADER = /\brequire\b|\bimport\b/;
    assert.doesNotMatch(rest, LOADER,
      'no loader identifier may appear outside the pinned preamble — INV-002 is zero npm dependencies');

    // Controls in both directions: a pin that matches nothing and a scan that sees nothing pass quietly.
    assert.match(src, /require\('node:fs'\)/, 'sanity: the preamble really is in this file');
    assert.doesNotMatch('// Exit 0 requires it', LOADER, 'the word "requires" in prose stays legal');
    for (const evasion of [
      'const x = require("left-pad");',
      'require /* c */ ("left-pad")',
      'require?.("left-pad")',
      '(0, require)("left-pad")',
      'const load = require; load("left-pad")',
      'import /* c */ ("left-pad")',
    ]) assert.match(evasion, LOADER, `this must be caught: ${evasion}`);  });
});

describe('only the canonical transport reference names the adapter', () => {
  // Work item 1 landed the adapter unwired; work item 2 gave it exactly one documented caller —
  // `codex-transport.md`. Until items 3-4 convert the families, no OTHER skill, agent or rule may
  // name it. The README's resource inventory row is not wiring:
  // `scripts/generate-readme-catalog.js` owns that row and its own test requires every top-level
  // script in it, so landing a core script must update it.
  test('no skill, agent or rule outside codex-transport.md references the adapter', () => {
    const r = spawnSync('grep', ['-rl', 'codex-exec', 'skills', 'agents', 'rules', '--include=*.md'], { cwd: ROOT, encoding: 'utf8' });
    const hits = r.stdout.trim() ? r.stdout.trim().split('\n').sort() : [];
    assert.deepEqual(hits, ['skills/codex-code-review/references/codex-transport.md'],
      'the transport reference is the only documented caller until the conversion tickets land');
  });
});

describe('report path cannot escape the alloc directory', () => {
  test('a dangling report symlink is refused and its target is never created', () => {
    const a = allocDir();
    const outside = path.join(sandbox, 'ESCAPE-TARGET.md');
    fs.symlinkSync(outside, a.reportFile);
    const r = adapter(startArgs(a));
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes('code=invalid_report_file'), r.stderr);
    assert.equal(r.launches.length, 0, 'the child must not run');
    assert.equal(fs.existsSync(outside), false, 'the symlink target was written outside the alloc dir');
  });
});
