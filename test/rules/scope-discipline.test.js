'use strict';

// Pins the structural contract of rules/scope-discipline.md (issue #12): the six-row behavior
// table, the two record formats, the closed-set options with their Anchor-first bounds, the
// circuit breaker's freeze/no-deferral semantics, the fail-closed scope reading, and the E1/E2
// human-exit enumeration plus the closed-list union sentence in CLAUDE.md / CLAUDE.template.md.
// Weakening any of these is a reviewed spec change, not a wording tweak.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const rule = readFileSync(resolve(root, 'rules/scope-discipline.md'), 'utf8');

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

test('behavior table when parsed → exactly the six closed rows, in order', () => {
  const rows = parseTable(section(rule, 'Behavior Table'), ['Finding', 'Behavior']);
  assert.equal(rows.length, 6, 'the behavior table is closed: exactly six data rows');
  assert.deepEqual(rows.map((r) => r[0]), [
    'in-scope ∧ ≥ tier blocking severity',
    'in-scope ∧ sub-threshold',
    'out-of-scope ∧ not critical',
    'out-of-scope ∧ critical ∧ no valid `[USER_SKIPPED]`',
    'out-of-scope ∧ critical ∧ valid `[USER_SKIPPED]`',
    'user explicitly says "fix it together"',
  ], 'the six finding classes, in this order');
  assert.match(rows[0][1], /zero tolerance unchanged/, 'in-scope blocking keeps fix-all-issues');
  assert.match(rows[2][1], /does not block `✅ Ready`/, 'non-critical out-of-scope must not block');
  assert.match(rows[3][1], /human exit E1/, 'critical out-of-scope routes to E1');
  assert.match(rows[3][1], /a pass must not be noted/, 'no pass may be noted on the E1 row');
  assert.match(rows[3][1], /does \*\*not\*\* enter the fix loop/, 'the model must not auto-fix the E1 row');
});

test('record formats when pinned → both literal field orders survive verbatim', () => {
  assert.ok(
    rule.includes('[OUT_OF_SCOPE_DEFERRED] file:line | issue | suggested-ticket | <ISO8601>'),
    'OUT_OF_SCOPE_DEFERRED field order is a literal contract'
  );
  assert.ok(
    rule.includes('[USER_SKIPPED] key=<file|canonical_issue> | authorized_at=<ISO8601> | scope=<task-id>'),
    'USER_SKIPPED field order is a literal contract'
  );
  assert.match(section(rule, 'Records (reporting conventions)'), /no TTL, no hook parsing, no\npersistence|no TTL, no hook parsing, no persistence/,
    'records are reporting conventions, not machine inputs');
  assert.match(section(rule, 'Records (reporting conventions)'), /never contain secrets/,
    'Register #2: records must never carry secrets');
});

test('closed-set options when enumerated → exactly three, skip never offered, Anchor-first carve-out', () => {
  const opts = section(rule, 'Closed-Set Options (human exit E1)');
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
  const opts = section(rule, 'Closed-Set Options (human exit E1)');
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
  const det = section(rule, 'Scope Determination (mechanical — any one condition ⇒ in-scope)');
  assert.match(det, /`uncertain` is \*\*fail-closed: treated as in-scope\*\*/);
  assert.match(det, /\*\*complete negative evidence\*\*/);
  assert.match(det, /any missing negative ⇒ `uncertain`/);
  assert.match(det, /\*\*one hop only\*\*/);
  assert.match(det, /No transitive expansion/);
  assert.match(det, /condition 2\s+is always negative/, 'non-code files have no call-path condition');
});

test('scope baseline when frozen → immutable, monotonic union only, no rediscovery', () => {
  const base = section(rule, 'Scope Baseline (task-level, immutable)');
  assert.match(base, /\*\*frozen for the whole review session\*\*/);
  assert.match(base, /no path may recompute it/);
  assert.match(base, /\*\*monotonic precise union\*\*/);
  assert.match(base, /\*\*Never re-run the\s+discovery commands\*\*/);
  assert.match(base, /never proceed on an empty baseline/);
  assert.match(base, /parameter error/, 'BASE_BRANCH exhaustion aborts as a parameter error');
  assert.match(base, /not a human exit/);
  assert.match(base, /git rev-parse\s*\n?--verify|git rev-parse --verify/, 'each base candidate is verified');
});

test('circuit breaker when triggered → stops expansion only, root bucket exists, no blocking deferral', () => {
  const brk = section(rule, 'Circuit Breaker (stops expansion; never rewrites scope)');
  assert.match(brk, /counters are round-scoped/);
  assert.match(brk, /never write back into it/);
  assert.match(brk, /`<root>`/, 'repo-root files map to the virtual <root> bucket');
  assert.match(brk, /\*\*only stops further expansion\*\*/);
  assert.match(brk, /\*\*no reclassifying force\*\*/);
  const rows = parseTable(brk, ['Remaining finding', 'Disposition']);
  assert.equal(rows.length, 3, 'the breaker disposition table is closed: three rows');
  assert.match(rows[1][1], /\*\*Must not be deferred\*\*/, 'in-scope blocking survives the breaker');
  assert.match(rows[1][1], /human exit E2/);
});

test('gate derivation when read → derived values outrank declarations, underivable is Blocked×BOTH', () => {
  const gate = section(rule, 'Gate Derivation (normalization-first)');
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
  const exits = section(rule, 'Human Exits (enumerated here — closed list)');
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
  const anchor = section(rule, 'Anchor Compatibility (inherited Register hits — resolution step 0)');
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
  assert.ok(neverOffer.test(rule), 'the rule itself must carry the never-offer sentence');
  assert.ok(neverOffer.test('**Skip is never offered proactively.** A skip exists only when raised.'),
    'guard fixture: the sentence shape must be caught');
  assert.ok(!neverOffer.test('The model may skip proactively offering praise in reviews.'),
    'ordinary data using the same words must not satisfy the guard');

  const noDeferral = /\*\*Must not be deferred\*\*/;
  assert.ok(noDeferral.test(rule), 'the breaker table must carry the no-deferral cell');
  assert.ok(noDeferral.test('| in-scope ∧ ≥ blocking | **Must not be deferred**: stays Blocked |'),
    'guard fixture: the cell shape must be caught');
  assert.ok(!noDeferral.test('Deferred findings must not be forgotten at task end.'),
    'ordinary deferral prose must not satisfy the guard');
});
