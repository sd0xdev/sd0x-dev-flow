#!/usr/bin/env node
/**
 * precommit-runner.js
 * Engineering-grade precommit runner (package-manager agnostic):
 * - full: lint:fix && build && test (tiered: test:ci > test > test:fast > test:unit)
 * - fast: lint:fix && test (tiered: test:fast > test:unit > test)
 * Auto-detects yarn/pnpm/npm from lockfile.
 * Multi-ecosystem orchestrator (WB2b): detects non-Node manifests (pyproject.toml,
 * Cargo.toml, go.mod, build.gradle, pom.xml, Gemfile) and runs their checks as
 * first-class steps with the same receipt append as the Node path.
 *
 * Outputs:
 * - concise Markdown summary to stdout (for Claude Code context)
 * - writes full logs to .claude/cache/precommit/<repoKey>/<shortSha>/
 *   (or $CLAUDE_PRECOMMIT_CACHE_DIR)
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// stdout is a diagnostic sink, never the verdict channel: an early-closing pipe
// (e.g. `runner | head`) raises EPIPE, and an unhandled one would kill the
// process before the receipt append. Losing the sink must not lose the gate.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
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

// Content-addressed receipt producer (WB2,
// docs/features/auto-loop-evolution/2-tech-spec/2-content-addressed-receipts.md §3.4).
// Optional: the installed copy in a consuming project may not ship these libs — there the
// legacy stdout-parsing route still governs, so absence degrades to today's behaviour.
let receiptLog = null;
let treeDigest = null;
try {
  receiptLog = require('./lib/receipt-log');
  treeDigest = require('./lib/tree-digest');
} catch {
  receiptLog = null;
  treeDigest = null;
}

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

// Multi-ecosystem orchestration (WB2b, spec §3.4 round-6). The runner is the
// single receipt producer, so it must close the gate for the same ecosystems
// the precommit Skill's fallback table covers — the rows below encode
// skills/precommit/SKILL.md § Ecosystem detection (the canonical human-facing
// table). Absence comes in two kinds and they are NOT interchangeable:
//
// - A REQUIRED tool missing from the environment (ruff, pytest, cargo, go,
//   golangci-lint, mvn, bundle, the gradle wrapper) marks the step
//   `unavailable`: it never counts as "validation ran" AND it blocks a PASS —
//   a detected ecosystem whose pinned check cannot execute is incomplete
//   validation, and letting another passing step mint the receipt anyway is
//   the false-green this distinction exists to prevent.
// - A repo-declared capability absent (no spotless task, rubocop/rspec not in
//   the bundle) is an ordinary skip, mirroring a missing package.json script:
//   the repo opted out. Only DEFINITIVE evidence of non-membership earns the
//   skip — a Gemfile.lock read for Ruby, Gradle's own task-not-found
//   diagnostic ("'spotlessApply' not found") from `gradlew help --task`,
//   Maven's own "No plugin found for prefix"
//   marker — never a manifest grep (convention plugins, parent POMs and
//   gemspec-sourced gems all configure tools the manifest text never names)
//   and never a bare non-zero exit (a broken executable is not an opt-out).
//   Every ambiguous probe failure classifies as `unavailable`.
const PROBE_OUTPUT_CAP = 65536;
function probeTimeoutMs() {
  const v = parseInt(process.env.PRECOMMIT_PROBE_TIMEOUT_MS || '', 10);
  return Number.isFinite(v) && v > 0 ? v : 120000;
}

// Live probe process groups, so external termination of the runner can reap
// them: the timeout callback dies with the parent, and a detached wrapper
// (gradlew's JVM, mvn's resolver) left orphaned would keep executing
// repository-controlled build configuration after the gate reported
// interrupted. POSIX-only invariant — on Windows the fallback kills the
// direct child alone and descendant cleanup is explicitly not guaranteed.
const liveProbeGroups = new Set();
function killProbeGroup(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}
let probeSignalHandlersInstalled = false;
function installProbeSignalHandlers() {
  if (probeSignalHandlersInstalled || process.platform === 'win32') return;
  probeSignalHandlersInstalled = true;
  const signals = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
  for (const [sig, num] of Object.entries(signals)) {
    process.on(sig, () => {
      for (const pid of liveProbeGroups) killProbeGroup(pid);
      liveProbeGroups.clear();
      // Conventional signal exit code, since the handler replaced the default
      // terminate-on-signal disposition.
      process.exit(128 + num);
    });
  }
}

// Bounded probe runner: ecosystem discovery may invoke heavyweight tools
// (gradle wrapper startup, maven plugin resolution), so every probe carries a
// timeout and an output cap — a stalled probe classifies as a failed one
// instead of wedging precommit before its first step ever logs.
function runProbe(cmd, probeArgs, opts = {}) {
  return new Promise(resolve => {
    // Handlers BEFORE spawn (round-5): with the default terminate-on-signal
    // disposition still in place, a signal landing between child creation and
    // handler installation would kill the runner with the detached probe
    // already alive and unregistered — the exact orphan this machinery
    // closes. Installed first, a signal delivered during the synchronous
    // spawn call queues behind it, and by the time the JS handler runs the
    // pid is in the registry (the add below is in the same tick).
    installProbeSignalHandlers();
    let child;
    try {
      child = spawn(cmd, probeArgs, {
        cwd: opts.cwd,
        env: process.env,
        shell: false,
        // Own process group (POSIX): a probe's grandchildren (wrapper scripts
        // fork their real tool — gradlew forks a JVM) must die with it on
        // timeout, or they keep running beside lint/build/test and can mutate
        // the tree after the validation baseline.
        detached: process.platform !== 'win32',
      });
    } catch (e) {
      resolve({ code: 127, out: String(e), timedOut: false });
      return;
    }
    if (process.platform !== 'win32' && child.pid) {
      liveProbeGroups.add(child.pid);
    }
    let out = '';
    const onData = d => {
      if (out.length < PROBE_OUTPUT_CAP) {
        out += d.toString('utf8').slice(0, PROBE_OUTPUT_CAP - out.length);
      }
    };
    if (child.stdout) child.stdout.on('data', onData);
    if (child.stderr) child.stderr.on('data', onData);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Kill the whole process GROUP (negative pid), not just the direct
      // child — a surviving grandchild would keep running beside the real
      // steps. killProbeGroup falls back to a single-process kill where the
      // group form is unsupported (Windows, or the child died before
      // setpgid).
      killProbeGroup(child.pid);
      liveProbeGroups.delete(child.pid);
      // Belt over the kill: destroying the streams releases Node's event
      // loop even if some group member escaped (setsid'd itself) while
      // holding the stdio pipes.
      if (child.stdout) child.stdout.destroy();
      if (child.stderr) child.stderr.destroy();
      resolve({ code: -1, out, timedOut: true });
    }, opts.timeoutMs || probeTimeoutMs());
    child.on('error', e => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      liveProbeGroups.delete(child.pid);
      resolve({ code: 127, out: String(e), timedOut: false });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      liveProbeGroups.delete(child.pid);
      resolve({ code: code == null ? -1 : code, out, timedOut: false });
    });
  });
}

async function buildEcosystemSteps(repoRoot, mode, opts = {}) {
  const log = opts.log || (() => {});
  const probeCache = new Map();
  async function probe(bin, probeArgs) {
    const key = `${bin} ${probeArgs.join(' ')}`;
    if (!probeCache.has(key)) {
      const started = Date.now();
      const r = await runProbe(bin, probeArgs, { cwd: repoRoot });
      log(
        `probe ${key} -> code=${r.code}${r.timedOut ? ' (timeout)' : ''} ${
          Date.now() - started
        }ms`
      );
      probeCache.set(key, r);
    }
    return probeCache.get(key);
  }
  const toolOk = async (bin, probeArgs) => (await probe(bin, probeArgs)).code === 0;
  const has = rel => fs.existsSync(path.join(repoRoot, rel));

  const detected = [];
  const lint = [];
  const build = [];
  const test = [];
  const runnable = (arr, name, cmd, cmdArgs) => arr.push({ name, cmd, args: cmdArgs });
  const skip = (arr, name, reason) => arr.push({ name, status: 'skip', reason });
  const unavailable = (arr, name, reason) =>
    arr.push({ name, status: 'unavailable', reason });

  // Python — pyproject.toml
  if (has('pyproject.toml')) {
    detected.push('python');
    process.stdout.write('> probing python toolchain\n');
    if (await toolOk('ruff', ['--version'])) {
      runnable(lint, 'python_lint_fix', 'ruff', ['check', '--fix', '.']);
    } else {
      unavailable(lint, 'python_lint_fix', 'tool missing: ruff');
    }
    if (await toolOk('pytest', ['--version'])) {
      // The table command is `pytest tests/unit/`; when that directory does
      // not exist the runner falls back to bare `pytest` — pytest's own
      // config-driven discovery (testpaths/rootdir) — rather than guessing
      // further directory names. A repo with no tests then FAILS loudly
      // (pytest exit 5, "no tests collected") instead of silently skipping
      // the suite.
      runnable(
        test,
        'python_test',
        'pytest',
        has('tests/unit') ? ['tests/unit'] : []
      );
    } else {
      unavailable(test, 'python_test', 'tool missing: pytest');
    }
  }

  // Rust — Cargo.toml
  if (has('Cargo.toml')) {
    detected.push('rust');
    process.stdout.write('> probing rust toolchain\n');
    if (await toolOk('cargo', ['clippy', '--version'])) {
      // Precommit runs on a dirty tree by definition, so clippy's dirty-tree
      // refusal is disabled — applying the fix is the point of the step.
      runnable(lint, 'rust_lint_fix', 'cargo', [
        'clippy',
        '--fix',
        '--allow-dirty',
        '--allow-staged',
      ]);
    } else {
      unavailable(lint, 'rust_lint_fix', 'tool missing: cargo clippy');
    }
    if (await toolOk('cargo', ['--version'])) {
      if (mode === 'full') runnable(build, 'rust_build', 'cargo', ['build']);
      runnable(test, 'rust_test', 'cargo', ['test']);
    } else {
      if (mode === 'full') unavailable(build, 'rust_build', 'tool missing: cargo');
      unavailable(test, 'rust_test', 'tool missing: cargo');
    }
  }

  // Go — go.mod
  if (has('go.mod')) {
    detected.push('go');
    process.stdout.write('> probing go toolchain\n');
    if (await toolOk('golangci-lint', ['version'])) {
      runnable(lint, 'go_lint_fix', 'golangci-lint', ['run', '--fix']);
    } else {
      unavailable(lint, 'go_lint_fix', 'tool missing: golangci-lint');
    }
    if (await toolOk('go', ['version'])) {
      if (mode === 'full') runnable(build, 'go_build', 'go', ['build', './...']);
      runnable(test, 'go_test', 'go', ['test', './...']);
    } else {
      if (mode === 'full') unavailable(build, 'go_build', 'tool missing: go');
      unavailable(test, 'go_test', 'tool missing: go');
    }
  }

  // Java (Gradle) — build.gradle / build.gradle.kts; wrapper only, never a
  // global `gradle` (version drift between a global install and the project's
  // pinned wrapper is exactly what the wrapper exists to prevent).
  if (has('build.gradle') || has('build.gradle.kts')) {
    detected.push('gradle');
    process.stdout.write('> probing gradle toolchain\n');
    const wrapper = path.join(repoRoot, 'gradlew');
    let wrapperOk = false;
    try {
      fs.accessSync(wrapper, fs.constants.X_OK);
      wrapperOk = true;
    } catch {
      wrapperOk = false;
    }
    if (!wrapperOk) {
      unavailable(lint, 'gradle_lint_fix', 'tool missing: gradle wrapper (gradlew)');
      if (mode === 'full') unavailable(build, 'gradle_build', 'tool missing: gradle wrapper (gradlew)');
      unavailable(test, 'gradle_test', 'tool missing: gradle wrapper (gradlew)');
    } else {
      // Tool-native task discovery, definitive-marker form (round-3 finding:
      // a `help --task` failure alone proves nothing — Gradle realizes tasks
      // lazily, so a configured-but-broken spotlessApply fails the probe the
      // same way an absent one does). Skip ONLY on Gradle's own
      // task-not-found diagnostic ("Task 'spotlessApply' not found in …");
      // any other failure — config error, broken task, timeout — is
      // ambiguous and marks the step unavailable. Build/test still run so a
      // broken build fails loudly on its own step.
      const task = await probe(wrapper, ['help', '--task', 'spotlessApply']);
      if (task.code === 0) {
        runnable(lint, 'gradle_lint_fix', wrapper, ['spotlessApply']);
      } else if (task.timedOut) {
        unavailable(lint, 'gradle_lint_fix', 'gradle spotless probe timed out');
      } else if (task.out.includes("'spotlessApply' not found")) {
        skip(lint, 'gradle_lint_fix', 'spotless task not found');
      } else {
        unavailable(
          lint,
          'gradle_lint_fix',
          'gradle spotless probe failed (ambiguous)'
        );
      }
      if (mode === 'full') runnable(build, 'gradle_build', wrapper, ['build']);
      runnable(test, 'gradle_test', wrapper, ['test']);
    }
  }

  // Java (Maven) — pom.xml
  if (has('pom.xml')) {
    detected.push('maven');
    process.stdout.write('> probing maven toolchain\n');
    if (await toolOk('mvn', ['--version'])) {
      // Prefix resolution consults the effective model, so a spotless plugin
      // inherited from a parent POM resolves even though pom.xml never names
      // it. A failing probe is definitive absence ONLY on Maven's own
      // "No plugin found for prefix" marker (round-2 finding) — any other
      // failure (network, repository, plugin resolution) is ambiguous and
      // marks the step unavailable rather than silently skipping it.
      const sp = await probe('mvn', ['help:describe', '-Dplugin=spotless', '-q']);
      if (sp.code === 0) {
        runnable(lint, 'maven_lint_fix', 'mvn', ['spotless:apply']);
      } else if (!sp.timedOut && sp.out.includes('No plugin found for prefix')) {
        skip(lint, 'maven_lint_fix', 'spotless plugin not resolvable');
      } else {
        unavailable(lint, 'maven_lint_fix', 'mvn spotless probe failed (ambiguous)');
      }
      if (mode === 'full') runnable(build, 'maven_build', 'mvn', ['compile']);
      runnable(test, 'maven_test', 'mvn', ['test']);
    } else {
      unavailable(lint, 'maven_lint_fix', 'tool missing: mvn');
      if (mode === 'full') unavailable(build, 'maven_build', 'tool missing: mvn');
      unavailable(test, 'maven_test', 'tool missing: mvn');
    }
  }

  // Ruby — Gemfile
  if (has('Gemfile')) {
    detected.push('ruby');
    process.stdout.write('> probing ruby toolchain\n');
    if (!(await toolOk('bundle', ['--version']))) {
      unavailable(lint, 'ruby_lint_fix', 'tool missing: bundle');
      unavailable(test, 'ruby_test', 'tool missing: bundle');
    } else if (!(await toolOk('bundle', ['check']))) {
      // The bundle is declared but not installed — `bundle exec <tool>
      // --version` failing here could not distinguish "not in the bundle"
      // (a repo choice → skip) from "not installed" (an environment gap →
      // unavailable), so the check runs first and fails the whole ecosystem
      // closed.
      unavailable(lint, 'ruby_lint_fix', 'bundle install not run (bundle check failed)');
      unavailable(test, 'ruby_test', 'bundle install not run (bundle check failed)');
    } else {
      // Membership comes from Gemfile.lock — repo-declared and environment-
      // independent (round-2 finding): a broken executable or a group-filtered
      // installation must never read as "the repo opted out". A gem the lock
      // declares but the environment cannot run then RUNS and fails loudly
      // instead of skipping.
      const lock = readText(path.join(repoRoot, 'Gemfile.lock'));
      // Membership means "any gem that PROVIDES the executable" (round-3
      // finding): `bundle exec rspec` ships in rspec-core, and a typical
      // rspec-rails lockfile lists rspec-core/-rails/-expectations with no
      // bare `rspec` metagem — exact-name matching would skip a real suite.
      const inBundle = providers =>
        !!lock &&
        providers.some(gem => new RegExp(`^ {4}${gem} \\(`, 'm').test(lock));
      if (lock === null) {
        unavailable(lint, 'ruby_lint_fix', 'Gemfile.lock unreadable (membership unknown)');
        unavailable(test, 'ruby_test', 'Gemfile.lock unreadable (membership unknown)');
      } else {
        if (inBundle(['rubocop'])) {
          runnable(lint, 'ruby_lint_fix', 'bundle', ['exec', 'rubocop', '-a']);
        } else {
          skip(lint, 'ruby_lint_fix', 'rubocop not in bundle');
        }
        if (inBundle(['rspec', 'rspec-core'])) {
          runnable(test, 'ruby_test', 'bundle', ['exec', 'rspec']);
        } else {
          skip(test, 'ruby_test', 'rspec not in bundle');
        }
      }
    }
  }

  return { detected, lint, build, test };
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

  // Writability preflight: a producer must not run the gate silently degraded —
  // an unwritable receipt log discovered only at append time would let the run's
  // evidence vanish while its stdout still looked authoritative.
  if (!receiptLog || !treeDigest) {
    process.stdout.write(
      '> ⚠️ content-addressed receipt producer unavailable (lib/tree-digest.js or lib/receipt-log.js not installed) — legacy stdout-route receipts only\n'
    );
  }
  if (receiptLog) {
    const pre = receiptLog.preflightWritable(repoRoot);
    if (!pre.ok) {
      process.stdout.write(
        `# Precommit (${args.mode})\n\n` +
          `❌ receipt log unwritable — refusing to run the gate silently degraded.\n` +
          `   ${pre.error}\n\n` +
          `## Overall: ❌ FAIL\n`
      );
      return;
    }
  }

  let statusBefore = '';
  let statusAfter = '';
  let changedAfterLint = [];
  let baseline = null; // code-plane digest after lint:fix — the validation baseline
  const results = [];
  let summaryError = '';
  const pm = detectPackageManager(repoRoot);
  const pkg = readPackageJson(repoRoot);

  try {
    statusBefore = await gitStatusSB(repoRoot);
    process.stdout.write(`> package manager: ${pm}\n`);

    const lintGlobs = loadLintGlobs(repoRoot);

    // Shared step executor. Skip and unavailable records flow into results so
    // a repo with zero runnable scripts reports the sentinel instead of an
    // unfixable FAIL that wedges the strict stop gate (mirrors verify-runner
    // semantics); unavailable records are additionally load-bearing for the
    // verdict — any of them blocks a PASS (see overallPass).
    const executeStep = async s => {
      if (s.status === 'skip' || s.status === 'unavailable') {
        results.push(s);
        appendLog(
          runnerLog,
          `[${nowISO()}] step_${s.status} ${s.name} (${s.reason})\n`
        );
        if (s.status === 'unavailable') {
          process.stdout.write(`> ⛔ ${s.name} unavailable (${s.reason})\n`);
        }
        return s;
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
      appendLog(runnerLog, `[${nowISO()}] step_done ${s.name} code=${r.code}\n`);
      process.stdout.write(`> finished ${s.name} (code=${r.code})\n`);
      return r;
    };

    // comment blocks — static and cheap, so it executes FIRST, before
    // ecosystem discovery: the probes below can be heavyweight (gradle
    // wrapper startup, maven plugin resolution) and the policy verdict must
    // not wait behind them.
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
      await executeStep({
        name: 'comment_blocks',
        cmd: process.execPath,
        args: [ownChecker],
      });
    } else {
      process.stdout.write('> skip comment_blocks (checker missing)\n');
      await executeStep({
        name: 'comment_blocks',
        status: 'skip',
        reason: 'checker missing',
      });
    }

    // Ecosystem discovery (bounded probes, logged to runner.log) — after the
    // policy step, before the validation phases. Ecosystem steps are grouped
    // by phase: every mutating lint-fix step (any ecosystem) must precede the
    // validation-baseline capture, so the arrays are spliced in phase order
    // below rather than per ecosystem.
    const steps = [];
    const eco = await buildEcosystemSteps(repoRoot, args.mode, {
      log: line => appendLog(runnerLog, `[${nowISO()}] ${line}\n`),
    });
    if (eco.detected.length) {
      process.stdout.write(`> ecosystems: ${eco.detected.join(', ')}\n`);
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
    steps.push(...eco.lint);

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
    steps.push(...eco.build);

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
    steps.push(...eco.test);

    // The validation baseline sits after the LAST intentionally-mutating step
    // (every lint-fix step, whichever ecosystem contributed it) and before
    // build/test; overallPass recomputes it and a PASS receipt requires the
    // endpoints to be equal (§3.4).
    const isLintStep = n => n === 'lint_fix' || n.endsWith('_lint_fix');
    let lastLintIdx = -1;
    steps.forEach((s, i) => {
      if (isLintStep(s.name)) lastLintIdx = i;
    });
    if (lastLintIdx === -1 && treeDigest) {
      baseline = treeDigest.computeTreeState(repoRoot).planes.code;
    }
    let anyLintRan = false;

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      await executeStep(s);
      if (!s.status && isLintStep(s.name)) anyLintRan = true;
      if (i === lastLintIdx) {
        if (anyLintRan) changedAfterLint = await gitDiffNameOnly(repoRoot);
        if (treeDigest) {
          baseline = treeDigest.computeTreeState(repoRoot).planes.code;
        }
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
    //
    // UNAVAILABLE steps (a detected ecosystem's required tool missing) block a PASS outright:
    // validation that could not execute is incomplete, and a sibling step passing must not mint
    // the receipt over the hole — e.g. pytest green while ruff is not installed.
    overallPass: (() => {
      const ran = results.filter(
        r => r.status !== 'skip' && r.status !== 'unavailable'
      );
      const ranValidation = ran.filter(r => !isPolicyStep(r.name));
      const anyUnavailable = results.some(r => r.status === 'unavailable');
      return (
        !anyUnavailable && ranValidation.length > 0 && ran.every(r => r.code === 0)
      );
    })(),
    error: summaryError || undefined,
  };
  // Content-addressed verdict append (WB2): the producer records what it knows,
  // independent of stdout surviving truncation, piping, or backgrounding. It
  // runs BEFORE any diagnostic write (summary.json, summary.md) — evidence
  // production must not die to a failing diagnostic sink. The NO CHECKS RUN
  // state appends nothing — an all-skip run is not evidence in either
  // direction; a crashed run (summaryError) has no verdict to record.
  const receiptPolicyOnly =
    results.length > 0 &&
    results.every(
      r =>
        r.status === 'skip' ||
        r.status === 'unavailable' ||
        isPolicyStep(r.name)
    );
  const receiptPolicyFailed = results.some(
    r => isPolicyStep(r.name) && r.status !== 'skip' && r.code !== 0
  );
  if (
    receiptLog &&
    treeDigest &&
    !summaryError &&
    !(receiptPolicyOnly && !receiptPolicyFailed)
  ) {
    try {
      const endpoint = treeDigest.computeTreeState(repoRoot).planes.code;
      const verdict = summary.overallPass ? 'pass' : 'fail';
      const endpointsMatch =
        baseline &&
        !baseline.partial &&
        !endpoint.partial &&
        baseline.digest === endpoint.digest;
      if (verdict === 'pass' && !endpointsMatch) {
        // The tree drifted between lint:fix and overallPass (or a digest was
        // partial): a PASS receipt is refused — loudly — and the gate stays
        // open. FAIL is exempt below: negative evidence names what it observed.
        process.stdout.write(
          `> ⚠️ receipt withheld: baseline digest ${
            (baseline && baseline.digest) || '(partial)'
          } != endpoint ${endpoint.digest || '(partial)'} — tree changed during checks\n`
        );
        appendLog(runnerLog, `[${nowISO()}] receipt_withheld endpoint_mismatch\n`);
      } else {
        const rec = {
          v: 1,
          kind: 'verdict',
          plane: 'precommit',
          digest: endpoint.digest,
          verdict,
          mode: args.mode,
          head: short,
          time: nowISO(),
          producer: 'precommit-runner',
        };
        if (endpoint.partial) rec.partial = true;
        if (verdict === 'pass' && endpoint.digest) {
          // Resolution is recorded only after actually reading the fallback
          // file; an unreadable fallback resolves nothing (over-block, §4).
          const ts = receiptLog.readTombstones(repoRoot);
          if (ts.ok) {
            const ids = receiptLog.matchingTombstoneIds(
              ts.records,
              'precommit',
              endpoint.digest
            );
            if (ids.length) {
              rec.resolves = ids.map(id => ({
                plane: 'precommit',
                digest: endpoint.digest,
                id,
              }));
            }
          }
        }
        try {
          const { file } = receiptLog.resolveReceiptPaths(repoRoot);
          receiptLog.appendRecords(file, [rec]);
          appendLog(runnerLog, `[${nowISO()}] receipt_appended verdict=${verdict}\n`);
        } catch (e) {
          // Primary append failed: tombstone the pair on the fallback path so an
          // older same-digest PASS cannot silently close this gate (§4).
          appendLog(
            runnerLog,
            `[${nowISO()}] receipt_append_failed ${String(e && e.message)}\n`
          );
          try {
            if (!endpoint.digest) {
              // A partial digest matches nothing, so there is no (plane, digest)
              // pair an older PASS could close — nothing to tombstone.
              throw new Error('endpoint digest partial — no pair to block');
            }
            receiptLog.appendTombstone(repoRoot, [
              { plane: 'precommit', digest: endpoint.digest },
            ]);
            process.stdout.write(
              `> ⚠️ receipt append failed (${String(
                e && e.message
              )}); tombstone written — this (plane, digest) stays blocked until a later run resolves it\n`
            );
          } catch (e2) {
            process.stdout.write(
              `> ❌ receipt append AND tombstone write failed: ${String(
                e && e.message
              )} / ${String(e2 && e2.message)}\n`
            );
          }
        }
      }
    } catch (e) {
      process.stdout.write(
        `> ⚠️ receipt production failed: ${String((e && e.message) || e)}\n`
      );
    }
  }

  try {
    writeJson(path.join(logDir, 'summary.json'), summary);
    appendLog(runnerLog, `[${nowISO()}] summary_written\n`);
  } catch (e) {
    process.stdout.write(
      `> ⚠️ summary.json write failed (diagnostic only): ${String((e && e.message) || e)}\n`
    );
  }

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
    if (r.status === 'unavailable') {
      lines.push(`- ⛔ ${r.name} (required tool unavailable: ${r.reason})`);
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
  // Unavailable steps count as not-ran here: a repo whose every check is skipped or tool-less gets
  // ⚠️ NO CHECKS RUN (→ the Skill's human-facing fallback), while a partial run with an
  // unavailable tool falls through to ❌ FAIL via overallPass.
  const policyFailed = results.some(
    r =>
      isPolicyStep(r.name) &&
      r.status !== 'skip' &&
      r.status !== 'unavailable' &&
      r.code !== 0
  );
  const noValidationRan =
    results.length > 0 &&
    results.every(
      r =>
        r.status === 'skip' ||
        r.status === 'unavailable' ||
        isPolicyStep(r.name)
    );
  const unavailableSteps = results.filter(r => r.status === 'unavailable');
  if (unavailableSteps.length) {
    lines.push(
      `⛔ required tools unavailable: ${unavailableSteps
        .map(r => `${r.name} (${r.reason})`)
        .join(', ')}`
    );
    lines.push('');
  }
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
