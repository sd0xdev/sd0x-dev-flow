#!/usr/bin/env node
/**
 * precommit-runner.js
 * Engineering-grade precommit runner (package-manager agnostic):
 * - full: lint:fix && build && test:unit
 * - fast: lint:fix && test:unit
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
} = require('./lib/utils');

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

  try {
    statusBefore = await gitStatusSB(repoRoot);

    const pm = detectPackageManager(repoRoot);
    const pkg = readPackageJson(repoRoot);
    process.stdout.write(`> package manager: ${pm}\n`);

    const steps = [];
    const lintGlobs = [
      'src/**/*.{ts,tsx,js,jsx}',
      'test/**/*.{ts,tsx,js,jsx}',
      'migrations/**/*.{ts,tsx,js,jsx}',
      'loadtest/**/*.{ts,tsx,js,jsx}',
      '*.{ts,js}',
    ];

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
    }

    // build (full mode only)
    if (args.mode === 'full') {
      if (hasScript(pkg, 'build')) {
        const [cmd, buildArgs] = pmCommand(pm, 'build');
        steps.push({ name: 'build', cmd, args: buildArgs });
      } else {
        process.stdout.write(`> skip build (no "build" script in package.json)\n`);
      }
    }

    // test:unit
    if (hasScript(pkg, 'test:unit')) {
      const [cmd, testArgs] = pmCommand(pm, 'test:unit');
      steps.push({ name: 'test_unit', cmd, args: testArgs, stdoutFilter: testStdoutFilter });
    } else if (hasScript(pkg, 'test')) {
      const [cmd, testArgs] = pmCommand(pm, 'test');
      steps.push({ name: 'test_unit', cmd, args: testArgs, stdoutFilter: testStdoutFilter });
      process.stdout.write(`> fallback: using "test" instead of "test:unit"\n`);
    } else {
      process.stdout.write(`> skip test_unit (no "test:unit" or "test" script in package.json)\n`);
    }

    for (const s of steps) {
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
    })),
    overallPass: results.length > 0 && results.every(r => r.code === 0),
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

  lines.push(`## Overall: ${summary.overallPass ? '✅ PASS' : '❌ FAIL'}`);
  lines.push('');
  lines.push('## Single-test recipes (this repo)');
  lines.push('- Unit: `npx jest test/unit/provider/yourchain.test.ts`');
  lines.push(
    '- Integration: `TEST_ENV=integration npx jest test/integration/chains/yourchain.test.ts -i`'
  );
  lines.push('- E2E: `TEST_ENV=e2e npx jest test/e2e/yourchain.test.ts`');
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
