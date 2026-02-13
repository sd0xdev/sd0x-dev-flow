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
* Create a stub jq that extracts .tool_input.file_path from JSON input
 */
function setupStubBin() {
  const binDir = makeTempDir('sd0x-pre-edit-guard-bin-');
  const stubJq = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);

// Read from stdin
let input = '';
try {
  input = fs.readFileSync(0, 'utf8');
} catch {}

let data = {};
try {
  data = input ? JSON.parse(input) : {};
} catch {}

// Extract .tool_input.file_path
const filePath = data.tool_input?.file_path ?? '';
process.stdout.write(filePath);
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
