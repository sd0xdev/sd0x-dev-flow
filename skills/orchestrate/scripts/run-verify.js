#!/usr/bin/env node
/**
 * run-verify.js — pre/post no-change verification for /orchestrate (SC-2 hard backstop).
 *
 * snapshot:  emit a baseline JSON of git-scoped state on stdout, and its sha256 on stderr.
 * compare:   re-snapshot and diff against --baseline; exit 0 if identical
 *            ("no new drift" — a dirty baseline is supported; only *changes*
 *            relative to the baseline count), exit 1 with drift fields otherwise.
 *            REQUIRES --baseline-sha256: without it, "compare against the baseline"
 *            degrades to "compare against whatever file I was handed", which a
 *            post-mutation re-snapshot satisfies trivially. See the note at the flag.
 *
 * Checks (each catches a bypass class porcelain alone misses):
 *   head                 — sneaky commit (worktree stays clean)
 *   branch               — git checkout -b
 *   porcelain_sha256     — file edits / new untracked (-uall, mirrors stop-guard lesson)
 *   tracked_diff_sha256  — content edits to already-dirty tracked files
 *                          (porcelain records status+path, not content)
 *   untracked_content_sha256 — content edits to pre-existing untracked files
 *                          (same porcelain blind spot, untracked side)
 *   ignored_content_sha256 — content edits to GITIGNORED files (e.g. .env, a
 *                          generated artifact) — invisible to BOTH porcelain and
 *                          ls-files --exclude-standard. Excludes the harness/control/
 *                          safety planes + node_modules/ (see IGNORED_EXCLUDE_PREFIXES).
 *   ignored_dirs_sha256  — existence + mode of ignored DIRECTORY nodes (ls-files
 *                          --directory), catching create/delete/chmod of an EMPTY
 *                          ignored dir that carries no leaf file (invisible to
 *                          porcelain AND ignored_content). See hashIgnoredDirNodes.
 *   refs_sha256          — tag/branch/ref creation or movement (for-each-ref)
 *   local_config_sha256  — local git config tampering (incl. core.hooksPath)
 *   worktrees            — sneaky worktree creation
 *   stash_count          — git stash hiding changes (stash ref also under refs hash)
 *   git_internals_sha256 — .git/hooks/* (planted-hook persistence) and
 *                          .git/info/exclude (hides a matching untracked write
 *                          from porcelain AND ls-files) — both invisible to
 *                          every working-tree check above
 *
 * Any git failure → exit 1 (fail-closed; an unverifiable repo is a drift).
 *
 * Usage:
 *   node skills/orchestrate/scripts/run-verify.js snapshot [--repo <path>]
 *   node skills/orchestrate/scripts/run-verify.js compare --baseline <path|-> --baseline-sha256 <hex> [--repo <path>]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('node:child_process');

function fail(msg) {
  process.stderr.write(`[run-verify] FAIL-CLOSED: ${msg}\n`);
  process.exit(1);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Stream a file's sha256 in bounded 64 KiB chunks so a large descendant (packfile, build
// artifact) never loads whole into memory (no OOM / ERR_FS_FILE_TOO_LARGE). openSync THROWS
// on an unreadable file, propagating to snapshot()'s fail-closed catch — an unverifiable
// file must abort the proof, never collapse to a constant UNREADABLE marker that a
// chmod-then-restore mutation could slip past.
function sha256File(absPath) {
  const h = crypto.createHash('sha256');
  // O_NOFOLLOW | O_NONBLOCK + fstat.isFile(): object-identity, symmetric with
  // hashRegularNodeNoFollow. hashDirRecursive classifies with readdir/lstat and then calls this;
  // a raced classify→read swap of the regular node to a symlink (ELOOP) or a FIFO/device
  // (isFile() false) THROWS → snapshot()'s fail-closed catch, never a followed read or a blocking
  // open. O_NONBLOCK is a no-op on a regular file's read.
  const fd = fs.openSync(absPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!fs.fstatSync(fd).isFile()) {
      throw new Error(`not a regular file (${absPath})`);
    }
    const buf = Buffer.allocUnsafe(65536);
    let bytes;
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      h.update(buf.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

// Length-prefixed framing so two distinct directory states can never serialize to the same
// string. A filename may contain any byte except '/' and NUL (so it CAN contain a newline);
// a plain '\n' join would let such a name alias an adjacent entry — a fail-open collision.
function frameParts(arr) {
  return arr.map((p) => `${Buffer.byteLength(p, 'utf8')}:${p}`).join('');
}

// Depth bound for hashDirRecursive: a real embedded repo's tree is shallow (a .git is ~5
// levels), so any tree past this is pathological. Throwing (fail-closed) beats both a stack
// overflow and a static TOO_DEEP marker (which would be fail-open below the bound).
const MAX_DIR_DEPTH = 256;

// Deterministic recursive digest of a directory's full contents. `git ls-files --others`
// reports an EMBEDDED git repo (a subdir carrying its own .git) as a single `nested/`
// entry rather than recursing, so hashPathsContent would otherwise record only a static
// `type:dir` marker that never changes when `nested/data.txt` is mutated → fail-OPEN.
// Walk every descendant (sorted for determinism), hashing file contents, symlink targets,
// and recursing into real subdirs, so any internal change flips the digest. Symlinks are
// hashed by raw TARGET BYTES (never followed) → no traversal cycles. An unreadable dir or
// file THROWS (readdirSync / sha256File) so the snapshot fails CLOSED rather than recording
// a constant marker a chmod-then-restore content swap could hide behind, and file modes are
// folded in so a chmod-only mutation of a descendant still drifts.
//
// Perf residual (accepted, not a bug): this full walk — including a nested untracked repo's own
// `.git` — re-runs on every snapshot/compare, i.e. up to ~3× per orchestration (snapshot + early
// compare + final compare). Deliberately NOT memoized across calls: an untracked embedded repo in
// a workspace is rare and shallow (MAX_DIR_DEPTH-bounded), and re-reading from disk each time is
// exactly what makes each compare a fresh, TOCTOU-honest measurement (a cached digest could mask a
// mutation landed between calls). Correctness (fail-closed drift on any internal change) outranks
// the redundant walk cost.
function hashDirRecursive(absDir, depth = 0) {
  if (depth > MAX_DIR_DEPTH) {
    throw new Error(`directory nesting exceeds ${MAX_DIR_DEPTH} at ${absDir}`);
  }
  let dirents;
  try {
    dirents = fs.readdirSync(absDir, { withFileTypes: true });
  } catch (e) {
    // Unreadable directory → contents unverifiable; fail closed via snapshot()'s catch.
    throw new Error(`unreadable directory ${absDir}: ${e.message}`);
  }
  dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const parts = [];
  for (const d of dirents) {
    const child = path.join(absDir, d.name);
    // Classify from lstat, NOT from the Dirent. readdir's d_type is a filesystem hint that some
    // backends do not provide: on XFS formatted with `ftype=0`, and on parts of FUSE/overlayfs,
    // every entry arrives as DT_UNKNOWN and EVERY `d.is*()` predicate returns false. A regular
    // file in an untracked subtree would then fall through to the special-file branch and be
    // recorded by MODE ALONE — its contents never hashed, so a post-snapshot content swap that
    // preserves the mode reports clean (fail-OPEN, silently, only on those filesystems).
    // hashPathsContent already classifies with lstatSync; the asymmetry was unintentional.
    // lstat also costs nothing new here — all three surviving branches already called it.
    const st = fs.lstatSync(child);
    if (st.isSymbolicLink()) {
      // Read the target as RAW BYTES so distinct invalid-byte targets don't collapse to the same
      // U+FFFD (fail-OPEN on a retarget), and let a failed readlink THROW → fail-closed, symmetric
      // with the file/dir/special branches. This also closes the non-UTF-8 NAME case: the utf8
      // readdir maps such a name to U+FFFD, so readlink(child) hits ENOENT and throws rather than
      // recording a constant UNREADABLE marker (which would alias a retarget of that link).
      const target = fs.readlinkSync(child, { encoding: 'buffer' });
      parts.push(`${d.name}\u0000symlink:${sha256(target)}`);
    } else if (st.isDirectory()) {
      // Fold in the subdir's OWN permission bits (like the file branch) so a chmod-only
      // mutation of a descendant DIRECTORY (0755→700) surfaces as drift — the recursive
      // digest below only covers the dir's CONTENTS, not the dir node's own mode.
      const dmode = (st.mode & 0o7777).toString(8);
      parts.push(`${d.name}/\u0000${dmode}:${hashDirRecursive(child, depth + 1)}`);
    } else if (st.isFile()) {
      // Stream-hash (throws on unreadable → fail-closed) and fold in permission bits so a
      // chmod-only mutation (0644→0755) of a descendant still surfaces as drift.
      const mode = (st.mode & 0o7777).toString(8);
      parts.push(`${d.name}\u0000${mode}:${sha256File(child)}`);
    } else {
      // FIFO / socket / char|block device. Encode the FULL stat mode (S_IFMT type bits +
      // perms) so a type swap at the same name (FIFO→socket) or a chmod drifts — a constant
      // `special` marker would alias every special-file kind together (fail-OPEN on a swap).
      const smode = st.mode.toString(8);
      parts.push(`${d.name}\u0000special:${smode}`);
    }
  }
  return sha256(frameParts(parts));
}

// Ignored files bypass BOTH `status --porcelain` and `ls-files --exclude-standard`,
// so a hostile "read-only" worker could mutate a gitignored file (e.g. .env,
// .claude/settings.local.json, a generated build artifact) with zero footprint in
// every other snapshot check. We hash ignored content too — EXCLUDING ONLY the
// intentional control/safety planes plus a few demonstrably high-churn / high-volume
// SUBTREES that would otherwise self-trip the verifier or blow up hash-object cost.
// The exclusion is deliberately SURGICAL (not a blanket `.claude/`): stable ignored
// config like .claude/settings*.json / .claude/runner-config.json AND the installed
// hook/script symlinks stay hashed, so their tampering IS caught.
//   .claude_workflows/          orchestrator control plane (written each run by design).
//   .claude_review_state.json*  hook-owned safety plane (+ .blocked/.lockdir siblings).
//   .claude_nit_history.json    nit-history tooling state.
//   .claude/cache/              precommit/tool caches — high churn (hundreds of files).
//   .claude/worktrees/          full worktree checkouts — huge + self-referential.
//   .claude/jobs/               background-job temp state — concurrent churn.
// node_modules is NOT listed here: a `'node_modules/'` prefix entry would (via the directory-style
// `p === pfx.slice(0,-1)` arm below) also match a bare leaf `node_modules`, misclassifying a regular
// ignored FILE named `node_modules` as a dependency dir and dropping it from ignored_content hashing
// (an in-place edit would then go undetected — a fail-open, strict iter-21 P2). node_modules is
// instead excluded by isControlPlaneIgnored's depth-ANCHORED arm (contents at any depth) + the git
// `:(exclude)node_modules/` / `**/node_modules/**` pathspecs (IGNORE_EXCLUDE_PATHSPECS, so it is
// never serialized) + isNodeModulesDirNode (the bare dir NODE, dir-enumeration only). Supply-chain
// tampering UNDER node_modules stays a documented v2 residual (admission-allowlist.json).
// Mutation of an EXCLUDED path is a documented v2 residual (see admission-allowlist.json),
// matching how index-mediated hiding is already deferred there. Everything else ignored
// is content-hashed and fails closed on drift.
const IGNORED_EXCLUDE_PREFIXES = [
  '.claude_workflows/',
  '.claude_review_state.json',
  '.claude_nit_history.json',
  '.claude/cache/',
  '.claude/worktrees/',
  '.claude/jobs/',
];

function isControlPlaneIgnored(p) {
  // node_modules CONTENTS are excluded at ANY depth, not just repo root: a monorepo's
  // packages/<pkg>/node_modules holds the same dependency-tree class as a root one, and the
  // root-only `node_modules/` prefix would let its (large, churny) contents through. These two
  // depth-ANCHORED matches are safe for BOTH files and dirs — every match is genuinely INSIDE a
  // node_modules tree. The bare-leaf node_modules DIRECTORY NODE (`node_modules`,
  // `packages/a/node_modules`) is handled separately by isNodeModulesDirNode, applied ONLY to the
  // dir-node enumeration: matching the leaf here too would misclassify a regular ignored FILE named
  // `node_modules` (e.g. `pkg/node_modules`) as a dependency dir and silently drop it from
  // ignored_content hashing → an in-place edit to it would go undetected (Codex iter-20 P2).
  if (
    p.startsWith('node_modules/') ||
    p.includes('/node_modules/')
  ) return true;
  return IGNORED_EXCLUDE_PREFIXES.some((pfx) => {
    if (pfx.endsWith('/')) {
      // Directory-style prefix (e.g. .claude/cache/): the dir node itself or any descendant.
      return p === pfx.slice(0, -1) || p.startsWith(pfx);
    }
    // File-style prefix (e.g. .claude_review_state.json): the EXACT file, a dotted sibling
    // (<name>.blocked / .lockdir / .XXXXXX temp), or a child under a same-named dir. A bare
    // p.startsWith(pfx) would ALSO swallow an unrelated `<name>Xevil/…` that merely shares the
    // leading characters, widening the hidden surface past the intended safety plane — so anchor
    // the match to a `.`/`/` separator (or exact equality).
    return p === pfx || p.startsWith(`${pfx}.`) || p.startsWith(`${pfx}/`);
  });
}

// Directory subtrees excluded at the GIT pathspec level so `ls-files` never emits
// them — the ENOBUFS-safe form of the exclusion (filtering AFTER collection still
// forces git to serialize the entire tree into execFileSync's buffer first). Only
// the high-VOLUME dirs need this; the small file-level control-plane entries stay in
// the JS filter above. The glob form catches nested node_modules in a monorepo. An
// explicit '.' positive pathspec accompanies these so the exclude-only set resolves
// against the whole tree on every git version (not just those that imply '.').
//
// The dependency/build/cache dirs below (venv, target, build, dist, .gradle, .next) are
// the standard high-volume GITIGNORED trees: on a real consumer repo a `.venv/` or Rust
// `target/` can hold tens of thousands of files, and enumerating + content-hashing them
// three times per executed orchestration (snapshot + two compares) turns a no-drift check
// into a multi-minute stall or resource-pressure failure. They are TOP-LEVEL matches (the
// 80% layout); a nested `packages/*/dist/` is a documented residual, same class as the
// node_modules glob below. RESIDUAL RISK (accepted, mirrors node_modules): a worker mutating
// a gitignored artifact UNDER one of these dirs is not caught by ignored_content_sha256 —
// see references/admission-allowlist.json. A repo that needs one of these trees verified can
// stop gitignoring it (tracked files stay covered by porcelain_sha256 / tracked_diff_sha256).
const IGNORE_EXCLUDE_PATHSPECS = [
  ':(exclude).claude_workflows/',
  ':(exclude).claude/cache/',
  ':(exclude).claude/worktrees/',
  ':(exclude).claude/jobs/',
  ':(exclude)node_modules/',
  ':(glob,exclude)**/node_modules/**',
  ':(exclude).venv/',
  ':(exclude)venv/',
  ':(exclude)target/',
  ':(exclude)build/',
  ':(exclude)dist/',
  ':(exclude).gradle/',
  ':(exclude).next/',
];

// The `--directory` collapse in the ignored-DIR-node enumeration (snapshot's ignoredDirPaths) does
// NOT honor the `:(exclude)<dir>/` pathspecs the FILE-level enumeration relies on: git still emits the
// collapsed `dist/` / `build/` / `.venv/` node even when that dir is pathspec-excluded (verified: the
// file-level list is empty for an excluded dir, yet the dir-level list still yields its node). Left
// unfiltered, create/delete/chmod churn in a gitignored build/dependency tree DURING a run would drift
// ignored_dirs_sha256 → a spurious fail-closed on ordinary concurrent build/env activity. Mirror the
// pathspec exclusion in JS: drop any collapsed node that IS one of the excluded high-volume roots (or a
// descendant). Derived from IGNORE_EXCLUDE_PATHSPECS so the two lists can never diverge; the `:(glob…)`
// node_modules entry has no plain prefix and is already covered by isControlPlaneIgnored's node_modules
// check. This is the dir-node analogue of that git-level file exclusion, not a new safety carve-out:
// content churn under these trees is the SAME accepted residual documented on IGNORE_EXCLUDE_PATHSPECS.
const IGNORE_EXCLUDE_DIR_PREFIXES = IGNORE_EXCLUDE_PATHSPECS.map((s) => {
  const m = s.match(/^:\(exclude\)(.+)\/$/);
  return m ? m[1] : null;
}).filter(Boolean);

function isVolumeExcludedDir(p) {
  return IGNORE_EXCLUDE_DIR_PREFIXES.some((pfx) => p === pfx || p.startsWith(`${pfx}/`));
}

// The node_modules DIRECTORY NODE itself (not its contents). The `--directory` collapse emits it as a
// single node (root `node_modules`, or nested `packages/a/node_modules`) with the trailing slash
// stripped before this call, so the depth-anchored `node_modules/` / `/node_modules/` checks in
// isControlPlaneIgnored miss it, and isVolumeExcludedDir only catches the ROOT one (the `:(exclude)`
// pathspec has no nested prefix). Match the bare leaf here — but this is applied ONLY to the dir-node
// enumeration, where the caller has already kept trailing-slash dir entries. It deliberately does NOT
// run on the file list: a regular ignored FILE literally named `node_modules` must stay content-hashed,
// not be misread as a dependency dir (Codex iter-20 P2). Without this, a nested node_modules created
// mid-run (ordinary `npm install`) would spuriously drift ignored_dirs_sha256 (Codex iter-19 P2).
function isNodeModulesDirNode(p) {
  return p === 'node_modules' || p.endsWith('/node_modules');
}

// Config-injection guard, prepended to EVERY git invocation in this file.
//
// This script is the read-only verifier: its whole job is to run git against a repository it does
// not trust. But git reads that repository's OWN `.git/config` and `.gitattributes`, and several
// settings there are commands git EXECUTES:
//   - `core.fsmonitor = <program>` runs on `status`, `ls-files`, and `diff` — i.e. on the majority
//     of the calls below, including the enumeration the drift proof rests on.
//   - `diff.<driver>.textconv` / `diff.<driver>.command`, selected by a `.gitattributes`
//     `diff=<driver>` line, run during `diff HEAD --binary`.
// A hostile or compromised repo therefore achieves arbitrary execution inside the verifier merely
// by being verified — and a program that runs before the snapshot completes can hide the very
// mutation the snapshot exists to detect. Local-scope config tampering BETWEEN snapshot and compare
// is caught by `local_config_sha256` (`git config --local --list`), NOT by `gitInternalsDigest` —
// that one covers the hooks directory, its entries, and `.git/info/exclude`, and never reads a
// config file. (This comment named the wrong field; the distinction matters because the two have
// different blind spots.) Neither helps against config that is already present at snapshot time,
// and `--local` sees neither GLOBAL nor SYSTEM scope, where the same `core.fsmonitor` /
// `diff.*.textconv` settings are equally executable — hence the `-c` overrides below rather than
// relying on detection at all.
//
// `-c core.fsmonitor=false` wins over repo-local config and the setting defaults to unset, so on an
// honest repo this changes nothing. The per-call `--no-ext-diff --no-textconv` on the diff below
// covers the attribute-selected drivers, which a `-c` override cannot name in advance.
//
// Deliberately NOT overriding `core.hooksPath`: none of the subcommands used here (status,
// ls-files, hash-object, rev-parse, diff, for-each-ref, config, worktree, stash) run hooks, and
// pointing it at /dev/null redirects `rev-parse --git-path hooks` — which gitInternalsDigest uses
// to LOCATE the hooks directory it hashes. That silently disarms the planted-hook detection this
// verifier exists to provide (measured: 52 tests fail with `unreadable hooks dir /dev/null`).
const GIT_SAFE_CONFIG = ['-c', 'core.fsmonitor=false'];

function git(repo, cliArgs) {
  // maxBuffer backstop: execFileSync's default 1 MiB stdout cap throws ENOBUFS on
  // large output (a big `diff HEAD`, or an ignored-file listing on a repo with a
  // heavy dependency tree). ENOBUFS would surface as a snapshot failure → fail-closed
  // (an unverifiable repo reads as drift), turning a benign large repo into a hard stop.
  // 256 MiB is far above any realistic git text output here while still bounding a
  // runaway. The high-volume ignored subtrees are ALSO excluded at the pathspec level
  // below so git never emits them; this cap is the belt to that suspenders.
  return execFileSync('git', ['-C', repo, ...GIT_SAFE_CONFIG, ...cliArgs], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trimEnd();
}

// `git ls-files --others [--ignored]` enumerates the working tree by walking directories. When a
// directory is UNREADABLE (mode 0000, or not owned by us) git cannot list its contents: it prints
// `warning: could not open directory '<dir>': Permission denied` to stderr and EXITS 0, silently
// OMITTING that subtree. execFileSync (the git() helper) discards stderr on success, so the caller
// sees a short listing that looks complete. That is fail-OPEN in the adversarial model: a worker
// owning an unreadable pre-existing ignored dir can unlock it, mutate a file inside, re-lock it,
// and BOTH snapshots hash the same (dir-omitted) listing → compare returns {ok:true} despite the
// mutation. So run the enumeration through spawnSync to capture stderr, force LC_ALL=C for a stable
// English message, and treat any "open directory" dir-omission warning as a snapshot FAILURE
// (throw → snapshot()'s fail-closed catch: an un-enumerable tree is unverifiable = drift). A bare
// file-access "permission" warning is deliberately NOT treated as failure (see the scoped regex
// below) — it does not imply an omitted subtree and would spuriously fail-close a clean tree.
function gitEnumerate(repo, cliArgs) {
  const r = spawnSync('git', ['-C', repo, ...GIT_SAFE_CONFIG, ...cliArgs], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, LC_ALL: 'C' },
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`git ${cliArgs.join(' ')} exited ${r.status}: ${(r.stderr || '').trim()}`);
  }
  const stderr = r.stderr || '';
  // Detect a SILENTLY-OMITTED unreadable DIRECTORY: `git ls-files --others` skips a directory it
  // cannot read, prints a warning, but still EXITS 0 — so the listing is incomplete yet looks
  // successful. Match ONLY directory-scoped phrasings. git's exact wording varies by version
  // ("could not open directory", "cannot open directory", or a `warning: … open directory …`
  // line), so the literal dir-open phrasings PLUS a `warning:`-line "open directory" catch-all
  // cover the variance.
  //
  // CRITICAL — this MUST stay directory-scoped (strict iter-13 P2). Bare `Permission denied` /
  // `unable to access` alternatives OVER-match: `git ls-files` also warns (and still exits 0, fully
  // enumerating the tree) when an unreadable global CONFIG/excludes/attributes FILE is present —
  // e.g. a root-owned or mode-600 `core.excludesFile` in a container/CI/restricted-HOME. That
  // warning is BENIGN for enumeration completeness; matching it would throw → snapshot()=null → the
  // whole orchestration reports SPURIOUS drift on a genuinely clean tree, defeating the verifier.
  //
  // The catch-all is scoped to the PHRASE "open directory" (strict iter-14 P2) AND anchored to the
  // message STEM by forbidding a quote before it — `warning:[^']*open directory` (strict iter-15 Nit).
  // Rationale: in every real dir-omission warning the verb precedes the path quote
  // (`warning: … open directory '<path>' …`), so "open directory" always sits in the pre-quote
  // `[^']*` window. git's benign FILE warning is `warning: unable to access '<path>': Permission
  // denied`; the earlier `warning:[^\n]*open directory` catch-all could STILL false-fire if <path>
  // itself literally contained "open directory" (e.g. an excludesFile under `.../open directory/`) —
  // a spurious fail-closed on a clean tree (safe direction, but wrong). Because that phrase would sit
  // AFTER the path's opening quote, `[^']*` stops at the quote and never reaches it, closing the
  // residual. (The `[^\n]*` → `[^']*` swap cannot lose a genuine omission: its "open directory" is
  // pre-quote; and the literal `could not/cannot open directory` alternatives catch the common
  // phrasings regardless.)
  if (/could not open directory|cannot open directory|warning:[^']*open directory/i.test(stderr)) {
    throw new Error(`ls-files enumeration incomplete (unreadable path): ${stderr.trim()}`);
  }
  // trimEnd() mirrors git(): it strips a trailing newline but leaves the `-z` NUL terminator, so
  // the caller's split('\0').filter(Boolean) drops the empty final element exactly as before.
  return (r.stdout || '').trimEnd();
}

// hash-object in batches: passing every untracked path as one argv can exceed
// ARG_MAX (E2BIG) on repos with very many untracked files. CHUNK bounds the
// element COUNT per call, which covers the common case; a single chunk of a few
// hundred multi-KB paths could still exceed the byte limit, but that overflow
// throws → fail-closed (safe), never a silent miss. argv (not --stdin-paths) is
// deliberate — it stays correct for paths containing newlines, which a hostile
// worker could otherwise use to slip a write past a line-delimited reader.
//
// Hash-algorithm note (adversarial threat model): `git hash-object` uses git's DEFAULT SHA-1
// object hash for this top-level untracked/ignored CONTENT check, whereas directory descendants
// use sha256File (SHA-256). The SHA-1 reliance is acceptable HERE — not because SHA-1 is
// collision-free (it is not; cf. SHAttered) — but because the only adversary is a fanout worker
// that runs strictly AFTER snapshot(). To hide a mutation behind a collision it would have to
// pre-stage one half of a chosen-prefix pair BEFORE the pre-dispatch snapshot, which the ordering
// (snapshot precedes any agent, see SKILL.md) forecloses. A worker can only swap content
// POST-snapshot, and any such swap has no pre-staged SHA-1 partner → the hash changes → drift.
// Consistent with git's own object model, which the whole verifier already trusts.
// `--no-filters` is load-bearing, not a micro-optimisation. Without it `git hash-object` applies
// the path's CLEAN filter and EOL conversion before hashing, so under an ordinary (non-adversarial)
// `* text=auto` gitattribute or `core.autocrlf`, an LF↔CRLF rewrite of a file yields the SAME
// object id. For GITIGNORED and UNTRACKED paths — precisely what this function exists to cover —
// no other signal contradicts it: `status --porcelain` reports `?? path` unchanged, and the mode
// is untouched. The verifier therefore returned `{"ok": true}` after a real filesystem write
// (reproduced on git 2.54: identical OID with filters, different OIDs with --no-filters).
// `--no-filters` hashes the bytes on disk, which is the question being asked, and is a no-op when
// no attribute applies — it also makes this path consistent with sha256File, which already hashes
// raw bytes. NOTE: it does NOT suppress symlink following; that residual is handled by the
// lstat-based classification in the caller.
function hashObjects(repo, paths) {
  const hashes = [];
  const CHUNK = 500;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const out = git(repo, ['hash-object', '--no-filters', '--', ...chunk]);
    const lines = out === '' ? [] : out.split('\n');
    // Fail closed on any arity mismatch. The caller zips hashes[j] onto fileList[j] positionally,
    // so a short result would silently shift every later path onto the wrong hash, and a missing
    // tail element stringifies to the literal "undefined" IDENTICALLY at snapshot and at compare —
    // i.e. two mutated files would compare equal. No reachable case is known today; the assertion
    // costs one comparison and converts a hypothetical silent fail-open into a loud abort.
    if (lines.length !== chunk.length) {
      throw new Error(
        `git hash-object returned ${lines.length} hashes for ${chunk.length} paths — refusing to zip a misaligned result`
      );
    }
    hashes.push(...lines);
  }
  return hashes;
}

// Build NUL-delimited "<path>\u0000<hash>" content lines for a set of ls-files paths.
// `git hash-object` FOLLOWS symlinks and dies on a symlink-to-directory — and this repo
// (and any installed plugin) ships exactly those: `.claude/agents -> ../agents`, etc.,
// which land in the ignored listing. Passing one straight to hash-object aborts the whole
// snapshot → fail-closed on a benign repo. So classify each path by lstat:
//   symlink        → hash the LINK TARGET string (also catches an ignored symlink being
//                    repointed, which following-then-hashing-content would miss).
//   regular file   → batched git hash-object (fast path). RESIDUAL (classify→read follow):
//                    git hash-object FOLLOWS symlinks and has no --no-follow, so unlike the
//                    directory branch's sha256File and the gitInternalsDigest hashRegularNodeNoFollow
//                    (both object-identity O_NOFOLLOW+isFile reads), a raced lstat(isFile)→hash swap
//                    to a symlink-to-FILE here would hash the TARGET, not the original node. Left as a
//                    DOCUMENTED residual, not fixed: (a) it needs an adversary mutating DURING a single
//                    snapshot()/compare() call, but the verifier runs only when no fanout worker is live
//                    (SKILL.md ordering) — the same out-of-model lingering-adversary class as the other
//                    TOCTOU residuals; (b) a symlink-to-DIRECTORY still fail-closes (hash-object aborts);
//                    (c) closing it means re-implementing git's object hashing, forfeiting the object-model
//                    consistency the SHA-1 note above relies on; (d) any post-snapshot swap still drifts on
//                    the next non-raced snapshot. Tracked in references/admission-allowlist.json residual_risk.
//   directory      → recursive content digest (an embedded repo is listed as a lone
//                    `nested/` entry; a static type marker can't see internal mutations
//                    → fail-OPEN, so digest every descendant's path + content instead).
//   special        → a type marker (drifts on a type swap, never crashes).
//   unresolvable   → FAIL-CLOSED (throw). ls-files JUST emitted this path, so an lstat failure
//                    is an anomaly with two causes, both of which a constant marker mishandled:
//                    (1) NON-UTF-8 filename — git() decodes ls-files -z as 'utf8', mapping invalid
//                    bytes to U+FFFD; the mangled path then lstat-fails. The old constant `GONE`
//                    marker recorded IDENTICALLY at snapshot AND compare, so mutating that file's
//                    content drifted in NEITHER porcelain (it re-quotes the path unchanged) NOR
//                    this digest → compare wrongly returned {ok:true} (a fail-OPEN hole).
//                    (2) genuine TOCTOU vanish mid-snapshot. Throwing routes to snapshot()'s
//                    fail-closed catch (an unverifiable path IS drift), matching every other
//                    unreadable case here, and still drifts on the vanish (fail-closed == drift).
// Positions are preserved so the caller's pre-sorted order is stable across snapshots.
function hashPathsContent(repo, paths) {
  const entries = new Array(paths.length);
  const fileList = [];
  const fileIndex = [];
  const modeList = [];
  for (let i = 0; i < paths.length; i += 1) {
    const p = paths[i];
    let st;
    try {
      st = fs.lstatSync(path.join(repo, p));
    } catch (e) {
      throw new Error(`unresolvable ls-files path (non-UTF-8 name or TOCTOU vanish): ${p} (${e.message})`);
    }
    if (st.isSymbolicLink()) {
      // Read the target as RAW BYTES so distinct invalid-byte targets (…0xff vs …0xfe) don't
      // collapse to the same U+FFFD under readlinkSync's default utf8 decoding (fail-OPEN on a
      // retarget). sha256() hashes a Buffer's raw bytes (the utf8 arg is ignored for Buffers). Let
      // a failed readlink THROW → fail-closed via snapshot()'s catch, symmetric with the file/dir/
      // special branches: a constant UNREADABLE marker would alias a vanished or non-round-tripping
      // link (an lstat-visible symlink whose name → U+FFFD → readlink ENOENT) to a stable value.
      const target = fs.readlinkSync(path.join(repo, p), { encoding: 'buffer' });
      entries[i] = `${p}\u0000symlink:${sha256(target)}`;
    } else if (st.isFile()) {
      fileList.push(p);
      fileIndex.push(i);
      modeList.push((st.mode & 0o7777).toString(8));
    } else if (st.isDirectory()) {
      // Fold the dir node's own mode (0o7777) ahead of the recursive content digest so a
      // top-level embedded-repo/dir chmod drifts, matching hashDirRecursive's subdir branch.
      entries[i] = `${p}\u0000dir:${(st.mode & 0o7777).toString(8)}:${hashDirRecursive(path.join(repo, p))}`;
    } else {
      // Encode the full stat mode (type + perms) instead of a constant marker so a type
      // swap/chmod drifts. (git ls-files does not emit true special files, so this branch is
      // effectively defensive; the reachable case is hashDirRecursive's readdir walk.)
      entries[i] = `${p}\u0000special:${st.mode.toString(8)}`;
    }
  }
  const hashes = hashObjects(repo, fileList);
  for (let j = 0; j < fileIndex.length; j += 1) {
    entries[fileIndex[j]] = `${fileList[j]}\u0000${modeList[j]}:${hashes[j]}`;
  }
  // Fold in ANCESTOR directory modes. ls-files emits leaf FILES (`newdir/app.js`), never the parent
  // dir NODE (`newdir/`), so a chmod of an untracked/ignored ancestor dir (0755->0700) with its
  // contents untouched leaves every leaf hash AND porcelain unchanged -> fail-OPEN (only an embedded
  // repo arrives as its own dir entry, already mode-hashed above). Collect each leaf's ancestors
  // (parent -> repo-root-exclusive), lstat each once in sorted order, and append its mode. A stat
  // failure throws -> fail-closed (an unverifiable ancestor is drift), symmetric with the leaf
  // branches. Over-including a pre-existing tracked ancestor only ADDS drift sensitivity (the
  // fail-closed direction); the tight snapshot<->compare window makes benign mode churn negligible.
  // path.posix.dirname splits the git path (always '/'-separated, even for a name with a backslash).
  const ancestors = new Set();
  for (const ap of paths) {
    let dir = path.posix.dirname(ap);
    while (dir && dir !== '.' && dir !== '/' && !ancestors.has(dir)) {
      ancestors.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  const dirModeParts = [];
  for (const d of [...ancestors].sort()) {
    let dst;
    try {
      dst = fs.lstatSync(path.join(repo, d));
    } catch (e) {
      throw new Error(`unresolvable ancestor dir (TOCTOU vanish or non-UTF-8 name): ${d} (${e.message})`);
    }
    dirModeParts.push(`${d}\u0000dirmode:${(dst.mode & 0o7777).toString(8)}`);
  }
  return frameParts([...entries, ...dirModeParts]);
}

// Digest of the .git-internal state that changes what git executes (hooks) or
// what porcelain/ls-files report (info/exclude) yet is invisible to every
// working-tree check in snapshot():
//   .git/hooks/*       — a planted pre-commit is a code-execution persistence
//                        payload; a chmod +x of a sample is itself a change.
//   .git/info/exclude  — appending a pattern hides a matching untracked write
//                        from both `status --porcelain` and
//                        `ls-files --exclude-standard`.
// Paths resolve through `git rev-parse --git-path`, which returns the
// worktree-shared common-dir location (worktree-safe) AND follows an effective
// core.hooksPath (Git >= 2.10) regardless of the config scope that set it — so
// this digest catches a redirected hooks dir even when the redirect lives in
// global/system config, which local_config_sha256 (local scope only) would miss.
// include.path tampering remains covered by local_config_sha256 (includes are
// resolved at read time).
// Read a REGULAR file's mode + content atomically through ONE fd, refusing to follow a symlink and
// refusing every non-regular node. lstat/readdir only CLASSIFY; the digest material (mode+content)
// must come from a single opened object, or a worker could swap a regular file for a symlink (or
// another file) in the classify→read window and a path-based readFileSync would follow it.
//  - O_NOFOLLOW: a raced-in symlink fails with ELOOP → the caller's fail-closed catch fires (a race
//    becomes an abort, never a followed read).
//  - O_NONBLOCK: opening a FIFO/device returns immediately instead of blocking on a writer — a
//    worker could otherwise WEDGE final verification by planting a FIFO at .git/info/exclude or
//    under .git/hooks/. Harmless on a regular file (open/read never block on one).
//  - fstat(fd).isFile(): reject FIFO/socket/device/dir — only a regular file has a meaningful
//    mode+content digest; anything else is unverifiable → throw (fail closed).
// fstat+read share the fd so mode and content always describe the SAME inode. A raced delete →
// openSync ENOENT → throw. An unreadable file → EACCES → throw. Every failure mode is fail-closed.
// Exported for direct object-identity unit testing.
function hashRegularNodeNoFollow(abs) {
  const fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) {
      throw new Error(`not a regular file (${abs}): st_mode type ${(st.mode & 0o170000).toString(8)}`);
    }
    const mode = (st.mode & 0o7777).toString(8);
    const content = crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex');
    return { mode, content };
  } finally {
    fs.closeSync(fd);
  }
}

function gitInternalsDigest(repo) {
  const parts = [];
  const gitPath = (rel) => path.resolve(repo, git(repo, ['rev-parse', '--git-path', rel]));

  const hooksDir = gitPath('hooks');
  let hookEntries = [];
  try {
    hookEntries = fs
      .readdirSync(hooksDir, { withFileTypes: true })
      .filter((d) => !d.isDirectory()) // files + symlinked hooks (git runs those too)
      .map((d) => d.name)
      .sort();
  } catch (e) {
    // A genuinely absent hooks dir (ENOENT) → nothing to hash. But an UNREADABLE dir
    // (EACCES etc.) is unverifiable state a chmod-then-restore could hide behind — THROW
    // so snapshot() fails CLOSED, consistent with hashDirRecursive (never collapse an
    // unreadable dir to the same digest as an empty one).
    if (e.code !== 'ENOENT') {
      throw new Error(`unreadable hooks dir ${hooksDir}: ${e.message}`);
    }
    hookEntries = []; // no hooks dir → nothing to hash
  }
  // Fold in the hooks DIRECTORY NODE itself — its own type, mode, and (when it is a symlink) its
  // target — not just the entries inside it. The loop below covers `hooks/<name>`; nothing covered
  // `hooks/` as a node, so a chmod of the directory (0755→0700, still owner-readable so readdir
  // keeps working) or a repoint of a symlinked `.git/hooks` to a different directory produced an
  // identical digest. Symmetric with hashDirRecursive, which already folds each subdirectory's own
  // mode in beside its recursive content digest. An ENOENT hooks dir contributes the explicit
  // `absent` marker so "no hooks dir" and "empty hooks dir" cannot serialize the same way.
  try {
    const hst = fs.lstatSync(hooksDir);
    if (hst.isSymbolicLink()) {
      parts.push(`hooks/\u0000symlink:${sha256(fs.readlinkSync(hooksDir, { encoding: 'buffer' }))}`);
    } else {
      parts.push(`hooks/\u0000${hst.mode.toString(8)}`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw new Error(`unstattable hooks dir ${hooksDir}: ${e.message}`);
    }
    parts.push('hooks/\u0000absent');
  }
  for (const name of hookEntries) {
    const abs = path.join(hooksDir, name);
    // lstat first: a TOCTOU vanish or unreadable node THROWS → snapshot()'s fail-closed
    // catch, never a stable marker. Fold in the FULL mode (not just the x-bit) so a
    // 0755→0700 chmod of a hook drifts, symmetric with hashDirRecursive's file branch.
    const lst = fs.lstatSync(abs);
    if (lst.isSymbolicLink()) {
      // Hash the symlink TARGET (readlink never follows) so a retarget drifts even if new content
      // matches. A raced swap symlink→regular → readlinkSync EINVAL → throw → fail closed.
      const target = fs.readlinkSync(abs, { encoding: 'buffer' });
      parts.push(`hook ${name} symlink ${sha256(target)}`);
    } else {
      // Regular hook: mode + content via ONE no-follow fd (object-identity). lstat only classifies;
      // a raced swap regular→symlink → ELOOP → throw, an unreadable hook → EACCES → throw; both
      // route to snapshot()'s fail-closed catch, never a constant marker. Full mode folds in so a
      // 0755→0700 chmod drifts.
      const { mode, content } = hashRegularNodeNoFollow(abs);
      parts.push(`hook ${name} ${mode} ${content}`);
    }
  }

  // info/exclude: lstat CLASSIFIES (absent / symlink / regular), then each branch reads through an
  // object that cannot be redirected by a classify→read race. The old readFileSync(excludeAbs)
  // FOLLOWED the link, so a DANGLING symlink resolved to ENOENT and collapsed to the same ABSENT
  // marker as a genuinely-missing file — a worker could plant or retarget a dangling exclude link
  // with zero drift, and the link's own target bytes were never hashed. A symlink now hashes its
  // raw TARGET (readlink, never follows); a regular file reads via a no-follow fd (see
  // hashRegularNodeNoFollow) — symmetric with the hook branch, no residual follow-through.
  const excludeAbs = gitPath('info/exclude');
  let excludeHash = 'ABSENT';
  let excludeLst = null;
  try {
    excludeLst = fs.lstatSync(excludeAbs);
  } catch (e) {
    // ENOENT on lstat = genuinely absent (a real, distinct state → ABSENT sentinel is correct).
    // Any other error (e.g. EACCES on the containing dir) is unverifiable → THROW (fail closed),
    // never collapse to the same ABSENT marker a chmod-then-restore could hide behind.
    if (e.code !== 'ENOENT') {
      throw new Error(`unresolvable info/exclude ${excludeAbs}: ${e.message}`);
    }
    /* no info/exclude node → ABSENT sentinel (distinct from an empty file's hash) */
  }
  if (excludeLst) {
    if (excludeLst.isSymbolicLink()) {
      // A present (even dangling) symlink is NOT absent — hash its raw TARGET so a plant, or a
      // retarget between two (even dangling) targets, drifts instead of collapsing to ABSENT via a
      // followed-ENOENT. readlink never follows; a raced swap symlink→regular → EINVAL → throw.
      const target = fs.readlinkSync(excludeAbs, { encoding: 'buffer' });
      excludeHash = `symlink ${sha256(target)}`;
    } else {
      // Regular file: mode + content via ONE no-follow fd (object-identity). An unreadable file
      // (EACCES) or a raced swap-to-symlink (ELOOP) THROWS → snapshot()'s fail-closed catch.
      const { mode, content } = hashRegularNodeNoFollow(excludeAbs);
      excludeHash = `${mode} ${content}`;
    }
  }
  parts.push(`info/exclude ${excludeHash}`);

  // frameParts, not `parts.join('\n')` — this is the exact collision frameParts was written for
  // and the sole call site that was still missing it (168 and 550 already use it). Hook entries
  // are built as `hook ${name} ${mode} ${content}` with `name` straight out of readdirSync of
  // .git/hooks/, and a filename may contain any byte but '/' and NUL — newline included. A hook
  // named with an embedded newline could therefore serialize identically to two adjacent entries,
  // letting a forged node absorb its neighbours so that DELETING a real hook still digests clean.
  // Length-prefixing makes every entry boundary unambiguous.
  return sha256(frameParts(parts));
}

// Digest ignored DIRECTORY NODES (existence + own mode) — the empty-ignored-dir hole (Codex iter-14
// P2). The file-level ignored_content enumeration lists ignored FILES only (`ls-files -o -i`
// recurses into ignored dirs, emitting leaf files, never a trailing-slash dir entry), and
// hashPathsContent's ancestor-mode folding only fires for dirs that CONTAIN a leaf. So an EMPTY
// ignored dir — created, deleted, or chmod'd by an adversarial worker post-snapshot — is invisible
// to both porcelain (-uall never lists ignored/empty) and the content digest → compare returns
// {ok:true} despite a filesystem mutation, breaking the "zero filesystem change" report-only proof.
// `ls-files --directory` collapses each ignored dir to a single `dir/` node (empty ones included,
// verified on git 2.54), so this digest of sorted `path\0mode` drifts on create (new node), delete
// (node vanishes), or chmod (mode changes). An lstat failure THROWS → snapshot()'s fail-closed catch
// (an unresolvable node is drift), symmetric with hashPathsContent.
// RESIDUAL: `--directory` collapses at the FIRST ignored ancestor, so a nested EMPTY dir created
// BELOW an already-ignored dir (e.g. `cache/emptysub/` when `cache/` is ignored) is not individually
// enumerated — only `cache/`'s node is. Non-empty descendants are still caught (files by
// ignored_content, their ancestor modes by hashPathsContent); only nested EMPTY dirs escape. This is
// a deep edge behind the read-only admission allowlist (workers cannot mkdir via their tools) and is
// a documented v2 residual, consistent with the IGNORE_EXCLUDE_PATHSPECS high-volume-subtree residual.

// Expand the `--directory`-collapsed UNTRACKED dir nodes into every directory beneath them.
//
// `ls-files --others --directory` collapses each untracked tree at its FIRST untracked ancestor, so
// a repo whose baseline already contains `scratch/file` enumerates exactly `scratch/` — and then
// `mkdir scratch/empty`, `rmdir` it, or `chmod` any nested dir moves NO digest on ANY plane:
// porcelain never lists directories, and the file-level untracked scan only yields leaves. Verified
// against real git: with `scratch/{file.txt,nested/deep/y.txt,emptydir}` untracked, `--directory`
// emits the single node `scratch/`. That is the common case, not an exotic one — this repo's own
// `test/hooks/helpers/` collapses the same way — so on the untracked plane the collapse defeats the
// hole this digest exists to close.
//
// The IGNORED plane keeps the collapse as a deliberate residual (see above): recursing into
// `node_modules/` is precisely the cost blowup IGNORE_EXCLUDE_PATHSPECS exists to prevent. The
// untracked plane's trade-off is the opposite one, and the marginal cost here is provably
// negligible: every FILE in these same trees is already enumerated AND content-hashed by
// `untracked_content`, so any tree big enough to make this readdir walk expensive is already
// costing far more on a plane that predates it. This walk adds no new order of magnitude.
//
// Symlinks are not followed: `withFileTypes` populates the Dirent from the directory entry itself,
// so a symlink-to-directory reports isSymbolicLink() and never isDirectory(), and the walk cannot
// be steered outside the tree by planting one. The same three exclusion predicates as the caller
// are re-applied per level, because `--directory` only ever showed us the root of each tree.
function expandUntrackedDirTree(repo, roots) {
  const out = new Set();
  const stack = [...roots];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (out.has(cur)) continue;
    out.add(cur);
    const bare = cur.replace(/\/+$/, '');
    let ents;
    try {
      ents = fs.readdirSync(path.join(repo, bare), { withFileTypes: true });
    } catch (e) {
      // ENOENT is the benign race (the tree was removed between enumeration and the walk) and the
      // vanished node is already drift on the digest itself, since `cur` stays in the set while its
      // children do not. Anything else is "I could not look", which is not an answer — fail closed.
      if (e.code === 'ENOENT') continue;
      throw new Error(`unresolvable untracked dir node: ${cur} (${e.message})`);
    }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const child = `${bare}/${ent.name}`;
      if (isControlPlaneIgnored(child) || isVolumeExcludedDir(child) || isNodeModulesDirNode(child)) continue;
      stack.push(`${child}/`);
    }
  }
  return [...out].sort();
}

// Digest the MODES of tracked paths — the tracked plane's counterpart to the folding every other
// plane already does (`st.mode & 0o7777` at the ignored-dir, untracked, and git-internals sites).
//
// The tracked plane is proved by `porcelain_sha256` + `tracked_diff_sha256`, and git records exactly
// ONE permission bit: the exec bit. Every other bit is invisible to it, so `chmod 666` on a tracked
// FILE and `chmod 777` on a tracked DIRECTORY both leave porcelain and the diff byte-identical — a
// worker could make the entire tracked tree world-writable and the verifier still returned
// {"ok": true} on its "zero filesystem change" proof. Reproduced on a real repo before this existed.
//
// Directories are included because a tracked file's own mode says nothing about the permissions of
// the directory holding it, and `chmod` on a directory is the more consequential of the two. The
// ancestor set is DERIVED from the tracked file list rather than walked, so it costs no extra
// enumeration and covers exactly the directories git considers part of the tracked tree.
// An lstat failure THROWS → snapshot()'s fail-closed catch, symmetric with hashIgnoredDirNodes.
function hashTrackedModes(repo, filePaths) {
  const targets = new Set(filePaths);
  for (const p of filePaths) {
    // Every ancestor up to the repo root. `path.posix` because git emits '/'-joined paths on every
    // platform; the root's own node is added once below rather than per file.
    let dir = path.posix.dirname(p);
    while (dir && dir !== '.') {
      targets.add(`${dir}/`);
      dir = path.posix.dirname(dir);
    }
  }
  targets.add('./');
  const entries = [];
  for (const p of [...targets].sort()) {
    const rel = p.endsWith('/') ? p.slice(0, -1) : p;
    let st;
    try {
      st = fs.lstatSync(path.join(repo, rel));
    } catch (e) {
      if (e.code === 'ENOENT') {
        // A path git still LISTS but the worktree no longer has. Throwing here made a DIRTY
        // starting tree unsnapshottable, and dirty starting trees are explicitly supported (see
        // 2-tech-spec.md): `git ls-files` reports the INDEX, so a tracked file deleted in the
        // worktree — or absent under a sparse checkout — is listed and then fails to lstat.
        // `absent` is a real serializable STATE, not an error: it is not a valid octal mode string
        // so it cannot collide with one, and it drifts in BOTH directions (restoring the file
        // moves `absent` -> a mode, deleting one moves a mode -> `absent`), so nothing is masked.
        // Only ENOENT takes this path; every other inspection failure (EACCES, ELOOP, ...) still
        // throws, because "I could not look" is not the same answer as "it is not there".
        entries.push(`${p}\u0000absent`);
        continue;
      }
      // A tracked path that has VANISHED mid-enumeration is already drift on the porcelain plane;
      // reporting it as an unresolvable node here is the same fail-closed answer, one step earlier.
      throw new Error(`unresolvable tracked node (TOCTOU vanish or non-UTF-8 name): ${p} (${e.message})`);
    }
    entries.push(`${p}\u0000${(st.mode & 0o7777).toString(8)}`);
  }
  // Same NUL separator and injectivity argument as hashIgnoredDirNodes below. Directory entries
  // keep their trailing slash, so a tracked file `a` and a tracked directory `a/` cannot collide.
  return entries.join('\n');
}

function hashIgnoredDirNodes(repo, dirPaths) {
  const entries = [];
  for (const p of dirPaths) {
    let st;
    try {
      st = fs.lstatSync(path.join(repo, p));
    } catch (e) {
      throw new Error(`unresolvable ignored dir node (TOCTOU vanish or non-UTF-8 name): ${p} (${e.message})`);
    }
    entries.push(`${p}\u0000${(st.mode & 0o7777).toString(8)}`);
  }
  // Each entry above is `path<NUL>mode` — the separator is a literal NUL byte (0x00), which `cat`
  // and most viewers render as a BLANK, so on a skim it can look like a space (`path mode`). That
  // distinction is load-bearing: the '\n'-join below is collision-safe WITHOUT length-prefix framing
  // *because* of the NUL. A path component may contain '/' and '\n' but NEVER a NUL (only '/' and NUL
  // are forbidden), and a mode is pure octal ([0-7]+, no NUL, no '\n'), so every entry holds EXACTLY
  // one NUL → NUL-count == entry-count. Hence a k-dir state can never alias a j-dir state (j≠k ⇒
  // different NUL count), and within a fixed count the parse `path` (read to its NUL) → octal `mode`
  // → '\n' is unambiguous → the map entries[] → join('\n') is injective. So a dir NAME containing a
  // newline (e.g. `a/ 700\nb`) does NOT alias the two-dir {`a/`,`b/`} state: that collision needs a
  // SPACE separator; the NUL forbids a name from faking an entry boundary. (hashDirRecursive /
  // hashPathsContent reach the same guarantee via frameParts length-prefixing; here the NUL already
  // provides it, so a plain join suffices.)
  return entries.join('\n');
}

function snapshot(repo) {
  try {
    const head = git(repo, ['rev-parse', 'HEAD']);
    const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const porcelain = git(repo, ['status', '--porcelain', '-uall']);
    // Porcelain hashes status+path only — a file that is already dirty in the
    // baseline keeps the same porcelain line when its *content* changes again.
    // --binary keeps the diff content-sensitive for binary files too.
    const trackedDiff = git(repo, ['diff', 'HEAD', '--binary', '--no-ext-diff', '--no-textconv']);
    // Tracked MODES — see hashTrackedModes. `ls-files -z` is the tracked file set exactly as git
    // sees it, so the ancestor directories derived from it are the tracked tree's own directories.
    const trackedPaths = gitEnumerate(repo, ['ls-files', '-z'])
      .split('\0')
      .filter(Boolean)
      .sort();
    const trackedModes = hashTrackedModes(repo, trackedPaths);
    // Untracked content: ls-files -z gives unquoted NUL-separated paths and
    // --exclude-standard skips gitignored files (e.g. .claude_workflows/ —
    // legitimate orchestrator run-state writes must not trip the verifier).
    // isControlPlaneIgnored ALSO runs here (not only on the ignored side below):
    // the hook's own safety-plane siblings (.claude_review_state.json.blocked /
    // .lockdir / .XXXXXX mktemp temps) are written DURING the snapshot→compare
    // window and are NOT reliably gitignored in every consumer repo (a bare
    // `.claude_review_state.json` .gitignore line does not cover the `.blocked`
    // sibling). Left unfiltered they read as untracked churn → spurious drift on
    // an otherwise clean tree. Filtering them here mirrors the ignored-side policy
    // (control/safety-plane mutation is a documented v2 residual), so the same
    // class of path is treated identically regardless of the repo's ignore config.
    // SCOPE: this filter only removes them from untracked_content_sha256. When the
    // target repo has NOT adopted the shipped `.claude_review_state.json*` .gitignore
    // glob, these same siblings still surface in the UNFILTERED porcelain_sha256
    // (`git status --porcelain -uall`), so a transient sibling can still trip a
    // (fail-closed, safe) porcelain drift; full suppression needs the glob in place.
    const untrackedPaths = gitEnumerate(repo, ['ls-files', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean)
      .filter((p) => !isControlPlaneIgnored(p))
      .sort();
    // hashPathsContent (not raw hashObjects) so a symlink among the untracked set is
    // hashed by its target, never followed into a hash-object crash — same reason as
    // the ignored side below.
    const untrackedContent = hashPathsContent(repo, untrackedPaths);
    // Untracked DIRECTORY NODES — the non-ignored mirror of ignored_dirs below, and the same hole:
    // `git status --porcelain -uall` never lists directories, and the file-level enumeration above
    // only yields leaves, so an EMPTY untracked directory could be created, deleted, or chmod'd
    // post-snapshot with no plane recording it. `mkdir -p keepme/sub`, `rm -rf keepme` and
    // `chmod 777 newdir` all returned {"ok": true} before this existed. `--directory` collapses
    // each untracked dir to one `dir/` node (empty ones included). Keep ONLY trailing-slash
    // entries — untracked FILES are already covered by untracked_content — and apply the same
    // control-plane filter on the slash-stripped path so the hook's own siblings are excluded here
    // exactly as they are there.
    const untrackedDirRoots = gitEnumerate(repo, [
      'ls-files', '--others', '--exclude-standard', '--directory', '-z',
    ])
      .split('\0')
      .filter(Boolean)
      .filter((p) => p.endsWith('/'))
      .filter((p) => {
        const bare = p.replace(/\/+$/, '');
        return !isControlPlaneIgnored(bare) && !isVolumeExcludedDir(bare) && !isNodeModulesDirNode(bare);
      })
      .sort();
    // `--directory` handed back only the ROOT of each untracked tree, which is where the plane used
    // to go blind (a nested empty dir under an already-untracked ancestor moved no digest at all).
    // Expand to every directory beneath those roots before digesting. See expandUntrackedDirTree.
    const untrackedDirPaths = expandUntrackedDirTree(repo, untrackedDirRoots);
    const untrackedDirs = hashIgnoredDirNodes(repo, untrackedDirPaths);
    // Ignored content: `-o -i --exclude-standard` lists individual ignored FILES
    // (recurses into ignored dirs; no trailing-slash dir entries). High-volume
    // dependency/cache subtrees are dropped at the GIT level via IGNORE_EXCLUDE_PATHSPECS
    // (prevents ENOBUFS on repos with a big node_modules); the residual small file-level
    // planes are dropped by the JS isControlPlaneIgnored filter. hashPathsContent then
    // classifies each remaining entry — critically, the gitignored plugin symlinks
    // (.claude/agents -> ../agents, etc.) are hashed by target instead of being fed to
    // hash-object, which dies on a symlink-to-directory and would fail the whole snapshot.
    const ignoredPaths = gitEnumerate(repo, [
      'ls-files', '--others', '--ignored', '--exclude-standard', '-z',
      '--', '.', ...IGNORE_EXCLUDE_PATHSPECS,
    ])
      .split('\0')
      .filter(Boolean)
      .filter((p) => !isControlPlaneIgnored(p))
      .sort();
    const ignoredContent = hashPathsContent(repo, ignoredPaths);
    // Ignored DIRECTORY NODES (existence + mode) — closes the empty-ignored-dir hole (Codex iter-14
    // P2; see hashIgnoredDirNodes). `--directory` collapses each ignored dir to a single `dir/` node
    // (empty ones included), so create/delete/chmod of an otherwise-invisible empty ignored dir
    // drifts. Same pathspec exclusions as the file-level enumeration keep node_modules/ & friends out
    // (bounded node count). Keep ONLY trailing-slash dir entries (top-level ignored FILES are already
    // covered by ignored_content); apply isControlPlaneIgnored on the slash-stripped path so a
    // control-plane dir node (e.g. `.claude/cache/`) is excluded exactly as its file entries are.
    const ignoredDirPaths = gitEnumerate(repo, [
      'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z',
      '--', '.', ...IGNORE_EXCLUDE_PATHSPECS,
    ])
      .split('\0')
      .filter(Boolean)
      .filter((p) => p.endsWith('/'))
      .filter((p) => {
        // Strip the trailing slash once, then drop control-plane dir nodes AND the high-volume
        // build/dependency roots (dist/, build/, .venv/, …) that `--directory` leaks past their
        // `:(exclude)` pathspec — otherwise churn in a gitignored build tree spuriously drifts.
        const bare = p.replace(/\/+$/, '');
        return !isControlPlaneIgnored(bare) && !isVolumeExcludedDir(bare) && !isNodeModulesDirNode(bare);
      })
      .sort();
    const ignoredDirs = hashIgnoredDirNodes(repo, ignoredDirPaths);
    const refs = git(repo, ['for-each-ref', '--format=%(refname)%(objectname)']);
    // `git config --list --local` exits 0 for a normal OR empty local config, so
    // there is no "empty → swallow" case to special-case. Dropping the former
    // inner `catch { '' }` is defensive hardening: a config-specific failure now
    // propagates to snapshot()'s outer catch → fail-closed, consistent with every
    // other git call here. (In practice a corrupt repo already fails earlier at
    // `rev-parse HEAD`, so this closes a latent inconsistency, not a live hole.)
    // `-z` + framing, NOT the newline-delimited `--list`. A config VALUE may contain a newline,
    // and the plain listing renders each entry as `key=value\n` with no escaping, so a value can
    // impersonate an entry boundary. Reproduced end-to-end: from a baseline carrying
    // `commit.gpgsign=true`, a worker running
    //     git config --local --unset commit.gpgsign
    //     git config --local user.email "$(printf 't@t\ncommit.gpgsign=true')"
    // yields BYTE-IDENTICAL `--list --local` output while signing is actually OFF — compare
    // returned {"ok": true} against the real baseline digest. The same recipe hides an unset of
    // `core.hooksPath`. Strictly inside the declared adversary window (workers run after
    // snapshot()), and these are precisely the settings git EXECUTES.
    //
    // `-z` terminates each record with NUL — a byte no config key or value can contain — so
    // records split unambiguously; frameParts then length-prefixes them so an embedded NEWLINE
    // inside a value cannot alias a boundary either. The `!== ''` filter drops the empty tail the
    // trailing NUL produces (and makes an empty local config hash as the empty string, unchanged).
    const localConfig = frameParts(
      git(repo, ['config', '--list', '--local', '-z']).split('\0').filter((r) => r !== '')
    );
    const worktrees = git(repo, ['worktree', 'list', '--porcelain'])
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.replace('worktree ', ''));
    const stashRaw = git(repo, ['stash', 'list']);
    const stashCount = stashRaw === '' ? 0 : stashRaw.split('\n').length;
    return {
      schema_version: 4,
      head,
      branch,
      porcelain_sha256: sha256(porcelain),
      tracked_diff_sha256: sha256(trackedDiff),
      tracked_modes_sha256: sha256(trackedModes),
      untracked_content_sha256: sha256(untrackedContent),
      untracked_dirs_sha256: sha256(untrackedDirs),
      ignored_content_sha256: sha256(ignoredContent),
      ignored_dirs_sha256: sha256(ignoredDirs),
      refs_sha256: sha256(refs),
      local_config_sha256: sha256(localConfig),
      git_internals_sha256: gitInternalsDigest(repo),
      worktrees,
      stash_count: stashCount,
    };
  } catch (e) {
    fail(`git snapshot unavailable: ${e.message}`);
    return null;
  }
}

// Fields that carry no drift signal and so are excluded from the comparison. Everything else
// snapshot() emits is compared — DERIVED from the live snapshot, never hand-listed.
//
// The list used to be enumerated by hand, which made it silently drift-prone in the one direction
// that matters: adding a field to snapshot() without also adding it here left the new signal
// UNCOMPARED, and the whole suite stayed green because no test knows the list is supposed to be
// exhaustive. Verified by mutation — an extra snapshot field drifted freely and compare() still
// reported `ok: true`. The sets happened to match, so this was latent rather than live; deriving
// them removes the class.
//
// `schema_version` is excluded because it describes the record, not the repository. It is instead
// checked for equality by the caller, where a mismatch is a hard refusal rather than drift.
const COMPARE_EXCLUDED_FIELDS = new Set(['schema_version']);

function compareFields(current) {
  return Object.keys(current).filter((k) => !COMPARE_EXCLUDED_FIELDS.has(k));
}

function compare(baseline, current) {
  const drift = [];
  for (const field of compareFields(current)) {
    if (!(field in baseline)) {
      // A baseline missing a check field cannot prove "no drift" for it.
      drift.push({ field, baseline: null, current: current[field], reason: 'field missing from baseline' });
      continue;
    }
    const a = JSON.stringify(baseline[field]);
    const b = JSON.stringify(current[field]);
    if (a !== b) drift.push({ field, baseline: baseline[field], current: current[field] });
  }
  return drift;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) fail(`flag ${a} requires a value`);
      return argv[i];
    };
    if (a === '--repo') args.repo = next();
    else if (a === '--baseline') args.baseline = next();
    else if (a === '--baseline-sha256') args.baselineSha256 = next();
    else if (a.startsWith('--')) fail(`unknown flag: ${a}`);
    else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const repo = path.resolve(args.repo || process.cwd());

  if (command === 'snapshot') {
    // The digest binds these exact bytes. It goes to STDERR so it stays out of the baseline
    // itself — a self-referential field could not be hashed, and any extra stdout byte would
    // change what `compare` recomputes.
    const body = `${JSON.stringify(snapshot(repo), null, 2)}\n`;
    process.stdout.write(body);
    process.stderr.write(`[run-verify] baseline_sha256=${sha256(body)}\n`);
    return;
  }
  if (command === 'compare') {
    if (!args.baseline) fail('compare requires --baseline <path|->');
    // Without this binding, `compare` proves only "the file I was handed matches the repo" —
    // which is trivially satisfiable by re-snapshotting AFTER a mutation and passing that as the
    // baseline. Drift then reads as `ok: true`, defeating the whole SC-2 no-change proof.
    //
    // What the binding is and is not. It pins the baseline to the one `snapshot` emitted before
    // any agent was dispatched, because the digest travels a channel the fanout workers never
    // touch: `snapshot` prints it to the main session's stderr pre-dispatch, and the main session
    // is what passes it back here. A worker can write any file it likes and still cannot produce
    // a matching digest. It does NOT defend against a compromised main session — nothing at this
    // layer can, since that session chooses both arguments. Same trust chain as
    // `plan-context.js --context-sha256`; stated plainly rather than overclaimed.
    if (!args.baselineSha256) {
      fail('compare requires --baseline-sha256 <hex> (the digest snapshot printed to stderr) — an unbound baseline cannot prove no-drift');
    }
    if (!/^[0-9a-f]{64}$/.test(args.baselineSha256)) {
      fail(`--baseline-sha256 must be 64 lowercase hex chars (got ${JSON.stringify(args.baselineSha256)})`);
    }
    let raw;
    try {
      raw = args.baseline === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(args.baseline, 'utf8');
    } catch (e) {
      fail(`baseline unreadable: ${e.message}`);
    }
    // Digest the raw bytes BEFORE parsing: a substituted baseline must be rejected on identity,
    // not merely on shape. Two JSON documents that differ only in whitespace are different
    // baselines here by design — the check is byte-exact against what `snapshot` wrote.
    const actualDigest = sha256(raw);
    if (actualDigest !== args.baselineSha256) {
      fail(
        `baseline digest mismatch — expected ${args.baselineSha256}, got ${actualDigest}. ` +
          'The baseline handed to compare is not the one snapshot emitted before dispatch; ' +
          'treat this run as failed and do not write a report.'
      );
    }
    let baseline;
    try {
      baseline = JSON.parse(raw);
    } catch (e) {
      fail(`baseline is not valid JSON: ${e.message}`);
    }
    // A valid-JSON but non-object baseline (null / array / string / number) cannot be
    // compared field-by-field: `field in baseline` in compare() would throw an uncaught
    // TypeError (a crash with a stack trace, not the controlled `[run-verify] FAIL-CLOSED`
    // fail path), leaving consumers unable to reliably transition the run to failed. Reject
    // it the same way as invalid JSON — fail-closed with a clear message.
    if (baseline === null || typeof baseline !== 'object' || Array.isArray(baseline)) {
      fail('baseline is not a JSON object (expected the object emitted by `snapshot`)');
    }
    const current = snapshot(repo);
    // Schema equality is a hard refusal, not drift. `compare()` derives its field list from the
    // CURRENT snapshot, so a baseline written by a different schema version could carry a field
    // the current one no longer emits — silently uncompared. Refusing outright is the only honest
    // answer: two records of different shapes cannot establish "nothing changed" between them.
    if (baseline.schema_version !== current.schema_version) {
      fail(
        `baseline schema_version ${JSON.stringify(baseline.schema_version)} does not match this ` +
          `run-verify's ${JSON.stringify(current.schema_version)} — a cross-schema comparison cannot ` +
          'prove no-drift. An orchestrate run holding this baseline must be ABANDONED and restarted ' +
          'with a new approval; do NOT re-snapshot into the running job. Replacing a baseline ' +
          'mid-run washes every post-baseline change into the new one, which is exactly the ' +
          'substitution the digest binding exists to prevent (see skills/orchestrate/SKILL.md). ' +
          'Taking a fresh snapshot is correct only for a NEWLY started run.'
      );
    }
    const drift = compare(baseline, current);
    if (drift.length) {
      process.stdout.write(`${JSON.stringify({ ok: false, drift }, null, 2)}\n`);
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
    return;
  }
  fail(`unknown command "${command}" (expected snapshot|compare)`);
}

// Run the CLI only when invoked directly (node run-verify.js …). When required by a test the
// exports below are available WITHOUT running main() — lets a unit test drive the object-identity
// helper deterministically (feed it a symlink path and assert it fails closed rather than follows).
if (require.main === module) main();

module.exports = {
  hashRegularNodeNoFollow,
  sha256File,
  // The two node_modules exclusions are exported so each can be tested on the plane it acts on.
  // `isControlPlaneIgnored` is a BACKSTOP for the node_modules class: the git pathspec suppresses
  // those paths before this filter ever sees them, so end-to-end drift tests cannot distinguish
  // it — removing it leaves every behavioural assertion green. That is precisely what a backstop
  // looks like, and why it needs a unit-level pin instead of being read as dead code and deleted.
  isControlPlaneIgnored,
  isNodeModulesDirNode,
  // Exported for a unit-level pin on the symlink and exclusion behaviour of the walk, which an
  // end-to-end drift test cannot reach: planting a symlink-to-directory inside an untracked tree
  // produces the same digest whether the walk skipped it or followed it into an empty target.
  expandUntrackedDirTree,
};
