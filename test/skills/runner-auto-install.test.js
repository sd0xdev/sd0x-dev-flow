const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '../..');
const precommitFast = readFileSync(resolve(ROOT, 'skills/precommit-fast/SKILL.md'), 'utf8');
const precommitFull = readFileSync(resolve(ROOT, 'skills/precommit/SKILL.md'), 'utf8');
const skillMd = readFileSync(resolve(ROOT, 'skills/project-setup/SKILL.md'), 'utf8');

test('precommit-fast/SKILL.md contains auto-install logic', () => {
  assert.ok(
    precommitFast.includes('Auto-install attempt'),
    'precommit-fast/SKILL.md should contain "Auto-install attempt"'
  );
});

test('precommit/SKILL.md contains auto-install logic', () => {
  assert.ok(
    precommitFull.includes('Auto-install attempt'),
    'precommit/SKILL.md should contain "Auto-install attempt"'
  );
});

test('both precommit skills include Node.js gate and 3-level fallback', () => {
  for (const [name, content] of [['precommit-fast', precommitFast], ['precommit', precommitFull]]) {
    assert.ok(
      content.includes('package.json'),
      `${name}/SKILL.md should reference package.json gate`
    );
  }
  // 3-level fallback details are in precommit-fast; precommit references it
  assert.ok(
    precommitFast.includes('sd0x-dev-flow/scripts/precommit-runner.js'),
    'precommit-fast/SKILL.md should include 3-level fallback glob pattern'
  );
  assert.ok(
    precommitFast.includes('Plugin-relative'),
    'precommit-fast/SKILL.md should include plugin-relative fallback'
  );
});

test('precommit-fast/SKILL.md includes conflict handling (skip on conflict)', () => {
  assert.ok(
    precommitFast.includes('skip on conflict'),
    'precommit-fast/SKILL.md should describe skip on conflict handling'
  );
});

test('precommit auto-install does not install verify-runner', () => {
  const step1Fast = precommitFast.slice(0, precommitFast.indexOf('### Step 2'));
  assert.ok(
    !step1Fast.includes('verify-runner'),
    'precommit-fast/SKILL.md Step 1 should not reference verify-runner'
  );
});

test('project-setup SKILL.md contains Phase 6.5', () => {
  assert.ok(
    skillMd.includes('Phase 6.5'),
    'SKILL.md should contain "Phase 6.5"'
  );
  assert.ok(
    skillMd.includes('Install Scripts'),
    'SKILL.md should contain "Install Scripts"'
  );
});

test('project-setup Phase 6.5 installs 5 scripts', () => {
  assert.ok(
    skillMd.includes('precommit-runner.js'),
    'SKILL.md should reference precommit-runner.js'
  );
  assert.ok(
    skillMd.includes('verify-runner.js'),
    'SKILL.md should reference verify-runner.js'
  );
  assert.ok(
    skillMd.includes('lib/utils.js'),
    'SKILL.md should reference lib/utils.js'
  );
  assert.ok(
    skillMd.includes('lib/tree-digest.js'),
    'SKILL.md should reference lib/tree-digest.js (receipt producer dependency)'
  );
  assert.ok(
    skillMd.includes('lib/receipt-log.js'),
    'SKILL.md should reference lib/receipt-log.js (receipt producer dependency)'
  );
});

test('precommit-fast auto-install copies both receipt libs alongside the runner', () => {
  const step1Fast = precommitFast.slice(0, precommitFast.indexOf('### Step 2'));
  assert.ok(
    step1Fast.includes('lib/tree-digest.js'),
    'precommit-fast Step 1 copy list should include lib/tree-digest.js'
  );
  assert.ok(
    step1Fast.includes('lib/receipt-log.js'),
    'precommit-fast Step 1 copy list should include lib/receipt-log.js'
  );
});

test('claude-health managed inventory lists both receipt libs', () => {
  const claudeHealth = readFileSync(resolve(ROOT, 'skills/claude-health/SKILL.md'), 'utf8');
  const scriptsRow = claudeHealth
    .split('\n')
    .find(l => l.startsWith('| Scripts |'));
  assert.ok(scriptsRow, 'claude-health should have a Scripts inventory row');
  assert.ok(
    scriptsRow.includes('lib/tree-digest.js') && scriptsRow.includes('lib/receipt-log.js'),
    'Scripts inventory row should list lib/tree-digest.js and lib/receipt-log.js'
  );
});

test('project-setup Phase 6.5 updates manifest', () => {
  const phase65Start = skillMd.indexOf('## Phase 6.5');
  const phase7Start = skillMd.indexOf('## Phase 7');
  const phase65Section = skillMd.slice(phase65Start, phase7Start);
  assert.ok(
    phase65Section.includes('.sd0x/install-state.json'),
    'Phase 6.5 should reference canonical manifest path .sd0x/install-state.json'
  );
});

test('project-setup Phase 7 includes Scripts status row', () => {
  const phase7Start = skillMd.indexOf('## Phase 7');
  const phase7Section = skillMd.slice(phase7Start);
  assert.ok(
    phase7Section.includes('| Scripts |'),
    'Phase 7 report should include Scripts row'
  );
});
