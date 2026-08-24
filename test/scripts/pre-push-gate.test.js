const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { statSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, rmSync } = require('node:fs');
const { execSync, spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
// One definition, two consumers: this file and the node process the discriminator runs
// inside a pty. See test/scripts/helpers/detached-spawn.js for why it is not inline.
const HELPER = resolve(__dirname, 'helpers/detached-spawn.js');
const { spawnDetached, spawnAttached, TTY_PROBE } = require(HELPER);

const scriptPath = resolve(__dirname, '../../scripts/pre-push-gate.sh');
const repoRoot = resolve(__dirname, '../..');
// Resolved once, absolutely, because the round-33 residual test puts a lying `git` first on PATH
// and the delegating wrapper must reach the real one. `command -v` is run BEFORE that PATH exists.
const REAL_GIT = JSON.stringify(
  execSync('command -v git', { encoding: 'utf8', shell: '/bin/sh' }).trim());

const PROTECTED_REF =
  'refs/heads/main abc123 refs/heads/main 0000000000000000000000000000000000000000';

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Two incompatible `script(1)` command forms. BSD/macOS takes the typescript file
// first and the command as trailing argv; util-linux (CI runs ubuntu-latest) takes
// the command via -c and the file last. Neither errors usefully on the other's
// syntax, so the form is chosen by probing rather than by platform sniffing.
const PTY_FORMS = [
  (inner) => `script -q /dev/null bash -c ${shq(inner)}`,
  (inner) => `script -qec ${shq(inner)} /dev/null`,
];

// The child must still be blocked on its read when the input arrives, and `script`
// closes the pty as soon as its stdin reaches EOF. The trailing sleep holds the
// master side open long enough for the answer to be consumed.
const PTY_HOLD_SECONDS = 2;

function tryPty(form, inner, stdinText) {
  const fed = `{ printf '%s\\n' ${shq(stdinText)}; sleep ${PTY_HOLD_SECONDS}; } | ${form(inner)}`;
  try {
    // `script` does not reliably propagate the inner exit status on BSD, so the
    // inner command echoes it and the assertions read EXIT:<n> out of the output.
    return execSync(`${fed} 2>&1`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      .replace(/\r/g, '');
  } catch (err) {
    return ((err.stdout || '') + (err.stderr || '')).replace(/\r/g, '');
  }
}

let ptyFormCache;
function resolvePtyForm() {
  if (ptyFormCache !== undefined) return ptyFormCache;
  ptyFormCache = null;
  for (const form of PTY_FORMS) {
    const probe = tryPty(form, 'if { exec 3</dev/tty; } 2>/dev/null; then echo __PTY_OK__; fi', 'x');
    if (probe.includes('__PTY_OK__')) {
      ptyFormCache = form;
      break;
    }
  }
  return ptyFormCache;
}

// Runs the gate under a real pty with `answer` typed at the confirmation prompt.
// Returns null when no pty facility is available, so the caller can skip rather
// than assert against a run that never reached the terminal branch.
function runGateWithTty(answer) {
  const form = resolvePtyForm();
  if (!form) return null;
  const inner =
    `printf '%s\\n' ${shq(PROTECTED_REF)} | bash ${shq(scriptPath)} origin https://example.invalid/r.git; echo EXIT:$?`;
  return tryPty(form, inner, answer);
}

test('pre-push-gate.sh exists and is executable', () => {
  const stat = statSync(scriptPath);
  assert.ok(stat.isFile(), 'script should be a file');
  assert.ok((stat.mode & 0o100) !== 0, 'script should be executable');
});

test('non-protected branch passes without confirmation', () => {
  const stdinData = 'refs/heads/feat/test abc123 refs/heads/feat/test 0000000000000000000000000000000000000000';
  const output = execSync(
    `echo "${stdinData}" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
    { encoding: 'utf8' }
  );
  assert.ok(output.includes('EXIT:0'), `non-protected branch should pass, got: ${output}`);
});

// ── Null OID width ────────────────────────────────────────────────────────────
// Git writes the null OID at the repository's own hash width. Every fixture above
// is 40 zeros because a SHA-1 repository is the default; a repository created with
// `git init --object-format=sha256` sends 64. The gate compared against a 40-zero
// literal, so a SHA-256 *creation* looked like a real remote OID, the ancestry test
// fell through to a non-existent object, and a brand-new branch was refused as a
// force-push. Measured against a real SHA-256 repository before the fix: the push of
// a first branch printed `Non-fast-forward push detected and blocked`.
const NULL_SHA256 = '0'.repeat(64);
const REAL_SHA256 = 'b3a1'.repeat(16); // 64 hex chars, not all zeros

function runGate(stdinData, env = '') {
  return execSync(
    `echo "${stdinData}" | ${env} bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
    { encoding: 'utf8' }
  );
}

test('SHA-256 repository: creating a branch is a creation, not a force-push', () => {
  const out = runGate(`refs/heads/feat/new ${REAL_SHA256} refs/heads/feat/new ${NULL_SHA256}`);
  assert.ok(out.includes('EXIT:0'), `a 64-zero remote OID is a creation and must pass, got: ${out}`);
  assert.ok(!out.includes('Non-fast-forward'), `and must not be reported as non-fast-forward, got: ${out}`);
});

test('SHA-256 repository: deleting a branch carries the null OID on the local side', () => {
  const out = runGate(`(delete) ${NULL_SHA256} refs/heads/feat/gone ${REAL_SHA256}`);
  assert.ok(out.includes('EXIT:0'), `a 64-zero local OID is a deletion and must pass, got: ${out}`);
});

test('SHA-256 width: a non-null OID that names no object is refused, not read as a creation', () => {
  // The negative control the two cases above need: widening the null test must not widen it into
  // "any 64-character OID is null". What this does NOT show is divergence — neither OID names an
  // object, so `merge-base --is-ancestor` exits **128** (`fatal: Not a valid commit name`), never
  // 1, and the block is the fail-closed path rather than the ancestry verdict. Measured
  // 2026-08-22. The divergence case is the test below, on a real SHA-256 repository.
  const out = runGate(`refs/heads/feat/x ${REAL_SHA256} refs/heads/feat/x ${'c7d2'.repeat(16)}`);
  assert.ok(out.includes('Non-fast-forward push detected and blocked'),
    `an unresolvable remote OID must be blocked, got: ${out}`);
  assert.ok(!out.includes('EXIT:0'), `and must not exit 0, got: ${out}`);
});

// A real SHA-256 repository, so ancestry is *answerable* and the gate is judged on the answer
// rather than on its inability to get one. Skipped where git cannot build one, because a silent
// pass on an unsupported git would restore exactly the blind spot above.
function makeTwoCommitRepoSha256() {
  const dir = mkdtempSync(resolve(tmpdir(), 'pre-push-sha256-'));
  const init = spawnSync('git', ['init', '-q', '--object-format=sha256'], { cwd: dir, stdio: 'pipe' });
  if (init.status !== 0) { rmSync(dir, { recursive: true, force: true }); return null; }
  const commit = (m) => execSync(
    `git -c user.name=t -c user.email=t@t.c -c commit.gpgSign=false commit -q --allow-empty -m ${m}`,
    { cwd: dir, stdio: 'pipe' });
  commit('one');
  const first = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  commit('two');
  const second = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  return { dir, first, second };
}

test('SHA-256 repository: a genuine rewrite is refused on the ancestry answer, not on a read failure', (t) => {
  const repo = makeTwoCommitRepoSha256();
  // `t.skip`, not a bare `return`: a callback that returns normally is recorded as a PASS with
  // zero assertions, which is the silent pass the comment above this fixture warns against — the
  // suite would report coverage of SHA-256 ancestry on a git that cannot build such a repository
  // at all. Skipped is the honest word for "not exercised here".
  if (!repo) { t.skip('git cannot create a SHA-256 repository in this environment'); return; }
  const { dir, first, second } = repo;
  try {
    assert.equal(first.length, 64, 'precondition: the fixture must really be SHA-256');
    // The property the case above could not establish: ancestry is answerable here, and the
    // answer is "no". Exit 1, not 128 — asserted, because if this repository ever stopped
    // resolving, the gate would block for the other reason and the test would not notice.
    const anc = spawnSync('git', ['merge-base', '--is-ancestor', second, first], { cwd: dir, stdio: 'pipe' });
    assert.equal(anc.status, 1, 'precondition: this must be a resolvable, genuine divergence');

    const out = runGate2(dir, `refs/heads/feat/x ${first} refs/heads/feat/x ${second}`);
    assert.ok(out.includes('Non-fast-forward push detected and blocked'),
      `a real rewrite at 64-hex width must be blocked, got: ${out}`);
    assert.ok(!out.includes('EXIT:0'), `and must not exit 0, got: ${out}`);

    // The control that keeps the assertion about the rewrite: the same two commits the other way
    // round is an ordinary fast-forward in the same repository, at the same hash width.
    const ff = runGate2(dir, `refs/heads/feat/x ${second} refs/heads/feat/x ${first}`);
    assert.ok(ff.includes('EXIT:0'), `a fast-forward at 64-hex width must pass, got: ${ff}`);
    assert.ok(!ff.includes('Non-fast-forward'), `and must not be reported as a rewrite, got: ${ff}`);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('bypass allows protected branch push', () => {
  const stdinData = 'refs/heads/main abc123 refs/heads/main 0000000000000000000000000000000000000000';
  const output = execSync(
    `echo "${stdinData}" | ALLOW_PUSH_PROTECTED=1 bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
    { encoding: 'utf8' }
  );
  assert.ok(output.includes('EXIT:0'), `bypass should allow protected branch push, got: ${output}`);
});

test('protected branch without tty exits non-zero', () => {
  // Routed through the detached helper, not `execSync`. The old form piped stdio and
  // stopped there, so on a host that HAS a controlling terminal the gate opened it and
  // `read` blocked on the developer's keyboard — the suite hung rather than failed.
  const out = runDetached(
    `bash ${shq(scriptPath)} origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`
  );
  assert.ok(!out.includes('EXIT:0'),
    `protected branch push must exit non-zero without "yes" confirmation, got: ${out}`);
  assert.match(out, /pre-push-gate/, `and must say so, got: ${out}`);
});

test('detects all protected branch patterns', () => {
  const protectedBranches = ['main', 'master', 'develop', 'release/v1.0'];
  for (const branch of protectedBranches) {
    const stdinData = `refs/heads/${branch} abc123 refs/heads/${branch} 0000000000000000000000000000000000000000`;
    const output = spawnDetached(
      `bash ${shq(scriptPath)} origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
      { input: `${stdinData}\n` }
    );
    assert.ok(!output.includes('EXIT:0'),
      `${branch} should be detected as protected and exit non-zero, got: ${output}`);
    assert.ok(
      output.includes('protected branch') || output.includes('pre-push-gate'),
      `${branch} should be detected as protected, got: ${output}`
    );
  }
});

test('non-protected branches pass through', () => {
  const safeBranches = ['feat/auth', 'fix/bug-123', 'docs/readme', 'refactor/cleanup'];
  for (const branch of safeBranches) {
    const stdinData = `refs/heads/${branch} abc123 refs/heads/${branch} 0000000000000000000000000000000000000000`;
    const output = execSync(
      `echo "${stdinData}" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
      { encoding: 'utf8' }
    );
    assert.ok(output.includes('EXIT:0'), `${branch} should pass through, got: ${output}`);
  }
});

test('empty stdin (no refs) passes through', () => {
  const output = execSync(
    `echo "" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
    { encoding: 'utf8' }
  );
  assert.ok(output.includes('EXIT:0'), `empty stdin should pass through, got: ${output}`);
});

// Every fixture in this file pins `commit.gpgSign=false` next to the identity it sets, and that is
// not tidiness. A developer with global commit signing on loses the fixture at `gpg failed to sign
// the data` — before the gate under test is ever invoked — so the suite is green on the machine
// that wrote it and red everywhere else, failing in a place that says nothing about what it was
// checking. Pinned per command rather than by isolating `$HOME`: the gate itself normalizes
// `GIT_CONFIG_GLOBAL` away, so a global-config trick would silently not reach the code under test,
// and an isolation that the subject can undo is not isolation.
test('non-fast-forward push detected in real git repo', () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'pre-push-test-'));
  try {
    execSync(
      'git init && git -c user.name=test -c user.email=test@test.com -c commit.gpgSign=false commit --allow-empty -m "init"',
      { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' }
    );
    const sha1 = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();

    execSync(
      'git -c user.name=test -c user.email=test@test.com -c commit.gpgSign=false commit --allow-empty -m "second"',
      { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' }
    );
    const sha2 = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();

    // Simulate force push: remote has sha2 but pushing sha1 (sha2 is NOT ancestor of sha1)
    const stdinData = `refs/heads/feat/test ${sha1} refs/heads/feat/test ${sha2}`;
    try {
      execSync(
        `echo "${stdinData}" | bash "${scriptPath}" origin https://github.com/test/repo 2>&1`,
        { encoding: 'utf8', cwd: tmpDir, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      assert.fail('non-fast-forward push should be blocked');
    } catch (err) {
      const output = (err.stdout || '') + (err.stderr || '');
      assert.ok(
        output.includes('Non-fast-forward') || output.includes('non-fast-forward'),
        `should detect non-fast-forward push, got: ${output}`
      );
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Regression: the no-terminal diagnostic used to claim the user aborted ──────
// `[ ! -c /dev/tty ]` passes wherever the device node exists, including contexts
// where opening it fails. Control then fell through to the read, CONFIRM stayed
// empty, and the gate reported "Push aborted by user." with nobody having aborted.

// Piping stdio does NOT remove a controlling terminal: a child launched from an
// interactive shell with pipes on fds 0-2 can still open /dev/tty and would reach the
// prompt. `detached` calls setsid(2), so the child leads a new session with no
// controlling terminal — that is the state this test is about, and the precondition
// below proves the harness actually produced it rather than assuming it did.
// Defined below, beside `runGate2`, which shares it — so the discriminator test that
// follows proves the no-terminal property of the harness *both* helpers use, rather
// than of one of two look-alike spawn topologies.
function runDetached(command) {
  return spawnDetached(command);
}

test('the no-terminal harness when probed → detached really has no controlling terminal', () => {
  // Discriminator, both directions: the same probe under a pty must report HAS_TTY,
  // or the test below would be green against a precondition it never established.
  const detached = runDetached('{ exec 3</dev/tty; } 2>/dev/null && echo HAS_TTY || echo NO_TTY');
  assert.match(detached, /NO_TTY/, `detached child must have no controlling terminal, got: ${detached}`);

  // The cwd-carrying form is what runGate2 passes; probe it too, so a future edit that
  // re-forks the two helpers fails here instead of silently reintroducing a harness
  // that cannot see the case it claims to test.
  const inDir = spawnDetached(TTY_PROBE, { cwd: tmpdir(), input: '\n' });
  assert.match(inDir, /NO_TTY/, `the cwd-carrying detached form must also be session-less, got: ${inDir}`);

  // ── The half that makes the two above mean something ──────────────────────
  // NO_TTY from a session-less runner is not evidence: CI has no controlling terminal
  // to begin with, so deleting `detached: true` leaves both assertions green while the
  // helper silently stops removing anything — and the gate tests start blocking on a
  // developer's own terminal, where nobody runs the suite. The control has to put the
  // helper somewhere a terminal genuinely exists, which is why it runs INSIDE the pty
  // rather than beside it, and why the helper lives in a module a second node can load.
  const form = resolvePtyForm();
  if (!form) return; // no pty facility on this host; the negative half stands alone
  const inner =
    `node -e ${shq(
      `const h=require(${JSON.stringify(HELPER)});` +
      `process.stdout.write('DETACHED:'+h.spawnDetached(h.TTY_PROBE,{input:''}).trim()+'\\n');` +
      `process.stdout.write('ATTACHED:'+h.spawnAttached(h.TTY_PROBE,{input:''}).trim()+'\\n');`
    )}`;
  const pty = tryPty(form, inner, '');
  // Positive control first: if the attached form cannot see a terminal either, the pty
  // was not real and the negative result below would be an artifact of the harness.
  assert.match(pty, /ATTACHED:HAS_TTY/,
    `the same spawn topology WITHOUT detached must find the pty's terminal, got: ${pty}`);
  assert.match(pty, /DETACHED:NO_TTY/,
    `and detached must remove it — this is the assertion that fails if \`detached: true\` is deleted, got: ${pty}`);
});

test('no terminal → names the environment as the cause, never claims the user aborted', () => {
  const output = runDetached(
    `bash "${scriptPath}" origin https://example.invalid/r.git 2>&1; echo "EXIT:$?"`
  );

  assert.match(output, /Cannot open \/dev\/tty/, `should name the real cause, got: ${output}`);
  assert.doesNotMatch(
    output,
    /aborted by user/i,
    `no-terminal path must not report a user abort, got: ${output}`
  );
  assert.match(output, /EXIT:1/, `must stay fail-closed, got: ${output}`);
});

test('terminal present and answer is yes → push allowed with exit 0', (t) => {
  const output = runGateWithTty('yes');
  if (output === null) {
    t.skip('no script(1) pty facility available on this host');
    return;
  }
  assert.match(output, /Type 'yes' to confirm/, `should reach the prompt, got: ${output}`);
  assert.match(output, /EXIT:0/, `"yes" must allow the push, got: ${output}`);
  assert.doesNotMatch(
    output,
    /Cannot open \/dev\/tty/,
    `terminal was available, so the no-terminal branch must not fire, got: ${output}`
  );
});

test('terminal present and answer is not yes → reports a user abort, exits non-zero', (t) => {
  const output = runGateWithTty('no');
  if (output === null) {
    t.skip('no script(1) pty facility available on this host');
    return;
  }
  assert.match(output, /Push aborted by user\./, `should report the user abort, got: ${output}`);
  assert.doesNotMatch(
    output,
    /Cannot open \/dev\/tty/,
    `a declined confirmation is not a missing terminal, got: ${output}`
  );
  assert.match(output, /EXIT:1/, `declining must block the push, got: ${output}`);
});

test('terminal availability is decided by opening the device, not by testing the node', () => {
  const source = readFileSync(scriptPath, 'utf8');
  const executable = source
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  assert.match(
    executable,
    /exec 3<\/dev\/tty/,
    'the gate must probe the terminal by opening a descriptor'
  );
  assert.doesNotMatch(
    executable,
    /\[\s*!?\s*-c\s+\/dev\/tty\s*\]/,
    'the device-node test is the defect this guard exists to prevent'
  );
  // Negative control: the comment above the probe cites `[ -c /dev/tty ]` to explain
  // why it was wrong. Matching against raw source instead of the stripped copy would
  // fail on that explanation, so the guard would forbid documenting its own reason.
  assert.match(
    source,
    /\[\s*-c\s+\/dev\/tty\s*\]/,
    'the rationale comment naming the old pattern should survive the guard'
  );
});

test('ALLOW_FORCE_WITH_LEASE bypasses non-fast-forward check', () => {
  const tmpDir = mkdtempSync(resolve(tmpdir(), 'pre-push-test-'));
  try {
    execSync(
      'git init && git -c user.name=test -c user.email=test@test.com -c commit.gpgSign=false commit --allow-empty -m "init"',
      { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' }
    );
    const sha1 = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();

    execSync(
      'git -c user.name=test -c user.email=test@test.com -c commit.gpgSign=false commit --allow-empty -m "second"',
      { cwd: tmpDir, encoding: 'utf8', stdio: 'pipe' }
    );
    const sha2 = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf8' }).trim();

    // ALLOW_FORCE_WITH_LEASE clears the non-fast-forward refusal — and only that.
    // The shared-branch attestation is a second, separate question, so the push does
    // not pass on the lease variable alone.
    const stdinData = `refs/heads/feat/test ${sha1} refs/heads/feat/test ${sha2}`;
    // This one BLOCKS on a host with a terminal, and it did not before the attestation
    // landed: `ALLOW_FORCE_WITH_LEASE=1` on an unprotected branch used to exit 0 without
    // touching /dev/tty. The new gate asks — so the detached form is now required here too.
    const leaseOnly = spawnDetached(
      `ALLOW_FORCE_WITH_LEASE=1 bash ${shq(scriptPath)} origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
      { cwd: tmpDir, input: `${stdinData}\n` }
    );
    assert.ok(!leaseOnly.includes('Non-fast-forward push detected and blocked'),
      `the lease variable must clear the non-ff refusal, got: ${leaseOnly}`);
    assert.ok(!leaseOnly.includes('EXIT:0'),
      `but it must not by itself pass a force push to a non-protected branch, got: ${leaseOnly}`);

    const attested = spawnDetached(
      `ALLOW_FORCE_WITH_LEASE=1 ALLOW_FORCE_UNSHARED=1 bash ${shq(scriptPath)} origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
      { cwd: tmpDir, input: `${stdinData}\n` }
    );
    assert.ok(attested.includes('EXIT:0'),
      `lease + unshared attestation should allow the non-ff push, got: ${attested}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── The cross-product the two axes hide ───────────────────────────────────────
// Non-fast-forward and protected-branch are checked in sequence, not as one
// classification, so their combination is a distinct path: the lease variable
// skips the refusal and the push then reaches the protected gate. Tests that
// exercise each axis alone all stay green while that path is broken — an early
// `exit 0` after a permitted non-fast-forward would silently drop the terminal
// confirmation for a force-update of a protected branch, which is the most
// destructive push this repository has a gate for.

function makeTwoCommitRepo() {
  const dir = mkdtempSync(resolve(tmpdir(), 'pre-push-xprod-'));
  execSync('git init -q && git -c user.name=t -c user.email=t@t.c -c commit.gpgSign=false commit -q --allow-empty -m one', {
    cwd: dir, stdio: 'pipe',
  });
  const first = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  execSync('git -c user.name=t -c user.email=t@t.c -c commit.gpgSign=false commit -q --allow-empty -m two', {
    cwd: dir, stdio: 'pipe',
  });
  const second = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  // Remote is at `second`, we push `first`: `second` is not an ancestor of `first`.
  // `ffRef` is the same two commits the other way round — remote at `first`, pushing `second` —
  // which IS a fast-forward. It exists so the rewrite-only wording has a control that differs in
  // exactly one property: same repo, same branch, same protection, no rewrite.
  return {
    dir,
    ref: (branch) => `refs/heads/${branch} ${first} refs/heads/${branch} ${second}`,
    ffRef: (branch) => `refs/heads/${branch} ${second} refs/heads/${branch} ${first}`,
  };
}

test('protected + non-fast-forward + lease → still reaches the terminal gate, never a silent pass', () => {
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const r = spawnSync('bash', ['-c', `bash "${scriptPath}" origin https://example.invalid/r.git; echo "EXIT:$?"`], {
      cwd: dir,
      encoding: 'utf8',
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      input: `${ref('main')}\n`,
      env: { ...process.env, ALLOW_FORCE_WITH_LEASE: '1', ALLOW_PUSH_PROTECTED: '' },
    });
    const out = (r.stdout || '') + (r.stderr || '');

    assert.match(out, /Pushing to protected branch\(es\): main/, `must reach the protected gate, got: ${out}`);
    assert.match(out, /Cannot open \/dev\/tty/, `must attempt the terminal confirmation, got: ${out}`);
    assert.match(out, /EXIT:1/, `must fail closed without a terminal, got: ${out}`);
    // The regression this test exists for reads as a pass on every other assertion:
    // a permitted non-fast-forward that returns before the protected check exits 0
    // with no protected-branch output at all.
    assert.doesNotMatch(out, /EXIT:0/, `a permitted non-fast-forward must not skip the gate, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('protected + non-fast-forward + lease under a terminal → the prompt appears and "yes" allows it', (t) => {
  const form = resolvePtyForm();
  if (!form) {
    t.skip('no script(1) pty facility available on this host');
    return;
  }
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const inner =
      `cd ${shq(dir)} && printf '%s\\n' ${shq(ref('main'))} | ALLOW_FORCE_WITH_LEASE=1 bash ${shq(scriptPath)} origin https://example.invalid/r.git; echo EXIT:$?`;
    const out = tryPty(form, inner, 'yes');
    assert.match(out, /Type 'yes' to confirm/, `the prompt must appear for this combination, got: ${out}`);
    assert.match(out, /EXIT:0/, `"yes" must allow the force-update, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Negative control for the pair above: the lease variable is what makes the
// combination reachable at all. Without it the same refs are refused earlier, so
// a test that never set it would be asserting the wrong path entirely.
test('protected + non-fast-forward without the lease variable → refused before the gate', () => {
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const r = spawnSync('bash', ['-c', `bash "${scriptPath}" origin https://example.invalid/r.git; echo "EXIT:$?"`], {
      cwd: dir, encoding: 'utf8', detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      input: `${ref('main')}\n`,
      env: { ...process.env, ALLOW_FORCE_WITH_LEASE: '', ALLOW_PUSH_PROTECTED: '' },
    });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.match(out, /Non-fast-forward push detected and blocked/, `must be refused, got: ${out}`);
    assert.doesNotMatch(out, /Pushing to protected branch/, `refusal precedes the protected gate, got: ${out}`);
    assert.match(out, /EXIT:1/, `refusal is fail-closed, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The header comment is the only place the script tells an operator how the hook is
// installed, and it was wrong for as long as it existed: it credited `/install-scripts`,
// which copies the file into `.claude/scripts/` and never wires up a hook. r1 fixed the
// text and nothing read it afterwards — a corrected fact with no control over it drifts
// back the first time someone edits the block.
//
// The assertion is on the *claim*, not on the word: `/install-scripts` legitimately
// appears in the header, in the sentence that disclaims it. A `doesNotMatch(/install-
// scripts/)` would fail on the correct file, which is why the shape is pinned instead.
const headerBlock = () => {
  const lines = readFileSync(scriptPath, 'utf8').split('\n');
  const out = [];
  for (const line of lines.slice(1)) {
    if (!line.startsWith('#')) break;
    if (/^#\s*Bypass env vars:/.test(line)) break;
    out.push(line);
  }
  assert.notEqual(out.length, 0, 'the script must still carry a header comment block');
  return out.join('\n');
};

const INSTALLER_CLAIM = /Installed as the git pre-push hook by `?\/codex-setup`?/;
const DISCLAIMER_CLAIM = /`?\/install-scripts`? only copies/;

test('pre-push-gate.sh header → credits /codex-setup as the installer, not /install-scripts', () => {
  const header = headerBlock();
  assert.match(header, INSTALLER_CLAIM,
    `the header must name /codex-setup as what wires up the hook, got:\n${header}`);
  assert.match(header, DISCLAIMER_CLAIM,
    `the header must still say /install-scripts only copies the file, got:\n${header}`);
});

test('the header guard when the installer credit is swapped back → reports it', () => {
  // Delete-the-control: the pair above must be the document's doing, not the regex's.
  // Two fixtures, one per direction the claim can be broken.
  const header = headerBlock();

  const swapped = header.replace('by /codex-setup', 'by /install-scripts');
  assert.notEqual(swapped, header, 'the swap fixture must actually differ from the header');
  assert.doesNotMatch(swapped, INSTALLER_CLAIM,
    'crediting /install-scripts again must fail the installer assertion');

  // Negative control for the negative control: the word `/install-scripts` on its own is
  // not the defect. A header that keeps the correct credit and merely mentions the other
  // command must stay green, or this guard bans a sentence the fix depends on.
  const mentions = `${header}\n# See also: /install-scripts for copying helper scripts.`;
  assert.match(mentions, INSTALLER_CLAIM,
    'an extra mention of /install-scripts must not break a correctly credited header');
  assert.match(mentions, DISCLAIMER_CLAIM,
    'the disclaimer must survive an unrelated added line');
});

// ── What git hands the hook, and what it withholds ────────────────────────────
// Every other test in this file feeds the gate its stdin directly, which silently
// assumes git would have supplied that ref line. For one shape it does not: git
// decides a ref is non-fast-forward *before* running the hook and omits already
// rejected refs from the hook's stdin entirely. So the gate's `exit 1` is not what
// stops a flagless push of a diverged branch — git's own rejection is — and the two
// refusals must not be credited to the same mechanism (`skills/push-ci/SKILL.md`
// § Defense in Depth, the non-fast-forward reachability table).
function divergedRepoWithGate() {
  const root = mkdtempSync(resolve(tmpdir(), 'pre-push-ff-'));
  const work = resolve(root, 'work');
  const git = (args, opts = {}) =>
    spawnSync('git', args, { encoding: 'utf8', cwd: work, ...opts });
  spawnSync('git', ['init', '-q', '--bare', resolve(root, 'origin.git')], { encoding: 'utf8' });
  spawnSync('git', ['init', '-q', work], { encoding: 'utf8' });
  git(['config', 'user.email', 'gate@example.invalid']);
  git(['config', 'commit.gpgSign', 'false']);
  git(['config', 'user.name', 'Gate Test']);
  git(['checkout', '-q', '-b', 'feat/diverged']);
  git(['commit', '-q', '--allow-empty', '-m', 'base']);
  git(['commit', '-q', '--allow-empty', '-m', 'second']);
  git(['remote', 'add', 'origin', resolve(root, 'origin.git')]);
  git(['push', '-q', 'origin', 'feat/diverged']);
  // The hook echoes how many ref lines it received, then runs the real gate, so one
  // run answers both "did git supply the ref" and "what did the gate then do".
  const hook = resolve(work, '.git', 'hooks', 'pre-push');
  const body = readFileSync(scriptPath, 'utf8').split('\n').slice(1).join('\n');
  require('node:fs').writeFileSync(hook,
    `#!/usr/bin/env bash\nREFS=$(cat); echo "REFLINES:$(printf '%s' "$REFS" | grep -c . )" >&2\n`
    + `printf '%s\\n' "$REFS" | { ${'\n'}${body}\n}\n`, { mode: 0o755 });
  // Rewrite the tip that was already pushed — now the remote tip is not an ancestor.
  git(['commit', '-q', '--amend', '--allow-empty', '-m', 'rewritten']);
  const ancestry = git(['merge-base', '--is-ancestor', 'origin/feat/diverged', 'HEAD']).status;
  assert.notEqual(ancestry, 0,
    'fixture: the branch must really have diverged, or neither direction below tests anything');
  return { root, git };
}

test('git withholds an already-rejected ref → the flagless refusal is gits, the forced one is the gates', () => {
  const { root, git } = divergedRepoWithGate();
  try {
    // Direction 1 — no force flag. git rejects the ref itself and the hook is handed nothing.
    const flagless = git(['push', 'origin', 'feat/diverged'],
      { env: { ...process.env, ALLOW_PUSH_PROTECTED: '', ALLOW_FORCE_WITH_LEASE: '' } });
    const flaglessOut = (flagless.stdout || '') + (flagless.stderr || '');
    assert.match(flaglessOut, /REFLINES:0/,
      'git must hand the hook zero ref lines for a ref it has already rejected');
    assert.doesNotMatch(flaglessOut, /Non-fast-forward push detected/,
      'the gate cannot have refused a branch it was never told about');
    assert.match(flaglessOut, /\[rejected\][\s\S]*non-fast-forward/,
      'what stops this push is gits own client-side rejection');
    assert.notEqual(flagless.status, 0, 'and the push must still fail');

    // Direction 2 — same repository, same divergence, force flag added. Now the hook
    // receives the ref and its own refusal is what fires. Without this direction the
    // assertions above would also pass against a gate that never refuses anything.
    const forced = git(['push', '--force-with-lease', 'origin', 'feat/diverged'],
      { env: { ...process.env, ALLOW_PUSH_PROTECTED: '', ALLOW_FORCE_WITH_LEASE: '' } });
    const forcedOut = (forced.stdout || '') + (forced.stderr || '');
    assert.match(forcedOut, /REFLINES:1/,
      'a force-flagged push is not pre-rejected, so git does hand the hook the ref');
    assert.match(forcedOut, /Non-fast-forward push detected and blocked/,
      'and there the gate is the mechanism that refuses');
    assert.notEqual(forced.status, 0, 'the gate refusal must fail the push');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Shared-branch attestation for force-form pushes ───────────────────────────
// `rules/git-workflow.md` prohibits force-pushing a shared branch, but only the
// protected names are decidable from a ref line — a two-person `feat/*` head is
// shared and nothing in git says so. The gate therefore asks the operator, at the
// terminal, about the branch named back to them. These cases pin both directions:
// the attestation must actually refuse, and it must leave ordinary pushes alone.

// Runs the gate inside `dir` under a real pty with `answer` typed at the prompt.
// Null when no pty facility exists, so callers skip rather than assert on a run
// that never reached the terminal branch.
function runGateInDirWithTty(dir, refLine, answer, env = '') {
  const form = resolvePtyForm();
  if (!form) return null;
  const inner =
    `cd ${shq(dir)} && printf '%s\\n' ${shq(refLine)} | ${env} bash ${shq(scriptPath)} `
    + 'origin https://example.invalid/r.git; echo EXIT:$?';
  return tryPty(form, inner, answer);
}

test('force push to a non-protected branch without a terminal → refused, and says an attestation is owed', () => {
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGate2(dir, ref('feat/shared-maybe'), 'ALLOW_FORCE_WITH_LEASE=1');
    assert.match(out, /Force-form push rewriting ref\(s\): feat\/shared-maybe/,
      `the refusal must name the ref it is about, got: ${out}`);
    assert.match(out, /ALLOW_FORCE_UNSHARED=1/,
      `and must name the non-interactive attestation, got: ${out}`);
    // Naming the variable is not the same as printing a command that works. This gate is the
    // SECOND of two: reaching this message means ALLOW_FORCE_WITH_LEASE=1 was set on the
    // invocation that printed it, but the operator copies the line into a NEW command where it
    // is gone, and the earlier non-fast-forward refusal fires instead. So the hint is checked by
    // RUNNING it, not by reading it — a recovery instruction that does not recover is the whole
    // defect, and a regex for one variable name is exactly what missed it.
    const hint = (out.match(/To attest non-interactively: (.+?) git push/) || [])[1];
    assert.ok(hint, `the refusal must print a runnable non-interactive form, got: ${out}`);
    const replay = runGate2(dir, ref('feat/shared-maybe'), hint);
    assert.ok(replay.includes('EXIT:0'),
      `the printed form must actually get the push through when used as printed; `
      + `hint was "${hint}", replay: ${replay}`);
    assert.ok(!out.includes('EXIT:0'), `and must not pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('force push refusal names the environment, never a user abort', () => {
  // The same regression the protected gate carries: an unopenable /dev/tty must not
  // be reported as somebody declining. Nobody declined — there was no one to ask.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGate2(dir, ref('feat/x'), 'ALLOW_FORCE_WITH_LEASE=1');
    assert.match(out, /Cannot open \/dev\/tty/, `must name the environment, got: ${out}`);
    assert.ok(!/aborted/i.test(out), `and must not claim an abort, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ALLOW_PUSH_PROTECTED does not skip the unshared attestation', () => {
  // The two bypasses answer different questions. Skipping the protected prompt must
  // not also skip this one, or a single developer-set variable would clear both.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGate2(dir, ref('feat/y'), 'ALLOW_FORCE_WITH_LEASE=1 ALLOW_PUSH_PROTECTED=1');
    assert.match(out, /Force-form push rewriting ref\(s\): feat\/y/,
      `the protected bypass must not reach past this gate, got: ${out}`);
    assert.ok(!out.includes('EXIT:0'), `and must not pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('terminal present, protected REWRITE → the one prompt asks both questions', (t) => {
  // Round 40. "Asked once" was pinned; "asked BOTH things once" was not. The attestation loop
  // excludes a protected rewrite on the grounds that this prompt will ask about it — sound only
  // if this prompt actually puts the OTHER question. Until this assertion existed it read
  // `Type 'yes' to confirm push to main:`, byte-identical to a routine fast-forward's, so the
  // operator's `yes` was evidence about the push and about nothing else. A warning above the
  // prompt is read, not answered.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGateInDirWithTty(dir, ref('main'), 'yes', 'ALLOW_FORCE_WITH_LEASE=1');
    if (out === null) return t.skip('no pty facility available');
    assert.match(out, /Type 'yes' to confirm push to main AND attest that nobody else works on main/,
      `the one surviving prompt must carry BOTH credentials, got: ${out}`);
    assert.match(out, /EXIT:0/, `and the combined "yes" must still allow the push, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('terminal present, protected FAST-FORWARD → the plain push question, no attestation', (t) => {
  // The negative control for the case above, differing in exactly one property: same repo, same
  // branch, same protection, no rewrite. Without it, a gate that appended the attestation wording
  // to every protected prompt would pass that test while asking the routine push to main about
  // sharedness it does not rewrite — which trains the operator to type `yes` straight through the
  // words that were supposed to stop them.
  const { dir, ffRef } = makeTwoCommitRepo();
  try {
    const out = runGateInDirWithTty(dir, ffRef('main'), 'yes', '');
    if (out === null) return t.skip('no pty facility available');
    assert.match(out, /Type 'yes' to confirm push to main: /,
      `a non-rewriting protected push keeps the plain question, got: ${out}`);
    assert.ok(!/AND attest that nobody else works on/.test(out),
      `and must not be asked to attest about a ref it does not rewrite, got: ${out}`);
    assert.ok(!out.includes('REWRITES history'),
      `nor warned about a rewrite that is not happening, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an ordinary fast-forward push to a non-protected branch is untouched by the attestation', () => {
  // The negative control the cases above need: without it, a gate that refused *every* push would
  // pass them all. It must therefore be a real fast-forward — a null remote OID is a ref
  // *creation*, which is a different case and one already covered above, so a gate that attested
  // on every genuine fast-forward would have slipped straight through this control.
  const { dir, ffRef } = makeTwoCommitRepo();
  try {
    const out = runGate2(dir, ffRef('feat/ff'));
    assert.ok(out.includes('EXIT:0'), `a fast-forward must still pass, got: ${out}`);
    assert.ok(!out.includes('Force-form push'), `and must not be asked to attest, got: ${out}`);
    assert.ok(!out.includes('Non-fast-forward'), `and must not be read as a rewrite, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a protected force target is asked once, by the protected gate, not twice', () => {
  // The attestation is scoped to non-protected targets precisely so a force push to
  // main does not produce two prompts about one push. main already reaches /dev/tty.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGate2(dir, ref('main'), 'ALLOW_FORCE_WITH_LEASE=1');
    assert.match(out, /Pushing to protected branch\(es\): main/,
      `a protected force target belongs to the protected gate, got: ${out}`);
    assert.ok(!out.includes('Force-form push rewriting'),
      `and must not also be asked the unshared question, got: ${out}`);
    // The prompt itself needs a terminal, so its wording is pinned in the pty tests below. What
    // IS reachable here is the terminal-less recovery hint, and it had the same defect: naming
    // only ALLOW_PUSH_PROTECTED=1 sends a rewriting push to the attestation prompt, which needs
    // the terminal this branch just failed to open.
    assert.match(out, /ALLOW_PUSH_PROTECTED=1 ALLOW_FORCE_UNSHARED=1/,
      `a terminal-less protected REWRITE must name both credentials, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('terminal present and the attestation is yes → the force push is allowed', (t) => {
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGateInDirWithTty(dir, ref('feat/mine'), 'yes', 'ALLOW_FORCE_WITH_LEASE=1');
    if (out === null) return t.skip('no pty facility available');
    assert.match(out, /Type 'yes' if nobody else works on feat\/mine/,
      `the prompt must appear and name the branch, got: ${out}`);
    assert.match(out, /EXIT:0/, `and "yes" must allow the push, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('terminal present and the attestation is not yes → refused as unattested, not as a protected abort', (t) => {
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGateInDirWithTty(dir, ref('feat/ours'), 'no', 'ALLOW_FORCE_WITH_LEASE=1');
    if (out === null) return t.skip('no pty facility available');
    assert.match(out, /ref not attested as unshared/,
      `the refusal must say which question was answered, got: ${out}`);
    assert.ok(!/EXIT:0/.test(out), `and must not pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Runs the gate inside `dir` with **no controlling terminal**, which is what the
// "without a terminal" cases above assert against.
//
// The earlier version of this helper piped stdio and stopped there. That is not the
// same thing: `/dev/tty` is the controlling terminal of the *session*, reached
// independently of fds 0-2, so a child with all three piped still opens it whenever
// its parent has one. Those tests passed only where the runner happened to be
// session-less (CI, a background job) and would block on a developer's own terminal
// waiting for a human — green in every place nobody looks, hanging in the one place
// somebody does. `detached: true` calls setsid(2), which is what actually removes it;
// the discriminator test above proves the primitive both ways.
function runGate2(dir, refLine, env = '') {
  return spawnDetached(
    `${env} bash ${shq(scriptPath)} origin https://github.com/test/repo 2>&1; echo "EXIT:$?"`,
    { cwd: dir, input: `${refLine}\n` }
  );
}


// ── The cross-products the first version of this gate did not cover ──────────
// Each of the three below was a hole found by review, not a case imagined here. The
// pattern they share: every one is a *combination* of inputs each of which is handled
// correctly on its own, which is why per-input tests all stayed green over them.

test('both bypasses set → a protected force target is still attested, never a silent pass', () => {
  // The hole: the attestation excluded protected targets on the grounds that the
  // protected gate below would ask about them. ALLOW_PUSH_PROTECTED=1 is exactly the
  // input that makes that gate exit 0 without asking, so the two variables composed
  // into a force-push of main past both gates in total silence.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGate2(dir, ref('main'), 'ALLOW_FORCE_WITH_LEASE=1 ALLOW_PUSH_PROTECTED=1');
    assert.match(out, /Force-form push rewriting ref\(s\): main/,
      `with the protected gate bypassed, main must be attested here, got: ${out}`);
    assert.ok(!out.includes('EXIT:0'), `and must not pass unattested, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both bypasses set + the attestation given → the push is allowed', () => {
  // The negative control for the case above: the gate must be closable, not merely
  // closed. Without this, an attestation that refused every protected force push
  // unconditionally would pass the test above and nobody would notice.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGate2(dir, ref('main'),
      'ALLOW_FORCE_WITH_LEASE=1 ALLOW_PUSH_PROTECTED=1 ALLOW_FORCE_UNSHARED=1');
    assert.match(out, /EXIT:0/, `all three attestations given must permit the push, got: ${out}`);
    assert.ok(!out.includes('Force-form push rewriting'),
      `and must not prompt once it is attested, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a force-update bundled with an ordinary creation attests only the rewritten ref', () => {
  // Force detection is push-wide; the question the prompt asks is per-ref. Deriving
  // the prompt list from every ref in the push made it name branches this push only
  // creates — and there is no truthful answer to "does nobody work on X" when X is a
  // shared branch being fast-forwarded and Y is the one actually being rewritten.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const forced = ref('feat/rewrite');
    const created =
      'refs/heads/docs/ordinary abc123 refs/heads/docs/ordinary '
      + '0000000000000000000000000000000000000000';
    const out = runGate2(dir, `${forced}\n${created}`, 'ALLOW_FORCE_WITH_LEASE=1');
    assert.match(out, /Force-form push rewriting ref\(s\): feat\/rewrite/,
      `the rewritten ref must be named, got: ${out}`);
    assert.ok(!/docs\/ordinary/.test(out),
      `a ref this push only creates must not be attested, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a forced non-branch ref is described as a ref, not as a branch', () => {
  // `refs/tags/v1` does not start with refs/heads/, so the prefix strip leaves it
  // whole. Calling it a branch in the prompt is a small lie that costs the operator
  // the one fact they need to answer: what is being rewritten.
  const { dir } = makeTwoCommitRepo();
  try {
    const first = execSync('git rev-parse HEAD~1', { cwd: dir, encoding: 'utf8' }).trim();
    const second = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    const out = runGate2(dir, `refs/tags/v1 ${first} refs/tags/v1 ${second}`,
      'ALLOW_FORCE_WITH_LEASE=1');
    assert.match(out, /Force-form push rewriting ref\(s\): refs\/tags\/v1/,
      `the full ref name must be shown, got: ${out}`);
    assert.ok(!/non-protected branch/.test(out),
      `and it must not be called a branch, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-31 findings ──────────────────────────────────────────────────────────
// Four defects found by review after the attestation gate landed. Three of them are
// cases where a correct-looking rule was applied to a ref class it was never true of.

// Builds a fixture where `second` is a DESCENDANT of `first`, i.e. moving a ref from
// `first` to `second` is a textbook fast-forward. That is the whole point: for a branch
// it must stay one, and for a tag it must not.
function makeForwardRepo() {
  const dir = mkdtempSync(resolve(tmpdir(), 'pre-push-fwd-'));
  // `commit.gpgSign=false` alongside the identity, for the reason stated once at the first
  // fixture in this file: a developer with global signing on loses this fixture to
  // `gpg failed to sign the data` before the gate is ever invoked.
  const g = 'git -c user.name=t -c user.email=t@t.c -c commit.gpgSign=false';
  execSync(`git init -q && ${g} commit -q --allow-empty -m one`, { cwd: dir, stdio: 'pipe' });
  const first = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  execSync(`${g} commit -q --allow-empty -m two`, { cwd: dir, stdio: 'pipe' });
  const second = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
  return { dir, first, second };
}

const NULL_OID = '0'.repeat(40);

test('a tag moved to a descendant is a rewrite, though its ancestry says fast-forward', () => {
  // git refuses ANY update to an existing refs/tags/* ref without --force, forward moves
  // included, because a tag names one commit rather than a line of history. The gate asked
  // the branch question — "is the remote tip an ancestor?" — and a forward tag move answers
  // yes, so it passed in silence while git itself was calling it forced.
  const { dir, first, second } = makeForwardRepo();
  try {
    const out = runGate2(dir, `refs/tags/v1 ${second} refs/tags/v1 ${first}`);
    assert.match(out, /Non-fast-forward push detected and blocked/,
      `a forward tag move must be refused as a force form, got: ${out}`);
    assert.match(out, /refs\/tags\/v1: git requires force semantics for ANY tag update/,
      `and the headline must be qualified, since this tag IS a fast-forward, got: ${out}`);
    assert.ok(!/EXIT:0/.test(out), `and must not pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a BRANCH moved to a descendant stays an ordinary fast-forward', () => {
  // The negative control for the case above, and the one that makes it mean anything: the
  // tag rule must not have been implemented by treating every forward move as forced.
  const { dir, first, second } = makeForwardRepo();
  try {
    const out = runGate2(dir, `refs/heads/feat/x ${second} refs/heads/feat/x ${first}`);
    assert.match(out, /EXIT:0/, `an ordinary fast-forward must still pass, got: ${out}`);
    assert.ok(!/Non-fast-forward/.test(out), `and must not be reported as forced, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CREATING a tag is not a rewrite — there is no history to overwrite', () => {
  // The other direction of the tag rule. Without this, "every refs/tags/* line is forced"
  // would satisfy the first test while refusing every first-ever tag push.
  const { dir, second } = makeForwardRepo();
  try {
    const out = runGate2(dir, `refs/tags/v9 ${second} refs/tags/v9 ${NULL_OID}`);
    assert.match(out, /EXIT:0/, `a brand-new tag must pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a ref listed with an unchanged OID is not an attestation target', () => {
  // Guards the equality test added alongside the tag rule. A tag whose remote and local
  // OIDs are identical rewrites nothing, and asking an operator to vouch for a ref that is
  // not moving is how a prompt gets answered without being read.
  const { dir, second } = makeForwardRepo();
  try {
    const out = runGate2(dir, `refs/tags/v1 ${second} refs/tags/v1 ${second}`);
    assert.match(out, /EXIT:0/, `an unchanged ref must pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── The empty-ref-list case, run against the OLDEST bash on the box ────────────
// Under `set -u`, bash 3.2 — /bin/bash on every macOS — treats "${arr[@]}" on an EMPTY
// array as an unbound variable and aborts, so a push git listed no refs for exited 1
// instead of the documented 0. bash 4.4+ made the expansion legal.
//
// Stated plainly, because it is the kind of thing that reads as more coverage than it is:
// this test DISCRIMINATES only where /bin/bash is older than 4.4. On a Linux CI runner
// /bin/bash is 5.x and the case passes with or without the guard. It is a regression net
// there and a real check on a macOS developer machine — which is where the defect lived
// and where the suite never caught it, because it runs under a Homebrew bash 5.
for (const shell of ['/bin/bash', 'bash']) {
  test(`no refs on stdin → exit 0 under ${shell}`, () => {
    const version = (() => {
      try {
        return execSync(`${shell} -c 'echo \$BASH_VERSION'`, { encoding: 'utf8' }).trim();
      } catch { return 'unknown'; }
    })();
    const r = spawnSync(shell, [scriptPath, 'origin', 'https://example.invalid/r.git'], {
      encoding: 'utf8', input: '', stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.equal(r.status, 0,
      `a push with no refs must be permitted (${shell} ${version}): ${(r.stdout || '') + (r.stderr || '')}`);
  });
}

// ── Startup-file injection ────────────────────────────────────────────────────
// A non-interactive bash sources $BASH_ENV *before* line 1 of the hook and imports
// `BASH_FUNC_name%%` variables as shell functions. Both rewrite what runs below.
function runGateWithEnv(dir, refLine, extraEnv, remote = 'origin') {
  const r = spawnSync('bash', ['-c', `bash ${shq(scriptPath)} ${shq(remote)} https://example.invalid/r.git 2>&1; echo "EXIT:$?"`], {
    cwd: dir, encoding: 'utf8', detached: true, stdio: ['pipe', 'pipe', 'pipe'],
    input: `${refLine}\n`, env: { ...process.env, ...extraEnv },
  });
  return (r.stdout || '') + (r.stderr || '');
}

test('a BASH_ENV that re-sets the cleared attestation cannot reach the gate', () => {
  const { dir, ref } = makeTwoCommitRepo();
  const rc = resolve(dir, 'inject.sh');
  try {
    writeFileSync(rc, 'ALLOW_FORCE_UNSHARED=1\nALLOW_FORCE_WITH_LEASE=1\n');
    const out = runGateWithEnv(dir, ref('feat/rewrite'), { BASH_ENV: rc });
    assert.match(out, /Non-fast-forward push detected and blocked/,
      `the injected variables must not reach the gate, got: ${out}`);
    assert.ok(!/EXIT:0/.test(out), `and the push must not pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a BASH_FUNC_git%% replacing git wholesale cannot make the gate pass', () => {
  // The vector the caller's `env -u BASH_ENV -u ENV` prefix cannot name — you cannot
  // unset a wildcard — and the reason the hook re-execs under `bash -p` rather than
  // leaving the whole problem to its callers.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGateWithEnv(dir, ref('feat/rewrite'), { 'BASH_FUNC_git%%': '() { return 0; }' });
    assert.match(out, /Non-fast-forward push detected and blocked/,
      `a replaced git must not be able to answer the ancestry test, got: ${out}`);
    assert.ok(!/EXIT:0/.test(out), `and the push must not pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an EXPORTED bypass from a startup file still passes — the hook is not that layer', () => {
  // A known residual, pinned deliberately rather than left to be rediscovered as a
  // surprise. `bash -p` stops the startup file from running in the hook's own shell, but
  // the FIRST shell already ran it, and an exported assignment survives the re-exec — as
  // it must, since an exported ALLOW_FORCE_UNSHARED is also the operator's own legitimate
  // channel, and the hook cannot tell the two apart. The layer that closes this is the
  // caller: /push-ci and /epic-merge prefix every push with `env -u BASH_ENV -u ENV`, so
  // the hook's parent shell never has the variable to source from. Test pinned in
  // test/skills/push-ci.test.js; rationale in
  // docs/features/push-gate-optin/4-implementation.md § 4.
  const { dir, ref } = makeTwoCommitRepo();
  const rc = resolve(dir, 'inject.sh');
  try {
    writeFileSync(rc, 'export ALLOW_FORCE_UNSHARED=1\nexport ALLOW_FORCE_WITH_LEASE=1\n');
    const out = runGateWithEnv(dir, ref('feat/rewrite'), { BASH_ENV: rc });
    assert.match(out, /EXIT:0/,
      `this is the documented residual; if it now fails, the hook gained a defense the docs deny it has: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-32 findings ──────────────────────────────────────────────────────────

test('a remote NAMED like the privileged marker cannot skip the re-exec', () => {
  // P0. The first version of the re-exec keyed on argv[1] "because git owns this argv".
  // git does not: argv[1] is the remote NAME, which the caller chooses. `git remote add
  // -- --gate-privileged <url>` made the marker match on the first invocation, the
  // re-exec never ran, and BASH_FUNC_git%% injection stayed live — a forced update
  // landed on a remote whose only unusual property was its name.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGateWithEnv(dir, ref('feat/rewrite'), { 'BASH_FUNC_git%%': '() { return 0; }' },
      '--gate-privileged');
    assert.match(out, /Non-fast-forward push detected and blocked/,
      `a hostile remote name must not disable the privileged re-exec, got: ${out}`);
    assert.ok(!/EXIT:0/.test(out), `and the push must not pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an ordinary remote name still reaches the gate normally', () => {
  // Negative control for the case above: the fix must not have been "refuse every push".
  const { dir, second } = makeForwardRepo();
  try {
    const out = runGateWithEnv(dir, `refs/heads/feat/x ${second} refs/heads/feat/x ${NULL_OID}`, {}, 'origin');
    assert.match(out, /EXIT:0/, `an ordinary creation must still pass, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the remote name reported to the operator is the one git passed', () => {
  // The re-exec must not shift the operator's view of which remote is being pushed to.
  // The argv-marker version consumed argv[1] with a `shift`, and a mutation that dropped
  // the shift left every message reading `Remote: --gate-privileged` with 43/43 green.
  const { dir, ref } = makeTwoCommitRepo();
  try {
    const out = runGateWithEnv(dir, ref('main'), { ALLOW_FORCE_WITH_LEASE: '1' }, 'upstream');
    assert.match(out, /^Remote: upstream$/m,
      `the gate must name the remote git actually passed, got: ${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the re-exec preserves the interpreter git invoked, not whatever PATH leads to', () => {
  // The `"${BASH:-/bin/bash}"` pin shipped untested, and its removal is invisible: a bare
  // `bash` re-execs through PATH into Homebrew 5.x, which ALSO vacates the /bin/bash 3.2
  // case above — one deletion, two guards silently gone. Assert the property directly by
  // asking the second shell which bash it is.
  const versionUnderBinBash = spawnSync('/bin/bash', ['-c',
    `printf '' | /bin/bash ${shq(scriptPath)} origin url >/dev/null 2>&1; echo "STATUS=$?"`
  ], { encoding: 'utf8' });
  assert.match((versionUnderBinBash.stdout || '') + (versionUnderBinBash.stderr || ''), /STATUS=0/,
    'precondition: the empty-ref case passes under /bin/bash');

  // The direct pin: the re-exec names ${BASH}, so the interpreter cannot be swapped by PATH.
  // A property test alone cannot see this on a host whose /bin/bash IS the PATH bash, so the
  // source pin carries it there — stated rather than implied, because a pin on text is the
  // weaker of the two and should not be mistaken for the behavioural one above.
  const src = readFileSync(scriptPath, 'utf8');
  // Round 35: `$-` decided correctly and then acted through `exec`, a shadowable builtin.
  // The marker form ESTABLISHES privileged mode; the `${x:?}` below it is the only abort an
  // imported function cannot answer. The fallback is absolute for the same reason.
  // Round 50: and `exec` itself is gone. It was the one command that established the credential
  // and the one command the environment could stand in front of; the privileged shell is now
  // started as an ordinary command, whose name contains a slash and therefore can be neither a
  // function nor a builtin.
  // Round 52: and `exit $?` is gone too. Removing `exec` left the status delivery one line below
  // it, and `exit` is a builtin by exactly the same argument. The first pass now ends by falling
  // off its branch, which needs no command word at all — so the whole rest of the file has to sit
  // in the OTHER branch, and these three pins are what hold that shape together.
  assert.match(src, /^ {4}\/usr\/bin\/env -u SHELLOPTS -u BASHOPTS -u BASH_ENV -u ENV 'SD0X_PRIV_REEXEC=1'/m,
    're-entry must preserve the invoking interpreter rather than resolving bash through PATH');
  assert.doesNotMatch(src, /\bexec \/usr\/bin\/env/,
    'the privileged re-entry must not go through `exec` — a shadowed `exec` that exits ends the '
    + 'hook successfully before any ref is read, and no code after it can catch that');
  assert.doesNotMatch(src, /^\s*exit \$\?/m,
    'the first pass must not deliver the child status through `exit` — a shadowed `exit` that '
    + 'terminates returns 0 while the child was refusing');
  assert.match(src, /\n {4};;\n {2}\*\)\n/,
    'the launch branch must close and hand over to a second branch — that is what makes the rest '
    + 'of the file unreachable from the first pass without a terminator');
  assert.match(src, /\nexit 0\n {4};;\nesac\n/,
    'and the file must end inside that second branch, so the `case` is what closes it');
});

// Round 52. The shebang is the only statement early enough to matter for one whole channel:
// `$BASH_ENV` is sourced before line 1, and a sourced definition MAY carry a slash in its name
// even though an imported one may not. Measured 2026-08-22 on the `#!/usr/bin/env bash` the file
// shipped with: a BASH_ENV file defining `/usr/bin/env` returned 0 with no output.
test('the shebang → carries privileged mode itself, because BASH_ENV runs before line 1', () => {
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /^#!\/usr\/bin\/env -S bash -p\n/,
    'the gate must request privileged mode in its own shebang; `-S` is what lets a shebang carry '
    + 'a flag at all, and nothing written inside the file runs early enough to disarm BASH_ENV');
});

// Round 35. The pin above is on text; this is the behaviour it stands for, and the two are not
// interchangeable — the block it replaced would satisfy any reasonable text pin and still fall
// through. A `pre-push` hook inherits the environment of whoever ran `git push`, so an exported
// `BASH_FUNC_name%%` is a shell function by the time line 1 runs.
const IMPORTED_EXEC = {
  // Measured 2026-08-21: with this imported, bash reports `exec is a function`, RUNS it, and
  // CONTINUES. A block that decides correctly and then acts through `exec` is a no-op.
  'BASH_FUNC_exec%%': '() { return 0; }',
  // …and once it has fallen through, every ancestry answer below is the pusher's too.
  'BASH_FUNC_git%%': '() { return 0; }',
};
const UNATTESTED_REWRITE =
  'refs/heads/feat/x 1111111111111111111111111111111111111111 '
  + 'refs/heads/feat/x 2222222222222222222222222222222222222222';

function runGateFile(path, extraEnv) {
  return spawnSync('/bin/bash', [path, 'origin', 'https://example.invalid/r.git'], {
    input: `${UNATTESTED_REWRITE}\n`,
    encoding: 'utf8',
    env: { ...process.env, ALLOW_FORCE_WITH_LEASE: '1', ...extraEnv },
  });
}

test('an imported `exec` function → the re-exec fails closed rather than falling through', () => {
  const baseline = runGateFile(scriptPath, {});
  assert.notEqual(baseline.status, 0,
    'precondition: with no terminal, an unattested rewrite is refused — otherwise the case below '
    + `proves nothing; stderr: ${baseline.stderr}`);

  const injected = runGateFile(scriptPath, IMPORTED_EXEC);
  assert.notEqual(injected.status, 0,
    'a shadowed `exec` must reach the `${x:?}` abort, which fails during expansion — before '
    + `command lookup, where nothing can answer it; stderr: ${injected.stderr}`);
});

test('the re-exec block this replaced, under the same environment → the fall-through it was measured to have', () => {
  // The negative control. Splice the round-34 block back in and run it: without this, "refused"
  // above could mean the harness never reproduced the bypass at all.
  // Two edits, not one. Round 52 moved the rest of the file into a second `case` branch, so
  // replacing the block alone leaves its `;;`/`esac` behind and the copy will not even parse —
  // which every assertion below would then read as "refused".
  const shippedSrc = readFileSync(scriptPath, 'utf8');
  const TAIL = '\nexit 0\n    ;;\nesac\n';
  assert.ok(shippedSrc.includes(TAIL), 'precondition: the shipped gate ends inside the second branch');
  const spliced = shippedSrc.slice(0, shippedSrc.indexOf(TAIL)).replace(
    /case "\$#:\$\{SD0X_PRIV_REEXEC:-\}" in[\s\S]*?\nunset SD0X_PRIV_REEXEC\n/,
    'case $- in\n  *p*) ;;\n  *) exec /usr/bin/env -u BASH_ENV -u ENV "${BASH:-bash}" -p "$0" "$@" ;;\nesac\n')
    + '\nexit 0\n';
  assert.ok(!spliced.includes('SD0X_PRIV_REEXEC'),
    'the splice must actually replace the marker block — an unapplied mutation looks exactly like a fix');
  assert.equal(spawnSync('/bin/bash', ['-n'], { input: spliced, encoding: 'utf8' }).status, 0,
    'and the result must parse — an unparseable copy refuses everything for the wrong reason');

  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-prevexec-'));
  try {
    const path = resolve(dir, 'previous-gate.sh');
    writeFileSync(path, spliced);
    chmodSync(path, 0o755);
    assert.notEqual(runGateFile(path, {}).status, 0,
      'precondition: the spliced copy still refuses an honest unattested rewrite, so the only '
      + 'variable below is the imported function');
    assert.equal(runGateFile(path, IMPORTED_EXEC).status, 0,
      'precondition: the previous block fell through and allowed the rewrite — this is the '
      + 'measured P1, so it must reproduce here');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 36. Hardening the re-exec left the line ABOVE it unexamined, which is the same class of
// miss the block itself exists to catch: `set` is a builtin, bash resolves functions before
// builtins, and `set -euo pipefail` ran first.
const IMPORTED_SET = { 'BASH_FUNC_set%%': '() { exit 0; }' };

test('an imported `set` function → strict mode is established after the re-exec, so the gate still runs', () => {
  const baseline = runGateFile(scriptPath, {});
  assert.notEqual(baseline.status, 0,
    'precondition: with no terminal, an unattested rewrite is refused — otherwise the case below '
    + `proves nothing; stderr: ${baseline.stderr}`);

  const injected = runGateFile(scriptPath, IMPORTED_SET);
  assert.notEqual(injected.status, 0,
    'no command may run before the privileged re-exec. A shadowed `set` reached before it ends '
    + `the hook at status 0 without reading one ref; stderr: ${injected.stderr}`);
});

test('strict mode moved back above the re-exec, under the same environment → exits 0 having read nothing', () => {
  // The negative control, and it is the whole evidence that the ordering is what defends the
  // hook: same file, same environment, one line moved.
  const src = readFileSync(scriptPath, 'utf8');
  const STRICT = 'set -euo pipefail\n';
  const ANCHOR = '# ── Re-exec in privileged mode';
  assert.ok(src.indexOf(STRICT) > src.indexOf('unset SD0X_PRIV_REEXEC'),
    'precondition: the shipped file sets strict mode AFTER the re-exec — if this fails the fix '
    + 'was reverted and the mutation below would be a no-op');

  const spliced = src.replace(STRICT, '').replace(ANCHOR, STRICT + ANCHOR);
  assert.ok(spliced.indexOf(STRICT) < spliced.indexOf('case "$#:${SD0X_PRIV_REEXEC:-}" in'),
    'the mutation must actually move the line above the block — an unapplied mutation looks '
    + 'exactly like a fix');

  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-strictorder-'));
  try {
    const path = resolve(dir, 'previous-gate.sh');
    writeFileSync(path, spliced);
    chmodSync(path, 0o755);
    assert.notEqual(runGateFile(path, {}).status, 0,
      'precondition: the spliced copy still refuses an honest unattested rewrite, so the only '
      + 'variable below is the imported function');
    assert.equal(runGateFile(path, IMPORTED_SET).status, 0,
      'precondition: with `set` above the block the hook exited 0 — this is the measured P1, so '
      + 'it must reproduce here');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-37: the env marker is forgeable, so it is not the credential ────────

// `SD0X_PRIV_REEXEC=1` plus `SHELLOPTS=privileged` skips the re-exec and still satisfies the
// `$-` check — measured: bash reads SHELLOPTS AFTER importing the environment, so it imports
// `BASH_FUNC_*` anyway, while `-p` on the command line (what our own exec passes) is read
// before and does not. The pair exited 0 on a rewrite the gate otherwise refuses at 1.
const FORGED_PRIV = { SD0X_PRIV_REEXEC: '1', SHELLOPTS: 'privileged' };

test('a forged privileged marker → the argument count still forces the re-exec, so `set` cannot be shadowed', () => {
  const baseline = runGateFile(scriptPath, {});
  assert.notEqual(baseline.status, 0,
    'precondition: with no terminal, an unattested rewrite is refused — otherwise the case below '
    + `proves nothing; stderr: ${baseline.stderr}`);

  const forged = runGateFile(scriptPath, { ...FORGED_PRIV, ...IMPORTED_SET });
  assert.notEqual(forged.status, 0,
    'a marker the environment can set must not be the credential: git hands the hook exactly two '
    + 'arguments, so the count cannot reach the second pass without our own exec, which strips '
    + `SHELLOPTS and passes -p on the command line; stderr: ${forged.stderr}`);
});

test('the marker-only condition, under the same environment → the bypass it was measured to have', () => {
  // The negative control. Same file, same environment, one condition narrowed back to the marker.
  const src = readFileSync(scriptPath, 'utf8');
  const FROM = 'case "$#:${SD0X_PRIV_REEXEC:-}" in\n  0:*|1:*|2:*|*:)\n';
  const SENTINELS = ' \\\n      --sd0x-privileged --sd0x-privileged --sd0x-privileged';
  assert.ok(src.includes(FROM) && src.includes(SENTINELS),
    'precondition: the shipped file gates on the argument count and appends the sentinels — if '
    + 'this fails the fix was reverted and the mutation below would be a no-op');

  const spliced = src.replace(FROM, 'case "${SD0X_PRIV_REEXEC:-}" in\n  \'\')\n')
    .replace(SENTINELS, '');
  // `!includes(SENTINELS)` and not `!includes('--sd0x-privileged')`: the sentinel name appears
  // elsewhere in the file now — the destination binding excludes it by name so a one-argument
  // invocation cannot report it as the destination — and a bare-substring check would read that
  // unrelated mention as an unapplied mutation. What must be gone is the appended argument list.
  assert.ok(!spliced.includes('"$#:') && !spliced.includes(SENTINELS),
    'the mutation must actually narrow the condition — an unapplied mutation looks exactly like a fix');

  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-argvcred-'));
  try {
    const path = resolve(dir, 'previous-gate.sh');
    writeFileSync(path, spliced);
    chmodSync(path, 0o755);
    assert.notEqual(runGateFile(path, {}).status, 0,
      'precondition: the spliced copy still refuses an honest unattested rewrite, so the only '
      + 'variable below is the forged marker');
    assert.equal(runGateFile(path, { ...FORGED_PRIV, ...IMPORTED_SET }).status, 0,
      'precondition: gating on the marker alone let the forged pair through at status 0 — this is '
      + 'the measured P1, so it must reproduce here');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-33: the residual this hook cannot close, pinned as a PASSING test ────

test('a caller-selected git answers the ancestry question, and the hook cannot tell', () => {
  // This asserts a WEAKNESS, and it passes. Pinning one looks strange until you consider the
  // alternative: undocumented, it is rediscovered as a fresh P1 every few rounds; asserted, a
  // future edit that closes it fails here with a message saying the docs now understate the
  // defence. Same treatment as the exported-BASH_ENV residual above.
  //
  // The real-world vector is `GIT_EXEC_PATH`, not a bare `PATH`: git prepends its exec-path to
  // PATH before running a hook, so a PATH-injected git is shadowed (measured — the hook resolved
  // the real binary and printed its real version). This test invokes the gate DIRECTLY rather
  // than through git, so there is no prepend to shadow it and PATH is the faithful stand-in for
  // what GIT_EXEC_PATH achieves via git. The end-to-end demonstration through a real
  // `git push` is in docs/features/push-gate-optin/4-implementation.md § 4.3.
  const { dir, ref } = makeTwoCommitRepo();
  const binDir = resolve(dir, 'liar');
  try {
    mkdirSync(binDir);
    const liar = resolve(binDir, 'git');
    // Surgical, exactly as the reachable attack must be: lie about one question, delegate the
    // rest. A wholesale replacement breaks the push itself, because git runs pack-objects
    // through the same path — so a fake that answered everything would prove nothing.
    writeFileSync(liar,
      '#!/bin/sh\n'
      + 'if [ "$1" = "merge-base" ] && [ "$2" = "--is-ancestor" ]; then exit 0; fi\n'
      + 'exec ' + REAL_GIT + ' "$@"\n');
    chmodSync(liar, 0o755);

    // Control first, and it is the half that makes the assertion below mean anything: the same
    // ref line, the same command, the real git — the gate must SEE the rewrite.
    const control = runGateWithEnv(dir, ref('feat/rewrite'), { ALLOW_FORCE_WITH_LEASE: '1' });
    assert.match(control, /Force-form push rewriting ref\(s\): feat\/rewrite/,
      `precondition: with a real git the gate detects the rewrite, got: ${control}`);

    const withLiar = runGateWithEnv(dir, ref('feat/rewrite'), {
      ALLOW_FORCE_WITH_LEASE: '1', PATH: `${binDir}:${process.env.PATH}`,
    });
    assert.doesNotMatch(withLiar, /Force-form push rewriting/,
      `the residual is that a caller-selected git defeats the ancestry test; if this now fails, `
      + `the hook closed it and § 4.3 plus both skills' -u GIT_EXEC_PATH prefixes need updating. `
      + `Got: ${withLiar}`);
    assert.match(withLiar, /EXIT:0/, `and the push passes unremarked, got: ${withLiar}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A push in COMMAND position, recognized by shape rather than by the prefix under test. Three
// openings are accepted and they are a descending ladder of compliance: the canonical absolute
// `env`, a line that kept its `ALLOW_…=` assignments but lost the prefix, and a bare `git push`
// that lost both. The last two are exactly the regressions worth catching, so they must be
// *selected* in order to be *failed*. Everything else in these documents that names git push —
// a mermaid arrow, a `|` table cell, a `#` comment, a `$ ` transcript of an attack example — is
// prose, and prose that fails a safety assertion is a false alarm, not depth.
const isPushCommand = (trimmed) => / git push |^git push /.test(trimmed)
  && /^(?:\/usr\/bin\/env\s|[A-Za-z_][A-Za-z0-9_]*=|git push\s)/.test(trimmed);

test('the push selector recognizes commands and only commands', () => {
  // The negative control this guard would otherwise lack: without it, a selector that matched
  // nothing at all would satisfy every per-hit assertion in the test below and go green.
  const canonical = '/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH ALLOW_PUSH_PROTECTED= '
    + 'git push --force-with-lease origin -- "refs/heads/x:refs/heads/x"';
  assert.ok(isPushCommand(canonical), 'the shipped form must be selected');
  assert.ok(isPushCommand('ALLOW_PUSH_PROTECTED= git push origin main'),
    'a push that lost the prefix must still be SELECTED — that is how it gets failed');
  assert.ok(isPushCommand('git push origin main'),
    'a bare push must still be selected, for the same reason');
  for (const prose of [
    'C->>GH: Execute git push',
    '| `git push --force` | Forbidden | Forbidden |',
    '# the Phase 2 assembly below runs `git push --force-with-lease`',
    '$ git push origin -- "+main"                      # no force flag anywhere on this line',
    'This skill is one of two authorized paths for Claude to execute `git push`.',
  ]) {
    assert.ok(!isPushCommand(prose), `prose must not be selected as a command: ${prose}`);
  }
});

test('the two authorized skills strip the variable this hook cannot', () => {
  // The residual above is closed one layer out. Asserted here, beside the weakness it answers,
  // so the pair reads as one contract rather than as a hole in one file and a prefix in another.
  // Counted, not merely non-empty. A selector that drifts and finds one of four still satisfies
  // `> 0`, and every hit it did find is compliant — so the loop goes green while three unchecked
  // push commands ship. The counts are the two skills' documented shapes: push-ci assembles two
  // (round 72 — `-u` moved out of the push into two `git config` writes that run after it, which
  // made the upstream and no-upstream forms the same command written twice, so force × upstream
  // collapsed from four forms to two), epic-merge issues two (Step 5 and Rollback — NOT
  // byte-identical: round 60 gave Step 5 a valued `--force-with-lease=<ref>:<expect>` and dropped
  // `--force-if-includes` from it, and this comment kept saying otherwise until round 72).
  for (const [skill, expected] of [['skills/push-ci/SKILL.md', 2], ['skills/epic-merge/SKILL.md', 2]]) {
    const text = readFileSync(resolve(repoRoot, skill), 'utf8');
    // Trimmed: push-ci's two assembly forms sit indented inside an `if`, epic-merge's two at
    // column 0. An anchored selector would silently cover one skill and skip the other — and
    // "skipped" reads exactly like "compliant" in a loop that asserts a property of each hit.
    // The selector deliberately does NOT key on the prefix it is about to assert. Round 39
    // renamed the leading word to `/usr/bin/env` and the old `startsWith('env -u')` selector
    // found zero of four — a push that DROPPED the prefix would fail the same way, and both
    // report as "the selector drifted" rather than as the safety regression it is. Recognizing
    // a push by its command shape and checking the prefix separately keeps the two distinct.
    const pushes = text.split('\n').map((l) => l.trim()).filter(isPushCommand);
    assert.equal(pushes.length, expected,
      `${skill} should carry exactly ${expected} push commands; a change in the count means the `
      + `selector drifted or a push was added — check the new one, then update this number`);
    for (const line of pushes) {
      assert.match(line, /^\/usr\/bin\/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH /,
        `${skill} must strip GIT_EXEC_PATH before pushing, behind an absolute /usr/bin/env: ${line}`);
    }
  }
});

// ── round-38: the argv credential, challenged and measured ────────────────────

// Doc review round 38 argued that `$BASH_ENV` — which a non-interactive bash sources BEFORE line 1
// — can run `set -- a b c` and so forge the argument count the credential rests on. The refutation
// this comment used to carry ("bash assigns the script's positional parameters after the startup
// file has been sourced, so the forge is replaced") is **bash 3.2 behaviour, not bash behaviour**:
// measured 2026-08-24 with the marker-carrying probe below, bash 3.2.57 prints `1|2|origin` —
// the startup file RAN (its exported marker survived) and only its forged arguments were papered
// over — while bash 5.3.15 — and every Linux CI runner — prints `1|3|forged1`, the `set --`
// surviving into the script too. The prediction this pin shipped with ("a future bash that
// changed the ordering would make this the first thing to go red") fired on the first CI run
// that executed it under a modern bash. So the pin no longer rests on ordering: what protects
// the hook is its own shebang, `#!/usr/bin/env -S bash -p` — under `-p` the $BASH_ENV file is
// not processed at all (measured `unset|2|origin` on 3.2.57 and 5.3.15 alike), which is the
// defense this test now measures. The dated
// correction to the round-39 F1 record lives in
// `docs/features/push-gate-optin/review-log-push-gate-optin.md`.
test('a BASH_ENV that rewrites the positional parameters → the hook still sees git\'s two arguments', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-argvforge-'));
  try {
    const rc = resolve(dir, 'forge.sh');
    writeFileSync(rc,
      'export SD0X_ARGVFORGE_RAN=1\n'
      + 'set -- forged1 forged2 forged3\nSD0X_PRIV_REEXEC=1\nset -o privileged\nunset BASH_ENV\n');

    // The defense, read directly: a probe that prints what it was given, run the way the hook's
    // shebang runs it — under `-p`, where $BASH_ENV is never processed. The positional parameters
    // alone cannot carry this assertion: on bash 3.2 the script's own arguments overwrite the
    // forge AFTER the startup file has run, so `2|origin` there is compatible with the file
    // having executed. The exported marker is what discriminates — `1|2|origin` means the file
    // ran and was papered over (bash 3.2 without -p), `unset|2|origin` means it never ran, which
    // is the only outcome `-p` permits on either version (measured 2026-08-24 on 3.2.57 and
    // 5.3.15).
    const probe = resolve(dir, 'probe.sh');
    writeFileSync(probe, 'printf "%s|%s|%s" "${SD0X_ARGVFORGE_RAN-unset}" "$#" "$1"\n');
    const seen = spawnSync('/bin/bash', ['-p', probe, 'origin', 'https://example.invalid/r.git'], {
      encoding: 'utf8', env: { ...process.env, BASH_ENV: rc },
    });
    assert.equal(seen.stdout, 'unset|2|origin',
      'under -p the startup file must never run: a leading 1 means $BASH_ENV executed (its '
      + 'exported marker survived even where 3.2 replaced the forged arguments), and a 3 means '
      + `the forged parameters reached the script — either way -p stopped suppressing $BASH_ENV `
      + `and the credential must change; got: ${seen.stdout}`);

    // And the consequence, end to end: the forged marker cannot reach the second pass.
    assert.notEqual(runGateFile(scriptPath, { BASH_ENV: rc }).status, 0,
      'a rewrite with no attestation must still be refused when every environment-side forgery is '
      + 'applied at once');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Graph normalization: the gate's one question, asked against the real graph ──
// The gate asks whether the remote tip is contained in what replaces it. git will answer
// that against a rewritten commit graph if told to, and **three** channels do the telling:
// `GIT_GRAFT_FILE` from the environment, `$GIT_DIR/info/grafts` from the repository at the
// path that variable defaults to, and `refs/replace/*` also from the repository. Each turns
// a rewrite into a fast-forward, so the gate stops asking. Measured 2026-08-21 with the hook
// wired and `main` protected: `ALLOW_PUSH_PROTECTED=1 git push --force origin main` moved the
// remote tip to a commit sharing no history with it, the rewrite gate never asking. That
// variable is part of the measurement — the protected prompt is a separate question and
// refuses first without it; a graft defeats the rewrite question only.

// Forces `remote` to look like an ancestor of `local` via the deprecated grafts file.
function graftFile(dir, child, parent) {
  const path = resolve(dir, 'graft.txt');
  writeFileSync(path, `${child} ${parent}\n`);
  return path;
}

// The same forgery at the path `GIT_GRAFT_FILE` *defaults* to. Nothing in the environment
// names it, which is why `unset GIT_GRAFT_FILE` closes the first channel by opening this one.
function repoGraftFile(dir, child, parent) {
  mkdirSync(resolve(dir, '.git/info'), { recursive: true });
  writeFileSync(resolve(dir, '.git/info/grafts'), `${child} ${parent}\n`);
}

// Ancestry as plain git sees it, outside the gate. Used to prove the poison applied before
// any conclusion is drawn from the gate's behaviour: an inert graft looks exactly like a
// gate that resisted one.
function ancestry(dir, ancestorSha, descendantSha, env = {}) {
  return spawnSync('git', ['merge-base', '--is-ancestor', ancestorSha, descendantSha],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } }).status;
}

test('GIT_GRAFT_FILE forging ancestry → the gate still asks for the attestation', () => {
  const { dir, ref, ffRef } = makeTwoCommitRepo();
  try {
    const [first, second] = ref('x').split(' ').filter((t) => /^[0-9a-f]{40}$/.test(t));
    const graft = graftFile(dir, first, second);

    // Precondition, both directions: honest ancestry says "not contained", the grafted one
    // says "contained". Without this the test below could pass on a graft that did nothing.
    assert.equal(ancestry(dir, second, first), 1,
      'fixture: the pushed tip must really not contain the remote tip');
    assert.equal(ancestry(dir, second, first, { GIT_GRAFT_FILE: graft }), 0,
      'fixture: the graft must actually forge containment, or nothing below is a bypass');

    const out = runGateWithEnv(dir, ref('feat/rewrite'),
      { GIT_GRAFT_FILE: graft, ALLOW_FORCE_WITH_LEASE: '1', ALLOW_FORCE_UNSHARED: '' });
    assert.match(out, /not shared|attestation/i,
      `a grafted rewrite must still reach the unshared attestation, got: ${out}`);
    assert.ok(!/EXIT:0/.test(out), `and must not pass without one, got: ${out}`);

    // Positive control — same variable, same repository, a genuine fast-forward. If this
    // also refused, the assertions above would be satisfied by a gate that blocks everything.
    const ff = runGateWithEnv(dir, ffRef('feat/forward'),
      { GIT_GRAFT_FILE: graft, ALLOW_FORCE_WITH_LEASE: '', ALLOW_FORCE_UNSHARED: '' });
    assert.match(ff, /EXIT:0/, `an honest fast-forward must still pass silently, got: ${ff}`);
    assert.doesNotMatch(ff, /not shared/i, `and must not be asked to attest, got: ${ff}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a refs/replace graft forging ancestry → the gate still asks for the attestation', () => {
  // The same forgery with no environment variable at all: it lives in the repository, so
  // unsetting things cannot reach it. Only `GIT_NO_REPLACE_OBJECTS=1` does.
  const { dir, ref, ffRef } = makeTwoCommitRepo();
  try {
    const [first, second] = ref('x').split(' ').filter((t) => /^[0-9a-f]{40}$/.test(t));
    spawnSync('git', ['replace', '--graft', first, second],
      { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

    assert.equal(ancestry(dir, second, first), 0,
      'fixture: the replacement must actually forge containment for the default reader');
    assert.equal(ancestry(dir, second, first, { GIT_NO_REPLACE_OBJECTS: '1' }), 1,
      'fixture: and ignoring replacements must restore the honest answer');

    const out = runGateWithEnv(dir, ref('feat/rewrite'),
      { ALLOW_FORCE_WITH_LEASE: '1', ALLOW_FORCE_UNSHARED: '' });
    assert.match(out, /not shared|attestation/i,
      `a replacement-forged rewrite must still reach the attestation, got: ${out}`);
    assert.ok(!/EXIT:0/.test(out), `and must not pass without one, got: ${out}`);

    const ff = runGateWithEnv(dir, ffRef('feat/forward'),
      { ALLOW_FORCE_WITH_LEASE: '', ALLOW_FORCE_UNSHARED: '' });
    assert.match(ff, /EXIT:0/, `an honest fast-forward must still pass silently, got: ${ff}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a repository grafts file forging ancestry → the gate still asks for the attestation', () => {
  // The channel `unset GIT_GRAFT_FILE` opens. No environment variable names this file, so a
  // gate that closes the first channel by unsetting is answering against the forged graph.
  const { dir, ref, ffRef } = makeTwoCommitRepo();
  try {
    const [first, second] = ref('x').split(' ').filter((t) => /^[0-9a-f]{40}$/.test(t));
    repoGraftFile(dir, first, second);

    assert.equal(ancestry(dir, second, first, { GIT_GRAFT_FILE: '/dev/null' }), 1,
      'fixture: with the graft file bypassed the honest answer must be "not contained"');
    assert.equal(ancestry(dir, second, first), 0,
      'fixture: and the default reader must actually be fooled by it');

    const out = runGateWithEnv(dir, ref('feat/rewrite'),
      { ALLOW_FORCE_WITH_LEASE: '1', ALLOW_FORCE_UNSHARED: '' });
    assert.match(out, /not shared|attestation/i,
      `a repo-grafted rewrite must still reach the attestation, got: ${out}`);
    assert.ok(!/EXIT:0/.test(out), `and must not pass without one, got: ${out}`);

    const ff = runGateWithEnv(dir, ffRef('feat/forward'),
      { ALLOW_FORCE_WITH_LEASE: '', ALLOW_FORCE_UNSHARED: '' });
    assert.match(ff, /EXIT:0/, `an honest fast-forward must still pass silently, got: ${ff}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the gate normalizing by unset instead of /dev/null → the repository channel reopens', () => {
  // Not a hypothetical mutation: `unset GIT_GRAFT_FILE GIT_REPLACE_REF_BASE` is what this
  // gate shipped with before 2026-08-21, and it is why the round-46 fix was not the fix. The
  // control pins the *instrument*, not just the presence of a line — a future edit that
  // "simplifies" the export back into an unset restores a measured protected-branch bypass.
  const original = readFileSync(scriptPath, 'utf8');
  const OLD = 'export GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1\nunset GIT_REPLACE_REF_BASE\n';
  const NEW = 'unset GIT_GRAFT_FILE GIT_REPLACE_REF_BASE\nexport GIT_NO_REPLACE_OBJECTS=1\n';
  assert.ok(original.includes(OLD), 'the shipped normalization must be the exact block this control mutates');
  const mutated = original.replace(OLD, () => NEW);
  assert.ok(mutated.includes(NEW) && !mutated.includes(OLD),
    'the mutation must actually apply — an unapplied one looks exactly like a resistant gate');

  const { dir, ref } = makeTwoCommitRepo();
  try {
    const [first, second] = ref('x').split(' ').filter((t) => /^[0-9a-f]{40}$/.test(t));
    repoGraftFile(dir, first, second);
    const path = resolve(dir, 'unset-gate.sh');
    writeFileSync(path, mutated, { mode: 0o755 });

    const r = spawnSync('/bin/bash', [path, 'origin', 'https://example.invalid/r.git'], {
      cwd: dir, input: `${ref('feat/rewrite')}\n`, encoding: 'utf8',
      env: { ...process.env, ALLOW_FORCE_WITH_LEASE: '1', ALLOW_FORCE_UNSHARED: '' },
    });
    assert.equal(r.status, 0,
      'unsetting the variable must leave the repository grafts file readable and the rewrite '
      + `unasked — that is the hole /dev/null closes; stdout: ${r.stdout} stderr: ${r.stderr}`);
    assert.doesNotMatch((r.stdout || '') + (r.stderr || ''), /not shared/i,
      'and it must not have asked about sharing at all');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the gate without the graph normalization → the bypass the harness must be able to reproduce', () => {
  // The negative control. Delete the two normalization lines and the same grafted rewrite
  // must sail through — otherwise "refused" above could mean the harness never reproduced
  // the bypass, and the lines could be deleted tomorrow with every test still green.
  const original = readFileSync(scriptPath, 'utf8');
  const stripped = original
    .replace('export GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1\n', () => '')
    .replace('unset GIT_REPLACE_REF_BASE\n', () => '');
  assert.ok(!/^export GIT_GRAFT_FILE=/m.test(stripped) && !/^unset GIT_REPLACE_REF_BASE$/m.test(stripped),
    'the mutation must actually apply — an unapplied strip looks exactly like a resistant gate');
  assert.notEqual(stripped, original, 'and it must change the script');

  const { dir, ref } = makeTwoCommitRepo();
  try {
    const [first, second] = ref('x').split(' ').filter((t) => /^[0-9a-f]{40}$/.test(t));
    const graft = graftFile(dir, first, second);
    const path = resolve(dir, 'unnormalized-gate.sh');
    writeFileSync(path, stripped, { mode: 0o755 });

    const r = spawnSync('/bin/bash', [path, 'origin', 'https://example.invalid/r.git'], {
      cwd: dir, input: `${ref('feat/rewrite')}\n`, encoding: 'utf8',
      env: { ...process.env, GIT_GRAFT_FILE: graft, ALLOW_FORCE_WITH_LEASE: '1', ALLOW_FORCE_UNSHARED: '' },
    });
    assert.equal(r.status, 0,
      'without the normalization the grafted rewrite must pass unasked — that is the defect the '
      + `two lines close; stdout: ${r.stdout} stderr: ${r.stderr}`);
    assert.doesNotMatch((r.stdout || '') + (r.stderr || ''), /not shared/i,
      'and it must not have asked about sharing at all');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── The destination the prompts print ────────────────────────────────────────
// git's pre-push contract passes the destination *location* as $1 whenever the push names no
// remote, so $1 is the URL itself — credentials included. Both prompts print it, and a prompt is
// exactly where a token must not appear (rules/security.md, Anchor Register #2).

const PROMPT_SECRET = 'ghp-SYNTHETIC-NOT-A-REAL-TOKEN-0000';

// Both prompting paths, driven by one repository: a rewrite on an unprotected branch reaches the
// attestation prompt, a fast-forward on `main` reaches the protected one. Neither has a tty here,
// so each prints its header and exits — which is all these cases read.
function promptRuns(dir, ref, ffRef, url) {
  const run = (dest, refLine, env) => spawnSync('/bin/bash', [scriptPath, dest, dest], {
    cwd: dir, input: `${refLine}\n`, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return [
    ['rewrite', run(url, ref('feat/rewrite'),
      { ALLOW_FORCE_WITH_LEASE: '1', ALLOW_PUSH_PROTECTED: '1', ALLOW_FORCE_UNSHARED: '' }),
      (d) => run(d, ref('feat/rewrite'),
        { ALLOW_FORCE_WITH_LEASE: '1', ALLOW_PUSH_PROTECTED: '1', ALLOW_FORCE_UNSHARED: '' })],
    ['protected', run(url, ffRef('main'), { ALLOW_PUSH_PROTECTED: '', ALLOW_FORCE_WITH_LEASE: '' }),
      (d) => run(d, ffRef('main'), { ALLOW_PUSH_PROTECTED: '', ALLOW_FORCE_WITH_LEASE: '' })],
  ];
}

test('a push naming a URL instead of a remote → neither prompt prints the credential', () => {
  const { dir, ref, ffRef } = makeTwoCommitRepo();
  try {
    const url = `https://alice:${PROMPT_SECRET}@example.invalid/repo.git`;
    for (const [label, r, again] of promptRuns(dir, ref, ffRef, url)) {
      const out = (r.stdout || '') + (r.stderr || '');
      assert.match(out, /^Remote: /m, `${label}: the prompt must still name a destination`);
      assert.ok(!out.includes(PROMPT_SECRET),
        `${label}: the prompt must not print the credential — got: ${out}`);
      assert.match(out, /^Remote: https:\/\/<redacted>@example\.invalid\/repo\.git$/m,
        `${label}: and it must still name the repository the push would reach`);

      // Positive control, same run shape. Without it every assertion above is satisfied by a
      // gate that redacts its whole prompt, which would hide a redirect instead of a token.
      const named = again('origin');
      assert.match((named.stdout || '') + (named.stderr || ''), /^Remote: origin$/m,
        `${label}: a remote name carries no credential and must not be rewritten`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a credential outside the userinfo → the gate masks the query and the fragment too', () => {
  // A userinfo-only mask leaves `?access_token=` and a fragment untouched, and splitting on the
  // FIRST `@` leaves the tail of a password containing one. All three measured leaking 2026-08-21.
  const { dir, ref, ffRef } = makeTwoCommitRepo();
  try {
    const cases = [
      [`https://example.invalid/repo.git?access_token=${PROMPT_SECRET}`,
        'https://example.invalid/repo.git?<redacted>'],
      [`https://example.invalid/repo.git#${PROMPT_SECRET}`,
        'https://example.invalid/repo.git#<redacted>'],
      [`https://alice:pw@${PROMPT_SECRET}@example.invalid/repo.git`,
        'https://<redacted>@example.invalid/repo.git'],
    ];
    for (const [url, want] of cases) {
      for (const [label, r] of promptRuns(dir, ref, ffRef, url)) {
        const out = (r.stdout || '') + (r.stderr || '');
        assert.ok(!out.includes(PROMPT_SECRET),
          `${label} ${url}: the prompt must not print the credential — got: ${out}`);
        assert.ok(out.split('\n').includes(`Remote: ${want}`),
          `${label} ${url}: expected "Remote: ${want}" — got: ${out}`);
      }
    }
    // Positive control: an `@` inside a path is not userinfo and must survive whole.
    for (const [url, want] of [['https://example.invalid/repo@v1.git', 'https://example.invalid/repo@v1.git']]) {
      const [, r] = promptRuns(dir, ref, ffRef, url)[0];
      assert.ok(((r.stdout || '') + (r.stderr || '')).split('\n').includes(`Remote: ${want}`),
        `a path ${'@'} is not userinfo and must not be masked: ${url}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scp-like destination carrying a credential-shaped user → the gate masks that user too', () => {
  // The `*://*` arm cannot reach `[user@]host:path` — there is no scheme to match — so until
  // 2026-08-22 every scp-like user printed verbatim, on the reasoning that the user is always
  // `git`. It is not: `<token>@code.example:team/repo.git` is a legal destination whose user field
  // IS the credential, and this prompt is exactly where it must not appear (Anchor Register #2).
  const { dir, ref, ffRef } = makeTwoCommitRepo();
  try {
    const cases = [
      [`${PROMPT_SECRET}@code.example:team/repo.git`, '<redacted>@code.example:team/repo.git'],
      // Split at the LAST `@`, which is where ssh itself splits: `a@b@host` is user `a@b` on host
      // `host`. A first-`@` split would leave the tail of the user field printed. (scp-like syntax
      // has no password field — git reads the first `:` as the host/path separator — so the URL
      // arm's `alice:pw@…` shape has no counterpart here.)
      [`${PROMPT_SECRET}@alice@git.example:org/repo.git`, '<redacted>@git.example:org/repo.git'],
      // `git@` is not a secret, but the mask is unconditional — a rule that guessed which users look
      // like credentials would be wrong the first time somebody used a host it did not anticipate.
      ['git@github.com:org/repo.git', '<redacted>@github.com:org/repo.git'],
    ];
    for (const [url, want] of cases) {
      for (const [label, r] of promptRuns(dir, ref, ffRef, url)) {
        const out = (r.stdout || '') + (r.stderr || '');
        assert.ok(!out.includes(PROMPT_SECRET),
          `${label} ${url}: the prompt must not print the credential — got: ${out}`);
        assert.ok(out.split('\n').includes(`Remote: ${want}`),
          `${label} ${url}: expected "Remote: ${want}" — got: ${out}`);
      }
    }

    // Negative controls. Without these the whole test is satisfied by a gate that masks every
    // destination containing a `:`, which hides a redirect instead of a credential — and the
    // point of redaction is that host and path stay readable.
    for (const [url, why] of [
      ['host.example:org/repo.git', 'a scp-like destination with no user field has nothing to mask'],
      ['/local/pa@th:name', 'a `/` before the `:` means a path, not a host — git reads it that way too'],
      ['C:/win/repo.git', 'a drive letter is not a user field'],
      ['./rel/a@b/c.git', 'no `:` at all — neither arm applies'],
    ]) {
      const [, r] = promptRuns(dir, ref, ffRef, url)[0];
      assert.ok(((r.stdout || '') + (r.stderr || '')).split('\n').includes(`Remote: ${url}`),
        `${why}: ${url} — got: ${(r.stdout || '') + (r.stderr || '')}`);
    }

    // And the host/path half of a MASKED destination must still be readable, or the mask has
    // destroyed the very fact the operator confirms against.
    const [, masked] = promptRuns(dir, ref, ffRef, `${PROMPT_SECRET}@code.example:team/repo.git`)[0];
    const maskedOut = (masked.stdout || '') + (masked.stderr || '');
    assert.match(maskedOut, /^Remote: <redacted>@code\.example:team\/repo\.git$/m,
      'host and path must survive the mask — a redirect to another repository has to stay visible');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the round-46 unset form wired as a real hook → a grafted rewrite moves the protected tip', () => {
  // The end-to-end measurement § 4.3 of docs/features/push-gate-optin/4-implementation.md
  // states. The isolated graph cases above prove the ancestry *reading*; this one proves the
  // consequence the prose claims — a protected `main` overwritten by a commit sharing no history
  // with it — by installing the gate as a real hook and running the exact push, both forms.
  const root = mkdtempSync(resolve(tmpdir(), 'pre-push-e2e-'));
  const work = resolve(root, 'work');
  const bare = resolve(root, 'origin.git');
  const git = (args, opts = {}) => spawnSync('git', args, { encoding: 'utf8', cwd: work, ...opts });
  const remoteTip = () => spawnSync('git', ['-C', bare, 'rev-parse', 'refs/heads/main'],
    { encoding: 'utf8' }).stdout.trim();
  const installGate = (body) => writeFileSync(resolve(work, '.git', 'hooks', 'pre-push'), body, { mode: 0o755 });
  try {
    spawnSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8' });
    spawnSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
    git(['config', 'user.email', 'gate@example.invalid']);
    git(['config', 'commit.gpgSign', 'false']);
    git(['config', 'user.name', 'Gate Test']);
    git(['commit', '-q', '--allow-empty', '-m', 'honest']);
    const honest = git(['rev-parse', 'HEAD']).stdout.trim();
    git(['remote', 'add', 'origin', bare]);
    git(['push', '-q', 'origin', 'main']);
    assert.equal(remoteTip(), honest, 'fixture: the remote must start on the honest commit');

    // An orphan reaches no commit the remote holds, so replacing main with it is a rewrite.
    git(['checkout', '-q', '--orphan', 'rewrite']);
    git(['commit', '-q', '--allow-empty', '-m', 'unrelated']);
    const orphan = git(['rev-parse', 'HEAD']).stdout.trim();
    assert.notEqual(git(['merge-base', '--is-ancestor', honest, orphan]).status, 0,
      'fixture: the two commits must genuinely share no history');
    git(['branch', '-f', 'main', orphan]);
    git(['checkout', '-q', 'main']);
    repoGraftFile(work, orphan, honest);   // the forgery, in the repository

    const shipped = readFileSync(scriptPath, 'utf8');
    const OLD = 'export GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1\nunset GIT_REPLACE_REF_BASE\n';
    const NEW = 'unset GIT_GRAFT_FILE GIT_REPLACE_REF_BASE\nexport GIT_NO_REPLACE_OBJECTS=1\n';
    assert.ok(shipped.includes(OLD), 'the shipped normalization must be the block this measurement mutates');
    const mutant = shipped.replace(OLD, () => NEW);
    assert.ok(mutant.includes(NEW) && !mutant.includes(OLD),
      'the mutation must actually apply — an unapplied one looks exactly like a resistant gate');

    // ALLOW_PUSH_PROTECTED=1 is part of the measurement, not incidental: the protected prompt is
    // a separate question that refuses first without it. A graft defeats the rewrite question only.
    const env = { ...process.env, ALLOW_PUSH_PROTECTED: '1', ALLOW_FORCE_WITH_LEASE: '', ALLOW_FORCE_UNSHARED: '' };
    installGate(mutant);
    const bypassed = git(['push', '--force', 'origin', 'main'], { env });
    assert.equal(bypassed.status, 0,
      `the round-46 form must let the push through: ${bypassed.stdout}${bypassed.stderr}`);
    assert.equal(remoteTip(), orphan,
      'and the protected remote tip must have moved to the commit sharing no history with it');

    // Same repository, same graft, same command — only the normalization differs.
    spawnSync('git', ['-C', bare, 'update-ref', 'refs/heads/main', honest], { encoding: 'utf8' });
    assert.equal(remoteTip(), honest, 'fixture: the remote must be back on the honest commit');
    installGate(shipped);
    const refused = git(['push', '--force', 'origin', 'main'], { env });
    assert.notEqual(refused.status, 0, 'the shipped gate must refuse the same push');
    assert.match((refused.stdout || '') + (refused.stderr || ''), /Non-fast-forward push detected/,
      'and the refusal is the non-fast-forward guard, ALLOW_FORCE_WITH_LEASE being unset — '
      + 'not the attestation prompt, which the isolated cases above exercise on its own');
    assert.equal(remoteTip(), honest, 'the remote tip must not have moved');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Round 50: the shadow that exits, not the one that returns ─────────────────
// Round 35 closed the imported-`exec` channel for a function that RETURNS: control comes back and
// lands on the `${x:?}` fuse. A function that EXITS never comes back, so the fuse is unreachable
// and the hook ends successfully having read nothing. Measured 2026-08-21 on the shipped gate: a
// protected-branch push it refuses with exit 1 was accepted with exit 0 and no output.

const PROTECTED_PUSH =
  'refs/heads/main 1111111111111111111111111111111111111111 '
  + 'refs/heads/main 2222222222222222222222222222222222222222';

function runProtected(extraEnv) {
  return spawnSync('/bin/bash', [scriptPath, 'origin', 'https://example.invalid/r.git'], {
    input: `${PROTECTED_PUSH}\n`,
    encoding: 'utf8',
    // The ref pair rewrites history, and a non-fast-forward push is refused BEFORE any credential
    // is selected — an earlier, orthogonal refusal. Allowing the lease form here is what puts the
    // run on the path this test is about; the two prompts it must reach stay unset.
    env: {
      ...process.env,
      ALLOW_FORCE_WITH_LEASE: '1',
      ALLOW_PUSH_PROTECTED: '',
      ALLOW_FORCE_UNSHARED: '',
      ...extraEnv,
    },
  });
}

test('an imported function over every builtin the re-entry uses → the push is still refused', () => {
  const honest = runProtected({});
  assert.notEqual(honest.status, 0,
    `precondition: with no terminal, a protected push must be refused; stderr: ${honest.stderr}`);

  // Each form on its own, and both together. The `exit 0` row is the one round 35 could not
  // catch; the `return 0` row is the one it could, kept so a fix for one cannot regress the other.
  const shadows = {
    'exec that exits': { 'BASH_FUNC_exec%%': '() { exit 0; }' },
    'exec that returns': { 'BASH_FUNC_exec%%': '() { return 0; }' },
    'exit that does nothing': { 'BASH_FUNC_exit%%': '() { :; }' },
    // Round 52. The row above falls through to the fuse, which is why round 50 read the `exit`
    // channel as covered. This one does not come back — it is the `exec that exits` shape moved
    // one command later, and on the round-50 gate it returned 0 while the child printed its
    // refusal. Enumerating "a shadowed exit" by its harmless form is how that survived a round.
    'exit that terminates': { 'BASH_FUNC_exit%%': '() { builtin exit 0; }' },
    'both exec and exit': { 'BASH_FUNC_exec%%': '() { exit 0; }', 'BASH_FUNC_exit%%': '() { :; }' },
    // `builtin` and `command` are shadowable too, so a fix that routed through either would be
    // answerable in turn. `case` is a reserved word and is not on this list for that reason.
    'builtin, command and [': {
      'BASH_FUNC_builtin%%': '() { return 0; }',
      'BASH_FUNC_command%%': '() { return 0; }',
      'BASH_FUNC_[%%': '() { return 0; }',
    },
  };
  for (const [label, env] of Object.entries(shadows)) {
    const run = runProtected(env);
    assert.notEqual(run.status, 0,
      `${label}: the hook exited successfully without reaching a confirmation; stdout: ${run.stdout}`);
  }

  // Positive control, and it is the one that matters: every assertion above is satisfied by a gate
  // that refuses everything, which is not a gate. The documented bypass must still pass, under the
  // same environment shape.
  const allowed = runProtected({ ALLOW_PUSH_PROTECTED: '1', ALLOW_FORCE_UNSHARED: '1' });
  assert.equal(allowed.status, 0,
    `the documented bypass must still allow the push; stderr: ${allowed.stderr}`);
});

test('the round-35 re-entry, under a shadow that exits → the bypass it could not catch', () => {
  // The negative control for the test above. Splice `exec` back in front of the same command and
  // run it: without this, "refused" proves only that the harness never reproduced the bypass.
  const src = readFileSync(scriptPath, 'utf8');
  const previous = src.replace(
    /^ {4}\/usr\/bin\/env -u SHELLOPTS/m, '    exec /usr/bin/env -u SHELLOPTS');
  assert.notEqual(previous, src, 'the splice must actually re-introduce `exec`');

  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-execexit-'));
  try {
    const path = resolve(dir, 'previous-gate.sh');
    writeFileSync(path, previous, { mode: 0o755 });
    const run = spawnSync('/bin/bash', [path, 'origin', 'https://example.invalid/r.git'], {
      input: `${PROTECTED_PUSH}\n`,
      encoding: 'utf8',
      env: {
        ...process.env,
        ALLOW_FORCE_WITH_LEASE: '1',
        ALLOW_PUSH_PROTECTED: '',
        ALLOW_FORCE_UNSHARED: '',
        'BASH_FUNC_exec%%': '() { exit 0; }',
      },
    });
    assert.equal(run.status, 0,
      'the control must reproduce the bypass — if the previous form also refuses, the test above '
      + 'is measuring something other than the defect it names');
    assert.equal(run.stdout, '', 'and it must do so silently, having read no ref');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Round 52: the terminator, and the line before line 1 ──────────────────────

// Restore the round-50 shape: `exit $?` after the launch, with everything below it at the top
// level rather than inside a second `case` branch. Two edits, and both must apply — an unapplied
// splice reproduces no bypass and reads exactly like a fix.
function withExitTerminator(src) {
  const HANDOVER = '\n    ;;\n  *)\n';
  const TAIL = '\nexit 0\n    ;;\nesac\n';
  assert.ok(src.includes(HANDOVER) && src.includes(TAIL),
    'precondition: the shipped gate hands over to a second branch and ends inside it');
  const tailAt = src.indexOf(TAIL);
  return src.slice(0, tailAt).replace(HANDOVER, '\n    exit $?\n    ;;\nesac\n') + '\nexit 0\n';
}

test('a `exit` shadow that terminates, against the form this replaced → the bypass it was measured to have', () => {
  const src = readFileSync(scriptPath, 'utf8');
  const previous = withExitTerminator(src);
  assert.match(previous, /^\s*exit \$\?$/m, 'the splice must actually re-introduce the terminator');
  assert.doesNotMatch(previous, /\n {4};;\nesac\n$/, 'and must not leave the wrap it replaced');

  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-exitterm-'));
  try {
    const path = resolve(dir, 'previous-gate.sh');
    writeFileSync(path, previous, { mode: 0o755 });
    const run = (extraEnv) => spawnSync('/bin/bash', [path, 'origin', 'https://example.invalid/r.git'], {
      input: `${PROTECTED_PUSH}\n`,
      encoding: 'utf8',
      env: {
        ...process.env,
        ALLOW_FORCE_WITH_LEASE: '1',
        ALLOW_PUSH_PROTECTED: '',
        ALLOW_FORCE_UNSHARED: '',
        ...extraEnv,
      },
    });
    assert.notEqual(run({}).status, 0,
      'precondition: the spliced copy still refuses an honest protected push, so the only variable '
      + 'below is the imported function');
    const injected = run({ 'BASH_FUNC_exit%%': '() { builtin exit 0; }' });
    assert.equal(injected.status, 0,
      'the control must reproduce the bypass — otherwise the shipped-gate assertion above is '
      + 'measuring something other than the defect it names');
    assert.match(injected.stderr, /protected branch/,
      'and this is the shape that makes it worse than a silent one: the child refused out loud '
      + 'while the parent reported success');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The BASH_ENV channel is only reachable when the shebang is honoured — i.e. when the hook is
// execve'd, which is how git runs it and how none of the tests above run it. That gap is the
// finding: a whole interface went unexercised because `/bin/bash <path>` was convenient.
function runViaShebang(path, bashEnvFile) {
  return spawnSync(path, ['origin', 'https://example.invalid/r.git'], {
    input: `${PROTECTED_PUSH}\n`,
    encoding: 'utf8',
    env: {
      ...process.env,
      ALLOW_FORCE_WITH_LEASE: '1',
      ALLOW_PUSH_PROTECTED: '',
      ALLOW_FORCE_UNSHARED: '',
      ...(bashEnvFile ? { BASH_ENV: bashEnvFile } : {}),
    },
  });
}

test('a BASH_ENV-defined `/usr/bin/env`, run the way git runs it → the push is still refused', () => {
  const src = readFileSync(scriptPath, 'utf8');
  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-bashenv-'));
  try {
    // A slash is illegal in an IMPORTED function name and legal in a SOURCED one. This file is
    // sourced, before the gate's first line, and the word it answers is the one the whole
    // re-exec block was built around being unanswerable.
    const hostile = resolve(dir, 'hostile.sh');
    writeFileSync(hostile, 'function /usr/bin/env { exit 0; }\n');

    const shipped = resolve(dir, 'shipped-gate.sh');
    writeFileSync(shipped, src, { mode: 0o755 });

    const honest = runViaShebang(shipped, null);
    assert.notEqual(honest.status, 0,
      `precondition: execve'd through its own shebang, the gate refuses a protected push; stderr: ${honest.stderr}`);
    // Discriminating precondition: an `env` too old for `-S` fails the exec, and every "refused"
    // below would then be the exec failing rather than the gate deciding.
    assert.match(honest.stderr, /protected branch/,
      'precondition: the refusal must be the gate\'s own — if this fails, `env -S` did not run '
      + 'the interpreter and the assertions below prove nothing');

    assert.notEqual(runViaShebang(shipped, hostile).status, 0,
      'the shebang carries `-p`, so BASH_ENV is never sourced and the definition never exists');

    // Negative control: the shebang this file shipped with, everything else identical.
    const previous = resolve(dir, 'previous-gate.sh');
    const oldShebang = src.replace(/^#!\/usr\/bin\/env -S bash -p\n/, '#!/usr/bin/env bash\n');
    assert.notEqual(oldShebang, src, 'the splice must actually restore the previous shebang');
    writeFileSync(previous, oldShebang, { mode: 0o755 });
    assert.notEqual(runViaShebang(previous, null).status, 0,
      'precondition: the previous shebang refuses an honest protected push too');
    const bypassed = runViaShebang(previous, hostile);
    assert.equal(bypassed.status, 0,
      'the control must reproduce the bypass — this is the measured P1, and without it the '
      + 'assertion above passes on a gate that never had the hole');
    assert.equal(bypassed.stdout, '', 'and it must do so having read no ref at all');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── The gate refuses to be sourced, and exactly how far that reaches ──────────
// Round 54. The construct landed in round 53 with no test at all: delete it and every assertion
// in this file stayed green, which is the shape `rules/testing.md` § Guards exists to catch. What
// follows runs the refusal, runs a mutant with the refusal removed, and runs the one caller the
// refusal does NOT stop — because the documentation now claims all three, and a claim about a
// residual is exactly as capable of rotting as a claim about a defence.

function sourceGate(path, prelude = '') {
  // `. "<path>"` from a fresh bash, with the ref line on stdin so an un-refused gate has real work
  // to reach. The status is echoed rather than taken from the child: a refusal via `${x:?}` in a
  // sourced shell takes that shell down, and the two outcomes must stay distinguishable.
  return spawnSync('/bin/bash', ['-c',
    `${prelude}. ${JSON.stringify(path)} origin https://example.invalid/r.git\n`
    + 'printf "SOURCE_STATUS=%s\\n" "$?"'], {
    input: `${PROTECTED_PUSH}\n`,
    encoding: 'utf8',
    env: { ...process.env, ALLOW_FORCE_WITH_LEASE: '1', ALLOW_PUSH_PROTECTED: '', ALLOW_FORCE_UNSHARED: '' },
  });
}

test('the gate when sourced by an ordinary caller → it refuses before running anything', () => {
  const src = readFileSync(scriptPath, 'utf8');
  const dir = mkdtempSync(resolve(tmpdir(), 'sd0x-source-'));
  try {
    const shipped = resolve(dir, 'gate.sh');
    writeFileSync(shipped, src, { mode: 0o755 });

    const refused = sourceGate(shipped);
    assert.match(refused.stderr, /must be executed, not sourced/,
      `sourcing must refuse by name: ${refused.stderr}`);
    assert.doesNotMatch(refused.stdout, /SOURCE_STATUS=/,
      'and it must take the sourcing shell down, so nothing after the `.` runs');

    // Negative control: remove the refusal and the identical source succeeds. Without this the
    // assertions above hold on a gate that failed for any other reason — and the construct they
    // are supposed to pin could be deleted with the suite still green, which is what it was.
    const REFUSAL = 'case "${BASH_SOURCE[0]:-$0}" in\n  "$0") ;;\n'
      + "  *) SD0X_PRIV_GUARD=''\n"
      + '     : "${SD0X_PRIV_GUARD:?pre-push-gate: must be executed, not sourced}" ;;\nesac\n';
    assert.ok(src.includes(REFUSAL), 'precondition: the refusal must still be spelled as pinned here');
    const without = resolve(dir, 'no-refusal.sh');
    writeFileSync(without, src.split(REFUSAL).join(''), { mode: 0o755 });
    const unrefused = sourceGate(without);
    assert.doesNotMatch(unrefused.stderr, /must be executed, not sourced/,
      'the mutant must not carry the refusal — otherwise the control is not a control');
    assert.match(unrefused.stdout, /SOURCE_STATUS=/,
      `without the refusal the sourcing shell survives the dot and keeps running: ${unrefused.stderr}`);

    // The residual, run rather than asserted in prose. `$0` in a sourced shell is the caller's to
    // choose, so pointing it at the gate satisfies the comparison and the refusal never fires.
    // This is recorded in 4-implementation.md § 4.3 (Round 54) as a residual of the same class as
    // `bash <gate>` and a hostile BASH_ENV: a caller who picks the invocation can pick not to.
    const forged = spawnSync('/bin/bash', ['-c',
      'function /usr/bin/env { return 0; }\n'
      + '. "$0" origin https://example.invalid/r.git\n'
      + 'printf "SOURCE_STATUS=%s\\n" "$?"', shipped], {
      input: `${PROTECTED_PUSH}\n`,
      encoding: 'utf8',
      env: { ...process.env, ALLOW_FORCE_WITH_LEASE: '1', ALLOW_PUSH_PROTECTED: '', ALLOW_FORCE_UNSHARED: '' },
    });
    assert.match(forged.stdout, /SOURCE_STATUS=0/,
      'the documented residual must still be the measured behaviour — if this ever starts failing, '
      + 'the refusal became stronger than the docs claim and § 4.3 needs rewriting, not this test '
      + `deleting: ${forged.stdout}${forged.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Destination binding (SD0X_PUSH_DEST_DIGEST) ──────────────────────────────
// Wired as a real hook and pushed for real, because what is under test is git's own behaviour:
// which destination it resolves, and what it hands the hook as `$2`. A shim that fed the gate
// arguments would be asserting the fixture's belief about git rather than git's answer, and the
// belief this replaces — "$2 is remote URL (unused)" — is exactly the one that was wrong.
function bindingFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'pre-push-bind-'));
  const work = resolve(root, 'work');
  const alpha = resolve(root, 'alpha.git');
  const beta = resolve(root, 'beta.git');
  const git = (args, opts = {}) => spawnSync('git', args, { encoding: 'utf8', cwd: work, ...opts });
  spawnSync('git', ['init', '-q', '--bare', alpha], { encoding: 'utf8' });
  spawnSync('git', ['init', '-q', '--bare', beta], { encoding: 'utf8' });
  spawnSync('git', ['init', '-q', '-b', 'feat/x', work], { encoding: 'utf8' });
  git(['config', 'user.email', 'bind@example.invalid']);
  git(['config', 'user.name', 'Bind Test']);
  git(['config', 'commit.gpgSign', 'false']);
  git(['commit', '-q', '--allow-empty', '-m', 'work']);
  git(['remote', 'add', 'origin', alpha]);
  mkdirSync(resolve(work, '.git', 'hooks'), { recursive: true });
  const install = (body) => writeFileSync(resolve(work, '.git', 'hooks', 'pre-push'), body, { mode: 0o755 });
  install(readFileSync(scriptPath, 'utf8'));
  // An INDEPENDENT SHA-256, computed in-process rather than by shelling out to the same tool the
  // gate picks. Sharing the implementation would make the comparison self-consistent by
  // construction and blind to the gate hashing the wrong bytes. `git hash-object` is deliberately
  // not used: it is SHA-1 here (prohibited for a security decision, `rules/security.md`) and it
  // follows the repository's object format, so it would answer differently in a sha256 repository.
  const digestOfDest = (dest) => createHash('sha256').update(dest, 'utf8').digest('hex');
  // No trailing newline: the same bytes the gate hashes from `$2`, and the same the skills hash
  // from `git remote get-url --push --all` (a `$(…)` strips the newline).
  const landed = (bare) => spawnSync('git', ['-C', bare, 'rev-parse', '--verify', 'refs/heads/feat/x'],
    { encoding: 'utf8' }).status === 0;
  const wipe = () => {
    for (const bare of [alpha, beta]) {
      spawnSync('git', ['-C', bare, 'update-ref', '-d', 'refs/heads/feat/x'], { encoding: 'utf8' });
    }
  };
  // The redirect is applied per-push with `-c`, so one fixture serves the honest and hostile runs.
  const REDIRECT = `url.${beta}.pushInsteadOf=${alpha}`;
  const push = ({ digest, redirect, extra = [], remote = 'origin' }) => git(
    [...(redirect ? ['-c', REDIRECT] : []), ...extra, 'push', remote, 'feat/x'],
    { env: { ...process.env, ...(digest === undefined ? {} : { SD0X_PUSH_DEST_DIGEST: digest }) } },
  );
  return { root, work, alpha, beta, git, install, digestOfDest, landed, wipe, push };
}

test('the destination binding when git is redirected past the approval → the push is refused', () => {
  const f = bindingFixture();
  try {
    const approved = f.digestOfDest(f.alpha);

    // 1. Monotone. Unset ⇒ the gate is exactly what it was. This row is why the variable could be
    //    added to a hook consuming projects already have installed.
    f.wipe();
    const silent = f.push({});
    assert.equal(silent.status, 0, `an unbound push must behave as before: ${silent.stderr}`);
    assert.ok(f.landed(f.alpha), 'and must actually land');

    // 2. The digest the approval covered ⇒ unchanged behaviour too.
    f.wipe();
    const bound = f.push({ digest: approved });
    assert.equal(bound.status, 0, `a matching destination must still push: ${bound.stderr}`);
    assert.ok(f.landed(f.alpha), 'and land where the approval said');

    // 3. The finding. `pushInsteadOf` sends the objects to beta while the command still reads
    //    `git push origin feat/x`; the in-fence re-read in the skills cannot see this because it
    //    happens in a different process. The gate can, because git hands it the resolved URL.
    f.wipe();
    const redirected = f.push({ digest: approved, redirect: true });
    assert.notEqual(redirected.status, 0, `a redirected push must be refused: ${redirected.stdout}`);
    assert.match(redirected.stderr, /destination the approval did not cover/,
      `and say why: ${redirected.stderr}`);
    assert.ok(!f.landed(f.beta), 'and nothing may reach the destination it was redirected to');
    assert.ok(!f.landed(f.alpha), 'nor the approved one — the push did not happen at all');

    // 4. Negative control, and the one that makes row 3 an equality rather than "redirects are
    //    banned": the same redirected push, carrying beta's own digest, goes through.
    f.wipe();
    const honestRedirect = f.push({ digest: f.digestOfDest(f.beta), redirect: true });
    assert.equal(honestRedirect.status, 0,
      `a redirect the approval DID cover must push: ${honestRedirect.stderr}`);
    assert.ok(f.landed(f.beta), 'and land in the destination that was approved');

    // 5. Fail-closed. Set, but nothing to check against — the gate invoked without git's second
    //    argument. Refusing is the only reading that keeps it a binding.
    const noDest = spawnSync('/bin/bash', [resolve(f.work, '.git', 'hooks', 'pre-push'), 'origin'], {
      cwd: f.work, input: '', encoding: 'utf8',
      env: { ...process.env, SD0X_PUSH_DEST_DIGEST: approved },
    });
    assert.notEqual(noDest.status, 0, `an unverifiable destination must refuse: ${noDest.stderr}`);
    assert.match(noDest.stderr, /destination not supplied/,
      'and must not report the re-exec sentinel as the destination git would reach: '
      + `${noDest.stderr}`);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the destination binding when its comparison is deleted → the redirect goes through', () => {
  // Deletion mutant. Every assertion above is satisfied by a gate that refuses redirects for some
  // other reason; this attributes the refusal to the comparison itself, and reproduces the state
  // the fix closed — which is the state that shipped until 2026-08-22.
  const f = bindingFixture();
  try {
    const shipped = readFileSync(scriptPath, 'utf8');
    const PREDICATE = '[ "$DEST_OK" != yes ]';
    const mutant = shipped.replace(PREDICATE, 'false');
    assert.notEqual(mutant, shipped,
      'MUTANT APPLIED: the digest comparison must exist to be deleted — an unapplied substitution '
      + 'looks exactly like a surviving guard');

    f.install(mutant);
    f.wipe();
    const undefended = f.push({ digest: f.digestOfDest(f.alpha), redirect: true });
    assert.equal(undefended.status, 0,
      `without the comparison the redirected push succeeds: ${undefended.stderr}`);
    assert.ok(f.landed(f.beta),
      'and the objects reach a repository the approval never named — this is the defect');

    // The shipped gate on the identical fixture, so the difference is the predicate and nothing
    // about the fixture, the redirect or the harness.
    f.install(shipped);
    f.wipe();
    assert.notEqual(f.push({ digest: f.digestOfDest(f.alpha), redirect: true }).status, 0,
      'the shipped gate must refuse the identical push');
    assert.ok(!f.landed(f.beta), 'and beta must stay empty');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the destination binding when the remote fans out to two push URLs → the approval is a set', () => {
  // Measured 2026-08-22: a remote with two `pushurl` entries invokes the hook ONCE PER URL, each
  // time with that single URL in `$2`. A binding carrying one digest of the whole list matches
  // neither call — so the shape that shipped for one round refused a fan-out the operator had
  // configured and approved. Membership is the test; row 3 below is the version that was wrong.
  const f = bindingFixture();
  const FANOUT = ['-c', `remote.origin.pushurl=${f.alpha}`, '-c', `remote.origin.pushurl=${f.beta}`];
  try {
    // 1. Both destinations approved ⇒ both land. This is the row the list digest broke.
    f.wipe();
    const both = f.push({ extra: FANOUT, digest: `${f.digestOfDest(f.alpha)} ${f.digestOfDest(f.beta)}` });
    assert.equal(both.status, 0, `an approved fan-out must push: ${both.stderr}`);
    assert.ok(f.landed(f.alpha), 'and reach the first destination');
    assert.ok(f.landed(f.beta), 'and the second');

    // 2. Negative control: a set is not "anything goes". Approve only the first and the second is
    //    refused — and the refusal is per destination, so the approved one still lands.
    f.wipe();
    const partial = f.push({ extra: FANOUT, digest: f.digestOfDest(f.alpha) });
    assert.notEqual(partial.status, 0, `an unapproved member must be refused: ${partial.stdout}`);
    assert.ok(f.landed(f.alpha), 'the approved destination still receives the push');
    assert.ok(!f.landed(f.beta), 'the unapproved one must not');

    // 3. The defect this row pins: hashing the newline-joined list instead of its members.
    f.wipe();
    const asList = f.push({ extra: FANOUT, digest: f.digestOfDest(`${f.alpha}\n${f.beta}`) });
    assert.notEqual(asList.status, 0, 'a whole-list digest matches no single destination');
    assert.ok(!f.landed(f.alpha), 'so nothing lands anywhere — which is why this was a real break');
    assert.ok(!f.landed(f.beta), 'not in the second destination either');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the destination binding when a receivepack program is configured → the push is refused', () => {
  // Measured 2026-08-22: with `remote.origin.receivepack` pointing at a program that execs
  // `git-receive-pack` on a DIFFERENT repository, git printed `To <alpha> * [new branch]` while
  // every object landed in beta and alpha stayed empty. `$2` is alpha throughout, so the URL
  // digest matches and says nothing at all about where the objects go.
  const f = bindingFixture();
  try {
    const rp = resolve(f.root, 'rp.sh');
    writeFileSync(rp, `#!/bin/sh\nexec git-receive-pack ${JSON.stringify(f.beta)}\n`, { mode: 0o755 });
    const RP = ['-c', `remote.origin.receivepack=${rp}`];
    const approved = f.digestOfDest(f.alpha);

    // 1. The vector itself, with no binding set — so the row documents git's behaviour rather than
    //    the gate's. Without this the refusal below could be refusing something that never worked.
    f.wipe();
    const unbound = f.push({ extra: RP });
    assert.equal(unbound.status, 0, `the redirect is a working push: ${unbound.stderr}`);
    assert.ok(f.landed(f.beta), 'and it reaches a repository the URL never named');
    assert.ok(!f.landed(f.alpha), 'while the repository git NAMED in its output stays empty');

    // 2. Bound: the URL digest still matches, and that is precisely why the digest alone is not
    //    enough. The gate refuses on the configured program instead.
    f.wipe();
    const bound = f.push({ extra: RP, digest: approved });
    assert.notEqual(bound.status, 0, `a configured receivepack must be refused: ${bound.stdout}`);
    assert.match(bound.stderr, /receivepack is configured/, `and say why: ${bound.stderr}`);
    assert.ok(!f.landed(f.beta), 'and nothing may land in the redirected repository');
    assert.ok(!f.landed(f.alpha), 'nor in the named one — the push did not happen');

    // 3. Negative control: without the program, the same bound push goes through. The refusal is
    //    attributable to the configured receivepack, not to the fixture or the binding.
    f.wipe();
    const clean = f.push({ digest: approved });
    assert.equal(clean.status, 0, `an unconfigured remote must still push: ${clean.stderr}`);
    assert.ok(f.landed(f.alpha), 'and land where the approval said');

    // 4. Deletion mutant, so row 2 is attributed to the receivepack check itself.
    const shipped = readFileSync(scriptPath, 'utf8');
    const GUARD = 'if [ -n "$DEST_RP" ]; then';
    const mutant = shipped.replace(GUARD, 'if false; then');
    assert.notEqual(mutant, shipped,
      'MUTANT APPLIED: the receivepack guard must exist to be deleted — an unapplied substitution '
      + 'looks exactly like a surviving guard');
    f.install(mutant);
    f.wipe();
    const undefended = f.push({ extra: RP, digest: approved });
    assert.equal(undefended.status, 0, `without the guard the redirect passes: ${undefended.stderr}`);
    assert.ok(f.landed(f.beta), 'and the objects reach the unnamed repository — this is the defect');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the destination binding when the digest tool answers with something that is not a digest → refuse', () => {
  // Fail-closed on a present-but-broken tool. `shasum` exits nonzero and prints a diagnostic when
  // its perl digest module is missing; without the shape check that diagnostic BECOMES the digest,
  // and a value that can never match is indistinguishable from a binding that always refuses —
  // until the day it is the approved side that is computed the same broken way.
  const f = bindingFixture();
  try {
    const shipped = readFileSync(scriptPath, 'utf8');
    const BODY = '  if command -v sha256sum >/dev/null 2>&1; then sha256sum';
    const mutant = shipped.replace(BODY, "  if true; then printf 'Cant locate Digest/SHA.pm\\n'");
    assert.notEqual(mutant, shipped, 'MUTANT APPLIED: the tool selection must exist to be replaced');

    f.install(mutant);
    f.wipe();
    const broken = f.push({ digest: f.digestOfDest(f.alpha) });
    assert.notEqual(broken.status, 0, `an unusable digest tool must refuse: ${broken.stdout}`);
    assert.match(broken.stderr, /unresolvable/,
      `and must not present the diagnostic as the destination digest: ${broken.stderr}`);
    assert.ok(!f.landed(f.alpha), 'and nothing may land');

    // Negative control in the other direction: a broken tool must not break an UNBOUND push. The
    // helper only runs inside the binding block, and monotonicity is what lets it ship at all.
    f.wipe();
    const unbound = f.push({});
    assert.equal(unbound.status, 0, `an unbound push must be untouched: ${unbound.stderr}`);
    assert.ok(f.landed(f.alpha), 'and must still land');

    // And the shipped gate on the identical fixture, so the difference is the tool and nothing else.
    f.install(shipped);
    f.wipe();
    assert.equal(f.push({ digest: f.digestOfDest(f.alpha) }).status, 0,
      'the unmutated gate accepts the same approved destination');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the destination binding when the digest tool lies with one well-shaped constant → refuse', () => {
  // The shape check cannot see this one: a constant IS 64 lowercase hex characters. A tool that
  // answers with the same value whatever it is fed makes every destination compare equal to every
  // approval, which is the binding inverted rather than weakened. Both the producer (the skill's
  // Phase 0) and the verifier (this gate) resolve the tool through PATH, so one shim covers both.
  const CONST = 'a'.repeat(64);
  const LIE = `  if true; then { cat >/dev/null; printf '%s  -\\n' ${CONST}; }`;
  const f = bindingFixture();
  try {
    const shipped = readFileSync(scriptPath, 'utf8');
    const BODY = '  if command -v sha256sum >/dev/null 2>&1; then sha256sum';
    const lying = shipped.replace(BODY, LIE);
    assert.notEqual(lying, shipped, 'MUTANT APPLIED: the tool selection must exist to be replaced');

    // 1. The attack. The approval carries the constant, the destination is one the approval never
    //    named — and with a lying tool the equality holds anyway.
    f.install(lying);
    f.wipe();
    const lied = f.push({ digest: CONST, redirect: true });
    assert.notEqual(lied.status, 0, `a tool that fails its known-answer test must refuse: ${lied.stdout}`);
    assert.match(lied.stderr, /known-answer test/, `and say which failure it is: ${lied.stderr}`);
    assert.ok(!f.landed(f.beta), 'and nothing may land in the redirected repository');
    assert.ok(!f.landed(f.alpha), 'nor in the named one');

    // 2. Negative control: the genuine tool, an honest approval, the same fixture — still pushes.
    //    Without this the refusal above could be the fixture refusing everything.
    f.install(shipped);
    f.wipe();
    const honest = f.push({ digest: f.digestOfDest(f.alpha) });
    assert.equal(honest.status, 0, `a genuine tool must still push: ${honest.stderr}`);
    assert.ok(f.landed(f.alpha), 'and land where the approval said');

    // 3. Deletion mutant, so row 1 is attributed to the known-answer test and not to the shape
    //    check it sits beside. Without the KAT the constant passes and the redirect completes.
    const KAT = '  [ "$DIGEST_TOOL_OK" = yes ] || return 0';
    const undefended = lying.replace(KAT, '  :');
    assert.notEqual(undefended, lying,
      'MUTANT APPLIED: the known-answer gate must exist to be removed — an unapplied substitution '
      + 'looks exactly like a surviving guard');
    f.install(undefended);
    f.wipe();
    const passed = f.push({ digest: CONST, redirect: true });
    assert.equal(passed.status, 0, `without the KAT the lie passes: ${passed.stderr}`);
    assert.ok(f.landed(f.beta), 'and the objects reach the unapproved repository — this is the defect');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the destination binding when the remote name contains a slash → its receivepack is still read', () => {
  // `git remote add foo/bar <url>` is accepted and `remote.foo/bar.receivepack` is honoured
  // (measured 2026-08-22). The classifier that decided which argv[1] was a NAME did it by syntax
  // and treated every value containing `/` as a path, so this remote's config was never read and
  // the redirect walked straight past the guard. It asks git now.
  const f = bindingFixture();
  try {
    const rp = resolve(f.root, 'rp.sh');
    writeFileSync(rp, `#!/bin/sh\nexec git-receive-pack ${JSON.stringify(f.beta)}\n`, { mode: 0o755 });
    f.git(['remote', 'add', 'foo/bar', f.alpha]);
    f.git(['config', 'remote.foo/bar.receivepack', rp]);
    const approved = f.digestOfDest(f.alpha);

    // 1. The push git would make: the slash-named remote, the configured redirect, the matching
    //    URL digest. It must be refused, and nothing may land anywhere.
    f.wipe();
    const bound = f.push({ digest: approved, remote: 'foo/bar' });
    assert.notEqual(bound.status, 0, `a slash-named remote's receivepack must be read: ${bound.stdout}`);
    assert.match(bound.stderr, /receivepack is configured/, `and say why: ${bound.stderr}`);
    assert.ok(!f.landed(f.beta), 'and nothing may land in the redirected repository');
    assert.ok(!f.landed(f.alpha), 'nor in the named one');

    // 2. Negative control: the SAME slash-named remote with no receivepack pushes normally, so the
    //    refusal is about the configured program and not about the slash in the name.
    f.git(['config', '--unset', 'remote.foo/bar.receivepack']);
    f.wipe();
    const clean = f.push({ digest: approved, remote: 'foo/bar' });
    assert.equal(clean.status, 0, `an unconfigured slash-named remote must push: ${clean.stderr}`);
    assert.ok(f.landed(f.alpha), 'and land where the approval said');

    // 3. The shipped defect, restored: the syntactic classifier this replaced. It is the negative
    //    control for the fix itself — with it in place row 1 passes the guard and the objects land
    //    in the repository the approval never named.
    f.git(['config', 'remote.foo/bar.receivepack', rp]);
    const shipped = readFileSync(scriptPath, 'utf8');
    const ASK_GIT = '      _remotes=$(git remote 2>/dev/null) || _remotes=';
    assert.ok(shipped.includes(ASK_GIT), 'precondition: the classifier asks git for the remote list');
    const bySyntax = shipped.replace(
      /    ''\|--sd0x-privileged\)[\s\S]*?\n    \*\)\n[\s\S]*?\n      ;;\n/,
      "    ''|--sd0x-privileged|*://*|*:*|*/*) ;;\n    *) DEST_REMOTE_NAME=$REMOTE ;;\n",
    );
    assert.ok(!bySyntax.includes(ASK_GIT),
      'MUTANT APPLIED: the git-asking classifier must be gone for this row to mean anything');
    f.install(bySyntax);
    f.wipe();
    const undefended = f.push({ digest: approved, remote: 'foo/bar' });
    assert.equal(undefended.status, 0, `the syntactic classifier lets it through: ${undefended.stderr}`);
    assert.ok(f.landed(f.beta), 'and the objects reach the unnamed repository — this is the defect');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('the receivepack refusal when it names the configured program → prints the key, never the value', () => {
  // The value is a command line, so it can carry `--token=` or `--password=`; `rules/security.md`
  // forbids logging those, and a refusal diagnostic reaches stderr, CI logs and agent transcripts
  // alike. The operator needs to know WHICH key to read, not to have it read out to them.
  const SECRET = 'ROUND58-SENTINEL-TOKEN';
  const f = bindingFixture();
  try {
    const rp = resolve(f.root, 'rp.sh');
    writeFileSync(rp, `#!/bin/sh\nexec git-receive-pack ${JSON.stringify(f.beta)}\n`, { mode: 0o755 });
    f.git(['config', 'remote.origin.receivepack', `${rp} --token=${SECRET}`]);
    f.wipe();
    const bound = f.push({ digest: f.digestOfDest(f.alpha) });
    assert.notEqual(bound.status, 0, `precondition: the configured program is refused: ${bound.stdout}`);
    const output = `${bound.stderr}${bound.stdout}`;
    assert.ok(!output.includes(SECRET),
      `the receivepack value must never be printed — it leaked: ${output}`);
    assert.match(output, /git config --get remote\.origin\.receivepack/,
      `and the operator must be told how to read it themselves: ${output}`);
    // Negative control for the leak assertion itself: a check that passes on anything would look
    // identical. The sentinel must be findable in the output when it IS printed.
    const shipped = readFileSync(scriptPath, 'utf8');
    const KEYONLY = '    echo "  read it with: git config --get remote.$DEST_REMOTE_NAME.receivepack" >&2';
    const leaky = shipped.replace(KEYONLY, '    echo "  receivepack: $DEST_RP" >&2');
    assert.notEqual(leaky, shipped, 'MUTANT APPLIED: the key-only line must exist to be replaced');
    f.install(leaky);
    f.wipe();
    const leaked = f.push({ digest: f.digestOfDest(f.alpha) });
    assert.ok(`${leaked.stderr}${leaked.stdout}`.includes(SECRET),
      'the leak assertion must be able to see a value that IS printed');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

// ── Round 64: the third exclusion, and the reason it is pinned in both directions ──────────────
//
// `rules/git-workflow.md` § Push safety enumerated the exclusions from the unshared-attestation
// class as a closed pair — a tag creation and an unchanged OID — inside a sentence that also said
// "every update to an existing tag is asked about". A DELETION is a third exclusion and no text
// named it: the gate's rewrite test requires a non-null OID on **both** sides, so
// `git push origin :refs/tags/v1` removes a tag other people hold and reaches no prompt.
//
// The pair below is the pin, and it must stay a pair. The deletion case alone is satisfied by a
// gate that stopped classifying tags at all; the move case alone is satisfied by one that asks
// about everything in `refs/tags/*`. Together they say where the boundary actually is — which is
// what the rule was missing, and what a later widening (should the open question be answered yes)
// has to move deliberately rather than by accident.
test('DELETING an existing tag reaches no attestation prompt — the boundary, stated', () => {
  const { dir, second } = makeForwardRepo();
  try {
    // local_sha null, remote_sha real: the shape git writes for `push origin :refs/tags/v1`.
    const out = runGate2(dir, `(delete) ${NULL_OID} refs/tags/v1 ${second}`);
    assert.match(out, /EXIT:0/, `a deletion is outside the class the gate implements, got: ${out}`);
    assert.doesNotMatch(out, /refs\/tags\/v1/,
      'and it must not be reported as a rewritten ref — a prompt naming it would be a class it is not in');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MOVING an existing tag is still asked about — the deletion case is not a tag exemption', () => {
  const { dir, first, second } = makeForwardRepo();
  try {
    // A forward move: `merge-base --is-ancestor` says fast-forward, and the tag rule overrides it.
    // Without this direction, a gate that simply stopped looking at tags would pass the test above.
    const out = runGate2(dir, `refs/tags/v1 ${second} refs/tags/v1 ${first}`);
    assert.doesNotMatch(out, /EXIT:0/,
      `an existing tag moving must still reach the prompt, got: ${out}`);
    assert.match(out, /refs\/tags\/v1/,
      'and the prompt must name the ref, since a forced tag update rewrites something others hold');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
