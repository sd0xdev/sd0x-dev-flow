'use strict';

// Check-time gate derivation (WB4). Obligation comes from the dirty set and
// validity from the newest verdict-bearing record for (plane, plane_digest),
// vetoed by unresolved tombstones. Pure READ — the final pairing sweep (the
// check-time writer) runs before this, in stop-guard, via dispatch-cli sweep.
// Contract and worked behaviours:
// docs/features/auto-loop-evolution/2-tech-spec/2-content-addressed-receipts.md §3.5, §4.
//
// Output consumed by hooks/stop-guard.sh (jq), one object per gate:
//   owed           true | false | null — null means the tree was underivable
//                  (git failed): obligation falls back to the stored flags.
//   veto           an unresolved tombstone stands against (plane, digest), or
//                  the tombstone read was damaged (§4: unresolved for every
//                  pair). Absolute: overrides any mirror PASS.
//   closedByDigest the digest path positively closes the gate: V(plane).verdict
//                  == "pass" ∧ mode_ok ∧ no veto ∧ whole digest.
//   authoritativeFail V(plane) exists for the current digest and is a fail (or
//                  a mode-rejected pass): the digest path answered NEGATIVELY —
//                  the consumer must force the gate open, never fall back.
//   treeState      top-level: 'ok' | 'not-a-repo' (mirror keeps authority) |
//                  'unverifiable' (a tree exists but could not be read —
//                  consumer forces obligation on, fail-closed).
//   None of veto/closedByDigest/authoritativeFail → on a derivable tree the
//   gate is OPEN (WB5c: no digest receipt, no pass); only treeState 'not-a-repo'
//   leaves validity to the legacy mirror (no tree for a receipt to bind to).

const fs = require('fs');
const path = require('path');
const { computeTreeState } = require('./tree-digest');
const receiptLog = require('./receipt-log');

// precommit shares the code plane's digest: its verdict certifies the same
// tree bytes a code review certifies (§3.2).
const GATE_PLANES = { code_review: 'code', doc_review: 'doc', precommit: 'code' };

function modeOk(gate, mode, env) {
  if (gate !== 'precommit') return true;
  if (mode !== 'full' && mode !== 'fast') return false; // absent/unknown: unproven is not proven
  if ((env.PRECOMMIT_REQUIRE_FULL || '') === '1' && mode !== 'full') return false;
  return true;
}

// Ids resolved for (plane, digest): every `resolves` tuple matching the full
// (plane, digest, id) — a colliding id cannot resolve another pair's tombstone.
// Provenance is part of the contract (§4): a resolves array is honoured only on
// a record that is ITSELF an authoritative PASS for that same (plane, digest) —
// a runner pass verdict row, or a settlement whose plane_results projection for
// the plane is a same-digest pass. A tuple riding on a fail, a no-verdict, a
// dispatch, or another pair's record proves nothing about this pair and must
// not clear its tombstone.
function recordPassesFor(r, plane, digest) {
  if (!r) return false;
  if (r.kind === 'verdict') {
    return r.plane === plane && r.digest === digest && r.verdict === 'pass';
  }
  if (r.kind === 'settlement' && r.plane_results && typeof r.plane_results === 'object') {
    const proj = r.plane_results[plane];
    return Boolean(proj && proj.digest === digest && proj.verdict === 'pass');
  }
  return false;
}

function resolvedIdSet(records, plane, digest) {
  const set = new Set();
  for (const r of records) {
    if (!recordPassesFor(r, plane, digest) || !Array.isArray(r.resolves)) continue;
    for (const t of r.resolves) {
      if (t && t.plane === plane && t.digest === digest && typeof t.id === 'string') {
        set.add(t.id);
      }
    }
  }
  return set;
}

function deriveGates(repoRoot, env = process.env) {
  const reports = [];

  let tree = null;
  const treeFailMsgs = [];
  try {
    tree = computeTreeState(repoRoot);
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 200);
    treeFailMsgs.push(msg);
    reports.push(`tree-digest failed: ${msg}`);
  }
  // computeTreeState reports its own git failure as both-planes-partial with
  // digest null and an empty dirty set; an empty dirty set from a failed read
  // is NOT "clean" — obligation is underivable there (owed: null below).
  if (tree) {
    for (const r of tree.partialReasons || []) {
      if (typeof r.reason === 'string' && r.reason.startsWith('git-failed')) treeFailMsgs.push(r.reason);
    }
  }
  const gitFailed = !tree || treeFailMsgs.length > 0;
  // Two failures with opposite risk profiles (P0-3). Outside a repo there is no
  // tree to certify and no gate this derivation could inform — the mirror keeps
  // its authority (treeState 'not-a-repo'). Every OTHER git failure — a
  // warn-and-omit unreadable subtree, a spawn error, a non-zero exit — means a
  // tree EXISTS but could not be verified: treating that as "fall back to the
  // mirror" would let an attacker (or a chmod 000) hide dirty files behind an
  // unreadable directory. That is 'unverifiable' and the consumer must force
  // the obligation on, fail-closed.
  //
  // The benign class needs POSITIVE evidence, not an error substring (R2-2):
  // git says "not a git repository" just as readily for a corrupt/inaccessible
  // .git marker as for a directory that never had one, and (before tree-digest
  // stripped them) an inherited GIT_DIR could make a real checkout emit it.
  // So 'not-a-repo' additionally requires that no .git entry exists at the
  // root at all; a matching message WITH a .git entry present is a repo that
  // could not be read — 'unverifiable', fail-closed.
  // lstat, not existsSync: existsSync answers false for a BROKEN SYMLINK and
  // swallows every lookup error, which would launder "there is a .git here
  // that git cannot follow" into proven absence. Only an actual ENOENT proves
  // the entry is not there; any other outcome — a dir, a gitfile, a symlink
  // broken or not, EACCES, anything — means something exists and the failure
  // is 'unverifiable'.
  let noGitEntry = false;
  if (gitFailed) {
    try {
      fs.lstatSync(path.join(repoRoot, '.git'));
      noGitEntry = false;
    } catch (e) {
      noGitEntry = Boolean(e && e.code === 'ENOENT');
    }
  }
  const treeState = !gitFailed
    ? 'ok'
    : treeFailMsgs.some(m => /not a git repository/i.test(m)) && noGitEntry
      ? 'not-a-repo'
      : 'unverifiable';

  let read = { records: [], malformed: 0, missing: true };
  try {
    const { file } = receiptLog.resolveReceiptPaths(repoRoot);
    read = receiptLog.readRecords(file);
  } catch (e) {
    read = { records: [], malformed: 0, unreadable: true, error: String((e && e.message) || e) };
  }
  const logUnavailable = Boolean(read.unreadable || read.missing);
  if (read.unreadable) reports.push(`receipt log unreadable: ${read.error || 'unknown'}`);
  if (read.malformed > 0) reports.push(`receipt log carried ${read.malformed} malformed line(s) — skipped`);

  const tomb = receiptLog.readTombstones(repoRoot);
  if (!tomb.ok) reports.push(`tombstone read damaged (${tomb.reason || 'unknown'}) — unresolved for every pair, over-block`);

  const planes = {};
  for (const [gate, plane] of Object.entries(GATE_PLANES)) {
    const t = tree ? tree.planes[plane] : { digest: null, partial: true, dirty: [] };
    const owed = gitFailed ? null : t.dirty.length > 0;

    let veto = !tomb.ok;
    let vetoIds = [];
    if (tomb.ok && typeof t.digest === 'string' && t.digest) {
      const matched = receiptLog.matchingTombstoneIds(tomb.records, gate, t.digest);
      if (matched.length) {
        const resolved = resolvedIdSet(read.records, gate, t.digest);
        vetoIds = matched.filter(id => !resolved.has(id));
        if (vetoIds.length) veto = true;
      }
    }

    let verdict = null;
    let mode = null;
    let closedByDigest = false;
    let authoritativeFail = false;
    let detail = '';
    if (t.partial) {
      detail = 'plane digest partial — digest path cannot close';
    } else if (logUnavailable) {
      detail = read.unreadable ? 'receipt log unreadable' : 'no receipt log';
    } else {
      const V = receiptLog.selectVerdict(read.records, gate, t.digest);
      if (V) {
        verdict = typeof V.verdict === 'string' ? V.verdict : null;
        mode = typeof V.mode === 'string' ? V.mode : null;
      }
      // The dual-read contract (P0-1): mirror fallback exists for INFRASTRUCTURE
      // absence — no log, no verdict for this digest, partial digest — never for
      // an authoritative digest NEGATIVE. When the newest verdict-bearing record
      // for the current digest says fail (or a pass whose mode the policy
      // rejects), the digest path has answered, and a stale mirror "passed" flag
      // must not outvote it: authoritativeFail forces the gate open.
      if (!V) detail = 'no verdict for current digest';
      else if (verdict !== 'pass') {
        authoritativeFail = true;
        detail = `verdict=${verdict || 'invalid'}`;
      } else if (!modeOk(gate, mode, env)) {
        authoritativeFail = true;
        detail = `mode=${mode || 'unrecorded'} not acceptable`;
      } else if (veto) detail = 'unresolved tombstone stands against this pair';
      else closedByDigest = true;
    }
    if (veto && !detail) detail = 'unresolved tombstone stands against this pair';

    planes[gate] = {
      plane,
      owed,
      dirty: gitFailed ? null : t.dirty.length,
      digest: t.digest,
      partial: Boolean(t.partial),
      verdict,
      mode,
      veto,
      vetoIds,
      closedByDigest,
      authoritativeFail,
      detail,
    };
  }

  return { v: 1, treeState, planes, tombstonesDamaged: !tomb.ok, reports };
}

// WB5: the dual-read merge as ONE shared implementation for the advisory
// consumers (user-prompt-review-guard.sh, post-skill-auto-loop.sh,
// post-compact-auto-loop.sh). Takes the state-file path those hooks used to
// read field-by-field and returns the merged view under the same policy
// stop-guard applies (§3.5 ordering): a derived obligation replaces the
// stored change flags in BOTH directions; 'unverifiable' forces obligations
// on and invalidates every mirror pass; a digest closure marks passed and an
// authoritative negative or §4 veto forces failed. WB5c closed the dual-read
// window: on a derivable tree a plane the digest path cannot positively close
// is FAILED — the mirror is advisory and no longer consulted for validity.
// 'not-a-repo' is the one surviving mirror read (named in mirror_planes):
// outside a repository there is no tree for a digest receipt to bind to, so
// the content-addressed model does not apply and the stored values keep their
// legacy meaning. Sidecar overrides remain the CALLER's duty and run AFTER
// this merge — the same ordering stop-guard uses, so a write-failure marker
// still forces its plane open over digest evidence.
function resolveAdvisory(repoRoot, stateFilePath, env = process.env) {
  let mirror = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    if (parsed && typeof parsed === 'object') mirror = parsed;
  } catch {
    mirror = {};
  }
  const out = {
    v: 1,
    treeState: 'unknown',
    mirror_planes: [],
    has_code_change: mirror.has_code_change === true,
    has_doc_change: mirror.has_doc_change === true,
    code_review_passed: Boolean(mirror.code_review && mirror.code_review.passed === true),
    doc_review_passed: Boolean(mirror.doc_review && mirror.doc_review.passed === true),
    precommit_passed: Boolean(mirror.precommit && mirror.precommit.passed === true),
  };
  const g = deriveGates(repoRoot, env);
  out.treeState = g.treeState;
  out.reports = g.reports;
  if (g.treeState === 'unverifiable') {
    out.has_code_change = true;
    out.has_doc_change = true;
    out.code_review_passed = false;
    out.doc_review_passed = false;
    out.precommit_passed = false;
    return out;
  }
  const owedCode = g.planes.code_review.owed;
  const owedDoc = g.planes.doc_review.owed;
  const derivable = typeof owedCode === 'boolean' && typeof owedDoc === 'boolean';
  if (derivable) {
    out.has_code_change = owedCode;
    out.has_doc_change = owedDoc;
  }
  const KEYS = {
    code_review: 'code_review_passed',
    doc_review: 'doc_review_passed',
    precommit: 'precommit_passed',
  };
  for (const [gate, key] of Object.entries(KEYS)) {
    const p = g.planes[gate];
    if (p.veto || p.authoritativeFail) out[key] = false;
    else if (p.closedByDigest) out[key] = true;
    else if (derivable) out[key] = false; // WB5c: window closed — no digest receipt, no pass
    else out.mirror_planes.push(gate);
  }
  return out;
}

module.exports = { deriveGates, resolveAdvisory, GATE_PLANES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const repoRoot = args[0] && !args[0].startsWith('--') ? args[0] : process.cwd();
  const advIdx = args.indexOf('--advisory');
  try {
    if (advIdx !== -1) {
      const stateFile = args[advIdx + 1];
      if (!stateFile || stateFile.startsWith('--')) {
        throw new Error('--advisory requires a state-file path');
      }
      process.stdout.write(JSON.stringify(resolveAdvisory(repoRoot, stateFile)) + '\n');
    } else {
      process.stdout.write(JSON.stringify(deriveGates(repoRoot)) + '\n');
    }
  } catch (e) {
    process.stderr.write(`gate-derive: ${String((e && e.stack) || e)}\n`);
    process.exit(1);
  }
}
