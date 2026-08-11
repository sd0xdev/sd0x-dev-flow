const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

const { resolveFeatureContext, SLUG_RE } = require('../../scripts/lib/feature-resolver');

const cliPath = resolve(__dirname, '../../scripts/resolve-feature-cli.js');
const tempDirs = [];

function createTempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-fr-'));
  tempDirs.push(dir);
  return dir;
}

function setupFeatureDir(root, featureName, opts = {}) {
  const featureDir = join(root, 'docs', 'features', featureName);
  mkdirSync(featureDir, { recursive: true });
  if (opts.techSpec) {
    writeFileSync(join(featureDir, '2-tech-spec.md'), '# Tech Spec\n');
  }
  if (opts.requirements) {
    writeFileSync(join(featureDir, '1-requirements.md'), '# Requirements\n');
  }
  if (opts.requests) {
    mkdirSync(join(featureDir, 'requests'), { recursive: true });
  }
  return featureDir;
}

after(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

// --- SLUG_RE validation ---

test('SLUG_RE accepts valid feature slugs', () => {
  assert.ok(SLUG_RE.test('auth'));
  assert.ok(SLUG_RE.test('statusline-config'));
  assert.ok(SLUG_RE.test('bug-fix-redesign'));
  assert.ok(SLUG_RE.test('v2.0'));
  assert.ok(SLUG_RE.test('my_feature'));
});

test('SLUG_RE rejects path traversal attempts', () => {
  assert.ok(!SLUG_RE.test('../etc'));
  assert.ok(!SLUG_RE.test('../../passwd'));
  assert.ok(!SLUG_RE.test('/absolute'));
  assert.ok(!SLUG_RE.test('.hidden'));
  assert.ok(!SLUG_RE.test('-leading-dash'));
});

// --- Level 1: explicit featureKey ---

test('Level 1 featureKey resolves to existing feature dir', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'auth', { techSpec: true, requests: true });

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'auth' });
  assert.equal(result.key, 'auth');
  assert.equal(result.source, 'cli');
  assert.equal(result.confidence, 'high');
  assert.equal(result.has_tech_spec, true);
  assert.equal(result.has_requests, true);
});

test('Level 1 featureKey with non-existent dir still returns high confidence', () => {
  const root = createTempRoot();
  mkdirSync(join(root, 'docs', 'features'), { recursive: true });

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'new-feature' });
  assert.equal(result.key, 'new-feature');
  assert.equal(result.source, 'cli');
  assert.equal(result.confidence, 'high');
  assert.equal(result.has_tech_spec, false);
});

test('Level 1 featureKey with invalid slug returns null', () => {
  const root = createTempRoot();
  const result = resolveFeatureContext(root, 'main', [], { featureKey: '../escape' });
  assert.equal(result.key, null);
  assert.equal(result.source, 'none');
});

// --- has_requirements detection ---

test('has_requirements is true when 1-requirements.md exists', () => {
  const root = createTempRoot();
  const featureDir = setupFeatureDir(root, 'req-test', { techSpec: true, requests: true });
  writeFileSync(join(featureDir, '1-requirements.md'), '# Requirements\n');

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'req-test' });
  assert.equal(result.has_requirements, true);
  assert.equal(result.has_tech_spec, true);
  assert.equal(result.has_requests, true);
});

test('has_requirements is false when no requirements file exists', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'no-req', { techSpec: true, requests: true });

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'no-req' });
  assert.equal(result.has_requirements, false);
});

test('has_requirements detects variant filenames like 1-requirements-v2.md', () => {
  const root = createTempRoot();
  const featureDir = setupFeatureDir(root, 'req-variant', {});
  writeFileSync(join(featureDir, '1-requirements-v2.md'), '# Requirements v2\n');

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'req-variant' });
  assert.equal(result.has_requirements, true);
});

// --- Level 2: branch name ---

test('Level 2 branch feat/<key> resolves correctly', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'billing', { techSpec: true, requests: false });

  const result = resolveFeatureContext(root, 'feat/billing', []);
  assert.equal(result.key, 'billing');
  assert.equal(result.source, 'branch');
  assert.equal(result.confidence, 'high');
  assert.equal(result.has_tech_spec, true);
  assert.equal(result.has_requests, false);
});

test('Level 2 branch with nested path does not match', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'evil', {});

  const result = resolveFeatureContext(root, 'feat/evil/nested', []);
  assert.notEqual(result.source, 'branch');
});

test('Level 2 non-feat branch does not match', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'auth', {});

  const result = resolveFeatureContext(root, 'fix/auth', []);
  assert.notEqual(result.source, 'branch');
});

// --- Level 3: changed paths ---

test('Level 3 changed docs/features/<key>/ path resolves', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'notifications', { techSpec: false, requests: true });

  const result = resolveFeatureContext(root, 'main', ['docs/features/notifications/requests/2026-01-01-test.md']);
  assert.equal(result.key, 'notifications');
  assert.equal(result.source, 'diff');
  assert.equal(result.confidence, 'medium');
});

test('Level 3b changed skills/<key>/ path resolves when feature dir exists', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'smart-commit', { techSpec: true });

  const result = resolveFeatureContext(root, 'main', ['skills/smart-commit/SKILL.md']);
  assert.equal(result.key, 'smart-commit');
  assert.equal(result.source, 'diff');
  assert.equal(result.confidence, 'medium');
});

test('Level 3b skills path does not match when no feature dir exists', () => {
  const root = createTempRoot();
  mkdirSync(join(root, 'docs', 'features'), { recursive: true });

  const result = resolveFeatureContext(root, 'main', ['skills/nonexistent/SKILL.md']);
  assert.notEqual(result.key, 'nonexistent');
});

// --- Level 4: single feature dir ---

test('Level 4 single feature dir resolves with low confidence', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'only-feature', { techSpec: true, requests: true });

  const result = resolveFeatureContext(root, 'main', []);
  assert.equal(result.key, 'only-feature');
  assert.equal(result.source, 'single_dir');
  assert.equal(result.confidence, 'low');
});

test('Level 4 does not match when multiple feature dirs exist', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'feature-a', {});
  setupFeatureDir(root, 'feature-b', {});

  const result = resolveFeatureContext(root, 'main', []);
  assert.equal(result.key, null);
  assert.equal(result.source, 'none');
});

// --- Level 5: not found ---

test('Level 5 returns null when no docs/features/ dir exists', () => {
  const root = createTempRoot();

  const result = resolveFeatureContext(root, 'main', []);
  assert.equal(result.key, null);
  assert.equal(result.source, 'none');
  assert.equal(result.confidence, null);
});

// --- Options ---

test('Custom docsBase overrides default', () => {
  const root = createTempRoot();
  const customBase = join(root, 'custom', 'docs');
  mkdirSync(join(customBase, 'my-feat'), { recursive: true });
  writeFileSync(join(customBase, 'my-feat', '2-tech-spec.md'), '');

  const result = resolveFeatureContext(root, 'feat/my-feat', [], { docsBase: customBase });
  assert.equal(result.key, 'my-feat');
  assert.equal(result.has_tech_spec, true);
});

test('taxonomy-based detection finds tech-spec without techSpecPattern param', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'docs', 'features', 'alt');
  mkdirSync(featureDir, { recursive: true });
  writeFileSync(join(featureDir, '2-tech-spec.md'), '');

  const result = resolveFeatureContext(root, 'feat/alt', []);
  assert.equal(result.has_tech_spec, true);
  assert.notEqual(result.canonical_docs.tech_spec, null);
});

// --- Priority order ---

test('featureKey (Level 1) takes priority over branch (Level 2)', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'from-cli', {});
  setupFeatureDir(root, 'from-branch', {});

  const result = resolveFeatureContext(root, 'feat/from-branch', [], { featureKey: 'from-cli' });
  assert.equal(result.key, 'from-cli');
  assert.equal(result.source, 'cli');
});

test('branch (Level 2) takes priority over diff (Level 3)', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'from-branch', { techSpec: true });
  setupFeatureDir(root, 'from-diff', {});

  const result = resolveFeatureContext(root, 'feat/from-branch', ['docs/features/from-diff/requests/test.md']);
  assert.equal(result.key, 'from-branch');
  assert.equal(result.source, 'branch');
});

// --- CLI integration tests ---

test('CLI --feature returns valid JSON with correct key', () => {
  const output = execFileSync('node', [cliPath, '--feature', 'statusline-config'], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
  const result = JSON.parse(output);
  assert.equal(result.key, 'statusline-config');
  assert.equal(result.source, 'cli');
  assert.equal(result.confidence, 'high');
});

test('CLI with invalid feature key returns null key', () => {
  const output = execFileSync('node', [cliPath, '--feature', '../escape'], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
  const result = JSON.parse(output);
  assert.equal(result.key, null);
  assert.equal(result.source, 'none');
});

test('CLI without args returns valid JSON (auto-detect mode)', () => {
  const output = execFileSync('node', [cliPath], {
    encoding: 'utf8',
    timeout: 5000,
  }).trim();
  const result = JSON.parse(output);
  assert.ok('key' in result, 'output must have key field');
  assert.ok('source' in result, 'output must have source field');
  assert.ok('confidence' in result, 'output must have confidence field');
});

// --- doc_inventory + canonical_docs (expanded probe) ---

test('probe returns doc_inventory array', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'inv-test', { techSpec: true, requests: true });

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'inv-test' });
  assert.ok(Array.isArray(result.doc_inventory), 'doc_inventory must be an array');
  assert.ok(result.doc_inventory.length > 0, 'doc_inventory should have entries');
});

test('canonical_docs.tech_spec populated when 2-tech-spec.md exists', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'canon-test', { techSpec: true });

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'canon-test' });
  assert.notEqual(result.canonical_docs.tech_spec, null);
  assert.equal(result.canonical_docs.tech_spec.file, '2-tech-spec.md');
});

test('canonical_docs.tech_spec is null when no tech-spec exists', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'no-spec', {});

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'no-spec' });
  assert.equal(result.canonical_docs.tech_spec, null);
});

test('has_tech_spec derived from canonical_docs', () => {
  const root = createTempRoot();
  setupFeatureDir(root, 'derived-bool', { techSpec: true, requirements: true });

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'derived-bool' });
  assert.equal(result.has_tech_spec, true);
  assert.equal(result.has_requirements, true);
});

test('nullResult includes doc_inventory and normalized canonical_docs', () => {
  const root = createTempRoot();
  const result = resolveFeatureContext(root, 'main', [], { featureKey: '../escape' });
  assert.ok(Array.isArray(result.doc_inventory));
  assert.equal(result.doc_inventory.length, 0);
  assert.ok(typeof result.canonical_docs === 'object');
  assert.equal(result.canonical_docs.tech_spec, null);
  assert.equal(result.canonical_docs.architecture, null);
  assert.equal(result.canonical_docs.feasibility, null);
  assert.equal(result.canonical_docs.requirements, null);
});

test('fallback paths return normalized canonical_docs with null roles', () => {
  const root = createTempRoot();
  mkdirSync(join(root, 'docs', 'features'), { recursive: true });

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'nonexistent-feat' });
  assert.equal(result.key, 'nonexistent-feat');
  assert.equal(result.canonical_docs.tech_spec, null);
  assert.equal(result.canonical_docs.requirements, null);
  assert.equal(result.canonical_docs.architecture, null);
  assert.equal(result.canonical_docs.feasibility, null);
});

// --- Source-set propagation (r2) --------------------------------------------------------------
//
// The resolver has five branches that build a result literal by hand. A consumer reading
// `result.design_records` cannot first check which branch fired, so a branch that forgot the key
// turns "this feature has no docs" into a TypeError at the call site. Every branch is pinned.

const SOURCE_SETS = ['current_authority', 'design_records', 'work_records', 'history_records'];

test('a resolved feature carries all four source sets, populated', () => {
  const root = createTempRoot();
  const featureDir = setupFeatureDir(root, 'sets-test', { techSpec: true, requests: true });
  writeFileSync(join(featureDir, '4-implementation.md'), '# Impl\n');
  writeFileSync(join(featureDir, 'requests', '2026-01-01-first.md'), '# Req\n');

  const result = resolveFeatureContext(root, 'main', [], { featureKey: 'sets-test' });
  assert.deepEqual(result.design_records.map((i) => i.file), ['2-tech-spec.md']);
  assert.deepEqual(result.current_authority.map((i) => i.file), ['4-implementation.md']);
  assert.deepEqual(result.work_records.map((i) => i.file), [join('requests', '2026-01-01-first.md')]);
  assert.deepEqual(result.history_records, []);
});

test('every resolution branch returns the source sets present, even when it found nothing', () => {
  const root = createTempRoot();
  // No docs/features/ at all — this is the shape that used to hand consumers `undefined`.
  mkdirSync(join(root, 'docs', 'features'), { recursive: true });

  const branches = [
    ['cli — named feature whose directory is absent',
      () => resolveFeatureContext(root, 'main', [], { featureKey: 'ghost' })],
    ['branch — feat/<key> with no directory',
      () => resolveFeatureContext(root, 'feat/ghost', [])],
    ['diff — changed path under docs/features/<key>/',
      () => resolveFeatureContext(root, 'main', ['docs/features/ghost/2-tech-spec.md'])],
    ['none — nothing resolved',
      () => resolveFeatureContext(root, 'main', [])],
    ['invalid slug — rejected before any probe',
      () => resolveFeatureContext(root, 'main', [], { featureKey: '../escape' })],
  ];

  for (const [label, run] of branches) {
    const result = run();
    for (const k of SOURCE_SETS) {
      assert.ok(Array.isArray(result[k]), `${label}: ${k} must be an array, got ${typeof result[k]}`);
      assert.equal(result[k].length, 0, `${label}: ${k} must be empty`);
    }
    // The alias keeps its shape on the same branches, for the consumers still reading it.
    assert.equal(result.canonical_docs.tech_spec, null, label);
    // Present on the same branches — a set that arrived without its flag reads as "confirmed empty"
    // on exactly the paths where nothing was confirmed.
    assert.equal(result.scan_error, false, label);
  }
});

test('the two branches with no fixture above — Level 3b and Level 4 — carry the sets and scan_error too', () => {
  // The loops above cover CLI, branch, docs-diff, none and invalid-slug. `skills/<key>` (3b) and
  // the single-directory fallback (4) are the two that return through different code and were
  // asserted nowhere, so a regression dropping a set or `scan_error` from either would leave a
  // test named "every resolution branch" green. Each gets its own root: one feature directory is
  // exactly what Level 4 resolves on, so putting it in the shared root would resolve the `none`
  // branch above.
  // Populated on purpose: with an empty feature directory, replacing 3b's successful probe with
  // the unreadable-corpus result would produce the same key, source, `scan_error: false` and four
  // empty arrays — the assertions would hold on a branch that had stopped working.
  const root3b = createTempRoot();
  setupFeatureDir(root3b, 'real', { techSpec: true, requirements: true });
  const l3b = resolveFeatureContext(root3b, 'main', ['skills/real/SKILL.md']);
  assert.equal(l3b.key, 'real');
  assert.equal(l3b.source, 'diff');
  assert.equal(l3b.scan_error, false);
  for (const k of SOURCE_SETS) assert.ok(Array.isArray(l3b[k]), `3b: ${k} must be an array`);
  assert.deepEqual(l3b.design_records.map((i) => i.file).sort(), ['1-requirements.md', '2-tech-spec.md']);

  // The negative half of 3b, which is the condition that makes it safe: no matching feature
  // directory and the skills path is not a key at all.
  const rootNo3b = createTempRoot();
  mkdirSync(join(rootNo3b, 'docs', 'features'), { recursive: true });
  const miss = resolveFeatureContext(rootNo3b, 'main', ['skills/no-such/SKILL.md']);
  assert.equal(miss.key, null);
  assert.equal(miss.scan_error, false);
  for (const k of SOURCE_SETS) assert.deepEqual(miss[k], [], `3b-miss: ${k}`);

  const root4 = createTempRoot();
  const only = setupFeatureDir(root4, 'lonely', { techSpec: true });
  const l4 = resolveFeatureContext(root4, 'main', []);
  assert.equal(l4.key, 'lonely');
  assert.equal(l4.source, 'single_dir');
  assert.equal(l4.confidence, 'low');
  assert.equal(l4.scan_error, false);
  // Not empty here on purpose: Level 4 is the branch most likely to return a key with the sets
  // left behind, and an all-empty assertion could not tell that apart from a working scan. The
  // other three are asserted present-and-array rather than merely ignored — dropping them from
  // this branch alone would otherwise leave the test green.
  assert.deepEqual(l4.design_records.map((i) => i.file), ['2-tech-spec.md']);
  for (const k of SOURCE_SETS) assert.ok(Array.isArray(l4[k]), `4: ${k} must be an array`);
  assert.equal(only, join(root4, 'docs', 'features', 'lonely'));
});

test('the classify-docs CLI serializes the source sets alongside the deprecated alias', () => {
  const root = createTempRoot();
  const featureDir = setupFeatureDir(root, 'cli-sets', { techSpec: true, requests: true });
  writeFileSync(join(featureDir, 'requests', '2026-01-01-first.md'), '# Req\n');
  execFileSync('git', ['init', '-q'], { cwd: root });

  const classifyCli = resolve(__dirname, '../../scripts/classify-docs-cli.js');
  const out = JSON.parse(execFileSync('node', [classifyCli, '--feature', 'cli-sets'], { cwd: root, encoding: 'utf8' }));

  for (const k of SOURCE_SETS) {
    assert.ok(Array.isArray(out[k]), `${k} must survive JSON serialization`);
  }
  assert.deepEqual(out.design_records.map((i) => i.file), ['2-tech-spec.md']);
  assert.deepEqual(out.work_records.map((i) => i.file), [join('requests', '2026-01-01-first.md')]);
  assert.equal(out.canonical_docs.tech_spec.file, '2-tech-spec.md');
});

test('scan_error tells "no documents" apart from "could not enumerate"', () => {
  // Empty sets are the answer to both questions, so without this flag a consumer picking review
  // depth from `current_authority` reads an unreadable corpus as "nothing owes alignment" — the
  // fail-open direction. Both branches asserted; either alone is satisfiable by a constant.
  // Injected rather than chmod-ed: as root every mode is readable, and the earlier version
  // returned before asserting anything there, so this regression was reported as *passing* in
  // exactly the environment (root containers) where it checked nothing.
  const root = createTempRoot();
  const featureDir = setupFeatureDir(root, 'err-test', { techSpec: true, requests: true });

  const ok = resolveFeatureContext(root, 'main', [], { featureKey: 'err-test' });
  assert.equal(ok.scan_error, false);
  assert.deepEqual(ok.design_records.map((i) => i.file), ['2-tech-spec.md']);

  const reqDir = join(featureDir, 'requests');
  const fs = require('node:fs');
  const real = fs.readdirSync;
  fs.readdirSync = (p, o) => {
    if (String(p) === reqDir) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return real(p, o);
  };
  try {
    const broken = resolveFeatureContext(root, 'main', [], { featureKey: 'err-test' });
    assert.equal(broken.scan_error, true);
    // The sets are emptied rather than half-filled: a partial corpus reported as complete is the
    // same fail-open, just harder to see.
    for (const k of SOURCE_SETS) assert.deepEqual(broken[k], [], k);
    assert.equal(broken.canonical_docs.tech_spec, null);
  } finally {
    fs.readdirSync = real;
  }
});

test('every resolution branch carries scan_error', () => {
  const root = createTempRoot();
  mkdirSync(join(root, 'docs', 'features'), { recursive: true });
  for (const [label, run] of [
    ['cli — absent directory', () => resolveFeatureContext(root, 'main', [], { featureKey: 'ghost' })],
    ['branch — feat/<key> with no directory', () => resolveFeatureContext(root, 'feat/ghost', [])],
    ['diff — changed path under docs/features/<key>/',
      () => resolveFeatureContext(root, 'main', ['docs/features/ghost/2-tech-spec.md'])],
    ['none — nothing resolved', () => resolveFeatureContext(root, 'main', [])],
    ['invalid slug', () => resolveFeatureContext(root, 'main', [], { featureKey: '../escape' })],
  ]) {
    // By value, not by type: this corpus is readable, so `false` is the only honest answer here.
    assert.equal(run().scan_error, false, label);
  }
});

test('Level 4 tells an absent docs/features from an unreadable one', () => {
  // Both branches return `key: null`; only `scan_error` separates "there is no corpus" from
  // "the corpus could not be read". Asserted by value, not by type — a type-only assertion passes
  // whichever constant the code returns.
  const root = createTempRoot();
  const docsBase = join(root, 'docs', 'features');
  mkdirSync(docsBase, { recursive: true });

  const absent = resolveFeatureContext(root, 'main', []);
  assert.equal(absent.key, null);
  assert.equal(absent.scan_error, false);

  const fs = require('node:fs');
  const real = fs.readdirSync;
  fs.readdirSync = (p, o) => {
    if (String(p) === docsBase) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return real(p, o);
  };
  try {
    const broken = resolveFeatureContext(root, 'main', []);
    assert.equal(broken.key, null);
    assert.equal(broken.scan_error, true);
    for (const k of SOURCE_SETS) assert.deepEqual(broken[k], [], k);
  } finally {
    fs.readdirSync = real;
  }
});

test('resolve-feature-cli.js prints the full shape when it has nothing — not `{}`', () => {
  // This is the CLI the skills actually invoke. It printed a bare `{}` outside a git repository
  // and on any unexpected throw, so every consumer's `.map()` on a source set was a TypeError on
  // exactly those paths. `classify-docs-cli.js` was normalized first and none of the skills call it.
  const out = execFileSync('node', [cliPath], { encoding: 'utf8', timeout: 5000, cwd: tmpdir() }).trim();
  const result = JSON.parse(out);
  for (const k of SOURCE_SETS) assert.ok(Array.isArray(result[k]), `${k} must be an array`);
  assert.deepEqual(Object.keys(result.canonical_docs).sort(),
    ['architecture', 'feasibility', 'requirements', 'tech_spec']);
  assert.equal(result.canonical_docs.tech_spec, null);
  assert.equal(result.key, null);
  // Nothing was enumerated: unknown, not empty.
  assert.equal(result.scan_error, true);

  // The control: inside this repo the same CLI resolves and reports no failure, so the assertions
  // above are not passing because the CLI always prints the empty payload.
  const here = JSON.parse(execFileSync('node', [cliPath, '--feature', 'doc-review-phasing'],
    { encoding: 'utf8', timeout: 5000 }).trim());
  assert.equal(here.key, 'doc-review-phasing');
  assert.equal(here.scan_error, false);
  assert.ok(here.design_records.length > 0);
});

test('the CLI top-level catch prints the full shape too, scan_error true', () => {
  // No input reaches this exit from outside — the resolver is patched to throw before the CLI
  // module loads, so `main()` rejects mid-flight and the `.catch()` is the code that answers.
  const resolverPath = resolve(__dirname, '../../scripts/lib/feature-resolver.js');
  const script = [
    `const resolver = require(${JSON.stringify(resolverPath)});`,
    "resolver.resolveFeatureContext = () => { throw new Error('boom'); };",
    `require(${JSON.stringify(cliPath)});`,
  ].join('\n');

  const out = execFileSync('node', ['-e', script], { encoding: 'utf8', timeout: 5000 }).trim();
  const result = JSON.parse(out);

  assert.equal(result.scan_error, true, 'nothing was enumerated: unknown, not empty');
  for (const k of SOURCE_SETS) assert.deepEqual(result[k], [], k);
  assert.equal(result.key, null);
});

test('Level 4 reports scan_error when a child stat fails, not just the directory read', () => {
  // The inner `catch { return false }` mapped every stat failure to "not a directory", so an
  // unreadable child never reached the outer handler and the enumeration reported a complete scan.
  const root = createTempRoot();
  const docsBase = join(root, 'docs', 'features');
  mkdirSync(join(docsBase, 'only'), { recursive: true });

  // Control: with one readable feature directory, Level 4 resolves it and reports no failure.
  const ok = resolveFeatureContext(root, 'main', []);
  assert.equal(ok.scan_error, false);

  const fs = require('node:fs');
  const real = fs.statSync;
  fs.statSync = (p, o) => {
    if (String(p) === join(docsBase, 'only')) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return real(p, o);
  };
  try {
    const broken = resolveFeatureContext(root, 'main', []);
    assert.equal(broken.scan_error, true);
    assert.equal(broken.key, null);
  } finally {
    fs.statSync = real;
  }
});

test('a child that vanished between readdir and stat is an ordinary miss, not a failure', () => {
  // ENOENT here is a race, not unreadability — treating it as a failure would make every scan of a
  // busy directory report `scan_error`, which is the flag becoming noise.
  const root = createTempRoot();
  const docsBase = join(root, 'docs', 'features');
  mkdirSync(join(docsBase, 'only'), { recursive: true });

  const fs = require('node:fs');
  const real = fs.statSync;
  fs.statSync = (p, o) => {
    if (String(p) === join(docsBase, 'only')) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
    return real(p, o);
  };
  try {
    const result = resolveFeatureContext(root, 'main', []);
    assert.equal(result.scan_error, false);
    assert.equal(result.key, null);
  } finally {
    fs.statSync = real;
  }
});
