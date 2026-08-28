const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execSync, spawn } = require('node:child_process');

const runnerPath = resolve(__dirname, '../../scripts/precommit-runner.js');
const tempDirs = [];

function createTempRepo(pkgJson, lockfile) {
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-test-'));
  tempDirs.push(dir);
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync(
    'git -c user.name="test" -c user.email="test@test" commit --allow-empty -m "init"',
    { cwd: dir, stdio: 'ignore' }
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkgJson));
  if (lockfile === 'pnpm') writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
  if (lockfile === 'yarn') writeFileSync(join(dir, 'yarn.lock'), '');
  return dir;
}

function writeScript(dir, name, exitCode) {
  const scriptPath = join(dir, name);
  writeFileSync(scriptPath, `#!/bin/sh\nexit ${exitCode}\n`);
  chmodSync(scriptPath, 0o755);
  return `./${name}`;
}

function runPrecommit(dir, mode, extraEnv = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'sd0x-cache-'));
  tempDirs.push(cacheDir);
  // Isolated HOME: the runner's end-of-run reminder note writes to
  // ~/.cache/sd0x-dev-flow/state/<repo-key>/, and the real HOME must never
  // accumulate temp-repo keys.
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  const env = {
    ...process.env,
    CLAUDE_PRECOMMIT_CACHE_DIR: cacheDir,
    HOME: home,
    ...extraEnv,
  };
  const stdout = execSync(`node ${runnerPath} --mode ${mode}`, {
    cwd: dir,
    env,
    encoding: 'utf8',
  });
  const match = stdout.match(/- logs: `([^`]+)`/);
  assert.ok(match, 'log dir not found in output');
  const logDir = match[1];
  const summary = JSON.parse(
    readFileSync(join(logDir, 'summary.json'), 'utf8')
  );
  return { stdout, summary, logDir, home };
}

// The precommit note slot for the single repo a test's isolated HOME saw.
// Returns null when no note was taken (hook-lightweighting §3.3: the
// NO CHECKS RUN terminal takes none).
function readPrecommitSlot(home) {
  const stateRoot = join(home, '.cache', 'sd0x-dev-flow', 'state');
  let keys;
  try {
    keys = require('node:fs').readdirSync(stateRoot);
  } catch {
    return null;
  }
  assert.equal(keys.length, 1, 'exactly one repo-key expected under the isolated HOME');
  try {
    return JSON.parse(readFileSync(join(stateRoot, keys[0], 'precommit.json'), 'utf8'));
  } catch {
    return null;
  }
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('full precommit with all scripts passes', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      'lint:fix': './pass.sh',
      build: './pass.sh',
      'test:unit': './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);

  const { summary } = runPrecommit(dir, 'full');
  assert.equal(summary.overallPass, true);
  assert.deepEqual(
    summary.steps.map(step => step.name),
    ['comment_blocks', 'lint_fix', 'build', 'test_unit']
  );
});

test('missing lint:fix still passes, recorded as explicit skip', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      'test:unit': './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);

  const { summary } = runPrecommit(dir, 'fast');
  assert.equal(summary.overallPass, true);
  assert.deepEqual(
    summary.steps.map(step => step.name),
    ['comment_blocks', 'lint_fix', 'test_unit']
  );
  const lintStep = summary.steps.find(step => step.name === 'lint_fix');
  assert.equal(lintStep.status, 'skip');
  assert.equal(lintStep.reason, 'script missing');
});

test('fallback to test script when test:unit missing', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      test: './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);

  const { stdout, summary } = runPrecommit(dir, 'fast');
  assert.match(stdout, /test: using "test" \(fast mode\)/);
  assert.equal(summary.overallPass, true);
  assert.deepEqual(
    summary.steps.map(step => step.name),
    ['comment_blocks', 'lint_fix', 'test_unit']
  );
  const ran = summary.steps.find(step => step.name === 'test_unit');
  assert.equal(ran.status, undefined, 'test_unit actually ran (not a skip)');
});

test('zero runnable scripts → distinct ⚠️ NO CHECKS RUN sentinel, not ✅ PASS', () => {
  // A repo with no lint:fix/build/test scripts must NOT mint ✅ PASS (that
  // false-greens the merge gate and bypasses the skill's ecosystem fallback)
  // nor ❌ FAIL (that wedges the strict stop gate). It gets a third state that
  // matches neither the hooks' pass grep (^## Overall: ✅ PASS) nor their fail
  // grep, so precommit stays unrecorded (fail-closed) and SKILL.md Step 1 falls
  // through to ecosystem detection.
  const pkg = { name: 'temp', version: '1.0.0', scripts: {} };
  const dir = createTempRepo(pkg);

  const { stdout, summary } = runPrecommit(dir, 'full');
  assert.equal(summary.overallPass, false, 'all-skip is not a verified pass');
  assert.ok(summary.steps.length > 0, 'skips must be recorded, not dropped');
  assert.ok(summary.steps.every(step => step.status === 'skip'));
  assert.match(stdout, /## Overall: ⚠️ NO CHECKS RUN/);
  assert.doesNotMatch(stdout, /## Overall: ✅ PASS/, 'must not prefix-match the pass sentinel');
  assert.doesNotMatch(stdout, /❌ FAIL/, 'must not read as a hard failure (would wedge)');
});

test('mix of skipped + passing steps → ✅ PASS (skips ignored, real step ran)', () => {
  // The all-skip guard must not regress the normal case: if at least one real
  // step runs and passes, skips are ignored and the gate passes.
  const pkg = { name: 'temp', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' } };
  const dir = createTempRepo(pkg);

  const { stdout, summary } = runPrecommit(dir, 'full');
  assert.equal(summary.overallPass, true);
  assert.match(stdout, /## Overall: ✅ PASS/);
});

test('build failure makes overallPass false', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      'lint:fix': './pass.sh',
      build: './fail.sh',
      'test:unit': './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  writeScript(dir, 'fail.sh', 1);

  const { summary } = runPrecommit(dir, 'full');
  assert.equal(summary.overallPass, false);
  const buildStep = summary.steps.find(step => step.name === 'build');
  assert.ok(buildStep, 'build step missing');
  assert.equal(buildStep.code, 1);
});

test('fast mode skips build step', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      'lint:fix': './pass.sh',
      build: './pass.sh',
      'test:unit': './pass.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);

  const { summary } = runPrecommit(dir, 'fast');
  assert.equal(summary.overallPass, true);
  const buildStep = summary.steps.find(step => step.name === 'build');
  assert.equal(buildStep, undefined, 'build step should not exist in fast mode');
  assert.deepEqual(
    summary.steps.map(step => step.name),
    ['comment_blocks', 'lint_fix', 'test_unit']
  );
});

// --- Test tiering preference chain tests ---

test('fast mode prefers test:fast over test:unit', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      'test:fast': './pass.sh',
      'test:unit': './fail.sh',
      test: './fail.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  writeScript(dir, 'fail.sh', 1);

  const { stdout, summary } = runPrecommit(dir, 'fast');
  assert.equal(summary.overallPass, true, 'should run test:fast (pass) not test:unit (fail)');
  assert.match(stdout, /test: using "test:fast" \(fast mode\)/);
});

test('fast mode falls back to test:unit when no test:fast', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      'test:unit': './pass.sh',
      test: './fail.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  writeScript(dir, 'fail.sh', 1);

  const { summary } = runPrecommit(dir, 'fast');
  assert.equal(summary.overallPass, true, 'should run test:unit (pass) not test (fail)');
});

test('full mode prefers test:ci over test', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      'test:ci': './pass.sh',
      test: './fail.sh',
      'test:unit': './fail.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  writeScript(dir, 'fail.sh', 1);

  const { stdout, summary } = runPrecommit(dir, 'full');
  assert.equal(summary.overallPass, true, 'should run test:ci (pass) not test (fail)');
  assert.match(stdout, /test: using "test:ci" \(full mode\)/);
});

test('full mode falls back to test when no test:ci', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      test: './pass.sh',
      'test:unit': './fail.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  writeScript(dir, 'fail.sh', 1);

  const { stdout, summary } = runPrecommit(dir, 'full');
  assert.equal(summary.overallPass, true, 'should run test (pass) not test:unit (fail)');
  assert.match(stdout, /test: using "test" \(full mode\)/);
});

test('full mode falls back to test:fast when no test:ci or test', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: {
      'test:fast': './pass.sh',
      'test:unit': './fail.sh',
    },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  writeScript(dir, 'fail.sh', 1);

  const { stdout, summary } = runPrecommit(dir, 'full');
  assert.equal(summary.overallPass, true, 'should run test:fast (pass) not test:unit (fail)');
  assert.match(stdout, /test: using "test:fast" \(full mode\)/);
});

// --- comment_blocks step ---

const { mkdirSync, copyFileSync } = require('node:fs');
const checkerSrc = resolve(__dirname, '../../scripts/check-comment-blocks.js');

test('comment_blocks is skipped, not failed, when the checker is not checked in', () => {
  // A consuming project has no hooks/scripts/skills tree. The checker exits 2 on
  // such a root, so wiring it unconditionally would FAIL every such precommit.
  const pkg = { name: 'temp', version: '1.0.0', scripts: { 'test:unit': './pass.sh' } };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);

  const { summary } = runPrecommit(dir, 'fast');
  assert.equal(summary.overallPass, true);
  const step = summary.steps.find(s => s.name === 'comment_blocks');
  assert.equal(step.status, 'skip');
  assert.equal(step.reason, 'checker missing');
});

test('comment_blocks ignores the INSTALLED checker at .claude/scripts/', () => {
  // The consuming-project case the skip above only half covered. `/install-scripts` copies this
  // plugin's `scripts/*.js` into `.claude/scripts/`, so a project that ran it HAS the checker —
  // and if it also has an ordinary top-level `scripts/` dir (a Python or Rust repo very well
  // might), honouring the installed copy runs this plugin's 30-line convention over that project's
  // own code and can fail its precommit on a rule it never adopted. The checker's scan dirs are
  // the repo's own hooks/scripts/skills; `.claude/` is exempt, so it never even reads the copy's
  // own directory. Opting in means vendoring the checker into your own `scripts/` — asserted as
  // the negative control by the tests below, which do exactly that and DO run the step.
  const pkg = { name: 'temp', version: '1.0.0', scripts: { 'test:unit': './pass.sh' } };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  mkdirSync(join(dir, '.claude', 'scripts'), { recursive: true });
  copyFileSync(checkerSrc, join(dir, '.claude', 'scripts', 'check-comment-blocks.js'));
  // A top-level scripts/ dir holding a block this plugin would call blocking.
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(
    join(dir, 'scripts', 'their-own-tool.js'),
    `${Array.from({ length: 40 }, (_, i) => `// their rationale line ${i + 1}`).join('\n')}\ncode();\n`
  );

  const { summary } = runPrecommit(dir, 'fast');
  const step = summary.steps.find(s => s.name === 'comment_blocks');
  assert.equal(step.status, 'skip', 'the installed copy must not opt a consuming project in');
  assert.equal(step.reason, 'checker missing');
  assert.equal(summary.overallPass, true, "and their precommit must not fail on this plugin's convention");
});

test('comment_blocks fails precommit when a ≥30-line logical block exists', () => {
  // Negative control for the skip above: the step must be able to fail, or
  // "always skipped" would be indistinguishable from "wired and working".
  const pkg = { name: 'temp', version: '1.0.0', scripts: { 'test:unit': './pass.sh' } };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(checkerSrc, join(dir, 'scripts', 'check-comment-blocks.js'));
  // 23 comment lines + blank + 12 more: two compliant contiguous runs, one
  // 35-line logical block.
  const head = Array.from({ length: 23 }, (_, i) => `# rationale ${i + 1}`).join('\n');
  const tail = Array.from({ length: 12 }, (_, i) => `# more ${i + 1}`).join('\n');
  writeFileSync(join(dir, 'scripts', 'offender.sh'), `${head}\n\n${tail}\nrun_it\n`);

  // The runner never exits non-zero — the verdict travels in the column-0
  // `## Overall:` sentinel, so that "ran and failed" stays distinguishable from
  // "the runner crashed". Assert the sentinel, not the exit code.
  const { stdout, summary } = runPrecommit(dir, 'fast');
  assert.equal(summary.overallPass, false);
  assert.match(stdout, /^## Overall: ❌ FAIL$/m);
  const step = summary.steps.find(s => s.name === 'comment_blocks');
  assert.notEqual(step.code, 0, 'the comment_blocks step is the one that failed');
});

test('comment_blocks passes when every block is under the threshold', () => {
  const pkg = { name: 'temp', version: '1.0.0', scripts: { 'test:unit': './pass.sh' } };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(checkerSrc, join(dir, 'scripts', 'check-comment-blocks.js'));
  const body = Array.from({ length: 10 }, (_, i) => `# rationale ${i + 1}`).join('\n');
  writeFileSync(join(dir, 'scripts', 'fine.sh'), `${body}\nrun_it\n`);

  const { summary } = runPrecommit(dir, 'fast');
  assert.equal(summary.overallPass, true);
  const step = summary.steps.find(s => s.name === 'comment_blocks');
  assert.equal(step.code, 0);
});

test('comment_blocks alone does not satisfy "some validation ran"', () => {
  // A consuming project in another ecosystem (pytest/cargo/go) that happens to have a top-level
  // scripts/ dir: the checker runs and passes, every npm script skips. Counting the policy step
  // as validation banked a ✅ PASS with the project's own checks never invoked — the
  // exact false-green the three-state sentinel exists to prevent.
  const pkg = { name: 'temp', version: '1.0.0', scripts: {} };
  const dir = createTempRepo(pkg);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(checkerSrc, join(dir, 'scripts', 'check-comment-blocks.js'));

  const { stdout, summary } = runPrecommit(dir, 'fast');
  const step = summary.steps.find(s => s.name === 'comment_blocks');
  assert.equal(step.code, 0, 'the policy step itself ran and passed');
  assert.equal(summary.overallPass, false, 'but nothing was validated');
  assert.match(stdout, /^## Overall: ⚠️ NO CHECKS RUN/m);
});

test('a FAILING comment_blocks is a FAIL, never swallowed by NO CHECKS RUN', () => {
  // Negative control for the exclusion above: excluding policy steps from "did anything run" must
  // not also exclude them from "did anything fail". This one is deliberately NOT a control for the
  // policy-step concept — it stays green if `isPolicyStep` is reverted to always-false, because the
  // test above is what covers that direction. What it kills is dropping `&& !policyFailed` from the
  // sentinel, which turns a real policy failure into "nothing ran".
  const pkg = { name: 'temp', version: '1.0.0', scripts: {} };
  const dir = createTempRepo(pkg);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(checkerSrc, join(dir, 'scripts', 'check-comment-blocks.js'));
  const body = Array.from({ length: 35 }, (_, i) => `# rationale ${i + 1}`).join('\n');
  writeFileSync(join(dir, 'scripts', 'offender.sh'), `${body}\nrun_it\n`);

  const { stdout, summary } = runPrecommit(dir, 'fast');
  assert.equal(summary.overallPass, false);
  assert.match(stdout, /^## Overall: ❌ FAIL$/m);
  assert.ok(!stdout.includes('NO CHECKS RUN'), 'a policy failure must not read as "nothing ran"');
});

// --- Multi-ecosystem orchestration (WB2b) ---
//
// Hermeticity: every known ecosystem binary is stubbed in a bin dir PREPENDED
// to PATH, defaulting to "record + exit 127" — a host installation can never
// leak through, an unexpected invocation fails the step that made it, and a
// 127 probe is indistinguishable from an absent tool. Stubs record their argv
// to a file OUTSIDE the repo, so a recording never shows up as a tree change
// in the changed-files section or the note's digest.

const treeDigest = require('../../scripts/lib/tree-digest');
const { realpathSync } = require('node:fs');

const ECO_BINS = ['ruff', 'pytest', 'cargo', 'go', 'golangci-lint', 'mvn', 'bundle'];

function stubEcoTool(bin, name, body = 'exit 0') {
  const record = join(bin, 'record.txt');
  const p = join(bin, name);
  writeFileSync(
    p,
    `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${record}"\n${body}\n`
  );
  chmodSync(p, 0o755);
  return p;
}

function makeToolBin() {
  const bin = mkdtempSync(join(tmpdir(), 'sd0x-bin-'));
  tempDirs.push(bin);
  const record = join(bin, 'record.txt');
  writeFileSync(record, '');
  for (const b of ECO_BINS) stubEcoTool(bin, b, 'exit 127');
  return { bin, record };
}

function stubWrapper(dir, record, body = 'exit 0') {
  const p = join(dir, 'gradlew');
  writeFileSync(
    p,
    `#!/bin/sh\nprintf '%s %s\\n' "gradlew" "$*" >> "${record}"\n${body}\n`
  );
  chmodSync(p, 0o755);
}

function recordedLines(record) {
  return readFileSync(record, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

function pathEnv(bin) {
  return { PATH: `${bin}:${process.env.PATH}` };
}

// One row per Skill-table ecosystem, both modes: pins the exact step list AND
// the exact probe + execution argv, so a drifted command, a dropped probe, or
// a build step leaking into fast mode all fail here.
const ECO_MATRIX = [
  {
    eco: 'python',
    tools: ['ruff', 'pytest'],
    setup(dir) {
      writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
      mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
    },
    steps: {
      full: ['python_lint_fix', 'python_test'],
      fast: ['python_lint_fix', 'python_test'],
    },
    argv: {
      full: ['ruff --version', 'pytest --version', 'ruff check --fix .', 'pytest tests/unit'],
      fast: ['ruff --version', 'pytest --version', 'ruff check --fix .', 'pytest tests/unit'],
    },
  },
  {
    eco: 'rust',
    tools: ['cargo'],
    setup(dir) {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "t"\n');
    },
    steps: {
      full: ['rust_lint_fix', 'rust_build', 'rust_test'],
      fast: ['rust_lint_fix', 'rust_test'],
    },
    argv: {
      full: [
        'cargo clippy --version',
        'cargo --version',
        'cargo clippy --fix --allow-dirty --allow-staged',
        'cargo build',
        'cargo test',
      ],
      fast: [
        'cargo clippy --version',
        'cargo --version',
        'cargo clippy --fix --allow-dirty --allow-staged',
        'cargo test',
      ],
    },
  },
  {
    eco: 'go',
    tools: ['go', 'golangci-lint'],
    setup(dir) {
      writeFileSync(join(dir, 'go.mod'), 'module t\n');
    },
    steps: {
      full: ['go_lint_fix', 'go_build', 'go_test'],
      fast: ['go_lint_fix', 'go_test'],
    },
    argv: {
      full: [
        'golangci-lint version',
        'go version',
        'golangci-lint run --fix',
        'go build ./...',
        'go test ./...',
      ],
      fast: [
        'golangci-lint version',
        'go version',
        'golangci-lint run --fix',
        'go test ./...',
      ],
    },
  },
  {
    eco: 'gradle',
    tools: [],
    wrapper: true,
    setup(dir) {
      writeFileSync(join(dir, 'build.gradle'), 'plugins {}\n');
    },
    steps: {
      full: ['gradle_lint_fix', 'gradle_build', 'gradle_test'],
      fast: ['gradle_lint_fix', 'gradle_test'],
    },
    argv: {
      full: [
        'gradlew help --task spotlessApply',
        'gradlew spotlessApply',
        'gradlew build',
        'gradlew test',
      ],
      fast: [
        'gradlew help --task spotlessApply',
        'gradlew spotlessApply',
        'gradlew test',
      ],
    },
  },
  {
    eco: 'maven',
    tools: ['mvn'],
    setup(dir) {
      writeFileSync(join(dir, 'pom.xml'), '<project/>\n');
    },
    steps: {
      full: ['maven_lint_fix', 'maven_build', 'maven_test'],
      fast: ['maven_lint_fix', 'maven_test'],
    },
    argv: {
      full: [
        'mvn --version',
        'mvn help:describe -Dplugin=spotless -q',
        'mvn spotless:apply',
        'mvn compile',
        'mvn test',
      ],
      fast: [
        'mvn --version',
        'mvn help:describe -Dplugin=spotless -q',
        'mvn spotless:apply',
        'mvn test',
      ],
    },
  },
  {
    eco: 'ruby',
    tools: ['bundle'],
    setup(dir) {
      writeFileSync(join(dir, 'Gemfile'), "source 'https://rubygems.org'\n");
      // Membership is read from Gemfile.lock text (round-2 finding), so the
      // fixture declares both gems in the lockfile's specs section — the
      // 4-space indent is Bundler's own format and what the matcher anchors on.
      writeFileSync(join(dir, 'Gemfile.lock'), rubyLockfile(['rubocop', 'rspec']));
    },
    steps: {
      full: ['ruby_lint_fix', 'ruby_test'],
      fast: ['ruby_lint_fix', 'ruby_test'],
    },
    argv: {
      full: [
        'bundle --version',
        'bundle check',
        'bundle exec rubocop -a',
        'bundle exec rspec',
      ],
      fast: [
        'bundle --version',
        'bundle check',
        'bundle exec rubocop -a',
        'bundle exec rspec',
      ],
    },
  },
];

function rubyLockfile(gems) {
  const specs = gems.map(g => `    ${g} (1.0.0)`).join('\n');
  return `GEM\n  remote: https://rubygems.org/\n  specs:\n${specs}\n\nPLATFORMS\n  ruby\n\nDEPENDENCIES\n${gems.map(g => `  ${g}`).join('\n')}\n`;
}

for (const row of ECO_MATRIX) {
  for (const mode of ['full', 'fast']) {
    test(`${row.eco} ${mode} mode: exact step and argv parity with the Skill table`, () => {
      const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
      row.setup(dir);
      const { bin, record } = makeToolBin();
      for (const t of row.tools) stubEcoTool(bin, t);
      if (row.wrapper) stubWrapper(dir, record);

      const { stdout, summary } = runPrecommit(dir, mode, pathEnv(bin));
      assert.match(stdout, new RegExp(`> ecosystems: ${row.eco}`));
      assert.equal(summary.overallPass, true);
      const ranEco = summary.steps
        .filter(s => s.status === undefined && s.name !== 'comment_blocks')
        .map(s => s.name);
      assert.deepEqual(ranEco, row.steps[mode]);
      assert.deepEqual(recordedLines(record), row.argv[mode]);
    });
  }
}

test('a genuinely non-Node repo (no package.json) runs its ecosystem and records the pass note through the runner', () => {
  // Every other ecosystem fixture is built through createTempRepo(), which
  // always writes a package.json — a mutation that quietly required one would
  // stay green without this repo-shaped negative (AC2's non-Node parity clause).
  const dir = mkdtempSync(join(tmpdir(), 'sd0x-nonnode-'));
  tempDirs.push(dir);
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync(
    'git -c user.name="test" -c user.email="test@test" commit --allow-empty -m "init"',
    { cwd: dir, stdio: 'ignore' }
  );
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'ruff');
  stubEcoTool(bin, 'pytest');

  const { stdout, summary, home } = runPrecommit(dir, 'full', pathEnv(bin));
  assert.match(stdout, /> ecosystems: python/);
  assert.equal(summary.overallPass, true);
  assert.match(stdout, /\[REVIEW_STATE\] precommit /, 'the note is echoed into the summary output');
  const slot = readPrecommitSlot(home);
  assert.ok(slot, 'a conclusive PASS takes a note');
  assert.equal(slot.verdict, 'pass');
  assert.equal(slot.rounds, 0);
  assert.equal(
    slot.digest,
    treeDigest.computeTreeState(realpathSync(dir)).planes.code.digest,
    'the note binds the code-plane digest of the tree it verified'
  );
});

test('a missing required tool blocks PASS even when another check passes', () => {
  // The false-green the `unavailable` state exists to prevent: pytest green
  // while ruff is not installed must NOT mint a PASS.
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'pytest'); // ruff stays at the exit-127 default

  const { stdout, summary, home } = runPrecommit(dir, 'full', pathEnv(bin));
  assert.equal(summary.overallPass, false);
  assert.match(stdout, /^## Overall: ❌ FAIL$/m);
  assert.match(stdout, /required tools unavailable: python_lint_fix \(tool missing: ruff\)/);
  const lint = summary.steps.find(s => s.name === 'python_lint_fix');
  assert.equal(lint.status, 'unavailable');
  // Exact contract, not a vacuous "no pass": a conclusive FAIL takes a fail
  // note — negative evidence names what it observed, and the rounds counter
  // starts ticking (hook-lightweighting §3.3).
  const slot = readPrecommitSlot(home);
  assert.ok(slot, 'a conclusive FAIL takes a note');
  assert.equal(slot.verdict, 'fail');
  assert.equal(slot.rounds, 1);
});

test('every ecosystem tool missing → all steps unavailable, ⚠️ NO CHECKS RUN, no note', () => {
  // Nothing could run at all: fail-closed to the sentinel that routes to the
  // Skill's human-facing fallback, and no note in either direction — an
  // all-skip run is not evidence (hook-lightweighting §3.3, the third
  // terminal).
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  const { bin } = makeToolBin(); // all stubs exit 127

  const { stdout, summary, home } = runPrecommit(dir, 'full', pathEnv(bin));
  assert.equal(summary.overallPass, false);
  const lint = summary.steps.find(s => s.name === 'python_lint_fix');
  const test_ = summary.steps.find(s => s.name === 'python_test');
  assert.equal(lint.status, 'unavailable');
  assert.equal(lint.reason, 'tool missing: ruff');
  assert.equal(test_.status, 'unavailable');
  assert.equal(test_.reason, 'tool missing: pytest');
  assert.match(stdout, /^## Overall: ⚠️ NO CHECKS RUN/m);
  assert.equal(readPrecommitSlot(home), null, 'NO CHECKS RUN takes no note');
});

test('pytest falls back to bare config-driven discovery when tests/unit is absent', () => {
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  const { bin, record } = makeToolBin();
  stubEcoTool(bin, 'ruff');
  stubEcoTool(bin, 'pytest');

  const { summary } = runPrecommit(dir, 'fast', pathEnv(bin));
  assert.equal(summary.overallPass, true);
  assert.deepEqual(recordedLines(record), [
    'ruff --version',
    'pytest --version',
    'ruff check --fix .',
    'pytest',
  ]);
});

test('ruby: an uninstalled bundle is unavailable, not a skip', () => {
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'Gemfile'), "source 'https://rubygems.org'\n");
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'bundle', 'case "$1" in check) exit 1;; esac\nexit 0');

  const { stdout, summary } = runPrecommit(dir, 'full', pathEnv(bin));
  for (const name of ['ruby_lint_fix', 'ruby_test']) {
    const s = summary.steps.find(x => x.name === name);
    assert.equal(s.status, 'unavailable', `${name} must be unavailable`);
    assert.equal(s.reason, 'bundle install not run (bundle check failed)');
  }
  assert.match(stdout, /^## Overall: ⚠️ NO CHECKS RUN/m);
});

test('ruby: a gem absent from Gemfile.lock is an ordinary skip that does not block PASS', () => {
  // Negative control for the unavailable state: a repo-declared opt-out
  // (rubocop not in the lockfile) must stay an ordinary skip — otherwise every
  // rubocop-less Ruby repo could never pass. Membership comes from the
  // lockfile text, never from probing the environment (round-2 finding).
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'Gemfile'), "source 'https://rubygems.org'\n");
  writeFileSync(join(dir, 'Gemfile.lock'), rubyLockfile(['rspec']));
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'bundle');

  const { summary } = runPrecommit(dir, 'full', pathEnv(bin));
  const lint = summary.steps.find(s => s.name === 'ruby_lint_fix');
  assert.equal(lint.status, 'skip');
  assert.equal(lint.reason, 'rubocop not in bundle');
  const test_ = summary.steps.find(s => s.name === 'ruby_test');
  assert.equal(test_.code, 0, 'rspec ran');
  assert.equal(summary.overallPass, true);
});

test('ruby: an rspec-rails lockfile with no bare rspec metagem still runs the suite', () => {
  // The executable-provider case (round-3 finding): `bundle exec rspec`
  // ships in rspec-core, and a typical rspec-rails lockfile lists the
  // rspec-* family without the bare `rspec` metagem — exact-name matching
  // would silently skip a real test suite.
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'Gemfile'), "source 'https://rubygems.org'\n");
  writeFileSync(
    join(dir, 'Gemfile.lock'),
    rubyLockfile(['rspec-core', 'rspec-expectations', 'rspec-mocks', 'rspec-rails'])
  );
  const { bin, record } = makeToolBin();
  stubEcoTool(bin, 'bundle');

  const { summary } = runPrecommit(dir, 'full', pathEnv(bin));
  const test_ = summary.steps.find(s => s.name === 'ruby_test');
  assert.equal(test_.code, 0, 'rspec ran via rspec-core membership');
  assert.ok(
    recordedLines(record).includes('bundle exec rspec'),
    'the suite was actually executed'
  );
  const lint = summary.steps.find(s => s.name === 'ruby_lint_fix');
  assert.equal(lint.status, 'skip', 'rubocop absent stays an ordinary skip');
  assert.equal(summary.overallPass, true);
});

test('ruby: a missing Gemfile.lock is unavailable — membership unknown is not an opt-out', () => {
  // The differential twin of the skip above: bundle check green but no
  // readable lockfile means the runner cannot prove non-membership, and
  // ambiguity fails closed.
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'Gemfile'), "source 'https://rubygems.org'\n");
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'bundle');

  const { summary } = runPrecommit(dir, 'full', pathEnv(bin));
  for (const name of ['ruby_lint_fix', 'ruby_test']) {
    const s = summary.steps.find(x => x.name === name);
    assert.equal(s.status, 'unavailable', `${name} must be unavailable`);
    assert.equal(s.reason, 'Gemfile.lock unreadable (membership unknown)');
  }
  assert.equal(summary.overallPass, false);
});

test('polyglot repo: node and rust steps coexist, all lint-fix before build/test', () => {
  const dir = createTempRepo({
    name: 'temp',
    version: '1.0.0',
    scripts: { test: './pass.sh' },
  });
  writeScript(dir, 'pass.sh', 0);
  writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "t"\n');
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'cargo');

  const { stdout, summary } = runPrecommit(dir, 'full', pathEnv(bin));
  assert.match(stdout, /> ecosystems: rust/);
  assert.equal(summary.overallPass, true);
  const names = summary.steps.map(s => s.name);
  assert.deepEqual(names, [
    'comment_blocks',
    'lint_fix',
    'rust_lint_fix',
    'build',
    'rust_build',
    'test_unit',
    'rust_test',
  ]);
  // The changed-files capture depends on this grouping: no lint-fix step may
  // appear after any build/test step.
  const lastLint = names.reduce((a, n, i) => (n.endsWith('lint_fix') ? i : a), -1);
  const firstValidation = names.findIndex(
    n => n.includes('build') || n.includes('test')
  );
  assert.ok(lastLint < firstValidation, 'lint phase must precede build/test');
});

test('a failing ecosystem step fails the run', () => {
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'ruff');
  stubEcoTool(bin, 'pytest', 'case "$1" in --version) exit 0;; esac\nexit 1');

  const { stdout, summary } = runPrecommit(dir, 'full', pathEnv(bin));
  assert.equal(summary.overallPass, false);
  assert.match(stdout, /^## Overall: ❌ FAIL$/m);
  const test_ = summary.steps.find(s => s.name === 'python_test');
  assert.equal(test_.code, 1);
});

test('gradle without a wrapper is unavailable, never a fallback to global gradle', () => {
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'build.gradle'), 'plugins {}\n');

  const { summary } = runPrecommit(dir, 'full');
  for (const name of ['gradle_lint_fix', 'gradle_build', 'gradle_test']) {
    const s = summary.steps.find(x => x.name === name);
    assert.equal(s.status, 'unavailable', `${name} must be unavailable`);
    assert.equal(s.reason, 'tool missing: gradle wrapper (gradlew)');
  }
  assert.equal(summary.overallPass, false);
});

test('gradle: the task-not-found marker is the only spotless opt-out; build/test still run', () => {
  // Definitive-marker discovery (round-3): the skip requires Gradle's own
  // "Task 'spotlessApply' not found" diagnostic in the probe output — an
  // exit code alone proves nothing about the task.
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'build.gradle'), 'plugins {}\n');
  const { bin, record } = makeToolBin();
  stubWrapper(
    dir,
    record,
    'case "$*" in "help --task spotlessApply") echo "Task \'spotlessApply\' not found in root project \'t\'."; exit 1;; esac\nexit 0'
  );

  const { summary } = runPrecommit(dir, 'full', pathEnv(bin));
  const lint = summary.steps.find(s => s.name === 'gradle_lint_fix');
  assert.equal(lint.status, 'skip');
  assert.equal(lint.reason, 'spotless task not found');
  const build = summary.steps.find(s => s.name === 'gradle_build');
  const test_ = summary.steps.find(s => s.name === 'gradle_test');
  assert.equal(build.code, 0, 'gradle_build ran via the wrapper');
  assert.equal(test_.code, 0, 'gradle_test ran via the wrapper');
  assert.equal(summary.overallPass, true);
});

test('gradle: a marker-less probe failure is unavailable — a broken task is not an opt-out', () => {
  // Gradle realizes tasks lazily, so a configured-but-broken spotlessApply
  // fails `help --task` exactly like an absent one — except without the
  // task-not-found marker. Ambiguity fails closed; build/test still run so
  // whatever broke fails loudly on its own step.
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'build.gradle'), 'plugins {}\n');
  const { bin, record } = makeToolBin();
  stubWrapper(
    dir,
    record,
    'case "$*" in "help --task spotlessApply") exit 1;; esac\nexit 0'
  );

  const { summary } = runPrecommit(dir, 'full', pathEnv(bin));
  const lint = summary.steps.find(s => s.name === 'gradle_lint_fix');
  assert.equal(lint.status, 'unavailable');
  assert.equal(lint.reason, 'gradle spotless probe failed (ambiguous)');
  const build = summary.steps.find(s => s.name === 'gradle_build');
  assert.equal(build.code, 0, 'gradle_build still ran');
  assert.equal(summary.overallPass, false, 'unavailable blocks PASS');
});

test('maven: definitive plugin absence (marker on output) is a skip; build/test pass', () => {
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pom.xml'), '<project/>\n');
  const { bin } = makeToolBin();
  stubEcoTool(
    bin,
    'mvn',
    'case "$1" in help:describe) echo "No plugin found for prefix \'spotless\'"; exit 1;; esac\nexit 0'
  );

  const { summary } = runPrecommit(dir, 'full', pathEnv(bin));
  const lint = summary.steps.find(s => s.name === 'maven_lint_fix');
  assert.equal(lint.status, 'skip');
  assert.equal(lint.reason, 'spotless plugin not resolvable');
  const build = summary.steps.find(s => s.name === 'maven_build');
  const test_ = summary.steps.find(s => s.name === 'maven_test');
  assert.equal(build.code, 0);
  assert.equal(test_.code, 0);
  assert.equal(summary.overallPass, true);
});

test('maven: a silent probe failure is unavailable — no marker, no opt-out', () => {
  // Network/repository/plugin-resolution failures exit non-zero WITHOUT
  // Maven's "No plugin found for prefix" marker; treating them as opt-outs
  // would skip a check the repo declared (round-2 finding).
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pom.xml'), '<project/>\n');
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'mvn', 'case "$1" in help:describe) exit 1;; esac\nexit 0');

  const { summary } = runPrecommit(dir, 'full', pathEnv(bin));
  const lint = summary.steps.find(s => s.name === 'maven_lint_fix');
  assert.equal(lint.status, 'unavailable');
  assert.equal(lint.reason, 'mvn spotless probe failed (ambiguous)');
  assert.equal(summary.overallPass, false, 'unavailable blocks PASS');
});

test('a hung probe is killed at PRECOMMIT_PROBE_TIMEOUT_MS and reads as unavailable', () => {
  // Bounded probes (round-2/3): a wedged toolchain must not hang the gate,
  // AND the kill must reach the probe's grandchildren (round-3 — wrapper
  // scripts fork their real tool; a survivor would keep running beside the
  // real steps and could mutate the tree while they read it). The stub forks
  // a 30s sleeper and records its PID so the test can prove the whole
  // process group died, not just the shell.
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  const { bin } = makeToolBin();
  const pidFile = join(bin, 'sleeper.pid');
  stubEcoTool(bin, 'ruff', `sleep 30 &\necho $! > "${pidFile}"\nwait\nexit 0`);
  stubEcoTool(bin, 'pytest');

  const started = Date.now();
  // 3s budget, not a razor-thin one: under full-suite parallel load a shell
  // can take >500ms just to start, and killing the stub before it records
  // its sleeper PID starves the grandchild assertion below of its evidence.
  const { summary } = runPrecommit(dir, 'fast', {
    ...pathEnv(bin),
    PRECOMMIT_PROBE_TIMEOUT_MS: '3000',
  });
  assert.ok(Date.now() - started < 20000, 'the probe was killed, not awaited');
  const lint = summary.steps.find(s => s.name === 'python_lint_fix');
  assert.equal(lint.status, 'unavailable');
  assert.equal(lint.reason, 'tool missing: ruff');
  assert.equal(summary.overallPass, false);
  const sleeperPid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  assert.ok(Number.isInteger(sleeperPid) && sleeperPid > 0, 'stub recorded its sleeper');
  let sleeperAlive = true;
  try {
    process.kill(sleeperPid, 0);
  } catch (e) {
    sleeperAlive = e.code !== 'ESRCH';
  }
  assert.equal(sleeperAlive, false, 'the grandchild died with its process group');
});

function pidDead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return e.code === 'ESRCH';
  }
}

async function waitFor(cond, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('terminating the runner kills live probe groups — no orphaned grandchildren (round-4)', { skip: process.platform === 'win32' }, async () => {
  // The timeout callback dies with the parent, so external termination
  // (Ctrl-C, an automation layer's SIGTERM) needs its own path: the signal
  // handler forwards a group kill to every live probe before exiting. The
  // stub records both its own PID and its forked sleeper's so the test can
  // prove the whole group died, not just the direct child.
  const { existsSync } = require('node:fs');
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  const { bin } = makeToolBin();
  const shellPidFile = join(bin, 'shell.pid');
  const sleeperPidFile = join(bin, 'sleeper2.pid');
  stubEcoTool(
    bin,
    'ruff',
    `echo $$ > "${shellPidFile}"\nsleep 30 &\necho $! > "${sleeperPidFile}"\nwait\nexit 0`
  );
  stubEcoTool(bin, 'pytest');
  const cacheDir = mkdtempSync(join(tmpdir(), 'sd0x-cache-'));
  tempDirs.push(cacheDir);

  const runner = spawn(process.execPath, [runnerPath, '--mode', 'fast'], {
    cwd: dir,
    env: {
      ...process.env,
      CLAUDE_PRECOMMIT_CACHE_DIR: cacheDir,
      PATH: `${bin}:${process.env.PATH}`,
      PRECOMMIT_PROBE_TIMEOUT_MS: '60000', // far past the test — the SIGNAL must do the reaping
    },
    stdio: 'ignore',
  });
  let exited = false;
  runner.on('exit', () => {
    exited = true;
  });

  await waitFor(
    () => existsSync(shellPidFile) && existsSync(sleeperPidFile),
    15000,
    'the probe to record its PIDs'
  );
  const shellPid = parseInt(readFileSync(shellPidFile, 'utf8').trim(), 10);
  const sleeperPid = parseInt(readFileSync(sleeperPidFile, 'utf8').trim(), 10);
  assert.ok(shellPid > 0 && sleeperPid > 0, 'both PIDs recorded');

  runner.kill('SIGTERM');
  await waitFor(() => exited, 10000, 'the runner to exit on SIGTERM');
  await waitFor(
    () => pidDead(shellPid) && pidDead(sleeperPid),
    5000,
    'the probe group to die with the runner'
  );
});

// Per-ecosystem unavailable permutations: every required-tool hole reads as
// `unavailable` with its exact reason — never a skip, never a silent pass.
// (Python's permutation is pinned by the two dedicated tests above.)
const UNAVAILABLE_MATRIX = [
  {
    eco: 'rust',
    setup(dir) {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "t"\n');
    },
    expect: {
      rust_lint_fix: 'tool missing: cargo clippy',
      rust_build: 'tool missing: cargo',
      rust_test: 'tool missing: cargo',
    },
  },
  {
    eco: 'go',
    setup(dir) {
      writeFileSync(join(dir, 'go.mod'), 'module t\n');
    },
    expect: {
      go_lint_fix: 'tool missing: golangci-lint',
      go_build: 'tool missing: go',
      go_test: 'tool missing: go',
    },
  },
  {
    eco: 'maven',
    setup(dir) {
      writeFileSync(join(dir, 'pom.xml'), '<project/>\n');
    },
    expect: {
      maven_lint_fix: 'tool missing: mvn',
      maven_build: 'tool missing: mvn',
      maven_test: 'tool missing: mvn',
    },
  },
  {
    eco: 'ruby',
    setup(dir) {
      writeFileSync(join(dir, 'Gemfile'), "source 'https://rubygems.org'\n");
    },
    expect: {
      ruby_lint_fix: 'tool missing: bundle',
      ruby_test: 'tool missing: bundle',
    },
  },
];

for (const row of UNAVAILABLE_MATRIX) {
  test(`${row.eco}: all required tools missing → unavailable with exact reasons, NO CHECKS RUN`, () => {
    const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
    row.setup(dir);
    const { bin } = makeToolBin(); // every stub exits 127

    const { stdout, summary } = runPrecommit(dir, 'full', pathEnv(bin));
    for (const [name, reason] of Object.entries(row.expect)) {
      const s = summary.steps.find(x => x.name === name);
      assert.equal(s.status, 'unavailable', `${name} must be unavailable`);
      assert.equal(s.reason, reason);
    }
    assert.equal(summary.overallPass, false);
    assert.match(stdout, /^## Overall: ⚠️ NO CHECKS RUN/m);
  });
}

test('a mutating lint-fix still lands a pass note bound to the tree as it stands after the run', () => {
  // A mutating ruff (the fix is the point of the step) must not lose the note:
  // the note computes its digest at note time — end of run — so it binds the
  // post-lint tree, and a stop-hook check over that tree reads passed instead
  // of re-reminding (hook-lightweighting §3.3 replaces the old
  // baseline/endpoint withholding with note-at-end).
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  const { bin } = makeToolBin();
  stubEcoTool(
    bin,
    'ruff',
    'case "$1" in --version) exit 0;; esac\necho fixed >> lint-fixed.py\nexit 0'
  );
  stubEcoTool(bin, 'pytest');

  const { summary, home } = runPrecommit(dir, 'full', pathEnv(bin));
  assert.equal(summary.overallPass, true);
  const slot = readPrecommitSlot(home);
  assert.ok(slot, 'the pass note landed despite the lint mutation');
  assert.equal(slot.verdict, 'pass');
  assert.equal(
    slot.digest,
    treeDigest.computeTreeState(realpathSync(dir)).planes.code.digest,
    'the digest is the post-run tree — lint-fixed.py included'
  );
});

test('a validation step still decides the verdict when a policy step also ran', () => {
  // The plugin's own shape: comment_blocks plus a real script. Excluding policy steps from the
  // "ran" tally must not make a repo that DID validate report NO CHECKS RUN. The mutant this kills
  // is over-exclusion — `isPolicyStep` returning true for everything — not the revert.
  const pkg = { name: 'temp', version: '1.0.0', scripts: { 'test:unit': './pass.sh' } };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(checkerSrc, join(dir, 'scripts', 'check-comment-blocks.js'));

  const { stdout, summary } = runPrecommit(dir, 'fast');
  assert.equal(summary.overallPass, true);
  assert.match(stdout, /^## Overall: ✅ PASS$/m);
});

test('conclusive note survives a failing summary.md write (note recorded before diagnostic persistence)', () => {
  const dir = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(dir, 'test.sh', 0);
  const first = runPrecommit(dir, 'fast');
  // Same repo, same HEAD → the next run resolves the same logDir. Replace the
  // report with a directory so writeFileSync throws EISDIR mid-persistence.
  const cacheDir = resolve(first.logDir, '..', '..');
  rmSync(join(first.logDir, 'summary.md'), { force: true });
  mkdirSync(join(first.logDir, 'summary.md'));
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: dir,
    env: { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: cacheDir, HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /## Overall: ✅ PASS/, 'verdict still reaches stdout');
  assert.match(stdout, /summary\.md write failed \(advisory\)/, 'failed diagnostic write is reported, not fatal');
  const slot = readPrecommitSlot(home);
  assert.ok(slot, 'precommit note must be recorded despite the failed diagnostic write');
  assert.equal(slot.verdict, 'pass');
});

test('conclusive note survives a failing summary.json write too (all diagnostic persistence follows the note)', () => {
  const dir = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(dir, 'test.sh', 0);
  const first = runPrecommit(dir, 'fast');
  const cacheDir = resolve(first.logDir, '..', '..');
  rmSync(join(first.logDir, 'summary.json'), { force: true });
  mkdirSync(join(first.logDir, 'summary.json'));
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: dir,
    env: { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: cacheDir, HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /## Overall: ✅ PASS/, 'verdict still reaches stdout');
  assert.match(stdout, /summary\.json write failed \(diagnostic only\)/, 'failed summary.json write is reported, not fatal');
  const slot = readPrecommitSlot(home);
  assert.ok(slot, 'precommit note must be recorded despite the failed summary.json write');
  assert.equal(slot.verdict, 'pass');
});

test('default cache in a repo without a .claude ignore rule falls back to user cache — the note survives its own diagnostics', () => {
  const { existsSync } = require('node:fs');
  const dir = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(dir, 'test.sh', 0);
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  // No CLAUDE_PRECOMMIT_CACHE_DIR: the runner must detect that .claude/cache is NOT
  // gitignored here and keep its diagnostic writes out of the reviewed tree.
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: dir,
    env: { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: '', HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /## Overall: ✅ PASS/);
  // (.claude/cache/xdg is still created in-repo, but as an EMPTY dir it never
  // appears in git status and cannot move the digest.)
  const logsLine = stdout.match(/- logs: `([^`]+)`/);
  assert.ok(logsLine && logsLine[1].startsWith(require('node:fs').realpathSync(home)), 'diagnostic logs must live under the user cache, not the reviewed tree');
  assert.ok(!existsSync(join(dir, '.claude', 'cache', 'precommit')), 'no unignored in-repo precommit cache writes');
  const check = JSON.parse(
    execSync(`node ${resolve(__dirname, '../../scripts/review-state.js')} check --format=json`, {
      cwd: dir,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })
  );
  assert.equal(check.precommit.digest_match, true, 'diagnostic writes must not move the digest the note recorded');
  assert.equal(check.precommit.passed, true);
  assert.equal(check.precommit.owed, false);
});

test('explicit in-repo unignored cache override falls back to user cache with an advisory — the note stays valid', () => {
  const dir = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(dir, 'test.sh', 0);
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: dir,
    env: { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: '.precommit-cache', HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /## Overall: ✅ PASS/);
  assert.match(stdout, /CLAUDE_PRECOMMIT_CACHE_DIR `\.precommit-cache` is inside the repo and not gitignored/);
  const logsLine = stdout.match(/- logs: `([^`]+)`/);
  assert.ok(logsLine && logsLine[1].startsWith(require('node:fs').realpathSync(home)), 'logs must land under the user cache, not the unignored override');
  const check = JSON.parse(
    execSync(`node ${resolve(__dirname, '../../scripts/review-state.js')} check --format=json`, {
      cwd: dir,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })
  );
  assert.equal(check.precommit.digest_match, true, 'the override must not be allowed to move the digest the note recorded');
  assert.equal(check.precommit.passed, true);
  assert.equal(check.precommit.owed, false);
});

test('explicit in-repo cache override that IS gitignored is honoured as-is', () => {
  const dir = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(dir, 'test.sh', 0);
  writeFileSync(join(dir, '.gitignore'), '.precommit-cache/\n');
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: dir,
    env: { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: '.precommit-cache', HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /## Overall: ✅ PASS/);
  const logsLine = stdout.match(/- logs: `([^`]+)`/);
  // realpath: git resolves /var → /private/var on macOS, mkdtemp does not.
  const realDir = require('node:fs').realpathSync(dir);
  assert.ok(logsLine && logsLine[1].startsWith(join(realDir, '.precommit-cache')), 'ignored explicit override is respected');
  const check = JSON.parse(
    execSync(`node ${resolve(__dirname, '../../scripts/review-state.js')} check --format=json`, {
      cwd: dir,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })
  );
  assert.equal(check.precommit.passed, true, 'ignored cache writes cannot invalidate the note');
});

test('narrow ignore rule covering only a synthetic child does not qualify the cache — real write targets must be ignored', () => {
  const dir = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(dir, 'test.sh', 0);
  writeFileSync(join(dir, '.gitignore'), '.precommit-cache/ignore-probe\n');
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: dir,
    env: { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: '.precommit-cache', HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /is inside the repo and not gitignored/, 'a rule that ignores none of the real write targets must not qualify');
  const logsLine = stdout.match(/- logs: `([^`]+)`/);
  assert.ok(logsLine && logsLine[1].startsWith(require('node:fs').realpathSync(home)), 'falls back to the user cache');
  const check = JSON.parse(
    execSync(`node ${resolve(__dirname, '../../scripts/review-state.js')} check --format=json`, {
      cwd: dir,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })
  );
  assert.equal(check.precommit.passed, true);
  assert.equal(check.precommit.owed, false);
});

test('a "..cache" override is inside the repo, not external — unignored, it falls back like any in-repo path', () => {
  const dir = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(dir, 'test.sh', 0);
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: dir,
    env: { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: '..cache', HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /`\.\.cache` is inside the repo and not gitignored/, '..cache must be classified as in-repo');
  const logsLine = stdout.match(/- logs: `([^`]+)`/);
  assert.ok(logsLine && logsLine[1].startsWith(require('node:fs').realpathSync(home)), 'falls back to the user cache');
  const check = JSON.parse(
    execSync(`node ${resolve(__dirname, '../../scripts/review-state.js')} check --format=json`, {
      cwd: dir,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })
  );
  assert.equal(check.precommit.digest_match, true);
  assert.equal(check.precommit.passed, true);
});

test('a lexically external cache that symlinks back into the repo is classified by its canonical destination', () => {
  const dir = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(dir, 'test.sh', 0);
  const { mkdirSync, symlinkSync } = require('node:fs');
  mkdirSync(join(dir, '.precommit-cache'));
  const ext = mkdtempSync(join(tmpdir(), 'sd0x-ext-'));
  tempDirs.push(ext);
  symlinkSync(join(dir, '.precommit-cache'), join(ext, 'link'));
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: dir,
    env: { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: join(ext, 'link'), HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /is inside the repo and not gitignored/, 'the symlink destination, not the lexical path, decides containment');
  const logsLine = stdout.match(/- logs: `([^`]+)`/);
  assert.ok(logsLine && logsLine[1].startsWith(require('node:fs').realpathSync(home)), 'falls back to the user cache');
  const check = JSON.parse(
    execSync(`node ${resolve(__dirname, '../../scripts/review-state.js')} check --format=json`, {
      cwd: dir,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })
  );
  assert.equal(check.precommit.digest_match, true);
  assert.equal(check.precommit.passed, true);
});

test('a user cache that symlinks into the repo is rejected too — terminal fallback is the git-dir cache', () => {
  const dir = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(dir, 'test.sh', 0);
  const { mkdirSync, symlinkSync } = require('node:fs');
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  // Only the precommit leaf points into the repo; the sibling state dir stays real.
  mkdirSync(join(home, '.cache', 'sd0x-dev-flow'), { recursive: true });
  mkdirSync(join(dir, 'evil-cache'));
  symlinkSync(join(dir, 'evil-cache'), join(home, '.cache', 'sd0x-dev-flow', 'precommit'));
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: dir,
    env: { ...process.env, CLAUDE_PRECOMMIT_CACHE_DIR: '', HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /## Overall: ✅ PASS/);
  assert.match(stdout, /the user cache also resolves inside the repo unignored — using the git-dir cache/);
  const logsLine = stdout.match(/- logs: `([^`]+)`/);
  const realDir = require('node:fs').realpathSync(dir);
  assert.ok(logsLine && logsLine[1].startsWith(join(realDir, '.git')), 'logs land under the git dir, invisible to the worktree digest');
  const check = JSON.parse(
    execSync(`node ${resolve(__dirname, '../../scripts/review-state.js')} check --format=json`, {
      cwd: dir,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })
  );
  assert.equal(check.precommit.digest_match, true, 'git-dir writes cannot move the worktree digest');
  assert.equal(check.precommit.passed, true);
  assert.equal(check.precommit.owed, false);
});

test('git-dir terminal fallback resolves a linked worktree .git FILE even when --absolute-git-dir fails', () => {
  const { mkdirSync, symlinkSync } = require('node:fs');
  const base = createTempRepo({ name: 'temp', scripts: { 'test:fast': './test.sh' } }, null);
  writeScript(base, 'test.sh', 0);
  execSync('git add -A && git -c user.name=t -c user.email=t@t commit -q -m files', { cwd: base });
  const wt = join(base, '..', require('node:path').basename(base) + '-wt');
  tempDirs.push(wt);
  execSync(`git worktree add "${wt}" -b wt-branch`, { cwd: base, stdio: 'ignore' });
  // Force the terminal fallback: user cache leaf symlinks into the worktree (unignored).
  const home = mkdtempSync(join(tmpdir(), 'sd0x-home-'));
  tempDirs.push(home);
  mkdirSync(join(home, '.cache', 'sd0x-dev-flow'), { recursive: true });
  mkdirSync(join(wt, 'evil-cache'));
  symlinkSync(join(wt, 'evil-cache'), join(home, '.cache', 'sd0x-dev-flow', 'precommit'));
  // PATH shim: fail exactly the --absolute-git-dir query, pass everything else through.
  const shimDir = mkdtempSync(join(tmpdir(), 'sd0x-shim-'));
  tempDirs.push(shimDir);
  // Resolve the real git at runtime and hand it to the shim via env — a path
  // baked in at authoring time only works on the machine that authored it.
  const realGit = execSync('command -v git', { encoding: 'utf8' }).trim();
  writeFileSync(join(shimDir, 'git'), '#!/bin/sh\nif [ "$1" = "rev-parse" ] && [ "$2" = "--absolute-git-dir" ]; then exit 1; fi\nexec "$REAL_GIT" "$@"\n');
  chmodSync(join(shimDir, 'git'), 0o755);
  const stdout = execSync(`node ${runnerPath} --mode fast`, {
    cwd: wt,
    env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}`, REAL_GIT: realGit, CLAUDE_PRECOMMIT_CACHE_DIR: '', HOME: home },
    encoding: 'utf8',
  });
  assert.match(stdout, /## Overall: ✅ PASS/);
  assert.match(stdout, /using the git-dir cache/);
  const logsLine = stdout.match(/- logs: `([^`]+)`/);
  // The worktree's .git is a FILE; the resolved git dir lives under the base
  // repo's .git/worktrees/<name>/ — never a path joined onto the .git file.
  assert.ok(logsLine && /\.git\/worktrees\/.*sd0x-precommit-cache/.test(logsLine[1]), `git dir resolved through the .git file: ${logsLine && logsLine[1]}`);
  const check = JSON.parse(
    execSync(`node ${resolve(__dirname, '../../scripts/review-state.js')} check --format=json`, {
      cwd: wt,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
    })
  );
  assert.equal(check.precommit.digest_match, true);
  assert.equal(check.precommit.passed, true);
});

// --- lint-argument injection -----------------------------------------------------------------
//
// The runner used to append ESLint's own CLI flags and source globs to whatever `lint:fix` the
// repo declared. markdownlint-cli2 treats every unrecognised argument as a FILE GLOB, so under
// `--fix` it rewrote JavaScript as Markdown: `branch.split('/')[1]` became `branch.split['/'](1)`.
// One run against this repo corrupted 71 files that were clean at HEAD, five into syntax errors.

const { lintArgsFor, loadLintConfig } = require('../../scripts/lib/utils.js');
const { sectionAt, liveText } = require('../helpers/markdown-structure.js');

test('nothing is appended to a lint script unless the repo opts in', () => {
  const globs = ['src/**/*.{ts,tsx,js,jsx}'];
  const ESLINT_ARGS = [
    '--ignore-pattern', 'node_modules/**',
    '--ignore-pattern', '**/node_modules/**',
    '--no-error-on-unmatched-pattern',
    ...globs,
  ];

  // Default: nothing. A declared script is already a complete command. Detecting "is this really
  // eslint?" from the script text was tried through four grammars and each was shown to
  // misclassify toward injection — package specs, aliases, wrapper options taking an operand,
  // package-script dispatch, compound commands. There is no detection left to get wrong.
  const off = lintArgsFor(globs);
  assert.deepEqual(off.args, [], 'no arguments are appended by default');
  assert.equal(off.skipped, true);
  assert.match(off.reason, /no lintArgMode set for this script role/);

  assert.deepEqual(lintArgsFor(globs, { lintArgMode: 'eslint' }).args, ESLINT_ARGS,
    'the per-role opt-in is what turns injection on');
  assert.equal(lintArgsFor(globs, { lintArgMode: 'none' }).skipped, true, 'and none is explicit');

  const w = [];
  assert.equal(lintArgsFor(globs, { lintArgMode: 'yes-please', warn: (m) => w.push(m) }).skipped, true,
    'an invalid mode is not treated as an opt-in');
  assert.match(w.join(' '), /ignoring lintArgMode/, 'and is reported');

  const ignored = lintArgsFor(globs, { globsConfigured: true });
  assert.match(ignored.reason, /configured lintGlobs are ignored until lintArgMode is set/,
    'configured globs that cannot apply are named, not silently dropped');
});

// Precedence must not be decided before validity: storing an unusable value made
// `out.lintArgMode !== undefined`, which vetoed a valid lower-priority one — an invalid setting
// silently overriding a usable one is the opposite of "reported and ignored".
test('an invalid mode in the higher-priority source falls through to the valid one', () => {
  const dir = createTempRepo({
    name: 'temp',
    version: '1.0.0',
    scripts: { lint: './pass.sh' },
    sd0x: { lintArgMode: { lint: 'eslint' } },
  });
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(
    join(dir, '.claude', 'runner-config.json'),
    JSON.stringify({ lintArgMode: { lint: 'typo' } })
  );

  const warnings = [];
  const cfg = loadLintConfig(dir, 'lint', (m) => warnings.push(m));
  assert.equal(cfg.lintArgMode, 'eslint', 'the valid package.json value must still be reached');
  assert.match(warnings.join(' '),
    /ignoring lintArgMode\.lint \(string\(4 chars\)\) in \.claude\/runner-config\.json/,
    'and the invalid one is reported by source, role and TYPE — never by content');
  assert.ok(!warnings.join(' ').includes('typo'),
    'the rejected value itself must not appear: these warnings reach the runner stdout, and a '
      + 'diagnostic cannot know whether what it is echoing is a secret');

  // A non-string role value is reported too, not silently declined.
  writeFileSync(
    join(dir, '.claude', 'runner-config.json'),
    JSON.stringify({ lintArgMode: { lint: 42 } })
  );
  const w2 = [];
  assert.equal(loadLintConfig(dir, 'lint', (m) => w2.push(m)).lintArgMode, 'eslint');
  assert.match(w2.join(' '), /ignoring lintArgMode\.lint \(number\) in/);
});

// The opt-in contract lives in two places that must agree: the code that reads it and the guidance
// that tells users how to write it. Making lintGlobs inert without lintArgMode silently broke the
// documented path until this was pinned.
/** The JSON example as a reader would receive it: masked document first, fences preserved. */
function guidanceExample(raw) {
  const section = sectionAt(liveText(raw, { fencesCount: true }), 2, 'Lint Argument Injection');
  const fence = section.match(/```json\n([\s\S]*?)\n```/);
  return fence ? JSON.parse(fence[1]) : null;
}

/** The two operative paragraphs, pinned whole.
*
* Flattening soft wrapping is right; flattening the WHOLE section is not. An unanchored search over
* a flattened section could not tell the operative sentence from a blank-paragraph split inside it,
* from an `unless …` qualifier appended to it, or from a reversed mapping sitting beside a correct
* historical decoy elsewhere in the section. So: locate exactly one paragraph carrying each claim,
* then compare that paragraph's normalized text for EQUALITY. Any qualifier, decoy or reversal
* changes the string, which is the property a substring search cannot have.
*/
// The JSON example in § Lint Argument Injection is something a user copies into package.json, so
// it must PARSE — a `//` comment inside a json fence once made the documented example unusable —
// and must opt in by role, the only shape the loader accepts.
test('the documented lint-config example is valid JSON in the shape the loader accepts', () => {
  const raw = readFileSync(resolve(__dirname, '../../skills/generate-runner/SKILL.md'), 'utf8');
  const example = guidanceExample(raw);
  assert.ok(example, 'the section must carry a parseable json example');
  assert.equal(example.sd0x.lintArgMode['lint:fix'], 'eslint', 'the example opts in for a role');
  assert.ok(Array.isArray(example.sd0x.lintGlobs), 'and shows lintGlobs beside it');
});

test('lintArgMode is scoped to a script role, and a bare string is refused', () => {
  const dir = createTempRepo({
    name: 'temp',
    version: '1.0.0',
    scripts: { lint: 'node ./tools/eslint.js', 'lint:fix': 'markdownlint-cli2 --fix' },
    sd0x: { lintArgMode: { lint: 'eslint' } },
  });
  const forFix = loadLintConfig(dir, 'lint:fix');
  const forLint = loadLintConfig(dir, 'lint');
  assert.equal(forLint.lintArgMode, 'eslint', 'the role it was set for opts in');
  assert.equal(forFix.lintArgMode, undefined, 'the other role does not');
  assert.equal(lintArgsFor(['g'], forFix).skipped, true, 'so the markdown script keeps running as declared');
  assert.equal(lintArgsFor(['g'], forLint).skipped, false, 'while the configured role does inject');

  // A bare string cannot say which role it means, so it is reported and ignored.
  const strDir = createTempRepo({
    name: 'temp',
    version: '1.0.0',
    scripts: { 'lint:fix': 'markdownlint-cli2 --fix' },
    sd0x: { lintArgMode: 'eslint' },
  });
  const warnings = [];
  const cfg = loadLintConfig(strDir, 'lint:fix', (m) => warnings.push(m));
  assert.equal(cfg.lintArgMode, undefined, 'a bare string is not honoured');
  assert.match(warnings.join(' '), /must be keyed by script role/, 'and the shape is explained');
});

// npm's own separator is inserted by pmCommand. A second `--` reaches the script, where eslint
// reads it as its end-of-options marker and every injected flag arrives as a positional file
// pattern — so the ESLint path this fix is meant to preserve was itself broken.
test('an eslint script receives exactly the injected flags, with no stray separator', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: { 'lint:fix': './fake-eslint.sh', 'test:unit': './pass.sh' },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  const fake = join(dir, 'fake-eslint.sh');
  // The name is incidental now — injection is decided by lintArgMode alone, not by the script
  // token. The fixture asserts what the child actually receives.
  writeFileSync(fake, '#!/bin/sh\nprintf \'%s\\n\' "$@" > argv.txt\nexit 0\n');
  chmodSync(fake, 0o755);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      ...pkg,
      scripts: { ...pkg.scripts, 'lint:fix': './eslint' },
      sd0x: { lintArgMode: { 'lint:fix': 'eslint' } },
    })
  );
  const eslintBin = join(dir, 'eslint');
  writeFileSync(eslintBin, '#!/bin/sh\nprintf \'%s\\n\' "$@" > argv.txt\nexit 0\n');
  chmodSync(eslintBin, 0o755);

  runPrecommit(dir, 'fast');
  const argv = readFileSync(join(dir, 'argv.txt'), 'utf8').split('\n').filter(Boolean);
  assert.ok(argv.length > 0, 'the eslint path must still receive its arguments');
  assert.notEqual(argv[0], '--', 'no stray separator may lead the argument vector');
  assert.equal(argv[0], '--ignore-pattern', 'the first argument is the first injected flag');
  assert.ok(argv.includes('--no-error-on-unmatched-pattern'), 'and the flags arrive as flags');
});

test('a non-eslint lint:fix script receives no injected arguments', () => {
  const pkg = {
    name: 'temp',
    version: '1.0.0',
    scripts: { 'lint:fix': './record-argv.sh', 'test:unit': './pass.sh' },
  };
  const dir = createTempRepo(pkg);
  writeScript(dir, 'pass.sh', 0);
  // Records everything it was handed, so the assertion is about the real invocation rather than
  // about the helper in isolation.
  const rec = join(dir, 'record-argv.sh');
  writeFileSync(rec, '#!/bin/sh\nprintf \'%s\\n\' "$@" > argv.txt\nexit 0\n');
  chmodSync(rec, 0o755);

  const { summary, stdout } = runPrecommit(dir, 'fast');
  assert.ok(summary.steps.some((step) => step.name === 'lint_fix'), 'the lint step still runs');
  assert.match(stdout, /no lintArgMode set for this script role/,
    'and the runner says why it injected nothing');

  const argv = readFileSync(join(dir, 'argv.txt'), 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(argv, [], 'no ESLint flags and no globs may reach a non-eslint linter');
});

// The lint-injection fix changed plugin source, but /precommit, /precommit-fast and /verify execute
// the INSTALLED copy at .claude/scripts/, on sight, and only install when one is absent. A consumer
// who installed before the fix therefore keeps running the version that passes ESLint-only flags
// into whatever linter the repo declares — against a file-rewriting non-ESLint linter those flags
// are read as paths and the run edits sources. Putting the check only in the install path does not
// close that: nothing makes a consumer re-install. So it is published once and applied at both the
// install path and every execution entry point, and these guards hold that shape.
const REPO = resolve(__dirname, '../..');
const readSkill = (rel) => readFileSync(resolve(REPO, rel), 'utf8');

test('generate-runner may invoke the tools its own workflow requires', () => {
  const doc = readSkill('skills/generate-runner/SKILL.md');
  const allow = doc.match(/^allowed-tools:\s*(.+)$/m);
  assert.ok(allow, 'the skill must declare allowed-tools');
  const declared = allow[1];
  // Each operation the workflow names, and the tool it needs to perform it.
  for (const [operation, tool] of [
    ['AskUserQuestion', 'AskUserQuestion'],
    ['chmod', 'Bash(chmod:*)'],
    ['bash -n', 'Bash(bash:*)'],
    ['Write', 'Write'],
  ]) {
    if (!new RegExp(operation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(doc)) continue;
    assert.ok(declared.includes(tool),
      `the workflow names ${operation} but allowed-tools omits ${tool} — an agent following this `
      + 'skill literally cannot perform the step');
  }
});

// Precedence between two VALID values was neither documented nor tested: every existing case had at
// most one usable value, so a mutation that let `package.json` overwrite `.claude` passed the whole
// suite. That direction matters because `"none"` in `.claude` is how a project suppresses an opt-in
// its package.json declares — and it only works if the first *valid* value wins.
// These warnings are written to the runner's stdout, so echoing a rejected value publishes it.
// `rules/security.md` and `rules/logging.md` forbid logging secrets, and a diagnostic has no way to
// know whether the field it is echoing holds one — so it never echoes.
test('a rejected lint configuration value is never echoed', () => {
  const { loadLintConfig, lintArgsFor } = require('../../scripts/lib/utils.js');
  const dir = mkdtempSync(join(tmpdir(), 'lint-canary-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  const CANARY = 'canary-secret-do-not-log';

  for (const value of [CANARY, { token: CANARY }, [CANARY], CANARY.repeat(20)]) {
    const warnings = [];
    writeFileSync(join(dir, '.claude', 'runner-config.json'),
      JSON.stringify({ lintArgMode: { 'lint:fix': value } }));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    loadLintConfig(dir, 'lint:fix', (m) => warnings.push(m));
    const text = warnings.join(' ');
    assert.ok(warnings.length >= 1, `an invalid ${typeof value} must still be reported`);
    assert.ok(!text.includes(CANARY), `the rejected value must not appear: ${text.slice(0, 120)}`);
    assert.match(text, /expected one of/, 'and the diagnostic must still say what was expected');
  }

  // The same rule at the other warning site.
  const argWarnings = [];
  lintArgsFor(['x'], { lintArgMode: CANARY, warn: (m) => argWarnings.push(m) });
  assert.ok(argWarnings.length === 1 && !argWarnings[0].includes(CANARY),
    'lintArgsFor must not echo its rejected mode either');
});

test('lint config precedence: first valid value wins, per role', () => {
  const { loadLintConfig } = require('../../scripts/lib/utils.js');
  const dir = mkdtempSync(join(tmpdir(), 'lint-prec-'));
  tempDirs.push(dir); // the after() hook cleans only what is registered here
  mkdirSync(join(dir, '.claude'), { recursive: true });
  const write = (claudeCfg, pkgSd0x) => {
    writeFileSync(join(dir, '.claude', 'runner-config.json'), JSON.stringify(claudeCfg));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0', sd0x: pkgSd0x }));
  };

  // Two valid values in conflict: the higher-priority source wins, and the suppression works.
  write({ lintArgMode: { 'lint:fix': 'none' } }, { lintArgMode: { 'lint:fix': 'eslint' } });
  assert.equal(loadLintConfig(dir, 'lint:fix').lintArgMode, 'none',
    '`.claude` outranks package.json, which is what makes "none" able to suppress an opt-in');

  // Fallback when the higher-priority source says nothing about this role.
  write({ lintArgMode: { lint: 'eslint' } }, { lintArgMode: { 'lint:fix': 'eslint' } });
  assert.equal(loadLintConfig(dir, 'lint:fix').lintArgMode, 'eslint', 'the other source is a fallback');
  assert.equal(loadLintConfig(dir, 'lint').lintArgMode, 'eslint', 'and roles are independent');

  // An INVALID higher-priority value must warn and fall through, never latch — an unusable setting
  // silently vetoing a usable one is the opposite of "reported and ignored".
  const warnings = [];
  write({ lintArgMode: { 'lint:fix': 'yolo' } }, { lintArgMode: { 'lint:fix': 'eslint' } });
  assert.equal(loadLintConfig(dir, 'lint:fix', (m) => warnings.push(m)).lintArgMode, 'eslint',
    'an invalid higher-priority value falls through to the valid lower-priority one');
  assert.equal(warnings.length, 1, 'and is reported rather than silently dropped');

  // Container shapes that are not role-keyed objects. These fell through in SILENCE, and the
  // silence lands on the safety path: a malformed `.claude` value written to suppress a
  // lower-priority opt-in let that opt-in through with nothing reported.
  for (const shape of [false, [], null, 42, 'eslint']) {
    warnings.length = 0;
    write({ lintArgMode: shape }, { lintArgMode: { 'lint:fix': 'eslint' } });
    assert.equal(loadLintConfig(dir, 'lint:fix', (m) => warnings.push(m)).lintArgMode, 'eslint',
      `an unusable lintArgMode (${JSON.stringify(shape)}) must fall through`);
    assert.equal(warnings.length, 1, `and must be reported: ${JSON.stringify(shape)}`);
  }

  // A bare string is the documented mistake and must not latch either.
  warnings.length = 0;
  write({ lintArgMode: 'eslint' }, { lintArgMode: { 'lint:fix': 'none' } });
  assert.equal(loadLintConfig(dir, 'lint:fix', (m) => warnings.push(m)).lintArgMode, 'none',
    'a bare string does not latch');
  assert.match(warnings[0], /keyed by script role/, 'and says what the shape should be');
});

// The claim about silence was written from `loadLintConfig()`'s catch blocks and was wrong about
// the path a user actually travels: each runner calls `loadLintGlobs()` first, and that one warns.
test('the documented silence matches the runner path, not one loader in isolation', () => {
  const { loadLintGlobs, readPackageJson } = require('../../scripts/lib/utils.js');
  const dir = mkdtempSync(join(tmpdir(), 'lint-silence-'));
  tempDirs.push(dir); // the after() hook cleans only what is registered here
  mkdirSync(join(dir, '.claude'), { recursive: true });

  // A malformed `.claude/runner-config.json` is NOT silent on the runner path.
  writeFileSync(join(dir, '.claude', 'runner-config.json'), '{ not json');
  // It writes to process.stderr, not console.warn — captured here rather than assumed, because
  // assuming which channel a warning uses is how this claim went wrong in the first place.
  const warned = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    warned.push(String(chunk));
    return origWrite(chunk, ...rest);
  };
  try {
    loadLintGlobs(dir, ['x']);
  } finally {
    process.stderr.write = origWrite;
  }
  assert.ok(warned.some((w) => /runner-config\.json/.test(w)),
    'loadLintGlobs warns for a .claude config it cannot parse');
  // …and the warning is content-free. `JSON.parse` quotes the offending source in its message, so
  // writing `e.message` published the file: `"S3CR3T99" is not valid JSON`. Same rule as
  // describeRejected() — the path and the error class are actionable, the content never is.
  const CANARY = 'S3CR3T99-do-not-log';
  writeFileSync(join(dir, '.claude', 'runner-config.json'), CANARY);
  const leaked = [];
  const restore = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    leaked.push(String(chunk));
    return restore(chunk, ...rest);
  };
  try {
    loadLintGlobs(dir, ['x']);
  } finally {
    process.stderr.write = restore;
  }
  const text = leaked.join(' ');
  assert.ok(!text.includes(CANARY), `the malformed source must not be echoed: ${text.slice(0, 160)}`);
  assert.match(text, /cannot read \.claude\/runner-config\.json/, 'but the failure is still reported');

  // A malformed package.json is silent — readPackageJson swallows it and returns null.
  writeFileSync(join(dir, 'package.json'), '{ also not json');
  assert.equal(readPackageJson(dir), null, 'readPackageJson returns null rather than reporting');

});
