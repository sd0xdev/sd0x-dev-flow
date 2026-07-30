const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, copyFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { tmpdir } = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  atxHeadingName, liveLines, liveText, indentedCodeLines, structuralViolations, toLines,
} = require('../helpers/markdown-structure');

const rulesDir = resolve(__dirname, '../../rules');
const skillsDir = resolve(__dirname, '../../skills');

// --- Helpers ---

/** Parse ## headings from markdown, skipping fenced code blocks */
function extractHeadings(content) {
  const lines = content.split('\n');
  const headings = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^## /.test(line)) {
      headings.push(line.replace(/^## /, '').trim());
    }
  }
  return headings;
}

/** Classify sections: active, commented, missing, custom */
function classifySections(baseHeadings, overrideContent) {
  const lines = overrideContent.split('\n');
  const activeHeadings = extractHeadings(overrideContent);
  const commentedHeadings = [];
  for (const line of lines) {
    const match = line.match(/^<!--\s*##\s+(.+?)(?:\s*-->|\s*$)/);
    if (match) commentedHeadings.push(match[1].trim());
  }

  const result = [];
  for (const h of baseHeadings) {
    if (activeHeadings.includes(h)) {
      result.push({ heading: h, status: 'active', source: 'base' });
    } else if (commentedHeadings.includes(h)) {
      result.push({ heading: h, status: 'commented', source: 'base' });
    } else {
      result.push({ heading: h, status: 'missing', source: 'base' });
    }
  }
  for (const h of activeHeadings) {
    if (!baseHeadings.includes(h)) {
      result.push({ heading: h, status: 'custom', source: 'custom' });
    }
  }
  return result;
}

/** Whether a user has activated anything in an override template.
 *
 *  Derives from the shared scanner rather than re-implementing comment tracking, which is what let
 *  a `<!--\n## Dormant\nvalue\n-->` block read as active: slicing from the first RAW `## ` threw
 *  away the comment state that made it dormant.
 *
 *  A bare live heading is not activation — the shipped templates carry live empty `## Tier`,
 *  `## Max Rounds`, … as the scaffold a user fills in. A heading that carries a VALUE is, because
 *  that is the settings form (`## Plan Review: enabled`); skipping every heading meant the one
 *  activation shape the template documents registered as inactive.
 *
 *  The value has to be non-empty: `## Plan Review:` is a user part-way through typing, not a
 *  setting, and treating a bare colon as activation would report a dormant file as customized. */
function hasActiveContent(content) {
  const lines = toLines(liveText(content));
  const firstHeading = lines.findIndex((l) => atxHeadingName(l, 2) !== null);
  if (firstHeading === -1) return false;
  return lines.slice(firstHeading).some((line) => {
    const stripped = line.replace(/\u0000/g, '').trim();
    if (stripped === '') return false;
    const heading = atxHeadingName(line, 2);
    // NULs stripped first: masked text is not a value. `## Plan Review: <!-- enabled -->` has no
    // live value, but NUL satisfies `\S`, so the mask itself read as activation.
    if (heading !== null) return /:\s*\S/.test(heading.replace(/\u0000/g, ''));
    return !stripped.startsWith('#');
  });
}

/** Validate custom heading input */
function validateHeading(text) {
  if (text.length < 3 || text.length > 80) return 'Heading too short/long';
  if (!/^[a-zA-Z0-9 ()\-]+$/.test(text)) return 'Heading contains invalid characters';
  return null;
}

/** Parse Based-on hash from override file */
function parseBasedOnHash(content) {
  const match = content.match(/<!-- Based on: .+? @ ([0-9a-f]{7,40})/);
  return match ? match[1] : null;
}

// --- Tests ---

test('the skill this file pins stays inside the structure the scanner models', () => {
  // Every assertion below reads SKILL.md through liveText, so it inherits the scanner's blind
  // spots. Measuring the gate elsewhere is not enforcing it here: the file was clean but ungated,
  // and turning its managed-set paragraph into an indented code block left every workflow
  // assertion green because they pass fencesCount.
  assert.deepEqual(
    structuralViolations(readFileSync(resolve(skillsDir, 'install-rules/SKILL.md'), 'utf8')), [],
    'skills/install-rules/SKILL.md uses a structure the visibility scanner does not model'
  );
});

test('install-rules SKILL.md has customize sub-flags documented', () => {
  // Masked, and deliberately not asserted to live in `argument-hint`: this skill has no such
  // frontmatter field (1 of 100 skills does), so a test claiming that location passed off an
  // ordinary body match. Naming the weaker true claim beats certifying a stronger false one.
  const content = liveText(readFileSync(resolve(skillsDir, 'install-rules/SKILL.md'), 'utf8'));
  assert.match(content, /--add-section/, 'should document --add-section');
  assert.match(content, /--update-section/, 'should document --update-section');
  assert.match(content, /--reset/, 'should document --reset');
});

test('auto-loop-project.md template has Generated-by sentinel', () => {
  const content = readFileSync(resolve(rulesDir, 'auto-loop-project.md'), 'utf8');
  assert.match(content, /<!-- Generated by: \/install-rules -->/, 'template should have sentinel');
});

test('auto-loop-project.md template has Based-on hash', () => {
  const content = readFileSync(resolve(rulesDir, 'auto-loop-project.md'), 'utf8');
  const hash = parseBasedOnHash(content);
  assert.ok(hash, 'template should have Based-on hash');
  assert.match(hash, /^[0-9a-f]{7,}$/, 'hash should be hex string');
});

test('extractHeadings parses ## headings correctly', () => {
  const md = '# Title\n## Section One\ntext\n## Section Two\nmore text';
  const headings = extractHeadings(md);
  assert.deepEqual(headings, ['Section One', 'Section Two']);
});

test('extractHeadings skips ## inside fenced code blocks', () => {
  const md = '## Real\n```\n## Fake Inside Code\n```\n## Also Real';
  const headings = extractHeadings(md);
  assert.deepEqual(headings, ['Real', 'Also Real']);
});

test('classifySections identifies active, commented, missing, custom', () => {
  const baseHeadings = ['Auto-Trigger', 'Exit Conditions', 'P2/Nit Quality Sweep'];
  const override = [
    '# Auto-Loop Project Overrides',
    '## Auto-Trigger',
    'custom content',
    '<!-- ## Exit Conditions',
    'stuff',
    '-->',
    '## My Custom Rule',
    'content',
  ].join('\n');

  const result = classifySections(baseHeadings, override);
  assert.equal(result.length, 4);
  assert.equal(result[0].status, 'active');    // Auto-Trigger
  assert.equal(result[1].status, 'commented'); // Exit Conditions
  assert.equal(result[2].status, 'missing');   // P2/Nit Quality Sweep
  assert.equal(result[3].status, 'custom');    // My Custom Rule
});

test('hasActiveContent returns false for template-only file', () => {
  const template = readFileSync(resolve(rulesDir, 'auto-loop-project.md'), 'utf8');
  assert.equal(hasActiveContent(template), false, 'template should have no active content');
});

test('hasActiveContent returns true when section is uncommented', () => {
  const content = [
    '# Title',
    '<!-- Based on: auto-loop.md @ abc1234 -->',
    '<!-- Generated by: /install-rules -->',
    '',
    '## Auto-Trigger',
    '',
    '| Change Type | Event |',
  ].join('\n');
  assert.equal(hasActiveContent(content), true);
});

test('hasActiveContent handles multiline comments correctly', () => {
  const content = [
    '# Title',
    '<!-- Precedence: this file wins -->',
    '<!--',
    'This is a multiline comment',
    'spanning several lines',
    '-->',
    '',
    '<!-- ## Commented Section',
    'content here',
    '-->',
  ].join('\n');
  assert.equal(hasActiveContent(content), false, 'all-commented file should return false');
});

test('hasActiveContent when a heading sits inside a comment block → still dormant', () => {
  // The case the "multiline comments" test above names but avoids: a RAW `## ` after a standalone
  // `<!--`. Slicing the document from the first raw heading discarded the comment state that made
  // it dormant, so a shipped-but-commented section read as user activation.
  const dormant = ['# Title', '<!--', '## Dormant', 'value', '-->'].join('\n');
  assert.equal(hasActiveContent(dormant), false, 'a commented heading and its body are dormant');

  // And the converse: the settings form the template documents is activation, not scaffold.
  const bare = ['# Title', '', '## Tier', ''].join('\n');
  assert.equal(hasActiveContent(bare), false, 'an empty scaffold heading is not activation');
  const set = ['# Title', '', '## Plan Review: enabled', ''].join('\n');
  assert.equal(hasActiveContent(set), true, 'a value-carrying heading is activation');
  const empty = ['# Title', '', '## Plan Review:', ''].join('\n');
  assert.equal(hasActiveContent(empty), false, 'a bare colon carries no value, so it is not activation');
  const masked = ['# Title', '', '## Plan Review: <!-- enabled -->', ''].join('\n');
  assert.equal(hasActiveContent(masked), false, 'a value only a reader cannot see is not a value');
});

test('validateHeading rejects too short', () => {
  assert.ok(validateHeading('AB'), 'should reject 2-char heading');
});

test('validateHeading rejects too long', () => {
  assert.ok(validateHeading('A'.repeat(81)), 'should reject 81-char heading');
});

test('validateHeading rejects invalid characters', () => {
  assert.ok(validateHeading('Has <!-- comment -->'), 'should reject comment delimiters');
});

test('validateHeading accepts valid heading', () => {
  assert.equal(validateHeading('My Integration Tests'), null);
  assert.equal(validateHeading('Exit Conditions (Only)'), null);
  assert.equal(validateHeading('P2-Nit Quality Sweep'), null);
});

test('parseBasedOnHash extracts 7-char blob hash', () => {
  const content = '<!-- Based on: auto-loop.md @ a17d1b3 (2026-03-13) -->';
  assert.equal(parseBasedOnHash(content), 'a17d1b3');
});

test('parseBasedOnHash extracts full 40-char hash', () => {
  const content = '<!-- Based on: auto-loop.md @ a17d1b3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c (2026-03-13) -->';
  assert.equal(parseBasedOnHash(content), 'a17d1b3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c');
});

test('parseBasedOnHash returns null for missing hash', () => {
  assert.equal(parseBasedOnHash('no hash here'), null);
});

test('duplicate heading detection finds duplicates', () => {
  const content = '## Auto-Trigger\nstuff\n## Exit Conditions\nmore\n## Auto-Trigger\nduplicate';
  const headings = extractHeadings(content);
  const seen = new Set();
  const dupes = [];
  for (const h of headings) {
    if (seen.has(h)) dupes.push(h);
    seen.add(h);
  }
  assert.deepEqual(dupes, ['Auto-Trigger'], 'should detect duplicate heading');
});

test('install-rules SKILL.md documents customize mode', () => {
  const content = liveText(readFileSync(resolve(skillsDir, 'install-rules/SKILL.md'), 'utf8'));
  assert.match(content, /--customize/, 'should document --customize flag');
});

// --- R8: live-precedence header on both templates ---

test('both override templates carry the live-precedence header, comment metadata intact', () => {
  for (const [file, base] of [['auto-loop-project.md', 'auto-loop.md'], ['testing-project.md', 'testing.md']]) {
    const content = readFileSync(resolve(rulesDir, file), 'utf8');
    // Masked before slicing: the whole claim is "the reader SEES this line", so a raw match on a
    // preamble whose Precedence paragraph sits inside `<!-- … -->` would certify the exact
    // regression the header exists to prevent.
    const live = liveText(content);
    const pre = live.slice(0, Math.max(live.search(/^## /m), 0) || live.length);
    assert.match(pre, /^Precedence: /m, `${file}: live Precedence line in the preamble`);
    assert.ok(!/<!--\s*Precedence:/.test(content), `${file}: no comment-form Precedence declaration`);
    assert.match(content, new RegExp(`<!-- Based on: ${base.replace('.', '\\.')} @ [0-9a-f]{7,}`), `${file}: Based-on comment`);
    assert.match(content, /<!-- Generated by: \/install-rules -->/, `${file}: Generated-by sentinel`);
    assert.equal(hasActiveContent(content), false, `${file}: template stays activation-free despite the live header`);
  }
});

test('hasActiveContent ignores the live-precedence preamble but detects uncommented sections', () => {
  const header = [
    '# Auto-Loop Project Overrides',
    '',
    'Precedence: an active `##` section here replaces the same-heading section — Default/Guidance only.',
    '',
    '<!-- Based on: auto-loop.md @ abc1234 (2026-07-29) -->',
    '',
  ];
  const dormant = header.concat(['## Tier', '', '<!-- standard -->']).join('\n');
  assert.equal(hasActiveContent(dormant), false, 'live preamble alone is not activation');
  const activated = header.concat(['## Tier', '', 'thorough']).join('\n');
  assert.equal(hasActiveContent(activated), true, 'an uncommented setting is activation');
});

// --- R8: template-source vs installed-copy separation, in an independent consumer fixture ---

/** git's blob hash, computed locally: sha1 over `blob <bytelength>\0` + contents.
 *  Same value `git hash-object --no-filters <file>` prints, which is what claude-health's
 *  drift check compares against — asserted equal to git's own output below. */
function blobHash(buf) {
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]))
    .digest('hex')
    .slice(0, 7);
}

// Mirrors the spec's install pseudocode (rule-override-pattern/2-tech-spec.md § 3.4.1):
// absent target → copy the template AND stamp `Based on:` with the base rule's CURRENT blob
// hash; existing target → never touched. The stamping is not decoration: a byte-for-byte copy
// hands the consumer whatever hash the shipped template happened to record, so every fresh
// install starts out reporting drift against overrides the user has not written yet.
function installOverrideTemplates(srcDir, dstDir, mapping) {
  const log = [];
  for (const [baseRule, projectFile] of Object.entries(mapping)) {
    const dst = resolve(dstDir, projectFile);
    if (existsSync(dst)) {
      log.push({ file: projectFile, action: 'skipped' });
      continue;
    }
    const template = readFileSync(resolve(srcDir, projectFile), 'utf8');
    const hash = blobHash(readFileSync(resolve(srcDir, baseRule)));
    const pattern = new RegExp(`(<!-- Based on: ${baseRule.replace('.', '\\.')} @ )[0-9a-f]{7,}`);
    assert.match(template, pattern, `${projectFile}: template must carry a stampable Based-on comment`);
    writeFileSync(dst, template.replace(pattern, `$1${hash}`));
    log.push({ file: projectFile, action: 'created', hash });
  }
  return log;
}

const OVERRIDE_TEMPLATES = { 'auto-loop.md': 'auto-loop-project.md', 'testing.md': 'testing-project.md' };

/** The Override Template Copy Contract, whitespace-normalized. Equality against this constant is
 *  the whole guard.
 *
 *  Four earlier designs failed, each to the same class of probe. A denylist of negation forms
 *  (three iterations) could always be re-worded past — `do not copy`, `aren't copied`, `won't
 *  copy`, `rewritten unless…`, an intervening-word window one word wider. An allowlist of
 *  verb-bearing clauses closed that, but only *after* extraction: masking inline code spans made
 *  ``are `rewritten` on every install`` verb-free and therefore invisible, and any operation
 *  outside the lexical roots — merge, migrate, regenerate, overwrite — was equally invisible.
 *  Widening the roots is the denylist problem wearing a different hat.
 *
 *  Pinning the normalized section removes the theory entirely: there is nothing to extract, so
 *  nothing can be excluded from extraction. The section is three paragraphs, and it is the one
 *  piece of prose in this skill that must not change without someone looking — a failure here is
 *  the intended cost of editing it, not noise. Update this constant in the same commit as the
 *  contract, and the diff shows a reviewer exactly what the contract now says.
 *
 *  Scope boundary, stated so it is not mistaken for closure: this pins the contract's text and the
 *  headings on either side of it. A sentence contradicting the contract from inside a *different*
 *  section's body is not something an equality check on this section can see — that is what the
 *  contract's own "**only install or re-install path**" clause and doc review are for. */
const CANONICAL_CONTRACT =
  'Both override templates are copied from `rules/` on install when absent (`override_templates` in ' +
  '`docs/features/rule-override-pattern/2-tech-spec.md` maps `auto-loop.md → auto-loop-project.md` and ' +
  '`testing.md → testing-project.md`). This is the **only install or re-install path** that writes them — ' +
  'they are excluded from the managed set above, so no merge, upgrade, or `--force` reaches them. ' +
  '(The one other writer is the user-invoked `--reset`, below.) ' +
  'The copy and `--reset` regeneration produce the **live-precedence header** (a live `Precedence:` ' +
  'paragraph before the first `##` — HTML comments are stripped from model context, so a comment-form ' +
  'declaration never reaches the model), and stamp `<!-- Based on: <base> @ <hash> -->` with the base ' +
  "rule's blob hash **at copy time** rather than carrying the template's recorded value, so a fresh " +
  'install starts at zero drift instead of inheriting whatever hash the shipped template happened to ' +
  'record. An already-installed `.claude/rules/*-project.md` is user-owned and is **never rewritten by ' +
  'install or re-install** — including `--force`, which governs the managed set only. The single ' +
  'exception is `--customize <rule> --reset`, which the user invokes explicitly against a named file to ' +
  'regenerate it; that is a requested overwrite, not an install-time one. A legacy comment-only header ' +
  "is therefore *reported* by `/claude-health` S2.5 check #6 and never migrated on the user's behalf — " +
  '`--reset` is offered as the remedy the user may choose, not an action the install path takes.';

/** Collapse inline and line-break whitespace so re-wrapping a paragraph is invisible — but reject
 *  indented code first. A paragraph pushed to column 4 renders as a code block: the words are
 *  unchanged, so a naive collapse still matches the canonical value while the contract has quietly
 *  stopped being normative prose. Column 4 is measured with tab stops by `indentedCodeLines()`,
 *  because `^(?:\t| {4})` misses one space followed by a tab, and only block-opening lines count,
 *  because indented code cannot interrupt a paragraph. */
function normalizeContract(text) {
  assert.deepEqual(indentedCodeLines(text), [],
    'a contract line opens at column 4 or deeper, so it renders as a code block — the text would survive this comparison while ceasing to be normative prose');
  return text.replace(/\s+/g, ' ').trim();
}

/** The contract section's text, with the extraction itself verified: exactly one heading, live
 *  (not inside a fence or an HTML comment), non-empty, and terminated by the next heading of any
 *  level. Wrapping the whole section in `<!-- … -->` leaves every word intact while removing it
 *  from model context — which is precisely the carrier failure R8 exists to fix, so a guard that
 *  reads raw lines would certify the very defect it is here to prevent. */
function extractContract(skill) {
  const lines = toLines(skill);
  const live = liveLines(skill);
  const at = lines
    .map((l, i) => (atxHeadingName(l, 3) === 'Override Template Copy Contract (R8)' ? i : -1))
    .filter((i) => i !== -1);
  assert.deepEqual(at.length, 1, 'the contract heading appears exactly once — a duplicate would leave one copy free to contradict the other');
  assert.ok(live[at[0]], 'the contract heading is live text, not commented out or inside a fenced example');
  const body = [];
  for (let i = at[0] + 1; i < lines.length; i += 1) {
    if (atxHeadingName(lines[i], 1) || atxHeadingName(lines[i], 2) || atxHeadingName(lines[i], 3)
        || atxHeadingName(lines[i], 4) || atxHeadingName(lines[i], 5) || atxHeadingName(lines[i], 6)) break;
    assert.ok(live[i] || lines[i].trim() === '',
      `contract line ${i + 1} is inside a fence or HTML comment — the contract must be live normative text`);
    body.push(lines[i]);
  }
  assert.ok(body.join('\n').trim().length > 0, 'the contract section has a body — an empty one must fail, not pass vacuously');
  return body.join('\n');
}

test('blobHash matches git hash-object, so the stamping assertions test the value drift is measured against', () => {
  for (const f of ['rules/auto-loop.md', 'rules/testing.md']) {
    const fromGit = execFileSync('git', ['hash-object', '--no-filters', f], { cwd: resolve(__dirname, '../..') })
      .toString().trim().slice(0, 7);
    assert.equal(blobHash(readFileSync(resolve(__dirname, '../..', f))), fromGit,
      `${f}: local blob hash must equal git's, else the fixture stamps a value claude-health never compares`);
  }
});

test('fresh install in a detached consumer fixture → live header AND Based-on stamped with the base rule\'s current hash', () => {
  // Source and target are SEPARATE temp paths — this repo's .claude/rules is a symlink to
  // ../rules, so the two branches cannot be distinguished in the working tree (R8 ticket
  // environment caveat); the fixture is the only honest place to test them.
  const fixture = mkdtempSync(join(tmpdir(), 'sd0x-override-install-'));
  try {
    const src = join(fixture, 'plugin-rules');
    const dst = join(fixture, 'consumer', '.claude', 'rules');
    mkdirSync(src, { recursive: true });
    mkdirSync(dst, { recursive: true });
    // The template is seeded with a DELIBERATELY STALE hash. Without that, the shipped template
    // happens to record the current base hash, so a non-stamping byte-copy would pass this test
    // and the whole stamping contract would go unverified — the exact masking the code review
    // caught. `0000000` can only survive if nothing stamped.
    const STALE = '0000000';
    for (const [baseRule, projectFile] of Object.entries(OVERRIDE_TEMPLATES)) {
      copyFileSync(resolve(rulesDir, baseRule), join(src, baseRule));
      const seeded = readFileSync(resolve(rulesDir, projectFile), 'utf8')
        .replace(new RegExp(`(<!-- Based on: ${baseRule.replace('.', '\\.')} @ )[0-9a-f]{7,}`), `$1${STALE}`);
      assert.match(seeded, new RegExp(`@ ${STALE}`), `${projectFile}: fixture seeding must actually take effect`);
      writeFileSync(join(src, projectFile), seeded);
    }
    const log = installOverrideTemplates(src, dst, OVERRIDE_TEMPLATES);
    assert.deepEqual(log.map((l) => l.action), ['created', 'created']);
    for (const [baseRule, projectFile] of Object.entries(OVERRIDE_TEMPLATES)) {
      const installed = readFileSync(join(dst, projectFile), 'utf8');
      assert.match(installed, /^Precedence: /m, `${projectFile}: fresh install carries the live header`);
      assert.ok(!/<!--\s*Precedence:/.test(installed), `${projectFile}: fresh install has no legacy comment header`);
      const expected = blobHash(readFileSync(join(src, baseRule)));
      assert.match(installed, new RegExp(`<!-- Based on: ${baseRule.replace('.', '\\.')} @ ${expected}`),
        `${projectFile}: Based-on must be stamped with the installed base rule's current blob hash`);
      assert.ok(!installed.includes(`@ ${STALE}`),
        `${projectFile}: the stale seeded hash must not survive — a byte-for-byte copy leaves it and reports drift on day one`);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('shipped /install-rules contract pins both mappings, copy-when-absent, --reset live header, and never-rewrite', () => {
  // The fixture tests above exercise a local mirror of the install pseudocode; this test binds
  // them to the SHIPPED contract so a production regression (dropped mapping, rewrite of an
  // installed copy) fails here even though the skill is declarative markdown, not executable code.
  const skill = readFileSync(resolve(skillsDir, 'install-rules/SKILL.md'), 'utf8');
  // Extraction must be unambiguous before anything is asserted about the text. A renamed or
  // deleted heading yields no section; a duplicated one would silently pin whichever copy came
  // first, leaving the other free to say the opposite.
  const contract = extractContract(skill);
  for (const [base, projectFile] of Object.entries(OVERRIDE_TEMPLATES)) {
    assert.match(contract, new RegExp(`${base.replace('.', '\\.')}\\s*→\\s*${projectFile.replace('.', '\\.')}`),
      `contract lists the ${base} → ${projectFile} mapping (fixture mapping stays traceable to the shipped text)`);
  }
  assert.match(contract, /Both override templates are copied from `rules\/` on install when absent/,
    'contract states absent-target copy behavior (full positive sentence — a negated rewording must fail)');
  assert.match(contract, /`--reset` regeneration produce the \*\*live-precedence header\*\*/,
    'contract states copy and --reset produce the live-precedence header');
  assert.match(contract, /live `Precedence:` paragraph before the first `##`/,
    'contract defines the live header shape');
  assert.match(contract, /user-owned and is \*\*never rewritten by install or re-install\*\*/,
    'contract states existing installed copies are never rewritten');
  assert.match(contract, /\/claude-health.*S2\.5 check #6.*never migrated on the user's behalf/,
    'contract routes legacy headers to diagnosis, not auto-migration');

  // The doc review caught the two clauses below as contradictions rather than gaps: a blanket
  // "never rewritten" sat next to "--reset regenerates", and a byte-for-byte copy of a template
  // carrying a stale `Based on:` hash makes every fresh install report drift immediately.
  assert.match(contract, /single exception is `--customize <rule> --reset`/,
    'the --reset exception is stated explicitly instead of contradicting the never-rewrite clause');
  assert.match(contract, /`--force`, which governs the managed set only/,
    'contract states --force does not reach user-owned override files');
  // Full positive clause INCLUDING its grammatical subject. The reviewer demonstrated that a
  // fragment-anchored regex ("stamp `<!-- Based on…") is satisfied by "do not stamp `<!-- Based
  // on…", so a negated rewrite of the contract would keep the suite green.
  assert.match(contract,
    /The copy and `--reset` regeneration produce the \*\*live-precedence header\*\*[\s\S]{0,400}?, and stamp `<!-- Based on: <base> @ <hash> -->` with the base rule's blob hash \*\*at copy time\*\* rather than carrying the template's recorded value/,
    'contract stamps provenance at copy time (full clause, subject included)');
  assert.match(contract, /so a fresh install starts at zero drift instead of inheriting/,
    'contract names the failure the stamping prevents');
  // Closure for the whole section. The assertions above say what the contract must contain; this
  // one says it contains nothing else. Any addition, deletion, or rewording fails here regardless
  // of how it is phrased — see CANONICAL_CONTRACT for why no lexical guard survived.
  assert.equal(normalizeContract(contract), CANONICAL_CONTRACT,
    'the Override Template Copy Contract changed — read the diff, confirm it is not an inversion of what it promises, then update CANONICAL_CONTRACT in the same commit');

  // Pinning the payload alone leaves its neighbourhood open: a `## Exception to the Override
  // Template Copy Contract` dropped in immediately after reverses the contract without touching a
  // byte of it. Pinning the heading sequence blocks an inserted section on either side.
  const live = liveLines(skill);
  const headings = skill.split('\n')
    .filter((l, i) => live[i] && /^ {0,3}#{1,6}[ \t]/.test(l))
    .map((l) => l.trim());
  const at = headings.indexOf('### Override Template Copy Contract (R8)');
  assert.notEqual(at, -1, 'the contract heading is among the document headings');
  assert.deepEqual(headings.slice(at - 1, at + 2),
    ['### Customize Mode (`--customize`)', '### Override Template Copy Contract (R8)', '## Output'],
    'a section was inserted next to the contract — check whether it qualifies or reverses it, then update this sequence');
});

test('the pinned contract rejects every mutation four lexical guards let through', () => {
  const skill = readFileSync(resolve(skillsDir, 'install-rules/SKILL.md'), 'utf8');
  const contract = extractContract(skill);
  assert.equal(normalizeContract(contract), CANONICAL_CONTRACT, 'baseline: the shipped contract is the pinned one');

  // A following heading of ANY level ends the section. Splitting on `## ` alone let a `### `
  // subsection be read as part of the contract, so text nobody considers part of it would have to
  // be pinned here — and a contradiction placed there would fail for a confusing reason.
  for (const level of ['#', '##', '###', '####', '#####', '######']) {
    const withSubsection = skill.replace(/^## Output$/m, `${level} Later Section\n\nAnything at all.\n\n## Output`);
    assert.equal(normalizeContract(extractContract(withSubsection)), CANONICAL_CONTRACT,
      `an H${level.length} after the contract terminates the section rather than joining it`);
  }

  // Every string below was demonstrated by a reviewer against one of the four earlier designs.
  // Appending any of them leaves the positive sentence assertions above satisfied, so if this
  // guard does not fail, a self-contradictory contract ships with a green suite.
  for (const inversion of [
    // Denylist iterations 1–3: participle-only verbs, per-line allowlist, fixed word window.
    'Override templates are not copied from `rules/` on install.',
    "Overrides aren't copied from `rules/`.",
    "The installer won't copy override templates.",
    'The installer cannot copy override templates.',
    'Do not ever, even under the most unusual of circumstances, copy the templates.',
    'Use the template hash instead of stamping the base hash.',
    'Installed copies are rewritten unless the user objects.',
    'They are no longer excluded from the managed set.',
    // Clause allowlist, hole A: an operation outside the lexical roots.
    'A smart merge reaches the override templates.',
    "Legacy headers are migrated automatically.",
    'Reset does not regenerate the requested file.',
    'The installer overwrites every existing user-owned file.',
    // Clause allowlist, hole B: the operative verb hidden inside an inline code span, which the
    // masking step deleted along with the clause that carried it.
    'User-owned files are `rewritten` on every install.',
    'Override files may be `merged` into the managed set.',
  ]) {
    assert.notEqual(normalizeContract(contract + '\n\n' + inversion), CANONICAL_CONTRACT,
      `must reject the appended inversion: ${inversion}`);
  }

  // Deletion and silent weakening are the other half — an additions-only guard misses both.
  for (const [mutated, why] of [
    [contract.replace('they are excluded from the managed set above', 'they sit alongside the managed set above'), 'a removed promise'],
    [contract.replace('**never rewritten by install or re-install**', 'rarely rewritten by install or re-install'), 'a hedged absolute'],
    [contract.replace('**at copy time**', 'at some point'), 'a vague replacement for a precise term'],
  ]) {
    assert.notEqual(normalizeContract(mutated), CANONICAL_CONTRACT, `must reject: ${why}`);
  }

  // Whitespace and line wrapping are not content: reflowing a paragraph must not fail the test,
  // or the first person to run a formatter deletes the guard instead of updating it.
  assert.equal(normalizeContract(contract.replace(/ /g, '\n  ')), CANONICAL_CONTRACT,
    're-wrapping is invisible to the comparison');

  // …but indentation past the code-block threshold is content: the same words stop being a
  // normative statement and become a sample. Collapsing whitespace first hides that completely.
  for (const [prefix, why] of [['    ', 'four spaces'], ['\t', 'a tab'], ['        ', 'eight spaces']]) {
    const asCode = contract.split('\n').map((l) => (l.trim() === '' ? l : prefix + l)).join('\n');
    assert.throws(() => normalizeContract(asCode), /renders? as a code block|code block/,
      `the contract demoted to a code block by ${why} must fail loudly`);
  }

  // Structural mutations that leave every word of the contract intact. Each was demonstrated
  // against a raw-line extractor: the payload still normalizes to the canonical value, yet the
  // contract has stopped being live normative text — the HTML-comment case is exactly the carrier
  // failure R8 exists to fix, so certifying it would be the worst possible false pass.
  const heading = '### Override Template Copy Contract (R8)';
  for (const [mutated, why] of [
    [skill.replace(heading, `<!--\n${heading}`).replace(/^## Output$/m, '-->\n\n## Output'),
      'the whole section wrapped in an HTML comment'],
    [skill.replace(heading, `\`\`\`markdown\n${heading}`).replace(/^## Output$/m, '```\n\n## Output'),
      'the whole section wrapped in a fenced code block'],
    [skill + '\n\n' + heading + '\n\nInstall always overwrites user files.\n',
      'a second copy of the heading, free to contradict the first'],
    [skill.replace(/^(Both override templates are copied)/m, ' \t$1'),
      'one space plus a tab — column 4, so indented code, but not a match for /^(?:\\t| {4})/'],
  ]) {
    assert.throws(() => normalizeContract(extractContract(mutated)), /assert|Assertion/i, `must reject: ${why}`);
  }

  // The neighbourhood pin must see headings of every level, or an H1 or H4 section inserted before
  // the contract carries governing text past a sequence check that only looks at H2 and H3.
  for (const level of ['#', '####', '######']) {
    const inserted = skill.replace(heading, `${level} Exception\n\nInstall always overwrites user files.\n\n${heading}`);
    const liveIn = liveLines(inserted);
    const seq = inserted.split('\n').filter((l, i) => liveIn[i] && /^ {0,3}#{1,6}[ \t]/.test(l)).map((l) => l.trim());
    const idx = seq.indexOf(heading);
    assert.notDeepEqual(seq.slice(idx - 1, idx + 2),
      ['### Customize Mode (`--customize`)', heading, '## Output'],
      `an H${level.length} inserted before the contract must break the pinned sequence`);
  }
});

test('shipped /install-rules workflow excludes *-project.md from the manifest-tracked managed set', () => {
  // Spec (rule-override-pattern/2-tech-spec.md § 3.4.1) requires the exclusion; before this the
  // workflow enumerated `*.md` and fed everything into manifest classification + smart merge, so
  // a user-owned override file could be reached by --force or a conflict resolution.
  // fencesCount: true — the workflow diagram is a legitimate fenced code block a reader reads,
  // so it stays visible; an HTML comment around any of these four clauses does not.
  const skill = liveText(
    readFileSync(resolve(skillsDir, 'install-rules/SKILL.md'), 'utf8'),
    { fencesCount: true }
  );
  assert.match(skill, /Phase 2: Enumerate \*\.md, MINUS the override templates \(\*-project\.md\)/,
    'the workflow diagram itself carries the exclusion, not just prose further down');
  assert.match(skill, /\*\*Managed-set exclusion \(required\)\*\*/, 'the exclusion is a named requirement');
  assert.match(skill, /never enter the manifest, the classification in Phase 3\.5, or the smart merge in Phase 4/,
    'the exclusion names every managed-path stage it must not reach');
  assert.match(skill, /Phase 4\.5: Override templates — copy-when-absent only \(never smart-merged\)/,
    'the override templates get their own phase, separate from the managed path');
});

test('existing installed copy in the fixture → bytes stay identical through a re-install', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'sd0x-override-keep-'));
  try {
    const src = join(fixture, 'plugin-rules');
    const dst = join(fixture, 'consumer', '.claude', 'rules');
    mkdirSync(src, { recursive: true });
    mkdirSync(dst, { recursive: true });
    for (const f of Object.values(OVERRIDE_TEMPLATES)) {
      copyFileSync(resolve(rulesDir, f), join(src, f));
    }
    // The consumer's installed copy carries a LEGACY header and user edits — user-owned.
    const legacy = [
      '# Auto-Loop Project Overrides',
      '<!-- Precedence: When this file conflicts with auto-loop.md, this file takes precedence. -->',
      '## Tier',
      'thorough',
    ].join('\n');
    writeFileSync(join(dst, 'auto-loop-project.md'), legacy);
    writeFileSync(join(dst, 'testing-project.md'), legacy.replace(/auto-loop/g, 'testing'));
    const before = Object.values(OVERRIDE_TEMPLATES).map((f) => readFileSync(join(dst, f)));
    const log = installOverrideTemplates(src, dst, OVERRIDE_TEMPLATES);
    assert.deepEqual(log.map((l) => l.action), ['skipped', 'skipped']);
    Object.values(OVERRIDE_TEMPLATES).forEach((f, i) => {
      assert.ok(before[i].equals(readFileSync(join(dst, f))), `${f}: installed copy must stay byte-identical`);
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
