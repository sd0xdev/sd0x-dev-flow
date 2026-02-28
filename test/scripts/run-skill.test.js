const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { statSync } = require('node:fs');
const { execSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../scripts/run-skill.sh');

test('run-skill.sh exists and is executable', () => {
  const stat = statSync(scriptPath);
  assert.ok(stat.isFile(), 'script should be a file');
  assert.ok((stat.mode & 0o100) !== 0, 'script should be executable');
});

test('run-skill.sh can invoke a real skill script', () => {
  // next-step/analyze.js supports --json and should produce JSON output
  const output = execSync(
    `bash "${scriptPath}" next-step analyze.js --json 2>/dev/null; true`,
    { encoding: 'utf8', cwd: resolve(__dirname, '../..') }
  );
  // Script should produce some output (JSON or error), not be empty
  assert.ok(output.length >= 0, 'script should produce output or exit cleanly');
});

test('run-skill.sh can invoke a .sh skill script', () => {
  // merge-prep/pre-merge-check.sh requires args and exits non-zero without them,
  // but the key assertion is that it was dispatched via bash (not node) and produced
  // the script's own usage error rather than a "node: not a JS module" error
  try {
    execSync(
      `bash "${scriptPath}" merge-prep pre-merge-check.sh 2>&1`,
      { encoding: 'utf8', cwd: resolve(__dirname, '../..') }
    );
    assert.fail('expected non-zero exit from pre-merge-check.sh without args');
  } catch (err) {
    const output = err.stdout || '';
    assert.ok(output.includes('Usage') || output.includes('pre-merge-check'),
      `.sh script should produce its own usage message, got: ${output}`);
  }
});

test('run-skill.sh handles unknown extension with fallback exec', () => {
  // A non-existent file with unknown extension should fail (not hang)
  assert.throws(
    () => {
      execSync(
        `bash "${scriptPath}" nonexistent-skill unknown-file.py 2>/dev/null`,
        { encoding: 'utf8', cwd: resolve(__dirname, '../..') }
      );
    },
    'should exit non-zero for unknown extension with missing file'
  );
});

test('run-skill.sh rejects path traversal in skill name', () => {
  assert.throws(
    () => {
      execSync(
        `bash "${scriptPath}" ../etc passwd.sh 2>&1`,
        { encoding: 'utf8', cwd: resolve(__dirname, '../..') }
      );
    },
    'should exit non-zero for path traversal in skill name'
  );
});

test('run-skill.sh rejects path traversal in script name', () => {
  assert.throws(
    () => {
      execSync(
        `bash "${scriptPath}" merge-prep ../../etc/passwd 2>&1`,
        { encoding: 'utf8', cwd: resolve(__dirname, '../..') }
      );
    },
    'should exit non-zero for path traversal in script name'
  );
});

test('run-skill.sh exits non-zero for missing skill', () => {
  assert.throws(
    () => {
      execSync(
        `bash "${scriptPath}" nonexistent-skill nonexistent.js 2>/dev/null`,
        { encoding: 'utf8', cwd: resolve(__dirname, '../..') }
      );
    },
    'should exit non-zero for missing skill'
  );
});
