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

test('each line of namespace-hint.sh output is under 100 chars', () => {
  const output = execFileSync('bash', [scriptPath], { encoding: 'utf8' });
  const lines = output.trim().split('\n');
  assert.ok(lines.length >= 1, 'output should have at least 1 line');
  for (const line of lines) {
    assert.ok(line.length < 100, `line should be under 100 chars: "${line}" (${line.length})`);
  }
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
