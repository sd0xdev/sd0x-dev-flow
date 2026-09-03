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
const contract = readFileSync(
  resolve(root, 'skills/codex-code-review/references/scope-contract.md'), 'utf8');
const prompts = {
  fast: readFileSync(resolve(root, 'skills/codex-code-review/references/codex-prompt-fast.md'), 'utf8'),
  full: readFileSync(resolve(root, 'skills/codex-code-review/references/codex-prompt-full.md'), 'utf8'),
  branch: readFileSync(resolve(root, 'skills/codex-code-review/references/codex-prompt-branch.md'), 'utf8'),
};

const GATE_REASON_ENUM = 'gate_reason=<NONE|IN_SCOPE_BLOCKING|OUT_OF_SCOPE_CRITICAL|BOTH>';

// A prompt may request `change_relation`; it may never suggest what the answer should be, in either
// direction. Applied to all five surfaces — the three variant templates, the inline secondary and
// the re-review template — because a steer planted in any one of them buys the same free deferral.
const STEERING = /prefer\s+`?(independent|affected)|should be (independent|affected)|treat .{0,40} as (independent|affected)|default to `?(independent|affected)|may (now |have )?(be|become) `?(independent|affected)|(independent|affected) may (now )?(be|become)/i;

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
  assert.match(single, /derive each finding's `fix_obligation`/,
    'obligation is derived before the gate, not after');
  assert.match(single, /in-scope \(incl\. `uncertain`\) `mandatory` finding at or above the tier's blocking severity/);
  assert.match(single, /in-scope `admitted` finding at any severity/,
    'an admitted candidate blocks whatever its severity');
  assert.match(single, /out-of-scope critical finding \(P0 \/ security \/ data-integrity\) with no valid `\[USER_SKIPPED\]`/);
  assert.match(single, /READY with `gate_reason=NONE`/);
});

test('dual aggregation when merging → per-field conservative rules, USER_SKIPPED after aggregate', () => {
  assert.match(skill, /Normalize each reviewer's findings fail-closed \*\*before\*\* merging/);
  assert.match(skill, /any source `in-scope` or `uncertain` → `in-scope`/);
  assert.match(skill, /`out-of-scope` only when \*\*every\*\* source independently proves it/);
  assert.match(skill, /origin \/ scope_reason: sources conflict → `uncertain`/);
  assert.match(skill, /change_relation: any source `affected` or `uncertain` → mandatory/,
    'the causal field merges conservatively too');
  assert.match(skill, /any source hits → the aggregate keeps the critical domain/);
  assert.match(skill, /evidence: keep all/);
  assert.match(skill, /`\[USER_SKIPPED\]` applies only \*\*after\*\* the aggregate identity forms/);
  // The same three merge outcomes are the reference's contract too — both surfaces must agree.
  assert.match(common, /aggregate `out-of-scope` \*\*only when every source independently proves it\*\*/);
  assert.match(common, /Sources conflict → aggregate `uncertain`/);
  assert.match(common, /aggregate `independent` \*\*only when every source independently reports it\*\*/,
    'independence survives a dual merge only unanimously');
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
  assert.match(skill, /\*\*owed\*\* blocking finding on either axis/,
    'the late-secondary table reconciles on owed-now, not on raw severity');
  assert.match(skill, /a `deferred` candidate is recorded, not blocking/,
    'a deferred candidate must not re-open the loop from the late-secondary path');
  // Codex-down secondary policy: the same derivation, or an independent P1 found by the secondary
  // can never take the deferral path the gate carrier's own report can.
  const downStart = skill.indexOf('**Codex-down secondary policy**');
  assert.notEqual(downStart, -1, 'the Codex-down secondary policy must exist');
  // Bounded at the next heading: an unbounded slice reaches Step 4.5's own derivation sentence and
  // passes on it, so deleting the policy's derivation would go unnoticed.
  const down = skill.slice(downStart, skill.indexOf('### Step 4:', downStart));
  assert.match(down, /derive each finding's `fix_obligation`/,
    'the Codex-down secondary path must derive the obligation too');
  assert.match(down, /secondary finding deriving `deferred` is recorded \(`\[OPPORTUNISTIC_DEFERRED\]` at blocking severity, `\[NIT_DEFERRED\]` below it\) and re-opens nothing/,
    'a deferred secondary finding re-opens nothing');
});

test('scope fields in the common contract → the hunk rule and every fail-closed case are resident there', () => {
  // Two carriers state this: scope-contract.md § Gate Derivation and review-common.md § Scope
  // Fields. A consumer normalizing a report may have loaded only the latter, so pinning the
  // contract alone left the file an executor actually reads unguarded.
  const fields = common.slice(common.indexOf('## Scope Fields'), common.indexOf('## Codex Independent Research'));
  assert.match(fields, /change_relation=<affected\|independent\|uncertain>/, 'the enum is resident');
  assert.match(fields, /independent on an in-scope finding requires the primary hunk\(s\) as file:@@-a,b\+c,d/,
    'the hunk-evidence rule is resident');
  // Every fail-closed case the AC enumerates, in the file that does the normalizing.
  for (const [label, pattern] of [
    ['missing field', /a missing field/],
    ['unknown enum', /an unknown enum value/],
    ['in-diff ∧ independent', /`origin=in-diff ∧ change_relation=independent`/],
    ['branch-introduced ∧ independent', /`scope_reason=branch-introduced ∧ change_relation=independent`/],
    ['independent without hunks', /an `independent` on an in-scope finding whose evidence cites no primary hunk/],
  ]) assert.match(fields, pattern, `fail-closed case not resident in review-common: ${label}`);
  assert.match(fields, /⇒ the finding is `uncertain` ⇒ \*\*in-scope\*\* and `fix_obligation=mandatory`/,
    'every fail-closed case must land on in-scope AND mandatory');
  assert.match(fields, /may never rewrite `affected` or `uncertain` into `independent`/,
    'the one-way escalation rule is resident (INV-005)');
  // Adjacency ≠ effect: the sentence that stops one-hop being read as causation.
  assert.match(fields, /proves \*adjacency\*/, 'the adjacency distinction is resident');
});

test('merge gate when stated in the common contract → three disjuncts, admitted at any severity', () => {
  const gate = common.slice(common.indexOf('## Merge Gate'), common.indexOf('## Scope Fields'));
  assert.match(gate, /`fix_obligation=mandatory` ∧ at or above the tier's blocking severity/,
    'the mandatory disjunct is severity-bounded');
  assert.match(gate, /"in-scope ∧ `fix_obligation=admitted`" at \*\*any\*\* severity/,
    'the admitted disjunct must not be severity-bounded — that is INV-004');
  assert.match(gate, /out-of-scope ∧ critical ∧ no valid `\[USER_SKIPPED\]`/,
    'the out-of-scope critical disjunct is unchanged');
  assert.match(gate, /derived orchestration-side, never reported by a reviewer/,
    'obligation is never a reviewer-declared field');
  // …and the sub-threshold sentence right below it must carve admitted out, or a reader following
  // that sentence lets an admitted P2 leave the loop.
  assert.match(gate, /\*\*unless `fix_obligation=admitted`\*\*/,
    'the sub-threshold sentence must except admitted findings');
  const sub = common.slice(common.indexOf('## Sub-Threshold Findings'));
  assert.match(sub, /a finding whose `fix_obligation` is `admitted` is \*\*never\*\* sub-threshold/,
    'the sub-threshold section itself must state the exception');
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
    assert.match(text, /change_relation=<affected\|independent\|uncertain>/,
      `${name}: change_relation enum missing`);
    assert.match(text, /Adjacency is not effect/, `${name}: adjacency-is-not-effect wording missing`);
    assert.match(text, /change_relation=independent[\\`]* on an in-scope finding requires the primary hunk/,
      `${name}: independent hunk-evidence requirement missing`);
    assert.match(text, /origin=<\.\.\.> scope_reason=<\.\.\.> scope=<\.\.\.> change_relation=<\.\.\.> evidence=<\.\.\.>/,
      `${name}: findings line must carry the fifth field`);
    assert.ok(!/envelope|ceiling|fix_obligation|OPPORTUNISTIC/i.test(text),
      `${name}: a reviewer prompt must never carry the envelope, the ceiling or the obligation`);
    assert.ok(text.includes(GATE_REASON_ENUM), `${name}: gate_reason enum missing`);
    assert.match(text, /NONE is the only value lawful with ✅ Ready/, `${name}: Ready×NONE pairing missing`);
    assert.match(text, /\[OUT_OF_SCOPE_DEFERRED\] <file:line> \| <issue> \| <suggested-ticket> \| <ISO8601 UTC>/,
      `${name}: deferred-record format missing`);
  }
  // Inline secondary prompt (in SKILL.md) carries the same contract — the fifth prompt surface.
  assert.match(skill, /origin=<in-diff\|pre-existing\|uncertain>/);
  const secondary = skill.slice(skill.indexOf('**Task prompt**'), skill.indexOf('**Case B: Loop review'));
  assert.match(secondary, /change_relation=<affected\|independent\|uncertain>/,
    'inline secondary: change_relation enum missing');
  assert.match(secondary, /adjacency is not effect/,
    'inline secondary: adjacency-is-not-effect wording missing');
  assert.match(secondary, /change_relation=independent\s+on an in-scope finding requires the primary hunk/,
    'inline secondary: independent hunk-evidence requirement missing');
  assert.match(secondary, /origin=\.\.\. scope_reason=\.\.\. scope=\.\.\. change_relation=\.\.\. evidence=\.\.\./,
    'inline secondary: findings line must carry the fifth field');
  assert.ok(!/envelope|ceiling|fix_obligation|OPPORTUNISTIC/i.test(secondary),
    'inline secondary: a reviewer prompt must never carry the envelope, the ceiling or the obligation');
  assert.ok(!STEERING.test(secondary),
    'inline secondary: the field must be requested neutrally, never steered');
  assert.ok(skill.includes('gate_reason=<NONE|IN_SCOPE_BLOCKING|OUT_OF_SCOPE_CRITICAL|BOTH>'),
    'inline secondary: gate_reason enum missing');

  // Orchestration OUTPUT examples, not just reviewer prompts: a model copying a four-field example
  // emits a finding the consumer must normalize to uncertain/mandatory, which is exactly how a
  // proven candidate would lose its deferral. Every scope-field example line carries all five.
  const FIELD_LINE = /origin=\S+ scope_reason=\S+ scope=\S+(?: change_relation=\S+)? evidence=/g;
  for (const [label, text] of [['SKILL.md', skill], ['review-common.md', common]]) {
    const lines = text.match(FIELD_LINE) || [];
    assert.ok(lines.length > 0, `${label}: expected at least one scope-field example line`);
    for (const line of lines) {
      assert.match(line, /change_relation=/,
        `${label}: a scope-field example still shows the old four-field shape: ${line}`);
    }
  }
});

test('re-review template when continued → carries the frozen baseline and active dispositions', () => {
  assert.match(common, /## Scope Baseline \(frozen — unchanged for this task, do NOT recompute\)/);
  assert.match(common, /## Active Dispositions/);
  assert.match(common, /\$\{DISPOSITIONS \|\| 'None'\}/);
  assert.match(common, /judged against the frozen baseline above/);
  assert.match(common, /including the gate_reason line/);
  assert.match(common, /Re-evaluate `change_relation` for every finding against the \*\*current\*\* primary diff\n/,
    'every finding is re-evaluated against the current diff, with no directional hint appended');
  // The re-review template is the fifth prompt surface and gets the same neutrality scan the other
  // four get — bounded to the template, or the scan would read the whole file and never fail.
  const tpl = common.slice(common.indexOf('### Re-review Prompt Template'), common.indexOf('## Dismiss Verdict Format'));
  assert.ok(tpl.length > 0, 'the re-review template must exist');
  assert.ok(!/envelope|ceiling|fix_obligation|OPPORTUNISTIC/i.test(tpl),
    're-review template: a reviewer prompt must never carry the envelope, the ceiling or the obligation');
  // …and it must not steer the answer either: no prompt may tell the reviewer which relation to prefer.
  assert.ok(!STEERING.test(tpl),
    're-review template: the field must be requested neutrally, never steered');
  for (const [name, text] of Object.entries(prompts)) {
    assert.ok(!STEERING.test(text), `${name}: the field must be requested neutrally, never steered`);
  }
  // Self-test the guard, both directions (rules/testing.md § Conventions): it must catch a planted
  // steer and pass the real neutral wording, or a green result proves nothing.
  assert.ok(STEERING.test('Prefer independent when the call site is unchanged.'),
    'the steering guard must catch a planted steer');
  assert.ok(STEERING.test('a relation that was independent may now be affected'),
    'the steering guard must catch a directional transition hint');
  assert.ok(STEERING.test('what was affected may become independent after the fix'),
    'the steering guard must catch the hint in the other direction too');
  assert.ok(!STEERING.test('does the primary diff change this defect\'s inputs, reachability, contract'),
    'the steering guard must pass the real neutral request');
});

// The obligation axis, end to end: what makes a candidate, what fails closed, and which of the two
// owed states blocks. Each fixture below is a route by which a real defect could otherwise leave
// the gate — or by which a finished change could be held open.
test('fix obligation when derived → candidacy, fail-closed cases and the owed-now gate', () => {
  const env = contract.slice(contract.indexOf('## Opportunistic Envelope'), contract.indexOf('## Records'));
  assert.ok(env.length > 0, 'the contract must carry an Opportunistic Envelope section');

  // Candidate: pre-existing, in-scope by either reason, independent with hunks, non-critical.
  assert.match(env, /scope_reason ∈ \{diff-file, one-hop\}/,
    'one-hop is a candidate reason — adjacency alone never forces mandatory');
  // Fail-closed: every way of not establishing independence lands on mandatory.
  for (const cause of [
    /a missing or unknown\s+`change_relation`/,
    /origin=in-diff ∧ independent/,
    /branch-introduced ∧\s+independent/,
    /an `independent` with no hunk citation/,
    /any source read\s+`affected` or `uncertain`/,
  ]) assert.match(env, cause, `fail-closed cause not pinned: ${cause}`);
  // Compatibility work stays mandatory — the helper-sweep boundary is untouched.
  assert.match(env, /signature or semantics this\s+branch changed is `affected` by construction/,
    'a caller this branch forced to change is affected, never a candidate');
  // Admission is bounded by an already-open phase, and is owed once taken.
  assert.match(env, /a mandatory blocking finding already opened/,
    'admission requires an open fix phase');
  assert.match(env, /A report that would derive `✅ Ready` is never re-opened/,
    'a Ready report never re-opens for a candidate');

  // Gate derivation: three disjuncts, and a deferred candidate in none of them.
  const gate = contract.slice(contract.indexOf('## Gate Derivation'));
  assert.match(gate, /`fix_obligation=mandatory` ∧ ≥ tier blocking severity/);
  assert.match(gate, /`fix_obligation=admitted`" finding at any severity/);
  assert.match(gate, /out-of-scope ∧ critical ∧ no valid `\[USER_SKIPPED\]`/);
  assert.match(gate, /derived per § Opportunistic Envelope — orchestration-side, after\s+normalization/,
    'obligation is never a reviewer-declared field');
  // Step 4.5 and the loop agree on what "owed now" means — each asserted inside its own section,
  // so a sentence deleted from one is not covered by the same sentence surviving in the other.
  const step45 = skill.slice(skill.indexOf('### Step 4.5:'), skill.indexOf('## Shared Definitions'));
  assert.ok(step45.length > 0, 'Step 4.5 must exist');
  assert.match(step45, /\*\*derive each finding's `fix_obligation`\*\*/,
    'Step 4.5 itself must derive the obligation');
  // Ordering: derivation comes before the matrix is indexed, or the matrix indexes a pair that
  // does not yet account for a deferred candidate.
  const derivePos = step45.indexOf("derive each finding's `fix_obligation`");
  const matrixPos = step45.indexOf('The matrix indexes on the **derived** pair');
  assert.ok(derivePos > -1 && matrixPos > -1 && derivePos < matrixPos,
    'obligation must be derived BEFORE the matrix is indexed');
  assert.match(step45, /`IN_SCOPE_BLOCKING` means \*\*owed now\*\*/);
  assert.match(step45, /for the fix phase it was admitted into — that phase does not re-dispatch while it is unfixed; the verifying re-review derives it afresh/,
    'Step 4.5 states phase-scoped admission');
  assert.match(step45, /derived pair is `✅ Ready × NONE`/,
    'a sole deferred candidate derives Ready');
  // Record selection is severity × obligation: a sub-threshold non-admitted finding keeps
  // NIT_DEFERRED, so an independent P2 under `standard` never gets two records or the wrong one.
  assert.match(step45, /at or above the blocking severity it is recorded as `\[OPPORTUNISTIC_DEFERRED\]`/,
    'blocking-severity deferrals use the opportunistic record');
  assert.match(step45, /below it, a non-admitted finding keeps `\[NIT_DEFERRED\]` exactly as before \(one record per finding/,
    'sub-threshold non-admitted findings keep NIT_DEFERRED, one record per finding');
  const loop = skill.slice(skill.indexOf('## Review Loop'), skill.indexOf('### Loop Behavior'));
  assert.match(loop, /Admission happens only inside a fix phase this loop already opened/,
    'the loop states its own admission condition');
  assert.match(loop, /a report deriving `✅ Ready` is not re-opened to fix a candidate/,
    'the loop states the no-opportunistic-only-round rule itself');
  assert.match(loop, /never into a round of its own/, 'no opportunistic-only round, stated in the loop');
  assert.match(loop, /the round that a `mandatory` blocking finding put the change into/,
    'the loop must name the opener as a MANDATORY blocking finding, not merely an open phase');
  assert.match(loop, /an admitted fix that did not take is reported again and is a candidate again, and recorded, only if the fresh report still proves it one \(pre-existing, `independent` with hunks, not P0 \/ security \/ data-integrity\); under any other fresh classification it derives `mandatory`/,
    'the loop states the CONDITIONAL outcome of an ineffective admitted fix');
  assert.ok(!/reported again as a candidate and recorded, never blocking/.test(loop),
    'the unconditional re-deferral sentence must be gone from the loop');
});

// v1 carries no obligation across rounds: every report is derived on its own terms. The two routes
// this closes are the opposite failure modes a carry would have to reconcile — an obligation
// leaking into the reviewer prompt (anchoring), and per-key state that a rotation or a stateless
// fallback could lose or over-preserve. Pinned in both carriers, plus the withdrawal reason.
test('obligation when a round rotates → derived afresh from the report, never carried, never prompted', () => {
  const identity = common.slice(common.indexOf('### Finding Identity'), common.indexOf('### Re-review Prompt Template'));
  assert.match(identity, /\*\*`fix_obligation` is not carried across rounds\.\*\*/,
    'review-common must state the no-carry rule where identity is defined');
  assert.match(identity, /derived afresh from every report — the\s+first dispatch, a same-thread reply, a rotated thread, a stateless fallback re-dispatch alike/,
    'the rule must name all four dispatch paths');
  assert.match(identity, /there is\s+no per-key state to reconcile here/,
    'no per-key obligation state may exist');
  assert.ok(!/Obligation carry|precedence \(closed|Carried `deferred`|Carried `mandatory`/.test(identity),
    'the withdrawn carry machinery must not survive in review-common');

  const env = contract.slice(contract.indexOf('## Opportunistic Envelope'), contract.indexOf('## Records'));
  assert.match(env, /\*\*The obligation is derived afresh every round, never carried\.\*\*/,
    'the contract must state the no-carry rule where the obligation is defined');
  assert.match(env, /v1 keeps no per-finding obligation state at all/);
  assert.match(env, /no obligation can be lost in a mapping between rounds\s+because no obligation is mapped/,
    'the totality argument is that no obligation is mapped');
  // `admitted` is phase-scoped: owed for the phase it was admitted into, and the phase does not
  // close while it is unfixed. That is what makes the admitted disjunct meaningful without state.
  assert.match(env, /What `admitted` means under this rule is \*\*phase-scoped\*\*/);
  assert.match(env, /the phase is not closed — no re-review\s+is dispatched — while an admitted finding remains unfixed/,
    'an admitted finding must be fixed before the phase re-dispatches');
  assert.match(env, /it is never\s+silently\s+dropped/, 'a re-reported admitted finding is recorded, not lost');
  assert.match(env, /Carrying obligation across rounds was tried and withdrawn on 2026-09-03/,
    'the withdrawal is recorded so it is not re-tried');

  // Cap adjustment (round 15): every carrier that states what happens to a re-reported admitted
  // finding must state it CONDITIONALLY. Three rounds each found one more mirror saying
  // "a candidate, recorded" with no condition — which lets a finding the fresh report now marks
  // affected or P0 be deferred. Reject the unconditional shape everywhere, not only where fixed.
  // "…recorded" followed by a sentence end is the unconditional shape; a comma or a qualifier
  // after it (", only if", "— never blocking") is the conditional one this guard must pass.
  const UNCONDITIONAL = /derived afresh(?: there)?,? as a candidate,? and recorded(?=[.;]|$)|reported again as a candidate and recorded(?=[.,;]|$)|candidate again → `deferred`, recorded(?=[.;]|$)|derived afresh as a candidate → `deferred`, recorded(?=[.;]|$)/m;
  assert.ok(UNCONDITIONAL.test('If it is still present in the next report it is derived afresh there, as a candidate, and recorded'),
    'the unconditional guard must catch the shape it exists for');
  assert.ok(!UNCONDITIONAL.test('a candidate, recorded, only while that report still proves it one'),
    'the unconditional guard must pass the conditional wording');
  const carriers = {
    'scope-contract.md': contract,
    'review-common.md': common,
    'SKILL.md': skill,
    'scope-discipline.md': readFileSync(resolve(root, 'rules/scope-discipline.md'), 'utf8'),
    'fix-all-issues.md': readFileSync(resolve(root, 'rules/fix-all-issues.md'), 'utf8'),
    '2-tech-spec.md': readFileSync(resolve(root, 'docs/features/opportunistic-fix-envelope/2-tech-spec.md'), 'utf8'),
  };
  for (const [name, text] of Object.entries(carriers)) {
    assert.ok(!UNCONDITIONAL.test(text),
      `${name}: an unconditional re-deferral sentence survives — a re-reported admitted finding must be re-derived conditionally`);
  }
  assert.match(env, /derived afresh there from that report's own fields — a candidate,\s+recorded, only while that report still proves it one/,
    'the no-carry paragraph states the conditional outcome');

  // …and the prompt surface stays clean: the disposition list must not gain an opportunistic
  // record, which would anchor the reviewer's own re-evaluation.
  assert.match(common, /`DISPOSITIONS` is the currently valid `\[OUT_OF_SCOPE_DEFERRED\]` \/ `\[USER_SKIPPED\]` lines for this task/,
    'the prompt disposition list must not gain an opportunistic record');
  assert.match(env, /deliberately \*\*not\*\* added to the re-review prompt's disposition list/,
    'the contract must say the obligation stays out of the prompt');
  assert.match(env, /anchors the very\s+`change_relation` re-evaluation the next round asks for/,
    'the reason is anchoring, and it must be stated');
  // Rotation fail-closed is back to its plain form — there is no owed/deferred split to scope it by.
  // Rotation carries FINDINGS (with their recorded fields), never obligations, and the diff decides
  // which unmatched old findings are closed: a fixed one the fresh reviewer omits is closed, an
  // unfixed one returns to this round's finding set and is derived like any other.
  assert.match(common, /an old finding \*\*fixed since it was reported\*\* that the fresh reviewer omits is \*\*closed\*\* \(the omission is the verification\)/,
    'a fixed old finding the fresh reviewer omits must close, not hold the gate');
  assert.match(common, /an old finding \*\*not fixed\*\* that the fresh reviewer omits is fail-closed — it returns to this round's finding set with its \*\*identity and severity\*\*/,
    'an unfixed old finding returns with identity and severity, so it is derivable and blocking');
  assert.match(common, /No obligation is carried; the finding's identity is/, 'findings are carried, obligations are not');
  // A restored unfixed finding must not re-enter with its OLD relation: the diff may have moved
  // since it was judged, so stale current-dependent fields reset to uncertain → mandatory.
  assert.match(common, /its current-dependent fields are \*\*stale evidence\*\* and are reset: `change_relation` and its evidence re-enter as `uncertain`, which derives `mandatory`/,
    'a restored unfixed finding must reset its stale relation, never reuse it');
  assert.match(common, /\*\*The same reconciliation applies to every stateless fallback re-dispatch\*\*/,
    'stateless fallback must reconcile exactly as rotation does');
  assert.match(env, /After a \*\*thread rotation or a stateless fallback re-dispatch\*\*/,
    'the contract names both fresh-dispatch paths');
  assert.match(env, /re-enter as\s+`uncertain` and derive `mandatory` until a reviewer re-classifies them/,
    'the contract states the reset in the same terms');
  const fallbackLoop = skill.slice(skill.indexOf('- **Under fallback** (sticky carrier'), skill.indexOf('- **Secondary** (`--dual` only)'));
  assert.match(fallbackLoop, /\*\*Reconcile it like a rotated report\*\*/, 'the fallback loop row must reconcile');
  assert.match(fallbackLoop, /a fresh carrier's silence never retires an unfixed owed finding/,
    'fallback silence must not retire an owed finding');
  assert.match(env, /the round's finding set is the fresh report plus the old thread's unclosed findings that were\s+\*\*not\*\* fixed/,
    'the contract defines the post-rotation finding set');
});

// Every route that reconciles a late or fallback report must speak in owed-now terms. A raw
// "blocking finding re-opens the loop" summary predates the obligation axis and contradicts it:
// a proven-independent deferred P1 would be routed back into the fix loop it just left.
test('late and fallback reconciliation → every route is owed-scoped, none raw', () => {
  // Each assertion is bounded to the section that carries it. An unbounded scan is satisfied by a
  // sibling route's wording, which is how a raw summary survived a green suite once already.
  const sections = {
    'Step 3.5 late-at-precommit': skill.slice(skill.indexOf('### Step 3.5:'), skill.indexOf('### Step 4:')),
    'pre-precommit checkpoint': skill.slice(skill.indexOf('### Pre-precommit Checkpoint'), skill.indexOf('## Verification')),
  };
  const stepThreeFive = sections['Step 3.5 late-at-precommit'];
  const checkpoint = sections['pre-precommit checkpoint'];
  for (const [label, text] of Object.entries(sections)) {
    assert.ok(text.length > 0, `${label}: section not found — the slice bounds drifted`);
  }
  // Step 3.5 carries three routes: the late-at-precommit row, the Codex-down secondary policy, and
  // the fallback-carrier paragraph. Each must state the predicate itself.
  assert.match(stepThreeFive, /a late in-scope \*\*owed\*\* finding re-opens the fix loop/,
    'late-at-precommit row must be owed-scoped');
  assert.match(stepThreeFive, /a late in-scope `deferred` candidate is recorded \(`\[OPPORTUNISTIC_DEFERRED\]` at blocking severity, `\[NIT_DEFERRED\]` below it\) and re-opens nothing/,
    'late-at-precommit row must carve out deferred, with the record chosen by severity');
  // The policy DEFINITION lives in Step 3.5; the fallback-carrier SUMMARY that points at it lives
  // in Step 4. Slicing both from one section is how the summary escaped the last guard.
  const downPolicy = stepThreeFive.slice(stepThreeFive.indexOf('**Codex-down secondary policy**'));
  assert.ok(downPolicy.length > 0, 'the Codex-down policy must be defined in Step 3.5');
  assert.match(downPolicy, /act on its \*\*owed\*\* blocking findings only/,
    'Codex-down policy must be owed-scoped');
  assert.match(downPolicy, /a secondary finding deriving `deferred` is recorded \(`\[OPPORTUNISTIC_DEFERRED\]` at blocking severity, `\[NIT_DEFERRED\]` below it\) and re-opens nothing/,
    'Codex-down policy must carve out deferred, with the record chosen by severity');
  const stepFour = skill.slice(skill.indexOf('### Step 4: Consolidate Output'), skill.indexOf('### Step 4.5:'));
  const fallbackPara = stepFour.slice(stepFour.indexOf('**Fallback carrier (Codex out'));
  assert.ok(fallbackPara.length > 0, 'the fallback-carrier paragraph must exist in Step 4');
  assert.match(fallbackPara, /\*\*owed\*\* blocking findings escalate \(mandatory at or above the blocking severity, or admitted at any severity\)/,
    'the fallback-carrier summary must state the predicate, not "blocking findings escalate"');
  assert.match(fallbackPara, /a `deferred` candidate is recorded and escalates nothing/,
    'the fallback-carrier summary must carve out deferred');
  // The checkpoint's own two rows.
  assert.match(checkpoint, /an \*\*owed\*\* blocking finding on either axis after merge/,
    'checkpoint must be owed-scoped');
  assert.match(checkpoint, /a `deferred` candidate is recorded, not routed/,
    'checkpoint must carve out deferred');
  // review-common carries its own copy of the Codex-down route, and the earlier guard scanned only
  // SKILL.md — which is how that copy kept the raw wording through nine rounds.
  assert.match(common, /Codex-failure path\) — \*\*owed\*\* blocking findings\nescalate conservatively/,
    "review-common's Codex-down summary must be owed-scoped");
  assert.match(common, /a `deferred` candidate is recorded and escalates nothing, but/,
    "review-common's Codex-down summary must carve out deferred");
  // Positive control: the raw pre-obligation phrases must not survive in EITHER carrier.
  for (const [label, text] of [['SKILL.md', skill], ['review-common.md', common]]) {
    for (const raw of [
      /a late in-scope blocking finding re-opens the fix loop/,
      /Codex-failure path\) — blocking findings escalate/,
    ]) assert.ok(!raw.test(text), `${label}: a raw pre-obligation summary survived: ${raw}`);
  }
});

// E2 is a footprint decision, and the breaker table already excludes a deferred candidate from it.
// The Human Exits summary must say the same, or a reader reaches E2 through the summary alone.
test('human exit E2 when summarized → owed-scoped, and a deferred candidate is not a trigger', () => {
  const exits = contract.slice(contract.indexOf('## Human Exits'), contract.indexOf('## Anchor Compatibility'));
  assert.match(exits, /in-scope \*owed\* findings remaining/, 'E2 is defined over owed findings');
  assert.match(exits, /`fix_obligation=mandatory` at\s+or above the tier's blocking severity, or `admitted` at any severity/,
    'the E2 summary states the same predicate as the breaker table');
  assert.match(exits, /A\s+`deferred` candidate remaining is \*\*not\*\* an E2 trigger/,
    'a deferred candidate must not reach E2 through the summary');
  assert.ok(!/E2 breaker-triggered with in-scope blocking findings remaining/.test(contract),
    'the raw severity-only E2 definition must be gone');
});


// The seven derivation scenarios the ticket enumerates, each bound to the sentence that decides it.
// Prose-fragment presence is not enough on its own: these assert the specific input→outcome pair,
// so weakening one scenario cannot hide behind another scenario's wording surviving.
test('derivation scenarios when enumerated → each named input binds its outcome', () => {
  const env = contract.slice(contract.indexOf('## Opportunistic Envelope'), contract.indexOf('## Records'));
  const worked = env.slice(env.indexOf('**Worked cases.**'), env.indexOf('**An admitted finding is owed'));
  assert.ok(worked.length > 0, 'the envelope must carry a worked-case table');
  const rows = worked.split('\n').filter((l) => l.trim().startsWith('|')).slice(2);
  assert.equal(rows.length, 6, 'the worked-case table is closed: six rows');

  // Each scenario names a row and asserts BOTH halves — the input that identifies it and the
  // obligation it produces. A row whose outcome column were weakened fails here even though the
  // input text survives, which is what the previous prose-fragment version could not do.
  const scenarios = [
    ['one-hop independent → candidate, adjacency never forces mandatory',
      /`scope_reason=one-hop`\), `change_relation=independent` with hunks, P1 \| candidate → `deferred`\/`admitted` \| adjacency alone never forces `mandatory`/],
    ['one-hop affected → mandatory',
      /`change_relation=affected` \(this branch changed the signature it calls\) \| `mandatory` \| blocks at or above the tier's blocking severity/],
    // `mandatory` restores the ordinary severity rule rather than bypassing it: an in-diff P2 under
    // `standard` is mandatory AND sub-threshold, so it derives Ready. An unconditional "blocks" here
    // would tell a reader to derive Blocked for it.
    ['in-diff ∧ independent → mandatory via contradiction, still severity-bounded',
      /`origin=in-diff` reported with `change_relation=independent` \| `mandatory` \(contradiction → `uncertain`\) \| blocks at or above the tier's blocking severity — `mandatory` restores the ordinary severity rule, it does not bypass it/],
    ['baseline-file independent → deferred, does not block',
      /candidate → `deferred` while the envelope is closed \| recorded `\[OPPORTUNISTIC_DEFERRED\]`; \*\*does not block\*\*/],
    ['admitted P2 under standard → owed for its phase, re-derived afresh by the verifying re-review',
      /A candidate admitted into an open fix phase, P2 under `standard` \| `admitted` — \*\*phase-scoped\*\* \| owed for that phase: the phase does not re-dispatch while it is unfixed, though the same finding unadmitted would be sub-threshold\. The verifying re-review derives it afresh from \*\*its own\*\* fields: a candidate again → `deferred`, recorded, only if that fresh report still proves it one \(pre-existing, independent with hunks, not P0 \/ security \/ data-integrity\); any other fresh classification derives `mandatory`/],
    ['dual merge, one uncertain source → mandatory',
      /one source `independent`, the other `uncertain` \| `mandatory` \| the conservative merge wins/],
  ];
  assert.equal(scenarios.length, rows.length,
    'every worked-case row must be pinned — the two lists are the same length by construction');
  for (const [name, pattern] of scenarios) {
    assert.match(worked, pattern, `derivation scenario unpinned: ${name}`);
  }

  // The two scenarios that live outside the table, each in the section that decides it.
  assert.match(skill, /when it is the only blocking-severity finding, the derived pair is `✅ Ready × NONE`/,
    'sole deferred → Ready is decided in Step 4.5');
  assert.match(env, /A valid candidate the model takes into a fix phase \*\*a mandatory blocking finding already opened\*\*/,
    'mandatory + admitted share one fix phase');
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

// ── Assurance boundary (over-thinking guard, 2026-08-29) ─────────────────────────────────────
// The boundary is what stops review depth growing round over round into guards-of-guards: a
// blocking guard finding needs a violated behavior/AC/invariant plus a counterexample on the real
// path; hardening a demonstrated property is Nit. Both first-dispatch templates must carry it
// (the fallback and rotated paths inherit it from them), and the re-review contract mirrors it.
// Derived from the existing `prompts` fixture above — deliberately no separate template registry.

test('assurance boundary when dispatched → both first-dispatch templates and the re-review mirror carry it', () => {
  // The task contract binds EVERY dispatch path — fast, full, and branch alike (a branch review
  // without the task can approve a coherent implementation of the wrong thing). The
  // material-defects framing and the Assurance Boundary are deliberately fast/full-scoped: those
  // two are the auto-loop first-dispatch templates the converged package named.
  for (const [name, body] of Object.entries(prompts)) {
    assert.match(body, /## Task \(frozen\)\n\$\{TASK_DESCRIPTION\}/,
      `${name}: every dispatch carries the frozen task contract — metadata without the task lets a coherent but task-incorrect change pass`);
  }
  for (const [name, body] of Object.entries({ fast: prompts.fast, full: prompts.full })) {
    assert.match(body, /material defects rather than praise/,
      `${name}: the opening frames the review at material defects, not issue-finding volume`);
    assert.match(body, /## Assurance Boundary/, `${name} template must carry the boundary heading`);
    assert.match(body, /concrete counterexample on the\s+guard's actual execution path/,
      `${name}: a blocking guard finding needs a real-path counterexample`);
    assert.match(body, /Never turn a hardening\s+suggestion into a requirement/,
      `${name}: hardening suggestions must not escalate`);
  }
  assert.match(common, /assurance boundary from the first dispatch still applies/,
    're-review must mirror the boundary without a growth channel');
  assert.match(common, /never appends\s*\n?> round-specific attack directions/,
    'the re-review ask is fixed across rounds');
});
