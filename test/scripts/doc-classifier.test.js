const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const { classifyByPath, classifyByHeading, scanFeatureDocs, pickCanonicalDocs, partitionByRole, loadTaxonomy } = require('../../scripts/lib/doc-classifier');

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

  let linked = true;
  try { symlinkSync(join(featureDir, '2-tech-spec.md'), join(featureDir, 'link.md')); } catch { linked = false; }

  const { doc_inventory } = scanFeatureDocs(featureDir, taxonomy);
  const files = doc_inventory.map(i => i.file);
  assert.ok(!files.includes('notes.txt'));
  assert.ok(!files.includes('data.json'));
  // The symlink half of this test's own name; without it the two assertions above only exercise
  // the extension filter. Deleting the scanner's explicit symlink check alone does NOT turn this
  // red — `Dirent.isFile()` is already false for a symlink, so the explicit check is
  // defence-in-depth over that. What this assertion catches is the outcome rather than the
  // mechanism: admitting symlink `Dirent`s by any route puts `link.md` into the inventory.
  if (linked) assert.ok(!files.includes('link.md'), 'a symlinked .md must not be inventoried');
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

// --- Authority-aware source sets -------------------------------------------------------------
//
// Added by r2. The property under test is the SPLIT: `doc_inventory` keeps its old meaning
// (requests excluded) while the source sets cover requests, so the two deliberately disagree on
// exactly one directory. A consumer asking "what does the system do now" must not be able to pick
// up a frozen design record by accident — that is what makes the tombstone mechanical rather than
// a banner a reader skims past.

test('scanFeatureDocs splits documents into the four source sets', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, [
    '2-tech-spec.md',
    '3-architecture.md',
    '4-implementation.md',
    'review-log-rounds.md',
    'adr-0001-lock-ownership.md',
    'briefing-recap-2026-04-17.md',
    'requests/2026-01-01-first.md',
    'requests/archived/2025-12-01-old.md',
  ]);

  const scan = scanFeatureDocs(featureDir, taxonomy);
  const files = (set) => scan[set].map((i) => i.file).sort();

  assert.deepEqual(files('current_authority'), ['4-implementation.md', 'briefing-recap-2026-04-17.md']);
  assert.deepEqual(files('design_records'), ['2-tech-spec.md', '3-architecture.md']);
  assert.deepEqual(files('history_records'), ['adr-0001-lock-ownership.md', 'review-log-rounds.md']);
  // Archiving changes visibility, not what the document is.
  assert.deepEqual(files('work_records'), [
    join('requests', '2026-01-01-first.md'),
    join('requests', 'archived', '2025-12-01-old.md'),
  ]);
});

test('doc_inventory keeps its established meaning — requests stay out of it', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md', 'requests/2026-01-01-first.md']);

  const scan = scanFeatureDocs(featureDir, taxonomy);
  // The one directory the two views disagree on, asserted from both sides so a future change
  // that "unifies" them fails here rather than silently doubling every consumer's doc list.
  assert.deepEqual(scan.doc_inventory.map((i) => i.file), ['2-tech-spec.md']);
  assert.equal(scan.work_records.length, 1);
});

test('every inventory item carries a role, and the sets partition without loss or duplication', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, [
    '2-tech-spec.md',
    '4-implementation.md',
    'review-log-rounds.md',
    'requests/2026-01-01-first.md',
  ]);

  const scan = scanFeatureDocs(featureDir, taxonomy);
  for (const item of scan.doc_inventory) {
    assert.ok(typeof item.role === 'string' && item.role.length > 0, `${item.file} has no role`);
  }

  const inSets = ['current_authority', 'design_records', 'work_records', 'history_records']
    .flatMap((k) => scan[k].map((i) => i.file));
  assert.equal(inSets.length, new Set(inSets).size, 'no document appears in two sets');
  assert.equal(inSets.length, scan.doc_inventory.length + scan.work_records.length,
    'every scanned document lands in exactly one set');
});

test('in-document metadata moves a document between sets, in both directions', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md', '4-implementation.md']);

  // A tech spec that really is the living behaviour reference declares it…
  writeFileSync(join(featureDir, '2-tech-spec.md'),
    '# Spec\n\n> **Doc role**: Current authority\n\n## Body\n');
  // …and a superseded implementation record declares that it no longer is.
  writeFileSync(join(featureDir, '4-implementation.md'),
    '# Impl\n\n> **Doc role**: History record\n\n## Body\n');

  const scan = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(scan.current_authority.map((i) => i.file), ['2-tech-spec.md']);
  assert.deepEqual(scan.history_records.map((i) => i.file), ['4-implementation.md']);
  assert.deepEqual(scan.design_records, []);
});

test('a role line nobody can read costs the document the deepest role, not the path default', () => {
  // The path default for a tech spec is `Design record` — a SHALLOWER obligation than the
  // fallback. Falling through to it would mean an unreadable declaration buys a cheaper review
  // than writing none at all. Each shape below is a separate way of being unreadable.
  const unreadable = [
    ['annotated', '> **Doc role**: Current authority (mostly)'],
    ['unknown value', '> **Doc role**: Frozen record'],
    ['empty value', '> **Doc role**:'],
    ['two different roles', '> **Doc role**: Work record\n> **Doc role**: History record'],
    ['one good line beside one bad', '> **Doc role**: Work record\n> **Doc role**: Frozen record'],
  ];

  for (const [label, block] of unreadable) {
    const featureDir = join(createTempRoot(), 'feature');
    setupDocDir(featureDir, ['2-tech-spec.md']);
    writeFileSync(join(featureDir, '2-tech-spec.md'), `# Spec\n\n${block}\n\n## Body\n`);

    const scan = scanFeatureDocs(featureDir, taxonomy);
    assert.deepEqual(scan.current_authority.map((i) => i.file), ['2-tech-spec.md'], label);
    assert.deepEqual(scan.design_records, [], label);
  }
});

test('an unreadable role line plus authority No does not exempt the document', () => {
  // The dangerous composition: `No` demotes a `Current authority` result to `History record`, so
  // an unreadable role line that first fell through to `Current authority` would then be demoted
  // out of every alignment obligation — a full exemption bought with a typo. `No` withdraws an
  // authority CLAIM, and a garbled role line makes no claim to withdraw.
  const featureDir = join(createTempRoot(), 'feature');
  setupDocDir(featureDir, ['4-implementation.md']);
  writeFileSync(join(featureDir, '4-implementation.md'),
    '# Impl\n\n> **Doc role**: Frozen record\n> **Current behavior authority**: No\n\n## Body\n');

  const scan = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(scan.current_authority.map((i) => i.file), ['4-implementation.md']);
  assert.deepEqual(scan.history_records, []);
});

test('authority No on a document with no role line still demotes — the negative control', () => {
  // Without this the test above would pass if `No` had simply stopped working. `4-implementation`
  // defaults to `Current authority`, and a bare `No` is the documented way to retire one.
  const featureDir = join(createTempRoot(), 'feature');
  setupDocDir(featureDir, ['4-implementation.md']);
  writeFileSync(join(featureDir, '4-implementation.md'),
    '# Impl\n\n> **Current behavior authority**: No\n\n## Body\n');

  const scan = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(scan.history_records.map((i) => i.file), ['4-implementation.md']);
  assert.deepEqual(scan.current_authority, []);
});

test('a readable role declaration is still honoured — the negative control for the fail-closed rule', () => {
  // Delete the `state === 'invalid'` branch in `resolveDocRole` and the three tests above go red
  // while this one stays green; delete the tri-state entirely and this one goes red too. Both
  // directions are needed: a rule that refuses everything is not fail-closed, it is broken.
  const featureDir = join(createTempRoot(), 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md']);
  writeFileSync(join(featureDir, '2-tech-spec.md'),
    '# Spec\n\n> **Doc role**: Work record\n\n## Body\n');

  const scan = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(scan.work_records.map((i) => i.file), ['2-tech-spec.md']);
  assert.deepEqual(scan.design_records, []);
});

test('a UTF-8 BOM does not hide the preamble', () => {
  // A BOM is invisible in every editor and defeats every `^`-anchored match. The failure it caused
  // was in the fail-OPEN direction: a document CLAIMING current authority silently lost the claim.
  const featureDir = join(createTempRoot(), 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md', '3-architecture.md']);
  writeFileSync(join(featureDir, '2-tech-spec.md'),
    '\uFEFF# Spec\n\n> **Current behavior authority**: Yes\n\n## Body\n');
  writeFileSync(join(featureDir, '3-architecture.md'),
    '\uFEFF# Arch\n\n> **Doc role**: Work record\n\n## Body\n');

  const scan = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(scan.current_authority.map((i) => i.file), ['2-tech-spec.md']);
  assert.deepEqual(scan.work_records.map((i) => i.file), ['3-architecture.md']);
  assert.deepEqual(scan.design_records, []);
});

test('canonical_docs is unchanged by the split — the deprecated alias still resolves', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, [
    '2-tech-spec.md',
    '3-architecture.md',
    '0-feasibility-study.md',
    '1-requirements.md',
    'requests/2026-01-01-first.md',
    'review-log-rounds.md',
  ]);

  const { canonical_docs } = scanFeatureDocs(featureDir, taxonomy);
  assert.equal(canonical_docs.tech_spec.file, '2-tech-spec.md');
  assert.equal(canonical_docs.architecture.file, '3-architecture.md');
  assert.equal(canonical_docs.feasibility.file, '0-feasibility-study.md');
  assert.equal(canonical_docs.requirements.file, '1-requirements.md');
});

test('the alias still resolves a canonical doc that declared itself out of both retained sets', () => {
  // The version of this test above passes with the alias computed from
  // `current_authority + design_records`, because every fixture stays in one of them. That made it
  // pass for the wrong reason. A tech spec declaring `History record` — or `Work record` — leaves
  // both sets while remaining inventoried, and an alias selected from those two would report
  // `tech_spec: null` and flip the legacy `has_tech_spec` false on a document that never moved.
  for (const role of ['History record', 'Work record']) {
    const featureDir = join(createTempRoot(), 'feature');
    setupDocDir(featureDir, ['2-tech-spec.md']);
    writeFileSync(join(featureDir, '2-tech-spec.md'), `# Spec\n\n> **Doc role**: ${role}\n\n## Body\n`);

    const scan = scanFeatureDocs(featureDir, taxonomy);
    assert.equal(scan.canonical_docs.tech_spec.file, '2-tech-spec.md', role);
    assert.deepEqual(scan.design_records, [], role);
  }
});

test('a folder-backed lifecycle phase keeps its role on every sub-file', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, [
    '2-tech-spec/2-tech-spec.md',
    '2-tech-spec/1-phase-d-hook-hardening.md',
  ]);

  const scan = scanFeatureDocs(featureDir, taxonomy);
  // Sub-files restart their numbering at 1, so `1-phase-d-*` would read as a phase-1 requirements
  // doc from its basename alone. Both the type override and the role must read the folder.
  assert.equal(scan.design_records.length, 2);
  assert.deepEqual(scan.current_authority, []);
});

test('a scan of a non-existent dir returns every source set present and empty', () => {
  const scan = scanFeatureDocs('/nonexistent/path', taxonomy);
  // Present-and-empty, not absent: a consumer reading `.length` on the early-return path would
  // otherwise throw where the normal path merely returns nothing.
  for (const k of ['current_authority', 'design_records', 'work_records', 'history_records']) {
    assert.deepEqual(scan[k], [], k);
  }
});

test('a caller-supplied taxonomy governs roles, not just types', () => {
  // The taxonomy argument reached type classification but not role resolution, so a consuming
  // repo could configure `doc_roles` and watch it be ignored — the per-repo surface not applying
  // to the thing it configures. Every test passed because they all used the shipped config.
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md']);

  const custom = JSON.parse(JSON.stringify(taxonomy));
  custom.doc_roles = {
    closed_set: ['Current authority', 'Design record', 'Work record', 'History record'],
    fallback: 'Current authority',
    path_defaults: [
      { name: 'specs-are-live-here', role: 'Current authority', scope: 'segment', pattern: '^2-tech-spec' },
    ],
  };

  const scan = scanFeatureDocs(featureDir, custom);
  assert.deepEqual(scan.current_authority.map((i) => i.file), ['2-tech-spec.md']);
  assert.deepEqual(scan.design_records, []);
  // …and the shipped config still says the opposite for the same file, which is what proves the
  // argument was honoured rather than the two configs happening to agree.
  assert.deepEqual(scanFeatureDocs(featureDir, taxonomy).design_records.map((i) => i.file), ['2-tech-spec.md']);
});

test('a document large in bytes is still read, so long as the window is reachable', () => {
  // The read is bounded by lines, with the byte cap only as a runaway backstop. A document whose
  // declaration sits in the preamble but which carries a large body below it must be honoured —
  // otherwise size alone would revoke a declaration, and the biggest documents are exactly the
  // ones whose review cost this feature exists to cut.
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, ['4-implementation.md']);
  writeFileSync(
    join(featureDir, '4-implementation.md'),
    `# Impl\n\n> **Doc role**: History record\n\n${'x'.repeat(600 * 1024)}\n`
  );

  const scan = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(scan.history_records.map((i) => i.file), ['4-implementation.md']);
  assert.deepEqual(scan.current_authority, []);
});

test('metadata past the 30-line window is prose, and the file keeps its path default', () => {
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, ['4-implementation.md']);
  writeFileSync(
    join(featureDir, '4-implementation.md'),
    `# Impl\n${'filler\n'.repeat(40)}> **Doc role**: History record\n`
  );

  const scan = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(scan.current_authority.map((i) => i.file), ['4-implementation.md']);
  assert.deepEqual(scan.history_records, []);
});

test('a head too large to read whole fails closed to Current authority', () => {
  // The pathological shape: a generated single-line artifact whose first 30 lines run past the
  // 1 MB abandon point. An absence of metadata seen through a truncated window is not evidence of
  // absence, so no demotion may be granted on it — even though this file's path says Work record.
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, ['requests/2026-01-01-generated.md']);
  writeFileSync(
    join(featureDir, 'requests', '2026-01-01-generated.md'),
    `# Generated\n\n${'y'.repeat(2 * 1024 * 1024)}\n`
  );

  const scan = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(scan.current_authority.map((i) => i.file), [join('requests', '2026-01-01-generated.md')]);
  assert.deepEqual(scan.work_records, []);
});

// chmod 000 does not block root, and does not mean the same thing on Windows.
const CAN_DENY_READ = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;

test('an unreadable document fails closed to Current authority, not to its path role', { skip: !CAN_DENY_READ }, () => {
  // The path role here is `Design record` — exempt. But the file may declare itself live and we
  // cannot see it, and a demotion granted on what was never read is a guess. Same reasoning as
  // the truncated-head case: an absence seen through an incomplete window is not an absence.
  const root = createTempRoot();
  const featureDir = join(root, 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md']);
  const target = join(featureDir, '2-tech-spec.md');
  // Declares a role that is neither the path default (`Design record`) nor the unreadable
  // fallback (`Current authority`), so the readable and unreadable outcomes are three distinct
  // values. A fixture declaring `Current behavior authority: Yes` reads the same either way and
  // proves nothing about which branch ran.
  writeFileSync(target, '# Spec\n\n> **Doc role**: History record\n');

  let scan;
  try {
    chmodSync(target, 0o000);
    scan = scanFeatureDocs(featureDir, taxonomy);
  } finally {
    // Restore before the assertions, so a failure still leaves the temp tree removable.
    chmodSync(target, 0o644);
  }

  assert.deepEqual(scan.current_authority.map((i) => i.file), ['2-tech-spec.md']);
  assert.deepEqual(scan.design_records, []);

  // Negative control: readable again, the same file resolves by its declaration — a different
  // set from both the unreadable answer above and the path default, which is what proves the
  // case above measured unreadability rather than agreeing with a rule by accident.
  const after = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(after.history_records.map((i) => i.file), ['2-tech-spec.md']);
  assert.deepEqual(after.current_authority, []);
  assert.deepEqual(after.design_records, []);
});

test('partitionByRole sends an unrecognised role to current_authority, not into a void', () => {
  // The fallback at the partition step is a second fail-closed layer behind the resolver's own.
  // Every fixture elsewhere arrives with a valid contract role, so without this case the fallback
  // could be deleted and nothing would notice — and a dropped document is invisible by nature:
  // it is absent from every set rather than misfiled in one.
  const items = [
    { file: 'a.md', role: 'Design record' },
    { file: 'b.md', role: 'Retired archive' },   // a role no contract defines
    { file: 'c.md' },                            // and one that never got a role at all
  ];
  const sets = partitionByRole(items);
  assert.deepEqual(sets.design_records.map((i) => i.file), ['a.md']);
  assert.deepEqual(sets.current_authority.map((i) => i.file), ['b.md', 'c.md']);

  // Nothing is lost: the four sets together still account for every input.
  const placed = Object.values(sets).flat().length;
  assert.equal(placed, items.length);
});

test('an unreadable subtree throws rather than reading as an empty one', () => {
  // `catch { return }` made a permissions failure indistinguishable from "there are no requests".
  // Only ENOENT/ENOTDIR is confirmed absence; everything else has to reach the caller, which turns
  // it into `scan_error`. Injected rather than chmod-ed: as root every mode is readable, and the
  // earlier version returned before asserting anything there — a test that reports as *passing*
  // in exactly the environment (root containers) where it verifies nothing.
  const featureDir = join(createTempRoot(), 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md', 'requests/2026-01-01-a.md']);
  const reqDir = join(featureDir, 'requests');

  // The control first: readable, the same call succeeds and finds the ticket. Without it the throw
  // below would still pass if `scanFeatureDocs` had simply started throwing on everything.
  assert.deepEqual(scanFeatureDocs(featureDir, taxonomy).work_records.map((i) => i.file),
    [join('requests', '2026-01-01-a.md')]);

  const fs = require('node:fs');
  const real = fs.readdirSync;
  fs.readdirSync = (p, o) => {
    if (String(p) === reqDir) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return real(p, o);
  };
  try {
    assert.throws(() => scanFeatureDocs(featureDir, taxonomy), /EACCES/);
  } finally {
    fs.readdirSync = real;
  }
});

test('a feature with no requests directory is absence, not failure', () => {
  const featureDir = join(createTempRoot(), 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md']);
  const scan = scanFeatureDocs(featureDir, taxonomy);
  assert.deepEqual(scan.work_records, []);
  assert.deepEqual(scan.design_records.map((i) => i.file), ['2-tech-spec.md']);
});

test('an unreadable feature directory throws rather than returning an empty scan', () => {
  // The top-level read is the one that mattered most: its catch returned a SUCCESSFUL empty scan,
  // so `probe()` recorded `scan_error: false` and an unreadable corpus was reported as an empty
  // one. Deterministic injection, so the test does not depend on chmod semantics.
  const featureDir = join(createTempRoot(), 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md']);

  // Control first: the same call succeeds and finds the spec, so the throw below cannot be the
  // scanner having started throwing on everything.
  assert.deepEqual(scanFeatureDocs(featureDir, taxonomy).design_records.map((i) => i.file),
    ['2-tech-spec.md']);

  const fs = require('node:fs');
  const real = fs.readdirSync;
  fs.readdirSync = (p, o) => {
    if (String(p) === featureDir) { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; }
    return real(p, o);
  };
  try {
    assert.throws(() => scanFeatureDocs(featureDir, taxonomy), /EACCES/);
  } finally {
    fs.readdirSync = real;
  }
});

test('the scanner does not let a first_segment rule reach a folder inside a feature', () => {
  // `scanFeatureDocs` builds paths relative to the feature directory, so `skills/notes.md` here is
  // a feature-internal folder — not the repo-root `skills/` the rule is written for. The shipped
  // rule maps to the fallback role, so a fixture built on it would pass either way; the scope is
  // exercised against a config where the two answers differ.
  const featureDir = join(createTempRoot(), 'feature');
  setupDocDir(featureDir, ['2-tech-spec.md', 'skills/notes.md']);
  const rootOnly = {
    ...taxonomy,
    doc_roles: {
      ...taxonomy.doc_roles,
      path_defaults: [{ name: 'root-only', role: 'History record', scope: 'first_segment', pattern: '^skills$' }],
    },
  };

  const scan = scanFeatureDocs(featureDir, rootOnly);
  const nested = scan.doc_inventory.find((i) => i.file.endsWith('notes.md'));
  assert.equal(nested.role, 'Current authority', 'a nested skills/ folder is not the root one');
  assert.equal(scan.history_records.length, 0);

  // The control: widen the same rule to every segment and the nested file DOES land in
  // history_records — so the assertion above measures scope, not a config that never applied.
  const widened = {
    ...taxonomy,
    doc_roles: {
      ...taxonomy.doc_roles,
      path_defaults: [{ name: 'any-segment', role: 'History record', scope: 'segment', pattern: '^skills$' }],
    },
  };
  assert.deepEqual(scanFeatureDocs(featureDir, widened).history_records.map((i) => i.file),
    [join('skills', 'notes.md')]);
});

test('a feature directory that is simply absent is an empty scan, not a throw', () => {
  const scan = scanFeatureDocs(join(createTempRoot(), 'no-such-feature'), taxonomy);
  assert.deepEqual(scan.doc_inventory, []);
  assert.deepEqual(scan.current_authority, []);
  assert.equal(scan.canonical_docs.tech_spec, null);
});
