#!/usr/bin/env node
/**
 * verify-runner.js
 * Verification loop runner (fast/full) with logs + summary output.
 *
 * Outputs:
 * - concise Markdown summary to stdout
 * - logs + summary.json under .claude/cache/verify/<repoKey>/<shortSha>/
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

function formatStepLine(step) {
  if (step.status === 'skip') {
    return `- ⚠️ **${step.name}** (SKIP: ${step.reason})`;
  }
  const ok = step.code === 0;
  const sec = Math.round(step.durationMs / 1000);
  return `- ${ok ? '✅' : '❌'} **${step.name}** (${
    ok ? 'PASS' : `FAIL(${step.code})`
  }, ${sec}s)  \n  log: \`${step.logFile}\``;
}

function parseArgs(argv) {
  const args = {
    mode: 'full',
    tail: 120,
    tailSuccess: 25,
    tailFailure: 120,
    integration: '',
    e2e: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--mode' && v) args.mode = v;
    if (k === 'fast' || k === '--fast') args.mode = 'fast';
    if (k === 'full' || k === '--full') args.mode = 'full';
    if (k === '--tail' && v) args.tail = parseInt(v, 10) || args.tail;
    if (k === '--tail-success' && v)
      args.tailSuccess = parseInt(v, 10) || args.tailSuccess;
    if (k === '--tail-failure' && v)
      args.tailFailure = parseInt(v, 10) || args.tailFailure;
    if (k === '--integration' && v) args.integration = v;
    if (k === '--e2e' && v) args.e2e = v;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = await gitRepoRoot();
  if (!repoRoot) {
    process.stdout.write(`# verify runner\n\n❌ Not inside a git repo.\n`);
    return;
  }

  const head = await gitHead(repoRoot);
  const short = (await gitShortHead(repoRoot)) || 'unknown';
  const remote = (await gitRemoteOrigin(repoRoot)) || repoRoot;
  const repoBase = path.basename(repoRoot);
  const repoKey = `${safeSlug(repoBase)}--${sha1(remote).slice(0, 8)}`;

  const cacheBase =
    process.env.CLAUDE_VERIFY_CACHE_DIR ||
    path.join(repoRoot, '.claude', 'cache', 'verify');
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

  const pm = detectPackageManager(repoRoot);
  const pkg = readPackageJson(repoRoot);

  const lintGlobs = [
    'src/**/*.{ts,tsx,js,jsx}',
    'test/**/*.{ts,tsx,js,jsx}',
    'migrations/**/*.{ts,tsx,js,jsx}',
    '*.{ts,js}',
  ];
  const lintExtraArgs = [
    '--ignore-pattern',
    'node_modules/**',
    '--ignore-pattern',
    '**/node_modules/**',
    '--no-error-on-unmatched-pattern',
    ...lintGlobs,
  ];

  const steps = [];
  const commands = [];

  if (hasScript(pkg, 'lint')) {
    const [cmd, cmdArgs] = pmCommand(pm, 'lint', lintExtraArgs);
    steps.push({
      name: 'lint',
      cmd,
      args: cmdArgs,
      env: { NO_UPDATE_NOTIFIER: '1', XDG_CONFIG_HOME: xdgDir },
    });
    commands.push([cmd, ...cmdArgs].join(' '));
  } else {
    steps.push({ name: 'lint', status: 'skip', reason: 'script missing' });
  }

  if (args.mode !== 'fast') {
    if (hasScript(pkg, 'typecheck')) {
      const [cmd, cmdArgs] = pmCommand(pm, 'typecheck');
      steps.push({ name: 'typecheck', cmd, args: cmdArgs });
      commands.push([cmd, ...cmdArgs].join(' '));
    } else if (fs.existsSync(path.join(repoRoot, 'tsconfig.json'))) {
      steps.push({
        name: 'typecheck',
        cmd: 'npx',
        args: ['tsc', '--noEmit'],
      });
      commands.push('npx tsc --noEmit');
    } else {
      steps.push({
        name: 'typecheck',
        status: 'skip',
        reason: 'tsconfig missing',
      });
    }
  }

  if (hasScript(pkg, 'test:unit')) {
    const [cmd, cmdArgs] = pmCommand(pm, 'test:unit');
    steps.push({ name: 'test_unit', cmd, args: cmdArgs, stdoutFilter: testStdoutFilter });
    commands.push([cmd, ...cmdArgs].join(' '));
  } else if (hasScript(pkg, 'test')) {
    const [cmd, cmdArgs] = pmCommand(pm, 'test');
    steps.push({ name: 'test_unit', cmd, args: cmdArgs, stdoutFilter: testStdoutFilter });
    commands.push([cmd, ...cmdArgs].join(' '));
  } else {
    steps.push({
      name: 'test_unit',
      status: 'skip',
      reason: 'script missing',
    });
  }

  if (args.mode !== 'fast') {
    if (hasScript(pkg, 'test:integration')) {
      if (args.integration) {
        const [cmd, cmdArgs] = pmCommand(pm, 'test:integration', [
          args.integration,
        ]);
        steps.push({ name: 'test_integration', cmd, args: cmdArgs, stdoutFilter: testStdoutFilter });
        commands.push([cmd, ...cmdArgs].join(' '));
      } else {
        steps.push({
          name: 'test_integration',
          status: 'skip',
          reason: 'file not specified (use --integration <path>)',
        });
      }
    } else {
      steps.push({
        name: 'test_integration',
        status: 'skip',
        reason: 'script missing',
      });
    }
    if (hasScript(pkg, 'test:e2e')) {
      if (args.e2e) {
        const [cmd, cmdArgs] = pmCommand(pm, 'test:e2e', [args.e2e]);
        steps.push({ name: 'test_e2e', cmd, args: cmdArgs, stdoutFilter: testStdoutFilter });
        commands.push([cmd, ...cmdArgs].join(' '));
      } else {
        steps.push({
          name: 'test_e2e',
          status: 'skip',
          reason: 'file not specified (use --e2e <path>)',
        });
      }
    } else {
      steps.push({
        name: 'test_e2e',
        status: 'skip',
        reason: 'script missing',
      });
    }
  }

  let statusBefore = '';
  let statusAfter = '';
  let summaryError = '';
  const results = [];

  try {
    statusBefore = await gitStatusSB(repoRoot);
    for (const s of steps) {
      if (s.status === 'skip') {
        results.push(s);
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
    }
    statusAfter = await gitStatusSB(repoRoot);
  } catch (e) {
    summaryError = String((e && e.stack) || e);
  }

  const summary = {
    ...meta,
    statusBefore,
    statusAfter,
    commands,
    steps: results.map(r => ({
      name: r.name,
      code: r.code,
      durationMs: r.durationMs,
      logFile: r.logFile,
      status: r.status,
      reason: r.reason,
    })),
    overallPass: results.length > 0 && results.every(r => r.status === 'skip' || r.code === 0),
    error: summaryError || undefined,
  };
  writeJson(path.join(logDir, 'summary.json'), summary);
  appendLog(runnerLog, `[${nowISO()}] summary_written\n`);

  const lines = [];
  lines.push(`# Verify (${args.mode})`);
  lines.push(`- repo: \`${repoRoot}\``);
  lines.push(`- HEAD: \`${short}\``);
  lines.push(`- logs: \`${logDir}\``);
  if (summary.error) lines.push(`- runner_error: \`${summary.error}\``);
  lines.push('');
  lines.push('## Commands executed');
  if (commands.length) {
    for (const c of commands) lines.push(`- \`${c}\``);
  } else {
    lines.push('- (none)');
  }
  lines.push('');
  lines.push('## Git status (before)');
  lines.push('```text');
  lines.push(statusBefore || '(empty)');
  lines.push('```');
  lines.push('');

  lines.push('## Steps');
  if (!results.length) lines.push('- (no steps executed)');
  for (const r of results) {
    lines.push(formatStepLine(r));
    if (r.status === 'skip') {
      lines.push('');
      continue;
    }
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

  lines.push('## Git status (after)');
  lines.push('```text');
  lines.push(statusAfter || '(empty)');
  lines.push('```');
  lines.push('');

  lines.push(`## Overall: ${summary.overallPass ? '✅ PASS' : '❌ FAIL'}`);
  lines.push('');

  const summaryMd = lines.join('\n');
  writeText(path.join(logDir, 'summary.md'), summaryMd);
  appendLog(runnerLog, `[${nowISO()}] summary_md_written\n`);
  process.stdout.write(summaryMd);
}

main().catch(e => {
  process.stdout.write(
    `# Verify\n\n❌ runner crashed: ${String((e && e.stack) || e)}\n`
  );
});
