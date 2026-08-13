'use strict';
// The four reminder hooks: md out, exit 0 on every path, state check first,
// one git fallback with the ignore-if-done sentence. Contract:
// docs/features/hook-lightweighting/2-tech-spec.md §3.2, §6.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  mkdirSync,
  rmSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = resolve(__dirname, '../..');
const HOOKS = {
  stop: join(ROOT, 'hooks', 'stop-guard.sh'),
  prompt: join(ROOT, 'hooks', 'user-prompt-review-guard.sh'),
  skill: join(ROOT, 'hooks', 'post-skill-auto-loop.sh'),
  compact: join(ROOT, 'hooks', 'post-compact-auto-loop.sh'),
  format: join(ROOT, 'hooks', 'post-edit-format.sh'),
};

const tempDirs = [];
after(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

function git(repo, ...args) {
  execFileSync(
    'git',
    ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

function makeRepo() {
  const repo = tmp('rh-repo-');
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.js'), 'const a = 1;\n');
  writeFileSync(join(repo, 'readme.md'), '# doc\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

function runHook(hookPath, cwd, home, { shell = 'bash', input = '{}' } = {}) {
  return spawnSync(shell, [hookPath], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: '', CLAUDE_PLUGIN_ROOT: '', HOOK_BYPASS: '', GIT_CONFIG_NOSYSTEM: '1' },
  });
}

function noteState(repo, home, plane, verdict) {
  const r = spawnSync('node', [join(ROOT, 'scripts', 'review-state.js'), 'note', plane, verdict], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
}

// A copy of one hook in a bare temp dir has no ../scripts/review-state.js, so
// it must take the git fallback.
function fallbackCopy(name) {
  const dir = tmp('rh-nochecker-');
  mkdirSync(join(dir, 'hooks'));
  const p = join(dir, 'hooks', `${name}.sh`);
  copyFileSync(HOOKS[name === 'stop-guard' ? 'stop' : name === 'user-prompt-review-guard' ? 'prompt' : 'compact'], p);
  chmodSync(p, 0o755);
  return p;
}

test('stop: state-driven — owed planes print, a noted-pass unchanged tree is silent', () => {
  const repo = makeRepo();
  const home = tmp('rh-home-');
  writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
  let r = runHook(HOOKS.stop, repo, home);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /code_review/, 'dirty unnoted code plane is reminded');
  noteState(repo, home, 'code_review', 'pass');
  noteState(repo, home, 'precommit', 'pass');
  r = runHook(HOOKS.stop, repo, home);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'noted-pass on the current digest earns silence');
});

test('stop: checker missing → git fallback prints plane lines with the ignore-if-done sentence', () => {
  const repo = makeRepo();
  const home = tmp('rh-home-');
  writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
  const r = spawnSync('bash', [fallbackCopy('stop-guard')], {
    cwd: repo,
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: '', CLAUDE_PLUGIN_ROOT: '' },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /code 平面有未提交變更/);
  assert.match(r.stdout, /若本輪已完成對應 review gate，忽略此行即可/);
  assert.doesNotMatch(r.stdout, /doc 平面/, 'clean doc plane earns no line');
});

test('fallback classifier: .md/.mdx doc, .MD code, rename dirties both planes, spaces survive -z', () => {
  const repo = makeRepo();
  const home = tmp('rh-home-');
  writeFileSync(join(repo, 'UPPER.MD'), 'not a doc by the case-sensitive rule\n');
  writeFileSync(join(repo, 'with space.mdx'), '# doc\n');
  const hook = fallbackCopy('stop-guard');
  let r = spawnSync('bash', [hook], { cwd: repo, input: '{}', encoding: 'utf8', env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: '', CLAUDE_PLUGIN_ROOT: '' } });
  assert.match(r.stdout, /code 平面/, '.MD is code (case-sensitive, as tree-digest implements)');
  assert.match(r.stdout, /doc 平面/, '.mdx with a space is doc');
  // A staged rename md→js dirties BOTH planes (the union rule).
  const repo2 = makeRepo();
  git(repo2, 'mv', 'readme.md', 'renamed.js');
  r = spawnSync('bash', [hook], { cwd: repo2, input: '{}', encoding: 'utf8', env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: '', CLAUDE_PLUGIN_ROOT: '' } });
  assert.match(r.stdout, /code 平面/, 'rename target dirties code');
  assert.match(r.stdout, /doc 平面/, 'rename source dirties doc');
});

test('user-prompt: fact line from state, source=git_status on fallback, silent when git unreadable', () => {
  const repo = makeRepo();
  const home = tmp('rh-home-');
  let r = runHook(HOOKS.prompt, repo, home);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\[AUTO_LOOP_STATE\] change=none reviews=.* source=state/);
  const noChecker = fallbackCopy('user-prompt-review-guard');
  r = spawnSync('bash', [noChecker], { cwd: repo, input: '{}', encoding: 'utf8', env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: '', CLAUDE_PLUGIN_ROOT: '' } });
  assert.match(r.stdout, /^\[AUTO_LOOP_STATE\] change=none source=git_status/);
  const nonRepo = tmp('rh-nonrepo-');
  r = spawnSync('bash', [noChecker], { cwd: nonRepo, input: '{}', encoding: 'utf8', env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: '', CLAUDE_PLUGIN_ROOT: '', GIT_CEILING_DIRECTORIES: '' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'no git, no claims — silent exit 0');
});

test('post-skill prints its one unconditional line whatever arrived on stdin', () => {
  const repo = makeRepo();
  const home = tmp('rh-home-');
  for (const input of ['{}', '{"tool_response":{"error":"failed"}}', 'not json at all']) {
    const r = runHook(HOOKS.skill, repo, home, { input });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /review → precommit → doc-sync/);
    assert.match(r.stdout, /本行不知道你剛跑了哪個 skill/);
  }
});

test('post-compact: git context + the same gates-owed nudge as stop', () => {
  const repo = makeRepo();
  const home = tmp('rh-home-');
  writeFileSync(join(repo, 'readme.md'), '# doc v2\n');
  const r = runHook(HOOKS.compact, repo, home);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /branch=/);
  assert.match(r.stdout, /readme\.md/, 'uncommitted file list is replayed');
  assert.match(r.stdout, /doc_review/, 'owed plane nudge included');
});

test('every hook exits 0 outside a repository and in an empty dir', () => {
  const nonRepo = tmp('rh-nonrepo-');
  const home = tmp('rh-home-');
  for (const [name, hook] of Object.entries(HOOKS)) {
    const r = runHook(hook, nonRepo, home);
    assert.equal(r.status, 0, `${name} must exit 0 (stderr: ${r.stderr})`);
  }
});

// Same availability guard as test/skills/remind.test.js: the CI runner (ubuntu-latest)
// ships no zsh, and spawnSync on a missing binary returns status null — which reads as
// a hook failure it is not. CI installs zsh explicitly (.github/workflows/ci.yml) so
// the portability guard still runs there; the skip covers other zsh-less environments.
const HAVE_ZSH = (() => {
  try {
    execFileSync('zsh', ['-c', 'exit 0'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test('identical behaviour under zsh and bash (fallback path included)', { skip: !HAVE_ZSH }, () => {
  const repo = makeRepo();
  const home = tmp('rh-home-');
  writeFileSync(join(repo, 'a.js'), 'const a = 2;\n');
  for (const hook of [HOOKS.stop, HOOKS.prompt, fallbackCopy('stop-guard')]) {
    const b = runHook(hook, repo, home, { shell: 'bash' });
    const z = runHook(hook, repo, home, { shell: 'zsh' });
    assert.equal(z.status, b.status, hook);
    assert.equal(z.stdout, b.stdout, hook);
  }
  // Absolute pin so two identically-broken shells cannot agree their way past:
  const b = runHook(HOOKS.stop, repo, home, { shell: 'zsh' });
  assert.match(b.stdout, /code_review/);
});

test('post-edit-format creates and mutates no file beyond the formatted target', () => {
  const repo = makeRepo();
  const home = tmp('rh-home-');
  writeFileSync(join(repo, 'b.js'), 'const b=1\n');
  const before = readdirSync(repo).sort().join(',');
  const r = runHook(HOOKS.format, repo, home, {
    input: JSON.stringify({ tool_input: { file_path: join(repo, 'b.js') } }),
  });
  assert.equal(r.status, 0, r.stderr);
  const after_ = readdirSync(repo).sort().join(',');
  assert.equal(after_, before, 'no mirror, no sidecar, no lock — nothing appears');
});

test('AUTO_LOOP_CHECK_TIMEOUT guard: 0 must not disable the bound (timeout 0 / alarm 0 run unbounded)', () => {
  for (const hook of [HOOKS.stop, HOOKS.prompt, HOOKS.compact]) {
    const src = readFileSync(hook, 'utf8');
    assert.match(src, /\[ "\$_T" -gt 0 \] \|\| _T=10/, `${hook}: strictly-positive timeout guard missing`);
  }
});
