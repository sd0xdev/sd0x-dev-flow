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
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err)}`.trim() });
    });
    if (child.stdout) {
      child.stdout.on('data', d => {
        stdout += d.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on('data', d => {
        stderr += d.toString();
      });
    }

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

async function gitRemoteOrigin(cwd) {
  const r = await runCapture('git', ['config', '--get', 'remote.origin.url'], {
    cwd,
  });
  return r.code === 0 ? r.stdout.trim() : null;
}

function tailLinesFromFile(filePath, maxLines = 120, maxBytes = 250_000) {
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

  const tailCount = code === 0 ? tailSuccess : tailFailure;
  const tailText = tailLinesFromFile(
    logFile,
    Math.max(tailCount, tailLines),
    300_000
  );

  return { name, code, durationMs, logFile, tailText };
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
    steps.push({ name: 'test_unit', cmd, args: cmdArgs });
    commands.push([cmd, ...cmdArgs].join(' '));
  } else if (hasScript(pkg, 'test')) {
    const [cmd, cmdArgs] = pmCommand(pm, 'test');
    steps.push({ name: 'test_unit', cmd, args: cmdArgs });
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
        steps.push({ name: 'test_integration', cmd, args: cmdArgs });
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
        steps.push({ name: 'test_e2e', cmd, args: cmdArgs });
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
    overallPass: results.length > 0 && results.every(r => r.code === 0),
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
