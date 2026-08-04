const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync,
  statSync, symlinkSync, realpathSync,
} = require('node:fs');
const { resolve, join, dirname } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync, spawn } = require('node:child_process');

const root = resolve(__dirname, '../..');
const execScript = resolve(root, 'skills/smart-commit/scripts/smart-commit-execute.sh');
const dispatchScript = resolve(root, 'skills/smart-commit/scripts/smart-commit-dispatch.sh');
const realGuard = resolve(root, 'scripts/commit-msg-guard.sh');

const AI_LINE = 'Co-Authored-By: Claude <noreply@anthropic.com>';

/**
 * The allowlist is READ FROM the dispatcher rather than restated here. A copy in the
 * test is what let the previous design drift: the test asserted its own idea of the
 * permitted set and passed while the artifact said something else.
 */
function allowlist() {
  const r = spawnSync('/bin/bash', ['-p', dispatchScript, '--allowlist'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'dispatch.sh --allowlist must succeed');
  return r.stdout.trim().split('\n');
}

const scratch = [];
function tempDir(prefix) {
  // realpath: on macOS /var is a symlink to /private/var, and git reports the resolved
  // form - a fixture comparing the two spellings fails for a reason that is not the test's.
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of scratch) { try { rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
});

/** A throwaway repository with the real guard installed at `scripts/`. */
function mkRepo({ withGuard = true } = {}) {
  const dir = tempDir('smart-commit-exec-');
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  // `--initial-branch` explicitly, not the ambient default: several tests below drive
  // `refs/heads/main` from a hook body, and a bare `git init` takes the branch name from the
  // developer's `init.defaultBranch`. Unset — as on CI — that is `master`, so the hook updates
  // a ref nothing points at and the test's own control assertion is what fails.
  git('init', '-q', '--initial-branch=main', '.');
  git('config', 'user.name', 'Test Dev');
  git('config', 'user.email', 'dev@example.com');
  git('config', 'commit.gpgsign', 'false');
  if (withGuard) {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'scripts/commit-msg-guard.sh'), readFileSync(realGuard), { mode: 0o755 });
  }
  return { dir, git };
}

/** The real git, resolved once — a shim that shadows `git` still has to call through to it. */
const REAL_GIT = spawnSync('/bin/bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

/**
 * A PATH directory holding a `git` that fails one subcommand and passes the rest through.
 * `subcommand: null` fails nothing — the negative control, which is what keeps a test using
 * this from passing merely because the shim broke git outright.
 */
function gitShim(subcommand) {
  const dir = tempDir('sc-git-shim-');
  const fail = subcommand
    ? `for a in "$@"; do [ "$a" = ${JSON.stringify(subcommand)} ] && exit 1; done\n`
    : '';
  writeFileSync(join(dir, 'git'), `#!/bin/bash\n${fail}exec ${REAL_GIT} "$@"\n`, { mode: 0o755 });
  return dir;
}

/**
 * A `git` that lets the first N calls to one subcommand through and fails every later one.
 * Needed because a shim that fails EVERY `for-each-ref` aborts before `git commit`, so it
 * can never reach the second snapshot — an oracle that cannot reach the branch it is aimed
 * at proves nothing about it. State lives in a counter file, since each call is a new process.
 */
function gitShimAfter(subcommand, passes) {
  const dir = tempDir('sc-git-shim-n-');
  writeFileSync(join(dir, 'git'), [
    '#!/bin/bash',
    `counter=${JSON.stringify(join(dir, 'count'))}`,
    'for a in "$@"; do',
    `  if [ "$a" = ${JSON.stringify(subcommand)} ]; then`,
    '    n=$(cat "$counter" 2>/dev/null || echo 0)',
    '    printf %s $((n + 1)) > "$counter"',
    `    [ "$n" -ge ${passes} ] && exit 1`,
    '  fi',
    'done',
    `exec ${REAL_GIT} "$@"`,
  ].join('\n'), { mode: 0o755 });
  return dir;
}

function run(dir, args, { env = {}, script = execScript } = {}) {
  return spawnSync('/bin/bash', ['-p', script, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: dir, ...env },
  });
}

/** Allocate a message file and fill it, the way the skill drives the script. */
function stage(repo, message, files = ['a.txt']) {
  for (const f of files) {
    writeFileSync(join(repo.dir, f), `content of ${f}\n`);
    repo.git('add', f);
  }
  const alloc = run(repo.dir, ['alloc']);
  assert.equal(alloc.status, 0, `alloc must succeed: ${alloc.stderr}`);
  const msgFile = alloc.stdout.trim();
  writeFileSync(msgFile, message);
  return msgFile;
}

/* ------------------------------------------------------------------ dispatch.sh */

test('dispatch.sh --allowlist → exactly the four permitted commands', () => {
  assert.deepEqual(allowlist(), ['bash', 'git', 'mktemp', 'rm']);
});

test('`env` is not allowlisted → the transitive escape through it is refused', () => {
  // `env` was listed for a call site that does not exist: the one `env` in the flow is the
  // privileged re-exec, which names /usr/bin/env by absolute path and runs before this file
  // is sourced. Listing it handed out `sd_run env /bin/sh -c ...` for nothing.
  const r = spawnSync('/bin/bash', ['-p', dispatchScript, 'env', '/bin/sh', '-c', 'echo reached'],
    { encoding: 'utf8' });
  assert.equal(r.status, 127, 'env must be refused');
  assert.doesNotMatch(r.stdout, /reached/, 'nothing behind env may run');
});

test('sd_run given a command outside the allowlist → status 127, names the command', () => {
  const r = spawnSync('/bin/bash', ['-p', dispatchScript, 'curl', '-sS', 'https://example.com'],
    { encoding: 'utf8' });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /refusing `curl`/);
  assert.equal(r.stdout, '', 'a refused command must produce no output of its own');
});

test('sd_run given an allowlisted command → runs it', () => {
  const r = spawnSync('/bin/bash', ['-p', dispatchScript, 'git', '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^git version /);
});

test('sd_run given `*` → refused as a literal, not matched against every entry', () => {
  const r = spawnSync('/bin/bash', ['-p', dispatchScript, '*'], { encoding: 'utf8' });
  assert.equal(r.status, 127, 'a glob must not satisfy the membership test');
});

test('sd_run with no command → status 2', () => {
  const r = spawnSync('/bin/bash', ['-p', dispatchScript], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

/* ------------------------------------------------------------- execute.sh: alloc */

test('alloc → an empty mode-0600 file under TMPDIR with the documented prefix', () => {
  const repo = mkRepo();
  const r = run(repo.dir, ['alloc']);
  assert.equal(r.status, 0, r.stderr);
  const path = r.stdout.trim();
  assert.equal(dirname(path), repo.dir, 'TMPDIR must select the directory');
  assert.match(path, /\/smart-commit-msg\.\w{6}$/);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(path).size, 0);
});

test('alloc with a hostile TMPDIR → fails closed rather than allocating', () => {
  const repo = mkRepo();
  const r = run(repo.dir, ['alloc'], { env: { TMPDIR: '-d' } });
  // What this proves is the FAIL-CLOSED behaviour in the test's name: a hostile TMPDIR ends the
  // run with nothing allocated. It deliberately does not claim `--` is what caused that —
  // without `--`, `mktemp` also fails, on `-d/smart-commit-msg.XXXXXX` being an invalid option,
  // so the outcome is identical and the assertion cannot distinguish them (Codex, round 93).
  // The shipped `--` is held in place by the ordered segment pin instead, which compares it.
  assert.notEqual(r.status, 0, 'a hostile TMPDIR must end the run rather than allocate');
  assert.equal(r.stdout.trim(), '', 'nothing may be reported as allocated');
});

/* ------------------------------------------------------------ execute.sh: commit */

test('commit with a clean message → commits and removes the message file', () => {
  const repo = mkRepo();
  const msgFile = stage(repo, 'feat: Add a.txt\n');
  const r = run(repo.dir, ['commit', msgFile]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(msgFile), false, 'the message file must not survive the commit');
  const log = repo.git('log', '--oneline', '-1');
  assert.match(log.stdout, /feat: Add a\.txt/);
});

test('commit with an AI trailer and no opt-in → status 4, HEAD unchanged, file removed', () => {
  const repo = mkRepo();
  stage(repo, 'chore: Base\n');
  run(repo.dir, ['commit', stage(repo, 'chore: Base\n', ['base.txt'])]);
  const before = repo.git('rev-parse', 'HEAD').stdout.trim();

  const msgFile = stage(repo, `feat: Add b.txt\n\n${AI_LINE}\n`, ['b.txt']);
  const r = run(repo.dir, ['commit', msgFile]);
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stderr, /AI content detected/);
  assert.equal(repo.git('rev-parse', 'HEAD').stdout.trim(), before, 'no commit may be created');
  assert.equal(existsSync(msgFile), false, 'the message must not be left on disk after a refusal');
});

test('commit with the same trailer and --ai-co-author → commits (narrow whitelist)', () => {
  const repo = mkRepo();
  const msgFile = stage(repo, `feat: Add a.txt\n\n${AI_LINE}\n`);
  const r = run(repo.dir, ['commit', msgFile, '--ai-co-author']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(repo.git('log', '-1', '--format=%B').stdout, /Co-Authored-By: Claude/);
});

test('--ai-co-author does not widen the whitelist to other AI attribution', () => {
  const repo = mkRepo();
  const msgFile = stage(repo, 'feat: Add a.txt\n\nGenerated by Claude\n');
  const r = run(repo.dir, ['commit', msgFile, '--ai-co-author']);
  assert.equal(r.status, 4, 'only the one exact line is permitted, even with the opt-in');
});

/** Install a commit-msg hook that reports whether it can see the opt-in, then passes. */
function reportingHook(repo) {
  mkdirSync(join(repo.dir, '.git/hooks'), { recursive: true });
  writeFileSync(join(repo.dir, '.git/hooks/commit-msg'),
    '#!/bin/bash\nprintf \'ALLOW_AI_COAUTHOR=[%s]\\n\' "${ALLOW_AI_COAUTHOR:-unset}" >&2\nexit 0\n',
    { mode: 0o755 });
}

test('without the opt-in, no hook ever sees ALLOW_AI_COAUTHOR', () => {
  const repo = mkRepo();
  reportingHook(repo);
  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /ALLOW_AI_COAUTHOR=\[unset\]/,
    'the default path must not export the opt-in to anything');
});

test('with the opt-in, git commit does see it — the canonical hook needs it', () => {
  const repo = mkRepo();
  reportingHook(repo);
  const r = run(repo.dir, ['commit', stage(repo, `feat: Add a.txt\n\n${AI_LINE}\n`), '--ai-co-author']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /ALLOW_AI_COAUTHOR=\[1\]/,
    'withholding it made --ai-co-author unusable wherever the recommended hook was installed');
});

test('--ai-co-author works with the REAL guard installed as the commit-msg hook', () => {
  // The end-to-end shape the previous version got wrong: the recommended installation is
  // the canonical guard as the hook, and that hook reads ALLOW_AI_COAUTHOR to permit the
  // one whitelisted line. With the opt-in withheld it rejected the exact line the flag
  // exists to allow, and the commit failed with status 5.
  const repo = mkRepo();
  mkdirSync(join(repo.dir, '.git/hooks'), { recursive: true });
  writeFileSync(join(repo.dir, '.git/hooks/commit-msg'), readFileSync(realGuard), { mode: 0o755 });

  const ok = run(repo.dir, ['commit', stage(repo, `feat: Add a.txt\n\n${AI_LINE}\n`), '--ai-co-author']);
  assert.equal(ok.status, 0, `the whitelisted line must pass the real hook: ${ok.stderr}`);
  assert.match(repo.git('log', '-1', '--format=%B').stdout, /Co-Authored-By: Claude/);

  // The other direction, in the same fixture: the opt-in is not a general bypass of the
  // hook. Without both halves this test would pass for a script that simply disabled it.
  const nope = run(repo.dir,
    ['commit', stage(repo, 'feat: Add b.txt\n\nGenerated by Claude\n', ['b.txt']), '--ai-co-author'],
  );
  assert.equal(nope.status, 4, 'every non-whitelisted form stays rejected with the flag set');
});

test('an inherited ALLOW_AI_COAUTHOR=1 does not turn on the opt-in', () => {
  const repo = mkRepo();
  const msgFile = stage(repo, `feat: Add a.txt\n\n${AI_LINE}\n`);
  const r = run(repo.dir, ['commit', msgFile], { env: { ALLOW_AI_COAUTHOR: '1' } });
  assert.equal(r.status, 4, 'the opt-in is a flag, never an inherited environment variable');
});

test('commit when the guard is absent → status 3, no commit, message removed', () => {
  const repo = mkRepo({ withGuard: false });
  const msgFile = stage(repo, 'feat: Add a.txt\n');
  const r = run(repo.dir, ['commit', msgFile]);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stderr, /install-scripts commit-msg-guard/);
  assert.equal(existsSync(msgFile), false);
  assert.equal(repo.git('rev-parse', '--verify', 'HEAD').status !== 0, true, 'nothing committed');
});

test('commit outside a repository → status 6, message removed', () => {
  const dir = tempDir('smart-commit-norepo-');
  const alloc = run(dir, ['alloc']);
  const msgFile = alloc.stdout.trim();
  writeFileSync(msgFile, 'chore: nowhere\n');
  const r = run(dir, ['commit', msgFile], { env: { GIT_CEILING_DIRECTORIES: dirname(dir) } });
  assert.equal(r.status, 6, r.stderr);
  assert.equal(existsSync(msgFile), false);
});

test('.claude/scripts/commit-msg-guard.sh wins over scripts/', () => {
  const repo = mkRepo();
  mkdirSync(join(repo.dir, '.claude/scripts'), { recursive: true });
  writeFileSync(join(repo.dir, '.claude/scripts/commit-msg-guard.sh'),
    '#!/bin/bash\necho PRECEDENCE-MARKER >&2\nexit 1\n', { mode: 0o755 });
  const msgFile = stage(repo, 'chore: ordinary message the real guard would accept\n');
  const r = run(repo.dir, ['commit', msgFile]);
  assert.equal(r.status, 4, 'the .claude copy decided the verdict');
  assert.match(r.stderr, /PRECEDENCE-MARKER/);
});

test('CLAUDE_PLUGIN_ROOT cannot select the validator', () => {
  const repo = mkRepo();
  const evil = tempDir('smart-commit-evil-');
  mkdirSync(join(evil, 'scripts'), { recursive: true });
  writeFileSync(join(evil, 'scripts/commit-msg-guard.sh'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const msgFile = stage(repo, `feat: Add a.txt\n\n${AI_LINE}\n`);
  const r = run(repo.dir, ['commit', msgFile], { env: { CLAUDE_PLUGIN_ROOT: evil } });
  assert.equal(r.status, 4, 'resolution is repo-relative — no variable names the policy');
});

test('a repointed git root cannot swap in a permissive guard', () => {
  // The planted repository holds a guard that passes everything. If GIT_DIR/GIT_WORK_TREE
  // reached `rev-parse`, resolution would find that one and the AI line would commit.
  const here = mkRepo();
  const planted = mkRepo({ withGuard: false });
  mkdirSync(join(planted.dir, 'scripts'), { recursive: true });
  writeFileSync(join(planted.dir, 'scripts/commit-msg-guard.sh'),
    '#!/bin/bash\nexit 0\n', { mode: 0o755 });

  const repoint = {
    GIT_DIR: join(planted.dir, '.git'),
    GIT_WORK_TREE: planted.dir,
    GIT_CEILING_DIRECTORIES: '',
  };
  // Control: the variables genuinely have this power. Without it the assertion below
  // would pass just as well against a fixture that never pointed anywhere.
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'],
    { cwd: here.dir, encoding: 'utf8', env: { ...process.env, ...repoint } });
  assert.equal(probe.stdout.trim(), planted.dir, 'the fixture must actually repoint git');

  const msgFile = stage(here, `feat: Add a.txt\n\n${AI_LINE}\n`);
  const r = run(here.dir, ['commit', msgFile], { env: repoint });
  assert.equal(r.status, 4, 'the guard of the repository containing the current directory decides');
});

test('a repointed git root cannot redirect where the commit lands', () => {
  const here = mkRepo();
  const planted = mkRepo();
  const plantedBefore = planted.git('rev-parse', '--verify', 'HEAD').status;
  const msgFile = stage(here, 'feat: Add a.txt\n');
  const r = run(here.dir, ['commit', msgFile], {
    env: { GIT_DIR: join(planted.dir, '.git'), GIT_WORK_TREE: planted.dir, GIT_CEILING_DIRECTORIES: '' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(here.git('log', '--oneline', '-1').stdout, /feat: Add a\.txt/);
  assert.equal(planted.git('rev-parse', '--verify', 'HEAD').status, plantedBefore,
    'the planted repository must be untouched');
});

test('--sign and --no-sign together → status 2, nothing committed', () => {
  const repo = mkRepo();
  const msgFile = stage(repo, 'feat: Add a.txt\n');
  const r = run(repo.dir, ['commit', msgFile, '--sign', '--no-sign']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /mutually exclusive/);
  assert.equal(existsSync(msgFile), true, 'a usage error must not consume the message file');
});

// Both sign tests use a deliberately broken signer (`gpg.program=/bin/false`) so that
// "was -S / --no-gpg-sign actually passed to git?" becomes an observable exit status
// rather than something only a human reading the source can confirm.
test('--no-sign reaches git as --no-gpg-sign', () => {
  const repo = mkRepo();
  repo.git('config', 'commit.gpgsign', 'true');
  repo.git('config', 'gpg.program', '/bin/false');
  repo.git('config', 'user.signingkey', 'DEADBEEF');
  const blocked = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(blocked.status, 5,
    'control: signing must genuinely be on and genuinely failing, or the next line proves nothing');
  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add b.txt\n', ['b.txt']), '--no-sign']);
  assert.equal(r.status, 0, r.stderr);
});

test('--sign reaches git as -S', () => {
  const repo = mkRepo();               // mkRepo sets commit.gpgsign=false
  repo.git('config', 'gpg.program', '/bin/false');
  repo.git('config', 'user.signingkey', 'DEADBEEF');
  const plain = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(plain.status, 0,
    'control: without the flag this same repo commits fine, so the failure below is the flag');
  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add b.txt\n', ['b.txt']), '--sign']);
  assert.equal(r.status, 5, 'forcing a broken signer must fail the commit, not silently skip signing');
});

test('an unknown option → status 2', () => {
  const repo = mkRepo();
  const msgFile = stage(repo, 'feat: Add a.txt\n');
  assert.equal(run(repo.dir, ['commit', msgFile, '--force']).status, 2);
});

test('a missing message file → status 2', () => {
  const repo = mkRepo();
  assert.equal(run(repo.dir, ['commit', join(repo.dir, 'nope')]).status, 2);
});

test('no subcommand → usage on stderr, status 2', () => {
  const repo = mkRepo();
  const r = run(repo.dir, []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: smart-commit-execute\.sh alloc/);
});

/* ------------------ hooks fighting the verifier: the fixtures behind the design */

/** Install an executable hook. */
function hook(repo, name, body) {
  mkdirSync(join(repo.dir, '.git/hooks'), { recursive: true });
  writeFileSync(join(repo.dir, `.git/hooks/${name}`), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
}

test('a commit-msg hook injecting attribution is caught, not reported clean', () => {
  const repo = mkRepo();
  // The message file the guard validated is NOT the commit. This hook is what makes the
  // two different, and it is why verification reads the commit back at all.
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(r.status, 4, 'the injected trailer must be caught by the read-back');
  assert.match(repo.git('log', '-1', '--format=%B').stdout, /Co-Authored-By: Claude/,
    'control: the hook really did land the trailer in the commit');
});

test('a post-commit hook stacking a clean commit cannot hide the leaking one', () => {
  const repo = mkRepo();
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  // The leaking commit is no longer at HEAD by the time anything looks. A check bound to
  // HEAD returns 0 here; binding to rev-list <before>..<after> is what catches it.
  hook(repo, 'post-commit', [
    '[ -e "$(git rev-parse --git-dir)/stacked" ] && exit 0',
    ': > "$(git rev-parse --git-dir)/stacked"',
    'printf x > stacked.txt && git add stacked.txt',
    'git commit --no-verify -q -m "chore: stacked clean"',
  ].join('\n'));

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(r.status, 4, 'the buried commit must still be verified');
  assert.match(repo.git('log', '-1', '--format=%B').stdout, /stacked clean/,
    'control: the stack really did happen, so HEAD is NOT the commit under test');
});

test('parking the leaking commit on another ref does not hide it either', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  // Not a stack: the leaking commit A is parked on a side ref and the branch is rebuilt on
  // A's PARENT, so `before..after` contains only the clean commit. A is still reachable —
  // and therefore still pushable. Only snapshotting the whole ref space sees it.
  hook(repo, 'post-commit', [
    '[ -e "$(git rev-parse --git-dir)/done" ] && exit 0',
    ': > "$(git rev-parse --git-dir)/done"',
    'A=$(git rev-parse HEAD)',
    'git update-ref refs/keep/leaked "$A"',
    'B=$(git commit-tree "$A^{tree}" -p "$A^" -m "feat: clean")',
    'git update-ref refs/heads/main "$B"',
  ].join('\n'));

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.match(repo.git('log', '-1', '--format=%B').stdout, /feat: clean/,
    'control: the branch really was diverted, so HEAD is clean and A is off to the side');
  assert.match(repo.git('log', '-1', '--format=%B', 'refs/keep/leaked').stdout, /Co-Authored-By/,
    'control: and the parked commit really does carry the trailer');
  // 4, not 7 — and this assertion INVERTED in round 84, deliberately. While ownership was
  // decided by reachability from HEAD, A looked unattributable and the honest answer was
  // UNVERIFIED. But A is the commit `git commit` itself made; the hook only diverted the
  // branch afterwards. The reflog marker says so, so "your commit leaked" is now a claim this
  // process can actually support, and reporting it as merely unverified would understate a
  // leak it can prove. The negative control that keeps this honest is the fetched-tag test
  // below: a commit made in ANOTHER repository carries no marker and still returns 7.
  assert.equal(r.status, 4, 'a commit this invocation provably made is a leak verdict, not UNVERIFIED');
  assert.match(r.stderr, new RegExp(`AI attribution leaked in commit ${repo.git('rev-parse', 'refs/keep/leaked').stdout.trim()}`),
    'and the diagnostic must name the parked OID, since it is not the one at HEAD');
});

// Round 84, Codex P1. A `git` shim, not a hook: hooks run DURING `git commit`, and the window
// this exercises opens only after it returns. The shim fires on the post-commit
// `rev-parse --verify HEAD` (discriminated from the two `--quiet` reads around it) and, before
// passing through, advances the checked-out branch to an attribution-bearing commit made
// WITHOUT this invocation's marker — exactly a colleague's process landing in the window.
//
// While ownership was reachability-from-HEAD this returned 4: the foreign commit is reachable
// from the HEAD actually observed and absent from before_tips, so the developer was told their
// own commit leaked and pointed at someone else's OID to amend.
function withConcurrentAdvance(repo, message) {
  const dir = tempDir('sc-git-race-');
  const flag = join(dir, 'fired');
  writeFileSync(join(dir, 'git'), [
    '#!/bin/bash',
    `flag=${JSON.stringify(flag)}`,
    'if [ ! -e "$flag" ]; then',
    '  v=0; h=0; q=0',
    '  for a in "$@"; do',
    '    [ "$a" = --verify ] && v=1',
    '    [ "$a" = HEAD ] && h=1',
    '    [ "$a" = --quiet ] && q=1',
    '  done',
    '  if [ "$v" = 1 ] && [ "$h" = 1 ] && [ "$q" = 0 ]; then',
    '    : > "$flag"',
    // The foreign process has no reason to carry our marker, and unsetting it here is what
    // makes that explicit rather than incidental.
    '    unset GIT_REFLOG_ACTION',
    `    R=${JSON.stringify(repo.dir)}`,
    `    A=$(${REAL_GIT} -C "$R" rev-parse HEAD)`,
    `    L=$(${REAL_GIT} -C "$R" commit-tree "$A^{tree}" -p "$A" -m ${JSON.stringify(message)})`,
    `    ${REAL_GIT} -C "$R" update-ref refs/heads/main "$L"`,
    '  fi',
    'fi',
    `exec ${REAL_GIT} "$@"`,
  ].join('\n'), { mode: 0o755 });
  return dir;
}

test("a concurrent commit landing on the branch is not reported as the developer's leak", () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  const shim = withConcurrentAdvance(repo, `chore: their work\n\n${AI_LINE}\n`);

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')],
    { env: { PATH: `${shim}:${process.env.PATH}` } });

  assert.match(repo.git('log', '-1', '--format=%B').stdout, /Co-Authored-By/,
    'control: the foreign commit really did land on the branch and carries the trailer');
  assert.equal(repo.git('log', '-2', '--format=%s').stdout.trim().split('\n')[1], 'feat: Add a.txt',
    'control: and our own clean commit is its parent, so both are in the traversal');
  assert.equal(r.status, 7, `someone else's commit is UNVERIFIED, never a leak verdict: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /AI attribution leaked in commit/,
    'the developer must NOT be told their own commit leaked');
  assert.match(r.stderr, /no reflog entry ties it to THIS invocation/,
    'and the diagnostic must say why ownership could not be established');
});

// Found by mutation, not by review: replacing the generated marker with a CONSTANT left every
// other test green. A constant marker is not inert — it makes every past and concurrent run of
// this same script indistinguishable from this one, so a commit another run made gets claimed
// here and reported as this run's leak. That is the very misattribution the marker exists to
// prevent, reintroduced one level up. The claim "only uniqueness matters" therefore needs a
// control of its own.
test('each invocation uses a distinct reflog marker', () => {
  const repo = mkRepo();
  const first = run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  const second = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(first.status, 0, `control: first commit must succeed: ${first.stderr}`);
  assert.equal(second.status, 0, `control: second commit must succeed: ${second.stderr}`);

  const markers = repo.git('reflog', '--format=%gs').stdout
    .split('\n').filter(Boolean)
    .filter((l) => l.startsWith('sd0x-exec-'))
    .map((l) => l.slice(0, l.indexOf(':')));
  assert.equal(markers.length, 2, `both commits must carry a marker, got: ${markers.join(' | ')}`);
  assert.notEqual(markers[0], markers[1],
    'two invocations must not share a marker, or each can claim the other\'s commit');
});

/**
 * Round 84, Codex P1. Ownership used to be asked per commit — one `git reflog` read for every
 * OID the traversal returned — so a window that admitted N commits cost N full reflog walks of
 * a log that does not change between them. The fix reads it once and does set membership in
 * memory; this fixture is what keeps the fix from silently regressing, since a per-commit read
 * is invisible in every verdict the other tests assert.
 *
 * The shim advances the branch by three foreign commits in the post-commit window, so the
 * traversal really does carry four OIDs. The last of them leaks, which is the control: without
 * it, "reflog was read once" is equally true of a script that aborted after the first OID.
 */
function withCountingAdvance(repo, messages) {
  const dir = tempDir('sc-git-count-');
  const counter = join(dir, 'reflog-calls');
  const flag = join(dir, 'fired');
  writeFileSync(join(dir, 'git'), [
    '#!/bin/bash',
    `counter=${JSON.stringify(counter)}`,
    `flag=${JSON.stringify(flag)}`,
    'for a in "$@"; do',
    '  if [ "$a" = reflog ]; then',
    '    n=$(cat "$counter" 2>/dev/null || echo 0)',
    '    printf %s $((n + 1)) > "$counter"',
    '  fi',
    'done',
    'if [ ! -e "$flag" ]; then',
    '  v=0; h=0; q=0',
    '  for a in "$@"; do',
    '    [ "$a" = --verify ] && v=1',
    '    [ "$a" = HEAD ] && h=1',
    '    [ "$a" = --quiet ] && q=1',
    '  done',
    '  if [ "$v" = 1 ] && [ "$h" = 1 ] && [ "$q" = 0 ]; then',
    '    : > "$flag"',
    '    unset GIT_REFLOG_ACTION',
    `    R=${JSON.stringify(repo.dir)}`,
    ...messages.map((m) => [
      `    A=$(${REAL_GIT} -C "$R" rev-parse HEAD)`,
      `    L=$(${REAL_GIT} -C "$R" commit-tree "$A^{tree}" -p "$A" -m ${JSON.stringify(m)})`,
      `    ${REAL_GIT} -C "$R" update-ref refs/heads/main "$L"`,
    ].join('\n')),
    '  fi',
    'fi',
    `exec ${REAL_GIT} "$@"`,
  ].join('\n'), { mode: 0o755 });
  return { dir, calls: () => Number(readFileSync(counter, 'utf8')) };
}

test('the reflog is read exactly once however many commits the window admitted', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  // The leak is on the OLDEST foreign commit, and that placement is the whole control.
  // `rev-list` walks newest-first, so a leak on the NEWEST one would be the first OID examined
  // and a script that aborted after one commit would report it just the same — "read once"
  // would then be true for the wrong reason. Placed oldest, it is reached only by a loop that
  // ran its full length, so both assertions below depend on that.
  const shim = withCountingAdvance(repo,
    [`chore: theirs one\n\n${AI_LINE}\n`, 'chore: theirs two', 'chore: theirs three']);

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')],
    { env: { PATH: `${shim.dir}:${process.env.PATH}` } });

  assert.equal(repo.git('rev-list', '--count', 'HEAD').stdout.trim(), '5',
    'control: base + ours + three foreign commits are all on the branch');
  assert.match(repo.git('log', '-1', '--format=%B', 'HEAD~2').stdout, /Co-Authored-By/,
    'control: the leaking commit really is the oldest of the three, not the newest');
  assert.equal(r.status, 7, `an unattributable leaking commit is UNVERIFIED: ${r.stderr}`);
  assert.match(r.stderr, new RegExp(`${repo.git('rev-parse', 'HEAD~2').stdout.trim()} became reachable`),
    'the loop must have examined the third of four OIDs, so it ran its full length');
  assert.equal(shim.calls(), 1,
    'four OIDs must cost one reflog read, not one per commit');
});

/**
 * The verdict table in execute-mode.md says an unreadable reflog costs a TRAILER-BEARING commit
 * a 7 and a clean one nothing at all. That was written as prose before it was written as a
 * test, which makes it a claim rather than a fact — and the asymmetry is easy to get wrong in
 * either direction: failing closed on every commit would break ordinary use in a repository
 * with no reflog, and failing open on the leaking one would be the defect the check exists to
 * prevent. Both directions are asserted here against the same shim.
 */
test('an unreadable reflog costs a clean commit nothing and a leaking one a 7', () => {
  const clean = mkRepo();
  run(clean.dir, ['commit', stage(clean, 'chore: base\n', ['base.txt'])]);
  const r = run(clean.dir, ['commit', stage(clean, 'feat: Add a.txt\n')],
    { env: { PATH: `${gitShim('reflog')}:${process.env.PATH}` } });
  assert.equal(r.status, 0, `a clean commit must not be blocked by an unreadable reflog: ${r.stderr}`);
  assert.match(r.stderr, /reflog could not be read/,
    'though the run must still say the read failed — silence would misreport it as attributed');
  assert.equal(clean.git('log', '-1', '--format=%s').stdout.trim(), 'feat: Add a.txt',
    'control: the commit really was made');

  const leaky = mkRepo();
  run(leaky.dir, ['commit', stage(leaky, 'chore: base\n', ['base.txt'])]);
  hook(leaky, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  const r2 = run(leaky.dir, ['commit', stage(leaky, 'feat: Add a.txt\n')],
    { env: { PATH: `${gitShim('reflog')}:${process.env.PATH}` } });
  assert.equal(r2.status, 7, `an unattributable leak is UNVERIFIED, never a pass: ${r2.stderr}`);
  assert.doesNotMatch(r2.stderr, /AI attribution leaked in commit/,
    'and with ownership unestablished it must not be reported as the developer\'s own leak');
});

test('a local graft file is refused rather than trusted', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  // Grafts rewrite parentage, which changes what rev-list considers already reachable —
  // the same masking class as replace refs, and NOT covered by --no-replace-objects.
  const graft = spawnSync('git', ['rev-parse', '--git-path', 'info/grafts'],
    { cwd: repo.dir, encoding: 'utf8' }).stdout.trim();
  mkdirSync(dirname(join(repo.dir, graft)), { recursive: true });
  writeFileSync(join(repo.dir, graft), `${repo.git('rev-parse', 'HEAD').stdout.trim()}\n`);

  const msgFile = stage(repo, 'feat: Add a.txt\n');
  const r = run(repo.dir, ['commit', msgFile]);
  assert.equal(r.status, 7, 'unverifiable ancestry is UNVERIFIED, not "probably fine"');
  assert.match(r.stderr, /grafts/);
  assert.equal(existsSync(msgFile), false, 'and the message must not be left on disk');
});

test('a graft installed by the POST-commit hook is refused, not traversed through', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  // Checking for grafts only on the way in leaves a window: the post-commit hook runs after
  // the object exists. Here it builds clean commit B on top of leaking A, moves the branch,
  // then grafts B onto A's PARENT — which lifts A out of `rev-list B --not P` while leaving
  // A a real, pushable object. Reproduced standalone before this test was written.
  hook(repo, 'post-commit', [
    '[ -e "$(git rev-parse --git-dir)/done" ] && exit 0',
    ': > "$(git rev-parse --git-dir)/done"',
    'A=$(git rev-parse HEAD)',
    'B=$(git commit-tree "$A^{tree}" -p "$A" -m "feat: clean")',
    'git update-ref refs/heads/main "$B"',
    'mkdir -p "$(git rev-parse --git-dir)/info"',
    'printf "%s %s\\n" "$B" "$(git rev-parse "$A^")" > "$(git rev-parse --git-dir)/info/grafts"',
  ].join('\n'));

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.match(repo.git('log', '-1', '--format=%B').stdout, /feat: clean/,
    'control: the hook really did rebuild the branch, so the traversal starts from B');
  assert.equal(r.status, 7, 'ancestry rewritten mid-operation is UNVERIFIED, not "nothing new"');
  assert.match(r.stderr, /grafts/);
});

test('an unreadable ref space aborts instead of narrowing the snapshot to HEAD', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  // A snapshot that loses `for-each-ref` degrades to HEAD alone — exactly the blind spot the
  // ref-space snapshot was introduced to close. Silently covering less is the failure being
  // tested for, so the oracle fails ONLY that subcommand and passes everything else through.
  const failing = gitShim('for-each-ref');
  const msgFile = stage(repo, 'feat: Add a.txt\n');
  const r = run(repo.dir, ['commit', msgFile], { env: { PATH: `${failing}:${process.env.PATH}` } });
  assert.equal(r.status, 7, 'a degraded snapshot must abort, not quietly cover less');
  assert.match(r.stderr, /ref space/);
  assert.equal(repo.git('log', '-1', '--format=%s').stdout.trim(), 'chore: base',
    'control: and nothing was committed');
  assert.equal(existsSync(msgFile), false, 'nor left the message on disk');

  // The other direction. Without this the test would also pass for a shim that merely broke
  // git, which would make it evidence of nothing.
  const passthrough = gitShim(null);
  const ok = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')],
    { env: { PATH: `${passthrough}:${process.env.PATH}` } });
  assert.equal(ok.status, 0, `the same shim failing nothing must commit: ${ok.stderr}`);
});

test('the ref space failing AFTER the commit is caught too, not just before', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  // The test above cannot reach this branch: its shim fails every `for-each-ref`, so the
  // command aborts before `git commit` ever runs. Deleting the post-commit handler left the
  // whole suite green — a handler no test can reach is an assertion that cannot fail.
  const late = gitShimAfter('for-each-ref', 1);
  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')],
    { env: { PATH: `${late}:${process.env.PATH}` } });
  assert.equal(r.status, 7, 'losing the ref space after committing is UNVERIFIED');
  assert.match(r.stderr, /ref space back after committing/,
    'and it must be the POST-commit diagnostic, proving the branch was reached');
  assert.equal(repo.git('log', '-1', '--format=%s').stdout.trim(), 'feat: Add a.txt',
    'control: the commit itself really did happen, so this is the after-path');
});

test('an unborn repository commits — the fail-closed path must not swallow the first commit', () => {
  const repo = mkRepo();
  writeFileSync(join(repo.dir, 'a.txt'), 'first\n');
  repo.git('add', 'a.txt');
  const r = run(repo.dir, ['commit', stage(repo, 'feat: the very first commit\n')]);
  assert.equal(r.status, 0, `an unborn HEAD is legitimate, not unreadable: ${r.stderr}`);
  assert.equal(repo.git('log', '-1', '--format=%s').stdout.trim(), 'feat: the very first commit');
});

test('an orphan branch in an established repository is still unborn, not unreadable', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  repo.git('checkout', '-q', '--orphan', 'fresh-start');
  // Refs exist, but HEAD's target does not — so "no refs at all" would be the wrong test for
  // unborn, and this case is exactly what it would break.
  const r = run(repo.dir, ['commit', stage(repo, 'feat: on an orphan branch\n', ['o.txt'])]);
  assert.equal(r.status, 0, `an orphan branch must commit: ${r.stderr}`);
});

test('a symbolic HEAD pointing at a MALFORMED ref is unreadable, not "unborn"', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  const msgFile = stage(repo, 'feat: Add a.txt\n');
  // `symbolic-ref -q HEAD` succeeds here, and HEAD does not resolve — the same two signals an
  // unborn branch produces. What separates them is that this target EXISTS and is broken.
  repo.git('symbolic-ref', 'HEAD', 'refs/heads/broken');
  writeFileSync(join(repo.dir, '.git/refs/heads/broken'), 'not a valid object id\n');

  const r = run(repo.dir, ['commit', msgFile]);
  // Asserting only "not 0" was NOT evidence: with the discrimination removed the run falls
  // through and dies later inside `git commit` with status 5, which is also not 0. The
  // status and the diagnostic together are what pin the refusal to the snapshot.
  assert.equal(r.status, 7, 'a corrupt ref is UNVERIFIED, refused before anything is committed');
  assert.match(r.stderr, /ref space before committing/,
    'and the refusal must come from the snapshot, not from a later incidental failure');
  assert.equal(repo.git('log', '-1', '--format=%s', 'refs/heads/main').stdout.trim(), 'chore: base',
    'control: nothing was committed');
  assert.equal(existsSync(msgFile), false, 'and the message must not be left on disk');
});

test('the scrub list covers every variable git itself calls repository-local', () => {
  // Hand-picking this list is what left GIT_GRAFT_FILE and GIT_CONFIG_PARAMETERS out, so the
  // authority is git, not a list maintained by hand. A future git adding one fails here.
  const declared = spawnSync(REAL_GIT, ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
    .stdout.trim().split('\n').filter(Boolean);
  assert.ok(declared.length > 5, 'control: git must actually have named some variables');
  const src = readFileSync(execScript, 'utf8');
  const unset = (src.match(/^unset GIT_DIR[\s\S]*?ALLOW_AI_COAUTHOR$/m) || [''])[0];
  assert.notEqual(unset, '', 'the unset block must still be findable');
  for (const name of declared) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(unset), `${name} must be scrubbed`);
  }
});

test('GIT_GRAFT_FILE cannot redirect ancestry around the graft refusal', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  // info/grafts stays absent, so the graft refusal sees a clean repository — the ancestry
  // rewrite rides in on the environment instead. Measured standalone: pointing this at a
  // custom graft file took `rev-list B --not P` from 2 commits to 1, hiding the leaking one.
  const graftFile = join(repo.dir, 'custom-graft');
  hook(repo, 'post-commit', [
    '[ -e "$(git rev-parse --git-dir)/done" ] && exit 0',
    ': > "$(git rev-parse --git-dir)/done"',
    'A=$(git rev-parse HEAD)',
    'B=$(git commit-tree "$A^{tree}" -p "$A" -m "feat: clean")',
    'git update-ref refs/heads/main "$B"',
    `printf "%s %s\\n" "$B" "$(git rev-parse "$A^")" > ${JSON.stringify(graftFile)}`,
  ].join('\n'));

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')],
    { env: { GIT_GRAFT_FILE: graftFile } });
  assert.equal(existsSync(join(repo.dir, '.git/info/grafts')), false,
    'control: the default graft file is absent, so the file-based refusal cannot be what fires');
  assert.equal(r.status, 4, 'the trailer must be found despite the redirected graft file');
});

test('GIT_CONFIG_PARAMETERS cannot inject config into the commit', () => {
  const repo = mkRepo();
  // Measured standalone: with this set, `git config user.email` returns the injected value.
  // The same channel reaches core.hooksPath and commit.gpgsign, which is why it is scrubbed
  // rather than merely noted.
  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')],
    { env: { GIT_CONFIG_PARAMETERS: "'user.email'='injected@evil.test'" } });
  assert.equal(r.status, 0, `the commit must succeed: ${r.stderr}`);
  assert.equal(repo.git('log', '-1', '--format=%ae').stdout.trim(), 'dev@example.com',
    'the injected identity must not reach the commit');
});

/** An upstream repo whose tip carries `message`, wired up as `origin` with a fetching hook. */
function withFetchingUpstream(repo, message, { tag = null } = {}) {
  const upstream = mkRepo({ withGuard: false });
  writeFileSync(join(upstream.dir, 'u.txt'), 'theirs\n');
  upstream.git('add', 'u.txt');
  upstream.git('commit', '-q', '-m', message);
  if (tag) upstream.git('tag', tag);
  repo.git('remote', 'add', 'origin', upstream.dir);
  hook(repo, 'post-commit', [
    '[ -e "$(git rev-parse --git-dir)/fetched" ] && exit 0',
    ': > "$(git rev-parse --git-dir)/fetched"',
    'git fetch -q origin',
  ].join('\n'));
  return upstream;
}

test("a concurrent fetch of a teammate's clean history does not disturb the verdict", () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  withFetchingUpstream(repo, 'chore: their ordinary work');

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.notEqual(repo.git('for-each-ref', '--format=%(refname)', 'refs/remotes').stdout.trim(),
    '', 'control: the fetch really did land a remote-tracking ref');
  assert.equal(r.status, 0, `an unrelated fetch must not fail the commit: ${r.stderr}`);
});

test("a fetched TAG carrying a trailer is unattributable, not the developer's leak", () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  // Filtering refs/remotes/ by name did not cover this: a fetch auto-follows tags, so the new
  // refs/tags/ tip walks the same history back into the snapshot. Namespace was the wrong
  // axis; ownership is decided by the reflog marker, and this commit was made in another
  // repository entirely, so no entry in THIS repository's reflog carries it.
  withFetchingUpstream(repo, `chore: their work\n\n${AI_LINE}`, { tag: 'v9.9.9' });

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(repo.git('rev-parse', '--verify', '--quiet', 'refs/tags/v9.9.9').status, 0,
    'control: the tag really was auto-followed into this repository');
  assert.match(repo.git('log', '-1', '--format=%B', 'refs/tags/v9.9.9').stdout, /Co-Authored-By/,
    'control: and what it points at really does carry the trailer');
  assert.equal(r.status, 7, 'someone else\'s tagged history is UNVERIFIED, never a leak verdict');
  assert.doesNotMatch(r.stderr, /AI attribution leaked in commit/,
    'the developer must NOT be told their own commit leaked');
  assert.equal(repo.git('log', '-1', '--format=%s').stdout.trim(), 'feat: Add a.txt',
    'control: their own commit is intact and is what HEAD points at');
});

test('parking the leaking commit under refs/remotes/ is not hidden either', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  // The oracle that was missing: with the namespace filter gone this must stay fail-closed,
  // and without this test reinstating `case $ref in refs/remotes/*) continue` left the whole
  // suite green — the clean-fetch case still passed and the tag case still came in via
  // refs/tags/, so nothing anywhere failed while the hole was reopened.
  hook(repo, 'post-commit', [
    '[ -e "$(git rev-parse --git-dir)/done" ] && exit 0',
    ': > "$(git rev-parse --git-dir)/done"',
    'A=$(git rev-parse HEAD)',
    'git update-ref refs/remotes/origin/parked "$A"',
    'B=$(git commit-tree "$A^{tree}" -p "$A^" -m "feat: clean")',
    'git update-ref refs/heads/main "$B"',
  ].join('\n'));

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.match(repo.git('log', '-1', '--format=%B', 'refs/remotes/origin/parked').stdout,
    /Co-Authored-By/, 'control: the parked commit really does carry the trailer');
  assert.match(repo.git('log', '-1', '--format=%B').stdout, /feat: clean/,
    'control: and the branch really was diverted away from it');
  // 4 for the same reason as the refs/keep/ variant: the parked commit is the one `git commit`
  // made, and the reflog marker proves it. The namespace was never the point — this test
  // exists because an earlier version FILTERED refs/remotes/ out of the snapshot, and a
  // filtered-out ref is invisible whatever the verdict would have been.
  assert.equal(r.status, 4, 'a commit parked under refs/remotes/ must still fail closed');
});

test('the graft check works when the executor is launched from a SUBDIRECTORY', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  mkdirSync(join(repo.dir, 'nested'), { recursive: true });
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  // `rev-parse --git-path` returns a REPOSITORY-relative path; `[ -s ... ]` resolves it
  // against the SHELL's directory. From repo/nested the check looked at
  // repo/nested/.git/info/grafts — absent, so it passed — while the traversal used the real
  // one. Every other graft test runs with cwd === repo root and cannot see this.
  hook(repo, 'post-commit', [
    '[ -e "$(git rev-parse --git-dir)/done" ] && exit 0',
    ': > "$(git rev-parse --git-dir)/done"',
    'A=$(git rev-parse HEAD)',
    'B=$(git commit-tree "$A^{tree}" -p "$A" -m "feat: clean")',
    'git update-ref refs/heads/main "$B"',
    'mkdir -p "$(git rev-parse --git-dir)/info"',
    'printf "%s %s\\n" "$B" "$(git rev-parse "$A^")" > "$(git rev-parse --git-dir)/info/grafts"',
  ].join('\n'));

  const msgFile = stage(repo, 'feat: Add a.txt\n');
  const r = run(join(repo.dir, 'nested'), ['commit', msgFile]);
  assert.equal(r.status, 7, 'the graft must be found from a nested working directory too');
  assert.match(r.stderr, /grafts/);
});

test('a shallow boundary written by the post-commit hook is refused, not traversed past', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  // Every OID in .git/shallow becomes a traversal ROOT. Writing clean B there stops rev-list
  // before it reaches leaking A. Measured standalone: `rev-list --count HEAD` 3 → 1. An
  // earlier experiment wrote the commit's PARENT instead, saw no change, and wrongly
  // concluded shallow was inert — the wrong OID, not a wrong mechanism.
  hook(repo, 'post-commit', [
    '[ -e "$(git rev-parse --git-dir)/done" ] && exit 0',
    ': > "$(git rev-parse --git-dir)/done"',
    'A=$(git rev-parse HEAD)',
    'B=$(git commit-tree "$A^{tree}" -p "$A" -m "feat: clean")',
    'git update-ref refs/heads/main "$B"',
    'printf "%s\\n" "$B" > "$(git rev-parse --git-dir)/shallow"',
  ].join('\n'));

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(r.status, 7, 'a shallow boundary makes the traversal unverifiable');
  assert.match(r.stderr, /shallow/);
});

test('a branch moved between the HEAD read and the snapshot cannot drop the commit', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  // A post-commit hook CANNOT stage this: hooks run during `git commit`, which is before the
  // HEAD read, so by then HEAD is already whatever the hook left. The window is between the
  // script's own `rev-parse HEAD` and its ref snapshot, and only a concurrent process reaches
  // it. This shim is that process, made deterministic: it moves the branch to an unrelated
  // clean commit on the SECOND `for-each-ref` — the post-commit snapshot — and then delegates.
  const shim = tempDir('sc-race-');
  writeFileSync(join(shim, 'git'), [
    '#!/bin/bash',
    `counter=${JSON.stringify(join(shim, 'count'))}`,
    `G=${JSON.stringify(REAL_GIT)}`,
    `R=${JSON.stringify(repo.dir)}`,
    'for a in "$@"; do',
    '  if [ "$a" = for-each-ref ]; then',
    '    n=$(cat "$counter" 2>/dev/null || echo 0)',
    '    printf %s $((n + 1)) > "$counter"',
    '    if [ "$n" -eq 1 ]; then',
    '      A=$("$G" -C "$R" rev-parse HEAD)',
    '      B=$("$G" -C "$R" commit-tree "$A^{tree}" -p "$A^" -m "feat: raced in")',
    '      "$G" -C "$R" update-ref refs/heads/main "$B"',
    '    fi',
    '  fi',
    'done',
    'exec "$G" "$@"',
  ].join('\n'), { mode: 0o755 });

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')],
    { env: { PATH: `${shim}:${process.env.PATH}` } });
  assert.match(repo.git('log', '-1', '--format=%B').stdout, /feat: raced in/,
    'control: the racing process really did move the branch off the leaking commit');
  assert.doesNotMatch(repo.git('log', '-1', '--format=%B').stdout, /Co-Authored-By/,
    'control: so the ref snapshot alone no longer mentions the commit just made');
  assert.equal(r.status, 4, 'an OID this process already observed must still be read back');
});

test('alloc rejects operands instead of silently making a file', () => {
  const repo = mkRepo();
  const bad = run(repo.dir, ['alloc', '--unexpected']);
  assert.equal(bad.status, 2, 'an unknown operand is a usage error');
  assert.equal(bad.stdout.trim(), '', 'and no path may be printed, so no file is left behind');
  // Negative control: the documented form must still work, or this would pass for an `alloc`
  // that refused everything.
  const ok = run(repo.dir, ['alloc']);
  assert.equal(ok.status, 0, `bare alloc must still succeed: ${ok.stderr}`);
  assert.equal(existsSync(ok.stdout.trim()), true, 'and must still produce the file');
});

test('a replacement object cannot mask what was actually committed', () => {
  const repo = mkRepo();
  hook(repo, 'commit-msg', `printf '\\n%s\\n' ${JSON.stringify(AI_LINE)} >> "$1"`);
  // git reads objects replace-aware by default, so `git log <recorded-oid>` returns the
  // substitute while the real, attribution-bearing commit is what gets pushed — the
  // replacement ref is local and does not travel. `--no-replace-objects` is the fix.
  hook(repo, 'post-commit', [
    'D=$(git rev-parse HEAD)',
    'C=$(git commit-tree "$(git rev-parse HEAD^{tree})" -m "feat: clean")',
    'git replace "$D" "$C"',
  ].join('\n'));

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.match(repo.git('log', '-1', '--format=%B').stdout, /feat: clean/,
    'control: the replacement really is masking the message on an ordinary read');
  assert.equal(r.status, 4, 'verification must read past the replacement');
});

/**
 * The other direction of the same flag, and the reason it is a separate test: `--no-replace-objects`
 * is a NEUTRALIZER, not a refusal. Grafts and shallow stop the run at status 7 because the script
 * cannot verify through them; a replace ref is simply ignored, so an ordinary repository that
 * happens to hold one commits and verifies exactly like any other.
 *
 * Round 85, Codex P2: the status table had listed replace alongside graft and shallow as a
 * status-7 cause. Only the masking direction was tested, so the claim about a harmless replace
 * ref had nothing holding it — and it was wrong.
 */
test('an ordinary replace ref is neutralized, not refused', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'chore: base\n', ['base.txt'])]);
  // A replace ref that masks nothing relevant: an unrelated older commit rewritten to a clean
  // substitute. It is present and live, but no leak hides behind it.
  const base = repo.git('rev-parse', 'HEAD').stdout.trim();
  const sub = repo.git('commit-tree', `${base}^{tree}`, '-m', 'chore: substitute').stdout.trim();
  repo.git('replace', base, sub);
  assert.equal(repo.git('log', '-1', '--format=%s').stdout.trim(), 'chore: substitute',
    'control: the replace ref really is live on an ordinary read');

  const r = run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(r.status, 0, `a harmless replace ref must not block a clean commit: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /UNVERIFIED/,
    'and it must not be reported as an unverifiable ancestry overlay the way a graft is');
});

test('a successfully removed path is disowned — the sweep cannot delete its replacement', () => {
  const repo = mkRepo();
  // `rm -f` is idempotent about a MISSING path but not about pathname REUSE: between the
  // explicit removal and the EXIT sweep, another process can create a new file at that
  // name, and a second unlink deletes theirs. This wrapper guard models exactly that,
  // recreating the message path at the moment the verification pass runs.
  const real = join(repo.dir, 'scripts/real-guard.sh');
  writeFileSync(real, readFileSync(realGuard), { mode: 0o755 });
  writeFileSync(join(repo.dir, 'scripts/commit-msg-guard.sh'),
    '#!/bin/bash\n'
    + '[ -n "$RECREATE_PATH" ] && [ ! -e "$RECREATE_PATH" ] '
    + '&& printf \'someone-elses-file\\n\' > "$RECREATE_PATH"\n'
    + `exec /bin/bash -p ${JSON.stringify(real)} "$@"\n`,
    { mode: 0o755 });

  const msgFile = stage(repo, 'feat: Add a.txt\n');
  const r = run(repo.dir, ['commit', msgFile], { env: { RECREATE_PATH: msgFile } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(msgFile), true,
    'the file that now occupies that path belongs to someone else');
  assert.equal(readFileSync(msgFile, 'utf8'), 'someone-elses-file\n');
});

test('a signal mid-commit still takes the commit message off disk', async () => {
  const repo = mkRepo();
  hook(repo, 'commit-msg', 'printf r > "$(git rev-parse --git-dir)/ready"\nsleep 3');
  const msgFile = stage(repo, 'feat: Add a.txt\n');
  const child = spawn('/bin/bash', ['-p', execScript, 'commit', msgFile],
    { cwd: repo.dir, env: { ...process.env, TMPDIR: repo.dir } });
  const done = new Promise((res) => child.on('close', (code) => res(code)));

  const ready = join(repo.dir, '.git/ready');
  const deadline = Date.now() + 15000;
  while (!existsSync(ready)) {
    if (Date.now() > deadline) { child.kill('SIGKILL'); assert.fail('the hook never ran'); }
    await new Promise((r) => setTimeout(r, 20));
  }
  child.kill('SIGTERM');

  assert.equal(await done, 143, 'the TERM trap exists only to reach the EXIT sweep');
  assert.equal(existsSync(msgFile), false,
    'a signal must not leave the full commit message lying on disk');
});

/* ------------------------------------------------------- execute.sh: verify-last */

test('verify-last on a clean commit → status 0', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  assert.equal(run(repo.dir, ['verify-last']).status, 0);
});

test('verify-last sees the whitelisted trailer without the opt-in → status 4', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, `feat: Add a.txt\n\n${AI_LINE}\n`), '--ai-co-author']);
  assert.equal(run(repo.dir, ['verify-last', '--ai-co-author']).status, 0);
  const r = run(repo.dir, ['verify-last']);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /leaked in commit/);
});

test('verify-last given a second commit-ish → status 2, not silently the last one', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, `feat: Add a.txt\n\n${AI_LINE}\n`), '--ai-co-author']);
  const leaking = repo.git('rev-parse', 'HEAD').stdout.trim();
  run(repo.dir, ['commit', stage(repo, 'feat: Add b.txt\n', ['b.txt'])]);
  const clean = repo.git('rev-parse', 'HEAD').stdout.trim();

  // Each operand used to overwrite the previous one, so this returned 0 — a verifier
  // silently checking something other than what it was handed.
  const r = run(repo.dir, ['verify-last', leaking, clean]);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /at most one commit-ish/);
  // Control: each operand on its own still gives the verdict it should.
  assert.equal(run(repo.dir, ['verify-last', leaking]).status, 4);
  assert.equal(run(repo.dir, ['verify-last', clean]).status, 0);
});

test('verify-last with the guard absent → status 3, reported UNVERIFIED', () => {
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  rmSync(join(repo.dir, 'scripts/commit-msg-guard.sh'));
  const r = run(repo.dir, ['verify-last']);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /UNVERIFIED/);
});

test('verify-last reading back an empty message → UNVERIFIED, not "clean"', () => {
  // An empty file is what the guard reads as a leak-free message, so the check would
  // otherwise report a commit it never actually read. Forced with a `git` that answers
  // `log` with nothing and passes everything else through.
  const repo = mkRepo();
  run(repo.dir, ['commit', stage(repo, 'feat: Add a.txt\n')]);
  const stubDir = tempDir('smart-commit-emptylog-');
  const realGit = spawnSync('command', ['-v', 'git'], { shell: '/bin/bash', encoding: 'utf8' })
    .stdout.trim();
  // `log` is not $1 — execute.sh passes `-C <root>` first — so the shim scans the argv.
  writeFileSync(join(stubDir, 'git'),
    '#!/bin/bash\nfor a in "$@"; do case "$a" in log) exit 0 ;; esac; done\n'
    + `exec ${realGit} "$@"\n`, { mode: 0o755 });
  const r = run(repo.dir, ['verify-last'], { env: { PATH: `${stubDir}:${process.env.PATH}` } });
  assert.equal(r.status, 7, r.stderr);
  assert.match(r.stderr, /read back empty/);
});

/* ------------------------------------------------------------------- entry point */

test('reached through a symlink → refused with the supported invocation', () => {
  const dir = tempDir('smart-commit-symlink-');
  const link = join(dir, 'execute.sh');
  symlinkSync(execScript, link);
  const r = spawnSync('/bin/bash', ['-p', link, 'alloc'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /invoke the real path/);
  assert.match(r.stderr, /skills\/smart-commit\/scripts\//,
    'the refusal must name where the real script lives, not just that this one is wrong');
});

test('dispatch.sh missing beside execute.sh → fails closed before doing anything', () => {
  const dir = tempDir('smart-commit-nodispatch-');
  writeFileSync(join(dir, 'execute.sh'), readFileSync(execScript), { mode: 0o755 });
  const r = spawnSync('/bin/bash', ['-p', join(dir, 'execute.sh'), 'alloc'],
    { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /dispatch\.sh missing/);
});

test('the exact documented invocation reaches the script', () => {
  const repo = mkRepo();
  const r = spawnSync('/bin/bash', ['-p', '--', execScript, 'alloc'],
    { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, TMPDIR: repo.dir } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout.trim(), /\/smart-commit-msg\.\w{6}$/);
});

/**
 * Run `<spelling> -p -- "$EXECUTE" alloc` from inside a script, with `bash` shadowed the
 * way a caller's environment can shadow it. `-p` cannot defend against this: it only takes
 * effect once the intended bash is already running.
 */
function underShadowedBash(spelling, vector) {
  const dir = tempDir('smart-commit-shadow-');
  const driver = join(dir, 'driver.sh');
  writeFileSync(driver, `#!/bin/bash\n${spelling} -p -- "$EXECUTE" alloc\n`, { mode: 0o755 });
  const env = { ...process.env, EXECUTE: execScript, TMPDIR: dir };

  if (vector === 'path-shim') {
    const shim = join(dir, 'shim');
    mkdirSync(shim);
    writeFileSync(join(shim, 'bash'), '#!/bin/sh\nprintf SHADOW-RAN >&2\nexit 0\n', { mode: 0o755 });
    env.PATH = `${shim}:${process.env.PATH}`;
    return spawnSync('/bin/bash', [driver], { encoding: 'utf8', env });
  }
  return spawnSync('/bin/bash', ['-c',
    'bash() { printf SHADOW-RAN >&2; return 0; }; export -f bash; '
    + `exec /bin/bash ${JSON.stringify(driver)}`], { encoding: 'utf8', env });
}

test('the shipped invocation pins the interpreter absolutely, and survives a shadowed bash', () => {
  // The spelling is READ FROM the doc, not restated here: a test asserting its own idea of
  // the invocation passes happily while the shipped one is something else.
  const skill = readFileSync(resolve(root, 'skills/smart-commit/SKILL.md'), 'utf8');
  const spelling = (skill.match(/^\s*(\S*bash) -p -- "\$EXECUTE" alloc\s*$/m) || [])[1];
  assert.equal(spelling, '/bin/bash', 'the documented entrypoint must not be a bare `bash`');

  for (const vector of ['path-shim', 'exported-function']) {
    // Control FIRST: the bare spelling must genuinely be hijacked, or the assertion that
    // the shipped one is not proves nothing about this environment.
    const bare = underShadowedBash('bash', vector);
    assert.match(bare.stderr, /SHADOW-RAN/, `${vector}: the control must really shadow bash`);
    assert.doesNotMatch(bare.stdout, /smart-commit-msg/,
      `${vector}: and the policy script must never have started`);
    assert.equal(bare.status, 0, `${vector}: the bypass yields a false success — the reason it matters`);

    const shipped = underShadowedBash(spelling, vector);
    assert.doesNotMatch(shipped.stderr, /SHADOW-RAN/, `${vector}: the pinned path must win`);
    assert.match(shipped.stdout.trim(), /\/smart-commit-msg\.\w{6}$/,
      `${vector}: and observable work must actually have happened, not just status 0`);
  }
});

test('the documented fences work as written, each in its own fresh shell', () => {
  // Codex round 79: the previous version DESCRIBED the tool-call boundary in a comment
  // while still rendering one fence with one locator, so following the artifact literally
  // ran the commit with $EXECUTE unset. This executes what the doc actually contains —
  // separate shells, nothing carried over, the Write step in between.
  const skill = readFileSync(resolve(root, 'skills/smart-commit/SKILL.md'), 'utf8');
  const fences = [...skill.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((m) => m[1].replace(/^ {3}/gm, ''))
    .filter((f) => /"\$EXECUTE"/.test(f));

  const allocFence = fences.find((f) => /"\$EXECUTE" alloc/.test(f));
  const commitFence = fences.find((f) => /"\$EXECUTE" commit/.test(f));
  assert.ok(allocFence && commitFence, 'both fences must be present in the doc');
  for (const [label, f] of [['alloc', allocFence], ['commit', commitFence]]) {
    assert.match(f, /^EXECUTE=/m, `the ${label} fence must carry its own locator`);
  }

  const repo = mkRepo();
  // The repo under test is a throwaway, so point the locator's repo-relative lookup at the
  // real script the way an installed copy would sit.
  mkdirSync(join(repo.dir, 'skills/smart-commit/scripts'), { recursive: true });
  writeFileSync(join(repo.dir, 'skills/smart-commit/scripts/smart-commit-execute.sh'),
    readFileSync(execScript), { mode: 0o755 });
  writeFileSync(join(repo.dir, 'skills/smart-commit/scripts/smart-commit-dispatch.sh'),
    readFileSync(dispatchScript), { mode: 0o755 });

  const shell = (script) => spawnSync('/bin/bash', ['-c', script],
    { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, TMPDIR: repo.dir } });

  const alloc = shell(allocFence);
  assert.equal(alloc.status, 0, `the alloc fence must run as written: ${alloc.stderr}`);
  const msgFile = alloc.stdout.trim();
  assert.match(msgFile, /\/smart-commit-msg\.\w{6}$/);

  writeFileSync(msgFile, 'feat: Add a.txt\n');
  writeFileSync(join(repo.dir, 'a.txt'), 'x\n');
  repo.git('add', 'a.txt');

  // Substitute only the documented placeholders; everything else runs verbatim.
  const commit = shell(commitFence
    .replace('<msg-file>', JSON.stringify(msgFile))
    .replace(/\s*\[--ai-co-author\] \[--sign\|--no-sign\]/, ''));
  assert.equal(commit.status, 0, `the commit fence must run as written: ${commit.stderr}`);
  assert.match(repo.git('log', '--oneline', '-1').stdout, /feat: Add a\.txt/);
});

test('$BASH_ENV cannot preempt the script under the documented invocation', () => {
  const repo = mkRepo();
  const hijack = join(repo.dir, 'hijack.sh');
  writeFileSync(hijack, "printf 'HIJACK\\n' >&2\nexit 0\n");
  const env = { ...process.env, TMPDIR: repo.dir, BASH_ENV: hijack };

  // Negative control FIRST, because the assertion below is only meaningful if the hole it
  // closes is real. Handing a script to bash as an argument bypasses its `#!/bin/bash -p`
  // shebang, and BASH_ENV is sourced before the script's first line — so `exit 0` returns
  // SUCCESS having allocated nothing, which the caller reads as a completed step.
  const without = spawnSync('/bin/bash', ['--', execScript, 'alloc'],
    { cwd: repo.dir, encoding: 'utf8', env });
  assert.equal(without.status, 0, 'the bypass yields a false success — that is what makes it bad');
  assert.match(without.stderr, /HIJACK/, 'the control must show BASH_ENV really does run');
  assert.doesNotMatch(without.stdout, /smart-commit-msg/,
    'and that the script itself never ran');

  const withP = spawnSync('/bin/bash', ['-p', '--', execScript, 'alloc'],
    { cwd: repo.dir, encoding: 'utf8', env });
  assert.equal(withP.status, 0, withP.stderr);
  assert.doesNotMatch(withP.stderr, /HIJACK/, '-p must make bash ignore BASH_ENV outright');
  assert.match(withP.stdout.trim(), /\/smart-commit-msg\.\w{6}$/,
    'and the real work must happen instead');
});

/* ------------------------------------------------------ the execution-trace oracle */

/**
 * Build a PATH containing ONLY the named commands, each a shim that records its own
 * name and then execs the real binary with the real PATH restored (we are tracing what
 * execute.sh reaches for, not what git does internally).
 */
function traceHarness(names) {
  const dir = tempDir('smart-commit-trace-');
  const log = join(dir, 'trace.log');
  writeFileSync(log, '');
  for (const n of names) {
    const real = spawnSync('command', ['-v', n], { shell: '/bin/bash', encoding: 'utf8' }).stdout.trim();
    assert.ok(real, `the harness needs a real ${n} to shim`);
    writeFileSync(join(dir, n),
      `#!/bin/bash\nprintf '%s\\n' ${n} >> ${JSON.stringify(log)}\n`
      + `PATH=${JSON.stringify(process.env.PATH)}; export PATH\nexec ${real} "$@"\n`,
      { mode: 0o755 });
  }
  return { dir, log };
}

/** Drive alloc → commit → verify-last with PATH restricted to `names`. */
function fullFlowUnder(names) {
  const repo = mkRepo();
  const h = traceHarness(names);
  const env = { PATH: h.dir, TMPDIR: repo.dir };
  const alloc = run(repo.dir, ['alloc'], { env });
  if (alloc.status !== 0) return { ok: false, stage: 'alloc', log: h.log, r: alloc };
  const msgFile = alloc.stdout.trim();
  writeFileSync(msgFile, 'feat: Add a.txt\n');
  writeFileSync(join(repo.dir, 'a.txt'), 'x\n');
  repo.git('add', 'a.txt');
  const commit = run(repo.dir, ['commit', msgFile], { env });
  if (commit.status !== 0) return { ok: false, stage: 'commit', log: h.log, r: commit };
  const verify = run(repo.dir, ['verify-last'], { env });
  if (verify.status !== 0) return { ok: false, stage: 'verify-last', log: h.log, r: verify };
  return { ok: true, log: h.log };
}

/** The commands the flow is expected to reach for through PATH, exactly. */
const EXPECTED_TRACE = ['git', 'mktemp', 'rm'];

test('the whole flow reaches for exactly the commands it is supposed to', () => {
  const res = fullFlowUnder(allowlist());
  assert.equal(res.ok, true,
    `no command outside the allowlist may be needed (failed at ${res.stage}: ${res.r?.stderr})`);
  const observed = [...new Set(readFileSync(res.log, 'utf8').trim().split('\n').filter(Boolean))];
  // Equality, not "nothing outside the allowlist" — only allowlisted shims exist to write
  // to this log, so a subset check is structurally incapable of failing. `bash` is absent
  // by design: it is invoked by pinned absolute path, which never consults PATH. That blind
  // spot is what the static call-site oracle below covers.
  assert.deepEqual(observed.sort(), EXPECTED_TRACE,
    'a new external dependency, or a lost one, must show up here');
});

test('the trace harness notices a missing command — it is not vacuous', () => {
  // Without this, the test above passes for a script that invokes nothing at all, or for
  // a harness whose PATH was never in force. Dropping `git` must break the flow.
  const res = fullFlowUnder(allowlist().filter((n) => n !== 'git'));
  assert.equal(res.ok, false, 'removing git from PATH must fail the flow');
});

test('a temp file that cannot be removed is reported and retried, and the commit still stands', () => {
  // Behavioural cover for the failed-cleanup path. Deleting the `warn` and the `rc=1` from
  // `sweep_owned` left the argv pin, the permitted-token set and every other runtime case
  // unchanged (Codex, round 94) — the reporting was asserted only as source text, so the
  // behaviour it describes had no witness.
  const repo = mkRepo();
  const h = traceHarness(['git', 'mktemp']);
  const rmCalls = join(h.dir, 'rm-calls.log');
  writeFileSync(rmCalls, '');
  // An `rm` that records its operands and refuses. Nothing else in the flow needs the real one:
  // git unlinks through syscalls, and `mktemp` only creates.
  writeFileSync(join(h.dir, 'rm'),
    `#!/bin/bash\nprintf '%s\\n' "$@" >> ${JSON.stringify(rmCalls)}\nexit 1\n`, { mode: 0o755 });

  const env = { PATH: h.dir, TMPDIR: repo.dir };
  const alloc = run(repo.dir, ['alloc'], { env });
  assert.equal(alloc.status, 0, `alloc must succeed: ${alloc.stderr}`);
  const msgFile = alloc.stdout.trim();
  writeFileSync(msgFile, 'feat: Add a.txt\n');
  writeFileSync(join(repo.dir, 'a.txt'), 'x\n');
  repo.git('add', 'a.txt');
  const commit = run(repo.dir, ['commit', msgFile], { env });

  // The commit happened; reporting failure because a temp file survived would be the larger lie.
  assert.equal(commit.status, 0, `the commit itself must still succeed: ${commit.stderr}`);
  assert.equal(repo.git('log', '-1', '--format=%s').stdout.trim(), 'feat: Add a.txt',
    'and the commit must really be recorded, not merely reported');
  // The leftover is real and actionable: it exists, and its exact path is on stderr.
  assert.equal(existsSync(msgFile), true, 'the message file must survive a refused removal');
  assert.ok(commit.stderr.includes(msgFile),
    `stderr must name the exact leftover path; saw: ${commit.stderr}`);

  // Retried, not merely reported once. `scrub` keeps the path in OWNED precisely when removal
  // failed, so the EXIT trap makes a second attempt — that is the difference between retaining
  // the path and discarding it, and one warning would be equally consistent with either.
  // Counted PER PATH, and that is the whole point of the shape. Counting attempts on the message
  // file and distinct paths separately passed for a `sweep_owned` that returns on its first
  // failure: post-commit detection allocates a second temp file, so both paths have already been
  // through `scrub` and warned about once before the trap runs. One EXIT attempt on the message
  // file and none on the logfile still yields "two attempts" and "two distinct paths" (Codex,
  // round 95). Two paths at exactly two attempts each is the loop-continuation property itself.
  const operands = readFileSync(rmCalls, 'utf8').split('\n')
    .filter((l) => l && l !== '-f' && l !== '--');
  const attempts = new Map();
  for (const p of operands) attempts.set(p, (attempts.get(p) ?? 0) + 1);
  assert.equal(attempts.size, 2,
    `both temp files must be owned at EXIT; saw ${JSON.stringify([...attempts.keys()])}`);
  assert.equal(attempts.has(msgFile), true, 'and the message file must be one of them');
  for (const [path, n] of attempts) {
    assert.equal(n, 2, `${path} must be attempted twice — scrub, then the EXIT sweep; saw ${n}`);
  }

  // Every attempt reports, and the path is read out of the message by its delimiters rather than
  // cut at the first space — a path containing one would otherwise be silently truncated and the
  // two counts would merge.
  const warned = commit.stderr.split('\n')
    .map((l) => (l.match(/could not remove (.*) - it still holds/) || [])[1])
    .filter(Boolean);
  const reported = new Map();
  for (const p of warned) reported.set(p, (reported.get(p) ?? 0) + 1);
  assert.deepEqual([...reported.entries()].sort(), [...attempts.entries()].sort(),
    'every leftover must be named on every attempt, not just the first');

  // Not claimed: `sweep_owned`'s `rc=1`. Nothing calls it but the EXIT trap, whose return value
  // Bash discards, so no external observer exists. It is a local contract — one file failing
  // must not be erased by a later one succeeding — and this test does not pretend to cover it.
});

/* --------------------------------- the static oracle: what the trace cannot see */

/**
 * Script text with comment lines removed — a comment naming a path is not a call site.
 *
 * Backslash-continued lines are JOINED first, because the recognizer judges by position and a
 * continuation splits one command across two lines: the second line then begins with what is
 * really an operand, and every operand at the start of a continued line reads as a command.
 * That produced six false positives on the real scripts the first time the dispatch oracle ran
 * — and a recognizer that invents call sites is one whose output gets suppressed.
 */
/**
 * Line indices whose leading `#` really starts a comment — that is, is not inside a quoted
 * string. Deciding that needs the quote state, and getting it from a per-line regex is the bug
 * this exists to remove.
 *
 * Three quoting modes, and the third is the one that bites. In `'...'` a backslash is literal;
 * in `"..."` and in ANSI-C `$'...'` it escapes the next byte. Treating `$'...'` as a plain single
 * quote makes `\'` look like the CLOSING quote, so the scanner believes the string ended one line
 * early and deletes the next line as a comment — while Bash, reading `\'` as an escaped quote,
 * keeps the string open and executes whatever follows the real terminator:
 *
 *     doc=$'start\'
 *     # payload'; /bin/bash -c "$UNTRUSTED"
 *
 * That is a false NEGATIVE — executable code removed before any oracle sees it — which is the one
 * direction a bypass check may not fail in. Found by Codex, round 97.
 */
const commentOnlyLines = (text) => {
  const drop = new Set();
  let quote = null, atStart = true, li = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') { li++; atStart = true; continue; }
    if (quote) {
      // `"` and `$'` honour backslash escapes; plain `'` does not.
      if (c === '\\' && quote !== "'") i++;
      else if (c === quote[quote.length - 1]) quote = null;
      atStart = false;
      continue;
    }
    if (atStart && /\s/.test(c)) continue;
    if (atStart && c === '#') {
      drop.add(li);
      while (i < text.length && text[i] !== '\n') i++;
      li++; atStart = true;
      continue;
    }
    atStart = false;
    if (c === '\\') { i++; continue; }
    if (c === '$' && text[i + 1] === "'") { quote = "$'"; i++; continue; }
    if (c === '"' || c === "'") quote = c;
  }
  return drop;
};

const codeLines = (src) => {
  const joined = src.replace(/\\\n\s*/g, ' ');
  const drop = commentOnlyLines(joined);
  return joined.split('\n').filter((_, i) => !drop.has(i));
};

/**
 * Split a line at shell separators, QUOTE-AWARE. Replaces a blanket "blank every quoted span"
 * pass, which had to do two incompatible jobs with one hammer: stop `;` inside a warn message
 * from splitting the line, AND stop the words in that message being read as commands. Blanking
 * did both — and also blanked `"/tmp/curl"` in command position, so a quoted absolute path
 * executed exactly as written while being invisible to every oracle built on it (Codex, round
 * 83). Scanning instead separates the two jobs: a delimiter inside quotes is literal text, and
 * a quoted word survives to be judged on its position.
 */
/**
 * Index of the `}` closing the `${` that starts at `i`, tracking QUOTES as well as nesting.
 * Counting braces alone is not enough and the failure is silent rather than partial: Bash 3.2
 * accepts `X=${v:-"}"} /usr/bin/true`, where the `}` inside the quotes closes the expansion
 * early for a brace counter — the scanner then treats the trailing `"` as an opening quote and
 * swallows the rest of the line, so `/usr/bin/true` was invisible to EVERY oracle at once.
 * An earlier comment here claimed the failure mode was "under-consume, degrading to the old
 * behaviour"; measured, it is total silence, which is the one outcome a bypass check must not
 * have. Found by Codex, round 85.
 */
function expansionEnd(s, i) {
  let d = 0, quote = null;
  for (; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote !== "'" && i + 1 < s.length) { i++; continue; }
      if (c === quote[quote.length - 1]) quote = null;
      continue;
    }
    // A backslash escapes the next character OUTSIDE quotes too, and the brace it escapes is
    // then part of the value rather than structure. `unset v; X=${v:-\{} /usr/bin/true` runs
    // /usr/bin/true in Bash 3.2; counting that `{` as nesting ran the scan to EOF and swallowed
    // the command — the same total silence as the quoted-brace case, one escape rule away.
    if (c === '\\' && i + 1 < s.length) { i++; continue; }
    if (c === '$' && s[i + 1] === "'") { quote = "$'"; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') d++;
    else if (c === '}' && --d === 0) return i;
  }
  // Unterminated: consume to the end. That is the safe direction — the alternative, treating
  // the `${` as an ordinary word and resuming the scan inside what is really an expansion,
  // hands the separator logic text it cannot interpret. An unterminated expansion is a syntax
  // error `bash -n` rejects, so no shipped script can reach this.
  return s.length - 1;
}

/**
 * A segment, and whether what ENDED it was an opening `$(`. That flag is how a command-position
 * command substitution is found: `$(printf git) --version` really runs git in Bash 3.2 while
 * the word `git` appears in no command position at all, so no token-based oracle can see it.
 * The previous attempt was a source regex listing the delimiters a substitution could follow —
 * it knew `;`, `then`, `do` and `else`, and therefore missed `if`, `while`, `until`, `!`,
 * `time`, `command`, assignment prefixes and leading redirections. Codex found it by writing
 * `if $(printf git) --version; then :; fi`. Carrying the flag instead of re-listing prefixes
 * means the check inherits whatever the peeling loop already understands.
 *
 * `plain` for every other terminator. A segment ending in `=` or `=(` is NOT flagged: there the
 * substitution is an assignment's VALUE (`x=$(git status)`, `arr=($(…))`), not a command word.
 */
const plain = (text) => ({ text, endedBySub: false });

/**
 * Is a command substitution opening HERE the first word of a command? Decided from the parsed
 * state of the text before it, not from a textual suffix. The suffix test this replaces (does
 * `cur` end in `=` or `=(`) was wrong in BOTH directions, which is the worst shape for an
 * oracle — bypassable and noisy at once:
 *
 * | Text before `$(` | Suffix test | Truth |
 * |---|---|---|
 * | `"` — as in `"$(printf git)" --version` | not command position | **runs git** |
 * | `x="` — as in `x="$(git status)"` | command position | an assignment's value |
 * | `arr=(x ` — as in `arr=(x $(git status))` | command position | an array element |
 * | `>` — as in `>$(printf /dev/null) git status` | command position | a redirection target |
 *
 * The rule: every COMPLETED word before it must be a prefix (keyword, assignment, redirection),
 * and the partial word it is joining must not itself be an assignment or a redirection — those
 * two make the substitution a value or a target rather than a name. Anything else the partial
 * could be is part of the command name being built, and a command name that is partly computed
 * is still computed: `'g'"$(printf it)" --version` runs git, and the token oracle reports the
 * literal `g`. An array literal has no command position at all, so being inside one settles it.
 */
function atCommandPosition(cur, inArray) {
  if (inArray) return false;
  const words = shellWords(cur);
  // If the text does not end in whitespace, its last word is still being built and the
  // substitution joins it rather than starting a new one.
  const partial = (cur && !/\s$/.test(cur)) ? (words.pop() ?? '') : '';
  if (partial && (ASSIGN_WORD.test(partial) || REDIRECT_BARE.test(partial)
    || REDIRECT_WORD.test(partial))) return false;
  // Exactly `words.length`, never more: one past the end means the peel consumed a bare
  // redirection operator and is waiting for its target, so the substitution IS that target —
  // `>| $(printf /dev/null) git status` redirects, it does not run the substitution.
  return peelPrefixes(words) === words.length;
}

function splitSegments(line, valueContext = false) {
  const segs = [];
  let cur = '', quote = null;
  // One stack, not two counters: each entry records what was opened and the quote context in
  // force at the time, restored when it closes. The quote part is needed because command
  // substitution is evaluated INSIDE double quotes — `x="$(git status)"` really does run git,
  // and a scanner that treats the whole `"…"` as text reported no call site at all. The kind
  // part is needed because an array literal's `)` and a subshell's `)` are the same character
  // with opposite meanings, and two independent counters cannot say which one closed.
  const stack = [];
  const inArray = () => stack.length > 0 && stack[stack.length - 1].kind === 'array';
  // In `valueContext` the caller is scanning the INSIDE of a `${…}`, whose top level is a value
  // being computed, not a command line. Only what a substitution opens in there is a command,
  // so segments at depth 0 are dropped rather than reported — otherwise `${x:-$(git status)}`
  // would report the expansion's own text `x:-` as if it were a resolved command name.
  const emit = (seg) => { if (!valueContext || stack.length > 0) segs.push(seg); };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (quote === '"' && c === '$' && line[i + 1] === '(') {
        emit({ text: cur, endedBySub: atCommandPosition(cur, inArray()) });
        cur = ''; stack.push({ kind: 'sub', quote }); quote = null; i++; continue;
      }
      // …and the same for the backtick spelling, which is expanded inside double quotes for
      // exactly the same reason. Only `$(` was handled here, so `x="`git rev-parse HEAD`"` ran
      // git while every oracle reported nothing. An escaped `` \` `` never reaches this branch:
      // the backslash case below consumes the character after it.
      if (quote === '"' && c === '`') {
        emit({ text: cur, endedBySub: atCommandPosition(cur, inArray()) });
        cur = ''; stack.push({ kind: 'btick', quote }); quote = null; continue;
      }
      cur += c;
      // `"` and ANSI-C `$'` honour backslash escapes; inside plain '' a backslash is literal.
      if (c === '\\' && quote !== "'" && i + 1 < line.length) { cur += line[++i]; continue; }
      if (c === quote[quote.length - 1]) quote = null;
      continue;
    }
    // ANSI-C quoting opens a string whose `\'` does NOT close it. Reading `$'` as a plain single
    // quote ends the string a line early, and every separator after that lands on the wrong side
    // of the quote state — which is how a `;`-separated dispatch became invisible. Codex, r97.
    if (c === '$' && line[i + 1] === "'") { quote = "$'"; cur += "$'"; i++; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    // A newline OUTSIDE quotes ends the command, exactly like `;`. Inside quotes it is ordinary
    // text — which is why the scanner is fed the whole script rather than one line at a time:
    // `case "\n$mine\n" in` is a single quoted string spanning three lines, and a line-at-a-time
    // scanner sees the middle line as a bare `$mine` in command position. It reported exactly
    // that, on this file's own set-membership idiom.
    if (c === '\n') { emit(plain(cur)); cur = ''; continue; }
    const two = line.slice(i, i + 2);
    if (two === '||' || two === '&&') { emit(plain(cur)); cur = ''; i++; continue; }
    if (two === '$(') {
      emit({ text: cur, endedBySub: atCommandPosition(cur, inArray()) });
      cur = ''; stack.push({ kind: 'sub', quote }); i++; continue;
    }
    // `${…}` is a parameter expansion, NOT a brace group — it belongs to the word. Splitting on
    // its braces (they are in the separator class below) tore `${cmd} status` into `$`, `cmd`
    // and `status`, so an unquoted variable in command position — the exact bypass the dispatch
    // oracle exists to catch — was invisible, while the quoted `"${cmd}"` form was caught. It
    // also made `for f in ${A[@]+"${A[@]}"}` report a bare `A[@]+"${A[@]}"` word. Nesting is
    // tracked so the Bash 3.2 safe-empty-array idiom is consumed whole. A `}` inside quotes
    // inside the expansion would under-consume, which degrades to the old behaviour rather
    // than to silence; neither script contains one.
    if (two === '${') {
      const end = expansionEnd(line, i);
      // Round 87, Codex P2. Consuming the expansion whole hid any command inside it, and a
      // command inside one RUNS: measured, `unset x; y=${x:-$(/usr/bin/true && echo RAN)}`
      // prints RAN. The expansion is still consumed as one word — its text is a value — but
      // its interior is scanned separately for the substitutions that are commands.
      const inner = line.slice(i + 2, end);
      if (/\$\(|`/.test(inner)) for (const s of splitSegments(inner, true)) segs.push(s);
      cur += line.slice(i, end + 1);
      i = end;
      continue;
    }
    // Backticks are the older spelling of `$(…)` and behave the same way: they open a command
    // position and their contents are commands. Treating them as a plain separator was enough
    // while segments were only split, but the `${…}` recursion judges by DEPTH, and a construct
    // that never pushes anything is permanently at depth 0 — so `${x:-`git status`}` lost the
    // git call entirely. Paired on the stack, they carry the same command-position marker.
    if (c === '`') {
      const open = stack.length > 0 && stack[stack.length - 1].kind === 'btick';
      if (open) {
        const top = stack[stack.length - 1];
        emit(plain(cur));
        stack.pop();
        quote = top.quote;
        cur = top.quote ?? '';
      } else {
        emit({ text: cur, endedBySub: atCommandPosition(cur, inArray()) });
        cur = ''; stack.push({ kind: 'btick', quote }); quote = null;
      }
      continue;
    }
    if (/[;&|(){}`]/.test(c)) {
      // `&`/`|` immediately after `<`/`>` belong to a redirection (`2>&1`, `>|f`), not to a
      // separator — the same case the old lookbehind protected.
      if ((c === '&' || c === '|') && /[<>]$/.test(cur)) { cur += c; continue; }
      // `(` directly after `=` or `+=` opens an ARRAY LITERAL, not a subshell: `args=("$head")`
      // and `OWNED+=("$1")` contain no command position at all. Splitting there made the array
      // element look like a command word and reported `$head` as dynamic dispatch. It goes on
      // the stack so that a `$(` inside it knows it is in an array, and so that its own closing
      // `)` is not mistaken for the end of a subshell.
      if (c === '(' && /=$/.test(cur)) { stack.push({ kind: 'array', quote }); cur += c; continue; }
      if (c === '(') { emit(plain(cur)); cur = ''; stack.push({ kind: 'group', quote }); continue; }
      // A `)` with nothing open is a CASE PATTERN terminator, not the end of a subshell — a
      // pattern on its own line (`  "$0")`) otherwise reads as a command word, which is how
      // `$0` was reported as dynamic dispatch and, in round 82, how a `/*)` pattern was
      // reported as an absolute executable. Patterns are matched against, never executed, so
      // the segment is dropped rather than tokenised.
      if (c === ')') {
        // closes whatever the stack says was opened — and restores the quote context that open
        // was sitting in, so the tail of `x="$(git status) more text"` is text again rather
        // than command words. An array literal's `)` keeps the text together instead, leaving
        // `args=(…)` as one assignment word the token peeler skips.
        const top = stack[stack.length - 1];
        if (!top) { cur = ''; continue; }
        if (top.kind === 'array') { stack.pop(); quote = top.quote; cur += c; continue; }
        // Emitted BEFORE the pop, so `emit` still sees a non-zero depth: in `valueContext` that
        // depth is the whole difference between a substitution's contents (a real command) and
        // the expansion text around it (a value).
        emit(plain(cur));
        stack.pop();
        quote = top.quote;
        // The tail resumes INSIDE the quote the substitution sat in, and its closing `"` lives
        // in this new segment. Seeding the segment with the opening quote keeps the pair
        // balanced, so `"$(git rev-parse HEAD) suffix"` leaves an empty word rather than
        // reporting the argument `suffix` as a command name.
        cur = top.quote ?? '';
        continue;
      }
      emit(plain(cur)); cur = '';
      continue;
    }
    cur += c;
  }
  emit(plain(cur));
  return segs;
}

/**
 * Drop the quoting from a command word. Quotes are a shell protection against word-splitting,
 * never a comment, so `"/tmp/curl"` executes /tmp/curl and so does `"/usr/bin"/true` — one word
 * built from a quoted and an unquoted span. Peeling only a WHOLLY quoted word left the mixed
 * form matching neither oracle, and banning the mixed form instead flagged ordinary code. The
 * shell concatenates the spans; so does this.
 */
const unquote = (t) => {
  let out = '', quote = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quote) {
      // Inside double quotes a backslash is special ONLY before $ ` " \ or a newline; before
      // anything else Bash keeps it. Dropping it unconditionally turned `"g\it"` into `git`,
      // so a word that is not a git call site was reported as one — a false positive in the
      // one oracle whose credibility depends on never inventing call sites. Codex, round 85.
      if (c === '\\' && quote === '"' && i + 1 < t.length) {
        if (/[$`"\\\n]/.test(t[i + 1])) { out += t[++i]; } else { out += c; }
        continue;
      }
      // In ANSI-C the backslash always escapes, so the escaped byte is content and the quote it
      // may be hiding must not be read as the terminator.
      if (c === '\\' && quote === "$'" && i + 1 < t.length) { out += t[++i]; continue; }
      if (c === quote[quote.length - 1]) { quote = null; continue; }
      out += c;
      continue;
    }
    if (c === '$' && t[i + 1] === "'") { quote = "$'"; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    out += c;
  }
  return out;
};

/**
 * Blank quoted spans. Correct for the banned-construct scan below — the word `eval` inside a
 * warn message is prose — and WRONG for locating command positions, which is the distinction
 * that made the single old helper unsafe. Kept separate so neither use can quietly acquire the
 * other's behaviour.
 */
const blankQuoted = (l) => l.replace(/'[^']*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""');

/**
 * Blank only SINGLE-quoted spans. Double quotes do not stop expansion, so a construct inside
 * them still executes: `x="`git status`"` runs git. `blankQuoted` erased it, which made the
 * backtick ban silent on exactly the case that ban exists for — Codex, round 89.
 */
const blankSingleQuoted = (l) => l.replace(/'[^']*'/g, "''");

// Words that may precede a command without being one. Keyword prefixes and — the case an
// earlier version missed — VARIABLE ASSIGNMENT prefixes: `LC_ALL=C git log` is a `git`
// call site with `git` nowhere near the start of the segment.
// All three match a WHOLE word rather than a prefix of the raw segment — see commandTokens
// for why the segment-prefix form could not survive a quoted value containing a space.
// `--` earns its place here: `command -- "$cmd" "$@"` is the dispatcher's own call site, and
// without it the command word read as `--` while the variable behind it was invisible. The
// dispatch oracle therefore reported ZERO sites for the one script whose whole job is dynamic
// dispatch — a vacuous pass on the exact file it exists to constrain. Codex, round 85.
const PREFIX_WORD = /^(?:if|then|elif|else|while|until|do|!|time|command|exec|builtin|--)$/;
const ASSIGN_WORD = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;
// Redirections may also LEAD a command: `>/dev/null git log` and `2>&1 /tmp/curl` are both
// ordinary shell, and with the redirection unpeeled the first word is `>/dev/null`, so the
// real command was invisible to every oracle built on this function.
// Two spellings, and the split matters: `>/dev/null` carries its target in the same word,
// while `>| /dev/null` does not — so the bare-operator form has to consume the word after it
// as well. Alternatives are ordered LONGEST-FIRST; with `>` ahead of `>|`, `>| /dev/null git
// status` matched the operator as `>`, left a `|`, and the `git` behind it stayed invisible.
const REDIRECT_OPS = '&>>|&>|[0-9]*(?:<<<|<<-|<<|>\\||>>|>&|<&|<>|>|<)';
const REDIRECT_BARE = new RegExp(`^(?:${REDIRECT_OPS})$`);
const REDIRECT_WORD = new RegExp(`^(?:${REDIRECT_OPS})\\S`);

/**
 * Index of the first word that is a command NAME, after peeling keyword, option, assignment and
 * redirection prefixes. A return value of `words.length + 1` means the peel ran off the end
 * expecting a redirection target — whatever follows is that target, not a command.
 *
 * Shared by `commandTokens` and `atCommandPosition` because the two must agree on what a prefix
 * is; while `atCommandPosition` kept its own inline copy it did not know about redirection
 * targets, and `>| /dev/null $(printf git)` disagreed with itself.
 */
const OPTION_OWNERS = { command: 1, exec: 1, builtin: 1, time: 1 };

function peelPrefixes(words) {
  let i = 0;
  // Which keyword's options are being read. A `-` word is an OPTION only while something owns
  // it: with no owner, `-p "$evil"` is bash trying to run a command literally named `-p`, and
  // skipping it would report `$evil` as a command that never runs. Round 87 — the blanket
  // `/^-/` skip was over-permissive in exactly that way.
  let owner = null;
  for (; i < words.length; i++) {
    const w = words[i];
    // BARE is tested before WORD, and the order is load-bearing: the alternation lets `>|`
    // match WORD as the operator `>` plus a `\S` of `|`, so testing WORD first treated it as
    // carrying its own target and promoted `/dev/null` to the command — the exact
    // longest-first bug the operator list was already ordered to avoid, one level up.
    if (REDIRECT_BARE.test(w)) { i++; continue; } // the target is the NEXT word
    // Round 86, Codex P2. `command`, `time`, `exec` and `builtin` all take options, and the
    // options run the word after them: measured, `command -p "$evil"` and `time -p "$evil"`
    // both execute the variable's contents. With `-p` unpeeled it became the reported command
    // name and the dispatch behind it was invisible. A leading `-` word can only be an option
    // here — the peel has not reached the command name yet, so its own flags are not in reach.
    // `exec -a` is the one option among these keywords that takes an OPERAND, and skipping only
    // the flag promoted that operand to the command name: `exec -a innocuous "$cmd"` reported
    // `innocuous` while running `$cmd`, which is the bypass wearing the oracle's own output.
    // The flag need not be alone — measured, `exec -ca harmless "$evil"` runs `$evil` — so the
    // whole CLUSTER is inspected. `--` is excluded here and handled as a keyword below, which
    // is what ends the option run and is why `command -- "$cmd"` still reaches `$cmd`.
    if (owner && /^-[^-]/.test(w)) {
      // `command -v` / `-V` LOOK UP a name; nothing in the segment is executed at all.
      if (owner === 'command' && /[vV]/.test(w.slice(1))) return words.length + 1;
      // `-a` takes a name, and the name may be ATTACHED to the cluster: measured,
      // `exec -afoo /usr/bin/false` exits 1, so it ran false with argv[0] `foo`. The next word
      // is consumed only when `a` ENDS the cluster — otherwise the trailing characters are the
      // name and the command is already the next word. The construct is also banned outright
      // (SUBSET_BANS); this keeps the recognizer honest about what it claims to parse.
      if (owner === 'exec' && /^-[^-]*a$/.test(w)) i++;
      continue;
    }
    if (PREFIX_WORD.test(w)) { owner = OPTION_OWNERS[w] ? w : null; continue; }
    if (ASSIGN_WORD.test(w) || REDIRECT_WORD.test(w)) continue;
    break;
  }
  return i;
}

/**
 * External commands whose OPERAND is another command. `env` is the one in the executor's
 * bootstrap, and it is why "the bootstrap pair" was a claim with one member: continuation lines
 * are joined before scanning, so `exec /usr/bin/env -u … /bin/bash -p -- …` is a single command
 * whose only command position is `env`. `/bin/bash` was an operand and therefore invisible —
 * swapping it for `/tmp/curl` changed no oracle's output. The value is the flag pattern that
 * takes a separate operand; `-u NAME` is the one the bootstrap uses.
 */
// Matched on the LAST character of an option cluster, which is where a getopt operand attaches:
// measured, `/usr/bin/env -iu PATH /usr/bin/printf …` runs printf, so `-iu` consumes `PATH`,
// while `-ui` would make `i` the operand of `u` and leave the next word as the command.
const WRAPPER_OPERAND_FLAGS = { env: /^-[^-]*[uCP]$/ };

/** Index of the command `env`-like wrapper actually runs, given the index after the wrapper. */
function wrapperOperand(words, start, flags) {
  let i = start;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === '--') { i++; break; }
    if (flags.test(w)) { i++; continue; } // its operand is the NEXT word
    if (/^-/.test(w)) continue;
    // Unquoted before the test, unlike the shell-level peel: `'NAME=1'` is not a shell
    // assignment, but `env` parses its own operands after the shell has removed the quotes —
    // and the executor's bootstrap writes it in exactly that quoted form.
    if (ASSIGN_WORD.test(unquote(w))) continue;
    break;
  }
  return i;
}

/**
 * The first word of every command position on a line. Positions are found by splitting on
 * shell separators — `;` `&` `|` `&&` `||` `(` `)` `{` `}` `$(` — then peeling keyword,
 * assignment and redirection prefixes off each segment. Regexes anchored on a fixed set of
 * leading delimiters (the previous approach) cannot see `LC_ALL=C git …`, `while git …`, or
 * `{ git …; }`; all three are ordinary shell and all three were invisible.
 */
function commandTokens(src) {
  const out = [];
  // The WHOLE script is scanned in one pass, not line by line: a quoted string may span
  // newlines, and only a scanner that carries quote state across them knows that the middle
  // line of `case "\n$mine\n" in` is string content rather than a command. splitSegments ends
  // a command at an unquoted newline, so line structure is still honoured everywhere else.
  // Comment stripping carries the same quote state (see commentOnlyLines), so a `#` opening a
  // line INSIDE a multi-line string is no longer dropped — that per-line limit is gone.
  // What remains unmodelled, stated rather than assumed: nested quote scopes inside `$( … )`
  // and `${ … }`, where an inner quote can reopen after the outer one closed. No construct in
  // either script relies on that, and the delimiter pin above is what makes the gap safe rather
  // than merely unobserved — a new quoting form has to add a `$'` or a `()` to arrive.
  //
  // The lookbehind keeps `2>&1` and `>|f` intact: an `&` or `|` right after `<`/`>` is part
  // of a redirection, not a separator. Splitting there tore `2>&1 git log` into `2>` and
  // `1 git log`, and the second piece starts with `1`, so the `git` behind it vanished.
  // Backticks are separators for the same reason `$(` is: without them the assignment
  // prefix swallowed ``root=`git `` whole and the bare `git` behind it was never reported.
  for (const raw of splitSegments(codeLines(src).join('\n'))) {
    // Words are split QUOTE-AWARE, not by `/\s/` on the raw segment. Regex peeling could not
    // see where a word ended: `X="a b" git log` peeled `X="a` and left `b" git log`, whose
    // first word is `b"` — so the `git` behind it was invisible AND a lone `"` was reported as
    // a command. Both showed up as junk entries the moment the oracles were asked for the
    // whole token list rather than for a yes/no.
    const words = shellWords(raw.text);
    const i = peelPrefixes(words);
    // A segment that is ONLY assignments has no command position at all: `REPO_ROOT=${…}` runs
    // nothing, and reporting its right-hand side as a command word made an ordinary assignment
    // look like dynamic dispatch. Falling off the end of the word list is exactly that case.
    // `endedBySub` means the substitution is part of the command NAME, so the name is computed
    // and whatever fragment precedes it is not the command — reporting `'g'"$(printf it)"` as
    // the command `g` is worse than reporting nothing, because it reads as a resolved name.
    // The literal `$(` is what gets reported so the ban below can name it; no other oracle
    // matches that token, which is deliberate — its value is unknowable, not suspicious.
    if (raw.endedBySub) { out.push('$('); continue; }
    // A wrapper's operand is a command position too, so the walk continues through it rather
    // than stopping at the first name. `env` nests in principle (`env … env … cmd`); the guard
    // bounds it without needing to reason about how deep that could go.
    let idx = i;
    for (let hop = 0; idx < words.length && hop < 8; hop++) {
      const tok = unquote(words[idx]);
      if (!tok) break;
      out.push(tok);
      const flags = WRAPPER_OPERAND_FLAGS[tok.replace(/^.*\//, '')];
      if (!flags) break;
      idx = wrapperOperand(words, idx + 1, flags);
    }
  }
  return out;
}

/**
 * Split one segment into shell words, respecting quotes and `${…}`. Quotes are KEPT: whether a
 * word was quoted is what several oracles judge, and `unquote` decides when to drop them.
 */
function shellWords(seg) {
  const words = [];
  let cur = '', quote = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (quote) {
      cur += c;
      if (c === '\\' && quote !== "'" && i + 1 < seg.length) { cur += seg[++i]; continue; }
      if (c === quote[quote.length - 1]) quote = null;
      continue;
    }
    if (c === '$' && seg[i + 1] === "'") { quote = "$'"; cur += "$'"; i++; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (seg.slice(i, i + 2) === '${') {
      const end = expansionEnd(seg, i);
      cur += seg.slice(i, end + 1);
      i = end;
      continue;
    }
    if (/\s/.test(c)) { if (cur) words.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) words.push(cur);
  return words;
}

/**
 * Absolute paths that get EXECUTED — in command position, or assigned to a variable that is
 * later run (`cmd=/bin/bash`). Keyed on position rather than on a list of blessed
 * directories: an earlier version matched only `bin`/`sbin` layouts, so `/tmp/curl` and
 * `/usr/libexec/helper` walked past it while bypassing PATH just as effectively. The
 * execution trace cannot see any of these, because an absolute path never consults PATH.
 */
function absoluteExecutables(src) {
  const found = commandTokens(src).filter((t) => t.startsWith('/'));
  for (const t of commandTokens(src)) {
    const m = t.match(/^[A-Za-z_][A-Za-z0-9_]*=(\/\S+)$/);
    if (m) found.push(m[1]);
  }
  return [...new Set(found)].sort();
}

/**
 * Allowlisted command names invoked WITHOUT `sd_run` in front. This is the property the
 * reference doc actually claims — "every external command goes through sd_run" — and no
 * other oracle can see it: swapping `sd_run git` for a bare `git` produces an identical
 * execution trace and introduces no absolute path.
 */
function bareCallSites(src) {
  const names = new Set(allowlist());
  return commandTokens(src).filter((t) => names.has(t)).sort();
}

/**
 * Command positions occupied by a VARIABLE rather than a literal name. `cmd=git; "$cmd" status`
 * leaves the execution trace identical to a routed call and introduces no absolute path, so
 * neither other oracle can see it — and what the variable holds is decided at runtime, which is
 * precisely what a static allowlist cannot reason about. The dispatcher's own audited
 * indirection is not in these scripts, so the honest rule here is zero: any variable in command
 * position is reported, and a legitimate one would have to be argued for explicitly.
 */
function dynamicDispatchSites(src) {
  return commandTokens(src).filter((t) => /^\$\{?[A-Za-z_0-9@*]/.test(t)).sort();
}

// The two legitimate absolute paths, both in the bootstrap re-exec, which by construction
// runs before the dispatcher that would otherwise police them.
const BOOTSTRAP_PATHS = ['/bin/bash', '/usr/bin/env'];

test('the only absolute executables in the scripts are the bootstrap pair', () => {
  // Round 87, Codex P2. This asserted only that nothing UNEXPECTED appeared, and the oracle
  // could not see `/bin/bash` at all — it is `env`'s operand, and continuation joining makes
  // the whole re-exec one command whose only command position is `env`. So the test named a
  // pair while constraining one member: swapping `/bin/bash` for `/tmp/curl` changed no
  // oracle's output. Exact per-file sets, so a missing member fails as loudly as an extra one.
  assert.deepEqual(absoluteExecutables(readFileSync(execScript, 'utf8')),
    ['/bin/bash', '/usr/bin/env'],
    'the executor re-execs through exactly the bootstrap pair — both members, no others');
  assert.deepEqual(absoluteExecutables(readFileSync(dispatchScript, 'utf8')), [],
    'and the dispatcher bootstraps nothing, so it may carry no absolute path at all');

  // The artifact mutation the old shape could not fail on: the privileged re-exec now lands on
  // an attacker-chosen binary, with every other line of the script untouched.
  // Anchored on the re-exec's own operands, not on `/bin/bash -p --`: that string also appears
  // in a COMMENT ten lines earlier, so the naive anchor mutated a comment, codeLines stripped
  // it, and the assertion passed against an unmutated artifact. An unapplied mutation looks
  // exactly like a surviving test.
  const src = readFileSync(execScript, 'utf8');
  const anchor = '/bin/bash -p -- "${BASH_SOURCE[0]:-$0}"';
  assert.equal(src.split(anchor).length - 1, 1, 'the re-exec anchor must be unique in the file');
  const swapped = src.replace(anchor, '/tmp/curl -p -- "${BASH_SOURCE[0]:-$0}"');
  assert.notEqual(swapped, src, 'the re-exec swap must actually have applied');
  assert.deepEqual(absoluteExecutables(swapped), ['/tmp/curl', '/usr/bin/env'],
    'replacing the re-exec target must be visible — it is what the bootstrap hands control to');
});

test('every external command in the scripts is routed through sd_run', () => {
  for (const f of [execScript, dispatchScript]) {
    assert.deepEqual(bareCallSites(readFileSync(f, 'utf8')), [],
      `${f}: a bare call is invisible to the trace — the shim logs the same name either way`);
  }
});

/* ------------------------------------------------ pin the delimiters, not the parse */

/**
 * Every bypass found in rounds 94–97 had to introduce a DELIMITER byte to work: a `()` to define
 * a shadowing function, `$'` to open a string the quote scanner mis-reads, a backtick or `~` to
 * open a code surface the extractor does not recognize. Each round then closed that one form by
 * making a recognizer smarter, and the next round found the adjacent form — because proving "no
 * dangerous construct exists" over arbitrary Bash needs a Bash front-end, which this suite does
 * not have and will not grow.
 *
 * So this pin does not parse. It enumerates the raw-byte occurrences of the delimiters that any
 * such construct MUST contain, and freezes them. Completeness comes from the language, not from
 * the regex: a Bash function definition contains `()` or the `function` keyword, and an ANSI-C
 * string contains `$'`. There is no third spelling, so there is nothing for a smarter recognizer
 * to be smarter about.
 *
 * Concretely it closes Codex's round-97 shadowing route — `[() { ... }` defined after the pinned
 * `git_verify` body falsifies the gate's `[ -z "$found" ]` test without touching a single pinned
 * byte of the function itself, and PINNED_GATE cannot see it. It adds a `()` line, and that is
 * what this sees.
 *
 * The cost is deliberate: a comment that happens to contain `()` also trips this. Add it to the
 * pin. A pin that only notices interesting changes is a pin with a search step in it.
 */
const DEFINITION_DELIMITERS =
  /\(\)|function\s+\S+\s*(?:\(\s*\))?\s*\{|alias\s+[A-Za-z_[]\S*=|\$'/;

const delimiterLines = (src) => src.split('\n')
  .filter((l) => DEFINITION_DELIMITERS.test(l))
  .map((l) => l.trim());

const PINNED_DELIMITERS = {
  [execScript]: [
    'warn() { printf \'%s\\n\' "$*" >&2; }',
    'OWNED=()',
    'own() { OWNED+=("$1"); }',
    'sweep_owned() {',
    'OWNED=()',
    'repo_root() {',
    'root=${root%.}; root=${root%$\'\\n\'}',
    'find_guard() {',
    'run_guard() {',
    'run_commit() {',
    'marked_oids() {',
    'git_verify() {',
    'disown_path() {',
    'local keep=() f',
    'scrub() {',
    'cmd_alloc() {',
    'verify_one() {',
    'snapshot_tips() {',
    'resolve_git_path() {',
    'refuse_on_ancestry_overlays() {',
    'verify_created() {',
    'local before_tips=$1 after_tips=$2 head=$3 args=() all mine oid rc status=0',
    'cmd_commit() {',
    'local sign_args=() sign_seen=\'\'',
    'cmd_verify_last() {',
    'usage() {',
  ],
  [dispatchScript]: [
    'sd_allowlist() {',
    'sd_run() {',
    'local list; list=$(sd_allowlist); list=${list//$\'\\n\'/ }',
  ],
};

test('no definition can enter the scripts without changing the pinned delimiter inventory', () => {
  for (const [file, pinned] of Object.entries(PINNED_DELIMITERS)) {
    assert.deepEqual(delimiterLines(readFileSync(file, 'utf8')), pinned,
      `${file}: a function definition or ANSI-C string was added, removed, or reworded — a `
      + 'shadowing definition is exactly this shape, so review it before re-pinning');
  }

  // The four spellings a shadowing definition can take. Each is appended AFTER the pinned
  // git_verify body, so PINNED_GATE stays byte-identical and only this pin can see them.
  const src = readFileSync(execScript, 'utf8');
  const shadows = [
    ['POSIX form', '\n[() { builtin [ "$@"; }\n'],
    ['function keyword', '\nfunction [ { builtin [ "$@"; }\n'],
    ['function keyword with parens', '\nfunction [ () { builtin [ "$@"; }\n'],
    ['alias', "\nalias [='builtin ['\n"],
  ];
  for (const [label, injected] of shadows) {
    const mutant = src + injected;
    assert.notDeepEqual(delimiterLines(mutant), PINNED_DELIMITERS[execScript],
      `${label}: shadowing the \`[\` builtin falsifies the gate's own -z test from outside its `
      + 'pinned bytes — the pin must see the definition even though the function is untouched');
  }

  // ANSI-C is the other delimiter, and the one the quote scanner reads: a NEW `$'...'` is how
  // round 97's false-negative was smuggled in, so adding one must be visible even if some other
  // scanner in this file still models it wrongly.
  assert.notDeepEqual(delimiterLines(src + "\ndoc=$'x'\n"), PINNED_DELIMITERS[execScript],
    'a new ANSI-C string must trip the pin — no scanner is trusted to be right about it');

  // Positive control: the pin is an inventory, not a whole-file checksum. An ordinary edit that
  // introduces none of these delimiters must pass, or the pin is unmaintainable and gets deleted.
  assert.deepEqual(delimiterLines(src + '\nreadonly SOMETHING=1\n'),
    PINNED_DELIMITERS[execScript],
    'an edit carrying no definition delimiter must not trip the pin');
});

test('the static oracles catch the bypasses they exist for — none is vacuous', () => {
  const src = readFileSync(execScript, 'utf8');

  // Codex named both of these as reachable mutants of the previous, narrower checks.
  for (const injected of ['/usr/bin/curl', '/tmp/curl', '/usr/libexec/helper']) {
    const mutated = src.replace('ROOT=$(repo_root)', `${injected} -s x >/dev/null\n  ROOT=$(repo_root)`);
    assert.notEqual(mutated, src, `the ${injected} mutation must actually have applied`);
    assert.deepEqual(absoluteExecutables(mutated).filter((p) => !BOOTSTRAP_PATHS.includes(p)),
      [injected], `${injected} must be caught wherever it lives, not just under bin/`);
  }

  // Round 84, Codex P2: the two bypasses that were live against the real script, injected
  // where a real one would go rather than asserted only against hand-written fixtures.
  const quoted = src.replace('ROOT=$(repo_root)', '"/tmp/curl" -s x >/dev/null\n  ROOT=$(repo_root)');
  assert.notEqual(quoted, src, 'the quoted-absolute mutation must actually have applied');
  assert.deepEqual(absoluteExecutables(quoted).filter((p) => !BOOTSTRAP_PATHS.includes(p)),
    ['/tmp/curl'], 'quoting an absolute path must not hide it — quotes are not a comment');

  const dispatched = src.replace('ROOT=$(repo_root)', 'c=git; "$c" push --all\n  ROOT=$(repo_root)');
  assert.notEqual(dispatched, src, 'the variable-dispatch mutation must actually have applied');
  assert.deepEqual(absoluteExecutables(dispatched).filter((p) => !BOOTSTRAP_PATHS.includes(p)), [],
    'control: variable dispatch introduces no absolute path, so that oracle cannot see it');
  assert.deepEqual(bareCallSites(dispatched), [],
    'control: nor does it name an allowlisted command in command position');
  assert.deepEqual(dynamicDispatchSites(dispatched), ['$c'],
    'the dispatch oracle is the only thing that can catch it');

  // Dropping `sd_run` leaves the trace and the absolute-path check both green.
  const unrouted = src.replace('  sd_run git --no-replace-objects -C "$ROOT" "$@"',
    '  git --no-replace-objects -C "$ROOT" "$@"');
  assert.notEqual(unrouted, src, 'the sd_run-removal mutation must actually have applied');
  assert.deepEqual(absoluteExecutables(unrouted).filter((p) => !BOOTSTRAP_PATHS.includes(p)), [],
    'control: this mutant is invisible to the absolute-path oracle, which is the point');
  assert.deepEqual(bareCallSites(unrouted), ['git'], 'the routing oracle is what catches it');
});

test('the recognizers see command positions regexes on leading delimiters cannot', () => {
  // Every one of these is ordinary shell that a delimiter-anchored regex reads as inert.
  // They are here as fixtures rather than as mutations of the real script because the
  // point is the RECOGNIZER's reach, and a fixture states the grammar being claimed.
  for (const line of [
    'LC_ALL=C git log -1 --format=%B "$oid"',
    'while git status; do :; done',
    '{ git status; }',
    'if git diff --quiet; then :; fi',
    'TZ=UTC LC_ALL=C git log',
    'until git fsck; do :; done',
    // Leading redirections. `>/dev/null git log` runs git with its stdout redirected; the
    // first word of the segment is the redirection, so an unpeeled recognizer sees no
    // command at all — the hole Codex found in this oracle.
    '>/dev/null git log',
    '2>/dev/null git fsck',
    '>>"$log" git status',
    '&>/dev/null git diff',
    '2>&1 git log',
    '<"$f" git hash-object -w --stdin',
    '>/dev/null LC_ALL=C git log',
    // Longest-form operators. Each is valid under the local Bash 3.2 and really does run
    // git; each was reported as its OPERAND before the alternation was ordered by length.
    '>| /dev/null git status',
    '>|/dev/null git status',
    '<<< x git status',
    // Command substitution is evaluated INSIDE double quotes, so this really does run git.
    // Treating the whole `"…"` as text reported no call site at all — measured, round 84.
    'x="$(git status)"',
    'printf %s "prefix $(git rev-parse HEAD) suffix"',
    // A quoted assignment VALUE containing a space. The old segment-prefix peeling stopped at
    // that space, left `b" git log`, and took `b"` as the command — so `git` was invisible and
    // a lone `"` was reported as a command word. Words are split quote-aware now.
    'X="a b" git log',
    "MSG='two words' git commit -F -",
  ]) {
    assert.deepEqual(bareCallSites(line), ['git'], `an unrouted git must be visible in: ${line}`);
  }

  for (const line of [
    'LC_ALL=C /tmp/curl -s http://x',
    'if /tmp/curl; then :; fi',
    '{ /usr/libexec/helper; }',
    'exec /usr/bin/env -u SHELLOPTS /bin/bash',
    '2>/dev/null /tmp/curl -s http://x',
    '>/dev/null /usr/libexec/helper',
    // Round 84, Codex P2. Quoting an absolute path does not stop it executing, but
    // stripQuoted() blanked the whole word before the oracle looked at it, so every one of
    // these was invisible while running exactly as written. Quotes are a SHELL protection
    // against word-splitting; they are not a comment.
    '"/tmp/curl" -s http://x',
    "'/tmp/curl' -s http://x",
    '"/usr/libexec/helper"',
    'LC_ALL=C "/tmp/curl"',
    '>/dev/null "/tmp/curl"',
    // Round 84, Codex P2, second shape: ONE word built from a quoted and an unquoted span.
    // Peeling only a wholly-quoted word left this matching neither branch, so it ran exactly
    // as written while every oracle reported nothing. unquote() concatenates spans now.
    '"/usr/bin"/tr"ue"',
    '"/tmp"/curl -s http://x',
    "/tmp/'curl' -s http://x",
  ]) {
    assert.ok(absoluteExecutables(line).length > 0, `an absolute command must be visible in: ${line}`);
  }

  // Wrappers get their OWN loop with an exact expectation, because `.length > 0` above is
  // satisfied by the wrapper itself: `/usr/bin/env … /tmp/curl` reports `/usr/bin/env` whether
  // or not the operand was ever found, so a reverted cluster rule passed that assertion
  // unchanged. Same defect shape as the "bootstrap pair" — the assertion was weaker than the
  // property, and the mutation that should have killed it survived.
  for (const [line, want] of [
    // Round 87, Codex P2. `env` RUNS its operand, so the operand is a command position — and
    // the executor's bootstrap is exactly this shape.
    ['exec /usr/bin/env -u BASH_ENV /tmp/curl -s http://x', ['/tmp/curl', '/usr/bin/env']],
    ["/usr/bin/env -u A -u B 'X=1' /tmp/curl", ['/tmp/curl', '/usr/bin/env']],
    ['/usr/bin/env -- /tmp/curl', ['/tmp/curl', '/usr/bin/env']],
    ['/usr/bin/env -i /tmp/curl', ['/tmp/curl', '/usr/bin/env']],
    // Round 88, Codex P2. Clustered options: measured, `env -iu PATH /usr/bin/printf …` runs
    // printf, so a getopt operand attaches to the LAST character of the cluster…
    ['/usr/bin/env -iu PATH /tmp/curl', ['/tmp/curl', '/usr/bin/env']],
    // …and `-ui` makes `i` the operand of `u`, so the command is already the next word.
    ['/usr/bin/env -ui /tmp/curl', ['/tmp/curl', '/usr/bin/env']],
    // Attached exec name — measured, `exec -afoo /usr/bin/false` exits 1, so false ran.
    ['( exec -afoo /tmp/curl )', ['/tmp/curl']],
    ['( exec -cafoo /tmp/curl )', ['/tmp/curl']],
    ['( exec -ca foo /tmp/curl )', ['/tmp/curl']],
  ]) {
    assert.deepEqual(absoluteExecutables(line), want,
      `the wrapper's operand is a command position too, in: ${line}`);
  }

  // Round 84, Codex P2. Variable dispatch keeps the execution trace identical and introduces
  // no absolute path, so both other oracles stay green. `cmd=git; "$cmd" …` is the shape.
  for (const line of [
    'cmd=git; "$cmd" status',
    'cmd=git; $cmd status',
    'c=/tmp/curl; "$c" -s http://x',
    'run() { "$1" status; }',
    // `${…}` is a parameter expansion, not a brace group. While `{` and `}` were separators it
    // was torn into `$`, `cmd` and `status`, so the UNQUOTED brace form walked past the oracle
    // that exists to catch exactly it — while the quoted `"${cmd}"` spelling was caught.
    'cmd=git; ${cmd} status',
    'c=/tmp/curl; ${c:-/bin/sh} -s http://x',
    // Round 86, Codex P2. The prefix keywords take OPTIONS, and the option's operand still
    // runs: measured under the local Bash 3.2, each of these executed the variable's contents.
    // With the option unpeeled it was reported as the command name, so the dispatch behind it
    // never reached the ban — `command --` was peeled and `command -p` was not.
    'cmd=git; command -p "$cmd" status',
    'cmd=git; time -p "$cmd" status',
    'cmd=/tmp/curl; ( exec -a innocuous "$cmd" -s http://x )',
    // Round 87, Codex P2. The `-a` need not be alone: measured, `exec -ca harmless "$evil"`
    // runs `$evil` under Bash 3.2. Matching the flag exactly meant the CLUSTER form skipped
    // only `-ca`, promoted `harmless` to the command name, and the dispatch was invisible —
    // reachable, because the dispatcher's own asserted result would have stayed `['$cmd']`.
    'cmd=/tmp/curl; ( exec -ca harmless "$cmd" )',
    'cmd=/tmp/curl; ( exec -cla harmless "$cmd" )',
  ]) {
    assert.notDeepEqual(dynamicDispatchSites(line), [],
      `a variable in command position must be visible in: ${line}`);
  }
  // And the other direction: an ordinary variable OPERAND is not a dispatch.
  for (const line of [
    'sd_run git log -1 --format=%B "$oid"',
    'warn "$oid became reachable"',
    'printf %s "$RUN_MARKER"',
    // A segment that is ONLY an assignment runs nothing, so its right-hand side is not a
    // command word. Both of these were reported as dispatch, and both are ordinary code from
    // the scripts themselves — a recognizer that flags them is one whose output gets ignored.
    "REPO_ROOT=${REPO_ROOT%$'\\n'}",
    'OWNED+=("$1")',
    // The Bash 3.2 safe-empty-array idiom, in a `for` list — a word, never a command.
    'for f in ${OWNED[@]+"${OWNED[@]}"}; do :; done',
    // Verbatim from the scripts. The brace scanner counts `{`/`}` without tracking quotes, so
    // these are the cases where that shortcut could bite: each contains a quoted span INSIDE
    // the expansion. Their braces balance, so each is consumed whole — asserted rather than
    // eyeballed, because a mis-scan here reports ordinary code as dynamic dispatch.
    "list=${list//$'\\n'/ }",
    'OWNED=(${keep[@]+"${keep[@]}"})',
    'run_commit "$msg_file" ${sign_args[@]+"${sign_args[@]}"}',
    // Round 87. A `-` word with no keyword owning it is a command name bash will try to run,
    // not an option — so peeling it would report the NEXT word as a command that never runs.
    '-p "$evil"',
    '-a "$evil" status',
    // `command -v` looks a name up; it executes nothing at all.
    'command -v "$evil"',
    // The negative control for the `exec` cluster rule, and it is not symmetry for its own
    // sake — measured, `exec -la "$e"` prints nothing: the `a` takes `$e` as the NAME, leaving
    // no command, so exec runs nothing. A rule that reported dispatch here would be inventing
    // one, and the positive cases above would no longer distinguish anything.
    'cmd=/tmp/curl; ( exec -la "$cmd" )',
  ]) {
    assert.deepEqual(dynamicDispatchSites(line), [],
      `a variable used as an operand is not dispatch: ${line}`);
  }

  // MULTI-LINE QUOTED STRINGS. The set-membership idiom this script uses puts a bare `$mine`
  // and `$oid` alone on a line, inside a string that opens on the previous line — so a
  // line-at-a-time scanner reads them as commands. It did, on the real script.
  assert.deepEqual(dynamicDispatchSites('case "\n$mine\n" in\n  *"\n$oid\n"*) : ;;\nesac'), [],
    'a variable inside a string spanning newlines is content, not a command position');

  // Round 85, Codex P2. A quoted `}` INSIDE a parameter expansion. Valid Bash 3.2 — measured,
  // `v=x; printf "[%s]" ${v:-"}"}` prints `[x]` — and under a brace counter that ignores quotes
  // the expansion closed early, the stray `"` opened a quote, and the rest of the line was
  // swallowed. Not a partial miss: `/usr/bin/true` was invisible to EVERY oracle at once.
  assert.ok(absoluteExecutables('v=x; X=${v:-"}"} /usr/bin/true').length > 0,
    'a quoted brace inside an expansion must not swallow the command behind it');

  // Round 85, Codex P2. Inside double quotes Bash keeps a backslash before an ordinary char, so
  // `"g\it"` is the four characters g \ i t — not a call to git. Stripping every backslash made
  // the recognizer INVENT a call site, which is the failure that gets an oracle switched off.
  assert.equal(unquote('"g\\it"'), 'g\\it', 'a backslash before an ordinary char is literal');
  assert.deepEqual(bareCallSites('"g\\it" status'), [], 'so it is not a git call site');
  assert.equal(unquote('"g\\$it"'), 'g$it', 'control: before $ the backslash IS an escape');

  // Round 85, Codex P2. Command substitution in COMMAND position: the command name is computed
  // at run time, so no token-based oracle can ever name it. The first ban was a source regex
  // listing the delimiters it could follow, which missed every prefix it did not enumerate.
  for (const line of [
    '$(printf git) --version',
    'if $(printf git) --version; then :; fi',
    'while $(printf git); do :; done',
    '! $(printf git)',
    'X=1 $(printf git)',
    '>/dev/null $(printf git)',
    'command $(printf git)',
    // Round 86, Codex P2. QUOTED, and it still runs git — measured: `"$(printf git)" --version`
    // prints the git version. The suffix test that decided command position asked whether the
    // text ended in `=`; a lone `"` does not, so this was reported as no command word at all
    // and walked past the ban the ban exists for.
    '"$(printf git)" --version',
    // Half-literal, half-computed — and it runs git: measured, `'g'"$(printf it)" --version`
    // prints the git version. This is the shape that makes reporting the literal fragment
    // actively harmful, so the assertion below checks the fragment is NOT reported as a name.
    "'g'\"$(printf it)\" --version",
    'X=1 >/dev/null "$(printf git)"',
  ]) {
    assert.ok(commandTokens(line).includes('$('),
      `a computed command word must be visible in: ${line}`);
  }
  // Exactly two command positions, and `g` is neither of them: the outer name is computed, and
  // `printf` really does run inside the substitution. `--version` is an argument, so a third
  // entry here would mean the tail after `)` had been mis-read as a new command.
  assert.deepEqual(commandTokens("'g'\"$(printf it)\" --version"), ['$(', 'printf'],
    'and the literal half is not reported as if it were the resolved command name');
  // And the other direction — a substitution supplying a VALUE or an operand is not a command.
  // Without these the ban would fire on ordinary code, which is how the last two bans died.
  for (const line of [
    'x=$(git status)',
    'arr=($(git status))',
    'echo $(git rev-parse)',
    'printf %s "prefix $(git rev-parse HEAD)"',
    // Round 86, same finding, the noisy direction. Each of these was reported AS a computed
    // command by the suffix test, and each is ordinary shell: a quoted assignment value, an
    // array element, a redirection target. A ban that fires on these is a ban that gets
    // switched off — which is how the two previous drafts of it died.
    'x="$(git status)"',
    'arr=(x $(git status))',
    'arr=(x "$(git status)")',
    '>$(printf /dev/null) git status',
    '2>"$(printf /dev/null)" git status',
    // The bare-operator spelling, where the target is a separate word. Measured: this
    // redirects and runs `echo`, so the substitution is a filename, not a command.
    '>| $(printf /dev/null) echo hi',
  ]) {
    assert.ok(!commandTokens(line).includes('$('),
      `a substitution used as a value or operand is not a command word: ${line}`);
  }

  // Round 87, Codex P2. A command substitution INSIDE a parameter expansion still runs:
  // measured, `unset x; y=${x:-$(/usr/bin/true && echo RAN)}` prints RAN. The expansion was
  // consumed as one word, so the command inside it was invisible to every oracle at once —
  // the same total-silence shape as the quoted-brace and escaped-brace cases.
  for (const [line, oracle, want] of [
    ['unset x; y=${x:-$(git status)}', bareCallSites, ['git']],
    ['printf %s "${x:-$(git rev-parse HEAD)}"', bareCallSites, ['git']],
    ['y=${x:-`git status`}', bareCallSites, ['git']],
    // Backticks are expanded inside double quotes too — only `$(` was recognised there.
    ['x="`git rev-parse HEAD`"', bareCallSites, ['git']],
    ['y=${x:-$(/tmp/curl -s http://z)}', absoluteExecutables, ['/tmp/curl']],
    ['y=${x:-$($evil -s http://z)}', dynamicDispatchSites, ['$evil']],
  ]) {
    assert.deepEqual(oracle(line), want, `a command inside an expansion must be visible in: ${line}`);
  }
  // The closing backtick must RESTORE the quote it opened in, not leave the scanner unquoted:
  // `/tmp/curl` here is string content. A backtick that only ever opens keeps every later word
  // unquoted, which reports string content as commands — and nothing else in this file would
  // have noticed, because inventing call sites only shows up in the negative direction.
  assert.deepEqual(absoluteExecutables('x="`git rev-parse HEAD` /tmp/curl"'), [],
    'text after a closing backtick is still inside the string that opened before it');

  // And the expansion's own text is NOT a command — reporting `x:-` as a resolved name is the
  // same defect as reporting the literal half of a half-computed word.
  assert.deepEqual(commandTokens('y=${x:-$(git status)}'), ['git'],
    'only the substitution is a command position; the expansion around it is a value');
  for (const line of ["REPO_ROOT=${REPO_ROOT%$'\\n'}", 'for f in ${OWNED[@]+"${OWNED[@]}"}; do :; done']) {
    assert.deepEqual(dynamicDispatchSites(line), [],
      `an expansion with no substitution in it is untouched by that recursion: ${line}`);
  }

  // Round 86, Codex P2. A BACKSLASH-escaped brace inside an expansion. Valid Bash 3.2 —
  // measured, `v=x; printf "[%s]" ${v:-\{}` prints `[x]` — and a brace counter that honours
  // quotes but not backslashes closed the expansion one character early, leaving the rest of
  // the line mis-segmented. Same swallow-the-command shape as the quoted-brace case above.
  assert.ok(absoluteExecutables('v=x; X=${v:-\\{} /usr/bin/true').length > 0,
    'a backslash-escaped brace inside an expansion must not swallow the command behind it');

  // The dangerous direction of that same change: quote state must CLOSE at the string's end.
  // A scanner that stays "inside quotes" after a multi-line string swallows the rest of the
  // file, and every oracle then reports a clean script no matter what follows. Both of these
  // are invisible under that failure, and neither is under any other bug in this function.
  assert.notDeepEqual(dynamicDispatchSites('msg="a\nb"\n$cmd status'), [],
    'a dispatch AFTER a multi-line string must still be visible');
  assert.ok(absoluteExecutables('msg="a\nb"\n/tmp/curl -s http://x').length > 0,
    'an absolute command AFTER a multi-line string must still be visible');

  // The other direction — the recognizer must not invent call sites, or it becomes noise
  // that gets suppressed. Quoted prose is the case that actually bit: a `warn` message
  // containing the words "git replace" is not a git invocation.
  assert.deepEqual(bareCallSites("warn 'grafts are deprecated; git replace refuses both'"), [],
    'prose inside a quoted string is not shell');
  assert.deepEqual(bareCallSites('sd_run git rev-parse --show-toplevel'), [],
    'a routed call is exactly what must NOT be reported');
  assert.deepEqual(bareCallSites('root=$(sd_run git rev-parse) || return 1'), [],
    'routing survives command substitution');
  assert.deepEqual(bareCallSites('sd_run git status >/dev/null'), [],
    'a trailing redirection on a routed call leaves it routed');
  assert.deepEqual(bareCallSites('exec 3>&1'), [],
    'a bare redirection is not a command position');
  // Backtick substitution. The assignment prefix used to consume ``root=`git `` as one token,
  // so the bare `git` behind it reached neither oracle — and the PATH trace cannot see it
  // either, because a routed and an unrouted `git` look identical from the trace's side.
  assert.deepEqual(bareCallSites('root=`git rev-parse --show-toplevel`'), ['git'],
    'a backtick substitution is a command position');
  assert.deepEqual(bareCallSites('root=`sd_run git rev-parse`'), [],
    'and a routed call inside backticks is still routed');
});

/**
 * The restricted subset these two scripts are allowed to be written in. Each entry is a form
 * Codex demonstrated the recognizer mis-parsing, verified against the local Bash 3.2 first.
 * Applied to quote-blanked, comment-stripped source.
 */
const SUBSET_BANS = [
  // `exec -afoo /usr/bin/false` runs false with argv[0] `foo` — measured, it exits 1. The name
  // may be ATTACHED to the cluster, so no fixed cluster rule reads every spelling right.
  [/\bexec\s+-/, 'exec takes no options here; the bootstrap re-exec is plain `exec`'],
  // `env` gets a positive FORM assertion instead of a spelling ban (see ENV_BOOTSTRAP_FORM):
  // `-S` hides the command inside a string operand and `-iu PATH` puts it after a cluster, and
  // a ban per spelling would have to enumerate them — which is the losing game this list exits.
  // Legacy nesting escapes backticks (`` `echo \`git status\`` ``) — a depth no single-level
  // pairing models correctly. Scanned with only SINGLE quotes blanked, because a backtick
  // inside double quotes still runs; `blankQuoted` hid that case from its own ban.
  [/`/, 'backticks are banned outright — use $( ), which nests without escaping', blankSingleQuoted],
  // `sd_run bash -c '…'` reaches anything through an allowlisted interpreter, and the command
  // it runs lives in a string operand no token walk can see. The dispatcher's own header says
  // so; only the bootstrap's `bash -p -- <script>` shape is needed.
  [/\b(?:ba)?sh\s+-c\b/, 'a code-string interpreter operand is transitive execution'],
  // `command -v$(printf '')` is a valid lookup that the recognizer reads as a computed command
  // word. Banning the construct removes the disagreement rather than arbitrating it.
  [/(?:^|\s)-\S*(?:\$\(|`)/, 'a substitution inside an option word cannot be classified'],
];

/**
 * Every command name each script is allowed to use. Shell keywords and builtins are in here
 * too — `commandTokens` reports whatever occupies a command position, and pretending to
 * classify builtins separately would just be another list to get wrong.
 *
 * `.` is the dispatcher load at execute.sh:117, guarded by the regular-file and symlink checks
 * immediately above it. It is worth naming: the ban list forbids `source`, and `.` is the same
 * operation — so the ban was never the thing keeping sourcing bounded. This set is.
 */
const PERMITTED_TOKENS = {
  [execScript]: [
    '.', '/bin/bash', '/usr/bin/env', ':', '[', 'break', 'case', 'cmd_alloc', 'cmd_commit',
    'cmd_verify_last', 'continue', 'disown_path', 'done', 'esac', 'exit', 'export', 'fi',
    'find_guard', 'for', 'git_verify', 'local', 'marked_oids', 'own', 'printf', 'read',
    'refuse_on_ancestry_overlays', 'repo_root', 'resolve_git_path', 'return', 'run_commit',
    'run_guard', 'scrub', 'sd_run', 'set', 'shift', 'snapshot_tips', 'sweep_owned', 'trap',
    'unset', 'usage', 'verify_created', 'verify_one', 'warn',
  ],
  [dispatchScript]: [
    '$cmd', '[', 'break', 'case', 'done', 'esac', 'exit', 'fi', 'for', 'local', 'printf',
    'return', 'sd_allowlist', 'sd_run', 'shift',
  ],
};

const SENSITIVE_COUNTS = {
  [execScript]: { '.': 1, '/usr/bin/env': 1, '/bin/bash': 1 },
  [dispatchScript]: { '.': 0, '/usr/bin/env': 0, '/bin/bash': 0 },
};

/**
 * Constructs that carry executable code in an OPERAND. `commandTokens` reports the outer name
 * and treats the rest as data, which is correct for the token walk and useless as a bound:
 * `trap '/bin/bash -c "…"' EXIT` yields the single permitted token `trap`, and the payload runs
 * when the trap fires. `sd_run bash …` and the `env` bootstrap are the same shape — the name is
 * allowed, the operands decide what executes.
 *
 * So the operands are pinned too, and the locator is STRUCTURAL rather than textual. Three
 * textual locators have now failed in a row, each to ordinary quoting: a `bash -c` spelling ban
 * scanned quote-blanked text, so `sd_run bash "-c" '…'` became `sd_run bash "" ''`; a whole-line
 * `\benv\b` match selected a decoy the shell never executes, while the real call was spelled
 * `/usr/bin/e""nv` (Codex, round 90, both measured). Segmenting and UNQUOTING each word defeats
 * both classes at once: `"-c"` unquotes to `-c`, `/usr/bin/e""nv` to `/usr/bin/env`, and text
 * inside a quoted blob stays one word instead of masquerading as a command.
 */
const CONTROL_TRANSFER = new Set([
  '.', 'source', 'sd_run', 'exec', 'trap', 'command', 'eval',
  // `git_verify` is in-process, not an external program — it is here because of what it FORWARDS.
  // Its runtime allowlist can only see `$1`, so it bounds the subcommand and nothing after it,
  // and two of the permitted names have write forms reachable purely through later operands:
  // `git symbolic-ref <name> <ref>` updates a ref (and `--delete` removes one), and `git reflog
  // delete|drop|expire` rewrites reflogs. Selecting the call sites pins the WHOLE argv, so the
  // read-only property is carried by the pin and the first-word list is the runtime backstop —
  // neither alone states it (Codex, round 94).
  'git_verify',
]);

/**
 * Selected by the OPERATION, not by what its operands happen to be spelled. Keying on "a word
 * that looks like `bash` or `env`" was the wrong axis and the dispatcher proved it: that version
 * pinned `printf '%s\n' bash git mktemp rm` (the allowlist DATA, which transfers nothing) and
 * `cmd=/bin/bash` (an assignment), while missing `command -- "$cmd" "$@"` — the one line in the
 * file that actually dispatches. It also missed `sd_run "${RUNNER:-bash}" -c …`, whose name is
 * computed, and `sd_run git -c alias.pwn='!…' pwn`, where the code rides in a git option
 * (Codex, round 92, all three measured as executing).
 *
 * Command position matters: `printf .` passes `.` as data, and selecting it would be noise that
 * teaches a reader to ignore the pin. `peelPrefixes` gives the prefix words plus the command
 * word, and only those are tested.
 */
const segmentWords = (src) => splitSegments(codeLines(src).join('\n'))
  .map((seg) => shellWords(seg.text).map(unquote).filter(Boolean));

const codeBearingSegments = (src) => segmentWords(src)
  .filter((words) => words.slice(0, peelPrefixes(words) + 1)
    .some((w) => CONTROL_TRANSFER.has(w)));

/**
 * Every one of them, whole, in order. An ordered list rather than a set: two identical
 * `sd_run bash` guard invocations are legitimate and a third is not, which set equality cannot
 * see. The env bootstrap is entry 0 — its `${BASH_SOURCE[0]:-$0}` operand is what decides which
 * script privileged bash runs, and a prefix-only form regex accepted an
 * `${UNTRUSTED_EXECUTOR:-…}` substitution in its place.
 */
const PINNED_CODE_BEARING = {
  [execScript]: [
    ['exec', '/usr/bin/env', '-u', 'SHELLOPTS', '-u', 'BASHOPTS', '-u', 'BASH_ENV',
      'SD0X_PRIV_REEXEC=1', '/bin/bash', '-p', '--', '${BASH_SOURCE[0]:-$0}', '$@'],
    ['.', '$DISPATCH'],
    // Negated: the sweep now REPORTS a failed removal instead of discarding the result, so the
    // call sits under `if ! …`. `!` is a prefix word, so the pin carries it.
    ['!', 'sd_run', 'rm', '-f', '--', '$f'],
    ['trap', 'sweep_owned', 'EXIT'],
    ['trap', 'exit 130', 'INT'],
    ['trap', 'exit 143', 'TERM'],
    ['trap', 'exit 129', 'HUP'],
    ['sd_run', 'git', 'rev-parse', '--show-toplevel'],
    ['sd_run', 'bash', '-p', '--', '$GUARD', '$1'],
    ['sd_run', 'bash', '-p', '--', '$GUARD', '$1'],
    ['sd_run', 'git', '-C', '$ROOT', 'commit', '$@', '-F', '$msg_file'],
    ['sd_run', 'git', '-C', '$ROOT', 'commit', '$@', '-F', '$msg_file'],
    // Every `git_verify` argv below, whole. Each is a read: `reflog` with only a `--format`,
    // `log -1`, `for-each-ref` with only a `--format`, `rev-parse --verify|--git-path`,
    // `symbolic-ref -q HEAD` (query — one operand, no second ref to write), `rev-list`.
    ['git_verify', 'reflog', '--format=%H %gs'],
    // The DEFINITION, not a call — `git_verify() {` splits at the `(`. Pinning it is what makes
    // the count meaningful: a second definition shadowing the first would otherwise be free.
    ['git_verify'],
    ['sd_run', 'git', '--no-replace-objects', '-C', '$ROOT', '$@'],
    ['if', 'sd_run', 'rm', '-f', '--', '$1'],
    ['sd_run', 'mktemp', '--', '${TMPDIR:-/tmp}/smart-commit-msg.XXXXXX'],
    ['sd_run', 'mktemp', '--', '${TMPDIR:-/tmp}/smart-commit-log.XXXXXX'],
    ['if', '!', 'git_verify', 'log', '-1', '--format=%B', '$target', '>', '$logfile'],
    ['git_verify', 'for-each-ref', '--format=%(refname) %(objectname)'],
    ['git_verify', 'rev-parse', '--verify', '--quiet', 'HEAD'],
    ['git_verify', 'symbolic-ref', '-q', 'HEAD', '>/dev/null'],
    ['git_verify', 'rev-parse', '--git-path', '$1'],
    ['git_verify', 'rev-list', '${args[@]}'],
    ['git_verify', 'rev-parse', '--verify', '--quiet', 'HEAD'],
    ['git_verify', 'rev-parse', '--verify', 'HEAD'],
  ],
  [dispatchScript]: [
    ['sd_run'],
    ['command', '--', '$cmd', '$@'],
    ['sd_run', '$@'],
  ],
};

test('the restricted-subset bans fire on the exact forms that defeated the recognizer', () => {
  // Round 89. Every mutation here is one Codex built and measured against the real executor,
  // and every one left all three oracles' output unchanged — that is why the bans exist rather
  // than more recognizer rules. A ban nobody can trip is not a control, so each is tripped.
  const src = readFileSync(execScript, 'utf8');
  const anchor = 'ROOT=$(repo_root)';
  // Each ban is applied through ITS OWN scanner, exactly as the subset test applies it. The
  // helper used to hard-code `blankQuoted` for every entry, which quietly made the third tuple
  // element decorative: swapping `blankSingleQuoted` back to `blankQuoted` changed nothing here,
  // so the backtick fix had no regression behind it at all (Codex, round 90). A mutation helper
  // that does not mirror the production scan tests a scan that does not exist.
  const trips = (mutated) => SUBSET_BANS
    .filter(([re, , blank]) => re.test(codeLines(mutated).map(blank ?? blankQuoted).join('\n')))
    .map(([re]) => re.source);

  for (const [inject, expect] of [
    // Attached name: the cluster's own trailing characters are the operand.
    ['( exec -afoo /tmp/curl )', '\\bexec\\s+-'],
    ['( exec -cafoo /tmp/curl )', '\\bexec\\s+-'],
    // Legacy nested backticks — measured to run the inner command.
    ['y=${x:-`echo \\`git status\\``}', '`'],
    // A backtick inside DOUBLE quotes still runs, and `blankQuoted` erases it — so this is the
    // mutation that makes `blankSingleQuoted` load-bearing. With the scanner reverted to
    // `blankQuoted` it goes invisible; that is the whole reason the third tuple element exists.
    ['x="`git status`"', '`'],
    // An option word carrying a substitution.
    ["command -v$(printf '') \"$evil\"", '(?:^|\\s)-\\S*(?:\\$\\(|`)'],
  ]) {
    const mutated = src.replace(anchor, `${inject}\n  ${anchor}`);
    assert.notEqual(mutated, src, `the ${inject} mutation must actually have applied`);
    assert.ok(trips(mutated).includes(expect),
      `${inject} must trip the ban ${expect}; tripped: ${JSON.stringify(trips(mutated))}`);
  }

  // The two `env` forms are caught by the COUNT and the FORM, not by a spelling — stated here
  // because a reader would otherwise expect them in the table above. Each gets its own mutation
  // rather than being asserted by reference to the rule that is supposed to catch it.
  for (const inject of ['/usr/bin/env -iu PATH /tmp/curl', '/usr/bin/env -S "git status"']) {
    const second = src.replace(anchor, `${inject}\n  ${anchor}`);
    assert.notEqual(second, src, `the ${inject} mutation must actually have applied`);
    const envCalls = commandTokens(second).filter((t) => t === 'env' || t.endsWith('/env'));
    assert.notDeepEqual(envCalls, ['/usr/bin/env'],
      `a second env invocation must be visible as a count, which a deduped set would hide: ${inject}`);
  }
  // And the code-bearing pins catch the same shapes applied to the constructs themselves, where
  // no count changes at all — the operand is the only thing that moved.
  const pinned = PINNED_CODE_BEARING[execScript];
  assert.deepEqual(codeBearingSegments(src), pinned,
    'the shipped code-bearing constructs must be exactly the permitted ones, operands included');
  for (const rewrite of [
    // The `env` bootstrap: options…
    ['-u SHELLOPTS', '-iu SHELLOPTS'],
    ['-u SHELLOPTS', '-S "git status" -u SHELLOPTS'],
    ["'SD0X_PRIV_REEXEC=1'", "--split-string='SD0X_PRIV_REEXEC=1'"],
    ["'SD0X_PRIV_REEXEC=1'", "'SD0X_UNCHECKED=1'"],
    // …and operands, which the prefix regex used to accept unchecked: same options, same env
    // count, same oracle output — a different program under privileged bash whenever the
    // variable is set. Spelled with split quotes too, the form that evaded the textual locator.
    ['"${BASH_SOURCE[0]:-$0}"', '"${UNTRUSTED_EXECUTOR:-${BASH_SOURCE[0]:-$0}}"'],
    ['-p -- "${BASH_SOURCE[0]', '-p "${BASH_SOURCE[0]'],
    ['"$@"', '"$@" --force'],
    // `trap` — the payload is an operand, so the outer token stays `trap` and every token-set
    // control stays green while the injected code runs at EXIT.
    ['trap sweep_owned EXIT', `trap '/bin/bash -c "printf BYPASS"' EXIT`],
    ["trap 'exit 130' INT", "trap 'printf BYPASS; exit 130' INT"],
    // `sd_run bash` — the interpreter is allowlisted, so only its operands bound it. Both
    // quotings below defeated the `bash -c` spelling ban, which scans quote-blanked text.
    ['sd_run bash -p -- "$GUARD" "$1"', `sd_run bash "-c" 'printf BYPASS'`],
    ['sd_run bash -p -- "$GUARD" "$1"', 'sd_run "bash" -c "printf BYPASS"'],
    // Round 92. A COMPUTED interpreter name — nothing in the segment is spelled `bash` at all,
    // which is exactly why selecting on operand spellings was the wrong axis.
    ['sd_run bash -p -- "$GUARD" "$1"', 'sd_run "${RUNNER:-bash}" -c "/usr/bin/true"'],
    // …and code riding inside a git OPTION. `git` is allowlisted and the payload is a config
    // value, so no interpreter name appears anywhere; measured to execute the alias.
    ['sd_run git rev-parse --show-toplevel', `sd_run git -c alias.pwn='!/usr/bin/true' pwn`],
    // `.` sources whatever the operand names. The count stayed at one through this swap, which
    // is why counting occurrences was never the same claim as pinning what they read.
    ['. "$DISPATCH"', '. "${UNTRUSTED_DISPATCH:-$DISPATCH}"'],
  ]) {
    const bent = src.replace(rewrite[0], rewrite[1]);
    assert.notEqual(bent, src, `the ${rewrite[1]} rewrite must actually have applied`);
    assert.notDeepEqual(codeBearingSegments(bent), pinned,
      `bending a code-bearing construct into \`${rewrite[1]}\` must break its pin`);
  }

  // Codex's round-90 mutant, whole. Three edits that only work together, which is why it is not
  // a row above: (1) a DECOY — the expected bootstrap text parked inside a multiline
  // single-quoted assignment, where the shell never executes it; (2) the real executable spelled
  // `/usr/bin/e""nv`, so a textual `\benv\b` locator skips it and selects the decoy instead;
  // (3) the operand swapped. Against the whole-line locator all three assertions stayed green.
  //
  // The split spelling on its own is deliberately NOT asserted to fail — it unquotes to the same
  // program and runs the same command, so rejecting it would be asserting a difference that does
  // not exist. What it buys an attacker is invisibility, and that is what unquoting removes.
  const decoyed = src
    .replace('ROOT=$(repo_root)', `DOC='\n${'exec /usr/bin/env -u SHELLOPTS -u BASHOPTS -u BASH_ENV '
      + "'SD0X_PRIV_REEXEC=1' /bin/bash -p -- \"${BASH_SOURCE[0]:-$0}\" \"$@\""}\n'\n  ROOT=$(repo_root)`)
    .replace('/usr/bin/env -u SHELLOPTS', '/usr/bin/e""nv -u SHELLOPTS')
    .replace('"${BASH_SOURCE[0]:-$0}" "$@"', '"${UNTRUSTED_EXECUTOR:-${BASH_SOURCE[0]:-$0}}" "$@"');
  assert.equal((decoyed.match(/UNTRUSTED_EXECUTOR/g) || []).length, 1,
    'the composite mutant must have applied all three of its edits');
  assert.notDeepEqual(codeBearingSegments(decoyed), pinned,
    'a decoy line plus a split-quoted spelling must not hide the real bootstrap from the pin');
});

/**
 * The `git_verify` gate, pinned WHOLE.
 *
 * Three locators failed before this, each binding to something that is not the gate:
 *
 * | Locator | Defeated by |
 * |---|---|
 * | `.match()` over the file | a decoy `for name in` anywhere above it (round 94) |
 * | the body between the definition and a column-0 `}` | a multiline single-quoted string holding a column-0 brace (round 95) |
 * | the unique `for name in` segment | renaming the real iterator to `candidate`, leaving the decoy the only `name` loop (round 96) |
 *
 * Each fix narrowed the search and the next mutation stepped around the narrowing, because every
 * one of them located the list by what it LOOKS like. The list is not the thing to find — the
 * function is. Pinning the whole definition ends the search: a decoy above it, a decoy quoted
 * inside it, a renamed iterator and an added `-c` all change these bytes, whatever they are
 * spelled like. It is the same move `PINNED_CODE_BEARING` and `PINNED_COPYABLE` make, applied to
 * the one function whose text carries a security property.
 *
 * The cost is real and worth naming: editing `git_verify` now requires editing this constant.
 * That is the intended friction for eleven lines that decide which git operations can run.
 */
const PINNED_GATE = [
  'git_verify() {',
  "  local sub=${1:-} name found=''",
  '  for name in reflog log for-each-ref rev-parse symbolic-ref rev-list; do',
  '    if [ "$name" = "$sub" ]; then found=1; break; fi',
  '  done',
  '  if [ -z "$found" ]; then',
  '    warn "git_verify: refusing \'$sub\' - not a permitted verification read"',
  '    return 127',
  '  fi',
  '  sd_run git --no-replace-objects -C "$ROOT" "$@"',
  '}',
].join('\n');

/** The gate's text as it stands, located by its definition line and its column-0 `}`. */
const gateText = (src) => {
  const open = src.indexOf('\ngit_verify() {\n');
  if (open < 0) return null;
  const close = src.indexOf('\n}\n', open);
  return close < 0 ? null : src.slice(open + 1, close + 2);
};

/**
 * The permitted reads, taken from the pin rather than from the file.
 *
 * Safe only BECAUSE the pin is asserted first: with `gateText(src) === PINNED_GATE` established,
 * reading the list out of the pinned bytes and reading it out of the script are the same read.
 * Without that assertion this would be the vacuous form — a test restating its own constant.
 */
const verifyReads = () => PINNED_GATE
  .match(/^ {2}for name in ([a-z -]+); do$/m)[1].trim().split(/\s+/);

test('git_verify is pinned whole, and every call site names a permitted read', () => {
  // `git_verify "$@"` used to forward anything into git. Git's GLOBAL options are the ones that
  // carry executable configuration — `-c alias.x='!cmd'` runs a shell command — and they must
  // precede the subcommand, so an operand in FIRST position decided what git did.
  //
  // Three controls, each covering what the others cannot:
  //   (1) the gate pinned WHOLE — no edit to it can be invisible, however it is spelled;
  //   (2) the runtime refusal — bounds first position at execution time, for any argv;
  //   (3) the argv pin — bounds every later operand of every call site (PINNED_CODE_BEARING),
  //       which matters because `symbolic-ref` and `reflog` have write forms living entirely
  //       there, where (2) cannot see them.
  const src = readFileSync(execScript, 'utf8');
  assert.equal(gateText(src), PINNED_GATE,
    'the git_verify gate is pinned whole — any edit to it must be made here deliberately');

  const reads = verifyReads();
  assert.deepEqual(reads, ['reflog', 'log', 'for-each-ref', 'rev-parse', 'symbolic-ref', 'rev-list'],
    'the permitted verification reads are a closed set — all of them read, none of them write');

  // Every shipped call site names one of them, so the refusal branch is unreachable in the
  // shipped script — which is the point, not a gap. `[^\s(]` excludes the definition line.
  const code = codeLines(src).join('\n');
  const callSites = [...code.matchAll(/git_verify ([^\s(]+)/g)].map((m) => m[1]);
  assert.equal(callSites.length, 9, `expected the nine shipped call sites; saw ${callSites.length}`);
  for (const sub of callSites) {
    assert.ok(reads.includes(sub),
      `git_verify call site \`${sub}\` is not a permitted read — it would be refused at runtime`);
  }
  assert.ok(!reads.includes('-c'),
    'a global option must never be a permitted read — that is the whole mechanism');
});

test('every mutation of the git_verify gate is visible, however it is spelled', () => {
  // The negative direction, and the reason it is a list rather than one case: each entry is a
  // mutation that defeated a PREVIOUS locator while leaving the suite green. A pin has no search
  // step to step around, so all of them land on the same assertion.
  const src = readFileSync(execScript, 'utf8');
  const LOOP = '  for name in reflog log for-each-ref rev-parse symbolic-ref rev-list; do';
  const withC = (s) => s.replace(`${LOOP}\n`,
    '  for name in reflog log for-each-ref rev-parse symbolic-ref rev-list -c; do\n');
  const armed = withC(src);
  assert.notEqual(armed, src, 'the -c mutation must apply to the live loop');

  for (const [label, mutated] of [
    // Round 93: the bare global option, with no concealment at all.
    ['a global option added to the list', armed],
    // Round 94: a decoy loop above the function defeated a whole-file text match.
    ['a decoy above the function', armed.replace('git_verify() {\n', `${LOOP} :; done\n\ngit_verify() {\n`)],
    // Round 95: a decoy in quoted data, carrying a column-0 `}` that ended a brace-matched slice
    // early. Valid bash — `bash -n` accepts it.
    ['a decoy quoted inside the function', armed.replace('git_verify() {\n',
      `git_verify() {\n  local gate_doc='\n${LOOP}\n}\n'\n`)],
    // Round 96: rename the real iterator so the decoy is the only `name` loop left. This is the
    // one that defeated selecting the unique `for name in` segment.
    ['the real iterator renamed past a decoy', armed
      .replace('git_verify() {\n', `${LOOP} :; done\n\ngit_verify() {\n`)
      .replace("  local sub=${1:-} name found=''", "  local sub=${1:-} candidate found=''")
      .replace('  for name in reflog log for-each-ref rev-parse symbolic-ref rev-list -c; do\n',
        '  for candidate in reflog log for-each-ref rev-parse symbolic-ref rev-list -c; do\n')
      .replace('    if [ "$name" = "$sub" ]', '    if [ "$candidate" = "$sub" ]')],
  ]) {
    assert.notEqual(mutated, src, `the ${label} mutation must apply`);
    assert.notEqual(gateText(mutated), PINNED_GATE, `the pin must see ${label}`);
  }

  // And the positive direction: an edit elsewhere in the script must NOT disturb the gate pin,
  // or it degrades into a whole-file checksum that fails on every unrelated change.
  const elsewhere = src.replace("warn() { printf '%s\\n' \"$*\" >&2; }",
    "warn() { printf '%s\\n' \"$*\" >&2; return 0; }");
  assert.notEqual(elsewhere, src, 'the unrelated-edit control must apply');
  assert.equal(gateText(elsewhere), PINNED_GATE, 'an edit outside the gate must not trip its pin');
});

test('a comment-looking line inside a quoted string does not desynchronize the scanner', () => {
  // Codex, round 96. `codeLines` deleted every physical line matching `^\s*#` BEFORE the
  // quote-aware scan ran. Bash reads a `# "` line inside a multiline string as content that
  // closes the quote; deleting it left the scanner's quote open across the following code and
  // resynchronizing only at the next assignment — so real command positions in between vanished
  // from every segment-based oracle at once. This is not hypothetical here: the executor uses
  // multiline strings deliberately (`out="$out$oid\n"`, and `case "\n$mine\n"` for exact
  // set-membership), so the construct the attack rides on is already in the file.
  const src = readFileSync(execScript, 'utf8');
  const pinned = PINNED_CODE_BEARING[execScript];
  assert.deepEqual(codeBearingSegments(src), pinned, 'baseline: the shipped segments are pinned');

  // A quoted `# "` pair straddling a real dispatch. Bash runs the `sd_run` line; a scanner that
  // strips the `#` lines first does not see it.
  const mutated = src.replace('  ROOT=$(repo_root) || {',
    '  doc="\n# "\n  sd_run bash -c "$UNTRUSTED"\n  dummy="\n# "\n  ROOT=$(repo_root) || {');
  assert.notEqual(mutated, src, 'the desynchronization mutation must apply');
  // `notDeepEqual` would be too weak to be a control here, and measurably so: a scanner that
  // simply LOSES its quote state also changes the output, so the assertion passes while the
  // dispatch is still invisible. Both round-97 mutants of the ANSI-C fix survived a
  // `notDeepEqual` form of this check. Name the segment that must appear.
  const smuggled = ['sd_run', 'bash', '-c', '$UNTRUSTED'];
  assert.equal(
    codeBearingSegments(mutated).some((w) => JSON.stringify(w) === JSON.stringify(smuggled)),
    true, 'a dispatch hidden between comment-looking quoted lines must still reach the pin');

  // Codex, round 97 — the same desynchronization, reached through ANSI-C quoting instead. In
  // `$'...'` a backslash escapes, so `\'` does NOT close the string: Bash keeps reading onto the
  // next line, where the leading `#` is string content and the following `'` is the real
  // terminator. A scanner that treats `$'` as a plain single quote believes the string closed on
  // line one and deletes line two as a comment — taking the dispatch with it. The direction
  // matters: this removes executable code from the oracle's view, which is a false NEGATIVE.
  //
  // The replacement is a FUNCTION, not a string, and that is load-bearing: in a replacement
  // string `$'` is the "text after the match" pattern, so passing this payload as a string
  // splices the rest of the file in where the ANSI-C quote should be. The mutant still differs
  // from the source, so `notEqual` passes and the test reports a surviving mutation that was
  // never actually applied. Hence the payload assertion below rather than a bare inequality.
  const ansiPayload = '  doc=$\'start\\\'\n  # payload\'; sd_run bash -c "$UNTRUSTED"\n';
  const ansiC = src.replace('  ROOT=$(repo_root) || {',
    () => `${ansiPayload}  ROOT=$(repo_root) || {`);
  assert.equal(ansiC.includes(ansiPayload), true,
    'the ANSI-C mutation must apply VERBATIM — a mangled payload reads as a surviving test');
  assert.equal(
    codeBearingSegments(ansiC).some((w) => JSON.stringify(w) === JSON.stringify(smuggled)),
    true, 'a dispatch smuggled past an escaped quote inside $\'...\' must still reach the pin');

  // The positive direction: an ordinary comment line outside quotes must still be removed, or
  // every commented-out example in the scripts starts reading as a call site.
  const commented = src.replace('  ROOT=$(repo_root) || {',
    '  # sd_run bash -c "$UNTRUSTED"\n  ROOT=$(repo_root) || {');
  assert.notEqual(commented, src, 'the comment control must apply');
  assert.deepEqual(codeBearingSegments(commented), pinned,
    'a genuine comment is not a call site — stripping it is the behaviour being preserved');
});

test('a git_verify call site rewritten into its write form breaks the argv pin', () => {
  // The gate permits `symbolic-ref` and `reflog` as NAMES, and both have write forms reachable
  // without touching first position: `git symbolic-ref HEAD refs/heads/x` moves HEAD, and
  // `git reflog delete <ref>@{n}` drops an entry. Neither changes `$1`, so neither is visible to
  // the runtime refusal — the pin is the control that sees them, and this is its negative
  // direction. Without it, "the pin carries the whole argv" is a claim about a data structure.
  const src = readFileSync(execScript, 'utf8');
  const pinned = PINNED_CODE_BEARING[execScript];
  assert.deepEqual(codeBearingSegments(src), pinned, 'baseline: the shipped argv list is pinned');

  for (const [from, to] of [
    // Query → write: a second operand turns the read into a ref update.
    ['git_verify symbolic-ref -q HEAD', 'git_verify symbolic-ref HEAD refs/heads/pwn'],
    ['git_verify symbolic-ref -q HEAD', 'git_verify symbolic-ref --delete HEAD'],
    // A permitted name with a write subcommand behind it.
    ["git_verify reflog --format='%H %gs'", 'git_verify reflog delete HEAD@{0}'],
    // And the global-option form, which the gate also refuses — belt and braces, since the two
    // controls are meant to overlap here rather than divide the space.
    ["git_verify reflog --format='%H %gs'", "git_verify -c alias.p='!/tmp/curl' p"],
  ]) {
    const mutated = src.replace(from, to);
    assert.notEqual(mutated, src, `the ${to} mutation must actually have applied`);
    assert.notDeepEqual(codeBearingSegments(mutated), pinned,
      `a write form spelled \`${to}\` must not pass as a verification read`);
  }
});

test('the scripts contain no construct the static oracle cannot analyse', () => {
  // `eval` and dynamic dispatch defeat any regex recognizer by construction: the command run
  // is not in the text. Rather than pretend to analyse them, they are banned outright, which
  // is a claim a test can hold.
  //
  // Round 89 turns that from a list into the governing strategy. Rounds 84–88 each found a new
  // Bash form the recognizer could not follow — quoted absolute paths, `>|`, computed command
  // words, escaped braces, option clusters, `env` operands, escaped nested backticks. Every
  // round closed the instance and the next found another, because "recognize every form of
  // Bash" is an open-ended problem and these scripts are 670 lines I control completely.
  //
  // So the direction inverts: the scripts may use only a RESTRICTED SUBSET, and the recognizer
  // only has to be complete over that subset. Each ban below is a form Codex demonstrated the
  // recognizer mis-parsing, none is a form these scripts have any reason to want, and every one
  // is checked against a mutation that adds it.
  for (const f of [execScript, dispatchScript]) {
    const src = readFileSync(f, 'utf8');
    const code = codeLines(src).map(blankQuoted).join('\n');
    for (const construct of [/\beval\b/, /\bsource\b/, /\bhash\s+-p\b/, /\benable\s+-n\b/]) {
      assert.doesNotMatch(code, construct,
        `${f} must not use ${construct} — the recognizer cannot follow it`);
    }
    for (const [construct, why, blank] of SUBSET_BANS) {
      const scanned = blank ? codeLines(src).map(blank).join('\n') : code;
      assert.doesNotMatch(scanned, construct, `${f}: ${why}`);
    }

    // The positive half of the subset, and the half that was missing. Banning FORMS left
    // command NAMES open: `bareCallSites` only reports names already in the dispatcher
    // allowlist, so a `curl https://… || :` mutation produced the token `curl` and no finding
    // at all — which falsifies the name of the routing test right next to it. And a quoted
    // builtin (`"eval" "$payload"` runs; `"exec" -afoo …` exits 1) evaded every SPELLING ban,
    // because those are scanned on quote-blanked text while `commandTokens` resolves quotes.
    //
    // Pinning the whole token set fixes both at once and needs no list of things to fear: any
    // name that is not already here fails, whatever it is and however it is spelled. The cost
    // is that adding a genuinely new command to these scripts requires adding it here — which
    // is the intended friction, and the diff says exactly what was added.
    assert.deepEqual([...new Set(commandTokens(src))].sort(), PERMITTED_TOKENS[f],
      `${f}: every command name must be in the permitted subset — add it here deliberately`);

    // Set equality cannot see a SECOND occurrence, and for these three that is the whole risk:
    // a second `.` sources another file, a second `env` is another exit point, a second
    // `/bin/bash` another interpreter. Counted, per Codex's round-88 note about deduping.
    const counts = commandTokens(src).reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map());
    for (const [tok, n] of Object.entries(SENSITIVE_COUNTS[f])) {
      assert.equal(counts.get(tok) ?? 0, n,
        `${f}: expected exactly ${n} × \`${tok}\` — each occurrence hands control somewhere`);
    }
    // `env` is an operand-executing wrapper, so every invocation is a place control leaves the
    // script. The executor has exactly one — the bootstrap — and `absoluteExecutables` dedupes,
    // so a SECOND `/usr/bin/env` would not change its set. Counted, not deduped.
    const envCalls = commandTokens(src).filter((t) => t === 'env' || t.endsWith('/env'));
    assert.deepEqual(envCalls, f === execScript ? ['/usr/bin/env'] : [],
      `${f}: env invocations are counted, not deduped — a second one is a second exit point`);
    // Every construct that carries code in an operand, pinned whole and in order. This is the
    // half `PERMITTED_TOKENS` structurally cannot cover: `trap` and `bash` are permitted NAMES,
    // and what they run lives in an argument the token walk correctly treats as data.
    assert.deepEqual(codeBearingSegments(src), PINNED_CODE_BEARING[f],
      `${f}: code-bearing constructs are pinned with their operands — the name alone bounds nothing`);
    // The banned-pattern list above is a list of SPELLINGS, and Codex's round-83 finding was
    // that `cmd=git; "$cmd" …` is none of them while defeating the recognizer just as
    // completely. This asserts the property instead of another spelling.
    //
    // The two scripts get DIFFERENT contracts, and asserting `[]` for both was the bug: the
    // dispatcher's entire job is to run an allowlisted command, so it necessarily contains one
    // dispatch site. It passed the `[]` assertion only because `command --` hid it — a vacuous
    // pass on the one file the oracle exists to constrain. Naming the permitted site is a
    // stronger claim than zero: a second one, or a different one, now fails.
    if (f === dispatchScript) {
      assert.deepEqual(dynamicDispatchSites(src), ['$cmd'],
        'the dispatcher has exactly ONE dispatch site, and it is the allowlist-checked $cmd');
      // …and what makes that site safe is the check above it, not the recognizer. If the
      // exact-string comparison ever goes, the single permitted dispatch stops being bounded.
      assert.match(src, /\[ "\$name" = "\$cmd" \]/,
        'and it stays permitted only while $cmd is compared for exact equality against the allowlist');
    } else {
      assert.deepEqual(dynamicDispatchSites(src), [],
        `${f} must not put a variable in command position — what it holds is a runtime fact`);
    }

    // Round 84, Codex P2. Three more shapes the scanner cannot resolve, each measured to be
    // invisible to every oracle above rather than assumed to be. The choice was between a real
    // Bash parser and a ban; a parser would still have to ban the first of them, since its
    // command name is computed at run time and no amount of parsing recovers it. So all three
    // are banned — the same contract `eval` is under, and none is a construct these scripts
    // have any reason to want.
    //
    // Every one is scoped to COMMAND POSITION, which the first drafts were not, and both
    // over-broad versions were caught by this test failing on ordinary code rather than by
    // review: `$'\n'` is how `${REPO_ROOT%$'\n'}` strips exactly one newline from the
    // derivation sentinel, and `SD0X_PRIV_GUARD=''` is an ordinary empty assignment. Neither
    // is a command word, and a check that cannot tell the difference gets suppressed.
    //
    // `$(printf git) --version` runs git with the word `git` nowhere in command position. The
    // first version of this was a source regex listing the delimiters a substitution may
    // follow, and it missed every prefix it did not enumerate — `if`, `while`, `!`, `command`,
    // assignments, leading redirections. splitSegments now tags the segment a `$(` ended, so
    // the check inherits the peeling loop's understanding instead of restating it.
    assert.deepEqual(commandTokens(src).filter((t) => t === '$('), [],
      `${f} must not use command substitution in command position — the command name is computed at run time`);

    // `$"…"` / `$'…'` is locale and ANSI-C quoting: the scanner reads `$` as the start of an
    // expansion, the quote never opens, and `$"/usr/bin/true"` executes while matching no
    // oracle at all. Banned in COMMAND POSITION only, not outright — `$'\n'` is a legitimate
    // and needed operand (`${REPO_ROOT%$'\n'}` strips exactly one newline from the derivation
    // sentinel), and a blanket source scan failed on it. An ANSI-C quoted *operand* is data;
    // only the command word has to be nameable.
    assert.deepEqual(commandTokens(src).filter((t) => /^\$["']/.test(t)), [],
      `${f} must not put a $"…" or $'…' word in command position`);
    // The third shape Codex named — `"/usr/bin"/true`, one word mixing a quoted and an
    // unquoted span — is deliberately NOT banned. It was, briefly, and the ban fired on
    // ordinary code. unquote() now concatenates the spans the way the shell does, so the
    // oracles see through it and no rule is needed. The fixture list above holds that.
  }
});

/* -------------------------------------------------- the procedure lives in one place */

test('execute-mode.md documents the script rather than carrying a second copy', () => {
  const doc = readFileSync(resolve(root, 'skills/smart-commit/references/execute-mode.md'), 'utf8');
  const fences = [...doc.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const reimplements = fences.filter((f) => /\$GUARD|git\s+-C|COMMIT_STATUS|LEAK_STATUS/.test(f));
  assert.deepEqual(reimplements, [],
    'a second copy of the procedure is what drifted from the artifact last time');
  assert.match(doc, /scripts\/smart-commit-execute\.sh/, 'the doc must name the implementation');
});

test('SKILL.md points --execute at the script, not at bash to translate', () => {
  const skill = readFileSync(resolve(root, 'skills/smart-commit/SKILL.md'), 'utf8');
  assert.match(skill, /\/bin\/bash -p -- "\$EXECUTE" commit/,
    'the skill must invoke the checked-in script, privileged and absolutely spelled');
  assert.match(skill, /skills\/smart-commit\/scripts\/smart-commit-execute\.sh/,
    'and resolve it repo-relative, so no variable names the thing that enforces policy');

  // Both docs, both halves of the spelling. A bare `bash` is the shadowing hole and a
  // missing `-p` is the BASH_ENV hole; each has its own executable regression above.
  for (const [name, src] of [
    ['SKILL.md', skill],
    ['execute-mode.md', readFileSync(resolve(root, 'skills/smart-commit/references/execute-mode.md'), 'utf8')],
  ]) {
    for (const call of src.split('\n').filter((l) => /^\s*\S*bash .*"\$EXECUTE"/.test(l))) {
      assert.match(call, /^\s*\/bin\/bash -p -- /,
        `${name}: every policy-script invocation must be \`/bin/bash -p --\`: ${call.trim()}`);
    }
  }

  // The script's own header is a shipped instruction too. It told readers to use a bare
  // `bash` while both docs had been fixed — the assertion above scanned the docs and not
  // the artifact, so a reader following the file itself got the vulnerable spelling.
  for (const f of [execScript, dispatchScript]) {
    const header = readFileSync(f, 'utf8').split('\n').filter((l) => /^#/.test(l)).join('\n');
    assert.doesNotMatch(header, /(?<!\/bin\/)\bbash -p -- </,
      `${f}: a shipped instruction must not spell the entrypoint as a bare \`bash\``);
  }
  // Scoped to the frontmatter value, not the whole file: prose may legitimately mention a
  // grant in order to explain why it is gone, and a whole-file match cannot tell the two
  // apart — it reads the explanation as the thing it forbids.
  const grants = (src) => {
    const fm = src.split('---')[1] ?? '';
    const line = fm.split('\n').find((l) => /^allowed-tools:/.test(l)) ?? '';
    return [...line.matchAll(/Bash\(([^:)]+):\*\)/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual(grants(skill), ['bash', 'env', 'git'],
    'the grants the fenced procedure needed must not outlive it');
  assert.ok(/`Bash\(mktemp:\*\)`/.test(skill) && !grants(skill).includes('mktemp'),
    'prose naming a withdrawn grant must not be read as the grant itself');
});
