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

/**
 * Filter function for stdout streaming.
 * Returns true if the line should be printed to terminal.
 * All lines are always written to the log file regardless.
 */
function defaultStdoutFilter(_line) {
  return true;
}

/** Strip ANSI escape codes so regex matching works on coloured output. */
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

/**
 * For test steps: suppress individual PASS lines, keep FAIL + summary.
 * This prevents 50+ "PASS test/..." lines from flooding the context.
 */
function testStdoutFilter(line) {
  const clean = stripAnsi(line);
  // Always show: FAIL, summary, errors, warnings
  if (/^\s*FAIL\s/.test(clean)) return true;
  if (/^Tests?:\s/.test(clean)) return true;
  if (/^Test Suites?:\s/.test(clean)) return true;
  if (/^Time:\s/.test(clean)) return true;
  if (/^Ran all test suites/.test(clean)) return true;
  if (/FAIL|ERROR|Error|✕|✖/.test(clean)) return true;
  // Suppress: individual PASS lines
  if (/^\s*PASS\s/.test(clean)) return false;
  // Allow everything else (blank lines, other output)
  return true;
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
  stdoutFilter,
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

  const filter = stdoutFilter || defaultStdoutFilter;
  let _lineBuf = '';

  if (child.stdout) {
    child.stdout.on('data', d => {
      out.write(d); // always write full output to log
      // Apply filter: buffer lines, only print matching ones
      _lineBuf += d.toString();
      const parts = _lineBuf.split('\n');
      _lineBuf = parts.pop(); // keep incomplete last line in buffer
      for (const line of parts) {
        if (filter(line)) {
          process.stdout.write(line + '\n');
        }
      }
    });
  }
  if (child.stderr) {
    child.stderr.on('data', d => {
      out.write(d); // always write full output to log
      process.stderr.write(d); // always show stderr
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

  // Flush remaining line buffer
  if (_lineBuf) {
    if (filter(_lineBuf)) {
      process.stdout.write(_lineBuf + '\n');
    }
    _lineBuf = '';
  }

  if (hbInterval) clearInterval(hbInterval);
  // Close log stream safely (error path may have already called out.end)
  if (!out.writableEnded) {
    out.end();
  }
  await new Promise(resolve => {
    if (out.writableFinished) resolve();
    else out.on('finish', resolve);
  });
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

let _pluginName = null;
function getPluginName() {
  if (_pluginName !== null) return _pluginName;
  try {
    const pluginRoot = path.resolve(__dirname, '../..');
    const pj = JSON.parse(fs.readFileSync(
      path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
    _pluginName = pj.name || '';
  } catch { _pluginName = ''; }
  return _pluginName;
}

function qualifyCommand(cmd) {
  const name = getPluginName();
  if (!name || !cmd || !cmd.startsWith('/')) return cmd;
  if (cmd.startsWith('/' + name + ':')) return cmd;
  return '/' + name + ':' + cmd.slice(1);
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

module.exports = {
  nowISO,
  sha1,
  safeSlug,
  ensureDir,
  writeText,
  writeJson,
  appendLog,
  runCapture,
  runStep,
  tailLinesFromFile,
  stripAnsi,
  defaultStdoutFilter,
  testStdoutFilter,
  gitRepoRoot,
  gitShortHead,
  gitHead,
  gitStatusSB,
  gitRemoteOrigin,
  getPluginName,
  qualifyCommand,
  detectPackageManager,
  readPackageJson,
  hasScript,
  pmCommand,
};
