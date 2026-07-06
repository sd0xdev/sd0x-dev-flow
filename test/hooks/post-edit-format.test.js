const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
  existsSync,
  realpathSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const hookPath = resolve(__dirname, '../../hooks/post-edit-format.sh');
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
  const binDir = makeTempDir('sd0x-post-edit-format-bin-');

  // Stub jq that handles:
  // 1. -r '.tool_input.file_path // empty' (from stdin)
  // 2. --arg flag X --arg now Y '.[$flag] = ...' FILE (state file update)
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
  if (!query) { query = arg; continue; }
  if (!file) { file = arg; continue; }
}
let input = '';
try {
  input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
} catch {}
let data = {};
try {
  data = input ? JSON.parse(input) : {};
} catch {}

// Handle .tool_input.file_path (with notebook_path coalesce, mirroring jq //)
if (query && query.includes('.tool_input.file_path')) {
  const ti = data.tool_input || {};
  const val = ti.file_path || (query.includes('notebook_path') ? ti.notebook_path : '') || '';
  process.stdout.write(val);
  process.exit(0);
}

// Handle state file update: .[$flag] = true | .updated_at = $now
if (query && query.includes('[$flag]') && vars.flag) {
  data[vars.flag] = true;
  data.updated_at = vars.now || '';
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Handle invalidate_review: .[$key].passed = false
if (query && query.includes('.passed = false') && vars.key) {
  if (data[vars.key] && typeof data[vars.key] === 'object') {
    data[vars.key].passed = false;
  }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Handle atomic doc write: .has_doc_change = true | .updated_at = $now | .doc_review.passed = false [| aggregate_gate reset]
if (query && query.includes('has_doc_change = true') && query.includes('doc_review.passed = false')) {
  data.has_doc_change = true;
  data.updated_at = vars.now || '';
  if (!data.doc_review) data.doc_review = {};
  data.doc_review.passed = false;
  if (query.includes('aggregate_gate.executed = false') && data.aggregate_gate) {
    data.aggregate_gate.executed = false;
    data.aggregate_gate.gate = null;
    data.aggregate_gate.reason = null;
  }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Handle has("aggregate_gate") check
if (query && query.includes('has("aggregate_gate")')) {
  process.stdout.write(Object.prototype.hasOwnProperty.call(data, 'aggregate_gate') ? 'true' : 'false');
  process.exit(0);
}

// Handle aggregate_gate invalidation: .aggregate_gate.executed = false | .aggregate_gate.gate = null | .aggregate_gate.reason = null
if (query && query.includes('aggregate_gate.executed = false') && query.includes('aggregate_gate.gate = null')) {
  if (data.aggregate_gate) {
    data.aggregate_gate.executed = false;
    data.aggregate_gate.gate = null;
    data.aggregate_gate.reason = null;
  }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Handle contains query (arbitration guard)
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

// Handle schema_version read (migration check)
if (query && query.includes('schema_version // 1')) {
  const ver = data.schema_version || 1;
  process.stdout.write(String(ver));
  process.exit(0);
}

// Handle has("iteration_history") check
if (query && query.includes('has("iteration_history")')) {
  const has = Object.prototype.hasOwnProperty.call(data, 'iteration_history');
  process.stdout.write(has ? 'true' : 'false');
  process.exit(has ? 0 : 1);
}

// Handle iteration reset: .iteration_history.current_round = 0 | .iteration_history.findings_by_round = []
if (query && query.includes('iteration_history.current_round = 0')) {
  if (data.iteration_history) {
    data.iteration_history.current_round = 0;
    data.iteration_history.findings_by_round = [];
  }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Handle session_commit_scope validity check (D-5)
if (query && query.includes('session_commit_scope.session_id') && query.includes('baseline_dirty_files')) {
  const scs = data.session_commit_scope;
  const valid = scs && scs.session_id === data.session_id && scs.baseline_dirty_files !== null && scs.baseline_dirty_files !== undefined;
  process.stdout.write(valid ? 'yes' : 'no');
  process.exit(0);
}

// Handle session_commit_scope.touched_files append (D-5)
if (query && query.includes('session_commit_scope.touched_files') && vars.f) {
  if (!data.session_commit_scope) data.session_commit_scope = {};
  const files = data.session_commit_scope.touched_files || [];
  if (!files.includes(vars.f)) files.push(vars.f);
  files.sort();
  data.session_commit_scope.touched_files = files;
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

// Handle schema migration: .schema_version = 2 | .iteration_history //= {...}
if (query && query.includes('schema_version = 2') && query.includes('iteration_history')) {
  data.schema_version = 2;
  if (!data.iteration_history) {
    data.iteration_history = { current_round: 0, max_rounds: 10, findings_by_round: [] };
  }
  process.stdout.write(JSON.stringify(data));
  process.exit(0);
}

process.stdout.write('');
`;
  writeExecutable(join(binDir, 'jq'), stubJq);

  // Stub npx (simulates prettier without actually formatting)
  writeExecutable(join(binDir, 'npx'), '#!/bin/sh\nexit 0\n');

  return binDir;
}

function runHook({ cwd, binDir, filePath, env = {} }) {
  const input = { tool_input: { file_path: filePath } };
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

// =============================================================================
// Basic exit paths
// =============================================================================

test('empty file_path exits 0 with no state', () => {
  const workDir = makeTempDir('sd0x-format-empty-');
  const binDir = setupStubBin();
  const result = runHook({ cwd: workDir, binDir, filePath: '' });
  assert.equal(result.status, 0);
  assert.equal(readState(workDir), null);
});

test('suspicious path exits 0 with warning', () => {
  const workDir = makeTempDir('sd0x-format-suspicious-');
  const binDir = setupStubBin();
  const result = runHook({ cwd: workDir, binDir, filePath: '/path/file;rm -rf /' });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Rejected suspicious file path/);
  assert.equal(readState(workDir), null);
});

// =============================================================================
// State tracking: code changes
// =============================================================================

test('.ts file sets has_code_change in state', () => {
  const workDir = makeTempDir('sd0x-format-ts-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.has_code_change, true);
});

test('.tsx file sets has_code_change in state', () => {
  const workDir = makeTempDir('sd0x-format-tsx-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/Component.tsx',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.has_code_change, true);
});

test('.js file sets has_code_change in state', () => {
  const workDir = makeTempDir('sd0x-format-js-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/scripts/build.js',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.has_code_change, true);
});

test('.sh shell hook sets has_code_change in state (this repo is .sh-primary)', () => {
  const workDir = makeTempDir('sd0x-format-sh-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/hooks/stop-guard.sh',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.has_code_change, true, '.sh edits must engage the review gate');
});

test('.bash shell script sets has_code_change in state', () => {
  const workDir = makeTempDir('sd0x-format-bash-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/scripts/deploy.bash',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.has_code_change, true);
});

test('.zsh shell script sets has_code_change in state', () => {
  const workDir = makeTempDir('sd0x-format-zsh-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/scripts/profile.zsh',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.has_code_change, true);
});

// =============================================================================
// State tracking: doc changes
// =============================================================================

test('.md file sets has_doc_change in state', () => {
  const workDir = makeTempDir('sd0x-format-md-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/docs/readme.md',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.has_doc_change, true);
});

test('.mdx file sets has_doc_change in state', () => {
  const workDir = makeTempDir('sd0x-format-mdx-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/docs/page.mdx',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.has_doc_change, true);
});

// =============================================================================
// Non-tracked extensions
// =============================================================================

test('.json file does not update state', () => {
  const workDir = makeTempDir('sd0x-format-json-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/config.json',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  assert.equal(readState(workDir), null);
});

test('.py file tracks as code change', () => {
  const workDir = makeTempDir('sd0x-format-py-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/script.py',
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'State file should be created for .py');
  assert.equal(state.has_code_change, true, '.py should set has_code_change');
});

// =============================================================================
// Vendor path filtering
// =============================================================================

test('vendor path (node_modules) skips all tracking', () => {
  const workDir = makeTempDir('sd0x-format-vendor-');
  // Use realpathSync to match Bash $PWD (macOS: /var -> /private/var)
  const physDir = realpathSync(workDir);
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: join(physDir, 'node_modules/pkg/index.js'),
  });
  assert.equal(result.status, 0);
  assert.equal(readState(workDir), null, 'vendor files should not create state');
});

test('src/build/ is NOT treated as vendor (no false positive)', () => {
  const workDir = makeTempDir('sd0x-format-srcbuild-');
  const physDir = realpathSync(workDir);
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: join(physDir, 'src/build/helpers.ts'),
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'src/build/*.ts should still be tracked');
  assert.equal(state.has_code_change, true);
});

// =============================================================================
// Stderr messages
// =============================================================================

test('.ts file logs code change to stderr', () => {
  const workDir = makeTempDir('sd0x-format-ts-log-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.match(result.stderr, /Code change detected/);
});

test('.md file logs doc change to stderr', () => {
  const workDir = makeTempDir('sd0x-format-md-log-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/docs/readme.md',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.match(result.stderr, /Doc change detected/);
});

// =============================================================================
// HOOK_NO_FORMAT still tracks changes
// =============================================================================

test('HOOK_NO_FORMAT=1 still tracks code changes', () => {
  const workDir = makeTempDir('sd0x-format-noformat-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/index.tsx',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.has_code_change, true);
});

// =============================================================================
// State file initialization
// =============================================================================

test('state file initializes with correct structure', () => {
  const workDir = makeTempDir('sd0x-format-init-');
  const binDir = setupStubBin();
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  // Check initial structure is preserved
  assert.equal(typeof state.session_id, 'string');
  assert.equal(typeof state.updated_at, 'string');
  assert.equal(state.has_code_change, true);
  assert.equal(state.has_doc_change, false);
  assert.ok(state.code_review);
  assert.ok(state.doc_review);
  assert.ok(state.precommit);
});

// =============================================================================
// Edit-time invalidation
// =============================================================================

test('code edit invalidates code_review.passed', () => {
  const workDir = makeTempDir('sd0x-format-invalidate-code-');
  const binDir = setupStubBin();
  // Pre-seed state with passed code_review
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: false,
      code_review: { executed: true, passed: true, last_run: 'T1' },
      doc_review: { executed: false, passed: false, last_run: '' },
      precommit: { executed: false, passed: false, last_run: '' },
    })
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.code_review.passed, false, 'code_review.passed should be invalidated');
  assert.equal(state.code_review.executed, true, 'code_review.executed should be preserved');
  assert.equal(state.code_review.last_run, 'T1', 'code_review.last_run should be preserved');
});

test('code edit invalidates precommit.passed', () => {
  const workDir = makeTempDir('sd0x-format-invalidate-precommit-');
  const binDir = setupStubBin();
  // Pre-seed state with passed precommit
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: false,
      code_review: { executed: false, passed: false, last_run: '' },
      doc_review: { executed: false, passed: false, last_run: '' },
      precommit: { executed: true, passed: true, last_run: 'T1' },
    })
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/scripts/build.js',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.precommit.passed, false, 'precommit.passed should be invalidated');
  assert.equal(state.precommit.executed, true, 'precommit.executed should be preserved');
});

test('doc edit invalidates doc_review.passed', () => {
  const workDir = makeTempDir('sd0x-format-invalidate-doc-');
  const binDir = setupStubBin();
  // Pre-seed state with passed doc_review
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: false,
      code_review: { executed: false, passed: false, last_run: '' },
      doc_review: { executed: true, passed: true, last_run: 'T1' },
      precommit: { executed: false, passed: false, last_run: '' },
    })
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/docs/readme.md',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.doc_review.passed, false, 'doc_review.passed should be invalidated');
  assert.equal(state.doc_review.executed, true, 'doc_review.executed should be preserved');
  assert.equal(state.doc_review.last_run, 'T1', 'doc_review.last_run should be preserved');
});

// =============================================================================
// aggregate_gate invalidation (dual-mode)
// =============================================================================

test('code edit resets aggregate_gate', () => {
  const workDir = makeTempDir('sd0x-format-agg-code-');
  const binDir = setupStubBin();
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: false,
      has_doc_change: false,
      code_review: { executed: true, passed: true, last_run: 'T1' },
      doc_review: { executed: false, passed: false, last_run: '' },
      precommit: { executed: false, passed: false, last_run: '' },
      aggregate_gate: { executed: true, gate: 'READY', reason: null, last_run: 'T1' },
    })
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.aggregate_gate.executed, false, 'aggregate_gate.executed should be reset');
  assert.equal(state.aggregate_gate.gate, null, 'aggregate_gate.gate should be reset');
  assert.equal(state.aggregate_gate.reason, null, 'aggregate_gate.reason should be reset');
});

test('doc edit resets aggregate_gate', () => {
  const workDir = makeTempDir('sd0x-format-agg-doc-');
  const binDir = setupStubBin();
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: false,
      has_doc_change: false,
      code_review: { executed: false, passed: false, last_run: '' },
      doc_review: { executed: true, passed: true, last_run: 'T1' },
      precommit: { executed: false, passed: false, last_run: '' },
      aggregate_gate: { executed: true, gate: 'READY', reason: null, last_run: 'T1' },
    })
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/docs/guide.md',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.aggregate_gate.executed, false, 'aggregate_gate.executed should be reset on doc edit');
  assert.equal(state.aggregate_gate.gate, null, 'aggregate_gate.gate should be reset on doc edit');
  assert.equal(state.aggregate_gate.reason, null, 'aggregate_gate.reason should be reset on doc edit');
});

test('no aggregate_gate in state: edit does not crash', () => {
  const workDir = makeTempDir('sd0x-format-agg-missing-');
  const binDir = setupStubBin();
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: false,
      code_review: { executed: false, passed: false, last_run: '' },
      doc_review: { executed: false, passed: false, last_run: '' },
      precommit: { executed: false, passed: false, last_run: '' },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0, 'should not crash when aggregate_gate is absent');
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.has_code_change, true);
});

test('code edit clears sidecar .blocked marker', () => {
  const workDir = makeTempDir('sd0x-format-sidecar-clear-');
  const binDir = setupStubBin();
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      review_mode: 'dual',
      has_code_change: false,
      has_doc_change: false,
      code_review: { executed: false, passed: false, last_run: '' },
      doc_review: { executed: false, passed: false, last_run: '' },
      precommit: { executed: false, passed: false, last_run: '' },
      aggregate_gate: { executed: true, gate: 'BLOCKED', reason: 'lock_failure', last_run: 'T1' },
    })
  );
  // Create sidecar marker
  writeFileSync(join(workDir, '.claude_review_state.json.blocked'), 'lock_failure');
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(
    existsSync(join(workDir, '.claude_review_state.json.blocked')),
    false,
    'sidecar .blocked marker should be cleared after successful edit'
  );
});

test('doc edit atomic state update — flag + review + aggregate in single write', () => {
  const workDir = makeTempDir('sd0x-format-doc-atomic-');
  const binDir = setupStubBin();
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_doc_change: false,
      has_code_change: false,
      code_review: { executed: false, passed: false, last_run: '' },
      doc_review: { executed: true, passed: true, last_run: 'T1' },
      precommit: { executed: false, passed: false, last_run: '' },
      aggregate_gate: { executed: true, gate: 'READY', reason: null },
    })
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/docs/readme.md',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state, 'state file should exist');
  assert.equal(state.has_doc_change, true, 'should set has_doc_change');
  assert.equal(state.doc_review.passed, false, 'should invalidate doc_review');
  assert.equal(state.aggregate_gate.executed, false, 'should reset aggregate_gate.executed');
  assert.equal(state.aggregate_gate.gate, null, 'should null aggregate_gate.gate');
  assert.ok(state.updated_at, 'should set updated_at');
});

test('doc edit does NOT invalidate code_review', () => {
  const workDir = makeTempDir('sd0x-format-doc-no-code-invalidate-');
  const binDir = setupStubBin();
  // Pre-seed state with passed code_review
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      has_code_change: false,
      has_doc_change: false,
      code_review: { executed: true, passed: true, last_run: 'T1' },
      doc_review: { executed: false, passed: false, last_run: '' },
      precommit: { executed: false, passed: false, last_run: '' },
    })
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/docs/readme.md',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(state.code_review.passed, true, 'code_review.passed should NOT be affected by doc edit');
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
        PostToolUse: [
          {
            matcher: 'Edit|Write',
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
  const workDir = makeTempDir('sd0x-format-arb-defer-');
  const binDir = setupStubBin();
  setupLocalHook(workDir, 'post-edit-format.sh');
  writeSettingsWithHook(workDir, 'post-edit-format.sh');
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { CLAUDE_PROJECT_DIR: workDir, HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0, 'should defer to local hook');
  // Deferred means no state file created
  assert.equal(readState(workDir), null, 'should not create state when deferred');
});

test('arbitration: dev mode bypass when hooks/hooks.json exists', () => {
  const workDir = makeTempDir('sd0x-format-arb-dev-');
  const binDir = setupStubBin();
  mkdirSync(join(workDir, 'hooks'), { recursive: true });
  writeFileSync(join(workDir, 'hooks', 'hooks.json'), '{}');
  setupLocalHook(workDir, 'post-edit-format.sh');
  writeSettingsWithHook(workDir, 'post-edit-format.sh');
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { CLAUDE_PROJECT_DIR: workDir, HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'should run normally and create state in dev mode');
  assert.equal(state.has_code_change, true);
});

test('arbitration: no local hook runs normally', () => {
  const workDir = makeTempDir('sd0x-format-arb-nohook-');
  const binDir = setupStubBin();
  writeSettingsWithHook(workDir, 'post-edit-format.sh');
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { CLAUDE_PROJECT_DIR: workDir, HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state, 'should run normally when no local hook');
  assert.equal(state.has_code_change, true);
});

test('arbitration: CLAUDE_PROJECT_DIR unset runs normally', () => {
  const workDir = makeTempDir('sd0x-format-arb-noenv-');
  const binDir = setupStubBin();
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state, 'should run normally without CLAUDE_PROJECT_DIR');
  assert.equal(state.has_code_change, true);
});

test('arbitration: local hook exists but not in settings runs normally', () => {
  const workDir = makeTempDir('sd0x-format-arb-noreg-');
  const binDir = setupStubBin();
  setupLocalHook(workDir, 'post-edit-format.sh');
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { CLAUDE_PROJECT_DIR: workDir, HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state, 'should run normally when not registered');
  assert.equal(state.has_code_change, true);
});

test('arbitration: registered in settings.local.json defers', () => {
  const workDir = makeTempDir('sd0x-format-arb-local-');
  const binDir = setupStubBin();
  setupLocalHook(workDir, 'post-edit-format.sh');
  writeSettingsWithHook(workDir, 'post-edit-format.sh', 'settings.local.json');
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { CLAUDE_PROJECT_DIR: workDir, HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0, 'should defer via settings.local.json');
  assert.equal(readState(workDir), null, 'should not create state when deferred');
});

// =============================================================================
// D-5: Session Commit Scope — touched_files tracking
// =============================================================================

test('D-5: code edit adds file to session_commit_scope.touched_files', () => {
  const workDir = makeTempDir('sd0x-format-scope-code-');
  const binDir = setupStubBin();
  // Init git repo so _track_session_touched_file can resolve repo root
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: workDir });
  // Use realpath to handle macOS /var -> /private/var symlink
  const resolvedWorkDir = realpathSync(workDir);
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: 'sess-1',
      session_commit_scope: {
        session_id: 'sess-1',
        baseline_dirty_files: [],
        touched_files: [],
        updated_at: '2026-01-01T00:00:00Z',
      },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: `${resolvedWorkDir}/src/app.ts`,
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state.session_commit_scope, 'should have session_commit_scope');
  assert.ok(
    state.session_commit_scope.touched_files.includes('src/app.ts'),
    'should add repo-relative path to touched_files'
  );
});

test('D-5: doc edit adds file to session_commit_scope.touched_files', () => {
  const workDir = makeTempDir('sd0x-format-scope-doc-');
  const binDir = setupStubBin();
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: workDir });
  const resolvedWorkDir = realpathSync(workDir);
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: 'sess-2',
      session_commit_scope: {
        session_id: 'sess-2',
        baseline_dirty_files: [],
        touched_files: [],
        updated_at: '2026-01-01T00:00:00Z',
      },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: `${resolvedWorkDir}/docs/readme.md`,
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(
    state.session_commit_scope.touched_files.includes('docs/readme.md'),
    'should track doc file in touched_files'
  );
});

test('D-5: non-code/non-doc file (.json) adds to touched_files via catch-all', () => {
  const workDir = makeTempDir('sd0x-format-scope-json-');
  const binDir = setupStubBin();
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: workDir });
  const resolvedWorkDir = realpathSync(workDir);
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: 'sess-json',
      session_commit_scope: {
        session_id: 'sess-json',
        baseline_dirty_files: [],
        touched_files: [],
        updated_at: '2026-01-01T00:00:00Z',
      },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: `${resolvedWorkDir}/config/settings.json`,
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(
    state.session_commit_scope.touched_files.includes('config/settings.json'),
    'should track .json file via catch-all block'
  );
});

test('D-5: scope invalid (session_id mismatch) does not track', () => {
  const workDir = makeTempDir('sd0x-format-scope-mismatch-');
  const binDir = setupStubBin();
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: workDir });
  const resolvedWorkDir = realpathSync(workDir);
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: 'current-sess',
      session_commit_scope: {
        session_id: 'old-sess',  // mismatched
        baseline_dirty_files: [],
        touched_files: [],
      },
    })
  );
  const result = runHook({
    cwd: workDir,
    binDir,
    filePath: `${resolvedWorkDir}/src/app.ts`,
    env: { HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.deepEqual(
    state.session_commit_scope.touched_files, [],
    'should not track when scope session_id mismatches'
  );
});

// =============================================================================
// R6: max_rounds project override applied on init
// =============================================================================

test('R6: init reads project max_rounds override (15) on fresh state', () => {
  const workDir = makeTempDir('sd0x-format-r6-override-');
  const binDir = setupStubBin();
  mkdirSync(join(workDir, 'rules'), { recursive: true });
  writeFileSync(
    join(workDir, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project Overrides\n\n## Max Rounds\n15\n\n## Git Memory\n'
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(
    state.iteration_history.max_rounds, 15,
    'fresh init must read override from rules/auto-loop-project.md'
  );
});

test('R6: init reads override with real template shape (comment block between heading and value)', () => {
  const workDir = makeTempDir('sd0x-format-r6-realshape-');
  const binDir = setupStubBin();
  mkdirSync(join(workDir, 'rules'), { recursive: true });
  // Mirrors the shape generated by /install-rules: heading → blank → HTML comment → blank → override value
  writeFileSync(
    join(workDir, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project Overrides\n\n## Max Rounds\n\n<!-- Override the default max_rounds for review iteration hard cap.\n     Default: 10 (from auto-loop.md). Set lower for faster feedback, higher for complex reviews.\n     Range: 3-50. Parsed by hooks on schema migration.\n     To override: uncomment and set the line below (must be a bare integer, no comments). -->\n\n25\n\n## Git Memory\n'
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(
    state.iteration_history.max_rounds, 25,
    'parser must scan past HTML comment block to find bare integer override'
  );
});

test('R6: init ignores commented placeholder and falls back to default', () => {
  const workDir = makeTempDir('sd0x-format-r6-commented-');
  const binDir = setupStubBin();
  mkdirSync(join(workDir, 'rules'), { recursive: true });
  // Placeholder state (as shipped by /install-rules): value is still inside an HTML comment
  writeFileSync(
    join(workDir, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project Overrides\n\n## Max Rounds\n\n<!-- Override description. -->\n\n<!-- 10 -->\n\n## Git Memory\n'
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(
    state.iteration_history.max_rounds, 10,
    'commented-out placeholder must NOT be treated as an override'
  );
});

test('R6: init ignores integer inside multi-line HTML comment', () => {
  const workDir = makeTempDir('sd0x-format-r6-multiline-');
  const binDir = setupStubBin();
  mkdirSync(join(workDir, 'rules'), { recursive: true });
  // Integer placed inside a multi-line <!-- ... --> block must NOT be picked up as an override
  writeFileSync(
    join(workDir, 'rules', 'auto-loop-project.md'),
    '# Auto-Loop Project Overrides\n\n## Max Rounds\n<!--\n30\n-->\n\n## Git Memory\n'
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(
    state.iteration_history.max_rounds, 10,
    'integer inside multi-line HTML comment must be treated as commented-out'
  );
});

test('R6: init falls back to 10 when no override set', () => {
  const workDir = makeTempDir('sd0x-format-r6-default-');
  const binDir = setupStubBin();
  // No auto-loop-project.md — fallback to default 10
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(
    state.iteration_history.max_rounds, 10,
    'fresh init must default to 10 when no project override'
  );
});

test('R6: init rejects out-of-range override (100) and uses default', () => {
  const workDir = makeTempDir('sd0x-format-r6-reject-');
  const binDir = setupStubBin();
  mkdirSync(join(workDir, 'rules'), { recursive: true });
  writeFileSync(
    join(workDir, 'rules', 'auto-loop-project.md'),
    '# Overrides\n\n## Max Rounds\n100\n'
  );
  runHook({
    cwd: workDir,
    binDir,
    filePath: '/project/src/app.ts',
    env: { HOOK_NO_FORMAT: '1' },
  });
  const state = readState(workDir);
  assert.ok(state);
  assert.equal(
    state.iteration_history.max_rounds, 10,
    'out-of-range override must fall back to default'
  );
});

// === deep-explore regressions: prettier binary requirement + NotebookEdit ===

test('prettier config without installed binary → npx never invoked (no network fetch)', () => {
  const workDir = makeTempDir('sd0x-format-npx-guard-');
  const binDir = setupStubBin();
  const marker = join(workDir, 'npx-invoked.marker');
  writeExecutable(join(binDir, 'npx'), `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
  writeFileSync(join(workDir, '.prettierrc'), '{}');
  writeFileSync(join(workDir, 'app.js'), 'const x = 1;\n');
  const result = runHook({ cwd: workDir, binDir, filePath: 'app.js' });
  assert.equal(result.status, 0);
  assert.ok(
    !existsSync(marker),
    'config-only repo must not route through npx (per-edit network download)'
  );
});

test('local node_modules prettier binary → invoked directly (no config needed)', () => {
  const workDir = makeTempDir('sd0x-format-local-prettier-');
  const binDir = setupStubBin();
  const marker = join(workDir, 'prettier-invoked.marker');
  mkdirSync(join(workDir, 'node_modules', '.bin'), { recursive: true });
  writeExecutable(
    join(workDir, 'node_modules', '.bin', 'prettier'),
    `#!/bin/sh\ntouch "${marker}"\nexit 0\n`
  );
  writeFileSync(join(workDir, 'app.js'), 'const x = 1;\n');
  const result = runHook({ cwd: workDir, binDir, filePath: 'app.js' });
  assert.equal(result.status, 0);
  assert.ok(existsSync(marker), 'installed local prettier should run');
});

test('NotebookEdit notebook_path → tracked as code change (gate bypass regression)', () => {
  const workDir = makeTempDir('sd0x-format-notebook-');
  const binDir = setupStubBin();
  writeFileSync(join(workDir, 'analysis.ipynb'), '{}');
  const result = spawnSync('bash', [hookPath], {
    cwd: workDir,
    input: JSON.stringify({
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: 'analysis.ipynb' },
    }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  assert.ok(state, 'notebook edit must create/update review state');
  assert.equal(state.has_code_change, true, 'notebook edit must invalidate review');
});

test('global prettier + config file → invoked', () => {
  const workDir = makeTempDir('sd0x-format-global-prettier-');
  const binDir = setupStubBin();
  const marker = join(workDir, 'global-prettier.marker');
  writeExecutable(join(binDir, 'prettier'), `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
  writeFileSync(join(workDir, '.prettierrc'), '{}');
  writeFileSync(join(workDir, 'app.js'), 'const x = 1;\n');
  const result = runHook({ cwd: workDir, binDir, filePath: 'app.js' });
  assert.equal(result.status, 0);
  assert.ok(existsSync(marker), 'global prettier with project config should run');
});

test('global prettier without config file → not invoked (no project opt-in)', () => {
  const workDir = makeTempDir('sd0x-format-global-noconfig-');
  const binDir = setupStubBin();
  const marker = join(workDir, 'global-prettier.marker');
  writeExecutable(join(binDir, 'prettier'), `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
  writeFileSync(join(workDir, 'app.js'), 'const x = 1;\n');
  const result = runHook({ cwd: workDir, binDir, filePath: 'app.js' });
  assert.equal(result.status, 0);
  assert.ok(!existsSync(marker), 'global binary alone is not a project opt-in signal');
});

test('.ipynb with valid session scope → code branch: has_code_change + touched_files', () => {
  const workDir = makeTempDir('sd0x-format-notebook-scope-');
  const binDir = setupStubBin();
  spawnSync('git', ['init', '--initial-branch=main'], { cwd: workDir });
  const resolvedWorkDir = realpathSync(workDir);
  writeFileSync(
    join(workDir, '.claude_review_state.json'),
    JSON.stringify({
      schema_version: 2,
      session_id: 'sess-1',
      session_commit_scope: {
        session_id: 'sess-1',
        baseline_dirty_files: [],
        touched_files: [],
        updated_at: '2026-01-01T00:00:00Z',
      },
    })
  );
  writeFileSync(join(workDir, 'analysis.ipynb'), '{}');
  const result = spawnSync('bash', [hookPath], {
    cwd: workDir,
    input: JSON.stringify({
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: `${resolvedWorkDir}/analysis.ipynb` },
    }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, HOOK_NO_FORMAT: '1' },
  });
  assert.equal(result.status, 0);
  const state = readState(workDir);
  // has_code_change proves the notebook took the code branch (the generic
  // non-code branch tracks touched_files but never sets this flag).
  assert.equal(state.has_code_change, true, 'notebook must classify as code');
  assert.ok(
    state.session_commit_scope.touched_files.includes('analysis.ipynb'),
    'code branch must also record the notebook in session commit scope'
  );
});
