const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

// The finding-identity normalizer lives inline in post-tool-review-state.sh as two `sed -E`
// invocations. Both are EXTRACTED from the hook source and run under the real sed here, for the
// same reason test/hooks/jq-filter-fidelity.test.js extracts its jq filters: the hook suites drive
// the hook through a hand-written JS stub bin, and a table of cases checked against a re-typed copy
// of the regex tests the copy. Extraction fails loudly if the production text moves.
const HOOK = resolve(__dirname, '../../hooks/post-tool-review-state.sh');
const src = readFileSync(HOOK, 'utf8');

// Returns sed's full argv (everything after `sed`), NOT just the quoted programs: the `-e` flags
// are load-bearing. Dropping them turns `-e ':a' -e 's/…/' -e 'ta'` into one script plus two
// filenames, which fails in a way that looks like a regex bug.
function extractSedArgs(marker) {
  const at = src.indexOf(marker);
  assert.notEqual(at, -1, `sed pipeline not found in the hook: ${marker}`);
  assert.equal(
    src.indexOf(marker, at + 1), -1,
    `the marker must be unique or extraction silently tests the first of several: ${marker}`
  );
  // A sed invocation may be CONTINUED across lines with a trailing backslash, and the normalizer
  // is: taking only the first physical line would drop the `-e` expressions that follow it and
  // test a program the hook never runs. Stop at the next PIPELINE stage — a continuation line
  // beginning with `|` is the next command, not more arguments to this sed.
  const rest = src.slice(at).split('\n');
  const parts = [];
  for (const l of rest) {
    if (parts.length > 0 && l.trimStart().startsWith('|')) break;
    const cont = /\\$/.test(l.trimEnd());
    parts.push(l.trimEnd().replace(/\\$/, ''));
    if (!cont) break;
  }
  const line = parts.join(' ');
  const body = line.slice(line.indexOf('sed ') + 4);
  // Tokens are either a single-quoted word or a run of non-space. The programs contain no embedded
  // single quotes — sed cannot receive one inside a single-quoted shell word — so this is exact.
  const args = [...body.matchAll(/'([^']*)'|(\S+)/g)].map(m => (m[1] !== undefined ? m[1] : m[2]));
  assert.ok(args.includes('-E'), `expected an ERE sed on the extracted line: ${line}`);
  return args;
}

const STRIP_ARGS = extractSedArgs("| sed -E 's/^- \\[(P0|P1|P2|Nit)\\]");
const NORMALIZE_ARGS = extractSedArgs("| sed -E -e ':a'");

// Guards the extraction itself: the loop form is what handles coordinate depth, and the trailing-
// edge anchor is what stops a colon inside a path from being eaten. If either disappears from the
// hook, the table below would silently start testing a different program.
test('extraction: the normalizer is still a trailing-edge-anchored loop', () => {
  assert.deepEqual(
    NORMALIZE_ARGS.filter(a => a === ':a' || a === 'ta'), [':a', 'ta'],
    'the substitution must loop, or deep coordinates keep a line number'
  );
  const prog = NORMALIZE_ARGS.find(a => a.startsWith('s/'));
  assert.ok(prog, 'the loop must contain a substitution');
  assert.match(
    prog, /\(\[\[:space:\]\]\|\$\)/,
    'the substitution must be anchored to the token trailing edge, or it eats colons mid-path'
  );
});

/** Runs a raw reviewer finding line through the hook's own two-stage normalizer. */
function normalize(line) {
  const stripped = spawnSync('sed', STRIP_ARGS, { input: `${line}\n`, encoding: 'utf8' });
  assert.equal(stripped.status, 0, `stage 1 sed failed: ${stripped.stderr}`);
  const out = spawnSync('sed', NORMALIZE_ARGS, { input: stripped.stdout, encoding: 'utf8' });
  assert.equal(out.status, 0, `stage 2 sed failed: ${out.stderr}`);
  return out.stdout.replace(/\n$/, '');
}

// `expected` is the identity the ledger stores. The property that matters is not beauty but
// STABILITY: two rounds reporting the same defect at shifted lines must produce the same string,
// and two DIFFERENT defects must never collide into one.
const CASES = [
  // --- the shapes the ledger exists for: the line number must not survive ---
  { name: 'file:line', input: '- [P1] src/a.ts:12 unchecked null', expected: 'src/a.ts unchecked null' },
  { name: 'file:line:col', input: '- [P1] src/a.ts:12:4 unchecked null', expected: 'src/a.ts unchecked null' },
  { name: 'three coordinates', input: '- [P2] a.yml:12:34:56 bad indent', expected: 'a.yml bad indent' },
  { name: 'four coordinates', input: '- [P2] a.yml:1:2:3:4 bad indent', expected: 'a.yml bad indent' },
  { name: 'windows-style drive path', input: '- [P0] C:\\src\\a.ts:12 leak', expected: 'C:\\src\\a.ts leak' },
  { name: 'no location at all', input: '- [Nit] prefer early return', expected: 'prefer early return' },
  { name: 'location is the whole line', input: '- [P1] src/a.ts:12', expected: 'src/a.ts' },

  // --- the shapes a mid-token substitution corrupts: the path must survive INTACT ---
  // A colon-number inside the filename is the collision case. `src/rev:12.js:34` reduced to
  // `src/rev.js` is indistinguishable from a finding genuinely located in `src/rev.js`, so the
  // ledger would report one closed and one new every round they both appear.
  { name: 'colon-number inside the filename', input: '- [P1] src/rev:12.js:34 stale cache', expected: 'src/rev:12.js stale cache' },
  { name: 'colon-digit-letter inside the filename', input: '- [P1] src/api:2fa.ts:12 weak otp', expected: 'src/api:2fa.ts weak otp' },
  { name: 'colon-number filename with no coordinate', input: '- [P2] src/rev:12.js stale cache', expected: 'src/rev:12.js stale cache' },

  // --- issue PROSE is never searched for a location: only the first token is ---
  // An expression that hunted the rest of the line for something location-shaped was tried and
  // reverted. It read `timeout 30:5 seconds` as a location, producing the same identity as a real
  // `timeout 30 seconds` finding — and `sort -u` then silently drops one of the two. Pinned in
  // both directions here and by the injectivity test below.
  { name: 'prose numbers survive on a finding with no location', input: '- [Nit] timeout 30:5 seconds', expected: 'timeout 30:5 seconds' },
  { name: 'prose numbers survive after a real location is stripped', input: '- [P1] src/a.ts:12 see line 40:2 below', expected: 'src/a.ts see line 40:2 below' },

  // --- accepted residuals, pinned so a future change to them is a decision, not a surprise ---
  // Each is a location the contract's space delimiter cannot bound, so it keeps its line number
  // and a line shift still reads as churn for that one finding. Measured: 0 of 781 tracked files
  // here contain a space, a colon, or a terminal `:digits`. Documented in
  // docs/features/auto-loop-autonomy/4-implementation.md §2.2.
  { name: 'residual: a line range keeps its range', input: '- [P1] src/a.ts:12-14 dead branch', expected: 'src/a.ts:12-14 dead branch' },
  { name: 'residual: a path containing a space keeps its line', input: '- [P1] docs/My File.md:12 broken link', expected: 'docs/My File.md:12 broken link' },
  // UNDECIDABLE, not merely unhandled: `src/rev:12:34` is equally "file src/rev:12, line 34" and
  // "file src/rev, line 12, column 34". Pinned so the collision is visible rather than assumed
  // absent — see the note in the hook and §2.2 for why closing it is a reviewer-contract change.
  { name: 'residual: a filename ending in :digits is indistinguishable from a coordinate', input: '- [P1] src/rev:12:34 stale cache', expected: 'src/rev stale cache' },
];

for (const c of CASES) {
  test(`identity normalization: ${c.name}`, () => {
    assert.equal(normalize(c.input), c.expected);
  });
}

test('identity normalization: a line shift produces the SAME identity', () => {
  // The whole point of the ledger. Without this, `closed`/`new` count line movement as churn.
  assert.equal(
    normalize('- [P1] src/a.ts:12 unchecked null'),
    normalize('- [P1] src/a.ts:487 unchecked null')
  );
});

test('identity normalization: distinct files do NOT collide', () => {
  // Negative control for the test above: a normalizer that discarded the path entirely would
  // satisfy the stability assertion perfectly and make the ledger useless.
  assert.notEqual(
    normalize('- [P1] src/a.ts:12 unchecked null'),
    normalize('- [P1] src/b.ts:12 unchecked null')
  );
});

test('identity normalization: a colon-number path does NOT collide with its stripped form', () => {
  // Negative control for the collision case specifically. This is the assertion an unanchored
  // loop fails: it maps both inputs to `src/rev.js stale cache`.
  assert.notEqual(
    normalize('- [P1] src/rev:12.js:34 stale cache'),
    normalize('- [P1] src/rev.js:34 stale cache')
  );
});

test('identity normalization: normalizing must not merge two distinct findings', () => {
  // INJECTIVITY, asserted directly rather than inferred from the table. Every case above pins one
  // input to one output, which cannot catch two DIFFERENT inputs arriving at the same output —
  // and that is the failure mode that costs something: identities go through `sort -u`, so a
  // collision does not just mislabel a finding, it deletes one. The pairs below are the ones a
  // location-hunting normalizer collapses.
  const pairs = [
    ['- [Nit] timeout 30:5 seconds', '- [Nit] timeout 30 seconds'],
    ['- [Nit] raise 30:5 and lower 40:9 here', '- [Nit] raise 30 and lower 40:9 here'],
    ['- [P1] docs/My File.md:12 broken link', '- [P1] docs/My File.md broken link'],
  ];
  for (const [a, b] of pairs) {
    assert.notEqual(normalize(a), normalize(b), `these must stay distinct: ${a} / ${b}`);
  }

  // The one KNOWN collision, asserted rather than omitted. A filename ending in `:digits` is
  // undecidable against a `file:line` coordinate, so these three distinct findings share one
  // identity and `sort -u` keeps a single round entry for all three. Accepted (0 of 781 tracked
  // files have the shape; the ledger is advisory) — but an accepted collision that no test states
  // is indistinguishable from one nobody noticed, and the injectivity pairs above can never
  // express it, since they assert only what must stay APART.
  const collide = [
    '- [P1] src/rev:12:34 stale cache',
    '- [P1] src/rev:34 stale cache',
    '- [P1] src/rev stale cache',
  ].map(normalize);
  assert.deepEqual(new Set(collide).size, 1, 'the documented residual collision, pinned as a decision');
  assert.equal(collide[0], 'src/rev stale cache');
});

test('identity normalization: the severity tag is dropped so a re-graded finding is not new', () => {
  // Severity is recorded in its own ledger counters; carrying it in the identity would make a
  // P1 downgraded to P2 read as one closed and one new.
  assert.equal(
    normalize('- [P1] src/a.ts:12 unchecked null'),
    normalize('- [P2] src/a.ts:12 unchecked null')
  );
});
