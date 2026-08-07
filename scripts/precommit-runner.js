#!/usr/bin/env node
/**
 * precommit-runner.js
 * Engineering-grade precommit runner (package-manager agnostic):
 * - full: lint:fix && build && test (tiered: test:ci > test > test:fast > test:unit)
 * - fast: lint:fix && test (tiered: test:fast > test:unit > test)
 * Auto-detects yarn/pnpm/npm from lockfile.
 *
 * Outputs:
 * - concise Markdown summary to stdout (for Claude Code context)
 * - writes full logs to .claude/cache/precommit/<repoKey>/<shortSha>/
 *   (or $CLAUDE_PRECOMMIT_CACHE_DIR)
 */

const fs = require('fs');
const path = require('path');
const {
  nowISO,
  sha1,
  safeSlug,
  ensureDir,
  writeText,
  writeJson,
  appendLog,
  runCapture,
  runStep,
  testStdoutFilter,
  gitRepoRoot,
  gitShortHead,
  gitHead,
  gitStatusSB,
  gitRemoteOrigin,
  detectPackageManager,
  readPackageJson,
  hasScript,
  pmCommand,
  loadLintGlobs,
  buildRecipes,
} = require('./lib/utils');

// Steps that check repo POLICY rather than validate the project. They can fail a run, but they
// never satisfy "some validation ran" — see the overallPass comment for the false-green this
// distinction prevents.
const POLICY_STEPS = new Set(['comment_blocks']);
function isPolicyStep(name) {
  return POLICY_STEPS.has(name);
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

async function gitDiffNameOnly(cwd) {
  const r = await runCapture('git', ['diff', '--name-only'], { cwd });
  const txt = (r.code === 0 ? r.stdout : '').trim();
  if (!txt) return [];
  return txt
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

function formatStepLine(name, code, ms, logFile) {
  const ok = code === 0;
  const sec = Math.round(ms / 1000);
  return `- ${ok ? '✅' : '❌'} **${name}** (${
    ok ? 'PASS' : `FAIL(${code})`
  }, ${sec}s)  \n  log: \`${logFile}\``;
}

function parseArgs(argv) {
  const args = {
    mode: 'full', // full | fast
    tail: 120, // default tail lines ceiling
    tailSuccess: 25,
    tailFailure: 120,
  };

  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--mode' && v) args.mode = v;
    if (k === '--tail' && v) args.tail = parseInt(v, 10) || args.tail;
    if (k === '--tail-success' && v)
      args.tailSuccess = parseInt(v, 10) || args.tailSuccess;
    if (k === '--tail-failure' && v)
      args.tailFailure = parseInt(v, 10) || args.tailFailure;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = await gitRepoRoot();

  if (!repoRoot) {
    process.stdout.write(`# precommit runner\n\n❌ Not inside a git repo.\n`);
    return;
  }

  const head = await gitHead(repoRoot);
  const short = (await gitShortHead(repoRoot)) || 'unknown';
  const remote = (await gitRemoteOrigin(repoRoot)) || repoRoot;

  const repoBase = path.basename(repoRoot);
  const repoKey = `${safeSlug(repoBase)}--${sha1(remote).slice(0, 8)}`;

  const cacheBase =
    process.env.CLAUDE_PRECOMMIT_CACHE_DIR ||
    path.join(repoRoot, '.claude', 'cache', 'precommit');

  const logDir = path.join(cacheBase, repoKey, short);
  ensureDir(logDir);
  const xdgDir = path.join(repoRoot, '.claude', 'cache', 'xdg');
  ensureDir(xdgDir);
  const runnerLog = path.join(logDir, 'runner.log');
  appendLog(runnerLog, `[${nowISO()}] start\n`);

  const meta = {
    generatedAt: nowISO(),
    mode: args.mode,
    repoRoot,
    repoKey,
    head,
    short,
    remote,
  };
  writeJson(path.join(logDir, 'meta.json'), meta);

  let statusBefore = '';
  let statusAfter = '';
  let changedAfterLint = [];
  const results = [];
  let summaryError = '';
  const pm = detectPackageManager(repoRoot);
  const pkg = readPackageJson(repoRoot);

  try {
    statusBefore = await gitStatusSB(repoRoot);
    process.stdout.write(`> package manager: ${pm}\n`);

    const steps = [];
    const lintGlobs = loadLintGlobs(repoRoot);

    // comment blocks — static and cheap, so it runs first and reports a blocking
    // block without waiting for lint/build/test.
    //
    // SKIPPED, never failed, unless the repo checked the checker in ITSELF. Two
    // conditions, and the first is the load-bearing one:
    //
    // `scripts/check-comment-blocks.js` only — deliberately NOT the installed
    // copy at `.claude/scripts/`. `/install-scripts` copies this plugin's
    // `scripts/*.js` there, so accepting that path runs a plugin CONVENTION over
    // a consuming project's own code: the checker's scan dirs are the repo's
    // top-level hooks/ scripts/ skills/ (`.claude/` is exempt), so a Python or
    // Rust project that merely has a `scripts/` dir would get its comment lengths
    // judged by this plugin's 30-line rule and could FAIL precommit on it. A repo
    // that genuinely wants the check vendors the checker into its own `scripts/`,
    // which is the same act as opting in.
    //
    // That one condition is also SUFFICIENT, which is why there is no second
    // one. The checker exits 2 on a root holding none of hooks/ scripts/ skills/
    // — a FAIL, not a skip — but finding it at `<root>/scripts/…` already proves
    // `<root>/scripts` exists, so that root cannot occur. A `hasCommentScanDir`
    // guard here would be unreachable code asserting a condition its own
    // predecessor guarantees.
    const ownChecker = path.join(repoRoot, 'scripts/check-comment-blocks.js');
    if (fs.existsSync(ownChecker)) {
      steps.push({ name: 'comment_blocks', cmd: process.execPath, args: [ownChecker] });
    } else {
      process.stdout.write('> skip comment_blocks (checker missing)\n');
      steps.push({ name: 'comment_blocks', status: 'skip', reason: 'checker missing' });
    }

    // lint:fix
    if (hasScript(pkg, 'lint:fix')) {
      const [cmd, baseArgs] = pmCommand(pm, 'lint:fix', [
        '--',
        '--ignore-pattern',
        'node_modules/**',
        '--ignore-pattern',
        '**/node_modules/**',
        '--no-error-on-unmatched-pattern',
        ...lintGlobs,
      ]);
      steps.push({
        name: 'lint_fix',
        cmd,
        args: baseArgs,
        env: {
          NO_UPDATE_NOTIFIER: '1',
          XDG_CONFIG_HOME: xdgDir,
        },
      });
    } else {
      process.stdout.write(`> skip lint_fix (no "lint:fix" script in package.json)\n`);
      steps.push({ name: 'lint_fix', status: 'skip', reason: 'script missing' });
    }

    // build (full mode only)
    if (args.mode === 'full') {
      if (hasScript(pkg, 'build')) {
        const [cmd, buildArgs] = pmCommand(pm, 'build');
        steps.push({ name: 'build', cmd, args: buildArgs });
      } else {
        process.stdout.write(`> skip build (no "build" script in package.json)\n`);
        steps.push({ name: 'build', status: 'skip', reason: 'script missing' });
      }
    }

    // test selection by mode (tiered preference chain)
    const testPreference = args.mode === 'fast'
      ? ['test:fast', 'test:unit', 'test']
      : ['test:ci', 'test', 'test:fast', 'test:unit'];
    const selectedTest = testPreference.find(s => hasScript(pkg, s));

    if (selectedTest) {
      const [cmd, testArgs] = pmCommand(pm, selectedTest);
      // name stays 'test_unit' (canonical phase name) regardless of selected script
      steps.push({ name: 'test_unit', cmd, args: testArgs, env: { CI: '1' }, stdoutFilter: testStdoutFilter });
      if (selectedTest !== 'test:unit') {
        process.stdout.write(`> test: using "${selectedTest}" (${args.mode} mode)\n`);
      }
    } else {
      process.stdout.write(`> skip test_unit (no test script in package.json)\n`);
      steps.push({ name: 'test_unit', status: 'skip', reason: 'script missing' });
    }

    for (const s of steps) {
      // Skip records flow into results so a repo with zero runnable scripts
      // reports "PASS (all steps skipped)" instead of an unfixable FAIL that
      // wedges the strict stop gate (mirrors verify-runner semantics).
      if (s.status === 'skip') {
        results.push(s);
        appendLog(runnerLog, `[${nowISO()}] step_skip ${s.name} (${s.reason})\n`);
        continue;
      }
      appendLog(runnerLog, `[${nowISO()}] step_start ${s.name}\n`);
      process.stdout.write(`> running ${s.name}...\n`);
      const r = await runStep({
        name: s.name,
        cmd: s.cmd,
        args: s.args,
        cwd: repoRoot,
        env: s.env || {},
        logDir,
        tailSuccess: args.tailSuccess,
        tailFailure: args.tailFailure,
        tailLines: args.tail,
        heartbeatMs: 5000,
        stdoutFilter: s.stdoutFilter,
      });
      results.push(r);
      appendLog(
        runnerLog,
        `[${nowISO()}] step_done ${s.name} code=${r.code}\n`
      );
      process.stdout.write(`> finished ${s.name} (code=${r.code})\n`);
      if (s.name === 'lint_fix') {
        changedAfterLint = await gitDiffNameOnly(repoRoot);
      }
    }

    statusAfter = await gitStatusSB(repoRoot);
  } catch (e) {
    summaryError = String((e && e.stack) || e);
  }

  const summary = {
    ...meta,
    statusBefore,
    statusAfter,
    changedAfterLintFix: changedAfterLint,
    steps: results.map(r => ({
      name: r.name,
      code: r.code,
      durationMs: r.durationMs,
      logFile: r.logFile,
      status: r.status,
      reason: r.reason,
    })),
    // PASS requires at least one REAL (non-skip) VALIDATION step that exited 0. An all-skip run is
    // NOT a pass: precommit is a merge gate, so "nothing ran" must not be recorded as "verified".
    // It gets its own sentinel below (⚠️ NO CHECKS RUN) so hooks fail-closed and the skill falls
    // through to ecosystem detection, rather than the earlier behavior that minted all-skip as
    // ✅ PASS.
    //
    // POLICY steps are excluded from "did anything run". `comment_blocks` is repo-shape policy,
    // not project validation, and it passes in any repo holding a hooks/scripts/skills directory —
    // so counting it re-minted the all-skip false-green this sentinel exists to prevent: a Python
    // or Rust project that installed this plugin and happens to have a top-level `scripts/` would
    // bank a ✅ PASS receipt with pytest/cargo never invoked. A policy step still FAILS the run.
    overallPass: (() => {
      const ran = results.filter(r => r.status !== 'skip');
      const ranValidation = ran.filter(r => !isPolicyStep(r.name));
      return ranValidation.length > 0 && ran.every(r => r.code === 0);
    })(),
    error: summaryError || undefined,
  };
  writeJson(path.join(logDir, 'summary.json'), summary);
  appendLog(runnerLog, `[${nowISO()}] summary_written\n`);

  // Output concise Markdown (for Claude Code context)
  const lines = [];
  lines.push(`# Precommit (${args.mode})`);
  lines.push(`- repo: \`${repoRoot}\``);
  lines.push(`- HEAD: \`${short}\``);
  lines.push(`- logs: \`${logDir}\``);
  if (summary.error) lines.push(`- runner_error: \`${summary.error}\``);
  lines.push('');
  lines.push('## Git status (before)');
  lines.push('```text');
  lines.push(statusBefore || '(empty)');
  lines.push('```');
  lines.push('');

  lines.push('## Steps');
  if (!results.length) {
    lines.push('- (no steps executed)');
  }
  for (const r of results) {
    if (r.status === 'skip') {
      lines.push(`- ⏭️ ${r.name} (skipped: ${r.reason})`);
      lines.push('');
      continue;
    }
    lines.push(formatStepLine(r.name, r.code, r.durationMs, r.logFile));
    const ok = r.code === 0;
    const showTail = ok ? args.tailSuccess > 0 : true;
    if (showTail && r.tailText) {
      lines.push('');
      lines.push(
        `<details><summary>tail (${
          ok ? args.tailSuccess : args.tailFailure
        } lines) - ${r.name}</summary>`
      );
      lines.push('');
      lines.push('```text');
      lines.push(r.tailText);
      lines.push('```');
      lines.push('</details>');
    }
    lines.push('');
  }

  lines.push('## Changed files after lint:fix');
  if (changedAfterLint.length) {
    lines.push(changedAfterLint.map(f => `- \`${f}\``).join('\n'));
  } else {
    lines.push('- (no diff)');
  }
  lines.push('');

  lines.push('## Git status (after)');
  lines.push('```text');
  lines.push(statusAfter || '(empty)');
  lines.push('```');
  lines.push('');

  // "No project validation ran" — policy steps do not count as validation (see overallPass), but a
  // FAILING policy step must still surface as ❌ FAIL rather than be swallowed by this sentinel.
  const policyFailed = results.some(
    r => isPolicyStep(r.name) && r.status !== 'skip' && r.code !== 0
  );
  const noValidationRan =
    results.length > 0 &&
    results.every(r => r.status === 'skip' || isPolicyStep(r.name));
  if (noValidationRan && !policyFailed) {
    // Distinct third state — NOT ✅ PASS (would false-green the gate) and NOT
    // ❌ FAIL (would wedge). Matches neither the hooks' pass grep nor their fail
    // grep, so precommit stays unrecorded (fail-closed); skills/precommit/SKILL.md
    // Step 1 detects this marker and falls through to ecosystem detection.
    lines.push(
      '## Overall: ⚠️ NO CHECKS RUN (no runnable scripts — configure lint/build/test or run ecosystem checks)'
    );
  } else {
    lines.push(`## Overall: ${summary.overallPass ? '✅ PASS' : '❌ FAIL'}`);
  }
  lines.push('');
  lines.push('## Single-test recipes (this repo)');
  const recipes = buildRecipes(pkg, pm);
  for (const r of recipes) {
    lines.push(r);
  }
  lines.push('');

  const summaryMd = lines.join('\n');
  writeText(path.join(logDir, 'summary.md'), summaryMd);
  appendLog(runnerLog, `[${nowISO()}] summary_md_written\n`);
  process.stdout.write(summaryMd);
}

main().catch(e => {
  process.stdout.write(
    `# Precommit\n\n❌ runner crashed: ${String((e && e.stack) || e)}\n`
  );
});
