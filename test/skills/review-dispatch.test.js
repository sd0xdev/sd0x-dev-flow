const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, statSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Supersedes dual-reviewer-loop.test.js, which pinned the inverse contract: dual dispatch on
// every cycle with "no skip exception". Dual is now opt-in on the branch variant only, so those
// assertions were not merely stale — they asserted the behaviour this suite forbids.

// --- rules/auto-loop.md: the terminal invariant and its corollaries ---
// R3 replaced the imperative "same reply" choreography with a terminal completion invariant;
// the three corollaries below are what survive of the old behavioural anchors.

test('auto-loop.md states the terminal completion invariant and its corollaries', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /Terminal completion invariant/,
    'the invariant is the load-bearing sentence — a rewrite must keep it named');
  assert.match(content, /every gate its change class requires has passed after the last edit in that gate's change class/,
    'the invariant must bind completion to per-plane freshness — the planeless wording was a doc-review finding');
  assert.match(content, /a doc edit re-opens the doc gate, not the code gates/,
    'the per-plane separation must stay spelled out, matching hook receipt invalidation');
  for (const anchor of ['Declaring ≠ Executing', 'Summary ≠ Completion', 'Fixing ≠ Verifying']) {
    assert.ok(content.includes(anchor), `corollary "${anchor}" must survive any rewrite of auto-loop.md`);
  }
});

test('auto-loop.md contains no same-reply imperative (AC1 negative pin)', () => {
  const content = read('rules/auto-loop.md');
  assert.ok(!/same reply/i.test(content),
    'the "same reply" choreography was removed by R3 — the invariant constrains the end state, not timing');
});

test('auto-loop.md keeps the human-escalation exits (AC2: 人工升級)', () => {
  const content = read('rules/auto-loop.md');
  assert.match(content, /max_rounds.*Need Human|Need Human.*max_rounds/,
    'hitting the round cap must route to a human, not loop forever');
  assert.match(content, /Architecture-level changes, feature removal, or the user asking to stop/,
    'the three unconditional human exits must survive any rewrite');
});

test('CLAUDE.template.md keeps the {TEST_COMMAND} placeholder unbaked (AC3)', () => {
  // Anchored to the operational Development Rules line, not just any occurrence: the placeholder
  // also appears in the customization table, so a bare /\{TEST_COMMAND\}/ stays green even after
  // the rule line itself is baked to a concrete command.
  const template = read('CLAUDE.template.md');
  assert.match(template, /^2\. \*\*Test command\*\* -- `\{TEST_COMMAND\}`$/m,
    'the template ships to host projects — the test-command rule line must stay a placeholder, not this repo\'s find-form');
});

test('comments-only honesty stays in sync between CLAUDE.md and hooks/stop-check.md (AC8)', () => {
  // Both surfaces must state the conservative classification; the old "comments-only skips all
  // gates" promise had zero implementation behind it and was removed by R3.
  for (const file of ['CLAUDE.md', 'hooks/stop-check.md']) {
    const content = read(file);
    assert.match(content, /conservatively classified as code/,
      `${file} must state that comment-only edits to code files stay classified as code`);
    // Structural rejection of ANY comments-only table row — the historical row was
    // `| Comments only | - | All |`, which contains no "Skip" wording to key on.
    assert.ok(!/^\|\s*Comments only\s*\|/mi.test(content),
      `${file} must not resurrect the unimplemented comments-only free-pass row`);
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

// --- review_mode persistence: the docs must describe the lifetime the code actually implements ---
//
// R1 (docs/features/auto-loop-autonomy/requests/2026-07-26-dual-mode-signal-repair-r1.md) found
// three authoritative places claiming `--dual` forces strict "for the rest of the session". It does
// not: SessionStart rewrites the receipts but leaves `review_mode` alone, and no downgrade
// transition exists anywhere, so one `--dual` pins every later session into strict.

const DUAL_LIFETIME_DOCS = [
  'skills/codex-review-branch/SKILL.md',
  'skills/codex-code-review/SKILL.md',
  'skills/codex-code-review/references/review-common.md',
];

test('no dual-mode doc claims the strict escalation is session-bounded', () => {
  for (const file of DUAL_LIFETIME_DOCS) {
    assert.doesNotMatch(read(file), /rest of the session/,
      `${file}: "for the rest of the session" is false — SessionStart preserves review_mode`);
  }
});

test('every dual-mode doc states the real persistence boundary and the absent downgrade', () => {
  for (const file of DUAL_LIFETIME_DOCS) {
    const content = read(file);
    assert.match(content, /until the state file is rebuilt or/,
      `${file}: must name the boundary that actually ends the escalation`);
    assert.match(content, /no supported `dual → single` downgrade|there is no supported `dual → single` downgrade/,
      `${file}: a reader who is told the escalation persists will look for a way out — say there is none`);
  }
});

test('no dual-mode doc claims a default invocation leaves the effective mode single', () => {
  // Dispatch and effective enforcement state are different facts, and the docs used to conflate
  // them: "`review_mode` stays at its initialized value" reads as a guarantee about the CURRENT
  // state when it is only true of a state that never saw `--dual`. That mattered because the same
  // sentence promised `code_review.passed` governs the gate — a recovery path stop-guard will not
  // honour while a persisted dual is in force, so a reader following it loops.
  for (const [file, retracted] of [
    ['skills/codex-code-review/SKILL.md', /`review_mode` stays at its initialized value/],
    ['skills/codex-code-review/references/review-common.md', /in which case `review_mode` stays/],
  ]) {
    assert.doesNotMatch(read(file), retracted,
      `${file}: reasserted an unconditional "stays single" claim about the effective mode`);
  }
  assert.match(read('skills/codex-code-review/SKILL.md'),
    /Emitting no transition is not the same as returning to single/,
    'SKILL.md must keep the distinction that makes the default-mode paragraph true');
  const reviewCommon = read('skills/codex-code-review/references/review-common.md');
  assert.match(reviewCommon, /does not reset (a persisted `review_mode=dual`|it)/,
    'review-common.md must say the default path cannot discharge an inherited dual gate');
  assert.match(reviewCommon, /no downgrade exists/,
    'and that there is no way back — otherwise a reader assumes one exists and waits for it');
  // The field is not the only trigger, and this is the assertion that says so. A marker can arm the
  // gate while `review_mode` still reads single, so a reader checking only the field concludes
  // "single, done" and loops against a gate that will not open. The marker and the mode are written
  // on independent paths with opposite orderings — see review-common.md § Aggregate-Plane Writes.
  for (const file of [
    'skills/codex-code-review/SKILL.md',
    'skills/codex-code-review/references/review-common.md',
  ]) {
    assert.match(read(file), /`aggregate_write_failed`.*`lock_failure`|`lock_failure`.*`aggregate_write_failed`/s,
      `${file}: must name the marker case, not just the review_mode field`);
  }
});

test('the docs call cross-session dual persistence a defect, not a feature', () => {
  // "That is the point of asking for it" attached to the persistence sentence characterized a
  // known defect as intended behaviour — the opposite of what the R1 ticket records.
  assert.match(read('skills/codex-code-review/SKILL.md'), /known defect/i,
    'SKILL.md must not present persistence beyond the requesting session as a feature to rely on');
});

test('review_mode writes keep the initialize-single / transition-only-to-dual invariant', () => {
  // The claim in the docs above is only true while this holds. Pinning "exactly two write sites"
  // would be the wrong invariant — it breaks on a harmless refactor and says nothing about
  // direction. What matters is the SHAPE: constructors seed `single`, every write to an existing
  // state moves to `dual`, and nothing moves back.
  //
  // Scanned repo-wide, not over a hard-coded file list: a downgrade added in a new hook, in
  // `scripts/`, or in a file nobody thought to enumerate is exactly the case a fixed list misses.
  // `{recursive: true}` without `withFileTypes` yields relative path STRINGS, which sidesteps the
  // Dirent.parentPath/Dirent.path rename across Node versions — this suite has to run on whatever
  // the host ships.
  const shellSources = ['hooks', 'scripts']
    .flatMap((dir) => readdirSync(resolve(root, dir), { recursive: true })
      .filter((p) => /\.(sh|js)$/.test(p))
      .map((p) => `${dir}/${p}`));
  assert.ok(shellSources.length > 10, 'source enumeration collapsed — the guard would go vacuous');

  // Constructors: the literal sits inside the initial-state JSON template, so it is a seed, not a
  // transition. Both writer hooks carry their own copy of that template.
  for (const file of ['hooks/post-tool-review-state.sh', 'hooks/post-edit-format.sh']) {
    assert.match(read(file), /"review_mode":\s*"single",/,
      `${file}: the initial-state template must still seed review_mode to single`);
  }

  // Transitions against an existing state. Three shapes, because a downgrade need not be a literal
  // assignment: `.review_mode = X` (any value, quoted or a jq variable), `setpath(["review_mode"];…)`
  // and `del(.review_mode)` — deleting the field is a downgrade, since every reader defaults it to
  // single. A variable-valued write is unresolvable here, so it fails rather than being waved past:
  // the invariant is "only ever dual", and a value this guard cannot read is not proof of that.
  let transitions = 0;
  for (const file of shellSources) {
    const src = read(file);
    for (const m of src.matchAll(/\.review_mode\s*=\s*(?!=)(\$?\w+|"[^"]*")/g)) {
      transitions += 1;
      assert.equal(m[1], '"dual"',
        `${file}: transition writing ${m[1]} — anything but a literal "dual" is a downgrade path, `
          + 'or a value this guard cannot verify, and the docs promise neither exists');
    }
    assert.doesNotMatch(src, /setpath\(\s*\[\s*"review_mode"/,
      `${file}: setpath into review_mode bypasses the assignment form this guard reads`);
    assert.doesNotMatch(src, /del\(\s*\.review_mode\s*\)/,
      `${file}: deleting review_mode is a downgrade — every reader defaults the absent field to single`);
  }
  assert.ok(transitions >= 2,
    `only ${transitions} review_mode transitions found repo-wide; the known writers are `
      + 'post-tool-review-state.sh PENDING + aggregate-blocked fallback — fewer means the pattern moved');

  // SessionStart preserves the field. Pinned behaviourally in test/hooks/session-init.test.js
  // ("KNOWN DEFECT — session-init does NOT reset review_mode"); pinned textually here so a reset
  // added to the jq transaction fails in both places at once.
  assert.doesNotMatch(read('hooks/session-init.sh'), /\.review_mode\s*=/,
    'session-init resetting review_mode would invalidate the persistence claim in all three docs');
});
