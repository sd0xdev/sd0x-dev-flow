'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const SCRIPT = resolve(__dirname, '../../scripts/validate-family-sentinel.js');
const { validate, CONTRACT_NAMES } = require(SCRIPT);

/** Run the CLI with a report on stdin; return the exit code. */
const run = (contract, input) => {
  try {
    execFileSync(process.execPath, [SCRIPT, contract], { input, stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) {
    return e.status;
  }
};

const LEGAL = {
  code: ['✅ Ready', '⛔ Blocked'],
  doc: ['✅ Mergeable', '⛔ Needs revision'],
  plan: ['✅ Plan Ready', '⛔ Plan Blocked'],
  'test:coverage': ['✅ Tests sufficient', '⛔ Tests need supplementation', '✅ Sufficient', '⛔ Needs additions'],
  'test:ac-trace': ['gate: Adequate', 'gate: Adequate_with_exceptions', 'gate: Need_Human', 'gate: Inadequate'],
};

test('every contract accepts each of its own legal terminals alone', () => {
  for (const [contract, terminals] of Object.entries(LEGAL)) {
    for (const t of terminals) {
      // plan's template shape requires the `## Plan Review` discriminator directly before the
      // verdict; the other families use a generic `## Gate` section heading.
      const gateHeading = contract === 'plan' ? '## Plan Review' : '## Gate';
      const report = `## Findings\n\n- [P2] a.js:1 minor thing -> fix it\n\n${gateHeading}\n\n${t}\n`;
      assert.equal(run(contract, report), 0, `${contract} should accept ${t}`);
    }
  }
});

test('cross-contract terminal -> exit 1, never translated', () => {
  // Each contract rejects a report whose only terminal belongs to a different family.
  assert.equal(run('code', 'review done\n✅ Mergeable\n'), 1);
  assert.equal(run('doc', 'review done\n✅ Ready\n'), 1);
  assert.equal(run('plan', 'review done\n⛔ Blocked\n'), 1);
  assert.equal(run('test:coverage', 'summary\n- gate: Adequate\n'), 1);
  assert.equal(run('test:ac-trace', 'summary\n✅ Tests sufficient\n'), 1);
});

test('a right terminal accompanied by a foreign one is still rejected (fail-closed)', () => {
  assert.equal(run('doc', '✅ Mergeable\n\n✅ Ready\n'), 1);
});

test('line anchoring: mid-line sentinel mentions are prose, line-initial verdicts count', () => {
  // Negated / prefixed prose must not count as a verdict (P1 fix, codex review 2026-08-23)...
  assert.equal(run('code', 'The report is not ✅ Ready because findings remain.\n'), 1);
  assert.equal(run('code', 'We hope for ✅ Ready next round.\n⛔ Blocked\n'), 0); // mid-line mention + one real verdict
  assert.equal(run('test:ac-trace', 'prose mentioning the gate: Adequate value inline\n'), 1);
  // ...while a verdict line with trailing text, a heading prefix, or a bold opener still counts
  // as an OCCURRENCE. `code` has no shape constraint, so these forms remain adoptable there:
  assert.equal(run('code', '⛔ Blocked: three in-scope P1 findings remain.\n'), 0);
  assert.equal(run('code', '### ✅ Ready\n'), 0);
  assert.equal(run('code', '**✅ Ready** — no blocking findings\n'), 0);
  // For shaped families the same forms COUNT (so they cannot hide as prose) but fail the raw
  // shape their template mandates — headed/bulleted/decorated verdicts are not adoptable
  // (round-12 P1): the occurrence keeps cross-family detection, the shape gates adoption.
  assert.equal(run('doc', '### ✅ Mergeable\n'), 1);
  assert.equal(run('doc', '**✅ Mergeable** — no blocking findings\n'), 1);
  assert.equal(run('test:ac-trace', '- gate: Adequate\n'), 1);
});

test('stripQuoted handles double-backtick spans and wide fences (P1 fix controls)', () => {
  // A foreign sentinel inside a double-backtick span is data, not a verdict...
  assert.equal(run('doc', 'The code ``✅ Ready`` is an example.\n\n✅ Mergeable\n'), 0);
  // ...a four-backtick fence opens and closes like any fence (closer >= opening length)...
  assert.equal(run('doc', '````\n✅ Ready\n````\n✅ Mergeable\n'), 0);
  // ...a shorter run does not close a longer fence (CommonMark closing rule)...
  assert.equal(run('doc', '````\n```\n✅ Ready\n````\n✅ Mergeable\n'), 0);
  // ...and an indented (non-column-0) sentinel is never a verdict.
  assert.equal(run('doc', '    ✅ Ready\n✅ Mergeable\n'), 0);
});

test('CommonMark fence corners: indented pseudo-fence, text-suffixed closer, multiline spans, lookalikes (round-2 P1 controls)', () => {
  // An indented (4+) triple backtick is an indented code line, not a fence opener — the real
  // verdict below it must survive.
  assert.equal(run('doc', '    ```\n✅ Mergeable\n'), 0);
  // Inside a fence, a matching-width run followed by text is content, not a closer; only the
  // delimiter-only line closes, so the foreign sentinel stays hidden.
  assert.equal(run('doc', '````\n````not-a-closer\n✅ Ready\n````\n✅ Mergeable\n'), 0);
  // An inline code span may cross line endings; the quoted foreign sentinel inside it is data.
  assert.equal(run('doc', 'The example is ``across\n✅ Ready\nlines``.\n\n✅ Mergeable\n'), 0);
  // A line-initial lookalike continuing the terminal's final word is not a verdict.
  assert.equal(run('code', '✅ Readyness is pending\n'), 1);
  assert.equal(run('code', '⛔ Blockedness remains unclear\n⛔ Blocked\n'), 0);
  // Boundary separators that are legal: colon, dash, bold closer (code — no shape constraint).
  assert.equal(run('code', '✅ Ready — no blocking findings\n'), 0);
  assert.equal(run('code', '**✅ Ready** clean\n'), 0);
  // doc's shape contract forbids the decorated form even though it counts as an occurrence.
  assert.equal(run('doc', '**✅ Mergeable** clean\n'), 1);
});

test('span pairing is exact-length and masking preserves columns (round-3 P1 controls)', () => {
  // A 1-backtick opener never pairs with a backtick inside a 2-run: the foreign sentinel stays
  // live prose, so the report is rejected — never accepted as doc-only.
  assert.equal(run('doc', '`quoted across\n✅ Ready\n``\n✅ Mergeable\n'), 1);
  // Masking, not deletion: stripping `label` must not splice the sentinel to column 0.
  assert.equal(run('doc', '`label`✅ Mergeable\n'), 1);
  // Equal-run pairing still strips a genuine span, sentinel after it counts.
  assert.equal(run('doc', '`x` prose\n✅ Mergeable\n'), 0);
  // A span cannot contain a blank line — the opener is literal, the foreign sentinel lives.
  assert.equal(run('doc', '`open\n\n✅ Ready\n`\n✅ Mergeable\n'), 1);
});

test('backtick fence opener with backticks in its info string is a span, not a fence (round-3 P1 control)', () => {
  // ```example``` is an inline code span; the fence must NOT open, so the real verdict below
  // survives instead of being swallowed by an unterminated fence.
  assert.equal(run('doc', '```example```\n✅ Mergeable\n'), 0);
  // A tilde fence's info string is unrestricted (CommonMark) — it still opens.
  assert.equal(run('doc', '~~~ info `with` backticks\n✅ Ready\n~~~\n✅ Mergeable\n'), 0);
});

test('same-line dual or cross-family terminals on a verdict line are rejected (round-5 P1 controls)', () => {
  // One line carrying both code terminals is ambiguous, not a verdict.
  assert.equal(run('code', '✅ Ready / ⛔ Blocked\n'), 1);
  // One line carrying a foreign family's terminal after the own one is cross-contract.
  assert.equal(run('code', '✅ Ready / ✅ Mergeable\n'), 1);
  // Plan: the two degraded markers sharing one line are rejected exactly as on two lines.
  assert.equal(run('plan', '⚠️ Plan Needs Human / [PLAN_REVIEW_DEGRADED]\n'), 1);
  // Coverage aliases mixed on one line are rejected.
  assert.equal(run('test:coverage', '✅ Tests sufficient ✅ Sufficient\n'), 1);
  // ac-trace enum riding a sentinel verdict line is cross-contract.
  assert.equal(run('code', '✅ Ready — gate: Adequate\n'), 1);
  // Trailing prose that repeats no terminal still counts as one clean verdict.
  assert.equal(run('code', '⛔ Blocked: two in-scope P1 findings remain\n'), 0);
});

test('producer-template gate shapes validate (round-5 P1 controls — template/validator consistency)', () => {
  // The rewritten producer templates instruct a bare terminal line; these are the shapes a
  // compliant reviewer now emits per family.
  assert.equal(run('code', '### Merge Gate\n\nNo blocking findings.\n\n✅ Ready\n\ngate_reason=NONE\n'), 0);
  assert.equal(run('doc', '### Gate\n\nNo 🔴 items.\n\n✅ Mergeable\n'), 0);
  assert.equal(run('test:coverage', '### Gate\n\n✅ Tests sufficient\n'), 0);
});

test('escaped backticks are literal prose and CRLF input is normalized (round-4 P1 controls)', () => {
  // Escaped single backticks cannot open a span — the foreign terminal stays live prose.
  assert.equal(run('doc', '\\`quoted\n✅ Ready\n\\`\n✅ Mergeable\n'), 1);
  // A closer inside an already-open span is NOT disarmed by a backslash (backslashes are
  // literal inside code spans), so this genuine span still strips and the verdict counts.
  assert.equal(run('doc', '`code\\` prose\n✅ Mergeable\n'), 0);
  // CRLF blank line still breaks a span: the foreign terminal stays live, report rejected.
  assert.equal(run('doc', '`open\r\n\r\n✅ Ready\r\n`\r\n✅ Mergeable\r\n'), 1);
  // Plain CRLF report with one legal terminal passes (no trailing-\r false negatives).
  assert.equal(run('doc', 'findings...\r\n\r\n✅ Mergeable\r\n'), 0);
});

test('ac-trace end boundary is Unicode-aware (round-3 P1 control)', () => {
  assert.equal(run('test:ac-trace', 'gate: Adequate外\n'), 1);
  assert.equal(run('test:ac-trace', 'gate: Need_Humané\n'), 1);
  // Trailing text after the enum is a clean OCCURRENCE (boundary holds) but violates the
  // template's "unbulleted gate line, alone as the final line" shape (round-12 P1).
  assert.equal(run('test:ac-trace', 'gate: Adequate — all covered\n'), 1);
  assert.equal(run('test:ac-trace', 'gate: Adequate\n'), 0);
});

test('dual own-terminals -> exit 1', () => {
  assert.equal(run('code', '✅ Ready\nlater...\n⛔ Blocked\n'), 1);
  assert.equal(run('doc', '✅ Mergeable\n✅ Mergeable\n'), 1);
});

test('missing terminal / empty / whitespace / malformed -> exit 1', () => {
  assert.equal(run('code', 'a fine review with no verdict line\n'), 1);
  assert.equal(run('doc', ''), 1);
  assert.equal(run('plan', '   \n\n  \n'), 1);
  assert.equal(run('test:ac-trace', 'gate: Sufficient\n'), 1); // unknown enum value
  assert.equal(run('nonsense-contract', '✅ Ready\n'), 1);
});

test('coverage alias union: each of the four passes alone, mixing is rejected', () => {
  for (const t of LEGAL['test:coverage']) {
    assert.equal(run('test:coverage', `report body\n${t}\n`), 0, t);
  }
  assert.equal(run('test:coverage', '✅ Tests sufficient\n✅ Sufficient\n'), 1);
  assert.equal(run('test:coverage', '⛔ Tests need supplementation\n⛔ Needs additions\n'), 1);
});

test('plan: the two degraded markers may never co-exist', () => {
  assert.equal(run('plan', '⚠️ Plan Needs Human\n[PLAN_REVIEW_DEGRADED]\n'), 1);
});

test('plan: orchestration-owned terminals are not carrier verdicts (doc round-5 fix)', () => {
  // A defective carrier emitting the exhaustion/round-cap markers must fail validation, so the
  // P3 fresh-instance retry still runs — the marker means "no validated verdict", and a carrier
  // report is a verdict claim by definition.
  assert.equal(run('plan', 'analysis prose\n[PLAN_REVIEW_DEGRADED]\n'), 1);
  assert.equal(run('plan', 'analysis prose\n⚠️ Plan Needs Human\n'), 1);
  // Negative controls — both directions of the guard, same commit:
  // (1) the producer-authorized terminals still validate;
  assert.equal(run('plan', 'analysis prose\n## Plan Review\n✅ Plan Ready\n'), 0);
  assert.equal(run('plan', 'analysis prose\n## Plan Review\n⛔ Plan Blocked\n'), 0);
  // (2) the markers stay recognized as plan-family terminals for cross-family rejection;
  assert.equal(run('code', 'review done\n[PLAN_REVIEW_DEGRADED]\n'), 1);
  assert.equal(run('doc', '✅ Mergeable\n\n⚠️ Plan Needs Human\n'), 1);
  // (3) the same words as quoted data are still no verdict either way.
  assert.equal(run('plan', 'the rule mentions `[PLAN_REVIEW_DEGRADED]` in prose\n## Plan Review\n✅ Plan Ready\n'), 0);
});

test('plan: a mid-line orchestration token beside a valid verdict is still rejected (round-10 P1)', () => {
  // plan-review reads machine tokens before verdict markers, anywhere in output — so a carrier
  // report that validates on its ✅ line yet smuggles the token mid-line could still be read as
  // degradation and fake exhaustion. The scan is whole-prose, not verdict-line-anchored.
  assert.equal(run('plan', '✅ Plan Ready\nstatus: [PLAN_REVIEW_DEGRADED]\n'), 1);
  assert.equal(run('plan', '✅ Plan Ready\nnote that ⚠️ Plan Needs Human may apply later\n'), 1);
  // Negative controls: the same tokens fenced or blockquoted are masked data, not machine tokens.
  assert.equal(run('plan', '```\nstatus: [PLAN_REVIEW_DEGRADED]\n```\n\n## Plan Review\n✅ Plan Ready\n'), 0);
  assert.equal(run('plan', '> quoting: ⚠️ Plan Needs Human\n\n## Plan Review\n✅ Plan Ready\n'), 0);
});

test('plan: [PLAN_REVIEW_SKIPPED] is orchestration-owned exactly like the other two (round-11 P1)', () => {
  // plan-review reserves SKIPPED for explicit user intent and reads it before verdict markers —
  // a carrier emitting it could fake a user-authorized skip.
  assert.equal(run('plan', 'analysis prose\n[PLAN_REVIEW_SKIPPED]\n'), 1);
  assert.equal(run('plan', '✅ Plan Ready\nstatus: [PLAN_REVIEW_SKIPPED]\n'), 1);
  // Cross-family recognition: a line-anchored SKIPPED in a foreign report is a plan terminal.
  assert.equal(run('code', 'review done\n[PLAN_REVIEW_SKIPPED]\n'), 1);
  // Negative controls: producer verdicts still pass; quoted SKIPPED is data.
  assert.equal(run('plan', 'analysis prose\n## Plan Review\n✅ Plan Ready\n'), 0);
  assert.equal(run('plan', 'the rule mentions `[PLAN_REVIEW_SKIPPED]` in prose\n## Plan Review\n⛔ Plan Blocked\n'), 0);
  assert.equal(run('plan', '```\n[PLAN_REVIEW_SKIPPED]\n```\n\n## Plan Review\n✅ Plan Ready\n'), 0);
});

test('shaped families reject terminals in template-forbidden positions (round-12 P1)', () => {
  // Early terminal: prose after the verdict line means the verdict is not the final line.
  assert.equal(run('doc', '✅ Mergeable\n- 🔴 unresolved defect\n'), 1);
  assert.equal(run('doc', '### ✅ Mergeable\nLater: P1 remains\n'), 1);
  assert.equal(run('test:ac-trace', 'gate: Adequate\n- gaps: [AC-2]\n'), 1);
  assert.equal(run('test:coverage', '## ✅ Tests sufficient\nLater: missing tests\n'), 1);
  // Discriminator-less plan verdict: bare final line without `## Plan Review` directly before.
  assert.equal(run('plan', 'analysis\n✅ Plan Ready\n'), 1);
  assert.equal(run('plan', '## Gate\n\n✅ Plan Ready\n'), 1);
  // Negative controls: the template shapes themselves pass.
  assert.equal(run('doc', 'findings...\n\n✅ Mergeable\n'), 0);
  assert.equal(run('test:coverage', 'summary\n\n✅ Tests sufficient\n'), 0);
  assert.equal(run('test:ac-trace', '- gaps: []\n\ngate: Adequate\n'), 0);
  assert.equal(run('plan', 'analysis\n\n## Plan Review\n\n✅ Plan Ready\n'), 0);
  // Blank lines between header and verdict are tolerated; other text between them is not.
  assert.equal(run('plan', '## Plan Review\nsome prose\n✅ Plan Ready\n'), 1);
});

test('shape runs on the RAW report: quoted content cannot hide around the verdict (round-13 P1)', () => {
  // A fence/blockquote/indented/inline span AFTER the verdict vanishes from the stripped prose
  // but is still raw content the template forbids below the final line — shape must see it.
  assert.equal(run('doc', '✅ Mergeable\n\n```\ncode\n```\n'), 1);
  assert.equal(run('doc', '✅ Mergeable\n> a quote\n'), 1);
  assert.equal(run('doc', '✅ Mergeable\n    indented code\n'), 1);
  assert.equal(run('doc', '✅ Mergeable\n`inline`\n'), 1);
  assert.equal(run('test:coverage', '✅ Tests sufficient\n\n```\nx\n```\n'), 1);
  assert.equal(run('test:ac-trace', 'gate: Adequate\n\n```\nx\n```\n'), 1);
  // Quoted content BETWEEN the plan header and the verdict breaks adjacency on the raw report.
  assert.equal(run('plan', '## Plan Review\n> note\n✅ Plan Ready\n'), 1);
  assert.equal(run('plan', '## Plan Review\n`x`\n✅ Plan Ready\n'), 1);
  // Exact-match contract: trailing spaces on the verdict or header line reject.
  assert.equal(run('doc', 'findings\n✅ Mergeable \n'), 1);
  assert.equal(run('plan', '## Plan Review \n✅ Plan Ready\n'), 1);
  // Negative controls: quoted material BEFORE the verdict stays legal; CRLF reports normalize.
  assert.equal(run('doc', '```\n✅ Ready\n```\n\n✅ Mergeable\n'), 0);
  assert.equal(run('doc', 'findings\r\n\r\n✅ Mergeable\r\n'), 0);
  assert.equal(run('plan', '## Plan Review\r\n✅ Plan Ready\r\n'), 0);
});

test('quoted terminals do not count — and the same words as data still pass (negative control)', () => {
  // Guard direction: a sentinel only inside a fenced block / blockquote / inline code is no verdict.
  assert.equal(run('doc', 'The doc explains:\n```\n✅ Mergeable\n```\nno verdict outside\n'), 1);
  assert.equal(run('doc', '> ✅ Mergeable (quoting the rule)\n'), 1);
  assert.equal(run('doc', 'the sentinel `✅ Mergeable` is described here\n'), 1);
  // Data direction: the same quoted words alongside one real terminal still pass.
  const report = 'The rule text mentions `✅ Ready` and quotes:\n\n```\n⛔ Blocked\ngate: Adequate\n```\n\n> ⛔ Needs revision (historic quote)\n\n✅ Mergeable\n';
  assert.equal(run('doc', report), 0);
});

test('ac-trace: list-item shape and word-boundary discrimination', () => {
  // Bulleted and non-final gate lines COUNT as occurrences (cross-family detection) but fail
  // the template shape: exactly one unbulleted gate line, alone as the final line (round-12 P1).
  assert.equal(run('test:ac-trace', 'Final summary:\n- gate: Adequate_with_exceptions\n- gaps: []\n'), 1);
  // `Adequate` must not be double-counted inside `Adequate_with_exceptions` — the compound enum
  // alone as the unbulleted final line is exactly one occurrence and a legal shape.
  assert.equal(run('test:ac-trace', 'gate: Adequate_with_exceptions\n'), 0);
});

test('validate() module surface agrees with the CLI (spot check)', () => {
  assert.equal(validate('code', '✅ Ready\n').ok, true);
  assert.equal(validate('code', '').ok, false);
  assert.equal(validate('code', null).ok, false);
  assert.deepEqual([...CONTRACT_NAMES].sort(), ['code', 'doc', 'plan', 'test:ac-trace', 'test:coverage'].sort());
});
