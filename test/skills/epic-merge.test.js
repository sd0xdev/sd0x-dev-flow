const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/epic-merge/SKILL.md');

function readSkill() {
  assert.ok(existsSync(skillPath), `skills/epic-merge/SKILL.md does not exist at ${skillPath}`);
  return readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
}

// ── Protected head branches: the prohibited force-push target ─────────────────
// /epic-merge force-pushes every PR head (Step 5) and the rollback path pushes
// the same ref. A PR head is not inherently unprotected — a PR can be opened
// FROM main — so "only pushes to PR head branches" was never a safety argument
// on its own. git-workflow.md § Prohibited forbids force push to shared branches,
// and the protected set is the decidable part of the shared set (skills/push-ci/SKILL.md
// Phase 0 step 0 states the judgment and its residue). The
// refusal lives in three places: the Phase 0 validation gate, and an exact-match
// guard re-asserted immediately before the Step 5 push and the rollback push.
// The guards are executable text, so they are extracted and run — a reworded or
// inverted case pattern stays green under a text match and fails here. Both
// directions ship together (rules/testing.md § Guards): the heads that must be
// refused, and same-word heads that must still pass.

// **Token ownership cannot be decided by a regex over the raw line.** The separator check below
// asks "is `--` the last argument of *this* `git log`", and a scan that stops at the first `)`
// or `|` answers about the wrong command: `git log --oneline "pkg" "$(printf pkg --)"` has its
// `--` inside a nested substitution, and cutting there made the line look separated when git in
// fact reads both arguments as paths and returns plausible history with exit 0. The same
// regex rejected a legitimate quoted `)` or `|`. Both directions come from one missing property —
// quoting — so this walks the string once, tracking quotes and substitution depth, and treats a
// metacharacter as a terminator only when it is unquoted and at depth 0.
function shellTokens(text) {
  const tokens = [];
  let cur = '';
  let quote = null; // "'" | '"' | null
  let depth = 0;
  const flush = () => { if (cur !== '') { tokens.push(cur); cur = ''; } };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '\\') { cur += ch + (text[i + 1] ?? ''); i += 1; continue; }
    if (ch === '$' && text[i + 1] === '(') { depth += 1; cur += '$('; i += 1; continue; }
    if (ch === '`') { cur += ch; continue; }
    // A `<…>` placeholder is documentation, not a redirect. These fences are written for a
    // reader as much as a shell (`-<N+5>`, `backup/pr-<prev>`), and treating the `<` as a
    // redirect truncated the command before its separator — reporting a correctly separated
    // line as unseparated. Recognised only when the `>` closes with no whitespace between,
    // so a real `< file` or `> file` redirect still ends the command.
    if (ch === '<') {
      const close = text.indexOf('>', i + 1);
      const inner = close === -1 ? null : text.slice(i + 1, close);
      if (inner !== null && inner !== '' && !/\s/.test(inner)) {
        cur += text.slice(i, close + 1);
        i = close;
        continue;
      }
    }
    if (ch === ')') {
      if (depth > 0) { depth -= 1; cur += ch; continue; }
      break; // closes a substitution opened before this command — the command ends here
    }
    if (depth === 0 && (ch === '|' || ch === ';' || ch === '&' || ch === '#' || ch === '>' || ch === '<')) break;
    if (depth === 0 && /\s/.test(ch)) { flush(); continue; }
    cur += ch;
  }
  flush();
  return tokens;
}

// **A token is not yet a word, and the flag checks compare words.** `shellTokens` keeps quote
// characters so the separator check can see the argument exactly as written, but the shell strips
// them before git ever sees the argument — so `"--force"` and `--force` are the same flag to git
// and two different strings to a `Set.has`. Measured against a real remote: both
// `git push "--force" origin main` and `git push -uf origin main` performed a **forced update
// with exit 0** and destroyed the remote history, while the token-set control returned `[]` for
// each. That is the exact failure class this control exists to catch, evading it twice.
//
// One normalization, therefore, where flags are compared:
//   **Unquote** — remove the quoting, keep the characters, so `--fo"rce"` reads as one word.
// **And the comparison is against git's option parser, not against exact spellings.** A further
// measured evasion of the exact-token form: **abbreviation.** git accepts any *unambiguous* prefix
// of a long option, so `--no-force-i` and `--no-force-w` reach the remote while a `Set.has` on the
// full spelling sees neither. `--force` itself has no abbreviation hole — `--forc` is refused as
// `ambiguous option` because the two lease options share the prefix — but the `--no-` forms are
// unique early. So the option table below is git push's own (from `git push -h`, git 2.55.0) and
// abbreviations are resolved against it.
//
// **Short-flag clusters are refused, not modelled — the model was wrong three rounds running.**
// It began as "split `-uf` into `-u -f`", which reported a bare force on `-of` (`-o` is
// `--push-option`, so `f` is its value); the fix — stop at the first value-taking letter — then
// misplaced git's argument separator, because `-vo` ends in a value-taking letter and therefore
// eats the **next** argument: measured, `git push -vo -- --dry-run . -- refs/heads/main:…`
// selected `.` as the remote and reached receive-pack, proving the first `--` was consumed as the
// `-o` value. A model that has produced a defect on each of its three outings is not worth a
// fourth. A cluster on a push command line is now reported as undecidable — a refusal, which is
// what `-uf` earned anyway, and the direction that cannot be wrong. Neither skill's pushes use
// one; the cost is that a legitimate `-uq` would be rejected until someone spells it `-u -q`.
const PUSH_LONG_OPTIONS = [
  'verbose', 'quiet', 'repo', 'all', 'branches', 'mirror', 'delete', 'tags', 'dry-run',
  'porcelain', 'force', 'force-with-lease', 'force-if-includes', 'recurse-submodules', 'thin',
  'receive-pack', 'exec', 'set-upstream', 'progress', 'prune', 'follow-tags', 'signed', 'atomic',
  'push-option',
].flatMap((name) => [`--${name}`, `--no-${name}`]).concat(['--no-verify']);
const SHORT_CLUSTER = /^-[A-Za-z]{2,}$/;

// `--opt=value` names the option `--opt`; `--force-with-lease=<ref>:<sha>` is still the lease flag.
function resolveLongOption(word) {
  const name = word.includes('=') ? word.slice(0, word.indexOf('=')) : word;
  if (PUSH_LONG_OPTIONS.includes(name)) return name; // an exact match wins over any prefix
  const candidates = PUSH_LONG_OPTIONS.filter((opt) => opt.startsWith(name));
  return candidates.length === 1 ? candidates[0] : name; // ambiguous → git refuses it anyway
}

function unquoteWord(token) {
  let out = '';
  let quote = null;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (quote) { if (ch === quote) { quote = null; continue; } out += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '\\') { out += token[i + 1] ?? ''; i += 1; continue; }
    out += ch;
  }
  return out;
}

function flagTokens(text) {
  return shellTokens(text).map((raw) => {
    const word = unquoteWord(raw);
    return word.startsWith('--') && word.length > 2 ? resolveLongOption(word) : word;
  });
}

// **One line can carry more than one command, and `indexOf` reports the first.** Measured:
// `echo git log --; git log "$rev" --oneline` passed the separator check because the *textual*
// first mention ends in `--`, while the executable second one has no separator and was never
// looked at; `echo git push --force-with-lease …; git push -f …` hid a bare force the same way.
// So every occurrence is returned and every occurrence is validated — a mention that is only
// prose inside a fence is validated too, which is the conservative direction.
function occurrencesAfter(line, name) {
  const rests = [];
  let from = 0;
  for (;;) {
    const at = line.indexOf(name, from);
    if (at === -1) return rests;
    rests.push(line.slice(at + name.length));
    from = at + name.length;
  }
}

// The option region is everything before git's `--` separator. An expansion there can produce a
// real option that no amount of reading the source text will reveal: measured, a recording `git`
// received `--force` from `"$(printf -- --force)"` while the token control reported nothing. The
// scan cannot evaluate it, so it says so. A legitimate `--force-with-lease="$ref"` would be
// rejected too — no such line exists here, and a failing assertion is the safe direction.
// **And the separator is the first `--` git *reads* as one, not the first token spelled `--`.**
// An option that takes a separate value consumes the next argument whatever it looks like:
// measured with `GIT_TRACE=1`, `git push … -o -- "$(printf -- --force)" …` passed `-o --` and then
// `--force` as a real option, so a model that stopped at the spelled `--` declared the region
// clean and the substitution invisible. `git push --exec -- --force no-such` likewise ran
// receive-pack program `--`. So value-taking options skip their value before the search continues.
// Read off `git push -h` (git 2.55.0), and it is the **separate**-value forms only. `<value>` and
// `(a|b|c)` take the next argument; `[=<value>]` does not — `--force-with-lease[=<refname>:<expect>]`
// and `--signed[=(yes|no|if-asked)]` accept an inline value or none, so neither consumes what
// follows. Polarity matters too, and measured: `git push --recurse-submodules check …` exits 0 while
// `git push --no-recurse-submodules check …` exits 128, having read `check` as a refspec — so only
// the positive form belongs here.
const LONG_TAKING_VALUE = new Set([
  '--push-option', '--exec', '--receive-pack', '--repo', '--recurse-submodules',
]);

// Reports every token in the option region the scan cannot decide: an expansion (which can produce
// any flag) and a short-flag cluster (whose value-consumption moves the separator this walk is
// looking for — see the cluster note above). Clusters are reported *before* the walk can be misled
// by one, so a `-vo` that eats git's `--` is refused rather than silently misread.
// The option region as git reads it: every word before git's own `--`, with the arguments that are
// **option values** removed. `flagTokens` cannot answer this — it maps tokens one-for-one, so
// `-o --force-if-includes` yields both strings and a membership test reports a safety flag that is
// really push-option data.
function optionWords(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const word = unquoteWord(tokens[i]);
    if (word === '--') break;
    const name = word.includes('=') ? word.slice(0, word.indexOf('=')) : word;
    out.push(word.startsWith('--') && word.length > 2 ? resolveLongOption(word) : word);
    if (!word.includes('=') && (LONG_TAKING_VALUE.has(resolveLongOption(name)) || word === '-o')) i += 1;
  }
  return out;
}

// Round 60 makes one shape decidable, and only one: `--<opt>="…"`, where the option name is
// textually fixed ahead of the `=` and the ENTIRE value is a single double-quoted string. Inside
// double quotes bash performs no word splitting and no globbing, so however the expansion resolves
// the result is still exactly one word beginning `--<opt>=` — it cannot become a different option,
// which is the only thing this scan is deciding. The note above (`--force-with-lease="$ref"` would
// be rejected, no such line exists) was written when none did; round 60's iteration push binds its
// lease to the tip Step 5 measured, so the line exists now and refusing it would refuse the fix.
// Everything else keeps refusing: an unquoted `--opt=$v` can split, and a bare `"$(…)"` token is
// a whole word the expansion chooses.
const OPTION_WITH_QUOTED_VALUE = /^--[A-Za-z][-A-Za-z0-9]*="[^"]*"$/;

function optionRegionUndecidables(tokens) {
  const region = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const word = unquoteWord(tokens[i]);
    if (word === '--') break; // git's separator, reached without being consumed as a value
    region.push(tokens[i]);
    const name = word.includes('=') ? word.slice(0, word.indexOf('=')) : word;
    const takesSeparateValue = !word.includes('=')
      && (LONG_TAKING_VALUE.has(resolveLongOption(name)) || word === '-o');
    if (takesSeparateValue && i + 1 < tokens.length) { region.push(tokens[i + 1]); i += 1; }
  }
  return region.filter((t) => (/[$`]/.test(t) && !OPTION_WITH_QUOTED_VALUE.test(t))
    || SHORT_CLUSTER.test(unquoteWord(t)));
}

// **Command lines are pinned, not parsed — and this is the fifth answer to the same question.**
// Four consecutive review rounds found the same class of defect in the scanner that used to live
// here: it walked CommonMark containers and shell syntax to decide "is this line a push", and each
// round produced a shape it silently scored as zero — a `~~~` fence, a fence nested in a list
// inside a quote, `git \` continued onto the next line, `git${IFS}push`, `git  push`, `"git" push`,
// `env "$cmd" push`, `if "$cmd" push`, `git "$sub"`, `git $'push'`. Every one of them left the
// asserted count at two and every downstream control inspecting the wrong two lines.
//
// `skills/push-ci/SKILL.md`'s test retired its own version of this scanner in round 16 for the
// mirror-image reason — it false-positived an honest print-only example — and replaced it with a
// byte pin plus the whole-file digest. That is the answer here too. A **document is a fixed
// artifact**: what its push commands are is a question with two exact string answers, and any
// third push, however it is spelled, moves the digest. "Only the generic digest notices" is the
// point, not a gap: the digest is a review trigger, and a reader looking at that diff sees the
// push immediately, where a scanner that must anticipate every syntax sees it only if someone
// thought of that syntax first.
//
// Two textual conditions pick the executable lines out, and neither can be subtly wrong because
// the pin below states the whole answer they must produce: the line contains the command, it is
// not a code span (prose and table rows write commands inside backticks), and it is not a recorded
// terminal transcript (those begin with `$ `). Verified against the document: 2 pushes, 5 logs, no
// false positive and no miss.
const commandLines = (text, name) => text.split('\n')
  .filter((l) => l.includes(name) && !l.includes('`') && !/^\s*\$ /.test(l));

// Round 39: every git command in the skill carries this prefix, because a bare `env` is shadowed
// by an imported `BASH_FUNC_env%%` function and a bare `git` runs against whatever repository the
// ambient GIT_DIR names. It is pinned once, here, and asserted on every command below — the pins
// that are about git's ARGUMENTS strip it first, so they stay readable and keep guarding what they
// were written to guard. Stripping never hides an absence: § "every git command carries the
// canonical prefix" owns that direction and fails on its own.
// Round 40: this helper shipped round 39 with its replacement corrupted to a fragment of the NEXT
// line — a `$&` written inside a generating template literal was eaten as an interpolation, and it
// swallowed the newline with it. Nothing went red, because the string it escapes happens to contain
// no regex metacharacter, so the helper was dead rather than wrong. Reported as a Nit and escalated:
// what it escapes is the byte-for-byte presence of the canonical push command, so a dead escaper is
// a dead authorization guard the day the prefix gains a `.` or a `(`. The controls below are the
// point — they exercise metacharacters the live input does not, which is what "dead" means here.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GIT_PREFIX = "/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT ";
const stripGitPrefix = (l) => l.split(GIT_PREFIX).join('');

const pushCommandLines = (text) => commandLines(text, 'git push');
const logCommandLines = (text) => commandLines(text, 'git log').map(stripGitPrefix);

// The pins. The two pushes are NOT byte-identical, and this comment said they were until round
// 73 — the fourth copy of a claim round 72 corrected in three other places and reported as
// finished. What they share is the refspec: an object ID on the left, under the same name, so
// neither publishes something later than what it classified. The lease is where they differ,
// and the derivation below is what keeps that difference to exactly one byte range.
const CANONICAL_PUSH = "/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT ALLOW_PUSH_PROTECTED= ALLOW_FORCE_UNSHARED= SD0X_PUSH_DEST_DIGEST=\"$PUSH_URLS_DIGEST\" GIT_GRAFT_FILE=/dev/null GIT_NO_REPLACE_OBJECTS=1 ALLOW_FORCE_WITH_LEASE=1 git push --force-with-lease=\"refs/heads/${head}:${RB_TIP}\" --receive-pack=git-receive-pack \"origin\" -- \"${PUSHED}:refs/heads/${head}\"";
// Round 49 is why the pair is derived from one literal rather than written twice. Selecting the lease
// through a variable — `git push "$LEASE"` — was tried and reverted: it reads as an ordinary push
// to everything that scans this document, so the three tests below that classify what this skill
// executes all went green on a line whose force flag had left the call site.
// Round 60 split them, and the derivation is the point: the two lines are still provably identical
// everywhere except the lease, so every property below is asserted on both and only the one byte
// range that legitimately differs can differ. Round 75 narrowed that range to a variable NAME.
// Step 2 checks the remote tip out, which puts it in the local reflog and satisfies
// `--force-if-includes` by construction — measured, the flag certifies nothing on that path — so
// the iteration push binds its lease to the tip Step 5 measured itself. The rollback fence was
// read as the one path where the pair was still live; that reading was wrong for the same reason
// one level over — `git switch -C` writes the branch's previous OID into the very reflog the flag
// certifies against — so round 75 put it on the bound shape too, each fence naming the tip it
// measured for itself.
const CANONICAL_ITERATION_PUSH = CANONICAL_PUSH.replace(
  'git push --force-with-lease="refs/heads/${head}:${RB_TIP}" ',
  'git push --force-with-lease="refs/heads/${head}:${FINAL_TIP}" ',
);
const CANONICAL_PUSHES = [CANONICAL_ITERATION_PUSH, CANONICAL_PUSH];
// Fully qualified `refs/remotes/origin/…`, never the `origin/<name>` shorthand. git resolves
// `refs/tags/<name>` ahead of `refs/remotes/<name>`, and a tag named `origin/feat/a` is a legal
// ref (`git check-ref-format refs/tags/origin/feat/a` exits 0). Measured: with one present,
// `git rev-parse origin/feat/a` warns "refname is ambiguous" and prints the TAG's commit while
// `refs/remotes/origin/feat/a` prints the branch's. The warning goes to stderr and exit stays 0,
// so a shorthand range is silently the wrong range — and the counts, backup tags and rebase
// destinations built from it are wrong with it. Pinned as an equality so a reintroduced
// shorthand names itself in the diff rather than being scanned for.
const CANONICAL_LOGS = [
  'range=$(git log "refs/remotes/origin/$base..refs/remotes/origin/$head" --oneline --) || {',
  // Manifests live under `$(git rev-parse --git-path epic-merge)`, never the worktree: at the
  // repo root they are untracked, so `git status --porcelain` lists them and the rollback's
  // clean-tree guard refuses — making the recovery path unreachable in every run that writes one.
  // Round 63 appended the recording guard: the loop's exit status is its last iteration's, so a
  // manifest that failed for PR 1 and succeeded for PR 2 reported success. The pinned line grew a
  // tail; the separator property is unchanged, because the redirect already ends the command.
  '  git log "refs/remotes/origin/${base}..refs/remotes/origin/${head}" --pretty=format:\'%s\' -- > "${MANIFEST_DIR}/expected-pr-${pr}.manifest" || { echo "⛔ PR ${pr}: expected manifest not written — Step 4 would compare against nothing" >&2; PHASE1_OK=; break; }',
  // Round 60 wrapped this one in `if ! …; then`: its exit status decides whether a comparison is
  // possible at all, and a manifest that was never written compared clean.
  'if ! git log "refs/remotes/origin/$epic..$head" --pretty=format:\'%s\' -- > "${MANIFEST_DIR}/actual-pr-<N>.manifest"; then',
  'git log "refs/remotes/origin/$epic" --oneline -<N+5> --',
  '   if ! EPIC_LOG=$(git log "refs/remotes/origin/$epic" --oneline --); then',
];

function extractGuards() {
  const guards = [...readSkill().matchAll(/case "\$head" in[\s\S]*?esac/g)].map((m) => m[0]);
  assert.equal(
    guards.length,
    2,
    'Step 5 and Rollback must each carry the protected-head guard — no more, no fewer'
  );
  return guards;
}

// The guard reads `$head`, so the harness **binds** the name instead of pasting it in.
// That is not a detail of the harness — it is the property under test. The earlier version
// of this file substituted the branch name as literal text, exactly as the skill then did,
// and fed it only benign names; both stayed green while a head named
// `feat/x$(printf${IFS}PWNED>&2)` — a name `check-ref-format` accepts, `update-ref` creates
// and `clone` propagates — executed its payload before the guard decided anything. A harness
// that reproduces the defect cannot detect it.
//
// argv-passing, not string interpolation: a name containing a quote would otherwise break
// the fixture rather than the guard. The guard block alone is extracted (case…esac), so a
// passing guard runs no git command.
function runGuard(guard, head) {
  return spawnSync('bash', ['-c', `head=$1\n${guard}\necho GUARD_PASSED`, '_', head], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

test('escapeRe when given regex metacharacters → escapes each one, not the live input only', () => {
  // The control the corruption survived without. Asserting on GIT_PREFIX alone proves nothing:
  // it carries no metacharacter, so a helper that returns garbage and a helper that works are
  // indistinguishable there. Each character below is checked by USE — the escaped form must match
  // the literal and nothing else — because "the output contains a backslash" was also true of the
  // corrupted version.
  for (const ch of ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']) {
    const literal = `a${ch}b`;
    assert.match(literal, new RegExp(`^${escapeRe(literal)}$`),
      `escapeRe must let ${ch} match itself literally`);
    assert.doesNotMatch('aXb', new RegExp(`^${escapeRe(literal)}$`),
      `and must not let ${ch} keep its regex meaning`);
  }
  assert.equal(escapeRe('plain-text'), 'plain-text', 'and must leave ordinary text untouched');
});

test('epic-merge guards when executed → refuse every protected head at both push sites', () => {
  for (const guard of extractGuards()) {
    for (const head of ['main', 'master', 'develop', 'release/1.0']) {
      const r = runGuard(guard, head);
      assert.notEqual(r.status, 0, `${head} must be refused before the force-push`);
      assert.ok(!r.stdout.includes('GUARD_PASSED'), `${head} must not fall through the guard`);
    }
  }
});

test('epic-merge guards when executed → do not overmatch ordinary head names', () => {
  // Same words as ordinary data: `main` matches exactly, `release/*` requires the
  // slash — a head that merely contains a protected word is a lawful push target.
  for (const guard of extractGuards()) {
    for (const head of ['feat/main-menu', 'release-notes', 'epic/develop-x', 'fix/master-detail']) {
      const r = runGuard(guard, head);
      assert.equal(r.status, 0, `${head} is not protected — the guard must not overmatch`);
      assert.ok(r.stdout.includes('GUARD_PASSED'), `${head} must fall through to the push`);
    }
  }
});

test('epic-merge guards when the head name is executable → evaluate nothing', () => {
  // A PR head arrives from GitHub, and git accepts names that are also shell programs.
  // Measured: `git check-ref-format refs/heads/feat/x$(printf${IFS}PWNED>&2)` exits 0,
  // `git update-ref` creates it, and `git clone` reproduces it as `origin/…`. Pasted into
  // the guard as text it runs first and the guard then passes the branch as unprotected —
  // a safety check that is itself the injection point.
  const payloads = [
    'feat/x$(printf${IFS}PWNED>&2)',
    'feat/y`printf${IFS}PWNED>&2`',
    "feat/z'&&printf${IFS}PWNED>&2#",
  ];
  for (const guard of extractGuards()) {
    for (const head of payloads) {
      const r = runGuard(guard, head);
      assert.ok(!`${r.stdout}${r.stderr}`.includes('PWNED'),
        `the guard must not evaluate the head name: ${head}`);
      // It is not protected, so it lawfully falls through — the point is that it reaches
      // the push as a name rather than having run as a program on the way.
      assert.equal(r.status, 0, `${head} is not a protected name`);
      assert.ok(r.stdout.includes('GUARD_PASSED'), `${head} must reach the push site`);
    }
  }

  // The harness can detect the defect — or the assertions above prove nothing. This is the
  // shape the skill used to have; it must produce PWNED, exactly where the fix removed it.
  const unsafe = spawnSync('bash', ['-c', `case "${payloads[0]}" in main) exit 1;; esac\necho GUARD_PASSED`],
    { encoding: 'utf8', stdio: 'pipe' });
  assert.ok(`${unsafe.stdout}${unsafe.stderr}`.includes('PWNED'),
    'the payload must actually be executable under literal substitution, or this test is vacuous');
});

// The two tests below assert a property of the pinned command lines, and separately that the
// document still contains exactly those lines. Splitting it that way is what removed the scanner:
// "which lines are commands" is answered once, by the pin, and "are those commands safe" is
// answered on strings this file controls — where a token walk is adequate because nothing
// adversarial can reach it.
test('every git log revision argument carries the -- separator', () => {
  // The property is **position**, not presence. "A `--` appears somewhere on the line" admits
  // `git log -- "$rev" --oneline` (separator too early — `$rev` is now a pathspec, and
  // `git log -- HEAD --oneline` exits 0 with no output, the same plausible-wrong-success this
  // guards against), `git log "$rev" --oneline # -- required` (it is in a comment) and
  // `git log "$rev" | sed -- …` (it belongs to another command). So: isolate the argument list
  // that belongs to *this* `git log` — up to the first token that ends the command — and require
  // `--` to be its **last** token.
  // And **every** occurrence on the line, not the first: `echo git log --; git log "$rev"
  // --oneline` passed while the executable command had no separator at all.
  const separated = (rest) => shellTokens(rest).at(-1) === '--';
  const missingSeparator = (lines) => lines
    .filter((line) => !occurrencesAfter(line, 'git log').every(separated));

  // Both directions, on the forms that motivated the rule (rules/testing.md § Guards).
  assert.deepEqual(missingSeparator(['git log "$rev" --oneline --']), [],
    'the correct form must pass');
  for (const decoy of [
    'git log -- "$rev" --oneline',                       // separator too early
    'git log "$rev" --oneline # -- required',             // inside a shell comment
    'git log "$rev" | sed -- s/a/b/',                     // belongs to a downstream command
    'git log "$rev" --oneline',                           // absent entirely
    'git log --oneline "pkg" "$(printf pkg --)"',         // inside a nested substitution
    'echo git log --; git log "$rev" --oneline',           // a safe first mention hiding a second
  ]) {
    assert.equal(missingSeparator([decoy]).length, 1,
      `a --  that does not separate this command's revisions must be reported: ${decoy}`);
  }
  // The other direction of the same property: a quoted metacharacter is data, not a terminator,
  // so these must NOT be reported. A parser that cuts at the first `)` or `|` rejects both.
  for (const ok of [
    'git log "weird)name" --oneline --',
    'git log "weird|name" --oneline --',
    "git log 'a#b' --pretty=format:'%s' --",
    'git log "origin/$epic" --oneline -<N+5> --',   // a `<…>` placeholder, not a redirect
    'git log "$rev" --pretty=format:\'%s\' -- > "out.manifest"', // a real redirect still ends it
  ]) {
    assert.deepEqual(missingSeparator([ok]), [],
      `a quoted metacharacter must not be read as a command terminator: ${ok}`);
  }

  // The document still issues exactly the pinned commands. This is the half the scanner used to
  // guess at; it is now an equality, so a sixth `git log` — or a reworded fifth — fails here and
  // names itself in the diff.
  assert.deepEqual(logCommandLines(readSkill()), CANONICAL_LOGS,
    'the git log commands changed — check the -- separator on the new form, then update the pin');
  assert.deepEqual(missingSeparator(CANONICAL_LOGS), [],
    'every git log must separate revisions from paths');

  // Delete-the-control on the pinned lines: a green check here must be the document's doing, not
  // the filter's.
  const mutated = CANONICAL_LOGS.map((l) => l.replace(' --oneline --)', ' --oneline)'));
  assert.notDeepEqual(mutated, CANONICAL_LOGS, 'the mutation fixture must actually differ');
  // Derived, never a literal: the fixture rewrites every line carrying that suffix, so a pin that
  // later gains a second one must not silently weaken the control into checking one of them.
  const touched = CANONICAL_LOGS.filter((l) => l.includes(' --oneline --)')).length;
  assert.ok(touched >= 1, 'the mutation fixture must have something to mutate');
  assert.equal(missingSeparator(mutated).length, touched,
    'every separator the fixture removed must be detected');
});

// One predicate, so the properties have a negative control. Round 33: they were written
// inline inside a loop that runs *after* an identity `deepEqual` against the pin — so a
// document mutation aborted the test before any property ran, and deleting a property left
// the suite green (rules/testing.md § Guards). Everything below goes through this function,
// and the hostile-spelling test beneath it turns each one red on demand.
function assertPushProperties(line) {
    // `--` before the ref. Quoting does not substitute for it: the shell eats the quotes and
    // git reads `--all` as a flag. Measured — `git push origin "--all"` on a branch legally
    // named `--all` answers "Everything up-to-date", having pushed every branch instead.
    // A separator **and** a full refspec. `--` ends option parsing, not refspec parsing: `+main`
    // is a legal branch name (`git check-ref-format refs/heads/+main` exits 0) that the protected
    // guard reads as unprotected, and measured, `git push origin -- "+main"` force-updated the
    // remote's `main` with exit 0 and no force flag on the line. A `src:dst` refspec cannot have
    // its first character read as the `+` force marker.
    // Round 72: the source side is `${PUSHED}` — the OBJECT the classification above the push
    // resolved — not the branch name git would re-resolve inside its own process after every one
    // of those decisions was taken. The `+main` argument above is unchanged by that and in fact
    // strengthened: an object ID can never have its first character read as the force marker.
    assert.match(line, /"origin" -- "\$\{PUSHED\}:refs\/heads\/\$\{head\}"$/,
      `the ref must be a full refspec after the separator, pushing the resolved object: ${line}`);
    assert.doesNotMatch(line, /-- "\$head"/, `a bare ref operand is refspec-injectable: ${line}`);
    // The rebase makes both pushes non-fast-forward by construction, and the opt-in hook
    // refuses that outright unless the caller declares the lease form. Without this the
    // skill cannot complete on a gated repo — an authorization workflow that cannot run.
    assert.match(line, /ALLOW_FORCE_WITH_LEASE=1/, `the lease form must be declared: ${line}`);
    // And the lease must be ON the command, in one of exactly two shapes: the value-less flag, or
    // the variable the rollback fence selects by classified row. Byte equality above pins each
    // line, but byte pins are what a maintainer regenerates; this is what survives that.
    const bareLease = /git push --force-with-lease --force-if-includes /.test(line);
    const boundLease = /git push --force-with-lease="refs\/heads\/\$\{head\}:\$\{(?:FINAL|RB)_TIP\}" /.test(line);
    assert.ok(bareLease || boundLease,
      `the lease must be literal and at the call site, never selected through a variable, and in `
      + `one of the two shapes this skill defines: ${line}`);
    // The two are mutually exclusive, and that is a measurement rather than a preference: on git
    // 2.55.0 (2026-08-22) a push carrying an explicit lease value AND `--force-if-includes`
    // succeeded over a remote tip that was never integrated locally, while the same tree with the
    // bare lease and the same flag was refused. git documents the flag as a no-op once the lease
    // carries a value; writing both spells a guarantee that is not there.
    if (boundLease) {
      assert.doesNotMatch(line, /--force-if-includes/,
        `--force-if-includes is a measured no-op beside a lease value — writing both claims a `
        + `check that does not run: ${line}`);
    }
    assert.doesNotMatch(line, /--force(?![-\w])/,
      `bare --force is forbidden to every skill (Anchor Register #4): ${line}`);
    // The receive-pack pin, and it is the one option asserted PRESENT rather than absent.
    // `remote.<name>.receivepack` names the program that receives the objects, and a program can
    // serve a different repository than the URL names — measured 2026-08-22, git printed
    // `To <A>` while every object landed in `<B>`. A value on the command line overrides the
    // configured one; `-c remote.<name>.receivepack=` does not (git keeps the config value and
    // says "more than one receivepack given, using the first"). So the canonical value pins git's
    // own default where configuration cannot reach it — and any other value would BE the redirect.
    assert.match(line, /--receive-pack=git-receive-pack /,
      `the receiving program must be pinned on the line, not left to configuration: ${line}`);
    for (const [, value] of line.matchAll(/--receive-pack(?:=|\s+)(\S+)/g)) {
      assert.equal(value, 'git-receive-pack',
        `--receive-pack may only be the exact literal git-receive-pack: ${line}`);
    }
    // Cleared, never set: /push-ci's Prohibited list forbids setting it, and the guard above
    // already refused every protected head — inheriting a 1 would disarm the hook's own check.
    assert.match(line, /ALLOW_PUSH_PROTECTED= /, `the protected bypass must be cleared: ${line}`);
    assert.doesNotMatch(line, /ALLOW_PUSH_PROTECTED=1/, `the protected bypass must never be set: ${line}`);
    // Round 33. These two were pinned only by the byte equality above — which is exactly what a
    // maintainer regenerates when they legitimately edit a push line. What survives a re-pin is
    // this property list, and the two most security-relevant clearings were not on it.
    //
    // ALLOW_FORCE_UNSHARED attests that the rewritten refs are not shared. That is a fact only
    // the operator holds; a value exported earlier in the shell answers the gate's question
    // without anybody being asked now, which is why clearing it is a rule and not a habit.
    // Round 35, and the same lesson one turn further: a name can be on the strip list with its
    // sense inverted. Unsetting GIT_NO_REPLACE_OBJECTS restores git's DEFAULT of honouring
    // refs/replace/*, and a `git replace --graft L R` then makes the gate's ancestry oracle call
    // a rewrite a fast-forward, while the transfer publishes the real L (pack transfer ignores
    // replacements). The safe value is SET. Measured 2026-08-21: 1 honest, 0 grafted, 1 guarded.
    assert.match(line, /GIT_NO_REPLACE_OBJECTS=1/, `the replace-ref guard must be set: ${line}`);
    assert.doesNotMatch(line, /-u GIT_NO_REPLACE_OBJECTS/,
      `GIT_NO_REPLACE_OBJECTS on the strip list is the inverted sense, not a guard: ${line}`);
    assert.match(line, /ALLOW_FORCE_UNSHARED= /, `the unshared attestation must be cleared: ${line}`);
    assert.doesNotMatch(line, /ALLOW_FORCE_UNSHARED=1/, `the attestation must never be set by this skill: ${line}`);
    // Round 56, and the direction is the reverse of the two lines above — which is why it belongs
    // on the property list rather than in the byte pin a maintainer regenerates. ALLOW_* are
    // operator attestations, so this skill must only ever CLEAR them; SD0X_PUSH_DEST_DIGEST is a
    // constraint the skill puts on its own push, naming the destination the approval covered, and
    // the gate refuses when git's own `$2` hashes to anything else. Cleared or absent it binds
    // nothing, so both spellings of "not set" have to fail here.
    assert.match(line, /SD0X_PUSH_DEST_DIGEST="\$PUSH_URLS_DIGEST" /,
      `the destination binding must carry the digest the approval covered: ${line}`);
    assert.doesNotMatch(line, /SD0X_PUSH_DEST_DIGEST= /,
      `an empty binding is indistinguishable from not binding at all: ${line}`);
    // `-u GIT_EXEC_PATH` — unset, not emptied, because an empty value is still a value git reads.
    // git PREPENDS its exec-path to PATH before running a hook, so this variable selects the
    // `git` the pre-push gate itself asks about ancestry — and a gate that mis-answers ancestry
    // reads a rebased head as a fast-forward. Measured 2026-08-21: with a git-core delegating
    // everything except `merge-base --is-ancestor`, a forced update landed with exit 0 and no
    // prompt; stripping the variable restored the refusal. A bare hostile PATH does NOT reach
    // here — git's own prepend shadows it — so this name, and not PATH, is the closable one.
    assert.match(line, /env -u BASH_ENV -u ENV -u GIT_EXEC_PATH /, `the gate's own git must not be caller-selected: ${line}`);
    // Round 34, one layer out from the same question. GIT_EXEC_PATH picks the gate's git;
    // these pick the *configuration* and the *ancestry* both the push and the gate resolve
    // against. Three, measured 2026-08-21 on a real repository with the gate wired:
    //   GIT_CONFIG_COUNT=1 + core.hooksPath=/dev/null  → `main` force-updated, exit 0, no gate
    //   the same channel + url.<host>.insteadOf         → the approved refspec reaches another server
    //   GIT_GRAFT_FILE=<graft>                          → gate installed, its own
    //                                                     `merge-base --is-ancestor` answers 0,
    //                                                     the rewrite reads as a fast-forward
    // GIT_CONFIG_COUNT is the whole KEY_n/VALUE_n channel — unset it and git reads neither, so
    // the unbounded `_n` suffix needs no enumeration. GIT_CONFIG_PARAMETERS is a second one and
    // is not covered by the first. This skill pushes in a LOOP, which is where an ambient value
    // is worst: set once, it answers every iteration without anybody being asked again.
    for (const name of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_GLOBAL', 'GIT_GRAFT_FILE']) {
      assert.match(line, new RegExp(`-u ${name} `),
        `${name} redirects the configuration or the ancestry this push and its gate resolve against: ${line}`);
    }
    // Round 61 inverted this assertion, and the inversion is the finding. It used to require that
    // GIT_SSH_COMMAND stay UNSTRIPPED, on the stated ground that the transport set "says how to
    // authenticate, not what is pushed". That is false, and measurably so: on git 2.55.0 the
    // variable names an executable git runs IN PLACE OF the connection, handed the host and the
    // remote command as arguments it is free to ignore — measured argv
    // `[approved.example] [git-receive-pack '/team/a.git']`. Same redirection as
    // `url.<host>.insteadOf`, which the line above already closes; closing one and pinning the
    // other open protected nothing. GIT_SSH is the older spelling of the same thing and
    // GIT_PROXY_COMMAND is its `git://` counterpart (measured argv `[approved.example] [9418]`).
    //
    // GIT_SSH_VARIANT took a further round to reach, and the reason is worth keeping: it is the one
    // name here that does NOT name an executable, so "git runs it as the connection" — the argument
    // that admitted the other three — is simply false about it. It changes the argv git BUILDS for
    // whatever transport does run. Measured on `ssh://example.invalid:2222/team/a.git`, git 2.55.0
    // with OpenSSH 10.3p1: unset emits `ssh -o SendEnv=GIT_PROTOCOL -p 2222 example.invalid …`,
    // while `=plink` emits `ssh -P 2222 example.invalid …` — and OpenSSH's `-P` takes a *tag*
    // (`ssh` usage: `[-P tag]`), not a port. The port is silently dropped and the connection lands
    // on 22, which on a host serving a different repository there is a redirection with no error.
    for (const name of ['GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_PROXY_COMMAND', 'GIT_SSH_VARIANT']) {
      assert.match(line, new RegExp(`-u ${name} `),
        `${name} decides which host and port git's transport reaches, so it chooses the destination: ${line}`);
    }
    // And the boundary of the fix, asserted so it cannot quietly widen. GIT_ASKPASS is handed a
    // prompt and returns a credential; it cannot choose a destination, and stripping it would break
    // the operator's own credential helper on a push that is otherwise correct.
    assert.doesNotMatch(line, /-u GIT_ASKPASS/,
      `GIT_ASKPASS supplies a secret, it does not select a remote — leave it: ${line}`);
}

test('both force-pushes → separate the ref from the options and declare the lease', () => {
  // Identity first: the document's push commands are exactly the pinned pair. A third push, or a
  // reworded one, fails here rather than being scanned for by a parser that has to anticipate how
  // it was written.
  assert.deepEqual(pushCommandLines(readSkill()), CANONICAL_PUSHES,
    'the push commands changed — check them against the properties below, then update the pin');
  for (const line of CANONICAL_PUSHES) assertPushProperties(line);
});

test('the push properties when a required element is dropped → each one fails on its own', () => {
  // Delete-the-control. Every fixture is a real spelling somebody could write while editing
  // Phase 2 or Rollback and re-pinning in good faith, which is the only path by which these
  // clearings can be lost — the byte pin cannot object to a pin the editor updated.
  assert.doesNotThrow(() => assertPushProperties(CANONICAL_PUSH),
    'precondition: the shipped push satisfies every property');
  assert.doesNotThrow(() => assertPushProperties(CANONICAL_ITERATION_PUSH),
    'precondition: and so does the bound-lease form, or the disjunction admits only one of them');
  const drops = {
    // Round 60's two, both on the lease shape rather than on the environment around it.
    'the bound lease combined with --force-if-includes': CANONICAL_ITERATION_PUSH.replace(
      'git push --force-with-lease="refs/heads/${head}:${FINAL_TIP}" ',
      'git push --force-with-lease="refs/heads/${head}:${FINAL_TIP}" --force-if-includes ',
    ),
    'the lease value unbound from the measured tip': CANONICAL_ITERATION_PUSH.replace(
      '--force-with-lease="refs/heads/${head}:${FINAL_TIP}"', '--force-with-lease="refs/heads/${head}"',
    ),
    'the option separator and refspec replaced by a bare operand':
      CANONICAL_PUSH.replace('-- "${PUSHED}:refs/heads/${head}"', '-- "$head"'),
    'the lease declaration dropped': CANONICAL_PUSH.replace('ALLOW_FORCE_WITH_LEASE=1 ', ''),
    'the protected bypass cleared → set': CANONICAL_PUSH.replace('ALLOW_PUSH_PROTECTED= ', 'ALLOW_PUSH_PROTECTED=1 '),
    'the protected bypass clearing dropped': CANONICAL_PUSH.replace('ALLOW_PUSH_PROTECTED= ', ''),
    'the unshared attestation clearing dropped': CANONICAL_PUSH.replace('ALLOW_FORCE_UNSHARED= ', ''),
    'the replace-ref guard cleared instead of set':
      CANONICAL_PUSH.replace('GIT_NO_REPLACE_OBJECTS=1 ', '').replace(' -u GIT_REPLACE_REF_BASE', ' -u GIT_NO_REPLACE_OBJECTS -u GIT_REPLACE_REF_BASE'),
    'the replace-ref guard dropped entirely': CANONICAL_PUSH.replace('GIT_NO_REPLACE_OBJECTS=1 ', ''),
    'the unshared attestation set by the skill': CANONICAL_PUSH.replace('ALLOW_FORCE_UNSHARED= ', 'ALLOW_FORCE_UNSHARED=1 '),
    'the destination binding dropped': CANONICAL_PUSH.replace('SD0X_PUSH_DEST_DIGEST="$PUSH_URLS_DIGEST" ', ''),
    // The receive-pack pin is the one option here whose safe form is PRESENT rather than absent:
    // a command-line value overrides `remote.<name>.receivepack`, which is what closes the window
    // between the Phase 0 read and the push. Both directions are mutated — removing it reopens the
    // window, and changing the value turns the pin itself into the redirect.
    'the receive-pack pin dropped': CANONICAL_PUSH.replace('--receive-pack=git-receive-pack ', ''),
    'the receive-pack pin pointed elsewhere': CANONICAL_PUSH.replace('--receive-pack=git-receive-pack', '--receive-pack=/tmp/rp'),
    'the destination binding emptied': CANONICAL_PUSH.replace('SD0X_PUSH_DEST_DIGEST="$PUSH_URLS_DIGEST" ', 'SD0X_PUSH_DEST_DIGEST= '),
    'GIT_EXEC_PATH left caller-selectable': CANONICAL_PUSH.replace('-u GIT_EXEC_PATH ', ''),
    'GIT_EXEC_PATH emptied instead of unset':
      CANONICAL_PUSH.replace('env -u BASH_ENV -u ENV -u GIT_EXEC_PATH ', 'env -u BASH_ENV -u ENV GIT_EXEC_PATH= '),
    'the config channel left open': CANONICAL_PUSH.replace('-u GIT_CONFIG_COUNT ', ''),
    'the second config channel left open': CANONICAL_PUSH.replace('-u GIT_CONFIG_PARAMETERS ', ''),
    'the alternate config file left selectable': CANONICAL_PUSH.replace('-u GIT_CONFIG_GLOBAL ', ''),
    'the ancestry oracle left poisonable': CANONICAL_PUSH.replace('-u GIT_GRAFT_FILE ', ''),
    'the ssh transport left redirectable': CANONICAL_PUSH.replace('-u GIT_SSH_COMMAND ', ''),
    'the older ssh spelling left redirectable': CANONICAL_PUSH.replace('-u GIT_SSH ', ''),
    'the git:// proxy left redirectable': CANONICAL_PUSH.replace('-u GIT_PROXY_COMMAND ', ''),
    'the ssh variant left caller-selectable': CANONICAL_PUSH.replace('-u GIT_SSH_VARIANT ', ''),
    // The negative control's own control: a list that grew until it swallowed the credential
    // helper would pass every `-u` assertion above and break real pushes, so it has to fail here.
    // GIT_ASKPASS is the boundary — round 61 stripped what chooses the destination and nothing more.
    'the credential helper swept in too':
      CANONICAL_PUSH.replace('-u GIT_GRAFT_FILE ', '-u GIT_GRAFT_FILE -u GIT_ASKPASS '),
  };
  for (const [label, mutant] of Object.entries(drops)) {
    assert.notEqual(mutant, CANONICAL_PUSH, `fixture did not mutate anything: ${label}`);
    assert.throws(() => assertPushProperties(mutant), `undetected: ${label}`);
  }
});

test('Phase 0 validation gate rejects protected PR heads before any destructive step', () => {
  const skill = readSkill();
  assert.match(
    skill,
    /\*\*Any PR's head branch is protected\*\* \(`main`, `master`, `develop`, `release\/\*`\)/,
    'the validation gate must name the protected-head abort condition'
  );
  assert.match(
    skill,
    /a PR can be opened \*from\* `main`/,
    'the gate must state why "PR head" is not proof of "not protected"'
  );
  assert.match(
    skill,
    /Step 5 and Rollback re-assert this guard/,
    'the gate must say the guard is re-asserted at the push sites'
  );
});

test('the safety rules table carries the protected-head rejection', () => {
  assert.match(
    readSkill(),
    /^\| Protected head branches rejected — Phase 0, re-asserted at Step 5 and Rollback \|/m,
    'the safety rules table must list the protected-head rule as a row'
  );
});

test('epic-merge never issues a bare --force push', () => {
  const skill = readSkill();
  assert.match(skill, /--force-with-lease, NEVER --force/, 'the lease-only rule must stay stated');
  // The pinned commands, not a document-wide word ban: prose legitimately says "NEVER --force",
  // and the table rows name `git push` inside code spans. Identity is asserted in the test above;
  // this one asserts the property, on strings this file owns.
  const pushLines = CANONICAL_PUSHES;
  assert.ok(pushLines.length >= 2, 'precondition: the skill contains push commands');
  // **Decided over tokens, not substrings.** A substring check reads only the flags someone
  // thought to spell out: `/--force(?![-\w])/` misses git's `-f` alias entirely, and a positive
  // `--force-if-includes` match stays green next to a `--no-force-if-includes` that turns it
  // off. Measured: `git push --force-with-lease --force-if-includes -f origin -- head` passed
  // all three of the previous assertions while `-f` disables the lease checks git documents.
  const forbiddenFlags = new Set(['--force', '-f', '--no-force-with-lease', '--no-force-if-includes']);
  // One list, two reasons to refuse: a flag that is forbidden, and a token whose effect the scan
  // cannot decide. Kept together because the caller's question is "may this line stand", and the
  // answer is no either way — separating them is what let `-uf` change category and slip through
  // a check written for the other one.
  const violations = (line) => occurrencesAfter(line, 'git push').flatMap((rest) => [
    ...optionRegionUndecidables(shellTokens(rest)).map((t) => `undecidable:${t}`),
    ...flagTokens(rest).filter((t) => forbiddenFlags.has(t)).map((t) => `forbidden:${t}`),
  ]);

  for (const line of pushLines) {
    assert.deepEqual(violations(line), [], `force protection disabled or undecidable: ${line}`);
    // **Every occurrence, for the positive checks too.** Moving only the forbidden-flag scan off
    // `indexOf` left this half looking at the first mention: measured,
    // `echo git push --force-with-lease --force-if-includes; ALLOW_PUSH_PROTECTED= … git push
    // "origin" -- "$head"` satisfied both requirements from the echoed text while the executable
    // command carried neither flag.
    for (const rest of occurrencesAfter(line, 'git push')) {
      // **A flag git reads as an option, not a token that looks like one.** `optionWords` drops
      // the arguments consumed as option *values*, because a positive membership test on the raw
      // tokens accepts a command where the flag is data: measured,
      // `git push --force-with-lease -o --force-if-includes origin -- ref` answered `the receiving
      // end does not support push options` — git took the rejection flag as the push-option value,
      // so the push ran on the bare lease with both assertions green.
      const tokens = optionWords(shellTokens(rest));
      // Rejecting the disabling forms is not enough: a plain `git push` with no flag also
      // violates the lease-only invariant this skill states, so both flags are required.
      assert.ok(tokens.includes('--force-with-lease'), `push command missing the lease flag: ${line}`);
      // And the lease alone is not the control the safety table claims: measured against a real
      // remote, a collaborator commit fetched but not integrated is overwritten with exit 0 under
      // the bare lease and rejected with exit 1 once this flag is present.
      //
      // Round 60: there are now two lawful lease shapes, and each carries its own second half —
      // the value-less lease needs `--force-if-includes` beside it, while a lease **bound to a
      // measured tip** must not, because the flag is a documented and measured no-op once the
      // lease carries a value. The binding to `$FINAL_TIP` is that shape's second half, and it is
      // required here rather than left to the byte pin: a bound lease naming anything else would
      // satisfy `--force-with-lease=` and check nothing this skill measured.
      if (/--force-with-lease=/.test(rest)) {
        assert.doesNotMatch(rest, /--force-if-includes/,
          `a bound lease must not also carry --force-if-includes — it does nothing there: ${line}`);
        assert.match(rest, /--force-with-lease="refs\/heads\/\$\{head\}:\$\{(?:FINAL|RB)_TIP\}"/,
          `a bound lease must name the tip the fence above it measured — $FINAL_TIP for Step 5, `
          + `$RB_TIP for the rollback: ${line}`);
      } else {
        assert.ok(tokens.includes('--force-if-includes'), `push command missing --force-if-includes: ${line}`);
      }
    }
  }

  // Delete-the-control, one case per way the protection can be turned back off — whether the
  // refusal comes out as `forbidden:` or as `undecidable:` is bookkeeping; what each case asserts
  // is that the line does not stand.
  for (const bad of [
    'ALLOW_FORCE_WITH_LEASE=1 git push --force "origin" -- "$head"',
    'git push --force-with-lease --force-if-includes -f origin -- "$head"',
    'git push --force-with-lease --no-force-if-includes origin -- "$head"',
    'git push --no-force-with-lease --force-if-includes origin -- "$head"',
    'git push "--force" origin -- "$head"',
    "git push --fo'rce' origin -- \"$head\"",
    // git accepts unambiguous prefixes; both of these reached the remote when measured.
    'git push --force-with-lease --no-force-i origin -- "$head"',
    'git push --no-force-w --force-if-includes origin -- "$head"',
    // A safe first mention on the same line does not make the second one safe.
    'echo git push --force-with-lease --force-if-includes; git push -f origin -- "$head"',
    // Refused as undecidable rather than as a named flag, and the distinction is the point: a
    // substitution produces a real `--force` that no token spelling reveals, and a cluster moves
    // git's separator. Both were measured; neither may stand.
    'git push --force-with-lease --force-if-includes "$(printf -- --force)" origin -- "$head"',
    'git push --force-with-lease --force-if-includes -uf origin -- "$head"',
    // `-vo` ends in a value-taking letter, so git reads the following `--` as the `-o` value and
    // the substitution after it as a real option. Measured: `-vo -- --dry-run . -- refs/…`
    // selected `.` as the remote and reached receive-pack.
    'git push --force-with-lease --force-if-includes -vo -- "$(printf -- --force)" origin -- "$head"',
    // Legitimate shapes this refusal also costs, listed here rather than hidden: a cluster is
    // rejected whatever its letters mean, so `-uq` and `-of` must be spelled apart to pass.
    'git push --force-with-lease --force-if-includes -uq origin -- "$head"',
    'git push --force-with-lease --force-if-includes -of origin -- "$head"',
  ]) {
    assert.notDeepEqual(violations(bad), [], `must refuse: ${bad}`);
  }
  // Negative controls, in the same words the cases above use as data (rules/testing.md § Guards).
  // Without them the normalizations are one-directional: unquoting every token, or refusing every
  // `-xy`, could reject ordinary pushes and nothing here would say so.
  for (const good of [
    'git push --force-with-lease --force-if-includes "origin" -- "$head"',
    'git push --force-with-lease --force-if-includes -u origin -- "$head"',
    'git push --force-with-lease --force-if-includes -u -q origin -- "$head"',
    'git push --force-with-lease --force-if-includes origin -- "backup/pr-42-force-fix"',
    'git push --force-with-lease --force-if-includes origin -- "$head" # never --force',
    // An expansion *after* the separator is an ordinary ref, not a finding — the walk must stop
    // at git's `--` rather than reporting every `$` on the line.
    'git push --force-with-lease --force-if-includes "origin" -- "$(printf refs/heads/x:refs/heads/x)"',
    // The lease flag with an explicit expectation is still the lease flag.
    'git push --force-with-lease=refs/heads/x:abc123 --force-if-includes origin -- "$head"',
  ]) {
    assert.deepEqual(violations(good), [], `must not fire on a compliant push: ${good}`);
  }

  // **The positive half needs fixtures of its own, because `violations()` says nothing about it.**
  // `git push --force-with-lease -o --force-if-includes origin -- ref` has no forbidden flag and
  // no undecidable token, so the merged list is empty — and the push runs on the bare lease,
  // because git took the rejection flag as the `-o` value. Measured: that command answered
  // `the receiving end does not support push options`.
  const missingRequired = (line, required = ['--force-with-lease', '--force-if-includes']) =>
    occurrencesAfter(line, 'git push').flatMap((rest) => {
      const words = optionWords(shellTokens(rest));
      return required.filter((f) => !words.includes(f));
    });
  // Round 75: neither shipped push carries `--force-if-includes` any more — both bind the lease to
  // a measured tip, beside which git documents the flag as a no-op (§ Safety). What the shipped
  // lines are still checked for is the lease itself, and the `=value` spelling must count as
  // present: an `optionWords` that named `--force-with-lease="…"` something else would report the
  // flag missing from every push this skill makes.
  for (const line of CANONICAL_PUSHES) {
    assert.deepEqual(missingRequired(line, ['--force-with-lease']), [],
      'the pinned push must carry the lease flag, `=value` spelling included: ' + line);
  }
  // The two-flag form of the helper is what the swallowing fixtures below exercise, and it stays
  // exercised on a line that satisfies it, so those `notDeepEqual`s keep meaning something.
  assert.deepEqual(
    missingRequired('git push --force-with-lease --force-if-includes origin -- "$head"'), [],
    'precondition: the helper reports nothing missing when both flags are plainly present');
  for (const [label, bad] of [
    ['-o swallows the next flag', 'git push --force-with-lease -o --force-if-includes origin -- "$head"'],
    ['--push-option swallows it', 'git push --force-with-lease --push-option --force-if-includes origin -- "$head"'],
    ['--exec swallows it', 'git push --force-if-includes --exec --force-with-lease origin -- "$head"'],
    // Measured: `--recurse-submodules` takes `(check|on-demand|no)` as a separate argument.
    ['--recurse-submodules swallows it', 'git push --force-with-lease --recurse-submodules --force-if-includes origin -- "$head"'],
    ['neither flag present', 'git push origin -- "$head"'],
    ['a required flag sits after git\'s separator', 'git push --force-with-lease origin -- "$head" --force-if-includes'],
  ]) {
    assert.notDeepEqual(missingRequired(bad), [], `a required flag must not count as present: ${label}`);
  }
  // Both directions (rules/testing.md § Guards): an inline `=value` consumes nothing, so the flag
  // after it is still a flag — otherwise "drop the next argument" would reject compliant pushes.
  for (const good of [
    'git push --force-with-lease --push-option=ci.skip --force-if-includes origin -- "$head"',
    'git push --force-with-lease=refs/heads/x:abc123 --force-if-includes origin -- "$head"',
    // The `--no-` polarity does not take a value — measured, `--no-recurse-submodules check` exits
    // 128 with `check` read as a refspec — so it must not eat the flag after it either.
    'git push --force-with-lease --no-recurse-submodules --force-if-includes origin -- "$head"',
  ]) {
    assert.deepEqual(missingRequired(good), [], `an =value option must not swallow the next flag: ${good}`);
  }
  // The other half of the table — `optionRegionUndecidables` — deliberately keeps reporting an
  // expansion used as a *value*, and that is not a gap this fix should close. Deciding it needs a
  // word-splitting model: `--recurse-submodules "$mode"` is one word git must consume as the value,
  // but unquoted `--recurse-submodules $mode` with `mode='check --force'` splits into two, and the
  // second is a real flag. No line in either skill uses that form, so the model would be built for
  // a case that does not exist, and refusal is the safe direction either way — the same trade the
  // `--force-with-lease="$ref"` note above already records.
});

// ── The grant is a set of command FORMS, and one form is not the family ───────
// Round 18: Conflict Handling told the skill to run `git rebase --continue` and
// `git rebase --abort`. The Anchor grant (`rules/git-workflow.md`, Register #4)
// names the exact form `git rebase --onto`; `--continue` mutates history under a
// form the closed set does not carry, and every test here passed because they
// all looked at push targets and lease spelling instead. The defect was not a
// wrong word — it was that nothing enumerated what this document tells Claude to
// execute and compared it with what the rule allows.
//
// So that enumeration is the test. Every destructive git form the document names
// is extracted and reduced to `<subcommand> <first-flag>`, and the resulting set
// must equal the pinned one. This is a NAMED check, not the closure — round 19
// showed a set loses multiplicity and location, and the whole-file digest at the
// bottom is what closes the document. What this buys is the message: a new form
// fails here saying which Register entry it is missing from, next to the rule
// reference, which is where that question gets asked.
const DESTRUCTIVE_FORMS = new Set([
  // Granted to this skill by name (rules/git-workflow.md § Exception, Register #4)
  'rebase --onto',
  'push --force-with-lease',
  // NOT granted, and present only as text the DEVELOPER runs after a conflict —
  // § Conflict Handling hands the repository back rather than continuing. Their
  // presence here is the record of that boundary, not an authorization.
  'rebase --continue',
  'rebase --abort',
]);

// Command position, not document-wide word search — the same distinction the bare-`--force` test
// above draws, and for the same reason: § References legitimately says "gate pattern for git push"
// while naming no command. Counted: inline code spans, every line inside a fenced block, and any
// line that starts with `git`. A form written outside all three is prose about a command, not one.
function destructiveForms(skill) {
  const spans = [];
  let fenced = false;
  for (const line of skill.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    // A fenced line beginning with a `$ ` prompt is a recorded terminal session — evidence of what
    // a command *did*, which the hazard sections quote verbatim so the reader can re-run it. The
    // `+main` force-push transcript is one, and counting it would list `push` among the forms this
    // skill issues, which is the opposite of what that transcript says. The residue is stated
    // rather than hidden: an instruction disguised behind a `$ ` prompt would be skipped here.
    // Nothing in this document writes an instruction that way, the digest pin below closes the
    // file regardless, and the mutation test that follows adds its form without a prompt.
    if (fenced && /^\s*\$ /.test(line)) continue;
    if (fenced || /^\s*git\s/.test(line)) spans.push(line);
    for (const m of line.matchAll(/`([^`\n]+)`/g)) spans.push(m[1]);
  }
  const forms = new Set();
  for (const s of spans) {
    for (const m of s.matchAll(/\bgit (rebase|push|add|commit|reset|stash)\b([^\n`|]*)/g)) {
      const raw = (m[2].trim().split(/\s+/)[0] || '').replace(/[",]+$/, '');
      // An inline value does not make a different form. `--force-with-lease=<ref>:<expect>` is the
      // option the Anchor grant names, spelled with its value on the same word, and reducing to the
      // option is what keeps this a set of FORMS rather than of spellings — the value itself is
      // pinned by `assertPushProperties` and by the byte pin. Note this cannot widen the set: an
      // ungranted `--force=1` still reduces to `push --force`, which is not in it.
      const flag = raw.includes('=') ? raw.slice(0, raw.indexOf('=')) : raw;
      forms.add(flag.startsWith('-') ? `${m[1]} ${flag}` : m[1]);
    }
  }
  return forms;
}

test('every destructive git form the skill names → is one the Anchor grant accounts for', () => {
  const found = destructiveForms(readSkill());
  assert.deepEqual([...found].sort(), [...DESTRUCTIVE_FORMS].sort(),
    'a destructive git form appeared or disappeared. Adding one is an Anchor-level question: '
    + 'rules/git-workflow.md § Exception grants this skill `git rebase --onto`, '
    + '`git push --force-with-lease` and `gh pr merge --squash`, and nothing else. If the new form '
    + 'is for the developer to run, say so where it appears and add it here with that reason.');
});

test('the form enumeration when an ungranted rebase form is added → the run turns red', () => {
  // Both directions, per rules/testing.md § Guards. The widening is the exact one
  // round 18 found; the honest edit is a reworded sentence around the same commands.
  const skill = readSkill();
  const widened = skill.replace('## Resume / Checkpoint (long chains)',
    'On a failed verify, Claude runs `git reset --hard "backup/pr-<n>"` to restore.\n\n## Resume / Checkpoint (long chains)');
  assert.notEqual(widened, skill, 'the fixture must actually differ from the skill');
  assert.notDeepEqual([...destructiveForms(widened)].sort(), [...DESTRUCTIVE_FORMS].sort(),
    'an ungranted destructive form was added and the enumeration did not notice');

  // Round 60's control on the reduction itself: stripping `=<value>` must not launder an ungranted
  // option into a granted one. `--force=1` reduces to `push --force`, which the set does not carry.
  const inlineForce = skill.replace('## Resume / Checkpoint (long chains)',
    'On a failed verify, Claude runs `git push --force="origin"` to republish.\n\n## Resume / Checkpoint (long chains)');
  assert.notEqual(inlineForce, skill, 'the fixture must actually differ from the skill');
  assert.notDeepEqual([...destructiveForms(inlineForce)].sort(), [...DESTRUCTIVE_FORMS].sort(),
    'an inline value must not turn an ungranted option into a granted form');

  const honest = skill.replace('Re-verify the manifest after the developer reports the rebase finished',
    'Re-verify the manifest once the developer reports that the rebase has finished');
  assert.notEqual(honest, skill, 'the fixture must actually differ from the skill');
  assert.deepEqual([...destructiveForms(honest)].sort(), [...DESTRUCTIVE_FORMS].sort(),
    'an ordinary reword was reported as an authorization change');
});

// The grant statement itself is one sentence, and it is the one a maintainer would widen while
// adding the form. Pinned byte-for-byte, same construction as `test/skills/smart-rebase.test.js`:
// any rewording changes bytes, so the enumeration above and the sentence it is checked against
// cannot drift apart silently.
const CANONICAL_GRANT = 'This skill is one of the explicit exceptions in `@rules/git-workflow.md` allowed to execute `git rebase --onto`, `git push --force-with-lease`, and `gh pr merge --squash`. Every destructive step is gated by `AskUserQuestion`.';

test('the grant statement → matches the Anchor exception byte-for-byte', () => {
  const lines = readSkill().split('\n');
  const found = lines.filter((l) => l.startsWith('This skill is one of the explicit exceptions'));
  assert.equal(found.length, 1, 'the grant must be stated exactly once');
  assert.equal(found[0], CANONICAL_GRANT,
    'the grant statement changed. rules/git-workflow.md § Exception is the authority and this line '
    + 'restates it; widening either without the other is an Anchor-level change (Register #4)');
});

test('the grant pin when the exception list is widened → the run turns red', () => {
  const skill = readSkill();
  const widened = skill.replace('`git rebase --onto`', '`git rebase` (any form)');
  assert.notEqual(widened, skill, 'the fixture must actually differ from the skill');
  const line = widened.split('\n').find((l) => l.startsWith('This skill is one of the explicit exceptions'));
  assert.notEqual(line, CANONICAL_GRANT, 'a widened grant statement was not detected');
});

// **The enumeration says which forms appear; it cannot say who runs them.** `rebase --continue` is
// on the list above because § Conflict Handling hands the repository back to the developer — and
// that framing is a paragraph of prose, so restoring the old numbered list ("2. `git rebase
// --continue`") as a step Claude performs leaves the form set byte-identical and every test green.
// That is exactly the round-18 defect, re-enterable. So the section is pinned: the boundary is the
// text, and the text is what changes when the boundary moves.
const CANONICAL_CONFLICT_HANDLING = [
  "## Conflict Handling",
  "",
  "**A conflict ends Claude's execution of the chain.** The Anchor grant in `@rules/git-workflow.md`",
  "is the exact form `git rebase --onto` — `--continue`, `--abort` and `--skip` are not on it, and a",
  "grant for one rebase form is not a grant for the family. So the skill stops with the repository",
  "mid-rebase, prints the commands below, and the developer runs them:",
  "",
  "```bash",
  "# resolve the conflicted paths, then:",
  "/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rebase --continue     # never --skip — commits must not be lost",
  "# or, if it cannot be resolved:",
  "/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE -u GIT_CEILING_DIRECTORIES -u GIT_GLOB_PATHSPECS -u GIT_ICASE_PATHSPECS -u GIT_NOGLOB_PATHSPECS -u GIT_LITERAL_PATHSPECS -u GIT_CONFIG -u GIT_CONFIG_PARAMETERS -u GIT_CONFIG_COUNT -u GIT_CONFIG_NOSYSTEM -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_SYSTEM -u GIT_IMPLICIT_WORK_TREE -u GIT_GRAFT_FILE -u GIT_SHALLOW_FILE -u GIT_PREFIX -u GIT_REPLACE_REF_BASE -u GIT_EXTERNAL_DIFF -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_PROXY_COMMAND -u GIT_SSH_VARIANT git rebase --abort        # then restore from the Phase 1 backup tag",
  "```",
  "",
  "Re-verify the manifest after the developer reports the rebase finished (subject set must match)",
  "before offering to continue the chain. Resuming without that check merges an unverified tree.",
].join('\n');

function sectionOf(text, heading) {
  const lines = text.split('\n');
  const i = lines.indexOf(heading);
  assert.notEqual(i, -1, `${heading} is missing from the skill`);
  let j = i + 1;
  while (j < lines.length && !/^## /.test(lines[j])) j += 1;
  while (j > i + 1 && lines[j - 1] === '') j -= 1;
  return lines.slice(i, j).join('\n');
}

test('the conflict hand-off → says the developer runs the ungranted forms, byte-for-byte', () => {
  assert.equal(sectionOf(readSkill(), '## Conflict Handling'), CANONICAL_CONFLICT_HANDLING,
    '§ Conflict Handling changed. It is what makes `rebase --continue` / `--abort` lawful in this '
    + 'document — as text the DEVELOPER runs. If the change keeps that boundary, update this '
    + 'constant; if it makes Claude execute either form, it is an Anchor-level change (Register #4)');
});

test('the hand-off pin when a step is given back to Claude → the run turns red', () => {
  const skill = readSkill();
  const widened = skill.replace(
    "**A conflict ends Claude's execution of the chain.**",
    'On a conflict, Claude resolves the paths and continues:');
  assert.notEqual(widened, skill, 'the fixture must actually differ from the skill');
  assert.notEqual(sectionOf(widened, '## Conflict Handling'), CANONICAL_CONFLICT_HANDLING,
    'the hand-off was rewritten into an execution step and the pin did not notice');
});

// ── The closure is the file, not the set ─────────────────────────────────────
// Round 19 defeated everything above three ways, each leaving 11/11 green:
//
//   • the executable Phase 2 `git rebase --onto` swapped for `git rebase --continue` — both forms
//     already appear elsewhere, so the SET is unchanged
//   • a new section added saying Claude executes `git rebase --continue` — the Conflict Handling
//     pin covers its own section and nothing else
//   • the executable `gh pr merge "<N>" --squash` swapped for `--admin` — the extractor never
//     looked at `gh` at all
//
// A set loses multiplicity and location; a per-section pin covers one section. Neither is closure,
// and the argument around them assumed it was. The same construction that settled this for
// `/push-ci` and `/smart-rebase` settles it here: the whole document is an instruction surface,
// every sentence can move what Claude executes, and a digest change is a review trigger with a
// one-command remedy. The checks above stay because they name the likely change precisely — a
// digest says only "something moved".
test('run-owned manifests stay out of the worktree, and cleanup removes all of them', () => {
  // Measured: with `.epic-merge-pr-100.manifest` at the repo root, `git status --porcelain`
  // prints `?? .epic-merge-pr-100.manifest`; the same file under `.git/epic-merge/` leaves
  // porcelain empty. The rollback guard refuses on any nonempty porcelain output, so the
  // location is what decides whether recovery is reachable at all — not a tidiness preference.
  const skill = readSkill();

  assert.match(skill, new RegExp('MANIFEST_DIR=\\$\\(' + escapeRe(GIT_PREFIX) + 'git rev-parse --git-path epic-merge\\)'),
    'the manifest directory must be resolved inside the git directory');
  // Cleanup removes the whole run-owned directory — expected and actual manifests alike. It does
  // so through the variable it derived, never through a bare substitution: `rm -rf "$(…)"` cannot
  // fail here, because a failed `rev-parse` prints nothing and `rm -rf ""` returns 0. That this
  // text is the removal, rather than text that merely mentions one, is what the behavioural test
  // below settles ('cleanup when its target cannot be derived → refuses instead of removing
  // nothing') — a substring match here would stay green with `false &&` in front of the line.
  assert.match(skill, /^\/bin\/rm -rf "\$MANIFEST_DIR"$/m,
    'cleanup must remove the derived directory, and the removal must be the whole line');
  assert.doesNotMatch(skill, new RegExp('rm -rf "\\$\\(' + escapeRe(GIT_PREFIX) + 'git rev-parse'),
    'and never through a bare substitution, whose failure is indistinguishable from success');

  // Both manifests must be written through that variable, never to a bare relative path.
  const redirects = [...skill.matchAll(/> "?([^"\s]*\.manifest)"?/g)].map((m) => m[1]);
  assert.ok(redirects.length >= 2, `both manifest writes must remain findable, saw ${redirects.length}`);
  for (const target of redirects) {
    assert.ok(target.startsWith('${MANIFEST_DIR}/'),
      `a manifest written to ${target} lands in the worktree and disarms the rollback guard`);
  }

  // Negative control: the pre-fix worktree-relative form must fail the assertion above, so this
  // pins the location rather than merely counting redirects.
  assert.ok(!'.epic-merge-pr-${pr}.manifest'.startsWith('${MANIFEST_DIR}/'),
    'the old root-relative target must not satisfy the location check');
});

test('every bash fence that uses MANIFEST_DIR also assigns it — fences do not share a shell', () => {
  // The defect this pins shipped once: Phase 1 assigned MANIFEST_DIR, Phase 2 Step 4 only USED it.
  // Each ```bash fence is copied into its own shell, so the assignment does not carry over — unset,
  // `"${MANIFEST_DIR}/actual-pr-<N>.manifest"` expands to `/actual-pr-<N>.manifest` and Step 4
  // writes at the filesystem root. Nothing about the text looks wrong; only the fence boundary says
  // so, which is why this is a structural check rather than a reading of any one line.
  const fences = [...readSkill().matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(fences.length >= 2, `expected several bash fences, saw ${fences.length}`);

  const ASSIGN = /^\s*MANIFEST_DIR=/m;
  const users = fences.filter((f) => f.includes('${MANIFEST_DIR}'));
  assert.ok(users.length >= 2,
    `at least the write and the verify fence must use MANIFEST_DIR, saw ${users.length}`);
  for (const f of users) {
    assert.match(f, ASSIGN,
      `a fence uses \${MANIFEST_DIR} without assigning it, so it expands empty:\n${f.slice(0, 400)}`);
  }

  // Negative control, in the same direction the defect ran: a fence that only reads the variable
  // must be caught. Without this the test would stay green on a skill where no fence assigns it.
  assert.doesNotMatch('git log x > "${MANIFEST_DIR}/actual.manifest"\n', ASSIGN,
    'the use-without-assign shape must not satisfy the assignment check');
  // And the opposite control: assigning it counts, so the check is not simply always-false.
  assert.match('MANIFEST_DIR=$(git rev-parse --git-path epic-merge)\n', ASSIGN,
    'a real assignment must satisfy the check');
});

test('every git command in the document → carries the canonical prefix', () => {
  // Round 39. Two independent reasons, both measured, both closing on the same prefix:
  //   * a bare `env` is a command word with no slash, so bash resolves an imported
  //     `BASH_FUNC_env%%` function first — and the forged function ignores every `-u`, which was
  //     the whole sanitization. `command env` is no better (functions outrank builtins). bash
  //     refuses to IMPORT a function whose name contains `/`, which is what the absolute path buys.
  //     It buys exactly that and no more — round 64 measured a slashed name being DEFINED rather
  //     than imported (`function /usr/bin/env { …; }` in a sourced `$BASH_ENV` file), and both bash
  //     3.2 and zsh 5.9 then resolved `/usr/bin/env` to the function and ran no child. So the
  //     prefix closes the environment channel; the startup-file channel is closed by Phase 0 step
  //     0a, which refuses on the set-ness of `BASH_ENV`/`ENV` before anything is read.
  //   * a bare `git` acts on whatever repository an ambient GIT_DIR names. Normalizing only the
  //     push made the approval and the push describe two different repositories: branch `main` at
  //     4d01381e was approved while `main` at 2692ede5 would have been pushed, comparison green.
  // "this line runs git", independent of whether it carries the prefix — the prefix is what the
  // filter below tests for, so folding it into the predicate would make the guard tautological.
  // `^\s*` and not `^`: an indented command is still a command, and without the leading \s* the
  // filter silently skipped every git line inside an if/for body — the positive control below is
  // what surfaced that, which is the whole reason it is here.
  // Round 60 added the `if ! ` alternative. Three commands gained failure guards that round, and
  // without this they stopped being audited altogether — the filter silently skipped them, which
  // is the same blindness `^\s*` was added to fix, arriving through a different door.
  const isCommand = (l) => /(^\s*if ! |^\s*|\$\(|\|\s*|&&\s*|;\s*|=\$\()(\/usr\/bin\/env .*? )?git /.test(l)
    && !/^\s*(\||>|#|[-*]|\d+\.)/.test(l);
  const bare = readSkill().split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => isCommand(line) && !line.includes(GIT_PREFIX));
  assert.deepEqual(bare.map(({ n }) => n), [],
    'every git command must run behind the canonical prefix:\n'
    + bare.map(({ line, n }) => `  ${n}: ${line.slice(0, 110)}`).join('\n'));

  // Both directions (rules/testing.md § Guards). Without the negative case the filter could match
  // nothing and pass vacuously; without the positive one a filter that matched everything would
  // pass too, and the table row proves it is not simply "any line mentioning git".
  const bareLine = 'git tag -f "backup/pr-1" "refs/remotes/origin/x"';
  assert.ok(isCommand(bareLine) && !bareLine.includes(GIT_PREFIX),
    'a bare git command must be recognized, and must count as missing the prefix');
  const goodLine = `  ${GIT_PREFIX}git tag -f "backup/pr-1" "refs/remotes/origin/x"`;
  assert.ok(isCommand(goodLine) && goodLine.includes(GIT_PREFIX),
    'a prefixed git command must be recognized, and must count as carrying the prefix');
  // Round 60's control: a guarded command is still a command. Without this alternative the three
  // `if ! …` sites would be exempt from the prefix rule while looking exactly like compliance.
  const guardedBare = 'if ! git switch -C "$head" "refs/remotes/origin/$head"; then';
  assert.ok(isCommand(guardedBare) && !guardedBare.includes(GIT_PREFIX),
    'a bare git command behind `if !` must still be recognized and still count as missing the prefix');
  assert.ok(isCommand(`if ! ${GIT_PREFIX}git switch -C "$head" "x"; then`),
    'and the guarded prefixed form must be recognized, or the check above would flag every guard');
  assert.ok(!isCommand('| Phase 3 verify | \`git log\` | none | No (read-only) |'),
    'a table cell naming git is not a command and must not be judged as one');
});

const SKILL_DIGEST = "7e4e18262ee626c933159afd51ad11e38f2f0cec3f09118b2e04e55f838ed2aa";

test('the skill document when read → matches its pinned digest', () => {
  assert.equal(createHash('sha256').update(readSkill()).digest('hex'), SKILL_DIGEST,
    'skills/epic-merge/SKILL.md changed. This document is one of three that carry an Anchor '
    + 'Register #4 grant, so the change is meant to be read: confirm no step, table row or code '
    + 'fence now has Claude execute a git/gh form outside `git rebase --onto`, '
    + '`git push --force-with-lease` and `gh pr merge --squash`, and that every destructive step '
    + 'still carries its own AskUserQuestion. Then update SKILL_DIGEST in the same commit.\n'
    + '  node -e "const{createHash}=require(\'crypto\');console.log(createHash(\'sha256\')'
    + '.update(require(\'fs\').readFileSync(\'skills/epic-merge/SKILL.md\',\'utf8\')'
    + '.replace(/\\r\\n/g,\'\\n\')).digest(\'hex\'))"');
});

test('the digest when an authorization moves outside the pinned surfaces → reports it', () => {
  // Round 19's three evasions, verbatim. Each leaves the form set and both section pins intact.
  const skill = readSkill();
  const evasions = {
    'the executable rebase swapped for an ungranted form': (t) => t.replace(
      'git rebase --onto "refs/remotes/origin/$epic" "refs/tags/backup/pr-<prev>" -- "$head"',
      'git rebase --continue'),
    'a new section granting Claude the developer-only form': (t) => t.replace(
      '## Rollback', '## Recovery\n\nOn a stalled rebase Claude runs `git rebase --continue`.\n\n## Rollback'),
    // Anchored on the Phase 2 command, not on the bare flag. `--squash` occurs six times in this
    // document and the *first* is the pinned grant statement, so `t.replace('--squash', …)` mutated
    // the sentence describing the authorization instead of the command that executes it — a
    // different fixture than the label claims, and the one this evasion is not about.
    'the squash merge swapped for an admin merge': (t) => t.replace(
      'gh pr merge "<N>" --squash', 'gh pr merge "<N>" --admin'),
  };
  // Rounds 18–21 defeated the fenced-command scanner that used to stand here, once per round, each
  // time with a push spelled so the literal-name match missed it. Those spellings are what the
  // digest is *for*, and the claim is worth an assertion rather than a paragraph: each of these
  // executes a force-push, each leaves `pushCommandLines()` reporting the same pinned pair, and
  // each must still be reported by something. Measured — every one of them fails exactly the
  // digest test, whose message sends the reader to the diff.
  for (const form of [
    'env "$cmd" push --force origin x',   // a wrapper command
    'git  push --force origin x',          // a doubled space
    '"git" push --force origin x',         // a quoted command name
    'git $\'push\' --force origin x',      // an ANSI-C quoted subcommand
  ]) {
    evasions[`a third push spelled as: ${form}`] = (t) =>
      t.replace('## Rollback', `\`\`\`bash\n${form}\n\`\`\`\n\n## Rollback`);
  }
  for (const [label, mutate] of Object.entries(evasions)) {
    const mutated = mutate(skill);
    assert.notEqual(mutated, skill, `the fixture must actually differ from the skill: ${label}`);
    assert.ok(mutated.includes('`gh pr merge --squash`'),
      `the fixture must leave the pinned grant statement alone, or it is not testing the reach-around: ${label}`);
    assert.notEqual(createHash('sha256').update(mutated).digest('hex'), SKILL_DIGEST,
      `authorization moved and the digest did not notice: ${label}`);
  }
});

test('the rollback force-push → carries an approval of its own', () => {
  // Round 19: `--per-step` promised a question before each push, and the rollback path executed a
  // second force-push under the Step 5 answer — a different rewrite of the same ref, sometimes
  // reached before any push question was asked. Register #4's grant is per-use; one use is one
  // approval. The rationale that first justified this test — "`/epic-merge` rejects protected
  // heads, so the opt-in hook never prompts on this push" — went stale on 2026-08-21 and is kept
  // here corrected rather than deleted, because the assertion survived its own reason: the
  // unshared attestation added that day asks about any push that **rewrites history**, and a
  // rollback rewinds a ref, so a gated repo now prompts on this push whether the head is protected
  // or not. The conclusion is unchanged and reached the other way round — where the hook is
  // installed the AskUserQuestion is advisory beside a terminal gate, and where it is not there is
  // no second credential at all, so in neither case may this question be skipped.
  const rollback = sectionOf(readSkill(), '## Rollback');
  assert.match(rollback, /carries its own AskUserQuestion — it is never covered by an earlier one/,
    'the rollback section must state that its push is separately approved');
  assert.match(rollback, /Rollback: force-push <head> to <PUSH_URLS_SAFE> back to backup\/pr-<N> with --force-with-lease\?/,
    'the rollback question must be spelled out, or "ask first" is a claim with no wording behind it');
  // **The question must name the force form**, per `rules/git-workflow.md` § Push safety: "a plan
  // that shows a plain push while a lease-force runs is not an approval of what happens". A generic
  // "force-push" cannot distinguish the permitted `--force-with-lease` from the forbidden bare
  // `--force`, so an operator answering it has not approved the operation that runs.
  // Negative control, so this is not green only on the day it lands: strip the form and the pin
  // above must go red rather than accept the generic wording.
  // The anchor must be unique to the rollback question: this section also *quotes* the Step 5
  // question, which carries the same ` with --force-with-lease?` suffix, and a `String.replace` on
  // that suffix alone mutates the Step 5 quote instead — a substitution that applied, to the wrong
  // occurrence, which looks exactly like a surviving mutant.
  const anchor = 'back to backup/pr-<N> with --force-with-lease?';
  assert.equal(rollback.split(anchor).length - 1, 1, 'precondition: the anchor is unique to the rollback question');
  const generic = rollback.replace(anchor, 'back to backup/pr-<N>?');
  assert.notEqual(generic, rollback, 'fixture stale — the rollback question no longer names the form');
  assert.doesNotMatch(generic, /Rollback: force-push <head> to <PUSH_URLS_SAFE> back to backup\/pr-<N> with --force-with-lease\?/,
    'the generic wording must not satisfy the force-form requirement');
  assert.match(rollback, /Stop and leave the remote as it is/,
    'declining must be an option; a question with one answer is not an approval');
  // Order matters as much as presence: the question is useless below the command it authorizes.
  const rollbackLines = rollback.split('\n');
  const pushLine = rollbackLines.findIndex((l) => l === CANONICAL_PUSH);
  assert.notEqual(pushLine, -1, 'precondition: the rollback section issues the pinned push');
  const askLine = rollbackLines.findIndex((l) => l.includes('Rollback: force-push'));
  assert.ok(askLine !== -1 && pushLine !== -1 && askLine < pushLine,
    'the approval must be asked before the push it authorizes');
});

// ── The first PR's base is the one link the linearity check cannot reach ──────
// "A PR's base is not the previous PR's head" relates each PR to its predecessor,
// so PR 1 — which has no predecessor — is never checked at all. The chain table
// *displays* `epic/xxx` in row 1's Base column, and a displayed value is not an
// asserted one. Iteration 1 then runs `gh pr merge <first-PR> --squash`, which
// merges into that PR's own base whatever it happens to be, so a drifted first
// base silently mutates a different branch while every later step proceeds as if
// <epic-branch> had received the commits.
// Both directions ship together (rules/testing.md § Guards): the invariant must
// be stated, AND the linearity rule that cannot substitute for it must still be
// present — otherwise a future edit could delete the linearity check and leave
// this file green.
test('epic-merge validation gate → the first PR base invariant is stated separately from the linearity check', () => {
  // Arrange
  const skill = readSkill();
  const gateStart = skill.indexOf('**Validation gate** — abort if any of:');
  assert.notEqual(gateStart, -1, 'precondition: the Phase 0 validation gate exists');
  const gate = skill.slice(gateStart, skill.indexOf('### Phase 1', gateStart));
  assert.ok(gate.length > 0, 'precondition: the gate section is bounded by Phase 1');

  // Act / Assert — the invariant itself
  assert.match(gate, /The first PR's base is not `<epic-branch>`/,
    'the first PR base invariant must be an abort condition, not left to the chain table display');
  assert.match(gate, /gh pr view "\$first" --json baseRefName -q \.baseRefName/,
    'the invariant must name the executable comparison, not just the requirement');
  assert.match(gate, /before Phase 1 backups/,
    'the abort must precede the first write; aborting after backups still mutated state');

  // The linearity rule must survive — it covers PRs 2..N, which this invariant does not
  assert.match(gate, /A PR's base is not the previous PR's head \(chain not linear\)/,
    'the linearity check still owns PRs 2..N; the first-base invariant does not replace it');

  // Negative control: delete the invariant and the pin above must go red. Without
  // this, the assertions are green on the day they land and cannot see a removal.
  const anchor = "The first PR's base is not `<epic-branch>`";
  assert.equal(gate.split(anchor).length - 1, 1, 'precondition: the invariant is stated exactly once');
  const stripped = gate.replace(anchor, "A PR's base is not the previous PR's head");
  assert.notEqual(stripped, gate, 'fixture stale — the invariant sentence no longer reads as pinned');
  assert.doesNotMatch(stripped, /The first PR's base is not `<epic-branch>`/,
    'collapsing the invariant into the linearity rule must not satisfy this guard');
});

test('every rebase destination names a remote-tracking ref, refreshed before use', () => {
  // `refs/heads/<epic>` and `refs/remotes/origin/<epic>` are different refs, and resume is the
  // path where the difference is worst: nothing in the resume steps creates the local branch,
  // so it is stale whenever the developer has not pulled and absent whenever they never checked
  // the epic out — resume commonly runs in a fresh clone after an interruption. Measured in this
  // repository while writing this test: `refs/heads/main` was one commit ahead of
  // `refs/remotes/origin/main`. The manifest check downstream cannot catch it, because
  // `origin/$epic..$head` can carry exactly the expected subjects over a stale ancestor.
  const skill = readSkill();

  const rebases = skill.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    // Command lines only — anchored at line start. Prose and table cells naming the form (the
    // Anchor grant statement, the safety table, the approval-prompt row) are not commands and
    // must not be judged as though they were.
    // The guard prefix is optional and may carry a condition: round 60 put the iteration rebase
    // behind `if ! `, and round 66 put the resume rebase behind `if [[ -n "$RESUME_OK" ]] && ! ` so
    // a failed refresh cannot reach it. A guarded rebase is still a rebase, and dropping either
    // form here would quietly halve what this test examines.
    .filter(({ line }) => /^\s*(if (\[\[ [^\]]*\]\] && )?! )?(\/usr\/bin\/env .*? )?git rebase --onto\s/
      .test(line));
  assert.ok(rebases.length >= 2, 'both the ordinary iteration and resume must still be present');

  for (const { line, n } of rebases) {
    const onto = line.match(/git rebase --onto\s+"([^"]+)"/);
    assert.ok(onto, `line ${n}: the --onto destination must be a quoted ref`);
    assert.match(onto[1], /^(origin\/|refs\/remotes\/origin\/)/,
      `line ${n}: the destination must be a remote-tracking ref — the previous PR was squash-merged `
      + 'into the REMOTE epic, so a local branch is a different and possibly stale commit');
  }

  // Negative control: reverting either site to the local branch must turn this red.
  assert.doesNotMatch(skill, /git rebase --onto\s+"refs\/heads\//,
    'a rebase onto refs/heads/<epic> is the defect this test exists for');

  // And the resume site must refresh the ref it is about to rebase onto — reading a stale
  // remote-tracking ref is the same failure one indirection removed.
  const resume = skill.slice(skill.indexOf('Cut the first remaining PR over to the epic yourself'));
  const fetchAt = resume.indexOf('git fetch --upload-pack=git-upload-pack "origin" -- "+refs/heads/${epic}:refs/remotes/origin/${epic}"');
  const rebaseAt = resume.indexOf('git rebase --onto');
  assert.ok(fetchAt !== -1, 'resume must refresh the epic ref before rebasing onto it');
  assert.ok(fetchAt < rebaseAt, 'and the refresh must come first — refreshing afterwards refreshes nothing');
});

// ── round-31: the unshared question on every push path ──────────────────────
// The attestation landed in the `--per-step` gate table only, and `--per-step` is the
// opt-in mode. The DEFAULT bundled gate asked one generic "Proceed…" and the rollback
// asked only "Rollback: force-push…?" — neither mentions sharedness, so the default path
// force-pushed without the evidence `rules/git-workflow.md` § Push safety obliges this
// skill to collect. This file passed 21/21 throughout, because every test it had asked
// about the mode that was already correct.
const UNSHARED_Q = /Is anybody else working on <head>\?/;

for (const [label, heading] of [
  ['bundled (the default mode)', '### Iteration Gate Design'],
  ['rollback', '## Rollback'],
]) {
  test(`the ${label} push → asks the unshared question, by name and first`, () => {
    const section = sectionOf(readSkill(), heading);
    assert.match(section, UNSHARED_Q,
      `${label} must ask about sharedness in its own words — a force-form approval collects approval, not evidence`);

    const lines = section.split('\n');
    const askUnshared = lines.findIndex((l) => UNSHARED_Q.test(l));
    const askProceed = lines.findIndex((l, i) => i > 0
      && /Proceed with PR #<N>|Rollback: force-push <head>/.test(l));
    assert.notEqual(askProceed, -1, `precondition: ${label} still has its force-form approval`);
    assert.ok(askUnshared < askProceed,
      `the unshared question must come FIRST (got unshared at ${askUnshared}, approval at ${askProceed}) — asked after, it can only ratify a decision already taken`);

    // Declining must abort, not fall through. A question whose "no" continues anyway is a
    // notice, and this one is supposed to be evidence.
    assert.match(section, /Someone else might/,
      `${label} must offer the refusing answer`);
  });
}

test('the gate-count table counts the unshared question in bundled mode', () => {
  // The table is what a reader consults to know how many prompts to expect, and it said 1.
  // Left at 1 it would document the exact omission the tests above now forbid.
  const section = sectionOf(readSkill(), '### Iteration Gate Design');
  const row = section.split('\n').find((l) => l.startsWith('| Bundled (default) |'));
  assert.ok(row, 'precondition: the bundled row is still a table row');
  // The count must LEAD with 2. A lower number is lawful only as an explicit topology condition
  // (round 41: the unshared question is not owed when the iteration rewrites nothing), never as
  // the bare count — bare, it documents the folding the tests above forbid.
  assert.match(row, /\| 2(\s*\([^)]*rewritten[^)]*\))? \|/,
    'bundled is two gates — the unshared question and the bundled proceed — and any smaller number '
    + `must be written as a condition on what is rewritten, got: ${row}`);

  // Both directions. Without the negative case the pattern above could be satisfied by a row that
  // silently dropped back to one gate with a vague parenthetical.
  const oneGate = (r) => /\| 2(\s*\([^)]*rewritten[^)]*\))? \|/.test(r);
  assert.ok(!oneGate('| Bundled (default) | 1 | one bundled gate |'),
    'a bare count of 1 must still fail — that is the folded shape this test exists to catch');
  assert.ok(!oneGate('| Bundled (default) | 1 (2 sometimes) | x |'),
    'and a conditional that leads with 1 is the same omission wearing a parenthesis');
  assert.ok(oneGate('| Bundled (default) | 2 (1 when nothing is rewritten) | x |'),
    'while the measured-topology exception must remain expressible');
});

test('the unshared question is NOT folded into the force-form approval', () => {
  // The negative control for the three above. Merging the two questions would satisfy
  // "the section mentions sharedness" while destroying the property that made it evidence:
  // an operator who is asked one question answers one thing.
  const skill = readSkill();
  const merged = skill.split('\n').filter((l) =>
    /Proceed with PR #<N>|Rollback: force-push <head> back/.test(l) && UNSHARED_Q.test(l));
  assert.deepEqual(merged, [],
    'no approval question may also carry the sharedness question — separate questions, separate answers');
});

// ── The two topology probes, exercised rather than only read ──────────────────
// Round 42: `rg 'REMOTE_TIP' test/skills/epic-merge.test.js` printed nothing — both probes decide
// whether the unshared question is asked, and neither branch had a test. The three readings they
// must keep apart (lookup failed / branch absent / tip found) were, until this round, TWO readings:
// `ls-remote … | awk` reports the pipeline's LAST status, so a failed lookup exited 0 with an empty
// tip — byte-identical to "the branch does not exist yet", which is a no-ask row.
function probeFence(marker) {
  const blocks = readSkill().split(/^```.*$/m).filter((_, i) => i % 2 === 1);
  const hits = blocks.filter((b) => b.includes('if REMOTE_LS=') && b.includes(marker));
  assert.equal(hits.length, 1,
    `expected exactly one REMOTE_LS fence containing ${marker}, found ${hits.length}`);
  return hits[0].trim();
}

// Every git call is faked, and anything the fence reaches beyond the three below exits 99 loudly:
// a probe that silently grew a fourth lookup must not pass by having it answered.
const EM_PUSH_URL = 'https://push.example/epic.git';
const EM_REV = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
function runEpicProbe(fence, { lsExit = 0, lsOut = '', ancestorExit = 0,
  pushUrls = [EM_PUSH_URL], getUrlExit = 0, backupExit = 0,
  head = 'feat/pr-3', epic = 'epic/x', prNumber = '3',
  reprobeUrl = null, reprobeExit = 0 }) {
  const dir = require('node:fs').mkdtempSync(resolve(require('node:os').tmpdir(), 'em-probe-'));
  try {
    const bin = resolve(dir, 'bin');
    require('node:fs').mkdirSync(bin);
    const argLog = resolve(dir, 'args');
    const envLog = resolve(dir, 'env');
    require('node:fs').writeFileSync(resolve(bin, 'git'), [
      '#!/bin/sh',
      'case "$1" in',
      // `remote get-url --push --all` is the destination oracle: it returned exactly what push
      // contacted under both an explicit `pushurl` and a `pushInsteadOf` rewrite (measured,
      // git 2.55.0), where `ls-remote --get-url` returned the fetch URL in both.
      `  remote) printf '%s' "$FAKE_PUSH_URLS"; exit "$FAKE_GETURL_EXIT" ;;`,
      // Round 76. `--get-url` is answered first and logged under its OWN prefix: it expands the URL
      // locally and contacts nothing, so it is not one of the `ls-remote ` calls the counts below
      // judge. Default is the unchained answer — the URL comes back unchanged; `FAKE_REPROBE_URL`
      // is the chained case, `url.<C>.insteadOf <B>` rewriting a second time (measured 2026-08-22).
      `  ls-remote) case "$2" in --get-url) printf '%s\n' "geturl $*" >>"$ARG_LOG"; printf '%s\n' "\${FAKE_REPROBE_URL-$4}"; exit "\${FAKE_REPROBE_EXIT-0}" ;; esac; printf '%s\n' "ls-remote $*" >>"$ARG_LOG"; printf '%s' "$FAKE_LS_OUT"; exit "$FAKE_LS_EXIT" ;;`,
      // `rev-parse` can REFUSE the backup ref, because a missing `backup/pr-<N>` is a real state
      // with its own reading — and because the rollback fence's `--verify … || BACKUP=` exists
      // precisely for it. A fake that always answers cannot exercise either.
      '  rev-parse)',
      `    printf '%s\n' "rev-parse $*" >>"$ARG_LOG"`,
      '    for a in "$@"; do :; done',
      '    case "$a" in',
      '      *backup/pr-*) [ "$FAKE_BACKUP_EXIT" = 0 ] || exit "$FAKE_BACKUP_EXIT" ;;',
      '    esac',
      `    echo '${EM_REV}'; exit 0 ;;`,
      // The environment is recorded alongside the arguments, and that is the point of the row
      // rather than bookkeeping: a probe that parses the tip correctly and then asks about a
      // DIFFERENT commit graph passes every argument-shaped assertion. Replacement refs rewrite
      // ancestry transparently, so an `--is-ancestor` without `GIT_NO_REPLACE_OBJECTS=1` can answer
      // "fast-forward" about a graph the push — which sets the guard — never sends.
      `  merge-base) printf '%s\\n' "$*" >>"$ARG_LOG"; printf 'NRO=<%s>\\n' "$GIT_NO_REPLACE_OBJECTS" >>"$ENV_LOG"; exit "$FAKE_ANCESTOR_EXIT" ;;`,
      'esac',
      'echo "unexpected git call: $*" >&2; exit 99',
    ].join('\n') + '\n');
    require('node:fs').chmodSync(resolve(bin, 'git'), 0o755);

    // Round 50: the fence is run exactly as written. This helper used to append its own
    // `printf "TIP=<%s> FAILED=<%s>"`, which supplied the interface the fence was missing — every
    // value it measured died with the shell, and the table that reads them is a separate step in a
    // separate shell. A harness that hands the subject its own output cannot see that.
    // The operator substitutes the `<quoted …>` slots; the harness does the same thing, in the
    // same place, rather than exporting `head` and `epic` past a fence that does not bind them.
    // Exporting them was the harness answering a question the document left open: the shipped
    // fence reached `refs/heads/${head}` with nothing binding it in that shell.
    // `<quoted PR number>` joins the two slots the harness already substituted, and the `N: '3'`
    // this env used to export is gone with it. That export was the harness answering a question the
    // rollback fence left open: the shipped fence reached `backup/pr-${N}` with nothing binding
    // `N` in that shell, and the only reason every rollback test passed is that the harness bound
    // it from outside. Exactly the defect the comment above already described for `head`/`epic` —
    // written down, then reintroduced one fence over.
    const script = fence
      .split('<quoted head>').join(`"${head}"`)
      .split('<quoted epic>').join(`"${epic}"`)
      .split('<quoted PR number>').join(`"${prNumber}"`);
    const r = spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, ARG_LOG: argLog, ENV_LOG: envLog,
        FAKE_LS_EXIT: String(lsExit), FAKE_LS_OUT: lsOut,
        FAKE_PUSH_URLS: pushUrls.join('\n'), FAKE_GETURL_EXIT: String(getUrlExit),
        FAKE_ANCESTOR_EXIT: String(ancestorExit), FAKE_BACKUP_EXIT: String(backupExit),
        FAKE_REPROBE_EXIT: String(reprobeExit),
        ...(reprobeUrl === null ? {} : { FAKE_REPROBE_URL: reprobeUrl }),
      },
    });
    const args = existsSync(argLog) ? readFileSync(argLog, 'utf8').trim().split('\n') : [];
    const envs = existsSync(envLog) ? readFileSync(envLog, 'utf8').trim().split('\n') : [];
    const stdout = r.stdout || '';
    const field = (name) => {
      const m = stdout.match(new RegExp(`^${name}=\\[([^\\]]*)\\]$`, 'm'));
      return m ? m[1] : '<<not printed>>';
    };
    return {
      out: `TIP=<${field('REMOTE_TIP')}> FAILED=<${field('LOOKUP_FAILED')}>`,
      // The fence can now REFUSE — an unbound name is not a reading — and a refusal that is only
      // visible as a missing report line is indistinguishable from a fence that measured nothing.
      status: r.status,
      stdout,
      err: r.stderr || '',
      args,
      envs,
    };
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
}

const TIP_LINE = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\trefs/heads/feat/pr-3\n';

for (const [label, marker] of [['iteration gate', 'NEW_HEAD='], ['rollback', 'BACKUP=']]) {
  test(`the ${label} probe → keeps a failed lookup, an absent branch and a real tip apart`, () => {
    const fence = probeFence(marker);

    const failed = runEpicProbe(fence, { lsExit: 42 });
    assert.equal(failed.out, 'TIP=<> FAILED=<1>',
      `a failed ls-remote must set LOOKUP_FAILED — the fail-closed row is derived from it: ${failed.err}`);

    // The reading it used to be indistinguishable from. Without it, a probe that reports failure
    // unconditionally satisfies the assertion above.
    const absent = runEpicProbe(fence, { lsExit: 0, lsOut: '' });
    assert.equal(absent.out, 'TIP=<> FAILED=<>',
      'a branch absent from the remote is a creation — a no-ask row, not a failure');

    const found = runEpicProbe(fence, { lsExit: 0, lsOut: TIP_LINE });
    assert.equal(found.out, 'TIP=<a1b2c3d4e5f60718293a4b5c6d7e8f9012345678> FAILED=<>',
      'the sha must be recovered from the ls-remote line by expansion alone');

    assert.equal(new Set([failed.out, absent.out, found.out]).size, 3,
      'failed / absent / found must be three outcomes, not two');

    // The tip actually reaches the ancestry test — a probe that parsed correctly and then compared
    // something else would pass every assertion above.
    assert.ok(found.args.some((a) => a.includes('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')),
      `the parsed tip must be the ref merge-base is asked about: ${JSON.stringify(found.args)}`);

    // WHICH ref was asked about, not only which sha came back. The fake answers every ref
    // identically, so a fence that asked about `refs/heads/` — the shape an unbound `${head}`
    // produces — parses the same tip and satisfies every assertion above it. That is how the
    // rollback fence reached round 72 unbound: nothing here had ever read the ref name.
    const lsCalls = found.args.filter((a) => a.startsWith('ls-remote '));
    assert.equal(lsCalls.length, 1, `exactly one remote lookup: ${JSON.stringify(found.args)}`);
    assert.ok(lsCalls[0].endsWith(' refs/heads/feat/pr-3'),
      `the lookup must name the branch this fence bound, not refs/heads/: ${lsCalls[0]}`);
    if (label === 'rollback') {
      const rp = found.args.filter((a) => a.startsWith('rev-parse '));
      assert.ok(rp.some((a) => a.includes('backup/pr-3^{commit}')),
        `the backup must be read at the bound PR number, not backup/pr-: ${JSON.stringify(rp)}`);
    }

    // And it must be asked about the SAME commit graph the push sends. `refs/replace/*` grafts
    // rewrite ancestry transparently, and the push commands set `GIT_NO_REPLACE_OBJECTS=1`; a
    // probe that does not can return "fast-forward" for a rewrite and skip the unshared question
    // entirely. The env, not just the args, is what makes the two agree.
    assert.ok(found.envs.length > 0, 'precondition: the fence still runs an ancestry test');
    assert.deepEqual([...new Set(found.envs)], ['NRO=<1>'],
      `every ancestry test must run with GIT_NO_REPLACE_OBJECTS=1: ${JSON.stringify(found.envs)}`);
  });

  // Round 53. The tables above pick a row from a word the fence derives, and this is what makes
  // that claim checkable. Before it, both fences ran `merge-base --is-ancestor "$REMOTE_TIP" …`
  // unconditionally: an empty tip made it exit 128, so one run satisfied two rows at once — "the
  // topology is unknown, ask" and "the branch is not on the remote, do not ask" — and which one
  // applied was left to whoever read the table. The old tests never noticed, because they read
  // `REMOTE_TIP` and `LOOKUP_FAILED` and stopped one step short of the decision those two feed.
  const READINGS = {
    'iteration gate': { field: 'ITER_READING', absent: 'creation', same: 'up-to-date' },
    rollback: { field: 'ROLLBACK_READING', absent: 'head-deleted', same: 'no-op' },
  }[label];
  const readingOf = (fence, opts) => {
    const r = runEpicProbe(fence, opts);
    const m = r.stdout.match(new RegExp(`^${READINGS.field}=\\[([^\\]]*)\\]$`, 'm'));
    return { reading: m ? m[1] : `<<not printed>> ${r.err}`, args: r.args };
  };
  const SAME_LINE = `${EM_REV}\trefs/heads/feat/pr-3\n`;

  test(`the ${label} reading → one word per topology, and no input answering to two rows`, () => {
    const fence = probeFence(marker);
    const cases = [
      ['lookup failed', { lsExit: 42 }, 'unknown'],
      ['branch not on the remote', { lsExit: 0, lsOut: '' }, READINGS.absent],
      ['remote already holds it', { lsOut: SAME_LINE }, READINGS.same],
      ['contained in what replaces it', { lsOut: TIP_LINE, ancestorExit: 0 }, 'fast-forward'],
      ['ancestry answered no', { lsOut: TIP_LINE, ancestorExit: 1 }, 'rewrite'],
      ['ancestry errored', { lsOut: TIP_LINE, ancestorExit: 128 }, 'unknown'],
    ];
    for (const [why, opts, expected] of cases) {
      assert.equal(readingOf(fence, opts).reading, expected, `${why} → ${expected}`);
    }

    // Five distinct words over six inputs: `unknown` is reached twice on purpose (no answer, and
    // an answer that errored), and everything else must stay separable. A fence that collapsed
    // two topologies into one word would still pass the per-case assertions above if the expected
    // value happened to match; this is what refuses that.
    assert.equal(new Set(cases.map(([, o]) => readingOf(fence, o).reading)).size, 5,
      'the six inputs must produce five readings, not fewer');

    // And the guard is a guard, not a comment: with no tip to compare, the ancestry test must not
    // run at all. The iteration fence also runs the BUNDLED ancestry test, which is a different
    // question about two remote-tracking refs — so what must be absent is an `--is-ancestor` that
    // is NOT that one.
    const absent = readingOf(fence, { lsExit: 0, lsOut: '' });
    assert.deepEqual(
      absent.args.filter((a) => a.startsWith('--is-ancestor') && !a.includes('refs/remotes/origin/')),
      [],
      `an empty tip must reach no ancestry test: ${JSON.stringify(absent.args)}`);
  });

  test(`the ${label} reading when the resolved URL is rewritten again → unknown, and nothing is asked`, () => {
    // Measured 2026-08-22 (git 2.55.0): with `url.<B>.insteadOf=<A>` and `url.<C>.insteadOf=<B>`
    // the push lands in B while `git ls-remote -- "<B>"` answers **C's** tip — git applies the
    // rewrite table again to the string it is handed. This reading is what decides whether the
    // unshared question is asked at all, so a tip from the wrong repository does not merely
    // mismeasure: it can classify a rewrite as a fast-forward and skip the question entirely.
    const fence = probeFence(marker);
    const chained = readingOf(fence, { lsOut: TIP_LINE, ancestorExit: 0,
      reprobeUrl: 'https://push.example/c.git' });
    assert.equal(chained.reading, 'unknown',
      'a URL rewritten a second time must read as unknown, never as the topology of the other repository');
    assert.deepEqual(chained.args.filter((a) => a.startsWith('ls-remote ')), [],
      `and no tip may be read at all: ${JSON.stringify(chained.args)}`);

    // Silence is not evidence that the URL survived unchanged.
    assert.equal(readingOf(fence, { lsOut: TIP_LINE, ancestorExit: 0, reprobeExit: 128 }).reading,
      'unknown', 'a re-probe that cannot answer must read as unknown, not fall through');

    // Negative control: identical fixture, URL unchanged, and the ordinary reading must survive.
    // Without it a detector that answered `unknown` to everything would pass both assertions above.
    const plain = readingOf(fence, { lsOut: TIP_LINE, ancestorExit: 0,
      reprobeUrl: EM_PUSH_URL });
    assert.equal(plain.reading, 'fast-forward',
      'an unrewritten URL must still be measured, or the detector has replaced the probe');
  });

  test(`the ${label} reading when its precedence or its guard is removed → the run turns red`, () => {
    const fence = probeFence(marker);
    // The classifier's first two branches, matched by what they ASSIGN rather than by position —
    // a positional splice would silently start editing the URL-count chain earlier in the fence.
    const chain = new RegExp(
      'if (\\[[^\\n]*?); then\\n(\\s*\\w+_ANCESTRY=; \\w+_READING=unknown[^\\n]*)\\n'
      + 'elif (\\[[^\\n]*?); then\\n(\\s*\\w+_ANCESTRY=; \\w+_READING=(?:creation|head-deleted)[^\\n]*)\\n');
    assert.match(fence, chain, 'precondition: the fence still opens with unknown, then the absent-branch row');

    // Control A — swap the two branches whole. This is the historical defect exactly: emptiness
    // tested first, so a lookup that never answered reads as a branch that is simply not there,
    // and the fail-closed row becomes unreachable. Fail-closed inverted, silently.
    const swapped = fence.replace(chain, (_m, c1, b1, c2, b2) =>
      `if ${c2}; then\n${b2}\nelif ${c1}; then\n${b1}\n`);
    assert.notEqual(swapped, fence, 'the mutation must actually apply');
    assert.notEqual(readingOf(swapped, { lsExit: 42 }).reading, 'unknown',
      'testing emptiness before the lookup status must misread a failed lookup — the order is load-bearing');

    // Control B — delete the absent-tip branch, which is what forces the guarded shape. Without it
    // an empty tip falls through to `merge-base`, which exits 128 on an empty argument, and the
    // benign reading is reported as `unknown`.
    const ungated = fence.replace(chain, (_m, c1, b1) => `if ${c1}; then\n${b1}\n`);
    assert.notEqual(ungated, fence, 'the mutation must actually apply');
    assert.notEqual(readingOf(ungated, { lsExit: 0, lsOut: '' }).reading, READINGS.absent,
      'without its own branch, a branch absent from the remote cannot be told from an error');
  });

  test(`the ${label} probe → performs the lookup without a pipeline or a bare parser`, () => {
    // Comments are dropped first — TRAILING ones too, not just whole-line ones. What is being
    // judged is the shape of the shell code, and both fences deliberately describe in prose what
    // they replaced: one names the `ls-remote | awk` shape, another explains the "cut point" the
    // reading rows turn on. Filtering only `^\s*#` leaves both in view and convicts the warning of
    // being the defect it warns about. Nothing in either fence quotes a `#`, so cutting at the
    // first whitespace-preceded `#` removes comments and nothing else — a claim the negative
    // control below re-checks by routing the old shape through this same stripper.
    const strip = (t) => t.split('\n')
      .map((l) => l.replace(/(^|\s)#.*$/, ''))
      .filter((l) => l.trim());
    const code = strip(probeFence(marker));
    // Two `git ls-remote` lines since round 76, and they are different questions: the tip lookup
    // (`--upload-pack`, a network read) and the URL re-probe (`--get-url`, a purely local
    // expansion). Selecting on `git ls-remote` alone judges whichever comes first in the file —
    // the re-probe — and convicts the `||` that carries its failure of being a pipeline.
    const lookup = code.find((l) => l.includes('git ls-remote --upload-pack'));
    const reprobe = code.find((l) => l.includes('git ls-remote --get-url'));
    assert.ok(lookup, 'precondition: the fence still performs the lookup');
    assert.ok(reprobe, 'precondition: the fence still re-probes the resolved URL');
    assert.doesNotMatch(lookup, /\|/,
      'a pipeline reports its last command\'s status, which erases the failed-lookup reading');
    // The same property for the re-probe, minus the `||` that routes its failure into the
    // fail-closed arm: strip the control operator, and any surviving `|` is a real pipeline.
    assert.doesNotMatch(reprobe.split('||').join(' '), /\|/,
      'the re-probe must not be piped either — its exit status is half of what makes the reading unknown');
    assert.ok(reprobe.includes('/usr/bin/env -u BASH_ENV -u ENV -u GIT_EXEC_PATH -u GIT_DIR '),
      'the re-probe must read the same configuration the lookup and the push do');
    assert.doesNotMatch(code.join('\n'), /\bawk\b|\bcut\b|\bsed\b/,
      'the field split must be a parameter expansion — an imported function can answer a parser');

    // Negative control: the shape this replaced must still be recognisable AFTER stripping. Routing
    // it through the same stripper is the part that matters — a stripper that ate code rather than
    // comments would pass the assertions above by deleting the evidence, and a control tested on the
    // raw string could not tell the two apart.
    const old = strip("REMOTE_TIP=$(git ls-remote origin \"refs/heads/${head}\" | awk '{print $1}')").join('\n');
    assert.match(old, /\|/, 'the old shape was a pipeline — the check above must be able to see it');
    assert.match(old, /\bawk\b/, 'the old shape used awk — the check above must be able to see it');

    // And the stripper must not be a no-op that only looks like one here: a trailing comment
    // carrying a banned word is exactly the case that produced this rewrite.
    assert.doesNotMatch(strip('X=1   # split it with awk later').join('\n'), /\bawk\b/,
      'a trailing comment must be stripped, or prose re-enters the code-shape judgment');
  });
}

// --- The bundled-mode reading, exercised as a classifier rather than read as prose -------------
//
// `BUNDLED_READING` decides whether the unshared question is asked at all, so its three values are
// a security boundary, not bookkeeping. Every assertion above this point judges the fence's SHAPE;
// none of them runs it against a graph where the cut point and the destination differ, because the
// shared fake answers every `rev-parse` with one sha. That is exactly the input the `CUT = DEST`
// predicate exists for — so the predicate could be deleted with the whole file still green.
//
// Ancestry alone never answered the question the gate asks. `rebase --onto <dest> <cut> <head>`
// replays `cut..head`; the commits keep their object IDs only when they were already parented on
// the destination, i.e. when the cut point IS the destination. Ancestry says whether the
// destination is contained — a strictly weaker fact, true for every rebase that will rewrite.
// Round 54: `lookupFails` exists because this harness silently forced it on every case. The fake
// below had no `remote` arm, so `git remote get-url --push --all origin` exited 99, the fence read
// "not exactly one URL" and set `LOOKUP_FAILED=1` — for all seven inputs, including the one pinned
// as `no-rewrite`. The fixture was therefore a positive pin on the contradiction between the code
// and its own reading table, which is worse than no coverage: it holds the defect in place.
function runBundledClassifier(fence, { ancestorExit = 0, cut = 'aaaa', dest = 'aaaa',
  lookupFails = false, extraEnv = {}, expectStateLost = false } = {}) {
  const dir = require('node:fs').mkdtempSync(resolve(require('node:os').tmpdir(), 'em-class-'));
  try {
    const bin = resolve(dir, 'bin');
    require('node:fs').mkdirSync(bin);
    // A `rev-parse` that answers per-ref, and can refuse: an empty CUT or DEST is a real state
    // (a deleted backup ref, an unfetched epic) and its own row in the reading table.
    require('node:fs').writeFileSync(resolve(bin, 'git'), [
      '#!/bin/sh',
      'case "$1" in',
      // The push destination resolves unless the case asks otherwise. Its absence is what made
      // every case here run with LOOKUP_FAILED=1 without saying so.
      // `case` throughout, never `[ … ]`. `/bin/sh` on macOS is bash in posix mode and imports
      // `BASH_FUNC_[%%` exactly as bash does, so under the hostile-environment test below a
      // bracket-testing fake would answer nothing and the fence would refuse for the fixture's
      // reasons instead of its own — a broken double reported as a working guard.
      `  remote) case "$FAKE_LOOKUP_FAILS" in 1) exit 1 ;; esac; printf '%s' "$FAKE_PUSH_URL"; exit 0 ;;`,
      // Round 76: the local URL re-probe, answered ahead of the tip. See the fake above for why
      // the two questions cannot share one answer.
      `  ls-remote) case "$2" in --get-url) printf '%s\n' "\${FAKE_REPROBE_URL-$4}"; exit "\${FAKE_REPROBE_EXIT-0}" ;; esac; printf '%s' "$FAKE_LS_OUT"; exit 0 ;;`,
      '  rev-parse)',
      '    for a in "$@"; do :; done',
      '    case "$a" in',
      '      *backup/pr-*) case "$FAKE_CUT" in "") exit 1 ;; esac; echo "$FAKE_CUT"; exit 0 ;;',
      '      *refs/remotes/origin/*) case "$FAKE_DEST" in "") exit 1 ;; esac; echo "$FAKE_DEST"; exit 0 ;;',
      '    esac',
      "    echo 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'; exit 0 ;;",
      '  merge-base) exit "$FAKE_ANCESTOR_EXIT" ;;',
      'esac',
      'echo "unexpected git call: $*" >&2; exit 99',
    ].join('\n') + '\n');
    require('node:fs').chmodSync(resolve(bin, 'git'), 0o755);

    // Round 52: the fence runs as written. Appending `printf "READING=<%s>"` here was the test
    // handing the subject an output interface it did not have — the reading would have been
    // measured, assigned, and then lost with the shell, and this harness could not have noticed.
    // Same substitution the operator performs, and for the same reason as in runEpicProbe: the
    // fence binds its own names now, so exporting them past it would test a shell the document
    // does not describe.
    const bound = fence
      .split('<quoted head>').join('"feat/pr-3"')
      .split('<quoted epic>').join('"epic/x"');
    const r = spawnSync('/bin/bash', ['-c', bound], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`,
        N: '3',
        FAKE_LS_OUT: TIP_LINE, FAKE_PUSH_URL: EM_PUSH_URL,
        FAKE_LOOKUP_FAILS: lookupFails ? '1' : '0',
        FAKE_ANCESTOR_EXIT: String(ancestorExit), FAKE_CUT: cut, FAKE_DEST: dest,
        ...extraEnv,
      },
    });
    const m = /^BUNDLED_READING=\[([^\]]*)\]$/m.exec(r.stdout || '');
    assert.ok(m, `the fence must report BUNDLED_READING itself: ${r.stderr || r.stdout}`);
    // The harness must control the state it claims to control: every case above is written as if
    // the destination resolved, and the whole defect this parameter records was that it did not.
    // `expectStateLost` is for the deliberately-broken fences a negative control runs: when the
    // predicate that RECORDS this state is itself the thing being disabled, the check below is
    // asserting the mutation failed to apply. It is opt-in and named, so an ordinary case cannot
    // acquire it by accident — the check stays mandatory everywhere the fence is meant to work.
    if (!expectStateLost) {
      assert.match(r.stdout, new RegExp(`^LOOKUP_FAILED=\\[${lookupFails ? '1' : ''}\\]$`, 'm'),
        `the case asked for lookupFails=${lookupFails}; the fence measured otherwise: ${r.stdout}`);
    }
    // The derivation collapses two different measurements into `unknown`, so the raw ancestry
    // has to travel beside the conclusion or the operator cannot tell which one happened.
    assert.match(r.stdout, /^BUNDLED_ANCESTRY=\[\d+\]$/m,
      `and must report the ancestry it derived that from: ${r.stdout}`);
    return m[1];
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
}

const BUNDLED_CASES = [
  ['ancestry 0 and the cut point IS the destination', { ancestorExit: 0, cut: 'aaaa', dest: 'aaaa' }, 'no-rewrite'],
  ['ancestry 0 but the cut point is behind it', { ancestorExit: 0, cut: 'bbbb', dest: 'aaaa' }, 'rewrite'],
  ['ancestry 1 — the destination is not contained', { ancestorExit: 1, cut: 'aaaa', dest: 'aaaa' }, 'rewrite'],
  ['ancestry 2 — merge-base errored, no answer', { ancestorExit: 2, cut: 'aaaa', dest: 'aaaa' }, 'unknown'],
  ['ancestry 128 — the graph was unreadable', { ancestorExit: 128, cut: 'aaaa', dest: 'aaaa' }, 'unknown'],
  ['the backup ref is gone', { ancestorExit: 0, cut: '', dest: 'aaaa' }, 'unknown'],
  ['the epic ref is unfetched', { ancestorExit: 0, cut: 'aaaa', dest: '' }, 'unknown'],
  // The row the old fixture pinned backwards. Every other predicate here reads a LOCAL ref, so
  // all of them can succeed while the push destination was never reached — and a `no-rewrite`
  // published on that basis is a prediction about a repository nothing looked at.
  ['the push destination never resolved', { ancestorExit: 0, cut: 'aaaa', dest: 'aaaa', lookupFails: true }, 'unknown'],
];

test('the bundled reading → classifies every ancestry × cut-point combination', () => {
  const fence = probeFence('NEW_HEAD=');
  for (const [label, input, expected] of BUNDLED_CASES) {
    assert.equal(runBundledClassifier(fence, input), expected, `${label} → ${expected}`);
  }

  // Only ONE combination may skip the unshared question. Stating it as a count catches a future
  // row that silently widens the silent path, which comparing values one at a time would not.
  const silent = BUNDLED_CASES.filter(([, , r]) => r === 'no-rewrite');
  assert.equal(silent.length, 1, 'exactly one input may read as no-rewrite — the rest must ask');
});

test('the bundled reading when an imported function outranks the `[` builtin → it still fails closed', () => {
  // `[` is a builtin, so a function exported into the environment under that name outranks it and
  // answers every `[ … ]` for the caller. Measured 2026-08-22 on bash 5.3 and /bin/bash 3.2:
  // `env 'BASH_FUNC_[%%=() { return 1; }' bash -c 'type -t "["'` prints `function`. The fence's
  // predicates are written with `[[` — a reserved word — and its exit-status readings with `case`,
  // which is why they survive this. Run it rather than assert the spelling: only a run can tell an
  // immune construct from one that happens to agree today.
  const hostile = { 'BASH_FUNC_[%%': '() { return 1; }' };
  const probe = spawnSync('/bin/bash', ['-c', 'type -t "["'],
    { env: { ...process.env, ...hostile }, encoding: 'utf8' });
  assert.equal(probe.stdout.trim(), 'function',
    'precondition: this bash must import the forged `[`, or the assertions below prove nothing');

  const fence = probeFence('NEW_HEAD=');
  // A destination that never resolved. Fail-closed says `unknown` — the attestation is asked for.
  const unreached = { ancestorExit: 0, cut: 'aaaa', dest: 'aaaa', lookupFails: true };
  assert.equal(runBundledClassifier(fence, { ...unreached, extraEnv: hostile }), 'unknown',
    'a forged `[` must not turn an unreached destination into a measured reading');

  // Negative control, in the direction the defect ran: respell the same predicates with the
  // builtin and the identical run stops failing closed. Without it the assertion above would hold
  // just as well on a fence that answered `unknown` for unrelated reasons.
  const reverted = fence.split('[[ ').join('[ ').split(' ]]').join(' ]');
  assert.notEqual(reverted, fence, 'the mutation must actually apply');
  // `expectStateLost`: under the forgery the reverted fence cannot even RECORD that the lookup
  // failed — the predicate that sets `LOOKUP_FAILED` is one of the ones being answered for it.
  // That is the bypass showing its full shape, so the harness's own state check is stood down
  // here and only here; every other call still enforces it.
  assert.notEqual(runBundledClassifier(reverted,
    { ...unreached, extraEnv: hostile, expectStateLost: true }), 'unknown',
  'the builtin spelling must be bypassable, or `[[` is not what is doing the work here');

  // Positive control: same forgery, a destination that DID resolve and a topology that really is
  // benign. A classifier that answered `unknown` to everything would satisfy the first assertion.
  assert.equal(runBundledClassifier(fence,
    { ancestorExit: 0, cut: 'aaaa', dest: 'aaaa', extraEnv: hostile }), 'no-rewrite',
  'and a genuinely benign run must still read benign under the same hostile environment');
});

test('the bundled reading when either predicate is deleted → the run turns red', () => {
  const fence = probeFence('NEW_HEAD=');

  // Each mutation removes one guard and names the case that must notice. A mutation that failed to
  // apply is indistinguishable from a surviving test, so the substitution is asserted first.
  const MUTANTS = [
    ['the cut-point equality', ' && [[ "$CUT" = "$DEST" ]]', '',
      { ancestorExit: 0, cut: 'bbbb', dest: 'aaaa' }, 'rewrite'],
    ['the errored-ancestry row', '[[ "$BUNDLED_ANCESTRY_READING" = errored ]] || ', '',
      { ancestorExit: 2, cut: 'aaaa', dest: 'aaaa' }, 'unknown'],
    // Round 54. The `case` that turns the exit status into a word before anything composes it.
    // Its `*` arm is what makes an errored — or empty — ancestry fail closed; point that arm at
    // `contained` and the same run publishes `no-rewrite`, which is the silent path.
    ['the catch-all ancestry arm', '*) BUNDLED_ANCESTRY_READING=errored ;;',
      '*) BUNDLED_ANCESTRY_READING=contained ;;',
      { ancestorExit: 2, cut: 'aaaa', dest: 'aaaa' }, 'unknown'],
    // Round 54. Both halves of the destination guard, separately: dropping it from the no-rewrite
    // conjunction republishes the silent path for an unreached destination, and dropping it from
    // the unknown disjunction leaves the same run reading `rewrite` — wrong in the other
    // direction, since nothing measured a rewrite either.
    ['the destination guard on the silent path', '[[ "$LOOKUP_FAILED" != 1 ]] && ', '',
      { ancestorExit: 0, cut: 'aaaa', dest: 'aaaa', lookupFails: true }, 'unknown'],
    ['the destination guard on the fail-closed path', '[[ "$LOOKUP_FAILED" = 1 ]] || ', '',
      { ancestorExit: 1, cut: 'aaaa', dest: 'aaaa', lookupFails: true }, 'unknown'],
  ];

  for (const [label, from, to, input, expected] of MUTANTS) {
    assert.ok(fence.includes(from), `precondition: the fence still carries ${label}`);
    const mutant = fence.split(from).join(to);
    assert.notEqual(mutant, fence, `MUTANT APPLIED: ${label}`);
    assert.notEqual(runBundledClassifier(mutant, input), expected,
      `deleting ${label} must change the reading — otherwise nothing tests it`);
  }
});

// ── The push destination is not the fetch destination ─────────────────────────
// `origin` names two URLs. `git ls-remote origin` reads the fetch one; the force-push
// contacts the push one, and `remote.origin.pushurl` or `url.<x>.pushInsteadOf` moves
// them apart. A probe that classifies repository A while the push rewrites repository B
// reaches the right verdict about the wrong repository.

for (const [label, marker] of [['iteration gate', 'NEW_HEAD='], ['rollback', 'BACKUP=']]) {
  test(`the ${label} probe → looks the tip up at the push destination, not the remote name`, () => {
    const fence = probeFence(marker);
    const found = runEpicProbe(fence, { lsExit: 0, lsOut: TIP_LINE });
    const lookup = found.args.find((a) => a.startsWith('ls-remote'));
    assert.ok(lookup, `precondition: the fence must still perform a lookup: ${found.err}`);
    assert.ok(lookup.includes(EM_PUSH_URL),
      `the lookup must name the resolved push URL: ${lookup}`);
    assert.doesNotMatch(lookup, /(^|\s)origin(\s|$)/,
      `and must not fall back to the remote name, which resolves to the fetch URL: ${lookup}`);

    // Mutation control: put the remote name back and the assertions above must fail. Without
    // it, a fence that stopped performing any lookup would satisfy them by vacuity.
    const reverted = fence.split(`-- "$PUSH_URL" `).join('-- origin ');
    assert.notEqual(reverted, fence, 'the mutation must actually apply');
    const mutant = runEpicProbe(reverted, { lsExit: 0, lsOut: TIP_LINE });
    const mutantLookup = mutant.args.find((a) => a.startsWith('ls-remote'));
    assert.ok(mutantLookup && !mutantLookup.includes(EM_PUSH_URL),
      `the reverted fence must query the name instead: ${JSON.stringify(mutant.args)}`);
  });

  test(`the ${label} probe → fails closed when the destination is not exactly one URL`, () => {
    const fence = probeFence(marker);
    // Three ways the destination is not decidable, all read the same: unknown, never benign.
    // `pushurl` is multi-valued and git pushes to every one of them, so a fan-out has no single
    // repository to classify — the singular `get-url --push` would report only the first.
    for (const [why, opts] of [
      ['a fan-out to two push URLs', { pushUrls: [EM_PUSH_URL, 'https://push.example/other.git'] }],
      ['the resolution failing outright', { getUrlExit: 3 }],
      ['no push URL at all', { pushUrls: [] }],
    ]) {
      const r = runEpicProbe(fence, { lsExit: 0, lsOut: TIP_LINE, ...opts });
      assert.equal(r.out, 'TIP=<> FAILED=<1>', `${why} must read as a failed lookup: ${r.err}`);
      assert.ok(!r.args.some((a) => a.startsWith('ls-remote')),
        `${why} must not be followed by a lookup against a guessed destination: ${JSON.stringify(r.args)}`);
    }
  });
}

// Every property the destination guard must carry, as data rather than as inline assertions —
// so the mutation test below can ask whether removing one is actually noticed.
const DESTINATION_GUARD = [
  [/PUSH_URLS=\$\(/,
    'the destination must be re-resolved before the push, not only at the probe'],
  [/remote get-url --push --all/,
    'and re-resolved with the same oracle the probe used'],
  [/^PUSH_URLS_SAFE=$/m,
    'and redacted before anything is printed — a push URL may carry user:token@'],
  [/"\$PUSH_URLS_SAFE" != "<the redacted destination this iteration/,
    'and compared against the redacted destination the approval question actually showed'],
  // Round 55 (C-54-4). Until this row existed, every assertion here was satisfied by the redaction
  // comparison alone — and that comparison binds the approval to a host and a path, no further:
  // redaction deletes the entire query string, so two destinations differing only there compare
  // equal. The digest over the RAW list is what makes the comparison an identity check, and
  // deleting it from both fences left this test green.
  [/_H=\$\(\/usr\/bin\/printf '%s' "\$1" \| sha256_raw/,
    'the raw destination must be hashed, not only redacted — and per URL, because the hook is '
    + 'invoked once per push URL with that single URL as its second argument'],
  // Round 60. The shape this replaced was `printf … | { sha256sum || shasum -a 256 || openssl … }`,
  // and the flaw is in the pipeline, not in the tool list: the FIRST command consumes stdin and
  // only then fails, so the fallback hashes EOF. Measured 2026-08-22 with a `BASH_FUNC_sha256sum%%`
  // that reads stdin and returns 1 — two different URLs both digested to
  // e3b0c442…7852b855, the SHA-256 of the empty string, and therefore to each other. A digest that
  // is equal for every input cannot answer "did the destination change?". `command -v` reads no
  // stdin, so selecting first feeds the input exactly once.
  [/if command -v sha256sum >\/dev\/null 2>&1; then \/usr\/bin\/env sha256sum/,
    'the hasher must be SELECTED before the input is fed to it — a `a || b` pipeline lets the '
    + 'first tool eat stdin and the second hash nothing'],
  [/elif command -v shasum/,
    'and the fallbacks must stay reachable — macOS ships shasum and no sha256sum'],
  [/elif command -v openssl >\/dev\/null 2>&1; then \/usr\/bin\/env openssl dgst -sha256/,
    'and hashed with SHA-256 — `git hash-object` is SHA-1 here, which `rules/security.md` '
    + 'prohibits for a digest carrying a security decision. The repository object format it also '
    + 'follows is a secondary hazard, not an independent breakage — both sides read the same '
    + 'repository (round 59 correction)'],
  [/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855/,
    'and whichever tool was selected must prove it computes SHA-256 by a known-answer test before '
    + 'its output is trusted — selection alone only proves a command of that NAME exists'],
  [/ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/,
    'with a non-empty vector beside the empty one, or a tool that returns the empty-string digest '
    + 'for everything passes its own self-test'],
  // Round 57. A configured `receivepack` leaves the URL digest true and meaningless at once: the
  // program that receives the objects can ignore the repository the URL named (measured).
  [/PUSH_RECEIVEPACK=\$\(/,
    'the receiving program must be read, because the URL alone does not decide where objects land'],
  [/-n "\$PUSH_RECEIVEPACK"/,
    'and a configured one must refuse the push'],
  [/"\$PUSH_URLS_DIGEST" != "<the PUSH_URLS_DIGEST value the classifier fence printed/,
    'and compared against the digest the classifier fence printed for this iteration'],
  [/-z "\$PUSH_URLS_DIGEST"/,
    'and an empty digest must refuse — otherwise two destinations that never resolved compare equal'],
  [/exit 1/,
    'a disagreement must refuse the push, not warn about it'],
];

// The two force-push fences of a given skill text, each reduced to what runs BEFORE its push.
function forcePushPreambles(text) {
  const blocks = text.split(/^```.*$/m).filter((_, i) => i % 2 === 1);
  // `[= ]` — round 60 gave the two fences different lease shapes (bound value vs. the value-less
  // pair). Matching only the pair would have silently reduced this whole section to one fence.
  const pushes = blocks.filter((b) => /git push --force-with-lease[= ]/.test(b));
  assert.equal(pushes.length, 2, `expected the two force-push fences, found ${pushes.length}`);
  return pushes.map((fence) => {
    const lines = fence.split('\n').map((l) => l.replace(/(^|\s)#.*$/, ''));
    const pushAt = lines.findIndex((l) => l.includes('git push --force-with-lease'));
    return lines.slice(0, pushAt).join('\n');
  });
}

const destinationGuardViolations = (text) => forcePushPreambles(text)
  .flatMap((before) => DESTINATION_GUARD.filter(([re]) => !re.test(before)).map(([, why]) => why));

test('both force-push fences → re-assert the destination against the approved URL before pushing', () => {
  // The probe resolved the destination; the push happens later, through the mutable name
  // `origin`. Re-resolving and comparing is what stops a config change between the approval
  // and the push from redirecting an approved history rewrite to another repository.
  assert.deepEqual(destinationGuardViolations(readSkill()), [],
    'the destination guard is incomplete in at least one force-push fence');
});

test('the destination guard when its digest half is deleted → the check turns red', () => {
  // A guard that is green whether or not the thing it names is present is not a guard. Each half
  // is deleted on its own, because the failure this catches is exactly one half surviving.
  const raw = readSkill();
  const DIGEST_PREDICATE = ' || [[ "$PUSH_URLS_DIGEST" != "<the PUSH_URLS_DIGEST value the'
    + ' classifier fence printed for this iteration, written literally and quoted>" ]]';
  const REDACTION_PREDICATE = ' || [[ "$PUSH_URLS_SAFE" != "<the redacted destination this'
    + " iteration's approval named — the PUSH_URLS_SAFE value the question showed>\" ]]";

  for (const [label, predicate] of [['digest', DIGEST_PREDICATE], ['redaction', REDACTION_PREDICATE]]) {
    const mutant = raw.split(predicate).join('');
    assert.notEqual(mutant, raw, `MUTANT APPLIED: ${label} predicate removed from both fences`);
    assert.notEqual(destinationGuardViolations(mutant).length, 0,
      `deleting the ${label} predicate must be reported, not tolerated`);
  }

  // Positive control — the unmutated text passes, so the assertions above are not red for
  // some unrelated reason such as a fence count that no longer matches.
  assert.deepEqual(destinationGuardViolations(raw), [],
    'and the real document must still satisfy every row');
});

// ── The push destination is shown to an operator, so it must not carry a credential ──
// `git remote get-url --push --all origin` returns a URL verbatim, and a URL may embed
// userinfo: `https://user:token@host/repo.git`. Measured 2026-08-21 — the command returns the
// token unchanged. Everything the operator sees, and everything an approval is compared against,
// is therefore the redacted form derived in the fence itself.

// Runs the SKILL's own redaction block — not a copy of it — over one input.
function redact(input) {
  const text = readFileSync(resolve(__dirname, '../../skills/epic-merge/SKILL.md'), 'utf8').split('\n');
  const start = text.findIndex((l) => l === 'PUSH_URLS_SAFE=');
  assert.ok(start >= 0, 'the skill must carry a redaction block to exercise');
  const end = text.indexOf('SAFE_EOF', start + 1);
  assert.ok(end > start, 'the redaction block must be terminated');
  const block = text.slice(start, end + 1).join('\n');
  const r = spawnSync('/bin/bash', ['-c', `PUSH_URLS=$1\n${block}\nprintf '%s' "$PUSH_URLS_SAFE"`, 'x', input],
    { encoding: 'utf8' });
  assert.equal(r.status, 0, `the redaction block must run: ${r.stderr}`);
  return r.stdout;
}

test('the push destination when it embeds a credential → the operator sees no token', () => {
  const SECRET = 'ghp-SYNTHETIC-NOT-A-REAL-TOKEN-0000';
  const out = redact(`https://alice:${SECRET}@example.invalid/repo.git`);
  assert.doesNotMatch(out, new RegExp(SECRET),
    `the redacted destination must not carry the credential, got: ${out}`);
  assert.equal(out, 'https://<redacted>@example.invalid/repo.git',
    'and it must still name the repository, or the approval identifies nothing');

  // Positive control — a URL with no userinfo passes through byte-identical. Without this the
  // assertion above is satisfied by a redactor that returns the empty string for everything.
  assert.equal(redact('https://example.invalid/repo.git'), 'https://example.invalid/repo.git',
    'a credential-free destination must be shown exactly as it is');
  // Second control — an `@` in the PATH is not userinfo. Masking it would hide the host, which
  // is the half of the URL the approval exists to state.
  assert.equal(redact('https://example.invalid/repo@v1.git'), 'https://example.invalid/repo@v1.git',
    'an @ after the authority is part of the path, not a credential');
  // scp-like `[user@]host:path` reaches no `*://*` arm, so until 2026-08-22 its user field
  // printed verbatim on the reasoning that it is always `git`. It is not — `<token>@host:path`
  // is legal, and this string goes into an approval transcript (Anchor Register #2). The mask is
  // unconditional: a rule guessing which users look like credentials is wrong the first time
  // somebody uses a host it did not anticipate.
  assert.equal(redact(`${SECRET}@code.example:team/repo.git`), '<redacted>@code.example:team/repo.git',
    'a credential-shaped scp-like user must be masked, and the host and path must survive it');
  assert.equal(redact('git@github.com:org/repo.git'), '<redacted>@github.com:org/repo.git',
    'and the mask does not exempt the conventional `git` user');
  // Split at the LAST `@`, where ssh itself splits: `a@b@host` is user `a@b` on host `host`.
  assert.equal(redact(`${SECRET}@alice@git.example:org/repo.git`), '<redacted>@git.example:org/repo.git',
    'a first-@ split would leave the tail of the user field printed');
  // Negative controls for the new arm. Without them every assertion above is satisfied by a
  // redactor that masks anything containing a `:`, which hides a redirect instead of a token.
  for (const [url, why] of [
    ['host.example:org/repo.git', 'a scp-like destination with no user field has nothing to mask'],
    ['/local/pa@th:name', 'a `/` before the `:` means a path, not a host — git reads it that way too'],
    ['C:/win/repo.git', 'a drive letter is not a user field'],
    ['./rel/a@b/c.git', 'no `:` at all — neither arm applies'],
  ]) assert.equal(redact(url), url, why);
});

test('two destinations differing only past the credential → still distinguishable after redaction', () => {
  // The comparison the fences make is on the redacted form, so redaction must not merge two
  // repositories into one string. It may merge two credentials for the SAME repository — that is
  // the deliberate limit, and it cannot hide a redirect.
  const a = redact('https://u:t1@example.invalid/one.git');
  const b = redact('https://u:t2@example.invalid/two.git');
  assert.notEqual(a, b, 'a different repository must survive redaction as a different string');
  const c = redact('https://u:t1@example.invalid/one.git');
  const d = redact('https://other:t2@example.invalid/one.git');
  assert.equal(c, d, 'and two credentials for one repository are deliberately one destination');
  // Multi-URL fan-out: every line redacted, none dropped.
  const many = redact('https://a:t@h/one.git\nhttps://b:t@h/two.git');
  assert.equal(many, 'https://<redacted>@h/one.git\nhttps://<redacted>@h/two.git',
    'a fan-out must redact every destination and lose none of them');
});

test('every prefix that guards replacements → guards the graft file with the same value', () => {
  // A property, not a byte pin: the two names travel together, and a regenerated pin must not be
  // able to drop one. `unset GIT_GRAFT_FILE` is not a weaker version of binding it — it restores
  // git's DEFAULT path, `$GIT_DIR/info/grafts`, which lives in the repository where no `-u`
  // reaches. Measured 2026-08-21: stripped answers 0 for a rewrite, bound to /dev/null answers 1.
  const text = readFileSync(resolve(__dirname, '../../skills/epic-merge/SKILL.md'), 'utf8');
  // Executable lines only. Prose and `#` comments legitimately quote the *broken* form — the
  // measurement that justifies the pairing is written as `env -u GIT_GRAFT_FILE …`, and a check
  // that could not tell a quoted bypass from a live one would forbid recording the evidence.
  const code = text.split(/^```.*$/m).filter((_, i) => i % 2 === 1).join('\n')
    .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const guarded = [...code.matchAll(/GIT_NO_REPLACE_OBJECTS=1 /g)];
  assert.ok(guarded.length > 0, 'the skill must guard replacements somewhere');
  for (const m of guarded) {
    const lead = code.slice(Math.max(0, m.index - 26), m.index);
    assert.equal(lead.endsWith('GIT_GRAFT_FILE=/dev/null '), true,
      `a replacement guard at offset ${m.index} is not paired with a graft guard: ...${lead}`);
  }
  // The other direction, restricted to commands: prose may name either variable alone, but a
  // graft guard standing immediately before a git invocation without its partner is unpaired.
  assert.doesNotMatch(code, /GIT_GRAFT_FILE=\/dev\/null (?!GIT_NO_REPLACE_OBJECTS=1)[^ ]* ?git /,
    'neither name may lead a git command alone');
});

test('every force-push authorization question → names the destination it authorizes', () => {
  // Round 47. The fences compared the resolved destination against "the URL the approval named"
  // while no question named one: bundled, per-step and rollback gates stated the branch, the
  // rewrite, the lease and the SHAs, and never the repository. A fence comparing against a value
  // the operator was never shown detects a later config change and authorizes nothing.
  const text = readSkill();
  const questions = [...text.matchAll(/^\| \d+ \| \`question\` \| (.*)$/gm)].map((m) => m[1])
    .concat([...text.matchAll(/^\| Before [^|]*\| (.*)$/gm)].map((m) => m[1]));
  const pushy = questions.filter((q) => /force-push|pushes to|Force-push/.test(q));
  assert.ok(pushy.length >= 5,
    `expected the bundled, per-step and rollback push questions, found ${pushy.length}`);
  for (const q of pushy) {
    assert.match(q, /<PUSH_URLS_SAFE>/,
      `a push authorization question must name its destination: ${q.slice(0, 120)}`);
  }

  // Negative control — strip the token from one question and the check must fail. Without it a
  // regex that matched nothing would be green forever.
  const mutated = pushy.map((q, i) => (i === 0 ? q.split('<PUSH_URLS_SAFE>').join('') : q));
  assert.equal(mutated.filter((q) => /<PUSH_URLS_SAFE>/.test(q)).length, pushy.length - 1,
    'the control must actually remove one — an unapplied mutation proves nothing');

  // Positive control — questions that authorize no push are not required to name a destination,
  // or the assertion is just "every table row mentions a URL".
  const nonPush = questions.filter((q) => !/force-push|pushes to|Force-push/.test(q));
  assert.ok(nonPush.length > 0, 'there must be non-push questions for this control to mean anything');
  assert.ok(nonPush.some((q) => !/<PUSH_URLS_SAFE>/.test(q)),
    'and at least one of them must legitimately omit the destination');
});

// Every redaction site must be the same bytes as the one `redact()` runs — six copies across two
// skills, and executing one of them proves nothing about the other five unless they are identical.
function redactionBlocks(source) {
  const lines = source.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== 'PUSH_URLS_SAFE=') continue;
    const end = lines.indexOf('SAFE_EOF', i + 1);
    assert.ok(end > i, 'each redaction block must be terminated');
    blocks.push(lines.slice(i, end + 1).join('\n'));
  }
  return blocks;
}

test('a credential outside the userinfo → the operator still sees no token', () => {
  // Three shapes a userinfo-only mask does not reach, all measured leaking on 2026-08-21:
  // `?access_token=`, a fragment, and a password containing `@` split on the FIRST `@`.
  const SECRET = 'ghp-SYNTHETIC-NOT-A-REAL-TOKEN-0000';
  const cases = [
    [`https://example.invalid/repo.git?access_token=${SECRET}`, 'https://example.invalid/repo.git?<redacted>'],
    [`https://example.invalid/repo.git#${SECRET}`, 'https://example.invalid/repo.git#<redacted>'],
    [`https://alice:pw@${SECRET}@example.invalid/repo.git`, 'https://<redacted>@example.invalid/repo.git'],
  ];
  for (const [input, want] of cases) {
    const out = redact(input);
    assert.ok(!out.includes(SECRET), `the redacted destination must not carry the credential, got: ${out}`);
    assert.equal(out, want, 'and it must still name the repository the push authorizes');
  }
  // Positive controls — without them every assertion above passes on a redactor that masks
  // everything, which would make the fence comparison useless while looking perfectly safe.
  assert.equal(redact('https://example.invalid:8443/repo.git'), 'https://example.invalid:8443/repo.git',
    'a destination carrying no credential must survive unchanged, port included');
  assert.equal(redact('https://example.invalid/repo.git?x=1\nhttps://example.invalid/other.git?x=1'),
    'https://example.invalid/repo.git?<redacted>\nhttps://example.invalid/other.git?<redacted>',
    'and two repositories must stay distinguishable when only their query is masked');
});

test('every copy of the redaction block → byte-identical to the one the tests execute', () => {
  const source = readFileSync(resolve(__dirname, '../../skills/epic-merge/SKILL.md'), 'utf8');
  const blocks = redactionBlocks(source);
  assert.ok(blocks.length >= 2, `the skill must carry more than one redaction site, found ${blocks.length}`);
  for (const b of blocks) {
    assert.equal(b, blocks[0], 'every copy must be byte-identical — redact() executes only the first');
  }

  // Negative control: diverge one of the later copies and the property must fail. Without it the
  // assertion above is satisfied by an extractor that finds a single block and compares it to itself.
  const marker = '${AUTH##*@}';
  const last = source.lastIndexOf(marker);
  assert.ok(last > source.indexOf(marker), 'the mutation must land on a copy other than the first');
  const mutated = redactionBlocks(source.slice(0, last) + '${AUTH#*@}' + source.slice(last + marker.length));
  assert.ok(mutated.some((b) => b !== mutated[0]), 'a divergent copy must be detected, not averaged away');
});

test('the rollback authorization question → states the effect the classifier measured, not a fixed sentence', () => {
  // Gate 1 has been topology-conditioned since it was written; gate 2 said "This rewrites remote
  // history." on every path — including the creation and fast-forward rows the classifier directly
  // above it exists to identify. A warning the operator learns is sometimes false is the one an
  // attestation contract cannot afford, so the two gates must condition the same way.
  const text = readFileSync(resolve(__dirname, '../../skills/epic-merge/SKILL.md'), 'utf8');
  const row = text.split('\n').find((l) => l.includes('Rollback: force-push <head> to <PUSH_URLS_SAFE>'));
  assert.ok(row, 'the rollback question must still be pinned by this file');
  assert.match(row, /--force-with-lease\?<effect>/,
    'the question must end in a placeholder the classifier fills, not in a fixed claim');
  const clauses = [
    // Round 79: the rewrite clause must name the object, not just the fact. `APPROVED_TIP` in the
    // fence below compares against what the APPROVAL covered, and an approval reading only "this
    // rewrites remote history" covers whatever happens to be there when the push runs.
    [/This rewrites remote history, replacing <REMOTE_TIP>\./, 'ROLLBACK_ANCESTRY = 1'],
    [/topology could not be verified/, 'the two unknown rows'],
    // The creation clause was removed in round 49, not lost: that row no longer reaches this gate
    // at all (the classifier hands it back), and an effect offered for a push that never happens
    // is the same false warning this test exists to prevent. The test above pins the refusal.
    [/fast-forward, not a rewrite/, '--is-ancestor succeeded'],
  ];
  for (const [clause, row_] of clauses) {
    assert.match(row, clause, `the effect clause must cover ${row_}`);
  }

  // Negative control, and it uses the same words as the data: the rewrite sentence must still be
  // present as one alternative, and must NOT be spliced straight onto the question. Without both
  // directions this passes on a document that simply deleted the warning.
  assert.doesNotMatch(row, /--force-with-lease\? This rewrites remote history\./,
    'the unconditional sentence must not be reachable as the question own text');

  // Positive control: gate 1 conditions its own clause the same way, so this is the file
  // convention rather than a one-off phrasing.
  const gate1 = text.split('\n').find((l) => l.includes('Is anybody else working on <head>?'));
  assert.ok(gate1 && /<basis>/.test(gate1), 'gate 1 must still carry its own conditioned clause');
});

test('the rollback creation row → refused and handed back, not pushed under a lease git rejects', () => {
  // Round 49. The classifier called this row a permitted creation and let it fall through to a push
  // the oracle below shows git refuses. Both halves are asserted: the row says it does not push,
  // and the authorization question no longer describes a creation it will never perform.
  const skill = readSkill();
  // Round 53 renamed the row's key: the table's rows now name the word the fence derives
  // (`ROLLBACK_READING`) instead of restating the condition, so that one input can no longer
  // satisfy two rows. What the row must SAY is unchanged, and is what the assertions below check.
  const row = skill.split('\n').find((l) => l.startsWith('| `ROLLBACK_READING=head-deleted` |'));
  assert.ok(row, 'the classifier must still carry the deleted-head row');
  assert.match(row, /do not push/, 'the row must refuse rather than fall through to the push');
  assert.match(row, /stale info/, 'and it must cite the measurement, not just assert the refusal');

  const gate2 = skill.split('\n').find((l) => l.includes('Rollback: force-push <head> to'));
  assert.ok(gate2, 'the rollback authorization question must still exist');
  assert.doesNotMatch(gate2, /creates the ref rather than rewriting it/,
    'a row that never reaches the gate must not be offered as one of its effects');

  // Negative control: the assertions above must be about this row, not about any prose mentioning
  // a refusal. A row reworded back to the shipped defect has to fail them.
  const shipped = row.replace(/\| No — and do not push.*\|$/, '| No |');
  assert.notEqual(shipped, row, 'the control must actually differ from the row');
  assert.doesNotMatch(shipped, /do not push/, 'the control must remove the refusal it checks for');
});

test('git own lease semantics → why the deleted-head row is refused rather than pushed', () => {
  // An oracle, not a skill test. It measures two things the decision above rests on: the shipped
  // push cannot publish this row (so the row was dead), and a form that could does exist (so the
  // refusal is a choice about the Anchor grant, not a limitation of git).
  const root = mkdtempSync(resolve(tmpdir(), 'epic-lease-'));
  const work = resolve(root, 'work');
  const bare = resolve(root, 'origin.git');
  const git = (args) => spawnSync('git', args, { encoding: 'utf8', cwd: work });
  try {
    spawnSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8' });
    spawnSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
    git(['config', 'user.email', 'lease@example.invalid']);
    git(['config', 'commit.gpgSign', 'false']);
    git(['config', 'user.name', 'Lease Test']);
    git(['commit', '-q', '--allow-empty', '-m', 'one']);
    git(['remote', 'add', 'origin', bare]);
    git(['push', '-q', '-u', 'origin', 'main']);
    git(['checkout', '-q', '-b', 'feat/x']);
    git(['commit', '-q', '--allow-empty', '-m', 'two']);
    git(['push', '-q', '-u', 'origin', 'feat/x']);
    assert.equal(git(['rev-parse', 'refs/remotes/origin/feat/x']).status, 0,
      'fixture: the tracking ref must exist, or neither direction below means anything');

    // Someone deletes the branch after that fetch. The tracking ref keeps its old OID.
    spawnSync('git', ['-C', bare, 'update-ref', '-d', 'refs/heads/feat/x'], { encoding: 'utf8' });

    const valueless = git(['push', '--force-with-lease', '--force-if-includes', 'origin', '--',
      'refs/heads/feat/x:refs/heads/feat/x']);
    assert.notEqual(valueless.status, 0,
      'the value-less lease must refuse to recreate a deleted branch — this is the defect');
    assert.match((valueless.stdout || '') + (valueless.stderr || ''), /stale info/,
      'and it must refuse for the lease reason, not some unrelated one');

    const empty = git(['push', '--force-with-lease=refs/heads/feat/x:', '--force-if-includes',
      'origin', '--', 'refs/heads/feat/x:refs/heads/feat/x']);
    assert.equal(empty.status, 0,
      `the empty expectation must recreate it: ${empty.stdout}${empty.stderr}`);
    assert.equal(spawnSync('git', ['-C', bare, 'rev-parse', 'refs/heads/feat/x'],
      { encoding: 'utf8' }).status, 0, 'and the branch must be back on the remote');

    // The other direction: with the ref present again, the empty expectation must refuse. Without
    // this the form above would be indistinguishable from an unconditional force.
    git(['commit', '-q', '--allow-empty', '-m', 'three']);
    const again = git(['push', '--force-with-lease=refs/heads/feat/x:', '--force-if-includes',
      'origin', '--', 'refs/heads/feat/x:refs/heads/feat/x']);
    assert.notEqual(again.status, 0,
      'an empty expectation must refuse a ref that exists — otherwise it is a bare force');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('both topology classifiers → print what they measured, instead of assigning it and stopping', () => {
  // Round 50. Each classifier ends a fenced block, and the table that picks a row from its values
  // is read afterwards, by the agent, in a shell that never saw them. An assignment alone forces a
  // second derivation, and a second derivation is free to disagree with the one that was measured.
  const skill = readSkill();
  const blocks = skill.split(/^```.*$/m).filter((_, i) => i % 2 === 1);
  const classifiers = blocks.filter((b) => /^\s*(ROLLBACK_ANCESTRY|BUNDLED_READING)=/m.test(b));
  assert.equal(classifiers.length, 2, `expected exactly two classifier fences, found ${classifiers.length}`);

  for (const b of classifiers) {
    // `/usr/bin/printf`, not `printf`: a regular builtin is outranked by an imported
    // `BASH_FUNC_printf%%` function, so the bare word let a caller write this fence's verdict
    // (measured round 59). bash refuses to import a function whose name contains a slash.
    const printed = b.match(/^\/usr\/bin\/printf '([^']*)'/m);
    assert.ok(printed, `a classifier that reports nothing is unreadable to the step that needs it: ${b.slice(0, 120)}`);
    // Every variable the fence decides on has to be in the line, not merely some of them.
    for (const name of ['REMOTE_TIP', 'LOOKUP_FAILED']) {
      assert.match(printed[1], new RegExp(`${name}=\\[%s\\]`),
        `${name} must be reported — the reading table selects a row on it`);
    }
    // Round 52, both directions of the same property. Every name on the report must be assigned
    // in this fence — a reported name nothing sets prints an empty field that reads as a measured
    // one — and the raw ancestry must travel beside any reading derived from it, because the
    // derivation collapses "errored" and "not contained" into one word.
    for (const name of printed[1].match(/[A-Z_]+(?==\[%s\])/g) || []) {
      // `;` as well as line start: these fences pair the two lookup outcomes on one line
      // (`REMOTE_TIP=; LOOKUP_FAILED=1`), and an anchor that only reads line starts would call
      // half of them unassigned. Round 63 added `then `/`else ` for the same reason one step on:
      // the ancestry captures now sit in `if CMD; then X=0; else X=$?; fi`, which `set -e` cannot
      // abort on, and an anchor that only read line starts and `;` called those unassigned too.
      assert.match(b, new RegExp(`(^|;|\\bthen |\\belse )\\s*${name}=`, 'm'),
        `${name} is reported but never assigned in the fence that reports it`);
    }
    if (/^\s*BUNDLED_READING=/m.test(b)) {
      assert.match(printed[1], /BUNDLED_ANCESTRY=\[%s\]/,
        'the reading is derived from the ancestry, so the ancestry must be reported too');
    }
  }

  // Negative control: strip the printf from one fence and the property must fail. Without it this
  // passes on any file containing a printf anywhere.
  const muted = classifiers[0].split('\n').filter((l) => !l.startsWith("/usr/bin/printf '")).join('\n');
  assert.doesNotMatch(muted, /^\/usr\/bin\/printf '/m, 'the control must remove the report it checks for');
  assert.match(muted, /^\s*(ROLLBACK_ANCESTRY|BUNDLED_READING)=/m,
    'and must leave the classifier standing, or it tests deletion rather than the interface');
});

test('the rollback block → separates what every row owes from what only the pushing rows owe', () => {
  // Round 50. One prerequisite covered all three steps and demanded both gates, which was wrong in
  // both directions: the fast-forward row is not owed an unshared attestation, and the two rows
  // that push nothing are still owed the local restore — they are precisely the rows where the
  // local branch is the thing that is broken.
  const skill = readSkill();
  assert.match(skill, /\*\*Steps 1 and 2 of the block below run on every row that reaches rollback; step 3 does not\.\*\*/,
    'the local restore must be stated as owed on every row');

  const push = skill.split('\n').find((l) => l.startsWith('# 3. Push the restored head.'));
  assert.ok(push, 'the push step must state which rows reach it');
  const at = skill.split('\n').indexOf(push);
  const block = skill.split('\n').slice(at, at + 8).join('\n');
  assert.match(block, /fast-forward/, 'the fast-forward row must be named as one that pushes');
  assert.match(block, /only on\n#\s+the two the table marks \*\*Yes\*\*/,
    'and gate 1 must be scoped to the rows the table marks Yes');
  assert.doesNotMatch(block, /Only after BOTH rollback questions/,
    'the flat prerequisite this replaced must be gone, not merely qualified elsewhere');
});

test('every push fence `/epic-merge` executes → carries the destination binding', () => {
  // A static sweep, because the defect it guards is an OMISSION: a further push form added later
  // without the binding would be checked in one process and pushed in another, and every other
  // test in this file would stay green. What makes it a guard rather than a grep is the pairing —
  // the number of executing push lines is asserted too, so a predicate that silently stops
  // matching cannot report "all bound" over an empty set.
  //
  // The predicate is "an `env` prefix followed by `git push`", which is exactly the shape this
  // skill is required to use (§ Prohibited: no push without the `env -u` prefix). That rule is
  // what makes the predicate complete rather than a guess: a push that evaded it would already
  // be a violation the sibling tests report.
  const text = readFileSync(resolve(__dirname, '../../skills/epic-merge/SKILL.md'), 'utf8');
  const pushLines = text.split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .filter((l) => /\/usr\/bin\/env .*\bgit push\b/.test(l));
  assert.equal(pushLines.length, 2,
    'the executing push forms must all be found — a changed count means a form was added or '
    + 'removed, and this test must be read before its number is updated');
  const BINDING = 'SD0X_PUSH_DEST_DIGEST="$PUSH_URLS_DIGEST"';
  const unbound = pushLines.filter((l) => !l.includes(BINDING));
  assert.deepEqual(unbound, [],
    'a push line without the destination binding leaves the approval covering a destination the '
    + 'push need not reach — git resolves it inside its own process and hands the real one to the '
    + 'pre-push hook as its second argument: ' + JSON.stringify(unbound));

  // Negative control. Without it the assertion above is satisfied by a predicate that cannot
  // detect an unbound line at all.
  const fabricated = pushLines[0].replace(BINDING + ' ', '');
  assert.notEqual(fabricated, pushLines[0],
    'MUTANT APPLIED: the binding must be present on the sampled line to be removed from it');
  assert.ok(!fabricated.includes(BINDING),
    'and the predicate must report a push line that lost it');
});

// ── The report channel is part of the verdict (round 59) ──────────────────────

// Runs a fragment of the shipped fence under an environment exporting a `printf` FUNCTION.
// bash resolves functions before regular builtins, so the bare word is the caller's to answer;
// an absolute path is not, because bash refuses to import a function whose name has a slash.
function underHostilePrintf(setup, src, forgery) {
  return spawnSync('/bin/bash', ['-c', setup + '\n' + src], {
    encoding: 'utf8',
    env: { ...process.env, 'BASH_FUNC_printf%%': `() { builtin printf '%s' ${JSON.stringify(forgery)}; }` },
  });
}

test('both classifier reports under an imported printf → state what was measured, not what was planted', () => {
  // **Round 59**, the same defect as /push-ci and found in the same pass: the iteration classifier
  // and the rollback classifier both ended in a bare `printf`, so an exported BASH_FUNC_printf%%
  // could replace BUNDLED_READING=rewrite with no-rewrite and delete the unshared question from a
  // history-rewriting iteration. Asserted on both fences — one being safe says nothing about the
  // other.
  // Selected by the fields that make a line a classifier report, NOT by the absolute path: a
  // report that regressed to the bare word must still be found here and then fail the assertion
  // below, rather than dropping out of the selection and passing by absence. The count is scoped
  // to classifier reports for the same reason — it is this test's coverage claim (both fences are
  // checked), and it no longer moves when some other line in the document gains an absolute path.
  const lines = readSkill().split('\n');
  const isReport = (l) => /^[ \t]*(?:\/usr\/bin\/)?printf '/.test(l)
    && l.includes('REMOTE_TIP=[%s]') && l.includes('LOOKUP_FAILED=[%s]');
  const starts = lines.reduce((acc, l, i) => (isReport(l) ? [...acc, i] : acc), []);
  assert.equal(starts.length, 2, `expected two classifier reports, found ${starts.length}`);
  for (const i of starts) {
    assert.ok(lines[i].startsWith('/usr/bin/printf '),
      `a classifier report must go out absolutely: ${lines[i].slice(0, 60)}`);
  }

  for (const i of starts) {
    // The report is one logical line continued with backslashes; take it whole.
    let end = i;
    while (lines[end].endsWith('\\')) end += 1;
    const shipped = lines.slice(i, end + 1).join('\n');
    const names = [...shipped.matchAll(/([A-Z_]+)=\[%s\]/g)].map((m) => m[1]);
    assert.ok(names.length >= 4, `a classifier report must name its fields: ${shipped.slice(0, 80)}`);
    const setup = names.map((n) => `${n}=REAL_${n}`).join('\n');
    const FORGERY = `${names.map((n) => `${n}=[FORGED]`).join('\n')}\n`;

    const real = underHostilePrintf(setup, shipped, FORGERY);
    assert.equal(real.status, 0, `the shipped report must still run: ${real.stderr}`);
    for (const n of names) {
      assert.match(real.stdout, new RegExp(`${n}=\\[REAL_${n}\\]`),
        `${n} must be reported as measured under a hostile printf`);
    }
    assert.doesNotMatch(real.stdout, /FORGED/, 'and nothing planted may appear');

    const mutant = shipped.replace('/usr/bin/printf', 'printf');
    assert.notEqual(mutant, shipped, 'the mutation must actually remove the absolute path');
    const forged = underHostilePrintf(setup, mutant, FORGERY);
    assert.match(forged.stdout, /FORGED/,
      'the bare-word form must be forgeable, or the absolute path is guarding nothing');

    const clean = spawnSync('/bin/bash', ['-c', setup + '\n' + mutant], { encoding: 'utf8' });
    assert.match(clean.stdout, new RegExp(`${names[0]}=\\[REAL_${names[0]}\\]`),
      'without the forgery the same fragment must report the measurement');
  }
});

test('Step 5 → re-measures the topology after the rebase, and refuses an unknown reading', () => {
  // **Round 59.** Bundled mode decides whether the unshared attestation is owed BEFORE Step 2, and
  // Steps 2 and 3 then check out the remote-tracking ref and rebase it — the two operations that
  // determine what the push overwrites. A prediction made before them is stale by the time it is
  // acted on, and § Safety already records the outcome: a collaborator commit checked out locally
  // and dropped by a rewrite is overwritten with exit 0, past both leases.
  const skill = readSkill();
  const blocks = skill.split(/^```.*$/m).filter((_, i) => i % 2 === 1);
  const fence = blocks.find((b) => b.includes('FINAL_READING='));
  assert.ok(fence, 'Step 5 must carry a post-rebase topology re-check');
  assert.ok(fence.includes('git push --force-with-lease'),
    'and it must live in the same fence as the push, or it measures a tree the push never sees');
  assert.ok(fence.indexOf('FINAL_READING=') < fence.indexOf('git push --force-with-lease'),
    'the re-check must run BEFORE the push, not after it');

  // The refusal must be a `case` over the word with a catch-all, not a negated list: a reading the
  // fence has never heard of has to land in the refusing arm by construction.
  assert.match(fence, /case "\$FINAL_READING" in\n\s*creation\|up-to-date\|fast-forward\)\s*;;\n\s*rewrite\)/,
    'the benign readings must be enumerated, and `rewrite` must have an arm of its own');
  assert.match(fence, /\n\s*\*\)\n/, 'and an unheard-of reading must still land in a catch-all');
  assert.match(fence, /exit 1 ;;/, 'and the refusing arm must actually stop the iteration');

  // **Round 60.** The first version refused every measured rewrite unconditionally — which is the
  // ordinary path of this entire skill (rebase, rewrite, force-push), so it stopped every normal
  // iteration, and its own advice ("re-run Step 5 on a yes") looped back into the same refusal
  // because the rerun measures the same rewrite. What the check is for is the case where the
  // reading and the ATTESTATION disagree, so it has to be able to see the attestation.
  assert.match(fence, /\nUNSHARED_ATTESTED=\n/,
    'the attestation must be assigned unconditionally in the fence with an EMPTY default: an '
    + 'inherited value would answer a question nobody was asked, and a model that forgets to fill '
    + 'it in must refuse rather than authorize');
  assert.ok(fence.indexOf('UNSHARED_ATTESTED=\n') < fence.indexOf('case "$FINAL_READING" in'),
    'and assigned before the decision reads it');

  // Executed, not read. The matrix is the whole contract: the ordinary path passes, an attestation
  // about another ref does not carry, and `unknown` refuses whatever was attested — the attestation
  // answers "is this ref shared", `unknown` says the measurement failed, and no answer to the first
  // is evidence about the second.
  const decide = fence.slice(fence.indexOf('case "$FINAL_READING" in'));
  const arm = decide.slice(0, decide.indexOf('esac') + 4);
  const EM_TIP_NOW = '9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f';
  // `approved` defaults to the tip the arm is told it measured, so every row below describes an
  // undrifted remote unless it says otherwise.
  const run = (reading, attested, env, { tip = EM_TIP_NOW, approved = tip } = {}) => spawnSync('/bin/bash', ['-c',
    `head=feat/x\nFINAL_READING=${reading}\nFINAL_TIP=${JSON.stringify(tip)}\n`
    + `APPROVED_TIP=${JSON.stringify(approved)}\n`
    + `UNSHARED_ATTESTED=${JSON.stringify(attested)}\n${arm}\nexit 0`],
  { encoding: 'utf8', env: { ...process.env, ...env } });

  for (const [reading, attested, wanted] of [
    ['creation', '', 0], ['up-to-date', '', 0], ['fast-forward', '', 0],
    ['rewrite', 'refs/heads/feat/x', 0],   // asked, answered, pushed — the ordinary path
    ['rewrite', '', 1],                    // the prediction was falsified and nothing was attested
    ['rewrite', 'refs/heads/other', 1],    // an attestation about another ref must not carry
    ['unknown', 'refs/heads/feat/x', 1],
    ['unknown', '', 1],
    ['something-nobody-wrote-yet', 'refs/heads/feat/x', 1],
  ]) {
    const r = run(reading, attested);
    assert.equal(r.status, wanted,
      `${reading} with attestation [${attested}] must ${wanted ? 'refuse' : 'pass'}: ${r.stderr}`);
  }

  // And the attestation must not be answerable from the environment — the exact hazard
  // ALLOW_FORCE_UNSHARED carries, which is why this skill clears that one instead of imitating it.
  assert.equal(run('rewrite', '', { UNSHARED_ATTESTED: 'refs/heads/feat/x' }).status, 1,
    'an exported UNSHARED_ATTESTED must not authorize a push — the fence assigns it itself');

  // ── round 79 ──────────────────────────────────────────────────────────────
  // The attestation is a credential and says nothing about WHICH commit is destroyed. The lease
  // cannot supply that either: it carries `$FINAL_TIP`, the value measured in this fence, so it
  // expects whatever is on the remote now. So the tip the iteration gate showed the operator is
  // bound here too, and a move between the two is refused — it is also evidence against the
  // attestation, since a ref nobody else holds does not acquire commits nobody here published.
  assert.match(fence, /\nAPPROVED_TIP=\n/,
    'the approved remote tip must be assigned unconditionally with an EMPTY default, so a model '
    + 'that forgets to fill it in refuses rather than authorizes');
  assert.ok(fence.indexOf('APPROVED_TIP=\n') < fence.indexOf('case "$FINAL_READING" in'),
    'and assigned before the decision reads it');
  assert.doesNotMatch(fence, /APPROVED_TIP=\$\{?APPROVED_TIP/,
    'and never seeded from an inherited value, which is what makes the empty default meaningful');

  const drifted = run('rewrite', 'refs/heads/feat/x', undefined,
    { tip: EM_TIP_NOW, approved: '1111111111111111111111111111111111111111' });
  assert.equal(drifted.status, 1,
    `a tip that moved since the iteration gate must refuse even when attested: ${drifted.stderr}`);
  assert.match(drifted.stderr, /1111111111111111111111111111111111111111/,
    'and the refusal must name the commit the approval covered');
  assert.match(drifted.stderr, new RegExp(EM_TIP_NOW),
    'and the one that is there now, or nothing says what moved');
  assert.equal(run('rewrite', 'refs/heads/feat/x', undefined, { approved: '' }).status, 1,
    'an unfilled approved-tip slot must refuse — empty is not "no constraint"');
  assert.equal(run('rewrite', 'refs/heads/feat/x', { APPROVED_TIP: EM_TIP_NOW }, { approved: '' }).status, 1,
    'and an exported one must not supply it either');
  // Negative control: the undrifted attested rewrite — the ordinary path of this entire skill —
  // must still pass. It is already row 4 of the matrix above; restating it here is what keeps the
  // three refusals above from being satisfiable by refusing every rewrite.
  assert.equal(run('rewrite', 'refs/heads/feat/x').status, 0,
    'the ordinary attested rewrite over an unmoved tip must still push');
});

// ── round-60: select the hasher, then feed it ─────────────────────────────────

// Every copy of the digest block in the document, extracted whole. They must be byte-identical:
// the fences run in different phases and a divergence would mean one destination guard is weaker
// than the other while both read as "the digest block".
function digestBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('sha256_raw() {')) continue;
    const end = lines.indexOf('done <<< "$PUSH_URLS"', i);
    assert.ok(end > i, 'a digest block must run through the per-URL loop it feeds');
    blocks.push(lines.slice(i, end + 1).join('\n'));
  }
  assert.ok(blocks.length >= 2, `expected the digest block in every push fence, found ${blocks.length}`);
  for (const b of blocks) {
    assert.equal(b, blocks[0], 'every copy of the digest block must be byte-identical');
  }
  return blocks;
}

const URL_A = 'https://gw.example/push?repo=A&token=one';
const URL_B = 'https://gw.example/push?repo=B&token=two';

// A `sha256sum` that eats stdin and fails — the shape a hostile pusher exports, and the shape any
// broken installation produces. bash imports it as a function, and a function outranks both the
// builtin and PATH, so `command -v` finds it and the pipeline hands it the input.
const EATS_AND_FAILS = { 'BASH_FUNC_sha256sum%%': '() { cat >/dev/null; return 1; }' };
// And one that answers a constant. Well-shaped, 64 hex, identical for every input — which is what
// makes the shape check in the loop useless against it and the known-answer test necessary.
const ALWAYS_EMPTY_DIGEST = {
  'BASH_FUNC_sha256sum%%': '() { cat >/dev/null; printf "%s  -\\n" '
    + 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855; }',
};

function runDigest(block, env = {}) {
  const r = spawnSync('/bin/bash', ['-c', `PUSH_URLS=$1\n${block}\nprintf '%s' "$PUSH_URLS_DIGEST"`,
    'x', `${URL_A}\n${URL_B}`], { encoding: 'utf8', env: { ...process.env, ...env } });
  return r.stdout;
}

test('the digest block when run → two destinations that differ only in the query string digest differently', () => {
  const [block] = digestBlocks(readSkill());
  const clean = runDigest(block).split(' ');
  assert.equal(clean.length, 2, 'one digest per URL — the hook is invoked once per push URL');
  for (const d of clean) assert.match(d, /^[0-9a-f]{64}$/, `each must be a SHA-256 hex digest: ${d}`);
  assert.notEqual(clean[0], clean[1],
    'and they must differ: redaction deletes the query string, so the digest is the only thing '
    + 'that can tell these two destinations apart');
});

// A `sha256sum` that answers the two known-answer vectors CORRECTLY and one fixed digest for
// every other input. This is the shape the two-vector test cannot see — it is not a constant, so
// it passes — and every real URL then digests to the same value, which is exactly a destination
// guard that compares equal on a destination that changed. Round 70's P1: `command -v` reports an
// imported function as a good command, so selecting first bought nothing while the invocation was
// still a bare word.
const COLLIDE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ADAPTIVE_DIGEST = {
  'BASH_FUNC_sha256sum%%': '() { _i=$(cat); case "$_i" in '
    + '"") printf "%s  -\\n" e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855;; '
    + 'abc) printf "%s  -\\n" ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad;; '
    + '*) printf "%s  -\\n" ' + COLLIDE + ';; esac; }',
};

// A directory whose `sha256sum` IS a genuine hasher, so `/usr/bin/env sha256sum` resolves on a
// machine that ships only `shasum` (macOS) exactly as on one that ships `sha256sum`. Without it
// these assertions would be reading a *platform* rather than the fix: with no binary to resolve,
// `env` fails, the known-answer test empties the digest and the run refuses — safe, but not the
// property under test, and green for the wrong reason on half the machines that run it.
function emHasherShimDir() {
  const _fs = require('node:fs');
  const _os = require('node:os');
  for (const [tool, args] of [['sha256sum', ''], ['shasum', ' -a 256'], ['openssl', ' dgst -sha256']]) {
    const p = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
    const real = p.status === 0 ? String(p.stdout).trim() : '';
    if (!real || !real.startsWith('/')) continue;
    const dir = _fs.mkdtempSync(resolve(_os.tmpdir(), 'em-hash-'));
    _fs.writeFileSync(resolve(dir, 'sha256sum'), `#!/bin/sh\nexec ${real}${args} "$@"\n`);
    _fs.chmodSync(resolve(dir, 'sha256sum'), 0o755);
    return dir;
  }
  return null;
}

test('the digest block under an imported hasher → ignores it, so two destinations never compare equal', () => {
  const [block] = digestBlocks(readSkill());
  if (!emFunctionImportWorks()) return;
  const shim = emHasherShimDir();
  assert.ok(shim, 'no hasher on this machine to build the shim from');
  const _rm = require('node:fs').rmSync;
  try {
    const PATH = `${shim}:${process.env.PATH}`;
    const honest = runDigest(block, { PATH }).split(' ');
    assert.equal(honest.length, 2, 'precondition: two URLs, two digests');
    assert.notEqual(honest[0], honest[1], 'precondition: and they differ');

    for (const [why, fn] of [
      ['one that eats stdin and then fails', EATS_AND_FAILS],
      ['one that answers a single well-shaped constant', ALWAYS_EMPTY_DIGEST],
      ['one that answers both known vectors and a constant for every real input', ADAPTIVE_DIGEST],
    ]) {
      assert.deepEqual(runDigest(block, { ...fn, PATH }).split(' '), honest,
        `${why}: an imported function must change nothing — the invocation goes through env`);
    }

    // The negative control, and the one that decides this. Deleting `/usr/bin/env` from the three
    // invocations restores the shape that shipped until round 70. Under the ADAPTIVE function it
    // passes the known-answer test and *then* collides — which is why the constant-only control
    // above was green through ten rounds while the hole was open.
    const bare = block.split('; then /usr/bin/env ').join('; then ');
    assert.notEqual(bare, block, 'MUTANT APPLIED: the bare-word invocation must actually be restored');
    const collided = runDigest(bare, { ...ADAPTIVE_DIGEST, PATH }).split(' ');
    assert.equal(collided.length, 2, 'precondition: the bare shape still produced two digests');
    assert.equal(collided[0], collided[1],
      'precondition: and they collided — the adaptive function passed the known-answer test');
    assert.equal(collided[0], COLLIDE, 'on the constant the adaptive function answers real input with');
  } finally {
    _rm(shim, { recursive: true, force: true });
  }
});

test('the digest block under the round-60 pipeline shape → still collides, which is why selection comes first', () => {
  // Kept from round 60, and independent of round 70's fix: `printf … | { a || b || c }` runs the
  // whole brace group with the pipe as its stdin, so `a` consumes it, fails, and `b` hashes EOF.
  const [block] = digestBlocks(readSkill());
  if (!emFunctionImportWorks()) return;
  const old = block.replace(
    /sha256_raw\(\) \{[\s\S]*?\n\}/,
    'sha256_raw() {\n  { sha256sum || shasum -a 256 || openssl dgst -sha256; }\n}',
  );
  assert.notEqual(old, block, 'MUTANT APPLIED: the fixture must actually restore the pipeline shape');
  const collided = runDigest(old.replace(/DIGEST_TOOL_OK=\n[\s\S]*?\nfi\n/, 'DIGEST_TOOL_OK=yes\n'),
    EATS_AND_FAILS).split(' ');
  assert.equal(collided.length, 2, 'precondition: the old shape still produced two digests');
  assert.equal(collided[0], collided[1],
    'precondition: and they collided — this is the defect the selection-first shape removes');
  assert.equal(collided[0], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'on the SHA-256 of the empty string, because the fallback hashed EOF');
});


// ── round-60: a step whose exit status nobody reads is not a step ─────────────

// Every `if ! <command>; then … fi` guard in the document, whole. Round 60 added three: Steps 2, 3
// and 4 were bare commands, so a failed checkout, an interrupted rebase or an unwritable manifest
// all continued into the push — publishing a branch nobody approved, or comparing against a file
// that was never written.
//
// Round 64 added the fourth, and it is the one whose failure direction is worst: the rollback's
// `git switch -C "$head" "refs/tags/backup/pr-<N>"` was bare, so a missing or unreadable backup tag
// left `refs/heads/$head` holding exactly the state the rollback was called to replace — and the
// force-push below then wrote THAT to the remote, under an approval whose question named the backup
// tag. The census is an equality rather than a floor so a fifth bare step is a failure here, and so
// that removing one of these guards cannot pass as "the count is at least three".
function guardBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^if ! \/usr\/bin\/env /.test(lines[i])) continue;
    const end = lines.indexOf('fi', i);
    assert.ok(end > i, `guard at line ${i + 1} is not terminated`);
    out.push({ block: lines.slice(i, end + 1).join('\n'), line: i + 1 });
  }
  return out;
}

// A `git` on PATH that records its argv and exits with a chosen status. `/usr/bin/env` resolves
// `git` through PATH, which is exactly how the shipped prefix invokes it.
const { writeFileSync, chmodSync, mkdirSync } = require("node:fs");

function withFakeGit(script, { gitExit = 0, env = {} } = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-guard-'));
  try {
    const rec = resolve(dir, 'rec');
    writeFileSync(resolve(dir, 'git'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(rec)}\nexit ${gitExit}\n`);
    chmodSync(resolve(dir, 'git'), 0o755);
    // `gh` too: since round 70 the guarded set includes Phase 0's PR read, and leaving `gh`
    // unfaked would send that iteration at the real GitHub API instead of at the guard.
    writeFileSync(resolve(dir, 'gh'),
      `#!/bin/sh\nprintf 'gh %s\\n' "$*" >> ${JSON.stringify(rec)}\nexit ${gitExit}\n`);
    chmodSync(resolve(dir, 'gh'), 0o755);
    writeFileSync(rec, '');
    const r = spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
    });
    return { status: r.status, stderr: r.stderr, calls: readFileSync(rec, 'utf8').trim().split('\n').filter(Boolean) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('each guarded step when its command fails → stops the run and says what is not true any more', () => {
  const guards = guardBlocks(readSkill());
  assert.equal(guards.length, 8,
    `Steps 2, 3 and 4, the rollback's local restore, Phase 0's PR read and the three cleanup `
    + `operations must each read their command's exit status, found ${guards.length} guards`);

  // Step 4 redirects into `$MANIFEST_DIR`, so the directory has to be real: pointing it at
  // something unwritable would make that guard refuse for a reason the other two never see, and
  // the "falls through" half below would fail on the environment rather than on the guard.
  const manifests = mkdtempSync(resolve(tmpdir(), 'em-steps-'));
  try {
    for (const { block, line } of guards) {
      const script = `head=feat/x\nepic=epic/x\nMANIFEST_DIR=${JSON.stringify(manifests)}\n`
        + `${block.split('<N>').join('3').split('<prev>').join('2')}\nexit 0`;

      const failed = withFakeGit(script, { gitExit: 1 });
      // NONZERO, never a specific value. The two refusal shapes in this document terminate
      // differently — `PUSH_BLOCKED=1; exit 1` exits 1, while the `${VAR:?…}` sentinel exits
      // **127** on bash 3.2 (measured 2026-08-22, GNU bash 3.2.57 arm64-apple-darwin25) and 1 on
      // newer bash. Pinning 1 would make this control read the interpreter version rather than
      // the guard, and would go red on a machine where the guard works perfectly.
      assert.notEqual(failed.status, 0, `the guard at line ${line} must stop the run when its step fails`);
      assert.ok(failed.status !== null, `and exit rather than die on a signal: line ${line}`);
      assert.match(failed.stderr, /⛔/, `and say so on stderr, not silently: line ${line}`);
      assert.match(failed.stderr, /STOP/, `and name the decision, not merely the error: line ${line}`);

      // The other direction. A guard that refused unconditionally would satisfy every assertion
      // above and break the skill outright — which is the failure round 60 itself produced once,
      // in Step 5, and the reason this control is not optional.
      const ok = withFakeGit(script, { gitExit: 0 });
      assert.equal(ok.status, 0, `the guard at line ${line} must fall through when its step succeeds`);
      assert.equal(ok.stderr, '', `and print nothing on a successful step: line ${line}`);
    }
  } finally {
    rmSync(manifests, { recursive: true, force: true });
  }
});

test('the manifest comparison when the two manifests differ → restores from the backup tag and refuses', () => {
  // The promise "Mismatch → STOP + restore" was a `#` comment under a bare `diff`, so a mismatch
  // printed its diff and the fence pushed the branch anyway. And `diff` is a command word an
  // imported `BASH_FUNC_diff%%` outranks, so a forged exit 0 was equally unread — which is why the
  // shipped form calls `/usr/bin/diff` by absolute path.
  const skill = readSkill();
  const start = skill.indexOf('if ! /usr/bin/diff ');
  assert.ok(start > 0, 'the manifest comparison must read its own exit status');
  const guard = skill.slice(start, skill.indexOf('\n\n# Step 5', start));
  assert.ok(guard.includes('exit 1'), 'and refuse on a mismatch');

  const dir = mkdtempSync(resolve(tmpdir(), 'em-manifest-'));
  try {
    writeFileSync(resolve(dir, 'expected-pr-3.manifest'), 'feat: the approved subject\n');
    writeFileSync(resolve(dir, 'actual-pr-3.manifest'), 'feat: something else entirely\n');
    const script = `head=feat/x\nMANIFEST_DIR=${JSON.stringify(dir)}\n`
      + `${guard.split('<N>').join('3')}\nexit 0`;

    // The restore is itself a git command, so the fake answers it — succeeding, which is the
    // ordinary case: the branch goes back to its backup tag and the run still refuses.
    const r = withFakeGit(script, { gitExit: 0 });
    assert.equal(r.status, 1, 'a mismatch must refuse — the comment said STOP and now the code does');
    assert.match(r.stderr, /manifest mismatch for PR 3/, 'and name the PR whose branch is not the approved one');
    assert.ok(r.calls.some((c) => c.includes('switch -C feat/x refs/tags/backup/pr-3')),
      `the restore must actually run: ${JSON.stringify(r.calls)}`);
    assert.ok(!r.calls.some((c) => c.includes('push')), 'and nothing may be pushed');

    // When the restore ALSO fails, the operator is told the tree is in neither state — the one
    // outcome where doing nothing further is the correct move.
    const broken = withFakeGit(script, { gitExit: 1 });
    assert.equal(broken.status, 1, 'still refuses');
    assert.match(broken.stderr, /restore FAILED/, 'and reports that the recovery did not happen');

    // Positive control: identical manifests fall straight through, so the refusal above is the
    // comparison talking and not the fence refusing everything.
    writeFileSync(resolve(dir, 'actual-pr-3.manifest'), 'feat: the approved subject\n');
    const clean = withFakeGit(script, { gitExit: 0 });
    assert.equal(clean.status, 0, 'a matching manifest must proceed');
    assert.equal(clean.calls.length, 0, 'and must not restore anything');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-61: the variable that names the transport chooses the destination ───

// The canonical `env -u …` flag list, taken from the document rather than restated here — a test
// that carried its own copy would stay green after the document dropped a flag.
function stripFlags(text) {
  const m = text.match(/\/usr\/bin\/env ((?:-u [A-Z_]+ )+)/);
  assert.ok(m, 'the canonical env prefix must be findable in the document');
  return m[1].trim().split(' ').filter((w) => w !== '-u');
}

// git resolves `ssh` through PATH when no transport variable is set, so a fake one there is what
// "the ordinary transport" looks like: it exits immediately and records nothing. The wrapper is the
// hijack, and the recording file is the whole assertion — a non-empty record means git handed the
// connection to a program the operator's approval never named.
test('the canonical env prefix when a transport variable is exported → git never runs the hijacker', () => {
  const flags = stripFlags(readSkill());
  for (const name of ['GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_PROXY_COMMAND', 'GIT_SSH_VARIANT']) {
    assert.ok(flags.includes(name),
      `${name} decides how or where git's transport runs, so leaving it bindable lets the `
      + `environment reach a push whose URL was approved and digested. Three of the four name a `
      + `program run IN PLACE OF the connection — measured 2026-08-22 on git 2.55.0, argv `
      + `[approved.example] [git-receive-pack '/team/a.git']. GIT_SSH_VARIANT names no program at `
      + `all: it tells git which command line to BUILD for the one it chose, which is why the `
      + `"names an executable" wording this message used to carry was false for it`);
  }
  // The boundary, asserted so the list cannot quietly grow into the operator's own setup.
  assert.ok(!flags.includes('GIT_ASKPASS'),
    'GIT_ASKPASS is handed a prompt and returns a credential; it cannot select a remote');

  const dir = mkdtempSync(resolve(tmpdir(), 'transport-'));
  try {
    const bin = resolve(dir, 'bin');
    const repo = resolve(dir, 'repo');
    const rec = resolve(dir, 'rec');
    require('node:fs').mkdirSync(bin);
    require('node:fs').mkdirSync(repo);
    const write = (p, body) => {
      require('node:fs').writeFileSync(p, body);
      require('node:fs').chmodSync(p, 0o755);
    };
    write(resolve(bin, 'ssh'), '#!/bin/sh\nexit 128\n');
    write(resolve(dir, 'hijack.sh'), `#!/bin/sh\nprintf 'INVOKED %s\\n' "$*" >> ${JSON.stringify(rec)}\nexit 128\n`);
    const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
    // Identity inline, as every other temp repo in this suite pins it: a CI runner carries no
    // global git identity, so a bare seed commit fails there, HEAD never exists, and the push
    // dies client-side before the transport — which makes the hijack precondition below read
    // vacuously empty instead of measuring anything (the 2026-08-24 CI red).
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'seed', '--no-gpg-sign');

    const PATH = `${bin}:${process.env.PATH}`;
    const URL = 'ssh://approved.example/team/approved.git';
    const push = ['push', '--dry-run', URL, 'HEAD:refs/heads/main'];
    const run = (envFlags) => {
      require('node:fs').writeFileSync(rec, '');
      spawnSync('/usr/bin/env', [...envFlags.flatMap((n) => ['-u', n]), 'git', '-C', repo, ...push], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: resolve(dir, 'hijack.sh'),
        },
      });
      return require('node:fs').readFileSync(rec, 'utf8');
    };

    // MUTANT APPLIED, and it is the finding: with the transport variable left bindable, an
    // inherited value takes the connection away from the URL that was approved and hashed.
    const unstripped = run(flags.filter((n) => !n.startsWith('GIT_SSH') && n !== 'GIT_PROXY_COMMAND'));
    assert.match(unstripped, /INVOKED/,
      'precondition: without the strip, git really does hand the push to the exported wrapper — '
      + 'the flag list is not merely decorative here');

    assert.equal(run(flags), '',
      'and with the shipped flag list the wrapper is never reached: the push goes to the remote the '
      + 'approval named, or it fails — never silently elsewhere');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-62: the transport variable that names no executable ────────────────

// GIT_SSH_VARIANT is the one member of the transport set that names nothing runnable, which is
// exactly why round 61's argument ("git runs it AS the connection") did not reach it and the list
// shipped one short. What it changes is the argv git BUILDS for whichever transport does run, and
// the consequence is a port — so this test asserts on a real argv and a real port rather than on
// membership alone. Measured 2026-08-22, git 2.55.0 / OpenSSH 10.3p1: `-P` is a *tag* in OpenSSH
// (`ssh` usage: `[-P tag]`), so a URL's port is dropped and the connection falls back to 22.
test('an inherited GIT_SSH_VARIANT → the canonical prefix keeps the URL port in the transport argv', () => {
  const flags = stripFlags(readSkill());
  assert.ok(flags.includes('GIT_SSH_VARIANT'),
    'GIT_SSH_VARIANT selects how git spells the transport command line, so it decides which port '
    + 'the connection reaches — a redirection with no error message and no failed push');

  const dir = mkdtempSync(resolve(tmpdir(), 'variant-'));
  try {
    const bin = resolve(dir, 'bin');
    const repo = resolve(dir, 'repo');
    const rec = resolve(dir, 'rec');
    require('node:fs').mkdirSync(bin);
    require('node:fs').mkdirSync(repo);
    // The fake transport records the argv git handed it and then fails, so nothing leaves the
    // machine and the assertion is about the command line rather than about a connection.
    require('node:fs').writeFileSync(resolve(bin, 'ssh'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(rec)}\nexit 128\n`);
    require('node:fs').chmodSync(resolve(bin, 'ssh'), 0o755);
    spawnSync('git', ['init', '-q', repo], { encoding: 'utf8' });
    // Identity inline for the same reason as the transport test above: no HEAD, no push, no argv.
    spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid',
      'commit', '-q', '--allow-empty', '-m', 'seed', '--no-gpg-sign'], { encoding: 'utf8' });

    const URL = 'ssh://approved.example:2222/team/approved.git';
    const run = (stripped) => {
      require('node:fs').writeFileSync(rec, '');
      spawnSync('/usr/bin/env', [
        ...stripped.flatMap((n) => ['-u', n]),
        'git', '-C', repo, 'push', '--dry-run', URL, 'HEAD:refs/heads/main',
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_VARIANT: 'plink',
        },
      });
      return require('node:fs').readFileSync(rec, 'utf8');
    };

    // MUTANT APPLIED — the finding itself: leave this one name bindable and the port the approved
    // URL named is gone from the command line git builds.
    const unstripped = run(flags.filter((n) => n !== 'GIT_SSH_VARIANT'));
    assert.match(unstripped, /(^| )-P 2222( |$)/m,
      'precondition: with GIT_SSH_VARIANT left bindable, git emits OpenSSH\'s -P (a tag) where the '
      + 'port belongs — if this stops holding, git or ssh changed and the strip needs re-measuring, '
      + 'not deleting');
    assert.doesNotMatch(unstripped, /(^| )-p 2222( |$)/m,
      'precondition: and the real port flag is absent, which is why the connection lands on 22');

    // And with the document's own list applied, the port survives into the argv.
    const stripped = run(flags);
    assert.match(stripped, /(^| )-p 2222( |$)/m,
      'the canonical prefix must restore git\'s own transport spelling, port and all');
    assert.doesNotMatch(stripped, /(^| )-P 2222( |$)/m,
      'and the plink spelling must be gone — asserted in both directions so a list that strips the '
      + 'name while some other change re-introduces the spelling cannot pass on the first half alone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The Phase 0 refusal, run as shell rather than read as prose. Extracted from the document so a
// block that is edited, reworded or deleted is tested as it now stands — or fails to be found.
function transportGuardBlock() {
  const m = readSkill().match(/TRANSPORT_PRESENT=\n[\s\S]*?\n  : "\$\{SD0X_[A-Z0-9_]+_REFUSED:\?[^\n]*\}"\nfi\n/);
  assert.ok(m, 'the Phase 0 transport refusal must be present in the document');
  return m[0];
}

test('the Phase 0 transport refusal → refuses on set-ness, names the variable, never its value', () => {
  const block = transportGuardBlock();
  const dir = mkdtempSync(resolve(tmpdir(), 'guard-'));
  try {
    const script = resolve(dir, 'guard.sh');
    require('node:fs').writeFileSync(script, `${block}\necho PROCEED\n`);
    const run = (env) => spawnSync('/bin/bash', [script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    });

    const clean = run({});
    assert.equal(clean.status, 0, 'a clean environment must not be refused');
    assert.match(clean.stdout, /PROCEED/, 'and execution must continue past the block');

    // Set-ness, not emptiness. An exported-empty GIT_SSH_COMMAND is not "unset" to git — measured,
    // it runs the empty string as the connection command — so a `-n "$VAR"` test here would wave
    // through the case that breaks the transport outright.
    const empty = run({ GIT_SSH_COMMAND: '' });
    assert.equal(empty.status, 1, 'an exported-but-empty transport variable must still refuse');
    assert.match(empty.stderr, /GIT_SSH_COMMAND/, 'and the refusal must name it');

    for (const name of ['GIT_SSH_COMMAND', 'GIT_SSH', 'GIT_PROXY_COMMAND', 'GIT_SSH_VARIANT']) {
      const r = run({ [name]: '/x/y' });
      assert.equal(r.status, 1, `${name} set must refuse`);
      assert.match(r.stderr, new RegExp(name), `${name} must be named in the refusal`);
      assert.doesNotMatch(r.stdout, /PROCEED/, `${name} set must not fall through`);
    }

    const two = run({ GIT_SSH_COMMAND: '/x', GIT_PROXY_COMMAND: '/y' });
    assert.match(two.stderr, /GIT_SSH_COMMAND, GIT_PROXY_COMMAND/,
      'two set → both named, in the order the block lists them, so the operator is not sent to fix '
      + 'one and hit the same refusal again');

    // Anchor Register #2: the refusal reports names and never values. A transport command line
    // routinely carries a key path, and this block is the one that prints under failure.
    const secretish = run({ GIT_SSH_COMMAND: 'ssh -i /home/me/.ssh/id_deploy_key' });
    assert.doesNotMatch(`${secretish.stdout}${secretish.stderr}`, /id_deploy_key/,
      'the refusal must not echo the value — names locate the problem, values leak the credential');
    assert.match(secretish.stderr, /GIT_SSH_COMMAND/,
      'control: the same run does name the variable, so the assertion above is about the value and '
      + 'not about a block that printed nothing at all');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-63: the reads pin who answers them ─────────────────────────────────

// The pushes have pinned `--receive-pack=git-receive-pack` for many rounds. The reads that decide
// what to push pinned nothing, and `remote.<name>.uploadpack` redirects a read wholesale — measured
// 2026-08-22 on git 2.55.0: with `remote.x.url` pointing at a path that does not exist and
// `remote.x.uploadpack` pointing at this repository, `git ls-remote x HEAD` printed this
// repository's refs and exited 0, while the same call with `--upload-pack=git-upload-pack` failed
// 128. Asserted over every read rather than at the sites that needed it, because a read added later
// is exactly the one nobody thinks to pin.
test('every fetch and ls-remote in the document → pins the program that answers it', () => {
  const reads = readSkill().split('\n').filter((l) => /(^|\s)git (fetch|ls-remote) /.test(l)
    && !/`/.test(l) && !/^\s*#/.test(l) && !/^\s*\$ /.test(l));
  assert.ok(reads.length > 0, 'precondition: the document must contain reads to pin');
  // `ls-remote --get-url` answers without contacting anything — it expands the URL through the
  // rewrite table and exits (measured 2026-08-22). Pinning an upload-pack that never runs would be
  // noise, so the two forms split and each takes the assertion true of it. The `--get-url` half is
  // a REFUSAL rather than an exemption: a line that grew an `--upload-pack` is no longer the local
  // expansion the exemption was granted for, and would otherwise stop being pinned at all.
  const getUrl = reads.filter((l) => /ls-remote --get-url/.test(l));
  const network = reads.filter((l) => !/ls-remote --get-url/.test(l));
  assert.ok(getUrl.length > 0, 'precondition: round 76 added the local URL re-probes');
  assert.ok(network.length > 0, 'precondition: the document must contain network reads to pin');
  for (const line of getUrl) {
    assert.doesNotMatch(line, /--upload-pack/,
      'a --get-url expansion contacts nothing, so naming an upload-pack would mean it is no longer '
      + `the local read this exemption was granted for: ${line}`);
  }
  for (const line of network) {
    assert.match(line, /--upload-pack=git-upload-pack/,
      'a read whose answering program is left to configuration can be served by another repository '
      + `while the URL still reads as origin — the push would then act on refs from elsewhere: ${line}`);
  }
  // The boundary, so the pin cannot quietly become a different program.
  for (const line of reads) {
    assert.doesNotMatch(line, /--upload-pack=(?!git-upload-pack)/,
      `the pin must name git's own upload-pack, not a path: ${line}`);
  }
});

// ── round-63: Phase 1 and Iteration 1 propagate step failure ─────────────────

// A `for` loop's exit status is its LAST iteration's, so a backup tag that failed for PR 1 and
// succeeded for PR 2 left the fence reporting success with no rollback point for PR 1. A bare
// command followed by another bare command is erased the same way: iteration 1's squash merge was
// followed by a fetch, and the fetch's success was the fence's answer.
//
// These are executed rather than read, because the property is about exit status — a regex over the
// text would be satisfied by a guard that records nothing. Each case ships with its negative
// control: the same fence with the guards stripped must exit 0 on the same failure, which is the
// pre-fix behaviour. The strip is asserted to have applied, so a mutation expression that matched
// nothing cannot pass itself off as a proof.
function fakeBin(dir, name, body) {
  writeFileSync(resolve(dir, name), `#!/bin/sh\n${body}\n`);
  chmodSync(resolve(dir, name), 0o755);
}

function runFence(script, { ghExit = 0, gitExit = 0 } = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-phase1-'));
  try {
    const manifests = resolve(dir, 'manifests');
    const rec = resolve(dir, 'rec');
    writeFileSync(rec, '');
    // `git rev-parse --git-path` must answer with a real writable path: the manifest loop redirects
    // into it, so a failure there would be the environment refusing rather than the guard.
    fakeBin(dir, 'git', `printf 'git %s\\n' "$*" >> ${JSON.stringify(rec)}\n`
      + `case "$*" in *--git-path*) printf '%s\\n' ${JSON.stringify(manifests)};; esac\nexit ${gitExit}`);
    fakeBin(dir, 'gh', `printf 'gh %s\\n' "$*" >> ${JSON.stringify(rec)}\nprintf 'feat/x\\n'\nexit ${ghExit}`);
    const r = spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    return { status: r.status, stderr: r.stderr, calls: readFileSync(rec, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The document's placeholders are not shell — `<PR-numbers>` and `<first-PR>` are filled in by the
// model at run time. Substituting them is what makes the fence runnable; nothing else is changed.
function runnableFence(marker) {
  const fences = [...readSkill().matchAll(/```bash\n([\s\S]*?)```/g)].map((mm) => mm[1]);
  const hit = fences.filter((f) => f.includes(marker));
  assert.equal(hit.length, 1, `expected exactly one fence containing ${marker}, saw ${hit.length}`);
  return hit[0].split('<PR-numbers>').join('101 102')
    .split('<first-PR>').join('101')
    .split('<quoted epic>').join('"epic/x"');
}

// Strips the recording guards without touching anything else. Anchored on the flag assignment
// rather than on the first `}`, because the messages interpolate `${pr}` and a lazy match to the
// first brace would cut a string in half and produce a syntax error instead of a mutant.
const STRIP_GUARDS = / \|\| \{ echo "⛔[^\n]*(?:PHASE1_OK|ITER1_OK)=;[^\n]*?\}/g;

test('Phase 1 when a step fails for one PR → the fence reports failure, not the last PR', () => {
  const fence = runnableFence('# Collision-safe backup tags keyed by PR number');
  assert.ok(fence.includes('PHASE1_OK'), 'precondition: the fence must carry a verdict flag');

  assert.equal(runFence(fence).status, 0,
    'control: with every command succeeding the fence must report success');

  const tagFailed = runFence(fence, { gitExit: 1 });
  assert.notEqual(tagFailed.status, 0,
    'a failed `git tag` leaves no rollback point, so the fence must not report success');
  assert.match(tagFailed.stderr, /backup tag not created/,
    'the refusal must say what is not true any more, not merely fail');

  const ghFailed = runFence(fence, { ghExit: 1 });
  assert.notEqual(ghFailed.status, 0, 'a failed `gh pr view` must fail the fence too');

  // Negative control. The final `[[ -n "$PHASE1_OK" ]]` survives the strip, so the flag is still 1
  // and the fence passes — exactly the pre-fix behaviour: a failure nobody recorded.
  const mutant = fence.replace(STRIP_GUARDS, '');
  assert.notEqual(mutant, fence, 'the mutation must have applied');
  assert.ok(!mutant.includes('PHASE1_OK=;'), 'the mutant must have removed every recording guard');
  assert.equal(runFence(mutant, { gitExit: 1 }).status, 0,
    'unguarded, the same failure goes unreported — that is the defect being pinned');
});

test('Iteration 1 when the squash merge fails → the fence fails and the fetch never runs', () => {
  const fence = runnableFence('gh pr merge <first-PR> --squash');
  assert.ok(fence.includes('ITER1_OK'), 'precondition: the fence must carry a verdict flag');

  const ok = runFence(fence);
  assert.equal(ok.status, 0, 'control: everything succeeding must report success');
  assert.match(ok.calls, /git fetch /, 'control: the fetch does run when the merge succeeded');

  const failed = runFence(fence, { ghExit: 1 });
  assert.notEqual(failed.status, 0,
    'a failed squash merge must fail the fence — the fetch that follows must not answer for it');
  assert.match(failed.stderr, /the epic branch is unchanged/,
    'the refusal must state what did not happen');
  assert.doesNotMatch(failed.calls, /git fetch /,
    'the fetch is reached only through the flag, so a failed merge must skip it');

  const mutant = fence.replace(STRIP_GUARDS, '');
  assert.notEqual(mutant, fence, 'the mutation must have applied');
  assert.equal(runFence(mutant, { ghExit: 1 }).status, 0,
    'unguarded, the failed merge is erased by the fetch — the defect this pins');
});

// ── Round 65 #3: Step 8 binds the merge to what CI actually passed ───────────────────────────
//
// Round 64 made the CI wait a fence boundary, so Step 8 can no longer run before a PASS verdict.
// What it still could not say is that the verdict is about the thing being merged. `/watch-ci`
// waits minutes; the PR is mutable throughout and afterwards. A collaborator pushing to the head
// branch, or anyone retargeting the PR, left `gh pr merge "<N>" --squash` merging a commit nothing
// tested — or merging it into a base nobody approved — on a fence that reads as though it waited
// for exactly this.
//
// Two bindings, two instruments, because the PR can move in two ways:
//   * head — `--match-head-commit`, checked BY GITHUB at merge time. A local comparison would read
//     the head, then merge, and lose the race in between.
//   * base — re-read immediately before the merge and compared. gh has no `--match-base`, so the
//     residual window is real and the fence says so rather than implying otherwise.
function step8Fence(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('# Step 8: Squash merge'));
  assert.ok(start >= 0, 'Step 8 is not where this test expects it');
  const end = lines.findIndex((l, i) => i > start && l.startsWith('# Step 9:'));
  assert.ok(end > start, 'Step 8 has no Step 9 after it — the slice would swallow the fetch');
  return lines.slice(start, end).join('\n');
}

// Runs Step 8 with `gh` stubbed, so what is measured is the fence's control flow rather than
// GitHub's. `mutate` exists for the negative controls: a guard nobody can delete is a guard nobody
// has tested.
function runStep8({
  epic = 'epic/stack', ciSha = 'a'.repeat(40), baseNow = 'epic/stack', viewExit = 0,
  mergeExit = 0, mutate,
} = {}) {
  let fence = step8Fence(readSkill())
    .replace('<quoted epic>', JSON.stringify(epic))
    .replace('<the PR_HEAD_SHA value the previous fence printed, quoted>', JSON.stringify(ciSha))
    .split('"<N>"').join('"41"');
  assert.ok(!fence.includes('<quoted epic>') && !fence.includes('"<N>"')
    && !fence.includes('<the PR_HEAD_SHA'), 'a placeholder survived substitution');
  if (mutate) {
    const before = fence;
    fence = mutate(fence);
    assert.notEqual(fence, before, 'the mutant did not apply — an unapplied mutant reads as a pass');
  }
  const dir = mkdtempSync(resolve(tmpdir(), 'epic-step8-'));
  try {
    const bin = resolve(dir, 'bin');
    mkdirSync(bin);
    const rec = resolve(dir, 'gh-calls.txt');
    writeFileSync(rec, '');
    writeFileSync(resolve(bin, 'gh'), [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$REC"',
      'case "$2" in',
      '  view) [ "$VIEW_EXIT" -eq 0 ] || exit "$VIEW_EXIT"; printf "%s" "$BASE_NOW_STUB" ;;',
      '  merge) exit "$MERGE_EXIT" ;;',
      'esac',
      '',
    ].join('\n'));
    chmodSync(resolve(bin, 'gh'), 0o755);
    const script = resolve(dir, 'step8.sh');
    writeFileSync(script, fence + '\nprintf "MERGE_BLOCKED=[%s]\\n" "$MERGE_BLOCKED"\n');
    const run = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: process.env.HOME,
        REC: rec,
        BASE_NOW_STUB: baseNow,
        VIEW_EXIT: String(viewExit),
        MERGE_EXIT: String(mergeExit),
      },
    });
    return {
      out: String(run.stdout),
      err: String(run.stderr),
      calls: readFileSync(rec, 'utf8'),
      blocked: !/^MERGE_BLOCKED=\[\]$/m.test(String(run.stdout)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Step 8 when the base still matches and a SHA was carried → merges, bound to that SHA', () => {
  const sha = 'a'.repeat(40);
  const r = runStep8({ ciSha: sha });
  assert.equal(r.blocked, false, `the ordinary path must not be blocked: ${r.err}`);
  assert.match(r.calls, new RegExp(`pr merge 41 --squash --match-head-commit ${sha}`),
    'the merge must carry the flag GitHub checks, not just the PR number');
});

test('Step 8 when no SHA was carried into the fence → refuses, and never calls merge', () => {
  const r = runStep8({ ciSha: '' });
  assert.equal(r.blocked, true, 'an empty CI_PASSED_SHA means no verdict can be tied to anything');
  assert.doesNotMatch(r.calls, /pr merge/, 'a refusal that still merges is not a refusal');
  assert.match(r.err, /cannot be tied to this merge/);
  assert.match(r.err, /none carried into this fence/,
    'the operator has to be told which of the two bindings failed');
});

test('Step 8 when the PR was retargeted while CI ran → refuses, naming both bases', () => {
  const r = runStep8({ epic: 'epic/stack', baseNow: 'main' });
  assert.equal(r.blocked, true, 'a PASS verdict is about a base as much as about a commit');
  assert.doesNotMatch(r.calls, /pr merge/);
  assert.match(r.err, /PR base now:\s+main\s+expected:\s+epic\/stack/,
    'both values, or the operator cannot see which way the PR moved');
});

test('Step 8 when the base cannot be read → refuses (fail-closed, not fall-through)', () => {
  const r = runStep8({ viewExit: 1 });
  assert.equal(r.blocked, true, 'an unreadable base is not evidence that the base is unchanged');
  assert.doesNotMatch(r.calls, /pr merge/);
  assert.match(r.err, /unreadable/);
});

test('Step 8 when GitHub rejects the head match → blocks the iteration, not just the merge', () => {
  const r = runStep8({ mergeExit: 1 });
  assert.equal(r.blocked, true,
    'the epic branch is unchanged, so the next iteration must not rebase onto it');
  assert.match(r.calls, /pr merge/, 'precondition: this case is about the merge being attempted');
  assert.match(r.err, /head no longer matches the commit CI/);
});

// Negative controls. Both guards are one deletion away from silence, and without these the four
// cases above stay green on a fence that merges whatever it is handed.
test('Step 8 control: without --match-head-commit the merge is no longer bound to the SHA', () => {
  const r = runStep8({ mutate: (f) => f.replace(' --match-head-commit "$CI_PASSED_SHA"', '') });
  assert.equal(r.blocked, false, 'precondition: the mutant must still reach the merge');
  assert.doesNotMatch(r.calls, /--match-head-commit/,
    'control failed: the flag is coming from somewhere other than the line under test');
});

test('Step 8 control: without the binding check an empty SHA reaches the merge', () => {
  const r = runStep8({
    ciSha: '',
    mutate: (f) => f.replace('if [[ -z "$CI_PASSED_SHA" ]] || [[ "$BASE_NOW" != "$epic" ]]; then',
      'if false; then'),
  });
  assert.doesNotMatch(r.err, /cannot be tied to this merge/, 'precondition: the guard is disabled');
  assert.match(r.calls, /pr merge/,
    'control failed: something other than the binding check is stopping the empty-SHA merge');
});

// ── Round 66 #1: a refresh whose failure nothing reads ───────────────────────────────────────
//
// Three fences ran `git fetch` to move `refs/remotes/origin/$epic` and then reported the status of
// the MERGE. A merge that succeeded followed by a fetch that did not therefore exited 0, and the
// next iteration rebased onto the pre-merge tip and force-pushed the result — history without the
// PR that had just been merged in it. The two executable ones are pinned below; the third is in
// § Recovery's resume block, which is prose the operator runs by hand and is checked structurally
// by the rebase-destination test above.
function fenceAfter(text, heading) {
  const lines = text.split('\n');
  const h = lines.findIndex((l) => l.startsWith(heading));
  assert.ok(h >= 0, `${heading} is not in the document`);
  const open = lines.indexOf('```bash', h);
  assert.ok(open > h, `no bash fence after ${heading}`);
  const close = lines.indexOf('```', open + 1);
  assert.ok(close > open, `unterminated fence after ${heading}`);
  return lines.slice(open + 1, close).join('\n');
}

// One harness for both fences: `gh` and `git` stubbed, each with its own exit status, so the four
// combinations of (merge, fetch) can be driven independently. The fence's own last line is its
// exit status, which is the thing under test — `$?` is read immediately after it.
function runMergeFence(fence, { mergeExit = 0, fetchExit = 0 } = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'epic-refresh-'));
  try {
    const bin = resolve(dir, 'bin');
    mkdirSync(bin);
    const rec = resolve(dir, 'calls.txt');
    writeFileSync(rec, '');
    writeFileSync(resolve(bin, 'gh'), [
      '#!/bin/sh',
      'printf "gh %s\\n" "$*" >> "$REC"',
      'case "$2" in',
      '  view) printf "%s" "$BASE_NOW_STUB" ;;',
      '  merge) exit "$MERGE_EXIT" ;;',
      'esac',
      '',
    ].join('\n'));
    writeFileSync(resolve(bin, 'git'), [
      '#!/bin/sh',
      'printf "git %s\\n" "$*" >> "$REC"',
      'for a in "$@"; do [ "$a" = fetch ] && exit "$FETCH_EXIT"; done',
      'exit 0',
      '',
    ].join('\n'));
    chmodSync(resolve(bin, 'gh'), 0o755);
    chmodSync(resolve(bin, 'git'), 0o755);
    const script = resolve(dir, 'fence.sh');
    writeFileSync(script, fence + '\nprintf "FENCE_EXIT=[%s]\\n" "$?"\n');
    const run = spawnSync('bash', [script], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: process.env.HOME,
        REC: rec,
        BASE_NOW_STUB: 'epic/stack',
        MERGE_EXIT: String(mergeExit),
        FETCH_EXIT: String(fetchExit),
      },
    });
    const m = String(run.stdout).match(/^FENCE_EXIT=\[(\d+)\]$/m);
    assert.ok(m, `the fence did not reach its status line: ${run.stdout}${run.stderr}`);
    return { status: Number(m[1]), out: String(run.stdout), err: String(run.stderr), calls: readFileSync(rec, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function iteration1Fence() {
  return fenceAfter(readSkill(), '#### Iteration 1 (First PR) — direct squash, no rebase')
    .split('<first-PR>').join('41')
    .replace('<quoted epic>', '"epic/stack"');
}

function step8Through9Fence() {
  const lines = readSkill().split('\n');
  const start = lines.findIndex((l) => l.startsWith('# Step 8: Squash merge'));
  assert.ok(start >= 0, 'Step 8 is not where this test expects it');
  const close = lines.indexOf('```', start);
  assert.ok(close > start, 'the Step 8 fence is unterminated');
  return lines.slice(start, close).join('\n')
    .replace('<quoted epic>', '"epic/stack"')
    .replace('<the PR_HEAD_SHA value the previous fence printed, quoted>', `"${'a'.repeat(40)}"`)
    .split('"<N>"').join('"41"')
    .split('<N>').join('41');
}

test('iteration 1 when the merge and the refresh both succeed → the fence exits zero', () => {
  const r = runMergeFence(iteration1Fence());
  assert.equal(r.status, 0, `the ordinary path must not be blocked: ${r.err}`);
  assert.match(r.calls, /git .*fetch/, 'precondition: the refresh must actually be attempted');
});

test('iteration 1 when the merge succeeds but the refresh fails → the fence exits non-zero', () => {
  const r = runMergeFence(iteration1Fence(), { fetchExit: 1 });
  assert.notEqual(r.status, 0,
    'a merged PR with a stale origin/$epic must stop the run — iteration 2 reads that ref');
  assert.match(r.err, /refreshing refs\/remotes\/origin/,
    'and must say which half failed: the merge stands, the refresh did not');
  assert.doesNotMatch(r.err, /the squash merge failed/,
    'the message must not blame the merge, which succeeded — the repairs are different');
});

test('iteration 1 when the merge fails → the refresh is not even attempted', () => {
  const r = runMergeFence(iteration1Fence(), { mergeExit: 1 });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.calls, /git .*fetch/,
    'fetching after a failed merge would move the ref the next iteration trusts');
});

// Negative control: put the old shape back — the final test reading only the merge flag — and the
// masked failure returns. Without this, the case above is green on any fence that happens to exit
// non-zero, and says nothing about which line is doing the work.
test('iteration 1 control: with the refresh conjunct removed, a failed fetch exits zero', () => {
  const fence = iteration1Fence();
  const OLD = '[[ -n "$ITER1_OK" ]] && [[ -n "$ITER1_REFRESHED" ]]';
  assert.ok(fence.includes(OLD), 'the exit-status line is not where this control expects it');
  const weakened = fence.replace(OLD, '[[ -n "$ITER1_OK" ]]');
  assert.notEqual(weakened, fence, 'the mutant did not apply — an unapplied mutant reads as a pass');
  const r = runMergeFence(weakened, { fetchExit: 1 });
  assert.equal(r.status, 0,
    'control failed: something other than the second conjunct is reporting the fetch failure');
});

test('step 9 when the merge succeeds but the refresh fails → the fence exits non-zero', () => {
  const r = runMergeFence(step8Through9Fence(), { fetchExit: 1 });
  assert.notEqual(r.status, 0,
    'the iteration after this one rebases onto origin/$epic; a stale ref must not read as done');
  assert.match(r.err, /Step 9/, 'and the message must name the step that failed');
});

test('step 9 when everything succeeds → the fence exits zero', () => {
  const r = runMergeFence(step8Through9Fence());
  assert.equal(r.status, 0, `the ordinary path must not be blocked: ${r.err}`);
  assert.match(r.calls, /gh .*pr merge/, 'precondition: the merge must have been attempted');
  assert.match(r.calls, /git .*fetch/, 'precondition: the refresh must have been attempted');
});

test('step 9 control: without the failure branch a failed fetch exits zero', () => {
  const fence = step8Through9Fence();
  const OLD = '    MERGE_BLOCKED=1\n  fi\nfi\n[[ -z "$MERGE_BLOCKED" ]]';
  assert.ok(fence.includes(OLD), 'the step 9 failure branch is not where this control expects it');
  const weakened = fence.replace(OLD, '    :\n  fi\nfi\n[[ -z "$MERGE_BLOCKED" ]]');
  assert.notEqual(weakened, fence, 'the mutant did not apply — an unapplied mutant reads as a pass');
  const r = runMergeFence(weakened, { fetchExit: 1 });
  assert.equal(r.status, 0,
    'control failed: something other than that assignment is reporting the fetch failure');
});

// ── Round 66 #2: the transport guard, in the shell it is actually run in ─────────────────────
//
// Step 0a was rewritten in round 65 to drop `${!name+set}`; this block, one step later, kept it.
// zsh 5.9 rejects that expansion outright, so under the platform's default shell the loop died at
// its first iteration — this refusal never ran, and neither did the rest of Phase 0. The bash
// battery above could not see it, because it spawns bash.
test('the transport refusal under zsh → refuses when set, and falls through when not', () => {
  if (spawnSync('zsh', ['-c', 'exit 0'], { stdio: 'pipe' }).status !== 0) return;
  const block = transportGuardBlock();
  const dir = mkdtempSync(resolve(tmpdir(), 'guard-zsh-'));
  try {
    const script = resolve(dir, 'guard.sh');
    writeFileSync(script, `${block}\necho PROCEED\n`);
    const run = (env) => spawnSync('zsh', [script], {
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    });

    const clean = run({});
    assert.equal(clean.status, 0, `a clean zsh must not be refused: ${clean.stderr}`);
    assert.match(clean.stdout, /PROCEED/, 'and execution must continue past the block');
    assert.doesNotMatch(clean.stderr, /bad substitution/,
      'a bash-only expansion aborts zsh before the check runs, whatever is set');

    const set = run({ GIT_SSH_COMMAND: 'ssh -i /home/me/.ssh/id_deploy_key' });
    assert.notEqual(set.status, 0, 'a set transport variable must refuse under zsh too');
    assert.match(set.stderr, /GIT_SSH_COMMAND/, 'and the refusal must name it');
    assert.doesNotMatch(`${set.stdout}${set.stderr}`, /id_deploy_key/,
      'names locate the problem, values leak the credential (Anchor Register #2)');
    assert.doesNotMatch(set.stdout, /PROCEED/, 'and must not fall through');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Round 67 #3: the iteration gate binds `head` and `epic` itself, and refuses when it cannot ─
//
// Step 0's bindings are gone by the time this fence runs — it is a separate shell — and both names
// reach a command line. Unset, `"refs/heads/${head}"` is `refs/heads/` and
// `"refs/remotes/origin/${epic}"` is `refs/remotes/origin/`: the per-step classifier reads the
// empty remote answer as a branch creation, the bundled one degrades to `unknown`, and either
// verdict is about an empty name rather than about the iteration being approved.
test('the iteration gate when a name is unbound → refuses instead of classifying an empty ref', () => {
  for (const [why, names] of [
    ['head is unbound', { head: '', epic: 'epic/x' }],
    ['epic is unbound', { head: 'feat/pr-3', epic: '' }],
    ['both are unbound', { head: '', epic: '' }],
  ]) {
    const r = runEpicProbe(probeFence('NEW_HEAD='), { ...names, lsOut: TIP_LINE });
    assert.notEqual(r.status, 0, `${why} must refuse by status`);
    assert.doesNotMatch(r.stdout, /^ITER_READING=/m,
      `${why} must not report a reading about a ref name nobody bound`);
    assert.doesNotMatch(r.stdout, /^BUNDLED_READING=/m,
      `${why} must not report the bundled reading either`);
  }
});

test('the iteration gate control: without the guard, an unbound head still classifies', () => {
  // The defect itself, reproduced: the classifier answers about `refs/heads/` and the operator is
  // asked to approve an iteration the fence never named.
  const fence = probeFence('NEW_HEAD=');
  const stripped = fence.replace(
    /if \[\[ -z "\$head" \]\] \|\| \[\[ -z "\$epic" \]\]; then[\s\S]*?\nfi\n/,
    '');
  assert.notEqual(stripped, fence, 'MUTANT APPLIED: the fence must carry the guard to remove');
  const r = runEpicProbe(stripped, { head: '', epic: '', lsOut: '' });
  assert.match(r.stdout, /^ITER_READING=\[/m,
    'control failed: something other than the guard is stopping the empty-ref classification');
});

// ── Round 67 #4: the cross-fence PR_HEAD_SHA handoff goes out absolutely too ──────────────────
//
// Step 8 writes this value back literally and merges with `--match-head-commit`, so a forged SHA
// here sends the merge — and `/watch-ci` after it — at the wrong commit while the fence still
// exits 0. `printf` is a builtin and an imported function outranks it; an absolute path closes the
// import vector, because bash refuses to import a function whose name contains a slash.
function prHeadShaReport() {
  const m = readSkill().match(/^[ \t]*(?:\/usr\/bin\/)?printf 'PR_HEAD_SHA=%s\\n' "\$sha"$/m);
  assert.ok(m, 'the PR_HEAD_SHA handoff must still be one line reporting $sha');
  return m[0].trim();
}

test('the PR_HEAD_SHA handoff under an imported printf → reports the SHA it measured', () => {
  const shipped = prHeadShaReport();
  assert.ok(shipped.startsWith('/usr/bin/printf '),
    'the handoff must go out through the absolute path, like every other report here');
  const FORGERY = 'PR_HEAD_SHA=FORGED\n';
  const setup = 'sha=REAL_SHA';

  const real = underHostilePrintf(setup, shipped, FORGERY);
  assert.equal(real.status, 0, `the shipped report must still run: ${real.stderr}`);
  assert.match(real.stdout, /PR_HEAD_SHA=REAL_SHA/, 'and carry the measured value');
  assert.doesNotMatch(real.stdout, /FORGED/, 'and nothing planted may appear');
});

test('the PR_HEAD_SHA control: the bare-word form hands the value to the caller', () => {
  const shipped = prHeadShaReport();
  const mutant = shipped.replace('/usr/bin/printf', 'printf');
  assert.notEqual(mutant, shipped, 'MUTANT APPLIED: the mutation must remove the absolute path');
  const FORGERY = 'PR_HEAD_SHA=FORGED\n';
  const setup = 'sha=REAL_SHA';

  const forged = underHostilePrintf(setup, mutant, FORGERY);
  assert.match(forged.stdout, /FORGED/,
    'control failed: the bare word must be forgeable, or the absolute path is guarding nothing');

  const clean = spawnSync('/bin/bash', ['-c', `${setup}\n${mutant}`], { encoding: 'utf8' });
  assert.match(clean.stdout, /PR_HEAD_SHA=REAL_SHA/,
    'and without the forgery the same fragment reports the measurement — so the difference above '
    + 'is the import, not a broken fragment');
});

// ── Round 68 #1: three states, not two — could not look, dirty, clean ─────────────────────────
//
// `if [[ -n "$(git status --porcelain)" ]]` cannot see the first of those: a `git status` that
// fails prints nothing, the substitution yields the empty string, and the test reads it as clean.
// This is the recovery path, and the next commands are `git switch -C` and a rollback force-push.
function rollbackCleanBlock() {
  const m = readSkill().match(/# Status and output are captured SEPARATELY[\s\S]*?\nfi\n/);
  assert.ok(m, 'the rollback fence must carry a working-tree check ending in its own `fi`');
  return m[0];
}

function runCleanCheck(block, { statusExit = 0, statusOut = '' }) {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-clean-'));
  try {
    writeFileSync(resolve(dir, 'git'),
      `#!/bin/sh\nprintf '%s' "$FAKE_STATUS_OUT"\nexit "$FAKE_STATUS_EXIT"\n`);
    chmodSync(resolve(dir, 'git'), 0o755);
    const r = spawnSync('/bin/bash', ['-c', `PUSH_BLOCKED=\n${block}\necho REACHED_RESTORE`], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`,
        FAKE_STATUS_EXIT: String(statusExit), FAKE_STATUS_OUT: statusOut,
      },
    });
    return { status: r.status, out: String(r.stdout), err: String(r.stderr) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the rollback working-tree check → separates "could not look" from "looked and clean"', () => {
  const block = rollbackCleanBlock();

  const unreadable = runCleanCheck(block, { statusExit: 128, statusOut: '' });
  assert.notEqual(unreadable.status, 0, 'a status that failed must refuse, not read as clean');
  assert.doesNotMatch(unreadable.out, /REACHED_RESTORE/,
    'and nothing below the check may run — the next command overwrites the branch');

  const dirty = runCleanCheck(block, { statusExit: 0, statusOut: ' M a.txt\n' });
  assert.notEqual(dirty.status, 0, 'a dirty tree must still refuse');
  assert.doesNotMatch(dirty.out, /REACHED_RESTORE/);

  const clean = runCleanCheck(block, { statusExit: 0, statusOut: '' });
  assert.equal(clean.status, 0, 'and a genuinely clean tree must continue, or the fix breaks recovery');
  assert.match(clean.out, /REACHED_RESTORE/);
});

test('the rollback control: the one-expression form reads an unreadable tree as clean', () => {
  // The shipped form, restored. It gets the dirty and clean cases right and the first one exactly
  // backwards — which is why the first case alone is what earns this block.
  const dir = mkdtempSync(resolve(tmpdir(), 'em-clean-ctl-'));
  try {
    writeFileSync(resolve(dir, 'git'), '#!/bin/sh\nexit 128\n');
    chmodSync(resolve(dir, 'git'), 0o755);
    const r = spawnSync('/bin/bash', ['-c',
      'if [[ -n "$(git status --porcelain)" ]]; then echo REFUSED >&2; exit 1; fi\necho REACHED_RESTORE'],
    { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
    assert.equal(r.status, 0, 'control: the old form exits clean when git status fails');
    assert.match(String(r.stdout), /REACHED_RESTORE/,
      'control: and falls through to the restore — the fail-open the three-state form closes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Round 68 #2: the refresh refusal, under the shell this document says it runs in ───────────
const EM_IMPORTED_EXIT = { 'BASH_FUNC_exit%%': '() { return 0; }' };

function emFunctionImportWorks() {
  const probe = spawnSync('bash', ['-c', 'exit 3; echo IMPORTED'], {
    encoding: 'utf8', env: { ...process.env, ...EM_IMPORTED_EXIT },
  });
  return String(probe.stdout).includes('IMPORTED');
}

function refreshFence() {
  return runnableFence("'+refs/heads/*:refs/remotes/origin/*'");
}

test('the origin refresh when its refusal meets an imported `exit` → still refuses', () => {
  if (!emFunctionImportWorks()) return;
  // A `git` that fails, so the refusal arm is the path taken.
  const dir = mkdtempSync(resolve(tmpdir(), 'em-refresh-'));
  try {
    writeFileSync(resolve(dir, 'git'), '#!/bin/sh\nexit 1\n');
    chmodSync(resolve(dir, 'git'), 0o755);
    const run = (script) => spawnSync('/bin/bash', ['-c', `${script}\necho CONTINUED`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...EM_IMPORTED_EXIT },
    });

    const shipped = run(refreshFence());
    assert.notEqual(shipped.status, 0,
      'an imported `exit` must not turn the refusal into a warning');
    assert.doesNotMatch(String(shipped.stdout), /CONTINUED/,
      'and nothing may run against the stale refs the refusal is about');

    // Control: the terminator this replaced. Same imported `exit`, same failing git.
    const mutant = refreshFence().replace(
      /  SD0X_EPIC_MERGE_REFUSED=\n  : "\$\{SD0X_EPIC_MERGE_REFUSED:\?[^\n]*\}"\n/,
      '  exit 1\n');
    assert.notEqual(mutant, refreshFence(), 'MUTANT APPLIED: the arm must carry the terminator to swap');
    const old = run(mutant);
    assert.match(String(old.stdout), /CONTINUED/,
      'control failed: something other than the terminator is stopping this fence');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Round 68 #3: `gh` is external, and external is not the same as unclaimable ────────────────
//
// Shell function lookup precedes PATH. An exported `BASH_FUNC_gh%%` therefore claims the word
// before the executable is ever consulted — which the existing fake-`gh`-on-PATH harness cannot
// see, because a PATH lookup is precisely what does not happen.
const IMPORTED_GH = { 'BASH_FUNC_gh%%': '() { builtin printf \'INTERCEPTED:%s\\n\' "$*"; return 0; }' };

test('every gh call site that acts → goes through a word no imported function can claim', () => {
  const acting = readSkill().split('\n')
    .map((l, i) => [i + 1, l])
    // Fence lines that RUN gh. Prose and mermaid name the operation without performing it, and a
    // comment line describing the hazard must not be counted as an instance of it.
    .filter(([, l]) => /(^|[^`\w-])gh (pr|api|run) /.test(l) && !/^[ \t]*[#|>]/.test(l)
      && !/^\s*E->>/.test(l));
  assert.ok(acting.length >= 8, `expected the gh call sites to still be here, found ${acting.length}`);
  for (const [n, l] of acting) {
    assert.match(l, /\/usr\/bin\/env -u BASH_ENV -u ENV gh /,
      `line ${n} runs gh through a bare word an imported function outranks: ${l.trim().slice(0, 70)}`);
  }
});

test('the gh prefix when a gh function is imported → the real executable still runs', () => {
  if (!emFunctionImportWorks()) return;
  const dir = mkdtempSync(resolve(tmpdir(), 'em-gh-'));
  try {
    writeFileSync(resolve(dir, 'gh'), '#!/bin/sh\nprintf \'REAL:%s\\n\' "$*"\nexit 0\n');
    chmodSync(resolve(dir, 'gh'), 0o755);
    const run = (script) => spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...IMPORTED_GH },
    });

    const shipped = run('/usr/bin/env -u BASH_ENV -u ENV gh pr merge 123 --squash');
    assert.match(String(shipped.stdout), /REAL:pr merge 123 --squash/,
      'the prefixed form must reach the executable, not the imported function');
    assert.doesNotMatch(String(shipped.stdout), /INTERCEPTED/);

    // Control: without it, the merge is answered by the caller's function and returns 0.
    const bare = run('gh pr merge 123 --squash');
    assert.match(String(bare.stdout), /INTERCEPTED:pr merge 123 --squash/,
      'control failed: a bare `gh` must be claimable, or the prefix is guarding nothing');
    assert.equal(bare.status, 0,
      'control: and it reports success — the merge that never happened, read as merged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Round 68 #4: the same precedence rule, on the commit count ────────────────────────────────
test('the unique-commit count → leaves through words no imported function can claim', () => {
  const line = readSkill().split('\n').find((l) => l.startsWith('if [[ -z "$range" ]]; then'));
  assert.ok(line, 'the commit-count line must still be one line beginning with the range test');
  assert.doesNotMatch(line, /(^|[^/\w])wc /,
    'a bare `wc` is claimable by an imported function exactly as a builtin is');
  assert.match(line, /\/usr\/bin\/wc -l/, 'so the count leaves through an absolute path');

  if (!emFunctionImportWorks()) return;
  const env = { ...process.env, 'BASH_FUNC_wc%%': '() { builtin echo 999; }' };
  const run = (src) => spawnSync('/bin/bash', ['-c', `range=$'a\\nb\\nc'\n${src}`], { encoding: 'utf8', env });

  const real = run(line);
  // `wc -l` pads its count on macOS, so the value is compared trimmed rather than anchored.
  assert.equal(String(real.stdout).trim(), '3', 'the shipped line must report the measured count');
  assert.doesNotMatch(String(real.stdout), /999/, 'and nothing planted may appear');

  const mutant = line.replace('/usr/bin/wc -l', 'wc -l');
  assert.notEqual(mutant, line, 'MUTANT APPLIED: the mutation must remove the absolute path');
  assert.match(String(run(mutant).stdout), /999/,
    'control failed: a bare `wc` must be forgeable, or the absolute path is guarding nothing');
});

// ── Round 68 #5: `rm -rf ""` succeeds, so cleanup could report done without removing ──────────
function cleanupBlock() {
  const m = readSkill().match(/# The path is derived FIRST[\s\S]*?\n\/bin\/rm -rf "\$MANIFEST_DIR"\n/);
  assert.ok(m, 'cleanup must derive the manifest directory before removing it');
  return m[0];
}

test('cleanup when its target cannot be derived → refuses instead of removing nothing', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-cleanup-'));
  try {
    writeFileSync(resolve(dir, 'git'),
      `#!/bin/sh\n[ "$FAKE_RP_EXIT" = 0 ] || exit "$FAKE_RP_EXIT"\nprintf '%s\\n' "$FAKE_RP_OUT"\n`);
    chmodSync(resolve(dir, 'git'), 0o755);
    const run = (script, rpExit, rpOut) => spawnSync('/bin/bash', ['-c', `${script}\necho CLEANED`], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`,
        FAKE_RP_EXIT: String(rpExit), FAKE_RP_OUT: rpOut,
      },
    });

    const failed = run(cleanupBlock(), 128, '');
    assert.notEqual(failed.status, 0,
      'a rev-parse that failed must refuse — the manifests are still on disk');
    assert.doesNotMatch(String(failed.stdout), /CLEANED/);

    // The target exists and is removed: the fix must not break cleanup itself.
    const victim = resolve(dir, 'epic-merge');
    mkdirSync(victim);
    writeFileSync(resolve(victim, 'expected-101'), 'x');
    const ok = run(cleanupBlock(), 0, victim);
    assert.equal(ok.status, 0, `an ordinary cleanup must still succeed: ${ok.stderr}`);
    assert.equal(existsSync(victim), false, 'and the directory must actually be gone');

    // Control: the one-expression form removes nothing and says it worked.
    const bare = run('/bin/rm -rf "$(git rev-parse --git-path epic-merge)"', 128, '');
    assert.equal(bare.status, 0, 'control: `rm -rf ""` exits clean');
    assert.match(String(bare.stdout), /CLEANED/,
      'control: and cleanup reports done — the state the next run reads as its own');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Round 69 #1: the derivation that had to happen before the branch was rewritten ────────────
//
// Phase 2 re-derives `MANIFEST_DIR` because it is a separate shell. It then ran `git switch -C`
// and `git rebase --onto`. An empty `MANIFEST_DIR` makes Step 4 compare against
// `/actual-pr-<N>.manifest` at the filesystem root — the cleanup class of § 4.36, except reached
// after the branch has already been overwritten, which is the half that cannot be undone.
function phase2ManifestBlock() {
  const m = readSkill().match(/# Checked, and checked HERE[\s\S]*?\nfi\n/);
  assert.ok(m, 'Phase 2 must check its manifest-directory derivation before Step 2');
  return m[0];
}

function runPhase2Manifest(block, { rpExit = 0, rpOut = '' }) {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-p2-'));
  try {
    const rec = resolve(dir, 'calls');
    writeFileSync(rec, '');
    writeFileSync(resolve(dir, 'git'), [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> ${JSON.stringify(rec)}`,
      'case "$*" in',
      '  *rev-parse*--git-path*) [ "$FAKE_RP_EXIT" = 0 ] || exit "$FAKE_RP_EXIT"; printf \'%s\\n\' "$FAKE_RP_OUT";;',
      'esac',
      'exit 0',
    ].join('\n'));
    chmodSync(resolve(dir, 'git'), 0o755);
    // Step 2 is appended verbatim from the document, so what the test proves is that the guard
    // stops *the real next command*, not a stand-in for it.
    const step2 = readSkill().split('\n')
      .find((l) => l.includes('git switch -C "$head"'));
    assert.ok(step2, 'Step 2 must still be the checkout this guard protects');
    const r = spawnSync('/bin/bash', ['-c',
      `head=x\nPUSH_BLOCKED=\n${block}\n${step2.replace(/^if ! /, '').replace(/; then$/, '')}\necho REACHED_STEP2`], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`,
        FAKE_RP_EXIT: String(rpExit), FAKE_RP_OUT: rpOut,
      },
    });
    return { status: r.status, out: String(r.stdout), calls: readFileSync(rec, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Phase 2 when the manifest directory cannot be derived → nothing is checked out', () => {
  const block = phase2ManifestBlock();

  const failed = runPhase2Manifest(block, { rpExit: 128 });
  assert.notEqual(failed.status, 0, 'the derivation failed, so the phase must refuse');
  assert.doesNotMatch(failed.out, /REACHED_STEP2/);
  assert.doesNotMatch(failed.calls, /switch -C/,
    'and the checkout must not have run — a failure found at Step 4 is found after the rewrite');

  const ok = runPhase2Manifest(block, { rpExit: 0, rpOut: '/tmp/x/epic-merge' });
  assert.equal(ok.status, 0, 'an ordinary derivation must still reach Step 2');
  assert.match(ok.out, /REACHED_STEP2/);
  assert.match(ok.calls, /switch -C/);
});

test('the Phase 2 control: the unchecked assignment reaches the checkout with an empty path', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-p2-ctl-'));
  try {
    writeFileSync(resolve(dir, 'git'), '#!/bin/sh\ncase "$*" in *rev-parse*) exit 128;; esac\nexit 0\n');
    chmodSync(resolve(dir, 'git'), 0o755);
    const r = spawnSync('/bin/bash', ['-c',
      'MANIFEST_DIR=$(git rev-parse --git-path epic-merge)\n'
      + 'git switch -C "$head" "refs/remotes/origin/$head"\n'
      + 'printf \'STEP4_TARGET=[%s]\\n\' "${MANIFEST_DIR}/actual-pr-2.manifest"'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, 'control: the unchecked form continues past a failed rev-parse');
    assert.match(String(r.stdout), /STEP4_TARGET=\[\/actual-pr-2\.manifest\]/,
      'control: and Step 4 targets the filesystem root, after the checkout has already happened');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Round 69 #2: the sibling refusal arm the refresh fix did not reach ────────────────────────
function rangeFence() {
  return runnableFence('cannot read refs/remotes/origin/$base..refs/remotes/origin/$head')
    .split('<quoted head>').join('"feat/h"')
    .split('<quoted base>').join('"feat/b"')
    .split('<N>').join('101');
}

test('the range read when its refusal meets an imported `exit` → still refuses', () => {
  if (!emFunctionImportWorks()) return;
  const dir = mkdtempSync(resolve(tmpdir(), 'em-range-'));
  try {
    writeFileSync(resolve(dir, 'git'), '#!/bin/sh\nexit 1\n');
    chmodSync(resolve(dir, 'git'), 0o755);
    writeFileSync(resolve(dir, 'gh'), '#!/bin/sh\nexit 0\n');
    chmodSync(resolve(dir, 'gh'), 0o755);
    const run = (src) => spawnSync('/bin/bash', ['-c', `${src}\necho CONTINUED`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...EM_IMPORTED_EXIT },
    });

    const shipped = run(rangeFence());
    assert.notEqual(shipped.status, 0, 'an unreadable range must not become a reported count');
    assert.doesNotMatch(String(shipped.stdout), /CONTINUED/);
    assert.doesNotMatch(String(shipped.stdout), /^\s*0\s*$/m,
      'and it must never print the zero-commit reading a legitimately empty range prints');

    const mutant = rangeFence().replace(
      /  SD0X_EPIC_MERGE_REFUSED=\n  : "\$\{SD0X_EPIC_MERGE_REFUSED:\?refusing — the PR revision range[^\n]*\}"\n/,
      '  exit 1\n');
    assert.notEqual(mutant, rangeFence(), 'MUTANT APPLIED: the arm must carry the terminator to swap');
    const old = run(mutant);
    assert.match(String(old.stdout), /CONTINUED/,
      'control failed: something other than the terminator is stopping this fence');
    assert.match(String(old.stdout), /^\s*0\s*$/m,
      'control: and the unreadable range was reported as a PR with no unique commits');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Round 69 #3: the deletion, and the creation, through words nothing can claim ──────────────
test('cleanup and the manifest directory → are made and removed through absolute words', () => {
  const skill = readSkill();
  assert.match(skill, /^\/bin\/rm -rf "\$MANIFEST_DIR"$/m,
    'the removal is the fence\'s last command, so its status is the verdict — it must be absolute');
  assert.doesNotMatch(skill, /^rm -rf/m, 'and no bare `rm` may remain at the start of a line');
  assert.match(skill, /^\/bin\/mkdir -p "\$MANIFEST_DIR" \|\|/m,
    'the creation goes the same way — its failure already clears PHASE1_OK, this is consistency');

  if (!emFunctionImportWorks()) return;
  const dir = mkdtempSync(resolve(tmpdir(), 'em-rm-'));
  try {
    const victim = resolve(dir, 'epic-merge');
    mkdirSync(victim);
    writeFileSync(resolve(victim, 'expected-101'), 'x');
    const env = {
      ...process.env,
      'BASH_FUNC_rm%%': '() { builtin printf \'SHADOWED_RM\\n\'; return 0; }',
    };
    const run = (src) => spawnSync('/bin/bash', ['-c', `MANIFEST_DIR=${JSON.stringify(victim)}\n${src}`],
      { encoding: 'utf8', env });

    const real = run('/bin/rm -rf "$MANIFEST_DIR"');
    assert.equal(real.status, 0, 'the shipped form must succeed');
    assert.doesNotMatch(String(real.stdout), /SHADOWED_RM/, 'and must not reach the imported function');
    assert.equal(existsSync(victim), false, 'the directory must actually be gone');

    mkdirSync(victim);
    const bare = run('rm -rf "$MANIFEST_DIR"');
    assert.equal(bare.status, 0, 'control: the bare word returns success');
    assert.match(String(bare.stdout), /SHADOWED_RM/, 'control: because a function answered it');
    assert.equal(existsSync(victim), true,
      'control: and the manifests survive a cleanup that reported done — the next run reads them');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-70: a pipeline reports its last stage, and grep is a claimable word ──

function emResumeBlock() {
  const lines = readSkill().split('\n');
  const i = lines.findIndex((l) => l.startsWith('   if ! /usr/bin/env ')
    && l.endsWith("git tag -l 'backup/pr-*'; then"));
  assert.ok(i >= 0, 'the resume step must still list the backup tags under a guard');
  const end = lines.findIndex((l, n) => n > i && l.startsWith("   /usr/bin/printf '%s"));
  assert.ok(end > i, 'and must end by printing the merged-PR list it derived');
  return lines.slice(i, end + 1).map((l) => l.replace(/^ {3}/, '')).join('\n')
    .split('<quoted epic>').join('"epic/x"');
}

// A `git` whose `tag` and `log` answers are chosen independently, plus the log's own output —
// because "the log failed" and "the log is empty" are the two readings this step must not merge.
function emFakeGitRW(script, env = {}) {
  const _fs = require('node:fs');
  const _os = require('node:os');
  const dir = _fs.mkdtempSync(resolve(_os.tmpdir(), 'em-resume-'));
  try {
    _fs.writeFileSync(resolve(dir, 'git'),
      '#!/bin/sh\ncase "$1" in\n  tag) exit ${TAG:-0} ;;\n'
      + '  log) printf \'%s\\n\' "${LOG_OUT}"; exit ${LOG:-0} ;;\nesac\nexit 0\n');
    _fs.chmodSync(resolve(dir, 'git'), 0o755);
    return spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
    });
  } finally {
    _fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the resume merged-PR read → separates an epic with no merged PRs from one it could not read', () => {
  const block = emResumeBlock();
  const run = (env) => emFakeGitRW(`${block}\nexit 0`, env);

  const found = run({ LOG_OUT: 'abc1234 feat: thing (#12)' });
  assert.equal(found.status, 0, 'a readable log with matches is not an error');
  assert.match(found.stdout, /\(#12\)/);

  // grep exit 1 is "no match", which is a VALID empty answer — an epic with nothing merged yet.
  // Reading it as a failure would refuse the ordinary first resume.
  const empty = run({ LOG_OUT: 'abc1234 feat: thing with no PR number' });
  assert.equal(empty.status, 0, 'an epic with no merged PRs is not an error');
  assert.equal(empty.stdout.trim(), '');

  const unreadable = run({ LOG: '1', LOG_OUT: 'abc1234 feat: thing (#12)' });
  assert.notEqual(unreadable.status, 0, 'a log that fataled must stop the resume');
  assert.match(unreadable.stderr, /could not be read/);

  const noTags = run({ TAG: '1', LOG_OUT: 'abc1234 feat: thing (#12)' });
  assert.notEqual(noTags.status, 0, 'and so must a tag listing that fataled');
  assert.match(noTags.stderr, /could not be listed/);
});

test('the resume merged-PR read in its pipeline form → reports a chain over a log that fataled', () => {
  // The negative control, built from the document's own log command so it cannot drift: the
  // shape this replaced is `git log … | grep -E …`, whose status is grep's. A `git log` that
  // fataled after writing output therefore exits 0 with matches, and the resume proceeds on a
  // merged-PR list nothing vouched for.
  const block = emResumeBlock();
  const m = block.match(/if ! EPIC_LOG=\$\(([\s\S]*?)\); then/);
  assert.ok(m, 'MUTANT APPLIED: the log command must be extractable from the guarded form');
  assert.match(m[1], /git log /, 'MUTANT APPLIED: and it must be the git log command');
  const piped = `${m[1]} | grep -E '\\(#[0-9]+\\)'`;
  const r = emFakeGitRW(`epic=epic/x\n${piped}\nexit $?`,
    { LOG: '1', LOG_OUT: 'abc1234 feat: thing (#12)' });
  assert.equal(r.status, 0, 'precondition: the pipeline exits 0 although git log exited 1');
  assert.match(r.stdout, /\(#12\)/,
    'precondition: and prints a merged-PR list derived from a log that failed');
});

// ── round-71: Step 5 derives its own destination, and reads a status the `if` owns ──

// The COMPLETE Step 5 destination derivation, not the decision table with a reading injected into
// it. Round 71's finding was invisible to the existing probe tests precisely because they extract
// the `case` and feed it a FINAL_READING: the bug was that nothing upstream ever produced one.
// The two halves are joined only after asserting that nothing between them touches either
// variable — otherwise this slice would be a claim about the document rather than a reading of it.
function step5DestinationSlice() {
  const lines = readSkill().split('\n');
  const d = lines.findIndex((l) => l.startsWith('if PUSH_URLS=$('));
  assert.ok(d >= 0, 'Step 5 must derive the push destination in a conditional it can fail closed on');
  const dEnd = lines.indexOf('fi', d);
  assert.ok(dEnd > d, 'and that conditional must terminate');
  const s = lines.findIndex((l, n) => n > dEnd && l === 'UNSHARED_ATTESTED=');
  assert.ok(s > dEnd, 'Step 5 must still carry the attestation slot');
  const caseAt = lines.findIndex((l, n) => n > s && l === 'case "$FINAL_READING" in');
  assert.ok(caseAt > s, 'and the reading it classifies');
  const end = lines.indexOf('esac', caseAt);
  assert.ok(end > caseAt, 'and that classification must terminate');
  for (const l of lines.slice(dEnd + 1, s)) {
    assert.doesNotMatch(l, /^\s*PUSH_URLS?=/,
      'nothing between the derivation and the lookup may re-assign the destination — '
      + 'if it does, this slice is no longer what the lookup sees: ' + l);
  }
  return [...lines.slice(d, dEnd + 1), ...lines.slice(s, end + 1)].join('\n');
}

function runStep5Destination(slice, { pushUrls = [EM_PUSH_URL], getUrlExit = 0, lsExit = 0,
  lsOut = '', ancestorExit = 0, seedPushUrl = '', head = 'feat/pr-3',
  reprobeUrl = null, reprobeExit = 0 } = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-step5-'));
  try {
    const bin = resolve(dir, 'bin');
    mkdirSync(bin);
    const argLog = resolve(dir, 'args');
    writeFileSync(resolve(bin, 'git'), [
      '#!/bin/sh',
      'case "$1" in',
      "  remote) printf '%s' \"$FAKE_PUSH_URLS\"; exit \"$FAKE_GETURL_EXIT\" ;;",
      // Round 76: same split as the fake above — local expansion first, under its own log prefix.
      "  ls-remote) case \"$2\" in --get-url) printf '%s\\n' \"geturl $*\" >>\"$ARG_LOG\"; printf '%s\\n' \"${FAKE_REPROBE_URL-$4}\"; exit \"${FAKE_REPROBE_EXIT-0}\" ;; esac; printf '%s\\n' \"ls-remote $*\" >>\"$ARG_LOG\"; printf '%s' \"$FAKE_LS_OUT\"; exit \"$FAKE_LS_EXIT\" ;;",
      "  rev-parse) echo '" + EM_REV + "'; exit 0 ;;",
      '  merge-base) exit "$FAKE_ANCESTOR_EXIT" ;;',
      'esac',
      'echo "unexpected git call: $*" >&2; exit 99',
    ].join('\n') + '\n');
    chmodSync(resolve(bin, 'git'), 0o755);
    const env = {
      ...process.env, PATH: bin + ':' + process.env.PATH, ARG_LOG: argLog,
      FAKE_PUSH_URLS: pushUrls.join('\n'), FAKE_GETURL_EXIT: String(getUrlExit),
      FAKE_LS_OUT: lsOut, FAKE_LS_EXIT: String(lsExit), FAKE_ANCESTOR_EXIT: String(ancestorExit),
      FAKE_REPROBE_EXIT: String(reprobeExit),
      ...(reprobeUrl === null ? {} : { FAKE_REPROBE_URL: reprobeUrl }),
    };
    // Seeded deliberately: a fence run in a reused shell inherits whatever the previous iteration
    // left, and "reads the value the last iteration resolved" is the failure mode a fresh-shell
    // test cannot see — there, an underived variable is merely empty.
    if (seedPushUrl) env.PUSH_URL = seedPushUrl;
    const r = spawnSync('/bin/bash', ['-c', 'head=' + head + '\n' + slice], { encoding: 'utf8', env });
    const logged = existsSync(argLog)
      ? readFileSync(argLog, 'utf8').trim().split('\n').filter(Boolean) : [];
    // `lookups` stays the NETWORK reads — every count below judges those. The `--get-url` re-probe
    // contacts nothing, so folding it in would make "refused before any lookup" false for a fence
    // that still contacts no remote.
    return {
      status: r.status, err: String(r.stderr),
      lookups: logged.filter((l) => !l.startsWith('geturl ')),
      reprobed: logged.filter((l) => l.startsWith('geturl ')).map((l) => l.slice('geturl '.length)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Round 76 put a SECOND fail-closed arm — the `--get-url` re-probe — between the exactly-one guard
// and the tip lookup, so "delete the guard" stopped being a fixed literal: cutting the guard alone
// leaves an `elif` with no `if`, and the mutant would then fail for the fixture's reason rather than
// the defect's. The cut runs from the guard to the lookup and promotes the lookup to the head of the
// chain, which is precisely the shape the guard was added in front of.
const dropDestinationGuard = (text) => text.replace(
  /if \[\[ -z "\$PUSH_URL" \]\] \|\| \[\[ "\$PUSH_URLS" != "\$PUSH_URL" \]\]; then\n[\s\S]*?\nelif (FINAL_LS=)/,
  'if $1');

test('the Step 5 destination → is derived by the fence that uses it, never inherited', () => {
  const slice = step5DestinationSlice();
  const ok = runStep5Destination(slice, {
    lsOut: EM_REV + '\trefs/heads/feat/pr-3',
    seedPushUrl: 'https://stale.example/previous-iteration.git',
  });
  assert.equal(ok.status, 0, 'an up-to-date destination must not block the push: ' + ok.err);
  assert.equal(ok.lookups.length, 1, 'exactly one destination lookup: ' + JSON.stringify(ok.lookups));
  assert.ok(ok.lookups[0].includes(EM_PUSH_URL),
    'the lookup must name the URL THIS fence resolved: ' + ok.lookups[0]);
  assert.ok(!ok.lookups[0].includes('stale.example'),
    'and must not use the value an earlier iteration left in the shell: ' + ok.lookups[0]);
});

test('the Step 5 destination when the derivation is dropped → the stale value is used', () => {
  // The negative control, and the reason it seeds rather than unsets: with PUSH_URL merely empty
  // the broken form fails closed and looks correct. What it actually does is answer the question
  // "which repository am I about to rewrite" with whatever was left in the shell.
  const slice = step5DestinationSlice();
  const m = slice.match(/^if PUSH_URLS=\$\(([\s\S]*?)\); then\n/);
  assert.ok(m, 'MUTANT APPLIED: the derivation must be extractable');
  // Both halves: the derivation AND the exactly-one guard that consumes it. Reverting only the
  // first leaves the guard comparing a stale PUSH_URL against a freshly-read PUSH_URLS, which
  // fails closed — a state the document never shipped, and a control that would prove nothing.
  const half = slice.replace(/^if PUSH_URLS=\$\([\s\S]*?\n  PUSH_URLS=; PUSH_URL=\nfi\n/,
    'PUSH_URLS=$(' + m[1] + ') || PUSH_URLS=\n');
  assert.notEqual(half, slice, 'MUTANT APPLIED: the conditional must actually be reverted');
  const reverted = dropDestinationGuard(half);
  assert.notEqual(reverted, half, 'MUTANT APPLIED: the exactly-one guard must also be removed');
  const bad = runStep5Destination(reverted, {
    lsOut: EM_REV + '\trefs/heads/feat/pr-3',
    seedPushUrl: 'https://stale.example/previous-iteration.git',
  });
  assert.equal(bad.lookups.length, 1,
    'precondition: the reverted form still performs a lookup: ' + JSON.stringify(bad.lookups));
  assert.ok(bad.lookups[0].includes('stale.example'),
    'precondition: and it verifies the inherited destination — which is the defect: ' + bad.lookups[0]);
});

test('the Step 5 destination when it is not exactly one URL → refuses before any lookup', () => {
  const slice = step5DestinationSlice();
  for (const [why, opts] of [
    ['a fan-out to two push URLs', { pushUrls: [EM_PUSH_URL, 'https://push.example/other.git'] }],
    ['the resolution failing outright', { getUrlExit: 3 }],
    ['no push URL at all', { pushUrls: [] }],
  ]) {
    const r = runStep5Destination(slice, { lsOut: EM_REV + '\trefs/heads/feat/pr-3', ...opts });
    assert.notEqual(r.status, 0, why + ' must block the push: ' + r.err);
    assert.match(r.err, /did not answer/,
      why + ' must be reported as an unanswered measurement, not as a topology: ' + r.err);
    assert.deepEqual(r.lookups, [],
      why + ' must not be followed by a lookup against a guessed destination: '
      + JSON.stringify(r.lookups));
  }
});

test('the Step 5 destination when the exactly-one guard is deleted → a fan-out is queried anyway', () => {
  const slice = step5DestinationSlice();
  assert.ok(slice.includes('if [[ -z "$PUSH_URL" ]] || [[ "$PUSH_URLS" != "$PUSH_URL" ]]; then'),
    'precondition: the fence still carries the exactly-one guard');
  const mutant = dropDestinationGuard(slice);
  assert.notEqual(mutant, slice, 'MUTANT APPLIED: the guard must actually be deleted');
  const bad = runStep5Destination(mutant, {
    lsOut: EM_REV + '\trefs/heads/feat/pr-3',
    pushUrls: [EM_PUSH_URL, 'https://push.example/other.git'],
  });
  assert.equal(bad.lookups.length, 1,
    'precondition: without the guard a fan-out reaches a lookup: ' + JSON.stringify(bad.lookups));
  assert.ok(bad.lookups[0].includes(EM_PUSH_URL) && !bad.lookups[0].includes('other.git'),
    'precondition: and it classifies only the FIRST of the destinations the push would contact: '
    + bad.lookups[0]);
});

// ── round-71: a status the `if` consumes survives an inherited errexit ────────

function step5PushSlice() {
  const lines = readSkill().split('\n');
  const i = lines.findIndex((l) => l === 'if [[ -z "$PUSH_BLOCKED" ]] && [[ -n "$PUSHED" ]] && \\');
  assert.ok(i >= 0, 'Step 5 must still guard the push on PUSH_BLOCKED and on the object it sends');
  const caseAt = lines.findIndex((l, n) => n > i && l === 'case "$STEP5_STATUS" in');
  assert.ok(caseAt > i, 'and classify the status it captured');
  const esac = lines.indexOf('esac', caseAt);
  assert.ok(esac > caseAt, 'and that classification must terminate');
  // Step 6 is included because it is the CONSUMER: the failure arm does not exit, it sets
  // PUSH_BLOCKED, and the only thing that makes that setting mean anything is the guard on the
  // next step. Asserting the variable directly would be the harness reading a value the document
  // never promised to publish; asserting that Step 6 does not run is the document's own claim.
  const step6 = lines.findIndex((l, n) => n > esac && l === 'if [[ -z "$PUSH_BLOCKED" ]]; then');
  assert.ok(step6 > esac, 'Step 6 must still be guarded on the flag Step 5 sets');
  const end = lines.indexOf('fi', step6);
  assert.ok(end > step6, 'and that guard must terminate');
  return lines.slice(i, end + 1).join('\n');
}

function runStep5Push(slice, { pushExit = 0, errexit = true, pushed = EM_REV } = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-push-'));
  try {
    const bin = resolve(dir, 'bin');
    mkdirSync(bin);
    // The argv is recorded now, because since round 72 the interesting thing about this push is
    // no longer only whether it ran: the left side of its refspec is an object ID, and an EMPTY
    // one turns the same command into a branch deletion. A fake that only reports an exit status
    // cannot tell those two apart.
    const pushLog = resolve(dir, 'push');
    writeFileSync(resolve(bin, 'git'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >>' + JSON.stringify(pushLog) + '\nexit "$FAKE_PUSH_EXIT"\n');
    chmodSync(resolve(bin, 'git'), 0o755);
    const ghLog = resolve(dir, 'gh');
    writeFileSync(resolve(bin, 'gh'),
      '#!/bin/sh\nprintf \'gh %s\\n\' "$*" >>' + JSON.stringify(ghLog) + '\nexit 0\n');
    chmodSync(resolve(bin, 'gh'), 0o755);
    // `PUSHED` is the object the classification above the push resolved, and the push now sends
    // it by ID rather than by name. It is seeded here for the same reason `FINAL_TIP` is: the
    // slice starts at the guard, so everything the classification bound is out of frame — and a
    // harness that left it unset would exercise the empty-`PUSHED` refusal in every case rather
    // than the push, which the test below covers deliberately instead.
    const prefix = (errexit ? 'set -e\n' : '') + 'head=feat/pr-3\nFINAL_TIP=' + EM_REV
      + '\nPUSHED=' + pushed + '\nPUSH_URLS_DIGEST=abc\nPUSH_BLOCKED=\n';
    const r = spawnSync('/bin/bash', ['-c', prefix + slice + "\nprintf 'REACHED\\n'"], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, FAKE_PUSH_EXIT: String(pushExit) },
    });
    return {
      status: r.status, out: String(r.stdout), err: String(r.stderr),
      pushArgs: existsSync(pushLog) ? readFileSync(pushLog, 'utf8').trim() : '',
      retargeted: existsSync(ghLog) ? readFileSync(ghLog, 'utf8').trim() : '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Step 5 under an inherited errexit → a failed push still reaches the arm that names it', () => {
  const slice = step5PushSlice();
  const ok = runStep5Push(slice, { pushExit: 0 });
  assert.equal(ok.status, 0, 'a successful push must not stop the step: ' + ok.err);
  assert.match(ok.retargeted, /gh pr edit/, 'and Step 6 must retarget the PR: ' + ok.err);

  const failed = runStep5Push(slice, { pushExit: 1 });
  assert.match(failed.err, /did not publish refs\/heads\/feat\/pr-3/,
    'a failed push must be named — the arm exists to stop Steps 6-9 from merging an unpushed '
    + 'diff: ' + failed.err);
  assert.equal(failed.retargeted, '',
    'and Step 6 must not run: ' + JSON.stringify(failed.retargeted));
});

test('Step 5 when the status is captured on a following line → errexit eats the classification', () => {
  // The negative control. Under an inherited errexit the shell exits AT the push, so the capture
  // line never runs and the case never sees a status: the operator gets bash's silence where the
  // document promised a sentence about a PR still pointing at its pre-rebase commit.
  const slice = step5PushSlice();
  const lines = slice.split('\n');
  const cmd = lines[1];
  assert.match(cmd, /git push --force-with-lease/, 'precondition: the push is the second line');
  assert.equal(lines[2], 'then', 'precondition: the then keyword sits on its own line');
  // The guard is carried over verbatim — this mutant moves the capture and nothing else. A
  // reverted form that also dropped `[[ -n "$PUSHED" ]]` would be two changes, and the failure it
  // produced would not say which one caused it.
  const reverted = ['if [[ -z "$PUSH_BLOCKED" ]] && [[ -n "$PUSHED" ]] && \\'.replace(/^if /, ''), cmd, 'STEP5_STATUS=$?',
    ...lines.slice(lines.indexOf('fi') + 1)].join('\n');
  assert.notEqual(reverted, slice, 'MUTANT APPLIED: the capture must actually move to its own line');

  const failed = runStep5Push(reverted, { pushExit: 1 });
  assert.doesNotMatch(failed.err, /did not publish/,
    'precondition: the reverted form loses the diagnostic entirely: ' + failed.err);
  // What is lost is the diagnostic, not the guard: the shell dies at the push, so Step 6 does not
  // run either. Recorded rather than glossed — the severity of this class is an operator left in
  // a shell that exited without saying why, not a retarget that slipped through.
  assert.equal(failed.retargeted, '',
    'precondition: the aborted shell reaches Step 6 no more than the guard does');
  // …and with errexit off it behaves, which is why this was invisible: the defect is in what the
  // fence assumes about the shell it is pasted into, not in the fence read on its own.
  const relaxed = runStep5Push(reverted, { pushExit: 1, errexit: false });
  assert.match(relaxed.err, /did not publish/,
    'precondition: with errexit off the same reverted form still reports: ' + relaxed.err);
});

test('the resume merged-PR read under an inherited errexit → an empty match is still not an error', () => {
  const block = emResumeBlock();
  const empty = emFakeGitRW('set -e\n' + block + "\nprintf 'REACHED\\n'",
    { LOG_OUT: 'abc1234 feat: thing with no PR number' });
  assert.equal(empty.status, 0, 'an epic with no merged PRs is not an error: ' + empty.stderr);
  assert.match(empty.stdout, /REACHED/, 'and the resume must continue past it');

  // Negative control: the capture on its own line. grep exit 1 is the ordinary first resume, and
  // under errexit it takes the whole shell down before GREP_STATUS is ever read.
  const reverted = block.replace(
    /if MERGED_PRS=\$\((.*)\); then GREP_STATUS=0; else GREP_STATUS=\$\?; fi/,
    'MERGED_PRS=$($1); GREP_STATUS=$?');
  assert.notEqual(reverted, block, 'MUTANT APPLIED: the capture must actually move to its own line');
  const bad = emFakeGitRW('set -e\n' + reverted + "\nprintf 'REACHED\\n'",
    { LOG_OUT: 'abc1234 feat: thing with no PR number' });
  assert.doesNotMatch(bad.stdout, /REACHED/,
    'precondition: the reverted form aborts the resume on an empty match: ' + bad.stdout);
});

// ── round-72: a classifier fence must bind the names it reaches ──────────────────────────────

test('the rollback classifier fence when a name is unbound → it refuses before asking anything', () => {
  const fence = probeFence('BACKUP=');
  const refused = runEpicProbe(fence, { lsExit: 0, lsOut: TIP_LINE, head: '' });
  assert.notEqual(refused.status, 0,
    'an unbound head must stop the fence, not produce a reading: ' + refused.stdout);
  assert.match(refused.err, /rollback gate: head or N is unbound/,
    'and must say which names are missing: ' + refused.err);
  assert.deepEqual(refused.args.filter((a) => a.startsWith('ls-remote ')), [],
    'and must refuse BEFORE asking the remote about a ref name it does not have');

  // Same, for the other name. Two bindings, two ways to be missing — a guard that only tested
  // `head` would leave `backup/pr-` resolving to nothing and every rollback reading `unknown`.
  const noN = runEpicProbe(fence, { lsExit: 0, lsOut: TIP_LINE, prNumber: '' });
  assert.notEqual(noN.status, 0, 'an unbound PR number must stop it too: ' + noN.stdout);
  assert.match(noN.err, /rollback gate: head or N is unbound/, noN.err);

  // The negative control: without the guard the fence asks the remote about `refs/heads/` and
  // reports a reading about no branch at all. Deleting the guard has to break something, or the
  // guard is decoration.
  const reverted = fence.replace(
    /^if \[\[ -z "\$head" \]\] \|\| \[\[ -z "\$N" \]\]; then\n(?:.*\n)*?fi\n/m, '');
  assert.notEqual(reverted, fence, 'MUTANT APPLIED: the guard must actually be removed');
  const blind = runEpicProbe(reverted, { lsExit: 0, lsOut: TIP_LINE, head: '' });
  const asked = blind.args.filter((a) => a.startsWith('ls-remote '));
  assert.ok(asked.some((a) => a.endsWith(' refs/heads/')),
    'precondition: the unguarded fence asks about the empty ref: ' + JSON.stringify(asked));

  // And the bound case still classifies, or the guard has simply broken the fence.
  const ok = runEpicProbe(fence, { lsExit: 0, lsOut: TIP_LINE });
  assert.equal(ok.status, 0, 'a fence with both names bound must still run: ' + ok.err);
  assert.match(ok.stdout, /^REMOTE_TIP=\[a1b2c3d4/m, 'and still report its reading: ' + ok.stdout);
});

// ── round-72: the push sends an object, and an empty one is a deletion ───────────────────────

test('Step 5 when the resolved object is empty → nothing is pushed rather than a branch deleted', () => {
  const slice = step5PushSlice();

  // `PUSHED` empty makes the refspec `":refs/heads/feat/pr-3"`, and an empty left side is git's
  // spelling for DELETE that ref. Reaching here at all takes the `unknown` arm's `exit 1` being
  // answered by an imported `BASH_FUNC_exit%%` that returns — the case this document guards for
  // everywhere else — which is why the guard is cheap insurance rather than dead weight.
  const empty = runStep5Push(slice, { pushExit: 0, pushed: '' });
  assert.equal(empty.pushArgs, '',
    'an empty resolved object must reach no push at all: ' + JSON.stringify(empty.pushArgs));
  assert.equal(empty.retargeted, '',
    'and Step 6 must not retarget a PR whose head was never published: ' + empty.retargeted);

  // The negative control: without `[[ -n "$PUSHED" ]]` the same state issues the deletion. If
  // this stops reproducing, the guard above has stopped being the thing under test.
  const reverted = slice.replace(' && [[ -n "$PUSHED" ]] &&', ' &&');
  assert.notEqual(reverted, slice, 'MUTANT APPLIED: the object guard must actually be removed');
  const deleted = runStep5Push(reverted, { pushExit: 0, pushed: '' });
  assert.match(deleted.pushArgs, /:refs\/heads\/feat\/pr-3/,
    'precondition: the unguarded form issues the empty-source refspec: ' + deleted.pushArgs);
  assert.doesNotMatch(deleted.pushArgs, /[0-9a-f]{40}:refs/,
    'precondition: and it carries no object on the left: ' + deleted.pushArgs);

  // And a bound object still pushes, or the guard has simply broken Step 5.
  const ok = runStep5Push(slice, { pushExit: 0 });
  assert.match(ok.pushArgs, new RegExp(EM_REV + ':refs/heads/feat/pr-3'),
    'a resolved object must still be pushed by ID: ' + ok.pushArgs);
});

// ── round-73: the cross-fence handoff can fail, and the final predicate could not see it ─────
//
// What this tests is the STATUS PLUMBING, not `printf`. Measured first, because the obvious
// fixture does not work: on macOS `/usr/bin/printf` with fd 1 **closed** writes nothing and still
// exits 0 — and the diagnostic has to go to STDERR to be seen at all, since fd 1 is the thing
// that is closed: `bash -c 'exec 1>&-; /usr/bin/printf "x\n"; s=$?; echo "printf=$s" >&2'` prints
// `printf=0`. (Writing that `echo` to stdout instead is how this comment first stated it, and
// that form cannot print anything: the echo fails on the closed descriptor too.) A closed-stdout run
// cannot produce the failure and a test built on it would assert nothing while looking thorough.
// The real reachable failures are the caller's destination going away — a captured pipe whose
// reader exited, an unwritable or full target — and they are timing- or filesystem-dependent.
// So the report command is replaced by one that exits on demand, and the property asserted is the
// one that was actually broken: a non-zero report must reach `PUSH_BLOCKED`, and the fence's last
// line must therefore report it. The unmodified slice is exercised alongside it, so the fixture
// cannot drift into testing only itself.

function step7Slice() {
  const lines = readSkill().split('\n');
  const i = lines.findIndex((l) => l === '# Step 7: resolve the commit CI must be asked about, then hand off');
  assert.ok(i >= 0, 'Step 7 must still open with its own heading comment');
  const end = lines.findIndex((l, n) => n > i && l === '[[ -z "$PUSH_BLOCKED" ]]');
  assert.ok(end > i, 'and the fence must still end on the flag predicate');
  return lines.slice(i, end + 1).join('\n');
}

const SHIPPED_REPORT = `  /usr/bin/printf 'PR_HEAD_SHA=%s\\n' "$sha"`;

// The substitution keeps what the report DOES — same text on stdout — and changes only whether it
// succeeds. A fixture that also stopped printing would satisfy the refusal assertion for the wrong
// reason: no value handed off because nothing tried, rather than because the attempt failed.
function withFailingReport(slice, code) {
  assert.ok(slice.includes(SHIPPED_REPORT), 'precondition: the shipped report line must be present');
  return slice.replace(SHIPPED_REPORT,
    `  /bin/sh -c '/usr/bin/printf "PR_HEAD_SHA=%s\\n" "$1"; exit ${code}' _ "$sha"`);
}

function runStep7(slice, { revExit = 0 } = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-step7-'));
  try {
    const bin = resolve(dir, 'bin');
    mkdirSync(bin);
    // `rev-parse` is the only git this slice runs, and it must be able to REFUSE: an unresolvable
    // head has its own arm, and a fake that always answers cannot prove the new arm did not take
    // that refusal over.
    writeFileSync(resolve(bin, 'git'),
      '#!/bin/sh\ncase "$1" in rev-parse) [ "$FAKE_REV_EXIT" = 0 ] || exit "$FAKE_REV_EXIT"; '
      + `printf '%s\\n' '${EM_REV}'; exit 0 ;; esac\nexit 99\n`);
    chmodSync(resolve(bin, 'git'), 0o755);
    const script = 'head=feat/pr-3\nPUSH_BLOCKED=\n' + slice;
    const r = spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, FAKE_REV_EXIT: String(revExit) },
    });
    return { status: r.status, out: String(r.stdout), err: String(r.stderr) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the PR head handoff when the report fails → the fence fails instead of reporting success', () => {
  const slice = step7Slice();

  // The shipped slice, unmodified, on the ordinary path — so every assertion below is measured
  // against a fixture proven to work rather than one that never could.
  const ok = runStep7(slice);
  assert.equal(ok.status, 0, 'a fence that resolved and reported must exit 0: ' + ok.err);
  assert.match(ok.out, new RegExp('PR_HEAD_SHA=' + EM_REV), 'and hand the value off: ' + ok.out);

  // The defect: the report exits non-zero, `PUSH_BLOCKED` stays empty, and `[[ -z "$PUSH_BLOCKED" ]]`
  // — the fence's last line — reports the success of a handoff that did not complete. Step 8 then
  // merges with `--match-head-commit` against whatever the caller believed the SHA to be.
  const failing = withFailingReport(slice, 7);
  assert.notEqual(failing, slice, 'MUTANT APPLIED: the report must actually be made to fail');
  const bad = runStep7(failing);
  assert.notEqual(bad.status, 0, 'a report that exited non-zero must not read as a completed fence');
  assert.match(bad.err, /PR head SHA could not be reported \(printf exited 7\)/,
    'and must name which step is now missing its input, with the status: ' + bad.err);

  // Negative control: removing the capture and its arm brings the defect back. Both, because the
  // capture alone reads a status nothing consults and the arm alone reads an unbound variable.
  const reverted = failing
    .replace(/^  REPORT_STATUS=\$\?\n/m, '')
    .replace(/^  if \[\[ "\$REPORT_STATUS" != 0 \]\]; then\n(?:.*\n)*?^  fi\n/m, '');
  assert.ok(!reverted.includes('REPORT_STATUS'),
    'MUTANT APPLIED: both the capture and the arm must actually be removed');
  const blind = runStep7(reverted);
  assert.equal(blind.status, 0,
    'precondition: without the capture the failed handoff exits 0: ' + blind.err);
  assert.match(blind.out, /PR_HEAD_SHA=/,
    'precondition: and it still printed, so the difference above is the status, not the output');

  // An unresolvable head still fails through its own arm — the new arm must not have quietly taken
  // over a refusal that already existed under a different name.
  const unresolved = runStep7(slice, { revExit: 1 });
  assert.notEqual(unresolved.status, 0, 'an unresolvable head must still stop the fence');
  assert.match(unresolved.err, /cannot resolve PR head/, unresolved.err);
});

// ── round-74: the rollback push owed two checks the Step 5 push has had since round 60 ────────
//
// Fields are SUBSTITUTED, never exported. § 4.54's lesson: a harness that seeds `ROLLBACK_READING`
// into the environment supplies the very value the fence is supposed to bind, so every case passes
// while the shipped fence reads nothing at all — which is how the missing binding survived a whole
// round of green tests. The `<quoted …>` fields are replaced here exactly as an operator replaces
// them, and an unsubstituted one must reach the refusing arm.
function rollbackGateSlice() {
  const lines = readSkill().split('\n');
  const i = lines.findIndex((l) => l.startsWith('ROLLBACK_READING=<'));
  assert.ok(i >= 0, 'the rollback fence must bind the classifier verdict as a substituted field');
  const push = lines.findIndex((l, n) => n > i && l === CANONICAL_PUSH);
  assert.ok(push > i, 'and the gate must sit above the rollback push it guards');
  return lines.slice(i, push + 1).join('\n');
}

const RB_REMOTE = '2222222222222222222222222222222222222222';

// `approvedTip` defaults to the tip the harness makes the fence MEASURE, so every pre-existing
// row keeps describing an undrifted remote and the new comparison is invisible to it. A different
// value exercises drift; `''` is the slot a model left empty; `null` leaves the placeholder itself
// unsubstituted. It cannot be `undefined` — that is what the default below consumes.
function runRollbackGate({ reading, attested = '', pushed = EM_REV, tip = EM_REV,
  approvedTip = tip, lsExit = 0, ancestorExit = 0, importedExit = false, mutate = null,
  reprobeUrl = null, reprobeExit = 0 } = {}) {
  const dir = mkdtempSync(resolve(tmpdir(), 'em-rbgate-'));
  try {
    const bin = resolve(dir, 'bin');
    mkdirSync(bin);
    const pushLog = resolve(dir, 'push');
    // Round 75. The ancestry call is logged with its whole argument vector, not merely counted: a
    // classifier that re-resolved `refs/heads/<head>` instead of comparing the object being
    // published would return the same configured status, and every execution test would stay green.
    const mbLog = resolve(dir, 'mb');
    writeFileSync(resolve(bin, 'git'),
      '#!/bin/sh\ncase "$1" in\n'
      // Round 76: the local URL re-probe is answered before the tip lookup's own exit switch —
      // a `--get-url` served a ref line (or a lookup failure) would turn every reading `unknown`
      // and this harness would report the fail-closed arm working while measuring a broken double.
      + '  ls-remote) case "$2" in --get-url) printf \'%s\\n\' "${FAKE_REPROBE_URL-$4}"; '
      + 'exit "${FAKE_REPROBE_EXIT-0}" ;; esac; '
      + '[ "$FAKE_LS_EXIT" = 0 ] || exit "$FAKE_LS_EXIT"; '
      + '[ -z "$FAKE_TIP" ] || printf \'%s\\t%s\\n\' "$FAKE_TIP" "$5"; exit 0 ;;\n'
      + '  merge-base) printf \'%s\\n\' "$*" >>' + JSON.stringify(mbLog) + '; exit "$FAKE_ANCESTOR_EXIT" ;;\n'
      + '  push) printf \'%s\\n\' "$*" >>' + JSON.stringify(pushLog) + '; exit 0 ;;\n'
      + 'esac\nexit 99\n');
    chmodSync(resolve(bin, 'git'), 0o755);
    const slice = rollbackGateSlice()
      .replace(/^ROLLBACK_READING=<[^\n]*$/m,
        reading === undefined ? 'ROLLBACK_READING=<the ROLLBACK_READING value the classifier fence printed for this iteration, written literally and quoted>' : `ROLLBACK_READING=${JSON.stringify(reading)}`)
      .replace(/^UNSHARED_ATTESTED=<[^\n]*$/m, `UNSHARED_ATTESTED=${JSON.stringify(attested)}`)
      .replace(/^APPROVED_TIP=<[^\n]*$/m,
        approvedTip === null ? '$&' : `APPROVED_TIP=${JSON.stringify(approvedTip)}`);
    let body = slice;
    if (mutate) {
      body = mutate(slice);
      // A substitution that silently matched nothing runs the SHIPPED fence and reports whatever
      // the shipped fence does — which for a mutant control reads as the control passing.
      assert.notEqual(body, slice, 'MUTANT APPLIED: the substitution must change the fence');
    }
    const prefix = 'head=feat/pr-3\nPUSHED=' + pushed
      + '\nPUSH_URLS=https://push.example/b.git\nPUSH_URLS_DIGEST=abc\nPUSH_BLOCKED=\n';
    const r = spawnSync('/bin/bash', ['-c', prefix + body], {
      encoding: 'utf8',
      env: {
        ...process.env, PATH: bin + ':' + process.env.PATH,
        FAKE_TIP: tip, FAKE_LS_EXIT: String(lsExit), FAKE_ANCESTOR_EXIT: String(ancestorExit),
        FAKE_REPROBE_EXIT: String(reprobeExit),
        ...(reprobeUrl === null ? {} : { FAKE_REPROBE_URL: reprobeUrl }),
        // `true` means the returning stub; an object lets a caller supply a different function
        // body — round 79 needs one that *erases* the refusal record rather than merely returning.
        ...(importedExit === true ? EM_IMPORTED_EXIT : (importedExit || {})),
      },
    });
    return {
      status: r.status, out: String(r.stdout), err: String(r.stderr),
      pushArgs: existsSync(pushLog) ? readFileSync(pushLog, 'utf8').trim() : '',
      mbArgs: existsSync(mbLog) ? readFileSync(mbLog, 'utf8').trim() : '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the rollback rows the table marks "do not push" → reach no push at all', () => {
  // The table has said this since round 53. Nothing in the executable fence read it until round
  // 74: the push predicates were an empty PUSH_BLOCKED and a non-empty PUSHED, both true here.
  for (const [reading, phrase] of [['no-op', /already holds backup/], ['head-deleted', /somebody else deleted it/]]) {
    const r = runRollbackGate({ reading });
    assert.notEqual(r.status, 0, `${reading}: the fence must refuse`);
    assert.match(r.err, phrase, `${reading}: and say which row refused it: ${r.err}`);
    assert.equal(r.pushArgs, '', `${reading}: nothing may be pushed — got ${r.pushArgs}`);
  }

  // The rows that DO push still push — a gate that refuses everything is not a gate, and this is
  // the control that separates "reads the verdict" from "stopped working".
  const ff = runRollbackGate({ reading: 'fast-forward' });
  assert.equal(ff.status, 0, 'a fast-forward rollback must still publish: ' + ff.err);
  assert.match(ff.pushArgs, new RegExp(`${EM_REV}:refs/heads/feat/pr-3`),
    'and by object ID under the head name: ' + ff.pushArgs);

  // An unsubstituted field is the failure this shape exists to catch: the empty string and the
  // literal placeholder must both refuse rather than fall through to a benign arm.
  for (const [label, opts] of [['unsubstituted', {}], ['empty', { reading: '' }]]) {
    const r = runRollbackGate(opts);
    assert.notEqual(r.status, 0, `${label}: an unbound verdict must refuse`);
    assert.equal(r.pushArgs, '', `${label}: and push nothing — got ${r.pushArgs}`);
  }
});

test('the rollback push when the remote moved after classification → re-measured, not assumed', () => {
  // The classifier ran in an earlier fence, before the approval and before `git switch -C`
  // produced the object being pushed. `switch -C` puts the branch's previous OID into the reflog,
  // which is what `--force-if-includes` certifies against, and the bare lease reads the tracking
  // ref rather than the remote — so all three of the push's own protections can pass on a remote
  // that changed since the only classification the operator ever saw.
  const moved = runRollbackGate({ reading: 'fast-forward', tip: RB_REMOTE, ancestorExit: 1 });
  assert.notEqual(moved.status, 0, 'a remote the pushed object does not contain must stop here');
  assert.match(moved.err, /the remote moved since the rollback was classified/, moved.err);
  assert.match(moved.err, new RegExp(RB_REMOTE), 'and name what the remote now holds: ' + moved.err);
  assert.equal(moved.pushArgs, '', 'nothing may be pushed: ' + moved.pushArgs);

  // With the attestation the operator gave BY NAME, the same measurement permits it. Without this
  // the refusal above would be indistinguishable from "rewrites are never allowed here", which is
  // not what the rollback path is for.
  const attested = runRollbackGate({
    reading: 'fast-forward', tip: RB_REMOTE, ancestorExit: 1, attested: 'refs/heads/feat/pr-3' });
  assert.equal(attested.status, 0, 'an attested rewrite must proceed: ' + attested.err);
  assert.match(attested.pushArgs, new RegExp(`${EM_REV}:refs/heads/feat/pr-3`), attested.pushArgs);

  // An attestation for a DIFFERENT ref is not an attestation for this one.
  const other = runRollbackGate({
    reading: 'fast-forward', tip: RB_REMOTE, ancestorExit: 1, attested: 'refs/heads/feat/pr-9' });
  assert.notEqual(other.status, 0, 'an attestation naming another ref must not authorize this one');
  assert.equal(other.pushArgs, '', other.pushArgs);

  // A measurement that could not answer refuses whatever was attested: the attestation says the
  // ref is unshared, `unknown` says the measurement failed, and neither answers the other.
  for (const [label, opts] of [
    ['lookup failed', { lsExit: 1 }],
    ['ancestry errored', { tip: RB_REMOTE, ancestorExit: 2 }],
  ]) {
    const r = runRollbackGate({ reading: 'fast-forward', attested: 'refs/heads/feat/pr-3', ...opts });
    assert.notEqual(r.status, 0, `${label}: fail-closed`);
    assert.match(r.err, /post-restore topology reads 'unknown'/, `${label}: ${r.err}`);
    assert.equal(r.pushArgs, '', `${label}: ${r.pushArgs}`);
  }
});

// ── Round 76: the resolved URL is rewritten a second time ────────────────────────────────────

test('the rollback re-check when the resolved URL is rewritten again → refuses whatever was attested', () => {
  // Measured 2026-08-22 (git 2.55.0): with `url.<B>.insteadOf=<A>` and `url.<C>.insteadOf=<B>` the
  // push lands in B while `git ls-remote -- <B>` answers **C's** tip — git applies the rewrite
  // table again to the string it is handed. The lease this fence builds would then carry a tip
  // measured from a repository the rollback never contacts, which is worse than no lease: it reads
  // as a lease that was checked.
  const chained = runRollbackGate({ reading: 'fast-forward', attested: 'refs/heads/feat/pr-3',
    tip: RB_REMOTE, ancestorExit: 1, reprobeUrl: 'https://push.example/c.git' });
  assert.notEqual(chained.status, 0, 'a second rewrite must refuse even with the attestation in hand');
  assert.equal(chained.pushArgs, '', 'and nothing may be pushed: ' + chained.pushArgs);

  // Silence is not evidence that the URL survived unchanged.
  const broken = runRollbackGate({ reading: 'fast-forward', attested: 'refs/heads/feat/pr-3',
    tip: RB_REMOTE, ancestorExit: 1, reprobeExit: 128 });
  assert.notEqual(broken.status, 0, 'a re-probe that cannot answer must refuse too');
  assert.equal(broken.pushArgs, '', broken.pushArgs);

  // Negative control: identical fixture, URL unchanged, and the attested rewrite must still
  // publish. A detector that refused everything would satisfy both assertions above.
  const ok = runRollbackGate({ reading: 'fast-forward', attested: 'refs/heads/feat/pr-3',
    tip: RB_REMOTE, ancestorExit: 1, reprobeUrl: 'https://push.example/b.git' });
  assert.equal(ok.status, 0, 'an unchanged URL must leave the attested rewrite pushable: ' + ok.err);
  assert.match(ok.pushArgs, new RegExp(`${EM_REV}:refs/heads/feat/pr-3`), ok.pushArgs);
});

test('the Step 5 destination when the resolved URL is rewritten again → refuses before any lookup', () => {
  const slice = step5DestinationSlice();
  const chained = runStep5Destination(slice, { lsOut: EM_REV + '\trefs/heads/feat/pr-3',
    reprobeUrl: 'https://push.example/c.git' });
  assert.notEqual(chained.status, 0, 'a second rewrite must block the push');
  assert.deepEqual(chained.lookups, [],
    'and no tip may be read — it would come from the repository this push never contacts: '
    + JSON.stringify(chained.lookups));
  assert.equal(chained.reprobed.length, 1,
    'the re-probe itself must have run exactly once: ' + JSON.stringify(chained.reprobed));

  const broken = runStep5Destination(slice, { lsOut: EM_REV + '\trefs/heads/feat/pr-3',
    reprobeExit: 128 });
  assert.notEqual(broken.status, 0, 'a re-probe that cannot answer must block the push too');
  assert.deepEqual(broken.lookups, [], JSON.stringify(broken.lookups));

  // Negative control: unchanged URL, same fixture, ordinary path intact.
  const ok = runStep5Destination(slice, { lsOut: EM_REV + '\trefs/heads/feat/pr-3' });
  assert.equal(ok.status, 0, 'an unrewritten URL must still be measured: ' + ok.err);
  assert.equal(ok.lookups.length, 1, JSON.stringify(ok.lookups));
});

// ── Round 75 ─────────────────────────────────────────────────────────────────────────────────
// Everything below was registered in round 75, not round 74. The distinction is not bookkeeping
// pedantry: round 74's own verification note records five suites totalling 354, and a reader who
// sees these three tests under the preceding round-74 banner reads that recorded number as an
// undercount of its own work rather than as a correct snapshot of a smaller tree. They sit here
// because they exercise the round-74 fences — which is exactly why they needed their own banner.
test('the rollback gates when `exit` is a function that returns → the push is still not reached', (t) => {
  // This document's whole thesis: `exit` is a builtin, so an imported `BASH_FUNC_exit%%` outranks
  // it and a refusal that leans on `exit 1` alone prints in full and then pushes anyway. Both
  // gates added in round 74 end in `PUSH_BLOCKED=1; exit 1`, and it is the ASSIGNMENT that has to
  // do the work — the push is reached only through `[[ -z "$PUSH_BLOCKED" ]]`, whose operands the
  // parser resolves before any function name is looked up. Untested, these arms would be
  // indistinguishable from arms that only print.
  if (!emFunctionImportWorks()) {
    t.skip('this bash does not import functions from the environment');
    return;
  }
  const cases = [
    ['head-deleted row', { reading: 'head-deleted' }],
    ['unbound verdict', {}],
    ['post-restore rewrite, unattested', { reading: 'fast-forward', tip: RB_REMOTE, ancestorExit: 1 }],
    ['post-restore measurement failed', { reading: 'fast-forward', attested: 'refs/heads/feat/pr-3', lsExit: 1 }],
  ];
  for (const [label, opts] of cases) {
    const r = runRollbackGate({ ...opts, importedExit: true });
    assert.equal(r.pushArgs, '',
      `${label}: with \`exit\` neutered the flag must still stop the push — got ${r.pushArgs}`);
  }

  // Control 1 — the mutant that proves the flag is the mechanism: strip the assignment out of the
  // `head-deleted` arm and leave the `exit 1` it was paired with. Under the same imported `exit`
  // that arm now refuses in words only, and the push it was guarding happens.
  const stripped = runRollbackGate({
    reading: 'head-deleted', importedExit: true,
    // Anchored on this arm's own message, not on the last `PUSH_BLOCKED=1` before `esac` — that
    // one is the `*)` catch-all, and stripping it would leave the arm under test untouched.
    mutate: (fence) => fence.replace(
      /(report and hand back\.\" >&2\n *)readonly PUSH_BLOCKED=1; (exit 1 ;;)/, '$1$2'),
  });
  assert.match(stripped.pushArgs, new RegExp(`${EM_REV}:refs/heads/feat/pr-3`),
    'control: without the flag the neutered `exit` lets the refused push through: ' + stripped.pushArgs);

  // Control 2 — a permitted row still publishes under the same imported `exit`, so the assertions
  // above are about the flag rather than about a harness that stopped working.
  const ff = runRollbackGate({ reading: 'fast-forward', importedExit: true });
  assert.match(ff.pushArgs, new RegExp(`${EM_REV}:refs/heads/feat/pr-3`),
    'control: a permitted row must still publish: ' + ff.pushArgs);
});

// Round 79. `EM_IMPORTED_EXIT` only *returns* — the harness's own stub, and a weaker attack than
// the fence claimed to survive. The function replacing `exit` runs arbitrary code, so one
// assignment of its own erases the record the refusal just wrote. Measured 2026-08-22 on bash
// 3.2.57 and 5.3.15: refusal printed, flag cleared, push ran at status 0. `readonly` at every
// pre-push refusal site is what closes it.
const EM_ERASING_EXIT = { 'BASH_FUNC_exit%%': '() { PUSH_BLOCKED=; return 0; }' };

test('every refusal that pairs with `exit` freezes its record; the post-push ones need not', () => {
  // The behavioural pair below exercises the rollback fence. The freeze is a property of all three
  // fences, and the vector is defined by the pairing rather than by the site: wherever a refusal
  // hands control to `exit`, the function that replaced `exit` gets to run before the guard reads
  // the flag. Enumerating is what covers Step 5 too, whose harness cannot observe a push.
  const text = readFileSync(resolve(__dirname, '../../skills/epic-merge/SKILL.md'), 'utf8');
  const paired = text.split('\n').filter((l) => /^\s*(readonly )?PUSH_BLOCKED=1;\s*exit\b/.test(l));
  assert.ok(paired.length >= 19, `expected the fences' refusal sites, found ${paired.length}`);
  for (const l of paired) {
    assert.match(l, /^\s*readonly PUSH_BLOCKED=1;/,
      `an exit-paired refusal left its record thawable: ${l.trim()}`);
  }

  // The `${VAR:?}` refusals terminate through parameter expansion, which no imported function can
  // intercept — but they are pre-push, and a reader copying one should not have to know which kind
  // they are holding. Uniform.
  // Anchored on BOTH lines: the `${VAR:?}` idiom is used for many refusals in this document that
  // never touch `PUSH_BLOCKED`, and filtering on the expansion line alone matched 17 of them.
  const all = text.split('\n');
  const expansionPaired = all
    .filter((l, i) => /^\s*(readonly )?PUSH_BLOCKED=1\s*$/.test(l)
      && /^\s*SD0X_EPIC_MERGE_REFUSED=\s*$/.test(all[i + 1] || ''));
  assert.equal(expansionPaired.length, 3, 'the three expansion-terminated refusals must still exist');
  for (const l of expansionPaired) {
    assert.match(l, /^\s*readonly PUSH_BLOCKED=1\s*$/, `not frozen: ${l.trim()}`);
  }

  // Negative control, using the same words as ordinary data: the post-push accumulation sites are
  // plain assignments BY DESIGN — no `exit` runs between them and the guard, and freezing the first
  // would make the second error in an ordinary run. A rule of "no plain assignment anywhere" would
  // be green today and wrong; this row is what keeps the guard about the pairing.
  const plain = text.split('\n').filter((l) => /^\s*PUSH_BLOCKED=1\s*(;;)?\s*$/.test(l));
  assert.ok(plain.length >= 4,
    `the post-push accumulation sites must remain plain assignments, found ${plain.length}`);
});

test('the rollback gates when `exit` ERASES the flag → the freeze holds and the push is not reached', (t) => {
  if (!emFunctionImportWorks()) {
    t.skip('this bash does not import functions from the environment');
    return;
  }
  const r = runRollbackGate({ reading: 'head-deleted', importedExit: EM_ERASING_EXIT });
  assert.equal(r.pushArgs, '',
    `an erasing \`exit\` must not turn a refusal into a force-push — got ${r.pushArgs}`);

  // Control: the pre-round-79 document — same assignment, same `exit 1`, no freeze. Without this
  // row going green the assertion above could be passing for any other reason.
  const thawed = runRollbackGate({
    reading: 'head-deleted', importedExit: EM_ERASING_EXIT,
    mutate: (fence) => {
      const out = fence.replace(/readonly PUSH_BLOCKED=1/g, 'PUSH_BLOCKED=1');
      assert.notEqual(out, fence, 'MUTANT APPLIED: the fence must carry frozen refusal records');
      return out;
    },
  });
  assert.match(thawed.pushArgs, new RegExp(`${EM_REV}:refs/heads/feat/pr-3`),
    'control: without the freeze the erased refusal lets the push through: ' + thawed.pushArgs);
});

test('the post-restore ancestry call → compares the published object, not the branch name', () => {
  // Round 75. `$PUSHED` is the object the refspec publishes; `refs/heads/${head}` is a name git
  // resolves again, later, inside its own process. Round 74 fixed exactly this substitution one
  // fence over in `/push-ci` (§ 4.60) — the rollback classifier had the same shape and no test
  // that could tell the two apart, because a configured ancestry status answers both identically.
  const r = runRollbackGate({ reading: 'fast-forward', tip: RB_REMOTE, ancestorExit: 0 });
  assert.equal(r.mbArgs, `merge-base --is-ancestor ${RB_REMOTE} ${EM_REV}`,
    'the classifier must name RB_TIP and PUSHED, in that order: ' + r.mbArgs);

  // Mutation control: put the branch NAME back on the right-hand side. The recorded call changes,
  // the assertion above turns red, and the execution rows above stay green — which is precisely
  // why counting invocations was never enough.
  const mutant = runRollbackGate({
    reading: 'fast-forward', tip: RB_REMOTE, ancestorExit: 0,
    mutate: (fence) => fence.replace(
      /(git merge-base --is-ancestor "\$RB_TIP" )"\$PUSHED"/, '$1"refs/heads/${head}"'),
  });
  assert.equal(mutant.mbArgs, `merge-base --is-ancestor ${RB_REMOTE} refs/heads/feat/pr-3`,
    'control: the substitution must reach the recorded call: ' + mutant.mbArgs);
  assert.notEqual(mutant.mbArgs, r.mbArgs,
    'control: and the two must be distinguishable — otherwise the assertion above proves nothing');
});

test('a head deleted on the remote after classification → refused, never recreated', (t) => {
  // The contract table at § the rollback reading table and the comment above the push both said
  // "do not push: report and hand back". Until round 75 the executable `case` grouped `creation`
  // with the benign rows and published. The pre-restore `head-deleted` row cannot cover this: it
  // answers about the remote BEFORE the local restore, and a deletion landing in between arrives
  // here instead.
  const r = runRollbackGate({ reading: 'fast-forward', tip: '' });
  assert.notEqual(r.status, 0, 'the creation row must refuse');
  assert.match(r.err, /would be a CREATION/, 'and say why: ' + r.err);
  assert.equal(r.pushArgs, '', 'nothing may be published — got ' + r.pushArgs);

  // The same row under the imported `exit` this document is written against: the flag, not the
  // builtin, is what stops the push.
  if (!emFunctionImportWorks()) {
    t.skip('this bash does not import functions from the environment');
    return;
  }
  const shadowed = runRollbackGate({ reading: 'fast-forward', tip: '', importedExit: true });
  assert.equal(shadowed.pushArgs, '',
    'with `exit` neutered the flag must still stop it — got ' + shadowed.pushArgs);

  // Control: the row next to it still publishes, so this is a refusal of the creation case rather
  // than of an empty tip in general.
  const ff = runRollbackGate({ reading: 'fast-forward', tip: RB_REMOTE, ancestorExit: 0 });
  assert.match(ff.pushArgs, new RegExp(`${EM_REV}:refs/heads/feat/pr-3`),
    'control: a fast-forward rollback must still publish: ' + ff.pushArgs);
});

test('each force-push binds its lease to the tip its own fence measured', () => {
  // The shape assertion in `assertPushProperties` accepts `$FINAL_TIP` or `$RB_TIP` on either
  // line, because it runs over both. That disjunction alone would let the rollback push lease
  // against Step 5's variable — a name that is not even bound in that fence, so the lease would
  // expand to the empty string and become "this ref must not exist yet" on a push whose whole
  // purpose is to overwrite one. Pin the pairing here instead of widening that helper.
  assert.match(CANONICAL_ITERATION_PUSH, /--force-with-lease="refs\/heads\/\$\{head\}:\$\{FINAL_TIP\}"/,
    'the iteration push leases against the tip Step 5 measured');
  assert.match(CANONICAL_PUSH, /--force-with-lease="refs\/heads\/\$\{head\}:\$\{RB_TIP\}"/,
    'the rollback push leases against the tip its own post-restore check measured');
  assert.doesNotMatch(CANONICAL_ITERATION_PUSH, /RB_TIP/, 'and neither borrows the other name');
  assert.doesNotMatch(CANONICAL_PUSH, /FINAL_TIP/, 'in either direction');
});

test('the rollback push at runtime → the measured tip reaches the lease value', () => {
  // Byte pins prove which bytes were reviewed; this proves what the fence actually issues. A
  // lease naming a variable the fence never bound expands to nothing and git reads the empty
  // expectation as "the ref must not exist" — measured 2026-08-22 on git 2.55.0: that form
  // creates an absent ref and is rejected `(stale info)` against an existing one, so a rollback
  // carrying it would refuse every push it was written to make, and refuse it for the wrong
  // reason. Here the classified tip must appear literally.
  const r = runRollbackGate({ reading: 'fast-forward', tip: RB_REMOTE, ancestorExit: 0 });
  assert.match(r.pushArgs, new RegExp(`--force-with-lease=refs/heads/feat/pr-3:${RB_REMOTE}(?:\\s|$)`),
    'the lease must carry the tip part (b) measured: ' + r.pushArgs);
  assert.doesNotMatch(r.pushArgs, /--force-if-includes/,
    'and not the flag git documents as inert beside a lease value: ' + r.pushArgs);

  // Mutation control: lease against the object being PUSHED instead of the destination tip. The
  // push still happens and every other assertion in this file stays green — only this one moves.
  const mutant = runRollbackGate({
    reading: 'fast-forward', tip: RB_REMOTE, ancestorExit: 0,
    mutate: (fence) => fence.replace('${head}:${RB_TIP}', '${head}:${PUSHED}'),
  });
  assert.match(mutant.pushArgs, new RegExp(`--force-with-lease=refs/heads/feat/pr-3:${EM_REV}(?:\\s|$)`),
    'control: the substitution must reach the issued command: ' + mutant.pushArgs);
  assert.notEqual(mutant.pushArgs, r.pushArgs,
    'control: and the two must be distinguishable');
});

// ── round 77: an attestation is not an approval ───────────────────────────────
//
// `rules/git-workflow.md` § Push safety fixes an ORDER: the unshared question is put to the
// operator by name and **before** the force approval. Both post-measurement fences here can
// discover a rewrite that the pre-operation classification did not predict — the per-iteration
// approval in hand was given for a topology the rebase or the remote has since changed — so the
// recovery instruction must send the operator back for a fresh approval after the attestation,
// not merely tell them to re-enter the fence with the attestation set.

function rewriteRecoveryArms(text) {
  // Cut on the `rewrite)` label and the `fi ;;` that closes its attestation test, never on a line
  // count: these blocks grow every time a reason is added, and a count-based slice would silently
  // start reading the next arm's prose.
  const arms = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*rewrite\)\s*$/.test(lines[i])) continue;
    const end = lines.findIndex((l, n) => n > i && /^\s*fi ;;\s*$/.test(l));
    assert.ok(end > i, 'a rewrite arm must terminate');
    arms.push(lines.slice(i, end + 1).join('\n'));
  }
  return arms;
}

const EM_QUESTION = /unshared question to the operator by name/i;
const EM_FRESH = /approval AGAIN|FRESH push approval/;

test('both rewrite recovery arms → send the operator back for an approval, not just an attestation', () => {
  const arms = rewriteRecoveryArms(readSkill());
  // TWO, and the count is asserted: this document carries the Step 5 fence and the rollback fence,
  // and fixing one while leaving the other is exactly the shape this round found.
  assert.equal(arms.length, 2, `both fences must carry a rewrite recovery arm: ${arms.length}`);
  for (const arm of arms) {
    assert.match(arm, EM_QUESTION, `the arm must still ask the unshared question by name: ${arm}`);
    assert.match(arm, EM_FRESH,
      'an attestation answers whether the ref is shared; it is not an approval of a rewrite, so '
      + `the arm must require the force approval to be asked again: ${arm}`);
    // ORDER, not mere presence — the rule fixes the sequence, and an arm naming both in the wrong
    // order would satisfy two `match` assertions while instructing the opposite of the contract.
    assert.ok(arm.search(EM_QUESTION) < arm.search(EM_FRESH),
      `the unshared question must be put BEFORE the approval it precedes: ${arm}`);
    assert.match(arm, /has since changed|appeared afterwards/,
      `the arm must say WHY the approval in hand does not cover this push: ${arm}`);
  }
});

test('a rewrite recovery arm when the approval step is dropped → the check turns red', () => {
  // Negative control on BOTH arms: the shipped-before-round-77 wording — question, then straight
  // back into the fence — must be rejected. Without it the assertions above pass on any arm that
  // mentions both phrases anywhere, including one that never required a second approval.
  for (const arm of rewriteRecoveryArms(readSkill())) {
    const mutant = arm.split('\n').filter((l) => !EM_FRESH.test(l)
      && !/plan that states|shows the lease it will carry|has since changed|appeared afterwards|described this rollback/.test(l))
      .join('\n');
    assert.notEqual(mutant, arm, 'MUTANT APPLIED: the approval step must actually be removed');
    assert.match(mutant, EM_QUESTION, 'precondition: the mutant still asks the unshared question');
    assert.doesNotMatch(mutant, EM_FRESH,
      'precondition: and it no longer requires an approval — which is the defect this pins');
  }
});

// ── round 79: which commit the rollback destroys ──────────────────────────────

test('the rollback push when the remote tip moved after classification → refuses the drifted overwrite', () => {
  // `rewrite` is the ORDINARY reading for a rollback: the backup by construction does not contain
  // the head this skill just pushed. So the reading alone cannot separate "undoing our own push"
  // from "somebody else published on top of it", and the attestation cannot either — it answers
  // whether the ref is shared, not which commit is about to be destroyed. The lease is no help
  // for the same reason it was no help in Step 5: it carries the tip measured HERE.
  const drifted = runRollbackGate({
    reading: 'rewrite', attested: 'refs/heads/feat/pr-3',
    tip: RB_REMOTE, ancestorExit: 1, approvedTip: EM_REV,
  });
  assert.notEqual(drifted.status, 0,
    'a tip that moved since the classification must refuse even when attested: ' + drifted.err);
  assert.equal(drifted.pushArgs, '', 'and nothing may be pushed: ' + drifted.pushArgs);
  assert.match(drifted.err, new RegExp(RB_REMOTE),
    'the refusal must name what the remote holds now: ' + drifted.err);
  assert.match(drifted.err, new RegExp(EM_REV),
    'and what the approval covered, or nothing says what moved: ' + drifted.err);

  // Two shapes of "the model did not fill it in", and both must refuse: the slot left empty, and
  // the placeholder left verbatim. `null` is the harness's sentinel for the second — passing
  // `undefined` would be swallowed by the parameter default and silently test the undrifted path.
  for (const [why, approvedTip] of [['left empty', ''], ['left as the placeholder', null]]) {
    const unfilled = runRollbackGate({
      reading: 'rewrite', attested: 'refs/heads/feat/pr-3',
      tip: RB_REMOTE, ancestorExit: 1, approvedTip,
    });
    assert.notEqual(unfilled.status, 0, `an approved-tip slot ${why} must refuse: ${unfilled.err}`);
    assert.equal(unfilled.pushArgs, '', `and reach no push: ${unfilled.pushArgs}`);
  }

  // Negative control, and it is the half that makes the three above a guard on DRIFT rather than
  // on rollbacks: with the tip unmoved, the same attested rewrite must still push.
  const ok = runRollbackGate({
    reading: 'rewrite', attested: 'refs/heads/feat/pr-3',
    tip: RB_REMOTE, ancestorExit: 1, approvedTip: RB_REMOTE,
  });
  assert.equal(ok.status, 0, 'the undrifted attested rollback must still push: ' + ok.err);
  assert.match(ok.pushArgs, /--force-with-lease=refs\/heads\/feat\/pr-3:/,
    'and carry its own lease: ' + ok.pushArgs);
});
