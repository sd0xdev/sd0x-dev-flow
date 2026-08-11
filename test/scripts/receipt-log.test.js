'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const receiptLog = require('../../scripts/lib/receipt-log.js');
const { computeTreeState } = require('../../scripts/lib/tree-digest.js');

const RUNNER = path.resolve(__dirname, '../../scripts/precommit-runner.js');

const tmpRoots = [];
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
  tmpRoots.push(d);
  return d;
}

after(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

function makeRepo() {
  const dir = tmpDir('receipt-repo-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Receipt Tester'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'receipt-tester@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  return dir;
}

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function commitAll(dir, msg) {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', msg], { cwd: dir });
}

// Isolated env for a runner invocation: receipts land in cacheHome, tombstones in tmpHome.
function runnerEnv(cacheHome, tmpHome) {
  const env = { ...process.env, XDG_CACHE_HOME: cacheHome, TMPDIR: tmpHome + '/' };
  delete env.CLAUDE_PRECOMMIT_CACHE_DIR;
  return env;
}

function verdictFile(cacheHome, repo) {
  const slug = receiptLog.repoSlug(fs.realpathSync(repo));
  return path.join(cacheHome, 'sd0x-dev-flow', 'receipts', slug, 'verdicts.jsonl');
}

function readVerdicts(file) {
  return receiptLog.readRecords(file).records.filter(r => r.kind === 'verdict');
}

describe('receipt-log — location resolution and containment', () => {
  test('absolute XDG_CACHE_HOME is honoured; slug is basename--8hex of realpath', () => {
    const repo = makeRepo();
    const cache = tmpDir('cache-');
    const old = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = cache;
    try {
      const { file } = receiptLog.resolveReceiptPaths(repo);
      const slug = receiptLog.repoSlug(fs.realpathSync(repo));
      assert.match(slug, /^receipt-repo-.*--[0-9a-f]{8}$/);
      assert.equal(file, path.join(cache, 'sd0x-dev-flow', 'receipts', slug, 'verdicts.jsonl'));
    } finally {
      if (old === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = old;
    }
  });

  test('relative XDG_CACHE_HOME is ignored (falls back to HOME/.cache)', () => {
    const repo = makeRepo();
    const home = tmpDir('home-');
    const oldXdg = process.env.XDG_CACHE_HOME;
    const oldHome = process.env.HOME;
    process.env.XDG_CACHE_HOME = '.claude/cache';
    process.env.HOME = home;
    try {
      const { file } = receiptLog.resolveReceiptPaths(repo);
      assert.ok(file.startsWith(path.join(home, '.cache')));
    } finally {
      if (oldXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = oldXdg;
      process.env.HOME = oldHome;
    }
  });

  test('cache dir resolving inside the repo root is refused', () => {
    const repo = makeRepo();
    const old = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = path.join(fs.realpathSync(repo), 'cache');
    try {
      assert.throws(() => receiptLog.resolveReceiptPaths(repo), /inside the repo root/);
    } finally {
      if (old === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = old;
    }
  });

  test('two checkouts of one remote get different slugs (realpath keying)', () => {
    const a = makeRepo();
    const b = makeRepo();
    assert.notEqual(receiptLog.repoSlug(fs.realpathSync(a)), receiptLog.repoSlug(fs.realpathSync(b)));
  });

  test('a rejected in-repo cache config leaves ZERO artifacts inside the repo', () => {
    const repo = makeRepo();
    const inRepoCache = path.join(fs.realpathSync(repo), 'cache');
    const old = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = inRepoCache;
    try {
      assert.throws(() => receiptLog.resolveReceiptPaths(repo), /inside the repo root/);
      assert.equal(fs.existsSync(inRepoCache), false); // refused BEFORE creation
    } finally {
      if (old === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = old;
    }
  });

  test('a rejected in-repo tombstone config leaves ZERO artifacts inside the repo', () => {
    const repo = makeRepo();
    const inRepoTmp = path.join(fs.realpathSync(repo), 'tmp');
    const old = process.env.TMPDIR;
    process.env.TMPDIR = inRepoTmp;
    try {
      assert.throws(() => receiptLog.resolveTombstonePaths(repo), /inside the repo root/);
      assert.equal(fs.existsSync(inRepoTmp), false);
    } finally {
      if (old === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = old;
    }
  });
});

describe('receipt-log — append discipline and torn tails', () => {
  test('append then read round-trips records in order', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    receiptLog.appendRecords(file, [
      { v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:aa', verdict: 'pass' },
      { v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:bb', verdict: 'fail' },
    ]);
    const r = receiptLog.readRecords(file);
    assert.equal(r.records.length, 2);
    assert.equal(r.records[0].digest, 'sha256:aa');
    assert.equal(r.records[1].verdict, 'fail');
    assert.equal(r.malformed, 0);
  });

  test('reader ignores an unterminated final line; writer truncates it before appending', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:aa', verdict: 'pass' }]);
    fs.appendFileSync(file, '{"kind":"verdict","plane":"precom'); // torn tail, no newline
    const r1 = receiptLog.readRecords(file);
    assert.equal(r1.records.length, 1);
    assert.equal(r1.torn, true);

    receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:cc', verdict: 'pass' }]);
    const r2 = receiptLog.readRecords(file);
    assert.equal(r2.records.length, 2);
    assert.equal(r2.records[1].digest, 'sha256:cc');
    assert.equal(r2.torn, false);
  });

  test('a malformed line is counted, not thrown, and later records still parse', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    fs.writeFileSync(file, 'not json at all\n{"v":1,"kind":"verdict","plane":"precommit","digest":"sha256:aa","verdict":"pass"}\n');
    const r = receiptLog.readRecords(file);
    assert.equal(r.malformed, 1);
    assert.equal(r.records.length, 1);
  });

  test('a stale lockdir past its TTL is reclaimed instead of deadlocking', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    const lockdir = `${file}.lockdir`;
    fs.mkdirSync(lockdir, { recursive: true });
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(lockdir, past, past);
    receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:aa', verdict: 'pass' }], { timeoutMs: 2000 });
    assert.equal(receiptLog.readRecords(file).records.length, 1);
  });

  test('a live lockdir blocks until timeout (fail-loud, not fail-open)', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    fs.mkdirSync(`${file}.lockdir`, { recursive: true }); // fresh mtime = held
    assert.throws(
      () => receiptLog.appendRecords(file, [{ v: 1 }], { timeoutMs: 300 }),
      /lock timeout/
    );
  });

  test('a displaced lock holder can neither pass ownership verification nor release the new lock', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    const handle = receiptLog.acquireLock(file);
    // Simulate a TTL takeover while this holder is paused: the lockdir now
    // carries the new owner's token.
    fs.writeFileSync(path.join(handle.lockdir, 'owner'), 'someone-else');
    assert.throws(() => receiptLog.ensureOwned(handle), /ownership lost/);
    receiptLog.releaseLock(handle); // must refuse to remove the foreign lock
    assert.equal(fs.existsSync(handle.lockdir), true);
    fs.rmSync(handle.lockdir, { recursive: true, force: true });
  });

  test('an intact holder still owns its lock and releases it (negative control)', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    const handle = receiptLog.acquireLock(file);
    assert.doesNotThrow(() => receiptLog.ensureOwned(handle));
    receiptLog.releaseLock(handle);
    assert.equal(fs.existsSync(handle.lockdir), false);
  });

  test('a writer displaced after staging cannot clobber the new holder — commit is bound to lock identity', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:aa', verdict: 'pass' }]);
    assert.throws(
      () =>
        receiptLog.appendRecords(
          file,
          [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:bb', verdict: 'pass' }],
          {
            onBeforeCommit: handle => {
              // A real TTL takeover: the lockdir — staged file inside it — is
              // renamed away and removed, then a new holder locks and appends.
              const stale = `${handle.lockdir}.stale-test`;
              fs.renameSync(handle.lockdir, stale);
              fs.rmSync(stale, { recursive: true, force: true });
              receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:cc', verdict: 'fail' }]);
            },
          }
        ),
      /ownership lost|ENOENT/
    );
    // The displaced writer's bb never lands; the new holder's cc survives.
    assert.deepEqual(
      receiptLog.readRecords(file).records.map(r => r.digest),
      ['sha256:aa', 'sha256:cc']
    );
  });

  test('a takeover before staging cannot truncate the new holder — staged files are token-named', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:aa', verdict: 'pass' }]);
    let newHolderStaged = null;
    assert.throws(
      () =>
        receiptLog.appendRecords(
          file,
          [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:bb', verdict: 'pass' }],
          {
            onBeforeStage: handle => {
              // TTL takeover while the displaced holder is still reading: the
              // lockdir is replaced and the new holder has already staged.
              const stale = `${handle.lockdir}.stale-test`;
              fs.renameSync(handle.lockdir, stale);
              fs.rmSync(stale, { recursive: true, force: true });
              fs.mkdirSync(handle.lockdir, { mode: 0o700 });
              fs.writeFileSync(path.join(handle.lockdir, 'owner'), 'new-holder-token');
              newHolderStaged = path.join(handle.lockdir, 'staged-new-holder-token');
              fs.writeFileSync(newHolderStaged, 'NEW HOLDER STAGED BYTES');
            },
          }
        ),
      /ownership lost/
    );
    // The displaced holder staged under its OWN token — the new holder's staged
    // bytes were never opened, truncated, or committed over.
    assert.equal(fs.readFileSync(newHolderStaged, 'utf8'), 'NEW HOLDER STAGED BYTES');
    assert.deepEqual(receiptLog.readRecords(file).records.map(r => r.digest), ['sha256:aa']);
  });

  test('a directory-fsync I/O failure surfaces; platform-unsupported codes stay tolerated', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    const realFsync = fs.fsyncSync;
    // Call order inside appendRecords: staged-file fsync first, directory fsync second.
    let calls = 0;
    fs.fsyncSync = fd => {
      calls++;
      if (calls === 2) {
        const e = new Error('EIO: i/o error, fsync');
        e.code = 'EIO';
        throw e;
      }
      return realFsync(fd);
    };
    try {
      assert.throws(
        () => receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:aa', verdict: 'pass' }]),
        /directory fsync failed/
      );
    } finally {
      fs.fsyncSync = realFsync;
    }
    // Negative control: the unsupported-platform family is not a failure.
    calls = 0;
    fs.fsyncSync = fd => {
      calls++;
      if (calls === 2) {
        const e = new Error('EINVAL: operation not supported');
        e.code = 'EINVAL';
        throw e;
      }
      return realFsync(fd);
    };
    try {
      receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:bb', verdict: 'pass' }]);
    } finally {
      fs.fsyncSync = realFsync;
    }
    assert.equal(receiptLog.readRecords(file).records.length, 2);
  });

  test('short reads and short writes are looped to completion (1-byte syscalls still round-trip)', () => {
    const file = path.join(tmpDir('log-'), 'verdicts.jsonl');
    receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:aa', verdict: 'pass' }]);
    const realRead = fs.readSync;
    const realWrite = fs.writeSync;
    fs.readSync = (fd, buf, offset, length, position) => realRead(fd, buf, offset, Math.min(1, length), position);
    fs.writeSync = (fd, buf, offset, length, position) => realWrite(fd, buf, offset, Math.min(1, length), position);
    try {
      receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', plane: 'precommit', digest: 'sha256:bb', verdict: 'fail' }]);
    } finally {
      fs.readSync = realRead;
      fs.writeSync = realWrite;
    }
    const r = receiptLog.readRecords(file);
    assert.equal(r.records.length, 2);
    assert.equal(r.records[1].digest, 'sha256:bb');
    assert.equal(r.malformed, 0);
  });

  test('a symlinked log file is refused and its target is left untouched', () => {
    const dir = tmpDir('log-');
    const target = path.join(dir, 'victim.txt');
    fs.writeFileSync(target, 'precious content, no trailing newline');
    const file = path.join(dir, 'verdicts.jsonl');
    fs.symlinkSync(target, file);
    assert.throws(() => receiptLog.appendRecords(file, [{ v: 1 }]));
    assert.equal(fs.readFileSync(target, 'utf8'), 'precious content, no trailing newline');
  });
});

describe('receipt-log — verdict selection semantics', () => {
  const A = 'sha256:aaaa';
  const B = 'sha256:bbbb';

  test('newest verdict for (plane, current digest) governs; other digests are irrelevant', () => {
    const records = [
      { kind: 'verdict', plane: 'precommit', digest: A, verdict: 'pass' },
      { kind: 'verdict', plane: 'precommit', digest: B, verdict: 'fail' },
    ];
    const sel = receiptLog.selectVerdict(records, 'precommit', A);
    assert.equal(sel.verdict, 'pass'); // the later fail described a different tree
  });

  test('same-digest supersession: pass-then-fail on identical content → fail governs', () => {
    const records = [
      { kind: 'verdict', plane: 'precommit', digest: A, verdict: 'pass' },
      { kind: 'verdict', plane: 'precommit', digest: A, verdict: 'fail' },
    ];
    assert.equal(receiptLog.selectVerdict(records, 'precommit', A).verdict, 'fail');
  });

  test('settlement plane_results project as verdicts; "no-verdict" and foreign kinds never select', () => {
    const records = [
      { kind: 'dispatch', dispatch_id: 's1:1', planes: { code_review: A } },
      { kind: 'tombstone', id: 'x', pairs: [{ plane: 'code_review', digest: A }] },
      { kind: 'settlement', plane_results: { code_review: { digest: A, verdict: 'pass' } } },
      { kind: 'settlement', plane_results: { doc_review: { digest: B, verdict: 'no-verdict' } } },
    ];
    assert.equal(receiptLog.selectVerdict(records, 'code_review', A).verdict, 'pass');
    assert.equal(receiptLog.selectVerdict(records, 'doc_review', B), null);
  });

  test('a null (partial) current digest matches nothing — fail-closed', () => {
    const records = [{ kind: 'verdict', plane: 'precommit', digest: null, verdict: 'pass' }];
    assert.equal(receiptLog.selectVerdict(records, 'precommit', null), null);
  });
});

describe('receipt-log — tombstone fallback', () => {
  function withTmpEnv(fn) {
    const tmpHome = tmpDir('tomb-');
    const old = process.env.TMPDIR;
    process.env.TMPDIR = tmpHome + '/';
    try {
      return fn(tmpHome);
    } finally {
      if (old === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = old;
    }
  }

  test('append → read round-trip; ids match by full (plane, digest, id) tuple', () => {
    withTmpEnv(() => {
      const repo = makeRepo();
      const rec = receiptLog.appendTombstone(repo, [{ plane: 'precommit', digest: 'sha256:aa' }]);
      assert.match(rec.id, /^[0-9a-f-]{36}$/);
      const ts = receiptLog.readTombstones(repo);
      assert.equal(ts.ok, true);
      assert.equal(ts.records.length, 1);
      assert.deepEqual(receiptLog.matchingTombstoneIds(ts.records, 'precommit', 'sha256:aa'), [rec.id]);
      assert.deepEqual(receiptLog.matchingTombstoneIds(ts.records, 'precommit', 'sha256:bb'), []);
      assert.deepEqual(receiptLog.matchingTombstoneIds(ts.records, 'code_review', 'sha256:aa'), []);
    });
  });

  test('malformed fallback content → ok:false (unresolved for every pair, over-block)', () => {
    withTmpEnv(tmpHome => {
      const repo = makeRepo();
      receiptLog.appendTombstone(repo, [{ plane: 'precommit', digest: 'sha256:aa' }]);
      const file = path.join(tmpHome, 'sd0x-dev-flow', `${receiptLog.repoSlug(fs.realpathSync(repo))}.tombstones.jsonl`);
      fs.appendFileSync(file, 'garbage line\n');
      const ts = receiptLog.readTombstones(repo);
      assert.equal(ts.ok, false);
    });
  });

  test('a tombstone with malformed pairs poisons the read fail-closed', () => {
    withTmpEnv(tmpHome => {
      const repo = makeRepo();
      const dir = path.join(tmpHome, 'sd0x-dev-flow');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${receiptLog.repoSlug(fs.realpathSync(repo))}.tombstones.jsonl`);
      fs.writeFileSync(file, JSON.stringify({ v: 1, kind: 'tombstone', id: 'no-pairs' }) + '\n');
      assert.equal(receiptLog.readTombstones(repo).ok, false);
    });
  });

  test('valid JSON with malformed pair elements is still fail-closed: [null], [{}], []', () => {
    withTmpEnv(tmpHome => {
      const repo = makeRepo();
      const dir = path.join(tmpHome, 'sd0x-dev-flow');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${receiptLog.repoSlug(fs.realpathSync(repo))}.tombstones.jsonl`);
      for (const pairs of [[null], [{}], [], [{ plane: 'nonsense', digest: 'sha256:aa' }], [{ plane: 'precommit', digest: null }]]) {
        fs.writeFileSync(file, JSON.stringify({ v: 1, kind: 'tombstone', id: 'x', pairs }) + '\n');
        assert.equal(receiptLog.readTombstones(repo).ok, false, `pairs=${JSON.stringify(pairs)} must poison`);
      }
      // Negative control: the same envelope with one well-formed pair is healthy.
      fs.writeFileSync(file, JSON.stringify({ v: 1, kind: 'tombstone', id: 'x', pairs: [{ plane: 'precommit', digest: 'sha256:aa' }] }) + '\n');
      assert.equal(receiptLog.readTombstones(repo).ok, true);
    });
  });

  test('a symlink planted at the tombstone dir name is refused before resolution', () => {
    withTmpEnv(tmpHome => {
      const repo = makeRepo();
      const real = tmpDir('tomb-real-');
      fs.symlinkSync(real, path.join(tmpHome, 'sd0x-dev-flow'));
      assert.throws(() => receiptLog.resolveTombstonePaths(repo), /is a symlink/);
    });
  });

  test('a tombstone dir granting group/other access is refused; 0700 is the negative control', () => {
    withTmpEnv(tmpHome => {
      const repo = makeRepo();
      const dir = path.join(tmpHome, 'sd0x-dev-flow');
      fs.mkdirSync(dir, { recursive: true });
      fs.chmodSync(dir, 0o777);
      assert.throws(() => receiptLog.resolveTombstonePaths(repo), /group\/other access/);
      fs.chmodSync(dir, 0o700);
      assert.doesNotThrow(() => receiptLog.resolveTombstonePaths(repo));
    });
  });

  test('a symlink planted after the mkdir observation is still refused (race seam: beforeStat)', () => {
    withTmpEnv(tmpHome => {
      const repo = makeRepo();
      const target = tmpDir('tomb-target-');
      const dirPath = path.join(tmpHome, 'sd0x-dev-flow');
      assert.throws(
        () =>
          receiptLog.resolveTombstonePaths(repo, {
            beforeStat: () => {
              // Attacker wins the race right after our mkdir: the entry we
              // created is swapped for a symlink before we look at it.
              fs.rmdirSync(dirPath);
              fs.symlinkSync(target, dirPath);
            },
          }),
        /is a symlink/
      );
    });
  });

  test('a dir swapped for a symlink between lstat and resolution is refused by inode pinning (race seam: beforeResolve)', () => {
    withTmpEnv(tmpHome => {
      const repo = makeRepo();
      const target = tmpDir('tomb-target-');
      fs.chmodSync(target, 0o700);
      const dirPath = path.join(tmpHome, 'sd0x-dev-flow');
      assert.throws(
        () =>
          receiptLog.resolveTombstonePaths(repo, {
            beforeResolve: () => {
              // The lstat saw a healthy 0700 dir; the entry then becomes a
              // symlink to an equally healthy-looking owned 0700 target.
              fs.rmdirSync(dirPath);
              fs.symlinkSync(target, dirPath);
            },
          }),
        /changed during acquisition/
      );
    });
  });

  test('preflight refuses an unwritable (0500) tombstone fallback dir; 0700 is the negative control', () => {
    withTmpEnv(tmpHome => {
      const repo = makeRepo();
      const cacheHome = tmpDir('cache-');
      const oldXdg = process.env.XDG_CACHE_HOME;
      process.env.XDG_CACHE_HOME = cacheHome;
      try {
        const dir = path.join(tmpHome, 'sd0x-dev-flow');
        fs.mkdirSync(dir, { mode: 0o700 });
        fs.chmodSync(dir, 0o500);
        const r = receiptLog.preflightWritable(repo);
        assert.equal(r.ok, false, 'a fallback dir appendTombstone cannot write must fail preflight');
        fs.chmodSync(dir, 0o700);
        assert.equal(receiptLog.preflightWritable(repo).ok, true);
      } finally {
        if (oldXdg === undefined) delete process.env.XDG_CACHE_HOME;
        else process.env.XDG_CACHE_HOME = oldXdg;
      }
    });
  });

  test('appendTombstone refuses to mint malformed pairs at write time', () => {
    withTmpEnv(() => {
      const repo = makeRepo();
      assert.throws(() => receiptLog.appendTombstone(repo, []), /malformed pairs/);
      assert.throws(() => receiptLog.appendTombstone(repo, [{ plane: 'precommit', digest: null }]), /malformed pairs/);
      assert.throws(() => receiptLog.appendTombstone(repo, [null]), /malformed pairs/);
    });
  });
});

describe('precommit-runner — content-addressed verdict lands regardless of stdout fate', () => {
  function seedRunnableRepo(testScript) {
    const repo = makeRepo();
    // .claude/ is gitignored, as in any real consumer: the runner's own cache
    // writes must never perturb the digest they are being measured against.
    write(repo, '.gitignore', '.claude/\n');
    write(repo, 'package.json', JSON.stringify({
      name: 'receipt-fixture',
      version: '1.0.0',
      scripts: { test: testScript },
    }, null, 2) + '\n');
    write(repo, 'src/app.js', 'module.exports = 1;\n');
    commitAll(repo, 'seed');
    return repo;
  }

  test('>30KB stdout, piped and discarded — the verdict still lands with the current digest', () => {
    const cache = tmpDir('cache-');
    const tmpHome = tmpDir('tmp-');
    // 40KB of output reproduces the truncation-incident class; stdout is discarded entirely.
    const repo = seedRunnableRepo('node -e "process.stdout.write(\'x\'.repeat(40000) + \'\\n\')"');
    execFileSync(process.execPath, [RUNNER, '--mode', 'fast'], {
      cwd: repo,
      env: runnerEnv(cache, tmpHome),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const verdicts = readVerdicts(verdictFile(cache, repo));
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].verdict, 'pass');
    assert.equal(verdicts[0].mode, 'fast');
    assert.equal(verdicts[0].producer, 'precommit-runner');
    const now = computeTreeState(repo).planes.code;
    assert.equal(verdicts[0].digest, now.digest);
  });

  test('early-closing stdout pipe (EPIPE) — the runner survives and the verdict lands', async () => {
    const cache = tmpDir('cache-');
    const tmpHome = tmpDir('tmp-');
    // Enough post-close output to guarantee a write hits the dead pipe.
    const repo = seedRunnableRepo('node -e "process.stdout.write(\'y\'.repeat(20000) + \'\\n\')"');
    const child = spawn(process.execPath, [RUNNER, '--mode', 'fast'], {
      cwd: repo,
      env: runnerEnv(cache, tmpHome),
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    child.stdout.once('data', () => child.stdout.destroy()); // read a prefix, kill the pipe
    const code = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(code, 0);
    const verdicts = readVerdicts(verdictFile(cache, repo));
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].verdict, 'pass');
    assert.equal(verdicts[0].digest, computeTreeState(repo).planes.code.digest);
  });

  test('backgrounded (detached, stdio ignored) — the verdict still lands', async () => {
    const cache = tmpDir('cache-');
    const tmpHome = tmpDir('tmp-');
    const repo = seedRunnableRepo('node -e "process.exit(0)"');
    const child = spawn(process.execPath, [RUNNER, '--mode', 'fast'], {
      cwd: repo,
      env: runnerEnv(cache, tmpHome),
      detached: true,
      stdio: 'ignore',
    });
    const code = await new Promise(resolve => child.on('exit', resolve));
    assert.equal(code, 0);
    const verdicts = readVerdicts(verdictFile(cache, repo));
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].verdict, 'pass');
    assert.equal(verdicts[0].digest, computeTreeState(repo).planes.code.digest);
  });

  test('failing checks append a fail verdict naming the digest observed', () => {
    const cache = tmpDir('cache-');
    const tmpHome = tmpDir('tmp-');
    const repo = seedRunnableRepo('node -e "process.exit(1)"');
    try {
      execFileSync(process.execPath, [RUNNER, '--mode', 'fast'], {
        cwd: repo,
        env: runnerEnv(cache, tmpHome),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      /* runner exits 0 even on FAIL; tolerate either */
    }
    const verdicts = readVerdicts(verdictFile(cache, repo));
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].verdict, 'fail');
    assert.equal(verdicts[0].digest, computeTreeState(repo).planes.code.digest);
  });

  test('tree drift during checks → PASS receipt withheld, loudly; log stays empty', () => {
    const cache = tmpDir('cache-');
    const tmpHome = tmpDir('tmp-');
    // The test step mutates the tree after the baseline was captured, then passes.
    const repo = seedRunnableRepo(
      'node -e "require(\'fs\').writeFileSync(\'drifted.js\', \'x\')"'
    );
    const out = execFileSync(process.execPath, [RUNNER, '--mode', 'fast'], {
      cwd: repo,
      env: runnerEnv(cache, tmpHome),
      encoding: 'utf8',
    });
    assert.match(out, /receipt withheld/);
    assert.match(out, /## Overall: ✅ PASS/); // stdout untouched — only the receipt is withheld
    const verdicts = readVerdicts(verdictFile(cache, repo));
    assert.equal(verdicts.length, 0);
  });

  test('all-skip NO CHECKS RUN appends no verdict record in either direction', () => {
    const cache = tmpDir('cache-');
    const tmpHome = tmpDir('tmp-');
    const repo = makeRepo();
    write(repo, '.gitignore', '.claude/\n');
    write(repo, 'package.json', JSON.stringify({ name: 'no-scripts', version: '1.0.0' }, null, 2) + '\n');
    write(repo, 'src/app.js', 'x\n');
    commitAll(repo, 'seed');
    const out = execFileSync(process.execPath, [RUNNER, '--mode', 'fast'], {
      cwd: repo,
      env: runnerEnv(cache, tmpHome),
      encoding: 'utf8',
    });
    assert.match(out, /## Overall: ⚠️ NO CHECKS RUN/);
    assert.ok(!fs.existsSync(verdictFile(cache, repo)) || readVerdicts(verdictFile(cache, repo)).length === 0);
  });

  test('unwritable receipt location → runner refuses to run the gate (preflight)', () => {
    const tmpHome = tmpDir('tmp-');
    const repo = seedRunnableRepo('node -e "process.exit(0)"');
    // Cache home inside the repo root violates containment → preflight must refuse.
    const out = execFileSync(process.execPath, [RUNNER, '--mode', 'fast'], {
      cwd: repo,
      env: runnerEnv(path.join(fs.realpathSync(repo), 'cache'), tmpHome),
      encoding: 'utf8',
    });
    assert.match(out, /receipt log unwritable/);
    assert.match(out, /## Overall: ❌ FAIL/);
    assert.ok(!out.includes('> running')); // the gate itself never ran
  });

  test('a PASS resolves matching tombstones by full tuple in its resolves array', () => {
    const cache = tmpDir('cache-');
    const tmpHome = tmpDir('tmp-');
    const repo = seedRunnableRepo('node -e "process.exit(0)"');
    const digestNow = computeTreeState(repo).planes.code.digest;
    const oldTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmpHome + '/';
    let tomb;
    try {
      tomb = receiptLog.appendTombstone(repo, [{ plane: 'precommit', digest: digestNow }]);
    } finally {
      if (oldTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = oldTmp;
    }
    execFileSync(process.execPath, [RUNNER, '--mode', 'fast'], {
      cwd: repo,
      env: runnerEnv(cache, tmpHome),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const verdicts = readVerdicts(verdictFile(cache, repo));
    assert.equal(verdicts.length, 1);
    assert.equal(verdicts[0].verdict, 'pass');
    assert.deepEqual(verdicts[0].resolves, [
      { plane: 'precommit', digest: digestNow, id: tomb.id },
    ]);
  });
});
