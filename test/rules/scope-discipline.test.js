'use strict';

// Pins the structural contract of the scope rules (issue #12): the six-row behavior
// table, the two record formats, the closed-set options with their Anchor-first bounds, the
// circuit breaker's freeze/no-deferral semantics, the fail-closed scope reading, and the E1/E2
// human-exit enumeration plus the closed-list union sentence in CLAUDE.md / CLAUDE.template.md.
// Weakening any of these is a reviewed spec change, not a wording tweak.
//
// Two files since 2026-08-29 (rules-residency, tech spec § 3.4): the detailed mechanics moved to
// skills/codex-code-review/references/scope-contract.md and are asserted there; rules/
// scope-discipline.md keeps the resident guard, asserted at the bottom of this file. The move is
// why `contract` and `rule` are separate bindings — an assertion aimed at the wrong one would pass
// on prose that is no longer where the reader will look for it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const rule = readFileSync(resolve(root, 'rules/scope-discipline.md'), 'utf8');
const contract = readFileSync(
  resolve(root, 'skills/codex-code-review/references/scope-contract.md'), 'utf8');
const fixAll = readFileSync(resolve(root, 'rules/fix-all-issues.md'), 'utf8');

function section(doc, heading) {
  const start = doc.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `section "## ${heading}" must exist`);
  const rest = doc.slice(start + heading.length + 3);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

// Strict markdown-table parser — consumes every pipe-line so a malformed or smuggled row fails
// instead of being filtered away (same rationale as discretion-tiers.test.js).
function parseTable(sectionText, expectedHeader) {
  const pipeLines = sectionText.split('\n').filter((l) => l.trim().startsWith('|'));
  assert.ok(pipeLines.length >= 2, 'table must have a header and separator');
  const toCells = (line, n) => {
    const parts = line.split('|');
    assert.equal(parts[0].trim(), '', `row must start with a pipe: ${line}`);
    assert.equal(parts[parts.length - 1].trim(), '', `row must end with a pipe: ${line}`);
    assert.equal(parts.length, n + 2, `row must have exactly ${n} cells, got ${parts.length - 2}: ${line}`);
    return parts.slice(1, -1).map((c) => c.trim());
  };
  const header = toCells(pipeLines[0], expectedHeader.length);
  assert.deepEqual(header, expectedHeader, 'table header drifted');
  assert.match(pipeLines[1], /^\|[-\s|]+\|$/, `second line must be the separator: ${pipeLines[1]}`);
  return pipeLines.slice(2).map((l) => toCells(l, expectedHeader.length));
}

test('behavior table when parsed → exactly the seven closed rows, in order', () => {
  const rows = parseTable(section(contract, 'Behavior Table'), ['Finding', 'Behavior']);
  assert.equal(rows.length, 7, 'the behavior table is closed: exactly seven data rows');
  assert.deepEqual(rows.map((r) => r[0]), [
    'in-scope ∧ **owed** (§ Opportunistic Envelope: `mandatory` ∧ ≥ tier blocking severity, **or** `admitted` at any severity)',
    'in-scope ∧ ≥ tier blocking severity ∧ `fix_obligation=deferred`',
    'in-scope ∧ sub-threshold ∧ **not** `admitted`',
    'out-of-scope ∧ not critical',
    'out-of-scope ∧ critical ∧ no valid `[USER_SKIPPED]`',
    'out-of-scope ∧ critical ∧ valid `[USER_SKIPPED]`',
    'user explicitly says "fix it together"',
  ], 'the seven finding classes, in this order');
  assert.match(rows[0][1], /zero tolerance unchanged/, 'in-scope owed blocking keeps fix-all-issues');
  assert.match(rows[1][1], /does not block `✅ Ready`/,
    'a deferred opportunistic candidate must not block Ready');
  assert.match(rows[1][1], /\[OPPORTUNISTIC_DEFERRED\]/, 'the deferred row names its record');
  // The composed predicate, not merely the word: the fix row must reach an admitted finding at ANY
  // severity, and the sub-threshold row must not claim it.
  assert.match(rows[0][0], /`admitted` at any severity/,
    'the fix row must cover an admitted finding whatever its severity');
  assert.match(rows[2][1], /An `admitted` sub-threshold finding is \*\*not\*\* in this row — it is owed, and the fix row above routes it/,
    'the sub-threshold row must route an admitted finding away, not merely mention it');
  assert.match(rows[3][1], /does not block `✅ Ready`/, 'non-critical out-of-scope must not block');
  assert.match(rows[4][1], /human exit E1/, 'critical out-of-scope routes to E1');
  assert.match(rows[4][1], /a pass must not be noted/, 'no pass may be noted on the E1 row');
  assert.match(rows[4][1], /does \*\*not\*\* enter the fix loop/, 'the model must not auto-fix the E1 row');
});

// The opportunistic axis: candidacy is narrow and fail-closed, deferral is not dismissal, and an
// admitted finding is owed at any severity. Each of these three is a route by which a real defect
// could otherwise leave the gate silently.
test('the owed term when defined → stated once canonically, with the admitted disjunct unbounded', () => {
  const env = section(contract, 'Opportunistic Envelope');
  assert.match(env, /\*\*The term `owed` — defined canonically here, mirrored in the named carriers\.\*\*/,
    'the term is defined canonically in one place and its mirrors are declared, not denied');
  assert.match(env, /fix_obligation\(f\)=mandatory ∧ severity\(f\) ≥ tier_blocking/,
    'the mandatory disjunct is severity-bounded');
  assert.match(env, /∨\s+fix_obligation\(f\)=admitted\s*\)\s+-- admitted carries no severity bound/,
    'the admitted disjunct must carry no severity bound');
  assert.match(env, /\*\*mirror\*\* it in their own words/,
    'the routing sites are declared mirrors, not restatements that drift unchecked');
  assert.match(env, /this definition is the one each mirror is checked against/,
    'the canonical form is the reference the mirrors are pinned to');
  assert.match(env, /each prose copy is a chance to drop the `admitted` disjunct/,
    'the reason duplication is banned must be stated, or it will be reintroduced');
  // The two resident rules files are the deliberate exception, and saying so is what stops a later
  // consolidation from stripping the expansion a session needs before it loads this contract.
  assert.match(env, /two \*\*resident\*\* rules files/);
  assert.match(env, /carries them before it has loaded this\s+contract/);
});

test('opportunistic envelope when read → candidacy fails closed and admission is owed at any severity', () => {
  const env = section(contract, 'Opportunistic Envelope');
  assert.match(env, /origin = pre-existing/, 'only pre-existing findings are candidates');
  assert.match(env, /scope_reason ∈ \{diff-file, one-hop\}/, 'both in-scope reasons are candidates');
  assert.match(env, /change_relation = independent, with the primary hunk\(s\) cited/,
    'independence needs hunk evidence');
  assert.match(env, /severity ∉ \{P0\} ∧ the finding is not a security or data-integrity defect/,
    'critical findings are never candidates');
  assert.match(env, /Everything else is `mandatory`/, 'the predicate fails closed');
  assert.match(env, /origin=in-diff ∧ independent/, 'the in-diff contradiction is named');
  assert.match(env, /branch-introduced ∧\s+independent/, 'the branch-introduced contradiction is named');
  assert.match(env, /any source read\s+`affected` or `uncertain`/, 'the dual merge is conservative');
  assert.match(env, /owed for the fix phase it was admitted into, whatever its severity/,
    'an admitted finding holds its phase open regardless of severity');
  assert.match(env, /the phase does not re-dispatch while it is unfixed \(Fixing ≠ Verifying/,
    'an admitted finding must be fixed before the phase re-dispatches');
  assert.match(env, /reported again and derived afresh — a candidate, \*\*recorded\*\*, if the fresh report still proves it\s+one, and `mandatory` under any other fresh classification/,
    'an ineffective admitted fix is re-derived from the fresh report, conditionally, never dropped');
  assert.match(env, /No opportunistic-only round/, 'the envelope never creates work');
  assert.match(env, /never reach a `deferred` candidate either — a one-line candidate fixed "on the spot" is exactly the\s+opportunistic-only round in miniature/,
    'the sub-threshold on-the-spot exception must not reach a deferred candidate');
  assert.match(env, /only if that fresh report still proves it one \(pre-existing, independent with hunks, not P0 \/ security \/ data-integrity\); any other fresh classification derives `mandatory`/,
    'a re-reported admitted finding is deferred only when freshly proven a candidate');
  assert.match(env, /Deferral is not dismissal/, 'a deferral leaves the finding actionable');
  assert.match(env, /no `\[DISMISS_VERDICT\]`|carries no `\[DISMISS_VERDICT\]`/,
    'a deferral is not a seek-verdict dismissal');
  assert.match(env, /the envelope is \*\*`closed`\*\*/,
    'until capacity is defined the envelope is closed — every candidate defers');
  const oblig = env.slice(env.indexOf('| `fix_obligation` | When |'));
  for (const value of ['`mandatory`', '`admitted`', '`deferred`']) {
    assert.ok(oblig.includes(value), `the obligation table must define ${value}`);
  }
});

test('record formats when pinned → all five literal field orders survive verbatim', () => {
  assert.ok(
    rule.includes('[OUT_OF_SCOPE_DEFERRED] file:line | issue | suggested-ticket | <ISO8601>'),
    'OUT_OF_SCOPE_DEFERRED field order is a literal contract'
  );
  assert.ok(
    rule.includes('[USER_SKIPPED] key=<file|canonical_issue> | authorized_at=<ISO8601> | scope=<task-id>'),
    'USER_SKIPPED field order is a literal contract'
  );
  assert.ok(
    rule.includes('[OPPORTUNISTIC_BUDGET] class=<closed|micro|small> | ceiling=<closed|micro|small> | purpose=<FIX|FEATURE|REFACTOR|DOC|OTHER> | path_risk=<rule|none|unknown> | facts=<csv> | semantic=<contained|shared|rollout-sensitive|unknown> | base=<ref> | <ISO8601>'),
    'OPPORTUNISTIC_BUDGET field order is a literal contract'
  );
  assert.ok(
    rule.includes('[OPPORTUNISTIC_FIX] key=<file|canonical_issue> | severity=<P1|P2|Nit> | class=<micro|small> | relation=independent | source=<codex|toolkit|both|fallback:<agent>|self> | hunks=<file:hunk-range[,..]> | used=<findings>/<production-files> | <ISO8601>'),
    'OPPORTUNISTIC_FIX field order is a literal contract'
  );
  assert.ok(
    rule.includes('[OPPORTUNISTIC_DEFERRED] key=<file|canonical_issue> | severity=<P1|P2|Nit> | class=<closed|micro|small> | reason=<closed|no-open-fix-phase|footprint|exhausted|breaker> | relation=independent | source=<codex|toolkit|both|fallback:<agent>|self> | hunks=<file:hunk-range[,..]> | <ISO8601>'),
    'OPPORTUNISTIC_DEFERRED field order is a literal contract'
  );
  assert.match(section(contract, 'Records (reporting conventions)'), /no TTL, no hook parsing, no\npersistence|no TTL, no hook parsing, no persistence/,
    'records are reporting conventions, not machine inputs');
  assert.match(section(contract, 'Records (reporting conventions)'), /never contain secrets/,
    'Register #2: records must never carry secrets');
});

test('closed-set options when enumerated → exactly three, skip never offered, Anchor-first carve-out', () => {
  const opts = section(contract, 'Closed-Set Options (human exit E1)');
  const numbered = opts.split('\n').filter((l) => /^\d+\. /.test(l));
  assert.equal(numbered.length, 3, 'exactly three numbered options — the set is closed');
  assert.match(numbered[0], /Expand scope/);
  assert.match(numbered[1], /Extract the urgent defect/);
  assert.match(numbered[2], /Abort the original task/);
  assert.match(opts, /\*\*Skip is never offered proactively\.\*\*/, 'skip must not be a presented option');
  assert.match(opts, /Anchor\s+Register #1/, 'Register #1 carve-out must be stated');
  assert.match(opts, /do not record `\[USER_SKIPPED\]`/, 'an Anchor-hit finding takes the proposal channel, not a skip');
  assert.match(opts, /proposal channel/);
});

test('USER_SKIPPED validity when defined → all five cases are pinned', () => {
  const opts = section(contract, 'Closed-Set Options (human exit E1)');
  // 1. line drift still matches (line numbers are not identity)
  assert.match(opts, /line numbers are not part of\s+identity/);
  assert.match(opts, /line drift caused by other fixes does not break the match/);
  // 2. different task does not match
  assert.match(opts, /same task/);
  // 3. malformed disposition is invalid
  assert.match(opts, /all fields present and well-formed/);
  assert.match(opts, /Any failure ⇒ fail-closed\s+invalid/);
  // 4. an Anchor-hit finding never gets a skip (asserted in the previous test too — this is the
  //    validity-side statement)
  assert.match(opts, /the Anchor-first check\s+above passed at creation/);
  // 5. a skip does not close the verdict — re-review to Ready × NONE before any pass note
  assert.match(opts, /\*\*Creating a disposition does not close the standing verdict\.\*\*/);
  assert.match(opts, /only a fresh reviewer verdict deriving to `Ready × NONE` may be noted as pass/);
  // A different issue in the same file does not inherit the authorization.
  assert.match(opts, /substantively different issue in the same file does\s+not inherit/);
});

test('scope determination when read → uncertain fails closed and out-of-scope needs full negatives', () => {
  const det = section(contract, 'Scope Determination (mechanical — any one condition ⇒ in-scope)');
  assert.match(det, /`uncertain` is \*\*fail-closed: treated as in-scope\*\*/);
  assert.match(det, /\*\*complete negative evidence\*\*/);
  assert.match(det, /any missing negative ⇒ `uncertain`/);
  assert.match(det, /\*\*one hop only\*\*/);
  assert.match(det, /No transitive expansion/);
  assert.match(det, /condition 2\s+is always negative/, 'non-code files have no call-path condition');
});

test('scope baseline when frozen → immutable, monotonic union only, no rediscovery', () => {
  const base = section(contract, 'Scope Baseline (task-level, immutable)');
  assert.match(base, /\*\*frozen for the whole review session\*\*/);
  assert.match(base, /no path may recompute it/);
  assert.match(base, /\*\*monotonic precise union\*\*/);
  assert.match(base, /\*\*Never re-run the\s+discovery commands\*\*/);
  assert.match(base, /never proceed on an empty baseline/);
  assert.match(base, /parameter error/, 'BASE_BRANCH exhaustion aborts as a parameter error');
  assert.match(base, /not a human exit/);
  assert.match(base, /git rev-parse\s*\n?--verify|git rev-parse --verify/, 'each base candidate is verified');
});

test('circuit breaker when triggered → stops expansion only, defers candidates, escalates only what is owed', () => {
  const brk = section(contract, 'Circuit Breaker (stops expansion; never rewrites scope)');
  assert.match(brk, /counters are round-scoped/);
  assert.match(brk, /never write back into it/);
  assert.match(brk, /`<root>`/, 'repo-root files map to the virtual <root> bucket');
  assert.match(brk, /\*\*only stops further expansion\*\*/);
  assert.match(brk, /\*\*no reclassifying force\*\*/);
  const rows = parseTable(brk, ['Remaining finding', 'Disposition']);
  assert.equal(rows.length, 4, 'the breaker disposition table is closed: four rows');
  assert.deepEqual(rows.map((r) => r[0]), [
    'Independently out-of-scope (complete negative evidence)',
    'in-scope (incl. `uncertain`) ∧ **owed**: (`fix_obligation=mandatory` ∧ ≥ blocking) ∨ `fix_obligation=admitted` at any severity',
    'in-scope ∧ ≥ blocking ∧ `fix_obligation=deferred`',
    'in-scope ∧ sub-threshold ∧ not `admitted`',
  ], 'the four remaining-finding classes, in this order');
  // What the breaker escalates is what the change OWES. An owed blocking finding still cannot be
  // deferred — that is E2, unchanged. A proven candidate the change never owed is recorded, not
  // escalated: routing it to E2 would ask a human to re-scope a task over a defect it does not owe.
  assert.match(rows[1][1], /\*\*Must not be deferred\*\*/, 'an owed in-scope blocker survives the breaker');
  assert.match(rows[1][1], /human exit E2/);
  // The partition must be total over owed findings. An admitted P2 under `standard` is owed but
  // sub-threshold: with the owed row bounded by severity it would match no row at all — neither an
  // E2 route nor a lawful deferral — and silently leave the gate. The owed row therefore carries
  // the admitted disjunct unbounded by severity, and the sub-threshold row excludes admitted.
  assert.match(rows[1][0], /`fix_obligation=admitted` at any severity/,
    'the owed breaker row must cover an admitted finding whatever its severity');
  assert.match(rows[3][0], /not `admitted`/, 'the sub-threshold row must exclude admitted');
  assert.match(rows[3][1], /covered by the owed row above, never by this one/,
    'the sub-threshold row must say where an admitted finding goes instead');
  assert.match(rows[2][1], /\[OPPORTUNISTIC_DEFERRED\]/, 'a breaker-deferred candidate is recorded');
  assert.match(rows[2][1], /reason=breaker/, 'the deferral names the breaker as its reason');
  assert.match(rows[2][1], /does not reach E2/, 'a candidate never escalates to the human exit');
  // The resident guard must say the same thing — it is what an ad-hoc session carries.
  const guard = section(rule, 'Resident Guard');
  assert.match(guard, /breaker-triggered in-scope blocking finding that this change \*\*owes\*\*/,
    'the resident E2 route is owed-scoped too');
  assert.match(guard, /breaker-deferred\s+candidate is recorded, not escalated/,
    'the resident guard states the candidate exclusion from E2');
});

test('gate derivation when read → derived values outrank declarations, underivable is Blocked×BOTH', () => {
  const gate = section(contract, 'Gate Derivation (normalization-first)');
  assert.match(gate, /derived, not free/);
  assert.match(gate, /`NONE` is the only combination\s+lawful with `✅ Ready`/);
  assert.match(gate, /never the reviewer's declaration/);
  assert.match(gate, /`Blocked × BOTH`/);
  assert.match(gate, /gate_reason=<NONE\|IN_SCOPE_BLOCKING\|OUT_OF_SCOPE_CRITICAL\|BOTH>/,
    'the gate_reason enum is closed and literal');
  // fail-closed reading enumerates its triggers
  assert.match(gate, /missing field, an unknown enum\s+value, a contradictory combination/);
  assert.match(gate, /`origin=in-diff ∧ scope=out-of-scope`/, 'the canonical contradiction example is pinned');
});

test('human exits when enumerated → exactly E1 and E2, and the closed list is the two-file union', () => {
  const exits = section(contract, 'Human Exits (enumerated here — closed list)');
  const bullets = exits.split('\n').filter((l) => /^- \*\*E\d/.test(l));
  assert.equal(bullets.length, 2, 'exactly two enumerated exits');
  assert.match(bullets[0], /^- \*\*E1 `OUT_OF_SCOPE_CRITICAL`\*\*/);
  assert.match(bullets[1], /^- \*\*E2 breaker-triggered/);
  assert.match(exits, /closed list of human\s+exits/);
  // The governance sentence lives in both tracked templates: the union names BOTH sources.
  for (const f of ['CLAUDE.md', 'CLAUDE.template.md']) {
    const text = readFileSync(resolve(root, f), 'utf8');
    const sentence = text.split('\n').find((l) => l.includes('closed list') && l.includes('human exits'));
    assert.ok(sentence, `${f} must still carry the human-exit closed-list sentence`);
    assert.ok(sentence.includes('@rules/auto-loop.md'), `${f} closed-list sentence must name auto-loop.md`);
    assert.ok(sentence.includes('@rules/scope-discipline.md'), `${f} closed-list sentence must name scope-discipline.md`);
  }
});

test('anchor compatibility when stated → re-review has no user exception and inherits #2/#3/#6', () => {
  const anchor = section(contract, 'Anchor Compatibility (inherited Register hits — resolution step 0)');
  assert.match(anchor, /it never exempts any actual edit\s+from re-review/);
  assert.match(anchor, /There is no user exception to this sentence\./);
  assert.match(anchor, /Register #6/);
  assert.match(anchor, /`thorough` \(Register #3\)/);
  assert.match(anchor, /never\s+carry secrets \(Register #2\)/);
  assert.match(anchor, /Register #1 precedence/);
});

// Guard self-test (rules/testing.md § Guards): the two load-bearing refusal patterns above are
// exercised in both directions with fixtures, so deleting a guard turns a fixture red rather
// than leaving every existing case green.
test('guard patterns when self-tested → hit the refusal fixtures and pass the ordinary-data fixtures', () => {
  const neverOffer = /\*\*Skip is never offered proactively\.\*\*/;
  assert.ok(neverOffer.test(contract), 'the contract itself must carry the never-offer sentence');
  assert.ok(neverOffer.test('**Skip is never offered proactively.** A skip exists only when raised.'),
    'guard fixture: the sentence shape must be caught');
  assert.ok(!neverOffer.test('The model may skip proactively offering praise in reviews.'),
    'ordinary data using the same words must not satisfy the guard');

  const noDeferral = /\*\*Must not be deferred\*\*/;
  assert.ok(noDeferral.test(contract), 'the breaker table must carry the no-deferral cell');
  assert.ok(noDeferral.test('| in-scope ∧ ≥ blocking | **Must not be deferred**: stays Blocked |'),
    'guard fixture: the cell shape must be caught');
  assert.ok(!noDeferral.test('Deferred findings must not be forgotten at task end.'),
    'ordinary deferral prose must not satisfy the guard');
});

// ── Resident guard (rules/scope-discipline.md after the 2026-08-29 extraction) ────────────────
// The guard is what a session carries BEFORE it knows it is reviewing. These assertions are the
// negative control for the move: delete the guard and they fail, which is the failure the move
// itself could otherwise cause silently — a rule file emptied into a reference nothing loads.

test('resident guard when read → the seven semantics survive resident, and point at the contract', () => {
  const guard = section(rule, 'Resident Guard');
  assert.match(guard, /baseline is frozen/i, 'freeze must be resident');
  assert.match(guard, /one hop/i, 'the one-hop condition must be resident');
  assert.match(guard, /`uncertain` fails closed to in-scope/, 'fail-closed must be resident');
  assert.match(guard, /complete negative\s+evidence/, 'the out-of-scope evidence bar must be resident');
  assert.match(guard, /No repo-wide helper sweep/, 'the sweep ban must be resident');
  assert.match(guard, /human exit E1/, 'the critical out-of-scope route must be resident');
  assert.match(guard, /never\*\* exempts an\s+edit from re-review/,
    'Register #6 must be resident — an edit re-opens the plane whatever scope says');
  // The opportunistic axis is emitted during a fix pass, possibly before the contract is loaded,
  // so its four load-bearing sentences are resident too.
  assert.match(guard, /Opportunistic candidates/, 'the candidate class must be resident');
  assert.match(guard, /change_relation=independent/, 'the independence requirement must be resident');
  assert.match(guard, /Deferral is not dismissal/, 'deferral-≠-dismissal must be resident');
  assert.match(guard, /owed \*\*for that phase, whatever its\s+severity\*\*/,
    'phase-scoped admission must be resident');
  assert.match(guard, /no obligation is carried across rounds/, 'the no-carry rule must be resident');
  assert.match(guard, /it is `closed`/, 'the interim closed envelope must be resident');
  // `rules/discretion.md` § File Baselines binds these three to THIS file by name, so the pin has
  // to be on the resident copy. Repointing this suite's other assertions to the contract removed
  // the only guard on their residency: deleting them from the guard left every suite green, where
  // at HEAD it went red. Both carriers now hold a pin, which is what two-carrier actually asks.
  assert.match(guard, /`thorough`\s+\(Register #3\)/,
    'Register #3 security/data-integrity escalation must stay resident');
  assert.match(guard, /Records never carry secrets \(Register #2\)/,
    'Register #2 must stay resident — records never carry secrets');
  assert.match(guard, /Register #1 precedence/,
    'Register #1 precedence over any skip must stay resident');
});

// The two directions of "move, not copy", hoisted so they can be floored — these strings are what
// the ticket's AC offers as proof that the move was a move.
const MOVED_TO_CONTRACT = ['Gate Derivation', 'Circuit Breaker', 'scope_reason', 'monotonic precise union'];
const RESIDENT_ONLY = [
  '[OUT_OF_SCOPE_DEFERRED] file:line',
  '[USER_SKIPPED] key=<file',
  '[OPPORTUNISTIC_BUDGET] class=<closed',
  '[OPPORTUNISTIC_FIX] key=<file',
  '[OPPORTUNISTIC_DEFERRED] key=<file',
];

test('resident guard when it defers → it names the contract file that carries the mechanics', () => {
  assert.match(rule, /skills\/codex-code-review\/references\/scope-contract\.md/,
    'the guard must name its contract, or the on-demand half is unreachable from an ad-hoc session');
  // Move, not copy: the detailed mechanics must not also be resident.
  // Floored at their exact lengths. Without this, dropping 'Gate Derivation' from the list and
  // re-adding a `## Gate Derivation` section to the resident rule passes the whole suite — the
  // split-brain this extraction exists to prevent, reachable with nothing red.
  assert.equal(MOVED_TO_CONTRACT.length, 4, 'the move-not-copy list must not shrink');
  assert.equal(RESIDENT_ONLY.length, 5, 'the resident-only list must not shrink');
  for (const moved of MOVED_TO_CONTRACT) {
    assert.ok(!rule.includes(moved), `"${moved}" must live in the contract only, not in both`);
  }
  // …and the reverse direction, which the first version of this guard missed entirely: the two
  // literal record formats are emitted during a fix pass, possibly before anything is loaded, so
  // they stay RESIDENT — and the contract must not restate them. A verbatim duplicate here is the
  // same split-brain, just pointing the other way.
  for (const resident of RESIDENT_ONLY) {
    assert.ok(!contract.includes(resident),
      `"${resident}" must live in the resident guard only — the contract points at it, never restates it`);
  }
});

// ── rules/fix-all-issues.md (the third carrier) ───────────────────────────────────────────────
// The obligation axis is stated in three files and an executor may read any one of them alone.
// Until this test existed, reverting every change in fix-all-issues.md left the suite green — so
// the file that actually tells an executor what to fix was the one nothing guarded.

test('fix-all-issues when read → the obligation is owed-scoped and admitted survives the threshold', () => {
  // Preamble: the sentence an executor reads first.
  assert.match(fixAll, /Every \*owed\* in-scope blocking issue gets fixed/,
    'the headline obligation must be owed-scoped');
  assert.match(fixAll, /only a proven causal-independence classification followed by a recorded `\[OPPORTUNISTIC_DEFERRED\]` does/,
    '"pre-existing" alone must still not remove the obligation');
  // The scope paragraph must not re-bound the obligation by severity alone — that is the
  // contradiction that lets an admitted P2 be dropped after the mandatory P1 is fixed.
  assert.match(fixAll, /`fix_obligation=mandatory` at or above the tier's blocking severity, \*\*plus\*\* every `fix_obligation=admitted` finding at any severity/,
    'the obligation definition must carry the admitted disjunct unbounded by severity');

  // The exception table: the new row, and the two rows it must not silently widen.
  const exceptions = section(fixAll, 'Exceptions');
  assert.match(exceptions, /\| Opportunistic budget deferral \|/,
    'the opportunistic deferral exception row must exist');
  const row = exceptions.split('\n').find((l) => l.startsWith('| Opportunistic budget deferral'));
  assert.match(row, /\[OPPORTUNISTIC_DEFERRED\]/, 'the row names its record');
  for (const never of ['origin=in-diff', 'branch-introduced', '`uncertain`',
    'change_relation=affected', 'P0', 'security', 'data-integrity']) {
    assert.ok(row.includes(never), `the never-applies list must name ${never}`);
  }
  assert.match(row, /already `admitted`, which is owed at any severity/,
    'an admitted finding must not be deferrable through this exception');
  // Record selection is severity × obligation here too, or a standard-tier independent P2 is
  // logged under the wrong disposition by the file an executor reads first.
  assert.match(row, /`\[OPPORTUNISTIC_DEFERRED\]` when at or above the tier's blocking severity; a sub-threshold non-admitted candidate keeps `\[NIT_DEFERRED\]` \(one record per finding, never both\)/,
    'the exception row must choose the record by severity');
  // The below-threshold exception is where an admitted P2 would otherwise escape.
  const below = exceptions.split('\n').find((l) => l.startsWith("| Below the tier's blocking severity"));
  assert.match(below, /\*\*Not available to a `fix_obligation=admitted` finding\*\*/,
    'the below-threshold exception must exclude admitted findings');

  // Precedence: the closing paragraph must agree with the preamble.
  const precedence = section(fixAll, 'Precedence');
  assert.match(precedence, /\*\*in-scope, owed\*\* findings/, 'precedence is owed-scoped');
  // The resident expansion must match the canonical predicate exactly: the severity bound belongs
  // to `mandatory` alone. Dropping it here made a mandatory P2 owed under `standard`, manufacturing
  // blocking work — the mirror of the escape the rest of this suite guards against.
  assert.match(precedence, /`fix_obligation=mandatory` \*\*at or above the tier's blocking severity\*\*, or `fix_obligation=admitted` at \*\*any\*\* severity/,
    'the resident expansion must carry the severity bound on mandatory only');
  assert.match(precedence, /the severity bound applies to `mandatory` alone, exactly as in the preamble above/,
    'the two resident copies must agree by construction');
  assert.match(precedence, /except an `admitted` one/,
    'the NIT_DEFERRED sentence must carve out admitted findings');
  // Record selection in the Precedence paragraph too — an executor may read only this section.
  assert.match(precedence, /`\[OPPORTUNISTIC_DEFERRED\]` \*\*when at or above the blocking line\*\* and with `\[NIT_DEFERRED\]` below it \(one record per finding, never both\)/,
    'the Precedence paragraph must choose the record by severity, one per finding');
});
