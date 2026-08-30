#!/usr/bin/env node
'use strict';

// Single-slot per-plane review state — the one small store behind the reminder
// hooks. Slot shape, `noted`/`passed`/`owed` formulas, and the advisory failure
// budget: docs/features/hook-lightweighting/2-tech-spec.md §3.1–§3.2.

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { computeTreeState } = require(path.join(__dirname, 'lib', 'tree-digest.js'));

// Gate plane → content plane. precommit binds the CODE digest: it is an
// obligation of the code plane, so a doc-only edit never reopens it (§3.1).
const PLANES = { code_review: 'code', doc_review: 'doc', precommit: 'code' };
const GATES = { code_review: '/codex-review-fast', doc_review: '/codex-review-doc', precommit: '/precommit' };

function die(msg) {
  process.stderr.write(`review-state: ${msg}\n`);
  process.exit(1);
}

function repoRoot() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { env }).toString('utf8').trim();
}

// <repo-key>: canonical real checkout path + short hash of it, so two
// same-named checkouts, symlinked spellings and worktrees neither share nor
// fragment state. The hash algorithm/length is non-contractual (§6).
function stateDir(root) {
  const real = fs.realpathSync(root);
  const key = `${path.basename(real)}-${crypto.createHash('sha256').update(real).digest('hex').slice(0, 12)}`;
  return path.join(os.homedir(), '.cache', 'sd0x-dev-flow', 'state', key);
}

// noted:true ⇔ a valid slot was decoded. Missing file, unparseable JSON and a
// schema-invalid object all read as not-noted; a valid slot may carry
// digest:null (undigestable tree at note time), which never matches a check.
function readSlot(dir, plane) {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(path.join(dir, `${plane}.json`), 'utf8'));
  } catch {
    return null;
  }
  if (typeof s !== 'object' || s === null) return null;
  if (s.verdict !== 'pass' && s.verdict !== 'fail') return null;
  if (s.digest !== null && typeof s.digest !== 'string') return null;
  if (!Number.isInteger(s.rounds) || s.rounds < 0) return null;
  return s;
}

function note(plane, verdict) {
  if (!(plane in PLANES)) die(`unknown plane "${plane}" — valid: ${Object.keys(PLANES).join(', ')}`);
  if (verdict !== 'pass' && verdict !== 'fail') die(`invalid verdict "${verdict}" — valid: pass, fail`);
  const root = repoRoot();
  const digest = computeTreeState(root).planes[PLANES[plane]].digest;
  const dir = stateDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const prev = readSlot(dir, plane);
  const rounds = verdict === 'fail' ? (prev ? prev.rounds : 0) + 1 : 0;
  const slot = { digest, verdict, rounds, time: new Date().toISOString() };
  // Plain overwrite, no lock, no temp-and-rename: a torn concurrent write
  // decodes as noted:false and degrades to a reminder, never to a false pass.
  fs.writeFileSync(path.join(dir, `${plane}.json`), `${JSON.stringify(slot)}\n`);
  process.stdout.write(`[REVIEW_STATE] ${plane} ${JSON.stringify(slot)}\n`);
}

function computeCheck() {
  const root = repoRoot();
  const tree = computeTreeState(root);
  const dir = stateDir(root);
  const planes = {};
  for (const [plane, content] of Object.entries(PLANES)) {
    const cur = tree.planes[content];
    // A partial plane is unverifiable — fail-open to a reminder, never silence.
    const dirty = cur.partial || cur.dirty.length > 0;
    const slot = readSlot(dir, plane);
    const noted = slot !== null;
    const digest_match =
      noted && slot.digest !== null && cur.digest !== null && slot.digest === cur.digest;
    const verdict = noted ? slot.verdict : null;
    const rounds = noted ? slot.rounds : 0;
    const passed = noted && digest_match && verdict === 'pass';
    const owed = dirty && !passed;
    planes[plane] = { noted, dirty, digest_match, verdict, rounds, passed, owed };
  }
  return {
    planes,
    change: ['code', 'doc'].filter(p => tree.planes[p].partial || tree.planes[p].dirty.length > 0),
    dirtyPaths: [...tree.planes.code.dirty, ...tree.planes.doc.dirty],
    root,
  };
}

// Exact-name intent mapping: a changed path under docs/features/<key>/ maps to that directory's
// intent-<key>.md, and only when that exact file exists — a stray intent-<other>.md never hints.
// A fact, never a verdict; emitted only on the state-backed line (the hook's git_status fallback
// stays change-class-only by design).
// The feature-key contract (scripts/lib/feature-resolver.js SLUG_RE, restated here rather than
// required — the resolver pulls the whole classifier graph and this file stays light). It also
// guards the OUTPUT: the fact line is one line with a space-separated field grammar, and a
// directory named with a newline, space or comma would otherwise be interpolated into it verbatim
// — git status paths keep raw control characters all the way here.
const FEATURE_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function intentHints(root, dirtyPaths) {
  const hints = new Set();
  for (const p of dirtyPaths) {
    const m = /^docs\/features\/([^/]+)\//.exec(p);
    if (!m) continue;
    if (!FEATURE_SLUG_RE.test(m[1])) continue;
    const hint = `docs/features/${m[1]}/intent-${m[1]}.md`;
    try {
      // Directory enumeration with exact byte name + Dirent type, not statSync/existsSync:
      // statSync follows symlinks and a case-insensitive filesystem answers for `Intent-x.md`,
      // so either could report a presence no implementing skill can deliver on. Dirent types are
      // lstat-like (a symlink is isSymbolicLink, not isFile) and `name` comparison is
      // byte-exact — same contract as next-step's advisory and doc-classifier's exclusion.
      const entries = fs.readdirSync(path.join(root, 'docs', 'features', m[1]), { withFileTypes: true });
      if (entries.some(e => e.name === `intent-${m[1]}.md` && e.isFile())) hints.add(hint);
    } catch { /* absent or unreadable reads as no hint — a hint is a reminder, never an obligation */ }
  }
  return [...hints].sort();
}

function statusToken(p) {
  if (!p.noted) return 'none';
  if (!p.digest_match) return 'stale';
  return p.verdict;
}

// One computation, three renderings (§3.2). md is the only rendering allowed
// to be silent; fact and json always answer.
function check(format) {
  const { planes, change, dirtyPaths, root } = computeCheck();
  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(planes)}\n`);
    return;
  }
  if (format === 'fact') {
    const reviews = Object.entries(planes)
      .map(([name, p]) => `${name}:${statusToken(p)}${p.rounds > 0 ? `(r${p.rounds})` : ''}`)
      .join(',');
    const hints = intentHints(root, dirtyPaths);
    const hintField = hints.length ? ` intent_hint=${hints.join(',')}` : '';
    process.stdout.write(`[AUTO_LOOP_STATE] change=${change.length ? change.join(',') : 'none'} reviews=${reviews}${hintField} source=state\n`);
    return;
  }
  for (const [name, p] of Object.entries(planes)) {
    if (!p.owed) continue;
    const why = p.noted ? (p.digest_match ? `最後記錄為 ${p.verdict}` : '記錄的 digest 已過期') : '無有效記錄';
    const roundsNote = p.rounds > 0 ? `｜已 ${p.rounds} 輪未過` : '';
    process.stdout.write(`📋 ${name}：${PLANES[name]} 平面有未提交變更且${why} → ${GATES[name]}${roundsNote}（規則見 rules/auto-loop.md）\n`);
  }
}

const [, , cmd, ...args] = process.argv;
try {
  if (cmd === 'note') {
    note(args[0], args[1]);
  } else if (cmd === 'check') {
    const fmt = (args.find(a => a.startsWith('--format=')) || '--format=md').slice('--format='.length);
    if (!['md', 'fact', 'json'].includes(fmt)) die(`unknown format "${fmt}" — valid: md, fact, json`);
    check(fmt);
  } else {
    die(`usage: review-state.js note <plane> <pass|fail> | check [--format=md|fact|json]`);
  }
} catch (e) {
  die(String((e && e.message) || e));
}
