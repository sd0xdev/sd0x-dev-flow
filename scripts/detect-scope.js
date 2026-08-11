#!/usr/bin/env node
'use strict';

/**
 * detect-scope.js — 3-layer scope detection for post-dev-recap.
 *
 * Output: ScopeReport JSON to stdout (see tech-spec §3.2.1).
 *
 * Exit codes:
 *   0 — success, scope detected
 *   1 — all 3 layers empty (need human input)
 *   2 — not a git repository
 *   3 — timeout exceeded (NFR-1 5s budget)
 *   4 — path-safety violation (NFR-8)
 *   5 — unexpected error (git command failure, etc.)
 *
 * Layers (first non-empty wins):
 *   1. uncommitted — git diff HEAD + git status --porcelain (confidence: high)
 *   2. branch      — git diff <merge-base>..HEAD (confidence: medium)
 *   3. session     — .claude_review_state.json changed_files_since_review (confidence: low, best-effort)
 *
 * Tech spec: docs/features/post-dev-recap/2-tech-spec.md §3.4.1
 */

const fs = require('fs');
const path = require('path');

const { runCapture, gitRepoRoot } = require('./lib/utils');
const { isContextShape } = require('./lib/context-shape');
const { SLUG_RE } = require('./lib/feature-resolver');

const SCHEMA_VERSION = 1;
const TIMEOUT_MS = 5_000;

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * Validate a path is inside repo root. Rejects `..` traversal and external symlinks.
 * Returns true if safe, false otherwise. Does not throw (callers decide severity).
 */
function isPathSafe(p, repoRoot) {
  if (!p || typeof p !== 'string') return false;
  if (p.includes('\0')) return false;
  // reject raw `..` segments in relative paths
  if (p.split(/[/\\]/).includes('..')) return false;
  const resolved = path.resolve(repoRoot, p);
  const rootWithSep = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
  if (resolved !== repoRoot && !resolved.startsWith(rootWithSep)) return false;
  try {
    const real = fs.realpathSync(resolved);
    return real === repoRoot || real.startsWith(rootWithSep);
  } catch {
    // Leaf may not exist (git reports deleted paths). Walk up to first existing
    // ancestor and realpath-check that — catches cases where a parent symlink
    // escapes the repo even though the leaf is missing.
    let ancestor = path.dirname(resolved);
    while (ancestor !== path.dirname(ancestor)) {
      try {
        const real = fs.realpathSync(ancestor);
        return real === repoRoot || real.startsWith(rootWithSep);
      } catch {
        ancestor = path.dirname(ancestor);
      }
    }
    // No existing ancestor reached — accept (path lives under resolved root)
    return true;
  }
}

async function layerUncommitted(root) {
  // `-uall` expands untracked directories into individual files (fixes P1-3)
  const [diff, status] = await Promise.all([
    runCapture('git', ['diff', '--name-status', 'HEAD'], { cwd: root }),
    runCapture('git', ['status', '--porcelain', '-uall'], { cwd: root }),
  ]);

  if (diff.code !== 0 && diff.code !== 1) {
    throw new Error(`git diff failed (code ${diff.code}): ${diff.stderr.trim()}`);
  }
  if (status.code !== 0) {
    throw new Error(`git status failed (code ${status.code}): ${status.stderr.trim()}`);
  }

  const files = new Map();

  for (const line of (diff.stdout || '').split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const statusCode = parts[0] || '';
    const filePath = parts[parts.length - 1];
    if (!filePath) continue;
    files.set(filePath, mapGitStatus(statusCode));
  }

  for (const line of (status.stdout || '').split('\n').filter(Boolean)) {
    const code = line.slice(0, 2).trim();
    const filePath = line.slice(3).trim().split(' -> ').pop();
    if (!filePath) continue;
    // Skip directory entries (should not occur with -uall but guard anyway)
    if (filePath.endsWith('/')) continue;
    if (!files.has(filePath)) {
      files.set(filePath, mapGitStatus(code));
    }
  }

  if (files.size === 0) return null;
  return { source: 'uncommitted', confidence: 'high', files, baseRef: 'HEAD' };
}

async function layerBranch(root) {
  // Determine base ref. Prefer origin/main; fallback to HEAD~1.
  let base = 'origin/main';
  const baseCheck = await runCapture('git', ['rev-parse', '--verify', base], { cwd: root });
  if (baseCheck.code !== 0) {
    base = 'HEAD~1';
  }
  const mergeBase = await runCapture('git', ['merge-base', 'HEAD', base], { cwd: root });
  // Missing merge-base (e.g. single-commit repo) → no branch-level diff available.
  if (mergeBase.code !== 0 || !mergeBase.stdout.trim()) {
    return null;
  }
  const baseRef = mergeBase.stdout.trim();

  const diff = await runCapture(
    'git',
    ['diff', '--name-status', `${baseRef}..HEAD`],
    { cwd: root },
  );
  // Exit 1 is legal (diff has content). Anything else is a git failure.
  if (diff.code !== 0 && diff.code !== 1) {
    throw new Error(`git diff ${baseRef}..HEAD failed (code ${diff.code}): ${diff.stderr.trim()}`);
  }
  const lines = (diff.stdout || '').split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  const files = new Map();
  for (const line of lines) {
    const parts = line.split('\t');
    const statusCode = parts[0] || '';
    const filePath = parts[parts.length - 1];
    if (!filePath) continue;
    files.set(filePath, mapGitStatus(statusCode));
  }
  return { source: 'branch', confidence: 'medium', files, baseRef };
}

/**
 * Repo-relative form of `abs`, or null when it does not live under `root`.
 *
 * The escape test is `..` exactly or `../` — NOT the `..` prefix: a real directory named
 * `..cache/` is inside the repo and starts with two dots, and rejecting it silently drops
 * legitimate edits from the session fallback.
 */
function insideRoot(root, abs) {
  const rel = path.relative(root, abs);
  const escapes = rel === '..' || rel.startsWith(`..${path.sep}`);
  return !rel || escapes || path.isAbsolute(rel) ? null : rel;
}

/**
 * Resolve symlinks in the deepest EXISTING ancestor of `p`, keeping the missing
 * remainder. `git rev-parse --show-toplevel` returns a resolved root, while the
 * hooks record whatever spelling the edit tool reported — on macOS that is
 * `/var/...` against a `/private/var/...` root, so a plain prefix compare drops
 * in-repo files. The leaf often does not exist (deleted, or never created).
 */
function realpathBestEffort(p) {
  const tail = [];
  let head = p;
  for (;;) {
    try {
      const real = fs.realpathSync(head);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return p;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

function layerSession(root) {
  const statePath = path.join(root, '.claude_review_state.json');
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const state = JSON.parse(raw);
    // `changed_files_since_review` is what the hooks actually write (absolute
    // paths, cleared on a passing code review). `recent_file_edits` has never
    // had a writer in this repo, so reading only it made this layer return null
    // every time — a silent no-op, not a fallback. Both are accepted, live one
    // first, so a state file from either shape still resolves.
    const edits = Array.isArray(state.changed_files_since_review) && state.changed_files_since_review.length > 0
      ? state.changed_files_since_review
      : state.recent_file_edits;
    if (!Array.isArray(edits) || edits.length === 0) return null;
    const files = new Map();
    for (const entry of edits) {
      let p = null;
      let changeType = 'modified';
      if (typeof entry === 'string') {
        p = entry;
      } else if (entry && typeof entry.path === 'string') {
        p = entry.path;
        changeType = entry.change_type || 'modified';
      }
      if (!p) continue;
      // Absolute entries outside the repo are dropped, NOT escalated: the edit
      // log is session-wide and legitimately records scratch files under other
      // job directories, which are simply not this repo's scope. A RELATIVE
      // entry is passed through untouched so a forged `../` still reaches the
      // path-safety gate and fails the run — dropping those would launder an
      // escape attempt into a quiet omission.
      if (path.isAbsolute(p)) {
        const rel = insideRoot(root, p) ?? insideRoot(root, realpathBestEffort(p));
        if (rel === null) continue;
        p = rel;
      }
      files.set(p, changeType);
    }
    if (files.size === 0) return null;
    return { source: 'session', confidence: 'low', files, baseRef: 'session' };
  } catch {
    return null;
  }
}

function mapGitStatus(code) {
  if (!code) return 'modified';
  const c = code[0];
  switch (c) {
    case 'A': return 'added';
    case '?': return 'added'; // untracked → added (porcelain "??")
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'M':
    case 'U':
    default: return 'modified';
  }
}

async function lineStats(root, filePath, baseRef) {
  if (baseRef === 'session') return { added: 0, deleted: 0, total: 0 };
  const args = baseRef === 'HEAD'
    ? ['diff', '--numstat', 'HEAD', '--', filePath]
    : ['diff', '--numstat', `${baseRef}..HEAD`, '--', filePath];
  const r = await runCapture('git', args, { cwd: root });
  const line = (r.stdout || '').split('\n').find(Boolean);
  if (!line) {
    // Untracked files don't appear in `git diff HEAD`. Fall back to fs line count
    // so top-N ranking by lines_changed.total remains meaningful. Guard against
    // OOM from large binaries/logs: skip the fallback if file > 1 MiB.
    try {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 1024 * 1024) {
        return { added: 0, deleted: 0, total: 0 };
      }
      const content = fs.readFileSync(abs, 'utf8');
      const added = content.length === 0 ? 0 : content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
      return { added, deleted: 0, total: added };
    } catch {
      return { added: 0, deleted: 0, total: 0 };
    }
  }
  const [addedRaw, deletedRaw] = line.split('\t');
  const parseNum = v => (v === '-' || Number.isNaN(Number(v)) ? 0 : Number(v));
  const added = parseNum(addedRaw);
  const deleted = parseNum(deletedRaw);
  return { added, deleted, total: added + deleted };
}

/**
 * Are the fields this function projects consistent with the payload they were derived from?
 *
 * `isContextShape` checks types and presence and stops there, so a payload can be structurally
 * perfect and semantically impossible — `key: 'good'` with `docs_path: null`, or a key that
 * traverses beside a path correctly derived from it. This function projects exactly those fields,
 * so it is the one that has to notice. The relations are the resolver's own post-conditions, and
 * `SLUG_RE` is imported from it rather than restated: a second copy of a traversal guard drifting
 * from the first is the failure this whole function is about.
 *
 * Which payloads it refuses, what each one does downstream, and why scope is the projected subset:
 * docs/features/doc-review-phasing/4-implementation.md
 * § 1.6 "What the projection refuses".
 */
function projectionIsConsistent(p) {
  const canonical = p.canonical_docs;
  if ((p.key === null) !== (p.docs_path === null)) return false;
  if (p.key !== null && !SLUG_RE.test(p.key)) return false;
  if (p.key !== null && p.docs_path !== `docs/features/${p.key}`) return false;
  if (p.has_tech_spec !== (canonical.tech_spec != null)) return false;
  return p.has_requirements === (canonical.requirements != null);
}

/**
 * The `feature_context` projection when the corpus was not enumerated. A constructor rather than a
 * frozen literal because callers embed it in a report they then serialize, and one shared *shape*
 * is the point: the non-repository early return in `main()` used to write its own literal without
 * `scan_error`, so the one path that is unambiguously a failure to read anything projected the
 * field-absent payload that `!== false` consumers have to treat as unknown anyway — correct by
 * accident, and only until someone read it as "healthy". Every projection now comes from here.
 */
const UNKNOWN_FEATURE_CONTEXT = () => ({
  key: null, docs_path: null, has_tech_spec: false, has_requirements: false, scan_error: true,
});

/**
 * `feature_context` is a *projection* of the resolver payload, and `scan_error` is the one field a
 * projection may not drop.
 *
 * Every early return below used to emit a context indistinguishable from a healthy scan of a
 * repository with no feature — resolver missing, nonzero exit, empty stdout, unparseable JSON, all
 * of them "key: null, no tech spec". A ScopeReport consumer downstream then reads that as a fact
 * about the corpus rather than as a failure to read it, which is the same fail-open the source-set
 * gate exists to close, arriving one boundary later. `scan_error` therefore rides along on every
 * path, and it is `true` wherever the payload could not be obtained *or* did not carry the field
 * itself: a payload with no `scan_error` is an old CLI or a shell fallback, and treating its
 * silence as `false` is exactly the misreading `!== false` is spelled that way to prevent.
 *
 * The wrapper is preferred over the CLI for the reason the skills state: it owns the failure
 * payload. The CLI remains a fallback because a consuming repository may have installed only it,
 * and in that case this function is the one converting a failure into `scan_error: true`.
 */
async function resolveFeatureContext(root) {
  const unknown = UNKNOWN_FEATURE_CONTEXT();
  const wrapperPath = path.join(root, 'scripts', 'resolve-feature.js');
  const cliPath = path.join(root, 'scripts', 'resolve-feature-cli.js');
  const entrypoint = fs.existsSync(wrapperPath) ? wrapperPath : cliPath;
  if (!fs.existsSync(entrypoint)) return unknown;

  const r = await runCapture('node', [entrypoint], { cwd: root });
  if (r.code !== 0 || !r.stdout.trim()) return unknown;
  try {
    const parsed = JSON.parse(r.stdout);
    // Parseable is not trustworthy, and `scan_error: false` is a *claim* the payload makes about
    // itself. `{"scan_error":false}` parses, projects `false`, and says nothing about whether any
    // document was enumerated — so the claim is honoured only from a payload that is the whole
    // agreed shape, judged by the same `isContextShape` the wrapper uses on its child. One
    // validator, so "what detect-scope trusts" cannot drift from "what the wrapper emits".
    //
    // Shape is necessary and not sufficient, though, and the difference is this projection's to
    // enforce: `isContextShape` is deliberately relation-blind, so a full-shape payload may still
    // be internally impossible. Everything this function projects is checked against the payload it
    // was derived from as well — see `projectionIsConsistent`.
    if (!isContextShape(parsed) || !projectionIsConsistent(parsed)) return unknown;
    return {
      key: parsed.key || null,
      docs_path: parsed.docs_path || null,
      has_tech_spec: Boolean(parsed.has_tech_spec),
      has_requirements: Boolean(parsed.has_requirements),
      scan_error: parsed.scan_error !== false,
    };
  } catch {
    return unknown;
  }
}

function applyFocusFilter(files, focus) {
  if (!focus || typeof focus !== 'string' || !focus.trim()) return files;
  const keyword = focus.toLowerCase().trim();
  const tokens = keyword.split(/\s+/).filter(Boolean);
  return files.filter(f => {
    const haystack = `${f.path}`.toLowerCase();
    return tokens.some(t => haystack.includes(t));
  });
}

function validateFilePaths(files, repoRoot) {
  // Returns { safe, violations }
  const violations = [];
  const safe = [];
  for (const f of files) {
    if (isPathSafe(f.path, repoRoot)) {
      safe.push(f);
    } else {
      violations.push(f.path);
    }
  }
  return { safe, violations };
}

async function main() {
  const startedAt = Date.now();
  const focus = argVal('--focus') || process.argv.slice(2).find(a => !a.startsWith('--')) || null;

  const root = await gitRepoRoot();
  if (!root) {
    const report = {
      version: SCHEMA_VERSION,
      detected_at: nowISO(),
      source: null,
      confidence: null,
      base_ref: null,
      files: [],
      feature_context: UNKNOWN_FEATURE_CONTEXT(),
      focus_hint: focus,
      fallback_trace: [
        { layer: 'uncommitted', outcome: 'error', detail: 'not in a git repository' },
      ],
    };
    process.stdout.write(JSON.stringify(report, null, 2));
    process.stderr.write('detect-scope: not a git repository\n');
    process.exit(2);
  }

  // Hard timeout guard covers full execution (fix P1-1); cleared once we emit.
  const timeout = setTimeout(() => {
    process.stderr.write('detect-scope: timeout exceeded 5s\n');
    process.exit(3);
  }, TIMEOUT_MS);

  const fallbackTrace = [];
  let layerResult = null;
  let hardError = null;

  for (const [name, runner] of [
    ['uncommitted', () => layerUncommitted(root)],
    ['branch', () => layerBranch(root)],
    ['session', () => Promise.resolve(layerSession(root))],
  ]) {
    try {
      const res = await runner();
      if (res) {
        fallbackTrace.push({ layer: name, outcome: 'success', detail: `${res.files.size} file(s)` });
        layerResult = res;
        break;
      }
      fallbackTrace.push({ layer: name, outcome: 'empty', detail: 'no changes detected' });
    } catch (err) {
      fallbackTrace.push({ layer: name, outcome: 'error', detail: String(err.message || err) });
      // Git command failures on uncommitted/branch layers are unexpected — don't
      // silently degrade to "all empty". Record and short-circuit to exit 5.
      if (name !== 'session') {
        hardError = err;
        break;
      }
    }
  }

  const featureContext = await resolveFeatureContext(root);

  if (hardError) {
    clearTimeout(timeout);
    const report = {
      version: SCHEMA_VERSION,
      detected_at: nowISO(),
      source: null,
      confidence: null,
      base_ref: null,
      files: [],
      feature_context: featureContext,
      focus_hint: focus,
      fallback_trace: fallbackTrace,
    };
    process.stdout.write(JSON.stringify(report, null, 2));
    process.stderr.write(`detect-scope: unexpected error: ${hardError.message || hardError}\n`);
    process.exit(5);
  }

  if (!layerResult) {
    clearTimeout(timeout);
    const report = {
      version: SCHEMA_VERSION,
      detected_at: nowISO(),
      source: null,
      confidence: null,
      base_ref: null,
      files: [],
      feature_context: featureContext,
      focus_hint: focus,
      fallback_trace: fallbackTrace,
    };
    process.stdout.write(JSON.stringify(report, null, 2));
    process.stderr.write('detect-scope: all 3 layers empty — need human input (pass --focus <keyword> or run from a feature branch)\n');
    process.exit(1);
  }

  const rawFiles = Array.from(layerResult.files.entries()).map(([p, change_type]) => ({ path: p, change_type }));

  // Path safety gate (NFR-8)
  const { safe, violations } = validateFilePaths(rawFiles, root);
  if (violations.length > 0) {
    clearTimeout(timeout);
    const report = {
      version: SCHEMA_VERSION,
      detected_at: nowISO(),
      source: layerResult.source,
      confidence: layerResult.confidence,
      base_ref: layerResult.baseRef,
      files: [],
      feature_context: featureContext,
      focus_hint: focus,
      fallback_trace: fallbackTrace.concat([
        { layer: 'path-safety', outcome: 'error', detail: `rejected ${violations.length} unsafe path(s): ${violations.slice(0, 3).join(', ')}` },
      ]),
    };
    process.stdout.write(JSON.stringify(report, null, 2));
    process.stderr.write(`detect-scope: rejected unsafe paths: ${violations.join(', ')}\n`);
    process.exit(4);
  }

  // Parallel lineStats (P2-2 alignment with comment intent)
  const statsArr = await Promise.all(
    safe.map(f => lineStats(root, f.path, layerResult.baseRef)),
  );
  const withStats = safe.map((f, i) => ({
    path: f.path,
    change_type: f.change_type,
    lines_changed: statsArr[i],
  }));

  const filtered = applyFocusFilter(withStats, focus);
  clearTimeout(timeout);

  const report = {
    version: SCHEMA_VERSION,
    detected_at: nowISO(),
    source: layerResult.source,
    confidence: layerResult.confidence,
    base_ref: layerResult.baseRef,
    files: filtered,
    feature_context: featureContext,
    focus_hint: focus,
    fallback_trace: fallbackTrace,
  };

  process.stdout.write(JSON.stringify(report, null, 2));
  process.stdout.write('\n');
  const elapsed = Date.now() - startedAt;
  if (elapsed > TIMEOUT_MS) {
    process.stderr.write(`detect-scope: elapsed ${elapsed}ms exceeded 5s target\n`);
  }
  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`detect-scope: unexpected error: ${err.message || err}\n`);
  process.exit(5);
});
