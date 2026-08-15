'use strict';

// Pins the reviewer-side scope contract (issue #12, WB4/WB5): the dual-axis gate on all three
// reviewer paths (single, dual aggregation, late secondary), the Step 4.5 routing matrix with its
// derived-over-declared recalculations, the scope-field definitions in every prompt surface, the
// field-level dual merge, and the removal of the stale TTL narrative. These are prompt/skill
// documents, so the pins are structural: the sentences ARE the mechanism.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const skill = readFileSync(resolve(root, 'skills/codex-code-review/SKILL.md'), 'utf8');
const common = readFileSync(resolve(root, 'skills/codex-code-review/references/review-common.md'), 'utf8');
const prompts = {
  fast: readFileSync(resolve(root, 'skills/codex-code-review/references/codex-prompt-fast.md'), 'utf8'),
  full: readFileSync(resolve(root, 'skills/codex-code-review/references/codex-prompt-full.md'), 'utf8'),
  branch: readFileSync(resolve(root, 'skills/codex-code-review/references/codex-prompt-branch.md'), 'utf8'),
};

const GATE_REASON_ENUM = 'gate_reason=<NONE|IN_SCOPE_BLOCKING|OUT_OF_SCOPE_CRITICAL|BOTH>';

test('step 1 when collecting metadata → the baseline is frozen once and BASE_BRANCH resolution is total', () => {
  assert.match(skill, /\*\*Scope baseline \(frozen here\)\.\*\*/, 'Step 1 must own the freeze');
  assert.match(skill, /git ls-files --others --exclude-standard/, 'untracked files join the baseline');
  assert.match(skill, /git merge-base \$\{BASE_BRANCH\} HEAD/, 'branch baseline diffs against the merge base');
  assert.match(skill, /git symbolic-ref --short\s+refs\/remotes\/origin\/HEAD/, 'origin HEAD is the second candidate');
  assert.match(skill, /`git rev-parse --verify`/, 'every candidate is verified before use');
  assert.match(skill, /\*\*parameter error\*\*/, 'exhausted candidates abort as a parameter error');
  assert.match(skill, /the abort is not a human exit/);
  assert.match(skill, /never continue on an empty baseline/);
  assert.match(skill, /`SCOPE_BASELINE`/, 'the frozen list is injected by name');
  assert.match(skill, /no path recomputes it/, 'the freeze covers every same-task dispatch');
});

test('single-reviewer gate when derived → dual disjunct with fail-closed normalization first', () => {
  const single = skill.slice(skill.indexOf('**Single reviewer (default dispatch):** Codex\'s findings'));
  assert.match(single, /normalize every finding's scope fields fail-closed/);
  assert.match(single, /in-scope \(incl\. `uncertain`\) finding at or above the tier's blocking severity/);
  assert.match(single, /out-of-scope critical finding \(P0 \/ security \/ data-integrity\) with no valid `\[USER_SKIPPED\]`/);
  assert.match(single, /READY with `gate_reason=NONE`/);
});

test('dual aggregation when merging → per-field conservative rules, USER_SKIPPED after aggregate', () => {
  assert.match(skill, /Normalize each reviewer's findings fail-closed \*\*before\*\* merging/);
  assert.match(skill, /any source `in-scope` or `uncertain` → `in-scope`/);
  assert.match(skill, /`out-of-scope` only when \*\*every\*\* source independently proves it/);
  assert.match(skill, /origin \/ scope_reason: sources conflict → `uncertain`/);
  assert.match(skill, /any source hits → the aggregate keeps the critical domain/);
  assert.match(skill, /evidence: keep all/);
  assert.match(skill, /`\[USER_SKIPPED\]` applies only \*\*after\*\* the aggregate identity forms/);
  // The same three merge outcomes are the reference's contract too — both surfaces must agree.
  assert.match(common, /aggregate `out-of-scope` \*\*only when every source independently proves it\*\*/);
  assert.match(common, /Sources conflict → aggregate `uncertain`/);
  assert.match(common, /never discard it with the losing severity/);
});

test('routing matrix when indexed → seven rows on the derived pair, breaker checked first', () => {
  const matrix = skill.slice(skill.indexOf('| Sentinel × `gate_reason` × breaker |'));
  const rows = matrix.split('\n').filter((l) => l.startsWith('| `')).length
    + matrix.split('\n').filter((l) => l.startsWith('| Contradictory')).length;
  assert.equal(rows, 7, 'the consistency matrix is closed: exactly seven data rows');
  assert.match(matrix, /`✅ Ready` × `NONE` \| The only lawful Ready pairing/);
  assert.match(matrix, /`IN_SCOPE_BLOCKING` × not triggered \| Fix loop/);
  assert.match(matrix, /`IN_SCOPE_BLOCKING` × triggered \| \*\*No fix loop\*\*: human exit E2/);
  assert.match(matrix, /`OUT_OF_SCOPE_CRITICAL` \| `note code_review fail`; \*\*do not fix\*\* — human exit E1/);
  assert.match(matrix, /`BOTH` × not triggered \| E1 first/);
  assert.match(matrix, /the two classes never cancel/);
  assert.match(matrix, /`BOTH` × triggered \| E1 and E2 merge into a \*\*single\*\* Need Human decision point/);
  assert.match(matrix, /treat as `⛔ Blocked` × `BOTH`/);
  assert.match(skill, /"Breaker triggered" is the model's own fix-phase state/,
    'breaker state is model-held, not a reviewer field');
});

test('declared vs derived when recalculated → all four canonical cases are pinned', () => {
  assert.match(skill, /wrapping a real in-scope blocking finding routes as `Blocked × IN_SCOPE_BLOCKING`/);
  assert.match(skill, /wrapping an out-of-scope critical finding with no valid `\[USER_SKIPPED\]` routes as `Blocked × OUT_OF_SCOPE_CRITICAL`/);
  assert.match(skill, /both classes present under a single declared reason derives `Blocked × BOTH`/);
  assert.match(skill, /declared `Blocked` with no blocking finding on either axis routes as `Ready × NONE`/);
  assert.match(skill, /\*\*Route on derived values, never declarations\.\*\*/);
});

test('review loop and late secondary when re-entered → only IN_SCOPE_BLOCKING enters the fix loop', () => {
  assert.match(skill, /enters this loop only through the Step 4\.5 routing matrix/);
  assert.match(skill, /`Blocked × IN_SCOPE_BLOCKING` with the breaker untriggered/);
  assert.match(skill, /a late out-of-scope critical finding is E1, not a silent re-open/);
  assert.match(skill, /blocking finding on either axis/, 'the late-secondary table is dual-axis');
});

test('scope fields when defined → contract present in review-common and every prompt surface', () => {
  assert.match(common, /## Scope Fields \(fail-closed\)/);
  assert.match(common, /out-of-scope ⇔ origin=pre-existing ∧ scope_reason=pre-existing-outside/);
  assert.match(common, /`origin=in-diff ∧ scope=out-of-scope`/, 'the contradiction example is pinned');
  assert.match(common, /never to something looser/);
  for (const [name, text] of Object.entries(prompts)) {
    assert.match(text, /## Scope Baseline \(frozen\)/, `${name}: baseline section missing`);
    assert.match(text, /\$\{SCOPE_BASELINE\}/, `${name}: SCOPE_BASELINE variable missing`);
    assert.match(text, /origin=<in-diff\|pre-existing\|uncertain>/, `${name}: origin enum missing`);
    assert.match(text, /scope_reason=<diff-file\|one-hop\|branch-introduced\|pre-existing-outside\|uncertain>/,
      `${name}: scope_reason enum missing`);
    assert.match(text, /derived, not free/, `${name}: scope must be derived`);
    assert.ok(text.includes(GATE_REASON_ENUM), `${name}: gate_reason enum missing`);
    assert.match(text, /NONE is the only value lawful with ✅ Ready/, `${name}: Ready×NONE pairing missing`);
    assert.match(text, /\[OUT_OF_SCOPE_DEFERRED\] <file:line> \| <issue> \| <suggested-ticket> \| <ISO8601 UTC>/,
      `${name}: deferred-record format missing`);
  }
  // Inline secondary prompt (in SKILL.md) carries the same contract.
  assert.match(skill, /origin=<in-diff\|pre-existing\|uncertain>/);
  assert.ok(skill.includes('gate_reason=<NONE|IN_SCOPE_BLOCKING|OUT_OF_SCOPE_CRITICAL|BOTH>'),
    'inline secondary: gate_reason enum missing');
});

test('re-review template when continued → carries the frozen baseline and active dispositions', () => {
  assert.match(common, /## Scope Baseline \(frozen — unchanged for this task, do NOT recompute\)/);
  assert.match(common, /## Active Dispositions/);
  assert.match(common, /\$\{DISPOSITIONS \|\| 'None'\}/);
  assert.match(common, /judged against the frozen baseline above/);
  assert.match(common, /including the gate_reason line/);
});

// The stale TTL narrative claimed a hook parses and stores NIT_DEFERRED lines — retired by
// hook-lightweighting. Refusal pattern + both-direction fixtures (rules/testing.md § Guards),
// plus a positive control: the replacement sentence must actually be present, so the negative
// assertion cannot be satisfied by an emptied file.
const TTL_PATTERN = /parsed out of this output by a hook|stored with a TTL/;

test('TTL pattern when self-tested → catches the stale narrative and passes the replacement', () => {
  assert.ok(TTL_PATTERN.test('That tag and field order are parsed out of this output by a hook and stored with a TTL.'),
    'guard fixture: the stale sentence must be caught');
  assert.ok(!TTL_PATTERN.test('That tag and field order are a reporting convention — nothing parses or persists the line.'),
    'the replacement sentence must not match');
});

test('prompt templates when scanned → no TTL narrative remains, replacement wording present', () => {
  for (const [name, text] of Object.entries(prompts)) {
    assert.ok(!TTL_PATTERN.test(text), `${name}: stale TTL narrative still present`);
    assert.match(text, /reporting convention.*nothing parses or persists/s,
      `${name}: replacement wording missing — the negative assertion above would be vacuous`);
  }
});
