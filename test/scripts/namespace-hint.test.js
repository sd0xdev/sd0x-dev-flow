const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { statSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../scripts/namespace-hint.sh');

test('namespace-hint.sh exists and is executable', () => {
  const stat = statSync(scriptPath);
  assert.ok(stat.isFile(), 'script should be a file');
  // Check executable bit (owner)
  assert.ok((stat.mode & 0o100) !== 0, 'script should be executable');
});

test('namespace-hint.sh output is under 100 chars', () => {
  const output = execFileSync('bash', [scriptPath], { encoding: 'utf8' }).trim();
  assert.ok(output.length > 0, 'output should not be empty');
  assert.ok(output.length < 100, `output should be under 100 chars, got ${output.length}`);
});

test('namespace-hint.sh output contains plugin name', () => {
  const output = execFileSync('bash', [scriptPath], { encoding: 'utf8' }).trim();
  assert.ok(output.includes('sd0x-dev-flow'), 'output should contain plugin name');
});

test('namespace-hint.sh output contains namespace guidance', () => {
  const output = execFileSync('bash', [scriptPath], { encoding: 'utf8' }).trim();
  assert.ok(
    output.includes('/sd0x-dev-flow:') || output.includes('sd0x-dev-flow:command'),
    'output should contain namespace example'
  );
});
