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
const { execSync } = require('node:child_process');

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

function runPrecommit(dir, mode) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'sd0x-cache-'));
  tempDirs.push(cacheDir);
  const env = {
    ...process.env,
    CLAUDE_PRECOMMIT_CACHE_DIR: cacheDir,
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
