const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { statSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const scriptPath = resolve(__dirname, '../../scripts/emit-plan-gate.sh');

function runExpectFail(args, expectedFragment) {
  try {
    execFileSync('bash', [scriptPath, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.fail(`should have thrown for args: ${args.join(' ')}`);
  } catch (err) {
    if (err.code === 'ERR_ASSERTION') throw err;
    assert.ok(err.status !== 0, 'exit code should be non-zero');
    const output = (err.stdout || '') + (err.stderr || '');
    assert.ok(output.includes(expectedFragment), `should include '${expectedFragment}', got: ${output}`);
  }
}

test('emit-plan-gate.sh exists and is executable', () => {
  const stat = statSync(scriptPath);
  assert.ok(stat.isFile(), 'script should be a file');
  assert.ok((stat.mode & 0o100) !== 0, 'script should be executable');
});

test('emits PLAN_REVIEW_GATE for each of the 6 gates', () => {
  for (const gate of ['PENDING', 'READY', 'BLOCKED', 'DEGRADED', 'NEEDS_HUMAN', 'SKIPPED']) {
    const output = execFileSync('bash', [scriptPath, gate], { encoding: 'utf8' });
    assert.equal(output.trim(), `PLAN_REVIEW_GATE=${gate}`);
  }
});

test('PENDING with valid tier emits PLAN_REVIEW_TIER line', () => {
  for (const tier of ['quick', 'standard', 'deep']) {
    const output = execFileSync('bash', [scriptPath, 'PENDING', tier], { encoding: 'utf8' });
    assert.deepEqual(output.trim().split('\n'), [
      'PLAN_REVIEW_GATE=PENDING',
      `PLAN_REVIEW_TIER=${tier}`,
    ]);
  }
});

test('PENDING with invalid tier exits non-zero', () => {
  runExpectFail(['PENDING', 'turbo'], 'invalid tier');
});

test('DEGRADED with valid reason emits PLAN_REVIEW_REASON line', () => {
  for (const reason of ['reviewer-unavailable', 'secret-detected']) {
    const output = execFileSync('bash', [scriptPath, 'DEGRADED', reason], { encoding: 'utf8' });
    assert.deepEqual(output.trim().split('\n'), [
      'PLAN_REVIEW_GATE=DEGRADED',
      `PLAN_REVIEW_REASON=${reason}`,
    ]);
  }
});

test('DEGRADED with invalid reason exits non-zero', () => {
  runExpectFail(['DEGRADED', 'network-down'], 'invalid reason');
});

test('READY/BLOCKED/NEEDS_HUMAN/SKIPPED reject extra argument', () => {
  for (const gate of ['READY', 'BLOCKED', 'NEEDS_HUMAN', 'SKIPPED']) {
    runExpectFail([gate, 'extra'], 'takes no extra argument');
  }
});

test('exits non-zero with no arguments', () => {
  runExpectFail([], 'Usage:');
});

test('exits non-zero with three arguments', () => {
  runExpectFail(['PENDING', 'standard', 'extra'], 'Usage:');
});

test('exits non-zero with invalid gate value', () => {
  runExpectFail(['INVALID'], 'invalid gate value');
});

test('rejects lowercase gate variants', () => {
  for (const val of ['pending', 'ready', 'degraded', 'skipped']) {
    runExpectFail([val], 'invalid gate value');
  }
});
