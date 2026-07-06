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
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

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
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-r') continue;
  if (arg === '-e') { hasExitFlag = true; continue; }
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

if (query && query.includes('[$key]') && vars.key) {
  if (!data || typeof data !== 'object') data = {};
  if (!data[vars.key] || typeof data[vars.key] !== 'object') data[vars.key] = {};
  data[vars.key].executed = vars.executed;
  data[vars.key].passed = vars.passed;
  data[vars.key].last_run = vars.now;
  data.updated_at = vars.now;
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

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

// Dual-mode fields
if (query && query.includes('.review_mode')) {
  outputValue(data.review_mode || 'single');
  process.exit(0);
}
if (query && query.includes('.aggregate_gate.executed')) {
  const agg = data.aggregate_gate || {};
  outputValue(asBoolString(agg.executed));
  process.exit(0);
}
if (query && query.includes('.aggregate_gate.gate')) {
  const agg = data.aggregate_gate || {};
  outputValue(agg.gate != null ? agg.gate : '');
  process.exit(0);
}

if (query && query.includes('.code_review.passed')) {
  outputValue(asBoolString(data.code_review && data.code_review.passed));
  process.exit(0);
}
if (query && query.includes('.doc_review.passed')) {
  outputValue(asBoolString(data.doc_review && data.doc_review.passed));
  process.exit(0);
}
if (query && query.includes('.precommit.passed')) {
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

// Handle iteration_history fields (schema v2)
if (query && query.includes('iteration_history.current_round')) {
  const ih = data.iteration_history || {};
  outputValue(String(ih.current_round != null ? ih.current_round : 0));
  process.exit(0);
}
if (query && query.includes('iteration_history.max_rounds')) {
  const ih = data.iteration_history || {};
  outputValue(String(ih.max_rounds != null ? ih.max_rounds : 10));
  process.exit(0);
}

// Handle env.STOP_GUARD_MODE // hooks_config.stop_guard_mode (mode resolution)
if (query && (query.includes('env.STOP_GUARD_MODE') || query.includes('hooks_config.stop_guard_mode'))) {
  const envVal = (data.env && data.env.STOP_GUARD_MODE) || '';
  const legacyVal = (data.hooks_config && data.hooks_config.stop_guard_mode) || '';
  process.stdout.write(envVal || legacyVal);
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
    'user: /precommit',
    '## Gate: \u2705',
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

test('transcript strict: review blocked without subsequent pass blocks', () => {
  const workDir = makeTempDir('sd0x-stop-guard-blocked-strict-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '## Gate: \u26d4',
    'user: /precommit',
    '## Gate: \u26d4',
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
    '## Gate: \u26d4',
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
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '⛔ Needs revision',
    'user: /codex-review-fast',
    '✅ Mergeable',
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
  assert.equal(result.status, 0, 'should allow stop when last review verdict is pass');
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
});

test('review sentinel: ✅ Ready then ⛔ Block blocks (last wins)', () => {
  const workDir = makeTempDir('sd0x-stop-guard-rev-pass-fail-');
  const binDir = setupStubBin();
  const transcriptPath = join(workDir, 'transcript.txt');
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '✅ Ready',
    'user: /codex-review-fast',
    '⛔ Block',
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
  // Include /precommit + PASS so MISSING path doesn't fire, isolating the BLOCKED_REASON path
  const transcript = [
    '{"tool_name":"Edit","tool_input":{"path":"src/app.ts"}}',
    'user: /codex-review-fast',
    '\u26d4 Needs revision',
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
    '## Gate: ✅',
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

// === deep-explore regression: strict exit-2 stderr must carry the instruction ===
// On exit 2 only stderr reaches the model; the stdout JSON description is
// consumed by tests alone. Pin that the actionable guidance is on stderr.

test('strict block puts actionable instruction on stderr (not only stdout JSON)', () => {
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
    /do not ask the user|Fix issues and re-run|escalate to human/,
    `stderr must instruct the model what to do next, got: ${result.stderr}`
  );
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
