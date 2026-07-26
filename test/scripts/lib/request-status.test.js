const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseRequestStatus,
  isClosedRequestStatus,
  isOpenRequestStatus,
  CLOSED_REQUEST_STATUS,
  OPEN_REQUEST_STATUS,
  HEAD_LINES,
} = require('../../../scripts/lib/request-status');

const repoRoot = path.resolve(__dirname, '../../..');

// --- The three conventions request docs actually use ---

test('parseRequestStatus reads the blockquote, heading, and table conventions', () => {
  assert.equal(parseRequestStatus('> **Status**: Pending'), 'Pending');
  assert.equal(parseRequestStatus('## Status: Completed'), 'Completed');
  assert.equal(parseRequestStatus('| Status | Candidate Complete |'), 'Candidate Complete');
});

test('parseRequestStatus unwraps a bold table value', () => {
  // Closure is decided by EXACT equality, so `**Completed**` would reopen a finished request.
  assert.equal(parseRequestStatus('| Status | **Completed** |'), 'Completed');
  assert.equal(isClosedRequestStatus(parseRequestStatus('| Status | **Completed** |')), true);
});

test('parseRequestStatus prefers blockquote over heading over table when several are present', () => {
  const doc = [
    '> **Status**: Pending',
    '## Status: Completed',
    '| Status | Done |',
  ].join('\n');
  assert.equal(parseRequestStatus(doc), 'Pending');
});

// --- The table cell must be matched unambiguously, not by competing quantifiers ---

test('an unterminated | Status | row does not stall the parser (catastrophic backtracking)', () => {
  // `\s*(.+?)\s*\|` put three quantifiers over the same run of characters, and since `.` matches
  // whitespace they all competed for it. With no closing `|` on the line the engine enumerated
  // every split: measured CUBIC — 294ms at 800 characters, ~20s at a few KB. Request docs are read
  // from disk by `next-step` and `fc-extractor`, so a single padded, unterminated row hung the
  // tool with no error and no obvious cause.
  //
  // 3.2KB is chosen deliberately: it is the size at which the old pattern took roughly 150
  // SECONDS, so the bound below cannot be met by accident on any machine, and 1000ms leaves ample
  // room for a loaded CI box (the fixed implementation measures ~0.1ms).
  const padded = `| Status | ${' \t'.repeat(1600)}`;
  const started = process.hrtime.bigint();
  const result = parseRequestStatus(padded);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(elapsedMs < 1000, `parsing must stay linear; took ${elapsedMs.toFixed(1)}ms`);
  assert.equal(result, null, 'and an unterminated row still reads as "no Status field" (open)');
});

test('parsing stays linear as the malformed cell grows (rules out a merely faster blowup)', () => {
  // A single timing bound can be met by an implementation that is still super-linear but starts
  // small. Compare growth instead: 16x the input must not cost anywhere near 16^2 the time.
  const measure = (n) => {
    const input = `| Status | ${' \t'.repeat(n)}`;
    const started = process.hrtime.bigint();
    for (let i = 0; i < 50; i += 1) parseRequestStatus(input);
    return Number(process.hrtime.bigint() - started) / 1e6;
  };
  measure(400); // warm up, so JIT compilation is not charged to the first real measurement
  const small = Math.max(measure(400), 0.01);
  const large = measure(6400); // 16x the input

  assert.ok(large / small < 100, `16x input must not cost ~256x time (quadratic) — ratio was ${(large / small).toFixed(1)}x`);
});

test('the table cell is matched with a negated class, not competing quantifiers', () => {
  // Structural backstop for the two timing tests: a bound loosened on a slow CI box would let the
  // ambiguous pattern back in silently. The defect is a SHAPE, so pin the shape.
  const src = fs.readFileSync(path.join(repoRoot, 'scripts/lib/request-status.js'), 'utf8');
  const tableRe = src.split('\n').find((l) => /^const STATUS_TABLE_RE\s*=/.test(l));
  assert.ok(tableRe, 'the table pattern must still be a named top-level constant');
  assert.match(tableRe, /\[\^\|\\n\]/, 'the cell must be a negated class — `|` cannot occur inside a markdown cell');
  assert.doesNotMatch(tableRe, /\\s\*\(\.\+\?\)\\s\*/, 'the `\\s*(.+?)\\s*` sandwich is the cubic shape and must not return');
});

test('bold unwrapping still behaves exactly as the two-pattern version did', () => {
  // Bold is now stripped from the extracted cell rather than by a second whole-line regex. These
  // are the cases where the two designs could plausibly diverge.
  assert.equal(parseRequestStatus('| Status | **Completed** |'), 'Completed');
  assert.equal(parseRequestStatus('| Status | **a** and **b** |'), 'a** and **b', 'greedy across inner pairs, as before');
  assert.equal(parseRequestStatus('| Status | **Unclosed |'), '**Unclosed', 'an unclosed bold marker is part of the value');
  assert.equal(parseRequestStatus('| Status | **  spaced  ** |'), 'spaced', 'the unwrapped value is trimmed too');
  assert.equal(parseRequestStatus('| Status ||'), null, 'an EMPTY cell is still "no Status field", not an empty status');
  assert.equal(parseRequestStatus('| Status |   |'), '', 'a whitespace-only cell trims to the empty string, as before');
  assert.equal(parseRequestStatus('| Status | a | b |'), 'a', 'the FIRST cell wins, as before');
});

test('parseRequestStatus returns null for absent, empty, and non-string input', () => {
  assert.equal(parseRequestStatus('# A request\n\nSome prose about status.'), null);
  assert.equal(parseRequestStatus(''), null);
  assert.equal(parseRequestStatus(null), null);
  assert.equal(parseRequestStatus(undefined), null);
});

test(`parseRequestStatus scans only the first ${HEAD_LINES} lines`, () => {
  const deep = `${Array(HEAD_LINES + 5).fill('filler').join('\n')}\n> **Status**: Completed`;
  assert.equal(
    parseRequestStatus(deep), null,
    'a Status below the window must not be picked up — a `## Status:` heading deep in a long body '
      + 'is a section, not front-matter'
  );
  const shallow = `${Array(HEAD_LINES - 2).fill('filler').join('\n')}\n> **Status**: Completed`;
  assert.equal(parseRequestStatus(shallow), 'Completed', 'and the last line inside the window still counts');
});

// --- Openness is defined negatively ---

test('isClosedRequestStatus is exact membership, not a substring or case-insensitive match', () => {
  assert.equal(isClosedRequestStatus('Completed'), true);
  assert.equal(isClosedRequestStatus('  Done  '), true, 'surrounding whitespace is trimmed');
  assert.equal(isClosedRequestStatus('completed'), false, 'case must match');
  assert.equal(
    isClosedRequestStatus('Completed (superseded below)'), false,
    'an annotated value is NOT closed — a field consumers compare exactly cannot also carry commentary'
  );
  assert.equal(isClosedRequestStatus(null), false);
  assert.equal(isClosedRequestStatus(undefined), false);
});

test('every known OPEN status reads as open, and every CLOSED one as closed', () => {
  for (const s of OPEN_REQUEST_STATUS) {
    assert.equal(isOpenRequestStatus(s), true, `${s} must read as open`);
    assert.equal(isClosedRequestStatus(s), false, `${s} must not read as closed`);
  }
  for (const s of CLOSED_REQUEST_STATUS) {
    assert.equal(isClosedRequestStatus(s), true, `${s} must read as closed`);
    assert.equal(isOpenRequestStatus(s), false, `${s} must not read as open`);
  }
});

test('the two vocabularies are disjoint', () => {
  const overlap = [...OPEN_REQUEST_STATUS].filter((s) => CLOSED_REQUEST_STATUS.has(s));
  assert.deepEqual(overlap, [], 'a status cannot mean both');
});

test('an UNRECOGNISED status reads as open, and so does an absent one', () => {
  // The whole point of defining openness negatively: a value nobody has thought of yet must not
  // silently count as finished work. This is what makes the taxonomy unable to go stale the way
  // analyze.js's positive list did.
  assert.equal(isOpenRequestStatus('Blocked On Review'), true);
  assert.equal(isOpenRequestStatus('進行中'), true);
  assert.equal(isOpenRequestStatus(null), true, 'no Status field means the work is not proven done');
});

// --- The vocabulary matches what is actually on disk ---

test('CLOSED_REQUEST_STATUS ∪ OPEN_REQUEST_STATUS covers every status used in this repo', () => {
  // The regression that motivated this module: `Candidate Complete` appears in 20 request docs and
  // was in nobody's open list. If a new value enters the corpus, this fails and the vocabulary
  // must be updated deliberately rather than discovered by a wrong `feature-complete`.
  const docs = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); }
      else if (e.name.endsWith('.md') && p.includes(`${path.sep}requests${path.sep}`)) docs.push(p);
    }
  };
  walk(path.join(repoRoot, 'docs'));
  assert.ok(docs.length > 50, `expected a real corpus, found ${docs.length} request docs`);

  const unknown = new Map();
  let parsed = 0;
  for (const d of docs) {
    const status = parseRequestStatus(fs.readFileSync(d, 'utf8'));
    if (status == null) continue;
    parsed += 1;
    if (!CLOSED_REQUEST_STATUS.has(status) && !OPEN_REQUEST_STATUS.has(status)) {
      unknown.set(status, (unknown.get(status) || 0) + 1);
    }
  }
  assert.equal(parsed, docs.length, 'every request doc in this repo carries a parseable Status');
  assert.deepEqual(
    [...unknown.entries()], [],
    'status values on disk that neither vocabulary knows — add them to request-status.js'
  );
});

test('Candidate Complete and Spec Complete are open — the exact values analyze.js used to miss', () => {
  // Named explicitly, not just covered by the loop above: these two are the regression. Removing
  // either from OPEN_REQUEST_STATUS keeps the corpus test green (unknown ⇒ still open), so only a
  // named assertion records that they were the omission.
  assert.equal(isOpenRequestStatus('Candidate Complete'), true);
  assert.equal(isOpenRequestStatus('Spec Complete'), true);
  assert.ok(OPEN_REQUEST_STATUS.has('Candidate Complete'));
  assert.ok(OPEN_REQUEST_STATUS.has('Spec Complete'));
});

// --- One contract, not three copies ---

test('fc-extractor and next-step/analyze.js both consume this module rather than re-implementing it', () => {
  // The defect was three parsers with three windows, three case rules and three open-status ideas.
  // A future copy would reintroduce it silently, so the absence of local re-implementations is
  // pinned here rather than left to review.
  for (const rel of ['scripts/lib/fc-extractor.js', 'skills/next-step/scripts/analyze.js']) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    // CODE only, and the require SHAPE rather than the bare module name. `assert.match(src,
    // /request-status/)` was satisfied by prose: both files carry a comment explaining why the
    // shared contract exists, so deleting the actual `require` left this test green — verified by
    // replacing the require with `require('OTHER')` in each file, which changed nothing. An
    // assertion that a comment can satisfy is testing the commentary.
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.match(
      code, /=\s*require\([^;\n]*request-status[^;\n]*\)/,
      `${rel} must REQUIRE the shared contract — a comment naming it is not a dependency`
    );
    assert.doesNotMatch(
      code, /^function parseRequestStatus\(/m,
      `${rel} must not define its own parseRequestStatus`
    );
    assert.doesNotMatch(
      code, /new Set\(\['Completed'/,
      `${rel} must not keep its own closed-status set`
    );
  }
});

test('every prose surface that enumerates the closed set lists ALL of it', () => {
  // The set grew to four while three docs still said three. Nothing was red, and the omission was
  // the one status a reader would least expect to be missing — `Archived`, whose whole purpose is
  // to close a request. Any doc that starts spelling the set out has to spell out all of it.
  // DERIVED, not hand-listed. The first version of this test named two files, and the omission it
  // was written to catch was sitting in a third — `skills/tech-spec/references/`
  // `feature-context-resolution.md`, a near-copy of one of the two, still saying three. A lock
  // whose scope is typed by hand fails exactly where a copy-paste put the drift, because the same
  // inattention that duplicated the prose also skips updating the list. Walk the doc surfaces and
  // let the heuristic decide which ones are enumerating.
  const SURFACES = [];
  (function walk(rel) {
    for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.md')) SURFACES.push(child);
    }
  })('skills');
  for (const rel of ['rules', 'scripts', 'docs']) {
    (function walk(r) {
      for (const entry of fs.readdirSync(path.join(repoRoot, r), { withFileTypes: true })) {
        const child = path.join(r, entry.name);
        if (entry.isDirectory()) walk(child);
        else if (entry.name.endsWith('.md')) SURFACES.push(child);
      }
    })(rel);
  }

  const closed = [...CLOSED_REQUEST_STATUS];
  const incomplete = [];
  let enumerations = 0;

  for (const rel of SURFACES) {
    fs.readFileSync(path.join(repoRoot, rel), 'utf8').split('\n').forEach((line, i) => {
      // "Enumerating" means two members joined by a comma — an actual list. Membership alone is
      // far too loose: it flagged the Phase 3 classification table (`| Completed | Done | No |`,
      // where `Done` is the CLASSIFICATION column, not a second status) and the lifecycle arrow
      // line `Pending → In Progress → Candidate Complete → Completed`. Neither claims to be the
      // closed set, so neither owes it completeness.
      const alt = closed.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      if (!new RegExp(`\\b(?:${alt})\\b\\s*,\\s*(?:${alt})\\b`).test(line)) return;
      const named = closed.filter((c) => new RegExp(`\\b${c}\\b`).test(line));
      const missing = closed.filter((c) => !named.includes(c));
      enumerations += 1;
      if (missing.length) incomplete.push(`${rel}:${i + 1} omits ${missing.join(', ')}`);
    });
  }

  // A scan that matches nothing passes for free. If a doc rewrite stops spelling the set out —
  // or the comma heuristic stops recognising how it is spelled — this test would go quietly green
  // while checking nothing, which is strictly worse than not having it.
  assert.ok(
    enumerations >= 3,
    `expected the surfaces to enumerate CLOSED_REQUEST_STATUS in at least 3 places, matched ${enumerations} `
      + '— either the docs stopped listing it or the detector stopped recognising the list'
  );

  assert.deepEqual(
    incomplete, [],
    'these lines enumerate CLOSED_REQUEST_STATUS but not all of it — a request whose Status is an '
      + 'omitted member reads as still-open to a human following the doc and as closed to the code'
  );
});

test('fc-extractor still re-exports the same names, so its consumers are unchanged', () => {
  const fc = require('../../../scripts/lib/fc-extractor');
  assert.equal(typeof fc.parseRequestStatus, 'function');
  assert.deepEqual([...fc.CLOSED_REQUEST_STATUS].sort(), [...CLOSED_REQUEST_STATUS].sort());
});
