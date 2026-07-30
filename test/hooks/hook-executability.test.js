'use strict';

// Regression guard (R5): an awk `> tmp && mv` splice dropped the executable bit
// on four migrated hooks. hooks.json invokes hook files directly (no `bash`
// prefix), so a non-executable hook fails with exit 126 and silently disables
// session init / edit tracking / review state / the stop gate.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const HOOKS_DIR = path.join(ROOT, 'hooks');

test('every hooks/*.sh is executable (owner+group+other x bits)', () => {
  const nonExec = fs
    .readdirSync(HOOKS_DIR)
    .filter((f) => f.endsWith('.sh'))
    .filter((f) => (fs.statSync(path.join(HOOKS_DIR, f)).mode & 0o111) !== 0o111);
  assert.deepEqual(nonExec, [], `hooks lost their exec bits: ${nonExec.join(', ')}`);
});

test('every hook command referenced in hooks.json resolves to an executable file', () => {
  const config = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf8'));
  const commands = JSON.stringify(config).match(/[^"\s]*hooks\/[\w-]+\.sh/g) || [];
  assert.ok(commands.length > 0, 'hooks.json should reference at least one hook script');
  for (const cmd of new Set(commands)) {
    const rel = cmd.replace(/^\$\{?CLAUDE_PLUGIN_ROOT\}?\//, '');
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), `${rel} referenced by hooks.json does not exist`);
    assert.equal(fs.statSync(abs).mode & 0o111, 0o111, `${rel} is not executable`);
  }
});
