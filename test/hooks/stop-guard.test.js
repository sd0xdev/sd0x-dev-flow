const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
  existsSync,
  symlinkSync,
  readFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
// Honest skip for the real-git localized-warning tests below: on a host without zh_TW.UTF-8 the
// ambient zh-TW env has no effect, so those tests would pass whether or not the LC_ALL=C fix is
// present (false confidence). The host-independent guard for the same reconciliation logic lives in
// the advisory-sibling stub-git tests (see helpers/reconciliation-locale.js).
const {
  SKIP_NO_ZH_TW,
  AMBIENT_NON_C_ENV,
  setupLocaleAwareGitBin,
  writePendingState,
} = require('./helpers/reconciliation-locale');

const hookPath = resolve(__dirname, '../../hooks/stop-guard.sh');
const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function setupStubBin() {
  const binDir = makeTempDir('sd0x-stop-guard-bin-');
  const stubJq = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
let query;
let file;
const vars = {};
let hasExitFlag = false;
let hasSlurpFlag = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-r') continue;
  if (arg === '-e') { hasExitFlag = true; continue; }
  if (arg === '-s') { hasSlurpFlag = true; continue; }
  if (arg === '--arg') {
    vars[args[i + 1]] = args[i + 2];
    i += 2;
    continue;
  }
  if (arg === '--argjson') {
    const key = args[i + 1];
    const val = args[i + 2];
    try {
      vars[key] = JSON.parse(val);
    } catch {
      if (val === 'true') vars[key] = true;
      else if (val === 'false') vars[key] = false;
      else vars[key] = val;
    }
    i += 2;
    continue;
  }
  if (!query) {
    query = arg;
    continue;
  }
  if (!file) {
    file = arg;
    continue;
  }
}
let input = '';
try {
  input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
} catch {}
let data = {};
try {
  data = input ? JSON.parse(input) : {};
} catch {}

// Emulate the hook's scalar-type validation filter (Codex iter-14 P2). Real jq exits 0 when every
// PRESENT scalar has its expected type (has_*_change / *.passed boolean, review_phase string; null or
// absent is ok) and exits 1 (outputs "false" under -e) on any mismatch. A non-object nested parent is
// SKIPPED (returns true) so it stays fail-closed via the dedicated nested reads instead. This branch
// is placed FIRST so its \`.has_code_change\` / \`.code_review.passed\` substrings are not captured by
// the field-read branches below; its no-space \`type=="object"\` also does not collide with the spaced
// \`type == "object"\` object-guard. Matched by the unique \`def _tv(\` token.
if (query && query.includes('def _tv(')) {
  // Stream-aware for the same reason as the object guard below: real jq evaluates this filter
  // once PER top-level value and \`-e\` takes its status from the LAST one, so a 2-object stream
  // PASSES here. If this branch instead threw on the multi-value input, the multi-value
  // regression test would pass pre-fix (blocked by the wrong guard) and prove nothing.
  const streamVals = parseJqStream(input);
  if (streamVals === null || streamVals.length === 0) process.exit(2);
  const parsed = streamVals[streamVals.length - 1];
  // Real jq raises an index error (exit 5) when a string key indexes a non-object top-level value;
  // the hook only calls this after the object guard, so this path is defensive, mirroring real jq.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) process.exit(5);
  const okScalar = (v, t) =>
    v === undefined || v === null || (t === 'boolean' ? typeof v === 'boolean' : typeof v === 'string');
  const isObj = (x) => x !== undefined && x !== null && typeof x === 'object' && !Array.isArray(x);
  const nestedOk = (parent) => (isObj(parent) ? okScalar(parent.passed, 'boolean') : true);
  // .precommit additionally carries a string \`mode\` (full/fast). Gated on the production filter
  // text so the stub follows the hook rather than substituting for it — drop the clause from
  // stop-guard.sh and this validation stops happening here too.
  const precommitOk = (parent) =>
    nestedOk(parent) &&
    (isObj(parent) && query.includes('.precommit.mode|_tv("string")') ? okScalar(parent.mode, 'string') : true);
  // aggregate_gate (dual mode): .executed boolean + .gate string, guarded by object parent.
  const aggOk = (agg) => (isObj(agg) ? okScalar(agg.executed, 'boolean') && okScalar(agg.gate, 'string') : true);
  const valid =
    okScalar(parsed.has_code_change, 'boolean') &&
    okScalar(parsed.has_doc_change, 'boolean') &&
    okScalar(parsed.review_phase, 'string') &&
    okScalar(parsed.review_mode, 'string') &&
    nestedOk(parsed.code_review) &&
    nestedOk(parsed.doc_review) &&
    precommitOk(parsed.precommit) &&
    aggOk(parsed.aggregate_gate);
  process.stdout.write(valid ? 'true' : 'false');
  process.exit(hasExitFlag ? (valid ? 0 : 1) : 0);
}

// Emulate real jq's parse-only mode: \`jq empty\` reads the input, validates it as
// JSON, prints nothing, and exits non-zero on a parse error. The hook uses this to
// detect an unparseable state file and fail closed, so the stub must NOT swallow the
// error the way the generic \`data\` parse above does. CRITICAL: real jq treats EMPTY /
// whitespace-only input as zero JSON values and exits 0 (NOT an error) — the stub must
// too, otherwise the empty-state fail-open the hook now guards against can't be reproduced.
if (query === 'empty') {
  if (input.trim() === '') process.exit(0);
  try {
    JSON.parse(input);
  } catch {
    process.exit(2);
  }
  process.exit(0);
}

// Emulate real \`jq -e 'type == "object"'\` — the corrupt-state guard uses it to force
// strict on any NON-object state. A parse error exits non-zero (unparseable); a valid
// object outputs \`true\` and exits 0; a valid non-object (false/123/[]/"s"/null) outputs
// \`false\` and exits 1 under -e, so \`! jq -e ...\` flips it to corrupt. Without this the
// stub would fall through and the non-object fail-open regression couldn't be reproduced.
// jq reads its input as a STREAM of top-level values, not a single document. This stub must
// model that or the multi-value fail-open below is untestable: a plain JSON.parse throws on
// \`{...}\\n{...}\`, which would make the stub reject the very input real jq ACCEPTS.
// Simplification (honest about being a stub): one value per whole-text parse, else one value
// per non-empty LINE — which is the corruption shape that actually occurs (a concurrent
// double-write or an interrupted \`mv\` concatenating two states). Returns null on real garbage.
function parseJqStream(text) {
  if (text.trim() === '') return [];
  try {
    return [JSON.parse(text)];
  } catch {}
  const vals = [];
  for (const line of text.split('\\n')) {
    if (line.trim() === '') continue;
    try {
      vals.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  return vals.length ? vals : null;
}

// Matched on \`== "object"\` (spaced), NOT \`type == "object"\`: the slurped filter reads
// \`(.[0]|type) == "object"\`, so a \`)\` sits between the two tokens. The \`def _tv(\` filter's
// \`(.code_review|type)=="object"\` is UNSPACED and is handled by its own branch above, so
// there is no collision.
if (query && query.includes('== "object"')) {
  const vals = parseJqStream(input);
  if (vals === null) process.exit(2);
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  let ok;
  // Both the flag AND the filter text, so the stub tracks production exactly: real jq only
  // slurps when BOTH are present.
  if (hasSlurpFlag && query.includes('length == 1')) {
    // Slurped form (\`-s\`): the whole stream becomes ONE array, so a 2-value stream has
    // length 2 and is rejected. Gated on the production filter text, NOT assumed — revert
    // stop-guard.sh to the unslurped filter and this stub reverts with it, so the
    // multi-value regression test genuinely fails instead of passing on stub behaviour.
    ok = vals.length === 1 && isObject(vals[0]);
  } else {
    // Unslurped form: jq evaluates the filter once PER VALUE and \`-e\` takes its exit
    // status from the LAST output — which is exactly the hole (a trailing object launders
    // everything before it).
    ok = vals.length > 0 && isObject(vals[vals.length - 1]);
  }
  process.stdout.write(ok ? 'true' : 'false');
  process.exit(hasExitFlag ? (ok ? 0 : 1) : 0);
}

function asBoolString(val) {
  return val === true || val === 'true' ? 'true' : 'false';
}

function outputValue(val) {
  if (val === undefined || val === null) {
    process.stdout.write('');
    return;
  }
  if (typeof val === 'string') {
    process.stdout.write(val);
    return;
  }
  if (typeof val === 'boolean') {
    process.stdout.write(asBoolString(val));
    return;
  }
  process.stdout.write(JSON.stringify(val));
}

// Emulate real jq's runtime error when a string key indexes a NON-object, NON-null value
// (Cannot index string/number/boolean/array with "...", exit 5). A null/absent parent reads
// as null via the ".field // false" fallback (safe, exit 0); only a present non-object parent
// errors. Without this the stub returns 'false' for a nested read like
// {"code_review":"oops"}.passed, masking the exit-5 fail-open that the hook's
// "2>/dev/null || echo false" guard exists to close — the regression test would be tautological.
function indexErrorIfNonObject(parent) {
  if (parent !== undefined && parent !== null && (typeof parent !== 'object' || Array.isArray(parent))) {
    process.exit(5);
  }
}

// NOT IMPLEMENTED, deliberately: the verdict-WRITER query (the one carrying .[$key]) belongs to
// post-tool-review-state.sh. stop-guard.sh reads state and never writes a verdict -- grepping
// hooks/stop-guard.sh for that token returns nothing -- so this stub branch was unreachable for
// the system under test. Verified by deletion: all 157 tests still passed with the branch gone.
//
// It was worse than merely dead. It carried a hand-copied re-implementation of the convergence
// reset that had ALREADY drifted from its twin in post-tool-review-state.test.js (it still
// implemented the cross-plane doc_review reset removed from production on 2026-07-25, and it never
// grew the mode write the twin has). A dead copy that silently disagrees with production is a trap
// for the next reader, not a safety net.
//
// If stop-guard ever does start writing verdicts, add the branch back HERE and pin its semantics in
// test/hooks/jq-filter-fidelity.test.js under real jq -- do not hand-copy the twin again.
const vulnMatch = query && query.match(/\.metadata\.vulnerabilities\.(critical|high|moderate|low)/);
if (vulnMatch) {
  const key = vulnMatch[1];
  const val = (((data || {}).metadata || {}).vulnerabilities || {})[key] ?? 0;
  process.stdout.write(String(val));
  process.exit(0);
}

if (query && query.includes('.data.advisory')) {
  const advisory = (data && data.data && data.data.advisory) || {};
  let val = 'Unknown';
  if (query.includes('.data.advisory.title')) val = advisory.title || 'Unknown';
  if (query.includes('.data.advisory.severity')) val = advisory.severity || 'unknown';
  if (query.includes('.data.advisory.module_name')) val = advisory.module_name || 'unknown';
  if (query.includes('.data.advisory.url')) val = advisory.url || '';
  process.stdout.write(String(val));
  process.exit(0);
}

if (query && query.includes('.stop_hook_active')) {
  outputValue(asBoolString(data.stop_hook_active));
  process.exit(0);
}
if (query && query.includes('.transcript_path')) {
  outputValue(data.transcript_path ?? '');
  process.exit(0);
}
if (query && query.includes('.tool_name')) {
  outputValue(data.tool_name ?? '');
  process.exit(0);
}
if (query && query.includes('.tool_input')) {
  outputValue(data.tool_input ?? '');
  process.exit(0);
}
if (query && query.includes('.tool_output')) {
  outputValue(data.tool_output ?? '');
  process.exit(0);
}
if (query && query.includes('.command')) {
  outputValue(data.command ?? '');
  process.exit(0);
}

// \`.review_phase\` is the one state field copied VERBATIM into the MISSING hint (stop-guard.sh:601),
// so it is the live path for hostile state text reaching the printf-built verdict JSON. Without this
// branch the stub returned empty, the hint was skipped, and any sanitizer test was tautological.
// Checked before \`.review_mode\` only for locality — the two substrings do not overlap.
if (query && query.includes('.review_phase')) {
  const rp = data.review_phase;
  outputValue(typeof rp === 'string' && rp !== '' ? rp : 'idle');
  process.exit(0);
}

// Dual-mode fields
if (query && query.includes('.review_mode')) {
  outputValue(data.review_mode || 'single');
  process.exit(0);
}
if (query && query.includes('.aggregate_gate.executed')) {
  indexErrorIfNonObject(data.aggregate_gate);
  const agg = data.aggregate_gate || {};
  outputValue(asBoolString(agg.executed));
  process.exit(0);
}
if (query && query.includes('.aggregate_gate.gate')) {
  indexErrorIfNonObject(data.aggregate_gate);
  const agg = data.aggregate_gate || {};
  outputValue(agg.gate != null ? agg.gate : '');
  process.exit(0);
}

if (query && query.includes('.code_review.passed')) {
  indexErrorIfNonObject(data.code_review);
  outputValue(asBoolString(data.code_review && data.code_review.passed));
  process.exit(0);
}
if (query && query.includes('.doc_review.passed')) {
  indexErrorIfNonObject(data.doc_review);
  outputValue(asBoolString(data.doc_review && data.doc_review.passed));
  process.exit(0);
}
// Which precommit variant produced the verdict. Placed BEFORE the .passed branch so the distinct
// query is not shadowed; \`// ""\` falls back only on null/false, so an absent mode reads as empty.
if (query && query.includes('.precommit.mode')) {
  indexErrorIfNonObject(data.precommit);
  const m = data.precommit && data.precommit.mode;
  process.stdout.write(typeof m === 'string' ? m : '');
  process.exit(0);
}
if (query && query.includes('.precommit.passed')) {
  indexErrorIfNonObject(data.precommit);
  outputValue(asBoolString(data.precommit && data.precommit.passed));
  process.exit(0);
}
if (query && query.includes('.has_code_change')) {
  outputValue(asBoolString(data.has_code_change));
  process.exit(0);
}
if (query && query.includes('.has_doc_change')) {
  outputValue(asBoolString(data.has_doc_change));
  process.exit(0);
}

// Plan-review pending advisory (warn-only): boolean over plan_review flags
// needs-human is terminal (user arbitrating), not pending — mirrors the hook query
if (query && query.includes('.plan_review.executed')) {
  const pr = data.plan_review || {};
  const pending = pr.executed === true && pr.passed !== true && pr.degraded !== true
    && pr.skipped !== true && (pr.status_reason || '') !== 'needs-human';
  process.stdout.write(pending ? 'true' : 'false');
  process.exit(0);
}

// Handle contains query (arbitration guard): jq -e '.. | strings | select(contains("X"))'
if (query && query.includes('contains(')) {
  const m = query.match(/contains\\("([^"]+)"\\)/);
  if (m) {
    const needle = m[1];
    function findStrings(obj) {
      if (typeof obj === 'string') return [obj];
      if (Array.isArray(obj)) return obj.flatMap(findStrings);
      if (obj && typeof obj === 'object') return Object.values(obj).flatMap(findStrings);
      return [];
    }
    const allStrings = findStrings(data);
    const matched = allStrings.filter(s => s.includes(needle));
    if (matched.length > 0) {
      process.stdout.write(matched.map(s => JSON.stringify(s)).join('\\n'));
      process.exit(0);
    }
    if (hasExitFlag) process.exit(1);
    process.stdout.write('null');
    process.exit(0);
  }
}

// Bounded-integer validation of the iteration counters, done INSIDE jq so no untrusted string
// ever reaches bash arithmetic. Mirrors the hook filter: a non-object parent, a non-integer, or an
// out-of-range magnitude all collapse to the literal "corrupt"; otherwise "<round> <max>".
// MUST precede the single-field branches below — this query also mentions them.
if (query && query.includes('.iteration_history as $ih')) {
  const raw = data && typeof data === 'object' ? data.iteration_history : undefined;
  // null/absent ONLY takes the defaults path. A boolean false must NOT: jq's alternative operator
  // would have swallowed it, which is exactly the hole the production filter was rewritten to close.
  const norm = raw === undefined || raw === null ? {} : raw;
  const isObj = norm !== null && typeof norm === 'object' && !Array.isArray(norm);
  if (!isObj) {
    process.stdout.write('corrupt');
    process.exit(0);
  }
  const pick = (v, d) => (v === undefined || v === null ? d : v);
  const r = pick(norm.current_round, 0);
  const m = pick(norm.max_rounds, 30);
  const bad =
    typeof r !== 'number' || typeof m !== 'number' ||
    !Number.isInteger(r) || !Number.isInteger(m) ||
    r < 0 || r > 100000 || m < 1 || m > 100000;
  // Clamp mirrors the production filter: max_rounds outside the producer's 3..50 contract is
  // capped rather than trusted, so a tampered 100000 cannot disarm the round cap. Kept in sync
  // with hooks/stop-guard.sh — and independently pinned against REAL jq by
  // test/hooks/jq-filter-fidelity.test.js, which is what stops this stub from silently enforcing
  // a rule production no longer has.
  const clamped = m < 3 ? 3 : m > 50 ? 50 : m;
  process.stdout.write(bad ? 'corrupt' : r + ' ' + clamped);
  process.exit(0);
}

// Handle iteration_history fields (schema v2)
if (query && query.includes('iteration_history.current_round')) {
  const ih = data.iteration_history || {};
  outputValue(String(ih.current_round != null ? ih.current_round : 0));
  process.exit(0);
}
if (query && query.includes('iteration_history.max_rounds')) {
  const ih = data.iteration_history || {};
  outputValue(String(ih.max_rounds != null ? ih.max_rounds : 30));
  process.exit(0);
}

// Handle env.STOP_GUARD_MODE // hooks_config.stop_guard_mode (mode resolution)
if (query && (query.includes('env.STOP_GUARD_MODE') || query.includes('hooks_config.stop_guard_mode'))) {
  const envVal = (data.env && data.env.STOP_GUARD_MODE) || '';
  const legacyVal = (data.hooks_config && data.hooks_config.stop_guard_mode) || '';
  process.stdout.write(envVal || legacyVal);
  process.exit(0);
}

// Issue #10: the open-gate filter over \`background_reviews\`. Reproduced faithfully — including
// the per-plane "still open" selection — because that filter IS the behaviour under test: a stub
// that returned every entry would make the "falls silent once the gate passes" test pass without
// the hook doing any filtering at all.
if (query && query.includes('.background_reviews')) {
  const entries = Array.isArray(data.background_reviews) ? data.background_reviews : [];
  const open = entries.filter(e =>
    (e.plane === 'doc' && vars.doc !== 'true') || (e.plane === 'code' && vars.code !== 'true'));
  const seen = [];
  for (const e of open) {
    const label = e.plane + ' (task ' + e.task + ')';
    if (!seen.includes(label)) seen.push(label);
  }
  process.stdout.write(seen.join(', '));
  process.exit(0);
}

process.stdout.write('');
`;
  writeExecutable(join(binDir, 'jq'), stubJq);
  return binDir;
}

function runHook({ cwd, binDir, input, env = {} }) {
  // Strip inherited STOP_GUARD_MODE to isolate tests from host session config.
  // Tests that need strict mode set it explicitly via env parameter.
  const { STOP_GUARD_MODE: _dropped, ...cleanEnv } = process.env;
  return spawnSync('bash', [hookPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...cleanEnv,
      PATH: `${binDir}:${process.env.PATH}`,
      CLAUDE_PROJECT_DIR: cwd,
      ...env,
    },
  });
}

function parseJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    return {};
  }
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HOOK_BYPASS=1 allows stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: join(workDir, 'missing.json') },
    env: { HOOK_BYPASS: '1' },
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('missing transcript allows stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-missing-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: join(workDir, 'nope.json') },
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('state file strict: code change review not passed blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-state-code-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: true },
      doc_review: { passed: true },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('state file strict: doc change review not passed blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-state-doc-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: true,
      doc_review: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('state file mode: all passed allows stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-state-pass-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('state file warn: code change review not passed allows stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-state-warn-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: true },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('transcript strict: edit without review blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-transcript-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}\n';
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('transcript mode: blocked then pass allows stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-transcript-pass-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: \u26d4',
    // The superseding PASS is a re-review, and precommit reports through its OWN sentinel
    // (`## Overall:`, per the Standard Gate Sentinels table) — `## Gate: ✅` never appears as a
    // precommit verdict in production, and the gate now requires the real one.
    'user: /codex-review-fast',
    '## Gate: \u2705',
    'user: /precommit',
    '## Overall: \u2705 PASS',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

// The transcript fallback used to ask only "does the command TEXT appear?". Command text appears
// for reasons that prove nothing ran: a plan listing the step, a message quoting the workflow table
// out of CLAUDE.md, or an invocation that died before emitting its gate. The separate verdict check
// could not save it either — it sets BLOCKED_REASON on an explicit ⛔ only, and an ABSENT verdict
// is not a ⛔. So "I'll run /codex-review-fast and /precommit next" satisfied both gates.
test('transcript strict: commands MENTIONED but no verdict emitted → blocked (invoked ≠ passed)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-transcript-noverdict-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'assistant: Next I will run /codex-review-fast and then /precommit.',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'naming the commands must not satisfy the gate');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  // `reason` is the generic headline; the per-step detail the model must act on is in
  // `description` (the same field that carries the MISSING list on every other blocked path).
  assert.match(payload.description || '', /codex-review-fast\(invoked, no verdict\)/);
  assert.match(payload.description || '', /precommit\(invoked, no verdict\)/);
});

test('transcript strict: review verdict present but precommit produced NO ## Overall → blocked', () => {
  // Half-proven is not proven: the review plane reported, the precommit plane did not. The old
  // code allowed this because `## Overall:` was consulted only to find a FAIL.
  const workDir = makeTempDir('sd0x-stop-guard-transcript-nopcverdict-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: \u2705',
    'user: /precommit',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  assert.match(parseJson(result.stdout).description || '', /precommit\(invoked, no verdict\)/);
});

test('transcript strict: a doc review MENTIONED without a verdict → blocked', () => {
  const workDir = makeTempDir('sd0x-stop-guard-transcript-docnoverdict-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"docs/readme.md"}}',
    'assistant: running /codex-review-doc now',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  assert.match(parseJson(result.stdout).description || '', /codex-review-doc\(invoked, no verdict\)/);
});

test('transcript strict: review blocked without subsequent pass blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-blocked-strict-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: \u26d4',
    'user: /precommit',
    '## Overall: \u26d4 FAIL',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason, /Review not passed/);
});

test('transcript warn: review blocked without subsequent pass allows', () => {
  const workDir = makeTempDir('sd0x-stop-guard-blocked-warn-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: \u26d4',
    'user: /precommit',
    '## Overall: \u26d4 FAIL',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

// =============================================================================
// Qualified (namespaced) command tests — /sd0x-dev-flow:command in transcript
// =============================================================================

test('transcript: qualified /sd0x-dev-flow:codex-review-fast detected', () => {
  const workDir = makeTempDir('sd0x-stop-guard-qual-review-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /sd0x-dev-flow:codex-review-fast',
    '## Gate: \u2705',
    'user: /sd0x-dev-flow:precommit',
    '## Overall: \u2705 PASS',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'qualified commands should be detected in transcript');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('transcript: qualified /sd0x-dev-flow:codex-review-doc detected for doc change', () => {
  const workDir = makeTempDir('sd0x-stop-guard-qual-doc-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"docs/guide.md"}}',
    'user: /sd0x-dev-flow:codex-review-doc',
    '\u2705 Mergeable',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'qualified doc review should be detected');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('transcript: qualified /sd0x-dev-flow:precommit FAIL blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-qual-pre-fail-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /sd0x-dev-flow:codex-review-fast',
    '## Gate: \u2705',
    'user: /sd0x-dev-flow:precommit',
    '## Overall: \u26d4 FAIL',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'qualified precommit FAIL should block');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason, /Precommit not passed/);
});

// =============================================================================
// Regression: code change + only doc review must still block
// =============================================================================

test('transcript: code change with only /codex-review-doc still requires code review', () => {
  const workDir = makeTempDir('sd0x-stop-guard-doc-review-code-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-doc',
    '\u2705 Mergeable',
    'user: /precommit',
    '## Overall: \u2705 PASS',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'code change with only doc review should block');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.description, /codex-review-fast/, 'should specifically require code review');
});

// =============================================================================
// Review sentinel recency (last verdict wins)
// =============================================================================

test('review sentinel: ⛔ Needs revision then ✅ Mergeable allows (last wins)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-rev-fail-pass-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  // A DOC edit and a DOC review, so the doc-plane sentinels below are the verdicts that plane
  // actually emits. This fixture used to edit `src/app.ts` and invoke `/codex-review-fast` while
  // supplying `⛔ Needs revision` / `✅ Mergeable` — doc verdicts standing in for a code review —
  // which is precisely the cross-plane conflation the per-plane split closes. Reading it as a
  // passing code gate was the bug, not the intent: the "last wins" behavior under test is about
  // recency within ONE plane.
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"docs/readme.md"}}',
    'user: /codex-review-doc',
    '⛔ Needs revision',
    'user: /codex-review-doc',
    '✅ Mergeable',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'should allow stop when last review verdict is pass');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('review sentinel: ✅ Ready then ⛔ Blocked blocks (last wins)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-rev-pass-fail-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '✅ Ready',
    'user: /codex-review-fast',
    '⛔ Blocked',
    'user: /precommit',
    '## Overall: ✅ PASS',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'should block when last review verdict is fail');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason, /Review not passed/);
});

test('review sentinel: a NON-canonical ⛔ spelling still blocks, via the unmet gate rather than the verdict', () => {
  // The fixture above used to say `⛔ Block`. That is not the sentinel rules/auto-loop.md defines
  // (`⛔ Blocked`), and the two scans that read it disagree on purpose: the coarse plane-agnostic
  // BLOCKED_REASON scan is loose (`⛔.*Block`) so odd spellings still stop a session, while the
  // per-plane "did this review report?" scan is strict so only a documented sentinel counts as
  // evidence. Pinning the loose spelling to the strict scan's error message made the asymmetry
  // look like a passing invariant. It blocks either way — this records WHICH way, so a future
  // change to either scan is visible instead of silently swapping one reason for the other.
  const workDir = makeTempDir('sd0x-stop-guard-rev-noncanon-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(transcriptPath, [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '✅ Ready',
    'user: /codex-review-fast',
    '⛔ Block',
    'user: /precommit',
    '## Overall: ✅ PASS',
  ].join('\n'));
  const result = runHook({
    cwd: workDir, binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'a non-canonical ⛔ must still stop the session');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(
    payload.description, /codex-review-fast\(invoked, no verdict\)/,
    'the newer invocation emitted nothing the per-plane scan recognises, and the older ✅ Ready '
      + 'no longer covers it'
  );
});

// =============================================================================
// D2: Precommit result check in transcript fallback
// =============================================================================

test('D2: transcript precommit FAIL blocks stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-d2-fail-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: \u2705',
    'user: /precommit',
    '## Overall: \u26d4 FAIL',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason, /Precommit not passed/);
});

test('D2: transcript precommit PASS does not block', () => {
  const workDir = makeTempDir('sd0x-stop-guard-d2-pass-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: \u2705',
    'user: /precommit',
    '## Overall: \u2705 PASS',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

// =============================================================================
// N2: Transcript fallback sentinel variants
// =============================================================================

test('N2: transcript ⛔ Must fix detected as blocked', () => {
  const workDir = makeTempDir('sd0x-stop-guard-n2-must-fix-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '\u26d4 Must fix',
    'user: /precommit',
    '## Overall: \u2705 PASS',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason, /Review not passed/);
});

// =============================================================================
// D2-extra: Mixed-order PASS then FAIL (last result wins)
// =============================================================================

test('D2: transcript precommit PASS then FAIL blocks (last result wins)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-d2-pass-fail-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: \u2705',
    'user: /precommit',
    '## Overall: \u2705 PASS',
    'user: /precommit',
    '## Overall: \u26d4 FAIL',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason, /Precommit not passed/);
});

test('D2: transcript precommit FAIL then PASS then FAIL blocks (last wins)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-d2-fpf-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: \u2705',
    'user: /precommit',
    '## Overall: \u26d4 FAIL',
    'user: /precommit',
    '## Overall: \u2705 PASS',
    'user: /precommit',
    '## Overall: \u26d4 FAIL',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason, /Precommit not passed/);
});

// =============================================================================
// N3: .mdx detection in transcript fallback
// =============================================================================

test('N3: transcript .mdx edit detected as doc change', () => {
  const workDir = makeTempDir('sd0x-stop-guard-n3-mdx-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = '{"tool_name":"Edit","tool_input":{"path":"docs/guide.mdx"}}\n';
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'should block stop when .mdx edited without review');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.description.includes('/codex-review-doc'), 'should require doc review for .mdx');
});

test('N2: transcript ⛔ Needs revision detected as blocked', () => {
  const workDir = makeTempDir('sd0x-stop-guard-n2-needs-rev-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  // A DOC edit + doc review, so `\u26d4 Needs revision` is the sentinel that plane really emits.
  // (Previously a code edit + `/codex-review-fast`, which made a doc verdict decide a code gate.)
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"docs/readme.md"}}',
    'user: /codex-review-doc',
    '\u26d4 Needs revision',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason, /Review not passed/);
});

// --- Transcript fallback: a verdict may only satisfy its OWN plane ---

test('transcript: a DOC pass does NOT satisfy a code review that reported nothing', () => {
  // The fail-open the per-plane split closes. `/codex-review-fast` appears in the transcript, so
  // the "was it invoked?" test is satisfied; it then errored before emitting any verdict. A doc
  // review passes afterwards. Under the shared REVIEW_PASSED/REVIEW_BLOCKED pair the code branch
  // saw a non-empty "a verdict exists" signal \u2014 the DOC one \u2014 emitted no MISSING, and the
  // per-plane BLOCKED scan found no code sentinel to block on. Stop was allowed with the code
  // review having reported nothing at all.
  const workDir = makeTempDir('sd0x-stop-guard-crossplane-code-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(
    transcriptPath,
    [
      '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
      '{"tool_name":"Edit","tool_input":{"path":"docs/readme.md"}}',
      'user: /codex-review-fast',
      '(reviewer crashed before emitting a gate)',
      'user: /codex-review-doc',
      '\u2705 Mergeable',
      'user: /precommit',
      '## Overall: \u2705 PASS',
    ].join('\n')
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'a code review with no code verdict must not be satisfied by a doc pass');
  assert.equal(parseJson(result.stdout).ok, false);
  // The named step is in the operator-facing stderr; `reason` carries the generic headline.
  assert.match(result.stderr, /codex-review-fast\(invoked, no verdict\)/);
  assert.doesNotMatch(result.stderr, /codex-review-doc\(invoked, no verdict\)/, 'the doc plane DID report');
});

test('transcript: a CODE pass does NOT satisfy a doc review that reported nothing', () => {
  // The mirror direction \u2014 the split has to hold both ways, or it just moves the hole.
  const workDir = makeTempDir('sd0x-stop-guard-crossplane-doc-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(
    transcriptPath,
    [
      '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
      '{"tool_name":"Edit","tool_input":{"path":"docs/readme.md"}}',
      'user: /codex-review-fast',
      '\u2705 Ready',
      'user: /codex-review-doc',
      '(doc reviewer produced no gate)',
      'user: /precommit',
      '## Overall: \u2705 PASS',
    ].join('\n')
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'a doc review with no doc verdict must not be satisfied by a code pass');
  assert.equal(parseJson(result.stdout).ok, false);
  assert.match(result.stderr, /codex-review-doc\(invoked, no verdict\)/);
  assert.doesNotMatch(result.stderr, /codex-review-fast\(invoked, no verdict\)/, 'the code plane DID report');
});

test('transcript: each plane reporting its OWN verdict still allows the stop', () => {
  // Non-tautology guard: the split must not simply block everything in the fallback path.
  const workDir = makeTempDir('sd0x-stop-guard-crossplane-ok-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(
    transcriptPath,
    [
      '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
      '{"tool_name":"Edit","tool_input":{"path":"docs/readme.md"}}',
      'user: /codex-review-fast',
      '\u2705 Ready',
      'user: /codex-review-doc',
      '\u2705 Mergeable',
      'user: /precommit',
      '## Overall: \u2705 PASS',
    ].join('\n')
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(parseJson(result.stdout).ok, true);
});

// =============================================================================
// Corrupt/unparseable state file must fail closed (not fail open)
// =============================================================================

test('corrupt state JSON + dirty reviewable tree → forced strict block (even in warn mode)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-corrupt-block-');
  const binDir = setupStubBin();
  // Dirty .ts in the tree so reconciliation keeps the forced has_code_change=true.
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // Non-empty but unparseable JSON: without the fail-closed guard, the jq reads run
  // under `set -e` and abort the hook with a non-0/2 status → Claude treats it as a
  // non-blocking hook error → a pending strict gate would let the session stop unreviewed.
  writeFileSync(join(workDir, '.claude_review_state.json'), '{ "has_code_change": true, oops');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'unparseable state must force strict and block, not error out fail-open');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('EMPTY state file + dirty reviewable tree → forced strict block (jq empty exits 0 on empty → must not fail open)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-empty-block-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // A zero-byte state file: real `jq empty` returns exit 0 for empty input, so a
  // parse-only guard would pass it through; every `.field // false` read then yields
  // "" and the gate never engages → fail-open in warn mode. The whitespace-strip guard
  // must force strict here.
  writeFileSync(join(workDir, '.claude_review_state.json'), '');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'empty state must force strict and block, not fail open in warn mode');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('WHITESPACE-only state file + dirty reviewable tree → forced strict block', () => {
  const workDir = makeTempDir('sd0x-stop-guard-ws-block-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(join(workDir, '.claude_review_state.json'), '   \n\t  \n');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'whitespace-only state is as empty as zero bytes → force strict');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('non-object state JSON (false) + dirty reviewable tree → forced strict block (jq empty would pass it, then reads crash fail-open)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nonobject-block-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // `false` is VALID JSON (jq empty exits 0), but against REAL jq the very next read
  // `.code_review.passed` errors on a boolean and, under `set -e`, aborts the hook fail-open.
  // The `type=="object"` guard must treat it as corrupt and force strict. `null`/`123`/`[]`/`"s"`
  // share the hole. Fidelity note: the jq STUB does not reproduce real jq's index-error exit —
  // JS auto-boxing makes `data.code_review` undefined (no throw), so pre-fix the stub allows
  // stop via a different path. The 0-vs-2 assertion still pins the fix (non-tautological), but
  // the exit-5 crash described above is the real-jq behavior, not the stub's.
  writeFileSync(join(workDir, '.claude_review_state.json'), 'false');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'non-object state must force strict and block, not crash fail-open in warn mode');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('non-object state JSON (array) + dirty reviewable tree → forced strict block', () => {
  const workDir = makeTempDir('sd0x-stop-guard-array-block-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(join(workDir, '.claude_review_state.json'), '[1,2,3]');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'array state indexes-with-string error under set -e → must force strict, not fail open');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('MULTI-VALUE state stream (two concatenated objects) + dirty reviewable tree → forced strict block (last-value-wins guard passed it)', () => {
  // jq reads a STREAM of top-level values. The old guard `jq -e 'type == "object"'` was NOT
  // slurped, so it evaluated once per value and `-e` took its status from the LAST one — a
  // trailing object laundered everything before it and the guard PASSED. Verified against REAL
  // jq: `123\\n{"has_code_change":true}` passes, and so does a 2-object stream (the shape a
  // concurrent double-write or an interrupted `mv` actually leaves). Every read below then emits
  // ONE LINE PER VALUE, so HAS_CODE_CHANGE became the literal "true\\nfalse", `[[ ... == "true" ]]`
  // was FALSE, the gate never engaged, and the session stopped on an UNREVIEWED edit — fail-OPEN
  // in the project-default warn mode. `-s 'length == 1 and (.[0]|type) == "object"'` slurps the
  // stream into one array so a 2-value stream is rejected outright.
  const workDir = makeTempDir('sd0x-stop-guard-multivalue-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // Both values are legal objects with legal scalar types, so BOTH pre-fix guards accept them.
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    '{"has_code_change":true,"code_review":{"passed":false},"precommit":{"passed":false}}\n{"has_code_change":false}\n'
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'a multi-value state stream must fail closed, not read as "nothing to review"');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('single-object state is unaffected by the slurped guard (not over-strict)', () => {
  // Pins the other direction: slurping must not turn the ordinary one-object state — the only
  // shape any writer produces — into a corrupt-state strict block.
  const workDir = makeTempDir('sd0x-stop-guard-slurp-ok-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: true }, precommit: { passed: true } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 0, 'a reviewed single-object state must still allow stop');
  assert.equal(parseJson(result.stdout).ok, true);
});

test('top-level OBJECT with a NESTED non-object review field (.code_review is a string) → blocks, not exit-5 fail-open', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nested-str-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // The top-level `type=="object"` guard passes (this IS an object), so STATE is NOT
  // reset to {}. The very next read `.code_review.passed` then indexes a STRING → real
  // jq errors exit 5; under `set -euo pipefail` a bare `VAR=$(...)` aborts the whole hook
  // with a non-0/2 status → Claude treats it as non-blocking → strict mode stops UNREVIEWED
  // (fail-OPEN). The stub reproduces the exit-5 (indexErrorIfNonObject), so this pins the
  // `2>/dev/null || echo false` guard: post-fix the read degrades to false → code change +
  // not-passed → strict block (exit 2). Pre-fix the hook would exit 5 (fail-open).
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: 'oops', precommit: { passed: true }, doc_review: { passed: true } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'nested-string review field must degrade to blocked, not exit-5 abort');
  assert.notEqual(result.status, 5, 'hook must NOT abort with jq index-error exit code (fail-open)');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('top-level OBJECT with a malformed SCALAR has_code_change ([] not boolean) + dirty tree → forced strict block (Codex iter-14 P2)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-scalar-hcc-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // The top-level object guard PASSES (this IS an object) and no nested PARENT is a non-object, so
  // the `type=="object"` + nested-parent guards both let it through. But `has_code_change: []` is not
  // a boolean: `jq -r '.has_code_change // false'` yields a non-"true" string → the hook reads "no
  // change" and, with every gate marked passed, WARN mode lets the session STOP UNREVIEWED despite a
  // real dirty tree — the exact fail-OPEN the scalar-type guard closes. Post-fix: the malformed scalar
  // → STATE_CORRUPT → warn escalates to strict, gates forced not-passed, has_code_change forced true;
  // the dirty `.ts` keeps it true through reconciliation → block (exit 2).
  // Non-tautology: removing the scalar-type validation block lets `has_code_change:[]` read as "no
  // change" → warn mode → status 0 (stop allowed). Verified by reverting the fix.
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: [], code_review: { passed: true }, precommit: { passed: true }, doc_review: { passed: true }, review_phase: 'idle' })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'a non-boolean has_code_change must force strict + block, not read as no-change and fail open');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('top-level OBJECT with a STRING code_review.passed ("true") + dirty tree → forced strict block (fake-pass fail-open, Codex iter-14 P2)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-scalar-pass-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // `code_review.passed` is the STRING "true", not the boolean true. `jq -r '.code_review.passed //
  // false'` erases the string/boolean distinction (both print "true"), so a crafted string FAKES a
  // passed gate: with the code change marked reviewed, strict mode would let the session stop although
  // no real review recorded a boolean pass. Post-fix: the string scalar → STATE_CORRUPT → gates forced
  // not-passed → strict block (exit 2). Non-tautology: without the scalar-type guard the stub's
  // asBoolString("true") → "true" reads as a genuine pass → all gates pass → status 0. Verified by
  // reverting the fix.
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: 'true' }, precommit: { passed: true }, doc_review: { passed: true } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'a string "true" in code_review.passed must NOT read as a genuine pass — force strict + block');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('dual mode with a STRING aggregate_gate.executed ("true") + dirty tree → forced strict block (fake dual-READY, Codex iter-15 P2)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-agg-executed-str-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // Dual mode reads `aggregate_gate.executed` via `jq -r ... // false`, which erases the
  // string/boolean distinction: the STRING "true" reads as executed, and with gate "READY" the dual
  // gate is treated as passed → CODE_REVIEW_PASSED=true → the unreviewed dirty code change is allowed
  // to stop. The object guard passes (aggregate_gate IS an object) and the individual-field scalar
  // check did NOT originally cover aggregate_gate, so this slipped through. Post-fix: the string
  // aggregate_gate.executed → STATE_CORRUPT → gates forced not-passed → strict block (exit 2).
  // Non-tautology: without aggregate_gate in the scalar-type validation, the stub's `.aggregate_gate
  // .executed` read (asBoolString("true") → "true") fakes a genuine pass → dual READY → status 0.
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, review_mode: 'dual', aggregate_gate: { executed: 'true', gate: 'READY' }, precommit: { passed: true } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'a string "true" in aggregate_gate.executed must NOT read as executed — force strict + block');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('dual mode with a pending aggregate demands the AGGREGATE entry point, never /codex-review-fast', () => {
  // The interface deadlock this fixes (R1): `/codex-review-fast` cannot write the aggregate plane —
  // only the final emitter of `/codex-review-branch --dual` does. Demanding it in dual mode banked
  // `code_review.passed=true`, left `aggregate_gate` shut, and the next Stop demanded it again.
  // Deterministic, not probabilistic: nothing the model can do in response to the demand clears it.
  const workDir = makeTempDir('sd0x-stop-guard-dual-deadlock-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // `code_review.passed: true` is the whole point — the individual gate is already satisfied, so a
  // demand for another code review is unsatisfiable by construction. precommit passes so the only
  // thing left in MISSING is the code-plane obligation under test.
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      review_mode: 'dual',
      code_review: { executed: true, passed: true },
      aggregate_gate: { executed: false, gate: 'PENDING' },
      precommit: { executed: true, passed: true, mode: 'full' },
    })
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });

  // Dual forces strict regardless of STOP_GUARD_MODE=warn (stop-guard.sh:577), so this blocks.
  assert.equal(result.status, 2, 'dual mode forces strict, and a pending aggregate must block');
  assert.match(result.stderr, /\/codex-review-branch --dual/,
    'the demanded step must be an entry point that can actually write the aggregate plane');
  assert.match(result.stderr, /aggregate_gate/,
    'and it must name the obligation, not just a command');
  // Non-tautology: pre-fix this line read `/codex-review-fast` and this assertion failed.
  assert.doesNotMatch(result.stderr, /\/codex-review-fast/,
    'fast review cannot satisfy the aggregate gate — demanding it is the deadlock');
});

test('single mode with an invalidated code gate still demands /codex-review-fast, not the dual entry point', () => {
  // Guards the trap in the fix above: `DUAL_GATE_PASSED` is NOT a mode flag. The corrupt-state
  // (stop-guard.sh:351) and sidecar (:557) blocks set it false in SINGLE mode too, as the generic
  // "invalidate the code gate" signal. Branching on it instead of REVIEW_MODE routes single-mode
  // sessions to `/codex-review-branch --dual` — a command whose whole purpose is to opt INTO dual.
  const workDir = makeTempDir('sd0x-stop-guard-single-not-dual-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // No `review_mode` field at all → `.review_mode // "single"`. The sidecar forces DUAL_GATE_PASSED
  // false anyway, which is exactly the shape that makes the mode-proxy reading look correct.
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { executed: true, passed: true },
      precommit: { executed: true, passed: true, mode: 'full' },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'verdict_write_failed:code_review\n');

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });

  assert.equal(result.status, 2, 'a sidecar invalidates the gate and escalates to strict');
  assert.match(result.stderr, /\/codex-review-fast/,
    'single mode must keep demanding the single-reviewer entry point');
  assert.doesNotMatch(result.stderr, /--dual/,
    'never route a single-mode session into dual — that would opt it into a stricter gate it never chose');
});

// An aggregate-plane sidecar over a mode that still reads `single` is the SAME deadlock the dual
// branch above removes, reached through a different door — and routing on persisted mode alone
// walks straight back into it. `update_aggregate_gate PENDING` writes `review_mode = "dual"` in the
// SAME jq as the aggregate fields (post-tool-review-state.sh:2312), so a failed write raises the
// marker while leaving the mode single. These markers are cleared by a committed transition that
// owns the aggregate plane — the aggregate write itself (:2329-2330) or a code EDIT, which resets
// `aggregate_gate` outright (post-edit-format.sh:1186). A code-review verdict is neither: it clears
// `verdict_write_failed:<gate>` and nothing else, so demanding `/codex-review-fast` here is
// unsatisfiable by construction.
//
// Both markers, because the sidecar classifier treats them differently: `aggregate_write_failed` is
// non-transient and escalates to strict (exit 2), `lock_failure` is on the transient allowlist and
// leaves warn mode intact (exit 0). The ROUTE must be the same either way — the escalation decision
// and the "which command can discharge this" decision are independent.
for (const [marker, wantStatus, why] of [
  ['aggregate_write_failed', 2, 'non-transient — escalates to strict'],
  ['lock_failure', 0, 'transient — warn mode survives, but the obligation does not change'],
]) {
  test(`an aggregate-plane sidecar (${marker}) routes to the aggregate entry point even when review_mode reads single`, () => {
    const workDir = makeTempDir('sd0x-stop-guard-agg-sidecar-');
    const binDir = setupStubBin();
    setupStubGit(binDir, ' M src/app.ts');
    const transcriptPath = join(workDir, 'transcript.json');
    writeFileSync(transcriptPath, '[]');
    // No `review_mode` field at all — the exact shape a failed PENDING transition leaves behind.
    writeFileSync(
      join(workDir, '.claude_review_state.json'),
      JSON.stringify({
        has_code_change: true,
        code_review: { executed: true, passed: true },
        precommit: { executed: true, passed: true, mode: 'full' },
      })
    );
    writeFileSync(join(workDir, '.claude_review_state.json.blocked'), `${marker}\n`);

    const result = runHook({
      cwd: workDir,
      binDir,
      input: { transcript_path: transcriptPath },
      env: { STOP_GUARD_MODE: 'warn' },
    });

    assert.equal(result.status, wantStatus, why);
    assert.match(result.stderr, /\/codex-review-branch --dual/,
      `${marker} needs a committed aggregate-plane transition — the demanded step must be able to make one`);
    // Named in a RUNNABLE form. `--dual(aggregate_gate pending)` reads as the flag `--dual(aggregate_gate`
    // under whitespace parsing, and the parenthetical's own space splits off a second junk token —
    // so the one entry point that can discharge the gate would be quoted in a form that cannot be
    // invoked. The obligation belongs on its own line; MISSING stays a list of runnable steps.
    const missingLine = result.stderr.split('\n').find((l) => l.includes('Missing steps:'));
    assert.ok(missingLine, `stderr must carry a Missing steps line; got: ${result.stderr}`);
    assert.match(missingLine, /\/codex-review-branch --dual(\s|$)/,
      'the command in MISSING must terminate cleanly, not run into an annotation');
    assert.doesNotMatch(missingLine, /--dual\(/,
      'no parenthetical may attach to the flag — it would be parsed as part of the flag token');
    assert.match(result.stderr, /aggregate_gate is pending/,
      'and the obligation must still be named, just not inside the command list');
    // Non-tautology: routing on REVIEW_MODE alone emits `/codex-review-fast` here and this fails.
    assert.doesNotMatch(result.stderr, /\/codex-review-fast/,
      'a code-review verdict clears verdict_write_failed:<gate> only — it can never retire this marker');
    // A shared-file marker CAN be retired (see the comment above), so the honest "nothing retires
    // this" caveat must NOT appear here. Without this assertion the caveat could be emitted
    // unconditionally and the event-plane test below would still pass.
    assert.doesNotMatch(result.stderr, /Do NOT auto-retry/,
      'a shared-file marker is retired by a committed transition — this obligation IS dischargeable');
    if (wantStatus === 2) {
      // The ordinary MISSING renderer, which fires only when nothing unretireable is in play. R2
      // replaced the imperative that used to sit here with a statement of gate state; the property
      // is unchanged — a dischargeable obligation gets the ordinary line, not the no-retry one.
      assert.match(result.stderr, /the gate stays shut until each is discharged/,
        'and because it is dischargeable, the ordinary obligation line must survive');
    }
  });
}

// The event plane is the case where NO entry point can discharge the obligation. `_clear_own_sidecar`
// and `_clear_superseded_sidecar` both address `${STATE_FILE}.blocked` by name, so a marker under
// `.blocked.event.*` survives every writer and is retired only by session-init's orphan sweep — by
// design, per post-tool-review-state.sh § "Retirement is deliberately coarse".
//
// Naming the right command stays correct — it IS the right work. What must not survive is the
// generic `Execute immediately: … invoke the command now` imperative, because the model would run
// the step, the marker would outlive it, and the next Stop would issue the same order. A caveat
// printed three lines above that imperative does not cancel it; suppressing the imperative does.
//
// Parameterised across REASON CLASSES on purpose. Retirement is a property of the plane, so the
// caveat must not be keyed on the reason: an earlier fix raised it only for aggregate reasons, and
// a per-event `verdict_write_failed:code_review` then drew `/codex-review-fast` plus a retry order
// that no amount of reviewing could satisfy. The empty case covers a marker whose content is
// missing or unreadable — no less unretireable for being illegible.
for (const [label, body, wantRoute] of [
  ['aggregate reason', 'aggregate_write_failed\n', /\/codex-review-branch --dual/],
  ['non-aggregate reason', 'verdict_write_failed:code_review\n', /\/codex-review-fast/],
  ['empty marker', '', null],
]) {
  test(`an EVENT-plane marker (${label}) blocks WITHOUT ordering a retry`, () => {
    const workDir = makeTempDir('sd0x-stop-guard-event-noretry-');
    const binDir = setupStubBin();
    setupStubGit(binDir, ' M src/app.ts');
    const transcriptPath = join(workDir, 'transcript.json');
    writeFileSync(transcriptPath, '[]');
    writeFileSync(
      join(workDir, '.claude_review_state.json'),
      JSON.stringify({
        has_code_change: true,
        code_review: { executed: true, passed: true },
        precommit: { executed: true, passed: true, mode: 'full' },
      })
    );
    // Event plane only — no shared `.blocked`, which is what a writer that could not serialize leaves.
    writeFileSync(join(workDir, '.claude_review_state.json.blocked.event.7f3a21'), body);
    assert.equal(existsSync(join(workDir, '.claude_review_state.json.blocked')), false,
      'the shared file must be absent — otherwise this would retest the shared-plane case above');

    const result = runHook({
      cwd: workDir,
      binDir,
      input: { transcript_path: transcriptPath },
      env: { STOP_GUARD_MODE: 'warn' },
    });

    if (wantRoute) {
      assert.match(result.stderr, wantRoute,
        'the plane changes whether the step reopens the gate, never which step is the right work');
    }
    assert.match(result.stderr, /Do NOT auto-retry/,
      `${label}: an obligation no command can discharge must be reported as such`);
    // The assertion that closes the loop. Pre-fix the hook printed the caveat AND an order to run
    // the step, which is the contradiction that kept the recovery loop alive. Anchored on the
    // ordinary renderer's own line: the two branches are mutually exclusive, so its absence is what
    // proves the no-retry branch won. Anchoring on the removed imperative instead would leave a
    // `doesNotMatch` against a string the tree no longer contains — green forever, guarding nothing.
    assert.doesNotMatch(result.stderr, /the gate stays shut until each is discharged/,
      `${label}: never present an obligation nothing retires as one that can be worked off`);
  });
}

// The three OTHER terminal branches that emit a retry instruction. Fixing only the `MISSING`
// renderer left each of these still ordering work that cannot end the objection — a plane fact has
// to reach every exit that tells the model what to do next, not just the main one.
//
// Each case pairs with a shared-marker control: the point is that the plane decides, so a fix that
// simply dropped the retry wording from these branches would be wrong in the other direction.
for (const [label, eventPlane] of [['event marker', true], ['shared marker', false]]) {
  const wantNoRetry = eventPlane;

  test(`jq unavailable + ${label} → ${wantNoRetry ? 'no-retry' : 'ordinary retry'} instruction`, () => {
    // Without jq nothing about the state is knowable, but the plane is a filesystem fact, so the
    // one thing still decidable is whether a retry could ever help. `_sidecar_event_any` is pure
    // bash for exactly this reason — this branch is reached BECAUSE the toolchain is thin.
    const workDir = makeTempDir('sd0x-stop-guard-nojq-plane-');
    const transcriptPath = join(workDir, 'transcript.json');
    writeFileSync(transcriptPath, '[]');
    writeFileSync(
      join(workDir, eventPlane
        ? '.claude_review_state.json.blocked.event.c0ffee'
        : '.claude_review_state.json.blocked'),
      'aggregate_write_failed\n'
    );

    const result = runHookNoJq({
      cwd: workDir,
      input: { transcript_path: transcriptPath },
      env: { STOP_GUARD_MODE: 'warn' },
    });

    assert.equal(result.status, 2, 'a sidecar fails closed without jq regardless of plane');
    const json = parseJson(result.stdout);
    assert.equal(json.ok, false, 'and the JSON verdict must agree');
    if (wantNoRetry) {
      assert.match(json.description, /Do not auto-retry/, 'the plane fact must reach the JSON, not only stderr');
      assert.doesNotMatch(json.description, /then re-run/, 'never order a re-run that cannot clear the marker');
    } else {
      assert.match(json.description, /then re-run/, 'a shared marker IS dischargeable — keep the actionable instruction');
      assert.doesNotMatch(json.description, /Do not auto-retry/, 'and must not be told otherwise');
    }
  });

  test(`${label} without a state file → ${wantNoRetry ? 'no-retry' : 'ordinary retry'} instruction`, () => {
    // Production-reachable: `update_aggregate_gate` raises `aggregate_write_failed` when state
    // INITIALIZATION fails, and `_set_own_sidecar` diverts to the event plane precisely when it
    // could not serialize on the shared one — so "no state file + event marker" is a real state.
    const workDir = makeTempDir('sd0x-stop-guard-nostate-plane-');
    const binDir = setupStubBin();
    const transcriptPath = join(workDir, 'transcript.json');
    writeFileSync(transcriptPath, '[]');
    assert.equal(existsSync(join(workDir, '.claude_review_state.json')), false, 'no state file — that is the case under test');
    writeFileSync(
      join(workDir, eventPlane
        ? '.claude_review_state.json.blocked.event.c0ffee'
        : '.claude_review_state.json.blocked'),
      'state_write_failed:code\n'
    );

    const result = runHook({
      cwd: workDir,
      binDir,
      input: { transcript_path: transcriptPath },
      env: { STOP_GUARD_MODE: 'warn' },
    });

    assert.equal(result.status, 2, 'a sidecar without state is unverifiable and fails closed');
    const json = parseJson(result.stdout);
    assert.equal(json.ok, false, 'and the JSON verdict must agree');
    if (wantNoRetry) {
      assert.match(json.description, /Do not auto-retry/, 'no writer retires an event marker, so no step ends this');
      assert.doesNotMatch(json.description, /then re-run/, 'never order a re-run that cannot clear the marker');
    } else {
      assert.match(json.description, /then re-run/, 'a shared marker IS dischargeable — keep the actionable instruction');
    }
  });

  test(`corrupt iteration counters + ${label} → ${wantNoRetry ? 'no-retry' : 'ordinary fix-and-re-run'} instruction`, () => {
    // Corrupt counters CLEAR `MISSING` and set `BLOCKED_REASON` instead, so the output goes through
    // the other renderer entirely. Without threading the plane fact there too, the fix to the
    // `MISSING` branch is silently bypassed by a state shape that is itself a failure signal.
    const workDir = makeTempDir('sd0x-stop-guard-corrupt-iter-plane-');
    const binDir = setupStubBin();
    setupStubGit(binDir, ' M src/app.ts');
    const transcriptPath = join(workDir, 'transcript.json');
    writeFileSync(transcriptPath, '[]');
    writeFileSync(
      join(workDir, '.claude_review_state.json'),
      JSON.stringify({
        has_code_change: true,
        code_review: { executed: true, passed: true },
        precommit: { executed: true, passed: true, mode: 'full' },
        // Non-integer counters — rejected by the jq bounds check, which collapses to "corrupt".
        iteration_history: { current_round: 'x', max_rounds: 'y' },
      })
    );
    writeFileSync(
      join(workDir, eventPlane
        ? '.claude_review_state.json.blocked.event.c0ffee'
        : '.claude_review_state.json.blocked'),
      'aggregate_write_failed\n'
    );

    const result = runHook({
      cwd: workDir,
      binDir,
      input: { transcript_path: transcriptPath },
      env: { STOP_GUARD_MODE: 'warn' },
    });

    assert.equal(result.status, 2, 'corrupt counters + a sidecar must block');
    assert.match(result.stderr, /corrupt or tampered/, 'this must be the BLOCKED_REASON renderer, not the MISSING one');
    if (wantNoRetry) {
      // R6: the BLOCKED renderer is the path cap-hits route through, so its plane fact is phrased
      // neutrally — the obligation is stated, the disposition is not.
      assert.match(result.stderr, /Unretireable obligation:.*No review, precommit or edit retires it/,
        'the BLOCKED_REASON renderer must honour the plane fact too');
      assert.doesNotMatch(result.stderr, /auto-retry|retry in a loop/i, 'phrased as fact, not imperative (R6 neutrality)');
      assert.doesNotMatch(result.stderr, /Findings are outstanding/, 'the ordinary description must be displaced, not merely appended to');
    } else {
      assert.match(result.stderr, /Findings are outstanding/, 'a shared marker keeps the ordinary corrupt-state description');
    }
  });
}

test('warn-mode BLOCKED_REASON carries the no-retry fact too (symmetry with the MISSING branch)', () => {
  // Reaching this branch needs a corrupt-counter BLOCKED_REASON that stays in warn mode, so the
  // event marker must hold a TRANSIENT reason — a non-transient one escalates to strict and lands
  // in the branch above. Warn mode allows the stop, so nothing loops here; the gap being closed is
  // that a stdout-only consumer would otherwise see a plain blocked reason and try to work it off.
  const workDir = makeTempDir('sd0x-stop-guard-blocked-warn-plane-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { executed: true, passed: true },
      precommit: { executed: true, passed: true, mode: 'full' },
      iteration_history: { current_round: 'x', max_rounds: 'y' },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked.event.c0ffee'), 'edit_lock_contention:code\n');

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });

  assert.equal(result.status, 0, `a transient reason must not override the user's warn preference; stderr: ${result.stderr}`);
  const json = parseJson(result.stdout);
  assert.equal(json.ok, true, 'warn mode still allows the stop');
  assert.match(json.description, /Unretireable obligation:.*No review, precommit or edit retires it/,
    'but the JSON must still carry why working it off will not help');
  assert.doesNotMatch(json.description, /auto-retry|retry in a loop/i, 'phrased as fact, not imperative (R6 neutrality)');
});

test('a sidecar is checked BEFORE the unreadable-state and dual branches (what makes those unreachable)', () => {
  // My audit concluded the `Restore read access …` and `Install jq …` exits at :205/:212 cannot be
  // reached with an event marker, because `_sidecar_any` covers BOTH planes and exits first. That
  // is a claim about ORDERING, and orderings get refactored. This pins it: reorder the checks and
  // the retry-flavoured description reappears here.
  const workDir = makeTempDir('sd0x-stop-guard-nojq-order-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // A state file that exists but cannot be read — the exact precondition of the :205 branch — plus
  // an event marker. The sidecar branch must win.
  const statePath = join(workDir, '.claude_review_state.json');
  writeFileSync(statePath, '{"has_code_change":true}');
  chmodSync(statePath, 0o000);
  writeFileSync(join(workDir, '.claude_review_state.json.blocked.event.c0ffee'), 'aggregate_write_failed\n');

  const result = runHookNoJq({
    cwd: workDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  chmodSync(statePath, 0o644);

  assert.equal(result.status, 2, 'either branch blocks — the question is which instruction is given');
  const json = parseJson(result.stdout);
  assert.match(json.reason, /blocked sidecar/, 'the sidecar branch must claim this state, not the unreadable-state branch');
  assert.match(json.description, /Do not auto-retry/, 'and it must give the plane-correct instruction');
  assert.doesNotMatch(json.description, /Restore read access/, 'the later branch would order work that cannot clear the marker');
});

test('an UNREADABLE event marker is still classified unretireable (the flag is raised before the read)', (t) => {
  // The set-before-read ordering in the event loop is load-bearing and otherwise untested: an
  // unreadable marker yields no reason text, so any classification derived from CONTENT would miss
  // it — and an illegible marker is no more dischargeable than a legible one.
  //
  // Skipped rather than run as root: `chmod 000` does not stop root from reading, so the fixture
  // would be legible, the assertions would pass via the content path, and the ordering this test
  // exists for would go untested while still reporting green.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root — chmod 000 cannot make the marker unreadable');
    return;
  }
  const workDir = makeTempDir('sd0x-stop-guard-event-unreadable-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { executed: true, passed: true },
      precommit: { executed: true, passed: true, mode: 'full' },
    })
  );
  const marker = join(workDir, '.claude_review_state.json.blocked.event.7f3a21');
  writeFileSync(marker, 'aggregate_write_failed\n');
  chmodSync(marker, 0o000);

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  chmodSync(marker, 0o644); // restore so the temp-dir cleanup can remove it

  assert.equal(result.status, 2, `an unreadable marker is unverifiable and must block; stderr: ${result.stderr}`);
  assert.match(result.stderr, /Do NOT auto-retry/,
    'plane, not content, decides retireability — a read failure must not downgrade it to retryable');
  assert.doesNotMatch(result.stderr, /the gate stays shut until each is discharged/,
    'and the workable-obligation line must be suppressed here as anywhere else on this plane');
});

test('the no-retry string is JSON-safe by construction (the early exits cannot sanitize it)', () => {
  // `SIDECAR_EVENT_NORETRY` is interpolated into JSON at the jq-free early exits, which run BEFORE
  // `_json_safe` is defined — so the string itself has to carry the property. A `"` or `\` added
  // here would produce malformed output on the fail-closed path, which the harness reads as "no
  // objection": a fail-OPEN turned on by an innocuous copy edit.
  const src = readFileSync(hookPath, 'utf8');
  const m = src.match(/^SIDECAR_EVENT_NORETRY="([^\n]*)"$/m);
  assert.ok(m, 'the constant must stay a single-line double-quoted assignment for this guard to read it');
  assert.doesNotMatch(m[1], /["\\]/, 'no quote or backslash may enter the string');
  assert.doesNotMatch(m[1], /[\x00-\x1f]/, 'no control characters either');
});

test('an EVENT-plane marker still exits 2 when it is non-transient (the block itself must not soften)', () => {
  // Control for the pair above: dropping the retry imperative must not be mistaken for dropping the
  // block. Fail-closed is still the point — only the instruction changed.
  const workDir = makeTempDir('sd0x-stop-guard-event-still-blocks-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { executed: true, passed: true },
      precommit: { executed: true, passed: true, mode: 'full' },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked.event.7f3a21'), 'aggregate_write_failed\n');

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });

  assert.equal(result.status, 2, `aggregate_write_failed is non-transient and must still block; stderr: ${result.stderr}`);
  assert.equal(parseJson(result.stdout).ok, false, 'and the JSON verdict must agree with the exit code');
});

test('dual mode with a NESTED non-object aggregate_gate (string) → blocks, not exit-5 fail-open', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nested-agg-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // Same nested-index fail-open class on the dual-mode path: `.aggregate_gate.executed`
  // indexes a string → exit 5 → fail-open without the guard. The guard degrades AGG_EXECUTED
  // to false → dual gate fail-closed → strict block.
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, review_mode: 'dual', aggregate_gate: 'oops', code_review: { passed: true }, precommit: { passed: true }, doc_review: { passed: true } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'nested-string aggregate_gate must degrade to blocked, not exit-5 abort');
  assert.notEqual(result.status, 5, 'hook must NOT abort with jq index-error exit code (fail-open)');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('UNREADABLE state file (chmod 000) + dirty reviewable tree → forced strict block (cat failure must not map to {})', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root bypasses file permissions' : false }, () => {
  const workDir = makeTempDir('sd0x-stop-guard-unreadable-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // A present-but-unreadable state file: `cat` fails, and if the hook mapped that to "{}"
  // (fail-open) every read would default false and the gate would allow stop unreviewed.
  // The cat-failure→empty→corrupt path must force strict instead.
  const statePath = join(workDir, '.claude_review_state.json');
  writeFileSync(statePath, '{ "has_code_change": true }');
  chmodSync(statePath, 0o000);
  let result;
  try {
    result = runHook({
      cwd: workDir,
      binDir,
      input: { transcript_path: transcriptPath },
      env: { STOP_GUARD_MODE: 'warn' },
    });
  } finally {
    chmodSync(statePath, 0o644); // restore so cleanup can remove it
  }
  assert.equal(result.status, 2, 'unreadable state must force strict, not fail open by mapping to {}');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('corrupt state JSON + clean tree → allows stop (nothing left to review)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-corrupt-clean-');
  const binDir = setupStubBin();
  // Clean tree: the forced has_*_change=true is reconciled true→false, so there is
  // genuinely nothing to review. Allowing stop here is correct, not fail-open — this
  // pins that the corrupt guard does not wedge a clean worktree.
  setupStubGit(binDir, '');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(join(workDir, '.claude_review_state.json'), 'not json at all }{');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'corrupt state with a clean tree has nothing to review → allow stop');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

// Resolve a real tool's absolute path via the host PATH — used to build a curated bin that
// deliberately OMITS timeout/gtimeout so the hook exercises its no-timeout-helper branch.
function realToolPath(tool) {
  const r = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
  const p = (r.stdout || '').trim();
  return p && existsSync(p) ? p : null;
}

// A curated PATH: mock jq/git + the real coreutils the hook needs, but NEITHER timeout NOR
// gtimeout — so `command -v timeout`/`gtimeout` fail and the corrupt-state block must fall back
// to its bounded default-porcelain cleanliness probe instead of the -uall reconciliation.
function setupNoTimeoutEnv(porcelainOutput, { statusExit = 0 } = {}) {
  const binDir = setupStubBin(); // mock jq
  // When statusExit != 0 the git stub emulates a FAILED `git status` (corrupt .git/config, not a
  // repo, transient error) — it prints nothing and exits non-zero, so the hook cannot read the
  // empty stdout as "clean". Every non-status git call also exits 1 (unused by this path).
  writeExecutable(
    join(binDir, 'git'),
    `#!/bin/sh
if echo "$*" | grep -q "status --porcelain"; then
  printf '%s' '${porcelainOutput}'
  exit ${statusExit}
fi
exit 1
`
  ); // NO installPassthroughTimeout → no timeout helper in this bin
  const realBin = makeTempDir('sd0x-stop-guard-realbin-');
  // bash backs the hook interpreter (runHook spawns `bash`, resolved via this env's PATH);
  // env + node back the mock jq's `#!/usr/bin/env node` shebang; the rest are the coreutils the
  // hook shells out to. mktemp + rm back the no-timeout probe's stderr-capture temp file
  // (stop-guard.sh:329/344) — without them `_probe_err=""` short-circuits the probe into the
  // fail-closed else and the clean-tree relax path is never reached (would block, exit 2).
  // timeout/gtimeout are deliberately absent so the no-helper branch runs.
  for (const tool of ['bash', 'sh', 'env', 'node', 'grep', 'sed', 'cat', 'head', 'tail', 'basename', 'mktemp', 'rm']) {
    const src = realToolPath(tool);
    if (src) {
      try {
        symlinkSync(src, join(realBin, tool));
      } catch {
        /* already linked */
      }
    }
  }
  return { binDir, PATH: `${binDir}:${realBin}` };
}

test('corrupt state + clean tree + NO timeout helper → allows stop (bounded probe, no macOS wedge)', () => {
  // stock-macOS reproduction: no timeout/gtimeout. Before the fix the corrupt block forced
  // has_*_change=true and the -uall reconciliation was SKIPPED (no helper) → strict mode
  // requested all three gates on a CLEAN tree forever (nothing to fix, cannot stop; the corrupt
  // file cannot self-heal). The fix probes cleanliness with a bounded default-mode porcelain and
  // relaxes the flags on an empty tree. Non-tautology anchor: without the probe this blocks (2).
  const workDir = makeTempDir('sd0x-stop-guard-corrupt-clean-notimeout-');
  const { binDir, PATH } = setupNoTimeoutEnv(''); // clean tree
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(join(workDir, '.claude_review_state.json'), 'not json at all }{');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH },
  });
  assert.equal(result.status, 0, 'corrupt+clean without a timeout helper must not wedge → allow stop');
});

test('corrupt state + dirty tree + NO timeout helper → still blocks (probe preserves dirty-tree gate)', () => {
  // Guard against the probe over-relaxing: a DIRTY tree without a timeout helper must keep the
  // forced flags and block, so the corrupt-state fail-closed posture survives on a real edit.
  const workDir = makeTempDir('sd0x-stop-guard-corrupt-dirty-notimeout-');
  const { binDir, PATH } = setupNoTimeoutEnv(' M src/app.ts'); // dirty tree
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(join(workDir, '.claude_review_state.json'), 'not json at all }{');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH },
  });
  assert.equal(result.status, 2, 'corrupt+dirty without a timeout helper must still block');
});

test('corrupt state + git status FAILS + NO timeout helper → blocks (unverifiable tree ≠ clean)', () => {
  // The bounded cleanliness probe must not read a FAILED `git status` (corrupt .git/config, not a
  // repo, transient error) as a clean tree. A bare `[[ -n "$(git status ...)" ]]` sees the empty
  // stdout of a failed status and relaxes the flags → the strict guard releases an unreviewed edit
  // on an unverifiable tree (fail-OPEN). The fix gates on the git EXIT STATUS: a non-zero exit keeps
  // the forced flags true. Non-tautology anchor: the pre-fix substitution-only check allows (0).
  const workDir = makeTempDir('sd0x-stop-guard-corrupt-gitfail-notimeout-');
  const { binDir, PATH } = setupNoTimeoutEnv('', { statusExit: 128 }); // git status fails
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(join(workDir, '.claude_review_state.json'), 'not json at all }{');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH },
  });
  assert.equal(result.status, 2, 'a failed git status is not proof of clean → must fail closed (block)');
});

// A curated PATH with perl but NEITHER timeout NOR gtimeout — the stock-macOS shape, where the
// perl `alarm 5; exec` tier is the ONLY thing that runs the PRIMARY -uall reconciliation.
// `stderrOutput` lets a test drive git's warn-and-omit contract THROUGH the perl exec, which is
// the part a plain `command -v perl` assertion could never prove.
function setupPerlTierEnv(porcelainOutput, { statusExit = 0, stderrOutput = '' } = {}) {
  const binDir = setupStubBin(); // mock jq
  writeExecutable(
    join(binDir, 'git'),
    `#!/bin/sh
if echo "$*" | grep -q "status --porcelain"; then
  ${stderrOutput ? `printf '%s\\n' '${stderrOutput}' >&2` : ':'}
  printf '%s' '${porcelainOutput}'
  exit ${statusExit}
fi
exit 1
`
  );
  const realBin = makeTempDir('sd0x-stop-guard-perlbin-');
  // Same curated set as setupNoTimeoutEnv PLUS perl, and still WITHOUT timeout/gtimeout, so the
  // `elif` resolves specifically to the perl arm.
  const needed = ['bash', 'sh', 'env', 'node', 'grep', 'sed', 'cat', 'head', 'tail', 'basename', 'mktemp', 'rm', 'perl'];
  for (const tool of needed) {
    const src = realToolPath(tool);
    if (src) {
      try {
        symlinkSync(src, join(realBin, tool));
      } catch {
        /* already linked */
      }
    }
  }
  return { binDir, PATH: `${binDir}:${realBin}` };
}

const SKIP_NO_PERL = realToolPath('perl') ? false : 'perl unresolvable on this host';

test('perl tier: clean tree reconciles a stale has_code_change → allows stop (stock-macOS primary path)', { skip: SKIP_NO_PERL }, () => {
  // The ONLY reconciliation path on a stock macOS box (no timeout, no gtimeout). Without the perl
  // arm the `elif` falls through to the else, GIT_PORCELAIN is __GIT_UNAVAILABLE__, the one-way
  // downgrade is skipped, and a stale has_code_change left over from a reverted or externally
  // committed edit keeps the gate demanding a review of nothing — a wedge, not a fail-open.
  // Non-tautology anchor: with perl removed from PATH this same fixture blocks (2), which the
  // companion setupNoTimeoutEnv test below asserts directly.
  const workDir = makeTempDir('sd0x-stop-guard-perl-clean-');
  const { binDir, PATH } = setupPerlTierEnv(''); // clean tree
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH },
  });
  assert.equal(result.status, 0, 'a clean tree must reconcile the stale flag away via the perl tier');
  assert.equal(parseJson(result.stdout).ok, true);
});

test('perl tier ABSENT (no timeout/gtimeout/perl): the same clean-tree fixture blocks — proves the tier is what relaxes it', () => {
  // The discriminator for the test above. setupNoTimeoutEnv omits perl as well, so the `elif`
  // takes the final else and reconciliation is skipped entirely (fail-closed: flags preserved).
  const workDir = makeTempDir('sd0x-stop-guard-noperl-clean-');
  const { binDir, PATH } = setupNoTimeoutEnv('');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH },
  });
  assert.equal(result.status, 2, 'without any bounding helper the stale flag is kept and the gate holds');
});

test('perl tier: dirty tree keeps the gate engaged (reconciliation is ONE-WAY)', { skip: SKIP_NO_PERL }, () => {
  const workDir = makeTempDir('sd0x-stop-guard-perl-dirty-');
  const { binDir, PATH } = setupPerlTierEnv(' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH },
  });
  assert.equal(result.status, 2, 'a genuinely dirty tree must still block after the perl-tier reconciliation');
});

test('perl tier: a directory-omission warning on stderr holds the flags (stderr survives the exec)', { skip: SKIP_NO_PERL }, () => {
  // `git status` exits 0 when it cannot open a directory — it only WARNS and OMITS that subtree.
  // If the sole dirty reviewable file lives under it, the empty listing would downgrade
  // HAS_CODE_CHANGE and release an unreviewed edit. The stderr capture must therefore work
  // ACROSS `perl -e 'alarm 5; exec @ARGV'` — perl replaces its own process image, so the `2>`
  // redirection has to be inherited. Nothing else in the suite exercises that.
  const workDir = makeTempDir('sd0x-stop-guard-perl-omit-');
  const { binDir, PATH } = setupPerlTierEnv('', {
    // No embedded quotes: the text is interpolated into a single-quoted sh string inside the
    // git stub. Git's real message quotes the path, but the hook's regex keys on the
    // "could not open directory" phrase, not on the quoting.
    stderrOutput: 'warning: could not open directory src/secret/: Permission denied',
  });
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH },
  });
  assert.equal(result.status, 2, 'an incomplete listing is not proof of clean → flags must be held');
});

// Curated PATH with the REAL git + jq + coreutils but NEITHER timeout NOR gtimeout, so the
// corrupt-state no-timeout probe runs against a genuine repo. A stub git cannot reproduce git's
// real directory-omission warning (nor its LOCALE-dependent text), which this path must catch.
// Returns the bin dir, or null if any required tool cannot be resolved on this host (→ skip).
function setupRealNoTimeoutBin() {
  const binDir = makeTempDir('sd0x-stop-guard-real-notimeout-');
  const needed = ['git', 'jq', 'grep', 'sed', 'cat', 'head', 'tail', 'basename', 'mktemp', 'rm', 'bash', 'sh', 'env', 'dirname'];
  // Resolve every tool path in a SINGLE subprocess (keeps the test light under parallel load).
  const script = needed.map((n) => `command -v ${n} || echo __MISSING__`).join('; ');
  const resolved = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  const lines = (resolved.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.includes('__MISSING__')) return null;
  for (const realPath of lines) {
    if (!existsSync(realPath)) return null;
    const name = realPath.slice(realPath.lastIndexOf('/') + 1);
    try {
      symlinkSync(realPath, join(binDir, name));
    } catch {
      /* already linked — skip */
    }
  }
  return binDir;
}

test('corrupt state + clean tree EXCEPT an UNREADABLE dir + NO timeout helper → blocks (real git omission warning caught regardless of locale, Codex iter-19 P2)', { skip: (typeof process.getuid === 'function' && process.getuid() === 0) ? 'root can open 0o000 dirs, so git emits no directory-omission warning' : SKIP_NO_ZH_TW }, () => {
  const binDir = setupRealNoTimeoutBin();
  if (!binDir) return; // git/jq/coreutils unresolvable on this host → graceful skip
  const workDir = makeTempDir('sd0x-stop-guard-unreadable-notimeout-');
  const auxDir = makeTempDir('sd0x-stop-guard-unreadable-aux-');
  // Real repo, clean baseline: the SOLE dirty element is a reviewable file inside a 0o000 dir git
  // cannot open → git WARNS on stderr and OMITS the subtree (empty porcelain stdout, exit 0).
  spawnSync('git', ['init', '-q'], { cwd: workDir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: workDir });
  spawnSync('git', ['config', 'user.email', 'test@test'], { cwd: workDir });
  writeFileSync(join(workDir, '.gitignore'), '/.claude_review_state.json\n');
  spawnSync('git', ['add', '.gitignore'], { cwd: workDir });
  spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base'], { cwd: workDir });
  const locked = join(workDir, 'locked');
  mkdirSync(locked);
  writeFileSync(join(locked, 'unreviewed.ts'), 'export const x = 1;\n');
  chmodSync(locked, 0o000);
  // Non-object state → STATE_CORRUPT → strict + assume-changes; the no-timeout probe then decides
  // clean-vs-dirty. Gitignored so the state file is not itself a dirty porcelain entry.
  writeFileSync(join(workDir, '.claude_review_state.json'), '123');
  // Transcript lives OUTSIDE the repo so it is not an untracked porcelain entry — the ONLY thing
  // git could report is the unreadable dir, which it can only warn+omit. This keeps the block
  // attributable to the stderr-omission path (non-tautological), not to a non-empty stdout.
  const transcriptPath = join(auxDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // Ambient zh-TW locale exercises git's LOCALIZED warning on locale-capable hosts; the hook forces
  // LC_ALL=C on its probe so the omission warning is always the English form the regex matches.
  // Reverting that LC_ALL=C makes git emit "警告: 無法開啟目錄…" here → regex misses → fail-open (allow).
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH: binDir, LC_ALL: 'zh_TW.UTF-8', LANG: 'zh_TW.UTF-8', LANGUAGE: 'zh_TW:zh' },
  });
  chmodSync(locked, 0o755); // restore so temp-dir cleanup can recurse in
  assert.equal(result.status, 2, 'an unreadable dir git could not scan is unverifiable → must fail closed (block), regardless of locale');
});

// Real toolchain WITH a passthrough `timeout` shim so the stale-state RECONCILIATION branch (which
// only runs under a timeout helper, and is the PRIMARY Stop-gate path) fires deterministically on
// every host. Real git is required to reproduce the directory-omission warning a stub cannot.
function setupRealBinWithTimeout() {
  const binDir = setupRealNoTimeoutBin();
  if (!binDir) return null;
  writeExecutable(join(binDir, 'timeout'), '#!/bin/sh\nshift; exec "$@"\n');
  return binDir;
}

test('stale-state reconciliation: does NOT downgrade HAS_CODE_CHANGE when the sole reviewable file is under an UNREADABLE dir → blocks (iter-20 P1)', { skip: (typeof process.getuid === 'function' && process.getuid() === 0) ? 'root can open 0o000 dirs, so git emits no directory-omission warning' : SKIP_NO_ZH_TW }, () => {
  const binDir = setupRealBinWithTimeout();
  if (!binDir) return; // toolchain unresolvable → graceful skip
  const workDir = makeTempDir('sd0x-stop-guard-recon-unreadable-');
  const auxDir = makeTempDir('sd0x-stop-guard-recon-aux-');
  spawnSync('git', ['init', '-q'], { cwd: workDir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: workDir });
  spawnSync('git', ['config', 'user.email', 'test@test'], { cwd: workDir });
  writeFileSync(join(workDir, '.gitignore'), '/.claude_review_state.json\n');
  spawnSync('git', ['add', '.gitignore'], { cwd: workDir });
  spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base'], { cwd: workDir });
  const locked = join(workDir, 'locked');
  mkdirSync(locked);
  writeFileSync(join(locked, 'unreviewed.ts'), 'export const x = 1;\n');
  chmodSync(locked, 0o000);
  // VALID (non-corrupt) state: a code change is pending and its review has NOT passed, so strict mode
  // wants to BLOCK. The one-way reconciliation would normally downgrade has_code_change→false on a
  // clean tree (→ nothing to review → allow). Here the tree is clean EXCEPT the unreadable dir git
  // cannot enumerate: the fix must NOT downgrade on that incomplete listing (fail-closed → block).
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  const transcriptPath = join(auxDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // zh-TW ambient exercises git's localized warning on locale-capable hosts; the reconciliation forces
  // LC_ALL=C so the omission warning is always the English form its regex matches. Reverting either the
  // LC_ALL=C or the stderr-omission guard lets the empty (dir-omitted) listing downgrade the flag → allow.
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH: binDir, LC_ALL: 'zh_TW.UTF-8', LANG: 'zh_TW.UTF-8', LANGUAGE: 'zh_TW:zh' },
  });
  chmodSync(locked, 0o755); // restore so temp-dir cleanup can recurse in
  assert.equal(result.status, 2, 'an unverifiable (dir-omitted) reconciliation must not clear the pending flag → block');
});

// =============================================================================
// Stale-state git checks
// =============================================================================

function setupStubGit(binDir, porcelainOutput) {
  writeExecutable(join(binDir, 'git'), `#!/bin/sh
if echo "$*" | grep -q "status --porcelain"; then
  printf '%s' '${porcelainOutput}'
  exit 0
fi
exit 1
`);
  // Reconciliation only runs the -uall walk under a timeout helper (no helper → fail-closed
  // skip). Install a passthrough timeout so tests deterministically exercise the real
  // reconciliation path: `timeout 5 git ...` → strips the duration → `git ...`.
  installPassthroughTimeout(binDir);
}

// Passthrough `timeout`: drops the duration arg and execs the rest. Used so reconciliation
// tests take the bounded timeout branch regardless of whether the host has a real `timeout`.
function installPassthroughTimeout(binDir) {
  writeExecutable(join(binDir, 'timeout'), `#!/bin/sh\nshift; exec "$@"\n`);
}

// Build a PATH that has every utility the hook needs EXCEPT timeout/gtimeout, so the
// no-timeout-helper branch is exercised deterministically on every host (including GNU/Linux
// CI where the real `timeout` lives in /usr/bin alongside grep/sed). stubBinDir supplies the
// jq + git stubs; cleanDir symlinks the real system tools by name, omitting timeout/gtimeout.
function makeNoTimeoutPath(stubBinDir) {
  const cleanDir = makeTempDir('sd0x-stop-guard-clean-bin-');
  const needed = ['bash', 'sh', 'env', 'node', 'grep', 'sed', 'cat', 'basename', 'head', 'tail', 'printf', 'dirname'];
  // Resolve every tool path in a SINGLE subprocess (keeps the test light under parallel load).
  const script = needed.map((n) => `command -v ${n} || true`).join('; ');
  const resolved = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  for (const realPath of (resolved.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
    if (!existsSync(realPath)) continue;
    const name = realPath.slice(realPath.lastIndexOf('/') + 1);
    try {
      symlinkSync(realPath, join(cleanDir, name));
    } catch {
      /* already linked — skip */
    }
  }
  return `${stubBinDir}:${cleanDir}`;
}

test('clean worktree overrides stale has_code_change (allows stop)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-stale-code-');
  const binDir = setupStubBin();
  // Stub git returns empty porcelain (clean worktree)
  setupStubGit(binDir, '');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'should allow stop when git shows no code files');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('clean worktree overrides stale has_doc_change (allows stop)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-stale-doc-');
  const binDir = setupStubBin();
  // Stub git returns empty porcelain (clean worktree)
  setupStubGit(binDir, '');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: true,
      doc_review: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'should allow stop when git shows no doc files');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('renamed code file in porcelain is still detected', () => {
  const workDir = makeTempDir('sd0x-stop-guard-rename-');
  const binDir = setupStubBin();
  // Git porcelain rename entry: old.ts -> new.txt
  setupStubGit(binDir, 'R  src/old.ts -> src/new.txt');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  // The .ts in "old.ts -> new.txt" should still be detected via \s boundary
  assert.equal(result.status, 2, 'should block stop when renamed .ts file exists');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('quoted filenames in porcelain are still detected (B2 fix)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-quoted-');
  const binDir = setupStubBin();
  // Git porcelain output with quoted filename (spaces/unicode)
  setupStubGit(binDir, ' M "src/my file.ts"');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  // With B2 fix, quoted .ts file should still be detected, so has_code_change stays true → blocks
  assert.equal(result.status, 2, 'should block stop when quoted .ts file exists in git status');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

// Flag-aware git stub: emulates real git's untracked visibility across all three modes.
//   -uno      → untracked hidden (the original bug)
//   -uall     → every untracked file listed individually (the fix)
//   default/-unormal/plain --porcelain → a brand-new untracked dir collapses to "?? dir/"
// Pins the fix against BOTH regressions: reverting to `-uno` returns `tracked` only, and
// reverting to plain `--porcelain` returns the collapsed dir form (`?? src/`) — in both
// cases the extension grep misses the file and the one-way true→false reconciliation
// would silently clear the fail-closed gate, so either revert fails the tests below.
function setupStubGitUntrackedAware(binDir, { tracked = '', untracked = '', untrackedCollapsed = '' }) {
  // Join non-empty parts with a newline so a caller setting BOTH tracked and untracked yields
  // two valid porcelain lines, not one malformed concatenated line (` M a.ts?? b.md`).
  const uallOut = [tracked, untracked].filter(Boolean).join('\n');
  const collapsedOut = [tracked, untrackedCollapsed].filter(Boolean).join('\n');
  writeExecutable(
    join(binDir, 'git'),
    `#!/bin/sh
if echo "$*" | grep -q "status --porcelain"; then
  if echo "$*" | grep -q -- "-uno"; then
    printf '%s' '${tracked}'
  elif echo "$*" | grep -q -- "-uall"; then
    printf '%s' '${uallOut}'
  else
    printf '%s' '${collapsedOut}'
  fi
  exit 0
fi
exit 1
`
  );
  // Run reconciliation through the bounded timeout branch (see installPassthroughTimeout).
  installPassthroughTimeout(binDir);
}

test('untracked new code file is not downgraded (-uall fix) → strict blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-untracked-code-');
  const binDir = setupStubBin();
  // Real git: -uno hides this untracked .ts (old bug); plain --porcelain collapses the
  // new dir to "?? src/" (misses the .ts); only -uall surfaces the file itself.
  setupStubGitUntrackedAware(binDir, {
    tracked: '',
    untracked: '?? src/new-feature.ts',
    untrackedCollapsed: '?? src/',
  });
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'new untracked .ts must keep has_code_change → strict blocks');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('untracked new doc file is not downgraded (-uall fix) → strict blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-untracked-doc-');
  const binDir = setupStubBin();
  setupStubGitUntrackedAware(binDir, {
    tracked: '',
    untracked: '?? docs/new-guide.md',
    untrackedCollapsed: '?? docs/',
  });
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: true,
      doc_review: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'new untracked .md must keep has_doc_change → strict blocks');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.description.includes('/codex-review-doc'), 'should require doc review');
});

test('no timeout helper → -uall walk is not bounded → reconciliation skipped (fail-closed)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-no-timeout-');
  const binDir = setupStubBin();
  // git stub reports a CLEAN tree: if reconciliation runs, the stale has_code_change would
  // be downgraded true→false and stop allowed (status 0). Note: setupStubGit installs a
  // passthrough timeout, so we write the git stub directly to keep binDir timeout-free.
  writeExecutable(join(binDir, 'git'), `#!/bin/sh
if echo "$*" | grep -q "status --porcelain"; then
  printf '%s' ''
  exit 0
fi
exit 1
`);
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  // Force the no-timeout-helper branch on every host (PATH has no timeout/gtimeout).
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH: makeNoTimeoutPath(binDir) },
  });
  // No bounded path → reconciliation skipped → stale flag kept → fail-closed block.
  // (If a future regression reran bare unbounded git here, the clean tree would downgrade the
  //  flag and allow stop → status 0 → this assertion would fail.)
  assert.equal(result.status, 2, 'without a timeout helper, reconciliation is skipped → block');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('A3: git timeout fails open (trusts state file)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-a3-timeout-');
  const binDir = setupStubBin();
  // Stub git that sleeps longer than the 5s timeout — simulate via immediate failure
  // (actual timeout testing requires real sleep; we test the fallback path by making
  // git exit with code 124, which is what timeout returns on expiration)
  writeExecutable(join(binDir, 'git'), '#!/bin/sh\nexit 124\n');
  // Stub timeout to pass through to git (which will exit 124)
  writeExecutable(join(binDir, 'timeout'), `#!/bin/sh\nshift; exec "$@"\n`);
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  // Should block (trusts state file since git timed out / failed → __GIT_UNAVAILABLE__)
  assert.equal(result.status, 2, 'should block stop (trusts state file when git times out)');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('A3b: partial git stdout on timeout-kill is discarded → strict blocks (no fail-open)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-a3b-partial-');
  const binDir = setupStubBin();
  // Simulate a real timeout kill that lands AFTER git flushed a partial, non-code/non-doc
  // porcelain line: the timeout shim prints one line then exits 124 (never reaching the
  // .ts/.md entries git had not yet walked). The fixed hook keeps `|| sentinel` OUTSIDE the
  // command substitution, so the non-zero exit overwrites GIT_PORCELAIN with the EXACT
  // sentinel — the partial bytes are discarded and reconciliation is skipped. The old buggy
  // form `$(timeout ... || echo sentinel)` appended the sentinel to the partial line, so the
  // exact-match guard saw a 2-line string (≠ sentinel) and reconciled against the partial
  // output → no code/doc extension found → stale has_code_change downgraded true→false →
  // stop allowed (fail-OPEN, status 0). Asserting a block pins the fix against that regression.
  writeExecutable(join(binDir, 'timeout'), `#!/bin/sh
printf '%s\\n' ' M notes.txt'
exit 124
`);
  // Never reached via the shim above (it short-circuits before exec'ing git), but present so
  // any direct git call elsewhere in the hook cannot error the run.
  writeExecutable(join(binDir, 'git'), '#!/bin/sh\nexit 0\n');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'partial-output-on-kill must not downgrade the stale flag → block');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('git unavailable fails open (trusts state file)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-no-git-');
  const binDir = setupStubBin();
  // Stub git that always fails (simulates git not available / not a repo)
  writeExecutable(join(binDir, 'git'), '#!/bin/sh\nexit 128\n');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'should block stop (trusts state file when git unavailable)');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

// =============================================================================
// Dual-mode (review_mode=dual) tests
// =============================================================================

test('dual mode: aggregate_gate READY allows stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-dual-ready-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
      aggregate_gate: { executed: true, gate: 'READY' },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 0, 'dual mode READY should allow stop');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('dual mode: aggregate_gate BLOCKED blocks stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-dual-blocked-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
      aggregate_gate: { executed: true, gate: 'BLOCKED' },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 2, 'dual mode BLOCKED should block stop');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('dual mode: aggregate_gate not executed (fail-closed) blocks stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-dual-incomplete-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
      aggregate_gate: { executed: false, gate: null },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 2, 'fail-closed: incomplete aggregation should block');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('dual mode: forces strict blocking (ignores STOP_GUARD_MODE=warn)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-dual-force-strict-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: false },
      aggregate_gate: { executed: true, gate: 'READY' },
    })
  );
  // Explicitly set warn mode — dual mode should override to strict
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'dual mode should force strict even when STOP_GUARD_MODE=warn');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('dual mode: doc-only change not blocked by aggregate_gate', () => {
  const workDir = makeTempDir('sd0x-stop-guard-dual-doc-only-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: false,
      has_doc_change: true,
      doc_review: { passed: true },
      aggregate_gate: { executed: false, gate: null },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 0, 'doc-only change should not be blocked by aggregate_gate');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

// === Regression: sidecar must not silently escalate an explicit warn mode ===
// A transient lock race (self-clearing on the next edit / state update / session start) used to
// force GUARD_MODE=strict, blocking the stop for users who deliberately chose warn. Fail-closed
// GATE VALUES still apply in both cases; only the escalation is reason-scoped now.

test('transient sidecar (edit_lock_contention:code) keeps warn mode — warns, does not block', () => {
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-transient-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'edit_lock_contention:code');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 0, 'transient sidecar must not block a warn-mode stop');
  assert.match(result.stderr, /transient/, 'should report the transient classification');
});

// -----------------------------------------------------------------------------
// Per-event markers (`.blocked.event.*`) are the OTHER half of the sidecar, and until now this
// suite tested only the shared `.blocked` file. Neutering the whole `SIDECAR_EVENT_PREFIX` loop
// in `_sidecar_any` left every test here green — the plane was covered only incidentally, by a
// symlink-traversal suite whose fixtures happen to include a real marker. Incidental coverage
// evaporates the moment those fixtures change, so the primary behaviour is pinned directly.
//
// The two files are read as ONE set, not as alternatives: a writer takes the per-event path
// precisely when it could not serialize on the shared one, so a session can hold both at once
// and the classification must consider all of them.
// -----------------------------------------------------------------------------

function sidecarStateFixture(prefix) {
  const workDir = makeTempDir(prefix);
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
    })
  );
  return { workDir, binDir, transcriptPath };
}

test('a per-event marker ALONE (no shared .blocked) escalates warn to strict and blocks', () => {
  const { workDir, binDir, transcriptPath } = sidecarStateFixture('sd0x-stop-guard-event-only-');
  writeFileSync(join(workDir, '.claude_review_state.json.blocked.event.a1b2c3'), 'verdict_write_failed:code_review\n');
  assert.equal(existsSync(join(workDir, '.claude_review_state.json.blocked')), false, 'no shared file — the event marker must carry this alone');

  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'warn' } });

  assert.equal(result.status, 2, `a per-event marker is evidence of a lost verdict and must block; stderr: ${result.stderr}`);
  assert.match(result.stderr, /verdict_write_failed:code_review/, 'the reason must reach the diagnostic');
});

test('a per-event marker of only TRANSIENT reasons keeps warn mode (the allowlist spans both files)', () => {
  // Control for the test above: without this, "per-event ⇒ block" would pass just as well if the
  // hook ignored the transient allowlist on this plane and escalated unconditionally.
  const { workDir, binDir, transcriptPath } = sidecarStateFixture('sd0x-stop-guard-event-transient-');
  writeFileSync(join(workDir, '.claude_review_state.json.blocked.event.d4e5f6'), 'edit_lock_contention:code\n');

  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'warn' } });

  assert.equal(result.status, 0, 'a transient reason must not override the user’s warn preference, whichever file holds it');
  assert.match(result.stderr, /transient/, 'should report the transient classification');
});

test('the shared file and per-event markers are classified as ONE set, not as alternatives', () => {
  // The shared file alone would stay transient; the event marker alone would escalate. Read as a
  // union the verdict is "escalate" — and a hook that stopped at the first source it found (either
  // order) gets this wrong in one direction or the other.
  const { workDir, binDir, transcriptPath } = sidecarStateFixture('sd0x-stop-guard-sidecar-union-');
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'edit_lock_contention:code\n');
  writeFileSync(join(workDir, '.claude_review_state.json.blocked.event.99aabb'), 'state_write_failed:code\n');

  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'warn' } });

  assert.equal(result.status, 2, `one non-transient reason anywhere in the set escalates; stderr: ${result.stderr}`);
  assert.match(result.stderr, /edit_lock_contention:code/, 'the shared file’s reason must appear');
  assert.match(result.stderr, /state_write_failed:code/, 'and the per-event reason must appear alongside it');
});

test('unverifiable sidecar (state_init_failed) escalates warn to strict and blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-init-fail-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'state_init_failed');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'unverifiable state must block even in warn mode');
  assert.match(result.stderr, /escalating to strict/, 'should report the escalation');
});

// The sidecar became a SET of reasons (one per line) once writers started appending instead of
// overwriting — a single-value file let one plane erase another's evidence, which produced an
// allowed Stop in strict mode. Classification therefore has to read every line: transient only
// when ALL of them are, escalating as soon as ONE is not.
test('a multi-line sidecar of only TRANSIENT reasons stays transient (no spurious escalation)', () => {
  // Reading the file as one blob would send any multi-reason marker to the escalate branch. Safe,
  // but it would force strict on users who chose warn for a pair of ordinary lock races — the very
  // over-escalation the allowlist exists to prevent.
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-multi-transient-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: true }, precommit: { passed: true } })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'edit_lock_contention:doc\nlock_failure\n');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 0, 'warn mode must stay warn when every reason is transient');
  assert.match(result.stderr, /transient, fail-closed gates in warn mode/);
  assert.doesNotMatch(result.stderr, /escalating to strict/);
});

test('a multi-line sidecar escalates as soon as ONE reason is unverifiable', () => {
  // Severity must not depend on write order. Under the old last-writer-wins file, whichever plane
  // wrote second decided the classification for both.
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-multi-mixed-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: true }, precommit: { passed: true } })
  );
  writeFileSync(
    join(workDir, '.claude_review_state.json.blocked'),
    'edit_lock_contention\nverdict_write_failed:code_review\n'
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'one unverifiable reason is enough to escalate');
  assert.match(result.stderr, /escalating to strict/);
});

test('a legacy sidecar with NO trailing newline is still classified (last line must not be dropped)', () => {
  // `while read` returns non-zero on a final unterminated line. Dropping it would leave the only
  // reason present unseen, and an empty reason set reads as all-transient — a silent downgrade on
  // exactly the files every earlier version of these hooks wrote.
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-nonewline-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: true }, precommit: { passed: true } })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'verdict_write_failed:precommit');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /escalating to strict/);
});

test('an UNREADABLE sidecar escalates — it must not abort the hook', { skip: process.getuid && process.getuid() === 0 ? 'running as root: chmod 000 is not enforced' : false }, () => {
  // The worst failure this file can pin. `set -euo pipefail` is on, and the classification used to
  // read the sidecar with `tr '\n' ',' < "$f"`. That redirection is performed by the SHELL, so an
  // open failure is the shell's error, reported before `tr` runs — `2>/dev/null` redirects tr's
  // stderr and suppresses nothing. The substitution therefore returned non-zero and `set -e`
  // aborted the hook: exit 1, no JSON on stdout, which the harness reads as a hook ERROR and
  // ALLOWS the stop. A sidecar exists only because a blocking verdict was lost, so this failed open
  // at the one moment the file is load-bearing.
  //
  // The assertions are deliberately about BOTH channels: an exit code alone would not have caught
  // it (1 ≠ 0, so a naive "does not allow" check passes) — the tell is the missing JSON.
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-unreadable-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: true }, precommit: { passed: true } })
  );
  const sidecar = join(workDir, '.claude_review_state.json.blocked');
  writeFileSync(sidecar, 'verdict_write_failed:precommit\n');
  chmodSync(sidecar, 0o000);

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });

  chmodSync(sidecar, 0o644); // so the temp-dir cleanup can remove it
  assert.equal(result.status, 2, `an unreadable sidecar must BLOCK, not abort. stderr: ${result.stderr}`);
  assert.match(result.stderr, /escalating to strict/, 'unknown must default-deny');
  assert.doesNotMatch(result.stderr, /Permission denied/, 'the open failure must be handled, not leaked');
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false, 'a verdict must still be emitted — no JSON is what made this fail open');
});

test('a ZERO-BYTE sidecar escalates (an interrupted append is not "no reasons")', () => {
  // `_set_own_sidecar` appends with `>>`, so a writer that creates the file and dies before its
  // reason lands leaves exactly this. The classification loop can only DEMOTE the all-transient
  // flag, so zero readable lines would leave it at its `true` initializer — the mildest branch, for
  // a file that exists *because* a write failed.
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-empty-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: true }, precommit: { passed: true } })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), '');

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'an empty marker is unknown, and unknown default-denies');
  assert.match(result.stderr, /escalating to strict/);
});

test('a sidecar invalidates EVERY gate, so the demanded step matches the lost verdict', () => {
  // The sidecar block used to force only `DUAL_GATE_PASSED` and `DOC_REVIEW_PASSED` false, leaving
  // code_review and precommit standing on whatever the JSON said. With
  // `verdict_write_failed:precommit` — written precisely when a blocking precommit FAIL was lost
  // over a stale `passed: true` — the hook demanded `/codex-review-fast` and never mentioned
  // precommit. That is worse than incomplete: `_clear_own_sidecar` is keyed per gate, so only a
  // successful precommit write retires a `:precommit` marker. Running the demanded code review
  // cleared nothing, and the next Stop demanded it again — a livelock escapable only by guessing
  // which gate was really at issue.
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-allgates-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { executed: true, passed: true },
      precommit: { executed: true, passed: true },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'verdict_write_failed:precommit\n');

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr, /\/precommit/,
    'the gate whose verdict was lost must be among the demanded steps, or completing the demand '
      + 'cannot clear the marker that caused it'
  );
  assert.match(result.stderr, /\/codex-review-fast/, 'and the sidecar invalidates the code gate too');
});

// The transient classification used to be a DENYLIST: only `state_init_failed` escalated, so every
// reason added afterwards silently defaulted to the lenient branch. Three such reasons exist and
// none is a race — each records a write that FAILED, leaving a verdict that is wrong in the unsafe
// direction. These four cases pin the allowlist so re-widening it fails here.
for (const [reason, why] of [
  ['state_write_failed', 'a needed edit-transaction write failed, so a stale PASS may sit over an unreviewed edit'],
  ['verdict_write_failed', 'a BLOCKING verdict was lost over a prior passing one'],
  ['aggregate_write_failed', 'a BLOCKED aggregate transition never committed'],
  ['a_reason_this_version_does_not_know', 'an unrecognized marker is unverifiable by definition'],
]) {
  test(`unverifiable sidecar (${reason}) escalates warn to strict and blocks`, () => {
    const workDir = makeTempDir('sd0x-stop-guard-sidecar-esc-');
    const binDir = setupStubBin();
    const transcriptPath = join(workDir, 'transcript.json');
    writeFileSync(transcriptPath, '[]');
    writeFileSync(
      join(workDir, '.claude_review_state.json'),
      JSON.stringify({
        has_code_change: true,
        has_doc_change: false,
        code_review: { passed: true },
        precommit: { passed: true },
      })
    );
    writeFileSync(join(workDir, '.claude_review_state.json.blocked'), reason);
    const result = runHook({
      cwd: workDir,
      binDir,
      input: { transcript_path: transcriptPath },
      env: { STOP_GUARD_MODE: 'warn' },
    });
    assert.equal(result.status, 2, why);
    assert.match(result.stderr, /escalating to strict/);
  });
}

test('lock_failure stays TRANSIENT in warn mode (the allowlist must not over-escalate)', () => {
  // The complement of the four escalation cases: a genuine lock race must still respect an explicit
  // warn preference. Without this, "default-deny" would quietly become "always strict", which is
  // the behaviour warn users opted out of.
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-lockfail-warn-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'lock_failure');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 0, 'a resolved lock race must not block a warn-mode stop');
  assert.match(result.stderr, /transient/);
});

test('unrecognized review_mode ("duel") is treated as DUAL, not silently downgraded to single', () => {
  // The field-type guard proves only that review_mode is a STRING. A typo then fails every
  // `== "dual"` comparison, so dual mode degrades to single: no strict escalation, and the
  // aggregate BLOCKED verdict below stops being consulted — a corrupted field buying a weaker
  // gate. Fail-closed means an unrecognized enum member resolves to the SAFE member.
  const workDir = makeTempDir('sd0x-stop-guard-reviewmode-enum-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      review_mode: 'duel',
      code_review: { passed: true },
      precommit: { passed: true },
      aggregate_gate: { executed: true, gate: 'BLOCKED' },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 2, 'a BLOCKED aggregate gate must still be honoured under a typo\'d mode');
  assert.match(result.stderr, /Unrecognized review_mode/);
});

test('review_mode "single" is still single (the enum guard must not force everyone into dual)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-reviewmode-single-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      review_mode: 'single',
      code_review: { passed: true },
      precommit: { passed: true },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn' },
  });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /Unrecognized review_mode/);
});

test('dual mode: sidecar .blocked marker forces block', () => {
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
      aggregate_gate: { executed: true, gate: 'READY' },
    })
  );
  // Create sidecar marker — overrides the READY gate
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'lock_failure');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 2, 'sidecar .blocked marker should force block');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('sidecar .blocked marker forces doc review block (doc-only change)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-doc-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: true,
      doc_review: { passed: true },
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  // Sidecar should override doc_review.passed to false
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'lock_failure');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'sidecar should block doc-only change');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('backward compat: no review_mode field behaves as single mode', () => {
  const workDir = makeTempDir('sd0x-stop-guard-compat-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 0, 'no review_mode should behave as single mode');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

// =============================================================================
// Mode resolution priority (env > settings.local > settings > default)
// =============================================================================

test('mode resolution: env STOP_GUARD_MODE overrides settings', () => {
  const workDir = makeTempDir('sd0x-stop-guard-mode-env-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  // Create settings.json with warn
  mkdirSync(join(workDir, '.claude'), { recursive: true });
  writeFileSync(
    join(workDir, '.claude', 'settings.json'),
    JSON.stringify({ hooks_config: { stop_guard_mode: 'warn' } })
  );
  // Env overrides to strict
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', CLAUDE_PROJECT_DIR: workDir },
  });
  assert.equal(result.status, 2, 'env strict should block');
});

test('mode resolution: settings.local overrides settings.json', () => {
  const workDir = makeTempDir('sd0x-stop-guard-mode-local-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  mkdirSync(join(workDir, '.claude'), { recursive: true });
  writeFileSync(
    join(workDir, '.claude', 'settings.json'),
    JSON.stringify({ hooks_config: { stop_guard_mode: 'warn' } })
  );
  writeFileSync(
    join(workDir, '.claude', 'settings.local.json'),
    JSON.stringify({ hooks_config: { stop_guard_mode: 'strict' } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.equal(result.status, 2, 'settings.local strict should block');
});

test('mode resolution: settings.json fallback', () => {
  const workDir = makeTempDir('sd0x-stop-guard-mode-settings-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  mkdirSync(join(workDir, '.claude'), { recursive: true });
  writeFileSync(
    join(workDir, '.claude', 'settings.json'),
    JSON.stringify({ hooks_config: { stop_guard_mode: 'strict' } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.equal(result.status, 2, 'settings.json strict should block');
});

test('mode resolution: env.STOP_GUARD_MODE in settings.json (canonical path)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-mode-env-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  mkdirSync(join(workDir, '.claude'), { recursive: true });
  writeFileSync(
    join(workDir, '.claude', 'settings.json'),
    JSON.stringify({ env: { STOP_GUARD_MODE: 'strict' } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.equal(result.status, 2, 'env.STOP_GUARD_MODE=strict in settings should block');
});

test('mode resolution: default warn when no config', () => {
  const workDir = makeTempDir('sd0x-stop-guard-mode-default-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 0, 'default should be warn (allow stop)');
  const payload = parseJson(result.stdout);
  assert.ok(payload.ok);
});

test('mode resolution: invalid value falls back to warn', () => {
  const workDir = makeTempDir('sd0x-stop-guard-mode-invalid-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  mkdirSync(join(workDir, '.claude'), { recursive: true });
  writeFileSync(
    join(workDir, '.claude', 'settings.json'),
    JSON.stringify({ hooks_config: { stop_guard_mode: 'invalid' } })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.equal(result.status, 0, 'invalid mode should fallback to warn');
  assert.match(result.stderr, /Invalid GUARD_MODE/);
});

// =============================================================================
// Arbitration guard (plugin-defers-to-local)
// =============================================================================

function setupLocalHook(dir, scriptName) {
  const hooksDir = join(dir, '.claude', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeExecutable(join(hooksDir, scriptName), '#!/bin/bash\nexit 0');
}

function writeSettingsWithHook(dir, scriptName, fileName) {
  const claudeDir = join(dir, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(
    join(claudeDir, fileName || 'settings.json'),
    JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: `"$CLAUDE_PROJECT_DIR"/.claude/hooks/${scriptName}`,
              },
            ],
          },
        ],
      },
    })
  );
}

test('arbitration: defers when local hook exists and registered in settings', () => {
  const workDir = makeTempDir('sd0x-stop-guard-arb-defer-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  setupLocalHook(workDir, 'stop-guard.sh');
  writeSettingsWithHook(workDir, 'stop-guard.sh');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  // Should exit 0 (defer) without producing stop-guard output
  assert.equal(result.status, 0, 'should defer to local hook');
  // Deferred exit produces no JSON output (silent exit 0)
  assert.ok(
    !result.stdout.includes('"ok"'),
    'should not produce stop-guard JSON output'
  );
});

test('arbitration: dev mode bypass when hooks/hooks.json exists', () => {
  const workDir = makeTempDir('sd0x-stop-guard-arb-dev-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // Create hooks/hooks.json (dev mode marker)
  mkdirSync(join(workDir, 'hooks'), { recursive: true });
  writeFileSync(join(workDir, 'hooks', 'hooks.json'), '{}');
  setupLocalHook(workDir, 'stop-guard.sh');
  writeSettingsWithHook(workDir, 'stop-guard.sh');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  // Should run normally (not defer) — produces stop-guard output
  assert.ok(
    result.stdout.includes('"ok"'),
    'should run normally in dev mode'
  );
});

test('arbitration: no local hook runs normally', () => {
  const workDir = makeTempDir('sd0x-stop-guard-arb-nohook-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // Settings exist but no local hook file
  writeSettingsWithHook(workDir, 'stop-guard.sh');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.ok(
    result.stdout.includes('"ok"'),
    'should run normally when no local hook'
  );
});

test('arbitration: CLAUDE_PROJECT_DIR unset runs normally', () => {
  const workDir = makeTempDir('sd0x-stop-guard-arb-noenv-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.ok(
    result.stdout.includes('"ok"'),
    'should run normally without CLAUDE_PROJECT_DIR'
  );
});

test('arbitration: local hook exists but not in settings runs normally', () => {
  const workDir = makeTempDir('sd0x-stop-guard-arb-noreg-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  setupLocalHook(workDir, 'stop-guard.sh');
  // No settings file — fail-open
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.ok(
    result.stdout.includes('"ok"'),
    'should run normally when not registered in settings'
  );
});

test('arbitration: defers via grep fallback when jq unavailable', () => {
  const workDir = makeTempDir('sd0x-stop-guard-arb-nojq-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  setupLocalHook(workDir, 'stop-guard.sh');
  writeSettingsWithHook(workDir, 'stop-guard.sh');
  // Run with restricted PATH — no jq available (grep fallback)
  const noJqBin = makeTempDir('sd0x-stop-guard-nojq-bin-');
  const result = spawnSync('bash', [hookPath], {
    cwd: workDir,
    input: JSON.stringify({ transcript_path: transcriptPath }),
    encoding: 'utf8',
    env: {
      PATH: `${noJqBin}:/usr/bin:/bin`,
      CLAUDE_PROJECT_DIR: workDir,
      HOME: process.env.HOME,
    },
  });
  assert.equal(result.status, 0, 'should defer via grep fallback');
  assert.ok(
    !result.stdout.includes('"ok"'),
    'should not produce stop-guard JSON output (deferred)'
  );
});

test('arbitration: registered in settings.local.json defers', () => {
  const workDir = makeTempDir('sd0x-stop-guard-arb-local-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  setupLocalHook(workDir, 'stop-guard.sh');
  writeSettingsWithHook(workDir, 'stop-guard.sh', 'settings.local.json');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.equal(result.status, 0, 'should defer via settings.local.json');
  assert.ok(
    !result.stdout.includes('"ok"'),
    'should not produce stop-guard JSON output'
  );
});

// ---------------------------------------------------------------------------
// D-1: Recursion guard (stop_hook_active)
// ---------------------------------------------------------------------------

test('recursion guard: stop_hook_active=true exits 0 immediately', () => {
  const workDir = makeTempDir('sd0x-stop-guard-recursion-');
  const binDir = setupStubBin();
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { stop_hook_active: true, transcript_path: '' },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'stop_hook_active=true should exit 0 even in strict mode');
});

test('recursion guard: stop_hook_active absent behaves normally', () => {
  const workDir = makeTempDir('sd0x-stop-guard-no-recursion-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'without stop_hook_active, strict mode should block');
});

// =============================================================================
// Shell-hook gating (.sh/.bash/.zsh treated as code — this repo is .sh-primary)
// =============================================================================

test('dirty shell hook (.sh) keeps has_code_change → strict blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-sh-code-');
  const binDir = setupStubBin();
  // Only a .sh file is dirty. Before the fix, the reconciler regex excluded .sh, so the
  // one-way true→false reconciliation cleared has_code_change and allowed stop (fail-OPEN
  // for this .sh-primary repo). Now .sh is code → flag kept → strict blocks.
  setupStubGit(binDir, ' M hooks/stop-guard.sh');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'a dirty .sh hook is code → gate stays engaged');
  assert.equal(parseJson(result.stdout).ok, false);
});

// =============================================================================
// jq-unavailable fail-closed (dependency loss must not bypass the gate)
// =============================================================================

// Build a PATH that has every tool stop-guard needs EXCEPT jq (macOS ships jq in /usr/bin, so
// `/usr/bin:/bin` is NOT jq-free). cleanDir symlinks the real system tools by name, omitting jq —
// mirrors makeNoTimeoutPath. This deterministically exercises the jq-unavailable branch on any host.
function makeNoJqPath() {
  const cleanDir = makeTempDir('sd0x-stop-guard-nojq-clean-');
  const needed = ['bash', 'sh', 'env', 'grep', 'sed', 'cat', 'basename', 'head', 'tail', 'printf', 'dirname'];
  const script = needed.map((n) => `command -v ${n} || true`).join('; ');
  const resolved = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  for (const realPath of (resolved.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
    if (!existsSync(realPath)) continue;
    const name = realPath.slice(realPath.lastIndexOf('/') + 1);
    try {
      symlinkSync(realPath, join(cleanDir, name));
    } catch {
      /* already linked — skip */
    }
  }
  return cleanDir;
}

// Run stop-guard with a jq-free PATH. No local-hook/settings setup → arbitration does not defer,
// so the hook reaches the jq-availability check.
function runHookNoJq({ cwd, input, env = {} }) {
  return spawnSync('bash', [hookPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      PATH: makeNoJqPath(),
      CLAUDE_PROJECT_DIR: cwd,
      HOME: process.env.HOME,
      ...env,
    },
  });
}

test('jq unavailable + pending state file + strict → fail-closed block', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-strict-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  const result = runHookNoJq({
    cwd: workDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'missing jq must not bypass the gate when review state exists (strict)');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('jq unavailable + pending state file + warn → allow with warning', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-warn-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  // No STOP_GUARD_MODE → default warn (jq missing → settings unreadable → default applies).
  const result = runHookNoJq({ cwd: workDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 0, 'warn mode is non-blocking even when jq missing');
  assert.equal(parseJson(result.stdout).ok, true);
  assert.match(result.stderr, /jq unavailable/);
});

test('jq unavailable + no state file → allow stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-nostate-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // No .claude_review_state.json and no sidecar → nothing to enforce.
  const result = runHookNoJq({
    cwd: workDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'no review state → allow stop even without jq');
  assert.equal(parseJson(result.stdout).ok, true);
});

test('jq unavailable + stop_hook_active=true → recursion guard allows (no infinite block)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-recursion-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  // Even with a pending state file in strict mode, an active stop-hook re-entry must short-circuit
  // — otherwise the fail-closed block would loop forever when jq is absent.
  const result = runHookNoJq({
    cwd: workDir,
    input: { stop_hook_active: true, transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, 'recursion guard must short-circuit even without jq');
});

test('jq unavailable + strict configured via settings (no env) → fail-closed block', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-settings-strict-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  // Strict configured ONLY via settings.json (not env). _resolve_guard_mode reads settings via
  // jq; without a jq-free fallback it would default to warn and the jq-unavailable branch would
  // allow stop — defeating the fail-closed fix for projects that configure mode in settings.
  mkdirSync(join(workDir, '.claude'), { recursive: true });
  writeFileSync(
    join(workDir, '.claude', 'settings.json'),
    JSON.stringify({ env: { STOP_GUARD_MODE: 'strict' } })
  );
  // No STOP_GUARD_MODE env → mode must come from settings via the jq-free fallback.
  const result = runHookNoJq({ cwd: workDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 2, 'settings-configured strict must block even when jq is missing');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('dirty .bash script keeps has_code_change → strict blocks (alternation pin)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-bash-code-');
  const binDir = setupStubBin();
  // Pins bash|zsh in the reconciler (not just sh): a dirty .bash file is code → no downgrade.
  setupStubGit(binDir, ' M scripts/deploy.bash');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'a dirty .bash script is code → gate stays engaged');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('jq unavailable + strict split across physical lines (multi-line JSON) → fail-closed block', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-multiline-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  // Valid JSON where the key and its value sit on DIFFERENT physical lines. A line-oriented grep
  // sees `"STOP_GUARD_MODE":` and `"strict"` on separate lines → matches neither → falls through
  // to warn → the jq-unavailable branch ALLOWS stop. That is a fail-OPEN. The fix collapses
  // newlines (bash parameter expansion ${_raw//$'\n'/}) before grep, so the key/value reunite
  // and strict is detected.
  mkdirSync(join(workDir, '.claude'), { recursive: true });
  writeFileSync(
    join(workDir, '.claude', 'settings.json'),
    '{\n  "env": {\n    "STOP_GUARD_MODE":\n      "strict"\n  }\n}\n'
  );
  const result = runHookNoJq({ cwd: workDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 2, 'multi-line strict must still block when jq is missing (no fail-open)');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('jq unavailable + strict via legacy hooks_config.stop_guard_mode → fail-closed block', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-legacy-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  // The jq path resolves both env.STOP_GUARD_MODE and legacy hooks_config.stop_guard_mode; the
  // jq-free fallback alternation must pin the legacy shape too, else a legacy-configured strict
  // project silently degrades to warn under a missing jq.
  mkdirSync(join(workDir, '.claude'), { recursive: true });
  writeFileSync(
    join(workDir, '.claude', 'settings.json'),
    JSON.stringify({ hooks_config: { stop_guard_mode: 'strict' } })
  );
  const result = runHookNoJq({ cwd: workDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 2, 'legacy hooks_config strict must block even when jq is missing');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('dirty .zsh script keeps has_code_change → strict blocks (alternation pin)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-zsh-code-');
  const binDir = setupStubBin();
  // Completes the sh|bash|zsh reconciler alternation pin (writer side is covered in
  // post-edit-format.test.js): a dirty .zsh file is code → no stale-flag downgrade.
  setupStubGit(binDir, ' M scripts/build.zsh');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'a dirty .zsh script is code → gate stays engaged');
  assert.equal(parseJson(result.stdout).ok, false);
});

// === Missing-transcript must not bypass the state-file gate (fail-open P0 pin) ===
// The state file is the PRIMARY enforcement source and needs no transcript. A missing/
// unreadable transcript previously short-circuited to {"ok":true} BEFORE consulting the
// state file — letting a pending strict/dual gate be silently cleared (fail-OPEN). These
// tests pin the fall-through: a reverted fix (unconditional exit 0 on missing transcript)
// makes the strict cases below return 0 and FAIL.

test('strict + missing transcript + pending code-review state → block (fail-open pin)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-notranscript-strict-');
  const binDir = setupStubBin();
  // Deliberately do NOT create the transcript file — points at a nonexistent path.
  const transcriptPath = join(workDir, 'does-not-exist.jsonl');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'single',
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
      doc_review: { passed: true },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'missing transcript must defer to pending state, not allow stop');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('warn (single) + missing transcript + pending state → allow (warn preserved)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-notranscript-warn-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'does-not-exist.jsonl');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'single',
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
      doc_review: { passed: true },
    })
  );
  // Default (warn) mode: the fix must not over-block — single-mode warn still allows stop.
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 0, 'warn mode keeps allowing stop even with missing transcript');
  assert.equal(parseJson(result.stdout).ok, true);
});

test('strict + missing transcript + blocked sidecar without state file → fail closed', () => {
  const workDir = makeTempDir('sd0x-stop-guard-notranscript-sidecar-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'does-not-exist.jsonl');
  // Sidecar present, main state file ABSENT → state unverifiable → strict must block.
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'lock-failed');
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'sidecar-only + missing transcript must fail closed in strict');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('jq unavailable + stop_hook_active split across physical lines → recursion guard allows (no block loop)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-recursion-multiline-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // Pending strict state exists: without the recursion guard catching stop_hook_active=true,
  // the jq-unavailable branch would fail-closed (exit 2) on every re-fire → infinite block loop.
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  // Raw multi-line JSON with the recursion flag split across physical lines (valid JSON). A
  // line-oriented grep would miss it; the newline-collapse in the recursion guard reunites it.
  const rawInput = '{\n  "transcript_path":\n    "' + transcriptPath + '",\n  "stop_hook_active":\n    true\n}\n';
  const result = spawnSync('bash', [hookPath], {
    cwd: workDir,
    input: rawInput,
    encoding: 'utf8',
    env: {
      PATH: makeNoJqPath(),
      CLAUDE_PROJECT_DIR: workDir,
      HOME: process.env.HOME,
      STOP_GUARD_MODE: 'strict',
    },
  });
  assert.equal(result.status, 0, 'multi-line stop_hook_active must be recognized → allow, not block-loop');
  assert.match(parseJson(result.stdout).reason || '', /recursion guard/);
});

// ── Sidecar / jq-unavailable fail-closed corners (P0-1 / P0-2) ──────────────────
// The sidecar (.blocked) is the strongest fail-closed marker; the jq-available state-file path
// forces strict on it. These tests pin the gap paths where it must NOT be downgraded to a warn
// allow: (P0-2) a readable transcript routing a sidecar-only state into legacy transcript
// parsing, and (P0-1) a missing jq letting a sidecar or a dual-mode gate exit in warn.

test('jq available + sidecar-only + readable transcript → fail closed (P0-2 pin)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-sidecar-only-readable-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]'); // readable, empty → legacy parse would find no change
  // Sidecar present, main state file ABSENT. A reverted hoist would skip the sidecar handler
  // (it lives inside the transcript-missing branch and inside `[[ -f STATE_FILE ]]`), fall to
  // USE_STATE_FILE=false, parse the empty transcript, and ALLOW (status 0).
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'lock-failed');
  // Default (warn) mode: sidecar must still fail closed regardless of warn.
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 2, 'sidecar-only + readable transcript must fail closed, not parse-allow');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('jq unavailable + blocked sidecar (warn default) → fail closed (P0-1 sidecar pin)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-sidecar-warn-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // Sidecar present (no main state file needed). Pre-fix, the jq-missing branch only blocked in
  // strict, so warn-default + sidecar would ALLOW (status 0) — inconsistent with the jq-available
  // path that forces strict on any sidecar.
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'lock-failed');
  const result = runHookNoJq({ cwd: workDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 2, 'jq-missing + sidecar must fail closed even in warn');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('jq unavailable + dual-mode state (warn default) → fail closed (P0-1 dual pin)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-dual-warn-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  // review_mode=dual forces strict wherever jq is available; without jq, a jq-free grep must
  // still detect it. Pre-fix, warn-default would ALLOW (status 0). No sidecar here → isolates
  // the dual-detection path from the sidecar path above.
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHookNoJq({ cwd: workDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 2, 'jq-missing + dual-mode state must fail closed even in warn');
  assert.equal(parseJson(result.stdout).ok, false);
});

test('jq unavailable + present-but-unreadable state file → fail closed (P2 set-e pin)', () => {
  // The jq-missing dual-detection read must not abort under `set -e` on an unreadable state
  // file: a bare `_state_flat=$(cat …)` would exit 1 (a non-blocking hook error → fail-OPEN).
  // The guarded read fails closed (exit 2) instead.
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) return; // root bypasses chmod 000 → cannot simulate an unreadable file
  const workDir = makeTempDir('sd0x-stop-guard-nojq-unreadable-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  const statePath = join(workDir, '.claude_review_state.json');
  writeFileSync(
    statePath,
    JSON.stringify({ has_code_change: true, code_review: { passed: false }, precommit: { passed: false } })
  );
  chmodSync(statePath, 0o000); // present (`-f` true) but `cat` fails
  const result = runHookNoJq({ cwd: workDir, input: { transcript_path: transcriptPath } });
  chmodSync(statePath, 0o644); // restore so temp-dir cleanup can remove it
  assert.equal(result.status, 2, 'unreadable state + jq missing must fail closed, not set-e abort (exit 1)');
  assert.equal(parseJson(result.stdout).ok, false);
});

// =============================================================================
// plan-review-loop v1 (T4): plan sentinel isolation + warn-only pending advisory
// =============================================================================

test('plan T4: transcript strict — ⛔ Plan Blocked after code gate pass does not block stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-plan-blocked-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  // Plan sentinel lines come LAST: without the grep -vE plan filter, `⛔ Plan Blocked`
  // would win the last-verdict scan via the `⛔.*Block` pattern and falsely block.
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: ✅',
    'user: /precommit',
    '## Overall: ✅ PASS',
    '## Plan Review',
    '⛔ Plan Blocked',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, `plan sentinel must be isolated from code gate, stderr: ${result.stderr}`);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('plan T4: transcript strict — ✅ Plan Ready must not overwrite a code-blocked verdict', () => {
  const workDir = makeTempDir('sd0x-stop-guard-plan-ready-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  // Code review blocked, then plan review passes. Without the plan filter the
  // last-verdict scan would pick `✅ Plan Ready` and falsely allow the stop.
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: ⛔',
    'user: /precommit',
    '## Plan Review',
    '✅ Plan Ready',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, '✅ Plan Ready must not satisfy the code review gate');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('plan T4: code verdict mentioning "Plan Review" in prose is not suppressed (substring strip, not line drop)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-plan-prose-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  // Transcript is JSONL: one line packs a whole message, so a genuine ⛔ code gate
  // and the words "Plan Review" can share a single line. Whole-line grep -v would
  // drop the verdict entirely (false allow); substring stripping must keep it.
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: ⛔ — fix the Plan Review trail summary emitted by skills/plan-review',
  ].join('\n');
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'code ⛔ verdict on a line mentioning Plan Review must still block');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('plan pending: state file warn mode — pending plan review warns on stderr but allows stop', () => {
  const workDir = makeTempDir('sd0x-stop-guard-plan-pending-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: false,
      code_review: { passed: false },
      doc_review: { passed: false },
      precommit: { passed: false },
      plan_review: { executed: true, passed: false, degraded: false, skipped: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.ok(
    result.stderr.includes('Plan review in progress'),
    `pending plan review should emit stderr advisory, got: ${result.stderr}`
  );
});

test('plan pending: state file strict — pending plan never joins MISSING (all other gates passed)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-plan-strict-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
      plan_review: { executed: true, passed: false, degraded: false, skipped: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 0, `plan pending must be warn-only even in strict mode, stderr: ${result.stderr}`);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.ok(result.stderr.includes('Plan review in progress'));
});

test('plan pending: degraded plan review does not emit pending advisory', () => {
  const workDir = makeTempDir('sd0x-stop-guard-plan-degraded-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: false,
      plan_review: { executed: true, passed: false, degraded: true, skipped: false, status_reason: 'reviewer-unavailable' },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
  });
  assert.equal(result.status, 0);
  assert.ok(
    !result.stderr.includes('Plan review in progress'),
    `degraded plan is terminal, not pending; got: ${result.stderr}`
  );
});

test('plan pending: terminal/inactive plan states do not emit pending advisory', () => {
  const fixtures = [
    { name: 'passed', plan_review: { executed: true, passed: true, degraded: false, skipped: false } },
    { name: 'skipped', plan_review: { executed: true, passed: false, degraded: false, skipped: true, status_reason: 'user-skip' } },
    { name: 'needs-human', plan_review: { executed: true, passed: false, degraded: false, skipped: false, status_reason: 'needs-human' } },
    { name: 'not-executed', plan_review: { executed: false, passed: false, degraded: false, skipped: false } },
    { name: 'absent', plan_review: undefined },
  ];
  for (const fixture of fixtures) {
    const workDir = makeTempDir(`sd0x-stop-guard-plan-neg-${fixture.name}-`);
    const binDir = setupStubBin();
    const transcriptPath = join(workDir, 'transcript.json');
    writeFileSync(transcriptPath, '[]');
    const state = { has_code_change: false, has_doc_change: false };
    if (fixture.plan_review) state.plan_review = fixture.plan_review;
    writeFileSync(join(workDir, '.claude_review_state.json'), JSON.stringify(state));
    const result = runHook({
      cwd: workDir,
      binDir,
      input: { transcript_path: transcriptPath },
    });
    assert.equal(result.status, 0, `${fixture.name}: should allow stop`);
    assert.ok(
      !result.stderr.includes('Plan review in progress'),
      `${fixture.name}: must not emit pending advisory, got: ${result.stderr}`
    );
  }
});

// === deep-explore regression: strict exit-2 stderr must carry the guidance ===
// On exit 2 only stderr reaches the model; the stdout JSON description is
// consumed by tests alone. Pin that the actionable content is on stderr.
// R2 turned that content from an order into a statement of what the state holds — which step is
// outstanding, and that the gate is shut until it is discharged. Both halves are pinned below: a
// gate-state sentence with no step named would be as useless to the model as JSON it never sees.

test('strict block puts actionable content on stderr (not only stdout JSON)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-stderr-guidance-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: true },
      doc_review: { passed: true },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Missing steps:.*\/codex-review-fast/,
    `stderr must name the outstanding step, got: ${result.stderr}`
  );
  assert.match(
    result.stderr,
    /the gate stays shut until each is discharged/,
    `stderr must say the gate is still shut, got: ${result.stderr}`
  );
});

// R2 AC7: the strict-Stop path is one of the five that must be shown to DELIVER the fact block, not
// merely to contain it in source. This is the highest-stakes of the five — on exit 2 stderr is the
// only channel the model sees, so a block emitted to stdout, or skipped by a branch that returns
// first, would be invisible exactly when the session is being held open.
test('strict Stop delivers the [AUTO_LOOP_STATE] block on stderr with the pending planes', () => {
  const workDir = makeTempDir('sd0x-stop-guard-alf-delivery-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
      doc_review: { passed: true },
      review_phase: 'pending_review',
      iteration_history: { current_round: 2, max_rounds: 30 },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 2, `strict must block; stderr: ${result.stderr}`);
  const line = result.stderr.split('\n').find((l) => l.startsWith('[AUTO_LOOP_STATE]'));
  assert.ok(line, `no fact block reached stderr; got: ${result.stderr}`);
  assert.match(line, /event=stop_attempt\b/);
  assert.match(line, /\bmode=strict\b/, 'the mode decides whether this stop is advisory — it is a fact the model needs');
  assert.match(line, /change=code\b/);
  assert.match(line, /receipts=code_review:false,doc_review:true,precommit:false/,
    'receipts must reflect the state file, not the MISSING string re-parsed');
  // Values, not just shape: this state file is fully populated, so a `phase=unknown` here would mean
  // the read silently failed rather than that the state was genuinely unknown.
  assert.match(line, /\bphase=pending_review\b/);
  assert.match(line, /\bround=2\/30\b/);
  assert.match(line, /pending=code_review,precommit\b/,
    'pending names planes and must list both outstanding ones');
  assert.ok(!result.stdout.includes('[AUTO_LOOP_STATE]'),
    'stdout carries the hook-protocol JSON — a stray fact line there risks being read as part of the verdict');
});

test('with no state file the fact line says so and still reports every field', () => {
  // The transcript fallback is the degraded path, and it is exactly where an unproven verdict is
  // least affordable. Two things must hold: the reader is told the facts came from the transcript,
  // and no field renders empty — on a zero-byte or absent state file `jq -r '.x // "d"'` prints
  // nothing and exits 0, so neither the filter default nor a `|| echo` fallback fires.
  const workDir = makeTempDir('sd0x-stop-guard-alf-nostate-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.txt');
  // An edit the fallback can see, and no review after it — otherwise there is no obligation and
  // the hook has nothing to report.
  writeFileSync(transcriptPath,
    '{"tool_name":"Edit","tool_input":{"file_path":"src/app.ts"}}\n');
  // Deliberately no .claude_review_state.json.

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  const line = result.stderr.split('\n').find((l) => l.startsWith('[AUTO_LOOP_STATE]'));
  assert.ok(line, `no fact block reached stderr; got: ${result.stderr}`);
  assert.match(line, /\bsource=transcript\b/,
    'a reader must be able to tell a transcript-derived verdict from a persisted one');
  assert.match(line, /degraded=no_state_file\b/);
  // Shape, not values: the whole point is that the values are unknown here. Empty is the failure.
  assert.match(line, /\bphase=\S+/, `phase rendered empty: ${JSON.stringify(line)}`);
  assert.match(line, /\bround=\d+\/\d+\b/, `round/cap rendered empty: ${JSON.stringify(line)}`);
  assert.match(line, /\btier=(fast|standard|thorough)\b/, `tier rendered empty: ${JSON.stringify(line)}`);
  assert.match(line, /\breceipts=\S+/, `receipts rendered empty: ${JSON.stringify(line)}`);
  assert.match(line, /\bpending=\S+/, `pending rendered empty: ${JSON.stringify(line)}`);
});

// === deep-explore regression: .ipynb counts as code in reconciliation ===
// post-edit-format classifies notebook edits as code changes; the porcelain
// reconciliation here must agree, or a dirty notebook downgrades
// has_code_change to false and strict stop lets the session end unreviewed.

test('dirty .ipynb in porcelain keeps has_code_change true (strict blocks)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-ipynb-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M analysis/model.ipynb');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'dirty notebook must not be reconciled away as non-code');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('transcript strict: NotebookEdit without review blocks (fallback tool filter)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-transcript-nb-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript =
    '{"tool_name":"NotebookEdit","tool_input":{"notebook_path":"analysis/model.ipynb"}}\n';
  writeFileSync(transcriptPath, transcript);
  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });
  assert.equal(result.status, 2, 'notebook edit in transcript must count as a code change');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
});

test('jq unavailable + no state file → allows stop but stderr notes gates UNENFORCED', () => {
  const workDir = makeTempDir('sd0x-stop-guard-nojq-nostate-');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  const result = runHookNoJq({ cwd: workDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 0, 'nothing to enforce without state file');
  assert.match(result.stderr, /UNENFORCED/, `stderr must warn enforcement is off, got: ${result.stderr}`);
});

test('non-numeric current_round does not execute a command substitution (arithmetic injection)', () => {
  // `[[ x -ge y ]]` evaluates BOTH operands as arithmetic expressions, and arithmetic evaluation
  // expands command substitution inside an array subscript. `.claude_review_state.json` is an
  // ordinary working-tree file — written by hooks but writable by anything, a fanout worker
  // included — so a crafted counter is an execution vector inside the Stop hook. Reproduced
  // standalone before the fix: with any existing variable name as the array base, the payload's
  // `touch` ran, evaluation then continued normally, and nothing was logged.
  const workDir = makeTempDir('sd0x-stop-guard-arith-inject-');
  const binDir = setupStubBin();
  const sentinel = join(workDir, 'ARITH_INJECTION_RAN');
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      // `MISSING` is a real variable in stop-guard's scope, so it is a valid array base.
      iteration_history: { current_round: `MISSING[$(touch ${sentinel})]`, max_rounds: 10 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  assert.equal(existsSync(sentinel), false, 'the payload must never be evaluated');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, 'unparseable counters cannot prove the budget is unspent');
  assert.match(payload.reason || '', /not valid bounded integers/i, 'and the reason must name the corruption');
});

test('numeric-prefixed current_round ("12abc") blocks instead of silently disarming the hard cap', () => {
  // The same string shape ALSO defeats the cap without any payload: `[[ "12abc" -ge 10 ]]` aborts
  // with "value too great for base", the old `2>/dev/null` swallowed the message, and the failed
  // test read as "under the cap" — so the loop ran unbounded, which is precisely what the hard cap
  // exists to prevent. Verified standalone: the pre-fix compare took the LT branch.
  const workDir = makeTempDir('sd0x-stop-guard-arith-badnum-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: '12abc', max_rounds: 10 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, 'a corrupt counter must not read as "under the cap"');
  assert.match(payload.reason || '', /not valid bounded integers/i);
});

test('valid numeric counters still take the normal hard-cap path (digit guard is not over-strict)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-arith-ok-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 10, max_rounds: 10 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason || '', /Review round cap reached \(10\/10\)/);
});

// === R6: cap-hit message neutrality (executed hook, not source grep) ===

test('cap-hit message is a neutral fact — no disposition verdict, strict exits 2', () => {
  const workDir = makeTempDir('sd0x-stop-guard-cap-neutral-strict-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 30, max_rounds: 30 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  assert.equal(result.status, 2, 'strict mode still blocks with exit 2 (exit branch unchanged)');
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /Review round cap reached \(30\/30\)/, 'reports round/cap as fact');
  // Pins the BLOCKED_REASON ↔ `grep -q "Review round cap reached"` matcher coupling: if the
  // matcher drifts, description falls back to the generic findings line and this fails.
  assert.equal(
    parseJson(result.stdout).description,
    'Review round cap reached; see the round/cap values in the reason',
    'cap-specific BLOCK_DESC is selected (message/matcher in sync)'
  );
  assert.match(result.stderr, /\[Stop Guard\] Review round cap reached; see the round\/cap values in the reason/, 'strict stderr carries the same neutral description');
  assert.ok(!/do not auto-retry/i.test(combined), 'no auto-retry prohibition — disposition belongs to rules');
  assert.ok(!/escalate to human/i.test(combined), 'no escalation directive — disposition belongs to rules');
  assert.ok(!/needs human intervention.*cap|cap.*needs human intervention/i.test(combined), 'cap line carries no intervention verdict');
});

test('cap-hit in warn mode: same neutral message, exit 0 (exit branch unchanged)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-cap-neutral-warn-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 31, max_rounds: 30 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'warn' } });
  assert.equal(result.status, 0, 'warn mode lets the stop through');
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /Review round cap reached \(31\/30\)/, 'over-cap value reported verbatim (lower bound semantics)');
  assert.ok(!/do not auto-retry/i.test(combined), 'warn path is equally neutral');
  assert.ok(!/escalate to human/i.test(combined), 'warn path is equally neutral');
});

test('cap-hit WITH an event-plane marker stays neutral in strict mode (the marker fact displaces, never adjudicates)', () => {
  // AC7's "no context-dependent divergence" reaches its hardest case here: a sidecar marker
  // coexisting with the cap used to swap the description to `Do not auto-retry:` — an imperative
  // on a cap-reachable path. The marker fact must still displace the cap description (an
  // unretireable obligation outranks it), but as a fact, not a verdict.
  const workDir = makeTempDir('sd0x-stop-guard-cap-marker-strict-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 30, max_rounds: 30 },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked.event.c0ffee'), 'aggregate_write_failed\n');

  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  assert.equal(result.status, 2, 'strict mode still blocks with exit 2 (exit branch unchanged)');
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /Review round cap reached \(30\/30\)/, 'the cap fact (round/cap) survives in the reason');
  const json = parseJson(result.stdout);
  assert.match(json.description, /Unretireable obligation:.*sidecar marker is present/,
    'the marker is reported as a fact — the obligation is stated, the disposition is not');
  assert.match(json.description, /No review, precommit or edit retires it/, 'why working it off will not help is carried');
  assert.match(result.stderr, /No review, precommit or edit retires it/, 'the same fact reaches stderr, where the model reads it on exit 2');
  assert.ok(!/auto-retry|retry in a loop/i.test(combined), 'no retry prohibition even with a marker present');
  assert.ok(!/escalate to human/i.test(combined), 'no escalation directive even with a marker present');
  assert.ok(!/is still correct|should|must not/i.test(json.description), 'no action appraisal either — state description only');
});

test('cap-hit WITH a transient event-plane marker stays neutral in warn mode, exit 0', () => {
  // Transient marker reason so warn mode is not escalated to strict — this pins the warn-path
  // printf, which carries its own copy of the marker description string.
  const workDir = makeTempDir('sd0x-stop-guard-cap-marker-warn-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 31, max_rounds: 30 },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked.event.c0ffee'), 'edit_lock_contention:code\n');

  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'warn' } });
  assert.equal(result.status, 0, `a transient reason must not override the user's warn preference; stderr: ${result.stderr}`);
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, /Review round cap reached \(31\/30\)/, 'the cap fact survives in the warn reason');
  const json = parseJson(result.stdout);
  assert.equal(json.ok, true, 'warn mode still allows the stop');
  assert.match(json.description, /Unretireable obligation:.*sidecar marker is present/,
    'warn-path JSON carries the marker as a fact');
  assert.ok(!/auto-retry|retry in a loop/i.test(combined), 'warn path is equally neutral with a marker present');
  assert.ok(!/escalate to human/i.test(combined), 'warn path is equally neutral with a marker present');
  assert.ok(!/is still correct|should|must not/i.test(json.description), 'no action appraisal either — state description only');
});

test('counters below the cap still allow stop (guard adds no spurious block)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-arith-under-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 3, max_rounds: 10 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 0);
  assert.equal(parseJson(result.stdout).ok, true);
});

test('non-object iteration_history ("oops") → corrupt counters, not a silent "round 0 of 10"', () => {
  // Before the in-jq validation, `.iteration_history.current_round` on a STRING parent raised a jq
  // index error and the `|| echo 0` / `|| echo 10` fallbacks turned it into a clean "round 0 of
  // 10" — a corrupt parent reading as a FULLY UNSPENT budget, so the hard cap could never fire.
  // Row 1 of the convergence table is the only enforced exit, so disarming it disarms convergence.
  const workDir = makeTempDir('sd0x-stop-guard-iter-nonobj-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: 'oops',
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, 'a non-object counter parent cannot prove the budget is unspent');
  assert.match(payload.reason || '', /not valid bounded integers/i);
});

test('leading-zero counter string ("010") → corrupt, not silently OCTAL 8', () => {
  // A digit-only bash guard accepts "010", and `[[ 010 -ge 10 ]]` then parses it as OCTAL 8 —
  // under the cap. jq emits numbers canonically, so requiring a jq NUMBER rejects the shape.
  const workDir = makeTempDir('sd0x-stop-guard-iter-octal-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: '010', max_rounds: 10 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, '"010" must not compare as 8');
  assert.match(payload.reason || '', /not valid bounded integers/i);
});

test('counter beyond bash 64-bit range → corrupt, not a wrapped comparison', () => {
  // 18446744073709551626 is digit-only (a bash `=~ ^[0-9]+$` guard passes it) but exceeds signed
  // 64-bit, so `[[ ]]` wraps it and it can compare BELOW the cap. Written as RAW JSON, not via
  // JSON.stringify — a JS number would round-trip to 18446744073709552000 and lose the point.
  const workDir = makeTempDir('sd0x-stop-guard-iter-huge-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    '{"has_code_change":true,"code_review":{"passed":true},"precommit":{"passed":true},' +
      '"iteration_history":{"current_round":18446744073709551626,"max_rounds":10}}'
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, 'an out-of-range magnitude cannot prove the budget is unspent');
  assert.match(payload.reason || '', /not valid bounded integers/i);
});

test('fractional counter (3.5) → corrupt (integer check, not just "is a number")', () => {
  const workDir = makeTempDir('sd0x-stop-guard-iter-frac-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 3.5, max_rounds: 10 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, '`[[ 3.5 -ge 10 ]]` is a syntax error swallowed by 2>/dev/null');
  assert.match(payload.reason || '', /not valid bounded integers/i);
});

test('max_rounds of 0 → corrupt (a zero budget is never a legitimate configuration)', () => {
  // `max_rounds: 0` would make EVERY round `>= max` and permanently report the cap as exceeded,
  // wedging the session. The `$m < 1` bound routes it to the same explicit corruption message.
  const workDir = makeTempDir('sd0x-stop-guard-iter-zeromax-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 0, max_rounds: 0 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason || '', /not valid bounded integers/i, 'a 0 budget must read as corrupt, not as "cap exceeded"');
});

test('a tampered max_rounds of 100000 is CLAMPED to 50, so round 51 still trips the cap', () => {
  // `.claude_review_state.json` is an ordinary writable file and the only producer of this field
  // (`_read_project_int_setting`) admits 3..50. Accepting a persisted 100000 as written was a
  // silent removal of the convergence exit: round 51 read as a budget barely touched, and row 1 of
  // the convergence table is the ONLY exit the hook actually enforces. Clamped rather than
  // "corrupt" so a stale or hand-edited file stays usable in warn mode instead of forcing strict.
  const workDir = makeTempDir('sd0x-stop-guard-iter-clamp-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 51, max_rounds: 100000 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, 'an out-of-contract cap must not buy an unbounded loop');
  assert.match(payload.reason || '', /round|cap|human/i);
});

test('boolean current_round (false) → corrupt, NOT a refunded "round 0 of 10"', () => {
  // jq's `//` treats **false** exactly like null/absent, so `(.iteration_history.current_round // 0)`
  // mapped `false` to 0 — verified against real jq: the whole filter emitted "0 10", a FULLY UNSPENT
  // budget. The type/bounds checks downstream could never catch it because the false was already
  // gone by the time they ran. Row 1 of the convergence table is the only enforced exit today, so a
  // silent refund there is a silent removal of convergence. Hence the `has()`-based filter.
  const workDir = makeTempDir('sd0x-stop-guard-iter-false-round-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: false, max_rounds: 10 },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, 'a boolean counter cannot prove the budget is unspent');
  assert.match(payload.reason || '', /not valid bounded integers/i);
});

test('boolean max_rounds (false) → corrupt, NOT a silent fallback to the default cap', () => {
  // Same `//` hole on the other counter: `false` became the default cap, so a state whose cap had been corrupted
  // to a boolean silently inherited the documented default instead of being flagged. That hides the
  // corruption rather than surfacing it — and if the real cap was lower, it *raises* the budget.
  const workDir = makeTempDir('sd0x-stop-guard-iter-false-max-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 3, max_rounds: false },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, 'a boolean cap must not inherit the default');
  assert.match(payload.reason || '', /not valid bounded integers/i);
});

test('boolean iteration_history (false) → corrupt, NOT laundered into an empty object', () => {
  // The parent had the same hole: `(.iteration_history // {})` turned `false` into `{}`, whose type
  // is "object", so the parent-type guard passed and both counters then took their defaults —
  // "0 <default>" again. `iteration_history: 'oops'` was already covered; the boolean shape was not,
  // because `//` intercepted it before the type check ever saw it.
  const workDir = makeTempDir('sd0x-stop-guard-iter-false-parent-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: false,
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, 'a boolean counter parent cannot prove the budget is unspent');
  assert.match(payload.reason || '', /not valid bounded integers/i);
});

test('null counters still take the DOCUMENTED defaults (the false fix must not over-reject)', () => {
  // Guard against the opposite error: explicit nulls, and an absent iteration_history entirely, are
  // legitimate legacy shapes and must keep reading as "round 0 of the default cap" — proceed, not block.
  const workDir = makeTempDir('sd0x-stop-guard-iter-nulls-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: null, max_rounds: null },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  assert.equal(result.status, 0);
  assert.equal(parseJson(result.stdout).ok, true, 'null must keep its documented default, unlike false');
});

test('the absent-cap default is the CURRENT one — round 10 is unspent, not exhausted', () => {
  // The test above starts at round 0, which reads as unspent under ANY default — so it cannot tell
  // 10 from 30 and quietly stopped pinning the value when the default moved. This one is chosen to
  // straddle the old boundary: with a null cap, `current_round: 10` is EXACTLY exhausted under the
  // former default of 10 and comfortably unspent under 30. It fails if either the hook or the stub
  // drifts back.
  const workDir = makeTempDir('sd0x-stop-guard-iter-default-discriminating-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: true },
      precommit: { passed: true },
      iteration_history: { current_round: 10, max_rounds: null },
    })
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: 'strict' } });
  assert.equal(result.status, 0);
  assert.equal(
    parseJson(result.stdout).ok, true,
    'round 10 against the absent-cap default must read as unspent — a 10 here means the default regressed'
  );
});

test('reconciliation: a NON-C-locale directory-omission warning does NOT downgrade HAS_CODE_CHANGE → blocks (host-independent)', (t) => {
  // Host-independent complement to the real-git test above, which skips on any runner without
  // zh_TW.UTF-8 installed — i.e. on ubuntu-latest CI, where `locale -a` lists only C/C.utf8/POSIX/
  // en_US.utf8. Measured: with `locale -a` stubbed to the CI set, DELETING the entire
  // directory-omission grep from this hook's primary -uall reconciliation still gave a green run.
  // The fixes were verified only on a dev box that happens to ship zh_TW.
  // The locale-aware stub git models git's real warn-and-omit contract without needing any locale:
  // it emits the English warning iff LC_ALL is C/POSIX and a non-ASCII form otherwise. Ambient
  // LC_ALL is non-C here, so a hook that forgot to force LC_ALL=C sees the localized text, its
  // English-only regex misses it, and the empty (dir-omitted) listing downgrades the pending flag.
  const binDir = makeTempDir('sd0x-stop-guard-recon-stub-bin-');
  if (!setupLocaleAwareGitBin(binDir)) {
    t.skip('real coreutils unresolvable on this host');
    return;
  }
  const workDir = makeTempDir('sd0x-stop-guard-recon-stub-work-');
  const auxDir = makeTempDir('sd0x-stop-guard-recon-stub-aux-');
  writePendingState(workDir);
  const transcriptPath = join(auxDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH: binDir, ...AMBIENT_NON_C_ENV },
  });

  assert.equal(
    result.status,
    2,
    'an unverifiable (dir-omitted) reconciliation must not clear the pending flag → block, at any ambient locale'
  );
});

// ---------------------------------------------------------------------------
// PRECOMMIT_REQUIRE_FULL — opt-in refusal of a fast-only precommit
// ---------------------------------------------------------------------------

function writeModeState(workDir, precommit) {
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: true }, precommit })
  );
}

test('PRECOMMIT_REQUIRE_FULL=1: a passing FAST precommit does not satisfy the gate', () => {
  // /precommit-fast skips the build/typecheck step (precommit-runner.js:167). On a project whose
  // required check is the full gate, banking that as an indistinguishable pass lets a broken
  // typecheck through. Opt-in, so the default path (next test) is unchanged.
  const workDir = makeTempDir('sd0x-stop-guard-reqfull-fast-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeModeState(workDir, { passed: true, mode: 'fast' });

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PRECOMMIT_REQUIRE_FULL: '1' },
  });

  assert.equal(result.status, 2, 'a fast-only precommit must not close the gate when full is required');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.description, /mode=fast/, 'the actionable text must name the mode actually run');
});

test('PRECOMMIT_REQUIRE_FULL=1: a passing FULL precommit satisfies the gate', () => {
  // Over-blocking guard: the opt-in must accept the gate it demands, or it would wedge forever.
  const workDir = makeTempDir('sd0x-stop-guard-reqfull-full-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeModeState(workDir, { passed: true, mode: 'full' });

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PRECOMMIT_REQUIRE_FULL: '1' },
  });

  assert.equal(result.status, 0);
});

test('PRECOMMIT_REQUIRE_FULL=1: an UNRECORDED mode fails closed (unproven is not proven)', () => {
  // Legacy state written before the field existed, or an unrecognized invocation. Treating an
  // absent mode as "full" would silently reopen the very bypass the flag exists to close.
  const workDir = makeTempDir('sd0x-stop-guard-reqfull-absent-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeModeState(workDir, { passed: true });

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PRECOMMIT_REQUIRE_FULL: '1' },
  });

  assert.equal(result.status, 2);
  assert.match(parseJson(result.stdout).description, /mode=unrecorded/);
});

test('default (flag unset): a passing FAST precommit still satisfies the gate', () => {
  // This plugin's own .claude/CLAUDE.md mandates /precommit-fast, so full-only enforcement cannot
  // be the default. Pins that the new field is inert unless PRECOMMIT_REQUIRE_FULL is set.
  const workDir = makeTempDir('sd0x-stop-guard-reqfull-off-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeModeState(workDir, { passed: true, mode: 'fast' });

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 0);
});

test('a non-string precommit.mode is rejected as corrupt state (schema validation)', () => {
  // .mode joins the validated scalars: a tampered/garbage value must route to the corrupt-state
  // path (fail-closed) rather than being string-compared against "full" as a JSON blob.
  const workDir = makeTempDir('sd0x-stop-guard-mode-corrupt-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeModeState(workDir, { passed: true, mode: { evil: true } });

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 2, 'corrupt state must block, not read as an all-passed gate');
});

test('state-derived text carrying a quote/backslash/newline still yields PARSEABLE verdict JSON', () => {
  // `review_phase` is copied verbatim into MISSING (stop-guard.sh:601) and MISSING is interpolated
  // into a printf-built JSON template. `.claude_review_state.json` is an ordinary working-tree file
  // any process can write, so a `"` there used to terminate the JSON string early and a newline used
  // to split the object — the harness then reads UNPARSEABLE output, i.e. no verdict, i.e. the stop
  // is allowed. That converts a blocking gate into a silent bypass, so the sanitizer must run.
  const workDir = makeTempDir('sd0x-stop-guard-json-inject-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      code_review: { passed: false },
      precommit: { passed: false },
      review_phase: 'fix","ok":true,"x":"\\ y\nz',
    })
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 2, 'a pending code review in strict mode must block');
  let payload;
  assert.doesNotThrow(() => {
    payload = JSON.parse(result.stdout);
  }, `verdict JSON must survive hostile state text, got: ${result.stdout}`);
  assert.equal(payload.ok, false, 'and the injected `"ok":true` must not become the real verdict');
});

test('the JSON sanitizer is a shell built-in, not an external tool (no PATH dependency)', () => {
  // The sanitizer runs on the fail-CLOSED path. Backing it with `tr` meant a host (or a curated
  // PATH — see setupNoTimeoutEnv) without that binary made the pipeline exit 127 under `set -e`,
  // killing the hook before any JSON was printed — which the harness reads as "no objection".
  // A blocking gate must not depend on an optional binary; assert the source uses no pipeline here.
  const src = readFileSync(hookPath, 'utf8');
  const fn = src.slice(src.indexOf('_json_safe() {'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
  assert.ok(body.length > 0, 'the sanitizer function must exist');
  assert.doesNotMatch(body, /\|\s*(LC_ALL=C\s+)?(tr|sed|awk|perl|python)\b/, 'no external tool in the sanitizer');
  assert.match(body, /\$\{s\/\/\[\[:cntrl:\]\]/, 'control chars stripped via parameter expansion');
});

// =============================================================================
// PATH independence, continued: the sanitizer was not the only place a missing
// binary could kill the hook before it printed a verdict. Three more sites sat on
// the PRIMARY enforcement paths — the sidecar diagnostic, the porcelain cleaner,
// and the transcript pairing stream. Each is exercised behaviourally below with a
// PATH that genuinely lacks `sed` and `tr`, not just asserted about in the source.
// =============================================================================

// Every tool the hook needs EXCEPT `sed` and `tr`. stubBinDir supplies jq/git/timeout.
function makeNoSedTrPath(stubBinDir) {
  const cleanDir = makeTempDir('sd0x-stop-guard-nosedtr-bin-');
  const needed = [
    'bash', 'sh', 'env', 'node', 'grep', 'cat', 'head', 'tail',
    'printf', 'dirname', 'basename', 'mktemp', 'rm', 'date', 'cut', 'wc',
  ];
  const script = needed.map((n) => `command -v ${n} || true`).join('; ');
  const resolved = spawnSync('sh', ['-c', script], { encoding: 'utf8' });
  for (const realPath of (resolved.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
    if (!existsSync(realPath)) continue;
    const name = realPath.slice(realPath.lastIndexOf('/') + 1);
    if (name === 'sed' || name === 'tr') continue; // belt-and-braces: never link the two under test
    try {
      symlinkSync(realPath, join(cleanDir, name));
    } catch {
      /* already linked — skip */
    }
  }
  return `${stubBinDir}:${cleanDir}`;
}

// Non-vacuity control. If the curated PATH still resolves `sed`/`tr`, every test below passes
// for the wrong reason — it would be exercising the ordinary path, not the degraded one.
function assertToolAbsent(PATH, tool) {
  const r = spawnSync('sh', ['-c', `command -v ${tool} || true`], { encoding: 'utf8', env: { PATH } });
  assert.equal((r.stdout || '').trim(), '', `curated PATH must not resolve ${tool} — test would be vacuous`);
}

test('a PATH without `sed` still blocks: the porcelain cleaner is a built-in, not a pipeline', () => {
  // The reconciliation cleaner used `echo … | sed 's/^.. "//; s/"$//'`. This one is worse than a
  // plain 127-abort, because the obvious "fix" is worse still: `|| true` yields an EMPTY clean
  // list, which reconciliation reads as "git sees no matching files" and uses to downgrade
  // has_code_change true→false — the gate cleared by the ABSENCE OF A BINARY. Both directions
  // are fail-open, so the dependency was removed rather than absorbed.
  const workDir = makeTempDir('sd0x-stop-guard-nosed-porcelain-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts'); // dirty tree, real code file → gate must stay engaged
  const PATH = makeNoSedTrPath(binDir);
  assertToolAbsent(PATH, 'sed');

  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: false },
      precommit: { passed: false },
    })
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH },
  });

  assert.equal(result.status, 2, `hook must block, not die; stderr: ${result.stderr}`);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false, `a verdict must still be printed, got stdout: ${result.stdout}`);
});

test('a PATH without `tr` still blocks: the sidecar reason renders via parameter expansion', () => {
  // `printf … | tr '\\n' ',' | sed 's/,$//'` sat on the MOST fail-closed branch in the file — the
  // one that exists only because a blocking verdict was already lost. Losing the hook there costs
  // the verdict twice over.
  const workDir = makeTempDir('sd0x-stop-guard-notr-sidecar-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const PATH = makeNoSedTrPath(binDir);
  assertToolAbsent(PATH, 'tr');

  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({ has_code_change: true, code_review: { passed: true }, precommit: { passed: true } })
  );
  // Two reasons, so the newline→comma join is exercised, and non-transient so it forces strict.
  writeFileSync(
    join(workDir, '.claude_review_state.json.blocked'),
    'verdict_write_failed:code_review\nstate_write_failed:code\n'
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'warn', PATH }, // warn: a non-transient marker must escalate anyway
  });

  assert.equal(result.status, 2, `sidecar must force a block even in warn mode; stderr: ${result.stderr}`);
  assert.match(
    result.stderr,
    /verdict_write_failed:code_review,state_write_failed:code/,
    'the joined reason must render — comma-separated, no trailing comma'
  );
});

test('a PATH without `sed` still blocks in transcript fallback (the pairing stream absorbs it)', () => {
  // `_PAIR_STREAM=$(echo "$CONVERSATION" | _strip_plan_sentinels)` was the ONE unguarded consumer
  // of that sed-backed helper among eight; the other seven end in `grep … | tail -1 || true` and
  // absorb the 127 already. With no state file this is the only enforcement path there is.
  const workDir = makeTempDir('sd0x-stop-guard-nosed-fallback-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const PATH = makeNoSedTrPath(binDir);
  assertToolAbsent(PATH, 'sed');

  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(
    transcriptPath,
    [
      '{"tool_name":"Edit","tool_input":{"file_path":"src/app.ts"}}',
      'user: /codex-review-fast',
      // deliberately NO verdict — the gate is unsatisfied and must be reported as such
    ].join('\n')
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', PATH },
  });

  assert.equal(result.status, 2, `fallback must block, not die; stderr: ${result.stderr}`);
  assert.equal(parseJson(result.stdout).ok, false, `a verdict must still be printed, got: ${result.stdout}`);
});

test('every _strip_plan_sentinels consumer absorbs a missing `sed` (derived, not enumerated)', () => {
  // Structural backstop for the behavioural test above: a NEW consumer added without a fallback
  // reopens the same fail-open, and no fixture would necessarily reach it. Derive the call sites
  // from the source instead of restating a list that goes stale.
  const src = readFileSync(hookPath, 'utf8');
  const consumers = src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line))
    .filter(({ line }) => /=\$\(.*\|\s*_strip_plan_sentinels/.test(line));

  assert.ok(consumers.length >= 8, `expected at least the 8 known consumers, found ${consumers.length}`);
  for (const { line, n } of consumers) {
    assert.match(
      line,
      /\|\|\s*(true|[A-Za-z_][A-Za-z0-9_]*="")/,
      `stop-guard.sh:${n} assigns from _strip_plan_sentinels with no errexit fallback — a host without sed kills the hook here (fail-open)`
    );
  }
});

test('HOOK_DEBUG reports BOTH verdict polarities (a discarded blocked-scan hides spurious passes)', () => {
  // `REVIEW_BLOCKED` was computed by a full grep over the transcript and then never read by
  // anything — dead, but not harmlessly so. The debug output printed only the PASSING scan, which
  // is precisely the wrong half when the bug under investigation is "a stop was allowed that
  // should not have been": the question is whether a blocking verdict was also matched and lost.
  const workDir = makeTempDir('sd0x-stop-guard-debug-polarity-');
  const binDir = setupStubBin();
  setupStubGit(binDir, ' M src/app.ts');
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(
    transcriptPath,
    [
      '{"tool_name":"Edit","tool_input":{"file_path":"src/app.ts"}}',
      'user: /codex-review-fast',
      '⛔ Blocked',
    ].join('\n')
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict', HOOK_DEBUG: '1' },
  });

  assert.match(result.stderr, /\[Debug\] REVIEW_PASSED=/, 'the passing scan must still be reported');
  assert.match(result.stderr, /\[Debug\] REVIEW_BLOCKED=.*⛔ Blocked/, 'and the blocking scan must be reported with its match, not discarded');
});

test('the two stream cleaners are built-ins too (no tr/sed pipeline on the enforcement paths)', () => {
  const src = readFileSync(hookPath, 'utf8');
  const code = src
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  const reason = code.split('\n').filter((l) => /^\s*SIDECAR_REASON=/.test(l));
  assert.equal(reason.length, 2, 'the sidecar reason is built by two parameter expansions');
  for (const l of reason) {
    assert.doesNotMatch(l, /\|\s*(tr|sed|awk|perl)\b/, `SIDECAR_REASON must not shell out: ${l.trim()}`);
  }

  const porcelain = code.split('\n').filter((l) => /^\s*GIT_PORCELAIN_CLEAN=/.test(l));
  assert.ok(porcelain.length >= 1, 'the porcelain cleaner must exist');
  for (const l of porcelain) {
    assert.doesNotMatch(l, /\|\s*(tr|sed|awk|perl)\b/, `GIT_PORCELAIN_CLEAN must not shell out: ${l.trim()}`);
  }
});

// =============================================================================
// Transcript fallback: precommit sentinel must be TERMINATED, and must work on
// the JSONL shape a real transcript actually has (not just the plain-text fixtures).
// =============================================================================

test('transcript fallback: a prose MENTION of the pass sentinel after a real FAIL does not unblock', () => {
  // `tail -1` takes the LAST matching line, so an unterminated match on a narration line emitted
  // after the real verdict wins the comparison — and carrying no FAIL marker, it reads as a pass.
  const workDir = makeTempDir('sd0x-stop-guard-precommit-prose-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(
    transcriptPath,
    [
      '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
      'user: /codex-review-fast',
      '✅ Ready',
      'user: /precommit',
      '## Overall: ⛔ FAIL',
      'assistant: fixing now; I will print `## Overall: ✅ PASS` once the suite is green',
    ].join('\n')
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 2, 'a failed precommit must stay blocked despite a later mention');
  const payload = parseJson(result.stdout);
  assert.match(payload.reason || '', /Precommit not passed/);
});

test('transcript fallback: prose ENDING with the pass sentinel still does not unblock a real FAIL', () => {
  // The gap the trailing-boundary rule alone left open. The terminator group accepts end-of-line,
  // so a narration whose last words ARE the sentinel matched perfectly — and `tail -1` prefers it
  // over the genuine `⛔ FAIL` emitted earlier. The existing prose test misses this because its
  // line ends with a backtick, which is a terminator but not the sentinel itself. Requiring a
  // LEADING boundary (line start / escaped newline / opening quote) is what separates an emitted
  // sentinel from one embedded mid-sentence.
  const workDir = makeTempDir('sd0x-stop-guard-precommit-prose-tail-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(
    transcriptPath,
    [
      '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
      'user: /codex-review-fast',
      '✅ Ready',
      'user: /precommit',
      '## Overall: ⛔ FAIL',
      'assistant: once the suite is green I will report ## Overall: ✅ PASS',
    ].join('\n')
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 2, 'a sentence that merely ends with the sentinel is not a verdict');
  const payload = parseJson(result.stdout);
  assert.match(payload.reason || '', /Precommit not passed/);
});

test('transcript fallback: a doc review passing LATER must not clear a blocked code review', () => {
  // Plane conflation. The shared LAST_REVIEW scan answers "the most recent verdict of ANY kind",
  // and the MISSING test only asks whether *a* verdict exists — so a code review that ended
  // ⛔ Blocked, followed by a doc review that ended ✅ Mergeable, left both gates looking
  // satisfied and the failed code review invisible. Per-plane recency is what keeps the blocked
  // plane blocked regardless of what the other plane did afterwards.
  const workDir = makeTempDir('sd0x-stop-guard-plane-conflation-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(
    transcriptPath,
    [
      '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
      '{"tool_name":"Edit","tool_input":{"path":"docs/guide.md"}}',
      'user: /codex-review-fast',
      'assistant: found a P0',
      '⛔ Blocked',
      'user: /precommit',
      '## Overall: ✅ PASS',
      'user: /codex-review-doc',
      'assistant: docs look fine',
      '✅ Mergeable',
    ].join('\n')
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 2, 'the blocked code review must survive a later doc pass');
  const payload = parseJson(result.stdout);
  assert.match(payload.reason || '', /review not passed/i);
});

test('transcript fallback: both planes genuinely passing still allows the stop (no over-block)', () => {
  // The other half of the per-plane rule. Adding a second blocking scan is only safe if it does
  // not start refusing sessions that really did pass everything.
  const workDir = makeTempDir('sd0x-stop-guard-plane-bothpass-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(
    transcriptPath,
    [
      '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
      '{"tool_name":"Edit","tool_input":{"path":"docs/guide.md"}}',
      'user: /codex-review-fast',
      '✅ Ready',
      'user: /precommit',
      '## Overall: ✅ PASS',
      'user: /codex-review-doc',
      '✅ Mergeable',
    ].join('\n')
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 0, 'every gate reported a pass on its own plane');
  assert.equal(parseJson(result.stdout).ok, true);
});

test('transcript fallback: JSONL-shaped transcript — a real ⛔ FAIL inside a JSON string blocks', () => {
  // A real Claude Code transcript is JSONL: the sentinel is embedded in a "text" field with its
  // newlines ESCAPED, on a line starting with `{`. Column-0 anchoring would silently never match
  // here, so this pins that the fallback parses the shape production actually feeds it.
  const workDir = makeTempDir('sd0x-stop-guard-precommit-jsonl-fail-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.jsonl');
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ tool_name: 'Edit', tool_input: { path: 'src/app.ts' } }),
      JSON.stringify({ role: 'user', text: '/codex-review-fast' }),
      JSON.stringify({ role: 'assistant', text: 'Review done.\n✅ Ready\n' }),
      JSON.stringify({ role: 'user', text: '/precommit' }),
      JSON.stringify({ role: 'assistant', text: 'Ran checks.\n## Overall: ⛔ FAIL\n2 tests failing.' }),
    ].join('\n')
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 2, 'the JSON-encoded FAIL sentinel must still be detected');
  const payload = parseJson(result.stdout);
  assert.match(payload.reason || '', /Precommit not passed/);
});

test('transcript fallback: JSONL-shaped transcript — a real ✅ PASS inside a JSON string allows stop', () => {
  // The negative half of the pair: the terminator group must not be so strict that a genuine
  // JSON-encoded pass stops matching, which would leave the fallback permanently unable to observe
  // a green precommit.
  const workDir = makeTempDir('sd0x-stop-guard-precommit-jsonl-pass-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.jsonl');
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ tool_name: 'Edit', tool_input: { path: 'src/app.ts' } }),
      JSON.stringify({ role: 'user', text: '/codex-review-fast' }),
      JSON.stringify({ role: 'assistant', text: 'Review done.\n✅ Ready\n' }),
      JSON.stringify({ role: 'user', text: '/precommit' }),
      JSON.stringify({ role: 'assistant', text: 'Ran checks.\n## Overall: ✅ PASS\n' }),
    ].join('\n')
  );

  const result = runHook({
    cwd: workDir,
    binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 0, 'a genuine JSON-encoded PASS must still satisfy the gate');
});

// ---------------------------------------------------------------------------
// Secondary review iter-21 P2: the empty-sidecar escalation was entirely untested
// ---------------------------------------------------------------------------
// `_SIDECAR_LINES_SEEN -eq 0 → _SIDECAR_ALL_TRANSIENT=false` is correct in production but appeared
// in no fixture: every existing sidecar test writes non-empty text, so deleting the guard kept the
// suite green. The zero-byte shape is not hypothetical — `_set_own_sidecar` appends with `>>`, so a
// writer that creates the file and then hits ENOSPC (or is interrupted) leaves exactly that: a
// marker written BECAUSE a verdict was lost, which the loop's `true` initializer would then
// classify as the mildest possible state. Unknown must default-deny.

function warnModeStateWithTransientSidecar(prefix, sidecarBody) {
  const workDir = makeTempDir(prefix);
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: true,
      has_doc_change: false,
      code_review: { passed: true },
      precommit: { passed: true },
    })
  );
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), sidecarBody);
  return { workDir, transcriptPath };
}

test('a ZERO-BYTE sidecar escalates to strict rather than reading as transient', () => {
  const binDir = setupStubBin();
  const { workDir, transcriptPath } = warnModeStateWithTransientSidecar(
    'sd0x-stop-guard-sidecar-empty-',
    ''
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 2, 'an empty marker is unknown, and unknown default-denies');
  assert.match(result.stderr, /escalating to strict/);
});

test('a NEWLINE-ONLY sidecar escalates too (no readable reason is still no reason)', () => {
  const binDir = setupStubBin();
  const { workDir, transcriptPath } = warnModeStateWithTransientSidecar(
    'sd0x-stop-guard-sidecar-blank-',
    '\n\n'
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /escalating to strict/);
});

test('a sidecar of ONLY transient reasons still does not escalate (the guard stays narrow)', () => {
  // The complement. Without this, the two tests above would also pass on a hook that escalated
  // unconditionally — which would silently retire the transient allowlist the user's warn-mode
  // preference depends on.
  const binDir = setupStubBin();
  const { workDir, transcriptPath } = warnModeStateWithTransientSidecar(
    'sd0x-stop-guard-sidecar-transient-',
    'edit_lock_contention:code\nlock_failure\n'
  );
  const result = runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath } });
  assert.match(result.stderr, /transient, fail-closed gates/);
  assert.doesNotMatch(result.stderr, /escalating to strict/);
});

// =============================================================================
// PRECOMMIT_REQUIRE_FULL in TRANSCRIPT-FALLBACK mode
// =============================================================================
//
// The flag was honoured only in state-file mode. A project that required the full gate therefore
// got it enforced when a state file existed and silently NOT enforced when one did not — and the
// fallback is precisely the degraded path where an unproven verdict is least affordable. The
// variant is recoverable there because the detector captures its own match.

function transcriptRun(dirTag, precommitCommand, env) {
  const workDir = makeTempDir(`sd0x-stop-guard-${dirTag}-`);
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(transcriptPath, [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: ✅',
    `user: ${precommitCommand}`,
    '## Overall: ✅ PASS',
  ].join('\n'));
  return runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env });
}

test('PRECOMMIT_REQUIRE_FULL=1 (transcript mode): a passing FAST precommit does not satisfy the gate', () => {
  const result = transcriptRun('reqfull-tr-fast', '/precommit-fast', {
    STOP_GUARD_MODE: 'strict', PRECOMMIT_REQUIRE_FULL: '1',
  });
  assert.equal(result.status, 2);
  assert.match(parseJson(result.stdout).description, /mode=fast, full required/);
});

test('PRECOMMIT_REQUIRE_FULL=1 (transcript mode): a passing FULL precommit satisfies the gate', () => {
  // Without this control, deleting the whole precommit branch would also make the test above pass.
  const result = transcriptRun('reqfull-tr-full', '/precommit', {
    STOP_GUARD_MODE: 'strict', PRECOMMIT_REQUIRE_FULL: '1',
  });
  assert.equal(result.status, 0);
  assert.equal(parseJson(result.stdout).ok, true);
});

// --- Transcript mode: a verdict must belong to the invocation it is credited to ---

/** Transcript-mode run over an explicit line list, so ORDER is the variable under test. */
function transcriptLinesRun(dirTag, lines, env) {
  const workDir = makeTempDir(`sd0x-stop-guard-${dirTag}-`);
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(transcriptPath, lines.join('\n'));
  return runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env });
}

const EDIT_CODE = '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}';
const EDIT_DOC = '{"tool_name":"Edit","tool_input":{"path":"docs/x.md"}}';
const REVIEWED_OK = [EDIT_CODE, 'user: /codex-review-fast', '## Gate: ✅'];

test('transcript mode: a NEWER precommit invocation cannot inherit an OLDER run\'s passing verdict', () => {
  // The two scans were position-blind — "a verdict exists" and "the command exists", never related
  // in time. So a fast run that passed, followed by a full run that emitted nothing (errored, or
  // was only mentioned), reported the gate as satisfied on the fast run's verdict; the
  // PRECOMMIT_REQUIRE_FULL branch then read `/precommit` off that same trailing invocation and
  // declared the full gate met. Two independent checks, both satisfied, zero evidence.
  const result = transcriptLinesRun('pair-stale-precommit', [
    ...REVIEWED_OK,
    'user: /precommit-fast',
    '## Overall: ✅ PASS',
    'user: /precommit',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 2, 'the newer invocation reported nothing, so the gate is unmet');
  assert.match(parseJson(result.stdout).description, /\/precommit\(invoked, no verdict\)/);
});

test('transcript mode: the same order WITH a verdict for the newer run satisfies the gate (control)', () => {
  // Without this, blanking PRECOMMIT_VERDICT_SEEN unconditionally would also pass the test above.
  const result = transcriptLinesRun('pair-fresh-precommit', [
    ...REVIEWED_OK,
    'user: /precommit-fast',
    '## Overall: ✅ PASS',
    'user: /precommit',
    '## Overall: ✅ PASS',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 0, parseJson(result.stdout).description || result.stderr);
  assert.equal(parseJson(result.stdout).ok, true);
});

test('transcript mode: a command and its verdict packed on ONE JSONL line are paired', () => {
  // $CONVERSATION is JSONL — one line holds a whole message, so an invocation and the verdict it
  // produced routinely share a line NUMBER. That is why line granularity had to accept equality,
  // and why the comparison now runs on BYTE offsets instead: within the line the command name
  // still precedes the sentinel it produced, so a strict `>` pairs this correctly while the
  // sibling test below — a newer command packed AFTER an older verdict on one line — is rejected.
  // Line numbers could not tell those two apart at all.
  const result = transcriptLinesRun('pair-sameline', [
    EDIT_CODE,
    '{"role":"assistant","text":"ran /codex-review-fast\\n## Gate: ✅"}',
    '{"role":"assistant","text":"ran /precommit\\n## Overall: ✅ PASS"}',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 0, parseJson(result.stdout).description || result.stderr);
});

test('transcript mode: a NEWER code review cannot inherit an OLDER one\'s verdict', () => {
  const result = transcriptLinesRun('pair-stale-code', [
    EDIT_CODE,
    'user: /codex-review-fast',
    '## Gate: ✅',
    'user: /precommit',
    '## Overall: ✅ PASS',
    'user: /codex-review-fast',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 2);
  assert.match(parseJson(result.stdout).description, /codex-review-fast\(invoked, no verdict\)/);
});

test('transcript mode: a NEWER doc review cannot inherit an OLDER one\'s verdict', () => {
  const result = transcriptLinesRun('pair-stale-doc', [
    EDIT_DOC,
    'user: /codex-review-doc',
    '✅ Mergeable',
    'user: /codex-review-doc',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 2);
  assert.match(parseJson(result.stdout).description, /codex-review-doc\(invoked, no verdict\)/);
});

test('transcript mode: a JSON-encoded precommit sentinel with a space before the newline escape is still a verdict', () => {
  // The trailing boundary was `([[:space:]]*$|\n|")` — three alternatives where only the FIRST
  // tolerated whitespace, so `"## Overall: ✅ PASS \n…"` matched none of them and a real passing
  // run read as "invoked, no verdict". Fail-closed, but the enumeration claimed to be complete.
  const result = transcriptLinesRun('pair-space-escape', [
    ...REVIEWED_OK,
    '{"role":"assistant","text":"ran /precommit\\n## Overall: ✅ PASS \\ndone"}',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 0, parseJson(result.stdout).description || result.stderr);
});

test('flag unset (transcript mode): a passing FAST precommit still satisfies the gate', () => {
  // The fast gate is a supported choice for host projects, so full-only cannot be the default —
  // in this mode any more than in state-file mode.
  const result = transcriptRun('reqfull-tr-off', '/precommit-fast', { STOP_GUARD_MODE: 'strict' });
  assert.equal(result.status, 0);
  assert.equal(parseJson(result.stdout).ok, true);
});

test('PRECOMMIT_REQUIRE_FULL=1 alone does NOT block — warn mode still exits 0', () => {
  // Pins what CLAUDE.md now states: the flag decides WHAT COUNTS as satisfied, STOP_GUARD_MODE
  // decides whether an unsatisfied gate blocks. Documenting the flag as sufficient on its own was
  // the overclaim this test exists to prevent.
  const result = transcriptRun('reqfull-tr-warn', '/precommit-fast', { PRECOMMIT_REQUIRE_FULL: '1' });
  assert.equal(result.status, 0, 'warn is the default and warn never blocks');
  assert.equal(parseJson(result.stdout).ok, true);
  assert.match(result.stderr, /mode=fast, full required/, 'but it must still be reported');
});

// =============================================================================
// `✅ All Pass` is prose, and no scan in this hook matches it
// =============================================================================

test('no scan in stop-guard.sh matches the behavior-layer phrase "✅ All Pass"', () => {
  // A SOURCE-shape test, deliberately, because there is no behavioural difference to assert. The
  // phrase used to sit in the two coarse plane-agnostic patterns (REVIEW_PASSED, LAST_REVIEW). In
  // LAST_REVIEW that let a message ENDING in the phrase out-rank an earlier `⛔ Blocked` under
  // `tail -1` — but the per-plane scans that run afterwards are additive and re-raised the block,
  // so no transcript distinguishes the two versions at the exit-code level. Writing a behavioural
  // test anyway would have been a vacuous one that passed against the defect.
  //
  // What IS worth pinning is the invariant rules/auto-loop.md states: a phrase Claude emits freely
  // in ordinary prose must not appear in any verdict pattern in this hook. That is a property of
  // the source, so the source is what gets asserted.
  const src = readFileSync(hookPath, 'utf8');
  const offenders = src
    .split('\n')
    .filter((l) => /grep -E/.test(l) && /All Pass/.test(l));
  assert.deepEqual(
    offenders, [],
    'rules/auto-loop.md documents `✅ All Pass` as prose no hook reads; keep it out of every grep here'
  );
});

test('"✅ All Pass" alone satisfies no gate — it is not a code, doc, or precommit verdict', () => {
  // Non-vacuity for the test above: proves the phrase is inert rather than merely out-ranked.
  const workDir = makeTempDir('sd0x-stop-guard-allpass-alone-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  writeFileSync(transcriptPath, [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    'user: /precommit',
    '✅ All Pass',
  ].join('\n'));

  const result = runHook({
    cwd: workDir, binDir,
    input: { transcript_path: transcriptPath },
    env: { STOP_GUARD_MODE: 'strict' },
  });

  assert.equal(result.status, 2);
  const description = parseJson(result.stdout).description;
  assert.match(description, /no verdict/, 'both planes must read as invoked-without-a-verdict');
});

test('transcript mode: a newer command packed on the SAME line as an older verdict cannot inherit it', () => {
  // The failure line-number pairing could not see, and the reason the comparison moved to byte
  // offsets. One assistant message reports the fast run's PASS and announces the full run in the
  // same breath — the ordinary shape of an auto-loop turn — so both commands and the verdict share
  // a line number, `>=` accepted it, and `/precommit` (which reported nothing, and under
  // PRECOMMIT_REQUIRE_FULL is the variant the branch reads) was credited with `/precommit-fast`'s
  // result. Byte offsets order them: the verdict lies BEFORE the newer command name.
  const result = transcriptLinesRun('pair-sameline-stale', [
    EDIT_CODE,
    '{"role":"assistant","text":"ran /codex-review-fast\\n## Gate: ✅"}',
    '{"role":"assistant","text":"/precommit-fast\\n## Overall: ✅ PASS\\nnow running /precommit"}',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 2, 'the trailing invocation reported nothing');
  assert.match(parseJson(result.stdout).description, /\/precommit\(invoked, no verdict\)/);
});

test('transcript mode: same line, verdict AFTER the newer command → satisfied (control)', () => {
  // Without this control the test above would also pass against a hook that blanks every
  // same-line verdict outright — which would break the ordinary auto-loop turn.
  const result = transcriptLinesRun('pair-sameline-fresh', [
    EDIT_CODE,
    '{"role":"assistant","text":"ran /codex-review-fast\\n## Gate: ✅"}',
    '{"role":"assistant","text":"/precommit-fast\\n## Overall: ✅ PASS\\nre-running /precommit\\n## Overall: ✅ PASS"}',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 0, parseJson(result.stdout).description || result.stderr);
});

test('transcript mode: a newer code review packed after its predecessor\'s verdict on one line is unpaired', () => {
  // Same defect, code plane — the three planes share the pairing helper, so each needs its own pin.
  const result = transcriptLinesRun('pair-sameline-stale-code', [
    EDIT_CODE,
    '{"role":"assistant","text":"/codex-review-fast\\n## Gate: ✅\\nfixed those, re-running /codex-review-fast"}',
    '{"role":"assistant","text":"/precommit\\n## Overall: ✅ PASS"}',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 2);
  assert.match(parseJson(result.stdout).description, /codex-review-fast\(invoked, no verdict\)/);
});

test('transcript mode: upstream plan sentinels do not shift a genuine verdict out of its pairing', () => {
  // Byte offsets are only comparable within ONE stream, and the verdict scans run on the
  // plan-sentinel-STRIPPED text. Measuring the command offsets on the raw transcript instead would
  // read the two off different rulers: every plan sentinel anywhere upstream shortens the verdict's
  // ruler but not the command's, so the verdict drifts "earlier" by the total stripped length.
  // Here that length far exceeds the gap between `/precommit` and its PASS, so a mixed-ruler
  // comparison rejects a verdict that is plainly downstream of its own invocation — a passing
  // session blocked in strict mode because a plan review happened earlier. Both scans therefore run
  // on the same stripped stream.
  const planNoise = Array.from({ length: 40 }, (_, i) =>
    `{"role":"assistant","text":"## Plan Review round ${i}\\n⛔ Plan Blocked\\n⚠️ Plan Needs Human"}`
  );
  const result = transcriptLinesRun('pair-plan-ruler', [
    ...planNoise,
    EDIT_CODE,
    'user: /codex-review-fast',
    '## Gate: ✅',
    'user: /precommit',
    '## Overall: ✅ PASS',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 0, parseJson(result.stdout).description || result.stderr);
  assert.equal(parseJson(result.stdout).ok, true);
});

// =============================================================================
// Blocking detection must stay UNPAIRED (regression: a real ⛔ FAIL was dropped)
// =============================================================================

test('transcript mode: a ⛔ FAIL still blocks when a later /precommit mention unpairs it', () => {
  // Pairing answers "did THIS invocation report?" — right for MISSING, wrong for "did anything
  // report a FAILURE". Routing the blocking check through the paired variable made a real
  // `## Overall: ⛔ FAIL` vanish whenever the model narrated the next `/precommit` after it, which
  // is the ordinary shape of a failing auto-loop round. Here the doc plane is fully satisfied and
  // there is no code change, so nothing else re-raises the block: without an unpaired scan the
  // hook answers ok:true on a session whose precommit FAILED.
  const result = transcriptLinesRun('unpaired-precommit-fail', [
    EDIT_DOC,
    'user: /codex-review-doc',
    '✅ Mergeable',
    'user: /precommit',
    '## Overall: ⛔ FAIL',
    'assistant: I will fix those and re-run /precommit',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 2, `expected a block, got ${result.stdout}`);
  assert.equal(parseJson(result.stdout).reason, 'Precommit not passed (FAIL)');
});

test('transcript mode: the same ⛔ FAIL blocks even when the edit scrolled out of the window', () => {
  // The other backstop that does NOT fire here: with no code change in `tail -500`, the MISSING
  // branch never runs at all, so the blocking scan is the only thing standing between a failed
  // precommit and ok:true. Filler must exceed the 500-line window.
  const filler = Array.from({ length: 600 }, (_, i) => `{"role":"assistant","text":"step ${i}"}`);
  const result = transcriptLinesRun('unpaired-precommit-fail-scrolled', [
    EDIT_CODE,
    ...filler,
    'user: /precommit',
    '## Overall: ⛔ FAIL',
    'assistant: fixing, will re-run /precommit shortly',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 2, `expected a block, got ${result.stdout}`);
  assert.equal(parseJson(result.stdout).reason, 'Precommit not passed (FAIL)');
});

test('transcript mode: an unpaired PASS still reads as no verdict (control for the two above)', () => {
  // The fix must not un-pair the MISSING branch as well. A trailing `/precommit` after a PASS is
  // still "invoked, reported nothing" — only the ⛔ direction is additive. Without this control the
  // two tests above would pass against a hook that abandoned pairing entirely.
  const result = transcriptLinesRun('unpaired-precommit-pass', [
    EDIT_CODE,
    'user: /codex-review-fast',
    '## Gate: ✅',
    'user: /precommit-fast',
    '## Overall: ✅ PASS',
    'assistant: now running /precommit',
  ], { STOP_GUARD_MODE: 'strict' });

  assert.equal(result.status, 2);
  assert.match(parseJson(result.stdout).description, /\/precommit\(invoked, no verdict\)/);
});

// === Issue #10 — surfacing a backgrounded review at the gate ===
//
// post-tool-review-state.sh records a `background_reviews` marker when an MCP review is handed off
// to the background, because its verdict can never reach a hook. This end of the fix is what makes
// the marker worth writing: without it the reader sees only `Missing steps: /codex-review-doc`,
// which is indistinguishable from never having run a review — and the rational response to THAT
// reading is to re-run, the one action guaranteed to hit the same timeout again.
function runWithBackgroundMarker(prefix, { docPassed, markers, mode = 'warn' }) {
  const workDir = makeTempDir(prefix);
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.json');
  writeFileSync(transcriptPath, '[]');
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_doc_change: true,
      has_code_change: false,
      doc_review: { executed: docPassed, passed: docPassed },
      code_review: { executed: false, passed: false },
      precommit: { executed: true, passed: true },
      schema_version: 3,
      background_reviews: markers,
    }),
  );
  return runHook({ cwd: workDir, binDir, input: { transcript_path: transcriptPath }, env: { STOP_GUARD_MODE: mode } });
}

const BG_DOC_MARKER = [{ plane: 'doc', task: 'kimyfg23u', at: '2026-08-08T02:00:00Z' }];

test('#10: an open doc gate with a background marker surfaces the handoff beside it', () => {
  const result = runWithBackgroundMarker('sd0x-stop-guard-bg-open-', {
    docPassed: false,
    markers: BG_DOC_MARKER,
  });

  assert.match(result.stderr, /moved to the background/, 'the handoff is surfaced, cause unattributed');
  assert.match(result.stderr, /task kimyfg23u/, 'and names the task, so the report can be found');
  // The note sits beside the gate; it must never be mistaken for discharging it.
  assert.match(result.stderr, /Missing steps: \/codex-review-doc/, 'the gate is still reported as open');
});

// What the marker can prove, and what it cannot — two separate overclaims, both fixed by wording.
//
// The first is about CAUSE. An edit retires this plane's markers in the write that re-opens the
// gate, so a surviving marker normally IS the whole reason — but a review dispatched before a
// concurrent edit can time out after it, and `{plane, task, at}` cannot tell that ordering apart
// (`at` is stamped at handoff, later than the edit either way, and the dispatch time is not visible
// from PostToolUse).
//
// The second is about the MARKER ITSELF. It is minted from a request-side substring — `Merge Gate`
// or `Document Review` in the raw prompt — so a backgrounded call that merely discusses those
// phrases mints one too. The line therefore may not say a review ran; only that a task whose
// request looked like one was handed off. Claiming more sends the reader to an unrelated thread
// instead of to the review the gate is waiting on.
test('#10: the note claims only what the marker witnesses', () => {
  const result = runWithBackgroundMarker('sd0x-stop-guard-bg-nonexclusive-', {
    docPassed: false,
    markers: BG_DOC_MARKER,
  });

  assert.match(
    result.stderr,
    /request looked like a review/,
    'the evidence is request-side, and the wording has to say so',
  );
  assert.match(
    result.stderr,
    /does not prove a review of this plane ran/,
    'so the reader is told to read the report rather than trust the marker',
  );
  assert.match(
    result.stderr,
    /an edit made after the task was dispatched/,
    'the other cause is named against the DISPATCH, which is the ordering retirement cannot reach',
  );
  assert.match(
    result.stderr,
    /before this marker was written/,
    'and says so explicitly, since an edit after the handoff would have retired the marker instead',
  );
  assert.match(
    result.stderr,
    /never having completed a review of this plane/,
    'and the third cause leaves the gate open rather than re-opening it',
  );
});

// The negative control, and the reason no sweep step is needed anywhere: a marker outlives the
// timeout that produced it, so without this filter every later stop would repeat a stale claim.
// Delete the `$doc != "true"` selector and this is the only test that notices.
test('#10: the note falls silent once that plane\'s gate passes', () => {
  const result = runWithBackgroundMarker('sd0x-stop-guard-bg-closed-', {
    docPassed: true,
    markers: BG_DOC_MARKER,
  });

  assert.doesNotMatch(result.stderr, /moved to the background/,
    'a marker left by a review that later succeeded makes no claim');
});

test('#10: no marker means no note (the ordinary open gate is unchanged)', () => {
  const result = runWithBackgroundMarker('sd0x-stop-guard-bg-none-', {
    docPassed: false,
    markers: [],
  });

  assert.doesNotMatch(result.stderr, /moved to the background/);
  assert.match(result.stderr, /Missing steps: \/codex-review-doc/, 'and the normal message still prints');
});

test('#10: the note also prints in strict mode, where the stop is blocked', () => {
  const result = runWithBackgroundMarker('sd0x-stop-guard-bg-strict-', {
    docPassed: false,
    markers: BG_DOC_MARKER,
    mode: 'strict',
  });

  assert.equal(result.status, 2, 'strict still blocks — the note informs, it does not authorize');
  assert.match(result.stderr, /moved to the background/);
});
