const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
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
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-r') continue;
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

process.stdout.write('');
`;
  writeExecutable(join(binDir, 'jq'), stubJq);
  return binDir;
}

function runHook({ cwd, binDir, input, env }) {
  return spawnSync('bash', [hookPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
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
