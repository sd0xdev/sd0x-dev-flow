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
  assert.equal(runFilter(ITER_FILTER, {}).out, '0 10');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: null }).out, '0 10');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: {} }).out, '0 10');
});

test('real jq: non-integer and out-of-range counters are corrupt', { skip: !HAVE_JQ }, () => {
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 3.5, max_rounds: 10 } }).out, 'corrupt');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: -1, max_rounds: 10 } }).out, 'corrupt');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 1, max_rounds: 0 } }).out, 'corrupt');
  assert.equal(runFilter(ITER_FILTER, { iteration_history: { current_round: 200001, max_rounds: 10 } }).out, 'corrupt');
});

test('real jq: max_rounds is CLAMPED to the producer contract (3..50)', { skip: !HAVE_JQ }, () => {
  // `_read_project_int_setting` (post-tool-review-state.sh) admits 3..50 and otherwise falls back
  // to 10, so a persisted 100000 did not come from the documented path. Accepting it as written is
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

function runReset(iterationHistory, { key = 'precommit', passed = true } = {}) {
  const r = spawnSync(
    'jq',
    ['-c', '--arg', 'key', key, '--argjson', 'executed', 'true', '--argjson', 'passed', String(passed),
      '--arg', 'mode', '', '--arg', 'now', 'T', RESET_FILTER],
    { input: JSON.stringify({ iteration_history: iterationHistory }), encoding: 'utf8' }
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
    [{ current_round: 4 }, 'absent max_rounds takes the documented default 10'],
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

function runResetRaw(rawJson) {
  const r = spawnSync(
    'jq',
    ['-c', '--arg', 'key', 'precommit', '--argjson', 'executed', 'true', '--argjson', 'passed', 'true',
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
    'reader maps a null history to the documented default "0 10" (unspent); the writer requires an '
    + 'OBJECT parent because its reset would otherwise CREATE iteration_history out of nothing. '
    + 'Refusing is the safe half — there is no round budget to refund when no history exists.'],
  ['{}',
    'same as above: absent history reads as "0 10" but there is nothing to reset.'],
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
