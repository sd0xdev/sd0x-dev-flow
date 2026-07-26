const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skillsDir = resolve(root, 'skills');
const templatePath = resolve(root, 'CLAUDE.template.md');
const claudeMdPath = resolve(root, 'CLAUDE.md');

/**
* Extract the Command Quick Reference section from markdown content.
 */
function extractCommandSection(content) {
  const start = content.indexOf('## Command Quick Reference');
  if (start === -1) return '';
  const rest = content.slice(start);
  const nextSection = rest.indexOf('\n## ', 1);
  return nextSection === -1 ? rest : rest.slice(0, nextSection);
}

/**
* Extract command names from a CLAUDE.md-style Command Quick Reference table.
* Returns an array (preserving duplicates for detection).
* Matches rows like: | `/some-command` | description | when |
 */
function extractTableCommands(content) {
  const section = extractCommandSection(content);
  const commands = [];
  const re = /^\|\s*`\/([^`]+)`\s*\|/gm;
  let m;
  while ((m = re.exec(section)) !== null) {
    commands.push(m[1]);
  }
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

// Parent/internal skills that are invoked by alias skills, not directly via slash-command.
// These don't need entries in the Command Quick Reference table.
const INTERNAL_SKILLS = new Set([
  'codex-code-review', 'doc-review', 'security-review', 'test-review',
  'portfolio', 'request-tracking', 'req-analyze', 'dev-security-audit',
  'readme-i18n-sync', // local-only skill, not committed to repo
  'update-readme', // local-only skill, not committed to repo
]);

test('every skill directory is listed in CLAUDE.template.md', () => {
  const templateContent = readFileSync(templatePath, 'utf8');
  const tableCommands = new Set(extractTableCommands(templateContent));
  const skills = getSkillDirs();

  const missing = skills.filter((skill) => !tableCommands.has(skill) && !INTERNAL_SKILLS.has(skill));
  assert.deepStrictEqual(
    missing,
    [],
    `skills/ directories missing from CLAUDE.template.md table: ${missing.join(', ')}`
  );
});

test('every CLAUDE.template.md table entry has a skills/<dir>/ directory', () => {
  const templateContent = readFileSync(templatePath, 'utf8');
  const tableCommands = extractTableCommands(templateContent);
  const fileSkills = new Set(getSkillDirs());

  const orphaned = tableCommands.filter((cmd) => !fileSkills.has(cmd));
  assert.deepStrictEqual(
    orphaned,
    [],
    `CLAUDE.template.md table entries without skills/ directory: ${orphaned.join(', ')}`
  );
});

test('no duplicate commands in CLAUDE.template.md table', () => {
  const templateContent = readFileSync(templatePath, 'utf8');
  const tableCommands = extractTableCommands(templateContent);
  const seen = new Set();
  const duplicates = [];
  for (const cmd of tableCommands) {
    if (seen.has(cmd)) duplicates.push(cmd);
    seen.add(cmd);
  }
  assert.deepStrictEqual(
    duplicates,
    [],
    `Duplicate commands in CLAUDE.template.md: ${duplicates.join(', ')}`
  );
});

test('CLAUDE.md table matches CLAUDE.template.md table', () => {
  const templateContent = readFileSync(templatePath, 'utf8');
  const claudeContent = readFileSync(claudeMdPath, 'utf8');

  const templateCommands = [...extractTableCommands(templateContent)].sort();
  const claudeCommands = [...extractTableCommands(claudeContent)].sort();

  assert.deepStrictEqual(
    claudeCommands,
    templateCommands,
    `CLAUDE.md and CLAUDE.template.md command tables differ.\n` +
      `Only in template: ${templateCommands.filter((c) => !claudeCommands.includes(c)).join(', ') || 'none'}\n` +
      `Only in CLAUDE.md: ${claudeCommands.filter((c) => !templateCommands.includes(c)).join(', ') || 'none'}`
  );
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

  const canonical = routedPrecommit(rules, /review Ready \(no P2\/Nit\)/);
  assert.ok(canonical, 'rules/auto-loop.md Auto-Trigger table should route the no-P2/Nit Ready row');

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

    // The table sits under a heading that claims "Stop Hook enforced". That claim is only true at
    // the granularity of "some precommit passed": stop-guard.sh accepts a passing `mode: fast`
    // unless PRECOMMIT_REQUIRE_FULL=1 is set. So a doc that names the FULL variant is advertising
    // a gate the hook does not enforce out of the box, and a generated project would inherit that
    // false assurance silently. Require the escape hatch to be named wherever full is declared.
    if (canonical === 'precommit') {
      assert.match(
        content,
        /PRECOMMIT_REQUIRE_FULL/,
        `${label} declares the full /precommit gate under a "Stop Hook enforced" heading, so it must `
          + 'also state that enforcing the variant requires PRECOMMIT_REQUIRE_FULL=1'
      );
    }
  }

  // The docs are advisory prose; these hooks are the layer that actually EMITS the routing into
  // the model's context — after a compaction, after a skill run, and on the next user prompt.
  // They were outside the file set, and the only test touching them asserted `/\/precommit/` —
  // which `precommit-fast` satisfies too, `precommit` being a strict prefix. So the enforcement
  // layer's variant was pinned nowhere: flipping every doc to fast left the suite green while the
  // hooks still said full.
  //
  // The list is derived, not hand-maintained: a fourth emitter added later would otherwise sit
  // unpinned for exactly as long as nobody remembered this test — which is how the third one
  // (user-prompt-review-guard.sh, the emitter that fires most often of the three) was missed.
  const emitters = readdirSync(resolve(root, 'hooks'))
    .filter((f) => f.endsWith('.sh'))
    .filter((f) => /NEXT="\/precommit/.test(readFileSync(resolve(root, 'hooks', f), 'utf8')));

  assert.ok(
    emitters.length >= 3,
    `expected at least the 3 known precommit-routing hooks, found ${emitters.length}: ${emitters}`
  );
  for (const rel of ['post-compact-auto-loop.sh', 'post-skill-auto-loop.sh', 'user-prompt-review-guard.sh']) {
    assert.ok(emitters.includes(rel), `hooks/${rel} should still route precommit into NEXT`);
  }

  // EVERY assignment in each emitter, not just the first. A non-global `match` returns one result,
  // so a hook that later grew a second, divergent `NEXT="/precommit-fast"` branch stayed green —
  // the same partial coverage this test's own comments criticise two paragraphs up, and the same
  // shape as the `strayRules` scan that had to be made exhaustive for rules/auto-loop.md.
  const strayEmitters = [];
  let assignments = 0;
  for (const f of emitters) {
    const src = readFileSync(resolve(root, 'hooks', f), 'utf8');
    src.split('\n').forEach((line, i) => {
      for (const tok of line.match(/NEXT="\/(?:precommit(?:-fast)?)"/g) || []) {
        assignments += 1;
        const variant = tok.replace(/NEXT="\/|"/g, '');
        if (variant !== canonical) strayEmitters.push(`hooks/${f}:${i + 1} -> ${tok}`);
      }
    });
  }
  assert.ok(
    assignments >= emitters.length,
    `each of the ${emitters.length} emitters should assign the precommit route to NEXT at least once `
      + `(found ${assignments} assignments)`
  );
  assert.deepEqual(
    strayEmitters, [],
    `every NEXT= precommit assignment in the emitting hooks must route to /${canonical}, matching `
      + 'rules/auto-loop.md'
  );
});
