'use strict';

/**
 * skill-contract.test.js — pins the parts of `skills/necessity-audit/SKILL.md` that are
 * EXECUTED rather than merely read: the scratch-directory protocol and the cleanup command.
 *
 * These are prose instructions, so nothing else can catch a regression in them. The original
 * text told the model to run `TMPDIR=$(mktemp -d)` in one Bash step and reference `$TMPDIR`
 * in the next. Shell variables do not survive across tool invocations, and on macOS `TMPDIR`
 * is an ambient variable already pointing at the shared per-user temp root — so every later
 * step silently operated on that shared root, and the closing `rm -rf $TMPDIR` pointed a
 * recursive delete at it.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', '..', '..', 'skills', 'necessity-audit', 'SKILL.md');
const skill = fs.readFileSync(SKILL_PATH, 'utf8');

// The warning block deliberately QUOTES the broken pattern to explain it, so the scan is limited
// to the executable surface: fenced ```bash blocks and inline `--flag <path>` operands.
function bashBlocks(md) {
  return [...md.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
}

test('necessity-audit SKILL.md: no bash block assigns or dereferences TMPDIR', () => {
  const offending = bashBlocks(skill).filter((b) => /\bTMPDIR\b/.test(b));
  assert.deepEqual(
    offending,
    [],
    `TMPDIR must not appear in an executable block — it is ambient on macOS and does not persist across Bash calls:\n${offending.join('\n---\n')}`
  );
});

test('necessity-audit SKILL.md: every scratch path uses the <AUDIT_TMP_DIR> placeholder', () => {
  const blocks = bashBlocks(skill).join('\n');
  const scratchFiles = ['preflight.json', 'topic.txt', 'debate.json', 'report.json', 'report.md', 'report.final.md'];
  for (const f of scratchFiles) {
    const re = new RegExp(`<AUDIT_TMP_DIR>/${f.replace('.', '\\.')}`);
    assert.match(blocks, re, `${f} must be addressed via the substituted absolute path`);
  }
});

test('necessity-audit SKILL.md: scratch paths in bash blocks are double-quoted', () => {
  // An unquoted `<AUDIT_TMP_DIR>/x.json` would word-split once substituted with a real macOS
  // temp path (which can contain no spaces today, but the placeholder is model-substituted and
  // must not depend on that).
  const unquoted = [];
  for (const block of bashBlocks(skill)) {
    for (const line of block.split('\n')) {
      if (!line.includes('<AUDIT_TMP_DIR>')) continue;
      if (line.trim().startsWith('#')) continue;
      if (!/"<AUDIT_TMP_DIR>/.test(line)) unquoted.push(line.trim());
    }
  }
  assert.deepEqual(unquoted, [], `every scratch path must be quoted:\n${unquoted.join('\n')}`);
});

test('necessity-audit SKILL.md: the delete runs through the EXECUTABLE guard, not a bare rm', () => {
  // This used to assert the presence of prose ("re-read the path before the delete") because the
  // step was a bare `rm -rf`. Prose is not a control — nothing executes it, so the one run where
  // the placeholder is mis-substituted is also the run where nothing checks. The guard now lives
  // in cleanup.js (covered by cleanup.test.js), reachable under the skill's existing
  // `Bash(node:*)` permission, so no bare recursive delete should remain in the skill at all.
  // BOTH halves must be present, and `--claim` is not optional decoration: `--dir` refuses any
  // directory that was never claimed, so a skill that only ever calls `--dir` can never delete
  // anything. Asserting on the first matching block alone would have passed on either half.
  const cleanupBlocks = bashBlocks(skill).filter((b) => /cleanup\.js/.test(b));
  assert.ok(cleanupBlocks.length >= 2, 'both the --claim and the --dir step must exist');
  assert.ok(
    cleanupBlocks.some((b) =>
      /node scripts\/skills\/necessity-audit\/cleanup\.js --claim "<AUDIT_TMP_DIR>"/.test(b)
    ),
    'the scratch dir must be CLAIMED right after mktemp — that marker is what binds the later delete to this run'
  );
  assert.ok(
    cleanupBlocks.some((b) =>
      /node scripts\/skills\/necessity-audit\/cleanup\.js --dir "<AUDIT_TMP_DIR>"/.test(b)
    ),
    'cleanup must call the guard with a quoted scratch path'
  );
  for (const block of bashBlocks(skill)) {
    assert.doesNotMatch(block, /(^|[^\w-])rm\s+-[rRf]/, `no bare recursive delete may remain:\n${block}`);
  }
  assert.match(skill, /re-read the path/i, 'the prose reminder still complements the guard');
});

// Strip comments before source-greps, so a pin cannot be satisfied by the prose that EXPLAINS the
// property instead of the code that implements it. Same shape as cleanup.test.js's copy.
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

test('necessity-audit: the cleanup guard script exists and is wired to the skill', () => {
  const guard = path.resolve(__dirname, '../../../scripts/skills/necessity-audit/cleanup.js');
  assert.ok(fs.existsSync(guard), 'scripts/skills/necessity-audit/cleanup.js should exist');
  // Comments STRIPPED before the grep. Both tokens below appear in cleanup.js's own prose, so
  // against the raw source these assertions were satisfied by the explanation of the guard rather
  // than by the guard. Mutation-proven: neutering `isSymbolicLink()` to `false`, and neutering
  // LEAF_RE to `/^/`, each left this suite fully green while the behavioural sibling
  // (cleanup.test.js) correctly went red both times.
  const src = codeOnly(fs.readFileSync(guard, 'utf8'));
  assert.match(src, /tmp\\\./, 'the guard must pin the mktemp -d leaf shape');
  assert.match(src, /isSymbolicLink/, 'the guard must reject symlinks, which would escape the temp root');
});

test('necessity-audit SKILL.md: the hazard is explained, not just avoided', () => {
  // Without the rationale the next editor "simplifies" it straight back to $TMPDIR.
  assert.match(skill, /fresh[\s>]+\*\*shell\*\*|\*\*fresh[\s>]+shell\*\*/, 'must state that each Bash call is a fresh shell');
  assert.match(skill, /ambient/, 'must state that TMPDIR is ambient on macOS');
});
