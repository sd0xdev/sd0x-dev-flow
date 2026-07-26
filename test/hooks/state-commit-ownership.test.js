'use strict';

// Cross-hook invariant: EVERY commit of a staged rewrite onto the review state file must prove
// lock ownership immediately before the rename, or declare itself an unlocked writer.
//
// `post-tool-review-state.test.js` already asserts this — for ONE hook, and with a commit pattern
// bound to the temp-variable names that hook happens to use (`$tmp` / `$_tmp`). Four hooks write
// this file. `post-compact-auto-loop.sh` staged into `$_srf_tmp` and checked ownership BEFORE the
// jq that produces the staged bytes rather than at the rename, and was invisible to that test on
// both counts: wrong file, and a temp name the regex could not match. It was the only such site
// among ~25, which is precisely the drift a per-file enumerated test cannot catch.
//
// The invariant is about ORDERING, not syntax. Ownership proven before a slow `jq` proves nothing
// at the moment that matters: stale recovery fires on age alone, so a contender can take the lock
// over during the jq, and the rename — a whole-FILE replace — then discards whatever the new owner
// committed. The check must be the last thing that happens before the `mv`.
//
// Two spellings satisfy that, and both appear deliberately in the tree:
//   (a) same line   — `_own_lock && mv "$tmp" "$STATE_FILE"`
//   (b) last conjunct of the enclosing `if` condition, with the `mv` as the first statement of the
//       then-block — `if jq … && [[ -s "$tmp" ]] && _own_lock; then` / `mv …`
// Nothing runs between the check and the rename in either.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const HOOKS_DIR = join(__dirname, '..', '..', 'hooks');

// A rename of a staged file onto the state file, under any temp-variable name.
const COMMIT = /\bmv\s+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"\s+"\$\{?(STATE_FILE|state_file)\}?"/;
// The ownership predicates in use. `_own_lock` compares the per-process owner token;
// `_may_commit_state` is post-edit-format.sh's wrapper around the same idea.
const OWNERSHIP = /\b(_own_lock|_may_commit_state)\b/;

function isComment(line) {
  return /^\s*#/.test(line);
}

// Every commit site in every hook, with the context needed to judge it.
function collectCommits() {
  const out = [];
  for (const file of readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.sh')).sort()) {
    const lines = readFileSync(join(HOOKS_DIR, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isComment(line) || !COMMIT.test(line)) return;
      out.push({ file, line, lineNo: i + 1, index: i, lines });
    });
  }
  return out;
}

// Ownership proven with nothing in between: on the commit line itself, or as the tail of the
// nearest preceding CODE line when that line opens a then-block (the `mv` being its first
// statement). Deliberately narrow — a check two statements up would pass a "somewhere above"
// search while leaving the takeover window wide open.
function isGuarded({ line, index, lines }) {
  if (OWNERSHIP.test(line)) return true;
  let prev = index - 1;
  while (prev >= 0 && (isComment(lines[prev]) || lines[prev].trim() === '')) prev -= 1;
  if (prev < 0) return false;
  const cond = lines[prev];
  return /;\s*then\s*$/.test(cond) && OWNERSHIP.test(cond);
}

// An explicit `# UNLOCKED-WRITER:` declaration covering this commit — either in the enclosing
// function's doc block or in a comment above the commit inside that function. The escape hatch is
// real: `init_state_file` runs before any lock exists, and two degraded branches run BECAUSE
// `_lock` failed, so an ownership check there would refuse every write.
function isDeclaredUnlocked({ index, lines }) {
  let start = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (/^[a-zA-Z_][a-zA-Z0-9_]*\(\)\s*\{/.test(lines[i])) {
      // Include the contiguous comment block above the declaration.
      let head = i - 1;
      while (head >= 0 && isComment(lines[head])) head -= 1;
      start = head + 1;
      break;
    }
  }
  return lines
    .slice(start, index)
    .some((l) => /^\s*#\s*UNLOCKED-WRITER:/.test(l));
}

test('every state-file commit proves lock ownership at the rename, or declares itself unlocked', () => {
  const commits = collectCommits();

  // Non-vacuity: if the commit shape drifts, this test must fail loudly rather than silently
  // examining nothing. Four hooks write the state file; three of them commit staged rewrites.
  assert.ok(commits.length >= 20, `expected the tree's commit sites, found ${commits.length} — has the commit shape changed?`);
  const files = new Set(commits.map((c) => c.file));
  assert.ok(files.size >= 3, `expected commits in at least 3 hooks, saw: ${[...files].join(', ')}`);

  const undeclared = [];
  for (const c of commits) {
    if (isGuarded(c)) continue;
    if (isDeclaredUnlocked(c)) continue;
    undeclared.push(`${c.file}:${c.lineNo}: ${c.line.trim()}`);
  }

  assert.deepEqual(
    undeclared,
    [],
    'these commits rename onto the state file without proving ownership immediately beforehand, ' +
      'and without an `# UNLOCKED-WRITER:` declaration. An ownership check that runs before the ' +
      'jq proves ownership at that earlier moment, not at this one:\n  ' + undeclared.join('\n  ')
  );
});

test('the unlocked-writer escape hatch is used sparingly and is not the majority', () => {
  // If every committer declared itself unlocked, the test above would pass while proving nothing.
  const commits = collectCommits();
  const declared = commits.filter((c) => !isGuarded(c) && isDeclaredUnlocked(c));
  const guarded = commits.filter((c) => isGuarded(c));

  assert.ok(declared.length >= 1, 'the escape hatch should have at least one real user (init/degraded paths)');
  assert.ok(
    guarded.length > declared.length * 2,
    `guarded commits (${guarded.length}) must dominate declared-unlocked ones (${declared.length})`
  );
});

test('ownership is checked AFTER the staging jq, never only before it', () => {
  // The specific ordering bug, pinned directly. Walking forward from an ownership check to the
  // `mv` it is supposed to protect, no command may intervene — a `jq`/`mktemp`/`wc` between them
  // is the takeover window. Reported per site so a regression names its own file and line.
  const offenders = [];
  for (const c of collectCommits()) {
    if (!isGuarded(c)) continue; // unguarded/declared sites are the other test's business
    if (OWNERSHIP.test(c.line)) continue; // same-line form has no gap by construction
    // Form (b): the check is on the `if` line directly above. Confirm the mv really is the first
    // statement of that then-block, i.e. only comments/blanks sit between them.
    const between = [];
    for (let i = c.index - 1; i >= 0; i -= 1) {
      if (OWNERSHIP.test(c.lines[i])) break;
      if (!isComment(c.lines[i]) && c.lines[i].trim() !== '') between.push(c.lines[i].trim());
    }
    const intervening = between.filter((l) => !/;\s*then$/.test(l));
    if (intervening.length > 0) {
      offenders.push(`${c.file}:${c.lineNo} — between the ownership check and the mv: ${intervening.join(' | ')}`);
    }
  }
  assert.deepEqual(offenders, [], `ownership must be the last thing before the rename:\n  ${offenders.join('\n  ')}`);
});
