'use strict';

// Both installer entry points must invoke the § 3.6 migration (hook-lightweighting):
// the unsafe order — copy new scripts while old enforcement hooks stay registered —
// is only prevented if NEITHER skill can be followed without running it first.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const INSTALLERS = ['skills/install-hooks/SKILL.md', 'skills/install-scripts/SKILL.md'];

test('both installers run the migration as Phase 0, before any copy or merge', () => {
  for (const file of INSTALLERS) {
    const content = read(file);
    assert.match(content, /Phase 0: Resolve mode; obsolete-set migration \(first for non-list invocations; --dry-run forwarded\)/,
      `${file}: migration must be the first phase, gated behind mode resolution`);
    assert.match(content, /migrate-hook-lightweighting\.js/,
      `${file}: must invoke the shared migration script`);
    assert.match(content, /On exit 1, \*{0,2}stop the install/,
      `${file}: a failed deregistration must halt the install, not degrade it`);
    assert.match(content, /allowed-tools:.*Bash\(node:\*\)/,
      `${file}: needs the node permission to invoke the migration`);
  }
});

test('install-hooks names the deregister-before-delete ordering it relies on', () => {
  const content = read('skills/install-hooks/SKILL.md');
  assert.match(content, /deregisters settings entries first and deletes files only\s*after the settings writes succeed/,
    'the ordering is the contract — the skill must state it, not assume it');
});

test('installer docs no longer inventory the deleted enforcement files', () => {
  for (const file of INSTALLERS) {
    const content = read(file);
    for (const gone of ['dispatch-cli.js', 'lib/dispatch-log.js', 'lib/gate-derive.js', 'lib/receipt-log.js']) {
      const mentions = content.split(gone).length - 1;
      assert.equal(mentions, 0,
        `${file}: must not inventory deleted file ${gone} (the migration owns its cleanup)`);
    }
  }
});

test('install-hooks describes the checker as the whole dependency surface', () => {
  const content = read('skills/install-hooks/SKILL.md');
  assert.match(content, /review-state\.js/, 'the checker must be named');
  assert.match(content, /claims no\s+verdict/, 'checker-absent degradation must be stated: facts, no verdict');
  assert.match(content, /reminders, hook-lightweighting/, 'the reminder posture must be cited');
});
