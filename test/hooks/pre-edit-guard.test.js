const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const hookPath = resolve(__dirname, '../../hooks/pre-edit-guard.sh');
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

/**
* Create a stub jq that handles:
* 1. -r '.tool_input.file_path // empty' (from stdin)
* 1. -e '.. | strings | select(contains("X"))' FILE (arbitration guard)
 */
function setupStubBin() {
  const binDir = makeTempDir('sd0x-pre-edit-guard-bin-');
  const stubJq = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
let query;
let file;
let hasExitFlag = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-r') continue;
  if (arg === '-e') { hasExitFlag = true; continue; }
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

process.stdout.write('');
`;
  writeExecutable(join(binDir, 'jq'), stubJq);
  return binDir;
}

/**
* Create an empty bin directory (no jq) to test graceful degradation
 */
function setupEmptyBin() {
  return makeTempDir('sd0x-pre-edit-guard-empty-bin-');
}

function runHook({ binDir, filePath, env = {} }) {
  const input = { tool_input: { file_path: filePath } };
  return spawnSync('bash', [hookPath], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      ...env,
    },
  });
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// =============================================================================
// Normal paths (should allow)
// =============================================================================

test('allows normal file path', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/Users/dev/project/src/index.ts' });
  assert.equal(result.status, 0);
});

test('allows path with spaces', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/Users/dev/my project/file.js' });
  assert.equal(result.status, 0);
});

test('allows empty file_path (no-op)', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '' });
  assert.equal(result.status, 0);
});

test('allows path with standalone $ (new behavior)', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/path/to/$variable.txt' });
  assert.equal(result.status, 0);
});

test('allows path with $ in middle', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/path/foo$bar.txt' });
  assert.equal(result.status, 0);
});

// =============================================================================
// Sensitive paths (should block)
// =============================================================================

test('blocks .env file', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/project/.env' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Blocked sensitive file/);
});

test('blocks .env.local file', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/project/.env.local' });
  assert.equal(result.status, 2);
});

test('blocks .env.production file', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/project/.env.production' });
  assert.equal(result.status, 2);
});

test('blocks .git/ directory files', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/project/.git/config' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Blocked sensitive file/);
});

test('blocks nested .git/ path', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/project/.git/hooks/pre-commit' });
  assert.equal(result.status, 2);
});

// =============================================================================
// Shell metacharacters (should block)
// =============================================================================

test('blocks path with semicolon (command injection)', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/path/file;rm -rf /' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /shell metacharacters/);
});

test('blocks path with ampersand (background execution)', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/path/file&whoami' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /shell metacharacters/);
});

test('blocks path with pipe (command chaining)', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/path/file|cat /etc/passwd' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /shell metacharacters/);
});

test('blocks path with backtick (command substitution)', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/path/`whoami`.txt' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /shell metacharacters/);
});

test('blocks path with $( (command substitution)', () => {
  const binDir = setupStubBin();
  const result = runHook({ binDir, filePath: '/path/$(whoami).txt' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /shell metacharacters/);
});

// Note: Null byte test removed - bash variables cannot contain \0,
// so the check is ineffective. jq would strip null bytes anyway.

// =============================================================================
// GUARD_EXTRA_PATTERNS (custom patterns)
// =============================================================================

test('blocks path matching GUARD_EXTRA_PATTERNS', () => {
  const binDir = setupStubBin();
  const result = runHook({
    binDir,
    filePath: '/project/src/locales/en.json',
    env: { GUARD_EXTRA_PATTERNS: 'src/locales/.*\\.json$' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Blocked by custom pattern/);
});

test('allows path not matching GUARD_EXTRA_PATTERNS', () => {
  const binDir = setupStubBin();
  const result = runHook({
    binDir,
    filePath: '/project/src/index.ts',
    env: { GUARD_EXTRA_PATTERNS: 'src/locales/.*\\.json$' },
  });
  assert.equal(result.status, 0);
});

test('handles invalid GUARD_EXTRA_PATTERNS regex gracefully', () => {
  const binDir = setupStubBin();
  const result = runHook({
    binDir,
    filePath: '/project/src/index.ts',
    env: { GUARD_EXTRA_PATTERNS: '[invalid' },
  });
  // Should not crash, should allow (exit 0) and warn
  assert.equal(result.status, 0);
});

// =============================================================================
// Graceful degradation (no jq)
// =============================================================================

test('gracefully allows when jq is not available', () => {
  const binDir = setupEmptyBin();
  const result = runHook({ binDir, filePath: '/path/to/file.js' });
  // When jq fails, hook should be a no-op (exit 0)
  assert.equal(result.status, 0);
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
        PreToolUse: [
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
  const workDir = makeTempDir('sd0x-pre-edit-arb-defer-');
  const binDir = setupStubBin();
  setupLocalHook(workDir, 'pre-edit-guard.sh');
  writeSettingsWithHook(workDir, 'pre-edit-guard.sh');
  const result = runHook({
    binDir,
    filePath: '/project/.env',
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  // Should exit 0 (defer) — NOT exit 2 (which it would if it ran)
  assert.equal(result.status, 0, 'should defer to local hook');
  assert.ok(
    !result.stderr.includes('Blocked sensitive file'),
    'should not produce guard output'
  );
});

test('arbitration: dev mode bypass when hooks/hooks.json exists', () => {
  const workDir = makeTempDir('sd0x-pre-edit-arb-dev-');
  const binDir = setupStubBin();
  mkdirSync(join(workDir, 'hooks'), { recursive: true });
  writeFileSync(join(workDir, 'hooks', 'hooks.json'), '{}');
  setupLocalHook(workDir, 'pre-edit-guard.sh');
  writeSettingsWithHook(workDir, 'pre-edit-guard.sh');
  const result = runHook({
    binDir,
    filePath: '/project/.env',
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  // Should run normally (block .env) — exit 2
  assert.equal(result.status, 2, 'should run normally in dev mode');
});

test('arbitration: no local hook runs normally', () => {
  const workDir = makeTempDir('sd0x-pre-edit-arb-nohook-');
  const binDir = setupStubBin();
  writeSettingsWithHook(workDir, 'pre-edit-guard.sh');
  const result = runHook({
    binDir,
    filePath: '/project/.env',
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.equal(result.status, 2, 'should run normally and block .env');
});

test('arbitration: CLAUDE_PROJECT_DIR unset runs normally', () => {
  const binDir = setupStubBin();
  const result = runHook({
    binDir,
    filePath: '/project/.env',
  });
  assert.equal(result.status, 2, 'should run normally and block .env');
});

test('arbitration: local hook exists but not in settings runs normally', () => {
  const workDir = makeTempDir('sd0x-pre-edit-arb-noreg-');
  const binDir = setupStubBin();
  setupLocalHook(workDir, 'pre-edit-guard.sh');
  // No settings file
  const result = runHook({
    binDir,
    filePath: '/project/.env',
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.equal(result.status, 2, 'should run normally when not registered');
});

test('arbitration: registered in settings.local.json defers', () => {
  const workDir = makeTempDir('sd0x-pre-edit-arb-local-');
  const binDir = setupStubBin();
  setupLocalHook(workDir, 'pre-edit-guard.sh');
  writeSettingsWithHook(workDir, 'pre-edit-guard.sh', 'settings.local.json');
  const result = runHook({
    binDir,
    filePath: '/project/.env',
    env: { CLAUDE_PROJECT_DIR: workDir },
  });
  assert.equal(result.status, 0, 'should defer via settings.local.json');
  assert.ok(
    !result.stderr.includes('Blocked sensitive file'),
    'should not produce guard output'
  );
});

// === deep-explore regression: NotebookEdit must not bypass the guard ===

test('NotebookEdit notebook_path targeting .env → rejected (exit 2)', () => {
  const binDir = setupStubBin();
  const result = spawnSync('bash', [hookPath], {
    input: JSON.stringify({
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: '/project/.env' },
    }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
  });
  assert.equal(result.status, 2, 'guard must read notebook_path, not just file_path');
});
