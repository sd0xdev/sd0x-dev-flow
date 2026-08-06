'use strict';

// Direct tests for the shared structural parser. It has no behaviour of its own in production — it
// exists only to answer questions for two static invariants — but that is exactly why it needs its
// own tests: when it is wrong, the suites that depend on it go GREEN (a function it fails to see is
// a function whose commits are never judged), so its failures are invisible from the caller side.
// Both its `assert`s can also take down two unrelated suites at once, and a parse quirk in a hook
// nobody touched would surface as an unexplained failure somewhere else entirely.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { heredocBody, functionRanges, enclosingFunction } = require('./shell-structure');

// `heredocBody`'s here-string cases (`<<< 'EOF'`, `<<<"EOF"`, `<<<EOF`, `$(( x << 2 ))`, `<<-`, a
// quoted delimiter, the unterminated-heredoc throw) live in test/hooks/state-commit-ownership.test.js,
// which imports this same helper. They are NOT duplicated here — but they are load-bearing there
// under a heading about something else, so if that file ever stops importing the helper, the
// anchoring guard described at shell-structure.js:41 disappears with no test going red.
const HOOKS_DIR = join(__dirname, '..', '..', 'hooks');
const lines = (src) => src.split('\n');

test('functionRanges: a range ends at the function\'s own closing brace, not the next declaration', () => {
  const src = [
    'first() {',      // 0
    '  echo a',       // 1
    '}',              // 2
    'AT_FILE_SCOPE=1', // 3 — belongs to NOBODY
    'second() {',     // 4
    '  echo b',       // 5
    '}',              // 6
  ].join('\n');
  const fns = functionRanges(lines(src));

  assert.deepEqual(
    fns.map((f) => [f.name, f.start, f.end]),
    [['first', 0, 2], ['second', 4, 6]]
  );
  assert.equal(enclosingFunction(fns, 3), null, 'the file-scope line must belong to no function');
  assert.equal(enclosingFunction(fns, 1).name, 'first');
  assert.equal(enclosingFunction(fns, 5).name, 'second');
});

test('functionRanges: a heredoc body containing a column-0 brace does not end the function', () => {
  // The case that forced heredoc-awareness. `init_state_file` writes a JSON document through
  // `cat << EOF`, and that document's closing `}` sits at column 0. Read as a terminator, the
  // function ends BEFORE its own commit — so the commit is attributed to file scope and every
  // ownership assertion silently stops applying to it.
  const src = [
    'writer() {',                    // 0
    '  cat > "$tmp" << EOF',         // 1
    '{',                             // 2
    '  "k": 1',                      // 3
    '}',                             // 4  <- data, not code
    'EOF',                           // 5
    '  mv "$tmp" "$STATE_FILE"',     // 6  <- must still be inside `writer`
    '}',                             // 7
  ].join('\n');
  const fns = functionRanges(lines(src));

  assert.deepEqual(fns.map((f) => [f.name, f.start, f.end]), [['writer', 0, 7]]);
  assert.equal(enclosingFunction(fns, 6).name, 'writer', 'the commit is inside the function');
  assert.deepEqual([...heredocBody(lines(src))], [2, 3, 4]);
});

test('functionRanges: docStart covers the contiguous comment block above the declaration', () => {
  // `# UNLOCKED-WRITER:` declarations live in the doc block, so a docStart that starts at the
  // declaration line would make every declaration invisible and every unlocked writer an offender.
  const src = ['x=1', '# doc line 1', '# doc line 2', 'f() {', '  :', '}'].join('\n');
  const [f] = functionRanges(lines(src));
  assert.equal(f.docStart, 1);
  assert.equal(f.start, 3);
});

test('functionRanges: a blank line between the doc block and the declaration ends the doc block', () => {
  // Negative control for the test above: `docStart` walks back over COMMENTS only. Without this,
  // "the comment block above" could quietly extend across a blank into an unrelated comment, and a
  // declaration written for one function would cover the next.
  const src = ['# unrelated note', '', 'f() {', '  :', '}'].join('\n');
  const [f] = functionRanges(lines(src));
  assert.equal(f.docStart, 2, 'the doc block is empty; docStart is the declaration itself');
});

test('functionRanges: an unclosed function fails loudly instead of swallowing the rest of the file', () => {
  // Silence here is the dangerous outcome: one unclosed function makes every range below it wrong,
  // and wrong ranges make the caller-set and ownership scans pass on code they misattributed.
  assert.throws(
    () => functionRanges(lines(['a() {', '  echo x', 'b() {', '  echo y', '}'].join('\n'))),
    /opens before a closed/
  );
  assert.throws(
    () => functionRanges(lines(['a() {', '  echo x'].join('\n'))),
    /never closed at column 0/
  );
});

test('functionRanges: a declaration inside a comment is not a function', () => {
  const src = ['# f() {', 'g() {', '  :', '}'].join('\n');
  assert.deepEqual(functionRanges(lines(src)).map((f) => f.name), ['g']);
});

test('functionRanges parses every shipped hook, and every range is real shell', () => {
  // What this case actually buys: the parser survives every construct the shipped hooks contain
  // (the unit fixtures above are hand-written and cannot), and it fails HERE rather than inside
  // the two suites that consume it — `functionRanges`' own two `assert`s would otherwise take
  // those down with a message pointing at neither of them. The per-range shape checks below are
  // deliberately restatements of the parser's construction invariants and cannot fail; the
  // non-vacuity guard is the tree-wide `total` at the end, not them.
  const hooks = readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.sh')).sort();
  assert.ok(hooks.length >= 4, `expected the tree's hooks, found ${hooks.length}`);

  let total = 0;
  for (const hook of hooks) {
    const src = readFileSync(join(HOOKS_DIR, hook), 'utf8');
    const all = lines(src);
    // No per-hook minimum: `pre-edit-guard.sh` is 83 lines of straight-line script with no
    // functions at all, and demanding one there would be asserting a fact about that hook rather
    // than about the parser. The tree-wide total below is the non-vacuity guard instead.
    const fns = functionRanges(all);
    total += fns.length;

    for (const f of fns) {
      assert.match(all[f.start], /^[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{/, `${hook}:${f.start + 1} bad start`);
      assert.match(all[f.end], /^\}/, `${hook}:${f.end + 1} is not a closing brace`);
      assert.ok(f.end > f.start, `${hook}: ${f.name} has an empty or inverted range`);
    }

    // Also a construction invariant, kept as documentation of what an overlap would MEAN rather
    // than as a live guard: nesting is rejected earlier and with a better message by the parser's
    // own `assert.equal(cur, null)` (shell-structure.js:84), already pinned by the unit case
    // above. The consequence is real though — `enclosingFunction` uses `.find()`, so an inner
    // function's lines would resolve to the outer one and inherit its caller clearance.
    for (let i = 1; i < fns.length; i += 1) {
      assert.ok(fns[i].start > fns[i - 1].end, `${hook}: ${fns[i].name} overlaps ${fns[i - 1].name}`);
    }
  }
  assert.ok(total >= 100, `expected the tree's shell functions, found ${total}`);
});
