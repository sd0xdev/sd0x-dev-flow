#!/usr/bin/env node
/**
 * run-verify.js — pre/post no-change verification for /orchestrate (SC-2 hard backstop).
 *
 * snapshot:  emit a baseline JSON of git-scoped state on stdout.
 * compare:   re-snapshot and diff against --baseline; exit 0 if identical
 *            ("no new drift" — a dirty baseline is supported; only *changes*
 *            relative to the baseline count), exit 1 with drift fields otherwise.
 *
 * Checks (each catches a bypass class porcelain alone misses):
 *   head                 — sneaky commit (worktree stays clean)
 *   branch               — git checkout -b
 *   porcelain_sha256     — file edits / new untracked (-uall, mirrors stop-guard lesson)
 *   tracked_diff_sha256  — content edits to already-dirty tracked files
 *                          (porcelain records status+path, not content)
 *   untracked_content_sha256 — content edits to pre-existing untracked files
 *                          (same porcelain blind spot, untracked side)
 *   refs_sha256          — tag/branch/ref creation or movement (for-each-ref)
 *   local_config_sha256  — local git config tampering (incl. core.hooksPath)
 *   worktrees            — sneaky worktree creation
 *   stash_count          — git stash hiding changes (stash ref also under refs hash)
 *
 * Any git failure → exit 1 (fail-closed; an unverifiable repo is a drift).
 *
 * Usage:
 *   node skills/orchestrate/scripts/run-verify.js snapshot [--repo <path>]
 *   node skills/orchestrate/scripts/run-verify.js compare --baseline <path|-> [--repo <path>]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('node:child_process');

function fail(msg) {
  process.stderr.write(`[run-verify] FAIL-CLOSED: ${msg}\n`);
  process.exit(1);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function git(repo, cliArgs) {
  return execFileSync('git', ['-C', repo, ...cliArgs], { encoding: 'utf8' }).trimEnd();
}

function snapshot(repo) {
  try {
    const head = git(repo, ['rev-parse', 'HEAD']);
    const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const porcelain = git(repo, ['status', '--porcelain', '-uall']);
    // Porcelain hashes status+path only — a file that is already dirty in the
    // baseline keeps the same porcelain line when its *content* changes again.
    // --binary keeps the diff content-sensitive for binary files too.
    const trackedDiff = git(repo, ['diff', 'HEAD', '--binary']);
    // Untracked content: ls-files -z gives unquoted NUL-separated paths and
    // --exclude-standard skips gitignored files (e.g. .claude_workflows/ —
    // legitimate orchestrator run-state writes must not trip the verifier).
    const untrackedPaths = git(repo, ['ls-files', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean)
      .sort();
    const untrackedHashes = untrackedPaths.length
      ? git(repo, ['hash-object', '--', ...untrackedPaths]).split('\n')
      : [];
    const untrackedContent = untrackedPaths.map((p, i) => `${p}\u0000${untrackedHashes[i]}`).join('\n');
    const refs = git(repo, ['for-each-ref', '--format=%(refname)%(objectname)']);
    let localConfig = '';
    try {
      localConfig = git(repo, ['config', '--list', '--local']);
    } catch {
      localConfig = ''; // a repo may legitimately have an empty local config
    }
    const worktrees = git(repo, ['worktree', 'list', '--porcelain'])
      .split('\n')
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.replace('worktree ', ''));
    const stashRaw = git(repo, ['stash', 'list']);
    const stashCount = stashRaw === '' ? 0 : stashRaw.split('\n').length;
    return {
      schema_version: 1,
      head,
      branch,
      porcelain_sha256: sha256(porcelain),
      tracked_diff_sha256: sha256(trackedDiff),
      untracked_content_sha256: sha256(untrackedContent),
      refs_sha256: sha256(refs),
      local_config_sha256: sha256(localConfig),
      worktrees,
      stash_count: stashCount,
    };
  } catch (e) {
    fail(`git snapshot unavailable: ${e.message}`);
    return null;
  }
}

const COMPARE_FIELDS = [
  'head',
  'branch',
  'porcelain_sha256',
  'tracked_diff_sha256',
  'untracked_content_sha256',
  'refs_sha256',
  'local_config_sha256',
  'worktrees',
  'stash_count',
];

function compare(baseline, current) {
  const drift = [];
  for (const field of COMPARE_FIELDS) {
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
    process.stdout.write(`${JSON.stringify(snapshot(repo), null, 2)}\n`);
    return;
  }
  if (command === 'compare') {
    if (!args.baseline) fail('compare requires --baseline <path|->');
    let raw;
    try {
      raw = args.baseline === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(args.baseline, 'utf8');
    } catch (e) {
      fail(`baseline unreadable: ${e.message}`);
    }
    let baseline;
    try {
      baseline = JSON.parse(raw);
    } catch (e) {
      fail(`baseline is not valid JSON: ${e.message}`);
    }
    const current = snapshot(repo);
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

main();
