'use strict';

// Content-addressed receipt log: location resolution, locking, append discipline,
// verdict selection, and the tombstone fallback. Protocol and rationale:
// docs/features/auto-loop-evolution/2-tech-spec/2-content-addressed-receipts.md §3.3, §4.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCK_TIMEOUT_MS = 5000;
const LOCK_TTL_MS = 30000;
const LOCK_TAKEOVER_LIMIT = 3;

const PLANES = new Set(['code_review', 'doc_review', 'precommit']);

function nowISO() {
  return new Date().toISOString();
}

function msleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function safeSlug(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]/g, '-');
}

function repoSlug(realRoot) {
  // Deliberately keyed to the checkout path, NOT the remote URL the precommit
  // cache uses: two checkouts of one remote have independent working trees.
  const hex = crypto.createHash('sha256').update(realRoot).digest('hex').slice(0, 8);
  return `${safeSlug(path.basename(realRoot))}--${hex}`;
}

function isInside(child, parent) {
  return child === parent || child.startsWith(parent + path.sep);
}

// Containment is verified BEFORE anything is created: resolve the nearest
// existing real ancestor, project the remainder onto it, and refuse if the
// projection lands inside the repo — a rejected configuration must leave zero
// repository-local artifacts. Re-verified after creation to close the
// symlinked-component window.
function ensureContainedDir(candidate, realRoot) {
  let existing = candidate;
  const rest = [];
  while (!fs.existsSync(existing)) {
    rest.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const projected = path.join(fs.realpathSync(existing), ...rest);
  if (isInside(projected, realRoot)) {
    throw new Error(`receipt-log: cache dir ${projected} lies inside the repo root`);
  }
  fs.mkdirSync(candidate, { recursive: true, mode: 0o700 });
  const realDir = fs.realpathSync(candidate);
  if (isInside(realDir, realRoot)) {
    throw new Error(`receipt-log: resolved cache dir ${realDir} lies inside the repo root`);
  }
  return realDir;
}

// ${XDG_CACHE_HOME:-$HOME/.cache}/sd0x-dev-flow/receipts/<slug>/verdicts.jsonl.
// Only an absolute XDG_CACHE_HOME is honoured (XDG spec; a relative value could
// resolve back inside the repo).
function resolveReceiptPaths(repoRoot) {
  const realRoot = fs.realpathSync(repoRoot);
  const xdg = process.env.XDG_CACHE_HOME;
  let cacheHome;
  if (xdg && path.isAbsolute(xdg)) {
    cacheHome = xdg;
  } else {
    const home = process.env.HOME || os.homedir();
    if (!home) throw new Error('receipt-log: no HOME to resolve the cache directory');
    cacheHome = path.join(home, '.cache');
  }
  const candidate = path.join(cacheHome, 'sd0x-dev-flow', 'receipts', repoSlug(realRoot));
  const realDir = ensureContainedDir(candidate, realRoot);
  return { dir: realDir, file: path.join(realDir, 'verdicts.jsonl'), realRoot };
}

// ${TMPDIR:-/tmp}/sd0x-dev-flow/<slug>.tombstones.jsonl — the fallback path for
// producer append failures. Same containment rules as the primary, plus 0700 +
// ownership check (world-writable parent); the file itself is opened O_NOFOLLOW
// and fstat-verified by every writer, which is what closes the symlink race —
// the lstat here is advisory early failure, not the protection.
function resolveTombstonePaths(repoRoot, testHooks = {}) {
  const realRoot = fs.realpathSync(repoRoot);
  const tmp =
    process.env.TMPDIR && path.isAbsolute(process.env.TMPDIR) ? process.env.TMPDIR : '/tmp';
  const dirPath = path.join(tmp, 'sd0x-dev-flow');
  // Zero-artifact containment first: project the candidate through its nearest
  // existing real ancestor and refuse before anything is created.
  let existing = dirPath;
  const rest = [];
  while (!fs.existsSync(existing)) {
    rest.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const projected = path.join(fs.realpathSync(existing), ...rest);
  if (isInside(projected, realRoot)) {
    throw new Error(`receipt-log: tombstone dir ${projected} lies inside the repo root`);
  }
  // Acquire the final component atomically: the well-known name sits in a
  // world-writable parent, so it is TAKEN by a non-recursive mkdir or VERIFIED
  // by inode — never resolved first, which would follow an attacker's symlink
  // planted between observation and use. testHooks (beforeStat/beforeResolve)
  // are deterministic race seams for the tests; production passes none.
  try {
    fs.mkdirSync(dirPath, { mode: 0o700 });
  } catch (e) {
    if (e.code !== 'EEXIST') {
      throw new Error(`receipt-log: cannot create tombstone dir ${dirPath}: ${e.message}`);
    }
  }
  if (testHooks.beforeStat) testHooks.beforeStat();
  const lst = fs.lstatSync(dirPath);
  if (lst.isSymbolicLink()) {
    throw new Error(`receipt-log: tombstone dir ${dirPath} is a symlink`);
  }
  if (!lst.isDirectory()) {
    throw new Error(`receipt-log: tombstone dir ${dirPath} is not a directory`);
  }
  if (typeof process.getuid === 'function' && lst.uid !== process.getuid()) {
    throw new Error(`receipt-log: tombstone dir ${dirPath} is not owned by this user`);
  }
  if ((lst.mode & 0o077) !== 0) {
    throw new Error(
      `receipt-log: tombstone dir ${dirPath} grants group/other access — expected 0700`
    );
  }
  if (testHooks.beforeResolve) testHooks.beforeResolve();
  const realDir = fs.realpathSync(dirPath);
  if (isInside(realDir, realRoot)) {
    throw new Error(`receipt-log: resolved tombstone dir ${realDir} lies inside the repo root`);
  }
  // Pin the verified inode: if the entry changed between the lstat above and
  // this resolution (dir swapped for a symlink), the identities diverge.
  const st = fs.statSync(realDir);
  if (st.dev !== lst.dev || st.ino !== lst.ino) {
    throw new Error(`receipt-log: tombstone dir ${dirPath} changed during acquisition`);
  }
  const file = path.join(realDir, `${repoSlug(realRoot)}.tombstones.jsonl`);
  let flst = null;
  try {
    flst = fs.lstatSync(file);
  } catch {
    /* absent is fine */
  }
  if (flst && flst.isSymbolicLink()) {
    throw new Error(`receipt-log: tombstone file ${file} is a symlink`);
  }
  return { dir: realDir, file, realRoot };
}

// Portable mkdir lock, ownership-aware like the hooks' shell implementation
// (post-tool-review-state.sh:230,345): the lockdir is the mutex, an owner token
// makes takeover safe — a displaced holder can neither write nor release the
// replacement lock. Stale takeover goes through rename, so a reclaim can never
// remove a lock a third writer just re-created.
function acquireLock(file, opts = {}) {
  const timeoutMs = opts.timeoutMs || LOCK_TIMEOUT_MS;
  const ttlMs = opts.ttlMs || LOCK_TTL_MS;
  const lockdir = `${file}.lockdir`;
  const token = `${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
  const deadline = Date.now() + timeoutMs;
  let takeovers = 0;
  for (;;) {
    try {
      fs.mkdirSync(lockdir, { mode: 0o700 });
      fs.writeFileSync(path.join(lockdir, 'owner'), token);
      return { lockdir, token };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let mtimeMs = null;
    try {
      mtimeMs = fs.statSync(lockdir).mtimeMs;
    } catch {
      continue; // holder released between mkdir and stat — retry immediately
    }
    if (mtimeMs !== null && Date.now() - mtimeMs > ttlMs) {
      if (takeovers >= LOCK_TAKEOVER_LIMIT) {
        throw new Error(`receipt-log: lock takeover limit reached for ${lockdir}`);
      }
      takeovers++;
      const stale = `${lockdir}.stale-${crypto.randomBytes(6).toString('hex')}`;
      try {
        fs.renameSync(lockdir, stale);
        fs.rmSync(stale, { recursive: true, force: true });
      } catch {
        /* another writer took it over first — loop re-evaluates */
      }
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`receipt-log: lock timeout on ${lockdir}`);
    }
    msleep(50);
  }
}

// The critical-section guard: a holder verifies the lock is still its own
// immediately before mutating the file. A holder paused past the TTL and
// displaced by takeover fails here instead of corrupting the new holder's write.
function ensureOwned(handle) {
  let current = null;
  try {
    current = fs.readFileSync(path.join(handle.lockdir, 'owner'), 'utf8');
  } catch {
    throw new Error(`receipt-log: lock ownership lost (lockdir gone) on ${handle.lockdir}`);
  }
  if (current !== handle.token) {
    throw new Error(`receipt-log: lock ownership lost (taken over) on ${handle.lockdir}`);
  }
}

function releaseLock(handle) {
  try {
    ensureOwned(handle);
  } catch {
    return; // not ours any more — never remove another writer's lock
  }
  try {
    fs.rmSync(handle.lockdir, { recursive: true, force: true });
  } catch {
    /* best effort — TTL reclaims a leak */
  }
}

function withFileLock(file, fn, opts) {
  const handle = acquireLock(file, opts);
  try {
    return fn(handle);
  } finally {
    releaseLock(handle);
  }
}

// Fsync the parent directory so a rename commit's directory entry is durable.
// The only tolerated failures are the platform-unsupported family — a real I/O
// error (EIO, ENOSPC) must surface so the producer takes its tombstone path
// instead of reporting a commit that may not survive a crash.
const DIR_FSYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP']);

function fsyncDirOf(file) {
  let fd = null;
  try {
    fd = fs.openSync(path.dirname(file), 'r');
    fs.fsyncSync(fd);
  } catch (e) {
    if (e && DIR_FSYNC_UNSUPPORTED.has(e.code)) return;
    throw new Error(`receipt-log: directory fsync failed for ${file}: ${e.message}`);
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// Open the log without following symlinks and verify the descriptor is a
// user-owned regular file — a swapped-in symlink must never let a truncate or
// append land on a file inside the repo.
function openLogFd(file) {
  const fd = fs.openSync(
    file,
    fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW,
    0o600
  );
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error(`receipt-log: ${file} is not a regular file`);
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
      throw new Error(`receipt-log: ${file} is not owned by this user`);
    }
  } catch (e) {
    fs.closeSync(fd);
    throw e;
  }
  return fd;
}

// readSync/writeSync may transfer fewer bytes than asked; loop to completion
// and treat zero progress as an error — a half-staged log must never commit.
function readFullSync(fd, size) {
  const buf = Buffer.alloc(size);
  let off = 0;
  while (off < size) {
    const n = fs.readSync(fd, buf, off, size - off, off);
    if (n <= 0) throw new Error('receipt-log: short read while snapshotting the log');
    off += n;
  }
  return buf;
}

function writeFullSync(fd, buf) {
  let off = 0;
  while (off < buf.length) {
    const n = fs.writeSync(fd, buf, off, buf.length - off, off);
    if (n <= 0) throw new Error('receipt-log: short write while staging the log');
    off += n;
  }
}

// Append records as single JSONL lines under the file lock. The complete new
// content (current bytes minus any torn tail, plus the new lines) is staged to
// a TOKEN-NAMED file INSIDE the owned lockdir — `staged-<token>`, O_EXCL — and
// committed by rename. Two structural bindings to lock identity: a TTL
// takeover renames the lockdir (staged file included) away, so a displaced
// holder's commit rename fails ENOENT; and the token in the filename means a
// displaced holder that stages into a REPLACEMENT lockdir writes its own file,
// never truncating the new holder's staged bytes. Durability, never multi-line
// atomicity (§3.3). opts.onBeforeStage / opts.onBeforeCommit are test seams.
function appendRecords(file, records, opts) {
  const lines = records.map(r => JSON.stringify(r) + '\n');
  return withFileLock(
    file,
    handle => {
      ensureOwned(handle); // early failure; the token-named staged file is the structural guard
      // Read current bytes through an O_NOFOLLOW fd — a symlinked log is
      // refused here, before anything is staged or renamed over it.
      let current = Buffer.alloc(0);
      const fd = openLogFd(file);
      try {
        const size = fs.fstatSync(fd).size;
        if (size > 0) current = readFullSync(fd, size);
      } finally {
        fs.closeSync(fd);
      }
      const lastNl = current.lastIndexOf(0x0a);
      const keep = lastNl === -1 ? 0 : lastNl + 1; // drop a torn tail
      const next = Buffer.concat([current.subarray(0, keep), Buffer.from(lines.join(''), 'utf8')]);
      if (opts && typeof opts.onBeforeStage === 'function') opts.onBeforeStage(handle);
      const staged = path.join(handle.lockdir, `staged-${handle.token}`);
      const sfd = fs.openSync(
        staged,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
        0o600
      );
      try {
        writeFullSync(sfd, next);
        fs.fsyncSync(sfd);
      } finally {
        fs.closeSync(sfd);
      }
      if (opts && typeof opts.onBeforeCommit === 'function') opts.onBeforeCommit(handle);
      ensureOwned(handle);
      fs.renameSync(staged, file);
      fsyncDirOf(file);
    },
    opts
  );
}

// Read the log without a lock: ignore an unterminated final line (torn tail) and
// count malformed lines instead of throwing — a reader never blocks on damage.
function readRecords(file) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') return { records: [], malformed: 0, missing: true };
    return { records: [], malformed: 0, unreadable: true, error: String(e.message) };
  }
  const text = raw.toString('utf8');
  const lastNl = text.lastIndexOf('\n');
  const body = lastNl === -1 ? '' : text.slice(0, lastNl + 1);
  const records = [];
  let malformed = 0;
  for (const line of body.split('\n')) {
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === 'object') records.push(rec);
      else malformed++;
    } catch {
      malformed++;
    }
  }
  return { records, malformed, torn: lastNl !== -1 && lastNl + 1 < text.length };
}

// Selection (§3.3): the newest verdict-bearing record for (plane, digest) —
// runner `verdict` rows and settlement `plane_results` projections. Dispatch,
// event, and tombstone records never participate; "no-verdict" projections are
// attempts, not evidence. "Newest" is append order, never wall clock.
function selectVerdict(records, plane, digest) {
  if (!digest) return null; // a partial digest matches nothing, by design
  let selected = null;
  for (const r of records) {
    if (r.kind === 'verdict') {
      if (r.plane === plane && r.digest === digest && r.verdict) selected = r;
    } else if (r.kind === 'settlement' && r.plane_results && typeof r.plane_results === 'object') {
      const proj = r.plane_results[plane];
      if (proj && proj.digest === digest && proj.verdict && proj.verdict !== 'no-verdict') {
        selected = { kind: 'verdict', plane, digest, verdict: proj.verdict, mode: proj.mode, settlement: r };
      }
    }
  }
  return selected;
}

// A tombstone pair names exactly one (plane, digest) — anything else is not a
// pair. Enforced at write (a producer must not mint an unmatchable pair) and at
// read (a malformed pair poisons the whole read, fail-closed).
function isValidPair(p) {
  return (
    p !== null &&
    typeof p === 'object' &&
    PLANES.has(p.plane) &&
    typeof p.digest === 'string' &&
    p.digest.length > 0
  );
}

// One tombstone schema everywhere: {kind:"tombstone", id, pairs:[{plane,digest}], time}.
// A single crash-atomic line — a multi-plane failure must never block one plane
// while its sibling fails open (§4).
function appendTombstone(repoRoot, pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0 || !pairs.every(isValidPair)) {
    throw new Error('receipt-log: refusing to write a tombstone with malformed pairs');
  }
  const { file } = resolveTombstonePaths(repoRoot);
  const rec = { v: 1, kind: 'tombstone', id: crypto.randomUUID(), pairs, time: nowISO() };
  appendRecords(file, [rec]);
  return rec;
}

// Read the fallback file. An unreadable or malformed fallback counts as
// "unresolved tombstones present for every pair" — over-block, never fail open.
function readTombstones(repoRoot) {
  let paths;
  try {
    paths = resolveTombstonePaths(repoRoot);
  } catch (e) {
    return { ok: false, reason: String(e.message), records: [] };
  }
  const r = readRecords(paths.file);
  if (r.unreadable) return { ok: false, reason: r.error, records: [] };
  const tombstones = [];
  let damaged = false;
  for (const rec of r.records) {
    if (rec.kind !== 'tombstone') continue;
    if (
      typeof rec.id !== 'string' ||
      rec.id.length === 0 ||
      !Array.isArray(rec.pairs) ||
      rec.pairs.length === 0 ||
      !rec.pairs.every(isValidPair)
    ) {
      damaged = true; // malformed → unresolved for every pair, fail-closed
      continue;
    }
    tombstones.push(rec);
  }
  if (r.malformed > 0) damaged = true;
  return { ok: !damaged, reason: damaged ? 'malformed tombstone records' : undefined, records: tombstones };
}

// Ids a PASS for (plane, digest) may record in its `resolves` array — matched by
// the full (plane, digest, id) tuple, so a colliding id cannot resolve another
// pair's tombstone.
function matchingTombstoneIds(tombstones, plane, digest) {
  const ids = [];
  for (const t of tombstones) {
    if (t.pairs.some(p => p && p.plane === plane && p.digest === digest)) {
      ids.push(t.id);
    }
  }
  return ids;
}

// Producer start-of-run check: refuse to run the gate silently degraded. Both
// the primary log AND the tombstone fallback are exercised through their lock
// and an O_NOFOLLOW open — resolution alone would pass a 0500 fallback dir
// that appendTombstone is guaranteed to fail on. A mitigation, not a
// guarantee — permissions can change mid-run (§4).
function preflightWritable(repoRoot) {
  try {
    const { file } = resolveReceiptPaths(repoRoot);
    withFileLock(file, () => {
      fs.closeSync(openLogFd(file));
    });
    const tomb = resolveTombstonePaths(repoRoot);
    withFileLock(tomb.file, () => {
      fs.closeSync(openLogFd(tomb.file));
    });
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
}

module.exports = {
  nowISO,
  repoSlug,
  resolveReceiptPaths,
  resolveTombstonePaths,
  acquireLock,
  releaseLock,
  ensureOwned,
  withFileLock,
  appendRecords,
  readRecords,
  selectVerdict,
  appendTombstone,
  readTombstones,
  matchingTombstoneIds,
  preflightWritable,
};
