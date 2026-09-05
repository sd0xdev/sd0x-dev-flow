'use strict';

// Contract pins for review-loop-resilience (2026-08-23): thread rotation + contract-aware
// fallback. Spec: docs/features/review-loop-resilience/2-tech-spec.md §6 row 3.
//
// Each "must not say X" assertion ships with a positive control proving the detector detects
// (rules/testing.md § Guards): delete the guard and the control below it goes red.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const autoLoop = read('rules/auto-loop.md');
const codexInvocation = read('rules/codex-invocation.md');
const reviewCommon = read('skills/codex-code-review/references/review-common.md');
const codeSkill = read('skills/codex-code-review/SKILL.md');
const scaffold = read('rules/auto-loop-project.md');
const claudeRoot = read('CLAUDE.md');
const claudeTemplate = read('CLAUDE.template.md');
// .claude/CLAUDE.md is a gitignored local mirror — a clean checkout does not have it, so it is
// asserted on only where present. The tracked surfaces (CLAUDE.md + CLAUDE.template.md) are the
// contract; the mirror check just catches local drift.
const claudeDotPath = resolve(root, '.claude/CLAUDE.md');
const claudeDot = existsSync(claudeDotPath) ? readFileSync(claudeDotPath, 'utf8') : null;
const docLoop = read('skills/doc-review/references/review-loop-doc.md');
const planLoop = read('skills/plan-review/references/review-loop-plan.md');
const planSkill = read('skills/plan-review/SKILL.md');
const testSkill = read('skills/test-review/SKILL.md');
const testPrompt = read('skills/test-review/references/codex-prompt-test-review.md');
const acTracePrompt = read('skills/test-review/references/codex-prompt-ac-trace.md');
const docSkill = read('skills/doc-review/SKILL.md');

// ── rules/auto-loop.md § Review Dispatch: the policy actually flipped ──────

test('auto-loop.md no longer carries the old unavailable-is-Need-Human policy', () => {
  assert.ok(!autoLoop.includes('never a gate verdict'),
    'the advisory-only sentence must be gone — fallback verdicts are real gate verdicts now');
  assert.ok(!autoLoop.includes('not a fallback'),
    'the "Codex unavailable is not a fallback" framing must be gone');
  // Positive control for the detector: the phrases are detectable when present.
  assert.ok(('x never a gate verdict x').includes('never a gate verdict'));
});

test('auto-loop.md states the new fallback contract: contract-aware, sticky, fail-closed, Priority 4', () => {
  assert.match(autoLoop, /contract-aware fallback reviewer carries the gate/);
  assert.match(autoLoop, /sticky per change/i, 'per-change stickiness (no re-probe mid-loop)');
  assert.match(autoLoop, /validate-family-sentinel\.js/, 'fail-closed raw validation is named');
  assert.match(autoLoop, /review-dispatch\.js/, 'the decision module is named');
  assert.match(autoLoop, /never translated across contracts/, 'the no-translation clause');
  assert.match(autoLoop, /no validated verdict exists/i,
    'Priority 4: no forged verdict — carriers may have run, but nothing survived validation');
  assert.ok(!autoLoop.includes('no reviewer ran, so no verdict exists'),
    'the old "no reviewer ran" framing must be gone (a carrier can run and still fail the contract)');
  assert.match(autoLoop, /skills\/codex-code-review\/references\/review-common\.md/,
    'the central-contract pointer is written as the full path');
  assert.match(autoLoop, /\[REVIEWER_FALLBACK\] plane=<plane> from=codex to=<agent> reason=<quota\|timeout\|error> \| <ISO8601>/,
    'the record format is pinned');
  assert.match(autoLoop, /necessity-audit is excluded from both fallback and rotation in v1/,
    'the v1 necessity exclusion is stated');
  assert.match(autoLoop, /`seek-verdict` stays non-gate/, 'seek-verdict stays outside the gate');
});

test('auto-loop.md Priority 4 forges no sentinel: plan uses its own degraded form, the rest emit nothing', () => {
  assert.match(autoLoop, /plan emits `\[PLAN_REVIEW_DEGRADED\]` only/);
  assert.match(autoLoop, /the rest emit nothing/);
});

test('auto-loop.md § Override Contract and the scaffold both carry ## Review Thread Rotation', () => {
  assert.match(autoLoop, /\| `## Review Thread Rotation` \| Setting —[^|]*\| Default \|/);
  assert.match(scaffold, /^## Review Thread Rotation$/m);
  assert.match(scaffold, /Range 2-6[\s\S]*?Unset = 3/, 'the scaffold documents range and default');
});

// ── review-common.md: central rotation contract + Degradation Matrix rewrite ──

test('review-common.md carries the rotation central contract (R-a / R-b / procedure / record)', () => {
  assert.match(reviewCommon, /### Thread Rotation \(central contract\)/);
  assert.match(reviewCommon, /R-a[\s\S]*?\*\*3\*\* reply re-reviews/, 'R-a threshold 3');
  assert.match(reviewCommon, /`review-state\.js`'s `rounds` does \*\*not\*\* participate/,
    'review-state rounds explicitly excluded (no threadId, cross-thread)');
  assert.match(reviewCommon, /R-b[\s\S]*?judged too long/, 'R-b context judgment');
  assert.match(reviewCommon, /\[THREAD_ROTATED\] plane=<plane> old=<threadId> new=<threadId> reason=<rounds\|context> \| <ISO8601>/,
    'the record format is pinned');
  assert.match(reviewCommon, /never enter the new prompt/, 'old findings/dispositions stay out of the fresh prompt');
  assert.match(reviewCommon, /one-thread-per-batch is unchanged/, 'the batch invariant survives rotation');
  assert.match(reviewCommon, /Stall streaks and round caps are \*\*not\*\* reset/,
    'rotation must not launder the change-level budgets');
  assert.match(reviewCommon, /`necessity` is \*\*excluded in v1\*\*/);
});

test('review-common.md Degradation Matrix: Codex-down rows carry the gate via fallback, aggregation intact', () => {
  assert.ok(!reviewCommon.includes('secondary cannot carry the gate'),
    'the old advisory row must be gone');
  assert.match(reviewCommon, /\| Codex ❌ → carrier report passes validation \| \*\*Fallback carries the gate\*\*/);
  assert.match(reviewCommon, /\| Codex ❌ → carrier report fails validation \| That dispatch failed — move to the next carrier/,
    'a failing carrier report advances the chain, it does not exhaust it');
  assert.match(reviewCommon, /`fallback:<agent>`/, 'gate_source=fallback:* exists');
  assert.match(reviewCommon, /\| Codex ❌ \+ every fallback carrier invalid\/exhausted \(independent of secondary status\) \| Priority 4: \*\*no validated verdict exists\*\*/,
    'exhaustion is a carrier-chain state — the secondary neither advances nor exhausts it');
  assert.ok(!reviewCommon.includes('| Both ❌ |'),
    'the old two-reviewer exhaustion label must be gone — it skipped the P2/P3 carriers');
  assert.match(reviewCommon, /`--dual` aggregation semantics above[\s\S]*?are untouched/,
    'only the two Codex-down rows were replaced');
  assert.match(reviewCommon, /\| \*\(fallback — record-level, not a finding tag\)\*/,
    'Source Attribution documents fallback provenance as record-level');
  assert.ok(!reviewCommon.includes('| `fallback` | Found by the fallback reviewer'),
    'the per-finding fallback tag promise must be gone — no carrier prompt requests it (doc round-5)');
  assert.match(reviewCommon, /gate_source=fallback:<agent>` plus the `\[REVIEWER_FALLBACK\]` record/,
    'provenance rides on gate_source + the record, not finding tags');
});

test('review-common.md Degradation Matrix is the all-family central authority with the carrier table', () => {
  assert.match(reviewCommon, /central degradation authority for \*\*every family\*\*/,
    'the section no longer self-declares --dual scope');
  assert.ok(!reviewCommon.includes('This whole section applies only under'),
    'the dual-only whole-section declaration must be gone — it contradicted the all-family matrix');
  assert.match(reviewCommon, /One subsection is expressly exempt from that scope: § Degradation Matrix/,
    'positive control: the parent section names the exemption');
  assert.match(reviewCommon, /`FALLBACK_CARRIERS`/,
    'the carrier order is anchored to scripts/lib/review-dispatch.js');
  assert.match(reviewCommon, /\| `code` \| Codex exec \| `strict-reviewer`[^|]*\| `pr-review-toolkit:code-reviewer`/,
    'the code carrier row matches FALLBACK_CARRIERS');
  assert.match(reviewCommon, /`doc` \/ `plan` \/ `test:coverage` \/ `test:ac-trace` \| Codex exec \| `contract-neutral-reviewer`/,
    'the non-code carrier row matches FALLBACK_CARRIERS');
});

test('review-common.md loop has three executable paths; the old "just Codex" absolute is gone', () => {
  assert.ok(!reviewCommon.includes('the loop is just Codex'),
    'the pre-resilience absolute must be gone — rotate and fallback are real paths now');
  assert.match(reviewCommon, /three executable paths/,
    'positive control: the continue / rotate / fallback enumeration exists');
  assert.match(reviewCommon, /On the \*\*Codex-healthy path\*\* the Codex gate is authoritative/,
    'dual timing authority is qualified to the Codex-healthy path');
});

test('test-review sentinel table no longer reads exhaustion as a derivable gate', () => {
  const testingRules = read('rules/testing.md');
  for (const [name, text] of [['test-review SKILL', testSkill], ['rules/testing.md', testingRules]]) {
    assert.ok(!text.includes('Codex unavailable or inconclusive'),
      `${name}: the old Need-Human meaning must be gone — a fallback carrier is not "Codex unavailable"`);
    assert.match(text, /Every carrier exhausted/,
      `${name}: positive control — the carrier-exhaustion meaning exists`);
  }
  assert.match(testSkill, /no raw or public AC gate sentinel is derived/,
    'ac-trace exhaustion derives no public sentinel — behaviour-layer Need Human only');
});

// ── codex-invocation.md: the loop exception narrowed to the thread ─────────

test('codex-invocation.md scopes the reply exception to the same thread; rotation restarts the full contract', () => {
  assert.match(codexInvocation, /continuing \*\*the same thread\*\*/);
  assert.match(codexInvocation, /the exception is scoped to the thread, never to the task/);
  assert.match(codexInvocation, /the new thread's first dispatch is a \*\*first dispatch\*\*/);
  assert.match(codexInvocation, /Old-thread findings and dispositions never enter the new prompt/);
});

// ── CLAUDE.md ×2: the one-line sync ────────────────────────────────────────

test('the tracked CLAUDE surfaces carry the same fallback sentence in § Auto-Loop', () => {
  const line = /One reviewer — Codex — by default; when Codex is unavailable, a contract-aware fallback reviewer carries the gate under the same mechanism, fail-closed per family contract \(@rules\/auto-loop\.md § Review Dispatch\); `--dual` is `\/codex-review-branch` opt-in only\./;
  assert.match(claudeRoot, line);
  assert.match(claudeTemplate, line,
    'CLAUDE.template.md is what /project-setup installs — stale policy here propagates to every consuming project');
  if (claudeDot !== null) assert.match(claudeDot, line, 'local .claude/CLAUDE.md mirror has drifted');
});

// ── consumption points: every loop template points at the central contract ──

test('each family loop template points at the central rotation contract', () => {
  for (const [name, doc] of [
    ['review-loop-doc.md', docLoop],
    ['review-loop-plan.md', planLoop],
    ['test-review/SKILL.md', testSkill],
    ['codex-prompt-test-review.md', testPrompt],
    ['codex-prompt-ac-trace.md', acTracePrompt],
    ['codex-code-review/SKILL.md', codeSkill],
  ]) {
    assert.match(doc, /review-common\.md.{0,80}(Thread Rotation|Review Loop)/s,
      `${name} must point at the central contract`);
    assert.match(doc, /\[THREAD_ROTATED\]/, `${name} must name the rotation record`);
  }
});

// ── live branches rewired to the new policy ────────────────────────────────

test('Codex-down secondary policy: no clause routes a secondary through Step 4.5 on its own (doc round-6)', () => {
  // The unsafe route: a secondary-only ✅ Ready hitting Step 4.5's Ready×NONE row would note
  // pass and close a Priority-4 gate no validated carrier ever carried.
  assert.ok(!codeSkill.includes('routes through Step 4.5 independently'),
    'the stale independent-routing clause must be gone everywhere in the skill');
  assert.match(codeSkill, /Codex-down secondary policy/,
    'the replacement policy is named');
  assert.match(codeSkill, /a secondary `✅ Ready` is advisory and notes \*\*nothing\*\*/,
    'secondary Ready never notes');
  assert.match(codeSkill, /indexed only by the gate carrier's own report, never by a secondary's/,
    'Step 4.5 Ready×NONE is reserved for the gate carrier');
});

test('plan-review no longer degrades straight to [PLAN_REVIEW_DEGRADED]; fallback dispatch comes first', () => {
  assert.ok(!planSkill.includes('nothing to degrade to'),
    'the old direct-degradation clause must be gone');
  assert.match(planSkill, /contract-neutral-reviewer/, 'the fallback carrier is named');
  assert.match(planSkill, /validate-family-sentinel\.js plan/, 'plan-contract validation is named');
  assert.match(planSkill, /every.{0,20}carrier.{0,20}exhausted/is,
    'DEGRADED is reserved for exhaustion');
  // The marker itself must survive — it is still the terminal degraded form.
  assert.match(planSkill, /\[PLAN_REVIEW_DEGRADED\]/);
});

test('test-review: Codex-unavailable rides the fallback first, Claude-only inconclusive only on exhaustion', () => {
  assert.match(testSkill, /contract-neutral-reviewer/);
  assert.match(testSkill, /validate-family-sentinel\.js test:coverage/);
  assert.match(testSkill, /validate-family-sentinel\.js test:ac-trace/);
  assert.match(testSkill, /\| Carriers exhausted \| No validated raw report exists/,
    'the exhaustion row derives nothing — behaviour-layer Need Human only, no Claude-only sentinel');
});

test('doc-review: dispatch section carries the fallback branch and the grant is explained', () => {
  // The trigger invariant is Guard 5's (codex-transport-guards.test.js), not this file's: the
  // ticket freezes this file to the two carrier-label changes. Pin only that a fallback branch
  // exists here.
  assert.match(docSkill, /fallback carries the gate/);
  assert.match(docSkill, /validate-family-sentinel\.js doc/);
  assert.match(docSkill, /the boundary is now behavioural/,
    'the rewritten :69 paragraph explains why node is granted now');
});

test('codex-code-review Step 3.5: fallback branch with named steps and the code priority order', () => {
  assert.ok(!codeSkill.includes('nothing to degrade to'),
    'the old dead-end clause must be gone');
  assert.match(codeSkill, /\| 2 \| `strict-reviewer` \|/, 'P2 is the repo-owned pinned agent');
  assert.match(codeSkill, /\| 3 \| `pr-review-toolkit:code-reviewer` \|/, 'P3 is the plugin agent');
  assert.match(codeSkill, /MUST explicitly request `model: opus`, `effort: high`/,
    'the unpinnable carrier gets its depth asked for at the call-site');
  assert.match(codeSkill, /validate-family-sentinel\.js code/);
});

// ── frontmatter additions ──────────────────────────────────────────────────

test('doc-review and test-review frontmatters gained Task and Bash(node:*)', () => {
  for (const [name, doc] of [['doc-review', docSkill], ['test-review', testSkill]]) {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(doc)[1];
    assert.match(fm, /allowed-tools:.*Bash\(node:\*\)/, `${name}: Bash(node:*)`);
    assert.match(fm, /allowed-tools:.*Task/, `${name}: Task`);
  }
});

// ── coverage alias union + ac-trace raw→public mapping ─────────────────────

test('test-review states the coverage alias union without canonicalizing the sentinels', () => {
  assert.match(testSkill, /Sentinel alias union/);
  assert.match(testSkill, /no canonicalization/);
  // Both alias shapes still present verbatim — the union must not have rewritten either.
  assert.match(testSkill, /✅ Tests sufficient/);
  assert.match(testSkill, /✅ Sufficient/);
  assert.match(testSkill, /⛔ Tests need supplementation/);
  assert.match(testSkill, /⛔ Needs additions/);
});

test('the ac-trace raw→public mapping sentence exists on both sides', () => {
  assert.match(testSkill, /`gate: Adequate` → `✅ Adequate`/);
  assert.match(testSkill, /`gate: Need_Human` → `⚠️ Need Human`/);
  assert.match(acTracePrompt, /Raw → public mapping/);
  assert.match(acTracePrompt, /never emitted raw by the reviewer/);
});

// ── the new agent is thin and its contract sentences are pinned ────────────

test('contract-neutral-reviewer exists, executes the attached template, and rejects cross-family terminals', () => {
  const agent = read('agents/contract-neutral-reviewer.md');
  assert.match(agent, /^model: opus$/m);
  assert.match(agent, /^effort: high$/m);
  assert.match(agent, /entire contract is the template attached/);
  assert.match(agent, /never a sentinel belonging to any other review family/);
  assert.match(agent, /gate_source=fallback:contract-neutral-reviewer/);
});

// ── negative control for the whole file ────────────────────────────────────

test('the phrase detectors detect (control): planted forbidden phrases are caught', () => {
  const planted = autoLoop + '\nCodex unavailable is not a fallback — advisory findings, never a gate verdict.\n';
  assert.ok(planted.includes('never a gate verdict') && planted.includes('not a fallback'),
    'if this fails, the absence assertions above are vacuous');
});
