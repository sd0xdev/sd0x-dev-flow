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
