const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
  existsSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const hookPath = resolve(__dirname, '../../hooks/post-tool-review-state.sh');
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
  const binDir = makeTempDir('sd0x-post-tool-bin-');
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

function runHook({ cwd, binDir, input }) {
  return spawnSync('bash', [hookPath], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
    },
  });
}

function readState(cwd) {
  const statePath = join(cwd, '.claude_review_state.json');
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('/codex-review-fast pass sets code_review passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/codex-review-fast' },
      tool_output: '## Gate: \u2705',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.code_review.passed, true);
});

test('/codex-review-fast block sets code_review passed false', () => {
  const workDir = makeTempDir('sd0x-post-tool-block-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/codex-review-fast' },
      tool_output: '## Gate: \u26d4',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.code_review.passed, false);
});

test('/codex-review-doc pass sets doc_review passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-doc-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/codex-review-doc' },
      tool_output: '\u2705 All Pass',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.doc_review.passed, true);
});

test('/precommit pass sets precommit passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-precommit-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/precommit' },
      tool_output: '## Overall: \u2705 PASS',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.precommit.passed, true);
});

test('non-review tool does not write state', () => {
  const workDir = makeTempDir('sd0x-post-tool-nonreview-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Read',
      tool_input: { path: 'README.md' },
      tool_output: 'ok',
    },
  });
  assert.equal(result.status, 0);
  const statePath = join(workDir, '.claude_review_state.json');
  assert.equal(existsSync(statePath), false);
});

test('re-run flips code_review passed from false to true', () => {
  const workDir = makeTempDir('sd0x-post-tool-rerun-');
  const binDir = setupStubBin();

  runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/codex-review-fast' },
      tool_output: '## Gate: \u26d4',
    },
  });
  let state = readState(workDir);
  assert.equal(state.code_review.passed, false);

  runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/codex-review-fast' },
      tool_output: '## Gate: \u2705',
    },
  });
  state = readState(workDir);
  assert.equal(state.code_review.passed, true);
});
