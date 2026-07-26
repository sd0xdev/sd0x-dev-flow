/**
 * cleanup.js — the scratch-directory delete must REFUSE anything that is not a mktemp -d leaf.
 *
 * This guard replaced a prose instruction ("re-read the path before running the delete") that no
 * mechanism executed. The specific accident it exists for: on macOS `TMPDIR` is ambient and already
 * points at the SHARED temp root, so the natural mis-substitution names a path exactly one level
 * above the scratch directory — and a recursive delete there takes out every other process's
 * scratch space. Each refusal case below is one shape of that accident.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, dirname, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const script = resolve(__dirname, '../../../scripts/skills/necessity-audit/cleanup.js');

const made = [];
function scratch() {
  const d = mkdtempSync(join(tmpdir(), 'tmp.'));
  made.push(d);
  return d;
}

// Most refusal cases below are decided long BEFORE the token is read (shape, containment, symlink,
// marker presence), so they need a syntactically valid token to get that far — otherwise the test
// would pass on the usage error instead of the guard it names. `VALID_SHAPE` is that stand-in.
const VALID_SHAPE = 'a'.repeat(48);

function run(dir, token = VALID_SHAPE) {
  const args = [script];
  if (dir !== undefined) args.push('--dir', dir);
  if (token !== undefined && token !== null) args.push('--token', token);
  return spawnSync('node', args, { encoding: 'utf8' });
}

function claim(dir) {
  const r = spawnSync('node', [script, '--claim', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `claim should succeed: ${r.stderr}`);
  const m = /^token=([0-9a-f]{48})$/m.exec(r.stdout);
  assert.ok(m, `--claim must print the capability token, got: ${r.stdout}`);
  return m[1];
}

test('removes a genuine CLAIMED mktemp -d scratch directory, contents included', () => {
  const d = scratch();
  const tok = claim(d);
  mkdirSync(join(d, 'nested'));
  writeFileSync(join(d, 'nested', 'report.md'), '# audit');

  const r = run(d, tok);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(d), false, 'the scratch directory must be gone');
});

test('a second run on an already-removed directory succeeds (idempotent after a partial failure)', () => {
  const d = scratch();
  const tok = claim(d);
  assert.equal(run(d, tok).status, 0);
  const again = run(d, tok);
  assert.equal(again.status, 0, 'a re-run must not error');
  assert.match(again.stdout, /already absent/);
});

test('REFUSES the shared temp root — the ambient-TMPDIR mistake — and deletes nothing', () => {
  const d = scratch();
  claim(d);
  const parent = dirname(d);
  const marker = join(parent, `sibling-${process.pid}-${Date.now()}.txt`);
  writeFileSync(marker, 'another process scratch');
  try {
    const r = run(parent);
    assert.equal(r.status, 1, 'the shared root must be refused');
    assert.match(r.stderr, /not a mktemp -d leaf/);
    assert.ok(existsSync(marker), "a refused delete must not touch anyone else's files");
    assert.ok(existsSync(d), 'nor the real scratch directory');
  } finally {
    rmSync(marker, { force: true });
  }
});

test('REFUSES an unsubstituted placeholder', () => {
  const r = run('<AUDIT_TMP_DIR>');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /never substituted/);
});

test('REFUSES a relative path (word-splitting / cwd-relative surprises)', () => {
  const r = run('relative/tmp.abcdefgh');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not an absolute path/);
});

test('REFUSES the filesystem root', () => {
  const r = run('/');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /filesystem root/);
});

test('REFUSES a correctly-named path OUTSIDE any system temp root', () => {
  // The leaf shape alone is forgeable — `~/tmp.deadbeef` passes it. The temp-root containment
  // check is what stops a scratch-looking name in a real working tree from being deleted.
  // Deliberately NOT under os.tmpdir(): a decoy created there would still satisfy the containment
  // check and the test would pass for the wrong reason. __dirname is a real working-tree path.
  const outside = mkdtempSync(join(__dirname, 'decoy-'));
  made.push(outside);
  const decoy = join(outside, 'tmp.deadbeef');
  mkdirSync(decoy);
  const r = run(decoy);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /not a direct child of the temp root/);
  assert.ok(existsSync(decoy), 'a refused delete must leave the directory intact');
});

test('REFUSES a symlink even when it is named like a scratch directory', () => {
  // Without the lstat check, rmSync would follow the link and delete the TARGET's contents — an
  // escape hatch out of the temp root that every preceding check would have approved.
  const real = scratch();
  writeFileSync(join(real, 'keep.txt'), 'payload');
  // Directly under the temp root: anywhere else and the direct-child rule refuses first, which
  // would make this test pass without ever reaching the symlink check.
  const link = join(tmpdir(), `tmp.sym${process.pid}x`);
  symlinkSync(real, link);
  made.push(link);
  const r = run(link);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /symlink/);
  assert.ok(existsSync(join(real, 'keep.txt')), 'the symlink target must be untouched');
});

test('REFUSES a path whose ANCESTOR is a symlink out of the temp root', () => {
  // The escape a purely LEXICAL containment check cannot see. `<tmpdir>/bridge` points at a real
  // working tree; `<tmpdir>/bridge/tmp.deadbeef` therefore *reads* as "a tmp.* directly under the
  // temp root" to any string-prefix test, while lstat on the final component sees an ordinary
  // directory — no symlink at the leaf to catch. A recursive delete there lands outside the temp
  // root entirely. Containment is decided on the REALPATH of the parent for exactly this case.
  const outsideTree = mkdtempSync(join(__dirname, 'ancestor-'));
  made.push(outsideTree);
  const victim = join(outsideTree, 'tmp.deadbeef');
  mkdirSync(victim);
  writeFileSync(join(victim, 'precious.txt'), 'a real working tree');

  const bridge = join(tmpdir(), `bridge-${process.pid}-ancestor`);
  symlinkSync(outsideTree, bridge);
  made.push(bridge);

  const r = run(join(bridge, 'tmp.deadbeef'));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /not a direct child of the temp root/);
  assert.ok(existsSync(join(victim, 'precious.txt')), 'the out-of-root target must survive');
});

test('REFUSES a plain file with a scratch-shaped name', () => {
  const file = join(tmpdir(), `tmp.file${process.pid}x`);
  writeFileSync(file, 'not a directory');
  made.push(file);
  const r = run(file);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a directory/);
});

// --- The claim marker: what makes this a delete of THIS run's directory ---

test("REFUSES an UNCLAIMED scratch directory — another process's tmp.* must not be deletable", () => {
  // The decisive case. Every check that precedes the marker (absolute, tmp.* leaf, direct child of
  // the temp root, real directory) is satisfied by EVERY concurrent process's scratch directory, so
  // shape alone cannot distinguish "the path Phase 0 printed" from "a different valid scratch dir".
  // A mis-substitution naming someone else's would have passed and deleted their work.
  const other = scratch();
  writeFileSync(join(other, 'their-work.txt'), 'not ours');

  const r = run(other);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /carries no \.necessity-audit-scratch marker/);
  assert.ok(existsSync(join(other, 'their-work.txt')), 'an unclaimed directory must survive intact');
});

test('REFUSES to claim a NON-EMPTY directory (mktemp -d hands back an empty one)', () => {
  // Otherwise the marker could be retrofitted onto a directory already holding someone's data,
  // which would launder exactly the case the marker exists to reject.
  const other = scratch();
  writeFileSync(join(other, 'their-work.txt'), 'not ours');
  const r = spawnSync('node', [script, '--claim', other], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not empty/);
  assert.ok(existsSync(join(other, 'their-work.txt')));
});

test('REFUSES when the marker is a directory rather than a regular file', () => {
  const d = scratch();
  mkdirSync(join(d, '.necessity-audit-scratch'));
  const r = run(d);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a regular file/);
  assert.ok(existsSync(d));
});

test('--claim refuses a directory that does not exist', () => {
  const d = scratch();
  rmSync(d, { recursive: true, force: true });
  const r = spawnSync('node', [script, '--claim', d], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not exist/);
});

// --- The capability token: what makes this a delete of THIS run's directory ---

test("REFUSES another run's CLAIMED directory — the case marker-presence alone could not catch", () => {
  // The decisive case for the token, and the one the marker-presence check leaves wide open.
  // Two audits running concurrently BOTH hold valid markers, so "is claimed by this skill" is true
  // of each. Only the token distinguishes them. Without it, a substituted path naming run A's
  // directory passes every guard — shape, containment, real directory, regular marker file — and
  // deletes A's in-progress work while A is still using it.
  const a = scratch();
  const b = scratch();
  const tokenA = claim(a);
  const tokenB = claim(b);
  assert.notEqual(tokenA, tokenB, 'each claim must mint its own token');
  writeFileSync(join(a, 'run-a-work.md'), 'A is still using this');

  const r = run(a, tokenB);
  assert.equal(r.status, 1, "run B's token must not authorize deleting run A's directory");
  assert.match(r.stderr, /does not match the token/);
  assert.ok(existsSync(join(a, 'run-a-work.md')), "run A's work must survive");

  // …and the correct token still works, so the guard is a binding, not a blanket refusal.
  assert.equal(run(a, tokenA).status, 0);
  assert.equal(existsSync(a), false);
});

test('REFUSES a malformed token without ever reaching the filesystem delete', () => {
  const d = scratch();
  claim(d);
  for (const bad of ['', 'short', 'A'.repeat(48), `${'a'.repeat(47)}g`, 'a'.repeat(49)]) {
    const r = run(d, bad);
    assert.equal(r.status, bad === '' ? 2 : 1, `token ${JSON.stringify(bad)} must be rejected`);
    assert.ok(existsSync(d), 'the directory must survive a malformed token');
  }
});

test('REFUSES a marker that carries no token (pre-capability or tampered)', () => {
  // A marker in the OLD format authorized deletion by its mere presence. Accepting it now would
  // preserve exactly the hole the token closes, so it is refused rather than grandfathered.
  const d = scratch();
  writeFileSync(join(d, '.necessity-audit-scratch'), 'necessity-audit scratch\npid=123\n');
  const r = run(d);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /carries no usable token/);
  assert.ok(existsSync(d));
});

test('--claim refuses to re-mint over an existing marker (would orphan the live owner)', () => {
  // Re-claiming a directory someone else is using would hand the caller a token that outranks the
  // real owner's — turning the guard into a way to STEAL a directory rather than protect one.
  const d = scratch();
  const first = claim(d);
  const r = spawnSync('node', [script, '--claim', d], { encoding: 'utf8' });
  assert.equal(r.status, 1, 're-claiming must fail');
  // Still empty-check first (the marker makes it non-empty), and the original token still works.
  assert.equal(run(d, first).status, 0);
});

test('exits 2 on usage error rather than guessing a target', () => {
  const r = run(undefined);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

test.after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

// --- The swap window, driven through the real removal code ---
//
// These import the production helpers rather than modelling the primitive in a `node -e` snippet.
// The earlier version of the first test did model it, and the model is what made the bug survive:
// it reproduced the identity CHECK faithfully and then hand-wrote a `rmSync(path, {recursive})`
// after it, which is exactly the shape that check fails to bind — so the test passed while the
// production line it stood in for was unsafe. Driving the real functions removes the gap between
// "what the test proves" and "what ships".

const {
  removeVerified, emptyVerifiedDir, removeEmptiedDir, removePinnedEntry, CLAIM_FILE,
} = require('../../../scripts/skills/necessity-audit/cleanup');
const { openSync, closeSync, renameSync, readdirSync, readFileSync, lstatSync } = require('node:fs');
const { constants } = require('node:fs');

function pin(dir) {
  return openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
}

test('a directory swapped in after the token matched is NOT deleted', () => {
  // The check the token alone does not provide. Every guard — containment, symlink, marker,
  // token — inspects a PATH. A concurrent process that renames the validated directory away and
  // drops a different real `tmp.*` in its place would get that substitute deleted instead. The
  // token proves which directory was INSPECTED, not which one is about to be REMOVED.
  const victim = scratch();
  writeFileSync(join(victim, 'precious'), 'do not delete');

  const owned = scratch();
  claim(owned);
  const parked = `${owned}.parked`;

  const fd = pin(owned);
  try {
    // ... marker read + token compare happen here in production, against the pinned directory ...
    renameSync(owned, parked);
    renameSync(victim, owned);
    made.push(parked);

    assert.throws(
      () => removeVerified(owned, fd),
      /replaced after validation/,
      'the identity re-check must abort the removal'
    );
  } finally {
    closeSync(fd);
  }

  assert.equal(
    existsSync(join(owned, 'precious')),
    true,
    'the substituted directory must survive — deleting it is the whole point of the swap'
  );
});

test('a NON-EMPTY directory swapped in at the last instant before rmdir is refused, not erased', () => {
  // The residual window, exercised deterministically. Both halves of the removal are synchronous,
  // so nothing in-process can interleave between them; the seam is the only way to stand where an
  // attacker with a real race would stand — after the authorized inode has been emptied, before the
  // name is removed. Every check has already passed at this point, so nothing is left to detect the
  // swap. What protects the substitute is the SHAPE of the last step: `rmdir` cannot remove a
  // non-empty directory.
  //
  // Mutation check: restoring `fs.rmSync(resolved, {recursive: true, force: true})` as the final
  // step turns this red — `precious` is deleted and no refusal is thrown.
  const owned = scratch();
  writeFileSync(join(owned, 'audit-report.md'), '# scratch');
  const fd = pin(owned);

  try {
    emptyVerifiedDir(owned, fd);
    assert.deepEqual(readdirSync(owned), [], 'the authorized directory is emptied through the fd');
  } finally {
    closeSync(fd);
  }

  const victim = scratch();
  writeFileSync(join(victim, 'precious'), 'do not delete');
  const parked = `${owned}.parked`;
  renameSync(owned, parked);
  renameSync(victim, owned);
  made.push(parked);

  assert.throws(
    () => removeEmptiedDir(owned),
    /not empty at the final removal step/,
    'the swap must be reported rather than silently absorbed'
  );
  assert.equal(
    readFileSync(join(owned, 'precious'), 'utf8'),
    'do not delete',
    'the substitute and its contents must be intact'
  );
});

test('the residual is bounded: a swap at the seam can cost at most one EMPTY directory', () => {
  // The honest other half of the test above. `rmdir` protects the substitute only because it has
  // contents; an EMPTY substitute is still removed, and this asserts that outcome rather than
  // leaving the comment in cleanup.js as an unverified claim. It is the whole residual, and it
  // destroys nothing — which is the difference between this design and a narrower race window on a
  // recursive delete.
  const owned = scratch();
  const fd = pin(owned);
  try {
    emptyVerifiedDir(owned, fd);
  } finally {
    closeSync(fd);
  }

  const empty = scratch();
  const parked = `${owned}.parked`;
  renameSync(owned, parked);
  renameSync(empty, owned);
  made.push(parked);

  removeEmptiedDir(owned);
  assert.equal(existsSync(owned), false, 'an empty substitute is removed — nothing is lost');
});

// --- The same window on a REGULAR FILE ---
//
// The directory tests above cover the recursive path. The file path used to be `lstat -> compare ->
// unlink`, re-resolving the name at the destructive step, so a substitution landing in that second
// window was DESTROYED rather than reported. Injection is a one-shot patch of `fs.renameSync`:
// cleanup.js does `const fs = require('fs')` and then calls `fs.renameSync(...)`, so the property is
// looked up per call and the patch reaches the real production code path. The swap runs immediately
// before the isolation rename delegates — i.e. exactly after the identity was observed — which is
// the window the fix has to close. No sleeps, no racing.

const nodeFs = require('node:fs');

function withSwapBeforeFirstRename(doSwap, body) {
  const realRename = nodeFs.renameSync;
  let fired = false;
  nodeFs.renameSync = (from, to) => {
    if (!fired) {
      fired = true;
      doSwap(realRename);
    }
    return realRename(from, to);
  };
  try {
    return body();
  } finally {
    nodeFs.renameSync = realRename;
    assert.equal(fired, true, 'the injection never fired — the test proved nothing about the window');
  }
}

test('a regular file substituted after its identity was observed is RELOCATED, not destroyed', () => {
  const owned = scratch();
  claim(owned);
  const doomed = join(owned, 'artifact.txt');
  writeFileSync(doomed, 'ours');

  const victimHome = scratch();
  const victim = join(victimHome, 'precious.txt');
  writeFileSync(victim, 'do not delete');

  const fd = pin(owned);
  try {
    withSwapBeforeFirstRename(
      (realRename) => {
        // ... the identity was observed here in production; the swap lands now ...
        realRename(doomed, join(owned, 'artifact.parked'));
        realRename(victim, doomed);
      },
      () => {
        assert.throws(
          () => emptyVerifiedDir(owned, fd),
          /substituted between inspection and removal/,
          'the substitution must abort the removal'
        );
      }
    );
  } finally {
    closeSync(fd);
  }

  // The victim is no longer at its own path — the isolation rename moved it — but it must still
  // EXIST. Relocation is recoverable; deletion is not, and deletion is what used to happen.
  const survivors = readdirSync(owned)
    .filter((n) => n.startsWith('.quarantine-'))
    .map((n) => readFileSync(join(owned, n), 'utf8'));
  assert.deepEqual(
    survivors,
    ['do not delete'],
    "the substituted file must survive under quarantine — destroying it is the whole point of the swap"
  );
});

test('the ordinary case leaves NO quarantine residue behind', () => {
  // Non-vacuity control for the test above. If `unlinkVerified` merely renamed and never unlinked,
  // the substitution test would still pass (the victim survives either way) while every ordinary
  // delete silently leaked a `.quarantine-*` file. This pins that the happy path completes.
  const owned = scratch();
  claim(owned);
  writeFileSync(join(owned, 'artifact.txt'), 'ours');
  mkdirSync(join(owned, 'nested'));
  writeFileSync(join(owned, 'nested', 'deep.txt'), 'ours too');

  const fd = pin(owned);
  try {
    emptyVerifiedDir(owned, fd);
  } finally {
    closeSync(fd);
  }
  assert.deepEqual(readdirSync(owned), [], 'the directory must be fully emptied, quarantine included');
});

/**
 * Strip comments so a structural scan sees CODE only.
 *
 * Without this, the forbidden-shape assertion below matched the block comment in cleanup.js that
 * explains why `rmSync(resolved, {recursive: true})` is unsafe — the test would have forced the
 * documentation to stop naming the very shape it warns about, which is how that warning decays into
 * something unfalsifiable. Naming a dangerous construct in prose must stay free; only writing it
 * must not.
 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

test('the destructive phase never routes through a re-resolvable path', () => {
  // Structural pin for the property the runtime tests above can only sample. The recursive delete
  // must take a RELATIVE name (resolved from the pinned cwd inode); the only step allowed to take
  // the absolute path is the non-destructive `rmdir`. A future edit that "simplifies" the loop back
  // into one `rmSync(resolved, {recursive: true})` reopens the P0 and turns this red.
  const src = readFileSync(script, 'utf8');

  const fdOpen = src.indexOf('O_DIRECTORY');
  const markerRead = src.indexOf('readMarkerToken(claim)');
  const removal = src.indexOf('removeVerified(resolved, dirFd)');

  assert.ok(fdOpen > 0 && markerRead > 0 && removal > 0, 'all three landmarks must be present');
  assert.ok(fdOpen < markerRead, 'the fd must be pinned BEFORE the marker is read');
  assert.ok(markerRead < removal, 'the marker must be read before removal');
  assert.match(src, /assertCwdIs\(dirFd, resolved\)/, 'the pinned fd must be the one compared at delete time');

  const code = codeOnly(src);
  // Non-vacuity: if the stripper ever over-reaches and empties the file, every doesNotMatch below
  // passes for free.
  assert.ok(code.includes('rmdirSync(resolved)'), 'the comment stripper must leave the code intact');

  // Stronger than the original `rmSync(resolved` ban: NO recursive delete may appear at all. A
  // recursive walk re-resolves every level it descends through, so it cannot be bound to the
  // inodes this file went to the trouble of pinning — whether it is handed an absolute path or a
  // relative one. The removal is unlink (one name, never follows a link) plus non-recursive rmdir.
  assert.doesNotMatch(
    code, /\brmSync\s*\(/,
    'no recursive delete may appear — every level must be descended through a verified descriptor'
  );
  assert.doesNotMatch(
    code, /recursive:\s*true/,
    'nothing in the destructive path may opt into recursion'
  );
  assert.match(code, /statSync\('\.'\)/, 'the cwd must be proven against the fd after chdir');
  assert.match(code, /rmdirSync\(resolved\)/, 'the only path-resolved step must be the non-recursive rmdir');

  // Enumeration→removal binding: the identity captured while listing must be the one checked at
  // removal, on BOTH the lstat and the opened-descriptor side. Losing either reopens the swap.
  assert.match(code, /planned\.push\(\{ name: entry, expect:/, 'enumeration must record each entry\'s inode');
  assert.match(code, /st\.dev !== expect\.dev/, 'the removal must re-check the enumerated identity');
  assert.match(code, /opened\.dev !== expect\.dev/, 'the OPENED descriptor must be checked against the enumerated identity');
  assert.match(code, /O_NOFOLLOW/, 'each descent must open the child without following symlinks');
});

test('a child swapped in after enumeration is NOT deleted', () => {
  // Codex P0, deterministic. Pinning the cwd proves the PARENT; each child is still reached by
  // name. A concurrent process that renames the enumerated child away and moves an unrelated
  // directory in under that name gets the substitute recursively deleted — and refusing symlinks
  // does not help, because the substitute is a real directory, exactly what a recursive walk
  // expects. Opening the child O_NOFOLLOW does not help either when the swap lands FIRST: open,
  // chdir and the dev/ino proof are then all self-consistent on the substitute.
  //
  // Driven through the real `removePinnedEntry` with the identity captured BEFORE the swap, which
  // is precisely what enumeration does — no racing, no sleep, no guessed PID.
  const owned = scratch();
  claim(owned);
  mkdirSync(join(owned, 'child'));
  writeFileSync(join(owned, 'child', 'ours'), 'x');

  const victim = scratch();
  writeFileSync(join(victim, 'precious'), 'do not delete');

  const fd = pin(owned);
  const cwd0 = process.cwd();
  try {
    process.chdir(owned);
    const st = lstatSync('child');
    const expect = { dev: st.dev, ino: st.ino, dir: st.isDirectory() };

    // ... the swap lands here, after enumeration recorded the identity ...
    renameSync(join(owned, 'child'), `${owned}.parked-child`);
    made.push(`${owned}.parked-child`);
    renameSync(victim, join(owned, 'child'));

    assert.throws(
      () => removePinnedEntry(fd, 'child', owned, expect),
      /no longer the entry this directory enumerated/,
      'the enumerated identity must bind the removal'
    );
  } finally {
    try { process.chdir(cwd0); } catch { /* nothing useful to do */ }
    closeSync(fd);
  }

  assert.equal(
    existsSync(join(owned, 'child', 'precious')),
    true,
    'the substituted directory must survive — deleting it is the whole point of the swap'
  );
});

// chmod cannot obstruct root, so the partial-failure the test depends on never happens there and
// it would pass whether or not the marker survives. Skipping keeps the green signal truthful.
const SKIP_AS_ROOT =
  typeof process.getuid === 'function' && process.getuid() === 0
    ? 'root ignores the 0o500 obstruction, so no partial failure occurs'
    : false;

test('the claim marker is removed LAST, so a partial failure can still be retried', { skip: SKIP_AS_ROOT }, () => {
  // The header promises "removal is idempotent — a re-run after a partial failure is safe". The
  // marker is what authorizes the re-run, and it was being deleted in enumeration order: any
  // later child that failed left the directory half-emptied AND unclaimed, so the retry refused
  // for want of the marker it had just removed. Recoverable only by hand.
  const owned = scratch();
  const tok = claim(owned);
  mkdirSync(join(owned, 'sub'));
  writeFileSync(join(owned, 'sub', 'f'), 'x');

  // Make one child un-removable so the purge aborts partway: a directory whose parent denies
  // write permission cannot have its entries unlinked.
  const { chmodSync } = require('node:fs');
  chmodSync(join(owned, 'sub'), 0o500);

  const first = run(owned, tok);
  assert.equal(first.status, 1, 'the blocked child must abort the removal');
  assert.equal(
    existsSync(join(owned, CLAIM_FILE)),
    true,
    'the marker must survive a partial failure — it is what authorizes the retry'
  );

  chmodSync(join(owned, 'sub'), 0o700);
  const second = run(owned, tok);
  assert.equal(second.status, 0, `the retry must succeed once the obstruction is gone: ${second.stderr}`);
  assert.equal(existsSync(owned), false, 'the retry must finish the removal');
});

test('the per-subdirectory descriptor pin is released — a deep tree does not leak one fd per level', () => {
  // `removePinnedEntry` opens a descriptor for every subdirectory it descends into and closes it in
  // a `finally`. That `finally` had no coverage: the CLI exits when it is done, so a missing
  // `closeSync` is invisible there, and it is only when the module is driven IN-PROCESS — which is
  // exactly how these suites and any future library consumer drive it — that the leak accumulates.
  //
  // Counted against /dev/fd rather than asserted structurally: a regex proving `closeSync` appears
  // in the source proves the characters are present, not that the descriptor is released on the
  // path actually taken.
  const countFds = () => readdirSync('/dev/fd').length;

  const owned = scratch();
  claim(owned);
  // 30 levels, so a leak is an unmistakable step rather than noise. Node keeps a handful of fds of
  // its own and the test runner may open more between samples, hence the tolerance below.
  const LEVELS = 30;
  let cursor = owned;
  for (let i = 0; i < LEVELS; i += 1) {
    cursor = join(cursor, `level-${i}`);
    mkdirSync(cursor);
    writeFileSync(join(cursor, 'file.txt'), 'x');
  }

  const before = countFds();
  const fd = pin(owned);
  try {
    removeVerified(owned, fd);
  } finally {
    closeSync(fd);
  }
  const after = countFds();

  // Non-vacuity: the work must actually have happened, or "no leak" is trivially true.
  assert.equal(existsSync(owned), false, 'the scratch directory must actually have been removed');
  assert.ok(
    after - before < 5,
    `descriptor count went ${before} → ${after} across a ${LEVELS}-level removal — ` +
      'the per-subdirectory pin is not being released'
  );
});
