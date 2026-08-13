'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { computeTreeState, planeOf } = require('../../scripts/lib/tree-digest.js');

const CLEAN_GIT_ENV = { ...process.env };
for (const k of Object.keys(CLEAN_GIT_ENV)) {
  if (k.startsWith('GIT_')) delete CLEAN_GIT_ENV[k];
}
CLEAN_GIT_ENV.GIT_CONFIG_NOSYSTEM = '1';
CLEAN_GIT_ENV.HOME = os.tmpdir();

function sh(cwd, cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd, env: CLEAN_GIT_ENV, ...opts });
}

function makeRepo(extraConfig = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-digest-'));
  sh(dir, 'git', ['init', '-q', '-b', 'main']);
  sh(dir, 'git', ['config', 'user.name', 'Digest Tester']);
  sh(dir, 'git', ['config', 'user.email', 'digest-tester@example.invalid']);
  sh(dir, 'git', ['config', 'commit.gpgsign', 'false']);
  for (const [k, v] of extraConfig) sh(dir, 'git', ['config', k, v]);
  return dir;
}

function commitAll(dir, msg) {
  sh(dir, 'git', ['add', '-A']);
  sh(dir, 'git', ['commit', '-q', '-m', msg]);
}

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const repos = [];
function repo(extraConfig) {
  const r = makeRepo(extraConfig);
  repos.push(r);
  return r;
}

after(() => {
  for (const r of repos) fs.rmSync(r, { recursive: true, force: true });
});

describe('planeOf', () => {
  test('.md and .mdx classify as doc, everything else as code', () => {
    assert.equal(planeOf('docs/a.md'), 'doc');
    assert.equal(planeOf('README.mdx'), 'doc');
    assert.equal(planeOf('scripts/run.js'), 'code');
    assert.equal(planeOf('hooks/guard.sh'), 'code');
    assert.equal(planeOf('a.md.bak'), 'code');
  });
});

describe('computeTreeState — determinism and plane split', () => {
  test('same tree computed twice → identical digests, no partial', () => {
    const r = repo();
    write(r, 'src/app.js', 'console.log(1);\n');
    write(r, 'docs/spec.md', '# spec\n');
    commitAll(r, 'seed');
    write(r, 'src/dirty.js', 'dirty\n');

    const a = computeTreeState(r);
    const b = computeTreeState(r);
    assert.equal(a.planes.code.partial, false);
    assert.equal(a.planes.doc.partial, false);
    assert.equal(a.planes.code.digest, b.planes.code.digest);
    assert.equal(a.planes.doc.digest, b.planes.doc.digest);
    assert.match(a.planes.code.digest, /^sha256:[0-9a-f]{64}$/);
  });

  test('doc edit changes doc digest only; code edit changes code digest only', () => {
    const r = repo();
    write(r, 'src/app.js', 'v1\n');
    write(r, 'docs/spec.md', '# v1\n');
    commitAll(r, 'seed');
    const base = computeTreeState(r);

    write(r, 'docs/spec.md', '# v2\n');
    const afterDoc = computeTreeState(r);
    assert.notEqual(afterDoc.planes.doc.digest, base.planes.doc.digest);
    assert.equal(afterDoc.planes.code.digest, base.planes.code.digest);
    assert.deepEqual(afterDoc.planes.doc.dirty, ['docs/spec.md']);
    assert.deepEqual(afterDoc.planes.code.dirty, []);

    write(r, 'src/app.js', 'v2\n');
    const afterBoth = computeTreeState(r);
    assert.notEqual(afterBoth.planes.code.digest, base.planes.code.digest);
    assert.equal(afterBoth.planes.doc.digest, afterDoc.planes.doc.digest);
  });

  test('write outside the repo cannot change any digest (containment by construction)', () => {
    const r = repo();
    write(r, 'docs/spec.md', '# spec\n');
    commitAll(r, 'seed');
    const base = computeTreeState(r);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'stray.md'), '# stray doc\n');
      const after = computeTreeState(r);
      assert.equal(after.planes.doc.digest, base.planes.doc.digest);
      assert.equal(after.planes.code.digest, base.planes.code.digest);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test('gitignored file does not perturb digests', () => {
    const r = repo();
    write(r, '.gitignore', 'state.json\n');
    write(r, 'src/app.js', 'v1\n');
    commitAll(r, 'seed');
    const base = computeTreeState(r);
    write(r, 'state.json', '{"mutates":"often"}\n');
    const after = computeTreeState(r);
    assert.equal(after.planes.code.digest, base.planes.code.digest);
    assert.deepEqual(after.planes.code.dirty, []);
  });
});

describe('computeTreeState — ordering and raw-byte paths', () => {
  test('creation and index order do not affect the digest (sorted records)', () => {
    const a = repo();
    write(a, 'src/zzz.js', 'z\n');
    commitAll(a, 'first zzz');
    write(a, 'src/aaa.js', 'a\n');
    commitAll(a, 'then aaa');

    const b = repo();
    write(b, 'src/aaa.js', 'a\n');
    commitAll(b, 'first aaa');
    write(b, 'src/zzz.js', 'z\n');
    commitAll(b, 'then zzz');

    // Same content set, opposite creation/commit order → identical digest.
    assert.equal(
      computeTreeState(a).planes.code.digest,
      computeTreeState(b).planes.code.digest
    );
  });

  test('UTF-8 (non-ASCII) filenames digest deterministically, tracked and untracked', () => {
    const r = repo();
    write(r, 'src/中文檔名.js', 'v1\n');
    commitAll(r, 'seed');
    write(r, 'docs/說明文件.md', '# 中文\n');
    const a = computeTreeState(r);
    const b = computeTreeState(r);
    assert.equal(a.planes.code.partial, false);
    assert.equal(a.planes.doc.partial, false);
    assert.equal(a.planes.code.digest, b.planes.code.digest);
    assert.equal(a.planes.doc.digest, b.planes.doc.digest);
    assert.ok(a.planes.doc.dirty.length === 1);

    write(r, 'src/中文檔名.js', 'v2\n');
    const c = computeTreeState(r);
    assert.notEqual(c.planes.code.digest, a.planes.code.digest);
    assert.equal(c.planes.code.partial, false);
  });

  test('a filename containing a newline byte still digests (argv fallback path)', () => {
    const r = repo();
    write(r, 'src/app.js', 'v1\n');
    commitAll(r, 'seed');
    fs.writeFileSync(path.join(r, 'weird\nname.js'), 'nl\n');
    const s = computeTreeState(r);
    assert.equal(s.planes.code.partial, false);
    assert.ok(s.planes.code.dirty.includes('weird\nname.js'));
    const t = computeTreeState(r);
    assert.equal(t.planes.code.digest, s.planes.code.digest);
  });
});

describe('computeTreeState — worktree overlay cases', () => {
  test('untracked file in a nested directory is enumerated (-uall)', () => {
    const r = repo();
    write(r, 'src/app.js', 'v1\n');
    commitAll(r, 'seed');
    const base = computeTreeState(r);
    write(r, 'deep/nested/dir/new.js', 'fresh\n');
    const after = computeTreeState(r);
    assert.notEqual(after.planes.code.digest, base.planes.code.digest);
    assert.deepEqual(after.planes.code.dirty, ['deep/nested/dir/new.js']);
    assert.equal(after.planes.code.entryCount, base.planes.code.entryCount + 1);
  });

  test('deleted file drops from the digest; restore returns the original digest', () => {
    const r = repo();
    write(r, 'src/app.js', 'keep\n');
    write(r, 'src/gone.js', 'bye\n');
    commitAll(r, 'seed');
    const base = computeTreeState(r);

    fs.rmSync(path.join(r, 'src/gone.js'));
    const afterDelete = computeTreeState(r);
    assert.notEqual(afterDelete.planes.code.digest, base.planes.code.digest);
    assert.equal(afterDelete.planes.code.entryCount, base.planes.code.entryCount - 1);

    write(r, 'src/gone.js', 'bye\n');
    const restored = computeTreeState(r);
    assert.equal(restored.planes.code.digest, base.planes.code.digest);
  });

  test('cross-plane rename dirties both planes (union of old and new paths)', () => {
    const r = repo();
    write(r, 'notes/design.md', 'moved wholesale\n');
    commitAll(r, 'seed');
    sh(r, 'git', ['mv', 'notes/design.md', 'notes/design.js']);
    const s = computeTreeState(r);
    assert.ok(s.planes.doc.dirty.includes('notes/design.md'));
    assert.ok(s.planes.code.dirty.includes('notes/design.js'));
  });

  test('unstaged chmod +x changes the code digest (mode is content)', () => {
    const r = repo();
    write(r, 'scripts/run.sh', '#!/bin/sh\necho hi\n');
    commitAll(r, 'seed');
    const base = computeTreeState(r);
    fs.chmodSync(path.join(r, 'scripts/run.sh'), 0o755);
    const after = computeTreeState(r);
    assert.notEqual(after.planes.code.digest, base.planes.code.digest);
  });

  test('symlink digests by target string; retargeting changes the digest', () => {
    const r = repo();
    write(r, 'src/real.js', 'target\n');
    commitAll(r, 'seed');
    fs.symlinkSync('src/real.js', path.join(r, 'link.js'));
    const a = computeTreeState(r);
    assert.equal(a.planes.code.partial, false);
    fs.rmSync(path.join(r, 'link.js'));
    fs.symlinkSync('src/other.js', path.join(r, 'link.js'));
    const b = computeTreeState(r);
    assert.notEqual(b.planes.code.digest, a.planes.code.digest);
  });

  test('CRLF worktree content with autocrlf=input digests to the committed LF state', () => {
    const r = repo([['core.autocrlf', 'input']]);
    write(r, 'src/lines.js', 'a\nb\n');
    commitAll(r, 'seed');
    const base = computeTreeState(r);
    // Rewrite with CRLF: git's clean filter hashes it back to the LF blob.
    fs.writeFileSync(path.join(r, 'src/lines.js'), 'a\r\nb\r\n');
    const after = computeTreeState(r);
    assert.equal(after.planes.code.digest, base.planes.code.digest);
    assert.equal(after.planes.code.partial, false);
  });
});

describe('computeTreeState — commit survival (the anti-desync property)', () => {
  test('digest computed on a dirty tree survives git commit unchanged', () => {
    const r = repo();
    write(r, 'src/app.js', 'v1\n');
    write(r, 'docs/spec.md', '# v1\n');
    commitAll(r, 'seed');
    write(r, 'src/app.js', 'v2\n');
    write(r, 'docs/spec.md', '# v2\n');
    write(r, 'src/new.js', 'added\n');

    const dirty = computeTreeState(r);
    assert.ok(dirty.planes.code.dirty.length > 0);
    commitAll(r, 'land the change');
    const clean = computeTreeState(r);

    assert.equal(clean.planes.code.digest, dirty.planes.code.digest);
    assert.equal(clean.planes.doc.digest, dirty.planes.doc.digest);
    assert.deepEqual(clean.planes.code.dirty, []);
    assert.deepEqual(clean.planes.doc.dirty, []);
  });

  test('staged-but-uncommitted state digests the same as its unstaged form', () => {
    const r = repo();
    write(r, 'src/app.js', 'v1\n');
    commitAll(r, 'seed');
    write(r, 'src/app.js', 'v2\n');
    const unstaged = computeTreeState(r);
    sh(r, 'git', ['add', 'src/app.js']);
    const staged = computeTreeState(r);
    assert.equal(staged.planes.code.digest, unstaged.planes.code.digest);
  });
});

describe('computeTreeState — fail-closed partial semantics', () => {
  test('merge conflict → conflicted plane partial with null digest, other plane intact', () => {
    const r = repo();
    write(r, 'src/app.js', 'base\n');
    write(r, 'docs/spec.md', '# stable\n');
    commitAll(r, 'seed');
    sh(r, 'git', ['checkout', '-q', '-b', 'side']);
    write(r, 'src/app.js', 'side\n');
    commitAll(r, 'side change');
    sh(r, 'git', ['checkout', '-q', 'main']);
    write(r, 'src/app.js', 'main\n');
    commitAll(r, 'main change');
    try {
      sh(r, 'git', ['merge', 'side'], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      /* conflict expected */
    }

    const s = computeTreeState(r);
    assert.equal(s.planes.code.partial, true);
    assert.equal(s.planes.code.digest, null);
    assert.equal(s.planes.doc.partial, false);
    assert.match(s.planes.doc.digest, /^sha256:/);
    assert.ok(s.partialReasons.some(x => x.reason === 'merge-conflict'));
  });

  test('not-a-repo → both planes partial, digest null, never throws', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    try {
      const s = computeTreeState(dir);
      assert.equal(s.planes.code.partial, true);
      assert.equal(s.planes.doc.partial, true);
      assert.equal(s.planes.code.digest, null);
      assert.equal(s.planes.doc.digest, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('file over the size cap → its plane partial (loud skip, never a guessed digest)', () => {
    const r = repo();
    write(r, 'src/app.js', 'v1\n');
    commitAll(r, 'seed');
    write(r, 'blob.bin', 'x'.repeat(4096));
    const s = computeTreeState(r, { maxFileBytes: 1024 });
    assert.equal(s.planes.code.partial, true);
    assert.equal(s.planes.code.digest, null);
    assert.ok(s.partialReasons.some(x => x.reason === 'file-exceeds-size-cap'));
  });

  test('unreadable modified file → its plane partial', t => {
    if (process.getuid && process.getuid() === 0) {
      t.skip('root reads through permission bits');
      return;
    }
    const r = repo();
    write(r, 'src/locked.js', 'v1\n');
    commitAll(r, 'seed');
    write(r, 'src/locked.js', 'v2\n');
    const abs = path.join(r, 'src/locked.js');
    fs.chmodSync(abs, 0o000);
    try {
      const s = computeTreeState(r);
      assert.equal(s.planes.code.partial, true);
      assert.equal(s.planes.code.digest, null);
    } finally {
      fs.chmodSync(abs, 0o644);
    }
  });
});

describe('computeTreeState — submodules (gitlink three-state rule)', () => {
  function makeSubmoduleRepo() {
    const sub = repo();
    write(sub, 'lib.js', 'module.exports = 1;\n');
    commitAll(sub, 'sub seed');
    const host = repo([['protocol.file.allow', 'always']]);
    write(host, 'src/app.js', 'host\n');
    commitAll(host, 'host seed');
    sh(host, 'git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub']);
    commitAll(host, 'add submodule');
    // The submodule checkout is a fresh clone — it inherits nothing from sub's
    // local config, and CLEAN_GIT_ENV points HOME at a gitconfig-less tmpdir.
    // Commits inside vendor/sub then depend on git's OS ident guess, which works
    // on macOS (GECOS populated) and fatals on CI runners (empty ident name).
    const subCheckout = path.join(host, 'vendor/sub');
    sh(subCheckout, 'git', ['config', 'user.name', 'Digest Tester']);
    sh(subCheckout, 'git', ['config', 'user.email', 'digest-tester@example.invalid']);
    return { host, sub };
  }

  test('clean submodule at index commit → digest stable and non-partial', () => {
    const { host } = makeSubmoduleRepo();
    const a = computeTreeState(host);
    const b = computeTreeState(host);
    assert.equal(a.planes.code.partial, false);
    assert.equal(a.planes.code.digest, b.planes.code.digest);
  });

  test('submodule checked out at a different commit → digest changes, still not partial', () => {
    const { host } = makeSubmoduleRepo();
    const base = computeTreeState(host);
    const subPath = path.join(host, 'vendor/sub');
    write(host, 'vendor/sub/extra.js', 'more\n');
    sh(subPath, 'git', ['add', '-A']);
    sh(subPath, 'git', ['commit', '-q', '-m', 'advance']);
    const after = computeTreeState(host);
    assert.equal(after.planes.code.partial, false);
    assert.notEqual(after.planes.code.digest, base.planes.code.digest);
  });

  test('submodule dirty inside → host code plane partial (no OID names that content)', () => {
    const { host } = makeSubmoduleRepo();
    write(host, 'vendor/sub/lib.js', 'mutated, uncommitted\n');
    const s = computeTreeState(host);
    assert.equal(s.planes.code.partial, true);
    assert.equal(s.planes.code.digest, null);
    assert.ok(s.partialReasons.some(x => x.reason === 'submodule-dirty-inside'));
  });

  test('uninitialized submodule (no porcelain record at all) → partial, not index-frozen', () => {
    const { host } = makeSubmoduleRepo();
    // Deinit empties the checkout: git status reports nothing for the path, but
    // the index OID no longer names any on-disk content — §3.2 says partial.
    sh(host, 'git', ['submodule', 'deinit', '-f', '-q', 'vendor/sub']);
    const s = computeTreeState(host);
    assert.equal(s.planes.code.partial, true);
    assert.equal(s.planes.code.digest, null);
    assert.ok(
      s.partialReasons.some(x => x.reason === 'submodule-uninitialized-or-unreadable')
    );
    // Negative control for the R4-1 dirtying rule: an EMPTY checkout provably
    // hides nothing, so the ordinary uninitialized clone must not carry a
    // permanent obligation (owed stays derivable as false on a clean tree).
    assert.ok(!s.planes.code.dirty.includes('vendor/sub'));
  });

  test('submodule-local status.showUntrackedFiles=no cannot hide an untracked file inside', () => {
    const { host } = makeSubmoduleRepo();
    const subPath = path.join(host, 'vendor/sub');
    sh(subPath, 'git', ['config', 'status.showUntrackedFiles', 'no']);
    write(host, 'vendor/sub/untracked.js', 'never added\n');
    // The gitlink pass runs status with an explicit -uall, which overrides the
    // submodule-local suppression — the dirty checkout must still read dirty.
    const s = computeTreeState(host);
    assert.equal(s.planes.code.partial, true);
    assert.equal(s.planes.code.digest, null);
    assert.ok(s.partialReasons.some(x => x.reason === 'submodule-dirty-inside'));
  });

  test('status-suppressed (ignore=all) moved submodule still overlays its real HEAD', () => {
    const { host } = makeSubmoduleRepo();
    const base = computeTreeState(host);
    sh(host, 'git', ['config', 'submodule.vendor/sub.ignore', 'all']);
    const subPath = path.join(host, 'vendor/sub');
    write(host, 'vendor/sub/extra.js', 'more\n');
    sh(subPath, 'git', ['add', '-A']);
    sh(subPath, 'git', ['commit', '-q', '-m', 'advance under ignore=all']);
    // Porcelain now hides the moved submodule; the gitlink pass must not.
    const after = computeTreeState(host);
    assert.equal(after.planes.code.partial, false);
    assert.notEqual(after.planes.code.digest, base.planes.code.digest);
    // R4-1 companion: the divergence is also an OBLIGATION — a checkout
    // resolved at an OID other than the index's is a real change, and with
    // porcelain suppressed this dirtying is the only source owed can have.
    assert.ok(after.planes.code.dirty.includes('vendor/sub'));
  });

  test('ignore=all + dirty inside → the gitlink dirties its plane (owed derivable, R4-1)', () => {
    const { host } = makeSubmoduleRepo();
    sh(host, 'git', ['config', 'submodule.vendor/sub.ignore', 'all']);
    write(host, 'vendor/sub/untracked.js', 'never added\n');
    // Porcelain reports nothing; the nested status is the only read that sees
    // the change, so the gitlink pass must feed the dirty set itself — partial
    // alone only blocks digest closure, it does not create the obligation.
    const s = computeTreeState(host);
    assert.equal(s.planes.code.partial, true);
    assert.equal(s.planes.code.digest, null);
    assert.ok(s.partialReasons.some(x => x.reason === 'submodule-dirty-inside'));
    assert.ok(s.planes.code.dirty.includes('vendor/sub'));
  });

  test('unreadable submodule directory → dirty (cannot prove emptiness, fail-closed)', t => {
    if (process.getuid && process.getuid() === 0) {
      t.skip('root reads through permission bits');
      return;
    }
    const { host } = makeSubmoduleRepo();
    sh(host, 'git', ['config', 'submodule.vendor/sub.ignore', 'all']);
    const subPath = path.join(host, 'vendor/sub');
    fs.chmodSync(subPath, 0o000);
    let s;
    try {
      s = computeTreeState(host);
    } finally {
      fs.chmodSync(subPath, 0o755);
    }
    assert.equal(s.planes.code.partial, true);
    assert.ok(
      s.partialReasons.some(x => x.reason === 'submodule-uninitialized-or-unreadable')
    );
    // Unlike the empty deinit'd checkout, EACCES proves nothing about content:
    // the plane must be owed.
    assert.ok(s.planes.code.dirty.includes('vendor/sub'));
  });

  test('warn-and-omit INSIDE a submodule degrades the gitlink — never reads as clean (R3-2)', t => {
    if (process.getuid && process.getuid() === 0) {
      t.skip('root reads through permission bits');
      return;
    }
    const { host } = makeSubmoduleRepo();
    // ignore=all suppresses the superproject's porcelain record, so the
    // gitlink pass's own nested status is the ONLY read that can see inside.
    sh(host, 'git', ['config', 'submodule.vendor/sub.ignore', 'all']);
    const locked = path.join(host, 'vendor/sub', 'locked');
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'hidden.js'), '1\n');
    fs.chmodSync(locked, 0o000);
    // The nested status exits 0 and merely WARNS it omitted the directory; a
    // discarded warning would return the old HEAD OID and certify a tree with
    // a hiding place inside it.
    let s;
    try {
      s = computeTreeState(host);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
    assert.equal(s.planes.code.partial, true);
    assert.equal(s.planes.code.digest, null);
    assert.ok(s.partialReasons.some(x => x.reason === 'submodule-unreadable'));
    // R4-1: detection alone is not enough — with porcelain suppressed, this
    // dirtying is the only thing standing between the hidden content and a
    // derived owed=false.
    assert.ok(s.planes.code.dirty.includes('vendor/sub'));
  });
});
