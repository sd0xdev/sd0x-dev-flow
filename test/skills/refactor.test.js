const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/refactor/SKILL.md');
const refCatalog = resolve(root, 'skills/refactor/references/refactor-catalog.md');
const refDetection = resolve(root, 'skills/refactor/references/target-detection.md');
const refGate = resolve(root, 'skills/refactor/references/behavioral-gate.md');
const refOutput = resolve(root, 'skills/refactor/references/output-template.md');

// --- File Existence ---

test('refactor all files exist', () => {
  const files = [skillPath, refCatalog, refDetection, refGate, refOutput];
  for (const f of files) {
    assert.ok(existsSync(f), `${f} should exist`);
  }
});

// --- SKILL.md Frontmatter ---

test('SKILL.md has correct frontmatter', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /^---\n/, 'should start with frontmatter');
  assert.match(content, /name:\s*refactor/, 'should have name: refactor');
  assert.match(content, /description:/, 'should have description');
  assert.match(content, /allowed-tools:.*Skill/, 'should include Skill in allowed-tools');
});

// --- SKILL.md Structure ---

test('SKILL.md has Trigger section', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /## Trigger/i, 'should have Trigger section');
});

test('SKILL.md has When NOT to Use section', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /When NOT to Use/i, 'should have When NOT to Use');
  assert.match(content, /feature-dev/, 'should mention feature-dev alternative');
  assert.match(content, /bug-fix/, 'should mention bug-fix alternative');
});

test('SKILL.md has Prohibited Actions', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /git add.*git commit.*git push/i, 'should prohibit git operations');
});

test('SKILL.md has Phase 0, Phase 2, Phase 3', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Phase 0/i, 'should have Phase 0');
  assert.match(content, /Phase 2/i, 'should have Phase 2');
  assert.match(content, /Phase 3/i, 'should have Phase 3');
});


// --- Target Detection ---

test('target-detection.md maps .js/.ts to code type', () => {
  const content = readFileSync(refDetection, 'utf8');
  assert.match(content, /\.js.*\.ts.*code/is, 'should map .js/.ts to code');
});

test('target-detection.md maps .md to doc type', () => {
  const content = readFileSync(refDetection, 'utf8');
  assert.match(content, /\.md.*doc/is, 'should map .md to doc type');
});

test('target-detection.md classifies v2 types as not dispatched', () => {
  const content = readFileSync(refDetection, 'utf8');
  assert.match(content, /\.json/, 'should mention .json extension');
  assert.match(content, /\.yaml/, 'should mention .yaml extension');
  assert.match(content, /\.sh/, 'should mention .sh extension');
  assert.match(content, /v2/i, 'should mark as v2');
});

test('target-detection.md defines AI artifact heuristic with 3+ matches threshold', () => {
  const content = readFileSync(refDetection, 'utf8');
  assert.match(content, /3\+ matches/, 'should define 3+ matches threshold');
});

// --- Behavioral Gate ---

test('behavioral-gate.md defines PRESERVED sentinel', () => {
  const content = readFileSync(refGate, 'utf8');
  assert.match(content, /PRESERVED/, 'should define PRESERVED sentinel');
});

test('behavioral-gate.md defines BEHAVIOR_CHANGED sentinel', () => {
  const content = readFileSync(refGate, 'utf8');
  assert.match(content, /BEHAVIOR_CHANGED/, 'should define BEHAVIOR_CHANGED sentinel');
});

test('behavioral-gate.md defines BASELINE_FAILING with skip rule for code', () => {
  const content = readFileSync(refGate, 'utf8');
  assert.match(content, /BASELINE_FAILING/, 'should define BASELINE_FAILING sentinel');
  assert.match(content, /skip.*target/is, 'should specify skip behavior for code');
});

test('behavioral-gate.md defines NO_TESTS sentinel', () => {
  const content = readFileSync(refGate, 'utf8');
  assert.match(content, /NO_TESTS/, 'should define NO_TESTS sentinel');
  assert.match(content, /all.*skip/is, 'should define detection condition');
});

// --- Dispatch Mapping ---

test('SKILL.md dispatches code targets to /simplify', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /\/simplify/, 'should dispatch code to /simplify');
});

test('SKILL.md dispatches doc targets to /doc-refactor or /de-ai-flavor', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /\/doc-refactor/, 'should dispatch to /doc-refactor');
  assert.match(content, /\/de-ai-flavor/, 'should dispatch to /de-ai-flavor');
});

test('SKILL.md doc targets bypass /verify', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /doc.*bypass.*behavioral.*gate/is, 'should state docs bypass behavioral gate');
});

// --- Refactor Catalog ---

test('refactor-catalog.md contains R01 through R09', () => {
  const content = readFileSync(refCatalog, 'utf8');
  for (let i = 1; i <= 9; i++) {
    const id = `R0${i}`;
    assert.match(content, new RegExp(id), `should contain ${id}`);
  }
});

test('refactor-catalog.md defines safety tiers', () => {
  const content = readFileSync(refCatalog, 'utf8');
  assert.match(content, /safe/, 'should define safe tier');
  assert.match(content, /side-effect/, 'should define side-effect tier');
  assert.match(content, /destructive/, 'should define destructive tier');
});

test('refactor-catalog.md has dispatch skill column', () => {
  const content = readFileSync(refCatalog, 'utf8');
  assert.match(content, /Dispatch Skill/i, 'should have Dispatch Skill column');
});

// --- Path Validation ---

test('target-detection.md rejects absolute paths', () => {
  const content = readFileSync(refDetection, 'utf8');
  assert.match(content, /absolute.*path/is, 'should mention absolute path rejection');
});

test('target-detection.md rejects .. traversal', () => {
  const content = readFileSync(refDetection, 'utf8');
  assert.match(content, /\.\./, 'should mention .. traversal rejection');
});

// --- Loop Mechanics ---

test('SKILL.md contains REFACTOR_SKIPPED log format', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /\[REFACTOR_SKIPPED\]/, 'should contain [REFACTOR_SKIPPED]');
});

test('SKILL.md contains REFACTOR_BLOCKED log format', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /\[REFACTOR_BLOCKED\]/, 'should contain [REFACTOR_BLOCKED]');
});

test('SKILL.md defines max-targets budget default of 10', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /max-targets/, 'should mention max-targets');
  assert.match(content, /10/, 'should have default value 10');
});

// --- Output Template ---

test('output-template.md has per-target result table format', () => {
  const content = readFileSync(refOutput, 'utf8');
  assert.match(content, /Target.*Type.*Result/is, 'should have result table columns');
});

test('output-template.md has delta report format', () => {
  const content = readFileSync(refOutput, 'utf8');
  assert.match(content, /Delta Report/i, 'should have delta report section');
});

// --- Reference-Stability Mode (review-loop-recovery) ---
// docs/features/review-loop-recovery/2-tech-spec.md § 3.3 — the mode's load-bearing bounds.

test('reference-stability mode is declared with its flag and section', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /`--mode reference-stability`/, 'flag row must exist');
  assert.match(content, /### Reference-Stability Targets/, 'contract section must exist');
});

test('reference-stability mode carries the 5-file bound and the --auto prohibition', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /At most \*\*5\*\* explicitly enumerated files/,
    'the file bound is the blast-radius unit');
  assert.match(content, /\*\*never `--auto`\*\*/, 'auto-detection is forbidden in this mode');
  assert.match(content, /pointer count is measured and reported before editing, not capped/,
    'pointers are observability, files are the cap');
});

test('reference-stability mode keeps the exemptions and the outer gate', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Point-in-time records \(requests, ADRs, review logs\), review evidence/,
    'record-class content keeps exact file:line');
  assert.match(content, /\*\*never\*\* the outer terminal verdict/,
    'internal checks are evidence; the outer gate is still owed');
  assert.match(content, /no mutating git operation and creates no checkpoint\/stash/,
    'the mode must not mutate git state');
});
