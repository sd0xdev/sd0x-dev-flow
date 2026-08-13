const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  readFileSync,
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
  const env = {
    ...process.env,
    CLAUDE_PRECOMMIT_CACHE_DIR: cacheDir,
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
  return { stdout, summary, logDir };
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
  // as validation banked a ✅ PASS receipt with the project's own checks never invoked — the
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
// to a file OUTSIDE the repo (writing into the tree after the baseline would
// trip endpoint revalidation, which has its own dedicated tests below).

const receiptLog = require('../../scripts/lib/receipt-log');
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

function ecoVerdictFile(cacheHome, repo) {
  const slug = receiptLog.repoSlug(realpathSync(repo));
  return join(cacheHome, 'sd0x-dev-flow', 'receipts', slug, 'verdicts.jsonl');
}

function receiptHomes() {
  const cacheHome = mkdtempSync(join(tmpdir(), 'sd0x-xdg-'));
  const tmpHome = mkdtempSync(join(tmpdir(), 'sd0x-tmp-'));
  tempDirs.push(cacheHome, tmpHome);
  return { cacheHome, tmpHome, env: { XDG_CACHE_HOME: cacheHome, TMPDIR: tmpHome + '/' } };
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

test('a genuinely non-Node repo (no package.json) runs its ecosystem and lands the receipt through the runner append', () => {
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
  const { cacheHome, env } = receiptHomes();

  const { stdout, summary } = runPrecommit(dir, 'full', { ...pathEnv(bin), ...env });
  assert.match(stdout, /> ecosystems: python/);
  assert.equal(summary.overallPass, true);
  const verdicts = receiptLog
    .readRecords(ecoVerdictFile(cacheHome, dir))
    .records.filter(r => r.kind === 'verdict');
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].verdict, 'pass');
  assert.equal(verdicts[0].v, 1); // emitted records carry the schema version (AC7)
  assert.equal(
    verdicts[0].digest,
    treeDigest.computeTreeState(realpathSync(dir)).planes.code.digest
  );
});

test('a missing required tool blocks PASS even when another check passes', () => {
  // The false-green the `unavailable` state exists to prevent: pytest green
  // while ruff is not installed must NOT mint a PASS receipt.
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'pytest'); // ruff stays at the exit-127 default
  const { cacheHome, env } = receiptHomes();

  const { stdout, summary } = runPrecommit(dir, 'full', { ...pathEnv(bin), ...env });
  assert.equal(summary.overallPass, false);
  assert.match(stdout, /^## Overall: ❌ FAIL$/m);
  assert.match(stdout, /required tools unavailable: python_lint_fix \(tool missing: ruff\)/);
  const lint = summary.steps.find(s => s.name === 'python_lint_fix');
  assert.equal(lint.status, 'unavailable');
  const verdicts = receiptLog
    .readRecords(ecoVerdictFile(cacheHome, dir))
    .records.filter(r => r.kind === 'verdict');
  // Exact contract, not a vacuous "no pass": a partial run over an unavailable
  // required tool appends exactly ONE fail verdict for the current digest —
  // negative evidence names what it observed (FAIL is exempt from endpoint
  // equality).
  assert.equal(verdicts.length, 1);
  assert.equal(verdicts[0].verdict, 'fail');
  assert.equal(
    verdicts[0].digest,
    treeDigest.computeTreeState(realpathSync(dir)).planes.code.digest
  );
});

test('every ecosystem tool missing → all steps unavailable, ⚠️ NO CHECKS RUN', () => {
  // Nothing could run at all: fail-closed to the sentinel that routes to the
  // Skill's human-facing fallback, and no receipt in either direction.
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  const { bin } = makeToolBin(); // all stubs exit 127
  const { cacheHome, env } = receiptHomes();

  const { stdout, summary } = runPrecommit(dir, 'full', { ...pathEnv(bin), ...env });
  assert.equal(summary.overallPass, false);
  const lint = summary.steps.find(s => s.name === 'python_lint_fix');
  const test_ = summary.steps.find(s => s.name === 'python_test');
  assert.equal(lint.status, 'unavailable');
  assert.equal(lint.reason, 'tool missing: ruff');
  assert.equal(test_.status, 'unavailable');
  assert.equal(test_.reason, 'tool missing: pytest');
  assert.match(stdout, /^## Overall: ⚠️ NO CHECKS RUN/m);
  const { records } = receiptLog.readRecords(ecoVerdictFile(cacheHome, dir));
  assert.equal(records.filter(r => r.kind === 'verdict').length, 0);
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
  // The baseline invariant depends on this grouping: no lint-fix step may
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
  // real steps and could mutate the tree after the baseline). The stub forks
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

test('ecosystem PASS lands a receipt; baseline is captured after the last lint-fix', () => {
  // A mutating ruff (the fix is the point of the step) must not poison the
  // endpoint check: the baseline is captured AFTER the lint phase, so the
  // receipt still lands. This is the WB2b parity claim — same direct append as
  // the Node path.
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
  const { cacheHome, env } = receiptHomes();

  const { summary } = runPrecommit(dir, 'full', { ...pathEnv(bin), ...env });
  assert.equal(summary.overallPass, true);
  const records = receiptLog
    .readRecords(ecoVerdictFile(cacheHome, dir))
    .records.filter(r => r.kind === 'verdict');
  assert.equal(records.length, 1);
  assert.equal(records[0].verdict, 'pass');
  assert.equal(records[0].plane, 'precommit');
  assert.equal(records[0].producer, 'precommit-runner');
});

test('a test step mutating the tree withholds the PASS receipt (endpoint drift)', () => {
  // Negative control for the baseline placement: mutation AFTER the lint phase
  // is drift, and a PASS receipt must be refused loudly.
  const dir = createTempRepo({ name: 'temp', version: '1.0.0', scripts: {} });
  writeFileSync(join(dir, 'pyproject.toml'), '[project]\nname = "t"\n');
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  const { bin } = makeToolBin();
  stubEcoTool(bin, 'ruff');
  stubEcoTool(
    bin,
    'pytest',
    'case "$1" in --version) exit 0;; esac\necho drift >> drifted.py\nexit 0'
  );
  const { cacheHome, env } = receiptHomes();

  const { stdout, summary } = runPrecommit(dir, 'full', { ...pathEnv(bin), ...env });
  assert.equal(summary.overallPass, true, 'the checks themselves passed');
  assert.match(stdout, /receipt withheld/);
  const { records } = receiptLog.readRecords(ecoVerdictFile(cacheHome, dir));
  assert.equal(records.filter(r => r.kind === 'verdict').length, 0);
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
