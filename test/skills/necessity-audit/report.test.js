'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const {
  buildMarkdown,
  compact,
  neutralizeForeignGates,
  neutralizeJsonValues,
  neutralizeSerializedCoarse,
  DIM_NAMES,
} = require("../../../scripts/skills/necessity-audit/report");
const { AUDIT_CLEAR, AUDIT_REVISE } = require('../../../scripts/skills/necessity-audit/consolidate');

function makeReport(overrides = {}) {
  return {
    schema_version: 1,
    relative_path: 'docs/features/foo/2-tech-spec.md',
    feature_key: 'foo',
    greenfield: false,
    depth: 'normal',
    preflight: 'advisory',
    banners: [],
    warnings: [],
    dimensions: {
      1: { name: 'Necessity Now', severity: 'Clean', notes: '0 Cut, 0 Review, 2 total' },
      2: { name: 'Abstraction Justification', severity: 'Clean', notes: '0 Cut, 0 Review, 1 total' },
      3: { name: 'Extensibility Speculation', severity: 'Clean', notes: '0 Cut, 0 Review, 0 total' },
      4: { name: 'Configurability Excess', severity: 'Skipped', notes: 'inactive per depth' },
      5: { name: 'Premature Optimization', severity: 'Skipped', notes: 'inactive per depth' },
      6: { name: 'Scope Drift', severity: 'Skipped', notes: 'inactive per depth' },
    },
    elements: [
      { id: 'FR-1', kind: 'requirement', primary_dimension: 1, final: 'Keep', claude: { classification: 'Keep', rationale: 'Core requirement' } },
    ],
    debate: {
      threadId: '019dab42-abcd-1234-efgh-000000000000',
      rounds: 3,
      equilibrium_reached: true,
      conclusion: 'Round 2 concluded with Accept stance on FR-1.',
      skill_invocation: 'codex-brainstorm',
    },
    deterministic_checks: {
      rounds_ok: true,
      has_evidence_citation: true,
      has_explicit_stance: true,
      has_threadId: true,
      equilibrium_required_met: true,
      conclusion_references_rounds: true,
    },
    under_covered_dimensions: [],
    narrative: [],
    gate: AUDIT_CLEAR,
    suggested_next: [],
    ...overrides,
  };
}

test('buildMarkdown — output starts with ## Necessity Audit header', () => {
  const md = buildMarkdown(makeReport());
  const firstLine = md.split('\n')[0];
  assert.equal(firstLine, '## Necessity Audit', 'the report contract fixes this exact header');
});

test('buildMarkdown — output ends with gate sentinel (✅ Audit Clear or ⛔ Audit Revise)', () => {
  const mdReady = buildMarkdown(makeReport({ gate: AUDIT_CLEAR }));
  const mdBlocked = buildMarkdown(makeReport({ gate: AUDIT_REVISE }));
  const tailReady = mdReady.trim().split('\n').pop();
  const tailBlocked = mdBlocked.trim().split('\n').pop();
  assert.equal(tailReady, AUDIT_CLEAR);
  assert.equal(tailBlocked, AUDIT_REVISE);
});

test('buildMarkdown — ### Gate section appears exactly once just before sentinel', () => {
  const md = buildMarkdown(makeReport());
  const lines = md.split('\n');
  const gateIdx = lines.indexOf('### Gate');
  assert.ok(gateIdx > 0, '### Gate section must exist');
  assert.equal(lines.filter(l => l === '### Gate').length, 1, '### Gate must appear exactly once');
});

test('buildMarkdown — handles unknown final verdict without crash (defensive bucket)', () => {
  const report = makeReport({
    elements: [
      { id: 'FR-X', kind: 'requirement', primary_dimension: 1, final: 'UnknownVerdict', claude: { classification: 'Review', rationale: 'Malformed' } },
    ],
  });
  assert.doesNotThrow(() => buildMarkdown(report), 'must not crash on unexpected final values');
  const md = buildMarkdown(report);
  assert.match(md, /## Necessity Audit/);
});

test('buildMarkdown — includes all 6 deterministic checks', () => {
  const md = buildMarkdown(makeReport());
  assert.match(md, /rounds_ok/);
  assert.match(md, /has_evidence_citation/);
  assert.match(md, /has_explicit_stance/);
  assert.match(md, /has_threadId/);
  assert.match(md, /equilibrium_required_met/);
  assert.match(md, /conclusion_references_rounds/);
});

test('buildMarkdown — renders banners as bold lines and warnings as blockquotes', () => {
  const md = buildMarkdown(makeReport({
    banners: ['[OVERRIDE: feasibility included]', '[PREFLIGHT SKIPPED]'],
    warnings: ['Dirty working tree on target; necessity audit reflects uncommitted state'],
  }));
  assert.match(md, /\*\*\[OVERRIDE: feasibility included\]\*\*/);
  assert.match(md, /\*\*\[PREFLIGHT SKIPPED\]\*\*/);
  assert.match(md, /> Dirty working tree/);
});

test('compact — truncates long text with ellipsis', () => {
  const long = 'x'.repeat(200);
  const result = compact(long, 50);
  assert.equal(result.length, 50);
  assert.ok(result.endsWith('…'));
});

test('compact — empty input returns empty string (no crash)', () => {
  assert.equal(compact(''), '');
  assert.equal(compact(undefined), '');
  assert.equal(compact(null), '');
});

test('DIM_NAMES — covers dimensions 1-6', () => {
  for (let d = 1; d <= 6; d++) {
    assert.ok(DIM_NAMES[d], `dimension ${d} must have a name`);
    assert.ok(typeof DIM_NAMES[d] === 'string');
  }
});

// ---------------------------------------------------------------------------
// The coarse sweeps: semantics and cost
// ---------------------------------------------------------------------------

test('neutralizeForeignGates elides a token only when a trigger follows it on the same line', () => {
  // The exact reading the `(?=[^\n]*…)` lookahead had, kept through the linear rewrite. Both
  // directions matter: over-eliding would start eating the audit's own `⛔ Audit Revise` off any
  // line that happened to mention "Must fix" earlier, and under-eliding reopens the leak.
  const cases = [
    ['⛔ needs Block now', true, 'trigger AFTER the token → elide'],
    ['Must fix ⛔ later', false, 'trigger BEFORE the token → leave it'],
    ['⛔ Audit Revise', false, "the audit's own gate carries no trigger at all"],
    ['the Gate should PASS once removed', true, 'the fail-OPEN shape: no emoji, no header, no colon'],
    ['PASS then Gate', false, 'PASS before Gate cannot trip stop-guard, so nothing is elided'],
    ['### Gate', false, "the report's own section header survives"],
  ];
  for (const [input, shouldElide, why] of cases) {
    const out = neutralizeForeignGates(input);
    assert.equal(out !== input, shouldElide, `${JSON.stringify(input)}: ${why} (got ${JSON.stringify(out)})`);
  }
});

test('neutralizeForeignGates is linear in tokens-per-line, not quadratic', () => {
  // Both sweeps were `(?=[^\n]*…)` lookaheads, which re-scan to end-of-line ONCE PER TOKEN. Line
  // length is bounded by nothing — reports interpolate caller-controlled free text, and the JSON
  // branch sweeps every string in the structure. Measured before the rewrite: 40 000 tokens on one
  // line cost 533 ms (`⛔`) and 1 314 ms (`Gate`); at 160 000 the same shape extrapolates past 8 s.
  //
  // Asserted as a wall-clock CEILING with a wide margin rather than a ratio: ratios between two
  // timings are the flaky formulation, and the linear implementation lands ~20-30 ms here, so the
  // bound below is roughly an order of magnitude of headroom while still being unreachable for a
  // quadratic one.
  const N = 160_000;
  for (const [label, line] of [['⛔', '⛔ '.repeat(N) + 'Must fix'], ['Gate', 'Gate '.repeat(N) + 'PASS']]) {
    const t0 = process.hrtime.bigint();
    const out = neutralizeForeignGates(line);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // Non-vacuity: the sweep must actually have done the work, not bailed out early.
    assert.notEqual(out, line, `${label}: the sweep must have elided something for the timing to mean anything`);
    assert.ok(ms < 1500, `${label}: ${N} tokens took ${ms.toFixed(0)}ms — that is the quadratic shape returning`);
  }
});

test('every FOREIGN_GATE_SENTINELS entry actually elides its sentinel', () => {
  // The list is nine entries and only a handful appeared in any fixture. An entry that never
  // matches — a typo, a `\s*` that should have been `\s+`, an emoji that drifted — is invisible:
  // the sweep still runs, the suite still passes, and the sentinel it was added for goes out
  // verbatim. Table-driven so a new entry without a case here is a visible omission.
  const cases = [
    ['✅ Mergeable', 'doc review pass'],
    ['✅Mergeable', 'doc review pass, no space — `\\s*` must tolerate it'],
    ['⛔ Needs revision', 'doc review block'],
    ['✅ Plan Ready', 'plan review pass'],
    ['⛔ Plan Blocked', 'plan review block'],
    ['✅ Ready', 'code review pass'],
    ['⛔ Blocked', 'code review block'],
    ['## Overall: ✅ PASS', 'precommit'],
    ['## Document Review', 'doc-review header'],
    ['## Gate: ✅', 'aggregate gate header'],
  ];
  for (const [sentinel, what] of cases) {
    const out = neutralizeForeignGates(`rationale mentioning ${sentinel} in passing`);
    assert.doesNotMatch(
      out, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${what}: ${JSON.stringify(sentinel)} survived the sweep`
    );
    assert.match(out, /rationale mentioning/, `${what}: the surrounding prose must survive`);
  }

  // Non-vacuity for the table itself: every sentinel in the source list must be exercised by a case
  // above. Asserted as CORRESPONDENCE, not as a count. Counting was two weaknesses at once: `listed`
  // was lines beginning with `/` inside the array block, which a wrapped pattern or a `//`-only line
  // silently changes; and `distinct >= listed` is satisfied by any ten cases against any ten
  // sentinels, so adding a tenth entry plus an unrelated tenth case kept it green with the new entry
  // untested. Matching each extracted pattern against the cases says the thing the count was
  // standing in for.
  const src = readFileSync(resolve(__dirname, '../../../scripts/skills/necessity-audit/report.js'), 'utf8');
  const block = src.match(/const FOREIGN_GATE_SENTINELS = \[([\s\S]*?)\n\];/)[1];
  const patterns = [...block.matchAll(/^\s*\/((?:\\.|\[[^\]]*\]|[^/\\])+)\/([gimsuy]*)\s*,/gm)]
    // `g` is dropped: `lastIndex` persists across `.test()` calls and would make the loop below
    // depend on the order the cases happen to be written in.
    .map((m) => ({ src: m[0].trim(), re: new RegExp(m[1], m[2].replace(/g/g, '')) }));
  assert.ok(
    patterns.length >= 5,
    `only ${patterns.length} sentinel patterns extracted from the source list — the extractor has drifted`
  );
  for (const { src: literal, re } of patterns) {
    assert.ok(
      cases.some(([s]) => re.test(s)),
      `no case above exercises ${literal} — a sentinel was added to the list without a test`
    );
  }
});

// ---------------------------------------------------------------------------
// neutralizeJsonValues — object reconstruction
// ---------------------------------------------------------------------------

test('a __proto__ key survives as an ORDINARY own property and is sanitized like any other', () => {
  // `JSON.parse` gives `__proto__` as an own data property, so it reaches the rebuild like any
  // other key — but `out[k] = v` on a `{}` literal hits the inherited SETTER instead of creating a
  // property. The entry then vanishes from the output (and, for an object value, silently becomes
  // the result's prototype). Losing a field is not a safe failure for a function whose whole job is
  // to sanitize this structure: a field that disappears was never swept, only relocated.
  const parsed = JSON.parse('{"__proto__": {"note": "rationale ✅ Ready"}, "keep": 1}');
  const out = neutralizeJsonValues(parsed);

  const round = JSON.parse(JSON.stringify(out));
  assert.deepEqual(
    Object.keys(round).sort(),
    ['__proto__', 'keep'].sort(),
    'the __proto__ entry must be serialized, not swallowed by the prototype setter'
  );
  assert.equal(round.keep, 1, 'the ordinary sibling must be unaffected');
  assert.doesNotMatch(
    JSON.stringify(round),
    /✅\s*Ready/,
    'the value under __proto__ must be swept, not smuggled out through the prototype'
  );
  assert.equal(
    Object.getPrototypeOf(out),
    null,
    'the rebuilt object must have no prototype for a setter to live on in the first place'
  );
});

test('two distinct keys that neutralize to the same text both survive', () => {
  // Neutralizing is many-to-one, and `deterministic_checks` is a caller-controlled free-form map,
  // so distinct keys colliding after elision is reachable. Plain assignment kept only the last —
  // a silently missing row in a report whose entire purpose is to be read.
  const parsed = JSON.parse(JSON.stringify({ 'check ✅ Ready': 'first', 'check ✅  Ready': 'second' }));
  assert.equal(Object.keys(parsed).length, 2, 'setup: the two keys must be distinct before the sweep');
  assert.equal(
    neutralizeForeignGates('check ✅ Ready'),
    neutralizeForeignGates('check ✅  Ready'),
    'setup: they must genuinely collide after neutralization, or this test proves nothing'
  );

  const out = JSON.parse(JSON.stringify(neutralizeJsonValues(parsed)));
  assert.equal(Object.keys(out).length, 2, 'a collision must not drop a row');
  assert.deepEqual(
    Object.values(out).sort(),
    ['first', 'second'],
    'both values must survive — which key carries the suffix matters less than losing neither'
  );
  assert.doesNotMatch(JSON.stringify(out), /✅\s*Ready/, 'both keys must still be swept');
});

test('the JSON branch neutralizes ACROSS fields, not just within each one', () => {
  // Per-value cleaning cannot see a combination that only exists in the assembled document, and
  // `JSON.stringify` assembles every field into one. Pretty-printing hides this locally — each
  // value gets its own line — but the report FILE is read back into the transcript, where the
  // whole document collapses onto a single grep line and `Gate` in one field sits beside `PASS`
  // in another with nothing between them but syntax.
  const report = {
    conclusion: 'The Gate for dimension 2 is advisory',
    followup: 'the suite should PASS once the adapter is dropped',
    finding: 'marker ⛔ recorded against the adapter',
    action: 'we must Block the merge until then',
  };
  const perValueOnly = JSON.stringify(neutralizeJsonValues(report), null, 2);
  const swept = neutralizeSerializedCoarse(perValueOnly);
  const asTranscriptLine = (t) => JSON.stringify({ type: 'tool_result', content: t });

  // Non-vacuity: per-value cleaning alone must genuinely leak here, or the assertion below is free.
  assert.match(
    asTranscriptLine(perValueOnly), /Gate[^\n]*PASS/,
    'precondition: per-value cleaning alone leaks the coarse combination across fields'
  );

  assert.doesNotMatch(asTranscriptLine(swept), /Gate[^\n]*PASS/, 'the fail-OPEN combination must not survive');
  assert.doesNotMatch(asTranscriptLine(swept), /⛔[^\n]*Block/, 'nor the fail-closed one');
  assert.doesNotThrow(() => JSON.parse(swept), 'and the sweep must leave parseable JSON behind');
  assert.match(swept, /should PASS once the adapter is dropped/, 'the prose itself must survive — only the anchor token goes');
});

test('neutralizeJsonValues output is still valid, sentinel-free JSON for a realistic report', () => {
  // The end-to-end shape: nesting, arrays, non-string leaves. Without it the two tests above pin
  // the object branch while a regression in the array or scalar branch goes unnoticed.
  const report = {
    schema_version: 1,
    greenfield: false,
    banners: ['## Overall: ✅ PASS'],
    dimensions: { 1: { notes: 'the Gate should PASS once the adapter is removed' } },
    deterministic_checks: { 'doc gate': '✅ Mergeable' },
  };
  const text = JSON.stringify(neutralizeJsonValues(report), null, 2);
  const back = JSON.parse(text); // must not throw — the old serialized-text sweep broke this
  assert.equal(back.schema_version, 1, 'non-string leaves pass through untouched');
  assert.equal(back.greenfield, false, 'false must not be laundered into null or dropped');
  for (const re of [/##\s*Overall:/, /✅\s*Mergeable/, /Gate[^\n]*PASS/]) {
    assert.doesNotMatch(text, re, `a sentinel survived the value sweep: ${re}`);
  }
  assert.match(text, /once the adapter is removed/, 'the surrounding prose must survive');
});
