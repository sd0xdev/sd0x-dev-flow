const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillsDir = resolve(root, 'skills');
const templatePath = resolve(root, 'CLAUDE.template.md');
const claudeMdPath = resolve(root, 'CLAUDE.md');
const catalogPath = resolve(root, 'docs/skill-catalog.yml');

// --- Catalog/frontmatter registration contract ---
//
// R3 (auto-loop prose reduction) removed the 90+-row command table from the tracked CLAUDE
// files. Registration now has ONE surface: docs/skill-catalog.yml, with each skill's
// frontmatter `description` as the dispatcher-facing discovery text. These tests replace the
// old table-shape assertions with the catalog contract.

/**
 * Extract command names from docs/skill-catalog.yml entries (preserving duplicates).
 * Matches lines like: `  - command: /some-command`
 */
function catalogCommands() {
  const content = readFileSync(catalogPath, 'utf8');
  const commands = [];
  const re = /^ {2}- command: \/(\S+)$/gm;
  let m;
  while ((m = re.exec(content)) !== null) commands.push(m[1]);
  return commands;
}

/**
 * Get all skill directory names from skills/ dir.
 */
function getSkillDirs() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

// Local-only skills: present in this machine's skills/ dir but deliberately kept out of the
// committed catalog (not shipped with the plugin).
const LOCAL_ONLY_SKILLS = new Set(['readme-i18n-sync', 'update-readme']);

test('every skill directory is registered in docs/skill-catalog.yml', () => {
  const catalogued = new Set(catalogCommands());
  const missing = getSkillDirs().filter((s) => !catalogued.has(s) && !LOCAL_ONLY_SKILLS.has(s));
  assert.deepStrictEqual(
    missing,
    [],
    `skills/ directories missing from docs/skill-catalog.yml: ${missing.join(', ')}`
  );
});

test('every catalog entry has a skills/<dir>/ directory', () => {
  const fileSkills = new Set(getSkillDirs());
  const orphaned = catalogCommands().filter((cmd) => !fileSkills.has(cmd));
  assert.deepStrictEqual(
    orphaned,
    [],
    `docs/skill-catalog.yml entries without skills/ directory: ${orphaned.join(', ')}`
  );
});

test('no duplicate commands in docs/skill-catalog.yml', () => {
  const seen = new Set();
  const duplicates = [];
  for (const cmd of catalogCommands()) {
    if (seen.has(cmd)) duplicates.push(cmd);
    seen.add(cmd);
  }
  assert.deepStrictEqual(duplicates, [], `Duplicate commands in docs/skill-catalog.yml: ${duplicates.join(', ')}`);
});

test('every skill carries a non-empty frontmatter description (the discovery interface)', () => {
  const bare = [];
  for (const dir of getSkillDirs()) {
    const skillPath = resolve(skillsDir, dir, 'SKILL.md');
    if (!existsSync(skillPath)) { bare.push(`${dir} (no SKILL.md)`); continue; }
    const fm = readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
    if (!fm || !/^description:\s*\S+/m.test(fm[1])) bare.push(dir);
  }
  assert.deepStrictEqual(
    bare,
    [],
    `skills without a frontmatter description (frontmatter IS the dispatcher interface): ${bare.join(', ')}`
  );
});

test('tracked CLAUDE files carry no command table', () => {
  for (const [label, path] of [['CLAUDE.md', claudeMdPath], ['CLAUDE.template.md', templatePath]]) {
    const content = readFileSync(path, 'utf8');
    assert.ok(!content.includes('## Command ' + 'Quick Reference'),
      `${label} must not re-grow the command quick-reference section`);
    const rows = content.match(/^\| *`\//gm) || [];
    assert.deepStrictEqual(rows, [],
      `${label} must not carry command-registration table rows (found ${rows.length}); register in docs/skill-catalog.yml instead`);
  }
});

// --- Regression guard: tests must not re-couple to a CLAUDE command table ---
//
// Three assertion shapes historically coupled 14 test files to the removed table:
//   (a) section assertions on the '## Command Quick Reference' heading
//   (b) bare-command regexes run against CLAUDE*.md content (e.g. /\/ask/)
//   (c) table-row regexes (e.g. matching a `| \`/recap-ask\` | ... |` row)
// Shape (a) is scanned for globally. Shapes (b) and (c) only mean anything after reading a
// tracked CLAUDE file, so the choke point is the reader set: any test file that reads one must
// be classified below, which forces every future CLAUDE consumer to make an explicit decision
// instead of silently re-growing a registration dependency.

// Non-registration consumers: allowed to read CLAUDE*.md because they pin prose contracts
// (rule references, sanitization wording, terminal-gate routing) — not command registration.
const ALLOWED_CLAUDE_READERS = new Set([
  'claude-health.test.js',             // pins claude-health S2.5, whose check #3 names `.claude/CLAUDE.md` as a detection input (R8)
  'claude-md-coverage.test.js',        // this file — terminal-gate routing below
  'context-management-rule.test.js',   // pins @rules/context-management.md references
  'create-pr-sanitization.test.js',    // pins Development Rules #3 wording
  'discretion-tiers.test.js',          // pins @rules/discretion.md import in the two tracked CLAUDE templates (R7)
  'remind.test.js',                    // pins /remind extraction targets (section headings, not registration)
  'review-dispatch.test.js',           // pins {TEST_COMMAND} placeholder + comments-only honesty prose
  'testing-rules.test.js',             // pins testing-project.md references
]);

// Anchored to a trailing quote (', ", or `) so all three JS string-literal quote styles
// classify as readers. Deliberately conservative: ANY quoted mention (even quoted prose or an
// object key) classifies and forces an explicit allowlist decision; only unquoted mentions pass.
const READER_PATTERN = /CLAUDE(?:\.template)?\.md['"`]/;

function allTestFiles() {
  return readdirSync(resolve(root, 'test'), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.test.js'))
    .map((d) => ({ name: d.name, path: resolve(d.parentPath || d.path, d.name) }));
}

test('no test file asserts on the removed command quick-reference section', () => {
  const offenders = allTestFiles()
    .filter(({ name }) => name !== 'claude-md-coverage.test.js')
    .filter(({ path }) => readFileSync(path, 'utf8').includes('Command ' + 'Quick Reference'))
    .map(({ name }) => name);
  assert.deepStrictEqual(offenders, [],
    `test files referencing the removed section (register skills in docs/skill-catalog.yml instead): ${offenders.join(', ')}`);
});

test('every test file reading a tracked CLAUDE file is a classified non-registration consumer', () => {
  const readers = allTestFiles()
    .filter(({ path }) => READER_PATTERN.test(readFileSync(path, 'utf8')))
    .map(({ name }) => name);
  const unclassified = readers.filter((name) => !ALLOWED_CLAUDE_READERS.has(name));
  assert.deepStrictEqual(unclassified, [],
    'these test files read CLAUDE.md/CLAUDE.template.md but are not classified as '
    + 'non-registration consumers. Command registration assertions (bare-command regexes, '
    + 'table-row regexes) belong in docs/skill-catalog.yml contracts; if the file pins prose '
    + `instead, add it to ALLOWED_CLAUDE_READERS with a justification: ${unclassified.join(', ')}`);
});

test('READER_PATTERN classifies all three string-literal quote styles and ignores bare mentions', () => {
  // Mutation-style fixtures for the guard itself: each historical assertion shape only matters
  // after reading a CLAUDE file, and JS offers three ways to spell that read. A pattern anchored
  // to one quote style lets a double-quoted or template-literal reader re-couple silently.
  const readerFixtures = [
    "readFileSync(resolve(root, 'CLAUDE.md'), 'utf8')",           // single quotes
    'readFileSync(resolve(root, "CLAUDE.template.md"), "utf8")',  // double quotes
    'readFileSync(resolve(root, `CLAUDE.md`), `utf8`)',           // template literal
  ];
  for (const fixture of readerFixtures) {
    assert.ok(READER_PATTERN.test(fixture), `must classify as reader: ${fixture}`);
  }
  // Unquoted prose mention must NOT classify — quoted mentions deliberately do (conservative).
  assert.ok(!READER_PATTERN.test('// see CLAUDE.md for the routing table'),
    'an unquoted prose mention must not classify as a reader');
});

test('the classified non-registration consumers still exist and still read CLAUDE files', () => {
  // Pins the allowlist itself: an entry that stops reading (or is deleted) is stale and must be
  // removed, so the classification stays a live decision rather than an inert list.
  const byName = new Map(allTestFiles().map(({ name, path }) => [name, path]));
  for (const name of ALLOWED_CLAUDE_READERS) {
    const path = byName.get(name);
    assert.ok(path, `ALLOWED_CLAUDE_READERS entry no longer exists: ${name}`);
    assert.ok(READER_PATTERN.test(readFileSync(path, 'utf8')),
      `ALLOWED_CLAUDE_READERS entry no longer reads a tracked CLAUDE file — remove the stale entry: ${name}`);
  }
});


// --- Auto-loop terminal-gate routing consistency ---

/**
 * Pull the precommit variant a markdown table row routes to.
 * Returns e.g. 'precommit' or 'precommit-fast', or null when the row is absent.
 */
function routedPrecommit(content, rowMatcher) {
  const line = content.split('\n').find((l) => rowMatcher.test(l));
  if (!line) return null;
  const m = line.match(/`\/(precommit(?:-fast)?)`/g);
  return m ? m[m.length - 1].replace(/[`/]/g, '') : null;
}

test('auto-loop terminal gate routes to one precommit variant across rules, tracked CLAUDE files, and the emitting hooks', () => {
  // Commit 31510e6 ("Change auto-loop default from /precommit-fast to /precommit", shift-left so
  // lint/build failures surface locally) updated rules/auto-loop.md and CLAUDE.md but missed
  // CLAUDE.template.md — which is what /project-setup ships to host projects. New projects were
  // therefore configured for the fast gate while the plugin's own normative rule mandated the full
  // one, and nothing was red. This pins the three tracked policy surfaces to one answer.
  //
  // .claude/CLAUDE.md is deliberately NOT checked: it is untracked, so it is outside what this
  // suite can hold anyone to — a file that is not in the repo cannot be a repo invariant. Note the
  // limit honestly rather than papering over it: this repo's own untracked copy currently says
  // `/precommit-fast` while every tracked surface says `/precommit`, and BOTH are loaded into the
  // model's context with no documented precedence. That divergence is real and this test does not
  // resolve it; it only guarantees the tracked surfaces agree with each other.
  const rules = readFileSync(resolve(root, 'rules/auto-loop.md'), 'utf8');

  // The row wording tracks the tier model (`auto-loop.md` § Tiers): the Ready row is keyed on
  // "no blocking findings", not on a hard-coded P2/Nit list, because what blocks is per-tier.
  const canonical = routedPrecommit(rules, /review Ready \(no blocking findings\)/);
  assert.ok(canonical, 'rules/auto-loop.md gate-sequence paragraph should route the no-blocking-findings Ready row');

  // EVERY precommit reference in the normative file, not just the row `canonical` is read from.
  // Deriving the answer from one row and checking only the other files left the source of truth
  // internally unpinned: flipping the P2/Nit sweep step, the Resolution Evaluation row, the
  // "No P2/Nit Path" line or the Pre-precommit checkpoint kept the whole suite green. That is the
  // identical partial-flip that 31510e6 committed — one file updated, siblings missed — reproduced
  // inside the file the test calls canonical.
  //
  // Blockquote lines are excluded, and the distinction is real rather than convenient: in this file
  // `> ` marks explanatory notes, never routing. One of them describes a TRANSCRIPT — the sequence
  // `/precommit-fast` → `## Overall: ✅ PASS` → `/precommit` that motivated verdict/invocation
  // pairing — where naming the fast variant is the entire point of the example. An exhaustive scan
  // cannot tell "this file routes to X" from "this file quotes someone invoking X", so the rule has
  // to be structural. `routingLines` is asserted non-empty below so the exclusion can never quietly
  // swallow every reference and leave nothing checked.
  const routingLines = rules.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*>/.test(line));

  const strayRules = [];
  let routingRefs = 0;
  for (const { line, n } of routingLines) {
    for (const tok of line.match(/`\/precommit(?:-fast)?`/g) || []) {
      routingRefs += 1;
      const variant = tok.replace(/[`/]/g, '');
      if (variant !== canonical) strayRules.push(`rules/auto-loop.md:${n} -> ${tok}`);
    }
  }
  assert.ok(
    routingRefs >= 3,
    `expected several routing references in rules/auto-loop.md outside blockquotes, found ${routingRefs} `
      + '— if this drops, the blockquote exclusion has eaten the check rather than narrowed it'
  );
  assert.deepEqual(
    strayRules, [],
    `every precommit reference in rules/auto-loop.md must route to /${canonical}; a file that `
      + 'disagrees with itself cannot be the source the other surfaces are checked against'
  );

  for (const [label, path] of [['CLAUDE.md', claudeMdPath], ['CLAUDE.template.md', templatePath]]) {
    const content = readFileSync(path, 'utf8');

    const required = routedPrecommit(content, /^\| code files \| `\/codex-review-fast` ->/);
    assert.equal(required, canonical, `${label} Required Checks row should route to /${canonical}`);

    const autoLoop = routedPrecommit(content, /^\| code files \| `\/codex-review-fast` \| `\//);
    assert.equal(autoLoop, canonical, `${label} Auto-Loop Rule row should route to /${canonical}`);

    // The table sits under the Required Checks heading. Since hook-lightweighting the Stop hook
    // is a reminder, not a gate — a doc still claiming enforcement would advertise a backstop
    // that no longer exists, and a generated project would inherit that false assurance silently.
    assert.match(content, /Stop Hook reminded/,
      `${label} must title Required Checks with the reminder posture, not "enforced"`);
    assert.match(content, /reminder, not a gate/,
      `${label} must state the Stop hook's reminder semantics where the table lives`);
    assert.doesNotMatch(content, /PRECOMMIT_REQUIRE_FULL|STOP_GUARD_MODE/,
      `${label} must not reference retired enforcement settings (dead config since hook-lightweighting)`);
  }

  // The docs are advisory prose; the reminder layer is what actually EMITS the routing into the
  // model's context — the git-fallback nudges in stop-guard.sh / post-compact-auto-loop.sh, and
  // the GATES table in scripts/review-state.js that every state-driven rendering reads
  // (hook-lightweighting §3.2). A doc flipped to fast while these still said full — or the
  // reverse — would be the same partial flip 31510e6 committed, one layer updated and the
  // emitting layer missed.
  //
  // The hook list is derived, not hand-maintained: any hook whose source names a precommit
  // variant is scanned, so a new reminder hook that grows a routing line is pinned the day it
  // lands.
  const emitterFiles = readdirSync(resolve(root, 'hooks'))
    .filter((f) => f.endsWith('.sh'))
    .map((f) => `hooks/${f}`)
    .filter((rel) => /\/precommit/.test(readFileSync(resolve(root, rel), 'utf8')))
    .concat(['scripts/review-state.js']);

  for (const rel of ['hooks/stop-guard.sh', 'hooks/post-compact-auto-loop.sh']) {
    assert.ok(
      emitterFiles.includes(rel),
      `${rel} should still carry the precommit route in its git-fallback nudge`
    );
  }

  // EVERY variant token in each emitting file, not just the first — a second, divergent
  // `/precommit-fast` branch added later must turn this red, the same exhaustiveness the
  // `strayRules` scan above applies to rules/auto-loop.md.
  const strayEmitters = [];
  let emitterRefs = 0;
  for (const rel of emitterFiles) {
    const src = readFileSync(resolve(root, rel), 'utf8');
    src.split('\n').forEach((line, i) => {
      for (const tok of line.match(/\/precommit(?:-fast)?\b/g) || []) {
        emitterRefs += 1;
        const variant = tok.slice(1);
        if (variant !== canonical) strayEmitters.push(`${rel}:${i + 1} -> ${tok}`);
      }
    });
  }
  assert.ok(
    emitterRefs >= emitterFiles.length,
    `each of the ${emitterFiles.length} emitting files should name the precommit route at least `
      + `once (found ${emitterRefs} references)`
  );
  assert.deepEqual(
    strayEmitters, [],
    `every precommit reference in the emitting layer must route to /${canonical}, matching `
      + 'rules/auto-loop.md'
  );
});
