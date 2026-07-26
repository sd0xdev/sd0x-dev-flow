'use strict';

/**
 * stop-guard-isolation.test.js — a necessity audit must not be mistakable for a doc review.
 *
 * The skill deliberately does not write gate state (FR-10), so the only surface where its report
 * could ever be credited as a doc review is `stop-guard.sh`'s TRANSCRIPT FALLBACK — the degraded
 * path taken whenever there is no readable state file. That path is position-blind: it greps the
 * conversation for a doc verdict, and separately for a doc-review command name, and asks nothing
 * about whether the two came from the same invocation.
 *
 * Both halves used to be present in an ordinary audit run:
 *
 *   - the verdict, because the report's own gate sentinel WAS `✅ Mergeable`;
 *   - the command, because the token `/codex-review-doc` appears in this skill's SKILL.md routing
 *     table, in references/review-loop.md, and in preflight.js's advisory — all of which reach the
 *     transcript BEFORE the report, so verdict/invocation ordering does not separate them either.
 *
 * Measured against the real hook before the fix: a doc edit + this skill's SKILL.md + a report
 * ending `✅ Mergeable` returned `{"ok":true,"reason":"All steps completed"}` with exit 0, without
 * any doc review having run.
 *
 * These tests compose the REAL report assembler with the REAL hook and the REAL skill sources, so
 * they keep holding as those files change — a future edit that reintroduces the doc-review
 * vocabulary anywhere in the audit's always-loaded surfaces turns them red.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../../..');
const hookPath = path.join(repoRoot, 'hooks', 'stop-guard.sh');

const { buildMarkdown, neutralizeJsonValues } = require('../../../scripts/skills/necessity-audit/report');
const { AUDIT_CLEAR, AUDIT_REVISE } = require('../../../scripts/skills/necessity-audit/consolidate');

// The hook hard-requires jq (hooks/stop-guard.sh:113 degrades to allow when it is absent, which
// would make every assertion below pass vacuously). Skip honestly rather than assert nothing.
function jqMissing() {
  try {
    execFileSync('jq', ['--version'], { stdio: 'ignore' });
    return false;
  } catch {
    return 'jq not installed — stop-guard degrades to allow without it, so these would pass vacuously';
  }
}
const SKIP_NO_JQ = jqMissing();

const tempDirs = [];
test.after(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd0x-audit-iso-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Run the real stop-guard against a transcript, from a directory with NO state file so the
 * fallback is the path under test.
 */
function runGuard(lines) {
  const dir = makeTempDir();
  const cwd = path.join(dir, 'run');
  fs.mkdirSync(cwd);
  const transcript = path.join(dir, 'transcript.txt');
  fs.writeFileSync(transcript, lines.join('\n'));

  const result = spawnSync('bash', [hookPath], {
    cwd,
    input: JSON.stringify({ transcript_path: transcript }),
    encoding: 'utf8',
    env: { ...process.env, STOP_GUARD_MODE: 'strict', HOOK_BYPASS: '' },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const DOC_EDIT = '{"tool_name":"Edit","tool_input":{"path":"docs/x.md"}}';

/**
 * Every audit surface that lands in the transcript on an ordinary run — DERIVED, not typed out.
 *
 * The first version of this list was hand-written and omitted `references/phase-a-classify.md`,
 * which SKILL.md loads at Phase A. That is the failure mode of every hand-maintained scope list:
 * the file most likely to be forgotten here is the same one most likely to be forgotten when the
 * sentinel vocabulary is next touched, so the lock and the drift go missing together. Taking the
 * whole `references/` directory means a reference added tomorrow is covered without anyone
 * remembering this file exists.
 */
const AUDIT_SURFACES = [
  'skills/necessity-audit/SKILL.md',
  'scripts/skills/necessity-audit/preflight.js',
  ...fs.readdirSync(path.join(repoRoot, 'skills/necessity-audit/references'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => `skills/necessity-audit/references/${f}`),
];

function surfaceSource(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

/**
 * The transcript is JSONL: one line packs a WHOLE message, so a loaded skill file arrives as a
 * single line with its newlines escaped, not as N lines. Encoding it that way is both the honest
 * shape and the reason the fixture fits: the hook reads `tail -500`, and splatting five real files
 * out as raw text pushed the earlier lines — including the doc edit that arms the gate — out of the
 * window, so the first draft of this test passed for the wrong reason (no doc change detected at
 * all rather than no doc verdict credited).
 */
function surfaceLines() {
  return AUDIT_SURFACES.map((rel) => JSON.stringify({ type: 'user', content: surfaceSource(rel) }));
}

function makeAuditReport(gate, overrides = {}) {
  return buildMarkdown(auditReportObject(gate, overrides));
}

/** The report OBJECT the assembler consumes — shared so the JSON branch drives the same fixture. */
function auditReportObject(gate, overrides = {}) {
  return {
    schema_version: 1,
    relative_path: 'docs/features/foo/2-tech-spec.md',
    feature_key: 'foo',
    greenfield: false,
    depth: 'normal',
    preflight: 'advisory',
    banners: [],
    warnings: [],
    dimensions: {},
    elements: [],
    debate: { threadId: 'abc', rounds: 3, equilibrium_reached: true, conclusion: 'R2 settled', skill_invocation: 'codex-brainstorm' },
    deterministic_checks: { rounds_ok: true },
    under_covered_dimensions: [],
    narrative: [],
    suggested_next: [],
    gate,
    ...overrides,
  };
}

/**
 * Every free-text field this assembler interpolates, each carrying a foreign gate sentinel.
 *
 * Choosing the audit's own gate vocabulary fixed the sentinel the report SELECTS. These are the
 * sentinels it COPIES — and content is not something the skill controls: a Codex rationale, a
 * debate conclusion, or a user's override reason can quote another plane's verdict for entirely
 * innocent reasons ("the earlier doc pass already said …") and still satisfy a transcript grep that
 * asks nothing about provenance. So this fixture is not an exotic attack; it is the ordinary case
 * where someone writes about a review inside a review.
 */
function poisonedFields() {
  const doc = '✅ Mergeable';
  const docBlock = '⛔ Needs revision';
  const code = '✅ Ready';
  const codeBlock = '⛔ Blocked';
  return {
    banners: [`banner quoting ${doc}`],
    warnings: [`warning quoting ${docBlock}`, `warning quoting ${code}`],
    dimensions: { 1: { severity: `sev ${code}`, notes: `notes quoting ${doc}` } },
    elements: [
      {
        id: 'E1', kind: 'abstraction', final: 'Keep', primary_dimension: 2,
        claude: { classification: `keep ${code}`, rationale: `claude rationale quoting ${doc}` },
        codex: { classification: codeBlock, rationale: `codex rationale quoting ${docBlock}`, evidence: [{ location: `src/x.js ${doc}` }] },
      },
      {
        id: 'E2', kind: 'flag', final: 'Cut', primary_dimension: 4,
        claude: { classification: 'cut', rationale: 'r' },
        codex: { classification: 'Cut', rationale: `cut rationale quoting ${code}`, evidence: [{ location: 'src/y.js' }] },
        user_override: { kept_reason: `override reason quoting ${doc}` },
      },
      {
        id: 'E3', kind: 'option', final: 'Review', primary_dimension: 6,
        claude: { classification: `review ${docBlock}`, rationale: 'r' },
        codex: { classification: code, evidence: [{ location: 'src/z.js' }] },
      },
    ],
    debate: {
      threadId: `thread-${code}`, rounds: 3, equilibrium_reached: true,
      conclusion: `the debate settled on ${doc}, and R2 noted ${codeBlock}`,
      skill_invocation: `codex-brainstorm ${doc}`,
    },
    deterministic_checks: { [`rounds_ok ${doc}`]: true },
    narrative: [
      `narrative quoting ${doc}`,
      `narrative quoting ## Overall: ✅ PASS`,
      // No emoji, no header, no colon — the shape stop-guard's `Gate.*PASS` alternative actually
      // matches, and the one the hand-written FOREIGN_SENTINELS list below never covered. Ordinary
      // audit prose, not an exotic payload: the word "Gate" and the word "PASS" on one line.
      'the Gate should PASS once the speculative adapter is removed',
      'Gate check FAIL on the legacy path is expected and out of scope',
    ],
    suggested_next: [`next step quoting ${docBlock}`, 'next step quoting ## Document Review'],
  };
}

const FOREIGN_SENTINELS = /✅ Mergeable|⛔ Needs revision|✅ Ready|⛔ Blocked|## Overall:|## Document Review/;

// --- The invariant that keeps the collision closed ---

test('no audit surface that reaches the transcript carries a doc-review gate sentinel', () => {
  // This is the root cause, asserted directly. The hook tests below prove the CURRENT wording is
  // safe; this one proves it stays safe, because the collision returns the moment any of these
  // files says the doc-review words again — including in a comment explaining why it must not.
  // Non-vacuity: a derived list that silently resolved to nothing (a moved directory, a changed
  // extension) would make this pass without reading a single file.
  assert.ok(AUDIT_SURFACES.length >= 5, `expected the audit surfaces to be discovered, got ${AUDIT_SURFACES.length}`);
  assert.ok(
    AUDIT_SURFACES.some((r) => r.endsWith('phase-a-classify.md')),
    'the Phase A template is loaded on every run (SKILL.md step 103) and must be in scope — it is '
      + 'the file the original hand-written list omitted'
  );

  const offenders = [];
  AUDIT_SURFACES.forEach((rel) => {
    surfaceSource(rel).split('\n').forEach((line, n) => {
      if (/✅ Mergeable|⛔ Needs revision/.test(line)) offenders.push(`${rel}:${n + 1}`);
    });
  });
  assert.deepEqual(
    offenders, [],
    'these files are loaded into the transcript on every audit run, so a doc-review sentinel in '
      + 'any of them supplies half of what stop-guard\'s fallback needs to credit a doc review '
      + 'that never happened'
  );
});

test('the report assembler emits neither the doc-review header nor its sentinels', () => {
  for (const gate of [AUDIT_CLEAR, AUDIT_REVISE]) {
    const md = makeAuditReport(gate);
    assert.doesNotMatch(md, /## Document Review/, `gate=${gate} must not emit the doc-review header`);
    assert.doesNotMatch(md, /✅ Mergeable|⛔ Needs revision/, `gate=${gate} must not emit a doc-review sentinel`);
    assert.match(md, /^## Necessity Audit/, `gate=${gate} must carry the audit's own header`);
  }
});

test('a foreign gate sentinel injected through ANY free-text field is neutralized', () => {
  // The gate rename is a fix to what the report SAYS ON ITS OWN BEHALF. This is the other half:
  // what it repeats on someone else's. Without the assembler-level sweep, every one of these
  // fields reaches the transcript verbatim and supplies the doc verdict the rename withheld.
  const poison = poisonedFields();

  // Non-vacuity: the fixture must actually carry the sentinels, or the assertion below is free.
  // A refactor that renames a field silently drops it from the fixture, and this catches that.
  assert.match(
    JSON.stringify(poison), FOREIGN_SENTINELS,
    'the fixture itself must contain foreign sentinels for the sweep to have anything to remove'
  );

  const md = makeAuditReport(AUDIT_CLEAR, poison);
  assert.doesNotMatch(md, FOREIGN_SENTINELS, `assembled report leaked a foreign sentinel:\n${md}`);
  // The content is elided, not the whole field: the report must still be a report.
  assert.match(md, /⟨gate-sentinel elided⟩/, 'the elision must be visible rather than silent');
  assert.match(md, /the debate settled on/, 'surrounding prose must survive the elision');
  assert.match(md, /cut rationale quoting/, 'the Cut table\'s codex rationale must survive too');
  assert.match(md, /^## Necessity Audit/, "the audit's own header must survive");
  assert.ok(md.includes(AUDIT_CLEAR), "the audit's own gate must survive — it is not foreign");
});

/**
 * stop-guard's verdict scans, read OUT OF THE HOOK rather than restated here.
 *
 * `FOREIGN_SENTINELS` above is an enumeration, and enumerations rot in one direction only: a
 * pattern added to stop-guard is a pattern this file stops covering, silently. That is not
 * hypothetical — `Gate.*PASS` sat in the hook's passing scan while the list omitted it, so an
 * audit line reading "the Gate should PASS once …" reached the transcript verbatim and supplied a
 * code-review pass that no reviewer emitted. Fail-OPEN, and invisible to every test here.
 *
 * Returned as WHOLE ERE strings, deliberately not split on `|`: several alternatives contain
 * parenthesised groups (`## Gate: (✅|⛔)`, `⛔.*(Block|Needs revision|Must fix)`) that a naive
 * split would shred into patterns the hook never had.
 */
function stopGuardVerdictScans() {
  const src = fs.readFileSync(hookPath, 'utf8');
  const scans = [];

  // Single-quoted `_NAME='...'` pattern constants, so a scan that takes its pattern through a
  // VARIABLE can be resolved to the ERE grep actually receives. Both extractors below used to
  // require the pattern inline, which meant the precommit plane — `_PRECOMMIT_VERDICT_RE`, used
  // once by a pipe and once by the pairing scan — was extracted by neither, and the cross-check
  // could not say so because it counted the same inline shape. That is the exact plane whose
  // sentinel an audit report is most likely to quote.
  const constants = new Map();
  for (const m of src.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)='([^']*)'\s*$/gm)) constants.set(m[1], m[2]);
  // A pattern argument is either `'literal'` or `"$_VAR"`; anything else is a shape we do not know
  // how to resolve and must be reported rather than skipped.
  const ARG = String.raw`(?:'([^']+)'|"\$([A-Za-z_][A-Za-z0-9_]*)")`;
  const resolve_ = (literal, varName, where) => {
    if (literal !== undefined) return literal;
    const v = constants.get(varName);
    assert.ok(v !== undefined, `${where}: pattern variable $${varName} has no single-quoted definition to resolve`);
    return v;
  };

  // Keyed on the SHAPE, not on a list of variable names. The name list was the same enumeration
  // mistake one level up: it carried five names while the hook had seven scans of this form, so
  // `DOC_VERDICT_SEEN` and `LAST_DOC_VERDICT` — both doc-plane, both able to read an audit report
  // as a doc verdict — were never checked at all by the test whose whole purpose is not to rot.
  // Every `grep -E` on the line, not just one. A pipeline may chain two (`HAS_CODE_CHANGE` filters
  // by extension and then by tool name), and a single greedy match takes only the LAST — so the
  // first pattern went unextracted while the occurrence count, measured the same greedy way, agreed
  // that nothing was missing.
  // The flag cluster is matched as `-[A-Za-z]*E`, not as the literal `-E`, because the hook already
  // uses a second spelling: the three command detectors are `grep -oE`. Requiring `-E ` exactly made
  // them invisible HERE — and, because the occurrence count below was written with the same literal,
  // invisible THERE too, so the two agreed that nothing was missing while three scans went untested.
  const ASSIGN_PIPE = /^\s*([A-Za-z_][A-Za-z0-9_]*)=.*\|\s*grep -[A-Za-z]*E /;
  const GREP_ARG = new RegExp(String.raw`grep -[A-Za-z]*E ${ARG}`, 'g');
  for (const line of src.split('\n')) {
    const head = ASSIGN_PIPE.exec(line);
    if (!head) continue;
    for (const g of line.matchAll(GREP_ARG)) {
      scans.push({ name: head[1], pattern: resolve_(g[1], g[2], head[1]) });
    }
  }

  // The pairing scans, which take their pattern as an argument rather than through a pipe. They
  // decide whether a verdict can be credited to an invocation, so a report that trips one is a
  // report that can SATISFY a gate — the same fail-open, reached by a different route.
  const offset = new RegExp(String.raw`^\s*([A-Za-z_][A-Za-z0-9_]*)=\$\(_offset_of ${ARG}`, 'gm');
  for (const m of src.matchAll(offset)) {
    scans.push({ name: m[1], pattern: resolve_(m[2], m[3], m[1]) });
  }

  // Cross-check, so a scan written in a shape neither extractor knows is a FAILURE rather than a
  // silent omission.
  //
  // Keyed on the STREAM, not on how the scan is spelled. Every earlier version of this count was
  // written with the same token the extractor above matched on — first the quoting, then `grep -E `
  // — and a cross-check that measures the narrow shape it is auditing agrees with the extractor BY
  // CONSTRUCTION and can never disagree with it. That is how four of the six `_offset_of` calls, and
  // then all three `grep -oE` command detectors, went untested while this assertion reported a
  // perfect match. Widening the token one spelling at a time only moves the blind spot: `grep -F`,
  // or a plain flagless `grep`, would land in it next.
  //
  // A scan of the transcript is definitionally a line that READS the transcript, so that is what is
  // counted: on every non-comment line mentioning `$CONVERSATION` or `$_PAIR_STREAM`, every `grep`
  // and every `_offset_of`, whatever flags they carry. `_offset_of`'s own body greps its stdin and
  // names neither stream, so it is counted once at its call site rather than twice.
  const STREAM_REF = /"\$(?:CONVERSATION|_PAIR_STREAM)"/;
  let streamOccurrences = 0;
  for (const line of src.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    if (!STREAM_REF.test(line)) continue;
    streamOccurrences += (line.match(/\bgrep\b/g) || []).length;
    streamOccurrences += (line.match(/\b_offset_of\b/g) || []).length;
  }
  const found = scans.length;
  assert.equal(
    found,
    streamOccurrences,
    `extracted ${found} scans but ${streamOccurrences} grep/_offset_of invocations read $CONVERSATION ` +
      'or $_PAIR_STREAM — a scan is written in a shape this extractor does not recognise, and is ' +
      'therefore going untested'
  );
  return scans;
}

/**
 * The scans that are NOT verdict scans, and must therefore be excluded from "the report must not
 * match this" — while staying inside the exhaustiveness cross-check above, which is what keeps the
 * extractor from rotting.
 *
 * Widening the extractor to cover every shape was right; applying the SAME assertion to everything
 * it now returns was not. Two classes came in with the widening and neither can forge a gate:
 *
 *   • change detectors (`hooks/stop-guard.sh:734-735`) match a file EXTENSION in a tool call. When
 *     one trips, a gate requirement is ADDED — fail-closed.
 *   • command detectors match `/precommit`, `/codex-review-doc` and friends. A command seen with no
 *     verdict paired after it reads as `(invoked, no verdict)`, which re-opens the gate rather than
 *     satisfying it — the deliberate over-block `rules/auto-loop.md` documents.
 *
 * Demanding that an audit report match none of them is demanding the impossible of a document whose
 * job is to name files and recommend commands. It passed only by fixture accident: `poisonedFields()`
 * renders `src/x.js` with no closing quote, and the extension patterns require one. The first
 * realistic fixture naming a real path would have failed with "the audit would be read as a review
 * verdict" — a diagnosis that is simply not what happened.
 *
 * A second reason to partition: the change detectors are a two-`grep` pipeline that ANDs its halves
 * in production (extension AND tool name), while the extractor pushes each half as a standalone
 * pattern. Asserting on a half alone tests something the hook never evaluates.
 *
 * Unknown names default to the VERDICT side, so a scan added tomorrow is covered by the strict
 * assertion rather than quietly exempted.
 */
const NON_VERDICT_SCAN_NAMES = new Set([
  'HAS_CODE_CHANGE', 'HAS_DOC_CHANGE',
  'HAS_CODEX_REVIEW', 'HAS_PRECOMMIT', 'HAS_REVIEW_DOC',
  '_CODE_CMD_AT', '_PRECOMMIT_CMD_AT', '_DOC_CMD_AT',
]);

function stopGuardGateForgingScans() {
  const all = stopGuardVerdictScans();
  const verdict = all.filter((s) => !NON_VERDICT_SCAN_NAMES.has(s.name));
  const excluded = new Set(all.filter((s) => NON_VERDICT_SCAN_NAMES.has(s.name)).map((s) => s.name));
  // The partition must actually partition, in both directions. An exclusion list that stops matching
  // anything silently restores the impossible assertion; one that swallows everything makes the
  // assertion vacuous.
  assert.deepEqual(
    [...excluded].sort(),
    [...NON_VERDICT_SCAN_NAMES].sort(),
    'the non-verdict exclusion list names scans the hook no longer has — it must be re-derived, not left to rot'
  );
  assert.ok(verdict.length >= 8, `only ${verdict.length} gate-forging scans left after the partition`);

  // THE EXCLUSION'S ACTUAL PREMISE, pinned rather than reasoned about once and left in a comment.
  // None of the eight can forge a gate because the fallback's blocking is strictly ADDITIVE: every
  // `BLOCKED_REASON=` assignment sets a non-empty string, and each per-plane block is entered only
  // while the reason is still empty. Tripping an excluded scan can therefore add a block, never
  // clear one. Without this, the exclusion list asserts only that the eight names still EXIST — a
  // future `BLOCKED_REASON=""` would silently convert an excluded name into a forging one while
  // every assertion here stayed green.
  //
  // A TRIPWIRE on the two syntactic shapes that break additivity, not a proof of it: an assignment
  // from a variable that happens to be empty at runtime stays invisible here. Pinned at this
  // granularity because the premise is otherwise recorded nowhere executable.
  const src = fs.readFileSync(hookPath, 'utf8');
  // `unset` is the third shape with identical effect and the one most likely to be reached for by
  // someone wanting to "reset" the variable, so it belongs in the same assertion rather than in the
  // list of things this deliberately does not catch.
  const clearing = (src.match(/^\s*BLOCKED_REASON=(""|''|\s*$)/gm) || [])
    .concat(src.match(/^\s*unset\b.*\bBLOCKED_REASON\b.*$/gm) || []);
  assert.deepEqual(
    clearing,
    [],
    `stop-guard.sh assigns an EMPTY BLOCKED_REASON (${JSON.stringify(clearing)}) — the fallback's ` +
      'blocking is no longer additive, so the non-verdict exclusions above can now clear a block ' +
      'instead of only adding one, and each must be re-traced'
  );
  const guardedByEmpty = (src.match(/-z "\$BLOCKED_REASON"/g) || []).length;
  assert.ok(
    guardedByEmpty >= 3,
    `only ${guardedByEmpty} per-plane blocks are gated on an empty BLOCKED_REASON — a later block ` +
      'that overwrites an earlier reason would let scan order decide the verdict'
  );
  return verdict;
}

// The transcript is JSONL: `tail -500` of it hands grep ONE line per message, with every real
// newline inside the message encoded as the two characters `\` `n`. Any check that feeds a report
// to grep as plain multi-line text is therefore testing a shape production never sees — and the
// difference is not cosmetic, it is the whole of the cross-line gap.
function asTranscriptLine(text) {
  return JSON.stringify({ type: 'tool_result', content: text });
}

// Real `grep -E`, not a JS translation: these patterns are consumed by grep in production and ERE
// is not JS regex. Testing them through a translation would prove something about the translation.
function ereMatches(pattern, text) {
  const r = spawnSync('grep', ['-cE', pattern], { input: text, encoding: 'utf8' });
  return Number(r.stdout.trim() || '0') > 0;
}

test('DERIVED: no stop-guard verdict scan matches the audit report AS A TRANSCRIPT LINE', () => {
  // The plain-text form of this assertion passed while the report was wide open, because eliding
  // per REAL line and grepping per real line agree with each other and with nothing else. Encoded
  // as the transcript actually carries it, a `⛔` on one line and a `Block` on the next are
  // adjacent — measured: NEITHER coarse pattern matched the multi-line text, BOTH matched the
  // encoded form. `Gate.*PASS` is the fail-open half.
  const scans = stopGuardGateForgingScans();
  const poison = poisonedFields();
  const md = makeAuditReport(AUDIT_CLEAR, poison);

  // A fixture whose sentinels are split ACROSS real lines — the arrangement per-line elision
  // cannot see and per-line grepping cannot catch.
  const crossLine = makeAuditReport(AUDIT_CLEAR, {
    narrative: [
      'Dimension 3 came back ⛔ on the adapter.',
      'Reviewers should Block the merge until it is trimmed.',
      'The Gate below is advisory only.',
      'Once trimmed the suite should PASS.',
    ],
  });

  for (const [label, report] of [['poisoned fields', md], ['cross-line narrative', crossLine]]) {
    const line = asTranscriptLine(report);
    for (const { name, pattern } of scans) {
      assert.equal(
        ereMatches(pattern, line),
        false,
        `${name} (${pattern}) matched the ${label} report once encoded as a transcript line — ` +
          `the audit would be read as a review verdict:\n${line}`
      );
    }
  }

  // Non-vacuity: the cross-line fixture must trip the coarse scans BEFORE neutralization, or the
  // loop above proves nothing about the widening.
  const rawCrossLine = asTranscriptLine(
    'Dimension 3 came back ⛔ on the adapter.\nReviewers should Block the merge.\n'
      + 'The Gate below is advisory.\nOnce trimmed the suite should PASS.'
  );
  const tripped = scans.filter(({ pattern }) => ereMatches(pattern, rawCrossLine));
  assert.ok(
    tripped.length >= 2,
    `the cross-line fixture must be able to trip the coarse scans un-neutralized; only ${tripped.length} did`
  );
});

test('DERIVED: no stop-guard verdict scan matches the assembled audit report', () => {
  const scans = stopGuardGateForgingScans();
  assert.ok(
    scans.length >= 4,
    `expected stop-guard's verdict scans, found ${scans.length} — has the assignment shape changed?`
  );

  const poison = poisonedFields();
  const raw = JSON.stringify(poison);
  const md = makeAuditReport(AUDIT_CLEAR, poison);

  let exercised = 0;
  for (const { name, pattern } of scans) {
    // Non-vacuity, per scan: the fixture must be able to trip THIS pattern before neutralization,
    // otherwise the assertion below is free and a rotting fixture reads as a passing invariant.
    if (ereMatches(pattern, raw)) exercised += 1;
    assert.equal(
      ereMatches(pattern, md),
      false,
      `${name} (${pattern}) matched the assembled audit report — the audit would be read as a review verdict:\n${md}`
    );
  }
  assert.ok(
    exercised >= 4,
    `only ${exercised}/${scans.length} scans were exercised by the fixture — poisonedFields() no longer covers what stop-guard scans for`
  );

  // The audit's own vocabulary is untouched: it was chosen precisely so it matches none of these.
  assert.ok(md.includes(AUDIT_CLEAR), "the audit's own gate must survive");
  assert.match(md, /once the speculative adapter is removed/, 'the sentence itself must survive the elision');
});

test('an ORDINARY report — real paths, recommended commands — forges no gate', () => {
  // The fixture the assertions above were quietly relying on not existing. `poisonedFields()` writes
  // `src/x.js` with no closing quote, and the change detectors require one (`\.(ts|js|…)"`), so the
  // whole class of scans that an ordinary report legitimately trips was never presented to them.
  // Here the report does what a necessity audit is FOR: it names the file it audited and recommends
  // the commands to run next.
  const ordinary = makeAuditReport(AUDIT_CLEAR, {
    elements: [{
      id: 'E1', kind: 'abstraction', final: 'Cut', primary_dimension: 2,
      claude: { classification: 'cut', rationale: 'the adapter has one caller' },
      codex: { classification: 'cut', rationale: 'agreed', evidence: [{ location: '"src/adapter.ts"' }] },
    }],
    narrative: ['The spec at "docs/features/foo/2-tech-spec.md" over-builds the adapter.'],
    suggested_next: ['Run /codex-review-doc on the trimmed spec, then /precommit.'],
  });
  const line = asTranscriptLine(ordinary);

  for (const { name, pattern } of stopGuardGateForgingScans()) {
    assert.equal(
      ereMatches(pattern, line),
      false,
      `${name} (${pattern}) matched an ordinary audit report — the audit would be read as a review verdict:\n${line}`
    );
  }

  // The other half, and the reason the partition is load-bearing rather than cosmetic: this report
  // DOES trip the excluded scans. Every one of those is fail-closed — a change detector only adds a
  // gate requirement, and a command with no verdict paired after it reads as `(invoked, no verdict)`,
  // which re-opens the gate. Asserting it here keeps the exclusion honest: if these ever stopped
  // being trippable, the exclusion would be dead weight hiding a live assertion.
  const excluded = stopGuardVerdictScans().filter((s) => NON_VERDICT_SCAN_NAMES.has(s.name));
  const tripped = excluded.filter(({ pattern }) => ereMatches(pattern, line)).map((s) => s.name);
  assert.ok(
    tripped.length >= 3,
    `an ordinary report should trip the fail-closed change/command detectors; only ${JSON.stringify(tripped)} did — ` +
      'the exclusion list may be excluding scans nothing can reach'
  );
});

test('the coarse recency scan cannot be tripped from free text either', () => {
  // stop-guard also runs `⛔.*(Block|Needs revision|Must fix)` to decide whether a review recently
  // FAILED. That direction is fail-closed, so it cannot leak a pass — but a narrative line reading
  // "⛔ Must fix before merge" would mark an unrelated, genuinely passing gate as not-passed. Same
  // cross-plane interference, opposite sign.
  const md = makeAuditReport(AUDIT_REVISE, { narrative: ['⛔ Must fix the speculative adapter'] });
  assert.doesNotMatch(md, /⛔[^\n]*(Block|Needs revision|Must fix)/, `leaked:\n${md}`);
  assert.match(md, /Must fix the speculative adapter/, 'the finding text itself must survive');
});

// --- The composed end-to-end proof, against the real hook ---

test('a passing audit does NOT satisfy stop-guard\'s doc gate', { skip: SKIP_NO_JQ }, () => {
  const lines = [DOC_EDIT, ...surfaceLines(), makeAuditReport(AUDIT_CLEAR)];

  // Precondition, asserted rather than assumed. The interesting claim is "verdict present AND
  // command present, yet still blocked". If the surfaces stopped carrying `/codex-review-doc` —
  // an edit to SKILL.md's routing table would do it — the run would still block, but for the
  // uninteresting reason that nothing named the command, and this test would keep passing while
  // no longer testing the collision at all.
  assert.ok(
    lines.some((l) => /\/(sd0x-dev-flow:)?codex-review-doc([^A-Za-z0-9_-]|$)/.test(l)),
    'the audit surfaces must still supply the doc-review command token — that is the half of the '
      + 'fallback\'s test that the sentinel change is meant to leave unsatisfiable on its own'
  );

  const result = runGuard(lines);

  assert.equal(result.status, 2, 'a doc edit reviewed only by a necessity audit must still block');
  const { description } = JSON.parse(result.stdout);
  assert.match(description, /\/codex-review-doc/, 'the doc review must still be demanded');
  // And blocked for the DOC reason only: a MISSING list contaminated by an unmet code or precommit
  // gate would also produce exit 2, hiding a doc gate that had in fact been satisfied.
  assert.doesNotMatch(
    description, /codex-review-fast|\/precommit/,
    `the block must be attributable to the doc gate alone, got: ${description}`
  );
});

test('a passing audit whose free text QUOTES a doc verdict still does not satisfy the gate', { skip: SKIP_NO_JQ }, () => {
  // The same end-to-end proof as above, but against the input that actually broke it. The previous
  // version of this suite only ever fed the assembler a safe conclusion ("R2 settled"), so it
  // demonstrated that the RENAME held and said nothing about copied content — the report could have
  // leaked `✅ Mergeable` through any of a dozen fields and every test here would still have passed.
  const lines = [DOC_EDIT, ...surfaceLines(), makeAuditReport(AUDIT_CLEAR, poisonedFields())];

  assert.ok(
    lines.some((l) => /\/(sd0x-dev-flow:)?codex-review-doc([^A-Za-z0-9_-]|$)/.test(l)),
    'precondition: the doc-review command token must still be present, or this blocks for the '
      + 'uninteresting reason that no command was named'
  );

  const result = runGuard(lines);

  assert.equal(result.status, 2, 'a quoted doc verdict must not count as a doc review');
  const { description } = JSON.parse(result.stdout);
  assert.match(description, /\/codex-review-doc/, 'the doc review must still be demanded');
  assert.doesNotMatch(
    description, /codex-review-fast|\/precommit/,
    `the block must be attributable to the doc gate alone, got: ${description}`
  );
});

test('a PRECOMMIT invocation followed by an audit quoting its sentinel does not satisfy that gate', { skip: SKIP_NO_JQ }, () => {
  // The precommit plane, end to end. It is the plane the derived scan-extractor above used to miss
  // entirely — `_PRECOMMIT_VERDICT_RE` reaches both the pipe and the pairing scan through a
  // VARIABLE, so neither extractor saw it and the cross-check, measuring the same inline shape,
  // could not report the omission. A pattern nothing derives from is a pattern the report's
  // neutralization can silently stop covering.
  //
  // The arrangement is the one the pairing rule was written for: `/precommit` is invoked, and the
  // NEXT thing carrying `## Overall: ✅ PASS` is an audit report quoting it. Position alone would
  // credit the invocation with that verdict; only neutralization prevents it.
  const CODE_EDIT = '{"tool_name":"Edit","tool_input":{"path":"src/x.js"}}';
  const lines = [
    CODE_EDIT,
    '{"type":"user","content":"<command-name>/precommit</command-name>"}',
    asTranscriptLine(makeAuditReport(AUDIT_CLEAR, poisonedFields())),
  ];

  // Preconditions, both directions. The invocation must be present (otherwise the block is the
  // uninteresting "nothing named the command"), and the RAW report must genuinely carry the
  // sentinel (otherwise neutralization is being credited for a fixture that was never dangerous).
  assert.ok(
    lines.some((l) => /\/(sd0x-dev-flow:)?precommit([^A-Za-z0-9_-]|$)/.test(l)),
    'precondition: the precommit invocation token must be present'
  );
  assert.match(
    JSON.stringify(poisonedFields()),
    /## Overall: ✅ PASS/,
    'precondition: the fixture must actually quote the precommit sentinel before neutralization'
  );

  const result = runGuard(lines);

  assert.equal(result.status, 2, 'a quoted precommit sentinel must not count as a precommit run');
  const { description } = JSON.parse(result.stdout);
  assert.match(description, /\/precommit/, 'the precommit gate must still be demanded');
});

test('a blocking audit does NOT revoke a genuine doc-review pass', { skip: SKIP_NO_JQ }, () => {
  // The other direction, and the reason the sentinel is `Audit Revise` rather than the more
  // natural-reading `Audit Needs revision`: stop-guard's recency scan is `⛔.*(Block|Needs
  // revision|Must fix)`, whose `.*` would have matched the latter and turned every blocking audit
  // into a spurious "Review not passed" on an unrelated, already-passing doc gate.
  const result = runGuard([
    DOC_EDIT,
    ...surfaceLines(),
    'user: /codex-review-doc',
    '## Document Review',
    '✅ Mergeable',
    makeAuditReport(AUDIT_REVISE),
  ]);

  assert.equal(result.status, 0, `a real doc review passed; the later audit must not block it. stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('control: a genuine doc review DOES satisfy the gate in the same harness', { skip: SKIP_NO_JQ }, () => {
  // Without this, a mutation that broke the doc gate outright — or a harness that never reached
  // transcript mode at all — would make the blocking assertions above pass for the wrong reason.
  const result = runGuard([
    DOC_EDIT,
    'user: /codex-review-doc',
    '## Document Review',
    '✅ Mergeable',
  ]);

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('DERIVED: the CLI JSON branch neutralizes ACROSS fields, not just within each one', () => {
  // Drives the real CLI, not the exported helper. The helper had a unit test the moment it was
  // written, and that test stayed green when the call to it was deleted from `main()` — measured,
  // not hypothesised. A sanitizer nobody invokes sanitizes nothing, so the wiring is what has to be
  // pinned, and the only way to pin it is to run the script the skill actually runs.
  //
  // The fixture splits the payload across two FIELDS: neither value trips a scan on its own, and
  // per-value cleaning therefore cannot see it. `JSON.stringify` then puts both into one document
  // and the transcript puts that document on one grep line, which is where `Gate.*PASS` becomes a
  // passing CODE REVIEW verdict for a gate nobody ran.
  const scans = stopGuardGateForgingScans();
  const dir = makeTempDir();
  const input = path.join(dir, 'cross-field.json');
  const output = path.join(dir, 'cross-field.out.json');
  const report = auditReportObject(AUDIT_CLEAR, {
    narrative: ['the Gate below is advisory only'],
    suggested_next: ['re-run the suite once it should PASS'],
  });
  fs.writeFileSync(input, JSON.stringify(report, null, 2));

  const script = path.join(repoRoot, 'scripts', 'skills', 'necessity-audit', 'report.js');
  const r = spawnSync(process.execPath, [script, '--input', input, '--format', 'json', '--output', output], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `report.js should succeed: ${r.stderr}`);

  const raw = fs.readFileSync(output, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw), 'the cross-field sweep must not break the JSON it cleans');

  const line = asTranscriptLine(raw);
  for (const { name, pattern } of scans) {
    assert.equal(
      ereMatches(pattern, line),
      false,
      `${name} (${pattern}) matched the CLI JSON output once encoded as a transcript line:\n${line}`
    );
  }

  // Precondition: per-value cleaning ALONE leaks this fixture. Without it the loop above would pass
  // against a fixture that was never dangerous, and the deleted-wiring mutation would stay green.
  const perValueOnly = asTranscriptLine(JSON.stringify(neutralizeJsonValues(report), null, 2));
  const leaked = scans.filter(({ pattern }) => ereMatches(pattern, perValueOnly));
  assert.ok(
    leaked.length >= 1,
    'the fixture must be leaky under per-value cleaning alone, or this test proves nothing about the serialized pass'
  );
});

test('the CLI JSON form round-trips through JSON.parse with every foreign sentinel neutralized', () => {
  // The optional `--format json` output had no test at all, and the neutralization it inherited
  // was written for Markdown. `##\s*Overall:[^\n]*` runs to end of line, and in serialized JSON a
  // string's closing quote and trailing comma sit on that same line, so a value of
  // `"## Overall: ✅ PASS"` came out as `"⟨gate-sentinel elided⟩` — quote and comma eaten, file
  // unparseable. And because `JSON.stringify` escapes newlines as the two characters `\n`, the
  // `[^\n]*` never stopped at an embedded break and ran on through neighbouring fields.
  //
  // Round-tripping is the assertion that matters: a report nobody can parse is not "sanitized",
  // it is destroyed.
  const dir = makeTempDir();
  const input = path.join(dir, 'audit.json');
  const output = path.join(dir, 'audit.out.json');
  // A field whose value IS the precommit sentinel, verbatim — the exact shape that broke parsing —
  // immediately followed by another field, which is what the run-on then consumed.
  const report = auditReportObject(AUDIT_CLEAR, {
    ...poisonedFields(),
    conclusion: '## Overall: ✅ PASS',
    after: 1,
  });
  fs.writeFileSync(input, JSON.stringify(report, null, 2));

  const script = path.join(repoRoot, 'scripts', 'skills', 'necessity-audit', 'report.js');
  const r = spawnSync(process.execPath, [script, '--input', input, '--format', 'json', '--output', output], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `report.js should succeed: ${r.stderr}`);

  const raw = fs.readFileSync(output, 'utf8');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(raw); }, 'the JSON form must still be JSON');

  assert.doesNotMatch(raw, FOREIGN_SENTINELS, 'no foreign gate sentinel may survive into the JSON output');
  assert.equal(parsed.after, 1, 'a field following an elided one must survive intact');
  assert.match(parsed.conclusion, /⟨gate-sentinel elided⟩/, 'and the sentinel itself must be elided');
  // Non-vacuity: the fixture must actually have carried sentinels, or the doesNotMatch is free.
  assert.match(JSON.stringify(report), FOREIGN_SENTINELS, 'the fixture must be genuinely poisoned');
  // Structure must survive the sweep, not just syntax.
  assert.equal(parsed.elements.length, 3, 'every element must survive');
  assert.ok(Object.keys(parsed.deterministic_checks).length >= 1, 'poisoned KEYS must survive as keys');
  assert.doesNotMatch(
    Object.keys(parsed.deterministic_checks).join('\n'), FOREIGN_SENTINELS,
    'a sentinel in a KEY reaches a transcript grep exactly like one in a value'
  );
});
