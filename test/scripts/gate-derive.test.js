'use strict';

// WB4 — check-time gate derivation (tech spec §3.5, tests per §6): obligation
// from the dirty set (clean / doc-only / code-only / committed / reverted /
// rename-union), validity from the newest verdict-bearing record for
// (plane, plane_digest) with settlement projections and no-verdict algebra,
// mode policy under PRECOMMIT_REQUIRE_FULL, tombstone veto + resolution +
// damaged-read over-block, and the dual-read degradation markers (owed null on
// git failure, closedByDigest false with a loud detail on log unavailability).

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const XDG = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-derive-xdg-'));
process.env.XDG_CACHE_HOME = XDG; // absolute, outside every test repo
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-derive-tmp-'));
process.env.TMPDIR = TMP; // tombstone fallback home, isolated per run

const { deriveGates, resolveAdvisory, GATE_PLANES } = require('../../scripts/lib/gate-derive.js');
const receiptLog = require('../../scripts/lib/receipt-log.js');
const treeDigest = require('../../scripts/lib/tree-digest.js');

const cleanups = [];
after(() => {
  for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(XDG, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(d);
  return d;
}

const CLEAN_GIT_ENV = { ...process.env };
for (const k of Object.keys(CLEAN_GIT_ENV)) {
  if (k.startsWith('GIT_')) delete CLEAN_GIT_ENV[k];
}
CLEAN_GIT_ENV.GIT_CONFIG_NOSYSTEM = '1';

function makeGitRepo() {
  const dir = tmpdir('gate-derive-repo-');
  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: dir, env: CLEAN_GIT_ENV });
  sh('git', ['init', '-q', '-b', 'main']);
  sh('git', ['config', 'user.name', 'Gate Tester']);
  sh('git', ['config', 'user.email', 'gate-tester@example.invalid']);
  sh('git', ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1);\n');
  fs.writeFileSync(path.join(dir, 'spec.md'), '# spec\n');
  sh('git', ['add', '-A']);
  sh('git', ['commit', '-q', '-m', 'seed']);
  return dir;
}

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, env: CLEAN_GIT_ENV });
}

function digestOf(repo, plane) {
  return treeDigest.computeTreeState(repo).planes[plane].digest;
}

function appendVerdict(repo, rec) {
  const { file } = receiptLog.resolveReceiptPaths(repo);
  receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', time: new Date().toISOString(), ...rec }]);
}

const ENV = {}; // no PRECOMMIT_REQUIRE_FULL unless a test passes its own env

describe('obligation set (§3.5 worked behaviours)', () => {
  test('clean checkout owes nothing on any plane', () => {
    const repo = makeGitRepo();
    const g = deriveGates(repo, ENV);
    for (const gate of Object.keys(GATE_PLANES)) {
      assert.equal(g.planes[gate].owed, false, `${gate} owed`);
      assert.equal(g.planes[gate].dirty, 0);
    }
  });

  test('doc-only change owes only doc_review', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'spec.md'), 'more\n');
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.doc_review.owed, true);
    assert.equal(g.planes.code_review.owed, false);
    assert.equal(g.planes.precommit.owed, false);
  });

  test('code-only change owes code_review and precommit', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), 'console.log(2);\n');
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.owed, true);
    assert.equal(g.planes.precommit.owed, true);
    assert.equal(g.planes.doc_review.owed, false);
  });

  test('untracked new file owes its plane (porcelain -uall)', () => {
    const repo = makeGitRepo();
    fs.mkdirSync(path.join(repo, 'newdir'));
    fs.writeFileSync(path.join(repo, 'newdir', 'x.js'), '1\n');
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.owed, true);
  });

  test('ignore=all hiding an unreadable submodule change still derives owed=true (R4-1)', t => {
    if (process.getuid && process.getuid() === 0) {
      t.skip('root reads through permission bits');
      return;
    }
    // The exact round-4 scenario: porcelain suppressed, the nested status
    // warn-and-omits, and the ONLY thing standing between the hidden content
    // and owed=false is the gitlink pass dirtying its plane.
    const sub = makeGitRepo();
    const repo = makeGitRepo();
    git(repo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub']);
    git(repo, ['commit', '-q', '-m', 'add submodule']);
    git(repo, ['config', 'submodule.vendor/sub.ignore', 'all']);
    const locked = path.join(repo, 'vendor/sub', 'locked');
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'hidden.js'), '1\n');
    fs.chmodSync(locked, 0o000);
    let g;
    try {
      g = deriveGates(repo, ENV);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
    assert.equal(g.treeState, 'ok');
    assert.equal(g.planes.code_review.owed, true);
    assert.equal(g.planes.precommit.owed, true);
    // Digest is partial, so nothing can close by digest either — open on both
    // halves of the dual read.
    assert.equal(g.planes.code_review.closedByDigest, false);
  });

  test('committed change leaves every plane clean → nothing owed', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), 'console.log(2);\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'landed']);
    const g = deriveGates(repo, ENV);
    for (const gate of Object.keys(GATE_PLANES)) {
      assert.equal(g.planes[gate].owed, false, `${gate} owed`);
    }
  });

  test('edit made and reverted → nothing owed and the pre-edit digest is restored', () => {
    const repo = makeGitRepo();
    const before = digestOf(repo, 'code');
    const p = path.join(repo, 'app.js');
    const orig = fs.readFileSync(p);
    fs.appendFileSync(p, 'console.log(2);\n');
    assert.notEqual(digestOf(repo, 'code'), before, 'edit must move the digest');
    fs.writeFileSync(p, orig);
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.owed, false);
    assert.equal(g.planes.code_review.digest, before, 'revert restores the digest');
  });

  test('a .md → .js rename owes both planes (union of old and new paths)', () => {
    const repo = makeGitRepo();
    git(repo, ['mv', 'spec.md', 'spec.js']);
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.doc_review.owed, true, 'doc plane lost a file');
    assert.equal(g.planes.code_review.owed, true, 'code plane gained one');
  });
});

describe('validity — verdict selection and no-verdict algebra', () => {
  test('a pass verdict row for the current digest closes its gate', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    appendVerdict(repo, { plane: 'code_review', digest: digestOf(repo, 'code'), verdict: 'pass' });
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.owed, true);
    assert.equal(g.planes.code_review.closedByDigest, true);
    assert.equal(g.planes.code_review.veto, false);
  });

  test('a settlement plane_results projection closes the code gate', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    const d = digestOf(repo, 'code');
    const { file } = receiptLog.resolveReceiptPaths(repo);
    receiptLog.appendRecords(file, [
      {
        v: 1,
        kind: 'settlement',
        completion_id: 'tooluse:tu-gate-1',
        plane_results: { code_review: { digest: d, verdict: 'pass' } },
        time: new Date().toISOString(),
      },
    ]);
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.closedByDigest, true);
  });

  test('a no-verdict projection neither closes nor overrides an older same-digest pass', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    const d = digestOf(repo, 'code');
    const { file } = receiptLog.resolveReceiptPaths(repo);
    receiptLog.appendRecords(file, [
      { v: 1, kind: 'verdict', plane: 'code_review', digest: d, verdict: 'pass', time: new Date().toISOString() },
      {
        v: 1,
        kind: 'settlement',
        completion_id: 'tooluse:tu-gate-2',
        plane_results: { code_review: { digest: d, verdict: 'no-verdict' } },
        time: new Date().toISOString(),
      },
    ]);
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.closedByDigest, true, 'attempt records are not evidence against a pass');
  });

  test('pass then fail on the same digest → open (newest wins, append order)', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    const d = digestOf(repo, 'code');
    appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
    appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'fail' });
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.closedByDigest, false);
    assert.match(g.planes.code_review.detail, /verdict=fail/);
  });

  test('pass-A, fail-B, return to tree A → closed (content identity survives edits)', () => {
    const repo = makeGitRepo();
    const p = path.join(repo, 'app.js');
    fs.appendFileSync(p, '// state A\n');
    const stateA = fs.readFileSync(p);
    appendVerdict(repo, { plane: 'code_review', digest: digestOf(repo, 'code'), verdict: 'pass' });
    fs.appendFileSync(p, '// state B\n');
    appendVerdict(repo, { plane: 'code_review', digest: digestOf(repo, 'code'), verdict: 'fail' });
    fs.writeFileSync(p, stateA);
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.closedByDigest, true, 'the digest is back at A and A passed');
  });

  test('a verdict for another digest does not close the gate', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    appendVerdict(repo, { plane: 'code_review', digest: 'sha256:' + 'a'.repeat(64), verdict: 'pass' });
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.closedByDigest, false);
    assert.match(g.planes.code_review.detail, /no verdict/);
  });
});

describe('mode policy (precommit)', () => {
  function passPrecommit(repo, mode) {
    const rec = { plane: 'precommit', digest: digestOf(repo, 'code'), verdict: 'pass' };
    if (mode !== undefined) rec.mode = mode;
    appendVerdict(repo, rec);
  }

  test('mode full and mode fast both close by default', () => {
    const repo = makeGitRepo();
    passPrecommit(repo, 'fast');
    assert.equal(deriveGates(repo, ENV).planes.precommit.closedByDigest, true);
    passPrecommit(repo, 'full');
    assert.equal(deriveGates(repo, ENV).planes.precommit.closedByDigest, true);
  });

  test('PRECOMMIT_REQUIRE_FULL=1 rejects fast; full still closes', () => {
    const repo = makeGitRepo();
    passPrecommit(repo, 'fast');
    const strict = { PRECOMMIT_REQUIRE_FULL: '1' };
    let g = deriveGates(repo, strict);
    assert.equal(g.planes.precommit.closedByDigest, false);
    assert.match(g.planes.precommit.detail, /mode=fast/);
    passPrecommit(repo, 'full');
    g = deriveGates(repo, strict);
    assert.equal(g.planes.precommit.closedByDigest, true);
  });

  test('absent or unknown mode never closes precommit (unproven is not proven)', () => {
    const repo = makeGitRepo();
    passPrecommit(repo, undefined);
    assert.equal(deriveGates(repo, ENV).planes.precommit.closedByDigest, false);
    passPrecommit(repo, 'unknown');
    assert.equal(deriveGates(repo, ENV).planes.precommit.closedByDigest, false);
  });

  test('mode never gates the review planes', () => {
    const repo = makeGitRepo();
    appendVerdict(repo, { plane: 'code_review', digest: digestOf(repo, 'code'), verdict: 'pass' });
    const g = deriveGates(repo, { PRECOMMIT_REQUIRE_FULL: '1' });
    assert.equal(g.planes.code_review.closedByDigest, true);
  });
});

describe('tombstone veto (§4)', () => {
  test('an unresolved tombstone blocks its pair despite a pass verdict', () => {
    const repo = makeGitRepo();
    const d = digestOf(repo, 'code');
    appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
    receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: d }]);
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.veto, true);
    assert.equal(g.planes.code_review.closedByDigest, false);
    assert.equal(g.planes.code_review.vetoIds.length, 1);
  });

  test('a pass whose resolves tuple names the tombstone id clears the veto', () => {
    const repo = makeGitRepo();
    const d = digestOf(repo, 'code');
    const t = receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: d }]);
    appendVerdict(repo, {
      plane: 'code_review',
      digest: d,
      verdict: 'pass',
      resolves: [{ plane: 'code_review', digest: d, id: t.id }],
    });
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.veto, false);
    assert.equal(g.planes.code_review.closedByDigest, true);
  });

  test('a colliding id on another pair resolves nothing (full-tuple match)', () => {
    const repo = makeGitRepo();
    const d = digestOf(repo, 'code');
    const t = receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: d }]);
    appendVerdict(repo, {
      plane: 'code_review',
      digest: d,
      verdict: 'pass',
      resolves: [{ plane: 'doc_review', digest: d, id: t.id }],
    });
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.veto, true);
    assert.equal(g.planes.code_review.closedByDigest, false);
  });

  test('a damaged tombstone file is unresolved-for-every-pair — over-block, never fail open', () => {
    const repo = makeGitRepo();
    appendVerdict(repo, { plane: 'code_review', digest: digestOf(repo, 'code'), verdict: 'pass' });
    const { file } = receiptLog.resolveTombstonePaths(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(file, 'not json at all\n');
    const g = deriveGates(repo, ENV);
    assert.equal(g.tombstonesDamaged, true);
    for (const gate of Object.keys(GATE_PLANES)) {
      assert.equal(g.planes[gate].veto, true, `${gate} veto`);
      assert.equal(g.planes[gate].closedByDigest, false, `${gate} closed`);
    }
    assert.ok(g.reports.some(r => /over-block/.test(r)));
  });

  test('a tombstone on plane A never vetoes plane B, and doc/code pairs stay independent', () => {
    const repo = makeGitRepo();
    const dCode = digestOf(repo, 'code');
    const dDoc = digestOf(repo, 'doc');
    receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: dCode }]);
    appendVerdict(repo, { plane: 'doc_review', digest: dDoc, verdict: 'pass' });
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.veto, true);
    assert.equal(g.planes.doc_review.veto, false);
    assert.equal(g.planes.doc_review.closedByDigest, true);
  });
});

describe('dual-read degradation markers (fail-closed, loud)', () => {
  test('missing receipt log → closedByDigest false with a "no receipt log" detail; owed still derived', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.owed, true, 'obligation needs no log');
    assert.equal(g.planes.code_review.closedByDigest, false);
    assert.match(g.planes.code_review.detail, /no receipt log/);
  });

  test('a merge conflict makes the plane digest partial — digest path cannot close', () => {
    const repo = makeGitRepo();
    // Build a real conflict on app.js: two branches editing the same line.
    git(repo, ['checkout', '-q', '-b', 'side']);
    fs.writeFileSync(path.join(repo, 'app.js'), 'console.log("side");\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'side']);
    git(repo, ['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(repo, 'app.js'), 'console.log("main");\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'main']);
    let conflicted = false;
    try {
      git(repo, ['merge', '-q', 'side']);
    } catch {
      conflicted = true;
    }
    assert.equal(conflicted, true, 'fixture must actually conflict');
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.partial, true);
    assert.equal(g.planes.code_review.closedByDigest, false);
    assert.match(g.planes.code_review.detail, /partial/);
    assert.equal(g.planes.code_review.owed, true, 'a conflicted file is still a dirty file');
  });

  test('not a git repository → owed null on every plane (obligation underivable, mirror decides)', () => {
    const dir = tmpdir('gate-derive-norepo-');
    const g = deriveGates(dir, ENV);
    for (const gate of Object.keys(GATE_PLANES)) {
      assert.equal(g.planes[gate].owed, null, `${gate} owed`);
      assert.equal(g.planes[gate].closedByDigest, false, `${gate} closed`);
    }
  });

  test('a torn tombstone tail is damaged — single unterminated line form', () => {
    const repo = makeGitRepo();
    const d = digestOf(repo, 'code');
    appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
    const { file } = receiptLog.resolveTombstonePaths(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // The whole file is ONE unterminated line: a crash mid-first-append. The
    // discarded line may be exactly the tombstone that blocks this pair.
    fs.writeFileSync(file, JSON.stringify({ v: 1, kind: 'tombstone', id: 't-torn', pairs: [{ plane: 'code_review', digest: d }] }));
    const g = deriveGates(repo, ENV);
    assert.equal(g.tombstonesDamaged, true);
    assert.equal(g.planes.code_review.veto, true);
    assert.equal(g.planes.code_review.closedByDigest, false);
  });

  test('a torn tombstone tail is damaged — good lines plus torn tail form', () => {
    const repo = makeGitRepo();
    const d = digestOf(repo, 'code');
    appendVerdict(repo, { plane: 'doc_review', digest: digestOf(repo, 'doc'), verdict: 'pass' });
    receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: d }]);
    const { file } = receiptLog.resolveTombstonePaths(repo);
    fs.appendFileSync(file, '{"v":1,"kind":"tomb'); // torn: no trailing newline
    const g = deriveGates(repo, ENV);
    assert.equal(g.tombstonesDamaged, true);
    for (const gate of Object.keys(GATE_PLANES)) {
      assert.equal(g.planes[gate].veto, true, `${gate} veto`);
    }
  });

  test('resolves on a non-PASS or other-digest record clears nothing (provenance)', () => {
    const repo = makeGitRepo();
    const d = digestOf(repo, 'code');
    const t = receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: d }]);
    // A FAIL carrying the exact tuple: refuted evidence must not resolve.
    appendVerdict(repo, {
      plane: 'code_review',
      digest: d,
      verdict: 'fail',
      resolves: [{ plane: 'code_review', digest: d, id: t.id }],
    });
    // A pass for ANOTHER digest carrying the tuple: not this pair's evidence.
    appendVerdict(repo, {
      plane: 'code_review',
      digest: 'other-digest',
      verdict: 'pass',
      resolves: [{ plane: 'code_review', digest: d, id: t.id }],
    });
    // Newest verdict for the CURRENT digest is a clean pass without resolves —
    // the tombstone must still stand.
    appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.veto, true);
    assert.equal(g.planes.code_review.closedByDigest, false);
  });

  test('a settlement pass projection carrying resolves clears the veto (producer parity)', () => {
    const repo = makeGitRepo();
    const d = digestOf(repo, 'code');
    const t = receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: d }]);
    const { file } = receiptLog.resolveReceiptPaths(repo);
    receiptLog.appendRecords(file, [
      {
        v: 1,
        kind: 'settlement',
        dispatch_id: 'disp-x',
        completion_id: 'tooluse:tu-x',
        plane_results: { code_review: { digest: d, verdict: 'pass' } },
        resolves: [{ plane: 'code_review', digest: d, id: t.id }],
        time: new Date().toISOString(),
      },
    ]);
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.veto, false);
    assert.equal(g.planes.code_review.closedByDigest, true);
  });
});

describe('authoritative negatives and tree classification (dual-read contract)', () => {
  test('a fail verdict for the current digest is authoritativeFail — the digest path answered', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    const d = digestOf(repo, 'code');
    appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'fail' });
    const g = deriveGates(repo, ENV);
    assert.equal(g.planes.code_review.authoritativeFail, true);
    assert.equal(g.planes.code_review.closedByDigest, false);
    // Infrastructure absence stays mirror-fallback: no verdict is NOT a negative.
    assert.equal(g.planes.doc_review.authoritativeFail, false);
  });

  test('a mode-rejected pass is authoritativeFail under PRECOMMIT_REQUIRE_FULL', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    const d = digestOf(repo, 'code');
    appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'fast' });
    const g = deriveGates(repo, { PRECOMMIT_REQUIRE_FULL: '1' });
    assert.equal(g.planes.precommit.authoritativeFail, true);
    assert.equal(g.planes.precommit.closedByDigest, false);
    // Without the policy the same record closes — the negative is the POLICY's.
    const g2 = deriveGates(repo, ENV);
    assert.equal(g2.planes.precommit.authoritativeFail, false);
    assert.equal(g2.planes.precommit.closedByDigest, true);
  });

  test('treeState is ok inside a repo and not-a-repo outside one', () => {
    const repo = makeGitRepo();
    assert.equal(deriveGates(repo, ENV).treeState, 'ok');
    const dir = tmpdir('gate-derive-norepo2-');
    const g = deriveGates(dir, ENV);
    assert.equal(g.treeState, 'not-a-repo');
    assert.equal(g.planes.code_review.owed, null);
  });

  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  test('an unreadable subtree is unverifiable, never not-a-repo (fail-closed split)', { skip: isRoot }, () => {
    const repo = makeGitRepo();
    const locked = path.join(repo, 'locked');
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'hidden.js'), '1\n');
    fs.chmodSync(locked, 0o000);
    let g;
    try {
      g = deriveGates(repo, ENV);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
    assert.equal(g.treeState, 'unverifiable');
    for (const gate of Object.keys(GATE_PLANES)) {
      assert.equal(g.planes[gate].owed, null, `${gate} owed underivable`);
      assert.equal(g.planes[gate].closedByDigest, false, `${gate} must not close`);
    }
  });

  test('a corrupt .git is unverifiable, never not-a-repo — the message alone is not evidence (R2-2)', () => {
    const repo = makeGitRepo();
    // A HEAD-less .git makes git say the not-a-repository words while a .git
    // entry plainly exists: the benign class needs positive absence, not a
    // substring.
    fs.rmSync(path.join(repo, '.git', 'HEAD'));
    const g = deriveGates(repo, ENV);
    assert.equal(g.treeState, 'unverifiable');
    for (const gate of Object.keys(GATE_PLANES)) {
      assert.equal(g.planes[gate].closedByDigest, false, `${gate} must not close`);
    }
  });

  test('a broken .git symlink is unverifiable — existsSync-style laundering refused (R3-1)', () => {
    const repo = makeGitRepo();
    // Replace .git with a symlink to nowhere: git says the not-a-repository
    // words, existsSync would say "absent", but an lstat proves something IS
    // there that git cannot follow — that is a repo that could not be read.
    fs.rmSync(path.join(repo, '.git'), { recursive: true });
    fs.symlinkSync(path.join(repo, 'no-such-target'), path.join(repo, '.git'));
    const g = deriveGates(repo, ENV);
    assert.equal(g.treeState, 'unverifiable');
    for (const gate of Object.keys(GATE_PLANES)) {
      assert.equal(g.planes[gate].closedByDigest, false, `${gate} must not close`);
    }
  });

  test('an inherited GIT_DIR cannot redirect the reads or forge not-a-repo (R2-2 env fence)', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    const prev = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(repo, 'definitely', 'nonexistent');
    let g;
    try {
      g = deriveGates(repo, ENV);
    } finally {
      if (prev === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prev;
    }
    // With the GIT_* namespace stripped at spawn, -C alone resolves the repo:
    // the derivation neither fails nor reads some other repository.
    assert.equal(g.treeState, 'ok');
    assert.equal(g.planes.code_review.owed, true);
  });

  test('index failure with healthy status keeps the obligation and loses only the digest (R2-5b)', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
    // Stub git: ls-files fails, everything else delegates to the real git —
    // the two reads must degrade separately (§3.5: obligation is the dirty
    // set; only the digest needs the index).
    const realGit = execFileSync('sh', ['-c', 'command -v git']).toString('utf8').trim();
    const stubDir = tmpdir('gate-derive-stubgit-');
    fs.writeFileSync(
      path.join(stubDir, 'git'),
      `#!/bin/sh\nfor a in "$@"; do case "$a" in ls-files) exit 1 ;; esac; done\nexec "${realGit}" "$@"\n`
    );
    fs.chmodSync(path.join(stubDir, 'git'), 0o755);
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, '..', '..', 'scripts', 'lib', 'gate-derive.js'), repo],
      { env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` } }
    );
    const g = JSON.parse(out.toString('utf8'));
    assert.equal(g.treeState, 'ok', 'an index failure is not a tree failure');
    assert.equal(g.planes.code_review.owed, true, 'the dirty set still derives the obligation');
    assert.equal(g.planes.code_review.partial, true, 'the digest path is lost');
    assert.equal(g.planes.code_review.closedByDigest, false);
  });

  test('CLI entry prints the same JSON derivation', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'spec.md'), 'more\n');
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, '..', '..', 'scripts', 'lib', 'gate-derive.js'), repo],
      { env: { ...process.env } }
    );
    const g = JSON.parse(out.toString('utf8'));
    assert.equal(g.v, 1);
    assert.equal(g.planes.doc_review.owed, true);
    assert.equal(g.planes.code_review.owed, false);
  });
});

describe('resolveAdvisory (WB5a dual-read merge)', () => {
  const CLI = path.join(__dirname, '..', '..', 'scripts', 'lib', 'gate-derive.js');

  // Production repos gitignore the state file (this repo's .gitignore does);
  // without the exclusion the untracked state file would itself be code-plane
  // dirt and every "clean tree" case below would derive owed=true.
  function writeState(repo, obj) {
    const f = path.join(repo, '.claude_review_state.json');
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.claude_review_state.json\n');
    fs.writeFileSync(f, JSON.stringify(obj));
    return f;
  }

  const MIRROR_CLEAN = {
    has_code_change: false,
    has_doc_change: false,
    code_review: { passed: false },
    doc_review: { passed: false },
    precommit: { passed: false },
  };

  test('derived owed raises a false mirror flag (dirty code the mirror never recorded)', () => {
    const repo = makeGitRepo();
    const state = writeState(repo, MIRROR_CLEAN);
    fs.appendFileSync(path.join(repo, 'app.js'), 'console.log(2);\n');
    const a = resolveAdvisory(repo, state, ENV);
    assert.equal(a.treeState, 'ok');
    assert.equal(a.has_code_change, true, 'owed overrides the stored flag upward');
    assert.equal(a.has_doc_change, false);
    // WB5c: the window is closed — on a derivable tree a plane with no verdict
    // for the current digest reads false directly; nothing falls back.
    assert.equal(a.code_review_passed, false);
    assert.deepEqual(a.mirror_planes, [],
      'no plane answers from the mirror on a derivable tree');
  });

  test('WB5c flip: a stale mirror PASS is inert on a derivable tree (no digest receipt → false)', () => {
    const repo = makeGitRepo();
    const state = writeState(repo, {
      ...MIRROR_CLEAN, has_code_change: true, code_review: { passed: true }, precommit: { passed: true },
    });
    fs.appendFileSync(path.join(repo, 'app.js'), 'console.log(2);\n');
    const a = resolveAdvisory(repo, state, ENV);
    assert.equal(a.treeState, 'ok');
    assert.equal(a.code_review_passed, false, 'the mirror PASS must not close a digest-less gate');
    assert.equal(a.precommit_passed, false);
    assert.deepEqual(a.mirror_planes, []);
  });

  test('derived owed lowers a true mirror flag (clean tree, stale stored flags)', () => {
    const repo = makeGitRepo();
    const state = writeState(repo, {
      ...MIRROR_CLEAN, has_code_change: true, has_doc_change: true,
    });
    const a = resolveAdvisory(repo, state, ENV);
    assert.equal(a.has_code_change, false, 'owed overrides the stored flag downward');
    assert.equal(a.has_doc_change, false);
  });

  test('a digest closure marks its gate passed over a false mirror; digest-less siblings read false', () => {
    const repo = makeGitRepo();
    const state = writeState(repo, MIRROR_CLEAN);
    fs.appendFileSync(path.join(repo, 'app.js'), 'console.log(2);\n');
    appendVerdict(repo, { plane: 'code_review', digest: digestOf(repo, 'code'), verdict: 'pass' });
    const a = resolveAdvisory(repo, state, ENV);
    assert.equal(a.code_review_passed, true, 'digest closure outranks the mirror false');
    assert.equal(a.precommit_passed, false, 'precommit has no verdict — open by the WB5c flip, not by the mirror');
    assert.deepEqual(a.mirror_planes, [],
      'a derivable tree lists no mirror-answered plane');
  });

  test('an authoritative digest negative forces failed over a true mirror', () => {
    const repo = makeGitRepo();
    const state = writeState(repo, {
      ...MIRROR_CLEAN, has_code_change: true, code_review: { passed: true },
    });
    fs.appendFileSync(path.join(repo, 'app.js'), 'console.log(2);\n');
    appendVerdict(repo, { plane: 'code_review', digest: digestOf(repo, 'code'), verdict: 'fail' });
    const a = resolveAdvisory(repo, state, ENV);
    assert.equal(a.code_review_passed, false, 'a current-digest fail is authoritative — mirror not consulted');
    assert.ok(!a.mirror_planes.includes('code_review'));
  });

  test('an unresolved tombstone vetoes its gate over a true mirror (§4, absolute)', () => {
    const repo = makeGitRepo();
    const state = writeState(repo, {
      ...MIRROR_CLEAN, has_code_change: true, code_review: { passed: true },
    });
    fs.appendFileSync(path.join(repo, 'app.js'), 'console.log(2);\n');
    const d = digestOf(repo, 'code');
    appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
    receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: d }]);
    const a = resolveAdvisory(repo, state, ENV);
    assert.equal(a.code_review_passed, false, 'the veto stands against the pass AND the mirror');
    assert.ok(!a.mirror_planes.includes('code_review'));
  });

  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  test('unverifiable forces every obligation on and every pass off', { skip: isRoot }, () => {
    const repo = makeGitRepo();
    const state = writeState(repo, {
      has_code_change: false,
      has_doc_change: false,
      code_review: { passed: true },
      doc_review: { passed: true },
      precommit: { passed: true },
    });
    const locked = path.join(repo, 'locked');
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'hidden.js'), '1\n');
    fs.chmodSync(locked, 0o000);
    let a;
    try {
      a = resolveAdvisory(repo, state, ENV);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
    assert.equal(a.treeState, 'unverifiable');
    assert.equal(a.has_code_change, true);
    assert.equal(a.has_doc_change, true);
    assert.equal(a.code_review_passed, false);
    assert.equal(a.doc_review_passed, false);
    assert.equal(a.precommit_passed, false);
    assert.deepEqual(a.mirror_planes, [], 'nothing answers from the mirror when the tree is unverifiable');
  });

  test('not-a-repo leaves the mirror authoritative throughout', () => {
    const dir = tmpdir('advisory-norepo-');
    const state = path.join(dir, '.claude_review_state.json');
    fs.writeFileSync(state, JSON.stringify({
      ...MIRROR_CLEAN, has_code_change: true, code_review: { passed: true },
    }));
    const a = resolveAdvisory(dir, state, ENV);
    assert.equal(a.treeState, 'not-a-repo');
    assert.equal(a.has_code_change, true, 'stored flag preserved — owed is underivable');
    assert.equal(a.code_review_passed, true, 'stored receipt preserved');
    assert.deepEqual(a.mirror_planes.sort(), ['code_review', 'doc_review', 'precommit']);
  });

  test('a missing or corrupt state file is an empty mirror, never a crash', () => {
    const repo = makeGitRepo();
    fs.appendFileSync(path.join(repo, 'app.js'), 'console.log(2);\n');
    const missing = resolveAdvisory(repo, path.join(repo, 'no-such-state.json'), ENV);
    assert.equal(missing.has_code_change, true, 'derivation still answers with no mirror at all');
    assert.equal(missing.code_review_passed, false);
    const state = writeState(repo, MIRROR_CLEAN);
    fs.writeFileSync(state, '{not json');
    const corrupt = resolveAdvisory(repo, state, ENV);
    assert.equal(corrupt.has_code_change, true);
    assert.equal(corrupt.code_review_passed, false);
  });

  test('CLI --advisory prints the merged JSON', () => {
    const repo = makeGitRepo();
    const state = writeState(repo, MIRROR_CLEAN);
    fs.appendFileSync(path.join(repo, 'app.js'), 'console.log(2);\n');
    const out = execFileSync(process.execPath, [CLI, repo, '--advisory', state], { env: { ...process.env } });
    const a = JSON.parse(out.toString('utf8'));
    assert.equal(a.v, 1);
    assert.equal(a.has_code_change, true);
    assert.equal(a.has_doc_change, false);
  });

  test('CLI --advisory without a state-file path exits 1, never prints a half answer', () => {
    const repo = makeGitRepo();
    assert.throws(
      () => execFileSync(process.execPath, [CLI, repo, '--advisory'], { env: { ...process.env } }),
      (e) => e.status === 1 && String(e.stderr) .includes('--advisory requires a state-file path')
    );
  });
});
