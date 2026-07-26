'use strict';

// Regression guard for the npm test glob gap: npm runs scripts via /bin/sh,
// where globstar is off, so the old `test/**/*.test.js` silently collapsed to
// two path levels — 23 nested files (538 tests) never ran in CI or precommit.
// These tests reproduce the exact sh expansion npm performs and pin that the
// aggregate scripts cover every *.test.js on disk.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function allTestFilesOnDisk() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.test.js')) out.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'test'));
  return out.sort();
}

// Reproduce npm's script execution shell (/bin/sh) to expand the argument
// list exactly as `npm run` would before node sees it.
function shExpandedFiles(scriptName) {
  const script = pkg.scripts[scriptName];
  assert.ok(script, `package.json script "${scriptName}" missing`);
  assert.ok(
    script.startsWith('node --test '),
    `script "${scriptName}" changed shape; update this guard: ${script}`
  );
  const args = script.slice('node --test '.length);
  const out = execFileSync('/bin/sh', ['-c', `printf '%s\\n' ${args}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean).sort();
}

test('npm test expansion under /bin/sh → covers every *.test.js under test/', () => {
  const onDisk = allTestFilesOnDisk();
  const expanded = shExpandedFiles('test');
  assert.deepEqual(expanded, onDisk);
});

test('npm run test:ci expansion under /bin/sh → covers every *.test.js under test/', () => {
  const onDisk = allTestFilesOnDisk();
  const expanded = shExpandedFiles('test:ci');
  assert.deepEqual(expanded, onDisk);
});

test('unit+integration+hooks+schema partition → union equals full suite', () => {
  const onDisk = allTestFilesOnDisk();
  const union = new Set([
    ...shExpandedFiles('test:unit'),
    ...shExpandedFiles('test:integration'),
    ...shExpandedFiles('test:hooks'),
    ...shExpandedFiles('test:schema'),
  ]);
  assert.deepEqual([...union].sort(), onDisk);
});

test('test:fast expansion → equals union of test:unit and test:schema', () => {
  const fast = shExpandedFiles('test:fast');
  const union = new Set([...shExpandedFiles('test:unit'), ...shExpandedFiles('test:schema')]);
  assert.deepEqual(fast, [...union].sort());
});

test('expanded script args → every path exists on disk (no literal glob leftovers)', () => {
  for (const name of ['test', 'test:ci', 'test:fast', 'test:schema']) {
    for (const f of shExpandedFiles(name)) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), `${name}: stale or unexpanded arg: ${f}`);
    }
  }
});
