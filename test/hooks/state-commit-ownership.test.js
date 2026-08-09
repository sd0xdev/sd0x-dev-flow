'use strict';

// Cross-hook invariant: EVERY commit of a staged rewrite onto the review state file must prove
// lock ownership immediately before the rename, or declare itself an unlocked writer.
//
// `post-tool-review-state.test.js` already asserts this — for ONE hook, and with a commit pattern
// bound to the temp-variable names that hook happens to use (`$tmp` / `$_tmp`). Four hooks write
// this file. `post-compact-auto-loop.sh` staged into `$_srf_tmp` and checked ownership BEFORE the
// jq that produces the staged bytes rather than at the rename, and was invisible to that test on
// both counts: wrong file, and a temp name the regex could not match. It was the only such site
// among ~25, which is precisely the drift a per-file enumerated test cannot catch.
//
// The invariant is about ORDERING, not syntax. Ownership proven before a slow `jq` proves nothing
// at the moment that matters: stale recovery fires on age alone, so a contender can take the lock
// over during the jq, and the rename — a whole-FILE replace — then discards whatever the new owner
// committed. The check must be the last thing that happens before the `mv`.
//
// Two spellings satisfy that, and both appear deliberately in the tree:
//   (a) same line   — `_own_lock && mv "$tmp" "$STATE_FILE"`
//   (b) last conjunct of the enclosing `if` condition, with the `mv` as the first statement of the
//       then-block — `if jq … && [[ -s "$tmp" ]] && _own_lock; then` / `mv …`
// Nothing runs between the check and the rename in either.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { isComment, heredocBody } = require('../helpers/shell-structure');

const HOOKS_DIR = join(__dirname, '..', '..', 'hooks');

// A rename of a staged file onto the state file, under any temp-variable name.
const COMMIT = /\bmv\s+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"\s+"\$\{?(STATE_FILE|state_file)\}?"/;
// The closed set of named predicates that prove "this process may rename onto the state file". A
// commit guarded by anything else is unguarded as far as this test is concerned — adding a name here
// is the deliberate act of certifying what it checks.
const OWNERSHIP = /\b(_own_lock|_may_commit_state|_may_init_commit)\b/;

// Every commit site in every hook, with the context needed to judge it.
function collectCommits() {
  const out = [];
  for (const file of readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.sh')).sort()) {
    const lines = readFileSync(join(HOOKS_DIR, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isComment(line) || !COMMIT.test(line)) return;
      out.push({ file, line, lineNo: i + 1, index: i, lines });
    });
  }
  return out;
}

// Ownership proven with nothing in between: on the commit line itself, or as the tail of the
// nearest preceding CODE line when that line opens a then-block (the `mv` being its first
// statement). Deliberately narrow — a check two statements up would pass a "somewhere above"
// search while leaving the takeover window wide open.
function isGuarded({ line, index, lines }) {
  if (OWNERSHIP.test(line)) return true;
  let prev = index - 1;
  while (prev >= 0 && (isComment(lines[prev]) || lines[prev].trim() === '')) prev -= 1;
  if (prev < 0) return false;
  const cond = lines[prev];
  return /;\s*then\s*$/.test(cond) && OWNERSHIP.test(cond);
}

// Where a backward scan from `index` must stop: the enclosing function's declaration, or — when
// `index` is at FILE SCOPE — the `}` that closed the function above it. Without a bound the scan
// borrows a same-named assignment from an unrelated function and reports it as this commit's
// origin; stopping at the declaration alone is not enough, because for a file-scope line the
// nearest declaration is *above* a whole foreign body that then lies inside the bound.
function functionStart(lines, index) {
  const heredoc = heredocBody(lines);
  for (let i = index; i >= 0; i -= 1) {
    if (heredoc.has(i)) continue;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*\(\)\s*\{/.test(lines[i])) return i;
    if (i < index && /^\}/.test(lines[i])) return i;
  }
  return 0;
}

// An explicit `# UNLOCKED-WRITER:` declaration covering this commit — either in the enclosing
// function's doc block or in a comment above the commit inside that function. The escape hatch is
// real: `init_state_file` has one caller that reaches it with no lock, and two degraded branches run
// BECAUSE `_lock` failed, so an ownership check there would refuse every write.
//
// The declaration means "deliberate", NOT "audited and safe". Those unlocked commits are whole-file
// replaces and can still discard the lock holder's transaction — recorded, with the interleaving and
// the sites, in docs/features/auto-loop-evolution/requests/2026-08-04-degraded-writer-lost-update.md.
// This test cannot see that defect at all: it reads declarations, never concurrent commits.
function isDeclaredUnlocked({ index, lines }) {
  const bound = functionStart(lines, index);
  let start = bound;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\(\)\s*\{/.test(lines[bound] || '')) {
    // Include the contiguous comment block above the declaration — the function's doc block.
    let head = bound - 1;
    while (head >= 0 && isComment(lines[head])) head -= 1;
    start = head + 1;
  }
  return lines
    .slice(start, index)
    .some((l) => /^\s*#\s*UNLOCKED-WRITER:/.test(l));
}

test('every state-file commit proves lock ownership at the rename, or declares itself unlocked', () => {
  const commits = collectCommits();

  // Non-vacuity: if the commit shape drifts, this test must fail loudly rather than silently
  // examining nothing. Four hooks write the state file, and all four commit staged rewrites.
  assert.ok(commits.length >= 20, `expected the tree's commit sites, found ${commits.length} — has the commit shape changed?`);
  const files = new Set(commits.map((c) => c.file));
  assert.ok(files.size >= 3, `expected commits in at least 3 hooks, saw: ${[...files].join(', ')}`);

  const undeclared = [];
  for (const c of commits) {
    if (isGuarded(c)) continue;
    if (isDeclaredUnlocked(c)) continue;
    undeclared.push(`${c.file}:${c.lineNo}: ${c.line.trim()}`);
  }

  assert.deepEqual(
    undeclared,
    [],
    'these commits rename onto the state file without proving ownership immediately beforehand, ' +
      'and without an `# UNLOCKED-WRITER:` declaration. An ownership check that runs before the ' +
      'jq proves ownership at that earlier moment, not at this one:\n  ' + undeclared.join('\n  ')
  );
});

test('the unlocked-writer escape hatch is used sparingly and is not the majority', () => {
  // If every committer declared itself unlocked, the test above would pass while proving nothing.
  const commits = collectCommits();
  const declared = commits.filter((c) => !isGuarded(c) && isDeclaredUnlocked(c));
  const guarded = commits.filter((c) => isGuarded(c));

  assert.ok(declared.length >= 1, 'the escape hatch should have at least one real user (init/degraded paths)');
  assert.ok(
    guarded.length > declared.length * 2,
    `guarded commits (${guarded.length}) must dominate declared-unlocked ones (${declared.length})`
  );
});

// Shapes that change `$name` while carrying no `name=` on the line. Closed set — Bash has more
// (`eval`, indirect expansion via `${!ref}`) and regex cannot reach them, which is why the
// runtime guarantee is the staging PLACEMENT, not this walk: a temp inside `$LOCKDIR` is carried
// away by a takeover, so a lost race fails by rename semantics no matter how the variable was
// written. What this set buys is that the cheap, plausible bypasses stop being silent.
function variableMutationRe(name) {
  return new RegExp(
    `(^|[;&|\\s])${name}\\[[^\\]]*\\]=` + // indexed / associative element: tmp[0]=…
      `|(^|[;&|\\s])${name}\\+=` + // append: tmp+="/../evil" — reachable, and the cheapest of these
      `|(^|[;&|\\s])printf\\s+(-\\S+\\s+)*-v\\s+${name}\\b` + // printf -v tmp …
      `|(^|[;&|\\s])(read|mapfile|readarray)\\s+[^;&|]*(?<![$\\w{/])${name}\\b` + // read -r tmp
      `|(^|[;&|\\s])(for|select)\\s+${name}\\s*(;|$|\\s+in\\b)` + // loop variable: for tmp [in …]
      `|(^|[;&|\\s])(declare|local|typeset)\\s+(-\\S+\\s+)*-\\S*n\\S*\\s+${name}\\b` // nameref
  );
}

// Renames that are legitimately NOT state-file commits. Each entry is a destination this tree
// actually renames onto, and the list is the classifier's whole vocabulary: a rename matching
// neither `COMMIT` nor one of these is an offender. Adding a genuinely new destination means adding
// it here — deliberately, with a name — which is the point.
const NON_STATE_DESTINATIONS = [
  { why: 'stale-lock rename-aside', re: /\bmv\s+"\$\{?[A-Za-z0-9_]*LOCKDIR\}?"\s+"\$\{?_tomb\}?"/ },
  { why: 'sidecar event file', re: /\bmv\s+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"\s+"\$\{SIDECAR_EVENT_PREFIX\}\$\{stem\}"/ },
  { why: 'sidecar marker', re: /\bmv\s+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"\s+"\$\{?sidecar\}?"/ },
  {
    why: 'sidecar marker tombstone',
    re: /\bmv\s+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"\s+"\$\{?tomb\}?"/,
  },
  { why: 'nit ledger', re: /\bmv\s+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"\s+"\$\{?nit_file\}?"/ },
  { why: 'cooldown record', re: /\bmv\s+"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"\s+"\$\{?COOLDOWN_FILE\}?"/ },
];

test('every rename in the hook tree is classified, and state commits are a shape the other tests see', () => {
  // The floor under the other three. They all start from `COMMIT`, so a commit written in a shape
  // that regex does not match is not judged leniently — it is not judged at all, and the
  // non-vacuity counts stay comfortably above their thresholds while it slips through. `mv --
  // "$tmp" "$STATE_FILE"` is the one-character version of that.
  //
  // An earlier draft prefiltered to lines mentioning `$STATE_FILE` and asserted a `>= 20` floor.
  // Both halves were weak. The prefilter cannot see a destination alias — `target="$STATE_FILE"; mv
  // "$tmp" "$target"` mentions the state file on neither the `mv` line nor anywhere the filter
  // looks — and the floor only catches the inventory disappearing wholesale, never one site hiding.
  //
  // So enumerate EVERY `mv` in the tree and require each to classify: a state commit `COMMIT` can
  // see, or a named non-state destination. Unclassified fails. That is what makes the alias an
  // offender rather than an omission — `$target` is in no vocabulary, so it cannot be silent.
  //
  // Two known imprecisions, both failing CLOSED, which is why neither is worth another approximate
  // parser: a command split across lines leaves a `mv "$tmp" \` fragment that classifies as nothing,
  // and only whole-line comments are stripped, so an `mv "$a" "$b"` written inside a TRAILING comment
  // would be counted. Each costs a developer one spurious failure with the offending line named;
  // the alternative — a quote-aware stripper, since `#` inside a string is not a comment — is one
  // more approximation of Bash, which is the thing this test stopped doing.
  const unclassified = [];
  let commits = 0;
  let renames = 0;
  for (const file of readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.sh')).sort()) {
    const lines = readFileSync(join(HOOKS_DIR, file), 'utf8').split('\n');
    const heredoc = heredocBody(lines);
    lines.forEach((line, i) => {
      if (heredoc.has(i) || isComment(line) || !/(^|[^_A-Za-z0-9])mv\s/.test(line)) return;
      renames += 1;
      if (COMMIT.test(line)) {
        commits += 1;
        return;
      }
      if (NON_STATE_DESTINATIONS.some((d) => d.re.test(line))) return;
      unclassified.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  // Named destinations, for the message: a reader who has to add one needs to see the vocabulary.
  const vocabulary = NON_STATE_DESTINATIONS.map((d) => d.why).join(', ');

  assert.ok(commits >= 20, `expected the tree's state-file commits, found ${commits} of ${renames} renames`);
  assert.deepEqual(
    unclassified,
    [],
    'these renames match neither `COMMIT` nor any named non-state destination. If one commits the ' +
      'state file, every ownership and placement assertion in this file silently skips it; if it is ' +
      `a new legitimate destination, name it in NON_STATE_DESTINATIONS (currently: ${vocabulary}):\n  ` +
      unclassified.join('\n  ')
  );
});

test('heredoc detection covers real heredocs and never opens on a here-string', () => {
  // The `<<<` cases are the reason this test exists. An unanchored `<<` re-matches at the SECOND
  // `<` of a here-string, so one `grep -q x <<< 'EOF'` anywhere near the top of a hook opens a
  // phantom heredoc that runs to the next standalone `EOF` — silently deleting that whole span
  // from the rename inventory and the origin walk, which then pass because they see nothing.
  const body = (src) => heredocBody(src.split('\n'));

  const real = ['cat > "$tmp" << EOF', '{ "a": 1 }', '}', 'EOF', 'mv "$tmp" "$STATE_FILE"'];
  assert.deepEqual([...body(real.join('\n'))].sort((a, b) => a - b), [1, 2],
    'the JSON body is excluded; the opener, terminator and the commit below are not');

  assert.deepEqual([...body(['cat <<-\tEOF', '\tindented', '\tEOF', 'x=1'].join('\n'))], [1],
    '<<- strips leading tabs when matching the terminator');
  assert.deepEqual([...body(["cat << 'EOF'", 'raw $notexpanded', 'EOF'].join('\n'))], [1],
    'a quoted delimiter still opens a heredoc');

  for (const hs of ["grep -q x <<< 'EOF'", 'grep -q x <<<"EOF"', 'grep -q x <<<EOF', 'n=$(( x << 2 ))']) {
    assert.equal(body([hs, 'mv "$tmp" "$STATE_FILE"', 'more code'].join('\n')).size, 0,
      `must not open a heredoc: ${hs}`);
  }

  assert.throws(() => body(['cat << EOF', 'never terminated', 'x=1'].join('\n')),
    /unterminated heredoc/, 'an unterminated heredoc fails loudly rather than swallowing the file');
});

test('the origin walk stops on variable mutations that carry no `name=`', () => {
  // Both directions in one case, because a one-directional guard is green the day it lands and
  // false-positives later. The negatives are the load-bearing half: every one mentions `tmp` the
  // way ordinary hook code does, and `read -r line < "$tmp"` is the exact shape that made the
  // first draft of this regex flag a read FROM the temp as a write TO the variable.
  const mustDetect = [
    '    tmp[0]="$(_foreign_temp)"',
    '    printf -v tmp "%s" "$(_foreign_temp)"',
    '    read -r tmp < /dev/null',
    '    mapfile -t tmp < "$src"',
    '    for tmp in "${TMPDIR:-/tmp}/evil.json"; do :; done',
    '    select tmp in a b; do break; done',
    '    for tmp; do :; done',
    '    tmp+="/../../evil.json"',
    '    local -n tmp=other',
    '    declare -n tmp=other',
  ];
  const mustIgnore = [
    '    rm -f "$tmp" 2>/dev/null || true',
    '    read -r line < "$tmp"',
    '    local tmp',
    '    jq . "$STATE_FILE" > "$tmp" 2>/dev/null',
    "    printf '%s' \"$tmp\"",
    '    if ! tmp=$(_lock_staging_file); then',
    '    for f in "$tmp" "$other"; do :; done',
    '    for tmpdir in /a /b; do :; done',
    '    read -r val < /tmp/foo',
    '    mapfile -t out < "${TMPDIR:-/tmp}/x"',
    '    dtmp+="x"',
  ];
  for (const line of mustDetect) {
    assert.ok(variableMutationRe('tmp').test(line), `should stop the walk: ${line.trim()}`);
  }
  for (const line of mustIgnore) {
    assert.ok(!variableMutationRe('tmp').test(line), `must not be read as a mutation: ${line.trim()}`);
  }
});

test('a state rewrite is staged INSIDE the lock directory, never beside the state file', () => {
  // The ownership check above is necessary and NOT sufficient: it can pass and the process be
  // descheduled before the rename. Placement closes that, because it makes the commit fail by
  // rename semantics rather than by a check that can go stale — a takeover renames `$LOCKDIR`
  // aside and carries any temp inside it away, so the displaced owner has nothing left to commit.
  //
  // Why the scan is anchored on the COMMIT rather than on `mktemp`, the sibling-staging regression
  // that motivated it, the two bypass classes closed here, and the scope of the whole guard:
  // docs/features/auto-loop-autonomy/4-implementation.md §1.2, and §1.3 for why the allowlist has a
  // caller-dependent third entry rather than the two it started with.
  //
  // Local to the two constants below: `$LOCKDIR` EXACTLY, not any name ending in LOCKDIR —
  // `${OTHER_LOCKDIR}/state.XXXXXX` is not carried away by a takeover of the STATE lock, so it
  // gives none of the guarantee. Commits onto `$STATE_FILE` are the only plane collected here; the
  // sidecar plane commits onto its own target and stages under `$SIDECAR_LOCKDIR`.
  const STAGING_HELPERS = new Set(['_lock_staging_file', '_state_staging_file', '_init_staging_file']);
  const underLock = (t) => /^\$\{?LOCKDIR\}?\//.test(t);

  const offenders = [];
  let resolved = 0;
  for (const c of collectCommits()) {
    const name = c.line.match(/\bmv\s+"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"/)[1];
    // Nearest preceding assignment of that variable, in the same file: either a direct `mktemp`
    // or a call to a staging helper.
    let src = null;
    let shadowed = null;
    const bound = functionStart(c.lines, c.index);
    const heredoc = heredocBody(c.lines);
    for (let i = c.index; i >= bound; i -= 1) {
      if (heredoc.has(i) || isComment(c.lines[i])) continue;
      // ANY assignment to the committed variable stops the walk. Matching only the two shapes this
      // test understands and skipping the rest is fail-OPEN: a later `tmp="$(_foreign_temp)"` is
      // invisible to the narrow patterns, so the walk sailed past it and credited the commit to an
      // earlier, safe `tmp=$(_lock_staging_file)`.
      // …and so is stopping only on `name=`. Bash changes a variable through several shapes that
      // carry no `name=` at all, and `tmp[0]="$(_foreign_temp)"` is the cheapest: it makes `$tmp`
      // read as the new value while the walk sails past to an earlier safe assignment. This is the
      // closed set of those shapes; anything matching it and not parseable as a known origin below
      // becomes an offender, so a form outside the set fails the NEXT assertion rather than
      // exempting its commit. Regex cannot model all of Bash — `eval` and indirect expansion stay
      // outside it — which is why placement, not this walk, is the runtime guarantee (see above).
      if (!new RegExp(`(^|[;&|\\s])${name}=`).test(c.lines[i]) && !variableMutationRe(name).test(c.lines[i])) continue;
      const a = c.lines[i].match(
        new RegExp(`\\b${name}=\\$\\(\\s*mktemp\\s*([^)]*)\\)|\\b${name}=\\$\\(\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\)`)
      );
      if (a) { src = { arg: (a[1] || '').trim(), helper: a[2] || null, at: i }; }
      else { shadowed = `${c.file}:${i + 1}: ${c.lines[i].trim()}`; }
      break;
    }
    if (shadowed) {
      offenders.push(`${c.file}:${c.lineNo} — commits $${name}, last assigned by an unresolvable form at ${shadowed}`);
      continue;
    }
    if (!src) {
      if (isDeclaredUnlocked({ index: c.index, lines: c.lines })) continue;
      offenders.push(`${c.file}:${c.lineNo} — commits $${name}, origin unresolvable (fail closed)`);
      continue;
    }
    resolved += 1;
    if (src.helper) {
      // Judged at the helper's own definition below — but only if it IS one of the staging
      // helpers. Any other function is an unaudited origin.
      if (!STAGING_HELPERS.has(src.helper)) {
        offenders.push(`${c.file}:${c.lineNo} — commits $${name} from unaudited helper ${src.helper}()`);
      }
      continue;
    }
    // The first quoted word is the template; everything after it is redirection noise.
    const q = src.arg.match(/"([^"]*)"/);
    const tmpl = q ? q[1] : '';
    if (underLock(tmpl)) continue;
    if (isDeclaredUnlocked({ index: src.at, lines: c.lines })) continue;
    offenders.push(`${c.file}:${c.lineNo} — commits $${name}, staged at ${tmpl || '(no template — $TMPDIR)'}`);
  }

  // The staging helpers themselves: their `mktemp` is one indirection from the commit, so the walk
  // above stops at the call and never sees the template. Enumerated from the allowlist rather than
  // by name pattern, so adding a helper without adding it here fails the non-vacuity check.
  let helperSites = 0;
  for (const file of readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.sh')).sort()) {
    const lines = readFileSync(join(HOOKS_DIR, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const decl = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/);
      if (isComment(line) || !decl || !STAGING_HELPERS.has(decl[1])) return;
      for (let j = i + 1; j < lines.length && !/^\}/.test(lines[j]); j += 1) {
        const m = lines[j].match(/\bmktemp\s+"([^"]*)"/);
        if (!m || isComment(lines[j])) continue;
        helperSites += 1;
        if (underLock(m[1])) continue;
        if (isDeclaredUnlocked({ index: j, lines })) continue;
        offenders.push(`${file}:${j + 1} — ${decl[1]}() stages at ${m[1]}, not under $LOCKDIR`);
      }
    });
  }

  // Non-vacuity, both halves: if the commit or assignment shape drifts the walk resolves nothing
  // and this test would report success while examining an empty set.
  assert.ok(resolved >= 3, `expected resolvable staging assignments, found ${resolved} — has the assignment shape changed?`);
  assert.ok(helperSites >= 2, `expected the staging helpers' mktemp sites, found ${helperSites} — have they been renamed?`);
  assert.deepEqual(
    offenders,
    [],
    'a temp staged beside the state file survives a lock takeover and can overwrite the new ' +
      "owner's committed state. Stage under $LOCKDIR (see `_lock_staging_file`):\n  " +
      offenders.join('\n  ')
  );
});

test('ownership is checked AFTER the staging jq, never only before it', () => {
  // The specific ordering bug, pinned directly. Walking forward from an ownership check to the
  // `mv` it is supposed to protect, no command may intervene — a `jq`/`mktemp`/`wc` between them
  // is the takeover window. Reported per site so a regression names its own file and line.
  const offenders = [];
  for (const c of collectCommits()) {
    if (!isGuarded(c)) continue; // unguarded/declared sites are the other test's business
    if (OWNERSHIP.test(c.line)) continue; // same-line form has no gap by construction
    // Form (b): the check is on the `if` line directly above. Confirm the mv really is the first
    // statement of that then-block, i.e. only comments/blanks sit between them.
    const between = [];
    for (let i = c.index - 1; i >= 0; i -= 1) {
      if (OWNERSHIP.test(c.lines[i])) break;
      if (!isComment(c.lines[i]) && c.lines[i].trim() !== '') between.push(c.lines[i].trim());
    }
    const intervening = between.filter((l) => !/;\s*then$/.test(l));
    if (intervening.length > 0) {
      offenders.push(`${c.file}:${c.lineNo} — between the ownership check and the mv: ${intervening.join(' | ')}`);
    }
  }
  assert.deepEqual(offenders, [], `ownership must be the last thing before the rename:\n  ${offenders.join('\n  ')}`);
});
