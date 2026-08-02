const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const { classifyByPath, classifyByHeading, scanFeatureDocs, pickCanonicalDocs, loadTaxonomy } = require('../../scripts/lib/doc-classifier');

const taxonomy = loadTaxonomy();
const tempDirs = [];

function createTempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-dc-'));
  tempDirs.push(dir);
  return dir;
}

function setupDocDir(root, files) {
  mkdirSync(root, { recursive: true });
  for (const f of files) {
    const fp = join(root, f);
    mkdirSync(join(fp, '..'), { recursive: true });
    writeFileSync(fp, `# ${f}\n`);
  }
  return root;
}

after(() => {
  for (const d of tempDirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

// --- classifyByPath: lifecycle canonical ---

test('classifyByPath 2-tech-spec.md → tech-spec canonical', () => {
  const r = classifyByPath('2-tech-spec.md', taxonomy);
  assert.equal(r.type, 'tech-spec');
  assert.equal(r.namespace, 'lifecycle');
  assert.equal(r.confidence, 'high');
  assert.equal(r.is_canonical, true);
});

test('classifyByPath 0-feasibility-study.md → feasibility canonical', () => {
  const r = classifyByPath('0-feasibility-study.md', taxonomy);
  assert.equal(r.type, 'feasibility');
  assert.equal(r.is_canonical, true);
});

test('classifyByPath 3-architecture.md → architecture canonical', () => {
  const r = classifyByPath('3-architecture.md', taxonomy);
  assert.equal(r.type, 'architecture');
  assert.equal(r.is_canonical, true);
});

test('classifyByPath 1-requirements.md → requirements canonical', () => {
  const r = classifyByPath('1-requirements.md', taxonomy);
  assert.equal(r.type, 'requirements');
  assert.equal(r.is_canonical, true);
});

// --- classifyByPath: derived artifact exclusion ---

test('classifyByPath 2-tech-spec-fp-brief.md → fp-brief (not tech-spec)', () => {
  const r = classifyByPath('2-tech-spec-fp-brief.md', taxonomy);
  assert.equal(r.type, 'fp-brief');
  assert.notEqual(r.type, 'tech-spec');
});

// --- classifyByPath: ancillary semantic ---

test('classifyByPath checklist-cross-service.md → checklist', () => {
  const r = classifyByPath('checklist-cross-service.md', taxonomy);
  assert.equal(r.type, 'checklist');
  assert.equal(r.namespace, 'ancillary');
});

test('classifyByPath runbook-deploy.md → runbook', () => {
  const r = classifyByPath('runbook-deploy.md', taxonomy);
  assert.equal(r.type, 'runbook');
  assert.equal(r.namespace, 'ancillary');
});

test('classifyByPath runbook-release.md → runbook (ancillary)', () => {
  const r = classifyByPath('runbook-release.md', taxonomy);
  assert.equal(r.type, 'runbook');
  assert.equal(r.namespace, 'ancillary');
});

test('classifyByPath review-log-stacked-pr-mode-r2.md → review-log (ancillary)', () => {
  const r = classifyByPath('review-log-stacked-pr-mode-r2.md', taxonomy);
  assert.equal(r.type, 'review-log');
  assert.equal(r.namespace, 'ancillary');
});

// The prefix is anchored: a review log is a feature-level ancillary document, and a file that
// merely mentions the words is not one. The filename here is deliberately NEUTRAL — an earlier
// version used `2-tech-spec-review-log-notes.md`, which stays green even with the `^` removed
// because `^2-tech-spec` claims it first. A control that passes for a reason other than the one
// it names does not test the thing it appears to test.
test('classifyByPath notes-review-log-stuff.md → not review-log (the ^ anchor is load-bearing)', () => {
  const r = classifyByPath('notes-review-log-stuff.md', taxonomy);
  assert.notEqual(r.type, 'review-log');
});

// Ordering matters: several ancillary patterns match a bare keyword anywhere in the filename
// (`checklist`, `runbook`, `decision`, `-tech-brief.md$`), so a review log whose TOPIC contains
// one of those words is claimed by the earlier entry unless `review-log` precedes them all.
for (const [file, topic] of [
  ['review-log-checklist.md', 'checklist'],
  ['review-log-runbook.md', 'runbook'],
  ['review-log-decision.md', 'adr'],
  ['review-log-release-tech-brief.md', 'tech-brief'],
]) {
  test(`classifyByPath ${file} → review-log, not ${topic}`, () => {
    const r = classifyByPath(file, taxonomy);
    assert.equal(r.type, 'review-log');
  });
}

// …and the entries it now precedes must still win on their own filenames.
for (const [file, expected] of [
  ['checklist-deploy.md', 'checklist'],
  ['runbook-release.md', 'runbook'],
  ['adr-0001-kafka.md', 'adr'],
  ['2-tech-spec-tech-brief.md', 'tech-brief'],
]) {
  test(`classifyByPath ${file} → ${expected} (unchanged by the review-log insertion)`, () => {
    assert.equal(classifyByPath(file, taxonomy).type, expected);
  });
}

test('classifyByPath adr-kafka-auth.md → adr', () => {
  const r = classifyByPath('adr-kafka-auth.md', taxonomy);
  assert.equal(r.type, 'adr');
  assert.equal(r.namespace, 'ancillary');
});

test('classifyByPath handoff-team-b.md → handoff', () => {
  const r = classifyByPath('handoff-team-b.md', taxonomy);
  assert.equal(r.type, 'handoff');
});

test('classifyByPath 5-tech-brief.md → tech-brief', () => {
  const r = classifyByPath('5-tech-brief.md', taxonomy);
  assert.equal(r.type, 'tech-brief');
  assert.equal(r.namespace, 'ancillary');
});

test('classifyByPath 2-tech-spec-tech-brief.md → tech-brief (not tech-spec)', () => {
  const r = classifyByPath('2-tech-spec-tech-brief.md', taxonomy);
  assert.equal(r.type, 'tech-brief');
});

// --- classifyByPath: lifecycle prefix fallback ---

test('classifyByPath 3-auto-loop-integration.md → architecture variant via prefix fallback', () => {
  const r = classifyByPath('3-auto-loop-integration.md', taxonomy);
  assert.equal(r.type, 'architecture');
  assert.equal(r.namespace, 'lifecycle');
  assert.equal(r.is_canonical, false);
  assert.equal(r.confidence, 'medium');
});

test('classifyByPath 3-customize-v2.md → architecture variant via prefix fallback', () => {
  const r = classifyByPath('3-customize-v2.md', taxonomy);
  assert.equal(r.type, 'architecture');
  assert.equal(r.is_canonical, false);
});

test('classifyByPath 0-feasibility-study-quota-display.md → feasibility variant', () => {
  const r = classifyByPath('0-feasibility-study-quota-display.md', taxonomy);
  assert.equal(r.type, 'feasibility');
  assert.equal(r.is_canonical, false);
});

// --- classifyByPath: fallback ---

test('classifyByPath unknown-doc.md → appendix fallback', () => {
  const r = classifyByPath('unknown-doc.md', taxonomy);
  assert.equal(r.type, 'appendix');
  assert.equal(r.confidence, 'low');
  assert.equal(r.is_canonical, false);
});

test('classifyByPath README.md → appendix fallback', () => {
  const r = classifyByPath('README.md', taxonomy);
  assert.equal(r.type, 'appendix');
});

// --- classifyByHeading ---

test('classifyByHeading detects heading signal', () => {
  const root = createTempRoot();
  const fp = join(root, 'test.md');
  writeFileSync(fp, '# Technical Spec\n\nSome content\n');
  const r = classifyByHeading(fp, taxonomy);
  assert.notEqual(r, null);
  assert.equal(r.type, 'tech-spec');
});

test('classifyByHeading returns null for no signals', () => {
  const root = createTempRoot();
  const fp = join(root, 'test.md');
  writeFileSync(fp, '# Random Title\n\nNo signals here\n');
  const r = classifyByHeading(fp, taxonomy);
  assert.equal(r, null);
});

// --- scanFeatureDocs: mixed directory ---

test('scanFeatureDocs mixed lifecycle + ancillary + requests', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, [
    '2-tech-spec.md',
    '3-architecture.md',
    'checklist-cross-service.md',
  ]);
  mkdirSync(join(featureDir, 'requests'), { recursive: true });

  const { doc_inventory, canonical_docs } = scanFeatureDocs(featureDir, taxonomy);
  assert.equal(doc_inventory.length, 3);

  const types = doc_inventory.map(i => i.type);
  assert.ok(types.includes('tech-spec'));
  assert.ok(types.includes('architecture'));
  assert.ok(types.includes('checklist'));

  assert.notEqual(canonical_docs.tech_spec, null);
  assert.equal(canonical_docs.tech_spec.file, '2-tech-spec.md');
});

// --- scanFeatureDocs: folder-backed phase ---

test('scanFeatureDocs folder-backed 0-feasibility-study/', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, [
    '2-tech-spec.md',
    '0-feasibility-study/0-feasibility-study.md',
    '0-feasibility-study/1-state-persistence.md',
    '0-feasibility-study/2-review-intelligence.md',
  ]);

  const { doc_inventory, canonical_docs } = scanFeatureDocs(featureDir, taxonomy);

  const feasibilityDocs = doc_inventory.filter(i => i.type === 'feasibility');
  assert.ok(feasibilityDocs.length >= 2, `Expected >=2 feasibility docs, got ${feasibilityDocs.length}`);

  const canonical = feasibilityDocs.find(i => i.is_canonical);
  assert.ok(canonical, 'Should have a canonical feasibility doc');

  assert.notEqual(canonical_docs.feasibility, null);
});

// --- scanFeatureDocs: skip symlinks and non-.md ---

test('scanFeatureDocs skips non-.md files and symlinks', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md']);
  writeFileSync(join(featureDir, 'notes.txt'), 'not a markdown file');
  writeFileSync(join(featureDir, 'data.json'), '{}');

  try { symlinkSync(join(featureDir, '2-tech-spec.md'), join(featureDir, 'link.md')); } catch { /* symlink may fail on some OS */ }

  const { doc_inventory } = scanFeatureDocs(featureDir, taxonomy);
  const files = doc_inventory.map(i => i.file);
  assert.ok(!files.includes('notes.txt'));
  assert.ok(!files.includes('data.json'));
});

// --- scanFeatureDocs: skip requests/ ---

test('scanFeatureDocs skips requests/ directory', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, [
    '2-tech-spec.md',
    'requests/2026-01-01-test.md',
  ]);

  const { doc_inventory } = scanFeatureDocs(featureDir, taxonomy);
  const files = doc_inventory.map(i => i.file);
  assert.ok(!files.some(f => f.includes('requests/')));
});

// --- scanFeatureDocs: empty dir ---

test('scanFeatureDocs returns empty for non-existent dir', () => {
  const { doc_inventory, canonical_docs } = scanFeatureDocs('/nonexistent/path', taxonomy);
  assert.equal(doc_inventory.length, 0);
  assert.equal(canonical_docs.tech_spec, null);
});

// --- pickCanonicalDocs ---

test('pickCanonicalDocs prefers is_canonical=true over variant', () => {
  const inventory = [
    { file: '2-tech-spec-v2.md', type: 'tech-spec', namespace: 'lifecycle', confidence: 'medium', is_canonical: false },
    { file: '2-tech-spec.md', type: 'tech-spec', namespace: 'lifecycle', confidence: 'high', is_canonical: true },
  ];
  const result = pickCanonicalDocs(inventory, taxonomy.canonical_roles);
  assert.equal(result.tech_spec.file, '2-tech-spec.md');
});

test('pickCanonicalDocs returns null when no match', () => {
  const inventory = [
    { file: 'checklist-test.md', type: 'checklist', namespace: 'ancillary', confidence: 'high', is_canonical: false },
  ];
  const result = pickCanonicalDocs(inventory, taxonomy.canonical_roles);
  assert.equal(result.tech_spec, null);
  assert.equal(result.architecture, null);
});

test('pickCanonicalDocs uses confidence as tiebreaker', () => {
  const inventory = [
    { file: '2-tech-spec-alt.md', type: 'tech-spec', namespace: 'lifecycle', confidence: 'low', is_canonical: false },
    { file: '2-tech-spec-v2.md', type: 'tech-spec', namespace: 'lifecycle', confidence: 'medium', is_canonical: false },
  ];
  const result = pickCanonicalDocs(inventory, taxonomy.canonical_roles);
  assert.equal(result.tech_spec.file, '2-tech-spec-v2.md');
});

// --- scanFeatureDocs: override ---

test('scanFeatureDocs respects overrides', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, ['custom-doc.md']);

  const { doc_inventory } = scanFeatureDocs(featureDir, taxonomy, {
    overrides: { 'custom-doc.md': 'checklist' }
  });
  assert.equal(doc_inventory[0].type, 'checklist');
  assert.equal(doc_inventory[0].confidence, 'high');
});
