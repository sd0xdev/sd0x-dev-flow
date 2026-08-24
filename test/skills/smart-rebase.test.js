'use strict';

// Regression: `/smart-rebase` granted itself `git rebase` execution on ordinary user approval,
// outside Anchor Register #4's closed workflow list (found in review, 2026-08-16). Register #4's
// exceptions are part of the anchor, so a skill cannot mint a new one by asking. The defect was not
// that the sentence was badly worded; it was that nothing looked.
//
// **What this file used to do, and why it no longer does.** The first answer was a corpus-wide
// scanner: read every skill's prose, classify each sentence as a grant or not, and read every
// shell script for destructive invocations. Four review rounds each defeated it with a spelling it
// had not anticipated, in BOTH directions — and the second direction is what settled it:
//
//   "It is not prohibited for this skill to execute `git rebase --onto` after approval."
//        → a real grant, passed every test (the negation detector saw `prohibited` and suppressed)
//   "The developer must not execute `git rebase` unless the release manager authorizes it."
//        → an honest human-only restriction, reported as an unbounded grant
//   `echo git rebase --onto main base branch`
//        → a script that only PRINTS, reported as an invocation
//
// English and shell both have an unbounded space of equivalent spellings, so no accumulation of
// patterns closes the set; and a control that fires on honest documentation is one the next
// maintainer deletes, taking the true positives with it. The scanner is therefore gone.
//
// What replaces it is two things that are closed by construction rather than by vocabulary:
//
//   1. **Byte pins** on the two sections of THIS skill that carry the authorization statement.
//      Any widening, in any spelling, changes bytes. This is scoped to the file that had the
//      defect — the corpus-wide claim is what could not be honoured, not the per-file one.
//   2. **Executable evidence** for the analysis script: run it against a recording `git` and
//      assert which subcommands it actually invoked. `echo git rebase` invokes nothing, so the
//      false positive cannot occur; a real `git rebase` is recorded whatever the source looks like.
//
// The corpus-wide guarantee is not replaced, and pretending otherwise is what this comment exists
// to prevent: a NEW skill claiming a rebase grant is caught by review against
// `rules/git-workflow.md`'s pinned authorization set (`test/rules/discretion-tiers.test.js`),
// which is where the closed list actually lives.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, chmodSync, existsSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '../..');
const skillPath = resolve(root, 'skills/smart-rebase/SKILL.md');
const scriptPath = resolve(root, 'skills/smart-rebase/scripts/smart-rebase-analyze.sh');
const skill = readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');

// ── 1. Byte pins on the authorization sections ────────────────────────────────

const CANONICAL_PERMISSIONS = [
  "## Permissions",
  "",
  "Claude **must not** execute `git rebase` — **there is no authorization that lifts this**. `rebase` is",
  "a destructive operation under Anchor Register #4 (`@rules/discretion.md`), whose enumerated",
  "approval workflows are a closed set: `/push-ci` (push), `/smart-commit --execute` (add + commit) and",
  "`/epic-merge` (rebase --onto, force-with-lease, squash-merge). This skill is not on that list, so",
  "user approval here cannot create the exception — adding a workflow to the list is itself an",
  "Anchor-level change. This skill **outputs** the rebase command; the developer runs it.",
  "",
  "> **Note on `allowed-tools`**: `Bash(git:*)` is granted because Steps 1–3 read history (`git log`,",
  "> `git rev-parse`, `git branch --show-current`), and `Bash(bash:*)` to run the analysis script —",
  "> the latter cannot be narrowed to specific script paths until",
  "> [#9354](https://github.com/anthropics/claude-code/issues/9354) is resolved. **A tool grant is not",
  "> an authorization**: what may be executed is decided by the rule above, not by what the permission",
  "> string happens to permit.",
].join('\n');

const CANONICAL_PROHIBITED = [
  "## Prohibited",
  "",
  "- **Claude never executes `git rebase`** — not with user approval, not with a confirmed plan.",
  "  Anchor Register #4's workflow list is closed and this skill is not on it",
  "- No rebase on a protected branch — the full set is `@rules/git-workflow.md` § Prohibited",
  "  (`main`, `master`, `develop`, `release/*`), never a shorter list restated here",
  "- No force push to a protected branch, same set",
  "- No command output before the plan has been displayed and the user has reviewed it (Step 4)",
  "- Never suggest a **bare** `--force-with-lease`. It compares the remote ref against your last",
  "  *fetched* value, not against what you have integrated, so a collaborator commit that any",
  "  background `git fetch` already pulled satisfies the lease and is overwritten with exit 0 —",
  "  measured, see `docs/features/push-gate-optin/requests/2026-08-20-push-ci-force-with-lease-r5.md`.",
  "  `--force-if-includes` closes **that one window** and no more — it tests reachability from any",
  "  reflog entry, not from the history being pushed, so a commit you checked out and then dropped is",
  "  still overwritten with exit 0 (measured, same ticket). Suggest both flags and state the residual;",
  "  bare `--force` stays forbidden outright",
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

const PINS = [
  ['## Permissions', CANONICAL_PERMISSIONS],
  ['## Prohibited', CANONICAL_PROHIBITED],
];

// **The two section pins are not the whole claim, and believing they were is the error a reviewer
// found next.** The test asserted that `Permissions` and `Prohibited` are the sections carrying
// authorization. They are not: replacing Step 5's output-only wording with "After the user
// confirms the plan, Claude executes the generated rebase command." left both pins green while
// granting exactly what this file exists to forbid. The `Verification` checklist is a third such
// surface, and enumerating "which sections decide execution" is precisely the judgment that has now
// been wrong twice.
//
// So the file is the unit. A skill document is an instruction surface — every sentence can move
// what Claude executes — and a digest change is a review trigger with a one-command remedy, not a
// false positive. The section pins stay because they name the likeliest change precisely; the
// digest is what makes the coverage complete.
const SKILL_DIGEST = 'd2c6b96e86d171e2cef41200cb8f2cd93268d5d796e7ef80a9819ea8129f9b77';

function digestOf(text) {
  return createHash('sha256').update(text).digest('hex');
}

test('the skill document when read → matches its pinned digest', () => {
  assert.equal(digestOf(skill), SKILL_DIGEST,
    'skills/smart-rebase/SKILL.md changed. This document states that Claude never executes '
    + '`git rebase`, so the change is meant to be looked at: read the diff, confirm no step, table '
    + 'or checklist item now says Claude runs the command, then update SKILL_DIGEST in the same '
    + 'commit.\n'
    + '  node -e "const{createHash}=require(\'crypto\');console.log(createHash(\'sha256\')'
    + '.update(require(\'fs\').readFileSync(\'skills/smart-rebase/SKILL.md\',\'utf8\')'
    + '.replace(/\\r\\n/g,\'\\n\')).digest(\'hex\'))"');
});

test('the digest when execution is granted outside the pinned sections → reports it', () => {
  // The reviewer's exact evasions. Both leave `Permissions` and `Prohibited` byte-identical.
  const evasions = {
    'Step 5 rewritten to say Claude executes the command': (t) => t.replace(
      'Output the command for the developer to run. Claude does not execute it — see § Permissions;',
      'After the user confirms the plan, Claude executes the generated rebase command. See § Permissions;'),
    'the verification checklist item inverted': (t) => t.replace(
      '- [ ] The rebase command was **output**, never executed by Claude',
      '- [ ] The rebase command was executed after the user confirmed the plan'),
    'the workflow step relabelled as an execution step': (t) => t.replace(
      'Step 5: Output → print the rebase command for the developer to run',
      'Step 5: Execute → run the rebase command once the user has confirmed'),
  };
  for (const [label, mutate] of Object.entries(evasions)) {
    const mutated = mutate(skill);
    assert.notEqual(mutated, skill, `the fixture must actually differ from the skill: ${label}`);
    for (const [heading, pinned] of PINS) {
      assert.equal(sectionOf(mutated, heading), pinned,
        `precondition: ${label} must leave the section pins untouched, or it does not demonstrate the gap`);
    }
    assert.notEqual(digestOf(mutated), SKILL_DIGEST, `execution grant undetected: ${label}`);
  }
});

test('the authorization sections when read → match their pinned text byte for byte', () => {
  for (const [heading, pinned] of PINS) {
    assert.equal(sectionOf(skill, heading), pinned,
      `${heading} no longer matches its pin — if the change is intended, update the pin in the same `
      + 'commit so a reviewer sees the authorization statement move');
  }
});

test('the pins when the prohibition is weakened → report it in every spelling tried', () => {
  // Each of these is a real widening. None of them has to be anticipated as a pattern: the pin
  // does not read them, it compares bytes. The first two are the exact evasions that defeated the
  // scanner this file replaced.
  const widenings = {
    'a double negative that reinstates the grant': (t) => t.replace(
      'Claude **must not** execute `git rebase`',
      'It is not prohibited for Claude to execute `git rebase`'),
    'an unless-clause appended to the prohibition': (t) => t.replace(
      '— **there is no authorization that lifts this**',
      '— unless the user explicitly approves it'),
    'the closed-list sentence deleted': (t) => t.replace(
      'user approval here cannot create the exception — adding a workflow to the list is itself an\nAnchor-level change. ', ''),
    'the Prohibited bullet softened': (t) => t.replace(
      '**Claude never executes `git rebase`** — not with user approval, not with a confirmed plan.',
      '**Claude executes `git rebase`** only with user approval and a confirmed plan.'),
    'a grant smuggled into the allowed-tools note': (t) => t.replace(
      '> string happens to permit.',
      '> string happens to permit. With approval, this skill may run the rebase itself.'),
  };
  for (const [label, mutate] of Object.entries(widenings)) {
    const mutated = mutate(skill);
    assert.notEqual(mutated, skill, `the fixture must actually differ from the skill: ${label}`);
    const moved = PINS.filter(([h, pinned]) => sectionOf(mutated, h) !== pinned);
    assert.notEqual(moved.length, 0, `widening undetected: ${label}`);
  }
});

test('the pins when the rest of the skill is edited → stay silent', () => {
  // The half the deleted scanner kept getting wrong. These are ordinary edits someone will make to
  // a skill document, and none of them touches what may be executed. A pin that fires on them is a
  // pin the next maintainer removes.
  const free = {
    'a new example added': (t) => t.replace(
      '# Specify non-main target',
      '# Specify a different remote\n/smart-rebase --target upstream/main\n\n# Specify non-main target'),
    'the workflow step list reworded': (t) => t.replace(
      'Step 6: Verify → confirm history is correct',
      'Step 6: Verify → check that the resulting history is correct'),
    'a row added to the conflict table': (t) => t.replace(
      '| Cannot resolve          |',
      '| Empty commit after skip | `git rebase --skip` again                       |\n| Cannot resolve          |'),
    'the description frontmatter extended': (t) => t.replace(
      'Output: rebase plan table', 'Output: rebase plan table (JSON available)'),
  };
  for (const [label, edit] of Object.entries(free)) {
    const edited = edit(skill);
    assert.notEqual(edited, skill, `the fixture must actually differ from the skill: ${label}`);
    for (const [heading, pinned] of PINS) {
      assert.equal(sectionOf(edited, heading), pinned,
        `an ordinary edit was reported as an authorization change: ${label}`);
    }
  }
});

// ── 2. Executable evidence: what the analysis script actually invokes ─────────
// A lexical scan cannot tell `git rebase --onto ...` inside a JSON string (which the script emits
// as the `rebase_command` field, for the developer to copy) from an invocation. Running it can:
// data is never executed, so it never reaches the recorder.
//
// **What this section proves, and what it does not.** It runs the script under a `git` injected on
// PATH and records every call. That is real evidence about the paths it drives, and it saw through
// two spellings a scanner could not: a runtime-assembled `git "$c$d"`, and a global option hiding
// the subcommand. It is *not* a proof that no destructive execution is possible — three forms reach
// around the shim entirely, and none of them is observable here:
//
//   `/usr/bin/git rebase …`                  — an absolute path never consults PATH
//   `git -c alias.x='!git rebase …' x`       — git executes a shell alias defined on the spot
//   any other binary, wrapper or `sh -c`     — the shim only shims `git`
//
// The middle one reaches the recorder (it *is* PATH-resolved git) but what it runs is the alias
// value, which the shim never executes. So all three are covered by `SCRIPT_DIGEST` below, not by
// anything this harness observes — "what can this shell script execute" is not a decidable
// question, and every round that tried to answer it lexically failed in one direction or the other.
//
// **Which is why the check below is an allow-list, and why it stopped being a classifier.** Three
// rounds were spent teaching a deny-list how git dispatches — global options, then `--help`, then
// case-insensitive aliases, then `--config-env`, then alias values that shadow a built-in — and
// each round found another spelling, in both directions. That set is unbounded because git's
// dispatch is.
//
// The property that closes it is about *this script*, not about git: **it uses no git global
// options**, so `argv[0]` is the subcommand for every call the script is supposed to make and no
// model of git's dispatch is needed. A global option, an alias assignment, `--version`, `--help`, a
// different subcommand: all of them fail to match, none of them has to be recognised.
//
// Writing the list down is itself the mechanism, and twice now it has paid: `fetch` was missing from
// the first draft and every run reported it, and `check-ref-format` was added the same way when the
// script started validating `--target`. A call nobody enumerated is a finding until someone decides
// it belongs.

// **`argv[0]` alone was not enough, and neither was a union of permitted flags.** A subcommand is
// not an operation: `git branch --show-current` reads and `git branch -D main` deletes, with the
// same `argv[0]`. Round 20 added a flag dimension for that, and round 21 broke it in both
// directions at once — which is the signature of a rule that is not shaped like the thing it
// guards:
//
//   `git branch --quiet victim HEAD`  — creates a branch, and every token was independently allowed
//   `git rev-parse --short :/.`       — a legitimate read the colon rule reported
//
// A per-token union cannot separate those, because the danger is not in any token: it is in the
// *combination*. So the check is now a list of **whole argv shapes**, one per call site the script
// actually contains. Each entry is that call site with its literal flags in their literal order;
// `*` is one argument the script interpolates.
//
// This is closed the same way the subcommand list was, one level tighter: the templates *are* the
// call sites, so a call the script does not make cannot match one, whatever its tokens look like.
// `--quiet victim HEAD` matches no shape. `--short :/.` matches `rev-parse --short *` and is
// allowed, because it is a read the script legitimately performs with a caller-supplied `--base`.
//
// **Slot semantics are per call site, not one global wildcard rule** — round 22 broke the global
// version in both directions at once. `ANY_REV` forbids a leading `-`, which is right for a value
// that has already passed validation; applied to *every* slot it also reported
// `check-ref-format --allow-onelevel -evil`, which is the script's own safety check being handed a
// value that is option-shaped by construction. That call is the guard, so its argument slot has to
// accept exactly what the other slots refuse. (The script no longer passes the *bare* stripped
// token — round 23 moved it to `refs/heads/<name>` — but `RAW_INPUT` still has to accept whatever
// `--target` was, and that is unvalidated by definition.)
//
//   `RAW_INPUT` — the value under test. Unvalidated is the point; anything matches
//   `ANY_REV`   — a ref, rev or range that reached this call already validated or built here
//
// The fetch has no slot entry at all: its safety is a relationship between two arguments, which is
// what `FETCH_CALL` below exists to express.
const RAW_INPUT = 'RAW';
const ANY_REV = '*';
// **The fetch is validated as a whole call, not slot by slot, because its safety is a relationship
// between two of its arguments.** The destination must live under the remote this very argv names —
// a per-slot rule cannot see across slots, so `fetch … upstream +refs/heads/main:refs/remotes/origin/main`
// would pass one slot at a time while writing into a namespace the call did not name.
//
// The character class is `[^:*]`, and round 24 is why it is not tighter. The previous class also
// excluded `]` and JavaScript's `\s`; measured against real git, `refs/heads/feat/a]b` and refs
// containing NBSP / U+2028 / U+3000 are all **legal**, so the harness reported a legitimate fetch of
// a legitimate branch as an unauthorized call. `:` and `*` are the two bytes that change what a
// refspec *is* — one adds a destination, the other makes it a pattern — and they are the whole of
// what this control needs to exclude. Everything else about the name is git's judgment, and
// `check-ref-format` in the script is where that judgment is asked for.
const FETCH_CALL = (argv) => {
  if (argv.length < 8) return false;
  const [sub, refmap, noTags, noRecurse, quiet, sep, remote, refspec] = argv;
  // Everything after the positive refspec must be a **negative** one, and nothing else. A CLI
  // refspec does not inherit the remote's configured negatives (measured 2026-08-22), so the script
  // hands them to git here; widening the template to "any trailing argument" would let a second
  // positive refspec — a whole extra destination to write — pass as authorized. `^` is what makes a
  // trailing token subtractive: it has no destination and can only remove sources from the fetch.
  for (const extra of argv.slice(8)) {
    if (extra[0] !== '^' || extra.length < 2) return false;
    if (extra.includes(':') || extra.includes('+')) return false;
  }
  if (sub !== 'fetch' || refmap !== '--refmap=' || noTags !== '--no-tags'
      || noRecurse !== '--no-recurse-submodules' || quiet !== '--quiet' || sep !== '--') return false;
  // The remote is **not** required to be free of a leading `-`, and that is what `--` buys: after
  // the separator git reads the word as an operand, never as an option. Measured in round 25 — a
  // remote named `-evil` is legal in config, `git remote` lists it, and `git fetch -- -evil <spec>`
  // fetches from it. Refusing the shape here would have reported a legitimate repository.
  if (remote.includes(':') || remote.includes('*')) return false;
  const at = refspec.indexOf(':refs/remotes/');
  if (at === -1) return false;
  const src = refspec.slice(0, at);
  const dst = refspec.slice(at + ':refs/remotes/'.length);
  // The source is **not** required to be `refs/heads/<destination tail>` — and the equality this
  // used to assert was not a safety property, it was an assumption. `remote.origin.fetch =
  // +refs/heads/main:refs/remotes/origin/stable` makes `origin/stable` the remote's `main`, so the
  // correct source for that ref is `main`, and a predicate demanding `stable` would report the
  // right fetch as unauthorized while passing the wrong one. What this call must guarantee is the
  // *destination*: a full ref for a source, and a destination confined under the remote this same
  // argv names. Which source is right is a question about configuration, asserted per case below.
  // The source is force-prefixed `+` by the script, and after it a **short** ref is legal: git
  // resolves `main` on the remote, so `remote.origin.fetch = main:refs/remotes/origin/stable` builds
  // the fetch `+main:refs/remotes/origin/stable`. Demanding `+refs/` here rejected the script's own
  // legitimate call. What must still be refused is a source that is option-shaped, a glob, or a
  // second refspec — none of which name a single ref.
  // **A leading `-` on the source is not refused, and refusing it was a regression this control
  // hard-coded.** `refs/heads/-evil` is a legal ref (measured, exit 0) and a repository may
  // legitimately configure `remote.origin.fetch = -evil:refs/remotes/origin/stable`; the script must
  // then be able to refresh through it. What makes the dash harmless *in this position* is that the
  // token is a refspec, not a ref: it always begins with the `+` force marker, so git's option
  // parser never sees an option-shaped argument — and `--` precedes the operands regardless. The
  // dash rule was guarding a position that cannot be reached, while rejecting the script's own call.
  if (src[0] !== '+') return false;
  const srcRef = src.slice(1);
  if (srcRef === '' || srcRef.includes('*') || srcRef.includes(':')) return false;
  // Built rather than matched, because **a remote name may contain `/`**: `team/origin` is legal and
  // git honours it, so a `[^/]+` capture on the destination mis-splits it and reports the fetch it
  // was written to permit. Comparing against the string this very argv names needs no split at all.
  if (!dst.startsWith(`${remote}/`)) return false;
  const branch = dst.slice(`${remote}/`.length);
  return branch !== '' && !branch.includes(':') && !branch.includes('*');
};

const CALL_TEMPLATES = [
  ['branch', '--show-current'],
  ['check-ref-format', '--allow-onelevel', RAW_INPUT],
  FETCH_CALL,
  ['rev-parse', '--git-path', 'FETCH_HEAD'],
  ['rev-parse', '--verify', '--symbolic-full-name', '--end-of-options', RAW_INPUT],
  // The ambiguity probe, used by `--base` and (since round 36) `--target` alike. The operand is
  // built as `refs/<name>` (five prefixes), so it is
  // option-shaped only if `refs/` is — hence `ANY_REV` rather than `RAW_INPUT`, and the `--` is
  // carried anyway so the shape states the rule instead of relying on the prefix to imply it.
  ['show-ref', '--verify', '--quiet', '--', ANY_REV],
  ['remote'],
  ['config', '--get-regexp', '^remote\\..*\\.fetch$'],
  ['rev-parse', '--verify', '--end-of-options', ANY_REV],
  ['rev-parse', '--verify', '--short', '--end-of-options', RAW_INPUT],
  ['rev-parse', '--short', ANY_REV],
  ['rev-parse', ANY_REV],
  ['merge-base', 'HEAD', ANY_REV],
  ['log', '--oneline', '--reverse', ANY_REV],
  ['log', '--oneline', ANY_REV],
  ['cherry', '-v', ANY_REV, 'HEAD'],
];

const SEPARATORS = new Set(['--', '--end-of-options']);

// A caller-supplied value may reach git only in a call that first tells git to stop reading
// options. Asserting "the value never appears" would have been wrong in both directions: it fails
// on the classification probe, which is safe *because* it carries `--end-of-options`, and it would
// pass on a future bare call that happens to spell the value differently.
function bareOccurrences(calls, value) {
  return calls.filter((argv) => {
    const at = argv.indexOf(value);
    if (at === -1) return false;
    return !argv.slice(0, at).some((a) => SEPARATORS.has(a));
  });
}

const SLOTS = new Set([RAW_INPUT, ANY_REV]);

// An `ANY_REV` slot never matches an option: it holds a ref, a rev or a range, none of which can
// begin with `-` — git rejects such a ref name and the script's own argument parser refuses one as a
// value. Without it, `['rev-parse', '*']` would swallow `git rev-parse --short` and any future
// two-token `rev-parse` form nobody enumerated.
function slotMatches(slot, arg) {
  if (slot === RAW_INPUT) return true;
  return !arg.startsWith('-');
}

function matchesTemplate(argv, template) {
  if (typeof template === 'function') return template(argv);
  if (argv.length !== template.length) return false;
  return template.every((slot, i) => (SLOTS.has(slot) ? slotMatches(slot, argv[i]) : slot === argv[i]));
}

function unexpectedCalls(calls) {
  return calls.filter((argv) => !CALL_TEMPLATES.some((t) => matchesTemplate(argv, t)));
}

// **The script is pinned as a whole, for the reason above.** The runtime harness covers behaviour
// on the paths it drives; the digest covers the rest of the file, including every way a shell
// script can invoke something the harness never sees.
const SCRIPT_DIGEST = '1c44bdb7fb71cec98a86b72004e0079ec11b681900fbc0dd1b59ded1c7613626';

test('the analysis script when read → matches its pinned digest', () => {
  assert.equal(digestOf(readFileSync(scriptPath, 'utf8').replace(/\r\n/g, '\n')), SCRIPT_DIGEST,
    'skills/smart-rebase/scripts/smart-rebase-analyze.sh changed. This script runs on a developer '
    + 'machine in a real repository and the skill promises it executes nothing destructive, so the '
    + 'change is meant to be read: confirm no git invocation was added — including an absolute path, '
    + 'an inline `-c alias.…=!…`, or a call through another binary — then update SCRIPT_DIGEST in '
    + 'the same commit.\n'
    + '  node -e "const{createHash}=require(\'crypto\');console.log(createHash(\'sha256\')'
    + '.update(require(\'fs\').readFileSync(\'skills/smart-rebase/scripts/smart-rebase-analyze.sh\','
    + '\'utf8\').replace(/\\r\\n/g,\'\\n\')).digest(\'hex\'))"');
});

test('the script digest when an invocation reaches around the PATH shim → reports it', () => {
  // The reviewer's three evasions. None of them is visible to the runtime harness; all three move
  // the digest, which is the whole reason the digest is here.
  const source = readFileSync(scriptPath, 'utf8').replace(/\r\n/g, '\n');
  const evasions = {
    'an absolute git path, which never consults PATH': (t) => t.replace(
      '  cat <<ENDJSON', '  /usr/bin/git rebase --onto "$TARGET" "$CUT_POINT_HASH" "$CURRENT" >/dev/null 2>&1 || true\n  cat <<ENDJSON'),
    'an inline shell alias git executes for itself': (t) => t.replace(
      '  cat <<ENDJSON', "  git -c alias.plan='!git rebase --onto main base branch' plan || true\n  cat <<ENDJSON"),
    'a call through another interpreter entirely': (t) => t.replace(
      '  cat <<ENDJSON', '  sh -c "git rebase --onto main base branch" || true\n  cat <<ENDJSON'),
  };
  for (const [label, mutate] of Object.entries(evasions)) {
    const mutated = mutate(source);
    assert.notEqual(mutated, source, `the fixture must actually differ from the script: ${label}`);
    assert.notEqual(digestOf(mutated), SCRIPT_DIGEST, `reach-around undetected: ${label}`);
  }
});

// A `git` that records its argv and answers plausibly, so the script runs to completion instead of
// bailing at the first unknown ref — a script that exits early proves nothing about what it would
// have invoked later. Hashes are derived from the argument so `rev-parse <short>` and
// `rev-parse <full>` agree, which is what the --base cut-point comparison needs.
// **`$1` is not the subcommand, and reading it as one was a hole in this harness.** `git` accepts
// global options before the subcommand, and two of them take a separate value:
// `git -C . rebase --onto main base branch` is a real, destructive invocation whose `$1` is `-C`.
// The old shim fell through to its default success branch and the old classifier reported the
// subcommand as `.`, so a mutation using the standard `-C` form would have run a rebase while the
// suite reported none. Both sides share that rule — skip global options, consuming the value of the
// ones that take one, and take the first remaining bare word. The JS classifier goes two steps
// further (`help`, `alias`, documented at `gitSubcommand`); the shim does not need to, because its
// only use for the answer is picking which canned reply to print, and both of those fall through to
// its default.
const GIT_GLOBALS_WITH_VALUE = ['-C', '-c', '--exec-path', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env'];

// argv is recorded **count-prefixed and NUL-delimited**, not space-joined and not TAB-separated.
// `"$*"` flattens `git commit -m "a b"` into words no reader can put back, and argument boundaries
// are exactly what the classifier reads. TAB was the first fix and was still wrong in the same way,
// one byte further out: a tab is a legal argv byte, so `git -c 'x.y=<TAB>bar' rebase` decoded as
// four fields instead of three and the subcommand resolved to `bar`. NUL is the one byte `execve`
// cannot carry inside an argument, and the `$#` prefix means the reader never has to guess where one
// call ends — it is told, by the process that knows.
// `check-ref-format` is delegated to the real git rather than answered by a canned reply. It is a
// pure function of its argument — no repository, no network — and the script now uses it as the
// gate on `--target`. A shim that fell through to its default `exit 0` would accept every ref
// shape, which would leave every test below passing on a script whose validation had been deleted.
const REAL_GIT = spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

const FAKE_GIT = `#!/bin/bash
printf '%s\\0' "$#" "$@" >> "$GIT_CALL_LOG"
if [ "\${1:-}" = check-ref-format ] && [ -n "${REAL_GIT}" ]; then exec ${REAL_GIT} "$@"; fi

sub=""; skip=0
for a in "$@"; do
  if [ "\$skip" = 1 ]; then skip=0; continue; fi
  case "\$a" in
    ${GIT_GLOBALS_WITH_VALUE.join('|')}) skip=1 ;;
    --) skip=0 ;;
    -*) ;;
    *) sub="\$a"; break ;;
  esac
done

case "\$sub" in
  branch)     echo "feat/example" ;;
  fetch)      printf '%s\\tbranch \x27main\x27 of fake\\n' aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111 > ./FETCH_HEAD; exit 0 ;;
  remote)     printf '%s\\n' origin team/origin; printf -- '%s\\n' -evil ;;
  merge-base) echo "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111" ;;
  rev-parse)
    short=0; rskip=0; symbolic=0; gpwait=0; gp=""
    for a in "$@"; do
      if [ "\$rskip" = 1 ]; then rskip=0; continue; fi
      case "\$a" in
        rev-parse|--verify|--quiet|--end-of-options) ;;
        --git-path) gpwait=1 ;;
        --symbolic-full-name) symbolic=1 ;;
        --short) short=1 ;;
        ${GIT_GLOBALS_WITH_VALUE.join('|')}) rskip=1 ;;
        # An unrecognised option-shaped argument is a rev to rev-parse, not an error — measured
        # against real git: symbolic-full-name of -evil/main exits 0 and echoes it back.
        # The shim has to answer the same way, or a test asserting the script never probes such a
        # value would pass on shim strictness rather than on the script.
        *) if [ "\$gpwait" = 1 ]; then gp="\$a"; gpwait=0; else ref="\$a"; fi ;;
      esac
    done
    if [ -n "\$gp" ]; then printf '%s\\n' "./\$gp"; exit 0; fi
    case "\${ref:-}" in *unknown*) exit 1 ;; esac
    if [ "\$symbolic" = 1 ]; then
      # Real git PRINTS the unresolved name and exits 128 — the shim has to do both, or the
      # harness cannot see the bug where stdout is read without checking the status.
      case "\${ref:-}" in *unfetched*) printf '%s\\n' "\$ref"; exit 128 ;; esac
      # The marker above means "a tracking ref not pulled down yet" — fetchable, and printed back
      # on purpose so that a status-blind read of stdout stays visible. This one means the other
      # thing: nothing resolves, ever. Measured, real --verify writes NOTHING to stdout and exits
      # 128 for both; the print above is deliberate fixture strictness, this line matches git.
      case "\${ref:-}" in *nosuchref*) exit 128 ;; esac
      case "\${ref:-}" in
        refs/*)              printf '%s\\n' "\$ref" ;;
        # A remote HEAD is a symbolic ref: real git follows it to the branch it names, and a shim
        # returning it unchanged would hide the whole defect this case exists for. One line, so a
        # fixture can replace it with a failure — the state of a clone whose HEAD was never fetched.
        origin/HEAD|-evil/HEAD|team/origin/HEAD) printf 'refs/remotes/%s/main\\n' "\${ref%/HEAD}" ;;
        origin/*|-evil/*|team/origin/*)
          printf 'refs/remotes/%s\\n' "\$ref" ;;
        *)                   printf 'refs/heads/%s\\n' "\${ref:-}" ;;
      esac
      exit 0
    fi
    # 7, matching \`core.abbrev\` and therefore the \`log\` shim above — one abbreviation width for the
    # whole fixture. A \`--short\` that disagreed with \`--oneline\` would make the cut-point lookup
    # miss on a base the history plainly contains.
    s=$(printf '%s' "\${ref:-}" | cut -c1-7)
    if [ "\$short" = 1 ]; then printf '%s\\n' "\$s"
    else printf '%s0000000000000000000000000000000000\\n' "\$s" | cut -c1-40; fi ;;
  # The default refspec each remote gets from git remote add — one line per remote that the
  # remote case above reports, so the claimant scan sees the same universe the prefix scan does.
  # Faithful, and load-bearing: origin claims refs/remotes/origin/* under its own name too, so every
  # ordinary target is found by BOTH ownership scans, and the dedup is exercised on every pass.
  config)     printf '%s\\n' 'remote.origin.fetch +refs/heads/*:refs/remotes/origin/*' 'remote.team/origin.fetch +refs/heads/*:refs/remotes/team/origin/*' 'remote.-evil.fetch +refs/heads/*:refs/remotes/-evil/*' ;;
  # \`show-ref --verify\` answers "does this EXACT ref exist", and real git exits **1** when it does
  # not. The default \`*) exit 0\` below would have answered "yes" for every path probed, so the
  # \`--base\` ambiguity loop counted all five and refused every ordinary run. The shim's universe
  # is: every name has a branch and nothing has a tag or a remote-tracking ref — internally
  # consistent, and it exercises the guard's pass path (count 1 → symbolic check → proceed).
  # A fixture needing a collision replaces this line.
  show-ref)
    last=""; for a in "\$@"; do last="\$a"; done
    case "\$last" in refs/heads/*) exit 0 ;; *) exit 1 ;; esac ;;
  # The two widths DIFFER, and that is the point: real \`git log --oneline\` prints \`core.abbrev\`
  # (7 by default) while real \`git cherry -v\` prints the full 40-hex OID. This shim used to emit 8
  # and 16 — which the script's own \`cut -c1-8\` then made equal — so a comparison that can never
  # hold against real git held here, and every commit silently reporting \`"cherry":"unique"\` looked
  # correct. A fixture that normalizes away the asymmetry under test is not a fixture, it is the bug.
  log)        printf 'aaaa111 feat: base work\\nbbbb222 feat: keep one\\ncccc333 feat: keep two\\n' ;;
  cherry)     printf -- '- aaaa111000000000000000000000000000000000 feat: base work\\n+ bbbb222000000000000000000000000000000000 feat: keep one\\n' ;;
  *)          exit 0 ;;
esac
exit 0
`;

// Two error branches cannot be reached by argument alone — they turn on what the repository
// answers, not on what the caller asked for. Each is one line of the shim, replaced by line shape
// rather than by literal text, because the literals carry escapes this file would have to spell
// twice.
const GIT_NO_COMMITS = FAKE_GIT.replace(/^ {2}log\).*$/m, '  log)        : ;;');
const GIT_NO_MERGE_BASE = FAKE_GIT.replace(/^ {2}merge-base\).*$/m, '  merge-base) : ;;');

// **A producer that FAILS is not a producer that returns nothing**, and `GIT_NO_COMMITS` above
// cannot tell the two apart — it exits 0 with empty output. These two exit non-zero, which is the
// case that used to be reported as `{"status":"up-to-date"}` with status 0.
const GIT_LOG_FAILS = FAKE_GIT.replace(/^ {2}log\).*$/m, '  log)        exit 42 ;;');

// A refresh that fails. The remote-tracking ref still resolves locally — that is the whole trap:
// every read after the failed fetch succeeds against the copy already on disk, so the run produces
// a confident plan built on history the remote may no longer have.
const GIT_FETCH_FAILS = FAKE_GIT.replace(/^ {2}fetch\).*$/m, '  fetch)      exit 128 ;;');
const GIT_CHERRY_FAILS = FAKE_GIT.replace(/^ {2}cherry\).*$/m, '  cherry)     exit 42 ;;');
// A fetch that succeeds and transfers nothing — what git really does when every positive
// refspec on the line is cancelled by a negative (measured 2026-08-22: exit 0, FETCH_HEAD
// truncated to zero bytes, tracking ref untouched). The shim models it the same way.
const GIT_FETCH_EMPTY = FAKE_GIT.replace(/^ {2}fetch\).*$/m,
  '  fetch)      : > ./FETCH_HEAD; exit 0 ;;');

// A clone whose `refs/remotes/<remote>/HEAD` was never fetched — `git clone` records it, but
// `git remote add` + `git fetch` does not, so this is the ordinary state of most added remotes.
// Real git fails the probe outright there (measured: exit 128, empty stdout).
const GIT_NO_REMOTE_HEAD = FAKE_GIT.replace(/^ {8}origin\/HEAD\|.*$/m,
  '        origin/HEAD|-evil/HEAD|team/origin/HEAD) exit 128 ;;');

const CFG = (...rows) => `  config)     printf '%s\\n'${rows.map((r) => ` '${r}'`).join('')} ;;`;
const withConfig = (...rows) => FAKE_GIT.replace(/^ {2}config\).*$/m, CFG(...rows));

// A non-identity mapping: `origin/stable` IS the remote's `main`, so the source that refreshes it is
// `main`. Legal, and what `git fetch origin` itself would do.
const GIT_NONIDENTITY = withConfig('remote.origin.fetch +refs/heads/main:refs/remotes/origin/stable');

// Two refspecs of one remote covering the same destination from different sources — a repository
// that has not said which branch that tracking ref means.
const GIT_TWO_SOURCES = withConfig(
  'remote.origin.fetch +refs/heads/main:refs/remotes/origin/stable',
  'remote.origin.fetch +refs/heads/other:refs/remotes/origin/stable');

// A second claimant whose positive refspec is cancelled for this very ref by a negative one.
// `git fetch up` cannot write `refs/remotes/origin/main`, so up is not an owner of it.
const GIT_EXCLUDED_CLAIMANT = withConfig(
  'remote.origin.fetch +refs/heads/*:refs/remotes/origin/*',
  'remote.up.fetch +refs/heads/*:refs/remotes/origin/*',
  'remote.up.fetch ^refs/heads/main')
  .replace(/^ {2}remote\).*$/m, "  remote)     printf '%s\\n' origin team/origin up; printf -- '%s\\n' -evil ;;");

// A SHORT negative `^main` beside a non-identity positive `main:refs/remotes/origin/stable`. Git
// does NOT DWIM the negative, so `^main` cancels nothing and the mapping stands — measured. The
// pre-fix raw comparison matched `out=main` against `^main` and wrongly dropped it.
const GIT_SHORT_NEGATIVE = withConfig(
  'remote.origin.fetch main:refs/remotes/origin/stable',
  'remote.origin.fetch ^main');
// The same mapping with the FULL spelling beside it. For a BRANCH source git does honour it; for a
// TAG source it does not, and nothing local can tell the two apart — so round 57 stopped guessing
// and leaves the claim standing, which costs a refused refresh instead of a wrong write.
const GIT_FULL_NEGATIVE = withConfig(
  'remote.origin.fetch main:refs/remotes/origin/stable',
  'remote.origin.fetch ^refs/heads/main');

// **An UNPAIRED wildcard: a literal source with a wildcard destination.** git allows a `*` on one
// side only if it is on both, so it rejects this refspec wholesale — measured:
// `git fetch --dry-run . '+refs/heads/main:refs/remotes/zbad/*'` prints `fatal: invalid refspec`,
// while the same call with a literal or a paired-wildcard destination succeeds. Inverting it anyway
// substituted the literal source for whatever destination the caller named, so `--target bad/victim`
// was refreshed from `main` and planned against history nobody asked for.
const GIT_UNPAIRED_WILDCARD = withConfig('remote.origin.fetch +refs/heads/main:refs/remotes/origin/*');

// **The shape where the claim scan's namespace guess is wrong.** A short positive source resolves
// across the remote's WHOLE namespace, so `tagx:refs/remotes/origin/stable` takes its source from
// `refs/tags/tagx` — while `_claiming_remotes` asks whether `refs/heads/tagx` is excluded, and
// answers no. The claim survives, the fetch is built, and before the negatives travelled with it
// that fetch wrote the very ref the configuration excludes (measured against real git 2026-08-22:
// with `--refmap= --no-tags` and the positive alone, `refs/remotes/origin/stable` was created;
// adding `^refs/tags/tagx` to the same command line left it absent). The `up` row is the control:
// another remote's negative must not travel on an `origin` fetch.
const GIT_TAG_SOURCE_NEGATIVE = withConfig(
  'remote.origin.fetch tagx:refs/remotes/origin/stable',
  'remote.origin.fetch ^refs/tags/tagx',
  'remote.up.fetch ^refs/heads/unrelated');

// A configured SHORT source that is option-shaped. `refs/heads/-evil` is a legal ref (measured:
// `git check-ref-format refs/heads/-evil` exits 0), and git resolves a short source on the remote —
// but `check-ref-format --allow-onelevel -evil` reads the name as an option and exits 129, and
// neither `--` nor `--end-of-options` helps (measured: they make it reject `main` too).
const GIT_DASH_SHORT_SOURCE = withConfig('remote.origin.fetch -evil:refs/remotes/origin/stable');

// A second remote configured to write into `refs/remotes/origin/*`. Legal, and nothing about the
// ref path shows it: `up` is a perfectly ordinary remote whose fetch destination is not its name.
const GIT_SECOND_CLAIMANT = FAKE_GIT
  .replace(/^ {2}remote\).*$/m, "  remote)     printf '%s\\n' origin team/origin up; printf -- '%s\\n' -evil ;;")
  .replace(/^ {2}config\).*$/m,
    "  config)     printf '%s\\n' 'remote.origin.fetch +refs/heads/*:refs/remotes/origin/*' 'remote.up.fetch +refs/heads/*:refs/remotes/origin/*' ;;");

// Strings git accepts and JSON does not, unescaped: a quote in a ref name (`git check-ref-format`
// permits it) and a backslash in a commit subject (anything but a control character is permitted).
const GIT_HOSTILE_STRINGS = FAKE_GIT
  .replace(/^ {2}branch\).*$/m, `  branch)     printf '%s\\n' 'feat/"x' ;;`)
  .replace(/^ {2}log\).*$/m,
    `  log)        printf '%s\\n' 'aaaa1111 feat: base work' 'bbbb2222 feat: back\\slash and "quote"' 'cccc3333 feat: keep two' ;;`);

function runAnalyze(args, script, gitScript, pathTail) {
  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const gitShim = join(bin, 'git');
    writeFileSync(gitShim, gitScript === undefined ? FAKE_GIT : gitScript);
    chmodSync(gitShim, 0o755);
    const log = join(dir, 'git-calls.log');
    writeFileSync(log, '');
    const target = script === undefined ? scriptPath : join(dir, 'analyze.sh');
    if (script !== undefined) { writeFileSync(target, script); chmodSync(target, 0o755); }
    // **No `encoding` option — stdout comes back as a raw Buffer.** With `encoding: 'utf8'` Node
    // decodes leniently and silently turns malformed bytes into U+FFFD *before* any assertion runs,
    // so a script emitting invalid UTF-8 looks identical to one emitting the replacement character
    // on purpose. Round 18 found that a malformed-byte fixture could pass under the old harness
    // shape for that reason. `stdout` below is the decoded convenience view; `stdoutRaw` is what
    // the script actually wrote, and the UTF-8 assertions use that.
    const res = spawnSync('/bin/bash', [target, ...args], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${pathTail || process.env.PATH}`, GIT_CALL_LOG: log },
    });
    const stdoutRaw = res.stdout || Buffer.alloc(0);
    return {
      calls: parseCallLog(readFileSync(log, 'utf8')),
      status: res.status,
      stdoutRaw,
      stdout: stdoutRaw.toString('utf8'),
      stderr: (res.stderr || Buffer.alloc(0)).toString('utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Framing is self-describing: `<argc>\0<arg>\0<arg>\0…`. No byte is reserved as a record separator,
// so no argument content can forge a boundary — the count says where the next call starts. The
// trailing NUL leaves one empty tail field; every other empty field is a real empty argument.
// The tail of PATH the script sees. Used only by the tool-cascade test, which has to answer
// `command -v perl` differently from this machine's real answer.
function runAnalyzeWithPath(args, gitScript, pathTail) {
  return runAnalyze(args, undefined, gitScript, pathTail);
}

function parseCallLog(raw) {
  const fields = raw.split('\0');
  if (fields[fields.length - 1] === '') fields.pop();
  const calls = [];
  for (let i = 0; i < fields.length;) {
    const argc = Number(fields[i]);
    assert.ok(Number.isInteger(argc) && argc >= 0 && i + argc < fields.length,
      `the call log is malformed at field ${i}: ${JSON.stringify(fields.slice(i, i + 4))}`);
    calls.push(fields.slice(i + 1, i + 1 + argc));
    i += 1 + argc;
  }
  return calls;
}

// The shim resolves the subcommand for itself, purely to pick which canned reply to print. That
// resolution is NOT a verdict and nothing asserts against it — the verdict is `unexpectedCalls`,
// which reads `argv[0]` and needs no agreement with git. Three rounds of trying to keep a JS
// classifier in step with git's dispatch is what this separation ends.

test('the recording harness when self-tested → runs the script and captures every git call', () => {
  // Without this, "no destructive call recorded" is equally consistent with "the script never ran".
  const { calls, stdout } = runAnalyze(['--target', 'origin/main']);
  assert.ok(calls.length >= 4, `the script must actually invoke git; recorded ${calls.length} calls`);
  assert.ok(calls.some((c) => c[0] === 'branch'), 'the first read (branch --show-current) must be recorded');
  assert.ok(calls.some((c) => c[0] === 'log'), 'commit enumeration must be recorded');
  assert.ok(stdout.trim().length > 0, 'the script must produce output, not die silently');
  // And the recorder must be capable of seeing a destructive call at all — assert that against a
  // script that makes one, or "none recorded" is an untested claim.
  const probe = runAnalyze([], '#!/bin/bash\ngit push origin main\ngit rebase --onto a b c\n');
  assert.deepEqual(probe.calls.map((c) => c[0]), ['push', 'rebase'],
    'the harness must record destructive calls when they happen');
  assert.equal(unexpectedCalls(probe.calls).length, 2,
    'and the allow-list must report both of them, or its silence on the real script means nothing');
});

test('the two success paths when run → invoke no destructive git operation (happy paths only)', () => {
  for (const args of [['--target', 'origin/main'], ['--target', 'origin/main', '--base', 'aaaa1111']]) {
    const { calls, stdout } = runAnalyze(args);
    const unexpected = unexpectedCalls(calls);
    assert.deepEqual(unexpected, [],
      `running with ${JSON.stringify(args)} invoked ${JSON.stringify(unexpected)} — this skill outputs `
      + 'the rebase command, it does not run it');
    assert.ok(stdout.includes('rebase_command') || stdout.includes('"status"') || stdout.includes('cherry'),
      `the run must reach its output stage for the absence of destructive calls to mean anything; got: ${stdout.slice(0, 200)}`);
  }
});

// The two cases above are the script's documented invocations, and covering only those leaves the
// six early-exit branches unexecuted — a destructive call on any of them would sit green forever.
// Each row below drives one branch and names the observable that proves the branch was the one
// taken, because "exited non-zero" is equally consistent with dying somewhere else entirely.
const ERROR_BRANCHES = [
  {
    name: 'unknown option',
    args: ['--nonsense'],
    git: undefined,
    exits: (s) => s !== 0,
    reached: ({ stderr }) => /Unknown option/.test(stderr),
  },
  {
    name: '--target given without a value',
    args: ['--target'],
    git: undefined,
    exits: (s) => s !== 0,
    // The distinction is the whole fix: a stated usage error, not bash's own `$2: unbound variable`
    // abort, which tells the caller nothing about which option was wrong.
    reached: ({ stderr }) => /requires a value/.test(stderr) && !/unbound variable/.test(stderr),
  },
  {
    name: '--base given without a value',
    args: ['--target', 'origin/main', '--base'],
    git: undefined,
    exits: (s) => s !== 0,
    reached: ({ stderr }) => /requires a value/.test(stderr) && !/unbound variable/.test(stderr),
  },
  {
    // The joined form is what the separated form's own error message recommends, so it must not
    // be the looser of the two. `--base=$UNSET` reaching auto-detect plans against a different
    // merge-base than the caller asked for, and says nothing.
    name: '--base= (joined form, empty value)',
    args: ['--base='],
    git: undefined,
    exits: (s) => s !== 0,
    reached: ({ stderr }) => /--base= passes an empty one/.test(stderr),
  },
  {
    // The other spelling of the same defect. `[ $# -lt 2 ]` counts arguments and `case "$2" in -*)`
    // reads the first byte; neither notices that the argument supplied is the empty string.
    name: "--base '' (separated form, empty value)",
    args: ['--base', ''],
    git: undefined,
    exits: (s) => s !== 0,
    reached: ({ stderr }) => /an empty one was supplied/.test(stderr),
  },
  {
    name: "--target '' (separated form, empty value)",
    args: ['--target', ''],
    git: undefined,
    exits: (s) => s !== 0,
    reached: ({ stderr }) => /an empty one was supplied/.test(stderr),
  },
  {
    name: '--target= (joined form, empty value)',
    args: ['--target='],
    git: undefined,
    exits: (s) => s !== 0,
    reached: ({ stderr }) => /--target= passes an empty one/.test(stderr),
  },
  {
    name: 'target ref does not exist',
    args: ['--target', 'origin/unknown-branch'],
    git: undefined,
    exits: (s) => s !== 0,
    // It must have asked, and must not have gone on to enumerate commits.
    reached: ({ calls }) => calls.some((c) => c[0] === 'rev-parse') && !calls.some((c) => c[0] === 'log'),
  },
  {
    name: 'no common ancestor with the target',
    args: ['--target', 'origin/main'],
    git: GIT_NO_MERGE_BASE,
    exits: (s) => s !== 0,
    reached: ({ calls }) => calls.some((c) => c[0] === 'merge-base') && !calls.some((c) => c[0] === 'log'),
  },
  {
    name: 'nothing to rebase (TOTAL == 0)',
    args: ['--target', 'origin/main'],
    git: GIT_NO_COMMITS,
    exits: (s) => s === 0, // this branch is a success, and it is still an early exit
    reached: ({ stdout }) => /"status":"up-to-date"/.test(stdout),
  },
  {
    name: '--base cannot be resolved',
    args: ['--target', 'origin/main', '--base', 'unknown-cut'],
    git: undefined,
    exits: (s) => s !== 0,
    // Past commit enumeration (so not the target branch above), stopped before emitting a plan.
    reached: ({ calls, stdout }) => calls.some((c) => c[0] === 'log') && !/rebase_command/.test(stdout),
  },
  {
    name: '--base resolves but is not in the history',
    args: ['--target', 'origin/main', '--base', 'dddd4444'],
    git: undefined,
    exits: (s) => s !== 0,
    reached: ({ stdout }) => /not found in commit history/.test(stdout),
  },
];

test('every early-exit branch when driven → also invokes no destructive git operation', () => {
  for (const branch of ERROR_BRANCHES) {
    const run = runAnalyze(branch.args, undefined, branch.git);
    assert.ok(branch.reached(run),
      `the ${branch.name} branch was not the one taken, so this row samples nothing: `
      + `status=${run.status} calls=${JSON.stringify(run.calls)} stdout=${JSON.stringify(run.stdout.slice(0, 200))}`);
    assert.ok(branch.exits(run.status),
      `the ${branch.name} branch exited ${run.status}, which is not what this branch is documented to do`);
    const destructive = unexpectedCalls(run.calls);
    assert.deepEqual(destructive, [],
      `the ${branch.name} branch invoked ${JSON.stringify(destructive)} — an error path is still a path, `
      + 'and this skill executes nothing on any of them');
  }
});

test('a history enumeration that fails → is an error, never a report of nothing to rebase', () => {
  // The defect this closes returned status 0 and `{"status":"up-to-date"}` when `git log` exited
  // 42. Process substitution does not propagate a producer's exit status through `while read`, so
  // `set -euo pipefail` never saw the failure and the empty array read as an empty history.
  // "Nothing to rebase" and "I could not read the history" are opposite answers.
  const cases = {
    'git log fails while enumerating commits': GIT_LOG_FAILS,
    'git cherry fails during auto-detect': GIT_CHERRY_FAILS,
  };
  for (const [label, git] of Object.entries(cases)) {
    const run = runAnalyze(['--target', 'origin/main'], undefined, git);
    assert.notEqual(run.status, 0, `${label}: a failed producer must not exit 0`);
    assert.doesNotMatch(run.stdout, /"status":\s*"up-to-date"/,
      `${label}: a failed enumeration reported as an empty history is a wrong answer, not an error`);
    assert.match(run.stdout, /"error"/,
      `${label}: the failure must be stated in the output the caller parses`);
  }

  // The negative control: an empty history really is up-to-date, and must stay that way. Without
  // this, the assertions above are satisfied by a script that errors on everything.
  const empty = runAnalyze(['--target', 'origin/main'], undefined, GIT_NO_COMMITS);
  assert.equal(empty.status, 0, 'an empty history is a successful answer, not a failure');
  assert.match(empty.stdout, /"status":"up-to-date"/,
    'a genuinely empty history must still report up-to-date, or the fix traded one wrong answer for another');
});

test('a commit git cherry marked as already upstream → reads already-in-target, not unique', () => {
  // The two producers print different widths (`core.abbrev` vs the full OID), so comparing them
  // needs a prefix test. Truncating the cherry side to a fixed 8 compared 8 characters against 7,
  // which can never hold: `cherry_status` was pinned at `"unique"` for every commit while
  // `cherry_dropped` counted the drop — one report contradicting itself, and the auto-detect advice
  // downstream of it silently inverted.
  const run = runAnalyze(['--target', 'origin/main']);
  assert.equal(run.status, 0, `analyze exited ${run.status}: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  const byHash = Object.fromEntries(parsed.commits.map((c) => [c.hash, c.cherry]));

  assert.equal(byHash.aaaa111, 'already-in-target',
    'git cherry marked this one `-`, so the per-commit list must say so');
  assert.equal(parsed.cherry_dropped, 1,
    'and the count must agree with the list — the defect was the two disagreeing');

  // The negative control. Without it this test passes on a script that hard-codes
  // `already-in-target`, which is the opposite defect and just as wrong.
  assert.equal(byHash.bbbb222, 'unique',
    'git cherry marked this one `+` — a commit that is genuinely not upstream must stay unique');
  assert.equal(byHash.cccc333, 'unique',
    'and a commit git cherry did not mention at all must stay unique');
});

test('git-controlled strings that JSON forbids → come back as parseable JSON', () => {
  // `feat/"x` is a ref name git accepts; a backslash in a commit subject is likewise lawful. Both
  // used to be interpolated raw, so the script emitted text that no JSON parser accepts and the
  // caller reasoned from a half-read plan.
  for (const args of [['--target', 'origin/main'], ['--target', 'origin/main', '--base', 'aaaa1111']]) {
    const run = runAnalyze(args, undefined, GIT_HOSTILE_STRINGS);
    assert.equal(run.status, 0, `${JSON.stringify(args)} exited ${run.status}: ${run.stderr}`);
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(run.stdout); },
      `${JSON.stringify(args)} produced output no JSON parser accepts:\n${run.stdout}`);
    // And the escaping must round-trip, not merely produce *some* valid JSON by dropping the
    // characters that were hard.
    assert.equal(parsed.current_branch, 'feat/"x',
      'the branch name must survive escaping intact, not be sanitized into a different name');
    // The backslash half, which the old `sed 's/"/\\"/g'` did not touch at all: it escaped quotes
    // and left `` to open an invalid JSON escape. Quotes alone would pass the parse above.
    const subjects = (parsed.commits || parsed.keep || []).concat(parsed.drop || []).map((c) => c.message);
    assert.ok(subjects.some((m) => m === 'feat: back\\slash and "quote"'),
      `the backslash-bearing subject must round-trip exactly; got ${JSON.stringify(subjects)}`);
  }
});

test('printing a command is not invoking it — the case the deleted scanner got wrong', () => {
  const { calls } = runAnalyze([], '#!/bin/bash\necho git rebase --onto main base branch\necho "git push --force"\n');
  assert.deepEqual(calls, [],
    'a script that only echoes command text invokes nothing, and must not be reported as if it did');
});

test('a call hidden behind git global options → is reported by the allow-list', () => {
  // The hole round 16 found: `$1` was read as the subcommand, so `-C` sent the shim to its default
  // success branch and the old classifier reported the call as `.`. Every form here is a real
  // invocation git accepts, and each hides the subcommand behind a different global-option shape.
  // Under an allow-list none of them has to be *recognised* — `argv[0]` is a global option, which
  // is not one of the five, and that is the whole finding.
  const forms = {
    '-C with a separate path': 'git -C . rebase --onto main base branch',
    '-c with a separate config assignment': 'git -c user.name=x push origin main',
    '--git-dir with a separate path': 'git --git-dir .git reset --hard HEAD',
    '--work-tree= in its joined form': 'git --work-tree=. stash',
    'a valueless global flag': 'git --no-pager commit -m x',
    'several globals stacked': 'git -c a=b -C . --no-pager add .',
    // The four forms round 19 measured against real git, where a deny-list disagreed with git in
    // both directions. None of them needs a verdict here; none is on the allow-list.
    'an alias shadowing a built-in': "git -c alias.status='!printf PWN' status",
    'an alias whose value is quoted': 'git -c \'alias.probe="status"\' probe',
    'an alias defined through the environment': 'git --config-env=alias.probe=V probe',
    'a version query with a subcommand-shaped argument': 'git --version rebase',
  };
  for (const [label, cmd] of Object.entries(forms)) {
    const { calls } = runAnalyze([], `#!/bin/bash\n${cmd}\n`);
    assert.equal(calls.length, 1, `the probe must invoke git exactly once: ${label}`);
    assert.deepEqual(unexpectedCalls(calls), calls,
      `a call the script may not make went unreported behind ${label}`);
  }
});

test('a destructive call wearing a permitted subcommand → is reported by the allow-list', () => {
  // Round 20's finding against the first draft, which read `argv[0]` and nothing else. Every form
  // here has an `argv[0]` that IS on the allow-list, and every one of them writes to the repository.
  // The first two are the reviewer's; the rest are the same hole in other spellings.
  const forms = {
    'a branch deletion sharing argv[0] with --show-current': 'git branch -D main',
    'a force refspec sharing argv[0] with the target refresh': "git fetch origin '+main:refs/heads/main'",
    'a non-forcing refspec, which still writes a local ref': 'git fetch origin main:refs/heads/main --quiet',
    'a branch move': 'git branch -M main',
    'a fetch that names a program for git to run': 'git fetch --upload-pack=id origin main',
    'a prune that deletes remote-tracking refs': 'git fetch --prune origin',
    // Round 21's red direction, and the one a union of permitted tokens could not catch: every
    // token here was independently on the round-20 list, and together they create a branch.
    'a branch creation built only from permitted tokens': 'git branch --quiet victim HEAD',
    // Round 22: `^` starts a negative refspec and slipped through the "no colon, no plus" slot.
    'a negative refspec in the fetch slot': "git fetch --refmap= --no-tags --no-recurse-submodules origin '^main' --quiet",
    // Round 23: `(.+)` matched a wildcard, so one refresh could become a namespace-wide one.
    'a wildcard refspec covering every branch':
      "git fetch --refmap= --no-tags --no-recurse-submodules origin '+refs/heads/*:refs/remotes/origin/*' --quiet",
    'a fetch with tag following left on':
      'git fetch --refmap= origin +refs/heads/main:refs/remotes/origin/main --quiet',
    // **Production-shaped on purpose.** This entry used to be spelled with the pre-`--` argv order
    // and `--quiet` last, so `FETCH_CALL` rejected it on shape long before it looked at the
    // destination — it passed while testing nothing, which is the shape of a control that has quietly
    // stopped guarding its class. Written the way the script writes it, what it exercises is the one
    // destination relationship the predicate can decide from argv alone: the write must land under
    // the remote this very argv names.
    'a refspec whose destination leaves the remote this call names':
      'git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- origin +refs/heads/main:refs/remotes/upstream/main',
    'a refspec pointing outside the remote-tracking namespace':
      'git fetch --refmap= --no-tags --no-recurse-submodules origin +refs/heads/main:refs/heads/main --quiet',
  };
  for (const [label, cmd] of Object.entries(forms)) {
    const { calls } = runAnalyze([], `#!/bin/bash\n${cmd} 2>/dev/null || true\n`);
    assert.equal(calls.length, 1, `the probe must invoke git exactly once: ${label}`);
    assert.deepEqual(unexpectedCalls(calls), calls,
      `a write went unreported because its tokens were individually permitted: ${label}`);
  }
});

test('a fetch onto a sibling of the ref the caller named → the shape gate permits it, the per-case equality catches it', () => {
  // **Where the allow-list stops, stated rather than assumed.** `FETCH_CALL` bounds the destination
  // under the remote the same argv names and goes no further, because from argv alone there is no
  // way to know which branch was asked for: round 24 measured that demanding
  // `source == destination tail` reports the *correct* fetch as unauthorized the moment a
  // non-identity `remote.<name>.fetch` is configured. So a sibling write satisfies the predicate,
  // and pretending otherwise is how the old control passed while guarding nothing.
  const sibling = ['fetch', '--refmap=', '--no-tags', '--no-recurse-submodules', '--quiet', '--',
    'origin', '+refs/heads/main:refs/remotes/origin/victim'];
  assert.equal(FETCH_CALL(sibling), true,
    'the shape gate permits a sibling destination by design — the identity is a per-case property');

  // Which is why the property is carried by the per-case equality instead, and this is the control
  // proving that equality has teeth: the real script writes the ref the caller named, and a mutant
  // that writes a sibling is caught by the same assertion the per-case tests make.
  const real = runAnalyze(['--target', 'origin/main']);
  const realFetch = real.calls.find((c) => c[0] === 'fetch');
  assert.ok(realFetch, `the target must be refreshed: ${JSON.stringify(real.calls)}`);
  assert.equal(realFetch[7], '+refs/heads/main:refs/remotes/origin/main',
    `the destination must be the ref the caller named: ${JSON.stringify(realFetch)}`);

  const source = readFileSync(scriptPath, 'utf8');
  const mutated = source.replace('_refspec="+$TARGET_SRC:refs/remotes/$REMOTE/$TARGET_BRANCH"',
    '_refspec="+$TARGET_SRC:refs/remotes/$REMOTE/victim"');
  assert.notEqual(mutated, source, 'the mutation must actually redirect the destination');
  const mutant = runAnalyze(['--target', 'origin/main'], mutated);
  const mutantFetch = mutant.calls.find((c) => c[0] === 'fetch');
  assert.ok(mutantFetch, `the mutant must still fetch, or it proves nothing: ${JSON.stringify(mutant.calls)}`);
  assert.notEqual(mutantFetch[7], '+refs/heads/main:refs/remotes/origin/main',
    'the mutant must fail the equality above — otherwise that assertion guards nothing');
  assert.deepEqual(unexpectedCalls(mutant.calls), [],
    'and the shape gate stays silent on it, which is exactly why the equality is needed');
});

test('a legitimate read carrying refspec-shaped syntax → is not reported', () => {
  // Round 21's green direction. `--base` is deliberately left open to revision expressions because
  // it reaches only `git rev-parse`, which writes nothing — so `:/.` (search commits by message) and
  // `HEAD:path` are supported inputs, and a colon rule applied to every argument reported them. The
  // refspec constraint belongs on `git fetch`'s source slot, which is the only argument in this
  // script that reaches code that writes.
  const reads = {
    'a rev-parse commit-message search': 'git rev-parse --short :/.',
    'a rev-parse path-in-tree lookup': 'git rev-parse HEAD:README.md',
    'the ref check rejecting a colon-bearing target': 'git check-ref-format --allow-onelevel main:dst',
  };
  for (const [label, cmd] of Object.entries(reads)) {
    const { calls } = runAnalyze([], `#!/bin/bash\n${cmd} >/dev/null 2>&1 || true\n`);
    assert.equal(calls.length, 1, `the probe must invoke git exactly once: ${label}`);
    assert.deepEqual(unexpectedCalls(calls), [],
      `a read the script legitimately makes was reported as a write: ${label}`);
  }
});

test('the allow-list when every call site shape is exercised → stays silent', () => {
  // The negative control, without which the test above passes on a list that rejects everything.
  // One entry per template, spelled the way the script spells it — so a template that drifts away
  // from its call site fails here rather than silently permitting a shape nobody makes.
  const permitted = [
    'git branch --show-current',
    'git check-ref-format --allow-onelevel origin/main',
    'git rev-parse --verify --end-of-options origin/main',
    'git rev-parse --verify --short --end-of-options aaaa1111',
    'git rev-parse --short aaaa1111',
    'git rev-parse aaaa1111',
    'git merge-base HEAD origin/main',
    'git log --oneline --reverse aaaa..HEAD',
    'git log --oneline aaaa..origin/main',
    'git cherry -v origin/main HEAD',
    'git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- origin +refs/heads/main:refs/remotes/origin/main',
    'git rev-parse --verify --symbolic-full-name --end-of-options origin/main',
    'git remote',
  ];
  const { calls } = runAnalyze([], `#!/bin/bash\n${permitted.join('\n')}\n`);
  assert.equal(calls.length, permitted.length, 'every probe call must have been recorded');
  assert.deepEqual(unexpectedCalls(calls), [],
    'the allow-list rejected a read the script is supposed to make — it would fail on every run');
});

test('every call template → is exercised by a real run of the script', () => {
  // A template nobody uses is a permission nobody needs, and it is the cheapest way to widen this
  // list without appearing to: add a shape, and the finding it silenced goes quiet. Both documented
  // modes are driven, and every template must be matched by at least one recorded call — so a
  // template can only survive here by describing something the script genuinely does.
  const calls = [
    ...runAnalyze(['--target', 'origin/main']).calls,
    ...runAnalyze(['--target', 'origin/main', '--base', 'aaaa1111']).calls,
    // The `config --get` read only happens on the branch where the target does not resolve, so
    // without this third run that template would sit here permitting a shape nothing drives.
    ...runAnalyze(['--target', 'origin/unfetched']).calls,
  ];
  const dead = CALL_TEMPLATES.filter((t) => !calls.some((argv) => matchesTemplate(argv, t)));
  assert.deepEqual(dead, [],
    `these templates match no call the script makes, so they permit shapes for no reason: ${JSON.stringify(dead)}`);
});

test('the recorder when an argument contains a space → keeps the argument boundary', () => {
  // `"$*"` used to flatten argv into words. A commit subject with a space then read as two
  // arguments, and any reader over that text is reasoning about a command nobody ran.
  const { calls } = runAnalyze([], '#!/bin/bash\ngit commit -m "feat: two words"\n');
  assert.deepEqual(calls[0], ['commit', '-m', 'feat: two words'],
    'argument boundaries must survive the recording, or the reader sees a different command');
});

test('the recorder when an argument contains the old delimiter → keeps the argument boundary', () => {
  // Round 17: TAB was the delimiter, and a tab is a legal argv byte. `-c 'x.y=<TAB>bar' rebase`
  // decoded as four fields instead of three. NUL is the byte execve cannot carry, and the `$#`
  // prefix frames the record, so no argument content can move a boundary.
  const { calls } = runAnalyze([], '#!/bin/bash\ngit -c \'x.y=\tbar\' rebase --onto a b c\n');
  assert.deepEqual(calls[0], ['-c', 'x.y=\tbar', 'rebase', '--onto', 'a', 'b', 'c'],
    'a tab inside an argument must stay inside it');
  assert.deepEqual(unexpectedCalls(calls), calls, 'and the call must still be reported');
});

test('the script when it does run a rebase → is reported, whatever the source looks like', () => {
  // Obfuscation defeats a lexical scan and cannot defeat execution: the shell resolves it to `git`
  // before the recorder sees it.
  const { calls } = runAnalyze([], '#!/bin/bash\nc=re; d=base\ngit "$c$d" --onto a b c\n');
  assert.deepEqual(calls[0], ['rebase', '--onto', 'a', 'b', 'c'],
    'a rebase assembled at runtime is still a rebase, and execution sees through the spelling');
  assert.deepEqual(unexpectedCalls(calls), calls, 'and it must be reported as a call not allowed here');
});

// ── 3. Portability regression (found by section 2, 2026-08-16) ────────────────
// Two Bash 4+ constructs sat under a `#!/bin/bash` shebang, which on macOS is Bash 3.2:
//   `mapfile -t COMMITS < <(git log …)`  → `command not found` on discarded stderr, array stays
//                                          EMPTY, and the script reports `{"status":"up-to-date"}`
//                                          — a wrong answer, not a failure
//   `${DROP[-1]}`                        → `bad array subscript`; under `set -u` it aborted the
//                                          whole `--base` mode, the one that produces the command
// Neither is visible to a reader and neither breaks on the maintainer's Bash 5. Running the
// script under the interpreter its shebang names finds them — on a host where /bin/bash IS
// Bash 3.2. On Linux CI /bin/bash is Bash 5, both constructs run correctly there, and the
// execution-based half of this section proves nothing (measured 2026-08-24: the reintroduction
// mutants completed with correct output and the run stayed green). So the detection is two
// halves: execution below for the 3.2 host, and the lexical scan `bash4Constructs` in the
// mutant test for every host — which is why these assertions still live next to the harness
// rather than in a linter, but no longer rely on the harness alone.

test('the analysis script under the Bash its shebang names → completes both modes with real output', () => {
  const shebang = readFileSync(scriptPath, 'utf8').split('\n')[0];
  assert.equal(shebang, '#!/bin/bash',
    'these assertions run the script under /bin/bash because that is what the shebang selects; '
    + 'if the shebang changes, change the interpreter here in the same commit');

  const auto = runAnalyze(['--target', 'origin/main']);
  assert.equal(auto.status, 0, `auto-detect mode exited ${auto.status}: ${auto.stderr}`);
  assert.match(auto.stdout, /"total_commits": 3/,
    'the commit array must be populated — an empty one is how the mapfile failure reported '
    + '"nothing to rebase" instead of failing');
  assert.doesNotMatch(auto.stdout, /"status":\s*"up-to-date"/,
    'three commits were supplied, so "up-to-date" here means the array silently came back empty');

  const based = runAnalyze(['--target', 'origin/main', '--base', 'aaaa1111']);
  assert.equal(based.status, 0, `--base mode exited ${based.status}: ${based.stderr}`);
  // `aaaa111`, not the `aaaa1111` that was typed: the command names what `rev-parse --short`
  // resolved. The two were the same string until the shim's abbreviation width was corrected to
  // git's 7, which is why nothing here could tell resolved from typed before.
  assert.match(based.stdout, /"rebase_command": "git rebase --onto 'origin\/main' 'aaaa111' -- 'feat\/example'"/,
    '--base mode must reach the cut-point line and emit the command; the negative subscript aborted here');
  assert.equal(based.stderr.trim(), '',
    `--base mode must run clean under Bash 3.2; got: ${based.stderr}`);
});

// A Bash 4-only construct in a non-comment line, found lexically. Execution alone cannot carry
// this detection everywhere — /bin/bash is 3.2 on macOS but 5.x on Linux CI, where `mapfile` and
// negative subscripts run fine and a reintroduced construct completes with correct output.
// Comment-only lines are skipped because the script documents both constructs by name (as the
// things it must not contain) while carrying neither as code.
function bash4Constructs(src) {
  const hits = [];
  for (const line of src.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    if (/\bmapfile\b|\breadarray\b/.test(line)) hits.push(`bash4 builtin: ${line.trim()}`);
    // `\s*` because whitespace is legal in an arithmetic subscript: `${DROP[ -1 ]}` is the same
    // Bash 4-only construct as `${DROP[-1]}` (measured: bash 5.3 returns the element, bash 3.2
    // raises `bad array subscript`), and anchoring `-` directly to `[` would wave it through.
    if (/\$\{[A-Za-z_][A-Za-z0-9_]*\[\s*-/.test(line)) hits.push(`negative subscript: ${line.trim()}`);
  }
  return hits;
}

test('the portability check when a Bash 4 construct is reintroduced → the run turns red', () => {
  // Both directions in one place: the constructs that broke it, and the portable forms that must
  // keep passing. Without the second half this test is green on the day it lands and cannot say
  // whether it still detects anything.
  const source = readFileSync(scriptPath, 'utf8');

  // The standing guard, and on a Bash 5 host the only line here that turns red on a real
  // reintroduction: the execution checks below discriminate nothing where the constructs work.
  assert.deepEqual(bash4Constructs(source), [],
    'the shipped script must carry no Bash 4-only construct outside comment lines');

  const regressions = {
    // Replaces the guarded read of the commit list with the Bash 4 builtin, exactly as it was
    // written before. `read_lines_or_die` also disappears from this path, which is the point: the
    // producer-failure guard and the portable read are the same line.
    'mapfile reintroduced': source.replace(
      /read_lines_or_die "git log \(\$MERGE_BASE\.\.HEAD\)" git log --oneline --reverse "\$MERGE_BASE\.\.HEAD"/,
      'mapfile -t READ_LINES < <(git log --oneline --reverse "$MERGE_BASE..HEAD" 2>/dev/null)'),
    'negative subscript reintroduced': source.replace(
      '${DROP[$((${#DROP[@]} - 1))]}', '${DROP[-1]}'),
  };
  for (const [label, mutated] of Object.entries(regressions)) {
    assert.notEqual(mutated, source, `the fixture must actually differ from the script: ${label}`);
    const auto = runAnalyze(['--target', 'origin/main'], mutated);
    const based = runAnalyze(['--target', 'origin/main', '--base', 'aaaa1111'], mutated);
    // Lexical OR behavioural: the scan catches the construct on every host; the runtime half
    // additionally proves the breakage where /bin/bash is 3.2 (measured 2026-08-24 — on Linux CI
    // the runtime half alone read every mutant as healthy).
    const broke = bash4Constructs(mutated).length > 0
      || auto.status !== 0 || based.status !== 0
      || /"status":\s*"up-to-date"/.test(auto.stdout)
      || !/"rebase_command"/.test(based.stdout);
    assert.ok(broke, `a Bash 4-only construct went undetected: ${label}`);
  }

  // The passing direction: the portable forms currently in the file run clean, so the check above
  // is discriminating between constructs rather than failing on everything handed to it.
  const control = runAnalyze(['--target', 'origin/main', '--base', 'aaaa1111'], source);
  assert.equal(control.status, 0, 'the unmodified script must pass the same check it applies');
  assert.match(control.stdout, /"rebase_command"/, 'the control run must reach the output stage');
});

// ── 3. The advertised command is executed by a human, so it must be shell-safe ─
// JSON-escaping and shell-quoting solve different problems, and `rebase_command` needs both: the
// skill advertises it as ready to copy-paste, and `git check-ref-format` accepts a branch named
// `feat/x;printf${IFS}PWN` — every byte of which is JSON-innocent. The field parsed cleanly and
// then ran a second command when pasted. Asserting on the string's shape would only restate the
// implementation; the assertion that means something is to run it.

function execCommandString(cmd) {
  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-exec-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // A `git` that does nothing but record the argv it was handed. If the pasted string spawns a
    // second command, that command is NOT this shim, and the marker it prints lands in stdout.
    writeFileSync(join(bin, 'git'), '#!/bin/bash\nprintf \'%s\\0\' "$#" "$@" >> "$GIT_CALL_LOG"\nexit 0\n');
    chmodSync(join(bin, 'git'), 0o755);
    const log = join(dir, 'git-calls.log');
    writeFileSync(log, '');
    const res = spawnSync('/bin/bash', ['-c', cmd], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_CALL_LOG: log },
      encoding: 'utf8',
    });
    return { calls: parseCallLog(readFileSync(log, 'utf8')), stdout: res.stdout || '', status: res.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the harness that executes a command string → self-test', () => {
  // Without this, "no injected command ran" is equally consistent with "nothing ran at all".
  const probe = execCommandString('git rebase --onto a b c; printf PWN');
  assert.deepEqual(probe.calls.map((c) => c[0]), ['rebase'], 'the executor must record git calls');
  assert.match(probe.stdout, /PWN/, 'the executor must surface output from an injected command');
});

test('a branch name carrying shell metacharacters → cannot inject into the pasted command', () => {
  const HOSTILE_REF = FAKE_GIT.replace(/^ {2}branch\).*$/m,
    `  branch)     printf '%s\\n' 'feat/x;printf\${IFS}PWN' ;;`);
  const run = runAnalyze(['--target', 'origin/main', '--base', 'aaaa1111'], undefined, HOSTILE_REF);
  assert.equal(run.status, 0, `--base mode exited ${run.status}: ${run.stderr}`);

  const plan = JSON.parse(run.stdout);
  assert.equal(plan.current_branch, 'feat/x;printf${IFS}PWN',
    'precondition: the hostile ref name must reach the plan intact, or this proves nothing');

  const exec = execCommandString(plan.rebase_command);
  assert.doesNotMatch(exec.stdout, /PWN/,
    'the advertised command spawned a second command when pasted — the ref name was not shell-quoted');
  assert.deepEqual(exec.calls.map((c) => c[0]), ['rebase'],
    'exactly one git invocation must result from pasting the command');
  assert.deepEqual(exec.calls[0], ['rebase', '--onto', 'origin/main', 'aaaa111', '--', 'feat/x;printf${IFS}PWN'],
    'the quoting must deliver the ref name to git verbatim, past the -- separator, not merely defuse it');
});

test('an option-shaped current branch → the emitted rebase command stops git reading it as an option', () => {
  // Shell quoting is not git's option parser. A branch legitimately named `--exec=touch${IFS}PWNED`
  // (git update-ref and fetch create it, even though `git branch` refuses the spelling) is
  // shell-quoted correctly and STILL reaches `git rebase` as its `--exec` option. Measured against
  // real git: `git rebase --onto main <base> '--exec=touch PWNED'` ran the payload; the same line
  // with `--` before the operand did not. And the obvious alternative — spelling it
  // `refs/heads/<branch>` — is wrong here: measured, a fully-qualified branch operand rebases onto a
  // DETACHED HEAD and never moves the branch, so `--` is the only fix that also preserves behaviour.
  const OPT_REF = FAKE_GIT.replace(/^ {2}branch\).*$/m,
    `  branch)     printf '%s\\n' '--exec=touch\${IFS}PWNED' ;;`);
  const run = runAnalyze(['--target', 'origin/main', '--base', 'aaaa1111'], undefined, OPT_REF);
  assert.equal(run.status, 0, `--base mode exited ${run.status}: ${run.stderr}`);
  const plan = JSON.parse(run.stdout);
  assert.equal(plan.current_branch, '--exec=touch${IFS}PWNED',
    'precondition: the option-shaped ref must reach the plan intact, or this proves nothing');
  const exec = execCommandString(plan.rebase_command);
  // The structural guarantee the FAKE shim can assert: `--` sits immediately before the operand, so
  // git's own parser (which the shim does not model) reads it as a branch, never as `--exec`.
  const argv = exec.calls[0];
  const sep = argv.indexOf('--');
  assert.notEqual(sep, -1, 'the emitted command must carry a -- separator');
  assert.equal(argv[sep + 1], '--exec=touch${IFS}PWNED',
    'the option-shaped branch must sit immediately after --, where git cannot read it as an option');
  assert.equal(argv[argv.length - 1], '--exec=touch${IFS}PWNED',
    'and it must be the final operand — nothing may follow it back out of the separated region');
  // Negative control: the pre-fix emit had no separator, so the operand was argv-adjacent to the
  // options and git would dispatch it. Rebuilding that shape must fail the check above.
  const preFix = plan.rebase_command.replace(" -- '", " '");
  const badArgv = execCommandString(preFix).calls[0];
  assert.equal(badArgv.indexOf('--'), -1,
    'the negative control must reproduce the vulnerable separator-less shape');
});

test('a commit subject containing invalid UTF-8 → the plan is still a decodable JSON document', () => {
  // Git accepts a commit whose message is not valid UTF-8; round 18 built one carrying a raw 0xff.
  // The escaping preserved that byte, so the script's own claim — everything on stdout is JSON —
  // was false for exactly the input an attacker influences. Asserted on the RAW bytes: a lenient
  // decoder substitutes U+FFFD itself and would report this as fixed while it was not.
  const BAD_UTF8 = FAKE_GIT.replace(/^ {2}log\).*$/m,
    `  log)        printf 'aaaa1111 feat: base work\\nbbbb2222 feat: caf\\xc3\\xa9 \\xff and more\\ncccc3333 feat: keep two\\n' ;;`);
  const run = runAnalyze(['--target', 'origin/main'], undefined, BAD_UTF8);
  assert.equal(run.status, 0, `auto-detect mode exited ${run.status}: ${run.stderr}`);

  assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(run.stdoutRaw),
    'stdout is not decodable UTF-8, so it is not a JSON document whatever it looks like');
  const plan = JSON.parse(run.stdout);
  const subjects = plan.commits.map((c) => c.message);
  assert.ok(subjects.some((m) => m === 'feat: café � and more'),
    `the malformed byte must become U+FFFD while the valid é survives; got ${JSON.stringify(subjects)}`);
  assert.ok(subjects.some((m) => m === 'feat: keep two'),
    'the neighbouring subjects must be unaffected');
});

test('a ref name that is not valid UTF-8 → fails closed instead of naming a different branch', () => {
  // Round 19: `git check-ref-format` accepts a branch carrying a raw 0xff. `sh_quote` preserved the
  // byte and `json_escape` then replaced it with U+FFFD, so the advertised command named a ref that
  // is not the one analysed — it either fails, or rebases a different branch that happens to exist
  // under the substituted name. Substitution is right for a subject, which is read; wrong for a
  // ref, which is resolved. Only `--base` mode builds a command, so only it fails closed.
  const BAD_REF = FAKE_GIT.replace(/^ {2}branch\).*$/m, `  branch)     printf 'feat/\\xff\\n' ;;`);
  const run = runAnalyze(['--target', 'origin/main', '--base', 'aaaa1111'], undefined, BAD_REF);
  assert.equal(run.status, 1, `the run must fail rather than emit a command; got ${run.status}`);
  assert.doesNotMatch(run.stdout, /rebase_command/,
    'no command may be emitted for a ref that cannot survive the document intact');
  const err = JSON.parse(run.stdout || run.stderr);
  assert.match(err.error, /not valid UTF-8/, 'the error must say what is wrong with which ref');
  assert.match(err.error, /branch/, 'and which of the three refs it was');

  // The negative control: an ordinary ref still produces a plan. Without this the assertion above
  // is satisfied by a script that refuses everything.
  const ok = runAnalyze(['--target', 'origin/main', '--base', 'aaaa1111']);
  assert.equal(ok.status, 0, 'a valid ref must still produce a plan');
  assert.match(ok.stdout, /rebase_command/, 'and that plan must still carry the command');
});

test('the UTF-8 validity check on each tool branch → agrees on all three', () => {
  // The cascade has three branches and a machine takes exactly one of them. If they disagree, the
  // fail-closed guarantee holds on the maintainer's laptop and not in CI. Each branch is forced by
  // handing the script a PATH where the tools above it do not exist.
  const BAD_REF = FAKE_GIT.replace(/^ {2}branch\).*$/m, `  branch)     printf 'feat/\\xff\\n' ;;`);
  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-tools-'));
  try {
    // A minimal PATH holding only what the script genuinely needs, so `command -v perl` / `iconv`
    // answer from what is linked here rather than from the real system.
    const base = join(dir, 'base');
    mkdirSync(base);
    for (const tool of ['sed', 'cut', 'awk', 'grep', 'cat', 'printf', 'tr', 'git']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool} || true`], { encoding: 'utf8' }).stdout.trim();
      if (found) writeFileSync(join(base, tool), `#!/bin/sh\nexec ${found} "$@"\n`), chmodSync(join(base, tool), 0o755);
    }
    const branches = {
      perl: ['perl', 'iconv'],
      iconv: ['iconv'],
      none: [],
    };
    for (const [label, tools] of Object.entries(branches)) {
      const bin = join(dir, `bin-${label}`);
      mkdirSync(bin);
      for (const tool of tools) {
        const found = spawnSync('/bin/sh', ['-c', `command -v ${tool} || true`], { encoding: 'utf8' }).stdout.trim();
        assert.ok(found, `precondition: ${tool} must exist on this machine to exercise the ${label} branch`);
        writeFileSync(join(bin, tool), `#!/bin/sh\nexec ${found} "$@"\n`);
        chmodSync(join(bin, tool), 0o755);
      }
      const run = runAnalyzeWithPath(['--target', 'origin/main', '--base', 'aaaa1111'], BAD_REF, `${bin}:${base}`);
      assert.equal(run.status, 1, `the ${label} branch must fail closed on a malformed ref; got ${run.status}: ${run.stderr}`);
      assert.match(run.stdout || run.stderr, /not valid UTF-8/, `the ${label} branch must report the same reason`);

      // **The refusal direction alone is green on a branch that refuses everything.** Round 20:
      // make the `iconv` or `none` predicate reject all input and the fixture above still passes,
      // while that tool branch would refuse every valid explicit-base plan on a real machine. The
      // control below is the same run with an ordinary ASCII ref, per branch — the host-selected
      // branch being exercised elsewhere says nothing about the two the host did not pick.
      const okAscii = runAnalyzeWithPath(['--target', 'origin/main', '--base', 'aaaa1111'], undefined, `${bin}:${base}`);
      assert.equal(okAscii.status, 0, `the ${label} branch must still accept an ASCII ref; got ${okAscii.status}: ${okAscii.stderr}`);
      assert.match(okAscii.stdout, /rebase_command/, `and the ${label} branch must still emit the command`);
    }

    // Valid multibyte splits the three, and the split is the documented design rather than a defect:
    // `perl` and `iconv` can both confirm well-formed UTF-8, while the tool-less branch answers
    // "cannot verify" for any high byte and fails closed. Asserted in both directions so that
    // degradation stays a decision someone made, not a regression nobody notices.
    const UTF8_REF = FAKE_GIT.replace(/^ {2}branch\).*$/m, `  branch)     printf 'feat/caf\\xc3\\xa9\\n' ;;`);
    for (const [label, accepts] of Object.entries({ perl: true, iconv: true, none: false })) {
      const run = runAnalyzeWithPath(['--target', 'origin/main', '--base', 'aaaa1111'], UTF8_REF,
        `${join(dir, `bin-${label}`)}:${base}`);
      if (accepts) {
        assert.equal(run.status, 0, `the ${label} branch must accept well-formed multibyte; got ${run.status}: ${run.stderr}`);
        assert.match(run.stdout, /rebase_command/, `and ${label} must emit the command for it`);
      } else {
        assert.equal(run.status, 1, 'the tool-less branch must fail closed on any high byte, by design');
        assert.match(run.stdout || run.stderr, /not valid UTF-8/, 'and say so in the same words');
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 5. `--target` is an argument to `git fetch`, and `git fetch` writes (round 20) ────────────
test('a --target shaped as a force refspec → is refused, and the local branch does not move', () => {
  // `--target` was stripped of a leading `origin/` and handed straight to `git fetch origin <value>`.
  // A refspec is not a branch name: `+HEAD:refs/heads/victim` instructs git to force-overwrite the
  // local `victim`, and it happened during *analysis*, which this skill advertises as a read.
  //
  // Asserted against a real repository and the real git, not the recording shim. The claim is about
  // what git does with the argument, and a shim can only answer what it was told to answer. The
  // observable is the branch tip: it either moved or it did not.
  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-refspec-'));
  const git = (...args) => spawnSync(REAL_GIT, ['-C', dir, ...args], { encoding: 'utf8' });
  const run = (script, target) => spawnSync('/bin/bash', [script, '--target', target],
    { cwd: dir, encoding: 'utf8' });
  try {
    assert.ok(REAL_GIT, 'precondition: a real git is needed to prove what git does with a refspec');
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'commit.gpgSign', 'false');
    git('config', 'user.name', 'Test');
    git('commit', '-q', '--allow-empty', '-m', 'base');
    git('branch', 'victim');
    git('commit', '-q', '--allow-empty', '-m', 'second');
    // `origin` must exist, or the fetch fails for a reason that has nothing to do with the payload
    // and the test would pass on a script with no validation at all.
    git('remote', 'add', 'origin', '.');
    const before = git('rev-parse', 'victim').stdout.trim();
    const head = git('rev-parse', 'HEAD').stdout.trim();
    assert.notEqual(before, head, 'precondition: victim must start off HEAD, or a move is invisible');

    const PAYLOAD = 'origin/+HEAD:refs/heads/victim';
    const refused = run(scriptPath, PAYLOAD);
    assert.equal(refused.status, 1, `the run must refuse the payload; got ${refused.status}`);
    assert.match(refused.stdout || refused.stderr, /check-ref-format/,
      'and say which check rejected it, so the refusal is diagnosable');
    assert.equal(git('rev-parse', 'victim').stdout.trim(), before,
      'the local branch moved — analysis wrote to the repository');

    // **Two independent mechanisms now stop this payload, and the controls below separate them.**
    // Round 22 added a fully-qualified constructed refspec for a different reason (the destination
    // was chosen by `remote.origin.fetch`, not by the argument), and it happens to neutralise
    // refspec injection as well: the payload lands inside `refs/heads/<payload>` rather than being
    // parsed as a refspec. Asserting only "delete the validation and it moves" would now fail for a
    // reason that looks like the defect being absent.
    const source = readFileSync(scriptPath, 'utf8');
    const mutant = join(dir, 'unguarded.sh');
    // **Disabling validation by neutering the checker, not by deleting a block.** Round 24 split the
    // check in two — the raw `--target` before classification, the constructed refs after it — so a
    // regex over one block leaves the other standing and the control silently tests nothing.
    // Replacing the call itself disables every site there is, present and future.
    const CONSTRUCTED = 'git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- "$REMOTE" "$_refspec"';
    const OLD_FETCH = 'git fetch origin "$TARGET_BRANCH" --quiet';

    // (a) validation removed, constructed refspec kept — the second layer must hold on its own.
    const noValidation = source.replaceAll('git check-ref-format --allow-onelevel', 'true');
    assert.notEqual(noValidation, source, 'the mutation must actually remove the validation loop');
    writeFileSync(mutant, noValidation);
    run(mutant, PAYLOAD);
    assert.equal(git('rev-parse', 'victim').stdout.trim(), before,
      'with the validation gone the constructed refspec must still contain the payload — the two '
      + 'defences are supposed to be independent, not one defence counted twice');

    // (b) validation and the constructed refspec both removed — and it *still* holds, because a
    // third mechanism arrived later for a third reason: the payload's `:` makes the refspec that
    // covers this path uninvertible (§ 1.4), and an uninvertible mapping is refused rather than
    // guessed. Three independent layers, so the control below has to remove all three or it proves
    // the absence of the wrong one.
    const noConstructed = noValidation.replace(CONSTRUCTED, OLD_FETCH);
    assert.notEqual(noConstructed, noValidation, 'the mutation must actually restore the old fetch line');
    writeFileSync(mutant, noConstructed);
    run(mutant, PAYLOAD);
    assert.equal(git('rev-parse', 'victim').stdout.trim(), before,
      'the uninvertible-source refusal must hold on its own — three defences, not one counted thrice');

    // (c) all three removed — the original defect, which must still be demonstrable. Without this
    // the refusal above is equally satisfied by a payload git would have ignored anyway
    // (@rules/testing.md § Guards).
    const original = noConstructed.replace('if [ "$TARGET_SRC" = "$UNINVERTIBLE" ]; then', 'if false; then');
    assert.notEqual(original, noConstructed, 'the mutation must actually disable the source guard');
    writeFileSync(mutant, original);
    run(mutant, PAYLOAD);
    assert.equal(git('rev-parse', 'victim').stdout.trim(), head,
      'the payload must be genuinely dangerous against the pre-fix script, or none of the three '
      + 'is protecting against anything');
    git('update-ref', 'refs/heads/victim', before);

    // **A branch literally named `+main` is a legal ref, and refusing it was the wrong half of the
    // round-21 fix.** A bare `+main` handed to `git fetch` reads as the force modifier plus `main`;
    // the fully-qualified `refs/heads/+main` the script now builds is unambiguous, so the ambiguity
    // is gone and with it the reason to refuse. Measured round 22 against real git.
    git('branch', '+main');
    const plus = run(scriptPath, 'origin/+main');
    assert.equal(plus.status, 0, `a branch named +main must be analysable; got ${plus.status}: ${plus.stderr}`);
    assert.equal(JSON.parse(plus.stdout).target, 'origin/+main',
      'and the plan must name it as given');

    // **The negative control, asserted on the outcome rather than on the absence of one phrase.**
    // Round 21: checking only that stdout lacks `check-ref-format` passes on a repository where the
    // target does not exist at all — `git init` defaults to `master` on some installs, so a `main`
    // target exits 1 with "Target ref main not found" and the control stayed green while producing
    // no plan. `victim` is created above, so it is present whatever the default branch is called.
    const ok = run(scriptPath, 'victim');
    assert.equal(ok.status, 0, `a legitimate branch name must produce a plan; got ${ok.status}: ${ok.stderr}`);
    const plan = JSON.parse(ok.stdout);
    assert.equal(plan.target, 'victim', 'and the plan must be built against the ref that was named');
    assert.ok(Array.isArray(plan.commits) && plan.commits.length > 0,
      `the plan must carry the commit it found; got ${ok.stdout.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a producer emitting a NUL → the byte is marked, not silently deleted', () => {
  // The output contract promises every C0 byte becomes U+FFFD *rather than vanishing*, so that
  // `A<NUL>B` and `AB` stay different plans. `json_escape` cannot keep that promise on its own: the
  // producer's output reaches it through a shell variable, and a Bash variable cannot hold a NUL —
  // `x=$(printf 'A\000B')` yields `AB` under this script's own interpreter. The byte was gone one
  // stage earlier than the function that promised to replace it.
  const GIT_NUL = FAKE_GIT.replace(/^ {2}log\).*$/m,
    `  log)        printf 'aaaa1111 feat: base work\\nbbbb2222 feat: A\\000B\\ncccc3333 feat: keep two\\n' ;;`);

  // **Driven through all three sanitizer backends, because the host picks only one.** Round 21: the
  // translated byte is replaced by `json_escape`'s C0 stage, which *emits* U+FFFD — three bytes, all
  // >= 0x80 — and the tool-less backend then replaced each of them again, so one NUL became three
  // replacement characters on a machine with neither `perl` nor `iconv`. A fixture that runs on the
  // host's own backend is green on this laptop and wrong in that environment.
  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-nul-'));
  try {
    const base = join(dir, 'base');
    mkdirSync(base);
    for (const tool of ['sed', 'cut', 'awk', 'grep', 'cat', 'printf', 'tr', 'git']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool} || true`], { encoding: 'utf8' }).stdout.trim();
      if (found) { writeFileSync(join(base, tool), `#!/bin/sh\nexec ${found} "$@"\n`); chmodSync(join(base, tool), 0o755); }
    }
    for (const [label, tools] of Object.entries({ perl: ['perl', 'iconv'], iconv: ['iconv'], none: [] })) {
      const bin = join(dir, `bin-${label}`);
      mkdirSync(bin);
      for (const tool of tools) {
        const found = spawnSync('/bin/sh', ['-c', `command -v ${tool} || true`], { encoding: 'utf8' }).stdout.trim();
        assert.ok(found, `precondition: ${tool} must exist to exercise the ${label} backend`);
        writeFileSync(join(bin, tool), `#!/bin/sh\nexec ${found} "$@"\n`);
        chmodSync(join(bin, tool), 0o755);
      }
      const run = runAnalyzeWithPath(['--target', 'origin/main'], GIT_NUL, `${bin}:${base}`);
      assert.equal(run.status, 0, `the ${label} backend exited ${run.status}: ${run.stderr}`);
      const subjects = JSON.parse(run.stdout).commits.map((c) => c.message);
      assert.ok(subjects.includes('feat: A�B'),
        `the ${label} backend must turn one NUL into exactly one U+FFFD; got ${JSON.stringify(subjects)}`);
      assert.ok(!subjects.includes('feat: AB'),
        `collapsing to "AB" is the deletion the contract forbids (${label} backend)`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an option-shaped branch name → reaches git only inside a fully-qualified refspec', () => {
  // **Round 23 reversed this test's expectation, and the reversal is the finding.** Rounds 20–22
  // read `origin/-evil` as an attack and refused it, because `sed`-stripping the `origin/` prefix
  // leaves `-evil`, which git would read as an option wherever a bare branch name is interpolated.
  // Measured against real git: `check-ref-format --allow-onelevel` ACCEPTS `refs/heads/-evil` and
  // `refs/heads/--upload-pack=id` — they are perfectly legal branch names, and a developer who has
  // one cannot analyse their own branch under a refusal.
  //
  // The refusal was covering for the interpolation. Once the fetch names
  // `+refs/heads/<name>:refs/remotes/origin/<name>` the bare name never appears as an argument of
  // its own, so there is nothing left for a leading `-` to be read as — which is what this test now
  // asserts, one property stronger than "it was allowed": **no argv element anywhere is the bare
  // option-shaped token**.
  for (const target of ['origin/-evil', 'origin/--upload-pack=id']) {
    const branch = target.replace(/^origin\//, '');
    const { calls, status } = runAnalyze(['--target', target]);
    assert.equal(status, 0, `a legal branch name must analyse, not be refused: ${target}`);
    assert.deepEqual(unexpectedCalls(calls), [],
      `every call must still match a template: ${JSON.stringify(calls)}`);
    const fetch = calls.find((c) => c[0] === 'fetch');
    assert.ok(fetch, `a remote target must still be refreshed: ${target}`);
    assert.ok(fetch.includes(`+refs/heads/${branch}:refs/remotes/origin/${branch}`),
      `the refspec must carry the name, fully qualified: ${JSON.stringify(fetch)}`);
    assert.ok(!calls.some((argv) => argv.includes(branch)),
      `the bare name must never be an argument git could read as an option: ${JSON.stringify(calls)}`);
  }
});

test('a --target that is not a valid ref name → is refused before anything is fetched', () => {
  // The rejection path the test above used to drive. It needs a value that is genuinely not a ref:
  // measured, `check-ref-format` rejects both a colon (a refspec, not a branch) and `..` (a range).
  // Both halves of the validation are asserted, because the script checks the raw `--target` *and*
  // the `refs/heads/<branch>` it will build from it, and a single check would leave the other half
  // free to drift.
  for (const target of ['origin/ma:in', 'origin/a..b']) {
    const { calls, status, stdout, stderr } = runAnalyze(['--target', target]);
    assert.equal(status, 1, `an invalid ref must be refused: ${target}`);
    assert.match(stdout || stderr, /check-ref-format/, `and say what rejected it: ${target}`);
    assert.ok(calls.some((c) => c[0] === 'check-ref-format' && c[c.length - 1] === target),
      `the raw --target must be tested: ${JSON.stringify(calls)}`);
    assert.deepEqual(unexpectedCalls(calls), [],
      `the guard's own calls must not be reported as violations: ${JSON.stringify(calls)}`);
    assert.ok(!calls.some((c) => c[0] === 'fetch'), `and no fetch may be reached: ${target}`);
  }
});

test('a hostile remote.origin.fetch → cannot redirect the analysis fetch onto another branch', () => {
  // Round 22, and the sharpest form of this whole class: **nothing is injected**. `--target main` is
  // ordinary and passes every validation; the repository's own `remote.origin.fetch` decides where
  // the fetched ref lands. Measured: with `+refs/heads/main:refs/heads/victim` configured, a plain
  // `git fetch origin main` moved `victim` onto main's tip. Validating the source argument never
  // touched this, because the destination was never in the argument.
  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-refmap-'));
  const git = (...args) => spawnSync(REAL_GIT, ['-C', dir, ...args], { encoding: 'utf8' });
  // **`origin/main`, not `main` — and the difference is a round-23 change this fixture had to
  // follow.** The script now fetches only for a remote-tracking target, so a local `--target main`
  // reaches no fetch at all: the assertions below would have passed on a script that never contacts
  // the remote, which is precisely the hazard they exist to detect.
  const run = (script) => spawnSync('/bin/bash', [script, '--target', 'origin/main'], { cwd: dir, encoding: 'utf8' });
  try {
    assert.ok(REAL_GIT, 'precondition: a real git decides what a refspec does');
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'commit.gpgSign', 'false');
    git('config', 'user.name', 'Test');
    git('commit', '-q', '--allow-empty', '-m', 'base');
    git('branch', 'victim');
    git('commit', '-q', '--allow-empty', '-m', 'second');
    // **Rename rather than assume.** `git init` takes its initial branch from the developer's own
    // `init.defaultBranch`, so a machine still defaulting to `master` failed this fixture's
    // precondition while the production fix was perfectly correct — a false positive in exactly the
    // direction these controls exist to avoid.
    git('branch', '-M', 'main');
    const head = git('symbolic-ref', '--short', 'HEAD').stdout.trim();
    assert.equal(head, 'main', `the fixture must control its own branch name, got ${head}`);
    git('remote', 'add', 'origin', '.');
    git('config', 'remote.origin.fetch', '+refs/heads/main:refs/heads/victim');
    const before = git('rev-parse', 'victim').stdout.trim();
    const tip = git('rev-parse', 'HEAD').stdout.trim();
    assert.notEqual(before, tip, 'precondition: victim must start off HEAD, or a move is invisible');

    run(scriptPath);
    assert.equal(git('rev-parse', 'victim').stdout.trim(), before,
      'the configured refspec redirected the analysis fetch and moved a local branch');
    assert.equal(git('rev-parse', 'refs/remotes/origin/main').stdout.trim(), tip,
      'and the fetch must still do its job — refresh the remote-tracking ref it was asked for');

    // Delete the guard and the branch moves: without `--refmap=` and the explicit destination, the
    // configured refspec wins. Without this control the assertion above passes on any script that
    // happens not to fetch at all.
    git('update-ref', 'refs/heads/victim', before);
    const source = readFileSync(scriptPath, 'utf8');
    const unguarded = source.replace(
      'git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- "$REMOTE" "$_refspec"',
      'git fetch origin "$TARGET_BRANCH" --quiet');
    assert.notEqual(unguarded, source, 'the mutation must actually remove the refmap guard');
    const mutant = join(dir, 'unguarded.sh');
    writeFileSync(mutant, unguarded);
    run(mutant);
    assert.equal(git('rev-parse', 'victim').stdout.trim(), tip,
      'without the guard the configured refspec must move the branch — otherwise this test would '
      + 'pass on a script that never had the defect');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a fetch that fails while the stale ref still resolves → is an error, not a plan', () => {
  // **Round 23's P1.** The fetch was written `|| true`, and every read after it answers from the
  // stale local copy, so the failure had no observable at all: exit 0, a full rebase plan, and
  // nothing in the output saying the remote was never reached. A plan built that way is worse than
  // no plan, because it is indistinguishable from a correct one.
  const { calls, status, stdout, stderr } = runAnalyze(['--target', 'origin/main'], undefined, GIT_FETCH_FAILS);
  assert.equal(status, 1, `a failed refresh must abort; got ${status} with ${stdout.slice(0, 200)}`);
  const out = stdout || stderr;
  assert.doesNotMatch(out, /rebase_command/, `and must not emit a plan: ${out.slice(0, 200)}`);
  assert.match(out, /git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- 'origin' '\+refs\/heads\/main:refs\/remotes\/origin\/main'/,
    `and must name the command that shows why: ${out.slice(0, 300)}`);
  assert.deepEqual(unexpectedCalls(calls), [],
    `the abort path's own calls must stay within the templates: ${JSON.stringify(calls)}`);
  assert.ok(!calls.some((c) => c[0] === 'log' || c[0] === 'cherry'),
    `and no history may be enumerated after the failure: ${JSON.stringify(calls)}`);
});

test('a fetch that succeeds and transfers nothing → is an error, not a plan from stale history', () => {
  // **Round 58.** The abort above only catches a fetch that *fails*. Measured 2026-08-22 against
  // git 2.55.0: when every positive refspec on the line is cancelled by a configured negative, git
  // exits 0, prints nothing, and leaves the tracking ref at whatever it held before — so the plan
  // is built from stale history and reads exactly like a correct one. That is the same class the
  // `|| true` bug was, arriving through a success rather than a failure.
  //
  // The discriminator is FETCH_HEAD, not the exit code: git truncates it when a fetch starts and
  // writes one line per ref actually considered, so an all-excluded fetch leaves it at zero bytes
  // while "already up to date" still writes its line. `git fetch --porcelain` cannot tell the two
  // apart — both print nothing — which is why the file is read instead.
  // `--base` so a `rebase_command` is genuinely on the table: only explicit-base mode builds one,
  // and refusing to emit what was never going to be emitted proves nothing.
  const ARGV = ['--target', 'origin/main', '--base', 'aaaa1111'];
  const { calls, status, stdout, stderr } = runAnalyze(ARGV, undefined, GIT_FETCH_EMPTY);
  assert.equal(status, 1, `a fetch that moved nothing must abort; got ${status} with ${stdout.slice(0, 200)}`);
  const out = stdout || stderr;
  assert.doesNotMatch(out, /rebase_command/, `and must not emit a plan: ${out.slice(0, 200)}`);
  assert.match(out, /transferred nothing/, `and must say what was observed: ${out.slice(0, 300)}`);
  assert.ok(!calls.some((c) => c[0] === 'log' || c[0] === 'cherry'),
    `no history may be enumerated after it: ${JSON.stringify(calls)}`);
  assert.deepEqual(unexpectedCalls(calls), [],
    `and the abort path's own calls must stay within the templates: ${JSON.stringify(calls)}`);

  // **The negative control.** Without it the assertions above are satisfied by a script that
  // refuses every fetch — which is what the round-23 `|| true` fix would have looked like taken one
  // step too far. The ordinary shim writes a FETCH_HEAD line, and that run must still plan.
  const ok = runAnalyze(ARGV);
  assert.equal(ok.status, 0, `a fetch that transferred something must still plan; got ${ok.stderr}`);
  assert.match(ok.stdout, /rebase_command/, 'and that plan must carry the command');

  // And the mutant, so the check is shown to be load-bearing rather than incidentally green: drop
  // the emptiness half of the postcondition and the excluded fetch plans from stale history again.
  const source = readFileSync(scriptPath, 'utf8');
  const mutated = source.replace('if [ -z "$_fetch_head" ] || [ ! -s "$_fetch_head" ]; then',
    'if [ -z "$_fetch_head" ]; then');
  assert.notEqual(mutated, source, 'the mutation must actually remove the emptiness test');
  const mutant = runAnalyze(ARGV, mutated, GIT_FETCH_EMPTY);
  assert.equal(mutant.status, 0, 'the mutant must plan from the stale ref — otherwise the test guards nothing');
  assert.match(mutant.stdout, /rebase_command/, 'and emit the very command this test refuses');
});

test('a local --target → is analysed without contacting the remote at all', () => {
  // The other half of the same rule: a target that resolves to a local ref and is claimed by no
  // remote is refreshed from nothing. Classification is by resolution plus the ownership scans now,
  // not the old `case $TARGET in origin/*)` spelling (removed — see the round-24 note below);
  // `SKILL.md` Step 5 still says "skip if target is local", and a script that fetches anyway turns
  // an offline analysis of a local branch into a hard failure the moment the abort above works.
  const { calls, status } = runAnalyze(['--target', 'main']);
  assert.equal(status, 0, 'a local target must analyse offline');
  assert.ok(!calls.some((c) => c[0] === 'fetch'),
    `a local target must reach no remote: ${JSON.stringify(calls)}`);
  assert.deepEqual(unexpectedCalls(calls), [], JSON.stringify(calls));
});

test('a remote-tracking ref that was never fetched → is still refreshed, via the configured remote', () => {
  // **Round 24 decided this by spelling — `case $TARGET in origin/*)` — and asking the repository is
  // what replaced it; that guard is gone, and classification now comes from the resolved ref plus
  // the two ownership scans.** `origin/unfetched` does not resolve locally — that is the
  // whole point of fetching it — so `rev-parse --symbolic-full-name` cannot classify it. The answer
  // still comes from the repository (`git remote`, matched whole), not from the argument's
  // shape, and without this case the template list would carry a `remote` permission nothing uses.
  // Round 25 replaced the `config --get remote.<name>.url` probe: a remote name may contain `/`, so
  // `${_rest%%/*}` guessed the wrong name to ask about, and no probe of a wrong name can be right.
  const { calls, status } = runAnalyze(['--target', 'origin/unfetched']);
  assert.equal(status, 0, 'an unfetched remote-tracking target must still analyse');
  assert.ok(calls.some((c) => c.length === 1 && c[0] === 'remote'),
    `the remote must be confirmed by asking the repository: ${JSON.stringify(calls)}`);
  const fetch = calls.find((c) => c[0] === 'fetch');
  assert.ok(fetch && fetch.includes('+refs/heads/unfetched:refs/remotes/origin/unfetched'),
    `and it must be fetched into its own tracking ref: ${JSON.stringify(fetch)}`);
  assert.deepEqual(unexpectedCalls(calls), [], JSON.stringify(calls));
});

test('a fully-qualified remote-tracking --target → is refreshed, not read as a local ref', () => {
  // The direction round 24 found broken: `refs/remotes/origin/main` IS a remote-tracking ref, and
  // the `origin/*` pattern called it local — so it skipped the refresh and produced a plan from
  // whatever was on disk. That is the exact staleness the refresh requirement exists to prevent,
  // reachable by spelling the same ref its other way.
  const { calls, status } = runAnalyze(['--target', 'refs/remotes/origin/main']);
  assert.equal(status, 0, 'a fully-qualified remote-tracking ref must analyse');
  const fetch = calls.find((c) => c[0] === 'fetch');
  assert.ok(fetch, `it must be refreshed like any other remote-tracking ref: ${JSON.stringify(calls)}`);
  assert.ok(fetch.includes('+refs/heads/main:refs/remotes/origin/main'),
    `and the refspec must name the branch, not the full ref: ${JSON.stringify(fetch)}`);
  assert.deepEqual(unexpectedCalls(calls), [], JSON.stringify(calls));
});

test('a branch name carrying shell syntax → cannot inject into the recovery instruction', () => {
  // **Round 24's other P1.** `git check-ref-format` accepts `;`, backticks and `$( )` — measured —
  // so `Run git fetch origin $TARGET_BRANCH by hand` handed the reader a second command to run the
  // moment they pasted it. The plan's `rebase_command` was already `sh_quote`d for exactly this
  // reason; the error path was the half that was not. JSON escaping does not make a string
  // shell-safe: the two encodings answer different questions.
  // No ASCII space — git rejects that in a ref name. `${IFS}` is the spelling that makes the
  // injected command work without one, which is exactly why the quoting has to be real.
  const payload = 'feat/x;printf${IFS}PWN';
  const { status, stdout, stderr } = runAnalyze(['--target', `origin/${payload}`], undefined, GIT_FETCH_FAILS);
  assert.equal(status, 1, 'the failed refresh must still abort');
  const out = stdout || stderr;
  assert.match(out, /'\+refs\/heads\/feat\/x;printf\$\{IFS\}PWN:refs\/remotes\/origin\/feat\/x;printf\$\{IFS\}PWN'/,
    `the branch name must reach the reader quoted: ${out.slice(0, 300)}`);
  assert.doesNotMatch(out, /-- 'origin' \+refs\/heads\/feat\/x;/,
    `and never as bare shell text: ${out.slice(0, 300)}`);
  // The instruction must survive as a command that does exactly one thing when pasted.
  const cmd = /Run (git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- '[^']*' '(?:[^']|'\\'')*') by hand/.exec(out);
  assert.ok(cmd, `the recovery instruction must be extractable: ${out.slice(0, 300)}`);
  const echoed = spawnSync('/bin/bash', ['-c', `set -- ${cmd[1].replace(/^git fetch /, '')}; printf '%s\\n' "$#" "\${!#}"`],
    { encoding: 'utf8' });
  // Seven words, and the payload must be the whole of the last one. The count alone would pass on a
  // command that split the refspec and gained a word elsewhere; the last word alone would pass on
  // one that appended a second command after it.
  const [count, last] = echoed.stdout.trim().split('\n');
  assert.equal(count, '7',
    `the quoted instruction must parse as exactly seven words: ${cmd[1]}`);
  assert.equal(last, `+refs/heads/${payload}:refs/remotes/origin/${payload}`,
    `and the refspec must survive as one word: ${cmd[1]}`);
});

test('a legal branch name the old class rejected → is analysed, not reported as an unauthorized call', () => {
  // **Round 24's P2, and it is a false-positive finding — the direction that gets a control
  // deleted.** The refspec class excluded `]` and JavaScript's `\\s`; measured against real git,
  // `refs/heads/feat/a]b` is legal and so are refs containing NBSP, U+2028 and U+3000. So the
  // harness called the script's own correct fetch an unauthorized write, on a branch a developer is
  // entitled to have. `:` and `*` are the only bytes that change what a refspec is.
  for (const branch of ['feat/a]b', 'feat/a\u3000b', 'feat/a\u00a0b']) {
    const { calls, status } = runAnalyze(['--target', `origin/${branch}`]);
    assert.equal(status, 0, `a legal branch name must analyse: ${JSON.stringify(branch)}`);
    const fetch = calls.find((c) => c[0] === 'fetch');
    assert.ok(fetch, `and be refreshed: ${JSON.stringify(branch)}`);
    assert.deepEqual(unexpectedCalls(calls), [],
      `the harness reported the script's own legitimate fetch: ${JSON.stringify(calls)}`);
  }
});

test('a fetch whose destination names a different remote → is reported by the allow-list', () => {
  // The cross-slot relationship a per-slot rule cannot see: every argument here is individually
  // fine — `upstream` is a plausible remote, and the refspec is fully qualified and wildcard-free —
  // but the destination lands in a namespace this call never named. That is a write to somewhere
  // the caller did not ask about, assembled entirely out of allowed parts.
  const { calls } = runAnalyze([], '#!/bin/bash\n'
    + "git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- upstream "
    + "'+refs/heads/main:refs/remotes/origin/main'\n");
  assert.equal(calls.length, 1, 'the probe must have been recorded');
  assert.deepEqual(unexpectedCalls(calls), calls,
    'a destination under a remote the call does not name must be reported');
});

// ── Round 26 ─────────────────────────────────────────────────────────────────────────────────

// This document is read by a model that then writes shell commands for a human to paste, so what it
// shows is executable advice. `git check-ref-format` accepts `;`, backticks, `$( )` and `'` inside
// a ref name — all measured — so a slot presented as bare shell text is an injection the document
// itself supplies: a remote named `evil;printf${IFS}PWN` runs a second command, and a branch
// containing `'` breaks out of a fixed pair of single quotes.
//
// The property asserted is narrow and checkable: **in every shell block in the file, a `<...>`
// placeholder standing in a command must say it is quoted.** Not a scan for dangerous characters —
// the danger is in what the reader substitutes, which the document cannot see.
//
// **Whole file, not one section** — and that scope is itself a finding this round. The first
// version of this scanner read Step 5 alone, went green, and left `git push --force-with-lease
// origin <branch>` in Step 6 and `git merge-base <base-branch> HEAD` in Step 2 exactly as bare as
// the slot it had been written to catch. A control scoped more narrowly than the class it guards
// reports the one instance whoever wrote it happened to be looking at.
function subsectionOf(text, heading) {
  const lines = text.split('\n');
  const i = lines.indexOf(heading);
  assert.notEqual(i, -1, `${heading} is missing from the skill`);
  let j = i + 1;
  let fenced = false;
  // Fence state is not optional here: a shell comment inside a ```bash block starts with `# `, and
  // reading one as a heading ended the section on its first line — measured, and it silently
  // emptied the very check this helper exists for.
  for (; j < lines.length; j += 1) {
    if (/^```/.test(lines[j])) { fenced = !fenced; continue; }
    if (!fenced && /^#{1,3} /.test(lines[j])) break;
  }
  return lines.slice(i, j).join('\n');
}

// One shell-aware walk over the document's command blocks, shared by both scanners below. Three
// properties are load-bearing, each a measured false-reading of the per-line versions this replaces:
//   * A command spans lines. A trailing unescaped ``, or a quote that has not closed, continues the
//     command onto the next line — which need NOT begin with `git`/`bash` and must NOT reset quote
//     state. The per-line reader missed a bare slot on a `git push origin ` continuation, and reset
//     the quote on a continuation line that itself began with `git`, unquoting a nested slot.
//   * An unquoted `#` at a word boundary starts a shell comment; the rest of the line is not command
//     text. Without this, an honest `git log # note "<quoted x>"` was reported as a nested slot.
//   * A backslash outside single quotes escapes the next character for quote/comment purposes
//     (`\'`, `\"`, `\#` do not toggle or comment); inside single quotes nothing escapes. Slot
//     detection itself stays conservative — a `<…>` in a command region is reported whatever the
//     escaping, because a missed slot is the dangerous direction and a doc almost never escapes one
//     on purpose.
// visit({ slot, quoted }) is called for every `<…>` slot found inside a command region.
// onRegion(text) — optional — receives each complete command (continuations joined, comment tails
// removed). **A slot scan alone cannot see the defect that has no slot**: Step 1 shipped
// `[--target origin/main]`, a literal ref written where a slot belongs, and every guard here read
// straight past it because there was no `<…>` to read. The region is what makes an operand that was
// never marked up checkable at all.
function scanCommandSlots(text, visit, onRegion) {
  const lines = text.split('\n');
  let inBlock = false;
  let active = false;
  let sq = false;
  let dq = false;
  let buf = '';
  const flush = () => { if (onRegion && buf.trim() !== '') onRegion(buf); buf = ''; };
  for (const line of lines) {
    if (/^```/.test(line)) { inBlock = !inBlock; flush(); active = false; sq = false; dq = false; continue; }
    if (!inBlock) continue;
    if (!active) {
      // **A command bound to a variable is still a command.** This predicate once matched only a
      // line *starting* with `git `/`bash `, so `n=$(git for-each-ref … "refs/heads/<quoted branch>"`
      // was invisible to every guard in this file — and that is how a nested-quote defect shipped in
      // the Step 5 ambiguity block: the slot scan structurally could not see the block it was in.
      // Command substitution assigned to a name is the shape the safe patterns in this document use
      // (`range=$(git log …)`, `branch=<quoted branch>`), so it is exactly where slots now live.
      if (!/^\s*(git|bash) /.test(line) && !/^\s*[A-Za-z_][A-Za-z0-9_]*=\$\(\s*(git|bash) /.test(line)) continue;
      active = true; sq = false; dq = false;
    }
    let cont = false;
    let commentAt = -1;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      cont = false;
      if (ch === '\\' && !sq) {
        if (i === line.length - 1) { cont = true; break; }
        // Inside double quotes a backslash escapes ONLY `$ " \ ` + backtick; before anything else
        // (a `<`, say) it is a literal backslash and the next char stands on its own — so a slot
        // there must still be seen. Outside all quotes the backslash escapes whatever follows.
        if (!dq || '$"\`'.includes(line[i + 1])) { i += 1; }
        continue;
      }
      if (ch === "'" && !dq) { sq = !sq; continue; }
      if (ch === '"' && !sq) { dq = !dq; continue; }
      if (ch === '#' && !sq && !dq && (i === 0 || /\s/.test(line[i - 1]))) { commentAt = i; break; }
      if (ch !== '<') continue;
      const m = /^<[^>]+>/.exec(line.slice(i));
      if (m) { visit({ slot: m[0], quoted: sq || dq }); i += m[0].length - 1; }
    }
    buf += `${commentAt === -1 ? line : line.slice(0, commentAt)}\n`;
    if (!cont && !sq && !dq) { flush(); active = false; }     // command ends unless continued
  }
  flush();
}

// Every complete command in the document, comment tails removed and continuations joined.
function commandRegions(text) {
  const out = [];
  scanCommandSlots(text, () => {}, (region) => out.push(region));
  return out;
}

// **An option whose value is a ref name must carry it as a joined `=<quoted …>` slot.** Both halves
// are load-bearing and both were measured: the *quoting* because `check-ref-format` accepts `;`, so
// `--target origin/main;printf${IFS}PWN` pasted from a template runs a second command; the *joined*
// `=` because a split `--target <value>` cannot be told from `--target` followed by a mistyped
// option, which is the ambiguity the script itself refuses. A literal example value — the shape
// `[--target origin/main]` had — fails both and is what this returns.
function bareRefOptionOperands(text) {
  const out = [];
  for (const region of commandRegions(text)) {
    const re = /--(target|base)(=|\s+)(<[^>]*>|\S+)/g;
    let m = re.exec(region);
    while (m !== null) {
      const [, opt, sep, value] = m;
      if (!(sep === '=' && /^<quoted [^>]+>$/.test(value))) {
        out.push(`--${opt}${sep === '=' ? '=' : ' '}${value}`);
      }
      m = re.exec(region);
    }
  }
  return out;
}

// Every `<…>` slot that appears in a command a reader would paste — following continuations, past
// comments. A slot in a plan table or prose is not an instruction and is deliberately not counted.
function commandPlaceholders(text) {
  const out = [];
  scanCommandSlots(text, ({ slot }) => out.push(slot));
  return out;
}

// `<quoted …>` says the substituted value arrives already single-quoted — so the slot carries its
// own quotes, and a fixed pair around it does not add safety, it removes it. Measured: the Step 2
// template `'--base=<quoted branch-or-commit>'` with the ref `feat/x;printf${IFS}PWN` substituted
// becomes `'--base='feat/x;printf${IFS}PWN''`, which bash runs as an analysis call plus a second
// command; a ref containing an apostrophe makes it a syntax error instead. A slot reported here sits
// inside a quoted region and so contradicts what `<quoted …>` promises.
function quoteNestedPlaceholders(text) {
  const out = [];
  scanCommandSlots(text, ({ slot, quoted }) => { if (quoted) out.push(slot); });
  return out;
}

test('every shell block in the skill → presents no name slot that is not marked as quoted', () => {
  const slots = commandPlaceholders(skill);
  assert.notEqual(slots.length, 0, 'the document must still show command shapes');
  const bare = slots.filter((s) => !/^<quoted /.test(s));
  assert.deepEqual(bare, [],
    `a bare name slot invites an unquoted substitution: ${JSON.stringify(bare)}`);
});

test('an option taking a ref value in the skill → carries it as a joined quoted slot, never a literal', () => {
  // **The defect a slot scan structurally could not see.** Step 1 read
  // `smart-rebase-analyze.sh [--target origin/main]` — a literal ref standing in for the value, with
  // no `<…>` anywhere in it, so every quoting guard in this file passed over the one command a
  // reader is most likely to paste first. Measured: `check-ref-format --allow-onelevel
  // 'origin/main;printf${IFS}PWN'` exits 0, and following that template with such a target runs the
  // analysis and then a second command.
  assert.deepEqual(bareRefOptionOperands(skill), [],
    'a ref-valued option must be written --target=<quoted …>, never with a literal or split value');

  // Negative controls — one per way the rule can be broken, because a guard that only catches the
  // exact text of the round that prompted it is green the next time it is broken differently.
  // **Each fixture is anchored to the script name, and that is not cosmetic.** `--base=<quoted
  // branch-or-commit>` also appears in § Names in commands as *prose*, and it appears there first —
  // so the unanchored spelling edited a sentence the scanner never reads, reported nothing, and the
  // control passed while proving nothing. That is this round's own finding wearing a test's clothes.
  const breakages = {
    'the literal example this shipped with': [
      'smart-rebase-analyze.sh --target=<quoted target>',
      'smart-rebase-analyze.sh [--target origin/main]'],
    'a split form carrying a proper slot': [
      'smart-rebase-analyze.sh --target=<quoted target>',
      'smart-rebase-analyze.sh --target <quoted target>'],
    'a bare value on --base': [
      'smart-rebase-analyze.sh --base=<quoted branch-or-commit>',
      'smart-rebase-analyze.sh --base fix/feature-xyz'],
  };
  for (const [label, [from, to]] of Object.entries(breakages)) {
    const reverted = skill.replace(from, to);
    assert.notEqual(reverted, skill, `the fixture must differ from the skill: ${label}`);
    assert.notEqual(bareRefOptionOperands(reverted).length, 0,
      `a ref-valued option written unsafely went unreported: ${label}`);
  }

  // And the green direction: a command region is a command, not the whole block. A `/smart-rebase`
  // usage line is a slash command a human types, not a shell line anyone pastes into bash, so the
  // `--base fix/feature-xyz` in the Examples section must NOT be reported — otherwise the guard
  // forces markup onto text that never reaches a shell.
  assert.match(skill, /\/smart-rebase --base fix\/feature-xyz/,
    'the examples must still show the slash-command form this exemption is about');
});

test('a quoted slot in the skill → is never nested inside another pair of quotes', () => {
  const nested = quoteNestedPlaceholders(skill);
  assert.deepEqual(nested, [],
    `a slot that already carries its quotes must not be wrapped again: ${JSON.stringify(nested)}`);
  // The negative control, and the exact text this file shipped one round ago.
  const reverted = skill.replace('smart-rebase-analyze.sh --base=<quoted branch-or-commit>',
    "smart-rebase-analyze.sh '--base=<quoted branch-or-commit>'");
  assert.notEqual(reverted, skill, 'the fixture must differ from the skill');
  assert.notEqual(quoteNestedPlaceholders(reverted).length, 0,
    'the nested form must be reported — the marker alone reads as safe');
  // Two shapes the per-line reading missed, checked against the scanner directly because the
  // document does not currently contain either — and a guard that only ever sees today's document
  // is green by accident, not by construction.
  const carried = ['```bash', "git push origin '\\", '<quoted branch>', "'", '```'].join('\n');
  assert.deepEqual(quoteNestedPlaceholders(carried), ['<quoted branch>'],
    'an open quote continued onto the next line still encloses the slot');
  const escaped = ['```bash', "git log --not \\'<quoted target>", '```'].join('\n');
  assert.deepEqual(quoteNestedPlaceholders(escaped), [],
    'a backslash-escaped apostrophe is a literal, not the start of a quoted region');
  // Four more shapes the earlier readers got wrong, in both scanner directions.
  // (a) A bare slot on a backslash continuation line — commandPlaceholders must follow it.
  const contBare = ['```bash', 'git push origin \\', '  <branch>', '```'].join('\n');
  assert.deepEqual(commandPlaceholders(contBare), ['<branch>'],
    'a slot on a continuation line is still part of the command');
  // (b) A nested slot on a continuation line that itself begins with `git` — the state must carry,
  // not reset. The open double-quote from line one still encloses the slot on line two.
  const contNested = ['```bash', 'git show "prefix', 'git log <quoted target>"', '```'].join('\n');
  assert.deepEqual(quoteNestedPlaceholders(contNested), ['<quoted target>'],
    'an unclosed quote carries onto a continuation line even when it starts with git');
  // (c) Inside double quotes a backslash before `<` is literal, so the slot is present and nested.
  const dqEsc = ['```bash', 'git show "\\<quoted target>"', '```'].join('\n');
  assert.deepEqual(quoteNestedPlaceholders(dqEsc), ['<quoted target>'],
    'a backslash before < inside double quotes does not remove the nested slot');
  // (d) A slot inside a shell comment is not command text — reporting it broke honest doc edits.
  const commented = ['```bash', 'git log HEAD # note "<quoted target>"', '```'].join('\n');
  assert.deepEqual(quoteNestedPlaceholders(commented), [],
    'a slot inside an unquoted # comment is not a nested command slot');
  assert.deepEqual(commandPlaceholders(commented), [],
    'and it is not a bare slot either — the comment is not part of the command');
});

test('the skill → states the quoting rule where it governs every step', () => {
  // The other half, and the one that makes the rule followable rather than merely stated: the
  // script emits the command with every name run through `sh_quote`, so the correct move is to copy
  // that field rather than to reproduce the quoting rule by hand. It lives in a section of its own
  // rather than inside Step 5 — a rule written in one step does not reach the templates in the
  // others, which is exactly how Steps 2 and 6 stayed bare through a round about quoting.
  assert.match(skill, /^## Names in commands$/m, 'the rule needs a section of its own');
  const section = sectionOf(skill, '## Names in commands');
  assert.match(section, /sh_quote/, 'naming the quoting the script already applied');
  assert.match(section, /rebase_command/, 'and the field to copy instead of rebuilding');
});

test('the skill → says a quoted name is still an option to git, and separates it', () => {
  // Shell quoting and git's option parser are two different readers, and only the first one sees
  // the quotes. Measured in a scratch repo: `git check-ref-format refs/heads/--all` exits 0, so
  // `--all` is a legal branch name, and `git push --force-with-lease origin '--all'` pushed *two*
  // branches — git had read the operand as its own `--all` option. The quoting rule was already
  // stated and already followed; it closed nothing here.
  const section = sectionOf(skill, '## Names in commands');
  assert.match(section, /--all/, 'the measured name that git reads as an option');
  assert.match(section, /separator/, 'the rule is the separator, not a spelling of the ref');
  // The rule must name `--`/`--end-of-options` as the mechanism AND record why fully-qualifying is
  // not it for a rebase branch operand — that half is what a later round would otherwise re-delete.
  assert.match(section, /detached HEAD/,
    'the section must record that fully-qualifying a rebase branch operand detaches instead');
  assert.match(skill, /git push --force-with-lease --force-if-includes origin -- <quoted refspec>/,
    'the push template must hand the ref past the option parser');
  // **Negative control for the line above**, so the guard is not green only on the day it lands.
  // `--` ends *option* parsing, not *refspec* parsing: after it git still reads a leading `+` as
  // force and `:` as the source/destination split. Measured — `git check-ref-format refs/heads/+main`
  // exits 0, so `+main` is a legal branch name, and written bare it is read as "force-push `main`",
  // rewriting the protected branch while the approved name was `+main`. The protected comparison
  // misses it for the same reason. `/push-ci` and `/epic-merge` already render the full form.
  assert.doesNotMatch(skill, /origin -- <quoted branch>/,
    'the bare branch operand is read as a refspec — a branch named +main would force-push main');
  assert.match(skill, /git merge-base --end-of-options <quoted base-branch> HEAD/,
    'and so must the merge-base template, in the spelling that command accepts');
  assert.match(skill, /git rebase --onto '[^']+' '[^']+' -- 'feat\/x'/,
    'the emitted rebase command must place -- before the branch operand');
  // **Step 6's count command reads a caller-supplied target too, and it was the template this guard
  // did not name.** Quoting does not end git's option parsing: measured, in a 538-commit repository
  // `git log --oneline HEAD --not '--max-count=1'` printed one line, and
  // `--not '--output=/dev/null'` was consumed as git's *output* option — with another absolute path
  // in place of `/dev/null` that truncates a file with the developer's permissions. Measured green
  // direction: `--not --end-of-options origin/main` returns the same count as the unseparated form,
  // so the separator costs the command nothing.
  assert.match(skill, /range=\$\(git log --oneline HEAD --not --end-of-options <quoted target>\)/,
    'the Step 6 count command must hand its target past the option parser');
  // **And the separator alone does not make it safe.** `--end-of-options` makes git *fail* on an
  // unknown target; a pipeline then throws that failure away, because it exits with `wc`'s status.
  // Measured: `git log --oneline HEAD --not --end-of-options refs/heads/__missing__ | wc -l` prints
  // `fatal: ambiguous argument`, exits **0**, and reports **0** commits — after which Step 6
  // recommends a force push. So the count is taken in two steps, status-checked in between.
  assert.doesNotMatch(skill, /git log --oneline HEAD --not --end-of-options <quoted target> \| wc -l/,
    'negative control: restoring the one-line pipeline must turn this test red');
  assert.match(skill, /if \[ -z "\$range" \]; then echo 0; else printf '%s\\n' "\$range" \| wc -l; fi/,
    'an empty range is a count, not a failure — grep -c would abort a set -e caller on it');
  // Negative controls: each separator removed on its own, since one guard covering all three would
  // stay green while the other templates regressed.
  for (const [label, from] of [
    ['push', 'git push --force-with-lease --force-if-includes origin -- <quoted refspec>'],
    ['merge-base', 'git merge-base --end-of-options <quoted base-branch> HEAD'],
    ['log --not', 'git log --oneline HEAD --not --end-of-options <quoted target>'],
  ]) {
    const reverted = skill.replace(from, from.replace(/ (--|--end-of-options)(?= <quoted)/, ''));
    assert.notEqual(reverted, skill, `the fixture must differ from the skill: ${label}`);
    assert.doesNotMatch(reverted, new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `the separator survived the revert: ${label}`);
  }
});

test('the force-push suggestion → carries --force-if-includes, not the lease alone', () => {
  // `--force-with-lease` compares the remote ref against the last value you FETCHED, not against
  // what you integrated. Measured for r5: a collaborator commit that any background `git fetch`
  // already pulled satisfies the lease, and the push overwrites it with exit 0.
  //
  // **`--force-if-includes` narrows that and does not close it** — the wider reading is what round 2
  // of doc review caught in this very comment. It asks whether the remote tip is reachable from ANY
  // reflog entry of the local branch, not whether the history being pushed still contains it:
  // measured, a commit fetched, checked out, then dropped by a rewrite is still overwritten with
  // exit 0. What the pair closes is the background-fetch race alone. The guard below asserts the
  // template carries both flags; it does not certify the remote is safe, and this comment must not
  // read as though it does. The Prohibited pin states the rule — this guards the *template*, which a
  // pin over prose cannot reach.
  assert.match(skill, /git push --force-with-lease --force-if-includes origin -- <quoted refspec>/,
    'the suggested push must carry both guards, not the lease alone');

  // The refusing direction: drop the flag and the guard must report it.
  const dropped = skill.replace(' --force-if-includes origin', ' origin');
  assert.notEqual(dropped, skill, 'fixture stale — the push template no longer reads as expected');
  assert.doesNotMatch(dropped, /--force-with-lease --force-if-includes origin/,
    'the flag survived the revert, so this control proves nothing');

  // **And the passing direction, which is what stops the guard being tightened into a false
  // positive later.** This skill deliberately *discusses* the bare form in order to explain why it
  // is insufficient, so the words `--force-with-lease` appear in prose that is not a template. A
  // control keyed on the words rather than the template would go red on that prose — the same
  // mis-keying that made the efficacy blacklist wrong in both directions
  // (`docs/features/push-gate-optin/4-implementation.md` § 2.1).
  const prose = skill.replace('## Conflict Handling',
    'Note: a bare `--force-with-lease` is what this section argues against.\n\n## Conflict Handling');
  assert.notEqual(prose, skill, 'fixture stale — the Conflict Handling heading moved');
  assert.match(prose, /git push --force-with-lease --force-if-includes origin -- <quoted refspec>/,
    'ordinary prose naming the bare form must not disturb the template check');
});

test('the quoting guard when a bare slot returns anywhere → reports it', () => {
  // The negative control — one fixture per block that has ever carried a bare slot, because the
  // failure this guard is for was never "no control", it was "a control that looked at one
  // section". Each `from` is the text now in the file; each `to` is what was there before.
  const revivals = {
    'the Step 5 fetch template': [
      'git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- <quoted remote> <quoted refspec>',
      "git fetch --refmap= --no-tags --no-recurse-submodules --quiet -- <remote> '+refs/heads/<target-branch>:refs/remotes/<remote>/<target-branch>'"],
    'the Step 2 merge-base template': [
      'git merge-base --end-of-options <quoted base-branch> HEAD',
      'git merge-base <base-branch> HEAD'],
    'the Step 2 analysis re-run': [
      'smart-rebase-analyze.sh --base=<quoted branch-or-commit>',
      'smart-rebase-analyze.sh --base <branch-or-commit>'],
    'the Step 6 count command': [
      'range=$(git log --oneline HEAD --not --end-of-options <quoted target>)',
      'range=$(git log --oneline HEAD --not <target>)'],
    'the Step 6 force-push suggestion': [
      'git push --force-with-lease --force-if-includes origin -- <quoted refspec>',
      'git push --force-with-lease origin <branch>'],
  };
  for (const [label, [from, to]] of Object.entries(revivals)) {
    const reverted = skill.replace(from, to);
    assert.notEqual(reverted, skill, `the fixture must differ from the skill: ${label}`);
    const bare = commandPlaceholders(reverted).filter((s) => !/^<quoted /.test(s));
    assert.notEqual(bare.length, 0, `a reintroduced bare slot went unreported: ${label}`);
  }
});


test('a --base that is an option → is refused, not resolved as a query', () => {
  // **Round 26's sharpest finding, and it produces a destructive recommendation rather than a
  // crash.** `--base` is documented as a commit-or-branch and deliberately not run through
  // `check-ref-format` (a revision expression would fail it), so it reached `git rev-parse` as
  // written. Measured against this repository: `--base=--glob=refs/heads/*` exited 0 with a `ready`
  // plan, `drop_count: 4`, and a `git rebase --onto` command whose cut point came from a glob
  // expansion — a command the developer is invited to paste, built from an argument that never
  // named a commit.
  const payload = '--glob=refs/heads/*';
  const { calls, status, stdout, stderr } = runAnalyze(['--target', 'origin/main', `--base=${payload}`]);
  assert.equal(status, 1, 'an option-shaped --base must be refused');
  assert.doesNotMatch(stdout || stderr, /rebase_command/,
    `and no plan may be emitted: ${(stdout || stderr).slice(0, 200)}`);
  // **The status alone proves nothing here, and measuring that was the point.** With the guard
  // removed, the recording git answers `rev-parse --short --glob=refs/heads/*` with the first eight
  // characters of the argument, and the run then fails a downstream comparison — the same exit 1,
  // reached by an accident of the shim rather than by the refusal. What must hold is the mechanism:
  // the value reached git only inside a call that first told git to stop reading options.
  assert.deepEqual(bareOccurrences(calls, payload), [],
    `--base must never reach git as a bare argument: ${JSON.stringify(calls)}`);
});

test('a --base that is a revision expression → still resolves', () => {
  // The negative control the fix needs, and the reason it is `--end-of-options` rather than a
  // pattern refusing `-`: `HEAD~3`, `HEAD^{commit}` and `:/text` are what `--base` is *for*, and a
  // guard that rejected them would be removed by the next maintainer with a valid complaint.
  // Measured against real git: all three resolve under `--verify --end-of-options`.
  const { status, stdout } = runAnalyze(['--target', 'origin/main', '--base', 'aaaa1111']);
  assert.equal(status, 0, 'an ordinary --base must still resolve');
  assert.match(stdout, /"rebase_command"/, 'and produce a plan');
});

test('a <remote>/HEAD under any remote name → follows the symbolic ref, whatever the remote is called', () => {
  // Round 25 skipped the classification probe for option-shaped targets, which made the answer
  // depend on the spelling of the remote: `origin/HEAD` resolved through its symbolic ref while
  // `-evil/HEAD` was decomposed literally into a `refs/heads/HEAD` that does not exist (measured —
  // `fatal: couldn't find remote ref refs/heads/HEAD`). The probe is now safe rather than skipped,
  // so git answers both the same way.
  for (const target of ['origin/HEAD', '-evil/HEAD']) {
    const { calls, status } = runAnalyze([`--target=${target}`]);
    assert.equal(status, 0, `a remote HEAD must analyse: ${target}`);
    const fetch = calls.find((c) => c[0] === 'fetch');
    assert.ok(fetch, `and be refreshed: ${target}`);
    assert.ok(!fetch.some((a) => a.includes('refs/heads/HEAD')),
      `HEAD must be followed, not fetched literally: ${JSON.stringify(fetch)}`);
    assert.deepEqual(unexpectedCalls(calls), [],
      `every call must still match a template: ${JSON.stringify(calls)}`);
  }
});

test('a tracking path two configured remotes both claim → is refused, not resolved by length', () => {
  // Longest-match is deterministic and that is all it is. With `team` and `team/origin` both
  // configured, `refs/remotes/team/origin/main` is remote `team` branch `origin/main` *or* remote
  // `team/origin` branch `main`; both are legal and both can write that same tracking namespace, so
  // the path carries no evidence of which one put the ref there. Picking one would force-update the
  // ref from a repository that may not be its source.
  const twoRemotes = FAKE_GIT.replace(/^ {2}remote\).*$/m,
    "  remote)     printf '%s\\n' origin team team/origin ;;");
  const { calls, status, stdout, stderr } = runAnalyze(['--target', 'refs/remotes/team/origin/main'],
    undefined, twoRemotes);
  assert.equal(status, 1, 'an ambiguous tracking path must be refused');
  const out = stdout || stderr;
  assert.match(out, /more than one configured remote/, `and say so: ${out.slice(0, 200)}`);
  assert.match(out, /team team\/origin/, `naming both candidates: ${out.slice(0, 200)}`);
  assert.ok(!calls.some((c) => c[0] === 'fetch'), `and fetch nothing: ${JSON.stringify(calls)}`);
});

test('the remote classifier on a stripped PATH → still decides, needing no external binary', () => {
  // A regression I introduced and this caught: the ambiguity counter was first written with
  // `wc -l | tr -d ' '`, and the UTF-8 backend tests run this script on a PATH carrying only the
  // git shim — where both binaries are absent and the whole run died at exit 127. The classifier
  // must be shell-only, like the fail-closed paths around it.
  // Driven through the ambiguity refusal rather than the happy path, and deliberately: the report
  // is written with a `cat` heredoc, so a clean run legitimately needs one external binary. What
  // must not need one is the *decision* — everything between reading `git remote` and emitting a
  // verdict. `json_error` is `printf`, so this whole path is shell-only or it is nothing.
  const twoRemotes = FAKE_GIT.replace(/^ {2}remote\).*$/m,
    "  remote)     printf '%s\\n' origin team team/origin ;;");
  const args = ['--target', 'refs/remotes/team/origin/main'];
  // The companion run, on a full PATH, is what proves this input reaches the classifier at all —
  // without it the stripped-PATH assertions below would be equally satisfied by a script that died
  // somewhere earlier for an unrelated reason.
  const full = runAnalyze(args, undefined, twoRemotes);
  assert.equal(full.status, 1, 'precondition: this input must drive the ambiguity refusal');
  assert.match(full.stdout || full.stderr, /more than one configured remote/,
    'precondition: and produce its message when the escaper has a backend');

  const bin = mkdtempSync(join(tmpdir(), 'smart-rebase-nopath-'));
  try {
    const { status, stdout, stderr } = runAnalyze(args, undefined, twoRemotes, bin);
    const out = stdout || stderr;
    // The message itself is empty here, and that is the pre-existing escaper degradation the UTF-8
    // tests cover — not this test's subject. What must hold is that the decision was still made:
    // the same exit status, and no diagnostic about a missing binary.
    assert.doesNotMatch(out, /command not found/, `no binary may be missing: ${out.slice(0, 200)}`);
    assert.equal(status, full.status,
      `the verdict must not change with the PATH; got ${status}: ${out.slice(0, 200)}`);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

// ── Round 25: the remote is a name the repository owns, not a prefix of the argument ──────────

test('a remote whose name contains a slash → is resolved whole, not split at the first slash', () => {
  // **Round 25's P1.** The decomposition was `${_rest%%/*}` — the first path segment — so a
  // repository with a remote named `team/origin` had `refs/remotes/team/origin/main` read as remote
  // `team`, branch `origin/main`. Measured against real git: `git remote add team/origin <url>` is
  // accepted and honoured, so this is a legal repository, not a contrived one. The fetch that
  // followed named a remote that does not exist, and the analysis died on a repository that was
  // configured correctly.
  //
  // The resolution now matches against `git remote` output, whole names only — so `team/origin` is
  // found as itself. What it deliberately does NOT do is break the tie when both `team` and
  // `team/origin` exist: that path is ambiguous and is refused, which the next test covers.
  const { calls, status } = runAnalyze(['--target', 'team/origin/unfetched']);
  assert.equal(status, 0, 'a slash-bearing remote must analyse');
  const fetch = calls.find((c) => c[0] === 'fetch');
  assert.ok(fetch, `it must still be refreshed: ${JSON.stringify(calls)}`);
  assert.equal(fetch[6], 'team/origin', `the whole remote name must be used: ${JSON.stringify(fetch)}`);
  assert.equal(fetch[7], '+refs/heads/unfetched:refs/remotes/team/origin/unfetched',
    `and the branch must be what is left after it: ${JSON.stringify(fetch)}`);
  assert.deepEqual(unexpectedCalls(calls), [],
    `every call must still match a template: ${JSON.stringify(calls)}`);
});

test('a remote whose name begins with a dash → is addressed as an operand, not refused', () => {
  // Measured in round 25, and it is the reason the fetch carries `--`: a remote named `-evil` is
  // legal in git config, `git remote` lists it, and `git fetch -- -evil <refspec>` fetches from it.
  // Refusing the shape — the previous round's fix — reported a legitimate repository as hostile.
  // `--quiet` sits *before* the separator because after it git reads the flag as a refspec
  // (`fatal: couldn't find remote ref --quiet`, measured).
  const { calls, status } = runAnalyze(['--target=-evil/main']);
  assert.equal(status, 0, 'a dash-named remote must analyse');
  const fetch = calls.find((c) => c[0] === 'fetch');
  assert.ok(fetch, `it must be refreshed: ${JSON.stringify(calls)}`);
  assert.equal(fetch[5], '--', `the separator must precede the remote: ${JSON.stringify(fetch)}`);
  assert.equal(fetch[6], '-evil', `and the remote must be the operand after it: ${JSON.stringify(fetch)}`);
  // Every read must name the ref that was fetched, or else carry a separator — git reads a leading
  // `-` as an option at each one of them, and only a separator earlier in the same argv stops it.
  assert.deepEqual(bareOccurrences(calls, '-evil/main'), [],
    `no read may carry the option-shaped target bare: ${JSON.stringify(calls)}`);
  assert.ok(calls.some((c) => c[0] === 'merge-base' && c[2] === 'refs/remotes/-evil/main'),
    `the reads must use the refreshed ref: ${JSON.stringify(calls)}`);
});

test('an option-shaped --target that resolves to nothing → is refused before any read carries it', () => {
  // The other half of the round-25 fix, and the reason it is a refusal rather than a validation:
  // `git check-ref-format --allow-onelevel -nope` cannot validate this value at all — check-ref-format
  // reads the leading `-` as its own option, and `--` does not help it (measured). So the value is
  // accepted only when git resolves it to a full ref the reads can use instead. Nothing resolves
  // here, so nothing may proceed on the raw string.
  const { calls, status, stdout, stderr } = runAnalyze(['--target=-nosuchref']);
  assert.equal(status, 1, 'an unresolvable option-shaped target must be refused');
  assert.match(stdout || stderr, /begins with -/, `and say why: ${(stdout || stderr).slice(0, 200)}`);
  assert.ok(!calls.some((c) => c[0] === 'fetch'), `no fetch may be reached: ${JSON.stringify(calls)}`);
  assert.deepEqual(bareOccurrences(calls, '-nosuchref'), [],
    `and no read may be handed the value bare: ${JSON.stringify(calls)}`);
});

test('a rebase command for an option-shaped target → names the resolved ref, not the typed one', () => {
  // The command is printed for a developer to paste, and their `git` reads a leading `-` as an
  // option exactly as this script's does — shell-quoting does not change that. So the one spelling
  // that cannot be pasted is replaced by the ref that was actually refreshed. The two name the same
  // ref, which is what makes the substitution honest rather than a silent retarget.
  const { stdout, status } = runAnalyze(['--target=-evil/main', '--base=aaaa1111']);
  assert.equal(status, 0, 'the plan must be produced');
  const plan = JSON.parse(stdout);
  assert.equal(plan.target, '-evil/main', 'the report still says what the caller asked for');
  assert.match(plan.rebase_command, /^git rebase --onto 'refs\/remotes\/-evil\/main' /,
    `the pasteable command must name the resolved ref: ${plan.rebase_command}`);
});

test('a remote-tracking ref whose remote is gone → is an error, not a silently unrefreshed plan', () => {
  // A tracking ref outlives the remote that created it (`git remote remove` leaves `refs/remotes/`
  // behind), so this ref resolves perfectly while nothing can refresh it. Treating that as "local,
  // no fetch needed" is the § 1.4 staleness bug wearing a different hat: a confident plan, exit 0,
  // built on history no remote has confirmed in an unknown length of time.
  // Both halves, because git removes both: `git remote remove origin` drops `remote.origin.url`
  // AND `remote.origin.fetch`. A fixture that blanked only the name list would describe a state git
  // cannot produce, and the claimant scan would answer from a remote the repository no longer has.
  const noRemotes = FAKE_GIT
    .replace(/^ {2}remote\).*$/m, '  remote)     : ;;')
    .replace(/^ {2}config\).*$/m, '  config)     : ;;');
  const { calls, status, stdout, stderr } = runAnalyze(['--target', 'refs/remotes/origin/main'],
    undefined, noRemotes);
  assert.equal(status, 1, 'an orphaned tracking ref must be refused');
  assert.match(stdout || stderr, /no configured remote owns it/,
    `and say what is wrong: ${(stdout || stderr).slice(0, 200)}`);
  assert.ok(!calls.some((c) => c[0] === 'fetch'), `no fetch is possible: ${JSON.stringify(calls)}`);
});

test('an option value passed as a separate word → is refused when it is option-shaped', () => {
  // `--target -evil/main` cannot be told from `--target` followed by an unknown option, and guessing
  // either way is wrong: consuming it swallows a real typo, refusing it rejects a real remote. The
  // joined form is unambiguous, so the parser refuses the split one and says which spelling works —
  // and the tests above use `--target=` for exactly that reason.
  const { status, stdout, stderr } = runAnalyze(['--target', '-evil/main']);
  assert.equal(status, 1, 'an option-shaped value in the split form must be refused');
  assert.match(stdout || stderr, /--target=<value>/,
    `and name the spelling that works: ${(stdout || stderr).slice(0, 200)}`);
});

// ── Round 27 ─────────────────────────────────────────────────────────────────────────────────

test('an option-shaped --target that names a local branch → is analysed through its resolved ref', () => {
  // `git update-ref refs/heads/-weird HEAD` creates it and `git branch` will not (it reads the name
  // as an option) — both measured against real git, along with the probe resolving it to
  // `refs/heads/-weird`. So this target is *answerable*, and the round-26 shape refused it anyway:
  // the refusal ran whenever no remote owned the path, discarding an answer the probe had already
  // produced. The pair with the test above is the whole property — resolvable is analysed,
  // unresolvable is refused — and neither half means anything without the other.
  const { calls, status, stdout } = runAnalyze(['--target=-weird']);
  assert.equal(status, 0, `a resolvable option-shaped target must be analysed: ${stdout.slice(0, 200)}`);
  assert.match(stdout, /"status": "analysis"/, 'and produce a plan');
  assert.deepEqual(bareOccurrences(calls, '-weird'), [],
    `while no read is handed the bare value: ${JSON.stringify(calls)}`);
  assert.ok(calls.some((c) => c.includes('refs/heads/-weird')),
    `the reads must go through the resolved ref: ${JSON.stringify(calls)}`);
});

test('a <remote>/HEAD that was never fetched → is refused, not fetched as a branch called HEAD', () => {
  // `git clone` records `refs/remotes/origin/HEAD`; `git remote add` + `git fetch` does not. With it
  // absent the probe fails, the path decomposes literally, and `HEAD` becomes the branch name — so
  // the refspec asks the remote for `refs/heads/HEAD`. On the usual repository that fails with a
  // message about the wrong thing; on one that happens to carry such a branch it analyses history
  // nobody asked for. Neither is the remote's default branch, which is what the caller named.
  const { calls, status, stdout, stderr } = runAnalyze(['--target', 'origin/HEAD'], undefined,
    GIT_NO_REMOTE_HEAD);
  assert.equal(status, 1, 'an unresolved remote HEAD must be refused');
  assert.match(stdout || stderr, /remote set-head/,
    `and name the command that records it: ${(stdout || stderr).slice(0, 200)}`);
  assert.ok(!calls.some((c) => c[0] === 'fetch'),
    `no guessed refspec may be fetched: ${JSON.stringify(calls)}`);
});

test('a second remote configured to write the tracking path → is refused, not resolved by name', () => {
  // Ownership by name is only one of the two ways a remote can write a tracking ref. The other is
  // `remote.<name>.fetch`: with `+refs/heads/*:refs/remotes/origin/*` configured on `up`,
  // `git fetch up` writes `refs/remotes/origin/main`, so refreshing that ref from `origin` may
  // replace history `up` put there — the same wrong-repository plan the name-prefix ambiguity check
  // already refuses, arriving through a route that check cannot see.
  const { calls, status, stdout, stderr } = runAnalyze(['--target', 'origin/main'], undefined,
    GIT_SECOND_CLAIMANT);
  assert.equal(status, 1, 'two possible owners must be refused');
  const msg = stdout || stderr;
  assert.match(msg, /more than one configured remote/, `and say so: ${msg.slice(0, 200)}`);
  assert.match(msg, /\bup\b/, `naming the claimant the ref path does not show: ${msg.slice(0, 200)}`);
  assert.ok(!calls.some((c) => c[0] === 'fetch'), `and fetch nothing: ${JSON.stringify(calls)}`);
});

test('the ordinary config where a remote claims its own namespace → is one owner, not two', () => {
  // The negative control for the test above, and the one that decides whether the claimant scan is
  // usable at all: `remote.origin.fetch = +refs/heads/*:refs/remotes/origin/*` is what every clone
  // has, so origin is found by BOTH scans on every ordinary target. Without the dedup between them
  // this run reports two owners and refuses the default configuration of every repository there is.
  const { calls, status, stdout } = runAnalyze(['--target', 'origin/main']);
  assert.equal(status, 0, `the default configuration must still analyse: ${stdout.slice(0, 200)}`);
  assert.ok(calls.some((c) => c[0] === 'fetch'), `and still refresh: ${JSON.stringify(calls)}`);
});

// ── Round 28 ─────────────────────────────────────────────────────────────────────────────────

test('a tracking ref mapped from another branch → is refreshed from the configured source', () => {
  // `remote.origin.fetch = +refs/heads/main:refs/remotes/origin/stable` means `origin/stable` holds
  // the remote's `main` — that is what the ref *is*. Deriving the source from the destination's tail
  // instead fetches a different branch into it, so the plan describes history the caller never named
  // and the tracking ref is left holding it. Verified against real git: with that config, the run
  // left `origin/stable` at main's tip instead of overwriting it with the remote's own `stable`.
  const { calls, status, stdout } = runAnalyze(['--target', 'origin/stable'], undefined, GIT_NONIDENTITY);
  assert.equal(status, 0, `the configured mapping must analyse: ${stdout.slice(0, 200)}`);
  const fetch = calls.find((c) => c[0] === 'fetch');
  assert.ok(fetch, `it must still be refreshed: ${JSON.stringify(calls)}`);
  assert.equal(fetch[7], '+refs/heads/main:refs/remotes/origin/stable',
    `the source must be the configured one, not the destination's tail: ${JSON.stringify(fetch)}`);
  assert.deepEqual(unexpectedCalls(calls), [],
    `every call must still match a template: ${JSON.stringify(calls)}`);
});

test('a tracking ref two refspecs map from different sources → is refused, not picked', () => {
  // The tie the test above must not silently break. Two refspecs on one remote both write
  // `refs/remotes/origin/stable`, from `main` and from `other`; the ref does not say which it means,
  // and choosing either refreshes it from a branch the repository never designated.
  const { calls, status, stdout, stderr } = runAnalyze(['--target', 'origin/stable'], undefined,
    GIT_TWO_SOURCES);
  assert.equal(status, 1, 'an ambiguous source must be refused');
  assert.match(stdout || stderr, /more than one source/,
    `and say so: ${(stdout || stderr).slice(0, 200)}`);
  assert.ok(!calls.some((c) => c[0] === 'fetch'), `and fetch nothing: ${JSON.stringify(calls)}`);
});

test('a claimant cancelled by a negative refspec → is not counted as a second owner', () => {
  // A negative refspec has no destination, so a scan reading destinations alone cannot see it and
  // reports an owner that provably cannot write the ref. With `^refs/heads/main` configured on `up`,
  // `git fetch up` cannot update `refs/remotes/origin/main` — measured against real git, both
  // directions: the exclusion present analyses, the exclusion removed refuses.
  const { calls, status, stdout } = runAnalyze(['--target', 'origin/main'], undefined,
    GIT_EXCLUDED_CLAIMANT);
  assert.equal(status, 0, `an excluded claimant must not block: ${stdout.slice(0, 200)}`);
  assert.ok(calls.some((c) => c[0] === 'fetch'), `and the refresh must run: ${JSON.stringify(calls)}`);
});

test('a short negative refspec → does not cancel a claim git keeps, so the real source survives', () => {
  // git canonicalizes a positive source to its full form for negative matching but does not DWIM the
  // negative: `^main` excludes nothing, only `^refs/heads/main` does — measured for wildcard and
  // literal positives alike. The pre-fix code compared the raw (short) inverted source against the
  // raw negative, so `^main` matched `out=main` and dropped a mapping git keeps, then refreshed
  // `origin/stable` from the fabricated `refs/heads/stable` instead of the configured `main`.
  const kept = runAnalyze(['--target', 'origin/stable'], undefined, GIT_SHORT_NEGATIVE);
  assert.equal(kept.status, 0, `the surviving mapping must analyse: ${kept.stdout.slice(0, 200)}`);
  const keptFetch = kept.calls.find((c) => c[0] === 'fetch');
  assert.ok(keptFetch, `it must be refreshed: ${JSON.stringify(kept.calls)}`);
  assert.equal(keptFetch[7], '+main:refs/remotes/origin/stable',
    `the short negative must not cancel the mapping, so the source stays main: ${JSON.stringify(keptFetch)}`);
  // The authorization predicate must accept this short-source fetch the script legitimately builds:
  // demanding `+refs/` there would report the script's own call as unauthorized.
  assert.deepEqual(unexpectedCalls(kept.calls), [],
    `a short but legal fetch source must satisfy the template: ${JSON.stringify(kept.calls)}`);

  // Round 57. A full negative beside a SHORT source does not cancel the claim either — not because
  // git ignores it, but because nothing local knows which namespace the short name resolves to.
  // Measured 2026-08-22 against a remote holding tag `tagx` and no branch `tagx`, with
  // `tagx:refs/remotes/origin/stable` configured: `^refs/tags/tagx` cancels, `^refs/heads/tagx`
  // does NOT — git fetches the tag into `origin/stable`. The two spellings are indistinguishable
  // from here, and the errors are not symmetric: leaving the claim standing costs a refused refresh
  // (git applies the carried negative itself), while cancelling it wrongly fabricates
  // `refs/heads/stable` and refreshes the tracking ref from a different ref, silently.
  const shortSourceFullNeg = runAnalyze(['--target', 'origin/stable'], undefined, GIT_FULL_NEGATIVE);
  assert.equal(shortSourceFullNeg.status, 0,
    `the claim must still analyse: ${shortSourceFullNeg.stdout.slice(0, 200)}`);
  const shortSourceFetch = shortSourceFullNeg.calls.find((c) => c[0] === 'fetch');
  assert.ok(shortSourceFetch, `and refresh: ${JSON.stringify(shortSourceFullNeg.calls)}`);
  assert.equal(shortSourceFetch[7], '+main:refs/remotes/origin/stable',
    'a guessed qualification must not cancel a claim — the configured source survives and git '
    + `decides on its own command line: ${JSON.stringify(shortSourceFetch)}`);
  assert.ok(shortSourceFetch.includes('^refs/heads/main'),
    `and the negative travels with it, so git can refuse: ${JSON.stringify(shortSourceFetch)}`);

  // Negative control, and the row that keeps the change from being "negatives are ignored": a
  // source already spelled in full is a PROVEN match, and its negative still cancels the claim.
  // `GIT_EXCLUDED_CLAIMANT` inverts a wildcard positive to `refs/heads/main`, so the match is exact.
  const proven = runAnalyze(['--target', 'origin/main'], undefined, GIT_EXCLUDED_CLAIMANT);
  assert.equal(proven.status, 0, `a proven exclusion must still analyse: ${proven.stdout.slice(0, 200)}`);
  assert.ok(proven.calls.some((c) => c[0] === 'fetch'),
    `and not be reported as a second owner: ${JSON.stringify(proven.calls)}`);
});

test("the explicit refresh → carries the fetched remote's configured negative refspecs, and only its own", () => {
  // A refspec given on the command line does NOT inherit the remote's configured negatives, so this
  // script's own fetch could write a ref the repository configured itself not to have. The fix is
  // to hand git the negatives; git then does its own matching, which is what makes the claim scan's
  // `refs/heads/<x>` qualification a guess that costs a refused refresh instead of a wrong write.
  const { calls, status, stdout } = runAnalyze(['--target', 'origin/stable'], undefined,
    GIT_TAG_SOURCE_NEGATIVE);
  assert.equal(status, 0, `the configured mapping must still analyse: ${stdout.slice(0, 200)}`);
  const fetch = calls.find((c) => c[0] === 'fetch');
  assert.ok(fetch, `it must be refreshed: ${JSON.stringify(calls)}`);
  assert.equal(fetch[7], '+tagx:refs/remotes/origin/stable',
    `the positive must stay the configured mapping: ${JSON.stringify(fetch)}`);
  assert.deepEqual(fetch.slice(8), ['^refs/tags/tagx'],
    "origin's own negative must travel, and up's must not — a negative belonging to another remote "
    + `would subtract from a fetch it does not govern: ${JSON.stringify(fetch)}`);
  assert.deepEqual(unexpectedCalls(calls), [],
    `the trailing negative must satisfy the authorization template: ${JSON.stringify(calls)}`);

  // Negative control: a remote with no negatives configured must gain no trailing argument. Without
  // it the assertion above is satisfied by a script that appends something unconditionally.
  const plain = runAnalyze(['--target', 'origin/stable'], undefined, GIT_NONIDENTITY);
  const plainFetch = plain.calls.find((c) => c[0] === 'fetch');
  assert.deepEqual(plainFetch.slice(8), [],
    `no configured negative means no trailing argument: ${JSON.stringify(plainFetch)}`);
});

test('the explicit refresh when its negatives are deleted → the guard turns red', () => {
  // Deletion mutant, because the assertions above are satisfied by any script that happens to emit
  // the right argv once. This proves they are attributable to the expansion that puts it there.
  const source = readFileSync(scriptPath, 'utf8');
  const EXPANSION = ' ${NEG_REFSPECS[@]+"${NEG_REFSPECS[@]}"} 2>/dev/null; then';
  const mutant = source.replace(EXPANSION, ' 2>/dev/null; then');
  assert.notEqual(mutant, source,
    'MUTANT APPLIED: the negative-refspec expansion must exist on the fetch line to be deleted — '
    + 'an unapplied substitution looks exactly like a surviving guard');

  const undefended = runAnalyze(['--target', 'origin/stable'], mutant, GIT_TAG_SOURCE_NEGATIVE);
  const fetch = undefended.calls.find((c) => c[0] === 'fetch');
  assert.ok(fetch, `the mutant must still reach the fetch: ${JSON.stringify(undefended.calls)}`);
  assert.deepEqual(fetch.slice(8), [],
    `without the expansion the negative is dropped — this is the state the fix closed: ${JSON.stringify(fetch)}`);

  // And the unmutated script on the same fixture carries it, so the difference is the expansion and
  // nothing about the fixture or the harness.
  const defended = runAnalyze(['--target', 'origin/stable'], source, GIT_TAG_SOURCE_NEGATIVE);
  assert.deepEqual(defended.calls.find((c) => c[0] === 'fetch').slice(8), ['^refs/tags/tagx'],
    'the shipped script must carry it on the identical fixture');
});

test('an unpaired wildcard refspec → is refused, not read as a mapping git itself rejects', () => {
  // **The inverter accepted a broader grammar than git does, and the extra grammar was permission to
  // pick another branch.** With `+refs/heads/main:refs/remotes/origin/*` configured, the wildcard
  // destination matches every `origin/<x>`, and taking the literal source built
  // `+refs/heads/main:refs/remotes/origin/victim` — the caller named `origin/victim`, the script
  // refreshed it from `main` and planned against that. Measured against real git: the configured
  // refspec is `fatal: invalid refspec`, so it maps nothing and there is nothing to invert.
  const { calls, status, stdout, stderr } = runAnalyze(['--target', 'origin/victim'], undefined,
    GIT_UNPAIRED_WILDCARD);
  assert.notEqual(status, 0, `a refspec git rejects must not become a mapping: ${stdout.slice(0, 200)}`);
  const fetch = calls.find((c) => c[0] === 'fetch');
  assert.ok(!fetch || fetch[7] !== '+refs/heads/main:refs/remotes/origin/victim',
    `the literal source must never be substituted for the named destination: ${JSON.stringify(calls)}`);
  assert.match(stdout || stderr, /refspec|invert|source/i,
    `and the refusal must say why: ${(stdout || stderr).slice(0, 200)}`);
});

test('a configured short source that is option-shaped → is validated by its full ref form, not refused', () => {
  // **Round 30 added support for short configured sources; the validator then rejected the legal
  // ones that begin with a dash.** `check-ref-format` honours neither `--` nor `--end-of-options`
  // (measured: `--end-of-options main` exits 129 as well), so a bare `-evil` cannot be checked as an
  // operand at all — the only spelling git will judge is `refs/heads/-evil`, which it accepts
  // (exit 0). So the prefix is applied to the CHECK.
  const { calls, status, stdout } = runAnalyze(['--target', 'origin/stable'], undefined,
    GIT_DASH_SHORT_SOURCE);
  assert.equal(status, 0, `a legal option-shaped short source must analyse: ${stdout.slice(0, 200)}`);
  const fetch = calls.find((c) => c[0] === 'fetch');
  assert.ok(fetch, `it must be refreshed: ${JSON.stringify(calls)}`);
  // **And the refspec keeps the CONFIGURED spelling, which is the half a qualify-and-emit fix gets
  // wrong.** git resolves a short source across the remote's whole ref namespace, so a tag is a
  // legal source; rewriting it to `refs/heads/-evil` would narrow a mapping the repository
  // configured — fabricating a source, the very defect the inversion logic exists to prevent.
  assert.equal(fetch[7], '+-evil:refs/remotes/origin/stable',
    `the configured source must survive verbatim, not be re-spelled: ${JSON.stringify(fetch)}`);
  // The check must still be a check, and it must never be handed the bare dash-name git reads as an
  // option — the qualified form is what reaches it.
  const checks = calls.filter((c) => c[0] === 'check-ref-format');
  assert.ok(checks.some((c) => c.includes('refs/heads/-evil')),
    `the name must be validated in the spelling git will judge: ${JSON.stringify(checks)}`);
  assert.ok(!checks.some((c) => c.includes('-evil') && !c.includes('refs/heads/-evil')),
    `the bare option-shaped name must never be an argument: ${JSON.stringify(checks)}`);
  assert.deepEqual(unexpectedCalls(calls), [],
    `every call must still match a template: ${JSON.stringify(calls)}`);
});

test('the unresolved-HEAD recovery command → is emitted only where git would run it', () => {
  // `git remote set-head` has no `--end-of-options`, and no `--` placement makes a dash-named remote
  // an operand — every ordering measured exits 129. So for the remote spelling this script goes out
  // of its way to support, the recovery line would be a command git refuses. A pasteable line that
  // cannot run is the § 1.5 failure wearing its other face: quoted correctly, still unusable.
  const ordinary = runAnalyze(['--target', 'origin/HEAD'], undefined, GIT_NO_REMOTE_HEAD);
  assert.equal(ordinary.status, 1, 'an unresolved remote HEAD must be refused');
  assert.match(ordinary.stdout || ordinary.stderr, /remote set-head/,
    'and an ordinary remote gets the command that records it');

  const dashed = runAnalyze(['--target=-evil/HEAD'], undefined, GIT_NO_REMOTE_HEAD);
  assert.equal(dashed.status, 1, 'the dash-named remote must be refused the same way');
  const msg = dashed.stdout || dashed.stderr;
  assert.ok(!/set-head/.test(msg), `but must not be handed a command git rejects: ${msg.slice(0, 250)}`);
  assert.match(msg, /--target with the branch name/,
    `it keeps the advice that does work: ${msg.slice(0, 250)}`);
});

test('the Step 5 ambiguity guard when rendered and run → passes a unique branch, refuses a collision', () => {
  // **A behavioural test, because the textual one could not have caught what this did.** The guard
  // as first written nested the quoted slot inside fixed quotes — `"refs/heads/<quoted branch>"` —
  // and § Names in commands says that slot brings its own quotes. Rendered with the ordinary
  // operand `'main'` that yields the pattern `"refs/heads/'main'"`, whose single quotes are literal
  // ref-name characters. Measured: it matches **0** refs, so the guard refused every legitimate
  // rebase while reading, in the document, exactly like a guard that works.
  //
  // Both directions in one test, per @rules/testing.md § Guards: the collision that must be
  // refused, AND the ordinary branch that must pass. A one-directional version of this guard is
  // what shipped, and it was green on inspection.
  const block = skill.match(/branch=<quoted branch>\n(?:.*\n)*?\[\[ "\$ok" -eq 1 \]\][^\n]*\n/);
  assert.ok(block, 'the Step 5 guard block must still be findable by its variable binding');

  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-ambig-'));
  const git = (...args) => spawnSync(REAL_GIT, ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    assert.ok(REAL_GIT, 'precondition: a real git is needed — the claim is about what git matches');
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'commit.gpgSign', 'false');
    git('config', 'user.name', 'Test');
    git('commit', '-q', '--allow-empty', '-m', 'first');
    const first = git('rev-parse', 'HEAD').stdout.trim();
    git('commit', '-q', '--allow-empty', '-m', 'second');
    const second = git('rev-parse', 'HEAD').stdout.trim();

    git('branch', 'uniq', second);   // named explicitly — `init.defaultBranch` varies
    git('branch', 'dup', second);
    git('tag', 'dup', second);
    git('branch', 'FETCH_HEAD', second);
    git('branch', 'config', second); // a legal branch name whose `.git/<name>` always exists
    // A legal branch whose name is also the head of an unrelated custom ref namespace. This is not
    // contrived: the repository this skill lives in carries `refs/codex/turn-diffs/…`, so a branch
    // named `codex` here would have been refused. `git branch` will not create the namespace, and
    // `update-ref` is how such refs actually arrive.
    git('branch', 'codex', second);
    git('update-ref', 'refs/codex/turn-diffs/x', second);
    // Fixture assertions — the setup must actually be adversarial, or the case below proves nothing.
    assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/codex').stdout.trim().split('\n').length, 1,
      'fixture: the pattern form must match the unrelated subtree, or there is no false refusal to catch');
    assert.notEqual(git('show-ref', '--verify', '--quiet', 'refs/codex').status, 0,
      'fixture: no exact `refs/codex` may exist — the whole point is that only the prefix matches');
    // A real fetch writes this file. It must name a DIFFERENT commit from the branch, or the
    // resolution check passes for the wrong reason and the fixture proves nothing — the same
    // way an unapplied mutation looks exactly like a surviving test.
    writeFileSync(join(dir, '.git', 'FETCH_HEAD'), `${first}\n`);
    assert.notEqual(first, second, 'fixture: the two commits must differ');
    assert.equal(git('rev-parse', '--verify', '--quiet', 'FETCH_HEAD').stdout.trim(), first,
      'fixture: git must resolve the short name to the pseudo-ref, not to refs/heads/FETCH_HEAD — '
      + 'if this ever reads `second`, the pseudo-ref case below is testing nothing');

    // Render the documented slot the way the skill's own convention produces it: shell-quoted.
    const render = (name) => block[0].replace('<quoted branch>', `'${name}'`);
    const run = (name) => spawnSync('/bin/bash', ['-c', render(name)], { cwd: dir, encoding: 'utf8' });

    // **Assert the status, not only the text.** A block that prints ⛔ and then exits 0 reads as
    // a refusal to a human and as "clear to proceed" to anything consuming `$?` — a wrapper, an
    // `&&` chain, a paste into a runner. The first version of this test checked stdout alone, so
    // the fail-open survived the very control that was supposed to catch it.
    const unique = run('uniq');
    assert.equal(unique.stdout.trim(), '',
      'an ordinary unique branch must reach the rebase step — this is the direction the nested-quote bug broke');
    assert.equal(unique.status, 0, 'and it must exit 0, or every caller reads a refusal that never happened');

    const collision = run('dup');
    assert.match(collision.stdout, /⛔ short name matches 2 refs/,
      'a branch and a tag of the same name is the collision the guard exists for');
    assert.notEqual(collision.status, 0, 'a refusal must be a nonzero exit, not merely a printed warning');

    const missing = run('definitely-no-such-branch-r20');
    assert.match(missing.stdout, /⛔ not a branch/, 'a name that is no branch at all must be refused');
    assert.notEqual(missing.status, 0, 'and refused by status — the line above says "not a branch"');

    // The ref count cannot see a pseudo-ref: `for-each-ref` iterates the ref store, and git
    // resolves `$GIT_DIR/<name>` first. Counting alone reports 1 and reads as "unique".
    const pseudo = run('FETCH_HEAD');
    assert.doesNotMatch(pseudo.stdout, /matches \d+ refs/,
      'the count must report this name as unique — that is precisely why the third check exists');
    assert.match(pseudo.stdout, /⛔ short name resolves to/,
      'a branch shadowed by a pseudo-ref is a collision the count structurally cannot see');

    // Negative control for the third check. Deleting it must turn a test red, and deleting the
    // over-refusing alternative (testing whether `$(git rev-parse --git-path "$branch")` exists)
    // must too: `.git/config` exists in every repository, so that alternative refuses this branch.
    const ordinary = run('config');
    assert.equal(ordinary.stdout.trim(), '',
      'a legal branch named `config` must pass — a guard that refuses it is the round-17 failure again');
    assert.equal(ordinary.status, 0, 'and pass by status too');

    // Negative control for the exact-ref counting. `for-each-ref <pattern>` matches a refname
    // PREFIX at a path boundary, so the pattern `refs/codex` matches `refs/codex/turn-diffs/x`
    // and the branch counts 2 — refused. Five `show-ref --verify` checks count 1 and proceed.
    // Restore the pattern form and this case turns red; every other case stays green, which is
    // what makes this the control rather than a duplicate of them.
    const namespaced = run('codex');
    assert.equal(namespaced.stdout.trim(), '',
      'a legal branch sharing its name with an unrelated ref namespace must pass — the pattern form refused it');
    assert.equal(namespaced.status, 0, 'and pass by status too');

    const pseudoStatus = run('FETCH_HEAD').status;
    assert.notEqual(pseudoStatus, 0, 'the pseudo-ref refusal must also be a nonzero exit');

    // **Same OID is the case the OID comparison structurally cannot see.** Point the pseudo-ref
    // at the branch's own commit and the third check's operands become equal — count 1, `$short`
    // = `$head` — so it clears an operand that still denotes the pseudo-ref, which a later fetch
    // moves out from under the rebase. Measured in a scratch repo before the fourth check
    // existed: count=1, OIDs equal, guard PASSES, while git itself calls the name ambiguous.
    writeFileSync(join(dir, '.git', 'FETCH_HEAD'), `${second}\n`);
    assert.equal(git('rev-parse', '--verify', '--quiet', 'FETCH_HEAD').stdout.trim(), second,
      'fixture: the pseudo-ref must now share the branch OID, or this is the previous case again');
    const sameOid = run('FETCH_HEAD');
    assert.doesNotMatch(sameOid.stdout, /short name resolves to/,
      'fixture: the OID check must be SATISFIED here — otherwise the symbolic check is never exercised');
    assert.match(sameOid.stdout, /⛔ short name denotes/,
      'only the symbolic check can refuse a same-OID pseudo-ref shadow');
    assert.notEqual(sameOid.status, 0, 'and it must refuse by status, not merely print');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--base when the short name is ambiguous → refused, while revision expressions still resolve', () => {
  // `--base` is deliberately exempt from the name-shape check (ref-name-hardening
  // 4-implementation.md § 1.1) because `HEAD~3` and `:/.` are legitimate there. That reason
  // covers SHAPE, not AMBIGUITY: the resolution discards stderr, so a base naming both a tag
  // and a branch silently picks one and the plan is computed from the wrong cut point. The
  // check therefore turns on RESOLUTION — an expression matches none of the five exact refs
  // and never reaches the refusal — which is exactly what the last two cases here pin.
  assert.ok(REAL_GIT, 'precondition: a real git is needed — the claim is about what git resolves');
  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-base-'));
  const git = (...args) => spawnSync(REAL_GIT, ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'commit.gpgSign', 'false');
    git('config', 'user.name', 'Test');
    git('commit', '-q', '--allow-empty', '-m', 'root');
    git('commit', '-q', '--allow-empty', '-m', 'target tip');
    // The `--base` block sits inside Mode 1, which is downstream of target resolution AND of the
    // up-to-date short-circuit. So the fixture needs a real target ref (`origin/main` aborts the
    // script long before the block under test) and a current branch genuinely ahead of it —
    // otherwise every assertion below passes or fails for a reason that has nothing to do with
    // ambiguity. Read the branch git created rather than assuming `main` or `master`.
    const target = git('branch', '--show-current').stdout.trim();
    assert.ok(target, 'fixture: the scratch repo must be on a named branch');
    git('checkout', '-q', '-b', 'feat');
    git('commit', '-q', '--allow-empty', '-m', 'feat one');
    const cut = git('rev-parse', 'HEAD').stdout.trim();
    git('commit', '-q', '--allow-empty', '-m', 'feat two');
    // Every base below denotes the SAME commit, and it is a commit the plan can actually cut at.
    // That is what makes the four cases differ in exactly one variable — how the name resolves.
    git('branch', 'shared', cut);
    git('tag', 'shared', cut);            // the collision
    git('branch', 'settled', cut);        // the same words, unambiguous
    assert.equal(git('show-ref', '--verify', '--quiet', 'refs/tags/shared').status, 0,
      'fixture: the tag must exist, or there is no ambiguity to catch');

    const analyze = (base) => spawnSync('/bin/bash',
      [scriptPath, '--target', target, '--base', base], { cwd: dir, encoding: 'utf8' });

    const ambiguous = analyze('shared');
    assert.match(ambiguous.stdout, /is ambiguous \(2 exact refs\)/,
      'a base naming both a tag and a branch must be refused, not silently resolved to one');
    assert.notEqual(ambiguous.status, 0, 'and refused by status');

    // The negative controls assert `status: ready`, not merely the absence of the ambiguity
    // message: a base rejected for some OTHER reason also lacks that message, so a `doesNotMatch`
    // alone would stay green on a guard that had broken every base in the repository.
    assert.match(analyze('settled').stdout, /"status": "ready"/,
      'an unambiguous branch base must plan normally — the check must catch collisions, not names');
    // The exemption this check must not undo (ref-name-hardening § 1.1): a revision expression and
    // a raw commit id match none of the five exact refs, so the refusal is unreachable for them.
    for (const expr of ['HEAD~1', cut]) {
      assert.match(analyze(expr).stdout, /"status": "ready"/,
        `a revision expression (${expr}) must stay legal — check-ref-format was rejected for this reason`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--target when the short name is ambiguous → refused, and the un-guarded script plans against the tag', () => {
  // `--base` got this guard first; `--target` did not, and the asymmetry was the defect. The probe
  // `--target` relies on cannot report ambiguity: measured here rather than asserted, because the
  // reason it cannot is unintuitive — git exits 0 and prints nothing, so the caller's spelling
  // survives to `TARGET_REF` and git resolves it to the TAG.
  assert.ok(REAL_GIT, 'precondition: a real git is needed — the claim is about what git resolves');
  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-target-'));
  const git = (...args) => spawnSync(REAL_GIT, ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'commit.gpgSign', 'false');
    git('config', 'user.name', 'Test');
    git('commit', '-q', '--allow-empty', '-m', 'root');
    const branchTip = git('rev-parse', 'HEAD').stdout.trim();
    git('commit', '-q', '--allow-empty', '-m', 'second');
    const tagTip = git('rev-parse', 'HEAD').stdout.trim();
    git('branch', 'shared', branchTip);
    git('tag', 'shared', tagTip);           // the collision, and the two point at DIFFERENT commits
    git('branch', 'settled', branchTip);    // the same words, unambiguous
    git('checkout', '-q', '-b', 'feat');
    git('commit', '-q', '--allow-empty', '-m', 'feat one');
    assert.notEqual(branchTip, tagTip,
      'fixture: branch and tag must differ, or "resolved to the wrong one" is unobservable');

    // The measurement the guard is built on, asserted so a future git that changes either half
    // fails here rather than silently making the guard pointless.
    const probe = git('rev-parse', '--verify', '--symbolic-full-name', '--end-of-options', 'shared');
    assert.equal(probe.status, 0, 'git exits 0 on an ambiguous name — this is why a `||` cannot catch it');
    assert.equal(probe.stdout.trim(), '', 'and prints nothing, so the caller spelling survives');
    assert.equal(git('rev-parse', '--short', 'shared').stdout.trim(),
      git('rev-parse', '--short', 'refs/tags/shared').stdout.trim(),
      'and the bare name resolves to the TAG — the commit the caller did not mean');

    const analyze = (target, script = scriptPath) => spawnSync('/bin/bash',
      [script, '--target', target], { cwd: dir, encoding: 'utf8' });

    const ambiguous = analyze('shared');
    assert.match(ambiguous.stdout, /--target shared is ambiguous \(2 exact refs\)/,
      'a target naming both a tag and a branch must be refused, not silently resolved to one');
    assert.notEqual(ambiguous.status, 0, 'and refused by status');

    // Negative control 1: the guard must catch collisions, not names.
    assert.match(analyze('settled').stdout, /"status":/,
      'an unambiguous branch target must still be analysed');
    assert.doesNotMatch(analyze('settled').stdout, /is ambiguous/,
      'and must not be reported as ambiguous');

    // Negative control 2: a name matching NO exact ref must fail as not-found, never as ambiguous —
    // this is the boundary that keeps a never-fetched remote-tracking ref analysable.
    assert.doesNotMatch(analyze('no-such-ref-anywhere').stdout, /is ambiguous/,
      'a name matching no exact ref must not reach the ambiguity refusal');

    // Negative control 3: without the guard the script accepts it. A harness that cannot produce
    // the defect cannot witness its absence either.
    const src = readFileSync(scriptPath, 'utf8');
    const spliced = src.replace(/\ntarget_exact=0\n[\s\S]*?\n  exit 1\nfi\n/, '\n');
    assert.ok(!spliced.includes('--target $TARGET is ambiguous'),
      'the splice must actually remove the guard — an unapplied mutation looks exactly like a fix');
    const unguarded = join(dir, 'unguarded-analyze.sh');
    writeFileSync(unguarded, spliced);
    assert.doesNotMatch(analyze('shared', unguarded).stdout, /is ambiguous/,
      'precondition: the un-guarded script does not refuse — so the refusal above is the guard');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the Step 1 negative-refspec gate when rendered and run → reports a hit, a clean read, and a failed read distinctly', () => {
  // The gate as first written was `git config --get-all … | grep -q '^\^' && echo …`, and a
  // pipeline exits with its LAST command's status. Measured on git 2.55.0: a fatal `git config`
  // exits 128, but piped into `grep -q` the pipeline exits 1 — the identical status a valid
  // configuration with no negative refspec produces. The prose then told the reader "the defect
  // cannot fire here" on the strength of a read that never happened.
  //
  // Three outcomes must stay distinguishable, and the third is the one the pipeline collapsed.
  // Since the first version of this test, two more properties are asserted, both of which it
  // was blind to: the block must BIND `remote` itself (the earlier test injected `remote=origin`
  // ahead of the fence, which is exactly what hid the unbound variable — a test that supplies the
  // missing piece cannot notice that it is missing), and the exit status must be the verdict.
  const block = skill.match(/remote=<quoted remote>[\s\S]*?\nfi\n\[\[[^\n]*\]\][^\n]*\n/);
  assert.ok(block, 'the Step 1 gate must bind `remote` itself, and end at the `[[ ]]` that IS its verdict');
  assert.doesNotMatch(block[0], /^\s*(true|false)\s*(#|$)/m,
    'round 61: the status must not be delegated to `true`/`false` — both are builtins an imported '
    + 'function outranks, measured returning 7 under BASH_FUNC_true%%/BASH_FUNC_false%%');
  assert.doesNotMatch(skill, /git config --get-all "remote\.\$\{remote\}\.fetch" \| grep/,
    'negative control: restoring the status-discarding pipeline must turn this test red');

  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-refspec-'));
  const git = (...args) => spawnSync(REAL_GIT, ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    assert.ok(REAL_GIT, 'precondition: a real git is needed — the claim is about git exit codes');
    git('init', '-q');
    // Render the slot the way the skill's convention produces it; nothing is prepended.
    const rendered = block[0].replace('<quoted remote>', "'origin'");
    const run = (env) => spawnSync('/bin/bash', ['-c', rendered],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });

    const absent = run({});
    assert.equal(absent.stderr.trim(), '',
      'an unset remote.origin.fetch is git exit 1 — a real answer meaning "no negative refspec", not a failure');
    assert.equal(absent.status, 0, 'and it must exit 0: Step 1 may proceed');

    git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    const clean = run({});
    assert.equal(clean.stderr.trim(), '', 'an ordinary fetch refspec must let Step 1 proceed');
    assert.equal(clean.status, 0,
      'the ONE case that may proceed must be the ONE that exits 0 — the first version had this inverted');

    // Round 60: a negative that cancels ONE prefix leaves the rest reachable, so the gate labels
    // it and lets Step 1 through. Refusing here stopped runs that would have worked.
    git('config', '--add', 'remote.origin.fetch', '^refs/heads/wip/*');
    const hit = run({});
    assert.match(hit.stderr, /NEGATIVE REFSPEC CONFIGURED/,
      'a configured negative refspec is the condition the gate exists to name');
    assert.match(hit.stderr, /⚠️/, 'and it is a warning, not a refusal — the gate cannot see the outcome');
    assert.equal(hit.status, 0,
      'an irrelevant negative must reach the analyzer: the gate reads the spelling, not the intersection');

    // GIT_CONFIG_COUNT=1 with no GIT_CONFIG_KEY_0 makes git fatal while parsing command-line
    // config — a read failure reached before any value is produced.
    const broken = run({ GIT_CONFIG_COUNT: '1' });
    assert.match(broken.stderr, /⛔ cannot read remote\.origin\.fetch \(git exited 128\)/,
      'a configuration that cannot be read must refuse, never read as a clean no-hit');
    assert.doesNotMatch(broken.stderr, /NEGATIVE REFSPEC CONFIGURED/,
      'and it must not claim a hit either — the answer is unknown, not either value');
    assert.notEqual(broken.status, 0, 'an unknown answer refuses, so it too must be nonzero');

    // Round 61. The gate's whole contract is its exit status, and until this round that status came
    // out of a `true` / `false` terminator — both builtins, both outranked by a function bash
    // imports from the environment. Measured on bash 3.2 / git 2.55.0: under
    // `BASH_FUNC_false%%=() { return 0; }` the refusing path reported success, and the same holds
    // for `[` and for `exit`. `[[` is a KEYWORD, resolved by the parser before any name lookup, so
    // it is the one form here that cannot be replaced — and the assertions below are run under the
    // shadows rather than reasoned about.
    for (const [why, shadow] of [
      ['the test builtin', { 'BASH_FUNC_[%%': '() { return 1; }' }],
      ['the false builtin', { 'BASH_FUNC_false%%': '() { return 0; }' }],
      ['the true builtin', { 'BASH_FUNC_true%%': '() { return 1; }' }],
    ]) {
      const shadowed = run({ GIT_CONFIG_COUNT: '1', ...shadow });
      assert.notEqual(shadowed.status, 0,
        `an unreadable configuration must still refuse when ${why} is shadowed`);
      // Both directions in the same loop: a fence that refused unconditionally would satisfy every
      // line above while breaking every ordinary run, which is the failure round 60 produced once.
      const shadowedClean = run(shadow);
      assert.equal(shadowedClean.status, 0,
        `and a readable configuration must still proceed when ${why} is shadowed`);
    }

    // Round 62: the residue, pinned. The three shadows above cannot invert the verdict because the
    // last line is a keyword — but the verdict's INPUT is a bare `git`, a command word like any
    // other. Under a shadowed `git` an unreadable configuration reports rc=0 and this fence exits
    // 0. That is asserted here rather than left implicit, because the wording it replaced ("the
    // status is the part that cannot be forged") claimed more than the keyword delivers, and an
    // unpinned residue is exactly the kind of claim that grows back. There is no fix at this layer:
    // the push fences discard function imports by re-executing under `bash -p`, and a markdown
    // fence run in the operator's own shell cannot ask for `-p`.
    const forgedGit = run({ GIT_CONFIG_COUNT: '1', 'BASH_FUNC_git%%': '() { return 0; }' });
    assert.equal(forgedGit.status, 0,
      'documented residue: a shadowed `git` forges the read this gate reports on. If this ever '
      + 'starts failing, the gate gained a stronger input — say so in the prose before changing '
      + 'this line, because the prose currently promises only that the VERDICT FORM cannot be '
      + 'inverted, never that the reading behind it cannot');
    // And the control that keeps the line above meaningful: the same shadow, on the path that was
    // already going to exit 0, proves the assertion is about the forged read and not about the
    // shadow simply breaking the fence into silence.
    assert.equal(run({ 'BASH_FUNC_git%%': '() { return 0; }' }).status, 0,
      'precondition: a readable configuration under the same shadow also exits 0');

    // And the case the gate USED to refuse for: a negative that cancels every positive. The
    // refusal is real — it is just not this block's to make. Measured against a real remote.
    const remote = mkdtempSync(join(tmpdir(), 'smart-rebase-remote-'));
    try {
      spawnSync(REAL_GIT, ['init', '-q', '--bare', remote]);
      const work = mkdtempSync(join(tmpdir(), 'smart-rebase-work-'));
      const wgit = (...a) => spawnSync(REAL_GIT, ['-C', work, ...a], { encoding: 'utf8' });
      wgit('init', '-q');
      wgit('config', 'user.email', 'harness@example.invalid');
      wgit('config', 'user.name', 'harness');
      writeFileSync(join(work, 'f'), 'x\n');
      wgit('add', 'f');
      wgit('commit', '-qm', 'seed');
      wgit('push', '-q', remote, 'HEAD:refs/heads/main');

      git('remote', 'add', 'cancelled', remote);
      git('config', 'remote.cancelled.fetch', '+refs/heads/*:refs/remotes/cancelled/*');
      git('config', '--add', 'remote.cancelled.fetch', '^refs/heads/*');

      const gate = spawnSync('/bin/bash', ['-c', block[0].replace('<quoted remote>', "'cancelled'")],
        { cwd: dir, encoding: 'utf8' });
      assert.match(gate.stderr, /NEGATIVE REFSPEC CONFIGURED/, 'the label still fires on this one');
      assert.equal(gate.status, 0,
        'and the gate still lets it through — predicting the empty transfer is not its job');

      spawnSync(REAL_GIT, ['-C', dir, 'fetch', 'cancelled'], { encoding: 'utf8' });
      const tracking = spawnSync(REAL_GIT,
        ['-C', dir, 'for-each-ref', '--format=%(refname)', 'refs/remotes/cancelled/'],
        { encoding: 'utf8' }).stdout.trim();
      assert.equal(tracking, '',
        'the transfer really is empty when every positive is cancelled — so the analyzer, which '
        + 'performs the refresh, is where that run stops, and it stops on evidence rather than on '
        + 'this block\'s guess');

      // Positive control on the same remote: drop the cancelling negative and the refresh lands.
      // Without it, "no tracking refs" could mean the harness never fetched anything at all.
      git('config', '--unset', 'remote.cancelled.fetch', '\\^refs/heads/\\*');
      spawnSync(REAL_GIT, ['-C', dir, 'fetch', 'cancelled'], { encoding: 'utf8' });
      const after = spawnSync(REAL_GIT,
        ['-C', dir, 'for-each-ref', '--format=%(refname)', 'refs/remotes/cancelled/'],
        { encoding: 'utf8' }).stdout.trim();
      assert.match(after, /refs\/remotes\/cancelled\/main/,
        'precondition: the same remote transfers a ref once nothing cancels it');
      rmSync(work, { recursive: true, force: true });
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-37: an empty joined value is not a value ────────────────────────────

test('--base= with the empty-value guard removed → the un-guarded script silently plans in auto-detect mode', () => {
  // The negative control. Without it, "refused" above could mean the harness never reached the
  // parser at all — and the defect being pinned is a SILENT substitution, which is exactly the
  // shape that reads as a pass.
  const src = readFileSync(scriptPath, 'utf8');
  const GUARD = '    --target=|--base=)\n';
  assert.ok(src.includes(GUARD),
    'precondition: the shipped script refuses an empty joined value — if this fails the fix was '
    + 'reverted and the mutation below would be a no-op');

  const spliced = src.replace(
    /\n    # Ordered before the two patterns below[\s\S]*?\n      exit 1 ;;\n(?=    --target=\*\))/, '\n');
  assert.ok(!spliced.includes(GUARD),
    'the mutation must actually remove the guard — an unapplied mutation looks exactly like a fix');

  const removed = runAnalyze(['--base='], spliced);
  assert.equal(removed.status, 0,
    `un-guarded, an empty --base= is accepted; got status ${removed.status}: ${removed.stderr}`);
  assert.match(removed.stdout, /"mode": "auto-detect"/,
    'and it silently becomes auto-detect — a different merge-base than the caller named');

  // The negative control's other half: the same option carrying ordinary data must still pass on
  // the shipped script, or the guard would be refusing the spelling rather than the empty value.
  const ordinary = runAnalyze(['--base=main']);
  assert.notEqual(ordinary.status, undefined, 'the shipped script ran');
  assert.ok(!/requires a value/.test(ordinary.stderr),
    `--base=main must not be caught by the empty-value guard; stderr: ${ordinary.stderr}`);
});

test("--base '' with the separated-form empty guard removed → the un-guarded script silently plans in auto-detect mode", () => {
  // The second negative control, and the reason there are two: the joined form and the separated
  // form are separate code paths, so a control over one says nothing about the other. Round 38
  // found exactly that — the joined guard landed, the separated spelling stayed open.
  const src = readFileSync(scriptPath, 'utf8');
  const GUARD = '      if [ -z "$2" ]; then\n';
  assert.ok(src.includes(GUARD),
    'precondition: the shipped script refuses an empty separated value — if this fails the fix was '
    + 'reverted and the mutation below would be a no-op');

  const spliced = src.replace(
    /\n      # An empty argument IS supplied[\s\S]*?\n      fi\n(?=      if \[ "\$1" = "--target" \])/, '\n');
  assert.ok(!spliced.includes(GUARD),
    'the mutation must actually remove the guard — an unapplied mutation looks exactly like a fix');

  const removed = runAnalyze(['--base', ''], spliced);
  assert.equal(removed.status, 0,
    `un-guarded, an empty separated --base is accepted; got status ${removed.status}: ${removed.stderr}`);
  assert.match(removed.stdout, /"mode": "auto-detect"/,
    'and it silently becomes auto-detect — a different merge-base than the caller named');

  // Negative control's other half: ordinary data through the same spelling must still pass.
  const ordinary = runAnalyze(['--base', 'main']);
  assert.ok(!/requires a value/.test(ordinary.stderr),
    `--base main must not be caught by the empty-value guard; stderr: ${ordinary.stderr}`);
});

// ── round-62: the gate under `set -e` ────────────────────────────────────────

// The gate's whole design is that git's exit 1 ("the key is not set") is a real answer and only
// something else is a failure. `refspecs=$(…); rc=$?` cannot deliver that under `set -e`: an
// assignment whose command substitution fails carries that status itself, so the shell aborts
// before `rc` is ever read and the three carefully separated outcomes collapse into one silent
// exit. Putting the command in an `if` condition is what exempts it — that is the only reason the
// shape is written the way it is, so it is asserted by running it, not by reading it.
test('the Step 1 gate under `set -e` → an unset refspec is still an answer, not an abort', () => {
  const skill = readFileSync(skillPath, "utf8");
  const block = skill.match(/remote=<quoted remote>[\s\S]*?\nfi\n\[\[[^\n]*\]\][^\n]*\n/);
  assert.ok(block, 'the Step 1 gate must still be findable');
  assert.match(block[0], /if refspecs=\$\(git config --get-all[^\n]*\); then rc=0; else rc=\$\?; fi/,
    'the read must sit in an `if` condition — a bare assignment followed by `rc=$?` is what `set -e` '
    + 'aborts on, and the abort happens before the status this gate exists to classify is examined');

  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-seterr-'));
  const git = (...args) => spawnSync(REAL_GIT, ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    assert.ok(REAL_GIT, 'precondition: a real git is needed — the claim is about git exit codes');
    git('init', '-q');
    const rendered = block[0].replace('<quoted remote>', "'origin'");
    // `set -e` first, then the gate, then a marker: the marker is the evidence the caller's shell
    // was still alive to run the next step.
    const run = () => spawnSync('/bin/bash', ['-c', `set -e\n${rendered}echo REACHED_NEXT_STEP\n`],
      { cwd: dir, encoding: 'utf8' });

    const absent = run();
    assert.equal(absent.status, 0,
      'unset remote.origin.fetch under `set -e` must still be the proceed case');
    assert.match(absent.stdout, /REACHED_NEXT_STEP/,
      'and the caller must still be running afterwards — this is the line the bare assignment killed');
    assert.equal(absent.stderr.trim(), '', 'and it must not be reported as a failure to read');

    git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    const clean = run();
    assert.equal(clean.status, 0, 'an ordinary refspec under `set -e` proceeds too');
    assert.match(clean.stdout, /REACHED_NEXT_STEP/, 'and reaches the next step');

    // MUTANT APPLIED — the pre-fix shape, run under the same `set -e`, to show the difference is
    // real and not an artefact of the harness. Without it this test would pass on either form.
    const mutant = rendered.replace(
      /if refspecs=\$\(git config --get-all "remote\.\$\{remote\}\.fetch"\); then rc=0; else rc=\$\?; fi/,
      'refspecs=$(git config --get-all "remote.${remote}.fetch"); rc=$?',
    );
    assert.notEqual(mutant, rendered, 'MUTANT APPLIED: the fixture must actually restore the old shape');
    git('config', '--unset-all', 'remote.origin.fetch');
    const broken = spawnSync('/bin/bash', ['-c', `set -e\n${mutant}echo REACHED_NEXT_STEP\n`],
      { cwd: dir, encoding: 'utf8' });
    assert.equal(broken.status, 1,
      'precondition: the old shape exits 1 on the case the gate calls "proceed"');
    assert.doesNotMatch(broken.stdout, /REACHED_NEXT_STEP/,
      'precondition: and it never reaches the next step — the caller is gone, with nothing on stderr '
      + 'to say why');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── round-63: the Step 5 verdict must be stated by keywords ──────────────────

// Round 61 moved the Step 1 gate's verdict off `true`/`false` because an imported function
// outranks a builtin. The Step 5 ambiguity guard kept `[` — also a builtin — for two rounds after
// that, which is the shape this test now pins: not "the block refuses collisions" (already
// covered) but "no environment the operator's shell can carry makes it approve one".
test('the Step 5 ambiguity guard under an imported `[` → still refuses, and the verdict survives', () => {
  const skill = readFileSync(skillPath, 'utf8');
  const block = skill.match(/branch=<quoted branch>\n(?:.*\n)*?\[\[ "\$ok" -eq 1 \]\][^\n]*\n/);
  assert.ok(block, 'the Step 5 guard block must still be findable');
  assert.doesNotMatch(block[0], /(^|[^[])\[ /m,
    'no `[` may remain in the block: it is a builtin, so an imported function answers it — and one '
    + 'surviving test is enough, because every check writes into the same `ok`');

  const dir = mkdtempSync(join(tmpdir(), 'smart-rebase-kw-'));
  const git = (...args) => spawnSync(REAL_GIT, ['-C', dir, ...args], { encoding: 'utf8' });
  try {
    assert.ok(REAL_GIT, 'precondition: a real git is needed');
    git('init', '-q');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgSign', 'false');
    git('commit', '-q', '--allow-empty', '-m', 'seed');
    git('branch', 'topic');
    // The collision the guard exists for: a tag of the same name, so the short operand is
    // ambiguous and `refs/tags/topic` wins resolution.
    git('tag', 'topic', 'HEAD');

    const rendered = block[0].replace('<quoted branch>', "'topic'");
    const run = (env) => spawnSync('/bin/bash', ['-c', rendered],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });

    const plain = run({});
    assert.notEqual(plain.status, 0, 'precondition: the collision must be refused without any shadow');
    assert.match(plain.stdout, /⛔/, 'precondition: and it must say so');

    const shadowed = run({ 'BASH_FUNC_[%%': '() { return 0; }' });
    assert.notEqual(shadowed.status, 0,
      'an imported `[` must not turn the refusal into approval — the verdict and every test feeding '
      + 'it are keywords, which the parser resolves before any function name is looked up');
    assert.match(shadowed.stdout, /⛔/, 'and the operator must still be told why');

    // MUTANT APPLIED — the pre-fix shape, run under the same shadow, so this test cannot pass by
    // the shadow simply having no effect on anything.
    const mutant = rendered
      .replace(/case "\$n" in\n  1\) ;;\n  \*\) (echo[^\n]*); ok=0 ;;\nesac/, '[ "$n" -eq 1 ] || { $1; ok=0; }')
      .replace('[[ "$ok" -eq 1 ]]', '[ "$ok" -eq 1 ]')
      .replace(/if \[\[ "\$sym" != "refs\/heads\/\$branch" \]\]; then\n([^\n]*)\nfi/,
        '[ "$sym" = "refs/heads/$branch" ] || { $1; }')
      .replace(/if \[\[ -z "\$head" \|\| "\$short" != "\$head" \]\]; then\n([^\n]*)\nfi/,
        '[ -n "$head" ] && [ "$short" = "$head" ] || { $1; }');
    assert.notEqual(mutant, rendered, 'MUTANT APPLIED: the fixture must restore at least one `[`');
    const broken = spawnSync('/bin/bash', ['-c', mutant],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, 'BASH_FUNC_[%%': '() { return 0; }' } });
    assert.equal(broken.status, 0,
      'precondition: with `[` back as the verdict, the same shadow makes the guard approve a '
      + 'collision it was built to refuse — this is the finding, and it is what the fix removes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
