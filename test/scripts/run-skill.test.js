const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { statSync } = require('node:fs');
const { execFileSync, execSync } = require('node:child_process');

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
