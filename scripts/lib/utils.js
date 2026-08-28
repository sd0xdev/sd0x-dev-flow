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
 *
 * Two ecosystems are handled:
 *  - jest-shaped: `PASS test/…` / `FAIL test/…` / `Tests:` summary (rules below).
 *  - TAP (node:test): `ok N - name` passing points, `# Subtest:` headers, and a
 *    per-test `--- / duration_ms: / ...` YAML block. node:test emits one such block
 *    PER PASSING TEST, so on a large suite (2000+ tests) an unfiltered stream is
 *    400KB+ — it floods the context this filter exists to protect AND overruns the
 *    host's tool-output persistence threshold, which truncates the runner's trailing
 *    `## Overall:` verdict and breaks precommit state recording. The TAP rules are
 *    matched on the whitespace-TRIMMED content so NESTED subtests (indented `ok`/
 *    `not ok`) are handled without blanket-suppressing indented failure diagnostics.
 *
 * This filter governs the LIVE STREAM only and is content-unaware: inside a FAILING
 * test's diagnostic body, a line that happens to start `ok <n>`/`---`/`...`/`duration_ms:`
 * is still suppressed from the stream. That is cosmetic — on failure the runner reprints
 * the full, UNFILTERED log tail (runStep) and the log file is written verbatim, so the
 * failure tail (not this stream) is the authoritative diagnostic. The gate verdict itself
 * derives from child EXIT CODES and the runner's own `## Overall:` line, neither of which
 * is routed through this filter.
 */
function testStdoutFilter(line) {
  const clean = stripAnsi(line);
  // TAP (node:test) noise suppression — evaluated first so a passing test whose
  // NAME contains "Error"/"FAIL" is still suppressed, while a failing `not ok`
  // (even nested/indented) is always kept.
  // Trim leading indentation (nested subtests) AND a single trailing CR, so a
  // CRLF-emitting test command matches identically to an LF one — runStep splits
  // on '\n' and leaves the '\r', which would otherwise defeat the exact `---`/`...`
  // matches and re-open the per-test flood on CRLF hosts.
  const tap = clean.replace(/^\s+/, '').replace(/\r$/, '');
  if (/^not ok\b/.test(tap)) return true; // TAP failure point — always show (nested too)
  // Suppress a real TAP test-point (`ok <number>`) only. A non-TAP line that merely
  // begins with "ok " (e.g. `ok diagnostic: database unavailable`) is NOT a test point
  // and must stay visible.
  if (/^ok\s+\d+\b/.test(tap)) return false; // TAP passing test-point — suppress
  if (tap.startsWith('# Subtest:')) return false; // per-test header, redundant with ok/not ok
  // node:test `spec` reporter passing line: `✔ <name> (1.234ms)`, indented for nested subtests.
  // Only the TAP `ok <n>` form was suppressed, so a project whose test command sets
  // `--test-reporter=spec` (or a Node version that defaults to spec on a TTY) floods the tail with
  // one line per PASSING test — exactly the noise this filter exists to remove, and enough of it to
  // push the actual failure out of the captured window. The failing counterpart `✖` is deliberately
  // NOT matched here; it falls through to the `✕|✖` always-show rule below.
  if (/^✔[\s(]/.test(tap)) return false;
  if (tap === '---' || tap === '...' || tap.startsWith('duration_ms:')) return false; // per-test YAML framing noise
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
    const envRoot = process.env.PLUGIN_ROOT;
    const pluginRoot = (envRoot
      && fs.existsSync(path.join(envRoot, 'scripts', 'lib', 'utils.js'))
      && fs.existsSync(path.join(envRoot, '.claude-plugin', 'plugin.json')))
      ? envRoot
      : path.resolve(__dirname, '../..');
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

const DEFAULT_LINT_GLOBS = [
  'src/**/*.{ts,tsx,js,jsx}',
  'test/**/*.{ts,tsx,js,jsx}',
  'migrations/**/*.{ts,tsx,js,jsx}',
  'loadtest/**/*.{ts,tsx,js,jsx}',
  '*.{ts,js}',
];

const DEFAULT_VERIFY_LINT_GLOBS = [
  'src/**/*.{ts,tsx,js,jsx}',
  'test/**/*.{ts,tsx,js,jsx}',
  'migrations/**/*.{ts,tsx,js,jsx}',
  '*.{ts,js}',
];

const LINT_ARG_MODES = new Set(['eslint', 'none']);

/** Describe a rejected config value by TYPE, never content: these warnings reach the runner's
 * stdout, and a diagnostic cannot know whether the field it echoes holds a secret
 * (`rules/security.md`, `rules/logging.md`). Role, source and expected values are enough to act on.
 * @param {*} v the rejected value
 * @returns {string} a content-free description
 */
function describeRejected(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === 'string') return `string(${v.length} chars)`;
  return typeof v;
}

// The runner used to append ESLint's flags (`--ignore-pattern`, `--no-error-on-unmatched-pattern`)
// and JS/TS globs to whatever `lint`/`lint:fix` a repo declares. markdownlint-cli2 treats every
// unrecognised argument as a FILE GLOB, so under `--fix` it rewrote JavaScript as Markdown:
// `branch.split('/')[1]` became `branch.split['/'](1)`. One `/precommit` run on this repo corrupted
// 71 files that were clean at HEAD, five into syntax errors.
//
// Detecting "is this really ESLint?" from the script text was tried and abandoned: four grammars,
// each shown to misclassify toward injection — package specs (`npx @scope/eslint`), aliases
// (`eslint@npm:markdownlint-cli2`), wrapper options taking an operand (`npx --package eslint <cmd>`),
// package-script dispatch (`pnpm eslint` resolving to a markdownlint script), compound commands
// whose tail is the real recipient. The space is every package manager's CLI and it moves.
//
// So: no detection, and no injection by default. A declared script is already a complete command
// stating its own scope. A repo that wants the globs says so **per script role**, because `lint`
// and `lint:fix` routinely run different engines and one shared switch would force the arguments
// into whichever the author was not thinking about:
//
//   package.json               → { "sd0x": { "lintArgMode": { "lint:fix": "eslint" } } }
//   .claude/runner-config.json → { "lintArgMode": { "lint": "eslint" } }

/** Decide what to append to a repo-declared lint script.
 *
 * @param {string[]} globs resolved lint globs
 * @param {{lintArgMode?: string, globsConfigured?: boolean, warn?: (msg: string) => void}} [opts]
 *   `lintArgMode` is already resolved for THIS script role by `loadLintConfig(root, role)`.
 */
function lintArgsFor(globs, opts = {}) {
  const warn = typeof opts.warn === 'function' ? opts.warn : () => {};
  let mode = opts.lintArgMode;
  if (mode !== undefined && !LINT_ARG_MODES.has(mode)) {
    warn(`ignoring lintArgMode (${describeRejected(mode)}): expected one of ${[...LINT_ARG_MODES].join(', ')}`);
    mode = undefined;
  }
  if (mode === 'eslint') {
    return {
      args: [
        '--ignore-pattern',
        'node_modules/**',
        '--ignore-pattern',
        '**/node_modules/**',
        '--no-error-on-unmatched-pattern',
        ...globs,
      ],
      skipped: false,
      reason: null,
    };
  }
  const tail = opts.globsConfigured
    ? '; configured lintGlobs are ignored until lintArgMode is set for this script role'
    : '';
  return {
    args: [],
    skipped: true,
    reason: mode === 'none'
      ? 'lintArgMode=none: injection disabled by config'
      : `no lintArgMode set for this script role; running the script as declared${tail}`,
  };
}

/** Read the lint-argument config for ONE script role, from the two places `loadLintGlobs` reads:
 *  `.claude/runner-config.json`, then `package.json` → `sd0x`.
 *
 *  `lintArgMode` must be an object keyed by script role — `{"lint": "eslint"}` — never a bare
 *  string. `lint` and `lint:fix` routinely run different engines (this repo runs markdownlint for
 *  `lint:fix`), and one shared value would force eslint arguments into whichever of them the user
 *  was not thinking about. A string is rejected rather than guessed at.
 *
 * @param {string} repoRoot
 * @param {string} role 'lint' or 'lint:fix'
 * @param {(msg: string) => void} [warn]
 */
function loadLintConfig(repoRoot, role, warn = () => {}) {
  const out = { lintArgMode: undefined, globsConfigured: false };
  const read = (src, where) => {
    if (!src || typeof src !== 'object') return;
    if (Array.isArray(src.lintGlobs)) out.globsConfigured = true;
    if (src.lintArgMode === undefined || out.lintArgMode !== undefined) return;
    if (typeof src.lintArgMode === 'string') {
      warn(`ignoring lintArgMode in ${where}: it must be keyed by script role, e.g. {"${role}": "eslint"}`);
      return;
    }
    if (typeof src.lintArgMode !== 'object' || src.lintArgMode === null || Array.isArray(src.lintArgMode)) {
      // Every unusable SHAPE reports, not just the two that happened to be handled. `false`, `[]`,
      // `null` and numbers fell through in silence — and that silence lands on the safety path: a
      // malformed `.claude` value written to suppress a lower-priority opt-in would let that
      // opt-in through with nothing said.
      warn(`ignoring lintArgMode in ${where}: expected an object keyed by script role, e.g. {"${role}": "eslint"}`);
      return;
    }
    {
      const v = src.lintArgMode[role];
      if (v === undefined) return;
      // Validate HERE, not after both sources are read. Storing an invalid value would make
      // `out.lintArgMode !== undefined` and veto a valid lower-priority value — an unusable setting
      // silently overriding a usable one is the opposite of "reported and ignored".
      if (typeof v !== 'string' || !LINT_ARG_MODES.has(v)) {
        warn(`ignoring lintArgMode.${role} (${describeRejected(v)}) in ${where}: expected one of ${[...LINT_ARG_MODES].join(', ')}`);
        return;
      }
      out.lintArgMode = v;
    }
  };
  try {
    read(
      JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude', 'runner-config.json'), 'utf8')),
      '.claude/runner-config.json'
    );
  } catch { /* absent or unreadable — defaults stand */ }
  try {
    read(JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).sd0x, 'package.json#sd0x');
  } catch { /* absent or unreadable — defaults stand */ }
  return out;
}

function loadLintGlobs(repoRoot, fallbackGlobs) {
  // Priority 1: .claude/runner-config.json → lintGlobs
  try {
    const cfgPath = path.join(repoRoot, '.claude', 'runner-config.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (Array.isArray(cfg.lintGlobs) && cfg.lintGlobs.every(g => typeof g === 'string')) {
      return cfg.lintGlobs;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Content-free: `JSON.parse` quotes the offending source in its message, so writing
      // `e.message` publishes whatever is in the file (`"S3CR3T99" is not valid JSON`). Same rule
      // as describeRejected() — the path and the error class are actionable, the content is not.
      process.stderr.write(
        `[runner] Warning: cannot read .claude/runner-config.json (${e.name || 'Error'}); using defaults\n`
      );
    }
  }
  // Priority 2: package.json → sd0x.lintGlobs
  try {
    const pkg = readPackageJson(repoRoot);
    if (pkg && pkg.sd0x && Array.isArray(pkg.sd0x.lintGlobs) && pkg.sd0x.lintGlobs.every(g => typeof g === 'string')) {
      return pkg.sd0x.lintGlobs;
    }
  } catch {}
  // Fallback
  return [...(fallbackGlobs || DEFAULT_LINT_GLOBS)];
}

function buildRecipes(pkg, pm) {
  const recipes = [];
  if (!pkg || !pkg.scripts) {
    recipes.push(`- Test: \`${pm === 'npm' ? 'npm test -- <path>' : pm + ' test <path>'}\``);
    return recipes;
  }
  const scriptNames = ['test:unit', 'test:integration', 'test:e2e', 'test:fast', 'test:ci'];
  const labels = { 'test:unit': 'Unit', 'test:integration': 'Integration', 'test:e2e': 'E2E', 'test:fast': 'Fast', 'test:ci': 'CI' };
  for (const name of scriptNames) {
    if (pkg.scripts[name]) {
      const [cmd, args] = pmCommand(pm, name, ['<path>']);
      recipes.push(`- ${labels[name]}: \`${cmd} ${args.join(' ')}\``);
    }
  }
  if (recipes.length === 0) {
    if (pkg.scripts.test) {
      recipes.push(`- Test: \`${pm === 'npm' ? 'npm test -- <path>' : pm + ' test <path>'}\``);
    } else {
      recipes.push('- (no test scripts detected in package.json)');
    }
  }
  return recipes;
}

module.exports = {
  describeRejected,
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
  DEFAULT_LINT_GLOBS,
  DEFAULT_VERIFY_LINT_GLOBS,
  lintArgsFor,
  loadLintConfig,
  loadLintGlobs,
  buildRecipes,
};
