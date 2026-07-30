#!/usr/bin/env node
'use strict';

/**
 * cleanup.js — guarded removal of the necessity-audit scratch directory.
 *
 * The delete is bound to a claim marker + capability token: `--claim` stamps a fresh `mktemp -d`
 * dir and prints an unguessable token; `--dir` refuses any directory that was never stamped or
 * whose token does not match. Why prose was not a control, and why shape checks and
 * presence-only markers were insufficient: docs/features/necessity-audit/4-implementation.md §1.
 *
 * CLI:
 *   node cleanup.js --claim <absolute path>              # stamp; prints token=<hex>
 *   node cleanup.js --dir <absolute path> --token <hex>  # remove the dir that minted <hex>
 *
 * Exit codes:
 *   0 = claimed, or removed (idempotent — a re-run after a partial failure is safe)
 *   1 = refused: not a `mktemp -d` scratch directory, not claimed, or the token does not match
 *   2 = usage error
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// `mktemp -d` with no template yields a `tmp.XXXXXXXXXX` leaf on both BSD/macOS and GNU. Requiring
// that leaf shape is what separates the scratch directory from its PARENT (the shared temp root),
// which is the specific path the ambient-TMPDIR mistake produces.
const LEAF_RE = /^tmp\.[A-Za-z0-9]{6,}$/;

// Written into the scratch directory by `--claim`; required by `--dir`.
const CLAIM_FILE = '.necessity-audit-scratch';

function fail(code, message) {
  process.stderr.write(`[necessity-audit cleanup] ${message}\n`);
  process.exit(code);
}

/**
 * A refusal raised from a function that must remain callable in-process.
 *
 * The removal helpers below are exported so a test can drive them directly and interpose at the
 * exact instant an attacker would (see removeVerified). `fail()` calls `process.exit`, which would
 * take the test runner down with it, so those helpers throw this instead and `main()` translates it
 * back — the CLI's stderr text and exit code are unchanged.
 */
class Refusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Refusal';
    this.exitCode = code;
  }
}

function refuse(code, message) {
  throw new Refusal(code, message);
}

/**
 * Unlink a NON-DIRECTORY entry, binding the removal to the identity just observed.
 *
 * `lstat(name)` then `unlink(name)` resolves the name TWICE, so the entry inspected need not be the
 * entry destroyed. The directory path was hardened against exactly this and the file path was not,
 * which left one function making two different promises. The old justification here — "the worst a
 * swap can do is unlink a different name inside a directory we own" — is also simply wrong: a
 * rename can move a FOREIGN inode in under our name, and unlinking it destroys the victim's only
 * link, not ours.
 *
 * What this does and does not claim. It is not a privilege boundary: renaming a file into this
 * directory requires write permission on the file's own parent, which is the same permission needed
 * to unlink it directly, so a swap wins the attacker nothing they could not already do. The
 * DIRECTORY case is different in kind — recursion amplifies one rename into erasing an arbitrarily
 * deep tree — which is why it was hardened first. What this closes is the destructive ORDERING:
 *
 *   before   lstat -> compare -> [window] -> unlink        a swap here DESTROYS the wrong file
 *   after    rename -> lstat -> compare -> unlink          a swap here RELOCATES it and refuses
 *
 * The quarantine name is random, so an attacker cannot aim at it; the final `unlink` still resolves
 * a name, and unpredictability — not atomicity — is what makes that safe, the same argument
 * `mkstemp` rests on and the same one the lock's process-unique tombstone already uses. Node
 * exposes no unlink-by-descriptor, so no fully atomic form exists.
 *
 * A mismatch RETAINS the file under its quarantine name and refuses. Relocation is recoverable and
 * deletion is not, so leaving a foreign inode parked in a directory we own is the better failure.
 * A leftover from a crash between rename and unlink is not a wedge either: the caller enumerates
 * whatever is present, so the next run removes it like any other entry.
 */
function unlinkVerified(entry, where, expect) {
  const quarantine = `.quarantine-${crypto.randomBytes(12).toString('hex')}`;
  try {
    fs.renameSync(entry, quarantine);
  } catch (err) {
    if (err.code === 'ENOENT') return; // vanished between inspection and now — nothing to remove
    refuse(1, `refusing: could not isolate ${where} for removal (${err.code || err.message}) — nothing was removed`);
  }
  let moved;
  try {
    moved = fs.lstatSync(quarantine);
  } catch (err) {
    refuse(1, `refusing: cannot inspect ${where} after isolating it as ${quarantine} (${err.code || err.message}) — it was NOT removed`);
  }
  if (moved.dev !== expect.dev || moved.ino !== expect.ino) {
    refuse(
      1,
      `refusing: ${where} was substituted between inspection and removal — the entry is retained as ${quarantine} and was NOT removed`
    );
  }
  try {
    fs.unlinkSync(quarantine);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    refuse(1, `refusing: could not remove ${where} (${err.code || err.message}) — aborting with the directory partially emptied`);
  }
}

function parseArgs(argv) {
  let dir = null;
  let mode = null;
  let token = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' || argv[i] === '--claim') {
      mode = argv[i] === '--claim' ? 'claim' : 'remove';
      dir = argv[i + 1];
      i++;
    } else if (argv[i] === '--token') {
      token = argv[i + 1];
      i++;
    }
  }
  return { dir, mode, token };
}

// 24 bytes = 192 bits from the CSPRNG. The token never leaves the local filesystem and the marker
// is mode 0600, so this is well past what the threat (an accidentally substituted path, not a
// determined attacker) requires — but a guessable value would put us straight back to
// presence-implies-permission.
const TOKEN_BYTES = 24;
const TOKEN_RE = /^[0-9a-f]{48}$/;

function readMarkerToken(markerPath) {
  const text = fs.readFileSync(markerPath, 'utf8');
  for (const line of text.split('\n')) {
    if (line.startsWith('token=')) return line.slice('token='.length).trim();
  }
  return null;
}

// Constant-time compare on equal-length buffers. `timingSafeEqual` THROWS on a length mismatch, so
// the lengths are screened first — and both sides are validated against TOKEN_RE beforehand, which
// makes every comparison that reaches here the same fixed width.
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// realpath both sides: on macOS the temp root is reached as /var/folders/… but resolves to
// /private/var/folders/…, so a raw string comparison would reject every genuine scratch directory.
function realOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

// The scratch directory must be a DIRECT child of this process's temp root — which is what
// `mktemp -d` produces — rather than merely somewhere beneath a list of plausible temp roots. The
// broad list was the weaker half of the earlier check: it accepted any matching directory anywhere
// under /tmp, /var/tmp or /var/folders, including trees belonging to other users' sessions.
function parentIsTempRoot(resolved) {
  return realOrSelf(path.dirname(resolved)) === realOrSelf(os.tmpdir());
}

function main() {
  const { dir, mode, token } = parseArgs(process.argv.slice(2));
  if (!dir || !mode) {
    fail(2, 'usage: cleanup.js --claim <absolute path> | --dir <absolute path> --token <hex>');
  }
  if (mode === 'remove' && !token) {
    fail(2, 'usage: --dir requires --token <hex> (the value printed by --claim)');
  }

  if (dir.includes('<') || dir.includes('>')) {
    fail(1, `refusing: the placeholder was never substituted (${dir})`);
  }
  if (!path.isAbsolute(dir)) {
    fail(1, `refusing: not an absolute path (${dir})`);
  }

  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root) {
    fail(1, 'refusing: the filesystem root is not a scratch directory');
  }

  const leaf = path.basename(resolved);
  if (!LEAF_RE.test(leaf)) {
    fail(1, `refusing: "${leaf}" is not a mktemp -d leaf (expected tmp.XXXXXXXXXX) — this is what a path one level too high looks like`);
  }

  if (!parentIsTempRoot(resolved)) {
    fail(1, `refusing: ${resolved} is not a direct child of the temp root (${os.tmpdir()})`);
  }

  let st;
  try {
    st = fs.lstatSync(resolved);
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (mode === 'claim') fail(1, `refusing to claim: ${resolved} does not exist`);
      process.stdout.write(`[necessity-audit cleanup] already absent: ${resolved}\n`);
      process.exit(0);
    }
    fail(1, `refusing: cannot stat ${resolved} (${err.code})`);
  }
  // A symlink would make the recursive delete follow OUT of the temp root, defeating every check
  // above. mktemp -d never produces one, so its presence means the path is not what it claims.
  if (st.isSymbolicLink()) {
    fail(1, `refusing: ${resolved} is a symlink, not a scratch directory`);
  }
  if (!st.isDirectory()) {
    fail(1, `refusing: ${resolved} is not a directory`);
  }

  // Pin the inode NOW, before the marker is read, so the identity re-check below covers the whole
  // validation window rather than only its last step. O_NOFOLLOW is redundant with the
  // isSymbolicLink() check above but costs nothing and keeps the guarantee local to this open.
  let dirFd = null;
  if (mode !== 'claim') {
    try {
      dirFd = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      fail(1, `refusing: cannot pin ${resolved} for removal (${err.code || err.message})`);
    }
  }

  // Everything from here on runs under a `finally` that closes the pin. `fail()` THROWS rather
  // than exiting when this module is used as a library — which is exactly how the test suites drive
  // it — so every refusal path below leaked the descriptor, one per case. Harmless in the CLI (the
  // process exits) and a steady leak everywhere else.
  try {
    runVerifiedPhase({ mode, resolved, dirFd, token });
  } finally {
    if (dirFd !== null) {
      try { fs.closeSync(dirFd); } catch { /* already closed, or the fd was never usable */ }
    }
  }
}

function runVerifiedPhase({ mode, resolved, dirFd, token }) {
  const claim = path.join(resolved, CLAIM_FILE);

  if (mode === 'claim') {
    // Refuse to adopt a directory that already holds anything: `mktemp -d` hands back an EMPTY
    // directory, so contents mean this is not a freshly created scratch dir.
    const entries = fs.readdirSync(resolved);
    if (entries.length > 0) {
      fail(1, `refusing to claim: ${resolved} is not empty (${entries.length} entries) — mktemp -d returns an empty directory`);
    }
    const minted = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    // `wx` so an existing marker is never silently re-minted: re-claiming a live directory would
    // invalidate the token its real owner is holding and orphan the directory permanently.
    fs.writeFileSync(claim, `necessity-audit scratch\ntoken=${minted}\npid=${process.pid}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    // The token goes to STDOUT because the caller must capture it — it is the only thing that
    // will authorize the matching delete.
    process.stdout.write(`token=${minted}\n`);
    process.stdout.write(`[necessity-audit cleanup] claimed: ${resolved}\n`);
    return;
  }

  // The binding that makes the delete safe: without it, every concurrent process's scratch
  // directory satisfies every check above.
  let claimStat;
  try {
    claimStat = fs.lstatSync(claim);
  } catch {
    fail(1, `refusing: ${resolved} carries no ${CLAIM_FILE} marker — it was not claimed by this skill, so it is not this run's scratch directory`);
  }
  if (!claimStat.isFile()) {
    fail(1, `refusing: ${claim} is not a regular file`);
  }

  // Identity, not just membership. Presence of a marker only proves "some necessity-audit run
  // owns this"; the token proves it is THIS one. Two concurrent audits both hold valid markers,
  // so without this comparison a substituted path naming the other run's directory deletes it.
  if (!TOKEN_RE.test(token)) {
    fail(1, 'refusing: --token is not a well-formed claim token (expected 48 lowercase hex chars)');
  }
  let stored;
  try {
    stored = readMarkerToken(claim);
  } catch (err) {
    fail(1, `refusing: cannot read ${CLAIM_FILE} (${err.code || err.message})`);
  }
  if (!stored || !TOKEN_RE.test(stored)) {
    fail(1, `refusing: ${claim} carries no usable token — it predates capability-bound cleanup or was tampered with; remove it by hand after verifying the path`);
  }
  if (!tokensMatch(stored, token)) {
    fail(1, `refusing: --token does not match the token ${resolved} was claimed with — this is another run's scratch directory`);
  }

  removeVerified(resolved, dirFd);
  process.stdout.write(`[necessity-audit cleanup] removed: ${resolved}\n`);
}

/**
 * Remove the directory `dirFd` refers to, without ever routing the destructive part through a
 * re-resolvable pathname: chdir into it, verify the resulting cwd against the held fd, then
 * remove every entry by RELATIVE name. The only path-resolved operation left is the
 * non-destructive final `rmdirSync`, which fails ENOTEMPTY on a last-instant substitute. Why
 * check-then-act on a path could not be fixed by more checks, and why the removal is exported
 * as two composable halves: docs/features/necessity-audit/4-implementation.md §2.
 *
 * @param {string} resolved absolute path, already validated
 * @param {number} dirFd open O_DIRECTORY|O_NOFOLLOW descriptor on that directory
 */
function removeVerified(resolved, dirFd) {
  emptyVerifiedDir(resolved, dirFd);
  removeEmptiedDir(resolved);
}

/**
 * Prove that the process working directory is still the object `fd` refers to.
 *
 * Every `chdir` below resolves a NAME, so each one needs this immediately afterwards; the fd is
 * the only handle that cannot be redirected under us.
 */
function assertCwdIs(fd, label) {
  let held;
  let here;
  try {
    held = fs.fstatSync(fd);
    here = fs.statSync('.');
  } catch (err) {
    refuse(1, `refusing: ${label} became unverifiable before removal (${err.code || err.message})`);
  }
  if (held.dev !== here.dev || held.ino !== here.ino) {
    refuse(1, `refusing: ${label} was replaced after validation (dev/ino changed) — the directory now at that path is not the one this token authorizes`);
  }
}

/**
 * Remove every entry of the directory the process is pinned to, except `skipName`.
 *
 * `pinnedFd` MUST be an open descriptor on the current working directory (the caller proves this
 * with {@link assertCwdIs} before the first call).
 *
 * Enumeration records each entry's INODE, not just its name, and {@link removePinnedEntry} refuses
 * anything whose identity has since changed. Names are the only thing `readdir` returns and a name
 * is exactly what a concurrent process can re-point; capturing the identity at the earliest moment
 * it is observable is what binds "the entry this directory listed" to "the entry that gets
 * removed".
 */
function purgePinnedDir(pinnedFd, label, skipName) {
  let entries;
  try {
    entries = fs.readdirSync('.');
  } catch (err) {
    refuse(1, `refusing: cannot enumerate ${label} for removal (${err.code || err.message})`);
  }
  const planned = [];
  for (const entry of entries) {
    if (entry === skipName) continue;
    let st;
    try {
      st = fs.lstatSync(entry);
    } catch (err) {
      if (err.code === 'ENOENT') continue; // vanished during enumeration — nothing to remove
      refuse(1, `refusing: cannot inspect ${label}/${entry} for removal (${err.code || err.message})`);
    }
    planned.push({ name: entry, expect: { dev: st.dev, ino: st.ino, dir: st.isDirectory() } });
  }
  for (const { name, expect } of planned) removePinnedEntry(pinnedFd, name, label, expect);
}

/**
 * Remove one entry of the pinned directory, descending into it if it is a directory.
 *
 * WHY NOT `rmSync(entry, { recursive: true })`.
 * Pinning the cwd proves the PARENT, not the identity of each child resolved beneath it. A
 * recursive delete re-resolves `entry` and then walks whatever it finds, so a concurrent process
 * can rename the enumerated child away, move an unrelated directory in under that name, and have
 * the recursion erase it. Refusing symlinks does not help: the substitute is a real directory,
 * which is exactly what the walk expects.
 *
 * `expect` is the identity the caller observed at enumeration time, and it is the load-bearing
 * half. Opening the child `O_NOFOLLOW` and proving the `chdir` against that descriptor binds
 * open→chdir, but it says nothing about open→WHAT: if the swap landed before this call, every
 * later check is self-consistent ON THE SUBSTITUTE. Comparing the opened inode against the
 * enumerated one is what closes that, and it is why `expect` is not optional on the recursive
 * path.
 *
 * Going back UP is the part with no portable primitive — Node exposes no `fchdir`, so `..` is
 * just another name, and a child moved out of the pinned parent while we were inside it leads
 * somewhere else. That cannot be prevented here, but it can be DETECTED: the parent's descriptor
 * is still open, so the directory we return to is proven against it before the next removal.
 *
 * Non-directory entries go through `unlinkVerified`, which isolates under an unguessable name
 * before removing — see there for what that does and does not claim.
 *
 * The final `rmdir` is non-recursive and is the only UNBOUND path-resolved destructive step, which
 * makes a swap at that instant non-destructive BY CONSTRUCTION rather than merely unlikely —
 * `rmdir` refuses anything non-empty, so a substitute holding content is reported, not erased.
 */
function removePinnedEntry(pinnedFd, entry, label, expect) {
  const where = `${label}/${entry}`;
  let st;
  try {
    st = fs.lstatSync(entry);
  } catch (err) {
    if (err.code === 'ENOENT') return; // vanished between enumeration and now — nothing to remove
    refuse(1, `refusing: cannot inspect ${where} for removal (${err.code || err.message})`);
  }
  if (expect && (st.dev !== expect.dev || st.ino !== expect.ino || st.isDirectory() !== expect.dir)) {
    refuse(1, `refusing: ${where} is no longer the entry this directory enumerated (a swap between enumeration and removal) — nothing further was removed`);
  }
  if (!st.isDirectory()) {
    // Bound to the `st` THIS function just observed, not to the caller's `expect`. The claim-marker
    // removal passes `expect === null` (there is no enumeration identity to carry for it), and
    // binding to the local lstat gives that call the same guarantee as every other one instead of
    // leaving the last delete in the sequence as the weakest.
    unlinkVerified(entry, where, st);
    return;
  }
  let childFd;
  try {
    childFd = fs.openSync(entry, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    refuse(1, `refusing: cannot pin ${where} for removal (${err.code || err.message})`);
  }
  try {
    let opened;
    try {
      opened = fs.fstatSync(childFd);
    } catch (err) {
      refuse(1, `refusing: ${where} became unverifiable before removal (${err.code || err.message})`);
    }
    if (expect && (opened.dev !== expect.dev || opened.ino !== expect.ino)) {
      refuse(1, `refusing: ${where} is no longer the entry this directory enumerated (a swap between enumeration and removal) — nothing further was removed`);
    }
    try {
      process.chdir(entry);
    } catch (err) {
      refuse(1, `refusing: cannot enter ${where} for removal (${err.code || err.message})`);
    }
    assertCwdIs(childFd, where);
    purgePinnedDir(childFd, where, null);
    try {
      process.chdir('..');
    } catch (err) {
      refuse(1, `refusing: cannot return to ${label} after emptying ${where} (${err.code || err.message})`);
    }
    assertCwdIs(pinnedFd, label);
  } finally {
    try { fs.closeSync(childFd); } catch { /* descriptor already gone; nothing useful to do */ }
  }
  try {
    fs.rmdirSync(entry);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    if (err.code === 'ENOTEMPTY' || err.code === 'EEXIST') {
      refuse(1, `refusing: ${where} is not empty after being emptied — the directory now at that name is not the one this token authorizes (a swap during removal); nothing further was removed`);
    }
    refuse(1, `refusing: could not remove ${where} (${err.code || err.message})`);
  }
}

/**
 * Empty the directory `dirFd` refers to, by relative name from a cwd pinned to that same inode.
 * Leaves the (now empty) directory itself in place. Throws {@link Refusal} on any refusal.
 */
function emptyVerifiedDir(resolved, dirFd) {
  const originalCwd = process.cwd();
  try {
    try {
      process.chdir(resolved);
    } catch (err) {
      refuse(1, `refusing: cannot enter ${resolved} for removal (${err.code || err.message})`);
    }

    // The chdir itself resolved by path, so it must be proven against the fd before anything is
    // deleted. After this passes, cwd and dirFd are the same kernel object and stay that way.
    assertCwdIs(dirFd, resolved);

    // The claim marker is this token's authorization to be here, so it is removed LAST. Deleting it
    // in enumeration order meant a failure on any LATER child left the directory partially emptied
    // AND unauthorized: the retry the header promises ("removal is idempotent — a re-run after a
    // partial failure is safe") then refuses for want of the marker it had just deleted, and the
    // remains can only be cleared by hand.
    purgePinnedDir(dirFd, resolved, CLAIM_FILE);
    removePinnedEntry(dirFd, CLAIM_FILE, resolved, null);
  } finally {
    // Leave the pinned directory before removing it; a process whose cwd is an unlinked directory
    // is a portability hazard, and every later `resolve()` in this process would be relative to it.
    try { process.chdir(originalCwd); } catch { /* original cwd gone; the rmdir below is absolute */ }
  }
}

/**
 * Remove a directory that {@link emptyVerifiedDir} has just emptied.
 *
 * This is the only path-resolved step left, and it is non-destructive by construction: `rmdir`
 * refuses a non-empty directory, so if the name was swapped for a substitute holding anything at
 * all, this reports the swap instead of erasing it. Throws {@link Refusal} on any refusal.
 */
function removeEmptiedDir(resolved) {
  try {
    fs.rmdirSync(resolved);
  } catch (err) {
    if (err.code === 'ENOENT') return; // already gone — removal is idempotent by contract
    if (err.code === 'ENOTEMPTY' || err.code === 'EEXIST') {
      refuse(1, `refusing: ${resolved} is not empty at the final removal step — the directory this token emptied is not the one now at that path (a swap between emptying and rmdir); nothing further was removed`);
    }
    refuse(1, `refusing: could not remove the emptied directory ${resolved} (${err.code || err.message})`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    if (err instanceof Refusal) fail(err.exitCode, err.message);
    throw err;
  }
}

module.exports = { removeVerified, emptyVerifiedDir, removeEmptiedDir, removePinnedEntry, Refusal, CLAIM_FILE };
