'use strict';

// WB4 — stop-guard check-time derivation, hook level (tech spec §3.5, §4):
// the real hook run against real git repos, a real receipt log, and the real
// dispatch CLI. Covers the dual-read contract end to end: digest evidence
// closing gates the mirror holds open, derived obligation overriding stale
// stored flags in BOTH directions, the absolute tombstone veto, mode policy
// under PRECOMMIT_REQUIRE_FULL, the final pairing sweep settling a completed
// review at stop time, and the mirror fallback when obligation is underivable.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const XDG = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-derive-xdg-'));
process.env.XDG_CACHE_HOME = XDG;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-derive-tmp-'));
process.env.TMPDIR = TMP;

const receiptLog = require('../../scripts/lib/receipt-log.js');
const dispatchLog = require('../../scripts/lib/dispatch-log.js');
const treeDigest = require('../../scripts/lib/tree-digest.js');

const hookPath = path.resolve(__dirname, '../../hooks/stop-guard.sh');

const cleanups = [];
after(() => {
  for (const d of cleanups) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(XDG, { recursive: true, force: true });
  fs.rmSync(TMP, { recursive: true, force: true });
});

function tmpdir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(d);
  return d;
}

const CLEAN_GIT_ENV = { ...process.env };
for (const k of Object.keys(CLEAN_GIT_ENV)) {
  if (k.startsWith('GIT_')) delete CLEAN_GIT_ENV[k];
}
CLEAN_GIT_ENV.GIT_CONFIG_NOSYSTEM = '1';

function makeGitRepo() {
  const dir = tmpdir('sg-derive-repo-');
  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: dir, env: CLEAN_GIT_ENV });
  sh('git', ['init', '-q', '-b', 'main']);
  sh('git', ['config', 'user.name', 'Derive Tester']);
  sh('git', ['config', 'user.email', 'derive-tester@example.invalid']);
  sh('git', ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1);\n');
  fs.writeFileSync(path.join(dir, 'spec.md'), '# spec\n');
  sh('git', ['add', '-A']);
  sh('git', ['commit', '-q', '-m', 'seed']);
  // The state mirror lives at the repo root and is "held out of git only by
  // ignore entries" (spec §3.1 artifact table) — session-init maintains those
  // in real repos. `info/exclude` models that without dirtying the worktree.
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.claude_review_state.json*\n');
  return dir;
}

function digestOf(repo, plane) {
  return treeDigest.computeTreeState(repo).planes[plane].digest;
}

function writeState(repo, state) {
  fs.writeFileSync(path.join(repo, '.claude_review_state.json'), JSON.stringify(state));
}

function appendVerdict(repo, rec) {
  const { file } = receiptLog.resolveReceiptPaths(repo);
  receiptLog.appendRecords(file, [{ v: 1, kind: 'verdict', time: new Date().toISOString(), ...rec }]);
}

function makeTranscript(dir) {
  const p = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(p, JSON.stringify({ type: 'summary', sessionStart: true }) + '\n');
  return p;
}

function addLine(p, obj) {
  fs.appendFileSync(p, JSON.stringify(obj) + '\n');
}

function entryLine(id, input) {
  return { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'mcp__codex__codex', input }] } };
}

function resultLine(id, text) {
  return {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] },
  };
}

function runHook(repo, { transcript, env = {}, sessionId = 'sess-derive' } = {}) {
  const { STOP_GUARD_MODE: _dropped, ...cleanEnv } = process.env;
  const input = { session_id: sessionId, transcript_path: transcript || makeTranscript(tmpdir('sg-derive-t-')) };
  return spawnSync('bash', [hookPath], {
    cwd: repo,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...cleanEnv, CLAUDE_PROJECT_DIR: repo, STOP_GUARD_MODE: 'strict', ...env },
  });
}

function outJson(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {};
  }
}

test('digest verdicts close gates the mirror holds open — stop allowed, source=digest', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  writeState(repo, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  const r = runHook(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(outJson(r).ok, true);
});

test('derived obligation overrides a stale has_code_change=false — dirty code blocks in strict', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  // The mirror claims no code change; the false→true direction the stored-flag
  // model could never do safely is exactly what the dirty set derives (§3.5).
  writeState(repo, { has_code_change: false, has_doc_change: false });
  const r = runHook(repo);
  assert.equal(r.status, 2, `expected block, got: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr + r.stdout, /codex-review-fast/);
  // The fact block only prints on a stop_attempt with pending gates, which is
  // exactly this case — the dual-read observability field rides on it (§3.5).
  assert.match(r.stderr, /source=digest/);
});

test('a clean tree releases pending stored flags through the derived path', () => {
  const repo = makeGitRepo();
  writeState(repo, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  const r = runHook(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(outJson(r).ok, true);
});

test('an unresolved tombstone vetoes its pair even when the mirror says passed (§4, absolute)', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  writeState(repo, {
    has_code_change: true,
    code_review: { passed: true },
    precommit: { passed: true, mode: 'full' },
  });
  receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: d }]);
  const r = runHook(repo);
  assert.equal(r.status, 2, `expected veto block, got: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /tombstone/);
});

test('PRECOMMIT_REQUIRE_FULL=1: a digest fast pass does not close precommit; a full pass does', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  writeState(repo, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'fast' });
  let r = runHook(repo, { env: { PRECOMMIT_REQUIRE_FULL: '1' } });
  assert.equal(r.status, 2, `fast must not satisfy the full-only gate: ${r.stdout}`);
  assert.match(r.stderr + r.stdout, /precommit/);
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  r = runHook(repo, { env: { PRECOMMIT_REQUIRE_FULL: '1' } });
  assert.equal(r.status, 0, r.stderr);
});

test('final pairing sweep settles a completed review AT STOP and the gate closes from it', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'spec.md'), 'edited\n');
  const dDoc = digestOf(repo, 'doc');
  const tPath = makeTranscript(tmpdir('sg-derive-sweep-t-')); // outside the repo: the transcript must not dirty the tree under review
  const sessionId = 'sess-derive-sweep';
  dispatchLog.appendActivation(repo, { sessionId, transcriptPath: tPath });
  const DOC_INPUT = { prompt: 'Review the docs. Output Format: ## Document Review with gate.' };
  dispatchLog.appendDispatch(repo, {
    sessionId,
    transcriptPath: tPath,
    toolInput: DOC_INPUT,
    planes: { doc_review: dDoc },
  });
  addLine(tPath, entryLine('tu-stop-1', DOC_INPUT));
  addLine(tPath, resultLine('tu-stop-1', '## Document Review\n\n✅ Mergeable\n'));
  // Mirror: doc gate open, nothing recorded. Only the sweep-at-stop can pair
  // and settle the completed review sitting in the transcript.
  writeState(repo, { has_doc_change: true, doc_review: { passed: false } });
  const r = runHook(repo, { transcript: tPath, sessionId });
  assert.equal(r.status, 0, `sweep should settle and close the doc gate: ${r.stdout} ${r.stderr}`);
  assert.equal(outJson(r).ok, true);
  // The settlement is durable, not just this stop's in-memory read.
  const { file } = receiptLog.resolveReceiptPaths(repo);
  const settled = receiptLog
    .readRecords(file)
    .records.some(rec => rec.kind === 'settlement' && rec.plane_results && rec.plane_results.doc_review);
  assert.equal(settled, true, 'sweep must have appended the settlement record');
});

test('an authoritative digest FAIL overrides a mirror pass — never mirror fallback (P0-1)', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  // The mirror says everything passed; the digest path's newest verdict for
  // the CURRENT digest says fail. The digest answered — a stale mirror flag
  // must not outvote it.
  writeState(repo, {
    has_code_change: true,
    code_review: { passed: true },
    precommit: { passed: true, mode: 'full' },
  });
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'fail' });
  const r = runHook(repo);
  assert.equal(r.status, 2, `expected authoritative-negative block, got: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /authoritative digest negative/);
});

test('dual-mode READY aggregate cannot overwrite the tombstone veto (P0-2 pin)', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  // Dual mode with an executed READY aggregate: the recompute would set
  // CODE_REVIEW_PASSED=true — unless the derivation's veto pinned
  // DUAL_GATE_PASSED=false first (the sidecar-pin precedent).
  writeState(repo, {
    has_code_change: true,
    review_mode: 'dual',
    code_review: { passed: true },
    precommit: { passed: true, mode: 'full' },
    aggregate_gate: { executed: true, gate: 'READY' },
  });
  receiptLog.appendTombstone(repo, [{ plane: 'code_review', digest: d }]);
  const r = runHook(repo);
  assert.equal(r.status, 2, `expected veto to survive dual READY, got: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /tombstone/);
});

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
test('unverifiable tree blocks even against a full stale-PASS mirror (R2-1 composition)', { skip: isRoot }, () => {
  const repo = makeGitRepo();
  const locked = path.join(repo, 'locked');
  fs.mkdirSync(locked);
  fs.writeFileSync(path.join(locked, 'hidden.js'), '1\n');
  // The hardest composition: the mirror claims no obligation AND holds a PASS
  // for every gate. An unverifiable tree must invalidate the receipts too —
  // forcing obligations alone would let these stale PASS values satisfy them.
  writeState(repo, {
    has_code_change: false,
    has_doc_change: false,
    code_review: { passed: true },
    doc_review: { passed: true },
    precommit: { passed: true, mode: 'full' },
  });
  fs.chmodSync(locked, 0o000);
  let r;
  try {
    r = runHook(repo);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  assert.equal(r.status, 2, `stale mirror PASS must not satisfy an unverifiable tree: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /tree unverifiable/);
});

test('hidden submodule change under ignore=all blocks against a stale-false mirror (R4-1)', { skip: isRoot }, () => {
  // The round-4 P0 end to end: the superproject porcelain is suppressed, the
  // nested status warn-and-omits an unreadable directory, and the mirror
  // claims no code change ever happened. treeState stays 'ok' (the HOST git
  // is healthy), so nothing on the unverifiable path fires — the ONLY thing
  // that can open the gate is the gitlink pass dirtying its plane so owed
  // derives true.
  const sub = makeGitRepo();
  const repo = makeGitRepo();
  execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub'], {
    cwd: repo,
    env: CLEAN_GIT_ENV,
  });
  execFileSync('git', ['commit', '-q', '-m', 'add submodule'], { cwd: repo, env: CLEAN_GIT_ENV });
  execFileSync('git', ['config', 'submodule.vendor/sub.ignore', 'all'], { cwd: repo, env: CLEAN_GIT_ENV });
  const locked = path.join(repo, 'vendor/sub', 'locked');
  fs.mkdirSync(locked);
  fs.writeFileSync(path.join(locked, 'hidden.js'), '1\n');
  writeState(repo, { has_code_change: false, has_doc_change: false });
  fs.chmodSync(locked, 0o000);
  let r;
  try {
    r = runHook(repo);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  assert.equal(r.status, 2, `hidden submodule content must block: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr + r.stdout, /codex-review-fast/);
});

test('capture containment: every capture file comes from the one proof loop (R4-2, root-bounded)', () => {
  // A repo rooted at /tmp (or macOS's physical /private/tmp) cannot be built
  // in this harness — /tmp is shared, and planting a .git there would poison
  // every parallel job. The invariant is pinned structurally instead: the ONLY
  // mktemp in the gate logic lives inside _gd_safe_tmpfile's candidate loop,
  // every candidate (the /tmp fallback included) is resolved and checked
  // against the physical WORKTREE ROOT (round-3 P2 — a $PWD bound re-admitted
  // repo-local TMPDIRs from a subdirectory cwd), and both the sweep and the
  // probes obtain their capture file exclusively through that helper.
  const src = fs.readFileSync(hookPath, 'utf8');
  // One candidate loop, resolved paths, root-bounded.
  assert.match(src, /for _cand in "\$\{TMPDIR:-\/tmp\}" \/tmp; do/);
  // A worktree rooted at / defeats the "$_bound"/* descendant pattern (//* matches
  // nothing), so the helper must refuse outright before the loop (round-4 P2).
  // A behavioral repo-at-/ fixture is unsafe to build; pin the guard structurally
  // and require it to precede the candidate loop.
  const rootGuard = src.indexOf('[[ "$_bound" == "/" ]] && return 1');
  const candLoop = src.indexOf('for _cand in "${TMPDIR:-/tmp}" /tmp; do');
  assert.ok(rootGuard !== -1, 'root-bound guard missing');
  assert.ok(candLoop !== -1 && rootGuard < candLoop, 'root-bound guard must precede the candidate loop');
  assert.match(src, /_res=\$\(cd "\$_cand" 2>\/dev\/null && pwd -P\) \|\| continue/);
  assert.match(src, /case "\$_res" in "\$_bound" \| "\$_bound"\/\*\) continue ;; esac/);
  // The boundary comes from the fenced worktree-root resolution, never bare $PWD.
  assert.match(src, /rev-parse --show-toplevel/);
  // Every mktemp CALL in the file sits inside the helper's proof loop — none
  // elsewhere in the sweep/probe paths can mint an unproven capture file.
  // Count call sites ($(mktemp …), not the word in comments.
  const mktempSites = [...src.matchAll(/\$\(mktemp /g)];
  const helperSite = /_f=\$\(mktemp "\$\{_res\}\/\$\{_pfx\}\.XXXXXX" 2>\/dev\/null\) \|\| continue/;
  assert.match(src, helperSite);
  assert.equal(mktempSites.length, 1, `expected the helper's mktemp to be the only one, found ${mktempSites.length}`);
  // Sweep and both probes go through the helper.
  assert.match(src, /_GD_SWEEP_ERRFILE="\$\(_gd_safe_tmpfile sg-sweep-err\)" \|\| _GD_SWEEP_ERRFILE=""/);
  assert.match(src, /_probe_err="\$\(_gd_safe_tmpfile sg-probe-err\)" \|\| _probe_err=""/);
  assert.match(src, /_gd_fb_err="\$\(_gd_safe_tmpfile sg-probe-err\)" \|\| _gd_fb_err=""/);
  assert.match(src, /_recon_err="\$\(_gd_safe_tmpfile sg-recon-err\)" \|\| _recon_err=""/);
});

test('retired stored-flag paths carry a pointer to the superseding mechanism (WB5 migration)', () => {
  // AC7: a reader of a retired branch must be able to find where the behaviour
  // went. The pointer is the breadcrumb — deleting it leaves a branch that
  // looks like it forgot to write state rather than one that migrated.
  const editHook = fs.readFileSync(
    path.join(path.dirname(hookPath), 'post-edit-format.sh'),
    'utf8'
  );
  // Code-plane retirement names what was retired AND points at the mechanism.
  assert.match(editHook, /WB5b:[\s\S]{0,400}RETIRED/);
  assert.match(editHook, /scripts\/lib\/gate-derive\.js/);
  assert.match(editHook, /WB5b: same retirement as the code branch above/);
  // Stop-guard's mirror retirement discloses itself and cites the spec section.
  const guard = fs.readFileSync(hookPath, 'utf8');
  assert.match(guard, /mirror retired/);
  assert.match(guard, /WB5c \(§3\.6\): the dual-read window is closed/);
});

test('sweep settlement resolves the tombstone standing against its pair (§4 producer duty)', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'spec.md'), 'edited\n');
  const dDoc = digestOf(repo, 'doc');
  // A tombstone stands against (doc_review, dDoc) — a prior settlement append
  // failed. The sweep's later successful PASS settlement must read the
  // fallback and attach the resolves tuple, or this gate stays vetoed forever.
  const t = receiptLog.appendTombstone(repo, [{ plane: 'doc_review', digest: dDoc }]);
  const tPath = makeTranscript(tmpdir('sg-derive-resolve-t-'));
  const sessionId = 'sess-derive-resolve';
  dispatchLog.appendActivation(repo, { sessionId, transcriptPath: tPath });
  const DOC_INPUT = { prompt: 'Review the docs. Output Format: ## Document Review with gate.' };
  dispatchLog.appendDispatch(repo, {
    sessionId,
    transcriptPath: tPath,
    toolInput: DOC_INPUT,
    planes: { doc_review: dDoc },
  });
  addLine(tPath, entryLine('tu-resolve-1', DOC_INPUT));
  addLine(tPath, resultLine('tu-resolve-1', '## Document Review\n\n✅ Mergeable\n'));
  writeState(repo, { has_doc_change: true, doc_review: { passed: false } });
  const r = runHook(repo, { transcript: tPath, sessionId });
  assert.equal(r.status, 0, `settlement must resolve the tombstone and close the gate: ${r.stdout} ${r.stderr}`);
  const { file } = receiptLog.resolveReceiptPaths(repo);
  const settlement = receiptLog
    .readRecords(file)
    .records.find(rec => rec.kind === 'settlement' && rec.plane_results && rec.plane_results.doc_review);
  assert.ok(settlement, 'sweep must have appended the settlement');
  assert.ok(
    Array.isArray(settlement.resolves) &&
      settlement.resolves.some(x => x.plane === 'doc_review' && x.digest === dDoc && x.id === t.id),
    `settlement must carry the resolves tuple for the standing tombstone: ${JSON.stringify(settlement)}`
  );
});

test('a handled sweep refusal — exit 0 with ok:false — is surfaced, not swallowed (R2-5a)', { skip: isRoot }, () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'spec.md'), 'edited\n');
  const dDoc = digestOf(repo, 'doc');
  const tPath = makeTranscript(tmpdir('sg-derive-okfalse-t-'));
  const sessionId = 'sess-derive-okfalse';
  dispatchLog.appendActivation(repo, { sessionId, transcriptPath: tPath });
  const DOC_INPUT = { prompt: 'Review the docs. Output Format: ## Document Review with gate.' };
  dispatchLog.appendDispatch(repo, {
    sessionId,
    transcriptPath: tPath,
    toolInput: DOC_INPUT,
    planes: { doc_review: dDoc },
  });
  addLine(tPath, entryLine('tu-okfalse-1', DOC_INPUT));
  addLine(tPath, resultLine('tu-okfalse-1', '## Document Review\n\n✅ Mergeable\n'));
  writeState(repo, { has_doc_change: true, doc_review: { passed: false } });
  // An unreadable transcript is a refusal sweep() HANDLES: it returns
  // {ok:false} and the CLI exits 0 — the path a status-only check silently
  // swallows. The hook must parse .ok and surface the diagnostic.
  fs.chmodSync(tPath, 0o000);
  let r;
  try {
    r = runHook(repo, { transcript: tPath, sessionId });
  } finally {
    fs.chmodSync(tPath, 0o644);
  }
  assert.equal(r.status, 2, `unsettled review must keep the gate open: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /final pairing sweep did not settle \(exit=0 ok=false\)/);
});

test('a sweep that could not settle is loud even on exit 0 (ok:false surfaced)', { skip: isRoot }, () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'spec.md'), 'edited\n');
  const dDoc = digestOf(repo, 'doc');
  const tPath = makeTranscript(tmpdir('sg-derive-swfail-t-'));
  const sessionId = 'sess-derive-swfail';
  dispatchLog.appendActivation(repo, { sessionId, transcriptPath: tPath });
  const DOC_INPUT = { prompt: 'Review the docs. Output Format: ## Document Review with gate.' };
  dispatchLog.appendDispatch(repo, {
    sessionId,
    transcriptPath: tPath,
    toolInput: DOC_INPUT,
    planes: { doc_review: dDoc },
  });
  addLine(tPath, entryLine('tu-swfail-1', DOC_INPUT));
  addLine(tPath, resultLine('tu-swfail-1', '## Document Review\n\n✅ Mergeable\n'));
  writeState(repo, { has_doc_change: true, doc_review: { passed: false } });
  // Make the receipt-log directory unwritable: the sweep can still READ the
  // pending dispatch but cannot append its settlement — the CLI reports this
  // as ok:false on exit 0, which the hook must surface, not swallow.
  const { file } = receiptLog.resolveReceiptPaths(repo);
  const dir = path.dirname(file);
  fs.chmodSync(dir, 0o500);
  let r;
  try {
    r = runHook(repo, { transcript: tPath, sessionId });
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  assert.equal(r.status, 2, `unsettled review must keep the gate open: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /final pairing sweep did not settle/);
});

test('no-capture sweep path streams CLI diagnostics instead of discarding them (R5-1)', { skip: isRoot }, () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'spec.md'), 'edited\n');
  const dDoc = digestOf(repo, 'doc');
  const tPath = makeTranscript(tmpdir('sg-derive-nocap-t-'));
  const sessionId = 'sess-derive-nocap';
  dispatchLog.appendActivation(repo, { sessionId, transcriptPath: tPath });
  const DOC_INPUT = { prompt: 'Review the docs. Output Format: ## Document Review with gate.' };
  dispatchLog.appendDispatch(repo, {
    sessionId,
    transcriptPath: tPath,
    toolInput: DOC_INPUT,
    planes: { doc_review: dDoc },
  });
  addLine(tPath, entryLine('tu-nocap-1', DOC_INPUT));
  addLine(tPath, resultLine('tu-nocap-1', '## Document Review\n\n✅ Mergeable\n'));
  writeState(repo, { has_doc_change: true, doc_review: { passed: false } });
  // An execute-only TMPDIR outside the repo survives the candidate loop's
  // resolution + containment proof but refuses mktemp — the same no-capture
  // branch a repo rooted at /tmp would take. With the transcript unreadable,
  // the CLI's refusal diagnostic must reach the hook's stderr: the old
  // 2>/dev/null left only the generic exit/ok line (R5-1).
  const roTmp = tmpdir('sg-derive-nocap-ro-');
  fs.chmodSync(roTmp, 0o500);
  fs.chmodSync(tPath, 0o000);
  let r;
  try {
    r = runHook(repo, { transcript: tPath, sessionId, env: { TMPDIR: roTmp } });
  } finally {
    fs.chmodSync(tPath, 0o644);
    fs.chmodSync(roTmp, 0o700);
  }
  assert.equal(r.status, 2, `unsettled review must keep the gate open: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /transcript unreadable — sweep appends nothing/);
  assert.match(r.stderr, /final pairing sweep did not settle \(exit=0 ok=false\)/);
});

test('a TMPDIR symlinked into the repo cannot plant the sweep capture file in the tree (R3-3)', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'spec.md'), 'edited\n');
  const dDoc = digestOf(repo, 'doc');
  // TMPDIR is an out-of-repo-LOOKING symlink whose target is inside the tree
  // under review: a lexical containment check accepts it, and the capture file
  // would become an untracked code-plane file mid-sweep, shifting the digest
  // the settlement revalidates against.
  const inside = path.join(repo, 'sneaky-tmp');
  fs.mkdirSync(inside);
  const linkDir = tmpdir('sg-derive-tmplink-');
  const link = path.join(linkDir, 'tmp');
  fs.symlinkSync(inside, link);
  const tPath = makeTranscript(tmpdir('sg-derive-tmplink-t-'));
  const sessionId = 'sess-derive-tmplink';
  dispatchLog.appendActivation(repo, { sessionId, transcriptPath: tPath });
  const DOC_INPUT = { prompt: 'Review the docs. Output Format: ## Document Review with gate.' };
  dispatchLog.appendDispatch(repo, {
    sessionId,
    transcriptPath: tPath,
    toolInput: DOC_INPUT,
    planes: { doc_review: dDoc },
  });
  addLine(tPath, entryLine('tu-tmplink-1', DOC_INPUT));
  addLine(tPath, resultLine('tu-tmplink-1', '## Document Review\n\n✅ Mergeable\n'));
  writeState(repo, { has_doc_change: true, doc_review: { passed: false } });
  const r = runHook(repo, { transcript: tPath, sessionId, env: { TMPDIR: link } });
  // No capture file may have touched the reviewed tree...
  const planted = fs.readdirSync(inside).filter(n => n.startsWith('sg-sweep-err.'));
  assert.deepEqual(planted, [], 'capture file must not land inside the repo via the symlink');
  // ...and the poisoned TMPDIR degrades CLOSED, not open: the tombstone
  // resolver refuses a fallback dir inside the repo root, gate-derive treats
  // the refused read as damaged (unresolved-for-every-pair), and the stop
  // blocks — loudly naming the refusal.
  assert.equal(r.status, 2, `poisoned TMPDIR must over-block, never fail open: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /lies inside the repo root/);
  // The completed review was still settled DURABLY (without resolves — the
  // fallback was unreadable), so the identity is not wasted: a later stop with
  // a sane TMPDIR closes the gate from this record instead of re-reviewing.
  const { file } = receiptLog.resolveReceiptPaths(repo);
  const settled = receiptLog
    .readRecords(file)
    .records.some(rec => rec.kind === 'settlement' && rec.plane_results && rec.plane_results.doc_review);
  assert.equal(settled, true, 'the settlement must have landed despite the poisoned TMPDIR');
});

test('obligation underivable outside a git repo — stored flags retained, said out loud', () => {
  const dir = tmpdir('sg-derive-norepo-');
  writeState(dir, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  const r = runHook(dir);
  assert.equal(r.status, 2, `mirror pending state must still block: ${r.stdout}`);
  assert.match(r.stderr, /obligation underivable/);
  // Dual-read observability (§3.5): the derivation ran (it produced the
  // underivable classification), so the fact line reads source=digest — and
  // discloses that EVERY plane's validity fell back to the stored receipts.
  assert.match(r.stderr, /source=digest mirror_planes=code_review,doc_review,precommit/);
});

test('negative control: without the derived override, the same stale-false state allows the stop', () => {
  // Same fixture as the false→true test but with a CLEAN tree: derived owed is
  // false on every plane and the stop passes — proving the block above comes
  // from the derivation seeing the dirty file, not from strict mode itself.
  const repo = makeGitRepo();
  writeState(repo, { has_code_change: false, has_doc_change: false });
  const r = runHook(repo);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(outJson(r).ok, true);
});

// === WB5c window-flip pins (formerly the WB4 dual-read window pins) ===

test('WB5c flip: missing receipt log + valid mirror PASS blocks — the mirror is retired on a derivable tree', () => {
  // AC4's fail-closed endpoint ("no readable log ⇒ owed gates open") is live:
  // WB5c closed the dual-read window, so on a derivable tree a plane no digest
  // receipt positively closes is OPEN whatever the mirror says. The identical
  // fixture used to pin the WB4 allowed-through-mirror semantics.
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  writeState(repo, {
    has_code_change: true,
    code_review: { passed: true },
    precommit: { passed: true, mode: 'full' },
  });
  // No appendVerdict: the per-repo receipt log was never created.
  const r = runHook(repo);
  assert.equal(r.status, 2, `a stale mirror PASS must not close a digest-less gate: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /no digest receipt closes code_review at the current tree/);
  assert.match(r.stderr, /mirror retired/);
});

test('WB5c: a digest-less plane on a derivable tree is OPEN, never a mirror_planes fallback', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  fs.appendFileSync(path.join(repo, 'spec.md'), 'edited\n');
  const d = digestOf(repo, 'code');
  // Code closes by digest; doc has NO verdict. Pre-flip the doc plane fell back
  // to the mirror (source=digest mirror_planes=doc_review). Post-flip the plane
  // reads false directly — blocked, and the fact line must NOT name a fallback:
  // mirror_planes survives only for the not-a-repo classification.
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  // The seeded mirror PASS is the sharp edge: it must not close the gate.
  writeState(repo, { has_code_change: true, has_doc_change: true, doc_review: { passed: true } });
  const r = runHook(repo);
  assert.equal(r.status, 2, `doc gate must stay open: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /no digest receipt closes doc_review at the current tree/);
  // Exact-token assertions on the extracted fact line: no fallback disclosure,
  // and doc_review is the ONLY pending gate (code and precommit closed by digest).
  const fact = (r.stderr.match(/^\[AUTO_LOOP_STATE\] event=stop_attempt.*$/m) || [''])[0];
  assert.ok(fact, `stop_attempt fact line missing from stderr: ${r.stderr}`);
  assert.match(fact, / source=digest /);
  assert.doesNotMatch(fact, /mirror_planes=/);
  assert.match(fact, / pending=doc_review$/);
});

test('session restart: digest receipts survive session-init resetting the mirror', () => {
  // session-init.sh rewrites session_id, both change flags and the three
  // review receipts — the mirror forgets the PASS. The receipt log does not:
  // the digest path re-closes the gates in the new session with zero re-review
  // (AC6 "gates stay closed across session restarts").
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  writeState(repo, { has_code_change: true, code_review: { passed: true }, precommit: { passed: true, mode: 'full' }, session_id: 'sess-restart-a' });
  const sessionInit = path.resolve(__dirname, '../../hooks/session-init.sh');
  const tPath = makeTranscript(tmpdir('sg-derive-restart-t-'));
  const si = spawnSync('bash', [sessionInit], {
    cwd: repo,
    input: JSON.stringify({ session_id: 'sess-restart-b', transcript_path: tPath }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  assert.equal(si.status, 0, `session-init must succeed: ${si.stderr}`);
  // session-init exits 0 even when its reset infrastructure fails — proving
  // the premise means reading the rewritten mirror, not the exit code (R7-2).
  // The reset must have actually forgotten the PASS for the digest-survival
  // claim below to be load-bearing.
  const reset = JSON.parse(fs.readFileSync(path.join(repo, '.claude_review_state.json'), 'utf8'));
  assert.equal(reset.session_id, 'sess-restart-b');
  // WB5b: the reset deletes the retired stored flag rather than zeroing it.
  assert.ok(!Object.hasOwn(reset, 'has_code_change'));
  assert.equal(reset.code_review.passed, false);
  assert.equal(reset.precommit.passed, false);
  const r = runHook(repo, { transcript: tPath, sessionId: 'sess-restart-b', env: { HOOK_DEBUG: '1' } });
  assert.equal(r.status, 0, `digest receipts must survive the restart: ${r.stdout} ${r.stderr}`);
  assert.equal(outJson(r).ok, true);
  // Positive digest-path control (R8-1): the reset ALSO cleared
  // has_code_change, so a derivation-unavailable regression would allow this
  // stop trivially (nothing owed) and the assertions above could not tell.
  // The mirror was proven false — these gate values reading true can only
  // mean the log receipts were actually applied.
  assert.match(r.stderr, /CODE_REVIEW_PASSED=true/);
  assert.match(r.stderr, /PRECOMMIT_PASSED=true/);
});

test('poisoned edit-epoch fields cannot affect the digest gate-state path (AC6 non-consumption)', () => {
  // The mirror-era fields session-init retires (dispatch_epoch,
  // last_edit_epoch_by_plane) are seeded with hostile values alongside failing
  // receipts: if anything on the gate-state path still consumed them, the
  // digest PASS below could not both override the receipts AND ignore the
  // epochs. Allowed stop = neither is read for gate state.
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  writeState(repo, {
    has_code_change: true,
    code_review: { passed: false },
    precommit: { passed: false },
    dispatch_epoch: 999999,
    last_edit_epoch_by_plane: { code: 999999, doc: 999999 },
  });
  const r = runHook(repo);
  assert.equal(r.status, 0, `epochs must not reach the gate decision: ${r.stdout} ${r.stderr}`);
  assert.equal(outJson(r).ok, true);
});

test('temporal: PASS appended, then an edit, then Stop — the old verdict cannot pay for the new tree', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  // Production shape: the edit-time hooks (still live through WB4) invalidate
  // the mirror receipts, and the check-time derivation independently refuses
  // the old-digest verdicts — the PASS in the log names a tree that no longer
  // exists.
  writeState(repo, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  fs.appendFileSync(path.join(repo, 'app.js'), '// edited after the verdict\n');
  const r = runHook(repo);
  assert.equal(r.status, 2, `the post-verdict edit must re-open the gate: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr + r.stdout, /codex-review-fast/);
});

test('WB5c flip: a post-verdict edit against a STALE mirror PASS blocks — edit re-opens with zero hook involvement', () => {
  // Same sequence but the mirror was never told about the edit (stale PASS).
  // Pre-flip the old-digest verdict counted as infrastructure absence and the
  // mirror stood (allowed). Post-flip the mirror is never consulted for
  // validity on a derivable tree, so the stale PASS is inert and the edit
  // re-opens the gate purely by shifting the digest — no edit-time hook needed.
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  writeState(repo, { has_code_change: true, code_review: { passed: true }, precommit: { passed: true, mode: 'full' } });
  fs.appendFileSync(path.join(repo, 'app.js'), '// edited after the verdict\n');
  const r = runHook(repo);
  assert.equal(r.status, 2, `the stale mirror PASS must not survive the post-verdict edit: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /no digest receipt closes code_review at the current tree/);
});

test('temporal: PASS appended, then an out-of-repo write, then Stop — still allowed', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  writeState(repo, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  // The memory-file incident class: a write OUTSIDE the repo root must not
  // shift any digest, so the verdicts above still name the current tree.
  fs.writeFileSync(path.join(tmpdir('sg-derive-outside-'), 'memory.md'), 'outside the repo\n');
  const r = runHook(repo);
  assert.equal(r.status, 0, `an out-of-repo write must not re-open gates: ${r.stdout} ${r.stderr}`);
  assert.equal(outJson(r).ok, true);
});

test('temporal: receipts, then git commit of the reviewed tree, then Stop — allowed', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  writeState(repo, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  // Committing the exact reviewed content empties the dirty set: nothing is
  // owed, and the content identity the verdicts bound to was not invalidated
  // by the commit (AC6 "git commit of an unchanged tree").
  execFileSync('git', ['add', '-A'], { cwd: repo, env: CLEAN_GIT_ENV });
  execFileSync('git', ['commit', '-q', '-m', 'land the reviewed change'], { cwd: repo, env: CLEAN_GIT_ENV });
  const r = runHook(repo);
  assert.equal(r.status, 0, `a committed clean tree owes nothing: ${r.stdout} ${r.stderr}`);
  assert.equal(outJson(r).ok, true);
});

// === WB5c round-2 pins (Codex P1/P2 fixes): derivation-unavailable git probe
// === + no-state-file promotion. The probe branch is entered by shimming node
// === to fail, so gate-derive (and the advisory sweep) become unavailable while
// === git, jq and grep keep working — the exact host the probe was written for.

function makeFailShim(names) {
  const bin = tmpdir('sg-derive-shim-');
  for (const n of names) {
    fs.writeFileSync(path.join(bin, n), '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(bin, n), 0o755);
  }
  return bin;
}

function shimPath(bin) {
  return `${bin}:${process.env.PATH}`;
}

test('probe: derivation unavailable + provably clean tree → nothing owed, stop allowed', () => {
  const repo = makeGitRepo();
  // Mirror claims pending work; the probe proves the tree clean, so nothing is owed.
  writeState(repo, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  const r = runHook(repo, { env: { PATH: shimPath(makeFailShim(['node'])) } });
  assert.equal(r.status, 0, `clean tree must owe nothing: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /tree provably clean, nothing owed/);
});

test('probe: derivation unavailable + dirty tree → receipts invalidated, blocked, source=git_probe', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  // Every mirror receipt reads PASS — the probe must invalidate them all, not trust them.
  writeState(repo, {
    has_code_change: true,
    has_doc_change: true,
    code_review: { passed: true },
    doc_review: { passed: true },
    precommit: { passed: true, mode: 'full' },
  });
  const r = runHook(repo, { env: { PATH: shimPath(makeFailShim(['node'])) } });
  assert.equal(r.status, 2, `a dirty tree with no derivation must fail closed: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /not provably clean — obligations forced on and receipts invalidated/);
  const fact = (r.stderr.match(/^\[AUTO_LOOP_STATE\] event=stop_attempt.*$/m) || [''])[0];
  assert.ok(fact, `stop_attempt fact line missing: ${r.stderr}`);
  assert.match(fact, / source=git_probe degraded=derive_unavailable/);
  assert.doesNotMatch(fact, /source=state_file/);
});

test('probe: ambient GIT_DIR/GIT_WORK_TREE redirect to a clean repo cannot fake a clean tree (env fence)', () => {
  const dirty = makeGitRepo();
  fs.appendFileSync(path.join(dirty, 'app.js'), '// dirty\n');
  const clean = makeGitRepo();
  writeState(dirty, {
    has_code_change: true,
    code_review: { passed: true },
    precommit: { passed: true, mode: 'full' },
  });
  // Codex round-1 exploit: without the GIT_* fence the probe resolves the
  // REDIRECTED repository (exit 0, empty porcelain) and a dirty workspace
  // reads as provably clean. The fence + `-C "$PWD"` must pin the real one.
  const r = runHook(dirty, {
    env: {
      PATH: shimPath(makeFailShim(['node'])),
      GIT_DIR: path.join(clean, '.git'),
      GIT_WORK_TREE: clean,
    },
  });
  assert.equal(r.status, 2, `the redirect must not buy a clean reading: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /not provably clean/);
});

test('probe: corrupt .git (rev-parse refuses, .git entry exists) → fail-closed, never not-a-repo', () => {
  const repo = makeGitRepo();
  writeState(repo, {
    has_code_change: true,
    code_review: { passed: true },
    precommit: { passed: true, mode: 'full' },
  });
  // Break the repository AFTER seeding: rev-parse now fails, but the .git
  // entry still proves a tree exists that this stop cannot verify.
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'garbage, not a ref\n');
  const r = runHook(repo, { env: { PATH: shimPath(makeFailShim(['node'])) } });
  assert.equal(r.status, 2, `a corrupt repo must not be classified not-a-repo: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /git cannot read the tree a \.git entry proves exists/);
});

test('probe: mktemp failure on a CLEAN tree still blocks — unverifiable is not clean', () => {
  const repo = makeGitRepo();
  writeState(repo, { has_code_change: true, code_review: { passed: true }, precommit: { passed: true, mode: 'full' } });
  // mktemp failing means the omission-warning channel cannot be captured, so
  // the probe cannot PROVE clean; _gd_fb_dirty stays unknown → fail closed.
  const r = runHook(repo, { env: { PATH: shimPath(makeFailShim(['node', 'mktemp'])) } });
  assert.equal(r.status, 2, `an uncapturable probe must fail closed: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /not provably clean/);
});

test('probe: rm failure after the capture is survivable — the verdict still lands (P2 fix)', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  writeState(repo, { has_code_change: true, code_review: { passed: true }, precommit: { passed: true, mode: 'full' } });
  // Pre-fix, a failing `rm -f` aborted the hook under `set -e` with a non-0/2
  // status — no JSON, which the harness reads as "no objection" (fail-open).
  const r = runHook(repo, { env: { PATH: shimPath(makeFailShim(['node', 'rm'])) } });
  assert.equal(r.status, 2, `rm failure must not kill the verdict: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /not provably clean/);
});

test('probe: unreadable untracked directory → not provably clean, blocked', (t) => {
  if (process.getuid && process.getuid() === 0) {
    t.skip('running as root: chmod 000 does not deny access');
    return;
  }
  const repo = makeGitRepo();
  writeState(repo, { has_code_change: true, code_review: { passed: true }, precommit: { passed: true, mode: 'full' } });
  const locked = path.join(repo, 'locked');
  fs.mkdirSync(locked);
  fs.writeFileSync(path.join(locked, 'hidden.js'), '// unreviewable\n');
  fs.chmodSync(locked, 0o000);
  try {
    const r = runHook(repo, { env: { PATH: shimPath(makeFailShim(['node'])) } });
    assert.equal(r.status, 2, `an unreadable subtree must never read as clean: ${r.stdout} ${r.stderr}`);
    assert.match(r.stderr, /not provably clean/);
  } finally {
    fs.chmodSync(locked, 0o755);
  }
});

// === P1-2 promotion pins: no state file no longer buys the transcript fallback ===

test('promotion: NO state file + dirty derivable tree → blocked from digest evidence, not the transcript', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  // No writeState. Pre-fix the whole derivation sat inside `[[ -f $STATE_FILE ]]`,
  // so this stop fell to the 500-line transcript scan — which sees no edits in a
  // fresh transcript and ALLOWS. Post-fix the derivation runs unconditionally and
  // its answer is promoted past the fallback.
  const r = runHook(repo);
  assert.equal(r.status, 2, `deleting the state file must not buy a weaker gate: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /no state file, but the gate derivation answered this stop/);
  assert.match(r.stderr, /no digest receipt closes code_review at the current tree/);
  const fact = (r.stderr.match(/^\[AUTO_LOOP_STATE\] event=stop_attempt.*$/m) || [''])[0];
  assert.ok(fact, `stop_attempt fact line missing: ${r.stderr}`);
  assert.match(fact, / source=digest /);
  assert.doesNotMatch(fact, /degraded=no_state_file/);
});

test('promotion: NO state file + digest receipts closing every owed plane → allowed', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const d = digestOf(repo, 'code');
  appendVerdict(repo, { plane: 'code_review', digest: d, verdict: 'pass' });
  appendVerdict(repo, { plane: 'precommit', digest: d, verdict: 'pass', mode: 'full' });
  const r = runHook(repo);
  assert.equal(r.status, 0, `digest-closed gates need no mirror at all: ${r.stdout} ${r.stderr}`);
  assert.equal(outJson(r).ok, true);
});

test('promotion: NO state file + clean tree → nothing owed, allowed (negative control)', () => {
  const repo = makeGitRepo();
  const r = runHook(repo);
  assert.equal(r.status, 0, `a clean tree owes nothing with or without a state file: ${r.stdout} ${r.stderr}`);
  assert.equal(outJson(r).ok, true);
});

test('promotion: NO state file + derivation unavailable + dirty tree → the probe answer is promoted', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const r = runHook(repo, { env: { PATH: shimPath(makeFailShim(['node'])) } });
  assert.equal(r.status, 2, `no state + no derivation + dirty must still block: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /no state file, but the gate derivation answered this stop/);
  const fact = (r.stderr.match(/^\[AUTO_LOOP_STATE\] event=stop_attempt.*$/m) || [''])[0];
  assert.ok(fact, `stop_attempt fact line missing: ${r.stderr}`);
  assert.match(fact, / source=git_probe degraded=derive_unavailable/);
});

test('promotion: NO state file outside any repo → legacy transcript fallback retained, allowed', () => {
  const dir = tmpdir('sg-derive-norepo-nostate-');
  // not-a-repo leaves _GD_ANSWERED false: there is no tree to gate, and the
  // legacy transcript scan (which sees no edits here) keeps its allow.
  const r = runHook(dir);
  assert.equal(r.status, 0, `not-a-repo with no state must keep the legacy allow: ${r.stdout} ${r.stderr}`);
  assert.equal(outJson(r).ok, true);
});

// === Round-3 pins (Codex round-2 P1/P2): fenced reconciliation, no-transcript
// === promotion, and containment-proved probe capture files.

test('recon fence: not-a-repo + mirror obligation + ambient redirect to a clean repo still blocks', () => {
  // Round-2 P1: the stale-git reconciliation arms ran UNFENCED, so with the mirror
  // holding has_code_change=true in a non-repo cwd, an ambient GIT_DIR/GIT_WORK_TREE
  // pointing at a clean repository produced an empty porcelain that downgraded the
  // obligation to false. Fenced + `-C "$PWD"`, git now FAILS in the non-repo cwd →
  // __GIT_UNAVAILABLE__ → flags kept → blocked.
  const dir = tmpdir('sg-derive-norepo-redirect-');
  const clean = makeGitRepo();
  writeState(dir, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  const r = runHook(dir, {
    env: { GIT_DIR: path.join(clean, '.git'), GIT_WORK_TREE: clean },
  });
  assert.equal(r.status, 2, `the redirect must not clear a mirror-held obligation: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /source=digest mirror_planes=/);
});

test('no state file + MISSING transcript + dirty derivable tree → derivation still answers, blocked', () => {
  // Round-2 P1: the missing-transcript early exit allowed the stop before the
  // derivation ever ran. Now it falls through with TRANSCRIPT="" and the digest
  // path answers.
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const r = spawnSync('bash', [hookPath], {
    cwd: repo,
    input: JSON.stringify({ session_id: 'sess-derive', transcript_path: path.join(repo, 'no-such-transcript.jsonl') }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(r.status, 2, `a deleted transcript must not skip the derivation: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /no digest receipt closes code_review at the current tree/);
});

test('no state file + MISSING transcript + dirty tree + derivation unavailable → probe answers, blocked', () => {
  const repo = makeGitRepo();
  fs.appendFileSync(path.join(repo, 'app.js'), '// dirty\n');
  const r = spawnSync('bash', [hookPath], {
    cwd: repo,
    input: JSON.stringify({ session_id: 'sess-derive', transcript_path: path.join(repo, 'no-such-transcript.jsonl') }),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: repo,
      STOP_GUARD_MODE: 'strict',
      PATH: shimPath(makeFailShim(['node'])),
    },
  });
  assert.equal(r.status, 2, `no transcript + no derivation + dirty must still block: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /not provably clean/);
});

test('no state file + MISSING transcript + clean tree → allowed (the old early-exit case, now answered)', () => {
  const repo = makeGitRepo();
  const r = spawnSync('bash', [hookPath], {
    cwd: repo,
    input: JSON.stringify({ session_id: 'sess-derive', transcript_path: path.join(repo, 'no-such-transcript.jsonl') }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(r.status, 0, `a clean tree owes nothing without a transcript: ${r.stdout} ${r.stderr}`);
  assert.equal(outJson(r).ok, true);
});

test('probe capture containment: TMPDIR inside the repo must not dirty the porcelain (clean → allowed)', () => {
  // Round-2 P2: a bare mktemp under an in-repo TMPDIR created the capture file
  // INSIDE the tree the probe reads — the probe dirtied its own porcelain and
  // blocked a clean repo on every Stop. The containment proof rejects the
  // in-repo candidate and falls back to /tmp, so the probe stays clean.
  const repo = makeGitRepo();
  const inRepoTmp = path.join(repo, '.tmp-inside');
  fs.mkdirSync(inRepoTmp);
  // TRACKED-clean, deliberately NOT ignored (round-3 P2: an info/exclude entry
  // for the whole directory also hides the planted capture file, so the pre-fix
  // bare mktemp passed this test too). Committed with a .gitkeep, the directory
  // itself is clean and the ONLY possible dirt is a capture file the probe
  // plants — pre-fix that reads `?? .tmp-inside/sg-probe-err.*` and blocks.
  fs.writeFileSync(path.join(inRepoTmp, '.gitkeep'), '');
  execFileSync('git', ['add', '-A'], { cwd: repo, env: CLEAN_GIT_ENV });
  execFileSync('git', ['commit', '-q', '-m', 'track tmp dir'], { cwd: repo, env: CLEAN_GIT_ENV });
  writeState(repo, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  const r = runHook(repo, {
    env: { PATH: shimPath(makeFailShim(['node'])), TMPDIR: inRepoTmp },
  });
  assert.equal(r.status, 0, `the capture file must not dirty the probe's own reading: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /tree provably clean/);
  const leftovers = fs.readdirSync(inRepoTmp).filter((n) => n.startsWith('sg-probe-err.'));
  assert.deepEqual(leftovers, [], 'no capture file may be created inside the repo');
});

test('probe capture containment: TMPDIR symlinked INTO the repo is rejected on resolved paths', () => {
  const repo = makeGitRepo();
  const inRepoTmp = path.join(repo, '.tmp-inside');
  fs.mkdirSync(inRepoTmp);
  // Tracked-clean, not ignored — same reasoning as the fixture above.
  fs.writeFileSync(path.join(inRepoTmp, '.gitkeep'), '');
  execFileSync('git', ['add', '-A'], { cwd: repo, env: CLEAN_GIT_ENV });
  execFileSync('git', ['commit', '-q', '-m', 'track tmp dir'], { cwd: repo, env: CLEAN_GIT_ENV });
  const outside = tmpdir('sg-derive-symlink-tmp-');
  const link = path.join(outside, 'link-into-repo');
  fs.symlinkSync(inRepoTmp, link);
  writeState(repo, { has_code_change: true, code_review: { passed: false }, precommit: { passed: false } });
  const r = runHook(repo, {
    env: { PATH: shimPath(makeFailShim(['node'])), TMPDIR: link },
  });
  assert.equal(r.status, 0, `a lexically-outside TMPDIR resolving into the repo must be rejected: ${r.stdout} ${r.stderr}`);
  const leftovers = fs.readdirSync(inRepoTmp).filter((n) => n.startsWith('sg-probe-err.'));
  assert.deepEqual(leftovers, [], 'no capture file may reach the repo through the symlink');
});

test('probe capture containment: SUBDIRECTORY cwd — a repo-local TMPDIR outside the cwd is still rejected', () => {
  // Round-3 P2: the boundary must be the physical worktree ROOT. With the hook
  // cwd at repo/packages/app and TMPDIR=repo/.tmp (tracked, clean), a $PWD-based
  // proof accepted the candidate and the capture file dirtied the tree — the
  // probe blocked a clean repo forever. Root-bounded, the candidate is rejected,
  // /tmp takes over, and the clean tree allows.
  const repo = makeGitRepo();
  const sub = path.join(repo, 'packages', 'app');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'index.js'), 'module.exports = 1;\n');
  const inRepoTmp = path.join(repo, '.tmp');
  fs.mkdirSync(inRepoTmp);
  fs.writeFileSync(path.join(inRepoTmp, '.gitkeep'), '');
  execFileSync('git', ['add', '-A'], { cwd: repo, env: CLEAN_GIT_ENV });
  execFileSync('git', ['commit', '-q', '-m', 'subdir + tracked tmp'], { cwd: repo, env: CLEAN_GIT_ENV });
  const transcript = makeTranscript(tmpdir('sg-derive-subdir-t-'));
  const r = spawnSync('bash', [hookPath], {
    cwd: sub,
    input: JSON.stringify({ session_id: 'sess-derive', transcript_path: transcript }),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: repo,
      STOP_GUARD_MODE: 'strict',
      PATH: shimPath(makeFailShim(['node'])),
      TMPDIR: inRepoTmp,
    },
  });
  assert.equal(r.status, 0, `a clean tree must stay clean from a subdirectory cwd: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /tree provably clean/);
  const leftovers = fs.readdirSync(inRepoTmp).filter((n) => n.startsWith('sg-probe-err.'));
  assert.deepEqual(leftovers, [], 'no capture file may land in the repo-local TMPDIR');
});
