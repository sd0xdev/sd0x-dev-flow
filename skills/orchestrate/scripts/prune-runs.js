#!/usr/bin/env node
/**
 * prune-runs.js — deterministic FIFO retention for `.claude_workflows/` run artifacts.
 *
 * A run occupies TWO paths that are counted and removed together: `<root>/<run-id>.json` and
 * `<root>/<run-id>/` — a run is present if EITHER exists, and pruning removes both. The deletion
 * target is always DERIVED (git toplevel of --repo + '/.claude_workflows'), never accepted as an
 * argument, and the destructive phase is fd/cwd-bound so no path re-resolution can redirect it.
 * Containment and TOCTOU design, and why there is deliberately no --root flag:
 * docs/features/workflow-orchestration/4-implementation.md §1.
 *
 * Usage:
 *   node skills/orchestrate/scripts/prune-runs.js [--repo <path>] [--keep N] [--dry-run] [--json]
 *
 *   --repo <path>  Repository to prune (default: cwd); its own workflows dir is then derived.
 *   --keep N       Most-recent runs to retain (default: 10; 0 prunes everything).
 *   --dry-run      Print what would be removed and exit without deleting.
 *   --json         Machine-readable output.
 *
 * Exit codes: 0 = pruned (or nothing to do) · 1 = refused (containment / bad argument / aborted)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const DEFAULT_KEEP = 10;
const DIR_NAME = '.claude_workflows';
// <UTC yyyymmdd-HHMMSS>-<intent-slug>; slug is kebab-case, no dots, so it can never be `..`
// and can never smuggle a separator.
const RUN_ID_RE = /^\d{8}-\d{6}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Same config-injection guard as run-verify.js: `core.fsmonitor` is a repo-local setting git
// EXECUTES. `rev-parse` does not consult it, but the override costs nothing and removes the
// footgun of a later call being added without it.
const GIT_SAFE_CONFIG = ['-c', 'core.fsmonitor=false'];

function fail(msg) {
  process.stderr.write(`[prune-runs] REFUSED: ${msg}\n`);
  process.exit(1);
}

/**
 * Strict single-pass parser. Unknown, duplicate, and malformed options are REFUSED before any
 * path is resolved or anything is deleted.
 *
 * A lenient parser is a live hazard for a destructive tool: with `indexOf`-style lookups,
 * `--dryrun` (a plausible typo for the documented `--dry-run`) is silently not-a-flag, and the
 * command the user believed was a preview prunes for real.
 */
function parseArgs(argv) {
  const VALUE_FLAGS = new Set(['--repo', '--keep']);
  const BOOL_FLAGS = new Set(['--dry-run', '--json']);
  const out = {};

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) fail(`unexpected positional argument ${JSON.stringify(a)}`);
    // `--keep=3` is rejected rather than quietly parsed: accepting both spellings doubles the
    // surface a reader has to hold, and the documented form is the space-separated one.
    if (a.includes('=')) fail(`use "${a.split('=')[0]} <value>", not "${a}"`);

    if (VALUE_FLAGS.has(a)) {
      if (a in out) fail(`${a} given more than once`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail(`${a} requires a value`);
      out[a] = v;
      i += 1;
    } else if (BOOL_FLAGS.has(a)) {
      if (a in out) fail(`${a} given more than once`);
      out[a] = true;
    } else {
      fail(`unknown flag ${JSON.stringify(a)} (expected: ${[...VALUE_FLAGS, ...BOOL_FLAGS].join(', ')})`);
    }
  }
  return out;
}

/** Derives the workflows root from the repository's real top-level. Never from an argument. */
function resolveRoot(repoArg) {
  const repo = path.resolve(repoArg || process.cwd());
  let topLevel;
  try {
    topLevel = execFileSync('git', ['-C', repo, ...GIT_SAFE_CONFIG, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    fail(`${repo} is not inside a git repository (${String(e.message).split('\n')[0]}) — the workflows root is derived from the repo top-level, so there is nothing to prune`);
  }
  if (!topLevel) fail(`could not determine the top-level of ${repo}`);

  let topReal;
  try {
    topReal = fs.realpathSync(topLevel);
  } catch (e) {
    fail(`repo top-level ${topLevel} is unresolvable: ${e.message}`);
  }

  const rootReal = path.join(topReal, DIR_NAME);
  let st;
  try {
    // lstat, not stat: a symlinked root must be refused, not followed.
    st = fs.lstatSync(rootReal);
  } catch {
    return { rootReal, exists: false };
  }
  if (st.isSymbolicLink()) fail(`${rootReal} is a symlink — refusing to follow it`);
  if (!st.isDirectory()) fail(`${rootReal} is not a directory`);
  return { rootReal, exists: true };
}

/** Groups directory entries into runs, keyed by run-id. Unrecognized names are reported, not removed. */
function collectRuns(rootReal) {
  const runs = new Map(); // runId -> { json: bool, dir: bool }
  const unknown = [];

  for (const e of fs.readdirSync(rootReal, { withFileTypes: true })) {
    const name = e.name;
    let id;
    let key;
    if (name.endsWith('.json')) {
      id = name.slice(0, -'.json'.length);
      key = 'json';
    } else {
      id = name;
      key = 'dir';
    }

    // A symlink named like a run is not a run — removing it would delete the link and leave the
    // real artifacts, or worse, invite a caller to plant one. Report and skip.
    //
    // `e.isSymbolicLink()` is REDUNDANT here and kept deliberately. Dirent uses lstat semantics, so
    // a symlink reports false from BOTH `isDirectory()` and `isFile()` and is already caught by the
    // two type checks that follow — mutation-confirmed: deleting the term keeps every test green.
    // It stays because it states the intent at the point of decision, where the type checks only
    // imply it. The two type checks are each pinned independently (a regular file named like a run
    // DIR, and a directory named `<run-id>.json`), so this line's redundancy is a documented fact
    // rather than an untested branch.
    if (!RUN_ID_RE.test(id) || e.isSymbolicLink() || (key === 'dir' && !e.isDirectory()) || (key === 'json' && !e.isFile())) {
      unknown.push(name);
      continue;
    }

    const cur = runs.get(id) || { json: false, dir: false };
    cur[key] = true;
    runs.set(id, cur);
  }

  return { runs, unknown };
}

/**
 * Proves the process's working directory IS the directory `rootFd` was opened on.
 *
 * This deliberately consults `"."` rather than the root's path. A path re-`stat` proves only that
 * the path currently resolves to the right inode — it says nothing about where the NEXT path walk
 * will land, which is what a delete does. `"."` is the kernel-held cwd reference itself, so this
 * check and the relative delete that follows it address the same object, and no rename, move or
 * symlink swap performed between them can point them at different directories.
 */
function assertCwdIs(fd, what) {
  let held;
  let cwd;
  try {
    held = fs.fstatSync(fd);
    cwd = fs.statSync('.');
  } catch (e) {
    fail(`${what} became unverifiable mid-run (${e.message}) — aborting with nothing further removed`);
  }
  if (held.dev !== cwd.dev || held.ino !== cwd.ino) {
    fail(`working directory is no longer ${what} (dev/ino differ) — aborting with nothing further removed`);
  }
}

function assertCwdIsRoot(rootFd) {
  assertCwdIs(rootFd, 'the pinned workflows root');
}

/**
 * Remove everything under the directory the process is pinned to. Returns true when it emptied.
 *
 * `pinnedFd` MUST be an open descriptor on the current working directory. Enumeration records each
 * entry's INODE, because a name is the one thing a concurrent process can re-point between the
 * listing and the removal.
 */
function emptyPinnedDir(pinnedFd, what) {
  let entries;
  try {
    entries = fs.readdirSync('.');
  } catch {
    return false;
  }
  const planned = [];
  for (const name of entries) {
    let st;
    try {
      st = fs.lstatSync(name);
    } catch (e) {
      if (e.code === 'ENOENT') continue; // vanished during enumeration — nothing to remove
      return false;
    }
    planned.push({ name, expect: { dev: st.dev, ino: st.ino, dir: st.isDirectory() } });
  }
  let ok = true;
  for (const { name, expect } of planned) {
    if (!removePinnedChild(pinnedFd, name, `${what}/${name}`, expect)) ok = false;
  }
  return ok;
}

/**
 * Unlink a NON-DIRECTORY entry in the current directory, binding the removal to an identity:
 * `rename → lstat → compare → unlink` relocates a raced substitute instead of destroying it.
 * Why the pinned walk carries `expect` instead of using `rmSync` per child, and why deletes
 * quarantine-rename first: docs/features/workflow-orchestration/4-implementation.md §1.1.
 *
 * Returns removeChild's three-state vocabulary:
 *   'removed'  the name was detached by this call (incl. post-rename ENOENT — the rename already
 *              detached the original name)
 *   'absent'   it had already vanished — NOT a failure, must not inflate the pruned count
 *   'skipped'  substituted, or uninspectable/unremovable; the substitute is RETAINED under its
 *              `.quarantine-*` name as the evidence trail of a refused delete
 */
function unlinkVerified(name, expect) {
  const quarantine = `.quarantine-${crypto.randomBytes(12).toString('hex')}`;
  try {
    fs.renameSync(name, quarantine);
  } catch (e) {
    return e.code === 'ENOENT' ? 'absent' : 'skipped';
  }
  let moved;
  try {
    moved = fs.lstatSync(quarantine);
  } catch {
    return 'skipped';
  }
  if (moved.dev !== expect.dev || moved.ino !== expect.ino) return 'skipped';
  try {
    fs.unlinkSync(quarantine);
  } catch (e) {
    if (e.code !== 'ENOENT') return 'skipped';
  }
  return 'removed';
}

function removePinnedChild(pinnedFd, name, what, expect) {
  let st;
  try {
    st = fs.lstatSync(name);
  } catch (e) {
    return e.code === 'ENOENT';
  }
  if (st.dev !== expect.dev || st.ino !== expect.ino || st.isDirectory() !== expect.dir) return false;
  if (!st.isDirectory()) {
    // Bound to the identity verified just above, so the entry inspected is the entry removed.
    // 'absent' collapses into the same `true` as 'removed': this predicate answers "is the name
    // gone", and both outcomes satisfy it. Only a substitution or a hard failure yields `false`.
    return unlinkVerified(name, { dev: st.dev, ino: st.ino }) !== 'skipped';
  }
  let childFd;
  try {
    childFd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  } catch (e) {
    return e.code === 'ENOENT';
  }
  let emptied = false;
  try {
    let opened;
    try {
      opened = fs.fstatSync(childFd);
    } catch {
      return false;
    }
    if (opened.dev !== expect.dev || opened.ino !== expect.ino) return false;
    try {
      process.chdir(name);
    } catch {
      return false;
    }
    assertCwdIs(childFd, what);
    emptied = emptyPinnedDir(childFd, what);
    try {
      process.chdir('..');
    } catch (e) {
      fail(`cannot return to the parent of ${what} (${e.message}) — aborting with nothing further removed`);
    }
    assertCwdIs(pinnedFd, `the parent of ${what}`);
  } finally {
    try { fs.closeSync(childFd); } catch { /* descriptor already gone; nothing useful to do */ }
  }
  if (!emptied) return false;
  try {
    fs.rmdirSync(name);
  } catch (e) {
    return e.code === 'ENOENT';
  }
  return true;
}

// Exported for direct unit testing. `removeChild`'s precondition (cwd == pinned root) is enforced
// by the function itself rather than assumed of the caller, so a direct call from a test that has
// not entered the root aborts instead of deleting something relative to the wrong directory.
module.exports = { assertCwdIsRoot, RUN_ID_RE, removeChild, removePinnedChild };

/**
 * Removes one child of the pinned root, named RELATIVE to the process working directory.
 *
 * Returns one of:
 *   'removed'  the entry existed and this call unlinked it
 *   'absent'   the entry was already gone (ENOENT) — idempotent, nothing to do
 *   'skipped'  the entry changed shape since enumeration, or could not be inspected/removed
 *
 * Three states, not a boolean, because the caller has to distinguish them. It previously returned
 * `true` for every `lstat` failure, which folded EACCES, ELOOP and ENOTDIR into "already gone" and
 * reported an artifact that is still on disk as pruned.
 *
 * The root check lives HERE, not in the caller's loop. It used to run once per run id while a run
 * can own TWO artifacts (`<id>.json` and `<id>/`), so a single check covered two destructive
 * syscalls and the first delete was itself a usable signal for swapping the root before the second.
 */
function removeChild(rootFd, name, { expectDir }) {
  // Before the relative `lstat`, not just before the delete: an unverified cwd makes the shape
  // check itself meaningless, since it would be inspecting an entry in some other directory.
  assertCwdIsRoot(rootFd);
  let st;
  try {
    st = fs.lstatSync(name);
  } catch (e) {
    if (e.code === 'ENOENT') return 'absent';
    return 'skipped';
  }
  if (st.isSymbolicLink()) return 'skipped';
  if (expectDir ? !st.isDirectory() : !st.isFile()) return 'skipped';
  if (expectDir) {
    // Bound to the identity `lstat` just observed, so the entry inspected is the entry removed.
    if (!removePinnedChild(rootFd, name, name, { dev: st.dev, ino: st.ino, dir: true })) return 'skipped';
    return 'removed';
  }
  // The `<run-id>.json` path. It used to unlink by name having checked only the SHAPE — strictly
  // weaker than the `expectDir` branch four lines above, which carries `{dev, ino}` into the pinned
  // walk, so the same function made a stronger promise about a directory than about a file. It now
  // carries the same identity.
  //
  // ENOENT stays 'absent', not 'removed'. Counting a vanished entry as pruned inflates the total in
  // exactly the way the accounting comment below forbids: the caller reports N pruned while this
  // run deleted fewer than N. 'absent' is not a FAILURE either — someone else already did it — so
  // it must not land in `failed` and turn a benign race into a non-zero exit.
  return unlinkVerified(name, { dev: st.dev, ino: st.ino });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args['--dry-run'] === true;
  const asJson = args['--json'] === true;

  let keep = DEFAULT_KEEP;
  if (args['--keep'] !== undefined) {
    const raw = args['--keep'];
    if (!/^\d+$/.test(raw)) fail(`--keep must be a non-negative integer (got ${JSON.stringify(raw)})`);
    keep = Number(raw);
  }

  const { rootReal, exists } = resolveRoot(args['--repo']);

  const emit = (result) => {
    if (asJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const absent = result.already_absent || [];
      const failedIds = result.failed || [];
      process.stdout.write(
        `[prune-runs] root=${result.root} total=${result.total} keep=${result.keep} ` +
          `pruned=${result.pruned.length}` +
          (absent.length ? ` already-absent=${absent.length}` : '') +
          (failedIds.length ? ` failed=${failedIds.length}` : '') +
          `${result.dry_run ? ' (dry-run)' : ''}\n`
      );
      for (const id of result.pruned) process.stdout.write(`  - ${id}\n`);
      for (const id of absent) process.stdout.write(`  - ${id} (already absent — removed by someone else)\n`);
      for (const id of failedIds) {
        process.stderr.write(`[prune-runs] STILL ON DISK (removal failed): ${id}\n`);
      }
      for (const n of result.unknown) process.stderr.write(`[prune-runs] left in place (unrecognized): ${n}\n`);
    }
  };

  if (!exists) {
    emit({ root: rootReal, total: 0, keep, kept: [], pruned: [], already_absent: [], failed: [], unknown: [], dry_run: dryRun });
    return;
  }

  // Pin the root BEFORE enumerating, not after. `collectRuns` is the readdir+lstat pass whose
  // results every later delete is derived from; opening the fd afterwards left that whole pass
  // outside the identity guarantee, so a root swapped during enumeration produced a doomed list
  // describing one directory and a delete loop pointed at another. Dry runs skip the pin because
  // they issue no syscall the pin protects.
  let rootFd = null;
  let originalCwd = null;
  if (!dryRun) {
    try {
      rootFd = fs.openSync(rootReal, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    } catch (e) {
      fail(`cannot pin the workflows root for removal: ${e.message}`);
    }
    // Enter the root so every later name is resolved from the kernel-held cwd rather than by
    // walking a path an attacker can re-point. chdir itself resolves by path, hence the immediate
    // verification against the O_NOFOLLOW fd — see the TOCTOU section of the header.
    originalCwd = process.cwd();
    try {
      process.chdir(rootReal);
    } catch (e) {
      fail(`cannot enter the workflows root: ${e.message}`);
    }
    assertCwdIsRoot(rootFd);
  }

  try {
    // Relative once pinned: enumeration must read the same directory object the deletes will.
    const { runs, unknown } = collectRuns(rootFd === null ? rootReal : '.');
    if (rootFd !== null) assertCwdIsRoot(rootFd); // enumeration happened on THIS root
    const ids = [...runs.keys()].sort(); // lexical == chronological (UTC timestamp prefix)
    const cut = ids.length - keep;
    const doomed = cut > 0 ? ids.slice(0, cut) : [];

    // A dry run reports what WOULD go; a real run reports only what actually did. Reporting
    // `doomed` unconditionally meant a run whose artifacts were skipped appeared as pruned, so the
    // exit status and the list both said success while the files were still on disk.
    //
    // `absent` is a THIRD outcome and is reported as itself. It is not a failure — the goal state
    // holds and re-running is safe — but it is not this invocation's work either: the entry existed
    // at enumeration and was gone by the delete, which means a concurrent prune, an external
    // cleanup, or a root that is not what enumeration saw. Folding it into `pruned` made the
    // headline count answer "how many runs are gone" when the question a retention tool has to
    // answer is "how much did this run actually drain" — and a leak that never shrinks while the
    // report says `pruned=10` every time is exactly the failure this script exists to surface.
    let pruned = doomed;
    let alreadyAbsent = [];
    // A doomed run whose artifacts could not be removed belonged to NO bucket: absent from
    // `pruned` (correctly — it is still on disk) and absent from `kept`, which is derived purely
    // from the retention arithmetic. So the report described a tree that did not exist, retention
    // silently stayed above `--keep`, and the command still exited 0 — a caller polling this to
    // decide whether the policy holds was told yes. Failures are now their own bucket and their
    // own exit status.
    let failed = [];
    if (!dryRun && doomed.length) {
      pruned = [];
      alreadyAbsent = [];
      for (const id of doomed) {
        const meta = runs.get(id);
        // Names came from readdir and already passed RUN_ID_RE, so neither name can escape.
        // removeChild re-proves the cwd for EACH of these two removals.
        let ok = true;
        let removedAny = false;
        if (meta.json) {
          const r = removeChild(rootFd, `${id}.json`, { expectDir: false });
          if (r === 'skipped') { unknown.push(`${id}.json`); ok = false; }
          else if (r === 'removed') removedAny = true;
        }
        if (meta.dir) {
          const r = removeChild(rootFd, id, { expectDir: true });
          if (r === 'skipped') { unknown.push(id); ok = false; }
          else if (r === 'removed') removedAny = true;
        }
        if (!ok) { failed.push(id); continue; }
        if (removedAny) pruned.push(id);
        else alreadyAbsent.push(id);
      }
    }

    emit({
      root: rootReal,
      total: ids.length,
      keep,
      // Policy-retained only. Everything still on disk is `kept` + `failed`; keeping the two
      // apart is what lets a caller see that retention did NOT converge to `--keep`.
      kept: ids.slice(doomed.length),
      pruned,
      already_absent: alreadyAbsent,
      failed,
      unknown,
      dry_run: dryRun,
    });
    // Nonzero when a run this invocation SELECTED for deletion is still there. `unknown` alone is
    // not a failure — it is the report of entries this tool never claimed — so the status is bound
    // to `failed`, which counts only artifacts the retention policy asked it to remove.
    if (failed.length) process.exitCode = 1;
  } finally {
    if (rootFd !== null) fs.closeSync(rootFd);
    // Restore the caller's cwd. `fail()` exits the process and so skips this, which is correct for
    // a CLI; it matters for the normal path only.
    if (originalCwd !== null) {
      try { process.chdir(originalCwd); } catch { /* caller's cwd vanished; nothing useful to do */ }
    }
  }
}

// Run the CLI only when invoked directly; a `require` from a test must not prune anything.
if (require.main === module) main();
