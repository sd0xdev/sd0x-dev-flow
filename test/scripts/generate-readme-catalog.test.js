const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { readFileSync, existsSync, readdirSync, statSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = resolve(__dirname, '../..');
const CATALOG_PATH = join(ROOT, 'docs', 'skill-catalog.yml');
const README_PATH = join(ROOT, 'README.md');
const SKILLS_DIR = join(ROOT, 'skills');
const GENERATOR_PATH = join(ROOT, 'scripts', 'generate-readme-catalog.js');

// ── Catalog validation ──────────────────────────────────

test('skill-catalog.yml exists and is readable', () => {
  assert.ok(existsSync(CATALOG_PATH), 'docs/skill-catalog.yml should exist');
  const content = readFileSync(CATALOG_PATH, 'utf8');
  assert.ok(content.includes('version:'), 'should have version field');
  assert.ok(content.includes('categories:'), 'should have categories section');
  assert.ok(content.includes('skills:'), 'should have skills section');
});

test('all git-tracked skills/ directories have catalog entries', () => {
  // Use git ls-files (index) to check tracked skill directories.
  // This respects staged deletions (git rm --cached) unlike git ls-tree HEAD.
  const { execFileSync } = require('node:child_process');
  let trackedDirs;
  try {
    const out = execFileSync('git', ['ls-files', '--cached', 'skills/'], { encoding: 'utf8', cwd: ROOT });
    const dirSet = new Set(
      out.trim().split('\n').map(p => p.split('/')[1]).filter(Boolean)
    );
    trackedDirs = [...dirSet];
  } catch {
    // Fallback: use all local dirs (CI won't have untracked skills)
    trackedDirs = readdirSync(SKILLS_DIR).filter(d => statSync(join(SKILLS_DIR, d)).isDirectory());
  }
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  const catalogCommands = new Set(
    [...catalog.matchAll(/command:\s*\/(\S+)/g)].map(m => m[1])
  );

  const missing = trackedDirs.filter(dir => !catalogCommands.has(dir));
  assert.deepEqual(
    missing,
    [],
    `skills/ directories missing from catalog: ${missing.join(', ')}`
  );
});

test('all catalog entries have matching skills/ directories', () => {
  const skillDirs = new Set(
    readdirSync(SKILLS_DIR).filter(d => statSync(join(SKILLS_DIR, d)).isDirectory())
  );
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  const commands = [...catalog.matchAll(/command:\s*\/(\S+)/g)].map(m => m[1]);

  const orphaned = commands.filter(cmd => !skillDirs.has(cmd));
  assert.deepEqual(
    orphaned,
    [],
    `catalog entries without skills/ directory: ${orphaned.join(', ')}`
  );
});

test('all catalog entries have valid category', () => {
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  // Extract category IDs from the categories section (before skills section)
  const categoriesSection = catalog.split('skills:')[0];
  const categoryIds = [...categoriesSection.matchAll(/id:\s*(\S+)/g)].map(m => m[1]);
  const validCategories = new Set(categoryIds);

  // Extract skill categories from the skills section
  const skillsSection = catalog.split('skills:')[1] || '';
  const skillCategories = [...skillsSection.matchAll(/category:\s*(\S+)/g)].map(m => m[1]);
  const invalid = skillCategories.filter(c => !validCategories.has(c));
  assert.deepEqual(
    invalid,
    [],
    `invalid categories found: ${[...new Set(invalid)].join(', ')}`
  );
});

test('featured skills have use_when field', () => {
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  const entries = catalog.split(/\n\s{2}- command:/);
  const missing = [];
  for (const entry of entries.slice(1)) {
    const cmd = entry.match(/^\s*\/(\S+)/);
    const featured = entry.includes('featured: true');
    const hasUseWhen = entry.includes('use_when:');
    if (featured && !hasUseWhen && cmd) {
      missing.push(`/${cmd[1]}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `featured skills missing use_when: ${missing.join(', ')}`
  );
});

test('featured skill count is 12-15', () => {
  const catalog = readFileSync(CATALOG_PATH, 'utf8');
  const count = (catalog.match(/featured: true/g) || []).length;
  assert.ok(count >= 12 && count <= 15, `expected 12-15 featured, got ${count}`);
});

// ── README marker tests ─────────────────────────────────

test('README.md has all 5 BEGIN/END marker pairs', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const markers = [
    'HERO-COUNT',
    'WHATS-INCLUDED-COUNT',
    'INSTALL-COVERAGE',
    'ESSENTIAL-SKILLS',
    'FULL-CATALOG',
  ];
  for (const m of markers) {
    assert.ok(
      readme.includes(`<!-- BEGIN:${m} -->`),
      `README should have BEGIN:${m} marker`
    );
    assert.ok(
      readme.includes(`<!-- END:${m} -->`),
      `README should have END:${m} marker`
    );
  }
});

test('no unmanaged skill count strings in README', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const cleaned = readme.replace(
    /<!-- BEGIN:\w[\w-]* -->[\s\S]*?<!-- END:\w[\w-]* -->/g,
    ''
  );
  const stale = cleaned.match(/\b\d+ skills\b/g);
  assert.equal(
    stale,
    null,
    `unmanaged skill count strings found: ${(stale || []).join(', ')}`
  );
});

// ── Generator tests ─────────────────────────────────────

test('generator is idempotent (--check exits 0)', () => {
  const result = execFileSync(
    'node',
    [GENERATOR_PATH, '--check'],
    { encoding: 'utf8', cwd: ROOT }
  );
  assert.ok(result.includes('up to date'), 'generator --check should report up to date');
});

test('README full catalog has Review category with Loop Support column', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  assert.ok(
    readme.includes('| Loop Support |'),
    'Review category should have Loop Support column'
  );
});

test('README essential skills table uses Use when column', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const essentialMatch = readme.match(
    /<!-- BEGIN:ESSENTIAL-SKILLS -->([\s\S]*?)<!-- END:ESSENTIAL-SKILLS -->/
  );
  assert.ok(essentialMatch, 'Essential skills block should exist');
  assert.ok(
    essentialMatch[1].includes('| Use when |'),
    'Essential skills should have Use when column'
  );
});

// ── Marker structure regression tests ──────────────────
// Markers must wrap FULL tables (header+separator+rows) to avoid
// HTML comments breaking GitHub table rendering.

test('INSTALL-COVERAGE marker wraps full table (header + separator + rows)', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const block = readme.match(
    /<!-- BEGIN:INSTALL-COVERAGE -->\n([\s\S]*?)\n<!-- END:INSTALL-COVERAGE -->/
  );
  assert.ok(block, 'INSTALL-COVERAGE block should exist');
  const content = block[1];
  assert.ok(content.includes('| Method |'), 'should contain table header');
  assert.ok(content.includes('|-----'), 'should contain separator row');
  assert.ok(content.includes('Plugin install'), 'should contain Plugin install row');
  assert.ok(content.includes('codex-setup init'), 'should contain codex-setup row');
});

test('WHATS-INCLUDED-COUNT marker wraps full table (header + separator + rows)', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const block = readme.match(
    /<!-- BEGIN:WHATS-INCLUDED-COUNT -->\n([\s\S]*?)\n<!-- END:WHATS-INCLUDED-COUNT -->/
  );
  assert.ok(block, 'WHATS-INCLUDED-COUNT block should exist');
  const content = block[1];
  assert.ok(content.includes('| Category |'), 'should contain table header');
  assert.ok(content.includes('|-----'), 'should contain separator row');
  assert.ok(content.includes('| Skills |'), 'should contain Skills row');
  assert.ok(content.includes('| Agents |'), 'should contain Agents row');
  assert.ok(content.includes('| Scripts |'), 'should contain Scripts row');
});

test('no table header between marker and its parent heading', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  // Old broken pattern: heading → table header → separator → marker → rows
  // The regex checks no table separator row immediately precedes BEGIN marker
  const brokenPattern = /\|[-|]+\|\n<!-- BEGIN:(INSTALL-COVERAGE|WHATS-INCLUDED-COUNT) -->/;
  assert.equal(
    brokenPattern.test(readme),
    false,
    'table separator should not appear immediately before BEGIN marker (table must be inside marker)'
  );
});

test('README hero public count matches summary count', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  // Hero now emits "<bundled> bundled · <public> public skills · ..." (v3.0.12)
  const heroMatch = readme.match(
    /<!-- BEGIN:HERO-COUNT -->\n(\d+) bundled · (\d+) public skills/
  );
  assert.ok(heroMatch, 'hero bundled/public counts should exist');
  const heroPublic = parseInt(heroMatch[2], 10);

  const summaryMatch = readme.match(/All (\d+) public skills/);
  assert.ok(summaryMatch, 'catalog summary should reference public count');
  const summaryCount = parseInt(summaryMatch[1], 10);

  assert.equal(heroPublic, summaryCount, 'hero public count and catalog summary should match');
});

// === deep-explore regression: resource-count rows must match the shipped inventory ===

test('README resource counts: Hooks row lists exactly the 8 shipped hooks', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const row = readme.split('\n').find((l) => l.startsWith('| Hooks |'));
  assert.ok(row, 'README should have a Hooks resource row');
  assert.match(row, /^\| Hooks \| 8 \|/, 'hook count must be 8');
  assert.ok(!row.includes('namespace hint'), 'namespace hint is a script, not a hook');
  const hookFiles = readdirSync(join(ROOT, 'hooks')).filter((f) => f.endsWith('.sh'));
  assert.equal(hookFiles.length, 8, `hooks/ inventory drifted: ${hookFiles.join(', ')}`);
});

test('README resource counts: Scripts row count matches top-level scripts/ inventory', () => {
  const readme = readFileSync(README_PATH, 'utf8');
  const row = readme.split('\n').find((l) => l.startsWith('| Scripts |'));
  assert.ok(row, 'README should have a Scripts resource row');
  assert.match(row, /^\| Scripts \| 17 \|/, 'script count must be 17');
  const scriptFiles = readdirSync(join(ROOT, 'scripts')).filter(
    (f) => statSync(join(ROOT, 'scripts', f)).isFile() && /\.(sh|js)$/.test(f)
  );
  assert.equal(scriptFiles.length, 17, `scripts/ inventory drifted: ${scriptFiles.join(', ')}`);
});

// === deep-explore regression: LOCALE READMEs must not drift from disk inventory ===
// The 5 locale READMEs are hand-synced (not generated) and had gone stale at
// "9 hooks (incl. namespace hint) / 13 scripts". Labels are localized, so rows
// are located by their English example signature, not by the category label.

const LOCALE_READMES = ['README.zh-TW.md', 'README.zh-CN.md', 'README.ja.md', 'README.ko.md', 'README.es.md'];

function diskCount(dir, exts) {
  return readdirSync(join(ROOT, dir)).filter(
    (f) => statSync(join(ROOT, dir, f)).isFile() && exts.some((e) => f.endsWith(e))
  ).length;
}

// A What's-included row's 3rd pipe-cell is the count: | label | N | examples |
function rowCount(row) {
  const cells = row.split('|').map((s) => s.trim());
  return parseInt(cells[2], 10);
}

for (const locale of LOCALE_READMES) {
  test(`${locale}: Hooks row count matches disk and excludes namespace hint`, () => {
    const readme = readFileSync(join(ROOT, locale), 'utf8');
    // What's-included Hooks row — identified by its English example signature.
    const row = readme
      .split('\n')
      .find((l) => l.includes('pre-edit-guard') && l.includes('session-init'));
    assert.ok(row, `${locale} should have a What's-included Hooks row`);
    assert.equal(rowCount(row), diskCount('hooks', ['.sh']), `${locale} hook count drifted`);
    assert.ok(
      !row.includes('namespace hint'),
      `${locale}: namespace hint is a script, not a hook`
    );
  });

  test(`${locale}: Scripts row count matches disk inventory`, () => {
    const readme = readFileSync(join(ROOT, locale), 'utf8');
    const row = readme
      .split('\n')
      .find((l) => l.includes('precommit runner') && l.includes('readme-catalog'));
    assert.ok(row, `${locale} should have a What's-included Scripts row`);
    assert.equal(rowCount(row), diskCount('scripts', ['.sh', '.js']), `${locale} script count drifted`);
    // Stale phantom entries that were removed from disk long ago.
    assert.ok(!row.includes('utils (shared lib)'), `${locale}: 'utils (shared lib)' no longer exists`);
    assert.ok(!row.includes('feature-resolver'), `${locale}: 'feature-resolver' no longer exists`);
  });

  // The table row and the *prose* count are synced separately by hand — the
  // prose ("… 14 rules + N hooks") had drifted to 9 while the table said 8.
  // Match the number-then-word prose form (localized 個/个/개 hooks, フック,
  // 钩子); the "| Hooks | 8 |" table cell is word-then-number and never matches.
  test(`${locale}: prose hook count matches disk (no stale "9 hooks" drift)`, () => {
    const readme = readFileSync(join(ROOT, locale), 'utf8');
    const hooks = diskCount('hooks', ['.sh']);
    const mentions = [
      ...readme.matchAll(/(\d+)\s*(?:個|个|개)?\s*(?:hooks?|フック|钩子)/gi),
    ].map((m) => parseInt(m[1], 10));
    assert.ok(mentions.length > 0, `${locale}: expected at least one prose hook-count mention`);
    for (const n of mentions) {
      assert.equal(n, hooks, `${locale}: prose says ${n} hooks but disk has ${hooks} (stale drift)`);
    }
  });
}
