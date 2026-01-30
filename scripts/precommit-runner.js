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
const crypto = require('crypto');
const { spawn } = require('child_process');

function nowISO() {
  return new Date().toISOString();
}

function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

function safeSlug(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function writeText(p, s) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, s, 'utf8');
}

function writeJson(p, obj) {
  writeText(p, JSON.stringify(obj, null, 2));
}

function appendLog(p, s) {
  try {
    fs.appendFileSync(p, s, 'utf8');
  } catch {}
}

function runCapture(cmd, args, opts = {}) {
  return new Promise(resolve => {
    let settled = false;
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd || process.cwd(),
        env: { ...process.env, ...(opts.env || {}) },
        shell: false,
      });
    } catch (e) {
      resolve({ code: 127, stdout: '', stderr: String(e) });
      return;
    }

    let stdout = '';
    let stderr = '';
    child.on('error', err => {
      if (settled) return;
      settled = true;
      resolve({
        code: 127,
        stdout,
        stderr: `${stderr}\n${String(err)}`.trim(),
      });
    });
    child.stdout.on('data', d => {
      stdout += d.toString();
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function gitRepoRoot() {
  const r = await runCapture('git', ['rev-parse', '--show-toplevel']);
  if (r.code !== 0 || !r.stdout.trim()) return null;
  return r.stdout.trim();
}

async function gitShortHead(cwd) {
  const r = await runCapture('git', ['rev-parse', '--short', 'HEAD'], { cwd });
  return r.code === 0 ? r.stdout.trim() : null;
}

async function gitHead(cwd) {
  const r = await runCapture('git', ['rev-parse', 'HEAD'], { cwd });
  return r.code === 0 ? r.stdout.trim() : null;
}

async function gitStatusSB(cwd) {
  const r = await runCapture('git', ['status', '-sb'], { cwd });
  return (r.code === 0 ? r.stdout.trim() : r.stderr.trim()) || '';
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

async function gitRemoteOrigin(cwd) {
  const r = await runCapture('git', ['config', '--get', 'remote.origin.url'], {
    cwd,
  });
  return r.code === 0 ? r.stdout.trim() : null;
}

function tailLinesFromFile(filePath, maxLines = 120, maxBytes = 250_000) {
  // Read at most last maxBytes bytes, then take last maxLines lines.
  try {
    const st = fs.statSync(filePath);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);

    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/);
    const tail = lines.slice(Math.max(0, lines.length - maxLines));
    return tail.join('\n').trim();
  } catch {
    return '';
  }
}

function formatStepLine(name, code, ms, logFile) {
  const ok = code === 0;
  const sec = Math.round(ms / 1000);
  return `- ${ok ? '✅' : '❌'} **${name}** (${
    ok ? 'PASS' : `FAIL(${code})`
  }, ${sec}s)  \n  log: \`${logFile}\``;
}

async function runStep({
  name,
  cmd,
  args,
  cwd,
  env,
  logDir,
  tailSuccess,
  tailFailure,
  tailLines,
  heartbeatMs,
}) {
  const startedAt = Date.now();
  const logFile = path.join(logDir, `${name}.log`);
  ensureDir(logDir);

  // stream to file
  const out = fs.createWriteStream(logFile, { flags: 'w' });
  const hbInterval =
    typeof heartbeatMs === 'number' && heartbeatMs > 0
      ? setInterval(() => {
          process.stdout.write(`> ${name} running...\n`);
        }, heartbeatMs)
      : null;

  let settled = false;
  let child;
  try {
    child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...(env || {}) },
      shell: false,
    });
  } catch (e) {
    if (hbInterval) clearInterval(hbInterval);
    out.end(`spawn error: ${String(e)}\n`);
    await new Promise(resolve => out.on('finish', resolve));
    return {
      name,
      code: 127,
      durationMs: Date.now() - startedAt,
      logFile,
      tailText: tailLinesFromFile(logFile, tailLines, 300_000),
    };
  }

  if (child.stdout) {
    child.stdout.on('data', d => {
      out.write(d);
      process.stdout.write(d);
    });
  }
  if (child.stderr) {
    child.stderr.on('data', d => {
      out.write(d);
      process.stderr.write(d);
    });
  }

  const code = await new Promise(resolve => {
    child.on('error', err => {
      if (settled) return;
      settled = true;
      out.end(`spawn error: ${String(err)}\n`);
      resolve(127);
    });
    child.on('close', c => {
      if (settled) return;
      settled = true;
      resolve(c ?? 0);
    });
  });

  if (hbInterval) clearInterval(hbInterval);
  out.end();
  await new Promise(resolve => out.on('finish', resolve));
  const durationMs = Date.now() - startedAt;

  // Tail policy: success prints fewer lines, failure prints more.
  const tailCount = code === 0 ? tailSuccess : tailFailure;
  const tailText = tailLinesFromFile(
    logFile,
    Math.max(tailCount, tailLines),
    300_000
  );

  return { name, code, durationMs, logFile, tailText };
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function readPackageJson(root) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    );
  } catch {
    return null;
  }
}

function hasScript(pkg, name) {
  return !!(pkg && pkg.scripts && typeof pkg.scripts[name] === 'string');
}

function pmCommand(pm, script, extraArgs = []) {
  if (pm === 'yarn') return ['yarn', [script, ...extraArgs]];
  if (pm === 'pnpm') return ['pnpm', [script, ...extraArgs]];
  return ['npm', ['run', script, '--', ...extraArgs]];
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
      steps.push({ name: 'test_unit', cmd, args: testArgs });
    } else if (hasScript(pkg, 'test')) {
      const [cmd, testArgs] = pmCommand(pm, 'test');
      steps.push({ name: 'test_unit', cmd, args: testArgs });
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
