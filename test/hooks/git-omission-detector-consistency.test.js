const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const ROOT = resolve(__dirname, '../..');

// === git-omission-detector parity: hooks MUST mirror run-verify.js's catch-all ===
//
// `git status -uall` exits 0 even when it could not open an unreadable subtree: it WARNS on
// stderr and OMITS that subtree, so an empty porcelain listing is NOT proof of a clean tree.
// run-verify.js (the fanout verifier) and six gate-hook sites each grep that warning to fail
// CLOSED. run-verify.js carries a `warning:[^']*open directory` STEM catch-all on top of the two
// literal `could not|cannot open directory` phrasings (so a future git rewording that keeps the
// phrase "open directory" but changes the verb — e.g. `failed to` — is still caught); the hooks
// must carry the SAME catch-all or they drift OPEN relative to the verifier. This guards that
// parity: drop the catch-all from any one site and this test fails.

// Only the literal-verb half — what the catch-all is layered ON TOP OF. Used to prove the
// catch-all is load-bearing (it matches a phrasing the literals miss), not decorative.
const LITERAL_ONLY_ERE = '(could not|cannot|unable to) open directory';
// The catch-all as it appears in HOOK source: single-quoted bash, so the lone `'` in `[^']`
// is emitted via the '...'\''...' idiom → the raw bytes are `warning:[^'\'']*open directory`.
const HOOK_CATCHALL_TOKEN = "warning:[^'\\'']*open directory";
// The catch-all as it appears in run-verify.js source: a JS regex literal, no shell escaping.
const JS_CATCHALL_TOKEN = "warning:[^']*open directory";

// Each hook that treats a directory-omission warning as UNAVAILABLE, and how many detection
// sites it carries (stop-guard detects at the corrupt-state probe, the WB5c
// derivation-unavailable git probe, and the recon site).
const HOOK_SITES = [
  ['post-compact-auto-loop.sh', 1],
  ['post-skill-auto-loop.sh', 1],
  ['user-prompt-review-guard.sh', 1],
  ['session-init.sh', 1],
  ['stop-guard.sh', 3],
];
const TOTAL_HOOK_SITES = HOOK_SITES.reduce((n, [, c]) => n + c, 0); // 7

function countOccurrences(haystack, needle) {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

for (const [hook, sites] of HOOK_SITES) {
  test(`${hook}: every git-omission grep carries the catch-all stem (no fail-open drift)`, () => {
    const src = readFileSync(join(ROOT, 'hooks', hook), 'utf8');
    const literalSites = countOccurrences(src, "(could not|cannot|unable to) open directory");
    const catchAllSites = countOccurrences(src, HOOK_CATCHALL_TOKEN);
    assert.equal(
      literalSites,
      sites,
      `${hook}: expected ${sites} open-directory detection site(s), found ${literalSites}`
    );
    // Every literal-verb detection site must ALSO carry the catch-all — else it drifts open
    // relative to run-verify.js. (In source, each catch-all sits in the same grep as a literal.)
    assert.equal(
      catchAllSites,
      literalSites,
      `${hook}: ${literalSites - catchAllSites} detection site(s) MISSING the '${HOOK_CATCHALL_TOKEN}' catch-all — drifted OPEN vs run-verify.js`
    );
  });
}

test('all gate hooks + run-verify.js share the same open-directory catch-all', () => {
  let hookTotal = 0;
  for (const [hook] of HOOK_SITES) {
    const src = readFileSync(join(ROOT, 'hooks', hook), 'utf8');
    hookTotal += countOccurrences(src, HOOK_CATCHALL_TOKEN);
  }
  assert.equal(hookTotal, TOTAL_HOOK_SITES, `expected ${TOTAL_HOOK_SITES} hook catch-all sites, found ${hookTotal}`);
  const rv = readFileSync(join(ROOT, 'skills/orchestrate/scripts/run-verify.js'), 'utf8');
  assert.ok(
    rv.includes(JS_CATCHALL_TOKEN),
    'run-verify.js must carry the same warning:[^\']*open directory catch-all the hooks mirror'
  );
});

test('tree-digest.js carries the literal + catch-all pair at BOTH status readers (WB4 digest reader)', () => {
  // The check-time derivation reads the tree through readStatus, and each
  // gitlink runs its own nested status; a warn-and-omit read at either site is
  // the same fail-open class the hook sites close, so the detector must not
  // drift relative to them — at either site.
  const td = readFileSync(join(ROOT, 'scripts/lib/tree-digest.js'), 'utf8');
  const literalSites = countOccurrences(td, LITERAL_ONLY_ERE);
  const catchAllSites = countOccurrences(td, JS_CATCHALL_TOKEN);
  assert.equal(
    literalSites,
    2,
    'tree-digest.js must carry two literal-verb omission detection sites (readStatus + gitlink nested status)'
  );
  assert.equal(
    catchAllSites,
    literalSites,
    `tree-digest.js: ${literalSites - catchAllSites} detection site(s) missing the catch-all stem`
  );
});

// Extract the omission ERE from a HOOK's source and undo the bash single-quote escaping, so the
// behavioural assertions below exercise the pattern production actually greps with. The previous
// version tested the OMISSION_ERE constant defined at the top of THIS file, which made the
// "load-bearing" claim unfalsifiable: it passed unchanged in a run where the catch-all had been
// stripped out of the hook entirely. Throwing on a failed extraction keeps that failure loud
// rather than silently degrading to a weaker assertion.
function hookOmissionEre(hook) {
  const src = readFileSync(join(ROOT, 'hooks', hook), 'utf8');
  const m = src.match(/grep -qiE '((?:[^']|'\\'')*open directory(?:[^']|'\\'')*)'/);
  if (!m) throw new Error(`could not extract the omission ERE from hooks/${hook}`);
  // bash '...'\''...' → a literal single quote.
  return m[1].replace(/'\\''/g, "'");
}

test('the catch-all is load-bearing: it matches a verb the literals miss, without false-firing', () => {
  const matches = (ere, line) => spawnSync('grep', ['-qiE', ere], { input: line }).status === 0;
  // Derived from production, not from this file's constants — see hookOmissionEre.
  const OMISSION_ERE = hookOmissionEre('session-init.sh');
  // A future/variant git phrasing that keeps "open directory" but changes the verb.
  const variant = "warning: failed to open directory 'locked/': Permission denied\n";
  assert.equal(matches(OMISSION_ERE, variant), true, 'full pattern must catch a non-literal "failed to" verb');
  assert.equal(
    matches(LITERAL_ONLY_ERE, variant),
    false,
    'literal-only half must MISS "failed to" — otherwise the catch-all would be tautological'
  );
  // The literal phrasings git actually emits stay covered.
  assert.equal(
    matches(OMISSION_ERE, "warning: could not open directory 'locked/'\n"),
    true,
    'real git wording ("could not open directory") must still match'
  );
  // The [^'] stem must not let a QUOTED path that happens to contain "open directory" false-fire.
  assert.equal(
    matches(OMISSION_ERE, "warning: could not stat 'a/open directory/f'\n"),
    false,
    'a quoted path containing "open directory" must NOT false-fire (stem is pre-quote)'
  );
});
