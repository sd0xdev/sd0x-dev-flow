'use strict';

// Shared structural parsing for the shell hooks, used by the static invariants in
// test/hooks/state-commit-ownership.test.js and test/hooks/post-tool-review-state.test.js.
//
// Shared rather than copied because both copies had already drifted into a fail-open. `heredocBody`
// is the second attempt at its own regex: the first was unanchored, so `<<` re-matched at the
// SECOND `<` of a here-string and one `grep -q x <<< 'EOF'` opened a phantom heredoc that swallowed
// the rest of the file — every scan then saw nothing and passed. A guard that subtle, maintained in
// two places, is a guard that is correct in one of them.
//
// Rationale for the invariants these serve: docs/features/auto-loop-autonomy/4-implementation.md
// §1.2 and §1.3.

const assert = require('node:assert/strict');

function isComment(line) {
  return /^\s*#/.test(line);
}

const heredocCache = new WeakMap();

/**
 * The set of 0-based line indices that are heredoc BODY — excluded from every structural scan,
 * because a heredoc body is data and reads exactly like code. The JSON document in
 * `init_state_file` is the case that forced this: its closing `}` sits at column 0 and would
 * otherwise read as a function terminator.
 *
 * Throws on a heredoc still open at EOF: that means the opener was spurious and everything below it
 * was deleted from every scan, which is indistinguishable from a clean tree.
 */
function heredocBody(lines) {
  let cached = heredocCache.get(lines);
  if (cached) return cached;
  cached = new Set();
  let delim = null;
  let dash = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (delim === null) {
      if (isComment(lines[i])) continue;
      // Both guards are load-bearing. An unanchored `<<` re-matches at the SECOND `<` of a `<<<`
      // here-string, so `grep -q x <<< 'EOF'` opens a heredoc on delimiter EOF and swallows every
      // line after it — every scan then sees an empty file and passes. `(?<!<)` and `(?!<)` are
      // what make `<<<` unreachable; reasoning that "the char after `<<` is `<`" is not enough,
      // because the regex is free to start one character later.
      const m = lines[i].match(/(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/);
      if (m) { dash = m[1] === '-'; delim = m[3]; }
      continue;
    }
    if ((dash ? lines[i].replace(/^\t+/, '') : lines[i]) === delim) { delim = null; continue; }
    cached.add(i);
  }
  assert.equal(delim, null, `unterminated heredoc (delimiter ${delim}) — the rest of the file was excluded from every scan`);
  heredocCache.set(lines, cached);
  return cached;
}

/**
 * Every `name() {` … `}` in the file as `{ name, start, end, docStart }`, 0-based and inclusive,
 * where `end` is the function's OWN closing brace at column 0 and `docStart` is the top of the
 * contiguous comment block above the declaration.
 *
 * Bounding at the closing brace rather than at the next declaration is the whole point. Ranges that
 * run to the next `name() {` attribute every FILE-SCOPE line to the function above it, which turns
 * "which function calls this helper?" into an answer that is never `(file scope)` — so a rogue
 * top-level caller inherits the enclosing function's clearance. Verified: a file-scope writer
 * inserted after `init_state_file`'s closing brace passed every caller-set assertion.
 *
 * Recognizes `name() {` only — the brace must be on the declaration line. A writer spelled
 * `name()` / `{` on two lines is invisible here and gets no range at all, so a caller-set scan
 * would report it as file scope rather than missing it. Not closed, because
 * state-commit-ownership.test.js catches that shape independently and the tree does not use it.
 */
function functionRanges(lines) {
  const heredoc = heredocBody(lines);
  const fns = [];
  let cur = null;
  lines.forEach((line, i) => {
    if (heredoc.has(i) || isComment(line)) return;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(line);
    if (m) {
      // A declaration reached with one still open means the brace matching is wrong, and every
      // range after it would be wrong too. Fail loudly rather than guessing which is the parent.
      assert.equal(cur, null, `function ${m[1]} at line ${i + 1} opens before ${cur && cur.name} closed`);
      let head = i - 1;
      while (head >= 0 && isComment(lines[head])) head -= 1;
      cur = { name: m[1], start: i, end: null, docStart: head + 1 };
      return;
    }
    if (cur && /^\}/.test(line)) {
      cur.end = i;
      fns.push(cur);
      cur = null;
    }
  });
  assert.equal(cur, null, `function ${cur && cur.name} never closed at column 0`);
  return fns;
}

/** The function containing a line index, or null when the line is at file scope. */
function enclosingFunction(fns, index) {
  return fns.find((f) => index >= f.start && index <= f.end) || null;
}

module.exports = { isComment, heredocBody, functionRanges, enclosingFunction };
