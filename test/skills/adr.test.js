const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { resolve, join, basename } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const { classifyByPath, classifyByHeading } = require('../../scripts/lib/doc-classifier');
const { nextAdrNumber } = require('../../skills/adr/scripts/next-adr-number');

const skillPath = resolve(__dirname, '../../skills/adr/SKILL.md');
const templatePath = resolve(__dirname, '../../skills/adr/references/template.md');
const repoRoot = resolve(__dirname, '../..');

// The guard is documented once and must be tested at that same granularity — a whole-file
// content.match() is satisfied by any mention anywhere (e.g. the Phase 4 prose paragraph that
// explains classifyByHeading also says "path.basename"), which proves nothing about the actual
// runnable command. Scope every assertion below to this one section.
function extractGuardSection(content) {
  const start = content.indexOf('**Classification guard');
  if (start === -1) return null;
  const end = content.indexOf('\n### ', start);
  return content.slice(start, end === -1 ? undefined : end);
}

function withTempFeatureDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-test-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function splitFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  return { frontmatter: match ? match[1] : '', body: match ? content.slice(match[0].length) : content };
}

// ── Frontmatter ────────────────────────────────────────────────────────────

test('skills/adr/SKILL.md has valid frontmatter with name and description', () => {
  const content = readFileSync(skillPath, 'utf8');
  const { frontmatter } = splitFrontmatter(content);
  assert.match(frontmatter, /^name:\s*adr\s*$/m, 'frontmatter name must be exactly "adr"');
  assert.match(frontmatter, /^description:\s*".+"\s*$/m, 'frontmatter must have a non-empty description');
});

// ── Template fields (AC: Context/Decision/Status/Consequences/Alternatives) ─

test('template.md contains all required ADR sections', () => {
  const template = readFileSync(templatePath, 'utf8');
  for (const heading of ['## Context', '## Decision', '## Status', '## Consequences']) {
    assert.ok(template.includes(heading), `template must include a "${heading}" section`);
  }
  assert.match(template, /## Alternatives Considered/i,
    'template must include an alternatives-considered section');
});

test('template.md Status field enumerates Proposed / Accepted / Superseded', () => {
  const template = readFileSync(templatePath, 'utf8');
  for (const status of ['Proposed', 'Accepted', 'Superseded']) {
    assert.ok(template.includes(status), `Status field must enumerate "${status}"`);
  }
});

test('template.md H1 heading contains "ADR" for doc-taxonomy heading_signals', () => {
  const template = readFileSync(templatePath, 'utf8');
  const h1 = template.split('\n').find((l) => l.startsWith('# '));
  assert.ok(h1, 'template must have an H1 heading');
  assert.ok(h1.includes('ADR'), `H1 must contain the literal string "ADR": ${h1}`);
});

test('control: stripping "ADR" from the real template H1 fails the same assertion', () => {
  const template = readFileSync(templatePath, 'utf8');
  const h1 = template.split('\n').find((l) => l.startsWith('# '));
  const mutantH1 = h1.replace(/ADR/g, '');
  assert.ok(!mutantH1.includes('ADR'),
    'the real H1 with "ADR" stripped out must not satisfy the heading assertion');
});

test('end-to-end: classifyByHeading recognizes an H1 with "ADR", not one without', () => {
  // Content shaped like real Phase 4 output (template's HTML-comment placeholder slots removed,
  // per SKILL.md Phase 4) — the raw template.md still has those, and their "adr-<OLD>" example
  // text would falsely satisfy the "ADR" substring signal even with the H1 stripped, which would
  // make this control pass for the wrong reason.
  const body = ['> **Status**: Proposed', '> **Created**: 2026-01-01', '',
    '## Context', 'We need a database.', '## Decision', 'We will use Postgres.'].join('\n');
  withTempFeatureDir((dir) => {
    const withMarker = join(dir, 'with-adr-h1.md');
    writeFileSync(withMarker, `# ADR-001: Use Postgres\n\n${body}\n`);
    assert.equal(classifyByHeading(withMarker)?.type, 'adr',
      'a filename-fallback file with "ADR" in its H1 must classify via heading_signals');

    const withoutMarker = join(dir, 'without-adr-h1.md');
    writeFileSync(withoutMarker, `# Use Postgres for storage\n\n${body}\n`);
    assert.notEqual(classifyByHeading(withoutMarker)?.type, 'adr',
      'the same content with "ADR" removed from its H1 must not classify via heading_signals');
  });
});

// ── Numbering rule (AC: 3-digit zero-pad, numeric max, root + archived/) ────

test('SKILL.md documents the first-ADR filename shape as the zero-padded edge case', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /adr-001-<title>\.md/,
    'SKILL.md must document adr-001-<title>.md as the first-ADR filename');
});

test('SKILL.md documents numeric (not lexical) max parsing across root and archived/', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Numeric max, not lexical sort/,
    'SKILL.md must state the numbering rule is a numeric max, not a lexical/string sort');
  assert.match(content, /archived\//,
    'SKILL.md must document scanning the archived/ subdirectory for existing numbers');
});

test('control: a lexical-sort description would not satisfy the numeric-max assertion', () => {
  const mutantText = 'Sort existing adr-*.md filenames alphabetically and take the last one.';
  assert.doesNotMatch(mutantText, /Numeric max, not lexical sort/,
    'a lexical-sort description must not satisfy the numeric-max pin');
});

// ── nextAdrNumber() — real execution, not a prose pin ───────────────────────
// A regex match on the SKILL.md comment proves nothing about the function body;
// these call the actual exported implementation against real directories.

test('nextAdrNumber: empty/missing feature dir produces 001', () => {
  withTempFeatureDir((dir) => {
    assert.equal(nextAdrNumber(dir), '001');
  });
});

test('nextAdrNumber: numeric max across adr-9 and adr-10 is 011, not the lexical-sort collision 010', () => {
  withTempFeatureDir((dir) => {
    writeFileSync(join(dir, 'adr-9-first.md'), '');
    writeFileSync(join(dir, 'adr-10-second.md'), '');
    // A lexical/string comparison reads "9" > "10" (char-code order), so a naive
    // max would return '010' here — colliding with the adr-10 file that already exists.
    assert.equal(nextAdrNumber(dir), '011');
  });
});

test('nextAdrNumber: archived/ numbers count toward the max even when higher than root', () => {
  withTempFeatureDir((dir) => {
    writeFileSync(join(dir, 'adr-2-root.md'), '');
    mkdirSync(join(dir, 'archived'));
    writeFileSync(join(dir, 'archived', 'adr-5-retired.md'), '');
    assert.equal(nextAdrNumber(dir), '006');
  });
});

test('nextAdrNumber: missing archived/ subdirectory does not throw', () => {
  withTempFeatureDir((dir) => {
    writeFileSync(join(dir, 'adr-3-root.md'), '');
    assert.doesNotThrow(() => nextAdrNumber(dir));
    assert.equal(nextAdrNumber(dir), '004');
  });
});

test('nextAdrNumber: uppercase ADR- prefix counts toward the max (case-insensitive filesystem safety)', () => {
  withTempFeatureDir((dir) => {
    writeFileSync(join(dir, 'ADR-006-caps.md'), '');
    assert.equal(nextAdrNumber(dir), '007');
  });
});

// ── Classification guard (AC/P1: title collision with another type's pattern) ─

test('a title containing "runbook" misclassifies without the guard — proves the guard is load-bearing', () => {
  const result = classifyByPath('adr-002-runbook-automation.md');
  assert.notEqual(result.type, 'adr',
    'doc-taxonomy.json checks runbook (unanchored) before adr — this filename really does misclassify');
});

test('a title containing "checklist" misclassifies the same way', () => {
  const result = classifyByPath('adr-003-checklist-generation.md');
  assert.notEqual(result.type, 'adr');
});

test('a fallback-filename ADR whose body mentions "SOP" misclassifies on the heading path too — same collision as runbook/checklist', () => {
  withTempFeatureDir((dir) => {
    const file = join(dir, 'notes.md');
    writeFileSync(file, '# ADR-001: Deploy process\n\nWe wrote a new SOP for this.\n');
    const result = classifyByHeading(file);
    assert.notEqual(result?.type, 'adr',
      'a perfect H1 does not save a fallback-filename ADR whose body hits an earlier taxonomy signal');
  });
});

test('a title ending in "-fp-brief" or "-tech-brief" misclassifies too — the suffix-anchored collisions', () => {
  assert.notEqual(classifyByPath('adr-004-vendor-fp-brief.md').type, 'adr',
    'fp-brief carries a suffix-anchored pattern (-fp-brief.md$) that precedes adr in taxonomy order');
  assert.notEqual(classifyByPath('adr-005-vendor-tech-brief.md').type, 'adr',
    'tech-brief carries a suffix-anchored pattern (-tech-brief.md$) that precedes adr in taxonomy order');
});

test('SKILL.md documents the pre-write classification guard naming classifyByPath and all four colliding types', () => {
  const content = readFileSync(skillPath, 'utf8');
  const section = extractGuardSection(content);
  assert.ok(section, 'SKILL.md must document a classification guard step');
  assert.match(section, /classifyByPath/,
    'the guard must name classifyByPath, the function this test file also calls');
  for (const type of ['runbook', 'checklist', 'fp-brief', 'tech-brief']) {
    assert.ok(section.includes(type),
      `the classification guard section itself (not some other paragraph) must name "${type}" as a colliding type`);
  }
});

test('control: a guard section naming only two of the four colliding types fails the same-scoped assertion', () => {
  const mutantSection = '**Classification guard** — checks for `runbook` and `checklist` collisions.';
  for (const type of ['fp-brief', 'tech-brief']) {
    assert.ok(!mutantSection.includes(type),
      'a guard section missing fp-brief/tech-brief must not satisfy the four-type pin');
  }
});

test('the guard COMMAND itself (not surrounding prose) strips to a basename, and running it end-to-end survives a full path with a colliding directory name', () => {
  const content = readFileSync(skillPath, 'utf8');
  const section = extractGuardSection(content);
  assert.ok(section, 'SKILL.md must document a classification guard step');

  const codeBlock = section.match(/```bash\n([\s\S]*?)\n```/);
  assert.ok(codeBlock, 'the classification guard section must carry a runnable bash command block');
  const command = codeBlock[1];
  assert.match(command, /basename\(\s*process\.argv\[1\]\s*\)/,
    'the guard COMMAND (not prose elsewhere in the file) must strip its argument to a basename');

  const nodeExprMatch = command.match(/node -e "([\s\S]*?)"/);
  assert.ok(nodeExprMatch, 'the guard command must be a `node -e "..."` one-liner');

  // Execute the actual documented command — not a re-derivation of it — against the exact
  // shape of bug the code-review agent found: a full write path whose parent directory name
  // itself collides with a taxonomy type.
  const target = 'docs/features/deploy-runbook/adr-001-use-postgres.md';
  const output = execFileSync(process.execPath, ['-e', nodeExprMatch[1], target], { cwd: repoRoot })
    .toString().trim();
  assert.equal(output, 'adr',
    'running the documented guard command against a full path with a colliding directory name must still print "adr"');

  // Same bug, verified independently of the shell command too.
  const raw = 'adr-001-use-postgres.md';
  assert.notEqual(classifyByPath(`docs/features/auth/${raw}`).type, 'adr',
    'control: classifyByPath on the unstripped full path really does misclassify (the bug being fixed)');
  assert.equal(classifyByPath(basename(`docs/features/auth/${raw}`)).type, 'adr',
    'basename() on the full write path must classify correctly');
});

test('SKILL.md bounds the classification-guard retry loop with an explicit attempt cap and Gate: Need Human escape', () => {
  const content = readFileSync(skillPath, 'utf8');
  const section = extractGuardSection(content);
  assert.ok(section, 'SKILL.md must document a classification guard step');
  assert.match(section, /3 (failed )?(rephrasings|attempts)/,
    'the guard section must state a numeric attempt cap, not an unbounded "keep asking" loop');
  assert.match(section, /\*\*Gate: Need Human\*\*/,
    'exceeding the attempt cap must escalate to Gate: Need Human, not loop forever');
});

test('control: a guard description with no attempt cap fails the bounded-retry pin', () => {
  const mutantSection = 'Ask the user to rephrase the title, recompute, and re-check.';
  assert.doesNotMatch(mutantSection, /3 (failed )?(rephrasings|attempts)/,
    'an unbounded retry description must not satisfy the attempt-cap pin');
});

// ── Superseded linking (AC: bidirectional) ──────────────────────────────────

test('SKILL.md documents bidirectional Superseded linking (both files edited)', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /\*\*Supersedes\*\*/, 'new ADR must carry a Supersedes line');
  assert.match(content, /\*\*Superseded by\*\*/i, 'old ADR must carry a Superseded-by line');
  assert.match(content, /both files change/i,
    'SKILL.md must state the link is bidirectional — both files are edited in the same pass');
});

test('template.md carries commented-out slots for both Supersedes and Superseded-by lines', () => {
  const template = readFileSync(templatePath, 'utf8');
  assert.ok(template.includes('**Supersedes**'), 'template must carry a Supersedes slot');
  assert.ok(template.includes('**Superseded by**'), 'template must carry a Superseded-by slot');
});

test('SKILL.md documents both relative-path forms for an old ADR found in archived/', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /archived\/adr-<OLD>-<old-title>\.md/,
    'the new ADR must link to an archived old ADR via ./archived/adr-<OLD>-<old-title>.md');
  assert.match(content, /\.\.\/adr-<NEW>-<new-title>\.md/,
    'the old ADR (inside archived/) must link back to the new ADR one directory up (../adr-<NEW>-...)');
});

test('control: the archived/ and root path forms differ — a doc that only listed the root form would fail the archived/ pin', () => {
  const rootOnlyDoc = 'New ADR link: ./adr-<OLD>-<old-title>.md';
  assert.doesNotMatch(rootOnlyDoc, /archived\/adr-<OLD>-<old-title>\.md/,
    'a root-only path form must not satisfy the archived/ path pin');
});

test('SKILL.md routes a nonexistent superseded-ADR target to Gate: Need Human, not a guess', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /does not exist at either location,\s+\*\*Gate: Need Human\*\*/,
    'a superseded ADR that cannot be found at either the root or archived/ location must gate, not guess');
});

test('SKILL.md routes chained supersession (old ADR already superseded by a third ADR) to Gate: Need Human', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /already `Superseded` by a\s+third ADR,\s+\*\*Gate: Need Human\*\*/,
    'an old ADR already superseded by a third ADR must gate rather than overwrite or append a second link');
});

// ── Error handling: no feature resolved ─────────────────────────────────────

test('SKILL.md routes an unresolved feature to Gate: Need Human, not a guess', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /Gate: Need Human/,
    'an unresolved feature key must route to Gate: Need Human');
});

test('SKILL.md reuses the shared feature-context-resolution mechanism, not a duplicated one', () => {
  const content = readFileSync(skillPath, 'utf8');
  assert.match(content, /feature-context-resolution\.md/,
    'SKILL.md must reference the shared feature-context-resolution mechanism');
  // The wrapper, not the CLI. `scripts/resolve-feature.js` owns the failure payload
  // (doc-review-phasing r2): it exits 0 with `scan_error: true` where a direct CLI call can die
  // mid-write. This skill briefly held an exemption because its `allowed-tools` could not reach
  // `bash`; the resolution was a Node entrypoint runnable under the `Bash(node:*)` it already has,
  // so there is one contract, no exemption, and no widened permission —
  // `test/skills/scan-error-gate.test.js` checks that pairing across every caller.
  assert.match(content, /node scripts\/resolve-feature\.js/,
    'SKILL.md must name the wrapper entrypoint, not re-derive resolution logic');
  assert.ok(!/\bnode\b.*resolve-feature-cli\.js/.test(content),
    'SKILL.md must not invoke the CLI directly');
});

// ── doc-classifier integration (AC: semantic_pattern hit, not fallback) ─────

test('a generated adr filename classifies via semantic_pattern, not the fallback type', () => {
  const result = classifyByPath('adr-001-use-postgres.md');
  assert.equal(result.type, 'adr');
  assert.equal(result.namespace, 'ancillary');
  assert.notEqual(result.confidence, 'low');
});

test('a three-digit-padded multi-word title still classifies as adr', () => {
  const result = classifyByPath('adr-014-switch-to-opaque-tokens.md');
  assert.equal(result.type, 'adr');
});

test('control: a non-adr filename does not classify as adr', () => {
  const result = classifyByPath('runbook-deploy.md');
  assert.notEqual(result.type, 'adr');
});

test('control: an unrelated filename hits the taxonomy fallback, not adr', () => {
  const tax = JSON.parse(readFileSync(resolve(__dirname, '../../scripts/config/doc-taxonomy.json'), 'utf8'));
  const result = classifyByPath('random-notes.md');
  assert.equal(result.type, tax.fallback_type);
  assert.notEqual(result.type, 'adr');
});
