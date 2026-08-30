'use strict';
// review-state.js — the single-slot per-plane state store behind the reminder
// hooks. Truth table, content-addressing and repo-key contracts:
// docs/features/hook-lightweighting/2-tech-spec.md §3.2, §6.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  existsSync,
  readdirSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const SCRIPT = resolve(__dirname, '../../scripts/review-state.js');

const tempDirs = [];
after(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

function git(repo, ...args) {
  execFileSync(
    'git',
    ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function makeRepo() {
  const repo = tmp('rs-repo-');
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.js'), 'const a = 1;\n');
  writeFileSync(join(repo, 'readme.md'), '# doc\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

function run(repo, home, args) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

function checkJson(repo, home) {
  const r = run(repo, home, ['check', '--format=json']);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function note(repo, home, plane, verdict) {
  const r = run(repo, home, ['note', plane, verdict]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

// The state dir under a private HOME holds exactly the repo keys the test made.
function stateKeys(home) {
  const base = join(home, '.cache', 'sd0x-dev-flow', 'state');
  return existsSync(base) ? readdirSync(base).sort() : [];
}

test('note pass writes the slot, prints it, and resets rounds', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  const out = note(repo, home, 'code_review', 'pass');
  assert.match(out, /^\[REVIEW_STATE\] code_review \{/);
  const keys = stateKeys(home);
  assert.equal(keys.length, 1);
  const slot = JSON.parse(
    readFileSync(join(home, '.cache', 'sd0x-dev-flow', 'state', keys[0], 'code_review.json'), 'utf8'),
  );
  assert.equal(slot.verdict, 'pass');
  assert.equal(slot.rounds, 0);
  assert.match(slot.digest, /^sha256:[0-9a-f]{64}$/);
});

test('note refuses an unknown plane and an invalid verdict loudly, writing nothing', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  const badPlane = run(repo, home, ['note', 'bogus', 'pass']);
  assert.equal(badPlane.status, 1);
  assert.match(badPlane.stderr, /unknown plane/);
  const badVerdict = run(repo, home, ['note', 'code_review', 'maybe']);
  assert.equal(badVerdict.status, 1);
  assert.match(badVerdict.stderr, /invalid verdict/);
  assert.deepEqual(stateKeys(home), []);
});

test('fail increments rounds, pass resets to zero', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  note(repo, home, 'precommit', 'fail');
  note(repo, home, 'precommit', 'fail');
  assert.equal(checkJson(repo, home).precommit.rounds, 2);
  note(repo, home, 'precommit', 'pass');
  assert.equal(checkJson(repo, home).precommit.rounds, 0);
});

test('truth table: clean/unnoted → passed:false owed:false (owed diverges from passed)', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  const planes = checkJson(repo, home);
  for (const name of ['code_review', 'doc_review', 'precommit']) {
    assert.deepEqual(
      { noted: planes[name].noted, dirty: planes[name].dirty, passed: planes[name].passed, owed: planes[name].owed },
      { noted: false, dirty: false, passed: false, owed: false },
      name,
    );
  }
});

test('truth table: clean/noted-pass → passed:true owed:false', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  note(repo, home, 'code_review', 'pass');
  const p = checkJson(repo, home).code_review;
  assert.deepEqual(
    { noted: p.noted, digest_match: p.digest_match, passed: p.passed, owed: p.owed },
    { noted: true, digest_match: true, passed: true, owed: false },
  );
});

test('truth table: dirty/unnoted, dirty/current-pass, dirty/current-fail, dirty/stale', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
  // dirty/unnoted → {false, true}
  let p = checkJson(repo, home).code_review;
  assert.deepEqual({ passed: p.passed, owed: p.owed }, { passed: false, owed: true });
  // dirty/current-digest-pass → {true, false}
  note(repo, home, 'code_review', 'pass');
  p = checkJson(repo, home).code_review;
  assert.deepEqual({ passed: p.passed, owed: p.owed }, { passed: true, owed: false });
  // dirty/current-digest-fail → {false, true}
  note(repo, home, 'code_review', 'fail');
  p = checkJson(repo, home).code_review;
  assert.deepEqual({ passed: p.passed, owed: p.owed, verdict: p.verdict }, { passed: false, owed: true, verdict: 'fail' });
  // dirty/stale-digest → {false, true}
  note(repo, home, 'code_review', 'pass');
  writeFileSync(join(repo, 'a.js'), 'const a = 3;\n');
  p = checkJson(repo, home).code_review;
  assert.deepEqual(
    { digest_match: p.digest_match, passed: p.passed, owed: p.owed },
    { digest_match: false, passed: false, owed: true },
  );
});

test('truth table: code_review-pass + precommit-unnoted on one dirty code tree', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
  note(repo, home, 'code_review', 'pass');
  const planes = checkJson(repo, home);
  assert.deepEqual(
    { passed: planes.code_review.passed, owed: planes.code_review.owed },
    { passed: true, owed: false },
  );
  assert.deepEqual(
    { passed: planes.precommit.passed, owed: planes.precommit.owed },
    { passed: false, owed: true },
  );
});

test('precommit binds the code digest — doc-only edit leaves it silent, code edit reopens it', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  note(repo, home, 'precommit', 'pass');
  writeFileSync(join(repo, 'readme.md'), '# doc v2\n');
  let planes = checkJson(repo, home);
  assert.equal(planes.precommit.owed, false, 'doc-only edit must not reopen precommit');
  assert.equal(planes.doc_review.owed, true);
  writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
  planes = checkJson(repo, home);
  assert.equal(planes.precommit.owed, true, 'code edit reopens precommit');
});

test('content-addressing: commit keeps the slot matching; revert past the slot re-reminds', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
  note(repo, home, 'code_review', 'pass');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'reviewed tree');
  let p = checkJson(repo, home).code_review;
  assert.deepEqual(
    { digest_match: p.digest_match, owed: p.owed },
    { digest_match: true, owed: false },
    'committing the noted tree must not reopen the gate',
  );
  // Revert to the pre-note content: the single slot only knows tree B, so tree A re-reminds.
  writeFileSync(join(repo, 'a.js'), 'const a = 1;\n');
  p = checkJson(repo, home).code_review;
  assert.equal(p.owed, true, 'the single-slot price: a revert past the slot re-reminds');
});

test('the three renderings agree on one fixture, and rounds surface in md', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
  note(repo, home, 'code_review', 'pass');
  note(repo, home, 'precommit', 'fail');
  const md = run(repo, home, ['check', '--format=md']);
  const fact = run(repo, home, ['check', '--format=fact']);
  const json = checkJson(repo, home);
  assert.equal(md.status, 0);
  assert.doesNotMatch(md.stdout, /code_review/, 'a passed plane earns no md line');
  assert.match(md.stdout, /precommit.*已 1 輪未過/, 'rounds > 0 surface in the md reminder');
  assert.match(fact.stdout, /reviews=code_review:pass,doc_review:none,precommit:fail\(r1\)/);
  assert.equal(json.code_review.owed, false);
  assert.equal(json.precommit.owed, true);
});

test('md is silent ⇔ fact/json report no owed plane (silence-ambiguity pinned)', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  const md = run(repo, home, ['check', '--format=md']);
  const fact = run(repo, home, ['check', '--format=fact']);
  assert.equal(md.stdout, '', 'clean tree: md silent');
  assert.match(fact.stdout, /^\[AUTO_LOOP_STATE\] change=none /, 'fact still answers');
  const json = checkJson(repo, home);
  assert.equal(Object.values(json).some(p => p.owed), false);
});

test('per-plane files: notes to two planes both survive', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  note(repo, home, 'code_review', 'pass');
  note(repo, home, 'doc_review', 'fail');
  const planes = checkJson(repo, home);
  assert.equal(planes.code_review.noted, true);
  assert.equal(planes.doc_review.noted, true);
  assert.equal(planes.doc_review.verdict, 'fail');
});

test('decoder boundary: missing → noted:false; garbage → noted:false; digest:null slot → noted:true, never digest_match', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  note(repo, home, 'code_review', 'pass');
  const dir = join(home, '.cache', 'sd0x-dev-flow', 'state', stateKeys(home)[0]);
  // Unparseable JSON → noted:false.
  writeFileSync(join(dir, 'code_review.json'), '{torn write');
  assert.equal(checkJson(repo, home).code_review.noted, false);
  // Schema-invalid (verdict not pass|fail) → noted:false.
  writeFileSync(join(dir, 'code_review.json'), JSON.stringify({ digest: 'x', verdict: 'ok', rounds: 0 }));
  assert.equal(checkJson(repo, home).code_review.noted, false);
  // Valid slot with digest:null → noted:true but never digest_match (fail-open to a reminder).
  writeFileSync(join(dir, 'code_review.json'), JSON.stringify({ digest: null, verdict: 'pass', rounds: 0, time: 'x' }));
  const p = checkJson(repo, home).code_review;
  assert.deepEqual({ noted: p.noted, digest_match: p.digest_match, passed: p.passed }, { noted: true, digest_match: false, passed: false });
});

test('undigestable tree (merge conflict) notes digest:null — a reminder, never a silent pass', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  const base = execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
  git(repo, 'checkout', '-q', '-b', 'other');
  writeFileSync(join(repo, 'a.js'), 'const a = 22;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'other');
  git(repo, 'checkout', '-q', base);
  writeFileSync(join(repo, 'a.js'), 'const a = 33;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  assert.throws(() => git(repo, 'merge', 'other'));
  note(repo, home, 'code_review', 'pass');
  const p = checkJson(repo, home).code_review;
  assert.deepEqual(
    { noted: p.noted, digest_match: p.digest_match, owed: p.owed },
    { noted: true, digest_match: false, owed: true },
  );
});

test('repo-key: symlinked spellings converge on one store', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  const linkParent = tmp('rs-link-');
  symlinkSync(repo, join(linkParent, 'linked'));
  note(repo, home, 'code_review', 'pass');
  note(join(linkParent, 'linked'), home, 'doc_review', 'pass');
  assert.equal(stateKeys(home).length, 1, 'one checkout, two spellings, one store');
});

test('repo-key: two same-named checkouts do not collide; a worktree stays isolated', () => {
  const parentA = tmp('rs-a-');
  const parentB = tmp('rs-b-');
  for (const parent of [parentA, parentB]) {
    const repo = join(parent, 'proj');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'a.js'), 'x\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
  }
  const home = tmp('rs-home-');
  note(join(parentA, 'proj'), home, 'code_review', 'pass');
  note(join(parentB, 'proj'), home, 'code_review', 'fail');
  assert.equal(stateKeys(home).length, 2, 'same basename, different checkouts, different stores');
  const wt = join(tmp('rs-wt-'), 'wt');
  execFileSync('git', ['-C', join(parentA, 'proj'), 'worktree', 'add', '-q', wt]);
  note(wt, home, 'code_review', 'pass');
  assert.equal(stateKeys(home).length, 3, 'a worktree neither shares nor clobbers its origin state');
});

// --- intent_hint: exact-name doc mapping on the state-backed fact line ---

test('intent_hint: changed feature doc + exact intent-<key>.md → hint; stray name → none', () => {
  const repo = makeRepo();
  const home = tmp('rs-home-');
  const feat = join(repo, 'docs', 'features', 'x');
  mkdirSync(feat, { recursive: true });
  writeFileSync(join(feat, 'intent-x.md'), '# Intent — x\n');
  writeFileSync(join(feat, '2-tech-spec.md'), '# spec\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'feature docs');

  // Clean tree: no changed paths map, so no hint even though the intent file exists.
  let fact = run(repo, home, ['check', '--format=fact']);
  assert.doesNotMatch(fact.stdout, /intent_hint=/, 'no change → no hint');

  // A changed doc under the feature dir maps to the exact intent file.
  writeFileSync(join(feat, '2-tech-spec.md'), '# spec v2\n');
  fact = run(repo, home, ['check', '--format=fact']);
  assert.match(fact.stdout, /intent_hint=docs\/features\/x\/intent-x\.md/, 'mapped change → hint');
  assert.match(fact.stdout, / source=state\n$/, 'hint rides the state-backed line only');

  // Exact-name contract: a stray intent-<other>.md never hints (spec § 3.5).
  const featY = join(repo, 'docs', 'features', 'y');
  mkdirSync(featY, { recursive: true });
  writeFileSync(join(featY, 'intent-z.md'), '# stray\n');
  writeFileSync(join(featY, '2-tech-spec.md'), '# spec\n');
  fact = run(repo, home, ['check', '--format=fact']);
  assert.doesNotMatch(fact.stdout, /intent-z\.md/, 'stray name must not hint');
  assert.match(fact.stdout, /intent_hint=docs\/features\/x\/intent-x\.md/, 'x still hints');

  // A change outside docs/features/ maps nothing.
  writeFileSync(join(repo, 'a.js'), 'const a = 9;\n');
  fact = run(repo, home, ['check', '--format=fact']);
  assert.match(fact.stdout, /intent_hint=docs\/features\/x\/intent-x\.md/, 'unrelated code change does not add hints');

  // A DIRECTORY named intent-<key>.md is not a readable artifact — no hint (Dirent contract).
  const featW = join(repo, 'docs', 'features', 'w');
  mkdirSync(join(featW, 'intent-w.md'), { recursive: true });
  writeFileSync(join(featW, '2-tech-spec.md'), '# spec\n');
  fact = run(repo, home, ['check', '--format=fact']);
  assert.doesNotMatch(fact.stdout, /intent-w\.md/, 'a directory at the exact name must not hint');

  // A SYMLINK at the exact name is not the artifact either (Dirent types are lstat-like), and
  // a case-alias must not satisfy the byte-exact name comparison on any filesystem.
  const featV = join(repo, 'docs', 'features', 'v');
  mkdirSync(featV, { recursive: true });
  writeFileSync(join(featV, '2-tech-spec.md'), '# spec\n');
  writeFileSync(join(featV, 'real.md'), '# target\n');
  symlinkSync(join(featV, 'real.md'), join(featV, 'intent-v.md'));
  fact = run(repo, home, ['check', '--format=fact']);
  assert.doesNotMatch(fact.stdout, /intent-v\.md/, 'a symlink at the exact name must not hint');
  const featU = join(repo, 'docs', 'features', 'u');
  mkdirSync(featU, { recursive: true });
  writeFileSync(join(featU, '2-tech-spec.md'), '# spec\n');
  writeFileSync(join(featU, 'Intent-u.md'), '# wrong case\n');
  fact = run(repo, home, ['check', '--format=fact']);
  assert.doesNotMatch(fact.stdout, /intent-u\.md/, 'a case-alias must not hint, even on a case-insensitive filesystem');

  // A directory that is not a legal feature slug never reaches the fact line: the one-line
  // field grammar is the output contract, and a name carrying a space (or worse) would be
  // interpolated verbatim. Filesystem-valid, slug-invalid: `x bad`.
  const featBad = join(repo, 'docs', 'features', 'x bad');
  mkdirSync(featBad, { recursive: true });
  writeFileSync(join(featBad, '2-tech-spec.md'), '# spec\n');
  writeFileSync(join(featBad, 'intent-x bad.md'), '# not a slug\n');
  fact = run(repo, home, ['check', '--format=fact']);
  assert.doesNotMatch(fact.stdout, /x bad/, 'a non-slug directory must not reach the fact line');
  assert.equal(fact.stdout.trim().split('\n').length, 1, 'the fact output stays exactly one line');
});
