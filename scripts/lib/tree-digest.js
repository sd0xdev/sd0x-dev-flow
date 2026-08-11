#!/usr/bin/env node
'use strict';

// Per-plane content digests of a git working tree — the content oracle of the
// content-addressed receipt design. Recipe, fail-closed rules, and cost bound:
// docs/features/auto-loop-evolution/2-tech-spec/2-content-addressed-receipts.md §3.2, §3.5.

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DOC_PLANE_RE = /\.(md|mdx)$/;

// Paths travel as latin1 strings: one byte per char, so comparison is byte order
// and Buffer.from(s, 'latin1') restores the exact original bytes. Strings never
// cross an fs or argv boundary directly — those re-encode as UTF-8 and would
// corrupt non-UTF-8 path bytes — they convert back to Buffers first.
function planeOf(p) {
  return DOC_PLANE_RE.test(p) ? 'doc' : 'code';
}

// Absolute path as raw bytes, for fs calls (Node fs accepts Buffer paths).
function absBuf(repoRoot, p) {
  return Buffer.concat([
    Buffer.from(repoRoot, 'utf8'),
    Buffer.from(path.sep),
    Buffer.from(p, 'latin1'),
  ]);
}

// A latin1 path is argv-safe only when re-encoding it as UTF-8 reproduces the
// original bytes — pure ASCII always does; valid-UTF-8 names round-trip through
// the decoded form instead (see argvPath).
function argvPath(p) {
  const raw = Buffer.from(p, 'latin1');
  const decoded = raw.toString('utf8');
  return Buffer.from(decoded, 'utf8').equals(raw) ? decoded : null;
}

function git(repoRoot, args, input) {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    input,
    maxBuffer: 1024 * 1024 * 512,
  });
}

// `git ls-files -s -z` → Map(path → {mode, oid}); stage ≠ 0 entries are conflicts.
function readIndex(repoRoot) {
  const out = git(repoRoot, ['ls-files', '-s', '-z']);
  const entries = new Map();
  const conflicted = [];
  for (const rec of out.toString('latin1').split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    const [mode, oid, stage] = rec.slice(0, tab).split(' ');
    const p = rec.slice(tab + 1);
    if (stage !== '0') {
      conflicted.push(p);
      continue;
    }
    entries.set(p, { mode, oid });
  }
  return { entries, conflicted };
}

// `git status --porcelain=v1 -z --untracked-files=all` → [{x, y, path, origPath?}]
function readStatus(repoRoot) {
  const out = git(repoRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]).toString('latin1');
  const records = [];
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    const x = f[0];
    const y = f[1];
    const p = f.slice(3);
    const rec = { x, y, path: p };
    if (x === 'R' || x === 'C') {
      // With --no-renames these should not appear, but a config-forced rename
      // record carries its source path as the next NUL field — consume it.
      rec.origPath = fields[++i];
    }
    records.push(rec);
  }
  return records;
}

function isUnmerged(x, y) {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
}

function fileModeOf(st) {
  return st.mode & 0o111 ? '100755' : '100644';
}

// Hash worktree files exactly as `git add` would — filters applied, no odb
// write. Batched through `--stdin-paths`, which reads raw newline-delimited
// path bytes from stdin, so non-UTF-8 names survive where argv would re-encode
// them. A path containing a newline byte cannot ride that channel; it falls
// back to a per-file argv call when argv-safe, else its plane goes partial.
function hashFiles(repoRoot, paths) {
  const oids = new Map();
  const failed = [];
  const batchable = [];
  for (const p of paths) {
    if (p.includes('\n')) {
      const argv = argvPath(p);
      if (argv === null) {
        // Documented fail-closed deviation from §3.2's raw-bytes-everywhere
        // goal: a path with BOTH a newline byte and non-UTF-8 bytes has no git
        // plumbing channel into a filter-applying hash — `--stdin-paths` is
        // newline-delimited with no -z variant (git 2.54), and argv re-encodes.
        // The plane goes partial; the remedy is renaming the file.
        failed.push({ path: p, reason: 'unhashable-path' });
        continue;
      }
      try {
        const oid = git(repoRoot, ['hash-object', '--', argv]).toString('latin1').trim();
        oids.set(p, oid);
      } catch {
        failed.push({ path: p, reason: 'hash-object-failed' });
      }
    } else {
      batchable.push(p);
    }
  }
  if (batchable.length) {
    const stdin = Buffer.concat(
      batchable.flatMap(p => [Buffer.from(p, 'latin1'), Buffer.from('\n')])
    );
    try {
      const out = git(repoRoot, ['hash-object', '--stdin-paths'], stdin)
        .toString('latin1')
        .split('\n')
        .filter(Boolean);
      if (out.length !== batchable.length) {
        throw new Error(`hash-object returned ${out.length} oids for ${batchable.length} paths`);
      }
      batchable.forEach((p, j) => oids.set(p, out[j]));
    } catch {
      for (const p of batchable) failed.push({ path: p, reason: 'hash-object-failed' });
    }
  }
  return { oids, failed };
}

function hashStdin(repoRoot, data) {
  return git(repoRoot, ['hash-object', '--stdin'], data).toString('latin1').trim();
}

// Overlay one worktree path onto the entry map. Returns a reason string when the
// path's content cannot be named (→ partial for its plane), else null.
function overlayPath(repoRoot, entries, p, opts, pendingRegularHashes) {
  const abs = absBuf(repoRoot, p);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return 'unreadable';
  }
  if (st.isSymbolicLink()) {
    // A symlink hashes as a blob of its target string — git's own semantics.
    try {
      const target = fs.readlinkSync(abs, { encoding: 'buffer' });
      entries.set(p, { mode: '120000', oid: hashStdin(repoRoot, target) });
      return null;
    } catch {
      return 'unreadable-symlink';
    }
  }
  if (st.isDirectory()) {
    // An untracked directory surviving --untracked-files=all is an embedded
    // repository (or a bare dir git refuses to traverse). Enter it as a gitlink
    // candidate; the gitlink pass below resolves or fails it content-sensitively.
    entries.set(p.replace(/\/$/, ''), { mode: '160000', oid: null });
    return null;
  }
  if (!st.isFile()) return 'not-a-regular-file';
  if (opts.maxFileBytes && st.size > opts.maxFileBytes) return 'file-exceeds-size-cap';
  // Regular files batch through one hash-object call at the end.
  pendingRegularHashes.push({ path: p, mode: fileModeOf(st) });
  return null;
}

// Gitlinks are content-sensitive, never index-frozen (§3.2): a clean checkout
// contributes its current HEAD (== the index OID when checked out there); one
// that is dirty inside, uninitialized, or unreadable has no OID that names its
// content → partial. Runs on EVERY 160000 entry, not only status-reported ones:
// an uninitialized submodule emits no porcelain record at all, and
// `submodule.<name>.ignore=all` suppresses even a moved one.
function resolveGitlink(repoRoot, p) {
  const argv = argvPath(p);
  if (argv === null) return { reason: 'submodule-path-not-representable' };
  const abs = path.join(repoRoot, argv);
  // An uninitialized submodule is an empty directory: `git -C` inside it walks
  // UP and discovers the superproject, so a bare rev-parse would silently
  // answer with the HOST's HEAD. The checkout counts only if the discovered
  // repo root is the gitlink directory itself.
  try {
    const top = execFileSync('git', ['-C', abs, 'rev-parse', '--show-toplevel'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString('utf8')
      .trim();
    if (fs.realpathSync(top) !== fs.realpathSync(abs)) {
      return { reason: 'submodule-uninitialized-or-unreadable' };
    }
  } catch {
    return { reason: 'submodule-uninitialized-or-unreadable' };
  }
  let head;
  try {
    head = execFileSync('git', ['-C', abs, 'rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString('latin1')
      .trim();
  } catch {
    return { reason: 'submodule-uninitialized-or-unreadable' };
  }
  // -uall on the CLI overrides a submodule-local status.showUntrackedFiles=no,
  // which would otherwise hide untracked files and let a dirty checkout read as
  // clean. -z output is raw records with no padding; any byte means dirty.
  let dirty;
  try {
    dirty = execFileSync(
      'git',
      ['-C', abs, 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch {
    return { reason: 'submodule-unreadable' };
  }
  if (dirty.length > 0) return { reason: 'submodule-dirty-inside' };
  return { oid: head };
}

/**
 * Compute both plane digests and both dirty sets in one index pass.
 *
 * Returns:
 * {
 *   planes: {
 *     code: { digest: 'sha256:<hex>'|null, partial: boolean, dirty: [path], entryCount },
 *     doc:  { ... }
 *   },
 *   partialReasons: [{ plane, path, reason }]
 * }
 *
 * A `partial` plane has digest null — a partial digest never matches anything,
 * so a gate keyed to it stays open (fail-closed, §3.2).
 */
function computeTreeState(repoRoot, opts = {}) {
  const partialReasons = [];
  const markPartial = (plane, p, reason) => partialReasons.push({ plane, path: p, reason });

  let index, status;
  try {
    index = readIndex(repoRoot);
    status = readStatus(repoRoot);
  } catch (e) {
    // A git failure leaves no plane derivable — both partial.
    const reason = `git-failed: ${String(e && e.message).slice(0, 200)}`;
    return {
      planes: {
        code: { digest: null, partial: true, dirty: [], entryCount: 0 },
        doc: { digest: null, partial: true, dirty: [], entryCount: 0 },
      },
      partialReasons: [
        { plane: 'code', path: null, reason },
        { plane: 'doc', path: null, reason },
      ],
    };
  }

  const entries = index.entries;
  for (const p of index.conflicted) markPartial(planeOf(p), p, 'merge-conflict');

  const dirty = { code: new Set(), doc: new Set() };
  const pendingRegularHashes = [];

  for (const rec of status) {
    const { x, y, path: p } = rec;
    // Obligation: every status record dirties its plane(s); a rename record
    // dirties the union of old and new paths' planes (§3.5).
    dirty[planeOf(p)].add(p);
    if (rec.origPath) dirty[planeOf(rec.origPath)].add(rec.origPath);

    if (isUnmerged(x, y)) {
      markPartial(planeOf(p), p, 'merge-conflict');
      continue;
    }
    if (x === '?' && y === '?') {
      const reason = overlayPath(repoRoot, entries, p, opts, pendingRegularHashes);
      if (reason) markPartial(planeOf(p), p, reason);
      continue;
    }
    if (y === 'D') {
      entries.delete(p);
      continue;
    }
    if (y === 'M' || y === 'T') {
      const idxEntry = entries.get(p);
      if (idxEntry && idxEntry.mode === '160000') {
        continue; // the gitlink pass below resolves every 160000 entry
      }
      const reason = overlayPath(repoRoot, entries, p, opts, pendingRegularHashes);
      if (reason) {
        entries.delete(p);
        markPartial(planeOf(p), p, reason);
      }
      continue;
    }
    // Index-only changes (x in A/M/D/R/C/T with clean worktree column): the index
    // entry already reflects them; nothing to overlay.
  }

  // Gitlink pass — every 160000 entry, status-reported or not.
  for (const [p, entry] of entries) {
    if (entry.mode !== '160000') continue;
    const r = resolveGitlink(repoRoot, p);
    if (r.reason) {
      entries.delete(p);
      markPartial(planeOf(p), p, r.reason);
    } else {
      entry.oid = r.oid;
    }
  }

  // Batch-hash the pending regular files, filters applied.
  if (pendingRegularHashes.length) {
    const { oids, failed } = hashFiles(
      repoRoot,
      pendingRegularHashes.map(e => e.path)
    );
    for (const { path: p, reason } of failed) {
      entries.delete(p);
      markPartial(planeOf(p), p, reason);
    }
    for (const { path: p, mode } of pendingRegularHashes) {
      if (oids.has(p)) entries.set(p, { mode, oid: oids.get(p) });
    }
  }

  // Split, sort by raw path bytes, digest "mode SP oid SP path\0" records.
  const records = { code: [], doc: [] };
  for (const [p, { mode, oid }] of entries) {
    records[planeOf(p)].push({ p, mode, oid });
  }
  const partialPlanes = new Set(partialReasons.map(r => r.plane));
  const planes = {};
  for (const plane of ['code', 'doc']) {
    const list = records[plane].sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
    let digest = null;
    if (!partialPlanes.has(plane)) {
      const h = crypto.createHash('sha256');
      for (const { p, mode, oid } of list) {
        h.update(Buffer.from(`${mode} ${oid} ${p}\0`, 'latin1'));
      }
      digest = `sha256:${h.digest('hex')}`;
    }
    planes[plane] = {
      digest,
      partial: partialPlanes.has(plane),
      dirty: [...dirty[plane]].sort(),
      entryCount: list.length,
    };
  }

  return { planes, partialReasons };
}

module.exports = { computeTreeState, planeOf };

if (require.main === module) {
  const repoRoot = process.argv[2] || process.cwd();
  try {
    const state = computeTreeState(repoRoot);
    process.stdout.write(JSON.stringify(state) + '\n');
  } catch (e) {
    process.stderr.write(`tree-digest: ${String((e && e.stack) || e)}\n`);
    process.exit(1);
  }
}
