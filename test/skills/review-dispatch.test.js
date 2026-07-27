const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, statSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Supersedes dual-reviewer-loop.test.js, which pinned the inverse contract: dual dispatch on
// every cycle with "no skip exception". Dual is now opt-in on the branch variant only, so those
// assertions were not merely stale — they asserted the behaviour this suite forbids.

// --- rules/auto-loop.md: the four behavioural anchors ---

test('auto-loop.md keeps all four behavioural anchors', () => {
  const content = read('rules/auto-loop.md');
  for (const anchor of ['Declaring ≠ Executing', 'Summary ≠ Completion', 'Fixing ≠ Verifying', 'Same reply']) {
    assert.ok(content.includes(anchor), `anchor "${anchor}" must survive any rewrite of auto-loop.md`);
  }
});

test('auto-loop.md still forbids self-assessment as evidence of a fix', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /Self-assessment is not evidence/,
    'Fixing ≠ Verifying is only enforceable if the rule says re-running the review is required');
});

// --- rules/auto-loop.md: single reviewer is the default ---

test('auto-loop.md declares a single reviewer as the default everywhere', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /One reviewer — Codex — everywhere by default/,
    'the default dispatch must be stated, not implied');
  assert.match(content, /must not launch a secondary/,
    'fast and doc variants must be explicitly barred from launching a secondary');
});

test('auto-loop.md scopes --dual to the branch variant and defaults it off', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /\/codex-review-branch --dual` only, off unless the flag is passed/,
    '--dual must be named as branch-only and off by default');
});

test('auto-loop.md keeps Cycle reset binding on the single reviewer', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /Cycle reset/, 'Cycle reset row must survive');
  assert.match(content, /the reviewer must re-run regardless of prior pass status/,
    'an edit must invalidate a prior pass — this is what stops a stale ✅ carrying the gate');
});

test('auto-loop.md keeps Loop re-review on the same Codex thread', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /Loop re-review/, 'Loop re-review row must survive');
  assert.match(content, /`--continue` re-dispatches Codex on the same thread/,
    'thread continuity is what makes a loop round cheaper than a fresh review');
});

// --- rules/auto-loop.md: tiers ---

test('auto-loop.md tier table defines all three tiers with blocking severity and round cap', () => {
  const content = read('rules/auto-loop.md');
  const rows = [
    [/\| `fast` \|.*\| P0 \| 3 \|/, 'fast: blocks on P0, cap 3'],
    [/\| `standard` \*\*\(default\)\*\* \|.*\| P0, P1 \| 5 \|/, 'standard: blocks on P0/P1, cap 5'],
    [/\| `thorough` \|.*\| P0, P1, P2 \| 30 \|/, 'thorough: blocks on P0/P1/P2, cap 30'],
  ];
  for (const [re, label] of rows) {
    assert.match(content, re, `tier table must state ${label}`);
  }
});

test('auto-loop.md states 80 is a passing grade', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /\*\*80 is a passing grade\.\*\*/,
    'the cost/completeness trade-off must be stated, or standard drifts back toward thorough');
  assert.match(content, /the correct move is `\/precommit`, not another round/,
    'the rule must name the action, not just the sentiment');
});

test('auto-loop.md escalates security and data-integrity changes regardless of configured tier', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /security or data-integrity change is treated as `thorough`/,
    'tiers must not become a way to under-review a security change');
});

// --- rules/auto-loop.md: the deferral sentinel is a hook contract ---

test('auto-loop.md pins the hook-parsed NIT_DEFERRED tag and field order', () => {
  const content = read('rules/auto-loop.md');
  assert.ok(
    content.includes('[NIT_DEFERRED] file:line | issue | reason: sub-threshold-<severity> | <ISO8601>'),
    'the sentinel is parsed at column 0 by post-tool-review-state.sh; a different tag or field '
    + 'order is silently dropped, so the deferral would not survive the session',
  );
  assert.match(content, /hook-parsed at column 0/,
    'the rule must say WHY the exact shape matters, or the next rewrite will prettify it');
});

test('post-tool-review-state.sh still parses the tag auto-loop.md tells the model to emit', () => {
  const hook = read('hooks/post-tool-review-state.sh');
  assert.match(hook, /grep '\^\\\[NIT_DEFERRED\\\]'/,
    'producer and parser must agree; this pair is the whole reason the tag was not renamed');
});

// --- rules/auto-loop.md: sub-threshold findings do not re-open the loop ---

test('auto-loop.md sub-threshold table maps each tier to what it defers', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /\| `fast` \| P0 \| P1, P2, Nit \|/, 'fast defers P1 and below');
  assert.match(content, /\| `standard` \| P0, P1 \| P2, Nit \|/, 'standard defers P2 and below');
  assert.match(content, /\| `thorough` \| P0, P1, P2 \| Nit \|/, 'thorough defers Nit only');
});

test('auto-loop.md forbids an extra sweep round on a passing gate', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /No extra fix pass, no extra re-review/,
    'the P2/Nit sweep was the largest source of extra rounds; its removal must be explicit');
});

// --- rules/auto-loop.md: size discipline ---

test('auto-loop.md stays small enough to be read rather than skimmed', () => {
  const bytes = statSync(resolve(root, 'rules/auto-loop.md')).size;
  assert.ok(
    bytes <= 20000,
    `rules/auto-loop.md is ${bytes} bytes; it is imported via @ into every session, so hook `
    + 'internals belong in docs/features/auto-loop-evolution/4-implementation.md, not here. '
    + 'It was 46204 bytes when 71% of it was lock protocols and parser archaeology the model '
    + 'cannot act on. If this fails, move the new prose out rather than raising the ceiling.',
  );
});

test('the hook-internals doc that absorbed the moved prose exists and is linked', () => {
  const doc = 'docs/features/auto-loop-evolution/4-implementation.md';
  assert.ok(existsSync(resolve(root, doc)), `${doc} must exist — auto-loop.md links to it`);
  const content = read('rules/auto-loop.md');
  assert.match(content, /docs\/features\/auto-loop-evolution\/4-implementation\.md/,
    'the shrink is only safe if the rule points at where the reasoning went');
});

// --- installed copy ---

test('.claude/rules/auto-loop.md is in sync with rules/auto-loop.md', {
  skip: !existsSync(resolve(root, '.claude/rules/auto-loop.md')),
}, () => {
  assert.equal(read('rules/auto-loop.md'), read('.claude/rules/auto-loop.md'),
    '.claude/rules/auto-loop.md should match rules/auto-loop.md byte for byte');
});

// --- skills/codex-code-review/SKILL.md ---

test('SKILL.md gates the secondary reviewer behind --dual', () => {
  const content = read('skills/codex-code-review/SKILL.md');
  assert.match(content, /Secondary reviewer — `--dual` only, skip entirely otherwise/,
    'the secondary must be skipped, not merely deprioritised, in the default mode');
});

test('SKILL.md does not emit the aggregate gate in single mode', () => {
  const content = read('skills/codex-code-review/SKILL.md');
  assert.match(content, /Do not run `scripts\/emit-review-gate\.sh`/,
    'emitting it sets review_mode=dual, which forces stop-guard into strict for the session');
  assert.match(content, /\*\*`--dual` only\*\* — execute `bash scripts\/emit-review-gate\.sh READY`/,
    'Step 4.5 must be scoped to --dual');
});

test('SKILL.md refuses to substitute a subagent when Codex is unavailable in single mode', () => {
  const content = read('skills/codex-code-review/SKILL.md');
  assert.match(content, /nothing to degrade to/,
    'in single mode the one reviewer IS the gate; silently swapping it changes what the gate means');
});

test('SKILL.md still requires a late secondary P0/P1 to re-open the loop', () => {
  const content = read('skills/codex-code-review/SKILL.md');
  assert.doesNotMatch(content, /late result is advisory log/,
    'a late secondary finding must re-open the fix loop, not be logged and ignored');
});

// --- skills/codex-code-review/references/review-common.md ---

test('review-common.md marks the whole dual aggregation section as opt-in', () => {
  const content = read('skills/codex-code-review/references/review-common.md');
  assert.match(content, /## Dual Reviewer Aggregation \(opt-in\)/,
    'the heading itself must carry the scope, or the section reads as standard procedure');
  assert.match(content, /applies only under `\/codex-review-branch --dual`/,
    'the scope must be stated in prose too — headings get skimmed');
});

test('review-common.md keeps the pre-precommit reconciliation checkpoint for dual mode', () => {
  const content = read('skills/codex-code-review/references/review-common.md');
  assert.match(content, /pre-precommit checkpoint/,
    'without the checkpoint a background secondary can land findings after the gate closed');
});

test('review-common.md ties the merge gate to the tier rather than a fixed severity', () => {
  const content = read('skills/codex-code-review/references/review-common.md');
  assert.match(content, /decided by the \*\*tier's blocking severity\*\*/,
    'a hard-coded P0/P1 gate contradicts the tier table');
});

// --- variant skills ---

test('branch variant documents --dual as an off-by-default flag', () => {
  const content = read('skills/codex-review-branch/SKILL.md');
  assert.match(content, /\| `--dual` \| off \|/, 'the flags table must show the default is off');
  // Scoped to code review on purpose: `/plan-review --dual` is a second dual entry point in a
  // different loop, so an unqualified "only place in the plugin" claim is false and was.
  assert.match(content, /only code-review entry point where two reviewers run/,
    'the branch variant must be named as the sole dual entry point for code review');
  assert.match(content, /plan-review --dual/,
    'and must point at the plan-mode counterpart so the scoping is not read as an oversight');
});

test('fast and full variants offer no dual option at all', () => {
  for (const p of ['skills/codex-review-fast/SKILL.md', 'skills/codex-review/SKILL.md']) {
    const content = read(p);
    assert.match(content, /no `--dual`, no secondary/, `${p} must rule out a secondary reviewer`);
  }
});

// --- reviewer prompt calibration ---

test('every code review prompt calibrates severity in both directions', () => {
  const prompts = [
    'skills/codex-code-review/references/codex-prompt-fast.md',
    'skills/codex-code-review/references/codex-prompt-full.md',
    'skills/codex-code-review/references/codex-prompt-branch.md',
  ];
  for (const p of prompts) {
    const content = read(p);
    assert.match(content, /### Calibration/, `${p} must define what earns a blocking severity`);
    assert.match(content, /could it be \*less\* than you assessed/,
      `${p} severity check must be bidirectional — an upward-only ratchet inflates every finding `
      + 'to P1 and makes the round cap the only exit');
    assert.match(content, /concrete failure path/,
      `${p} must require a describable failure path before a finding blocks`);
  }
});

test('code review prompts state that finding nothing blocking is a normal result', () => {
  for (const p of [
    'skills/codex-code-review/references/codex-prompt-fast.md',
    'skills/codex-code-review/references/codex-prompt-full.md',
  ]) {
    // Phrased tier-neutrally on purpose: the gate is ${BLOCKING}, so pinning "no P0/P1"
    // would contradict the same prompt's Merge Gate under `fast` and `thorough`.
    assert.match(read(p), /No blocking finding is a normal, common result/,
      `${p} must say so, or the reviewer promotes its strongest sub-threshold item to fill the section`);
  }
});

test('doc review prompt calibrates what earns a blocking mark', () => {
  const content = read('skills/doc-review/references/codex-prompt-doc.md');
  assert.match(content, /## Severity Calibration/, 'doc review needs the same calibration as code review');
  assert.match(content, /mislead a reader into doing the wrong thing/,
    'the 🔴 bar must be defined by consequence, not by taste');
  assert.match(content, /If you are unsure whether something is 🔴, it is not/,
    'the tie-break must be stated, or uncertainty resolves upward');
});

test('doc review loop does not re-open on sub-threshold findings', () => {
  const skill = read('skills/doc-review/SKILL.md');
  assert.match(skill, /\*\*🔴 only\.\*\* 🟡 and ⚪ are non-blocking/,
    'doc loop must block on 🔴 alone');
  const loop = read('skills/doc-review/references/review-loop-doc.md');
  assert.match(loop, /Do not re-raise the previous round's\n🟡\/⚪ items/,
    're-review must not re-surface deferred items — that is how a doc loop buys extra rounds');
});
