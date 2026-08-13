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

test('both precommit skills include the manifest gate and 3-level fallback', () => {
  for (const [name, content] of [['precommit-fast', precommitFast], ['precommit', precommitFull]]) {
    assert.ok(
      content.includes('package.json'),
      `${name}/SKILL.md should reference package.json in the manifest gate`
    );
  }
  // WB2b: the gate admits every ecosystem the runner orchestrates, not Node alone.
  assert.ok(
    precommitFast.includes('Manifest gate'),
    'precommit-fast auto-install should gate on any known manifest (WB2b), not package.json alone'
  );
  assert.ok(
    precommitFast.includes('pyproject.toml') && precommitFast.includes('Cargo.toml'),
    'the manifest gate should enumerate non-Node manifests'
  );
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

// The full eight-file contract — pinned against the Phase 6.5 REGIONS, not the
// whole document, so removing a file from the actual copy table cannot stay
// green off an incidental mention elsewhere (WB5a round-2 P2). The three
// regions each carry the whole set: copy table, report table, and checklist.
const PHASE_65_SCRIPTS = [
  'precommit-runner.js',
  'verify-runner.js',
  'review-state.js',
  'lib/utils.js',
  'lib/tree-digest.js',
];

test('project-setup Phase 6.5 installs all 5 scripts (copy table, report, checklist)', () => {
  const phase65Start = skillMd.indexOf('## Phase 6.5');
  const phase7Start = skillMd.indexOf('## Phase 7');
  assert.ok(phase65Start !== -1 && phase7Start > phase65Start, 'Phase 6.5 and Phase 7 sections must exist in order');
  const phase65 = skillMd.slice(phase65Start, phase7Start);

  const copyStart = phase65.indexOf('### 6.5.2');
  const copyEnd = phase65.indexOf('### 6.5.3');
  assert.ok(copyStart !== -1 && copyEnd > copyStart, '6.5.2 copy section must exist');
  const copyTable = phase65.slice(copyStart, copyEnd);
  assert.ok(copyTable.includes('Copy 5 scripts'), '6.5.2 must state the 5-script count');

  // The copy table's FIRST column, as an exact set — `includes()` over the whole
  // section is satisfiable from another row's dependency cell, so a deleted copy
  // row could stay green off the name surviving elsewhere (round-3 P2). Exact-set
  // comparison also rejects duplicate and extra rows.
  const copyRowScripts = copyTable
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) => l.split('|')[1].trim())
    .filter((cell) => /^`[^`]+`$/.test(cell))
    .map((cell) => cell.slice(1, -1));
  assert.deepEqual(
    [...copyRowScripts].sort(),
    [...PHASE_65_SCRIPTS].sort(),
    '6.5.2 copy table first column must be exactly the 5-script set'
  );

  const reportStart = phase65.indexOf('### 6.5.4');
  assert.ok(reportStart !== -1, '6.5.4 report section must exist');
  const reportTable = phase65.slice(reportStart);

  const checklist = skillMd.slice(phase7Start);
  const checklistLine = checklist.split('\n').find((l) => l.includes('`.claude/scripts/` contains'));
  assert.ok(checklistLine, 'Phase 7 checklist must carry the scripts line');

  for (const script of PHASE_65_SCRIPTS) {
    assert.ok(reportTable.includes(`| ${script} |`), `6.5.4 report table must list ${script}`);
    assert.ok(checklistLine.includes(`\`${script}\``), `Phase 7 checklist must list ${script}`);
  }
});

test('precommit-fast auto-install copies the self-note checker pair alongside the runner', () => {
  // Retirement pin included: the receipt/dispatch libraries are deleted
  // (hook-lightweighting § 3.3) — the runner's only remaining dependency pair is
  // review-state.js + lib/tree-digest.js, its self-note channel.
  const step1Fast = precommitFast.slice(0, precommitFast.indexOf('### Step 2'));
  assert.ok(
    step1Fast.includes('review-state.js'),
    'precommit-fast Step 1 copy list should include review-state.js'
  );
  assert.ok(
    step1Fast.includes('lib/tree-digest.js'),
    'precommit-fast Step 1 copy list should include lib/tree-digest.js'
  );
  assert.ok(
    !step1Fast.includes('lib/receipt-log.js'),
    'the deleted receipt-log library must not be in the copy list'
  );
});

test('claude-health managed inventory matches the post-lightweighting script set', () => {
  const claudeHealth = readFileSync(resolve(ROOT, 'skills/claude-health/SKILL.md'), 'utf8');
  const scriptsRow = claudeHealth
    .split('\n')
    .find(l => l.startsWith('| Scripts |'));
  assert.ok(scriptsRow, 'claude-health should have a Scripts inventory row');
  assert.ok(
    scriptsRow.includes('review-state.js') && scriptsRow.includes('lib/tree-digest.js'),
    'Scripts inventory row should list the checker pair the local hooks read'
  );
  assert.ok(
    !scriptsRow.includes('dispatch-cli.js') && !scriptsRow.includes('lib/dispatch-log.js')
      && !scriptsRow.includes('lib/gate-derive.js') && !scriptsRow.includes('lib/receipt-log.js'),
    'the deleted dispatch/derivation/receipt set must not be inventoried (hook-lightweighting § 3.3)'
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
