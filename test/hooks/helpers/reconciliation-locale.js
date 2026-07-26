'use strict';
// Shared harness for the iter-20 P1 "LC_ALL=C directory-omission reconciliation" regression tests.
//
// The three advisory-sibling hooks — post-compact-auto-loop, post-skill-auto-loop, and
// user-prompt-review-guard — carry byte-identical stale-state reconciliation: bound
// `git status --porcelain -uall` with a timeout helper, FORCE LC_ALL=C, and treat a
// directory-omission warning (or mktemp failure) as UNAVAILABLE so an unreadable subtree cannot
// silently downgrade a pending review flag (fail-closed). This module factors out that setup so
// each hook's test asserts the behavior without a ~40-line copy. (A test helper needs no test of
// its own — it is exercised by its consumers; if it breaks, their locale tests fail.)
//
// Coverage strategy — HOST-INDEPENDENT by construction (strict iter-20 Nit): a real-git + real-zh_TW
// test only exercises the localized-warning path on hosts that actually ship zh_TW.UTF-8; on a
// C-only CI runner git emits English regardless, so the LC_ALL=C fix is never truly tested and a
// reverted fix would still pass (false confidence). Instead the sibling tests drive the hook with a
// LOCALE-AWARE STUB git that emits its directory-omission warning in English iff LC_ALL is C/POSIX
// and in a non-ASCII form otherwise — a faithful model of git's real contract that needs no
// installed locale. Setting the ambient LC_ALL to a NON-C string then proves the fix: the hook must
// override it with LC_ALL=C to get the English warning its regex matches. `SKIP_NO_ZH_TW` lets the
// complementary REAL-git tests (stop-guard/session-init, which validate git's actual wording) skip
// HONESTLY on C-only hosts instead of passing vacuously.
const { existsSync, writeFileSync, chmodSync, symlinkSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

// Root can open 0o000 dirs, so real git emits no directory-omission warning → the real-git omission
// scenario is unreproducible as root. (The stub-git sibling tests are root-agnostic and omit this.)
const SKIP_AS_ROOT =
  typeof process.getuid === 'function' && process.getuid() === 0
    ? 'root can open 0o000 dirs, so git emits no directory-omission warning'
    : false;

// Honest skip for REAL-git localized-warning tests: without zh_TW.UTF-8 installed, ambient zh-TW has
// no effect on git's output, so the localized path is not exercised and the test would pass whether
// or not the fix is present. Skipping (vs. running vacuously) keeps the green signal truthful.
function zhTwInstalled() {
  const r = spawnSync('sh', ['-c', 'locale -a 2>/dev/null'], { encoding: 'utf8' });
  return /(^|\n)zh_TW\.utf-?8(\n|$)/i.test(r.stdout || '');
}
const SKIP_NO_ZH_TW = zhTwInstalled()
  ? false
  : 'host lacks zh_TW.UTF-8 — real-git localized-warning path is unreproducible here; the stub-git sibling tests provide host-independent coverage';

// Ambient locale set to a NON-C string (need NOT be installed — the stub git only string-compares
// LC_ALL). A hook that forgot to force LC_ALL=C would let the stub emit its localized warning, whose
// text the English-only regex misses → the empty (dir-omitted) listing downgrades the flag.
const AMBIENT_NON_C_ENV = { LC_ALL: 'zh_TW.UTF-8', LANG: 'zh_TW.UTF-8', LANGUAGE: 'zh_TW:zh' };

// Real coreutils the reconciliation shells out to — EXCEPT git (stubbed below). git/jq/grep/mktemp
// /mv/rm are load-bearing; bash backs the hook interpreter under a PATH pinned to the bin dir.
// `mv` matters because session-init.sh reaches its sidecar decision only AFTER the atomic
// mktemp+mv state rewrite — under `set -e` a missing `mv` aborts the hook at exit 127 and the
// reconciliation under test never runs.
const REAL_TOOLS = [
  'jq', 'grep', 'sed', 'cat', 'head', 'tail',
  'basename', 'dirname', 'mktemp', 'mv', 'rm', 'date', 'bash', 'sh', 'env', 'node',
];

// Locale-aware stub git: for any `status` invocation emit EMPTY stdout (the omitted subtree) plus a
// directory-omission warning to stderr — English iff LC_ALL is C/POSIX (what the hook forces), a
// non-ASCII localized form otherwise (what an un-normalized ambient locale yields) — and exit 0,
// git's real warn+omit contract. All other subcommands are no-ops (the hook calls only `status`).
// The literal CJK bytes below are written as UTF-8 and passed straight through by POSIX `printf`;
// they only need to NOT match `(could not|cannot|unable to) open directory`.
const STUB_GIT = [
  '#!/bin/sh',
  'case " $* " in',
  '  *" status "*)',
  '    if [ "$LC_ALL" = C ] || [ "$LC_ALL" = POSIX ]; then',
  "      printf \"warning: could not open directory 'locked/': Permission denied\\n\" >&2",
  '    else',
  "      printf '警告：無法開啟目錄「locked/」：Permission denied\\n' >&2",
  '    fi',
  '    ;;',
  'esac',
  'exit 0',
  '',
].join('\n');

// Populate binDir with real coreutils + a passthrough `timeout` shim (stock macOS ships neither
// timeout nor gtimeout, and reconciliation only runs under a timeout helper) + the locale-aware stub
// git. Returns true, or false if a real tool is unresolvable on this host (→ caller graceful-skips).
// `extraTools` carries per-hook needs (e.g. session-init.sh's perl-based baseline capture) instead of
// widening REAL_TOOLS — one hook's extra dependency must not make the OTHER hooks' tests skip.
function setupLocaleAwareGitBin(binDir, extraTools = []) {
  const script = [...REAL_TOOLS, ...extraTools].map((n) => `command -v ${n} || echo __MISSING__`).join('; ');
  const resolved = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  const lines = (resolved.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.includes('__MISSING__')) return false;
  for (const realPath of lines) {
    if (!existsSync(realPath)) return false;
    const name = realPath.slice(realPath.lastIndexOf('/') + 1);
    try {
      symlinkSync(realPath, join(binDir, name));
    } catch {
      /* already linked — a tool resolving to a name already placed is fine */
    }
  }
  writeFileSync(join(binDir, 'timeout'), '#!/bin/sh\nshift; exec "$@"\n');
  chmodSync(join(binDir, 'timeout'), 0o755);
  writeFileSync(join(binDir, 'git'), STUB_GIT);
  chmodSync(join(binDir, 'git'), 0o755);
  return true;
}

// Write the pending-review state the reconciliation would try to downgrade: a code change is pending
// and unreviewed. No real repo is needed — the stub git answers `status` unconditionally.
function writePendingState(workDir) {
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
}

module.exports = {
  SKIP_AS_ROOT,
  SKIP_NO_ZH_TW,
  AMBIENT_NON_C_ENV,
  setupLocaleAwareGitBin,
  writePendingState,
};
