/**
 * The hook suites run against a HAND-WRITTEN jq stub (see `setupStubBin` in stop-guard.test.js and
 * post-tool-review-state.test.js). The stub does not evaluate jq — it pattern-matches a query
 * fragment and then re-implements, in JavaScript, what the production filter is *supposed* to do.
 *
 * That makes those suites blind to a whole class of regression: delete a clause from the
 * production filter and the stub keeps enforcing it, so the tests stay green while the hook no
 * longer validates anything. It also hides the reverse — a filter that real jq rejects outright,
 * or evaluates with semantics the stub author guessed wrong (jq's `//` treating `false` as
 * missing is exactly such a case, and it shipped as a live fail-open before it was found).
 *
 * These tests close both directions by EXTRACTING the production filter text from the hook source
 * and running it under the real `jq` binary. Nothing is re-implemented here: if the source loses a
 * clause, the assertion below sees the loss. Skipped rather than failed when jq is absent, since
 * the hooks themselves already degrade in that case.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const HAVE_JQ = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;

const stopGuard = readFileSync(resolve(__dirname, '../../hooks/stop-guard.sh'), 'utf8');

/**
 * Pull a single-quoted jq program out of a shell assignment. Shell single-quoting cannot contain a
 * literal `'`, so the first `'` after the marker opens the program and the next one closes it —
 * no escaping rules to replicate, which is why the extraction can be this direct.
 */
function extractFilter(source, marker) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `marker not found in hook source: ${marker}`);
  const open = source.indexOf("'", at);
  const close = source.indexOf("'", open + 1);
  assert.ok(open !== -1 && close !== -1, `could not delimit the jq program after ${marker}`);
  return source.slice(open + 1, close);
}

const ITER_FILTER = extractFilter(stopGuard, 'ITER_PARSED=$(jq -r ');
// The malformed-SCALAR guard. Extracted the same way and for a sharper reason than the iteration
// filter: the stub in stop-guard.test.js keys on `query.includes('def _tv(')` and then re-implements
// EVERY clause unconditionally, so the suite proves only that the whole `if … fi` block is present.
// Delete one clause — `(.has_code_change|_tv("boolean")) and ` — and all 151 stop-guard tests stay
// green while the real hook flips from `exit 2` to `{"ok":true}` on `{"has_code_change": []}`.
// Per-field cases under real jq are the only thing that pins each clause individually.
const TV_FILTER = extractFilter(stopGuard, '[[ "$STATE_CORRUPT" != "true" ]] && ! jq -e ');

function runFilter(filter, json) {
  const r = spawnSync('jq', ['-r', filter], { input: JSON.stringify(json), encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
}

test('the extracted iteration filter is a program real jq accepts', { skip: !HAVE_JQ }, () => {
  // A filter that only ever ran against the stub could be syntactically invalid and no suite would
  // notice — the stub never parses it.
  const r = runFilter(ITER_FILTER, { iteration_history: { current_round: 1, max_rounds: 10 } });
  assert.equal(r.status, 0, `real jq rejected the production filter:\n${r.err}`);
  assert.equal(r.out, '1 10');
});

test('real jq: a boolean counter is corrupt, NOT a refunded budget', { skip: !HAVE_JQ }, () => {
  // The regression this filter was rewritten for. `(.current_round // 0)` maps `false` to 0
  // because jq's alternative operator treats false as missing, so `{"current_round": false}` read
  // as a fully unspent budget and silently disarmed the only enforced convergence exit.
  for (const ih of [
    { current_round: false, max_rounds: false },
    { current_round: false, max_rounds: 10 },
    { current_round: 3, max_rounds: false },
  ]) {
    assert.equal(runFilter(ITER_FILTER, { iteration_history: ih }).out, 'corrupt', JSON.stringify(ih));
  }
});

test('real jq: a non-object iteration_history is corrupt, not an empty default', { skip: !HAVE_JQ }, () => {
  for (const ih of [false, 'nope', 7, ['a']]) {
    assert.equal(runFilter(ITER_FILTER, { iteration_history: ih }).out, 'corrupt', JSON.stringify(ih));
  }
});

test('real jq: absent iteration_history takes the documented defaults', { skip: !HAVE_JQ }, () => {
  assert.equal(runFilter(ITER_FILTER, {}).out, '0 30');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: null }).out, '0 30');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: {} }).out, '0 30');
});

test('real jq: non-integer and out-of-range counters are corrupt', { skip: !HAVE_JQ }, () => {
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 3.5, max_rounds: 10 } }).out, 'corrupt');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: -1, max_rounds: 10 } }).out, 'corrupt');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 1, max_rounds: 0 } }).out, 'corrupt');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 200001, max_rounds: 10 } }).out, 'corrupt');
});

test('real jq: max_rounds is CLAMPED to the producer contract (3..50)', { skip: !HAVE_JQ }, () => {
  // `_read_project_int_setting` (post-tool-review-state.sh) admits 3..50 and otherwise falls back
  // to 30, so a persisted 100000 did not come from the documented path. Accepting it as written is
  // how the hard cap gets disarmed: round 51 under a 100000 budget reads as barely started, and
  // that cap is the ONLY convergence exit stop-guard enforces. `.claude_review_state.json` is an
  // ordinary writable file, so "nothing legitimate writes it" is not the same as "nothing does".
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 51, max_rounds: 100000 } }).out, '51 50');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 0, max_rounds: 1 } }).out, '0 3');
  // In-contract values pass through untouched — clamping must not rewrite a legitimate config.
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 2, max_rounds: 3 } }).out, '2 3');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 9, max_rounds: 50 } }).out, '9 50');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 4, max_rounds: 10 } }).out, '4 10');
});

// --- The malformed-scalar guard, one assertion per validated field ---

// A state object that the guard must ACCEPT. Each negative case below is this object with exactly
// one field replaced, so a failure names the clause that stopped enforcing.
const WELL_TYPED = {
  has_code_change: true,
  has_doc_change: false,
  review_phase: 'pending_review',
  review_mode: 'dual',
  code_review: { passed: true },
  doc_review: { passed: false },
  precommit: { passed: true, mode: 'full' },
  aggregate_gate: { executed: true, gate: 'READY' },
};

function tv(state) {
  return runFilter(TV_FILTER, state).out;
}

test('real jq: the extracted malformed-scalar guard accepts a well-typed state', { skip: !HAVE_JQ }, () => {
  const r = runFilter(TV_FILTER, WELL_TYPED);
  assert.equal(r.status, 0, `real jq rejected the production filter:\n${r.err}`);
  assert.equal(r.out, 'true');
});

test('real jq: null is accepted for every validated field (absent ≠ malformed)', { skip: !HAVE_JQ }, () => {
  // `_tv` is `(.==null) or (type==t)` — the guard must not turn an unset field into corruption,
  // or a freshly created state file would fail closed on every stop.
  assert.equal(tv({}), 'true');
  assert.equal(tv({ has_code_change: null, review_mode: null, precommit: { passed: null, mode: null } }), 'true');
});

test('real jq: EACH validated scalar is individually rejected when malformed', { skip: !HAVE_JQ }, () => {
  // One case per clause. Deleting any single clause from the production filter turns exactly one
  // of these from 'false' to 'true' — which is the granularity the jq-stub suite cannot reach.
  const cases = [
    ['has_code_change', { has_code_change: [] }],
    ['has_doc_change', { has_doc_change: 'yes' }],
    ['review_phase', { review_phase: 7 }],
    ['review_mode', { review_mode: ['dual'] }],
    ['code_review.passed', { code_review: { passed: 'true' } }],
    ['doc_review.passed', { doc_review: { passed: 1 } }],
    ['precommit.passed', { precommit: { passed: 'true', mode: 'full' } }],
    ['precommit.mode', { precommit: { passed: true, mode: ['fast'] } }],
    ['aggregate_gate.executed', { aggregate_gate: { executed: 'true', gate: 'READY' } }],
    ['aggregate_gate.gate', { aggregate_gate: { executed: true, gate: 99 } }],
  ];
  for (const [field, override] of cases) {
    assert.equal(
      tv({ ...WELL_TYPED, ...override }),
      'false',
      `the guard stopped rejecting a malformed ${field} — its clause is missing from the production filter`
    );
  }
});

test('real jq: a NON-OBJECT nested parent is passed through, not re-flagged here', { skip: !HAVE_JQ }, () => {
  // Deliberate division of labour, and worth pinning so it is not "fixed" into the guard: a
  // string-valued `code_review` would make `.code_review.passed` raise an index error, which the
  // `2>/dev/null || echo false` reads downstream already turn into the safe default. The
  // `if (parent|type)=="object"` wrappers exist so this filter does not double-handle it.
  assert.equal(tv({ ...WELL_TYPED, code_review: 'oops' }), 'true');
  assert.equal(tv({ ...WELL_TYPED, precommit: 42 }), 'true');
  assert.equal(tv({ ...WELL_TYPED, aggregate_gate: ['x'] }), 'true');
});

test('real jq: a huge digit-only string counter does not sneak past as a number', { skip: !HAVE_JQ }, () => {
  // Bash arithmetic would WRAP such a value and compare as under the cap; the filter must reject it
  // as a string before it ever reaches `[[ -ge ]]`.
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: '12', max_rounds: 10 } }).out, 'corrupt');
});

// --- The WRITER-side convergence reset (post-tool-review-state.sh update_state) ---
//
// The reader above CLASSIFIES a counter (valid / corrupt / clamped). The writer QUALIFIES one for
// reset, and it runs FIRST — so anything the writer is willing to launder is already gone by the
// time the reader would have refused it. That asymmetry is the whole bug class: the writer's guard
// once checked only `type == "number"` and compared against the RAW `max_rounds`, so
// `{current_round: 51, max_rounds: 100000}` reset to a clean 0 even though the reader clamps the
// cap to 3..50 and reads that same state as an EXHAUSTED budget. The evidence for the only
// convergence exit currently enforced was destroyed by the hook that was supposed to preserve it.
//
// The stubbed hook suites cannot catch this: their jq stub re-implements the reset in JavaScript,
// where `(value || default)` diverges from jq on `false` and no clamp exists at all. So the writer
// filter is extracted and run under real jq here, against the SAME fixtures as the reader, and the
// two are asserted to agree on every one.
const reviewState = readFileSync(resolve(__dirname, '../../hooks/post-tool-review-state.sh'), 'utf8');

/**
 * The writer program is multi-line and contains `$key`-style refs but no literal `'`, so the same
 * single-quote delimiting works. Anchored on the first clause rather than the assignment, because
 * the program sits inline in an `if jq … ; then`.
 */
const RESET_FILTER = (() => {
  const at = reviewState.indexOf("'.[$key].executed = $executed");
  assert.notEqual(at, -1, 'update_state jq program not found in post-tool-review-state.sh');
  const close = reviewState.indexOf("'", at + 1);
  assert.notEqual(close, -1, 'could not delimit the update_state jq program');
  return reviewState.slice(at + 1, close);
})();

/**
 * `$rmr` is the RESOLVED project cap, and the filter resets only when the persisted cap already
 * equals it — the fail-closed gate for a reconciliation that silently failed (it returns 0 either
 * way by contract). That gate is orthogonal to the budget ARITHMETIC these differential tests
 * exist to pin, so unless a case is specifically about freshness, `rmr` defaults to the input's own
 * cap: the state a SUCCESSFUL reconciliation leaves behind. Neutralising it here is what keeps the
 * reader/writer comparison about the clamp and canonicality mirror rather than about config drift.
 * The gate itself is covered separately below.
 */
function resolveRmr(rawJson, override) {
  if (override !== undefined) return String(override);
  const m = /"max_rounds"\s*:\s*(-?[0-9][0-9eE+.\-]*)/.exec(rawJson);
  return m ? m[1] : '30';
}

function runReset(iterationHistory, { key = 'precommit', passed = true, rmr } = {}) {
  const input = JSON.stringify({ iteration_history: iterationHistory });
  const r = spawnSync(
    'jq',
    ['-c', '--arg', 'key', key, '--argjson', 'rmr', resolveRmr(input, rmr),
      '--argjson', 'executed', 'true', '--argjson', 'passed', String(passed),
      '--arg', 'mode', '', '--arg', 'now', 'T', RESET_FILTER],
    { input, encoding: 'utf8' }
  );
  return { status: r.status, err: r.stderr || '', doc: r.stdout ? JSON.parse(r.stdout) : null };
}

const RESET_FIXTURE = { findings_by_round: [{ total: 1 }] };
const wasReset = (ih) => ih && ih.current_round === 0 && Array.isArray(ih.findings_by_round)
  && ih.findings_by_round.length === 0;

test('the extracted reset filter is a program real jq accepts', { skip: !HAVE_JQ }, () => {
  const r = runReset({ current_round: 1, max_rounds: 10, ...RESET_FIXTURE });
  assert.equal(r.status, 0, `real jq rejected the production reset filter:\n${r.err}`);
});

test('real jq: convergence clears the stall streak and the stall memory with the round counter', { skip: !HAVE_JQ }, () => {
  // The reset marks the end of one change. A streak surviving it counts rounds from the change
  // that just converged against the next one, and a surviving memory replays that change's failed
  // adjustments under the next change's diagnosis — the memory would then never be about the work
  // in front of the model.
  const stalled = {
    current_round: 4,
    max_rounds: 15,
    stall_streak: 3,
    stall_memory: [{ class: 'ATTENTION_DIFFUSION', tried: 'split the batch', outcome: 'no change', ts: 'T' }],
    ...RESET_FIXTURE,
  };
  const after = runReset(stalled).doc.iteration_history;
  assert.equal(wasReset(after), true, 'precondition: this input takes the reset path');
  assert.equal(after.stall_streak, 0);
  assert.deepEqual(after.stall_memory, []);

  // Negative control: on a path that does NOT reset, both must survive untouched — otherwise the
  // assertions above would also pass if the clause cleared them unconditionally.
  const kept = runReset(stalled, { passed: false }).doc.iteration_history;
  assert.equal(wasReset(kept), false, 'precondition: a failing precommit does not reset');
  assert.equal(kept.stall_streak, 3, 'a mid-change streak must not be cleared by a failing gate');
  assert.deepEqual(kept.stall_memory, stalled.stall_memory);
});

test('real jq: a counter the READER would call exhausted is never refunded by the writer', { skip: !HAVE_JQ }, () => {
  // 51 < 100000 raw, but the reader clamps the cap to the producer contract (3..50) and reads
  // 51/50 = spent. Pinned against the reader's own answer so the two cannot drift apart.
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 51, max_rounds: 100000 } }).out, '51 50');
  const r = runReset({ current_round: 51, max_rounds: 100000, ...RESET_FIXTURE });
  assert.equal(wasReset(r.doc.iteration_history), false, 'an exhausted budget must survive a passing precommit');
  assert.equal(r.doc.iteration_history.current_round, 51);
  assert.deepEqual(r.doc.iteration_history.findings_by_round, RESET_FIXTURE.findings_by_round);
});

test('real jq: every shape the READER calls corrupt is refused by the writer too', { skip: !HAVE_JQ }, () => {
  // jq has no integer type, so `type == "number"` alone admits 3.5 — which the reader rejects
  // outright because bash arithmetic would mis-parse it. `false` is the `//` hazard. Each of these
  // must reach stop-guard intact for it to fail closed on them.
  const corrupt = [
    { current_round: 3.5, max_rounds: 10 },
    { current_round: false, max_rounds: 10 },
    { current_round: 3, max_rounds: false },
    { current_round: -1, max_rounds: 10 },
    { current_round: 200001, max_rounds: 10 },
    { current_round: 1, max_rounds: 0 },
    { current_round: '4', max_rounds: 10 },
  ];
  for (const ih of corrupt) {
    assert.equal(runFilter(ITER_FILTER, { iteration_history: ih }).out, 'corrupt', `reader: ${JSON.stringify(ih)}`);
    const r = runReset({ ...ih, ...RESET_FIXTURE });
    assert.equal(wasReset(r.doc.iteration_history), false, `writer reset a corrupt counter: ${JSON.stringify(ih)}`);
  }
});

test('real jq: a non-object iteration_history neither errors nor resets', { skip: !HAVE_JQ }, () => {
  // Indexing a boolean/string/array with a key is a hard jq ERROR, which would abort the whole
  // update_state write — losing the VERDICT as well as the counter. The object-type guard runs
  // first precisely so a corrupt counter cannot take the gate write down with it.
  for (const ih of [false, true, 'x', 42, []]) {
    const r = runReset(ih);
    assert.equal(r.status, 0, `jq errored on iteration_history=${JSON.stringify(ih)}:\n${r.err}`);
    assert.deepEqual(r.doc.iteration_history, ih);
    assert.equal(r.doc.precommit.passed, true, 'the verdict must still be recorded');
  }
});

test('real jq: a valid below-cap counter IS reset, including the clamped-up cap', { skip: !HAVE_JQ }, () => {
  // The reset must still work, or the whole guard is just a disabled feature.
  for (const [ih, why] of [
    [{ current_round: 4, max_rounds: 10 }, 'ordinary below-cap'],
    [{ current_round: 9, max_rounds: 50 }, 'at the contract maximum'],
    [{ current_round: 2, max_rounds: 1 }, 'cap clamps UP to 3, so 2 is still unspent'],
    [{ current_round: 4 }, 'absent max_rounds takes the documented default 30'],
  ]) {
    const r = runReset({ ...ih, ...RESET_FIXTURE });
    assert.equal(wasReset(r.doc.iteration_history), true, `should have reset (${why}): ${JSON.stringify(ih)}`);
  }
});

test('real jq: the reset needs BOTH a pass and the precommit key', { skip: !HAVE_JQ }, () => {
  // `doc_review` used to reset this too — a cross-plane refund, since only code review increments
  // it. And a FAILING precommit costs budget exactly like a passing one.
  const below = { current_round: 4, max_rounds: 10, ...RESET_FIXTURE };
  assert.equal(wasReset(runReset(below, { key: 'doc_review' }).doc.iteration_history), false);
  assert.equal(wasReset(runReset(below, { key: 'code_review' }).doc.iteration_history), false);
  assert.equal(wasReset(runReset(below, { passed: false }).doc.iteration_history), false);
  assert.equal(wasReset(runReset(below).doc.iteration_history), true, 'control: the passing precommit path still resets');
});

// --- Differential: reader and writer must agree on EVERY input ---
//
// The two filters are hand-mirrored (the hooks are installed individually and share no library, so
// there is no file to extract a common classifier into). "Mirrored by inspection" is worth nothing;
// this section makes it mirrored BY TEST.
//
// Fixtures are RAW JSON TEXT, not objects. That is load-bearing. jq preserves the literal number
// representation from its input — jq 1.8 round-trips `1e1` as `1E+1` and keeps `-0` as `-0` — and
// the reader's final gate is a BASH regex (`^([0-9]+)[[:space:]]([0-9]+)$`) that rejects both. A
// fixture built as a JS object and serialised with JSON.stringify() CANNOT express that input:
// `JSON.stringify({current_round: 1e1})` is `{"current_round":10}`. So the object-based tests above
// were structurally incapable of seeing the disagreement, and reported green while a passing
// precommit laundered reader-corrupt state into a clean 0.
function runFilterRaw(filter, rawJson) {
  const r = spawnSync('jq', ['-r', filter], { input: rawJson, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
}

function runResetRaw(rawJson, rmr) {
  const r = spawnSync(
    'jq',
    ['-c', '--arg', 'key', 'precommit', '--argjson', 'rmr', resolveRmr(rawJson, rmr),
      '--argjson', 'executed', 'true', '--argjson', 'passed', 'true',
      '--arg', 'mode', '', '--arg', 'now', 'T', RESET_FILTER],
    { input: rawJson, encoding: 'utf8' }
  );
  return { status: r.status, err: r.stderr || '', doc: r.stdout ? JSON.parse(r.stdout) : null };
}

// Every shape either filter has an opinion about, written the way a tampered or hand-edited state
// file could actually contain it — including representations JSON.stringify can never produce.
// GENERATED, not hand-listed. The hand-listed version had 21 entries and missed the one shape that
// mattered: `max_rounds` in exponent form OUTSIDE 3..50. The reader CLAMPS the cap before emitting
// it, so `1e2` reads as a perfectly valid `4 50` while the writer — testing the raw `1E+2` — refused
// to reset. Its `5e1` entry sits INSIDE the band, where the clamp is a no-op, so it exercised the
// opposite path and the divergence stayed invisible. A curated corpus decays exactly like that: it
// records the cases someone already thought of.
//
// So enumerate the input SPACE instead — every literal form × every interesting magnitude, on both
// fields independently. `4` and `4.0` and `4e0` are the same NUMBER and three different LITERALS,
// and jq preserves the literal; that distinction is the whole subject of this file, so it belongs
// on the axis rather than in a comment.
const LITERAL_FORMS = [
  (n) => `${n}`,          // canonical
  (n) => `${n}.0`,        // trailing zero  → jq keeps "4.0"
  (n) => `${n}e0`,        // exponent, ×1   → jq keeps "4E+0"
];
const MAGNITUDES = [0, 1, 2, 3, 4, 10, 49, 50, 51, 100, 100000];

function buildCorpus() {
  const out = new Set();
  const push = (r, m) => out.add(`{"iteration_history":{"current_round":${r},"max_rounds":${m},"findings_by_round":[1]}}`);

  for (const magR of MAGNITUDES) {
    for (const magM of MAGNITUDES) {
      // Canonical × canonical is the ordinary case; the literal-form axis is applied to one field
      // at a time so a disagreement names which side carries the non-canonical value.
      push(magR, magM);
      for (const form of LITERAL_FORMS.slice(1)) {
        push(form(magR), magM);
        push(magR, form(magM));
      }
    }
  }
  // Exponent forms that JS would collapse (1e1 === 10) but jq keeps distinct, on both fields.
  for (const lit of ['1e1', '5e1', '1e2', '3e0', '1E+1', '-0']) {
    push(lit, 10);
    push(4, lit);
  }
  // Non-numeric and out-of-range scalars: both filters must refuse these.
  for (const bad of ['3.5', 'false', 'true', '"4"', 'null', '-1', '200001', '[]', '{}']) {
    push(bad, 10);
    push(4, bad);
  }
  // Missing fields → each side's documented default.
  out.add('{"iteration_history":{"findings_by_round":[1]}}');
  out.add('{"iteration_history":{"current_round":4,"findings_by_round":[1]}}');
  out.add('{"iteration_history":{"max_rounds":10,"findings_by_round":[1]}}');
  return [...out];
}

const DIFFERENTIAL_CORPUS = buildCorpus();

// Shapes where the two filters legitimately differ, with the reason. Enumerated rather than quietly
// omitted: an undocumented exclusion is indistinguishable from an unnoticed bug, and the previous
// corpus dropped both of these without saying so while its test name claimed "EVERY input".
const EXPECTED_DIVERGENCE = new Map([
  ['{"iteration_history":null}',
    'reader maps a null history to the documented default "0 30" (unspent); the writer requires an '
    + 'OBJECT parent because its reset would otherwise CREATE iteration_history out of nothing. '
    + 'Refusing is the safe half — there is no round budget to refund when no history exists.'],
  ['{}',
    'same as above: absent history reads as "0 30" but there is nothing to reset.'],
]);

test('real jq: reader and writer agree on every input in the corpus', { skip: !HAVE_JQ }, () => {
  const disagreements = [];
  for (const raw of DIFFERENTIAL_CORPUS) {
    const readerOut = runFilterRaw(ITER_FILTER, raw).out;
    const written = runResetRaw(raw);
    assert.equal(written.status, 0, `writer errored on ${raw}:\n${written.err}`);
    const ih = written.doc.iteration_history;
    const didReset = ih && ih.current_round === 0 && Array.isArray(ih.findings_by_round)
      && ih.findings_by_round.length === 0;

    // The reader's verdict is the bash-regex-validated pair, so replicate that gate here rather
    // than trusting jq's raw output text.
    const m = readerOut.match(/^([0-9]+) ([0-9]+)$/);
    let shouldReset;
    if (readerOut === 'corrupt' || !m) shouldReset = false;      // reader refuses it → never refund
    else shouldReset = Number(m[1]) < Number(m[2]);              // unspent budget → reset is correct

    if (didReset !== shouldReset) {
      disagreements.push(`${raw}\n    reader=${JSON.stringify(readerOut)} shouldReset=${shouldReset} writerReset=${didReset}`);
    }
  }
  assert.deepEqual(disagreements, [], `writer/reader disagreement:\n  ${disagreements.join('\n  ')}`);
});

test('the documented divergences are the only ones, and each still behaves as documented', { skip: !HAVE_JQ }, () => {
  // EXPECTED_DIVERGENCE is an escape hatch, so it needs its own guard: an entry that has silently
  // become agreeing would sit there forever pretending to excuse something.
  for (const [raw, why] of EXPECTED_DIVERGENCE) {
    const readerOut = runFilterRaw(ITER_FILTER, raw).out;
    const m = readerOut.match(/^([0-9]+) ([0-9]+)$/);
    assert.ok(m && Number(m[1]) < Number(m[2]), `reader should read ${raw} as unspent budget — ${why}`);

    const written = runResetRaw(raw);
    assert.equal(written.status, 0, `writer errored on ${raw}`);
    assert.equal(
      written.doc.iteration_history ?? null, null,
      `the writer must NOT materialise iteration_history for ${raw} — ${why}`
    );
  }
});

test('real jq: the corpus actually exercises both verdicts (not vacuously one-sided)', { skip: !HAVE_JQ }, () => {
  // A corpus that happened to be all-corrupt would make the differential test above pass while
  // proving nothing about the reset path.
  assert.ok(DIFFERENTIAL_CORPUS.length >= 400, `generated corpus looks truncated: ${DIFFERENTIAL_CORPUS.length}`);
  const outs = DIFFERENTIAL_CORPUS.map((raw) => runFilterRaw(ITER_FILTER, raw).out);
  const unspent = outs.filter((o) => { const m = o.match(/^([0-9]+) ([0-9]+)$/); return m && Number(m[1]) < Number(m[2]); });
  const refused = outs.filter((o) => { const m = o.match(/^([0-9]+) ([0-9]+)$/); return !m || Number(m[1]) >= Number(m[2]); });
  assert.ok(unspent.length >= 40, `corpus should contain resettable states, got ${unspent.length}`);
  assert.ok(refused.length >= 40, `corpus should contain refused states, got ${refused.length}`);
  // The clamp axis specifically: an out-of-band cap in exponent form must reach the reader as a
  // VALID clamped pair. This is the shape the hand-listed corpus lacked, and the reason the writer
  // has to canonicality-test the clamp's OUTPUT rather than its input.
  assert.equal(runFilterRaw(ITER_FILTER, '{"iteration_history":{"current_round":4,"max_rounds":1e2}}').out, '4 50');
  // And specifically: the non-canonical literals must land on the REFUSED side, or the fixture has
  // been normalised somewhere and the regression it guards is invisible again.
  assert.equal(runFilterRaw(ITER_FILTER, '{"iteration_history":{"current_round":1e1,"max_rounds":5e1}}').out, '1E+1 5E+1');
});

// ===========================================================================
// _reconcile_max_rounds — the cap-refresh filter pair
//
// Same blindness as above, one layer down: the hook suites stub `.iteration_history.max_rounds //
// empty` and `.iteration_history.max_rounds = $mr` in JavaScript, so they assert what the stub
// author believed jq does. Two of those beliefs are load-bearing and neither is obvious —
// `//` treating `false` as missing, and `-r` normalising exponent literals — so pin both under the
// real binary. Contract: hooks/post-tool-review-state.sh § _reconcile_max_rounds.
// ===========================================================================

const editFormat = readFileSync(resolve(__dirname, '../../hooks/post-edit-format.sh'), 'utf8');

const RECONCILE_READ = extractFilter(reviewState, 'cur=$(jq -r ');
const RECONCILE_WRITE = extractFilter(reviewState, 'if jq --argjson mr "$want" ');

// The shell gate the read feeds. Duplicated from the hook because the whole point is that neither
// half is safe alone: jq emitting `100` is only benign because this regex accepts it.
const SHELL_NUMERIC = /^[0-9]+$/;

// Mirrors the hook's `case` arms. The filter classifies three ways and only two of them reach the
// write: a numeric cap (rewritten when it differs from the resolved one) and the literal `absent`
// (a subtree present but capless — repairable here and nowhere else, because `_migrate_state_v2`'s
// `//=` only fills a MISSING subtree). `skip` and `corrupt` must not.
const reconciles = (out) => SHELL_NUMERIC.test(out) || out === 'absent';

// stop-guard's accept/corrupt verdict is decided in TWO stages, and reading only the first is how
// a real disagreement hid behind a passing property test: jq emits the pair, then
// `[[ "$ITER_PARSED" =~ ^([0-9]+)[[:space:]]([0-9]+)$ ]]` judges it. `4e1` leaves jq as `4 4E+1` —
// jq never says "corrupt", but the regex rejects it, so stop-guard's verdict IS corrupt. Any
// oracle for congruence has to include every stage that contributes to the final verdict.
const STOP_GUARD_PAIR = /^[0-9]+\s[0-9]+$/;
const stopGuardVerdict = (rawJson) =>
  (STOP_GUARD_PAIR.test(runFilterRaw(ITER_FILTER, rawJson).out) ? 'accepted' : 'corrupt');

// Runs the extracted write filter under the real binary, exactly as the hook invokes it.
const runWriteRaw = (raw, mr) => {
  const r = spawnSync('jq', ['--argjson', 'mr', String(mr), RECONCILE_WRITE],
    { input: raw, encoding: 'utf8' });
  assert.equal(r.status, 0, `real jq rejected the write filter:\n${r.stderr}`);
  return JSON.parse(r.stdout);
};

test('the two _reconcile_max_rounds twins run the identical filter text', { skip: !HAVE_JQ }, () => {
  // post-edit-format.sh carries a hand-copied twin. Drift between them means one hook heals the cap
  // and the other silently does not, which is invisible from either hook's own suite.
  assert.equal(extractFilter(editFormat, 'cur=$(jq -r '), RECONCILE_READ,
    'the post-edit-format read filter has drifted from post-tool-review-state');
  assert.equal(extractFilter(editFormat, 'if jq --argjson mr "$want" '), RECONCILE_WRITE,
    'the post-edit-format write filter has drifted from post-tool-review-state');
});

test('real jq: the read filter yields nothing for every shape that must not be reconciled',
  { skip: !HAVE_JQ }, () => {
    // Each of these must leave `cur` empty or non-numeric so the function returns before writing.
    // `false` is the one that would surprise a stub author: jq's `//` treats it as missing, so the
    // alternative fires and the whole expression produces `empty` rather than the string "false".
    const mustNotReconcile = [
      ['{"iteration_history":[]}', 'array parent — corrupt to stop-guard, so untouchable here'],
      ['{"iteration_history":"x"}', 'string parent — likewise corrupt'],
      ['{"iteration_history":{"max_rounds":false}}', 'jq `//` treats false as missing'],
      // The one that forced `| numbers` into the filter. `jq -r` renders the string "30"
      // indistinguishably from the number 30, so a plain `// empty` accepted it, and the write
      // then fired whenever the value differed from the resolved cap — erasing the `corrupt`
      // verdict stop-guard's iteration filter returns for a string cap (asserted below).
      ['{"iteration_history":{"max_rounds":"30"}}', 'string cap must stay visible as corrupt'],
      ['{"iteration_history":{"max_rounds":[]}}', 'array cap'],
      ['{"iteration_history":{"max_rounds":3.5}}', 'fractional cap fails the shell regex'],
      ['{"iteration_history":{"max_rounds":-5}}', 'negative cap fails the shell regex'],
      // The range boundaries. Both are NUMBERS and both are digits-only, so `| numbers` plus the
      // shell regex accepted them — but stop-guard calls both `corrupt` (asserted below), and a
      // reconciler that rewrites them erases exactly the verdict it must not touch.
      ['{"iteration_history":{"max_rounds":0}}', 'zero is corrupt to stop-guard, not merely clamped'],
      ['{"iteration_history":{"max_rounds":100001}}', 'above stop-guard`s 100000 ceiling'],
    ];
    for (const [raw, why] of mustNotReconcile) {
      const out = runFilterRaw(RECONCILE_READ, raw).out;
      assert.ok(!reconciles(out),
        `read filter produced the reconcilable value ${JSON.stringify(out)} for ${raw} — ${why}`);
    }
    // Positive control: without this the test above passes for a filter that refuses everything.
    assert.equal(runFilterRaw(RECONCILE_READ, '{"iteration_history":{"max_rounds":30}}').out, '30');
  });

test('real jq: a subtree present but CAPLESS classifies as repairable, not as refused',
  { skip: !HAVE_JQ }, () => {
    // The hole this filter shape was rewritten to close. `_migrate_state_v2` gates on the subtree
    // EXISTING and its `//=` fills only a missing one, so a partial `iteration_history` is
    // unreachable to migration. When the reconciler also refused it, nothing ever wrote the cap:
    // stop-guard substituted its own default 30 and an explicit `## Max Rounds: 5` read as 5/30 —
    // unspent — handing the loop six times the budget the config granted.
    const capless = [
      ['{"iteration_history":{}}', 'cap key absent'],
      ['{"iteration_history":{"max_rounds":null}}', 'explicit null cap'],
      ['{"iteration_history":{"current_round":5,"findings_by_round":[]}}', 'partial, mid-loop'],
      // The PARENT shapes. `_migrate_state_v2` cannot reach either: it gates on
      // `has("iteration_history")`, which is TRUE for an explicit null, and its `//=` fills only a
      // missing subtree. stop-guard reads both as `0 30` — a default, not a corruption — so
      // refusing them here strands the configured cap behind stop-guard's own default.
      ['{}', 'parent missing entirely'],
      ['{"iteration_history":null}', 'parent explicitly null'],
    ];
    for (const [raw, why] of capless) {
      const out = runFilterRaw(RECONCILE_READ, raw).out;
      assert.equal(out, 'absent', `capless state (${why}) must classify as repairable: ${raw}`);
      assert.ok(reconciles(out), `and the shell gate must let it through to the write: ${raw}`);
    }
    // The classes must stay DISTINCT — collapsing absent into corrupt is the bug, twice over.
    assert.equal(runFilterRaw(RECONCILE_READ, '{"iteration_history":{"max_rounds":"30"}}').out,
      'corrupt', 'a corrupt cap must stay corrupt so stop-guard can still fail closed on it');
    assert.equal(runFilterRaw(RECONCILE_READ, '{"iteration_history":[]}').out,
      'corrupt', 'a non-object parent is corrupt to stop-guard and must stay that way here');
  });

test('real jq: the read filter emits the PERSISTED cap, not stop-guard`s clamped one',
  { skip: !HAVE_JQ }, () => {
    // Three values are in play and conflating any two of them is a live bug: the persisted cap, the
    // clamped cap stop-guard would actually enforce, and the configured cap. The clamp belongs to
    // the SPELLING test only — `cur` is compared against the resolved config to decide whether to
    // write, so emitting the clamped value made a persisted 100 look equal to a configured 50 and
    // suppressed its own repair. `update_state()`'s reset gate then reads the RAW persisted value
    // (`$m == $rmr`), so a converged precommit left `current_round` unreset and the round debt
    // carried into the next loop, where it can trip the hard cap early.
    const persisted = [
      ['{"iteration_history":{"max_rounds":100}}', '100', 50, 'above the band — clamps to 50'],
      ['{"iteration_history":{"max_rounds":1}}', '1', 3, 'below the band — clamps up to 3'],
      ['{"iteration_history":{"max_rounds":2}}', '2', 3, 'below the band'],
      ['{"iteration_history":{"max_rounds":100000}}', '100000', 50, 'the ceiling itself'],
      // In-band, so the clamp is a no-op and raw == clamped. Kept as the control: without it a
      // filter that emitted only out-of-band raws would still look correct.
      ['{"iteration_history":{"max_rounds":30}}', '30', 30, 'in-band, clamp is identity'],
      // Canonicalisation still happens — `1e2` is accepted (its clamped spelling is `50`) and must
      // surface as a shell-comparable integer, not as the literal.
      ['{"iteration_history":{"max_rounds":1e2}}', '100', 50, 'accepted exponent, canonicalised'],
    ];
    for (const [raw, expected, config, why] of persisted) {
      const out = runFilterRaw(RECONCILE_READ, raw).out;
      assert.equal(out, expected, `read filter must emit the persisted cap (${why}): ${raw}`);
      assert.ok(SHELL_NUMERIC.test(out), `and it must survive the shell gate: ${raw}`);
      // The consequence the value exists for: `[[ "$want" == "$cur" ]] && return 0`.
      if (String(config) !== expected) {
        assert.notEqual(out, String(config),
          `a persisted ${expected} against a configured ${config} must NOT short-circuit the write`);
      }
    }
    // Non-tautology anchor: the OLD clamped-emitting filter is what this pins against. Under it,
    // every out-of-band row above collapsed onto its configured cap and the write never fired.
    const clampEmitting = RECONCILE_READ
      .replace('| select((if . < 3 then 3 elif . > 50 then 50 else . end) | tostring | test("^[0-9]+$"))\n    | floor)',
        '| (if . < 3 then 3 elif . > 50 then 50 else . end)\n    | select(tostring | test("^[0-9]+$")))');
    assert.notEqual(clampEmitting, RECONCILE_READ, 'the old filter text no longer matches — update this anchor');
    assert.equal(runFilterRaw(clampEmitting, '{"iteration_history":{"max_rounds":100}}').out, '50',
      'the previous implementation really did emit 50 here, which is the bug being pinned');
  });

test('real jq: the write materialises a missing parent without disturbing existing counters',
  { skip: !HAVE_JQ }, () => {
    // The repair for a null/missing parent has to CREATE the subtree, not just set a field on
    // nothing — `.iteration_history.max_rounds = $mr` alone yields a subtree holding only the cap,
    // and the counters stop-guard reads would then be absent rather than zeroed.
    const made = runWriteRaw('{"schema_version":3,"iteration_history":null}', 5);
    assert.deepEqual(made.iteration_history, {
      current_round: 0, findings_by_round: [], total_rounds_session: 0,
      strategic_reset_fired: false, max_rounds: 5,
    }, 'a null parent must be materialised as a complete default subtree carrying the resolved cap');
    assert.equal(made.schema_version, 3, 'and nothing outside iteration_history may be touched');

    // The far more common path: an existing subtree keeps every sibling counter.
    const kept = runWriteRaw(
      '{"iteration_history":{"current_round":5,"findings_by_round":[3],"total_rounds_session":9,"strategic_reset_fired":true}}',
      7
    );
    assert.deepEqual(kept.iteration_history, {
      current_round: 5, findings_by_round: [3], total_rounds_session: 9,
      strategic_reset_fired: true, max_rounds: 7,
    }, 'the `//` must be inert when the parent already exists');
  });

test('real jq: the reset refuses to fire against a cap the config no longer resolves to',
  { skip: !HAVE_JQ }, () => {
    // The failed-reconciliation fail-open. `_reconcile_max_rounds` is best-effort BY CONTRACT — it
    // returns 0 whether its staging, jq, ownership check or rename succeeded — so `update_state`
    // cannot infer freshness from a return code and must read it off the state instead.
    //
    // The damaging direction is a cap DECREASE, because the stale cap is the LARGER one:
    const stale = '{"iteration_history":{"current_round":20,"max_rounds":30,"findings_by_round":[{"total":2}]}}';

    // Reconciliation failed: the file still says 30 while the project now resolves 10.
    const failed = runResetRaw(stale, 10);
    assert.equal(failed.status, 0);
    assert.equal(failed.doc.iteration_history.current_round, 20,
      'a stale cap must not license a reset — config says the budget was exhausted at 10');
    assert.equal(failed.doc.iteration_history.findings_by_round.length, 1,
      'and the exhaustion evidence must survive for stop-guard to read');

    // Reconciliation succeeded: the persisted cap matches, and 20 >= 10 is genuinely exhausted.
    const healed = '{"iteration_history":{"current_round":20,"max_rounds":10,"findings_by_round":[{"total":2}]}}';
    assert.equal(runResetRaw(healed, 10).doc.iteration_history.current_round, 20,
      'still exhausted once healed — the gate must not be the only thing preventing the refund');

    // Non-vacuity: the gate must not block every reset, only mismatched ones. Same cap, unspent.
    const fresh = '{"iteration_history":{"current_round":4,"max_rounds":10,"findings_by_round":[{"total":2}]}}';
    const ok = runResetRaw(fresh, 10);
    assert.equal(ok.doc.iteration_history.current_round, 0, 'an in-sync unspent budget still resets');
    assert.deepEqual(ok.doc.iteration_history.findings_by_round, []);

    // And the increase direction: stale-low cap, config raised. Refusing here is conservative
    // rather than protective, but it must still refuse — the rule is equality, not "stale is fine
    // when it happens to be smaller".
    const staleLow = '{"iteration_history":{"current_round":4,"max_rounds":10,"findings_by_round":[{"total":2}]}}';
    assert.equal(runResetRaw(staleLow, 30).doc.iteration_history.current_round, 4,
      'a cap the config no longer resolves to is not a basis for any reset, either direction');
  });

test('PROPERTY: the reconciler and stop-guard agree on every cap shape, in BOTH directions',
  { skip: !HAVE_JQ }, () => {
    // The invariant behind every enumerated case above, checked as a property so a future clause
    // change cannot satisfy the lists while breaking the rule. Both directions are load-bearing
    // and each was wrong once:
    //
    //   corrupt  ⇒ refuse   The reconciler runs BEFORE stop-guard reads the file, so any corrupt
    //                       cap it normalises is a fail-closed escalation that never fires.
    //   accepted ⇒ repair   A cap stop-guard USES but the reconciler refuses stays stale, and
    //                       stop-guard then honours the stale value. `1e2` was exactly this: the
    //                       reconciler called it corrupt (jq renders it `1E+2`, which failed a
    //                       digits-only clause) while stop-guard clamped it to 50 — so an explicit
    //                       `## Max Rounds: 5` never bound and the budget read as unspent.
    //
    // An earlier revision of this test asserted only the first direction and argued in its own
    // comment that "stricter than the reader is the safe asymmetry". That is false, and the second
    // direction is what disproves it.
    const caps = [
      '"30"', 'false', 'true', 'null', '[]', '{}', '"abc"',
      '0', '-1', '-5', '100001', '999999999', '3.5', '0.5', '-0',
      // Non-canonical spellings of in-band integers. These are the discriminating cases: the clamp
      // REPLACES an out-of-band value (so `1e2` reaches the regex as `50` and is accepted) but
      // passes an in-band one through as written (so `4e1` reaches it as `4E+1` and is rejected).
      // A reconciler that canonicalises with `floor` alone accepts `4e1` and launders it.
      '1e2', '4e1', '3e1', '30.0', '1.0', '1', '2', '3', '30', '50', '51', '100000',
    ];
    let corruptSeen = 0;
    let acceptedSeen = 0;
    for (const cap of caps) {
      const raw = `{"iteration_history":{"current_round":4,"max_rounds":${cap}}}`;
      // The FULL verdict, jq plus the shell regex. An earlier revision compared only the jq output
      // and so classified `4e1` as accepted, which is precisely the case it needed to catch.
      const guard = stopGuardVerdict(raw);
      const out = runFilterRaw(RECONCILE_READ, raw).out;
      if (guard === 'corrupt') {
        corruptSeen += 1;
        assert.ok(!reconciles(out),
          `stop-guard calls max_rounds=${cap} corrupt, so the reconciler must refuse it — `
          + `reconciling would repair away the fail-closed signal (got ${JSON.stringify(out)})`);
      } else {
        acceptedSeen += 1;
        assert.ok(reconciles(out),
          `stop-guard USES max_rounds=${cap} (its pair is "${runFilterRaw(ITER_FILTER, raw).out}"), `
          + 'so the reconciler must be able to repair it — refusing leaves a stale cap stop-guard '
          + `then honours (got ${JSON.stringify(out)})`);
      }
    }
    // Non-vacuity, per direction: a filter change that emptied either branch would otherwise let
    // this test pass while asserting nothing about it.
    assert.ok(corruptSeen >= 8,
      `expected the corpus to contain corrupt caps, stop-guard rejected only ${corruptSeen}`);
    assert.ok(acceptedSeen >= 6,
      `expected the corpus to contain accepted caps, stop-guard accepted only ${acceptedSeen}`);
  });

test('real jq: the write filter assigns a number and touches nothing else', { skip: !HAVE_JQ }, () => {
  const before = {
    schema_version: 3,
    code_review: { executed: true, passed: true },
    iteration_history: {
      current_round: 7,
      max_rounds: 10,
      findings_by_round: [3, 1],
      total_rounds_session: 41,
      strategic_reset_fired: true,
    },
  };
  const r = spawnSync('jq', ['--argjson', 'mr', '30', RECONCILE_WRITE],
    { input: JSON.stringify(before), encoding: 'utf8' });
  assert.equal(r.status, 0, `real jq rejected the write filter:\n${r.err}`);
  const after = JSON.parse(r.stdout);

  assert.equal(after.iteration_history.max_rounds, 30);
  assert.equal(typeof after.iteration_history.max_rounds, 'number',
    '--argjson must inject a JSON number; a string cap would fail every later arithmetic comparison');

  // Everything else byte-identical. A subtree replacement here would refund the round budget,
  // which makes the hard cap — the only convergence exit stop-guard enforces — unreachable.
  const expected = JSON.parse(JSON.stringify(before));
  expected.iteration_history.max_rounds = 30;
  assert.deepEqual(after, expected, 'the write filter must be a single-field assignment');
});

// --- Mid-loop checkpoint filter (post-tool-review-state.sh) ---
//
// Extracted rather than restated for the reason in this file's header: the stub in
// post-tool-review-state.test.js re-implements the sticky-OR in JavaScript, so deleting the
// clause from the hook leaves that suite green. These cases run the real filter under real jq.

const postTool = readFileSync(resolve(__dirname, '../../hooks/post-tool-review-state.sh'), 'utf8');
// The marker must sit BEFORE the program's opening quote — `extractFilter` takes the first `'`
// after it as the opener, so a marker inside the program yields a slice starting mid-filter.
const ITER_UPDATE_FILTER = extractFilter(postTool, '--argjson ckpt "$ckpt"');

/**
 * Every `--argjson`/`--arg` the production filter reads, in one place. jq fails the whole program
 * with exit 3 on an undefined variable, so adding a variable to the hook and forgetting it here is
 * a compile error rather than a wrong answer — which is how the stall-streak arguments announced
 * themselves. Defaults describe an ordinary non-stall round.
 */
function iterArgs({ total = 0, ckpt = 10, ids = '', closed = 0, persisted = 0, newids = 0 } = {}) {
  return ['--argjson', 'total', String(total), '--argjson', 'p0', '0', '--argjson', 'p1', '0',
    '--argjson', 'p2', '0', '--argjson', 'nit', '0', '--arg', 'now', '2026-08-04T00:00:00Z',
    '--argjson', 'ckpt', String(ckpt), '--arg', 'ids', ids,
    '--argjson', 'closed', String(closed), '--argjson', 'persisted', String(persisted),
    '--argjson', 'newids', String(newids)];
}

function runIterUpdate(json, ckpt) {
  const r = spawnSync(
    'jq', ['-r', ...iterArgs({ ckpt }), ITER_UPDATE_FILTER],
    { input: JSON.stringify(json), encoding: 'utf8' }
  );
  return { status: r.status, err: r.stderr || '', data: r.status === 0 ? JSON.parse(r.stdout) : null };
}

/** Drive the stall-streak clause directly: one round, described by its ledger figures. */
function runStall(json, { total, closed, persisted, newids }) {
  const r = spawnSync(
    'jq', ['-r', ...iterArgs({ total, closed, persisted, newids }), ITER_UPDATE_FILTER],
    { input: JSON.stringify(json), encoding: 'utf8' }
  );
  return { status: r.status, err: r.stderr || '', data: r.status === 0 ? JSON.parse(r.stdout) : null };
}

/** Seed a state whose stall streak is already at `streak`. */
const iterWithStreak = (streak) => {
  const s = baseIter(0);
  s.iteration_history.stall_streak = streak;
  return s;
};

const baseIter = round => ({
  iteration_history: {
    current_round: round,
    max_rounds: 30,
    findings_by_round: [],
    total_rounds_session: 0,
    strategic_reset_fired: false,
  },
});

test('iteration filter: crossing the checkpoint sets strategic_reset_fired', { skip: !HAVE_JQ }, () => {
  const r = runIterUpdate(baseIter(9), 10);
  assert.equal(r.status, 0, `real jq rejected the production filter:\n${r.err}`);
  assert.equal(r.data.iteration_history.current_round, 10);
  assert.equal(r.data.iteration_history.strategic_reset_fired, true);
});

test('iteration filter: below the checkpoint the flag stays false', { skip: !HAVE_JQ }, () => {
  // Negative control — without it the clause could be `= true` unconditionally and pass above.
  const r = runIterUpdate(baseIter(8), 10);
  assert.equal(r.status, 0);
  assert.equal(r.data.iteration_history.current_round, 9);
  assert.equal(r.data.iteration_history.strategic_reset_fired, false);
});

test('iteration filter: an already-set flag is sticky below the checkpoint', { skip: !HAVE_JQ }, () => {
  // jq's `//` treats `false` as missing, which is the trap this file's header names: written with
  // `//` instead of an explicit `== true` comparison, a cleared flag and an absent one differ.
  const seed = baseIter(2);
  seed.iteration_history.strategic_reset_fired = true;
  const r = runIterUpdate(seed, 10);
  assert.equal(r.status, 0);
  assert.equal(r.data.iteration_history.strategic_reset_fired, true, 'one diagnosis per change');
});

test('iteration filter: an absent flag defaults to false, not to fired', { skip: !HAVE_JQ }, () => {
  const seed = baseIter(3);
  delete seed.iteration_history.strategic_reset_fired;
  const r = runIterUpdate(seed, 10);
  assert.equal(r.status, 0);
  assert.equal(r.data.iteration_history.strategic_reset_fired, false);
});

test('iteration filter: a non-numeric current_round writes nothing at all', { skip: !HAVE_JQ }, () => {
  // The state file is an ordinary working-tree file, and `"11" >= 10` is TRUE in jq (strings sort
  // above numbers) — so a string round is exactly the shape that could forge a checkpoint and then
  // permanently suppress the real one via the sticky flag. It cannot: `+= 1` on a string makes the
  // whole program error out first, so the hook takes its "jq write failed" path and commits
  // nothing. The type test on the comparison is the second line of defence, not the first.
  const seed = baseIter(0);
  seed.iteration_history.current_round = '99';
  const r = runIterUpdate(seed, 10);
  assert.notEqual(r.status, 0, 'real jq must reject the malformed state rather than coerce it');
  assert.equal(r.data, null, 'and therefore produce no state to commit');
});

function runIterUpdateIds(json, ids) {
  const r = spawnSync(
    'jq', ['-r', ...iterArgs({ ids }), ITER_UPDATE_FILTER],
    { input: JSON.stringify(json), encoding: 'utf8' }
  );
  return { status: r.status, err: r.stderr || '', data: r.status === 0 ? JSON.parse(r.stdout) : null };
}

test('iteration filter: identities are split per line, blanks dropped', { skip: !HAVE_JQ }, () => {
  const r = runIterUpdateIds(baseIter(0), 'a.js:1 wrong\n\nb.js:2 also wrong\n');
  assert.equal(r.status, 0, `real jq rejected the production filter:\n${r.err}`);
  assert.deepEqual(r.data.iteration_history.findings_by_round[0].ids,
    ['a.js:1 wrong', 'b.js:2 also wrong']);
});

test('iteration filter: a blank-only identity set records an empty array, not phantom members', { skip: !HAVE_JQ }, () => {
  // Two halves, and only one of them is the guard. Measured (`jq -c '"" | split("\n")'`), jq
  // yields `[]` for the empty string, NOT `[""]` — so the `''` case below is a boundary check
  // that would pass with `select(length > 0)` deleted. What `select` actually prevents is the
  // empty members a real capture carries: a trailing newline and any interior blank line each
  // become one `""`, and every one of them would read as a finding that persists forever.
  const empty = runIterUpdateIds(baseIter(0), '');
  assert.equal(empty.status, 0);
  assert.deepEqual(empty.data.iteration_history.findings_by_round[0].ids, []);

  // The load-bearing half: `"\n\n" | split("\n")` is `["","",""]`. Delete `select` and this
  // records three phantom identities, which is exactly the state that never converges.
  const blanks = runIterUpdateIds(baseIter(0), '\n\n');
  assert.equal(blanks.status, 0, `real jq rejected the production filter:\n${blanks.err}`);
  assert.deepEqual(blanks.data.iteration_history.findings_by_round[0].ids, []);
});

// --- Stall streak (rules/auto-loop.md § Stall Detection) -------------------------------------
//
// The clause decides between three outcomes from four ledger figures, and two of them look
// identical in the state file afterwards: "held because the round was unreadable" and "reset
// because the round made progress" both leave a streak that did not grow. Only a seeded non-zero
// streak separates them, which is why every case below starts from one.

test('stall streak: a round that closes nothing while findings are outstanding increments it', { skip: !HAVE_JQ }, () => {
  const r = runStall(iterWithStreak(1), { total: 2, closed: 0, persisted: 2, newids: 0 });
  assert.equal(r.status, 0, `real jq rejected the production filter:\n${r.err}`);
  assert.equal(r.data.iteration_history.stall_streak, 2);
});

test('stall streak: an absent streak starts from 0, not from null arithmetic', { skip: !HAVE_JQ }, () => {
  // `null + 1` is 1 in jq rather than an error, so this passes with `// 0` deleted. It is here for
  // the shape below it: the same absence must also survive the type guard.
  const seed = baseIter(0);
  delete seed.iteration_history.stall_streak;
  const r = runStall(seed, { total: 1, closed: 0, persisted: 1, newids: 0 });
  assert.equal(r.status, 0);
  assert.equal(r.data.iteration_history.stall_streak, 1);
});

test('stall streak: closing a finding resets it to 0', { skip: !HAVE_JQ }, () => {
  // Negative control for the increment above — without it the clause could be `+1` unconditionally
  // and every assertion in this block would still pass.
  const r = runStall(iterWithStreak(2), { total: 2, closed: 1, persisted: 1, newids: 1 });
  assert.equal(r.status, 0);
  assert.equal(r.data.iteration_history.stall_streak, 0, 'progress re-arms the signal');
});

test('stall streak: a round with no findings outstanding resets it to 0', { skip: !HAVE_JQ }, () => {
  // `closed=0` alone is not a stall: a clean round closes nothing because there was nothing left.
  const r = runStall(iterWithStreak(2), { total: 0, closed: 0, persisted: 0, newids: 0 });
  assert.equal(r.status, 0);
  assert.equal(r.data.iteration_history.stall_streak, 0);
});

test('stall streak: a round the ledger could not read HOLDS the streak, neither counting nor resetting it', { skip: !HAVE_JQ }, () => {
  // `persisted + new < findings` means the identities could not be extracted (a section-shaped
  // report carries no per-finding text). "Absence is not a signal" has to cut both ways, and each
  // direction fails differently: counting it manufactures a stall out of an unreadable round,
  // resetting it lets a report format erase three rounds of real evidence.
  const r = runStall(iterWithStreak(2), { total: 3, closed: 0, persisted: 0, newids: 0 });
  assert.equal(r.status, 0);
  assert.equal(r.data.iteration_history.stall_streak, 2, 'held, not incremented');

  // The paired positive control: the SAME `closed=0` round, readable this time, must count. Delete
  // the blind-round branch and this still passes — delete the increment and only this one fails.
  const readable = runStall(iterWithStreak(2), { total: 3, closed: 0, persisted: 3, newids: 0 });
  assert.equal(readable.status, 0);
  assert.equal(readable.data.iteration_history.stall_streak, 3);
});

test('stall streak: a corrupt persisted streak floors to 0 instead of propagating', { skip: !HAVE_JQ }, () => {
  // The state file is not a trusted input — `false` is jq's classic `//` trap and a negative
  // counter would defer the crossing forever. Both must land on the same floor.
  for (const bad of [false, -5, 'seven', null, []]) {
    const seed = baseIter(0);
    seed.iteration_history.stall_streak = bad;
    const r = runStall(seed, { total: 1, closed: 0, persisted: 1, newids: 0 });
    assert.equal(r.status, 0, `real jq rejected ${JSON.stringify(bad)}:\n${r.err}`);
    assert.equal(r.data.iteration_history.stall_streak, 1, `${JSON.stringify(bad)} must floor to 0 before incrementing`);
  }
});

// --- The tool_response NORMALIZER and its `has_payload` guard (post-tool-review-state.sh, #11) ---
//
// This one has to live here for a reason stronger than the file's usual one. The stub in
// post-tool-review-state.test.js does not merely re-implement the normalizer — it re-implements it
// *with the guard always applied*, so deleting `has_payload` from the production filter cannot
// change a single assertion over there. The guard's whole job is to bound the re-parse: an object
// carrying no recognized payload field passes through as the RAW string rather than being
// re-serialized, and `tostring` re-serializes with JSON escapes DECODED. That decode is the danger:
// the plan-review branches match with unanchored `grep`, so a payload-less object whose values hold
// `## Plan Review` and `[PLAN_REVIEW_SKIPPED]` is inert while guarded and turns
// into a plan-state write the moment the guard is gone. Measured, not argued — that pair of jq
// outputs is what the two tests below pin.
const NORMALIZE_FILTER = extractFilter(reviewState, 'TOOL_OUTPUT=$(echo "$INPUT" | jq -r ');

// An object with no `stdout` / `content` field, whose values carry the plan sentinels in escaped
// form. Written with literal backslash-u so the guarded path has something to preserve.
const ESCAPED_PLAN_SENTINELS =
  '{"foo":"\\u0023\\u0023 Plan Review","bar":"\\u005bPLAN_REVIEW_SKIPPED\\u005d"}';

test('the extracted tool_response normalizer is a program real jq accepts', { skip: !HAVE_JQ }, () => {
  const r = runFilter(NORMALIZE_FILTER, { tool_response: 'plain text' });
  assert.equal(r.status, 0, `real jq rejected the production normalizer:\n${r.err}`);
  assert.equal(r.out, 'plain text');
});

test('real jq: a payload-less object passes through UNCHANGED, escapes and all', { skip: !HAVE_JQ }, () => {
  const r = runFilter(NORMALIZE_FILTER, { tool_response: ESCAPED_PLAN_SENTINELS });
  assert.equal(r.status, 0, `real jq rejected the production normalizer:\n${r.err}`);
  assert.equal(r.out, ESCAPED_PLAN_SENTINELS, 'the raw string is what passes through, not a re-serialization');
  // The consequence, spelled out so the assertion above cannot be "simplified" into a shape test:
  // these are the exact greps `hooks/post-tool-review-state.sh` runs on TOOL_OUTPUT for the plan
  // plane. Delete `has_payload` and both start matching.
  assert.doesNotMatch(r.out, /## Plan Review/, 'a decoded sentinel would reach the unanchored plan-review grep');
  assert.doesNotMatch(r.out, /\[PLAN_REVIEW_SKIPPED\]/, 'and the SKIPPED branch writes state with no provenance check');
});

// The positive control, and the reason the guard is a guard rather than a refusal: an object that
// DOES carry a recognized payload must still be unwrapped. Delete the guard and this stays green —
// delete the `unwrap` call it gates and only this one fails, which is what separates the two.
test('real jq: an object carrying a recognized payload is still unwrapped', { skip: !HAVE_JQ }, () => {
  const r = runFilter(NORMALIZE_FILTER, { tool_response: JSON.stringify({ content: '## Document Review\n\n✅ Mergeable' }) });
  assert.equal(r.status, 0, `real jq rejected the production normalizer:\n${r.err}`);
  assert.equal(r.out, '## Document Review\n\n✅ Mergeable');
});
