const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { readFileSync } = require('node:fs');

const ROOT = resolve(__dirname, '../..');

// === deep-explore regression: one code-extension list across all gate hooks ===
//
// Multiple hook sites decide "is this a code file?" to drive the review gate.
// They MUST share ONE extension list — if they drift, a file type gets gated by
// some hooks and silently ignored by others (e.g. an edit blocks the stop guard
// but never marks has_code_change, or vice versa).
//
// Discovery must NOT key on any single code token (e.g. `ipynb`): if a hook
// dropped that exact token while another list in the same file kept it, a
// token-keyed extractor would never see the drifted list and the test would
// pass while the drift shipped. Instead we identify the code-review family
// structurally — a substantial extension list (≥10 alternatives) that does NOT
// carry json/yaml. The auto-formatter's own file-type list is the only long
// list containing json/yaml/yml, so excluding those isolates the review-gate
// lists; the short secrets (`env|pem|key|secret`) and doc (`md|mdx`) lists fall
// below the length floor. Dropping ANY code token still leaves the list ≥10 and
// json-free, so the drift is caught.
//
// The code-OR-doc variant appends `|md|mdx`; it is normalized away before the
// set comparison so both the pure-code and code+doc forms are accepted.

const CODE_RUN =
  'ts|tsx|js|jsx|mjs|cjs|py|pyw|go|rs|java|kt|kts|rb|php|swift|c|cpp|cc|h|hpp|cs|scala|ex|exs|sh|bash|zsh|ipynb';

// Every hook that gates on code files. Line numbers drift, so this is by file.
const GATE_HOOKS = [
  'post-compact-auto-loop.sh',
  'post-skill-auto-loop.sh',
  'user-prompt-review-guard.sh',
  'post-edit-format.sh',
  'stop-guard.sh',
  'session-init.sh',
];

// Pull every review-gate extension alternation out of a hook's source, WITHOUT
// keying on any single code token (see header). Structural filter: a substantial
// list (≥10 alternatives) that does not carry the formatter's json/yaml tokens.
function codeExtLists(src) {
  return [...src.matchAll(/\\\.\(([a-z0-9|]+)\)/g)]
    .map((m) => m[1])
    .filter((alt) => {
      const toks = alt.split('|');
      if (toks.length < 10) return false; // skip short secrets/doc lists
      if (toks.some((t) => t === 'json' || t === 'yaml' || t === 'yml')) {
        return false; // the auto-formatter's own list — not a review gate
      }
      return true;
    });
}

for (const hook of GATE_HOOKS) {
  test(`${hook}: every code-review extension list is the canonical run`, () => {
    const src = readFileSync(join(ROOT, 'hooks', hook), 'utf8');
    const lists = codeExtLists(src);
    assert.ok(
      lists.length > 0,
      `${hook} has no code-review extension list (no ≥10-token, json/yaml-free alternation found)`
    );
    for (const list of lists) {
      const normalized = list.replace(/\|md\|mdx$/, '');
      assert.equal(
        normalized,
        CODE_RUN,
        `${hook}: code-extension list drifted\n  got:  ${list}\n  want: ${CODE_RUN}[|md|mdx]`
      );
    }
  });
}

test('gate hooks share exactly one canonical code-extension list (set-equality)', () => {
  const seen = new Set();
  for (const hook of GATE_HOOKS) {
    const src = readFileSync(join(ROOT, 'hooks', hook), 'utf8');
    for (const list of codeExtLists(src)) {
      seen.add(list.replace(/\|md\|mdx$/, ''));
    }
  }
  assert.deepEqual(
    [...seen],
    [CODE_RUN],
    `code-extension list is not consistent across gate hooks:\n  ${[...seen].join('\n  VS\n  ')}`
  );
});
