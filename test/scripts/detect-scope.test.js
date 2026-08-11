'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { EMPTY_CONTEXT, EMPTY_CANONICAL } = require('../../scripts/lib/context-shape');

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
/**
 * A resolver stub emitting a **coherent** payload: the whole agreed shape, and the relations the
 * real resolver constructs rather than a set of fields chosen one at a time.
 *
 * The shape comes from `EMPTY_CONTEXT` because that is the contract `detect-scope` validates
 * against. `docs_path` and the two `canonical_docs` entries are *derived* here, from the key and
 * the flags, for the reason the second version of this helper failed: a stub assembled field by
 * field produced `key: 'good'` with `docs_path: null` and `has_tech_spec: true` with no canonical
 * entry — structurally perfect, semantically impossible, and pinned as the *healthy* control. A
 * test that cannot express an incoherent payload by accident cannot pin one by accident either;
 * a test that wants one writes the literal itself, in plain sight.
 */
const stubResolver = (spec = {}) => {
  const { key = null, has_tech_spec: techSpec = false, has_requirements: requirements = false, ...rest } = spec;
  // `rest` is applied *before* the derived fields, not after, so it can set `scan_error`, `source`
  // and the like without being able to reach back and break a relation this helper just satisfied.
  // A test that wants an incoherent payload writes the literal itself, where it is visible.
  const payload = {
    ...EMPTY_CONTEXT(),
    ...rest,
    key,
    docs_path: key === null ? null : `docs/features/${key}`,
    canonical_docs: {
      ...EMPTY_CANONICAL(),
      tech_spec: techSpec ? { file: '2-tech-spec.md', path: '2-tech-spec.md' } : null,
      requirements: requirements ? { file: '1-requirements.md', path: '1-requirements.md' } : null,
    },
    has_tech_spec: techSpec,
    has_requirements: requirements,
  };
  return `#!/usr/bin/env node\nconsole.log(JSON.stringify(${JSON.stringify(payload)}));\n`;
};

// AC-4 evidence: prove resolve-feature-cli.js is actually invoked
// ---------------------------------------------------------------------------

test('feature_context comes from resolve-feature-cli.js (proven via stub)', () => {
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeFileSync(join(repo, 'new.js'), 'x', 'utf8');

  // Stub the resolver at the same relative location detect-scope resolves it from
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  const stubContent = stubResolver({ key: 'stubbed-feature', docs_path: 'docs/features/stubbed-feature', has_tech_spec: true });
  writeFileSync(join(repo, 'scripts', 'resolve-feature-cli.js'), stubContent, 'utf8');

  const r = runScript(repo);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.feature_context.key, 'stubbed-feature', 'sentinel value proves stub was executed');
  assert.equal(out.feature_context.has_tech_spec, true);
  assert.equal(out.feature_context.has_requirements, false);
});

test('feature_context carries scan_error on every path, including the ones that produce no payload', () => {
  // `feature_context` is a projection, and dropping `scan_error` from it turned four different
  // failures into the same answer a healthy repo with no feature gives. A ScopeReport consumer
  // gating on `scan_error !== false` cannot see the difference the resolver went to such lengths
  // to preserve — the fail-open, one boundary further downstream.
  const cases = [
    ['no resolver installed at all', null],
    ['resolver exits nonzero', '#!/usr/bin/env node\nprocess.exit(3);\n'],
    ['resolver prints nothing', '#!/usr/bin/env node\n'],
    ['resolver prints unparseable output', '#!/usr/bin/env node\nconsole.log("not json");\n'],
    ['payload carries no scan_error field', '#!/usr/bin/env node\nconsole.log(JSON.stringify({ key: "k" }));\n'],
    ['resolver reports an unreadable corpus', '#!/usr/bin/env node\nconsole.log(JSON.stringify({ key: "k", scan_error: true }));\n'],
  ];
  for (const [label, stub] of cases) {
    const repo = createRepo();
    writeAndCommit(repo, 'README.md', '# init', 'initial');
    writeFileSync(join(repo, 'new.js'), 'x', 'utf8');
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    if (stub) writeFileSync(join(repo, 'scripts', 'resolve-feature.js'), stub, 'utf8');

    const out = JSON.parse(runScript(repo).stdout);
    assert.equal(out.feature_context.scan_error, true, label);
  }

  // The control, and it is the half that makes the six above mean something: a payload that says
  // the scan succeeded projects `false`, so the field is being read rather than hard-coded.
  const ok = createRepo();
  writeAndCommit(ok, 'README.md', '# init', 'initial');
  writeFileSync(join(ok, 'new.js'), 'x', 'utf8');
  mkdirSync(join(ok, 'scripts'), { recursive: true });
  writeFileSync(join(ok, 'scripts', 'resolve-feature.js'),
    stubResolver({ key: 'good', scan_error: false, has_tech_spec: true }), 'utf8');
  const good = JSON.parse(runScript(ok).stdout);
  assert.equal(good.feature_context.scan_error, false);
  assert.equal(good.feature_context.key, 'good');
});

test('a scan_error:false claim is honoured only from the whole agreed payload', () => {
  // `scan_error: false` is a claim the payload makes about itself, and the six failure shapes above
  // all leave the *producer* silent. This is the other half: a producer that answers, parses, and
  // says the scan succeeded — while carrying none of the fields that would let anyone check. The
  // projection has to read that as an unrecognised producer, not as a healthy corpus.
  const partials = [
    ['bare claim', { scan_error: false }],
    ['sets but no key fields', { scan_error: false, current_authority: [], design_records: [], work_records: [], history_records: [] }],
    ['plausible but incomplete', { key: 'looks-real', scan_error: false, has_tech_spec: true }],
    ['sets of the wrong element type', { ...EMPTY_CONTEXT(), scan_error: false, design_records: [1, 2] }],
    ['not an object at all', 7],
    // Structurally perfect and semantically impossible — the whole shape, every type right, and a
    // set of fields the resolver could not have produced together. Shape validation passes these,
    // which is why the projection checks the relations it actually reads.
    ['a resolved key with no docs_path', { ...EMPTY_CONTEXT(), scan_error: false, key: 'good' }],
    ['has_tech_spec with no canonical entry',
      { ...EMPTY_CONTEXT(), scan_error: false, key: 'good', docs_path: 'docs/features/good', has_tech_spec: true }],
    ['has_requirements with no canonical entry',
      { ...EMPTY_CONTEXT(), scan_error: false, key: 'good', docs_path: 'docs/features/good', has_requirements: true }],
    // The inverse of the first: a path with no key names a directory nothing resolved to, and
    // `/recap-doc` reads it on trust. Cheap to leave out, because the obvious direction is the
    // other one.
    ['a docs_path with no key', { ...EMPTY_CONTEXT(), scan_error: false, docs_path: 'docs/features/ghost' }],
    ['a docs_path that is not derived from the key',
      { ...EMPTY_CONTEXT(), scan_error: false, key: 'ghost', docs_path: '../../outside' }],
    // Derivation is only as constrained as the key. This payload is *coherent* — the path is exactly
    // `docs/features/${key}` — so the relation check passes and the read still escapes the feature
    // directory. `SLUG_RE` is the resolver's own rule and could never have produced this key.
    ['a key that traverses, with a path derived from it', {
      ...EMPTY_CONTEXT(), scan_error: false, key: '../../outside', docs_path: 'docs/features/../../outside',
    }],
    ['a canonical entry the flag denies', {
      ...EMPTY_CONTEXT(), scan_error: false, key: 'good', docs_path: 'docs/features/good',
      canonical_docs: { ...EMPTY_CANONICAL(), tech_spec: { file: '2-tech-spec.md', path: '2-tech-spec.md' } },
    }],
  ];

  for (const [label, payload] of partials) {
    const repo = createRepo();
    writeAndCommit(repo, 'README.md', '# init', 'initial');
    writeFileSync(join(repo, 'new.js'), 'x', 'utf8');
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    writeFileSync(join(repo, 'scripts', 'resolve-feature.js'),
      `#!/usr/bin/env node\nconsole.log(JSON.stringify(${JSON.stringify(payload)}));\n`, 'utf8');

    const out = JSON.parse(runScript(repo).stdout);
    assert.equal(out.feature_context.scan_error, true, label);
    assert.equal(out.feature_context.key, null, `${label}: an untrusted payload contributes no key either`);
  }

  // The negative control, in the words the refusal is written against: the *same* claim, from a
  // payload that is the whole shape, is honoured. Without it this test would also pass on a build
  // where the projection had simply stopped reading `scan_error`.
  const ok = createRepo();
  writeAndCommit(ok, 'README.md', '# init', 'initial');
  writeFileSync(join(ok, 'new.js'), 'x', 'utf8');
  mkdirSync(join(ok, 'scripts'), { recursive: true });
  writeFileSync(join(ok, 'scripts', 'resolve-feature.js'),
    stubResolver({ key: 'looks-real', scan_error: false, has_tech_spec: true }), 'utf8');
  const good = JSON.parse(runScript(ok).stdout);
  assert.equal(good.feature_context.scan_error, false);
  assert.equal(good.feature_context.key, 'looks-real');
});

test('the non-repository early return carries scan_error too', () => {
  // The one path where nothing whatsoever was enumerated used to be the one path that projected no
  // `scan_error` at all — and every other test in this file creates a git repo, so none of them
  // reached it. Consumers gate on `!== false`, so the omission was survivable; it was still the
  // only ScopeReport a reader could mistake for a scanned repository with no feature.
  const bare = mkdtempSync(join(tmpdir(), 'sd0x-detect-scope-norepo-'));
  tempDirs.push(bare);

  const r = runScript(bare);
  assert.equal(r.status, 2, `stderr: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.feature_context.scan_error, true);
  assert.equal(out.feature_context.key, null);
  assert.equal(out.feature_context.has_tech_spec, false);
});

test('the wrapper is preferred over the CLI when both are installed', () => {
  // "The wrapper, not the CLI" is the rule every consumer skill states; the producer has to follow
  // it too, or the one component that owns the failure payload is the one nobody calls.
  const repo = createRepo();
  writeAndCommit(repo, 'README.md', '# init', 'initial');
  writeFileSync(join(repo, 'new.js'), 'x', 'utf8');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  writeFileSync(join(repo, 'scripts', 'resolve-feature-cli.js'),
    stubResolver({ key: 'from-cli' }), 'utf8');
  writeFileSync(join(repo, 'scripts', 'resolve-feature.js'),
    stubResolver({ key: 'from-wrapper' }), 'utf8');

  const out = JSON.parse(runScript(repo).stdout);
  assert.equal(out.feature_context.key, 'from-wrapper');
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
