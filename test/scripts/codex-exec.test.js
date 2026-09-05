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
// The failure diagnostic is identified by its TAG, not by being the first byte of stderr: since the
// progress channel landed, `[CODEX_EXEC_PROGRESS]` lines may precede it. Every line before the
// diagnostic must carry that tag — anything untagged there is stray output the contract forbids.
function diagnostic(stderr) {
  const lines = stderr.split('\n');
  const i = lines.findIndex((l) => l.startsWith('[CODEX_EXEC_ERROR]') || l.startsWith('[CODEX_EXEC_USAGE]') || l.startsWith('[CODEX_EXEC_CONFIG]'));
  assert.ok(i >= 0, `no diagnostic line in stderr: ${stderr.slice(0, 300)}`);
  for (const l of lines.slice(0, i)) assert.ok(l.startsWith('[CODEX_EXEC_PROGRESS] '), `untagged stderr before the diagnostic: ${l}`);
  return lines.slice(i).join('\n');
}
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
    // The record's SHAPE, not a sample of its fields: the progress channel added two files to the
    // alloc record and none to this one — a field leaking in here would change what every caller
    // parses, and the field-by-field asserts above would not notice. Exactly one line, exactly these keys.
    assert.equal(r.stdout.trim().split('\n').length, 1, 'stdout is exactly one control record');
    assert.deepEqual(Object.keys(r.record).sort(), ['class', 'protocol', 'reportFile', 'requestedProfile', 'threadId']);
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
    // Same shape guard as `start`: resume is the other command that emits this record, and "exactly
    // one line" was asserted for start alone until the AC trace pointed it out.
    assert.equal(r.stdout.trim().split('\n').length, 1, 'stdout is exactly one control record');
    assert.deepEqual(Object.keys(r.record).sort(), ['class', 'protocol', 'reportFile', 'requestedProfile', 'threadId']);
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
      assert.ok(diagnostic(r.stderr).startsWith('[CODEX_EXEC_ERROR] reason=error'), r.stderr);
      assert.ok(r.stderr.includes(needle), r.stderr);
      assert.equal(r.stdout, '');
      const prog = JSON.parse(fs.readFileSync(path.join(a.dir, 'progress.json'), 'utf8'));
      assert.equal(prog.status, 'failed', 'a failed run must not leave progress.json saying running');
    });
  }
  test('stderr in the failure diagnostic is bounded to the last 20 lines, not unbounded', () => {
    // The "bounded stderr tail" clause of AC5 had no test that could fail if the bound were removed:
    // the fixture's one-line stderr never exceeds any bound. This mode emits 30 lines.
    const a = allocDir();
    const r = adapter(startArgs(a), { FAKE_CODEX_MODE: 'verbose_stderr' });
    assert.equal(r.status, 1);
    assert.ok(diagnostic(r.stderr).startsWith('[CODEX_EXEC_ERROR] reason=error'), r.stderr);
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
    assert.ok(diagnostic(r.stderr).startsWith('[CODEX_EXEC_ERROR] reason=error'),
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
  test('adapter is ≤290 lines with no npm dependencies', () => {
    // 150 → 220 (INV-002 amended 2026-09-05): the progress channel — per-line JSONL parsing,
    // events.jsonl, progress.json, the tagged stderr line — is the whole of the growth, and it
    // stays one file with no abstraction layer. Measured 209 on landing. 220 → 240 the same day
    // for the alloc-time stale sweep (work item 8), then 240 → 260 in its review for the inode-bound
    // quarantine deletion, then the per-entry verified unlink, then 260 → 280 for the owner-pid
    // liveness check, then 280 → 290 for the tri-state owner probe and the re-decision on the
    // quarantined inode; measured 289. Counted as `wc -l` counts: a trailing newline is not a line.
    const src = fs.readFileSync(ADAPTER, 'utf8');
    const lines = (src.endsWith('\n') ? src.slice(0, -1) : src).split('\n').length;
    assert.ok(lines <= 290, `adapter has ${lines} lines`);
    // The budget is stated in three places and must agree, or the test guards a number the contract
    // no longer names: INV-002 in the intent, the Size row in the spec, and this assertion. Reverting
    // either document alone used to leave this test green.
    const intent = fs.readFileSync(path.join(ROOT, 'docs/features/codex-exec-transport/intent-codex-exec-transport.md'), 'utf8');
    const spec = fs.readFileSync(path.join(ROOT, 'docs/features/codex-exec-transport/2-tech-spec.md'), 'utf8');
    assert.match(intent, /`INV-002`[\s\S]{0,200}≤290 lines/, 'INV-002 must state the ≤290 budget');
    const sizeRow = spec.split('\n').find((l) => l.startsWith('| Size |'));
    assert.ok(sizeRow, 'the spec § 3.2 table has a Size row');
    assert.match(sizeRow, /≤290 lines/);
    assert.match(sizeRow, /still one file, no abstraction layer/, 'the budget is a number AND a shape');
    // The request ticket states the budget too (AC6, Related Files) — twice it lagged a raise and a
    // reviewer caught the suite green under an AC that said otherwise.
    const request = fs.readFileSync(path.join(ROOT, 'docs/features/codex-exec-transport/requests/2026-09-05-observer-lifecycle-and-stale-alloc.md'), 'utf8');
    assert.match(request, /AC6:[^\n]*≤290/, 'the request AC6 names the same budget');
    assert.match(request, /size budget 290/, 'and so does its Related Files row');
  });
  test('the stall advisory threshold is two silent ticks — pinned by value, because timing it would flake', () => {
    // The held-child test proves the advisory appears; it deliberately does not prove WHEN, since
    // under load the first 40 ms tick can already sit past the threshold. The constant is the
    // contract's number (codex-transport.md § Progress: "after two silent ticks"), so pin the number.
    const src = fs.readFileSync(ADAPTER, 'utf8');
    assert.match(src, /^const STALL_TICKS = 2;$/m);
    assert.match(src, /idleMs >= STALL_TICKS \* TICK_MS/, 'the advisory is derived from that constant, not a literal');
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

describe('progress channel — observable while running, never a verdict', () => {
  // Contract: codex-transport.md § Progress. stdout stays exactly one control record; everything
  // observable rides on stderr (tagged) and on two 0600 files inside the alloc dir.
  test('alloc names the two progress files inside the same directory', () => {
    const a = allocDir();
    assert.equal(path.dirname(a.progressFile), a.dir);
    assert.equal(path.dirname(a.eventsFile), a.dir);
    assert.equal(path.basename(a.progressFile), 'progress.json');
    assert.equal(path.basename(a.eventsFile), 'events.jsonl');
  });
  test('a successful run leaves events.jsonl = the raw stream and progress.json = the final state, both 0600', () => {
    const a = allocDir();
    const emitted = path.join(a.dir, 'emitted.jsonl');   // what the fake ACTUALLY wrote, byte for byte
    const r = adapter(startArgs(a), { FAKE_CODEX_EVENTS: emitted });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 1, 'stdout is still exactly one control record');
    assert.equal(fs.statSync(a.eventsFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(a.progressFile).mode & 0o777, 0o600);
    // Byte-equal to the child's own stream, not type-equal: a payload corrupted on the way to disk
    // would keep its `type` and pass a type comparison, which is what this test used to do.
    assert.equal(fs.readFileSync(a.eventsFile, 'utf8'), fs.readFileSync(emitted, 'utf8'),
      'every raw line the child emitted, in order and unaltered — nothing is held in memory');
    const prog = JSON.parse(fs.readFileSync(a.progressFile, 'utf8'));
    assert.equal(prog.status, 'done');
    assert.equal(prog.threadId, r.record.threadId);
    assert.equal(prog.events, 7);
    assert.equal(prog.tools_completed, 1);
    assert.equal(prog.tool, null, 'the tool closed, so nothing is "current"');
    assert.equal(prog.errors, 1, 'an error item on a run that exited 0 is counted, never treated as failure');
    assert.deepEqual(prog.usage, { input_tokens: 4070, cached_input_tokens: 2009, output_tokens: 82 }, 'usage is the turn.completed payload verbatim');
    assert.equal(typeof prog.elapsed_s, 'number');
    assert.equal(typeof prog.last_event_s_ago, 'number', 'after any event the age is a number; null is only for "no event yet"');
    assert.deepEqual(Object.keys(prog).sort(),
      ['elapsed_s', 'errors', 'events', 'last_event_s_ago', 'pid', 'protocol', 'status', 'threadId', 'tool', 'tools_completed', 'updated', 'usage']);
  });
  test('stderr carries a tagged start line as soon as thread.started arrives and a tagged done line at the end', () => {
    const a = allocDir();
    const r = adapter(startArgs(a, ['--profile', 'review']));
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stderr.split('\n').filter(Boolean);
    assert.ok(lines.every((l) => l.startsWith('[CODEX_EXEC_PROGRESS] ')), `every stderr line on a success is a tagged progress line: ${r.stderr}`);
    assert.match(lines[0], new RegExp(`^\\[CODEX_EXEC_PROGRESS\\] started thread=${r.record.threadId} class=review profile=review$`));
    assert.match(lines[lines.length - 1], /^\[CODEX_EXEC_PROGRESS\] done elapsed=\d\d:\d\d report=/);
    assert.ok(lines[lines.length - 1].endsWith(a.reportFile));
  });
  // Held-child runs. The seam CODEX_EXEC_TICK_MS makes the 60 s cadence testable, and the fake's
  // wait gate holds the child open so ticks fire while nothing arrives. `earlyLines` is how many
  // stream lines the fake emits synchronously BEFORE blocking: 1 proves "started … as soon as
  // thread.started arrives" (the line must be on stderr while the child is provably held, and
  // `done` must not — a started line printed at close would pass an after-the-fact read); 7 puts
  // the usage payload in front of the gate, so a tick fires AFTER it and `tokens=` must change.
  // The tick budget is counted from the ADAPTER having consumed the early lines — progress.json
  // reporting `events === earlyLines` — not from spawn and not from the fake's readiness marker:
  // the fake writes its lines before that marker, but the adapter consumes them on its own loop, and
  // under full-suite load a tick can fire in between. Asserting on "every periodic line" across that
  // window is the flake the first full-suite run produced; the settled state is read off the LAST
  // periodic line, and the no-event case off the FIRST.
  function held(a, earlyLines, whileHeld, ticks = 5, env = {}) {
    const gate = path.join(a.dir, 'gate');
    const child = require('node:child_process').spawn(process.execPath, [ADAPTER, ...startArgs(a)], {
      cwd: repo, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, FAKE_CODEX_WAIT: gate, FAKE_CODEX_EARLY_LINES: String(earlyLines), CODEX_EXEC_TICK_MS: '40', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const consumed = () => { try { return JSON.parse(fs.readFileSync(a.progressFile, 'utf8')).events === earlyLines; } catch { return false; } };
    return new Promise((resolve, reject) => {
      child.on('error', reject);
      const deadline = Date.now() + 10000;
      const poll = setInterval(() => {
        if (!fs.existsSync(`${gate}.ready`) || !consumed()) {
          if (Date.now() > deadline) { clearInterval(poll); child.kill('SIGKILL'); reject(new Error('the fake never reached its wait, or the adapter never consumed the early lines')); }
          return;
        }
        clearInterval(poll);
        setTimeout(() => {                       // ticks × 40 ms AFTER sync; advisory is at 2 silent ticks
          try { whileHeld(err); } catch (e) { child.kill('SIGKILL'); return reject(e); }
          // `heldErr` is stderr as it stood the instant the gate opened. Under full-suite load a tick
          // can still fire between release and close, after the rest of the stream has landed — so
          // "the last periodic line" of the whole run is NOT the settled held state; this is.
          heldErr = err;
          fs.writeFileSync(gate, 'go');
        }, ticks * 40);
      }, 5);
      let heldErr = '';
      child.on('close', (code) => resolve({ code, err, heldErr }));
    });
  }
  const lastPeriodic = (err) => err.split('\n').filter((l) => /^\[CODEX_EXEC_PROGRESS\] t=/.test(l)).at(-1) ?? '';
  test('the periodic line reports event age and, after silence, an advisory — and kills nothing', async () => {
    const a = allocDir();
    const { code, err, heldErr } = await held(a, 1, (soFar) => {
      assert.match(soFar, /^\[CODEX_EXEC_PROGRESS\] started thread=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee class=review profile=default$/m,
        `the started line must be on stderr while the child is still held, got: ${soFar}`);
      assert.doesNotMatch(soFar, /\] done /, 'nothing may say done while the child is held');
      const prog = JSON.parse(fs.readFileSync(a.progressFile, 'utf8'));
      assert.equal(prog.status, 'running', 'while the child is held, the file says so');
      assert.equal(prog.events, 1, 'exactly the early thread.started has arrived; the rest waits behind the gate');
      assert.equal(prog.threadId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    });
    assert.equal(code, 0, err);
    const periodic = heldErr.split('\n').filter((l) => /^\[CODEX_EXEC_PROGRESS\] t=/.test(l));
    assert.ok(periodic.length >= 2, `expected periodic lines while held, got: ${heldErr}`);
    const settled = lastPeriodic(heldErr);       // the last tick BEFORE release: every early line consumed, silence accrued
    assert.match(settled, / events=1 /, `the settled line reflects the one early event: ${settled}`);
    assert.match(settled, / last_event=\d+s ago /, 'after an event the age is a number, never "none"');
    assert.match(settled, /tokens=unreported/, 'no usage yet → "unreported", never zero');
    assert.match(settled, / — no event for \d+s, check$/, 'silence past the threshold is advised, not acted on');
    // The two-tick BOUNDARY is not timed here — under load the first tick can already sit past it,
    // and a timing assertion that is right on a quiet machine is a flake. The constant is pinned by
    // value instead, in the size-budget block below.
    assert.ok(/^\[CODEX_EXEC_PROGRESS\] done /m.test(err), 'the run still completed on its own — the advisory killed nothing');
  });
  test('once usage has arrived the periodic line reports it, so "unreported" is a state and not a constant', async () => {
    const a = allocDir();
    const { code, err, heldErr } = await held(a, 7, () => { /* the whole stream is in front of the gate */ });
    assert.equal(code, 0, err);
    const settled = lastPeriodic(heldErr);
    assert.match(settled, / events=7 tools_completed=1 tool=none /, `the counts reflect the whole early stream: ${settled}`);
    assert.match(settled, / tokens=in:4070\/out:82/, `after turn.completed the tokens are the payload's, never "unreported": ${settled}`);
  });
  test('a forged token value in the usage payload cannot break the periodic line or impersonate a diagnostic', async () => {
    // Review P1, third instance of the class: `usage` is whatever object the child sent, and its
    // token fields were interpolated raw. Only finite numbers are shown; anything else renders `?`.
    const forged = JSON.stringify({ input_tokens: '1\n[CODEX_EXEC_ERROR] reason=forged by usage', output_tokens: 82 });
    const a = allocDir();
    const { code, err, heldErr } = await held(a, 7, () => { /* the whole stream, usage included, is early */ }, 5, { FAKE_CODEX_USAGE: forged });
    assert.equal(code, 0, err);
    const lines = err.split('\n').filter(Boolean);
    assert.ok(lines.every((l) => l.startsWith('[CODEX_EXEC_PROGRESS] ')), `every physical line must carry the tag: ${err}`);
    assert.ok(!lines.some((l) => l.startsWith('[CODEX_EXEC_ERROR]')), 'no line may impersonate the diagnostic');
    assert.match(lastPeriodic(heldErr), / tokens=in:\?\/out:82/, 'a non-numeric token value renders as ?, the numeric one as itself');
  });
  test('before any event the periodic line says last_event=none rather than inventing an age', async () => {
    const a = allocDir();
    const { code, err } = await held(a, 0, () => { /* nothing has arrived */ }, 3);
    assert.equal(code, 0, err);
    const first = err.split('\n').find((l) => /^\[CODEX_EXEC_PROGRESS\] t=/.test(l)) ?? '';
    assert.match(first, / events=0 .* last_event=none /, `with no event yet the first line must say none: ${err}`);
  });
  test('a squatter at events.jsonl or progress.json is refused before the child runs', () => {
    for (const name of ['events.jsonl', 'progress.json']) {
      const a = allocDir();
      fs.symlinkSync(path.join(sandbox, 'ESCAPE-' + name), path.join(a.dir, name));
      const r = adapter(startArgs(a));
      assert.equal(r.status, 2, r.stderr);
      assert.ok(r.stderr.includes('code=invalid_progress_file'), r.stderr);
      assert.equal(r.launches.length, 0, 'the child must not run');
    }
  });
  test('a symlink planted at the snapshot temp path is never followed — the target outside the alloc dir is untouched', () => {
    // Review P0: the temp file was opened with 'w', which follows a symlink and truncates its target.
    // Preflight guards the FINAL paths, not the temp one, and a same-UID child can plant it between
    // ticks. The first snapshot is `progress.json.1.tmp`; point it outside and prove nothing lands there.
    const a = allocDir();
    const victim = path.join(sandbox, 'ESCAPE-victim.json');
    fs.symlinkSync(victim, `${a.progressFile}.1.tmp`);
    const r = adapter(startArgs(a));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(victim), false, 'the planted link must not be followed to its target');
    assert.equal(fs.lstatSync(`${a.progressFile}.1.tmp`).isSymbolicLink(), true, 'the squatter is left alone, not replaced');
    const prog = JSON.parse(fs.readFileSync(a.progressFile, 'utf8'));
    assert.equal(prog.status, 'done', 'later snapshots use fresh names, so one squatter costs one snapshot and not the channel');
  });
  for (const [mode, status] of [['ok', 'done'], ['exit3', 'failed']]) {
    test(`a squatter at every predictable temp name cannot suppress the terminal ${status} snapshot`, () => {
      // Review P1 on the first fix: with one predictable name per snapshot, occupying the TERMINAL
      // one left progress.json at `running` while the adapter said done (or failed). Occupy all of
      // them; the retry on an unpredictable name is what must carry the final state through.
      const a = allocDir();
      for (let n = 1; n <= 40; n++) fs.symlinkSync(path.join(sandbox, `ESCAPE-${n}.json`), `${a.progressFile}.${n}.tmp`);
      const r = adapter(startArgs(a), { FAKE_CODEX_MODE: mode });
      assert.equal(r.status, mode === 'ok' ? 0 : 1, r.stderr);
      const prog = JSON.parse(fs.readFileSync(a.progressFile, 'utf8'));
      assert.equal(prog.status, status, `the terminal state must land whatever squats on the predictable names: ${r.stderr}`);
      assert.equal(fs.readdirSync(sandbox).filter((f) => f.startsWith('ESCAPE-')).length, 0, 'no planted link was followed to its target');
    });
  }
  test('a multiline or tag-shaped command stays one physical, tagged stderr line and cannot forge a diagnostic', async () => {
    // Review P1: `command` is child-controlled text; unescaped, a newline inside it becomes a second
    // physical line without the progress tag — and it can be made to START with the error tag.
    const forged = 'ls\n[CODEX_EXEC_ERROR] reason=forged by the child\n';
    const a = allocDir();
    const { code, err, heldErr } = await held(a, 3, () => { /* thread.started, turn.started and the OPEN item.started are early */ }, 5,
      { FAKE_CODEX_TOOL_COMMAND: forged });
    assert.equal(code, 0, err);
    const lines = err.split('\n').filter(Boolean);
    assert.ok(lines.every((l) => l.startsWith('[CODEX_EXEC_PROGRESS] ')), `every physical line must carry the tag: ${err}`);
    assert.ok(!lines.some((l) => l.startsWith('[CODEX_EXEC_ERROR]')), 'no line may impersonate the diagnostic');
    const settled = lastPeriodic(heldErr);       // while held the item is still open, so `tool=` carries the command
    assert.match(settled, / tool=ls\\n\[CODEX_EXEC_ERROR\] reason=forged by the child\\n /, `the command is shown escaped, on the same line: ${settled}`);
    const prog = JSON.parse(fs.readFileSync(a.progressFile, 'utf8'));
    assert.equal(prog.tool, null, 'the item closed once the gate opened');
  });
  test('a temp root whose name carries a newline and the error tag cannot forge a diagnostic through the done line', () => {
    // Review P1, second instance: `oneLine()` escaped child command text, but the `done` line
    // embedded the report PATH raw — and that path sits under an environment-chosen temp root.
    // A directory name may contain a newline, so the forged second line was reachable from TMPDIR.
    const evil = path.join(sandbox, 'tmp\n[CODEX_EXEC_ERROR] reason=forged by the temp root');
    fs.mkdirSync(evil);
    const alloc = adapter(['--protocol', '1', 'alloc'], { TMPDIR: evil });
    assert.equal(alloc.status, 0, alloc.stderr);
    allocated.push(alloc.record.dir);
    fs.writeFileSync(alloc.record.promptFile, 'Review this change.');
    const r = adapter(startArgs(alloc.record), { TMPDIR: evil });
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stderr.split('\n').filter(Boolean);
    assert.ok(lines.every((l) => l.startsWith('[CODEX_EXEC_PROGRESS] ')), `every physical stderr line must carry the tag: ${r.stderr}`);
    assert.ok(!lines.some((l) => l.startsWith('[CODEX_EXEC_ERROR]')), 'no line may impersonate the diagnostic');
    const done = lines[lines.length - 1];
    assert.match(done, /^\[CODEX_EXEC_PROGRESS\] done elapsed=\d\d:\d\d report=/);
    assert.ok(done.includes('tmp\\n[CODEX_EXEC_ERROR] reason=forged by the temp root'), `the path is shown escaped, in full, on the same line: ${done}`);
    assert.ok(done.endsWith('/report.md'), 'the report path is never truncated');
  });
  test('a resume whose child emits no thread.started still records the supplied thread in progress.json', () => {
    // The contract lets a resume succeed without the event (the supplied id stands in). The control
    // record already said so; progress.json said `null` — a review caught the two disagreeing.
    const a = allocDir();
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const r = adapter(['--protocol', '1', 'resume', '--thread-id', id, '--class', 'review', '--prompt-file', a.promptFile, '--report-file', a.reportFile],
      { FAKE_CODEX_MODE: 'no_thread' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.record.threadId, id);
    const prog = JSON.parse(fs.readFileSync(a.progressFile, 'utf8'));
    assert.equal(prog.threadId, id, 'the final state names the same thread the control record does');
    assert.equal(prog.status, 'done');
  });
  test('a post-start failure that is not the child\'s still records failed — the prompt read stream erroring', () => {
    // Review P1: the prompt-read and stdin error paths called fail() directly and left progress.json
    // at `running`. One shared abort routine now owns every post-start exit 1; this injects the
    // prompt-read case, which is the representative one (the stdin case shares the routine).
    const a = allocDir();
    const r = adapter(startArgs(a), { FS_FAULT: 'readstream', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(diagnostic(r.stderr).startsWith('[CODEX_EXEC_ERROR] reason=error'), r.stderr);
    assert.match(r.stderr, /injected prompt read failure/);
    assert.equal(r.stdout, '', 'no control record for a failed run');
    const prog = JSON.parse(fs.readFileSync(a.progressFile, 'utf8'));
    assert.equal(prog.status, 'failed', 'AC4: a failure never leaves progress.json saying running');
  });
});

describe('alloc reaps stale siblings — the caller that is gone never runs cleanup (work item 8)', () => {
  // Measured 2026-09-05: 2180 `codex-exec-*` directories under the temp root, this suite leaking
  // none of them (before=2180 after=2180). Each test gets an isolated temp root via TMPDIR, so the
  // fixture below is the WHOLE population the sweep sees — nothing of the user's is touched here.
  const DAY = 24 * 60 * 60 * 1000;
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const isoRoot = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'cx-sweep-root-'));
  function population(root) {
    const mk = (name, mode) => { const d = path.join(root, name); fs.mkdirSync(d); fs.chmodSync(d, mode); fs.writeFileSync(path.join(d, 'report.md'), 'unread'); return d; };
    const f = { stale: mk('codex-exec-stale0', 0o700), fresh: mk('codex-exec-fresh0', 0o700), wide: mk('codex-exec-wide00', 0o755),
      other: mk('not-codex-stale0', 0o700), victim: mk('victim', 0o700), link: path.join(root, 'codex-exec-link00'), file: path.join(root, 'codex-exec-file00') };
    fs.symlinkSync(f.victim, f.link); fs.writeFileSync(f.file, 'not a directory');
    for (const p of [f.stale, f.wide, f.other, f.victim, f.file]) fs.utimesSync(p, old, old);   // after the writes, or they refresh it
    fs.lutimesSync(f.link, old, old);
    return f;
  }
  test('a 0700 codex-exec-* sibling a day old is removed; a fresh, a 0755, a non-prefixed, a file and a symlink are kept — and the link is never followed', () => {
    const root = isoRoot();
    try {
      const f = population(root);
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(path.dirname(fs.realpathSync(r.record.dir)), root, 'the sweep ran against the isolated root the alloc landed in');
      assert.ok(!fs.existsSync(f.stale), 'the stale 0700 sibling is reaped');
      for (const [k, p] of Object.entries(f)) if (k !== 'stale') assert.doesNotThrow(() => fs.lstatSync(p), `${k} must survive the sweep`);
      assert.ok(fs.existsSync(path.join(f.victim, 'report.md')), 'the symlink target (a stale-looking 0700 dir) is untouched: lstat, never realpath');
      assert.ok(fs.existsSync(r.record.dir), 'the new directory is created after the sweep and is not its own victim');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('CONTROL: the same population under an adapter whose sweep call is deleted keeps the stale sibling — the assertion above can go negative', () => {
    // `@rules/testing.md` § Guards: prove the negative by mutating the production guard on its actual
    // execution path. The mutant is the shipped adapter minus the one call, run the same way.
    const root = isoRoot();
    try {
      const f = population(root);
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace('sweepStale(tmpRoot()); ', '');
      assert.notEqual(mutated, src, 'the call site must exist to be deleted');
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const r = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root } });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(f.stale), 'without the sweep the stale sibling survives, so the reaping test is measuring the sweep');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a dispatch refreshes its directory mtime, so a running dispatch is never stale and a later alloc keeps it', () => {
    const root = isoRoot();
    try {
      const a = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(a.status, 0, a.stderr);
      fs.writeFileSync(a.record.promptFile, 'Review this change. Report format: ## Document Review …');
      fs.utimesSync(a.record.dir, old, old);
      assert.ok(Date.now() - fs.statSync(a.record.dir).mtimeMs > DAY, 'precondition: the directory reads a day stale');
      const r = adapter(startArgs(a.record), { TMPDIR: root });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(Date.now() - fs.statSync(a.record.dir).mtimeMs < 60000, 'the progress.json renames refreshed the directory mtime');
      const b = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(b.status, 0, b.stderr);
      assert.ok(fs.existsSync(a.record.reportFile), 'a later alloc keeps the directory whose dispatch just ran');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a sweep that cannot list the temp root leaves alloc succeeding — bookkeeping around the dispatch, never a condition on it', () => {
    const root = isoRoot();
    try {
      const f = population(root);
      fs.chmodSync(root, 0o300);   // write+search without read: readdir throws, mkdtemp still works (a root user would not throw — this test then proves less, not something false)
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      fs.chmodSync(root, 0o700);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(r.record.dir), 'alloc created its directory');
      if (process.getuid() !== 0) assert.ok(fs.existsSync(f.stale), 'the listing threw, the sweep gave up, and the stale sibling shows it did');
    } finally { fs.chmodSync(root, 0o700); fs.rmSync(root, { recursive: true, force: true }); }
  });
  // Every best-effort catch in the sweep, driven deterministically through the same preload injector
  // the alloc guard tests use (a root user's readdir succeeds on a 0300 directory, so the permission
  // route above proves less there). The injector enumerates the target FIRST, so "the other stale
  // entry was still reaped" proves the loop continued past the fault rather than that it ran first.
  // Where the entry ends up is part of the contract (§ Alloc): under its own name when nothing moved
  // it, under its quarantine name when the sweep could not finish deciding about it.
  const FAULT_ENV = (fault, target) => ({ FS_FAULT: fault, FS_FAULT_TARGET: target, NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` });
  const oldPrivateDir = (root, name) => { const d = path.join(root, name); fs.mkdirSync(d); fs.chmodSync(d, 0o700); fs.writeFileSync(path.join(d, 'report.md'), 'unread'); fs.utimesSync(d, old, old); return d; };
  const quarantined = (root) => fs.readdirSync(root).filter((n) => n.startsWith('.reap-'));
  const RESIDUAL = {   // fault → where the faulted entry's contents must be afterwards
    'sweep-readdir': 'own-name', 'sweep-lstat': 'own-name', 'sweep-rename': 'own-name',
    'sweep-recheck': 'quarantine', 'sweep-cwd': 'quarantine', 'sweep-readdir-inner': 'quarantine', 'sweep-rm': 'quarantine',
    'sweep-restore': 'quarantine-substitute',
  };
  // A quarantined entry's file may sit under its own inner `.reap-*` name (the per-entry rename ran
  // before the fault), so the residual is identified by CONTENT, whatever the name.
  const fileBodies = (dir) => fs.readdirSync(dir).filter((n) => fs.lstatSync(path.join(dir, n)).isFile()).map((n) => fs.readFileSync(path.join(dir, n), 'utf8'));
  for (const [fault, residual] of Object.entries(RESIDUAL)) {
    test(`alloc succeeds when ${fault} throws — the faulted entry survives (${residual})${fault === 'sweep-readdir' ? '' : ' and the sweep continues to the next one'}`, () => {
      const root = isoRoot();
      try {
        const faulted = oldPrivateDir(root, 'codex-exec-faulted0'), other = oldPrivateDir(root, 'codex-exec-other00');
        const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root, ...FAULT_ENV(fault, 'codex-exec-faulted0') });
        assert.equal(r.status, 0, r.stderr);
        assert.ok(fs.existsSync(r.record.dir), 'alloc created its directory');
        assert.equal(fs.existsSync(other), fault === 'sweep-readdir', fault === 'sweep-readdir' ? 'no listing, no sweep at all' : 'the loop went on to reap the next stale entry');
        const q = quarantined(root);
        if (residual === 'own-name') {
          assert.ok(fs.existsSync(path.join(faulted, 'report.md')), 'the faulted entry is left alone under its own name');
          assert.equal(q.length, 0, 'nothing left quarantined');
        } else {
          assert.equal(q.length, 1, 'exactly one entry stayed under its quarantine name — an evidence trail, not debris');
          assert.ok(fileBodies(path.join(root, q[0])).includes(residual === 'quarantine-substitute' ? 'a dispatch in flight' : 'unread'), 'with its contents intact');
          if (residual === 'quarantine-substitute') assert.ok(fs.existsSync(`${faulted}.orig/report.md`), 'and the original the neighbour moved aside is untouched');
          else assert.ok(!fs.existsSync(faulted), 'and nothing is left under the checked name');
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  }
  test('CONTROL: without the per-entry catch a lstat fault aborts the whole sweep — the continuation assertions above measure the catch', () => {
    const root = isoRoot();
    try {
      oldPrivateDir(root, 'codex-exec-faulted0'); const other = oldPrivateDir(root, 'codex-exec-other00');
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace("try { st = fs.lstatSync(d); } catch { continue; }", 'st = fs.lstatSync(d);');
      assert.notEqual(mutated, src);
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const r = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, ...FAULT_ENV('sweep-lstat', 'codex-exec-faulted0') } });
      assert.notEqual(r.status, 0, 'the uncaught throw escapes alloc');
      assert.ok(fs.existsSync(other), 'and the next entry is never reached');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a stale-looking directory owned by ANOTHER uid is never removed — the ownership guard can go negative', () => {
    // Every directory a test creates is the test user's, so without this injection the uid predicate
    // could be deleted and the suite would stay green. The Stats proxy changes only `uid`.
    const root = isoRoot();
    try {
      const foreign = oldPrivateDir(root, 'codex-exec-foreign0'), mine = oldPrivateDir(root, 'codex-exec-mine000');
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root, ...FAULT_ENV('sweep-foreign-uid', 'codex-exec-foreign0') });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(foreign), 'another user\'s directory survives whatever its name, mode and age');
      assert.ok(!fs.existsSync(mine), 'the same-shaped directory that IS ours is reaped in the same run — the injection is targeted, not global');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a fresh directory swapped under the checked name between lstat and rename is renamed back, never erased', () => {
    // The review's interleaving (thorough tier, P2): validate → a same-uid neighbour moves the stale
    // dir aside and puts a live one under the same name → a path-based recursive delete erases the
    // live one. The sweep renames first and compares {dev, ino} before deleting (workflow-orchestration
    // 4-implementation.md §1.1); the injector lands the swap inside that rename.
    const root = isoRoot();
    try {
      const stale = oldPrivateDir(root, 'codex-exec-swap000');
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root, ...FAULT_ENV('sweep-swap', 'codex-exec-swap000') });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(stale, 'fresh.txt')), 'the substitute is back under the checked name with its contents');
      assert.ok(fs.existsSync(`${stale}.orig/report.md`), 'the original the neighbour moved aside is untouched too');
      assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith('.reap-')), [], 'nothing left in quarantine');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('CONTROL: without the {dev, ino} comparison the same swap erases the substitute — the identity check is what the test above measures', () => {
    const root = isoRoot();
    try {
      const stale = oldPrivateDir(root, 'codex-exec-swap000');
      // Both identity checks go, not just the outer one: a review showed that with the pinned
      // stat('.') check still in place the substitute was merely relocated to quarantine, and the
      // control passed on the checked name disappearing. Erasure means: no fresh.txt anywhere.
      const src = fs.readFileSync(ADAPTER, 'utf8');
      // ...and the re-decision on the quarantined inode too: the injector's swap refreshes the directory
      // mtime, and that alone would give the substitute back. Three protections off, one loss.
      const mutated = src.replace('re.dev !== st.dev || re.ino !== st.ino || re.uid !== uid || (re.mode & 0o777) !== 0o700 || Date.now() - re.mtimeMs < STALE_MS || ownerAlive(q)', 'false').replace('here.dev === expect.dev && here.ino === expect.ino', 'true');
      assert.notEqual(mutated, src, 'the identity checks must exist to be deleted');
      assert.notEqual(mutated, src.replace('here.dev === expect.dev && here.ino === expect.ino', 'true'), 'both anchors were found');
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const r = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, ...FAULT_ENV('sweep-swap', 'codex-exec-swap000') } });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!fs.existsSync(stale), 'nothing is left under the checked name');
      assert.deepEqual(quarantined(root).filter((n) => !n.endsWith('.orig')), [], 'and nothing under a quarantine name: the substitute was erased, not relocated');
      assert.ok(fs.existsSync(`${stale}.orig/report.md`), 'the moved-aside original is still there');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a fresh directory swapped in at the QUARANTINE name after the re-check survives — the deletion is bound to the inode, not the name', () => {
    // Round-2 finding (thorough, P2): rename-then-verify closed the first window, but rmSync(q,
    // {recursive}) re-resolved q after the last identity check. The delete now runs from inside
    // the pinned directory (chdir → stat('.') identity → relative unlinks) and closes with a
    // non-recursive rmdir, which refuses the substitute's contents rather than erasing them.
    const root = isoRoot();
    try {
      const stale = oldPrivateDir(root, 'codex-exec-swapq00');
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root, ...FAULT_ENV('sweep-swap-q', 'codex-exec-swapq00') });
      assert.equal(r.status, 0, r.stderr);
      const q = quarantined(root).filter((n) => !n.endsWith('.orig'));   // the injector parks the moved-aside original at `<q>.orig`
      assert.equal(q.length, 1, 'the substitute stays under the quarantine name');
      assert.ok(fs.existsSync(path.join(root, q[0], 'fresh.txt')), 'with its contents intact — the non-recursive rmdir refused it');
      assert.ok(fs.existsSync(path.join(root, `${q[0]}.orig`, 'report.md')), 'and the verified original the neighbour moved aside is untouched');
      assert.ok(!fs.existsSync(stale), 'nothing is left under the checked name');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('CONTROL: without the pinned identity check the same post-recheck swap empties the substitute — the binding is what the test above measures', () => {
    const root = isoRoot();
    try {
      oldPrivateDir(root, 'codex-exec-swapq00');
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace('here.dev === expect.dev && here.ino === expect.ino', 'true');
      assert.notEqual(mutated, src, 'the pinned identity check must exist to be deleted');
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const r = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, ...FAULT_ENV('sweep-swap-q', 'codex-exec-swapq00') } });
      assert.equal(r.status, 0, r.stderr);
      const left = quarantined(root);
      assert.deepEqual(left.filter((n) => !n.endsWith('.orig')), [], 'the live substitute was erased — exactly the loss the inode binding prevents');
      assert.equal(left.length, 1, 'while the moved-aside original still sits at its `.orig` name');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a fresh directory swapped in at the quarantine name AFTER the pin keeps its file — the relative unlinks act on the pinned inode, not on q', () => {
    // Round-3 finding: the sweep-swap-q case is refused by stat('.') before any unlink runs, so it
    // never proved that a rename of q after the pin cannot redirect the unlinks. Here the swap lands
    // after the identity matched: the adapter's cwd is the original inode (now at `<q>.orig`), the
    // substitute at q carries a file of the SAME name as the stale one, and only a path-based
    // unlink through q could reach it.
    const root = isoRoot();
    try {
      oldPrivateDir(root, 'codex-exec-afterpin');
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root, ...FAULT_ENV('sweep-swap-after-pin', 'codex-exec-afterpin') });
      assert.equal(r.status, 0, r.stderr);
      const q = quarantined(root).filter((n) => !n.endsWith('.orig'));
      assert.equal(q.length, 1);
      assert.equal(fs.readFileSync(path.join(root, q[0], 'report.md'), 'utf8'), 'live substitute', 'the substitute keeps its same-named file');
      assert.deepEqual(fs.readdirSync(path.join(root, `${q[0]}.orig`)), [], 'the stale file in the pinned original inode was the one removed');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('CONTROL: with the per-entry calls resolved through q instead of the pinned cwd, the same swap erases the substitute\'s file', () => {
    const root = isoRoot();
    try {
      oldPrivateDir(root, 'codex-exec-afterpin');
      // ALL THREE per-entry resolutions go through q, and each anchor is checked on its own: a
      // review caught the first version leaving the initial lstat relative, so the mutant's rename
      // merely relocated the substitute and the control passed without erasing anything.
      const replaceRequired = (text, from, to) => { const next = text.replace(from, () => to); assert.notEqual(next, text, `mutation anchor missing: ${from}`); return next; };
      let mutated = fs.readFileSync(ADAPTER, 'utf8');
      mutated = replaceRequired(mutated, 'const st = fs.lstatSync(n);', 'const st = fs.lstatSync(path.join(q, n));');
      mutated = replaceRequired(mutated, 'fs.renameSync(n, qn);', 'fs.renameSync(path.join(q, n), path.join(q, qn));');
      mutated = replaceRequired(mutated, 'const re = fs.lstatSync(qn); if (re.dev === st.dev && re.ino === st.ino) fs.unlinkSync(qn);', 'const re = fs.lstatSync(path.join(q, qn)); if (re.dev === st.dev && re.ino === st.ino) fs.unlinkSync(path.join(q, qn));');
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const r = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, ...FAULT_ENV('sweep-swap-after-pin', 'codex-exec-afterpin') } });
      assert.equal(r.status, 0, r.stderr);
      const left = quarantined(root);
      assert.deepEqual(left.filter((n) => !n.endsWith('.orig')), [], 'the path-resolved mutant deleted the live substitute\'s file and then removed the emptied substitute — erased, not relocated');
      const original = left.find((n) => n.endsWith('.orig'));
      assert.ok(original, 'the moved-aside original is still there');
      assert.equal(fs.readFileSync(path.join(root, original, 'report.md'), 'utf8'), 'unread', 'with its stale file untouched — the mutant never looked at the pinned inode');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a file swapped under an entry name inside the pinned directory after its lstat is left quarantined inside, never unlinked', () => {
    // One level down, the same ordering rule as the directory (necessity-audit cleanup.js
    // unlinkVerified): rename → lstat → compare → unlink, so a substitute is relocated and refused.
    const root = isoRoot();
    try {
      oldPrivateDir(root, 'codex-exec-child000');
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root, ...FAULT_ENV('sweep-swap-child', 'codex-exec-child000') });
      assert.equal(r.status, 0, r.stderr);
      const q = quarantined(root);
      assert.equal(q.length, 1, 'the directory stays quarantined: rmdir refused it');
      const inner = fs.readdirSync(path.join(root, q[0]));
      assert.ok(inner.includes('report.md.orig'), 'the original the neighbour moved aside is untouched');
      const parked = inner.filter((n) => n.startsWith('.reap-'));
      assert.equal(parked.length, 1, 'the substitute is parked under its inner quarantine name');
      assert.equal(fs.readFileSync(path.join(root, q[0], parked[0]), 'utf8'), 'live child');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('CONTROL: without the per-entry {dev, ino} comparison the swapped-in child file is unlinked', () => {
    const root = isoRoot();
    try {
      oldPrivateDir(root, 'codex-exec-child000');
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace('if (re.dev === st.dev && re.ino === st.ino) fs.unlinkSync(qn);', 'fs.unlinkSync(qn);');
      assert.notEqual(mutated, src);
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const r = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, ...FAULT_ENV('sweep-swap-child', 'codex-exec-child000') } });
      assert.equal(r.status, 0, r.stderr);
      const q = quarantined(root);
      assert.equal(q.length, 1);
      assert.deepEqual(fs.readdirSync(path.join(root, q[0])), ['report.md.orig'], 'the live child is gone; only the moved-aside original remains');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a stale entry holding a nested directory stays quarantined with it — nothing recursive ever runs — and the sweep continues', () => {
    const root = isoRoot();
    try {
      const nested = oldPrivateDir(root, 'codex-exec-nested00'); fs.mkdirSync(path.join(nested, 'sub')); fs.writeFileSync(path.join(nested, 'sub', 'deep.txt'), 'deep');
      fs.utimesSync(nested, old, old);
      const other = oldPrivateDir(root, 'codex-exec-other00');
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!fs.existsSync(other), 'the flat stale entry is reaped');
      const q = quarantined(root);
      assert.equal(q.length, 1, 'the nested one stays quarantined');
      assert.equal(fs.readFileSync(path.join(root, q[0], 'sub', 'deep.txt'), 'utf8'), 'deep', 'with the nested directory intact');
      assert.ok(!fs.existsSync(path.join(root, q[0], 'report.md')), 'its regular file was removed — only the directory branch was skipped');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('KNOWN LIMIT: a file swapped under the inner quarantine name AFTER its re-lstat is unlinked — the final unlink is name-based, guarded by unpredictability, not atomicity', () => {
    // Stated rather than hidden, as the precedent states it (necessity-audit cleanup.js
    // unlinkVerified: "the final unlink still resolves a name, and unpredictability — not atomicity —
    // is what makes that safe"). Node exposes no unlink-by-descriptor, so no fully bound form exists.
    // The injector lands the swap by hooking lstat itself; a real neighbour would have to guess a
    // random name that exists for microseconds. If this test ever fails because the substitute
    // survived, the adapter gained a binding this comment says it cannot have — update both.
    const root = isoRoot();
    try {
      oldPrivateDir(root, 'codex-exec-childlate');
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root, ...FAULT_ENV('sweep-swap-child-after-recheck', 'codex-exec-childlate') });
      assert.equal(r.status, 0, r.stderr);
      const q = quarantined(root);
      assert.equal(q.length, 1, 'the directory stays quarantined: the moved-aside original keeps it non-empty');
      assert.deepEqual(fileBodies(path.join(root, q[0])), ['unread'], 'the moved-aside original survives; the substitute under the random name did not');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a SILENT live dispatch is refreshed by the periodic tick alone, and a later alloc keeps it', async () => {
    // AC4's first test aged the directory before `start`, so preflight, the initial snapshot and the
    // fake's events all refreshed it — a reviewer showed that dropping the tick's snapshot would
    // leave that test green while a >24 h silent dispatch became reapable. Here the directory is
    // aged only once the child is held with NO events pending, so the tick → snapshot → rename is
    // the only thing that can move the mtime.
    const { spawn } = require('node:child_process');
    const { once } = require('node:events');
    const root = isoRoot();
    let child = null, closed = null;
    const until = async (pred, msg) => { const deadline = Date.now() + 5000; while (!pred()) { if (Date.now() > deadline) throw new Error(msg); await new Promise((r) => setTimeout(r, 10)); } };
    try {
      const a = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(a.status, 0, a.stderr);
      fs.writeFileSync(a.record.promptFile, 'Review this change. Report format: ## Document Review …');
      const gate = path.join(a.record.dir, 'gate');
      child = spawn(process.execPath, [ADAPTER, ...startArgs(a.record)], {
        cwd: repo, stdio: 'ignore',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, TMPDIR: root, FAKE_CODEX_WAIT: gate, FAKE_CODEX_EARLY_LINES: '0', CODEX_EXEC_TICK_MS: '40' },
      });
      closed = once(child, 'close');
      await until(() => fs.existsSync(`${gate}.ready`) && fs.existsSync(a.record.progressFile), 'the dispatch never reached its silent held state');
      assert.equal(child.exitCode, null);
      fs.utimesSync(a.record.dir, old, old);                              // only now: every start-time write has happened
      assert.ok(Date.now() - fs.statSync(a.record.dir).mtimeMs > DAY, 'precondition: the directory reads a day stale');
      await until(() => Date.now() - fs.statSync(a.record.dir).mtimeMs < 1000, 'no periodic tick refreshed the directory mtime');
      assert.equal(child.exitCode, null, 'the dispatch is still live and still silent');
      const b = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(b.status, 0, b.stderr);
      assert.ok(fs.existsSync(a.record.progressFile), 'a later alloc keeps the live dispatch');
      fs.writeFileSync(gate, 'go');
      const [code] = await closed;
      assert.equal(code, 0, 'and the held run still completes normally');
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (closed) await closed.catch(() => {});
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('a LIVE dispatch whose heartbeat has stopped is never reaped — the owner pid is positive liveness the mtime cannot give', async () => {
    // The mtime is a heartbeat, and a heartbeat can stop while its owner lives: a machine asleep
    // for a day, every snapshot failing. Here the child is held with no events, the tick is set
    // far beyond the test, and the directory is aged — the only thing that can keep it is the
    // pid the adapter wrote at preflight.
    const { spawn } = require('node:child_process');
    const { once } = require('node:events');
    const root = isoRoot();
    let child = null, closed = null;
    const until = async (pred, msg) => { const deadline = Date.now() + 5000; while (!pred()) { if (Date.now() > deadline) throw new Error(msg); await new Promise((r) => setTimeout(r, 10)); } };
    try {
      const a = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(a.status, 0, a.stderr);
      fs.writeFileSync(a.record.promptFile, 'Review this change. Report format: ## Document Review …');
      const gate = path.join(a.record.dir, 'gate');
      child = spawn(process.execPath, [ADAPTER, ...startArgs(a.record)], {
        cwd: repo, stdio: 'ignore',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, TMPDIR: root, FAKE_CODEX_WAIT: gate, FAKE_CODEX_EARLY_LINES: '0', CODEX_EXEC_TICK_MS: '3600000' },
      });
      closed = once(child, 'close');
      await until(() => fs.existsSync(`${gate}.ready`) && fs.existsSync(a.record.progressFile), 'the dispatch never reached its silent held state');
      assert.equal(JSON.parse(fs.readFileSync(a.record.progressFile, 'utf8')).pid, child.pid, 'progress.json names the adapter as owner');
      fs.utimesSync(a.record.dir, old, old);
      const b = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(b.status, 0, b.stderr);
      assert.ok(fs.existsSync(a.record.progressFile), 'a day-stale directory with a living owner is kept');
      assert.equal(child.exitCode, null);
      fs.writeFileSync(gate, 'go');
      const [code] = await closed;
      assert.equal(code, 0);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (closed) await closed.catch(() => {});
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('the preflight owner record is written before any child exists, and a dead owner does not protect a stale directory', () => {
    const root = isoRoot();
    try {
      // A finished process's pid, so `kill(pid, 0)` fails: the record is there but its owner is not.
      const dead = spawnSync(process.execPath, ['-e', '0']).pid;
      const stale = oldPrivateDir(root, 'codex-exec-deadpid0');
      fs.writeFileSync(path.join(stale, 'progress.json'), JSON.stringify({ protocol: 1, status: 'running', pid: dead }) + '\n');
      fs.utimesSync(stale, old, old);
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!fs.existsSync(stale), 'reaped: the owner pid no longer exists');
      // And the record a real dispatch leaves: preflight writes it into the exclusively created file.
      fs.writeFileSync(r.record.promptFile, 'Review this change. Report format: ## Document Review …');
      const s = adapter(startArgs(r.record), { TMPDIR: root });
      assert.equal(s.status, 0, s.stderr);
      const first = fs.readFileSync(r.record.eventsFile, 'utf8');   // the run wrote events, so the file below is the final snapshot — the preflight record is proven by the held test above
      assert.ok(first.length > 0);
      assert.equal(typeof JSON.parse(fs.readFileSync(r.record.progressFile, 'utf8')).pid, 'number', 'every snapshot carries the owner pid');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('CONTROL: without the liveness check the held live dispatch IS reaped — the pid is what the test above measures', async () => {
    const { spawn } = require('node:child_process');
    const { once } = require('node:events');
    const root = isoRoot();
    let child = null, closed = null;
    const until = async (pred, msg) => { const deadline = Date.now() + 5000; while (!pred()) { if (Date.now() > deadline) throw new Error(msg); await new Promise((r) => setTimeout(r, 10)); } };
    try {
      const a = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(a.status, 0, a.stderr);
      fs.writeFileSync(a.record.promptFile, 'Review this change. Report format: ## Document Review …');
      const gate = path.join(a.record.dir, 'gate');
      child = spawn(process.execPath, [ADAPTER, ...startArgs(a.record)], {
        cwd: repo, stdio: 'ignore',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, TMPDIR: root, FAKE_CODEX_WAIT: gate, FAKE_CODEX_EARLY_LINES: '0', CODEX_EXEC_TICK_MS: '3600000' },
      });
      closed = once(child, 'close');
      await until(() => fs.existsSync(`${gate}.ready`) && fs.existsSync(a.record.progressFile), 'the dispatch never reached its silent held state');
      fs.utimesSync(a.record.dir, old, old);
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace(' || ownerAlive(d)) continue;', ') continue;').replace(' || ownerAlive(q)) {', ') {');
      assert.notEqual(mutated, src, 'the liveness call must exist to be deleted');
      assert.notEqual(mutated, src.replace(' || ownerAlive(d)) continue;', ') continue;'), 'both probes (before and after quarantine) were found');
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const r = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root } });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!fs.existsSync(a.record.progressFile), 'the live dispatch lost its directory — exactly the loss the pid check prevents');
      child.kill('SIGKILL');   // its gate is gone with the directory; nothing to release
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (closed) await closed.catch(() => {});
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('the exact starting owner record exists BEFORE codex is spawned — deleting the preflight write cannot hide behind a later snapshot', async () => {
    // The earlier "preflight owner record" test read a snapshot taken after spawn, so removing the
    // preflight write while keeping the snapshots left it green (a review showed it). The adapter is
    // held at the instant before its spawn call and the file is read while no child exists.
    const { spawn } = require('node:child_process');
    const { once } = require('node:events');
    const root = isoRoot();
    let child = null, closed = null;
    const until = async (pred, msg) => { const deadline = Date.now() + 5000; while (!pred()) { if (Date.now() > deadline) throw new Error(msg); await new Promise((r) => setTimeout(r, 10)); } };
    try {
      const a = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(a.status, 0, a.stderr);
      fs.writeFileSync(a.record.promptFile, 'Review this change. Report format: ## Document Review …');
      fs.writeFileSync(log, '');
      const gate = path.join(a.record.dir, 'before-spawn');
      child = spawn(process.execPath, [ADAPTER, ...startArgs(a.record)], {
        cwd: repo, stdio: 'ignore',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, FAKE_CODEX_LOG: log, TMPDIR: root, FS_FAULT: 'pause-before-spawn', FS_FAULT_GATE: gate, NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` },
      });
      closed = once(child, 'close');
      await until(() => fs.existsSync(`${gate}.ready`), 'the adapter never reached its spawn call');
      assert.deepEqual(JSON.parse(fs.readFileSync(a.record.progressFile, 'utf8')), { protocol: 1, status: 'starting', pid: child.pid }, 'exactly the owner record, nothing else yet');
      assert.equal(fs.readFileSync(log, 'utf8'), '', 'and the fake codex has not been launched');
      // The record is not just serialized, it PARTICIPATES in liveness: a dispatch suspended for a
      // day during preflight is still an owner. Dropping `starting` from the prefix fails here.
      fs.utimesSync(a.record.dir, old, old);
      const next = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(next.status, 0, next.stderr);
      assert.ok(fs.existsSync(a.record.progressFile), 'a live pre-spawn owner with status=starting is kept');
      assert.equal(child.exitCode, null);
      fs.writeFileSync(gate, 'go');
      const [code] = await closed;
      assert.equal(code, 0, 'the run then completes normally');
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (closed) await closed.catch(() => {});
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('a failed preflight owner-record write is invalid_progress_file, before any child exists', () => {
    const root = isoRoot();
    try {
      const a = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      fs.writeFileSync(a.record.promptFile, 'Review this change. Report format: ## Document Review …');
      const r = adapter(startArgs(a.record), { TMPDIR: root, FS_FAULT: 'progress-owner-write', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` });
      assert.equal(r.status, 2, r.stderr);
      assert.match(diagnostic(r.stderr), /^\[CODEX_EXEC_USAGE\] code=invalid_progress_file/);
      assert.equal(r.stdout, '', 'no control record');
      assert.equal(r.launches.length, 0, 'codex never ran');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('EPERM from kill(pid, 0) counts as alive — a process that exists but is not ours to signal keeps its directory', () => {
    const root = isoRoot();
    try {
      const guarded = oldPrivateDir(root, 'codex-exec-eperm00'), other = oldPrivateDir(root, 'codex-exec-other00');
      fs.writeFileSync(path.join(guarded, 'progress.json'), JSON.stringify({ protocol: 1, status: 'running', pid: 424242 }) + '\n');
      fs.utimesSync(guarded, old, old);
      const env = { TMPDIR: root, FS_FAULT: 'sweep-kill-eperm', FS_FAULT_PID: '424242', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` };
      const r = adapter(['--protocol', '1', 'alloc'], env);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(guarded), 'EPERM is fail-safe: kept');
      assert.ok(!fs.existsSync(other), 'the sweep still handled the other entry');
      // CONTROL: read EPERM as dead and the guarded directory goes.
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace("catch (e) { return e.code !== 'ESRCH'; }", 'catch { return false; }');
      assert.notEqual(mutated, src, 'the kill-error classification must exist to be deleted');
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const m = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });
      assert.equal(m.status, 0, m.stderr);
      assert.ok(!fs.existsSync(guarded), 'without the branch the guarded directory is reaped — the branch is what the assertion above measures');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a live dispatch whose snapshot has grown past 64 KiB is still recognised as live — the owner is a fixed prefix, not a parsed whole', async () => {
    // Round-6 finding: the first owner check parsed the whole file under a 64 KiB cap, so a snapshot
    // carrying a large child command called its live owner dead. The record is now read as the
    // fixed prefix every snapshot begins with; the size behind it is irrelevant.
    const { spawn } = require('node:child_process');
    const { once } = require('node:events');
    const root = isoRoot();
    let child = null, closed = null;
    const until = async (pred, msg) => { const deadline = Date.now() + 5000; while (!pred()) { if (Date.now() > deadline) throw new Error(msg); await new Promise((r) => setTimeout(r, 10)); } };
    try {
      const a = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(a.status, 0, a.stderr);
      fs.writeFileSync(a.record.promptFile, 'Review this change. Report format: ## Document Review …');
      const gate = path.join(a.record.dir, 'gate');
      child = spawn(process.execPath, [ADAPTER, ...startArgs(a.record)], {   // held after item.started (3 early lines), whose command is 70 KiB
        cwd: repo, stdio: 'ignore',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, TMPDIR: root, FAKE_CODEX_WAIT: gate, FAKE_CODEX_EARLY_LINES: '3', FAKE_CODEX_TOOL_COMMAND: 'x'.repeat(70 * 1024), CODEX_EXEC_TICK_MS: '3600000' },
      });
      closed = once(child, 'close');
      await until(() => { try { return fs.existsSync(`${gate}.ready`) && fs.statSync(a.record.progressFile).size > 65536; } catch { return false; } }, 'the snapshot never grew past 64 KiB while held');
      fs.utimesSync(a.record.dir, old, old);
      const b = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(b.status, 0, b.stderr);
      assert.ok(fs.existsSync(a.record.progressFile), 'kept: the owner prefix was read, the size behind it ignored');
      assert.equal(child.exitCode, null);
      fs.writeFileSync(gate, 'go');
      const [code] = await closed;
      assert.equal(code, 0);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (closed) await closed.catch(() => {});
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  test('an owner record that is not the adapter\'s prefix gives no liveness — a nested pid, a huge pid, a non-file — and alloc still succeeds', () => {
    const root = isoRoot();
    try {
      const cases = {
        'codex-exec-nested00': JSON.stringify({ protocol: 1, status: 'running', usage: { pid: process.pid } }) + '\n',   // our own live pid, but nested: not the owner
        'codex-exec-hugepid0': '{"protocol":1,"status":"running","pid":99999999999}',
        'codex-exec-string00': '{"protocol":1,"status":"running","pid":"' + process.pid + '"}',
        'codex-exec-order000': JSON.stringify({ status: 'running', protocol: 1, pid: process.pid }) + '\n',              // right keys, wrong order: not written by the adapter
        'codex-exec-zeropid0': '{"protocol":1,"status":"running","pid":0}',   // kill(0, 0) "succeeds" on our own process group: zero would protect debris forever
        'codex-exec-int32000': '{"protocol":1,"status":"running","pid":2147483648}',   // kill() rejects it with a validation error, which the tri-state would read as "unknown, keep" — forever
        'codex-exec-tendigit': '{"protocol":1,"status":"running","pid":9999999999}',
        'codex-exec-leadzero': '{"protocol":1,"status":"running","pid":0' + process.pid + '}',   // a live pid, non-canonically encoded: not the adapter's record
      };
      const dirs = Object.entries(cases).map(([name, body]) => { const d = oldPrivateDir(root, name); fs.writeFileSync(path.join(d, 'progress.json'), body); fs.utimesSync(d, old, old); return d; });
      const link = oldPrivateDir(root, 'codex-exec-linkpid0'); fs.unlinkSync(path.join(link, 'report.md'));
      fs.symlinkSync(path.join(root, 'elsewhere.json'), path.join(link, 'progress.json')); fs.writeFileSync(path.join(root, 'elsewhere.json'), '{"protocol":1,"status":"running","pid":' + process.pid + '}'); fs.utimesSync(link, old, old);
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      assert.equal(r.status, 0, r.stderr);
      for (const d of dirs) assert.ok(!fs.existsSync(d), `${path.basename(d)} carries no owner and is reaped`);
      assert.ok(!fs.existsSync(link), 'a symlinked progress.json is not read: reaped');
      assert.ok(fs.existsSync(path.join(root, 'elsewhere.json')), 'and its target outside the directory is untouched');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a FIFO swapped in at the owner-record path cannot hang the sweep — the open is non-blocking and the descriptor is judged, not the name', () => {
    // Round-7 finding: lstat said "regular file", then a blocking open of the same NAME. A FIFO
    // installed between the two parks the open until a writer appears, and alloc with it. The open
    // is O_NONBLOCK|O_NOFOLLOW now and fstat on the descriptor decides; a FIFO reads as "no owner".
    const root = isoRoot();
    try {
      // The candidate carries a LIVE owner record, so without the swap it would be kept: the FIFO
      // landing is what changes the outcome, and a vacuous run (no record → the injector's rename
      // throws before mkfifo) cannot pass — a first version of this test did exactly that.
      const withOwner = (name) => { const d = oldPrivateDir(root, name); fs.writeFileSync(path.join(d, 'progress.json'), `{"protocol":1,"status":"running","pid":${process.pid}}\n`); fs.utimesSync(d, old, old); return d; };
      const fifo = withOwner('codex-exec-fifo000'); const other = oldPrivateDir(root, 'codex-exec-other00');
      const env = { TMPDIR: root, FS_FAULT: 'sweep-fifo-swap', FS_FAULT_TARGET: 'codex-exec-fifo000', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` };
      const r = spawnSync(process.execPath, [ADAPTER, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', timeout: 10000, env: { ...process.env, ...env } });
      assert.equal(r.status, 0, `alloc must finish, not hang: signal=${r.signal} ${r.stderr}`);
      assert.ok(!fs.existsSync(fifo), 'a FIFO is not an owner record: no liveness, and the stale entry was reaped');
      assert.ok(!fs.existsSync(other), 'the sweep went on to the next entry');
      // CONTROL: a blocking open of the same name hangs until the deadline kills it — the flag is load-bearing.
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace('fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW', 'fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW');
      assert.notEqual(mutated, src, 'the non-blocking flag must exist to be deleted');
      withOwner('codex-exec-fifo000');   // a fresh candidate with its record: the first run consumed the previous one
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const m = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', timeout: 3000, env: { ...process.env, ...env } });
      assert.notEqual(m.status, 0, 'without O_NONBLOCK the open parks on the FIFO and the deadline has to kill alloc');
      assert.equal(m.signal, 'SIGTERM', 'killed by the test deadline, which is the hang made visible');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('owner liveness reads exactly the 96-byte prefix — a whole-file read or another length is refused by the injector', () => {
    // A regression to `readFileSync` + regex would pass the oversized-snapshot test above (it only
    // asks that a big file still yields liveness). Here every whole-file read of the owner record
    // and every descriptor read of a different length throws, so only the bounded read finds the owner.
    const root = isoRoot();
    try {
      const d = oldPrivateDir(root, 'codex-exec-readbound');
      fs.writeFileSync(path.join(d, 'progress.json'), `{"protocol":1,"status":"running","pid":${process.pid},"padding":"${'x'.repeat(1024 * 1024)}"}`);
      fs.utimesSync(d, old, old);
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root, ...FAULT_ENV('sweep-owner-read-budget', 'codex-exec-readbound') });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(d), 'the bounded prefix read found the live owner and nothing else was read');
      // CONTROL: a whole-file read through the open descriptor — the regression a path-only injector
      // missed — is poisoned by the injector (not thrown: a throw reads as unknown-keep), so the live
      // owner goes unseen and the candidate is reaped.
      const src = fs.readFileSync(ADAPTER, 'utf8');
      const mutated = src.replace("const buf = Buffer.alloc(96); const n = fs.readSync(fd, buf, 0, 96, 0);", 'const buf = fs.readFileSync(fd); const n = buf.length;');
      assert.notEqual(mutated, src, 'the bounded read must exist to be mutated');
      const d2 = oldPrivateDir(root, 'codex-exec-readbnd2');   // its own name: the live candidate above was kept and still exists
      fs.writeFileSync(path.join(d2, 'progress.json'), `{"protocol":1,"status":"running","pid":${process.pid},"padding":"${'x'.repeat(1024 * 1024)}"}`);
      fs.utimesSync(d2, old, old);
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const m = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, ...FAULT_ENV('sweep-owner-read-budget', 'codex-exec-readbnd2') } });
      assert.equal(m.status, 0, m.stderr);
      assert.ok(!fs.existsSync(d2), 'the whole-file read was poisoned to {}, no owner was seen, the candidate was reaped — so the passing run above really read 96 bytes');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('the owner record is judged by the DESCRIPTOR: a directory swapped in at its path after the open changes nothing, and a stat by name would', () => {
    const root = isoRoot();
    try {
      const withOwner = (name) => { const d = oldPrivateDir(root, name); fs.writeFileSync(path.join(d, 'progress.json'), `{"protocol":1,"status":"running","pid":${process.pid}}\n`); fs.utimesSync(d, old, old); return d; };
      const d = withOwner('codex-exec-afteropen');
      const env = { TMPDIR: root, ...FAULT_ENV('sweep-owner-swap-after-open', 'codex-exec-afteropen') };
      const r = adapter(['--protocol', '1', 'alloc'], env);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(d, 'progress.json.orig')), 'kept: fstat on the open descriptor saw the regular file it opened, and the prefix was read from it');
      // CONTROL: judge the NAME instead — it is a directory now — and the live candidate is lost.
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace('if (!fs.fstatSync(fd).isFile()) return false;', "if (!fs.statSync(path.join(dir, 'progress.json')).isFile()) return false;");
      assert.notEqual(mutated, src, 'the descriptor check must exist to be mutated');
      const d2 = withOwner('codex-exec-afteropn2');   // its own name: the live candidate above was kept and still exists
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const m = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, ...FAULT_ENV('sweep-owner-swap-after-open', 'codex-exec-afteropn2') } });
      assert.equal(m.status, 0, m.stderr);
      assert.ok(!fs.existsSync(path.join(d2, 'progress.json.orig')), 'judged by name, the live owner went unseen and the candidate lost its name — the descriptor is load-bearing');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  for (const [step, code] of [['open', 'EIO'], ['open', 'EMFILE'], ['fstat', 'EIO'], ['read', 'EIO'], ['kill', 'EINVAL']]) {
    test(`an unexpected ${code} while probing the owner (${step}) is not proof of death — the candidate is kept and the sweep continues`, () => {
      const root = isoRoot();
      try {
        const guarded = oldPrivateDir(root, 'codex-exec-probe000'), other = oldPrivateDir(root, 'codex-exec-other00');
        fs.writeFileSync(path.join(guarded, 'progress.json'), '{"protocol":1,"status":"running","pid":424242}\n'); fs.utimesSync(guarded, old, old);
        const env = { TMPDIR: root, FS_FAULT: 'sweep-probe-error', FS_FAULT_TARGET: 'codex-exec-probe000', FS_FAULT_STEP: step, FS_FAULT_CODE: code, FS_FAULT_PID: '424242', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` };
        const r = adapter(['--protocol', '1', 'alloc'], env);
        assert.equal(r.status, 0, r.stderr);
        assert.ok(fs.existsSync(guarded), `${code} is unknown, not dead: kept`);
        assert.ok(!fs.existsSync(other), 'the sweep still handled the other entry');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  }
  test('CONTROL: mapping an unexpected probe error to "dead" reaps the guarded candidate — the tri-state is what the tests above measure', () => {
    const root = isoRoot();
    try {
      const guarded = oldPrivateDir(root, 'codex-exec-probe000');
      fs.writeFileSync(path.join(guarded, 'progress.json'), '{"protocol":1,"status":"running","pid":424242}\n'); fs.utimesSync(guarded, old, old);
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace("catch (e) { return !['ENOENT', 'ENOTDIR', 'ELOOP'].includes(e.code); }", 'catch { return false; }');
      assert.notEqual(mutated, src, 'the open-error classification must exist to be deleted');
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const m = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, FS_FAULT: 'sweep-probe-error', FS_FAULT_TARGET: 'codex-exec-probe000', FS_FAULT_STEP: 'open', FS_FAULT_CODE: 'EIO', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` } });
      assert.equal(m.status, 0, m.stderr);
      assert.ok(!fs.existsSync(guarded), 'read as dead, the guarded candidate is gone');
      // ...and the OUTER catch, the one behind fstat/read after the descriptor is open, separately.
      const guarded2 = oldPrivateDir(root, 'codex-exec-probe002');
      fs.writeFileSync(path.join(guarded2, 'progress.json'), '{"protocol":1,"status":"running","pid":424242}\n'); fs.utimesSync(guarded2, old, old);
      const mutated2 = src.replace('} catch { return true; } finally {', '} catch { return false; } finally {');
      assert.notEqual(mutated2, src, 'the outer probe catch must exist to be mutated');
      fs.writeFileSync(mutant, mutated2);
      const m2 = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, FS_FAULT: 'sweep-probe-error', FS_FAULT_TARGET: 'codex-exec-probe002', FS_FAULT_STEP: 'read', FS_FAULT_CODE: 'EIO', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` } });
      assert.equal(m2.status, 0, m2.stderr);
      assert.ok(!fs.existsSync(guarded2), 'mapping a read failure to dead reaps the candidate — the outer catch is load-bearing too');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a directory reactivated on the SAME inode between the checks and the rename is given back — the decision is re-made on the quarantined inode', () => {
    const root = isoRoot();
    try {
      const d = oldPrivateDir(root, 'codex-exec-react000');
      const env = { TMPDIR: root, ...FAULT_ENV('sweep-reactivate', 'codex-exec-react000') };
      const r = adapter(['--protocol', '1', 'alloc'], env);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(path.join(d, 'progress.json')), 'kept, under its own name, with the owner record the delayed start wrote');
      assert.deepEqual(quarantined(root), [], 'nothing left in quarantine');
      // CONTROL: decide only on identity after the rename and the reactivated directory is emptied and removed.
      const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace('Date.now() - re.mtimeMs < STALE_MS || ownerAlive(q)', 'false');
      assert.notEqual(mutated, src, 'the re-decision must exist to be deleted');
      const d2 = oldPrivateDir(root, 'codex-exec-react002');
      const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
      const m = spawnSync(process.execPath, [mutant, '--protocol', '1', 'alloc'], { cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: root, ...FAULT_ENV('sweep-reactivate', 'codex-exec-react002') } });
      assert.equal(m.status, 0, m.stderr);
      assert.ok(!fs.existsSync(d2), 'without the re-decision the reactivated directory is reaped — exactly the loss it prevents');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  test('a failed close of the preflight-created report is invalid_report_file (exit 2), never an uncaught exit 1', () => {
    const root = isoRoot();
    try {
      const a = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
      fs.writeFileSync(a.record.promptFile, 'Review this change. Report format: ## Document Review …');
      const r = adapter(startArgs(a.record), { TMPDIR: root, FS_FAULT: 'report-close', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` });
      assert.equal(r.status, 2, r.stderr);
      assert.match(diagnostic(r.stderr), /^\[CODEX_EXEC_USAGE\] code=invalid_report_file/);
      assert.equal(r.launches.length, 0, 'codex never ran');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  for (const fault of ['snapshot-chmod', 'snapshot-rename']) {
    test(`a snapshot that fails on every event (${fault}) still lets the run complete and leaves no temp debris or open descriptors behind`, () => {
      // Review P2: createPrivate leaked the file and descriptor on a failed fchmod, and a failed
      // rename left its temp file — four per snapshot, one snapshot per event and tick.
      const root = isoRoot();
      try {
        const a = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
        fs.writeFileSync(a.record.promptFile, 'Review this change. Report format: ## Document Review …');
        const r = adapter(startArgs(a.record), { TMPDIR: root, FAKE_CODEX_EXTRA_EVENTS: '40', FS_FAULT: fault, NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` });
        assert.equal(r.status, 0, `the verdict never depends on the snapshot: ${r.stderr}`);
        assert.deepEqual(fs.readdirSync(a.record.dir).filter((n) => n.endsWith('.tmp')), [], 'no temp snapshot left behind');
        if (fault === 'snapshot-chmod') {
          // CONTROL: drop only the close branch of createPrivate — the path still disappears (unlink
          // stays), but the descriptor stays open and the injector exits 97 at the next temp open.
          const src = fs.readFileSync(ADAPTER, 'utf8'), mutated = src.replace('if (fd !== null) { try { fs.closeSync(fd); } catch { /* best effort */ } try { fs.unlinkSync(file); }', 'if (fd !== null) { try { fs.unlinkSync(file); }');
          assert.notEqual(mutated, src, 'the close branch must exist to be deleted');
          const b = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root });
          fs.writeFileSync(b.record.promptFile, 'Review this change. Report format: ## Document Review …');
          const mutant = path.join(root, 'mutant-adapter.js'); fs.writeFileSync(mutant, mutated);
          const m = spawnSync(process.execPath, [mutant, ...startArgs(b.record)], { cwd: repo, encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CODEX_HOME: codexHome, TMPDIR: root, FAKE_CODEX_EXTRA_EVENTS: '40', FS_FAULT: fault, NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` } });
          assert.equal(m.status, 97, `without the close the failed descriptor is still open at the next snapshot — the injector saw it: ${m.stderr.slice(-200)}`);
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  }
  test('the exact pid ceiling 2147483647 still reaches the liveness probe', () => {
    const root = isoRoot();
    try {
      const guarded = oldPrivateDir(root, 'codex-exec-int32max');
      fs.writeFileSync(path.join(guarded, 'progress.json'), '{"protocol":1,"status":"running","pid":2147483647}\n'); fs.utimesSync(guarded, old, old);
      const r = adapter(['--protocol', '1', 'alloc'], { TMPDIR: root, FS_FAULT: 'sweep-kill-eperm', FS_FAULT_PID: '2147483647', NODE_OPTIONS: `--require ${path.join(ROOT, 'test/fixtures/codex-exec/fs-fault.js')}` });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(fs.existsSync(guarded), 'the maximum canonical pid was probed (EPERM → alive), not rejected as out of range');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
