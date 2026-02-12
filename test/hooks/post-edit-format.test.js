const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
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
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-r') continue;
  if (arg === '--arg') {
    vars[args[i + 1]] = args[i + 2];
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

// Handle .tool_input.file_path
if (query && query.includes('.tool_input.file_path')) {
  const val = (data.tool_input && data.tool_input.file_path) || '';
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
