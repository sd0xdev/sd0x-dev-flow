'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../scripts/detect-scope.js');
const tempDirs = [];

function createRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-detect-scope-'));
  tempDirs.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  return dir;
}

function writeAndCommit(dir, file, content, message) {
  const full = join(dir, file);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
  execFileSync('git', ['add', file], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

function runScript(cwd, args = []) {
  return spawnSync('node', [scriptPath, ...args], { cwd, encoding: 'utf8' });
}

after(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Layer 1: uncommitted
// ---------------------------------------------------------------------------

test('detects uncommitted changes → source=uncommitted confidence=high', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeFileSync(join(repo, 'new.js'), 'console.log(1);', 'utf8');
  writeFileSync(join(repo, 'README.md'), '# updated', 'utf8');

  const r = runScript(repo);
  assert.equal(r.status, 0, `exit code should be 0, got ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout);

  assert.equal(out.source, 'uncommitted');
  assert.equal(out.confidence, 'high');
  assert.equal(out.version, 1);
  assert.ok(out.files.length >= 1, 'should report at least one file');
  const paths = out.files.map(f => f.path);
  assert.ok(paths.includes('new.js') || paths.includes('README.md'));

  // Untracked file must be labeled as 'added', not 'modified' (P1-2 regression guard)
  const newFile = out.files.find(f => f.path === 'new.js');
  assert.ok(newFile, 'new.js should be in scope');
  assert.equal(newFile.change_type, 'added', `untracked 'new.js' must map to 'added', got '${newFile.change_type}'`);

  // lines_changed must expose total (source-guide.md contract) — non-zero for untracked
  assert.equal(typeof newFile.lines_changed.total, 'number', 'lines_changed.total required');
  assert.ok(newFile.lines_changed.total >= 1, `untracked file line count should be > 0, got ${newFile.lines_changed.total}`);
});

// ---------------------------------------------------------------------------
// Layer 2: branch fallback (clean tree, commits ahead of origin/main)
// ---------------------------------------------------------------------------

test('falls back to branch layer when worktree is clean → source=branch confidence=medium', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeAndCommit(repo, 'feat.js', 'module.exports = 1;', 'feat: add feature');
  // No uncommitted changes; HEAD~1 should be the fallback base
  const r = runScript(repo);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.source, 'branch');
  assert.equal(out.confidence, 'medium');
  const paths = out.files.map(f => f.path);
  assert.ok(paths.includes('feat.js'), `expected feat.js in ${paths.join(',')}`);
});

// ---------------------------------------------------------------------------
// Layer 3: session fallback via .claude_review_state.json
// ---------------------------------------------------------------------------

test('falls back to session layer when no git changes → source=session confidence=low', () => {
  const repo = createRepo();
  // Single commit (no HEAD~1), gitignore state file so no uncommitted + no branch diff
  writeFileSync(join(repo, '.gitignore'), '.claude_review_state.json\n', 'utf8');
  writeFileSync(join(repo, 'README.md'), '# init', 'utf8');
  execFileSync('git', ['add', '.gitignore', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repo });

  writeFileSync(
    join(repo, '.claude_review_state.json'),
    JSON.stringify({ recent_file_edits: ['foo.js', 'bar.md'] }),
    'utf8',
  );
  const r = runScript(repo);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.source, 'session', `expected session, got ${out.source}; stderr: ${r.stderr}`);
  assert.equal(out.confidence, 'low');
  const paths = out.files.map(f => f.path);
  assert.ok(paths.includes('foo.js') && paths.includes('bar.md'));
});

// The field the hooks actually write. Reading only `recent_file_edits` — which
// has no writer anywhere in the repo — made this layer return null every time,
// so the "3-layer" detector was really 2 layers and the third failed silently.
function seedSessionRepo() {
  const repo = createRepo();
  writeFileSync(join(repo, '.gitignore'), '.claude_review_state.json\n', 'utf8');
  writeFileSync(join(repo, 'README.md'), '# init', 'utf8');
  execFileSync('git', ['add', '.gitignore', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repo });
  return repo;
}

function writeState(repo, obj) {
  writeFileSync(join(repo, '.claude_review_state.json'), JSON.stringify(obj), 'utf8');
}

test('session layer reads changed_files_since_review, the field the hooks write', () => {
  const repo = seedSessionRepo();
  writeState(repo, { changed_files_since_review: [join(repo, 'src/app.js'), 'docs/note.md'] });

  const r = runScript(repo);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.source, 'session');
  const paths = out.files.map(f => f.path).sort();
  // The absolute entry is relativized to repo root; the relative one passes through.
  assert.deepEqual(paths, ['docs/note.md', 'src/app.js']);
});

test('session layer drops absolute paths outside the repo instead of failing the run', () => {
  const repo = seedSessionRepo();
  // A session-wide edit log legitimately records scratch files under other job
  // directories. Those are out of scope, not an attack — exit 4 here would turn
  // every recap run into a hard failure.
  writeState(repo, {
    changed_files_since_review: ['/tmp/other-job/scratch.js', join(repo, 'kept.js')],
  });

  const r = runScript(repo);
  assert.equal(r.status, 0, `expected the run to succeed, got ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.files.map(f => f.path), ['kept.js']);
});

test('session layer still rejects a forged `..` entry in changed_files_since_review → exit 4', () => {
  // Negative control for the filter above: dropping out-of-repo ABSOLUTE paths
  // must not also launder a RELATIVE escape into a quiet omission. Delete the
  // isAbsolute branch and this must stay red.
  const repo = seedSessionRepo();
  writeState(repo, { changed_files_since_review: ['../etc/passwd'] });

  const r = runScript(repo);
  assert.equal(r.status, 4, `expected exit 4, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /unsafe path/i);
});

test('changed_files_since_review wins over a stale recent_file_edits', () => {
  const repo = seedSessionRepo();
  writeState(repo, {
    changed_files_since_review: ['live.js'],
    recent_file_edits: ['stale.js'],
  });

  const r = runScript(repo);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.deepEqual(JSON.parse(r.stdout).files.map(f => f.path), ['live.js']);
});

// ---------------------------------------------------------------------------
// Total fallback failure: exits non-zero + emits fallback_trace
// ---------------------------------------------------------------------------

test('all 3 layers empty → non-zero exit with fallback_trace on stdout', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  // No uncommitted, no prior commits beyond initial, no state file
  const r = runScript(repo);
  assert.notEqual(r.status, 0, 'should exit non-zero when all layers empty');
  const out = JSON.parse(r.stdout);
  assert.equal(out.source, null);
  assert.ok(Array.isArray(out.fallback_trace));
  assert.ok(out.fallback_trace.length >= 3);
  assert.match(r.stderr, /need human|all 3 layers empty/i);
});

// ---------------------------------------------------------------------------
// resolve-feature-cli.js is invoked (NFR-5 reuse verification)
// ---------------------------------------------------------------------------

test('feature_context field is populated (calls resolve-feature-cli.js)', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeFileSync(join(repo, 'new.js'), 'x', 'utf8');
  // Even if resolver has nothing, the field must exist
  const r = runScript(repo);
  const out = JSON.parse(r.stdout);
  assert.ok(out.feature_context, 'feature_context must be present');
  assert.ok('key' in out.feature_context);
  assert.ok('has_tech_spec' in out.feature_context);
});

// ---------------------------------------------------------------------------
// NFR-1: performance ≤ 5s
// ---------------------------------------------------------------------------

test('detect-scope completes within 5 seconds on small repo', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeFileSync(join(repo, 'file1.js'), 'x', 'utf8');
  const t0 = Date.now();
  const r = runScript(repo);
  const elapsed = Date.now() - t0;
  assert.equal(r.status, 0);
  assert.ok(elapsed < 5000, `detect-scope took ${elapsed}ms, expected <5000ms`);
});

// ---------------------------------------------------------------------------
// NFR-8: focus filter respects keyword
// ---------------------------------------------------------------------------

test('--focus keyword narrows file list to matching paths', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeFileSync(join(repo, 'auth-middleware.js'), 'x', 'utf8');
  writeFileSync(join(repo, 'unrelated.js'), 'y', 'utf8');
  const r = runScript(repo, ['--focus', 'auth']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  const paths = out.files.map(f => f.path);
  assert.ok(paths.includes('auth-middleware.js'));
  assert.ok(!paths.includes('unrelated.js'));
  assert.equal(out.focus_hint, 'auth');
});

// ---------------------------------------------------------------------------
// Schema version: stable v1 contract
// ---------------------------------------------------------------------------

test('output schema version is 1 and required fields exist', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeFileSync(join(repo, 'x.js'), 'x', 'utf8');
  const r = runScript(repo);
  const out = JSON.parse(r.stdout);
  assert.equal(out.version, 1);
  for (const key of ['detected_at', 'source', 'confidence', 'base_ref', 'files', 'feature_context', 'focus_hint', 'fallback_trace']) {
    assert.ok(key in out, `missing field: ${key}`);
  }
  // File-level schema
  assert.ok(out.files.length > 0);
  const f = out.files[0];
  assert.ok(typeof f.path === 'string');
  assert.ok(['added', 'modified', 'deleted', 'renamed'].includes(f.change_type), `change_type: ${f.change_type}`);
  assert.ok(f.lines_changed);
  assert.equal(typeof f.lines_changed.added, 'number');
  assert.equal(typeof f.lines_changed.deleted, 'number');
});

// ---------------------------------------------------------------------------
// NFR-8: path traversal + symlink rejection
// ---------------------------------------------------------------------------

test('rejects path with `..` traversal segment → exit 4 + fallback_trace path-safety error', () => {
  const repo = createRepo();
  writeFileSync(join(repo, '.gitignore'), '.claude_review_state.json\n', 'utf8');
  writeFileSync(join(repo, 'README.md'), '# init', 'utf8');
  execFileSync('git', ['add', '.gitignore', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repo });

  // Forge a session entry with `..` traversal
  writeFileSync(
    join(repo, '.claude_review_state.json'),
    JSON.stringify({ recent_file_edits: ['../etc/passwd'] }),
    'utf8',
  );

  const r = runScript(repo);
  assert.equal(r.status, 4, `expected exit 4, got ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const pathSafetyTrace = out.fallback_trace.find(t => t.layer === 'path-safety');
  assert.ok(pathSafetyTrace, 'fallback_trace should contain path-safety entry');
  assert.equal(pathSafetyTrace.outcome, 'error');
  assert.match(r.stderr, /unsafe path/i);
});

test('rejects symlink pointing outside repo → exit 4', () => {
  const repo = createRepo();
  writeFileSync(join(repo, '.gitignore'), '.claude_review_state.json\nescape\n', 'utf8');
  writeFileSync(join(repo, 'README.md'), '# init', 'utf8');
  execFileSync('git', ['add', '.gitignore', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repo });

  // Create symlink inside repo pointing to /tmp (outside repo)
  try {
    symlinkSync('/tmp', join(repo, 'escape'));
  } catch {
    // Some OSes may lack symlink permission — skip
    return;
  }
  writeFileSync(
    join(repo, '.claude_review_state.json'),
    JSON.stringify({ recent_file_edits: ['escape'] }),
    'utf8',
  );

  const r = runScript(repo);
  assert.equal(r.status, 4, `expected exit 4, got ${r.status}: stdout=${r.stdout} stderr=${r.stderr}`);
});

// ---------------------------------------------------------------------------
// AC-4 evidence: prove resolve-feature-cli.js is actually invoked
// ---------------------------------------------------------------------------

test('feature_context comes from resolve-feature-cli.js (proven via stub)', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeFileSync(join(repo, 'new.js'), 'x', 'utf8');

  // Stub the resolver at the same relative location detect-scope resolves it from
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  const stubContent = `#!/usr/bin/env node\nconsole.log(JSON.stringify({ key: 'stubbed-feature', docs_path: 'docs/features/stubbed-feature', has_tech_spec: true, has_requirements: false }));\n`;
  writeFileSync(join(repo, 'scripts', 'resolve-feature-cli.js'), stubContent, 'utf8');

  const r = runScript(repo);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.feature_context.key, 'stubbed-feature', 'sentinel value proves stub was executed');
  assert.equal(out.feature_context.has_tech_spec, true);
  assert.equal(out.feature_context.has_requirements, false);
});

// ---------------------------------------------------------------------------
// Failure contract: not-a-git-repo → exit 2
// ---------------------------------------------------------------------------

test('not a git repository → exit 2 with fallback_trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-detect-scope-notgit-'));
  tempDirs.push(dir);
  const r = runScript(dir);
  assert.equal(r.status, 2, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.source, null);
  assert.ok(out.fallback_trace.length > 0);
  assert.match(r.stderr, /not a git repository/i);
});

// ---------------------------------------------------------------------------
// Stderr cleanliness on success
// ---------------------------------------------------------------------------

test('stderr is empty on successful uncommitted detection (exit 0)', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeFileSync(join(repo, 'x.js'), 'x', 'utf8');
  const r = runScript(repo);
  assert.equal(r.status, 0);
  assert.equal(r.stderr.trim(), '', `expected empty stderr, got: ${r.stderr}`);
});

// ---------------------------------------------------------------------------
// Untracked directory expansion: `-uall` emits individual files
// ---------------------------------------------------------------------------

test('untracked directory is expanded to individual file paths (not dir entry)', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  mkdirSync(join(repo, 'newdir'), { recursive: true });
  writeFileSync(join(repo, 'newdir', 'a.js'), 'a', 'utf8');
  writeFileSync(join(repo, 'newdir', 'b.js'), 'b', 'utf8');

  const r = runScript(repo);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const paths = out.files.map(f => f.path);
  assert.ok(paths.includes('newdir/a.js'), `expected newdir/a.js in ${paths.join(',')}`);
  assert.ok(paths.includes('newdir/b.js'), `expected newdir/b.js in ${paths.join(',')}`);
  // No bare directory entries
  assert.ok(!paths.some(p => p.endsWith('/')), 'must not emit directory paths');
});

// ---------------------------------------------------------------------------
// Symlinked ancestor + non-existent leaf (P1-4 fix)
// ---------------------------------------------------------------------------

test('rejects path where parent symlink escapes repo even if leaf missing', () => {
  const repo = createRepo();
  writeFileSync(join(repo, '.gitignore'), '.claude_review_state.json\nexit-link\n', 'utf8');
  writeFileSync(join(repo, 'README.md'), '# init', 'utf8');
  execFileSync('git', ['add', '.gitignore', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repo });

  // Symlink `exit-link` → /tmp (exists, outside repo); leaf `deleted-file.js` does not exist
  try {
    symlinkSync('/tmp', join(repo, 'exit-link'));
  } catch {
    return;
  }
  writeFileSync(
    join(repo, '.claude_review_state.json'),
    JSON.stringify({ recent_file_edits: ['exit-link/deleted-file.js'] }),
    'utf8',
  );
  const r = runScript(repo);
  assert.equal(r.status, 4, `expected exit 4, got ${r.status}: stdout=${r.stdout} stderr=${r.stderr}`);
});

test('session layer: a directory whose name starts with two dots is inside the repo', () => {
  // `rel.startsWith('..')` rejected `..cache/a.js` as an escape. It is an ordinary in-repo
  // directory, so the edit was silently dropped from the session fallback.
  const repo = seedSessionRepo();
  mkdirSync(join(repo, '..cache'), { recursive: true });
  writeFileSync(join(repo, '..cache', 'a.js'), 'x\n', 'utf8');
  writeState(repo, { changed_files_since_review: [join(repo, '..cache', 'a.js')] });

  const r = runScript(repo);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.files.map(f => f.path), ['..cache/a.js']);
});

test('session layer: a real parent traversal is still rejected', () => {
  // Negative control — narrowing the escape test to `..` and `../` must not open the escape.
  // An ABSOLUTE path above the root is dropped (out of scope, not an attack); the relative
  // form stays a hard exit 4, which the forged-`..` test above pins.
  const repo = seedSessionRepo();
  writeState(repo, {
    changed_files_since_review: [join(repo, '..', 'outside.js'), join(repo, 'kept.js')],
  });

  const r = runScript(repo);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.files.map(f => f.path), ['kept.js']);
});
