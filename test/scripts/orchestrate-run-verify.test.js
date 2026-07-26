const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, chmodSync, rmSync, symlinkSync, unlinkSync, readFileSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const scriptPath = resolve(__dirname, '../../skills/orchestrate/scripts/run-verify.js');
const tempDirs = [];

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

function createRepo() {
  const base = mkdtempSync(join(tmpdir(), 'sd0x-orch-verify-'));
  tempDirs.push(base);
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, ['init']);
  git(repo, ['config', '--local', 'user.name', 'verify-test']);
  git(repo, ['config', '--local', 'user.email', 'verify@test.dev']);
  writeFileSync(join(repo, 'service.js'), 'module.exports = { fee: 30 };\n');
  git(repo, ['add', 'service.js']);
  git(repo, ['commit', '-m', 'init']);
  return { base, repo };
}

function digestOf(bytes) {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function snapshotToFile(base, repo) {
  const stdout = execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8' });
  const baselinePath = join(base, 'baseline.json');
  writeFileSync(baselinePath, stdout);
  return { baselinePath, baseline: JSON.parse(stdout), digest: digestOf(stdout) };
}

// `digest` defaults to the digest of whatever is on disk at baselinePath, so the ordinary
// drift tests below keep asserting drift rather than tripping the identity check. Tests that
// exercise substitution pass an explicit digest.
function compare(repo, baselinePath, digest) {
  const sha = digest !== undefined ? digest : digestOf(readFileSync(baselinePath, 'utf8'));
  try {
    const stdout = execFileSync(
      'node',
      [scriptPath, 'compare', '--baseline', baselinePath, '--baseline-sha256', sha, '--repo', repo],
      { encoding: 'utf8' }
    );
    return { output: JSON.parse(stdout), exitCode: 0 };
  } catch (err) {
    const stdout = (err.stdout || '').toString();
    return {
      output: stdout ? JSON.parse(stdout) : null,
      exitCode: err.status,
      stderr: (err.stderr || '').toString(),
    };
  }
}

// snapshot variant that captures exit code + stderr WITHOUT throwing (snapshotToFile throws on
// non-zero). Needed to assert that snapshot itself fails CLOSED on an unverifiable node.
function snapshotResult(repo) {
  try {
    const stdout = execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { output: stdout ? JSON.parse(stdout) : null, exitCode: 0, stderr: '' };
  } catch (err) {
    return { output: null, exitCode: err.status, stderr: (err.stderr || '').toString() };
  }
}

function driftFields(result) {
  return result.output.drift.map((d) => d.field);
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test('run-verify snapshot: emits the full T3 check set', () => {
  // A floor, not a ceiling: every signal the design commits to must be present. Completeness in
  // the other direction (nothing snapshot emits escapes comparison) is now structural rather than
  // asserted — see the derivation test below.
  const { base, repo } = createRepo();
  const { baseline } = snapshotToFile(base, repo);
  for (const field of [
    'head',
    'branch',
    'porcelain_sha256',
    'tracked_diff_sha256',
    'untracked_content_sha256',
    'ignored_content_sha256',
    'ignored_dirs_sha256',
    'refs_sha256',
    'local_config_sha256',
    'git_internals_sha256',
    'worktrees',
    'stash_count',
  ]) {
    assert.ok(field in baseline, `snapshot should include ${field}`);
  }
});

test('run-verify compare: the compared field set is DERIVED from the snapshot, not hand-listed', () => {
  // `COMPARE_FIELDS` used to be a hand-maintained array that `compare()` iterated. Adding a field
  // to `snapshot()` without also adding it there left the new signal UNCOMPARED, and the whole
  // suite stayed green because nothing knew the list was meant to be exhaustive — mutation-verified
  // by the reviewer: an extra snapshot field drifted freely and compare() still said `ok: true`.
  //
  // Testing the property behaviourally rather than by re-parsing the source: hand a baseline that
  // contains ONLY `schema_version`, and every other field the current snapshot emits must come
  // back as drift. If any field were still filtered through a frozen list that omitted it, it
  // would be silently absent from this report.
  const { base, repo } = createRepo();
  const { baseline } = snapshotToFile(base, repo);

  const strippedPath = join(base, 'stripped.json');
  const body = JSON.stringify({ schema_version: baseline.schema_version });
  writeFileSync(strippedPath, body);
  const result = compare(repo, strippedPath, digestOf(body));

  assert.equal(result.exitCode, 1);
  const reported = new Set(result.output.drift.map((d) => d.field));
  const expected = Object.keys(baseline).filter((k) => k !== 'schema_version');
  assert.ok(expected.length >= 12, `sanity: expected >=12 comparable fields, got ${expected.length}`);
  for (const field of expected) {
    assert.ok(reported.has(field), `${field} is emitted by snapshot but never compared`);
  }
  assert.ok(
    !reported.has('schema_version'),
    'schema_version describes the record, not the repo — it is refused outright, not reported as drift'
  );
});

test('run-verify compare: a cross-schema baseline is refused, not compared', () => {
  // Derivation reads the CURRENT snapshot's keys, so a baseline from another schema could carry a
  // field this version no longer emits — silently uncompared. Two records of different shapes
  // cannot establish "nothing changed", so the answer is refusal rather than a partial diff.
  const { base, repo } = createRepo();
  const { baseline } = snapshotToFile(base, repo);

  const stalePath = join(base, 'stale-schema.json');
  const body = JSON.stringify({ ...baseline, schema_version: baseline.schema_version - 1 });
  writeFileSync(stalePath, body);
  const result = compare(repo, stalePath, digestOf(body));

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /schema_version/);
});

test('run-verify compare: untouched repo → exit 0 {ok:true}', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.output, { ok: true });
});

test('run-verify compare: valid-JSON but non-object baseline → controlled fail-closed (no crash)', () => {
  // A `null` / array / string / number baseline parses as JSON but has no compare fields;
  // `field in baseline` would throw an UNCAUGHT TypeError (stack trace, not the controlled
  // `[run-verify] FAIL-CLOSED` path). Assert the clean fail-closed message — a revert of the
  // guard would surface a `TypeError` instead, so this is non-tautological.
  const { base, repo } = createRepo();
  for (const bad of ['null', '[]', '"a string"', '42']) {
    const baselinePath = join(base, `bad-${Buffer.from(bad).toString('hex')}.json`);
    writeFileSync(baselinePath, bad);
    const result = compare(repo, baselinePath);
    assert.equal(result.exitCode, 1, `${bad} baseline must fail closed (exit 1)`);
    assert.match(
      result.stderr || '',
      /FAIL-CLOSED: baseline is not a JSON object/,
      `${bad} baseline must report the controlled message, not a TypeError stack`
    );
    assert.doesNotMatch(result.stderr || '', /TypeError/, `${bad} must not crash uncaught`);
  }
});

test('run-verify compare: dirty baseline with no new drift → exit 0 (no-new-drift semantics)', () => {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'draft-notes.md'), '# pre-existing untracked\n');
  const { baselinePath } = snapshotToFile(base, repo);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'pre-existing dirt is part of the baseline, not drift');
});

test('run-verify compare: re-editing an already-dirty tracked file → content drift (porcelain blind spot)', () => {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'service.js'), 'module.exports = { fee: 45 };\n');
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'service.js'), 'module.exports = { fee: 60 };\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('tracked_diff_sha256'));
  assert.ok(!fields.includes('porcelain_sha256'), 'porcelain stays "M service.js" — content hash must catch it');
});

test('run-verify compare: re-editing a pre-existing untracked file → content drift (porcelain blind spot)', () => {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'draft-notes.md'), '# original draft\n');
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'draft-notes.md'), '# tampered draft\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('untracked_content_sha256'));
  assert.ok(!fields.includes('porcelain_sha256'), 'porcelain stays "?? draft-notes.md" — content hash must catch it');
});

test('run-verify compare: new untracked file after baseline → porcelain drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'sneaky-output.md'), 'worker wrote this\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('porcelain_sha256'));
});

test('run-verify compare: sneaky commit after baseline → head drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['commit', '--allow-empty', '-m', 'sneaky']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('head'));
});

test('run-verify compare: branch switch after baseline → branch drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['checkout', '-b', 'escape-branch']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('branch'));
});

test('run-verify compare: tag creation after baseline → refs drift (worktree stays clean)', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['tag', 'v9.9.9-sneaky']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('refs_sha256'));
  assert.ok(!fields.includes('porcelain_sha256'), 'tag must be caught by refs hash, not porcelain');
});

test('run-verify compare: local config tampering after baseline → config drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['config', '--local', 'core.hooksPath', '/tmp/evil-hooks']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('local_config_sha256'));
});

test('run-verify compare: stash after baseline → stash_count drift', () => {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'service.js'), 'module.exports = { fee: 45 };\n');
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['stash', 'push', '-m', 'hide changes']);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('stash_count'));
});

test('run-verify compare: new worktree after baseline → worktrees drift', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  git(repo, ['worktree', 'add', '--detach', join(base, 'shadow-worktree')]);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('worktrees'));
});

test('run-verify compare: control-plane gitignored write after baseline → no drift (.claude_workflows/)', () => {
  const { base, repo } = createRepo();
  // The orchestrator's own control plane is .claude_workflows/; run-state writes there
  // are legitimate every run and are excluded from ignored-content hashing (see
  // IGNORED_EXCLUDE_PREFIXES). Being gitignored, they are also invisible to porcelain.
  writeFileSync(join(repo, '.gitignore'), '.claude_workflows/\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore control-plane dir']);
  const { baselinePath } = snapshotToFile(base, repo);
  mkdirSync(join(repo, '.claude_workflows'));
  writeFileSync(join(repo, '.claude_workflows', 'run.json'), '{"status":"executing"}\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'control-plane run-state writes are legitimate, must not trip the verifier');
});

test('run-verify compare: NON-control-plane gitignored write after baseline → ignored_content drift', () => {
  const { base, repo } = createRepo();
  // A worker mutating a gitignored file (secrets, generated artifact) is invisible to
  // BOTH porcelain and ls-files --exclude-standard — only ignored_content_sha256 catches
  // it. This is the SC-2 bypass class the ignored-content hash closes.
  writeFileSync(join(repo, '.gitignore'), 'secrets.env\nbuild/\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore secrets + build']);
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'secrets.env'), 'API_KEY=leaked\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a gitignored mutation must be detected, not silently passed');
  const fields = driftFields(result);
  assert.ok(fields.includes('ignored_content_sha256'), 'ignored file mutation must trip ignored_content_sha256');
  assert.ok(!fields.includes('porcelain_sha256'), 'gitignored write is invisible to porcelain — ignored digest must catch it');
  assert.ok(!fields.includes('untracked_content_sha256'), 'gitignored write is invisible to ls-files --exclude-standard too');
});

test('run-verify snapshot: gitignored symlink-to-directory → snapshot succeeds (no hash-object crash)', () => {
  const { base, repo } = createRepo();
  // Reproduce the plugin-install layout: a gitignored symlink pointing at a DIRECTORY
  // (e.g. `.claude/agents -> ../agents`). `git ls-files --others --ignored` lists the
  // symlink; feeding it straight to `git hash-object` aborts ("Unable to hash <link>")
  // and fails the whole snapshot closed. hashPathsContent must hash the link target
  // instead. Without the symlink-classifying path this snapshot exits 1.
  mkdirSync(join(repo, 'real-target-dir'));
  writeFileSync(join(repo, 'real-target-dir', 'inner.txt'), 'content\n');
  writeFileSync(join(repo, '.gitignore'), 'linked-dir\n');
  git(repo, ['add', '.gitignore', 'real-target-dir/inner.txt']);
  git(repo, ['commit', '-m', 'add gitignore + target dir']);
  symlinkSync('real-target-dir', join(repo, 'linked-dir'));
  const stdout = execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8' });
  const baseline = JSON.parse(stdout);
  assert.ok(baseline.ignored_content_sha256, 'snapshot must complete and hash the ignored symlink by target');
});

test('run-verify compare: repointing a gitignored symlink after baseline → ignored_content drift', () => {
  const { base, repo } = createRepo();
  mkdirSync(join(repo, 'target-a'));
  mkdirSync(join(repo, 'target-b'));
  writeFileSync(join(repo, '.gitignore'), 'active-link\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore the symlink name']);
  symlinkSync('target-a', join(repo, 'active-link'));
  const { baselinePath } = snapshotToFile(base, repo);
  // Repoint the ignored symlink: invisible to porcelain AND ls-files --exclude-standard,
  // but the link TARGET changed → its hashed target differs → ignored_content drift.
  unlinkSync(join(repo, 'active-link'));
  symlinkSync('target-b', join(repo, 'active-link'));
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a repointed gitignored symlink is a mutation → must drift');
  assert.ok(driftFields(result).includes('ignored_content_sha256'), 'symlink repoint must trip ignored_content_sha256');
});

test('run-verify compare: nested packages/*/node_modules gitignored write → no drift (excluded at any depth)', () => {
  const { base, repo } = createRepo();
  // node_modules is excluded at ANY depth (root-only prefix would miss a monorepo's
  // packages/<pkg>/node_modules and let its churn/volume trip or bloat the verifier).
  mkdirSync(join(repo, 'packages', 'pkg-a', 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore node_modules everywhere']);
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'packages', 'pkg-a', 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'a nested node_modules write is dependency churn, excluded → no drift');
});

test('run-verify compare: editing a gitignored regular FILE literally named `node_modules` → ignored_content drift (not misread as a dependency dir, Codex iter-20 P2)', () => {
  const { base, repo } = createRepo();
  // A regular ignored FILE whose basename is `node_modules` — NOT a dependency directory. It survives
  // the `:(exclude)node_modules/` + `**/node_modules/**` pathspecs (verified: those match the DIR and
  // its contents, not a file named node_modules), so it reaches the JS ignore filter as real content.
  // The bare-leaf node_modules exclusion is dir-node-only (isNodeModulesDirNode); if it also ran on the
  // file list (the pre-fix isControlPlaneIgnored arm), this file would be dropped from ignored_content
  // hashing → an in-place edit leaves every digest unchanged → compare falsely returns {ok:true}.
  mkdirSync(join(repo, 'pkg'), { recursive: true });
  writeFileSync(join(repo, 'pkg', 'node_modules'), 'ORIGINAL\n'); // a FILE, not a dir
  writeFileSync(join(repo, '.gitignore'), 'pkg/node_modules\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore a file named node_modules']);
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'pkg', 'node_modules'), 'TAMPERED\n'); // mutate in place
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'an ignored file named node_modules is real content — its mutation must drift, not be masked as a dir');
  assert.ok(driftFields(result).includes('ignored_content_sha256'), 'the edit must trip ignored_content_sha256');
});

test('run-verify compare: editing a gitignored regular FILE named `node_modules` at REPO ROOT → ignored_content drift (strict iter-21 P2)', () => {
  const { base, repo } = createRepo();
  // The ROOT case the nested test above cannot reach: at repo root the bare leaf `node_modules`
  // equals the `'node_modules/'` prefix's dir-name (`pfx.slice(0,-1)`), so a `'node_modules/'` entry
  // in IGNORED_EXCLUDE_PREFIXES would match this FILE via the directory-style `p === pfx.slice(0,-1)`
  // arm and drop it from ignored_content hashing → an in-place edit leaves every digest unchanged →
  // compare falsely returns {ok:true} (fail-open). Anchored to root via `/node_modules` so it is a
  // FILE, not the dependency dir. Non-tautology anchor: re-adding `'node_modules/'` to the prefix
  // array makes this assertion fail (exitCode 0).
  writeFileSync(join(repo, 'node_modules'), 'ORIGINAL\n'); // a FILE at repo root, not a dir
  writeFileSync(join(repo, '.gitignore'), '/node_modules\n'); // root-anchored ignore of that file
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore a root file named node_modules']);
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, 'node_modules'), 'TAMPERED-BY-WORKER\n'); // mutate in place
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a root file named node_modules is real ignored content — its mutation must drift, not be masked as the dependency dir');
  assert.ok(driftFields(result).includes('ignored_content_sha256'), 'the root-file edit must trip ignored_content_sha256');
});

test('run-verify compare: baseline missing a check field → drift (cannot prove no-drift)', () => {
  const { base, repo } = createRepo();
  const { baselinePath, baseline } = snapshotToFile(base, repo);
  delete baseline.refs_sha256;
  writeFileSync(baselinePath, JSON.stringify(baseline));
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const missing = result.output.drift.find((d) => d.field === 'refs_sha256');
  assert.equal(missing.reason, 'field missing from baseline');
});

test('run-verify compare: planted .git/hooks/pre-commit after baseline → git_internals drift (porcelain blind)', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  // A persistence payload that fires on the next commit — git never lists
  // .git/ contents in status/ls-files, so only the internals digest can see it.
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho pwned\n');
  chmodSync(hook, 0o755);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('git_internals_sha256'), 'planted hook must trip the internals digest');
  assert.ok(!fields.includes('porcelain_sha256'), 'a .git/ write is invisible to porcelain — internals digest must catch it');
});

test('run-verify compare: .git/info/exclude append + matching write → git_internals drift (both porcelain AND ls-files blind)', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  // Appending a pattern then writing a matching file hides that write from both
  // `status --porcelain` and `ls-files --exclude-standard`; the only signal is
  // the exclude file itself, which the internals digest hashes.
  appendFileSync(join(repo, '.git', 'info', 'exclude'), 'sneaky-output.md\n');
  writeFileSync(join(repo, 'sneaky-output.md'), 'exfiltrated\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  const fields = driftFields(result);
  assert.ok(fields.includes('git_internals_sha256'), 'exclude tampering must trip the internals digest');
  assert.ok(!fields.includes('porcelain_sha256'), 'the excluded write is invisible to porcelain');
  assert.ok(!fields.includes('untracked_content_sha256'), 'the excluded write is invisible to ls-files too');
});

test('run-verify compare: chmod +x a pre-existing hook sample → git_internals drift (exec-bit sensitivity)', () => {
  const { base, repo } = createRepo();
  // Pre-plant an inert, non-executable hook file that is part of the baseline.
  const hook = join(repo, '.git', 'hooks', 'pre-push');
  writeFileSync(hook, '#!/bin/sh\ntrue\n');
  chmodSync(hook, 0o644);
  const { baselinePath } = snapshotToFile(base, repo);
  // Arming it (chmod +x) makes git start running it — a state change with no
  // content change; the digest folds the exec bit in to catch exactly this.
  chmodSync(hook, 0o755);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('git_internals_sha256'), 'arming a hook must trip the internals digest');
});

test('run-verify compare: hook mode 0755→0700 (exec bit unchanged) → git_internals drift', () => {
  // The digest previously folded in only the x-bit (`mode & 0o111 ? "x" : "-"`), so a
  // permission narrowing that KEEPS a bit set (0755→0700) collapsed to the same digest — a
  // Bash-capable worker could re-scope a hook undetected. The fix folds the FULL mode in.
  // Non-tautological: under the old exec-bit-only digest this drift is invisible.
  const { base, repo } = createRepo();
  const hook = join(repo, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\ntrue\n');
  chmodSync(hook, 0o755);
  const { baselinePath } = snapshotToFile(base, repo);
  chmodSync(hook, 0o700); // still executable, only group/other bits removed
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('git_internals_sha256'), '0755→0700 must trip the internals digest');
});

test('run-verify snapshot: already-unreadable .git/info/exclude → fail-closed exit 1 (no ABSENT collapse)', (t) => {
  // Discriminating scenario for the EACCES-vs-ENOENT split: make info/exclude unreadable
  // BEFORE snapshot. The old sentinel-collapse code caught the read error and folded the file
  // into the same ABSENT marker as a genuinely-missing exclude → snapshot exited 0 (fail OPEN,
  // an unverifiable node hidden). The fix lets any non-ENOENT error propagate to snapshot()'s
  // fail-closed catch. Non-tautological: revert the throw and this snapshot exits 0, not 1.
  const { repo } = createRepo();
  const excludeAbs = join(repo, '.git', 'info', 'exclude');
  writeFileSync(excludeAbs, '# baseline\n');
  chmodSync(excludeAbs, 0o000);
  let readable = true;
  try { readFileSync(excludeAbs); } catch { readable = false; }
  if (readable) {
    chmodSync(excludeAbs, 0o644); // running as root — 0o000 does not bite
    t.skip('info/exclude readable despite 0o000 (root/permissive FS); cannot exercise the unreadable path');
    return;
  }
  const result = snapshotResult(repo);
  chmodSync(excludeAbs, 0o644); // restore so cleanup can remove the tree
  assert.equal(result.exitCode, 1, 'unreadable info/exclude must fail snapshot CLOSED (exit 1)');
  assert.match(result.stderr || '', /\[run-verify\] FAIL-CLOSED/, 'must emit the controlled fail-closed message, not a bare stack');
});

test('run-verify compare: retarget a DANGLING info/exclude symlink (both targets missing) → drift', () => {
  // The old readFileSync(excludeAbs) FOLLOWED the link, so a dangling link resolved to ENOENT
  // and collapsed to ABSENT — a retarget between two (dangling) targets produced ZERO drift and
  // the link's own target bytes were never hashed. The fix lstats first and hashes the raw
  // readlink target. Non-tautological: under the follow-then-ENOENT code both snapshots are
  // ABSENT → no drift → exit 0; here the two distinct targets must drift → exit 1.
  const { base, repo } = createRepo();
  const excludeAbs = join(repo, '.git', 'info', 'exclude');
  unlinkSync(excludeAbs); // drop git init's default regular exclude file
  symlinkSync('nonexistent-target-A', excludeAbs); // dangling symlink → A
  const { baselinePath } = snapshotToFile(base, repo);
  unlinkSync(excludeAbs);
  symlinkSync('nonexistent-target-B', excludeAbs); // retarget → B (still dangling)
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'retargeting a dangling exclude symlink must drift (exit 1)');
  assert.ok(driftFields(result).includes('git_internals_sha256'), 'the retarget must trip the internals digest');
});

test('run-verify compare: regular info/exclude mode 0644→0600 (content unchanged) → git_internals drift', () => {
  // Locks the "full mode + content" contract for the regular-file branch, symmetric with the
  // hook 0755→0700 test. Non-tautological: the old content-only digest (`sha256(content)`) is
  // blind to a mode-only change → no drift → exit 0; the fix folds `(mode & 0o7777)` in.
  const { base, repo } = createRepo();
  const excludeAbs = join(repo, '.git', 'info', 'exclude');
  writeFileSync(excludeAbs, '# custom exclude\n');
  chmodSync(excludeAbs, 0o644);
  const { baselinePath } = snapshotToFile(base, repo);
  chmodSync(excludeAbs, 0o600); // narrow perms, content identical
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a mode-only change to info/exclude must drift (exit 1)');
  assert.ok(driftFields(result).includes('git_internals_sha256'), '0644→0600 must trip the internals digest');
});

test('hashRegularNodeNoFollow: object-identity — a symlink path fails closed (O_NOFOLLOW), never followed', () => {
  // Deterministic guard for the classify→read TOCTOU fix: the regular-file digest reads via a
  // no-follow fd, so a path that is a symlink (the raced-swap outcome) throws ELOOP instead of
  // following to a different object. Non-tautological: the pre-fix readFileSync(path) FOLLOWS the
  // link and returns the target's content hash (no throw), so this assert.throws fails on revert.
  const { hashRegularNodeNoFollow } = require(scriptPath);
  const { repo } = createRepo();
  const target = join(repo, 'real-target.txt');
  writeFileSync(target, 'TARGET-CONTENT\n');
  chmodSync(target, 0o644);
  // Regular file → mode + content from ONE fd; content is sha256 of the raw bytes.
  const reg = hashRegularNodeNoFollow(target);
  const expected = createHash('sha256').update(readFileSync(target)).digest('hex');
  assert.equal(reg.mode, '644', 'mode must be the full octal permission bits from fstat(fd)');
  assert.equal(reg.content, expected, 'content must be sha256 of the opened fd, not a marker');
  // A symlink at the read path must NOT be followed — O_NOFOLLOW → ELOOP.
  const link = join(repo, 'a-link');
  symlinkSync(target, link);
  assert.throws(
    () => hashRegularNodeNoFollow(link),
    (err) => err.code === 'ELOOP',
    'a symlink path must fail closed (ELOOP), proving the read never follows the link',
  );
});

test('hashRegularNodeNoFollow: a FIFO node fails closed fast (O_NONBLOCK), never wedges verification', (t) => {
  const { repo } = createRepo();
  const fifo = join(repo, 'a-fifo');
  try { execFileSync('mkfifo', [fifo]); } catch { t.skip('mkfifo unavailable on this host'); return; }
  // Run the helper in a CHILD with a hard timeout: a regression (blocking open on a writer-less
  // FIFO) surfaces as a timeout KILL instead of hanging the whole suite. With the fix the child
  // throws immediately — O_NONBLOCK returns from open, then fstat.isFile() is false → throw.
  // Non-tautological: drop O_NONBLOCK + the isFile() guard and the child blocks forever → timeout.
  const code = `require(${JSON.stringify(scriptPath)}).hashRegularNodeNoFollow(${JSON.stringify(fifo)});`;
  let status = 0;
  let timedOut = false;
  try {
    execFileSync('node', ['-e', code], { timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    timedOut = err.killed === true || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT';
    status = err.status;
  }
  assert.equal(timedOut, false, 'opening a FIFO must not block (O_NONBLOCK) — a hang here means the fix regressed');
  assert.notEqual(status, 0, 'a FIFO is not a regular file — the helper must throw (non-zero exit)');
});

test('sha256File: object-identity — a symlink path fails closed (O_NOFOLLOW), never followed', () => {
  // sha256File is hashDirRecursive's isFile-branch reader; harden it symmetrically with
  // hashRegularNodeNoFollow so a raced regular→symlink swap throws ELOOP instead of hashing the
  // TARGET's content. Non-tautological: the pre-fix openSync(path, 'r') FOLLOWS the link and returns
  // the target's digest (no throw), so this assert.throws fails on revert.
  const { sha256File } = require(scriptPath);
  const { repo } = createRepo();
  const target = join(repo, 'sf-target.txt');
  writeFileSync(target, 'SF-TARGET-CONTENT\n');
  const got = sha256File(target);
  const expected = createHash('sha256').update(readFileSync(target)).digest('hex');
  assert.equal(got, expected, 'sha256File of a regular file must be the sha256 of its raw bytes');
  const link = join(repo, 'sf-link');
  symlinkSync(target, link);
  assert.throws(
    () => sha256File(link),
    (err) => err.code === 'ELOOP',
    'a symlink path must fail closed (ELOOP), proving sha256File never follows the link',
  );
});

test('sha256File: a FIFO node fails closed fast (O_NONBLOCK + isFile), never wedges verification', (t) => {
  const { repo } = createRepo();
  const fifo = join(repo, 'sf-fifo');
  try { execFileSync('mkfifo', [fifo]); } catch { t.skip('mkfifo unavailable on this host'); return; }
  // sha256File opens its OWN fd (distinct from hashRegularNodeNoFollow), so reverting ONLY this
  // function's O_NONBLOCK still wedges here. Run in a CHILD with a hard timeout: a regression
  // (blocking open on a writer-less FIFO) surfaces as a timeout KILL, not a suite-wide hang.
  // Non-tautological: drop O_NONBLOCK + the isFile() guard and the child blocks forever → timeout.
  const code = `require(${JSON.stringify(scriptPath)}).sha256File(${JSON.stringify(fifo)});`;
  let status = 0;
  let timedOut = false;
  try {
    execFileSync('node', ['-e', code], { timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    timedOut = err.killed === true || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT';
    status = err.status;
  }
  assert.equal(timedOut, false, 'opening a FIFO must not block (O_NONBLOCK) — a hang here means sha256File regressed');
  assert.notEqual(status, 0, 'a FIFO is not a regular file — sha256File must throw (non-zero exit)');
});

test('run-verify snapshot: 1200 untracked files → snapshot succeeds (hash-object multi-chunk correctness)', () => {
  const { base, repo } = createRepo();
  // 1200 paths cross the CHUNK=500 boundary twice, so the batch loop runs three
  // hash-object calls; this locks down chunk ordering/concatenation. (It does
  // not exercise the byte limit itself — short paths here stay under ARG_MAX;
  // an oversized chunk would throw → fail-closed, which is the safe outcome.)
  for (let i = 0; i < 1200; i += 1) writeFileSync(join(repo, `untracked-${i}.txt`), `content ${i}\n`);
  const { baselinePath, baseline } = snapshotToFile(base, repo);
  assert.ok('untracked_content_sha256' in baseline, 'snapshot must not throw across chunk boundaries');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'a re-snapshot of the same tree is drift-free');
});

test('run-verify compare: untracked file whose name contains a newline → tracked with stable alignment', () => {
  const { base, repo } = createRepo();
  // argv-based hash-object (not --stdin-paths) keeps path→hash alignment even
  // when a path contains a newline — a line-delimited reader would desync here.
  const weird = join(repo, 'weird\nname.txt');
  writeFileSync(weird, 'sneaky\n');
  const { baselinePath, baseline } = snapshotToFile(base, repo);
  assert.ok('untracked_content_sha256' in baseline);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'a stable newline-named path must not self-drift');
  writeFileSync(weird, 'tampered\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1);
  assert.ok(driftFields(result).includes('untracked_content_sha256'), 'edit to a newline-named file must still be caught');
});

test('run-verify compare: mutation inside an embedded git repo (untracked dir entry) → drift detected', () => {
  const { base, repo } = createRepo();
  // `git ls-files --others` reports an EMBEDDED repo (a subdir carrying its own .git)
  // as a single `nested/` directory entry, never its files. A static type:dir marker
  // stays identical when nested/data.txt changes → fail-OPEN; hashDirRecursive must
  // digest the directory's full contents so any internal mutation surfaces as drift.
  const nested = join(repo, 'nested');
  mkdirSync(nested);
  git(nested, ['init']);
  writeFileSync(join(nested, 'data.txt'), 'original\n');
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'unchanged embedded repo must not self-drift');
  writeFileSync(join(nested, 'data.txt'), 'tampered\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'internal mutation of an embedded-repo dir entry must be caught');
  assert.ok(
    driftFields(result).includes('untracked_content_sha256'),
    'the recursive digest of the nested/ entry must change on internal mutation',
  );
});

test('run-verify compare: mutating a newline-named file inside an embedded repo → drift (frameParts injective framing)', () => {
  const { base, repo } = createRepo();
  // A descendant whose name contains a literal newline must not be able to alias an adjacent
  // entry: the recursive digest uses length-prefixed framing, so editing this file is caught.
  const nested = join(repo, 'nested');
  mkdirSync(nested);
  git(nested, ['init']);
  const weird = join(nested, 'da\nta.txt');
  writeFileSync(weird, 'original\n');
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'unchanged newline-named descendant must not self-drift');
  writeFileSync(weird, 'tampered\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a newline-named file inside an embedded repo must still drift on edit');
  assert.ok(driftFields(result).includes('untracked_content_sha256'));
});

test('run-verify compare: chmod-only change on an untracked file (0644→0755) → drift detected', () => {
  const { base, repo } = createRepo();
  // git status keeps the same "?? script.sh" line and git hash-object the same content
  // hash when only the mode changes, so the digest must fold in lstat permission bits or
  // a chmod-only mutation of an untracked/ignored file slips through as {ok:true}.
  const script = join(repo, 'script.sh');
  writeFileSync(script, '#!/bin/sh\necho hi\n');
  chmodSync(script, 0o644);
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'unchanged mode must not self-drift');
  chmodSync(script, 0o755);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a chmod-only change to an untracked file must be caught');
  assert.ok(driftFields(result).includes('untracked_content_sha256'), 'mode bits must be part of the digest');
});

test('run-verify compare: chmod on an untracked ANCESTOR directory (0755→0700) → drift (leaf-only listing blind spot)', () => {
  const { base, repo } = createRepo();
  // ls-files emits leaf FILES (`newdir/app.js`), never the parent dir NODE, so a chmod of an
  // untracked ancestor directory leaves every leaf hash AND porcelain unchanged. Without folding
  // ancestor dir modes into the digest, a worker could chmod `newdir/` 0755→0700 (or hide/expose
  // its group/other bits) and compare would still report {ok:true}. Non-tautology: before the
  // ancestor-mode fix this compare returns exitCode 0.
  const newdir = join(repo, 'newdir');
  mkdirSync(newdir);
  writeFileSync(join(newdir, 'app.js'), 'console.log(1)\n');
  chmodSync(newdir, 0o755);
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'unchanged ancestor-dir mode must not self-drift');
  chmodSync(newdir, 0o700); // contents untouched, only the parent dir mode changes
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a chmod-only change to an untracked ancestor directory must be caught');
  assert.ok(
    driftFields(result).includes('untracked_content_sha256'),
    'ancestor directory modes must be part of the untracked content digest'
  );
});

test('run-verify compare: chmod on a subdirectory inside an embedded repo → drift (hashDirRecursive subdir mode)', () => {
  const { base, repo } = createRepo();
  // hashDirRecursive folds each subdir's OWN mode bits into the digest, so a chmod-only
  // change to a nested directory (no content change) still surfaces as drift — a bare
  // recursive content digest would miss a dir-node permission mutation.
  const nested = join(repo, 'nested');
  mkdirSync(nested);
  git(nested, ['init']);
  const sub = join(nested, 'sub');
  mkdirSync(sub);
  writeFileSync(join(sub, 'data.txt'), 'x\n');
  chmodSync(sub, 0o755);
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'unchanged subdir mode must not self-drift');
  chmodSync(sub, 0o700);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a chmod-only change to a nested subdirectory must be caught');
  assert.ok(driftFields(result).includes('untracked_content_sha256'), 'subdir mode bits must be part of the recursive digest');
});

test('run-verify compare: chmod on the top-level embedded-repo directory → drift (hashPathsContent dir mode)', () => {
  const { base, repo } = createRepo();
  // The top-level untracked dir entry (an embedded repo) carries its OWN mode via
  // hashPathsContent's dir branch; a chmod of the directory node itself must drift.
  const nested = join(repo, 'nested');
  mkdirSync(nested);
  git(nested, ['init']);
  writeFileSync(join(nested, 'data.txt'), 'x\n');
  chmodSync(nested, 0o755);
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'unchanged dir mode must not self-drift');
  chmodSync(nested, 0o750);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a chmod-only change to the top-level embedded-repo dir must be caught');
  assert.ok(driftFields(result).includes('untracked_content_sha256'), 'top-level dir mode bits must be part of the digest');
});

test('run-verify compare: chmod on a FIFO inside an embedded repo → drift (special-file mode encoding)', { skip: process.platform === 'win32' ? 'no mkfifo on win32' : false }, () => {
  const { base, repo } = createRepo();
  // A FIFO/socket/device is neither file, dir, nor symlink → the special branch. Encoding
  // the FULL stat mode (type + perms) means a chmod (or a type swap) drifts; a constant
  // `special` marker would alias every special-file kind together and miss the change.
  const nested = join(repo, 'nested');
  mkdirSync(nested);
  git(nested, ['init']);
  const fifo = join(nested, 'pipe');
  try {
    execFileSync('mkfifo', [fifo]);
  } catch {
    return; // mkfifo unavailable on this host → nothing to assert (documented skip path)
  }
  chmodSync(fifo, 0o644);
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'unchanged FIFO must not self-drift');
  chmodSync(fifo, 0o600);
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a chmod on a special file must be caught via the mode encoding');
  assert.ok(driftFields(result).includes('untracked_content_sha256'), 'special-file mode must be part of the recursive digest');
});

test('run-verify compare: >64 KiB file inside an embedded repo → multi-chunk hash catches edit (sha256File streaming)', () => {
  const { base, repo } = createRepo();
  // sha256File streams in 64 KiB chunks; a descendant larger than one chunk must still be
  // hashed correctly across the readSync loop so an edit to it drifts (and an identical
  // file does not self-drift). Exercises the buffer-reuse / subarray(0,bytes) path.
  const nested = join(repo, 'nested');
  mkdirSync(nested);
  git(nested, ['init']);
  const big = join(nested, 'big.bin');
  const chunk = 'A'.repeat(200 * 1024); // ~200 KiB > 64 KiB → 4 readSync iterations
  writeFileSync(big, chunk);
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'an unchanged >64 KiB descendant must not self-drift');
  writeFileSync(big, `${chunk}B`); // one byte past the last chunk boundary
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'an edit to a multi-chunk descendant must be caught');
  assert.ok(driftFields(result).includes('untracked_content_sha256'));
});

test('run-verify snapshot: unreadable file inside an embedded repo → fail-closed exit 1 (no stable UNREADABLE marker)', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root bypasses file permissions' : false }, () => {
  const { repo } = createRepo();
  // A constant UNREADABLE marker for an unreadable descendant is fail-OPEN: a same-owner
  // worker could chmod-000 → mutate content → chmod-back between snapshot and compare and
  // the digest would be identical. An unverifiable file must abort the snapshot instead.
  const nested = join(repo, 'nested');
  mkdirSync(nested);
  git(nested, ['init']);
  const locked = join(nested, 'locked.txt');
  writeFileSync(locked, 'secret\n');
  chmodSync(locked, 0o000);
  let status = 0;
  try {
    execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    status = err.status;
  } finally {
    chmodSync(locked, 0o644); // restore so the after() cleanup can remove it
  }
  assert.equal(status, 1, 'an unreadable descendant must fail-closed, not record a constant marker');
});

test('run-verify snapshot: unreadable IGNORED directory → fail-closed exit 1 (ls-files silent-omit hole)', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root bypasses directory permissions' : false }, () => {
  // `git ls-files --others --ignored` walks the tree; on an UNREADABLE dir it prints
  // `warning: could not open directory ...` to stderr but EXITS 0, silently OMITTING that subtree.
  // execFileSync discards stderr on success, so a plain git() read looks complete → fail-OPEN: a
  // worker owning the dir can unlock → mutate a file inside → re-lock, and both snapshots hash the
  // same (omitted) listing → {ok:true}. gitEnumerate captures stderr and treats the warning as a
  // snapshot failure. Non-tautology: with the old git() call this snapshot succeeds (exit 0).
  const { repo } = createRepo();
  writeFileSync(join(repo, '.gitignore'), 'cache/\n');
  const cache = join(repo, 'cache');
  mkdirSync(cache);
  writeFileSync(join(cache, 'blob.bin'), 'payload\n');
  chmodSync(cache, 0o000); // unreadable → git cannot enumerate its ignored contents
  let status = 0;
  try {
    execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    status = err.status;
  } finally {
    chmodSync(cache, 0o755); // restore so the after() cleanup can remove it
  }
  assert.equal(status, 1, 'an un-enumerable ignored directory is unverifiable → must fail-closed');
});

test('run-verify: creating an EMPTY ignored directory drifts ignored_dirs_sha256 (Codex iter-14 P2)', () => {
  // `ls-files -o -i` lists ignored FILES only; an EMPTY ignored dir has no leaf → invisible to
  // ignored_content, and porcelain -uall never lists ignored/empty dirs. A worker creating an empty
  // ignored dir post-snapshot would pass the "zero filesystem change" proof → mutation hole. The
  // `ls-files --directory` dir-node digest collapses each ignored dir to a `dir/` node (empty ones
  // included) so the new node drifts ignored_dirs_sha256. Non-tautology: dropping ignored_dirs_sha256
  // from COMPARE_FIELDS (or the enumeration) makes the empty-dir creation invisible → {ok:true} exit 0.
  const { base, repo } = createRepo();
  writeFileSync(join(repo, '.gitignore'), 'scratch/\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore scratch']);
  const { baselinePath } = snapshotToFile(base, repo);
  mkdirSync(join(repo, 'scratch')); // empty ignored dir — no files inside, so ignored_content is unchanged
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'creating an empty ignored dir must be detected as drift');
  assert.ok(driftFields(result).includes('ignored_dirs_sha256'), 'the drift must land on the ignored dir-node digest');
});

test('run-verify: creating a gitignored BUILD dir (build/dist/.venv…) does NOT drift ignored_dirs_sha256 (Codex iter-18 P2)', () => {
  // `ls-files --directory` leaks the collapsed `build/` node even though `:(exclude)build/` is in
  // IGNORE_EXCLUDE_PATHSPECS — git applies the pathspec to the file-level list but NOT to the collapsed
  // dir node (verified: file-level list is empty for an excluded dir, dir-level still yields its node).
  // Without the isVolumeExcludedDir filter, a build tool creating build/ mid-run would drift
  // ignored_dirs_sha256 → a spurious fail-closed on ordinary concurrent build/env activity. Direct
  // contrast with the `scratch/` test above, which is NOT an excluded root and MUST still drift.
  // Non-tautology: dropping the isVolumeExcludedDir filter makes the build/ node visible again →
  // exitCode 1 with an ignored_dirs_sha256 drift.
  const { base, repo } = createRepo();
  writeFileSync(join(repo, '.gitignore'), 'build/\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore build']);
  const { baselinePath } = snapshotToFile(base, repo);
  mkdirSync(join(repo, 'build')); // an excluded high-volume root appears post-snapshot…
  writeFileSync(join(repo, 'build', 'out.o'), 'obj\n'); // …with churn inside it
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'churn in an excluded build tree must NOT be detected as drift');
  assert.deepEqual(result.output, { ok: true }, 'no field may drift when only an excluded build tree changes');
});

test('run-verify: creating a NESTED node_modules dir (monorepo npm install) does NOT drift ignored_dirs_sha256 (Codex iter-19 P2)', () => {
  // `ls-files --directory` leaks the collapsed `packages/a/node_modules/` node past BOTH the
  // `:(glob,exclude)**/node_modules/**` and `:(exclude)node_modules/` pathspecs (verified). After the
  // trailing slash is stripped, `packages/a/node_modules` fails `p.includes('/node_modules/')` — there
  // is no slash AFTER node_modules — so without the `endsWith('/node_modules')` arm of
  // isControlPlaneIgnored an ordinary `npm install` in a monorepo package mid-run would drift
  // ignored_dirs_sha256 → a spurious fail-closed, contradicting the stated any-depth exclusion.
  // Non-tautology: dropping that arm makes the nested node_modules node visible again → exitCode 1.
  const { base, repo } = createRepo();
  mkdirSync(join(repo, 'packages', 'a'), { recursive: true });
  writeFileSync(join(repo, 'packages', 'a', 'index.js'), 'module.exports = 1;\n'); // keeps packages/a tracked+traversable
  writeFileSync(join(repo, '.gitignore'), '**/node_modules/\n');
  git(repo, ['add', '.gitignore', 'packages/a/index.js']);
  git(repo, ['commit', '-m', 'monorepo package a']);
  const { baselinePath } = snapshotToFile(base, repo);
  mkdirSync(join(repo, 'packages', 'a', 'node_modules')); // npm install appears mid-run…
  writeFileSync(join(repo, 'packages', 'a', 'node_modules', 'dep.js'), 'exports.x = 1;\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'a nested node_modules install must NOT be detected as drift (any-depth exclusion)');
  assert.deepEqual(result.output, { ok: true }, 'no field may drift when only a nested node_modules appears');
});

test('run-verify: chmod of a pre-existing EMPTY ignored directory drifts ignored_dirs_sha256 (mode fold)', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root chmod still observable, but keep parity with other perm tests' : false }, () => {
  // The dir-node digest folds each node's own mode (& 0o7777), so a chmod of an empty ignored dir
  // whose CONTENTS never change (there are none) still drifts — the case ignored_content and the
  // leaf-ancestor mode folding both miss (no leaf). Non-tautology: without the mode in the digest
  // (path-only) the chmod would be invisible → {ok:true} exit 0.
  const { base, repo } = createRepo();
  writeFileSync(join(repo, '.gitignore'), 'scratch/\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore scratch']);
  const scratch = join(repo, 'scratch');
  mkdirSync(scratch, 0o755); // empty ignored dir present at BASELINE time
  const { baselinePath } = snapshotToFile(base, repo);
  chmodSync(scratch, 0o700); // mode-only change; no file created/removed inside
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a chmod of an empty ignored dir must be detected as drift');
  assert.ok(driftFields(result).includes('ignored_dirs_sha256'), 'the mode change must land on the ignored dir-node digest');
});

test('run-verify: a newline-named nested ignored dir does NOT alias the two-dir state (NUL-separator injectivity, strict iter-15 P2 false-positive)', () => {
  // strict iter-15 filed a P2 claiming hashIgnoredDirNodes' `entries.join('\n')` lets a dir named
  // `a/ 700\nb` alias the two-dir state {`a/`(700), `b/`(700)} — both "serializing" to `a/ 700\nb/ 700`.
  // That reads the per-entry separator as a SPACE. It is not: the source is `path<NUL>mode` (a literal
  // 0x00, which `cat`/most viewers render as a blank, so on a skim it looks like a space). Because a
  // path can never contain a NUL and a mode is pure octal, every entry holds EXACTLY one NUL, so
  // NUL-count == entry-count and the join is injective — a 1-dir state (1 NUL) can never equal a
  // 2-dir state (2 NULs). This test pins that: the newline-named nested dir (repo B, the exact name
  // the P2 hypothesized) and the two-root-dir set (repo A) MUST produce DIFFERENT ignored_dirs_sha256,
  // proving the hypothesized alias does not occur with the real NUL separator. That is why the P2 was
  // dismissed and the shipped `entries.join('\n')` kept (no frameParts change warranted).
  // Repo A: two root-level ignored empty dirs a/(700) b/(700).
  const A = createRepo();
  writeFileSync(join(A.repo, '.gitignore'), 'a/\nb/\n');
  git(A.repo, ['add', '.gitignore']);
  git(A.repo, ['commit', '-m', 'ignore a/ b/']);
  for (const d of ['a', 'b']) mkdirSync(join(A.repo, d), 0o700);
  const snapA = snapshotToFile(A.base, A.repo).baseline;

  // Repo B: ONE nested ignored empty dir at path `a/ 700\nb/` (mode 700). `a` is traversable via a
  // tracked file; the newline-named empty subdir is ignored via a wildcard (a '\n' can't be written
  // as a literal .gitignore pattern — patterns are line-based — so `a/*/` matches the subdir instead).
  const B = createRepo();
  writeFileSync(join(B.repo, '.gitignore'), 'a/*/\n');
  mkdirSync(join(B.repo, 'a'));
  writeFileSync(join(B.repo, 'a', 'keep.txt'), 'hi\n'); // keeps `a` tracked+traversable, not collapsed
  mkdirSync(join(B.repo, 'a', ' 700\nb'), 0o700);        // the newline-named ignored empty dir the P2 named
  git(B.repo, ['add', '.gitignore', 'a/keep.txt']);
  git(B.repo, ['commit', '-m', 'ignore a subdirs']);
  const snapB = snapshotToFile(B.base, B.repo).baseline;

  // The NUL separator keeps join() injective, so the two states are distinguished. Verified
  // empirically that these digests already differ under the shipped `entries.join('\n')`
  // (422f… vs ef4d…) — the claimed space-separator collision is unreachable at runtime.
  assert.notEqual(snapA.ignored_dirs_sha256, snapB.ignored_dirs_sha256, 'a newline-named nested ignored dir must NOT alias the two-root-dir state (NUL-separated entries keep join injective)');
});

test('run-verify snapshot: unreadable global excludesFile → NO spurious drift (dir-scoped warning filter)', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root bypasses file permissions' : false }, () => {
  // strict iter-13 P2: `git ls-files --others` warns `unable to access '<excludesFile>': Permission
  // denied` when a global core.excludesFile is unreadable (root-owned / mode-600 in a
  // container/CI/restricted-HOME), yet EXITS 0 and enumerates the tree COMPLETELY. gitEnumerate's
  // unreadable-dir filter must NOT treat this benign, NON-directory warning as an incomplete
  // enumeration — otherwise snapshot() fails closed and the whole orchestration reports drift on a
  // genuinely clean tree, defeating the verifier. Non-tautology: the prior over-broad regex (bare
  // `permission denied` / `unable to access`) matched this warning → snapshot exited 1; the
  // "open directory"-scoped regex lets it succeed (exit 0). NOTE: this path has no "director"
  // substring, so it does NOT exercise the strict iter-14 over-match — the sibling test below does.
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'untracked.txt'), 'hello\n'); // proves the tree IS walked
  const excludes = join(base, 'gitexcludes');
  writeFileSync(excludes, '*.log\n');
  git(repo, ['config', '--local', 'core.excludesFile', excludes]);
  chmodSync(excludes, 0o000); // git warns "unable to access ... Permission denied" but exits 0
  let status = 0;
  try {
    execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    status = err.status || 1;
  } finally {
    chmodSync(excludes, 0o644); // restore for after() cleanup
  }
  assert.equal(status, 0, 'a benign unreadable-excludesFile warning (tree fully enumerated) must NOT fail-closed');
});

test('run-verify snapshot: unreadable excludesFile whose PATH contains "directory" → NO spurious drift (open-directory scope)', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root bypasses file permissions' : false }, () => {
  // strict iter-14 P2 + Nit: git emits `warning: unable to access '<path>': Permission denied` for an
  // unreadable excludesFile, and when <path> itself contains "directory"/"director", a
  // `warning:[^\n]*director` catch-all (the prior iter-13 regex) FIRES on this benign, tree-complete
  // warning → snapshot fails closed → spurious drift on a genuinely clean tree. The excludesFile here
  // lives under `.../my-directory/` precisely to put "directory" in the warning's path. The fix scopes
  // the catch-all to the PHRASE "open directory", which `unable to access '<path>'` never contains
  // regardless of path content, so snapshot must exit 0.
  // Non-tautology: reverting the regex to `warning:[^\n]*director` makes this snapshot exit 1 (the
  // path-substring "directory" matches), failing the assertion; the "open directory" scope passes it.
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'untracked.txt'), 'hello\n'); // proves the tree IS walked
  const excludesDir = join(base, 'my-directory');
  mkdirSync(excludesDir);
  const excludes = join(excludesDir, 'gitexcludes');
  writeFileSync(excludes, '*.log\n');
  git(repo, ['config', '--local', 'core.excludesFile', excludes]);
  chmodSync(excludes, 0o000); // warning: unable to access '.../my-directory/gitexcludes': Permission denied
  let status = 0;
  try {
    execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    status = err.status || 1;
  } finally {
    chmodSync(excludes, 0o644); // restore for after() cleanup
  }
  assert.equal(status, 0, 'a benign excludesFile warning whose path contains "directory" must NOT fail-closed');
});

test('run-verify snapshot: unreadable excludesFile whose PATH contains "open directory" → NO spurious drift (stem-anchored catch-all)', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root bypasses file permissions' : false }, () => {
  // strict iter-15 Nit: the earlier catch-all `warning:[^\n]*open directory` matched the PHRASE
  // anywhere on the line, so a benign `warning: unable to access '<path>': Permission denied` whose
  // <path> LITERALLY contained "open directory" (an absurd but legal dir name) would fail-fire →
  // spurious fail-closed on a fully-enumerated, clean tree. The fix anchors the catch-all to the
  // message STEM by forbidding a quote before the phrase (`warning:[^']*open directory`): in a real
  // dir-omission warning "open directory" precedes the path quote, but here it sits AFTER the quote,
  // so `[^']*` stops at the quote and never reaches it → snapshot exits 0. The excludesFile lives
  // under `.../open directory/` precisely to put "open directory" in the warning's PATH.
  // Non-tautology: reverting the regex to `warning:[^\n]*open directory` makes this snapshot exit 1
  // (the path-substring "open directory" matches past the quote), failing the assertion.
  const { base, repo } = createRepo();
  writeFileSync(join(repo, 'untracked.txt'), 'hello\n'); // proves the tree IS walked
  const excludesDir = join(base, 'open directory'); // literal phrase in the path
  mkdirSync(excludesDir);
  const excludes = join(excludesDir, 'gitexcludes');
  writeFileSync(excludes, '*.log\n');
  git(repo, ['config', '--local', 'core.excludesFile', excludes]);
  chmodSync(excludes, 0o000); // warning: unable to access '.../open directory/gitexcludes': Permission denied
  let status = 0;
  try {
    execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    status = err.status || 1;
  } finally {
    chmodSync(excludes, 0o644); // restore for after() cleanup
  }
  assert.equal(status, 0, 'a benign excludesFile warning whose path contains "open directory" must NOT fail-closed');
});

test('run-verify snapshot: corrupt .git/config → fail-closed exit 1 (unverifiable repo is drift)', () => {
  const { base, repo } = createRepo();
  // A malformed config makes git reads exit non-zero (in practice the very first
  // call, `rev-parse HEAD`); snapshot must fail-closed on any git failure rather
  // than emit a partial/blank baseline. General corrupt-repo guard — it does not
  // isolate the localConfig line, whose swallow-to-'' catch was removed for the
  // same fail-closed reason.
  writeFileSync(join(repo, '.git', 'config'), '[unterminated section\n');
  let status = 0;
  try {
    execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8' });
  } catch (err) {
    status = err.status;
  }
  assert.equal(status, 1, 'an unverifiable (corrupt) repo must fail-closed');
});

test('run-verify compare: in-place rewrite of an untracked control-plane state file → no drift (untracked-side isControlPlaneIgnored)', () => {
  const { base, repo } = createRepo();
  // The hooks own .claude_review_state.json and rewrite it DURING an orchestrate run. When it
  // is present at snapshot time its porcelain line stays "?? .claude_review_state.json" across
  // an in-place content rewrite (porcelain blind spot — same class as the pre-existing-untracked
  // -edit test above), so only untracked_content would catch it. Filtering the control plane out
  // of untrackedPaths (mirroring the ignored side) means a legitimate hook rewrite of its own
  // safety plane does not read as worker drift. NOT gitignored here on purpose, to isolate the
  // untracked-side filter from the .gitignore-glob layer. Without the untrackedPaths filter this
  // A→B rewrite trips untracked_content_sha256 → exit 1 (the non-tautology anchor).
  writeFileSync(join(repo, '.claude_review_state.json'), '{"session_id":"a","has_code_change":false}\n');
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'a stable control-plane file must not self-drift');
  writeFileSync(join(repo, '.claude_review_state.json'), '{"session_id":"a","has_code_change":true}\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'a hook rewriting its own state plane in place must not trip the verifier');
});

test('run-verify compare: in-place rewrite of an untracked .blocked sibling → no drift (prefix match, not exact)', () => {
  const { base, repo } = createRepo();
  // isControlPlaneIgnored matches by PREFIX, so the .blocked / .lockdir / .XXXXXX siblings that a
  // bare `.claude_review_state.json` .gitignore line does NOT cover are still dropped from the
  // untracked side. Rewriting the sibling in place (stable porcelain "?? …") must not drift —
  // this exercises the startsWith branch that the exact-match ignore rule would miss.
  writeFileSync(join(repo, '.claude_review_state.json.blocked'), 'v1\n');
  const { baselinePath } = snapshotToFile(base, repo);
  writeFileSync(join(repo, '.claude_review_state.json.blocked'), 'v2\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 0, 'a control-plane sibling rewrite must not trip the verifier (prefix filter)');
});

test('run-verify compare: in-place rewrite of a stem-EXTENSION path (.claude_review_state.jsonX/…) → drift (separator-anchored filter)', () => {
  const { base, repo } = createRepo();
  // isControlPlaneIgnored anchors the file-prefix match to a `.`/`/` separator, so a path that
  // merely SHARES the leading characters (`.claude_review_state.jsonX/evil.js` — NOT a real
  // safety-plane sibling) is not excluded. A bare startsWith would have silently hidden a
  // mutation here. Not gitignored in this repo, and an in-place rewrite keeps porcelain stable,
  // so only untracked_content catches it — isolating the separator anchoring. Without the anchor
  // this A→B rewrite is filtered out → exit 0 (the non-tautology anchor).
  const dir = join(repo, '.claude_review_state.jsonX');
  mkdirSync(dir);
  writeFileSync(join(dir, 'evil.js'), 'module.exports = 1;\n');
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'a stable stem-extension path must not self-drift');
  writeFileSync(join(dir, 'evil.js'), 'module.exports = 2;\n');
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'a stem-extension path is not the safety plane — its mutation must drift');
  assert.ok(driftFields(result).includes('untracked_content_sha256'), 'the un-excluded path must be in the untracked digest');
});

test('run-verify compare: substituted post-mutation baseline is refused, not accepted as clean', () => {
  // The attack the digest binding exists to stop. A worker mutates the repo, then re-runs
  // `snapshot` and hands THAT as the baseline. Field-by-field it matches the repo perfectly, so
  // without an identity check the drift reads as `ok: true` and the SC-2 no-change proof is void.
  const { base, repo } = createRepo();
  const { digest: realDigest } = snapshotToFile(base, repo);

  writeFileSync(join(repo, 'service.js'), 'module.exports = "mutated";\n');

  // Re-snapshot AFTER the mutation and plant it as the baseline.
  const forged = execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8' });
  const forgedPath = join(base, 'forged.json');
  writeFileSync(forgedPath, forged);

  // Sanity: the forgery genuinely matches the mutated repo — it is only the digest that stops it.
  const unbound = compare(repo, forgedPath);
  assert.equal(unbound.exitCode, 0, 'precondition: a post-mutation re-snapshot self-consistently reports clean');

  const bound = compare(repo, forgedPath, realDigest);
  assert.equal(bound.exitCode, 1, 'the pre-dispatch digest must reject the substituted baseline');
  assert.match(bound.stderr, /digest mismatch/, 'the refusal must name the reason, not read as ordinary drift');
});

test('run-verify compare: a single altered byte in the baseline is refused', () => {
  const { base, repo } = createRepo();
  const { baselinePath, digest } = snapshotToFile(base, repo);

  // Flip the recorded HEAD so the baseline would excuse a later commit. Byte-exact digesting
  // catches it regardless of whether the edit is semantically meaningful.
  //
  // Replace with a DIFFERENT digit rather than a fixed one. Substituting a constant `0` is a
  // 1-in-16 no-op — when the commit sha already begins with `0` the "tampered" baseline is
  // byte-identical, the digest matches, and this test fails for a reason that has nothing to do
  // with the code under test. Observed live; the sha is random per run, so it flaked roughly
  // every sixteenth execution.
  const original = readFileSync(baselinePath, 'utf8');
  const tampered = original.replace(/("head": ")([0-9a-f])/, (_m, prefix, c) => prefix + (c === '0' ? '1' : '0'));
  assert.notEqual(tampered, original, 'the tamper must actually change a byte, or this proves nothing');
  writeFileSync(baselinePath, tampered);

  const result = compare(repo, baselinePath, digest);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /digest mismatch/);
});

test('run-verify snapshot: prints the binding digest of its own stdout bytes to stderr', () => {
  const { repo } = createRepo();
  const r = require('node:child_process').spawnSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8' });
  assert.equal(r.status, 0);

  const m = r.stderr.match(/baseline_sha256=([0-9a-f]{64})/);
  assert.ok(m, `stderr must carry the digest, got: ${r.stderr}`);
  assert.equal(m[1], digestOf(r.stdout), 'the advertised digest must be of the exact stdout bytes');
  assert.equal(/baseline_sha256/.test(r.stdout), false, 'the digest must stay OUT of stdout — it would change what it digests');
});

test('run-verify compare: missing or malformed --baseline-sha256 fails closed', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);

  const cases = [
    { args: ['compare', '--baseline', baselinePath, '--repo', repo], why: 'omitted digest' },
    { args: ['compare', '--baseline', baselinePath, '--baseline-sha256', 'deadbeef', '--repo', repo], why: 'too short' },
    { args: ['compare', '--baseline', baselinePath, '--baseline-sha256', 'Z'.repeat(64), '--repo', repo], why: 'non-hex' },
    { args: ['compare', '--baseline', baselinePath, '--baseline-sha256', digestOf('x').toUpperCase(), '--repo', repo], why: 'uppercase hex' },
  ];
  for (const { args, why } of cases) {
    let status = 0;
    let stderr = '';
    try {
      execFileSync('node', [scriptPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      status = err.status;
      stderr = (err.stderr || '').toString();
    }
    assert.equal(status, 1, `expected fail-closed for ${why}`);
    assert.match(stderr, /FAIL-CLOSED/, `expected controlled refusal for ${why}`);
  }
});

test('run-verify: unknown command, missing baseline flag, non-repo dir all fail closed', () => {
  const { base, repo } = createRepo();
  const cases = [
    ['rollback', '--repo', repo],
    ['compare', '--repo', repo],
    ['snapshot', '--repo', join(base, 'not-a-repo')],
  ];
  for (const args of cases) {
    let status = 0;
    try {
      execFileSync('node', [scriptPath, ...args], { encoding: 'utf8' });
    } catch (err) {
      status = err.status;
    }
    assert.equal(status, 1, `expected fail-closed exit 1 for: ${args.join(' ')}`);
  }
});

test('run-verify snapshot: untracked non-UTF-8 filename → fail-closed exit 1 (no constant GONE fail-open)', (t) => {
  const { repo } = createRepo();
  // A filename carrying an invalid UTF-8 byte (0xFF). `git ls-files -z` emits the raw bytes, but
  // run-verify's git() decodes stdout as 'utf8', so the byte collapses to U+FFFD and the mangled
  // path lstat-fails. The pre-fix catch recorded a CONSTANT `GONE` marker (fail-OPEN): the marker
  // is identical at snapshot AND compare, so a later content mutation of this file drifts in
  // NEITHER porcelain (it re-quotes the path unchanged) NOR untracked_content → compare wrongly
  // returns {ok:true}. The fix throws instead, routing snapshot() to its fail-closed catch (exit 1).
  // Non-tautology anchor: under the old GONE marker this snapshot exits 0.
  // macOS APFS (and other UTF-8-enforcing filesystems) reject non-UTF-8 names outright, so skip
  // where the FS will not hold the fixture rather than assert on an environment it cannot create.
  const badPath = Buffer.concat([
    Buffer.from(`${repo}/`),
    Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x74, 0x78, 0x74]), // "bad\xFF.txt"
  ]);
  try {
    writeFileSync(badPath, 'payload\n');
  } catch (e) {
    t.skip(`filesystem rejects non-UTF-8 filenames (${e.code || e.message})`);
    return;
  }
  try {
    // Sanity: git must actually surface the raw 0xFF byte as an untracked entry, else the test
    // would prove nothing. Read as raw bytes so the test harness does not itself mangle the name.
    const listing = execFileSync('git', ['-C', repo, 'ls-files', '--others', '--exclude-standard', '-z'], {
      encoding: 'buffer',
    });
    if (!listing.includes(0xff)) {
      t.skip('git did not surface the non-UTF-8 byte in ls-files output');
      return;
    }
    let status = 0;
    let stderr = '';
    try {
      execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      status = err.status;
      stderr = (err.stderr || '').toString();
    }
    assert.equal(status, 1, 'a non-UTF-8 untracked filename must fail-closed, not record a constant GONE marker');
    assert.match(stderr, /unresolvable ls-files path|FAIL-CLOSED/);
  } finally {
    // Remove the fixture by its exact byte name — rmSync in after() reads dir entries as UTF-8
    // strings (U+FFFD), so an unlink of the decoded name would ENOENT and leave the tree non-empty.
    try {
      unlinkSync(badPath);
    } catch {
      /* best-effort */
    }
  }
});

test('run-verify compare: retargeting an untracked symlink between two non-UTF-8 targets → drift (raw-byte target hash)', () => {
  const { base, repo } = createRepo();
  // readlinkSync's default utf8 decoding maps distinct invalid-byte targets (…0xff vs …0xfe) to the
  // SAME U+FFFD, so hashing the decoded STRING would leave the digest unchanged across a retarget
  // (fail-OPEN). Hashing the raw Buffer target drifts. The symlink NAME stays valid UTF-8 so every
  // filesystem (incl. APFS) accepts it; only the TARGET carries the bad bytes. Non-tautology anchor:
  // under the old string-decoded hash this retarget produces no drift → exit 0.
  const link = join(repo, 'link');
  symlinkSync(Buffer.from([0x74, 0x67, 0x74, 0xff]), link); // → "tgt\xFF"
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).exitCode, 0, 'a stable symlink must not self-drift');
  unlinkSync(link);
  symlinkSync(Buffer.from([0x74, 0x67, 0x74, 0xfe]), link); // → "tgt\xFE" (same U+FFFD when utf8-decoded)
  const result = compare(repo, baselinePath);
  assert.equal(result.exitCode, 1, 'retarget between two non-UTF-8 targets must drift (raw-byte hash)');
  assert.ok(driftFields(result).includes('untracked_content_sha256'), 'the symlink target change lands in the untracked digest');
});

test('run-verify snapshot: non-UTF-8-named symlink inside an embedded repo → fail-closed (hashDirRecursive symlink branch)', (t) => {
  const { repo } = createRepo();
  // An embedded repo is listed by git as a single `nested/` untracked entry, so hashDirRecursive
  // walks its contents. A symlink there with a non-UTF-8 NAME is mangled to U+FFFD by the utf8
  // readdir; readlink(child) then hits ENOENT and THROWS (no constant UNREADABLE marker), so the
  // snapshot fails closed. macOS APFS rejects non-UTF-8 filenames, so skip where the FS won't hold
  // the fixture. Non-tautology anchor: the pre-fix branch swallowed readlink errors → exit 0.
  const nested = join(repo, 'nested');
  mkdirSync(nested);
  git(nested, ['init']);
  writeFileSync(join(nested, 'keep.txt'), 'x\n');
  const badLink = Buffer.concat([Buffer.from(`${nested}/`), Buffer.from([0x62, 0x61, 0x64, 0xff])]); // "bad\xFF"
  try {
    symlinkSync('some-target', badLink);
  } catch (e) {
    t.skip(`filesystem rejects non-UTF-8 filenames (${e.code || e.message})`);
    return;
  }
  try {
    let status = 0;
    try {
      execFileSync('node', [scriptPath, 'snapshot', '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      status = err.status;
    }
    assert.equal(status, 1, 'a non-UTF-8-named symlink in an embedded repo must fail-closed, not record UNREADABLE');
  } finally {
    try {
      unlinkSync(badLink);
    } catch {
      /* best-effort */
    }
  }
});

test('CRLF rewrite of an ignored file under `* text=auto` is detected as drift (hash-object --no-filters)', () => {
  // Content mutation that reports clean. `git hash-object` WITHOUT --no-filters applies the path's
  // clean filter and EOL conversion before hashing, so under an ordinary `* text=auto` attribute an
  // LF->CRLF rewrite produces the SAME object id. For an ignored file nothing else contradicts it:
  // `status --porcelain` still prints `!! secrets.env` (or nothing) and the mode is untouched, so
  // the verifier returned {"ok": true} after a real filesystem write. Not covered by the documented
  // symlink-follow residual_risk in admission-allowlist.json.
  const { base, repo } = createRepo();
  writeFileSync(join(repo, '.gitattributes'), '* text=auto\n');
  writeFileSync(join(repo, '.gitignore'), 'secrets.env\n');
  git(repo, ['add', '.gitattributes', '.gitignore']);
  git(repo, ['commit', '-m', 'attrs']);
  const ignored = join(repo, 'secrets.env');
  writeFileSync(ignored, 'TOKEN=abc\nMODE=readonly\n');

  const { baselinePath } = snapshotToFile(base, repo);
  // Same logical content, CRLF line endings — the clean filter normalizes this back to LF.
  writeFileSync(ignored, 'TOKEN=abc\r\nMODE=readonly\r\n');
  const result = compare(repo, baselinePath);

  assert.equal(result.output.ok, false, 'a byte-level rewrite of an ignored file must be reported as drift');
  assert.notEqual(result.exitCode, 0, 'drift must exit non-zero');
});

test('identical bytes still report clean under `* text=auto` (--no-filters is not over-sensitive)', () => {
  // Over-firing guard: --no-filters must not turn an untouched tree into permanent drift.
  const { base, repo } = createRepo();
  writeFileSync(join(repo, '.gitattributes'), '* text=auto\n');
  writeFileSync(join(repo, '.gitignore'), 'secrets.env\n');
  git(repo, ['add', '.gitattributes', '.gitignore']);
  git(repo, ['commit', '-m', 'attrs']);
  writeFileSync(join(repo, 'secrets.env'), 'TOKEN=abc\nMODE=readonly\n');

  const { baselinePath } = snapshotToFile(base, repo);
  const result = compare(repo, baselinePath);

  assert.equal(result.output.ok, true, 'an untouched tree must stay clean');
  assert.equal(result.exitCode, 0);
});

test('a repo-local diff textconv driver is NOT executed during snapshot (config-injection guard)', () => {
  // The verifier runs git against a repository it does not trust, and git reads that repo's own
  // config/attributes — several entries of which are commands git EXECUTES. A `.gitattributes`
  // `* diff=<driver>` plus a local `diff.<driver>.textconv` runs an arbitrary program during
  // `git diff HEAD --binary`. Verified on this host: the sentinel file appears without
  // `--no-textconv` and does not with it. Arbitrary execution inside the verifier is fatal to its
  // purpose — a program that runs before the snapshot completes can hide the mutation the snapshot
  // exists to detect. Local-scope config tampering BETWEEN snapshot and compare is caught by
  // `local_config_sha256`, not by gitInternalsDigest (which hashes the hooks dir and
  // .git/info/exclude, never a config file) — and config already present at snapshot time is
  // invisible to both, which is why the guard is a `-c` override rather than detection.
  const { base, repo } = createRepo();
  const sentinel = join(base, 'TEXTCONV_RAN');
  writeFileSync(join(repo, '.gitattributes'), '* diff=evil\n');
  git(repo, ['config', 'diff.evil.textconv', `sh -c 'touch ${sentinel}; cat'`]);
  // diff HEAD only invokes a textconv driver when a TRACKED file actually differs.
  writeFileSync(join(repo, 'service.js'), 'module.exports = { fee: 31 };\n');

  snapshotToFile(base, repo);

  assert.equal(
    existsSync(sentinel),
    false,
    'the repo-supplied textconv command must never run inside the verifier'
  );
});

test('a repo-local core.fsmonitor program is NOT executed during snapshot (config-injection guard)', () => {
  // Broader than textconv: core.fsmonitor runs on status, ls-files, AND diff — i.e. most calls the
  // verifier makes, including the enumeration the drift proof rests on. Verified on this host: the
  // sentinel appears without `-c core.fsmonitor=false` and does not with it.
  const { base, repo } = createRepo();
  const sentinel = join(base, 'FSMONITOR_RAN');
  const hook = join(base, 'fsmonitor-hook.sh');
  writeFileSync(hook, `#!/bin/sh\ntouch ${sentinel}\nprintf '/\\0'\n`);
  chmodSync(hook, 0o755);
  git(repo, ['config', 'core.fsmonitor', hook]);
  git(repo, ['config', 'core.untrackedCache', 'true']);

  snapshotToFile(base, repo);

  assert.equal(
    existsSync(sentinel),
    false,
    'the repo-supplied fsmonitor program must never run inside the verifier'
  );
});

test('chmod of the .git/hooks DIRECTORY itself → git_internals drift (dir node was unhashed)', () => {
  // The digest covered `hooks/<name>` entries but never `hooks/` as a node, so a chmod of the
  // directory produced an identical digest. 0755→0700 keeps it owner-readable, so readdir still
  // succeeds and the fail-closed unreadable-dir path never fires — the change was simply invisible.
  const { base, repo } = createRepo();
  const hooksDir = join(repo, '.git', 'hooks');
  const { baselinePath } = snapshotToFile(base, repo);
  chmodSync(hooksDir, 0o700);
  const result = compare(repo, baselinePath);
  chmodSync(hooksDir, 0o755); // restore so `after()` can clean up
  assert.equal(result.output.ok, false, 'a chmod of the hooks directory must drift');
  assert.ok(
    result.output.drift.some((d) => /git_internals/.test(d.field || d)),
    `expected git_internals drift, got ${JSON.stringify(result.output.drift)}`
  );
});

// =============================================================================
// tracked_modes / untracked_dirs — the two planes git itself cannot see
// =============================================================================

// A repo with a tracked file inside a tracked subdirectory, so both the file plane and the
// ancestor-directory plane have something to say.
function createNestedRepo() {
  const { base, repo } = createRepo();
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  writeFileSync(join(repo, 'src', 'deep', 'a.txt'), 'hi\n');
  git(repo, ['add', 'src/deep/a.txt']);
  git(repo, ['commit', '-m', 'nested']);
  return { base, repo };
}

test('run-verify: chmod of a TRACKED file drifts (git records only the exec bit)', () => {
  const { base, repo } = createNestedRepo();
  const { baselinePath } = snapshotToFile(base, repo);

  // Control: no mutation → clean. Without it every assertion below would hold against a verifier
  // that reports drift unconditionally.
  assert.equal(compare(repo, baselinePath).output.ok, true, 'control: an untouched tree must be clean');

  chmodSync(join(repo, 'src', 'deep', 'a.txt'), 0o666);
  const result = compare(repo, baselinePath);
  assert.equal(result.output.ok, false, 'chmod 666 on a tracked file must drift');
  assert.ok(
    result.output.drift.some((d) => d.field === 'tracked_modes_sha256'),
    `expected tracked_modes_sha256 drift, got ${result.output.drift.map((d) => d.field).join(',')}`
  );
  // Specifically NOT visible to the two planes that were supposed to prove the tracked tree.
  assert.ok(
    !result.output.drift.some((d) => d.field === 'porcelain_sha256' || d.field === 'tracked_diff_sha256'),
    'the point of this plane is that porcelain and the diff stay identical — if they drift, the test is not exercising the hole'
  );
});

test('run-verify: chmod of a TRACKED directory drifts', () => {
  const { base, repo } = createNestedRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).output.ok, true, 'control');

  chmodSync(join(repo, 'src', 'deep'), 0o777);
  const result = compare(repo, baselinePath);
  assert.equal(result.output.ok, false, 'a world-writable tracked directory must drift');
  assert.ok(
    result.output.drift.some((d) => d.field === 'tracked_modes_sha256'),
    `expected tracked_modes_sha256 drift, got ${result.output.drift.map((d) => d.field).join(',')}`
  );
  chmodSync(join(repo, 'src', 'deep'), 0o755);
});

test('run-verify: create/delete/chmod of an EMPTY untracked directory drifts', () => {
  const { base, repo } = createRepo();
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).output.ok, true, 'control');

  // `git status --porcelain -uall` never lists directories and `ls-files --others` yields leaves
  // only, so before untracked_dirs_sha256 an empty directory was invisible to every plane.
  mkdirSync(join(repo, 'keepme', 'sub'), { recursive: true });
  const created = compare(repo, baselinePath);
  assert.equal(created.output.ok, false, 'a new empty untracked directory must drift');
  assert.ok(
    created.output.drift.some((d) => d.field === 'untracked_dirs_sha256'),
    `expected untracked_dirs_sha256 drift, got ${created.output.drift.map((d) => d.field).join(',')}`
  );

  rmSync(join(repo, 'keepme'), { recursive: true, force: true });
  assert.equal(compare(repo, baselinePath).output.ok, true, 'removing it again must return to clean');

  mkdirSync(join(repo, 'newdir'));
  chmodSync(join(repo, 'newdir'), 0o777);
  const chmodded = compare(repo, baselinePath);
  assert.ok(
    chmodded.output.drift.some((d) => d.field === 'untracked_dirs_sha256'),
    'chmod of an untracked directory must drift too'
  );
});

test('run-verify: drift BENEATH an already-untracked parent is caught (the collapse, not the leaf)', () => {
  // Every untracked-dir test above starts from a baseline in which the parent does NOT exist, so
  // creating `keepme/sub` drifts because `keepme/` itself is new. That holds with or without
  // `expandUntrackedDirTree` — the recursion the function exists for is not exercised at all.
  //
  // The case that needs it is the ordinary one: the parent is ALREADY untracked at snapshot time.
  // `ls-files --others --directory` then collapses the whole tree to the single node `scratch/`,
  // porcelain never lists directories, and the untracked file scan yields leaves only — so without
  // the walk, `mkdir scratch/empty` moves no digest on any plane and the "zero filesystem change"
  // proof returns ok:true over a real mutation.
  const { base, repo } = createRepo();
  mkdirSync(join(repo, 'scratch', 'nested'), { recursive: true });
  writeFileSync(join(repo, 'scratch', 'file.txt'), 'x\n');
  writeFileSync(join(repo, 'scratch', 'nested', 'y.txt'), 'y\n');
  const { baselinePath } = snapshotToFile(base, repo);

  // Precondition: git really does collapse this tree to one node, or the test is measuring nothing.
  assert.equal(
    git(repo, ['ls-files', '--others', '--directory', '--exclude-standard']).split('\n').filter(Boolean).join(','),
    'scratch/',
    'the fixture must be the COLLAPSED shape — if git enumerates the subtree, the walk is not what is under test'
  );
  assert.equal(compare(repo, baselinePath).output.ok, true, 'control: an untouched tree must be clean');

  // An EMPTY directory: no file for the content plane to see, no porcelain entry, parent unchanged.
  mkdirSync(join(repo, 'scratch', 'nested', 'empty'));
  const created = compare(repo, baselinePath);
  assert.equal(created.output.ok, false, 'an empty dir created two levels under an untracked parent must drift');
  // Stated as the two facts that matter, not as an exact field list. `deepEqual` against a
  // single-element array also asserts a negative about all nine other planes, and one of those
  // negatives is not a property worth defending: if `untracked_content_sha256` were ever
  // strengthened to record empty directories too, that strictly BETTER verifier would turn this
  // test red for being right. What the fixture is actually isolating is that the dirs plane sees a
  // change no TRACKED plane can — so that is what is asserted.
  const createdFields = created.output.drift.map((d) => d.field);
  assert.ok(
    createdFields.includes('untracked_dirs_sha256'),
    `the dirs plane must see the empty directory, saw ${JSON.stringify(createdFields)}`
  );
  assert.ok(
    !createdFields.includes('tracked_diff_sha256'),
    `an empty untracked directory must not register as tracked drift, saw ${JSON.stringify(createdFields)}`
  );

  rmSync(join(repo, 'scratch', 'nested', 'empty'), { recursive: true });
  assert.equal(compare(repo, baselinePath).output.ok, true, 'removing it must return to clean');

  // chmod of a directory nested under the collapsed root: mode is folded per node by the walk.
  chmodSync(join(repo, 'scratch', 'nested'), 0o777);
  const chmodded = compare(repo, baselinePath);
  assert.ok(
    chmodded.output.drift.some((d) => d.field === 'untracked_dirs_sha256'),
    `chmod of a nested untracked dir must drift, got ${chmodded.output.drift.map((d) => d.field).join(',') || '(none)'}`
  );
  chmodSync(join(repo, 'scratch', 'nested'), 0o755);
});

test('run-verify: a baseline taken over a DELETED tracked path still drifts when it comes back', () => {
  // `hashTrackedModes` records `absent` for a path `ls-files` reports but lstat cannot resolve —
  // the sparse-checkout and deleted-from-worktree cases. Every tracked-modes test above snapshots a
  // COMPLETE worktree, so that branch is only ever reached on the COMPARE side. What is unpinned is
  // the branch running during `snapshot`, and the defect it fixed is not subtle: an ENOENT that
  // threw made a DIRTY starting tree unsnapshottable, and dirty starting trees are explicitly
  // supported (2-tech-spec.md). `git ls-files` reports the INDEX, so a tracked file deleted in the
  // worktree is listed and then fails to lstat — an ordinary state, not an error.
  //
  // Scope note, because the sentinel invites a stronger claim than it earns: the `absent` STRING is
  // not what makes the restore below drift. An omitted entry and a present one already digest
  // differently, so recording nothing would drift too — verified by mutation. The sentinel's job is
  // that `absent` cannot collide with a valid octal mode; what this test pins is the pair of
  // properties that actually have a failure mode, namely that the dirty baseline can be TAKEN and
  // that absent→mode is drift once it is.
  const { base, repo } = createNestedRepo();
  const target = join(repo, 'src', 'deep', 'a.txt');
  unlinkSync(target);

  // Precondition: git still TRACKS it, so the path reaches hashTrackedModes and takes the branch.
  assert.match(git(repo, ['ls-files']), /src\/deep\/a\.txt/, 'the deleted path must still be tracked');

  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).output.ok, true, 'control: a dirty baseline must still compare clean against itself');

  writeFileSync(target, 'hi\n');
  const restored = compare(repo, baselinePath);
  assert.equal(restored.output.ok, false, 'restoring the file must drift against a baseline that recorded it absent');
  assert.ok(
    restored.output.drift.some((d) => d.field === 'tracked_modes_sha256'),
    `tracked_modes must see absent→mode, got ${restored.output.drift.map((d) => d.field).join(',')}`
  );
});

// =============================================================================
// node_modules exclusion: a digest filter and a COST bound, not two digest filters
// =============================================================================

// The two mechanisms were described as redundant layers over the same property, and no test could
// tell them apart. They are not redundant — they act on different things:
//
//   IGNORE_EXCLUDE_PATHSPECS (git) suppresses the paths at ENUMERATION. It is the primary, and it
//                                is a COST bound as much as a filter: collecting first and
//                                filtering after still makes git serialize the whole dependency
//                                tree into execFileSync's buffer, which is the ENOBUFS this avoids.
//   isControlPlaneIgnored  (JS)  is the BACKSTOP for the same class, for the case where the
//                                pathspec is wrong. A pathspec is SILENT when wrong, so that case
//                                is real: dropping the trailing `/**` from the glob is accepted by
//                                git and matches nothing.
//
// Because the primary runs first, the backstop never sees a node_modules path in a healthy build —
// so removing it leaves every end-to-end assertion green. That is what a backstop looks like, not
// what dead code looks like, and it is why each is pinned on its own plane below rather than by one
// drift test that can only ever exercise the primary.
function createRepoWithNodeModules() {
  const { base, repo } = createRepo();
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-m', 'ignore node_modules']);
  mkdirSync(join(repo, 'node_modules', 'pkg'), { recursive: true });
  mkdirSync(join(repo, 'packages', 'a', 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
  writeFileSync(join(repo, 'packages', 'a', 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  return { base, repo };
}

test('run-verify: node_modules content stays out of the digest at any depth', () => {
  const { base, repo } = createRepoWithNodeModules();
  const { baselinePath } = snapshotToFile(base, repo);
  assert.equal(compare(repo, baselinePath).output.ok, true, 'control: an untouched tree must be clean');

  // A dependency install rewrites thousands of these; a monorepo does it per package. Both the
  // root and the NESTED tree must be outside the proof — the nested one is the case a root-anchored
  // prefix would have let through.
  writeFileSync(join(repo, 'node_modules', 'pkg', 'index.js'), 'module.exports = 2;\n');
  writeFileSync(join(repo, 'node_modules', 'pkg', 'new-file.js'), 'added\n');
  writeFileSync(join(repo, 'packages', 'a', 'node_modules', 'dep', 'index.js'), 'module.exports = 2;\n');
  const result = compare(repo, baselinePath);
  assert.equal(
    result.output.ok, true,
    `node_modules content must stay out of the digest, drifted: ${JSON.stringify(result.output.drift)}`
  );
});

test('run-verify: the git pathspecs actually suppress the node_modules listing (cost bound)', () => {
  // A pathspec is SILENT when wrong: `:(glob,exclude)**/node_modules` (missing the trailing `/**`)
  // is accepted by git and matches nothing, so the enumeration quietly goes back to serializing
  // every dependency file — invisible to every digest assertion, and the failure mode is an
  // ENOBUFS on someone else's large repo. The constant is read FROM THE SCRIPT rather than restated
  // here, so this pins the shipped value, not a copy of it.
  const src = readFileSync(scriptPath, 'utf8');
  const block = src.match(/const IGNORE_EXCLUDE_PATHSPECS = \[([\s\S]*?)\];/);
  assert.ok(block, 'IGNORE_EXCLUDE_PATHSPECS must still be a literal array');
  const pathspecs = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(pathspecs.length >= 5, `expected the shipped pathspec list, got ${pathspecs.length}`);

  const { repo } = createRepoWithNodeModules();
  const listing = (extra) =>
    git(repo, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', '.', ...extra]);

  // Control: WITHOUT the pathspecs git lists the dependency files — so a green below is the
  // pathspec working, not an empty repo.
  const unfiltered = listing([]);
  assert.match(unfiltered, /node_modules\/pkg\/index\.js/, 'control: git must list root node_modules files');
  assert.match(unfiltered, /packages\/a\/node_modules\/dep\/index\.js/, 'control: and nested ones');

  const filtered = listing(pathspecs);
  assert.doesNotMatch(filtered, /node_modules/, `the shipped pathspecs must suppress every node_modules path, got: ${filtered}`);
});

test('run-verify: the JS backstop independently classifies node_modules at any depth', () => {
  // Unit-level, because end-to-end cannot reach it: the git pathspec suppresses these paths before
  // the filter runs. Exercised directly, so a future "this branch is unreachable, delete it" edit —
  // which the green suite actively invites — turns this red instead of silently removing the only
  // thing standing between a mistyped pathspec and hashing a whole dependency tree.
  const { isControlPlaneIgnored, isNodeModulesDirNode } = require(scriptPath);

  for (const p of ['node_modules/pkg/index.js', 'packages/a/node_modules/dep/index.js']) {
    assert.equal(isControlPlaneIgnored(p), true, `${p} must be excluded from content hashing`);
  }
  // The leaf NODE is deliberately NOT matched here — a regular ignored FILE named `node_modules`
  // must still be hashed, which is what the two `iter-20`/`iter-21` tests above cover.
  for (const p of ['node_modules', 'packages/a/node_modules', 'pkg/node_modules']) {
    assert.equal(isControlPlaneIgnored(p), false, `${p} is a leaf name, not a path inside a tree`);
  }
  // The dir-node plane is the one that takes the leaf, and only there.
  assert.equal(isNodeModulesDirNode('node_modules'), true);
  assert.equal(isNodeModulesDirNode('packages/a/node_modules'), true);
  assert.equal(isNodeModulesDirNode('node_modules_backup'), false, 'a mere prefix is not a match');
  assert.equal(isNodeModulesDirNode('src'), false);
});
