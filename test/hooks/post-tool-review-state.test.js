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
// Handle MCP content extraction (tool_output.content string or array, with type guard)
if (query && query.includes('tool_output') && query.includes('type') && query.includes('content')) {
  const to = data.tool_output;
  if (to && typeof to === 'object' && !Array.isArray(to)) {
    const content = to.content;
    if (typeof content === 'string') {
      process.stdout.write(content);
    } else if (Array.isArray(content)) {
      const text = content.filter(c => c.type === 'text').map(c => c.text).join('\\n');
      process.stdout.write(text);
    } else {
      process.stdout.write(JSON.stringify(to));
    }
  } else if (typeof to === 'string') {
    process.stdout.write(to);
  } else {
    process.stdout.write('');
  }
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

test('/codex-review (without -fast) sets code_review', () => {
  const workDir = makeTempDir('sd0x-post-tool-review-full-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/codex-review' },
      tool_output: '## Gate: \u2705',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.code_review.passed, true);
});

test('/precommit-fast sets precommit passed', () => {
  const workDir = makeTempDir('sd0x-post-tool-precommit-fast-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/precommit-fast' },
      tool_output: '## Overall: \u2705 PASS',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.precommit.passed, true);
});

test('/review-spec sets doc_review passed', () => {
  const workDir = makeTempDir('sd0x-post-tool-review-spec-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/review-spec' },
      tool_output: '\u2705 All Pass',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.doc_review.passed, true);
});

// =============================================================================
// MCP tool tests
// =============================================================================

test('MCP code review pass (\u2705 Ready) sets code_review passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-code-pass-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'review code' },
      tool_output: { content: '## Review\nAll good\n\u2705 Ready' },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.code_review.passed, true);
});

test('MCP doc review pass (\u2705 Mergeable) sets doc_review passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-doc-pass-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'review docs' },
      tool_output: { content: '## Document Review\n\u2705 Mergeable' },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.doc_review.passed, true);
});

test('MCP code review block (\u26d4 Blocked) sets code_review passed false', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-code-block-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'review code' },
      tool_output: { content: '## Review\n\u26d4 Blocked\nP0 issues found' },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.code_review.passed, false);
});

test('MCP doc review block (\u26d4 Needs revision) via codex-reply sets doc_review passed false', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-doc-block-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex-reply',
      tool_input: { prompt: 'continue review' },
      tool_output: { content: '## Document Review\n\u26d4 Needs revision\nMissing sections' },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.doc_review.passed, false);
});

test('MCP \u2705 All Pass routes to code_review', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-allpass-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'review' },
      tool_output: { content: '\u2705 All Pass' },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.code_review.passed, true);
});

test('MCP ambiguous ## Gate: \u2705 alone does not create state', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-ambiguous-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'review' },
      tool_output: { content: '## Gate: \u2705' },
    },
  });
  assert.equal(result.status, 0);
  const statePath = join(workDir, '.claude_review_state.json');
  assert.equal(existsSync(statePath), false, 'ambiguous gate alone should not create state');
});

test('MCP content as array format sets code_review', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-array-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'review' },
      tool_output: { content: [{ type: 'text', text: '\u2705 Ready' }] },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.code_review.passed, true);
});

test('MCP security review \u2705 Mergeable: No P0 does NOT set doc_review', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-sec-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'security review' },
      tool_output: { content: '### Gate\n\u2705 Mergeable: No P0\n\u26d4 Must fix: Has P0' },
    },
  });
  assert.equal(result.status, 0);
  const statePath = join(workDir, '.claude_review_state.json');
  assert.equal(existsSync(statePath), false, 'security review should not create doc_review state');
});

test('MCP plain string tool_output does not crash hook', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-string-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'brainstorm' },
      tool_output: 'Some plain text output without sentinels',
    },
  });
  assert.equal(result.status, 0, 'hook should not crash on plain string tool_output');
  const statePath = join(workDir, '.claude_review_state.json');
  assert.equal(existsSync(statePath), false, 'no sentinel means no state update');
});

test('MCP precommit FAIL sets precommit passed false', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-precommit-fail-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'precommit' },
      tool_output: { content: '## Overall: \u26d4 FAIL\ntest:unit failed' },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.precommit.executed, true);
  assert.equal(state.precommit.passed, false);
});

test('MCP precommit PASS sets precommit passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-precommit-pass-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'precommit' },
      tool_output: { content: '## Overall: \u2705 PASS\nall checks passed' },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.precommit.executed, true);
  assert.equal(state.precommit.passed, true);
});

test('D1: security review with ✅ Mergeable but no ## Document Review does NOT set doc_review', () => {
  const workDir = makeTempDir('sd0x-post-tool-d1-sec-collision-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'security review' },
      tool_output: { content: '## Security Review Report\n### Gate\n\u2705 Mergeable\nNo critical issues' },
    },
  });
  assert.equal(result.status, 0);
  const statePath = join(workDir, '.claude_review_state.json');
  assert.equal(existsSync(statePath), false, 'security review without ## Document Review header should not set doc_review');
});

test('D1: doc review with ## Document Review + ✅ Mergeable sets doc_review', () => {
  const workDir = makeTempDir('sd0x-post-tool-d1-doc-ok-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'review docs' },
      tool_output: { content: '## Document Review Report\nAll sections present\n\u2705 Mergeable' },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.doc_review.passed, true, 'doc review with correct header should set doc_review.passed');
});

test('D1: security review with ⛔ Needs revision but no ## Document Review does NOT set doc_review', () => {
  const workDir = makeTempDir('sd0x-post-tool-d1-sec-needs-rev-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'security review' },
      tool_output: { content: '## Security Review Report\n### Gate\n\u26d4 Needs revision\nCritical issues found' },
    },
  });
  assert.equal(result.status, 0);
  const statePath = join(workDir, '.claude_review_state.json');
  assert.equal(existsSync(statePath), false, 'security review with ⛔ Needs revision but no ## Document Review header should not set doc_review');
});

// =============================================================================
// Qualified (namespaced) command tests — /sd0x-dev-flow:command
// =============================================================================

test('/sd0x-dev-flow:codex-review-fast pass sets code_review passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-qual-code-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/sd0x-dev-flow:codex-review-fast' },
      tool_output: '## Gate: \u2705',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.code_review.passed, true, 'qualified codex-review-fast should set code_review');
});

test('/sd0x-dev-flow:codex-review-doc pass sets doc_review passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-qual-doc-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/sd0x-dev-flow:codex-review-doc' },
      tool_output: '\u2705 All Pass',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.doc_review.passed, true, 'qualified codex-review-doc should set doc_review');
});

test('/sd0x-dev-flow:precommit pass sets precommit passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-qual-pre-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/sd0x-dev-flow:precommit' },
      tool_output: '## Overall: \u2705 PASS',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.precommit.passed, true, 'qualified precommit should set precommit');
});

test('/sd0x-dev-flow:review-spec pass sets doc_review passed true', () => {
  const workDir = makeTempDir('sd0x-post-tool-qual-review-spec-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'Bash',
      tool_input: { command: '/sd0x-dev-flow:review-spec' },
      tool_output: '\u2705 All Pass',
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.equal(state.doc_review.passed, true, 'qualified review-spec should set doc_review');
});

test('MCP doc review mentioning OWASP still sets doc_review (regression)', () => {
  const workDir = makeTempDir('sd0x-post-tool-mcp-doc-owasp-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    input: {
      tool_name: 'mcp__codex__codex',
      tool_input: { prompt: 'review docs' },
      tool_output: { content: '## Document Review\nThis doc covers OWASP guidelines\n### Gate\n\u2705 Mergeable: No \ud83d\udd34 items' },
    },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.doc_review.passed, true, 'doc mentioning OWASP should still route to doc_review');
});
