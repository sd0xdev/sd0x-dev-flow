'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { setTimeout: sleep } = require('node:timers/promises');
const {
  mkdtempSync, mkdirSync, writeFileSync, appendFileSync, chmodSync, rmSync, readFileSync,
  symlinkSync, existsSync, readdirSync,
} = require('node:fs');

const inspectPath = resolve(__dirname, '../../skills/smart-commit/scripts/smart-commit-inspect.sh');
const skillPath = resolve(__dirname, '../../skills/smart-commit/SKILL.md');
const gitEnvPath = resolve(__dirname, '../../skills/smart-commit/references/git-environment.md');

/**
 * The machine's own git environment is not part of any fixture. Two channels reach in and
 * both were measured to flip a test:
 *
 *  - `~/.gitconfig` / XDG git config — round 19 review, P2, extended round 20: the script now
 *    strips `GIT_CONFIG_GLOBAL` AND `GIT_CONFIG_SYSTEM` itself (git-environment.md § 1), so
 *    pointing either at `/dev/null` here no longer reaches the script's OWN git calls — only
 *    this file's raw, script-bypassing `spawnSync('git', …)` "control" assertions still see
 *    them (P8w/P8x/P8y use `gitShim`'s `inject-sysconfig` mode instead, one process layer past
 *    the strip). `HOME`/`XDG_CONFIG_HOME` are what isolate the script's calls now: neither is
 *    on any strip list — round 21 found HOME reaches the identical attack `GIT_CONFIG_SYSTEM`
 *    did (P8z/P8z2 below), and it cannot be stripped since `identity` needs it as genuine
 *    load-bearing input — so redirecting both to an empty fixture directory is what makes
 *    global-config lookup resolve to nothing for THIS suite's fixtures, not a strip. The two
 *    security-critical operations HOME can still reach — `guard`'s hooksPath resolution and
 *    any status/diff/commit call's `core.fsmonitor` — are closed a different way: a scope
 *    check and a command-line pin, neither of which depends on HOME being isolated at all.
 *  - `GIT_AUTHOR_*` / `GIT_COMMITTER_*` — these are what P8 asserts the script reports, so an
 *    inherited value makes the assertion read the developer's shell instead of the fixture.
 *    Measured: `GIT_COMMITTER_EMAIL=ci@example.com node --test …` failed P8.
 *
 * The identity four are DELETED, not set to `''`. Measured: `''` breaks the fixture at
 * `git commit` ("empty ident name not allowed"), so a helper written that way makes 11 of 13
 * cases fail for a reason that has nothing to do with what they test.
 */
const IDENTITY_VARS = [
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
];
// A single shared, permanently-empty fixture: nothing ever writes a `.gitconfig` or
// `.config/git/config` into it, so every hermetic() call gets the same "no global config exists"
// answer without paying mkdtempSync's cost per call (this helper runs hundreds of times).
const HERMETIC_HOME = mkdtempSync(resolve(tmpdir(), 'sc-hermetic-home-'));
process.on('exit', () => { try { rmSync(HERMETIC_HOME, { recursive: true, force: true }); } catch { /* best effort */ } });
const hermetic = (extra = {}) => {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    HOME: HERMETIC_HOME,
    XDG_CONFIG_HOME: resolve(HERMETIC_HOME, '.config'),
  };
  for (const v of IDENTITY_VARS) delete env[v];
  return { ...env, ...extra };
};

/**
 * Run the script the way the skill runs it: as an ARGUMENT to `/bin/bash -p`, never through
 * its shebang. That is not a stylistic choice — passing a script as an argument bypasses the
 * shebang entirely, so a test that relied on `#!/bin/bash -p` would be exercising a launch
 * path the skill never takes.
 */
const inspect = (args, opts = {}) => spawnSync('/bin/bash', ['-p', '--', inspectPath, ...args], {
  encoding: 'utf8', ...opts, env: opts.env || hermetic(),
});

/**
 * A PATH shim whose `git` misbehaves only for `config`, so an abort is attributable to the
 * config read specifically and not to git being broken outright. Modes:
 *   'fail'            — exit 128 without writing anything
 *   'truncate'        — write a PARTIAL record triple, then exit 128
 *   'pass'            — delegate everything (the negative control the other modes need)
 *   'inject-sysconfig'— set GIT_CONFIG_SYSTEM to `opt` before delegating (round 20 review, P0:
 *                        the script now strips GIT_CONFIG_SYSTEM itself — see git-environment.md
 *                        § 1 — so a test env var no longer reaches the script's OWN git calls;
 *                        this shim sets it one process layer downstream of that strip, in a
 *                        wrapper the script's `unset` block cannot reach)
 * The real PATH travels in the environment rather than interpolated into the script: a PATH
 * element containing a quote would otherwise break the shim instead of failing the assertion.
 */
const gitShim = (shimDir, mode, opt) => {
  const trap = {
    fail: 'for a in "$@"; do [ "$a" = config ] && { echo "shim: cannot read config" >&2; exit 128; }; done\n',
    truncate: 'for a in "$@"; do [ "$a" = config ] && { printf \'local\\0file:.git/config\\0\'; exit 128; }; done\n',
    pass: '',
    'inject-sysconfig': 'GIT_CONFIG_SYSTEM="$SC_INJECT_SYSCONFIG"\nexport GIT_CONFIG_SYSTEM\n',
  }[mode];
  assert.equal(typeof trap, 'string', `unknown shim mode ${mode}`);
  writeFileSync(resolve(shimDir, 'git'),
    `#!/bin/sh\n${trap}PATH="$SC_REAL_PATH"\nexport PATH\nexec git "$@"\n`);
  chmodSync(resolve(shimDir, 'git'), 0o755);
  return hermetic({
    PATH: `${shimDir}:${process.env.PATH}`, SC_REAL_PATH: process.env.PATH,
    ...(opt ? { SC_INJECT_SYSCONFIG: opt } : {}),
  });
};

/** A repository with one commit, a known branch, and a file whose name contains glob magic. */
const makeRepo = (label) => {
  const dir = mkdtempSync(resolve(tmpdir(), `sc-inspect-${label}-`));
  const git = (...a) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.email=dev@example.com',
      '-c', 'user.name=Dev', '-c', 'commit.gpgsign=false', ...a],
    { encoding: 'utf8', env: hermetic() });
    assert.equal(r.status, 0, `git ${a.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  git('init', '-q', '-b', `branch-${label}`);
  writeFileSync(resolve(dir, 'seed.txt'), 'seed\n');
  git('add', '--', 'seed.txt');
  git('commit', '-q', '-m', `chore(${label}): seed the fixture`);
  return { dir, git };
};

// ---------------------------------------------------------------------------------------
// The policy: the unset block here and the `env -u` prefix in the reference are one list.
// ---------------------------------------------------------------------------------------

/** The canonical prefix, read from its single source of truth rather than restated here. */
const CANONICAL_PREFIX = (() => {
  const m = readFileSync(gitEnvPath, 'utf8').match(/^(env -u GIT_DIR(?: -u [A-Z_]+)+)$/m);
  assert.ok(m, 'git-environment.md § 1 must declare the canonical env -u prefix on its own line');
  return m[1];
})();

test('P1: the script strips exactly the variables the canonical prefix strips', () => {
  // The whole reason this file may drop the 496-byte prefix from its call sites is that it
  // establishes the same policy once, process-wide. If the two lists drift, every fence that
  // delegated here is silently running under a WEAKER policy than the one it used to carry.
  const src = readFileSync(inspectPath, 'utf8');
  const block = src.match(/^unset GIT_DIR[\s\S]*?ALLOW_AI_COAUTHOR$/m);
  assert.ok(block, 'the script must strip the environment in one locatable `unset` block');
  const unset = block[0].replace(/\\\n\s*/g, ' ').replace(/^unset /, '').trim().split(/\s+/);
  const prefixed = CANONICAL_PREFIX.split(' ').filter((t) => t !== 'env' && t !== '-u');
  // Sets, compared BOTH ways: containment in either direction is the failure this catches.
  // A missing name is an unstripped variable; an extra one is a list nobody derived.
  assert.deepEqual([...unset].sort(), [...prefixed].sort(),
    'the unset block and the env -u prefix must name the same variables, neither more nor fewer');
});

test('P2: an inherited GIT_DIR cannot make a diagnostic answer about another repository', () => {
  // This is the defect the prefix exists to prevent, and the only reason the script may omit
  // it. Two repositories, deliberately with different branch names: run inside A with GIT_DIR
  // pointed at B and the answer must still be A's.
  const a = makeRepo('a');
  const b = makeRepo('b');
  try {
    const env = { ...process.env, GIT_DIR: resolve(b.dir, '.git') };
    const r = inspect(['branch'], { cwd: a.dir, env });
    assert.equal(r.status, 0, `inspect branch failed: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'branch-a',
      'the diagnostic must answer about the repository it is standing in');

    // Negative control, per rules/testing.md § Conventions "Guards": the SAME command without
    // the unset. If this ever also says `branch-a`, the fixture stopped arming the hazard and
    // the assertion above proves nothing about the unset block.
    const bare = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: a.dir, env, encoding: 'utf8' });
    assert.equal(bare.stdout.trim(), 'branch-b',
      'control: unstripped, the inherited GIT_DIR answers about the other repository');
  } finally {
    rmSync(a.dir, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test('P3: the root is derived, so a subdirectory reports root-relative paths', () => {
  // `git status --short` reports paths relative to the CURRENT directory. Collecting from a
  // subdirectory without `-C <root>` yields pathspecs that a later root-anchored command
  // resolves against the wrong base — one file read, another staged.
  //
  // Round 85: this ran on `status` alone, and `status` is the one path-bearing subcommand
  // the skill does NOT group on. Dropping `-C "$REPO_ROOT"` from `collect`, `scope` or
  // `diff` left the whole suite green — while `collect` then emits `../../top.js`, which
  // re-anchored under the root escapes the repository, and `scope` reports nothing at all,
  // which reads as "no changes under this path" and stages an empty set in --execute.
  // Every path-bearing subcommand is now covered, each with an operand where it takes one.
  const CASES = [
    [['status'], 'status'],
    [['collect'], 'collect'],
    [['scope', 'nested/deep/added.txt'], 'scope'],
    [['diff', 'nested/deep/added.txt'], 'diff'],
  ];
  const { dir, git } = makeRepo('sub');
  try {
    mkdirSync(resolve(dir, 'nested/deep'), { recursive: true });
    writeFileSync(resolve(dir, 'nested/deep/added.txt'), 'x\n');
    git('add', '--', 'nested/deep/added.txt');
    // A second file OUTSIDE the subdirectory. Without it, an un-anchored `collect` run from
    // `nested/deep` still reports one plausible-looking line and the escape is invisible;
    // with it, the un-anchored answer contains `../../` and cannot be mistaken for correct.
    writeFileSync(resolve(dir, 'top.txt'), 'y\n');
    git('add', '--', 'top.txt');

    const sub = resolve(dir, 'nested/deep');
    for (const [argv, label] of CASES) {
      const fromRoot = inspect(argv, { cwd: dir });
      const fromSub = inspect(argv, { cwd: sub });
      assert.equal(fromSub.status, 0, `inspect ${label} failed: ${fromSub.stderr}`);
      assert.equal(fromSub.stdout, fromRoot.stdout,
        `${label}: the cwd may not change the answer, but it did\n` +
        `  root: ${JSON.stringify(fromRoot.stdout)}\n   sub: ${JSON.stringify(fromSub.stdout)}`);
      // Equality alone is satisfied by two identically EMPTY answers, which is precisely
      // what an un-anchored `scope`/`diff` produces from the root as well once the
      // pathspec stops resolving. So the answer must also be non-empty and root-relative.
      assert.ok(fromSub.stdout.includes('nested/deep/added.txt'),
        `${label}: must name the file relative to the repository root: ${JSON.stringify(fromSub.stdout)}`);
      assert.ok(!/\.\.\//.test(fromSub.stdout),
        `${label}: no path may escape the root: ${JSON.stringify(fromSub.stdout)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// Pathspec magic: applied by the script, so no call site can forget it.
// ---------------------------------------------------------------------------------------

test('P4: scope treats its argument as a literal path, not a glob', () => {
  const { dir, git } = makeRepo('scope');
  try {
    // Two files: one literally named with glob characters, one the glob would match.
    writeFileSync(resolve(dir, 'report[1].md'), 'bracketed\n');
    writeFileSync(resolve(dir, 'report1.md'), 'plain\n');
    git('add', '--', 'report[1].md', 'report1.md');

    const r = inspect(['scope', 'report[1].md'], { cwd: dir });
    assert.equal(r.status, 0, `inspect scope failed: ${r.stderr}`);
    assert.match(r.stdout, /report\[1\]\.md/, 'the literally named file must be reported');
    // The must-fail direction: without `:(literal)` the bracket expression matches report1.md,
    // so seeing it here would mean the magic was dropped.
    assert.doesNotMatch(r.stdout, /^.. report1\.md$/m,
      'and the file the GLOB would have matched must not be — that is the whole point of :(literal)');

    // Positive control: an ordinary path with no magic characters still resolves normally, so
    // the rule is a refusal of globbing rather than a refusal of paths.
    const plain = inspect(['scope', 'report1.md'], { cwd: dir });
    assert.match(plain.stdout, /report1\.md/, 'an ordinary path must still be found');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P5: diff applies the literal magic per operand and covers both staged and unstaged', () => {
  const { dir, git } = makeRepo('diff');
  try {
    // BOTH operands carry glob magic, and each has a decoy the magic would otherwise match.
    // Round 84: with `b.txt` as the second operand this case could not fail — mutating the
    // script to apply `:(literal)` to `$1` only left 13/13 green, because an operand with no
    // metacharacters globs to itself. "Per operand" is only testable if every operand is one.
    for (const [name, body] of [
      ['a[1].txt', 'one\n'], ['a1.txt', 'decoy one\n'],
      ['b[2].txt', 'two\n'], ['b2.txt', 'decoy two\n'],
    ]) writeFileSync(resolve(dir, name), body);
    git('add', '--', 'a[1].txt', 'a1.txt', 'b[2].txt', 'b2.txt');
    git('commit', '-q', '-m', 'chore(diff): add the fixture files');
    // One change staged, one left in the working tree, so a report covering only one of the
    // two would be visibly incomplete. The decoys are dirtied too, so a glob has something
    // to catch.
    writeFileSync(resolve(dir, 'a[1].txt'), 'one changed\n');
    git('add', '--', 'a[1].txt');
    writeFileSync(resolve(dir, 'b[2].txt'), 'two changed\n');
    writeFileSync(resolve(dir, 'a1.txt'), 'DECOY-ONE-LEAKED\n');
    writeFileSync(resolve(dir, 'b2.txt'), 'DECOY-TWO-LEAKED\n');

    const r = inspect(['diff', 'a[1].txt', 'b[2].txt'], { cwd: dir });
    assert.equal(r.status, 0, `inspect diff failed: ${r.stderr}`);
    assert.match(r.stdout, /two changed/, 'the unstaged change must be described');
    assert.match(r.stdout, /one changed/, 'and the staged one too');
    // Per operand, not once for the whole list: `:(literal)` is not environmental, so an
    // operand that missed it would glob while the others did not. Each decoy names the
    // position it proves, so a failure says which operand lost the magic.
    assert.doesNotMatch(r.stdout, /DECOY-ONE-LEAKED/,
      'operand 1 must be literal — a1.txt is not a[1].txt');
    assert.doesNotMatch(r.stdout, /DECOY-TWO-LEAKED/,
      'operand 2 must be literal too — this is the assertion the old fixture could not make');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// The guard probe: three states, and the resolver is asked rather than guessed.
// ---------------------------------------------------------------------------------------

test('P6: guard reports installed / not-executable / missing', () => {
  const { dir } = makeRepo('guard');
  try {
    const hook = resolve(dir, '.git/hooks/commit-msg');
    assert.equal(inspect(['guard'], { cwd: dir }).stdout.trim(), 'guard:missing',
      'no hook at all is `missing`');

    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    chmodSync(hook, 0o644);
    assert.equal(inspect(['guard'], { cwd: dir }).stdout.trim(), 'guard:not-executable',
      'a file git will never run is not the same as no file — the fix differs');

    chmodSync(hook, 0o755);
    assert.equal(inspect(['guard'], { cwd: dir }).stdout.trim(), 'guard:installed',
      'executable is the only state that means the guard actually runs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P7: guard honours core.hooksPath instead of assuming .git/hooks', () => {
  // The reason the probe asks `rev-parse --git-path` rather than building the path itself.
  // A resolver that hard-codes `$REPO_ROOT/.git/hooks/commit-msg` answers `missing` here
  // while the guard is installed and running.
  const { dir, git } = makeRepo('hookspath');
  try {
    const custom = resolve(dir, 'tools/githooks');
    mkdirSync(custom, { recursive: true });
    writeFileSync(resolve(custom, 'commit-msg'), '#!/bin/sh\nexit 0\n');
    chmodSync(resolve(custom, 'commit-msg'), 0o755);
    // Armed control first: with core.hooksPath unset the same tree reports `missing`, so the
    // assertion below is measuring the config and not the file's mere existence.
    assert.equal(inspect(['guard'], { cwd: dir }).stdout.trim(), 'guard:missing',
      'control: before the config is set, the custom directory is invisible');
    git('config', 'core.hooksPath', 'tools/githooks');
    assert.equal(inspect(['guard'], { cwd: dir }).stdout.trim(), 'guard:installed',
      'only git knows where the hooks live once core.hooksPath is set');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// Reporting subcommands and refusals.
// ---------------------------------------------------------------------------------------

test('P8: identity reports config sources and the env overrides that outrank them', () => {
  const { dir, git } = makeRepo('identity');
  try {
    // The fixture passes identity as `-c` overrides, which never reach `.git/config` — so the
    // two config reads had nothing to report and any assertion about them would have been
    // vacuous. Written to local config here, which is what Step 1c actually reads.
    git('config', 'user.name', 'Fixture Person');
    git('config', 'user.email', 'fixture@example.invalid');
    const env = hermetic({ GIT_AUTHOR_NAME: 'Override Person' });
    const r = inspect(['identity'], { cwd: dir, env });
    assert.equal(r.status, 0, `inspect identity failed: ${r.stderr}`);
    assert.match(r.stdout, /^GIT_AUTHOR_NAME\tvalue\tOverride Person$/m,
      'GIT_AUTHOR_* is what the commit would actually use, so it must survive the unset block');
    // Round 93: this pinned `GIT_COMMITTER_EMAIL=$` and called it "reported as empty" — which
    // is precisely the conflation `P8m` now forbids. An absent variable is `unset`.
    assert.match(r.stdout, /^GIT_COMMITTER_EMAIL\tunset$/m,
      'an absent one is `unset`, which is not the same answer as exported-and-empty');
    // Round 85: nothing here judged the two `git config` reads, so deleting the `user.email`
    // line outright survived the suite. Round 89 replaced the fix rather than extending it:
    // this used to assert `lines[0]`/`lines[1]`, i.e. that POSITION is the contract — which
    // holds only when both keys are set and single-valued, and breaks in exactly the two
    // cases Step 1c branches on (`P8b`, `P8c`). The key name is the contract now.
    const lines = r.stdout.trim().split('\n');
    assert.match(lines[0], /^user\.name\tvalue\tlocal\tfile:.*\tFixture Person$/,
      'every line names its key and its kind, so a reader never has to count lines');
    assert.match(lines[1], /^user\.email\tvalue\tlocal\tfile:.*\tfixture@example\.invalid$/,
      'and the origin/scope columns still follow it unchanged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// `--get-all`, not `--get`. With two values in scope, `--get` returns only the last, which
// makes two rows of Step 1c's decision table unreachable: the AskUserQuestion profile choice
// and the fail-closed `CI=true` HALT. The commit then takes an unintended author identity —
// CLAUDE.md rule 3 territory. Measured: the regression survived the whole suite before this.
test('P8b: identity reports every configured value, not just the winning one', () => {
  const { dir, git } = makeRepo('identity-multi');
  try {
    // Two values for the same key in the SAME file: what an includeIf overlap produces.
    git('config', 'user.name', 'Fixture Person');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', '--add', 'user.name', 'Second Person');
    const r = inspect(['identity'], { cwd: dir });
    assert.equal(r.status, 0, `inspect identity failed: ${r.stderr}`);
    const names = r.stdout.split('\n').filter((l) => /\tFixture Person$|\tSecond Person$/.test(l));
    assert.equal(names.length, 2,
      `both candidate identities must be reported, or the conflict rows in Step 1c can never ` +
      `fire; got ${JSON.stringify(names)}`);
    // Control: a single-valued key must still report exactly once, so the assertion above is
    // about --get-all and not merely about the fixture having two lines somewhere.
    const emails = r.stdout.split('\n').filter((l) => /\tfixture@example\.invalid$/.test(l));
    assert.equal(emails.length, 1, 'a single-valued key reports once');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 89, P2 from review. `--get-all` prints NOTHING for an unset key, so a bare listing
// shifts every later line up — and Step 1c's HALT row ("`git config --get user.name` returns
// nothing → HALT, output setup guidance") is precisely the case that shifts it. Measured on
// the pre-fix script: with `user.name` unset the FIRST line was the user.email row, so a
// positional reader saw a name of `dev@example.com`, never took the HALT branch, and let the
// commit proceed under an identity nobody chose — CLAUDE.md rule 3 territory.
test('P8c: an unset identity key emits its own line, so the HALT row can fire', () => {
  const { dir, git } = makeRepo('identity-unset');
  try {
    // Only user.email is set. `makeRepo` commits with `-c` overrides, which never land in
    // .git/config, so user.name is genuinely absent rather than merely shadowed.
    git('config', 'user.email', 'solo@example.invalid');
    const r = inspect(['identity'], { cwd: dir });
    assert.equal(r.status, 0, `inspect identity failed: ${r.stderr}`);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines[0], 'user.name\tunset',
      'an unset key must still answer, exactly as `signing` does for its three keys');
    assert.match(lines[1], /^user\.email\tvalue\tlocal\tfile:.*\tsolo@example\.invalid$/,
      'and the key that IS set must not be pulled up into the missing one\'s place');
    // The negative control this test exists for: no line may be readable as a name simply
    // because it arrived first. Deleting the `unset` branch reddens exactly this assertion.
    assert.doesNotMatch(lines[0], /solo@example\.invalid/,
      'the email must never be the first line when user.name is the unset key');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 90, P1 from review. `--get-all` prints a multi-line value across multiple lines, and the
// continuation lines carry NO scope/origin — so the old reader, which prefixed every line with
// the key, turned a value of `Real Person\nunset` into a second line reading exactly
// `user.name<TAB>unset`: the HALT sentinel, forged out of repository content. Measured before
// the fix: the skill halted with setup guidance on a repository where `git commit` succeeds.
test('P8d: a newline inside a config value cannot forge the unset sentinel', () => {
  const { dir, git } = makeRepo('identity-newline');
  try {
    git('config', 'user.name', 'Real Person\nunset');
    git('config', 'user.email', 'fixture@example.invalid');
    const r = inspect(['identity'], { cwd: dir });
    assert.equal(r.status, 0, `inspect identity failed: ${r.stderr}`);
    const lines = r.stdout.trim().split('\n');
    const nameLines = lines.filter((l) => l.startsWith('user.name\t'));
    assert.equal(nameLines.length, 1,
      `one configured value must be exactly one line, whatever it contains; got ` +
      `${JSON.stringify(nameLines)}`);
    assert.match(nameLines[0], /^user\.name\tvalue\tlocal\tfile:.*\tReal Person\\nunset$/,
      'the newline is escaped into the value field rather than ending the line');
    // The assertion this test exists for. `P8c` pins that a genuinely unset key DOES emit this
    // line, so the two together say: the sentinel appears when and only when git says so.
    assert.ok(!lines.includes('user.name\tunset'),
      'no config value may produce the sentinel that sends Step 1c to its HALT branch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 90, P2 from review. git exits 0 for a key set to the empty string, so the old reader
// reported it as an ordinary identity and Step 1c continued silently — but `git commit` then
// refuses outright with `Author identity unknown`. Step 1c exists to catch that before the plan
// is built, so the empty value needs an answer of its own rather than an indistinguishable one.
test('P8e: an empty config value answers `empty`, not a valid identity', () => {
  const { dir, git } = makeRepo('identity-empty');
  try {
    git('config', 'user.name', 'Fixture Person');
    git('config', 'user.email', '');
    const r = inspect(['identity'], { cwd: dir });
    assert.equal(r.status, 0, `inspect identity failed: ${r.stderr}`);
    const lines = r.stdout.trim().split('\n');
    const emailLine = lines.find((l) => l.startsWith('user.email\t'));
    assert.match(emailLine, /^user\.email\tempty\tlocal\tfile:[^\t]*$/,
      'an empty value is its own kind, carrying scope and origin but no value field');
    // Negative control: `empty` must be reported because the value IS empty, not because the
    // script labels every key that way. Without this the kind could be hard-coded and pass.
    assert.match(lines.find((l) => l.startsWith('user.name\t')),
      /^user\.name\tvalue\tlocal\tfile:.*\tFixture Person$/,
      'a non-empty value in the same run must still be reported as `value`');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 90, P2 from review. The `*)` branch existed with no oracle: replacing its abort with the
// fail-open `printf '<key>\tunset'` it was written to prevent left the whole suite green. Every
// config-read failure constructible from the repository itself (`chmod 000 .git/config`, an
// unterminated `[user` section, an unreadable include target) is caught earlier by the root
// guard's `rev-parse`, which exits 128 too — measured, and recorded in § 10.1. A PATH shim is
// the trigger that separates the two, and it is a real one: git < 2.26 rejects `--show-scope`
// as an unknown option and exits 129 on exactly this call.
test('P8f: a config read that fails is not reported as an unset key', () => {
  const { dir } = makeRepo('identity-readfail');
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-shim-'));
  try {
    const failed = inspect(['identity'], { cwd: dir, env: gitShim(shimDir, 'fail') });
    assert.equal(failed.status, 1, 'a config that cannot be read must abort, not answer');
    assert.match(failed.stderr, /identity: could not read user\.name — aborting/,
      'and it must say READ, because `unset` would send Step 1c to the wrong guidance');
    assert.ok(!failed.stdout.includes('\tunset'),
      'the fail-open this branch prevents: reporting an unreadable config as a missing key');

    // Negative control: the same shim without the trap must succeed. Without it this test
    // would pass just as well if the PATH shim broke git outright, which proves nothing about
    // the `*)` branch — the abort has to come from the config read specifically.
    const ok = inspect(['identity'], { cwd: dir, env: gitShim(shimDir, 'pass') });
    assert.equal(ok.status, 0, `the shim itself must not break the script: ${ok.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
});

// Round 91, Nit from review, promoted because it is the ONLY oracle for the empty-`rc` path.
// A git that dies part-way through a value's three fields leaves the trailing `rc=N` record to
// be consumed as that value's third field, so `rc` is never assigned at all — a different
// branch from `P8f`, whose shim exits before writing anything. Measured on the pre-buffering
// script: stdout carried `user.name<TAB>value<TAB>local<TAB>file:.git/config<TAB>rc=128`, a
// line indistinguishable from a real identity, before the abort.
test('P8g: a truncated config read prints nothing readable as an answer', () => {
  const { dir } = makeRepo('identity-truncated');
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-shim-'));
  try {
    const r = inspect(['identity'], { cwd: dir, env: gitShim(shimDir, 'truncate') });
    assert.equal(r.status, 1, 'a truncated read must abort');
    assert.match(r.stderr, /identity: could not read user\.name — aborting/,
      'the empty-`rc` case takes the same abort branch as an explicit failure status');
    assert.equal(r.stdout, '',
      'records are buffered until the status is known, so a truncated read answers nothing');
    const ok = inspect(['identity'], { cwd: dir, env: gitShim(shimDir, 'pass') });
    assert.equal(ok.status, 0, `the shim itself must not break the script: ${ok.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
});

// Round 91, P2 from review. § 10.1 names five load-bearing properties, of which "the field
// COUNT is fixed per kind — the tab escape" had no oracle: deleting the tab escape (and the CR
// escape) left both suites green. A tab is reachable — `git config user.name "$(printf
// 'Alice\tunset\tvalue')"` — and it splits the value across two extra fields.
test('P8h: a tab or CR inside a value cannot add fields or lines', () => {
  const { dir, git } = makeRepo('identity-tab');
  try {
    git('config', 'user.name', 'Alice\tunset\tvalue');
    git('config', 'user.email', 'carriage\rreturn@example.invalid');
    const lines = inspect(['identity'], { cwd: dir }).stdout.trim().split('\n');
    const nameLine = lines.find((l) => l.startsWith('user.name\t'));
    assert.equal(nameLine.split('\t').length, 5,
      `a value line has exactly five fields whatever the value contains; got ` +
      `${JSON.stringify(nameLine)}`);
    assert.match(nameLine, /^user\.name\tvalue\tlocal\tfile:[^\t]*\tAlice\\tunset\\tvalue$/,
      'the tabs are escaped into the value field rather than becoming field separators');
    const emailLine = lines.find((l) => l.startsWith('user.email\t'));
    assert.equal(emailLine.split('\t').length, 5, 'and a CR does not split the line either');
    assert.match(emailLine, /\tcarriage\\rreturn@example\.invalid$/,
      'the CR is escaped too — a bare one would make a terminal overwrite the field');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 91, P1 from review. The four env lines were printed raw, so a newline in one of them
// wrote a second line shaped exactly like a config record. Measured on the pre-fix script,
// `GIT_AUTHOR_NAME=$'Bob\nuser.email\tvalue\tlocal\tfile:.git/config\tattacker@evil.test'`
// produced a forged `user.email value …` line beside the real one. These four are the one data
// channel the script deliberately keeps, so "no data can forge a record" has to cover them.
//
// Round 92: this case originally pinned GIT_AUTHOR_NAME alone, and that gap was not theoretical
// — GIT_COMMITTER_EMAIL was still printed raw, so the round-91 fix had in fact only landed on
// three of the four. A single-channel oracle made a one-of-four fix look complete. All four are
// exercised here, which is why the loop is the assertion rather than a convenience.
test('P8i: a newline in any identity env var cannot forge a config record', () => {
  const { dir, git } = makeRepo('identity-envforge');
  try {
    git('config', 'user.name', 'Fixture Person');
    git('config', 'user.email', 'fixture@example.invalid');
    const forged = 'user.email\tvalue\tlocal\tfile:.git/config\tattacker@evil.test';
    for (const name of IDENTITY_VARS) {
      const r = inspect(['identity'], { cwd: dir, env: hermetic({ [name]: `Bob\n${forged}` }) });
      assert.equal(r.status, 0, `${name}: inspect identity failed: ${r.stderr}`);
      const lines = r.stdout.trim().split('\n');
      assert.ok(!lines.includes(forged),
        `${name}: an env value must never be readable as a config record`);
      const emails = lines.filter((l) => l.startsWith('user.email\tvalue'));
      assert.equal(emails.length, 1,
        `${name}: exactly one user.email record, the real one; got ${JSON.stringify(emails)}`);
      assert.ok(lines.some((l) => l === `${name}\tvalue\tBob\\n${forged.replace(/\t/g, '\\t')}`),
        `${name}: the whole env value stays on its own line, escaped`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 91, P2 from review. The origin is a PATH, and a config file may legitimately be named
// with a tab or newline in it; unescaped it broke the field count for a value that was itself
// perfectly ordinary. The script already treats newline-bearing paths as real when it derives
// REPO_ROOT, so the premise is accepted elsewhere in the same file.
test('P8j: a tab in the origin path cannot add fields either', () => {
  const { dir, git } = makeRepo('identity-taborigin');
  try {
    const incDir = resolve(dir, 'inc');
    mkdirSync(incDir);
    const incPath = resolve(incDir, 'weird\tname.cfg');
    writeFileSync(incPath, '[user]\n\tname = FromInclude\n');
    git('config', 'user.name', 'Local Person');
    git('config', 'include.path', incPath);
    const lines = inspect(['identity'], { cwd: dir }).stdout.trim().split('\n');
    const fromInclude = lines.find((l) => l.endsWith('\tFromInclude'));
    assert.ok(fromInclude, `the included value must be reported; got ${JSON.stringify(lines)}`);
    assert.equal(fromInclude.split('\t').length, 5,
      `five fields even when the ORIGIN contains a tab; got ${JSON.stringify(fromInclude)}`);
    assert.match(fromInclude, /\tfile:[^\t]*weird\\tname\.cfg\tFromInclude$/,
      'the tab is escaped inside the origin field');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 91, P2 from review. `P8`–`P8j` pin what the script emits and the F1* tests pin the
// fences, but nothing tied the two: a kind could be added to the script with no row in Step
// 1c's decision table, which is exactly how the contradictory `empty` row shipped green.
// Round 93, P1 from review. `${VAR:-}` reported an exported-but-EMPTY identity variable with a
// line byte-identical to the unset case — and `P8` actively pinned that as correct. The two are
// not the same state, which `P8m` measures against git itself.
test('P8l: an exported-but-empty identity var is not reported as unset', () => {
  const { dir, git } = makeRepo('identity-envempty');
  try {
    git('config', 'user.name', 'Fixture Person');
    git('config', 'user.email', 'fixture@example.invalid');
    for (const name of IDENTITY_VARS) {
      const kind = (env) => inspect(['identity'], { cwd: dir, env }).stdout.trim().split('\n')
        .find((l) => l.startsWith(`${name}\t`));
      assert.equal(kind(hermetic()), `${name}\tunset`,
        `${name}: absent from the environment is \`unset\``);
      assert.equal(kind(hermetic({ [name]: '' })), `${name}\tempty`,
        `${name}: exported and empty is \`empty\` — the state that makes git fatal or drops ` +
        'attribution, and the one the old `${VAR:-}` form could not express');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The oracle for WHY P8l matters: git, not this repository, decides what an empty identity var
// does, and the two halves differ. Pinned here so the Step 1c rows that cite them cannot rot.
test('P8m: git treats an empty identity NAME as fatal and an empty EMAIL as a silent `<>`', () => {
  const { dir, git } = makeRepo('identity-envempty-git');
  try {
    git('config', 'user.name', 'Fixture Person');
    git('config', 'user.email', 'fixture@example.invalid');
    const commit = (name) => {
      writeFileSync(resolve(dir, `${name}.txt`), 'x\n');
      spawnSync('git', ['-C', dir, 'add', '--', `${name}.txt`], { env: hermetic() });
      return spawnSync('git', ['-C', dir, 'commit', '-q', '-m', `chore: ${name}`],
        { encoding: 'utf8', env: hermetic({ [name]: '' }) });
    };
    for (const name of ['GIT_AUTHOR_NAME', 'GIT_COMMITTER_NAME']) {
      const r = commit(name);
      assert.notEqual(r.status, 0, `${name}='' must make git refuse the commit outright`);
      assert.match(r.stderr, /empty ident name/, 'and say so — this is the HALT case');
    }
    for (const name of ['GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL']) {
      const r = commit(name);
      assert.equal(r.status, 0, `${name}='' is accepted by git — that is what makes it dangerous`);
    }
    const idents = spawnSync('git', ['-C', dir, 'log', '-2', '--format=%ae|%ce'],
      { encoding: 'utf8', env: hermetic() }).stdout;
    // `log -2` is newest-first and the loop committed AUTHOR then COMMITTER, so the first
    // line is the committer case and the second the author one. Both directions are asserted:
    // the message used to name the committer while the pattern pinned only the author.
    assert.match(idents, /(^|\n)fixture@example\.invalid\|(\n|$)/,
      'an empty GIT_COMMITTER_EMAIL lands a commit whose committer has no address, silently');
    assert.match(idents, /(^|\n)\|fixture@example\.invalid(\n|$)/,
      'an empty GIT_AUTHOR_EMAIL does the same to the author — the attribution is simply gone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 93, P2 from review. The backslash escape is the one `esc` rule with no oracle: deleting
// `ESC=${ESC//\\/\\\\}` left 94/94 green. It is what keeps the escape INJECTIVE — without it a
// value containing the two literal characters `\` `n` decodes, at a reader following the escape
// table SKILL.md publishes, into a newline and therefore into a second logical record.
test('P8n: a literal backslash in a value is doubled, so the escape stays injective', () => {
  const { dir, git } = makeRepo('identity-backslash');
  try {
    const forged = String.raw`\nuser.email\tvalue\tlocal\tfile:.git/config\tattacker@evil.test`;
    git('config', 'user.name', `Bob${forged}`);
    git('config', 'user.email', 'fixture@example.invalid');
    const r = inspect(['identity'], { cwd: dir, env: hermetic({ GIT_AUTHOR_NAME: `Ann${forged}` }) });
    const nameLine = r.stdout.trim().split('\n').find((l) => l.startsWith('user.name\t'));
    assert.ok(nameLine.endsWith(`Bob${forged.replace(/\\/g, '\\\\')}`),
      `every backslash doubled, so decoding cannot invent a newline; got ${nameLine}`);
    const envLine = r.stdout.trim().split('\n').find((l) => l.startsWith('GIT_AUTHOR_NAME\t'));
    assert.ok(envLine.endsWith(`Ann${forged.replace(/\\/g, '\\\\')}`),
      `the same rule on the env channel; got ${envLine}`);
    // The point, stated as the assertion: an undoubled backslash would let this decode into
    // two records. Doubled, a decoder yields one value that merely LOOKS like an escape.
    assert.ok(!nameLine.includes('\\nuser.email\tvalue'),
      'no substring of the output is readable as an escaped record separator');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const effectiveOf = (stdout, role) => stdout.trim().split('\n')
  .find((l) => l.startsWith(`effective\t${role}\t`));

const configuredOf = (stdout, role) => stdout.trim().split('\n')
  .find((l) => l.startsWith(`configured\t${role}\t`));

test('P8r: `configured` answers `no` for both $EMAIL and a bare OS guess, `yes` for config or env', () => {
  // Round 15, P1. `effective` alone cannot tell a configured identity from git's OS guess —
  // both resolve to a `value` line. `configured` is `git -c user.useConfigOnly=true var
  // GIT_<ROLE>_IDENT`, asked the same way `effective` is: it refuses exactly the fallback half
  // of resolution, so it answers `no` for a source no `git config --local` call set for this
  // repository, and `yes` for one that did.
  const { dir, git } = makeRepo('configured');
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-p8r-shim-'));
  try {
    // Fully configured: `user.name`/`user.email` are values the operator set here.
    git('config', 'user.name', 'Dev');
    git('config', 'user.email', 'fixture@example.invalid');
    let r = inspect(['identity'], { cwd: dir });
    assert.equal(configuredOf(r.stdout, 'author'), 'configured\tauthor\tyes',
      'user.name + user.email set locally is a configured identity');
    assert.equal(configuredOf(r.stdout, 'committer'), 'configured\tcommitter\tyes',
      'the committer role reads the same user.* config, so it agrees');

    // $EMAIL fallback: `effective` resolves, but from a source no `git config --local` set.
    git('config', '--unset', 'user.email');
    r = inspect(['identity'], { cwd: dir, env: hermetic({ EMAIL: 'corp@example.invalid' }) });
    assert.equal(effectiveOf(r.stdout, 'author'),
      'effective\tauthor\tvalue\tDev <corp@example.invalid>',
      'control: EMAIL really is what git would record');
    assert.equal(configuredOf(r.stdout, 'author'), 'configured\tauthor\tno',
      'EMAIL is not a value the operator set for this repository');

    // Bare OS guess: no config, no env, no EMAIL — git falls all the way through. This is the
    // one sub-case a real machine's SYSTEM-scope user.* would flip: `hermetic()`'s own
    // GIT_CONFIG_SYSTEM='/dev/null' no longer reaches the script's own calls (round 20 stripped
    // it — see the file header comment), so `gitShim`'s `inject-sysconfig` mode is what actually
    // isolates this assertion from the real machine, pointed at `/dev/null` the same way the
    // stripped env var used to (round 21 review, P2).
    git('config', '--unset', 'user.name');
    r = inspect(['identity'], { cwd: dir, env: gitShim(shimDir, 'inject-sysconfig', '/dev/null') });
    assert.match(effectiveOf(r.stdout, 'author'), /^effective\tauthor\tvalue\t/,
      'control: git\'s own guess still resolves to SOMETHING, which is the whole finding');
    assert.equal(configuredOf(r.stdout, 'author'), 'configured\tauthor\tno',
      'a guess is grouped with EMAIL — from the operator\'s view neither is a value they set, '
      + 'and `git config --local` fixes both the same way');

    // Exported GIT_AUTHOR_* is an explicit override the operator DID set, for this invocation.
    r = inspect(['identity'],
      { cwd: dir, env: hermetic({ GIT_AUTHOR_NAME: 'Override', GIT_AUTHOR_EMAIL: 'ov@example.invalid' }) });
    assert.equal(configuredOf(r.stdout, 'author'), 'configured\tauthor\tyes',
      'an exported GIT_AUTHOR_* override is something the operator set, not a fallback');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
});

test('P8s: `configured` is asked per role and does not leak a `yes` from one role to the '
  + 'other; a role left fully unconfigured next to a configured one is `unresolvable`, not a '
  + 'guess', () => {
  // Round 15, P1/P2-1/P2-3. author.*/committer.* outrank user.* for their own role only, so
  // a configured author must not make configured\tcommitter read `yes`. Measured, and
  // surprising enough to pin: this git (2.54.0) does NOT fall through to its OS guess for the
  // committer's NAME once ANY author.*/committer.* config exists anywhere in the repo — a
  // bare repo with zero identity config guesses fine for both roles, but author.name +
  // author.email alone turns GIT_COMMITTER_IDENT into a `fatal: empty ident name` refusal.
  // That is exactly the existing `unresolvable` row's job, so the design already covers it —
  // this pins the case rather than assuming a `value` the way an untested guess would.
  const { dir, git } = makeRepo('configuredroles');
  try {
    // Armed control: with nothing configured, both roles guess successfully.
    const bare = inspect(['identity'], { cwd: dir });
    assert.match(effectiveOf(bare.stdout, 'committer'), /^effective\tcommitter\tvalue\t/,
      'control: a repo with zero identity config still guesses a committer ident');

    git('config', 'author.name', 'Author Person');
    git('config', 'author.email', 'author@example.invalid');
    const r = inspect(['identity'], { cwd: dir });
    assert.equal(effectiveOf(r.stdout, 'author'),
      'effective\tauthor\tvalue\tAuthor Person <author@example.invalid>',
      'the configured author role resolves to the configured value');
    assert.equal(effectiveOf(r.stdout, 'committer'), 'effective\tcommitter\tunresolvable',
      'measured: author.* alone disables the OS guess for the untouched committer role');
    assert.equal(configuredOf(r.stdout, 'author'), 'configured\tauthor\tyes',
      'author.* alone is enough to configure the author role');
    assert.equal(configuredOf(r.stdout, 'committer'), 'configured\tcommitter\tno',
      'author.* does not configure the committer role, whatever effective says about it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P8t: a tab or CR git\'s ident parser leaves intact cannot forge extra fields in the '
  + '`effective` line', () => {
  // Round 15, P2-2. `emit_effective` calls `esc "$ident"` before printing — every other data
  // channel in this script is escaped by the same function, but `effective` is the one channel
  // built from git's OWN answer rather than from a config/env record, so nothing previously
  // proved the call was load-bearing there specifically. It is: unlike `\n`, which git's ident
  // parser strips from a name outright, a `\t` or `\r` inside GIT_AUTHOR_NAME survives into
  // `git var`'s answer verbatim — measured below — so an unescaped print would hand a tab
  // straight to a field separator a downstream reader keys on.
  const { dir } = makeRepo('identforge');
  try {
    const forgedName = 'Ann\tBob\rCarol';
    const env = hermetic({ GIT_AUTHOR_NAME: forgedName, GIT_AUTHOR_EMAIL: 'e@example.invalid' });

    // Armed control: git's own answer really does carry the raw tab and CR — the finding is
    // about what the script does with them, not about git already having stripped them.
    const raw = spawnSync('git', ['-C', dir, 'var', 'GIT_AUTHOR_IDENT'],
      { encoding: 'utf8', env }).stdout;
    assert.ok(raw.startsWith('Ann\tBob\rCarol <e@example.invalid>'),
      `control: git preserves a literal tab/CR in the name; got ${JSON.stringify(raw)}`);

    const r = inspect(['identity'], { cwd: dir, env });
    const line = effectiveOf(r.stdout, 'author');
    assert.equal(line.split('\t').length, 4,
      `the raw tab must not add a fifth field; got ${JSON.stringify(line)}`);
    assert.equal(line, 'effective\tauthor\tvalue\tAnn\\tBob\\rCarol <e@example.invalid>',
      'both the tab and the CR are escaped into two literal characters each (`\\` `t`, `\\` '
      + '`r`) — a terminal or a naive split(\'\\t\') reader sees neither as the real thing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P8t2: identity reports CI reachably, so SKILL.md\'s "conflict + CI=true → HALT" row has '
  + 'a producer', () => {
  // Round 17 review, P2. Step 1c's decision table names a HALT row that fires on a multi-value
  // identity conflict while `CI=true` — but neither diagnostic path (git-profile.sh's `doctor`,
  // nor this script's inline fallback) ever reported CI at all, so the row could never actually
  // fire. `emit_env_record CI` closes the inline-fallback half of that gap; it reuses the same
  // unset/empty/value shape as the GIT_AUTHOR_*/GIT_COMMITTER_* records just above it.
  const { dir } = makeRepo('ci-env');
  try {
    const base = hermetic();
    delete base.CI; // the real CI runner this suite executes under may set this

    const unset = inspect(['identity'], { cwd: dir, env: base });
    assert.equal(unset.status, 0, `inspect identity failed: ${unset.stderr}`);
    assert.match(unset.stdout, /^CI\tunset$/m, 'no CI in the environment reports unset');

    const empty = inspect(['identity'], { cwd: dir, env: { ...base, CI: '' } });
    assert.match(empty.stdout, /^CI\tempty$/m, 'exported-and-empty reports empty, not unset');

    const value = inspect(['identity'], { cwd: dir, env: { ...base, CI: 'true' } });
    assert.match(value.stdout, /^CI\tvalue\ttrue$/m,
      'the value the decision table actually branches on must be readable verbatim');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P8u: `emit_configured`\'s `>/dev/null 2>&1` is load-bearing — neither half alone keeps '
  + 'git\'s own probe output off the record stream', () => {
  // Round 16, P2. `>/dev/null 2>&1` on the `git -c user.useConfigOnly=true var` probe inside
  // `emit_configured` is the ONLY thing standing between that probe's own (unescaped,
  // attacker-reachable) stdout/stderr and the record stream. Neither half alone is enough:
  // dropping just the stdout suppression lets a crafted GIT_AUTHOR_NAME leak git's raw ident
  // answer as an extra line ahead of the real verdict — and if that name is shaped to START
  // with a legitimate-looking `configured\t<role>\t` prefix, a reader that takes the FIRST
  // matching line (this file's own `configuredOf` helper does exactly that) is handed the
  // forged verdict instead of the real one. Dropping just the stderr suppression instead leaks
  // git's multi-line "Please tell me who you are" hint on the `no` path. Both are measured
  // failures of the current suite before this test existed: reverting either redirect alone
  // left all 62 prior tests green.
  const { dir } = makeRepo('configleak');
  try {
    const forgedName = 'configured\tauthor\tno';
    const env = hermetic({ GIT_AUTHOR_NAME: forgedName, GIT_AUTHOR_EMAIL: 'e@example.invalid' });

    // Armed control: git really does accept the forged name, so a stdout leak really would
    // carry the attacker's chosen prefix onto its own line.
    const raw = spawnSync('git', ['-C', dir, 'var', 'GIT_AUTHOR_IDENT'], { encoding: 'utf8', env }).stdout;
    assert.ok(raw.startsWith(`${forgedName} <e@example.invalid>`),
      `control: git must accept the forged name so a leak would carry the attacker's prefix; `
      + `got ${JSON.stringify(raw)}`);

    const r = inspect(['identity'], { cwd: dir, env });
    const configuredLines = r.stdout.trim().split('\n')
      .filter((l) => l.startsWith('configured\tauthor\t'));
    assert.equal(configuredLines.length, 1,
      `exactly one configured\\tauthor line must exist — a stdout leak adds a second one that `
      + `masquerades as the real one via a shared prefix. Got: ${JSON.stringify(configuredLines)}`);
    assert.equal(configuredLines[0], 'configured\tauthor\tyes',
      'GIT_AUTHOR_NAME is an exported override the operator set for this invocation, so the '
      + 'real verdict is `yes` — it must not be shadowed by a leaked, forged-prefix line');
    assert.doesNotMatch(r.stderr, /Please tell me who you are/,
      'a stderr leak on a `no` path would surface git\'s own multi-line identity-setup hint');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P8v: a raw ESC or DEL byte in an identity value cannot reach the record stream unescaped',
  () => {
    // Round 17 review, P2. `esc()` escaped only `\\ \n \t \r` — an ESC byte (0x1b) survived
    // verbatim into a `value` record, which can carry a raw ANSI/terminal escape sequence
    // (cursor movement, clear-screen, OSC title-set, ...) straight into an identity record a
    // human or a script prints later. The armed control below confirms git's ident parser
    // really does leave both bytes intact; the fix escapes every remaining C0 control byte
    // (and DEL) to a literal `\xHH`.
    const { dir } = makeRepo('esc-control');
    try {
      const forgedName = 'Ann\x1b[31mBob\x7fCarol';
      const env = hermetic({ GIT_AUTHOR_NAME: forgedName, GIT_AUTHOR_EMAIL: 'e@example.invalid' });

      const raw = spawnSync('git', ['-C', dir, 'var', 'GIT_AUTHOR_IDENT'], { encoding: 'utf8', env }).stdout;
      assert.ok(raw.includes('\x1b') && raw.includes('\x7f'),
        `control: git's ident parser must leave ESC and DEL intact; got ${JSON.stringify(raw)}`);

      const r = inspect(['identity'], { cwd: dir, env });
      assert.equal(r.status, 0, `inspect identity failed: ${r.stderr}`);
      assert.ok(!r.stdout.includes('\x1b') && !r.stdout.includes('\x7f'),
        `no raw ESC/DEL byte may reach stdout; got ${JSON.stringify(r.stdout)}`);
      const line = r.stdout.split('\n').find((l) => l.startsWith('GIT_AUTHOR_NAME\t'));
      assert.equal(line, 'GIT_AUTHOR_NAME\tvalue\tAnn\\x1b[31mBob\\x7fCarol',
        'both control bytes are escaped to their literal \\xHH form');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test('P8w: `GIT_CONFIG_NOSYSTEM=1` cannot suppress system config from reaching identity — the '
  + 'script strips it before asking git', () => {
  // Round 17 review, P2. `GIT_CONFIG_NOSYSTEM=1` is a pure downgrade — set, it can only make git
  // see LESS config than it otherwise would — so it is attacker-reachable in exactly the way
  // `GIT_CONFIG_PARAMETERS` already was: an operator (or a CI environment) exporting it silently
  // hides system-level identity policy from Step 1c's diagnosis. `emit_config_records` now reads
  // `user.name`/`user.email` under the script's own `unset` block, which includes it.
  // git-environment.md § 1 has the full rationale, including why `GIT_CONFIG_GLOBAL` (round 19)
  // and `GIT_CONFIG_SYSTEM` (round 20, `P8y` below) both now join it too.
  //
  // Round 20 review, P0: `GIT_CONFIG_SYSTEM` is now ALSO stripped by the script (see `P8y`), so
  // an env var no longer reaches the script's own git calls the way it used to — this test needs
  // `gitShim`'s `inject-sysconfig` mode to fixture a fake system config one process layer past
  // the strip, in the wrapper's own environment rather than the outer script's.
  const { dir } = makeRepo('nosystem');
  const sysDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-sysconfig-'));
  const sysConfig = resolve(sysDir, 'gitconfig');
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-sysshim-'));
  try {
    writeFileSync(sysConfig, '[user]\n\tname = SystemPerson\n\temail = system@example.invalid\n');
    const env = { ...gitShim(shimDir, 'inject-sysconfig', sysConfig), GIT_CONFIG_NOSYSTEM: '1' };

    // Armed control: left unstripped, GIT_CONFIG_NOSYSTEM=1 really does make this system config
    // unreadable — the fixture is not accidentally invisible for some other reason. Direct git
    // call, no shim needed: this is not going through the script's own `unset` block.
    const raw = spawnSync('git', ['-C', dir, 'config', '--show-scope', '--get', 'user.name'],
      { encoding: 'utf8', env: hermetic({ GIT_CONFIG_SYSTEM: sysConfig, GIT_CONFIG_NOSYSTEM: '1' }) });
    assert.notEqual(raw.status, 0,
      `control: NOSYSTEM=1 unstripped must hide the system config; got ${JSON.stringify(raw)}`);

    const r = inspect(['identity'], { cwd: dir, env });
    assert.equal(r.status, 0, `inspect identity failed: ${r.stderr}`);
    const nameLines = r.stdout.split('\n').filter((l) => l.startsWith('user.name\t'));
    assert.ok(nameLines.includes(`user.name\tvalue\tsystem\tfile:${sysConfig}\tSystemPerson`),
      'the script must strip GIT_CONFIG_NOSYSTEM before reading config, surfacing the system '
      + `record instead of silently hiding it; got ${JSON.stringify(nameLines)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sysDir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
});

test('P8x: an inherited GIT_CONFIG_GLOBAL cannot redirect global config to an attacker-chosen '
  + 'file — the script strips it before asking git', () => {
  // Round 19 review, P2. Unlike GIT_CONFIG_NOSYSTEM (a pure downgrade), GIT_CONFIG_GLOBAL
  // REPOINTS config resolution — an env-only attacker who cannot write $HOME/.gitconfig can
  // still point this variable at a file they CAN write (a shared tmp file, a predictable CI
  // cache path, …), and the re-exec'd `-p` shell would apply whatever `core.hooksPath` or
  // `core.fsmonitor` that file sets to every git command this script runs, not just the identity
  // read this test exercises. git-environment.md § 1 has the full rationale — round 20 found
  // `GIT_CONFIG_SYSTEM` is reachable the same way and stripped it too (`P8y` below).
  const { dir } = makeRepo('configglobal');
  const evilDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-evilglobal-'));
  const evilConfig = resolve(evilDir, 'attacker-gitconfig');
  try {
    writeFileSync(evilConfig, '[user]\n\tname = AttackerPerson\n\temail = attacker@example.invalid\n');
    const env = hermetic({ GIT_CONFIG_GLOBAL: evilConfig });

    // Armed control: left unstripped, GIT_CONFIG_GLOBAL really does redirect global config to
    // the attacker's file — the fixture is not accidentally invisible for some other reason.
    const raw = spawnSync('git', ['-C', dir, 'config', '--show-scope', '--get', 'user.name'],
      { encoding: 'utf8', env });
    assert.equal(raw.stdout.trim(), 'global\tAttackerPerson',
      `control: unstripped, GIT_CONFIG_GLOBAL must redirect to the attacker's file; got ${
        JSON.stringify(raw)}`);

    const r = inspect(['identity'], { cwd: dir, env });
    assert.equal(r.status, 0, `inspect identity failed: ${r.stderr}`);
    const nameLines = r.stdout.split('\n').filter((l) => l.startsWith('user.name\t'));
    assert.ok(!nameLines.some((l) => l.includes('AttackerPerson')),
      `the script must strip GIT_CONFIG_GLOBAL before reading config, never surfacing the `
      + `attacker's redirected value; got ${JSON.stringify(nameLines)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(evilDir, { recursive: true, force: true });
  }
});

test('P8y: an inherited GIT_CONFIG_SYSTEM cannot forge the AI-guard verdict or run arbitrary '
  + 'config-triggered commands — the script strips it before asking git', () => {
  // Round 20 review, P0 (fallback `strict-reviewer`, findings advisory but the underlying defect
  // confirmed independently here). `GIT_CONFIG_SYSTEM` was left unstripped through round 19 on
  // the theory its fallback path has "no HOME-shaped escape hatch" — true for the DEFAULT
  // fallback, but irrelevant once an attacker can just set the variable directly: unlike
  // GIT_CONFIG_NOSYSTEM (pure downgrade), GIT_CONFIG_SYSTEM REPOINTS config resolution the same
  // way GIT_CONFIG_GLOBAL does, and `core.hooksPath` in that redirected file reaches `guard` —
  // an Anchor-level control (CLAUDE.md rule 3: the AI-attribution guard) — making an env-only
  // attacker able to forge `guard:installed` for a hook the repository does not actually have.
  // The same redirect also lets `core.fsmonitor` run an arbitrary command under
  // `collect`/`status` — asserted for the HOME-reachable case by `P8z2` below (round 21
  // review, Nit: this comment used to say "reproduced independently" here without a matching
  // assertion in this test). This test pins the guard-forgery half, the sharper of the two
  // since it inverts a security control rather than merely misinforming a diagnostic.
  const { dir } = makeRepo('configsystem');
  const attackDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-sysattack-'));
  const attackConfig = resolve(attackDir, 'gitconfig');
  const attackHooksDir = resolve(attackDir, 'hooks');
  try {
    mkdirSync(attackHooksDir);
    writeFileSync(resolve(attackHooksDir, 'commit-msg'), '#!/bin/sh\nexit 0\n');
    chmodSync(resolve(attackHooksDir, 'commit-msg'), 0o755);
    writeFileSync(attackConfig, `[core]\n\thooksPath = ${attackHooksDir}\n`);
    const env = hermetic({ GIT_CONFIG_SYSTEM: attackConfig });

    // Armed control: left unstripped, GIT_CONFIG_SYSTEM really does redirect core.hooksPath to
    // the attacker's directory — the fixture is not accidentally invisible for some other
    // reason. Direct git call, no script involved.
    const rawHooksPath = spawnSync('git', ['-C', dir, 'rev-parse', '--git-path', 'hooks/commit-msg'],
      { encoding: 'utf8', env }).stdout.trim();
    assert.equal(rawHooksPath, resolve(attackHooksDir, 'commit-msg'),
      `control: unstripped, GIT_CONFIG_SYSTEM must redirect hooksPath to the attacker's `
      + `directory; got ${JSON.stringify(rawHooksPath)}`);

    const r = inspect(['guard'], { cwd: dir, env });
    assert.equal(r.status, 0, `inspect guard failed: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'guard:missing',
      'the script must strip GIT_CONFIG_SYSTEM before asking git for the hooks path, so an '
      + `attacker-forged commit-msg hook cannot read back as installed; got ${
        JSON.stringify(r.stdout)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(attackDir, { recursive: true, force: true });
  }
});

test('P8z: an inherited HOME cannot forge the AI-guard verdict via a non-local core.hooksPath '
  + '— the script only trusts a local/worktree-scoped setting', () => {
  // Round 21 review, P1. Round 20 stripped GIT_CONFIG_SYSTEM (P8y above) on the theory that
  // closed the config-repoint channel into core.hooksPath — but the identical attack is
  // reachable through HOME alone: $HOME/.gitconfig is read at "global" scope exactly like a
  // GIT_CONFIG_GLOBAL-redirected file, and HOME cannot be stripped — `identity` needs it as
  // genuine load-bearing input. The fix is not another name in the unset block: `guard` now
  // asks git for core.hooksPath's SCOPE and trusts only local/worktree, falling back to the
  // built-in `<git-common-dir>/hooks` location for anything else — closing the channel for
  // every scope this process does not control, not just the one round 20 happened to name.
  const { dir } = makeRepo('homehookspath');
  const attackHome = mkdtempSync(resolve(tmpdir(), 'sc-inspect-homeattack-'));
  const attackHooksDir = resolve(attackHome, 'hooks');
  try {
    mkdirSync(attackHooksDir);
    writeFileSync(resolve(attackHooksDir, 'commit-msg'), '#!/bin/sh\nexit 0\n');
    chmodSync(resolve(attackHooksDir, 'commit-msg'), 0o755);
    writeFileSync(resolve(attackHome, '.gitconfig'), `[core]\n\thooksPath = ${attackHooksDir}\n`);
    const env = hermetic({ HOME: attackHome });

    // Armed control: hermetic()'s own GIT_CONFIG_GLOBAL/SYSTEM='/dev/null' defaults would
    // otherwise mask $HOME/.gitconfig from being read at all — the same reason they now mask
    // GIT_CONFIG_SYSTEM's real-machine control for P8r (see the P2 note on `hermetic()`
    // above). Dropped here, raw git really does read hooksPath from $HOME/.gitconfig.
    const controlEnv = { ...env };
    delete controlEnv.GIT_CONFIG_GLOBAL;
    delete controlEnv.GIT_CONFIG_SYSTEM;
    const rawHooksPath = spawnSync('git', ['-C', dir, 'rev-parse', '--git-path', 'hooks/commit-msg'],
      { encoding: 'utf8', env: controlEnv }).stdout.trim();
    assert.equal(rawHooksPath, resolve(attackHooksDir, 'commit-msg'),
      `control: an unrestricted HOME must redirect hooksPath to the attacker's directory; got ${
        JSON.stringify(rawHooksPath)}`);

    const r = inspect(['guard'], { cwd: dir, env });
    assert.equal(r.status, 0, `inspect guard failed: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'guard:missing',
      'the script must not trust a non-local-scoped core.hooksPath, so a HOME-forged '
      + `commit-msg hook cannot read back as installed; got ${JSON.stringify(r.stdout)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(attackHome, { recursive: true, force: true });
  }
});

test('P8z2: an inherited HOME cannot make `status` run an attacker-configured core.fsmonitor '
  + 'command', () => {
  // Round 21 review, P1 — the second half of the same finding as P8z. `core.fsmonitor` set to
  // a shell command is arbitrary command execution the moment status-touching git runs it
  // (empirically confirmed), and HOME reaches it exactly as it reaches core.hooksPath above.
  // The fix pins `-c core.fsmonitor=false` on every status/diff/commit call this project's
  // scripts make; a command-line `-c` always outranks a lower-scoped value, closing the
  // channel for every scope, not just the ones an env var happens to name.
  const { dir } = makeRepo('homefsmonitor');
  const attackHome = mkdtempSync(resolve(tmpdir(), 'sc-inspect-homefsmon-'));
  const marker = resolve(attackHome, 'pwned');
  try {
    writeFileSync(resolve(attackHome, '.gitconfig'), `[core]\n\tfsmonitor = touch ${marker}; true\n`);
    const env = hermetic({ HOME: attackHome });

    const controlEnv = { ...env };
    delete controlEnv.GIT_CONFIG_GLOBAL;
    delete controlEnv.GIT_CONFIG_SYSTEM;
    spawnSync('git', ['-C', dir, 'status', '--short'], { encoding: 'utf8', env: controlEnv });
    assert.ok(existsSync(marker),
      'control: an unrestricted HOME must let core.fsmonitor run the attacker command');
    rmSync(marker, { force: true });

    const r = inspect(['status'], { cwd: dir, env });
    assert.equal(r.status, 0, `inspect status failed: ${r.stderr}`);
    assert.ok(!existsSync(marker),
      'the script must pin core.fsmonitor=false, so a HOME-configured command must never run '
      + `(marker file exists: ${existsSync(marker)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(attackHome, { recursive: true, force: true });
  }
});

test('P8z3: a --show-scope failure that is not "key not found" must not read as unset — guard '
  + 'fails closed instead of trusting a forged hooksPath', () => {
  // Round 22 review, P0. `git config --show-scope --get core.hooksPath 2>/dev/null` used to
  // discard its exit code, so ANY failure — not just the genuinely-unset case (exit 1) — left
  // `$scope_line` empty and the old code read empty exactly like unset, trusting it. Git < 2.26
  // rejecting `--show-scope` outright (P8f above, exit 129) is the concrete case: on such a git,
  // this shim's exit 128 stands in for it. The fix captures `$?` and only exit 1 counts as
  // trusted-unset; anything else must fail closed to untrusted, whatever the scope line says.
  const { dir } = makeRepo('showscopefail');
  const attackHome = mkdtempSync(resolve(tmpdir(), 'sc-inspect-scopefail-'));
  const attackHooksDir = resolve(attackHome, 'hooks');
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-scopefail-shim-'));
  try {
    mkdirSync(attackHooksDir);
    writeFileSync(resolve(attackHooksDir, 'commit-msg'), '#!/bin/sh\nexit 0\n');
    chmodSync(resolve(attackHooksDir, 'commit-msg'), 0o755);
    writeFileSync(resolve(attackHome, '.gitconfig'), `[core]\n\thooksPath = ${attackHooksDir}\n`);

    // Armed control: the shim's config trap really does fail with a NON-1 exit code. Exit 1 is
    // git's own "key not found" code for `config --get` — the ALREADY-trusted case — so a test
    // built on it would prove nothing about the fail-closed branch this targets.
    const shimEnv = { ...gitShim(shimDir, 'fail'), HOME: attackHome };
    const rawScope = spawnSync('git',
      ['-C', dir, 'config', '--show-scope', '--get', 'core.hooksPath'],
      { encoding: 'utf8', env: shimEnv });
    assert.notEqual(rawScope.status, 1,
      `control: the shim must not fail with git's "key not found" code; got ${rawScope.status}`);
    assert.notEqual(rawScope.status, 0, 'control: the shim must actually fail the config read');

    // And the attacker hooksPath really is what an unrestricted HOME would resolve to — the
    // same control P8z runs, repeated here because the shim changes the config-read path this
    // guard verdict is derived from.
    const controlEnv = { ...shimEnv };
    delete controlEnv.GIT_CONFIG_GLOBAL;
    delete controlEnv.GIT_CONFIG_SYSTEM;
    const rawHooksPath = spawnSync('git',
      ['-C', dir, 'rev-parse', '--git-path', 'hooks/commit-msg'],
      { encoding: 'utf8', env: controlEnv }).stdout.trim();
    assert.equal(rawHooksPath, resolve(attackHooksDir, 'commit-msg'),
      'control: an unrestricted HOME must still redirect hooksPath to the attacker directory '
      + `once the scope read is out of the way; got ${JSON.stringify(rawHooksPath)}`);

    const r = inspect(['guard'], { cwd: dir, env: shimEnv });
    assert.equal(r.status, 0, `inspect guard failed: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'guard:missing',
      'a --show-scope failure that is not "key not found" must fail closed to untrusted — '
      + `reading it as unset would forge an installed verdict from the attacker hooksPath; got ${
        JSON.stringify(r.stdout)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(attackHome, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
});

test('P8z4: an inherited HOME cannot make `status` run an attacker-configured core.attributesFile '
  + 'clean filter', () => {
  // Round 22 review, P2 (found by independent testing against this project's own scripts, not
  // by either reviewer): `core.fsmonitor` is not the only knob HOME reaches — `core.attributesFile`
  // plus a `filter.<name>.clean` command is a SEPARATE arbitrary-command channel, empirically
  // confirmed to fire on `status`/`diff` (and, per the execute-side test of the same name, on a
  // plain `git commit` too). The fix pins `-c core.attributesFile=/dev/null` alongside the
  // existing fsmonitor pin on every status/diff call this script makes.
  const { dir, git } = makeRepo('homeattributesfile');
  const attackHome = mkdtempSync(resolve(tmpdir(), 'sc-inspect-homeattrs-'));
  const marker = resolve(attackHome, 'pwned');
  try {
    writeFileSync(resolve(dir, 'watched.txt'), 'x\n');
    git('add', '--', 'watched.txt');
    git('commit', '-q', '-m', 'seed a tracked file for the attributes match to apply to');
    writeFileSync(resolve(dir, 'watched.txt'), 'x\nchanged\n');

    const attrFile = resolve(attackHome, 'gitattributes');
    writeFileSync(attrFile, '* filter=evil\n');
    writeFileSync(resolve(attackHome, '.gitconfig'),
      `[core]\n\tattributesFile = ${attrFile}\n[filter "evil"]\n\tclean = touch ${marker}; cat\n`);
    const env = hermetic({ HOME: attackHome });

    const controlEnv = { ...env };
    delete controlEnv.GIT_CONFIG_GLOBAL;
    delete controlEnv.GIT_CONFIG_SYSTEM;
    spawnSync('git', ['-C', dir, 'status', '--short'], { encoding: 'utf8', env: controlEnv });
    assert.ok(existsSync(marker),
      'control: an unrestricted HOME must let core.attributesFile run the attacker clean filter');
    rmSync(marker, { force: true });

    const r = inspect(['status'], { cwd: dir, env });
    assert.equal(r.status, 0, `inspect status failed: ${r.stderr}`);
    assert.ok(!existsSync(marker),
      'the script must pin core.attributesFile=/dev/null, so a HOME-configured clean filter must '
      + `never run (marker file exists: ${existsSync(marker)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(attackHome, { recursive: true, force: true });
  }
});

test('P8z5: every status/diff call this script makes pins BOTH core.fsmonitor=false and '
  + 'core.attributesFile=/dev/null — neither pin is dropped from a call site the other keeps', () => {
  // Round 22 review, P2, structural anchoring per round 23 review, P2: a per-behaviour live-attack
  // test (P8z2, P8z4 above) proves the pins work somewhere, but this script has seven status/diff
  // call sites (collect ×3, status, scope, diff ×2) and a live attack against one tells nothing
  // about the other six. A source oracle is the only check that sees all of them at once — the
  // two live-attack tests stay as the proof the pins actually stop something; this is the proof
  // nothing silently lost one.
  //
  // Anchored on WORD POSITION (`-C` immediately followed by the word `"$REPO_ROOT"` immediately
  // followed by the word `status`/`diff`), not on a substring match against the raw line: a
  // whole-line regex reads `--diff-filter` as containing `diff` and would misfire on a future
  // call site spelled that way, and could equally be defeated by re-flowing one call across two
  // lines (`shellWords` below only needs one line per call because every actual site here is
  // single-line — a call that stopped being would fail the `git` == words[0] check and be
  // silently excluded, which is why the count assertion exists as a backstop).
  const shellWords = (line) => {
    const words = [];
    let cur = '';
    let quote = null;
    for (const c of line) {
      if (quote) { cur += c; if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") { cur += c; quote = c; continue; }
      if (/\s/.test(c)) { if (cur) { words.push(cur); cur = ''; } continue; }
      cur += c;
    }
    if (cur) words.push(cur);
    return words;
  };
  const hasFlag = (words, value) => words.some(
    (w, i) => w === '-c' && words[i + 1] === value,
  );
  const src = readFileSync(inspectPath, 'utf8');
  const callSites = src.split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => shellWords(l.trim()))
    .filter((words) => words[0] === 'git' && words.some(
      (w, i) => w === '-C' && words[i + 1] === '"$REPO_ROOT"'
        && (words[i + 2] === 'status' || words[i + 2] === 'diff'),
    ));
  assert.equal(callSites.length, 7,
    `expected exactly 7 status/diff call sites; found ${callSites.length} — update this count `
    + 'deliberately if a call site was added or removed, then re-check its pins');
  for (const words of callSites) {
    assert.ok(hasFlag(words, 'core.fsmonitor=false'),
      `every status/diff call must pin core.fsmonitor=false: ${words.join(' ')}`);
    assert.ok(hasFlag(words, 'core.attributesFile=/dev/null'),
      `every status/diff call must pin core.attributesFile=/dev/null: ${words.join(' ')}`);
  }
});

test('P8z6: `status` refuses when the repository\'s own .gitattributes names a filter driver whose '
  + 'command is configured outside the repository', () => {
  // Round 23 review, P0, reproduced live (execute-side test of the same name; this is the
  // identical channel on the READ side): `core.attributesFile=/dev/null` (P8z4 above) only
  // blocks an ATTACKER-NAMED `.gitattributes`. A `.gitattributes` the repository itself tracks
  // (the git-lfs shape: `* filter=lfs`) is legitimate — but the COMMAND that filter name
  // resolves to (`filter.<name>.clean`) is an ordinary config lookup, reachable through the
  // same HOME channel P8z2/P8z4 already distrust. `refuse_on_untrusted_content_drivers` runs
  // this same scope check before every status/diff/collect/scope call.
  const { dir, git } = makeRepo('filterdriver');
  const attackHome = mkdtempSync(resolve(tmpdir(), 'sc-inspect-filterdriver-'));
  const marker = resolve(attackHome, 'pwned');
  try {
    writeFileSync(resolve(dir, '.gitattributes'), 'secret.bin filter=cleanfilter\n');
    git('add', '--', '.gitattributes');
    git('commit', '-q', '-m', 'track a filter assignment (repo-owned, trusted)');
    writeFileSync(resolve(attackHome, '.gitconfig'),
      `[filter "cleanfilter"]\n\tclean = touch ${marker}; cat\n`);
    const env = hermetic({ HOME: attackHome });

    // Armed control: staging under the attack HOME, with the repo's own real .gitattributes in
    // place, must run the externally-configured clean filter.
    const controlEnv = { ...env };
    delete controlEnv.GIT_CONFIG_GLOBAL;
    delete controlEnv.GIT_CONFIG_SYSTEM;
    writeFileSync(resolve(dir, 'secret.bin'), 'plain content\n');
    spawnSync('git', ['-C', dir, 'add', 'secret.bin'], { encoding: 'utf8', env: controlEnv });
    assert.ok(existsSync(marker),
      "control: staging under an unrestricted HOME must run the clean filter the repo's own "
      + '.gitattributes names');
    rmSync(marker, { force: true });
    spawnSync('git', ['-C', dir, 'reset'], { encoding: 'utf8', env: controlEnv });

    const r = inspect(['status'], { cwd: dir, env });
    assert.notEqual(r.status, 0, 'a status call must refuse rather than silently proceed');
    assert.ok(!existsSync(marker),
      'the externally-configured clean filter must never run '
      + `(marker file exists: ${existsSync(marker)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(attackHome, { recursive: true, force: true });
  }
});

test('P8z7: a failing `git ls-files` in the content-driver check aborts `status` rather than '
  + 'reading as "no drivers found"', () => {
  // Round 24 review, P1: the identical fail-open gap execute.sh had (see that file's test of
  // the same shape) — `if ! ls-files | check-attr; then …` reflects only check-attr's exit
  // status, so a failing `ls-files` still "succeeds" with empty output, read as "no drivers".
  // `PIPESTATUS` now covers both stages here too. The shim fails only the one `ls-files` call
  // this function makes (verified unique in the file); every other git call passes.
  const { dir } = makeRepo('lsfilesfail');
  const realGit = spawnSync('/bin/bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-lsfilesfail-'));
  writeFileSync(resolve(shimDir, 'git'),
    `#!/bin/bash\nfor a in "$@"; do [ "$a" = ls-files ] && exit 1; done\nexec ${realGit} "$@"\n`,
    { mode: 0o755 });
  try {
    const env = hermetic({ PATH: `${shimDir}:${process.env.PATH}` });
    const r = inspect(['status'], { cwd: dir, env });
    assert.notEqual(r.status, 0,
      `an unreadable ls-files must abort status, not silently proceed: ${r.stderr}`);
    assert.match(r.stderr, /could not resolve gitattributes/,
      'the failure must be reported, not swallowed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
});

test('P8z7b: a failing `git check-attr` (the pipeline\'s SECOND stage) also aborts `status` '
  + 'rather than reading as "no drivers found"', () => {
  // Round 24 re-review, P2: P8z7 above proves a failing FIRST stage (`ls-files`) is caught;
  // nothing proved the SECOND stage (`check-attr`) is too. Both `rc[0]`/`rc[1]` are checked in
  // the source, but a test that only ever fails index 0 cannot distinguish a real two-index
  // check from one that happens to pass because index 0 is the only failure ever exercised.
  const { dir } = makeRepo('checkattrfail');
  const realGit = spawnSync('/bin/bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-checkattrfail-'));
  writeFileSync(resolve(shimDir, 'git'),
    `#!/bin/bash\nfor a in "$@"; do [ "$a" = check-attr ] && exit 1; done\nexec ${realGit} "$@"\n`,
    { mode: 0o755 });
  try {
    const env = hermetic({ PATH: `${shimDir}:${process.env.PATH}` });
    const r = inspect(['status'], { cwd: dir, env });
    assert.notEqual(r.status, 0,
      `an unreadable check-attr must abort status, not silently proceed: ${r.stderr}`);
    assert.match(r.stderr, /could not resolve gitattributes/,
      'the failure must be reported, not swallowed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
});

test('P8z8: an untracked pathname that reads like a driver assignment cannot itself trigger or '
  + 'mask a refusal — only the real .gitattributes assignment does', () => {
  // Round 24 review, P0: the parser this replaced matched a driver name against the raw
  // check-attr output text, so a pathname carrying attribute-like text (e.g. `filter=`) could
  // shift which triple's VALUE field was read, defeating or spoofing the check without any
  // real .gitattributes assignment. `check-attr -z`'s NUL-delimited triples make a path's own
  // content inert to the parser — it is consumed as exactly one opaque field regardless of
  // what bytes it contains. Two files: one with a real, untrusted `filter` assignment (must be
  // refused); a sibling whose NAME itself reads like an assignment line but carries no real
  // attribute (must NOT be refused, and must not suppress the real one either).
  const { dir, git } = makeRepo('pathconfuse');
  const attackHome = mkdtempSync(resolve(tmpdir(), 'sc-inspect-pathconfuse-'));
  const marker = resolve(attackHome, 'pwned');
  try {
    writeFileSync(resolve(dir, '.gitattributes'), 'secret.bin filter=cleanfilter\n');
    git('add', '--', '.gitattributes');
    git('commit', '-q', '-m', 'track a filter assignment (repo-owned, trusted)');
    writeFileSync(resolve(attackHome, '.gitconfig'),
      `[filter "cleanfilter"]\n\tclean = touch ${marker}; cat\n`);
    const env = hermetic({ HOME: attackHome });

    // The real, untracked match for the repo's own rule — this is what must be refused.
    writeFileSync(resolve(dir, 'secret.bin'), 'plain content\n');
    // The decoy: its own filename is `secret.bin filter=evil`, unrelated to any real
    // .gitattributes rule, so it must be reported `unspecified` and change nothing.
    writeFileSync(resolve(dir, 'secret.bin filter=evil'), 'unrelated untracked content\n');
    // A sharper decoy than the one above (round 24 re-review, P2: strengthens this test to
    // actually distinguish the NUL-delimited parser from a line-oriented one, which the first
    // decoy alone does not — it contains no newline, so it cannot tell the two apart). Filenames
    // may legally contain a literal newline on this filesystem; a `while read -r line`-style
    // parser over check-attr's non-`-z` TEXT output would see that byte as a LINE BREAK, so an
    // adversarial name shaped like a fake `path: filter: name` record could inject or shift a
    // record boundary. `-z` plus the `read -r -d ''` triple loop treats the whole filename,
    // newline included, as one opaque field — this proves that holds under a name deliberately
    // built to look like a second record if it were not.
    writeFileSync(resolve(dir, 'nl-decoy.bin\nfaketriple.bin: filter: injected'),
      'unrelated untracked content, newline-bearing name\n');

    const r = inspect(['status'], { cwd: dir, env });
    assert.notEqual(r.status, 0,
      'the real, tracked filter assignment must still be refused with both decoys present');
    assert.ok(!existsSync(marker),
      `the externally-configured clean filter must never run (marker exists: ${existsSync(marker)})`);
    assert.match(r.stderr, /reachable through HOME/,
      'the refusal must be the content-driver one, not some unrelated failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(attackHome, { recursive: true, force: true });
  }
});

test('P8z9: `scope`/`diff` refuse on a tracked filter driver even when their own pathspec '
  + 'argument names a different, unrelated file', () => {
  // Round 24 re-review, P1: `scope`/`diff` used to pass their OWN pathspec argument down into
  // `refuse_on_untrusted_content_drivers`, narrowing the driver check to files under that
  // pathspec. But `git status`/`git diff` refresh racily-clean index entries across the WHOLE
  // tracked+untracked tree internally regardless of what pathspec the caller gave for
  // reporting — so a caller-supplied pathspec that happens to exclude the file carrying the
  // untrusted driver assignment used to leave that driver free to run while the check itself
  // reported "no drivers found" for the narrowed set. The fix (mirroring P8z6's `status`
  // proof) drops the pathspec from the driver check entirely; this proves `scope`/`diff`
  // still refuse when invoked on a path that names none of the files the driver touches.
  const { dir, git } = makeRepo('scopediffnarrow');
  const attackHome = mkdtempSync(resolve(tmpdir(), 'sc-inspect-scopediffnarrow-'));
  const marker = resolve(attackHome, 'pwned');
  try {
    writeFileSync(resolve(dir, '.gitattributes'), 'secret.bin filter=cleanfilter\n');
    git('add', '--', '.gitattributes');
    git('commit', '-q', '-m', 'track a filter assignment (repo-owned, trusted)');
    writeFileSync(resolve(attackHome, '.gitconfig'),
      `[filter "cleanfilter"]\n\tclean = touch ${marker}; cat\n`);
    const env = hermetic({ HOME: attackHome });

    // secret.bin (untracked, carries the untrusted driver) is left OUT of the pathspec below —
    // only a wholly unrelated file is named, which is exactly the narrowing this test guards.
    writeFileSync(resolve(dir, 'secret.bin'), 'plain content\n');
    writeFileSync(resolve(dir, 'unrelated.txt'), 'nothing to do with the driver\n');

    const scopeResult = inspect(['scope', 'unrelated.txt'], { cwd: dir, env });
    assert.notEqual(scopeResult.status, 0,
      '`scope unrelated.txt` must still refuse — the driver check must not be narrowed to the '
      + `pathspec it was given; got status ${scopeResult.status}`);
    assert.ok(!existsSync(marker),
      `the externally-configured clean filter must never run via scope (marker exists: ${
        existsSync(marker)})`);

    const diffResult = inspect(['diff', 'unrelated.txt'], { cwd: dir, env });
    assert.notEqual(diffResult.status, 0,
      '`diff unrelated.txt` must still refuse for the same reason; got status '
      + diffResult.status);
    assert.ok(!existsSync(marker),
      `the externally-configured clean filter must never run via diff (marker exists: ${
        existsSync(marker)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(attackHome, { recursive: true, force: true });
  }
});

// Round 24 re-review, P2 (found alongside P8z9 above): the "takes no pathspec" contract P8z9
// proves BEHAVIOURALLY (every current caller passes none) was, until now, only a comment —
// `refuse_on_untrusted_content_drivers` still forwarded `"$@"` into `ls-files`, so the P1 this
// function closes could reopen the moment any future `scope`/`diff` edit passed one back in,
// with no test failing because none of the four current call sites do. The fix enforces the
// contract in the function itself; this is a static proof because the parameter is not
// reachable from the CLI at all (every caller is fixed, argument-free source inside this
// script) — there is no behavioural path left to exercise once the invariant holds statically.
test('refuse_on_untrusted_content_drivers enforces its own "no pathspec" contract in source, '
  + 'not only in the comment describing it', () => {
  const src = readFileSync(inspectPath, 'utf8');
  const fnStart = src.indexOf('refuse_on_untrusted_content_drivers() {');
  assert.ok(fnStart >= 0, 'the function definition must exist to inspect');
  const fnEnd = src.indexOf('\ncase "$sub" in', fnStart);
  assert.ok(fnEnd > fnStart, 'must be able to bound the function body');
  const body = src.slice(fnStart, fnEnd);

  assert.match(body, /\[\s*"\$#"\s*-eq\s*0\s*\]\s*\|\|\s*\{/,
    'the function must fail fast on a nonzero argument count, not merely document that it '
    + 'expects none');
  assert.doesNotMatch(body, /ls-files[^\n]*--\s+"\$@"/,
    'the ls-files call must no longer forward "$@" — the pathspec parameter must go unused '
    + 'end to end, matching the docstring\'s "takes no pathspec" contract');
});

test('P8z10: a signal during the content-driver check does not leak its scratch file', async () => {
  // Round 24 re-review, P2: every explicit return path in `refuse_on_untrusted_content_drivers`
  // already `rm -f`s its scratch file, but nothing covered a signal landing in the window
  // between the `mktemp` and one of those removals — a `kill` mid-check leaked a
  // `smart-commit-attr.*` file in `${TMPDIR:-/tmp}` every time. The fix is a trap scoped to
  // this one function; this proves it fires under a real SIGTERM, not just on the happy path.
  const { dir } = makeRepo('attrsignal');
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-attrsignal-shim-'));
  const marker = resolve(shimDir, 'started');
  const realGit = spawnSync('/bin/bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const scratchTmp = mkdtempSync(resolve(tmpdir(), 'sc-inspect-attrsignal-tmp-'));
  // Intercepts only the `check-attr` call — stage 2 of the driver check's own pipeline —
  // so every other git call the script makes passes straight through and the script reaches
  // the real signal-vulnerable window instead of failing for an unrelated reason.
  writeFileSync(resolve(shimDir, 'git'), [
    '#!/bin/bash',
    'for a in "$@"; do',
    `  if [ "$a" = check-attr ]; then touch ${JSON.stringify(marker)}; sleep 5; fi`,
    'done',
    `exec ${realGit} "$@"`,
  ].join('\n'), { mode: 0o755 });
  try {
    const env = hermetic({ PATH: `${shimDir}:${process.env.PATH}`, TMPDIR: scratchTmp });
    const child = spawn('/bin/bash', ['-p', '--', inspectPath, 'status'], { cwd: dir, env });
    let stderrBuf = '';
    child.stderr.on('data', (d) => { stderrBuf += d; });

    // Poll for the marker rather than a fixed sleep: the shim's own scheduling delay before
    // `check-attr` runs is not guaranteed, and a fixed sleep either races or wastes time. The
    // 5s cap fails fast (rather than hanging) if the shim never intercepts as expected.
    const deadline = Date.now() + 5000;
    while (!existsSync(marker) && Date.now() < deadline) await sleep(25);
    assert.ok(existsSync(marker),
      'the check-attr shim must have started, or this test proves nothing about the signal window');

    child.kill('SIGTERM');
    const exitCode = await new Promise((res) => child.on('exit', (code) => res(code)));
    assert.equal(exitCode, 143,
      `SIGTERM must exit 143 via the explicit trap; stderr so far: ${stderrBuf}`);

    const leftover = readdirSync(scratchTmp).filter((f) => f.startsWith('smart-commit-attr.'));
    assert.deepEqual(leftover, [],
      `the scratch attribute file must not survive a SIGTERM mid-check; found: ${leftover.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
    rmSync(scratchTmp, { recursive: true, force: true });
  }
});

test('P8z10b: with the signal trap removed, the identical scenario really does leak — the '
  + 'guard above is what closes it', async () => {
  // Mutation control, per testing.md's guard-deletion check: delete the traps P8z10 depends
  // on and the same attack must leave the scratch file behind, or P8z10 could be passing for
  // a reason that has nothing to do with the fix it claims to prove.
  const src = readFileSync(inspectPath, 'utf8');
  const anchor = [
    '  trap "rm -f -- $(printf \'%q\' "$attrfile")" EXIT',
    "  trap 'exit 130' INT",
    "  trap 'exit 143' TERM",
    "  trap 'exit 129' HUP",
  ].join('\n');
  assert.ok(src.includes(anchor), 'the trap block must still be present, verbatim, to mutate');
  const mutated = src.replace(anchor, '');
  assert.notEqual(mutated, src, 'the mutation must actually have applied');

  const { dir } = makeRepo('attrsignalmutant');
  const mutantPath = resolve(dir, 'inspect-mutant.sh');
  writeFileSync(mutantPath, mutated, { mode: 0o755 });
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-attrsignalmutant-shim-'));
  const marker = resolve(shimDir, 'started');
  const realGit = spawnSync('/bin/bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const scratchTmp = mkdtempSync(resolve(tmpdir(), 'sc-inspect-attrsignalmutant-tmp-'));
  writeFileSync(resolve(shimDir, 'git'), [
    '#!/bin/bash',
    'for a in "$@"; do',
    `  if [ "$a" = check-attr ]; then touch ${JSON.stringify(marker)}; sleep 5; fi`,
    'done',
    `exec ${realGit} "$@"`,
  ].join('\n'), { mode: 0o755 });
  try {
    const env = hermetic({ PATH: `${shimDir}:${process.env.PATH}`, TMPDIR: scratchTmp });
    const child = spawn('/bin/bash', ['-p', '--', mutantPath, 'status'], { cwd: dir, env });
    const deadline = Date.now() + 5000;
    while (!existsSync(marker) && Date.now() < deadline) await sleep(25);
    assert.ok(existsSync(marker), 'the check-attr shim must have started, or this control proves nothing');

    child.kill('SIGTERM');
    await new Promise((res) => child.on('exit', res));

    const leftover = readdirSync(scratchTmp).filter((f) => f.startsWith('smart-commit-attr.'));
    assert.notDeepEqual(leftover, [],
      'control: with the trap removed, a SIGTERM mid-check must leak the scratch file — if it '
      + "didn't, P8z10 isn't testing what it claims to");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
    rmSync(scratchTmp, { recursive: true, force: true });
  }
});

test('P8o: `effective` answers with what git would record, not with what the records say', () => {
  // Round 14, P2. A `value` record cannot express an ident git will REFUSE: git's parser
  // strips whitespace and `<`/`>`, so a configured value that looks fine can reduce to
  // nothing. Before this line existed, Step 1c read the config record and planned a commit
  // that `git commit` then rejected.
  const { dir, git } = makeRepo('effective');
  try {
    git('config', 'user.name', 'Dev');
    git('config', 'user.email', 'fixture@example.invalid');
    const ok = inspect(['identity'], { cwd: dir });
    assert.equal(effectiveOf(ok.stdout, 'author'),
      'effective\tauthor\tvalue\tDev <fixture@example.invalid>',
      'the ordinary case is the ident itself, with git\'s trailing timestamp stripped');

    git('config', 'user.name', '   ');
    const r = inspect(['identity'], { cwd: dir });
    assert.equal(r.status, 0, 'an unusable identity is an answer, not a read failure');
    // Armed control: the config channel still calls it a perfectly good `value`. That gap
    // IS the finding — without the effective line there is nothing here to read.
    const nameLine = r.stdout.trim().split('\n').find((l) => l.startsWith('user.name\t'));
    assert.match(nameLine, /^user\.name\tvalue\t/,
      'control: the config record cannot express that git will refuse this');
    assert.equal(effectiveOf(r.stdout, 'author'), 'effective\tauthor\tunresolvable',
      'the effective line says the commit is impossible, which is what Step 1c must act on');

    // And it agrees with git, which is the whole claim: same repo, real commit attempt.
    writeFileSync(resolve(dir, 'f.txt'), 'x\n');
    const staged = spawnSync('git', ['-C', dir, 'add', '--', 'f.txt'], { env: hermetic() });
    assert.equal(staged.status, 0, 'staging must succeed for the commit attempt to be meaningful');
    const commit = spawnSync('git', ['-C', dir, 'commit', '-m', 'test'],
      { encoding: 'utf8', env: hermetic() });
    assert.notEqual(commit.status, 0, 'git must actually refuse — otherwise `unresolvable` lies');
    assert.match(commit.stderr, /disallowed characters/,
      'and refuse for the reason the effective line is reporting');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P8p: `effective` exposes the EMAIL fallback, which no config or env record reports', () => {
  // Round 14, P2. `EMAIL` sits in git's chain between `user.email` and the OS guess. It is
  // not a git config, so no `--get-all` reports it, and it is deliberately not in the unset
  // block — stripping it would change which identity the commit gets. The only honest way to
  // surface it is to report the resolved answer.
  const { dir, git } = makeRepo('emailfallback');
  try {
    git('config', 'user.name', 'Dev');
    const r = inspect(['identity'], { cwd: dir, env: hermetic({ EMAIL: 'corp@example.invalid' }) });
    const emailLine = r.stdout.trim().split('\n').find((l) => l.startsWith('user.email\t'));
    assert.equal(emailLine, 'user.email\tunset',
      'control: every record channel says the email is not configured …');
    assert.equal(effectiveOf(r.stdout, 'author'),
      'effective\tauthor\tvalue\tDev <corp@example.invalid>',
      '… while the commit would carry the EMAIL value, which only this line can show');
    // Negative control: without EMAIL the same repo resolves to something else entirely, so
    // the assertion above is measuring the variable and not a fixed fixture string.
    const bare = inspect(['identity'], { cwd: dir });
    assert.doesNotMatch(effectiveOf(bare.stdout, 'author'), /corp@example\.invalid/,
      'control: with EMAIL absent the address must not still be the EMAIL one');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P8q: the effective ident is comparable between runs and survives spaces in a name', () => {
  // `git var` appends ` <unix-seconds> <tz>`; left in, two runs a second apart disagree and
  // no caller can compare them. Stripping from the RIGHT is what keeps a name with spaces.
  const { dir, git } = makeRepo('identstrip');
  try {
    git('config', 'user.name', 'Ann Marie de la Cruz');
    git('config', 'user.email', 'fixture@example.invalid');
    const a = inspect(['identity'], { cwd: dir });
    const b = inspect(['identity'], { cwd: dir });
    assert.equal(effectiveOf(a.stdout, 'author'),
      'effective\tauthor\tvalue\tAnn Marie de la Cruz <fixture@example.invalid>',
      'every space inside the name is kept; only the two trailing fields go');
    assert.equal(effectiveOf(a.stdout, 'author'), effectiveOf(b.stdout, 'author'),
      'and two runs agree — a timestamp left in would make them differ');
    // Armed control: the raw `git var` output DOES carry the timestamp, so the assertion
    // above is measuring the strip and not an accident of the format.
    const raw = spawnSync('git', ['-C', dir, 'var', 'GIT_AUTHOR_IDENT'],
      { encoding: 'utf8', env: hermetic() }).stdout.trim();
    assert.match(raw, /\d{9,} [+-]\d{4}$/, 'control: git really does append the timestamp');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P6b: a directory at the hook path is not a usable guard', () => {
  // Round 14, escalated from Nit. `-x` alone is true for a SEARCHABLE DIRECTORY, so the
  // script answered `guard:installed` — and Step 1e "AI guard: active" — for a path git can
  // never execute. The commit-msg guard is what enforces the no-AI-attribution rule, so a
  // false "active" is a data-integrity answer, not a cosmetic one.
  const { dir } = makeRepo('guarddir');
  try {
    const hook = resolve(dir, '.git/hooks/commit-msg');
    mkdirSync(hook);
    assert.equal(inspect(['guard'], { cwd: dir }).stdout.trim(), 'guard:missing',
      'a directory cannot run as a hook, whatever its mode bits say');
    // Negative control: the same path as a real executable file must still be `installed`,
    // or this could be satisfied by a check that answers `missing` for everything.
    rmSync(hook, { recursive: true });
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    chmodSync(hook, 0o755);
    assert.equal(inspect(['guard'], { cwd: dir }).stdout.trim(), 'guard:installed',
      'control: a real executable hook is unaffected by the directory check');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P11b: signature on a repo with no commit is a non-answer, not an unsigned verdict', () => {
  // Round 14, P2. `git log -1` has nothing to report before the first commit: rc 128 and an
  // empty stdout. Read as `N` that says "unsigned", which is a verdict about a commit that
  // does not exist.
  const dir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-unborn-'));
  try {
    assert.equal(spawnSync('git', ['-C', dir, 'init', '-q', '-b', 'main'],
      { env: hermetic() }).status, 0, 'the fixture repo must initialise');
    const r = inspect(['signature'], { cwd: dir });
    assert.notEqual(r.status, 0, 'no commit to inspect must not exit 0');
    assert.equal(r.stdout.trim(), '', 'and must not print a character Step 1d would read as %G?');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P7b: a newline inside core.hooksPath is part of the path, not a line break', () => {
  // Round 14 raised the missing `printf .` sentinel as a Nit whose consequence was a false
  // `guard:missing`. It does not reproduce, and the measurement is the reason: this command's
  // answer always ends in `commit-msg`, so the only trailing newline is git's terminator.
  // The sentinel stays as a template invariant (§ 10.7); what is worth pinning is the case
  // that IS reachable — a newline in the middle of the path, where any line-splitting read
  // of git's answer would take the fragment before it and report the wrong file.
  const { dir, git } = makeRepo('hooknewline');
  try {
    const weird = resolve(dir, 'ho\noks');
    mkdirSync(weird);
    writeFileSync(resolve(weird, 'commit-msg'), '#!/bin/sh\nexit 0\n');
    chmodSync(resolve(weird, 'commit-msg'), 0o755);
    // Armed control: before the config points at it, the same tree reports `missing`, so the
    // assertion below measures the resolution and not the file's mere existence.
    assert.equal(inspect(['guard'], { cwd: dir }).stdout.trim(), 'guard:missing',
      'control: the directory is invisible until core.hooksPath names it');
    git('config', 'core.hooksPath', weird);
    assert.equal(inspect(['guard'], { cwd: dir }).stdout.trim(), 'guard:installed',
      'the newline is a path byte; splitting on it would test a path that does not exist');
    // And the measured fact the sentinel's status rests on, asserted rather than assumed.
    const resolved = spawnSync('git', ['-C', dir, 'rev-parse', '--git-path', 'hooks/commit-msg'],
      { encoding: 'utf8', env: hermetic() }).stdout;
    assert.ok(resolved.endsWith('commit-msg\n'),
      'git\'s answer ends in the filename, so its only trailing newline is the terminator');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P7c: a repository whose path ends in a newline still resolves REPO_ROOT correctly', () => {
  // Round 17 review, P2. § 10.7 names this sentinel — unlike `core.hooksPath`'s, which `P7b`
  // shows is a template invariant with nothing reachable behind it — "the one that matters,
  // because `--show-toplevel` CAN end in a newline", but nothing pinned that claim: deleting
  // `&& printf .` at line 69 (naive `REPO_ROOT=$(git rev-parse --show-toplevel)`) left every
  // test in this suite green. Armed: `--show-toplevel`'s answer for such a path is the path
  // plus git's OWN trailing newline — two newlines in a row — and `$( )` strips every trailing
  // newline it finds, so the naive form loses the real one along with git's terminator and
  // `-C` is then handed a path that does not exist.
  const parent = mkdtempSync(resolve(tmpdir(), 'sc-inspect-rootnl-'));
  const dir = resolve(parent, 'repo\n');
  try {
    mkdirSync(dir);
    const env = hermetic();
    spawnSync('git', ['-C', dir, 'init', '-q', '-b', 'branch-rootnl'], { encoding: 'utf8', env });
    writeFileSync(resolve(dir, 'seed.txt'), 'seed\n');
    spawnSync('git', ['-C', dir, 'add', '--', 'seed.txt'], { encoding: 'utf8', env });
    const commit = spawnSync('git', ['-C', dir,
      '-c', 'user.email=dev@example.com', '-c', 'user.name=Dev', '-c', 'commit.gpgsign=false',
      'commit', '-q', '-m', 'chore: seed the fixture'], { encoding: 'utf8', env });
    assert.equal(commit.status, 0, `fixture commit failed: ${commit.stderr}`);

    // Armed control: raw git's answer really does carry two trailing newlines here — the
    // literal one in the path, then its own terminator — which is what makes the naive form
    // lose the real one.
    const raw = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', env: hermetic() }).stdout;
    assert.ok(raw.endsWith('repo\n\n'),
      `control: git's own answer must carry both newlines; got ${JSON.stringify(raw)}`);

    const r = inspect(['branch'], { cwd: dir });
    assert.equal(r.status, 0,
      `the sentinel must keep REPO_ROOT resolvable even with a trailing-newline path; got ${
        JSON.stringify({ status: r.status, stderr: r.stderr })}`);
    assert.equal(r.stdout.trim(), 'branch-rootnl',
      'and the answer must be about the repository actually standing there');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('P11c: every %G? character git defines has a row in Step 1d', () => {
  // Round 14, P2. The legend used to live in a comment inside the script, which the model
  // that acts on the character never reads. Only `N` is reachable without a real signing key,
  // so the alphabet is a FACT-PIN quoted from the git 2.54.0 `git log` manual (`%G?`), not a
  // derivation — if git adds a ninth letter this test will not notice, and saying so is the
  // point. What it does catch is a row being dropped from the table.
  const script = readFileSync(inspectPath, 'utf8');
  assert.match(script, /log -1 (?:--\S+ )*--format='%G\?'/,
    'the pin is only valid while `signature` still asks for %G? specifically');

  const skill = readFileSync(skillPath, 'utf8');
  const start = skill.indexOf('/bin/bash -p -- "$INSPECT" signature');
  assert.ok(start > 0, 'Step 1d must still delegate the signature read to the script');
  const table = skill.slice(start, skill.indexOf('**Signing override flags**', start));
  for (const letter of ['G', 'B', 'U', 'X', 'Y', 'R', 'E', 'N']) {
    assert.ok(table.includes(`| \`${letter}\` |`),
      `Step 1d has no row for the %G? character \`${letter}\``);
  }
  assert.match(table, /non-zero exit/,
    'and the empty-stdout answer, which is not a %G? character, still needs its own row');
  // Negative control: the search must be able to fail.
  assert.ok(!table.includes('| `Q` |'),
    'control: a character git does not define must not be found in the table');
});

// Round 92, P2 from review: this guarded Step 1c only, and Step 1d consumes the same emitter
// since round 91 — deleting Step 1d's `commit.gpgsign<TAB>unset` row left 38/38 green. Step 1d
// is checked per KEY as well as per kind, because that table is written that way and because a
// key read with different `git config` flags (`--type=bool`) reaches a different set of kinds.
const STEP_1C_ANCHOR =
  'Decision logic — read the `effective` lines first, then use the records to locate the cause:';

test('P8k3: every env kind the script can emit has a row in Step 1c\'s decision table', () => {
  const script = readFileSync(inspectPath, 'utf8');
  const block = script.slice(script.indexOf('emit_env_record() {'), script.indexOf('\ncase "$sub"'));
  const kinds = [...block.matchAll(/printf '%s\\t(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(kinds)], ['empty', 'unset', 'value'],
    `the env kinds changed; Step 1c must change with them. Found ${kinds}`);

  const skill = readFileSync(skillPath, 'utf8');
  const start = skill.indexOf(STEP_1C_ANCHOR);
  const table = skill.slice(start, skill.indexOf('\n\nDesign principles:', start));
  for (const kind of new Set(kinds)) {
    assert.ok(table.includes(`GIT_AUTHOR_NAME<TAB>${kind}`) || table.includes(`<TAB>${kind}\` env`),
      `Step 1c has no row for an identity env var of kind \`${kind}\``);
  }
  assert.ok(!table.includes('GIT_AUTHOR_NAME<TAB>bogus'),
    'control: a kind the script cannot emit must not be found in the table');
});

const emittedKinds = (script) => {
  // One pattern for both printf forms and both terminators: a kind written
  // `printf -v line '%s\tnewkind\n'` matched neither of the two patterns this replaced.
  const kinds = [...script.matchAll(/printf (?:-v line )?'%s\\t(\w+)\\[tn]/g)].map((m) => m[1]);
  return [...new Set(kinds)].sort();
};

test('P8k: every kind the script can emit has a row in Step 1c\'s decision table', () => {
  const script = readFileSync(inspectPath, 'utf8');
  // Derived from the emitter itself, so a new kind cannot be introduced without this noticing.
  const unique = emittedKinds(script);
  assert.deepEqual(unique, ['empty', 'unset', 'value'],
    `the kinds the script emits changed; Step 1c must change with them. Found ${unique}`);

  const skill = readFileSync(skillPath, 'utf8');
  const start = skill.indexOf(STEP_1C_ANCHOR);
  assert.ok(start > 0, 'Step 1c must still carry a decision table keyed on the last record');
  const table = skill.slice(start, skill.indexOf('\n\nDesign principles:', start));
  for (const kind of unique) {
    assert.ok(table.includes(`\`${kind}\``) || table.includes(`<TAB>${kind}\``),
      `no row in Step 1c's decision table mentions the \`${kind}\` kind`);
  }
  assert.match(table, /could not read/,
    'and the read-failure answer, which is not a kind, still needs its own row');
  // Negative control: the search must be capable of failing, or the loop above proves nothing.
  assert.ok(!table.includes('`bogus`'),
    'control: a kind the script cannot emit must not be found in the table');
});

test('P8k4: every kind the `effective` channel can emit is explained in Step 1c', () => {
  // The verdict moved to `git var` in round 15, and with it a channel whose printf format
  // begins `effective\t` rather than `%s\t` — invisible to emittedKinds(). Derived separately
  // so a kind added there still cannot ship without a row.
  const script = readFileSync(inspectPath, 'utf8');
  const kinds = [...new Set([...script.matchAll(/printf 'effective\\t%s\\t(\w+)/g)]
    .map((m) => m[1]))].sort();
  assert.deepEqual(kinds, ['unresolvable', 'value'],
    `the kinds \`effective\` emits changed; Step 1c must change with them. Found ${kinds}`);

  const skill = readFileSync(skillPath, 'utf8');
  const start = skill.indexOf(STEP_1C_ANCHOR);
  assert.ok(start > 0, 'Step 1c must still carry a decision table read effective-first');
  const table = skill.slice(start, skill.indexOf('\n\nDesign principles:', start));
  for (const kind of kinds) {
    assert.match(table, new RegExp(`effective<TAB>[^|\n]*${kind}`),
      `Step 1c has no row reading an \`effective\` line of kind \`${kind}\``);
  }
  // Negative control, same shape as P8k's: the search must be able to fail.
  assert.doesNotMatch(table, /effective<TAB>[^|\n]*bogus/,
    'control: a kind the script cannot emit must not be found in the table');
});

test('P8k5: every kind the `configured` channel can emit is explained in Step 1c, '
  + 'and author.*/committer.* are read', () => {
  // Round 15, P1/P2-1. `configured` is a second git-native channel added alongside
  // `effective` — same derivation risk P8k4 already guards against for that one: a kind
  // added to the emitter must not ship without a row explaining it.
  const script = readFileSync(inspectPath, 'utf8');
  const kinds = [...new Set([...script.matchAll(/printf 'configured\\t%s\\t(\w+)/g)]
    .map((m) => m[1]))].sort();
  assert.deepEqual(kinds, ['no', 'yes'],
    `the kinds \`configured\` emits changed; Step 1c must change with them. Found ${kinds}`);

  const skill = readFileSync(skillPath, 'utf8');
  const start = skill.indexOf(STEP_1C_ANCHOR);
  assert.ok(start > 0, 'Step 1c must still carry a decision table read effective-first');
  const table = skill.slice(start, skill.indexOf('\n\nDesign principles:', start));
  for (const kind of kinds) {
    assert.match(table, new RegExp(`configured<TAB>[^|\n]*${kind}`),
      `Step 1c has no row reading a \`configured\` line of kind \`${kind}\``);
  }
  assert.doesNotMatch(table, /configured<TAB>[^|\n]*bogus/,
    'control: a kind the script cannot emit must not be found in the table');

  // P2-1: author.*/committer.* outrank user.* for their own role (git >= 2.31) — the
  // `identity` config-key loop must read all six keys, not just the original two. A plain
  // `.includes(key)` search over the whole case block (as this test used to do) passes even
  // when the loop itself is reverted, as long as the six key names survive somewhere in a
  // comment — round 16 review caught that gap. Derive the loop's ACTUAL key list the way
  // `P8k2` already does for `signing`, so a reverted loop fails here regardless of comments.
  const identityCase = script.slice(script.indexOf("\n  identity)"), script.indexOf('\n  signing)'));
  const loopKeys = identityCase.match(/for key in ([\w. ]+); do/)?.[1].split(' ') ?? [];
  assert.deepEqual([...loopKeys].sort(), ['author.email', 'author.name', 'committer.email',
    'committer.name', 'user.email', 'user.name'],
    `the identity subcommand's config-key loop changed; found ${JSON.stringify(loopKeys)}`);

  // Behavioral half: prove the six keys are not just named in the loop but actually READ.
  // Configure one key from each of the three namespaces and confirm its record appears with
  // a real value, plus a negative control that an untouched key stays `unset`.
  const { dir, git } = makeRepo('identitykeys');
  try {
    git('config', 'user.name', 'User Name');
    git('config', 'author.email', 'author@example.invalid');
    git('config', 'committer.name', 'Committer Name');
    const r = inspect(['identity'], { cwd: dir });
    const lines = r.stdout.trim().split('\n');
    assert.match(lines.find((l) => l.startsWith('user.name\t')) ?? '',
      /^user\.name\tvalue\t.*\tUser Name$/, 'user.name must actually be read, not just named');
    assert.match(lines.find((l) => l.startsWith('author.email\t')) ?? '',
      /^author\.email\tvalue\t.*\tauthor@example\.invalid$/,
      'author.email must actually be read, not just named');
    assert.match(lines.find((l) => l.startsWith('committer.name\t')) ?? '',
      /^committer\.name\tvalue\t.*\tCommitter Name$/,
      'committer.name must actually be read, not just named');
    // Negative control: a key from the same three namespaces that was never configured must
    // read `unset`, not silently vanish — proving the assertions above test real presence.
    assert.equal(lines.find((l) => l.startsWith('committer.email\t')), 'committer.email\tunset',
      'control: an unconfigured key from the same namespace stays `unset`');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P8k2: every key×kind `signing` can emit has a row in Step 1d\'s decision table', () => {
  const script = readFileSync(inspectPath, 'utf8');
  const block = script.slice(script.indexOf('\n  signing)'), script.indexOf('\n  signature)'));
  assert.ok(block.length > 0, 'the `signing` subcommand must still exist to be checked');
  // Both call shapes: the parameterised single call and the plain loop over the rest.
  const keys = [
    ...[...block.matchAll(/emit_config_records ([\w.]+)/g)].map((m) => m[1]),
    ...(block.match(/for key in ([\w. ]+); do/)?.[1].split(' ') ?? []),
  ].filter((k) => k !== '"$key"').sort();
  assert.deepEqual(keys, ['commit.gpgsign', 'gpg.format', 'user.signingkey'],
    `the keys \`signing\` reads changed; Step 1d must change with them. Found ${keys}`);

  const skill = readFileSync(skillPath, 'utf8');
  const start = skill.indexOf('**1d. Signing Diagnostics**');
  assert.ok(start > 0, 'Step 1d must still exist');
  const table = skill.slice(start, skill.indexOf('Post-commit visibility', start));
  for (const key of keys) {
    for (const kind of emittedKinds(script)) {
      assert.ok(table.includes(`${key}<TAB>${kind}`),
        `Step 1d has no row for a \`${key}\` record of kind \`${kind}\``);
    }
  }
  // Negative control, same shape as P8k's: the search must be able to fail.
  assert.ok(!table.includes('commit.gpgsign<TAB>bogus'),
    'control: a kind the script cannot emit must not be found in the table');
});

test('P9: signing names every key, so an unset one cannot be read as another key\'s answer', () => {
  const { dir, git } = makeRepo('signing');
  try {
    const bare = inspect(['signing'], { cwd: dir });
    assert.equal(bare.status, 0, `inspect signing failed: ${bare.stderr}`);
    assert.deepEqual(bare.stdout.trim().split('\n'),
      ['commit.gpgsign\tunset', 'user.signingkey\tunset', 'gpg.format\tunset'],
      'three keys, three answers — a silent gap would read as "not configured" either way');

    git('config', 'commit.gpgsign', 'true');
    git('config', 'gpg.format', 'ssh');
    // Round 91: this used to assert POSITION (`set[0]` is commit.gpgsign, `set[2]` is
    // gpg.format) because `--show-origin` never printed the key name. That is the same
    // defect `P8` had, and it was reachable the same way — see `P9b`. Every line names its
    // key now, so the reader never counts. `gpg.format` unset answers `unset` rather than
    // git's `gpg` default: the script reports the fact, Step 1d applies the default.
    const set = inspect(['signing'], { cwd: dir }).stdout.trim().split('\n');
    const line = (k) => set.find((l) => l.startsWith(`${k}\t`));
    assert.equal(set.length, 3, 'three keys, three lines, whatever is configured');
    // Read by key, never by index — a multi-valued fixture would break an indexed read for
    // something that is not a defect, which is the reading the contract tells consumers to drop.
    assert.match(line('commit.gpgsign'), /^commit\.gpgsign\tvalue\tlocal\tfile:.*\ttrue$/,
      'the value AND the origin that set it');
    assert.equal(line('user.signingkey'), 'user.signingkey\tunset',
      'still unset: signing on with no key is the warning case Step 1d must reach');
    assert.match(line('gpg.format'), /^gpg\.format\tvalue\tlocal\tfile:.*\tssh$/,
      'gpg.format decides what the key must be');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 91, P2 from review. `signing` kept the shape `identity` was rewritten away from, and
// the defect was reachable: measured on the pre-fix script, a `user.signingkey` of
// `AAAA\nunset` made the output four lines, so Step 1d read line 3 — `gpg.format` — and got
// `unset`, losing a configured `gpg.format=ssh`. Step 1d then reports the wrong signing
// format for a repository that signs.
test('P9b: a multi-line signing value cannot shift another key\'s answer', () => {
  const { dir, git } = makeRepo('signing-multiline');
  try {
    git('config', 'commit.gpgsign', 'true');
    git('config', 'user.signingkey', 'AAAA\nunset');
    git('config', 'gpg.format', 'ssh');
    const lines = inspect(['signing'], { cwd: dir }).stdout.trim().split('\n');
    const line = (k) => lines.find((l) => l.startsWith(`${k}\t`));
    assert.equal(lines.length, 3, `one value is one line, whatever it contains; got ${lines.length}`);
    assert.match(line('user.signingkey'), /^user\.signingkey\tvalue\tlocal\tfile:.*\tAAAA\\nunset$/,
      'the newline is escaped into the value field');
    // The assertion this test exists for: the key that follows must still be readable.
    assert.match(line('gpg.format'), /^gpg\.format\tvalue\tlocal\tfile:.*\tssh$/,
      'a configured gpg.format must not be displaced by the value before it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 91, P2 from review. `signing` used `2>/dev/null || printf 'unset\n'`, which reports a
// config it cannot READ as a key that is not set — the exact fail-open `identity` was rewritten
// to close, left in place in its sibling.
test('P9c: a signing config that cannot be read is not reported as unset', () => {
  const { dir } = makeRepo('signing-readfail');
  const shimDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-shim-'));
  try {
    const env = gitShim(shimDir, 'fail');
    const r = inspect(['signing'], { cwd: dir, env });
    assert.equal(r.status, 1, 'a config that cannot be read must abort, not answer');
    assert.match(r.stderr, /signing: could not read commit\.gpgsign — aborting/,
      'and the message must name the subcommand and the key');
    assert.equal(r.stdout, '', 'nothing readable as an answer may reach stdout');
    const ok = inspect(['signing'], { cwd: dir, env: gitShim(shimDir, 'pass') });
    assert.equal(ok.status, 0, `the shim itself must not break the script: ${ok.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
});

// Round 92, P1 from review. Sharing `emit_config_records` gave `signing` the raw config string,
// and for a boolean key the raw string is lossy: git reads a valueless `gpgsign` as TRUE and
// `gpgsign =` as FALSE, yet both emit the byte-identical `…empty…` record. Measured on the
// pre-fix script, both produced `commit.gpgsign\tempty\tlocal\tfile:.git/config`, so Step 1d's
// "signing enabled but no key" warning could not fire for a repository whose `git commit` then
// died with `gpg failed to sign the data`. `git config` cannot write these two forms, so the
// fixture writes the config file directly — that is the only way to reach the case.
const rawGpgsign = (dir, text) => appendFileSync(resolve(dir, '.git/config'), `[commit]\n${text}`);

test('P9d: a valueless gpgsign and an empty one are opposites, not one `empty` record', () => {
  for (const [text, expected] of [['\tgpgsign\n', 'true'], ['\tgpgsign =\n', 'false']]) {
    const { dir } = makeRepo('signing-bool');
    try {
      rawGpgsign(dir, text);
      const r = inspect(['signing'], { cwd: dir });
      assert.equal(r.status, 0, `inspect signing failed for ${JSON.stringify(text)}: ${r.stderr}`);
      const line = r.stdout.trim().split('\n').find((l) => l.startsWith('commit.gpgsign\t'));
      // The point of the case: these two must NOT be the same line. `--bool` is git's own
      // reading, so the oracle is git, not a table this test restates.
      assert.match(line, new RegExp(`^commit\\.gpgsign\\tvalue\\tlocal\\tfile:.*\\t${expected}$`),
        `git reads ${JSON.stringify(text)} as ${expected}; the record must say so`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('P9e: every spelling git calls true is normalised, so Step 1d matches one literal', () => {
  const { dir, git } = makeRepo('signing-bool-spellings');
  try {
    for (const [written, expected] of [['1', 'true'], ['yes', 'true'], ['on', 'true'],
      ['True', 'true'], ['0', 'false'], ['off', 'false'], ['false', 'false']]) {
      git('config', 'commit.gpgsign', written);
      const line = inspect(['signing'], { cwd: dir }).stdout.trim().split('\n')
        .find((l) => l.startsWith('commit.gpgsign\t'));
      assert.match(line, new RegExp(`\\tvalue\\tlocal\\tfile:.*\\t${expected}$`),
        `git reads \`${written}\` as ${expected}; an unnormalised record matches no Step 1d row`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P9f: a non-boolean gpgsign aborts rather than being reported as a value', () => {
  const { dir, git } = makeRepo('signing-bool-bad');
  try {
    git('config', 'commit.gpgsign', 'maybe');
    const r = inspect(['signing'], { cwd: dir });
    assert.equal(r.status, 1, 'an unreadable boolean is a read failure, not a verdict');
    assert.match(r.stderr, /signing: could not read commit\.gpgsign — aborting/,
      'and it lands in the existing fail-closed branch, naming the key');
    assert.equal(r.stdout, '', 'buffering means no half-answer escapes');
    // Not stricter than git: the same config makes git's own boolean read fail, so a `git
    // commit` would die here too. Without this the abort could be read as over-caution.
    const g = spawnSync('git', ['-C', dir, 'config', '--bool', '--get', 'commit.gpgsign'],
      { encoding: 'utf8', env: hermetic() });
    assert.equal(g.status, 128, 'git itself refuses the same value, so halting matches git');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P10: style and collect report the change set the plan is built from', () => {
  const { dir, git } = makeRepo('collect');
  try {
    writeFileSync(resolve(dir, 'seed.txt'), 'seed changed\n');
    writeFileSync(resolve(dir, 'new.txt'), 'brand new\n');
    git('add', '--', 'new.txt');

    const style = inspect(['style'], { cwd: dir });
    assert.equal(style.status, 0, `inspect style failed: ${style.stderr}`);
    assert.match(style.stdout, /chore\(collect\): seed the fixture/,
      'style is read from real history — that is what the message convention is inferred from');

    const collect = inspect(['collect'], { cwd: dir });
    assert.equal(collect.status, 0, `inspect collect failed: ${collect.stderr}`);
    assert.match(collect.stdout, /A {2}new\.txt/, 'a staged addition must be visible');
    assert.match(collect.stdout, / M seed\.txt/, 'and an unstaged modification too');
    // Round 84: only the `status --short` half was asserted, so deleting BOTH `diff --stat`
    // lines from the script left 62/62 green — and `collect` would then be indistinguishable
    // from `status`, losing the size signal Step 4 groups on. Each stat block is asserted
    // separately: they answer different questions (working tree vs index).
    assert.match(collect.stdout, /seed\.txt\s*\|\s*\d+ [+-]/,
      'the unstaged diffstat must be there — that is what collect adds over status');
    assert.match(collect.stdout, /new\.txt\s*\|\s*\d+ [+-]/,
      'and the staged one, from diff --cached --stat');
    const statLines = collect.stdout.split('\n').filter((l) => /\|\s*\d+ [+-]/.test(l));
    assert.ok(statLines.length >= 2,
      `both stat blocks must run, not one twice; got ${statLines.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const INSPECT_SRC = readFileSync(inspectPath, 'utf8');

// Derived from the shipped usage string, not restated: a subcommand added to the script
// without an arity check must fail P11 rather than be quietly out of scope. `scope` and
// `diff` are the two that DO take operands, so they are excluded here and covered by the
// hand-written cases above (missing, too many, empty).
const PATH_TAKING = new Set(['scope', 'diff']);
const NO_OPERAND_SUBCOMMANDS = (() => {
  // Anchored to the usage line, not to "the first quoted alternation anywhere". Unanchored,
  // a benign comment such as `# states are 'clean|dirty'` above it captured that instead and
  // aborted the whole file at module load, naming the wrong cause and losing every case.
  const m = INSPECT_SRC.match(/usage: [^\n]*\n[^\n]*'([a-z|]+\|[a-z|]+)'/);
  assert.ok(m, 'the script must carry a usage string listing its subcommands');
  const all = m[1].split('|');
  assert.ok(all.length >= 10, `the usage string must list every subcommand; got ${all}`);
  return all.filter((s) => !PATH_TAKING.has(s));
})();

// Round 85. `-C "$REPO_ROOT"` is pinned behaviourally by P3, but only for the four
// subcommands whose OUTPUT contains paths. Dropping it from `style`, `identity`, `signing`
// or `signature` survived every suite — benign only because REPO_ROOT happens to be derived
// from the same cwd, which nothing holds true across the next refactor.
// references/git-environment.md states the invariant without exception: every command
// carries it, the single exception being the rev-parse that derives the root.
// Round 13, self-found by enumerating every channel that carries data to stdout rather than
// waiting for the next round to surface one. The path channel (`collect` / `status` / `scope`)
// is the only other one where the data is attacker-shaped, and it is safe — but by GIT's
// construction, not by anything this script does: `status --short` quotes a path containing a
// control character, and `core.quotePath=false` does not turn that off (it governs non-ASCII
// bytes only; both measured). That is worth an oracle precisely because it is not obvious: adding
// `-z` here "for consistency with the config reader" would emit raw NUL-separated paths and
// reopen the `P8d` forgery in a subcommand nobody thinks of as parsing identity.
test('P10b: a newline in a FILENAME cannot forge a second status line', () => {
  const { dir, git } = makeRepo('collect-pathforge');
  try {
    writeFileSync(resolve(dir, 'evil\n M innocent.txt'), 'x\n');
    for (const quotePath of ['true', 'false']) {
      git('config', 'core.quotePath', quotePath);
      const out = inspect(['status'], { cwd: dir }).stdout;
      const lines = out.trim().split('\n');
      assert.equal(lines.length, 1,
        `core.quotePath=${quotePath}: one untracked path is one line; got ${JSON.stringify(out)}`);
      assert.match(lines[0], /^\?\? "evil\\n M innocent\.txt"$/,
        `core.quotePath=${quotePath}: git quotes the control character rather than emitting it`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P12b: every git command in the script is pinned to the derived root', () => {
  // Whitespace is normalized before matching: `hook=$( git rev-parse …)` — a space after the
  // `$(` — escaped the earlier `=\$\(git ` form entirely, so a git call could sidestep this
  // test by being spelled slightly differently.
  const gitCalls = INSPECT_SRC.split('\n')
    .map((l) => l.trim().replace(/\$\(\s+/g, '$('))
    .filter((l) => !l.startsWith('#'))
    .filter((l) => /(?:^|[;&|(]|\$\(|\s)git\s/.test(l));
  assert.ok(gitCalls.length >= 12, `expected the script's git calls; found ${gitCalls.length}`);
  let derivations = 0;
  for (const call of gitCalls) {
    if (/rev-parse --show-toplevel/.test(call)) {
      derivations += 1;
      assert.ok(!call.includes('-C '),
        `the derivation cannot be pinned to what it derives: ${call}`);
      continue;
    }
    assert.ok(call.includes('-C "$REPO_ROOT"'),
      `every git command must run against the derived root: ${call}`);
  }
  assert.equal(derivations, 1,
    `exactly one command derives the root; found ${derivations}`);
});

// Round 85, P2. `collect` and `diff` each run several git commands and the branch's exit
// status was whatever the LAST one returned, so a failing first command was masked. Measured
// with `status.showUntrackedFiles=bogus` — a plausible typo in a user's gitconfig —
// `git status --short` exits 128 while both diffstats succeed, and `collect` exited 0 with
// no status lines. SKILL.md Step 3 classifies from those lines, so it takes the documented
// "no changes → nothing to commit" branch with a staged file sitting in the index. Fail-open
// on a diagnostic the commit plan is built from.
test('P15: a partial answer from a multi-command subcommand is not reported as success', () => {
  const { dir, git } = makeRepo('partial');
  try {
    writeFileSync(resolve(dir, 'staged.txt'), 'content\n');
    git('add', '--', 'staged.txt');

    // Control FIRST, so a fixture that cannot produce the failure is visible as a failing
    // control rather than as a silently passing test.
    const healthy = inspect(['collect'], { cwd: dir });
    assert.equal(healthy.status, 0, 'control: a healthy repository must still exit 0');
    assert.match(healthy.stdout, /staged\.txt/, 'control: and must report the staged file');

    // `bogus` is an INVALID value, which git rejects at exit 128 — that is the accumulator's
    // hazard. The same config key with a LEGAL value (`no`) is a different hazard entirely:
    // it succeeds at exit 0 and empties the output, which no accumulator can catch. That one
    // is `P17`, and `--untracked-files=all` rather than this assertion is what defeats it.
    git('config', 'status.showUntrackedFiles', 'bogus');
    const broken = inspect(['collect'], { cwd: dir });
    assert.notEqual(broken.status, 0,
      'a failing status must not be reported as success just because the diffstats worked');
    // The remaining commands still run — a partial answer is more useful than none, as long
    // as it is not labelled success. This is what distinguishes the fix from `set -e`.
    assert.match(broken.stdout, /staged\.txt \|/,
      'the commands that did work must still report; only the exit status changes');
    assert.notEqual(broken.stderr.trim(), '', 'and git must be allowed to say what was wrong');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The `diff` half of the same fix, with its own trigger. `diff.external` pointing at a missing
// binary was the original live version of this — anyone running difftastic or delta whose
// binary got renamed — but round 19 review (P1) added `--no-ext-diff` to both `diff` call sites
// specifically to close that channel (defense in depth against a compromised local config, on
// top of stripping `GIT_EXTERNAL_DIFF` process-wide), so it can no longer arm this test.
// `textconv` survives `--no-ext-diff` (measured: content-conversion, not diff delegation), so a
// missing textconv binary scoped to `seed.txt` alone reproduces the same asymmetry: the unstaged
// diff (seed.txt only, since fresh.txt is already staged and so has no working-tree/index
// difference) fails to exec it and exits 128; the cached diff (fresh.txt only, added new so
// never routed through seed.txt's driver) exits 0. Measured: the unstaged `git diff` exits 128
// while `git diff --cached` exits 0, so without accumulation `inspect diff` returns 0 carrying
// only the staged half, and Step 5a writes a commit message describing half the change.
test('P15b: diff propagates a failure from either half, not just the last one', () => {
  const { dir, git } = makeRepo('partial-diff');
  try {
    writeFileSync(resolve(dir, 'seed.txt'), 'one\n');
    git('add', '--', 'seed.txt');
    git('commit', '-m', 'seed');
    writeFileSync(resolve(dir, 'seed.txt'), 'two\n');   // unstaged change
    writeFileSync(resolve(dir, 'fresh.txt'), 'new\n');
    git('add', '--', 'fresh.txt');                      // staged change

    const healthy = inspect(['diff', 'seed.txt', 'fresh.txt'], { cwd: dir });
    assert.equal(healthy.status, 0, `control: a healthy repository must exit 0: ${healthy.stderr}`);
    assert.match(healthy.stdout, /fresh\.txt/, 'control: and must report the staged half');

    writeFileSync(resolve(dir, '.gitattributes'), 'seed.txt diff=missingdriver\n');
    git('config', 'diff.missingdriver.textconv', '/nonexistent-textconv-xyz');
    const broken = inspect(['diff', 'seed.txt', 'fresh.txt'], { cwd: dir });
    assert.notEqual(broken.status, 0,
      'a failing unstaged diff must not be reported as success because the cached one worked');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The fail-closed guard: `rev-parse --git-path` failing must NOT become `guard:missing`. That
// verdict tells the user to install a hook, which is the wrong instruction when the truth is
// that the repository could not be read. P12 pins the sibling REPO_ROOT guard; this is its
// counterpart, and without it reverting to `2>/dev/null` + no `||` survives the whole suite.
test('P16: guard aborts rather than reporting a verdict it cannot support', () => {
  const { dir, git } = makeRepo('guard-fail');
  try {
    const healthy = inspect(['guard'], { cwd: dir });
    assert.equal(healthy.status, 0, `control: a readable repository must answer: ${healthy.stderr}`);
    assert.match(healthy.stdout, /^guard:(installed|not-executable|missing)$/m,
      'control: and the answer must be one of the three verdicts');

    // A core.hooksPath git refuses to expand. Measured across three candidates: a misplaced
    // `%(prefix)` is accepted verbatim (rc 0) and proves nothing; `~<unknown-user>/…` is the
    // one that actually fails — `fatal: failed to expand user dir`, rc 128. It reaches the
    // hooks probe without disturbing `rev-parse --show-toplevel`, so the abort under test is
    // the guard's own and not the root guard's.
    git('config', 'core.hooksPath', '~nonexistent-user-xyz/hooks');
    const broken = inspect(['guard'], { cwd: dir });
    if (broken.status === 0) {
      // Fail loudly rather than passing vacuously: if this git accepts the value, the case
      // proves nothing and must be re-derived, not silently skipped.
      assert.fail(`fixture did not break hooks-path resolution; got: ${JSON.stringify(broken.stdout)}`);
    }
    assert.doesNotMatch(broken.stdout, /guard:missing/,
      'an unreadable repository must never be reported as a missing hook');
    assert.match(broken.stderr, /could not resolve the hooks path/,
      'and it must say what actually went wrong');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P11: an unusable invocation is refused with exit 2, never a partial answer', () => {
  const { dir } = makeRepo('refuse');
  try {
    for (const [args, why] of [
      [[], 'no subcommand at all'],
      [['bogus'], 'a subcommand that does not exist'],
      [['scope'], 'scope without its path'],
      [['scope', 'a', 'b'], 'scope with more than one path — which one was meant?'],
      [['diff'], 'diff without any path'],
      // The count check alone let an EMPTY operand through, and `:(literal)` prefixed to ""
      // is a pathspec matching every file — so `scope ''` answered about the whole repository
      // while the caller believed it had scoped the commit, and in --execute that set is what
      // gets staged. Reachable from the shipped fence whenever SCOPE_PATH is unset.
      [['scope', ''], 'scope with an empty path — that is every file, not a scope'],
      [['diff', ''], 'diff with an empty path, same reason'],
      [['diff', 'a.txt', ''], 'and one empty operand among several widens the whole diff'],
      // Round 84: these five took an operand and silently dropped it — `branch --version`
      // printed the branch and exited 0. Answering something other than what was handed in
      // is the defect verify-last's second-commit-ish refusal already names.
      [['branch', '--version'], 'branch with an operand it cannot honour'],
      [['style', 'HEAD~5'], 'style with a range it does not read'],
      [['signature', 'HEAD~1'], 'signature with a commit-ish it does not resolve'],
      [['guard', 'commit-msg'], 'guard with a hook name it does not select'],
      [['status', 'src/'], 'status with a path — that is what scope is for'],
      // Round 85: the five above were hand-written, so `collect`, `identity` and `signing`
      // were never exercised — deleting `no_operands "$@"` from any of the three survived
      // all three suites, and `collect --cached` then silently answers about something
      // other than what it was handed. The list below is derived from the script's own
      // usage string instead, so a subcommand added there without an arity check fails here.
      ...NO_OPERAND_SUBCOMMANDS.map((s) => [[s, 'BOGUS-OPERAND'], `${s} with an operand it does not take`]),
      // Round 89, Nit. The derived list comes from the usage STRING, which names the ten
      // subcommands and not the help flags — so the `no_operands` call in the `--help` branch
      // had no oracle, and deleting it left the suite green. `--help style` reads as a request
      // for help ABOUT that subcommand; answering with the general usage answers a question
      // nobody asked, which is the same defect class as `branch --version` above.
      [['--help', 'style'], '--help with a subcommand it does not document separately'],
      [['-h', 'BOGUS-OPERAND'], '-h with an operand'],
    ]) {
      const r = inspect(args, { cwd: dir });
      assert.equal(r.status, 2, `${why} must exit 2, got ${r.status}`);
      assert.equal(r.stdout, '', `${why} must print no answer on stdout`);
      assert.notEqual(r.stderr.trim(), '', `${why} must say what was wrong`);
    }
    // `--help` is the one non-answer that is not an error: asking is not misuse.
    const help = inspect(['--help'], { cwd: dir });
    assert.equal(help.status, 0, '--help is a request, not a mistake');
    assert.match(help.stderr, /usage: smart-commit-inspect/, 'and it must name the subcommands');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P11d: an unknown subcommand containing a raw ESC byte is escaped before it reaches stderr', () => {
  // Round 18 review, Nit. `$sub` is caller-controlled argv, escaped everywhere else in this
  // file (:89-93) — the unknown-subcommand branch was the one data channel that printed it
  // raw. A subcommand string is an odd thing to carry a terminal escape, but the installed
  // copy (skills/smart-commit/scripts/…) is a plain script any third party may invoke with
  // any argv, so the same threat model as a config value applies.
  const { dir } = makeRepo('unknown-sub-esc');
  try {
    const r = inspect(['bogus\x1b[31msub'], { cwd: dir });
    assert.equal(r.status, 2, `must still refuse as usage error; got ${r.status}`);
    assert.ok(!r.stderr.includes('\x1b['),
      `unknown-subcommand message must not carry a raw ANSI escape; got ${JSON.stringify(r.stderr)}`);
    assert.match(r.stderr, /bogus\\x1b\[31msub/,
      `and the escaped byte must still be legible as \\x1b; got ${JSON.stringify(r.stderr)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P12: outside a repository the script aborts instead of answering', () => {
  // Fail closed. An empty or default answer here would be read as "nothing to commit" when
  // the truth is "this is not a repository at all".
  const dir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-norepo-'));
  try {
    assert.notEqual(
      spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).status, 0,
      'fixture precondition: the temp directory must not sit inside any repository');
    const r = inspect(['status'], { cwd: dir });
    assert.notEqual(r.status, 0, 'it must fail');
    assert.match(r.stderr, /could not resolve the repository root/,
      'and say why, rather than reporting an empty change set');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P13: both arms of the locator the fences use reach this script', () => {
  // The fences do NOT go through scripts/run-skill.sh. They resolve the script by path,
  // installed copy first, because the runner derives its plugin root from its OWN location —
  // and in a consuming project, where /install-scripts flattens skill scripts into
  // .claude/scripts/, that root is not where this script lives. Measured before the change:
  // the run-skill.sh form exited 127 in a fresh repository.
  //
  // Both arms are exercised, and the first arm is checked with the SECOND arm also present:
  // a locator that fell through to the in-repo copy would otherwise pass the installed case.
  const { dir } = makeRepo('locator');
  try {
    const installed = resolve(dir, '.claude/scripts/smart-commit-inspect.sh');
    const inRepo = resolve(dir, 'skills/smart-commit/scripts/smart-commit-inspect.sh');
    const shipped = readFileSync(inspectPath, 'utf8');
    for (const f of [installed, inRepo]) mkdirSync(resolve(f, '..'), { recursive: true });

    // EXTRACTED from SKILL.md, never retyped. Round 84, measured: with the three lines
    // hand-copied here, swapping the two arms in all ten shipped fences left 62/62 green —
    // this case passed because its own copy was unchanged, so it asserted about the test's
    // string and about nothing shipped. Step 1b is the fence read; F1b pins that every other
    // fence carries the identical pair, in this order.
    const skillSrc = readFileSync(
      resolve(__dirname, '../../skills/smart-commit/SKILL.md'), 'utf8');
    const fence = (skillSrc.match(/\*\*1b\. Learn Commit Style\*\*\s*```bash\n([\s\S]*?)^```$/m) || [])[1];
    assert.ok(fence, 'the Step 1b fence must be locatable');
    const locatorLines = fence.split('\n').filter((l) => /INSPECT/.test(l));
    assert.equal(locatorLines.length, 4,
      'two arms, one refusal, one invocation — if this changes, so must what is asserted below');
    const locate = locatorLines
      .map((l) => l.replace(/ (style|branch)$/, ' branch'))
      .join('\n');
    assert.match(locate, /^INSPECT="\$REPO_ROOT\/\.claude\/scripts\//,
      'the extracted locator must try the installed copy first');
    const run = () => spawnSync('bash', ['-c', `REPO_ROOT=${JSON.stringify(dir)}\n${locate}`],
      { cwd: dir, encoding: 'utf8', env: hermetic() });

    // Arm 2 alone: only the plugin-checkout copy exists.
    writeFileSync(inRepo, shipped);
    chmodSync(inRepo, 0o755);
    const viaRepo = run();
    assert.equal(viaRepo.status, 0, `in-repo arm failed: ${viaRepo.stderr}`);
    assert.equal(viaRepo.stdout.trim(), 'branch-locator',
      'the located script must answer about the CALLER\'s repository');

    // Arm 1 wins when both exist. The installed copy is marked so the answer says which ran —
    // asserting only "it worked" cannot tell the two arms apart, and precedence is the point.
    writeFileSync(installed, shipped.replace(
      'git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD',
      'printf \'installed-copy-ran\\n\''));
    chmodSync(installed, 0o755);
    const viaInstalled = run();
    assert.equal(viaInstalled.status, 0, `installed arm failed: ${viaInstalled.stderr}`);
    assert.equal(viaInstalled.stdout.trim(), 'installed-copy-ran',
      'the installed copy must win — that is the arm a consuming project has');

    // Neither: a named refusal, never a silent empty answer.
    rmSync(installed); rmSync(inRepo);
    const neither = run();
    assert.notEqual(neither.status, 0, 'with no copy anywhere the fence must stop');
    assert.equal(neither.stdout, '', 'and print no answer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P14: signature reads the last commit\'s verification status from the repository', () => {
  // Round 84: this subcommand had no coverage at all. Measured — replacing its body with
  // `printf 'N\\n'` left 61/61 green across both suites, and that mutant reports "unsigned"
  // forever, which Step 1d turns into user-facing signing guidance.
  const { dir } = makeRepo('signature');
  try {
    const r = inspect(['signature'], { cwd: dir });
    assert.equal(r.status, 0, `inspect signature failed: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'N',
      'an unsigned commit is N — the fixture cannot sign, so this is the reachable value');

    // 'N' alone cannot fail against a `printf 'N'` body — the fixture has no signing key, so
    // every reachable %G? here is N and the assertion above is satisfied by a constant. The
    // discriminator is a repository with NO commit: `git log -1` has nothing to read and
    // exits 128 with git's own diagnostic, while a constant body would answer 'N' and exit 0,
    // telling Step 1d "the last commit is unsigned" about a commit that does not exist.
    // Measured: shipped → exit 128; `printf 'N'` mutant → exit 0, stdout 'N'.
    const unborn = mkdtempSync(resolve(tmpdir(), 'sc-inspect-unborn-'));
    try {
      spawnSync('git', ['-C', unborn, 'init', '-q'], { encoding: 'utf8', env: hermetic() });
      const u = inspect(['signature'], { cwd: unborn });
      assert.notEqual(u.status, 0,
        'control: with no commit to read, signature must fail rather than answer');
      assert.equal(u.stdout.trim(), '',
        'and print nothing — a verdict about a commit that does not exist is worse than none');
    } finally {
      rmSync(unborn, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P14b: an inherited HOME cannot make `signature` run an attacker-configured gpg.program', () => {
  // Round 24 review, P0: `%G?` (this subcommand's own format) invokes real gpg verification
  // regardless of `--no-show-signature` — that flag only suppresses the banner git prints
  // alongside a shown commit, not the underlying verification call. `resolve_gpg_override`
  // applies the same scope check `run_commit` (smart-commit-execute.sh) already uses before
  // splicing the override into this call.
  //
  // Verification only runs when there is a signature blob to check: an ordinary unsigned commit
  // (what `makeRepo` seeds) answers `N` without ever invoking gpg.program at all, which would
  // make the armed control below inert — measured. A `gpgsig` header is forged onto HEAD via
  // plumbing (no real key needed; the header's content is never validated by this path, only
  // the presence of one is) so `%G?` has something to attempt verifying.
  const { dir, git } = makeRepo('signaturegpg');
  const attackHome = mkdtempSync(resolve(tmpdir(), 'sc-inspect-signaturegpg-'));
  const marker = resolve(attackHome, 'pwned');
  try {
    const tree = git('write-tree').trim();
    const ident = 'Dev <dev@example.com> 1700000000 +0000';
    const raw = `tree ${tree}\nauthor ${ident}\ncommitter ${ident}\n`
      + 'gpgsig -----BEGIN PGP SIGNATURE-----\n \n fakedata\n -----END PGP SIGNATURE-----\n'
      + '\nsigned-looking commit\n';
    const forged = spawnSync('git', ['-C', dir, 'hash-object', '-t', 'commit', '-w', '--stdin'],
      { input: raw, encoding: 'utf8', env: hermetic() });
    assert.equal(forged.status, 0, `hash-object failed: ${forged.stderr}`);
    git('update-ref', 'refs/heads/' + git('branch', '--show-current').trim(), forged.stdout.trim());

    const evilSigner = resolve(attackHome, 'evil-gpg');
    writeFileSync(evilSigner, `#!/bin/sh\ntouch ${marker}\nexit 1\n`, { mode: 0o755 });
    writeFileSync(resolve(attackHome, '.gitconfig'), `[gpg]\n\tprogram = ${evilSigner}\n`);
    const env = hermetic({ HOME: attackHome });

    const controlEnv = { ...env };
    delete controlEnv.GIT_CONFIG_GLOBAL;
    delete controlEnv.GIT_CONFIG_SYSTEM;
    spawnSync('git', ['-C', dir, 'log', '-1', '--format=%G?'], { encoding: 'utf8', env: controlEnv });
    assert.ok(existsSync(marker),
      'control: an unrestricted HOME must let a %G? read run the attacker gpg.program');
    rmSync(marker, { force: true });

    const r = inspect(['signature'], { cwd: dir, env });
    assert.equal(r.status, 0, `inspect signature failed: ${r.stderr}`);
    assert.ok(!existsSync(marker),
      'signature must override a HOME-configured gpg.program, so the attacker binary must never '
      + `run (marker file exists: ${existsSync(marker)})`);
    assert.match(r.stdout.trim(), /^[GBUXYREN]$/,
      'the substituted default program still answers one of git\'s own %G? letters, never the '
      + 'attacker path');
    // Round 24 re-review, P2: smart-commit-execute.sh's run_commit warns on stderr when it
    // overrides an untrusted gpg.program; this subcommand silently substituted the same way
    // until now, leaving no indication that `%G?` — the value SKILL.md Step 1d reads to plan
    // signing — came from a different binary than the operator's own HOME configured.
    assert.match(r.stderr, /gpg\.program is configured outside this repository\/worktree/,
      'overriding an untrusted gpg.program must be announced on stderr, not applied silently');
    assert.match(r.stderr, /Using gpg instead\./,
      'the warning must name the safe default it substituted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(attackHome, { recursive: true, force: true });
  }
});

// Round 86, P1 from review. `status.showUntrackedFiles=no` is a LEGAL setting — people set it
// on repositories with noisy build output — and under it `git status --short` drops every `??`
// line at exit 0. P15's accumulator cannot catch that, because nothing failed: the answer is
// empty and successful, which SKILL.md Step 3 documents as "No uncommitted changes" and Step 6
// reports as "All clear". Measured before the fix: a brand-new file, `status` → empty, rc 0.
// Untracked files are precisely what a commit plan exists to notice, so the option is pinned
// rather than inherited. Parameterized because all three readers share the defect.
for (const [sub, args] of [['collect', []], ['status', []], ['scope', ['brandnew.txt']]]) {
  test(`P17: ${sub} reports untracked files even when the repository config hides them`, () => {
    const { dir, git } = makeRepo(`untracked-${sub}`);
    try {
      writeFileSync(resolve(dir, 'brandnew.txt'), 'not yet tracked\n');

      // Control first: with git's default the file is visible, so a later empty answer is
      // attributable to the config and not to the fixture never creating the file.
      const healthy = inspect([sub, ...args], { cwd: dir });
      assert.equal(healthy.status, 0, `control: ${sub} must succeed: ${healthy.stderr}`);
      assert.match(healthy.stdout, /^\?\? brandnew\.txt$/m,
        'control: an untracked file is visible under git defaults');

      git('config', 'status.showUntrackedFiles', 'no');
      const hidden = inspect([sub, ...args], { cwd: dir });
      assert.equal(hidden.status, 0,
        `${sub} must still succeed — the setting is legal, not an error: ${hidden.stderr}`);
      assert.match(hidden.stdout, /^\?\? brandnew\.txt$/m,
        `${sub} must pin --untracked-files rather than inherit it; an empty answer here is `
        + 'indistinguishable from a clean tree and the file would never be committed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// Round 86, P2 from review. The shebang is decoration on the documented launch path: passing
// this file as an ARGUMENT to bash never executes it, so `-p` is whatever the caller typed.
// The ten shipped fences type it (F1o), but the installed copy at .claude/scripts/ is a plain
// script any caller may invoke — and these diagnostics decide the author identity a commit
// records, which is CLAUDE.md rule 3 territory. Measured before the fix: BASH_ENV pointing at
// a file defining `git()` made `branch` answer from the shim. The negative control is the
// point of the test: the shim must be REAL, or a passing assertion proves only that the
// fixture was inert.
test('P18: the script establishes privileged mode itself, whatever the caller passed', () => {
  const { dir, git } = makeRepo('priv-reexec');
  try {
    git('branch', '-M', 'realbranch');
    const shim = resolve(dir, 'shim.sh');
    writeFileSync(shim, 'git() { printf "branch-ATTACKER\\n"; }\n');

    // Negative control: the same shim under a shell that does NOT re-exec must be honoured,
    // proving the injection channel works and that P18's real assertion is not vacuous.
    const control = spawnSync('/bin/bash', ['-c', '. "$1"; git rev-parse --abbrev-ref HEAD', '_', shim],
      { encoding: 'utf8', cwd: dir, env: hermetic() });
    assert.match(control.stdout, /branch-ATTACKER/,
      'control: the shim must actually shadow git, or this test proves nothing');

    // The unprotected launch: no `-p`, BASH_ENV set. bash would source the shim at startup.
    const attacked = spawnSync('/bin/bash', ['--', inspectPath, 'branch'],
      { encoding: 'utf8', cwd: dir, env: hermetic({ BASH_ENV: shim }) });
    assert.equal(attacked.stdout.trim(), 'realbranch',
      'an unprivileged launch must not let BASH_ENV shadow git — the script re-execs itself '
      + `under /bin/bash -p with BASH_ENV stripped; got ${JSON.stringify(attacked.stdout)}`);

    // And the shipped launch still works UNDER THE SAME ATTACK, so this asserts the documented
    // path is hardened rather than merely unbroken. `hermetic()` sets no BASH_ENV, so without
    // passing it here the case would only show the happy path still runs.
    const shipped = inspect(['branch'], { cwd: dir, env: hermetic({ BASH_ENV: shim }) });
    assert.equal(shipped.status, 0, `the documented launch must still succeed: ${shipped.stderr}`);
    assert.equal(shipped.stdout.trim(), 'realbranch');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 87, P1 from review. P17 above uses ROOT-LEVEL files, which report identically under
// `--untracked-files=normal` and `=all` — so it pins "not inherited" but says nothing about
// WHICH value. The value is the security-relevant half: git's default `normal` collapses a
// wholly-untracked directory to one `?? secrets/` line, and SKILL.md Step 3's exclusion list
// matches FILENAMES (`.env*`, `*.pem`, `id_rsa*`, …). Under `normal` there is no filename to
// match and the only operand Step 5c.2 can stage is the directory — which commits the key.
// rules/git-workflow.md § Prohibited "Commit containing secrets" is Anchor Register #2.
// Scope, deliberately: an untracked directory git WILL traverse. The two it will not are
// `P17c`, and neither can carry file content, so the argument above is unaffected by them.
test('P17b: a traversable untracked directory is enumerated per file, so the exclusion list '
  + 'can see it', () => {
  const { dir } = makeRepo('untracked-dir');
  try {
    mkdirSync(resolve(dir, 'secrets'));
    writeFileSync(resolve(dir, 'secrets/id_rsa'), 'PRIVATE KEY\n');
    writeFileSync(resolve(dir, 'secrets/app.pem'), 'cert\n');

    const r = inspect(['collect'], { cwd: dir });
    assert.equal(r.status, 0, `collect failed: ${r.stderr}`);
    assert.match(r.stdout, /^\?\? secrets\/id_rsa$/m,
      'the private key must be named, not hidden behind a collapsed `?? secrets/` line — '
      + 'the exclusion list matches filenames and cannot fire on a directory');
    assert.match(r.stdout, /^\?\? secrets\/app\.pem$/m, 'and so must every other file in it');
    assert.doesNotMatch(r.stdout, /^\?\? secrets\/$/m,
      'the collapsed form must not appear; it is what `--untracked-files=normal` produces');

    // Control: `all` must not defeat .gitignore, or pinning it would flood every plan with
    // dependency directories and make the real files unreadable.
    mkdirSync(resolve(dir, 'node_modules/pkg'), { recursive: true });
    writeFileSync(resolve(dir, 'node_modules/pkg/a.js'), 'x\n');
    writeFileSync(resolve(dir, '.gitignore'), 'node_modules/\n');
    const after = inspect(['collect'], { cwd: dir });
    assert.doesNotMatch(after.stdout, /node_modules/,
      'control: an ignored directory must stay ignored under --untracked-files=all');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 87, P2 from review. P18 exercises the BASH_ENV route, which the re-exec itself closes
// by stripping it — so the SECOND guard (`case "$-" in *p*`), the one that catches an attacker
// who sets the internal sentinel to skip the re-exec entirely, had no oracle: deleting it left
// the suite green. Measured against that mutant: an exported shell function forged the answer
// at exit 0. Exported functions are a channel `-p` refuses and nothing else here does.
test('P18b: setting the internal sentinel cannot buy an unprivileged run', () => {
  const { dir, git } = makeRepo('priv-sentinel');
  try {
    git('branch', '-M', 'realbranch');

    // Negative control: the exported function must really shadow `git` in a shell that does
    // not refuse it, or the assertion below passes for the wrong reason.
    const control = spawnSync('/bin/bash', ['-c', 'git rev-parse --abbrev-ref HEAD'], {
      encoding: 'utf8',
      cwd: dir,
      env: hermetic({ 'BASH_FUNC_git%%': '() { printf "branch-FUNC\\n"; }' }),
    });
    assert.match(control.stdout, /branch-FUNC/,
      'control: the exported function must actually shadow git, or this test proves nothing');

    // Round 89, P2: `SD0X_PRIV_GUARD` is set here too, and that one addition is what gives the
    // three `SD0X_PRIV_GUARD=''` nulling lines an oracle. `${VAR:?word}` aborts only on unset
    // OR NULL, so an attacker who exports any non-empty value satisfies a bare `:?` and walks
    // straight through the guard. Measured: with the nulling lines deleted, this env returns a
    // forged `branch-FUNC` at exit 0 — and the whole suite stayed green without this key.
    const attacked = spawnSync('/bin/bash', ['--', inspectPath, 'branch'], {
      encoding: 'utf8',
      cwd: dir,
      env: hermetic({
        SD0X_PRIV_REEXEC: '1',
        SD0X_PRIV_GUARD: 'preset-by-the-attacker',
        'BASH_FUNC_git%%': '() { printf "branch-FUNC\\n"; }',
      }),
    });
    assert.notEqual(attacked.status, 0,
      'claiming the re-exec already happened must not be believed by an unprivileged shell');
    assert.doesNotMatch(attacked.stdout, /branch-FUNC/,
      `a forged answer at exit 0 is the failure this guard exists to prevent; got ${
        JSON.stringify(attacked.stdout)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 19 review, P0. P18b's sentinel forgery still has to fool the `$-` check (guard 2): its
// attack has no `-p` on the command line, so `$-` genuinely lacks `p` and the guard halts for a
// reason unrelated to the sentinel forgery it targets. This is a SECOND, independent forgery:
// `env SHELLOPTS=privileged` makes bash apply `set -o privileged` at its own startup — a real,
// case-correct lowercase `p` lands in `$-` without `-p` ever appearing on the command line
// (measured: `set -o privileged` is a plain settable option, not exclusive to launch-time `-p`).
// Combined with the sentinel forgery, this reaches exit 0 with a forged answer through a path
// P18b's oracle cannot see, because P18b's own attack env never sets SHELLOPTS. Portable by
// construction — measured to work identically on the macOS system `/bin/bash` (3.2, no BASHOPTS
// support at all) and on bash 5.3, since it needs no `nocasematch` trick, only a real option.
test('P18g: SHELLOPTS=privileged forges a real `$-` flag, independent of the sentinel guard', () => {
  const { dir, git } = makeRepo('priv-shellopts');
  try {
    git('branch', '-M', 'realbranch');

    const attacked = spawnSync('/bin/bash', ['--', inspectPath, 'branch'], {
      encoding: 'utf8',
      cwd: dir,
      env: hermetic({
        SD0X_PRIV_REEXEC: '1',
        SHELLOPTS: 'privileged',
        'BASH_FUNC_git%%': '() { printf "branch-FUNC\\n"; }',
      }),
    });
    assert.notEqual(attacked.status, 0,
      'an environment-forged `p` flag must not be believed as genuine privileged mode');
    assert.doesNotMatch(attacked.stdout, /branch-FUNC/,
      `a forged answer at exit 0 is the failure this guard exists to prevent; got ${
        JSON.stringify(attacked.stdout)}`);

    // Negative control: SHELLOPTS=privileged must actually land a real `p` in `$-`, or the
    // assertions above hold for a reason unrelated to what this test claims to guard.
    const control = spawnSync('/bin/bash', ['-c', 'case "$-" in *p*) echo ARMED;; esac'], {
      encoding: 'utf8', env: hermetic({ SHELLOPTS: 'privileged' }),
    });
    assert.match(control.stdout, /ARMED/,
      'control: SHELLOPTS=privileged must genuinely set a real p flag in $-, or this test proves '
      + 'nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 19 review, P2. `P18g` proves guard 4 catches an exported SHELLOPTS — but `SHELLOPTS`
// doubles as the vehicle that forges `$-` in that test, so it never isolates the SECOND name the
// same grep alternation checks. `BASHOPTS` cannot forge `$-` the way `SHELLOPTS` can (there is no
// `set -o` option it reflects; measured on bash 3.2, where the name is not even bash-internal —
// plain `env BASHOPTS=x /bin/bash -c 'declare -p BASHOPTS'` prints `declare -x BASHOPTS="x"`, an
// ordinary exported variable bash 3.2 attaches no meaning to at all, vs. bash 5.3 where it is
// ALWAYS present internally as `declare -r` and becomes `-rx` only when exported). So this test
// bypasses guard 2 with a genuine `-p` on the command line instead — a wrapper that always
// launches with `-p` while an attacker who controls only the environment forges the sentinel and
// leaves `BASHOPTS` exported — which is what isolates the `BASHOPTS` branch of guard 4's check
// from the `SHELLOPTS` branch `P18g` already covers. Verified with $BASH_VERSION so a future
// `/bin/bash` resolving to something other than the two measured versions is visible in the
// failure rather than silently exercising a third, unverified code path.
test('P18h: an exported BASHOPTS (not SHELLOPTS) alone still trips guard 4, with a genuine `-p`',
  () => {
    const bashVersion = spawnSync('/bin/bash', ['-c', 'echo "$BASH_VERSION"'],
      { encoding: 'utf8' }).stdout.trim();
    assert.ok(bashVersion, 'must be able to read /bin/bash\'s own version for this record');

    const { dir, git } = makeRepo('priv-bashopts');
    try {
      git('branch', '-M', 'realbranch');

      // Armed control: BASHOPTS reaches the child as an EXPORTED variable regardless of bash
      // version, including 3.2 where it carries no special meaning to bash itself.
      const control = spawnSync('/bin/bash', ['-c', 'declare -p BASHOPTS 2>/dev/null'], {
        encoding: 'utf8', env: hermetic({ BASHOPTS: 'forged' }),
      });
      assert.match(control.stdout, /^declare -[a-zA-Z]*x[a-zA-Z]* BASHOPTS=/m,
        `control: an inherited BASHOPTS must reach the child as an exported variable on `
        + `/bin/bash ${bashVersion}; got ${JSON.stringify(control.stdout)}`);

      const attacked = spawnSync('/bin/bash', ['-p', '--', inspectPath, 'branch'], {
        encoding: 'utf8',
        cwd: dir,
        env: hermetic({
          SD0X_PRIV_REEXEC: '1',
          BASHOPTS: 'forged',
          'BASH_FUNC_git%%': '() { printf "branch-FUNC\\n"; }',
        }),
      });
      assert.notEqual(attacked.status, 0,
        `an exported BASHOPTS must trip guard 4 even under a genuine -p (bash ${bashVersion}); `
        + `got status ${attacked.status}`);
      assert.doesNotMatch(attacked.stdout, /branch-FUNC/,
        `a forged answer at exit 0 is the failure this guard exists to prevent; got ${
          JSON.stringify(attacked.stdout)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

// Round 24 re-review, P0: guard 4 used to read `declare -p SHELLOPTS BASHOPTS | grep -qE ...`.
// `grep` is an external, PATH-resolved command, and in exactly the scenario this guard exists
// to catch — no real `-p` re-exec happened, so environment function import is still active —
// an attacker able to forge the sentinel can equally hijack `PATH` or export a
// `BASH_FUNC_grep%%` shell function and make the pipe answer whatever they want. Reproduced
// against the pre-fix source (both vectors made `alloc` reach the real work under a forged
// sentinel). The fix replaced the external `grep` with `builtin declare` + `case`, neither of
// which is a PATH lookup or a shadowable command name. This test proves both vectors are
// closed on the CURRENT source.
test('P18i: the forged-sentinel guard is immune to a hostile PATH or an imported grep '
  + 'function, because it never invokes an external command', () => {
  const { dir } = makeRepo('priv-grep-immune');
  try {
    const hostileBinDir = mkdtempSync(resolve(tmpdir(), 'sc-priv-hostile-bin-'));
    writeFileSync(resolve(hostileBinDir, 'grep'), '#!/bin/bash\nexit 1\n', { mode: 0o755 });

    const base = { SD0X_PRIV_REEXEC: '1', SHELLOPTS: 'privileged' };

    const pathAttack = spawnSync('/bin/bash', ['--', inspectPath, 'branch'], {
      encoding: 'utf8', cwd: dir,
      env: hermetic({ ...base, PATH: `${hostileBinDir}:${process.env.PATH}` }),
    });
    assert.notEqual(pathAttack.status, 0,
      'a PATH-shadowed grep that always fails must not defeat the guard');

    const funcAttack = spawnSync('/bin/bash', ['--', inspectPath, 'branch'], {
      encoding: 'utf8', cwd: dir,
      env: hermetic({ ...base, 'BASH_FUNC_grep%%': '() { return 1; }' }),
    });
    assert.notEqual(funcAttack.status, 0,
      'an imported grep() function that always fails must not defeat the guard');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 88, P2 from review. "`all` enumerates every untracked directory per file" was stated as
// an unconditional invariant in three places and is FALSE for two kinds git will not traverse.
// The consequence is benign — both stage as a gitlink/symlink and carry no file content, so the
// exclusion argument in 4-implementation.md § 9.2 is unaffected — but the security claim rests
// on that invariant, so the exceptions are pinned rather than left to be rediscovered. The
// enumerating control is in the same case: without it this would pass even if `all` were lost.
test('P18d: unmerged and typechange status codes are real, and SKILL.md has a row for each', () => {
  // Round 15, P2. SKILL.md's classification table read "staged: any code in column 1" first,
  // which also matches `UU` (both columns non-blank) — routing an unresolved merge conflict
  // into "already staged, just commit it". Reproduced against a real merge conflict and a
  // real typechange (file replaced by a symlink), then cross-checked against the table text.
  const { dir, git } = makeRepo('statuscodes');
  try {
    // Unmerged: a genuine three-way conflict, not a hand-written fixture line. makeRepo names
    // its branch `branch-statuscodes` deterministically, so no query is needed to return to it.
    const mainBranch = 'branch-statuscodes';
    writeFileSync(resolve(dir, 'c.txt'), 'base\n');
    git('add', '--', 'c.txt');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'other');
    writeFileSync(resolve(dir, 'c.txt'), 'other\n');
    git('commit', '-q', '-am', 'other-side');
    git('checkout', '-q', mainBranch);
    writeFileSync(resolve(dir, 'c.txt'), 'mine\n');
    git('commit', '-q', '-am', 'my-side');
    spawnSync('git', ['-C', dir, 'merge', 'other'], { env: hermetic() }); // conflicts; exit != 0 expected
    const unmergedLine = inspect(['status'], { cwd: dir }).stdout.trim();
    assert.match(unmergedLine, /^UU c\.txt$/m, 'control: git really does emit UU for this conflict');

    // Typechange: replace a tracked regular file with a symlink at the same path.
    const { dir: d2, git: g2 } = makeRepo('typechange');
    writeFileSync(resolve(d2, 'f.txt'), 'x\n');
    g2('add', '--', 'f.txt');
    g2('commit', '-q', '-m', 'seed');
    rmSync(resolve(d2, 'f.txt'));
    symlinkSync('/etc/hosts', resolve(d2, 'f.txt'));
    // NOT .trim() — `git status --short` LEADS this line with a space (index-clean,
    // worktree-typechanged), and String.trim() strips that leading space along with the
    // trailing newline, which would silently turn the assertion below into a false positive.
    const typechangeOut = inspect(['status'], { cwd: d2 }).stdout;
    assert.match(typechangeOut, /^ T f\.txt$/m, 'control: git really does emit T for this typechange');
    rmSync(d2, { recursive: true, force: true });

    const skill = readFileSync(skillPath, 'utf8');
    const start = skill.indexOf('**Classify changes**:');
    const table = skill.slice(start, skill.indexOf('The ` -> ` in those two rows', start));
    assert.match(table, /`UU`.*`AA`.*`DD`/,
      'Step 3 must list the unmerged codes by name, not just "any code in column 1"');
    assert.match(table, /unmerged.*pre-empts every row below it, including `staged`/is,
      'and say unmerged is checked BEFORE staged, or a top-to-bottom read still misfiles it');
    assert.match(table, /\| typechange \| `T`/,
      'Step 3 must have a row for the typechange code');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P17d: an inherited status.branch cannot put a non-path line into the change set', () => {
  // Round 14, P2. `status.branch=true` is inherited config, exactly like showUntrackedFiles:
  // any scope can set it and the script reads the repository as it finds it. It prepends
  // `## <branch>...`, which Step 3 then classifies as a change and Step 5c.2 feeds to
  // `git add -- ':(literal)## …'`. `--no-branch` is what makes the reader immune.
  const { dir, git } = makeRepo('nobranch');
  try {
    writeFileSync(resolve(dir, 'a.txt'), 'x\n');
    // Armed control: git really does emit the header once the config is set, so the three
    // assertions below are measuring `--no-branch` and not the absence of the feature.
    git('config', '--local', 'status.branch', 'true');
    const raw = spawnSync('git', ['-C', dir, 'status', '--short', '--untracked-files=all'],
      { encoding: 'utf8', env: hermetic() }).stdout;
    assert.match(raw, /^## /m, 'control: without --no-branch the header is present');

    for (const args of [['collect'], ['status'], ['scope', 'a.txt']]) {
      const r = inspect(args, { cwd: dir });
      assert.equal(r.status, 0, `inspect ${args.join(' ')} failed: ${r.stderr}`);
      assert.doesNotMatch(r.stdout, /^## /m,
        `\`${args[0]}\` must not emit a branch header — it is not a path`);
    }
    // And the paths themselves are still reported, or "no header" would be satisfied by
    // an empty answer.
    assert.match(inspect(['status'], { cwd: dir }).stdout, /^\?\? a\.txt$/m,
      'control: the untracked file is still enumerated');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P17c: `all` does not enumerate directories git will not traverse, and says so', () => {
  const { dir } = makeRepo('untracked-opaque');
  try {
    // An embedded repository: a directory with its own .git.
    mkdirSync(resolve(dir, 'embedded'));
    spawnSync('git', ['-C', resolve(dir, 'embedded'), 'init', '-q'], { env: hermetic() });
    writeFileSync(resolve(dir, 'embedded/inner.txt'), 'not reachable from the outer repo\n');
    // A symlink to a directory.
    mkdirSync(resolve(dir, 'realdir'));
    writeFileSync(resolve(dir, 'realdir/f.txt'), 'reachable\n');
    symlinkSync('realdir', resolve(dir, 'linkdir'));
    // And an ordinary nested directory, which MUST still enumerate.
    mkdirSync(resolve(dir, 'plain/sub'), { recursive: true });
    writeFileSync(resolve(dir, 'plain/sub/g.txt'), 'reachable\n');

    const r = inspect(['collect'], { cwd: dir });
    assert.equal(r.status, 0, `collect failed: ${r.stderr}`);
    assert.match(r.stdout, /^\?\? plain\/sub\/g\.txt$/m,
      'control: an ordinary untracked directory must still be enumerated per file');
    assert.match(r.stdout, /^\?\? embedded\/$/m,
      'an embedded repository is reported collapsed even under --untracked-files=all');
    assert.doesNotMatch(r.stdout, /embedded\/inner\.txt/,
      'and git does not traverse into it, which is why the invariant needs the exception');
    assert.match(r.stdout, /^\?\? linkdir$/m, 'a symlink to a directory is reported as itself');
    assert.doesNotMatch(r.stdout, /linkdir\/f\.txt/, 'and is not followed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 89, Nit from review, kept because both reviewers raised it independently. Both
// siblings clear the marker right after their guards (`smart-commit-execute.sh`,
// `scripts/run-skill.sh:50`) and run-skill.sh explains why at length: left exported it is
// inherited by a descendant started as a plain `bash <script>`, which then skips its own
// re-exec, has no `p`, and aborts on its own guard. That is a denial of service on a
// legitimate setup, not a security gain. `4-implementation.md § 8` claims this script
// "mirrors" them, so the claim needs an oracle rather than a reader's trust.
test('P18c: the privileged-mode marker is not exported to the processes git launches', () => {
  const { dir, git } = makeRepo('priv-marker');
  try {
    const probe = resolve(dir, 'probe.sh');
    writeFileSync(probe,
      '#!/bin/sh\nprintenv SD0X_PRIV_REEXEC >&2 || echo "MARKER-ABSENT" >&2\ncat "$1"\n');
    chmodSync(probe, 0o755);
    // `diff.external` used to be the shortest real path from an inspect subcommand to an
    // arbitrary child process, but round 19 review (P1) closed it with `--no-ext-diff` on both
    // `diff` call sites (plus stripping `GIT_EXTERNAL_DIFF` process-wide) — measured to no
    // longer invoke a probe configured that way, which is exactly why this oracle needs a
    // different channel now rather than going dark. `textconv` survives `--no-ext-diff`
    // (content conversion, not diff delegation) and is unconditional on the marked path, so it
    // is the shortest REMAINING one.
    writeFileSync(resolve(dir, '.gitattributes'), 'tracked.txt diff=probe\n');
    git('config', 'diff.probe.textconv', probe);
    writeFileSync(resolve(dir, 'tracked.txt'), 'first\n');
    git('add', '--', 'tracked.txt');
    git('commit', '-q', '-m', 'chore(priv-marker): a file to diff against');
    writeFileSync(resolve(dir, 'tracked.txt'), 'second\n');

    const r = inspect(['diff', 'tracked.txt'], { cwd: dir });
    assert.match(r.stderr, /MARKER-ABSENT/,
      'the child must not inherit SD0X_PRIV_REEXEC — a descendant sd0x script would skip its '
      + 'own re-exec and then abort on its own guard');
    assert.doesNotMatch(r.stderr, /^1$/m, 'and specifically must not see the value 1');

    // Negative control: the probe has to actually run, or the assertions above are vacuous
    // for any reason at all — a textconv driver that git ignored would look identical.
    const control = spawnSync('/bin/bash', ['-p', '--', probe], {
      encoding: 'utf8', env: hermetic({ SD0X_PRIV_REEXEC: '1' }),
    });
    assert.match(control.stderr, /^1$/m,
      'control: the probe reports the marker when it genuinely is in the environment');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 15 Nit. P18 and P18b each exercise one of the first two privileged-mode guards — the
// re-exec (guard 1) and the `$-` flag check (guard 2) — but neither reaches the THIRD guard
// (`case "${BASH_ENV+x}"`), because both scenarios either strip BASH_ENV via the re-exec or
// never carry `-p` in `$-` to begin with. Bash's own `-p` disables *reading* BASH_ENV at this
// shell's startup, but does not clear it from the environment — so a shell launched with real
// `-p`, sentinel preset to skip the re-exec, and BASH_ENV still exported reaches this guard
// specifically, and only this one. Measured: without it this exact combination would run to
// completion with an attacker-controlled BASH_ENV live for anything downstream that spawns an
// unprivileged shell (a git hook, `diff.external`, `core.pager`).
test('P18e: BASH_ENV surviving into a `-p` shell with the sentinel preset still halts', () => {
  const { dir } = makeRepo('bashenv-survivor');
  try {
    const shim = resolve(dir, 'shim.sh');
    writeFileSync(shim, '#!/bin/sh\necho SHIM-RAN >&2\n');
    chmodSync(shim, 0o755);

    // The attack shape: real `-p` (passes guard 2) + sentinel preset (skips guard 1's re-exec,
    // which is the only place BASH_ENV would otherwise get stripped) + BASH_ENV still exported.
    const attacked = spawnSync('/bin/bash', ['-p', '--', inspectPath, 'branch'], {
      encoding: 'utf8',
      cwd: dir,
      env: hermetic({ SD0X_PRIV_REEXEC: '1', BASH_ENV: shim }),
    });
    assert.notEqual(attacked.status, 0,
      `guard 3 must halt a -p shell that still carries BASH_ENV; got ${
        JSON.stringify({ status: attacked.status, stdout: attacked.stdout })}`);
    assert.match(attacked.stderr, /cannot establish privileged mode/,
      'and it must be THIS guard reporting it, not an unrelated failure');

    // Negative control: remove only BASH_ENV from the identical attack shape — the sentinel is
    // still preset, `-p` is still real — and the run must succeed, or the HALT above could be
    // coming from something else in this env combination entirely.
    const clean = spawnSync('/bin/bash', ['-p', '--', inspectPath, 'branch'], {
      encoding: 'utf8', cwd: dir, env: hermetic({ SD0X_PRIV_REEXEC: '1' }),
    });
    assert.equal(clean.status, 0,
      `control: the same setup without BASH_ENV must run cleanly; got ${
        JSON.stringify({ status: clean.status, stderr: clean.stderr })}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 18 review, Nit. An inherited xtrace writes every expansion — config/identity values
// included — to stderr. Guard 1's re-exec already strips `SHELLOPTS`/`BASHOPTS`, which closes
// the ambient-env vector, but `-x` on the launch command line itself (`bash -p -x -- script`)
// sets it directly rather than through those variables, and reaches a shell that skips the
// re-exec entirely whenever `SD0X_PRIV_REEXEC` is preset (the same attack shape `P18e` uses for
// guard 3). `set +x`/`set +v`, added symmetric with smart-commit-execute.sh's own prelude, is
// what closes that remaining path.
test('P18f: an inherited xtrace does not reach stderr once privileged mode is established', () => {
  // Bash traces the prelude's own `case`/`unset` lines before `set +x` executes — that control
  // flow carries no data and is not the hazard. What must NOT be traced is anything after it:
  // the `git` invocation `branch` makes, whose expansion (`$REPO_ROOT`) is exactly the kind of
  // value this fix keeps off stderr.
  const { dir } = makeRepo('xtrace-survivor');
  try {
    const traced = spawnSync('/bin/bash', ['-p', '-x', '--', inspectPath, 'branch'], {
      encoding: 'utf8', cwd: dir, env: hermetic({ SD0X_PRIV_REEXEC: '1' }),
    });
    assert.equal(traced.status, 0, `must still run cleanly; got ${JSON.stringify(traced)}`);
    assert.equal(traced.stdout.trim(), 'branch-xtrace-survivor',
      'the real answer must still reach stdout');
    assert.doesNotMatch(traced.stderr, /^\+.*git /m,
      `the git invocation itself must not be traced to stderr; got ${
        JSON.stringify(traced.stderr)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 17 review, P1. `color.ui`/`color.status` = `always` is a LEGAL config value (people set
// it to force colour into CI logs) and git colourises `status --short` even on a pipe when it is
// set — measured. Step 3 classifies from the `??`/`UU`/` T` column and Step 5c.2 turns each line
// into a `:(literal)` pathspec; a leading ANSI escape breaks both matches, the same fail-open
// shape as `status.showUntrackedFiles=no` (`P17`), reached through a different config key.
// Parameterized because `collect`, `status` and `scope` all read the same status line.
for (const [sub, args] of [['collect', []], ['status', []], ['scope', ['untracked.txt']]]) {
  test(`P19: ${sub} strips a forced ANSI color even when color.ui/color.status is always`, () => {
    const { dir, git } = makeRepo(`forcedcolor-${sub}`);
    try {
      writeFileSync(resolve(dir, 'untracked.txt'), 'x\n');
      git('config', 'color.ui', 'always');

      // Armed control: raw git really does inject the escape under this exact config, so a
      // clean result below is the script's own doing, not an absent hazard.
      const raw = spawnSync('git', ['-C', dir, 'status', '--short', '--no-branch',
        '--untracked-files=all'], { encoding: 'utf8', env: hermetic() }).stdout;
      assert.ok(raw.includes('\x1b['),
        `control: git must inject a colour escape under color.ui=always; got ${JSON.stringify(raw)}`);

      const r = inspect([sub, ...args], { cwd: dir });
      assert.equal(r.status, 0, `inspect ${sub} failed: ${r.stderr}`);
      assert.ok(!r.stdout.includes('\x1b['),
        `${sub} must not carry a raw ANSI escape into the record stream; got ${JSON.stringify(r.stdout)}`);
      assert.match(r.stdout, /\?\? untracked\.txt/,
        'and the untracked-file record must still be readable in its documented shape');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('P19b: style/diff strip a forced ANSI color even when color.ui is always', () => {
  // Same hazard as `P19`, on the two channels git colourises differently: `log --oneline`
  // (subject lines `style` reads to infer commit conventions) and `diff` (patch text `diff`
  // hands to Step 5's message generation).
  const { dir, git } = makeRepo('forcedcolor-logdiff');
  try {
    writeFileSync(resolve(dir, 'seed.txt'), 'seed\nmodified\n');
    git('config', 'color.ui', 'always');

    const rawLog = spawnSync('git', ['-C', dir, 'log', '--oneline', '-15'],
      { encoding: 'utf8', env: hermetic() }).stdout;
    assert.ok(rawLog.includes('\x1b['),
      `control: git log must inject a colour escape; got ${JSON.stringify(rawLog)}`);

    const style = inspect(['style'], { cwd: dir });
    assert.equal(style.status, 0, `inspect style failed: ${style.stderr}`);
    assert.ok(!style.stdout.includes('\x1b['),
      `style must not carry a raw ANSI escape; got ${JSON.stringify(style.stdout)}`);

    const rawDiff = spawnSync('git', ['-C', dir, 'diff', '--', 'seed.txt'],
      { encoding: 'utf8', env: hermetic() }).stdout;
    assert.ok(rawDiff.includes('\x1b['),
      `control: git diff must inject a colour escape; got ${JSON.stringify(rawDiff)}`);

    const diff = inspect(['diff', 'seed.txt'], { cwd: dir });
    assert.equal(diff.status, 0, `inspect diff failed: ${diff.stderr}`);
    assert.ok(!diff.stdout.includes('\x1b['),
      `diff must not carry a raw ANSI escape; got ${JSON.stringify(diff.stdout)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 18 review, P1 (test-oracle gap on the round-17 P1 fix). `P19`/`P19b` above armed only
// `color.ui=always` — but `color.status`/`color.diff` are MORE specific keys, and git resolves
// the specific key first: a repo that sets `color.status=always` directly is untouched by
// `-c color.ui=false` alone (that flag only sets `color.ui`, and `color.status` never falls
// through to it once it has its own value). So the round-17 fix's `-c color.ui=false` closed
// only the weakest of the three keys; this block arms each specific key on its own to prove
// the round-18 fix (`-c color.status=false -c color.diff=false` added alongside) closes them.
for (const [sub, args, key] of [
  ['collect', [], 'color.status'], ['collect', [], 'color.diff'],
  ['status', [], 'color.status'], ['scope', ['untracked.txt'], 'color.status'],
]) {
  test(`P19d: ${sub} strips a forced ANSI color even when ${key} alone is always `
    + '(color.ui untouched)', () => {
    const { dir, git } = makeRepo(`forcedcolor-${sub}-${key.replace('.', '_')}`);
    try {
      writeFileSync(resolve(dir, 'untracked.txt'), 'x\n');
      // `makeRepo` already committed `seed.txt`; modifying it (rather than adding a new file)
      // is what gives the `color.diff` variant something for `diff --stat` to colourise.
      writeFileSync(resolve(dir, 'seed.txt'), 'seed\nmodified\n');
      git('config', key, 'always');

      const rawArmed = key === 'color.diff'
        ? spawnSync('git', ['-C', dir, 'diff', '--stat'], { encoding: 'utf8', env: hermetic() }).stdout
        : spawnSync('git', ['-C', dir, 'status', '--short', '--no-branch', '--untracked-files=all'],
          { encoding: 'utf8', env: hermetic() }).stdout;
      assert.ok(rawArmed.includes('\x1b['),
        `control: git must inject a colour escape under ${key}=always; got ${JSON.stringify(rawArmed)}`);

      const r = inspect([sub, ...args], { cwd: dir });
      assert.equal(r.status, 0, `inspect ${sub} failed: ${r.stderr}`);
      assert.ok(!r.stdout.includes('\x1b['),
        `${sub} must not carry a raw ANSI escape under ${key}=always; got ${JSON.stringify(r.stdout)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('P19d: style strips a forced ANSI color even when color.diff alone is always '
  + '(color.ui untouched)', () => {
  // Mirrors P19b's style case, but arms `color.diff` specifically: `log --oneline`'s abbreviated
  // hash is coloured via the `color.diff.commit` slot, which falls under `color.diff` before it
  // ever reaches `color.ui`.
  const { dir, git } = makeRepo('forcedcolor-style-diff');
  try {
    writeFileSync(resolve(dir, 'seed.txt'), 'seed\n');
    git('config', 'color.diff', 'always');

    const raw = spawnSync('git', ['-C', dir, 'log', '--oneline', '-15'],
      { encoding: 'utf8', env: hermetic() }).stdout;
    assert.ok(raw.includes('\x1b['),
      `control: git log must inject a colour escape under color.diff=always; got ${JSON.stringify(raw)}`);

    const style = inspect(['style'], { cwd: dir });
    assert.equal(style.status, 0, `inspect style failed: ${style.stderr}`);
    assert.ok(!style.stdout.includes('\x1b['),
      `style must not carry a raw ANSI escape under color.diff=always; got ${JSON.stringify(style.stdout)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A repository with one commit signed by a throwaway SSH key, entirely hermetic (no ambient
 * key, no agent) — the only way to arm `log.showSignature`'s injection: git only invokes the
 * verifier, and only then prints anything extra, when the commit object actually carries a
 * signature. `gpg.ssh.program` must be set explicitly; git's own default for it is empty, which
 * fails the commit outright rather than falling back to `ssh-keygen` on PATH (measured).
 */
const makeSignedRepo = (label) => {
  const dir = mkdtempSync(resolve(tmpdir(), `sc-inspect-${label}-`));
  const env = hermetic();
  const key = resolve(dir, 'sshkey');
  const keygen = spawnSync('which', ['ssh-keygen'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(keygen, 'ssh-keygen must be on PATH to arm this fixture');
  assert.equal(spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', key, '-q'],
    { encoding: 'utf8', env }).status, 0, 'ssh-keygen must succeed');
  const pubkey = readFileSync(`${key}.pub`, 'utf8').trim();
  const git = (...a) => {
    const r = spawnSync('git', ['-C', dir,
      '-c', 'user.email=dev@example.invalid', '-c', 'user.name=Dev',
      '-c', 'gpg.format=ssh', '-c', `gpg.ssh.program=${keygen}`,
      '-c', `user.signingkey=${key}.pub`, '-c', 'commit.gpgsign=true', ...a],
    { encoding: 'utf8', env });
    assert.equal(r.status, 0, `git ${a.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  git('init', '-q', '-b', `branch-${label}`);
  writeFileSync(resolve(dir, 'seed.txt'), 'seed\n');
  git('add', '--', 'seed.txt');
  git('commit', '-q', '-m', `chore(${label}): seed the fixture`);
  writeFileSync(resolve(dir, 'allowed_signers'), `dev@example.invalid ${pubkey}\n`);
  git('config', 'gpg.ssh.allowedSignersFile', resolve(dir, 'allowed_signers'));
  return { dir, git };
};

test('P19c: signature strips both a forced ANSI color and an injected verification block', () => {
  // Round 17 review, P2. `log.showSignature=true` prints a multi-line "Good signature…" banner
  // BEFORE `%G?`'s own resolved character — `%G?` still resolves correctly either way (measured
  // separately), but SKILL.md:301 documents `signature` as printing "one character … and nothing
  // else", and Step 1d's caller takes the first character of stdout as the verdict. Under the
  // banner, that first character is `G` from "Good", not the real `%G?` answer.
  const { dir, git } = makeSignedRepo('forcedcolor-signature');
  try {
    git('config', 'log.showSignature', 'true');
    git('config', 'color.ui', 'always');

    const raw = spawnSync('git', ['-C', dir, 'log', '-1', '--format=%G?'],
      { encoding: 'utf8', env: hermetic() }).stdout;
    assert.ok(raw.trim().split('\n').length > 1,
      `control: raw git must splice a verification banner ahead of the verdict under this `
      + `config; got ${JSON.stringify(raw)}`);

    const r = inspect(['signature'], { cwd: dir });
    assert.equal(r.status, 0, `inspect signature failed: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'G',
      `signature must answer exactly the one-character verdict, nothing spliced in; got ${
        JSON.stringify(r.stdout)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Round 19 review flagged the `signature` call site for the same `color.status`/`color.diff`
// gap `P19d` (log/diff/status/scope) closes elsewhere, and a first pass here armed `color.diff`
// against the verification banner on that premise. Mutation-testing that test (removing the two
// flags from the `signature` call site and re-running it) showed it stayed green either way: the
// banner is gated by `--no-show-signature` on the SAME command line, which suppresses it
// regardless of any color config, so no color escape ever reaches the banner for the color flags
// to strip. `P19c` above already proves this the honest way — its "control" section removes
// `--no-show-signature` and shows raw git DOES splice a multi-line coloured banner in, then shows
// the real call site (which carries the flag) answers exactly `G`. The two flags stay on the
// `signature` call site for structural consistency with the other 8 (harmless, and load-bearing
// again if a future edit ever drops `--no-show-signature`), but no test claims they are doing
// live work here — that claim was false and is not restated.
test('P21: signature carries --no-show-signature, the actual banner suppressor', () => {
  const script = readFileSync(inspectPath, 'utf8');
  const line = script.split('\n').find((l) => /-C "\$REPO_ROOT" log -1 --no-show-signature/.test(l));
  assert.ok(line, 'signature call site not found in the expected shape');
  assert.match(line, /--no-show-signature/,
    'signature must suppress the verification banner at the source, not rely on color flags '
    + 'that never see it');
});

test('P20: every `log`/`diff`/`status` call site carries `--no-pager`', () => {
  // Round 17 review, P2, widened round 18. Measured with `script -q /dev/null` (pty emulation,
  // since a pipe never pages regardless of the flag so `spawnSync` alone cannot distinguish the
  // two): `git log` and `git diff` — including `--stat` and `-1 --format=...` — page once
  // connected to a real tty, which this script is whenever a developer runs `/smart-commit`
  // interactively. `git status` does NOT page under git's own default (`pager.status=false`) —
  // but round 17 reasoned from that default and left `status` unpinned, the same mistake
  // `status.showUntrackedFiles`/`status.branch` (`P17`/`P17d`) had already been fixed for
  // elsewhere in this file: `pager.status=true` is a legal config value, and under it `status`
  // pages too (measured, same pty method). Pin, don't inherit — so `status` now carries
  // `--no-pager` alongside `log`/`diff`. Without it, a paged answer blocks on a keypress the
  // automation never sends. A structural sweep is the oracle here (as `P1` is for the env-strip
  // block) because the behavioural difference itself needs a pty this suite cannot portably
  // fixture.
  const script = readFileSync(inspectPath, 'utf8');
  const gitLines = script.split('\n')
    .filter((l) => /\bgit\b.*\s(log|diff|status)\b/.test(l) && !/^\s*#/.test(l));
  assert.ok(gitLines.length >= 9,
    `expected several log/diff/status call sites; found ${gitLines.length}`);
  for (const line of gitLines) {
    assert.match(line, /--no-pager/,
      `every log/diff/status call site must carry --no-pager: ${line.trim()}`);
  }
});

test('P22: style routes each subject line through esc(), closing an OSC 52 clipboard-write '
  + 'channel', () => {
  // Round 19 review, P1. A commit subject is authored by whoever committed it — on a shared
  // repo, not necessarily whoever runs /smart-commit — and `style`'s job is to hand recent
  // subjects to Step 1b for style inference, unescaped stdout that reaches a real terminal.
  // OSC 52 (`\x1b]52;c;<base64>\x07`) writes the terminal's clipboard on iTerm2/xterm/kitty/
  // wezterm; every other data channel in this script already goes through `esc()` for exactly
  // this reason (identity records, config values, `diff`'s unknown-subcommand echo). This test
  // arms the same byte in a commit subject and checks it never reaches stdout raw.
  const { dir, git } = makeRepo('osc52-style');
  try {
    const payload = 'feat: ok \x1b]52;c;cm0gLXJmIH4=\x07 done';
    git('commit', '--allow-empty', '-m', payload);

    const r = inspect(['style'], { cwd: dir });
    assert.equal(r.status, 0, `inspect style failed: ${r.stderr}`);
    assert.ok(!r.stdout.includes('\x1b]52'),
      `style must not carry a raw OSC 52 sequence into stdout; got ${JSON.stringify(r.stdout)}`);
    assert.match(r.stdout, /\\x1b\]52;c;cm0gLXJmIH4=\\x07/,
      `the escaped form of the payload must still be readable in the record; got ${
        JSON.stringify(r.stdout)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P22b: style preserves git log\'s own exit status (empty-repo vs read failure)', () => {
  // The fix for P22 moved `style` from a single `git log` command (whose own exit status WAS
  // the case arm's, and therefore the script's) to a loop reading a process substitution — a
  // shape that, done naively, loses the upstream exit status entirely (the loop's own exit
  // status is the last `read`'s, not git's). SKILL.md Step 1b's decision table depends on
  // distinguishing "empty repo" (128, `does not have any commits yet` on stderr) from any other
  // failure, so this must still be git's real code, not a constant.
  const { dir } = makeRepo('style-exitcode-populated');
  try {
    const populated = inspect(['style'], { cwd: dir });
    assert.equal(populated.status, 0,
      `a populated repo must exit 0; got ${populated.status}, stderr: ${populated.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const emptyDir = mkdtempSync(resolve(tmpdir(), 'sc-inspect-style-exitcode-empty-'));
  try {
    spawnSync('git', ['-C', emptyDir, 'init', '-q'], { encoding: 'utf8', env: hermetic() });
    const rawExit = spawnSync('git', ['-C', emptyDir, 'log', '--oneline', '-15'],
      { encoding: 'utf8', env: hermetic() }).status;
    const empty = inspect(['style'], { cwd: emptyDir });
    assert.equal(empty.status, rawExit,
      `style must forward git log's own exit status on an empty repo; raw git gave `
      + `${rawExit}, style gave ${empty.status}`);
    assert.match(empty.stderr, /does not have any commits yet/,
      `expected the empty-repo stderr shape; got ${JSON.stringify(empty.stderr)}`);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});
